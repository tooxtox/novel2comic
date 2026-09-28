/**
 * 画廊 (Gallery): 整页漫画成品列表
 *   renderGallery / exportScript / downloadAll
 *   openModal / closeModal 实际在 modals.ts, 这里转发以保持与 app.js 一致的 window 接口
 */

import { state } from './state';
import { playStagger, emptyState } from './ui';
import { showToast } from './toast';

export function renderGallery(): void {
    const container = document.getElementById('gallery-container');
    if (!container) return;
    // 重新渲染前清掉 stagger 标记, 让下次 playStagger 能再触发级联
    const t: any = (window as any).__t2cTransitions;
    if (t) t.resetStagger(container);

    const hasFullPages = Object.keys(state.fullPageImages).length > 0;

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
                ${state.currentSegments.pages.map((page: any, pageIdx: number) => {
                    const img = state.fullPageImages[pageIdx];
                    if (!img) return '';
                    const canEdit = state.bubbleRenderMode === 'pil'
                        && state.fullPageCleanImages[pageIdx]
                        && state.fullPageBubbles[pageIdx]
                        && state.fullPageBubbles[pageIdx].length > 0;
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
    const w: any = window;
    if (typeof w.markDirty === 'function') w.markDirty();
    if (typeof w.scheduleWorkspaceUI === 'function') w.scheduleWorkspaceUI();
}

export function exportScript(): void {
    const data = {
        pages: state.currentSegments.pages.map((page: any, pageIdx: number) => ({
            ...page,
            segments: page.segments.map((seg: any, segIdx: number) => ({
                ...seg,
                image_url: state.generatedImages[`${pageIdx}-${segIdx}`] || null
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

export async function downloadAll(): Promise<void> {
    const allImages: { url: string; filename: string; type: string }[] = [];

    Object.entries(state.fullPageImages).forEach(([pageIdx, url]) => {
        if (url) {
            allImages.push({ url: url as string, filename: `comic_page_full_${parseInt(pageIdx) + 1}.png`, type: '整页' });
        }
    });

    Object.entries(state.generatedImages).forEach(([key, url]) => {
        if (url) {
            const [pageIdx, segIdx] = key.split('-');
            allImages.push({ url: url as string, filename: `manga_p${parseInt(pageIdx) + 1}_s${parseInt(segIdx) + 1}.png`, type: '分镜' });
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
        } catch (e: any) {
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
