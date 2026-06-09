from flask import Flask, render_template, request, jsonify, send_file, session, redirect, url_for
from flask_cors import CORS
from functools import wraps
import requests
import json
import os
import re
import time
import hashlib
from datetime import datetime, timedelta
from io import BytesIO
import base64
from PIL import Image, ImageDraw, ImageFont

app = Flask(__name__, static_folder='static', template_folder='templates')
app.secret_key = os.environ.get('FLASK_SECRET_KEY', 'change-this-to-a-random-secret-key')
CORS(app, supports_credentials=True)

# Admin credentials — override via environment variables for production
ADMIN_USERNAME = os.environ.get('ADMIN_USERNAME', 'admin')
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'changeme')

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), 'static', 'output')
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Reference image cache directory
CACHE_DIR = os.path.join(os.path.dirname(__file__), 'static', 'cache')
os.makedirs(CACHE_DIR, exist_ok=True)

# Cache validity period (7 days)
CACHE_EXPIRE_DAYS = 7


def clean_cache():
    """Clean cache files older than 7 days"""
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


def cache_reference_image(url, name=""):
    """Download reference image to cache directory, return local URL path"""
    if not url:
        return None

    try:
        # Use URL hash as filename to avoid duplicate downloads
        url_hash = hashlib.md5(url.encode()).hexdigest()[:12]

        # Check if cache already exists
        for ext in ['.png', '.jpg', '.jpeg', '.webp']:
            cache_path = os.path.join(CACHE_DIR, f"{url_hash}{ext}")
            if os.path.exists(cache_path):
                # Update access time
                os.utime(cache_path, None)
                return f"/static/cache/{url_hash}{ext}"

        # Download image
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
            # base64 format
            parts = url.split(',')
            if len(parts) == 2:
                header = parts[0]
                if 'png' in header:
                    ext = '.png'
                elif 'webp' in header:
                    ext = '.webp'
                else:
                    ext = '.jpg'
                img_data = base64.b64decode(parts[1])

        if img_data:
            # Determine format
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
    """Read cached image and convert to base64"""
    if not cache_url:
        return None
    try:
        local_path = os.path.join(os.path.dirname(__file__), cache_url.lstrip('/'))
        if os.path.exists(local_path):
            with open(local_path, 'rb') as f:
                img_data = f.read()
            img_b64 = base64.b64encode(img_data).decode('utf-8')
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


def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get('logged_in'):
            return jsonify({'error': '请先登录', 'need_login': True}), 401
        return f(*args, **kwargs)
    return decorated_function


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

    if not text or not api_url:
        return jsonify({'error': '缺少必要参数'}), 400

    prompt = f"""将以下小说转换漫画分镜，每页{segments_per_page}个分镜。只返回JSON，无解释。

小说：
{text[:4000]}

格式：
{{"pages":[{{"page_number":1,"segments":[{{"segment_number":1,"scene_description":"简短描述","dialogue":"对话","shot_type":"特写"}}]}}]}}"""

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
            'max_tokens': 32768,
            'stream': False
        }

        print(f"Calling LLM API: {api_url}")
        response = requests.post(api_url, headers=headers, json=payload, timeout=300)
        response.raise_for_status()
        result = response.json()

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

        try:
            parsed = json.loads(content)
            for page in parsed.get('pages', []):
                for seg in page.get('segments', []):
                    if 'style_prompt' not in seg:
                        seg['style_prompt'] = 'ABSOLUTELY NO COLOR, no watermark, no signature, no text overlay. Strict black and white manga, pure monochrome, detailed ink drawing'
            return jsonify({'success': True, 'data': parsed})
        except json.JSONDecodeError as e1:
            print(f"First JSON parse error: {e1}")
            try:
                repaired = repair_json(content)
                parsed = json.loads(repaired)
                for page in parsed.get('pages', []):
                    for seg in page.get('segments', []):
                        if 'style_prompt' not in seg:
                            seg['style_prompt'] = 'ABSOLUTELY NO COLOR, no watermark, no signature, no text overlay. Strict black and white manga, pure monochrome, detailed ink drawing'
                return jsonify({'success': True, 'data': parsed})
            except json.JSONDecodeError as e2:
                print(f"Second JSON parse error: {e2}")
                json_match = re.search(r'\{[\s\S]*\}', content)
                if json_match:
                    try:
                        repaired_match = repair_json(json_match.group())
                        parsed = json.loads(repaired_match)
                        for page in parsed.get('pages', []):
                            for seg in page.get('segments', []):
                                if 'style_prompt' not in seg:
                                    seg['style_prompt'] = 'ABSOLUTELY NO COLOR, no watermark, no signature, no text overlay. Strict black and white manga, pure monochrome, detailed ink drawing'
                        return jsonify({'success': True, 'data': parsed})
                    except json.JSONDecodeError as e3:
                        print(f"Third JSON parse error: {e3}")
                return jsonify({'error': f'JSON解析失败，请重试或检查小说内容', 'detail': str(e1)}), 500

    except Exception as e:
        import traceback
        print(f"Error: {str(e)}")
        print(traceback.format_exc())
        return jsonify({'error': str(e)}), 500


