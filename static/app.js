let currentSegments = { pages: [] };
let generatedImages = {};
let isGenerating = false;
let characters = [];
let combinedPages = [];
let fullPageImages = {};  // 整页生成的图片

const tabs = ['config', 'input', 'characters', 'segments', 'gallery'];
const CONCURRENT_LIMIT = 3;

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
        document.getElementById('llm-api-url').value = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
        document.getElementById('img-api-url').value = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
        showToast('火山引擎 v3 预设已应用，请填写 API Key 和模型名称！', 'success');
    } else if (preset === 'volc-coding') {
        document.getElementById('llm-api-url').value = 'https://ark.cn-beijing.volces.com/api/coding/v3';
        document.getElementById('img-api-url').value = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
        showToast('火山引擎 Coding 预设已应用，请填写 API Key 和模型名称！', 'success');
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

    try {
        const response = await fetch('/api/test-llm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                api_url: document.getElementById('llm-api-url').value,
                api_key: document.getElementById('llm-api-key').value,
                model: document.getElementById('llm-model').value
            })
        });

        const result = await response.json();
        if (result.success) {
            resultDiv.innerHTML = `<div class="p-3 bg-green-50 border border-green-200 text-green-700 rounded">✅ ${result.message}</div>`;
            showToast('LLM API测试成功！', 'success');
        } else {
            resultDiv.innerHTML = `<div class="p-3 bg-red-50 border border-red-200 text-red-700 rounded">❌ ${result.error}</div>`;
            showToast('LLM API测试失败', 'error');
        }
    } catch (e) {
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

    try {
        const response = await fetch('/api/test-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                api_url: document.getElementById('img-api-url').value,
                api_key: document.getElementById('img-api-key').value,
                model: document.getElementById('img-model').value
            })
        });

        const result = await response.json();
        if (result.success) {
            resultDiv.innerHTML = `<div class="p-3 bg-green-50 border border-green-200 text-green-700 rounded">✅ ${result.message}</div>`;
            showToast('Image API测试成功！', 'success');
        } else {
            resultDiv.innerHTML = `<div class="p-3 bg-red-50 border border-red-200 text-red-700 rounded">❌ ${result.error}</div>`;
            showToast('Image API测试失败', 'error');
        }
    } catch (e) {
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
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.style.background = type === 'error' ? '#dc2626' : type === 'success' ? '#16a34a' : '#1a1a1a';
    toast.style.transform = 'translateY(0)';
    toast.style.opacity = '1';
    setTimeout(() => {
        toast.style.transform = 'translateY(20px)';
        toast.style.opacity = '0';
    }, 3000);
}

function updateCharCount() {
    const text = document.getElementById('novel-text').value;
    document.getElementById('char-count').textContent = text.length;
}

document.getElementById('novel-text').addEventListener('input', updateCharCount);

