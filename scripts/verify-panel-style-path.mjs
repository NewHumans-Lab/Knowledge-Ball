import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const origin = 'http://127.0.0.1:4173/Knowledge-Ball/';
const eventCount = 343;
const storageKey = 'knowledge-ball.events.v1';

function fixtureEvents() {
  const timestamp = Date.now() - eventCount;
  return Array.from({ length: eventCount }, (_, index) => ({
    id: `panel-style-event-${index}`,
    type: 'NodeCreated', scope: 'public', schemaVersion: 1, timestamp: timestamp + index,
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
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms); })]);
  } finally { clearTimeout(timer); }
}

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1'], { stdio: 'ignore' });
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(origin)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await context.addInitScript(({ key, events }) => {
    localStorage.setItem(key, JSON.stringify({ schemaVersion: 1, savedAt: new Date().toISOString(), events }));
  }, { key: storageKey, events: fixtureEvents() });
  const page = await context.newPage();
  page.on('console', message => {
    if (message.text().startsWith('OPEN_CALL ')) console.log(message.text());
  });
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(count => window.__debug?.renderNodes?.length >= count, eventCount, { timeout: 20_000 });

  const removed = await page.evaluate(() => {
    let count = 0;
    for (const sheet of [...document.styleSheets]) {
      let rules;
      try { rules = [...sheet.cssRules]; } catch { continue; }
      for (let i = rules.length - 1; i >= 0; i--) {
        if (rules[i].selectorText === '.mastery-private') { sheet.deleteRule(i); count++; }
      }
    }
    const style = document.createElement('style');
    style.dataset.issue51MasteryIsolation = 'true';
    style.textContent = '[data-mastery]{pointer-events:none!important}';
    document.head.appendChild(style);
    return count;
  });
  assert.ok(removed >= 1, 'legacy .mastery-private rule must be removed for diagnostic');

  await page.evaluate(() => {
    const panel = window.__debug.panel;
    const originalOpen = panel.openNodePanel.bind(panel);
    let calls = 0;
    panel.openNodePanel = id => {
      calls += 1;
      console.log(`OPEN_CALL ${calls} id=${id} at=${performance.now().toFixed(1)}`);
      return originalOpen(id);
    };
    window.__issue51OpenCalls = () => calls;
  });

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
  await new Promise(resolve => setTimeout(resolve, 120));
  const result = await deadline(page.evaluate(() => ({
    calls: window.__issue51OpenCalls(),
    panelOpen: document.querySelector('#panel')?.classList.contains('open') ?? false,
    masteryControls: document.querySelectorAll('[data-mastery]').length,
  })), 250, 'post-tap responsiveness');
  console.log(JSON.stringify({ tapWall, result }, null, 2));
  assert.ok(tapWall <= 250, `real node tap took ${tapWall.toFixed(1)}ms`);
  assert.ok(result.panelOpen, 'full panel must open');
  assert.equal(result.masteryControls, 3, 'full mastery controls must still render');
  assert.equal(result.calls, 1, `disabled mastery hit targets should prevent duplicate panel open; got ${result.calls}`);
  await context.close();
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill('SIGKILL'); server.unref();
}
