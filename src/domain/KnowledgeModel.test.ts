import { strict as assert } from 'node:assert';
import { selectKnowledgeDisplay, validateStatusTransition, type PublicKnowledgeNode } from './KnowledgeModel';
import { emptyPersonalState, evolvePersonal } from '../state/PersonalKnowledgeState';

const base: PublicKnowledgeNode = { id:'n', title:'N', type:'fact', description:'D', epistemicStatus:'verified', availability:'active', lifecycle:'current', tags:[], version:1, createdAt:'2026-01-01T00:00:00Z', updatedAt:'2026-01-01T00:00:00Z' };
let alice = emptyPersonalState();
alice = evolvePersonal(alice, { id:'a1', type:'PersonalMasterySet', schemaVersion:1, timestamp:1, payload:{ nodeId:'n', mastery:'mastered', updatedAt:'2026-01-01T00:00:01Z', version:1 } });
const bob = emptyPersonalState();
assert.equal(selectKnowledgeDisplay([base], alice.byNodeId)[0].mastery, 'mastered');
assert.equal(selectKnowledgeDisplay([base], bob.byNodeId)[0].mastery, 'none');
assert.equal(selectKnowledgeDisplay([{...base, epistemicStatus:'falsified'}], alice.byNodeId).length, 0);
assert.equal(selectKnowledgeDisplay([{...base, lifecycle:'superseded'}], alice.byNodeId).length, 0);
assert.equal(selectKnowledgeDisplay([{...base, availability:'suspended'}], alice.byNodeId).length, 1);
assert.equal(validateStatusTransition('falsified', 'pending').length, 1);
assert.equal(validateStatusTransition('falsified', 'pending', true).length, 0);
console.log('Canonical knowledge model regression tests passed');
