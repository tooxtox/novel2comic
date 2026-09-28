/**
 * UI 通用工具: DOM helper / 动效 / 格式化
 * 原 app.js 散落的工具函数统一在这里
 */

// ========== 动效工具 ==========

export function motionReduced(): boolean {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * 容器内元素的可视级联入场: 元素进入视口时才播放, 同批进入的按顺序依次延迟.
 * 依赖 CSS 的 .stagger-ready (入场前隐藏) 与 .stagger-item (播放动画, 延迟 = --i * --stagger).
 * 减少动效偏好 / 不支持 IntersectionObserver 时不加任何 class → 内容直接可见.
 */
export function playStagger(container: any, selector?: string): void {
    if (!container) return;
    const nodes = selector ? container.querySelectorAll(selector) : container.children;
    if (!nodes || nodes.length === 0) return;
    if (motionReduced() || typeof IntersectionObserver === 'undefined') return;
    // 同一容器只做一次级联: 勾选角色等交互会整块重渲染, 每次都重新入场会闪
    if ((container as any)._staggerDone) return;
    (container as any)._staggerDone = true;

    const io = new IntersectionObserver((entries, obs) => {
        let batch = 0;
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            obs.unobserve(entry.target);
            (entry.target as HTMLElement).style.setProperty('--i', String(batch++));
            entry.target.classList.remove('stagger-ready');
            entry.target.classList.add('stagger-item');
        });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.01 });

    Array.from(nodes).forEach(el => {
        if (el.classList.contains('stagger-item')) return;  // 已播放过的不重播
        el.classList.add('stagger-ready');
        io.observe(el);
    });

    // 兜底: 3s 后仍在视口内却没播放的元素直接显示 (防止内容被"藏"住)
    setTimeout(() => {
        Array.from(nodes).forEach((el: any) => {
            if (!el.classList.contains('stagger-ready')) return;
            const r = el.getBoundingClientRect();
            if (r.top < window.innerHeight && r.bottom > 0) {
                el.classList.remove('stagger-ready');
                el.classList.add('stagger-item');
            }
        });
    }, 3000);
}

/** 单个元素立刻入场 (用于逐条追加的列表, 每张卡片到达时各自播放) */
export function popIn(el: HTMLElement | null): void {
    if (!el || motionReduced()) return;
    el.classList.add('stagger-item');
}

