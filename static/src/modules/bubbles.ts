/**
 * 气泡位置编辑器: 在 PIL 模式下, 用户可拖拽气泡调整位置, 保存到后端
 *   openBubbleEditor / saveBubblePositions
 *   BUBBLE_TYPES / BUBBLE_TYPE_LABELS 来自 state
 */

import { state } from './state';
import { motionReduced } from './ui';
import { showToast } from './toast';
import { syncResults } from './api';

export function openBubbleEditor(pageIdx: number): void {
    if (state.bubbleRenderMode !== 'pil') {
        showToast('当前为"由图像API绘制气泡"模式, 没有气泡坐标可编辑', 'info');
        return;
    }
    const cleanUrl = state.fullPageCleanImages[pageIdx];
    const stored = state.fullPageBubbles[pageIdx];
    if (!cleanUrl || !stored || stored.length === 0) {
        showToast('该页面没有可编辑的气泡（可能是旧数据未保留干净图）', 'error');
        return;
    }

    // 深拷贝, 编辑中途取消不影响原数据
    const editBubbles = (stored as any[]).map(b => ({ ...b }));

    const old = document.getElementById('bubble-editor-modal');
    if (old) old.remove();

    const modal = document.createElement('div');
    modal.id = 'bubble-editor-modal';
    modal.className = 'fixed inset-0 z-50 flex flex-col';
    modal.innerHTML = `
        <div class="modal-backdrop absolute inset-0 bg-black bg-opacity-70"></div>
        <div class="modal-card relative flex flex-col h-full max-w-6xl mx-auto w-full bg-white manga-border">
            <div class="flex items-center justify-between p-4 border-b-2 border-[#111112] bg-[#f7f6f2]">
                <h2 class="text-base md:text-lg font-black flex items-center gap-2"><span data-icon="pencil" class="ico-18" style="color: var(--spot);"></span><span>拖动气泡调整位置（可点击右上角切换气泡形状）</span></h2>
                <div class="flex gap-2">
                    <button id="bubble-editor-cancel" class="btn-ghost px-4 py-1.5 text-sm">取消</button>
                    <button id="bubble-editor-save" class="btn-accent px-5 py-1.5 text-sm">保存并重新渲染</button>
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

    const imgEl = document.getElementById('bubble-editor-img') as HTMLImageElement;
    const wrapEl = document.getElementById('bubble-editor-img-wrap') as HTMLElement;

    function getScale(): { x: number; y: number } {
        return {
            x: imgEl.clientWidth / imgEl.naturalWidth,
            y: imgEl.clientHeight / imgEl.naturalHeight,
        };
    }

    function positionBubbles(): void {
        wrapEl.querySelectorAll('.bubble-edit-item').forEach(el => el.remove());
        const scale = getScale();
        if (!scale.x || !scale.y) return;
        editBubbles.forEach((bub: any, i: number) => {
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
            div.dataset.idx = String(i);
            // 类型下拉: 用户可在编辑器里直接切换 dialogue_type, 切换后立即生效样式
            const sel = document.createElement('select');
            sel.className = 'bubble-type-select';
            sel.title = '切换气泡类型';
            sel.addEventListener('mousedown', e => e.stopPropagation());
            sel.addEventListener('touchstart', e => e.stopPropagation(), { passive: true } as any);
            for (const t of state.BUBBLE_TYPES) {
                const opt = document.createElement('option');
                opt.value = t;
                opt.textContent = _bubbleTypeLabel(t);
                if (t === dtype) opt.selected = true;
                sel.appendChild(opt);
            }
            sel.addEventListener('change', function(this: HTMLSelectElement) {
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

    function _bubbleTypeLabel(dtype: string): string {
        return (state.BUBBLE_TYPE_LABELS as any)[dtype] || ('○ ' + dtype);
    }

    function makeDraggable(el: HTMLElement, imgEl: HTMLImageElement, bub: any): void {
        function getPoint(e: any): { x: number; y: number } {
            if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
            return { x: e.clientX, y: e.clientY };
        }

        let startX: number, startY: number, origLeft: number, origTop: number;

        function onDown(e: any): void {
            const pt = getPoint(e);
            startX = pt.x; startY = pt.y;
            origLeft = parseFloat(el.style.left);
            origTop = parseFloat(el.style.top);
            el.style.zIndex = '10';
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
            document.addEventListener('touchmove', onMove, { passive: false } as any);
            document.addEventListener('touchend', onUp);
            e.preventDefault();
        }

        function onMove(e: any): void {
            const pt = getPoint(e);
            let newLeft = origLeft + (pt.x - startX);
            let newTop = origTop + (pt.y - startY);
            newLeft = Math.max(0, Math.min(newLeft, imgEl.clientWidth - el.offsetWidth));
            newTop = Math.max(0, Math.min(newTop, imgEl.clientHeight - el.offsetHeight));
            el.style.left = newLeft + 'px';
            el.style.top = newTop + 'px';
            e.preventDefault();
        }

        function onUp(): void {
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
        el.addEventListener('touchstart', onDown, { passive: false } as any);
    }

    function closeModalEditor(): void {
        state._bubbleEditorReposition = null;
        if (motionReduced()) {
            modal.remove();
            return;
        }
        modal.classList.add('modal-closing');
        // 给退场动画留够时间 (180ms) 再移除 DOM
        setTimeout(() => modal.remove(), 180);
    }

    // 图片加载后定位气泡 (处理缓存命中 onload 不触发的情况)
    if (imgEl.complete && imgEl.naturalWidth) {
        state._bubbleEditorReposition = positionBubbles;
        positionBubbles();
    } else {
        imgEl.onload = function() {
            state._bubbleEditorReposition = positionBubbles;
            positionBubbles();
        };
    }

    const cancelBtn = document.getElementById('bubble-editor-cancel');
    if (cancelBtn) cancelBtn.onclick = closeModalEditor;

    const saveBtn = document.getElementById('bubble-editor-save') as HTMLButtonElement | null;
    if (saveBtn) {
        saveBtn.onclick = async function() {
            saveBtn.disabled = true;
            saveBtn.textContent = '保存中...';
            try {
                await saveBubblePositions(pageIdx, editBubbles);
                closeModalEditor();
            } catch (e: any) {
                saveBtn.disabled = false;
                saveBtn.textContent = '保存并重新渲染';
                showToast('保存失败: ' + (e.message || e), 'error');
            }
        };
    }
}

export async function saveBubblePositions(pageIdx: number, bubbles: any[]): Promise<void> {
    const resp = await fetch('/api/reposition-bubbles', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            clean_image_url: state.fullPageCleanImages[pageIdx],
            output_image_url: state.fullPageImages[pageIdx].split('?')[0],
            bubbles: bubbles,
        })
    });
    const result: any = await resp.json();
    if (!result.success) throw new Error(result.error || '保存失败');
    state.fullPageBubbles[pageIdx] = bubbles;
    // 刷新显示图 (cache-bust)
    const baseUrl = state.fullPageImages[pageIdx].split('?')[0];
    state.fullPageImages[pageIdx] = baseUrl + '?t=' + Date.now();
    const w: any = window;
    if (typeof w.renderGallery === 'function') w.renderGallery();
    syncResults();
    showToast('气泡位置已保存', 'success');
}

/** 全局 resize 监听: 重新定位气泡编辑器里的元素 */
export function setupBubbleResize(): void {
    window.addEventListener('resize', function() {
        if (state._bubbleEditorReposition && document.getElementById('bubble-editor-modal')) {
            (state._bubbleEditorReposition as any)();
        }
    });
}
