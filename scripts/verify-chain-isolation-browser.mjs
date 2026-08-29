import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const origin = 'http://127.0.0.1:4174/Knowledge-Ball/';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4174', '--strictPort'], { stdio: 'ignore' });
const CORE_IDS = new Set(['n1', 'n2', 'n16']);

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

async function dispatchPointer(page, type, point, pointerId, extra = {}) {
  await page.evaluate(({ type, point, pointerId, extra }) => {
    const canvas = document.querySelector('#canvasHost canvas');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('knowledge canvas unavailable');
    canvas.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId,
      pointerType: 'touch',
      isPrimary: pointerId % 2 === 1,
      clientX: point.x,
      clientY: point.y,
      ...extra,
    }));
  }, { type, point, pointerId, extra });
}

function chooseBlank(rect, points, margin = 30) {
  const candidates = [
    { x: rect.x + 24, y: rect.y + 24 },
    { x: rect.x + rect.width - 24, y: rect.y + 24 },
    { x: rect.x + 24, y: rect.y + rect.height - 24 },
    { x: rect.x + rect.width - 24, y: rect.y + rect.height - 24 },
    { x: rect.x + rect.width * .5, y: rect.y + 32 },
    { x: rect.x + 32, y: rect.y + rect.height * .5 },
    { x: rect.x + rect.width - 32, y: rect.y + rect.height * .5 },
  ];
  return candidates
    .map(point => ({ point, clearance: points.length ? Math.min(...points.map(other => distance(point, other))) : Infinity }))
    .sort((a, b) => b.clearance - a.clearance)
    .find(item => item.clearance >= margin)?.point ?? candidates[0];
}

function dragDestination(rect, start) {
  const horizontal = start.x < rect.x + rect.width / 2 ? 68 : -68;
  const vertical = start.y < rect.y + rect.height / 2 ? 34 : -34;
  return { x: start.x + horizontal, y: start.y + vertical };
}

async function snapshot(page) {
  return page.evaluate(() => ({
    nodes: window.__debug.renderNodes.map(node => ({
      id: node.id,
      type: node.type,
      title: node.title,
      premises: [...(node.premises ?? [])],
      pos: node.pos ? [node.pos.x, node.pos.y, node.pos.z] : null,
      homePos: node.homePos ? [node.homePos.x, node.homePos.y, node.homePos.z] : null,
      address: node.address ? { shellID: node.address.shellID, cellID: node.address.cellID } : null,
      screen: window.__debug.scene.screenPositionForNode(node.id),
    })),
    core: window.__debug.scene.screenPositionForNode('n1'),
  }));
}

function assertAuthoritativePositionsEqual(before, after, message) {
  const afterById = new Map(after.nodes.map(node => [node.id, node]));
  for (const node of before.nodes) {
    const current = afterById.get(node.id);
    assert.ok(current, `${message}: node ${node.id} must still exist`);
    assert.deepEqual(current.pos, node.pos, `${message}: ${node.id}.pos must remain authoritative and unchanged`);
    assert.deepEqual(current.homePos, node.homePos, `${message}: ${node.id}.homePos must remain unchanged`);
    assert.deepEqual(current.address, node.address, `${message}: ${node.id} spatial address must remain unchanged`);
  }
}

