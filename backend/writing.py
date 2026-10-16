"""Writing history, AI writing and comic-to-novel routes."""

import json
import re
import uuid
from .ai_client import _api_request, _extract_llm_content, emit_progress
from .auth import login_required
from .runtime import app
from .storage import (
    _current_username,
    delete_writing,
    list_writings,
    read_writing,
    save_session_data,
    save_writing,
)
from datetime import datetime
from flask import jsonify, request, session


# ========== AI 写作历史接口 ==========

@app.route('/api/writing/save', methods=['POST'])
@login_required
def writing_save():
    """保存一篇 AI 写作: 有 writing_id 且属于当前用户则更新, 否则新建.
    新建时如果没传 title, 用内容首行做标题兜底. 返回 {success, writing_id}."""
    data = request.json or {}
    content = data.get('content', '') or ''
    title = (data.get('title') or '').strip()
    writing_id = (data.get('writing_id') or '').strip() or session.get('writing_id') or ''

    username = _current_username()
    now = datetime.now().isoformat()

    doc = None
    if writing_id:
        doc = read_writing(username, writing_id)

    if doc is None:
        # 新建
        writing_id = str(uuid.uuid4())
        if not title:
            first_line = next((ln.strip() for ln in content.split('\n') if ln.strip()), '') or ''
            title = first_line[:30] or f"写作 {datetime.now().strftime('%Y-%m-%d %H:%M')}"
        doc = {
            'writing_id': writing_id,
            'title': title,
            'content': content,
            'created_at': now,
            'updated_at': now,
        }
    else:
        doc['content'] = content
        if title:
            doc['title'] = title
        doc['updated_at'] = now

    save_writing(username, writing_id, doc)
    session['writing_id'] = writing_id
    return jsonify({'success': True, 'writing_id': writing_id})


@app.route('/api/writings', methods=['GET'])
@login_required
def writings_list():
    """列出当前用户的写作历史索引 (不含全文)"""
    username = _current_username()
    works = list_writings(username)
    works.sort(key=lambda x: x.get('updated_at', ''), reverse=True)
    return jsonify({'success': True, 'works': works, 'username': username})


@app.route('/api/writing/<writing_id>', methods=['GET'])
@login_required
def writing_detail(writing_id):
    """获取一篇写作全文"""
    username = _current_username()
    doc = read_writing(username, writing_id)
    if not doc:
        return jsonify({'error': '写作不存在'}), 404
    return jsonify({'success': True, 'data': doc})


@app.route('/api/writing/<writing_id>/rename', methods=['POST'])
@login_required
def writing_rename(writing_id):
    """重命名一篇写作"""
    data = request.json or {}
    new_title = (data.get('title') or '').strip()
    if not new_title:
        return jsonify({'error': '标题不能为空'}), 400
    username = _current_username()
    doc = read_writing(username, writing_id)
    if not doc:
        return jsonify({'error': '写作不存在'}), 404
    doc['title'] = new_title
    doc['updated_at'] = datetime.now().isoformat()
    save_writing(username, writing_id, doc)
    return jsonify({'success': True, 'title': new_title})


@app.route('/api/writing/<writing_id>', methods=['DELETE'])
@login_required
def writing_delete(writing_id):
    """删除一篇写作"""
    username = _current_username()
    if not delete_writing(username, writing_id):
        return jsonify({'error': '写作不存在'}), 404
    if session.get('writing_id') == writing_id:
        session.pop('writing_id', None)
    return jsonify({'success': True})


