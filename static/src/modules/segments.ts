/**
 * 分镜管理: 渲染 / 编辑 / 单页生成 / 批量生成 / 暂停-继续-停止
 *  startSegment: 从小说正文触发"开始智能分镜"
 *  generateFullPage: 单页整页生成
 *  generateAllFullPages: 批量生成 (含暂停/停止)
 */

import { state } from './state';
import { escapeHtml, playStagger, emptyState } from './ui';
import { showToast, showLoadingToast, dismissLoadingToast } from './toast';
import { fetchWithRetry, lockButton, syncResults } from './api';
import { registerTaskProgress } from './progress';
import { openConfigModal } from './modals';
import { switchTab } from './tabs';

export async function startSegment(): Promise<void> {
    const text = (document.getElementById('novel-text') as HTMLTextAreaElement).value.trim();
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

    const spinner = document.getElementById('segment-spinner');
    spinner?.classList.remove('hidden');

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
                comic_mode: state.comicMode,
                task_id: task.task_id
            })
        });

        const result: any = await response.json();
        task.finish();
        if (result.success) {
            // 任务5: 新分镜 = 新作品, 先清空前次的图片缓存 (旧图、引用图、work/images)
            try {
                await fetchWithRetry('/api/clear-cache', { method: 'POST', credentials: 'include' }, 1);
            } catch (e: any) { console.log('clear-cache skipped:', e.message); }
            state.generatedImages = {};
            state.fullPageImages = {};
            state.combinedPageImages = {};
            state.fullPageCleanImages = {};
            state.fullPageBubbles = {};
            // 清空角色人设图（新小说的人物形象可能不同）
            state.characters.forEach((c: any) => { c.image_url = ''; c.char_prompt = ''; });
            const w: any = window;
            if (typeof w.renderGallery === 'function') w.renderGallery();

            state.currentSegments = result.data;
            // 任务4: 一次 LLM 调用同时拿到分镜 + 角色
            const newChars = Array.isArray(result.characters) ? result.characters : [];
            const hadChars = state.characters && state.characters.length > 0;
            if (newChars.length > 0) {
                if (!hadChars) {
                    state.characters = newChars;
                } else {
                    const existing = new Set(state.characters.map((c: any) => (c.name || '').trim()));
                    for (const c of newChars) {
                        if (c && c.name && !existing.has((c.name || '').trim())) {
                            state.characters.push(c);
                        }
                    }
                }
                if (typeof w.renderCharacters === 'function') w.renderCharacters();
                syncResults();
            }
            renderSegments();
            syncResults();
            const charCount = newChars.length;
            const charMsg = charCount > 0 ? `，并自动提取 ${charCount} 个角色` : '';
            showToast(`成功生成 ${state.currentSegments.pages.length} 页分镜${charMsg}，旧图片已清除`, 'success');
            // 任务5: 自动保存到当前作品
            if (typeof w.saveCurrentState === 'function') {
                w.saveCurrentState().catch((e: any) => console.log('auto save work error:', e));
            }
            if (newChars.length > 0) {
                switchTab('characters');
            } else {
                switchTab('segments');
            }
        } else {
            showToast(result.error || '分镜失败', 'error');
        }
    } catch (e: any) {
        task.finish();
        showToast('请求失败: ' + e.message, 'error');
    } finally {
        spinner?.classList.add('hidden');
        unlock();
    }
}

