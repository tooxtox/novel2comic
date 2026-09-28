/**
 * PWA: 注册 Service Worker
 *   失败不影响主流程
 */

export function registerSW(): void {
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
        navigator.serviceWorker.register('/static/sw.js').catch((err) => console.warn('[PWA] SW register failed:', err));
    }
}
