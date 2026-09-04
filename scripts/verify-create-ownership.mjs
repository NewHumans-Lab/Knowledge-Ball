import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile('src/ui/app.ts', 'utf8');
const panel = await readFile('src/ui/panels/PanelController.ts', 'utf8');
const split = await readFile('src/ui/panels/KnowledgeCreateController.ts', 'utf8');

assert.match(app, /onCreateNode: Capacitor\.isNativePlatform\(\) \? createKnowledgeNode : undefined/,
  'legacy combined create must be wired only on native compatibility surfaces');
assert.match(app, /knowledgeCreate = new KnowledgeCreateController/,
  'split create controller remains the canonical product controller');
assert.match(app, /knowledgeCreate\.openStandalone\(\)/,
  'standalone creation must remain available');
assert.match(app, /knowledgeCreate\.openReasoning\(/,
  'reasoning creation must remain available');
assert.match(panel, /onCreateNode\?: \(payload: CreateNodePayload\)/,
  'legacy create callback must be optional rather than a universal panel dependency');
assert.match(panel, /if \(!this\.onCreateNode\) return;[\s\S]*this\.prefillPremise = prefillPremiseId/,
  'web panel must not open the native compatibility combined create modal when it has no owner');
assert.doesNotMatch(panel, /btnDeriveNode|Add · 新增/,
  'the removed legacy node-detail surface must not retain a second Add control');
assert.match(split, /type CreateMode = 'standalone' \| 'reasoning'/,
  'canonical split create modes must remain explicit');
assert.match(split, /systemUiText\('create\.standaloneNote'\)/,
  'standalone semantics must remain explicit through localized system copy');
assert.doesNotMatch(split, /新增只创建一个独立知识球/,
  'canonical split create UI must not hard-code the Chinese standalone note');
assert.match(split, /systemUiText\('create\.conclusionSingle'\)/,
  'reasoning flow must retain an explicit localized single-conclusion label');
assert.match(split, /systemUiText\('create\.searchConclusion'\)/,
  'reasoning flow must retain localized existing-conclusion search');
assert.doesNotMatch(split, /结论（只能选择一个）|搜索已有结论节点/,
  'reasoning system copy must come from i18n rather than hard-coded Chinese');

console.log('Create ownership isolation, legacy-detail cleanup, and i18n checks passed');
