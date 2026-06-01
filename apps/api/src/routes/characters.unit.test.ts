import { describe, expect, it, vi } from 'vitest';

async function loadParser() {
  vi.stubEnv('DATABASE_URL', 'postgresql://oneness:oneness@localhost:5432/oneness_test');
  vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
  vi.stubEnv('MINIO_ENDPOINT', 'http://localhost:9000');
  vi.stubEnv('MINIO_ACCESS_KEY', 'minioadmin');
  vi.stubEnv('MINIO_SECRET_KEY', 'minioadmin');
  vi.stubEnv('INTERNAL_SECRET', 'test-internal-secret');

  const mod = await import('./characters.js');
  return mod.parseCharacterAnalysisJson;
}

describe('character analysis JSON parser', () => {
  it('parses fenced JSON after removing trailing commas', async () => {
    const parseCharacterAnalysisJson = await loadParser();

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

  it('repairs simple unquoted object keys without changing string values', async () => {
    const parseCharacterAnalysisJson = await loadParser();

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
