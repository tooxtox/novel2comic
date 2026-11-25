/**
 * 拖拽上传: 角色人设图卡片与漫画转小说上传区均支持拖拽文件落入
 */

import { showToast } from './toast';

function bindDropZone(input: HTMLInputElement, zone: HTMLElement): void {
  if (zone.dataset.ddBound === '1') return;
  zone.dataset.ddBound = '1';

  ['dragenter', 'dragover'].forEach(ev => {
    zone.addEventListener(ev, (e) => {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.add('is-drag-over');
    });
  });

  ['dragleave', 'drop'].forEach(ev => {
    zone.addEventListener(ev, (e) => {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.remove('is-drag-over');
    });
  });

  zone.addEventListener('drop', (e: any) => {
    const files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) return;
    try {
      const dt = new DataTransfer();
      Array.from(files).forEach((f: any) => dt.items.add(f));
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      showToast('已接收 ' + files.length + ' 个文件', 'success');
    } catch (err: any) {
      showToast('拖拽上传失败: ' + err.message, 'error');
    }
  });
}

export function setupDragDropUpload(): void {
  // 1. 角色卡片拖拽上传
  const charInputs = document.querySelectorAll('[id^="char-upload-"]');
  charInputs.forEach(node => {
    const input = node as HTMLInputElement;
    const zone = (input.closest('.upload-zone, label, div') as HTMLElement | null) || input.parentElement;
    if (zone) bindDropZone(input, zone);
  });

  // 2. 漫画转小说上传落区
  const comicInput = document.getElementById('comic-file-input') as HTMLInputElement | null;
  const comicZone = document.getElementById('comic-upload-zone');
  if (comicInput && comicZone) {
    bindDropZone(comicInput, comicZone);
  }
}
