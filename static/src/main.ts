/**
 * 入口: 在 DOMContentLoaded 时挂载所有模块
 * 暴露 window.* 函数供模板里的 inline onclick 调用
 */

import { state } from './modules/state';
import * as Tabs from './modules/tabs';
import * as Workspace from './modules/workspace';
import * as Characters from './modules/characters';
import * as Segments from './modules/segments';
import * as Gallery from './modules/gallery';
import * as History from './modules/history';
import * as Discover from './modules/discover';
import * as Comic2Novel from './modules/comic2novel';
import * as Bubbles from './modules/bubbles';
import * as Modals from './modules/modals';
import * as Progress from './modules/progress';
import * as Toast from './modules/toast';
import * as A11y from './modules/a11y';
import * as Keyboard from './modules/keyboard';
import * as DragDrop from './modules/dragdrop';
import * as Pwa from './modules/pwa';
import * as Ui from './modules/ui';
import * as Api from './modules/api';

import { showToast } from './modules/toast';

// 副作用导入: 图标库自启动 (hydrateIcons + MutationObserver),
// 把 <span data-icon="xxx"> 替换成内联 SVG。必须在 boot() 之前引入。
import './modules/icons';

/* ============================================================
 * PRIMARY_ACTIONS: 状态条 / 快捷键共用的当前 Tab 主操作
 * 在此注入, 因为模块之间存在循环依赖, workspace 需要在 main 里绑函数引用
 * ============================================================ */

state.primaryActions = {
    input:       { label: '开始智能分镜', run: () => Segments.startSegment() },
    aiwrite:     { label: '生成剧情选项', run: () => Workspace.genPlotOptions() },
    characters:  { label: '从小说分析角色', run: () => Characters.analyzeCharacters() },
    segments:    { label: '批量整页生成', run: () => Segments.generateAllFullPages() },
    gallery:     { label: '下载全部图片', run: () => Gallery.downloadAll() },
    history:     { label: '保存当前进度', run: () => Workspace.quickSave() },
    comic2novel: { label: '选择漫画图片', run: () => { const el = document.getElementById('comic-file-input'); if (el) el.click(); } },
};

/* ============================================================
 * 把所有模块导出挂到 window, 供模板里的 inline onclick= 引用
 * 这样不动 HTML 也能保留旧接口
 * ============================================================ */

