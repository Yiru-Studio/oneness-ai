// Style preset catalog. Labels and preview images mirror likeai.pro's
// /api/projects/styles response (TODO: self-host the preview images in MinIO
// instead of pointing at xintiao85.com's CDN).
export type StylePreset = {
  key: string;
  label: string;
  prompt: string;
  previewUrl: string;
};

const PREVIEW_BASE = 'https://oss.xintiao85.com/kmore/web/';

export const STYLE_PRESETS: StylePreset[] = [
  {
    key: 'cinematic',
    label: '电影质感',
    prompt: 'cinematic lighting, movie still, shot on 35mm, realistic, masterpiece',
    previewUrl: PREVIEW_BASE + '%E7%94%B5%E5%BD%B1%E5%A4%A7%E7%89%87%E6%84%9F.png',
  },
  {
    key: 'realistic',
    label: '高清实拍',
    prompt: 'photorealistic, raw photo, DSLR, sharp focus, high fidelity',
    previewUrl: PREVIEW_BASE + '%E7%9C%9F%E5%AE%9E%E6%91%84%E5%BD%B1.png',
  },
  {
    key: 'gothic',
    label: '暗黑哥特',
    prompt: 'gothic style, dark atmosphere, gloomy, fog, horror theme, muted colors',
    previewUrl: PREVIEW_BASE + '%E6%9A%97%E9%BB%91%E5%93%A5%E7%89%B9.png',
  },
  {
    key: 'cyberpunk',
    label: '赛博朋克',
    prompt: 'cyberpunk, neon lights, futuristic, rainy street, blue and purple hue',
    previewUrl: PREVIEW_BASE + '%E8%B5%9B%E5%8D%9A%E6%9C%8B%E5%85%8B.png',
  },
  {
    key: 'anime',
    label: '日漫风格',
    prompt: 'anime style, 2D animation, cel shading, vibrant colors, clean lines',
    previewUrl: PREVIEW_BASE + '%E6%97%A5%E6%BC%AB%E9%A3%8E%E6%A0%BC.png',
  },
  {
    key: 'shinkai',
    label: '新海诚风',
    prompt: 'Makoto Shinkai style, beautiful sky, lens flare, detailed background, emotional',
    previewUrl: PREVIEW_BASE + '%E6%96%B0%E6%B5%B7%E8%AF%9A%E9%A3%8E.png',
  },
  {
    key: 'inkPainting',
    label: '国风水墨',
    prompt: 'Chinese ink painting, watercolor, traditional art, flowing lines, oriental aesthetic',
    previewUrl: PREVIEW_BASE + '%E5%9B%BD%E9%A3%8E%E6%B0%B4%E5%A2%A8.png',
  },
  {
    key: 'gameCG',
    label: '游戏原画',
    prompt: 'game cg, splash art, highly detailed, epic composition, fantasy style',
    previewUrl: PREVIEW_BASE + '%E6%B8%B8%E6%88%8F%E5%8E%9F%E7%94%BB.png',
  },
];

export const CUSTOM_STYLE_KEY = 'custom';

// Defaults shown on the project detail panel — match likeai's defaults so the
// UI labels read the same. The user can change them later from the panel.
export type AnalysisModelOption = {
  /** model id sent to the OpenAI-compatible provider (zenmux). */
  modelId: string;
  /** human-readable label shown in dropdowns and the info panel. */
  label: string;
};

export const ANALYSIS_MODEL_OPTIONS: AnalysisModelOption[] = [
  { modelId: 'anthropic/claude-sonnet-4.6', label: 'Claude Sonnet 4.6' },
  { modelId: 'anthropic/claude-opus-4.7', label: 'Claude Opus 4.7' },
];

export const IMAGE_MODEL_OPTIONS: AnalysisModelOption[] = [
  { modelId: 'openai/gpt-image-1', label: 'GPT Image 1' },
  { modelId: 'stub/placeholder', label: 'Stub (开发用)' },
];

export const VIDEO_MODEL_OPTIONS: AnalysisModelOption[] = [
  { modelId: 'doubao-seedance-2-0-260128', label: 'Seedance 2.0 Pro' },
  { modelId: 'doubao-seedance-2-0-fast-260128', label: 'Seedance 2.0 Fast' },
  { modelId: 'stub/placeholder', label: 'Stub (开发用)' },
];

export const DEFAULT_ANALYSIS_MODEL = 'anthropic/claude-sonnet-4.6';
export const DEFAULT_IMAGE_MODEL = 'openai/gpt-image-1';
export const DEFAULT_VIDEO_MODEL = 'doubao-seedance-2-0-fast-260128';

export function analysisModelLabel(modelId: string): string {
  return ANALYSIS_MODEL_OPTIONS.find((m) => m.modelId === modelId)?.label ?? modelId;
}

export function imageModelLabel(modelId: string): string {
  return IMAGE_MODEL_OPTIONS.find((m) => m.modelId === modelId)?.label ?? modelId;
}

export function videoModelLabel(modelId: string): string {
  return VIDEO_MODEL_OPTIONS.find((m) => m.modelId === modelId)?.label ?? modelId;
}
