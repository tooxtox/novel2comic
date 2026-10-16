"""HTTP retries, AI response parsing and optional cloud progress reporting."""

import json
import os
import re
import time
import requests


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
