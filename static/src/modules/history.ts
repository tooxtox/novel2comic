/**
 * 历史记录: 漫画作品历史 + AI 写作历史
 *   loadHistoryList / saveCurrentToHistory / loadHistoryWork / deleteHistoryWork / renameHistoryWork
 *   loadWritingHistoryList / autoSaveWriting / saveCurrentWriting / loadWritingWork / renameWritingWork / deleteWritingWork
 *   switchHistorySub / refreshCurrentHistoryList
 */

import { state } from './state';
import { formatDateTime, escapeHtml, emptyState, popIn } from './ui';
import { showToast } from './toast';
import { fetchWithRetry, syncResults } from './api';
import { switchTab } from './tabs';
import { refreshInks } from './tabs';

export async function loadHistoryList(): Promise<void> {
    const container = document.getElementById('history-list');
    const countEl = document.getElementById('history-count');
    const usernameEl = document.getElementById('history-username');
    if (!container) return;

    container.innerHTML = '<div class="col-span-full text-center text-gray-400 py-12"><span class="loading-spinner inline-block align-middle mr-2" style="width:14px;height:14px;border-width:2px;"></span>加载中...</div>';

    try {
        const response = await fetchWithRetry('/api/history', { credentials: 'include' });
        const result: any = await response.json();
        if (!result.success) throw new Error(result.error || '加载失败');

        if (usernameEl) usernameEl.textContent = result.username || '-';
        if (countEl) countEl.textContent = String((result.works || []).length);

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
                const detail: any = await detailResp.json();
                if (detail.success) {
                    const firstImg = (detail.images || [])[0];
                    const title = work.title || '未命名';
                    const created = formatDateTime(work.created_at);
                    const updated = formatDateTime(work.updated_at);
                    const imgCount = (detail.images || []).length;
                    // 缺省即私密: 老作品没有 is_public 字段, 和后端 _is_work_public 保持一致
                    const isPublic = !!(detail.meta && detail.meta.is_public);
                    const visBtn = isPublic
                        ? `border-2 border-black bg-black text-white hover:bg-gray-800`
                        : `border-2 border-gray-300 hover:border-black text-gray-500`;
                    card.innerHTML = `
                        <div class="aspect-video bg-gray-200 mb-3 flex items-center justify-center overflow-hidden">
                            ${firstImg ? `<img src="${firstImg}" class="w-full h-full object-cover" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'text-gray-400 text-sm\\'>无预览</div>'">` : '<div class="text-gray-400 text-sm">无图片</div>'}
                        </div>
                        <h3 class="font-bold text-base mb-1 truncate" title="${escapeHtml(title)}">${escapeHtml(title)}</h3>
                        <p class="text-xs text-gray-500 mb-1"><span data-icon="clock" class="inline-block align-[-2px] mr-1" style="width:11px;height:11px;"></span>创建: ${created}</p>
                        <p class="text-xs text-gray-500 mb-3"><span data-icon="note" class="inline-block align-[-2px] mr-1" style="width:11px;height:11px;"></span>更新: ${updated}</p>
                        <p class="text-xs text-gray-500 mb-3"><span data-icon="image" class="inline-block align-[-2px] mr-1" style="width:11px;height:11px;"></span>${imgCount} 张图片</p>
                        <div class="flex gap-2 mt-auto">
                            <button onclick="loadHistoryWork('${work.work_id}')" class="flex-1 border-2 border-black bg-black text-white px-2 py-1.5 text-xs font-medium hover:bg-gray-800 transition-colors flex items-center justify-center gap-1"><span data-icon="folder-open" style="width:12px;height:12px;"></span>加载</button>
                            <button onclick="toggleWorkVisibility('${work.work_id}')" class="${visBtn} px-2 py-1.5 text-xs transition-colors flex items-center justify-center gap-1" title="${isPublic ? '公开中, 点击改为私密' : '私密, 点击设为公开'}" aria-pressed="${isPublic}"><span data-icon="${isPublic ? 'globe' : 'lock'}" style="width:12px;height:12px;"></span>${isPublic ? '公开' : '私密'}</button>
                            <button onclick="renameHistoryWork('${work.work_id}','${escapeHtml(title)}')" class="border-2 border-gray-300 hover:border-black px-2 py-1.5 text-xs transition-colors" title="重命名"><span data-icon="pencil" style="width:12px;height:12px;"></span></button>
                            <button onclick="deleteHistoryWork('${work.work_id}')" class="border-2 border-gray-300 hover:border-red-500 hover:text-red-500 px-2 py-1.5 text-xs transition-colors" title="删除"><span data-icon="trash" style="width:12px;height:12px;"></span></button>
                        </div>
                    `;
                    const w: any = window;
                    if (typeof w.hydrateIcons === 'function') w.hydrateIcons(card);  // 渲染动态插入的 data-icon 为 SVG
                } else {
                    card.innerHTML = '<div class="text-red-500 text-sm p-4">加载失败</div>';
                }
            } catch (e: any) {
                card.innerHTML = `<div class="text-red-500 text-sm p-4">${escapeHtml(String(e.message || e))}</div>`;
            }
        }
        const w: any = window;
        if (typeof w.hydrateIcons === 'function') w.hydrateIcons(container);  // 兜底: 任何上面漏的也补上
    } catch (e: any) {
        container.innerHTML = `<div class="col-span-full text-center text-red-400 py-12">加载失败: ${escapeHtml(String(e.message || e))}</div>`;
    }
}

export async function startNewWork(title: string | undefined): Promise<any> {
    try {
        const response = await fetchWithRetry('/api/work/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ title })
        });
        const result: any = await response.json();
        if (!result.success) throw new Error(result.error || '创建失败');
        return result;
    } catch (e: any) {
        showToast('创建作品失败: ' + e.message, 'error');
        throw e;
    }
}

/**
 * 切换某个作品的公开/私密 (默认私密).
 * 后端只认 session 里的 owner, 所以这里传 work_id 就够了, 传别人的 id 也只会 404.
 */
export async function toggleWorkVisibility(workId: string): Promise<void> {
    try {
        const response = await fetchWithRetry(`/api/history/${encodeURIComponent(workId)}/visibility`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({})   // 不传 is_public = 取反
        });
        const result: any = await response.json();
        if (!result.success) throw new Error(result.error || '设置失败');
        showToast(result.is_public ? '已设为公开，其他人可以搜到' : '已设为私密', 'success');
        await loadHistoryList();   // 重画列表以同步按钮状态
    } catch (e: any) {
        showToast('切换失败: ' + (e.message || e), 'error');
    }
}

export async function saveCurrentState(): Promise<void> {
    try {
        const response = await fetchWithRetry('/api/work/save-state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                novel_text: (document.getElementById('novel-text') as HTMLTextAreaElement | null)?.value || '',
                segments: state.currentSegments,
                characters: state.characters,
                generated_images: state.generatedImages,
                full_page_images: state.fullPageImages,
                combined_page_images: state.combinedPageImages,
                full_page_clean_images: state.fullPageCleanImages,
                full_page_bubbles: state.fullPageBubbles
            })
        });
        const result: any = await response.json();
        if (!result.success) throw new Error(result.error || '保存失败');
        const w: any = window;
        if (typeof w.markSaved === 'function') w.markSaved();
    } catch (e) {
        console.error('saveCurrentState:', e);
        throw e;
    }
}

export async function saveCurrentToHistory(): Promise<void> {
    const title = prompt('为这部作品起个名字:', `作品 ${new Date().toLocaleString()}`);
    if (title === null) return;
    try {
        const created = await startNewWork(title.trim() || undefined);
        await saveCurrentState();
        const w: any = window;
        if (typeof w.markSaved === 'function') w.markSaved((created && created.title) || title.trim() || '未命名作品');
        showToast('已保存到历史记录', 'success');
        loadHistoryList();
    } catch (e) {
        // 已由startNewWork弹错
    }
}

export async function loadHistoryWork(workId: string): Promise<void> {
    if (!confirm('加载历史作品将覆盖当前内容，确定继续？')) return;
    try {
        // 先调用 load 接口
        await fetchWithRetry(`/api/history/${workId}/load`, {
            method: 'POST',
            credentials: 'include'
        });
        // 拉取完整数据
        const detailResp = await fetchWithRetry(`/api/history/${workId}`, { credentials: 'include' });
        const detail: any = await detailResp.json();
        if (!detail.success) throw new Error(detail.error || '加载失败');

        const st = detail.state || {};
        if (st.novel_text !== undefined) {
            const el = document.getElementById('novel-text') as HTMLTextAreaElement | null;
            if (el) {
                el.value = st.novel_text;
                const w: any = window;
                if (typeof w.updateCharCount === 'function') w.updateCharCount();
                if (typeof w.mirrorNovelText === 'function') w.mirrorNovelText();
            }
        }
        state.currentSegments = st.segments || { pages: [] };
        state.characters = st.characters || [];

        // 重建 generatedImages / fullPageImages / combinedPageImages
        // 注意: 兼容老数据 (save 端可能没写过 combined_page_images, 默认为 {})
        state.generatedImages = {};
        const gis = st.generated_images || {};
        for (const k in gis) state.generatedImages[k] = gis[k];
        state.fullPageImages = {};
        const fps = st.full_page_images || {};
        for (const k in fps) state.fullPageImages[k] = fps[k];
        state.combinedPageImages = {};
        const cps = st.combined_page_images || {};
        for (const k in cps) state.combinedPageImages[k] = cps[k];
        state.fullPageCleanImages = {};
        const fpcs = st.full_page_clean_images || {};
        for (const k in fpcs) state.fullPageCleanImages[k] = fpcs[k];
        state.fullPageBubbles = {};
        const fpb = st.full_page_bubbles || {};
        for (const k in fpb) state.fullPageBubbles[k] = fpb[k];

        // 校验完整性, 仅写入控制台不再弹红色 toast
        // (旧 _meta 字段可能与实际数据有偏差, 这个检查仅作为调试用)
        const meta = st._meta || {};
        const segNow = (state.currentSegments.pages || []).reduce((s: number, p: any) => s + (p.segments || []).length, 0);
        const expected: any[] = [
            ['分镜', meta.segment_count, segNow],
            ['角色', meta.character_count, state.characters.length],
        ];
        const mismatches = expected.filter((row: any[]) => typeof row[1] === 'number' && row[1] !== row[2]);
        if (mismatches.length > 0) {
            console.info('loadHistoryWork integrity (informational):', { meta, mismatches });
        }

        // 刷新各视图
        const w: any = window;
        if (typeof w.renderCharacters === 'function') w.renderCharacters();
        if (typeof w.renderSegments === 'function') w.renderSegments();
        if (typeof w.renderGallery === 'function') w.renderGallery();

        // 加载成功的提示, 不再做完整性红色警告
        showToast(`作品已加载 (${segNow} 分镜, ${state.characters.length} 角色, ${Object.keys(state.generatedImages).length} 已生成图)`, 'success');

        // 加载成功后立即同步到服务器会话, 防止刷新/重连后丢图
        // 覆盖式存盘 (work_id 已经由后端 /load 设置到 session 里)
        syncResults().catch((e: any) => {
            console.warn('loadHistoryWork syncResults after load failed:', e);
        });

        // 检查角色人设图: 打印每个角色的 image_url 解析情况, 方便排查
        const charDiag = state.characters.map((c: any, i: number) => ({
            idx: i,
            name: c.name,
            has_image: !!(c.image_url || '').trim(),
            image_url: c.image_url,
        }));
        console.log('loadHistoryWork characters image status:', charDiag);
        const missingCharImg = charDiag.filter((c: any) => !c.has_image).length;
        if (missingCharImg > 0) {
            showToast(`已加载, ${missingCharImg} 个角色缺人设图 (请检查作品目录 images/)`, 'error');
        }
        switchTab('gallery');  // 切到画廊直接看到所有图
    } catch (e: any) {
        console.error('loadHistoryWork:', e);
        showToast('加载失败: ' + (e.message || e), 'error');
    }
}

export async function deleteHistoryWork(workId: string): Promise<void> {
    if (!confirm('确定删除这部作品？此操作不可恢复（图片和文字都将清除）。')) return;
    try {
        const response = await fetchWithRetry(`/api/history/${workId}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        const result: any = await response.json();
        if (result.success) {
            showToast('已删除', 'success');
            loadHistoryList();
        } else {
            showToast('删除失败: ' + (result.error || ''), 'error');
        }
    } catch (e: any) {
        showToast('删除失败: ' + e.message, 'error');
    }
}

export async function renameHistoryWork(workId: string, oldTitle: string): Promise<void> {
    const newTitle = prompt('修改作品名:', oldTitle);
    if (newTitle === null || newTitle.trim() === '' || newTitle === oldTitle) return;
    try {
        const response = await fetchWithRetry(`/api/history/${workId}/rename`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ title: newTitle.trim() })
        });
        const result: any = await response.json();
        if (result.success) {
            showToast('已重命名', 'success');
            loadHistoryList();
        } else {
            showToast('重命名失败: ' + (result.error || ''), 'error');
        }
    } catch (e: any) {
        showToast('重命名失败: ' + e.message, 'error');
    }
}

