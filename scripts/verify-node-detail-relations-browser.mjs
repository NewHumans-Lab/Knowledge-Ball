import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const origin = 'http://127.0.0.1:4173/Knowledge-Ball/';
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1'],
  { stdio: 'ignore' },
);

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      if ((await fetch(origin)).ok) return;
    } catch { /* preview is still starting */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Vite preview did not become reachable');
}

try {
  await waitForServer();
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader'] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.goto(`${origin}?node-detail-relations-regression=1`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForFunction(() => Boolean(window.__debug?.scene && window.__debug?.renderNodes?.length), null, { timeout: 10_000 });

    const candidate = await page.evaluate(() => {
      const debug = window.__debug;
      const nodes = debug.renderNodes;
      const byId = new Map(nodes.map(node => [node.id, node]));
      const core = new Set(['n1', 'n2', 'n16']);
      const hasDirectRelation = node => node.premises?.some(id => byId.has(id) && !core.has(id))
        || nodes.some(other => other.id !== node.id && other.premises?.includes(node.id));
      const choices = nodes
        .filter(node => !core.has(node.id) && !node.hidden && hasDirectRelation(node))
        .map(node => {
          const point = debug.scene.screenPositionForNode(node.id);
          return point ? { id: node.id, title: node.title, ...point } : null;
        })
        .filter(item => item && item.x > 24 && item.x < 366 && item.y > 88 && item.y < 808);
      return choices[0] ?? null;
    });
    assert.ok(candidate, 'scene must expose an on-screen ordinary node with a direct related node');

    // Exercise the real focus-then-second-tap flow rather than opening the detail
    // controller directly. First tap focuses the ball; second tap opens its detail.
    await page.touchscreen.tap(candidate.x, candidate.y);
    await page.waitForTimeout(900);
    const centered = await page.evaluate(id => window.__debug.scene.screenPositionForNode(id), candidate.id);
    assert.ok(centered, 'focused related-node fixture must remain renderable');
    await page.touchscreen.tap(centered.x, centered.y);

    const detail = page.locator('#nodeDetailOverlay.open');
    await detail.waitFor({ state: 'visible', timeout: 5_000 });
    assert.equal(await detail.getAttribute('data-node-id'), candidate.id, 'second tap must open the focused node detail');
    assert.equal(await page.locator('#panel.open').count(), 0, 'near-node related navigation must not restore the legacy large panel');

    const relationControls = detail.locator('.node-detail-relation[data-related-node-id]');
    const controlCount = await relationControls.count();
    assert.ok(controlCount > 0, 'second-tap detail must render at least one related-node control for a connected node');

    const controls = await relationControls.evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        tag: element.tagName,
        id: element.dataset.relatedNodeId ?? '',
        kind: element.dataset.relationKind ?? '',
        text: element.textContent?.trim() ?? '',
        pointerEvents: style.pointerEvents,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      };
    }));
    assert.ok(controls.every(control => control.tag === 'BUTTON'), 'related-node entries must be semantic buttons, not decorative text');
    assert.ok(controls.every(control => control.id && control.kind && control.text), 'related-node controls must preserve target identity, relation kind and label');
    assert.ok(controls.every(control => control.pointerEvents === 'auto'), 'related-node buttons must accept pointer input');

    const tappable = controls.find(control => {
      const cx = control.x + control.width / 2;
      const cy = control.y + control.height / 2;
      return control.width > 0 && control.height > 0 && cx >= 0 && cx <= 390 && cy >= 0 && cy <= 844;
    });
    assert.ok(tappable, 'at least one related-node button must expose a real on-screen touch target');

    const targetNode = await page.evaluate(id => {
      const node = window.__debug.renderNodes.find(candidate => candidate.id === id);
      return node ? { id: node.id, title: node.title } : null;
    }, tappable.id);
    assert.ok(targetNode, 'related-node button must point to a node retained by the scene/detail model');

    await page.touchscreen.tap(tappable.x + tappable.width / 2, tappable.y + tappable.height / 2);
    await page.waitForFunction(
      id => document.querySelector('#nodeDetailOverlay.open')?.getAttribute('data-node-id') === id,
      tappable.id,
      { timeout: 5_000 },
    );
    assert.equal((await page.locator('#nodeDetailOverlay .node-detail-title').textContent())?.trim(), targetNode.title, 'related-node tap must navigate to the target detail');
    assert.equal(await page.locator('#panel.open').count(), 0, 'related-node navigation must remain inside the near-node detail flow');

    assert.deepEqual(pageErrors, [], `related-node detail flow produced page errors:\n${pageErrors.join('\n')}`);
    console.log(`Near-node related navigation browser regression passed: ${candidate.id} -> ${tappable.id}`);
  } finally {
    await browser.close();
  }
} finally {
  server.kill('SIGTERM');
}