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

    // Close the reasoning fixture before validating the lineage lifecycle.
    await page.locator('#nodeDetailOverlay .node-detail-close').tap();
    await page.waitForFunction(() => !document.querySelector('#nodeDetailOverlay.open'), null, { timeout: 5_000 });
    await page.waitForTimeout(250);

    // Find a real stable gray/red lineage relation. In Current mode the related
    // historical/opposing ball is absent. Opening the current ball's detail must
    // temporarily render that ball and therefore its scene line; closing detail
    // must hide both again.
    const lineageFixture = await page.evaluate(() => {
      const debug = window.__debug;
      const nodes = debug.renderNodes;
      const core = new Set(['n1', 'n2', 'n16']);
      for (const current of nodes) {
        const currentRole = current.lineage?.role ?? 'current';
        if (currentRole !== 'current' || core.has(current.id)) continue;
        const topicId = current.lineage?.topicId ?? current.id;
        const related = nodes.find(node => {
          const role = node.lineage?.role;
          return node.id !== current.id
            && node.lineage?.topicId === topicId
            && (role === 'history' || role === 'opposition');
        });
        if (!related) continue;
        const point = debug.scene.screenPositionForNode(current.id);
        if (!point || point.x <= 24 || point.x >= 366 || point.y <= 88 || point.y >= 808) continue;
        return {
          currentId: current.id,
          currentTitle: current.title,
          relatedId: related.id,
          relatedTitle: related.title,
          relationKind: related.lineage.role,
          ...point,
        };
      }
      return null;
    });
    assert.ok(lineageFixture, 'hosted/browser fixture must expose at least one stable history or opposition relation');

    const beforeLineageDetail = await page.evaluate(relatedId => ({
      visibleEdges: window.__debug.scene.getVisibleEdgeCount(),
      relatedPoint: window.__debug.scene.screenPositionForNode(relatedId),
    }), lineageFixture.relatedId);
    assert.equal(beforeLineageDetail.relatedPoint, null, 'Current mode must hide the stable gray/red relation ball before detail opens');

    await page.touchscreen.tap(lineageFixture.x, lineageFixture.y);
    await page.waitForTimeout(900);
    const lineageCentered = await page.evaluate(id => window.__debug.scene.screenPositionForNode(id), lineageFixture.currentId);
    assert.ok(lineageCentered, 'lineage current ball must remain renderable after focus');
    await page.touchscreen.tap(lineageCentered.x, lineageCentered.y);
    await page.waitForFunction(
      ({ currentId, relatedId }) => document.querySelector('#nodeDetailOverlay.open')?.getAttribute('data-node-id') === currentId
        && Boolean(window.__debug.scene.screenPositionForNode(relatedId)),
      { currentId: lineageFixture.currentId, relatedId: lineageFixture.relatedId },
      { timeout: 5_000 },
    );

    const lineageRelationControl = page.locator(`#nodeDetailOverlay.open .node-detail-relation[data-relation-kind="${lineageFixture.relationKind}"][data-related-node-id="${lineageFixture.relatedId}"]`);
    assert.equal(await lineageRelationControl.count(), 1, 'detail must expose the same stable gray/red lineage ball it temporarily reveals in 3D');
    const afterLineageDetail = await page.evaluate(relatedId => ({
      visibleEdges: window.__debug.scene.getVisibleEdgeCount(),
      relatedPoint: window.__debug.scene.screenPositionForNode(relatedId),
    }), lineageFixture.relatedId);
    assert.ok(afterLineageDetail.relatedPoint, 'opening detail must automatically render the related gray/red ball');
    assert.ok(afterLineageDetail.visibleEdges > beforeLineageDetail.visibleEdges, 'opening detail must automatically add at least one visible lineage edge');

    await page.locator('#nodeDetailOverlay .node-detail-close').tap();
    await page.waitForFunction(() => !document.querySelector('#nodeDetailOverlay.open'), null, { timeout: 5_000 });
    await page.waitForFunction(
      relatedId => window.__debug.scene.screenPositionForNode(relatedId) === null,
      lineageFixture.relatedId,
      { timeout: 5_000 },
    );
    const afterLineageClose = await page.evaluate(() => window.__debug.scene.getVisibleEdgeCount());
    assert.ok(afterLineageClose < afterLineageDetail.visibleEdges, 'closing detail must hide the lineage edge together with its gray/red endpoint ball');

    assert.deepEqual(pageErrors, [], `canonical relation detail flow produced page errors:\n${pageErrors.join('\n')}`);
    console.log(`Canonical reasoning + lineage browser regression passed: ${candidate.previousReasoningId} -> ${candidate.id} -> ${candidate.nextReasoningId}; ${lineageFixture.currentId} -> ${lineageFixture.relatedId}`);
  } finally {
    await browser.close();
  }
} finally {
  server.kill('SIGTERM');
}
