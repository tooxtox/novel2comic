let currentSegments = { pages: [] };
let generatedImages = {};
let isGenerating = false;
let characters = [];
let batchPaused = false;  // 批量生成暂停控制
let batchStopRequested = false;  // 批量生成停止控制 (用户主动停止)
let fullPageImages = {};  // 整页生成的图片
let combinedPageImages = {};  // 兼容旧会话: 历史拼版图映射 (拼版功能已移除, 仅保留旧数据)
let fullPageCleanImages = {};  // 整页生成图的无气泡干净副本 (key: pageIdx → clean_url)
let fullPageBubbles = {};  // 整页生成图的气泡坐标 (key: pageIdx → [{x,y,w,h,dialogue,dialogue_type}])
let progressInterval = null;
let currentWritingId = localStorage.getItem('writing_id') || null;  // 当前写作历史文档ID (跨刷新持久化)

// 漫画转小说相关状态
let comicUploadedImages = [];  // {name, data: base64, pageIndex}
let comicNovelResult = null;   // {novel_text, pages}

const tabs = ['input', 'aiwrite', 'characters', 'segments', 'gallery', 'history', 'comic2novel'];
let currentTab = 'input';  // 当前标签页, 用于决定切换时的滑入方向
const CONCURRENT_LIMIT = 3;
const MAX_RETRIES = 3;

// 漫画风格预设Tag (按地区/类型分类)
const STYLE_PRESETS = [
    // ===== 日漫 =====
    { id: 'acg', label: '日式ACG', category: '日漫', tags: 'japanese anime style, ACG anime aesthetic, clean cel shading, smooth lineart, expressive anime eyes, bishounen and moe character design' },
    { id: 'shonen', label: '热血少年', category: '日漫', tags: 'shonen manga style, dynamic action lines, intense expressions, speed lines' },
    { id: 'shojo', label: '少女漫画', category: '日漫', tags: 'shojo manga style, soft lines, sparkles, romantic, delicate features' },
    { id: 'seinen', label: '青年向', category: '日漫', tags: 'seinen manga style, realistic proportions, detailed anatomy, mature' },
    { id: 'chibi', label: 'Q版', category: '日漫', tags: 'chibi style, super deformed, 2-head body proportion, cute, simplified' },
    { id: 'gag', label: '搞笑', category: '日漫', tags: 'gag manga style, exaggerated expressions, comedic, simple lines' },
    { id: 'horror', label: '恐怖', category: '日漫', tags: 'horror manga style, grotesque, unsettling, dark atmosphere, psychological' },
    // ===== 美漫 =====
    { id: 'american_comic', label: '经典美漫', category: '美漫', tags: 'american comic book style, bold outlines, halftone dots, vibrant inking, superhero proportions' },
    { id: 'graphic_novel', label: '图像小说', category: '美漫', tags: 'graphic novel style, detailed rendering, cinematic panels, mature storytelling' },
    { id: 'noir', label: '黑色电影', category: '美漫', tags: 'noir style, high contrast, deep shadows, dramatic lighting, film noir' },
    { id: 'cartoon', label: '美式卡通', category: '美漫', tags: 'american cartoon style, bold outlines, exaggerated shapes, playful' },
    // ===== 韩漫 =====
    { id: 'webtoon', label: 'Webtoon', category: '韩漫', tags: 'korean webtoon style, vertical scroll format, clean lines, vibrant colors, modern' },
    { id: 'manhwa', label: '传统韩漫', category: '韩漫', tags: 'manhwa style, korean comic, detailed eyes, smooth lineart, modern aesthetic' },
    { id: 'korean_drama', label: '韩剧风', category: '韩漫', tags: 'korean drama inspired manhwa, realistic faces, fashion forward, romantic' },
    // ===== 国漫 =====
    { id: 'ink', label: '水墨风', category: '国漫', tags: 'sumi-e ink style, brush strokes, traditional Chinese ink painting, flowing' },
    { id: 'guofeng', label: '国风', category: '国漫', tags: 'chinese guofeng style, traditional hanfu, oriental aesthetics, elegant' },
    { id: 'wuxia', label: '武侠', category: '国漫', tags: 'wuxia manhua style, martial arts, flowing robes, dynamic action, chinese fantasy' },
    { id: 'xianxia', label: '仙侠', category: '国漫', tags: 'xianxia style, immortal cultivation, ethereal, mystical clouds, oriental fantasy' },
    // ===== 其他 =====
    { id: 'cyberpunk', label: '赛博朋克', category: '其他', tags: 'cyberpunk style, neon lights, futuristic, tech noir, dystopian' },
    { id: 'realistic', label: '写实', category: '其他', tags: 'realistic style, photographic quality, detailed textures, lifelike' },
    { id: 'watercolor', label: '水彩', category: '其他', tags: 'watercolor style, soft washes, flowing pigments, artistic' },
    { id: 'sketch', label: '素描', category: '其他', tags: 'pencil sketch style, graphite, cross hatching, rough lines' },
    { id: 'minimalist', label: '极简', category: '其他', tags: 'minimalist style, simple lines, negative space, clean composition' },
];

// 风格分类顺序
const STYLE_CATEGORIES = ['日漫', '美漫', '韩漫', '国漫', '其他'];

let selectedPresetIds = new Set();
let customStyleTags = [];
// 漫画模式: 'bw' = 黑白漫画 (默认) / 'color' = 彩色漫画
let comicMode = 'bw';
let bubbleRenderMode = 'pil';  // 'pil' | 'api' — 气泡渲染方式, 'pil'=本地PIL叠加, 'api'=图像API自画

// 气泡类型枚举 + 编辑器下拉显示标签 (与 app.py 的 BUBBLE_DRAWERS / DIALOGUE_TYPE_CATALOG 对齐)
// 注: <option> 不支持内联 SVG, 用纯几何 Unicode 替代 emoji, 跨平台一致
const BUBBLE_TYPES = ['dialogue', 'thought', 'shout', 'whisper', 'burst', 'narration', 'box', 'caption'];
const BUBBLE_TYPE_LABELS = {
    dialogue:  '○ dialogue',
    thought:   '◌ thought',
    shout:     '※ shout',
    whisper:   '· whisper',
    burst:     '⚡ burst',
    narration: '▭ narration',
    box:       '▢ box',
    caption:   '▲ caption',
};

/**
 * 带指数退避重试的 fetch
 * 内网穿透场景下，网络波动可能导致请求失败，自动重试提高成功率
 */
async function fetchWithRetry(url, options = {}, maxRetries = MAX_RETRIES) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(url, options);
            if (!response.ok && attempt < maxRetries) {
                throw new Error(`HTTP ${response.status}`);
            }
            return response;
        } catch (e) {
            lastError = e;
            if (attempt < maxRetries) {
                const delay = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 1000, 15000);
                console.log(`Retry ${attempt + 1}/${maxRetries} for ${url} after ${Math.round(delay)}ms`);
                await new Promise(r => setTimeout(r, delay));
            }
        }
    }
    throw lastError;
}

// ========== 动效工具 ==========

function motionReduced() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * 容器内元素的可视级联入场: 元素进入视口时才播放, 同批进入的按顺序依次延迟.
 * 依赖 CSS 的 .stagger-ready (入场前隐藏) 与 .stagger-item (播放动画, 延迟 = --i * --stagger).
 * 减少动效偏好 / 不支持 IntersectionObserver 时不加任何 class → 内容直接可见.
 */
function playStagger(container, selector) {
    if (!container) return;
    const nodes = selector ? container.querySelectorAll(selector) : container.children;
    if (!nodes || nodes.length === 0) return;
    if (motionReduced() || typeof IntersectionObserver === 'undefined') return;
    // 同一容器只做一次级联: 勾选角色等交互会整块重渲染, 每次都重新入场会闪
    if (container._staggerDone) return;
    container._staggerDone = true;

    const io = new IntersectionObserver((entries, obs) => {
        let batch = 0;
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            obs.unobserve(entry.target);
            entry.target.style.setProperty('--i', batch++);
            entry.target.classList.remove('stagger-ready');
            entry.target.classList.add('stagger-item');
        });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.01 });

    Array.from(nodes).forEach(el => {
        if (el.classList.contains('stagger-item')) return;  // 已播放过的不重播
        el.classList.add('stagger-ready');
        io.observe(el);
    });

    // 兜底: 3s 后仍在视口内却没播放的元素直接显示 (防止内容被"藏"住)
    setTimeout(() => {
        Array.from(nodes).forEach(el => {
            if (!el.classList.contains('stagger-ready')) return;
            const r = el.getBoundingClientRect();
            if (r.top < window.innerHeight && r.bottom > 0) {
                el.classList.remove('stagger-ready');
                el.classList.add('stagger-item');
            }
        });
    }, 3000);
}

/** 单个元素立刻入场 (用于逐条追加的列表, 每张卡片到达时各自播放) */
function popIn(el) {
    if (!el || motionReduced()) return;
    el.classList.add('stagger-item');
}

// ========== 工作台: 状态条 / 步骤条 / 滑动指示器 / 快捷键 ==========

// 每个标签页的"主操作": 状态条按钮与 Ctrl+Enter 都走同一份定义
const PRIMARY_ACTIONS = {
    input:       { label: '开始智能分镜', run: () => startSegment() },
    aiwrite:     { label: '生成剧情选项', run: () => genPlotOptions() },
    characters:  { label: '从小说分析角色', run: () => analyzeCharacters() },
    segments:    { label: '批量整页生成', run: () => generateAllFullPages() },
    gallery:     { label: '下载全部图片', run: () => downloadAll() },
    history:     { label: '保存当前进度', run: () => quickSave() },
    comic2novel: { label: '选择漫画图片', run: () => { const el = document.getElementById('comic-file-input'); if (el) el.click(); } },
};

// 作品元信息: 标题与保存时间只存在本地 (后端只返回 success)
const workMeta = { title: '', savedAt: '', dirty: false };
try {
    workMeta.title = localStorage.getItem('manga_work_title') || '';
    workMeta.savedAt = localStorage.getItem('manga_work_saved_at') || '';
} catch (e) { /* 无痕模式忽略 */ }

function renderWorkMeta() {
    const titleEl = document.getElementById('wb-title');
    const saveEl = document.getElementById('wb-save');
    if (titleEl) titleEl.textContent = workMeta.title || '未命名作品';
    if (saveEl) {
        saveEl.textContent = workMeta.dirty
            ? '有改动未保存'
            : (workMeta.savedAt ? `已保存 ${workMeta.savedAt}` : '尚未保存');
        saveEl.style.color = workMeta.dirty ? '#b45309' : '';
    }
}

function markDirty() {
    if (workMeta.dirty) return;
    workMeta.dirty = true;
    renderWorkMeta();
}

function markSaved(title) {
    workMeta.dirty = false;
    if (title) workMeta.title = title;
    workMeta.savedAt = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    try {
        localStorage.setItem('manga_work_title', workMeta.title || '');
        localStorage.setItem('manga_work_saved_at', workMeta.savedAt);
    } catch (e) { /* 忽略 */ }
    renderWorkMeta();
    // 保存成功时给"已保存"那一行来一下弹性反馈
    const wbSave = document.getElementById('wb-save');
    if (wbSave && window.__t2cTransitions) {
        wbSave.style.color = '#15803d';  // 短暂变绿
        window.__t2cTransitions.celebrateSave(wbSave);
        setTimeout(() => { wbSave.style.color = ''; }, 1100);
    }
}

/** 静默保存当前进度 (不弹标题输入框) */
async function quickSave() {
    try {
        await saveCurrentState();
        markSaved();
        updateWorkspaceUI();
        showToast('已保存当前进度', 'success');
    } catch (e) {
        showToast('保存失败: ' + (e.message || e), 'error');
    }
}

/** 数字滚动: 逐字输入这类小改动直接更新, 粘贴/生成这类大改动滚动到位 */
function countUp(el, value) {
    if (!el) return;
    const from = parseInt(el.dataset.value || '0', 10) || 0;
    if (from === value) return;
    el.dataset.value = String(value);
    if (motionReduced() || Math.abs(value - from) < 8) {
        el.textContent = String(value);
        return;
    }
    const start = performance.now();
    const dur = 520;
    const tick = (now) => {
        const p = Math.min(1, (now - start) / dur);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = String(Math.round(from + (value - from) * eased));
        if (p < 1) requestAnimationFrame(tick); else el.textContent = String(value);
    };
    requestAnimationFrame(tick);
    el.classList.remove('is-bump');
    void el.offsetWidth;
    el.classList.add('is-bump');
}

function _setCountChip(id, text, positive) {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.textContent !== text) {
        el.textContent = text;
        el.classList.remove('is-bump');
        void el.offsetWidth;
        el.classList.add('is-bump');
    }
    el.classList.toggle('is-zero', !positive);
}

function _setStatusChip(id, textId, ok, label) {
    const chip = document.getElementById(id);
    const text = document.getElementById(textId);
    if (!chip) return;
    chip.classList.toggle('is-ok', !!ok);
    chip.classList.toggle('is-bad', !ok);
    if (text) text.textContent = ok ? `${label}已就绪` : `${label}未配置`;
}

function scheduleWorkspaceUI() {
    if (scheduleWorkspaceUI._pending) return;
    scheduleWorkspaceUI._pending = true;
    requestAnimationFrame(() => {
        scheduleWorkspaceUI._pending = false;
        updateWorkspaceUI();
    });
}

/** 汇总真实状态: 统计数字 / 接口状态 / 四步进度 / 状态条主操作 */
function updateWorkspaceUI() {
    const textEl = document.getElementById('novel-text');
    const chars = textEl ? (textEl.value || '').length : 0;
    const charCount = characters.length;
    const pages = (currentSegments.pages || []).length;
    const segCount = (currentSegments.pages || []).reduce((n, p) => n + (p.segments || []).length, 0);
    const fullPages = Object.keys(fullPageImages).length;

    countUp(document.getElementById('stat-chars'), chars);
    countUp(document.getElementById('stat-chars-count'), charCount);
    countUp(document.getElementById('stat-segments'), segCount);
    countUp(document.getElementById('stat-pages'), fullPages);

    _setCountChip('input-count-chip', `${chars} 字`, chars > 0);
    _setCountChip('chars-count-chip', `${charCount} 个角色`, charCount > 0);
    _setCountChip('seg-count-chip', `${pages} 页 / ${segCount} 格`, segCount > 0);
    _setCountChip('gallery-count-chip', `${fullPages} 张`, fullPages > 0);

    // 接口状态
    let cfg = {};
    try { cfg = JSON.parse(localStorage.getItem('manga_config') || '{}'); } catch (e) { cfg = {}; }
    _setStatusChip('chip-llm', 'chip-llm-text', !!(cfg.llm_api_url && cfg.llm_api_key), '文本接口');
    _setStatusChip('chip-img', 'chip-img-text', !!(cfg.img_api_url && cfg.img_api_key), '图像接口');
    const workChip = document.getElementById('chip-work');
    if (workChip) {
        workChip.classList.toggle('is-ok', !!workMeta.title);
        workChip.classList.toggle('is-bad', !workMeta.title);
        const t = document.getElementById('chip-work-text');
        if (t) t.textContent = workMeta.title ? `作品：${workMeta.title}` : '尚未命名作品';
    }
    const modeText = document.getElementById('chip-mode-text');
    if (modeText) {
        modeText.textContent = `${comicMode === 'color' ? '彩色' : '黑白'} · ${bubbleRenderMode === 'pil' ? '本地气泡' : '模型画气泡'}`;
    }
    // 生成中: 让状态点跟着呼吸
    ['chip-llm', 'chip-img'].forEach((id) => {
        const chip = document.getElementById(id);
        if (chip) chip.classList.toggle('is-busy', !!isGenerating);
    });

    // 四步流程
    const steps = [
        { key: 'input', done: chars > 0, hint: chars ? `${chars} 字` : '粘贴正文' },
        { key: 'characters', done: charCount > 0, hint: charCount ? `${charCount} 个角色` : '出人设图' },
        { key: 'segments', done: pages > 0, hint: pages ? `${pages} 页 / ${segCount} 格` : '切页分格' },
        { key: 'gallery', done: fullPages > 0, hint: fullPages ? `${fullPages} 张整页` : '叠气泡' },
    ];
    let activeIdx = steps.findIndex((s) => !s.done);
    const allDone = activeIdx === -1;
    if (allDone) activeIdx = steps.length - 1;
    steps.forEach((s, i) => {
        const stepEl = document.querySelector(`.step[data-step="${s.key}"]`);
        if (stepEl) {
            stepEl.classList.toggle('is-done', s.done);
            stepEl.classList.toggle('is-active', i === activeIdx && !allDone);
        }
        const dot = document.getElementById(`step-dot-${s.key}`);
        if (dot) dot.textContent = s.done ? '✓' : String(i + 1);
        const hint = document.getElementById(`step-hint-${s.key}`);
        if (hint) hint.textContent = s.hint;
    });
    const fill = document.getElementById('step-fill');
    if (fill) fill.style.setProperty('--p', String(steps.filter((s) => s.done).length / steps.length));

    const summary = document.getElementById('step-summary');
    if (summary) {
        if (allDone) summary.textContent = '流程已走完，可以继续加页或导出';
        else if (chars === 0) summary.textContent = '粘贴小说正文开始';
        else if (charCount === 0) summary.textContent = '下一步：分析角色（也可跳过）';
        else if (pages === 0) summary.textContent = '下一步：生成分镜';
        else summary.textContent = '下一步：整页生成';
    }

    // 状态条里的迷你进度点
    const wbSteps = document.getElementById('wb-steps');
    if (wbSteps) {
        if (!wbSteps.dataset.ready) {
            wbSteps.innerHTML = steps.map((s, i) =>
                (i ? '<span class="wb-connector"></span>' : '') + '<span class="wb-dot"></span>'
            ).join('');
            wbSteps.dataset.ready = '1';
        }
        const dots = wbSteps.querySelectorAll('.wb-dot');
        const connectors = wbSteps.querySelectorAll('.wb-connector');
        dots.forEach((dot, i) => {
            dot.classList.toggle('is-done', steps[i].done);
            dot.classList.toggle('is-current', i === activeIdx && !allDone);
            dot.classList.toggle('is-busy', i === activeIdx && !!isGenerating);
        });
        connectors.forEach((c, i) => {
            c.classList.toggle('is-done', steps[i].done && steps[i + 1].done);
        });
    }

    // 状态条主操作跟随当前标签页
    const action = PRIMARY_ACTIONS[currentTab];
    const actionLabel = document.getElementById('wb-action-label');
    if (action && actionLabel) actionLabel.textContent = action.label;
    renderWorkMeta();
}

/** 状态条 / 快捷键共用的主操作 */
function runPrimaryAction() {
    const action = PRIMARY_ACTIONS[currentTab];
    if (!action) return;
    try {
        action.run();
    } catch (e) {
        showToast('操作失败: ' + (e.message || e), 'error');
    }
}

/** 流程条点击: 跳到对应标签页 */
function goStep(tab) {
    switchTab(tab);
}

/** 滑动指示器: 把一个绝对定位的墨条移到当前项下面 */
function moveInk(boxId, activeEl, inkId) {
    const box = document.getElementById(boxId);
    const ink = document.getElementById(inkId);
    if (!box || !ink || !activeEl) return;
    const boxRect = box.getBoundingClientRect();
    const itemRect = activeEl.getBoundingClientRect();
    if (!itemRect.width) return;
    ink.style.width = itemRect.width + 'px';
    ink.style.transform = `translateX(${itemRect.left - boxRect.left}px)`;
    ink.classList.add('is-ready');
}

