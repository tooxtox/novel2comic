"""Work history, visibility, discovery and public work copies."""

import json
import os
import shutil
import time
import uuid
from .auth import login_required, work_id_required
from .runtime import BASE_DIR, USER_DATA_DIR, app
from .storage import (
    _IMAGE_EXTS,
    _invalidate_visibility,
    _is_valid_username,
    _is_valid_work_id,
    _is_work_public,
    _local_image_abs_path,
    _read_work_meta,
    _resolve_readable_static,
    get_current_work_id,
    get_session_id,
    get_work_dir,
    list_user_works,
    own_work_dir,
    save_user_history,
)
from datetime import datetime
from flask import jsonify, request, session


@app.route('/api/work/start', methods=['POST'])
@login_required
def work_start():
    """开始/创建一个新作品，将其绑定到当前会话"""
    data = request.json or {}
    title = data.get('title', '').strip() or f"作品 {datetime.now().strftime('%Y-%m-%d %H:%M')}"
    work_id = str(uuid.uuid4())
    username = session.get('username') or f'guest_{get_session_id()[:8]}'
    work_dir = get_work_dir(username, work_id)

    # 写入元数据
    meta = {
        'work_id': work_id,
        'title': title,
        'created_at': datetime.now().isoformat(),
        'updated_at': datetime.now().isoformat(),
        # 默认私密: 用户必须主动打开开关才会公开. 存量作品没有这个字段,
        # _is_work_public() 也按 False 处理, 所以历史数据天然保持私密.
        'is_public': False,
    }
    with open(os.path.join(work_dir, 'meta.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    # 绑定到 session
    session['work_id'] = work_id
    session['work_username'] = username
    session['work_title'] = title

    # 写入历史索引
    history = list_user_works(username)
    history.insert(0, {
        'work_id': work_id,
        'title': title,
        'created_at': meta['created_at'],
        'updated_at': meta['updated_at'],
        'is_public': False,
    })
    save_user_history(username, history)

    return jsonify({'success': True, 'work_id': work_id, 'title': title})


@app.route('/api/work/save-state', methods=['POST'])
@login_required
def work_save_state():
    """保存当前会话状态（novel/segments/characters/images/full_pages）到当前作品
    如果还没有 work_id, 自动创建一个, 避免自动保存时 400 报错
    """
    work_id, username = get_current_work_id()

    # 自动创建 work_id, 这样自动保存 (startSegment 后) 不需要用户手动点"保存当前"
    if not work_id:
        work_id = str(uuid.uuid4())
        title = f"作品 {datetime.now().strftime('%Y-%m-%d %H:%M')}"
        work_dir = get_work_dir(username, work_id)
        meta = {
            'work_id': work_id,
            'title': title,
            'created_at': datetime.now().isoformat(),
            'updated_at': datetime.now().isoformat(),
            'is_public': False,   # 新作品一律先私密
        }
        with open(os.path.join(work_dir, 'meta.json'), 'w', encoding='utf-8') as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)
        session['work_id'] = work_id
        session['work_username'] = username
        session['work_title'] = title
        # 写入历史索引
        history = list_user_works(username)
        history.insert(0, {
            'work_id': work_id,
            'title': title,
            'created_at': meta['created_at'],
            'updated_at': meta['updated_at'],
            'is_public': False,
        })
        save_user_history(username, history)

    data = request.json or {}
    work_dir = get_work_dir(username, work_id)

    # 将图片从其他作品目录 / static/output 复制到当前作品的 images 目录
    # 避免导入后图片 URL 指向旧目录导致 404
    def _relocate_image(url):
        """如果图片 URL 指向其他目录, 复制到当前作品 images/ 下, 返回新 URL"""
        if not url or not isinstance(url, str):
            return url
        # 已经在当前作品目录下的不用动
        expected_prefix = f'/static/users/{username}/works/{work_id}/images/'
        if url.startswith(expected_prefix):
            return url
        # data: URL 不用动
        if url.startswith('data:'):
            return url
        # 尝试从磁盘复制
        try:
            # URL → 磁盘路径. 必须过 _resolve_readable_static: 这条路径以前是
            # os.path.join(BASE_DIR, url.lstrip('/')), 意味着只要请求体里塞一个
            # /static/users/<别人>/works/<私密id>/images/x.png, 就能把别人的私密图
            # 复制进自己作品目录, 再由 /api/history 返回一个"自己人"的 URL ——
            # 任何按用户做的门禁都会被这样洗白. 现在统一按"本人 或 已公开"放行.
            disk_path = _resolve_readable_static(url)
            if not disk_path:
                return url  # 不存在 / 越界 / 无权限, 保持原 URL
            # 生成新文件名
            ext = os.path.splitext(disk_path)[1] or '.png'
            new_filename = f"{os.path.splitext(os.path.basename(disk_path))[0]}_{int(time.time())}{ext}"
            new_disk_path = os.path.join(work_dir, 'images', new_filename)
            shutil.copy2(disk_path, new_disk_path)
            return f'/static/users/{username}/works/{work_id}/images/{new_filename}'
        except Exception as e:
            print(f"[save-state] relocate image error: {e}")
            return url  # 复制失败, 保持原 URL

    # 递归处理所有图片 URL
    def _relocate_images_in_obj(obj):
        if isinstance(obj, dict):
            # 用 list() 避免修改时迭代 dict 报错; value 可能是字符串 URL 或嵌套结构
            for k, v in list(obj.items()):
                # 关键修复: 前端发来的 full_page_images / full_page_clean_images /
                # generated_images / combined_page_images 都是 {"<pageIdx>": "/static/..."}
                # 这种"URL 作为 value 的 dict", 之前只检查 image_url/local_url key 会漏掉
                # 这直接导致"另存为新作品"时新作品的 state.json 仍指向旧作品的 images 目录
                if isinstance(v, str) and v.startswith('/'):
                    obj[k] = _relocate_image(v)
                elif isinstance(v, (dict, list)):
                    _relocate_images_in_obj(v)
        elif isinstance(obj, list):
            for item in obj:
                if isinstance(item, (dict, list)):
                    _relocate_images_in_obj(item)

    segments = data.get('segments', {'pages': []})
    chars = data.get('characters', [])
    gen_imgs = data.get('generated_images', {})
    fp_imgs = data.get('full_page_images', {})
    cp_imgs = data.get('combined_page_images', {})
    fp_clean_imgs = data.get('full_page_clean_images', {})
    fp_bubbles = data.get('full_page_bubbles', {})

    # 重定位所有图片 URL
    _relocate_images_in_obj(chars)
    _relocate_images_in_obj(gen_imgs)
    _relocate_images_in_obj(fp_imgs)
    _relocate_images_in_obj(cp_imgs)
    _relocate_images_in_obj(fp_clean_imgs)

    state = {
        'novel_text': data.get('novel_text', ''),
        'segments': segments,
        'characters': chars,
        'generated_images': gen_imgs,
        'full_page_images': fp_imgs,
        'combined_page_images': cp_imgs,
        'full_page_clean_images': fp_clean_imgs,
        'full_page_bubbles': fp_bubbles,
        'updated_at': datetime.now().isoformat(),
    }
    # 写入后统计关键计数, 加载时可校验完整性
    state['_meta'] = {
        'segment_count': sum(len(p.get('segments', [])) for p in state['segments'].get('pages', [])),
        'character_count': len(state['characters']),
        'generated_image_count': len(state['generated_images']),
        'full_page_image_count': len(state['full_page_images']),
        'combined_page_image_count': len(state['combined_page_images']),
        'has_chars_with_image': sum(1 for c in state['characters'] if (c.get('image_url') or '').strip()),
    }
    with open(os.path.join(work_dir, 'state.json'), 'w', encoding='utf-8') as f:
        json.dump(state, f, ensure_ascii=False, indent=2)

    # 更新历史索引中的 updated_at
    history = list_user_works(username)
    for w in history:
        if w['work_id'] == work_id:
            w['updated_at'] = state['updated_at']
            break
    history.sort(key=lambda x: x.get('updated_at', ''), reverse=True)
    save_user_history(username, history)

    return jsonify({'success': True})


@app.route('/api/history', methods=['GET'])
@login_required
def history_list():
    """获取当前账号的所有作品列表"""
    username = session.get('username') or f'guest_{get_session_id()[:8]}'
    works = list_user_works(username)
    return jsonify({'success': True, 'works': works, 'username': username})


@app.route('/api/history/<work_id>', methods=['GET'])
@login_required
@work_id_required
def history_detail(work_id):
    """获取某个作品的完整数据（meta + state + 图片列表）"""
    username = session.get('username') or f'guest_{get_session_id()[:8]}'
    work_dir = own_work_dir(username, work_id)
    if not work_dir:
        return jsonify({'error': '作品ID不合法'}), 400
    if not os.path.isdir(work_dir):
        return jsonify({'error': '作品不存在'}), 404

    meta_path = os.path.join(work_dir, 'meta.json')
    state_path = os.path.join(work_dir, 'state.json')
    meta = {}
    state = {}
    if os.path.exists(meta_path):
        with open(meta_path, 'r', encoding='utf-8') as f:
            meta = json.load(f)
    if os.path.exists(state_path):
        with open(state_path, 'r', encoding='utf-8') as f:
            state = json.load(f)

    images_dir = os.path.join(work_dir, 'images')
    image_files = []
    # 字典: 文件名 stem (无后缀) -> 完整 URL
    image_by_stem = {}
    # 按写入顺序排列的人设图列表 (char_*.png)
    char_images = []
    # 整页图映射: pageIdx -> URL
    full_page_images_rebuilt = {}
    # 分镜图映射: "pageIdx-segIdx" -> URL
    seg_images_rebuilt = {}
    if os.path.isdir(images_dir):
        for fn in sorted(os.listdir(images_dir)):
            if fn.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')):
                rel = os.path.relpath(os.path.join(images_dir, fn), os.path.join(BASE_DIR, 'static'))
                url = '/static/' + rel.replace(os.sep, '/')
                image_files.append(url)
                stem = os.path.splitext(fn)[0]
                image_by_stem[stem] = url
                # 收集人设图 (char_*.png 模式), 用于按顺序匹配
                if stem.startswith('char_') or stem.startswith('character_'):
                    char_images.append(url)
                # 整页图: comic_page_<N>_full_*.png
                # 注意: 文件名里的 N 是 1-based page_num(用户在第 N 页触发时传 page.page_number),
                # 但前端 dict key 是 0-based page_idx(pages 数组下标), 必须 -1 转换
                # 否则历史作品加载后第 1 页显示第 2 页的图、最后一页永远空白
                elif stem.startswith('comic_page_') and '_full_' in stem:
                    parts = stem.split('_')
                    if len(parts) >= 3:
                        try:
                            page_num = int(parts[2])
                            page_idx = page_num - 1
                            full_page_images_rebuilt[page_idx] = url
                        except ValueError:
                            pass
                # 分镜图: comic_page_<N>_seg_<M>_*.png
                # 同理: LLM segment_number 也是 1-based, 前端 segIdx 是 0-based
                elif stem.startswith('comic_page_') and '_seg_' in stem:
                    parts = stem.split('_')
                    if len(parts) >= 5:
                        try:
                            page_num = int(parts[2])
                            seg_num = int(parts[4])
                            page_idx = page_num - 1
                            seg_idx = seg_num - 1
                            seg_images_rebuilt[f'{page_idx}-{seg_idx}'] = url
                        except ValueError:
                            pass

    # 容错: 老数据 / 早期数据可能没有完整字段, 补齐默认值
    state.setdefault('novel_text', '')
    state.setdefault('segments', {'pages': []})
    state.setdefault('characters', [])
    state.setdefault('generated_images', {})
    state.setdefault('full_page_images', {})
    state.setdefault('combined_page_images', {})

    # 从磁盘重建图片 URL 映射; 同时校验 state 中已有的 URL, 文件不存在的用磁盘版本兜底
    # 策略: 以磁盘为准, state 中已存在且文件真实存在的 URL 优先保留(可能是用户手动编辑过的路径)
    # 这样既能修复 state 为空 / 老数据 state.json 缺失的情况, 也能兜底文件丢失导致的 404
    # 关键: disk_rebuilt 的 key 是 int (page_idx), state JSON 反序列化后 key 是 str
    # 必须统一类型, 否则合并会同时存在 int(0) 和 str("0") 两个 entry (前端取不到)
    disk_fpi = full_page_images_rebuilt
    state_fpi = state.get('full_page_images') or {}
    merged_fpi = dict(disk_fpi)
    for k, url in state_fpi.items():
        abs_path = _local_image_abs_path(url)
        if abs_path and os.path.exists(abs_path):
            # 尝试统一为 int key (full_page_images 语义就是 int page_idx)
            try:
                k_norm = int(k)
            except (ValueError, TypeError):
                k_norm = k
            merged_fpi[k_norm] = url
    state['full_page_images'] = merged_fpi

    disk_seg = seg_images_rebuilt
    state_seg = state.get('generated_images') or {}
    merged_seg = dict(disk_seg)
    for k, url in state_seg.items():
        abs_path = _local_image_abs_path(url)
        if abs_path and os.path.exists(abs_path):
            # generated_images 用 "pageIdx-segIdx" 字符串 key, 保持原样
            merged_seg[k] = url
    state['generated_images'] = merged_seg

    # 重建角色人设图 image_url:
    # 1. data: / http(s) URL: 直接保留 (用户上传或外链, 文件不在本地 images_dir 也无需重建)
    # 2. /static/... 路径且对应文件存在: 保留
    # 3. /static/... 路径但文件丢失: 清空, 后续从磁盘 char_*.png 重新分配
    # 4. 完全没 image_url 的角色, 按 images_dir 中 char_*.png 顺序补齐
    chars = state.get('characters', [])
    image_file_basenames = {os.path.basename(u) for u in image_files}
    for char in chars:
        url = char.get('image_url', '') or ''
        if not url:
            continue  # 后面重新分配
        if url.startswith('data:') or url.startswith('http'):
            continue  # 用户上传 / 外链, 不动
        if url.startswith('/static/'):
            if os.path.basename(url) in image_file_basenames:
                continue
            # 文件丢失, 清空, 后面重新分配
        char['image_url'] = ''

    # 按顺序把 char_images 分配给没图片的角色
    unassigned_chars = [c for c in chars if not c.get('image_url')]
    for i, char in enumerate(unassigned_chars):
        if i < len(char_images):
            char['image_url'] = char_images[i]
        # 超出 char_images 数量的角色保持空 image_url

    return jsonify({
        'success': True,
        'work_id': work_id,
        'meta': meta,
        'state': state,
        'images': image_files,
    })


@app.route('/api/history/<work_id>/load', methods=['POST'])
@login_required
@work_id_required
def history_load(work_id):
    """加载历史作品到当前会话"""
    username = session.get('username') or f'guest_{get_session_id()[:8]}'
    work_dir = own_work_dir(username, work_id)
    if not work_dir:
        return jsonify({'error': '作品ID不合法'}), 400
    if not os.path.isdir(work_dir):
        return jsonify({'error': '作品不存在'}), 404

    session['work_id'] = work_id
    session['work_username'] = username

    meta_path = os.path.join(work_dir, 'meta.json')
    if os.path.exists(meta_path):
        with open(meta_path, 'r', encoding='utf-8') as f:
            meta = json.load(f)
        session['work_title'] = meta.get('title', '')

    state_path = os.path.join(work_dir, 'state.json')
    if os.path.exists(state_path):
        with open(state_path, 'r', encoding='utf-8') as f:
            state = json.load(f)
        return jsonify({
            'success': True,
            'work_id': work_id,
            'title': meta.get('title', ''),
            'state': state,
        })
    return jsonify({'success': True, 'work_id': work_id, 'title': meta.get('title', ''), 'state': {}})


@app.route('/api/history/<work_id>', methods=['DELETE'])
@login_required
@work_id_required
def history_delete(work_id):
    """删除一个作品"""
    username = session.get('username') or f'guest_{get_session_id()[:8]}'
    work_dir = own_work_dir(username, work_id)
    if not work_dir:
        return jsonify({'error': '作品ID不合法'}), 400
    # 目录不存在说明这本作品不属于当前用户 (或已被删过). 必须回 404:
    # 以前这里是无条件返回 success, 别人传一个 work_id 就能得到"删除成功"的
    # 假回执, 既误导调用方又让人以为这接口真的校验了归属.
    if not os.path.isdir(work_dir):
        return jsonify({'error': '作品不存在'}), 404
    shutil.rmtree(work_dir)

    history = [w for w in list_user_works(username) if w['work_id'] != work_id]
    save_user_history(username, history)

    if session.get('work_id') == work_id:
        session.pop('work_id', None)
        session.pop('work_username', None)
        session.pop('work_title', None)

    return jsonify({'success': True})


@app.route('/api/history/<work_id>/rename', methods=['POST'])
@login_required
@work_id_required
def history_rename(work_id):
    """重命名作品"""
    username = session.get('username') or f'guest_{get_session_id()[:8]}'
    data = request.json or {}
    new_title = data.get('title', '').strip()
    if not new_title:
        return jsonify({'error': '标题不能为空'}), 400

    work_dir = own_work_dir(username, work_id)
    if not work_dir:
        return jsonify({'error': '作品ID不合法'}), 400
    if not os.path.isdir(work_dir):
        return jsonify({'error': '作品不存在'}), 404

    meta_path = os.path.join(work_dir, 'meta.json')
    meta = {}
    if os.path.exists(meta_path):
        with open(meta_path, 'r', encoding='utf-8') as f:
            meta = json.load(f)
    meta['title'] = new_title
    meta['updated_at'] = datetime.now().isoformat()
    with open(meta_path, 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    history = list_user_works(username)
    for w in history:
        if w['work_id'] == work_id:
            w['title'] = new_title
            w['updated_at'] = meta['updated_at']
            break
    save_user_history(username, history)

    if session.get('work_id') == work_id:
        session['work_title'] = new_title

    return jsonify({'success': True, 'title': new_title})


# ========== 作品可见性 (公开/私密) + 搜索他人公开作品 ==========
# 数据模型: meta.json 和 history.json 条目上都有 is_public 布尔字段.
#   缺省 / False = 私密. 存量 36 个作品都没有这个字段, 因此天然保持私密, 无需迁移.
# 读权限的唯一判据是 _can_read_user_file(); 它同时被 /static 图片路由和
# /api/download 共用, 保证"网页上看得到"和"图片能下载"两条路永远一致 ——


def _set_work_visibility(username, work_id, is_public):
    """同步写 meta.json 与 history.json 索引, 并清可见性缓存.

    两处必须一起改: _is_work_public() 读的是 meta.json, 而搜索/列表读的是
    history.json; 只改一处会导致"开关显示已公开但搜不到"之类的漂移.
    """
    meta = _read_work_meta(username, work_id) or {}
    meta['is_public'] = bool(is_public)
    meta['updated_at'] = datetime.now().isoformat()
    work_dir = own_work_dir(username, work_id)
    if not work_dir:
        return False
    tmp = os.path.join(work_dir, 'meta.json.tmp')
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    os.replace(tmp, os.path.join(work_dir, 'meta.json'))

    history = list_user_works(username)
    for w in history:
        if w.get('work_id') == work_id:
            w['is_public'] = bool(is_public)
            break
    save_user_history(username, history)
    _invalidate_visibility(username, work_id)
    return True


@app.route('/api/history/<work_id>/visibility', methods=['POST'])
@login_required
@work_id_required
def history_visibility(work_id):
    """切换我自己的某个作品是公开还是私密.

    owner 只从 session 取 —— 传任何 username/work_id 参数都无法影响他人作品.
    """
    username = session.get('username')
    work_dir = own_work_dir(username, work_id)
    if not work_dir or not os.path.isdir(work_dir):
        return jsonify({'error': '作品不存在'}), 404

    data = request.json or {}
    if 'is_public' in data:
        is_public = bool(data.get('is_public'))
    else:
        # 不传则取反 (前端点一下开关的语义)
        is_public = not _is_work_public(username, work_id)

    if not _set_work_visibility(username, work_id, is_public):
        return jsonify({'error': '设置失败'}), 500
    return jsonify({'success': True, 'work_id': work_id, 'is_public': is_public})


def _iter_public_works():
    """遍历全站所有**已公开**的作品, 产出 {owner, work_id, title, created_at, updated_at}.

    以每个作品的 meta.json 为准 (和 _is_work_public 读的是同一份),
    而不是 history.json 索引 —— 索引可能过期或损坏, 而可见性是隐私属性,
    必须只有一个真相来源, 否则会出现"开关显示公开但搜不到"这类静默漂移.

    直接扫目录而不是维护一份全局索引文件: 当前规模 (十几个账号 / 几十个作品)
    下完全够用, 换来的是"不存在索引与实体不一致"这一整类 bug.
    guest_ 前缀是未登录会话产生的虚拟账号, 不参与搜索.
    """
    try:
        owners = os.listdir(USER_DATA_DIR)
    except OSError:
        return
    for owner in owners:
        if owner.startswith('guest_') or not _is_valid_username(owner):
            continue
        works_root = os.path.join(USER_DATA_DIR, owner, 'works')
        if not os.path.isdir(works_root):
            continue
        try:
            work_ids = os.listdir(works_root)
        except OSError:
            continue
        for wid in work_ids:
            if not _is_valid_work_id(wid):
                continue
            if not _is_work_public(owner, wid):
                continue
            meta = _read_work_meta(owner, wid) or {}
            yield {
                'owner': owner,
                'work_id': wid,
                'title': meta.get('title', ''),
                'created_at': meta.get('created_at', ''),
                'updated_at': meta.get('updated_at', ''),
            }


@app.route('/api/discover', methods=['GET'])
@login_required
def discover():
    """搜索他人公开作品: 账号名 或 作品标题.

    只返回 is_public 的条目; 自己公开的作品也会出现在结果里 (方便确认"我公开了什么").
    """
    q = (request.args.get('q') or '').strip()
    limit = min(int(request.args.get('limit') or 60), 200)
    try:
        limit = max(1, limit)
    except (TypeError, ValueError):
        limit = 60

    q_lower = q.lower()
    results = []
    accounts = set()
    for item in _iter_public_works():
        if q_lower:
            hit_user = q_lower in item['owner'].lower()
            hit_title = q_lower in (item['title'] or '').lower()
            if not (hit_user or hit_title):
                continue
            if hit_user:
                accounts.add(item['owner'])
        results.append(item)

    # 排序: 先按更新时间倒序, 再用稳定排序把"账号命中"的作品提到前面.
    # 用户搜"人"时最想要的是该人的最新作品, 搜"标题"时按时间看即可.
    results.sort(key=lambda w: w.get('updated_at') or '', reverse=True)
    if q_lower:
        results.sort(key=lambda w: 0 if q_lower in w['owner'].lower() else 1)

    truncated = len(results) > limit
    return jsonify({
        'success': True,
        'query': q,
        'total': len(results),
        'truncated': truncated,      # 让前端能提示"还有更多", 不静默截断
        'accounts': sorted(accounts),
        'works': results[:limit],
    })


def _public_work_payload(owner, work_id):
    """构造公开作品的只读载荷: **只含 meta + 图片列表, 绝不含 state**.

    state.json 里有 novel_text (小说正文) 以及气泡坐标等编辑数据.
    用户"公开作品"的语义是分享生成的漫画图, 不是公开自己写的原文,
    所以这里刻意不返回 state —— 否则等于把原文也发了出去.
    """
    work_dir = own_work_dir(owner, work_id)
    if not work_dir or not os.path.isdir(work_dir):
        return None
    if not _is_work_public(owner, work_id):
        return None

    meta = _read_work_meta(owner, work_id) or {}
    images_dir = os.path.join(work_dir, 'images')
    images = []
    cover = None
    if os.path.isdir(images_dir):
        for fn in sorted(os.listdir(images_dir)):
            if os.path.splitext(fn)[1].lower() not in _IMAGE_EXTS:
                continue
            url = f'/static/users/{owner}/works/{work_id}/images/{fn}'
            images.append(url)
            # 优先用整页图做封面 (comic_page_*_full_*) 排版上更像成品
            if cover is None or (fn.startswith('comic_page_') and '_full_' in fn):
                cover = url

    return {
        'owner': owner,
        'work_id': work_id,
        'title': meta.get('title', ''),
        'created_at': meta.get('created_at', ''),
        'updated_at': meta.get('updated_at', ''),
        'cover': cover,
        'images': images,
        'image_count': len(images),
    }


@app.route('/api/public/work/<owner>/<work_id>', methods=['GET'])
@login_required
def public_work_detail(owner, work_id):
    """只读查看他人公开作品 (封面 + 图片墙). 非公开一律 404, 不区分"不存在"和"无权限"."""
    if not _is_valid_username(owner) or not _is_valid_work_id(work_id):
        return jsonify({'error': '作品不存在'}), 404
    payload = _public_work_payload(owner, work_id)
    if not payload:
        return jsonify({'error': '作品不存在或未公开'}), 404
    return jsonify({'success': True, 'work': payload})


@app.route('/api/public/work/<owner>/<work_id>/fork', methods=['POST'])
@login_required
def public_work_fork(owner, work_id):
    """把他人公开作品「另存为我的作品」: 深拷贝到我自己账号下, 默认私密.

    必须真拷贝图片而不是引用对方路径 —— 否则原主人把作品改回私密,
    我这份"副本"就会跟着失效, 也会让权限判断出现两个主人.
    """
    if not _is_valid_username(owner) or not _is_valid_work_id(work_id):
        return jsonify({'error': '作品不存在'}), 404
    payload = _public_work_payload(owner, work_id)
    if not payload:
        return jsonify({'error': '作品不存在或未公开'}), 404

    username = session.get('username')
    new_work_id = str(uuid.uuid4())
    new_dir = get_work_dir(username, new_work_id)

    # 1) 复制图片: 对方 images/ -> 我的 images/ (公开作品的图必然可读)
    src_images = os.path.join(own_work_dir(owner, work_id), 'images')
    name_map = {}
    if os.path.isdir(src_images):
        for fn in os.listdir(src_images):
            if os.path.splitext(fn)[1].lower() not in _IMAGE_EXTS:
                continue
            src = os.path.join(src_images, fn)
            if not os.path.isfile(src):
                continue
            # 加新 work_id 前缀避免同名冲突
            dst_name = f'{new_work_id}_{fn}'
            try:
                shutil.copy2(src, os.path.join(new_dir, 'images', dst_name))
                name_map[fn] = dst_name
            except OSError as e:
                print(f"[fork] copy image failed {fn}: {e}")

    def _remap(url):
        """把 /static/users/<owner>/works/<work_id>/images/<fn> 改写成我的路径"""
        if not isinstance(url, str) or not url.startswith('/static/'):
            return url
        base = f'/static/users/{owner}/works/{work_id}/images/'
        if not url.startswith(base):
            return url
        fn = url[len(base):]
        dst = name_map.get(os.path.basename(fn))
        if not dst:
            return url
        return f'/static/users/{username}/works/{new_work_id}/images/{dst}'

    # 2) 复制 state 并把所有图片 URL 指向我的副本
    state = {}
    src_state = os.path.join(own_work_dir(owner, work_id), 'state.json')
    if os.path.isfile(src_state):
        try:
            with open(src_state, 'r', encoding='utf-8') as f:
                state = json.load(f)
        except (OSError, ValueError) as e:
            print(f"[fork] read state failed: {e}")
            state = {}

    def _remap_deep(obj):
        if isinstance(obj, dict):
            for k, v in list(obj.items()):
                if isinstance(v, str):
                    obj[k] = _remap(v)
                else:
                    _remap_deep(v)
        elif isinstance(obj, list):
            for i, v in enumerate(obj):
                if isinstance(v, str):
                    obj[i] = _remap(v)
                else:
                    _remap_deep(v)

    _remap_deep(state)
    state['updated_at'] = datetime.now().isoformat()
    with open(os.path.join(new_dir, 'state.json'), 'w', encoding='utf-8') as f:
        json.dump(state, f, ensure_ascii=False, indent=2)

    # 3) 写 meta + 索引. 副本一律**私密** —— 复制别人的东西不该顺手替他公开
    title = f"{payload['title']} (副本)" if payload['title'] else '副本作品'
    now = datetime.now().isoformat()
    meta = {
        'work_id': new_work_id,
        'title': title,
        'created_at': now,
        'updated_at': now,
        'is_public': False,
        'forked_from': {'owner': owner, 'work_id': work_id},
    }
    with open(os.path.join(new_dir, 'meta.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    history = list_user_works(username)
    history.insert(0, {
        'work_id': new_work_id,
        'title': title,
        'created_at': now,
        'updated_at': now,
        'is_public': False,
    })
    save_user_history(username, history)

    return jsonify({
        'success': True,
        'work_id': new_work_id,
        'title': title,
        'image_count': len(name_map),
    })

@app.route('/api/work/rename-current', methods=['POST'])
@login_required
def rename_current_work():
    """重命名当前绑定的作品 (用于自动保存时自动命名)"""
    work_id, username = get_current_work_id()
    if not work_id:
        return jsonify({'error': '当前没有绑定的作品'}), 400

    data = request.json or {}
    new_title = (data.get('title') or '').strip()
    if not new_title:
        return jsonify({'error': '标题不能为空'}), 400

    work_dir = own_work_dir(username, work_id)
    if not work_dir:
        return jsonify({'error': '作品ID不合法'}), 400
    if not os.path.isdir(work_dir):
        return jsonify({'error': '作品不存在'}), 404

    meta_path = os.path.join(work_dir, 'meta.json')
    meta = {}
    if os.path.exists(meta_path):
        with open(meta_path, 'r', encoding='utf-8') as f:
            meta = json.load(f)
    meta['title'] = new_title
    meta['updated_at'] = datetime.now().isoformat()
    with open(meta_path, 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    history = list_user_works(username)
    for w in history:
        if w['work_id'] == work_id:
            w['title'] = new_title
            w['updated_at'] = meta['updated_at']
            break
    save_user_history(username, history)
    session['work_title'] = new_title

    return jsonify({'success': True, 'title': new_title, 'work_id': work_id})
