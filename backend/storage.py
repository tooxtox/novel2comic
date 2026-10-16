"""Accounts, work files, sessions, reference images and file access checks."""

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import threading
import time
import uuid
from .ai_client import _api_request
from .runtime import (
    ADMIN_USERNAME,
    BASE_DIR,
    CACHE_DIR,
    CACHE_EXPIRE_DAYS,
    OUTPUT_DIR,
    RESULTS_DIR,
    USERS_FILE,
    USER_DATA_DIR,
    _RESOURCE_DIR,
)
from PIL import Image
from datetime import datetime
from flask import has_request_context, request, session
from io import BytesIO


def _hash_password(password: str, salt: str = '') -> tuple:
    """用 sha256 + salt 哈希密码。返回 (hash, salt)。salt 为空时自动生成。"""
    if not salt:
        salt = secrets.token_hex(16)
    h = hashlib.sha256((salt + password).encode('utf-8')).hexdigest()
    return h, salt


def _verify_password(password: str, stored_hash: str, salt: str) -> bool:
    h, _ = _hash_password(password, salt)
    return hmac.compare_digest(h, stored_hash)


def load_users() -> dict:
    """读取已注册用户 {username: {password_hash, salt, created_at}}"""
    if not os.path.exists(USERS_FILE):
        return {}
    try:
        with open(USERS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"[users] failed to load users.json: {e}")
        return {}


def save_users(users: dict) -> None:
    """保存用户列表到 users.json (仅 0600 权限)"""
    tmp = USERS_FILE + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(users, f, ensure_ascii=False, indent=2)
    os.replace(tmp, USERS_FILE)
    try:
        os.chmod(USERS_FILE, 0o600)
    except Exception:
        pass  # Windows 上 chmod 限制

# ========== 访问控制: 路径包含性 + 作品可见性 ==========
# 背景: /static 路由原本用 os.path.join(base,'static',filename) 直接拼路径,
# 没有 realpath 包含性检查, 导致 GET /static/../.env 匿名即可读到
# MANGA_SECRET_KEY 和 admin 密码 —— 拿到密钥就能伪造任意用户的 session,
# 于是任何"私密"保证都从根上失效. 下面这套 helper 是所有文件读取路径的唯一收口点.
#
# 规则 (fail-closed):
#   1. 任何 <base>/static 下的文件读取都必须先过 _safe_static_realpath
#   2. 任何属于某个作品的文件, 还必须过 _can_read_user_file
#   3. 读不到 / 不合法 一律按"不存在"处理 (404), 不返回 403, 避免泄露"存在但无权限"

# static 路由允许直接对外提供的扩展名 (前端资源)
_STATIC_PUBLIC_EXTS = frozenset({
    '.css', '.js', '.map', '.svg', '.woff2', '.woff', '.ttf', '.ico',
    '.png', '.jpg', '.jpeg', '.webp', '.gif', '.webmanifest',
})
# 用户作品目录里, 只有图片可以直接经 /static 提供;
# history.json / meta.json / state.json 一律不走 static, 只能经 API 且过权限校验
_IMAGE_EXTS = frozenset({'.png', '.jpg', '.jpeg', '.webp', '.gif'})

_WORK_ID_RE = re.compile(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.I)
# 用户名规则与 register 路由保持一致 (中英文/数字/下划线/连字符, 2-32)
_USERNAME_RE = re.compile(r'^[A-Za-z0-9_\-一-龥]{2,32}$')

# meta.json 可见性查询缓存: (username, work_id) -> (expires_monotonic, is_public)
# 图片墙一次会并发几十个图片请求, 每次都读盘太浪费; 5s 足够, 且切公开/私密后
# 最多 5 秒生效 —— 对"我刚点了公开, 结果对方 5 秒后才看到"这种场景完全够用.
_visibility_cache = {}
_visibility_cache_lock = threading.Lock()
_VISIBILITY_TTL = 5.0


def _is_valid_work_id(work_id):
    """work_id 必须是严格 UUID —— 挡掉 '../../victim/works/w1' 这类穿越."""
    return bool(work_id) and bool(_WORK_ID_RE.match(str(work_id)))


def _is_valid_username(username):
    return bool(username) and bool(_USERNAME_RE.match(str(username)))


