/**
 * 角色管理: renderCharacters / analyzeCharacters / clearCharacters
 *   图片上传 (压缩 / 应用 / 拖拽落点)
 *   人设 prompt 编辑 (实时预览 + debounced sync)
 */

import { state } from './state';
import { motionReduced, escapeHtml, playStagger, popIn } from './ui';
import { showToast, showLoadingToast, dismissLoadingToast } from './toast';
import { fetchWithRetry, lockButton, syncResults } from './api';
import { registerTaskProgress } from './progress';
import { openConfigModal } from './modals';
import { switchTab } from './tabs';

export async function analyzeCharacters(): Promise<void> {
    const text = (document.getElementById('novel-text') as HTMLTextAreaElement).value.trim();
    if (!text) {
        showToast('请先输入小说内容', 'error');
        switchTab('input');
        return;
    }

    const config: any = JSON.parse(localStorage.getItem('manga_config') || '{}');
    if (!config.llm_api_url) {
        showToast('请先配置API', 'error');
        openConfigModal();
        return;
    }

    const spinner = document.getElementById('analyze-spinner');
    spinner?.classList.remove('hidden');

    const unlock = lockButton(
        document.getElementById('analyze-characters-btn'),
        document.getElementById('analyze-characters-label'),
        '角色分析中…'
    );

    // 任务进度条 (后端不推送, fake progress 展示)
    const task = registerTaskProgress('analyze-progress');
    task.startFallback(120000);

    try {
        const response = await fetchWithRetry('/api/generate-characters', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                text: text,
                api_url: config.llm_api_url,
                api_key: config.llm_api_key,
                model: config.llm_model,
                task_id: task.task_id
            })
        });

        const result: any = await response.json();
        task.finish();
        if (result.success) {
            const newChars = result.data.characters || [];
            // 合并而非替换: 用名字去重, 名字相同的优先保留新分析结果
            // 但保留旧的图片 (image_url, char_prompt), 避免人设图丢失
            const merged: any[] = [];
            const matchedOldIdx = new Set();
            for (const nc of newChars) {
                const ncName = (nc.name || '').trim();
                const oldIdx = state.characters.findIndex((oc: any) => (oc.name || '').trim() === ncName);
                if (oldIdx !== -1) {
                    matchedOldIdx.add(oldIdx);
                    // 新数据优先, 但保留旧的 image_url 和 char_prompt
                    const old = state.characters[oldIdx];
                    merged.push({
                        ...old,    // 保留图片/prompt
                        ...nc,     // 新的描述/名字等
                        image_url: old.image_url || nc.image_url || '',
                        char_prompt: old.char_prompt || nc.char_prompt || '',
                    });
                } else {
                    merged.push({ ...nc, char_prompt: nc.char_prompt || '' });
                }
            }
            // 也保留旧的角色 (防止 LLM 没分析出来的角色消失)
            for (let i = 0; i < state.characters.length; i++) {
                if (!matchedOldIdx.has(i)) {
                    merged.push(state.characters[i]);
                }
            }
            state.characters = merged;
            renderCharacters();
            syncResults();  // 主动同步角色数据到服务器
            const keptCount = merged.length - newChars.length;
            const msg = keptCount > 0
                ? `分析 ${newChars.length} 个角色, 保留旧角色 ${keptCount} 个`
                : `成功分析 ${state.characters.length} 个角色`;
            showToast(msg, 'success');
        } else {
            showToast(result.error || '分析失败', 'error');
        }
    } catch (e: any) {
        task.finish();
        showToast('请求失败: ' + e.message, 'error');
    } finally {
        spinner?.classList.add('hidden');
        unlock();
    }
}

/**
 * 清空所有角色 (用户切换小说/重新开始时使用)
 * 同时清除分镜中对角色的引用, 避免悬空引用
 */
export function clearCharacters(): void {
    if (state.characters.length === 0) {
        showToast('角色列表已为空', 'info');
        return;
    }
    if (!confirm(`确认清空所有 ${state.characters.length} 个角色吗?\n\n此操作会同时清除分镜中对角色的引用, 无法撤销。`)) return;

    state.characters = [];
    // 清除分镜中对角色的引用 (selected_characters)
    if (state.currentSegments && state.currentSegments.pages) {
        state.currentSegments.pages.forEach((page: any) => {
            (page.segments || []).forEach((seg: any) => {
                seg.selected_characters = [];
            });
        });
    }
    renderCharacters();
    const w: any = window;
    if (typeof w.renderSegments === 'function') w.renderSegments();
    syncResults();  // 同步到服务器
    showToast('已清空所有角色', 'success');
}

