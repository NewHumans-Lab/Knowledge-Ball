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

async function waitForNodeAtCanvasCenter(page, id, tolerance = 12) {
  await page.waitForFunction(
    ({ nodeId, tolerancePx }) => {
      const point = window.__debug?.scene?.screenPositionForNode(nodeId);
      const host = document.getElementById('canvasHost');
      if (!point || !host) return false;
      const rect = host.getBoundingClientRect();
      return Math.hypot(point.x - (rect.left + rect.width / 2), point.y - (rect.top + rect.height / 2)) <= tolerancePx;
    },
    { nodeId: id, tolerancePx: tolerance },
    { timeout: 5_000 },
  );
}

async function findCanvasAddressableReasoningNeighbour(page, preferredIds) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const target = await page.evaluate(ids => {
      const debug = window.__debug;
      const canvas = document.querySelector('#canvasHost canvas');
      const root = document.querySelector('#nodeDetailOverlay.open');
      if (!debug?.scene || !canvas || !root) return null;
      const currentId = root.getAttribute('data-node-id');
      const currentPoint = currentId ? debug.scene.screenPositionForNode(currentId) : null;
      const relationIds = new Set(Array.from(root.querySelectorAll('[data-related-node-id]')).map(element => element.dataset.relatedNodeId));
      const canvasRect = canvas.getBoundingClientRect();
      for (const id of ids) {
        if (!relationIds.has(id)) continue;
        const node = debug.renderNodes.find(value => value.id === id);
        if (!node || node.type !== 'reasoning') continue;
        const point = debug.scene.screenPositionForNode(id);
        if (!point) continue;
        if (point.x < canvasRect.left + 26 || point.x > canvasRect.right - 26 || point.y < canvasRect.top + 26 || point.y > canvasRect.bottom - 26) continue;
        if (currentPoint && Math.hypot(point.x - currentPoint.x, point.y - currentPoint.y) <= 28) continue;
        if (document.elementFromPoint(point.x, point.y) !== canvas) continue;
        return { id, title: node.title, x: point.x, y: point.y };
      }
      return null;
    }, preferredIds);
    if (target) return target;
    await page.waitForTimeout(100);
  }
  return null;
}