def _safe_static_realpath(root_dir, url_path):
    """把 URL 里的相对路径安全地解析到 root_dir 之内, 越界/穿越一律返回 None.

    root_dir 应当是 <base>/static 这样的根目录. 双重防护:
      1. 显式拒绝任何 '..' 片段 (realpath 归一化后可能恰好抵消回根内, 语义上不该放行)
      2. realpath 归一化后必须仍位于 realpath(root_dir) 之内 (防软链/绝对路径/编码绕过)
    """
    if not url_path:
        return None
    rel = str(url_path).lstrip('/').replace('\\', '/')
    if not rel or '..' in rel.split('/'):
        return None
    if '\x00' in rel:
        return None
    try:
        root_real = os.path.realpath(root_dir)
        candidate = os.path.realpath(os.path.join(root_real, rel))
    except (OSError, ValueError):
        return None
    # candidate 必须等于 root 或以 root + os.sep 开头 (加 os.sep 防 /static-evil 误判)
    if candidate != root_real and not candidate.startswith(root_real + os.sep):
        return None
    return candidate


def _read_work_meta(username, work_id):
    """读某个作品的 meta.json; 非法 id / 读不到 一律返回 None."""
    if not _is_valid_work_id(work_id) or not _is_valid_username(username):
        return None
    meta_path = os.path.join(USER_DATA_DIR, username, 'works', work_id, 'meta.json')
    try:
        real = os.path.realpath(meta_path)
        works_root = os.path.realpath(os.path.join(USER_DATA_DIR, username, 'works'))
        if not real.startswith(works_root + os.sep):
            return None
        if not os.path.isfile(real):
            return None
        with open(real, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except (OSError, ValueError) as e:
        print(f"[auth] read meta failed for {username}/{work_id}: {e}")
        return None


def _is_work_public(username, work_id):
    """该作品是否公开. 读不到 meta 时按"私密"处理 (fail-closed). 带 5s 缓存."""
    if not _is_valid_work_id(work_id) or not _is_valid_username(username):
        return False
    key = (username, str(work_id))
    now = time.monotonic()
    with _visibility_cache_lock:
        hit = _visibility_cache.get(key)
        if hit and hit[0] > now:
            return hit[1]
    meta = _read_work_meta(username, work_id)
    value = bool(meta.get('is_public')) if meta else False
    with _visibility_cache_lock:
        if len(_visibility_cache) > 4096:  # 防止长时间运行无限增长
            _visibility_cache.clear()
        _visibility_cache[key] = (now + _VISIBILITY_TTL, value)
    return value


def _can_read_user_file(username, work_id, caller):
    """调用者能否经 /static 读取 <username>/<work_id> 下的文件.

    caller 为 None 表示未登录. 仅两种情况放行:
      - caller == username (本人) —— 已登录, 且 username 来自 session 而非请求参数
      - 该作品 is_public 为真 (任何人可看公开作品)
    """
    if not _is_valid_work_id(work_id) or not _is_valid_username(username):
        return False
    if caller and caller == username:
        return True
    return _is_work_public(username, work_id)


def _invalidate_visibility(username=None, work_id=None):
    """切换公开/私密后清缓存, 保证立刻生效."""
    with _visibility_cache_lock:
        if username is None:
            _visibility_cache.clear()
            return
        for key in [k for k in _visibility_cache
                    if k[0] == username and (work_id is None or k[1] == str(work_id))]:
            _visibility_cache.pop(key, None)


def _current_caller():
    """当前调用者用户名; 不在请求上下文里 (后台线程) 一律 None."""
    try:
        if not has_request_context():
            return None
        return session.get('username') if session.get('logged_in') else None
    except Exception:
        return None


def _resolve_readable_static(url):
    """把 '/static/xxx' URL 解析成本地**可读**的绝对路径; 不可读返回 None.

    这是所有 "URL → 磁盘路径" 的唯一收口点. 之前有四处各写一遍
    os.path.join(BASE_DIR, url.lstrip('/')), 任意一处都能读遍服务器:
      - /static/<path> 路由本身
      - /api/download 的 /static 分支
      - cache_reference_image / get_cached_image_base64
      - _relocate_image (把别人私密图复制进自己目录 = 洗白原语)

    规则与 static 路由一致: 扩展名白名单 → realpath 包含性 → users/ 可见性.
    """
    if not url or not isinstance(url, str) or not url.startswith('/static/'):
        return None
    rel = url[len('/static/'):].replace('\\', '/')
    ext = os.path.splitext(rel)[1].lower()
    if ext not in _STATIC_PUBLIC_EXTS:
        return None

    caller = _current_caller()
    for base in (_RESOURCE_DIR, BASE_DIR):
        candidate = _safe_static_realpath(os.path.join(base, 'static'), rel)
        if not candidate or not os.path.isfile(candidate):
            continue
        # users/ 子树: 只放行图片, 且需要"本人 或 该作品已公开"
        parts = rel.split('/')
        if len(parts) >= 3 and parts[0] == 'users':
            if ext not in _IMAGE_EXTS:
                return None
            if len(parts) >= 4 and parts[2] == 'works' and _is_valid_work_id(parts[3]):
                if not _can_read_user_file(parts[1], parts[3], caller):
                    return None
            elif not (caller and caller == parts[1]):
                return None
        return candidate
    return None


def get_user_dir(username):
    """获取用户账号目录，不存在则创建"""
    if not _is_valid_username(username):
        raise ValueError('非法用户名')
    user_dir = os.path.join(USER_DATA_DIR, username)
    os.makedirs(user_dir, exist_ok=True)
    os.makedirs(os.path.join(user_dir, 'works'), exist_ok=True)
    return user_dir


def get_work_dir(username, work_id):
    """获取单个作品目录 (不存在则创建)"""
    # work_id 必须是严格 UUID: 否则 '../../别的账号/works/xxx' 会被 join 进去,
    # 造成跨账号读写 (实测: POST /api/work/save-state 传 work_id='../../victim/works/w1'
    # 会直接覆写 victim 的 state.json)
    if not _is_valid_work_id(work_id):
        raise ValueError('非法作品ID')
    work_dir = own_work_dir(username, work_id)
    if not work_dir:
        raise ValueError('非法作品路径')
    os.makedirs(work_dir, exist_ok=True)
    os.makedirs(os.path.join(work_dir, 'images'), exist_ok=True)
    return work_dir


def get_current_username():
    """当前请求的用户名 (唯一收口, 避免 8 处各写一遍 guest_ 回退)"""
    sid = get_session_id()
    return session.get('username') or f'guest_{sid[:8]}'


def resolve_own_work_id():
    """当前会话绑定的作品ID —— **只**认 session, 永不读请求体.

    任何"操作我自己的作品"的路径都必须用这个, 不能用 get_current_work_id():
    后者会接受请求体里的 work_id, 等于把跨账号写权限交给客户端.
    """
    return session.get('work_id')


def get_current_work_id():
    """获取当前会话绑定的作品ID（用户未显式创建时，使用session_id作为虚拟账号）

    兼容小程序前端: 它会在请求体里带 work_id (用于云存储路径).
    但该值来自客户端, 不可信 —— 所以这里必须做严格 UUID 校验,
    校验不过就忽略它, 回落到 session 里的值.
    """
    username = get_current_username()
    work_id = resolve_own_work_id()
    try:
        body = request.get_json(silent=True) or {}
        req_work_id = body.get('work_id')
        # 只有严格 UUID 才采信客户端传的 work_id
        if req_work_id and _is_valid_work_id(req_work_id):
            work_id = req_work_id
    except Exception:
        pass
    return work_id, username


def list_user_works(username):
    """列出用户的所有作品"""
    user_dir = get_user_dir(username)
    works_file = os.path.join(user_dir, 'history.json')
    if not os.path.exists(works_file):
        return []
    try:
        with open(works_file, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"List works error: {e}")
        return []


def save_user_history(username, history):
    """保存用户的历史索引 (原子写: tmp + os.replace)"""
    user_dir = get_user_dir(username)
    works_file = os.path.join(user_dir, 'history.json')
    tmp = works_file + '.tmp'
    try:
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(history, f, ensure_ascii=False, indent=2)
        os.replace(tmp, works_file)
    except Exception as e:
        print(f"Save history error: {e}")
        try:
            if os.path.exists(tmp):
                os.remove(tmp)
        except OSError:
            pass


# ========== AI 写作历史 (与漫画作品分开存储) ==========
# 每篇写作 = users/<username>/writings/<writing_id>.json
# 索引     = users/<username>/writings/writings_history.json

def _current_username():
    """当前登录用户名 (未注册会话用 guest_<sid> 兜底)"""
    return session.get('username') or f'guest_{get_session_id()[:8]}'


def get_writings_dir(username):
    """获取用户写作目录，不存在则创建"""
    d = os.path.join(USER_DATA_DIR, username, 'writings')
    os.makedirs(d, exist_ok=True)
    return d


def list_writings(username):
    """列出用户的写作历史索引 [{writing_id,title,created_at,updated_at,content_len}]"""
    idx = os.path.join(get_writings_dir(username), 'writings_history.json')
    if not os.path.exists(idx):
        return []
    try:
        with open(idx, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"List writings error: {e}")
        return []


def save_writings_history(username, history):
    """保存用户的写作历史索引"""
    idx = os.path.join(get_writings_dir(username), 'writings_history.json')
    tmp = idx + '.tmp'
    try:
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(history, f, ensure_ascii=False, indent=2)
        os.replace(tmp, idx)
    except Exception as e:
        print(f"Save writings history error: {e}")


def read_writing(username, writing_id):
    """读取一篇写作，不存在返回 None"""
    if not writing_id:
        return None
    path = os.path.join(get_writings_dir(username), f'{writing_id}.json')
    if not os.path.exists(path):
        return None
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"Read writing error: {e}")
        return None


