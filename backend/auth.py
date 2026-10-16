"""CSRF, login checks, authentication, page and static routes."""

import hmac
import re
import secrets
import socket
from .runtime import ADMIN_PASSWORD, ADMIN_USERNAME, app
from .storage import (
    _hash_password,
    _is_valid_work_id,
    _resolve_readable_static,
    _verify_password,
    get_user_dir,
    load_users,
    save_users,
)
from datetime import datetime
from flask import jsonify, render_template, request, send_file, session
from functools import wraps


# ========== CSRF 防护 ==========
# CORS 收紧后跨站读不到了, 但 SameSite=Lax 明确允许**跨站顶级 GET**,
# 且本应用里所有危险操作都可能被诱导触发, 所以变更类请求仍要带 CSRF token.
# token 存在 session 里, 由模板 <meta name="csrf-token"> 下发, 前端统一在
# fetch 拦截器里补 X-CSRF-Token 头 —— 不要依赖每个调用点手动加, 漏一个就静默 403.
_CSRF_SESSION_KEY = '_csrf_token'
# 未登录时无法持有 token, 这两个接口必须豁免, 否则所有人都注册/登录不了
_CSRF_EXEMPT_ENDPOINTS = {'/api/login', '/api/register'}


def _csrf_token():
    """取(或生成)当前 session 的 CSRF token"""
    token = session.get(_CSRF_SESSION_KEY)
    if not token:
        token = secrets.token_urlsafe(32)
        session[_CSRF_SESSION_KEY] = token
    return token


def _rotate_csrf_token():
    """登录/登出后轮换 token, 防止会话固定"""
    session.pop(_CSRF_SESSION_KEY, None)
    return _csrf_token()


app.jinja_env.globals['csrf_token'] = _csrf_token


@app.before_request
def _csrf_protect():
    """变更类 /api/* 请求校验 X-CSRF-Token"""
    if request.method in ('GET', 'HEAD', 'OPTIONS'):
        return None
    if not request.path.startswith('/api/'):
        return None
    if request.path in _CSRF_EXEMPT_ENDPOINTS:
        return None
    expected = session.get(_CSRF_SESSION_KEY)
    provided = request.headers.get('X-CSRF-Token', '')
    if not expected or not provided or not hmac.compare_digest(str(expected), str(provided)):
        return jsonify({'error': 'CSRF 校验失败，请刷新页面重试', 'csrf_failed': True}), 403
    return None

# ========== PyInstaller 兼容: 自定义 static 路由, 兼顾内置资源和用户生成文件 ==========
# Flask 默认的 /static 只服务 static_folder (此处 _MEIPASS/static), 但生成图在 BASE_DIR/static.
# static_folder=None 时 Flask 不注册 'static' 端点, 这里用 endpoint='static' 补上,
# 使模板里的 url_for('static', filename=...) 能正确生成 URL.
#
# 安全: 这条路由曾经是"任何人可读服务器上任意文件"的入口 ——
#   GET /static/../.env  -> 200 MANGA_SECRET_KEY + MANGA_ADMIN_PASSWORD (匿名可读)
# 因为 os.path.join(base,'static','../.env') 会归一化到 BASE_DIR/.env.
# 拿到 SECRET_KEY 就能伪造任意用户的 session cookie, 于是所有账号数据都形同虚设.
# 现在必须依次过三道关: realpath 包含性 -> 扩展名白名单 -> users/ 子树的可见性校验.
@app.route('/static/<path:filename>', endpoint='static')
def _pyinstaller_static(filename):
    from flask import abort
    # ⚠️ users/ 子树规则的不变量写在 _resolve_readable_static 里:
    #   只放行图片, 永不把 history.json / meta.json / state.json 直出.
    #   未来任何 url_for('static', filename='users/.../state.json') 都会在这里被 404 掉.
    candidate = _resolve_readable_static('/static/' + str(filename))
    if candidate:
        return send_file(candidate)
    abort(404)

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get('logged_in'):
            return jsonify({'error': '请先登录', 'need_login': True}), 401
        # 账号可能已被删除, 但 session cookie 还在 (它是客户端签名 cookie,
        # 生命周期完全由浏览器决定). 复查一次, 避免"账号没了还能读写其作品".
        username = session.get('username')
        if username and username != ADMIN_USERNAME:
            if username not in load_users():
                session.clear()
                return jsonify({'error': '账号不存在，请重新登录', 'need_login': True}), 401
        return f(*args, **kwargs)
    return decorated_function


def work_id_required(f):
    """校验 URL 里的 <work_id> 是严格 UUID.

    没有这道校验时, DELETE /api/history/.. 会 rmtree 掉调用者**整个账号目录**,
    而 /api/history/<别人的相对路径> 之类可被用来跨账号操作.
    路由里凡是拿 work_id 去 join 路径的, 都必须挂这个装饰器.
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not _is_valid_work_id(kwargs.get('work_id')):
            return jsonify({'error': '作品ID不合法'}), 400
        return f(*args, **kwargs)
    return decorated_function

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
def home():
    """默认入口: 登录页"""
    return render_template('login.html')


@app.route('/tooxtox')
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
        _rotate_csrf_token()
        return jsonify({'success': True, 'message': '登录成功', 'username': username, 'is_admin': True})

    # 2. 校验普通注册用户 (来自 users.json)
    users = load_users()
    user = users.get(username)
    if user and _verify_password(password, user.get('password_hash', ''), user.get('salt', '')):
        session['logged_in'] = True
        session['username'] = username
        session['is_admin'] = False
        _rotate_csrf_token()
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