function refreshInks() {
    moveInk('main-tabs', document.getElementById(`tab-${currentTab}`), 'tab-ink');
    moveInk('mtab-grid', document.getElementById(`mtab-${currentTab}`), 'mtab-pill');
    const subId = (typeof _historySub !== 'undefined' && _historySub === 'writing') ? 'hist-sub-writing' : 'hist-sub-comic';
    moveInk('hist-subtabs', document.getElementById(subId), 'hist-ink');
}

/** 切换标签页时, 让面板第一层内容依次落位 */
function staggerPanel(panel) {
    if (!panel || motionReduced()) return;
    Array.from(panel.children).forEach((el, i) => {
        const delay = Math.min(i * 35, 210);
        el.style.transition = 'opacity .38s var(--ease-out-expo), transform .38s var(--ease-out-expo)';
        el.style.transitionDelay = delay + 'ms';
        el.style.opacity = '0';
        el.style.transform = 'translateY(10px)';
        requestAnimationFrame(() => {
            el.style.opacity = '1';
            el.style.transform = 'none';
        });
        setTimeout(() => {
            el.style.transition = '';
            el.style.transitionDelay = '';
            el.style.opacity = '';
            el.style.transform = '';
        }, 760 + delay);
    });
}

/** 启动入场: 头部/统计/流程条依次浮现 (2.5s 兜底由模板里的内联脚本负责) */
function bootIntro() {
    const items = document.querySelectorAll('[data-boot]');
    if (motionReduced() || !items.length) {
        document.documentElement.classList.remove('boot-armed');
        window.__appBooted = true;
        return;
    }
    items.forEach((el, i) => {
        el.style.transitionDelay = Math.min(i * 60, 360) + 'ms';
        el.classList.add('is-in');
    });
    setTimeout(() => {
        document.documentElement.classList.remove('boot-armed');
        items.forEach((el) => { el.style.transitionDelay = ''; });
    }, 1000);
    // 首屏那个面板的内容也跟着落位
    staggerPanel(document.getElementById(`panel-${currentTab}`));
    // 标记放在最后: 中途抛错时不设标记, 让 2.5s 兜底把内容放出来
    window.__appBooted = true;
}

/** 气泡类型迷你预览: 改下拉时形状跟着变 */
function syncBubbleMini(selectEl) {
    const mini = selectEl && selectEl.parentElement ? selectEl.parentElement.querySelector('.bubble-mini') : null;
    if (!mini) return;
    mini.dataset.type = selectEl.value;
    mini.classList.remove('is-changed');
    void mini.offsetWidth;
    mini.classList.add('is-changed');
    setTimeout(() => mini.classList.remove('is-changed'), 340);
}

/** 统一的空状态: 虚线画框 + 网点 + 一句说明 + 一个下一步动作
 * 第二参 icon 接受 data-icon 名字 (参见 icons.js), 由 hydrateIcons 渲染 SVG
 */
function emptyState(icon, title, hint, action) {
    const fullSpan = !action || action.fullSpan ? ' col-span-full' : '';
    const btn = action
        ? `<button onclick="${action.onclick}" class="btn-primary px-5 py-2 text-sm font-medium">${action.label}</button>`
        : '';
    return `<div class="empty-state${fullSpan}">
        <span class="es-halftone" aria-hidden="true"></span>
        <div class="es-icon" data-icon="${icon}"></div>
        <p class="es-title">${title}</p>
        <p class="es-hint">${hint}</p>
        ${btn}
    </div>`;
}

// ========== 任务进度 (后端不推送进度, 一律用 fake progress 显示) ==========

/**
 * 为某个任务注册进度条并启动 fake progress
 * 返回 { task_id, finish: () => void }
 * task_id 随请求发给后端, 用于云函数 reportProgress 上报 (小程序侧使用)
 */
function registerTaskProgress(containerId) {
    const task_id = 'task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const progressBarId = `${containerId}-bar`;
    const textId = `${containerId}-text`;

    createProgressBar(containerId);

    return {
        task_id,
        startFallback: (minTime = 120000) => {
            startFakeProgress(progressBarId, textId, minTime);
        },
        // 强制完成 (HTTP 请求返回时调用)
        finish: () => {
            clearInterval(progressInterval);
            finishProgress(progressBarId, textId);
        }
    };
}

/**
 * 页面加载时从服务器恢复会话数据
 * 内网穿透断开后刷新页面，自动找回之前生成的结果
 */
async function recoverSession() {
    try {
        // 恢复分镜数据
        const segResponse = await fetchWithRetry('/api/results/segments', { credentials: 'include' }, 1);
        const segResult = await segResponse.json();
        if (segResult.success && segResult.data) {
            currentSegments = segResult.data;
            console.log('Recovered segments from server');
        }

        // 恢复角色数据
        const charResponse = await fetchWithRetry('/api/results/characters', { credentials: 'include' }, 1);
        const charResult = await charResponse.json();
        if (charResult.success && charResult.data && charResult.data.characters) {
            characters = charResult.data.characters;
            console.log('Recovered characters from server');
        }

        // 恢复单图映射
        const imgResponse = await fetchWithRetry('/api/results/images', { credentials: 'include' }, 1);
        const imgResult = await imgResponse.json();
        if (imgResult.success && imgResult.data && imgResult.data.images) {
            for (const item of imgResult.data.images) {
                if (item.key) {
                    generatedImages[item.key] = item.local_url;
                }
            }
            console.log(`Recovered ${imgResult.data.images.length} images from server`);
        }

        // 恢复整页映射
        const fpResponse = await fetchWithRetry('/api/results/full_pages', { credentials: 'include' }, 1);
        const fpResult = await fpResponse.json();
        if (fpResult.success && fpResult.data && fpResult.data.pages) {
            for (const item of fpResult.data.pages) {
                if (item.key !== undefined) {
                    fullPageImages[item.key] = item.local_url;
                    if (item.clean_url) fullPageCleanImages[item.key] = item.clean_url;
                    if (item.bubbles) fullPageBubbles[item.key] = item.bubbles;
                }
            }
            console.log(`Recovered ${fpResult.data.pages.length} full pages from server`);
        }

        // 兼容旧会话: 恢复历史拼版图映射
        try {
            const cpResponse = await fetchWithRetry('/api/results/combined_pages', { credentials: 'include' }, 1);
            const cpResult = await cpResponse.json();
            if (cpResult.success && cpResult.data && cpResult.data.pages) {
                for (const item of cpResult.data.pages) {
                    if (item.key !== undefined) {
                        combinedPageImages[item.key] = item.local_url;
                    }
                }
                console.log(`Recovered ${cpResult.data.pages.length} combined pages from server`);
            }
        } catch (e) {
            console.log('Combined pages recovery skipped:', e.message);
        }

        // 恢复漫画转小说结果
        const c2nResponse = await fetchWithRetry('/api/results/comic2novel', { credentials: 'include' }, 1);
        const c2nResult = await c2nResponse.json();
        if (c2nResult.success && c2nResult.data && c2nResult.data.novel_text) {
            comicNovelResult = c2nResult.data;
            renderComicNovelResult();
            console.log('Recovered comic-to-novel result from server');
        }

        // 恢复后重新渲染
        if (currentSegments.pages && currentSegments.pages.length > 0) {
            renderSegments();
            renderGallery();
        }
        if (characters.length > 0) {
            renderCharacters();
        }
    } catch (e) {
        console.log('Session recovery skipped:', e.message);
    }
}

/**
 * 将前端当前状态同步到服务器
 */
async function syncResults() {
    try {
        await fetchWithRetry('/api/sync/results', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                segments: currentSegments,
                characters: { characters: characters },
                generatedImages: generatedImages,
                fullPageImages: fullPageImages,
                combinedPageImages: combinedPageImages,
                fullPageCleanImages: fullPageCleanImages,
                fullPageBubbles: fullPageBubbles,
                comic2novel: comicNovelResult
            })
        }, 1);
    } catch (e) {
        console.log('Sync results failed:', e.message);
    }
}

// ========== 漫画转小说功能 ==========

/**
 * 处理漫画图片上传
 */
function handleComicUpload(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const previewContainer = document.getElementById('comic-preview-container');
    const thumbsContainer = document.getElementById('comic-preview-thumbs');
    const fileCount = document.getElementById('comic-file-count');

    let loaded = 0;
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const reader = new FileReader();
        reader.onload = function(e) {
            comicUploadedImages.push({
                name: file.name,
                data: e.target.result,
                pageIndex: comicUploadedImages.length
            });
            loaded++;
            if (loaded === files.length) {
                renderComicPreviews();
                previewContainer.classList.remove('hidden');
                fileCount.textContent = comicUploadedImages.length;
                showToast(`已加载 ${comicUploadedImages.length} 张图片`, 'success');
            }
        };
        reader.readAsDataURL(file);
    }
}

/**
 * 渲染漫画上传预览缩略图
 */
function renderComicPreviews() {
    const container = document.getElementById('comic-preview-thumbs');
    container.innerHTML = comicUploadedImages.map((img, idx) => `
        <div class="flex-shrink-0 w-32 border-2 border-gray-300 p-1 relative group">
            <img src="${img.data}" class="w-full h-24 object-cover">
            <div class="text-xs text-center text-gray-500 mt-1">第${idx + 1}页</div>
            <button onclick="removeComicImage(${idx})" class="absolute -top-2 -right-2 bg-red-600 text-white w-5 h-5 rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
        </div>
    `).join('');
}

/**
 * 移除已上传的漫画图片
 */
function removeComicImage(idx) {
    comicUploadedImages.splice(idx, 1);
    if (comicUploadedImages.length === 0) {
        document.getElementById('comic-preview-container').classList.add('hidden');
        document.getElementById('comic2novel-output').classList.add('hidden');
    } else {
        renderComicPreviews();
        document.getElementById('comic-file-count').textContent = comicUploadedImages.length;
    }
}

/**
 * 清空所有已上传图片
 */
function clearComicUpload() {
    comicUploadedImages = [];
    document.getElementById('comic-preview-container').classList.add('hidden');
    document.getElementById('comic2novel-output').classList.add('hidden');
    document.getElementById('comic-file-input').value = '';
    showToast('已清空所有图片', 'info');
}

/**
 * 开始漫画转小说
 */
async function startComicToNovel() {
    if (comicUploadedImages.length === 0) {
        showToast('请先上传漫画图片', 'error');
        return;
    }

    const config = JSON.parse(localStorage.getItem('manga_config') || '{}');
    if (!config.llm_api_url) {
        showToast('请先在API配置中填写LLM接口地址', 'error');
        openConfigModal();
        return;
    }

    const visionModel = document.getElementById('vision-model').value || 'gpt-4o';
    const btn = document.getElementById('comic2novel-btn');
    const spinner = document.getElementById('comic2novel-spinner');

    btn.disabled = true;
    spinner.classList.remove('hidden');

    // 任务进度条 (后端不推送, fake progress 展示)
    const task = registerTaskProgress('comic2novel-progress');
    task.startFallback(120000);

    try {
        const response = await fetchWithRetry('/api/comic-to-novel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                images: comicUploadedImages.map(img => img.data),
                api_url: config.llm_api_url,
                api_key: config.llm_api_key,
                model: visionModel,
                task_id: task.task_id
            })
        }, 2);

        const result = await response.json();
        task.finish();

        if (result.success) {
            comicNovelResult = result.data;
            renderComicNovelResult();
            showToast('小说生成成功！', 'success');
            syncResults();
        } else {
            showToast(result.error || '转换失败', 'error');
        }
    } catch (e) {
        task.finish();
        showToast('请求失败: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
        spinner.classList.add('hidden');
    }
}

/**
 * 显示漫画转小说结果
 */
