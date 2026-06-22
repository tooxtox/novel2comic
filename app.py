from flask import Flask, render_template, request, jsonify, send_file, session, redirect, url_for
from flask_cors import CORS
from flask_socketio import SocketIO, emit
from functools import wraps
import requests
import json
import os
import re
import time
import hashlib
import uuid
import secrets
import shutil
from datetime import datetime, timedelta
from io import BytesIO
import base64
from PIL import Image, ImageDraw, ImageFont

# ========== .env 加载 (python-dotenv 可选, 没装就用手写 mini 解析) ==========
ENV_FILE = os.path.join(os.path.dirname(__file__), '.env')


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

app = Flask(__name__, static_folder='static', template_folder='templates')
app.secret_key = SECRET_KEY
CORS(app, supports_credentials=True)

# WebSocket 实时进度推送
# async_mode='threading' 兼容同步 Flask, 无需 eventlet/gevent
socketio = SocketIO(app, cors_allowed_origins="*", manage_session=False, async_mode='threading')

BASE_DIR = os.path.dirname(__file__)
CONFIG_LOCAL_PATH = os.path.join(BASE_DIR, 'config.local.json')
CONFIG_TEMPLATE_PATH = os.path.join(BASE_DIR, 'config.json')

OUTPUT_DIR = os.path.join(BASE_DIR, 'static', 'output')
os.makedirs(OUTPUT_DIR, exist_ok=True)

# 参考图缓存目录
CACHE_DIR = os.path.join(os.path.dirname(__file__), 'static', 'cache')
os.makedirs(CACHE_DIR, exist_ok=True)

# 会话结果持久化目录（内网穿透场景下，先由主机接收再传给用户）
RESULTS_DIR = os.path.join(os.path.dirname(__file__), 'results')
os.makedirs(RESULTS_DIR, exist_ok=True)

# 用户作品永久保存目录（账号维度）
USER_DATA_DIR = os.path.join(os.path.dirname(__file__), 'static', 'users')
os.makedirs(USER_DATA_DIR, exist_ok=True)

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
    """获取当前会话绑定的作品ID（用户未显式创建时，使用session_id作为虚拟账号）"""
    sid = get_session_id()
    username = session.get('username') or f'guest_{sid[:8]}'
    return session.get('work_id'), username


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
        # 用URL的hash作为文件名，避免重复下载
        url_hash = hashlib.md5(url.encode()).hexdigest()[:12]
        
        # 检查缓存是否已存在
        for ext in ['.png', '.jpg', '.jpeg', '.webp']:
            cache_path = os.path.join(CACHE_DIR, f"{url_hash}{ext}")
            if os.path.exists(cache_path):
                # 更新访问时间
                os.utime(cache_path, None)
                return f"/static/cache/{url_hash}{ext}"
        
        # 下载图片
        img_data = None
        if url.startswith('http'):
            resp = requests.get(url, timeout=30)
            if resp.status_code == 200:
                img_data = resp.content
        elif url.startswith('/static'):
            local_path = os.path.join(os.path.dirname(__file__), url.lstrip('/'))
            if os.path.exists(local_path):
                with open(local_path, 'rb') as f:
                    img_data = f.read()
        elif url.startswith('data:image'):
            # base64格式
            parts = url.split(',')
            if len(parts) == 2:
                # 检测格式
                header = parts[0]
                if 'png' in header:
                    ext = '.png'
                elif 'webp' in header:
                    ext = '.webp'
                else:
                    ext = '.jpg'
                img_data = base64.b64decode(parts[1])
        
        if img_data:
            # 确定格式
            try:
                img = Image.open(BytesIO(img_data))
                ext = '.' + (img.format or 'PNG').lower()
                if ext == '.jpeg':
                    ext = '.jpg'
            except:
                ext = '.png'
            
            cache_path = os.path.join(CACHE_DIR, f"{url_hash}{ext}")
            with open(cache_path, 'wb') as f:
                f.write(img_data)
            
            print(f"Cached reference image for '{name}': /static/cache/{url_hash}{ext}")
            return f"/static/cache/{url_hash}{ext}"
        
    except Exception as e:
        print(f"Cache reference image error for '{name}': {e}")
    
    return None


def get_cached_image_base64(cache_url):
    """从缓存读取图片并转为base64"""
    if not cache_url:
        return None
    try:
        local_path = os.path.join(os.path.dirname(__file__), cache_url.lstrip('/'))
        if os.path.exists(local_path):
            with open(local_path, 'rb') as f:
                img_data = f.read()
            img_b64 = base64.b64encode(img_data).decode('utf-8')
            # 检测格式
            ext = os.path.splitext(local_path)[1].lower()
            if ext == '.png':
                mime = 'image/png'
            elif ext == '.webp':
                mime = 'image/webp'
            else:
                mime = 'image/jpeg'
            return f"data:{mime};base64,{img_b64}"
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
    """向所有客户端推送进度事件 (前端按 task_id 过滤)

    Args:
        task_id:  任务唯一ID (前端生成, 随请求传给后端)
        progress: 0-100 整数
        message:  进度描述文字
        stage:    可选的阶段标识 (如 'calling_llm', 'parsing', 'saving', 'done', 'error')
        extra:    可选的附加数据 dict
    """
    try:
        socketio.emit('task_progress', {
            'task_id': task_id,
            'progress': min(100, max(0, int(progress))),
            'message': str(message),
            'stage': stage or '',
            'extra': extra or {}
        })
    except Exception as e:
        print(f"[WebSocket] emit_progress error: {e}")


@socketio.on('connect')
def on_connect():
    """客户端连接时验证登录状态"""
    if not session.get('logged_in'):
        return False  # 拒绝未登录连接
    print(f"[WebSocket] client connected, sid={request.sid}")


@socketio.on('disconnect')
def on_disconnect():
    print(f"[WebSocket] client disconnected, sid={request.sid}")


@app.route('/')
def index():
    if not session.get('logged_in'):
        return render_template('login.html')
    return render_template('index.html')

@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    username = data.get('username', '')
    password = data.get('password', '')
    
    if username == ADMIN_USERNAME and password == ADMIN_PASSWORD:
        session['logged_in'] = True
        session['username'] = username
        return jsonify({'success': True, 'message': '登录成功'})
    return jsonify({'success': False, 'error': '用户名或密码错误'}), 401

