/**
 * 拖拽上传: 角色图片上传框支持拖拽文件落入
 *   setupDragDropUpload
 */

import { showToast } from './toast';

export function setupDragDropUpload(): void {
  const inputs = document.querySelectorAll('[id^="char-upload-"]');
  inputs.forEach(input => {
    const zone = (input.closest('.upload-zone, label, div') as HTMLElement | null) || input.parentElement;
    if (!zone) return;
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
        Array.from(files).forEach(f => dt.items.add(f));
        (input as HTMLInputElement).files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        showToast('已接收 ' + files.length + ' 个文件', 'success');
      } catch (err: any) {
        showToast('拖拽上传失败: ' + err.message, 'error');
      }
    });
  });
}
