import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const origin = 'http://127.0.0.1:4173/Knowledge-Ball/';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1'], { stdio: 'ignore' });
const USER_TEXT = '用户原文 MIXED Ω — A → B — keep 100% unchanged';

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(origin)).ok) return;
    } catch { /* preview not ready yet */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Vite preview did not become ready');
}

async function openDownloads(page) {
  await page.locator('#btnSettings').click();
  await page.locator('#settingsOverlay.show').waitFor({ state: 'visible' });
  await page.locator('#openDownloads').click();
  await page.locator('#downloadsOverlay.show').waitFor({ state: 'visible' });
}

async function assertDesktopLayout(page) {
  await openDownloads(page);
  const cards = page.locator('#downloadsOverlay .app-download');
  assert.equal(await cards.count(), 3, 'Downloads must expose exactly Apple/iOS, Android, and Windows choices');
  const boxes = [];
  for (let index = 0; index < 3; index += 1) boxes.push(await cards.nth(index).boundingBox());
  assert.ok(boxes.every(Boolean), 'all desktop platform cards must have a bounding box');
  const widths = boxes.map(box => box.width);
  assert.ok(Math.max(...widths) - Math.min(...widths) <= 2, `desktop platform cards must be equal width (${widths.join(', ')})`);
  assert.ok(boxes[0].x < boxes[1].x && boxes[1].x < boxes[2].x, 'desktop platform cards must be evenly ordered left-to-right');
  const gaps = [boxes[1].x - (boxes[0].x + boxes[0].width), boxes[2].x - (boxes[1].x + boxes[1].width)];
  assert.ok(Math.abs(gaps[0] - gaps[1]) <= 2, `desktop platform gaps must be even (${gaps.join(', ')})`);
  const windowsManifestResponse = await fetch(new URL('downloads/latest.json', origin));
  assert.equal(windowsManifestResponse.ok, true, 'Windows release manifest must be readable by the browser acceptance');
  const releaseManifest = await windowsManifestResponse.json();
  const windowsArtifact = releaseManifest.platforms?.windows;
  const windowsUrl = windowsArtifact?.urls?.installer ?? windowsArtifact?.urls?.portable;
  const windowsEnabled = Boolean(windowsArtifact?.available && windowsUrl);
  assert.equal(await page.locator('#windowsDownload').isDisabled(), !windowsEnabled, 'Windows action must match authoritative release manifest availability');
  if (windowsEnabled) {
    assert.ok(String(windowsUrl).startsWith('https://github.com/Rushow111/Knowledge-Ball/releases/download/'), 'Published Windows action must use the authoritative GitHub Release URL');
  } else {
    assert.equal(await page.locator('.windows-download-card a[href]').count(), 0, 'Windows must not expose an invented download URL');
  }
  await page.locator('#downloadsClose').click();
}

