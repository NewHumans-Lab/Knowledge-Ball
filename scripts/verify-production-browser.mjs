import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const target = process.argv[2];
const expectedBuildCommit = process.argv[3] ?? null;
if (!target) throw new Error('Usage: node scripts/verify-production-browser.mjs <deployed-url> [expected-build-commit]');

const browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader'] });

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();

  const pageErrors = [];
  const consoleMessages = [];
  const supabaseRequests = [];
  const publicAppendRequests = [];
  const networkFailures = [];
  let signupStatus = null;
  let publicEventsStatus = null;

  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => consoleMessages.push(`${message.type()}: ${message.text()}`));
  page.on('request', request => {
    const url = request.url();
    if (url.includes('supabase.co')) supabaseRequests.push(`${request.method()} ${url}`);
    if (url.includes('/rest/v1/rpc/append_public_knowledge_events')) {
      publicAppendRequests.push(`${request.method()} ${url}`);
    }
  });
  page.on('requestfailed', request => {
    const url = request.url();
    if (url.includes('supabase.co')) networkFailures.push(`${request.method()} ${url}: ${request.failure()?.errorText ?? 'request failed'}`);
  });
  page.on('response', response => {
    const url = response.url();
    if (url.includes('/auth/v1/signup')) signupStatus = response.status();
    if (url.includes('/rest/v1/public_knowledge_events')) publicEventsStatus = response.status();
  });

  const verificationUrl = new URL(target);
  verificationUrl.searchParams.set('kb_verify', expectedBuildCommit ?? String(Date.now()));
  await page.goto(verificationUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.locator('#aiInput').waitFor({ state: 'visible', timeout: 20_000 });
  assert.equal(await page.locator('.ai-add').count(), 0, 'search bar must not expose the old add-node button');
  await page.waitForTimeout(8_000);

  const diagnostics = await page.evaluate(() => {
    const debug = window.__debug;
    const engine = debug?.syncEngine;
    const visibilityButton = document.querySelector('#btnPersonal');
    return {
      datasetSyncStatus: document.documentElement.dataset.syncStatus ?? null,
      debugPresent: Boolean(debug),
      syncEnginePresent: Boolean(engine),
      engineStatus: typeof engine?.currentStatus === 'function' ? engine.currentStatus() : null,
      cursor: typeof engine?.currentCursor === 'function' ? engine.currentCursor() : null,
      pendingCount: typeof engine?.pendingCount === 'function' ? engine.pendingCount() : null,
      nodeCount: Object.keys(debug?.projection?.state?.nodesById ?? {}).length,
      modalClass: document.querySelector('#modalOverlay')?.className ?? null,
      buildCommit: document.querySelector('meta[name="knowledge-ball-build"]')?.getAttribute('content') ?? null,
      visibilityText: visibilityButton?.textContent?.trim() ?? null,
      visibilityMode: visibilityButton?.dataset?.visibilityMode ?? null,
    };
  });

  console.log('Production browser diagnostics:');
  console.log(JSON.stringify({ ...diagnostics, signupStatus, publicEventsStatus, supabaseRequests, networkFailures, pageErrors, consoleMessages }, null, 2));

  if (expectedBuildCommit) {
    assert.equal(
      diagnostics.buildCommit,
      expectedBuildCommit,
      `deployed Pages artifact is stale or from the wrong commit (expected ${expectedBuildCommit}, got ${diagnostics.buildCommit ?? 'missing'})`,
    );
  }
  assert.equal(diagnostics.visibilityText, '当前', 'deployed header must boot in Current mode');
  assert.equal(diagnostics.visibilityMode, 'current', 'deployed header must expose Current as its canonical initial visibility mode');
  assert.ok(diagnostics.datasetSyncStatus === 'idle' || diagnostics.datasetSyncStatus === 'conflict', `hosted sync did not become usable (status: ${diagnostics.datasetSyncStatus ?? 'missing'})`);
  assert.equal(signupStatus, 200, `anonymous Supabase signup did not succeed (status: ${signupStatus})`);
  assert.equal(publicEventsStatus, 200, `public event pull did not succeed (status: ${publicEventsStatus})`);
  assert.deepEqual(networkFailures, [], `Supabase network failures:\n${networkFailures.join('\n')}`);
  assert.deepEqual(pageErrors, [], `browser page errors:\n${pageErrors.join('\n')}`);
  assert.equal(diagnostics.pendingCount, 0, 'hosted startup must not enqueue demo events');
  assert.ok(diagnostics.nodeCount > 0, 'hosted public projection must contain knowledge nodes');
  assert.ok(diagnostics.cursor !== null, 'hosted public stream cursor must be available');

  const tappable = await page.evaluate(() => {
    const debug = window.__debug;
    const node = debug?.renderNodes?.find(candidate => !['n1','n2','n16'].includes(candidate.id)) ?? debug?.renderNodes?.[0];
    const point = node ? debug?.scene?.screenPositionForNode?.(node.id) : null;
    return point && node ? { ...point, id: node.id, title: node.title } : null;
  });
  assert.ok(tappable, 'scene did not expose a finite tappable node position');
  assert.ok(Number.isFinite(tappable.x) && Number.isFinite(tappable.y), 'mobile raycast target coordinates must be finite');

  // Production smoke tests are intentionally read-only with respect to the
  // authoritative public knowledge stream. Opening and cancelling the existing
  // keyboard create flow verifies the UI path without submitting anything.
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true, cancelable: true })));
  await page.locator('#modalOverlay.show').waitFor({ state: 'visible', timeout: 5_000 });
  await page.locator('#modalCancel').click();
  await page.waitForFunction(() => !document.querySelector('#modalOverlay')?.classList.contains('show'));

  const personal = page.locator('#btnPersonal');
  const assertVisibilityState = async (text, mode) => {
    const state = await personal.evaluate(button => ({
      text: button.textContent?.trim() ?? '',
      mode: button.dataset.visibilityMode ?? '',
    }));
    assert.equal(state.text, text, `visibility button text must be ${text}`);
    assert.equal(state.mode, mode, `visibility button mode must be ${mode}`);
  };

  assert.equal(await personal.count(), 1, 'deployed header must expose exactly one visibility-mode control');
  await assertVisibilityState('当前', 'current');
  await personal.click();
  await assertVisibilityState('个人', 'personal');
  await personal.click();
  await assertVisibilityState('全部', 'all');
  await personal.click();
  await assertVisibilityState('当前', 'current');

  // Hosted-data acceptance: prove that an actual Supabase-loaded conclusion and
  // its reasoning-process ball share one canonical scene/detail chain. One real
  // tap opens detail directly and must preserve the current graph orientation.
  const chainFixture = await page.evaluate(() => {
    const debug = window.__debug;
    const nodes = debug?.renderNodes ?? [];
    const byId = new Map(nodes.map(node => [node.id, node]));
    const core = new Set(['n1', 'n2', 'n16']);
    for (const node of nodes) {
      if (core.has(node.id) || node.hidden || node.type === 'reasoning' || node.type === 'logic-symbol') continue;
      const reasoning = node.premises?.map(id => byId.get(id)).find(previous => previous?.type === 'reasoning');
      if (!reasoning) continue;
      const point = debug.scene?.screenPositionForNode?.(node.id);
      if (!point || point.x <= 24 || point.x >= 366 || point.y <= 88 || point.y >= 808) continue;
      return { id: node.id, title: node.title, reasoningId: reasoning.id, reasoningTitle: reasoning.title, ...point };
    }
    return null;
  });
  assert.ok(chainFixture, 'hosted projection must expose an on-screen conclusion with a real reasoning-process predecessor');

  await page.touchscreen.tap(chainFixture.x, chainFixture.y);
  const detail = page.locator('#nodeDetailOverlay.open');
  await detail.waitFor({ state: 'visible', timeout: 5_000 });
  assert.equal(await detail.getAttribute('data-node-id'), chainFixture.id, 'first tap must open the hosted conclusion detail');
  const pointAfterOpen = await page.evaluate(id => window.__debug.scene.screenPositionForNode(id), chainFixture.id);
  assert.ok(pointAfterOpen, 'hosted conclusion must remain renderable after detail opens');
  assert.ok(Math.hypot(pointAfterOpen.x - chainFixture.x, pointAfterOpen.y - chainFixture.y) <= 3, 'hosted detail open must not rotate the graph');
  const previousReasoning = detail.locator(`.node-detail-relation[data-relation-kind="previous"][data-related-node-id="${chainFixture.reasoningId}"]`);
  assert.equal(await previousReasoning.count(), 1, 'hosted conclusion must expose its real reasoning-process ball on the left');
  const relationKinds = await detail.locator('.node-detail-relation[data-relation-kind]').evaluateAll(elements => elements.map(element => element.dataset.relationKind));
  assert.ok(relationKinds.every(kind => ['previous','next','history','opposition'].includes(kind)), 'deployed detail must not expose legacy premise/logic/twin relation kinds');

  await previousReasoning.tap();
  await page.waitForFunction(
    id => document.querySelector('#nodeDetailOverlay.open')?.getAttribute('data-node-id') === id,
    chainFixture.reasoningId,
    { timeout: 5_000 },
  );
  const reasoningShape = await page.evaluate(({ reasoningId, conclusionId }) => {
    const nodes = window.__debug.renderNodes;
    const reasoning = nodes.find(node => node.id === reasoningId);
    const root = document.querySelector('#nodeDetailOverlay.open');
    return {
      premiseIds: reasoning?.premises ?? [],
      previousIds: Array.from(root?.querySelectorAll('[data-relation-kind="previous"]') ?? []).map(element => element.dataset.relatedNodeId),
      nextIds: Array.from(root?.querySelectorAll('[data-relation-kind="next"]') ?? []).map(element => element.dataset.relatedNodeId),
      conclusionId,
    };
  }, { reasoningId: chainFixture.reasoningId, conclusionId: chainFixture.id });
  assert.ok(reasoningShape.premiseIds.length > 0, 'hosted reasoning-process ball must retain real premise nodes');
  assert.ok(reasoningShape.premiseIds.every(id => reasoningShape.previousIds.includes(id)), 'hosted reasoning left side must match its real premises');
  assert.ok(reasoningShape.nextIds.includes(chainFixture.id), 'hosted reasoning right side must contain its real conclusion');
  await page.locator('#nodeDetailOverlay .node-detail-close').click();

  assert.deepEqual(publicAppendRequests, [], 'production smoke test must never call the public knowledge append RPC');
  assert.deepEqual(pageErrors, [], `browser page errors after canonical-chain interaction:\n${pageErrors.join('\n')}`);

  console.log(`Read-only production browser smoke test passed: ${target}`);
  console.log(`Build commit: ${diagnostics.buildCommit ?? 'unknown'}; visibility cycle: current -> personal -> all -> current`);
  console.log(`Canonical hosted reasoning chain: ${chainFixture.reasoningId} -> ${chainFixture.id}`);
  console.log(`Supabase signup: ${signupStatus}; public event pull: ${publicEventsStatus}; authoritative public writes: 0`);
} finally {
  await browser.close();
}