function renderComicNovelResult() {
    const outputDiv = document.getElementById('comic2novel-output');
    const textDiv = document.getElementById('comic2novel-text');

    outputDiv.classList.remove('hidden');
    textDiv.textContent = comicNovelResult.novel_text || '（未生成文本）';

    outputDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * 复制小说文本到剪贴板
 */
function copyNovelText() {
    if (!comicNovelResult || !comicNovelResult.novel_text) {
        showToast('没有可复制的内容', 'error');
        return;
    }
    navigator.clipboard.writeText(comicNovelResult.novel_text).then(() => {
        showToast('已复制到剪贴板', 'success');
    }).catch(() => {
        const textarea = document.createElement('textarea');
        textarea.value = comicNovelResult.novel_text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showToast('已复制到剪贴板', 'success');
    });
}

/**
 * 下载小说文本为 .txt 文件
 */
function downloadNovelText() {
    if (!comicNovelResult || !comicNovelResult.novel_text) {
        showToast('没有可下载的内容', 'error');
        return;
    }
    const blob = new Blob([comicNovelResult.novel_text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `comic_to_novel_${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('下载成功', 'success');
}

async function handleLogout() {
    try {
        await fetch('/api/logout', { method: 'POST', credentials: 'include' });
        window.location.href = '/app';
    } catch (e) {
        window.location.href = '/app';
    }
}

async function checkAuth() {
    try {
        const response = await fetch('/api/check-auth', { credentials: 'include' });
        const result = await response.json();
        if (!result.logged_in) {
            window.location.href = '/app';
        }
    } catch (e) {
        window.location.href = '/app';
    }
}

checkAuth();

function createProgressBar(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return null;
    const progressHtml = `
        <div class="progress-container mt-3">
            <div class="progress-bar" id="${containerId}-bar"></div>
        </div>
        <div class="text-sm text-gray-600 mt-1" id="${containerId}-text">0%</div>
    `;
    container.innerHTML = progressHtml;
    return `${containerId}-bar`;
}

function startFakeProgress(progressBarId, textId, minTime = 120000) {
    clearInterval(progressInterval);

    const startTime = Date.now();
    // 对数增长曲线：先快后慢，max=90% (留10%给完成时跳到100%)
    // progress = 90 * (1 - exp(-elapsed * k / minTime))
    // 当elapsed=minTime时，progress ≈ 90 * 0.95 → "两分钟走到90%"
    const k = 3.0; // 增长系数 (调到3后, 在minTime处约走完 90% 的95%)

    // 条纹动效表示"任务在跑" (纯 CSS, 不增加定时器负担)
    const activeBar = document.getElementById(progressBarId);
    if (activeBar) activeBar.classList.add('is-active');

    progressInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const t = elapsed / minTime;
        // 对数曲线：1 - e^(-kt) 在 t=0 时为0，在 t→∞ 时趋近1
        // k=3 时: t=0.33 → 0.63, t=1.0 → 0.95, t=1.5 → 0.989
        const logProgress = 90 * (1 - Math.exp(-k * t));
        // 加入小波动让进度条看起来更自然
        const jitter = (Math.random() - 0.5) * 0.5;
        const progress = Math.min(90, Math.max(0, logProgress + jitter));

        const bar = document.getElementById(progressBarId);
        const text = document.getElementById(textId);
        // transform 不触发布局, 比 width 更流畅
        if (bar) bar.style.transform = `scaleX(${Math.min(1, Math.max(0, progress / 100))})`;
        if (text) text.textContent = `${Math.floor(progress)}%`;
    }, 200);
}

function finishProgress(progressBarId, textId) {
    clearInterval(progressInterval);
    const bar = document.getElementById(progressBarId);
    const text = document.getElementById(textId);
    if (bar) {
        bar.style.transform = 'scaleX(1)';
        // 结束时去掉条纹, 亮度闪一下 (重播需要先移除 class 再强制回流)
        bar.classList.remove('is-active', 'is-done');
        void bar.offsetWidth;
        bar.classList.add('is-done');
    }
    if (text) text.textContent = '100% - 完成';
}

function hideProgress(containerId) {
    clearInterval(progressInterval);
    const container = document.getElementById(containerId);
    if (container) container.innerHTML = '';
}

/**
 * 按钮冷却: 点击后禁用按钮, 文字改为"生成中…", 直到 finally 重新启用
 * 避免用户连点重复请求
 * 用法:
 *   const btn = document.getElementById('xxx-btn');
 *   const unlock = lockButton(btn, document.getElementById('xxx-label'));
 *   try { ... } finally { unlock(); }
 */
function lockButton(btn, labelEl, busyText) {
    if (!btn) return () => {};
    const originalText = labelEl ? labelEl.textContent : null;
    const wasDisabled = btn.disabled;
    btn.disabled = true;
    btn.classList.add('opacity-60', 'cursor-not-allowed');
    if (labelEl && busyText) labelEl.textContent = busyText;
    return function unlock() {
        btn.disabled = wasDisabled;
        btn.classList.remove('opacity-60', 'cursor-not-allowed');
        if (labelEl && originalText !== null) labelEl.textContent = originalText;
    };
}

async function runWithConcurrency(tasks, limit) {
    const results = [];
    const executing = [];
    for (const task of tasks) {
        const p = task().then(r => { executing.splice(executing.indexOf(p), 1); return r; });
        executing.push(p);
        results.push(p);
        if (executing.length >= limit) {
            await Promise.race(executing);
        }
    }
    return Promise.all(results);
}

function applyPreset(preset) {
    if (preset === 'volc') {
        // 火山引擎 v3 预设: MiniMax 文本 + 豆包图像 (用户当前默认配置)
        // API Key 不填, 用户需在火山引擎控制台获取
        document.getElementById('llm-api-url').value = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
        document.getElementById('llm-api-key').value = '';
        document.getElementById('llm-model').value = 'minimax-m3-1-250227';
        document.getElementById('img-api-url').value = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
        document.getElementById('img-api-key').value = '';
        document.getElementById('img-model').value = 'doubao-seedream-3-0-t2i-250415';
        showToast('火山引擎 v3 预设已应用，请填写 API Key！', 'success');
    } else if (preset === 'openai') {
        document.getElementById('llm-api-url').value = 'https://api.openai.com/v1/chat/completions';
        document.getElementById('img-api-url').value = 'https://api.openai.com/v1/images/generations';
        document.getElementById('llm-model').value = 'gpt-4';
        showToast('OpenAI 预设已应用！', 'success');
    }
}

function clearConfig() {
    document.getElementById('llm-api-url').value = '';
    document.getElementById('llm-api-key').value = '';
    document.getElementById('llm-model').value = '';
    document.getElementById('img-api-url').value = '';
    document.getElementById('img-api-key').value = '';
    document.getElementById('img-model').value = '';
    localStorage.removeItem('manga_config');
    document.getElementById('test-llm-result').innerHTML = '';
    document.getElementById('test-image-result').innerHTML = '';
    showToast('配置已清空！', 'success');
}

async function testLLM() {
    const btn = document.getElementById('test-llm-btn');
    const spinner = document.getElementById('test-llm-spinner');
    const resultDiv = document.getElementById('test-llm-result');
    
    btn.disabled = true;
    spinner.classList.remove('hidden');
    resultDiv.innerHTML = '';
    
    createProgressBar('test-llm-progress');
    startFakeProgress('test-llm-progress-bar', 'test-llm-progress-text', 2000);

    try {
        const response = await fetchWithRetry('/api/test-llm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                api_url: document.getElementById('llm-api-url').value,
                api_key: document.getElementById('llm-api-key').value,
                model: document.getElementById('llm-model').value
            })
        });

        const result = await response.json();
        finishProgress('test-llm-progress-bar', 'test-llm-progress-text');
        if (result.success) {
            resultDiv.innerHTML = `<div class="p-3 bg-green-50 border border-green-200 text-green-700 rounded"><span data-icon="check-circle" class="inline-block align-middle mr-1" style="color:#16a34a;width:14px;height:14px;"></span> ${result.message}</div>`;
            showToast('LLM API测试成功！', 'success');
        } else {
            resultDiv.innerHTML = `<div class="p-3 bg-red-50 border border-red-200 text-red-700 rounded"><span data-icon="x-circle" class="inline-block align-middle mr-1" style="color:#dc2626;width:14px;height:14px;"></span> ${result.error}</div>`;
            showToast('LLM API测试失败', 'error');
        }
    } catch (e) {
        finishProgress('test-llm-progress-bar', 'test-llm-progress-text');
        resultDiv.innerHTML = `<div class="p-3 bg-red-50 border border-red-200 text-red-700 rounded"><span data-icon="x-circle" class="inline-block align-middle mr-1" style="color:#dc2626;width:14px;height:14px;"></span> 请求失败：${e.message}</div>`;
        showToast('LLM API测试失败', 'error');
    } finally {
        btn.disabled = false;
        spinner.classList.add('hidden');
    }
}

async function testImage() {
    const btn = document.getElementById('test-image-btn');
    const spinner = document.getElementById('test-image-spinner');
    const resultDiv = document.getElementById('test-image-result');

    btn.disabled = true;
    spinner.classList.remove('hidden');
    resultDiv.innerHTML = '';
    
    createProgressBar('test-image-progress');
    startFakeProgress('test-image-progress-bar', 'test-image-progress-text', 2000);

    try {
        const response = await fetchWithRetry('/api/test-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                api_url: document.getElementById('img-api-url').value,
                api_key: document.getElementById('img-api-key').value,
                model: document.getElementById('img-model').value
            })
        });

        const result = await response.json();
        finishProgress('test-image-progress-bar', 'test-image-progress-text');
        if (result.success) {
            resultDiv.innerHTML = `<div class="p-3 bg-green-50 border border-green-200 text-green-700 rounded"><span data-icon="check-circle" class="inline-block align-middle mr-1" style="color:#16a34a;width:14px;height:14px;"></span> ${result.message}</div>`;
            showToast('Image API测试成功！', 'success');
        } else {
            resultDiv.innerHTML = `<div class="p-3 bg-red-50 border border-red-200 text-red-700 rounded"><span data-icon="x-circle" class="inline-block align-middle mr-1" style="color:#dc2626;width:14px;height:14px;"></span> ${result.error}</div>`;
            showToast('Image API测试失败', 'error');
        }
    } catch (e) {
        finishProgress('test-image-progress-bar', 'test-image-progress-text');
        resultDiv.innerHTML = `<div class="p-3 bg-red-50 border border-red-200 text-red-700 rounded"><span data-icon="x-circle" class="inline-block align-middle mr-1" style="color:#dc2626;width:14px;height:14px;"></span> 请求失败：${e.message}</div>`;
        showToast('Image API测试失败', 'error');
    } finally {
        btn.disabled = false;
        spinner.classList.add('hidden');
    }
}

function switchTab(tabName) {
    if (tabName === currentTab) return;
    // 入场方向跟随点击方向: 往右边的 tab 点 → 新面板从右侧滑入
    const dir = tabs.indexOf(tabName) >= tabs.indexOf(currentTab) ? 'right' : 'left';
    const fromTab = currentTab;
    // 顶部 tab / 移动 tab 样式立即切换 (独立于面板退场动画)
    tabs.forEach(t => {
        const topTab = document.getElementById(`tab-${t}`);
        if (topTab) topTab.className = t === tabName ? 'tab-active pb-2 px-1 text-lg transition-all' : 'tab-inactive pb-2 px-1 text-lg transition-all';
        const mtab = document.getElementById(`mtab-${t}`);
        if (mtab) mTabClass(mtab, t === tabName);
    });
    // 走 __t2cTransitions.swapPanel 编排: 旧面板退出 → 新面板进入 → 首屏子级联
    if (window.__t2cTransitions) {
        window.__t2cTransitions.swapPanel(`panel-${fromTab}`, `panel-${tabName}`, dir).then(() => {
            currentTab = tabName;
            staggerPanel(document.getElementById(`panel-${tabName}`));
            refreshInks();
            updateWorkspaceUI();
            if (tabName === 'history') refreshCurrentHistoryList();
        });
    } else {
        // 兜底 (transitions.js 加载失败时)
        document.getElementById(`panel-${fromTab}`).classList.add('hidden');
        const panel = document.getElementById(`panel-${tabName}`);
        panel.classList.remove('hidden');
        panel.classList.remove('fade-in', 'panel-in-left', 'panel-in-right');
        void panel.offsetWidth;
        panel.classList.add(dir === 'right' ? 'panel-in-right' : 'panel-in-left');
        currentTab = tabName;
        staggerPanel(panel);
        refreshInks();
        updateWorkspaceUI();
        if (tabName === 'history') refreshCurrentHistoryList();
    }
}

// 移动端 tab className 切换 (抽出来便于复用, 同时应用 mtab-spring 弹跳)
function mTabClass(el, isActive) {
    el.className = isActive ? 'mtab-active mtab-spring' : 'mtab-inactive';
}

// 模态框关闭动画: 先播放淡出过渡, 结束后再 display:none; 减少动效偏好时直接隐藏
function animateCloseModal(modalId, onClose) {
    const modal = document.getElementById(modalId);
    if (!modal || modal.classList.contains('hidden')) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        modal.classList.add('hidden');
        if (onClose) onClose();
        return;
    }
    if (modal._closing) return;
    modal._closing = true;
    modal.classList.add('modal-closing');
    setTimeout(() => {
        modal.classList.add('hidden');
        modal.classList.remove('modal-closing');
        modal._closing = false;
        if (onClose) onClose();
    }, 150);
}

function openConfigModal() {
    if (window.__t2cTransitions) {
        window.__t2cTransitions.openModal('config-modal');
    } else {
        const modal = document.getElementById('config-modal');
        modal.classList.remove('modal-closing', 'hidden');
    }
}

function closeConfigModal() {
    animateCloseModal('config-modal');
}

// ESC 键关闭弹窗
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeConfigModal();
        cancelPolishCompare();
    }
});

// ===== 历史记录管理 =====
async function loadHistoryList() {
    const container = document.getElementById('history-list');
    const countEl = document.getElementById('history-count');
    const usernameEl = document.getElementById('history-username');
    if (!container) return;

    container.innerHTML = '<div class="col-span-full text-center text-gray-400 py-12"><span class="loading-spinner inline-block align-middle mr-2" style="width:14px;height:14px;border-width:2px;"></span>加载中...</div>';

    try {
        const response = await fetchWithRetry('/api/history', { credentials: 'include' });
        const result = await response.json();
        if (!result.success) throw new Error(result.error || '加载失败');

        usernameEl.textContent = result.username || '-';
        countEl.textContent = (result.works || []).length;

        if (!result.works || result.works.length === 0) {
            container.innerHTML = emptyState(
                'books',
                '还没有历史作品',
                '生成漫画后点「保存当前」，作品会永久留在本机；换电脑时整个 static/users 目录拷走即可。',
                { onclick: 'saveCurrentToHistory()', label: '保存当前作品', fullSpan: true }
            );
            return;
        }

        // 拉取每个作品的详情（含图片列表和首张预览图）
        container.innerHTML = '';
        for (const work of result.works) {
            const card = document.createElement('div');
            card.className = 'manga-border bg-gray-50 p-4 flex flex-col';
            card.innerHTML = `<div class="aspect-video skeleton mb-3 flex items-center justify-center text-gray-400 text-sm">加载中...</div>`;
            container.appendChild(card);
            popIn(card);  // 每张卡片拿到数据时各自浮现

            try {
                const detailResp = await fetchWithRetry(`/api/history/${work.work_id}`, { credentials: 'include' });
                const detail = await detailResp.json();
                if (detail.success) {
                    const firstImg = (detail.images || [])[0];
                    const title = work.title || '未命名';
                    const created = formatDateTime(work.created_at);
                    const updated = formatDateTime(work.updated_at);
                    const imgCount = (detail.images || []).length;
                    card.innerHTML = `
                        <div class="aspect-video bg-gray-200 mb-3 flex items-center justify-center overflow-hidden">
                            ${firstImg ? `<img src="${firstImg}" class="w-full h-full object-cover" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'text-gray-400 text-sm\\'>无预览</div>'">` : '<div class="text-gray-400 text-sm">无图片</div>'}
                        </div>
                        <h3 class="font-bold text-base mb-1 truncate" title="${escapeHtml(title)}">${escapeHtml(title)}</h3>
                        <p class="text-xs text-gray-500 mb-1"><span data-icon="clock" class="inline-block align-[-2px] mr-1" style="width:11px;height:11px;"></span>创建: ${created}</p>
                        <p class="text-xs text-gray-500 mb-3"><span data-icon="note" class="inline-block align-[-2px] mr-1" style="width:11px;height:11px;"></span>更新: ${updated}</p>
                        <p class="text-xs text-gray-500 mb-3"><span data-icon="image" class="inline-block align-[-2px] mr-1" style="width:11px;height:11px;"></span>${imgCount} 张图片</p>
                        <div class="aspect-video bg-gray-200 mb-3 flex items-center justify-center overflow-hidden">
                            ${firstImg ? `<img src="${firstImg}" class="w-full h-full object-cover" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'text-gray-400 text-sm\\'>无预览</div>'">` : '<div class="text-gray-400 text-sm">无图片</div>'}
                        </div>
                        <h3 class="font-bold text-base mb-1 truncate" title="${escapeHtml(title)}">${escapeHtml(title)}</h3>
                        <p class="text-xs text-gray-500 mb-1"><span data-icon="clock" class="inline-block align-[-2px] mr-1" style="width:11px;height:11px;"></span>创建: ${created}</p>
                        <p class="text-xs text-gray-500 mb-3"><span data-icon="note" class="inline-block align-[-2px] mr-1" style="width:11px;height:11px;"></span>更新: ${updated}</p>
                        <p class="text-xs text-gray-500 mb-3"><span data-icon="image" class="inline-block align-[-2px] mr-1" style="width:11px;height:11px;"></span>${imgCount} 张图片</p>
                        <div class="flex gap-2 mt-auto">
                            <button onclick="loadHistoryWork('${work.work_id}')" class="flex-1 border-2 border-black bg-black text-white px-2 py-1.5 text-xs font-medium hover:bg-gray-800 transition-colors flex items-center justify-center gap-1"><span data-icon="folder-open" style="width:12px;height:12px;"></span>加载</button>
                            <button onclick="renameHistoryWork('${work.work_id}','${escapeHtml(title)}')" class="border-2 border-gray-300 hover:border-black px-2 py-1.5 text-xs transition-colors" title="重命名"><span data-icon="pencil" style="width:12px;height:12px;"></span></button>
                            <button onclick="deleteHistoryWork('${work.work_id}')" class="border-2 border-gray-300 hover:border-red-500 hover:text-red-500 px-2 py-1.5 text-xs transition-colors" title="删除"><span data-icon="trash" style="width:12px;height:12px;"></span></button>
                        </div>
                    `;
                    hydrateIcons(card);  // 渲染动态插入的 data-icon 为 SVG
                } else {
                    card.innerHTML = '<div class="text-red-500 text-sm p-4">加载失败</div>';
                }
            } catch (e) {
                card.innerHTML = `<div class="text-red-500 text-sm p-4">${escapeHtml(String(e.message || e))}</div>`;
            }
        }
        hydrateIcons(container);  // 兜底: 任何上面漏的也补上
    } catch (e) {
        container.innerHTML = `<div class="col-span-full text-center text-red-400 py-12">加载失败: ${escapeHtml(String(e.message || e))}</div>`;
    }
}

function formatDateTime(iso) {
    if (!iso) return '-';
    try {
        const d = new Date(iso);
        const pad = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch (e) { return iso; }
}

async function startNewWork(title) {
    try {
        const response = await fetchWithRetry('/api/work/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ title })
        });
        const result = await response.json();
        if (!result.success) throw new Error(result.error || '创建失败');
        return result;
    } catch (e) {
        showToast('创建作品失败: ' + e.message, 'error');
        throw e;
    }
}

async function saveCurrentState() {
    try {
        const response = await fetchWithRetry('/api/work/save-state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                novel_text: document.getElementById('novel-text')?.value || '',
                segments: currentSegments,
                characters: characters,
                generated_images: generatedImages,
                full_page_images: fullPageImages,
                combined_page_images: combinedPageImages,
                full_page_clean_images: fullPageCleanImages,
                full_page_bubbles: fullPageBubbles
            })
        });
        const result = await response.json();
        if (!result.success) throw new Error(result.error || '保存失败');
        markSaved();
    } catch (e) {
        console.error('saveCurrentState:', e);
        throw e;
    }
}

async function saveCurrentToHistory() {
    const title = prompt('为这部作品起个名字:', `作品 ${new Date().toLocaleString()}`);
    if (title === null) return;
    try {
        const created = await startNewWork(title.trim() || undefined);
        await saveCurrentState();
        markSaved((created && created.title) || title.trim() || '未命名作品');
        showToast('已保存到历史记录', 'success');
        loadHistoryList();
    } catch (e) {
        // 已由startNewWork弹错
    }
}

async function loadHistoryWork(workId) {
    if (!confirm('加载历史作品将覆盖当前内容，确定继续？')) return;
    try {
        // 先调用 load 接口
        await fetchWithRetry(`/api/history/${workId}/load`, {
            method: 'POST',
            credentials: 'include'
        });
        // 拉取完整数据
        const detailResp = await fetchWithRetry(`/api/history/${workId}`, { credentials: 'include' });
        const detail = await detailResp.json();
        if (!detail.success) throw new Error(detail.error || '加载失败');

        const state = detail.state || {};
        if (state.novel_text !== undefined) {
            const el = document.getElementById('novel-text');
            if (el) {
                el.value = state.novel_text;
                updateCharCount();
                mirrorNovelText();
            }
        }
        currentSegments = state.segments || { pages: [] };
        characters = state.characters || [];

        // 重建 generatedImages / fullPageImages / combinedPageImages
        // 注意: 兼容老数据 (save 端可能没写过 combined_page_images, 默认为 {})
        generatedImages = {};
        const gis = state.generated_images || {};
        for (const k in gis) generatedImages[k] = gis[k];
        fullPageImages = {};
        const fps = state.full_page_images || {};
        for (const k in fps) fullPageImages[k] = fps[k];
        combinedPageImages = {};
        const cps = state.combined_page_images || {};
        for (const k in cps) combinedPageImages[k] = cps[k];
        fullPageCleanImages = {};
        const fpcs = state.full_page_clean_images || {};
        for (const k in fpcs) fullPageCleanImages[k] = fpcs[k];
        fullPageBubbles = {};
        const fpb = state.full_page_bubbles || {};
        for (const k in fpb) fullPageBubbles[k] = fpb[k];

        // 校验完整性, 仅写入控制台不再弹红色 toast
        // (旧 _meta 字段可能与实际数据有偏差, 这个检查仅作为调试用)
        const meta = state._meta || {};
        const segNow = (currentSegments.pages || []).reduce((s, p) => s + (p.segments || []).length, 0);
        const expected = [
            ['分镜', meta.segment_count, segNow],
            ['角色', meta.character_count, characters.length],
        ];
        const mismatches = expected.filter(([_, exp, got]) => typeof exp === 'number' && exp !== got);
        if (mismatches.length > 0) {
            console.info('loadHistoryWork integrity (informational):', { meta, mismatches });
        }

        // 刷新各视图
        renderCharacters();
        renderSegments();
        renderGallery();

        // 加载成功的提示, 不再做完整性红色警告
        showToast(`作品已加载 (${segNow} 分镜, ${characters.length} 角色, ${Object.keys(generatedImages).length} 已生成图)`, 'success');

        // 加载成功后立即同步到服务器会话, 防止刷新/重连后丢图
        // 覆盖式存盘 (work_id 已经由后端 /load 设置到 session 里)
        syncResults().catch((e) => {
            console.warn('loadHistoryWork syncResults after load failed:', e);
        });

        // 检查角色人设图: 打印每个角色的 image_url 解析情况, 方便排查
        const charDiag = characters.map((c, i) => ({
            idx: i,
            name: c.name,
            has_image: !!(c.image_url || '').trim(),
            image_url: c.image_url,
        }));
        console.log('loadHistoryWork characters image status:', charDiag);
        const missingCharImg = charDiag.filter(c => !c.has_image).length;
        if (missingCharImg > 0) {
            showToast(`已加载, ${missingCharImg} 个角色缺人设图 (请检查作品目录 images/)`, 'error');
        }
        switchTab('gallery');  // 切到画廊直接看到所有图
    } catch (e) {
        console.error('loadHistoryWork:', e);
        showToast('加载失败: ' + (e.message || e), 'error');
    }
}

async function deleteHistoryWork(workId) {
    if (!confirm('确定删除这部作品？此操作不可恢复（图片和文字都将清除）。')) return;
    try {
        const response = await fetchWithRetry(`/api/history/${workId}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        const result = await response.json();
        if (result.success) {
            showToast('已删除', 'success');
            loadHistoryList();
        } else {
            showToast('删除失败: ' + (result.error || ''), 'error');
        }
    } catch (e) {
        showToast('删除失败: ' + e.message, 'error');
    }
}

async function renameHistoryWork(workId, oldTitle) {
    const newTitle = prompt('修改作品名:', oldTitle);
    if (newTitle === null || newTitle.trim() === '' || newTitle === oldTitle) return;
    try {
        const response = await fetchWithRetry(`/api/history/${workId}/rename`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ title: newTitle.trim() })
        });
        const result = await response.json();
        if (result.success) {
            showToast('已重命名', 'success');
            loadHistoryList();
        } else {
            showToast('重命名失败: ' + (result.error || ''), 'error');
        }
    } catch (e) {
        showToast('重命名失败: ' + e.message, 'error');
    }
}

// ===== AI 写作历史 (与漫画历史分开) =====
let _historySub = 'comic';  // 历史页子切换: comic | writing

function switchHistorySub(sub) {
    _historySub = sub;
    const comicBtn = document.getElementById('hist-sub-comic');
    const writingBtn = document.getElementById('hist-sub-writing');
    const comicWrap = document.getElementById('history-comic-wrap');
    const writingWrap = document.getElementById('history-writing-wrap');
    const saveBtn = document.getElementById('history-save-current-btn');
    const countLabel = document.getElementById('history-count-label');
    const activeCls = 'pb-2 px-1 text-base font-bold border-b-[3px] border-transparent';
    const inactiveCls = 'pb-2 px-1 text-base text-gray-500 border-b-[3px] border-transparent hover:border-gray-300';
    if (sub === 'writing') {
        comicBtn.className = inactiveCls;
        writingBtn.className = activeCls;
        if (comicWrap) comicWrap.classList.add('hidden');
        if (writingWrap) writingWrap.classList.remove('hidden');
        if (saveBtn) saveBtn.classList.add('hidden');
        if (countLabel) countLabel.textContent = '篇写作';
        loadWritingHistoryList();
    } else {
        writingBtn.className = inactiveCls;
        comicBtn.className = activeCls;
        if (writingWrap) writingWrap.classList.add('hidden');
        if (comicWrap) comicWrap.classList.remove('hidden');
        if (saveBtn) saveBtn.classList.remove('hidden');
        if (countLabel) countLabel.textContent = '部漫画';
        loadHistoryList();
    }
    refreshInks();
}

function refreshCurrentHistoryList() {
    if (_historySub === 'writing') loadWritingHistoryList();
    else loadHistoryList();
}

