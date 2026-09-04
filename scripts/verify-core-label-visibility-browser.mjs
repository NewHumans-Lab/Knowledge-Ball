import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const origin = 'http://127.0.0.1:4173/Knowledge-Ball/';
const screenshotPath = 'artifacts/mobile-scene-core-label-zh.png';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1'], { stdio: 'ignore' });

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(origin)).ok) return;
    } catch { /* preview not ready yet */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Vite preview did not become ready');
}

async function assertSourceNodesStayUntouched(page) {
  const staticCss = await page.evaluate(() => [...document.querySelectorAll('style')]
    .map(style => style.textContent ?? '')
    .find(text => text.includes('#labelsLayer')) ?? '');
  assert.ok(staticCss.includes('#labelsLayer'), 'inline CSS must retain the literal #labelsLayer selector after zh-CN initialization');
  assert.ok(!staticCss.includes('#labels层级'), 'runtime localization must never translate CSS selectors');
  assert.ok(!staticCss.includes('current颜色'), 'runtime localization must never translate CSS property values');
  assert.ok(!staticCss.includes('Noto 衬线（宋体风格） SC'), 'runtime localization must never translate CSS font-family source');

  const fixture = await page.evaluate(async () => {
    const source = 'Settings Layer currentColor Serif';
    const style = document.createElement('style');
    style.id = 'i18nStyleSourceBoundaryFixture';
    style.textContent = `#i18nLabelsLayerProbe{color:currentColor;font-family:'Noto Serif SC'} /* ${source} */`;

    const script = document.createElement('script');
    script.id = 'i18nScriptSourceBoundaryFixture';
    script.type = 'application/json';
    script.textContent = JSON.stringify({ source });

    const noscript = document.createElement('noscript');
    noscript.id = 'i18nNoscriptSourceBoundaryFixture';
    noscript.textContent = source;

    const template = document.createElement('template');
    template.id = 'i18nTemplateSourceBoundaryFixture';
    template.innerHTML = `<span>${source}</span>`;

    document.body.append(style, script, noscript, template);
    await new Promise(resolve => setTimeout(resolve, 50));

    return {
      style: style.textContent,
      script: script.textContent,
      noscript: noscript.textContent,
      template: template.content.textContent,
    };
  });

  assert.equal(fixture.style, "#i18nLabelsLayerProbe{color:currentColor;font-family:'Noto Serif SC'} /* Settings Layer currentColor Serif */", 'MutationObserver must not translate dynamically inserted STYLE source');
  assert.equal(fixture.script, '{"source":"Settings Layer currentColor Serif"}', 'MutationObserver must not translate dynamically inserted SCRIPT source/data');
  assert.equal(fixture.noscript, 'Settings Layer currentColor Serif', 'MutationObserver must not translate dynamically inserted NOSCRIPT source');
  assert.equal(fixture.template, 'Settings Layer currentColor Serif', 'runtime localization must not translate TEMPLATE content');

  await page.locator('#btnSettings').click();
  await page.locator('#settingsOverlay.show').waitFor({ state: 'visible' });
  await page.locator('#setLocale').selectOption('en');
  await page.waitForFunction(() => document.documentElement.lang === 'en');
  await page.locator('#setLocale').selectOption('zh-CN');
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  await page.locator('#settingsClose').click();

  const afterSwitch = await page.evaluate(() => ({
    staticCss: [...document.querySelectorAll('style')].map(style => style.textContent ?? '').find(text => text.includes('#labelsLayer')) ?? '',
    fixtureCss: document.getElementById('i18nStyleSourceBoundaryFixture')?.textContent ?? '',
  }));
  assert.ok(afterSwitch.staticCss.includes('#labelsLayer'), 'language switching must preserve the original labels-layer CSS selector');
  assert.equal(afterSwitch.fixtureCss, fixture.style, 'language switching must keep source STYLE text byte-for-byte unchanged');
}

