import { describe, expect, it } from 'vitest';
import {
  episodeSetupForShotBreakdown,
  shotBreakdownSystemPrompt,
} from '../src/providers/openai-text';

describe('shot breakdown prompt', () => {
  it('requires structured production fields and avoids raw style tags', () => {
    const prompt = shotBreakdownSystemPrompt('game cg, splash art, highly detailed');

    expect(prompt).toContain('镜头功能');
    expect(prompt).toContain('秒级动作拆解');
    expect(prompt).toContain('人物关系位置');
    expect(prompt).toContain('电影级视觉参数');
    expect(prompt).toContain('音效设计');
    expect(prompt).toContain('Do NOT append raw prompt tags');
    expect(prompt).toContain('Produce 4 to 7 shots');
  });

  it('passes episode-level visual setup before the first scene', () => {
    const setup = episodeSetupForShotBreakdown(
      [
        '《雾灯便利店》',
        '视觉风格：写实电影感，雨夜霓虹，浅蓝与暖橙对比。',
        '',
        '场景一  外景  雾灯便利店门口  夜  雨',
        '雨下得很密。',
      ].join('\n'),
    );

    expect(setup).toContain('写实电影感');
    expect(setup).not.toContain('雨下得很密');
  });
});
