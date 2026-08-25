import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const origin = 'http://127.0.0.1:4173/Knowledge-Ball/';
const eventCount = 343;
const mobileActiveNodeTarget = 49;

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
  await page.waitForFunction(() => Boolean(window.__debug?.store && window.__debug?.projection && window.__debug?.scene && window.__debug?.projectionRenderScheduler), null, { timeout: 20_000 });

  const graphFlushesBeforeFixture = await page.evaluate(() => {
    window.__debug.projectionRenderScheduler.flushNow();
    return window.__debug.projectionRenderScheduler.flushCount();
  });

  // Public knowledge is no longer restored from browser localStorage. Seed this
  // production-scale fixture through the same in-memory boundary used after the
  // server has accepted authoritative public events. This keeps the interaction
  // benchmark at 343 public events without reintroducing local public truth.
  const injected = await page.evaluate(events => {
    let appended = 0;
    for (const event of events) {
      if (window.__debug.store.appendValidated(event)) appended += 1;
    }
    return appended;
  }, fixtureEvents());
  assert.equal(injected, eventCount, 'production-scale fixture must inject every authoritative public event exactly once');
  await page.waitForFunction(count => window.__debug?.renderNodes?.length >= count, eventCount, { timeout: 20_000 });
  await page.waitForFunction(() => (window.__debug?.scene?.getActiveNodeCount?.() ?? 0) > 0, null, { timeout: 20_000 });
  const graphFlushesAfterFixture = await page.evaluate(() => window.__debug.projectionRenderScheduler.flushCount());
  assert.equal(graphFlushesAfterFixture - graphFlushesBeforeFixture, 1, '343 synchronous authoritative events must produce exactly one full graph render/layout flush');

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

  const pointBeforeTap = await page.evaluate(nodeId => window.__debug.scene.screenPositionForNode(nodeId), target.id);
  assert.ok(pointBeforeTap, 'direct-detail target must remain renderable before tap');
  const graphFlushesBeforeDetailTap = await page.evaluate(() => window.__debug.projectionRenderScheduler.flushCount());
  const detailTapStarted = performance.now();
  await deadline(page.touchscreen.tap(target.x, target.y), 1_000, 'direct detail tap');
  const detailTapWall = performance.now() - detailTapStarted;
  await deadline(page.waitForFunction(() => document.querySelector('#nodeDetailOverlay')?.classList.contains('open')), 1_000, 'near-node detail open');
  await deadline(page.waitForFunction(nodeId => window.__debug?.projection?.state?.nodesById?.[nodeId]?.mastery === 'touched', target.id), 1_000, 'viewed-node mastery');
  await new Promise(resolve => setTimeout(resolve, 100));

  const state = await deadline(page.evaluate(({ beforeCount, nodeId }) => {
    const events = window.__debug.store.allEvents();
    const appended = events.slice(beforeCount);
    const detail = document.querySelector('#nodeDetailOverlay');
    return {
      masteryEvents: appended.filter(event => event.type === 'NodeMasterySet'),
      mastery: window.__debug.projection.state.nodesById[nodeId]?.mastery,
      detailOpen: detail?.classList.contains('open') ?? false,
      legacyPanelOpen: document.querySelector('#panel')?.classList.contains('open') ?? false,
      detailTitle: detail?.querySelector('.node-detail-title')?.textContent?.trim() ?? '',
      activeCount: window.__debug.scene.getActiveNodeCount(),
      graphFlushes: window.__debug.projectionRenderScheduler.flushCount(),
      pointAfterTap: window.__debug.scene.screenPositionForNode(nodeId),
    };
  }, { beforeCount: before, nodeId: target.id }), 250, 'post-tap responsiveness');

  console.log(JSON.stringify({ detailTapWall, lodState, state }, null, 2));
  assert.ok(detailTapWall <= 250, `direct detail tap took ${detailTapWall.toFixed(1)}ms`);
  assert.ok(state.pointAfterTap, 'direct-detail target must remain renderable after detail opens');
  assert.ok(Math.hypot(state.pointAfterTap.x - pointBeforeTap.x, state.pointAfterTap.y - pointBeforeTap.y) <= 2, 'opening detail must preserve the current graph orientation');
  assert.ok(state.activeCount <= mobileActiveNodeTarget, `selected-node relation retention must remain within the ${mobileActiveNodeTarget}-node working set`);
  assert.ok(state.detailOpen, 'near-node detail must open on the first real node tap');
  assert.equal(state.legacyPanelOpen, false, 'normal viewing must not reopen the legacy rectangular panel');
  assert.equal(state.detailTitle, target.id.replace('panel-style-node-', 'Panel style node '), 'near-node detail must show the selected fixture title');
  assert.equal(state.mastery, 'touched', 'actually rendered detail must mark the viewed node touched');
  assert.equal(state.masteryEvents.length, 1, `one rendered detail view must append exactly one mastery event, got ${state.masteryEvents.length}`);
  assert.equal(state.masteryEvents[0]?.payload?.nodeId, target.id, 'mastery event must target the viewed node');
  assert.equal(state.masteryEvents[0]?.payload?.mastery, 'touched', 'viewed node must append touched mastery');
  assert.equal(state.graphFlushes, graphFlushesBeforeDetailTap, 'viewed-node mastery must not trigger a full graph render/layout flush');

  await context.close();
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill('SIGKILL');
  server.unref();
}
