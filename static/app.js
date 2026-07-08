let currentSegments = { pages: [] };
let generatedImages = {};
let isGenerating = false;
let characters = [];
let batchPaused = false;  // 批量生成暂停控制
let batchStopRequested = false;  // 批量生成停止控制 (用户主动停止)
let combinedPages = [];
let fullPageImages = {};  // 整页生成的图片
let combinedPageImages = {};  // 任务3: 拼版预览生成的图片 (key: pageIdx)
let fullPageCleanImages = {};  // 整页生成图的无气泡干净副本 (key: pageIdx → clean_url)
let fullPageBubbles = {};  // 整页生成图的气泡坐标 (key: pageIdx → [{x,y,w,h,dialogue,dialogue_type}])
let progressInterval = null;

// WebSocket 实时进度
let socket = null;
let socketConnected = false;
let activeTaskIds = new Set();  // 当前正在跟踪的 task_id 集合
let taskProgressCallbacks = {};  // task_id -> { onProgress, onComplete, onError }

// 漫画转小说相关状态
let comicUploadedImages = [];  // {name, data: base64, pageIndex}
let comicNovelResult = null;   // {novel_text, pages}

const tabs = ['input', 'segments', 'characters', 'gallery', 'history', 'comic2novel'];
const CONCURRENT_LIMIT = 3;
const MAX_RETRIES = 3;

// 漫画风格预设Tag (按地区/类型分类)
const STYLE_PRESETS = [
    // ===== 日漫 =====
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

// ========== WebSocket 实时进度 ==========

/**
 * 初始化 WebSocket 连接, 接收后端推送的 task_progress 事件
 * 连接失败时静默降级到 fake progress (startFakeProgress 仍然可用)
 */
function initWebSocket() {
    try {
        // 使用 socket.io 客户端 (从 CDN 加载, 见 index.html)
        if (typeof io === 'undefined') {
            console.warn('[WebSocket] socket.io client not loaded, fallback to fake progress');
            return;
        }
        socket = io({
            transports: ['websocket', 'polling'],
            withCredentials: true
        });

        socket.on('connect', () => {
            socketConnected = true;
            console.log('[WebSocket] connected, sid=', socket.id);
        });

        socket.on('disconnect', () => {
            socketConnected = false;
            console.log('[WebSocket] disconnected');
        });

        socket.on('connect_error', (err) => {
            socketConnected = false;
            console.warn('[WebSocket] connect error:', err.message);
        });

        socket.on('task_progress', (data) => {
            handleTaskProgress(data);
        });
    } catch (e) {
        console.warn('[WebSocket] init failed:', e.message);
    }
}

/**
 * 处理后端推送的进度事件, 按 task_id 分发到对应回调
 */
function handleTaskProgress(data) {
    const { task_id, progress, message, stage, extra } = data;
    if (!task_id) return;

    const cb = taskProgressCallbacks[task_id];
    if (!cb) return;

    // 更新进度条 UI
    if (cb.progressBarId && cb.textId) {
        const bar = document.getElementById(cb.progressBarId);
        const text = document.getElementById(cb.textId);
        if (bar) bar.style.width = `${progress}%`;
        if (text) text.textContent = `${progress}% - ${message}`;
    }

    // 触发 onProgress 回调
    if (cb.onProgress) {
        try { cb.onProgress(progress, message, stage, extra); } catch (e) { console.warn(e); }
    }

    // 完成或出错时清理
    if (stage === 'done' || stage === 'error' || progress >= 100) {
        if (stage === 'error' && cb.onError) {
            try { cb.onError(message); } catch (e) { console.warn(e); }
        } else if (stage === 'done' && cb.onComplete) {
            try { cb.onComplete(extra || {}); } catch (e) { console.warn(e); }
        }
        // 停止 fake progress (如果有)
        clearInterval(progressInterval);
        // 清理回调
        delete taskProgressCallbacks[task_id];
        activeTaskIds.delete(task_id);
    }
}

/**
 * 为某个任务注册进度回调, 并生成唯一 task_id
 * 返回 { task_id, startFake: () => void } 用于在 WebSocket 不可用时降级
 */
function registerTaskProgress(containerId, callbacks = {}) {
    const task_id = 'task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const progressBarId = `${containerId}-bar`;
    const textId = `${containerId}-text`;

    createProgressBar(containerId);

    taskProgressCallbacks[task_id] = {
        progressBarId,
        textId,
        onProgress: callbacks.onProgress,
        onComplete: callbacks.onComplete,
        onError: callbacks.onError
    };
    activeTaskIds.add(task_id);

    return {
        task_id,
        // 降级方案: WebSocket 不可用时启动 fake progress
        startFallback: (minTime = 120000) => {
            if (!socketConnected) {
                startFakeProgress(progressBarId, textId, minTime);
            }
        },
        // 强制完成 (HTTP 请求返回时调用, 兜底)
        finish: () => {
            clearInterval(progressInterval);
            delete taskProgressCallbacks[task_id];
            activeTaskIds.delete(task_id);
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

        // 恢复拼版映射
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

    // WebSocket 实时进度 (不可用时降级到 fake progress)
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
        window.location.href = '/';
    } catch (e) {
        window.location.href = '/';
    }
}

async function checkAuth() {
    try {
        const response = await fetch('/api/check-auth', { credentials: 'include' });
        const result = await response.json();
        if (!result.logged_in) {
            window.location.href = '/';
        }
    } catch (e) {
        window.location.href = '/';
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
        if (bar) bar.style.width = `${progress}%`;
        if (text) text.textContent = `${Math.floor(progress)}%`;
    }, 200);
}

function finishProgress(progressBarId, textId) {
    clearInterval(progressInterval);
    const bar = document.getElementById(progressBarId);
    const text = document.getElementById(textId);
    if (bar) bar.style.width = '100%';
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
            resultDiv.innerHTML = `<div class="p-3 bg-green-50 border border-green-200 text-green-700 rounded">✅ ${result.message}</div>`;
            showToast('LLM API测试成功！', 'success');
        } else {
            resultDiv.innerHTML = `<div class="p-3 bg-red-50 border border-red-200 text-red-700 rounded">❌ ${result.error}</div>`;
            showToast('LLM API测试失败', 'error');
        }
    } catch (e) {
        finishProgress('test-llm-progress-bar', 'test-llm-progress-text');
        resultDiv.innerHTML = `<div class="p-3 bg-red-50 border border-red-200 text-red-700 rounded">❌ 请求失败：${e.message}</div>`;
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
            resultDiv.innerHTML = `<div class="p-3 bg-green-50 border border-green-200 text-green-700 rounded">✅ ${result.message}</div>`;
            showToast('Image API测试成功！', 'success');
        } else {
            resultDiv.innerHTML = `<div class="p-3 bg-red-50 border border-red-200 text-red-700 rounded">❌ ${result.error}</div>`;
            showToast('Image API测试失败', 'error');
        }
    } catch (e) {
        finishProgress('test-image-progress-bar', 'test-image-progress-text');
        resultDiv.innerHTML = `<div class="p-3 bg-red-50 border border-red-200 text-red-700 rounded">❌ 请求失败：${e.message}</div>`;
        showToast('Image API测试失败', 'error');
    } finally {
        btn.disabled = false;
        spinner.classList.add('hidden');
    }
}

