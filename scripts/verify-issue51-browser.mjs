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
  await page.locator('.ai-add').click();
  await page.locator('#fTitle').fill(title);
  await page.locator('#fType').selectOption('fact');
  await page.locator('#fDescription').fill(`Issue 51 submission ${title}`);
  const startedAt = performance.now();
  await withDeadline(page.locator('#modalSubmit').click(), 2_000, 'submit click');
  await page.locator('#modalOverlay:not(.show)').waitFor({ state: 'attached', timeout: 2_000 });
  return performance.now() - startedAt;
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
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const page = await context.newPage();
  await page.addInitScript(({ key, events }) => {
    localStorage.setItem(key, JSON.stringify({ schemaVersion: 1, savedAt: new Date().toISOString(), events }));
    window.__issue51Metrics = { heartbeat: 0, longTasks: [] };
    setInterval(() => { window.__issue51Metrics.heartbeat++; }, 50);
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) window.__issue51Metrics.longTasks.push(entry.duration);
    }).observe({ type: 'longtask', buffered: true });
  }, { key: storageKey, events: fixtureEvents() });

  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(count => window.__debug?.renderNodes?.length >= count, eventCount, { timeout: 20_000 });

  const target = await page.evaluate(() => {
    for (const node of window.__debug.renderNodes) {
      const point = window.__debug.scene.screenPositionForNode(node.id);
      if (point && point.x > 40 && point.x < 350 && point.y > 100 && point.y < 700) return { ...point, id: node.id, title: node.title };
    }
    return null;
  });
  assert.ok(target, 'production fixture must expose a tappable non-core node');
  const heartbeatBeforeTap = await page.evaluate(() => window.__issue51Metrics.heartbeat);
  const tapStartedAt = performance.now();
  await withDeadline(page.touchscreen.tap(target.x, target.y), 1_000, 'node tap');
  await page.locator('#panel.open').waitFor({ state: 'visible', timeout: 1_000 });
  assert.equal(await page.locator('#panelTitle').textContent(), target.title);
  const tapDuration = performance.now() - tapStartedAt;
  await page.waitForTimeout(150);
  assert.ok(await page.evaluate(value => window.__issue51Metrics.heartbeat > value, heartbeatBeforeTap), 'heartbeat must continue after node tap');
  await page.locator('#panelClose').click();
  await page.touchscreen.tap(12, 400);
  await page.waitForTimeout(350);

  await page.evaluate(() => window.__debug.scene.stop());
  const firstTitle = `Issue 51 stopped ${crypto.randomUUID()}`;
  const stoppedSubmitDuration = await submitFact(page, firstTitle);
  assert.equal(await page.evaluate(title => Object.values(window.__debug.projection.state.nodesById).filter(node => node.title === title).length, firstTitle), 1);

  const selectedTitle = `Issue 51 selected ${crypto.randomUUID()}`;
  const selectedSubmitDuration = await submitFact(page, selectedTitle);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(title => Object.values(window.__debug?.projection?.state?.nodesById ?? {}).filter(node => node.title === title).length === 1, selectedTitle);

  const metrics = await page.evaluate(() => window.__issue51Metrics);
  const maxLongTask = Math.max(0, ...metrics.longTasks);
  console.log(JSON.stringify({ eventCount, tapDuration, stoppedSubmitDuration, selectedSubmitDuration, maxLongTask }, null, 2));
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