function exposeToWindow(): void {
    const w: any = window;

    // 标签页
    w.switchTab = Tabs.switchTab;
    w.goStep = Tabs.goStep;
    w.refreshInks = Tabs.refreshInks;

    // 模态框
    w.openModal = Modals.openModal;
    w.closeModal = Modals.closeModal;
    w.openConfigModal = Modals.openConfigModal;
    w.closeConfigModal = Modals.closeConfigModal;
    w.animateCloseModal = Modals.animateCloseModal;
    w.openModalA11y = A11y.openModalA11y;
    w.closeModalA11y = A11y.closeModalA11y;

    // 工作台 / 状态条
    w.updateWorkspaceUI = Workspace.updateWorkspaceUI;
    w.scheduleWorkspaceUI = Workspace.scheduleWorkspaceUI;
    w.markDirty = Workspace.markDirty;
    w.markSaved = Workspace.markSaved;
    w.renderWorkMeta = Workspace.renderWorkMeta;
    w.runPrimaryAction = Workspace.runPrimaryAction;
    w.bootIntro = Workspace.bootIntro;
    w.quickSave = Workspace.quickSave;

    // 风格 / 单选组
    w.renderStylePresets = Workspace.renderStylePresets;
    w.renderCustomStyleTags = Workspace.renderCustomStyleTags;
    w.togglePresetStyle = Workspace.togglePresetStyle;
    w.addCustomStyleTag = Workspace.addCustomStyleTag;
    w.removeCustomStyleTag = Workspace.removeCustomStyleTag;
    w.toggleStylePanel = Workspace.toggleStylePanel;
    w.clearAllStyles = Workspace.clearAllStyles;
    w.updateStyleSummary = Workspace.updateStyleSummary;
    w.getStyleTagsString = Workspace.getStyleTagsString;
    w.syncBubbleMini = Workspace.syncBubbleMini;
    w.applyComicModeToDom = Workspace.applyComicModeToDom;
    w.applyBubbleRenderModeToDom = Workspace.applyBubbleRenderModeToDom;
    w.onComicModeChange = Workspace.onComicModeChange;
    w.onBubbleRenderModeChange = Workspace.onBubbleRenderModeChange;

    // API 配置
    w.applyPreset = Workspace.applyPreset;
    w.clearConfig = Workspace.clearConfig;
    w.testLLM = Workspace.testLLM;
    w.testImage = Workspace.testImage;
    w.saveConfig = Workspace.saveConfig;
    w.loadConfig = Workspace.loadConfig;
    w.applyConfigToForm = Workspace.applyConfigToForm;

    // 小说输入
    w.updateCharCount = Workspace.updateCharCount;
    w.updateAiwriteCharCount = Workspace.updateAiwriteCharCount;
    w.mirrorNovelText = Workspace.mirrorNovelText;
    w.mirrorAiwriteText = Workspace.mirrorAiwriteText;
    w.toggleInpAIWrite = Workspace.toggleInpAIWrite;

    // AI 写作
    w.genPlotOptions = Workspace.genPlotOptions;
    w.continueNovel = Workspace.continueNovel;
    w.genPolishStyles = Workspace.genPolishStyles;
    w.polishNovel = Workspace.polishNovel;
    w.renderPlotOptions = Workspace.renderPlotOptions;
    w.renderPolishStyles = Workspace.renderPolishStyles;
    w.openPolishCompare = Workspace.openPolishCompare;
    w.cancelPolishCompare = Workspace.cancelPolishCompare;
    w.confirmPolishReplace = Workspace.confirmPolishReplace;

    // 角色
    w.analyzeCharacters = Characters.analyzeCharacters;
    w.clearCharacters = Characters.clearCharacters;
    w.renderCharacters = Characters.renderCharacters;
    w.togglePromptEditor = Characters.togglePromptEditor;
    w.saveCharPrompt = Characters.saveCharPrompt;
    w.uploadCharacterImage = Characters.uploadCharacterImage;
    w.handleCharacterImageFile = Characters.handleCharacterImageFile;
    w.generateCharacterImage = Characters.generateCharacterImage;
    w.compressImage = Characters.compressImage;

    // 分镜
    w.startSegment = Segments.startSegment;
    w.renderSegments = Segments.renderSegments;
    w.updateSegment = Segments.updateSegment;
    w.toggleCharacter = Segments.toggleCharacter;
    w.generateFullPage = Segments.generateFullPage;
    w.generateAllFullPages = Segments.generateAllFullPages;
    w.regenerateAllFullPages = Segments.regenerateAllFullPages;
    w.toggleBatchPause = Segments.toggleBatchPause;
    w.stopBatchGenerate = Segments.stopBatchGenerate;

    // 画廊
    w.renderGallery = Gallery.renderGallery;
    w.exportScript = Gallery.exportScript;
    w.downloadAll = Gallery.downloadAll;

    // 历史
    w.loadHistoryList = History.loadHistoryList;
    w.loadWritingHistoryList = History.loadWritingHistoryList;
    w.saveCurrentState = History.saveCurrentState;
    w.saveCurrentToHistory = History.saveCurrentToHistory;
    w.loadHistoryWork = History.loadHistoryWork;
    w.deleteHistoryWork = History.deleteHistoryWork;
    w.renameHistoryWork = History.renameHistoryWork;
    w.switchHistorySub = History.switchHistorySub;
    w.refreshCurrentHistoryList = History.refreshCurrentHistoryList;
    w.toggleWorkVisibility = History.toggleWorkVisibility;

    // 发现: 搜索他人公开作品
    w.runDiscoverSearch = Discover.runDiscoverSearch;
    w.onDiscoverInput = Discover.onDiscoverInput;
    w.viewPublicWork = Discover.viewPublicWork;
    w.closePublicWork = Discover.closePublicWork;
    w.forkPublicWork = Discover.forkPublicWork;
    w.loadWritingWork = History.loadWritingWork;
    w.renameWritingWork = History.renameWritingWork;
    w.deleteWritingWork = History.deleteWritingWork;
    w.autoSaveWriting = History.autoSaveWriting;
    w.saveCurrentWriting = History.saveCurrentWriting;

    // 漫画转小说
    w.handleComicUpload = Comic2Novel.handleComicUpload;
    w.removeComicImage = Comic2Novel.removeComicImage;
    w.clearComicUpload = Comic2Novel.clearComicUpload;
    w.startComicToNovel = Comic2Novel.startComicToNovel;
    w.renderComicNovelResult = Comic2Novel.renderComicNovelResult;
    w.copyNovelText = Comic2Novel.copyNovelText;
    w.downloadNovelText = Comic2Novel.downloadNovelText;

    // 气泡编辑器
    w.openBubbleEditor = Bubbles.openBubbleEditor;
    w.saveBubblePositions = Bubbles.saveBubblePositions;

    // 工具 / Toast / 进度
    w.showToast = Toast.showToast;
    w.showLoadingToast = Toast.showLoadingToast;
    w.dismissLoadingToast = Toast.dismissLoadingToast;
    w.escapeHtml = Ui.escapeHtml;
    w.formatDateTime = Ui.formatDateTime;
    w.emptyState = Ui.emptyState;

    // 认证 / 同步
    w.handleLogout = Api.handleLogout;
    w.checkAuth = Api.checkAuth;
    w.fetchWithRetry = Api.fetchWithRetry;
    w.lockButton = Api.lockButton;
    w.syncResults = Api.syncResults;
    w.recoverSession = Api.recoverSession;

    // UI
    w.detectBrowserDevice = Ui.detectBrowserDevice;
    w.adjustBottomNav = Ui.adjustBottomNav;
    w.maybeShowInAppBanner = Ui.maybeShowInAppBanner;
    w.staggerPanel = Tabs.staggerPanel;
}