/* ============================================================
 * AI 写作历史 (与漫画历史分开)
 * ============================================================ */

export function switchHistorySub(sub: 'comic' | 'writing'): void {
    state._historySub = sub;
    const comicBtn = document.getElementById('hist-sub-comic');
    const writingBtn = document.getElementById('hist-sub-writing');
    const comicWrap = document.getElementById('history-comic-wrap');
    const writingWrap = document.getElementById('history-writing-wrap');
    const saveBtn = document.getElementById('history-save-current-btn');
    const countLabel = document.getElementById('history-count-label');
    const activeCls = 'pb-2 px-1 text-base font-bold border-b-[3px] border-transparent';
    const inactiveCls = 'pb-2 px-1 text-base text-gray-500 border-b-[3px] border-transparent hover:border-gray-300';
    if (sub === 'writing') {
        if (comicBtn) comicBtn.className = inactiveCls;
        if (writingBtn) writingBtn.className = activeCls;
        if (comicWrap) comicWrap.classList.add('hidden');
        if (writingWrap) writingWrap.classList.remove('hidden');
        if (saveBtn) saveBtn.classList.add('hidden');
        if (countLabel) countLabel.textContent = '篇写作';
        loadWritingHistoryList();
    } else {
        if (writingBtn) writingBtn.className = inactiveCls;
        if (comicBtn) comicBtn.className = activeCls;
        if (writingWrap) writingWrap.classList.add('hidden');
        if (comicWrap) comicWrap.classList.remove('hidden');
        if (saveBtn) saveBtn.classList.remove('hidden');
        if (countLabel) countLabel.textContent = '部漫画';
        loadHistoryList();
    }
    refreshInks();
}