export function renderSegments(): void {
    const container = document.getElementById('segments-container');
    if (!container) return;
    // 重新渲染前清掉 stagger 标记, 让下次 playStagger 能再触发级联
    const t: any = (window as any).__t2cTransitions;
    if (t) t.resetStagger(container);
    if (!state.currentSegments.pages || state.currentSegments.pages.length === 0) {
        container.innerHTML = emptyState(
            'note',
            '还没有分镜',
            '回到「小说输入」粘贴正文，点「开始智能分镜」，模型会按情节切页分格，并给每句对白挑一种语气。',
            { onclick: "switchTab('input')", label: '去输入小说' }
        );
        return;
    }

    container.innerHTML = state.currentSegments.pages.map((page: any, pageIdx: number) => {
        const hasFullPageImage = state.fullPageImages[pageIdx];
        const allSelectedChars: number[] = [];
        page.segments.forEach((seg: any) => {
            if (seg.selected_characters) {
                seg.selected_characters.forEach((cIdx: number) => {
                    if (!allSelectedChars.includes(cIdx)) {
                        allSelectedChars.push(cIdx);
                    }
                });
            }
        });

        return `
        <div class="comic-page p-5 md:p-6">
            <div class="flex flex-wrap justify-between items-center gap-3 mb-4 pb-3 border-b-2 border-[#111112]">
                <h3 class="text-base md:text-lg font-black flex items-center gap-2">
                    <span class="ink-badge mono">PAGE ${String(page.page_number).padStart(2, '0')}</span>
                    <span>第 ${page.page_number} 页</span>
                </h3>
                <div class="flex gap-2">
                    <button onclick="generateFullPage(${pageIdx}, false, null, this)" class="btn-primary text-xs md:text-sm px-4 py-1.5">
                        <span>整页生成</span>
                        <span id="full-page-spinner-${pageIdx}" class="loading-spinner hidden" style="width:13px;height:13px;border-width:2px;"></span>
                    </button>
                </div>
            </div>
            <div id="fullpage-progress-${pageIdx}" class="mb-3"></div>
            ${hasFullPageImage ? `
            <div class="mb-6 border-2 border-[#111112] p-2 bg-[#f7f6f2]">
                <div class="text-xs font-bold text-[#15803d] mb-2 flex items-center gap-1.5"><span data-icon="check-circle" class="ico-14"></span>本页已生成整页漫画（点击大图预览）</div>
                <img src="${hasFullPageImage}" class="w-full cursor-pointer border border-[#d4d1c7]" onclick="openModal('${hasFullPageImage}')">
            </div>
            ` : ''}
            <div class="text-xs text-[#4e4e54] bg-[#f7f6f2] border border-[#e6e3da] px-3 py-1.5 mb-4">
                <span class="font-bold text-[#111112]">本页出场角色：</span>${allSelectedChars.length > 0 ? allSelectedChars.map((cIdx: number) => escapeHtml(state.characters[cIdx]?.name || cIdx)).join('、') : '（未指定角色，生成时将自动参考全部角色）'}
            </div>
            <div class="grid md:grid-cols-2 gap-4">
                ${page.segments.map((seg: any, segIdx: number) => {
                    const key = `${pageIdx}-${segIdx}`;
                    const selectedChars = seg.selected_characters || [];
                    // 任务2: 镜头语言枚举选项 (与服务端 STYLE_TAG_MAP 一致)
                    const camOpts = ['俯视','仰视','平视','斜视','主观视角'];
                    const compOpts = ['三分法','对称','中心对称','框架式','引导线'];
                    const moodOpts = ['紧张','紫蓝','紫红','暧昧','悲伤','温馨','压抑','恐怖'];
                    const scaleOpts = ['大远景','远景','全景','中景','近景','特写','大特写'];
                    const lightOpts = ['硬光','背光','顶光','荧光灯','光斑','柔光','侧光','剪影'];
                    const typeOpts = ['静态','动态','回忆','梦境'];
                    const optHtml = (opts: string[], cur: string) => `<option value=''>(无)</option>` + opts.map(o => `<option ${o===cur?'selected':''}>${o}</option>`).join('');
                    return `
                    <div class="segment-box p-4 relative" id="segment-${key}">
                        <div class="flex justify-between items-start mb-2">
                            <span class="text-xs font-bold bg-black text-white px-2 py-1">分镜 ${seg.segment_number}</span>
                            <span class="text-xs text-gray-500">${seg.shot_type || '未指定'}</span>
                        </div>
                        <div class="mb-2">
                            <label class="text-xs text-gray-500 font-medium">出场角色 (参考图)</label>
                            <div class="flex flex-wrap gap-2 mt-1">
                                ${state.characters.length === 0 ? `
                                    <span class="text-xs text-gray-400">请先到"角色管理"生成角色</span>
                                ` : state.characters.map((char: any, charIdx: number) => {
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
                                        ${escapeHtml(char.name)}${refState === 'image' ? ' ▣' : refState === 'text' ? ' 📝' : ' (无)'}
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
    const w: any = window;
    if (typeof w.scheduleWorkspaceUI === 'function') w.scheduleWorkspaceUI();
}

export function updateSegment(pageIdx: number, segIdx: number, field: string, value: any): void {
    state.currentSegments.pages[pageIdx].segments[segIdx][field] = value;
}

export function toggleCharacter(pageIdx: number, segIdx: number, charIdx: number): void {
    if (!state.currentSegments.pages[pageIdx].segments[segIdx].selected_characters) {
        state.currentSegments.pages[pageIdx].segments[segIdx].selected_characters = [];
    }
    const selected = state.currentSegments.pages[pageIdx].segments[segIdx].selected_characters;
    const idx = selected.indexOf(charIdx);
    if (idx > -1) {
        selected.splice(idx, 1);
    } else {
        selected.push(charIdx);
    }
    renderSegments();
}

/* ============================================================
 * 单页整页生成
 * ============================================================ */

export async function generateFullPage(pageIdx: number, skipLock: boolean = false, previousPageImage: string | null = null, btn: HTMLButtonElement | null = null): Promise<void> {
    if (!skipLock && state.isGenerating) {
        showToast('请等待当前生成完成', 'error');
        return;
    }

    const config: any = JSON.parse(localStorage.getItem('manga_config') || '{}');
    if (!config.img_api_url) {
        showToast('请先配置图像生成API', 'error');
        openConfigModal();
        return;
    }

    if (!skipLock) state.isGenerating = true;
    const w: any = window;
    if (typeof w.scheduleWorkspaceUI === 'function') w.scheduleWorkspaceUI();
    const spinner = document.getElementById(`full-page-spinner-${pageIdx}`);
    if (spinner) spinner.classList.remove('hidden');
    // 动态按钮, 用 lockButton 锁住避免连点
    const targetBtn = btn || document.querySelector(`#panel-segments button[onclick*="generateFullPage(${pageIdx}"]`) as HTMLButtonElement | null;
    const labelEl = targetBtn ? targetBtn.querySelector('span:not([id*="spinner"])') as HTMLElement | null : null;
    const unlock = lockButton(targetBtn, labelEl, '整页生成中…');

    const page = state.currentSegments.pages[pageIdx];

    // 自动取上一页整页图作为参考 (若调用方未显式传入)
    // 这样单页生成时也能保持人物和画风一致
    if (!previousPageImage && pageIdx > 0) {
        previousPageImage = state.fullPageImages[pageIdx - 1] || null;
        if (previousPageImage) {
            console.log(`[generateFullPage] Auto-using previous page ${pageIdx} image as reference: ${previousPageImage}`);
        }
    }

    // 参考角色: 优先用本页每个 segment 用户勾选的角色 union (per-panel 角色白名单);
    // 没勾选过任何角色时, 回退到全角色 (保持向后兼容)。
    // 这样未勾选的角色就不会污染 prompt 和 reference 列表, 也能省 base64 payload。
    const pageSel = new Set<number>();
    (page.segments || []).forEach((seg: any) => {
        (seg.selected_characters || []).forEach((i: number) => {
            if (Number.isInteger(i)) pageSel.add(i);
        });
    });
    const idxList = pageSel.size > 0 ? [...pageSel] : state.characters.map((_: any, i: number) => i);
    const characterReferences = idxList.map(i => {
        const char = state.characters[i];
        if (!char) return null;
        const ref: any = {
            name: char.name,
            description: char.description,
            char_prompt: char.char_prompt || ''
        };
        if (char.image_url) ref.image_url = char.image_url;
        return ref;
    }).filter(Boolean);

    // 任务进度条 (单页生成, 仅在非批量模式下显示)
    let task: any = null;
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
                style_tags: (window as any).getStyleTagsString ? (window as any).getStyleTagsString() : '',
                comic_mode: state.comicMode,
                bubble_render_mode: state.bubbleRenderMode,
                character_references: characterReferences,
                references: characterReferences,  // 兼容新字段名
                reference_strength: (config.reference_strength ?? 0.6),
                previous_page_image: previousPageImage,
                page_idx: pageIdx,
                task_id: task ? task.task_id : ''
            })
        });

        const result: any = await response.json();
        if (task) task.finish();
        if (result.success) {
            let finalImageUrl = result.image_url;
            state.fullPageImages[pageIdx] = finalImageUrl;
            if (result.clean_image_url) state.fullPageCleanImages[pageIdx] = result.clean_image_url;
            if (result.bubbles) state.fullPageBubbles[pageIdx] = result.bubbles;
            renderSegments();
            if (typeof w.renderGallery === 'function') w.renderGallery();
            syncResults();  // 同步到 session(供断网恢复)
            // 关键修复: 同时持久化到当前作品, 避免单页生成后 state.json 不更新
            // 用户只有刷新页面/重新登录才会发现图丢了; 现在生成即落盘
            if (typeof w.saveCurrentState === 'function') {
                w.saveCurrentState().catch((e: any) => console.warn('save work after page gen failed:', e));
            }
            showToast(`第 ${page.page_number} 页整页生成成功`, 'success');
        } else {
            showToast(result.error || '生成失败', 'error');
        }
    } catch (e: any) {
        if (task) task.finish();
        showToast('请求失败: ' + e.message, 'error');
    } finally {
        if (!skipLock) state.isGenerating = false;
        if (typeof w.scheduleWorkspaceUI === 'function') w.scheduleWorkspaceUI();
        if (spinner) spinner.classList.add('hidden');
        unlock();
    }
}

