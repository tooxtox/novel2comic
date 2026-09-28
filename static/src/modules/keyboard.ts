/**
 * 全局键盘快捷键: Esc 关 modal, Ctrl/Cmd+S 存草稿, Ctrl/Cmd+Enter 触发当前 Tab 主操作, Ctrl+Tab 切 Tab
 */

import { state } from './state';
import { switchTab } from './tabs';
import { showToast } from './toast';

export function setupKeyboardShortcuts(): void {
  document.addEventListener('keydown', (e) => {
    const isInputFocused = ['INPUT', 'TEXTAREA', 'SELECT'].includes((document.activeElement as HTMLElement | null)?.tagName || '');
    const isContentEditable = (document.activeElement as HTMLElement | null)?.isContentEditable;
    const inEditor = isInputFocused || isContentEditable;

    // Esc: 关闭最上层 modal
    if (e.key === 'Escape') {
      const cm = document.getElementById('config-modal');
      if (cm && !cm.classList.contains('hidden')) {
        const w: any = window;
        if (typeof w.closeConfigModal === 'function') { w.closeConfigModal(); e.preventDefault(); return; }
      }
      const im = document.getElementById('image-modal');
      if (im && !im.classList.contains('hidden')) {
        const w: any = window;
        if (typeof w.closeModal === 'function') { w.closeModal(); e.preventDefault(); return; }
      }
      const pm = document.getElementById('polish-compare-modal');
      if (pm && !pm.classList.contains('hidden')) {
        const w: any = window;
        if (typeof w.cancelPolishCompare === 'function') { w.cancelPolishCompare(); e.preventDefault(); return; }
      }
    }

    // Ctrl+S / Cmd+S: 保存草稿(编辑器内不拦截, 由浏览器原生保存)
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      const w: any = window;
      if (typeof w.markSaved === 'function') {
        const t = (document.getElementById('work-title') as HTMLInputElement | null)?.value || state.workMeta?.title || '';
        w.markSaved(t);
        showToast('已保存草稿', 'success');
      }
      return;
    }

    // Ctrl+Enter / Cmd+Enter: 触发当前 Tab 主操作
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      if (inEditor) return;  // 输入框内交给具体按钮
      e.preventDefault();
      const w: any = window;
      if (typeof w.runPrimaryAction === 'function') w.runPrimaryAction();
      return;
    }

    // Ctrl+Tab / Ctrl+Shift+Tab: Tab 循环
    if ((e.ctrlKey || e.metaKey) && e.key === 'Tab') {
      e.preventDefault();
      const idx = state.tabs.indexOf(state.currentTab);
      const next = e.shiftKey ? (idx - 1 + state.tabs.length) % state.tabs.length : (idx + 1) % state.tabs.length;
      switchTab(state.tabs[next]);
    }
  });

  // 主按钮墨点涟漪
  document.addEventListener('click', (e: any) => {
    const btn = e.target.closest ? e.target.closest('.btn-primary') : null;
    if (!btn) return;
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const rect = btn.getBoundingClientRect();
    const ripple = document.createElement('span');
    ripple.className = 'ink-ripple';
    ripple.style.left = (e.clientX - rect.left) + 'px';
    ripple.style.top = (e.clientY - rect.top) + 'px';
    btn.appendChild(ripple);
    setTimeout(() => ripple.remove(), 700);
  });
}
