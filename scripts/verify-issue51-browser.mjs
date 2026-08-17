import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const origin = 'http://127.0.0.1:4173/Knowledge-Ball/';
const eventCount = 343;
const storageKey = 'knowledge-ball.events.v1';
const exactText = 'PRIVATE STATE · 仅你可见';
const renamedClass = 'personal-mastery-note';
const artifactPath = 'artifacts/issue51-trace.zip';

function fixtureEvents() {
  const timestamp = Date.now() - eventCount;
  return Array.from({ length: eventCount }, (_, index) => ({
    id: `issue51-event-${index}`,
    type: 'NodeCreated', scope: 'public', schemaVersion: 1, timestamp: timestamp + index,
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
  } finally { clearTimeout(timer); }
}

async function runSelectorCase() {
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader'] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await context.addInitScript(({ key, events }) => {
      localStorage.setItem(key, JSON.stringify({ schemaVersion: 1, savedAt: new Date().toISOString(), events }));
    }, { key: storageKey, events: fixtureEvents() });

    const page = await context.newPage();
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(count => window.__debug?.renderNodes?.length >= count, eventCount, { timeout: 20_000 });

    const { target, background } = await page.evaluate(() => {
      const points = window.__debug.renderNodes
        .map(node => ({ node, point: window.__debug.scene.screenPositionForNode(node.id) }))
        .filter(entry => entry.point);
      const targetEntry = points.find(({ point }) => point.x > 40 && point.x < 350 && point.y > 100 && point.y < 700);
      const candidates = [{x:24,y:180},{x:366,y:180},{x:24,y:420},{x:366,y:420},{x:24,y:660},{x:366,y:660},{x:195,y:700}];
      const bg = candidates.map(candidate => ({ candidate, nearest: Math.min(...points.map(({ point }) => Math.hypot(point.x-candidate.x, point.y-candidate.y))) })).sort((a,b)=>b.nearest-a.nearest)[0];
      return { target: targetEntry ? { ...targetEntry.point, id: targetEntry.node.id } : null, background: bg?.nearest > 40 ? bg.candidate : null };
    });
    assert.ok(target && background, 'selector-name: fixture must expose node and background points');

    const backgroundStarted = performance.now();
    await withDeadline(page.touchscreen.tap(background.x, background.y), 1_000, 'selector-name: background tap');
    const backgroundTap = performance.now() - backgroundStarted;
    await new Promise(resolve => setTimeout(resolve, 350));

    const panelSignal = new Promise(resolve => {
      const listener = message => {
        if (message.text() !== 'SELECTOR_NAME_PANEL_OPEN') return;
        page.off('console', listener); resolve();
      };
      page.on('console', listener);
    });
    await page.evaluate(() => {
      const panel = document.querySelector('#panel');
      const observer = new MutationObserver(() => {
        if (!panel.classList.contains('open')) return;
        console.log('SELECTOR_NAME_PANEL_OPEN'); observer.disconnect();
      });
      observer.observe(panel, { attributes: true, attributeFilter: ['class'] });
    });

    const tapStarted = performance.now();
    await withDeadline(page.touchscreen.tap(target.x, target.y), 1_000, 'selector-name: node tap');
    const nodeTap = performance.now() - tapStarted;
    await withDeadline(panelSignal, 1_000, 'selector-name: panel open');
    assert.ok(nodeTap <= 250, `selector-name: node tap took ${nodeTap.toFixed(1)}ms`);

    await page.evaluate(className => {
      const style = document.createElement('style');
      style.dataset.issue51SelectorProbe = 'true';
      style.textContent = `.${className}{font-size:9px;color:var(--ink-faint);margin:5px 0 8px}`;
      document.head.appendChild(style);
    }, renamedClass);

    const injectStarted = performance.now();
    await withDeadline(page.evaluate(({ className, text }) => {
      const body = document.querySelector('#panelBody');
      body.innerHTML = `<div class="${className}">${text}</div>`;
      void body.offsetHeight;
    }, { className: renamedClass, text: exactText }), 1_000, 'selector-name: renamed class injection');
    const injectWall = performance.now() - injectStarted;

    const responseStarted = performance.now();
    await withDeadline(page.evaluate(() => performance.now()), 250, 'selector-name: post-injection responsiveness');
    const responseWall = performance.now() - responseStarted;
    assert.ok(injectWall <= 250, `selector-name: renamed class injection took ${injectWall.toFixed(1)}ms`);
    assert.ok(responseWall <= 250, `selector-name: post-injection response took ${responseWall.toFixed(1)}ms`);

    await context.close();
    return { backgroundTap, nodeTap, className: renamedClass, injectWall, responseWall };
  } finally {
    await browser.close().catch(() => {});
  }
}

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1'], { stdio: 'ignore' });
try {
  for (let attemptIndex = 0; attemptIndex < 100; attemptIndex++) {
    try { if ((await fetch(origin)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  let result;
  try {
    result = { ok: true, metrics: await runSelectorCase() };
  } catch (error) {
    result = { ok: false, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  }
  await mkdir('artifacts', { recursive: true });
  await writeFile(artifactPath, JSON.stringify(result, null, 2));
  console.log(`SELECTOR_NAME_RESULT ${JSON.stringify(result)}`);
  assert.ok(result.ok, 'renamed mastery selector failed; inspect uploaded diagnostic artifact');
} finally {
  server.kill('SIGKILL'); server.unref();
}
