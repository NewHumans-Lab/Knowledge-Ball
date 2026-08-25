import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const files = {
  app: await readFile('src/ui/app.ts', 'utf8'),
  projection: await readFile('src/projection/GraphProjection.ts', 'utf8'),
  graph: await readFile('src/graph/Graph.ts', 'utf8'),
  scene: await readFile('src/ui/scene/KnowledgeScene.ts', 'utf8'),
  panel: await readFile('src/ui/panels/PanelController.ts', 'utf8'),
  html: await readFile('index.html', 'utf8'),
  cascadeMigration: await readFile('supabase/migrations/202608220008_cascade_revalidation_rounds.sql', 'utf8'),
};

for (const [name, source] of Object.entries(files).filter(([name]) => name !== 'cascadeMigration')) {
  assert.doesNotMatch(source, /depthLimit|setCascadeDepthLimit|reachableForCascade|cascadeReachable/,
    `${name} must not expose a client-side public cascade depth authority`);
}
assert.doesNotMatch(files.graph, /dependentsOf/,
  'dead client-only cascade traversal helper must stay removed');
assert.match(files.cascadeMigration, /with recursive downstream\(node_id\) as \(/,
  'server must recursively enumerate downstream current knowledge');
assert.match(files.cascadeMigration, /perform private\.emit_downstream_revalidation\(/,
  'current-head changes must invoke the authoritative server cascade');
assert.match(files.cascadeMigration, /private\.start_cascade_knowledge_revalidation\(/,
  'server cascade must create real revalidation rounds');
assert.doesNotMatch(files.cascadeMigration, /depth[_ ]?limit/i,
  'authoritative public cascade must not depend on a browser-configurable depth limit');

console.log('Cascade authority regression checks passed');
