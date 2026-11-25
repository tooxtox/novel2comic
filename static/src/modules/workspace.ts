/**
 * 工作台 / 配置 / 风格 / AI 写作 (原 app.js 里零散的工作台逻辑)
 * 包含: 状态条、流程条、PRIMARY_ACTIONS、AI 续写/润色、API 配置、风格 Tag、单选组
 */

import { state, STYLE_PRESETS, STYLE_CATEGORIES, workMetaInit } from './state';
import { motionReduced, escapeHtml, playStagger } from './ui';
import { showToast, showLoadingToast, dismissLoadingToast } from './toast';
import { fetchWithRetry, lockButton } from './api';
import { registerTaskProgress, createProgressBar, startFakeProgress, finishProgress } from './progress';
import { openConfigModal } from './modals';
import { switchTab } from './tabs';

/* ============================================================
 * 状态条 / 流程条 / 作品元信息
 * ============================================================ */

/** 数字滚动: 逐字输入这类小改动直接更新, 粘贴/生成这类大改动滚动到位 */
export function countUp(el: HTMLElement | null, value: number): void {
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
    const tick = (now: number) => {
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

export function _setCountChip(id: string, text: string, positive: boolean): void {
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

export function _setStatusChip(id: string, textId: string, ok: boolean, label: string): void {
    const chip = document.getElementById(id);
    const text = document.getElementById(textId);
    if (!chip) return;
    chip.classList.toggle('is-ok', !!ok);
    chip.classList.toggle('is-bad', !ok);
    if (text) text.textContent = ok ? `${label}已就绪` : `${label}未配置`;
}

export function scheduleWorkspaceUI(): void {
    if ((scheduleWorkspaceUI as any)._pending) return;
    (scheduleWorkspaceUI as any)._pending = true;
    requestAnimationFrame(() => {
        (scheduleWorkspaceUI as any)._pending = false;
        updateWorkspaceUI();
    });
}

/** 汇总真实状态: 统计数字 / 接口状态 / 四步进度 / 状态条主操作 */
export function updateWorkspaceUI(): void {
    const textEl = document.getElementById('novel-text') as HTMLTextAreaElement | null;
    const chars = textEl ? (textEl.value || '').length : 0;
    const charCount = state.characters.length;
    const pages = (state.currentSegments.pages || []).length;
    const segCount = (state.currentSegments.pages || []).reduce((n: number, p: any) => n + (p.segments || []).length, 0);
    const fullPages = Object.keys(state.fullPageImages).length;

    countUp(document.getElementById('stat-chars'), chars);
    countUp(document.getElementById('stat-chars-count'), charCount);
    countUp(document.getElementById('stat-segments'), segCount);
    countUp(document.getElementById('stat-pages'), fullPages);

    _setCountChip('input-count-chip', `${chars} 字`, chars > 0);
    _setCountChip('chars-count-chip', `${charCount} 个角色`, charCount > 0);
    _setCountChip('seg-count-chip', `${pages} 页 / ${segCount} 格`, segCount > 0);
    _setCountChip('gallery-count-chip', `${fullPages} 张`, fullPages > 0);

    const wbCounts = document.getElementById('wb-counts');
    if (wbCounts) {
        wbCounts.textContent = `${chars} 字 / ${charCount} 角色 / ${segCount} 分镜 / ${fullPages} 整页`;
    }

    // 接口状态
    let cfg: any = {};
    try { cfg = JSON.parse(localStorage.getItem('manga_config') || '{}'); } catch (e) { cfg = {}; }
    _setStatusChip('chip-llm', 'chip-llm-text', !!(cfg.llm_api_url && cfg.llm_api_key), '文本接口');
    _setStatusChip('chip-img', 'chip-img-text', !!(cfg.img_api_url && cfg.img_api_key), '图像接口');
    const workChip = document.getElementById('chip-work');
    if (workChip) {
        workChip.classList.toggle('is-ok', !!state.workMeta.title);
        workChip.classList.toggle('is-bad', !state.workMeta.title);
        const t = document.getElementById('chip-work-text');
        if (t) t.textContent = state.workMeta.title ? `作品：${state.workMeta.title}` : '尚未命名作品';
    }
    const modeText = document.getElementById('chip-mode-text');
    if (modeText) {
        modeText.textContent = `${state.comicMode === 'color' ? '彩色' : '黑白'} · ${state.bubbleRenderMode === 'pil' ? '本地气泡' : '模型画气泡'}`;
    }
    // 生成中: 让状态点跟着呼吸
    ['chip-llm', 'chip-img'].forEach((id) => {
        const chip = document.getElementById(id);
        if (chip) chip.classList.toggle('is-busy', !!state.isGenerating);
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
            dot.classList.toggle('is-busy', i === activeIdx && !!state.isGenerating);
        });
        connectors.forEach((c, i) => {
            c.classList.toggle('is-done', steps[i].done && steps[i + 1].done);
        });
    }

    // 状态条主操作跟随当前标签页
    const action = state.primaryActions[state.currentTab];
    const actionLabel = document.getElementById('wb-action-label');
    if (action && actionLabel) actionLabel.textContent = action.label;
    renderWorkMeta();
}

/** 状态条 / 快捷键共用的主操作 */
export function runPrimaryAction(): void {
    const action = state.primaryActions[state.currentTab];
    if (!action) return;
    try {
        action.run();
    } catch (e: any) {
        showToast('操作失败: ' + (e.message || e), 'error');
    }
}

export function renderWorkMeta(): void {
    const titleEl = document.getElementById('wb-title');
    const saveEl = document.getElementById('wb-save');
    if (titleEl) titleEl.textContent = state.workMeta.title || '未命名作品';
    if (saveEl) {
        saveEl.textContent = state.workMeta.dirty
            ? '有改动未保存'
            : (state.workMeta.savedAt ? `已保存 ${state.workMeta.savedAt}` : '尚未保存');
        saveEl.style.color = state.workMeta.dirty ? '#b45309' : '';
    }
}

export function markDirty(): void {
    if (state.workMeta.dirty) return;
    state.workMeta.dirty = true;
    renderWorkMeta();
}

export function markSaved(title?: string): void {
    state.workMeta.dirty = false;
    if (title) state.workMeta.title = title;
    state.workMeta.savedAt = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    try {
        localStorage.setItem('manga_work_title', state.workMeta.title || '');
        localStorage.setItem('manga_work_saved_at', state.workMeta.savedAt);
    } catch (e) { /* 忽略 */ }
    renderWorkMeta();
    // 保存成功时给"已保存"那一行来一下弹性反馈
    const wbSave = document.getElementById('wb-save');
    if (wbSave && (window as any).__t2cTransitions) {
        wbSave.style.color = '#15803d';  // 短暂变绿
        (window as any).__t2cTransitions.celebrateSave(wbSave);
        setTimeout(() => { wbSave.style.color = ''; }, 1100);
    }
}

/** 静默保存当前进度 (不弹标题输入框) */
export async function quickSave(): Promise<void> {
    try {
        await (window as any).saveCurrentState();
        markSaved();
        updateWorkspaceUI();
        showToast('已保存当前进度', 'success');
    } catch (e: any) {
        showToast('保存失败: ' + (e.message || e), 'error');
    }
}

/* ============================================================
 * 启动入场
 * ============================================================ */

/** 启动入场: 头部/统计/流程条依次浮现 (2.5s 兜底由模板里的内联脚本负责) */
export function bootIntro(): void {
    const items = document.querySelectorAll('[data-boot]');
    if (motionReduced() || !items.length) {
        document.documentElement.classList.remove('boot-armed');
        (window as any).__appBooted = true;
        return;
    }
    items.forEach((el: any, i: number) => {
        el.style.transitionDelay = Math.min(i * 60, 360) + 'ms';
        el.classList.add('is-in');
    });
    setTimeout(() => {
        document.documentElement.classList.remove('boot-armed');
        items.forEach((el: any) => { el.style.transitionDelay = ''; });
    }, 1000);
    // 首屏那个面板的内容也跟着落位
    const w: any = window;
    if (typeof w.staggerPanel === 'function') {
        w.staggerPanel(document.getElementById(`panel-${state.currentTab}`));
    }
    // 标记放在最后: 中途抛错时不设标记, 让 2.5s 兜底把内容放出来
    (window as any).__appBooted = true;
    // PWA: 注册 Service Worker（失败不影响主流程）
    // 由 pwa 模块负责, 这里不重复注册
}

/* ============================================================
 * 风格 Tag 管理
 * ============================================================ */

export function renderStylePresets(): void {
    const container = document.getElementById('style-tag-presets');
    if (!container) return;
    container.innerHTML = '';

    // 按分类分组渲染
    STYLE_CATEGORIES.forEach(category => {
        const presetsInCategory = STYLE_PRESETS.filter((p: any) => p.category === category);
        if (presetsInCategory.length === 0) return;

        const groupDiv = document.createElement('div');
        groupDiv.className = 'mb-3';

        // 分类标题
        const title = document.createElement('div');
        title.className = 'text-xs font-extrabold text-[#4e4e54] mb-2 flex items-center gap-1.5';
        const categoryCode: any = {
            '日漫': 'JP', '美漫': 'US', '韩漫': 'KR', '国漫': 'CN', '其他': 'EX'
        };
        title.innerHTML = `<span class="mono px-1.5 py-0.5 text-[10px] bg-[#111112] text-white">${categoryCode[category] || 'ST'}</span><span>${category}</span>`;
        groupDiv.appendChild(title);

        // 风格按钮组
        const btnGroup = document.createElement('div');
        btnGroup.className = 'flex flex-wrap gap-2';

        presetsInCategory.forEach((preset: any) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.dataset.id = preset.id;
            const isSelected = state.selectedPresetIds.has(preset.id);
            btn.className = isSelected
                ? 'px-3 py-1.5 text-xs md:text-sm font-bold border-2 border-[#111112] bg-[#111112] text-white shadow-[2px_2px_0_#c23623] transition-all'
                : 'px-3 py-1.5 text-xs md:text-sm font-medium border-2 border-[#d4d1c7] bg-white text-[#111112] hover:border-[#111112] transition-all';
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

export function renderCustomStyleTags(): void {
    const container = document.getElementById('custom-style-tags');
    if (!container) return;
    container.innerHTML = '';
    state.customStyleTags.forEach((tag: string, idx: number) => {
        const chip = document.createElement('span');
        chip.className = 'inline-flex items-center gap-1 px-2 py-1 text-sm border-2 border-black bg-gray-100';
        chip.innerHTML = `<span>${escapeHtml(tag)}</span><button type="button" onclick="removeCustomStyleTag(${idx})" class="text-gray-500 hover:text-black font-bold">×</button>`;
        container.appendChild(chip);
    });
}

export function togglePresetStyle(id: string): void {
    if (state.selectedPresetIds.has(id)) {
        state.selectedPresetIds.delete(id);
    } else {
        state.selectedPresetIds.add(id);
    }
    renderStylePresets();
    updateStyleSummary();
}

export function addCustomStyleTag(): void {
    const input = document.getElementById('custom-style-input') as HTMLInputElement | null;
    if (!input) return;
    const value = input.value.trim();
    if (!value) return;
    if (state.customStyleTags.includes(value)) {
        showToast('该风格已存在', 'error');
        return;
    }
    state.customStyleTags.push(value);
    input.value = '';
    renderCustomStyleTags();
    updateStyleSummary();
}

export function removeCustomStyleTag(idx: number): void {
    state.customStyleTags.splice(idx, 1);
    renderCustomStyleTags();
    updateStyleSummary();
}

// 切换风格面板展开/折叠
export function toggleStylePanel(): void {
    const content = document.getElementById('style-panel-content');
    const icon = document.getElementById('style-toggle-icon');
    if (!content) return;
    if (content.classList.contains('hidden')) {
        content.classList.remove('hidden');
        if (icon) icon.textContent = '▲';
    } else {
        content.classList.add('hidden');
        if (icon) icon.textContent = '▼';
    }
}

// 清空所有已选风格
export function clearAllStyles(): void {
    state.selectedPresetIds.clear();
    state.customStyleTags = [];
    renderStylePresets();
    renderCustomStyleTags();
    updateStyleSummary();
    showToast('已清空所有风格', 'info');
}

// 更新风格摘要 (显示在面板标题旁)
export function updateStyleSummary(): void {
    const summaryEl = document.getElementById('style-summary');
    if (!summaryEl) return;
    const presetCount = state.selectedPresetIds.size;
    const customCount = state.customStyleTags.length;
    const total = presetCount + customCount;
    if (total === 0) {
        summaryEl.textContent = `(未选择风格, 将使用默认${state.comicMode === 'color' ? '彩色' : '黑白'}漫画风格)`;
    } else {
        const presetLabels = STYLE_PRESETS
            .filter((p: any) => state.selectedPresetIds.has(p.id))
            .map((p: any) => p.label);
        const allLabels = [...presetLabels, ...state.customStyleTags];
        summaryEl.textContent = `已选 ${total} 项: ${allLabels.join(', ')}`;
    }
}

export function getStyleTagsString(): string {
    const parts: string[] = [];
    STYLE_PRESETS.forEach((p: any) => {
        if (state.selectedPresetIds.has(p.id)) parts.push(p.tags);
    });
    parts.push(...state.customStyleTags);
    return parts.join(', ');
}

/** 气泡类型迷你预览: 改下拉时形状跟着变 */
export function syncBubbleMini(selectEl: HTMLSelectElement | null): void {
    const mini = selectEl && selectEl.parentElement ? selectEl.parentElement.querySelector('.bubble-mini') as HTMLElement | null : null;
    if (!selectEl || !mini) return;
    mini.dataset.type = selectEl.value;
    mini.classList.remove('is-changed');
    void mini.offsetWidth;
    mini.classList.add('is-changed');
    setTimeout(() => mini.classList.remove('is-changed'), 340);
}

/* ============================================================
 * 单选组 / 漫画模式 / 气泡渲染方式
 * ============================================================ */

// ===== 单选组 (radio group) 通用渲染 =====
// 两组单选 (comic-mode / bubble-render-mode) 共享同一份 Tailwind 样式切换
export function applyRadioGroupToDom(groupName: string, currentValue: string): void {
    document.querySelectorAll(`input[name="${groupName}"]`).forEach((radio: any) => {
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
export function getComicModeFromDom(): 'bw' | 'color' {
    const el = document.querySelector('input[name="comic-mode"]:checked') as HTMLInputElement | null;
    return (el && el.value === 'color') ? 'color' : 'bw';
}

export function applyComicModeToDom(): void {
    applyRadioGroupToDom('comic-mode', state.comicMode);
}

export function onComicModeChange(): void {
    state.comicMode = getComicModeFromDom();
    applyComicModeToDom();
    updateStyleSummary();
    scheduleWorkspaceUI();
}

// ===== 气泡渲染方式 (PIL / API) =====
export function getBubbleRenderModeFromDom(): 'pil' | 'api' {
    const el = document.querySelector('input[name="bubble-render-mode"]:checked') as HTMLInputElement | null;
    return (el && el.value === 'api') ? 'api' : 'pil';
}

// 画廊中所有 .edit-bubble-btn 的可见性由 bubbleRenderMode 决定, 模式切换时
// 只翻转按钮, 不重建画廊 (避免每张图、每个 tooltip 全部重渲)
export function _refreshBubbleEditButtons(): void {
    document.querySelectorAll('.edit-bubble-btn').forEach((btn: any) => {
        const idx = +btn.dataset.pageIdx;
        const visible = state.bubbleRenderMode === 'pil'
            && state.fullPageCleanImages[idx]
            && state.fullPageBubbles[idx]
            && state.fullPageBubbles[idx].length > 0;
        btn.classList.toggle('hidden', !visible);
    });
}

export function applyBubbleRenderModeToDom(): void {
    applyRadioGroupToDom('bubble-render-mode', state.bubbleRenderMode);
    _refreshBubbleEditButtons();
}

export function onBubbleRenderModeChange(): void {
    state.bubbleRenderMode = getBubbleRenderModeFromDom();
    applyBubbleRenderModeToDom();
    scheduleWorkspaceUI();
    if (state.bubbleRenderMode === 'api') {
        showToast('已切换到"由图像API绘制气泡"模式, 跳过本地PIL, 不可编辑气泡位置', 'info');
    } else {
        showToast('已切换到"本地PIL叠加"模式', 'info');
    }
}

/* ============================================================
 * API 配置 (保存 / 加载 / 预设 / 测试)
 * ============================================================ */

export function applyPreset(preset: string): void {
    if (preset === 'volc') {
        // 火山引擎 v3 预设: MiniMax 文本 + 豆包图像 (用户当前默认配置)
        // API Key 不填, 用户需在火山引擎控制台获取
        (document.getElementById('llm-api-url') as HTMLInputElement).value = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
        (document.getElementById('llm-api-key') as HTMLInputElement).value = '';
        (document.getElementById('llm-model') as HTMLInputElement).value = 'MiniMax-M3-250227';
        (document.getElementById('img-api-url') as HTMLInputElement).value = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
        (document.getElementById('img-api-key') as HTMLInputElement).value = '';
        (document.getElementById('img-model') as HTMLInputElement).value = 'doubao-seedream-3-0-t2i-250415';
        showToast('火山引擎 v3 预设已应用，请填写 API Key！', 'success');
    } else if (preset === 'openai') {
        (document.getElementById('llm-api-url') as HTMLInputElement).value = 'https://api.openai.com/v1/chat/completions';
        (document.getElementById('img-api-url') as HTMLInputElement).value = 'https://api.openai.com/v1/images/generations';
        (document.getElementById('llm-model') as HTMLInputElement).value = 'gpt-4';
        showToast('OpenAI 预设已应用！', 'success');
    }
}

export function clearConfig(): void {
    (document.getElementById('llm-api-url') as HTMLInputElement).value = '';
    (document.getElementById('llm-api-key') as HTMLInputElement).value = '';
    (document.getElementById('llm-model') as HTMLInputElement).value = '';
    (document.getElementById('img-api-url') as HTMLInputElement).value = '';
    (document.getElementById('img-api-key') as HTMLInputElement).value = '';
    (document.getElementById('img-model') as HTMLInputElement).value = '';
    localStorage.removeItem('manga_config');
    const llmRes = document.getElementById('test-llm-result');
    if (llmRes) llmRes.innerHTML = '';
    const imgRes = document.getElementById('test-image-result');
    if (imgRes) imgRes.innerHTML = '';
    showToast('配置已清空！', 'success');
}

export async function testLLM(): Promise<void> {
    const btn = document.getElementById('test-llm-btn');
    const spinner = document.getElementById('test-llm-spinner');
    const resultDiv = document.getElementById('test-llm-result');

    (btn as HTMLButtonElement).disabled = true;
    spinner?.classList.remove('hidden');
    if (resultDiv) resultDiv.innerHTML = '';

    createProgressBar('test-llm-progress');
    startFakeProgress('test-llm-progress-bar', 'test-llm-progress-text', 2000);

    try {
        const response = await fetchWithRetry('/api/test-llm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                api_url: (document.getElementById('llm-api-url') as HTMLInputElement).value,
                api_key: (document.getElementById('llm-api-key') as HTMLInputElement).value,
                model: (document.getElementById('llm-model') as HTMLInputElement).value
            })
        });

        const result: any = await response.json();
        finishProgress('test-llm-progress-bar', 'test-llm-progress-text');
        if (result.success) {
            if (resultDiv) resultDiv.innerHTML = `<div class="p-3 bg-green-50 border border-green-200 text-green-700 rounded"><span data-icon="check-circle" class="inline-block align-middle mr-1" style="color:#16a34a;width:14px;height:14px;"></span> ${result.message}</div>`;
            showToast('LLM API测试成功！', 'success');
        } else {
            if (resultDiv) resultDiv.innerHTML = `<div class="p-3 bg-red-50 border border-red-200 text-red-700 rounded"><span data-icon="x-circle" class="inline-block align-middle mr-1" style="color:#dc2626;width:14px;height:14px;"></span> ${result.error}</div>`;
            showToast('LLM API测试失败', 'error');
        }
    } catch (e: any) {
        finishProgress('test-llm-progress-bar', 'test-llm-progress-text');
        if (resultDiv) resultDiv.innerHTML = `<div class="p-3 bg-red-50 border border-red-200 text-red-700 rounded"><span data-icon="x-circle" class="inline-block align-middle mr-1" style="color:#dc2626;width:14px;height:14px;"></span> 请求失败：${e.message}</div>`;
        showToast('LLM API测试失败', 'error');
    } finally {
        (btn as HTMLButtonElement).disabled = false;
        spinner?.classList.add('hidden');
    }
}

export async function testImage(): Promise<void> {
    const btn = document.getElementById('test-image-btn');
    const spinner = document.getElementById('test-image-spinner');
    const resultDiv = document.getElementById('test-image-result');

    (btn as HTMLButtonElement).disabled = true;
    spinner?.classList.remove('hidden');
    if (resultDiv) resultDiv.innerHTML = '';

    createProgressBar('test-image-progress');
    startFakeProgress('test-image-progress-bar', 'test-image-progress-text', 2000);

    try {
        const response = await fetchWithRetry('/api/test-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                api_url: (document.getElementById('img-api-url') as HTMLInputElement).value,
                api_key: (document.getElementById('img-api-key') as HTMLInputElement).value,
                model: (document.getElementById('img-model') as HTMLInputElement).value
            })
        });

        const result: any = await response.json();
        finishProgress('test-image-progress-bar', 'test-image-progress-text');
        if (result.success) {
            if (resultDiv) resultDiv.innerHTML = `<div class="p-3 bg-green-50 border border-green-200 text-green-700 rounded"><span data-icon="check-circle" class="inline-block align-middle mr-1" style="color:#16a34a;width:14px;height:14px;"></span> ${result.message}</div>`;
            showToast('Image API测试成功！', 'success');
        } else {
            if (resultDiv) resultDiv.innerHTML = `<div class="p-3 bg-red-50 border border-red-200 text-red-700 rounded"><span data-icon="x-circle" class="inline-block align-middle mr-1" style="color:#dc2626;width:14px;height:14px;"></span> ${result.error}</div>`;
            showToast('Image API测试失败', 'error');
        }
    } catch (e: any) {
        finishProgress('test-image-progress-bar', 'test-image-progress-text');
        if (resultDiv) resultDiv.innerHTML = `<div class="p-3 bg-red-50 border border-red-200 text-red-700 rounded"><span data-icon="x-circle" class="inline-block align-middle mr-1" style="color:#dc2626;width:14px;height:14px;"></span> 请求失败：${e.message}</div>`;
        showToast('Image API测试失败', 'error');
    } finally {
        (btn as HTMLButtonElement).disabled = false;
        spinner?.classList.add('hidden');
    }
}

export async function saveConfig(): Promise<void> {
    const config: any = {
        llm_api_url: (document.getElementById('llm-api-url') as HTMLInputElement).value,
        llm_api_key: (document.getElementById('llm-api-key') as HTMLInputElement).value,
        llm_model: (document.getElementById('llm-model') as HTMLInputElement).value,
        img_api_url: (document.getElementById('img-api-url') as HTMLInputElement).value,
        img_api_key: (document.getElementById('img-api-key') as HTMLInputElement).value,
        img_model: (document.getElementById('img-model') as HTMLInputElement).value,
        segments_per_page: (() => {
            const v = parseInt((document.getElementById('segments-per-page') as HTMLInputElement).value);
            return isNaN(v) ? 0 : v;  // 0 = LLM 自由控制
        })(),
        negative_prompt: (document.getElementById('negative-prompt') as HTMLTextAreaElement).value,
        reference_strength: (() => {
            const v = parseFloat((document.getElementById('reference-strength') as HTMLInputElement | null)?.value || '');
            return isNaN(v) ? 0.6 : Math.max(0, Math.min(1, v));
        })(),
        style_preset_ids: Array.from(state.selectedPresetIds),
        custom_style_tags: state.customStyleTags.slice(),
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

export async function loadConfig(): Promise<void> {
    // 先尝试从服务端加载配置
    try {
        const response = await fetch('/api/load-config', { credentials: 'include' });
        if (response.ok) {
            const serverConfig: any = await response.json();
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

export function applyConfigToForm(config: any): void {
    (document.getElementById('llm-api-url') as HTMLInputElement).value = config.llm_api_url || '';
    (document.getElementById('llm-api-key') as HTMLInputElement).value = config.llm_api_key || '';
    (document.getElementById('llm-model') as HTMLInputElement).value = config.llm_model || '';
    (document.getElementById('img-api-url') as HTMLInputElement).value = config.img_api_url || '';
    (document.getElementById('img-api-key') as HTMLInputElement).value = config.img_api_key || '';
    (document.getElementById('img-model') as HTMLInputElement).value = config.img_model || '';
    // 0 = LLM 自由控制; 旧配置没有该字段时默认 0
    const spp = (config.segments_per_page !== undefined) ? config.segments_per_page : 0;
    (document.getElementById('segments-per-page') as HTMLInputElement).value = String(spp);
    (document.getElementById('negative-prompt') as HTMLTextAreaElement).value = config.negative_prompt || '';
    const rsEl = document.getElementById('reference-strength') as HTMLInputElement | null;
    if (rsEl) {
        rsEl.value = String(config.reference_strength ?? 0.6);
        const rsLabel = document.getElementById('reference-strength-value');
        if (rsLabel) rsLabel.textContent = parseFloat(rsEl.value).toFixed(2);
    }

    // 恢复风格Tag选择
    // 日漫默认 日式ACG 画风: 配置里没存 style_preset_ids 时给 ['acg']
    const presetIds = (config.style_preset_ids && config.style_preset_ids.length > 0)
        ? config.style_preset_ids
        : ['acg'];
    state.selectedPresetIds = new Set(presetIds);
    state.customStyleTags = (config.custom_style_tags || []).slice();
    state.comicMode = (config.comic_mode === 'color') ? 'color' : 'bw';
    applyComicModeToDom();
    state.bubbleRenderMode = (config.bubble_render_mode === 'api') ? 'api' : 'pil';
    applyBubbleRenderModeToDom();
    renderStylePresets();
    renderCustomStyleTags();
    updateStyleSummary();
}

/* ============================================================
 * 小说输入框 <-> AI 写作工作台 双向实时同步
 * ============================================================ */

export function updateCharCount(): void {
    const text = (document.getElementById('novel-text') as HTMLTextAreaElement).value;
    const cc = document.getElementById('char-count');
    if (cc) cc.textContent = String(text.length);
    markDirty();
    scheduleWorkspaceUI();
}

export function updateAiwriteCharCount(): void {
    const t = document.getElementById('aiwrite-text') as HTMLTextAreaElement | null;
    const el = document.getElementById('aiwrite-char-count');
    if (t && el) el.textContent = String(t.value.length);
}

// ===== 小说输入框 <-> AI 写作工作台 双向实时同步 =====
// 两个 textarea 不会同时可见, 无光标跳动问题; 守卫 + 值相等早退避免循环
export function mirrorNovelText(): void {           // novel -> aiwrite
    if (state._textSyncing) return;
    const s = document.getElementById('novel-text') as HTMLTextAreaElement | null;
    const d = document.getElementById('aiwrite-text') as HTMLTextAreaElement | null;
    if (!s || !d || s.value === d.value) return;
    state._textSyncing = true;
    d.value = s.value;
    state._textSyncing = false;
    updateAiwriteCharCount();
}

export function mirrorAiwriteText(): void {         // aiwrite -> novel
    if (state._textSyncing) return;
    const s = document.getElementById('aiwrite-text') as HTMLTextAreaElement | null;
    const d = document.getElementById('novel-text') as HTMLTextAreaElement | null;
    if (!s || !d || s.value === d.value) return;
    state._textSyncing = true;
    d.value = s.value;
    state._textSyncing = false;
    updateCharCount();
}

/* ============================================================
 * AI 写作作用域: 同一套续写/润色逻辑服务「AI 写作」页(默认)与「小说输入」页
 * scope 'aiwrite' → 用现有无前缀元素; scope 'input' → 用小说输入页的 inp- 前缀元素
 * ============================================================ */

export function awId(scope: string, key: string): string | undefined {
    const map: any = scope === 'input' ? {
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

export function awEl(scope: string, key: string): HTMLElement | null {
    const id = awId(scope, key);
    return id ? document.getElementById(id) : null;
}

export function awReadText(scope: string): string {
    const el = awEl(scope, 'text') as HTMLTextAreaElement | null;
    return el ? el.value : '';
}

export function awApplyText(scope: string, newValue: string): void {
    if (scope === 'input') {
        (document.getElementById('novel-text') as HTMLTextAreaElement).value = newValue;
        mirrorNovelText();
        updateCharCount();
    } else {
        (document.getElementById('aiwrite-text') as HTMLTextAreaElement).value = newValue;
        mirrorAiwriteText();
        updateAiwriteCharCount();
    }
}

// 小说输入页的 AI 写作折叠区
export function toggleInpAIWrite(): void {
    const content = document.getElementById('inp-aw-content');
    const icon = document.getElementById('inp-aw-toggle-icon');
    if (!content) return;
    const hidden = content.classList.toggle('hidden');
    if (icon) icon.textContent = hidden ? '▼' : '▲';
}

/* ============================================================
 * AI 续写: 生成剧情选项 → 选择/自定义方向 → 续写
 * ============================================================ */

export async function genPlotOptions(scope: string = 'aiwrite'): Promise<void> {
    const text = awReadText(scope).trim();
    if (!text) {
        showToast('请先输入小说内容', 'error');
        return;
    }

    const config: any = JSON.parse(localStorage.getItem('manga_config') || '{}');
    if (!config.llm_api_url) {
        showToast('请先配置大语言模型API', 'error');
        openConfigModal();
        return;
    }

    const btn = awEl(scope, 'genOptionsBtn');
    const labelEl = awEl(scope, 'genOptionsLabel');
    const spinner = awEl(scope, 'genOptionsSpinner');
    spinner?.classList.remove('hidden');
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
        const result: any = await response.json();
        dismissLoadingToast(toastId);
        if (result.success && Array.isArray(result.options) && result.options.length > 0) {
            state._plotOptions = result.options;
            renderPlotOptions(scope);
            showToast('已生成剧情方向，点击选择一个', 'success');
        } else {
            showToast(result.error || '剧情方向生成失败', 'error');
        }
    } catch (e: any) {
        dismissLoadingToast(toastId);
        showToast('生成失败: ' + e.message, 'error');
    } finally {
        spinner?.classList.add('hidden');
        unlock();
    }
}

export function renderPlotOptions(scope: string = 'aiwrite'): void {
    const container = awEl(scope, 'plotOptions');
    if (!container) return;
    container.innerHTML = '';
    state._plotOptions.forEach((opt: string, idx: number) => {
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

export function selectPlotOption(idx: number, scope: string = 'aiwrite'): void {
    const opt = state._plotOptions[idx];
    if (!opt) return;
    const dirInput = awEl(scope, 'direction') as HTMLTextAreaElement | HTMLInputElement | null;
    if (dirInput) dirInput.value = opt;
    // 高亮选中卡片 (只作用于当前作用域的卡片)
    const plotId = awId(scope, 'plotOptions');
    if (!plotId) return;
    document.querySelectorAll(`#${plotId} .plot-option-card`).forEach((el: any, i: number) => {
        el.classList.toggle('border-black', i === idx);
        el.classList.toggle('bg-gray-100', i === idx);
        el.classList.toggle('border-gray-300', i !== idx);
    });
}

export async function continueNovel(scope: string = 'aiwrite'): Promise<void> {
    const text = awReadText(scope).trim();
    if (!text) {
        showToast('请先输入小说内容', 'error');
        return;
    }

    const config: any = JSON.parse(localStorage.getItem('manga_config') || '{}');
    if (!config.llm_api_url) {
        showToast('请先配置大语言模型API', 'error');
        openConfigModal();
        return;
    }

    const length = parseInt((awEl(scope, 'length') as HTMLInputElement | null)?.value || '800', 10);
    const direction = ((awEl(scope, 'direction') as HTMLTextAreaElement | HTMLInputElement | null)?.value || '').trim();

    const btn = awEl(scope, 'continueBtn');
    const labelEl = awEl(scope, 'continueLabel');
    const spinner = awEl(scope, 'continueSpinner');
    spinner?.classList.remove('hidden');
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
        const result: any = await response.json();
        dismissLoadingToast(toastId);
        if (result.success && result.continuation) {
            awApplyText(scope, awReadText(scope).trimEnd() + '\n\n' + result.continuation);
            const ta = awEl(scope, 'text') as HTMLTextAreaElement | null;
            if (ta) ta.scrollTop = ta.scrollHeight;
            const total = awReadText(scope).length;
            const n = result.length || result.continuation.length;
            const extra: string[] = [];
            if (result.compressed) extra.push('原文过长已用模型压缩前情上下文');
            if (total > 4000) extra.push('分镜可能只取头尾各2000字');
            const note = extra.length ? '，' + extra.join('，') : '';
            showToast(`已续写 ${n} 字（当前共 ${total} 字）${note}`, 'success');
            // 续写完成, 清空已选的剧情选项, 避免下次使用过期方向
            state._plotOptions = [];
            renderPlotOptions(scope);
            // 续写后自动保存到写作历史
            const w: any = window;
            if (typeof w.autoSaveWriting === 'function') w.autoSaveWriting();
        } else {
            showToast(result.error || '续写失败', 'error');
        }
    } catch (e: any) {
        dismissLoadingToast(toastId);
        showToast('续写失败: ' + e.message, 'error');
    } finally {
        spinner?.classList.add('hidden');
        unlock();
    }
}

/* ============================================================
 * AI 润色: 生成润色风格 → 选择/自定义 → 润色 → 对比预览 → 替换
 * ============================================================ */

export async function genPolishStyles(scope: string = 'aiwrite'): Promise<void> {
    const text = awReadText(scope).trim();
    if (!text) {
        showToast('请先输入小说内容', 'error');
        return;
    }

    const config: any = JSON.parse(localStorage.getItem('manga_config') || '{}');
    if (!config.llm_api_url) {
        showToast('请先配置大语言模型API', 'error');
        openConfigModal();
        return;
    }

    const btn = awEl(scope, 'genStylesBtn');
    const labelEl = awEl(scope, 'genStylesLabel');
    const spinner = awEl(scope, 'genStylesSpinner');
    spinner?.classList.remove('hidden');
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
        const result: any = await response.json();
        dismissLoadingToast(toastId);
        if (result.success && Array.isArray(result.styles) && result.styles.length > 0) {
            state._polishStyles = result.styles;
            renderPolishStyles(scope);
            showToast('已生成润色风格，点击选择一个', 'success');
        } else {
            showToast(result.error || '润色风格生成失败', 'error');
        }
    } catch (e: any) {
        dismissLoadingToast(toastId);
        showToast('生成失败: ' + e.message, 'error');
    } finally {
        spinner?.classList.add('hidden');
        unlock();
    }
}

export function renderPolishStyles(scope: string = 'aiwrite'): void {
    const container = awEl(scope, 'polishStyles');
    if (!container) return;
    container.innerHTML = '';
    state._polishStyles.forEach((style: any, idx: number) => {
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

export function selectPolishStyle(idx: number, scope: string = 'aiwrite'): void {
    const style = state._polishStyles[idx];
    if (!style) return;
    const input = awEl(scope, 'polishStyle') as HTMLTextAreaElement | HTMLInputElement | null;
    if (input) input.value = style.instruction;
    // 高亮选中卡片
    const polishId = awId(scope, 'polishStyles');
    if (!polishId) return;
    document.querySelectorAll(`#${polishId} .polish-style-card`).forEach((el: any, i: number) => {
        el.classList.toggle('border-black', i === idx);
        el.classList.toggle('bg-gray-100', i === idx);
        el.classList.toggle('border-gray-300', i !== idx);
    });
}

export async function polishNovel(scope: string = 'aiwrite'): Promise<void> {
    const text = awReadText(scope).trim();
    if (!text) {
        showToast('请先输入小说内容', 'error');
        return;
    }

    const config: any = JSON.parse(localStorage.getItem('manga_config') || '{}');
    if (!config.llm_api_url) {
        showToast('请先配置大语言模型API', 'error');
        openConfigModal();
        return;
    }

    // 捕获润色前的原文, 用于对比预览; 记录作用域以便确认时回写
    state._polishOriginal = awReadText(scope);
    state._polishScope = scope;

    if (text.length > 8000) {
        showToast('内容较长，润色可能需要 1-3 分钟', 'info');
    }

    const style = ((awEl(scope, 'polishStyle') as HTMLTextAreaElement | HTMLInputElement | null)?.value || '').trim();
    const btn = awEl(scope, 'polishBtn');
    const labelEl = awEl(scope, 'polishLabel');
    const spinner = awEl(scope, 'polishSpinner');
    spinner?.classList.remove('hidden');
    const unlock = lockButton(btn, labelEl, '润色中…');

    // 分块润色可能耗时较长, 用进度条展示
    const progressId = awId(scope, 'progress') || 'polish-progress';
    const task = registerTaskProgress(progressId);
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
        const result: any = await response.json();
        task.finish();
        if (result.success && result.polished) {
            state._polishResult = result.polished;
            openPolishCompare();
        } else {
            showToast(result.error || '润色失败', 'error');
        }
    } catch (e: any) {
        task.finish();
        showToast('润色失败: ' + e.message, 'error');
    } finally {
        spinner?.classList.add('hidden');
        unlock();
    }
}

export function openPolishCompare(): void {
    const modal = document.getElementById('polish-compare-modal');
    if (!modal) return;
    const origEl = document.getElementById('polish-original');
    if (origEl) origEl.textContent = state._polishOriginal;
    const resEl = document.getElementById('polish-result');
    if (resEl) resEl.textContent = state._polishResult;
    const t: any = (window as any).__t2cTransitions;
    if (t) {
        t.openModal('polish-compare-modal');
    } else {
        modal.classList.remove('modal-closing', 'hidden');
    }
}

export function cancelPolishCompare(): void {
    const w: any = window;
    if (typeof w.closeModalA11y === 'function') w.closeModalA11y('polish-compare-modal');
    if (typeof w.animateCloseModal === 'function') w.animateCloseModal('polish-compare-modal');
}

export function confirmPolishReplace(): void {
    const scope = state._polishScope || 'aiwrite';
    // 润色期间原文可能被改过, 提醒用户
    if (awReadText(scope) !== state._polishOriginal && !confirm('原文在润色期间被修改过，确定用润色稿覆盖吗？')) {
        return;
    }
    awApplyText(scope, state._polishResult);
    cancelPolishCompare();
    const total = awReadText(scope).length;
    showToast(`润色完成并已替换（当前共 ${total} 字）`, 'success');
    // 清理已生成的风格, 避免下次使用过期风格
    state._polishStyles = [];
    renderPolishStyles(scope);
    // 润色替换后自动保存到写作历史
    const w: any = window;
    if (typeof w.autoSaveWriting === 'function') w.autoSaveWriting();
}

/* ============================================================
 * 工作台初始化 (在 main.ts 的 DOMContentLoaded 中调用)
 * ============================================================ */

export function initWorkspace(): void {
    workMetaInit();

    // 镜像输入监听: novel-text / aiwrite-text 双向同步
    const novelEl = document.getElementById('novel-text');
    if (novelEl) {
        novelEl.addEventListener('input', () => {
            updateCharCount();
            mirrorNovelText();
        });
    }
    const aiwriteEl = document.getElementById('aiwrite-text');
    if (aiwriteEl) {
        aiwriteEl.addEventListener('input', () => {
            updateAiwriteCharCount();
            mirrorAiwriteText();
        });
    }

    // 初次渲染: 风格 / 模式 / 字数
    renderStylePresets();
    renderCustomStyleTags();
    applyComicModeToDom();
    applyBubbleRenderModeToDom();
    // 日漫默认 日式ACG 画风 (无本地配置时)
    if (!localStorage.getItem('manga_config')) {
        state.selectedPresetIds = new Set(['acg']);
    }
    renderStylePresets();
    updateStyleSummary();
    updateCharCount();
    mirrorNovelText();
}
