import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const target = process.argv[2];
const expectedBuild = process.argv[3] || null;
if (!target) throw new Error('Usage: node scripts/diagnose-live-visibility-cycle.mjs <url> [expected-build]');

const browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader'] });
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  const url = new URL(target);
  url.searchParams.set('kb_live_visibility_probe', String(Date.now()));
  await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 });
  const button = page.locator('#btnPersonal');
  await button.waitFor({ state: 'visible', timeout: 20_000 });

  // Let remote-first bootstrap finish far enough for normal app listeners to bind.
  // Do not wait on a build marker: its absence is itself evidence of an obsolete
  // deployed shell and must be reported rather than hidden behind a locator timeout.
  await page.waitForTimeout(8_000);

  const snapshot = async () => button.evaluate(element => ({
    text: element.textContent?.trim() ?? '',
    mode: element.dataset.visibilityMode ?? '',
    title: element.getAttribute('title') ?? '',
  }));
  const tap = async () => {
    const box = await button.boundingBox();
    assert.ok(box, 'visibility button must expose a real touch target');
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(150);
  };

  const states = [await snapshot()];
  for (let index = 0; index < 3; index += 1) {
    await tap();
    states.push(await snapshot());
  }

  const pageIdentity = await page.evaluate(() => ({
    build: document.querySelector('meta[name="knowledge-ball-build"]')?.getAttribute('content') ?? null,
    appScripts: [...document.querySelectorAll('script[src]')].map(script => script.getAttribute('src')),
    visibilityButtons: document.querySelectorAll('#btnPersonal').length,
  }));
  const diagnostics = { target, expectedBuild, ...pageIdentity, states, pageErrors };
  console.log('LIVE_VISIBILITY_DIAGNOSTICS');
  console.log(JSON.stringify(diagnostics, null, 2));

  assert.equal(pageIdentity.visibilityButtons, 1, 'live page must contain exactly one Personal visibility control');
  if (expectedBuild) {
    assert.equal(pageIdentity.build, expectedBuild, `live Pages build drift: expected ${expectedBuild}, got ${pageIdentity.build ?? 'missing'}`);
  }
  assert.deepEqual(
    states.map(state => [state.text, state.mode]),
    [
      ['当前', 'current'],
      ['个人', 'personal'],
      ['全部', 'all'],
      ['当前', 'current'],
    ],
    'live mobile touch cycle must be Current -> Personal -> All -> Current',
  );
  assert.deepEqual(pageErrors, [], `live page errors:\n${pageErrors.join('\n')}`);
} finally {
  await browser.close();
}
