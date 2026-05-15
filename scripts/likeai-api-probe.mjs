#!/usr/bin/env node
/**
 * Direct API probe of likeai.pro using the auth token.
 *
 * Dumps JSON for each endpoint into docs/research/likeai-live/api/*.json
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
const DEMO = '6a054ecacd9cde40ac0c811b'; // 一封信

async function get(path, file) {
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const text = await res.text();
  let body = text;
  try { body = JSON.stringify(JSON.parse(text), null, 2); } catch {}
  await writeFile(join(OUT, file), `// GET ${url} → ${res.status}\n${body}`);
  console.log(`${res.status} ${path} → ${file}`);
  try { return JSON.parse(text); } catch { return null; }
}

await get('/api/users/me', 'me.json');
const projects = await get('/api/projects', 'projects.json');

await get(`/api/projects/${DEMO}`, 'project_detail.json');
await get(`/api/projects/${DEMO}/info`, 'project_info.json');
await get(`/api/projects/${DEMO}/characters`, 'characters.json');
const charsResp = await get(`/api/projects/${DEMO}/characters`, 'characters.json');

// Try character-info if we can find an id
const charList = charsResp?.characters || charsResp?.data || charsResp?.items || [];
console.log('found', charList.length, 'characters');
const firstCharId = charList[0]?.id || charList[0]?.character_id;
if (firstCharId) {
  await get(`/api/projects/${DEMO}/character/${firstCharId}/info`, 'character_info.json');
  await get(`/api/projects/${DEMO}/character/${firstCharId}/styles`, 'character_styles.json');
  await get(`/api/projects/${DEMO}/character/${firstCharId}/appearances`, 'character_appearances.json');
}

await get(`/api/projects/${DEMO}/items`, 'items.json');
await get(`/api/projects/${DEMO}/scenes`, 'scenes.json');
await get(`/api/projects/${DEMO}/episodes`, 'episodes.json');
await get(`/api/projects/${DEMO}/storyboard`, 'storyboard.json');
await get(`/api/projects/${DEMO}/shots`, 'shots.json');
await get(`/api/projects/${DEMO}/scripts`, 'scripts.json');
await get(`/api/projects/${DEMO}/script`, 'script.json');

// Models/styles
await get('/api/styles', 'styles.json');
await get('/api/models', 'models.json');
await get('/api/models/image', 'models_image.json');
await get('/api/models/video', 'models_video.json');
await get('/api/models/text', 'models_text.json');
await get('/api/image-models', 'image_models.json');
await get('/api/video-models', 'video_models.json');
await get('/api/voices', 'voices.json');
await get('/api/categories', 'categories.json');
await get('/api/project-categories', 'project_categories.json');

// Knowledge docs
await get('/api/knowledge-docs', 'knowledge_docs.json');
await get('/api/knowledge_docs', 'knowledge_docs_alt.json');

console.log('\nAll done. Check docs/research/likeai-live/api');
