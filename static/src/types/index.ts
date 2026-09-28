/**
 * TypeScript 类型定义 - 从 app.js / app.py / templates/index.html 提取
 * 所有数据字段标 ? (实际可能不完整 / LLM 返回值漂移)
 */

// ============================================================
// 1. 用户与认证
// ============================================================

export interface User {
  username?: string;
  password_hash?: string;
  salt?: string;
  created_at?: string;
  is_admin?: boolean;
}

export interface AuthSession {
  logged_in?: boolean;
  username?: string;
  is_admin?: boolean;
  work_id?: string;
  work_username?: string;
  work_title?: string;
  writing_id?: string;
}

export interface LoginResponse {
  success?: boolean;
  message?: string;
  username?: string;
  is_admin?: boolean;
  error?: string;
}

export interface RegisterPayload {
  username?: string;
  password?: string;
  confirm?: string;
}

export interface CheckAuthResponse {
  logged_in?: boolean;
  username?: string;
  is_admin?: boolean;
}

// ============================================================
// 2. 小说
// ============================================================

export interface Novel {
  title?: string;
  text?: string;
  created_at?: string;
  updated_at?: string;
}

export interface NovelChapter {
  chapter_id?: string;
  title?: string;
  content?: string;
  order?: number;
}

export interface NovelContent {
  novel_text?: string;
  pages?: Page[];
  characters?: Character[];
}

// ============================================================
// 3. 风格
// ============================================================

export type StyleCategory =
  | '日漫'
  | '美漫'
  | '韩漫'
  | '国漫'
  | '其他';

export interface StylePreset {
  id?: string;
  label?: string;
  category?: StyleCategory;
  tags?: string;
}

export interface CustomStyleTag {
  id?: string;
  label?: string;
  tags?: string;
}

// ============================================================
// 4. 角色
// ============================================================

export interface Character {
  id?: string;
  name?: string;
  description?: string;
  personality?: string;
  reference_image?: string;
  image_url?: string;
  char_prompt?: string;
  cloud_file_id?: string;
}

// ============================================================
// 5. 分镜
// ============================================================

export type DialogueType =
  | 'dialogue'
  | 'thought'
  | 'shout'
  | 'whisper'
  | 'burst'
  | 'narration'
  | 'box'
  | 'caption';

export interface Bubble {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  dialogue?: string;
  dialogue_type?: DialogueType;
  text?: string;
}

export interface Segment {
  segment_number?: number;
  scene_description?: string;
  dialogue?: string;
  dialogue_type?: DialogueType;
  shot_type?: string;
  camera_angle?: string;
  composition?: string;
  mood?: string;
  shot_scale?: string;
  lighting?: string;
  of_type?: string;
  style_prompt?: string;
  selected_characters?: number[];
  bubbles?: Bubble[];
  image_url?: string;
  image_key?: string;
}

export interface Page {
  page_number?: number;
  segments?: Segment[];
  full_page_image?: string;
}

export interface Storyboard {
  pages?: Page[];
  characters?: Character[];
}

// ============================================================
// 6. 图片
// ============================================================

export interface FullPageImage {
  key?: string;
  local_url?: string;
  clean_url?: string;
  bubbles?: Bubble[];
  page_num?: number;
  timestamp?: string;
}

export interface GeneratedImages {
  [key: string]: string;
}

// ============================================================
// 7. 历史
// ============================================================

export interface HistoryItem {
  work_id?: string;
  title?: string;
  created_at?: string;
  updated_at?: string;
}

export interface WorkMeta {
  work_id?: string;
  title?: string;
  created_at?: string;
  updated_at?: string;
}

export interface WorkState {
  novel_text?: string;
  segments?: Storyboard;
  characters?: Character[];
  generated_images?: GeneratedImages;
  full_page_images?: { [key: string]: string };
  combined_page_images?: { [key: string]: string };
  full_page_clean_images?: { [key: string]: string };
  full_page_bubbles?: { [key: string]: Bubble[] };
  updated_at?: string;
  _meta?: {
    segment_count?: number;
    character_count?: number;
    generated_image_count?: number;
    full_page_image_count?: number;
    combined_page_image_count?: number;
    has_chars_with_image?: number;
  };
}

export interface WritingDocument {
  writing_id?: string;
  title?: string;
  content?: string;
  created_at?: string;
  updated_at?: string;
}

// ============================================================
// 8. 进度
// ============================================================

export type TaskStage =
  | 'building_prompt'
  | 'preparing'
  | 'calling_llm'
  | 'parsing'
  | 'saving'
  | 'calling_image_api'
  | 'downloading'
  | 'processing_page'
  | 'merging'
  | 'done'
  | 'error';