def save_writing(username, writing_id, doc):
    """保存一篇写作 (原子写: tmp + os.replace)"""
    path = os.path.join(get_writings_dir(username), f'{writing_id}.json')
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)
    # 更新索引 (按 updated_at 倒序)
    history = [w for w in list_writings(username) if w.get('writing_id') != writing_id]
    history.insert(0, {
        'writing_id': writing_id,
        'title': doc.get('title', ''),
        'created_at': doc.get('created_at', ''),
        'updated_at': doc.get('updated_at', ''),
        'content_len': len(doc.get('content', '') or ''),
    })
    save_writings_history(username, history)


def delete_writing(username, writing_id):
    """删除一篇写作及索引项，返回是否成功"""
    if not writing_id:
        return False
    path = os.path.join(get_writings_dir(username), f'{writing_id}.json')
    removed = False
    try:
        if os.path.exists(path):
            os.remove(path)
            removed = True
    except Exception as e:
        print(f"Delete writing file error: {e}")
        return False
    history = [w for w in list_writings(username) if w.get('writing_id') != writing_id]
    save_writings_history(username, history)
    return removed


def migrate_legacy_output():
    """启动时将 static/output/ 中历史遗留图片迁移到管理员账号的"导入作品"下

    只迁移 OUTPUT_DIR 中文件名为时间戳格式（兼容本次会话前生成）的图片，
    已被会话引用过的（出现在 users/*/works/*/images/）保持原位不动。
    """
    try:
        username = ADMIN_USERNAME  # 历史作品统一归到管理员账号下
        user_dir = get_user_dir(username)
        existing = list_user_works(username)

        # 已存在名为"导入的历史作品"的跳过
        for w in existing:
            if w.get('title') == '导入的历史作品':
                return

        if not os.path.isdir(OUTPUT_DIR):
            return

        files = sorted([f for f in os.listdir(OUTPUT_DIR)
                        if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp'))])
        if not files:
            return

        # 创建导入作品
        work_id = str(uuid.uuid4())
        work_dir = get_work_dir(username, work_id)
        meta = {
            'work_id': work_id,
            'title': '导入的历史作品',
            'created_at': datetime.now().isoformat(),
            'updated_at': datetime.now().isoformat(),
            'imported': True,
        }
        with open(os.path.join(work_dir, 'meta.json'), 'w', encoding='utf-8') as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)

        # 复制图片到作品目录（不删除原文件，避免影响正在进行的会话）
        images_dir = os.path.join(work_dir, 'images')
        image_entries = []
        for fn in files:
            src = os.path.join(OUTPUT_DIR, fn)
            dst = os.path.join(images_dir, fn)
            try:
                shutil.copy2(src, dst)
            except Exception as e:
                print(f"Migrate copy failed for {fn}: {e}")
                continue
            image_entries.append({
                'filename': fn,
                'key': fn,
                'timestamp': datetime.fromtimestamp(
                    os.path.getmtime(src)
                ).isoformat()
            })

        # 简易 state.json（仅含图片清单）
        state = {
            'novel_text': '',
            'segments': {'pages': []},
            'characters': [],
            'generated_images': {},
            'full_page_images': {},
            'imported_files': image_entries,
            'updated_at': meta['updated_at'],
        }
        with open(os.path.join(work_dir, 'state.json'), 'w', encoding='utf-8') as f:
            json.dump(state, f, ensure_ascii=False, indent=2)

        # 写入历史索引（最前）
        history = list_user_works(username)
        history.insert(0, {
            'work_id': work_id,
            'title': meta['title'],
            'created_at': meta['created_at'],
            'updated_at': meta['updated_at'],
            'imported': True,
        })
        save_user_history(username, history)
        print(f"Migrated {len(image_entries)} legacy images to work '{meta['title']}' for user '{username}'")
    except Exception as e:
        import traceback
        print(f"Migrate legacy output error: {e}")
        print(traceback.format_exc())


def clean_cache():
    """清理超过7天的缓存文件"""
    try:
        now = time.time()
        expire_seconds = CACHE_EXPIRE_DAYS * 24 * 3600
        for filename in os.listdir(CACHE_DIR):
            filepath = os.path.join(CACHE_DIR, filename)
            if os.path.isfile(filepath):
                file_mtime = os.path.getmtime(filepath)
                if now - file_mtime > expire_seconds:
                    os.remove(filepath)
                    print(f"Cleaned expired cache: {filename}")
    except Exception as e:
        print(f"Cache cleanup error: {e}")


def get_session_id():
    """获取或创建当前会话的唯一ID"""
    if 'session_id' not in session:
        session['session_id'] = str(uuid.uuid4())
    return session['session_id']


def save_session_data(data_type, data):
    """将会话数据保存到 results/<sid>_<type>.json"""
    try:
        sid = get_session_id()
        filepath = os.path.join(RESULTS_DIR, f'{sid}_{data_type}.json')
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"Saved session data: {data_type}")
        return True
    except Exception as e:
        print(f"Save session data error ({data_type}): {e}")
        return False