export function renderCharacters(): void {
    const container = document.getElementById('characters-container');
    if (!container) return;
    // 重新渲染前清掉 stagger 标记, 让 playStagger / staggerIn 能再触发级联
    const t: any = (window as any).__t2cTransitions;
    if (t) t.resetStagger(container);
    if (state.characters.length === 0) {
        container.innerHTML = `<div class="col-span-full empty-state">
            <span class="es-halftone" aria-hidden="true"></span>
            <div class="es-icon" data-icon="masks"></div>
            <p class="es-title">还没有角色</p>
            <p class="es-hint">点下面的按钮，模型会从小说的前 8000 字里挑出主要出场角色，并给出外貌与性格描述。</p>
            <button onclick="analyzeCharacters()" class="btn-primary px-5 py-2 text-sm font-medium">从小说分析角色</button>
        </div>`;
        return;
    }

    container.innerHTML = state.characters.map((char: any, idx: number) => {
        const safeImageUrl = escapeHtml(char.image_url || '');
        return `
        <div class="bg-white p-4 manga-border panel-shadow upload-zone">
            <div class="flex justify-between items-start mb-2">
                <h3 class="text-lg font-bold">${escapeHtml(char.name)}</h3>
                <button onclick="togglePromptEditor(${idx})" class="text-xs border border-gray-300 rounded px-2 py-0.5 hover:bg-gray-100 transition-colors" title="编辑人设图生成提示词" id="prompt-toggle-${idx}">✏️ Prompt</button>
            </div>
            <p class="text-sm text-gray-600 mb-3">${escapeHtml(char.description)}</p>
            ${char.image_url ? `
            <div class="mb-3 border-2 border-gray-300 relative group">
                <img src="${safeImageUrl}" class="w-full h-48 object-cover cursor-pointer" onclick="openModal('${safeImageUrl}')">
                <div class="absolute top-1 right-1 hidden group-hover:flex gap-1">
                    <button onclick="event.stopPropagation(); uploadCharacterImage(${idx})" class="bg-white border-2 border-black text-xs px-2 py-1 hover:bg-yellow-200" title="手动上传/更换图片">📁 换图</button>
                </div>
            </div>
            ` : ''}
            <div id="prompt-editor-${idx}" class="hidden mb-3">
                <label class="block text-xs font-medium text-gray-600 mb-1">图像生成提示词 (空=自动生成)</label>
                <textarea id="char-prompt-${idx}" rows="3" class="w-full text-xs border border-gray-300 rounded p-2 font-mono" oninput="saveCharPrompt(${idx}, this.value)" onblur="saveCharPrompt(${idx}, this.value)">${escapeHtml(char.char_prompt || '')}</textarea>
                <div class="text-xs text-gray-500 mt-1">
                    实时同步 · 当前提示词:
                    <code class="text-gray-800" id="char-prompt-preview-${idx}">${escapeHtml(char.char_prompt || '(自动生成)')}</code>
                </div>
            </div>
            <div class="flex gap-2">
                <button onclick="generateCharacterImage(${idx}, this)" class="flex-1 btn-primary py-2 text-sm">
                    ${char.image_url ? '重新生成' : '生成人设图'}
                </button>
                <button onclick="uploadCharacterImage(${idx})" class="flex-1 bg-gray-700 text-white py-2 text-sm hover:bg-gray-800 transition-colors">
                    📁 ${char.image_url ? '更换' : '上传'}
                </button>
            </div>
            <input type="file" id="char-upload-${idx}" accept="image/*" class="hidden" onchange="handleCharacterImageFile(${idx}, this)">
        </div>
    `;}).join('');

    // 角色卡片级联入场
    playStagger(container);
    markDirtyLocal();
    const w: any = window;
    if (typeof w.scheduleWorkspaceUI === 'function') w.scheduleWorkspaceUI();
}

function markDirtyLocal(): void {
    const w: any = window;
    if (typeof w.markDirty === 'function') w.markDirty();
}

export function togglePromptEditor(idx: number): void {
    const editor = document.getElementById(`prompt-editor-${idx}`);
    if (editor) editor.classList.toggle('hidden');
}

export function saveCharPrompt(idx: number, value: string): void {
    if (!state.characters[idx]) return;
    // 始终更新内存, 防止用户改完没失焦直接点按钮
    state.characters[idx].char_prompt = value;
    // 实时预览回显 (无字符=空, 空=自动生成)
    const preview = document.getElementById(`char-prompt-preview-${idx}`);
    if (preview) preview.textContent = value.trim() || '(自动生成)';
    // 标记需要同步, debounce 到 1s 后再发请求, 避免每键一调
    const w: any = window;
    if (!w._charPromptTimers) w._charPromptTimers = {};
    if (w._charPromptTimers[idx]) clearTimeout(w._charPromptTimers[idx]);
    w._charPromptTimers[idx] = setTimeout(() => {
        syncResults();
    }, 1000);
}

