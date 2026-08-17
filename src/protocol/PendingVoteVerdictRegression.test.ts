import assert from 'node:assert/strict';
import type { DomainEvent, KnowledgeVerdictFinalizedEvent } from '../event/Event';
import { isCanonicalPublicKnowledgeEvent } from '../event/Event';
import { validateDomainEventAgainstState, validateDomainEventEnvelope } from '../event/EventValidation';
import { GraphProjection } from '../projection/GraphProjection';

function pendingProjection(id: string): GraphProjection {
  const projection = new GraphProjection();
  projection.apply({
    id:`add-${id}`,
    type:'KnowledgeAdded',
    scope:'public',
    schemaVersion:1,
    timestamp:Date.now(),
    payload:{ edit:{ kind:'add', mode:'atomic', node:{ id, title:`Claim ${id}`, type:'fact', reasoning:'Pending claim' } } },
  });
  return projection;
}

function verdictEvent(nodeId: string, verdict: 'CORRECT'|'INCORRECT'): KnowledgeVerdictFinalizedEvent {
  return {
    id:`vote-verdict:round-${nodeId}`,
    type:'KnowledgeVerdictFinalized',
    scope:'public',
    schemaVersion:1,
    timestamp:Date.now(),
    payload:{
      roundId:`round-${nodeId}`,
      nodeId,
      verdict,
      closeReason:'THRESHOLD',
      agreeCount: verdict === 'CORRECT' ? 2 : 0,
      disagreeCount: verdict === 'INCORRECT' ? 2 : 0,
      requiredVotes:2,
      policyVersion:'ORIGINAL_DESIGN_V1',
    },
  };
}

const correctProjection = pendingProjection('correct');
const correct = verdictEvent('correct','CORRECT');
assert.equal(isCanonicalPublicKnowledgeEvent(correct), true, 'server verdict must travel through the canonical public sync stream');
assert.deepEqual(validateDomainEventAgainstState(correct, correctProjection.state), []);
correctProjection.apply(correct);
assert.equal(correctProjection.state.nodesById.correct.status, 'verified');
assert.equal(correctProjection.state.nodesById.correct.hidden, false, 'correct knowledge remains in the default graph');

const incorrectProjection = pendingProjection('incorrect');
const incorrect = verdictEvent('incorrect','INCORRECT');
assert.deepEqual(validateDomainEventAgainstState(incorrect, incorrectProjection.state), []);
incorrectProjection.apply(incorrect);
assert.equal(incorrectProjection.state.nodesById.incorrect.status, 'falsified');
assert.equal(incorrectProjection.state.nodesById.incorrect.hidden, true, 'incorrect knowledge moves out of the default graph into history/error classification');

assert.match(validateDomainEventAgainstState(correct, correctProjection.state)[0] ?? '', /只有待验证节点/, 'a finalized first round cannot settle the same node twice');

const malformed = {
  ...correct,
  id:'bad-verdict',
  payload:{ ...correct.payload, policyVersion:'ORIGINAL_DESIGN_V2', requiredVotes:0 },
} as unknown as DomainEvent;
const malformedErrors = validateDomainEventEnvelope(malformed);
assert.ok(malformedErrors.some(error => error.includes('policyVersion')));
assert.ok(malformedErrors.some(error => error.includes('门槛')));

console.log('Pending vote verdict event/projection regression tests passed');
