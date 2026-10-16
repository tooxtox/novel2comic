"""Novel segmentation, character images and comic page routes."""

import json
import os
import re
import time
from .ai_client import (
    _api_request,
    _clean_placeholder_dialogue,
    _extract_llm_content,
    _try_parse_json,
    call_image_api,
    emit_progress,
)
from .auth import login_required
from .rendering import (
    BUBBLE_DRAWERS,
    _get_chinese_font,
    _grid_dims,
    _norm_bubble_mode,
    _norm_comic_mode,
    _normalize_dialogue_type,
    _overlay_bubbles_on_page,
)
from .runtime import app
from .storage import (
    _local_image_abs_path,
    get_current_work_id,
    load_session_data,
    prepare_ref_images,
    save_image_result,
    save_session_data,
    upload_to_cloud_storage,
)
from PIL import Image, ImageDraw
from datetime import datetime
from flask import jsonify, request


STYLE_TAG_MAP = {
    'camera_angle': {
        '俯视': "bird's eye view, high angle, looking down",
        '仰视': "low angle shot, worm's eye view, looking up",
        '平视': "eye level shot, straight on view",
        '斜视': "dutch angle, tilted camera, oblique view",
        '主观视角': "POV shot, first person perspective, subjective view",
    },
    'composition': {
        '三分法': "rule of thirds composition",
        '对称': "symmetric composition, balanced framing",
        '中心对称': "centered composition, subject in middle",
        '框架式': "frame within a frame, framed by foreground elements",
        '引导线': "leading lines, converging perspective",
    },
    'mood': {
        '紧张': "tense atmosphere, suspenseful, on edge",
        '紫蓝': "purple and blue color grading, cool tone, melancholic blue",
        '紫红': "purple and red color grading, warm passion, dramatic crimson",
        '暧昧': "ambiguous mood, hazy, dreamy, soft focus",
        '悲伤': "sad, melancholic, somber mood, sorrowful",
        '温馨': "warm, cozy, heartwarming, gentle atmosphere",
        '压抑': "oppressive, claustrophobic, suffocating atmosphere",
        '恐怖': "horror, eerie, unsettling, creepy mood",
    },
    'shot_scale': {
        '大远景': "extreme long shot, panoramic view, vast establishing shot",
        '远景': "long shot, wide establishing shot",
        '全景': "full shot, wide shot showing whole body and surroundings",
        '中景': "medium shot, waist up framing",
        '近景': "medium close-up, chest up framing",
        '特写': "close-up, face filling frame, intimate detail shot",
        '大特写': "extreme close-up, single feature detail, macro shot",
    },
    'lighting': {
        '硬光': "hard light, sharp shadows, high contrast lighting",
        '背光': "backlight, rim light, silhouette lighting",
        '顶光': "top light, overhead lighting, dramatic downlight",
        '荧光灯': "fluorescent light, clinical cold light",
        '光斑': "bokeh, light spots, soft dappled light",
        '柔光': "soft light, diffused, gentle illumination",
        '侧光': "side light, lateral lighting, dramatic sideway illumination",
        '剪影': "silhouette lighting, dark figure against bright background",
    },
    'of_type': {
        '静态': "still moment, frozen in time",
        '动态': "dynamic action, motion blur, kinetic moment",
        '回忆': "flashback scene, sepia tone, memory sequence",
        '梦境': "dreamlike, surreal, hazy ethereal quality",
    },
}


def upgrade_segment_prompt(seg):
    """任务2: 把分镜的结构化字段(camera_angle/composition/mood/shot_scale/lighting/of_type)
    转换成英文 tag 并拼接到 style_prompt 后面.

    输入: seg dict  (可包含 style_prompt 字段, 也可只包含新字段)
    输出: 增强后的 style_prompt 字符串
    """
    if not isinstance(seg, dict):
        return ''

    base = (seg.get('style_prompt') or '').strip()

    # 兼容两种取值方式: 中文枚举值 (如"俯视") 直接查表; 若已是英文则原样保留
    injected_tags = []
    for field in ['camera_angle', 'composition', 'mood', 'shot_scale', 'lighting', 'of_type']:
        val = (seg.get(field) or '').strip()
        if not val:
            continue
        mapping = STYLE_TAG_MAP.get(field, {})
        if val in mapping:
            injected_tags.append(mapping[val])
        else:
            # 已经是英文或其他自由文本, 直接当 tag 用
            injected_tags.append(val)

    if not injected_tags:
        return base

    # 注入形式: [FIELD] tag (便于事后回溯)
    tag_block = ', '.join(injected_tags)
    if base:
        return f"{base}, {tag_block}"
    return tag_block


