import { describe, expect, it } from 'vitest';
import {
  canRefreshSceneImageTaskDraft,
  normalizeSceneImagePlans,
  parseSceneImagePlanResponse,
  parseSceneImageReferenceBindingResponse,
  referenceLibraryIdSets,
  sanitizeReferenceBinding,
  type EpisodeScene,
  type ReferenceLibraryForPlanning,
} from './composition-ai-planning.js';

describe('composition AI planning helpers', () => {
  it('parses and normalizes AI scene image plans', () => {
    const plans = parseSceneImagePlanResponse(`\`\`\`json
{
  "plans": [
    {
      "sceneIndex": 0,
      "name": "雨夜旧照相馆入口",
      "storyBeat": "林沐在雨夜发现照相馆。",
      "scriptExcerpt": "林沐撑伞跑过街口，旧灯牌亮起。",
      "prompt": "电影感雨夜街口，林沐撑蓝色透明雨伞，七格照相馆灯牌亮起。",
      "requiredReferences": {
        "characters": ["林沐"],
        "scenes": ["老城区街口"],
        "items": ["蓝色透明雨伞", "旧相机"]
      }
    },
  ]
}
\`\`\``);

    const fallback: EpisodeScene[] = [{
      index: 99,
      title: 'fallback',
      content: 'fallback content',
      characters: [],
      environment: '',
    }];
    const scenes = normalizeSceneImagePlans(plans, fallback);

    expect(scenes).toHaveLength(1);
    expect(scenes[0]).toMatchObject({
      index: 0,
      title: '雨夜旧照相馆入口',
      characters: ['林沐'],
      environment: '老城区街口',
    });
    expect(scenes[0]?.prompt).toContain('电影感雨夜街口');
  });

  it('falls back when AI planning output is unusable', () => {
    const fallback: EpisodeScene[] = [{
      index: 1,
      title: '照相馆内景',
      content: '柜台上放着旧相机。',
      characters: ['周岚'],
      environment: '七格照相馆',
    }];

    const scenes = normalizeSceneImagePlans(parseSceneImagePlanResponse('{"plans": []}'), fallback);

    expect(scenes).toBe(fallback);
  });

  it('drops invalid reference IDs from AI bindings', () => {
    const library: ReferenceLibraryForPlanning = {
      characters: [{
        id: 'char-1',
        name: '林沐',
        description: '高中女生',
        bio: '',
        styles: [
          { id: 'style-valid', name: '雨夜校服造型', prompt: '蓝色校服外套', assetId: 'asset-1' },
        ],
      }],
      scenes: [{ id: 'scene-valid', name: '老城区街口', description: '', prompt: '', assetId: 'asset-2' }],
      items: [{ id: 'item-valid', name: '旧相机', description: '', prompt: '', assetId: 'asset-3' }],
    };
    const [binding] = parseSceneImageReferenceBindingResponse(JSON.stringify({
      bindings: [{
        sceneIndex: 0,
        characterStyleIds: ['style-valid', 'style-invalid'],
        sceneIds: ['scene-invalid', 'scene-valid'],
        itemIds: ['item-valid', 'item-invalid'],
      }],
    }));

    expect(sanitizeReferenceBinding(binding!, referenceLibraryIdSets(library))).toEqual({
      characterStyleIds: ['style-valid'],
      sceneIds: ['scene-valid'],
      itemIds: ['item-valid'],
    });
  });

  it('only refreshes draft tasks that have not generated scene images', () => {
    expect(canRefreshSceneImageTaskDraft({
      status: 'DRAFT',
      currentImageRunId: null,
      imageAssetId: null,
      imageTaskId: null,
    })).toBe(true);

    expect(canRefreshSceneImageTaskDraft({
      status: 'DRAFT',
      currentImageRunId: 'run-1',
      imageAssetId: null,
      imageTaskId: null,
    })).toBe(false);

    expect(canRefreshSceneImageTaskDraft({
      status: 'IMAGE_READY',
      currentImageRunId: null,
      imageAssetId: 'asset-1',
      imageTaskId: 'task-1',
    })).toBe(false);
  });
});
