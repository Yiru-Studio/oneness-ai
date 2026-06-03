import { describe, expect, it } from 'vitest';
import { mergeShotSketchReferenceIds } from './shot-sketch-reference-prefill.js';

describe('shot sketch reference prefill helpers', () => {
  it('prefers shot references over broader composition task references', () => {
    expect(mergeShotSketchReferenceIds(
      {
        characterStyleIds: ['style-driver', 'style-passenger'],
        sceneIds: ['scene-car'],
        itemIds: ['item-phone'],
      },
      {
        characterStyleIds: ['style-driver', 'style-closeup'],
        sceneIds: ['scene-car', 'scene-window'],
        itemIds: ['item-phone', 'item-order'],
      },
    )).toEqual({
      characterStyleIds: ['style-driver', 'style-closeup'],
      sceneIds: ['scene-car', 'scene-window'],
      itemIds: ['item-phone', 'item-order'],
    });
  });

  it('falls back to composition scene references but not broad characters or items', () => {
    expect(mergeShotSketchReferenceIds(
      {
        characterStyleIds: ['style-driver', 'style-passenger'],
        sceneIds: ['scene-car'],
        itemIds: ['item-phone'],
      },
      {
        characterStyleIds: [],
        sceneIds: [],
        itemIds: [],
      },
    )).toEqual({
      characterStyleIds: [],
      sceneIds: ['scene-car'],
      itemIds: [],
    });
  });

  it('ignores non-string JSON values in saved reference arrays', () => {
    expect(mergeShotSketchReferenceIds(
      { characterStyleIds: ['style-task', 1], sceneIds: null, itemIds: ['item-task'] },
      { characterStyleIds: [false, 'style-shot'], sceneIds: ['scene-shot'], itemIds: [{}] },
    )).toEqual({
      characterStyleIds: ['style-shot'],
      sceneIds: ['scene-shot'],
      itemIds: [],
    });
  });
});
