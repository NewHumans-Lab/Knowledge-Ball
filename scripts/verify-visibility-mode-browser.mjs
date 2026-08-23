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

async function readVisibilityState(button) {
  return button.evaluate(element => ({
    text: element.textContent?.trim() ?? '',
    mode: element.dataset.visibilityMode ?? '',
  }));
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
    await page.waitForFunction(() => document.querySelector('#btnPersonal')?.dataset.visibilityMode === 'current');

    const assertState = async (text, mode) => {
      const state = await readVisibilityState(button);
      assert.deepEqual(state, { text, mode });
    };

    await assertState('当前', 'current');
    await button.click();
    await assertState('个人', 'personal');
    await button.click();
    await assertState('全部', 'all');
    await button.click();
    await assertState('当前', 'current');

    assert.deepEqual(pageErrors, [], `visibility cycle produced page errors:\n${pageErrors.join('\n')}`);
    console.log('Built-page Current -> Personal -> All -> Current browser regression passed');
  } finally {
    await browser.close();
  }
} finally {
  server.kill('SIGTERM');
}