export interface TaskProgress {
  task_id?: string;
  percent?: number;
  message?: string;
  stage?: TaskStage;
  page?: number;
  total?: number;
  extra?: Record<string, unknown>;
}

// ============================================================
// 9. 漫画转小说
// ============================================================

export interface ComicUploadImage {
  name?: string;
  data?: string;
  pageIndex?: number;
}

export interface ComicNovelPage {
  page?: number;
  text?: string;
}

export interface ComicNovelResult {
  novel_text?: string;
  pages?: ComicNovelPage[];
  total_pages?: number;
  model?: string;
  timestamp?: string;
}

export interface ComicToNovelPayload {
  images?: string[];
  api_url?: string;
  api_key?: string;
  model?: string;
  task_id?: string;
}

// ============================================================
// 10. API
// ============================================================

export interface ApiResponse<T = unknown> {
  success?: boolean;
  data?: T;
  message?: string;
  error?: string;
}

export interface ApiError {
  error?: string;
  raw?: unknown;
  status?: number;
}

export interface SegmentApiPayload {
  text?: string;
  api_url?: string;
  api_key?: string;
  model?: string;
  segments_per_page?: number;
  task_id?: string;
  comic_mode?: ComicMode;
}

export interface GeneratePagePayload {
  page?: Page;
  page_num?: number;
  api_url?: string;
  api_key?: string;
  model?: string;
  negative_prompt?: string;
  style_tags?: string;
  character_references?: Character[];
  references?: Character[];
  reference_strength?: number;
  previous_page_image?: string;
  page_idx?: number | string;
  task_id?: string;
  comic_mode?: ComicMode;
  bubble_render_mode?: BubbleRenderMode;
}

export interface GeneratePageResponse {
  success?: boolean;
  image_url?: string;
  clean_image_url?: string;
  bubbles?: Bubble[];
  bubble_render_mode?: BubbleRenderMode;
  error?: string;
  raw?: unknown;
}

export interface CharacterImageResponse {
  success?: boolean;
  image_url?: string;
  cloud_file_id?: string;
  attempts?: number;
  max_attempts?: number;
  error?: string;
}

export interface HistoryListResponse {
  success?: boolean;
  works?: HistoryItem[];
  username?: string;
}

export interface HistoryDetailResponse {
  success?: boolean;
  work_id?: string;
  title?: string;
  state?: WorkState;
}

export interface WritingListResponse {
  success?: boolean;
  works?: WritingDocument[];
  username?: string;
}

export interface WritingDetailResponse {
  success?: boolean;
  data?: WritingDocument;
}

// ============================================================
// 11. UI
// ============================================================

export type TabName =
  | 'input'
  | 'aiwrite'
  | 'characters'
  | 'segments'
  | 'gallery'
  | 'history'
  | 'comic2novel';

export type BubbleRenderMode = 'pil' | 'api';

export type ComicMode = 'bw' | 'color';

export type HistorySub = 'comic' | 'writing';

export interface TabDefinition {
  id?: TabName;
  label?: string;
  icon?: string;
}

export interface PrimaryAction {
  label?: string;
  run?: () => void;
}

export interface WorkMetaDisplay {
  title?: string;
  savedAt?: string;
  dirty?: boolean;
}

export interface ConfigForm {
  llm_api_url?: string;
  llm_api_key?: string;
  llm_model?: string;
  img_api_url?: string;
  img_api_key?: string;
  img_model?: string;
  bubble_render_mode?: BubbleRenderMode;
  comic_mode?: ComicMode;
  segments_per_page?: number;
  style_tags?: string;
  custom_style_tags?: CustomStyleTag[];
}

// ============================================================
// 12. 工具类型
// ============================================================

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export type Nullable<T> = T | null | undefined;

// ============================================================
// 13. 全局 window 扩展
// ============================================================

declare global {
  interface Window {
    switchTab?: (tab: TabName) => void;
    closeModal?: () => void;
    closeConfigModal?: () => void;
    openConfigModal?: () => void;
    cancelPolishCompare?: () => void;
    handleCharacterImageFile?: (idx: number, input: HTMLInputElement) => void;
    handleComicUpload?: (event: Event) => void;
    removeComicImage?: (idx: number) => void;
    clearComicUpload?: () => void;
    copyNovelText?: () => void;
    downloadNovelText?: () => void;
    goStep?: (tab: TabName) => void;
    toggleStylePanel?: () => void;
    addCustomStyleTag?: () => void;
    switchHistorySub?: (sub: HistorySub) => void;
  }
}

export {};