/* ============================================================
 * 角色图片上传 (手动 / 拖拽) + 压缩
 * ============================================================ */

// ===== 角色图片手动上传 =====
export function uploadCharacterImage(idx: number): void {
    const input = document.getElementById(`char-upload-${idx}`);
    if (input) input.click();
}

export function handleCharacterImageFile(idx: number, input: HTMLInputElement): void {
    const file = input.files && input.files[0];
    if (!file) return;
    // 清空 input, 允许再次选同一张图 (放在前面, 失败路径也能再次选择)
    input.value = '';
    if (!file.type.startsWith('image/')) {
        showToast('请选择图片文件', 'error');
        return;
    }
    // 限制 5MB, 避免 dataURL 太大撑爆 storage
    if (file.size > 5 * 1024 * 1024) {
        showToast('图片超过 5MB, 请压缩后再上传', 'error');
        return;
    }
    const reader = new FileReader();
    reader.onload = (e: any) => {
        const dataUrl = e.target.result;
        // 缩放到最长边 1024px, 保留原格式 (PNG 透明 / EXIF 旋转)
        compressImage(dataUrl, 1024).then((compressed) => {
            applyCharacterImage(idx, compressed, false);
        }).catch((err) => {
            // 缩放失败时直接用原图, 但要再做一次格式判断避免 5MB dataURL 持久化
            applyCharacterImage(idx, dataUrl, true);
        });
    };
    reader.onerror = () => {
        showToast('读取图片失败', 'error');
    };
    reader.readAsDataURL(file);
}

export function applyCharacterImage(idx: number, dataUrl: string, isUncompressedFallback: boolean): void {
    // idx 在异步 FileReader / compressImage 期间可能 stale (角色被删/重排), 守一道
    if (!state.characters[idx]) {
        showToast('角色已不存在，请重新选择', 'error');
        return;
    }
    // 原图 fallback 时, 若 >500KB 也放弃, 防止 state.json 被撑爆
    const approxBytes = Math.round(dataUrl.length * 3 / 4);
    if (isUncompressedFallback && approxBytes > 500 * 1024) {
        showToast(`「${state.characters[idx].name}」图片格式不支持，已跳过`, 'error');
        return;
    }
    state.characters[idx].image_url = dataUrl;
    renderCharacters();
    // 关键: 分镜页"出场角色"复选框也依赖 image_url 决定 disabled 状态,
    // 上传/AI 生成后必须刷新, 否则用户看到 checkbox 仍 disabled
    const w: any = window;
    if (typeof w.renderSegments === 'function') w.renderSegments();
    syncResults();
    // 关键: 同步保存到当前作品 state.json, 否则刷新/历史加载就丢失
    if (typeof w.saveCurrentState === 'function') {
        w.saveCurrentState().catch((e: any) => console.error('save character image failed:', e));
    }
    const tail = isUncompressedFallback ? ' (未压缩)' : '';
    showToast(`「${state.characters[idx].name}」人设图已更新${tail}`, 'success');
}

export function compressImage(dataUrl: string, maxSide: number): Promise<string> {
    return new Promise((resolve, reject) => {
        // 检测源格式 — PNG 带 alpha 必须保留, JPEG/HEIC 等可直接压 JPEG
        const srcMatch = (dataUrl.match(/^data:image\/(\w+);/) || [])[1] || '';
        const srcType = srcMatch.toLowerCase();
        // 目标格式: png/webp/gif 透明格式 → png; 其它 → jpeg
        const keepAlpha = (srcType === 'png' || srcType === 'webp' || srcType === 'gif');
        const outMime = keepAlpha ? 'image/png' : 'image/jpeg';
        const quality = keepAlpha ? undefined : 0.85;

        const img = new Image();
        img.onload = () => {
            try {
                // 处理 EXIF 方向: HTMLImageElement 不解析 EXIF, 用 createImageBitmap('from-image')
                let drawW = img.naturalWidth, drawH = img.naturalHeight;
                if (typeof createImageBitmap === 'function') {
                    // fetch blob → bitmap (EXIF 友好); 走 image.src 拿不到 EXIF
                    fetch(dataUrl).then(r => r.blob()).then(blob => {
                        createImageBitmap(blob, { imageOrientation: 'from-image' } as any).then(bmp => {
                            drawW = bmp.width; drawH = bmp.height;
                            _drawToDataUrl(bmp, drawW, drawH, maxSide, outMime, quality, resolve, reject);
                        }).catch(() => {
                            _drawToDataUrl(img, img.naturalWidth, img.naturalHeight, maxSide, outMime, quality, resolve, reject);
                        });
                    }).catch(() => {
                        _drawToDataUrl(img, img.naturalWidth, img.naturalHeight, maxSide, outMime, quality, resolve, reject);
                    });
                } else {
                    _drawToDataUrl(img, img.naturalWidth, img.naturalHeight, maxSide, outMime, quality, resolve, reject);
                }
            } catch (e) {
                reject(e);
            }
        };
        img.onerror = () => reject(new Error('image load failed'));
        img.src = dataUrl;
    });
}

