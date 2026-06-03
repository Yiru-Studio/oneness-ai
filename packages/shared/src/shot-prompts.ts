const SHOT_SKETCH_PROMPT_PREFIX = '请生成一张单张主分镜关键帧图，用于确定镜头画面构图、人物关系和环境氛围。';
const LEGACY_SHOT_SKETCH_PROMPT_PREFIXES = [
  '请生成一张单张电影分镜场景图，用作后续视频生成的参考首帧。',
];
const SHOT_PROMPT_MARKER = 'Shot 提示词：\n';
const SHOT_PROMPT_END_MARKER = '\n场景标题：';
const SHOT_VIDEO_SECTION_LABELS = [
  '镜头功能',
  '秒级动作拆解',
  '画面描述',
  '台词同步',
  '人物关系位置',
  '人物关系',
  '空间关系位置',
  '电影级视觉参数',
  '音效设计',
];

type ShotSketchPromptProject = {
  stylePrompt: string;
  ratio: string;
};

type ShotSketchPromptScene = {
  title: string;
  environment?: string | null;
  characters: string[];
  content: string;
};

type ShotSketchPromptShot = {
  displayId: number;
  shotType: string;
  duration: number;
  prompt: string;
};

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function startsWithShotSketchPrompt(prompt: string): boolean {
  const trimmedStart = prompt.trimStart();
  return (
    trimmedStart.startsWith(SHOT_SKETCH_PROMPT_PREFIX) ||
    LEGACY_SHOT_SKETCH_PROMPT_PREFIXES.some((prefix) => trimmedStart.startsWith(prefix))
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractShotSection(prompt: string, label: string): string {
  const labels = SHOT_VIDEO_SECTION_LABELS.map(escapeRegExp).join('|');
  const pattern = new RegExp(`${escapeRegExp(label)}[：:]\\s*([\\s\\S]*?)(?=\\n?\\s*(?:${labels})[：:]|$)`, 'u');
  return pattern.exec(prompt)?.[1]?.trim() ?? '';
}

function compactImageBriefText(value: string): string {
  return value
    .replace(/^\s*(?:秒级动作拆解|台词同步|音效设计|动作触发音|特效音|基础环境音)[：:].*$/gmu, '')
    .replace(/\b\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?\s*s[：:，,、]?\s*/giu, '')
    .replace(/\b\d+(?:\.\d+)?\s*s[：:，,、]?\s*/giu, '')
    .replace(/\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?\s*秒[：:，,、]?\s*/gu, '')
    .replace(/\d+(?:\.\d+)?\s*秒(?:时|后|内)?[：:，,、]?\s*/gu, '')
    .replace(/(?:起始|随后|接着|最后|结束时)[：:，,、]?\s*/gu, '')
    .replace(/(?:对白|台词|旁白|音效|声音|音乐|环境音|触发音|特效音)[：:].*$/gmu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildStaticShotImageBrief(prompt: string): string {
  const shotFunction = compactImageBriefText(extractShotSection(prompt, '镜头功能'));
  const action = compactImageBriefText(
    extractShotSection(prompt, '秒级动作拆解') ||
    extractShotSection(prompt, '画面描述') ||
    prompt,
  );
  const people = compactImageBriefText(
    extractShotSection(prompt, '人物关系位置') ||
    extractShotSection(prompt, '人物关系'),
  );
  const space = compactImageBriefText(extractShotSection(prompt, '空间关系位置'));
  const visual = compactImageBriefText(extractShotSection(prompt, '电影级视觉参数'));

  const lines = [
    shotFunction ? `镜头意图：${shotFunction}` : '',
    action ? `关键画面：${action}` : '',
    people ? `人物关系：${people}` : '',
    space ? `空间与道具：${space}` : '',
    visual ? `光线、色调与构图：${visual}` : '',
  ].filter(Boolean);

  return lines.length ? lines.join('\n') : compactImageBriefText(prompt);
}

export function buildShotSketchPrompt(
  project: ShotSketchPromptProject,
  scene: ShotSketchPromptScene,
  shot: ShotSketchPromptShot,
  hasCompositionImage: boolean,
): string {
  const prompt = [
    SHOT_SKETCH_PROMPT_PREFIX,
    '',
    '核心目标：',
    '- 这是一张静态主分镜图，不是视频生成提示词，也不是动作分解说明。',
    '- 把 Shot 描述转化为一个明确的电影画面瞬间：主体是谁、站/坐/看向哪里、角色之间的位置关系、关键道具在哪里、环境如何包围人物。',
    '- 优先呈现画面构图、景别、机位、光线、色彩和情绪；不要表现连续运动过程。',
    '',
    '画面要求：',
    '- 只输出一张完整电影画面，不要九宫格、拼贴、分屏、contact sheet 或分镜板页面。',
    '- 不要在图片中写字幕、编号、角度标签、水印、logo 或任何说明文字。',
    '- 人物、道具和环境需要自然同框，比例和透视可信，不能像素材平铺。',
    '- 角色外貌、服装、道具造型和场景结构必须优先参考已提供图片；缺失参考图时按文字描述补全。',
    '- 下方 Shot 提示词已经清洗为静态画面 brief；不要生成连续动作、时间轴、字幕台词或声音效果。',
    `- 输出比例按 ${project.ratio} 构图。`,
    hasCompositionImage
      ? '- 已提供的场景图是空间结构、光线、色调和画风锚点；请保持一致，只根据本 Shot 重新安排人物、道具和镜头构图。'
      : '',
    '',
    `Shot：#${shot.displayId}`,
    `镜头性质：${shot.shotType === 'continuation' ? '延续上一镜头的空间与情绪，但仍输出单张静态关键帧' : '独立构图的单张静态关键帧'}`,
    `Shot 提示词：\n${truncateText(buildStaticShotImageBrief(shot.prompt), 1400)}`,
    '',
    `场景标题：${scene.title}`,
    scene.environment ? `环境：${scene.environment}` : '',
    scene.characters.length ? `出场人物：${scene.characters.join('、')}` : '',
    `剧本上下文：\n${truncateText(scene.content, 1400)}`,
    project.stylePrompt ? `项目整体美术风格：\n${truncateText(project.stylePrompt, 900)}` : '',
  ].filter(Boolean).join('\n');
  return truncateText(prompt, 5000);
}

export function sanitizeShotVideoPrompt(prompt: string): string {
  if (!startsWithShotSketchPrompt(prompt)) return prompt;

  const firstMarker = prompt.indexOf(SHOT_PROMPT_MARKER);
  if (firstMarker < 0) return prompt;

  const nestedMarker = prompt.indexOf(
    SHOT_PROMPT_MARKER,
    firstMarker + SHOT_PROMPT_MARKER.length,
  );
  const start = (nestedMarker >= 0 ? nestedMarker : firstMarker) + SHOT_PROMPT_MARKER.length;
  const end = prompt.indexOf(SHOT_PROMPT_END_MARKER, start);
  if (end < 0) return prompt;

  const extracted = prompt.slice(start, end).trim();
  return extracted || prompt;
}

export function isShotSketchPrompt(prompt: string): boolean {
  return startsWithShotSketchPrompt(prompt);
}
