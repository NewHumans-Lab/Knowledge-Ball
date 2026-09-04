import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { _electron as electron, chromium } from 'playwright-core';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const windowsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(windowsRoot, '..');
const executable = process.argv[2] ?? path.join(windowsRoot, 'release', 'win-unpacked', 'Knowledge Ball.exe');
const artifacts = path.join(windowsRoot, 'artifacts');
const webReferenceUrl = 'http://127.0.0.1:4174/Knowledge-Ball/';
await mkdir(artifacts, { recursive: true });

async function deterministic(page) {
  await page.waitForFunction(() => Boolean(window.__debug?.scene && window.__debug?.renderNodes?.length), null, { timeout: 30_000 });
  // Newcomer onboarding has its own browser acceptance. Runtime parity must
  // compare the same stable returning-user state on Electron and Web instead
  // of comparing an already-used desktop session with a fresh Web newcomer.
  await page.evaluate(() => {
    localStorage.setItem('knowledge-ball.core-onboarding.v1', 'skipped');
    localStorage.setItem('knowledge-ball.locale.v1', 'zh-CN');
    window.__debug.scene.stop();
  });
  const onboardingSkip = page.locator('.kb-core-onboarding-skip');
  if (await onboardingSkip.count()) await onboardingSkip.click();
  await page.waitForTimeout(250);
}

async function settleTransientUi(page) {
  // Startup sync status is intentionally surfaced as a transient Toast. The
  // packaged app has already lived through that Toast by the time interaction
  // acceptance finishes, while a newly opened Web reference has not. Compare
  // stable product states rather than two different moments in the Toast lifecycle.
  await page.waitForFunction(() => !document.querySelector('#toast')?.classList.contains('show'), null, { timeout: 5_000 });
  await page.waitForTimeout(100);
}