def _colorize_style_text(text):
    """彩色漫画模式下, 把 style_prompt 中强制黑白的短语替换成彩色描述"""
    if not text:
        return text
    t = text
    t = re.sub(r'ABSOLUTELY\s+NO\s+COLOR[^,.;]*', 'vibrant full color', t, flags=re.IGNORECASE)
    t = re.sub(r'Strict\s+black\s+and\s+white\s+manga,?\s*', 'full color manga, ', t, flags=re.IGNORECASE)
    t = re.sub(r'black\s+and\s+white\s+manga\s+style', 'colorful manga style', t, flags=re.IGNORECASE)
    t = re.sub(r'black\s+and\s+white\s+manga', 'colorful manga', t, flags=re.IGNORECASE)
    t = re.sub(r'pure\s+monochrome,?\s*', 'rich saturated colors, ', t, flags=re.IGNORECASE)
    t = re.sub(r'monochrome', 'colorful', t, flags=re.IGNORECASE)
    t = re.sub(r'grayscale\s+only', 'full color', t, flags=re.IGNORECASE)
    t = re.sub(r'black\s+ink\s+on\s+white\s+paper', 'vibrant colors, colorful inking', t, flags=re.IGNORECASE)
    t = re.sub(r'no\s+text\s+overlay', '', t, flags=re.IGNORECASE)
    t = re.sub(r',\s*,', ',', t)
    return t.strip(' ,.').strip()

