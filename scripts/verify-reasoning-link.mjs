import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/202608230001_reasoning_link_add.sql', import.meta.url), 'utf8');
const identityMigration = await readFile(new URL('../supabase/migrations/202608290001_reasoning_concrete_conclusion_identity.sql', import.meta.url), 'utf8');
const protocol = await readFile(new URL('../src/protocol/KnowledgeEditingProtocol.ts', import.meta.url), 'utf8');
const command = await readFile(new URL('../src/command/KnowledgeEdit.ts', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/ui/app.ts', import.meta.url), 'utf8');
const detail = await readFile(new URL('../src/ui/panels/NodeDetailController.ts', import.meta.url), 'utf8');
const createUi = await readFile(new URL('../src/ui/panels/KnowledgeCreateController.ts', import.meta.url), 'utf8');

assert.match(migration, /validate_reasoning_link_event/);
assert.match(migration, /project_reasoning_link_event_values/);
assert.match(migration, /replace_knowledge_dependencies\(reasoning_id,premise_ids\)/);
assert.match(migration, /replace_knowledge_dependencies\(conclusion_id,rewritten\)/);
assert.match(migration, /reasoning-link premise must already be verified/);
assert.match(migration, /lineage_role<>?'current'|lineage_role\s*<>\s*'current'/);
assert.match(migration, /reasoning-link conclusion cannot be a reasoning node/);

assert.match(identityMigration, /jsonb_array_length\(edit->'conclusionIds'\)<>1/);
assert.match(identityMigration, /concrete_conclusion_id:=edit#>>'\{conclusionIds,0\}'/);
assert.match(identityMigration, /e\.conclusion_node_id=concrete_conclusion_id/);
assert.match(identityMigration, /select '202608290001'::text/);

assert.match(protocol, /mode: 'reasoning-link'/);
assert.match(protocol, /conclusionIds: string\[\]/);
assert.match(protocol, /edit\.conclusionIds\.length !== 1/);
assert.match(protocol, /新增推理必须且只能选择一个已有结论/);
assert.match(protocol, /validReasoningLinkPremise/);
assert.match(protocol, /reachesDownstream/);
assert.match(command, /resolveReasoningConclusion\(reasoning, nodes\)/);
assert.match(command, /concreteConclusion\?\.id === expectedConclusionId/);

assert.match(app, /knowledgeCreate\.openStandalone\(\)/);
assert.match(app, /knowledgeCreate\.openReasoning\(id\)/);
assert.match(app, /type: 'reasoning'/);
assert.match(app, /\[reasoningId\]: 'middle'/);
assert.match(detail, /derive: 'detail\.actionAdd'/);
assert.match(detail, /'derive-reasoning': 'detail\.actionAddReasoning'/);
assert.doesNotMatch(detail, /derive: '新增'|'derive-reasoning': '新增推理'|基于此新增/, 'detail create actions must come from i18n keys');

assert.match(createUi, /data-picker-search/);
assert.match(createUi, /data-picker-selected/);
assert.match(createUi, /if \(kind === 'conclusion'\) selected\.clear\(\)/);
assert.match(createUi, /conclusionIds\.length !== 1/);
assert.match(createUi, /selectedOrder/);
assert.match(createUi, /systemUiText\(active \? 'create\.selectedCancel' : 'create\.select'\)/);
assert.match(createUi, /systemUiText\('create\.noExisting'\)/);
assert.doesNotMatch(createUi, /没有匹配的已有节点/, 'create-picker empty state must come from i18n rather than hard-coded Chinese');
assert.match(createUi, /onCreateReasoning\(\{ title, premiseIds, reasoning, conclusionIds \}\)/);

console.log('Reasoning-link single-concrete-conclusion UI, protocol, database identity, DAG, and i18n architecture checks passed');
