import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const origin = 'http://127.0.0.1:4173/Knowledge-Ball/';
const eventCount = 343;
const storageKey = 'knowledge-ball.events.v1';
const exactText = 'PRIVATE STATE · 仅你可见';

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

async function runCase(name, { prewarm = false, systemFont = false } = {}) {
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
    assert.ok(target && background, `${name}: fixture must expose node and background points`);

    await withDeadline(page.touchscreen.tap(background.x, background.y), 1_000, `${name}: background tap`);
    await new Promise(resolve => setTimeout(resolve, 350));

    const panelSignal = new Promise(resolve => {
      const listener = message => {
        if (message.text() !== `COLD_FONT_PANEL_OPEN:${name}`) return;
        page.off('console', listener); resolve();
      };
      page.on('console', listener);
    });
    await page.evaluate(caseName => {
      const panel = document.querySelector('#panel');
      const observer = new MutationObserver(() => {
        if (!panel.classList.contains('open')) return;
        console.log(`COLD_FONT_PANEL_OPEN:${caseName}`); observer.disconnect();
      });
      observer.observe(panel, { attributes: true, attributeFilter: ['class'] });
    }, name);

    const tapStarted = performance.now();
    await withDeadline(page.touchscreen.tap(target.x, target.y), 1_000, `${name}: node tap`);
    const nodeTap = performance.now() - tapStarted;
    await withDeadline(panelSignal, 1_000, `${name}: panel open`);
    assert.ok(nodeTap <= 250, `${name}: node tap took ${nodeTap.toFixed(1)}ms`);

    if (prewarm) {
      const warmStarted = performance.now();
      await withDeadline(page.evaluate(text => {
        const body = document.querySelector('#panelBody');
        body.innerHTML = `<div style="font-size:14px">${text}</div>`;
        void body.offsetHeight;
      }, exactText), 1_000, `${name}: prewarm`);
      const warmWall = performance.now() - warmStarted;
      const warmResponseStarted = performance.now();
      await withDeadline(page.evaluate(() => performance.now()), 250, `${name}: prewarm responsiveness`);
      console.log(`cold-font: ${name} prewarm ${warmWall.toFixed(1)}ms, response ${(performance.now()-warmResponseStarted).toFixed(1)}ms`);
    }

    const html = systemFont
      ? `<div class="mastery-private" style="font-family:Arial,sans-serif">${exactText}</div>`
      : `<div class="mastery-private">${exactText}</div>`;
    const injectStarted = performance.now();
    await withDeadline(page.evaluate(markup => {
      const body = document.querySelector('#panelBody');
      body.innerHTML = markup;
      void body.offsetHeight;
    }, html), 1_000, `${name}: mastery-private injection`);
    const injectWall = performance.now() - injectStarted;

    const responseStarted = performance.now();
    await withDeadline(page.evaluate(() => performance.now()), 250, `${name}: post-injection responsiveness`);
    const responseWall = performance.now() - responseStarted;
    console.log(`cold-font: ${name} nodeTap ${nodeTap.toFixed(1)}ms, inject ${injectWall.toFixed(1)}ms, response ${responseWall.toFixed(1)}ms`);
    assert.ok(injectWall <= 250, `${name}: mastery-private injection took ${injectWall.toFixed(1)}ms`);
    assert.ok(responseWall <= 250, `${name}: post-injection response took ${responseWall.toFixed(1)}ms`);

    await context.close();
    return { nodeTap, injectWall, responseWall };
  } finally {
    await browser.close().catch(() => {});
  }
}

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1'], { stdio: 'ignore' });
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(origin)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  const coldDefault = await runCase('cold-default');
  const coldSystemFont = await runCase('cold-system-font', { systemFont: true });
  const warmedDefault = await runCase('warmed-default', { prewarm: true });
  console.log(JSON.stringify({ coldDefault, coldSystemFont, warmedDefault }, null, 2));
  console.log('Cold mastery font diagnostic passed all isolated cases');
} finally {
  server.kill('SIGKILL'); server.unref();
}