async function loadWritingHistoryList() {
    const container = document.getElementById('history-writing-list');
    const countEl = document.getElementById('history-count');
    if (!container) return;
    container.innerHTML = '<div class="col-span-full text-center text-gray-400 py-12"><span class="loading-spinner inline-block align-middle mr-2" style="width:14px;height:14px;border-width:2px;"></span>加载中...</div>';
    try {
        const response = await fetchWithRetry('/api/writings', { credentials: 'include' });
        const result = await response.json();
        if (!result.success) throw new Error(result.error || '加载失败');
        const works = result.works || [];
        if (countEl) countEl.textContent = works.length;
        if (works.length === 0) {
            container.innerHTML = emptyState(
                'pen',
                '还没有写作记录',
                '在「小说输入」或「AI 写作」里续写、润色之后会自动存到这里，可以随时翻回来接着改。',
                { onclick: "switchTab('aiwrite')", label: '去写一段', fullSpan: true }
            );
            return;
        }
        container.innerHTML = '';
        for (const w of works) {
            const card = document.createElement('div');
            card.className = 'manga-border bg-gray-50 p-4 flex flex-col';
            const title = w.title || '未命名';
            const created = formatDateTime(w.created_at);
            const updated = formatDateTime(w.updated_at);
            const chars = w.content_len || 0;
            card.innerHTML = `
                <div class="mb-2 w-10 h-10 bg-black text-white flex items-center justify-center" data-icon="pen" style="width:40px;height:40px;"></div>
                <h3 class="font-bold text-base mb-1 truncate" title="${escapeHtml(title)}">${escapeHtml(title)}</h3>
                <p class="text-xs text-gray-500 mb-1"><span data-icon="clock" class="inline-block align-[-2px] mr-1" style="width:11px;height:11px;"></span>创建: ${created}</p>
                <p class="text-xs text-gray-500 mb-1"><span data-icon="note" class="inline-block align-[-2px] mr-1" style="width:11px;height:11px;"></span>更新: ${updated}</p>
                <p class="text-xs text-gray-500 mb-3"><span data-icon="document" class="inline-block align-[-2px] mr-1" style="width:11px;height:11px;"></span>${chars} 字</p>
                <div class="flex gap-2 mt-auto">
                    <button onclick="loadWritingWork('${w.writing_id}')" class="flex-1 border-2 border-black bg-black text-white px-2 py-1.5 text-xs font-medium hover:bg-gray-800 transition-colors flex items-center justify-center gap-1"><span data-icon="folder-open" style="width:12px;height:12px;"></span>加载</button>
                    <button onclick="renameWritingWork('${w.writing_id}','${escapeHtml(title)}')" class="border-2 border-gray-300 hover:border-black px-2 py-1.5 text-xs transition-colors" title="重命名"><span data-icon="pencil" style="width:12px;height:12px;"></span></button>
                    <button onclick="deleteWritingWork('${w.writing_id}')" class="border-2 border-gray-300 hover:border-red-500 hover:text-red-500 px-2 py-1.5 text-xs transition-colors" title="删除"><span data-icon="trash" style="width:12px;height:12px;"></span></button>
                </div>
            `;
            container.appendChild(card);
            hydrateIcons(card);  // 渲染动态插入的 data-icon 为 SVG
            popIn(card);  // 写作卡片依次浮现
        }
        hydrateIcons(container);  // 兜底
    } catch (e) {
        container.innerHTML = `<div class="col-span-full text-center text-red-400 py-12">加载失败: ${escapeHtml(String(e.message || e))}</div>`;
    }
}

async function loadWritingWork(id) {
    try {
        const response = await fetchWithRetry(`/api/writing/${id}`, { credentials: 'include' });
        const result = await response.json();
        if (!result.success) throw new Error(result.error || '加载失败');
        const content = result.data.content || '';
        document.getElementById('novel-text').value = content;
        updateCharCount();
        mirrorNovelText();  // novel -> aiwrite
        currentWritingId = result.data.writing_id;
        localStorage.setItem('writing_id', currentWritingId);
        showToast(`已加载写作「${result.data.title || '未命名'}」`, 'success');
        switchTab('input');
    } catch (e) {
        showToast('加载失败: ' + e.message, 'error');
    }
}

async function renameWritingWork(id, currentTitle) {
    const newTitle = prompt('重命名写作:', currentTitle || '');
    if (newTitle === null) return;
    const t = newTitle.trim();
    if (!t || t === currentTitle) return;
    try {
        const response = await fetchWithRetry(`/api/writing/${id}/rename`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ title: t })
        });
        const result = await response.json();
        if (!result.success) throw new Error(result.error || '重命名失败');
        showToast('已重命名', 'success');
        loadWritingHistoryList();
    } catch (e) {
        showToast('重命名失败: ' + e.message, 'error');
    }
}

async function deleteWritingWork(id) {
    if (!confirm('确定删除这篇写作记录吗？')) return;
    try {
        const response = await fetchWithRetry(`/api/writing/${id}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        const result = await response.json();
        if (!result.success) throw new Error(result.error || '删除失败');
        if (currentWritingId === id) {
            currentWritingId = null;
            localStorage.removeItem('writing_id');
        }
        showToast('已删除', 'success');
        loadWritingHistoryList();
    } catch (e) {
        showToast('删除失败: ' + e.message, 'error');
    }
}

// 自动保存当前文本到写作历史 (续写/润色成功后调用; 无 id 时新建一篇)
async function autoSaveWriting() {
    const content = document.getElementById('novel-text')?.value || '';
    if (!content.trim()) return;
    const config = JSON.parse(localStorage.getItem('manga_config') || '{}');
    let title;
    if (!currentWritingId && config.llm_api_url) {
        // 首次保存: 尝试用 LLM 生成标题 (失败则后端用首行兜底)
        try {
            const resp = await fetchWithRetry('/api/generate-title', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    text: content.slice(0, 2000),
                    api_url: config.llm_api_url,
                    api_key: config.llm_api_key || '',
                    model: config.llm_model || ''
                })
            });
            const r = await resp.json();
            title = r.title || '';
        } catch (e) {
            console.warn('autoSaveWriting title gen skipped:', e);
        }
    }
    try {
        const resp = await fetchWithRetry('/api/writing/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ writing_id: currentWritingId || undefined, title, content })
        });
        const result = await resp.json();
        if (result.success) {
            currentWritingId = result.writing_id;
            localStorage.setItem('writing_id', currentWritingId);
        }
    } catch (e) {
        console.warn('autoSaveWriting failed:', e);
    }
}

async function saveCurrentWriting() {
    const content = document.getElementById('novel-text')?.value || '';
    if (!content.trim()) {
        showToast('请先输入小说内容', 'error');
        return;
    }
    await autoSaveWriting();
    showToast('已保存到写作历史', 'success');
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    const icons = { success: 'check-circle', error: 'warning', info: 'lightbulb' };
    const iconName = icons[type] || icons.info;
    toast.innerHTML = `<div class="toast-inner"><span class="toast-icon" data-icon="${iconName}"></span><span class="toast-text"></span></div><span class="toast-timer"></span>`;
    // 触发 hydrateIcons 渲染 SVG
    if (window.hydrateIcons) hydrateIcons(toast);
    toast.querySelector('.toast-text').textContent = message;
    toast.style.background = type === 'error' ? '#dc2626' : type === 'success' ? '#16a34a' : '#1a1a1a';
    toast.style.transform = 'translateY(0)';
    toast.style.opacity = '1';
    // 入场: 普通/成功弹入, 错误先弹入再抖一下
    toast.classList.remove('toast-pop', 'shake', 'toast-loading');
    void toast.offsetWidth;
    toast.classList.add(type === 'error' ? 'shake' : 'toast-pop');
    // 清除之前可能存在的计时器
    if (toast._hideTimer) {
        clearTimeout(toast._hideTimer);
        toast._hideTimer = null;
    }
    // 若为持久 toast, 不自动隐藏
    if (toast.dataset.persistent === '1') return;
    // 底部进度线跟着 3s 倒计时走完
    toast.classList.remove('is-counting');
    void toast.offsetWidth;
    toast.classList.add('is-counting');
    toast._hideTimer = setTimeout(() => {
        toast.classList.remove('is-counting');
        toast.style.transform = 'translateY(20px)';
        toast.style.opacity = '0';
        toast._hideTimer = null;
    }, 3000);
}

// 长时间显示的"加载中"提示, 返回 id 用于 dismiss
function showLoadingToast(message) {
    const toast = document.getElementById('toast');
    toast.innerHTML = '<div class="toast-inner"><span class="toast-icon">⏳</span><span class="toast-text"></span></div>';
    toast.querySelector('.toast-text').textContent = message;
    toast.style.background = '#1a1a1a';
    toast.style.transform = 'translateY(0)';
    toast.style.opacity = '1';
    // 弹入 + 持续呼吸光晕, 表示"还在跑"
    toast.classList.remove('toast-pop', 'shake', 'is-counting');
    void toast.offsetWidth;
    toast.classList.add('toast-loading');
    // 显式标记为"持久toast", 阻止 showToast 默认3秒后自动隐藏
    toast.dataset.persistent = '1';
    return 'toast';
}

function dismissLoadingToast(id) {
    if (id !== 'toast') return;
    const toast = document.getElementById('toast');
    if (toast._hideTimer) {
        clearTimeout(toast._hideTimer);
        toast._hideTimer = null;
    }
    toast.dataset.persistent = '';
    toast.classList.remove('toast-loading');
    toast.style.transform = 'translateY(20px)';
    toast.style.opacity = '0';
}

function updateCharCount() {
    const text = document.getElementById('novel-text').value;
    document.getElementById('char-count').textContent = text.length;
    markDirty();
    scheduleWorkspaceUI();
}

function updateAiwriteCharCount() {
    const t = document.getElementById('aiwrite-text');
    const el = document.getElementById('aiwrite-char-count');
    if (t && el) el.textContent = t.value.length;
}

// ===== 小说输入框 <-> AI 写作工作台 双向实时同步 =====
// 两个 textarea 不会同时可见, 无光标跳动问题; 守卫 + 值相等早退避免循环
let _textSyncing = false;
function mirrorNovelText() {           // novel -> aiwrite
    if (_textSyncing) return;
    const s = document.getElementById('novel-text');
    const d = document.getElementById('aiwrite-text');
    if (!s || !d || s.value === d.value) return;
    _textSyncing = true;
    d.value = s.value;
    _textSyncing = false;
    updateAiwriteCharCount();
}
function mirrorAiwriteText() {         // aiwrite -> novel
    if (_textSyncing) return;
    const s = document.getElementById('aiwrite-text');
    const d = document.getElementById('novel-text');
    if (!s || !d || s.value === d.value) return;
    _textSyncing = true;
    d.value = s.value;
    _textSyncing = false;
    updateCharCount();
}
document.getElementById('novel-text').addEventListener('input', () => {
    updateCharCount();
    mirrorNovelText();
});
const _aiwriteTextEl = document.getElementById('aiwrite-text');
if (_aiwriteTextEl) {
    _aiwriteTextEl.addEventListener('input', () => {
        updateAiwriteCharCount();
        mirrorAiwriteText();
    });
}

// ===== 风格Tag管理 =====
function renderStylePresets() {
    const container = document.getElementById('style-tag-presets');
    if (!container) return;
    container.innerHTML = '';

    // 按分类分组渲染
    STYLE_CATEGORIES.forEach(category => {
        const presetsInCategory = STYLE_PRESETS.filter(p => p.category === category);
        if (presetsInCategory.length === 0) return;

        const groupDiv = document.createElement('div');
        groupDiv.className = 'mb-3';

        // 分类标题
        const title = document.createElement('div');
        title.className = 'text-xs font-bold text-gray-700 mb-2 flex items-center gap-1';
        const categoryEmoji = {
            '日漫': 'A', '美漫': 'B', '韩漫': 'C', '国漫': 'D', '其他': 'E'
        }[category] || '🎨';
        title.innerHTML = `<span>${categoryEmoji}</span><span>${category}</span>`;
        groupDiv.appendChild(title);

        // 风格按钮组
        const btnGroup = document.createElement('div');
        btnGroup.className = 'flex flex-wrap gap-2';

        presetsInCategory.forEach(preset => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.dataset.id = preset.id;
            const isSelected = selectedPresetIds.has(preset.id);
            btn.className = isSelected
                ? 'px-3 py-1.5 text-sm font-medium border-2 border-black bg-black text-white transition-all'
                : 'px-3 py-1.5 text-sm font-medium border-2 border-gray-300 hover:border-black transition-all';
            btn.textContent = preset.label;
            btn.onclick = () => togglePresetStyle(preset.id);
            btnGroup.appendChild(btn);
        });

        groupDiv.appendChild(btnGroup);
        container.appendChild(groupDiv);
    });

    // 风格分组依次浮现
    playStagger(container);
}

function renderCustomStyleTags() {
    const container = document.getElementById('custom-style-tags');
    container.innerHTML = '';
    customStyleTags.forEach((tag, idx) => {
        const chip = document.createElement('span');
        chip.className = 'inline-flex items-center gap-1 px-2 py-1 text-sm border-2 border-black bg-gray-100';
        chip.innerHTML = `<span>${escapeHtml(tag)}</span><button type="button" onclick="removeCustomStyleTag(${idx})" class="text-gray-500 hover:text-black font-bold">×</button>`;
        container.appendChild(chip);
    });
}

function togglePresetStyle(id) {
    if (selectedPresetIds.has(id)) {
        selectedPresetIds.delete(id);
    } else {
        selectedPresetIds.add(id);
    }
    renderStylePresets();
    updateStyleSummary();
}

function addCustomStyleTag() {
    const input = document.getElementById('custom-style-input');
    const value = input.value.trim();
    if (!value) return;
    if (customStyleTags.includes(value)) {
        showToast('该风格已存在', 'error');
        return;
    }
    customStyleTags.push(value);
    input.value = '';
    renderCustomStyleTags();
    updateStyleSummary();
}

function removeCustomStyleTag(idx) {
    customStyleTags.splice(idx, 1);
    renderCustomStyleTags();
    updateStyleSummary();
}

// 切换风格面板展开/折叠
function toggleStylePanel() {
    const content = document.getElementById('style-panel-content');
    const icon = document.getElementById('style-toggle-icon');
    if (!content) return;
    if (content.classList.contains('hidden')) {
        content.classList.remove('hidden');
        icon.textContent = '▲';
    } else {
        content.classList.add('hidden');
        icon.textContent = '▼';
    }
}

// 清空所有已选风格
function clearAllStyles() {
    selectedPresetIds.clear();
    customStyleTags = [];
    renderStylePresets();
    renderCustomStyleTags();
    updateStyleSummary();
    showToast('已清空所有风格', 'info');
}

// 更新风格摘要 (显示在面板标题旁)
function updateStyleSummary() {
    const summaryEl = document.getElementById('style-summary');
    if (!summaryEl) return;
    const presetCount = selectedPresetIds.size;
    const customCount = customStyleTags.length;
    const total = presetCount + customCount;
    if (total === 0) {
        summaryEl.textContent = `(未选择风格, 将使用默认${comicMode === 'color' ? '彩色' : '黑白'}漫画风格)`;
    } else {
        const presetLabels = STYLE_PRESETS
            .filter(p => selectedPresetIds.has(p.id))
            .map(p => p.label);
        const allLabels = [...presetLabels, ...customStyleTags];
        summaryEl.textContent = `已选 ${total} 项: ${allLabels.join(', ')}`;
    }
}

function getStyleTagsString() {
    const parts = [];
    STYLE_PRESETS.forEach(p => {
        if (selectedPresetIds.has(p.id)) parts.push(p.tags);
    });
    parts.push(...customStyleTags);
    return parts.join(', ');
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ===== 单选组 (radio group) 通用渲染 =====
// 两组单选 (comic-mode / bubble-render-mode) 共享同一份 Tailwind 样式切换
function applyRadioGroupToDom(groupName, currentValue) {
    document.querySelectorAll(`input[name="${groupName}"]`).forEach(radio => {
        radio.checked = (radio.value === currentValue);
        const label = radio.closest('label');
        if (!label) return;
        const selected = radio.checked;
        label.classList.toggle('bg-black', selected);
        label.classList.toggle('text-white', selected);
        label.classList.toggle('border-black', selected);
        label.classList.toggle('border-gray-300', !selected);
        label.classList.toggle('hover:border-black', !selected);
        const sub = label.querySelector('span.block.text-xs');
        if (sub) {
            sub.classList.toggle('text-gray-500', !selected);
            sub.classList.toggle('opacity-70', selected);
        }
    });
}

// ===== 漫画模式 (黑白/彩色) =====
function getComicModeFromDom() {
    const el = document.querySelector('input[name="comic-mode"]:checked');
    return (el && el.value === 'color') ? 'color' : 'bw';
}

function applyComicModeToDom() {
    applyRadioGroupToDom('comic-mode', comicMode);
}

function onComicModeChange() {
    comicMode = getComicModeFromDom();
    applyComicModeToDom();
    updateStyleSummary();
    scheduleWorkspaceUI();
}

// ===== 气泡渲染方式 (PIL / API) =====
function getBubbleRenderModeFromDom() {
    const el = document.querySelector('input[name="bubble-render-mode"]:checked');
    return (el && el.value === 'api') ? 'api' : 'pil';
}

// 画廊中所有 .edit-bubble-btn 的可见性由 bubbleRenderMode 决定, 模式切换时
// 只翻转按钮, 不重建画廊 (避免每张图、每个 tooltip 全部重渲)
function _refreshBubbleEditButtons() {
    document.querySelectorAll('.edit-bubble-btn').forEach(btn => {
        const idx = +btn.dataset.pageIdx;
        const visible = bubbleRenderMode === 'pil'
            && fullPageCleanImages[idx]
            && fullPageBubbles[idx]
            && fullPageBubbles[idx].length > 0;
        btn.classList.toggle('hidden', !visible);
    });
}

function applyBubbleRenderModeToDom() {
    applyRadioGroupToDom('bubble-render-mode', bubbleRenderMode);
    _refreshBubbleEditButtons();
}

function onBubbleRenderModeChange() {
    bubbleRenderMode = getBubbleRenderModeFromDom();
    applyBubbleRenderModeToDom();
    scheduleWorkspaceUI();
    if (bubbleRenderMode === 'api') {
        showToast('已切换到"由图像API绘制气泡"模式, 跳过本地PIL, 不可编辑气泡位置', 'info');
    } else {
        showToast('已切换到"本地PIL叠加"模式', 'info');
    }
}

async function saveConfig() {
    const config = {
        llm_api_url: document.getElementById('llm-api-url').value,
        llm_api_key: document.getElementById('llm-api-key').value,
        llm_model: document.getElementById('llm-model').value,
        img_api_url: document.getElementById('img-api-url').value,
        img_api_key: document.getElementById('img-api-key').value,
        img_model: document.getElementById('img-model').value,
        segments_per_page: (() => {
            const v = parseInt(document.getElementById('segments-per-page').value);
            return isNaN(v) ? 0 : v;  // 0 = LLM 自由控制
        })(),
        negative_prompt: document.getElementById('negative-prompt').value,
        reference_strength: (() => {
            const v = parseFloat(document.getElementById('reference-strength')?.value);
            return isNaN(v) ? 0.6 : Math.max(0, Math.min(1, v));
        })(),
        style_preset_ids: Array.from(selectedPresetIds),
        custom_style_tags: customStyleTags.slice(),
        comic_mode: getComicModeFromDom(),
        bubble_render_mode: getBubbleRenderModeFromDom()
    };

    localStorage.setItem('manga_config', JSON.stringify(config));

    try {
        await fetch('/api/save-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(config)
        });
    } catch (e) {}

    showToast('配置已保存', 'success');
}

async function loadConfig() {
    // 先尝试从服务端加载配置
    try {
        const response = await fetch('/api/load-config', { credentials: 'include' });
        if (response.ok) {
            const serverConfig = await response.json();
            if (serverConfig && Object.keys(serverConfig).length > 0) {
                localStorage.setItem('manga_config', JSON.stringify(serverConfig));
                applyConfigToForm(serverConfig);
                return;
            }
        }
    } catch (e) {}
    // 回退到localStorage
    const saved = localStorage.getItem('manga_config');
    if (saved) {
        applyConfigToForm(JSON.parse(saved));
    }
}

function applyConfigToForm(config) {
    document.getElementById('llm-api-url').value = config.llm_api_url || '';
    document.getElementById('llm-api-key').value = config.llm_api_key || '';
    document.getElementById('llm-model').value = config.llm_model || '';
    document.getElementById('img-api-url').value = config.img_api_url || '';
    document.getElementById('img-api-key').value = config.img_api_key || '';
    document.getElementById('img-model').value = config.img_model || '';
    // 0 = LLM 自由控制; 旧配置没有该字段时默认 0
    const spp = (config.segments_per_page !== undefined) ? config.segments_per_page : 0;
    document.getElementById('segments-per-page').value = spp;
    document.getElementById('negative-prompt').value = config.negative_prompt || '';
    const rsEl = document.getElementById('reference-strength');
    if (rsEl) {
        rsEl.value = (config.reference_strength ?? 0.6);
        const rsLabel = document.getElementById('reference-strength-value');
        if (rsLabel) rsLabel.textContent = parseFloat(rsEl.value).toFixed(2);
    }

    // 恢复风格Tag选择
    // 日漫默认 日式ACG 画风: 配置里没存 style_preset_ids 时给 ['acg']
    const presetIds = (config.style_preset_ids && config.style_preset_ids.length > 0)
        ? config.style_preset_ids
        : ['acg'];
    selectedPresetIds = new Set(presetIds);
    customStyleTags = (config.custom_style_tags || []).slice();
    comicMode = (config.comic_mode === 'color') ? 'color' : 'bw';
    applyComicModeToDom();
    bubbleRenderMode = (config.bubble_render_mode === 'api') ? 'api' : 'pil';
    applyBubbleRenderModeToDom();
    renderStylePresets();
    renderCustomStyleTags();
    updateStyleSummary();
}

// ===== AI 写作作用域: 同一套续写/润色逻辑服务「AI 写作」页(默认)与「小说输入」页 =====
// scope 'aiwrite' → 用现有无前缀元素; scope 'input' → 用小说输入页的 inp- 前缀元素
function awId(scope, key) {
    const map = scope === 'input' ? {
        text: 'novel-text',
        plotOptions: 'inp-plot-options',
        direction: 'inp-continue-direction',
        length: 'inp-continue-length',
        genOptionsBtn: 'inp-gen-options-btn',
        genOptionsLabel: 'inp-gen-options-label',
        genOptionsSpinner: 'inp-gen-options-spinner',
        continueBtn: 'inp-continue-btn',
        continueLabel: 'inp-continue-label',
        continueSpinner: 'inp-continue-spinner',
        polishStyles: 'inp-polish-styles',
        polishStyle: 'inp-polish-style',
        genStylesBtn: 'inp-gen-styles-btn',
        genStylesLabel: 'inp-gen-styles-label',
        genStylesSpinner: 'inp-gen-styles-spinner',
        polishBtn: 'inp-polish-btn',
        polishLabel: 'inp-polish-label',
        polishSpinner: 'inp-polish-spinner',
        progress: 'inp-polish-progress',
    } : {
        text: 'aiwrite-text',
        plotOptions: 'plot-options',
        direction: 'continue-direction',
        length: 'continue-length',
        genOptionsBtn: 'gen-options-btn',
        genOptionsLabel: 'gen-options-label',
        genOptionsSpinner: 'gen-options-spinner',
        continueBtn: 'continue-novel-btn',
        continueLabel: 'continue-novel-label',
        continueSpinner: 'continue-novel-spinner',
        polishStyles: 'polish-styles',
        polishStyle: 'polish-style',
        genStylesBtn: 'gen-styles-btn',
        genStylesLabel: 'gen-styles-label',
        genStylesSpinner: 'gen-styles-spinner',
        polishBtn: 'polish-novel-btn',
        polishLabel: 'polish-novel-label',
        polishSpinner: 'polish-novel-spinner',
        progress: 'polish-progress',
    };
    return map[key];
}

function awEl(scope, key) {
    const id = awId(scope, key);
    return id ? document.getElementById(id) : null;
}

function awReadText(scope) {
    const el = awEl(scope, 'text');
    return el ? el.value : '';
}

function awApplyText(scope, newValue) {
    if (scope === 'input') {
        document.getElementById('novel-text').value = newValue;
        mirrorNovelText();
        updateCharCount();
    } else {
        document.getElementById('aiwrite-text').value = newValue;
        mirrorAiwriteText();
        updateAiwriteCharCount();
    }
}

// 小说输入页的 AI 写作折叠区
function toggleInpAIWrite() {
    const content = document.getElementById('inp-aw-content');
    const icon = document.getElementById('inp-aw-toggle-icon');
    if (!content) return;
    const hidden = content.classList.toggle('hidden');
    if (icon) icon.textContent = hidden ? '▼' : '▲';
}

// ===== AI 续写: 生成剧情选项 → 选择/自定义方向 → 续写 =====
let _plotOptions = [];
let _polishScope = 'aiwrite';  // 润色对比确认时回写的作用域

async function genPlotOptions(scope = 'aiwrite') {
    const text = awReadText(scope).trim();
    if (!text) {
        showToast('请先输入小说内容', 'error');
        return;
    }

    const config = JSON.parse(localStorage.getItem('manga_config') || '{}');
    if (!config.llm_api_url) {
        showToast('请先配置大语言模型API', 'error');
        openConfigModal();
        return;
    }

    const btn = awEl(scope, 'genOptionsBtn');
    const labelEl = awEl(scope, 'genOptionsLabel');
    const spinner = awEl(scope, 'genOptionsSpinner');
    spinner.classList.remove('hidden');
    const unlock = lockButton(btn, labelEl, '构思中…');
    const toastId = showLoadingToast('正在构思剧情发展方向…');

    try {
        const response = await fetchWithRetry('/api/plot-options', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                text: text,
                api_url: config.llm_api_url,
                api_key: config.llm_api_key || '',
                model: config.llm_model || ''
            })
        });
        const result = await response.json();
        dismissLoadingToast(toastId);
        if (result.success && Array.isArray(result.options) && result.options.length > 0) {
            _plotOptions = result.options;
            renderPlotOptions(scope);
            showToast('已生成剧情方向，点击选择一个', 'success');
        } else {
            showToast(result.error || '剧情方向生成失败', 'error');
        }
    } catch (e) {
        dismissLoadingToast(toastId);
        showToast('生成失败: ' + e.message, 'error');
    } finally {
        spinner.classList.add('hidden');
        unlock();
    }
}

function renderPlotOptions(scope = 'aiwrite') {
    const container = awEl(scope, 'plotOptions');
    if (!container) return;
    container.innerHTML = '';
    _plotOptions.forEach((opt, idx) => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'plot-option-card text-left p-3 border-2 border-gray-300 hover:border-black hover:bg-gray-50 transition-colors text-sm flex items-start gap-2';
        card.innerHTML = `<span class="font-bold text-xs text-gray-400 mt-0.5">${idx + 1}</span><span>${escapeHtml(opt)}</span>`;
        card.onclick = () => selectPlotOption(idx, scope);
        container.appendChild(card);
    });

    // 3 个剧情方向依次浮现
    playStagger(container);
}

function selectPlotOption(idx, scope = 'aiwrite') {
    const opt = _plotOptions[idx];
    if (!opt) return;
    const dirInput = awEl(scope, 'direction');
    if (dirInput) dirInput.value = opt;
    // 高亮选中卡片 (只作用于当前作用域的卡片)
    document.querySelectorAll(`#${awId(scope, 'plotOptions')} .plot-option-card`).forEach((el, i) => {
        el.classList.toggle('border-black', i === idx);
        el.classList.toggle('bg-gray-100', i === idx);
        el.classList.toggle('border-gray-300', i !== idx);
    });
}

