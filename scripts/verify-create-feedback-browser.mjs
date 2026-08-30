import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const origin = 'http://127.0.0.1:4173/Knowledge-Ball/';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1'], { stdio: 'ignore' });

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(origin)).ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('preview server did not become ready');
}

async function assertToastAboveCreateOverlay(page, expectedText, label) {
  await page.waitForFunction(text => {
    const toast = document.querySelector('#toast');
    return Boolean(toast?.classList.contains('show') && toast.textContent?.includes(text));
  }, expectedText);
  await page.waitForFunction(() => Number.parseFloat(getComputedStyle(document.querySelector('#toast')).opacity) >= 0.95);

  const state = await page.evaluate(() => {
    const toast = document.querySelector('#toast');
    const overlay = document.querySelector('#knowledgeCreateOverlay');
    if (!(toast instanceof HTMLElement) || !(overlay instanceof HTMLElement)) return null;
    const toastStyle = getComputedStyle(toast);
    const overlayStyle = getComputedStyle(overlay);
    const rect = toast.getBoundingClientRect();
    return {
      text: toast.textContent ?? '',
      toastShown: toast.classList.contains('show'),
      overlayShown: overlay.classList.contains('show'),
      opacity: Number.parseFloat(toastStyle.opacity),
      visibility: toastStyle.visibility,
      display: toastStyle.display,
      toastZ: Number.parseInt(toastStyle.zIndex, 10),
      overlayZ: Number.parseInt(overlayStyle.zIndex, 10),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom },
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  });

  assert.ok(state, `${label}: toast and create overlay must exist`);
  assert.match(state.text, new RegExp(expectedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${label}: toast must carry the expected feedback`);
  assert.equal(state.toastShown, true, `${label}: toast must be in its shown state`);
  assert.equal(state.overlayShown, true, `${label}: create overlay must stay open while the user corrects the error`);
  assert.ok(state.opacity >= 0.95, `${label}: toast must be visually opaque enough to read (opacity=${state.opacity})`);
  assert.equal(state.visibility, 'visible', `${label}: toast visibility must remain visible`);
  assert.notEqual(state.display, 'none', `${label}: toast must participate in layout/painting`);
  assert.ok(Number.isFinite(state.toastZ) && Number.isFinite(state.overlayZ), `${label}: stacking levels must be numeric`);
  assert.ok(state.toastZ > state.overlayZ, `${label}: toast must paint above create overlay (toast=${state.toastZ}, overlay=${state.overlayZ})`);
  assert.ok(state.rect.width > 0 && state.rect.height > 0, `${label}: toast must have a real on-screen box`);
  assert.ok(state.rect.x >= 0 && state.rect.y >= 0, `${label}: toast must start inside the mobile viewport`);
  assert.ok(state.rect.right <= state.viewport.width && state.rect.bottom <= state.viewport.height, `${label}: toast must stay fully inside the mobile viewport`);
}

async function setLocalCommit(page) {
  await page.evaluate(() => {
    const debug = window.__debug;
    debug.syncEngine.commit = async event => debug.store.appendValidated(event);
  });
}

async function setGuestDeniedCommit(page) {
  await page.evaluate(() => {
    window.__debug.syncEngine.commit = async () => {
      throw new Error('游客必须注册后才能提交公共知识');
    };
  });
}

try {
  await waitForServer();
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader'] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.__debug?.projection?.state?.nodesById?.n3 && window.__debug?.knowledgeCreate && window.__debug?.syncEngine && window.__debug?.store));
    await setLocalCommit(page);
    await page.evaluate(() => window.__debug.scene.stop());

    const overlay = page.locator('#knowledgeCreateOverlay');
    const toast = page.locator('#toast');

    // 1. Client-side form validation must be readable while the new modal remains open.
    await page.evaluate(() => window.__debug.knowledgeCreate.openStandalone());
    await overlay.locator('[data-create-submit]').click();
    await assertToastAboveCreateOverlay(page, '请填写名称。', 'empty standalone form');

    await overlay.locator('[data-create-title]').fill('缺少内容的知识');
    await overlay.locator('[data-create-submit]').click();
    await assertToastAboveCreateOverlay(page, '请填写内容。', 'standalone missing content');
    assert.equal(await overlay.locator('[data-create-submit]').isEnabled(), true, 'validation failure must restore the submit button');
    await overlay.locator('[data-create-cancel]').click();
    await overlay.waitFor({ state: 'hidden' });

    // 2. Authoritative guest denial for standalone creation must not be hidden behind the modal.
    const beforeGuestStandalone = await page.evaluate(() => Object.keys(window.__debug.projection.state.nodesById).length);
    await page.evaluate(() => window.__debug.knowledgeCreate.openStandalone());
    await overlay.locator('[data-create-title]').fill('游客不能提交的知识');
    await overlay.locator('[data-create-layer]').selectOption('inner');
    await overlay.locator('[data-create-description]').fill('这个表单用于验证服务端拒绝后错误提示仍然肉眼可见。');
    await setGuestDeniedCommit(page);
    await overlay.locator('[data-create-submit]').click();
    await assertToastAboveCreateOverlay(page, '游客必须注册后才能提交公共知识', 'guest standalone rejection');
    assert.equal(await page.evaluate(() => Object.keys(window.__debug.projection.state.nodesById).length), beforeGuestStandalone, 'guest standalone rejection must not create a node');
    assert.equal(await overlay.locator('[data-create-title]').inputValue(), '游客不能提交的知识', 'guest rejection must preserve user input');
    assert.equal(await overlay.locator('[data-create-submit]').isEnabled(), true, 'guest rejection must restore the submit button');
    await overlay.locator('[data-create-cancel]').click();
    await overlay.waitFor({ state: 'hidden' });

    // Create one deterministic conclusion through the real application path for the reasoning checks below.
    await setLocalCommit(page);
    const conclusionTitle = '反馈验收结论';
    await page.evaluate(() => window.__debug.knowledgeCreate.openStandalone());
    await overlay.locator('[data-create-title]').fill(conclusionTitle);
    await overlay.locator('[data-create-layer]').selectOption('middle');
    await overlay.locator('[data-create-description]').fill('这是反馈可见性测试使用的已有结论球。');
    await overlay.locator('[data-create-submit]').click();
    await overlay.waitFor({ state: 'hidden' });
    const conclusionId = await page.evaluate(title => Object.values(window.__debug.projection.state.nodesById).find(node => node.title === title)?.id ?? null, conclusionTitle);
    assert.ok(conclusionId, 'reasoning feedback fixture conclusion must be created');

    // 3. Authoritative guest denial for reasoning creation must also stay above the same modal.
    await page.evaluate(() => window.__debug.knowledgeCreate.openReasoning('n3'));
    await overlay.waitFor({ state: 'visible' });
    const conclusionPicker = overlay.locator('[data-picker="conclusion"]');
    await conclusionPicker.locator('[data-picker-search]').fill(conclusionTitle);
    await conclusionPicker.locator(`[data-picker-options] [data-picker-node-id="${conclusionId}"]`).click();
    await overlay.locator('[data-create-title]').fill('游客不能提交的推理');
    await overlay.locator('[data-create-reasoning]').fill('前提和结论都有效，但游客身份必须被权威写入边界拒绝。');
    const beforeGuestReasoning = await page.evaluate(() => Object.keys(window.__debug.projection.state.nodesById).length);
    await setGuestDeniedCommit(page);
    await overlay.locator('[data-create-submit]').click();
    await assertToastAboveCreateOverlay(page, '游客必须注册后才能提交公共知识', 'guest reasoning rejection');
    assert.equal(await page.evaluate(() => Object.keys(window.__debug.projection.state.nodesById).length), beforeGuestReasoning, 'guest reasoning rejection must not create a reasoning ball');
    assert.equal(await overlay.locator('[data-create-title]').inputValue(), '游客不能提交的推理', 'guest reasoning rejection must preserve user input');
    assert.equal(await overlay.locator('[data-create-submit]').isEnabled(), true, 'guest reasoning rejection must restore the submit button');

    // Restore the local authoritative boundary and submit the same valid reasoning once.
    await setLocalCommit(page);
    const acceptedReasoningTitle = '反馈验收已有推理';
    await overlay.locator('[data-create-title]').fill(acceptedReasoningTitle);
    await overlay.locator('[data-create-submit]').click();
    await overlay.waitFor({ state: 'hidden' });
    const acceptedReasoning = await page.evaluate(title => Object.values(window.__debug.projection.state.nodesById).find(node => node.title === title) ?? null, acceptedReasoningTitle);
    assert.ok(acceptedReasoning, 'fixture reasoning must be accepted before duplicate verification');
    assert.equal(acceptedReasoning.type, 'reasoning', 'accepted fixture must be a reasoning node');

    // 4. Duplicate reasoning already has the correct domain error; now prove that feedback is actually visible.
    await page.evaluate(() => window.__debug.knowledgeCreate.openReasoning('n3'));
    await overlay.waitFor({ state: 'visible' });
    const duplicateConclusionPicker = overlay.locator('[data-picker="conclusion"]');
    await duplicateConclusionPicker.locator('[data-picker-search]').fill(conclusionTitle);
    await duplicateConclusionPicker.locator(`[data-picker-options] [data-picker-node-id="${conclusionId}"]`).click();
    await overlay.locator('[data-create-title]').fill('不同名字也不能绕过重复推理');
    await overlay.locator('[data-create-reasoning]').fill('文本不同，但前提主题集合与具体结论球和已有推理完全相同。');
    const beforeDuplicate = await page.evaluate(() => Object.keys(window.__debug.projection.state.nodesById).length);
    await overlay.locator('[data-create-submit]').click();
    await assertToastAboveCreateOverlay(page, '推理节点已存在', 'duplicate reasoning rejection');
    assert.match((await toast.textContent()) ?? '', /推理节点已存在：反馈验收已有推理/, 'duplicate feedback must identify the existing reasoning node');
    assert.equal(await page.evaluate(() => Object.keys(window.__debug.projection.state.nodesById).length), beforeDuplicate, 'duplicate reasoning must not create another node');
    assert.equal(await overlay.locator('[data-create-title]').inputValue(), '不同名字也不能绕过重复推理', 'duplicate rejection must preserve the corrected form state');
    assert.equal(await overlay.locator('[data-create-submit]').isEnabled(), true, 'duplicate rejection must restore the submit button');

    assert.deepEqual(pageErrors, [], `create-feedback browser acceptance must not emit page errors: ${pageErrors.join(' | ')}`);
    console.log('Create-form validation, guest rejection, and duplicate-reasoning feedback visibility passed');
  } finally {
    await browser.close();
  }
} finally {
  server.kill('SIGTERM');
}