@app.route('/api/generate-title', methods=['POST'])
@login_required
def generate_title():
    """用 LLM 分析小说原文, 生成简洁的漫画标题 (10-20 字)"""
    data = request.json or {}
    text = (data.get('text') or '').strip()
    api_url = data.get('api_url', '')
    api_key = data.get('api_key', '')
    model = data.get('model', '')

    if not text:
        return jsonify({'error': '缺少小说原文'}), 400
    if not api_url:
        return jsonify({'error': '缺少 LLM API 地址'}), 400

    # 只取前 2000 字分析, 足够判断主题
    sample = text[:2000]
    prompt = (
        "请阅读以下小说片段, 为它生成一个简洁有吸引力的漫画标题。\n"
        "要求:\n"
        "1. 长度 10-20 个汉字\n"
        "2. 反映故事核心主题或情节\n"
        "3. 不要使用引号、书名号、标点符号\n"
        "4. 直接返回标题文字, 不要任何解释或前缀\n\n"
        f"小说片段:\n{sample}"
    )

    try:
        headers = {'Content-Type': 'application/json'}
        if api_key:
            headers['Authorization'] = f'Bearer {api_key}'
        payload = {
            'model': model or 'minimax-m3-1-250227',
            'messages': [
                {'role': 'system', 'content': '你是一个漫画标题生成器, 只返回标题文字, 不要任何解释。'},
                {'role': 'user', 'content': prompt}
            ],
            'temperature': 0.7,
            'max_tokens': 60,
        }
        resp = _api_request('POST', api_url, headers=headers, json=payload, timeout=30)
        resp.raise_for_status()
        result = resp.json()
        title = result.get('choices', [{}])[0].get('message', {}).get('content', '').strip()
        # 清理可能出现的引号/书名号/前缀
        title = title.strip('"\'""「」《》').strip()
        # 截取第一行, 避免模型返回多行解释
        title = title.split('\n')[0].strip()
        if not title:
            title = f"漫画作品 {datetime.now().strftime('%Y-%m-%d')}"
        return jsonify({'success': True, 'title': title})
    except Exception as e:
        print(f"[generate-title] Error: {e}")
        # 失败时返回默认标题, 不阻断流程
        return jsonify({'success': False, 'title': f"漫画作品 {datetime.now().strftime('%Y-%m-%d')}", 'error': str(e)})


# 长文本续写上下文压缩: 超过阈值时, 用模型把前情压成摘要再续写,
# 避免超长小说只取末尾 N 字导致早期剧情丢失
_COMPRESS_THRESHOLD = 8000    # 原文超过该字数才触发压缩
_CONTEXT_TAIL = 4000          # 保留的原文尾部字数 (verbatim)
_SUMMARIZE_HEAD_CAP = 12000   # 参与压缩的"前情"上限 (只取最近 N 字)


def _summarize_head(head, api_url, api_key, model):
    """把小说的"前情"(除最近尾部外的部分) 压缩成 ≤500 字摘要.
    失败抛异常, 由调用方兜底退化为只取尾部."""
    sample = head[-_SUMMARIZE_HEAD_CAP:]
    prompt = (
        "你是小说编辑。请把下面这段小说内容压缩成一份不超过500字的\"前情摘要\",\n"
        "保留所有关键剧情推进、人物关系、重要设定与伏笔, 以便在后续续写中引用。\n"
        "只输出摘要本身, 不要任何前缀、标题或解释。\n\n"
        f"小说内容:\n{sample}"
    )
    headers = {'Content-Type': 'application/json'}
    if api_key:
        headers['Authorization'] = f'Bearer {api_key}'
    payload = {
        'model': model or 'minimax-m3-1-250227',
        'messages': [
            {'role': 'system', 'content': '你是一位专业的小说编辑, 只输出摘要文本, 不要任何解释或前缀。'},
            {'role': 'user', 'content': prompt}
        ],
        'temperature': 0.4,
        'max_tokens': 2048,
    }
    resp = _api_request('POST', api_url, headers=headers, json=payload, timeout=180)
    resp.raise_for_status()
    result = resp.json()
    content = result.get('choices', [{}])[0].get('message', {}).get('content', '').strip()
    if not content:
        raise RuntimeError('summarize returned empty')
    return content


def _build_continue_context(text, api_url, api_key, model):
    """构造续写/剧情选项的上下文. 文本过长时先用模型压缩前情, 返回 (context, compressed)."""
    if len(text) > _COMPRESS_THRESHOLD:
        tail = text[-_CONTEXT_TAIL:]
        try:
            summary = _summarize_head(text[:-_CONTEXT_TAIL], api_url, api_key, model)
            return f"[前情摘要]\n{summary}\n\n[最近原文]\n{tail}", True
        except Exception as e:
            print(f"[context] compress failed, fallback to tail-only: {e}")
            return tail, False
    return text[-6000:], False