def load_session_data(data_type):
    """从 results/ 加载会话数据，不存在时返回 None"""
    try:
        sid = get_session_id()
        filepath = os.path.join(RESULTS_DIR, f'{sid}_{data_type}.json')
        if os.path.exists(filepath):
            with open(filepath, 'r', encoding='utf-8') as f:
                return json.load(f)
    except Exception as e:
        print(f"Load session data error ({data_type}): {e}")
    return None


def cache_reference_image(url, name=""):
    """将参考图下载到缓存目录，返回本地URL路径"""
    if not url:
        return None

    try:
        # cloud:// fileID 没有配套的 resolve API — 直接放弃, 避免后续页面生成静默丢参考图
        if url.startswith('cloud://'):
            print(f"[cache-ref] skip cloud:// fileID for '{name}' (no resolve API); "
                  f"前端应使用 /static/ 本地路径")
            return None

        # 用URL的hash作为文件名，避免重复下载
        url_hash = hashlib.md5(url.encode()).hexdigest()[:12]

        # 探测已有缓存 (PIL 能识别的常见格式, 包括 jpeg/png/webp/gif/bmp/tiff)
        for probe_ext in _IMAGE_EXT_PROBE:
            cache_path = os.path.join(CACHE_DIR, f"{url_hash}{probe_ext}")
            if os.path.exists(cache_path):
                # 更新访问时间
                os.utime(cache_path, None)
                return f"/static/cache/{url_hash}{probe_ext}"

        # 下载图片
        img_data = None
        if url.startswith('http'):
            try:
                resp = _api_request('GET', url, timeout=30, retries=2)
                img_data = resp.content
            except Exception as e:
                print(f"[cache-ref] download failed: {e}")
                img_data = None
        elif url.startswith('/static'):
            local_path = _resolve_readable_static(url)
            if local_path:
                with open(local_path, 'rb') as f:
                    img_data = f.read()
        elif url.startswith('data:image'):
            # base64格式
            parts = url.split(',')
            if len(parts) == 2:
                img_data = base64.b64decode(parts[1])
        else:
            print(f"[cache-ref] unsupported url scheme for '{name}': {url[:40]}…")
            return None

        if img_data:
            # 用 PIL 实际字节探测格式 (mime 也按真实探测, 不靠 URL header)
            ext, mime = _detect_image_format(img_data)
            cache_path = os.path.join(CACHE_DIR, f"{url_hash}{ext}")
            with open(cache_path, 'wb') as f:
                f.write(img_data)

            print(f"Cached reference image for '{name}': /static/cache/{url_hash}{ext} ({mime})")
            return f"/static/cache/{url_hash}{ext}"

    except Exception as e:
        print(f"Cache reference image error for '{name}': {e}")

    return None


