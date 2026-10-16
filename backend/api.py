"""API settings, connection checks, downloads, cache and result sync routes."""

import base64
import json
import os
import requests
from .ai_client import _api_request
from .auth import login_required
from .runtime import (
    CACHE_DIR,
    CONFIG_LOCAL_PATH,
    CONFIG_TEMPLATE_PATH,
    OUTPUT_DIR,
    RESULTS_DIR,
    app,
)
from .storage import (
    _resolve_readable_static,
    get_session_id,
    get_user_dir,
    load_session_data,
    save_session_data,
)
from flask import jsonify, request, send_file, session
from io import BytesIO


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
            # 走统一收口: 挡穿越 + 挡越权读他人私密图.
            # 之前这里是裸 join, 任意注册用户都能把 url 换成
            # /static/../.env 或 /static/users/<别人>/works/<私密>/images/x.png 取走
            local_path = _resolve_readable_static(url)
            if not local_path:
                return jsonify({'error': '文件不存在或无权访问'}), 404
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
