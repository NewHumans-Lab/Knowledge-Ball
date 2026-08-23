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

    await page.goto(`${origin}?canonical-reasoning-chain-regression=1`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForFunction(() => Boolean(window.__debug?.scene && window.__debug?.renderNodes?.length), null, { timeout: 10_000 });

    const candidate = await page.evaluate(() => {
      const debug = window.__debug;
      const nodes = debug.renderNodes;
      const byId = new Map(nodes.map(node => [node.id, node]));
      const core = new Set(['n1', 'n2', 'n16']);
      const choices = nodes.flatMap(node => {
        if (core.has(node.id) || node.hidden || node.type === 'reasoning' || node.type === 'logic-symbol') return [];
        const previousReasoning = node.premises
          ?.map(id => byId.get(id))
          .find(previous => previous?.type === 'reasoning');
        const nextReasoning = nodes.find(next => next.type === 'reasoning' && next.premises?.includes(node.id));
        if (!previousReasoning || !nextReasoning) return [];
        const point = debug.scene.screenPositionForNode(node.id);
        if (!point || point.x <= 24 || point.x >= 366 || point.y <= 88 || point.y >= 808) return [];
        return [{
          id: node.id,
          title: node.title,
          previousReasoningId: previousReasoning.id,
          previousReasoningTitle: previousReasoning.title,
          nextReasoningId: nextReasoning.id,
          nextReasoningTitle: nextReasoning.title,
          ...point,
        }];
      });
      return choices[0] ?? null;
    });
    assert.ok(candidate, 'fixture must expose a conclusion that is between two real reasoning-process nodes');

    // Real first tap focuses the ball; real second tap opens its detail.
    await page.touchscreen.tap(candidate.x, candidate.y);
    await page.waitForTimeout(900);
    const centered = await page.evaluate(id => window.__debug.scene.screenPositionForNode(id), candidate.id);
    assert.ok(centered, 'focused conclusion must remain renderable');
    await page.touchscreen.tap(centered.x, centered.y);

    const detail = page.locator('#nodeDetailOverlay.open');
    await detail.waitFor({ state: 'visible', timeout: 5_000 });
    assert.equal(await detail.getAttribute('data-node-id'), candidate.id, 'second tap must open the conclusion detail');
    assert.equal(await page.locator('#panel.open').count(), 0, 'near-node flow must not restore the legacy large panel');

    const allControls = detail.locator('.node-detail-relation[data-related-node-id]');
    const controls = await allControls.evaluateAll(elements => elements.map(element => ({
      tag: element.tagName,
      id: element.dataset.relatedNodeId ?? '',
      kind: element.dataset.relationKind ?? '',
      text: element.textContent?.trim() ?? '',
      pointerEvents: getComputedStyle(element).pointerEvents,
    })));
    assert.ok(controls.length > 0, 'connected conclusion detail must not be a blank relation surface');
    assert.ok(controls.every(control => control.tag === 'BUTTON'), 'all relation entries must remain semantic buttons');
    assert.ok(controls.every(control => control.pointerEvents === 'auto'), 'all relation buttons must accept pointer input');
    assert.ok(controls.every(control => ['previous', 'next', 'history', 'opposition'].includes(control.kind)), 'no legacy premise/logic/twin relation kind may reach the detail DOM');

    const previousReasoning = detail.locator(`.node-detail-relation[data-relation-kind="previous"][data-related-node-id="${candidate.previousReasoningId}"]`);
    const nextReasoning = detail.locator(`.node-detail-relation[data-relation-kind="next"][data-related-node-id="${candidate.nextReasoningId}"]`);
    assert.equal(await previousReasoning.count(), 1, 'a conclusion must expose its real reasoning-process ball on the left');
    assert.equal(await nextReasoning.count(), 1, 'a conclusion reused later must expose the next reasoning-process ball on the right');
    assert.equal((await previousReasoning.textContent())?.trim(), candidate.previousReasoningTitle);
    assert.equal((await nextReasoning.textContent())?.trim(), candidate.nextReasoningTitle);

    // Tap the white reasoning-process node itself. It is not an edge label: it
    // becomes the current real detail node, with its own premises on the left
    // and its conclusion on the right.
    await previousReasoning.tap();
    await page.waitForFunction(
      id => document.querySelector('#nodeDetailOverlay.open')?.getAttribute('data-node-id') === id,
      candidate.previousReasoningId,
      { timeout: 5_000 },
    );
    assert.equal((await page.locator('#nodeDetailOverlay .node-detail-title').textContent())?.trim(), candidate.previousReasoningTitle, 'reasoning-process relation tap must open the reasoning ball itself');

    const reasoningShape = await page.evaluate(({ reasoningId, conclusionId }) => {
      const debug = window.__debug;
      const nodes = debug.renderNodes;
      const reasoning = nodes.find(node => node.id === reasoningId);
      const root = document.querySelector('#nodeDetailOverlay.open');
      return {
        premiseIds: reasoning?.premises ?? [],
        previousIds: Array.from(root?.querySelectorAll('[data-relation-kind="previous"]') ?? []).map(element => element.dataset.relatedNodeId),
        nextIds: Array.from(root?.querySelectorAll('[data-relation-kind="next"]') ?? []).map(element => element.dataset.relatedNodeId),
        conclusionId,
      };
    }, { reasoningId: candidate.previousReasoningId, conclusionId: candidate.id });
    assert.ok(reasoningShape.premiseIds.length > 0, 'reasoning-process fixture must have real premises');
    assert.ok(reasoningShape.premiseIds.every(id => reasoningShape.previousIds.includes(id)), 'reasoning-process left side must contain its real premise nodes');
    assert.ok(reasoningShape.nextIds.includes(candidate.id), 'reasoning-process right side must contain its real conclusion node');

    // Navigate back through the canonical next direction to prove both directions
    // share one node navigation path.
    await detail.locator(`.node-detail-relation[data-relation-kind="next"][data-related-node-id="${candidate.id}"]`).tap();
    await page.waitForFunction(
      id => document.querySelector('#nodeDetailOverlay.open')?.getAttribute('data-node-id') === id,
      candidate.id,
      { timeout: 5_000 },
    );
    assert.equal(await page.locator('#panel.open').count(), 0, 'canonical chain navigation must remain in the near-node detail flow');

    assert.deepEqual(pageErrors, [], `canonical reasoning-chain detail flow produced page errors:\n${pageErrors.join('\n')}`);
    console.log(`Canonical reasoning-chain browser regression passed: ${candidate.previousReasoningId} -> ${candidate.id} -> ${candidate.nextReasoningId}`);
  } finally {
    await browser.close();
  }
} finally {
  server.kill('SIGTERM');
}
