/**
 * 漫画转小说: 上传漫画图片 → LLM 解读 → 输出小说文本
 *   handleComicUpload / renderComicPreviews / removeComicImage / clearComicUpload
 *   startComicToNovel / renderComicNovelResult / copyNovelText / downloadNovelText
 */

import { state } from './state';
import { showToast } from './toast';
import { fetchWithRetry, syncResults } from './api';
import { registerTaskProgress } from './progress';
import { openConfigModal } from './modals';

/**
 * 处理漫画图片上传
 */
export function handleComicUpload(event: Event): void {
    const target = event.target as HTMLInputElement;
    const files = target.files;
    if (!files || files.length === 0) return;

    const previewContainer = document.getElementById('comic-preview-container');
    const thumbsContainer = document.getElementById('comic-preview-thumbs');
    const fileCount = document.getElementById('comic-file-count');

    let loaded = 0;
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const reader = new FileReader();
        reader.onload = function(e: any) {
            state.comicUploadedImages.push({
                name: file.name,
                data: e.target.result,
                pageIndex: state.comicUploadedImages.length
            });
            loaded++;
            if (loaded === files.length) {
                renderComicPreviews();
                previewContainer?.classList.remove('hidden');
                if (fileCount) fileCount.textContent = String(state.comicUploadedImages.length);
                showToast(`已加载 ${state.comicUploadedImages.length} 张图片`, 'success');
            }
        };
        reader.readAsDataURL(file);
    }
}

/**
 * 渲染漫画上传预览缩略图
 */
export function renderComicPreviews(): void {
    const container = document.getElementById('comic-preview-thumbs');
    if (!container) return;
    container.innerHTML = state.comicUploadedImages.map((img: any, idx: number) => `
        <div class="flex-shrink-0 w-32 border-2 border-gray-300 p-1 relative group">
            <img src="${img.data}" class="w-full h-24 object-cover">
            <div class="text-xs text-center text-gray-500 mt-1">第${idx + 1}页</div>
            <button onclick="removeComicImage(${idx})" class="absolute -top-2 -right-2 bg-red-600 text-white w-5 h-5 rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
        </div>
    `).join('');
}

/**
 * 移除已上传的漫画图片
 */
export function removeComicImage(idx: number): void {
    state.comicUploadedImages.splice(idx, 1);
    if (state.comicUploadedImages.length === 0) {
        document.getElementById('comic-preview-container')?.classList.add('hidden');
        document.getElementById('comic2novel-output')?.classList.add('hidden');
    } else {
        renderComicPreviews();
        const fc = document.getElementById('comic-file-count');
        if (fc) fc.textContent = String(state.comicUploadedImages.length);
    }
}

/**
 * 清空所有已上传图片
 */
export function clearComicUpload(): void {
    state.comicUploadedImages = [];
    document.getElementById('comic-preview-container')?.classList.add('hidden');
    document.getElementById('comic2novel-output')?.classList.add('hidden');
    const fi = document.getElementById('comic-file-input') as HTMLInputElement | null;
    if (fi) fi.value = '';
    showToast('已清空所有图片', 'info');
}

/**
 * 开始漫画转小说
 */
export async function startComicToNovel(): Promise<void> {
    if (state.comicUploadedImages.length === 0) {
        showToast('请先上传漫画图片', 'error');
        return;
    }

    const config: any = JSON.parse(localStorage.getItem('manga_config') || '{}');
    if (!config.llm_api_url) {
        showToast('请先在API配置中填写LLM接口地址', 'error');
        openConfigModal();
        return;
    }

    const visionModel = (document.getElementById('vision-model') as HTMLInputElement | null)?.value || 'gpt-4o';
    const btn = document.getElementById('comic2novel-btn') as HTMLButtonElement | null;
    const spinner = document.getElementById('comic2novel-spinner');

    if (btn) btn.disabled = true;
    spinner?.classList.remove('hidden');

    // 任务进度条 (后端不推送, fake progress 展示)
    const task = registerTaskProgress('comic2novel-progress');
    task.startFallback(120000);

    try {
        const response = await fetchWithRetry('/api/comic-to-novel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                images: state.comicUploadedImages.map((img: any) => img.data),
                api_url: config.llm_api_url,
                api_key: config.llm_api_key,
                model: visionModel,
                task_id: task.task_id
            })
        }, 2);

        const result: any = await response.json();
        task.finish();

        if (result.success) {
            state.comicNovelResult = result.data;
            renderComicNovelResult();
            showToast('小说生成成功！', 'success');
            syncResults();
        } else {
            showToast(result.error || '转换失败', 'error');
        }
    } catch (e: any) {
        task.finish();
        showToast('请求失败: ' + e.message, 'error');
    } finally {
        if (btn) btn.disabled = false;
        spinner?.classList.add('hidden');
    }
}

/**
 * 显示漫画转小说结果
 */
export function renderComicNovelResult(): void {
    const outputDiv = document.getElementById('comic2novel-output');
    const textDiv = document.getElementById('comic2novel-text');
    if (!outputDiv || !textDiv || !state.comicNovelResult) return;

    outputDiv.classList.remove('hidden');
    textDiv.textContent = state.comicNovelResult.novel_text || '（未生成文本）';

    outputDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * 复制小说文本到剪贴板
 */
export function copyNovelText(): void {
    if (!state.comicNovelResult || !state.comicNovelResult.novel_text) {
        showToast('没有可复制的内容', 'error');
        return;
    }
    navigator.clipboard.writeText(state.comicNovelResult.novel_text).then(() => {
        showToast('已复制到剪贴板', 'success');
    }).catch(() => {
        const textarea = document.createElement('textarea');
        textarea.value = state.comicNovelResult.novel_text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showToast('已复制到剪贴板', 'success');
    });
}

/**
 * 下载小说文本为 .txt 文件
 */
export function downloadNovelText(): void {
    if (!state.comicNovelResult || !state.comicNovelResult.novel_text) {
        showToast('没有可下载的内容', 'error');
        return;
    }
    const blob = new Blob([state.comicNovelResult.novel_text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `comic_to_novel_${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('下载成功', 'success');
}
