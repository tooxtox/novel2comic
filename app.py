from flask import Flask, render_template, request, jsonify, send_file, session
from flask_cors import CORS
from functools import wraps
import requests
import json
import os
import re
import sys

# Windows 中文控制台默认 GBK 编码, print emoji/特殊符号 (如提示词中的 ⚠️) 时会抛
# UnicodeEncodeError: 'gbk' codec can't encode character ...; 统一将标准输出/错误
# 流重配置为 UTF-8 (errors='replace' 兜底), 不支持重配置的环境 (如部分 Android) 跳过
for _stream_name in ("stdout", "stderr"):
    _stream = getattr(sys, _stream_name, None)
    try:
        if _stream is not None:
            _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
del _stream_name, _stream

import time
import hashlib
import hmac
import uuid
import secrets
import shutil
import socket
from datetime import datetime, timedelta
from io import BytesIO
import base64
import threading
# webbrowser 在 Android (Chaquopy) 上不可用; 仅非 Android 平台 import
_IS_ANDROID = hasattr(sys, 'getandroidapilevel')
if not _IS_ANDROID:
    import webbrowser
from PIL import Image, ImageDraw, ImageFont

# ========== 多平台兼容: Windows dev / PyInstaller / Android Chaquopy ==========
# 三个分支共享同一套 _RESOURCE_DIR (只读) 和 _PERSIST_DIR (可写) 命名.
# - dev: _RESOURCE_DIR = _PERSIST_DIR = 当前文件目录
# - PyInstaller: _RESOURCE_DIR = _MEIPASS (解压临时目录), _PERSIST_DIR = exe 所在目录
# - Android Chaquopy: _RESOURCE_DIR = __file__ 所在目录 (assets 解压后),
#                    _PERSIST_DIR = app 私有沙盒 getFilesDir() (无需权限, 重装丢失)
if _IS_ANDROID:
    _RESOURCE_DIR = os.path.dirname(os.path.abspath(__file__))
    try:
        from chaquopy.utils import get_files_dir
        _PERSIST_DIR = get_files_dir()
    except Exception:
        # 兜底: app 私有目录的常见路径 (老版本 Chaquopy / 自定义镜像)
        _PERSIST_DIR = '/data/data/com.text2comic.app/files'
elif getattr(sys, 'frozen', False):
    _RESOURCE_DIR = sys._MEIPASS  # 只读: templates / static / 字体
    _PERSIST_DIR = os.path.dirname(os.path.abspath(sys.executable))  # 可写: .env / users.json / 生成图
else:
    _RESOURCE_DIR = os.path.dirname(os.path.abspath(__file__))
    _PERSIST_DIR = _RESOURCE_DIR


def _ensure_android_fonts():
    """Android 首次启动: 把 assets/fonts/ 下的思源黑体复制到 _PERSIST_DIR/fonts/.
    _get_chinese_font() 的候选路径直接读 _PERSIST_DIR, 此处确保字体就位."""
    if not _IS_ANDROID:
        return
    target = os.path.join(_PERSIST_DIR, 'fonts')
    try:
        os.makedirs(target, exist_ok=True)
    except Exception:
        return
    for name in ('SourceHanSansSC-Regular.otf', 'SourceHanSansSC-Bold.otf'):
        dst = os.path.join(target, name)
        if os.path.isfile(dst):
            continue
        try:
            from chaquopy.utils import copy_asset
            copy_asset(f'fonts/{name}', dst)
        except Exception as e:
            print(f'[font] failed to copy {name}: {e}')

# ========== .env 加载 (python-dotenv 可选, 没装就用手写 mini 解析) ==========
ENV_FILE = os.path.join(_PERSIST_DIR, '.env')


def _parse_env_file(path):
    """
    最小 .env 解析器: key=value, 支持 '...' / "..." / 裸值, 忽略 # 注释.
    缺 python-dotenv 时使用.
    """
    out = {}
    if not os.path.isfile(path):
        return out
    with open(path, 'r', encoding='utf-8') as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith('#'):
                continue
            if '=' not in line:
                continue
            k, v = line.split('=', 1)
            k = k.strip()
            v = v.strip()
            # 去引号
            if len(v) >= 2 and v[0] == v[-1] and v[0] in ("'", '"'):
                v = v[1:-1]
            out[k] = v
    return out


