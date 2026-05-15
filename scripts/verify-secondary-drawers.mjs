#!/usr/bin/env node
/**
 * End-to-end verification: open the cc-overnight project, exercise each tab's
 * secondary detail drawer (Items + Scenes + Character styles), and confirm
 * editing prompts + selecting models works.
 *
 * Captures screenshots into docs/research/my-output/secondary-*.png.
 */
import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'docs/research/my-output');
await mkdir(OUT, { recursive: true });

const PROJECT_ID = 'cmp5trokf000713hipuoipkky'; // cc overnight
const TOKEN = 'dev'; // local API auth stub

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(`window.localStorage.setItem('auth_token', '${TOKEN}');`);
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`[console] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

async function snap(name) {
  const path = join(OUT, `secondary-${name}.png`);
  await page.screenshot({ path, fullPage: false });
  console.log('  ↳', path);
}

console.log('1. open project');
await page.goto(`http://localhost:3000/projects/${PROJECT_ID}`, { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(3500);
await snap('00-project-info');

async function clickTab(name) {
  // sidebar has icon-only buttons — pick by aria-label
  const btn = page.locator(`button[aria-label="${name}"]`).first();
  if (await btn.count()) {
    await btn.click({ force: true });
    await page.waitForTimeout(800);
    return true;
  }
  // fallback by visible text
  const t = page.locator(`text=${name}`).first();
  if (await t.count()) {
    await t.click({ force: true });
    await page.waitForTimeout(800);
    return true;
  }
  return false;
}

console.log('2. items tab');
await clickTab('物品');
await snap('01-items-tab');

// Click first item card (skip add card)
const firstItemCard = page
  .locator('.cursor-pointer.hover\\:shadow-md, [class*="cursor-pointer"][class*="hover:shadow-md"]')
  .first();
if (await firstItemCard.count()) {
  await firstItemCard.click({ force: true });
  await page.waitForTimeout(700);
  await snap('02-item-detail-drawer');

  // edit prompt
  const promptArea = page.locator('textarea').first();
  await promptArea.fill('一封旧信，泛黄纸面，红色邮戳，复古特写，柔和侧光');
  await snap('03-item-prompt-edited');

  // model dropdown (first select)
  const modelSel = page.locator('select').first();
  await modelSel.selectOption({ index: 0 }).catch(() => {});

  // close drawer with Escape via X button
  const closeBtn = page.locator('button:has(svg.lucide-x)').first();
  if (await closeBtn.count()) await closeBtn.click({ force: true });
  await page.waitForTimeout(400);
}

console.log('3. scenes tab');
await clickTab('场景');
await snap('04-scenes-tab');
const firstSceneCard = page
  .locator('.cursor-pointer.hover\\:shadow-md, [class*="cursor-pointer"][class*="hover:shadow-md"]')
  .first();
if (await firstSceneCard.count()) {
  await firstSceneCard.click({ force: true });
  await page.waitForTimeout(700);
  await snap('05-scene-detail-drawer');

  // hit "auto fill"
  const autoFill = page.locator('text=自动填充').first();
  if (await autoFill.count()) {
    await autoFill.click({ force: true });
    await page.waitForTimeout(500);
    await snap('06-scene-prompt-autofilled');
  }
  const closeBtn = page.locator('button:has(svg.lucide-x)').first();
  if (await closeBtn.count()) await closeBtn.click({ force: true });
}

console.log('4. characters tab');
await clickTab('角色');
await snap('07-characters-tab');
// Click the first style image in the right grid (if any styles exist)
const styleCard = page.locator('.aspect-\\[9\\/16\\]').first();
if (await styleCard.count()) {
  await styleCard.click({ force: true });
  await page.waitForTimeout(700);
  await snap('08-style-detail-drawer');
}

console.log('errors:', errors);
console.log('done');
await browser.close();
