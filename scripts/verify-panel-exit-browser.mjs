import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const origin = 'http://127.0.0.1:4173/Knowledge-Ball/';
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1'],
  { stdio: 'ignore' },
);

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      if ((await fetch(origin)).ok) return;
    } catch { /* preview is still starting */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Vite preview did not become reachable');
}

try {
  await waitForServer();
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader'] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.goto(`${origin}?explicit-panel-exit-regression=1`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForFunction(() => Boolean(window.__debug?.panel && window.__debug?.renderNodes?.length), null, { timeout: 10_000 });

    const candidate = await page.evaluate(() => {
      const core = new Set(['n1', 'n2', 'n16']);
      const node = window.__debug.renderNodes.find(value => !core.has(value.id) && !value.hidden);
      if (!node) return null;
      return { id: node.id, title: node.title };
    });
    assert.ok(candidate, 'fixture must expose an ordinary node');

    const opened = await page.evaluate(id => window.__debug.panel.openNodeAction(id, 'edit'), candidate.id);
    assert.equal(opened, true, 'explicit edit action must open the optimization subview');
    await page.locator('#panel.open').waitFor({ state: 'visible', timeout: 5_000 });
    assert.match(await page.locator('#panelTitle').innerText(), /^编辑节点 · 优化：/, 'Chinese edit action must be in a panel subview');
    assert.equal(await page.locator('#panelClose').getAttribute('aria-label'), '返回节点详情', 'Chinese subview close must explicitly mean return to node detail');

    await page.locator('#panelClose').click();
    await page.waitForFunction(
      ({ id, title }) => document.querySelector('#panel.open') !== null
        && document.querySelector('#panelTitle')?.textContent === title
        && document.querySelector('#panelClose')?.getAttribute('aria-label') === '返回知识球'
        && document.querySelector('#btnEditNode') !== null
        && window.__debug?.panel !== undefined
        && window.__debug?.renderNodes?.some(node => node.id === id),
      candidate,
      { timeout: 5_000 },
    );
    await page.locator('#panelClose').click();
    await page.waitForFunction(() => document.querySelector('#panel.open') === null, null, { timeout: 5_000 });

    await page.locator('#btnSettings').click();
    await page.locator('#settingsOverlay.show').waitFor({ state: 'visible', timeout: 5_000 });
    await page.locator('#setLocale').selectOption('en');
    await page.waitForFunction(() => document.documentElement.lang === 'en');
    await page.locator('#settingsClose').click();

    const openedEnglish = await page.evaluate(id => window.__debug.panel.openNodeAction(id, 'edit'), candidate.id);
    assert.equal(openedEnglish, true, 'English explicit edit action must open the same optimization subview');
    await page.locator('#panel.open').waitFor({ state: 'visible', timeout: 5_000 });
    assert.match(await page.locator('#panelTitle').innerText(), /^Edit node · Optimize:/, 'panel subview system title must localize while preserving the node title');
    assert.ok((await page.locator('#panelTitle').innerText()).endsWith(candidate.title), 'user-authored node title must remain unchanged inside the localized panel title');
    assert.equal(await page.locator('#panelClose').getAttribute('aria-label'), 'Back to node details', 'English subview close must localize after its semantic label changes');

    await page.locator('#panelClose').click();
    await page.waitForFunction(
      ({ title }) => document.querySelector('#panel.open') !== null
        && document.querySelector('#panelTitle')?.textContent === title
        && document.querySelector('#panelClose')?.getAttribute('aria-label') === 'Back to Knowledge Ball',
      candidate,
      { timeout: 5_000 },
    );
    await page.locator('#panelClose').click();
    await page.waitForFunction(() => document.querySelector('#panel.open') === null, null, { timeout: 5_000 });

    assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join(' | ')}`);
    console.log('Explicit panel exit real mobile-page regression passed in zh-CN and en');
  } finally {
    await browser.close();
  }
} finally {
  server.kill('SIGTERM');
}