def _set_env_file(path, key, value):
    """
    写一行 KEY=VALUE 到 .env, 已存在则替换.
    缺 python-dotenv 时使用.
    """
    lines = []
    found = False
    if os.path.isfile(path):
        with open(path, 'r', encoding='utf-8') as f:
            for raw in f:
                line = raw.rstrip('\n')
                stripped = line.strip()
                if not stripped.startswith('#') and '=' in stripped:
                    k = stripped.split('=', 1)[0].strip()
                    if k == key:
                        lines.append(f"{key}='{value}'")
                        found = True
                        continue
                lines.append(line)
    if not found:
        lines.append(f"{key}='{value}'")
    with open(path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')


try:
    from dotenv import load_dotenv as _load_dotenv, set_key as _set_key
    # python-dotenv 会把 .env 的值塞进 os.environ
    _load_dotenv(ENV_FILE)
except ImportError:
    print("[env] python-dotenv 未安装, 使用内置 .env 解析器")
    for k, v in _parse_env_file(ENV_FILE).items():
        os.environ.setdefault(k, v)

    def _set_key(path, key, value):
        os.environ[key] = value
        _set_env_file(path, key, value)


# 统一别名, 后面的逻辑只用这两个名字
def _ensure_env(key, generator, write_back=True):
    """
    从环境变量取 key, 不存在则用 generator() 生成,
    并写回 .env 持久化 (避免每次重启都重置).
    """
    val = os.environ.get(key)
    if not val:
        val = generator()
        os.environ[key] = val
        if write_back:
            try:
                _set_key(ENV_FILE, key, val)
            except Exception as e:
                print(f"[env] failed to persist {key} to .env: {e}")
    return val


# SECRET_KEY: 必须用 CSPRNG (secrets.token_urlsafe / os.urandom)
# 缺省时自动生成并写入 .env, 部署到公网前请确保 .env 不进 git
SECRET_KEY = _ensure_env('MANGA_SECRET_KEY', lambda: secrets.token_urlsafe(32))

# 管理员凭据: 缺省时生成随机密码并写入 .env, 不再硬编码在源码里
# 先记录是否本次自动生成, 用于启动时提示用户记住密码
_ADMIN_PASSWORD_JUST_GENERATED = 'MANGA_ADMIN_PASSWORD' not in os.environ
ADMIN_USERNAME = _ensure_env('MANGA_ADMIN_USERNAME', lambda: 'admin', write_back=False)
ADMIN_PASSWORD = _ensure_env('MANGA_ADMIN_PASSWORD', lambda: secrets.token_urlsafe(16))

app = Flask(__name__, static_folder=None, template_folder=os.path.join(_RESOURCE_DIR, 'templates'))
app.secret_key = SECRET_KEY
CORS(app, supports_credentials=True)

# WebSocket 已移除: 后端从未 emit 进度事件, 前端一律使用 fake progress
BASE_DIR = _PERSIST_DIR
CONFIG_LOCAL_PATH = os.path.join(BASE_DIR, 'config.local.json')
CONFIG_TEMPLATE_PATH = os.path.join(BASE_DIR, 'config.json')

# ========== PyInstaller 兼容: 自定义 static 路由, 兼顾内置资源和用户生成文件 ==========
# Flask 默认的 /static 只服务 static_folder (此处 _MEIPASS/static), 但生成图在 BASE_DIR/static.
# static_folder=None 时 Flask 不注册 'static' 端点, 这里用 endpoint='static' 补上,
# 使模板里的 url_for('static', filename=...) 能正确生成 URL.
@app.route('/static/<path:filename>', endpoint='static')
def _pyinstaller_static(filename):
    for base in (_RESOURCE_DIR, BASE_DIR):
        candidate = os.path.join(base, 'static', filename)
        if os.path.isfile(candidate):
            return send_file(candidate)
    from flask import abort
    abort(404)

OUTPUT_DIR = os.path.join(BASE_DIR, 'static', 'output')
os.makedirs(OUTPUT_DIR, exist_ok=True)

# 参考图缓存目录
CACHE_DIR = os.path.join(BASE_DIR, 'static', 'cache')
os.makedirs(CACHE_DIR, exist_ok=True)

# 会话结果持久化目录（内网穿透场景下，先由主机接收再传给用户）
RESULTS_DIR = os.path.join(BASE_DIR, 'results')
os.makedirs(RESULTS_DIR, exist_ok=True)

# 用户作品永久保存目录（账号维度）
USER_DATA_DIR = os.path.join(BASE_DIR, 'static', 'users')
os.makedirs(USER_DATA_DIR, exist_ok=True)

# 注册用户凭据文件 ( username → {password_hash, salt, created_at} )
# 与 admin 账号并存: admin 来自 .env, 普通用户来自此文件
USERS_FILE = os.path.join(BASE_DIR, 'users.json')


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

# 缓存有效期（7天）
CACHE_EXPIRE_DAYS = 7


def get_user_dir(username):
    """获取用户账号目录，不存在则创建"""
    user_dir = os.path.join(USER_DATA_DIR, username)
    os.makedirs(user_dir, exist_ok=True)
    os.makedirs(os.path.join(user_dir, 'works'), exist_ok=True)
    return user_dir


def get_work_dir(username, work_id):
    """获取单个作品目录"""
    work_dir = os.path.join(get_user_dir(username), 'works', work_id)
    os.makedirs(work_dir, exist_ok=True)
    os.makedirs(os.path.join(work_dir, 'images'), exist_ok=True)
    return work_dir


def get_current_work_id():
    """获取当前会话绑定的作品ID（用户未显式创建时，使用session_id作为虚拟账号）

    优先从请求体读 work_id (小程序前端会传, 用于云存储路径),
    其次用 session 中的 work_id。
    """
    sid = get_session_id()
    username = session.get('username') or f'guest_{sid[:8]}'
    work_id = session.get('work_id')
    try:
        body = request.get_json(silent=True) or {}
        req_work_id = body.get('work_id')
        if req_work_id:
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
    """保存用户的历史索引"""
    user_dir = get_user_dir(username)
    works_file = os.path.join(user_dir, 'history.json')
    try:
        with open(works_file, 'w', encoding='utf-8') as f:
            json.dump(history, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"Save history error: {e}")


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
            local_path = os.path.join(BASE_DIR, url.lstrip('/'))
            if os.path.exists(local_path):
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
        local_path = os.path.join(BASE_DIR, cache_url.lstrip('/'))
        if os.path.exists(local_path):
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


def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get('logged_in'):
            return jsonify({'error': '请先登录', 'need_login': True}), 401
        return f(*args, **kwargs)
    return decorated_function


# ========== WebSocket 实时进度推送 ==========
# 进度事件通过 task_id 区分不同任务, 前端订阅后按 task_id 过滤

def emit_progress(task_id, progress, message, stage=None, extra=None):
    """向云函数 reportProgress 上报进度 (替代原 SocketIO 推送, 前端轮询云数据库)

    Args:
        task_id:  任务唯一ID (前端生成, 随请求传给后端)
        progress: 0-100 整数
        message:  进度描述文字
        stage:    可选的阶段标识 (如 'calling_llm', 'parsing', 'saving', 'done', 'error')
        extra:    可选的附加数据 dict
    """
    try:
        url = os.environ.get('CLOUDBASE_REPORT_PROGRESS_URL', '')
        if not url:
            return  # 未配置云函数 HTTP 触发 URL 则跳过, 不影响主流程
        payload = {
            'taskId': task_id,
            'progress': min(100, max(0, int(progress))),
            'message': str(message),
            'stage': stage or '',
            'extra': extra or {}
        }
        requests.post(url, json=payload, timeout=5)
    except Exception as e:
        print(f"[emit_progress] report failed: {e}")


def _host_machine_identifiers():
    """返回"主机本机"的身份标识集合 (全小写): 环回名 + 本机主机名 + 本机所有局域网 IPv4.
    用于判定请求是否来自主机本机访问."""
    names = {'localhost', '127.0.0.1', '::1', '0.0.0.0'}
    try:
        names.add(socket.gethostname().lower())
    except Exception:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            addr = info[4][0]
            if addr and not addr.startswith('127.'):
                names.add(addr.lower())
    except Exception:
        pass
    # 兜底: UDP 探测本机出网 IP (connect 只在本地路由表查一下, 不真正发包)
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        addr = s.getsockname()[0]
        if addr and not addr.startswith('127.'):
            names.add(addr.lower())
        s.close()
    except Exception:
        pass
    return names


def _request_hostname():
    """提取请求 Host 头的纯主机名 (去掉端口 / IPv6 方括号), 小写."""
    host = (request.headers.get('Host') or '').strip().lower()
    if host.startswith('['):  # [::1]:2778
        host = host[1:].split(']')[0]
    elif ':' in host:         # localhost:2778 / 192.168.1.5:2778
        host = host.rsplit(':', 1)[0]
    return host


def _is_host_machine_request():
    """判定当前请求是否来自"主机本机"访问 (而非内网穿透/反向代理转发).

    关键点: natapp/ngrok/frp 等内网穿透工具会在主机本地把公网请求转发给 127.0.0.1,
    所以 request.remote_addr 对本机访问和穿透访问都是 127.0.0.1, 无法区分.
    可靠的信号是 Host 头: 本机访问时浏览器发送 localhost/127.0.0.1/本机IP,
    穿透访问时 Host 是穿透域名或公网地址.
    """
    host = _request_hostname()
    if not host:
        return False
    return host in _host_machine_identifiers()


@app.route('/')
def landing():
    """宣传页: 未登录也能看, 展示核心功能, CTA 进入 /app"""
    return render_template('landing.html')


@app.route('/app')
def index():
    if not session.get('logged_in'):
        return render_template('login.html')
    return render_template('index.html')

@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    username = data.get('username', '').strip()
    password = data.get('password', '')

    if not username or not password:
        return jsonify({'success': False, 'error': '请输入用户名和密码'}), 400

    # 1. 先校验管理员 (来自 .env)
    if username == ADMIN_USERNAME and hmac.compare_digest(password, ADMIN_PASSWORD):
        # 安全: admin 账号只能在主机本机登录, 禁止经内网穿透/公网远程登录
        if not _is_host_machine_request():
            print(f"[login] BLOCKED admin login from non-host: remote={request.remote_addr} host={request.headers.get('Host')}")
            return jsonify({'success': False, 'error': '管理员账号仅限主机本机登录'}), 403
        session['logged_in'] = True
        session['username'] = username
        session['is_admin'] = True
        return jsonify({'success': True, 'message': '登录成功', 'username': username, 'is_admin': True})

    # 2. 校验普通注册用户 (来自 users.json)
    users = load_users()
    user = users.get(username)
    if user and _verify_password(password, user.get('password_hash', ''), user.get('salt', '')):
        session['logged_in'] = True
        session['username'] = username
        session['is_admin'] = False
        # 确保用户目录存在
        get_user_dir(username)
        return jsonify({'success': True, 'message': '登录成功', 'username': username, 'is_admin': False})

    return jsonify({'success': False, 'error': '用户名或密码错误'}), 401


@app.route('/api/register', methods=['POST'])
def register():
    """注册新用户。校验用户名/密码, 写入 users.json。"""
    data = request.json or {}
    username = (data.get('username') or '').strip()
    password = data.get('password') or ''
    confirm = data.get('confirm') or ''

    # 校验用户名
    if not re.match(r'^[A-Za-z0-9_\-\u4e00-\u9fa5]{2,32}$', username):
        return jsonify({'success': False, 'error': '用户名 2-32 字符, 只能包含中英文/数字/下划线/连字符'}), 400

    # 校验密码
    if len(password) < 6 or len(password) > 64:
        return jsonify({'success': False, 'error': '密码长度需 6-64 字符'}), 400
    if password != confirm:
        return jsonify({'success': False, 'error': '两次输入的密码不一致'}), 400

    # 保留用户名: 禁止注册 admin / 与 admin 冲突
    if username.lower() == ADMIN_USERNAME.lower():
        return jsonify({'success': False, 'error': '该用户名已被保留'}), 400

    users = load_users()
    if username in users:
        return jsonify({'success': False, 'error': '该用户名已被注册'}), 400

    # 写入新用户
    pwd_hash, salt = _hash_password(password)
    users[username] = {
        'password_hash': pwd_hash,
        'salt': salt,
        'created_at': datetime.now().isoformat(),
    }
    save_users(users)

    # 预创建用户目录
    get_user_dir(username)

    print(f"[users] new user registered: {username}")
    return jsonify({'success': True, 'message': '注册成功, 请登录'})


@app.route('/api/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'success': True, 'message': '已退出登录'})


@app.route('/api/check-auth', methods=['GET'])
def check_auth():
    if session.get('logged_in'):
        return jsonify({
            'logged_in': True,
            'username': session.get('username'),
            'is_admin': session.get('is_admin', False)
        })
    return jsonify({'logged_in': False})

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


def _extract_llm_content(result):
    """从各种 LLM 响应格式 (OpenAI / 兼容 API / 自定义) 中提取 content 字符串."""
    content = ''
    if 'choices' in result and len(result['choices']) > 0:
        choice = result['choices'][0]
        if 'message' in choice:
            content = choice['message']['content']
        elif 'text' in choice:
            content = choice['text']
    elif 'response' in result:
        content = result['response']
    elif 'text' in result:
        content = result['text']
    elif 'content' in result:
        content = result['content']
    elif 'data' in result:
        content = str(result['data'])
    else:
        content = str(result)
    return content


def _repair_json(json_str):
    """把 LLM 输出中的裸换行/控制字符转义, 使 json.loads 能接受."""
    result = []
    in_string = False
    escape_next = False
    for char in json_str:
        if escape_next:
            result.append(char)
            escape_next = False
        elif char == '\\':
            result.append(char)
            escape_next = True
        elif char == '"' and not escape_next:
            in_string = not in_string
            result.append(char)
        elif in_string:
            if char == '\n':
                result.append('\\n')
            elif char == '\r':
                result.append('\\r')
            elif char == '\t':
                result.append('\\t')
            elif ord(char) < 32:
                result.append(' ')
            else:
                result.append(char)
        else:
            result.append(char)
    return ''.join(result)


def _try_parse_json(text):
    """LLM 输出容错解析: 原文 → repair → 抽取首个大括号块再 repair. 全部失败返回 None."""
    for candidate in (text, _repair_json(text)):
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            pass
    m = re.search(r'\{[\s\S]*\}', text)
    if m:
        try:
            return json.loads(_repair_json(m.group()))
        except json.JSONDecodeError:
            pass
    return None


def _clean_placeholder_dialogue(parsed):
    """
    LLM 经常把示例里的 '...' / '<...>' / '…' 照抄进 dialogue 字段,
    这些是占位符不是真对白, 会导致气泡不出现.
    清洗逻辑: dialogue 命中占位符模式 → 置空字符串 (气泡就跳过, 不会画无效气泡).
    """
    PLACEHOLDER_PATTERNS = re.compile(
        r'^(\.{2,}|…|<[^>]*>|\.{3,}|[…]+|\s*省略\s*|\s*待定\s*|\s*TBD\s*|\s*N/A\s*|\s*无\s*|null|none)$',
        re.IGNORECASE
    )
    n = 0
    for page in parsed.get('pages', []):
        for seg in page.get('segments', []):
            d = seg.get('dialogue')
            if isinstance(d, str) and PLACEHOLDER_PATTERNS.match(d.strip()):
                seg['dialogue'] = ''
                n += 1
    if n:
        print(f'[clean-placeholder] cleaned {n} placeholder dialogues to empty string')
    return parsed


def _api_request(method, url, retries=3, base_delay=2.0, backoff=2.0, **kwargs):
    """带指数退避的 HTTP 请求封装, 用于 LLM/图像 API 等长耗时调用.

    对 429 限流 / 5xx 服务端错误 / 网络抖动自动重试, 间隔按 2s -> 4s -> 8s 递增;
    其余 4xx (参数/鉴权错误) 不重试直接抛错. 返回状态码为 2xx 的 response.
    """
    kwargs.setdefault('timeout', 300)
    last_exc = None
    for attempt in range(1, max(1, retries) + 1):
        try:
            resp = requests.request(method, url, **kwargs)
            if resp.status_code in (429, 500, 502, 503, 504):
                raise RuntimeError('HTTP %d: %s' % (resp.status_code, resp.text[:200]))
            resp.raise_for_status()
            return resp
        except requests.HTTPError:
            # 4xx 业务错误 (参数/鉴权等) 不重试, 直接抛出, 避免无意义等待
            raise
        except (requests.RequestException, RuntimeError) as e:
            last_exc = e
            if attempt < retries:
                delay = base_delay * (backoff ** (attempt - 1))
                print('[api_retry] %s %s attempt %d/%d failed: %s; retry in %.1fs'
                      % (method, url, attempt, retries, e, delay))
                time.sleep(delay)
    raise last_exc


def call_image_api(api_url, api_key, payload):
    """调用图片生成API，兼容OpenAI SDK格式"""
    headers = {'Content-Type': 'application/json'}
    if api_key:
        headers['Authorization'] = f'Bearer {api_key}'

    print(f"Calling Image API: {api_url}")
    print(f"Payload model: {payload.get('model')}, prompt length: {len(payload.get('prompt', ''))}")
    if 'image' in payload:
        img_val = payload['image']
        if isinstance(img_val, list):
            print(f"Reference images: {len(img_val)} images")
        else:
            print(f"Reference image: 1 image")
    
    response = _api_request('POST', api_url, headers=headers, json=payload, timeout=300)
    print(f"Image API status: {response.status_code}")
    if response.status_code != 200:
        print(f"Image API error response: {response.text[:2000]}")
    response.raise_for_status()
    result = response.json()
    
    # 提取图片URL
    image_url = None
    if 'data' in result:
        data_obj = result['data']
        if isinstance(data_obj, list) and len(data_obj) > 0:
            image_url = data_obj[0].get('url', '') or data_obj[0].get('b64_json', '')
        elif isinstance(data_obj, dict):
            image_url = data_obj.get('url', '') or data_obj.get('b64_json', '')
    elif 'images' in result and len(result['images']) > 0:
        image_url = result['images'][0]
    elif 'image' in result:
        image_url = result['image']
    elif 'output' in result:
        image_url = result['output']
    elif 'b64_json' in result:
        image_url = result['b64_json']
    
    return image_url, result


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


@app.route('/api/save-config', methods=['POST'])
@login_required
def save_config():
    data = request.json
    config_path = CONFIG_LOCAL_PATH
    with open(config_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return jsonify({'success': True})


@app.route('/api/load-config', methods=['GET'])
@login_required
def load_config():
    for config_path in (CONFIG_LOCAL_PATH, CONFIG_TEMPLATE_PATH):
        if os.path.exists(config_path):
            with open(config_path, 'r', encoding='utf-8') as f:
                return jsonify(json.load(f))
    return jsonify({})


@app.route('/api/test-llm', methods=['POST'])
@login_required
def test_llm():
    data = request.json
    api_url = data.get('api_url', '')
    api_key = data.get('api_key', '')
    model = data.get('model', '')

    if not api_url:
        return jsonify({'success': False, 'error': 'API地址不能为空'})

    try:
        headers = {'Content-Type': 'application/json'}
        if api_key:
            headers['Authorization'] = f'Bearer {api_key}'

        payload = {
            'model': model or 'deepseek-chat',
            'messages': [
                {'role': 'user', 'content': 'Hi'}
            ],
            'max_tokens': 10
        }

        print(f"Testing LLM API: {api_url}")
        print(f"Test Headers: {dict(headers)}")
        print(f"Test Payload: {json.dumps(payload)}")
        
        response = requests.post(api_url, headers=headers, json=payload, timeout=30)
        print(f"LLM test response status: {response.status_code}")
        print(f"LLM test response text: {response.text}")
        response.raise_for_status()
        result = response.json()

        return jsonify({'success': True, 'message': 'LLM API连接成功！', 'data': result})
    except Exception as e:
        import traceback
        print(f"LLM test error: {str(e)}")
        print(traceback.format_exc())
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/test-image', methods=['POST'])
@login_required
def test_image():
    data = request.json
    api_url = data.get('api_url', '')
    api_key = data.get('api_key', '')
    model = data.get('model', '')

    if not api_url:
        return jsonify({'success': False, 'error': 'API地址不能为空'})

    try:
        headers = {'Content-Type': 'application/json'}
        if api_key:
            headers['Authorization'] = f'Bearer {api_key}'

        payload = {
            'model': model or 'doubao-seedream-4-5-251128',
            'prompt': 'test',
            'size': '2K',
            'response_format': 'url',
            'watermark': False,
        }

        print(f"Testing Image API: {api_url}")
        response = requests.post(api_url, headers=headers, json=payload, timeout=60)
        print(f"Image test response status: {response.status_code}")
        print(f"Image test response text: {response.text}")
        response.raise_for_status()
        result = response.json()

        return jsonify({'success': True, 'message': 'Image API连接成功！', 'data': result})
    except Exception as e:
        import traceback
        print(f"Image test error: {str(e)}")
        print(traceback.format_exc())
        return jsonify({'success': False, 'error': str(e)})


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


# ============ 任务3: 自适应网格 + 4 种对话气泡 ============

# 中文字体候选路径 (Android 优先用 assets 复制的思源黑体, 然后 Windows, 最后 Linux/macOS)
_ANDROID_FONT_CANDIDATES = [
    '/system/fonts/NotoSansCJK-Regular.ttc',           # 大多数 Android 设备预装
    os.path.join(_PERSIST_DIR, 'fonts', 'SourceHanSansSC-Regular.otf'),
    os.path.join(_PERSIST_DIR, 'fonts', 'SourceHanSansSC-Bold.otf'),
]
_CHINESE_FONT_CANDIDATES = (
    _ANDROID_FONT_CANDIDATES if _IS_ANDROID else []
) + [
    'C:/Windows/Fonts/msyh.ttc',     # 微软雅黑
    'C:/Windows/Fonts/simhei.ttf',   # 黑体
    'C:/Windows/Fonts/simsun.ttc',   # 宋体
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/System/Library/Fonts/PingFang.ttc',
    'arial.ttf',
]


def _get_chinese_font(size):
    """按优先级加载中文字体, 全部失败则回退到 PIL 默认字体.
    Android 上加 layout_engine=BASIC workaround (Pillow #7289: CJK 渲染 bug)."""
    candidates = _CHINESE_FONT_CANDIDATES
    if _IS_ANDROID:
        # Android 启动: 首次复制 fonts 到沙盒
        _ensure_android_fonts()
    for path in candidates:
        try:
            if _IS_ANDROID:
                # layout_engine=Layout.BASIC 绕过 Pillow 在 Android 上的 CJK 渲染问题
                return ImageFont.truetype(path, size, layout_engine=ImageFont.Layout.BASIC)
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    try:
        return ImageFont.load_default()
    except Exception:
        return None


def _get_font_line_height(font):
    """获取字体行高 (字符实际高度 + 行间距).
    修复: 使用 getbbox 而非 getmetrics, 后者会包含字符上方空白区域 (ascent 区域)
    而 draw.text 把字符视觉顶部放在 getbbox 的 top 位置, 不是 (0,0).
    这导致行高被高估, 文字整体下移."""
    try:
        l, t, r, b = font.getbbox('国')
        return b - t + 2  # 字符实际高度 + 2px 行间距
    except Exception:
        pass
    try:
        ascent, descent = font.getmetrics()
        return ascent + descent
    except Exception:
        try:
            return font.size
        except Exception:
            return 16


def _get_font_bbox_top_offset(font):
    """获取 font.getbbox top 偏移量 (draw.text 传入 y 到字符视觉顶部的距离).
    PIL 的 draw.text((x, y), text, font=f) 把字符视觉顶部放在 y + getbbox[1] 位置,
    而非 y. 文字垂直居中时必须用此偏移修正 start_y."""
    try:
        return font.getbbox('国')[1]
    except Exception:
        return 0


def _grid_dims(panel_count):
    """分镜数量 → (行数, 列数): 1→1x1, 2→2x1, 3→3x1, 4→2x2, 5→3+2, 6→3x2,
    7→4+3, 8→4x2, 9→3x3, 10-12→4x3, 13-16→4x4."""
    rows_map = {1: 1, 2: 1, 3: 1, 4: 2, 5: 2, 6: 2, 7: 2, 8: 2, 9: 3, 10: 3, 11: 3, 12: 3, 13: 4, 14: 4, 15: 4, 16: 4}
    cols_map = {1: 1, 2: 2, 3: 3, 4: 2, 5: 3, 6: 3, 7: 4, 8: 4, 9: 3, 10: 4, 11: 4, 12: 4, 13: 4, 14: 4, 15: 4, 16: 4}
    rows = rows_map.get(panel_count, max(1, (panel_count + 3) // 4))
    cols = cols_map.get(panel_count, min(4, (panel_count + rows - 1) // rows))
    return rows, cols


def compute_grid_layout(panel_count, canvas_w=None, canvas_h=None, gap=4, manual_layout=None):
    """依据 panel_count 自动选择 N×M 布局, 返回 [{x,y,w,h}] 列表 (像素坐标).

    manual_layout: 若提供 (list[{x,y,w,h} 或 ratio]), 则优先使用手动布局
      - ratio 形式 (0-1 浮点): 按 canvas_w/canvas_h 折算成像素
      - 像素形式: 直接使用
    """
    if not panel_count or panel_count <= 0:
        return []

    # 1. 优先使用手动布局
    if manual_layout and len(manual_layout) == panel_count:
        if canvas_w and canvas_h:
            return [{
                'x': int(p.get('x', 0) * canvas_w) if 0 <= float(p.get('x', 0)) <= 1 and float(p.get('x', 0)) != int(p.get('x', 0)) else int(p.get('x', 0)),
                'y': int(p.get('y', 0) * canvas_h) if 0 <= float(p.get('y', 0)) <= 1 and float(p.get('y', 0)) != int(p.get('y', 0)) else int(p.get('y', 0)),
                'w': int(p.get('w', 0) * canvas_w) if 0 <= float(p.get('w', 0)) <= 1 and float(p.get('w', 0)) != int(p.get('w', 0)) else int(p.get('w', 0)),
                'h': int(p.get('h', 0) * canvas_h) if 0 <= float(p.get('h', 0)) <= 1 and float(p.get('h', 0)) != int(p.get('h', 0)) else int(p.get('h', 0)),
            } for p in manual_layout]
        return [{'x': int(p.get('x', 0)), 'y': int(p.get('y', 0)), 'w': int(p.get('w', 0)), 'h': int(p.get('h', 0))} for p in manual_layout]

    # 2. 默认: 同质网格, 行数=ceil(sqrt(n)), 列数=ceil(n/rows)
    rows, cols = _grid_dims(panel_count)

    if not canvas_w:
        # 没传画布尺寸, 给默认 2K 横向: 2048w * cols, 1536h * rows
        canvas_w, canvas_h = 1024 * cols, 1024 * rows
    if not canvas_h:
        canvas_h = int(canvas_w * 0.75) * rows  # 4:3 高宽比

    panel_w = (canvas_w - gap * (cols + 1)) // cols
    panel_h = (canvas_h - gap * (rows + 1)) // rows
    layout = []
    for i in range(panel_count):
        r = i // cols
        c = i % cols
        x = gap + c * (panel_w + gap)
        y = gap + r * (panel_h + gap)
        layout.append({'x': x, 'y': y, 'w': panel_w, 'h': panel_h})
    return layout


def fit_text_to_box(text, font, max_width, max_height, draw):
    """把 text 折行 + 缩字号, 直到能装进 (max_width, max_height) 盒子. 返回 (lines, font).
    修复: 缩字号后用新字号重新测量行高和折行, 避免闭包捕获旧 font 导致字号被错误压缩."""
    if not text:
        return [], font

    def measure(s, f):
        try:
            l, t, r, b = draw.textbbox((0, 0), s, font=f)
            return r - l, _get_font_line_height(f)
        except Exception:
            return len(s) * 8, _get_font_line_height(f)

    def wrap_with_font(f):
        """用字号 f 折行, 返回 lines"""
        chars = list(text.replace('\n', ''))
        lines, cur = [], ''
        for ch in chars:
            candidate = cur + ch
            w, _ = measure(candidate, f)
            if w <= max_width - 8:  # 内边距
                cur = candidate
            else:
                if cur:
                    lines.append(cur)
                cur = ch
        if cur:
            lines.append(cur)
        return lines

    cur_font = font
    # 先用原字号折行
    lines = wrap_with_font(cur_font)
    # 行高与 _draw_text_centered 一致 (_get_font_line_height 已含 +2 行间距)
    while cur_font and lines:
        line_h = _get_font_line_height(cur_font)
        total_h = line_h * len(lines)
        if total_h <= max_height - 4 or len(lines) <= 1:
            break
        try:
            new_size = max(10, int(cur_font.size * 0.9))
            if new_size >= cur_font.size:
                break
            cur_font = ImageFont.truetype(cur_font.path, new_size) if hasattr(cur_font, 'path') else cur_font
            # 重新折行: 字号变小后单字宽度变小, 一行容纳更多字符
            new_lines = wrap_with_font(cur_font)
            if new_lines:
                lines = new_lines
        except Exception:
            break

    # 兜底: 字号已最小但仍装不下, 截断多余行防止文字溢出气泡
    line_h = _get_font_line_height(cur_font)
    total_h = line_h * len(lines)
    if total_h > max_height - 4 and len(lines) > 1:
        max_lines = max(1, int((max_height - 4) // line_h))
        lines = lines[:max_lines]
        # 最后一行末尾加省略号
        if lines and lines[-1]:
            lines[-1] = lines[-1][:-1] + '…'

    return lines, cur_font


def _draw_text_centered(draw, text, font, x, y, w, h, fill='black'):
    """在 (x,y,w,h) 矩形中居中绘制多行文字.
    修正: draw.text y 坐标到字符视觉顶部有 bbox_top 偏移, 需在 start_y 中减掉,
    否则文字会整体下移溢出气泡底部."""
    if not text:
        return
    lines, fitted_font = fit_text_to_box(text, font, w, h, draw)
    if fitted_font:
        font = fitted_font
    line_h = _get_font_line_height(font)
    bbox_top = _get_font_bbox_top_offset(font)
    total_h = line_h * len(lines)
    # 文字视觉顶部 = start_y - bbox_top + i * line_h
    # 第一行视觉顶部 = start_y - bbox_top
    # 居中: 第一行视觉中心 = y + h/2 - line_h/2 + bbox_top
    start_y = y + max(0, (h - total_h) // 2) - bbox_top
    for i, line in enumerate(lines):
        try:
            lw, _ = draw.textbbox((0, 0), line, font=font)
        except Exception:
            lw = len(line) * 8
        tx = x + max(0, (w - lw) // 2 - 524)  # 左移 524px, 文字相对于气泡左移
        draw.text((tx, start_y + i * line_h), line, fill=fill, font=font)


def _draw_rounded_rect(draw, xy, radius, outline='black', fill='white', width=2):
    """Pillow 旧版没有 rounded_rectangle 时的回退实现"""
    try:
        draw.rounded_rectangle(xy, radius=radius, outline=outline, fill=fill, width=width)
    except AttributeError:
        # 退化: 画矩形
        draw.rectangle(xy, outline=outline, fill=fill, width=width)


def _bubble_speech_tail(draw, x, y, w, h, size=20):
    """对话气泡的小尖角 (尾巴) 指向左下"""
    # 尖角在底边偏左
    tip_x = x + w * 0.25
    tip_y = y + h + size
    draw.polygon([
        (x + w * 0.1, y + h - 1),
        (x + w * 0.4, y + h - 1),
        (tip_x, tip_y)
    ], fill='white', outline='black')


def draw_dialogue_bubble(draw, x, y, w, h, text, font, overflow=True, canvas_bounds=None):
    """普通对话气泡: 圆角矩形 (无尾巴)"""
    if not overflow and canvas_bounds:
        cb_x, cb_y, cb_w, cb_h = canvas_bounds
        x = max(cb_x, min(x, cb_x + cb_w - w))
        y = max(cb_y, min(y, cb_y + cb_h - h))
    # 白底黑边圆角矩形 (无尾巴, 更简洁)
    _draw_rounded_rect(draw, [x, y, x + w, y + h], radius=10, outline='black', fill='white', width=2)
    # 文字居中
    _draw_text_centered(draw, text, font, x + 4, y + 2, w - 8, h - 4)


def draw_thought_bubble(draw, x, y, w, h, text, font, overflow=True, canvas_bounds=None):
    """心理/思考气泡: 云形 (用多个小圆模拟) + 小圆尾巴"""
    n_h = max(2, h // 30)
    n_w = max(2, w // 30)
    cloud_color = 'white'
    edge_color = 'black'
    r = min(h, w) // 6

    def circle_center(i, j):
        cx = x + r + j * (w - 2 * r) // max(1, n_w - 1) if n_w > 1 else x + w // 2
        cy = y + r + i * (h - 2 * r) // max(1, n_h - 1) if n_h > 1 else y + h // 2
        return cx, cy

    # Pass 1: 所有圆填白色, 无描边 (形成实心云体)
    for i in range(n_h):
        for j in range(n_w):
            cx, cy = circle_center(i, j)
            draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=cloud_color)
    # Pass 2: 仅最外圈圆描边 (形成云边轮廓)
    for i in range(n_h):
        for j in range(n_w):
            if i == 0 or i == n_h - 1 or j == 0 or j == n_w - 1:
                cx, cy = circle_center(i, j)
                draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=edge_color, width=2)
    # Pass 3: 内部圆再填一次白色, 覆盖边缘圆朝内的描边弧线
    for i in range(n_h):
        for j in range(n_w):
            if 0 < i < n_h - 1 and 0 < j < n_w - 1:
                cx, cy = circle_center(i, j)
                draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=cloud_color)
    # 尾巴小圆 (3个由大到小, 指向右下)
    for i, rr in enumerate([12, 8, 5]):
        cxx = x + w * 0.3 + i * 15
        cyy = y + h + 10 + i * 12
        draw.ellipse([cxx - rr, cyy - rr, cxx + rr, cyy + rr], fill=cloud_color, outline=edge_color, width=2)
    # 文字居中
    _draw_text_centered(draw, text, font, x + 4, y + 2, w - 8, h - 4)


def draw_shout_bubble(draw, x, y, w, h, text, font, overflow=True, canvas_bounds=None):
    """大喊/喊叫气泡: 锯齿/爆炸形 (用随机尖角近似)"""
    import random
    random.seed(42)  # 稳定形状
    n = 18  # 边上的尖角数
    pts = []
    # 上边 (左→右)
    for i in range(n + 1):
        px = x + i * w / n
        py = y + (0 if i % 2 == 0 else -random.randint(8, 16))
        pts.append((px, py))
    # 右边 (上→下)
    for i in range(1, n + 1):
        px = x + w + (0 if i % 2 == 0 else random.randint(8, 16))
        py = y + i * h / n
        pts.append((px, py))
    # 下边 (右→左)
    for i in range(1, n + 1):
        px = x + w - i * w / n
        py = y + h + (0 if i % 2 == 0 else random.randint(8, 16))
        pts.append((px, py))
    # 左边 (下→上)
    for i in range(1, n + 1):
        px = x - (0 if i % 2 == 0 else random.randint(8, 16))
        py = y + h - i * h / n
        pts.append((px, py))
    # 主体 (白底)
    draw.polygon(pts, fill='white', outline='black')
    # 描边强化
    for i in range(len(pts)):
        p1 = pts[i]
        p2 = pts[(i + 1) % len(pts)]
        draw.line([p1, p2], fill='black', width=2)
    # 文字居中
    _draw_text_centered(draw, text, font, x + 4, y + 2, w - 8, h - 4)


def draw_narration_bubble(draw, x, y, w, h, text, font, overflow=True, canvas_bounds=None):
    """旁白/叙述框: 朴素矩形 (像电影旁白那种), 居中, 灰色边框"""
    draw.rectangle([x, y, x + w, y + h], fill='#f5f5dc', outline='#333333', width=1)
    _draw_text_centered(draw, text, font, x + 4, y + 2, w - 8, h - 4, fill='#222222')


def draw_whisper_bubble(draw, x, y, w, h, text, font, overflow=True, canvas_bounds=None):
    """耳语/低语气泡: 虚线边圆角矩形 + 小尾巴 (给人安静、秘密的感觉)"""
    if not overflow and canvas_bounds:
        cb_x, cb_y, cb_w, cb_h = canvas_bounds
        x = max(cb_x, min(x, cb_x + cb_w - w))
        y = max(cb_y, min(y, cb_y + cb_h - h))
    # 白底 + 虚线黑边 (1px 短虚线)
    _draw_rounded_rect(draw, [x, y, x + w, y + h], radius=10, outline='black', fill='white', width=1)
    # 在原矩形上覆盖虚线效果 (PIL 旧版 rounded_rectangle 无 dash 支持, 用横线扫描模拟)
    try:
        dash_gap = 6
        for ty in range(y, y + h, dash_gap):
            draw.line([(x + 2, ty), (x + w - 2, ty)], fill='white', width=1)
            draw.line([(x + 2, ty + 3), (x + w - 2, ty + 3)], fill='white', width=1)
    except Exception:
        pass
    # 小尾巴 (比 dialogue 小, 暗示安静)
    _bubble_speech_tail(draw, x, y, w, h, size=int(h * 0.2))
    _draw_text_centered(draw, text, font, x + 4, y + 2, w - 8, h - 4)


def draw_box_bubble(draw, x, y, w, h, text, font, overflow=True, canvas_bounds=None):
    """白底黑实线矩形气泡 (无尾巴, 像漫画对话框的方形版本, 区别于 narration 的米黄底)"""
    if not overflow and canvas_bounds:
        cb_x, cb_y, cb_w, cb_h = canvas_bounds
        x = max(cb_x, min(x, cb_x + cb_w - w))
        y = max(cb_y, min(y, cb_y + cb_h - h))
    draw.rectangle([x, y, x + w, y + h], fill='white', outline='black', width=2)
    _draw_text_centered(draw, text, font, x + 4, y + 2, w - 8, h - 4)


def draw_burst_bubble(draw, x, y, w, h, text, font, overflow=True, canvas_bounds=None):
    """爆发/音爆气泡: 辐射线条 (短促有力的射线, 用于拟声词/强烈冲击).
    与 shout (锯齿) 区别: 锯齿=人物喊叫, 爆发=外部声效/撞击."""
    # 主体: 椭圆 (尖刺辐射的载体)
    draw.ellipse([x, y, x + w, y + h], fill='white', outline='black', width=2)
    # 辐射短线: 从椭圆边缘向外发散, 长短交替 (8 长 + 8 短)
    import math
    cx, cy = x + w / 2.0, y + h / 2.0
    rx, ry = w / 2.0, h / 2.0
    for i in range(16):
        theta = 2 * math.pi * i / 16
        is_long = (i % 2 == 0)
        extend = 0.45 if is_long else 0.22
        # 内端贴椭圆边缘, 外端向外延伸
        ix = cx + rx * math.cos(theta)
        iy = cy + ry * math.sin(theta)
        ex = cx + (rx + rx * extend) * math.cos(theta)
        ey = cy + (ry + ry * extend) * math.sin(theta)
        draw.line([(ix, iy), (ex, ey)], fill='black', width=2)
    _draw_text_centered(draw, text, font, x + 6, y + 4, w - 12, h - 8)


def draw_caption_bubble(draw, x, y, w, h, text, font, overflow=True, canvas_bounds=None):
    """拟声词/音效气泡: 黑底白字 (像漫画里 "BOOM!" "咔嚓!" 这种, 矩形无尾巴)"""
    if not overflow and canvas_bounds:
        cb_x, cb_y, cb_w, cb_h = canvas_bounds
        x = max(cb_x, min(x, cb_x + cb_w - w))
        y = max(cb_y, min(y, cb_y + cb_h - h))
    draw.rectangle([x, y, x + w, y + h], fill='black', outline='black', width=1)
    _draw_text_centered(draw, text, font, x + 4, y + 2, w - 8, h - 4, fill='white')


# 漫画模式 / 气泡渲染方式 的白名单校验, 集中默认值, 避免三处重复守卫
def _norm_comic_mode(raw):
    return raw if raw in ('bw', 'color') else 'bw'


def _norm_bubble_mode(raw):
    return raw if raw in ('pil', 'api') else 'pil'


# 气泡分发表 (分镜规划阶段可由 LLM 主动选, 也可由用户手动改, 还可由启发式推断)
BUBBLE_DRAWERS = {
    'dialogue': draw_dialogue_bubble,    # 普通对话: 圆角矩形 (无尾)
    'thought': draw_thought_bubble,      # 心理活动: 云形+小圆尾
    'shout': draw_shout_bubble,          # 大喊/喊叫: 锯齿/爆炸
    'whisper': draw_whisper_bubble,      # 耳语/低语: 虚线圆角+小尾
    'burst': draw_burst_bubble,          # 爆发/音爆/拟声: 辐射射线
    'narration': draw_narration_bubble,  # 旁白叙述: 米黄底灰框矩形
    'box': draw_box_bubble,              # 普通实线矩形气泡 (无尾)
    'caption': draw_caption_bubble,      # 拟声词音效: 黑底白字矩形
}


# 气泡类型说明 (供 LLM 规划时参考 + 前端下拉框展示)
DIALOGUE_TYPE_CATALOG = {
    'dialogue':  {'label': '💬 对话',     'desc': '普通对话气泡 (圆角矩形, 无尾巴)'},
    'thought':   {'label': '💭 心理',     'desc': '心理活动/内心独白 (云形)'},
    'shout':     {'label': '💥 喊叫',     'desc': '大喊/尖叫/强烈情绪 (锯齿爆炸)'},
    'whisper':   {'label': '🤫 耳语',     'desc': '低语/悄悄话/秘密 (虚线圆角)'},
    'burst':     {'label': '⚡ 爆发',     'desc': '音爆/撞击/外部声效 (辐射射线)'},
    'narration': {'label': '📜 旁白',     'desc': '第三人称叙述 (米黄底矩形)'},
    'box':       {'label': '▢ 方框',     'desc': '普通实线矩形气泡 (无尾)'},
    'caption':   {'label': '🔊 拟声词',   'desc': '音效/状声词 (黑底白字)'},
}


# 启发式推断 dialogue_type 的正则触发词
# 优先级: caption (短纯拟声 ≤ 6 字) > burst (纯拟声/音爆) > shout (强情绪) > thought (心理) > whisper (低语) > narration (叙述)

# 纯拟声字符集 (漫画里典型的 "BOOM/咔嚓/嗖" 等, 不含人类感叹词)
_ONOMA_CHARS = set('嘭砰咚咔嚓嘶嗖乒乓啪嗡哐呜嘎吱咣轰噼啪')

_DT_TRIGGERS = {
    'burst': [
        # 长拟声/音爆 (多字音爆或重复)
        r'^[!?！？\s…·\-\.]*(?:[嘭砰咚咔嚓嘶嗖乒乓啪嗡哐呜嘎吱咣轰噼啪]+[!！？\s]*){2,}$',
        r'^(?:[A-Z]{2,}[!?!\s]*){2,}$',
    ],
    'shout': [
        r'[!！]{2,}',
        r'[?？]{2,}',
        r'(?:不|别|住手|救命|杀|死|滚|混蛋|该死|去死|滚开)[!！]*$',
        # 短促感叹词收尾 (啊! 哎! 哇! 这种人类感叹)
        r'^[啊哎哦呵哈嘿哼哇哟嚯呐嗯]+[!?！？?]+$',
        # 重复人类感叹词 (啊啊啊 / 哇哇哇 / 啊啊啊啊 这种持续喊叫)
        r'^[啊哎哦呵哈嘿哼哇哟嚯呐嗯]{2,}$',
    ],
    'whisper': [
        r'…+',
        r'(?:悄悄地|轻声|低声|小声|别出声|别让|偷偷|暗[自中悄]|悄[悄声]|嘘|耳语)',
    ],
    'thought': [
        r'(?:他想|她想|心里想|心里|暗想|暗忖|寻思|思忖|思量|琢磨|心中|脑海里|脑中|自语|独白)',
        r'(?:[他她它][的心脑中]?[想忖思念叨合计琢磨])',
    ],
    'narration': [
        r'^(?:当时|那天|此刻|后来|不久|次日|黎明|黄昏|夜里|清晨)',
        r'(?:他|她)[一-龥]{0,3}(?:走|站|坐|看|望|抬|低|转|回)[着了过]',
    ],
}


def _is_pure_onomatopoeia(text):
    """判断是否纯拟声: 字符集限定在拟声字 + 标点 + 英文大写."""
    if not text:
        return False
    punct = set('!！?？…·-.。,， \t\n')
    for ch in text:
        if ch in _ONOMA_CHARS or ch in punct:
            continue
        if ch.isascii() and ch.isalpha() and ch.isupper():
            continue
        return False
    return True


def _has_repeated_phoneme(text):
    """检查是否有拟声字符连续重复 2+ 次 (砰砰砰 / 咔嚓咔嚓 / BOOMBOOM 这种, 暗示强冲击)."""
    if not text:
        return False
    # 拟声单字重复: 砰砰砰, 嘭嘭
    for ch in _ONOMA_CHARS:
        if ch * 2 in text:
            return True
    # 拟声 2-3 字单元重复: 咔嚓咔嚓, 乒乓乒乓, 噼啪噼啪
    for unit_len in (2, 3):
        for i in range(len(text) - unit_len * 2 + 1):
            unit = text[i:i + unit_len]
            if all(c in _ONOMA_CHARS for c in unit) and unit * 2 in text:
                return True
    # 大写英文 6+ 连续视为重复 (BOOMBOOM = 8 字母; 单词 BOOM = 4 不算)
    upper_run = ''
    for ch in text:
        if ch.isascii() and ch.isalpha() and ch.isupper():
            upper_run += ch
        else:
            if len(upper_run) >= 6:
                return True
            upper_run = ''
    if len(upper_run) >= 6:
        return True
    return False


def _infer_dialogue_type(dialogue, scene_description=''):
    """对一段对话做启发式推断, 返回 dialogue_type 字符串 (BUBBLE_DRAWERS 中的 key).
    兜底返回 'dialogue'.  用于 LLM 漏填/旧数据/用户清空的情况."""
    import re
    text = (dialogue or '').strip()
    if not text:
        return 'dialogue'  # 空对话不画气泡, 但仍返回默认值兜底

    # 0. 先判拟声 (字符集是纯拟声/标点/大写英文)
    if _is_pure_onomatopoeia(text):
        # 拟声内部细分: 重复音 (砰砰砰 / BOOMBOOM) → burst; 否则短=caption / 长=burst
        if _has_repeated_phoneme(text) or len(text) > 6:
            return 'burst'
        return 'caption'

    # 1. burst: 长拟声/重复音爆
    for pat in _DT_TRIGGERS['burst']:
        if re.search(pat, text):
            return 'burst'

    # 2. shout: 多感叹号 / 强烈情绪 / 短促感叹词收尾
    for pat in _DT_TRIGGERS['shout']:
        if re.search(pat, text):
            return 'shout'

    # 3. thought: 含心理活动词
    for pat in _DT_TRIGGERS['thought']:
        if re.search(pat, text):
            return 'thought'

    # 4. whisper: 省略号 / 低声词
    for pat in _DT_TRIGGERS['whisper']:
        if re.search(pat, text):
            return 'whisper'

    # 5. narration: 配合 scene_description 暗示叙述场景, 且对话无强烈语气标点
    desc = (scene_description or '').strip()
    if desc and not re.search(r'[!！?？]', text):
        for pat in _DT_TRIGGERS['narration']:
            if re.search(pat, desc):
                return 'narration'

    return 'dialogue'


def _normalize_dialogue_type(raw, dialogue='', scene_description=''):
    """规范化 LLM 给出的 dialogue_type: 未知值 → 启发式推断 → 兜底 dialogue."""
    if not raw:
        return _infer_dialogue_type(dialogue, scene_description)
    val = str(raw).strip().lower()
    if val in BUBBLE_DRAWERS:
        return val
    # 模糊匹配: speech/talk/说话 → dialogue; inner/mind/心理 → thought; 等等
    aliases = {
        'speech': 'dialogue', 'talk': 'dialogue', 'say': 'dialogue', 'line': 'dialogue',
        '说话': 'dialogue', '对话': 'dialogue', '普通': 'dialogue',
        'inner': 'thought', 'mind': 'thought', 'think': 'thought',
        '心理': 'thought', '思考': 'thought', '独白': 'thought', '内心': 'thought',
        'yell': 'shout', 'scream': 'shout',
        '喊': 'shout', '叫': 'shout', '喊叫': 'shout', '吼': 'shout', '尖叫': 'shout',
        'quiet': 'whisper', 'murmur': 'whisper',
        '耳语': 'whisper', '低语': 'whisper', '悄悄': 'whisper', '小声': 'whisper',
        'sfx': 'burst', 'sound': 'burst', 'impact': 'burst', 'sound_effect': 'burst',
        '音爆': 'burst', '撞击': 'burst', '冲击': 'burst', '拟声': 'burst',
        'narrate': 'narration', 'narrator': 'narration',
        '旁白': 'narration', '叙述': 'narration',
        'rect': 'box', 'square': 'box', '方框': 'box',
        'onomatopoeia': 'caption', 'onomatopoeic': 'caption',
        '音效': 'caption',
    }
    if val in aliases:
        return aliases[val]
    return _infer_dialogue_type(dialogue, scene_description)


def _compute_bubble_box(panel_box, dialogue, overflow=True, canvas_bounds=None):
    """根据 panel 尺寸和对话文字长度计算气泡的位置和大小.
    返回 (bx, by, bw, bh) 像素坐标; dialogue 为空返回 None."""
    if not dialogue:
        return None
    px, py, pw, ph = panel_box['x'], panel_box['y'], panel_box['w'], panel_box['h']

    char_count = len(dialogue)
    if char_count > 40:
        bw = int(pw * 0.80)
        bh = int(ph * 0.55)
    elif char_count > 20:
        bw = int(pw * 0.70)
        bh = int(ph * 0.42)
    else:
        bw = int(pw * 0.55)
        bh = int(ph * 0.30)
    bx = px + pw - bw - 8
    by = py + ph - bh - 8
    if overflow and canvas_bounds:
        cb_x, cb_y, cb_w, cb_h = canvas_bounds
        bx = min(bx, cb_x + cb_w - bw - 4)
        by = min(by, cb_y + cb_h - bh - 4)
    elif canvas_bounds:
        bx = max(px + 4, min(bx, px + pw - bw - 4))
        by = max(py + 4, min(by, py + ph - bh - 4))
    return (bx, by, bw, bh)


def render_panel_bubble(draw, panel_box, seg, font, overflow=True, canvas_bounds=None):
    """按 seg.dialogue_type 选择气泡绘制器, 自动定位到 panel 内/可越界.
    气泡尺寸根据文字长度自适应: 短对话用小气泡, 长对话自动增大.
    返回 (bx, by, bw, bh) 气泡像素坐标; 无对话返回 None."""
    dialogue = (seg.get('dialogue') or '').strip()
    if not dialogue:
        return None
    dtype = (seg.get('dialogue_type') or 'dialogue').lower()
    if dtype not in BUBBLE_DRAWERS:
        dtype = 'dialogue'

    box = _compute_bubble_box(panel_box, dialogue, overflow=overflow, canvas_bounds=canvas_bounds)
    if not box:
        return None
    bx, by, bw, bh = box
    BUBBLE_DRAWERS[dtype](draw, bx, by, bw, bh, dialogue, font, overflow=overflow, canvas_bounds=canvas_bounds)
    return (bx, by, bw, bh)


def _local_image_abs_path(local_url):
    """把 /static/xxx URL 转成本地绝对路径; 非 /static/ 前缀返回 None"""
    if not local_url or not local_url.startswith('/static/'):
        return None
    return os.path.join(BASE_DIR, local_url[1:])


def _save_clean_copy(local_url):
    """把 local_url 对应的图片文件复制为同目录下的 *_clean.png, 返回其 /static/ URL.
    用于在 PIL 叠加气泡前保留无气泡的干净画面, 供后续拖拽编辑时重新渲染."""
    abs_path = _local_image_abs_path(local_url)
    if not abs_path or not os.path.exists(abs_path):
        return None
    base, ext = os.path.splitext(abs_path)
    clean_abs_path = base + '_clean' + (ext or '.png')
    try:
        shutil.copy2(abs_path, clean_abs_path)
        rel_path = os.path.relpath(clean_abs_path, os.path.join(BASE_DIR, 'static'))
        clean_url = '/static/' + rel_path.replace(os.sep, '/')
        return clean_url
    except Exception as e:
        print(f"[CleanCopy] failed for {local_url}: {e}")
        return None


def _overlay_bubbles_on_page(local_url, segments):
    """在整页图上按网格用 PIL 叠加每个 panel 的对话气泡, 覆盖原文件.
    segments: list[{'dialogue': str, 'dialogue_type': str, ...}]
    返回 (clean_url, bubbles): clean_url 为无气泡干净图 URL, bubbles 为气泡坐标列表."""
    if not segments:
        return None, []
    abs_path = _local_image_abs_path(local_url)
    if not abs_path or not os.path.exists(abs_path):
        print(f"[PIL-Overlay] page image not found: {local_url}")
        return None, []
    # 叠加前保留干净副本
    clean_url = _save_clean_copy(local_url)
    bubbles = []
    try:
        with Image.open(abs_path) as img:
            img = img.convert('RGB')
            W, H = img.size
            font = _get_chinese_font(max(14, int(H * 0.025)))
            draw = ImageDraw.Draw(img)
            layout = compute_grid_layout(len(segments), canvas_w=W, canvas_h=H, gap=4)
            for i, seg in enumerate(segments):
                if i >= len(layout):
                    break
                dialogue = (seg.get('dialogue') or '').strip()
                if not dialogue:
                    continue
                box = render_panel_bubble(
                    draw, layout[i], seg, font,
                    overflow=True, canvas_bounds=(0, 0, W, H)
                )
                if box:
                    bx, by, bw, bh = box
                    bubbles.append({
                        'x': bx, 'y': by, 'w': bw, 'h': bh,
                        'dialogue': dialogue,
                        'dialogue_type': (seg.get('dialogue_type') or 'dialogue').lower(),
                    })
            img.save(abs_path)
            print(f"[PIL-Overlay] page bubbles overlaid ({len(segments)} panels): {abs_path}")
    except Exception as e:
        print(f"[PIL-Overlay] failed for page {local_url}: {e}")
    return clean_url, bubbles


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
            # URL → 磁盘路径
            rel_path = url.lstrip('/')
            disk_path = os.path.join(BASE_DIR, rel_path)
            if not os.path.isfile(disk_path):
                return url  # 文件不存在, 保持原 URL (可能是外部链接)
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
def history_detail(work_id):
    """获取某个作品的完整数据（meta + state + 图片列表）"""
    username = session.get('username') or f'guest_{get_session_id()[:8]}'
    work_dir = os.path.join(get_user_dir(username), 'works', work_id)
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
def history_load(work_id):
    """加载历史作品到当前会话"""
    username = session.get('username') or f'guest_{get_session_id()[:8]}'
    work_dir = os.path.join(get_user_dir(username), 'works', work_id)
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
def history_delete(work_id):
    """删除一个作品"""
    username = session.get('username') or f'guest_{get_session_id()[:8]}'
    work_dir = os.path.join(get_user_dir(username), 'works', work_id)
    if os.path.isdir(work_dir):
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
def history_rename(work_id):
    """重命名作品"""
    username = session.get('username') or f'guest_{get_session_id()[:8]}'
    data = request.json or {}
    new_title = data.get('title', '').strip()
    if not new_title:
        return jsonify({'error': '标题不能为空'}), 400

    work_dir = os.path.join(get_user_dir(username), 'works', work_id)
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

    work_dir = os.path.join(get_user_dir(username), 'works', work_id)
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


@app.route('/api/clear-cache', methods=['POST'])
@login_required
def clear_cache():
    """
    清空当前会话的内存结果 + 当前作品的图片目录 + 引用图缓存。
    生成分镜后调用, 防止旧作品图片残留到新作品里。
    """
    sid = get_session_id()
    username = session.get('username') or f'guest_{sid[:8]}'
    work_id = session.get('work_id')

    cleared = {'results': 0, 'output': 0, 'cache': 0, 'work_images': 0}

    # 1) 清 results/<sid>_*.json
    try:
        for fname in os.listdir(RESULTS_DIR):
            if fname.startswith(sid + '_') and fname.endswith('.json'):
                os.remove(os.path.join(RESULTS_DIR, fname))
                cleared['results'] += 1
    except Exception as e:
        print(f"clear results error: {e}")

    # 2) 清 static/output 中属于该会话的 (按URL里的session标识无法严格匹配, 这里清掉所有 .png/.jpg)
    try:
        if os.path.isdir(OUTPUT_DIR):
            for fname in os.listdir(OUTPUT_DIR):
                if fname.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')):
                    os.remove(os.path.join(OUTPUT_DIR, fname))
                    cleared['output'] += 1
    except Exception as e:
        print(f"clear output error: {e}")

    # 3) 清 static/cache 引用图缓存
    try:
        if os.path.isdir(CACHE_DIR):
            for fname in os.listdir(CACHE_DIR):
                fp = os.path.join(CACHE_DIR, fname)
                if os.path.isfile(fp):
                    os.remove(fp)
                    cleared['cache'] += 1
    except Exception as e:
        print(f"clear cache error: {e}")

    # 4) 清当前作品的 images 目录
    if work_id:
        try:
            images_dir = os.path.join(get_user_dir(username), 'works', work_id, 'images')
            if os.path.isdir(images_dir):
                for fname in os.listdir(images_dir):
                    os.remove(os.path.join(images_dir, fname))
                    cleared['work_images'] += 1
        except Exception as e:
            print(f"clear work images error: {e}")

    print(f"[clear-cache] sid={sid[:8]} work_id={(work_id or '-')[:8]} cleared={cleared}")
    return jsonify({'success': True, 'cleared': cleared})


@app.route('/api/download', methods=['POST'])
@login_required
def download_image_proxy():
    """代理下载图片，解决跨域下载问题"""
    data = request.json
    url = data.get('url', '')
    filename = data.get('filename', 'comic_image.png')
    
    if not url:
        return jsonify({'error': '缺少图片URL'}), 400
    
    try:
        if url.startswith('http'):
            response = _api_request('GET', url, timeout=60)
            image_data = BytesIO(response.content)
        elif url.startswith('/static'):
            local_path = os.path.join(BASE_DIR, url.lstrip('/'))
            image_data = BytesIO()
            with open(local_path, 'rb') as f:
                image_data.write(f.read())
            image_data.seek(0)
        elif url.startswith('data:image'):
            image_data = BytesIO()
            image_data.write(base64.b64decode(url.split(',')[1]))
            image_data.seek(0)
        else:
            return jsonify({'error': '不支持的URL格式'}), 400
        
        return send_file(
            image_data,
            mimetype='image/png',
            as_attachment=True,
            download_name=filename
        )
    except Exception as e:
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


@app.route('/api/results/<data_type>', methods=['GET'])
@login_required
def get_results(data_type):
    """获取当前会话的持久化数据，用于内网穿透断开后的恢复"""
    valid_types = ['segments', 'characters', 'images', 'full_pages', 'combined_pages', 'comic2novel']
    if data_type not in valid_types:
        return jsonify({'error': f'无效的类型，必须是: {valid_types}'}), 400

    data = load_session_data(data_type)
    if data is not None:
        return jsonify({'success': True, 'data': data})
    return jsonify({'success': False, 'data': None, 'message': '没有找到保存的数据'})


@app.route('/api/sync/results', methods=['POST'])
@login_required
def sync_results():
    """前端主动同步当前状态到服务器，用于内网穿透场景下的防丢失"""
    data = request.json or {}

    if 'segments' in data:
        save_session_data('segments', data['segments'])
    if 'characters' in data:
        save_session_data('characters', data['characters'])
    if 'generatedImages' in data:
        images_data = {'images': []}
        for key, url in data['generatedImages'].items():
            images_data['images'].append({
                'key': key,
                'local_url': url
            })
        save_session_data('images', images_data)
    if 'fullPageImages' in data:
        fp_clean = data.get('fullPageCleanImages') or {}
        fp_bubbles = data.get('fullPageBubbles') or {}
        fp_data = {'pages': []}
        for key, url in data['fullPageImages'].items():
            entry = {
                'key': key,
                'local_url': url,
            }
            if key in fp_clean:
                entry['clean_url'] = fp_clean[key]
            if key in fp_bubbles:
                entry['bubbles'] = fp_bubbles[key]
            fp_data['pages'].append(entry)
        save_session_data('full_pages', fp_data)
    if 'combinedPageImages' in data:
        cp_data = {'pages': []}
        for key, url in data['combinedPageImages'].items():
            cp_data['pages'].append({
                'key': key,
                'local_url': url
            })
        save_session_data('combined_pages', cp_data)

    return jsonify({'success': True})


def run_server():
    """Chaquopy (Android) 入口: 禁用 reloader, threaded 模式, 单进程.
    MainActivity 通过 module.callAttr('run_server') 调用."""
    _HOST = '127.0.0.1'  # 只在 Android 沙盒内访问, 不需要外部网络
    app.run(host=_HOST, port=2778, debug=False, use_reloader=False, threaded=True)


if __name__ == '__main__':
    clean_cache()
    migrate_legacy_output()
    # 启动横幅: 首次运行时打印随机生成的 admin 密码, 让用户能找到登录凭据
    print('=' * 60)
    print(f'[manga] admin user : {ADMIN_USERNAME}')
    if _ADMIN_PASSWORD_JUST_GENERATED:
        print(f'[manga] admin pass : {ADMIN_PASSWORD}  (随机生成, 已写入 .env)')
        print('[manga] 部署到公网前请修改 .env 中的 MANGA_ADMIN_PASSWORD')
    else:
        print(f'[manga] admin pass : <从 .env 读取>')
    print(f'[manga] secret_key : 来自 .env / os.urandom  (持久化到 .env)')
    print('=' * 60)

    # Android: WebView 自己加载 http://127.0.0.1:2778, 不需要打开系统浏览器
    if _IS_ANDROID:
        # Android 不走 if __name__ 入口 (Chaquopy 用 module.callAttr), 这里仅作完整性
        run_server()
    else:
        # Windows dev / PyInstaller: 自动打开浏览器 (debug 模式 reloader 会 fork 子进程,
        # 仅子进程打开避免重复); threaded=True 让长任务不阻塞 WebView 心跳
        def _open_browser_delayed():
            url = 'http://127.0.0.1:2778'
            print(f'[manga] opening browser: {url}')
            try:
                webbrowser.open(url)
            except Exception as e:
                print(f'[manga] auto-open browser failed: {e}; please visit {url} manually')

        if os.environ.get('WERKZEUG_RUN_MAIN') == 'true':
            threading.Timer(1.5, _open_browser_delayed).start()

        app.run(host='0.0.0.0', port=2778, debug=True, threaded=True)
