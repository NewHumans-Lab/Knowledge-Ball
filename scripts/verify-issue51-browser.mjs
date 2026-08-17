import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const origin = 'http://127.0.0.1:4173/Knowledge-Ball/';
const eventCount = 343;
const storageKey = 'knowledge-ball.events.v1';

function fixtureEvents() {
  const timestamp = Date.now() - eventCount;
  return Array.from({ length: eventCount }, (_, index) => ({
    id: `issue51-event-${index}`,
    type: 'NodeCreated',
    scope: 'public',
    schemaVersion: 1,
    timestamp: timestamp + index,
    payload: {
      nodeId: `issue51-node-${index}`,
      title: `Issue 51 node ${index}`,
      nodeType: index % 3 === 0 ? 'theorem' : 'fact',
      reasoning: `Production-scale fixture reasoning ${index}`,
      premises: index > 0 && index % 3 === 0 ? [`issue51-node-${index - 1}`] : [],
      source: 'import',
    },
  }));
}

async function withDeadline(promise, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} exceeded ${milliseconds}ms`)), milliseconds); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1'], { stdio: 'ignore' });
let browser;
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(origin)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await context.addInitScript(({ key, events }) => {
    localStorage.setItem(key, JSON.stringify({ schemaVersion: 1, savedAt: new Date().toISOString(), events }));
  }, { key: storageKey, events: fixtureEvents() });

  const page = await context.newPage();
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(count => window.__debug?.renderNodes?.length >= count, eventCount, { timeout: 20_000 });
  console.log('overflow: fixture ready');

  const { target, background } = await page.evaluate(() => {
    const points = window.__debug.renderNodes
      .map(node => ({ node, point: window.__debug.scene.screenPositionForNode(node.id) }))
      .filter(entry => entry.point);
    const targetEntry = points.find(({ point }) => point.x > 40 && point.x < 350 && point.y > 100 && point.y < 700);
    const candidates = [
      { x: 24, y: 180 }, { x: 366, y: 180 },
      { x: 24, y: 420 }, { x: 366, y: 420 },
      { x: 24, y: 660 }, { x: 366, y: 660 },
      { x: 195, y: 700 },
    ];
    const backgroundPoint = candidates
      .map(candidate => ({ candidate, nearest: Math.min(...points.map(({ point }) => Math.hypot(point.x - candidate.x, point.y - candidate.y))) }))
      .sort((a, b) => b.nearest - a.nearest)[0];
    return {
      target: targetEntry ? { ...targetEntry.point, id: targetEntry.node.id } : null,
      background: backgroundPoint?.nearest > 40 ? backgroundPoint.candidate : null,
    };
  });
  assert.ok(target, 'fixture must expose a tappable node');
  assert.ok(background, 'fixture must expose a background point');

  const backgroundStarted = performance.now();
  await withDeadline(page.touchscreen.tap(background.x, background.y), 1_000, 'background tap');
  const backgroundTap = performance.now() - backgroundStarted;
  console.log(`overflow: background tap ${backgroundTap.toFixed(1)}ms`);
  assert.ok(backgroundTap <= 250, `background tap took ${backgroundTap.toFixed(1)}ms`);
  await new Promise(resolve => setTimeout(resolve, 350));

  const panelSignal = new Promise(resolve => {
    const listener = message => {
      if (message.text() !== 'OVERFLOW_PANEL_OPEN') return;
      page.off('console', listener);
      resolve();
    };
    page.on('console', listener);
  });
  await page.evaluate(() => {
    const panel = document.querySelector('#panel');
    const observer = new MutationObserver(() => {
      if (!panel.classList.contains('open')) return;
      console.log('OVERFLOW_PANEL_OPEN');
      observer.disconnect();
    });
    observer.observe(panel, { attributes: true, attributeFilter: ['class'] });
  });

  const nodeStarted = performance.now();
  await withDeadline(page.touchscreen.tap(target.x, target.y), 1_000, 'node tap');
  const nodeTap = performance.now() - nodeStarted;
  await withDeadline(panelSignal, 1_000, 'panel open');
  console.log(`overflow: node tap ${nodeTap.toFixed(1)}ms`);
  assert.ok(nodeTap <= 250, `node tap took ${nodeTap.toFixed(1)}ms`);

  const preOverflowStarted = performance.now();
  await withDeadline(page.evaluate(() => performance.now()), 250, 'pre-overflow responsiveness');
  const preOverflowResponse = performance.now() - preOverflowStarted;
  console.log(`overflow: pre-overflow response ${preOverflowResponse.toFixed(1)}ms`);

  const injectStarted = performance.now();
  const layout = await withDeadline(page.evaluate(() => {
    const body = document.querySelector('#panelBody');
    body.innerHTML = Array.from({ length: 100 }, (_, index) => `<div>Plain diagnostic row ${index + 1}</div>`).join('');
    return { scrollHeight: body.scrollHeight, clientHeight: body.clientHeight };
  }), 1_000, 'plain tall DOM injection');
  const injectWall = performance.now() - injectStarted;
  console.log(`overflow: plain tall DOM ${injectWall.toFixed(1)}ms; scroll ${layout.scrollHeight}/${layout.clientHeight}`);
  assert.ok(layout.scrollHeight > layout.clientHeight, 'plain diagnostic content must actually overflow panel body');
  assert.ok(injectWall <= 250, `plain tall DOM injection took ${injectWall.toFixed(1)}ms`);

  const postOverflowStarted = performance.now();
  await withDeadline(page.evaluate(() => performance.now()), 250, 'post-overflow responsiveness');
  const postOverflowResponse = performance.now() - postOverflowStarted;
  console.log(`overflow: post-overflow response ${postOverflowResponse.toFixed(1)}ms`);
  assert.ok(postOverflowResponse <= 250, `post-overflow response took ${postOverflowResponse.toFixed(1)}ms`);

  console.log(JSON.stringify({ backgroundTap, nodeTap, preOverflowResponse, injectWall, postOverflowResponse, ...layout }, null, 2));
  await context.close();
  console.log('Plain panel overflow diagnostic passed');
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill('SIGKILL');
  server.unref();
}