/** HTML escape: 旧版本 (供 segment 等场景使用) */
export function escapeHtml(s: any): string {
    if (!s) return '';
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/** ISO 时间格式化 */
export function formatDateTime(iso: string | undefined | null): string {
    if (!iso) return '-';
    try {
        const d = new Date(iso);
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch (e) { return iso; }
}

/**
 * 统一的空状态: 虚线画框 + 网点 + 一句说明 + 一个下一步动作
 * 第二参 icon 接受 data-icon 名字 (参见 icons.js), 由 hydrateIcons 渲染 SVG
 */
export function emptyState(icon: string, title: string, hint: string, action?: { onclick: string; label: string; fullSpan?: boolean }): string {
    const fullSpan = !action || action.fullSpan ? ' col-span-full' : '';
    const btn = action
        ? `<button onclick="${action.onclick}" class="btn-primary px-5 py-2 text-sm font-medium">${action.label}</button>`
        : '';
    return `<div class="empty-state${fullSpan}">
        <span class="es-halftone" aria-hidden="true"></span>
        <div class="es-icon" data-icon="${icon}"></div>
        <p class="es-title">${title}</p>
        <p class="es-hint">${hint}</p>
        ${btn}
    </div>`;
}

// ========== 浏览器/设备识别 ==========

export interface DeviceInfo {
    device: 'desktop' | 'mobile' | 'tablet';
    browser: string;
    isMobile: boolean;
    isTouch: boolean;
    isWechat: boolean;
    ua: string;
}

/** 浏览器/设备识别: 在 <html>/<body> 上打 data-device / data-browser / class */
export function detectBrowserDevice(): DeviceInfo {
    const ua = navigator.userAgent || '';
    const uaData: any = (navigator as any).userAgentData;
    const hasTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;
    const isAndroid = /Android/i.test(ua);
    const isIPhone = /iPhone|iPod/i.test(ua);
    const isIPad = /iPad/i.test(ua) || (/Macintosh/i.test(ua) && hasTouch && navigator.platform === 'MacIntel');
    const isMobileUA = /Mobi/i.test(ua) || isIPhone || isAndroid || /Windows Phone|IEMobile/i.test(ua) || (uaData && uaData.mobile === true);

    let device: DeviceInfo['device'] = 'desktop';
    if (isIPad) device = 'tablet';
    else if (isMobileUA) device = 'mobile';
    else if (hasTouch && window.innerWidth < 1024) device = 'tablet';

    let browser: string = 'other';
    if (/MicroMessenger/i.test(ua)) browser = 'wechat';
    else if (/QQ/i.test(ua) || /MQQBrowser/i.test(ua)) browser = 'qq';
    else if (/DingTalk|Dingding/i.test(ua)) browser = 'dingtalk';
    else if (/Edg/i.test(ua)) browser = 'edge';
    else if (/Firefox/i.test(ua)) browser = 'firefox';
    else if (/UCBrowser/i.test(ua)) browser = 'uc';
    else if (/Chrome/i.test(ua)) browser = 'chrome';
    else if (/Safari/i.test(ua)) browser = 'safari';

    const info: DeviceInfo = { device, browser, isMobile: device === 'mobile', isTouch: hasTouch, isWechat: browser === 'wechat', ua };
    (window as any).APP_DEVICE = info;

    const root = document.documentElement;
    root.dataset.device = device;
    root.dataset.browser = browser;
    const body = document.body;
    body.classList.remove('device-mobile', 'device-tablet', 'device-desktop', 'touch-device', 'browser-wechat');
    body.classList.add('device-' + device, 'touch-device');
    if (browser === 'wechat') body.classList.add('browser-wechat');

    const w: any = window;
    if (typeof w.maybeShowInAppBanner === 'function') w.maybeShowInAppBanner(info);
    return info;
}

/** 微信/QQ 内置浏览器提示横幅 (banner 元素存在时才显示) */
export function maybeShowInAppBanner(info: DeviceInfo): void {
    const banner = document.getElementById('inapp-browser-banner');
    if (!banner) return;
    const isInApp = (info.browser === 'wechat' || info.browser === 'qq') && info.device !== 'desktop';
    let dismissed: string | null = null;
    try { dismissed = localStorage.getItem('inapp_banner_dismissed'); } catch (e) { /* 无痕/禁用存储时忽略 */ }
    if (!isInApp || dismissed === info.browser) {
        banner.classList.add('hidden');
        return;
    }
    const textEl = document.getElementById('inapp-browser-text');
    if (textEl) {
        textEl.textContent = info.browser === 'wechat'
            ? '微信内打开功能受限，建议点击右上角「···」，选择「在浏览器打开」'
            : 'QQ 内打开功能受限，建议点击右上角「···」，选择「在浏览器打开」';
    }
    banner.classList.remove('hidden');
}

/** 移动端底部导航: visualViewport 高度差算出底栏占用高度, 避免与 iOS Safari 工具栏重叠 */
export function adjustBottomNav(): void {
    const nav = document.getElementById('mobile-bottom-nav');
    if (!nav) return;
    // 桌面端 (md 及以上) 底栏本来就隐藏，无需处理
    if (window.matchMedia && window.matchMedia('(min-width: 768px)').matches) return;
    const vv: any = (window as any).visualViewport;
    let offset = 0;
    if (vv && window.innerHeight > vv.height) {
        offset = Math.round(window.innerHeight - vv.height);
    }
    nav.style.bottom = offset + 'px';
}