@app.route('/api/segment', methods=['POST'])
@login_required
def segment_novel():
    data = request.json
    text = data.get('text', '')
    api_url = data.get('api_url', '')
    api_key = data.get('api_key', '')
    model = data.get('model', '')
    segments_per_page = data.get('segments_per_page', 0)  # 0 = LLM 自由控制
    task_id = data.get('task_id', '')
    comic_mode = _norm_comic_mode(data.get('comic_mode'))

    if not text or not api_url:
        return jsonify({'error': '缺少必要参数'}), 400

    emit_progress(task_id, 5, '正在构建分镜提示词...', 'building_prompt')

    # 每页分镜数由 LLM 根据情节自由控制 (2-8 格之间)
    # 不再强制固定数量, 让分镜师根据节奏自然划分
    segments_hint = ''
    if segments_per_page and segments_per_page > 0:
        # 保留参数作为"建议"而非"强制", 向后兼容
        segments_hint = f'(建议每页约 {segments_per_page} 格, 可根据情节在 2-8 格之间灵活调整)'
    else:
        segments_hint = '(根据情节节奏自由决定每页分镜数, 建议 2-8 格之间)'

    prompt = f"""将以下小说转换漫画分镜，每页分镜数{segments_hint}。同时提取所有主要出场角色。只返回JSON，无解释。

小说：
{text[:2000] + text[-2000:]}

每个分镜必须输出以下字段，camera_angle/composition/mood/shot_scale/lighting/of_type 必须从给定枚举中选一个（最贴近情节的）；dialogue_type 也必须从给定枚举中选一个（决定对话气泡形状，是漫画分镜师的"语气设计"）：
- scene_description: 简短场景描述（中文，20字内）
- dialogue: 角色对白或旁白。**漫画的灵魂是对白, 至少 60% 的分镜都要有实际对白, 写一句就行, 不要空着**
- dialogue_type: 气泡形状(语气) — dialogue / thought / shout / whisper / burst / narration / box / caption
  - dialogue: 普通角色对白 (默认, 80% 以上)
  - thought: 心理活动/内心独白 (引出"他想…""心里…""她暗忖…"这种)
  - shout: 大喊/尖叫/强烈情绪爆发 (出现"啊——!""不!!""住手!"等激烈词句)
  - whisper: 耳语/低语/秘密 (出现"…别出声""小声点""悄悄地"这种)
  - burst: 外部声效/拟声词 (整段是音效, 如"砰!""咔嚓!""BOOM!", 几乎不含主语动词)
  - narration: 第三人称叙述/旁白 (无人物说话, 是叙述者在描述场景/时间/心理状态)
  - box: 普通矩形气泡 (无尖尾, 想区别于 dialogue 的圆角矩形时)
  - caption: 拟声词/音效 (黑底白字, 与 burst 视觉差异, 二选一)
- shot_type: 景别 (远景/全景/中景/近景/特写)
- camera_angle: 视角 — 俯视 / 仰视 / 平视 / 斜视 / 主观视角
- composition: 构图 — 三分法 / 对称 / 中心对称 / 框架式 / 引导线
- mood: 情绪氛围 — 紧张 / 紫蓝 / 紫红 / 暧昧 / 悲伤 / 温馨 / 压抑 / 恐怖
- shot_scale: 景别 — 大远景 / 远景 / 全景 / 中景 / 近景 / 特写 / 大特写
- lighting: 光照 — 硬光 / 背光 / 顶光 / 荧光灯 / 光斑 / 柔光 / 侧光 / 剪影
- of_type: 场景类型 — 静态 / 动态 / 回忆 / 梦境

角色提取要求：
- 从小说中识别所有主要出场角色（最多10个），包括姓名/外貌/性格
- name: 角色名（中文）
- description: 详细外貌、服装、特征（用于图像生成，英文最佳，中文亦可）
- personality: 性格特征（一句话即可）

严格JSON格式（不要加注释、不要解释）：
{{
  "pages":[{{"page_number":1,"segments":[{{"segment_number":1,"scene_description":"<此处填实际场景描述>","dialogue":"<此处填实际对白, 若该格无对白则填空字符串>","dialogue_type":"<从枚举中选一个>","shot_type":"特写","camera_angle":"平视","composition":"三分法","mood":"紧张","shot_scale":"特写","lighting":"硬光","of_type":"静态"}}]}}],
  "characters":[
    {{"name":"角色A","description":"黑发少年，黑色风衣","personality":"冷静沉着"}},
    {{"name":"角色B","description":"银发少女，白色连衣裙","personality":"活泼开朗"}}
  ]
}}

⚠️ 重要提醒：
1. dialogue 字段必须填入小说中**实际的对白文字**(中文), 千万不要照抄示例里的"..."或"<...>"; 无对白的分镜才填 ""
2. scene_description 同理, 必须是该分镜自己的中文描述(20字内)
3. 每个分镜都要独立思考: 这个镜头里人物在说话吗? 在说什么? 语气如何? 该用什么形状的气泡?
4. 漫画分镜的对话是灵魂, 占比 ≥ 60% 的分镜都应带有 dialogue
5. dialogue_type 选择要点: 默认 dialogue; 内心独白/思考用 thought; 大喊大叫用 shout; 耳语低调用 whisper; 整段是拟声词/音效用 burst 或 caption; 第三人称叙述用 narration; 其余情况选 box。**请根据小说原文的语气和上下文, 给每个分镜一个最贴合的 dialogue_type, 体现"语气设计"**
"""

    try:
        headers = {'Content-Type': 'application/json'}
        if api_key:
            headers['Authorization'] = f'Bearer {api_key}'

        payload = {
            'model': model or 'deepseek-chat',
            'messages': [
                {'role': 'system', 'content': '你是一个专业的漫画分镜师，擅长将小说转换为漫画分镜脚本。只返回JSON，不要任何解释。'},
                {'role': 'user', 'content': prompt}
            ],
            'temperature': 0.7,
            'max_tokens': int(os.environ.get('MANGA_LLM_MAX_TOKENS', '32768')),  # 默认 32k, 模型上限 128k, 可通过环境变量调整
            'stream': False
        }

        print(f"Calling LLM API: {api_url}")
        print(f"Headers: {dict(headers)}")
        print(f"Payload: {json.dumps(payload, ensure_ascii=False)}")

        emit_progress(task_id, 15, '正在调用 LLM 生成分镜 (可能需要 30-120 秒)...', 'calling_llm')

        response = _api_request('POST', api_url, headers=headers, json=payload, timeout=300)
        print(f"Response status: {response.status_code}")
        print(f"Response headers: {dict(response.headers)}")
        print(f"Response text: {response.text}")
        response.raise_for_status()
        result = response.json()

        emit_progress(task_id, 70, 'LLM 返回结果, 正在解析 JSON...', 'parsing')

        content = _extract_llm_content(result)

        print(f"Extracted content length: {len(content)}")

        content = re.sub(r'```json\s*', '', content)
        content = re.sub(r'```\s*', '', content)
        content = content.strip()

        def _post_process(parsed):
            """解析成功后: 补全分镜字段 + 同步角色到 session, 返回 (pages, characters)"""
            # 规范化 page_number / segment_number: 强制从 1 开始连续编号
            # (LLM 有时会返回不从 1 开始的 page_number, 导致页码偏移)
            for page_idx, page in enumerate(parsed.get('pages', [])):
                page['page_number'] = page_idx + 1
                for seg_idx, seg in enumerate(page.get('segments', [])):
                    seg['segment_number'] = seg_idx + 1
                    if 'style_prompt' not in seg:
                        # 移除 'no text overlay' 避免模型不渲染对话文字
                        if comic_mode == 'color':
                            seg['style_prompt'] = 'vibrant full color manga, rich saturated colors, detailed colorful illustration, cel shading, no watermark'
                        else:
                            seg['style_prompt'] = 'ABSOLUTELY NO COLOR, no watermark, no signature. Strict black and white manga, pure monochrome, detailed ink drawing'
                    for k, dv in (('camera_angle', '平视'), ('composition', '三分法'), ('mood', ''),
                                  ('shot_scale', ''), ('lighting', ''), ('of_type', '静态')):
                        if k not in seg or seg.get(k) is None:
                            seg[k] = dv
                    # 规范化 dialogue_type: LLM 漏填/填错/旧数据 → 启发式推断 (LLM 主动规划 + 启发式兜底)
                    seg['dialogue_type'] = _normalize_dialogue_type(
                        seg.get('dialogue_type'),
                        seg.get('dialogue', ''),
                        seg.get('scene_description', ''),
                    )
            # 提取并保存角色
            chars = parsed.get('characters') or []
            if isinstance(chars, list):
                # 过滤无效项
                chars = [c for c in chars if isinstance(c, dict) and (c.get('name') or '').strip()]
            else:
                chars = []
            if chars:
                save_session_data('characters', {'characters': chars})
            return chars

        parsed = _try_parse_json(content)
        if parsed is None:
            emit_progress(task_id, 0, 'JSON 解析失败', 'error')
            return jsonify({'error': 'JSON解析失败，请重试或检查小说内容'}), 500
        chars = _post_process(parsed)
        parsed = _clean_placeholder_dialogue(parsed)
        save_session_data('segments', parsed)
        emit_progress(task_id, 95, '分镜解析完成, 正在保存...', 'saving')
        return jsonify({'success': True, 'data': parsed, 'characters': chars})

    except Exception as e:
        import traceback
        print(f"Error: {str(e)}")
        print(traceback.format_exc())
        emit_progress(task_id, 0, f'分镜生成失败: {e}', 'error')
        return jsonify({'error': str(e)}), 500

