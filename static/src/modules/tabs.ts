/**
 * 标签页切换: switchTab / mTabClass / moveInk / refreshInks / staggerPanel / goStep
 */

import { state } from './state';
import { motionReduced } from './ui';

export function switchTab(tabName: string): void {
    if (tabName === state.currentTab) return;
    // 入场方向跟随点击方向: 往右边的 tab 点 → 新面板从右侧滑入
    const dir = state.tabs.indexOf(tabName) >= state.tabs.indexOf(state.currentTab) ? 'right' : 'left';
    const fromTab = state.currentTab;
    // 顶部 tab / 移动 tab 样式立即切换 (独立于面板退场动画)
    state.tabs.forEach(t => {
        const topTab = document.getElementById(`tab-${t}`);
        if (topTab) topTab.className = t === tabName ? 'tab-active pb-2 px-1 text-lg transition-all' : 'tab-inactive pb-2 px-1 text-lg transition-all';
        const mtab = document.getElementById(`mtab-${t}`);
        if (mtab) mTabClass(mtab, t === tabName);
    });
    // 走 __t2cTransitions.swapPanel 编排: 旧面板退出 → 新面板进入 → 首屏子级联
    const t: any = (window as any).__t2cTransitions;
    if (t) {
        t.swapPanel(`panel-${fromTab}`, `panel-${tabName}`, dir).then(() => {
            state.currentTab = tabName;
            staggerPanel(document.getElementById(`panel-${tabName}`));
            refreshInks();
            const w: any = window;
            if (typeof w.updateWorkspaceUI === 'function') w.updateWorkspaceUI();
            if (tabName === 'history') {
                if (typeof w.refreshCurrentHistoryList === 'function') w.refreshCurrentHistoryList();
            }
        });
    } else {
        // 兜底 (transitions.js 加载失败时)
        const oldPanel = document.getElementById(`panel-${fromTab}`);
        if (oldPanel) oldPanel.classList.add('hidden');
        const panel = document.getElementById(`panel-${tabName}`);
        if (!panel) return;
        panel.classList.remove('hidden');
        panel.classList.remove('fade-in', 'panel-in-left', 'panel-in-right');
        void panel.offsetWidth;
        panel.classList.add(dir === 'right' ? 'panel-in-right' : 'panel-in-left');
        state.currentTab = tabName;
        staggerPanel(panel);
        refreshInks();
        const w: any = window;
        if (typeof w.updateWorkspaceUI === 'function') w.updateWorkspaceUI();
        if (tabName === 'history') {
            if (typeof w.refreshCurrentHistoryList === 'function') w.refreshCurrentHistoryList();
        }
    }
}

// 移动端 tab className 切换 (抽出来便于复用, 同时应用 mtab-spring 弹跳)
export function mTabClass(el: HTMLElement, isActive: boolean): void {
    el.className = isActive ? 'mtab-active mtab-spring' : 'mtab-inactive';
}

/** 流程条点击: 跳到对应标签页 */
export function goStep(tab: string): void {
    switchTab(tab);
}

/** 滑动指示器: 把一个绝对定位的墨条移到当前项下面 */
export function moveInk(boxId: string, activeEl: HTMLElement | null, inkId: string): void {
    const box = document.getElementById(boxId);
    const ink = document.getElementById(inkId);
    if (!box || !ink || !activeEl) return;
    const boxRect = box.getBoundingClientRect();
    const itemRect = activeEl.getBoundingClientRect();
    if (!itemRect.width) return;
    ink.style.width = itemRect.width + 'px';
    ink.style.transform = `translateX(${itemRect.left - boxRect.left}px)`;
    ink.classList.add('is-ready');
}

export function refreshInks(): void {
    moveInk('main-tabs', document.getElementById(`tab-${state.currentTab}`), 'tab-ink');
    moveInk('mtab-grid', document.getElementById(`mtab-${state.currentTab}`), 'mtab-pill');
    const subId = (state._historySub === 'writing') ? 'hist-sub-writing' : 'hist-sub-comic';
    moveInk('hist-subtabs', document.getElementById(subId), 'hist-ink');
}

/** 切换标签页时, 让面板第一层内容依次落位 */
export function staggerPanel(panel: HTMLElement | null): void {
    if (!panel || motionReduced()) return;
    Array.from(panel.children).forEach((el: any, i: number) => {
        const delay = Math.min(i * 35, 210);
        el.style.transition = 'opacity .38s var(--ease-out-expo), transform .38s var(--ease-out-expo)';
        el.style.transitionDelay = delay + 'ms';
        el.style.opacity = '0';
        el.style.transform = 'translateY(10px)';
        requestAnimationFrame(() => {
            el.style.opacity = '1';
            el.style.transform = 'none';
        });
        setTimeout(() => {
            el.style.transition = '';
            el.style.transitionDelay = '';
            el.style.opacity = '';
            el.style.transform = '';
        }, 760 + delay);
    });
}
