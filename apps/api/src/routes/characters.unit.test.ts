import { describe, expect, it } from 'vitest';
import { parseCharacterAnalysisJson } from '@oneness/shared/character-analysis';
import { CreateTaskSchema } from '@oneness/shared/schemas';
import { TaskType } from '@oneness/shared/enums';

describe('character analysis JSON parser', () => {
  it('parses fenced JSON after removing trailing commas', () => {
    const parsed = parseCharacterAnalysisJson(`\`\`\`json
{
  "description": "17岁高中女生",
  "bio": "热爱摄影，性格敏感。",
  "avatarPrompt": "短发，蓝色校服外套，清澈眼神。",
  "styles": [
    {
      "name": "校园摄影造型",
      "prompt": "单人全身角色参考图，短发，蓝色校服外套，干净影棚背景。",
    },
  ],
}
\`\`\``);

    expect(parsed.styles?.[0]?.name).toBe('校园摄影造型');
    expect(parsed.avatarPrompt).toContain('短发');
  });

  it('repairs simple unquoted object keys without changing string values', () => {
    const parsed = parseCharacterAnalysisJson(`{
  description: "45岁便利店老板，提示词里包含 style: realistic",
  bio: "穿米白色针织开衫，语气温和。",
  avatarPrompt: "圆脸，短发，微笑。",
  styles: [
    { name: "便利店日常造型", prompt: "prompt: 保留这段字符串里的冒号文本。" }
  ]
}`);

    expect(parsed.description).toContain('style: realistic');
    expect(parsed.styles?.[0]?.prompt).toContain('prompt: 保留');
  });
});

describe('character_detail task schema', () => {
  it('accepts per-character text analysis input', () => {
    const parsed = CreateTaskSchema.parse({
      type: TaskType.TEXT_ANALYZE,
      projectId: 'clw0000000000000000000000',
      provider: 'stub',
      input: {
        episodeId: 'clw0000000000000000000001',
        characterId: 'clw0000000000000000000002',
        analysisType: 'character_detail',
        model: 'stub',
      },
    });

    expect(parsed.input).toMatchObject({
      analysisType: 'character_detail',
      characterId: 'clw0000000000000000000002',
    });
  });
});