@app.route('/api/generate-characters', methods=['POST'])
@login_required
def generate_characters():
    data = request.json
    text = data.get('text', '')
    api_url = data.get('api_url', '')
    api_key = data.get('api_key', '')
    model = data.get('model', '')
    task_id = data.get('task_id', '')

    if not text or not api_url:
        return jsonify({'error': '缺少必要参数'}), 400

    emit_progress(task_id, 10, '正在构建角色分析提示词...', 'preparing')

    try:
        headers = {'Content-Type': 'application/json'}
        if api_key:
            headers['Authorization'] = f'Bearer {api_key}'

        prompt = f"""分析以下小说内容，提取所有主要出场角色。

小说内容：
{text[:8000]}

只返回JSON，格式如下：
{{"characters": [{{"name": "角色名", "description": "详细外貌、服装、特征描述", "personality": "性格描述"}}]}}"""

        payload = {
            'model': model or 'deepseek-chat',
            'messages': [
                {'role': 'user', 'content': prompt}
            ],
            'temperature': 0.7
        }

        print(f"Generating character analysis...")
        emit_progress(task_id, 20, '正在调用 LLM 分析角色 (可能需要 20-60 秒)...', 'calling_llm')
        response = _api_request('POST', api_url, headers=headers, json=payload, timeout=300)
        response.raise_for_status()
        result = response.json()

        emit_progress(task_id, 75, 'LLM 返回结果, 正在解析...', 'parsing')

        content = _extract_llm_content(result)

        content = re.sub(r'```json\s*', '', content)
        content = re.sub(r'```\s*', '', content)
        content = content.strip()

        print(f"Character content: {content}")
        parsed = json.loads(content)
        save_session_data('characters', parsed)
        emit_progress(task_id, 100, f'角色分析完成, 提取到 {len(parsed.get("characters", []))} 个角色', 'done')
        return jsonify({'success': True, 'data': parsed})

    except Exception as e:
        import traceback
        print(f"Character generation error: {str(e)}")
        print(traceback.format_exc())
        emit_progress(task_id, 0, f'角色分析失败: {e}', 'error')
        return jsonify({'error': str(e)}), 500


