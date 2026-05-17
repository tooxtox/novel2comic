from flask import Flask, render_template, request, jsonify, send_file
from flask_cors import CORS
import requests
import json
import os
import re
from datetime import datetime
from io import BytesIO
import base64
from PIL import Image, ImageDraw, ImageFont

app = Flask(__name__, static_folder='static', template_folder='templates')
CORS(app)

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), 'static', 'output')
os.makedirs(OUTPUT_DIR, exist_ok=True)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/segment', methods=['POST'])
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
        print(f"Headers: {dict(headers)}")
        print(f"Payload: {json.dumps(payload, ensure_ascii=False)}")
        
        response = requests.post(api_url, headers=headers, json=payload, timeout=300)
        print(f"Response status: {response.status_code}")
        print(f"Response headers: {dict(response.headers)}")
        print(f"Response text: {response.text}")
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
                        seg['style_prompt'] = 'black and white manga style, detailed ink drawing'
            return jsonify({'success': True, 'data': parsed})
        except json.JSONDecodeError as e1:
            print(f"First JSON parse error: {e1}")
            try:
                repaired = repair_json(content)
                parsed = json.loads(repaired)
                for page in parsed.get('pages', []):
                    for seg in page.get('segments', []):
                        if 'style_prompt' not in seg:
                            seg['style_prompt'] = 'black and white manga style, detailed ink drawing'
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
                                    seg['style_prompt'] = 'black and white manga style, detailed ink drawing'
                        return jsonify({'success': True, 'data': parsed})
                    except json.JSONDecodeError as e3:
                        print(f"Third JSON parse error: {e3}")
                return jsonify({'error': f'JSON解析失败，请重试或检查小说内容', 'detail': str(e1)}), 500

    except Exception as e:
        import traceback
        print(f"Error: {str(e)}")
        print(traceback.format_exc())
        return jsonify({'error': str(e)}), 500


@app.route('/api/generate-image', methods=['POST'])
def generate_image():
    data = request.json
    prompt = data.get('prompt', '')
    api_url = data.get('api_url', '')
    api_key = data.get('api_key', '')
    model = data.get('model', '')
    negative_prompt = data.get('negative_prompt', 'color, blurry, low quality, distorted')
    character_references = data.get('character_references', [])

    if not prompt or not api_url:
        return jsonify({'error': '缺少必要参数'}), 400

    manga_prompt = f"black and white manga style, detailed ink drawing, dramatic shadows, {prompt}"
    
    if character_references and len(character_references) > 0:
        character_descriptions = []
        for char in character_references:
            char_desc = f"{char['name']}: {char['description']}"
            character_descriptions.append(char_desc)
        manga_prompt += f", featuring: {'; '.join(character_descriptions)}"
        print(f"With character references: {character_descriptions}")

    try:
        headers = {'Content-Type': 'application/json'}
        if api_key:
            headers['Authorization'] = f'Bearer {api_key}'

        payload = {
            'model': model or 'doubao-seedream-4-5-251128',
            'prompt': manga_prompt,
            'negative_prompt': negative_prompt,
            'width': 512,
            'height': 768,
            'seed': -1,
            'steps': 30,
            'cfg_scale': 7
        }

        print(f"Calling Image API: {api_url}")
        response = requests.post(api_url, headers=headers, json=payload, timeout=300)
        print(f"Image API status: {response.status_code}")
        print(f"Image API response: {response.text}")
        response.raise_for_status()
        result = response.json()

        image_url = None
        if 'images' in result and len(result['images']) > 0:
            image_url = result['images'][0]
        elif 'image' in result:
            image_url = result['image']
        elif 'data' in result:
            data_obj = result['data']
            if isinstance(data_obj, list) and len(data_obj) > 0:
                image_url = data_obj[0].get('url', '') or data_obj[0].get('b64_json', '')
            elif isinstance(data_obj, dict):
                image_url = data_obj.get('url', '') or data_obj.get('b64_json', '')
        elif 'output' in result:
            image_url = result['output']
        elif 'b64_json' in result:
            image_url = result['b64_json']

        if image_url and image_url.startswith('http'):
            return jsonify({'success': True, 'image_url': image_url})
        elif image_url and (image_url.startswith('data:image') or len(image_url) > 1000):
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            filename = f"manga_{timestamp}.png"
            filepath = os.path.join(OUTPUT_DIR, filename)
            import base64

            if image_url.startswith('data:image'):
                image_data = image_url.split(',')[1]
                with open(filepath, 'wb') as f:
                    f.write(base64.b64decode(image_data))
            else:
                with open(filepath, 'wb') as f:
                    f.write(base64.b64decode(image_url))

            return jsonify({'success': True, 'image_url': f'/static/output/{filename}'})
        else:
            return jsonify({'error': '无法获取图片', 'raw': result}), 500

    except Exception as e:
        import traceback
        print(f"Image generation error: {str(e)}")
        print(traceback.format_exc())
        return jsonify({'error': str(e)}), 500


