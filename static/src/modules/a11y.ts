/**
 * a11y 焦点陷阱: 模态框打开时锁定 Tab 键在内部循环, 关闭时恢复打开前焦点
 */

const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'textarea:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
].join(',');

function getFocusableElements(modalEl: HTMLElement): HTMLElement[] {
    return Array.from(modalEl.querySelectorAll(FOCUSABLE_SELECTOR))
        .filter(el => !el.hasAttribute('disabled') && (el as HTMLElement).offsetParent !== null) as HTMLElement[];
}

function trapFocus(modalEl: HTMLElement): void {
    const handler = (e: KeyboardEvent) => {
        if (e.key !== 'Tab') return;
        const focusables = getFocusableElements(modalEl);
        if (focusables.length === 0) {
            e.preventDefault();
            return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (e.shiftKey) {
            if (active === first || !modalEl.contains(active)) {
                e.preventDefault();
                last.focus();
            }
        } else {
            if (active === last || !modalEl.contains(active)) {
                e.preventDefault();
                first.focus();
            }
        }
    };
    (modalEl as any)._trapHandler = handler;
    modalEl.addEventListener('keydown', handler);
}

function untrapFocus(modalEl: HTMLElement): void {
    if (modalEl && (modalEl as any)._trapHandler) {
        modalEl.removeEventListener('keydown', (modalEl as any)._trapHandler);
        (modalEl as any)._trapHandler = null;
    }
}

export function openModalA11y(modalId: string): void {
    const modalEl = document.getElementById(modalId);
    if (!modalEl) return;
    // 记录打开前焦点
    (modalEl as any)._previouslyFocused = document.activeElement;
    // 显示 modal (沿用现有 transitions 框架)
    const t: any = (window as any).__t2cTransitions;
    if (t) {
        t.openModal(modalId);
    } else {
        modalEl.classList.remove('modal-closing', 'hidden');
    }
    // 焦点陷阱 + 焦点移到第一个可聚焦元素
    trapFocus(modalEl);
    const focusables = getFocusableElements(modalEl);
    if (focusables.length > 0) {
        // 用 setTimeout 避免入场动画期间抢焦点
        setTimeout(() => focusables[0].focus(), 50);
    }
}

export function closeModalA11y(modalId: string): void {
    const modalEl = document.getElementById(modalId);
    if (!modalEl) return;
    untrapFocus(modalEl);
    const prev = (modalEl as any)._previouslyFocused;
    if (prev && typeof prev.focus === 'function') {
        prev.focus();
    }
    (modalEl as any)._previouslyFocused = null;
}