/* ============================================================
 * 批量生成暂停控制
 * ============================================================ */

export function toggleBatchPause(): void {
    state.batchPaused = !state.batchPaused;
    const label = document.getElementById('batch-pause-label');
    const btn = document.getElementById('batch-pause-btn');
    if (state.batchPaused) {
        if (label) label.textContent = '▶️ 继续';
        if (btn) {
            btn.classList.replace('border-yellow-500', 'border-green-500');
            btn.classList.replace('bg-yellow-50', 'bg-green-50');
            btn.classList.replace('text-yellow-700', 'text-green-700');
        }
        showToast('已暂停, 点击继续恢复', 'info');
    } else {
        if (label) label.textContent = '暂停';
        if (btn) {
            btn.classList.replace('border-green-500', 'border-yellow-500');
            btn.classList.replace('bg-green-50', 'bg-yellow-50');
            btn.classList.replace('text-green-700', 'text-yellow-700');
        }
        showToast('继续生成', 'info');
    }
}

/**
 * 在批量循环中检查暂停状态。如果被暂停就原地等待, 直到继续或取消。
 * 返回 false 表示被外部中止 (isGenerating=false 或 batchStopRequested=true)
 */
async function _checkBatchPause(): Promise<boolean> {
    while (state.batchPaused && state.isGenerating && !state.batchStopRequested) {
        await new Promise(r => setTimeout(r, 200));
    }
    return state.isGenerating && !state.batchStopRequested;
}

