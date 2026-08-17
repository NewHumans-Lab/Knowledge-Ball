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

// Use Vite's dev transform only for this diagnostic so browser Error.stack
// contains source module URLs instead of minified production function names.
const server = spawn(process.execPath, [
  'node_modules/vite/bin/vite.js',
  '--host', '127.0.0.1',
  '--port', '4173',
  '--strictPort',
], { stdio: 'ignore' });
let browser;
try {
  for (let i = 0; i < 100; i += 1) {
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
    if (message.text().startsWith('SOURCE_APPEND ')) console.log(message.text());
  });
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(count => window.__debug?.renderNodes?.length >= count, eventCount, { timeout: 20_000 });

  await page.evaluate(() => {
    for (const sheet of [...document.styleSheets]) {
      let rules;
      try { rules = [...sheet.cssRules]; } catch { continue; }
      for (let i = rules.length - 1; i >= 0; i -= 1) {
        if (rules[i].selectorText === '.mastery-private') sheet.deleteRule(i);
      }
    }

    const store = window.__debug.store;
    const traces = [];
    let appendCount = 0;
    store.append = event => {
      appendCount += 1;
      if (traces.length < 3) {
        const trace = {
          index: appendCount,
          type: event.type,
          scope: event.scope,
          payload: structuredClone(event.payload),
          stack: new Error(`source-append-${appendCount}`).stack?.replaceAll('\n', ' | ') ?? 'no-stack',
        };
        traces.push(trace);
        console.log(`SOURCE_APPEND ${JSON.stringify(trace)}`);
      }
      return true;
    };
    window.__issue51Diagnostic = () => ({ appendCount, traces: structuredClone(traces) });
  });

  const target = await page.evaluate(() => {
    for (const node of window.__debug.renderNodes) {
      const point = window.__debug.scene.screenPositionForNode(node.id);
      if (point && point.x > 40 && point.x < 350 && point.y > 100 && point.y < 700) return { ...point, id: node.id };
    }
    return null;
  });
  assert.ok(target, 'must expose a tappable node');

  await deadline(page.touchscreen.tap(target.x, target.y), 1_000, 'real node tap');
  await new Promise(resolve => setTimeout(resolve, 80));
  const result = await deadline(page.evaluate(() => window.__issue51Diagnostic()), 250, 'source-stack diagnostic');
  console.log(JSON.stringify(result, null, 2));
  assert.ok(result.appendCount >= 1, 'tap path must expose at least one append caller');
  assert.ok(result.traces[0]?.stack.includes('/src/'), `expected Vite source stack, got: ${result.traces[0]?.stack ?? 'none'}`);

  await context.close();
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill('SIGKILL');
  server.unref();
}
