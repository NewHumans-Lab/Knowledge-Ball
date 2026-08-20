import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const target = process.argv[2];
if (!target) throw new Error('Usage: node scripts/verify-production-browser.mjs <deployed-url>');

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

  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.locator('#aiInput').waitFor({ state: 'visible', timeout: 20_000 });
  assert.equal(await page.locator('.ai-add').count(), 0, 'search bar must not expose the old add-node button');
  await page.waitForTimeout(8_000);

  const diagnostics = await page.evaluate(() => {
    const debug = window.__debug;
    const engine = debug?.syncEngine;
    return {
      datasetSyncStatus: document.documentElement.dataset.syncStatus ?? null,
      debugPresent: Boolean(debug),
      syncEnginePresent: Boolean(engine),
      engineStatus: typeof engine?.currentStatus === 'function' ? engine.currentStatus() : null,
      cursor: typeof engine?.currentCursor === 'function' ? engine.currentCursor() : null,
      pendingCount: typeof engine?.pendingCount === 'function' ? engine.pendingCount() : null,
      nodeCount: Object.keys(debug?.projection?.state?.nodesById ?? {}).length,
      modalClass: document.querySelector('#modalOverlay')?.className ?? null,
    };
  });

  console.log('Production browser diagnostics:');
  console.log(JSON.stringify({ ...diagnostics, signupStatus, publicEventsStatus, supabaseRequests, networkFailures, pageErrors, consoleMessages }, null, 2));

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
    debug?.scene?.stop?.();
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
  if (await personal.count()) { await personal.click(); await personal.click(); }

  assert.deepEqual(publicAppendRequests, [], 'production smoke test must never call the public knowledge append RPC');

  console.log(`Read-only production browser smoke test passed: ${target}`);
  console.log(`Supabase signup: ${signupStatus}; public event pull: ${publicEventsStatus}; authoritative public writes: 0`);
} finally {
  await browser.close();
}
