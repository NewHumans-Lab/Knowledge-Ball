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
    if (message.text().startsWith('PANEL_PHASE ')) console.log(message.text());
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
    return count;
  });
  assert.ok(removed >= 1, 'legacy .mastery-private rule must be removed for diagnostic');

  await page.evaluate(() => {
    const innerHTMLDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    if (!innerHTMLDescriptor?.get || !innerHTMLDescriptor?.set) throw new Error('innerHTML descriptor unavailable');
    Object.defineProperty(Element.prototype, 'innerHTML', {
      configurable: innerHTMLDescriptor.configurable,
      enumerable: innerHTMLDescriptor.enumerable,
      get: innerHTMLDescriptor.get,
      set(value) {
        const tracked = this.id === 'panelBody' || this.id === 'panelActions';
        if (tracked) console.log(`PANEL_PHASE before-${this.id} ${performance.now().toFixed(1)}`);
        innerHTMLDescriptor.set.call(this, value);
        if (tracked) console.log(`PANEL_PHASE after-${this.id} ${performance.now().toFixed(1)}`);
      },
    });

    const querySelectorAll = Element.prototype.querySelectorAll;
    Element.prototype.querySelectorAll = function(selector) {
      const tracked = (this.id === 'panelBody' || this.id === 'panelActions') &&
        (selector === '[data-jump]' || selector === '[data-mastery]');
      if (tracked) console.log(`PANEL_PHASE before-queryAll-${this.id}-${selector} ${performance.now().toFixed(1)}`);
      const result = querySelectorAll.call(this, selector);
      if (tracked) console.log(`PANEL_PHASE after-queryAll-${this.id}-${selector} ${performance.now().toFixed(1)} count=${result.length}`);
      return result;
    };

    const querySelector = Element.prototype.querySelector;
    Element.prototype.querySelector = function(selector) {
      const tracked = this.id === 'panelActions' && typeof selector === 'string' && selector.startsWith('#btn');
      if (tracked) console.log(`PANEL_PHASE query-${selector} ${performance.now().toFixed(1)}`);
      return querySelector.call(this, selector);
    };
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
  console.log(`PANEL_PHASE node-tap-returned wall=${tapWall.toFixed(1)}ms`);
  await deadline(page.waitForFunction(() => document.querySelector('#panel')?.classList.contains('open')), 1_000, 'full panel open');

  const bodyState = await deadline(page.evaluate(() => ({
    textLength: document.querySelector('#panelBody')?.textContent?.length ?? 0,
    hasLegacyNote: Boolean(document.querySelector('#panelBody .mastery-private')),
    childCount: document.querySelector('#panelBody')?.children.length ?? 0,
  })), 250, 'full panel responsiveness');
  assert.ok(bodyState.hasLegacyNote, 'full panel must contain original mastery-private markup');
  assert.ok(bodyState.textLength > 40 && bodyState.childCount > 2, 'full panel content must be restored, not diagnostic minimal content');
  assert.ok(tapWall <= 250, `real node tap took ${tapWall.toFixed(1)}ms`);
  console.log(JSON.stringify({ removed, tapWall, bodyState }, null, 2));
  await context.close();
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill('SIGKILL'); server.unref();
}
