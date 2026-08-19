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
  const networkFailures = [];
  let signupStatus = null;
  let publicEventsStatus = null;

  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => consoleMessages.push(`${message.type()}: ${message.text()}`));
  page.on('request', request => {
    const url = request.url();
    if (url.includes('supabase.co')) supabaseRequests.push(`${request.method()} ${url}`);
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
  await page.locator('.ai-add').waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForTimeout(8_000);

  const diagnostics = await page.evaluate(() => {
    const debug = window.__debug;
    const engine = debug?.syncEngine;
    return {
      datasetSyncStatus: document.documentElement.dataset.syncStatus ?? null,
      debugPresent: Boolean(debug),
      syncEnginePresent: Boolean(engine),
      engineStatus: typeof engine?.currentStatus === 'function' ? engine.currentStatus() : null,
      pendingCount: typeof engine?.pendingCount === 'function' ? engine.pendingCount() : null,
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

  const tappable = await page.evaluate(() => {
    const debug = window.__debug;
    debug?.scene?.stop?.();
    const node = debug?.renderNodes?.find(candidate => !['n1','n2','n16'].includes(candidate.id)) ?? debug?.renderNodes?.[0];
    const point = node ? debug?.scene?.screenPositionForNode?.(node.id) : null;
    return point && node ? { ...point, id: node.id, title: node.title } : null;
  });
  assert.ok(tappable, 'scene did not expose a finite tappable node position');
  assert.ok(Number.isFinite(tappable.x) && Number.isFinite(tappable.y), 'mobile raycast target coordinates must be finite');

  // Open the second independent client BEFORE the write. It must converge while
  // already open; startup hydration after the write is not sufficient proof.
  const secondContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  try {
    const secondPage = await secondContext.newPage();
    await secondPage.goto(target, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await secondPage.waitForFunction(() => window.__debug?.syncEngine?.currentStatus?.() === 'idle', null, { timeout: 20_000 });
    const secondCursorBeforeWrite = await secondPage.evaluate(() => window.__debug?.syncEngine?.currentCursor?.() ?? null);

    const marker = `E2E ${new URL(target).searchParams.get('e2e') ?? Date.now()} ${crypto.randomUUID()}`;
    await page.locator('.ai-add').click();
    await page.locator('#fTitle').fill(marker);
    await page.locator('#fType').selectOption('inner');
    await page.locator('#fDescription').fill(`Public synchronization probe for ${marker}`);
    await page.locator('#modalSubmit').click();
    await page.waitForFunction(() => !document.querySelector('#modalOverlay')?.classList.contains('show'), null, { timeout: 5_000 });
    await page.waitForFunction(title => Object.values(window.__debug?.projection?.state?.nodesById ?? {}).some(node => node.title === title), marker);
    const created = await page.evaluate(title => Object.values(window.__debug?.projection?.state?.nodesById ?? {}).find(node => node.title === title), marker);
    assert.equal(created?.declaredLayer, 'inner', 'public create event must preserve the user-declared first layer');
    await page.waitForFunction(() => window.__debug?.syncEngine?.pendingCount?.() === 0 && window.__debug?.syncEngine?.currentStatus?.() === 'idle', null, { timeout: 20_000 });

    // Do not reload secondPage and do not call its debug sync method.
    await secondPage.waitForFunction(
      title => Object.values(window.__debug?.projection?.state?.nodesById ?? {}).filter(node => node.title === title).length === 1,
      marker,
      { timeout: 25_000 },
    );
    const remoteCreated = await secondPage.evaluate(title => Object.values(window.__debug?.projection?.state?.nodesById ?? {}).find(node => node.title === title), marker);
    assert.equal(remoteCreated?.id, created?.id, 'already-open second client must receive the same authoritative node identity');
    assert.equal(remoteCreated?.declaredLayer, 'inner', 'already-open second client must receive the same declared layer automatically');
    const secondCursorAfterWrite = await secondPage.evaluate(() => window.__debug?.syncEngine?.currentCursor?.() ?? null);
    assert.notEqual(secondCursorAfterWrite, secondCursorBeforeWrite, 'already-open second client cursor must advance automatically after the remote write');

    // Refresh reconstructs from cloud and must not duplicate the authoritative event.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(title => Object.values(window.__debug?.projection?.state?.nodesById ?? {}).filter(node => node.title === title).length === 1, marker);
    assert.equal(await page.evaluate(title => Object.values(window.__debug?.projection?.state?.nodesById ?? {}).filter(node => node.title === title).length, marker), 1);

    await page.locator('.ai-add').click();
    await page.locator('#modalOverlay.show').waitFor({ state: 'visible', timeout: 5_000 });
    await page.locator('#modalCancel').click();
    await page.waitForFunction(() => !document.querySelector('#modalOverlay')?.classList.contains('show'));

    const personal = page.locator('#btnPersonal');
    if (await personal.count()) { await personal.click(); await personal.click(); }

    console.log(`Production browser smoke test passed: ${target}`);
    console.log(`Supabase signup: ${signupStatus}; public event pull: ${publicEventsStatus}; real UI create + already-open second-client convergence: passed`);
  } finally { await secondContext.close(); }
} finally {
  await browser.close();
}
