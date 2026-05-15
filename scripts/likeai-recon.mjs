#!/usr/bin/env node
/**
 * Likeai.pro reconnaissance with provided auth_token.
 *
 * Saves screenshots + a dump of the rendered DOM for each tab area we still
 * need to replicate.
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'docs/research/likeai-live');
const TOKEN = process.env.LIKEAI_TOKEN || '';
if (!TOKEN) {
  console.error('Set LIKEAI_TOKEN env var with your likeai.pro Bearer token');
  process.exit(1);
}
const BASE = 'https://likeai.pro';

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  userAgent:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
});

// Inject token before any document scripts run
await ctx.addInitScript(`window.localStorage.setItem('auth_token', '${TOKEN}');`);

const page = await ctx.newPage();
page.on('console', (msg) => {
  if (msg.type() === 'error') console.warn('[console error]', msg.text());
});
page.on('pageerror', (err) => console.warn('[pageerror]', err.message));

async function snap(name) {
  const path = join(OUT, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  const html = await page.content();
  await writeFile(join(OUT, `${name}.html`), html);
  console.log('  ↳', path);
}

async function waitNetworkIdle(ms = 1500) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(ms);
}

console.log('Step 1: login + projects list');
await page.goto(`${BASE}/projects`, { waitUntil: 'domcontentloaded' });
await waitNetworkIdle(2500);
await snap('01-projects-list');

// Find the demo project id from the rendered DOM
const projectIds = await page.evaluate(() => {
  const out = new Set();
  document.querySelectorAll('a[href*="/projects/"]').forEach((a) => {
    const m = a.getAttribute('href').match(/\/projects\/([a-f0-9]{24,})/);
    if (m) out.add(m[1]);
  });
  return Array.from(out);
});
console.log('Discovered projects:', projectIds);

// Prefer the demo project from earlier notes
const demoId = '6a054ecacd9cde40ac0c811b';
let targetId = projectIds.find((id) => id === demoId) || projectIds[0];
if (!targetId) {
  console.error('No project found via DOM scan – aborting');
  await browser.close();
  process.exit(2);
}
console.log('Using project:', targetId);

console.log('Step 2: project detail (info tab)');
await page.goto(`${BASE}/projects/${targetId}`, { waitUntil: 'domcontentloaded' });
await waitNetworkIdle(2500);
await snap('02-project-info');

async function clickTabByText(label) {
  // The SPA shows sidebar items with text labels. Click by text content.
  const handle = await page
    .locator(`text=${label}`)
    .first();
  if (await handle.count()) {
    await handle.click({ force: true });
    await waitNetworkIdle(1800);
    return true;
  }
  return false;
}

for (const [label, name] of [
  ['角色', '03-tab-characters'],
  ['物品', '04-tab-items'],
  ['场景', '05-tab-scenes'],
  ['工作台', '06-tab-workbench'],
  ['分镜', '07-tab-storyboard'],
]) {
  console.log(`Step: ${label}`);
  if (await clickTabByText(label)) {
    await snap(name);
  } else {
    console.warn('  could not click tab', label);
  }
}

// For characters tab — click the first character and capture detail
console.log('Step: open first character detail');
await clickTabByText('角色');
const firstChar = page.locator('[class*="character"] >> nth=0').first();
if (await firstChar.count()) {
  await firstChar.click({ force: true }).catch(() => {});
  await waitNetworkIdle(1500);
  await snap('03b-character-detail');
}

// Try to surface the "添加角色" modal
console.log('Step: open 添加角色 modal');
const addCharBtn = page.locator('text=添加角色').first();
if (await addCharBtn.count()) {
  await addCharBtn.click({ force: true });
  await waitNetworkIdle(800);
  await snap('03c-add-character-modal');
  // close
  await page.keyboard.press('Escape');
}

// Items "添加物品" → reveal prompt panel
console.log('Step: items add modal');
await clickTabByText('物品');
const addItemBtn = page.locator('text=添加物品').first();
if (await addItemBtn.count()) {
  await addItemBtn.click({ force: true });
  await waitNetworkIdle(800);
  await snap('04b-add-item-modal');
  await page.keyboard.press('Escape');
}

// Scenes
console.log('Step: scenes add modal');
await clickTabByText('场景');
const addSceneBtn = page.locator('text=添加场景').first();
if (await addSceneBtn.count()) {
  await addSceneBtn.click({ force: true });
  await waitNetworkIdle(800);
  await snap('05b-add-scene-modal');
  await page.keyboard.press('Escape');
}

// Storyboard – open first shot detail if available
console.log('Step: storyboard detail');
await clickTabByText('分镜');
const firstShot = page.locator('.shot, [class*="shot"]').first();
if (await firstShot.count()) {
  await firstShot.click({ force: true }).catch(() => {});
  await waitNetworkIdle(1500);
  await snap('07b-shot-detail');
}

console.log('Done');
await browser.close();
