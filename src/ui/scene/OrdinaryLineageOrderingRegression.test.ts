import assert from 'node:assert/strict';
import {
  generateIcosahedralGrid,
  getLastLayoutDiagnostics,
  LAYOUT_UNIT,
  type LayoutNode,
} from './Deterministic5RLayout';
import { isCoordinateLineStep } from './OrdinaryLineagePlacement';
import { applyUniformLayerLayout } from './UniformLayerLayout';

const EPSILON = 1e-6;

const nodes: LayoutNode[] = [
  { id: 'a', type: 'fact', premises: [], declaredLayer: 'inner' },
  { id: 'r-ab', type: 'reasoning', premises: ['a'], declaredLayer: 'inner' },
  {
    id: 'b',
    type: 'fact',
    premises: ['r-ab'],
    declaredLayer: 'inner',
    lineage: { topicId: 'topic-b', proposal: 'new', role: 'current', rank: 0 },
  },
  {
    id: 'b-history',
    type: 'fact',
    premises: [],
    declaredLayer: 'inner',
    hidden: true,
    lineage: { topicId: 'topic-b', proposal: 'optimization', targetId: 'b', role: 'history', rank: 1 },
  },
  {
    id: 'b-opposition',
    type: 'fact',
    premises: [],
    declaredLayer: 'inner',
    lineage: { topicId: 'topic-b', proposal: 'opposition', targetId: 'b', role: 'opposition', rank: 1 },
  },
  { id: 'r-bc', type: 'reasoning', premises: ['b'], declaredLayer: 'inner' },
  { id: 'c', type: 'fact', premises: ['r-bc'], declaredLayer: 'inner' },
];

applyUniformLayerLayout(nodes);

const byId = new Map(nodes.map(node => [node.id, node] as const));
const a = byId.get('a')!;
const b = byId.get('b')!;
const c = byId.get('c')!;
const history = byId.get('b-history')!;
const opposition = byId.get('b-opposition')!;

for (const node of [a, b, c, history, opposition]) {
  assert(node.pos, `${node.id} must receive a final position`);
}
assert(b.address && history.address && opposition.address, 'Current and both lineage satellites must receive authoritative cells');

assert(
  Math.abs(a.pos!.distanceTo(b.pos!) - LAYOUT_UNIT) < EPSILON,
  'adding gray/red lineage must not destroy the main-chain A -> B exact-5R optimum',
);
assert(
  Math.abs(b.pos!.distanceTo(c.pos!) - LAYOUT_UNIT) < EPSILON,
  'adding gray/red lineage must not destroy the main-chain B -> C exact-5R optimum',
);

assert.equal(history.address.shellID, b.address.shellID, 'gray History stays on Current shell');
assert.equal(opposition.address.shellID, b.address.shellID, 'red Opposition stays on Current shell');
const grid = generateIcosahedralGrid(b.pos!.length(), undefined, b.address.shellID);
assert(isCoordinateLineStep(grid, b.address.cellID, history.address.cellID), 'gray side is one real ISG coordinate step from Current');
assert(isCoordinateLineStep(grid, b.address.cellID, opposition.address.cellID), 'red side is one real ISG coordinate step from Current');
assert(history.pos!.distanceTo(b.pos!) >= LAYOUT_UNIT - EPSILON);
assert(opposition.pos!.distanceTo(b.pos!) >= LAYOUT_UNIT - EPSILON);

const ordinary = [a, b, c, history, opposition];
for (let left = 0; left < ordinary.length; left += 1) {
  for (let right = left + 1; right < ordinary.length; right += 1) {
    assert(
      ordinary[left]!.pos!.distanceTo(ordinary[right]!.pos!) >= LAYOUT_UNIT - EPSILON,
      `${ordinary[left]!.id}/${ordinary[right]!.id} must preserve global 5R exclusion`,
    );
  }
}

const diagnostics = getLastLayoutDiagnostics();
assert(diagnostics, 'uniform layout must expose deterministic diagnostics');
assert(diagnostics.addresses.has('b-history'), 'gray footprint must already be reserved inside the main global solve');
assert(diagnostics.addresses.has('b-opposition'), 'red footprint must already be reserved inside the main global solve');

console.log('Ordinary lineage is pre-solved as a 5R footprint before unchanged global compact scoring.');