async function startWebReference() {
  const viteBin = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  const server = spawn(process.execPath, [viteBin, 'preview', '--host', '127.0.0.1', '--port', '4174', '--strictPort'], {
    cwd: repoRoot,
    stdio: 'ignore',
  });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Web reference server exited with code ${server.exitCode}`);
    try {
      if ((await fetch(webReferenceUrl)).ok) return server;
    } catch { /* preview not ready */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  server.kill();
  throw new Error('Web reference server did not become ready');
}

const desktop = await electron.launch({ executablePath: executable, args: ['--disable-gpu-sandbox', '--use-angle=swiftshader'] });
try {
  const page = await desktop.firstWindow();
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await deterministic(page);

  assert.equal(new URL(page.url()).protocol, 'app:', 'desktop must load the packaged app protocol, not a hidden server');
  assert.ok(await page.locator('#canvasHost canvas').isVisible(), 'WebGL canvas must render');
  assert.ok((await page.locator('#canvasHost canvas').boundingBox())?.width > 1000, 'product must render edge-to-edge');
  const webglAlive = await page.locator('#canvasHost canvas').evaluate(canvas => {
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    return Boolean(gl && !gl.isContextLost());
  });
  assert.equal(webglAlive, true, 'packaged Windows WebGL context must be live');

  // Settings and the shared locale controller are Web-owned.
  await page.locator('#btnSettings').click();
  await page.locator('#settingsOverlay.show').waitFor();
  await page.locator('#setLocale').selectOption('en');
  assert.equal((await page.locator('#btnSettings').textContent())?.trim(), '⚙ Settings', 'language switch must update product chrome');
  await page.locator('#settingsClose').click();

  // Windows must use the same AccountUiController as Web/mobile. Assert stable
  // controller-owned structure instead of inventing English copies of dynamic
  // AccountUi strings that are not part of the current shared-Web contract.
  await page.locator('#avatarBtn').click();
  await page.locator('#accountOverlay.show').waitFor();
  await page.locator('#kbMyBalance').waitFor({ state: 'visible' });
  assert.ok(await page.locator('#kbTotalEnergy').isVisible(), 'shared account total-energy field must render');
  assert.ok(await page.locator('#kbAuthEntry').isVisible(), 'shared account authentication entry must render');
  assert.ok((await page.locator('#kbAuthEntry').textContent())?.trim(), 'shared account authentication entry must have visible text');
  await page.locator('#accountClose').click();

  // Current -> Personal -> All -> Current must not collapse into a desktop-only state machine.
  const visibility = page.locator('#btnPersonal');
  assert.equal(await visibility.getAttribute('data-visibility-mode'), 'current');
  await visibility.click();
  await page.waitForFunction(() => document.querySelector('#btnPersonal')?.dataset.visibilityMode === 'personal' && window.__debug?.interaction?.getVisibilityMode?.() === 'personal');
  await visibility.click();
  await page.waitForFunction(() => document.querySelector('#btnPersonal')?.dataset.visibilityMode === 'all' && window.__debug?.interaction?.getVisibilityMode?.() === 'all');
  await visibility.click();
  await page.waitForFunction(() => document.querySelector('#btnPersonal')?.dataset.visibilityMode === 'current' && window.__debug?.interaction?.getVisibilityMode?.() === 'current');

  // Search and near-node detail must use current product controllers.
  const searchTarget = await page.evaluate(() => Object.values(window.__debug.projection.state.nodesById).find(node => node?.title));
  assert.ok(searchTarget?.title, 'projection must expose a searchable node');
  await page.locator('#aiInput').fill(searchTarget.title);
  const result = page.locator('#aiResults [data-node-id]').first();
  await result.waitFor({ state: 'visible' });
  await result.click();
  await page.locator('#nodeDetailOverlay.open').waitFor();

  // Optimization action must be actually visible and clickable, not merely present in DOM.
  await page.locator('#nodeDetailOverlay .node-detail-edit').click();
  const optimize = page.locator('#nodeDetailOverlay [data-node-detail-action="edit"]');
  await optimize.waitFor({ state: 'visible' });
  const optimizeState = await optimize.evaluate(element => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      opacity: Number(style.opacity),
      pointerEvents: style.pointerEvents,
      width: rect.width,
      height: rect.height,
      inside: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
    };
  });
  assert.ok(optimizeState.opacity > 0 && optimizeState.pointerEvents !== 'none' && optimizeState.width > 0 && optimizeState.height > 0 && optimizeState.inside,
    `optimization action is not interactable: ${JSON.stringify(optimizeState)}`);
  await optimize.click();
  await page.locator('#panel.open').waitFor();
  await page.locator('#panelClose').click();
  if (await page.locator('#panel.open').count()) await page.locator('#panelClose').click();
  await page.waitForFunction(() => !document.querySelector('#panel')?.classList.contains('open'));

  // Current split create flow and Toast layering. Use the same lowercase key
  // contract as the authoritative Web acceptance and InteractionController.
  await page.keyboard.press('Control+n');
  await page.locator('#knowledgeCreateOverlay.show').waitFor();
  await page.locator('[data-create-submit]').click();
  assert.ok(await page.locator('#toast.show').isVisible(), 'create validation must remain visible above its modal');
  const toastZ = await page.locator('#toast').evaluate(element => Number.parseInt(getComputedStyle(element).zIndex || '0', 10));
  const modalZ = await page.locator('#knowledgeCreateOverlay').evaluate(element => Number.parseInt(getComputedStyle(element).zIndex || '0', 10));
  assert.ok(toastZ > modalZ, `Toast z-index ${toastZ} must exceed modal z-index ${modalZ}`);
  await page.locator('[data-create-close]').click();

  // Electron must deny in-window external navigation.
  const appUrl = page.url();
  const windowsBefore = desktop.windows().length;
  await page.evaluate(() => {
    const link = document.createElement('a');
    link.href = 'https://example.com/';
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    link.remove();
  });
  await page.waitForTimeout(300);
  assert.equal(page.url(), appUrl, 'external navigation must not replace the packaged app');
  assert.equal(desktop.windows().length, windowsBefore, 'external navigation must not create an unmanaged Electron window');

  await page.mouse.move(720, 450);
  await page.mouse.down();
  await page.mouse.move(750, 470);
  await page.mouse.up();
  await page.mouse.wheel(0, -120);
  assert.deepEqual(errors, [], `desktop runtime errors: ${errors.join('\n')}`);

  // Return to the Chinese state through the same live locale controller already
  // exercised above. Reloading here needlessly repeated cloud/bootstrap work and
  // could leave a healthy packaged app waiting on a second remote initialization.
  await page.locator('#btnSettings').click();
  await page.locator('#settingsOverlay.show').waitFor();
  await page.locator('#setLocale').selectOption('zh-CN');
  await page.locator('#settingsClose').click();
  await page.evaluate(() => window.__debug?.scene?.stop());
  await settleTransientUi(page);
  const desktopPng = await page.screenshot({ path: path.join(artifacts, 'desktop.png') });

  // Compare the packaged Electron renderer with an independent browser loading
  // the authoritative root dist. ElectronApplication's BrowserContext cannot
  // create arbitrary new pages, so the previous same-context reference was not executable.
  const referenceServer = await startWebReference();
  let referenceBrowser;
  try {
    referenceBrowser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader'] });
    const reference = await referenceBrowser.newPage({ viewport: { width: 1440, height: 900 } });
    await reference.goto(webReferenceUrl, { waitUntil: 'domcontentloaded' });
    await deterministic(reference);
    await settleTransientUi(reference);
    const referencePng = await reference.screenshot({ path: path.join(artifacts, 'web-reference.png') });
    const actual = PNG.sync.read(desktopPng), expected = PNG.sync.read(referencePng);
    assert.equal(actual.width, expected.width);
    assert.equal(actual.height, expected.height);
    const diff = new PNG({ width: actual.width, height: actual.height });
    const changed = pixelmatch(actual.data, expected.data, diff.data, actual.width, actual.height, { threshold: 0.1 });
    const ratio = changed / (actual.width * actual.height);
    await import('node:fs').then(({ writeFileSync }) => writeFileSync(path.join(artifacts, 'visual-diff.png'), PNG.sync.write(diff)));
    assert.ok(ratio <= 0.005, `desktop/Web visual mismatch ${(ratio * 100).toFixed(3)}% exceeds 0.5%`);
    console.log(`Windows desktop runtime and Web visual parity passed (pixel mismatch ${(ratio * 100).toFixed(3)}%)`);
  } finally {
    await referenceBrowser?.close();
    referenceServer.kill();
  }
} finally {
  await desktop.close();
}
