import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const origin = 'http://127.0.0.1:4173/Knowledge-Ball/';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1'], { stdio: 'ignore' });
let browser;

try {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(origin)).ok) break;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader'] });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await page.waitForFunction(() => Boolean(
    window.__debug?.scene?.getRenderedFrameCount
      && window.__debug?.renderNodes?.length,
  ), null, { timeout: 20_000 });

  await page.evaluate(() => window.__debug.scene.start());
  await page.waitForFunction(() => window.__debug.scene.getRenderedFrameCount() >= 3);
  const before = await page.evaluate(() => ({
    frames: window.__debug.scene.getRenderedFrameCount(),
    nodeCount: window.__debug.scene.getActiveNodeCount(),
    nodeId: window.__debug.renderNodes.find(node => window.__debug.scene.screenPositionForNode(node.id))?.id,
  }));
  assert.ok(before.nodeCount > 0, 'scene must have active nodes before context loss');
  assert.ok(before.nodeId, 'scene must expose a positioned node before context loss');
  const beforePosition = await page.evaluate(id => window.__debug.scene.screenPositionForNode(id), before.nodeId);
  const oldCanvas = await page.locator('#canvasHost canvas').elementHandle();
  assert.ok(oldCanvas, 'scene must own a WebGL canvas before background suspension');

  // First test the Android app-switch path when Chrome does not report context loss:
  // blur/focus must still replace the suspended renderer rather than trust its old GPU state.
  await page.evaluate(() => {
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('focus'));
  });
  await page.waitForFunction(old => document.querySelector('#canvasHost canvas') !== old, oldCanvas, { timeout: 5_000 });
  await page.waitForFunction(
    previousFrames => window.__debug.scene.getRenderedFrameCount() > previousFrames,
    before.frames,
    { timeout: 10_000 },
  );
  const foregroundCanvas = await page.locator('#canvasHost canvas').elementHandle();
  assert.ok(foregroundCanvas, 'foreground recovery must mount a replacement canvas');

  const loss = await page.evaluate(async () => {
    const canvas = document.querySelector('#canvasHost canvas');
    const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
    const extension = gl?.getExtension('WEBGL_lose_context');
    if (!canvas || !gl || !extension) return { supported: false };
    const lost = new Promise(resolve => {
      canvas.addEventListener('webglcontextlost', () => resolve(true), { once: true });
    });
    extension.loseContext();
    const eventReceived = await Promise.race([
      lost,
      new Promise(resolve => setTimeout(() => resolve(false), 2_000)),
    ]);
    if (!eventReceived) return { supported: true, eventReceived: false };
    const contextIsLost = gl.isContextLost();
    // Android Chrome normally returns to a visible/focused page after app switching.
    // Trigger the same foreground path deterministically after forcing context loss.
    window.dispatchEvent(new Event('focus'));
    return { supported: true, eventReceived: true, contextIsLost };
  });

  assert.equal(loss.supported, true, 'Chromium must expose WEBGL_lose_context for deterministic recovery testing');
  assert.equal(loss.eventReceived, true, 'forced context loss must dispatch webglcontextlost');
  assert.equal(loss.contextIsLost, true, 'the original WebGL context must actually be lost');

  await page.waitForFunction(old => document.querySelector('#canvasHost canvas') !== old, foregroundCanvas, { timeout: 5_000 });
  await page.waitForFunction(
    previousFrames => window.__debug.scene.getRenderedFrameCount() > previousFrames,
    before.frames,
    { timeout: 10_000 },
  );

  const after = await page.evaluate(id => ({
    frames: window.__debug.scene.getRenderedFrameCount(),
    nodeCount: window.__debug.scene.getActiveNodeCount(),
    position: window.__debug.scene.screenPositionForNode(id),
    canvasCount: document.querySelectorAll('#canvasHost canvas').length,
  }), before.nodeId);
  assert.equal(after.canvasCount, 1, 'renderer replacement must leave exactly one canvas mounted');
  assert.equal(after.nodeCount, before.nodeCount, 'renderer replacement must preserve the existing graph mesh records');
  assert.ok(after.frames > before.frames, 'new renderer must successfully render frames after context loss');
  assert.ok(after.position, 'the same graph node must remain positioned after renderer replacement');
  assert.ok(
    Math.hypot(after.position.x - beforePosition.x, after.position.y - beforePosition.y) < 1,
    'renderer replacement must preserve the user-visible graph orientation and node position',
  );

  const recoveredCanvasShot = await page.locator('#canvasHost canvas').screenshot();
  const visibleScenePixels = await page.evaluate(async base64 => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const sample = document.createElement('canvas');
    sample.width = image.naturalWidth;
    sample.height = image.naturalHeight;
    const context = sample.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('2D screenshot verification context unavailable');
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
    let chromatic = 0;
    for (let index = 0; index < pixels.length; index += 16) {
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      const maximum = Math.max(red, green, blue);
      const minimum = Math.min(red, green, blue);
      if (maximum > 45 && maximum - minimum > 18) chromatic += 1;
    }
    return chromatic;
  }, recoveredCanvasShot.toString('base64'));
  assert.ok(visibleScenePixels > 50, `recovered WebGL canvas must contain visible graph colour, not a black frame (pixels=${visibleScenePixels})`);
  assert.deepEqual(pageErrors, [], 'renderer recovery must not introduce uncaught page errors');

  console.log('Android-Chrome-style WebGL context-loss recovery passed', {
    beforeFrames: before.frames,
    afterFrames: after.frames,
    activeNodes: after.nodeCount,
    canvasCount: after.canvasCount,
    positionDelta: Math.hypot(after.position.x - beforePosition.x, after.position.y - beforePosition.y),
  });
  await context.close();
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
