"""Comic grids, Chinese fonts and speech bubble rendering."""

import os
import shutil
from .runtime import BASE_DIR, _IS_ANDROID, _PERSIST_DIR, _ensure_android_fonts
from .storage import _local_image_abs_path
from PIL import Image, ImageDraw, ImageFont


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