def call_image_api(api_url, api_key, payload):
    """Call image generation API, compatible with OpenAI SDK format"""
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

    # Extract image URL
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


def save_image_result(image_url, prefix="manga"):
    """Save image URL locally, return local path"""
    if not image_url:
        return None, {'error': '无法获取图片'}

    if image_url.startswith('http'):
        return image_url, None

    # Save base64 data locally
    if image_url.startswith('data:image') or len(image_url) > 1000:
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f"{prefix}_{timestamp}.png"
        filepath = os.path.join(OUTPUT_DIR, filename)

        if image_url.startswith('data:image'):
            image_data = image_url.split(',')[1]
        else:
            image_data = image_url

        with open(filepath, 'wb') as f:
            f.write(base64.b64decode(image_data))

        return f'/static/output/{filename}', None

    return None, {'error': '无法获取图片'}


def prepare_ref_images(character_references, previous_page_image=None):
    """Prepare reference images: cache locally, return base64 list"""
    ref_images = []

    # 1. Character reference images
    if character_references and len(character_references) > 0:
        for char in character_references:
            img_url = char.get('image_url')
            name = char.get('name', '')
            if img_url:
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

    # 2. Previous page comic
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
    character_references = data.get('character_references', [])

    if not prompt or not api_url:
        return jsonify({'error': '缺少必要参数'}), 400

    manga_prompt = f"ABSOLUTELY NO COLOR, no watermark, no signature, no text overlay. Strict black and white manga, pure monochrome, grayscale only. detailed ink drawing, high contrast, dramatic shadows, cross-hatching, {prompt}"

    # Build character reference text
    if character_references and len(character_references) > 0:
        char_sheet = []
        for char in character_references:
            name = char.get('name', '')
            desc = char.get('description', '')
            char_sheet.append(f"[CHARACTER: {name}]\nAPPEARANCE: {desc}\nThis character MUST appear exactly as described above.")

        char_section = "\n\n=== CHARACTER REFERENCE SHEET ===\n" + "\n\n".join(char_sheet) + "\n\nIMPORTANT: All characters' appearance MUST strictly follow the descriptions above."
        manga_prompt += char_section

    # Prepare reference images
    ref_images = prepare_ref_images(character_references)

    try:
        payload = {
            'model': model or 'doubao-seedream-4-5-251128',
            'prompt': manga_prompt,
            'size': '2K',
            'response_format': 'url',
            'watermark': False,
        }

        # Reference images via 'image' field
        if ref_images:
            if len(ref_images) == 1:
                payload['image'] = ref_images[0]
            else:
                payload['image'] = ref_images
            print(f"Included {len(ref_images)} reference image(s) in API payload")

        image_url, result = call_image_api(api_url, api_key, payload)
        local_url, error = save_image_result(image_url, "manga")

        if local_url:
            return jsonify({'success': True, 'image_url': local_url})
        else:
            return jsonify({'error': error.get('error', '无法获取图片'), 'raw': result}), 500

    except Exception as e:
        import traceback
        print(f"Image generation error: {str(e)}")
        print(traceback.format_exc())
        return jsonify({'error': str(e)}), 500


