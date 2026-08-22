import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const dag = await readFile('supabase/migrations/202608220005_dependency_dag_projection.sql', 'utf8');
const baseCascade = await readFile('supabase/migrations/202608220006_current_change_cascade.sql', 'utf8');
const rounds = await readFile('supabase/migrations/202608220008_cascade_revalidation_rounds.sql', 'utf8');
const hardening = await readFile('supabase/migrations/202608220009_cascade_revalidation_hardening.sql', 'utf8');

// Dependency authority remains a private premise->conclusion DAG only.
assert.match(dag, /create table private\.knowledge_dependency_edges/);
assert.match(dag, /primary key \(premise_node_id, conclusion_node_id\)/);
assert.match(dag, /knowledge dependency graph must remain acyclic/);
assert.match(dag, /with recursive downstream\(node_id\)/);
assert.match(dag, /order by sequence, event_id/);
assert.doesNotMatch(dag, /order by seq, event_id/);
assert.match(dag, /create trigger project_knowledge_dependency_event/);
assert.doesNotMatch(dag, /topic_id|lineage_role|opposition_rank|history_rank/i);
for (const eventType of [
  'NodeCreated','NodeEdited','KnowledgeAdded','KnowledgeNodeEdited',
  'KnowledgeNegated','KnowledgeDecomposed','KnowledgeMerged',
]) {
  assert.ok(dag.includes(`event_type_value = '${eventType}'`), `${eventType} must be covered by dependency replay`);
}
assert.match(dag, /payload,optimization[\s\S]*where conclusion_node_id = target_id/);
assert.match(dag, /payload,opposition[\s\S]*where conclusion_node_id = target_id/);
assert.match(dag, /repoint_dependency_sources/);

// 006 remains the already-tested trigger/traversal base; later migrations own
// the real vote-round lifecycle instead of leaving descendants permanently disputed.
assert.match(baseCascade, /KnowledgeVerdictFinalized/);
assert.match(baseCascade, /KnowledgeRevalidationFinalized/);
assert.match(baseCascade, /with recursive downstream\(node_id\)/);

// 008 introduces a real pending-vote round family for automatic cascade.
assert.match(rounds, /round_kind in \('INITIAL','CASCADE'\)/);
assert.match(rounds, /initiator_id drop not null/);
assert.match(rounds, /initiator_side drop not null/);
assert.match(rounds, /knowledge_pending_votes_round_id_voter_id_key unique\(round_id,voter_id\)/i);
assert.match(rounds, /latest_pending_vote_round/);
assert.match(rounds, /stake_amount numeric\(30,6\):=1\.000000/);
assert.match(rounds, /round_row\.round_kind='INITIAL' and round_row\.initiator_id=actor/);
assert.match(rounds, /start_cascade_knowledge_revalidation/);
assert.match(rounds, /with recursive downstream\(node_id\)/);
assert.match(rounds, /lm\.role='current'/g);
assert.match(rounds, /\n\s*union\n/);
assert.match(rounds, /where node_id<>new_current_id/);
assert.match(rounds, /order by node_id/);

// 009 is the authoritative convergence layer: the round row owns PENDING truth;
// disputed is only the existing flashing projection state.
assert.match(hardening, /has_active_cascade_round/);
assert.match(hardening, /finalize_pending_vote_round_v2_and_legacy/);
assert.match(hardening, /finalize_cascade_pending_vote_round/);
assert.match(hardening, /round_row\.round_kind<>'CASCADE'/);
assert.match(hardening, /if agree_count=disagree_count then[\s\S]*'PENDING'/);
assert.match(hardening, /'timeout_model','TIE_STAYS_PENDING'/);
assert.match(hardening, /'pool_model','ORDINARY_ONLY'/);
assert.match(hardening, /cascade-vote-settlement:/);
assert.match(hardening, /creator_stake_transaction_id/);
assert.doesNotMatch(hardening, /creator_payout:=2\.000000/, 'cascade settlement must have no creator/system wager position');
assert.match(hardening, /'status','disputed'/);
assert.doesNotMatch(hardening, /'status','pending'/, 'cascade projection must not invent a client-writable pending status command');
assert.match(hardening, /case when decided_verdict='CORRECT' then 'verified' else 'suspended' end/);
assert.doesNotMatch(hardening, /KnowledgeVerdictFinalized/, 'cascade finalization must not masquerade as a first-round verdict event');
assert.match(hardening, /knowledge_ball\.internal_cascade_write/);
assert.match(hardening, /active cascade revalidation can only be finalized by its vote round/);
assert.match(hardening, /knowledge topic current head is under cascade revalidation/);
assert.match(hardening, /select '202608220009'::text/);

// The automatic cascade has no public start/finalize RPC and no initiator row.
assert.doesNotMatch(hardening, /grant execute on function private\.start_cascade/i);
assert.match(rounds, /'ORIGINAL_DESIGN_V1',null,null/);

// All three legitimate current-version transitions remain propagation sources.
assert.match(rounds, /proposal_kind in\('optimization','opposition'\)/);
assert.match(rounds, /KnowledgeRevalidationFinalized/);
assert.match(rounds, /role_at_start_value='history'/);
assert.match(rounds, /role_at_start_value='opposition'/);

// Effective dependency source moves only after descendants are discovered.
const startIndex = rounds.indexOf('start_cascade_knowledge_revalidation');
const repointIndex = rounds.indexOf('perform private.repoint_dependency_sources');
assert.ok(startIndex >= 0 && repointIndex > startIndex, 'effective dependency repoint must happen after cascade target discovery');

// Small executable oracle: current-only, recursive, diamond-deduplicated, and no
// history/opposition bridge.
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
], ['A2','B-current','C'], 'A1'), ['B-current','C']);

console.log('Knowledge Lineage automatic cascade lifecycle checks passed');
