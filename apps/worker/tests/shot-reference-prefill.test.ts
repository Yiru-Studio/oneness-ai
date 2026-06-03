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

  it('resolves scenes from description and prompt phrases when the exact scene name is not present', () => {
    const refs = resolveShotReferencesFromNames({
      roles: [],
      items: [],
      characters: [],
      itemRows: [],
      scene: {
        title: 'EXT. 马路红绿灯 - 夜',
        environment: '雨夜路口，网约车车厢狭小昏暗，红绿灯光映在车窗和湿漉漉街道上',
        content: '我坐在网约车后座，司机透过后视镜看向车外的红灯。',
      },
      sceneRows: [
        {
          id: 'scene-rideshare-backseat',
          name: 'INT. 网约车后座 - 夜',
          description: '雨夜网约车后座，窗外红绿灯与湿漉漉街道',
          prompt: '后座、驾驶室、后视镜、车窗雨痕',
        },
      ],
    });

    expect(refs.sceneIds).toEqual(['scene-rideshare-backseat']);
  });

  it('prefers exact scene name matches over stronger shared phrase matches', () => {
    const refs = resolveShotReferencesFromNames({
      roles: [],
      items: [],
      characters: [],
      itemRows: [],
      scene: {
        title: '7A 校园主楼·门口大厅 昏 内',
        environment: '校园主楼·门口大厅',
        content: '吴翊杰跑到教学主楼门口，随后继续冲向楼梯。',
      },
      sceneRows: [
        {
          id: 'scene-main-hall',
          name: '校园主楼·门口大厅',
          description: '昏色主楼入口大厅，双马尾女生摔倒。',
          prompt: '',
        },
        {
          id: 'scene-stairwell',
          name: '校园主楼·楼梯间',
          description: '被旧课桌椅和人群堵塞的楼梯间。',
          prompt: '主楼、楼梯、冲向楼梯、旧课桌椅',
        },
      ],
    });

    expect(refs.sceneIds).toEqual(['scene-main-hall']);
  });
});