@app.route('/api/generate-character-image', methods=['POST'])
@login_required
def generate_character_image():
    data = request.json
    description = data.get('description', '')
    name = data.get('name', '')
    api_url = data.get('api_url', '')
    api_key = data.get('api_key', '')
    model = data.get('model', '')
    # 如果前端传了自定义 prompt, 优先使用 (人设 prompt 编辑功能)
    custom_prompt = (data.get('prompt') or '').strip()
    # 基线图重试上限 (1-5, 默认 3)
    try:
        max_attempts = int(data.get('max_attempts') or 3)
    except (TypeError, ValueError):
        max_attempts = 3
    max_attempts = max(1, min(5, max_attempts))
    comic_mode = _norm_comic_mode(data.get('comic_mode'))
    is_color = comic_mode == 'color'

    if not description or not api_url:
        return jsonify({'error': '缺少必要参数'}), 400

    # 提升到 retry loop 外 — get_current_work_id() 内部读 request.get_json,
    # 多次读取 Flask 会缓存, 但提到这里更清晰也避免极端 corner case 被消费
    work_id, work_username = get_current_work_id()

    last_error = None
    for attempt in range(1, max_attempts + 1):
        # 有自定义 prompt 就始终用它 (不区分第几次)
        if custom_prompt:
            if is_color:
                prompt = custom_prompt.rstrip('.') + f", {name}, {description}. Vibrant full color manga, rich colors, colorful illustration."
            else:
                prompt = custom_prompt.rstrip('.') + f", {name}, {description}. Strictly black and white manga, no color, pure monochrome."
        elif attempt == 1:
            if is_color:
                prompt = f"no watermark, no signature, no text overlay. Vibrant full color manga character design sheet, rich saturated colors, colorful illustration. full body portrait, {name}, {description}, detailed colorful line art, cel shading, single character only, plain background, reference sheet style"
            else:
                prompt = f"ABSOLUTELY NO COLOR, no watermark, no signature, no text overlay. Strict black and white manga character design sheet, pure monochrome, grayscale. full body portrait, {name}, {description}, detailed line art, high contrast, dramatic shading, cross-hatching, single character only, plain background, reference sheet style"
        else:
            if is_color:
                prompt = (
                    f"no watermark, no signature, no text overlay. "
                    f"Vibrant full color manga character design sheet, rich saturated colors, colorful illustration. "
                    f"SINGLE CHARACTER ONLY, no other figures, no crowd, no group shot. "
                    f"full body, front view, simple plain white background. "
                    f"Character name: {name}. Appearance: {description}. "
                    f"clean colorful line art, cel shading, detailed, professional character reference sheet. "
                    f"Regeneration attempt {attempt} — must show exactly ONE character."
                )
            else:
                prompt = (
                    f"ABSOLUTELY NO COLOR, no watermark, no signature, no text overlay. "
                    f"Strict black and white manga character design sheet, pure monochrome, grayscale. "
                    f"SINGLE CHARACTER ONLY, no other figures, no crowd, no group shot. "
                    f"full body, front view, simple plain white background. "
                    f"Character name: {name}. Appearance: {description}. "
                    f"clean line art, high contrast, detailed, professional character reference sheet. "
                    f"Regeneration attempt {attempt} — must show exactly ONE character."
                )

        try:
            payload = {
                'model': model or 'doubao-seedream-4-5-251128',
                'prompt': prompt,
                'size': '2K',
                'response_format': 'url',
                'watermark': False,
            }

            print(f"[Char-img attempt {attempt}/{max_attempts}] Generating baseline image for: {name}")
            image_url, result = call_image_api(api_url, api_key, payload)

            if image_url:
                work_id, work_username = get_current_work_id()
                local_url, error = save_image_result(image_url, "char", work_id, work_username)

                if local_url:
                    # 上传人设图到云存储 (可选), 返回 cloud:// fileID
                    # 关键: image_url 永远是浏览器可加载的 /static/... 路径, 绝不返回 cloud://
                    # cloud_file_id 仅供小程序/云存储消费者使用, <img src> 不能用它
                    file_id = upload_to_cloud_storage(local_url, work_id, "char")
                    return jsonify({
                        'success': True,
                        'image_url': local_url,
                        'cloud_file_id': file_id,
                        'attempts': attempt,
                        'max_attempts': max_attempts
                    })
                else:
                    last_error = error.get('error', '无法保存图片') if error else '无法保存图片'
                    print(f"[Char-img attempt {attempt}] save failed: {last_error}")
            else:
                last_error = 'API 未返回图片URL'
                print(f"[Char-img attempt {attempt}] no image_url in response")
        except Exception as e:
            last_error = str(e)
            print(f"[Char-img attempt {attempt}] exception: {e}")
            import traceback
            print(traceback.format_exc())

        # 失败则等待再重试 (避免触发限流)
        if attempt < max_attempts:
            time.sleep(1.0)

    return jsonify({
        'success': False,
        'error': f'基线图生成失败（已尝试 {max_attempts} 次）: {last_error}',
        'attempts': max_attempts
    }), 500