async function assertChineseCoreLabelsAreActuallyOnTop(page) {
  const canvas = page.locator('#canvasHost canvas');
  await canvas.waitFor({ state: 'visible' });
  await canvas.evaluate(element => {
    element.dispatchEvent(new WheelEvent('wheel', { deltaY: -2_000, bubbles: true, cancelable: true }));
  });

  const coreNames = ['同一律', '排中律', '矛盾律'];
  await page.waitForFunction(names => names.every(name => [...document.querySelectorAll('.node-label')]
    .some(label => label.textContent?.trim() === name && getComputedStyle(label).display !== 'none')), coreNames);

  const visual = await page.evaluate(names => {
    const layer = document.getElementById('labelsLayer');
    const host = document.getElementById('canvasHost');
    if (!(layer instanceof HTMLElement) || !(host instanceof HTMLElement)) return null;

    const layerStyle = getComputedStyle(layer);
    const hostStyle = getComputedStyle(host);
    const layerRect = layer.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    const labels = names.map(name => [...document.querySelectorAll('.node-label')]
      .find(candidate => candidate.textContent?.trim() === name && getComputedStyle(candidate).display !== 'none'));
    if (labels.some(label => !(label instanceof HTMLElement))) return null;

    const previousLayerPointerEvents = layer.style.pointerEvents;
    layer.style.pointerEvents = 'auto';
    const rendered = labels.map(label => {
      const element = label;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const previousPointerEvents = element.style.pointerEvents;
      element.style.pointerEvents = 'auto';
      const centerX = (rect.left + rect.right) * 0.5;
      const centerY = (rect.top + rect.bottom) * 0.5;
      const topmost = document.elementFromPoint(centerX, centerY);
      element.style.pointerEvents = previousPointerEvents;
      return {
        name: element.textContent?.trim() ?? '',
        display: style.display,
        visibility: style.visibility,
        opacity: Number(style.opacity),
        width: rect.width,
        height: rect.height,
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        topmost: topmost === element || element.contains(topmost),
      };
    });
    layer.style.pointerEvents = previousLayerPointerEvents;

    return {
      layer: {
        position: layerStyle.position,
        zIndex: layerStyle.zIndex,
        overflow: layerStyle.overflow,
        width: layerRect.width,
        height: layerRect.height,
      },
      host: {
        position: hostStyle.position,
        zIndex: hostStyle.zIndex,
        width: hostRect.width,
        height: hostRect.height,
      },
      rendered,
      viewport: { width: innerWidth, height: innerHeight },
    };
  }, coreNames);

  assert.ok(visual, 'real mobile page must expose the labels layer, WebGL host, and all three Chinese core labels');
  assert.equal(visual.layer.position, 'absolute', 'labelsLayer must keep its absolute overlay positioning after localization');
  assert.equal(visual.layer.zIndex, '5', 'labelsLayer must keep z-index: 5 after localization');
  assert.equal(visual.layer.overflow, 'hidden', 'labelsLayer must keep the intended clipping rule');
  assert.ok(visual.layer.width > 0 && visual.layer.height > 0, `labelsLayer must have a visible viewport-sized box (${visual.layer.width}x${visual.layer.height})`);
  assert.ok(visual.host.width > 0 && visual.host.height > 0, 'WebGL host must have a real rendered box');
  assert.ok(Number(visual.layer.zIndex) > Number(visual.host.zIndex || 0), `labels overlay must stack above WebGL host (labels=${visual.layer.zIndex}, host=${visual.host.zIndex})`);

  for (const label of visual.rendered) {
    assert.equal(label.display, 'block', `${label.name} must be display:block at the core zoom threshold`);
    assert.equal(label.visibility, 'visible', `${label.name} must remain visibility:visible`);
    assert.ok(label.opacity > 0, `${label.name} must have non-zero opacity`);
    assert.ok(label.width > 0 && label.height > 0, `${label.name} must occupy real screen pixels`);
    assert.ok(label.left >= 0 && label.top >= 0 && label.right <= visual.viewport.width && label.bottom <= visual.viewport.height, `${label.name} must be inside the phone viewport`);
    assert.equal(label.topmost, true, `${label.name} must be the topmost rendered element at its own screen position, not covered by the WebGL canvas`);
  }

  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });
}

try {
  await waitForServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
    await assertSourceNodesStayUntouched(page);
    await assertChineseCoreLabelsAreActuallyOnTop(page);
    assert.deepEqual(errors, [], `core-label browser acceptance must not emit page errors: ${errors.join(' | ')}`);
    await context.close();
  } finally {
    await browser.close();
  }
  console.log(`zh-CN source-boundary and visible core-label browser acceptance passed; screenshot: ${screenshotPath}`);
} finally {
  server.kill('SIGTERM');
}
