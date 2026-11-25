/**
 * 宣传页动效 (GSAP + ScrollTrigger)
 * 每个动画都必须能说清楚它传达什么:
 *   1. 首屏时间轴  → 层级: 先读标题, 再看画面
 *   2. 首屏视差    → 叙事: 画框与网点分层, 滚动时产生纵深
 *   3. 分节入场    → 层级: 内容按段落依次出现, 不抢首屏
 *   4. 跑马灯      → 广度: 八项能力一次扫过 (全页仅此一条)
 *   5. 横向三步    → 叙事: 贴入 → 定角色 → 出整页, 顺序即流程
 *   6. 扫描线      → 叙事: 页面被"读"回文字
 *   7. 磁吸 + 幕布 → 反馈: 主 CTA 跟随指针, 点击后幕布落下再进站
 * 三个前提: 没有 GSAP、系统偏好减少动效、或任何一步抛错时, 内容必须完整可见可点。
 */

import type {} from './types/index';

// TODO: strict type - GSAP 类型未在项目类型库中, 整个文件以 any 形式描述第三方 API 交互
declare const gsap: any;
declare const ScrollTrigger: any;

(function (): void {
    'use strict';

    const doc: HTMLElement = document.documentElement;
    const reduce: boolean = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const canHover: boolean = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

    // ---- 没有 GSAP / 系统要求减少动效: 页面保持静态可用 ----
    // TODO: strict type - 第三方库 (gsap/ScrollTrigger) 未提供类型声明
    const w: any = window as any;
    if (!w.gsap || !w.ScrollTrigger || reduce) {
        doc.classList.remove('has-gsap');
        // 没有 GSAP 就没有横向位移, 三步必须改成纵向排列, 否则后两张卡片会被裁掉
        document.querySelectorAll('[data-pan]').forEach((el: Element) => { el.classList.add('pan-static'); });
        (window as any).__landingReady = true;
        bindCta(false);
        return;
    }

    const g: any = w.gsap;
    const ST: any = w.ScrollTrigger;
    g.registerPlugin(ST);
    g.defaults({ ease: 'power3.out', duration: 0.7 });

    // ================= 1. 标题逐字 + 首屏时间轴 =================
    function splitChars(root: Element | null): void {
        if (!root) return;
        root.querySelectorAll(':scope > span').forEach((line: Element) => {
            const text: string[] = Array.from(line.textContent || '');
            line.textContent = '';
            text.forEach((ch: string) => {
                const span: HTMLSpanElement = document.createElement('span');
                span.className = 'ch';
                span.style.display = 'inline-block';
                span.textContent = ch;
                line.appendChild(span);
            });
        });
    }
    const h1: HTMLElement | null = document.querySelector('[data-split]');
    if (h1) splitChars(h1);

    // [data-anim="cta"] 是容器, 只动它的子元素, 所以容器本身先解除预隐藏
    g.set('[data-anim="cta"]', { autoAlpha: 1 });

    const intro: any = g.timeline({ delay: 0.05 });
    intro
        .fromTo('[data-anim="eyebrow"]', { y: 12, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.5 })
        .fromTo(h1 ? h1.querySelectorAll('.ch') : [], { yPercent: 115, autoAlpha: 0 },
            { yPercent: 0, autoAlpha: 1, duration: 0.75, stagger: 0.028 }, '-=0.3')
        .fromTo('[data-anim="sub"]', { y: 16, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.6 }, '-=0.45')
        .fromTo('[data-anim="cta"] > *', { y: 14, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.5, stagger: 0.09 }, '-=0.35')
        // 画框只做变换, 不做透明度: 首屏主图必须立刻参与绘制 (LCP)
        .fromTo('[data-frame]', { scale: 0.945, rotate: -2.4 }, { scale: 1, rotate: 0, duration: 1.05, ease: 'power3.out' }, '-=0.95')
        // 墨迹从下往上退开, 像刚印出来
        .fromTo('[data-wipe]', { scaleY: 1 }, { scaleY: 0, duration: 1.1, ease: 'power3.inOut' }, '-=1.0');

    // ================= 2. 首屏视差 =================
    g.to('[data-frame]', {
        y: -46, ease: 'none',
        scrollTrigger: { trigger: '#top', start: 'top top', end: 'bottom top', scrub: true }
    });
    g.to('#top .halftone', {
        y: 34, ease: 'none',
        scrollTrigger: { trigger: '#top', start: 'top top', end: 'bottom top', scrub: true }
    });

    // ================= 3. 分节入场 =================
    ST.batch('.reveal', {
        start: 'top 90%',
        once: true,
        onEnter: function (batch: any[]): void {
            g.fromTo(batch, { y: 26, autoAlpha: 0 },
                { y: 0, autoAlpha: 1, duration: 0.75, stagger: 0.08, overwrite: true });
        }
    });
    const closeTitle: HTMLElement | null = document.querySelector('[data-anim="close"]');
    if (closeTitle) {
        g.fromTo(closeTitle, { y: 30, autoAlpha: 0 }, {
            y: 0, autoAlpha: 1, duration: 0.9,
            scrollTrigger: { trigger: closeTitle, start: 'top 88%', once: true }
        });
    }

    // ================= 4. 跑马灯 (内容复制一份实现无缝循环) =================
    const track: HTMLElement | null = document.querySelector('[data-marquee-track]');
    if (track) {
        const clone: HTMLElement = track.cloneNode(true) as HTMLElement;
        clone.setAttribute('aria-hidden', 'true');
        Array.prototype.forEach.call(clone.children, (child: Element) => { track.appendChild(child); });
        const loop: any = g.to(track, { xPercent: -50, duration: 30, ease: 'none', repeat: -1 });
        // 离开视口时暂停, 不在屏幕外烧帧
        ST.create({
            trigger: '[data-marquee]',
            start: 'top bottom',
            end: 'bottom top',
            onToggle: function (self: any): void { self.isActive ? loop.play() : loop.pause(); }
        });
    }

    // ================= 5. 横向三步 (规范骨架: 钉住外层, 拖动内轨) =================
    const mm: any = g.matchMedia();
    mm.add('(min-width: 768px) and (prefers-reduced-motion: no-preference)', () => {
        const wrap: HTMLElement | null = document.querySelector('[data-pan]');
        const inner: HTMLElement | null = document.querySelector('[data-pan-track]');
        if (!wrap || !inner) return;
        const distance = (): number => Math.max(0, inner.scrollWidth - window.innerWidth);
        if (distance() < 40) return;   // 内容不够宽就不做横向滚动
        const tween: any = g.to(inner, {
            x: () => -distance(),
            ease: 'none',
            scrollTrigger: {
                trigger: wrap,
                start: 'top top',
                end: () => '+=' + distance(),
                pin: true,
                scrub: 1,
                invalidateOnRefresh: true
            }
        });
        // 每张卡片在自己的横向位置轻微聚焦, 强调"顺序"
        g.utils.toArray('.pan-card', inner).forEach((card: Element, i: number) => {
            if (i === 0) return;
            g.fromTo(card, { autoAlpha: 0.55, scale: 0.97 }, {
                autoAlpha: 1, scale: 1, ease: 'none',
                scrollTrigger: {
                    trigger: card,
                    containerAnimation: tween,
                    start: 'left 92%',
                    end: 'left 55%',
                    scrub: true
                }
            });
        });
        return (): void => { /* no-op cleanup */ };
    });
    // 手机: 轨道改成纵向排列, 不做钉住 (回到桌面尺寸时再撤销)
    mm.add('(max-width: 767px)', () => {
        const wrap: HTMLElement | null = document.querySelector('[data-pan]');
        if (!wrap) return;
        wrap.classList.add('pan-static');
        return (): void => { wrap.classList.remove('pan-static'); };
    });

    // ================= 6. 扫描线: 页面被读回文字 =================
    const scan: HTMLElement | null = document.querySelector('[data-scan]');
    if (scan) {
        const scanBox: HTMLElement | null = scan.parentElement;
        if (scanBox) {
            g.fromTo(scan, { y: -10, autoAlpha: 0 }, {
                y: () => scanBox.offsetHeight,
                autoAlpha: 1,
                duration: 1.7,
                ease: 'power2.inOut',
                immediateRender: false,
                scrollTrigger: { trigger: scanBox, start: 'top 72%', once: true }
            });
        }
    }

    // ================= 7. 磁吸按钮 + 幕布转场 =================
    if (canHover) {
        document.querySelectorAll('[data-magnetic]').forEach((btn: Element) => {
            const xTo: (v: number) => void = g.quickTo(btn, 'x', { duration: 0.35, ease: 'power3.out' });
            const yTo: (v: number) => void = g.quickTo(btn, 'y', { duration: 0.35, ease: 'power3.out' });
            btn.addEventListener('pointermove', (e: Event) => {
                const ev: PointerEvent = e as PointerEvent;
                const r: DOMRect = (btn as HTMLElement).getBoundingClientRect();
                xTo(((ev.clientX - r.left) / r.width - 0.5) * 14);
                yTo(((ev.clientY - r.top) / r.height - 0.5) * 10);
            });
            btn.addEventListener('pointerleave', () => { xTo(0); yTo(0); });
        });
    }
    bindCta(true);

    function bindCta(withCurtain: boolean): void {
        document.querySelectorAll('[data-cta]').forEach((link: Element) => {
            link.addEventListener('click', (e: Event) => {
                // 新窗口 / 中键 / 修饰键: 交给浏览器
                const ev: MouseEvent = e as MouseEvent;
                if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button !== 0) return;
                if (!withCurtain) return;
                ev.preventDefault();
                const panels: NodeListOf<Element> = document.querySelectorAll('#curtain span');
                const curtain: HTMLElement | null = document.getElementById('curtain');
                const href: string | null = (link as HTMLAnchorElement).href;
                if (!panels.length || !curtain) { window.location.href = href; return; }
                curtain.classList.add('on');
                g.timeline({ onComplete: () => { window.location.href = href; } })
                    .set(panels, { transformOrigin: 'bottom' })
                    .to(panels, { scaleY: 1, duration: 0.42, stagger: 0.045, ease: 'power3.inOut' });
            });
        });
    }

    // 图片按尺寸占位, 但字体/懒加载仍会改变布局, 刷新一次触发点位置
    window.addEventListener('load', () => { ST.refresh(); });

    // 到这里为止没有抛错, 取消 head 里的"强制显示"兜底
    (window as any).__landingReady = true;
})();