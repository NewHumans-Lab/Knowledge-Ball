import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const panel = await readFile('src/ui/panels/PanelController.ts', 'utf8');
const detail = await readFile('src/ui/panels/NodeDetailController.ts', 'utf8');
const lineageUi = await readFile('src/ui/panels/NodeDetailLineageUi.ts', 'utf8');
const app = await readFile('src/ui/app.ts', 'utf8');
const command = await readFile('src/command/EditNode.ts', 'utf8');
const projection = await readFile('src/projection/GraphProjection.ts', 'utf8');
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const sql = await readFile('supabase/migrations/202608220007_lineage_spec_convergence.sql', 'utf8');

assert.equal(existsSync('src/ui/LineageIntentBridge.ts'), false, 'string-tunnel bridge must be removed');
assert.equal(existsSync('src/ui/panels/PanelControllerLegacy.ts'), false, 'duplicated legacy panel controller must be removed');
assert.equal(existsSync('src/ui/panels/NodeDetailControllerLegacy.ts'), false, 'duplicated legacy detail controller must be removed');

assert.match(panel, /onOptimizeNode/);
assert.match(panel, /onOpposeNode/);
assert.match(panel, /Optimize · 优化/);
assert.match(panel, /Oppose · 提出对立观点/);
assert.match(panel, /名称[\s\S]*知识层级[\s\S]*内容/);
assert.match(panel, /节点类型、前提关系和逻辑规则身份全部沿用当前球/);
assert.doesNotMatch(panel, /encodeLineageIntent|decodeLineageIntent|KBL3:/);
assert.doesNotMatch(panel, /openNegateForm|openEditForm/);

assert.doesNotMatch(detail, /NodeDetailControllerLegacy/);
assert.match(lineageUi, /class NodeDetailLineageUi/);
assert.match(lineageUi, /optimize\.textContent = '优化'/);
assert.match(lineageUi, /oppose\.textContent = '提出对立观点'/);
assert.match(lineageUi, /snapshot\.policyVersion !== 'ORIGINAL_DESIGN_V1'/);
assert.match(lineageUi, /data-cascade-vote-side="AGREE"/);
assert.match(lineageUi, /data-cascade-vote-side="DISAGREE"/);
assert.match(lineageUi, /account\.castPendingKnowledgeVote\(nodeId, side\)/);

assert.match(app, /executeKnowledgeOptimization/);
assert.match(app, /executeKnowledgeOpposition/);
assert.match(app, /onOptimizeNode: optimizeKnowledgeNode/);
assert.match(app, /onOpposeNode: opposeKnowledgeNode/);
assert.match(app, /nodeDetailLineageUi\?\.open\(id\)/);
assert.doesNotMatch(app, /LineageIntentBridge|encodeLineageIntent|decodeLineageIntent/);
assert.doesNotMatch(command, /decodeLineageIntent|executeKnowledgeOptimization|executeKnowledgeOpposition/);

assert.match(projection, /policyVersion === 'ORIGINAL_DESIGN_V1' && n\.status === 'disputed'/);
assert.match(projection, /historical initial rounds used V1/);
assert.match(pkg.scripts['test:bootstrap'], /&& node \.test-dist\/remote-first-bootstrap\.mjs/);
assert.match(pkg.scripts['test:knowledge-edits'], /KnowledgeLineageStateMachineRegression\.test\.ts/);

assert.match(sql, /immutable knowledge balls cannot be edited in place/);
assert.match(sql, /legacy negation is read-only/);
assert.match(sql, /knowledge-head-change:/);
assert.match(sql, /active revalidation round/);
assert.match(sql, /pending head-change candidate/);
assert.match(sql, /candidate_type <> target_type/);
assert.match(sql, /lineage candidate title already exists/);
assert.match(sql, /canonical_knowledge_title\(candidate_title\)[\s\S]*canonical_knowledge_title\(target_title\)/);
assert.doesNotMatch(sql, /energy_accounts|energy_ledger_entries|CHALLENGE_STAKE|VOTE_STAKE/);

console.log('Knowledge Lineage V3 structured convergence checks passed');
