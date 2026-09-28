/**
 * 模态框: openModal (图片) / closeModal / openConfigModal / closeConfigModal / animateCloseModal
 * 与 a11y.ts 配合使用焦点陷阱
 */

import { motionReduced } from './ui';
import { openModalA11y, closeModalA11y } from './a11y';

// 模态框关闭动画: 先播放淡出过渡, 结束后再 display:none; 减少动效偏好时直接隐藏
export function animateCloseModal(modalId: string, onClose?: () => void): void {
    const modal = document.getElementById(modalId);
    if (!modal || modal.classList.contains('hidden')) return;
    if (motionReduced()) {
        modal.classList.add('hidden');
        if (onClose) onClose();
        return;
    }
    if ((modal as any)._closing) return;
    (modal as any)._closing = true;
    modal.classList.add('modal-closing');
    setTimeout(() => {
        modal.classList.add('hidden');
        modal.classList.remove('modal-closing');
        (modal as any)._closing = false;
        if (onClose) onClose();
    }, 150);
}

export function openModal(src: string): void {
    const modal = document.getElementById('image-modal');
    const img = document.getElementById('modal-image') as HTMLImageElement | null;
    if (!modal || !img) return;
    img.src = src;
    // 大图每次打开都从微缩淡入 (同一 class 不会自动重播, 先移除再强制回流)
    img.classList.remove('zoom-in');
    void img.offsetWidth;
    img.classList.add('zoom-in');
    const t: any = (window as any).__t2cTransitions;
    if (t) {
        t.openModal('image-modal');
    } else {
        modal.classList.remove('modal-closing', 'hidden');
    }
}

export function closeModal(): void {
    closeModalA11y('image-modal');
    animateCloseModal('image-modal');
}

export function openConfigModal(): void {
    openModalA11y('config-modal');
}

export function closeConfigModal(): void {
    closeModalA11y('config-modal');
    animateCloseModal('config-modal');
}
