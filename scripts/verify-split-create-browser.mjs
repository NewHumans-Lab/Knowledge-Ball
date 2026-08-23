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

try {
  await waitForServer();
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader'] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });

    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.__debug?.projection?.state?.nodesById?.n3 && window.__debug?.nodeDetail && window.__debug?.knowledgeCreate));

    // Keep the browser path real while replacing only the unavailable hosted transport.
    // executeKnowledgeEdit still validates the event, commits through EventStore and drives
    // the normal projection/subscriber/scene lifecycle.
    await page.evaluate(() => {
      const debug = window.__debug;
      debug.syncEngine.commit = async event => debug.store.appendValidated(event);
      debug.projection.state.nodesById['acceptance-history'] = {
        id: 'acceptance-history', title: '验收历史节点', type: 'fact', status: 'verified', mastery: 'none', reasoning: 'history fixture', premises: [], hidden: false,
        lineage: { topicId: 'acceptance-topic', proposal: 'optimization', role: 'history', rank: 1 },
      };
      debug.projection.state.nodesById['acceptance-opposition'] = {
        id: 'acceptance-opposition', title: '验收否定节点', type: 'fact', status: 'verified', mastery: 'none', reasoning: 'opposition fixture', premises: [], hidden: false,
        lineage: { topicId: 'acceptance-topic', proposal: 'opposition', role: 'opposition', rank: 1 },
      };
      debug.scene.stop();
    });

    // Open the actual near-node edit menu and prove the old combined entry is gone.
    await page.evaluate(() => window.__debug.nodeDetail.open('n3'));
    await page.locator('#nodeDetailOverlay.open').waitFor({ state: 'visible' });
    await page.locator('.node-detail-edit').click();
    const addButton = page.locator('[data-node-detail-action="derive"]');
    const addReasoningButton = page.locator('[data-node-detail-action="derive-reasoning"]');
    await addButton.waitFor({ state: 'visible' });
    await addReasoningButton.waitFor({ state: 'visible' });
    assert.equal((await addButton.textContent())?.trim(), '新增');
    assert.equal((await addReasoningButton.textContent())?.trim(), '新增推理');
    assert.equal(await page.getByRole('button', { name: '基于此新增', exact: true }).count(), 0, 'combined create action must not remain in the real detail menu');

    // Standalone add: exactly name + layer + content, and it creates one isolated ball.
    await addButton.click();
    const overlay = page.locator('#knowledgeCreateOverlay.show');
    await overlay.waitFor({ state: 'visible' });
    assert.equal((await overlay.locator('h3').textContent())?.trim(), '新增知识');
    assert.equal(await overlay.locator('[data-create-title]').count(), 1);
    assert.equal(await overlay.locator('[data-create-layer]').count(), 1);
    assert.equal(await overlay.locator('[data-create-description]').count(), 1);
    assert.equal(await overlay.locator('[data-create-reasoning]').count(), 0, 'standalone add must not ask for a reasoning process');
    assert.equal(await overlay.locator('[data-picker]').count(), 0, 'standalone add must not expose premise/conclusion pickers');

    const standaloneTitle = '验收孤立节点';
    const beforeStandalone = await page.evaluate(() => Object.keys(window.__debug.projection.state.nodesById).length);
    await overlay.locator('[data-create-title]').fill(standaloneTitle);
    await overlay.locator('[data-create-layer]').selectOption('inner');
    await overlay.locator('[data-create-description]').fill('这是一个不带任何逻辑连线的独立知识节点。');
    await overlay.locator('[data-create-submit]').click();
    await page.locator('#knowledgeCreateOverlay.show').waitFor({ state: 'hidden' });

    const standalone = await page.evaluate(title => {
      const nodes = Object.values(window.__debug.projection.state.nodesById);
      const node = nodes.find(candidate => candidate.title === title);
      return node ? {
        id: node.id,
        premises: [...node.premises],
        incomingReferences: nodes.filter(candidate => candidate.premises?.includes(node.id)).map(candidate => candidate.id),
        count: nodes.length,
      } : null;
    }, standaloneTitle);
    assert.ok(standalone, 'standalone submission must create a real node');
    assert.equal(standalone.count, beforeStandalone + 1, 'standalone submission must create exactly one ball');
    assert.deepEqual(standalone.premises, [], 'standalone submission must have no premise line');
    assert.deepEqual(standalone.incomingReferences, [], 'standalone submission must have no downstream line');

    const baselineEdges = await page.evaluate(() => window.__debug.scene.getVisibleEdgeCount());

    // Open the split reasoning action from a real existing premise node.
    await page.evaluate(() => window.__debug.nodeDetail.open('n3'));
    await page.locator('.node-detail-edit').click();
    await page.locator('[data-node-detail-action="derive-reasoning"]').click();
    await overlay.waitFor({ state: 'visible' });
    assert.equal((await overlay.locator('h3').textContent())?.trim(), '新增推理');
    assert.equal(await overlay.locator('[data-create-title]').count(), 1);
    assert.equal(await overlay.locator('[data-create-reasoning]').count(), 1);
    assert.equal(await overlay.locator('[data-picker="premise"]').count(), 1);
    assert.equal(await overlay.locator('[data-picker="conclusion"]').count(), 1);
    assert.equal(await overlay.locator('[data-create-layer]').count(), 0, 'reasoning form must contain exactly the four requested concepts, not an extra layer field');

    const premisePicker = overlay.locator('[data-picker="premise"]');
    const premiseSelected = premisePicker.locator('[data-picker-selected]');
    assert.match((await premiseSelected.textContent()) ?? '', /质数的定义/, 'based-on-this reasoning must preselect the source node when it is an eligible premise');
    assert.equal(await premisePicker.locator('[data-picker-options] [data-picker-node-id]').first().getAttribute('data-picker-node-id'), 'n3', 'selected premise must be pinned to the top');

    const premiseOptionIds = await premisePicker.locator('[data-picker-options] [data-picker-node-id]').evaluateAll(elements => elements.map(element => element.getAttribute('data-picker-node-id')));
    assert.ok(!premiseOptionIds.some(id => id?.startsWith('r-')), 'reasoning nodes must not appear in the premise picker');
    assert.ok(!premiseOptionIds.includes(standalone.id), 'pending nodes must not appear in the premise picker');
    assert.ok(!premiseOptionIds.includes('acceptance-history'), 'history nodes must not appear in the premise picker');
    assert.ok(!premiseOptionIds.includes('acceptance-opposition'), 'opposition nodes must not appear in the premise picker');

    const nodesBeforeFreeSearch = await page.evaluate(() => Object.keys(window.__debug.projection.state.nodesById).length);
    const premiseSearch = premisePicker.locator('[data-picker-search]');
    await premiseSearch.fill('绝对不存在的前提文字XYZ');
    await premisePicker.locator('.knowledge-picker-no-results').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => Object.keys(window.__debug.projection.state.nodesById).length), nodesBeforeFreeSearch, 'typing nonexistent premise text must never create a node');
    await premiseSearch.fill('');
    assert.equal(await premisePicker.locator('[data-picker-options] [data-picker-node-id]').first().getAttribute('data-picker-node-id'), 'n3', 'selected premise must remain pinned after searching');

    const conclusionPicker = overlay.locator('[data-picker="conclusion"]');
    const conclusionOptionIds = await conclusionPicker.locator('[data-picker-options] [data-picker-node-id]').evaluateAll(elements => elements.map(element => element.getAttribute('data-picker-node-id')));
    assert.ok(!conclusionOptionIds.some(id => id?.startsWith('r-')), 'reasoning nodes must not appear in the conclusion picker');

    // Only-existing semantics: arbitrary search text yields no selectable fake item.
    const conclusionSearch = conclusionPicker.locator('[data-picker-search]');
    await conclusionSearch.fill('数据库里不存在的结论XYZ');
    await conclusionPicker.locator('.knowledge-picker-no-results').waitFor({ state: 'visible' });
    assert.equal(await conclusionPicker.locator('[data-picker-node-id]').count(), 0, 'free conclusion text must never become a selectable item');

    // Conclusion rules only exclude reasoning, so the existing pending standalone node is selectable.
    await conclusionSearch.fill(standaloneTitle);
    const conclusionOption = conclusionPicker.locator(`[data-picker-node-id="${standalone.id}"]`);
    await conclusionOption.waitFor({ state: 'visible' });
    await conclusionOption.click();
    assert.match((await conclusionPicker.locator('[data-picker-selected]').textContent()) ?? '', new RegExp(standaloneTitle), 'selected conclusion must be clearly displayed above the search box');
    assert.equal(await conclusionPicker.locator('[data-picker-options] [data-picker-node-id]').first().getAttribute('data-picker-node-id'), standalone.id, 'selected conclusion must be pinned to the top');

    const beforeReasoning = await page.evaluate(() => Object.keys(window.__debug.projection.state.nodesById).length);
    const reasoningTitle = '验收白色推理球';
    await overlay.locator('[data-create-title]').fill(reasoningTitle);
    await overlay.locator('[data-create-reasoning]').fill('由已选择的已有前提经过明确推理，连接到已选择的已有结论。');
    await overlay.locator('[data-create-submit]').click();
    await page.locator('#knowledgeCreateOverlay.show').waitFor({ state: 'hidden' });

    const reasoningResult = await page.evaluate(({ reasoningTitle, conclusionId }) => {
      const nodes = Object.values(window.__debug.projection.state.nodesById);
      const reasoning = nodes.find(candidate => candidate.title === reasoningTitle);
      const conclusion = window.__debug.projection.state.nodesById[conclusionId];
      const rendered = reasoning ? window.__debug.renderNodes.find(candidate => candidate.id === reasoning.id) : null;
      return reasoning ? {
        id: reasoning.id,
        type: reasoning.type,
        premises: [...reasoning.premises],
        conclusionPremises: conclusion ? [...conclusion.premises] : [],
        renderedType: rendered?.type ?? null,
        count: nodes.length,
      } : null;
    }, { reasoningTitle, conclusionId: standalone.id });
    assert.ok(reasoningResult, 'reasoning submission must create a real white reasoning ball');
    assert.equal(reasoningResult.count, beforeReasoning + 1, 'reasoning submission must create only the reasoning ball; premise/conclusion stay existing nodes');
    assert.equal(reasoningResult.type, 'reasoning');
    assert.equal(reasoningResult.renderedType, 'reasoning', 'scene must receive the new node as the structural white-ball type');
    assert.deepEqual(reasoningResult.premises, ['n3'], 'white reasoning ball must connect from the selected existing premise');
    assert.ok(reasoningResult.conclusionPremises.includes(reasoningResult.id), 'selected existing conclusion must connect from the new white reasoning ball');

    await page.evaluate(() => { window.__debug.scene.markDirty(); window.__debug.scene.start(); });
    await page.waitForTimeout(180);
    const finalEdges = await page.evaluate(() => { window.__debug.scene.stop(); return window.__debug.scene.getVisibleEdgeCount(); });
    assert.ok(finalEdges >= baselineEdges + 2, `real scene must add the two requested lines (before=${baselineEdges}, after=${finalEdges})`);

    assert.deepEqual(errors, [], `split-create browser path must not emit page errors: ${errors.join(' | ')}`);
    console.log('Split standalone/reasoning real mobile browser acceptance passed');
  } finally {
    await browser.close();
  }
} finally {
  server.kill('SIGTERM');
}
