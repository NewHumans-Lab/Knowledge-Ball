import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const origin = 'http://127.0.0.1:4173/Knowledge-Ball/';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1'], { stdio: 'ignore' });
let browser;
try {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if ((await fetch(origin)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__debug?.scene?.getWorkMetrics));
  await page.evaluate(() => window.__debug.scene.markDirty());
  await page.waitForTimeout(250);
  const before = await page.evaluate(() => window.__debug.scene.getWorkMetrics());
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => window.__debug.scene.getWorkMetrics());
  const idleFrames = after.idleFrames - before.idleFrames;
  const synchronizationPasses = after.synchronizationPasses - before.synchronizationPasses;
  assert(idleFrames > 0, 'the real scene must render idle frames during the measurement');
  assert.equal(synchronizationPasses, 0, 'idle frames must not perform graph/style/position O(N+E) synchronization');
  console.log(JSON.stringify({ idleFrames, synchronizationPasses }));
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