/**
 * 用户主动停止批量生成
 */
export function stopBatchGenerate(): void {
    if (!state.isGenerating) {
        showToast('当前没有正在进行的生成任务', 'info');
        return;
    }
    if (!confirm('确定要停止当前批量生成吗? 已生成的页面会保留。')) return;
    state.batchStopRequested = true;
    state.batchPaused = false;  // 同时取消暂停, 让循环能跳出
    showToast('正在停止生成, 请稍候...', 'info');
    const stopBtn = document.getElementById('batch-stop-btn');
    if (stopBtn) stopBtn.classList.add('hidden');
}

/**
 * 重新生成所有整页 (清空已有图片, 从头生成)
 */
export async function regenerateAllFullPages(): Promise<void> {
    if (state.isGenerating) {
        showToast('请等待当前生成完成', 'error');
        return;
    }
    if (state.currentSegments.pages.length === 0) {
        showToast('请先生成分镜', 'error');
        return;
    }
    if (Object.keys(state.fullPageImages).length > 0) {
        if (!confirm(`将清空已生成的 ${Object.keys(state.fullPageImages).length} 张整页图片并从头生成, 确定吗?\n\n此操作不可撤销。`)) return;
    }

    // 清空已有整页图
    state.fullPageImages = {};
    state.fullPageCleanImages = {};
    state.fullPageBubbles = {};
    state.generatedImages = {};
    renderSegments();
    const w: any = window;
    if (typeof w.renderGallery === 'function') w.renderGallery();
    syncResults();

    // 调用批量整页生成
    await generateAllFullPages();
}

