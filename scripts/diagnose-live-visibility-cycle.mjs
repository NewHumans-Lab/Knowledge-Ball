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

  // Let the production app finish remote-first bootstrap, but do not require the
  // canonical dataset yet: an old binary build is exactly what this probe must expose.
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

  const build = await page.locator('meta[name="knowledge-ball-build"]').getAttribute('content');
  const diagnostics = { target, expectedBuild, build, states, pageErrors };
  console.log('LIVE_VISIBILITY_DIAGNOSTICS');
  console.log(JSON.stringify(diagnostics, null, 2));

  if (expectedBuild) {
    assert.equal(build, expectedBuild, `live Pages build drift: expected ${expectedBuild}, got ${build ?? 'missing'}`);
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
