import { strict as assert } from 'node:assert';
import { EventStore, type EventPersistence } from '../event/EventStore';
import type { DomainEvent } from '../event/Event';
import { validateDomainEventAgainstState } from '../event/EventValidation';
import { GraphProjection } from '../projection/GraphProjection';
import type { GraphState } from '../state/GraphState';
import { seedDemoKnowledge } from './seedDemoKnowledge';
import { edgesFrom } from '../graph/Graph';

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

async function run() {
  const persistence = new MemoryPersistence();
  let runtime = boot(persistence);
  await seedDemoKnowledge(runtime.store, runtime.projection);

  const nodes = Object.values(runtime.projection.state.nodesById);
  assert(nodes.length > 20, 'demo should contain enough nodes to exercise the graph');
  assert.equal(nodes.filter(node => node.type === 'logic-symbol').length, 1, 'demo must expose an addable/selectable logic symbol');

  for (const node of nodes.filter(node => node.type === 'reasoning')) {
    assert.equal(node.logicRuleId, 'logic-deduction', `${node.id} must classify its inference`);
    assert(node.premises.length > 0, `${node.id} must have knowledge premises`);
  }
  const edges = edgesFrom(nodes);
  assert(edges.some(edge => edge.from === 'logic-deduction' && edge.to === 'r-n5'), 'logic-symbol classification must be projected as a dependency edge');
  for (const node of nodes.filter(node => ['theorem', 'hypothesis', 'prediction', 'opinion', 'value'].includes(node.type))) {
    assert.equal(node.premises.length, 1, `${node.id} must directly depend on one reasoning process`);
    assert.equal(runtime.projection.state.nodesById[node.premises[0]]?.type, 'reasoning', `${node.id} bypasses its reasoning process`);
  }

  assert.equal(runtime.projection.state.nodesById.n11.hidden, true, 'negated LK-99 claim must be hidden');
  assert.equal(runtime.projection.state.nodesById.n11.status, 'falsified', 'negated LK-99 claim must be falsified');
  assert.equal(runtime.projection.state.nodesById['r-n12'].status, 'suspended', 'negation must suspend the first reasoning layer');
  assert.equal(runtime.projection.state.nodesById.n14.status, 'suspended', 'negation must reach transitive conclusions');

  const size = runtime.store.size();
  await seedDemoKnowledge(runtime.store, runtime.projection);
  assert.equal(runtime.store.size(), size, 'demo initialization must be idempotent');

  runtime = boot(persistence);
  assert.equal(runtime.store.size(), size, 'demo event stream must survive reload without duplication');
  assert.equal(runtime.projection.state.nodesById.n11.hidden, true, 'hidden negation state must survive reload');
  assert.equal(runtime.projection.state.nodesById.n14.status, 'suspended', 'cascade state must survive reload');

  console.log('Demo knowledge protocol regression tests passed');
}

void run();
