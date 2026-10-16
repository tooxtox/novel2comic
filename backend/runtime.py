"""Platform paths, environment, Flask instance and shared settings."""

import os
import secrets
import shutil
import sys
from flask import Flask
from flask_cors import CORS


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

_IS_ANDROID = hasattr(sys, 'getandroidapilevel')
_PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ========== 多平台兼容: Windows dev / PyInstaller / Android Chaquopy ==========
# 三个分支共享同一套 _RESOURCE_DIR (只读) 和 _PERSIST_DIR (可写) 命名.
# - dev: _RESOURCE_DIR = _PERSIST_DIR = 项目根目录
# - PyInstaller: _RESOURCE_DIR = _MEIPASS (解压临时目录), _PERSIST_DIR = exe 所在目录
# - Android Chaquopy: _RESOURCE_DIR = assets 解压目录 (环境变量传入),
#                    _PERSIST_DIR = app 私有沙盒 getFilesDir() (无需权限, 重装丢失)
if _IS_ANDROID:
    # Android: templates/ static/ fonts/ 以 APK assets 形式打包, Chaquopy 的
    # AssetFinder 只管 .pyc, Python 侧 os.path.isfile() 看不到 assets —— 所以
    # MainActivity.prepareResourceDir() 先把它们解压成真实文件, 再由
    # bootstrap.setup() 通过环境变量把路径传进来.
    _RESOURCE_DIR = (os.environ.get('T2C_RESOURCE_DIR')
                     or _PROJECT_DIR)
    _PERSIST_DIR = (os.environ.get('T2C_FILES_DIR')
                    or '/data/data/com.text2comic.app/files')
elif getattr(sys, 'frozen', False):
    _RESOURCE_DIR = sys._MEIPASS  # 只读: templates / static / 字体
    _PERSIST_DIR = os.path.dirname(os.path.abspath(sys.executable))  # 可写: .env / users.json / 生成图
else:
    _RESOURCE_DIR = _PROJECT_DIR
    _PERSIST_DIR = _RESOURCE_DIR


def _ensure_android_fonts():
    """Android: 把 _RESOURCE_DIR/fonts/ 下的思源黑体复制到 _PERSIST_DIR/fonts/.
    _get_chinese_font() 的候选路径直接读 _PERSIST_DIR, 此处确保字体就位.

    注意: 不能用 chaquopy.utils.copy_asset —— Chaquopy 17 没有这个模块,
    import 会静默失败, 字体永远拷不过来. _RESOURCE_DIR/fonts 是
    MainActivity 从 APK assets 解压出来的真实文件, 直接 copy 即可."""
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
        src = os.path.join(_RESOURCE_DIR, 'fonts', name)
        try:
            if os.path.isfile(src):
                shutil.copy2(src, dst)
            else:
                print(f'[font] missing source: {src}')
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

app = Flask('app', root_path=_RESOURCE_DIR, static_folder=None, template_folder=os.path.join(_RESOURCE_DIR, 'templates'))
app.secret_key = SECRET_KEY

# Session cookie 加固. 之前没设过 SameSite/HTTP_ONLY, 只能吃浏览器默认值.
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax',
    # 走 HTTPS (内网穿透/公网部署) 时应为 True; 本地 http 调试保持 False,
    # 否则浏览器在 http://127.0.0.1 上根本不会带 cookie, 登录直接失效.
    SESSION_COOKIE_SECURE=os.environ.get('T2C_SECURE_COOKIE', '').lower() in ('1', 'true', 'yes'),
)

# CORS 白名单.
# 之前是 CORS(app, supports_credentials=True) —— flask-cors 会把请求方任意 Origin
# 原样回显并附上 Access-Control-Allow-Credentials: true, 等于让**任意网站**都能
# 以当前登录用户的身份调用全部 /api/* (读历史、删作品、改配置).
# 本应用是同源的 (WebView / 本机浏览器直接打开 http://127.0.0.1:2778), 正常根本
# 不需要 CORS 头, 所以默认只放行本机来源; 需要跨机访问时用环境变量追加.
_allowed_origins = [
    'http://127.0.0.1:2778', 'http://localhost:2778',
    'http://127.0.0.1:2779', 'http://localhost:2779',
]
_extra_origins = os.environ.get('T2C_EXTRA_ORIGINS', '')
_allowed_origins += [o.strip() for o in _extra_origins.split(',') if o.strip()]
CORS(app,
     resources={r'/api/*': {'origins': _allowed_origins}},
     supports_credentials=True)

# WebSocket 已移除: 后端从未 emit 进度事件, 前端一律使用 fake progress
BASE_DIR = _PERSIST_DIR
CONFIG_LOCAL_PATH = os.path.join(BASE_DIR, 'config.local.json')
# Android 的内置配置由 APK assets 解压到资源目录, 用户保存的配置仍在 BASE_DIR.
CONFIG_TEMPLATE_PATH = os.path.join(_RESOURCE_DIR if _IS_ANDROID else BASE_DIR, 'config.json')

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

# 缓存有效期（7天）
CACHE_EXPIRE_DAYS = 7
