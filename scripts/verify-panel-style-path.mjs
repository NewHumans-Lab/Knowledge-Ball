import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const origin = 'http://127.0.0.1:4173/Knowledge-Ball/';
const eventCount = 343;

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
  await page.waitForFunction(() => Boolean(window.__debug?.store && window.__debug?.projection && window.__debug?.scene), null, { timeout: 20_000 });

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

  const oldSelectorPresent = await page.evaluate(() => {
    for (const sheet of [...document.styleSheets]) {
      let rules;
      try { rules = [...sheet.cssRules]; } catch { continue; }
      if (rules.some(rule => rule.selectorText === '.mastery-private')) return true;
    }
    return false;
  });
  assert.equal(oldSelectorPresent, false, 'unstable .mastery-private CSS selector must not return');

  const before = await page.evaluate(() => window.__debug.store.allEvents().length);
  const target = await page.evaluate(() => {
    for (const node of window.__debug.renderNodes) {
      const point = window.__debug.scene.screenPositionForNode(node.id);
      if (point && point.x > 40 && point.x < 350 && point.y > 100 && point.y < 700) return { ...point, id: node.id };
    }
    return null;
  });
  assert.ok(target, 'must expose a tappable node');

  const tapStarted = performance.now();
  await deadline(page.touchscreen.tap(target.x, target.y), 1_000, 'real node tap');
  const tapWall = performance.now() - tapStarted;
  await deadline(page.waitForFunction(() => document.querySelector('#panel')?.classList.contains('open')), 1_000, 'panel open');
  await new Promise(resolve => setTimeout(resolve, 100));

  const state = await deadline(page.evaluate(({ beforeCount, nodeId }) => {
    const events = window.__debug.store.allEvents();
    const appended = events.slice(beforeCount);
    const privacy = document.querySelector('.mastery-private');
    const privacyStyle = privacy ? getComputedStyle(privacy) : null;
    return {
      masteryEvents: appended.filter(event => event.type === 'NodeMasterySet'),
      mastery: window.__debug.projection.state.nodesById[nodeId]?.mastery,
      panelOpen: document.querySelector('#panel')?.classList.contains('open') ?? false,
      privacyText: privacy?.textContent ?? '',
      privacyFontSize: privacyStyle?.fontSize ?? '',
      privacyMarginTop: privacyStyle?.marginTop ?? '',
    };
  }, { beforeCount: before, nodeId: target.id }), 250, 'post-tap responsiveness');

  console.log(JSON.stringify({ tapWall, state }, null, 2));
  assert.ok(tapWall <= 250, `real node tap took ${tapWall.toFixed(1)}ms`);
  assert.ok(state.panelOpen, 'panel must remain open and responsive');
  assert.equal(state.mastery, 'touched', 'viewed node must be automatically marked touched');
  assert.equal(state.masteryEvents.length, 1, `one view must append exactly one mastery event, got ${state.masteryEvents.length}`);
  assert.equal(state.masteryEvents[0]?.payload?.nodeId, target.id, 'mastery event must target the viewed node');
  assert.equal(state.masteryEvents[0]?.payload?.mastery, 'touched', 'viewed node must append touched mastery');
  assert.ok(state.privacyText.includes('LOCAL ONLY'), 'AuthUi must still update the private mastery note');
  assert.equal(state.privacyFontSize, '9px', 'replacement selector must preserve private-note typography');
  assert.equal(state.privacyMarginTop, '5px', 'replacement selector must preserve private-note spacing');

  await context.close();
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill('SIGKILL');
  server.unref();
}
