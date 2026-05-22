/**
 * Smoke-test new ZenMux models end-to-end against the live API, mirroring how
 * the worker calls them:
 *   - analysis (text)  → POST {OPENAI_BASE_URL}/chat/completions
 *   - openai image     → POST {OPENAI_BASE_URL}/images/generations
 *   - gemini image     → POST {ZENMUX_VERTEX_BASE_URL}/v1/models/{m}:generateContent
 *
 * Reads OPENAI_API_KEY / OPENAI_BASE_URL from a dotenv file (default
 * .env.production) WITHOUT printing the secret. Fires real requests — it costs
 * credit by design. Override the env file with: node smoke-models.mjs <path>
 *
 * Exit code is non-zero if any model fails, so it doubles as a CI gate.
 */
import { readFileSync } from 'node:fs';

const ENV_FILE = process.argv[2] || '.env.production';

function loadEnv(file) {
  const out = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = loadEnv(ENV_FILE);
const KEY = env.OPENAI_API_KEY;
const BASE = (env.OPENAI_BASE_URL || 'https://zenmux.ai/api/v1').replace(/\/$/, '');
const VERTEX = (env.ZENMUX_VERTEX_BASE_URL || 'https://zenmux.ai/api/vertex-ai').replace(/\/$/, '');
const VKEY = env.ZENMUX_API_KEY || KEY;

if (!KEY) {
  console.error(`No OPENAI_API_KEY in ${ENV_FILE}`);
  process.exit(2);
}

const ANALYSIS = ['google/gemini-3.5-flash', 'openai/gpt-5.5', 'bytedance/doubao-seedance-2.0'];
const IMAGE_OPENAI = ['qwen/qwen-image-2.0', 'qwen/qwen-image-2.0-pro', 'bytedance/doubao-seedream-5.0-lite'];
const IMAGE_GEMINI = ['google/gemini-3.1-flash-image-preview'];

const TIMEOUT_MS = 180_000;

async function post(url, key, body) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = null; }
    return { ok: res.ok, status: res.status, json, text, ms: Date.now() - started };
  } finally {
    clearTimeout(t);
  }
}

function fail(model, status, detail) {
  console.log(`  ✗ ${model.padEnd(42)} HTTP ${status} — ${String(detail).slice(0, 200).replace(/\s+/g, ' ')}`);
  return false;
}
function pass(model, ms, detail) {
  console.log(`  ✓ ${model.padEnd(42)} ${String(ms + 'ms').padStart(7)}  ${detail}`);
  return true;
}

async function testAnalysis(model) {
  const r = await post(`${BASE}/chat/completions`, KEY, {
    model,
    messages: [{ role: 'user', content: '只回复两个字：你好' }],
    max_tokens: 32,
  });
  if (!r.ok) return fail(model, r.status, r.json?.error?.message ?? r.text);
  const content = r.json?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.length === 0) {
    return fail(model, r.status, `no message content: ${r.text.slice(0, 160)}`);
  }
  return pass(model, r.ms, `reply="${content.replace(/\s+/g, ' ').slice(0, 30)}"`);
}

async function testImageOpenai(model) {
  const r = await post(`${BASE}/images/generations`, KEY, {
    model,
    prompt: 'a single red apple on a clean white background, studio lighting',
    n: 1,
    size: '1024x1024',
  });
  if (!r.ok) return fail(model, r.status, r.json?.error?.message ?? r.text);
  const item = r.json?.data?.[0];
  const got = item?.b64_json ? `b64(${item.b64_json.length}B)` : item?.url ? `url` : null;
  if (!got) return fail(model, r.status, `no image in data: ${r.text.slice(0, 160)}`);
  return pass(model, r.ms, got);
}

async function testImageGemini(model) {
  const url = `${VERTEX}/v1/models/${encodeURI(model)}:generateContent`;
  const r = await post(url, VKEY, {
    contents: [{ role: 'user', parts: [{ text: 'a single red apple on a clean white background' }] }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '1:1' } },
  });
  if (!r.ok) return fail(model, r.status, r.json?.error?.message ?? r.text);
  if (r.json?.promptFeedback?.blockReason) return fail(model, r.status, `blocked: ${r.json.promptFeedback.blockReason}`);
  const parts = r.json?.candidates?.[0]?.content?.parts ?? [];
  const img = parts.find((p) => p.inlineData?.data);
  if (!img) return fail(model, r.status, `no image part: ${r.text.slice(0, 160)}`);
  return pass(model, r.ms, `inlineData(${img.inlineData.data.length}B)`);
}

const results = [];
console.log(`\nZenMux smoke test  base=${BASE}  vertex=${VERTEX}\n`);

console.log('Analysis models (chat/completions):');
for (const m of ANALYSIS) results.push(await testAnalysis(m));

console.log('\nImage models — openai images path (/images/generations):');
for (const m of IMAGE_OPENAI) results.push(await testImageOpenai(m));

console.log('\nImage models — gemini vertex path (:generateContent):');
for (const m of IMAGE_GEMINI) results.push(await testImageGemini(m));

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed\n`);
process.exit(passed === results.length ? 0 : 1);
