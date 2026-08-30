import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const target = process.argv[2];
const expectedBuild = process.argv[3];
const configuredSupabaseUrl = process.argv[4];
if (!target || !expectedBuild || !configuredSupabaseUrl) {
  throw new Error('Usage: node scripts/verify-production-browser-zero-write.mjs <deployed-url> <expected-build> <supabase-url>');
}

const expectedSupabaseOrigin = new URL(configuredSupabaseUrl).origin;
const testUserId = '00000000-0000-4000-8000-000000000001';
const fakeSession = {
  access_token: 'ci-zero-write-access-token',
  refresh_token: 'ci-zero-write-refresh-token',
  expires_in: 3600,
  token_type: 'bearer',
  user: { id: testUserId, is_anonymous: true },
};
const fakeAccount = {
  username: null,
  display_name: null,
  avatar_url: null,
  bio: null,
  password_login_enabled: false,
  my_balance: '0.000000',
  total_energy: '0.000000',
  accuracy: 0,
};

function jsonResponse(value, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(value) };
}

const browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader'] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const pageErrors = [];
  const unexpectedSupabaseRequests = [];
  const interceptedSupabaseRequests = [];

  page.on('pageerror', error => pageErrors.push(error.message));

  await page.route('**/*.supabase.co/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const signature = `${request.method()} ${url.pathname}${url.search}`;
    interceptedSupabaseRequests.push(signature);

    assert.equal(url.origin, expectedSupabaseOrigin, `deployed bundle contacted unexpected Supabase project: ${url.origin}`);

    if (url.pathname === '/auth/v1/signup' && request.method() === 'POST') {
      await route.fulfill(jsonResponse(fakeSession));
      return;
    }
    if (url.pathname === '/auth/v1/token' && request.method() === 'POST') {
      await route.fulfill(jsonResponse(fakeSession));
      return;
    }
    if (url.pathname === '/auth/v1/user' && request.method() === 'GET') {
      await route.fulfill(jsonResponse({ id: testUserId, is_anonymous: true }));
      return;
    }
    if (url.pathname === '/rest/v1/public_knowledge_events' && request.method() === 'GET') {
      await route.fulfill(jsonResponse([]));
      return;
    }
    if (url.pathname === '/rest/v1/rpc/get_public_contributor_profiles' && request.method() === 'POST') {
      await route.fulfill(jsonResponse([]));
      return;
    }
    if (url.pathname === '/rest/v1/rpc/ensure_anonymous_profile' && request.method() === 'POST') {
      await route.fulfill(jsonResponse({}));
      return;
    }
    if (url.pathname === '/rest/v1/rpc/get_my_account' && request.method() === 'POST') {
      await route.fulfill(jsonResponse(fakeAccount));
      return;
    }
    if (url.pathname === '/rest/v1/rpc/get_my_personal_knowledge_states' && request.method() === 'POST') {
      await route.fulfill(jsonResponse([]));
      return;
    }
    if (
      (url.pathname === '/rest/v1/rpc/settle_expired_pending_knowledge_votes'
        || url.pathname === '/rest/v1/rpc/settle_expired_knowledge_revalidations')
      && request.method() === 'POST'
    ) {
      await route.fulfill(jsonResponse(0));
      return;
    }

    unexpectedSupabaseRequests.push(signature);
    await route.fulfill(jsonResponse({ error: 'CI zero-write gate blocked an unexpected Supabase request' }, 599));
  });

  const url = new URL(target);
  url.searchParams.set('kb_zero_write_gate', `${expectedBuild}-${Date.now()}`);
  await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 });

  const button = page.locator('#btnPersonal');
  await button.waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('#aiInput').waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForFunction(
    () => document.querySelector('#btnPersonal')?.getAttribute('data-visibility-mode') === 'current'
      && window.__debug?.interaction?.getVisibilityMode?.() === 'current',
    null,
    { timeout: 20_000 },
  );

  const build = await page.evaluate(() => document.querySelector('meta[name="knowledge-ball-build"]')?.getAttribute('content') ?? null);
  assert.equal(build, expectedBuild, `deployed Pages artifact identity mismatch: expected ${expectedBuild}, got ${build ?? 'missing'}`);
  assert.equal(await button.count(), 1, 'deployed page must contain exactly one visibility control');

  const readState = async () => page.evaluate(() => ({
    text: document.querySelector('#btnPersonal')?.textContent?.trim() ?? '',
    mode: document.querySelector('#btnPersonal')?.getAttribute('data-visibility-mode') ?? '',
    controllerMode: window.__debug?.interaction?.getVisibilityMode?.() ?? null,
  }));
  const touch = async expectedMode => {
    const box = await button.boundingBox();
    assert.ok(box && box.width > 0 && box.height > 0, 'deployed visibility control must expose a real touch target');
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForFunction(
      mode => document.querySelector('#btnPersonal')?.getAttribute('data-visibility-mode') === mode
        && window.__debug?.interaction?.getVisibilityMode?.() === mode,
      expectedMode,
      { timeout: 5_000 },
    );
  };

  assert.deepEqual(await readState(), { text: '当前', mode: 'current', controllerMode: 'current' });
  await touch('personal');
  assert.deepEqual(await readState(), { text: '个人', mode: 'personal', controllerMode: 'personal' });
  await touch('all');
  assert.deepEqual(await readState(), { text: '全部', mode: 'all', controllerMode: 'all' });
  await touch('current');
  assert.deepEqual(await readState(), { text: '当前', mode: 'current', controllerMode: 'current' });

  assert.ok(interceptedSupabaseRequests.some(item => item.startsWith('POST /auth/v1/signup')), 'deployed app did not exercise its configured Supabase auth bootstrap');
  assert.ok(interceptedSupabaseRequests.some(item => item.startsWith('GET /rest/v1/public_knowledge_events')), 'deployed app did not exercise its configured public-event pull');
  assert.deepEqual(unexpectedSupabaseRequests, [], `unexpected Supabase requests were blocked:\n${unexpectedSupabaseRequests.join('\n')}`);
  assert.deepEqual(pageErrors, [], `deployed zero-write flow produced page errors:\n${pageErrors.join('\n')}`);

  console.log(`Zero-write deployed Pages browser gate passed for ${expectedBuild}`);
  console.log(`Supabase project wiring: ${expectedSupabaseOrigin}; intercepted requests: ${interceptedSupabaseRequests.length}; external Supabase requests: 0`);
  console.log('Visibility touch cycle: Current -> Personal -> All -> Current');
} finally {
  await browser.close();
}
