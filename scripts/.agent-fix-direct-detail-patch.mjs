import { readFileSync, writeFileSync } from 'node:fs';

const path = 'scripts/.agent-direct-detail-personal-visibility.mjs';
let source = readFileSync(path, 'utf8');

function mustReplace(before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one patch-script match, got ${count}`);
  source = source.replace(before, after);
}

mustReplace(
  String.raw`/  const canvasBox=await page\.locator\('#canvasHost'\)\.boundingBox\(\);[\s\S]*?  assert\.equal\(state\.graphFlushes, graphFlushesBeforeDetailTap, 'viewed-node mastery must not trigger a full graph render\/layout flush'\);\n/`,
  String.raw`/  const canvasBox\s*=\s*await page\.locator\('#canvasHost'\)\.boundingBox\(\);[\s\S]*?  assert\.equal\(state\.graphFlushes, graphFlushesBeforeDetailTap, 'viewed-node mastery must not trigger a full graph render\/layout flush'\);\n/`,
  'Issue #51 spaced source matcher',
);

mustReplace(
  "`async function waitForNodePoint(page, id) {\\n  await page.waitForFunction(nodeId => Boolean(window.__debug?.scene?.screenPositionForNode(nodeId)), id, { timeout: 5_000 });\\n  return page.evaluate(nodeId => window.__debug.scene.screenPositionForNode(nodeId), id);\\n}\\n\\nasync function assertNodeStayedNear",
  "`async function waitForNodePoint(page, id) {\\n  await page.waitForFunction(nodeId => Boolean(window.__debug?.scene?.screenPositionForNode(nodeId)), id, { timeout: 5_000 });\\n  return page.evaluate(nodeId => window.__debug.scene.screenPositionForNode(nodeId), id);\\n}\\n\\n// Legacy helper name remains for lineage lifecycle checks; it now only waits for\\n// the physical node to be renderable and deliberately performs no centering.\\nasync function waitForNodeAtCanvasCenter(page, id) { return waitForNodePoint(page, id); }\\n\\nasync function assertNodeStayedNear",
  'relation-browser compatibility helper',
);

mustReplace(
  "replaceExact('scripts/verify-node-detail-relations-browser.mjs',\n`    await previousReasoning.tap();\\n    await page.waitForFunction(`,\n`    const previousReasoningPoint = await waitForNodePoint(page, candidate.previousReasoningId);\\n    await previousReasoning.tap();\\n    await page.waitForFunction(`);",
  "replaceRegex('scripts/verify-node-detail-relations-browser.mjs',\n/    \\/\\/ must keep the navigator open,[\\s\\S]*?    await previousReasoning\\.tap\\(\\);\\n    await page\\.waitForFunction\\(/,\n`    // must keep the navigator open, switch its content, and preserve that\\n    // physical white reasoning ball at its current projected position.\\n    const previousReasoningPoint = await waitForNodePoint(page, candidate.previousReasoningId);\\n    await previousReasoning.tap();\\n    await page.waitForFunction(`);",
  'unique previous-reasoning navigation matcher',
);

mustReplace(
  "replaceExact('scripts/verify-node-detail-relations-browser.mjs',\n`    await waitForNodeAtCanvasCenter(page, candidate.id);`,\n`    await assertNodeStayedNear(page, candidate.id, conclusionPoint);`);",
  "replaceRegex('scripts/verify-node-detail-relations-browser.mjs',\n/(    const conclusionPoint = await waitForNodePoint\\(page, candidate\\.id\\);[\\s\\S]*?    \\);\\n)    await waitForNodeAtCanvasCenter\\(page, candidate\\.id\\);/,\n`$1    await assertNodeStayedNear(page, candidate.id, conclusionPoint);`);",
  'unique conclusion-return navigation matcher',
);

writeFileSync(path, source);
console.log('Adjusted one-shot patch matchers for current browser regression source');