@app.route('/api/generate-page', methods=['POST'])
@login_required
def generate_page():
    """一次生成一页完整的漫画，支持参考人设图和上一页漫画"""
    data = request.json
    page = data.get('page', {})
    page_num = data.get('page_num', 1)
    api_url = data.get('api_url', '')
    api_key = data.get('api_key', '')
    model = data.get('model', '')
    negative_prompt = data.get('negative_prompt', 'color, colorful, chromatic, vibrant, saturated, blurry, low quality, distorted, watermark, signature, logo, deformed hands, extra fingers, bad anatomy, mutated')
    style_tags = data.get('style_tags', '').strip()
    # 向后兼容: 优先 character_references, 回退 references
    character_references = data.get('character_references') or data.get('references') or []
    # 参考强度 (0-1, 默认 0.6)
    reference_strength = data.get('reference_strength', 0.6)
    try:
        reference_strength = float(reference_strength)
    except (TypeError, ValueError):
        reference_strength = 0.6
    reference_strength = max(0.0, min(1.0, reference_strength))
    previous_page_image = data.get('previous_page_image')
    page_idx = data.get('page_idx')
    task_id = data.get('task_id', '')
    comic_mode = _norm_comic_mode(data.get('comic_mode'))
    is_color = comic_mode == 'color'

    bubble_render_mode = _norm_bubble_mode(data.get('bubble_render_mode'))
    api_draws_bubbles = (bubble_render_mode == 'api')

    if not page or not api_url:
        return jsonify({'error': '缺少必要参数'}), 400

    segments = page.get('segments', [])
    if not segments or len(segments) == 0:
        return jsonify({'error': '该页没有分镜'}), 400

    # 提升到 try 之前 — save_image_result 后续会用到, 避免多次 request.get_json 隐患
    work_id, work_username = get_current_work_id()

    emit_progress(task_id, 10, f'正在构建第 {page_num} 页提示词...', 'preparing')

    try:
        segment_descriptions = []
        # 任务2: 逐 panel 用结构化字段升级 style_prompt, 拼入 prompt
        for idx, seg in enumerate(segments):
            # 调用 upgrade_segment_prompt 合并 style_prompt + 镜头语言 tags
            upgraded_style = upgrade_segment_prompt(seg)
            base_style = upgraded_style or seg.get('style_prompt', '') or ('colorful manga style' if is_color else 'black and white manga style')
            seg_style_tags = base_style
            if is_color:
                # 彩色模式: 清理分镜 style_prompt 里强制黑白的短语
                seg_style_tags = _colorize_style_text(seg_style_tags)

            desc = f"Panel {idx+1}: {seg.get('scene_description', '')}"
            # 把升级后的 style_prompt 注入到每个 panel 描述
            desc += f" [style: {seg_style_tags}]"
            segment_descriptions.append(desc)

        if is_color:
            style_art = "detailed colorful manga art, vivid colors, professional manga coloring, cel shading, high quality full color illustration"
        else:
            style_art = "detailed ink drawing, dramatic shadows, high contrast, cross-hatching, professional manga quality, black ink on white paper"
        if style_tags:
            style_art = f"{style_tags}, {style_art}"

        # 显式指定网格布局, 让 API 按已知 RxC 出图 (后续 PIL 按同样的网格叠气泡)
        panel_count = len(segments)
        rows, cols = _grid_dims(panel_count)

        # 对话文本不再交给图像 API 渲染, 由后端 PIL 叠加 (避免乱码)
        # 这里明确要求图像 API 不画任何文字/气泡, 并按指定网格出图
        if is_color:
            page_header = (f"Vibrant full color manga comic page, rich saturated colors, colorful detailed art, "
                           f"no watermark, no signature. Arrange exactly {panel_count} panels in a {rows}x{cols} grid, "
                           f"equal-sized, top-left to bottom-right reading order, with thin black gutters between panels.")
        else:
            page_header = (f"ABSOLUTELY NO COLOR, no watermark, no signature. Strict black and white manga comic page, "
                           f"pure monochrome, grayscale only. Arrange exactly {panel_count} panels in a {rows}x{cols} grid, "
                           f"equal-sized, top-left to bottom-right reading order, with thin black gutters between panels.")
        page_prompt = f"""{page_header}

Panels:
{chr(10).join(segment_descriptions)}

Art style: {style_art}"""

        # 把 CHARACTER REFERENCE SHEET + REFERENCE IMAGE MAP 插到 page_header 之后、Panels 之前
        # (取代之前追加到 prompt 末尾的做法 — 6 panel description 会严重稀释角色信息)
        charsheet_in_head = locals().get('charsheet_in_head', '')
        if charsheet_in_head:
            page_prompt = page_header + charsheet_in_head + f"""

Panels:
{chr(10).join(segment_descriptions)}

Art style: {style_art}"""

        # 气泡渲染方式分流: PIL 模式强制 API 不画任何文字/气泡, 由本地 PIL 叠加;
        # API 模式让图像 API 端到端绘制气泡 (按各 panel 的 dialogue_type 形状)
        if api_draws_bubbles:
            # 收集本页所有 panel 的 dialogue_type, 让模型按类型画对应气泡形状
            dtype_hint_lines = [
                f'- Panel {i+1}: dialogue_type={(s.get("dialogue_type") or "dialogue").lower()} → text="{(s.get("dialogue") or "").strip()}"'
                for i, s in enumerate(segments)
                if (s.get('dialogue') or '').strip()
            ]
            dtype_hint = "\n".join(dtype_hint_lines) or "(no dialogue in any panel)"
            page_prompt += f"""

IMPORTANT — Render dialogue as comic speech bubbles and captions INSIDE the panels.
Each panel's dialogue has a specific bubble shape implied by its dialogue_type:

  dialogue  → white rounded-rect speech bubble with a small tail toward the speaker
  thought   → fluffy cloud-shaped bubble with small trailing circles
  shout     → jagged / starburst / explosion-shaped bubble
  whisper   → small rounded-rect with a dashed border and a tiny tail
  burst     → radiating-ray / starburst shape (often used for sound effects)
  narration → tan/beige rectangular caption box (no tail, third-person narration)
  box       → plain rectangular caption box with thin border
  caption   → black-filled rectangular caption with WHITE text (onomatopoeia / sound effect)

Per-panel content:
{dtype_hint}

Rules:
- Render all text legibly in clear, hand-lettered comic style.
- Place each bubble INSIDE its corresponding panel, NOT overflowing panel borders.
- Do NOT leave any dialogue or caption as floating text outside bubbles.
- For caption/burst types, use large stylized lettering suitable for sound effects.
- Do not invent extra dialogue that wasn't listed above.
- Keep the same drawing style, character proportions, and line quality across all panels."""
        else:
            # PIL 模式: 严格禁止 API 渲染任何文字/气泡, 全部交给后端 PIL
            page_prompt += """

NO text, NO speech bubble, NO caption, NO dialogue, NO narration box, no text overlay. Leave all panels completely free of any text or speech bubbles."""

        if page_num and page_num > 1:
            page_prompt += f"\n\nThis is PAGE {page_num} of the comic. It MUST maintain the exact same drawing style, visual continuity, character proportions, and shading technique as the previous page (Page {page_num-1}). The story progresses from the previous page - continue the visual narrative seamlessly."

        if character_references and len(character_references) > 0:
            char_sheet = []
            for char in character_references:
                name = char.get('name', '')
                has_image = bool((char.get('image_url') or '').strip())
                desc = (char.get('description') or '').strip()
                char_prompt = (char.get('char_prompt') or '').strip()
                # appearance 优先级: char_prompt (用户精调) > description (LLM 抽取) > 跳过
                # 修复: 之前 has_image=True 时只取 desc, 导致用户填的 char_prompt 被吞
                # 现在 char_prompt + desc 同时进 appearance (char_prompt 在前, 是用户主要意图)
                if char_prompt and desc:
                    appearance = f"{char_prompt}\n(Supplemented: {desc})"
                elif char_prompt:
                    appearance = char_prompt
                elif desc:
                    appearance = desc
                else:
                    appearance = ''
                # 标记: 是纯文字 (text-only) 还是图+文字 (image-anchored)
                if not has_image:
                    note = ' (text appearance prompt, NO reference image attached — render EXACTLY per this appearance prompt)'
                else:
                    note = ' (a reference image of THIS character is attached below — render this character EXACTLY from that reference image, use the text only as supporting detail)'
                if not appearance:
                    # 没有任何文字描述但有图: 仍然列出 (让模型知道"image[0] 是他")
                    if has_image and name:
                        char_sheet.append(
                            f"[CHARACTER: {name}]\nAPPEARANCE: (no text description — rely entirely on attached reference image){note}"
                        )
                    continue
                char_sheet.append(
                    f"[CHARACTER: {name}]\nAPPEARANCE: {appearance}{note}\n"
                    f"This character MUST appear exactly as described throughout ALL panels."
                )
            if char_sheet:
                # 关键: 把 CHARACTER REFERENCE SHEET 放在 PROMPT 头部 (紧接着 page_header),
                # 之前被追加到末尾, 6 panel description 把它稀释, 模型注意力严重不足
                char_section = "\n\n=== CHARACTER REFERENCE SHEET ===\n" + "\n\n".join(char_sheet) + "\n\nCRITICAL: All characters' appearance MUST be identical across all panels. Maintain absolute consistency in facial features, body type, clothing, and hairstyle throughout the entire page. The attached reference images are the source of truth — if any text above contradicts the reference image, the reference image wins."
                # 标记: 这块要插到 prompt 前部 (替换下面 charsheet_in_head 逻辑)
                charsheet_in_head = char_section
            else:
                charsheet_in_head = ''

        if previous_page_image:
            page_prompt += f"\n\n=== PREVIOUS PAGE REFERENCE ===\nA reference image of the previous page (Page {page_num-1}) is provided. This page MUST have exactly the same art style, line quality, shading technique, and visual tone as the reference. Characters should look identical to how they appear in the previous page."

        # 准备参考图片（缓存到本地后转base64）
        ref_images = prepare_ref_images(character_references, previous_page_image)
        print(f"Generating page {page_num} with {len(character_references)} character refs, previous page: {'yes' if previous_page_image else 'no'}, total {len(ref_images)} reference images")

        # 关键: 显式声明"image[i] 是哪个角色", 因为 payload['image'] 是裸 base64 列表,
        # 没有这个映射, 多角色时模型只能瞎猜, 角色脸互相串
        if ref_images and character_references:
            mapping_lines = []
            ref_idx = 0
            for char in character_references:
                if not (char.get('image_url') or '').strip():
                    continue
                if ref_idx >= len(ref_images):
                    break
                name = (char.get('name') or '').strip() or f'Character{ref_idx+1}'
                mapping_lines.append(
                    f"  - REFERENCE IMAGE #{ref_idx+1} = {name} — their face, hair, outfit, body type"
                )
                ref_idx += 1
            if previous_page_image and ref_idx < len(ref_images):
                mapping_lines.append(
                    f"  - REFERENCE IMAGE #{ref_idx+1} = PREVIOUS PAGE — drawing style, line quality, visual tone"
                )
            if mapping_lines:
                ref_map = (
                    "\n\n=== ATTACHED REFERENCE IMAGE MAP ===\n"
                    "The attached reference images are sent in this EXACT order. "
                    "You MUST use them as follows:\n"
                    + "\n".join(mapping_lines)
                )
                # 放在 charsheet_in_head 后面 (紧随角色表, 紧接着 panel descriptions 之前)
                charsheet_in_head = (charsheet_in_head or '') + ref_map

        # 参考强度滑块 (前端可调) — Doubao seedream 没有原生 strength 字段,
        # 翻译为 prompt 语言, 让模型在文字层面遵守参考图
        if ref_images and reference_strength is not None:
            if reference_strength >= 0.75:
                adherence = "Render every character EXACTLY as shown in the reference images — same face, same hair, same outfit, same body type. Do NOT deviate from the reference."
            elif reference_strength >= 0.4:
                adherence = "Render each character following the reference images closely — keep their faces, hairstyles, and outfits recognizable, but minor variations are acceptable."
            else:
                adherence = "Use the reference images as loose inspiration only — feel free to vary appearance for dramatic effect."
            page_prompt += f"\n\nREFERENCE ADHERENCE (strength={reference_strength:.2f}): {adherence}"
        payload = {
            'model': model or 'doubao-seedream-4-5-251128',
            'prompt': page_prompt,
            'size': '2K',
            'response_format': 'url',
            'watermark': False,
        }

        if ref_images:
            if len(ref_images) == 1:
                payload['image'] = ref_images[0]
            else:
                payload['image'] = ref_images
            print(f"Included {len(ref_images)} reference image(s) in page generation payload")

        print(f"Generating full comic page {page_num}")

        emit_progress(task_id, 30, f'正在调用图像 API 生成第 {page_num} 页 (可能需要 15-90 秒)...', 'calling_image_api')

        image_url, result = call_image_api(api_url, api_key, payload)

        emit_progress(task_id, 80, '页面生成完成, 正在下载保存...', 'downloading')

        local_url, error = save_image_result(image_url, f"comic_page_{page_num}_full", work_id, work_username)

        if local_url:
            if api_draws_bubbles:
                # API 模式: API 已把气泡画进图像, 不再调用 PIL 叠加
                # 干净图概念不适用 (没有"无气泡"版本), clean_url 留 None 让前端明确知道不可编辑
                clean_url = None
                bubbles = []
                print(f"[generate_page] bubble_render_mode=api: skip PIL overlay, return empty bubbles")
            else:
                # PIL 模式 (默认): 保留干净副本, 用 PIL 叠加气泡 (避免乱码)
                clean_url, bubbles = _overlay_bubbles_on_page(local_url, segments)
                print(f"[generate_page] bubble_render_mode=pil: PIL overlay wrote {len(bubbles)} bubbles")
            # 持久化整页图片映射
            if page_idx is not None:
                fp_data = load_session_data('full_pages') or {'pages': []}
                fp_data['pages'].append({
                    'key': str(page_idx),
                    'local_url': local_url,
                    'clean_url': clean_url,
                    'bubbles': bubbles,
                    'page_num': page_num,
                    'timestamp': datetime.now().isoformat()
                })
                save_session_data('full_pages', fp_data)
            # 上传整页 (含气泡) 和干净图到云存储, 返回 cloud:// fileID
            file_id = upload_to_cloud_storage(local_url, work_id, f"comic_page_{page_num}_full")
            clean_file_id = upload_to_cloud_storage(clean_url, work_id, f"comic_page_{page_num}_clean") if clean_url else None
            emit_progress(task_id, 100, f'第 {page_num} 页生成完成', 'done')
            return jsonify({
                'success': True,
                'image_url': file_id or local_url,
                'clean_image_url': clean_file_id or clean_url,
                'bubbles': bubbles,
                'bubble_render_mode': bubble_render_mode,
            })
        else:
            emit_progress(task_id, 0, '页面生成失败', 'error')
            return jsonify({'error': error.get('error', '无法获取图片'), 'raw': result}), 500

    except Exception as e:
        import traceback
        print(f"Page generation error: {str(e)}")
        print(traceback.format_exc())
        emit_progress(task_id, 0, f'页面生成失败: {e}', 'error')
        return jsonify({'error': str(e)}), 500


