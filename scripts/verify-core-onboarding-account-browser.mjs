import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const port = 4178;
const origin = `http://127.0.0.1:${port}/Knowledge-Ball/`;
const supabaseOrigin = 'http://supabase.test';
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  {
    stdio: 'ignore',
    env: {
      ...process.env,
      VITE_SUPABASE_URL: supabaseOrigin,
      VITE_SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key',
    },
  },
);

const remoteStatus = new Map();
let registered = false;
let onboardingWrites = 0;

function base64url(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function tokenFor(userId) {
  return `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url({ sub: userId, role: 'authenticated' })}.test`;
}

function sessionFor(userId) {
  return {
    access_token: tokenFor(userId),
    refresh_token: `refresh-${userId}`,
    expires_in: 3600,
  };
}

function userIdFromRequest(request) {
  const authorization = request.headers().authorization ?? '';
  const token = authorization.replace(/^Bearer\s+/i, '');
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).sub ?? null;
  } catch {
    return null;
  }
}

function accountFor(userId) {
  return {
    username: userId === 'account-a' && registered ? 'account_a' : `guest_${userId.replace(/[^a-z0-9]/gi, '').slice(0, 8)}`,
    display_name: null,
    avatar_url: null,
    bio: null,
    password_login_enabled: userId === 'account-a' && registered,
    core_onboarding_status: remoteStatus.get(userId) ?? null,
    my_balance: '0.000000',
    total_energy: '0.000000',
    accuracy: 0,
  };
}

function json(value, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(value) };
}

