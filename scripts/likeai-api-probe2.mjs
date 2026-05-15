#!/usr/bin/env node
/**
 * Deeper probe: episodes contain "scenes" (shots/scenes nested inside).
 * Also try project info via different prefixes.
 */
import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'docs/research/likeai-live/api');
await mkdir(OUT, { recursive: true });

const TOKEN = process.env.LIKEAI_TOKEN || '';
if (!TOKEN) {
  console.error('Set LIKEAI_TOKEN env var with your likeai.pro Bearer token');
  process.exit(1);
}
const BASE = 'https://likeai.pro';
const DEMO = '6a054ecacd9cde40ac0c811b';
const EPISODE = '6a054edccd9cde40ac0c811f';

async function get(path, file) {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const text = await res.text();
  let body = text;
  try { body = JSON.stringify(JSON.parse(text), null, 2); } catch {}
  await writeFile(join(OUT, file), `// GET ${BASE}${path} → ${res.status}\n${body}`);
  console.log(`${res.status} ${path} → ${file}`);
  try { return JSON.parse(text); } catch { return null; }
}

await get(`/api/projects/${DEMO}/episode/${EPISODE}`, 'episode_detail.json');
await get(`/api/projects/${DEMO}/episode/${EPISODE}/info`, 'episode_info.json');
await get(`/api/projects/${DEMO}/episodes/${EPISODE}`, 'episodes_byid.json');
await get(`/api/projects/${DEMO}/episodes/${EPISODE}/scenes`, 'episode_scenes.json');
await get(`/api/projects/${DEMO}/episode/${EPISODE}/scenes`, 'episode_scenes2.json');
await get(`/api/projects/${DEMO}/episode/${EPISODE}/shots`, 'episode_shots.json');
await get(`/api/projects/${DEMO}/scenes_by_episode/${EPISODE}`, 'scenes_by_episode.json');
await get(`/api/projects/${DEMO}/style`, 'style.json');
await get(`/api/styles_list`, 'styles_list.json');
await get(`/api/style/list`, 'style_list.json');
await get(`/api/voice_list`, 'voice_list.json');
await get(`/api/voices/list`, 'voices_list.json');
await get(`/api/get_models`, 'get_models.json');
await get(`/api/model_list`, 'model_list.json');
await get(`/api/api_options`, 'api_options.json');
await get(`/api/options/api_options`, 'options_api_options.json');
await get(`/api/projects/${DEMO}/character`, 'character_root.json');
