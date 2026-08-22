import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const panel = await readFile('src/ui/panels/PanelController.ts', 'utf8');
const detail = await readFile('src/ui/panels/NodeDetailController.ts', 'utf8');
const command = await readFile('src/command/EditNode.ts', 'utf8');
const sql = await readFile('supabase/migrations/202608220007_lineage_spec_convergence.sql', 'utf8');

assert.match(panel, /PanelControllerLegacy/);
assert.match(panel, /Optimize · 优化/);
assert.match(panel, /Oppose · 提出对立观点/);
assert.match(panel, /名称[\s\S]*知识层级[\s\S]*内容/);
assert.match(panel, /类型、前提关系和逻辑规则身份全部沿用当前球/);
assert.match(panel, /encodeLineageIntent/);
assert.doesNotMatch(panel, /openNegateForm/);

assert.match(detail, /NodeDetailControllerLegacy/);
assert.match(detail, /edit.*优化|优化/);
assert.match(detail, /提出对立观点/);

assert.match(command, /decodeLineageIntent/);
assert.match(command, /executeKnowledgeOptimization/);
assert.match(command, /executeKnowledgeOpposition/);
assert.match(command, /projection\.hydrate\(null, store\.allEvents\(\)\)/);

assert.match(sql, /immutable knowledge balls cannot be edited in place/);
assert.match(sql, /legacy negation is read-only/);
assert.match(sql, /knowledge-head-change:/);
assert.match(sql, /active revalidation round/);
assert.match(sql, /pending head-change candidate/);
assert.match(sql, /candidate_type <> target_type/);
assert.match(sql, /lineage candidate title already exists/);
assert.match(sql, /canonical_knowledge_title\(candidate_title\)[\s\S]*canonical_knowledge_title\(target_title\)/);
assert.doesNotMatch(sql, /energy_accounts|energy_ledger_entries|CHALLENGE_STAKE|VOTE_STAKE/);

console.log('Knowledge Lineage V3 immutable-product-path convergence checks passed');