try {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(origin)).ok) break;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  const browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader'] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    page.setDefaultTimeout(12_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });

    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.__debug?.scene && window.__debug?.renderNodes?.length));
    await page.waitForTimeout(500);

    const canvas = page.locator('#canvasHost canvas');
    const rect = await canvas.boundingBox();
    assert.ok(rect && rect.width > 100 && rect.height > 100, 'knowledge canvas must expose a usable mobile viewport');

    const before = await snapshot(page);
    assert.ok(before.core, 'normal scene must render the system core before chain isolation');

    const incomingCount = new Map();
    for (const node of before.nodes) for (const premiseId of node.premises) incomingCount.set(premiseId, (incomingCount.get(premiseId) ?? 0) + 1);
    const visibleBefore = before.nodes.filter(node => node.screen);
    const target = before.nodes
      .filter(node => node.screen
        && !CORE_IDS.has(node.id)
        && node.type !== 'reasoning'
        && node.type !== 'logic-symbol'
        && node.screen.x > rect.x + 24
        && node.screen.x < rect.x + rect.width - 24
        && node.screen.y > rect.y + 24
        && node.screen.y < rect.y + rect.height - 24)
      .map(node => ({
        ...node,
        connected: node.premises.length + (incomingCount.get(node.id) ?? 0) > 0,
        nearest: Math.min(...visibleBefore.filter(other => other.id !== node.id).map(other => distance(node.screen, other.screen))),
      }))
      .sort((a, b) => Number(b.connected) - Number(a.connected) || b.nearest - a.nearest)[0];
    assert.ok(target?.screen, 'real page must expose an on-screen ordinary knowledge ball for long-press acceptance');
    assert.equal(target.connected, true, 'long-press acceptance target must belong to a non-trivial relation chain');

    await dispatchPointer(page, 'pointerdown', target.screen, 71);
    await page.waitForTimeout(2650);
    await dispatchPointer(page, 'pointerup', target.screen, 71);

    await page.waitForFunction(() => window.__debug.scene.screenPositionForNode('n1') === null, null, { timeout: 3_000 });
    await page.waitForTimeout(100);
    const isolated = await snapshot(page);
    assert.equal(isolated.core, null, 'stable chain isolation must remove the normal core triad meshes while the sun is reduced to its point presentation');
    assertAuthoritativePositionsEqual(before, isolated, 'entering chain isolation');

    const active = isolated.nodes.filter(node => node.screen && !CORE_IDS.has(node.id));
    assert.ok(active.length >= 2, 'non-trivial isolated chain must retain multiple rendered chain nodes');

    const tapTarget = active
      .filter(node => node.type !== 'reasoning' && node.type !== 'logic-symbol'
        && node.screen.x > rect.x + 20 && node.screen.x < rect.x + rect.width - 20
        && node.screen.y > rect.y + 20 && node.screen.y < rect.y + rect.height - 20)
      .map(node => ({ ...node, nearest: Math.min(...active.filter(other => other.id !== node.id).map(other => distance(node.screen, other.screen))) }))
      .sort((a, b) => b.nearest - a.nearest)[0];
    assert.ok(tapTarget?.screen, 'isolated chain must leave an ordinary knowledge node tappable');

    await dispatchPointer(page, 'pointerdown', tapTarget.screen, 73);
    await dispatchPointer(page, 'pointerup', tapTarget.screen, 73);
    const detail = page.locator('#nodeDetailOverlay.open');
    await detail.waitFor({ state: 'visible' });
    assert.ok((await detail.locator('.node-detail-title').textContent())?.trim().length, 'tapping an isolated-chain knowledge node must open normal node detail');
    await detail.locator('.node-detail-close').click();
    await page.locator('#nodeDetailOverlay').waitFor({ state: 'hidden' });
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.__debug.scene.screenPositionForNode('n1')), null, 'closing node detail must return to the same isolated chain, not normal scene');

    const activeBeforeZoom = (await snapshot(page)).nodes.filter(node => node.screen && !CORE_IDS.has(node.id));
    const canvasCenter = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    const zoomProbe = activeBeforeZoom
      .map(node => ({ ...node, radial: distance(node.screen, canvasCenter) }))
      .sort((a, b) => b.radial - a.radial)[0];
    assert.ok(zoomProbe?.screen && zoomProbe.radial > 4, 'isolated chain must expose an off-center node to verify zoom');

    const pinchA0 = { x: canvasCenter.x - 35, y: canvasCenter.y };
    const pinchB0 = { x: canvasCenter.x + 35, y: canvasCenter.y };
    const pinchA1 = { x: canvasCenter.x - 70, y: canvasCenter.y };
    const pinchB1 = { x: canvasCenter.x + 70, y: canvasCenter.y };
    await dispatchPointer(page, 'pointerdown', pinchA0, 81);
    await dispatchPointer(page, 'pointerdown', pinchB0, 82);
    await dispatchPointer(page, 'pointermove', pinchA1, 81);
    await dispatchPointer(page, 'pointermove', pinchB1, 82);
    await dispatchPointer(page, 'pointerup', pinchA1, 81);
    await dispatchPointer(page, 'pointerup', pinchB1, 82);
    await page.waitForTimeout(180);
    const zoomedProbe = await page.evaluate(id => window.__debug.scene.screenPositionForNode(id), zoomProbe.id);
    assert.ok(zoomedProbe, 'zoom probe must remain rendered after isolated pinch zoom');
    assert.ok(distance(zoomedProbe, canvasCenter) > zoomProbe.radial + .5, 'pinch zoom must continue to scale isolated-chain geometry');
    assert.equal(await page.evaluate(() => window.__debug.scene.screenPositionForNode('n1')), null, 'pinch zoom must not leave chain isolation');

    const activeAfterZoom = (await snapshot(page)).nodes.filter(node => node.screen && !CORE_IDS.has(node.id));
    const blank = chooseBlank(rect, activeAfterZoom.map(node => node.screen), 24);
    const rotateProbe = activeAfterZoom
      .map(node => ({ ...node, radial: distance(node.screen, canvasCenter) }))
      .sort((a, b) => b.radial - a.radial)[0];
    assert.ok(rotateProbe?.screen && rotateProbe.radial > 4, 'isolated chain must expose an off-center node to verify rotation');
    const rotateEnd = dragDestination(rect, blank);
    await dispatchPointer(page, 'pointerdown', blank, 83);
    await dispatchPointer(page, 'pointermove', rotateEnd, 83);
    await dispatchPointer(page, 'pointerup', rotateEnd, 83);
    await page.waitForTimeout(180);
    const rotatedProbe = await page.evaluate(id => window.__debug.scene.screenPositionForNode(id), rotateProbe.id);
    assert.ok(rotatedProbe, 'rotation probe must remain rendered after isolated rotation');
    assert.ok(distance(rotatedProbe, rotateProbe.screen) > .5, 'drag rotation must continue to rotate isolated-chain geometry');
    assert.equal(await page.evaluate(() => window.__debug.scene.screenPositionForNode('n1')), null, 'rotation must not leave chain isolation');

    const activeBeforeExit = (await snapshot(page)).nodes.filter(node => node.screen && !CORE_IDS.has(node.id));
    const exitBlank = chooseBlank(rect, activeBeforeExit.map(node => node.screen), 28);
    await dispatchPointer(page, 'pointerdown', exitBlank, 91);
    await dispatchPointer(page, 'pointerup', exitBlank, 91);
    await page.waitForTimeout(1_150);

    const restored = await snapshot(page);
    assert.ok(restored.core, 'blank tap must reverse isolation and restore the normal core');
    assertAuthoritativePositionsEqual(before, restored, 'exiting chain isolation');
    const targetRestored = restored.nodes.find(node => node.id === target.id)?.screen;
    assert.ok(targetRestored, 'original long-pressed knowledge ball must return after exit');
    assert.ok(distance(targetRestored, target.screen) < 1.5, 'reverse animation must restore the pre-isolation orientation and zoom, not the temporary isolated view');
    assert.deepEqual(errors, [], `chain-isolation real-page acceptance must not emit browser errors: ${errors.join(' | ')}`);

    console.log('Chain isolation real-page acceptance passed');
  } finally {
    await browser.close();
  }
} finally {
  server.kill('SIGTERM');
}
