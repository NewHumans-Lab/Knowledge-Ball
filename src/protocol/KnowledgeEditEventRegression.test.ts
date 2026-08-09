import { strict as assert } from 'node:assert';
import { EventStore, type EventPersistence } from '../event/EventStore';
import type { DomainEvent } from '../event/Event';
import { validateDomainEventAgainstState } from '../event/EventValidation';
import { GraphProjection } from '../projection/GraphProjection';
import type { GraphState } from '../state/GraphState';
import { executeKnowledgeEdit, KnowledgeEditValidationError } from '../command/KnowledgeEdit';

class MemoryPersistence implements EventPersistence {
  events: DomainEvent[] = [];
  loadLocal(): DomainEvent[] { return structuredClone(this.events); }
  saveLocal(events: DomainEvent[]): void { this.events = structuredClone(events); }
}

function boot(persistence: MemoryPersistence) {
  const projection = new GraphProjection();
  const store = new EventStore<GraphState>(
    () => structuredClone(projection.state),
    persistence,
    event => validateDomainEventAgainstState(event, projection.state),
  );
  store.subscribe(event => projection.apply(event));
  return { store, projection };
}

async function addAtomic(
  runtime: ReturnType<typeof boot>,
  id: string,
  title: string,
  type: 'fact' | 'definition' | 'logic-symbol',
  reasoning: string,
) {
  return executeKnowledgeEdit(runtime.store, runtime.projection, {
    kind: 'add',
    mode: 'atomic',
    node: { id, title, type, reasoning },
  });
}

