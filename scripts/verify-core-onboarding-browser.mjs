import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const origin = 'http://127.0.0.1:4177/Knowledge-Ball/';
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4177'],
  { stdio: 'ignore' },
);

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      if ((await fetch(origin)).ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Vite preview did not become ready');
}

async function assertTouchButton(locator, name) {
  await locator.waitFor({ state: 'visible' });
  const box = await locator.boundingBox();
  assert.ok(box, `${name} must have a real bounding box`);
  assert.ok(box.width >= 44 && box.height >= 44, `${name} must expose at least a 44px mobile touch target`);
}

async function assertSuppressedAfterReload(page, reason) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__debug?.scene && window.__debug?.renderNodes?.length), null, { timeout: 10_000 });
  await page.waitForTimeout(500);
  assert.equal(await page.locator('.kb-core-onboarding').count(), 0, reason);
}

try {
  await waitForServer();
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader'] });
  try {
    const mobile = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };

    // Fresh newcomer: the real rendered overlay must contain exactly the requested five steps.
    const completionContext = await browser.newContext(mobile);
    const completionPage = await completionContext.newPage();
    completionPage.setDefaultTimeout(10_000);
    await completionPage.goto(origin, { waitUntil: 'domcontentloaded' });
    const guide = completionPage.locator('.kb-core-onboarding');
    await guide.waitFor({ state: 'visible' });
    await assertTouchButton(completionPage.locator('.kb-core-onboarding-skip'), 'onboarding Skip');
    await assertTouchButton(completionPage.locator('.kb-core-onboarding-next'), 'onboarding Next');

    const expectedSteps = ['zoom', 'rotate', 'longpress', 'tap', 'voice'];
    for (let index = 0; index < expectedSteps.length; index += 1) {
      assert.equal(await guide.getAttribute('data-step'), expectedSteps[index], `step ${index + 1} must be ${expectedSteps[index]}`);
      assert.equal((await completionPage.locator('.kb-core-onboarding-progress').textContent())?.trim(), `${index + 1} / 5`, 'progress must match the five-step guide');
      await completionPage.locator('.kb-core-onboarding-next').click();
    }
    await guide.waitFor({ state: 'detached' });
    assert.equal(
      await completionPage.evaluate(() => localStorage.getItem('knowledge-ball.core-onboarding.v1')),
      'completed',
      'finishing the fifth step must persist permanent completion',
    );
    await assertSuppressedAfterReload(completionPage, 'completed onboarding must never auto-open again in the same installation');
    await completionContext.close();

    // Fresh newcomer who skips: skipping is final, not a temporary dismissal.
    const skipContext = await browser.newContext(mobile);
    const skipPage = await skipContext.newPage();
    skipPage.setDefaultTimeout(10_000);
    await skipPage.goto(origin, { waitUntil: 'domcontentloaded' });
    await skipPage.locator('.kb-core-onboarding[data-step="zoom"]').waitFor({ state: 'visible' });
    await skipPage.locator('.kb-core-onboarding-skip').click();
    assert.equal(
      await skipPage.evaluate(() => localStorage.getItem('knowledge-ball.core-onboarding.v1')),
      'skipped',
      'Skip must persist a final skipped state',
    );
    await assertSuppressedAfterReload(skipPage, 'skipped onboarding must never auto-open again in the same installation');
    await skipContext.close();

    // A browser with pre-existing Knowledge Ball usage is a returning user during rollout.
    const returningContext = await browser.newContext(mobile);
    await returningContext.addInitScript(() => {
      localStorage.setItem('knowledge-ball.personal-local-owner.v1', 'existing-user');
    });
    const returningPage = await returningContext.newPage();
    returningPage.setDefaultTimeout(10_000);
    await returningPage.goto(origin, { waitUntil: 'domcontentloaded' });
    await returningPage.waitForFunction(() => Boolean(window.__debug?.scene && window.__debug?.renderNodes?.length), null, { timeout: 10_000 });
    await returningPage.waitForTimeout(500);
    assert.equal(await returningPage.locator('.kb-core-onboarding').count(), 0, 'returning users must not receive rollout onboarding');
    assert.equal(
      await returningPage.evaluate(() => localStorage.getItem('knowledge-ball.core-onboarding.v1')),
      null,
      'suppressing a returning user must not rewrite their storage as if they completed a guide',
    );
    await returningContext.close();

    console.log('Newcomer core onboarding browser acceptance passed');
  } finally {
    await browser.close();
  }
} finally {
  server.kill('SIGTERM');
}
