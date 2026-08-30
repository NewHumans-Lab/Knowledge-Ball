import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const origin = 'http://127.0.0.1:4173/Knowledge-Ball/';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1'], { stdio: 'ignore' });

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(origin)).ok) return;
    } catch { /* preview not ready */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Vite preview did not become ready');
}

async function visibleLabelSignature(page) {
  return page.evaluate(() => [...document.querySelectorAll('.node-label')]
    .map((label, index) => getComputedStyle(label).display !== 'none'
      ? `${index}:${label.textContent?.trim() ?? ''}`
      : null)
    .filter(Boolean));
}

async function settleLabels(page) {
  let previous = '';
  let stablePasses = 0;
  let latest = [];
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await page.waitForTimeout(120);
    latest = await visibleLabelSignature(page);
    const next = latest.join('|');
    if (next === previous) stablePasses += 1;
    else stablePasses = 0;
    previous = next;
    if (stablePasses >= 2) return latest;
  }
  throw new Error(`label set did not settle: ${latest.join(' | ')}`);
}

async function wheel(page, deltaY) {
  await page.locator('#canvasHost canvas').evaluate((canvas, delta) => {
    canvas.dispatchEvent(new WheelEvent('wheel', {
      deltaY: delta,
      bubbles: true,
      cancelable: true,
    }));
  }, deltaY);
  return settleLabels(page);
}

try {
  await waitForServer();
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader'] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 777 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });

    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.__debug?.scene && window.__debug?.renderNodes?.length));
    await page.waitForFunction(() => [...document.querySelectorAll('.node-label')].some(label => getComputedStyle(label).display !== 'none'));

    const forward = [await settleLabels(page)];
    assert.ok(forward[0].length >= 12 && forward[0].length <= 18, `initial large-mobile label budget must be 12..18 (actual=${forward[0].length})`);

    for (let step = 0; step < 4; step += 1) forward.push(await wheel(page, -260));
    for (const state of forward) assert.ok(state.length <= 18, `zoomed label budget must never exceed 18 (actual=${state.length})`);
    assert.ok(forward.slice(1).some(state => state.join('|') !== forward[0].join('|')), 'zoom sequence must exercise at least one different visible label set');

    const backward = [];
    for (let step = 0; step < 4; step += 1) backward.push(await wheel(page, 260));

    for (let index = 0; index < 4; index += 1) {
      const expected = forward[3 - index];
      const actual = backward[index];
      assert.deepEqual(actual, expected, `reverse zoom step ${index + 1} must restore the exact forward label set for the same camera state`);
    }
    assert.deepEqual(backward[3], forward[0], 'zooming all the way back must restore the original visible label set exactly');
    assert.deepEqual(errors, [], `label zoom reversibility browser gate must not emit page errors: ${errors.join(' | ')}`);

    await context.close();
  } finally {
    await browser.close();
  }
  console.log('Real mobile browser label zoom reversibility passed');
} finally {
  server.kill('SIGTERM');
}