@app.route('/api/reposition-bubbles', methods=['POST'])
@login_required
def reposition_bubbles():
    """从干净图(无气泡)按用户指定坐标重新烘对话气泡, 覆盖显示图.
    入参: {clean_image_url, output_image_url, bubbles: [{x,y,w,h,dialogue,dialogue_type}]}"""
    data = request.json or {}
    clean_url = data.get('clean_image_url')
    output_url = data.get('output_image_url')
    bubbles = data.get('bubbles', [])

    if not clean_url or not output_url or not bubbles:
        return jsonify({'error': '缺少 clean_image_url / output_image_url / bubbles'}), 400

    clean_abs = _local_image_abs_path(clean_url)
    output_abs = _local_image_abs_path(output_url)
    if not clean_abs or not os.path.exists(clean_abs):
        return jsonify({'error': '干净图不存在, 可能是旧数据未保留干净副本'}), 400
    if not output_abs:
        return jsonify({'error': '输出图路径无效'}), 400

    try:
        with Image.open(clean_abs) as img:
            img = img.convert('RGB')
            W, H = img.size
            font = _get_chinese_font(max(14, int(H * 0.025)))
            draw = ImageDraw.Draw(img)
            for bub in bubbles:
                dialogue = (bub.get('dialogue') or '').strip()
                if not dialogue:
                    continue
                dtype = (bub.get('dialogue_type') or 'dialogue').lower()
                if dtype not in BUBBLE_DRAWERS:
                    dtype = 'dialogue'
                bx = int(bub.get('x', 0))
                by = int(bub.get('y', 0))
                bw = int(bub.get('w', 100))
                bh = int(bub.get('h', 60))
                BUBBLE_DRAWERS[dtype](draw, bx, by, bw, bh, dialogue, font,
                                      overflow=False, canvas_bounds=(0, 0, W, H))
            img.save(output_abs)
            print(f"[Reposition] bubbles re-rendered to {output_abs}")
        return jsonify({'success': True})
    except Exception as e:
        import traceback
        print(f"[Reposition] error: {e}")
        print(traceback.format_exc())
        return jsonify({'error': str(e)}), 500