export async function generateAllFullPages(): Promise<void> {
    if (state.isGenerating) {
        showToast('请等待当前生成完成', 'error');
        return;
    }

    const spinner = document.getElementById('batch-full-spinner');
    spinner?.classList.remove('hidden');
    state.isGenerating = true;
    const w: any = window;
    if (typeof w.scheduleWorkspaceUI === 'function') w.scheduleWorkspaceUI();
    state.batchStopRequested = false;  // 重置停止标志
    const unlock = lockButton(
        document.getElementById('batch-full-btn'),
        document.getElementById('batch-full-label'),
        '批量整页生成中…'
    );

    const pagesToGenerate: number[] = [];
    for (let p = 0; p < state.currentSegments.pages.length; p++) {
        if (!state.fullPageImages[p]) {
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
        state.batchPaused = false;
        const pauseLabel = document.getElementById('batch-pause-label');
        if (pauseLabel) pauseLabel.textContent = '暂停';
        pauseBtn.classList.remove('hidden');
    }
    if (stopBtn) stopBtn.classList.remove('hidden');

    // 串行生成，每页参考上一页漫画和人设图
    let lastPageImage: string | null = null;
    let i = 0;
    let stoppedByUser = false;
    for (i = 0; i < pagesToGenerate.length; i++) {
        // 暂停 + 停止检查
        const shouldContinue = await _checkBatchPause();
        if (!shouldContinue) {
            stoppedByUser = state.batchStopRequested;
            break;
        }

        const p = pagesToGenerate[i];
        await generateFullPage(p, true, lastPageImage);
        await new Promise(r => setTimeout(r, 800));
        lastPageImage = state.fullPageImages[p] || null;
    }

    // 隐藏暂停/停止按钮
    if (pauseBtn) pauseBtn.classList.add('hidden');
    if (stopBtn) stopBtn.classList.add('hidden');
    state.batchPaused = false;
    state.batchStopRequested = false;
    task.finish();

    state.isGenerating = false;
    if (typeof w.scheduleWorkspaceUI === 'function') w.scheduleWorkspaceUI();
    spinner?.classList.add('hidden');
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
    if (Object.keys(state.fullPageImages).length > 0) {
        await autoSaveWorkWithLLMTitle(allDone);
    }

    switchTab('gallery');
}

/**
 * 自动保存作品, 标题用 LLM 分析小说原文生成
 * @param allDone - 是否全部生成完毕 (而非被停止)
 */
export async function autoSaveWorkWithLLMTitle(allDone: boolean): Promise<void> {
    try {
        const novelText = (document.getElementById('novel-text') as HTMLTextAreaElement | null)?.value || '';
        const config: any = JSON.parse(localStorage.getItem('manga_config') || '{}');

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
                const result: any = await resp.json();
                if (result.success || result.title) {
                    title = result.title;
                }
            } catch (e: any) {
                console.warn('LLM 生成标题失败, 使用默认标题:', e);
            }
        }
        if (!title) {
            title = `漫画作品 ${new Date().toLocaleString()}`;
        }

        // 2. 确保有 work_id (没有就创建)
        // saveCurrentState 后端会自动创建, 这里直接调用即可
        // 但 rename-current 需要已有 work_id, 所以先 saveCurrentState
        const w: any = window;
        if (typeof w.saveCurrentState === 'function') {
            await w.saveCurrentState();
        }

        // 3. 用 LLM 生成的标题重命名当前作品
        try {
            const renameResp = await fetchWithRetry('/api/work/rename-current', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ title: title })
            });
            const renameResult: any = await renameResp.json();
            if (renameResult.success) {
                showToast(allDone ? `漫画生成完毕, 已自动保存为「${title}」` : `已停止, 已保存为「${title}」`, 'success');
                // 刷新历史列表
                if (typeof w.loadHistoryList === 'function') w.loadHistoryList();
            } else {
                showToast('已保存作品, 但重命名失败: ' + (renameResult.error || ''), 'info');
            }
        } catch (e: any) {
            console.error('rename-current failed:', e);
            showToast('已保存作品, 但自动命名失败', 'info');
        }
    } catch (e: any) {
        console.error('autoSaveWorkWithLLMTitle failed:', e);
    }
}
