/**
 * fetch 封装 / 通用工具
 * - fetchWithRetry: 指数退避重试
 * - lockButton: 按钮防重入
 * - runWithConcurrency: 限制并发
 */

import { state } from './state';

/**
 * 全局 fetch 拦截器: 给**同源 /api/ 的变更类请求**自动补 X-CSRF-Token.
 *
 * 为什么放在这里而不是逐个调用点加:
 * 本项目散落着不少直接用原生 fetch() 的地方 (bubbles.ts / gallery.ts /
 * workspace.ts / login.html 里的内联脚本), 后端现在对所有变更类 /api/* 强制校验
 * CSRF token, 漏加一个就是**静默 403** —— 表现为"点了没反应", 极难排查.
 * 统一在这里拦, 新增调用点天然免疫.
 */
function getCsrfToken(): string {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return (meta && meta.getAttribute('content')) || '';
}

const _nativeFetch = window.fetch.bind(window);
window.fetch = function (input: any, init: any = {}): Promise<Response> {
    try {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
        const isMutation = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
        if (isMutation && typeof url === 'string' && url.startsWith('/api/')) {
            const token = getCsrfToken();
            if (token) {
                const headers = new Headers((init && init.headers) || (input && input.headers) || {});
                if (!headers.has('X-CSRF-Token')) headers.set('X-CSRF-Token', token);
                init = { ...(init || {}), headers };
            }
        }
    } catch (e) {
        // 拦截器本身绝不能把请求搞挂, 放行原样交给浏览器
    }
    return _nativeFetch(input, init);
};

/**
 * 带指数退避重试的 fetch
 * 内网穿透场景下，网络波动可能导致请求失败，自动重试提高成功率
 */
export async function fetchWithRetry(url: string, options: any = {}, maxRetries: number = state.MAX_RETRIES): Promise<Response> {
    let lastError: any;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(url, options);
            if (!response.ok && attempt < maxRetries) {
                throw new Error(`HTTP ${response.status}`);
            }
            return response;
        } catch (e) {
            lastError = e;
            if (attempt < maxRetries) {
                const delay = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 1000, 15000);
                console.log(`Retry ${attempt + 1}/${maxRetries} for ${url} after ${Math.round(delay)}ms`);
                await new Promise(r => setTimeout(r, delay));
            }
        }
    }
    throw lastError;
}

/**
 * 按钮冷却: 点击后禁用按钮, 文字改为"生成中…", 直到 finally 重新启用
 * 避免用户连点重复请求
 * 用法:
 *   const btn = document.getElementById('xxx-btn');
 *   const unlock = lockButton(btn, document.getElementById('xxx-label'));
 *   try { ... } finally { unlock(); }
 */
export function lockButton(btn: HTMLElement | null, labelEl: HTMLElement | null, busyText?: string): () => void {
    if (!btn) return () => {};
    const originalText = labelEl ? labelEl.textContent : null;
    const wasDisabled = (btn as HTMLButtonElement).disabled;
    (btn as HTMLButtonElement).disabled = true;
    btn.classList.add('opacity-60', 'cursor-not-allowed');
    if (labelEl && busyText) labelEl.textContent = busyText;
    return function unlock() {
        (btn as HTMLButtonElement).disabled = wasDisabled;
        btn.classList.remove('opacity-60', 'cursor-not-allowed');
        if (labelEl && originalText !== null) labelEl.textContent = originalText;
    };
}

export async function runWithConcurrency<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
    const results: Promise<T>[] = [];
    const executing: Promise<T>[] = [];
    for (const task of tasks) {
        const p = task().then(r => { executing.splice(executing.indexOf(p as any), 1); return r; });
        executing.push(p);
        results.push(p);
        if (executing.length >= limit) {
            await Promise.race(executing);
        }
    }
    return Promise.all(results);
}

/* ===== 会话恢复 / 同步 ===== */

/**
 * 页面加载时从服务器恢复会话数据
 * 内网穿透断开后刷新页面，自动找回之前生成的结果
 */
