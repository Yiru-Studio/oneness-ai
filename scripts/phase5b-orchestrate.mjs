#!/usr/bin/env node
/* Phase 5b orchestrator: run full pipeline for cc-overnight project end-to-end. */
const PROJECT_ID = 'cmp5trokf000713hipuoipkky';
const API = 'http://localhost:4000';
const TOKEN = 'test';

async function api(path, opts = {}) {
  const r = await fetch(API + path, {
    method: opts.method || 'GET',
    headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${path}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function pollTask(id, timeoutMs = 300_000, every = 5000) {
  const start = Date.now();
  while (true) {
    const t = await api(`/api/tasks/${id}`);
    if (t.status === 'SUCCEEDED' || t.status === 'FAILED' || t.status === 'CANCELLED') return t;
    if (Date.now() - start > timeoutMs) throw new Error('poll timeout for ' + id);
    await new Promise((r) => setTimeout(r, every));
  }
}

async function genImage(prompt, ratio = '1:1') {
  const t = await api('/api/tasks', {
    method: 'POST',
    body: { type: 'IMAGE', projectId: PROJECT_ID, provider: 'openai', input: { prompt, ratio, model: 'openai/gpt-image-2', n: 1 } },
  });
  console.log('  → image task', t.id);
  const final = await pollTask(t.id, 600_000, 5000);
  if (final.status !== 'SUCCEEDED') throw new Error(`image failed: ${final.error}`);
  return final.outputAssets[0].id;
}

async function genVideo(prompt, ratio = '16:9') {
  const t = await api('/api/tasks', {
    method: 'POST',
    body: { type: 'VIDEO', projectId: PROJECT_ID, provider: 'seedance-fast', input: { prompt, ratio, duration: 5, model: 'doubao-seedance-2-0-fast-260128' } },
  });
  console.log('  → video task', t.id);
  const final = await pollTask(t.id, 600_000, 8000);
  if (final.status !== 'SUCCEEDED') throw new Error(`video failed: ${final.error}`);
  return { assetId: final.outputAssets[0].id, url: final.outputAssets[0].url };
}

(async () => {
  console.log('### Phase 5b orchestrator');
  const proj = await api(`/api/projects/${PROJECT_ID}`);
  console.log('project:', proj.name, proj.ratio, proj.style);

  const eps = await api(`/api/projects/${PROJECT_ID}/episodes`);
  console.log('episodes:', eps.length);

  const chars = await api(`/api/projects/${PROJECT_ID}/characters`);
  console.log('characters:', chars.length);
  for (const c of chars.slice(0, 4)) {
    if (c.avatar) { console.log(`  skip avatar (already set): ${c.name}`); continue; }
    console.log(`  generating avatar for ${c.name}…`);
    try {
      const prompt = [
        `角色：${c.name}`,
        c.description ? `描述：${c.description}` : '',
        c.bio ? `背景：${c.bio}` : '',
        '输出：单人头像，半身像，正面，正常表情，光线自然，cinematic, 16:9',
      ].filter(Boolean).join('\n');
      const assetId = await genImage(prompt, '1:1');
      await api(`/api/characters/${c.id}`, { method: 'PATCH', body: { avatarAssetId: assetId } });
      console.log(`  ✓ ${c.name} avatar ${assetId}`);
    } catch (e) { console.log(`  ✗ ${c.name}: ${e.message}`); }
  }

  const items = await api(`/api/projects/${PROJECT_ID}/items`);
  console.log('items:', items.length);
  for (const it of items.slice(0, 3)) {
    if (it.image) { console.log(`  skip item (already has image): ${it.name}`); continue; }
    console.log(`  generating item image for ${it.name}…`);
    try {
      const assetId = await genImage(`物品：${it.name}\n输出：单个物品特写，纯色背景，光线柔和，cinematic`, '1:1');
      await api(`/api/items/${it.id}`, { method: 'PATCH', body: { assetId } });
      console.log(`  ✓ ${it.name} ${assetId}`);
    } catch (e) { console.log(`  ✗ ${it.name}: ${e.message}`); }
  }

  const scenes = await api(`/api/projects/${PROJECT_ID}/scenes`);
  console.log('scenes:', scenes.length);
  for (const sc of scenes.slice(0, 2)) {
    if (sc.image) { console.log(`  skip scene (already has image): ${sc.name}`); continue; }
    console.log(`  generating scene image for ${sc.name}…`);
    try {
      const assetId = await genImage(`场景：${sc.name}\n输出：俯视全景，光线明确，环境细节丰富，cinematic`, '16:9');
      await api(`/api/scenes/${sc.id}`, { method: 'PATCH', body: { assetId } });
      console.log(`  ✓ ${sc.name} ${assetId}`);
    } catch (e) { console.log(`  ✗ ${sc.name}: ${e.message}`); }
  }

  console.log('### Generating shot video for first scene');
  const firstScene = scenes[0];
  if (firstScene) {
    try {
      const result = await genVideo(`场景：${firstScene.name}\n动作：七十岁老妇人在木桌前写信，光线温暖，慢镜头`, '16:9');
      console.log(`  ✓ video ${result.assetId} → ${result.url.slice(0, 100)}…`);
    } catch (e) { console.log(`  ✗ video failed: ${e.message}`); }
  }

  console.log('### DONE');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