function switchTab(tabName) {
    tabs.forEach(t => {
        document.getElementById(`tab-${t}`).className = t === tabName ? 'tab-active pb-2 px-1 text-lg transition-all' : 'tab-inactive pb-2 px-1 text-lg transition-all';
        document.getElementById(`panel-${t}`).classList.add('hidden');
    });
    document.getElementById(`panel-${tabName}`).classList.remove('hidden');
    if (tabName === 'history') loadHistoryList();
}

function openConfigModal() {
    document.getElementById('config-modal').classList.remove('hidden');
}

function closeConfigModal() {
    document.getElementById('config-modal').classList.add('hidden');
}

// ESC 键关闭弹窗
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeConfigModal();
    }
});

// ===== 历史记录管理 =====
async function loadHistoryList() {
    const container = document.getElementById('history-list');
    const countEl = document.getElementById('history-count');
    const usernameEl = document.getElementById('history-username');
    if (!container) return;

    container.innerHTML = '<div class="col-span-full text-center text-gray-400 py-12">加载中...</div>';

    try {
        const response = await fetchWithRetry('/api/history', { credentials: 'include' });
        const result = await response.json();
        if (!result.success) throw new Error(result.error || '加载失败');

        usernameEl.textContent = result.username || '-';
        countEl.textContent = (result.works || []).length;

        if (!result.works || result.works.length === 0) {
            container.innerHTML = '<div class="col-span-full text-center text-gray-400 py-12">还没有历史作品，<br>生成漫画后点击「保存当前」即可永久保存</div>';
            return;
        }

        // 拉取每个作品的详情（含图片列表和首张预览图）
        container.innerHTML = '';
        for (const work of result.works) {
            const card = document.createElement('div');
            card.className = 'manga-border bg-gray-50 p-4 flex flex-col';
            card.innerHTML = `<div class="aspect-video bg-gray-200 mb-3 flex items-center justify-center text-gray-400 text-sm">加载中...</div>`;
            container.appendChild(card);

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
                        <p class="text-xs text-gray-500 mb-1">🕐 创建: ${created}</p>
                        <p class="text-xs text-gray-500 mb-3">📝 更新: ${updated}</p>
                        <p class="text-xs text-gray-500 mb-3">🖼 ${imgCount} 张图片</p>
                        <div class="flex gap-2 mt-auto">
                            <button onclick="loadHistoryWork('${work.work_id}')" class="flex-1 border-2 border-black bg-black text-white px-2 py-1.5 text-xs font-medium hover:bg-gray-800 transition-colors">📂 加载</button>
                            <button onclick="renameHistoryWork('${work.work_id}','${escapeHtml(title)}')" class="border-2 border-gray-300 hover:border-black px-2 py-1.5 text-xs transition-colors">✏</button>
                            <button onclick="deleteHistoryWork('${work.work_id}')" class="border-2 border-gray-300 hover:border-red-500 hover:text-red-500 px-2 py-1.5 text-xs transition-colors">🗑</button>
                        </div>
                    `;
                } else {
                    card.innerHTML = '<div class="text-red-500 text-sm p-4">加载失败</div>';
                }
            } catch (e) {
                card.innerHTML = `<div class="text-red-500 text-sm p-4">${escapeHtml(String(e.message || e))}</div>`;
            }
        }
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
    } catch (e) {
        console.error('saveCurrentState:', e);
        throw e;
    }
}

async function saveCurrentToHistory() {
    const title = prompt('为这部作品起个名字:', `作品 ${new Date().toLocaleString()}`);
    if (title === null) return;
    try {
        await startNewWork(title.trim() || undefined);
        await saveCurrentState();
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

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.style.background = type === 'error' ? '#dc2626' : type === 'success' ? '#16a34a' : '#1a1a1a';
    toast.style.transform = 'translateY(0)';
    toast.style.opacity = '1';
    // 清除之前可能存在的计时器
    if (toast._hideTimer) {
        clearTimeout(toast._hideTimer);
        toast._hideTimer = null;
    }
    // 若为持久 toast, 不自动隐藏
    if (toast.dataset.persistent === '1') return;
    toast._hideTimer = setTimeout(() => {
        toast.style.transform = 'translateY(20px)';
        toast.style.opacity = '0';
        toast._hideTimer = null;
    }, 3000);
}

// 长时间显示的"加载中"提示, 返回 id 用于 dismiss
function showLoadingToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.style.background = '#1a1a1a';
    toast.style.transform = 'translateY(0)';
    toast.style.opacity = '1';
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
    toast.style.transform = 'translateY(20px)';
    toast.style.opacity = '0';
}

function updateCharCount() {
    const text = document.getElementById('novel-text').value;
    document.getElementById('char-count').textContent = text.length;
}

document.getElementById('novel-text').addEventListener('input', updateCharCount);

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
            '日漫': '🇯🇵', '美漫': '🇺🇸', '韩漫': '🇰🇷', '国漫': '🇨🇳', '其他': '🎨'
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
        summaryEl.textContent = '(未选择风格, 将使用默认黑白漫画风格)';
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
        custom_style_tags: customStyleTags.slice()
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
    selectedPresetIds = new Set(config.style_preset_ids || []);
    customStyleTags = (config.custom_style_tags || []).slice();
    renderStylePresets();
    renderCustomStyleTags();
    updateStyleSummary();
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

    // 任务: 人设图缺失拦截
    // - 角色列表为空 → 不阻塞, 让 LLM 在 /api/segment 里自动提取 (兼容老流程)
    // - 角色列表有但还有人没设人设图 → 弹模态框, 让用户选 "去补" / "继续不用"
    const missingImages = (characters || []).filter(c => !(c.image_url || '').trim());
    if (missingImages.length > 0) {
        const goAhead = await showMissingPersonaModal(missingImages);
        if (!goAhead) return;  // 用户跳去补图, 啥都不做
        // 用户选"仍然继续", 进入正常流程
    }

    const spinner = document.getElementById('segment-spinner');
    spinner.classList.remove('hidden');

    const unlock = lockButton(
        document.getElementById('start-segment-btn'),
        document.getElementById('start-segment-label'),
        '⏳ 分镜生成中…'
    );

    // WebSocket 实时进度 (不可用时降级到 fake progress)
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
    if (!currentSegments.pages || currentSegments.pages.length === 0) {
        container.innerHTML = `
            <div class="text-center py-20 text-gray-400">
                <div class="text-6xl mb-4">📝</div>
                <p>请先输入小说内容并点击"开始智能分镜"</p>
            </div>`;
        return;
    }

    container.innerHTML = currentSegments.pages.map((page, pageIdx) => {
        const hasFullPageImage = fullPageImages[pageIdx];
        const hasCombinedPage = combinedPageImages;
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
                    <button onclick="generatePageImages(${pageIdx})" class="text-sm bg-gray-700 text-white px-3 py-1 hover:bg-gray-800 transition-colors">
                        逐个生成（不推荐）
                    </button>
                    <button onclick="generateFullPage(${pageIdx}, false, null, this)" class="text-sm bg-black text-white px-3 py-1 hover:bg-gray-800 transition-colors flex items-center gap-1">
                        <span>整页生成</span>
                        <span id="full-page-spinner-${pageIdx}" class="loading-spinner hidden" style="width:12px;height:12px;border-width:1px;"></span>
                    </button>
                    <button onclick="combinePage(${pageIdx}, this)" class="text-sm bg-yellow-400 text-black border-2 border-black px-3 py-1 hover:bg-yellow-300 transition-colors flex items-center gap-1" title="任务3: 用本页已生成的 segment 图 + dialogue 自动拼版 (自适应网格 + 4 种气泡)">
                        <span>拼版预览</span>
                        <span id="combine-spinner-${pageIdx}" class="loading-spinner hidden" style="width:12px;height:12px;border-width:1px;"></span>
                    </button>
                </div>
            </div>
            ${hasFullPageImage ? `
            <div class="mb-6 border-2 border-black p-1">
                <div class="text-sm text-gray-600 mb-2">✅ 整页漫画</div>
                <img src="${hasFullPageImage}" class="w-full cursor-pointer" onclick="openModal('${hasFullPageImage}')">
            </div>
            ` : ''}
            ${hasCombinedPage[pageIdx] ? `
            <div class="mb-6 border-2 border-yellow-500 p-1 bg-yellow-50">
                <div class="text-sm text-gray-700 mb-2 flex justify-between items-center">
                    <span>📒 拼版预览 (任务3 - 自适应网格 + 4 种气泡)</span>
                    <button onclick="combinePage(${pageIdx}, this)" class="text-xs text-blue-700 hover:underline">重新拼版</button>
                </div>
                <img src="${hasCombinedPage[pageIdx]}" class="w-full cursor-pointer border-2 border-black" onclick="openModal('${hasCombinedPage[pageIdx]}')">
            </div>
            ` : ''}
            <div class="text-xs text-gray-500 mb-3">
                本页出场角色: ${allSelectedChars.length > 0 ? allSelectedChars.map(cIdx => characters[cIdx]?.name || cIdx).join(', ') : '（未选择角色）'}
            </div>
            <div class="grid md:grid-cols-2 gap-4">
                ${page.segments.map((seg, segIdx) => {
                    const key = `${pageIdx}-${segIdx}`;
                    const hasImage = generatedImages[key];
                    const selectedChars = seg.selected_characters || [];
                    // 计算该分镜实际可用的参考图数量
                    const refCount = selectedChars.filter(cIdx => characters[cIdx] && characters[cIdx].image_url).length;
                    const refBadge = refCount > 0
                        ? `<span class="ml-1 inline-flex items-center justify-center text-[10px] font-bold bg-yellow-300 text-black px-1.5 py-0.5 rounded leading-none" title="该分镜将使用 ${refCount} 张角色参考图">${refCount}参考</span>`
                        : '';
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
                                ` : characters.map((char, charIdx) => `
                                    <label class="flex items-center gap-1 text-xs bg-gray-100 px-2 py-1 rounded cursor-pointer hover:bg-gray-200 ${!char.image_url ? 'opacity-50' : ''}" title="${char.image_url ? '该角色已生成人设图，将作为参考' : '该角色尚未生成人设图，无法作为参考'}">
                                        <input type="checkbox"
                                            ${selectedChars.includes(charIdx) ? 'checked' : ''}
                                            ${!char.image_url ? 'disabled' : ''}
                                            onchange="toggleCharacter(${pageIdx}, ${segIdx}, ${charIdx})"
                                            class="mr-1">
                                        ${char.name}${!char.image_url ? ' (无图)' : ''}
                                    </label>
                                `).join('')}
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
                            <select onchange="updateSegment(${pageIdx}, ${segIdx}, 'dialogue_type', this.value)"
                                class="mt-1 text-xs border border-gray-300 focus:border-black outline-none p-1 bg-white"
                                title="气泡形状(LLM 分镜规划时会主动选, 可手动覆盖)">
                                <option value="dialogue" ${(!seg.dialogue_type || seg.dialogue_type==='dialogue')?'selected':''}>💬 对话气泡 (圆角矩形)</option>
                                <option value="thought" ${seg.dialogue_type==='thought'?'selected':''}>💭 心理活动 (云形)</option>
                                <option value="shout" ${seg.dialogue_type==='shout'?'selected':''}>💥 大喊 (锯齿/爆炸)</option>
                                <option value="whisper" ${seg.dialogue_type==='whisper'?'selected':''}>🤫 耳语 (虚线圆角)</option>
                                <option value="burst" ${seg.dialogue_type==='burst'?'selected':''}>⚡ 爆发 (辐射射线)</option>
                                <option value="narration" ${seg.dialogue_type==='narration'?'selected':''}>📜 旁白叙述 (矩形)</option>
                                <option value="box" ${seg.dialogue_type==='box'?'selected':''}>▢ 方框 (无尾矩形)</option>
                                <option value="caption" ${seg.dialogue_type==='caption'?'selected':''}>🔊 拟声词 (黑底白字)</option>
                            </select>
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
                        <div class="flex gap-2">
                            <button onclick="generateSingleImage(${pageIdx}, ${segIdx}, false, this)"
                                class="flex-1 bg-gray-800 text-white text-sm py-2 hover:bg-black transition-colors flex items-center justify-center gap-1">
                                <span>生成图片</span>
                                ${refBadge}
                            </button>
                            ${hasImage ? `<button onclick="viewImage('${key}')" class="px-3 py-2 border-2 border-black text-sm hover:bg-gray-100">查看</button>` : ''}
                        </div>
                        ${hasImage ? `
                        <div class="mt-3 border-2 border-gray-300 p-1">
                            <img src="${generatedImages[key]}" class="w-full h-40 object-cover cursor-pointer" onclick="openModal('${generatedImages[key]}')">
                        </div>
                        ` : ''}
                    </div>
                    `;
                }).join('')}
            </div>
        </div>
    `}).join('');
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