export function refreshCurrentHistoryList(): void {
    if (state._historySub === 'writing') loadWritingHistoryList();
    else loadHistoryList();
}

export async function loadWritingHistoryList(): Promise<void> {
    const container = document.getElementById('history-writing-list');
    const countEl = document.getElementById('history-count');
    if (!container) return;
    container.innerHTML = '<div class="col-span-full text-center text-gray-400 py-12"><span class="loading-spinner inline-block align-middle mr-2" style="width:14px;height:14px;border-width:2px;"></span>加载中...</div>';
    try {
        const response = await fetchWithRetry('/api/writings', { credentials: 'include' });
        const result: any = await response.json();
        if (!result.success) throw new Error(result.error || '加载失败');
        const works = result.works || [];
        if (countEl) countEl.textContent = String(works.length);
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
            const win: any = window;
            if (typeof win.hydrateIcons === 'function') win.hydrateIcons(card);  // 渲染动态插入的 data-icon 为 SVG
            popIn(card);  // 写作卡片依次浮现
        }
        const win: any = window;
        if (typeof win.hydrateIcons === 'function') win.hydrateIcons(container);  // 兜底
    } catch (e: any) {
        container.innerHTML = `<div class="col-span-full text-center text-red-400 py-12">加载失败: ${escapeHtml(String(e.message || e))}</div>`;
    }
}