export async function recoverSession(): Promise<void> {
    try {
        // 恢复分镜数据
        const segResponse = await fetchWithRetry('/api/results/segments', { credentials: 'include' }, 1);
        const segResult: any = await segResponse.json();
        if (segResult.success && segResult.data) {
            state.currentSegments = segResult.data;
            console.log('Recovered segments from server');
        }

        // 恢复角色数据
        const charResponse = await fetchWithRetry('/api/results/characters', { credentials: 'include' }, 1);
        const charResult: any = await charResponse.json();
        if (charResult.success && charResult.data && charResult.data.characters) {
            state.characters = charResult.data.characters;
            console.log('Recovered characters from server');
        }

        // 恢复单图映射
        const imgResponse = await fetchWithRetry('/api/results/images', { credentials: 'include' }, 1);
        const imgResult: any = await imgResponse.json();
        if (imgResult.success && imgResult.data && imgResult.data.images) {
            for (const item of imgResult.data.images) {
                if (item.key) {
                    state.generatedImages[item.key] = item.local_url;
                }
            }
            console.log(`Recovered ${imgResult.data.images.length} images from server`);
        }

        // 恢复整页映射
        const fpResponse = await fetchWithRetry('/api/results/full_pages', { credentials: 'include' }, 1);
        const fpResult: any = await fpResponse.json();
        if (fpResult.success && fpResult.data && fpResult.data.pages) {
            for (const item of fpResult.data.pages) {
                if (item.key !== undefined) {
                    state.fullPageImages[item.key] = item.local_url;
                    if (item.clean_url) state.fullPageCleanImages[item.key] = item.clean_url;
                    if (item.bubbles) state.fullPageBubbles[item.key] = item.bubbles;
                }
            }
            console.log(`Recovered ${fpResult.data.pages.length} full pages from server`);
        }

        // 兼容旧会话: 恢复历史拼版图映射
        try {
            const cpResponse = await fetchWithRetry('/api/results/combined_pages', { credentials: 'include' }, 1);
            const cpResult: any = await cpResponse.json();
            if (cpResult.success && cpResult.data && cpResult.data.pages) {
                for (const item of cpResult.data.pages) {
                    if (item.key !== undefined) {
                        state.combinedPageImages[item.key] = item.local_url;
                    }
                }
                console.log(`Recovered ${cpResult.data.pages.length} combined pages from server`);
            }
        } catch (e: any) {
            console.log('Combined pages recovery skipped:', e.message);
        }

        // 恢复漫画转小说结果
        const c2nResponse = await fetchWithRetry('/api/results/comic2novel', { credentials: 'include' }, 1);
        const c2nResult: any = await c2nResponse.json();
        if (c2nResult.success && c2nResult.data && c2nResult.data.novel_text) {
            state.comicNovelResult = c2nResult.data;
            // 渲染逻辑由 comic2novel 模块注入
            const w: any = window;
            if (typeof w.renderComicNovelResult === 'function') w.renderComicNovelResult();
            console.log('Recovered comic-to-novel result from server');
        }

        // 恢复后重新渲染
        const w: any = window;
        if (state.currentSegments.pages && state.currentSegments.pages.length > 0) {
            if (typeof w.renderSegments === 'function') w.renderSegments();
            if (typeof w.renderGallery === 'function') w.renderGallery();
        }
        if (state.characters.length > 0) {
            if (typeof w.renderCharacters === 'function') w.renderCharacters();
        }
    } catch (e: any) {
        console.log('Session recovery skipped:', e.message);
    }
}

/**
 * 将前端当前状态同步到服务器
 */
export async function syncResults(): Promise<void> {
    try {
        await fetchWithRetry('/api/sync/results', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                segments: state.currentSegments,
                characters: { characters: state.characters },
                generatedImages: state.generatedImages,
                fullPageImages: state.fullPageImages,
                combinedPageImages: state.combinedPageImages,
                fullPageCleanImages: state.fullPageCleanImages,
                fullPageBubbles: state.fullPageBubbles,
                comic2novel: state.comicNovelResult
            })
        }, 1);
    } catch (e: any) {
        console.log('Sync results failed:', e.message);
    }
}

/* ===== 认证 ===== */

export async function handleLogout(): Promise<void> {
    try {
        await fetch('/api/logout', { method: 'POST', credentials: 'include' });
        window.location.href = '/app';
    } catch (e) {
        window.location.href = '/app';
    }
}

export async function checkAuth(): Promise<void> {
    try {
        const response = await fetch('/api/check-auth', { credentials: 'include' });
        const result: any = await response.json();
        if (!result.logged_in) {
            window.location.href = '/app';
        }
    } catch (e) {
        window.location.href = '/app';
    }
}
