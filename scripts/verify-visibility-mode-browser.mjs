import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const origin = 'http://127.0.0.1:4173/Knowledge-Ball/';
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1'],
  { stdio: 'ignore' },
);

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      if ((await fetch(origin)).ok) return;
    } catch { /* preview is still starting */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Vite preview did not become reachable');
}

try {
  await waitForServer();
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader'] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.goto(`${origin}?visibility-cycle-regression=1`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    const button = page.locator('#btnPersonal');
    await button.waitFor({ state: 'visible', timeout: 10_000 });
    assert.equal(await button.count(), 1, 'there must be exactly one visibility button');
    await page.waitForFunction(() => document.querySelector('#btnPersonal')?.dataset.visibilityMode === 'current');

    const readState = async () => page.evaluate(() => ({
      text: document.querySelector('#btnPersonal')?.textContent?.trim() ?? '',
      mode: document.querySelector('#btnPersonal')?.getAttribute('data-visibility-mode') ?? '',
      controllerMode: window.__debug?.interaction?.getVisibilityMode?.() ?? null,
    }));
    const assertState = async (text, mode) => {
      assert.deepEqual(await readState(), { text, mode, controllerMode: mode });
    };
    const touchButton = async expectedMode => {
      const box = await button.boundingBox();
      assert.ok(box && box.width > 0 && box.height > 0, 'visibility button must expose a real mobile touch target');
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForFunction(
        mode => document.querySelector('#btnPersonal')?.getAttribute('data-visibility-mode') === mode
          && window.__debug?.interaction?.getVisibilityMode?.() === mode,
        expectedMode,
        { timeout: 3_000 },
      );
    };

    // Two complete rounds catch duplicate listeners and any binary compatibility
    // path that silently collapses All back into Current/Personal.
    await assertState('当前', 'current');
    await touchButton('personal');
    await assertState('个人', 'personal');
    await touchButton('all');
    await assertState('全部', 'all');
    await touchButton('current');
    await assertState('当前', 'current');
    await touchButton('personal');
    await assertState('个人', 'personal');
    await touchButton('all');
    await assertState('全部', 'all');
    await touchButton('current');
    await assertState('当前', 'current');

    assert.deepEqual(pageErrors, [], `visibility cycle produced page errors:\n${pageErrors.join('\n')}`);
    console.log('Built-page real-touch Current -> Personal -> All -> Current x2 regression passed');
  } finally {
    await browser.close();
  }
} finally {
  server.kill('SIGTERM');
}