async function saveConfig() {
    const config = {
        llm_api_url: document.getElementById('llm-api-url').value,
        llm_api_key: document.getElementById('llm-api-key').value,
        llm_model: document.getElementById('llm-model').value,
        img_api_url: document.getElementById('img-api-url').value,
        img_api_key: document.getElementById('img-api-key').value,
        img_model: document.getElementById('img-model').value,
        segments_per_page: parseInt(document.getElementById('segments-per-page').value) || 4,
        negative_prompt: document.getElementById('negative-prompt').value
    };

    localStorage.setItem('manga_config', JSON.stringify(config));

    try {
        await fetch('/api/save-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });
    } catch (e) {}

    showToast('配置已保存', 'success');
}

function loadConfig() {
    const saved = localStorage.getItem('manga_config');
    if (saved) {
        const config = JSON.parse(saved);
        document.getElementById('llm-api-url').value = config.llm_api_url || '';
        document.getElementById('llm-api-key').value = config.llm_api_key || '';
        document.getElementById('llm-model').value = config.llm_model || '';
        document.getElementById('img-api-url').value = config.img_api_url || '';
        document.getElementById('img-api-key').value = config.img_api_key || '';
        document.getElementById('img-model').value = config.img_model || '';
        document.getElementById('segments-per-page').value = config.segments_per_page || 4;
        document.getElementById('negative-prompt').value = config.negative_prompt || '';
    }
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
        switchTab('config');
        return;
    }

    const spinner = document.getElementById('segment-spinner');
    spinner.classList.remove('hidden');

    try {
        const response = await fetch('/api/segment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: text,
                api_url: config.llm_api_url,
                api_key: config.llm_api_key,
                model: config.llm_model,
                segments_per_page: config.segments_per_page || 4
            })
        });

        const result = await response.json();
        if (result.success) {
            currentSegments = result.data;
            renderSegments();
            showToast(`成功生成 ${currentSegments.pages.length} 页分镜`, 'success');
            switchTab('segments');
        } else {
            showToast(result.error || '分镜失败', 'error');
        }
    } catch (e) {
        showToast('请求失败: ' + e.message, 'error');
    } finally {
        spinner.classList.add('hidden');
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
                    <button onclick="generateFullPage(${pageIdx})" class="text-sm bg-black text-white px-3 py-1 hover:bg-gray-800 transition-colors flex items-center gap-1">
                        <span>整页生成</span>
                        <span id="full-page-spinner-${pageIdx}" class="loading-spinner hidden" style="width:12px;height:12px;border-width:1px;"></span>
                    </button>
                </div>
            </div>
            ${hasFullPageImage ? `
            <div class="mb-6 border-2 border-black p-1">
                <div class="text-sm text-gray-600 mb-2">✅ 整页漫画</div>
                <img src="${hasFullPageImage}" class="w-full cursor-pointer" onclick="openModal('${hasFullPageImage}')">
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
                                    <label class="flex items-center gap-1 text-xs bg-gray-100 px-2 py-1 rounded cursor-pointer hover:bg-gray-200">
                                        <input type="checkbox" 
                                            ${selectedChars.includes(charIdx) ? 'checked' : ''} 
                                            onchange="toggleCharacter(${pageIdx}, ${segIdx}, ${charIdx})"
                                            class="mr-1">
                                        ${char.name}
                                    </label>
                                `).join('')}
                            </div>
                        </div>
                        <div class="mb-2">
                            <label class="text-xs text-gray-500 font-medium">场景描述</label>
                            <textarea 
                                onchange="updateSegment(${pageIdx}, ${segIdx}, 'scene_description', this.value)"
                                class="w-full p-2 border border-gray-300 text-sm mt-1 resize-none focus:border-black outline-none" 
                                rows="3">${seg.scene_description || ''}</textarea>
                        </div>
                        <div class="mb-2">
                            <label class="text-xs text-gray-500 font-medium">对话/旁白</label>
                            <textarea 
                                onchange="updateSegment(${pageIdx}, ${segIdx}, 'dialogue', this.value)"
                                class="w-full p-2 border border-gray-300 text-sm mt-1 resize-none focus:border-black outline-none" 
                                rows="2">${seg.dialogue || ''}</textarea>
                        </div>
                        <div class="mb-3">
                            <label class="text-xs text-gray-500 font-medium">绘图提示词</label>
                            <textarea 
                                onchange="updateSegment(${pageIdx}, ${segIdx}, 'style_prompt', this.value)"
                                class="w-full p-2 border border-gray-300 text-sm mt-1 resize-none focus:border-black outline-none font-mono text-xs" 
                                rows="2">${seg.style_prompt || 'black and white manga style, detailed ink drawing'}</textarea>
                        </div>
                        <div class="flex gap-2">
                            <button onclick="generateSingleImage(${pageIdx}, ${segIdx})" 
                                class="flex-1 bg-gray-800 text-white text-sm py-2 hover:bg-black transition-colors flex items-center justify-center gap-1">
                                <span>生成图片</span>
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

