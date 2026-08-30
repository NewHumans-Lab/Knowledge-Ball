import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const windowsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executable = process.argv[2] ?? path.join(windowsRoot, 'release', 'win-unpacked', 'Knowledge Ball.exe');
const artifacts = path.join(windowsRoot, 'artifacts');
await mkdir(artifacts, { recursive: true });

async function deterministic(page) {
  await page.waitForFunction(() => Boolean(window.__debug?.scene && window.__debug?.renderNodes?.length), null, { timeout: 30_000 });
  await page.evaluate(() => { localStorage.setItem('kb-locale', 'zh-CN'); window.__debug.scene.stop(); });
  await page.waitForTimeout(250);
}

const desktop = await electron.launch({ executablePath: executable, args: ['--disable-gpu-sandbox', '--use-angle=swiftshader'] });
try {
  const page = await desktop.firstWindow();
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await deterministic(page);
  assert.equal(new URL(page.url()).protocol, 'app:', 'desktop must load the packaged app protocol, not a hidden server');
  assert.ok(await page.locator('#canvasHost canvas').isVisible(), 'WebGL canvas must render');
  assert.ok((await page.locator('#canvasHost canvas').boundingBox())?.width > 1000, 'product must render edge-to-edge');

  await page.locator('#btnSettings').click();
  await page.locator('#settingsOverlay.show').waitFor();
  await page.locator('#setLocale').selectOption('en');
  assert.equal((await page.locator('#btnSettings').textContent())?.trim(), '⚙ Settings', 'language switch must update product chrome');
  await page.locator('#settingsClose').click();
  await page.locator('#aiInput').fill('identity');
  assert.equal(await page.locator('#aiInput').inputValue(), 'identity', 'search input must accept text');
  await page.keyboard.press('Control+N');
  await page.locator('#knowledgeCreateOverlay.show').waitFor();
  await page.locator('[data-create-submit]').click();
  assert.ok(await page.locator('#toast.show').isVisible(), 'create validation must remain visible');
  await page.locator('[data-create-close]').click();

  const target = await page.evaluate(() => window.__debug.renderNodes.map(node => ({ node, point: window.__debug.scene.screenPositionForNode(node.id) })).find(item => item.point && item.point.x > 80 && item.point.x < 1360 && item.point.y > 100 && item.point.y < 820));
  assert.ok(target, 'scene must expose a clickable node');
  await page.mouse.click(target.point.x, target.point.y);
  await page.locator('#nodeDetailOverlay.open').waitFor();
  await page.locator('#nodeDetailOverlay .node-detail-close').click();
  await page.mouse.move(720, 450); await page.mouse.down(); await page.mouse.move(750, 470); await page.mouse.up();
  await page.mouse.wheel(0, -120);
  assert.deepEqual(errors, [], `desktop runtime errors: ${errors.join('\n')}`);

  await page.evaluate(() => { localStorage.setItem('kb-locale', 'zh-CN'); location.reload(); });
  await deterministic(page);
  const desktopPng = await page.screenshot({ path: path.join(artifacts, 'desktop.png') });

  const reference = await desktop.context().newPage();
  await reference.setViewportSize({ width: 1440, height: 900 });
  await reference.goto('app://knowledge-ball/Knowledge-Ball/index.html');
  await deterministic(reference);
  const referencePng = await reference.screenshot({ path: path.join(artifacts, 'chromium-reference.png') });
  const actual = PNG.sync.read(desktopPng), expected = PNG.sync.read(referencePng);
  assert.equal(actual.width, expected.width); assert.equal(actual.height, expected.height);
  const diff = new PNG({ width: actual.width, height: actual.height });
  const changed = pixelmatch(actual.data, expected.data, diff.data, actual.width, actual.height, { threshold: 0.1 });
  const ratio = changed / (actual.width * actual.height);
  await import('node:fs').then(({ writeFileSync }) => writeFileSync(path.join(artifacts, 'visual-diff.png'), PNG.sync.write(diff)));
  assert.ok(ratio <= 0.005, `desktop/reference visual mismatch ${(ratio * 100).toFixed(3)}% exceeds 0.5%`);
  console.log(`Windows desktop runtime and visual parity passed (pixel mismatch ${(ratio * 100).toFixed(3)}%)`);
} finally { await desktop.close(); }