/* ============================================================
 * DOMContentLoaded 启动
 * ============================================================ */

function boot(): void {
    exposeToWindow();

    // 全局快捷键 (依赖主操作, 已注入)
    Keyboard.setupKeyboardShortcuts();

    // 工作台初始化 (workMeta + 镜像监听 + 风格/模式/字数)
    Workspace.initWorkspace();

    // 拖拽上传
    DragDrop.setupDragDropUpload();

    // PWA: 注册 Service Worker
    Pwa.registerSW();

    // 气泡编辑器窗口 resize 重新定位
    Bubbles.setupBubbleResize();

    // 全局 ESC 关闭弹窗 (单独监听, 与 keyboard 共存)
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const w: any = window;
        const cm = document.getElementById('config-modal');
        if (cm && !cm.classList.contains('hidden') && typeof w.closeConfigModal === 'function') w.closeConfigModal();
        if (typeof w.cancelPolishCompare === 'function') w.cancelPolishCompare();
    });

    // 状态条: 滚过首屏后滑出 (IntersectionObserver)
    const sentinel = document.getElementById('workflow');
    const bar = document.getElementById('workspace-bar');
    if (sentinel && bar && typeof IntersectionObserver !== 'undefined') {
        const io = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                const show = !entry.isIntersecting && entry.boundingClientRect.top < 0;
                bar.classList.toggle('is-visible', show);
            });
        }, { threshold: 0 });
        io.observe(sentinel);
    }

    // 设备识别 / 移动端适配
    Ui.detectBrowserDevice();
    Ui.adjustBottomNav();
    window.addEventListener('resize', () => {
        clearTimeout(state._deviceResizeTimer);
        state._deviceResizeTimer = setTimeout(Ui.detectBrowserDevice, 200);
        Ui.adjustBottomNav();
    });
    if ((window as any).visualViewport) {
        (window as any).visualViewport.addEventListener('resize', Ui.adjustBottomNav);
        (window as any).visualViewport.addEventListener('scroll', Ui.adjustBottomNav);
    }

    // 微信/QQ 横幅关闭按钮: 记住忽略
    const bannerClose = document.getElementById('inapp-browser-close');
    if (bannerClose) {
        bannerClose.addEventListener('click', function() {
            const info: any = (window as any).APP_DEVICE || {};
            if (info.browser) {
                try { localStorage.setItem('inapp_banner_dismissed', info.browser); } catch (e) {}
            }
            const banner = document.getElementById('inapp-browser-banner');
            if (banner) banner.classList.add('hidden');
        });
    }

    // 配置从服务端回来后, 接口状态与模式 chip 再算一次
    Promise.resolve(Workspace.loadConfig()).then(
        () => Workspace.scheduleWorkspaceUI(),
        () => Workspace.scheduleWorkspaceUI()
    );

    // 启动入场
    Workspace.bootIntro();

    // 指示器: 字体加载 + resize 后重新量
    if ((document as any).fonts && (document as any).fonts.ready) {
        (document as any).fonts.ready.then(Tabs.refreshInks).catch(() => {});
    }
    let _inkResizeTimer: any = null;
    window.addEventListener('resize', () => {
        clearTimeout(_inkResizeTimer);
        _inkResizeTimer = setTimeout(Tabs.refreshInks, 120);
    });

    // 首次状态条 + 流程条 + 指示器
    Workspace.renderWorkMeta();
    Tabs.refreshInks();
    Workspace.updateWorkspaceUI();

    // 恢复会话 (内网穿透断开重连后找回之前生成的结果)
    Api.recoverSession();

    // 认证检查 (未登录跳回登录页)
    Api.checkAuth();
}

// 模块加载即挂全局 (script type=module 自动 defer, DOMContentLoaded 之前)
exposeToWindow();

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    // 脚本在 DOMContentLoaded 之后才加载, 立即执行
    boot();
}
