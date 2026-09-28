/**
 * 任务进度条 (后端不推送进度, 一律用 fake progress 显示)
 * 暴露 createProgressBar / startFakeProgress / finishProgress / hideProgress / registerTaskProgress
 */

import { state } from './state';

export function createProgressBar(containerId: string): string | null {
    const container = document.getElementById(containerId);
    if (!container) return null;
    const progressHtml = `
        <div class="progress-container mt-3">
            <div class="progress-bar" id="${containerId}-bar"></div>
        </div>
        <div class="text-sm text-gray-600 mt-1" id="${containerId}-text">0%</div>
    `;
    container.innerHTML = progressHtml;
    return `${containerId}-bar`;
}

export function startFakeProgress(progressBarId: string, textId: string, minTime: number = 120000): void {
    clearInterval(state.progressInterval);

    const startTime = Date.now();
    // 对数增长曲线：先快后慢，max=90% (留10%给完成时跳到100%)
    // progress = 90 * (1 - exp(-elapsed * k / minTime))
    // 当elapsed=minTime时，progress ≈ 90 * 0.95 → "两分钟走到90%"
    const k = 3.0; // 增长系数 (调到3后, 在minTime处约走完 90% 的95%)

    // 条纹动效表示"任务在跑" (纯 CSS, 不增加定时器负担)
    const activeBar = document.getElementById(progressBarId);
    if (activeBar) activeBar.classList.add('is-active');

    state.progressInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const t = elapsed / minTime;
        // 对数曲线：1 - e^(-kt) 在 t=0 时为0，在 t→∞ 时趋近1
        // k=3 时: t=0.33 → 0.63, t=1.0 → 0.95, t=1.5 → 0.989
        const logProgress = 90 * (1 - Math.exp(-k * t));
        // 加入小波动让进度条看起来更自然
        const jitter = (Math.random() - 0.5) * 0.5;
        const progress = Math.min(90, Math.max(0, logProgress + jitter));

        const bar = document.getElementById(progressBarId);
        const text = document.getElementById(textId);
        // transform 不触发布局, 比 width 更流畅
        if (bar) bar.style.transform = `scaleX(${Math.min(1, Math.max(0, progress / 100))})`;
        if (text) text.textContent = `${Math.floor(progress)}%`;
    }, 200);
}

export function finishProgress(progressBarId: string, textId: string): void {
    clearInterval(state.progressInterval);
    const bar = document.getElementById(progressBarId);
    const text = document.getElementById(textId);
    if (bar) {
        bar.style.transform = 'scaleX(1)';
        // 结束时去掉条纹, 亮度闪一下 (重播需要先移除 class 再强制回流)
        bar.classList.remove('is-active', 'is-done');
        void bar.offsetWidth;
        bar.classList.add('is-done');
    }
    if (text) text.textContent = '100% - 完成';
}

export function hideProgress(containerId: string): void {
    clearInterval(state.progressInterval);
    const container = document.getElementById(containerId);
    if (container) container.innerHTML = '';
}

/**
 * 为某个任务注册进度条并启动 fake progress
 * 返回 { task_id, finish: () => void }
 * task_id 随请求发给后端, 用于云函数 reportProgress 上报 (小程序侧使用)
 */
export function registerTaskProgress(containerId: string): { task_id: string; startFallback: (minTime?: number) => void; finish: () => void } {
    const task_id = 'task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const progressBarId = `${containerId}-bar`;
    const textId = `${containerId}-text`;

    createProgressBar(containerId);

    return {
        task_id,
        startFallback: (minTime: number = 120000) => {
            startFakeProgress(progressBarId, textId, minTime);
        },
        // 强制完成 (HTTP 请求返回时调用)
        finish: () => {
            clearInterval(state.progressInterval);
            finishProgress(progressBarId, textId);
        }
    };
}