async function assertLabelAppearanceControls(page) {
  await page.locator('#settingsOverlay.show').waitFor({ state: 'visible' });
  const sizeSlider = page.locator('#setLabelSize');
  const colorInput = page.locator('#setLabelColor');
  const originalSize = await sizeSlider.inputValue();
  const originalColor = await colorInput.inputValue();

  assert.equal(await sizeSlider.getAttribute('max'), '30', 'label font-size control must allow up to 30px');
  await sizeSlider.evaluate(input => {
    input.value = '30';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--label-size').trim() === '30px');
  await page.waitForFunction(() => [...document.querySelectorAll('.node-label')].some(label => getComputedStyle(label).display !== 'none'));
  const renderedSize = await page.evaluate(() => {
    const label = [...document.querySelectorAll('.node-label')].find(candidate => getComputedStyle(candidate).display !== 'none');
    return label ? getComputedStyle(label).fontSize : null;
  });
  assert.equal(renderedSize, '30px', 'Settings font-size slider must change the computed size of a real visible node label');

  await colorInput.evaluate(input => {
    input.value = '#21d4fd';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--label-color').trim().toLowerCase() === '#21d4fd');
  const renderedColor = await page.evaluate(() => {
    const label = [...document.querySelectorAll('.node-label')].find(candidate => getComputedStyle(candidate).display !== 'none');
    return label ? getComputedStyle(label).color : null;
  });
  assert.equal(renderedColor, 'rgb(33, 212, 253)', 'Settings color picker must change the computed color of a real visible node label');

  const labelPresentation = await page.evaluate(() => {
    const label = [...document.querySelectorAll('.node-label')].find(candidate => getComputedStyle(candidate).display !== 'none');
    const layer = document.getElementById('labelsLayer');
    if (!(label instanceof HTMLElement) || !layer || !label.firstChild) return null;
    const top = Number.parseFloat(label.style.top);
    if (!Number.isFinite(top)) return null;
    const range = document.createRange();
    range.selectNodeContents(label);
    const textRect = range.getBoundingClientRect();
    const layerRect = layer.getBoundingClientRect();
    const style = getComputedStyle(label);
    const renderedSphereTop = layerRect.top + top;
    return {
      textGap: renderedSphereTop - textRect.bottom,
      translate: style.translate,
      marginTop: style.marginTop,
      paddingTop: style.paddingTop,
      paddingBottom: style.paddingBottom,
      paddingLeft: style.paddingLeft,
      paddingRight: style.paddingRight,
    };
  });
  assert.ok(labelPresentation, 'a real visible label must expose computed presentation metrics');
  assert.ok(labelPresentation.textGap >= -2.5 && labelPresentation.textGap <= -1, `label text must overlap the direct sphere-top anchor by about 2px so it visually touches the sphere edge (actual=${labelPresentation.textGap})`);
  assert.equal(labelPresentation.translate, '0px 2px', 'label presentation must move toward the sphere by one fixed 2px visual inset');
  assert.equal(labelPresentation.marginTop, '0px', 'label presentation must not add a second vertical gap');
  assert.equal(labelPresentation.paddingTop, '0px', 'label frame must not add top padding');
  assert.equal(labelPresentation.paddingBottom, '0px', 'label frame must not add bottom padding');
  assert.equal(labelPresentation.paddingLeft, '3px', 'label frame must keep only the intended compact horizontal inset');
  assert.equal(labelPresentation.paddingRight, '3px', 'label frame must keep only the intended compact horizontal inset');

  await sizeSlider.evaluate((input, value) => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, originalSize);
  await colorInput.evaluate((input, value) => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, originalColor);
}

async function assertLocaleAndRuntime(page) {
  const select = page.locator('#setLocale');
  await select.selectOption('en');
  await page.waitForFunction(() => document.documentElement.lang === 'en');
  assert.equal((await page.locator('#btnSettings').textContent())?.trim(), '⚙ Settings', 'header Settings must switch immediately to English');
  assert.equal((await page.locator('#openDownloads b').textContent())?.trim(), 'Downloads', 'Settings download destination must switch to English');

  await page.evaluate(userText => {
    const sentinel = document.createElement('section');
    sentinel.id = 'i18nUserBoundaryFixture';
    sentinel.innerHTML = `<h2 class="node-detail-title"></h2><div class="node-detail-content"></div><div id="i18nSystemFixture">注册 / 登录</div>`;
    sentinel.querySelector('.node-detail-title').textContent = userText;
    sentinel.querySelector('.node-detail-content').textContent = userText;
    document.body.appendChild(sentinel);
  }, USER_TEXT);
  await page.waitForFunction(() => document.getElementById('i18nSystemFixture')?.textContent === 'Register / Sign in');
  assert.equal(await page.locator('#i18nUserBoundaryFixture .node-detail-title').textContent(), USER_TEXT, 'user-authored node title must never be translated');
  assert.equal(await page.locator('#i18nUserBoundaryFixture .node-detail-content').textContent(), USER_TEXT, 'user-authored node content must never be translated');

  await page.locator('#settingsClose').click();
  await page.locator('#avatarBtn').click();
  await page.locator('#accountOverlay.show').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('#accountOverlay .modal-body')?.textContent?.includes('My energy'));
  assert.ok((await page.locator('#accountOverlay .modal-body').textContent())?.includes('Register / Sign in'), 'dynamic account/auth UI must localize to English');
  await page.locator('#accountClose').click();

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+n' : 'Control+n');
  await page.locator('#knowledgeCreateOverlay.show').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('#knowledgeCreateOverlay h3')?.textContent?.trim() === 'Add knowledge');
  assert.ok((await page.locator('#knowledgeCreateOverlay').textContent())?.includes('Content'), 'dynamic create UI must localize to English');
  await page.locator('#knowledgeCreateOverlay [data-create-close]').click();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.lang === 'en');
  assert.equal(await page.locator('#setLocale').inputValue(), 'en', 'locale preference must survive page reload');
  assert.equal((await page.locator('#btnSettings').textContent())?.trim(), '⚙ Settings', 'English system UI must survive reload');

  await page.locator('#btnSettings').click();
  await page.locator('#setLocale').selectOption('zh-CN');
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  assert.equal((await page.locator('#btnSettings').textContent())?.trim(), '⚙ 设置', 'system UI must switch back to Chinese without reload');
}

async function assertMobileKeyboardOverlay(page) {
  await page.waitForFunction(() => Boolean(document.querySelector('#canvasHost canvas')));
  const before = await page.evaluate(() => {
    const canvas = document.querySelector('#canvasHost canvas');
    const host = document.getElementById('canvasHost');
    const labels = document.getElementById('labelsLayer');
    if (!(canvas instanceof HTMLCanvasElement) || !host || !labels) return null;
    return {
      appHeight: getComputedStyle(document.documentElement).getPropertyValue('--app-height').trim(),
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      hostHeight: host.getBoundingClientRect().height,
      labelsHeight: labels.getBoundingClientRect().height,
    };
  });
  assert.ok(before, 'mobile scene must expose stable canvas and label-layer dimensions before text entry');

  await page.locator('#aiInput').focus();
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'aiInput', 'search input must own focus before keyboard-style resize');
  await page.setViewportSize({ width: 390, height: 560 });
  await page.waitForTimeout(120);

  const during = await page.evaluate(() => {
    const canvas = document.querySelector('#canvasHost canvas');
    const host = document.getElementById('canvasHost');
    const labels = document.getElementById('labelsLayer');
    if (!(canvas instanceof HTMLCanvasElement) || !host || !labels) return null;
    return {
      appHeight: getComputedStyle(document.documentElement).getPropertyValue('--app-height').trim(),
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      hostHeight: host.getBoundingClientRect().height,
      labelsHeight: labels.getBoundingClientRect().height,
    };
  });
  assert.deepEqual(during, before, 'text-input keyboard resize must leave the 3D canvas and label projection viewport unchanged');

  await page.locator('#aiInput').evaluate(input => input.blur());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--app-height').trim() === '844px');
}