# PIL 能识别的常见图片扩展, 用于缓存命中探测
_IMAGE_EXT_PROBE = ('.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff')


def _detect_image_format(img_data):
    """探测图片真实格式, 返回 (扩展名, mime). 探测失败时返回 ('.png', 'image/png')."""
    try:
        img = Image.open(BytesIO(img_data))
        fmt = (img.format or 'PNG').lower()
        if fmt == 'jpeg':
            ext = '.jpg'
        elif fmt in ('tif', 'tiff'):
            ext = '.tif'
        else:
            ext = '.' + fmt
        mime = Image.MIME.get(img.format) or 'image/png'
        return ext, mime
    except Exception:
        return '.png', 'image/png'


def get_cached_image_base64(cache_url):
    """从缓存读取图片并转为base64"""
    if not cache_url:
        return None
    try:
        local_path = _resolve_readable_static(cache_url)
        if local_path:
            with open(local_path, 'rb') as f:
                img_data = f.read()
            # mime 按 PIL 实际探测 — 不靠扩展名, 防止 .jpg 文件里实际是 png 字节被错送
            _, detected_mime = _detect_image_format(img_data)
            img_b64 = base64.b64encode(img_data).decode('utf-8')
            return f"data:{detected_mime};base64,{img_b64}"
    except Exception as e:
        print(f"Read cached image error: {e}")
    return None