@app.route('/api/plot-options', methods=['POST'])
@login_required
def plot_options():
    """用 LLM 基于小说结尾构思 3 个剧情发展方向"""
    data = request.json or {}
    text = (data.get('text') or '').strip()
    api_url = data.get('api_url', '')
    api_key = data.get('api_key', '')
    model = data.get('model', '')

    if not text:
        return jsonify({'error': '缺少小说原文'}), 400
    if not api_url:
        return jsonify({'error': '缺少 LLM API 地址'}), 400

    # 取末尾作为上下文 (剧情从结尾继续); 超长时先用模型压缩前情
    context, compressed = _build_continue_context(text, api_url, api_key, model)

    prompt = (
        "阅读以下小说的内容, 构思 3 个不同的剧情发展方向。\n\n"
        "要求:\n"
        "1. 每个方向用一句话概括 (15-40 个汉字), 彼此风格和走向差异明显\n"
        "2. 必须基于已有角色、设定和伏笔, 逻辑合理, 不要凭空引入全新世界观\n"
        "3. 只返回 JSON 数组, 格式如 [\"方向一\",\"方向二\",\"方向三\"], 不要任何解释或前缀\n\n"
        f"小说内容:\n{context}"
    )

    try:
        headers = {'Content-Type': 'application/json'}
        if api_key:
            headers['Authorization'] = f'Bearer {api_key}'
        payload = {
            'model': model or 'minimax-m3-1-250227',
            'messages': [
                {'role': 'system', 'content': '你是一位小说剧情策划师, 只返回 JSON 数组, 不要任何解释或前缀。'},
                {'role': 'user', 'content': prompt}
            ],
            'temperature': 0.8,
            # 推理型模型 (如 minimax-m3) 会先输出 reasoning_content 再输出正式内容,
            # max_tokens 必须给足, 否则预算被思考链耗尽, content 为空
            'max_tokens': 4000,
        }
        resp = _api_request('POST', api_url, headers=headers, json=payload, timeout=120)
        resp.raise_for_status()
        result = resp.json()
        raw = result.get('choices', [{}])[0].get('message', {}).get('content', '').strip()

        # 优先按 JSON 数组解析
        options = []
        m = re.search(r'\[.*\]', raw, re.DOTALL)
        if m:
            try:
                parsed = json.loads(m.group(0))
                if isinstance(parsed, list):
                    options = [str(x).strip() for x in parsed if str(x).strip()]
            except (ValueError, TypeError):
                options = []
        # 兜底: 按行切分, 去掉 "1." "2." "3." 之类编号
        if not options:
            for line in raw.split('\n'):
                cleaned = re.sub(r'^[\d一二三四五六]*[\.、)）]\s*', '', line).strip().strip('"\'“”')
                if cleaned:
                    options.append(cleaned)
        # 清理每个选项里的编号/前缀残留
        options = [re.sub(r'^[\d一二三四五六]*[\.、)）]\s*', '', o).strip() for o in options[:3]]

        if not options:
            return jsonify({'error': '剧情方向生成失败（模型思考过长或未按要求返回，请重试）'}), 502
        return jsonify({'success': True, 'options': options})
    except Exception as e:
        print(f"[plot-options] Error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/continue-novel', methods=['POST'])
@login_required
def continue_novel():
    """用 LLM 按指定方向续写小说, 返回新内容 (不含原文)"""
    data = request.json or {}
    text = (data.get('text') or '').strip()
    api_url = data.get('api_url', '')
    api_key = data.get('api_key', '')
    model = data.get('model', '')
    direction = (data.get('direction') or '').strip()

    try:
        length = int(data.get('length', 800))
    except (TypeError, ValueError):
        length = 800
    length = max(100, min(length, 3000))

    if not text:
        return jsonify({'error': '缺少小说原文'}), 400
    if not api_url:
        return jsonify({'error': '缺少 LLM API 地址'}), 400

    # 取末尾作为上下文 (故事从结尾继续); 超长时先用模型压缩前情, 避免早期剧情丢失
    context, compressed = _build_continue_context(text, api_url, api_key, model)

    prompt = (
        "请续写以下小说的后续内容。\n\n"
        "要求:\n"
        "1. 保持与原文一致的人称、叙事视角、文风和节奏, 沿用已有角色、设定和伏笔\n"
        "2. 承接上文情节自然推进, 人物性格与行为逻辑保持一致, 不要突然引入大量新角色\n"
        "3. 不要重复、复述或改写原文中已有的内容, 直接从情节的下一步写起\n"
        "4. 只输出新续写的内容本身, 不要输出\"续写:\"\"以下为续写内容\"之类的说明、前缀或标题\n"
        "5. 续写约 {length} 个汉字, 自然分段, 到末尾可留悬念以便继续下一段\n\n"
        f"小说结尾原文:\n{context}"
    )
    if direction:
        prompt += f"\n\n作者方向要求: {direction}"

    # 中文约 1 字 ≈ 1~1.5 token; 额外预留推理型模型的思考预算, 防止预算被 reasoning 耗尽
    max_tokens = max(2048, min(int(length * 1.5) + 2048, 16384))

    try:
        headers = {'Content-Type': 'application/json'}
        if api_key:
            headers['Authorization'] = f'Bearer {api_key}'
        payload = {
            'model': model or 'minimax-m3-1-250227',
            'messages': [
                {'role': 'system', 'content': '你是一位擅长中文长篇小说续写的作者, 只输出新续写内容, 不要任何解释或前缀。'},
                {'role': 'user', 'content': prompt}
            ],
            'temperature': 0.7,
            'max_tokens': max_tokens,
        }
        resp = _api_request('POST', api_url, headers=headers, json=payload, timeout=300)
        resp.raise_for_status()
        result = resp.json()
        continuation = result.get('choices', [{}])[0].get('message', {}).get('content', '').strip()

        # 清理前缀/说明 (如 "续写:", "以下是续写内容:")
        for _ in range(3):
            stripped = continuation.lstrip()
            if not stripped:
                break
            m = re.match(r'^(?:以下(?:为|是)?|接着)?续写(?:内容|结果|部分)?[:：]', stripped)
            if m:
                continuation = stripped[m.end():].lstrip()
            else:
                break
        # 防模型重复原文结尾: 去掉续写开头与原文末尾重复的部分
        tail = context[-80:]
        for i in range(min(60, len(tail)), 0, -1):
            if continuation.startswith(tail[-i:]):
                continuation = continuation[i:]
                break
        continuation = continuation.lstrip()
        # 硬性长度上限, 防止模型超发
        continuation = continuation[:int(length * 1.4) + 300].rstrip()
        if not continuation:
            return jsonify({'error': '续写结果为空（模型思考过长或未按要求返回，请重试或减小字数）'}), 502
        return jsonify({
            'success': True,
            'continuation': continuation,
            'length': len(continuation),
            'compressed': compressed,
        })
    except Exception as e:
        print(f"[continue-novel] Error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/polish-styles', methods=['POST'])
@login_required
def polish_styles():
    """用 LLM 基于小说文本生成 3-4 个润色风格选项"""
    data = request.json or {}
    text = (data.get('text') or '').strip()
    api_url = data.get('api_url', '')
    api_key = data.get('api_key', '')
    model = data.get('model', '')

    if not text:
        return jsonify({'error': '缺少小说原文'}), 400
    if not api_url:
        return jsonify({'error': '缺少 LLM API 地址'}), 400

    # 头尾各取 2000 字, 比只取结尾更贴合作者文风
    context = text[:2000] + '\n……\n' + text[-2000:]

    prompt = (
        "阅读以下小说片段, 构思 3-4 个不同的润色风格。\n\n"
        "要求:\n"
        "1. 每个风格包含 name (一句话风格名, 如 \"保持原味\"\"更生动\"\"更精炼\"\"更文艺\") 和 instruction (给润色引擎的具体润色要求, 2-3 句)\n"
        "2. 风格之间差异明显, 都要基于这段文本的文风特点\n"
        "3. 只返回 JSON 数组, 格式如 [{\"name\":\"更生动\",\"instruction\":\"用更具体更有画面感的动词和细节\"}], 不要任何解释或前缀\n\n"
        f"小说片段:\n{context}"
    )

    try:
        headers = {'Content-Type': 'application/json'}
        if api_key:
            headers['Authorization'] = f'Bearer {api_key}'
        payload = {
            'model': model or 'minimax-m3-1-250227',
            'messages': [
                {'role': 'system', 'content': '你是一位小说编辑, 只返回 JSON 数组, 不要任何解释或前缀。'},
                {'role': 'user', 'content': prompt}
            ],
            'temperature': 0.8,
            # 推理型模型会先输出 reasoning_content, max_tokens 必须给足
            'max_tokens': 4000,
        }
        resp = _api_request('POST', api_url, headers=headers, json=payload, timeout=120)
        resp.raise_for_status()
        result = resp.json()
        raw = result.get('choices', [{}])[0].get('message', {}).get('content', '').strip()

        styles = []
        m = re.search(r'\[.*\]', raw, re.DOTALL)
        if m:
            try:
                parsed = json.loads(m.group(0))
                if isinstance(parsed, list):
                    for item in parsed:
                        if isinstance(item, dict) and item.get('name') and item.get('instruction'):
                            styles.append({
                                'name': str(item['name']).strip(),
                                'instruction': str(item['instruction']).strip()
                            })
            except (ValueError, TypeError):
                styles = []
        styles = styles[:4]
        if not styles:
            return jsonify({'error': '润色风格生成失败（模型思考过长或未按要求返回，请重试）'}), 502
        return jsonify({'success': True, 'styles': styles})
    except Exception as e:
        print(f"[polish-styles] Error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/polish-novel', methods=['POST'])
@login_required
def polish_novel():
    """按指定风格润色小说文本; 长文本分块处理, 逐块调用 LLM"""
    data = request.json or {}
    text = (data.get('text') or '').strip()
    api_url = data.get('api_url', '')
    api_key = data.get('api_key', '')
    model = data.get('model', '')
    style = (data.get('style') or '').strip() or '在保留原文情节、人物、结构的前提下，优化语言表达、用词与节奏'
    task_id = data.get('task_id', '')

    if not text:
        return jsonify({'error': '缺少小说原文'}), 400
    if not api_url:
        return jsonify({'error': '缺少 LLM API 地址'}), 400

    def split_chunks(t, max_len=1800):
        """按段落分组切块 (≤max_len 字); 单个超长段按字符硬切"""
        chunks, cur, cur_len = [], [], 0
        for para in t.split('\n'):
            para_len = len(para)
            if para_len > max_len:
                if cur:
                    chunks.append('\n'.join(cur))
                    cur, cur_len = [], 0
                for i in range(0, para_len, max_len):
                    chunks.append(para[i:i + max_len])
            elif cur_len + para_len + 1 > max_len:
                chunks.append('\n'.join(cur))
                cur, cur_len = [para], para_len
            else:
                cur.append(para)
                cur_len += para_len + 1
        if cur:
            chunks.append('\n'.join(cur))
        return chunks

    def call_polish(chunk, prev_tail):
        """单块调用 LLM 润色, 返回润色文本 (空则说明预算耗尽/模型异常)"""
        user = (
            "请对下面的小说段落进行润色。\n\n"
            f"润色风格要求: {style}\n\n"
            "要求:\n"
            "1. 保持情节、人物、对话、场景、段落结构完全不变, 只优化语言表达、用词、句式与节奏\n"
            "2. 不要增删剧情内容, 不要改动人物名字和关键设定\n"
            "3. 只输出润色后的段落本身, 不要输出\"润色后:\"之类的说明、前缀或标题\n"
        )
        if prev_tail:
            user += f"\n注意: 上文结尾是这样的, 请紧接上文自然衔接, 不要重复或遗漏衔接处:\n{prev_tail}\n"
        user += f"\n待润色段落:\n{chunk}"

        payload = {
            'model': model or 'minimax-m3-1-250227',
            'messages': [
                {'role': 'system', 'content': '你是一位专业的小说润色编辑, 只输出润色后的文本, 不要任何解释或前缀。'},
                {'role': 'user', 'content': user}
            ],
            'temperature': 0.6,
            # 推理模型需预留 reasoning 预算 (4096 保底) + 输出预算 (约 1.6 token/字)
            'max_tokens': min(12000, 4096 + int(len(chunk) * 1.6)),
        }
        resp = _api_request('POST', api_url, headers=headers, json=payload, timeout=300)
        resp.raise_for_status()
        result = resp.json()
        out = result.get('choices', [{}])[0].get('message', {}).get('content', '').strip()
        # 清理前缀/说明 (如 "润色后:" "以下为润色稿:")
        for _ in range(3):
            stripped = out.lstrip()
            if not stripped:
                break
            m = re.match(r'^(?:以下(?:为|是)?)?润色(?:稿|后|结果|后的内容|后的文本)?[:：]', stripped)
            if m:
                out = stripped[m.end():].lstrip()
            else:
                break
        return out.strip()

    try:
        headers = {'Content-Type': 'application/json'}
        if api_key:
            headers['Authorization'] = f'Bearer {api_key}'

        emit_progress(task_id, 5, '正在分段…', 'preparing')
        chunks = split_chunks(text)
        total = len(chunks)
        polished_chunks = []

        for i, chunk in enumerate(chunks):
            emit_progress(task_id, 5 + int((i / total) * 85), f'正在润色第 {i + 1}/{total} 段…', 'polishing')
            prev_tail = chunks[i - 1][-300:] if i > 0 else ''
            polished = call_polish(chunk, prev_tail)
            if not polished:
                emit_progress(task_id, 0, '润色失败（某段返回为空），请重试', 'error')
                return jsonify({'error': '润色失败（模型思考过长或未按要求返回，请重试）'}), 502
            polished_chunks.append(polished)

        emit_progress(task_id, 90, '正在合并…', 'merging')
        polished_text = '\n\n'.join(polished_chunks).strip()
        emit_progress(task_id, 100, '润色完成', 'done')
        return jsonify({'success': True, 'polished': polished_text, 'length': len(polished_text)})
    except Exception as e:
        print(f"[polish-novel] Error: {e}")
        try:
            emit_progress(task_id, 0, f'润色失败: {e}', 'error')
        except Exception:
            pass
        return jsonify({'error': str(e)}), 500

@app.route('/api/comic-to-novel', methods=['POST'])
@login_required
def comic_to_novel():
    """接收漫画图片（base64），调用视觉LLM生成小说文本"""
    data = request.json
    images = data.get('images', [])
    api_url = data.get('api_url', '')
    api_key = data.get('api_key', '')
    model = data.get('model', 'gpt-4o')
    task_id = data.get('task_id', '')

    if not images or len(images) == 0 or not api_url:
        return jsonify({'error': '缺少必要参数（图片和API地址）'}), 400

    if len(images) > 50:
        return jsonify({'error': '一次最多处理50张图片'}), 400

    emit_progress(task_id, 5, f'准备处理 {len(images)} 张漫画图片...', 'preparing')

    system_prompt = "你是一个专业的漫画转小说作家。你需要仔细观察漫画图片中的每一个细节，包括画面布局、人物表情动作、对话气泡、场景环境等，将其转化为生动、流畅的小说文本。注意保持故事的连贯性和角色的性格特征。"

    page_prompt_template = """请仔细观察这张漫画图片，将其转化为小说文本。

要求：
1. 详细描述画面中的场景、人物动作和表情
2. 提取并写入所有对话和旁白
3. 注意画面构图和分镜语言，用文字还原视觉效果
4. 用第三人称叙述，语言生动流畅
5. 保留故事的张力和节奏感"""

    try:
        headers = {'Content-Type': 'application/json'}
        if api_key:
            headers['Authorization'] = f'Bearer {api_key}'

        all_page_texts = []
        total_images = len(images)

        for idx, img_data in enumerate(images):
            print(f"Processing comic page {idx + 1}/{total_images}...")

            # 每页进度: 5% (准备) + 90% (处理) + 5% (合并)
            page_progress = 5 + int((idx / total_images) * 90)
            emit_progress(task_id, page_progress, f'正在识别第 {idx + 1}/{total_images} 页...', 'processing_page', extra={'page': idx + 1, 'total': total_images})

            page_prompt = f"这是漫画的第 {idx + 1} 页。\n\n{page_prompt_template}"
            if idx > 0:
                page_prompt = f"这是漫画的第 {idx + 1} 页。上一页的内容是：{all_page_texts[-1][:200]}...\n\n请续写。{page_prompt_template}"

            payload = {
                'model': model,
                'messages': [
                    {'role': 'system', 'content': system_prompt},
                    {
                        'role': 'user',
                        'content': [
                            {'type': 'text', 'text': page_prompt},
                            {'type': 'image_url', 'image_url': {'url': img_data}}
                        ]
                    }
                ],
                'max_tokens': 4096,
                'temperature': 0.7
            }

            response = _api_request('POST', api_url, headers=headers, json=payload, timeout=300)
            response.raise_for_status()
            result = response.json()

            page_text = _extract_llm_content(result)

            all_page_texts.append(page_text.strip())
            print(f"Page {idx + 1} result: {len(page_text)} chars")

        emit_progress(task_id, 95, '所有页面识别完成, 正在合并文本...', 'merging')

        # 合并所有页面的文本
        full_novel = "\n\n".join([
            f"## 第 {i + 1} 页\n\n{text}" if total_images > 1 else text
            for i, text in enumerate(all_page_texts)
        ])

        result_data = {
            'novel_text': full_novel,
            'pages': [{'page': i + 1, 'text': text} for i, text in enumerate(all_page_texts)],
            'total_pages': total_images,
            'model': model,
            'timestamp': datetime.now().isoformat()
        }

        # 持久化
        save_session_data('comic2novel', result_data)

        emit_progress(task_id, 100, '小说生成完成', 'done')
        return jsonify({'success': True, 'data': result_data})

    except Exception as e:
        import traceback
        print(f"Comic to novel error: {str(e)}")
        print(traceback.format_exc())
        emit_progress(task_id, 0, f'转换失败: {e}', 'error')
        return jsonify({'error': str(e)}), 500