async function assertMobileCoreLabelsAndContent(page) {
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  const canvas = page.locator('#canvasHost canvas');
  await canvas.waitFor({ state: 'visible' });
  await canvas.evaluate(element => {
    element.dispatchEvent(new WheelEvent('wheel', { deltaY: -2_000, bubbles: true, cancelable: true }));
  });

  const coreNames = ['同一律', '排中律', '矛盾律'];
  await page.waitForFunction(names => names.every(name => [...document.querySelectorAll('.node-label')].some(label => label.textContent?.trim() === name && getComputedStyle(label).display !== 'none')), coreNames);
  const visibleLabels = await page.evaluate(() => [...document.querySelectorAll('.node-label')]
    .filter(label => getComputedStyle(label).display !== 'none')
    .map(label => label.textContent?.trim() ?? ''));
  assert.ok(coreNames.every(name => visibleLabels.includes(name)), `10x+ mobile view must whitelist all three Chinese core labels (${visibleLabels.join(' | ')})`);
  assert.ok(visibleLabels.length <= 18, `core whitelist must consume the existing label budget instead of expanding it (visible=${visibleLabels.length})`);
  assert.ok(!visibleLabels.some(label => label.includes('A = A') || label.includes('P ∨ ¬P') || label.includes('¬(P ∧ ¬P)')), 'logic formulas belong in core detail, never in label names');

  const identityCenter = await page.evaluate(() => {
    const labelsLayer = document.getElementById('labelsLayer');
    const host = document.getElementById('canvasHost');
    const coreLabels = ['同一律', '排中律', '矛盾律']
      .map(name => [...document.querySelectorAll('.node-label')].find(candidate => candidate.textContent?.trim() === name && getComputedStyle(candidate).display !== 'none'))
      .filter(label => label instanceof HTMLElement);
    const identity = coreLabels.find(label => label.textContent?.trim() === '同一律');
    if (!(identity instanceof HTMLElement) || !labelsLayer || !host || coreLabels.length !== 3) return null;
    const identityRect = identity.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    const averageSphereTop = coreLabels.reduce((sum, label) => sum + label.getBoundingClientRect().bottom, 0) / coreLabels.length;
    const projectedCoreRadius = hostRect.top + hostRect.height * 0.5 - averageSphereTop;
    return {
      x: (identityRect.left + identityRect.right) * 0.5,
      y: identityRect.bottom + projectedCoreRadius,
      projectedCoreRadius,
    };
  });
  assert.ok(identityCenter && Number.isFinite(identityCenter.x) && Number.isFinite(identityCenter.y), 'visible Identity label must resolve to the actual core-ball center in viewport coordinates');
  assert.ok(identityCenter.projectedCoreRadius > 0 && identityCenter.projectedCoreRadius < 30, `projected core radius must be physically plausible (${identityCenter.projectedCoreRadius})`);
  await page.mouse.click(identityCenter.x, identityCenter.y);
  await page.locator('#systemCoreOverlay').waitFor({ state: 'visible' });
  const coreCardText = (await page.locator('#systemCoreOverlay').textContent()) ?? '';
  assert.ok(coreCardText.includes('同一律'), 'Chinese core detail must show the localized title');
  assert.ok(coreCardText.includes('A = A'), 'core detail must show the logic formula separately from the label');
  assert.ok(coreCardText.includes('自身相同'), 'Chinese core detail must show the localized explanation');
  assert.ok(coreCardText.includes('返回'), 'Chinese core detail controls must be localized');
  await page.locator('#systemCoreOverlay button').click();
}

