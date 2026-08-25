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
  'web panel must not open the legacy combined create modal when it has no owner');
assert.match(panel, /this\.onCreateNode \? '<button class="btn ghost" id="btnDeriveNode">Add · 新增<\/button>' : ''/,
  'legacy Add control must only render where the native compatibility callback exists');
assert.match(split, /type CreateMode = 'standalone' \| 'reasoning'/,
  'canonical split create modes must remain explicit');
assert.match(split, /新增只创建一个独立知识球/,
  'standalone semantics must not be folded back into the legacy generic form');
assert.match(split, /结论[\s\S]*搜索已有结论节点/,
  'reasoning flow must retain explicit existing-conclusion selection');

console.log('Create ownership isolation checks passed');
