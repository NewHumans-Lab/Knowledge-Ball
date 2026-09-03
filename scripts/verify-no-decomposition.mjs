import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const currentFiles = [
  'src/protocol/KnowledgeEditingProtocol.ts',
  'src/command/KnowledgeEdit.ts',
  'src/event/Event.ts',
  'src/event/EventValidation.ts',
  'src/projection/GraphProjection.ts',
  'src/ui/app.ts',
  'src/ui/panels/PanelController.ts',
  'src/ui/panels/NodeDetailController.ts',
  'src/i18n/SystemCatalog.ts',
  'src/i18n/Locale.ts',
  'docs/knowledge-protocol.md',
  'docs/protocol-v1-acceptance-matrix.md',
  'docs/engineering-handbook.md',
];

const forbidden = [
  'DecomposeEdit',
  'KnowledgeDecomposed',
  "kind: 'decompose'",
  'openDecomposeForm',
  'DecomposeNodePayload',
  'detail.actionDecompose',
  'btnDecompose',
  'decomposeConclusion',
];

for (const path of currentFiles) {
  const source = await readFile(path, 'utf8');
  for (const token of forbidden) {
    assert.ok(!source.includes(token), `${path} still contains retired decomposition token: ${token}`);
  }
  assert.ok(!/\bdecompose\b/i.test(source), `${path} still contains an active decomposition reference`);
  assert.ok(!source.includes('分解'), `${path} still contains decomposition product copy`);
}

const migration = await readFile('supabase/migrations/202609030002_remove_knowledge_decomposition.sql', 'utf8');
assert.match(migration, /delete from public\.public_knowledge_events[\s\S]*event_type = 'KnowledgeDecomposed'[\s\S]*kind\}' = 'decompose'/,
  'forward migration must delete persisted decomposition events');
assert.match(migration, /delete from private\.knowledge_dependency_edges;[\s\S]*order by sequence, event_id[\s\S]*project_dependency_event/,
  'forward migration must rebuild the dependency DAG after removing decomposition events');
assert.match(migration, /if item->>'type'='KnowledgeDecomposed' or kind='decompose' then[\s\S]*raise exception 'knowledge decomposition is not supported'/,
  'server validator must explicitly reject retired decomposition payloads');
assert.match(migration, /if event_type_value = 'KnowledgeDecomposed'[\s\S]*edit ->> 'kind' = 'decompose'[\s\S]*raise exception 'knowledge decomposition is not supported'/,
  'dependency projector must reject retired decomposition payloads');
assert.match(migration, /select '202609030002'::text/,
  'schema version must advance with the removal migration');

const constraintMatch = migration.match(/add constraint public_knowledge_events_event_type_check[\s\S]*?check\(event_type in \(([\s\S]*?)\)\);/);
assert.ok(constraintMatch, 'forward migration must replace the public event-type constraint');
assert.ok(!constraintMatch[1].includes('KnowledgeDecomposed'), 'current event-type constraint must not recognize KnowledgeDecomposed');

console.log('Knowledge decomposition removal regression checks passed');
