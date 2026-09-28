/**
 * 发现: 搜索他人公开作品 + 只读查看 + 另存为我的作品
 *   runDiscoverSearch / viewPublicWork / closePublicWork / forkPublicWork
 *
 * 隐私约定 (与后端一致, 别在前端另立一套):
 *   - 搜索结果只可能包含 is_public 的作品
 *   - 公开作品只返回 封面 + 图片墙, **不包含小说正文** (后端根本不返回 state)
 *   - 查看别人的作品是只读的: 只能"另存为我的作品" (副本默认私密), 不能直接改
 */

import { escapeHtml, formatDateTime, popIn, emptyState } from './ui';
import { showToast } from './toast';
import { fetchWithRetry } from './api';
import { openModal } from './modals';
import { loadHistoryList } from './history';

const DEBOUNCE_MS = 300;
let _searchTimer: number | undefined;

export function escapeAttr(s: string): string {
    return escapeHtml(String(s == null ? '' : s)).replace(/'/g, '&#39;');
}

/** 防抖: 边打字边搜, 但不每个字符都打一次服务器 */
export function onDiscoverInput(): void {
    if (_searchTimer) window.clearTimeout(_searchTimer);
    _searchTimer = window.setTimeout(() => { runDiscoverSearch(); }, DEBOUNCE_MS);
}

export async function runDiscoverSearch(): Promise<void> {
    const input = document.getElementById('discover-q') as HTMLInputElement | null;
    const list = document.getElementById('discover-list');
    const meta = document.getElementById('discover-meta');
    if (!list) return;

    const q = (input && input.value ? input.value : '').trim();

    if (!q) {
        if (meta) meta.textContent = '输入账号名或作品标题，搜索其他人公开的作品';
        list.innerHTML = emptyState(
            'search',
            '搜索其他人的公开作品',
            '作品默认是私密的。作者在历史记录里点「公开」后，才会出现在这里。'
        );
        return;
    }

    list.innerHTML = '<div class="col-span-full text-center text-gray-400 py-12"><span class="loading-spinner inline-block align-middle mr-2" style="width:14px;height:14px;border-width:2px;"></span>搜索中...</div>';

    try {
        const response = await fetchWithRetry(
            `/api/discover?q=${encodeURIComponent(q)}`,
            { credentials: 'include' }
        );
        const result: any = await response.json();
        if (!result.success) throw new Error(result.error || '搜索失败');

        const works: any[] = result.works || [];
        const accounts: string[] = result.accounts || [];

        if (meta) {
            if (works.length === 0) {
                meta.textContent = `没有找到与「${q}」匹配的公开作品`;
            } else {
                const acctPart = accounts.length ? ` · 命中账号 ${accounts.join('、')}` : '';
                // 结果数被 limit 截断时要说明, 不能让用户以为只有这些
                const more = result.truncated ? '（仅显示前一批，还有更多）' : '';
                meta.textContent = `找到 ${result.total} 部公开作品${acctPart}${more}`;
            }
        }

        if (works.length === 0) {
            list.innerHTML = emptyState(
                'search',
                '没有匹配的公开作品',
                '换个关键词试试，或者确认对方是否已经把作品设为「公开」。'
            );
            return;
        }

        list.innerHTML = works.map((w) => `
            <div class="manga-border bg-gray-50 p-4 flex flex-col">
                <div class="aspect-video bg-gray-200 mb-3 flex items-center justify-center overflow-hidden" data-cover-owner="${escapeAttr(w.owner)}" data-cover-work="${escapeAttr(w.work_id)}">
                    <span class="loading-spinner inline-block" style="width:14px;height:14px;border-width:2px;"></span>
                </div>
                <h3 class="font-bold text-base mb-1 truncate" title="${escapeAttr(w.title)}">${escapeHtml(w.title || '未命名')}</h3>
                <p class="text-xs text-gray-500 mb-1"><span data-icon="user" class="inline-block align-[-2px] mr-1" style="width:11px;height:11px;"></span>${escapeHtml(w.owner)}</p>
                <p class="text-xs text-gray-500 mb-3"><span data-icon="clock" class="inline-block align-[-2px] mr-1" style="width:11px;height:11px;"></span>${formatDateTime(w.updated_at)}</p>
                <div class="flex gap-2 mt-auto">
                    <button onclick="viewPublicWork('${escapeAttr(w.owner)}','${escapeAttr(w.work_id)}')" class="flex-1 border-2 border-black bg-black text-white px-2 py-1.5 text-xs font-medium hover:bg-gray-800 transition-colors flex items-center justify-center gap-1"><span data-icon="book-open" style="width:12px;height:12px;"></span>查看</button>
                    <button onclick="forkPublicWork('${escapeAttr(w.owner)}','${escapeAttr(w.work_id)}')" class="border-2 border-gray-300 hover:border-black px-2 py-1.5 text-xs transition-colors flex items-center justify-center gap-1" title="另存为我的作品"><span data-icon="copy" style="width:12px;height:12px;"></span>另存</button>
                </div>
            </div>
        `).join('');

        const w: any = window;
        if (typeof w.hydrateIcons === 'function') w.hydrateIcons(list);
        Array.from(list.children).forEach((c) => popIn(c as HTMLElement));

        // 封面单独拉 (搜索结果不带图片列表), 逐个错开避免同时打十几个请求
        works.forEach((w, i) => {
            window.setTimeout(() => { loadCover(w.owner, w.work_id); }, i * 120);
        });
    } catch (e: any) {
        list.innerHTML = `<div class="col-span-full text-center text-red-400 py-12">搜索失败: ${escapeHtml(String(e.message || e))}</div>`;
    }
}

async function loadCover(owner: string, workId: string): Promise<void> {
    const holder = document.querySelector(
        `[data-cover-owner="${CSS.escape(owner)}"][data-cover-work="${CSS.escape(workId)}"]`
    );
    if (!holder) return;
    try {
        const response = await fetchWithRetry(
            `/api/public/work/${encodeURIComponent(owner)}/${encodeURIComponent(workId)}`,
            { credentials: 'include' }
        );
        const result: any = await response.json();
        if (!result.success) return;
        const cover = result.work.cover;
        holder.innerHTML = cover
            ? `<img src="${escapeAttr(cover)}" class="w-full h-full object-cover" loading="lazy" onerror="this.parentElement.innerHTML='<div class=&quot;text-gray-400 text-sm&quot;>无预览</div>'">`
            : '<div class="text-gray-400 text-sm">无图片</div>';
    } catch (e) {
        holder.innerHTML = '<div class="text-gray-400 text-sm">无预览</div>';
    }
}

/** 只读查看他人公开作品: 弹层里翻页看图 + 另存为我的作品 */
export async function viewPublicWork(owner: string, workId: string): Promise<void> {
    const overlay = document.getElementById('public-work-modal');
    const body = document.getElementById('public-work-body');
    if (!overlay || !body) return;

    overlay.classList.remove('hidden');
    body.innerHTML = '<div class="text-center text-gray-400 py-12">加载中...</div>';

    try {
        const response = await fetchWithRetry(
            `/api/public/work/${encodeURIComponent(owner)}/${encodeURIComponent(workId)}`,
            { credentials: 'include' }
        );
        const result: any = await response.json();
        if (!result.success) {
            body.innerHTML = `<div class="text-red-500 text-sm p-6">${escapeHtml(result.error || '作品不存在或未公开')}</div>`;
            return;
        }
        const w = result.work;
        // 记住当前作品 id, 供弹层里的「另存为我的作品」按钮使用
        (window as any).__pwWorkId = w.work_id;
        // 只改文字 span, 不要碰父节点 textContent (会把 data-icon 图标一起抹掉)
        const titleEl = document.querySelector('#public-work-title .public-work-title-text');
        if (titleEl) titleEl.textContent = w.title || '未命名';
        const ownerEl = document.getElementById('public-work-owner');
        if (ownerEl) ownerEl.textContent = w.owner;

        // 注意: 这里只渲染图片墙。后端刻意不返回 state, 所以这里拿不到也拿不到小说正文.
        if (!w.images || w.images.length === 0) {
            body.innerHTML = '<div class="text-gray-400 text-sm p-6">这部作品还没有图片</div>';
            return;
        }
        body.innerHTML = `
            <p class="text-xs text-gray-500 mb-3">${w.image_count} 张图片 · 更新于 ${formatDateTime(w.updated_at)}</p>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                ${w.images.map((u: string) => `
                    <button onclick="openModal('${escapeAttr(u)}')" class="border-2 border-black bg-gray-50 p-1 hover:bg-gray-100 transition-colors">
                        <img src="${escapeAttr(u)}" class="w-full object-contain" loading="lazy" onerror="this.parentElement.innerHTML='<div class=&quot;text-gray-400 text-sm p-4&quot;>加载失败</div>'">
                    </button>
                `).join('')}
            </div>
        `;
    } catch (e: any) {
        body.innerHTML = `<div class="text-red-500 text-sm p-6">加载失败: ${escapeHtml(String(e.message || e))}</div>`;
    }
}

export function closePublicWork(): void {
    const overlay = document.getElementById('public-work-modal');
    if (overlay) overlay.classList.add('hidden');
}

/** 另存为我的作品: 深拷贝到自己账号, 副本默认私密 */
export async function forkPublicWork(owner: string, workId: string): Promise<void> {
    try {
        const response = await fetchWithRetry(
            `/api/public/work/${encodeURIComponent(owner)}/${encodeURIComponent(workId)}/fork`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include' }
        );
        const result: any = await response.json();
        if (!result.success) throw new Error(result.error || '另存失败');
        showToast(`已另存为「${result.title}」（私密）`, 'success');
        closePublicWork();
        // 顺便刷新"我的历史", 用户切过去就能看到副本
        loadHistoryList();
    } catch (e: any) {
        showToast('另存失败: ' + (e.message || e), 'error');
    }
}