function _drawToDataUrl(src: any, w0: number, h0: number, maxSide: number, outMime: string, quality: number | undefined, resolve: (s: string) => void, reject: (e: any) => void): void {
    try {
        let w = w0, h = h0;
        if (Math.max(w, h) > maxSide) {
            if (w >= h) {
                h = Math.round(h * maxSide / w);
                w = maxSide;
            } else {
                w = Math.round(w * maxSide / h);
                h = maxSide;
            }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        // PNG 透明格式用白色背景填底 (避免 toDataURL('image/png') 在某些浏览器把 alpha 变成黑)
        if (outMime === 'image/jpeg') {
            if (ctx) {
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, w, h);
            }
        }
        if (ctx) ctx.drawImage(src, 0, 0, w, h);
        resolve(canvas.toDataURL(outMime, quality));
    } catch (e) {
        reject(e);
    }
}

/* ============================================================
 * 角色图片生成 (AI)
 * ============================================================ */

export async function generateCharacterImage(idx: number, btn: HTMLButtonElement | null = null): Promise<void> {
    const char = state.characters[idx];
    // 强制从 DOM 同步最新 prompt 到内存 (用户可能还在输入没失焦)
    const promptEl = document.getElementById(`char-prompt-${idx}`) as HTMLTextAreaElement | null;
    if (promptEl && state.characters[idx]) {
        state.characters[idx].char_prompt = promptEl.value;
    }
    const config: any = JSON.parse(localStorage.getItem('manga_config') || '{}');
    if (!config.img_api_url) {
        showToast('请先配置图像生成API', 'error');
        openConfigModal();
        return;
    }

    // 防重入: 同一个按钮在请求进行中点击, 直接放弃
    if (btn && btn.dataset.busy === '1') return;
    if (btn) {
        btn.dataset.busy = '1';
        btn.disabled = true;
        btn.classList.add('opacity-60', 'cursor-not-allowed');
    }

    // 显示"基线图生成中"提示
    const toastId = showLoadingToast(`正在为「${char.name}」生成基线人设图…`);

    try {
        const response = await fetchWithRetry('/api/generate-character-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                name: char.name,
                description: char.description,
                prompt: char.char_prompt || '',  // 用户自定义 prompt, 空 = 自动生成
                api_url: config.img_api_url,
                api_key: config.img_api_key,
                model: config.img_model,
                comic_mode: state.comicMode,
                max_attempts: 3
            })
        });

        const result: any = await response.json();
        if (result.success) {
            state.characters[idx].image_url = result.image_url;
            renderCharacters();
            // 关键: 分镜页复选框也需刷新, 否则上传后仍是 disabled
            const w: any = window;
            if (typeof w.renderSegments === 'function') w.renderSegments();
            syncResults();
            // 关键: 同步保存到当前作品 state.json, 否则刷新/历史加载就丢失
            if (typeof w.saveCurrentState === 'function') {
                w.saveCurrentState().catch((e: any) => console.error('save AI char image failed:', e));
            }
            const attemptInfo = result.attempts > 1
                ? ` (尝试 ${result.attempts}/${result.max_attempts || 3} 次拿到合格基线图)`
                : '';
            dismissLoadingToast(toastId);
            showToast(`${char.name} 人设图生成成功${attemptInfo}`, 'success');
        } else {
            dismissLoadingToast(toastId);
            showToast(result.error || '生成失败', 'error');
        }
    } catch (e: any) {
        dismissLoadingToast(toastId);
        showToast('请求失败: ' + e.message, 'error');
    } finally {
        if (btn) {
            btn.dataset.busy = '';
            btn.disabled = false;
            btn.classList.remove('opacity-60', 'cursor-not-allowed');
            // 重新渲染以恢复原 label (生成人设图 / 重新生成人设图)
            renderCharacters();
        }
    }
}