async function continueNovel(scope = 'aiwrite') {
    const text = awReadText(scope).trim();
    if (!text) {
        showToast('请先输入小说内容', 'error');
        return;
    }

    const config = JSON.parse(localStorage.getItem('manga_config') || '{}');
    if (!config.llm_api_url) {
        showToast('请先配置大语言模型API', 'error');
        openConfigModal();
        return;
    }

    const length = parseInt(awEl(scope, 'length')?.value || '800', 10);
    const direction = (awEl(scope, 'direction')?.value || '').trim();

    const btn = awEl(scope, 'continueBtn');
    const labelEl = awEl(scope, 'continueLabel');
    const spinner = awEl(scope, 'continueSpinner');
    spinner.classList.remove('hidden');
    const unlock = lockButton(btn, labelEl, '续写中…');
    const toastId = showLoadingToast('AI 续写中，约需 30-60 秒…');

    try {
        const response = await fetchWithRetry('/api/continue-novel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                text: text,
                api_url: config.llm_api_url,
                api_key: config.llm_api_key || '',
                model: config.llm_model || '',
                length: length,
                direction: direction
            })
        });
        const result = await response.json();
        dismissLoadingToast(toastId);
        if (result.success && result.continuation) {
            awApplyText(scope, awReadText(scope).trimEnd() + '\n\n' + result.continuation);
            const ta = awEl(scope, 'text');
            if (ta) ta.scrollTop = ta.scrollHeight;
            const total = awReadText(scope).length;
            const n = result.length || result.continuation.length;
            const extra = [];
            if (result.compressed) extra.push('原文过长已用模型压缩前情上下文');
            if (total > 4000) extra.push('分镜可能只取头尾各2000字');
            const note = extra.length ? '，' + extra.join('，') : '';
            showToast(`已续写 ${n} 字（当前共 ${total} 字）${note}`, 'success');
            // 续写完成, 清空已选的剧情选项, 避免下次使用过期方向
            _plotOptions = [];
            renderPlotOptions(scope);
            // 续写后自动保存到写作历史
            autoSaveWriting();
        } else {
            showToast(result.error || '续写失败', 'error');
        }
    } catch (e) {
        dismissLoadingToast(toastId);
        showToast('续写失败: ' + e.message, 'error');
    } finally {
        spinner.classList.add('hidden');
        unlock();
    }
}

// ===== AI 润色: 生成润色风格 → 选择/自定义 → 润色 → 对比预览 → 替换 =====
let _polishStyles = [];
let _polishOriginal = '';
let _polishResult = '';

async function genPolishStyles(scope = 'aiwrite') {
    const text = awReadText(scope).trim();
    if (!text) {
        showToast('请先输入小说内容', 'error');
        return;
    }

    const config = JSON.parse(localStorage.getItem('manga_config') || '{}');
    if (!config.llm_api_url) {
        showToast('请先配置大语言模型API', 'error');
        openConfigModal();
        return;
    }

    const btn = awEl(scope, 'genStylesBtn');
    const labelEl = awEl(scope, 'genStylesLabel');
    const spinner = awEl(scope, 'genStylesSpinner');
    spinner.classList.remove('hidden');
    const unlock = lockButton(btn, labelEl, '构思中…');
    const toastId = showLoadingToast('正在构思润色风格…');

    try {
        const response = await fetchWithRetry('/api/polish-styles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                text: text,
                api_url: config.llm_api_url,
                api_key: config.llm_api_key || '',
                model: config.llm_model || ''
            })
        });
        const result = await response.json();
        dismissLoadingToast(toastId);
        if (result.success && Array.isArray(result.styles) && result.styles.length > 0) {
            _polishStyles = result.styles;
            renderPolishStyles(scope);
            showToast('已生成润色风格，点击选择一个', 'success');
        } else {
            showToast(result.error || '润色风格生成失败', 'error');
        }
    } catch (e) {
        dismissLoadingToast(toastId);
        showToast('生成失败: ' + e.message, 'error');
    } finally {
        spinner.classList.add('hidden');
        unlock();
    }
}

function renderPolishStyles(scope = 'aiwrite') {
    const container = awEl(scope, 'polishStyles');
    if (!container) return;
    container.innerHTML = '';
    _polishStyles.forEach((style, idx) => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'polish-style-card text-left p-3 border-2 border-gray-300 hover:border-black hover:bg-gray-50 transition-colors text-sm';
        card.innerHTML = `<div class="font-bold mb-0.5">${escapeHtml(style.name)}</div><div class="text-xs text-gray-500">${escapeHtml(style.instruction)}</div>`;
        card.onclick = () => selectPolishStyle(idx, scope);
        container.appendChild(card);
    });

    // 润色风格卡片依次浮现
    playStagger(container);
}

function selectPolishStyle(idx, scope = 'aiwrite') {
    const style = _polishStyles[idx];
    if (!style) return;
    const input = awEl(scope, 'polishStyle');
    if (input) input.value = style.instruction;
    // 高亮选中卡片
    document.querySelectorAll(`#${awId(scope, 'polishStyles')} .polish-style-card`).forEach((el, i) => {
        el.classList.toggle('border-black', i === idx);
        el.classList.toggle('bg-gray-100', i === idx);
        el.classList.toggle('border-gray-300', i !== idx);
    });
}

async function polishNovel(scope = 'aiwrite') {
    const text = awReadText(scope).trim();
    if (!text) {
        showToast('请先输入小说内容', 'error');
        return;
    }

    const config = JSON.parse(localStorage.getItem('manga_config') || '{}');
    if (!config.llm_api_url) {
        showToast('请先配置大语言模型API', 'error');
        openConfigModal();
        return;
    }

    // 捕获润色前的原文, 用于对比预览; 记录作用域以便确认时回写
    _polishOriginal = awReadText(scope);
    _polishScope = scope;

    if (text.length > 8000) {
        showToast('内容较长，润色可能需要 1-3 分钟', 'info');
    }

    const style = (awEl(scope, 'polishStyle')?.value || '').trim();
    const btn = awEl(scope, 'polishBtn');
    const labelEl = awEl(scope, 'polishLabel');
    const spinner = awEl(scope, 'polishSpinner');
    spinner.classList.remove('hidden');
    const unlock = lockButton(btn, labelEl, '润色中…');

    // 分块润色可能耗时较长, 用进度条展示
    const task = registerTaskProgress(awId(scope, 'progress'));
    task.startFallback(240000);

    try {
        const response = await fetchWithRetry('/api/polish-novel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                text: text,
                api_url: config.llm_api_url,
                api_key: config.llm_api_key || '',
                model: config.llm_model || '',
                style: style,
                task_id: task.task_id
            })
        });
        const result = await response.json();
        task.finish();
        if (result.success && result.polished) {
            _polishResult = result.polished;
            openPolishCompare();
        } else {
            showToast(result.error || '润色失败', 'error');
        }
    } catch (e) {
        task.finish();
        showToast('润色失败: ' + e.message, 'error');
    } finally {
        spinner.classList.add('hidden');
        unlock();
    }
}

function openPolishCompare() {
    const modal = document.getElementById('polish-compare-modal');
    if (!modal) return;
    document.getElementById('polish-original').textContent = _polishOriginal;
    document.getElementById('polish-result').textContent = _polishResult;
    if (window.__t2cTransitions) {
        window.__t2cTransitions.openModal('polish-compare-modal');
    } else {
        modal.classList.remove('modal-closing', 'hidden');
    }
}

function cancelPolishCompare() {
    animateCloseModal('polish-compare-modal');
}

function confirmPolishReplace() {
    const scope = _polishScope || 'aiwrite';
    // 润色期间原文可能被改过, 提醒用户
    if (awReadText(scope) !== _polishOriginal && !confirm('原文在润色期间被修改过，确定用润色稿覆盖吗？')) {
        return;
    }
    awApplyText(scope, _polishResult);
    cancelPolishCompare();
    const total = awReadText(scope).length;
    showToast(`润色完成并已替换（当前共 ${total} 字）`, 'success');
    // 清理已生成的风格, 避免下次使用过期风格
    _polishStyles = [];
    renderPolishStyles(scope);
    // 润色替换后自动保存到写作历史
    autoSaveWriting();
}

async function startSegment() {
    const text = document.getElementById('novel-text').value.trim();
    if (!text) {
        showToast('请先输入小说内容', 'error');
        return;
    }

    const config = JSON.parse(localStorage.getItem('manga_config') || '{}');
    if (!config.llm_api_url) {
        showToast('请先配置大语言模型API', 'error');
        openConfigModal();
        return;
    }

    const spinner = document.getElementById('segment-spinner');
    spinner.classList.remove('hidden');

    const unlock = lockButton(
        document.getElementById('start-segment-btn'),
        document.getElementById('start-segment-label'),
        '分镜生成中…'
    );

    // 任务进度条 (后端不推送, fake progress 展示)
    const task = registerTaskProgress('segment-progress');
    task.startFallback(120000);

    try {
        const response = await fetchWithRetry('/api/segment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                text: text,
                api_url: config.llm_api_url,
                api_key: config.llm_api_key,
                model: config.llm_model,
                segments_per_page: (config.segments_per_page !== undefined) ? config.segments_per_page : 0,
                comic_mode: comicMode,
                task_id: task.task_id
            })
        });

        const result = await response.json();
        task.finish();
        if (result.success) {
            // 任务5: 新分镜 = 新作品, 先清空前次的图片缓存 (旧图、引用图、work/images)
            try {
                await fetchWithRetry('/api/clear-cache', { method: 'POST', credentials: 'include' }, 1);
            } catch (e) { console.log('clear-cache skipped:', e.message); }
            generatedImages = {};
            fullPageImages = {};
            combinedPageImages = {};
            fullPageCleanImages = {};
            fullPageBubbles = {};
            // 清空角色人设图（新小说的人物形象可能不同）
            characters.forEach(c => { c.image_url = ''; c.char_prompt = ''; });
            renderGallery();

            currentSegments = result.data;
            // 任务4: 一次 LLM 调用同时拿到分镜 + 角色
            const newChars = Array.isArray(result.characters) ? result.characters : [];
            const hadChars = characters && characters.length > 0;
            if (newChars.length > 0) {
                if (!hadChars) {
                    characters = newChars;
                } else {
                    const existing = new Set(characters.map(c => (c.name || '').trim()));
                    for (const c of newChars) {
                        if (c && c.name && !existing.has((c.name || '').trim())) {
                            characters.push(c);
                        }
                    }
                }
                renderCharacters();
                syncResults();
            }
            renderSegments();
            syncResults();
            const charCount = newChars.length;
            const charMsg = charCount > 0 ? `，并自动提取 ${charCount} 个角色` : '';
            showToast(`成功生成 ${currentSegments.pages.length} 页分镜${charMsg}，旧图片已清除`, 'success');
            // 任务5: 自动保存到当前作品
            saveCurrentState().catch(e => console.log('auto save work error:', e));
            if (newChars.length > 0) {
                switchTab('characters');
            } else {
                switchTab('segments');
            }
        } else {
            showToast(result.error || '分镜失败', 'error');
        }
    } catch (e) {
        task.finish();
        showToast('请求失败: ' + e.message, 'error');
    } finally {
        spinner.classList.add('hidden');
        unlock();
    }
}

