import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const target = process.argv[2];
const expectedBuild = process.argv[3];
if (!target || !expectedBuild) {
  throw new Error('Usage: node scripts/verify-live-visibility-cycle.mjs <deployed-url> <expected-build>');
}

const browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader'] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  const url = new URL(target);
  url.searchParams.set('kb_live_visibility_gate', `${expectedBuild}-${Date.now()}`);
  await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 });
  const button = page.locator('#btnPersonal');
  await button.waitFor({ state: 'visible', timeout: 20_000 });
  assert.equal(await button.count(), 1, 'deployed page must contain exactly one visibility control');
  await page.waitForFunction(
    () => document.querySelector('#btnPersonal')?.getAttribute('data-visibility-mode') === 'current'
      && window.__debug?.interaction?.getVisibilityMode?.() === 'current',
    null,
    { timeout: 20_000 },
  );

  const build = await page.evaluate(() => document.querySelector('meta[name="knowledge-ball-build"]')?.getAttribute('content') ?? null);
  assert.equal(build, expectedBuild, `deployed Pages artifact identity mismatch: expected ${expectedBuild}, got ${build ?? 'missing'}`);

  const readState = async () => page.evaluate(() => ({
    text: document.querySelector('#btnPersonal')?.textContent?.trim() ?? '',
    mode: document.querySelector('#btnPersonal')?.getAttribute('data-visibility-mode') ?? '',
    controllerMode: window.__debug?.interaction?.getVisibilityMode?.() ?? null,
  }));
  const touch = async expectedMode => {
    const box = await button.boundingBox();
    assert.ok(box && box.width > 0 && box.height > 0, 'deployed visibility control must expose a real touch target');
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForFunction(
      mode => document.querySelector('#btnPersonal')?.getAttribute('data-visibility-mode') === mode
        && window.__debug?.interaction?.getVisibilityMode?.() === mode,
      expectedMode,
      { timeout: 5_000 },
    );
  };

  assert.deepEqual(await readState(), { text: '当前', mode: 'current', controllerMode: 'current' });
  await touch('personal');
  assert.deepEqual(await readState(), { text: '个人', mode: 'personal', controllerMode: 'personal' });
  await touch('all');
  assert.deepEqual(await readState(), { text: '全部', mode: 'all', controllerMode: 'all' });
  await touch('current');
  assert.deepEqual(await readState(), { text: '当前', mode: 'current', controllerMode: 'current' });

  assert.deepEqual(pageErrors, [], `deployed visibility flow produced page errors:\n${pageErrors.join('\n')}`);
  console.log(`Deployed real-touch visibility gate passed for ${expectedBuild}: Current -> Personal -> All -> Current`);
} finally {
  await browser.close();
}