async function generateSingleImage(pageIdx, segIdx, skipLock = false, btn = null) {
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

    const seg = currentSegments.pages[pageIdx].segments[segIdx];
    const prompt = seg.style_prompt ? `${seg.style_prompt}, ${seg.scene_description}` : seg.scene_description;

    const selectedChars = seg.selected_characters || [];
    const characterReferences = selectedChars.map(charIdx => ({
        name: characters[charIdx].name,
        description: characters[charIdx].description,
        image_url: characters[charIdx].image_url || null
    })).filter(c => c.image_url);

    if (!skipLock) isGenerating = true;
    // 优先用传进来的 btn (动态生成的 segment 按钮), 否则兜底用 querySelector
    const targetBtn = btn || document.querySelector(`#segment-${pageIdx}-${segIdx} button`);
    const labelEl = targetBtn ? targetBtn.querySelector('span') : null;
    const unlock = lockButton(targetBtn, labelEl, '⏳ 生成中…');
    if (targetBtn) {
        targetBtn.innerHTML = '<span class="loading-spinner" style="width:16px;height:16px;border-width:2px;"></span>';
        targetBtn.disabled = true;
    }

    // WebSocket 实时进度 (单张图生成, 仅在非批量模式下显示进度条)
    let task = null;
    if (!skipLock) {
        task = registerTaskProgress(`single-progress-${pageIdx}-${segIdx}`);
        task.startFallback(60000);
    }

    try {
        const response = await fetchWithRetry('/api/generate-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                prompt: prompt,
                style_prompt: seg.style_prompt || '',
                dialogue: seg.dialogue || '',  // 传对话原文给后端, 用于 PIL 叠加气泡
                dialogue_type: seg.dialogue_type || 'dialogue',  // 气泡类型 (dialogue/thought/shout/narration)
                api_url: config.img_api_url,
                api_key: config.img_api_key,
                model: config.img_model,
                negative_prompt: config.negative_prompt,
                style_tags: getStyleTagsString(),
                character_references: characterReferences,
                references: characterReferences,  // 兼容新字段名
                reference_strength: (config.reference_strength ?? 0.6),
                // 任务2: 镜头语言结构化字段
                camera_angle: seg.camera_angle || '',
                composition: seg.composition || '',
                mood: seg.mood || '',
                shot_scale: seg.shot_scale || '',
                lighting: seg.lighting || '',
                of_type: seg.of_type || '',
                page_idx: pageIdx,
                seg_idx: segIdx,
                task_id: task ? task.task_id : ''
            })
        });

        const result = await response.json();
        if (task) task.finish();
        if (result.success) {
            let finalImageUrl = result.image_url;
            generatedImages[`${pageIdx}-${segIdx}`] = finalImageUrl;
            renderSegments();
            renderGallery();
            syncResults();  // 主动同步图片映射到服务器
            showToast('图片生成成功', 'success');
        } else {
            showToast(result.error || '生成失败', 'error');
        }
    } catch (e) {
        if (task) task.finish();
        showToast('请求失败: ' + e.message, 'error');
    } finally {
        if (!skipLock) isGenerating = false;
        // unlock 会自动恢复 labelEl 原文字 + 解除 disabled
        if (targetBtn) {
            // 重新渲染以恢复原 button 内部结构 (含 refBadge)
            unlock();
            renderSegments();
        }
    }
}

