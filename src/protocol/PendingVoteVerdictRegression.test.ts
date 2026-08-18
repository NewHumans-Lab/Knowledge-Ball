import assert from 'node:assert/strict';
import type { DomainEvent, KnowledgeVerdictFinalizedEvent, KnowledgeVerdictPolicyVersion } from '../event/Event';
import { isCanonicalPublicKnowledgeEvent, isPublicKnowledgeEvent } from '../event/Event';
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

function verdictEvent(
  nodeId: string,
  verdict: 'CORRECT'|'INCORRECT',
  policyVersion: KnowledgeVerdictPolicyVersion = 'ORIGINAL_DESIGN_V1',
  closeReason: 'THRESHOLD'|'TIMEOUT' = 'THRESHOLD',
): KnowledgeVerdictFinalizedEvent {
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
      closeReason,
      agreeCount: verdict === 'CORRECT' ? 2 : 0,
      disagreeCount: verdict === 'INCORRECT' && closeReason === 'THRESHOLD' ? 2 : 0,
      requiredVotes:2,
      policyVersion,
    },
  };
}

const correctProjection = pendingProjection('correct');
const correct = verdictEvent('correct','CORRECT');
assert.equal(isPublicKnowledgeEvent(correct), true, 'server verdict must be readable through the public event stream');
assert.equal(isCanonicalPublicKnowledgeEvent(correct), false, 'server verdict must never enter the client upload queue');
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

const timeoutProjection = pendingProjection('timeout-v2');
const timeoutV2 = verdictEvent('timeout-v2','INCORRECT','ORIGINAL_DESIGN_V2','TIMEOUT');
assert.deepEqual(validateDomainEventAgainstState(timeoutV2, timeoutProjection.state), [], 'V2 timeout failure must be a valid server verdict event');
timeoutProjection.apply(timeoutV2);
assert.equal(timeoutProjection.state.nodesById['timeout-v2'].status, 'falsified');
assert.equal(timeoutProjection.state.nodesById['timeout-v2'].hidden, true, 'V2 insufficient-support timeout must leave the default graph');

assert.match(validateDomainEventAgainstState(correct, correctProjection.state)[0] ?? '', /只有待验证节点/, 'a finalized first round cannot settle the same node twice');

const malformed = {
  ...correct,
  id:'bad-verdict',
  payload:{ ...correct.payload, policyVersion:'ORIGINAL_DESIGN_V3', requiredVotes:0 },
} as unknown as DomainEvent;
const malformedErrors = validateDomainEventEnvelope(malformed);
assert.ok(malformedErrors.some(error => error.includes('policyVersion')));
assert.ok(malformedErrors.some(error => error.includes('门槛')));

console.log('Pending vote verdict event/projection regression tests passed');