@app.route('/api/save-config', methods=['POST'])
def save_config():
    data = request.json
    config_path = os.path.join(os.path.dirname(__file__), 'config.json')
    with open(config_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return jsonify({'success': True})


@app.route('/api/load-config', methods=['GET'])
def load_config():
    config_path = os.path.join(os.path.dirname(__file__), 'config.json')
    if os.path.exists(config_path):
        with open(config_path, 'r', encoding='utf-8') as f:
            return jsonify(json.load(f))
    return jsonify({})


@app.route('/api/test-llm', methods=['POST'])
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
            'width': 256,
            'height': 256
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

        print(f"Generating character analysis...")
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

        print(f"Character content: {content}")
        parsed = json.loads(content)
        return jsonify({'success': True, 'data': parsed})

    except Exception as e:
        import traceback
        print(f"Character generation error: {str(e)}")
        print(traceback.format_exc())
        return jsonify({'error': str(e)}), 500


@app.route('/api/generate-character-image', methods=['POST'])
def generate_character_image():
    data = request.json
    description = data.get('description', '')
    name = data.get('name', '')
    api_url = data.get('api_url', '')
    api_key = data.get('api_key', '')
    model = data.get('model', '')

    if not description or not api_url:
        return jsonify({'error': '缺少必要参数'}), 400

    prompt = f"""black and white manga character design sheet, full body portrait, {name}, {description}, detailed line art, high contrast, dramatic lighting"""

    try:
        headers = {'Content-Type': 'application/json'}
        if api_key:
            headers['Authorization'] = f'Bearer {api_key}'

        payload = {
            'model': model or 'doubao-seedream-4-5-251128',
            'prompt': prompt,
            'negative_prompt': 'color, low quality, blurry, deformed',
            'width': 768,
            'height': 1024
        }

        print(f"Generating character image for: {name}")
        response = requests.post(api_url, headers=headers, json=payload, timeout=300)
        response.raise_for_status()
        result = response.json()

        image_url = None
        if 'images' in result and len(result['images']) > 0:
            image_url = result['images'][0]
        elif 'data' in result and len(result['data']) > 0:
            image_url = result['data'][0].get('url', '')
        elif 'b64_json' in result:
            image_url = result['b64_json']

        if image_url and image_url.startswith('http'):
            return jsonify({'success': True, 'image_url': image_url})
        elif image_url:
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            filename = f"char_{timestamp}.png"
            filepath = os.path.join(OUTPUT_DIR, filename)

            if image_url.startswith('data:image'):
                image_data = image_url.split(',')[1]
                with open(filepath, 'wb') as f:
                    f.write(base64.b64decode(image_data))
            else:
                with open(filepath, 'wb') as f:
                    f.write(base64.b64decode(image_url))

            return jsonify({'success': True, 'image_url': f'/static/output/{filename}'})

        return jsonify({'error': '无法获取图片', 'raw': result}), 500

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
def generate_page():
    """一次生成一页完整的漫画"""
    data = request.json
    page = data.get('page', {})
    page_num = data.get('page_num', 1)
    api_url = data.get('api_url', '')
    api_key = data.get('api_key', '')
    model = data.get('model', '')
    negative_prompt = data.get('negative_prompt', 'color, blurry, low quality, distorted')
    character_references = data.get('character_references', [])

    if not page or not api_url:
        return jsonify({'error': '缺少必要参数'}), 400

    segments = page.get('segments', [])
    if not segments or len(segments) == 0:
        return jsonify({'error': '该页没有分镜'}), 400

    try:
        headers = {'Content-Type': 'application/json'}
        if api_key:
            headers['Authorization'] = f'Bearer {api_key}'

        segment_descriptions = []
        for idx, seg in enumerate(segments):
            desc = f"Panel {idx+1}: {seg.get('scene_description', '')}"
            if seg.get('dialogue'):
                desc += f" (Dialogue: {seg['dialogue']})"
            segment_descriptions.append(desc)

        page_prompt = f"""black and white manga comic page, {len(segments)} panels arranged in a grid layout.

Panels:
{chr(10).join(segment_descriptions)}

Art style: detailed ink drawing, dramatic shadows, high contrast, professional manga quality"""

        if character_references and len(character_references) > 0:
            character_descriptions = []
            for char in character_references:
                char_desc = f"{char['name']}: {char['description']}"
                character_descriptions.append(char_desc)
            page_prompt += f"\n\nCharacters in this page: {'; '.join(character_descriptions)}"
            print(f"Generating page {page_num} with characters: {character_descriptions}")

        payload = {
            'model': model or 'doubao-seedream-4-5-251128',
            'prompt': page_prompt,
            'negative_prompt': negative_prompt,
            'width': 1024,
            'height': 1536,
            'seed': -1,
            'steps': 30,
            'cfg_scale': 7
        }

        print(f"Generating full comic page {page_num}")
        response = requests.post(api_url, headers=headers, json=payload, timeout=600)
        print(f"Page generation status: {response.status_code}")
        response.raise_for_status()
        result = response.json()

        image_url = None
        if 'images' in result and len(result['images']) > 0:
            image_url = result['images'][0]
        elif 'image' in result:
            image_url = result['image']
        elif 'data' in result:
            data_obj = result['data']
            if isinstance(data_obj, list) and len(data_obj) > 0:
                image_url = data_obj[0].get('url', '') or data_obj[0].get('b64_json', '')
            elif isinstance(data_obj, dict):
                image_url = data_obj.get('url', '') or data_obj.get('b64_json', '')
        elif 'output' in result:
            image_url = result['output']
        elif 'b64_json' in result:
            image_url = result['b64_json']

        if image_url and image_url.startswith('http'):
            return jsonify({'success': True, 'image_url': image_url})
        elif image_url and (image_url.startswith('data:image') or len(image_url) > 1000):
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            filename = f"comic_page_{page_num}_full_{timestamp}.png"
            filepath = os.path.join(OUTPUT_DIR, filename)
            import base64

            if image_url.startswith('data:image'):
                image_data = image_url.split(',')[1]
                with open(filepath, 'wb') as f:
                    f.write(base64.b64decode(image_data))
            else:
                with open(filepath, 'wb') as f:
                    f.write(base64.b64decode(image_url))

            return jsonify({'success': True, 'image_url': f'/static/output/{filename}'})
        else:
            return jsonify({'error': '无法获取图片', 'raw': result}), 500

    except Exception as e:
        import traceback
        print(f"Page generation error: {str(e)}")
        print(traceback.format_exc())
        return jsonify({'error': str(e)}), 500


@app.route('/api/download', methods=['POST'])
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


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=2778, debug=True)
