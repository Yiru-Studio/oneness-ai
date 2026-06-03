import { describe, expect, it } from 'vitest';
import { serializeEpisode } from './episode.js';

describe('episode serializer', () => {
  it('preserves sceneReferences for frontend compatibility while keeping legacy characters', () => {
    const dto = serializeEpisode({
      id: 'episode-1',
      projectId: 'project-1',
      number: 1,
      title: '雨夜网约车',
      content: 'content',
      analyzed: true,
      summary: 'summary',
      scenesJson: [{
        index: 0,
        title: 'INT. 网约车后座 - 夜',
        content: '我坐进后座。',
        characters: ['我', '司机', '中年女声'],
        environment: '车内',
        sceneReferences: {
          visibleCharacters: ['我', '司机'],
          mentionedCharacters: ['池清明'],
          voiceCharacters: ['中年女声'],
          visibleItems: ['手机'],
          mentionedItems: ['篮球'],
        },
      }],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    expect(dto.scenes[0]).toMatchObject({
      characters: ['我', '司机', '中年女声'],
      sceneReferences: {
        visibleCharacters: ['我', '司机'],
        mentionedCharacters: ['池清明'],
        voiceCharacters: ['中年女声'],
        backgroundCharacters: [],
        visibleItems: ['手机'],
        mentionedItems: ['篮球'],
        backgroundItems: [],
      },
    });
  });
});
