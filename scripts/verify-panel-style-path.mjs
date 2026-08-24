import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const origin = 'http://127.0.0.1:4173/Knowledge-Ball/';
const eventCount = 343;
const mobileActiveNodeTarget = 49;
const replayDeadlineMs = 5_000;

function fixtureEvents() {
  const timestamp = Date.now() - eventCount;
  return Array.from({ length: eventCount }, (_, index) => ({
    id: `panel-style-event-${index}`,
    type: 'NodeCreated',
    scope: 'public',
    schemaVersion: 1,
    timestamp: timestamp + index,
    payload: {
      nodeId: `panel-style-node-${index}`,
      title: `Panel style node ${index}`,
      nodeType: index % 3 === 0 ? 'theorem' : 'fact',
      reasoning: `Panel style reasoning ${index}`,
      premises: index > 0 && index % 3 === 0 ? [`panel-style-node-${index - 1}`] : [],
      source: 'import',
    },
  }));
}

async function deadline(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1'], { stdio: 'ignore' });
let browser;
try {
  for (let i = 0; i < 100; i += 1) {
    try { if ((await fetch(origin)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(
    window.__debug?.store
      && window.__debug?.projection
      && window.__debug?.scene
      && window.__debug?.projectionRenderScheduler,
  ), null, { timeout: 20_000 });
  await page.waitForFunction(() => !window.__debug.projectionRenderScheduler.isScheduled(), null, { timeout: 20_000 });

  // Public knowledge is no longer restored from browser localStorage. Seed this
  // production-scale fixture through the same in-memory boundary used after the
  // server has accepted authoritative public events. This keeps the interaction
  // benchmark at 343 public events without reintroducing local public truth.
  // The authoritative events still apply one-by-one, but the expensive derived
  // 3D layout must be coalesced into exactly one refresh for this synchronous burst.
  const layoutFlushesBeforeReplay = await page.evaluate(() => window.__debug.projectionRenderScheduler.flushCount());
  const replayStarted = performance.now();
  const injected = await deadline(page.evaluate(events => {
    let appended = 0;
    for (const event of events) {
      if (window.__debug.store.appendValidated(event)) appended += 1;
    }
    return appended;
  }, fixtureEvents()), replayDeadlineMs, 'production-scale authoritative replay');
  assert.equal(injected, eventCount, 'production-scale fixture must inject every authoritative public event exactly once');
  await deadline(page.waitForFunction(before => (
    window.__debug.projectionRenderScheduler.flushCount() > before
      && !window.__debug.projectionRenderScheduler.isScheduled()
  ), layoutFlushesBeforeReplay), replayDeadlineMs, 'coalesced production layout');
  const replayWall = performance.now() - replayStarted;
  const layoutFlushesAfterReplay = await page.evaluate(() => window.__debug.projectionRenderScheduler.flushCount());
  assert.equal(
    layoutFlushesAfterReplay - layoutFlushesBeforeReplay,
    1,
    '343 authoritative events must produce exactly one full projection/layout refresh',
  );
  assert.ok(replayWall <= replayDeadlineMs, `343-event replay + one layout took ${replayWall.toFixed(1)}ms`);

  await page.waitForFunction(count => window.__debug?.renderNodes?.length >= count, eventCount, { timeout: 20_000 });
  await page.waitForFunction(() => (window.__debug?.scene?.getActiveNodeCount?.() ?? 0) > 0, null, { timeout: 20_000 });

  const lodState = await page.evaluate(() => ({
    renderCount: window.__debug.renderNodes.length,
    activeCount: window.__debug.scene.getActiveNodeCount(),
  }));
  assert.ok(lodState.renderCount >= eventCount, `authoritative render graph must retain all fixture nodes, got ${lodState.renderCount}`);
  assert.ok(lodState.activeCount <= mobileActiveNodeTarget, `mobile high-detail working set must stay <= ${mobileActiveNodeTarget}, got ${lodState.activeCount}`);

  const oldSelectorPresent = await page.evaluate(() => {
    for (const sheet of [...document.styleSheets]) {
      let rules;
      try { rules = [...sheet.cssRules]; } catch { continue; }
      if (rules.some(rule => rule.selectorText === '.mastery-private')) return true;
    }
    return false;
  });
  assert.equal(oldSelectorPresent, false, 'unstable .mastery-private CSS selector must not return');

  // Full graph truth and Three.js high-detail materialization are separate layers.
  // Wait for one real active fixture node before starting tap timing.
  await page.waitForFunction(() => {
    for (const node of window.__debug?.renderNodes ?? []) {
      if (!node.id.startsWith('panel-style-node-')) continue;
      const point = window.__debug?.scene?.screenPositionForNode(node.id);
      if (point && point.x > 40 && point.x < 350 && point.y > 100 && point.y < 700) return true;
    }
    return false;
  }, null, { timeout: 20_000 });

  const before = await page.evaluate(() => window.__debug.store.allEvents().length);
  const target = await page.evaluate(() => {
    for (const node of window.__debug.renderNodes) {
      if (!node.id.startsWith('panel-style-node-')) continue;
      const point = window.__debug.scene.screenPositionForNode(node.id);
      if (point && point.x > 40 && point.x < 350 && point.y > 100 && point.y < 700) return { ...point, id: node.id };
    }
    return null;
  });
  assert.ok(target, 'must expose a tappable production-scale fixture node');

  const canvasBox = await page.locator('#canvasHost').boundingBox();
  assert.ok(canvasBox, 'production-scale canvas must expose a finite bounding box');
  const center = { x: canvasBox.x + canvasBox.width / 2, y: canvasBox.y + canvasBox.height / 2 };

  // Issue #51 guards the current product interaction contract: the first tap must
  // stay fast, center the selected node and avoid opening either legacy detail UI.
  // The retired second-tap NodeDetail path is intentionally no longer part of this benchmark.
  const firstTapStarted = performance.now();
  await deadline(page.touchscreen.tap(target.x, target.y), 1_000, 'first focus tap');
  const firstTapWall = performance.now() - firstTapStarted;
  assert.ok(firstTapWall <= 250, `first focus tap took ${firstTapWall.toFixed(1)}ms`);
  assert.equal(await page.locator('#panel.open').count(), 0, 'first tap must focus without opening the legacy panel');
  assert.equal(await page.locator('#nodeDetailOverlay.open').count(), 0, 'first tap must focus without opening near-node details');
  assert.equal(
    await page.evaluate(beforeCount => window.__debug.store.allEvents().slice(beforeCount).filter(event => event.type === 'NodeMasterySet').length, before),
    0,
    'focus-only first tap must not mark the node viewed',
  );

  await deadline(page.waitForFunction(({ nodeId, centerX, centerY }) => {
    const point = window.__debug?.scene?.screenPositionForNode?.(nodeId);
    return Boolean(point && Math.hypot(point.x - centerX, point.y - centerY) < 0.25);
  }, { nodeId: target.id, centerX: center.x, centerY: center.y }), 1_000, 'node focus');

  const postFocusState = await deadline(page.evaluate(nodeId => ({
    point: window.__debug.scene.screenPositionForNode(nodeId),
    activeCount: window.__debug.scene.getActiveNodeCount(),
    legacyPanelOpen: document.querySelector('#panel')?.classList.contains('open') ?? false,
    detailOpen: document.querySelector('#nodeDetailOverlay.open') !== null,
  }), target.id), 250, 'post-focus responsiveness');

  assert.ok(postFocusState.point, 'focused node must remain renderable at screen center');
  assert.ok(postFocusState.activeCount <= mobileActiveNodeTarget, `selected-node retention must remain within the ${mobileActiveNodeTarget}-node working set`);
  assert.equal(postFocusState.legacyPanelOpen, false, 'focus must not reopen the legacy rectangular panel');
  assert.equal(postFocusState.detailOpen, false, 'focus must not open near-node detail');
  console.log(JSON.stringify({ replayWall, layoutFlushes: 1, firstTapWall, lodState, postFocusState }, null, 2));

  await context.close();
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill('SIGKILL');
  server.unref();
}