function renderSegments() {
    const container = document.getElementById('segments-container');
    // 重新渲染前清掉 stagger 标记, 让下次 playStagger 能再触发级联
    if (window.__t2cTransitions) window.__t2cTransitions.resetStagger(container);
    if (!currentSegments.pages || currentSegments.pages.length === 0) {
        container.innerHTML = emptyState(
            'note',
            '还没有分镜',
            '回到「小说输入」粘贴正文，点「开始智能分镜」，模型会按情节切页分格，并给每句对白挑一种语气。',
            { onclick: "switchTab('input')", label: '去输入小说' }
        );
        return;
    }

    container.innerHTML = currentSegments.pages.map((page, pageIdx) => {
        const hasFullPageImage = fullPageImages[pageIdx];
        const allSelectedChars = [];
        page.segments.forEach(seg => {
            if (seg.selected_characters) {
                seg.selected_characters.forEach(cIdx => {
                    if (!allSelectedChars.includes(cIdx)) {
                        allSelectedChars.push(cIdx);
                    }
                });
            }
        });
        
        return `
        <div class="comic-page p-6">
            <div class="flex justify-between items-center mb-4 pb-2 border-b-2 border-gray-200">
                <h3 class="text-lg font-bold">第 ${page.page_number} 页</h3>
                <div class="flex gap-2">
                    <button onclick="generateFullPage(${pageIdx}, false, null, this)" class="text-sm bg-black text-white px-3 py-1 hover:bg-gray-800 transition-colors flex items-center gap-1">
                        <span>整页生成</span>
                        <span id="full-page-spinner-${pageIdx}" class="loading-spinner hidden" style="width:12px;height:12px;border-width:1px;"></span>
                    </button>
                </div>
            </div>
            ${hasFullPageImage ? `
            <div class="mb-6 border-2 border-black p-1">
                <div class="text-sm text-gray-600 mb-2 flex items-center gap-1"><span data-icon="check-circle" style="width:14px;height:14px;color:#16a34a;"></span>整页漫画</div>
                <img src="${hasFullPageImage}" class="w-full cursor-pointer" onclick="openModal('${hasFullPageImage}')">
            </div>
            ` : ''}
            <div class="text-xs text-gray-500 mb-3">
                本页出场角色: ${allSelectedChars.length > 0 ? allSelectedChars.map(cIdx => characters[cIdx]?.name || cIdx).join(', ') : '（未选择角色）'}
            </div>
            <div class="grid md:grid-cols-2 gap-4">
                ${page.segments.map((seg, segIdx) => {
                    const key = `${pageIdx}-${segIdx}`;
                    const selectedChars = seg.selected_characters || [];
                    // 任务2: 镜头语言枚举选项 (与服务端 STYLE_TAG_MAP 一致)
                    const camOpts = ['俯视','仰视','平视','斜视','主观视角'];
                    const compOpts = ['三分法','对称','中心对称','框架式','引导线'];
                    const moodOpts = ['紧张','紫蓝','紫红','暧昧','悲伤','温馨','压抑','恐怖'];
                    const scaleOpts = ['大远景','远景','全景','中景','近景','特写','大特写'];
                    const lightOpts = ['硬光','背光','顶光','荧光灯','光斑','柔光','侧光','剪影'];
                    const typeOpts = ['静态','动态','回忆','梦境'];
                    const optHtml = (opts, cur) => `<option value=''>(无)</option>` + opts.map(o => `<option ${o===cur?'selected':''}>${o}</option>`).join('');
                    return `
                    <div class="segment-box p-4 relative" id="segment-${key}">
                        <div class="flex justify-between items-start mb-2">
                            <span class="text-xs font-bold bg-black text-white px-2 py-1">分镜 ${seg.segment_number}</span>
                            <span class="text-xs text-gray-500">${seg.shot_type || '未指定'}</span>
                        </div>
                        <div class="mb-2">
                            <label class="text-xs text-gray-500 font-medium">出场角色 (参考图)</label>
                            <div class="flex flex-wrap gap-2 mt-1">
                                ${characters.length === 0 ? `
                                    <span class="text-xs text-gray-400">请先到"角色管理"生成角色</span>
                                ` : characters.map((char, charIdx) => {
                                    const hasImage = !!(char.image_url || '').trim();
                                    const hasText = !!(char.char_prompt || '').trim() || !!(char.description || '').trim();
                                    // 三档: 有图(强参考) / 有文字描述(弱参考) / 都没(不能作为参考)
                                    const refState = hasImage ? 'image' : hasText ? 'text' : 'none';
                                    const dimClass = refState === 'none' ? 'opacity-40' : '';
                                    const title = refState === 'image'
                                        ? '已上传人设图, 角色将以图为准生成'
                                        : refState === 'text'
                                            ? '无图但有文字描述, 将按文字提示词生成 (效果较弱)'
                                            : '既无图也无描述, 不能作为参考';
                                    return `
                                    <label class="flex items-center gap-1 text-xs bg-gray-100 px-2 py-1 rounded cursor-pointer hover:bg-gray-200 ${dimClass}" title="${title}">
                                        <input type="checkbox"
                                            ${selectedChars.includes(charIdx) ? 'checked' : ''}
                                            ${refState === 'none' ? 'disabled' : ''}
                                            onchange="toggleCharacter(${pageIdx}, ${segIdx}, ${charIdx})"
                                            class="mr-1">
                                        ${char.name}${refState === 'image' ? ' ▣' : refState === 'text' ? ' 📝' : ' (无)'}
                                    </label>
                                `;}).join('')}
                            </div>
                        </div>
                        <div class="mb-2">
                            <label class="text-xs text-gray-500 font-medium">场景描述</label>
                            <textarea
                                onchange="updateSegment(${pageIdx}, ${segIdx}, 'scene_description', this.value)"
                                class="w-full p-2 border border-gray-300 text-sm mt-1 resize-none focus:border-black outline-none"
                                rows="2">${seg.scene_description || ''}</textarea>
                        </div>
                        <div class="mb-2">
                            <label class="text-xs text-gray-500 font-medium">对话/旁白 (类型决定气泡形状)</label>
                            <textarea
                                onchange="updateSegment(${pageIdx}, ${segIdx}, 'dialogue', this.value)"
                                class="w-full p-2 border border-gray-300 text-sm mt-1 resize-none focus:border-black outline-none"
                                rows="1">${seg.dialogue || ''}</textarea>
                            <div class="mt-1 flex items-center gap-2">
                                <select onchange="updateSegment(${pageIdx}, ${segIdx}, 'dialogue_type', this.value); syncBubbleMini(this)"
                                    class="text-xs border border-gray-300 focus:border-black outline-none p-1 bg-white"
                                    title="气泡形状(LLM 分镜规划时会主动选, 可手动覆盖)">
                                    <option value="dialogue" ${(!seg.dialogue_type || seg.dialogue_type==='dialogue')?'selected':''}>○ 对话气泡 (圆角矩形)</option>
                                    <option value="thought" ${seg.dialogue_type==='thought'?'selected':''}>◌ 心理活动 (云形)</option>
                                    <option value="shout" ${seg.dialogue_type==='shout'?'selected':''}>※ 大喊 (锯齿/爆炸)</option>
                                    <option value="whisper" ${seg.dialogue_type==='whisper'?'selected':''}>· 耳语 (虚线圆角)</option>
                                    <option value="burst" ${seg.dialogue_type==='burst'?'selected':''}>⚡ 爆发 (辐射射线)</option>
                                    <option value="narration" ${seg.dialogue_type==='narration'?'selected':''}>▭ 旁白叙述 (矩形)</option>
                                    <option value="box" ${seg.dialogue_type==='box'?'selected':''}>▢ 方框 (无尾矩形)</option>
                                    <option value="caption" ${seg.dialogue_type==='caption'?'selected':''}>▲ 拟声词 (黑底白字)</option>
                                </select>
                                <span class="bubble-mini" data-type="${(seg.dialogue_type || 'dialogue').toLowerCase()}" title="气泡形状预览"></span>
                                <span class="text-[10px] text-gray-400">形状预览</span>
                            </div>
                        </div>
                        <details class="mb-2" ${seg.camera_angle || seg.composition || seg.mood || seg.shot_scale || seg.lighting || seg.of_type ? 'open' : ''}>
                            <summary class="text-xs text-gray-500 font-medium cursor-pointer select-none">镜头语言 (任务2) ${(seg.camera_angle || seg.composition || seg.mood || seg.shot_scale || seg.lighting || seg.of_type) ? '<span class="text-green-600">●</span>' : ''}</summary>
                            <div class="grid grid-cols-2 gap-2 mt-2">
                                <div>
                                    <label class="text-[10px] text-gray-500">视角</label>
                                    <select onchange="updateSegment(${pageIdx}, ${segIdx}, 'camera_angle', this.value)" class="w-full p-1 text-xs border border-gray-300 focus:border-black outline-none">${optHtml(camOpts, seg.camera_angle || '')}</select>
                                </div>
                                <div>
                                    <label class="text-[10px] text-gray-500">构图</label>
                                    <select onchange="updateSegment(${pageIdx}, ${segIdx}, 'composition', this.value)" class="w-full p-1 text-xs border border-gray-300 focus:border-black outline-none">${optHtml(compOpts, seg.composition || '')}</select>
                                </div>
                                <div>
                                    <label class="text-[10px] text-gray-500">情绪</label>
                                    <select onchange="updateSegment(${pageIdx}, ${segIdx}, 'mood', this.value)" class="w-full p-1 text-xs border border-gray-300 focus:border-black outline-none">${optHtml(moodOpts, seg.mood || '')}</select>
                                </div>
                                <div>
                                    <label class="text-[10px] text-gray-500">景别</label>
                                    <select onchange="updateSegment(${pageIdx}, ${segIdx}, 'shot_scale', this.value)" class="w-full p-1 text-xs border border-gray-300 focus:border-black outline-none">${optHtml(scaleOpts, seg.shot_scale || '')}</select>
                                </div>
                                <div>
                                    <label class="text-[10px] text-gray-500">光照</label>
                                    <select onchange="updateSegment(${pageIdx}, ${segIdx}, 'lighting', this.value)" class="w-full p-1 text-xs border border-gray-300 focus:border-black outline-none">${optHtml(lightOpts, seg.lighting || '')}</select>
                                </div>
                                <div>
                                    <label class="text-[10px] text-gray-500">场景类型</label>
                                    <select onchange="updateSegment(${pageIdx}, ${segIdx}, 'of_type', this.value)" class="w-full p-1 text-xs border border-gray-300 focus:border-black outline-none">${optHtml(typeOpts, seg.of_type || '')}</select>
                                </div>
                            </div>
                        </details>
                        <div class="mb-3">
                            <label class="text-xs text-gray-500 font-medium">绘图提示词 (已含镜头语言升级)</label>
                            <textarea
                                onchange="updateSegment(${pageIdx}, ${segIdx}, 'style_prompt', this.value)"
                                class="w-full p-2 border border-gray-300 text-sm mt-1 resize-none focus:border-black outline-none font-mono text-xs"
                                rows="2">${seg.style_prompt || 'black and white manga style, detailed ink drawing'}</textarea>
                        </div>
                    </div>
                    `;
                }).join('')}
            </div>
        </div>
    `}).join('');

    // 每页卡片进入视口时级联入场
    playStagger(container, '.comic-page');
    scheduleWorkspaceUI();
}

function updateSegment(pageIdx, segIdx, field, value) {
    currentSegments.pages[pageIdx].segments[segIdx][field] = value;
}

function toggleCharacter(pageIdx, segIdx, charIdx) {
    if (!currentSegments.pages[pageIdx].segments[segIdx].selected_characters) {
        currentSegments.pages[pageIdx].segments[segIdx].selected_characters = [];
    }
    const selected = currentSegments.pages[pageIdx].segments[segIdx].selected_characters;
    const idx = selected.indexOf(charIdx);
    if (idx > -1) {
        selected.splice(idx, 1);
    } else {
        selected.push(charIdx);
    }
    renderSegments();
}

async function generateFullPage(pageIdx, skipLock = false, previousPageImage = null, btn = null) {
    if (!skipLock && isGenerating) {
        showToast('请等待当前生成完成', 'error');
        return;
    }

    const config = JSON.parse(localStorage.getItem('manga_config') || '{}');
    if (!config.img_api_url) {
        showToast('请先配置图像生成API', 'error');
        openConfigModal();
        return;
    }

    if (!skipLock) isGenerating = true;
    scheduleWorkspaceUI();
    const spinner = document.getElementById(`full-page-spinner-${pageIdx}`);
    if (spinner) spinner.classList.remove('hidden');
    // 动态按钮, 用 lockButton 锁住避免连点
    const targetBtn = btn || document.querySelector(`#panel-segments button[onclick*="generateFullPage(${pageIdx}"]`);
    const labelEl = targetBtn ? targetBtn.querySelector('span:not([id*="spinner"])') : null;
    const unlock = lockButton(targetBtn, labelEl, '整页生成中…');

    const page = currentSegments.pages[pageIdx];

    // 自动取上一页整页图作为参考 (若调用方未显式传入)
    // 这样单页生成时也能保持人物和画风一致
    if (!previousPageImage && pageIdx > 0) {
        previousPageImage = fullPageImages[pageIdx - 1] || null;
        if (previousPageImage) {
            console.log(`[generateFullPage] Auto-using previous page ${pageIdx} image as reference: ${previousPageImage}`);
        }
    }

    // 参考角色: 优先用本页每个 segment 用户勾选的角色 union (per-panel 角色白名单);
    // 没勾选过任何角色时, 回退到全角色 (保持向后兼容)。
    // 这样未勾选的角色就不会污染 prompt 和 reference 列表, 也能省 base64 payload。
    const pageSel = new Set();
    (page.segments || []).forEach(seg => {
        (seg.selected_characters || []).forEach(i => {
            if (Number.isInteger(i)) pageSel.add(i);
        });
    });
    const idxList = pageSel.size > 0 ? [...pageSel] : characters.map((_, i) => i);
    const characterReferences = idxList.map(i => {
        const char = characters[i];
        if (!char) return null;
        const ref = {
            name: char.name,
            description: char.description,
            char_prompt: char.char_prompt || ''
        };
        if (char.image_url) ref.image_url = char.image_url;
        return ref;
    }).filter(Boolean);

    // 任务进度条 (单页生成, 仅在非批量模式下显示)
    let task = null;
    if (!skipLock) {
        task = registerTaskProgress(`fullpage-progress-${pageIdx}`);
        task.startFallback(90000);
    }

    try {
        const response = await fetchWithRetry('/api/generate-page', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                page: page,
                page_num: page.page_number,
                api_url: config.img_api_url,
                api_key: config.img_api_key,
                model: config.img_model,
                negative_prompt: config.negative_prompt,
                style_tags: getStyleTagsString(),
                comic_mode: comicMode,
                bubble_render_mode: bubbleRenderMode,
                character_references: characterReferences,
                references: characterReferences,  // 兼容新字段名
                reference_strength: (config.reference_strength ?? 0.6),
                previous_page_image: previousPageImage,
                page_idx: pageIdx,
                task_id: task ? task.task_id : ''
            })
        });

        const result = await response.json();
        if (task) task.finish();
        if (result.success) {
            let finalImageUrl = result.image_url;
            fullPageImages[pageIdx] = finalImageUrl;
            if (result.clean_image_url) fullPageCleanImages[pageIdx] = result.clean_image_url;
            if (result.bubbles) fullPageBubbles[pageIdx] = result.bubbles;
            renderSegments();
            renderGallery();
            syncResults();  // 同步到 session(供断网恢复)
            // 关键修复: 同时持久化到当前作品, 避免单页生成后 state.json 不更新
            // 用户只有刷新页面/重新登录才会发现图丢了; 现在生成即落盘
            saveCurrentState().catch(e => console.warn('save work after page gen failed:', e));
            showToast(`第 ${page.page_number} 页整页生成成功`, 'success');
        } else {
            showToast(result.error || '生成失败', 'error');
        }
    } catch (e) {
        if (task) task.finish();
        showToast('请求失败: ' + e.message, 'error');
    } finally {
        if (!skipLock) isGenerating = false;
        scheduleWorkspaceUI();
        if (spinner) spinner.classList.add('hidden');
        unlock();
    }
}

// ===== 批量生成暂停控制 =====
function toggleBatchPause() {
    batchPaused = !batchPaused;
    const label = document.getElementById('batch-pause-label');
    const btn = document.getElementById('batch-pause-btn');
    if (batchPaused) {
        label.textContent = '▶️ 继续';
        btn.classList.replace('border-yellow-500', 'border-green-500');
        btn.classList.replace('bg-yellow-50', 'bg-green-50');
        btn.classList.replace('text-yellow-700', 'text-green-700');
        showToast('已暂停, 点击继续恢复', 'info');
    } else {
        label.textContent = '暂停';
        btn.classList.replace('border-green-500', 'border-yellow-500');
        btn.classList.replace('bg-green-50', 'bg-yellow-50');
        btn.classList.replace('text-green-700', 'text-yellow-700');
        showToast('继续生成', 'info');
    }
}

/**
 * 在批量循环中检查暂停状态。如果被暂停就原地等待, 直到继续或取消。
 * 返回 false 表示被外部中止 (isGenerating=false 或 batchStopRequested=true)
 */
async function _checkBatchPause() {
    while (batchPaused && isGenerating && !batchStopRequested) {
        await new Promise(r => setTimeout(r, 200));
    }
    return isGenerating && !batchStopRequested;
}

/**
 * 用户主动停止批量生成
 */
function stopBatchGenerate() {
    if (!isGenerating) {
        showToast('当前没有正在进行的生成任务', 'info');
        return;
    }
    if (!confirm('确定要停止当前批量生成吗? 已生成的页面会保留。')) return;
    batchStopRequested = true;
    batchPaused = false;  // 同时取消暂停, 让循环能跳出
    showToast('正在停止生成, 请稍候...', 'info');
    const stopBtn = document.getElementById('batch-stop-btn');
    if (stopBtn) stopBtn.classList.add('hidden');
}

/**
 * 重新生成所有整页 (清空已有图片, 从头生成)
 */
async function regenerateAllFullPages() {
    if (isGenerating) {
        showToast('请等待当前生成完成', 'error');
        return;
    }
    if (currentSegments.pages.length === 0) {
        showToast('请先生成分镜', 'error');
        return;
    }
    if (Object.keys(fullPageImages).length > 0) {
        if (!confirm(`将清空已生成的 ${Object.keys(fullPageImages).length} 张整页图片并从头生成, 确定吗?\n\n此操作不可撤销。`)) return;
    }

    // 清空已有整页图
    fullPageImages = {};
    fullPageCleanImages = {};
    fullPageBubbles = {};
    generatedImages = {};
    renderSegments();
    renderGallery();
    syncResults();

    // 调用批量整页生成
    await generateAllFullPages();
}

async function generateAllFullPages() {
    if (isGenerating) {
        showToast('请等待当前生成完成', 'error');
        return;
    }

    const spinner = document.getElementById('batch-full-spinner');
    spinner.classList.remove('hidden');
    isGenerating = true;
    scheduleWorkspaceUI();
    batchStopRequested = false;  // 重置停止标志
    const unlock = lockButton(
        document.getElementById('batch-full-btn'),
        document.getElementById('batch-full-label'),
        '批量整页生成中…'
    );

    const pagesToGenerate = [];
    for (let p = 0; p < currentSegments.pages.length; p++) {
        if (!fullPageImages[p]) {
            pagesToGenerate.push(p);
        }
    }

    // 任务进度条 (后端不推送, fake progress 展示)
    const task = registerTaskProgress('batch-progress');
    task.startFallback(120000);

    // 显示暂停/停止按钮
    const pauseBtn = document.getElementById('batch-pause-btn');
    const stopBtn = document.getElementById('batch-stop-btn');
    if (pauseBtn) {
        batchPaused = false;
        document.getElementById('batch-pause-label').textContent = '暂停';
        pauseBtn.classList.remove('hidden');
    }
    if (stopBtn) stopBtn.classList.remove('hidden');

    // 串行生成，每页参考上一页漫画和人设图
    let lastPageImage = null;
    let i = 0;
    let stoppedByUser = false;
    for (i = 0; i < pagesToGenerate.length; i++) {
        // 暂停 + 停止检查
        const shouldContinue = await _checkBatchPause();
        if (!shouldContinue) {
            stoppedByUser = batchStopRequested;
            break;
        }

        const p = pagesToGenerate[i];
        await generateFullPage(p, true, lastPageImage);
        await new Promise(r => setTimeout(r, 800));
        lastPageImage = fullPageImages[p] || null;
    }

    // 隐藏暂停/停止按钮
    if (pauseBtn) pauseBtn.classList.add('hidden');
    if (stopBtn) stopBtn.classList.add('hidden');
    batchPaused = false;
    batchStopRequested = false;
    task.finish();

    isGenerating = false;
    scheduleWorkspaceUI();
    spinner.classList.add('hidden');
    unlock();

    const allDone = (i >= pagesToGenerate.length) && !stoppedByUser;
    if (stoppedByUser) {
        showToast('批量整页生成已停止', 'info');
    } else if (i < pagesToGenerate.length) {
        showToast('批量整页生成已暂停', 'info');
    } else {
        showToast('批量整页生成完成', 'success');
    }

    // 所有页面生成完毕后自动保存 (含 LLM 生成标题)
    // 即使被用户停止, 只要生成了至少 1 页也自动保存
    if (Object.keys(fullPageImages).length > 0) {
        await autoSaveWorkWithLLMTitle(allDone);
    }

    switchTab('gallery');
}

