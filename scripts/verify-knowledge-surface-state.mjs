import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile('src/ui/app.ts', 'utf8');
const panel = await readFile('src/ui/panels/PanelController.ts', 'utf8');
const state = await readFile('src/ui/KnowledgeSurfaceState.ts', 'utf8');

assert.match(state, /class KnowledgeSurfaceState/);
assert.match(state, /nodeId: string \| null/);
assert.match(state, /surface: KnowledgeSurfaceKind/);
assert.match(app, /const knowledgeSurfaceState = new KnowledgeSurfaceState\(\)/,
  'app must own one typed knowledge surface state');
assert.doesNotMatch(app, /currentPanelId/,
  'legacy parallel selected-node flag must be removed');
assert.doesNotMatch(app, /classList\.contains\('open'\)/,
  'app must not infer knowledge surface state from DOM presentation');
assert.doesNotMatch(app, /nodeDetail\?\.isOpenFor|nodeDetail\.isOpenFor/,
  'app must not infer navigation truth from controller render caches');
assert.match(app, /surface === 'panel'\) panel\.openNodePanel\(nodeId\)/,
  'refresh must project the typed panel state');
assert.match(app, /surface === 'detail'\) nodeDetail\?\.refresh\(nodeId\)/,
  'refresh must project the typed detail state');
assert.match(panel, /onNodePanelChange\?: \(id: string \| null\) => void/,
  'panel must expose its semantic lifecycle explicitly');
assert.match(panel, /this\.onNodePanelChange\?\.\(id\)/,
  'panel open must report the selected node');
assert.match(panel, /this\.onNodePanelChange\?\.\(null\)/,
  'panel final close must report no active panel surface');
assert.match(app, /nodeDetail\?\.close\(\);\n  if \(!panel\.openNodeAction/,
  'detail-to-edit transition must transfer ownership instead of stacking two node surfaces');

console.log('Knowledge surface single-owner architecture checks passed');
