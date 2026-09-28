/**
 * 全局状态: 原 app.js 顶层 `let` 变量统一搬到这里
 * 通过单一 `state` 对象访问, 替代原文件的全局变量 (解决跨模块共享 + 方便重置)
 *
 * 复杂字段统一标 any, 不做精细类型 — 业务层字段漂移太大, 过度约束反而碍事
 */

export const state: any = {
  // ===== 业务状态 =====
  currentSegments: { pages: [] },
  generatedImages: {},
  isGenerating: false,
  characters: [],
  batchPaused: false,
  batchStopRequested: false,
  fullPageImages: {},
  combinedPageImages: {},
  fullPageCleanImages: {},
  fullPageBubbles: {},
  progressInterval: null,
  currentWritingId: (typeof localStorage !== 'undefined' ? localStorage.getItem('writing_id') : null) || null,

  // ===== 漫画转小说 =====
  comicUploadedImages: [],
  comicNovelResult: null,

  // ===== Tab / 模式 =====
  tabs: ['input', 'aiwrite', 'characters', 'segments', 'gallery', 'history', 'comic2novel'],
  currentTab: 'input',
  CONCURRENT_LIMIT: 3,
  MAX_RETRIES: 3,

  // ===== 风格 / 模式开关 =====
  selectedPresetIds: new Set<string>(),
  customStyleTags: [],
  comicMode: 'bw',
  bubbleRenderMode: 'pil',

  // ===== 气泡类型枚举 =====
  BUBBLE_TYPES: ['dialogue', 'thought', 'shout', 'whisper', 'burst', 'narration', 'box', 'caption'],
  BUBBLE_TYPE_LABELS: {
    dialogue:  '○ dialogue',
    thought:   '◌ thought',
    shout:     '※ shout',
    whisper:   '· whisper',
    burst:     '⚡ burst',
    narration: '▭ narration',
    box:       '▢ box',
    caption:   '▲ caption',
  },

  // ===== 内部 flag / 缓存 =====
  _historySub: 'comic',
  _plotOptions: [],
  _polishScope: 'aiwrite',
  _polishStyles: [],
  _polishOriginal: '',
  _polishResult: '',
  _textSyncing: false,
  _bubbleEditorReposition: null,
  _deviceResizeTimer: null,

  // ===== 作品元信息 (init 在 workMetaInit 中读 localStorage) =====
  workMeta: { title: '', savedAt: '', dirty: false } as { title: string; savedAt: string; dirty: boolean },

  // ===== PRIMARY_ACTIONS: 占位, 由 workspace 模块填充函数引用 =====
  primaryActions: {} as Record<string, { label: string; run: () => void }>,
};

// ===== 风格预设 / 分类 =====
export const STYLE_PRESETS: any[] = [
    // ===== 日漫 =====
    { id: 'acg', label: '日式ACG', category: '日漫', tags: 'japanese anime style, ACG anime aesthetic, clean cel shading, smooth lineart, expressive anime eyes, bishounen and moe character design' },
    { id: 'shonen', label: '热血少年', category: '日漫', tags: 'shonen manga style, dynamic action lines, intense expressions, speed lines' },
    { id: 'shojo', label: '少女漫画', category: '日漫', tags: 'shojo manga style, soft lines, sparkles, romantic, delicate features' },
    { id: 'seinen', label: '青年向', category: '日漫', tags: 'seinen manga style, realistic proportions, detailed anatomy, mature' },
    { id: 'chibi', label: 'Q版', category: '日漫', tags: 'chibi style, super deformed, 2-head body proportion, cute, simplified' },
    { id: 'gag', label: '搞笑', category: '日漫', tags: 'gag manga style, exaggerated expressions, comedic, simple lines' },
    { id: 'horror', label: '恐怖', category: '日漫', tags: 'horror manga style, grotesque, unsettling, dark atmosphere, psychological' },
    // ===== 美漫 =====
    { id: 'american_comic', label: '经典美漫', category: '美漫', tags: 'american comic book style, bold outlines, halftone dots, vibrant inking, superhero proportions' },
    { id: 'graphic_novel', label: '图像小说', category: '美漫', tags: 'graphic novel style, detailed rendering, cinematic panels, mature storytelling' },
    { id: 'noir', label: '黑色电影', category: '美漫', tags: 'noir style, high contrast, deep shadows, dramatic lighting, film noir' },
    { id: 'cartoon', label: '美式卡通', category: '美漫', tags: 'american cartoon style, bold outlines, exaggerated shapes, playful' },
    // ===== 韩漫 =====
    { id: 'webtoon', label: 'Webtoon', category: '韩漫', tags: 'korean webtoon style, vertical scroll format, clean lines, vibrant colors, modern' },
    { id: 'manhwa', label: '传统韩漫', category: '韩漫', tags: 'manhwa style, korean comic, detailed eyes, smooth lineart, modern aesthetic' },
    { id: 'korean_drama', label: '韩剧风', category: '韩漫', tags: 'korean drama inspired manhwa, realistic faces, fashion forward, romantic' },
    // ===== 国漫 =====
    { id: 'ink', label: '水墨风', category: '国漫', tags: 'sumi-e ink style, brush strokes, traditional Chinese ink painting, flowing' },
    { id: 'guofeng', label: '国风', category: '国漫', tags: 'chinese guofeng style, traditional hanfu, oriental aesthetics, elegant' },
    { id: 'wuxia', label: '武侠', category: '国漫', tags: 'wuxia manhua style, martial arts, flowing robes, dynamic action, chinese fantasy' },
    { id: 'xianxia', label: '仙侠', category: '国漫', tags: 'xianxia style, immortal cultivation, ethereal, mystical clouds, oriental fantasy' },
    // ===== 其他 =====
    { id: 'cyberpunk', label: '赛博朋克', category: '其他', tags: 'cyberpunk style, neon lights, futuristic, tech noir, dystopian' },
    { id: 'realistic', label: '写实', category: '其他', tags: 'realistic style, photographic quality, detailed textures, lifelike' },
    { id: 'watercolor', label: '水彩', category: '其他', tags: 'watercolor style, soft washes, flowing pigments, artistic' },
    { id: 'sketch', label: '素描', category: '其他', tags: 'pencil sketch style, graphite, cross hatching, rough lines' },
    { id: 'minimalist', label: '极简', category: '其他', tags: 'minimalist style, simple lines, negative space, clean composition' },
];
export const STYLE_CATEGORIES = ['日漫', '美漫', '韩漫', '国漫', '其他'];

/** 从 localStorage 恢复 workMeta (init 时调用一次) */
export function workMetaInit(): void {
    try {
        state.workMeta.title = localStorage.getItem('manga_work_title') || '';
        state.workMeta.savedAt = localStorage.getItem('manga_work_saved_at') || '';
    } catch (e) { /* 无痕模式忽略 */ }
}