async function generatePageImages(pageIdx) {
    const segs = currentSegments.pages[pageIdx].segments;
    for (let i = 0; i < segs.length; i++) {
        await generateSingleImage(pageIdx, i);
        await new Promise(r => setTimeout(r, 500));
    }
    showToast(`第 ${pageIdx + 1} 页生成完成`, 'success');
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
    const spinner = document.getElementById(`full-page-spinner-${pageIdx}`);
    if (spinner) spinner.classList.remove('hidden');
    // 动态按钮, 用 lockButton 锁住避免连点
    const targetBtn = btn || document.querySelector(`#panel-segments button[onclick*="generateFullPage(${pageIdx}"]`);
    const labelEl = targetBtn ? targetBtn.querySelector('span:not([id*="spinner"])') : null;
    const unlock = lockButton(targetBtn, labelEl, '⏳ 整页生成中…');

    const page = currentSegments.pages[pageIdx];

    // 自动取上一页整页图作为参考 (若调用方未显式传入)
    // 这样单页生成时也能保持人物和画风一致
    if (!previousPageImage && pageIdx > 0) {
        previousPageImage = fullPageImages[pageIdx - 1] || null;
        if (previousPageImage) {
            console.log(`[generateFullPage] Auto-using previous page ${pageIdx} image as reference: ${previousPageImage}`);
        }
    }

    const characterReferences = characters
        .filter(char => char.image_url)
        .map(char => ({
            name: char.name,
            description: char.description,
            image_url: char.image_url
        }));

    // WebSocket 实时进度 (单页生成, 仅在非批量模式下显示进度条)
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
            syncResults();  // 主动同步整页图片映射到服务器
            showToast(`第 ${page.page_number} 页整页生成成功`, 'success');
        } else {
            showToast(result.error || '生成失败', 'error');
        }
    } catch (e) {
        if (task) task.finish();
        showToast('请求失败: ' + e.message, 'error');
    } finally {
        if (!skipLock) isGenerating = false;
        if (spinner) spinner.classList.add('hidden');
        unlock();
    }
}

