/* ============================================================================
   text2comic · 衔接动画协调器 v1
   ----------------------------------------------------------------------------
   在 design-system.css 提供的关键帧基础上, 给 app.js 提供一组
   干净的"编排式"动效 API, 把"面板退出再进入"、"模态框入场"、
   "保存成功庆祝"、"列表项重新级联"这些流程从代码里抽出来。
   ----------------------------------------------------------------------------
   所有 API 都遵守 prefers-reduced-motion: reduce, 自动降级为瞬时切换。
   所有 API 都基于 transform / opacity 触发 (硬件加速)。
   ============================================================================ */

import type {} from '../types/index';

(function (global: any) {
    'use strict';

    // 防止重复注册
    if (global.__t2cTransitions) return;

    const REDUCE_MOTION: boolean = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ---------- 1. 工具函数 ---------- */

    /** 强制 reflow, 让浏览器"看见"class 已变更, 再触发后续 class 触发动画 */
    function reflow(el: HTMLElement): void {
        // 读取 offsetWidth 即可强制同步布局, 不需要实际拿到值
        void el.offsetWidth;
    }

    /** 等一个动画结束 (兼容 webkit) */
    function onAnimEnd(el: HTMLElement, name?: string): Promise<void> {
        return new Promise((resolve) => {
            if (REDUCE_MOTION) return resolve();
            const handler = (e: AnimationEvent) => {
                if (e.target !== el) return;
                if (name && e.animationName !== name) return;
                el.removeEventListener('animationend', handler);
                resolve();
            };
            el.addEventListener('animationend', handler);
            // 兜底: 800ms 后强制 resolve (避免动画未触发的死等)
            setTimeout(() => {
                el.removeEventListener('animationend', handler);
                resolve();
            }, 800);
        });
    }

    /* ---------- 2. 面板切换 (旧面板退出 → 新面板进入 + 级联) ----------
       替换 switchTab 内的 className 操作, 让面板"先退场再进场" */

    /**
     * @param fromId 旧面板 id (无则传 null, 表示首次进入)
     * @param toId   新面板 id
     * @param dir 新面板相对旧面板的进入方向
     */
    async function swapPanel(fromId: string | null, toId: string, dir: 'left' | 'right' = 'right'): Promise<void> {
        const fromEl: HTMLElement | null = fromId ? document.getElementById(fromId) : null;
        const toEl: HTMLElement | null = toId ? document.getElementById(toId) : null;
        if (!toEl) return;

        if (REDUCE_MOTION) {
            if (fromEl) fromEl.classList.add('hidden');
            toEl.classList.remove('hidden');
            return;
        }

        // 第一阶段: 旧面板淡出 (若有)
        if (fromEl && !fromEl.classList.contains('hidden')) {
            fromEl.classList.remove('panel-in-left', 'panel-in-right');
            fromEl.classList.add('panel-out');
            await onAnimEnd(fromEl, 'panelOut');
            fromEl.classList.add('hidden');
            fromEl.classList.remove('panel-out');
        }

        // 第二阶段: 新面板进入 + 级联首屏子元素
        toEl.classList.remove('hidden', 'panel-in-left', 'panel-in-right');
        reflow(toEl);  // 强制 reflow, 让动画重置
        toEl.classList.add(dir === 'right' ? 'panel-in-right' : 'panel-in-left');
        // 给面板内第一层 .bg-white 卡片 (或 .stat-tile / .stepper 等) 也来一次级联
        cascadeChildren(toEl);
    }

    /** 给容器内直接子元素打 --i, 触发 viewFadeIn 级联 */
    function cascadeChildren(container: HTMLElement | null, selector: string = ':scope > *', className: string = 'view-fade'): void {
        if (!container) return;
        const kids: NodeListOf<Element> = container.querySelectorAll(selector);
        kids.forEach((el: Element, i: number) => {
            if (i > 12) return; // 最多 12 个, 避免长列表的卡顿
            (el as HTMLElement).classList.remove(className);
            (el as HTMLElement).style.setProperty('--i', String(i));
            reflow(el as HTMLElement);
            (el as HTMLElement).classList.add(className);
        });
    }

    /* ---------- 3. 模态框进出场 ---------- */

    /**
     * 打开模态框 (带入场动画, 替代直接 remove('hidden'))
     * 用法: openModal('config-modal')
     */
    function openModal(modalId: string): void {
        const el: HTMLElement | null = document.getElementById(modalId);
        if (!el) return;
        if (REDUCE_MOTION) {
            el.classList.remove('hidden', 'modal-closing');
            return;
        }
        el.classList.remove('hidden', 'modal-closing');
        el.classList.add('modal-opening');
        reflow(el);
        // modal-opening 是一次性入场, 动画结束后清掉避免干扰下次关闭
        setTimeout(() => el.classList.remove('modal-opening'), 350);
    }

    /**
     * 关闭模态框 (带退场动画, 替代直接 add('hidden'))
     * 用法: closeModal('config-modal', onAfterClose)
     */
    function closeModal(modalId: string, onAfterClose?: () => void): void {
        const el: HTMLElement | null = document.getElementById(modalId);
        if (!el) return;
        if (REDUCE_MOTION) {
            el.classList.add('hidden', 'modal-closing');
            if (onAfterClose) onAfterClose();
            return;
        }
        if ((el as any)._closing) return;  // 防重入
        (el as any)._closing = true;
        el.classList.add('modal-closing');
        setTimeout(() => {
            el.classList.add('hidden');
            el.classList.remove('modal-closing');
            (el as any)._closing = false;
            if (onAfterClose) onAfterClose();
        }, 160);
    }

    /* ---------- 4. 保存 / 成功 庆祝 ---------- */

    /**
     * 给某个元素播放"庆祝"动画 (scale bounce + 旋转微调), 完成后清掉 class
     * 用法: celebrateSave(btnEl)
     */
    function celebrateSave(el: HTMLElement | null): void {
        if (!el || REDUCE_MOTION) return;
        el.classList.remove('celebrate-save');
        reflow(el);
        el.classList.add('celebrate-save');
        setTimeout(() => el.classList.remove('celebrate-save'), 600);
    }

    /* ---------- 5. 列表项级联 (替代 app.js 内 playStagger 的副本) ---------- */

    /**
     * 给容器内每个子元素打 --i, 然后触发 itemRise 入场
     * 用法: staggerIn(container, '.comic-page')
     */
    function staggerIn(container: HTMLElement | null, selector?: string): void {
        if (!container) return;
        if (REDUCE_MOTION) {
            container.querySelectorAll(selector || ':scope > *').forEach((el: Element) => {
                (el as HTMLElement).classList.remove('stagger-ready');
                (el as HTMLElement).classList.remove('stagger-item');
            });
            return;
        }
        const kids: NodeListOf<Element> | HTMLCollection = selector
            ? container.querySelectorAll(selector)
            : container.children;
        Array.from(kids).forEach((el: Element, i: number) => {
            (el as HTMLElement).style.setProperty('--i', String(i));
            (el as HTMLElement).classList.remove('stagger-ready', 'stagger-item');
            reflow(el as HTMLElement);
            (el as HTMLElement).classList.add('stagger-item');
        });
    }

    /** 把容器的 _staggerDone 清掉, 让下次 playStagger 能再触发 */
    function resetStagger(container: HTMLElement | null): void {
        if (container) delete (container as any)._staggerDone;
    }

    /* ---------- 6. 视图淡入 (IntersectionObserver 自动级联) ----------
       给静态列表加 view-fade 类, 进入视口时自动 --i + 入场 */

    let _viewObserver: IntersectionObserver | null = null;
    function ensureViewObserver(): IntersectionObserver | null {
        if (_viewObserver) return _viewObserver;
        if (!('IntersectionObserver' in window)) return null;
        _viewObserver = new IntersectionObserver((entries: IntersectionObserverEntry[]) => {
            entries.forEach((entry: IntersectionObserverEntry) => {
                if (!entry.isIntersecting) return;
                const el: HTMLElement = entry.target as HTMLElement;
                _viewObserver!.unobserve(el);
                if ((el as any)._viewFaded) return;
                (el as any)._viewFaded = true;
                // view-fade 的 --i 已由调用者设置, 这里只需去掉 hidden (如有)
                el.style.opacity = '';
                el.style.transform = '';
            });
        }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
        return _viewObserver;
    }

    /**
     * 给一组元素打 view-fade, 让它们进入视口时自动入场
     * 用法: viewFadeOn(els)
     */
    function viewFadeOn(els: HTMLElement[]): void {
        if (REDUCE_MOTION) return;
        const obs: IntersectionObserver | null = ensureViewObserver();
        if (!obs) {
            els.forEach((el: HTMLElement) => el.classList.add('view-fade'));
            return;
        }
        els.forEach((el: HTMLElement, i: number) => {
            el.style.setProperty('--i', String(Math.min(i, 12)));
            el.classList.add('view-fade');
            // 初始隐藏, 等 IO 触发再显示
            el.style.opacity = '0';
            el.style.transform = 'translate3d(0, 12px, 0)';
            obs.observe(el);
        });
    }

    /* ---------- 7. 数字变化反馈 ---------- */

    /** 给数字 chip / count 弹一下 (撞一下, 像卡片翻转) */
    function bumpNumber(el: HTMLElement | null): void {
        if (!el || REDUCE_MOTION) return;
        el.classList.remove('is-bump');
        reflow(el);
        el.classList.add('is-bump');
    }

    /* ---------- 8. 导出 */

    // TODO: strict type
    global.__t2cTransitions = {
        reflow,
        onAnimEnd,
        swapPanel,
        cascadeChildren,
        openModal,
        closeModal,
        celebrateSave,
        staggerIn,
        resetStagger,
        viewFadeOn,
        bumpNumber,
        reduceMotion: REDUCE_MOTION,
    };

})(window);