/**
 * 自动保存作品, 标题用 LLM 分析小说原文生成
 * @param {boolean} allDone - 是否全部生成完毕 (而非被停止)
 */
async function autoSaveWorkWithLLMTitle(allDone) {
    try {
        const novelText = document.getElementById('novel-text')?.value || '';
        const config = JSON.parse(localStorage.getItem('manga_config') || '{}');

        // 1. 调用 LLM 生成标题
        let title = '';
        if (config.llm_api_url && novelText) {
            try {
                const resp = await fetchWithRetry('/api/generate-title', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        text: novelText,
                        api_url: config.llm_api_url,
                        api_key: config.llm_api_key || '',
                        model: config.llm_model || ''
                    })
                });
                const result = await resp.json();
                if (result.success || result.title) {
                    title = result.title;
                }
            } catch (e) {
                console.warn('LLM 生成标题失败, 使用默认标题:', e);
            }
        }
        if (!title) {
            title = `漫画作品 ${new Date().toLocaleString()}`;
        }

        // 2. 确保有 work_id (没有就创建)
        // saveCurrentState 后端会自动创建, 这里直接调用即可
        // 但 rename-current 需要已有 work_id, 所以先 saveCurrentState
        await saveCurrentState();

        // 3. 用 LLM 生成的标题重命名当前作品
        try {
            const renameResp = await fetchWithRetry('/api/work/rename-current', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ title: title })
            });
            const renameResult = await renameResp.json();
            if (renameResult.success) {
                showToast(allDone ? `漫画生成完毕, 已自动保存为「${title}」` : `已停止, 已保存为「${title}」`, 'success');
                // 刷新历史列表
                loadHistoryList();
            } else {
                showToast('已保存作品, 但重命名失败: ' + (renameResult.error || ''), 'info');
            }
        } catch (e) {
            console.error('rename-current failed:', e);
            showToast('已保存作品, 但自动命名失败', 'info');
        }
    } catch (e) {
        console.error('autoSaveWorkWithLLMTitle failed:', e);
    }
}

function renderGallery() {
    const container = document.getElementById('gallery-container');
    // 重新渲染前清掉 stagger 标记, 让下次 playStagger 能再触发级联
    if (window.__t2cTransitions) window.__t2cTransitions.resetStagger(container);

    const hasFullPages = Object.keys(fullPageImages).length > 0;

    if (!hasFullPages) {
        container.innerHTML = emptyState(
            'palette',
            '还没有成品图',
            '在「分镜管理」里对某一页点「整页生成」，或直接「批量整页生成」把所有页一次跑完。',
            { onclick: "switchTab('segments')", label: '去生成整页' }
        );
        return;
    }

    let html = '';

    if (hasFullPages) {
        html += `
        <div class="mb-8">
            <h2 class="text-xl font-bold mb-4 flex items-center gap-2">
                <span class="bg-black text-white px-2 py-1 text-sm flex items-center gap-1"><span data-icon="check" style="width:14px;height:14px;"></span>整页生成</span>
            </h2>
            <div class="space-y-6">
                ${currentSegments.pages.map((page, pageIdx) => {
                    const img = fullPageImages[pageIdx];
                    if (!img) return '';
                    const canEdit = bubbleRenderMode === 'pil'
                        && fullPageCleanImages[pageIdx]
                        && fullPageBubbles[pageIdx]
                        && fullPageBubbles[pageIdx].length > 0;
                    return `
                    <div class="comic-page p-4">
                        <h3 class="text-lg font-bold mb-3 text-center border-b-2 border-black pb-2">第 ${page.page_number} 页</h3>
                        <div class="border-2 border-black">
                            <img src="${img}" class="w-full cursor-pointer" onclick="openModal('${img}')">
                        </div>
                        ${canEdit ? `
                        <div class="mt-3 flex justify-end">
                            <button data-page-idx="${pageIdx}" onclick="openBubbleEditor(${pageIdx})" class="edit-bubble-btn border-2 border-black px-4 py-2 text-sm font-medium hover:bg-gray-100 transition-colors">✏️ 编辑气泡位置</button>
                        </div>
                        ` : ''}
                    </div>
                    `;
                }).join('')}
            </div>
        </div>`;
    }

    container.innerHTML = html;

    // 整页漫画卡片进入视口时级联入场 (图片本身走 CSS imgReveal 显影)
    playStagger(container, '.comic-page');
    markDirty();
    scheduleWorkspaceUI();
}

function openModal(src) {
    const modal = document.getElementById('image-modal');
    const img = document.getElementById('modal-image');
    img.src = src;
    // 大图每次打开都从微缩淡入 (同一 class 不会自动重播, 先移除再强制回流)
    img.classList.remove('zoom-in');
    void img.offsetWidth;
    img.classList.add('zoom-in');
    if (window.__t2cTransitions) {
        window.__t2cTransitions.openModal('image-modal');
    } else {
        modal.classList.remove('modal-closing', 'hidden');
    }
}

function closeModal() {
    animateCloseModal('image-modal');
}

// ===== 对话气泡位置拖拽编辑 =====
let _bubbleEditorReposition = null;

window.addEventListener('resize', function() {
    if (_bubbleEditorReposition && document.getElementById('bubble-editor-modal')) {
        _bubbleEditorReposition();
    }
});

function openBubbleEditor(pageIdx) {
    if (bubbleRenderMode !== 'pil') {
        showToast('当前为"由图像API绘制气泡"模式, 没有气泡坐标可编辑', 'info');
        return;
    }
    const cleanUrl = fullPageCleanImages[pageIdx];
    const stored = fullPageBubbles[pageIdx];
    if (!cleanUrl || !stored || stored.length === 0) {
        showToast('该页面没有可编辑的气泡（可能是旧数据未保留干净图）', 'error');
        return;
    }

    // 深拷贝, 编辑中途取消不影响原数据
    const editBubbles = stored.map(b => ({ ...b }));

    const old = document.getElementById('bubble-editor-modal');
    if (old) old.remove();

    const modal = document.createElement('div');
    modal.id = 'bubble-editor-modal';
    modal.className = 'fixed inset-0 z-50 flex flex-col';
    modal.innerHTML = `
        <div class="modal-backdrop absolute inset-0 bg-black bg-opacity-70"></div>
        <div class="modal-card relative flex flex-col h-full max-w-6xl mx-auto w-full bg-white">
            <div class="flex items-center justify-between p-4 border-b-2 border-black">
                <h2 class="text-lg font-bold">✏️ 拖动气泡调整位置</h2>
                <div class="flex gap-2">
                    <button id="bubble-editor-cancel" class="border-2 border-gray-400 px-4 py-2 text-sm font-medium hover:bg-gray-100 transition-colors">取消</button>
                    <button id="bubble-editor-save" class="btn-primary px-4 py-2 text-sm font-medium">保存</button>
                </div>
            </div>
            <div class="flex-1 overflow-auto bg-gray-200 p-4 flex justify-center">
                <div id="bubble-editor-img-wrap" class="relative inline-block">
                    <img id="bubble-editor-img" src="${cleanUrl}" class="block" style="max-width: 100%; max-height: calc(100dvh - 140px); object-fit: contain;">
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    const imgEl = document.getElementById('bubble-editor-img');
    const wrapEl = document.getElementById('bubble-editor-img-wrap');

    function getScale() {
        return {
            x: imgEl.clientWidth / imgEl.naturalWidth,
            y: imgEl.clientHeight / imgEl.naturalHeight,
        };
    }

    function positionBubbles() {
        wrapEl.querySelectorAll('.bubble-edit-item').forEach(el => el.remove());
        const scale = getScale();
        if (!scale.x || !scale.y) return;
        editBubbles.forEach((bub, i) => {
            const div = document.createElement('div');
            div.className = 'bubble-edit-item absolute cursor-move select-none';
            div.style.left = (bub.x * scale.x) + 'px';
            div.style.top = (bub.y * scale.y) + 'px';
            div.style.width = (bub.w * scale.x) + 'px';
            div.style.height = (bub.h * scale.y) + 'px';
            div.style.display = 'flex';
            div.style.alignItems = 'center';
            div.style.justifyContent = 'center';
            div.style.padding = '4px';
            div.style.textAlign = 'center';
            div.style.fontSize = '12px';
            div.style.overflow = 'hidden';
            div.style.lineHeight = '1.2';
            div.style.fontWeight = '500';
            // 暴露 dialogue_type, CSS 按 [data-type] 上对应气泡样式
            const dtype = (bub.dialogue_type || 'dialogue').toLowerCase();
            div.dataset.type = dtype;
            div.dataset.idx = i;
            // 类型下拉: 用户可在编辑器里直接切换 dialogue_type, 切换后立即生效样式
            const sel = document.createElement('select');
            sel.className = 'bubble-type-select';
            sel.title = '切换气泡类型';
            sel.addEventListener('mousedown', e => e.stopPropagation());
            sel.addEventListener('touchstart', e => e.stopPropagation(), { passive: true });
            for (const t of BUBBLE_TYPES) {
                const opt = document.createElement('option');
                opt.value = t;
                opt.textContent = _bubbleTypeLabel(t);
                if (t === dtype) opt.selected = true;
                sel.appendChild(opt);
            }
            sel.addEventListener('change', function() {
                const newType = this.value;
                bub.dialogue_type = newType;
                div.dataset.type = newType;
            });
            div.appendChild(sel);
            // 文字节点, 避免被 select 遮挡 (select 在右上, 给文字右侧更多内边距)
            const txt = document.createElement('span');
            txt.className = 'bubble-edit-text';
            txt.style.position = 'relative';
            txt.style.zIndex = '1';
            txt.style.padding = '0 38px 0 4px';
            txt.textContent = bub.dialogue;
            div.appendChild(txt);
            wrapEl.appendChild(div);
            makeDraggable(div, imgEl, bub);
        });
    }

    function _bubbleTypeLabel(dtype) {
        return BUBBLE_TYPE_LABELS[dtype] || ('○ ' + dtype);
    }

    function makeDraggable(el, imgEl, bub) {
        function getPoint(e) {
            if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
            return { x: e.clientX, y: e.clientY };
        }

        let startX, startY, origLeft, origTop;

        function onDown(e) {
            const pt = getPoint(e);
            startX = pt.x; startY = pt.y;
            origLeft = parseFloat(el.style.left);
            origTop = parseFloat(el.style.top);
            el.style.zIndex = '10';
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
            document.addEventListener('touchmove', onMove, { passive: false });
            document.addEventListener('touchend', onUp);
            e.preventDefault();
        }

        function onMove(e) {
            const pt = getPoint(e);
            let newLeft = origLeft + (pt.x - startX);
            let newTop = origTop + (pt.y - startY);
            newLeft = Math.max(0, Math.min(newLeft, imgEl.clientWidth - el.offsetWidth));
            newTop = Math.max(0, Math.min(newTop, imgEl.clientHeight - el.offsetHeight));
            el.style.left = newLeft + 'px';
            el.style.top = newTop + 'px';
            e.preventDefault();
        }

        function onUp() {
            const sc = getScale();
            bub.x = Math.round(parseFloat(el.style.left) / sc.x);
            bub.y = Math.round(parseFloat(el.style.top) / sc.y);
            el.style.zIndex = '';
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('touchend', onUp);
        }

        el.addEventListener('mousedown', onDown);
        el.addEventListener('touchstart', onDown, { passive: false });
    }

    function closeModalEditor() {
        _bubbleEditorReposition = null;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            modal.remove();
            return;
        }
        modal.classList.add('modal-closing');
        // 给退场动画留够时间 (180ms) 再移除 DOM
        setTimeout(() => modal.remove(), 180);
    }

    // 图片加载后定位气泡 (处理缓存命中 onload 不触发的情况)
    if (imgEl.complete && imgEl.naturalWidth) {
        _bubbleEditorReposition = positionBubbles;
        positionBubbles();
    } else {
        imgEl.onload = function() {
            _bubbleEditorReposition = positionBubbles;
            positionBubbles();
        };
    }

    document.getElementById('bubble-editor-cancel').onclick = closeModalEditor;

    document.getElementById('bubble-editor-save').onclick = async function() {
        const btn = this;
        btn.disabled = true;
        btn.textContent = '保存中...';
        try {
            await saveBubblePositions(pageIdx, editBubbles);
            closeModalEditor();
        } catch (e) {
            btn.disabled = false;
            btn.textContent = '保存';
            showToast('保存失败: ' + (e.message || e), 'error');
        }
    };
}

async function saveBubblePositions(pageIdx, bubbles) {
    const resp = await fetch('/api/reposition-bubbles', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            clean_image_url: fullPageCleanImages[pageIdx],
            output_image_url: fullPageImages[pageIdx].split('?')[0],
            bubbles: bubbles,
        })
    });
    const result = await resp.json();
    if (!result.success) throw new Error(result.error || '保存失败');
    fullPageBubbles[pageIdx] = bubbles;
    // 刷新显示图 (cache-bust)
    const baseUrl = fullPageImages[pageIdx].split('?')[0];
    fullPageImages[pageIdx] = baseUrl + '?t=' + Date.now();
    renderGallery();
    syncResults();
    showToast('气泡位置已保存', 'success');
}

function exportScript() {
    const data = {
        pages: currentSegments.pages.map((page, pageIdx) => ({
            ...page,
            segments: page.segments.map((seg, segIdx) => ({
                ...seg,
                image_url: generatedImages[`${pageIdx}-${segIdx}`] || null
            }))
        }))
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `manga_script_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('脚本已导出', 'success');
}

async function downloadAll() {
    const allImages = [];
    
    Object.entries(fullPageImages).forEach(([pageIdx, url]) => {
        if (url) {
            allImages.push({ url, filename: `comic_page_full_${parseInt(pageIdx) + 1}.png`, type: '整页' });
        }
    });
    
    Object.entries(generatedImages).forEach(([key, url]) => {
        if (url) {
            const [pageIdx, segIdx] = key.split('-');
            allImages.push({ url, filename: `manga_p${parseInt(pageIdx) + 1}_s${parseInt(segIdx) + 1}.png`, type: '分镜' });
        }
    });
    
    if (allImages.length === 0) {
        showToast('没有可下载的图片', 'error');
        return;
    }
    
    showToast(`开始下载 ${allImages.length} 张图片...`, 'info');
    
    let successCount = 0;
    let failCount = 0;
    
    for (const img of allImages) {
        try {
            const response = await fetch('/api/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ url: img.url, filename: img.filename })
            });
            
            if (response.ok) {
                const blob = await response.blob();
                const blobUrl = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = blobUrl;
                a.download = img.filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(blobUrl);
                successCount++;
                await new Promise(r => setTimeout(r, 300));
            } else {
                failCount++;
            }
        } catch (e) {
            console.error('Download error:', e);
            failCount++;
        }
    }
    
    if (failCount === 0) {
        showToast(`成功下载 ${successCount} 张图片`, 'success');
    } else {
        showToast(`下载完成: ${successCount} 成功, ${failCount} 失败`, 'info');
    }
}

async function analyzeCharacters() {
    const text = document.getElementById('novel-text').value.trim();
    if (!text) {
        showToast('请先输入小说内容', 'error');
        switchTab('input');
        return;
    }

    const config = JSON.parse(localStorage.getItem('manga_config') || '{}');
    if (!config.llm_api_url) {
        showToast('请先配置API', 'error');
        openConfigModal();
        return;
    }

    const spinner = document.getElementById('analyze-spinner');
    spinner.classList.remove('hidden');

    const unlock = lockButton(
        document.getElementById('analyze-characters-btn'),
        document.getElementById('analyze-characters-label'),
        '角色分析中…'
    );

    createProgressBar('analyze-progress');
    startFakeProgress('analyze-progress-bar', 'analyze-progress-text', 120000);

    // 任务进度条 (后端不推送, fake progress 展示)
    const task = registerTaskProgress('analyze-progress');
    task.startFallback(120000);

    try {
        const response = await fetchWithRetry('/api/generate-characters', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                text: text,
                api_url: config.llm_api_url,
                api_key: config.llm_api_key,
                model: config.llm_model,
                task_id: task.task_id
            })
        });

        const result = await response.json();
        task.finish();
        if (result.success) {
            const newChars = result.data.characters || [];
            // 合并而非替换: 用名字去重, 名字相同的优先保留新分析结果
            // 但保留旧的图片 (image_url, char_prompt), 避免人设图丢失
            const merged = [];
            const matchedOldIdx = new Set();
            for (const nc of newChars) {
                const ncName = (nc.name || '').trim();
                const oldIdx = characters.findIndex(oc => (oc.name || '').trim() === ncName);
                if (oldIdx !== -1) {
                    matchedOldIdx.add(oldIdx);
                    // 新数据优先, 但保留旧的 image_url 和 char_prompt
                    const old = characters[oldIdx];
                    merged.push({
                        ...old,    // 保留图片/prompt
                        ...nc,     // 新的描述/名字等
                        image_url: old.image_url || nc.image_url || '',
                        char_prompt: old.char_prompt || nc.char_prompt || '',
                    });
                } else {
                    merged.push({ ...nc, char_prompt: nc.char_prompt || '' });
                }
            }
            // 也保留旧的角色 (防止 LLM 没分析出来的角色消失)
            for (let i = 0; i < characters.length; i++) {
                if (!matchedOldIdx.has(i)) {
                    merged.push(characters[i]);
                }
            }
            characters = merged;
            renderCharacters();
            syncResults();  // 主动同步角色数据到服务器
            const keptCount = merged.length - newChars.length;
            const msg = keptCount > 0
                ? `分析 ${newChars.length} 个角色, 保留旧角色 ${keptCount} 个`
                : `成功分析 ${characters.length} 个角色`;
            showToast(msg, 'success');
        } else {
            showToast(result.error || '分析失败', 'error');
        }
    } catch (e) {
        task.finish();
        showToast('请求失败: ' + e.message, 'error');
    } finally {
        spinner.classList.add('hidden');
        unlock();
    }
}

/**
 * 清空所有角色 (用户切换小说/重新开始时使用)
 * 同时清除分镜中对角色的引用, 避免悬空引用
 */
function clearCharacters() {
    if (characters.length === 0) {
        showToast('角色列表已为空', 'info');
        return;
    }
    if (!confirm(`确认清空所有 ${characters.length} 个角色吗?\n\n此操作会同时清除分镜中对角色的引用, 无法撤销。`)) return;

    characters = [];
    // 清除分镜中对角色的引用 (selected_characters)
    if (currentSegments && currentSegments.pages) {
        currentSegments.pages.forEach(page => {
            (page.segments || []).forEach(seg => {
                seg.selected_characters = [];
            });
        });
    }
    renderCharacters();
    if (typeof renderSegments === 'function') renderSegments();
    syncResults();  // 同步到服务器
    showToast('已清空所有角色', 'success');
}