async function run(): Promise<void> {
  const persistence = new MemoryPersistence();
  let runtime = boot(persistence);

  await addAtomic(runtime, 'logic', 'Implication rule', 'logic-symbol', 'Classifies a deductive implication');
  await addAtomic(runtime, 'p1', 'Premise one', 'fact', 'First premise description');
  await addAtomic(runtime, 'p2', 'Premise two', 'fact', 'Second premise description');
  await addAtomic(runtime, 'counter', 'Counterexample', 'fact', 'Evidence contradicting the first conclusion');
  await addAtomic(runtime, 'counter-counter', 'Counter-counterexample', 'fact', 'Evidence rejecting the counterexample');

  const beforeInvalid = runtime.store.size();
  await assert.rejects(
    executeKnowledgeEdit(runtime.store, runtime.projection, {
      kind: 'add',
      mode: 'theory',
      requiredPremiseIds: [],
      reasoning: {
        id: 'invalid-r',
        title: 'Incomplete inference',
        type: 'reasoning',
        reasoning: 'Incomplete inference body',
      },
      conclusion: {
        id: 'invalid-c',
        title: 'Incomplete conclusion',
        type: 'theorem',
        reasoning: 'Incomplete conclusion body',
      },
    }),
    KnowledgeEditValidationError,
  );
  assert.equal(runtime.store.size(), beforeInvalid, 'invalid command must not append any event');

  const beforeAdd = runtime.store.size();
  const addEvent = await executeKnowledgeEdit(runtime.store, runtime.projection, {
    kind: 'add',
    mode: 'theory',
    requiredPremiseIds: ['p1', 'p2'],
    reasoning: {
      id: 'r1',
      title: 'Inference one',
      type: 'reasoning',
      reasoning: 'Infer the first result from both premises',
      logicRuleId: 'logic',
    },
    conclusion: {
      id: 'c1',
      title: 'Conclusion one',
      type: 'theorem',
      reasoning: 'The first derived conclusion',
    },
  });
  assert.equal(addEvent.type, 'KnowledgeAdded');
  assert.equal(runtime.store.size(), beforeAdd + 1, 'complete theory must be one atomic event');
  assert.deepEqual(runtime.projection.state.nodesById.r1.premises, ['p1', 'p2']);
  assert.deepEqual(runtime.projection.state.nodesById.c1.premises, ['r1']);

  runtime = boot(persistence);
  assert.deepEqual(runtime.projection.state.nodesById.c1.premises, ['r1'], 'add event must survive reload');
  assert.equal(runtime.projection.state.nodesById.r1.logicRuleId, 'logic', 'logic classification must survive reload');

  const beforeDecompose = runtime.store.size();
  const decomposeEvent = await executeKnowledgeEdit(runtime.store, runtime.projection, {
    kind: 'decompose',
    chain: { premiseIds: ['p1', 'p2'], reasoningId: 'r1', conclusionId: 'c1' },
    reasoningSteps: [
      { id: 'r1a', title: 'Inference step A', type: 'reasoning', reasoning: 'First atomic inference step', logicRuleId: 'logic' },
      { id: 'r1b', title: 'Inference step B', type: 'reasoning', reasoning: 'Second atomic inference step', logicRuleId: 'logic' },
    ],
    intermediateConclusions: [
      { id: 'm1', title: 'Intermediate result', type: 'theorem', reasoning: 'Result connecting both inference steps' },
    ],
  });
  assert.equal(decomposeEvent.type, 'KnowledgeDecomposed');
  assert.equal(runtime.store.size(), beforeDecompose + 1, 'decomposition must append one event');
  assert.equal(runtime.projection.state.nodesById.r1.hidden, true);
  assert.deepEqual(runtime.projection.state.nodesById.r1a.premises, ['p1', 'p2']);
  assert.deepEqual(runtime.projection.state.nodesById.m1.premises, ['r1a']);
  assert.deepEqual(runtime.projection.state.nodesById.r1b.premises, ['m1']);
  assert.deepEqual(runtime.projection.state.nodesById.c1.premises, ['r1b']);

  await addAtomic(runtime, 'def-a', 'Definition wording A', 'definition', 'First linguistic expression of the concept');
  await addAtomic(runtime, 'def-b', 'Definition wording B', 'definition', 'Second linguistic expression of the concept');
  const mergeDefinitionEvent = await executeKnowledgeEdit(runtime.store, runtime.projection, {
    kind: 'merge',
    mode: 'definition',
    sourceNodeIds: ['def-a', 'def-b'],
    semanticKey: 'definition:concept',
    mergedDefinition: {
      id: 'def-merged',
      title: 'Canonical concept definition',
      type: 'definition',
      reasoning: 'Unified expression of the concept',
    },
  });
  assert.equal(mergeDefinitionEvent.type, 'KnowledgeMerged');
  assert.equal(runtime.projection.state.nodesById['def-a'].hidden, true);
  assert.equal(runtime.projection.state.nodesById['def-b'].hidden, true);

  const sizeBeforeHiddenDuplicate = runtime.store.size();
  await assert.rejects(
    addAtomic(runtime, 'def-duplicate', 'Definition wording A', 'definition', 'A new but invalid description'),
    KnowledgeEditValidationError,
  );
  assert.equal(runtime.store.size(), sizeBeforeHiddenDuplicate, 'hidden history must still block duplicates');

  await executeKnowledgeEdit(runtime.store, runtime.projection, {
    kind: 'add',
    mode: 'theory',
    requiredPremiseIds: ['p1'],
    reasoning: {
      id: 'merge-r1',
      title: 'Merge source inference one',
      type: 'reasoning',
      reasoning: 'First wording of the shared inference',
      logicRuleId: 'logic',
    },
    conclusion: {
      id: 'merge-c1',
      title: 'Merge source conclusion one',
      type: 'hypothesis',
      reasoning: 'First wording of the shared conclusion',
    },
  });
  await executeKnowledgeEdit(runtime.store, runtime.projection, {
    kind: 'add',
    mode: 'theory',
    requiredPremiseIds: ['p1'],
    reasoning: {
      id: 'merge-r2',
      title: 'Merge source inference two',
      type: 'reasoning',
      reasoning: 'Second wording of the shared inference',
      logicRuleId: 'logic',
    },
    conclusion: {
      id: 'merge-c2',
      title: 'Merge source conclusion two',
      type: 'hypothesis',
      reasoning: 'Second wording of the shared conclusion',
    },
  });
  const mergeTheoryEvent = await executeKnowledgeEdit(runtime.store, runtime.projection, {
    kind: 'merge',
    mode: 'theory',
    chains: [
      { premiseIds: ['p1'], reasoningId: 'merge-r1', conclusionId: 'merge-c1' },
      { premiseIds: ['p1'], reasoningId: 'merge-r2', conclusionId: 'merge-c2' },
    ],
    reasoningSemanticKey: 'inference:shared',
    semanticKey: 'conclusion:shared',
    mergedReasoning: {
      id: 'merge-r',
      title: 'Canonical merged inference',
      type: 'reasoning',
      reasoning: 'Canonical synthesis of the shared inference',
      logicRuleId: 'logic',
    },
    mergedConclusion: {
      id: 'merge-c',
      title: 'Canonical merged conclusion',
      type: 'hypothesis',
      reasoning: 'Canonical synthesis of the shared conclusion',
    },
  });
  assert.equal(mergeTheoryEvent.type, 'KnowledgeMerged');
  assert.equal(runtime.projection.state.nodesById['merge-r'].semanticKey, 'inference:shared');
  assert.deepEqual(runtime.projection.state.nodesById['merge-c'].premises, ['merge-r']);
  assert.equal(runtime.projection.state.nodesById['merge-r1'].hidden, true);
  assert.equal(runtime.projection.state.nodesById['merge-c2'].hidden, true);

  const negateEvent = await executeKnowledgeEdit(runtime.store, runtime.projection, {
    kind: 'negate',
    target: 'conclusion',
    targetId: 'merge-c',
    counterexampleIds: ['counter'],
  });
  assert.equal(negateEvent.type, 'KnowledgeNegated');
  assert.equal(runtime.projection.state.nodesById['merge-c'].hidden, true);
  assert.equal(runtime.projection.state.nodesById['merge-c'].status, 'falsified');

  const beforeDirectRestore = runtime.store.size();
  assert.throws(() => runtime.store.append({
    id: 'illegal-direct-restore',
    type: 'NodeResolved',
    schemaVersion: 1,
    timestamp: Date.now(),
    payload: { nodeId: 'merge-c' },
  }));
  assert.equal(runtime.store.size(), beforeDirectRestore, 'falsified claims cannot be restored by a direct status event');

  await executeKnowledgeEdit(runtime.store, runtime.projection, {
    kind: 'negate',
    target: 'conclusion',
    targetId: 'counter',
    counterexampleIds: ['counter-counter'],
  });
  assert.equal(runtime.projection.state.nodesById['merge-c'].hidden, false, 'claim must restore only after opposition is negated');
  assert.equal(runtime.projection.state.nodesById['merge-c'].status, 'pending');

  const beforeMalformed = runtime.store.size();
  assert.throws(() => runtime.store.append({
    id: 'malformed-event',
    type: 'KnowledgeAdded',
    schemaVersion: 1,
    timestamp: Date.now(),
    payload: {
      edit: {
        kind: 'negate',
        target: 'conclusion',
        targetId: 'p1',
        counterexampleIds: ['p2'],
      },
    },
  } as unknown as DomainEvent));
  assert.equal(runtime.store.size(), beforeMalformed, 'mismatched event type/payload must be rejected before append');

  const finalSize = runtime.store.size();
  runtime = boot(persistence);
  runtime = boot(persistence);
  assert.equal(runtime.store.size(), finalSize, 'repeated reload must not duplicate edit events');
  assert.equal(runtime.projection.state.nodesById.r1.hidden, true, 'decomposed source must survive as hidden history');
  assert.equal(runtime.projection.state.nodesById['def-a'].hidden, true, 'merged source must survive as hidden history');
  assert.equal(runtime.projection.state.nodesById['merge-c'].hidden, false, 'restored state must survive replay');

  console.log('Knowledge edit command/event regression tests passed');
}

void run();
