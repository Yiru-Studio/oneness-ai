import { describe, expect, it } from 'vitest';
import { resolveShotReferencesFromNames } from '../src/lib/shot-reference-prefill';

describe('shot reference prefill', () => {
  it('resolves exact role names to one character style and prefers styles with images', () => {
    const refs = resolveShotReferencesFromNames({
      roles: ['司机', '我'],
      items: ['手机'],
      characters: [
        {
          name: '司机',
          styles: [
            { id: 'style-driver-default', assetId: null },
            { id: 'style-driver-driving', assetId: 'asset-driver' },
          ],
        },
        {
          name: '我',
          styles: [
            { id: 'style-passenger-first', assetId: null },
            { id: 'style-passenger-second', assetId: null },
          ],
        },
      ],
      itemRows: [{ id: 'item-phone', name: '手机' }],
      scene: {
        title: 'INT. 网约车后座 - 夜',
        environment: '网约车内、驾驶室',
        content: '我坐在后座，司机透过后视镜看过来。',
      },
      sceneRows: [{ id: 'scene-car', name: '网约车内', description: '后座和驾驶室', prompt: '' }],
    });

    expect(refs).toEqual({
      characterStyleIds: ['style-driver-driving', 'style-passenger-first'],
      itemIds: ['item-phone'],
      sceneIds: ['scene-car'],
    });
  });

  it('selects the matching character style by phase and scene hint metadata', () => {
    const refs = resolveShotReferencesFromNames({
      roles: ['司机'],
      items: [],
      characters: [
        {
          name: '司机',
          styles: [
            {
              id: 'style-home',
              name: '居家造型',
              assetId: 'asset-home',
              prompt: '造型元数据：phase=下班回家；outfit=灰色毛衣；sceneHint=家中\n纯角色参考图',
            },
            {
              id: 'style-driving',
              name: '雨夜接单造型',
              assetId: null,
              prompt: '造型元数据：phase=雨夜接单；outfit=深色夹克；sceneHint=网约车驾驶室\n纯角色参考图',
            },
          ],
        },
      ],
      itemRows: [],
      scene: {
        title: 'INT. 网约车驾驶室 - 夜',
        environment: '网约车驾驶室，仪表盘冷光',
        content: '雨夜接单，司机穿深色夹克透过后视镜观察后座。',
      },
    });

    expect(refs.characterStyleIds).toEqual(['style-driving']);
  });

  it('does not resolve partial role names but can resolve item descriptions', () => {
    const refs = resolveShotReferencesFromNames({
      roles: ['网约车司机'],
      items: ['手机'],
      characters: [
        { name: '司机', styles: [{ id: 'style-driver', assetId: 'asset-driver' }] },
      ],
      itemRows: [
        { id: 'item-device', name: '通讯设备', description: '一部手机，订单页面亮起' },
      ],
    });

    expect(refs).toEqual({
      characterStyleIds: [],
      itemIds: ['item-device'],
      sceneIds: [],
    });
  });
});
