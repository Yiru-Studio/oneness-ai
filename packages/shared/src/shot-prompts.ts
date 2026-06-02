const SHOT_SKETCH_PROMPT_PREFIX = '请生成一张单张电影分镜场景图，用作后续视频生成的参考首帧。';
const SHOT_PROMPT_MARKER = 'Shot 提示词：\n';
const SHOT_PROMPT_END_MARKER = '\n场景标题：';

export function sanitizeShotVideoPrompt(prompt: string): string {
  const trimmedStart = prompt.trimStart();
  if (!trimmedStart.startsWith(SHOT_SKETCH_PROMPT_PREFIX)) return prompt;

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
  return prompt.trimStart().startsWith(SHOT_SKETCH_PROMPT_PREFIX);
}