@app.route('/api/save-config', methods=['POST'])
@login_required
def save_config():
    data = request.json
    config_path = os.path.join(os.path.dirname(__file__), 'config.json')
    with open(config_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return jsonify({'success': True})


@app.route('/api/load-config', methods=['GET'])
@login_required
def load_config():
    config_path = os.path.join(os.path.dirname(__file__), 'config.json')
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

        response = requests.post(api_url, headers=headers, json=payload, timeout=30)
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

        response = requests.post(api_url, headers=headers, json=payload, timeout=60)
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

    if not text or not api_url:
        return jsonify({'error': '缺少必要参数'}), 400

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

        response = requests.post(api_url, headers=headers, json=payload, timeout=300)
        response.raise_for_status()
        result = response.json()

        content = ''
        if 'choices' in result and len(result['choices']) > 0:
            choice = result['choices'][0]
            if 'message' in choice:
                content = choice['message']['content']

        content = re.sub(r'```json\s*', '', content)
        content = re.sub(r'```\s*', '', content)
        content = content.strip()

        parsed = json.loads(content)
        return jsonify({'success': True, 'data': parsed})

    except Exception as e:
        import traceback
        print(f"Character generation error: {str(e)}")
        print(traceback.format_exc())
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

    if not description or not api_url:
        return jsonify({'error': '缺少必要参数'}), 400

    prompt = f"""ABSOLUTELY NO COLOR, no watermark, no signature, no text overlay. Strict black and white manga character design sheet, pure monochrome, grayscale. full body portrait, {name}, {description}, detailed line art, high contrast, dramatic shading, cross-hatching"""

    try:
        payload = {
            'model': model or 'doubao-seedream-4-5-251128',
            'prompt': prompt,
            'size': '2K',
            'response_format': 'url',
            'watermark': False,
        }

        image_url, result = call_image_api(api_url, api_key, payload)
        local_url, error = save_image_result(image_url, "char")

        if local_url:
            return jsonify({'success': True, 'image_url': local_url})
        else:
            return jsonify({'error': error.get('error', '无法获取图片'), 'raw': result}), 500

    except Exception as e:
        import traceback
        print(f"Character image error: {str(e)}")
        print(traceback.format_exc())
        return jsonify({'error': str(e)}), 500


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


@app.route('/api/combine-page', methods=['POST'])
@login_required
def combine_page():
    data = request.json
    segments = data.get('segments', [])
    page_num = data.get('page_num', 1)

    if not segments:
        return jsonify({'error': '缺少分镜数据'}), 400

    try:
        images = []
        for seg in segments:
            if seg.get('image_url'):
                img = download_image(seg['image_url'])
                if img:
                    images.append((img, seg.get('dialogue', '')))

        if not images:
            return jsonify({'error': '没有可用的图片'}), 400

        cols = 2
        rows = (len(images) + cols - 1) // cols
        w, h = images[0][0].size
        page_width = w * cols
        page_height = h * rows + 40

        combined = Image.new('RGB', (page_width, page_height), 'white')
        draw = ImageDraw.Draw(combined)

        try:
            font = ImageFont.truetype('arial.ttf', 14)
        except:
            font = ImageFont.load_default()

        for idx, (img, dialogue) in enumerate(images):
            x = (idx % cols) * w
            y = (idx // cols) * h + 40
            combined.paste(img, (x, y))
            draw.rectangle([x, y, x+w, y+h], outline='black', width=3)

            if dialogue:
                dialogue_box_y = y + h - 80
                draw.rectangle([x+10, dialogue_box_y, x+w-10, y+h-10], fill='white', outline='black')
                draw.text((x+20, dialogue_box_y+10), dialogue[:100], fill='black', font=font)

        title_text = f"第 {page_num} 页"
        try:
            title_font = ImageFont.truetype('arial.ttf', 24)
        except:
            title_font = ImageFont.load_default()
        draw.text((20, 10), title_text, fill='black', font=title_font)

        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f"comic_page_{page_num}_{timestamp}.png"
        filepath = os.path.join(OUTPUT_DIR, filename)
        combined.save(filepath)

        return jsonify({'success': True, 'image_url': f'/static/output/{filename}'})

    except Exception as e:
        import traceback
        print(f"Combine page error: {str(e)}")
        print(traceback.format_exc())
        return jsonify({'error': str(e)}), 500


@app.route('/api/generate-page', methods=['POST'])
@login_required
def generate_page():
    """Generate a full comic page in one request, supporting character reference images and previous page reference"""
    data = request.json
    page = data.get('page', {})
    page_num = data.get('page_num', 1)
    api_url = data.get('api_url', '')
    api_key = data.get('api_key', '')
    model = data.get('model', '')
    negative_prompt = data.get('negative_prompt', 'color, colorful, chromatic, vibrant, saturated, blurry, low quality, distorted, watermark, signature, text overlay, logo')
    character_references = data.get('character_references', [])
    previous_page_image = data.get('previous_page_image')

    if not page or not api_url:
        return jsonify({'error': '缺少必要参数'}), 400

    segments = page.get('segments', [])
    if not segments or len(segments) == 0:
        return jsonify({'error': '该页没有分镜'}), 400

    try:
        segment_descriptions = []
        for idx, seg in enumerate(segments):
            desc = f"Panel {idx+1}: {seg.get('scene_description', '')}"
            if seg.get('dialogue'):
                desc += f" (Dialogue: {seg['dialogue']})"
            segment_descriptions.append(desc)

        page_prompt = f"""ABSOLUTELY NO COLOR, no watermark, no signature, no text overlay. Strict black and white manga comic page, pure monochrome, grayscale only. {len(segments)} panels arranged in a grid layout.

Panels:
{chr(10).join(segment_descriptions)}

Art style: detailed ink drawing, dramatic shadows, high contrast, cross-hatching, professional manga quality, black ink on white paper"""

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

        ref_images = prepare_ref_images(character_references, previous_page_image)

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

        image_url, result = call_image_api(api_url, api_key, payload)
        local_url, error = save_image_result(image_url, f"comic_page_{page_num}_full")

        if local_url:
            return jsonify({'success': True, 'image_url': local_url})
        else:
            return jsonify({'error': error.get('error', '无法获取图片'), 'raw': result}), 500

    except Exception as e:
        import traceback
        print(f"Page generation error: {str(e)}")
        print(traceback.format_exc())
        return jsonify({'error': str(e)}), 500


@app.route('/api/download', methods=['POST'])
@login_required
def download_image_proxy():
    """Proxy download images to solve cross-origin download issues"""
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


if __name__ == '__main__':
    clean_cache()
    app.run(host='0.0.0.0', port=2778, debug=True)