# 镜头语言中→英映射表 (任务2: 分页 prompt 升级)
# 用于把 LLM 输出的结构化字段值转换成图像生成模型可识别的英文 tag

def own_work_dir(username, work_id):
    """本账号下某个作品的目录; 非法 id / 越界 一律返回 None (fail-closed).

    注意这里刻意**不**用 get_work_dir: 那个会 makedirs 建目录,
    而查询类路由只想解析路径, 不该凭空造出目录.
    """
    if not _is_valid_work_id(work_id) or not _is_valid_username(username):
        return None
    try:
        works_root = os.path.realpath(os.path.join(USER_DATA_DIR, username, 'works'))
        candidate = os.path.realpath(os.path.join(works_root, work_id))
    except (OSError, ValueError):
        return None
    if candidate != works_root and not candidate.startswith(works_root + os.sep):
        return None
    return candidate

def _unique_filename(prefix, ext):
    """生成唯一文件名: prefix_yyyymmdd_HHMMSS_mmmmmm_<uuid6>.ext — 防止同秒内两次保存互相覆盖"""
    ts = datetime.now().strftime('%Y%m%d_%H%M%S_%f')
    return f"{prefix}_{ts}_{uuid.uuid4().hex[:6]}{ext}"


def save_image_result(image_url, prefix="manga", work_id=None, work_username=None):
    """将图片URL保存到本地，返回本地路径

    优先保存到用户作品目录(static/users/<username>/works/<work_id>/images/),
    未传 work_id 时回退到临时目录 static/output。
    """
    if not image_url:
        return None, {'error': '无法获取图片'}

    if work_id and work_username:
        images_dir = os.path.join(get_work_dir(work_username, work_id), 'images')
    else:
        images_dir = OUTPUT_DIR

    if image_url.startswith('http'):
        # 内网穿透场景：主机先下载外部图片到本地，再返回本地路径给用户
        try:
            filename = _unique_filename(prefix, '.png')
            filepath = os.path.join(images_dir, filename)

            img_response = _api_request('GET', image_url, timeout=120)

            with open(filepath, 'wb') as f:
                f.write(img_response.content)

            # 返回以 /static/ 为前缀的URL
            rel_path = os.path.relpath(filepath, os.path.join(BASE_DIR, 'static'))
            local_url = '/static/' + rel_path.replace(os.sep, '/')
            print(f"Saved to work dir: {local_url}")
            return local_url, None
        except Exception as e:
            print(f"Failed to download external image: {e}")
            # 下载失败: 返回 (None, error) 让调用方走重试, 不要把过期 CDN URL 漏给前端
            return None, {'error': f'下载外部图片失败: {e}'}

    # base64数据保存到本地
    if image_url.startswith('data:image') or len(image_url) > 1000:
        filename = _unique_filename(prefix, '.png')
        filepath = os.path.join(images_dir, filename)

        if image_url.startswith('data:image'):
            image_data = image_url.split(',')[1]
        else:
            image_data = image_url

        with open(filepath, 'wb') as f:
            f.write(base64.b64decode(image_data))

        rel_path = os.path.relpath(filepath, os.path.join(BASE_DIR, 'static'))
        local_url = '/static/' + rel_path.replace(os.sep, '/')
        return local_url, None

    return None, {'error': '无法获取图片'}