@app.route('/api/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'success': True, 'message': '已退出登录'})

@app.route('/api/check-auth', methods=['GET'])
def check_auth():
    if session.get('logged_in'):
        return jsonify({'logged_in': True, 'username': session.get('username')})
    return jsonify({'logged_in': False})

@app.route('/api/segment', methods=['POST'])
@login_required
def segment_novel():
    data = request.json
    text = data.get('text', '')
    api_url = data.get('api_url', '')
    api_key = data.get('api_key', '')
    model = data.get('model', '')
    segments_per_page = data.get('segments_per_page', 4)
    task_id = data.get('task_id', '')

    if not text or not api_url:
        return jsonify({'error': '缺少必要参数'}), 400

    emit_progress(task_id, 5, '正在构建分镜提示词...', 'building_prompt')

    prompt = f"""将以下小说转换漫画分镜，每页{segments_per_page}个分镜。同时提取所有主要出场角色。只返回JSON，无解释。

小说：
{text[:4000]}

每个分镜必须输出以下字段，camera_angle/composition/mood/shot_scale/lighting/of_type 必须从给定枚举中选一个（最贴近情节的）：
- scene_description: 简短场景描述（中文，20字内）
- dialogue: 角色对白或旁白。**漫画的灵魂是对白, 至少 60% 的分镜都要有实际对白, 写一句就行, 不要空着**
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
  "pages":[{{"page_number":1,"segments":[{{"segment_number":1,"scene_description":"<此处填实际场景描述>","dialogue":"<此处填实际对白, 若该格无对白则填空字符串>","shot_type":"特写","camera_angle":"平视","composition":"三分法","mood":"紧张","shot_scale":"特写","lighting":"硬光","of_type":"静态"}}]}}],
  "characters":[
    {{"name":"角色A","description":"黑发少年，黑色风衣","personality":"冷静沉着"}},
    {{"name":"角色B","description":"银发少女，白色连衣裙","personality":"活泼开朗"}}
  ]
}}

⚠️ 重要提醒：
1. dialogue 字段必须填入小说中**实际的对白文字**(中文), 千万不要照抄示例里的"..."或"<...>"; 无对白的分镜才填 ""
2. scene_description 同理, 必须是该分镜自己的中文描述(20字内)
3. 每个分镜都要独立思考: 这个镜头里人物在说话吗? 在说什么?
4. 漫画分镜的对话是灵魂, 占比 ≥ 60% 的分镜都应带有 dialogue
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

        response = requests.post(api_url, headers=headers, json=payload, timeout=300)
        print(f"Response status: {response.status_code}")
        print(f"Response headers: {dict(response.headers)}")
        print(f"Response text: {response.text}")
        response.raise_for_status()
        result = response.json()

        emit_progress(task_id, 70, 'LLM 返回结果, 正在解析 JSON...', 'parsing')

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

        print(f"Extracted content length: {len(content)}")

        content = re.sub(r'```json\s*', '', content)
        content = re.sub(r'```\s*', '', content)
        content = content.strip()

        def repair_json(json_str):
            result = []
            in_string = False
            escape_next = False
            i = 0
            while i < len(json_str):
                char = json_str[i]
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
                i += 1
            return ''.join(result)

        def _post_process(parsed):
            """解析成功后: 补全分镜字段 + 同步角色到 session, 返回 (pages, characters)"""
            # 补全分镜字段
            for page in parsed.get('pages', []):
                for seg in page.get('segments', []):
                    if 'style_prompt' not in seg:
                        seg['style_prompt'] = 'ABSOLUTELY NO COLOR, no watermark, no signature, no text overlay. Strict black and white manga, pure monochrome, detailed ink drawing'
                    for k, dv in (('camera_angle', '平视'), ('composition', '三分法'), ('mood', ''),
                                  ('shot_scale', ''), ('lighting', ''), ('of_type', '静态')):
                        if k not in seg or seg.get(k) is None:
                            seg[k] = dv
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

        try:
            parsed = json.loads(content)
            chars = _post_process(parsed)
            parsed = _clean_placeholder_dialogue(parsed)
            save_session_data('segments', parsed)
            emit_progress(task_id, 95, '分镜解析完成, 正在保存...', 'saving')
            return jsonify({'success': True, 'data': parsed, 'characters': chars})
        except json.JSONDecodeError as e1:
            print(f"First JSON parse error: {e1}")
            try:
                repaired = repair_json(content)
                parsed = json.loads(repaired)
                chars = _post_process(parsed)
                parsed = _clean_placeholder_dialogue(parsed)
                save_session_data('segments', parsed)
                emit_progress(task_id, 95, '分镜解析完成, 正在保存...', 'saving')
                return jsonify({'success': True, 'data': parsed, 'characters': chars})
            except json.JSONDecodeError as e2:
                print(f"Second JSON parse error: {e2}")
                json_match = re.search(r'\{[\s\S]*\}', content)
                if json_match:
                    try:
                        repaired_match = repair_json(json_match.group())
                        parsed = json.loads(repaired_match)
                        chars = _post_process(parsed)
                        parsed = _clean_placeholder_dialogue(parsed)
                        save_session_data('segments', parsed)
                        emit_progress(task_id, 95, '分镜解析完成, 正在保存...', 'saving')
                        return jsonify({'success': True, 'data': parsed, 'characters': chars})
                    except json.JSONDecodeError as e3:
                        print(f"Third JSON parse error: {e3}")
                emit_progress(task_id, 0, 'JSON 解析失败', 'error')
                return jsonify({'error': f'JSON解析失败，请重试或检查小说内容', 'detail': str(e1)}), 500

    except Exception as e:
        import traceback
        print(f"Error: {str(e)}")
        print(traceback.format_exc())
        emit_progress(task_id, 0, f'分镜生成失败: {e}', 'error')
        return jsonify({'error': str(e)}), 500


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
    
    response = requests.post(api_url, headers=headers, json=payload, timeout=300)
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
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            filename = f"{prefix}_{timestamp}.png"
            filepath = os.path.join(images_dir, filename)

            img_response = requests.get(image_url, timeout=120)
            img_response.raise_for_status()

            with open(filepath, 'wb') as f:
                f.write(img_response.content)

            # 返回以 /static/ 为前缀的URL
            rel_path = os.path.relpath(filepath, os.path.join(os.path.dirname(__file__), 'static'))
            local_url = '/static/' + rel_path.replace(os.sep, '/')
            print(f"Saved to work dir: {local_url}")
            return local_url, None
        except Exception as e:
            print(f"Failed to download external image: {e}")
            return image_url, None

    # base64数据保存到本地
    if image_url.startswith('data:image') or len(image_url) > 1000:
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f"{prefix}_{timestamp}.png"
        filepath = os.path.join(images_dir, filename)

        if image_url.startswith('data:image'):
            image_data = image_url.split(',')[1]
        else:
            image_data = image_url

        with open(filepath, 'wb') as f:
            f.write(base64.b64decode(image_data))

        rel_path = os.path.relpath(filepath, os.path.join(os.path.dirname(__file__), 'static'))
        local_url = '/static/' + rel_path.replace(os.sep, '/')
        return local_url, None

    return None, {'error': '无法获取图片'}


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


@app.route('/api/generate-image', methods=['POST'])
@login_required
def generate_image():
    data = request.json
    prompt = data.get('prompt', '')
    api_url = data.get('api_url', '')
    api_key = data.get('api_key', '')
    model = data.get('model', '')
    negative_prompt = data.get('negative_prompt', 'color, colorful, vibrant, chromatic, saturated, blurry, low quality, distorted, watermark, signature, text overlay, logo')
    style_tags = data.get('style_tags', '').strip()
    # 向后兼容: 优先 character_references, 回退 references (新字段名)
    character_references = data.get('character_references') or data.get('references') or []
    # 参考强度 (0-1, 默认 0.6)
    reference_strength = data.get('reference_strength', 0.6)
    try:
        reference_strength = float(reference_strength)
    except (TypeError, ValueError):
        reference_strength = 0.6
    reference_strength = max(0.0, min(1.0, reference_strength))
    page_idx = data.get('page_idx')
    seg_idx = data.get('seg_idx')
    task_id = data.get('task_id', '')

    if not prompt or not api_url:
        return jsonify({'error': '缺少必要参数'}), 400

    emit_progress(task_id, 10, '正在构建提示词和准备参考图...', 'preparing')

    # 任务2: 结构化字段(camera_angle/composition/mood/shot_scale/lighting/of_type)升级 prompt
    structured_fields = {
        'camera_angle': data.get('camera_angle', ''),
        'composition': data.get('composition', ''),
        'mood': data.get('mood', ''),
        'shot_scale': data.get('shot_scale', ''),
        'lighting': data.get('lighting', ''),
        'of_type': data.get('of_type', ''),
    }
    # 只在至少有一个结构化字段非空时才升级
    if any((v or '').strip() for v in structured_fields.values()):
        # 把前端传来的 style_prompt 字段合并进来 (若未传, 则以原 prompt 作为 base)
        structured_fields['style_prompt'] = data.get('style_prompt') or prompt
        upgraded = upgrade_segment_prompt(structured_fields)
        if upgraded:
            # 升级后的 prompt 取代原始 prompt
            prompt = upgraded
            print(f"[Task2] Upgraded prompt with structured tags: {[k for k,v in structured_fields.items() if k != 'style_prompt' and (v or '').strip()]}")

    style_suffix = f", {style_tags}" if style_tags else ""
    manga_prompt = f"ABSOLUTELY NO COLOR, no watermark, no signature, no text overlay. Strict black and white manga, pure monochrome, grayscale only. detailed ink drawing, high contrast, dramatic shadows, cross-hatching{style_suffix}, {prompt}"

    # 构建角色设定文本
    if character_references and len(character_references) > 0:
        # 根据 reference_strength 生成不同强度的提示
        if reference_strength >= 0.8:
            ref_weight_hint = "CRITICAL (high weight): Reference characters' appearance MUST be preserved EXACTLY — identical facial features, body proportions, clothing, hair color and style. Any deviation is unacceptable."
        elif reference_strength >= 0.5:
            ref_weight_hint = "IMPORTANT (medium weight): Reference characters' appearance should be strongly preserved — keep core facial features, hair, and clothing consistent."
        elif reference_strength > 0.0:
            ref_weight_hint = "(low weight) Reference characters should be loosely inspired by the references — main identity should be recognizable but variations are allowed."
        else:
            ref_weight_hint = ""

        char_sheet = []
        for char in character_references:
            name = char.get('name', '')
            desc = char.get('description', '')
            char_sheet.append(f"[CHARACTER: {name}]\nAPPEARANCE: {desc}\nThis character MUST appear exactly as described above.")

        char_section = "\n\n=== CHARACTER REFERENCE SHEET (reference_strength={:.2f}) ===\n".format(reference_strength) + "\n\n".join(char_sheet) + (f"\n\n{ref_weight_hint}" if ref_weight_hint else "\n\nAll characters' appearance MUST strictly follow the descriptions above.")
        manga_prompt += char_section

    # 准备参考图片（缓存到本地后转base64）
    ref_images = prepare_ref_images(character_references)

    try:
        payload = {
            'model': model or 'doubao-seedream-4-5-251128',
            'prompt': manga_prompt,
            'size': '2K',
            'response_format': 'url',
            'watermark': False,
        }

        # 参考图片通过image字段传入（支持单图字符串或多图数组）
        if ref_images:
            if len(ref_images) == 1:
                payload['image'] = ref_images[0]
            else:
                payload['image'] = ref_images
            # 顺带把 reference_strength 传给API（部分实现支持此字段）
            payload['reference_strength'] = reference_strength
            print(f"Included {len(ref_images)} reference image(s) in API payload (strength={reference_strength:.2f})")

        emit_progress(task_id, 30, '正在调用图像生成 API (可能需要 10-60 秒)...', 'calling_image_api')

        image_url, result = call_image_api(api_url, api_key, payload)
        work_id, work_username = get_current_work_id()

        emit_progress(task_id, 75, '图片生成完成, 正在下载保存...', 'downloading')

        local_url, error = save_image_result(image_url, "manga", work_id, work_username)

        if local_url:
            # 持久化图片映射（内网穿透恢复用）
            if page_idx is not None and seg_idx is not None:
                images_data = load_session_data('images') or {'images': []}
                images_data['images'].append({
                    'key': f'{page_idx}-{seg_idx}',
                    'local_url': local_url,
                    'timestamp': datetime.now().isoformat()
                })
                save_session_data('images', images_data)
            emit_progress(task_id, 100, '图片生成完成', 'done')
            return jsonify({'success': True, 'image_url': local_url})
        else:
            emit_progress(task_id, 0, '图片生成失败', 'error')
            return jsonify({'error': error.get('error', '无法获取图片'), 'raw': result}), 500

    except Exception as e:
        import traceback
        print(f"Image generation error: {str(e)}")
        print(traceback.format_exc())
        emit_progress(task_id, 0, f'图片生成失败: {e}', 'error')
        return jsonify({'error': str(e)}), 500


@app.route('/api/check-text-garble', methods=['POST'])
@login_required
def check_text_garble():
    """检测图片中的文字是否乱码"""
    data = request.json
    image_url = data.get('image_url', '')
    api_url = data.get('api_url', '')
    api_key = data.get('api_key', '')
    model = data.get('model', '')
    task_id = data.get('task_id', '')

    if not image_url or not api_url:
        return jsonify({'error': '缺少必要参数'}), 400

    try:
        emit_progress(task_id, 10, '正在读取图片...', 'reading_image')
        # 读取图片转base64
        if image_url.startswith('/static/'):
            # 本地文件
            file_path = os.path.join(os.path.dirname(__file__), image_url[1:])  # 去掉开头的/
            if os.path.exists(file_path):
                with open(file_path, 'rb') as f:
                    img_data = base64.b64encode(f.read()).decode('utf-8')
                image_base64 = f"data:image/png;base64,{img_data}"
            else:
                return jsonify({'error': f'图片文件不存在: {file_path}'}), 404
        elif image_url.startswith('http'):
            # 下载远程图片
            resp = requests.get(image_url, timeout=30)
            resp.raise_for_status()
            img_data = base64.b64encode(resp.content).decode('utf-8')
            image_base64 = f"data:image/png;base64,{img_data}"
        else:
            return jsonify({'error': '不支持的图片URL格式'}), 400

        # 调用LLM视觉模型检测乱码
        headers = {'Content-Type': 'application/json'}
        if api_key:
            headers['Authorization'] = f'Bearer {api_key}'

        prompt = """请检查这张漫画图片中的文字（对话气泡、旁白框、音效文字等）是否存在以下问题：
1. 文字完全乱码（无法辨认的符号、乱码字符）
2. 文字部分乱码（有些字是乱码，有些字正常）
3. 文字正常（清晰可读的中文字符）

请只返回JSON格式：
{
  "has_garble": true/false,
  "garble_level": "none"/"partial"/"full",
  "description": "简要描述文字状况"
}

如果图片中没有文字，返回 {"has_garble": false, "garble_level": "none", "description": "图片中没有文字"}"""

        payload = {
            'model': model or 'minimax-vl',
            'messages': [
                {
                    'role': 'user',
                    'content': [
                        {'type': 'text', 'text': prompt},
                        {'type': 'image_url', 'image_url': {'url': image_base64}}
                    ]
                }
            ],
            'max_tokens': 500,
            'temperature': 0.3
        }

        print(f"[GarbleCheck] Calling LLM: {api_url}, model: {payload['model']}")
        emit_progress(task_id, 40, '正在调用视觉模型检测...', 'calling_llm')
        response = requests.post(api_url, headers=headers, json=payload, timeout=60)
        response.raise_for_status()
        result = response.json()

        emit_progress(task_id, 80, '正在解析检测结果...', 'parsing')
        # 解析返回
        content = ''
        if 'choices' in result and len(result['choices']) > 0:
            content = result['choices'][0].get('message', {}).get('content', '')
        elif 'data' in result:
            content = str(result['data'])

        # 提取JSON
        content = re.sub(r'```json\s*', '', content)
        content = re.sub(r'```\s*', '', content)
        content = content.strip()

        try:
            analysis = json.loads(content)
        except:
            # 尝试从文本中提取JSON
            match = re.search(r'\{[^}]+\}', content)
            if match:
                analysis = json.loads(match.group())
            else:
                analysis = {'has_garble': False, 'garble_level': 'none', 'description': content}

        print(f"[GarbleCheck] Result: {analysis}")
        emit_progress(task_id, 100, '检测完成', 'done')
        return jsonify({'success': True, 'analysis': analysis})

    except Exception as e:
        import traceback
        print(f"[GarbleCheck] Error: {e}")
        print(traceback.format_exc())
        return jsonify({'error': str(e)}), 500


@app.route('/api/fix-text-garble', methods=['POST'])
@login_required
def fix_text_garble():
    """以原图为参考, 重新生成图片以修复文字乱码 (只修改文字部分, 保持构图)"""
    data = request.json
    image_url = data.get('image_url', '')
    original_prompt = data.get('original_prompt', '')
    api_url = data.get('api_url', '')  # 保留参数兼容前端, 但不再使用
    api_key = data.get('api_key', '')
    model = data.get('model', '')
    img_api_url = data.get('img_api_url', '')
    img_api_key = data.get('img_api_key', '')
    img_model = data.get('img_model', '')
    page_idx = data.get('page_idx')
    seg_idx = data.get('seg_idx')
    task_id = data.get('task_id', '')

    if not image_url or not img_api_url:
        return jsonify({'error': '缺少必要参数 (image_url / img_api_url)'}), 400

    if not original_prompt:
        return jsonify({'error': '缺少 original_prompt (分镜原文)'}), 400

    try:
        emit_progress(task_id, 10, '正在读取原图作为参考...', 'reading_image')

        # 1. 用现有 helper 把原图缓存到本地并转为 data URL 格式
        # (火山引擎 API 的 image 字段需要 data:image/...;base64,... 格式, 不能是 raw base64)
        cache_url = cache_reference_image(image_url, "garble_original")
        if not cache_url:
            return jsonify({'error': f'无法缓存原图: {image_url}'}), 500

        ref_image_data_url = get_cached_image_base64(cache_url)
        if not ref_image_data_url:
            return jsonify({'error': '读取原图 base64 失败'}), 500

        # 2. 构建修复 prompt: 强调保持原图构图, 只修复文字
        # 使用分镜原文作为内容描述, 并明确要求保持与参考图一致的构图和角色
        fix_prompt = (
            f"Keep the exact same composition, layout, character poses, and scene as the reference image. "
            f"Only fix the text/speech bubbles. "
            f"Scene: {original_prompt}"
        )

        manga_prompt = (
            f"ABSOLUTELY NO COLOR, no watermark, no signature. Strict black and white manga, "
            f"pure monochrome, grayscale only. detailed ink drawing, high contrast, dramatic shadows, "
            f"cross-hatching. {fix_prompt}"
        )

        # 3. 调用图像 API, 传入原图作为参考 (高 reference_strength 保持构图)
        print(f"[FixGarble] Regenerating with original image as reference (strength=0.85)...")
        emit_progress(task_id, 30, '正在调用图像 API (以原图为参考)...', 'regenerating')

        img_payload = {
            'model': img_model or 'doubao-seedream-3-0-t2i-250415',
            'prompt': manga_prompt,
            'size': '2K',
            'response_format': 'url',
            'watermark': False,
            'image': ref_image_data_url,        # data URL 格式的原图
            'reference_strength': 0.85,         # 高强度保持构图, 只修改细节 (文字)
        }

        image_url_new, result_new = call_image_api(img_api_url, img_api_key, img_payload)
        work_id, work_username = get_current_work_id()
        local_url, error = save_image_result(image_url_new, "manga_fixed", work_id, work_username)

        if local_url:
            emit_progress(task_id, 95, '修复图片已保存, 等待用户确认...', 'saving')
            # 保存图片映射: seg_idx 为 None 时表示整页修复, 存到 full_pages
            if page_idx is not None and seg_idx is not None:
                images_data = load_session_data('images') or {'images': []}
                images_data['images'].append({
                    'key': f'{page_idx}-{seg_idx}',
                    'local_url': local_url,
                    'timestamp': datetime.now().isoformat(),
                    'fixed': True
                })
                save_session_data('images', images_data)
            elif page_idx is not None:
                # 整页修复: 保存到 full_pages
                full_pages_data = load_session_data('full_pages') or {'pages': []}
                full_pages_data['pages'].append({
                    'key': page_idx,
                    'local_url': local_url,
                    'timestamp': datetime.now().isoformat(),
                    'fixed': True
                })
                save_session_data('full_pages', full_pages_data)

            emit_progress(task_id, 100, '修复完成, 请在前端预览确认', 'done')
            return jsonify({
                'success': True,
                'image_url': local_url,
                'analysis': {
                    'garble_cause': '以原图为参考重新生成, 保持构图只修复文字',
                    'fix_strategy': 'reference_strength=0.85',
                    'description': '以原图为参考, 只修改文字部分'
                },
                'fixed_prompt': fix_prompt
            })
        else:
            emit_progress(task_id, 0, f'修复失败: {error.get("error", "")}', 'error')
            return jsonify({'error': error.get('error', '重新生成失败'), 'raw': result_new}), 500

    except Exception as e:
        import traceback
        print(f"[FixGarble] Error: {e}")
        print(traceback.format_exc())
        return jsonify({'error': str(e)}), 500


@app.route('/api/accept-garble-fix', methods=['POST'])
@login_required
def accept_garble_fix():
    """用户确认采用修复后的图片: 用 fixed 文件覆盖原文件 (或更新映射), 并同步会话数据
    支持 segment 级 (seg_idx 不为 None) 和 page 级 (seg_idx 为 None) 两种模式"""
    data = request.json
    page_idx = data.get('page_idx')
    seg_idx = data.get('seg_idx')
    fixed_image_url = data.get('fixed_image_url', '')
    original_image_url = data.get('original_image_url', '')

    if not fixed_image_url or page_idx is None:
        return jsonify({'error': '缺少必要参数'}), 400

    try:
        base_dir = os.path.dirname(__file__)

        def _abs_path(url):
            if not url or not url.startswith('/static/'):
                return None
            return os.path.join(base_dir, url[1:])

        fixed_abs = _abs_path(fixed_image_url)
        if not fixed_abs or not os.path.exists(fixed_abs):
            return jsonify({'error': f'修复图片文件不存在: {fixed_image_url}'}), 404

        # 策略: 优先把 fixed 文件内容写到原文件位置 (保留原 URL, 这样前端映射不变)
        # 如果原文件不存在或不是本地文件, 则改用 fixed 的 URL 作为新 URL
        new_url = fixed_image_url
        original_abs = _abs_path(original_image_url)
        if original_abs and os.path.exists(original_abs):
            try:
                # 备份原文件 (可选, 加 .bak 后缀)
                bak_path = original_abs + '.bak'
                if not os.path.exists(bak_path):
                    shutil.copy2(original_abs, bak_path)
                # 覆盖原文件
                shutil.copy2(fixed_abs, original_abs)
                new_url = original_image_url  # 原 URL 现在指向新内容
                print(f"[AcceptGarbleFix] Overwritten: {original_abs} (backup: {bak_path})")
            except Exception as copy_err:
                print(f"[AcceptGarbleFix] Overwrite failed, fallback to new URL: {copy_err}")
                new_url = fixed_image_url
        else:
            # 原图不是本地文件, 直接用 fixed URL
            new_url = fixed_image_url

        # 根据模式更新会话数据
        if seg_idx is not None:
            # segment 级: 更新 images 映射
            key = f'{page_idx}-{seg_idx}'
            images_data = load_session_data('images') or {'images': []}
            images_data['images'] = [item for item in images_data['images'] if item.get('key') != key]
            images_data['images'].append({
                'key': key,
                'local_url': new_url,
                'timestamp': datetime.now().isoformat(),
                'fixed': True,
                'accepted': True
            })
            save_session_data('images', images_data)
        else:
            # page 级: 更新 full_pages 映射
            full_pages_data = load_session_data('full_pages') or {'pages': []}
            full_pages_data['pages'] = [item for item in full_pages_data.get('pages', []) if item.get('key') != page_idx]
            full_pages_data['pages'].append({
                'key': page_idx,
                'local_url': new_url,
                'timestamp': datetime.now().isoformat(),
                'fixed': True,
                'accepted': True
            })
            save_session_data('full_pages', full_pages_data)

        # 兜底: 如果 original_image_url 在 full_pages 里 (且不是当前 page_idx), 也更新
        full_pages_data = load_session_data('full_pages') or {'pages': []}
        updated_fp = False
        for item in full_pages_data.get('pages', []):
            if item.get('local_url') == original_image_url and item.get('key') != page_idx:
                item['local_url'] = new_url
                item['accepted'] = True
                updated_fp = True
        if updated_fp:
            save_session_data('full_pages', full_pages_data)

        return jsonify({
            'success': True,
            'new_url': new_url,
            'message': '原图已被修复版本覆盖' if new_url == original_image_url else '已采用修复图作为新图'
        })

    except Exception as e:
        import traceback
        print(f"[AcceptGarbleFix] Error: {e}")
        print(traceback.format_exc())
        return jsonify({'error': str(e)}), 500


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
        response = requests.post(api_url, headers=headers, json=payload, timeout=300)
        response.raise_for_status()
        result = response.json()

        emit_progress(task_id, 75, 'LLM 返回结果, 正在解析...', 'parsing')

        content = ''
        if 'choices' in result and len(result['choices']) > 0:
            choice = result['choices'][0]
            if 'message' in choice:
                content = choice['message']['content']

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

    if not description or not api_url:
        return jsonify({'error': '缺少必要参数'}), 400

    last_error = None
    for attempt in range(1, max_attempts + 1):
        # 有自定义 prompt 就始终用它 (不区分第几次)
        if custom_prompt:
            prompt = custom_prompt.rstrip('.') + f", {name}, {description}. Strictly black and white manga, no color, pure monochrome."
        elif attempt == 1:
            prompt = f"ABSOLUTELY NO COLOR, no watermark, no signature, no text overlay. Strict black and white manga character design sheet, pure monochrome, grayscale. full body portrait, {name}, {description}, detailed line art, high contrast, dramatic shading, cross-hatching, single character only, plain background, reference sheet style"
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
                    return jsonify({
                        'success': True,
                        'image_url': local_url,
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


def download_image(url):
    try:
        if url.startswith('http'):
            response = requests.get(url, timeout=30)
            return Image.open(BytesIO(response.content))
        elif url.startswith('/static'):
            local_path = os.path.join(os.path.dirname(__file__), url.lstrip('/'))
            return Image.open(local_path)
        elif url.startswith('data:image'):
            image_data = url.split(',')[1]
            return Image.open(BytesIO(base64.b64decode(image_data)))
    except Exception as e:
        print(f"Download image error: {e}")
        return None


# ============ 任务3: 自适应网格 + 4 种对话气泡 ============

def compute_grid_layout(panel_count, canvas_w=None, canvas_h=None, gap=4, manual_layout=None):
    """依据 panel_count 自动选择 N×M 布局, 返回 [{x,y,w,h}] 列表 (像素坐标).

    规则:
      1→1x1, 2→2x1, 3→3x1, 4→2x2, 5→3+2(2行), 6→3x2,
      7→4+3, 8→4x2, 9→3x3, 10-12→4x3, 13-16→4x4.

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
    rows_map = {1: 1, 2: 1, 3: 1, 4: 2, 5: 2, 6: 2, 7: 2, 8: 2, 9: 3, 10: 3, 11: 3, 12: 3, 13: 4, 14: 4, 15: 4, 16: 4}
    cols_map = {1: 1, 2: 2, 3: 3, 4: 2, 5: 3, 6: 3, 7: 4, 8: 4, 9: 3, 10: 4, 11: 4, 12: 4, 13: 4, 14: 4, 15: 4, 16: 4}
    rows = rows_map.get(panel_count, max(1, (panel_count + 3) // 4))
    cols = cols_map.get(panel_count, min(4, (panel_count + rows - 1) // rows))

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
    """把 text 折行 + 缩字号, 直到能装进 (max_width, max_height) 盒子. 返回 (lines, font)."""
    if not text:
        return [], font
    # 1) 拆行 (中英文混合按字符切, 一行尽量塞满 max_width)
    def measure(s):
        try:
            l, t, r, b = draw.textbbox((0, 0), s, font=font)
            return r - l, b - t
        except Exception:
            return len(s) * 8, 14

    chars = list(text.replace('\n', ''))
    lines, cur = [], ''
    for ch in chars:
        candidate = cur + ch
        w, _ = measure(candidate)
        if w <= max_width - 8:  # 内边距
            cur = candidate
        else:
            if cur:
                lines.append(cur)
            cur = ch
    if cur:
        lines.append(cur)

    # 2) 折行后若总高超过 max_height, 缩小字号
    cur_font = font
    while lines and cur_font:
        try:
            _, line_h = measure('国')
        except Exception:
            line_h = 14
        total_h = line_h * len(lines)
        if total_h <= max_height - 4:
            break
        # 缩小字号 (PIL truetype 才能取 size)
        try:
            new_size = max(8, int(cur_font.size * 0.9))
            cur_font = ImageFont.truetype(cur_font.path, new_size) if hasattr(cur_font, 'path') else cur_font
        except Exception:
            break

    return lines, cur_font


def _draw_text_centered(draw, text, font, x, y, w, h, fill='black'):
    """在 (x,y,w,h) 矩形中居中绘制多行文字"""
    if not text:
        return
    # 用单行 measure 估算行高
    try:
        _, lh = draw.textbbox((0, 0), '国', font=font)
        line_h = lh + 2
    except Exception:
        line_h = 16
    lines, fitted_font = fit_text_to_box(text, font, w, h, draw)
    if fitted_font:
        font = fitted_font
    total_h = line_h * len(lines)
    start_y = y + max(0, (h - total_h) // 2)
    for i, line in enumerate(lines):
        try:
            lw, _ = draw.textbbox((0, 0), line, font=font)
        except Exception:
            lw = len(line) * 8
        tx = x + max(0, (w - lw) // 2)
        draw.text((tx, start_y + i * line_h), line, fill=fill, font=font)


def _draw_rounded_rect(draw, xy, radius, outline='black', fill='white', width=2):
    """Pillow 旧版没有 rounded_rectangle 时的回退实现"""
    try:
        draw.rounded_rectangle(xy, radius=radius, outline=outline, fill=fill, width=width)
    except AttributeError:
        # 退化: 画矩形
        draw.rectangle(xy, outline=outline, fill=fill, width=width)


def _bubble_speech_tail(draw, x, y, w, h, direction='bl', size=20):
    """对话气泡的小尖角 (尾巴) 指向左下"""
    if direction == 'bl':
        # 尖角在底边偏左
        tip_x = x + w * 0.25
        tip_y = y + h + size
        draw.polygon([
            (x + w * 0.1, y + h - 1),
            (x + w * 0.4, y + h - 1),
            (tip_x, tip_y)
        ], fill='white', outline='black')


def draw_dialogue_bubble(draw, x, y, w, h, text, font, overflow=True, canvas_bounds=None):
    """普通对话气泡: 圆角矩形 + 尾巴"""
    # 越界裁剪: 暂时不裁剪 (overflow=True), 但留出尖角位置
    if not overflow and canvas_bounds:
        cb_x, cb_y, cb_w, cb_h = canvas_bounds
        x = max(cb_x, min(x, cb_x + cb_w - w))
        y = max(cb_y, min(y, cb_y + cb_h - h))
    # 白底黑边圆角矩形
    _draw_rounded_rect(draw, [x, y, x + w, y + h], radius=10, outline='black', fill='white', width=2)
    # 尾巴 (指向下方)
    _bubble_speech_tail(draw, x, y, w, h, direction='bl', size=int(h * 0.3))
    # 文字居中
    _draw_text_centered(draw, text, font, x + 4, y + 2, w - 8, h - 4)


def draw_thought_bubble(draw, x, y, w, h, text, font, overflow=True, canvas_bounds=None):
    """心理/思考气泡: 云形 (用多个小圆模拟) + 小圆尾巴"""
    # 用交错的小圆组成云边
    n_h = max(2, h // 20)
    n_w = max(2, w // 20)
    cloud_color = 'white'
    edge_color = 'black'
    # 主体: 多个小圆覆盖矩形范围
    r = min(h, w) // 8
    for i in range(n_h):
        for j in range(n_w):
            cx = x + r + j * (w - 2 * r) // max(1, n_w - 1) if n_w > 1 else x + w // 2
            cy = y + r + i * (h - 2 * r) // max(1, n_h - 1) if n_h > 1 else y + h // 2
            draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=cloud_color, outline=edge_color, width=2)
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


# 气泡分发表
BUBBLE_DRAWERS = {
    'dialogue': draw_dialogue_bubble,
    'thought': draw_thought_bubble,
    'shout': draw_shout_bubble,
    'narration': draw_narration_bubble,
}


def render_panel_bubble(draw, panel_box, seg, font, overflow=True, canvas_bounds=None):
    """按 seg.dialogue_type 选择气泡绘制器, 自动定位到 panel 内/可越界"""
    dialogue = (seg.get('dialogue') or '').strip()
    if not dialogue:
        return
    dtype = (seg.get('dialogue_type') or 'dialogue').lower()
    if dtype not in BUBBLE_DRAWERS:
        dtype = 'dialogue'

    px, py, pw, ph = panel_box['x'], panel_box['y'], panel_box['w'], panel_box['h']

    # 气泡尺寸: 不超过 panel 60%, 但最小能装下一行
    bw = int(pw * 0.55)
    bh = int(ph * 0.30)
    # 位置: panel 右下角
    bx = px + pw - bw - 8
    by = py + ph - bh - 8
    if overflow and canvas_bounds:
        # 越界: 允许超出 panel, 但不能超过画布
        cb_x, cb_y, cb_w, cb_h = canvas_bounds
        bx = min(bx, cb_x + cb_w - bw - 4)
        by = min(by, cb_y + cb_h - bh - 4)
    elif canvas_bounds:
        # 不越界: 严格限制在 panel 内
        bx = max(px + 4, min(bx, px + pw - bw - 4))
        by = max(py + 4, min(by, py + ph - bh - 4))

    BUBBLE_DRAWERS[dtype](draw, bx, by, bw, bh, dialogue, font, overflow=overflow, canvas_bounds=canvas_bounds)


@app.route('/api/combine-page', methods=['POST'])
@login_required
def combine_page():
    data = request.json
    segments = data.get('segments', [])
    page_num = data.get('page_num', 1)
    # 任务3 新增: 手动布局 (可选) + 越界选项 (默认 True)
    manual_layout = data.get('panel_layout')
    allow_overflow = bool(data.get('allow_overflow', True))
    canvas_w = data.get('canvas_w')
    canvas_h = data.get('canvas_h')
    # 标题/页码区高度
    title_h = 50
    gap = 4

    if not segments:
        return jsonify({'error': '缺少分镜数据'}), 400

    try:
        images = []
        for seg in segments:
            if seg.get('image_url'):
                img = download_image(seg['image_url'])
                if img:
                    images.append((img, seg))

        if not images:
            return jsonify({'error': '没有可用的图片'}), 400

        panel_count = len(images)
        # 默认画布: 1024*cols 宽, 1024*rows 高 (留 title_h 顶部)
        rows_map = {1: 1, 2: 1, 3: 1, 4: 2, 5: 2, 6: 2, 7: 2, 8: 2, 9: 3, 10: 3, 11: 3, 12: 3, 13: 4, 14: 4, 15: 4, 16: 4}
        cols_map = {1: 1, 2: 2, 3: 3, 4: 2, 5: 3, 6: 3, 7: 4, 8: 4, 9: 3, 10: 4, 11: 4, 12: 4, 13: 4, 14: 4, 15: 4, 16: 4}
        rows = rows_map.get(panel_count, max(1, (panel_count + 3) // 4))
        cols = cols_map.get(panel_count, min(4, (panel_count + rows - 1) // rows))

        cell_w = 1024
        cell_h = 1024
        if canvas_w and canvas_h:
            cell_w = int((canvas_h - title_h) / rows)
            cell_h = int((canvas_w - title_h) / cols)

        canvas_width = cell_w * cols + gap * (cols + 1)
        canvas_height = cell_h * rows + gap * (rows + 1) + title_h

        layout = compute_grid_layout(panel_count, canvas_width, canvas_height - title_h, gap=gap, manual_layout=manual_layout)
        # 把 layout 整体下移 title_h
        for box in layout:
            box['y'] += title_h

        combined = Image.new('RGB', (canvas_width, canvas_height), 'white')
        draw = ImageDraw.Draw(combined)

        try:
            font = ImageFont.truetype('arial.ttf', 16)
        except Exception:
            font = ImageFont.load_default()

        canvas_bounds = (0, title_h, canvas_width, canvas_height - title_h)

        for idx, (img, seg) in enumerate(images):
            box = layout[idx]
            # 缩放 img 到 panel 尺寸
            panel_img = img.resize((box['w'], box['h']), Image.LANCZOS)
            combined.paste(panel_img, (box['x'], box['y']))
            # panel 边框
            draw.rectangle([box['x'], box['y'], box['x'] + box['w'], box['y'] + box['h']], outline='black', width=3)
            # panel 编号
            try:
                badge_font = ImageFont.truetype('arial.ttf', 18)
            except Exception:
                badge_font = font
            draw.text((box['x'] + 6, box['y'] + 6), str(idx + 1), fill='yellow', font=badge_font)
            # 气泡
            render_panel_bubble(draw, box, seg, font, overflow=allow_overflow, canvas_bounds=canvas_bounds)

        # 页码/标题
        title_text = f"第 {page_num} 页"
        try:
            title_font = ImageFont.truetype('arial.ttf', 24)
        except Exception:
            title_font = font
        draw.text((20, 12), title_text, fill='black', font=title_font)

        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f"comic_page_{page_num}_{timestamp}.png"
        filepath = os.path.join(OUTPUT_DIR, filename)
        combined.save(filepath)

        return jsonify({
            'success': True,
            'image_url': f'/static/output/{filename}',
            'layout': layout,
            'canvas': {'w': canvas_width, 'h': canvas_height},
            'panel_count': panel_count
        })

    except Exception as e:
        import traceback
        print(f"Combine page error: {str(e)}")
        print(traceback.format_exc())
        return jsonify({'error': str(e)}), 500


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
    negative_prompt = data.get('negative_prompt', 'color, colorful, chromatic, vibrant, saturated, blurry, low quality, distorted, watermark, signature, text, logo, deformed hands, extra fingers, bad anatomy, mutated, text overlay')
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

    if not page or not api_url:
        return jsonify({'error': '缺少必要参数'}), 400

    segments = page.get('segments', [])
    if not segments or len(segments) == 0:
        return jsonify({'error': '该页没有分镜'}), 400

    emit_progress(task_id, 10, f'正在构建第 {page_num} 页提示词...', 'preparing')

    try:
        segment_descriptions = []
        # 任务2: 逐 panel 用结构化字段升级 style_prompt, 拼入 prompt
        for idx, seg in enumerate(segments):
            # 调用 upgrade_segment_prompt 合并 style_prompt + 镜头语言 tags
            upgraded_style = upgrade_segment_prompt(seg)
            base_style = upgraded_style or seg.get('style_prompt', '') or 'black and white manga style'
            seg_style_tags = base_style

            desc = f"Panel {idx+1}: {seg.get('scene_description', '')}"
            if seg.get('dialogue'):
                desc += f" (Dialogue: {seg['dialogue']})"
            # 把升级后的 style_prompt 注入到每个 panel 描述
            desc += f" [style: {seg_style_tags}]"
            segment_descriptions.append(desc)

        style_art = "detailed ink drawing, dramatic shadows, high contrast, cross-hatching, professional manga quality, black ink on white paper"
        if style_tags:
            style_art = f"{style_tags}, {style_art}"

        page_prompt = f"""ABSOLUTELY NO COLOR, no watermark, no signature, no text overlay. Strict black and white manga comic page, pure monochrome, grayscale only. {len(segments)} panels arranged in a grid layout.

Panels:
{chr(10).join(segment_descriptions)}

Art style: {style_art}"""

        if page_num and page_num > 1:
            page_prompt += f"\n\nThis is PAGE {page_num} of the comic. It MUST maintain the exact same drawing style, visual continuity, character proportions, and shading technique as the previous page (Page {page_num-1}). The story progresses from the previous page - continue the visual narrative seamlessly."

        if character_references and len(character_references) > 0:
            char_sheet = []
            for char in character_references:
                name = char.get('name', '')
                desc = char.get('description', '')
                char_sheet.append(f"[CHARACTER: {name}]\nAPPEARANCE: {desc}\nThis character MUST appear exactly as described throughout ALL panels.")
            char_section = "\n\n=== CHARACTER REFERENCE SHEET ===\n" + "\n\n".join(char_sheet) + "\n\nCRITICAL: All characters' appearance MUST be identical across all panels. Maintain absolute consistency in facial features, body type, clothing, and hairstyle throughout the entire page."
            page_prompt += char_section

        if previous_page_image:
            page_prompt += f"\n\n=== PREVIOUS PAGE REFERENCE ===\nA reference image of the previous page (Page {page_num-1}) is provided. This page MUST have exactly the same art style, line quality, shading technique, and visual tone as the reference. Characters should look identical to how they appear in the previous page."

        # 准备参考图片（缓存到本地后转base64）
        ref_images = prepare_ref_images(character_references, previous_page_image)
        print(f"Generating page {page_num} with {len(character_references)} character refs, previous page: {'yes' if previous_page_image else 'no'}, total {len(ref_images)} reference images")
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
        work_id, work_username = get_current_work_id()

        emit_progress(task_id, 80, '页面生成完成, 正在下载保存...', 'downloading')

        local_url, error = save_image_result(image_url, f"comic_page_{page_num}_full", work_id, work_username)

        if local_url:
            # 持久化整页图片映射
            if page_idx is not None:
                fp_data = load_session_data('full_pages') or {'pages': []}
                fp_data['pages'].append({
                    'key': str(page_idx),
                    'local_url': local_url,
                    'page_num': page_num,
                    'timestamp': datetime.now().isoformat()
                })
                save_session_data('full_pages', fp_data)
            emit_progress(task_id, 100, f'第 {page_num} 页生成完成', 'done')
            return jsonify({'success': True, 'image_url': local_url})
        else:
            emit_progress(task_id, 0, '页面生成失败', 'error')
            return jsonify({'error': error.get('error', '无法获取图片'), 'raw': result}), 500

    except Exception as e:
        import traceback
        print(f"Page generation error: {str(e)}")
        print(traceback.format_exc())
        emit_progress(task_id, 0, f'页面生成失败: {e}', 'error')
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
            disk_path = os.path.join(os.path.dirname(__file__), rel_path)
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
            for k, v in obj.items():
                if k in ('image_url', 'local_url') and isinstance(v, str) and v.startswith('/'):
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

    # 重定位所有图片 URL
    _relocate_images_in_obj(chars)
    _relocate_images_in_obj(gen_imgs)
    _relocate_images_in_obj(fp_imgs)
    _relocate_images_in_obj(cp_imgs)

    state = {
        'novel_text': data.get('novel_text', ''),
        'segments': segments,
        'characters': chars,
        'generated_images': gen_imgs,
        'full_page_images': fp_imgs,
        'combined_page_images': cp_imgs,
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
                rel = os.path.relpath(os.path.join(images_dir, fn), os.path.join(os.path.dirname(__file__), 'static'))
                url = '/static/' + rel.replace(os.sep, '/')
                image_files.append(url)
                stem = os.path.splitext(fn)[0]
                image_by_stem[stem] = url
                # 收集人设图 (char_*.png 模式), 用于按顺序匹配
                if stem.startswith('char_') or stem.startswith('character_'):
                    char_images.append(url)
                # 整页图: comic_page_<N>_full_*.png
                elif stem.startswith('comic_page_') and '_full_' in stem:
                    # 提取 pageIdx: comic_page_1_full_20260616_090916 -> 1
                    parts = stem.split('_')
                    if len(parts) >= 3:
                        try:
                            page_idx = int(parts[2])
                            full_page_images_rebuilt[page_idx] = url
                        except ValueError:
                            pass
                # 分镜图: comic_page_<N>_seg_<M>_*.png
                elif stem.startswith('comic_page_') and '_seg_' in stem:
                    # 提取 pageIdx-segIdx: comic_page_1_seg_2_20260616_... -> 1-2
                    parts = stem.split('_')
                    if len(parts) >= 5:
                        try:
                            page_idx = int(parts[2])
                            seg_idx = int(parts[4])
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

    # 从磁盘重建图片 URL 映射 (如果 state 里是空的)
    # 分镜图
    if not state['generated_images']:
        state['generated_images'] = seg_images_rebuilt
    # 整页图
    if not state['full_page_images']:
        state['full_page_images'] = full_page_images_rebuilt

    # 重建角色人设图 image_url:
    # 1. 如果 state.characters[].image_url 已存在且对应文件存在, 保留
    # 2. 否则按多种命名约定匹配 (兼容 char_0, char_20260616_090739 等)
    # 3. 最后按 images_dir 中 char_*.png 顺序分配给没图片的角色
    chars = state.get('characters', [])
    used_urls = set()
    for char in chars:
        url = char.get('image_url', '')
        # 如果已有 image_url 且能在当前 work_dir 的 images/ 中找到, 才算有效
        if url and url.startswith('/') and 'images/' + os.path.basename(url) in [os.path.join('images', os.path.basename(u)) for u in image_files]:
            used_urls.add(url)
            continue
        # 否则清空, 后面会重新分配
        char['image_url'] = ''

    # 按顺序把 char_images 分配给没图片的角色
    unassigned_chars = [c for c in chars if not c.get('image_url')]
    for i, char in enumerate(unassigned_chars):
        if i < len(char_images):
            char['image_url'] = char_images[i]
            used_urls.add(char_images[i])
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
            response = requests.get(url, timeout=60)
            response.raise_for_status()
            image_data = BytesIO(response.content)
        elif url.startswith('/static'):
            local_path = os.path.join(os.path.dirname(__file__), url.lstrip('/'))
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

            response = requests.post(api_url, headers=headers, json=payload, timeout=300)
            response.raise_for_status()
            result = response.json()

            page_text = ''
            if 'choices' in result and len(result['choices']) > 0:
                choice = result['choices'][0]
                if 'message' in choice:
                    page_text = choice['message']['content']
                elif 'text' in choice:
                    page_text = choice['text']

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
        fp_data = {'pages': []}
        for key, url in data['fullPageImages'].items():
            fp_data['pages'].append({
                'key': key,
                'local_url': url
            })
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
    socketio.run(app, host='0.0.0.0', port=2778, debug=True, allow_unsafe_werkzeug=True)