async function combinePage(pageIdx, btn = null) {
    const page = currentSegments.pages[pageIdx];
    if (!page) {
        showToast('找不到分镜页', 'error');
        return;
    }
    const segs = page.segments;
    const segImgs = segs.map((_, segIdx) => generatedImages[`${pageIdx}-${segIdx}`]);
    if (segImgs.every(u => !u)) {
        showToast('本页还没有任何分镜图, 请先生成图片', 'error');
        return;
    }
    const spinner = document.getElementById(`combine-spinner-${pageIdx}`);
    if (spinner) spinner.classList.remove('hidden');
    showLoadingToast('正在拼版...');

    // 任务: 拼版期间禁用按钮, 防止点 "重新拼版" 引发并发请求
    const targetBtn = btn || document.querySelector(`#panel-segments button[onclick*="combinePage(${pageIdx}"]`);
    const labelEl = targetBtn ? targetBtn.querySelector('span:not([id*="spinner"])') : null;
    const unlock = lockButton(targetBtn, labelEl, '⏳ 拼版中…');

    try {
        const response = await fetch('/api/combine-page', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                page_idx: pageIdx,
                segments: segs.map((s, segIdx) => ({
                    scene_description: s.scene_description || '',
                    dialogue: s.dialogue || '',
                    dialogue_type: s.dialogue_type || 'dialogue',
                    image_url: generatedImages[`${pageIdx}-${segIdx}`] || null,
                })),
                panel_layout: null,         // 用自适应网格
                allow_overflow: true,       // 允许气泡越界 (后端字段名)
                gap: 4,
                padding: 4,
            })
        });
        const result = await response.json();
        if (result.success && result.image_url) {
            combinedPageImages[pageIdx] = result.image_url;
            renderSegments();
            renderGallery();
            syncResults();
            showToast(`第 ${page.page_number} 页拼版完成 (${result.panel_count || segs.length} 格)`, 'success');
        } else {
            showToast('拼版失败: ' + (result.error || '未知错误'), 'error');
        }
    } catch (e) {
        console.error('combinePage error:', e);
        showToast('拼版请求失败: ' + e.message, 'error');
    } finally {
        dismissLoadingToast();
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
        label.textContent = '⏸️ 暂停';
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
    batchStopRequested = false;  // 重置停止标志
    const unlock = lockButton(
        document.getElementById('batch-full-btn'),
        document.getElementById('batch-full-label'),
        '⏳ 批量整页生成中…'
    );

    const pagesToGenerate = [];
    for (let p = 0; p < currentSegments.pages.length; p++) {
        if (!fullPageImages[p]) {
            pagesToGenerate.push(p);
        }
    }

    // WebSocket 实时进度 (不可用时降级到 fake progress)
    const task = registerTaskProgress('batch-progress', {
        onProgress: (progress, message, stage, extra) => {
            // 批量生成时, 进度条可以显示当前页/总页数
            if (extra && extra.current !== undefined && extra.total !== undefined) {
                const text = document.getElementById('batch-progress-text');
                if (text) text.textContent = `${progress}% - ${message} (${extra.current}/${extra.total})`;
            }
        }
    });
    task.startFallback(120000);

    // 显示暂停/停止按钮
    const pauseBtn = document.getElementById('batch-pause-btn');
    const stopBtn = document.getElementById('batch-stop-btn');
    if (pauseBtn) {
        batchPaused = false;
        document.getElementById('batch-pause-label').textContent = '⏸️ 暂停';
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

async function generateAllImages() {
    if (isGenerating) {
        showToast('请等待当前生成完成', 'error');
        return;
    }

    const spinner = document.getElementById('batch-spinner');
    spinner.classList.remove('hidden');
    isGenerating = true;
    const unlock = lockButton(
        document.getElementById('batch-single-btn'),
        document.getElementById('batch-single-label'),
        '⏳ 批量逐个生成中…'
    );

    const itemsToGenerate = [];
    for (let p = 0; p < currentSegments.pages.length; p++) {
        for (let s = 0; s < currentSegments.pages[p].segments.length; s++) {
            const key = `${p}-${s}`;
            if (!generatedImages[key]) {
                itemsToGenerate.push({ pageIdx: p, segIdx: s });
            }
        }
    }

    // WebSocket 实时进度 (不可用时降级到 fake progress)
    const task = registerTaskProgress('batch-progress', {
        onProgress: (progress, message, stage, extra) => {
            if (extra && extra.current !== undefined && extra.total !== undefined) {
                const text = document.getElementById('batch-progress-text');
                if (text) text.textContent = `${progress}% - ${message} (${extra.current}/${extra.total})`;
            }
        }
    });
    task.startFallback(120000);

    // 串行生成
    // 显示暂停按钮
    const pauseBtn = document.getElementById('batch-pause-btn');
    if (pauseBtn) {
        batchPaused = false;
        document.getElementById('batch-pause-label').textContent = '⏸️ 暂停';
        pauseBtn.classList.remove('hidden');
    }

    let generatedCount = 0;
    for (const item of itemsToGenerate) {
        // 暂停检查
        const shouldContinue = await _checkBatchPause();
        if (!shouldContinue) break;

        await generateSingleImage(item.pageIdx, item.segIdx, true);
        generatedCount++;
        await new Promise(r => setTimeout(r, 300));
    }

    // 隐藏暂停按钮
    if (pauseBtn) pauseBtn.classList.add('hidden');
    batchPaused = false;
    task.finish();

    isGenerating = false;
    spinner.classList.add('hidden');
    unlock();
    if (generatedCount < itemsToGenerate.length) {
        showToast('批量逐个生成已暂停', 'info');
    } else {
        showToast('批量逐个生成完成', 'success');
    }
    switchTab('gallery');
}

function renderGallery() {
    const container = document.getElementById('gallery-container');

    const hasFullPages = Object.keys(fullPageImages).length > 0;
    const hasIndividual = Object.keys(generatedImages).length > 0;
    const hasCombined = Object.keys(combinedPageImages).length > 0;

    if (!hasFullPages && !hasIndividual && !hasCombined) {
        container.innerHTML = `
            <div class="text-center py-20 text-gray-400">
                <div class="text-6xl mb-4">🎨</div>
                <p>请先生成漫画图片</p>
            </div>`;
        return;
    }

    let html = '';

    if (hasCombined) {
        html += `
        <div class="mb-8">
            <h2 class="text-xl font-bold mb-4 flex items-center gap-2">
                <span class="bg-yellow-400 text-black border-2 border-black px-2 py-1 text-sm">📒 拼版预览 (任务3)</span>
            </h2>
            <div class="space-y-6">
                ${currentSegments.pages.map((page, pageIdx) => {
                    const img = combinedPageImages[pageIdx];
                    if (!img) return '';
                    return `
                    <div class="comic-page p-4">
                        <h3 class="text-lg font-bold mb-3 text-center border-b-2 border-black pb-2">第 ${page.page_number} 页</h3>
                        <div class="border-2 border-yellow-500">
                            <img src="${img}" class="w-full cursor-pointer" onclick="openModal('${img}')">
                        </div>
                    </div>
                    `;
                }).join('')}
            </div>
        </div>`;
    }

    if (hasFullPages) {
        html += `
        <div class="mb-8">
            <h2 class="text-xl font-bold mb-4 flex items-center gap-2">
                <span class="bg-black text-white px-2 py-1 text-sm">✓ 整页生成</span>
            </h2>
            <div class="space-y-6">
                ${currentSegments.pages.map((page, pageIdx) => {
                    const img = fullPageImages[pageIdx];
                    if (!img) return '';
                    const canEdit = fullPageCleanImages[pageIdx] && fullPageBubbles[pageIdx] && fullPageBubbles[pageIdx].length > 0;
                    return `
                    <div class="comic-page p-4">
                        <h3 class="text-lg font-bold mb-3 text-center border-b-2 border-black pb-2">第 ${page.page_number} 页</h3>
                        <div class="border-2 border-black">
                            <img src="${img}" class="w-full cursor-pointer" onclick="openModal('${img}')">
                        </div>
                        ${canEdit ? `
                        <div class="mt-3 flex justify-end">
                            <button onclick="openBubbleEditor(${pageIdx})" class="border-2 border-black px-4 py-2 text-sm font-medium hover:bg-gray-100 transition-colors">✏️ 编辑气泡位置</button>
                        </div>
                        ` : ''}
                    </div>
                    `;
                }).join('')}
            </div>
        </div>`;
    }

    if (hasIndividual) {
        html += `
        <div>
            <h2 class="text-xl font-bold mb-4 flex items-center gap-2">
                <span class="bg-gray-700 text-white px-2 py-1 text-sm">单个分镜</span>
            </h2>
            <div class="space-y-6">
                ${currentSegments.pages.map((page, pageIdx) => {
                    const pageHasImages = page.segments.some((_, segIdx) => generatedImages[`${pageIdx}-${segIdx}`]);
                    if (!pageHasImages) return '';

                    return `
                    <div class="comic-page p-6">
                        <h3 class="text-lg font-bold mb-4 text-center border-b-2 border-black pb-2">第 ${page.page_number} 页</h3>
                        <div class="grid grid-cols-2 gap-3">
                            ${page.segments.map((seg, segIdx) => {
                                const key = `${pageIdx}-${segIdx}`;
                                const img = generatedImages[key];
                                if (!img) return '';
                                return `
                                <div class="border-2 border-black relative group">
                                    <img src="${img}" class="w-full h-64 object-cover cursor-pointer" onclick="openModal('${img}')">
                                    ${seg.dialogue ? `
                                    <div class="absolute bottom-0 left-0 right-0 bg-white bg-opacity-95 border-t-2 border-black p-2">
                                        <p class="text-sm font-medium">${seg.dialogue}</p>
                                    </div>
                                    ` : ''}
                                </div>
                                `;
                            }).join('')}
                        </div>
                    </div>
                    `;
                }).join('')}
            </div>
        </div>`;
    }

    container.innerHTML = html;
}

function viewImage(key) {
    const img = generatedImages[key];
    if (img) openModal(img);
}

function openModal(src) {
    document.getElementById('modal-image').src = src;
    document.getElementById('image-modal').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('image-modal').classList.add('hidden');
}

// ===== 对话气泡位置拖拽编辑 =====
let _bubbleEditorReposition = null;

window.addEventListener('resize', function() {
    if (_bubbleEditorReposition && document.getElementById('bubble-editor-modal')) {
        _bubbleEditorReposition();
    }
});

function openBubbleEditor(pageIdx) {
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
        <div class="absolute inset-0 bg-black bg-opacity-70"></div>
        <div class="relative flex flex-col h-full max-w-6xl mx-auto w-full bg-white">
            <div class="flex items-center justify-between p-4 border-b-2 border-black">
                <h2 class="text-lg font-bold">✏️ 拖动气泡调整位置</h2>
                <div class="flex gap-2">
                    <button id="bubble-editor-cancel" class="border-2 border-gray-400 px-4 py-2 text-sm font-medium hover:bg-gray-100 transition-colors">取消</button>
                    <button id="bubble-editor-save" class="btn-primary px-4 py-2 text-sm font-medium">保存</button>
                </div>
            </div>
            <div class="flex-1 overflow-auto bg-gray-200 p-4 flex justify-center">
                <div id="bubble-editor-img-wrap" class="relative inline-block">
                    <img id="bubble-editor-img" src="${cleanUrl}" class="block" style="max-width: 100%; max-height: calc(100vh - 140px); object-fit: contain;">
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
            div.style.background = 'rgba(255,255,255,0.85)';
            div.style.border = '2px solid #1a1a1a';
            div.style.borderRadius = '8px';
            div.style.display = 'flex';
            div.style.alignItems = 'center';
            div.style.justifyContent = 'center';
            div.style.padding = '4px';
            div.style.textAlign = 'center';
            div.style.fontSize = '12px';
            div.style.overflow = 'hidden';
            div.style.lineHeight = '1.2';
            div.style.fontWeight = '500';
            div.textContent = bub.dialogue;
            div.dataset.idx = i;
            wrapEl.appendChild(div);
            makeDraggable(div, imgEl, bub);
        });
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
        modal.remove();
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

// ===== 人设图缺失拦截模态框 =====
function showMissingPersonaModal(missingChars) {
    return new Promise((resolve) => {
        // 移除旧模态框 (避免叠加)
        const old = document.getElementById('missing-persona-modal');
        if (old) old.remove();

        const names = missingChars.map(c => c.name || '(未命名)').join('、');
        const html = `
        <div id="missing-persona-modal" class="fixed inset-0 z-50 flex items-center justify-center">
            <div class="absolute inset-0 bg-black bg-opacity-50" onclick="document.getElementById('missing-persona-modal')?._resolveCancel()"></div>
            <div class="relative bg-white manga-border panel-shadow max-w-md w-full mx-4 p-6 z-10">
                <h3 class="text-xl font-bold mb-3 flex items-center gap-2">🎭 角色人设图缺失</h3>
                <p class="text-sm text-gray-700 mb-2">
                    以下 <span class="font-bold text-red-600">${missingChars.length}</span> 个角色还没上传/生成 <b>人设图</b>:
                </p>
                <div class="bg-yellow-50 border-l-4 border-yellow-400 p-3 mb-4 text-sm text-gray-700 max-h-32 overflow-y-auto">
                    ${names}
                </div>
                <p class="text-xs text-gray-500 mb-4">
                    没有统一人设图, 各分镜的角色形象会不一致. 建议先去 <b>角色管理</b> 手动上传或自动生成, 再来分镜.
                </p>
                <div class="flex flex-col gap-2">
                    <button id="persona-modal-go" class="btn-primary py-2 text-sm font-medium">
                        🎨 去角色管理上传/生成
                    </button>
                    <button id="persona-modal-skip" class="bg-gray-200 hover:bg-gray-300 text-gray-800 py-2 text-sm">
                        仍然继续 (不用人设图)
                    </button>
                </div>
            </div>
        </div>
        `;
        const wrap = document.createElement('div');
        wrap.innerHTML = html;
        document.body.appendChild(wrap.firstElementChild);

        const modal = document.getElementById('missing-persona-modal');
        // 让点遮罩 = 取消
        modal._resolveCancel = () => {
            modal.remove();
            resolve(false);
        };
        document.getElementById('persona-modal-go').onclick = () => {
            modal.remove();
            switchTab('characters');
            resolve(false);
        };
        document.getElementById('persona-modal-skip').onclick = () => {
            modal.remove();
            resolve(true);
        };
    });
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
        '⏳ 角色分析中…'
    );

    createProgressBar('analyze-progress');
    startFakeProgress('analyze-progress-bar', 'analyze-progress-text', 120000);

    // WebSocket 实时进度 (不可用时降级到 fake progress)
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
    if (characters.length === 0) {
        container.innerHTML = `
            <div class="text-center py-20 text-gray-400 col-span-full">
                <div class="text-6xl mb-4">🎭</div>
                <p>请先点击"从小说分析角色"或手动添加角色</p>
            </div>
        `;
        return;
    }

    container.innerHTML = characters.map((char, idx) => `
        <div class="bg-white p-4 manga-border panel-shadow">
            <div class="flex justify-between items-start mb-2">
                <h3 class="text-lg font-bold">${escapeHtml(char.name)}</h3>
                <button onclick="togglePromptEditor(${idx})" class="text-xs border border-gray-300 rounded px-2 py-0.5 hover:bg-gray-100 transition-colors" title="编辑人设图生成提示词" id="prompt-toggle-${idx}">✏️ Prompt</button>
            </div>
            <p class="text-sm text-gray-600 mb-3">${escapeHtml(char.description)}</p>
            ${char.image_url ? `
            <div class="mb-3 border-2 border-gray-300 relative group">
                <img src="${char.image_url}" class="w-full h-48 object-cover cursor-pointer" onclick="openModal('${char.image_url}')">
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
    `).join('');
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
    if (!file.type.startsWith('image/')) {
        showToast('请选择图片文件', 'error');
        input.value = '';
        return;
    }
    // 限制 5MB, 避免 dataURL 太大撑爆 storage
    if (file.size > 5 * 1024 * 1024) {
        showToast('图片超过 5MB, 请压缩后再上传', 'error');
        input.value = '';
        return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
        const dataUrl = e.target.result;
        // 缩放到最长边 1024px, 避免前端 dataURL 占用过多内存
        compressImage(dataUrl, 1024).then((compressed) => {
            characters[idx].image_url = compressed;
            renderCharacters();
            syncResults();
            showToast(`「${characters[idx].name}」人设图已更新`, 'success');
        }).catch((err) => {
            // 缩放失败时直接用原图
            characters[idx].image_url = dataUrl;
            renderCharacters();
            syncResults();
            showToast(`「${characters[idx].name}」人设图已更新 (未压缩)`, 'success');
        });
    };
    reader.onerror = () => {
        showToast('读取图片失败', 'error');
    };
    reader.readAsDataURL(file);
    // 清空 input, 允许再次选同一张图
    input.value = '';
}

function compressImage(dataUrl, maxSide) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            try {
                const w0 = img.naturalWidth, h0 = img.naturalHeight;
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
                ctx.drawImage(img, 0, 0, w, h);
                // JPEG 质量 0.85, 体积比 PNG 小很多
                resolve(canvas.toDataURL('image/jpeg', 0.85));
            } catch (e) {
                reject(e);
            }
        };
        img.onerror = (e) => reject(new Error('image load failed'));
        img.src = dataUrl;
    });
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
                max_attempts: 3
            })
        });

        const result = await response.json();
        if (result.success) {
            characters[idx].image_url = result.image_url;
            renderCharacters();
            syncResults();
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
            btn.disabled = false;
            btn.classList.remove('opacity-60', 'cursor-not-allowed');
            // 重新渲染以恢复原 label (生成人设图 / 重新生成人设图)
            renderCharacters();
        }
    }
}

async function combineAllPages() {
    if (!currentSegments.pages || currentSegments.pages.length === 0) {
        showToast('请先生成分镜', 'error');
        return;
    }

    const spinner = document.getElementById('combine-spinner');
    spinner.classList.remove('hidden');
    combinedPages = [];

    try {
        for (let pageIdx = 0; pageIdx < currentSegments.pages.length; pageIdx++) {
            const page = currentSegments.pages[pageIdx];
            const segmentsWithImages = page.segments.map((seg, segIdx) => ({
                ...seg,
                image_url: generatedImages[`${pageIdx}-${segIdx}`] || null
            })).filter(seg => seg.image_url);

            if (segmentsWithImages.length === 0) continue;

            const response = await fetch('/api/combine-page', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    segments: segmentsWithImages,
                    page_num: page.page_number
                })
            });

            const result = await response.json();
            if (result.success) {
                combinedPages.push({ page_num: page.page_number, image_url: result.image_url });
            }
        }

        renderCombinedPages();
        showToast(`成功合并 ${combinedPages.length} 页`, 'success');
    } catch (e) {
        showToast('合并失败: ' + e.message, 'error');
    } finally {
        spinner.classList.add('hidden');
    }
}

function renderCombinedPages() {
    const container = document.getElementById('combined-pages');
    if (combinedPages.length === 0) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = `
        <div class="bg-white p-6 manga-border panel-shadow">
            <h2 class="text-xl font-bold mb-4 border-b-2 border-black pb-2">合并页面</h2>
            <div class="space-y-6">
                ${combinedPages.map(page => `
                <div class="border-2 border-gray-300">
                    <img src="${page.image_url}" class="w-full cursor-pointer" onclick="openModal('${page.image_url}')">
                </div>
                `).join('')}
            </div>
        </div>
    `;
}

window.addEventListener('DOMContentLoaded', () => {
    renderStylePresets();
    renderCustomStyleTags();
    updateStyleSummary();
    loadConfig();
    updateCharCount();
    recoverSession();  // 尝试恢复之前可能因内网穿透断开丢失的会话数据
    initWebSocket();   // 初始化 WebSocket 实时进度连接
});
