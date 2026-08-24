import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const origin = 'http://127.0.0.1:4173/Knowledge-Ball/';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1'], { stdio: 'ignore' });

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(origin)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('preview server did not become ready');
}

try {
  await waitForServer();
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader'] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => { errors.push(`pageerror: ${error.message}`); console.log(`PAGEERROR ${error.message}`); });
    page.on('console', message => {
      if (message.type() === 'error') {
        errors.push(`console: ${message.text()}`);
        console.log(`CONSOLE_ERROR ${message.text()}`);
      }
    });
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.__debug?.knowledgeCreate && window.__debug?.projection && window.__debug?.store));
    await page.evaluate(() => {
      const debug = window.__debug;
      debug.syncEngine.commit = async event => debug.store.appendValidated(event);
      debug.scene.stop();
      debug.knowledgeCreate.openStandalone();
    });
    const overlay = page.locator('#knowledgeCreateOverlay.show');
    await overlay.waitFor({ state: 'visible' });
    await overlay.locator('[data-create-title]').fill('布局诊断孤立节点');
    await overlay.locator('[data-create-layer]').selectOption('inner');
    await overlay.locator('[data-create-description]').fill('用于定位布局重算失败根因。');
    const started = Date.now();
    await overlay.locator('[data-create-submit]').click();
    await page.waitForTimeout(3000);
    const state = await page.evaluate(() => ({
      open: document.querySelector('#knowledgeCreateOverlay')?.classList.contains('show') ?? false,
      toast: document.querySelector('#toast')?.textContent?.trim() ?? '',
      nodes: Object.keys(window.__debug?.projection?.state?.nodesById ?? {}).length,
    }));
    console.log(`DIAGNOSTIC elapsed=${Date.now() - started}ms open=${state.open} nodes=${state.nodes} toast=${JSON.stringify(state.toast)}`);
    console.log(`DIAGNOSTIC errors=${JSON.stringify(errors)}`);
    if (state.open || errors.length) process.exitCode = 1;
  } finally {
    await browser.close();
  }
} finally {
  server.kill('SIGTERM');
}
