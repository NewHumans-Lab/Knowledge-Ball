import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const target = process.argv[2];
if (!target) throw new Error('Usage: node scripts/verify-production-browser.mjs <deployed-url>');

const browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader'] });

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();

  const pageErrors = [];
  const networkFailures = [];
  let signupStatus = null;
  let publicEventsStatus = null;

  page.on('pageerror', error => pageErrors.push(error.message));
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
  await page.waitForFunction(
    () => document.documentElement.dataset.syncStatus === 'idle' || document.documentElement.dataset.syncStatus === 'conflict',
    null,
    { timeout: 20_000 },
  );
  await page.waitForTimeout(1_000);

  assert.equal(signupStatus, 200, `anonymous Supabase signup did not succeed (status: ${signupStatus})`);
  assert.equal(publicEventsStatus, 200, `public event pull did not succeed (status: ${publicEventsStatus})`);
  assert.deepEqual(networkFailures, [], `Supabase network failures:\n${networkFailures.join('\n')}`);
  assert.deepEqual(pageErrors, [], `browser page errors:\n${pageErrors.join('\n')}`);

  await page.locator('.ai-add').click();
  await page.locator('#modalOverlay.show').waitFor({ state: 'visible', timeout: 5_000 });
  await page.locator('#modalCancel').click();
  await page.waitForFunction(() => !document.querySelector('#modalOverlay')?.classList.contains('show'));

  const personal = page.locator('#btnPersonal');
  if (await personal.count()) {
    await personal.click();
    await personal.click();
  }

  console.log(`Production browser smoke test passed: ${target}`);
  console.log(`Supabase signup: ${signupStatus}; public event pull: ${publicEventsStatus}; UI clicks: passed`);
} finally {
  await browser.close();
}
