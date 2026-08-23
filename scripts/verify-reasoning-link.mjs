import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/202608230001_reasoning_link_add.sql', import.meta.url), 'utf8');
const protocol = await readFile(new URL('../src/protocol/KnowledgeEditingProtocol.ts', import.meta.url), 'utf8');
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
assert.match(migration, /select '202608230001'::text/);

assert.match(protocol, /mode: 'reasoning-link'/);
assert.match(protocol, /conclusionIds: string\[\]/);
assert.match(protocol, /validReasoningLinkPremise/);
assert.match(protocol, /reachesDownstream/);
assert.match(app, /knowledgeCreate\.openStandalone\(\)/);
assert.match(app, /knowledgeCreate\.openReasoning\(id\)/);
assert.match(app, /type: 'reasoning'/);
assert.match(app, /\[reasoningId\]: 'middle'/);
assert.match(detail, /derive: '新增'/);
assert.match(detail, /'derive-reasoning': '新增推理'/);
assert.doesNotMatch(detail, /基于此新增/);

assert.match(createUi, /data-picker-search/);
assert.match(createUi, /data-picker-selected/);
assert.match(createUi, /selectedOrder/);
assert.match(createUi, /没有匹配的已有节点/);
assert.match(createUi, /onCreateReasoning\(\{ title, premiseIds, reasoning, conclusionIds \}\)/);

console.log('Reasoning-link UI, protocol, and authoritative DAG architecture checks passed');