async function assertMobileLayout(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await assertMobileKeyboardOverlay(page);
  await assertMobileCoreLabelsAndContent(page);
  await openDownloads(page);
  const cards = page.locator('#downloadsOverlay .app-download');
  const boxes = [];
  for (let index = 0; index < 3; index += 1) boxes.push(await cards.nth(index).boundingBox());
  assert.ok(boxes.every(Boolean), 'all mobile platform cards must have a bounding box');
  assert.ok(boxes[0].y < boxes[1].y && boxes[1].y < boxes[2].y, 'phone portrait must stack Apple/iOS → Android → Windows vertically');
  assert.ok(Math.max(...boxes.map(box => box.x)) - Math.min(...boxes.map(box => box.x)) <= 2, 'mobile platform cards must share the same left edge');
  assert.ok(Math.max(...boxes.map(box => box.width)) - Math.min(...boxes.map(box => box.width)) <= 2, 'mobile platform cards must use equal full-width sizing');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `phone portrait must not horizontally overflow (overflow=${overflow}px)`);
  for (const box of boxes) assert.ok(box.x >= 0 && box.x + box.width <= 390, 'each mobile platform card must stay inside the viewport');
  await context.close();
}

async function assertIosInstallLocalization(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('knowledge-ball.locale.v1', 'en'));
  await page.goto(new URL('ios-install.html', origin).toString(), { waitUntil: 'domcontentloaded' });
  assert.equal(await page.locator('html').getAttribute('lang'), 'en', 'iOS install page must inherit the persisted English locale');
  assert.equal((await page.locator('h1').textContent())?.trim(), 'Install the iOS app with Safari', 'iOS install page system copy must localize to English');
  await page.locator('[data-locale="zh-CN"]').click();
  assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN', 'iOS install page language control must switch back to Chinese');
  assert.equal((await page.locator('h1').textContent())?.trim(), '使用 Safari 安装 iOS 应用', 'iOS install page must render Chinese system copy after switching');
  await context.close();
}

try {
  await waitForServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await assertDesktopLayout(page);
    await assertLabelAppearanceControls(page);
    await assertLocaleAndRuntime(page);
    assert.deepEqual(errors, [], `locale/download browser acceptance must not emit page errors: ${errors.join(' | ')}`);
    await context.close();
    await assertMobileLayout(browser);
    await assertIosInstallLocalization(browser);
  } finally {
    await browser.close();
  }
  console.log('Downloads responsive layout, direct label anchoring, core-label whitelist/localization, keyboard-overlay stability, and zh-CN/en browser acceptance passed');
} finally {
  server.kill('SIGTERM');
}