async function installSupabaseMock(context, signupUserId) {
  await context.route(`${supabaseOrigin}/**`, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path === '/auth/v1/signup' && request.method() === 'POST') {
      await route.fulfill(json(sessionFor(signupUserId)));
      return;
    }

    if (path === '/auth/v1/token' && request.method() === 'POST') {
      await route.fulfill(json(sessionFor(signupUserId)));
      return;
    }

    if (path === '/auth/v1/user') {
      await route.fulfill(json({ id: userIdFromRequest(request) ?? signupUserId }));
      return;
    }

    if (path === '/functions/v1/username-password-auth' && request.method() === 'POST') {
      const body = request.postDataJSON();
      if (body.action === 'claim') {
        registered = true;
        await route.fulfill(json({ session: sessionFor('account-a') }));
        return;
      }
      if (body.action === 'login') {
        assert.equal(body.username, 'account_a');
        assert.equal(body.password, 'test-password');
        assert.equal(registered, true, 'device A must register the account before device B logs in');
        await route.fulfill(json({ session: sessionFor('account-a') }));
        return;
      }
      await route.fulfill(json({ error: 'unsupported auth action' }, 400));
      return;
    }

    const userId = userIdFromRequest(request) ?? signupUserId;
    if (path === '/rest/v1/rpc/ensure_anonymous_profile' && request.method() === 'POST') {
      await route.fulfill(json(accountFor(userId)));
      return;
    }
    if (path === '/rest/v1/rpc/get_my_account' && request.method() === 'POST') {
      await route.fulfill(json(accountFor(userId)));
      return;
    }
    if (path === '/rest/v1/rpc/set_core_onboarding_status' && request.method() === 'POST') {
      const body = request.postDataJSON();
      assert.ok(body.new_status === 'completed' || body.new_status === 'skipped', 'account RPC must receive a final status only');
      if (!remoteStatus.has(userId)) remoteStatus.set(userId, body.new_status);
      onboardingWrites += 1;
      await route.fulfill(json(accountFor(userId)));
      return;
    }
    if (path === '/rest/v1/rpc/get_my_personal_knowledge_states') {
      await route.fulfill(json([]));
      return;
    }
    if (path === '/rest/v1/rpc/merge_my_personal_knowledge_states') {
      await route.fulfill(json({ processed: 0 }));
      return;
    }
    if (path.includes('settle_expired')) {
      await route.fulfill(json(0));
      return;
    }

    // The rest of the product is not under test here. Keep its cloud reads empty
    // so bootstrap can fall back to the normal demo graph while account behavior
    // is exercised against deterministic mocked Supabase endpoints.
    if (request.method() === 'GET') {
      await route.fulfill(json([]));
      return;
    }
    await route.fulfill(json({}));
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Vite dev server exited with code ${server.exitCode}`);
    try {
      if ((await fetch(origin)).ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Vite dev server did not become ready');
}

try {
  await waitForServer();
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader'] });
  try {
    const mobile = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };

    // Device A starts as a genuinely fresh anonymous identity. It skips the guide,
    // then claims a permanent username/password account without changing auth.uid().
    const deviceA = await browser.newContext(mobile);
    await installSupabaseMock(deviceA, 'account-a');
    const pageA = await deviceA.newPage();
    pageA.setDefaultTimeout(15_000);
    await pageA.goto(origin, { waitUntil: 'domcontentloaded' });
    await pageA.locator('.kb-core-onboarding[data-step="zoom"]').waitFor({ state: 'visible' });
    await pageA.locator('.kb-core-onboarding-skip').click();
    await pageA.waitForFunction(() => localStorage.getItem('knowledge-ball.core-onboarding.v1') === 'skipped');
    for (let attempt = 0; attempt < 100 && remoteStatus.get('account-a') !== 'skipped'; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(remoteStatus.get('account-a'), 'skipped', 'device A Skip must persist to the account profile');
    assert.equal(
      await pageA.evaluate(() => localStorage.getItem('knowledge-ball.core-onboarding-owner.v1')),
      'account-a',
      'device A local final state must be owned by its immutable auth.uid()',
    );

    await pageA.locator('.avatar-btn').click();
    await pageA.locator('#kbAuthEntry').click();
    await pageA.locator('[data-auth-mode="register"]').click();
    await pageA.locator('input[name="username"]').fill('account_a');
    await pageA.locator('input[name="password"]').fill('test-password');
    await pageA.locator('input[name="passwordConfirm"]').fill('test-password');
    await pageA.locator('#kbAuthForm').evaluate(form => form.requestSubmit());
    await pageA.waitForFunction(() => document.querySelector('#kbAccountStatus')?.textContent?.includes('注册成功'));
    assert.equal(registered, true, 'device A must claim the permanent account in place');
    await deviceA.close();

    // Device B is a completely new installation. Its temporary anonymous identity
    // initially receives the guide. Logging into account A must pull the cloud final
    // state and close/suppress the guide without manually pressing Skip again.
    const deviceB = await browser.newContext(mobile);
    await installSupabaseMock(deviceB, 'anonymous-b');
    const pageB = await deviceB.newPage();
    pageB.setDefaultTimeout(15_000);
    await pageB.goto(origin, { waitUntil: 'domcontentloaded' });
    const guideB = pageB.locator('.kb-core-onboarding[data-step="zoom"]');
    await guideB.waitFor({ state: 'visible' });

    await pageB.locator('.avatar-btn').click();
    await pageB.locator('#kbAuthEntry').click();
    await pageB.locator('input[name="username"]').fill('account_a');
    await pageB.locator('input[name="password"]').fill('test-password');
    await pageB.locator('#kbAuthForm').evaluate(form => form.requestSubmit());
    await guideB.waitFor({ state: 'detached' });

    assert.equal(
      await pageB.evaluate(() => localStorage.getItem('knowledge-ball.core-onboarding.v1')),
      'skipped',
      'device B must cache the final account state after login',
    );
    assert.equal(
      await pageB.evaluate(() => localStorage.getItem('knowledge-ball.core-onboarding-owner.v1')),
      'account-a',
      'device B local marker must switch to the logged-in account identity',
    );
    await pageB.reload({ waitUntil: 'domcontentloaded' });
    await pageB.waitForTimeout(750);
    assert.equal(await pageB.locator('.kb-core-onboarding').count(), 0, 'same account on device B must remain permanently suppressed after reload');
    assert.ok(onboardingWrites >= 1, 'the dedicated onboarding account RPC must be exercised');
    await deviceB.close();

    console.log('Cross-device account onboarding browser acceptance passed');
  } finally {
    await browser.close();
  }
} finally {
  server.kill('SIGTERM');
}
