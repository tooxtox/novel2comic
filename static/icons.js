// text2comic 内联 SVG 图标库
// 设计语言: 24x24 viewBox, stroke 1.5, currentColor 描边, fill="none", 圆角端点
// 与现有 landing.html brutalist 印刷风对齐: 几何、克制、统一
// 用法: <span data-icon="palette"></span>  或  renderIcon('palette', {size: 18})

const ICON_PATHS = {
    // ---- 状态/动作 ----
    'check':       '<polyline points="20 6 9 17 4 12"/>',
    'check-circle':'<circle cx="12" cy="12" r="10"/><polyline points="8 12 11 15 16 9"/>',
    'x':           '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    'x-circle':    '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
    'pencil':      '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
    'pen':         '<path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/>',
    'trash':       '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
    'refresh':     '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M20.49 15A9 9 0 0 1 5.64 18.36L1 14"/>',
    'play':        '<polygon points="5 3 19 12 5 21 5 3"/>',
    'pause':       '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
    'stop':        '<circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6" fill="currentColor"/>',
    'loader':      '<circle cx="12" cy="12" r="10" stroke-dasharray="60 20" stroke-linecap="round"/>',  // 旋转用 CSS
    'clock':       '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    'hourglass':   '<path d="M5 22h14M5 2h14M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22M17 2v4.172a2 2 0 0 1-.586 1.414L12 12l-4.414-4.414A2 2 0 0 1 7 6.172V2"/>',
    'upload':      '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
    'download':    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    'save':        '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',

    // ---- 文档/内容 ----
    'note':        '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/>',
    'document':    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
    'book-open':   '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    'books':       '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    'scroll':      '<path d="M8 21h12a2 2 0 0 0 2-2v-2H10v2a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v3h4"/><path d="M19 3H8a2 2 0 0 0-2 2v14"/>',

    // ---- 创作/AI ----
    'palette':     '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>',
    'sparkles':    '<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/><path d="M19 14l1 3 3 1-3 1-1 3-1-3-3-1 3-1z"/>',
    'bolt':        '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    'lightbulb':   '<path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.5.4 1 1 1 1.7v.6h6v-.6c0-.7.5-1.3 1-1.7A7 7 0 0 0 12 2z"/>',
    'message':     '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
    'thought':     '<path d="M9.5 14.5A3.5 3.5 0 0 0 12 18a3.5 3.5 0 0 0 2.5-1c.5-.7.5-1.5 0-2.2-.5-.7-1.5-1.3-2.5-1.3"/><path d="M2 13a8 8 0 0 1 8-7 8 8 0 0 1 8 7c0 2-1 4-3 5l-1 3-1-3c-1 .5-2 1-3 1a8 8 0 0 1-8-7z"/>',
    'shout':       '<path d="M3 12L12 3l9 9-9 9z" stroke-linejoin="round"/><path d="M12 7v10M7 12h10"/>',
    'shh':         '<circle cx="12" cy="12" r="10"/><path d="M9 9l6 6M15 9l-6 6"/>',
    'volume':      '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
    'whisper':     '<path d="M3 12a9 9 0 0 1 18 0v3a2 2 0 0 1-2 2h-2v-7h4M3 12v3a2 2 0 0 0 2 2h2v-7H3"/>',
    'masks':       '<path d="M3 11l18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/><path d="M16.6 18.8a3 3 0 1 0-2.4-5.4"/>',

    // ---- 媒体/影像 ----
    'film':        '<rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/>',
    'clapperboard':'<path d="M20 20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8l4-6h12z"/><path d="M2 8h20"/><path d="M8 2l-4 6M16 2l-4 6M22 8l-4-6"/>',
    'camera':      '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
    'image':       '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',

    // ---- 文件夹/组织 ----
    'folder':      '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    'folder-open': '<path d="M6 14l1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2"/>',

    // ---- 系统 ----
    'settings':    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    'phone':       '<rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
    'compass':     '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
    'warning':     '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    'play-circle': '<circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/>',
    'chevron-down':'<polyline points="6 9 12 15 18 9"/>',
    'chevron-right':'<polyline points="9 18 15 12 9 6"/>',
    'arrow-up':    '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>',
    'arrow-down':  '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>',

    // ---- 品牌/特殊 ----
    'volcano':     // 自绘火山 (替换 🌋)
                   '<path d="M3 22h18"/><path d="M9 6l3-4 3 4v3l2 2v6h-4l-1-1h-1l-1 1H7v-6l2-2z"/><path d="M12 2v2M8 4l1 1M16 4l-1 1"/>',
    'online-dot':  '<circle cx="12" cy="12" r="10" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="4" fill="white" stroke="none"/>',
};

// 默认 stroke 风格, 与 landing.html 的 1.5px stroke 对齐
const ICON_DEFAULTS = {
    width: 24,
    height: 24,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.5',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
};

/**
 * 渲染单个 SVG 图标为 HTML 字符串
 * 用法: renderIcon('palette', {size: 18, className: 'mr-2'})
 */
function renderIcon(name, opts = {}) {
    const path = ICON_PATHS[name];
    if (!path) return '';
    const attrs = {
        ...ICON_DEFAULTS,
        ...opts,
        width: opts.size || opts.width || 18,
        height: opts.size || opts.height || 18,
    };
    let html = `<svg xmlns="http://www.w3.org/2000/svg"`;
    for (const [k, v] of Object.entries(attrs)) {
        if (k === 'className') continue;
        if (v === undefined || v === null) continue;
        html += ` ${k}="${v}"`;
    }
    if (attrs.className) html += ` class="${attrs.className}"`;
    html += ` aria-hidden="true">${path}</svg>`;
    return html;
}

/**
 * 页面加载完成后扫描所有 <span data-icon="xxx"> 元素, 替换为 SVG
 * 用法: 在 DOMContentLoaded 之后调用一次
 */
function hydrateIcons(opts = {}) {
    document.querySelectorAll('[data-icon]').forEach(el => {
        const name = el.getAttribute('data-icon');
        if (!name || !ICON_PATHS[name]) return;
        // 继承原 span 的 class / style
        const cls = el.getAttribute('class') || '';
        const sz = parseFloat(getComputedStyle(el).fontSize) || 18;
        el.innerHTML = renderIcon(name, { size: sz, className: cls });
    });
}

// 暴露给全局
window.ICON_PATHS = ICON_PATHS;
window.renderIcon = renderIcon;
window.hydrateIcons = hydrateIcons;

// 初始化 + 自动观察 DOM 变化 (兜底: 任何动态 innerHTML / appendChild 后的 data-icon)
function startObserver() {
    hydrateIcons();
    const observer = new MutationObserver(mutations => {
        for (const m of mutations) {
            for (const node of m.addedNodes) {
                if (!(node instanceof Element)) continue;
                if (node.matches?.('[data-icon]')) {
                    hydrateIcons(node);
                } else {
                    // 扫描子树里的 data-icon
                    const nested = node.querySelectorAll?.('[data-icon]');
                    if (nested?.length) hydrateIcons(node);
                }
            }
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver);
} else {
    startObserver();
}