function renderCharacters() {
    const container = document.getElementById('characters-container');
    // 重新渲染前清掉 stagger 标记, 让 playStagger / staggerIn 能再触发级联
    if (window.__t2cTransitions) window.__t2cTransitions.resetStagger(container);
    if (characters.length === 0) {
        container.innerHTML = emptyState(
            'masks',
            '还没有角色',
            '点下面的按钮，模型会从小说的前 8000 字里挑出主要出场角色，并给出外貌与性格描述。',
            { onclick: 'analyzeCharacters()', label: '从小说分析角色', fullSpan: true }
        );
        return;
    }

    container.innerHTML = characters.map((char, idx) => {
        const safeImageUrl = escapeHtml(char.image_url || '');
        return `
        <div class="bg-white p-4 manga-border panel-shadow">
            <div class="flex justify-between items-start mb-2">
                <h3 class="text-lg font-bold">${escapeHtml(char.name)}</h3>
                <button onclick="togglePromptEditor(${idx})" class="text-xs border border-gray-300 rounded px-2 py-0.5 hover:bg-gray-100 transition-colors" title="编辑人设图生成提示词" id="prompt-toggle-${idx}">✏️ Prompt</button>
            </div>
            <p class="text-sm text-gray-600 mb-3">${escapeHtml(char.description)}</p>
            ${char.image_url ? `
            <div class="mb-3 border-2 border-gray-300 relative group">
                <img src="${safeImageUrl}" class="w-full h-48 object-cover cursor-pointer" onclick="openModal('${safeImageUrl}')">
                <div class="absolute top-1 right-1 hidden group-hover:flex gap-1">
                    <button onclick="event.stopPropagation(); uploadCharacterImage(${idx})" class="bg-white border-2 border-black text-xs px-2 py-1 hover:bg-yellow-200" title="手动上传/更换图片">📁 换图</button>
                </div>
            </div>
            ` : ''}
            <div id="prompt-editor-${idx}" class="hidden mb-3">
                <label class="block text-xs font-medium text-gray-600 mb-1">图像生成提示词 (空=自动生成)</label>
                <textarea id="char-prompt-${idx}" rows="3" class="w-full text-xs border border-gray-300 rounded p-2 font-mono" oninput="saveCharPrompt(${idx}, this.value)" onblur="saveCharPrompt(${idx}, this.value)">${escapeHtml(char.char_prompt || '')}</textarea>
                <div class="text-xs text-gray-500 mt-1">
                    实时同步 · 当前提示词:
                    <code class="text-gray-800" id="char-prompt-preview-${idx}">${escapeHtml(char.char_prompt || '(自动生成)')}</code>
                </div>
            </div>
            <div class="flex gap-2">
                <button onclick="generateCharacterImage(${idx}, this)" class="flex-1 btn-primary py-2 text-sm">
                    ${char.image_url ? '重新生成' : '生成人设图'}
                </button>
                <button onclick="uploadCharacterImage(${idx})" class="flex-1 bg-gray-700 text-white py-2 text-sm hover:bg-gray-800 transition-colors">
                    📁 ${char.image_url ? '更换' : '上传'}
                </button>
            </div>
            <input type="file" id="char-upload-${idx}" accept="image/*" class="hidden" onchange="handleCharacterImageFile(${idx}, this)">
        </div>
    `;}).join('');

    // 角色卡片级联入场
    playStagger(container);
    markDirty();
    scheduleWorkspaceUI();
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function togglePromptEditor(idx) {
    const editor = document.getElementById(`prompt-editor-${idx}`);
    if (editor) editor.classList.toggle('hidden');
}

function saveCharPrompt(idx, value) {
    if (!characters[idx]) return;
    // 始终更新内存, 防止用户改完没失焦直接点按钮
    characters[idx].char_prompt = value;
    // 实时预览回显 (无字符=空, 空=自动生成)
    const preview = document.getElementById(`char-prompt-preview-${idx}`);
    if (preview) preview.textContent = value.trim() || '(自动生成)';
    // 标记需要同步, debounce 到 1s 后再发请求, 避免每键一调
    if (!window._charPromptTimers) window._charPromptTimers = {};
    if (window._charPromptTimers[idx]) clearTimeout(window._charPromptTimers[idx]);
    window._charPromptTimers[idx] = setTimeout(() => {
        syncResults();
    }, 1000);
}

// ===== 角色图片手动上传 =====
function uploadCharacterImage(idx) {
    const input = document.getElementById(`char-upload-${idx}`);
    if (input) input.click();
}

function handleCharacterImageFile(idx, input) {
    const file = input.files && input.files[0];
    if (!file) return;
    // 清空 input, 允许再次选同一张图 (放在前面, 失败路径也能再次选择)
    input.value = '';
    if (!file.type.startsWith('image/')) {
        showToast('请选择图片文件', 'error');
        return;
    }
    // 限制 5MB, 避免 dataURL 太大撑爆 storage
    if (file.size > 5 * 1024 * 1024) {
        showToast('图片超过 5MB, 请压缩后再上传', 'error');
        return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
        const dataUrl = e.target.result;
        // 缩放到最长边 1024px, 保留原格式 (PNG 透明 / EXIF 旋转)
        compressImage(dataUrl, 1024).then((compressed) => {
            applyCharacterImage(idx, compressed, false);
        }).catch((err) => {
            // 缩放失败时直接用原图, 但要再做一次格式判断避免 5MB dataURL 持久化
            applyCharacterImage(idx, dataUrl, true);
        });
    };
    reader.onerror = () => {
        showToast('读取图片失败', 'error');
    };
    reader.readAsDataURL(file);
}

function applyCharacterImage(idx, dataUrl, isUncompressedFallback) {
    // idx 在异步 FileReader / compressImage 期间可能 stale (角色被删/重排), 守一道
    if (!characters[idx]) {
        showToast('角色已不存在，请重新选择', 'error');
        return;
    }
    // 原图 fallback 时, 若 >500KB 也放弃, 防止 state.json 被撑爆
    const approxBytes = Math.round(dataUrl.length * 3 / 4);
    if (isUncompressedFallback && approxBytes > 500 * 1024) {
        showToast(`「${characters[idx].name}」图片格式不支持，已跳过`, 'error');
        return;
    }
    characters[idx].image_url = dataUrl;
    renderCharacters();
    // 关键: 分镜页"出场角色"复选框也依赖 image_url 决定 disabled 状态,
    // 上传/AI 生成后必须刷新, 否则用户看到 checkbox 仍 disabled
    if (typeof renderSegments === 'function') renderSegments();
    syncResults();
    // 关键: 同步保存到当前作品 state.json, 否则刷新/历史加载就丢失
    if (typeof saveCurrentState === 'function') {
        saveCurrentState().catch(e => console.error('save character image failed:', e));
    }
    const tail = isUncompressedFallback ? ' (未压缩)' : '';
    showToast(`「${characters[idx].name}」人设图已更新${tail}`, 'success');
}

function compressImage(dataUrl, maxSide) {
    return new Promise((resolve, reject) => {
        // 检测源格式 — PNG 带 alpha 必须保留, JPEG/HEIC 等可直接压 JPEG
        const srcMatch = (dataUrl.match(/^data:image\/(\w+);/) || [])[1] || '';
        const srcType = srcMatch.toLowerCase();
        // 目标格式: png/webp/gif 透明格式 → png; 其它 → jpeg
        const keepAlpha = (srcType === 'png' || srcType === 'webp' || srcType === 'gif');
        const outMime = keepAlpha ? 'image/png' : 'image/jpeg';
        const quality = keepAlpha ? undefined : 0.85;

        const img = new Image();
        img.onload = () => {
            try {
                // 处理 EXIF 方向: HTMLImageElement 不解析 EXIF, 用 createImageBitmap('from-image')
                let drawW = img.naturalWidth, drawH = img.naturalHeight;
                if (typeof createImageBitmap === 'function') {
                    // fetch blob → bitmap (EXIF 友好); 走 image.src 拿不到 EXIF
                    fetch(dataUrl).then(r => r.blob()).then(blob => {
                        createImageBitmap(blob, { imageOrientation: 'from-image' }).then(bmp => {
                            drawW = bmp.width; drawH = bmp.height;
                            _drawToDataUrl(bmp, drawW, drawH, maxSide, outMime, quality, resolve, reject);
                        }).catch(() => {
                            _drawToDataUrl(img, img.naturalWidth, img.naturalHeight, maxSide, outMime, quality, resolve, reject);
                        });
                    }).catch(() => {
                        _drawToDataUrl(img, img.naturalWidth, img.naturalHeight, maxSide, outMime, quality, resolve, reject);
                    });
                } else {
                    _drawToDataUrl(img, img.naturalWidth, img.naturalHeight, maxSide, outMime, quality, resolve, reject);
                }
            } catch (e) {
                reject(e);
            }
        };
        img.onerror = (e) => reject(new Error('image load failed'));
        img.src = dataUrl;
    });
}

function _drawToDataUrl(src, w0, h0, maxSide, outMime, quality, resolve, reject) {
    try {
        let w = w0, h = h0;
        if (Math.max(w, h) > maxSide) {
            if (w >= h) {
                h = Math.round(h * maxSide / w);
                w = maxSide;
            } else {
                w = Math.round(w * maxSide / h);
                h = maxSide;
            }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        // PNG 透明格式用白色背景填底 (避免 toDataURL('image/png') 在某些浏览器把 alpha 变成黑)
        if (outMime === 'image/jpeg') {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, w, h);
        }
        ctx.drawImage(src, 0, 0, w, h);
        resolve(canvas.toDataURL(outMime, quality));
    } catch (e) {
        reject(e);
    }
}

async function generateCharacterImage(idx, btn = null) {
    const char = characters[idx];
    // 强制从 DOM 同步最新 prompt 到内存 (用户可能还在输入没失焦)
    const promptEl = document.getElementById(`char-prompt-${idx}`);
    if (promptEl && characters[idx]) {
        characters[idx].char_prompt = promptEl.value;
    }
    const config = JSON.parse(localStorage.getItem('manga_config') || '{}');
    if (!config.img_api_url) {
        showToast('请先配置图像生成API', 'error');
        openConfigModal();
        return;
    }

    // 防重入: 同一个按钮在请求进行中点击, 直接放弃
    if (btn && btn.dataset.busy === '1') return;
    if (btn) {
        btn.dataset.busy = '1';
        btn.disabled = true;
        btn.classList.add('opacity-60', 'cursor-not-allowed');
    }

    // 显示"基线图生成中"提示
    const toastId = showLoadingToast(`正在为「${char.name}」生成基线人设图…`);

    try {
        const response = await fetchWithRetry('/api/generate-character-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                name: char.name,
                description: char.description,
                prompt: char.char_prompt || '',  // 用户自定义 prompt, 空 = 自动生成
                api_url: config.img_api_url,
                api_key: config.img_api_key,
                model: config.img_model,
                comic_mode: comicMode,
                max_attempts: 3
            })
        });

        const result = await response.json();
        if (result.success) {
            characters[idx].image_url = result.image_url;
            renderCharacters();
            // 关键: 分镜页复选框也需刷新, 否则上传后仍是 disabled
            if (typeof renderSegments === 'function') renderSegments();
            syncResults();
            // 关键: 同步保存到当前作品 state.json, 否则刷新/历史加载就丢失
            if (typeof saveCurrentState === 'function') {
                saveCurrentState().catch(e => console.error('save AI char image failed:', e));
            }
            const attemptInfo = result.attempts > 1
                ? ` (尝试 ${result.attempts}/${result.max_attempts || 3} 次拿到合格基线图)`
                : '';
            dismissLoadingToast(toastId);
            showToast(`${char.name} 人设图生成成功${attemptInfo}`, 'success');
        } else {
            dismissLoadingToast(toastId);
            showToast(result.error || '生成失败', 'error');
        }
    } catch (e) {
        dismissLoadingToast(toastId);
        showToast('请求失败: ' + e.message, 'error');
    } finally {
        if (btn) {
            btn.dataset.busy = '';
            btn.disabled = false;
            btn.classList.remove('opacity-60', 'cursor-not-allowed');
            // 重新渲染以恢复原 label (生成人设图 / 重新生成人设图)
            renderCharacters();
        }
    }
}

// ===== 浏览器/设备识别（仅用于移动端适配，在 <html>/<body> 上打标记，不改动业务数据） =====
function detectBrowserDevice() {
    const ua = navigator.userAgent || '';
    const uaData = navigator.userAgentData;
    const hasTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;
    const isAndroid = /Android/i.test(ua);
    const isIPhone = /iPhone|iPod/i.test(ua);
    const isIPad = /iPad/i.test(ua) || (/Macintosh/i.test(ua) && hasTouch && navigator.platform === 'MacIntel');
    const isMobileUA = /Mobi/i.test(ua) || isIPhone || isAndroid || /Windows Phone|IEMobile/i.test(ua) || (uaData && uaData.mobile === true);

    let device;
    if (isIPad) device = 'tablet';
    else if (isMobileUA) device = 'mobile';
    else if (hasTouch && window.innerWidth < 1024) device = 'tablet';
    else device = 'desktop';

    let browser = 'other';
    if (/MicroMessenger/i.test(ua)) browser = 'wechat';
    else if (/QQ/i.test(ua) || /MQQBrowser/i.test(ua)) browser = 'qq';
    else if (/DingTalk|Dingding/i.test(ua)) browser = 'dingtalk';
    else if (/Edg/i.test(ua)) browser = 'edge';
    else if (/Firefox/i.test(ua)) browser = 'firefox';
    else if (/UCBrowser/i.test(ua)) browser = 'uc';
    else if (/Chrome/i.test(ua)) browser = 'chrome';
    else if (/Safari/i.test(ua)) browser = 'safari';

    const info = { device, browser, isMobile: device === 'mobile', isTouch: hasTouch, isWechat: browser === 'wechat', ua };
    window.APP_DEVICE = info;

    const root = document.documentElement;
    root.dataset.device = device;
    root.dataset.browser = browser;
    const body = document.body;
    body.classList.remove('device-mobile', 'device-tablet', 'device-desktop', 'touch-device', 'browser-wechat');
    body.classList.add('device-' + device, 'touch-device');
    if (browser === 'wechat') body.classList.add('browser-wechat');

    maybeShowInAppBanner(info);   // 微信/QQ 内打开时提示用浏览器打开
    return info;
}

// 微信/QQ 内置浏览器打开时，提示用户改用外部浏览器（可关闭，按浏览器记忆忽略）
function maybeShowInAppBanner(info) {
    const banner = document.getElementById('inapp-browser-banner');
    if (!banner) return;
    const isInApp = (info.browser === 'wechat' || info.browser === 'qq') && info.device !== 'desktop';
    let dismissed = null;
    try { dismissed = localStorage.getItem('inapp_banner_dismissed'); } catch (e) { /* 无痕/禁用存储时忽略 */ }
    if (!isInApp || dismissed === info.browser) {
        banner.classList.add('hidden');
        return;
    }
    const textEl = document.getElementById('inapp-browser-text');
    if (textEl) {
        textEl.textContent = info.browser === 'wechat'
            ? '微信内打开功能受限，建议点击右上角「···」，选择「在浏览器打开」'
            : 'QQ 内打开功能受限，建议点击右上角「···」，选择「在浏览器打开」';
    }
    banner.classList.remove('hidden');
}

// 旋转 / 窗口尺寸变化时重新识别设备（防抖）
let _deviceResizeTimer = null;
window.addEventListener('resize', function () {
    clearTimeout(_deviceResizeTimer);
    _deviceResizeTimer = setTimeout(detectBrowserDevice, 200);
    adjustBottomNav();
});

// 移动端底部导航：避免与浏览器底部工具栏 / 虚拟键盘重叠（iOS Safari / WKWebView 常见问题）。
// 通过 visualViewport 高度差算出被浏览器底栏/键盘占用的高度，把导航栏抬上去。
function adjustBottomNav() {
    const nav = document.getElementById('mobile-bottom-nav');
    if (!nav) return;
    // 桌面端 (md 及以上) 底栏本来就隐藏，无需处理
    if (window.matchMedia && window.matchMedia('(min-width: 768px)').matches) return;
    const vv = window.visualViewport;
    let offset = 0;
    if (vv && window.innerHeight > vv.height) {
        offset = Math.round(window.innerHeight - vv.height);
    }
    nav.style.bottom = offset + 'px';
}
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', adjustBottomNav);
    window.visualViewport.addEventListener('scroll', adjustBottomNav);
}

window.addEventListener('DOMContentLoaded', () => {
    detectBrowserDevice();
    adjustBottomNav();

    // 微信/QQ 提示横幅关闭按钮：记住忽略，避免每次进入都弹出
    const bannerClose = document.getElementById('inapp-browser-close');
    if (bannerClose) {
        bannerClose.addEventListener('click', function () {
            const info = window.APP_DEVICE || {};
            if (info.browser) {
                try { localStorage.setItem('inapp_banner_dismissed', info.browser); } catch (e) {}
            }
            const banner = document.getElementById('inapp-browser-banner');
            if (banner) banner.classList.add('hidden');
        });
    }

    renderStylePresets();
    renderCustomStyleTags();
    applyComicModeToDom();
    // 日漫默认 日式ACG 画风 (无本地配置时)
    if (!localStorage.getItem('manga_config')) {
        selectedPresetIds = new Set(['acg']);
    }
    renderStylePresets();
    updateStyleSummary();
    // 配置从服务端回来后, 接口状态与模式 chip 再算一次
    Promise.resolve(loadConfig()).then(scheduleWorkspaceUI, scheduleWorkspaceUI);
    updateCharCount();
    mirrorNovelText();
    recoverSession();  // 尝试恢复之前可能因内网穿透断开丢失的会话数据

    // ===== 工作台外壳: 状态条 / 流程条 / 滑动指示器 / 快捷键 =====
    updateWorkspaceUI();
    renderWorkMeta();
    refreshInks();
    bootIntro();

    // 指示器要在字体加载完、以及每次改变窗口尺寸后重新量一次
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(refreshInks).catch(() => {});
    }
    let _inkResizeTimer = null;
    window.addEventListener('resize', () => {
        clearTimeout(_inkResizeTimer);
        _inkResizeTimer = setTimeout(refreshInks, 120);
    });

    // 状态条: 滚过首屏后滑出 (IntersectionObserver, 不用 scroll 监听)
    const sentinel = document.getElementById('workflow');
    const bar = document.getElementById('workspace-bar');
    if (sentinel && bar && typeof IntersectionObserver !== 'undefined') {
        const io = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                const show = !entry.isIntersecting && entry.boundingClientRect.top < 0;
                bar.classList.toggle('is-visible', show);
            });
        }, { threshold: 0 });
        io.observe(sentinel);
    }

    // 主按钮墨点涟漪
    document.addEventListener('click', (e) => {
        const btn = e.target.closest ? e.target.closest('.btn-primary') : null;
        if (!btn || motionReduced()) return;
        const rect = btn.getBoundingClientRect();
        const ripple = document.createElement('span');
        ripple.className = 'ink-ripple';
        ripple.style.left = (e.clientX - rect.left) + 'px';
        ripple.style.top = (e.clientY - rect.top) + 'px';
        btn.appendChild(ripple);
        setTimeout(() => ripple.remove(), 700);
    });

    // 快捷键: Ctrl/⌘ + Enter 执行当前步骤, Ctrl/⌘ + S 保存当前进度
    document.addEventListener('keydown', (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        if (e.key === 'Enter') {
            e.preventDefault();
            runPrimaryAction();
        } else if (e.key === 's' || e.key === 'S') {
            e.preventDefault();
            quickSave();
        }
    });
});
