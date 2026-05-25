import { describe, expect, it } from 'vitest';
import {
  buildResourceImagePrompt,
  cleanCharacterDescriptionForReference,
  normalizeExtractedCharacters,
  normalizeExtractedItems,
  normalizeExtractedScenes,
} from '@oneness/shared/resource-prompts';

describe('resource prompt governance', () => {
  it('removes scene actions and independent props from character references', () => {
    const cleaned = cleanCharacterDescriptionForReference(
      '青年女性，短发，穿深蓝色围裙，拿着相机在街道奔跑，身边放着旧照片。',
    );

    expect(cleaned).toContain('短发');
    expect(cleaned).toContain('深蓝色围裙');
    expect(cleaned).not.toMatch(/相机|街道|奔跑|旧照片/);
  });

  it('normalizes character extraction into pure avatar prompts', () => {
    const [character] = normalizeExtractedCharacters([
      {
        name: '林夏',
        appearanceType: 'onscreen',
        evidence: ['林夏低头修理柜台下的雾灯。'],
        description: '29岁便利店店员，短发，穿深蓝色围裙，拿着雾灯在储物间维修。',
        bio: '外表冷静，习惯修好坏掉的小物件。',
        avatarPrompt: '半身像，背景是便利店货架。',
      },
    ]);

    expect(character).toMatchObject({
      name: '林夏',
    });
    expect(character?.description).not.toMatch(/雾灯|储物间|维修/);
    expect(character?.avatarPrompt).toMatch(/纯角色参考图|单一角色/);
    expect(character?.avatarPrompt).toMatch(/简洁影棚背景/);
    expect(character?.avatarPrompt).toMatch(/不要街道|不要环境道具/);
  });

  it('drops characters that are only mentioned in dialogue', () => {
    const characters = normalizeExtractedCharacters([
      {
        name: '吴雨华',
        appearanceType: 'onscreen',
        evidence: ['吴雨华拆开旧信封，久久没有说话。'],
        description: '七十多岁的退休教师，白发，衣着朴素。',
        bio: '她始终惦记着没能寄出的信。',
      },
      {
        name: '小六',
        appearanceType: 'mentioned_only',
        evidence: ['陈长庚说：小六那年也问过这件事。'],
        description: '仅在对话中被提及，没有出场。',
        bio: '陈长庚口中的年轻熟人。',
      },
      {
        name: '大宝',
        evidence: ['大宝只是被老张顺口提到。'],
        description: '只在一段对白里被提到，未出场。',
        bio: '对剧情关系有背景意义，但不需要生成视觉角色。',
      },
    ]);

    expect(characters.map((character) => character.name)).toEqual(['吴雨华']);
  });

  it('splits composite props and generates single-object prompts', () => {
    const items = normalizeExtractedItems([
      {
        name: '旧照片和信封',
        description: '旧照片和信封一起放在铁盒里，是关键线索。',
        prompt: '两个物品并排放在桌面上。',
      },
    ]);

    expect(items.map((item) => item.name)).toEqual(['旧照片', '信封']);
    for (const item of items) {
      expect(item.prompt).toMatch(/单物体道具参考图/);
      expect(item.prompt).toMatch(/只画一个完整/);
      expect(item.prompt).toMatch(/禁止：两个、多个/);
      expect(item.prompt).toMatch(/挤在一起/);
    }
  });

  it('builds governed prompts for each resource kind', () => {
    const characterPrompt = buildResourceImagePrompt({
      kind: 'character-style',
      name: '周鸣',
      description: '17岁学生，短发，校服外套湿了一半，背着黑色书包，在雨夜奔跑。',
      styleName: '雨夜校服造型',
      userPrompt: '站在便利店门口，手里拿着缴费单。',
      projectStylePrompt: '写实电影感',
      ratio: '16:9',
    });
    expect(characterPrompt).toMatch(/纯角色参考图/);
    expect(characterPrompt).toMatch(/纯白、浅灰/);
    expect(characterPrompt).not.toMatch(/便利店门口|缴费单|雨夜奔跑/);

    const itemPrompt = buildResourceImagePrompt({
      kind: 'item',
      name: '手写欠条',
      description: '一张折过的手写欠条。',
      userPrompt: '桌上放两张欠条。',
    });
    expect(itemPrompt).toMatch(/只画一个完整的「手写欠条」/);
    expect(itemPrompt).toMatch(/不能出现第二个同类物体/);

    const scenePrompt = buildResourceImagePrompt({
      kind: 'scene',
      name: '雾灯便利店',
      description: '深夜雨雾中的便利店，玻璃门外有湿冷街灯。',
      userPrompt: '林夏站在柜台后。',
    });
    expect(scenePrompt).toMatch(/场景参考图/);
    expect(scenePrompt).toMatch(/只呈现空间环境本身/);
    expect(scenePrompt).toMatch(/禁止：人物作为主体/);
  });

  it('normalizes scene extraction into environment-only prompts', () => {
    const [scene] = normalizeExtractedScenes([
      {
        name: 'INT. 雾灯便利店 - 深夜',
        description: '雨雾压在玻璃门外，便利店白光闪烁。',
        prompt: '林夏正在修雾灯。',
      },
    ]);

    expect(scene?.prompt).toMatch(/environment reference|场景参考图/);
    expect(scene?.prompt).toMatch(/禁止：人物作为主体/);
  });
});