async function generateSingleImage(pageIdx, segIdx, skipLock = false) {
    if (!skipLock && isGenerating) {
        showToast('请等待当前生成完成', 'error');
        return;
    }

    const config = JSON.parse(localStorage.getItem('manga_config') || '{}');
    if (!config.img_api_url) {
        showToast('请先配置图像生成API', 'error');
        switchTab('config');
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
    const btn = document.querySelector(`#segment-${pageIdx}-${segIdx} button`);
    const originalText = btn ? btn.innerHTML : '';
    if (btn) {
        btn.innerHTML = '<span class="loading-spinner" style="width:16px;height:16px;border-width:2px;"></span>';
        btn.disabled = true;
    }

    try {
        const response = await fetch('/api/generate-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: prompt,
                api_url: config.img_api_url,
                api_key: config.img_api_key,
                model: config.img_model,
                negative_prompt: config.negative_prompt,
                character_references: characterReferences
            })
        });

        const result = await response.json();
        if (result.success) {
            generatedImages[`${pageIdx}-${segIdx}`] = result.image_url;
            renderSegments();
            renderGallery();
            showToast('图片生成成功', 'success');
        } else {
            showToast(result.error || '生成失败', 'error');
        }
    } catch (e) {
        showToast('请求失败: ' + e.message, 'error');
    } finally {
        if (!skipLock) isGenerating = false;
        if (btn) {
            btn.innerHTML = originalText;
            btn.disabled = false;
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

async function generateFullPage(pageIdx, skipLock = false) {
    if (!skipLock && isGenerating) {
        showToast('请等待当前生成完成', 'error');
        return;
    }

    const config = JSON.parse(localStorage.getItem('manga_config') || '{}');
    if (!config.img_api_url) {
        showToast('请先配置图像生成API', 'error');
        switchTab('config');
        return;
    }

    if (!skipLock) isGenerating = true;
    const spinner = document.getElementById(`full-page-spinner-${pageIdx}`);
    if (spinner) spinner.classList.remove('hidden');

    const page = currentSegments.pages[pageIdx];

    const characterReferences = characters
        .filter(char => char.image_url)
        .map(char => ({
            name: char.name,
            description: char.description,
            image_url: char.image_url
        }));

    try {
        const response = await fetch('/api/generate-page', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                page: page,
                page_num: page.page_number,
                api_url: config.img_api_url,
                api_key: config.img_api_key,
                model: config.img_model,
                negative_prompt: config.negative_prompt,
                character_references: characterReferences
            })
        });

        const result = await response.json();
        if (result.success) {
            fullPageImages[pageIdx] = result.image_url;
            renderSegments();
            renderGallery();
            showToast(`第 ${page.page_number} 页整页生成成功`, 'success');
        } else {
            showToast(result.error || '生成失败', 'error');
        }
    } catch (e) {
        showToast('请求失败: ' + e.message, 'error');
    } finally {
        if (!skipLock) isGenerating = false;
        if (spinner) spinner.classList.add('hidden');
    }
}

async function generateAllFullPages() {
    if (isGenerating) {
        showToast('请等待当前生成完成', 'error');
        return;
    }

    const spinner = document.getElementById('batch-full-spinner');
    spinner.classList.remove('hidden');
    isGenerating = true;

    const pagesToGenerate = [];
    for (let p = 0; p < currentSegments.pages.length; p++) {
        if (!fullPageImages[p]) {
            pagesToGenerate.push(p);
        }
    }

    const tasks = pagesToGenerate.map(p => () => generateFullPage(p, true).then(() => new Promise(r => setTimeout(r, 500))));
    await runWithConcurrency(tasks, CONCURRENT_LIMIT);

    isGenerating = false;
    spinner.classList.add('hidden');
    showToast('批量整页生成完成', 'success');
    switchTab('gallery');
}