def upload_to_cloud_storage(local_url, work_id=None, prefix="manga"):
    """把本地 /static/... 图片上传到云存储, 返回 cloud:// fileID。

    调用 uploadImage 云函数 HTTP 触发 URL (env CLOUDBASE_UPLOAD_IMAGE_URL)。
    失败返回 None (不影响主流程, 调用方回退返回本地 URL)。
    """
    try:
        url = os.environ.get('CLOUDBASE_UPLOAD_IMAGE_URL', '')
        if not url:
            return None
        abs_path = _local_image_abs_path(local_url)
        if not abs_path or not os.path.exists(abs_path):
            return None
        with open(abs_path, 'rb') as f:
            b64 = base64.b64encode(f.read()).decode('ascii')
        filename = os.path.basename(abs_path)
        wid = work_id or 'unknown'
        cloud_path = f'works/{wid}/images/{prefix}_{filename}'
        resp = _api_request('POST', url, json={'cloudPath': cloud_path, 'base64': b64}, timeout=120)
        data = resp.json()
        if data and data.get('code') == 0 and data.get('data'):
            file_id = data['data'].get('fileID')
            print(f"[CloudUpload] uploaded {local_url} -> {file_id}")
            return file_id
        print(f"[CloudUpload] unexpected resp: {data}")
        return None
    except Exception as e:
        print(f"[CloudUpload] failed for {local_url}: {e}")
        return None


def prepare_ref_images(character_references, previous_page_image=None):
    """准备参考图片：缓存到本地，返回base64列表"""
    ref_images = []

    # 1. 角色人设图
    if character_references and len(character_references) > 0:
        for char in character_references:
            img_url = char.get('image_url')
            name = char.get('name', '')
            if img_url:
                # 缓存到本地
                cache_url = cache_reference_image(img_url, name)
                if cache_url:
                    img_b64 = get_cached_image_base64(cache_url)
                    if img_b64:
                        ref_images.append(img_b64)
                        print(f"Loaded cached reference image for character '{name}'")
                    else:
                        print(f"Failed to read cached image for '{name}'")
                else:
                    print(f"Failed to cache reference image for '{name}'")

    # 2. 上一页漫画
    if previous_page_image:
        cache_url = cache_reference_image(previous_page_image, "previous_page")
        if cache_url:
            img_b64 = get_cached_image_base64(cache_url)
            if img_b64:
                ref_images.append(img_b64)
                print(f"Loaded cached previous page image")
            else:
                print(f"Failed to read cached previous page image")

    return ref_images

def _local_image_abs_path(local_url):
    """把 /static/xxx URL 转成本地绝对路径; 不合法 / 越界 / 无权访问 返回 None.

    这个函数被用在**写**路径上 (reposition_bubbles 会把气泡烘到 output_abs),
    以前是裸 os.path.join, 意味着一个登录用户可以传
    output_image_url=/static/users/<别人>/works/<私密id>/images/x.png
    直接覆写别人的私密作品. 现在统一走 _resolve_readable_static.

    注意: 不在请求上下文里 (后台线程, 没有 session) 时无法判断调用者身份,
    此时只做路径包含性检查, 放行权限判定 —— 这些都是内部流程,
    而跨账号攻击必然发生在有 session 的请求里, 所以不会因此漏掉.
    """
    if not local_url or not local_url.startswith('/static/'):
        return None
    resolved = _resolve_readable_static(local_url)
    if resolved:
        return resolved
    # _resolve_readable_static 拒绝的原因可能是"无权限"而不是"路径非法";
    # 无请求上下文时退回仅做包含性检查, 保证内部/后台流程不被误伤
    if not has_request_context():
        rel = local_url[len('/static/'):]
        if '..' in rel.replace('\\', '/').split('/'):
            return None
        return _safe_static_realpath(os.path.join(BASE_DIR, 'static'), rel)
    return None