export async function loadWritingWork(id: string): Promise<void> {
    try {
        const response = await fetchWithRetry(`/api/writing/${id}`, { credentials: 'include' });
        const result: any = await response.json();
        if (!result.success) throw new Error(result.error || '加载失败');
        const content = result.data.content || '';
        (document.getElementById('novel-text') as HTMLTextAreaElement).value = content;
        const w: any = window;
        if (typeof w.updateCharCount === 'function') w.updateCharCount();
        if (typeof w.mirrorNovelText === 'function') w.mirrorNovelText();  // novel -> aiwrite
        state.currentWritingId = result.data.writing_id;
        localStorage.setItem('writing_id', state.currentWritingId);
        showToast(`已加载写作「${result.data.title || '未命名'}」`, 'success');
        switchTab('input');
    } catch (e: any) {
        showToast('加载失败: ' + e.message, 'error');
    }
}

export async function renameWritingWork(id: string, currentTitle: string): Promise<void> {
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
        const result: any = await response.json();
        if (!result.success) throw new Error(result.error || '重命名失败');
        showToast('已重命名', 'success');
        loadWritingHistoryList();
    } catch (e: any) {
        showToast('重命名失败: ' + e.message, 'error');
    }
}

export async function deleteWritingWork(id: string): Promise<void> {
    if (!confirm('确定删除这篇写作记录吗？')) return;
    try {
        const response = await fetchWithRetry(`/api/writing/${id}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        const result: any = await response.json();
        if (!result.success) throw new Error(result.error || '删除失败');
        if (state.currentWritingId === id) {
            state.currentWritingId = null;
            localStorage.removeItem('writing_id');
        }
        showToast('已删除', 'success');
        loadWritingHistoryList();
    } catch (e: any) {
        showToast('删除失败: ' + e.message, 'error');
    }
}

// 自动保存当前文本到写作历史 (续写/润色成功后调用; 无 id 时新建一篇)
export async function autoSaveWriting(): Promise<void> {
    const content = (document.getElementById('novel-text') as HTMLTextAreaElement | null)?.value || '';
    if (!content.trim()) return;
    const config: any = JSON.parse(localStorage.getItem('manga_config') || '{}');
    let title: string | undefined;
    if (!state.currentWritingId && config.llm_api_url) {
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
            const r: any = await resp.json();
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
            body: JSON.stringify({ writing_id: state.currentWritingId || undefined, title, content })
        });
        const result: any = await resp.json();
        if (result.success) {
            state.currentWritingId = result.writing_id;
            localStorage.setItem('writing_id', state.currentWritingId);
        }
    } catch (e) {
        console.warn('autoSaveWriting failed:', e);
    }
}

export async function saveCurrentWriting(): Promise<void> {
    const content = (document.getElementById('novel-text') as HTMLTextAreaElement | null)?.value || '';
    if (!content.trim()) {
        showToast('请先输入小说内容', 'error');
        return;
    }
    await autoSaveWriting();
    showToast('已保存到写作历史', 'success');
}
