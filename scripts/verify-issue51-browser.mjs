import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const origin = 'http://127.0.0.1:4173/Knowledge-Ball/';
const eventCount = 343;
const artifactDir = process.env.ISSUE51_ARTIFACT_DIR ?? 'artifacts';
const tracePath = `${artifactDir}/issue51-trace.zip`;
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

async function submitFact(page, title) {
  await page.evaluate(() => { window.__issue51Metrics.longTasks = []; });
  await page.locator('.ai-add').click();
  await page.locator('#fTitle').fill(title);
  await page.locator('#fType').selectOption('fact');
  await page.locator('#fDescription').fill(`Issue 51 submission ${title}`);
  const startedAt = performance.now();
  const result = await withDeadline(page.evaluate(async submittedTitle => {
    const start = performance.now();
    await window.__debug.createKnowledgeNode({ title: submittedTitle, type: 'fact', description: `Issue 51 submission ${submittedTitle}`, premises: [] });
    document.querySelector('#modalOverlay').classList.remove('show');
    return { duration: performance.now() - start, append: performance.getEntriesByName('knowledge-edit-append').at(-1)?.duration ?? Infinity, subscriber: performance.getEntriesByName('knowledge-subscriber').at(-1)?.duration ?? Infinity, maxLongTask: Math.max(0, ...window.__issue51Metrics.longTasks), count: Object.values(window.__debug.projection.state.nodesById).filter(node => node.title === submittedTitle).length };
  }, title), 2_000, 'submit transaction');
  assert.ok(result.duration <= 2_000, `browser submit took ${result.duration.toFixed(1)}ms`);
  assert.ok(result.append <= 500, `append took ${result.append.toFixed(1)}ms`);
  assert.ok(result.subscriber <= 500, `subscriber took ${result.subscriber.toFixed(1)}ms`);
  assert.equal(result.count, 1, 'submit must append exactly one requested node');
  return { wall: performance.now() - startedAt, ...result };
}