async function explainUnavailableCanvasReasoningNeighbour(page, preferredIds) {
  return page.evaluate(ids => {
    const debug = window.__debug;
    const canvas = document.querySelector('#canvasHost canvas');
    const root = document.querySelector('#nodeDetailOverlay.open');
    if (!debug?.scene || !canvas || !root) return null;
    const currentId = root.getAttribute('data-node-id');
    const currentPoint = currentId ? debug.scene.screenPositionForNode(currentId) : null;
    const relationIds = new Set(Array.from(root.querySelectorAll('[data-related-node-id]')).map(element => element.dataset.relatedNodeId));
    const canvasRect = canvas.getBoundingClientRect();
    return ids.map(id => {
      const node = debug.renderNodes.find(value => value.id === id);
      const point = debug.scene.screenPositionForNode(id);
      return {
        id,
        relation: relationIds.has(id),
        reasoning: node?.type === 'reasoning',
        point,
        separation: point && currentPoint ? Math.hypot(point.x - currentPoint.x, point.y - currentPoint.y) : null,
        inCanvas: Boolean(point && point.x >= canvasRect.left + 26 && point.x <= canvasRect.right - 26 && point.y >= canvasRect.top + 26 && point.y <= canvasRect.bottom - 26),
        domCanvas: Boolean(point && document.elementFromPoint(point.x, point.y) === canvas),
      };
    });
  }, preferredIds);
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

    // Before detail opens, preserve the approved two-step gesture: first touch
    // focuses the physical ball and the second touch opens its local navigator.
    await page.touchscreen.tap(candidate.x, candidate.y);
    await page.waitForTimeout(900);
    const centered = await page.evaluate(id => window.__debug.scene.screenPositionForNode(id), candidate.id);
    assert.ok(centered, 'focused conclusion must remain renderable');
    await page.touchscreen.tap(centered.x, centered.y);

    const detail = page.locator('#nodeDetailOverlay.open');
    await detail.waitFor({ state: 'visible', timeout: 5_000 });
    assert.equal(await detail.getAttribute('data-node-id'), candidate.id, 'second tap must open the conclusion detail');
    assert.equal(await page.locator('#panel.open').count(), 0, 'near-node flow must not restore the legacy large panel');
    await waitForNodeAtCanvasCenter(page, candidate.id);

    const allControls = detail.locator('.node-detail-relation[data-related-node-id]');
    const controls = await allControls.evaluateAll(elements => elements.map(element => ({
      tag: element.tagName,
      id: element.dataset.relatedNodeId ?? '',
      kind: element.dataset.relationKind ?? '',
      text: element.textContent?.trim() ?? '',
      pointerEvents: getComputedStyle(element).pointerEvents,
    })));
    assert.ok(controls.length > 0, 'connected conclusion detail must not be a blank relation surface');
    assert.ok(controls.every(control => control.tag === 'BUTTON'), 'all direct connected nodes must remain semantic buttons');
    assert.ok(controls.every(control => control.pointerEvents === 'auto'), 'all neighbour buttons must accept pointer input');
    assert.ok(controls.every(control => ['previous', 'next', 'history', 'opposition'].includes(control.kind)), 'no legacy premise/logic/twin relation kind may reach the detail DOM');

    const previousReasoning = detail.locator(`.node-detail-relation[data-relation-kind="previous"][data-related-node-id="${candidate.previousReasoningId}"]`);
    const nextReasoning = detail.locator(`.node-detail-relation[data-relation-kind="next"][data-related-node-id="${candidate.nextReasoningId}"]`);
    assert.equal(await previousReasoning.count(), 1, 'a conclusion must expose its real reasoning-process ball on the left');
    assert.equal(await nextReasoning.count(), 1, 'a conclusion reused later must expose the next reasoning-process ball on the right');
    assert.equal((await previousReasoning.textContent())?.trim(), candidate.previousReasoningTitle, 'button text must be the real white knowledge node title');
    assert.equal((await nextReasoning.textContent())?.trim(), candidate.nextReasoningTitle, 'button text must be the real white knowledge node title');

    // Presentation acceptance for the screenshot-level requirement: neighbour
    // labels use the same body typography as the middle content and a structural
    // white relation node uses the exact structural ball colour token.
    const relationPresentation = await page.evaluate(reasoningId => {
      const root = document.querySelector('#nodeDetailOverlay.open');
      const content = root?.querySelector('.node-detail-content');
      const relation = root?.querySelector(`[data-related-node-id="${reasoningId}"]`);
      if (!root || !content || !relation) return null;
      const contentStyle = getComputedStyle(content);
      const relationStyle = getComputedStyle(relation);
      return {
        content: {
          fontFamily: contentStyle.fontFamily,
          fontSize: contentStyle.fontSize,
          fontWeight: contentStyle.fontWeight,
          lineHeight: contentStyle.lineHeight,
        },
        relation: {
          fontFamily: relationStyle.fontFamily,
          fontSize: relationStyle.fontSize,
          fontWeight: relationStyle.fontWeight,
          lineHeight: relationStyle.lineHeight,
          color: relationStyle.color,
          colorToken: relationStyle.getPropertyValue('--relation-node-color').trim().toUpperCase(),
        },
        structuralToken: getComputedStyle(document.documentElement).getPropertyValue('--node-structural').trim().toUpperCase(),
      };
    }, candidate.previousReasoningId);
    assert.ok(relationPresentation, 'relation presentation diagnostics must be available');
    assert.equal(relationPresentation.relation.fontFamily, relationPresentation.content.fontFamily, 'neighbour label font family must equal middle content');
    assert.equal(relationPresentation.relation.fontSize, relationPresentation.content.fontSize, 'neighbour label font size must equal middle content');
    assert.equal(relationPresentation.relation.fontWeight, relationPresentation.content.fontWeight, 'neighbour label font weight must equal middle content');
    assert.equal(relationPresentation.relation.lineHeight, relationPresentation.content.lineHeight, 'neighbour label line height must equal middle content');
    assert.equal(relationPresentation.relation.colorToken, relationPresentation.structuralToken, 'white reasoning label must use the same structural colour token as its real ball');

    // Layout acceptance is count-independent. Two, three and seven synthetic
    // labels exercise the actual production CSS without adding fake graph data.
    // Side rails stay vertically centred on the ellipse and inside the viewport;
    // top/bottom rails wrap every row around the ellipse centre.
    const symmetry = await page.evaluate(() => {
      const root = document.querySelector('#nodeDetailOverlay.open');
      if (!root) return null;
      const rootRect = root.getBoundingClientRect();
      const rootCenterX = rootRect.left + rootRect.width / 2;
      const rootCenterY = rootRect.top + rootRect.height / 2;

      const measure = (axis, count) => {
        const group = document.createElement('div');
        group.className = `node-detail-relations ${axis}`;
        group.style.visibility = 'hidden';
        group.style.pointerEvents = 'none';
        for (let i = 0; i < count; i += 1) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'node-detail-relation';
          button.textContent = `关联知识节点${i + 1}`;
          group.appendChild(button);
        }
        root.appendChild(group);
        const groupRect = group.getBoundingClientRect();
        const buttonRects = Array.from(group.children).map(element => element.getBoundingClientRect());
        const rows = new Map();
        for (const rect of buttonRects) {
          const key = Math.round(rect.top);
          const row = rows.get(key) ?? [];
          row.push(rect);
          rows.set(key, row);
        }
        const rowCenterErrors = [...rows.values()].map(row => {
          const left = Math.min(...row.map(rect => rect.left));
          const right = Math.max(...row.map(rect => rect.right));
          return Math.abs((left + right) / 2 - rootCenterX);
        });
        const result = {
          axis,
          count,
          centerXError: Math.abs(groupRect.left + groupRect.width / 2 - rootCenterX),
          centerYError: Math.abs(groupRect.top + groupRect.height / 2 - rootCenterY),
          maxRowCenterError: rowCenterErrors.length ? Math.max(...rowCenterErrors) : 0,
          minLeft: Math.min(...buttonRects.map(rect => rect.left)),
          maxRight: Math.max(...buttonRects.map(rect => rect.right)),
          viewportWidth: window.innerWidth,
        };
        group.remove();
        return result;
      };

      return {
        side: [2, 3, 7].map(count => measure('left', count)),
        horizontal: [2, 3, 7].map(count => measure('top', count)),
      };
    });
    assert.ok(symmetry, 'relation symmetry diagnostics must be available');
    for (const sample of symmetry.side) {
      assert.ok(sample.centerYError <= 1.5, `${sample.count} side labels must be vertically centred on the ellipse (error ${sample.centerYError})`);
      assert.ok(sample.minLeft >= -1 && sample.maxRight <= sample.viewportWidth + 1, `${sample.count} side labels must stay inside the mobile viewport`);
    }
    for (const sample of symmetry.horizontal) {
      assert.ok(sample.centerXError <= 1.5, `${sample.count} top labels must be horizontally centred on the ellipse (error ${sample.centerXError})`);
      assert.ok(sample.maxRowCenterError <= 1.5, `${sample.count} wrapped top labels must centre every row on the ellipse (error ${sample.maxRowCenterError})`);
    }

    // A relation button is only another entrance to the same real ball. One tap
    // must keep the navigator open, switch its content, and move that physical
    // white reasoning ball to the centre of the 3D scene.
    await previousReasoning.tap();
    await page.waitForFunction(
      id => document.querySelector('#nodeDetailOverlay.open')?.getAttribute('data-node-id') === id,
      candidate.previousReasoningId,
      { timeout: 5_000 },
    );
    await waitForNodeAtCanvasCenter(page, candidate.previousReasoningId);
    assert.equal((await page.locator('#nodeDetailOverlay .node-detail-title').textContent())?.trim(), candidate.previousReasoningTitle, 'reasoning-process relation tap must open the reasoning ball itself');
    assert.equal(await page.locator('#panel.open').count(), 0, 'button navigation must remain in one continuously open local navigator');

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
    assert.ok(reasoningShape.premiseIds.every(id => reasoningShape.previousIds.includes(id)), 'white reasoning ball must naturally expand its real premise neighbours');
    assert.ok(reasoningShape.nextIds.includes(candidate.id), 'white reasoning ball must naturally expand its real conclusion neighbour');

    // Navigate back through the canonical next direction. Again, only one button
    // tap is allowed and the actual conclusion ball must return to centre.
    await detail.locator(`.node-detail-relation[data-relation-kind="next"][data-related-node-id="${candidate.id}"]`).tap();
    await page.waitForFunction(
      id => document.querySelector('#nodeDetailOverlay.open')?.getAttribute('data-node-id') === id,
      candidate.id,
      { timeout: 5_000 },
    );
    await waitForNodeAtCanvasCenter(page, candidate.id);
    // Let the focus slerp finish before sampling neighbour coordinates. A node can
    // enter the 12px centre tolerance while its surrounding 3D projection is still
    // moving appreciably.
    await page.waitForTimeout(350);

    // A real neighbour is directly canvas-addressable only when its current 2D
    // projection is distinguishable from the centred ball. Fixed 72-unit 3D
    // geometry may legitimately project two nodes onto nearly the same pixels;
    // that is occlusion, not a reason to move semantic geometry just for detail UI.
    const preferredWhiteIds = [candidate.nextReasoningId, candidate.previousReasoningId];
    const physicalWhite = await findCanvasAddressableReasoningNeighbour(page, preferredWhiteIds);
    if (physicalWhite) {
      await page.touchscreen.tap(physicalWhite.x, physicalWhite.y);
      await page.waitForFunction(
        id => document.querySelector('#nodeDetailOverlay.open')?.getAttribute('data-node-id') === id,
        physicalWhite.id,
        { timeout: 5_000 },
      );
      await waitForNodeAtCanvasCenter(page, physicalWhite.id);
      assert.equal((await page.locator('#nodeDetailOverlay .node-detail-title').textContent())?.trim(), physicalWhite.title, 'one distinguishable real-ball touch must replace the detail with that white node');
      const physicalDetailNeighbours = await detail.locator('[data-related-node-id]').evaluateAll(elements => elements.map(element => element.dataset.relatedNodeId));
      assert.ok(physicalDetailNeighbours.includes(candidate.id), 'the newly centred white node must automatically unfold the conclusion it is directly connected to');
      assert.equal(await page.locator('#panel.open').count(), 0, 'real-ball navigation must not close detail or open the legacy panel');

      // Return to the original conclusion with one neighbour-button tap so lineage
      // acceptance starts from the same known current node.
      await detail.locator(`[data-related-node-id="${candidate.id}"]`).first().tap();
      await page.waitForFunction(
        id => document.querySelector('#nodeDetailOverlay.open')?.getAttribute('data-node-id') === id,
        candidate.id,
        { timeout: 5_000 },
      );
      await waitForNodeAtCanvasCenter(page, candidate.id);
    } else {
      const unavailable = await explainUnavailableCanvasReasoningNeighbour(page, preferredWhiteIds);
      assert.ok(unavailable?.length, 'non-addressable reasoning neighbours must still produce projection diagnostics');
      assert.ok(
        unavailable.every(item => !item.relation || !item.reasoning || !item.point || !item.inCanvas || !item.domCanvas || item.separation <= 28),
        `a supposedly unavailable reasoning neighbour was actually independently canvas-addressable: ${JSON.stringify(unavailable)}`,
      );
      assert.equal(await detail.getAttribute('data-node-id'), candidate.id, 'projection-occluded neighbour must not force the current detail to move');
    }

    // Close before validating the stable lineage lifecycle.
    await page.locator('#nodeDetailOverlay .node-detail-close').tap();
    await page.waitForFunction(() => !document.querySelector('#nodeDetailOverlay.open'), null, { timeout: 5_000 });
    await page.waitForTimeout(250);

    // The preview fixture is intentionally independent of hosted production data.
    // Add two-step gray + red chains to the same domain projection and scene.
    // Mark the injected nodes touched from the start: they are test-only records
    // appended after the real layout pass, and allowing markNodeViewed() to fire
    // would rebuild their positions while a focus animation is already targeting
    // the pre-layout fixture coordinate. Production lineage nodes are laid out
    // before interaction and do not have this fixture-only discontinuity.
    const lineageFixture = await page.evaluate(currentId => {
      const debug = window.__debug;
      const domainCurrent = debug.projection.state.nodesById[currentId];
      const renderCurrent = debug.renderNodes.find(node => node.id === currentId);
      if (!domainCurrent || !renderCurrent) return null;

      const topicId = domainCurrent.lineage?.topicId ?? currentId;
      const makeDomainNode = (id, role, proposal, title, rank, targetId) => ({
        ...structuredClone(domainCurrent),
        id,
        title,
        status: 'verified',
        mastery: 'touched',
        hidden: true,
        premises: [...domainCurrent.premises],
        lineage: { topicId, proposal, targetId, role, rank },
      });
      const makeRenderNode = (id, role, proposal, title, rank, targetId) => ({
        id,
        title,
        type: renderCurrent.type,
        status: 'verified',
        mastery: 'touched',
        reasoning: renderCurrent.reasoning,
        premises: [...renderCurrent.premises],
        logicRuleId: renderCurrent.logicRuleId,
        aliases: renderCurrent.aliases ? [...renderCurrent.aliases] : undefined,
        semanticKey: renderCurrent.semanticKey,
        hidden: true,
        lineage: { topicId, proposal, targetId, role, rank },
        declaredLayer: renderCurrent.declaredLayer,
        effectiveLayer: renderCurrent.effectiveLayer,
      });

      const historyId = '__lineage-history-browser-fixture__';
      const historyOlderId = '__lineage-history-older-browser-fixture__';
      const oppositionId = '__lineage-opposition-browser-fixture__';
      const oppositionOlderId = '__lineage-opposition-older-browser-fixture__';
      const fixtures = [
        [historyId, 'history', 'optimization', `${domainCurrent.title} · history fixture`, 1, currentId],
        [historyOlderId, 'history', 'optimization', `${domainCurrent.title} · older history fixture`, 2, historyId],
        [oppositionId, 'opposition', 'opposition', `${domainCurrent.title} · opposition fixture`, 1, currentId],
        [oppositionOlderId, 'opposition', 'opposition', `${domainCurrent.title} · older opposition fixture`, 2, oppositionId],
      ];
      for (const [id, role, proposal, title, rank, targetId] of fixtures) {
        debug.projection.state.nodesById[id] = makeDomainNode(id, role, proposal, title, rank, targetId);
        debug.renderNodes.push(makeRenderNode(id, role, proposal, title, rank, targetId));
      }
      debug.scene.markDirty();
      return { currentId, historyId, historyOlderId, oppositionId, oppositionOlderId };
    }, candidate.id);
    assert.ok(lineageFixture, 'deterministic lineage fixture must attach to the tested current conclusion');
    await page.waitForTimeout(300);

    const beforeLineageDetail = await page.evaluate(({ historyId, historyOlderId, oppositionId, oppositionOlderId }) => ({
      visibleEdges: window.__debug.scene.getVisibleEdgeCount(),
      historyPoint: window.__debug.scene.screenPositionForNode(historyId),
      historyOlderPoint: window.__debug.scene.screenPositionForNode(historyOlderId),
      oppositionPoint: window.__debug.scene.screenPositionForNode(oppositionId),
      oppositionOlderPoint: window.__debug.scene.screenPositionForNode(oppositionOlderId),
    }), lineageFixture);
    assert.equal(beforeLineageDetail.historyPoint, null, 'Current mode must hide gray rank 1 before detail opens');
    assert.equal(beforeLineageDetail.historyOlderPoint, null, 'Current mode must hide gray rank 2 before detail opens');
    assert.equal(beforeLineageDetail.oppositionPoint, null, 'Current mode must hide red rank 1 before detail opens');
    assert.equal(beforeLineageDetail.oppositionOlderPoint, null, 'Current mode must hide red rank 2 before detail opens');

    // The conclusion is already focused, so a real touch normally reopens detail
    // immediately. Keep a fallback to the ordinary two-touch entry contract if a
    // renderer/browser implementation cleared focus while the fixture was added.
    let lineageCurrentPoint = await page.evaluate(id => window.__debug.scene.screenPositionForNode(id), lineageFixture.currentId);
    assert.ok(lineageCurrentPoint, 'lineage current ball must be renderable before opening detail');
    await page.touchscreen.tap(lineageCurrentPoint.x, lineageCurrentPoint.y);
    await page.waitForTimeout(250);
    if (await page.locator(`#nodeDetailOverlay.open[data-node-id="${lineageFixture.currentId}"]`).count() === 0) {
      await page.waitForTimeout(700);
      lineageCurrentPoint = await page.evaluate(id => window.__debug.scene.screenPositionForNode(id), lineageFixture.currentId);
      assert.ok(lineageCurrentPoint, 'lineage current ball must remain renderable after focus');
      await page.touchscreen.tap(lineageCurrentPoint.x, lineageCurrentPoint.y);
    }

    await page.waitForFunction(
      ({ currentId, historyId, oppositionId }) => document.querySelector('#nodeDetailOverlay.open')?.getAttribute('data-node-id') === currentId
        && Boolean(window.__debug.scene.screenPositionForNode(historyId))
        && Boolean(window.__debug.scene.screenPositionForNode(oppositionId)),
      lineageFixture,
      { timeout: 5_000 },
    );
    await waitForNodeAtCanvasCenter(page, lineageFixture.currentId);

    const historyControl = page.locator(`#nodeDetailOverlay.open .node-detail-relation[data-relation-kind="history"][data-related-node-id="${lineageFixture.historyId}"]`);
    const oppositionControl = page.locator(`#nodeDetailOverlay.open .node-detail-relation[data-relation-kind="opposition"][data-related-node-id="${lineageFixture.oppositionId}"]`);
    assert.equal(await historyControl.count(), 1, 'current detail must expose directly connected gray rank 1');
    assert.equal(await oppositionControl.count(), 1, 'current detail must expose directly connected red rank 1');
    assert.equal(await detail.locator(`[data-related-node-id="${lineageFixture.historyOlderId}"]`).count(), 0, 'current detail must not jump across the gray rank-1 line to rank 2');
    assert.equal(await detail.locator(`[data-related-node-id="${lineageFixture.oppositionOlderId}"]`).count(), 0, 'current detail must not jump across the red rank-1 line to rank 2');

    const lineageColors = await page.evaluate(({ historyId, oppositionId }) => {
      const root = document.querySelector('#nodeDetailOverlay.open');
      const history = root?.querySelector(`[data-related-node-id="${historyId}"]`);
      const opposition = root?.querySelector(`[data-related-node-id="${oppositionId}"]`);
      return {
        history: history ? getComputedStyle(history).getPropertyValue('--relation-node-color').trim().toUpperCase() : null,
        opposition: opposition ? getComputedStyle(opposition).getPropertyValue('--relation-node-color').trim().toUpperCase() : null,
      };
    }, lineageFixture);
    assert.equal(lineageColors.history, '#8A949E', 'gray history button text must match the gray history ball');
    assert.equal(lineageColors.opposition, '#EE5B63', 'red opposition button text must match the red opposition ball');

    const afterLineageDetail = await page.evaluate(({ historyId, historyOlderId, oppositionId, oppositionOlderId }) => ({
      visibleEdges: window.__debug.scene.getVisibleEdgeCount(),
      historyPoint: window.__debug.scene.screenPositionForNode(historyId),
      historyOlderPoint: window.__debug.scene.screenPositionForNode(historyOlderId),
      oppositionPoint: window.__debug.scene.screenPositionForNode(oppositionId),
      oppositionOlderPoint: window.__debug.scene.screenPositionForNode(oppositionOlderId),
    }), lineageFixture);
    assert.ok(afterLineageDetail.historyPoint, 'opening current detail must render directly connected gray rank 1');
    assert.equal(afterLineageDetail.historyOlderPoint, null, 'opening current detail must keep non-neighbour gray rank 2 hidden');
    assert.ok(afterLineageDetail.oppositionPoint, 'opening current detail must render directly connected red rank 1');
    assert.equal(afterLineageDetail.oppositionOlderPoint, null, 'opening current detail must keep non-neighbour red rank 2 hidden');
    assert.ok(afterLineageDetail.visibleEdges >= beforeLineageDetail.visibleEdges + 2, 'opening detail must show the two direct gray/red lineage edges with their balls');

    // One gray-neighbour button tap moves the real gray rank-1 ball to centre and
    // naturally unfolds its next direct gray neighbour (rank 2), without exposing
    // unrelated red history.
    await historyControl.tap();
    await page.waitForFunction(
      id => document.querySelector('#nodeDetailOverlay.open')?.getAttribute('data-node-id') === id,
      lineageFixture.historyId,
      { timeout: 5_000 },
    );
    await waitForNodeAtCanvasCenter(page, lineageFixture.historyId);
    await page.waitForFunction(
      ({ historyOlderId, oppositionId }) => Boolean(window.__debug.scene.screenPositionForNode(historyOlderId))
        && window.__debug.scene.screenPositionForNode(oppositionId) === null,
      lineageFixture,
      { timeout: 5_000 },
    );
    const grayStepNeighbours = await detail.locator('[data-related-node-id]').evaluateAll(elements => elements.map(element => element.dataset.relatedNodeId));
    assert.ok(grayStepNeighbours.includes(lineageFixture.currentId), 'gray rank 1 must keep its direct line back to current as a button');
    assert.ok(grayStepNeighbours.includes(lineageFixture.historyOlderId), 'gray rank 1 must naturally unfold directly connected gray rank 2');
    assert.ok(!grayStepNeighbours.includes(lineageFixture.oppositionId), 'gray rank 1 detail must not expose unrelated red rank 1');

    await page.locator('#nodeDetailOverlay .node-detail-close').tap();
    await page.waitForFunction(() => !document.querySelector('#nodeDetailOverlay.open'), null, { timeout: 5_000 });
    await page.waitForFunction(
      ({ historyId, historyOlderId, oppositionId, oppositionOlderId }) => window.__debug.scene.screenPositionForNode(historyId) === null
        && window.__debug.scene.screenPositionForNode(historyOlderId) === null
        && window.__debug.scene.screenPositionForNode(oppositionId) === null
        && window.__debug.scene.screenPositionForNode(oppositionOlderId) === null,
      lineageFixture,
      { timeout: 5_000 },
    );

    assert.deepEqual(pageErrors, [], `canonical one-hop detail navigation produced page errors:\n${pageErrors.join('\n')}`);
    console.log(`One-hop local knowledge navigation browser regression passed: readable colour-matched symmetric labels + real white button + fixed-geometry canvas navigation/occlusion + progressive gray/red lineage around ${candidate.id}`);
  } finally {
    await browser.close();
  }
} finally {
  server.kill('SIGTERM');
}
