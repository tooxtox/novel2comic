/**
 * Toast 通知: 普通/成功 3s 自动消失; 错误抖动; loading toast 持久显示需手动 dismiss
 */

export function showToast(message: string, type: 'success' | 'error' | 'info' = 'info'): void {
    const toast = document.getElementById('toast');
    if (!toast) return;
    const icons: Record<string, string> = { success: 'check-circle', error: 'warning', info: 'lightbulb' };
    const iconName = icons[type] || icons.info;
    toast.innerHTML = `<div class="toast-inner"><span class="toast-icon" data-icon="${iconName}"></span><span class="toast-text"></span></div><span class="toast-timer"></span>`;
    // 触发 hydrateIcons 渲染 SVG
    const w: any = window;
    if (typeof w.hydrateIcons === 'function') w.hydrateIcons(toast);
    const textEl = toast.querySelector('.toast-text');
    if (textEl) textEl.textContent = message;
    toast.style.background = type === 'error' ? '#dc2626' : type === 'success' ? '#16a34a' : '#1a1a1a';
    toast.style.transform = 'translateY(0)';
    toast.style.opacity = '1';
    // 入场: 普通/成功弹入, 错误先弹入再抖一下
    toast.classList.remove('toast-pop', 'shake', 'toast-loading');
    void toast.offsetWidth;
    toast.classList.add(type === 'error' ? 'shake' : 'toast-pop');
    // 清除之前可能存在的计时器
    const t: any = toast as any;
    if (t._hideTimer) {
        clearTimeout(t._hideTimer);
        t._hideTimer = null;
    }
    // 若为持久 toast, 不自动隐藏
    if (toast.dataset.persistent === '1') return;
    // 底部进度线跟着 3s 倒计时走完
    toast.classList.remove('is-counting');
    void toast.offsetWidth;
    toast.classList.add('is-counting');
    t._hideTimer = setTimeout(() => {
        toast.classList.remove('is-counting');
        toast.style.transform = 'translateY(20px)';
        toast.style.opacity = '0';
        t._hideTimer = null;
    }, 3000);
}

/** 长时间显示的"加载中"提示, 返回 id 用于 dismiss */
export function showLoadingToast(message: string): string {
    const toast = document.getElementById('toast');
    if (!toast) return 'toast';
    toast.innerHTML = '<div class="toast-inner"><span class="toast-icon">⏳</span><span class="toast-text"></span></div>';
    const textEl = toast.querySelector('.toast-text');
    if (textEl) textEl.textContent = message;
    toast.style.background = '#1a1a1a';
    toast.style.transform = 'translateY(0)';
    toast.style.opacity = '1';
    // 弹入 + 持续呼吸光晕, 表示"还在跑"
    toast.classList.remove('toast-pop', 'shake', 'is-counting');
    void toast.offsetWidth;
    toast.classList.add('toast-loading');
    // 显式标记为"持久toast", 阻止 showToast 默认3秒后自动隐藏
    toast.dataset.persistent = '1';
    return 'toast';
}

export function dismissLoadingToast(id: string): void {
    if (id !== 'toast') return;
    const toast = document.getElementById('toast');
    if (!toast) return;
    const t: any = toast as any;
    if (t._hideTimer) {
        clearTimeout(t._hideTimer);
        t._hideTimer = null;
    }
    toast.dataset.persistent = '';
    toast.classList.remove('toast-loading');
    toast.style.transform = 'translateY(20px)';
    toast.style.opacity = '0';
}