await mkdir(artifactDir, { recursive: true });
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1'], { stdio: 'ignore' });
let browser;
let context;
let traceSaved = false;
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(origin)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader'] });
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  // Screenshots force WebGL ReadPixels and distort the interaction being
  // measured; DOM snapshots and sources retain actionable call boundaries.
  await context.tracing.start({ screenshots: false, snapshots: false, sources: true });
  let page = await context.newPage();
  await context.addInitScript(({ key, events }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ schemaVersion: 1, savedAt: new Date().toISOString(), events }));
    window.__issue51Metrics = { longTasks: [] };
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) window.__issue51Metrics.longTasks.push(entry.duration);
    }).observe({ type: 'longtask', buffered: true });
  }, { key: storageKey, events: fixtureEvents() });

  await page.goto(origin, { waitUntil: 'domcontentloaded' }); console.log('issue51: loaded');
  await page.waitForFunction(count => window.__debug?.renderNodes?.length >= count, eventCount, { timeout: 20_000 });

  console.log('issue51: fixture ready');
  const baselineTaskDelay = await withDeadline(page.evaluate(() => new Promise(resolve => {
    const scheduledAt = performance.now();
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      const delay = performance.now() - scheduledAt;
      channel.port1.close();
      channel.port2.close();
      resolve(delay);
    };
    channel.port2.postMessage(null);
  })), 1_000, 'baseline task-channel liveness');
  console.log(`issue51: baseline task-channel delay ${baselineTaskDelay.toFixed(1)}ms`);
  assert.ok(baselineTaskDelay <= 250, `baseline task-channel delay was ${baselineTaskDelay.toFixed(1)}ms`);

  const target = await page.evaluate(() => {
    for (const node of window.__debug.renderNodes) {
      const point = window.__debug.scene.screenPositionForNode(node.id);
      if (point && point.x > 40 && point.x < 350 && point.y > 100 && point.y < 700) return { ...point, id: node.id, title: node.title };
    }
    return null;
  });
  assert.ok(target, 'production fixture must expose a tappable non-core node');
  await page.evaluate(() => { window.__issue51Metrics.longTasks = []; });
  console.log('issue51: tapping with real Playwright touchscreen input');
  const panelSignal = new Promise(resolve => {
    const listener = message => {
      if (!message.text().startsWith('ISSUE51_PANEL ')) return;
      page.off('console', listener);
      resolve(JSON.parse(message.text().slice('ISSUE51_PANEL '.length)));
    };
    page.on('console', listener);
  });
  await page.evaluate(() => {
    const panel = document.querySelector('#panel');
    const observer = new MutationObserver(() => {
      if (!panel.classList.contains('open')) return;
      const rect = panel.getBoundingClientRect();
      console.log(`ISSUE51_PANEL ${JSON.stringify({ open: true, opacity: getComputedStyle(panel).opacity, width: rect.width, height: rect.height, tapDuration: performance.getEntriesByName('knowledge-node-tap').at(-1)?.duration ?? Infinity, panelDuration: performance.getEntriesByName('knowledge-panel-open').at(-1)?.duration ?? Infinity, tapToPanelDuration: performance.getEntriesByName('knowledge-tap-to-panel').at(-1)?.duration ?? Infinity })}`);
      observer.disconnect();
    });
    observer.observe(panel, { attributes: true, attributeFilter: ['class'] });
  });

  const realTapStartedAt = performance.now();
  await withDeadline(page.touchscreen.tap(target.x, target.y), 1_000, 'real node touchscreen tap');
  const realTapWall = performance.now() - realTapStartedAt;
  const tapResult = await withDeadline(panelSignal, 1_000, 'node panel visibility');
  assert.ok(tapResult.open && tapResult.opacity === '1' && tapResult.width > 0 && tapResult.height > 0, 'node panel must be visibly laid out');
  console.log(`issue51: panel visible; real tap wall ${realTapWall.toFixed(1)}ms`);
  const tapDuration = tapResult.tapDuration;
  assert.ok(tapDuration <= 1_000, `node tap handler took ${tapDuration.toFixed(1)}ms`);
  const panelDuration = tapResult.panelDuration;
  assert.ok(panelDuration <= 1_000, `node panel took ${panelDuration.toFixed(1)}ms`);
  const tapToPanelDuration = tapResult.tapToPanelDuration;
  assert.ok(tapToPanelDuration <= 1_000, `node tap-to-panel took ${tapToPanelDuration.toFixed(1)}ms`);

  const responseStartedAt = performance.now();
  await withDeadline(page.evaluate(() => performance.now()), 250, 'post-tap page responsiveness');
  const postTapCommandDelay = performance.now() - responseStartedAt;
  console.log(`issue51: post-tap page command delay ${postTapCommandDelay.toFixed(1)}ms`);
  assert.ok(postTapCommandDelay <= 250, `page command after real tap took ${postTapCommandDelay.toFixed(1)}ms`);

  void page.close({ runBeforeUnload: false }).catch(() => {});
  page = await context.newPage();
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(count => window.__debug?.renderNodes?.length >= count, eventCount, { timeout: 20_000 });

  await page.evaluate(() => window.__debug.scene.stop());
  const firstTitle = `Issue 51 stopped ${crypto.randomUUID()}`;
  const stoppedSubmitDuration = await submitFact(page, firstTitle);
  void page.close({ runBeforeUnload: true }).catch(() => {});
  page = await context.newPage();
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(title => Object.values(window.__debug?.projection?.state?.nodesById ?? {}).filter(node => node.title === title).length === 1, firstTitle, { timeout: 10_000 });
  const liveTitle = `Issue 51 live ${crypto.randomUUID()}`;
  const selectedSubmitDuration = await submitFact(page, liveTitle);

  const maxLongTask = selectedSubmitDuration.maxLongTask;
  console.log(JSON.stringify({ eventCount, baselineTaskDelay, realTapWall, tapDuration, panelDuration, tapToPanelDuration, postTapCommandDelay, stoppedSubmitDuration, selectedSubmitDuration, maxLongTask }, null, 2));
  assert.ok(maxLongTask <= 500, `longest main-thread task was ${maxLongTask.toFixed(1)}ms`);
  await context.tracing.stop({ path: tracePath });
  traceSaved = true;
  await context.close();
  console.log(`Issue #51 browser performance regression passed; trace: ${tracePath}`);
} catch (error) {
  console.error(error);
  throw error;
} finally {
  if (context && !traceSaved) await context.tracing.stop({ path: tracePath }).catch(() => {});
  if (browser) await browser.close().catch(() => {});
  server.kill('SIGKILL');
  server.unref();
}
