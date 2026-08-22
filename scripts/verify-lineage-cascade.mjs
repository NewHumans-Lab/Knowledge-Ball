import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const dag = await readFile('supabase/migrations/202608220005_dependency_dag_projection.sql', 'utf8');
const cascade = await readFile('supabase/migrations/202608220006_current_change_cascade.sql', 'utf8');

// Module 6 owns logical premise edges only. Raw tables are private and browser
// roles cannot use them as a second public graph API.
assert.match(dag, /create table private\.knowledge_dependency_edges/);
assert.match(dag, /primary key \(premise_node_id, conclusion_node_id\)/);
assert.match(dag, /alter table private\.knowledge_dependency_edges enable row level security/);
assert.match(dag, /revoke all on private\.knowledge_dependency_edges from public, anon, authenticated/);
assert.doesNotMatch(dag, /topic_id|lineage_role|opposition_rank|history_rank/i, 'lineage relations must not be stored as logical DAG edges');

// The projection follows the event semantics that can actually alter premises.
for (const eventType of [
  'NodeCreated', 'NodeEdited', 'KnowledgeAdded', 'KnowledgeNodeEdited',
  'KnowledgeNegated', 'KnowledgeDecomposed', 'KnowledgeMerged',
]) {
  assert.ok(dag.includes(`event_type_value = '${eventType}'`), `${eventType} must be covered by dependency replay`);
}
assert.match(dag, /knowledge dependency graph must remain acyclic/);
assert.match(dag, /with recursive downstream\(node_id\)/);
// Hosted public_knowledge_events exposes the authoritative append order as
// `sequence` (not the in-memory DomainEvent `seq` alias). Backfill must follow
// the hosted schema exactly or a fresh migration fails before creating the DAG.
assert.match(dag, /order by sequence, event_id/);
assert.doesNotMatch(dag, /order by seq, event_id/);
assert.match(dag, /create trigger project_knowledge_dependency_event/);

// Current-version replacement inherits/represents effective dependency identity
// without mutating immutable ball payloads.
assert.match(dag, /payload,optimization[\s\S]*where conclusion_node_id = target_id/);
assert.match(dag, /payload,opposition[\s\S]*where conclusion_node_id = target_id/);
assert.match(dag, /repoint_dependency_sources/);

// Cascade reuses the existing server-readable KnowledgeStatusChanged contract.
assert.match(cascade, /'type', 'KnowledgeStatusChanged'/);
assert.match(cascade, /'status', 'disputed'/);
assert.match(cascade, /'causeNodeId', old_current_id/);
assert.doesNotMatch(cascade, /KnowledgeCascadeRevalidationStarted/);

// Traverse only CURRENT descendants; UNION deduplicates diamonds/cycles and the
// migration itself keeps cycles impossible.
assert.match(cascade, /lm\.role = 'current'/g);
assert.match(cascade, /with recursive downstream\(node_id\)/);
assert.match(cascade, /\n\s*union\n/);
assert.match(cascade, /where node_id <> new_current_id/);
assert.match(cascade, /order by node_id/);

// All three current-version transitions trigger propagation: optimization win,
// opposition win and old gray/red reactivation win.
assert.match(cascade, /KnowledgeVerdictFinalized/);
assert.match(cascade, /proposal_kind in \('optimization', 'opposition'\)/);
assert.match(cascade, /KnowledgeRevalidationFinalized/);
assert.match(cascade, /role_at_start_value = 'history'/);
assert.match(cascade, /role_at_start_value = 'opposition'/);

// Effective edge source follows the new current only AFTER downstream targets
// were discovered. This lets A2->A3 reach the same B/C/D without rewriting B.
const emitIndex = cascade.indexOf("insert into public.public_knowledge_events");
const repointIndex = cascade.indexOf('perform private.repoint_dependency_sources');
assert.ok(emitIndex >= 0 && repointIndex > emitIndex, 'effective dependency repoint must happen after cascade target discovery');

// Automatic propagation deliberately has no V1/V2 economics or human actor.
for (const forbidden of [
  'CHALLENGE_STAKE', 'CHALLENGE_VOTE_STAKE', 'VOTE_STAKE', 'CLAIM_STAKE',
  'energy_accounts', 'energy_ledger_entries', 'knowledge_revalidation_rounds',
]) {
  if (forbidden === 'knowledge_revalidation_rounds') continue; // read-only role_at_start lookup is required.
  assert.ok(!cascade.includes(forbidden), `module 6 must not change energy semantics: ${forbidden}`);
}
assert.doesNotMatch(cascade, /insert into private\.knowledge_revalidation_rounds/i);
assert.doesNotMatch(cascade, /update private\.knowledge_revalidation_rounds/i);
assert.match(cascade, /select '202608220006'::text/);

// Small executable oracle for the required A->B->C->D + diamond behavior.
function currentDownstream(edges, currentIds, start) {
  const current = new Set(currentIds);
  const visited = new Set();
  const queue = [start];
  while (queue.length) {
    const source = queue.shift();
    for (const [from, to] of edges) {
      if (from !== source || !current.has(to) || visited.has(to)) continue;
      visited.add(to);
      queue.push(to);
    }
  }
  visited.delete(start);
  return [...visited].sort();
}

assert.deepEqual(currentDownstream([
  ['A1','B'], ['B','C'], ['C','D'], ['B','D'],
], ['A2','B','C','D'], 'A1'), ['B','C','D']);
assert.deepEqual(currentDownstream([
  ['A1','B-old'], ['B-old','C'], ['A1','B-current'], ['B-current','C'],
], ['A2','B-current','C'], 'A1'), ['B-current','C'], 'history nodes cannot bridge a cascade');

console.log('Knowledge Lineage module 6 downstream cascade checks passed');