async function generateAllImages() {
    if (isGenerating) {
        showToast('请等待当前生成完成', 'error');
        return;
    }

    const spinner = document.getElementById('batch-spinner');
    spinner.classList.remove('hidden');
    isGenerating = true;

    const tasks = [];
    for (let p = 0; p < currentSegments.pages.length; p++) {
        for (let s = 0; s < currentSegments.pages[p].segments.length; s++) {
            const key = `${p}-${s}`;
            if (!generatedImages[key]) {
                const pageIdx = p, segIdx = s;
                tasks.push(() => generateSingleImage(pageIdx, segIdx, true).then(() => new Promise(r => setTimeout(r, 300))));
            }
        }
    }

    await runWithConcurrency(tasks, CONCURRENT_LIMIT);

    isGenerating = false;
    spinner.classList.add('hidden');
    showToast('批量逐个生成完成', 'success');
    switchTab('gallery');
}

function renderGallery() {
    const container = document.getElementById('gallery-container');
    
    const hasFullPages = Object.keys(fullPageImages).length > 0;
    const hasIndividual = Object.keys(generatedImages).length > 0;

    if (!hasFullPages && !hasIndividual) {
        container.innerHTML = `
            <div class="text-center py-20 text-gray-400">
                <div class="text-6xl mb-4">🎨</div>
                <p>请先生成漫画图片</p>
            </div>`;
        return;
    }

    let html = '';

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
                    return `
                    <div class="comic-page p-4">
                        <h3 class="text-lg font-bold mb-3 text-center border-b-2 border-black pb-2">第 ${page.page_number} 页</h3>
                        <div class="border-2 border-black">
                            <img src="${img}" class="w-full cursor-pointer" onclick="openModal('${img}')">
                        </div>
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
        switchTab('config');
        return;
    }

    const spinner = document.getElementById('analyze-spinner');
    spinner.classList.remove('hidden');

    try {
        const response = await fetch('/api/generate-characters', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: text,
                api_url: config.llm_api_url,
                api_key: config.llm_api_key,
                model: config.llm_model
            })
        });

        const result = await response.json();
        if (result.success) {
            characters = result.data.characters || [];
            renderCharacters();
            showToast(`成功分析 ${characters.length} 个角色`, 'success');
        } else {
            showToast(result.error || '分析失败', 'error');
        }
    } catch (e) {
        showToast('请求失败: ' + e.message, 'error');
    } finally {
        spinner.classList.add('hidden');
    }
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
            <h3 class="text-lg font-bold mb-2">${char.name}</h3>
            <p class="text-sm text-gray-600 mb-3">${char.description}</p>
            ${char.image_url ? `
            <div class="mb-3 border-2 border-gray-300">
                <img src="${char.image_url}" class="w-full h-48 object-cover cursor-pointer" onclick="openModal('${char.image_url}')">
            </div>
            ` : ''}
            <button onclick="generateCharacterImage(${idx})" class="w-full btn-primary py-2 text-sm">
                ${char.image_url ? '重新生成人设图' : '生成人设图'}
            </button>
        </div>
    `).join('');
}

async function generateCharacterImage(idx) {
    const char = characters[idx];
    const config = JSON.parse(localStorage.getItem('manga_config') || '{}');
    if (!config.img_api_url) {
        showToast('请先配置图像生成API', 'error');
        switchTab('config');
        return;
    }

    try {
        const response = await fetch('/api/generate-character-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: char.name,
                description: char.description,
                api_url: config.img_api_url,
                api_key: config.img_api_key,
                model: config.img_model
            })
        });

        const result = await response.json();
        if (result.success) {
            characters[idx].image_url = result.image_url;
            renderCharacters();
            showToast(`${char.name} 人设图生成成功`, 'success');
        } else {
            showToast(result.error || '生成失败', 'error');
        }
    } catch (e) {
        showToast('请求失败: ' + e.message, 'error');
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
    loadConfig();
    updateCharCount();
});
