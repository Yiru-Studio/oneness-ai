export const LANGUAGES = [
  { value: 'zh-CN' as const, label: '简体中文' },
  { value: 'en' as const, label: 'English' },
  { value: 'zh-TW' as const, label: '繁體中文' },
  { value: 'ja' as const, label: '日本語' },
  { value: 'ko' as const, label: '한국어' },
  { value: 'es' as const, label: 'Español' },
  { value: 'fr' as const, label: 'Français' },
  { value: 'de' as const, label: 'Deutsch' },
] as const;

export const PROJECT_TABS = [
  { value: 'info' as const, label: '信息' },
  { value: 'characters' as const, label: '角色' },
  { value: 'items' as const, label: '物品' },
  { value: 'scenes' as const, label: '场景' },
  { value: 'workbench' as const, label: '场景图' },
  { value: 'storyboard' as const, label: '分镜' },
  { value: 'analytics' as const, label: '数据分析' },
] as const;

export const KNOWLEDGE_TABS = [
  { value: 'created' as const, label: '我创建的' },
  { value: 'favorited' as const, label: '我收藏的' },
  { value: 'collaborated' as const, label: '与我协作' },
] as const;
