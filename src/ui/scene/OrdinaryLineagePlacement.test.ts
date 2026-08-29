import assert from 'node:assert/strict';
import { lineageRoleFor } from '../../domain/KnowledgeLineage';
import {
  generateIcosahedralGrid,
  KNOWLEDGE_BALL_RADIUS,
  LAYOUT_UNIT,
  type LayoutNode,
} from './Deterministic5RLayout';
import {
  applyOrdinaryLineagePlacement,
  isCoordinateLineStep,
  isOrdinaryLineageSatellite,
  ORDINARY_LINEAGE_SPACING,
} from './OrdinaryLineagePlacement';
import { applyUniformLayerLayout } from './UniformLayerLayout';

const EPSILON = 1e-6;

function ordinary(
  id: string,
  role: 'current' | 'history' | 'opposition' | 'candidate-history' | 'candidate-opposition',
  rank: number,
): LayoutNode {
  return {
    id,
    type: 'fact',
    premises: [],
    declaredLayer: 'inner',
    hidden: role !== 'current',
    lineage: {
      topicId: 'ordinary-topic',
      proposal: role === 'current' ? 'new' : role.includes('opposition') ? 'opposition' : 'optimization',
      targetId: role === 'current' ? undefined : 'ordinary-current',
      role,
      rank,
    },
  };
}

assert.equal(ORDINARY_LINEAGE_SPACING, LAYOUT_UNIT);
assert.equal(ORDINARY_LINEAGE_SPACING, 5 * KNOWLEDGE_BALL_RADIUS, 'ordinary lineage uses the 5R layout unit');

const runtimeNodes: LayoutNode[] = [
  ordinary('ordinary-current', 'current', 0),
  ordinary('ordinary-history-1', 'history', 1),
  ordinary('ordinary-history-2', 'history', 2),
  ordinary('ordinary-opposition-1', 'opposition', 1),
  { id: 'unrelated-current', type: 'fact', premises: [], declaredLayer: 'inner' },
];
applyUniformLayerLayout(runtimeNodes);

const current = runtimeNodes.find(node => node.id === 'ordinary-current')!;
const history1 = runtimeNodes.find(node => node.id === 'ordinary-history-1')!;
const history2 = runtimeNodes.find(node => node.id === 'ordinary-history-2')!;
const opposition1 = runtimeNodes.find(node => node.id === 'ordinary-opposition-1')!;
const unrelated = runtimeNodes.find(node => node.id === 'unrelated-current')!;

assert(current.address && current.pos, 'ordinary current keeps its authoritative shell address');
assert(unrelated.address && unrelated.pos, 'unrelated ordinary Knowledge keeps its authoritative shell address');
for (const member of [history1, history2, opposition1]) {
  assert(member.address && member.pos, `${member.id} receives an authoritative shell coordinate`);
  assert.equal(member.address.shellID, current.address.shellID, `${member.id} stays on the Current shell`);
  assert(Math.abs(member.pos.length() - current.pos.length()) < EPSILON, `${member.id} stays on the Current radius`);
}

const grid = generateIcosahedralGrid(current.pos.length(), undefined, current.address.shellID);
assert(isCoordinateLineStep(grid, current.address.cellID, history1.address!.cellID), 'Current -> History1 occupies one shell coordinate-line step');
assert(isCoordinateLineStep(grid, history1.address!.cellID, history2.address!.cellID), 'History1 -> History2 continues the same shell coordinate line');
assert(isCoordinateLineStep(grid, current.address.cellID, opposition1.address!.cellID), 'Current -> Opposition1 occupies one shell coordinate-line step');

for (const [left, right] of [[current, history1], [history1, history2], [current, opposition1]] as const) {
  assert(left.pos!.distanceTo(right.pos!) >= ORDINARY_LINEAGE_SPACING - EPSILON, `${left.id} -> ${right.id} respects nominal 5R shell spacing`);
}
assert(history1.pos!.distanceTo(unrelated.pos!) >= ORDINARY_LINEAGE_SPACING - EPSILON, 'lineage coordinate line avoids unrelated ordinary Knowledge');
assert(history2.pos!.distanceTo(unrelated.pos!) >= ORDINARY_LINEAGE_SPACING - EPSILON, 'deeper history still avoids unrelated ordinary Knowledge');
assert(opposition1.pos!.distanceTo(unrelated.pos!) >= ORDINARY_LINEAGE_SPACING - EPSILON, 'opposition side still avoids unrelated ordinary Knowledge');

const uniqueAddresses = new Set([current, history1, history2, opposition1].map(node => `${node.address!.shellID}:${node.address!.cellID}`));
assert.equal(uniqueAddresses.size, 4, 'Current/History/Opposition occupy distinct authoritative shell cells');

// Pending members use only real existing members. They consume the nearest actual
// coordinate-line cells; no future History/Opposition slots are pre-reserved.
const pendingNodes: LayoutNode[] = [
  ordinary('ordinary-current', 'current', 0),
  ordinary('pending-history', 'candidate-history', 0),
  ordinary('stable-history', 'history', 1),
  ordinary('pending-opposition', 'candidate-opposition', 0),
  ordinary('stable-opposition', 'opposition', 1),
];
applyUniformLayerLayout(pendingNodes);
const pendingCurrent = pendingNodes[0]!;
const pendingHistory = pendingNodes.find(node => node.id === 'pending-history')!;
const stableHistory = pendingNodes.find(node => node.id === 'stable-history')!;
const pendingOpposition = pendingNodes.find(node => node.id === 'pending-opposition')!;
const stableOpposition = pendingNodes.find(node => node.id === 'stable-opposition')!;
const pendingGrid = generateIcosahedralGrid(pendingCurrent.pos!.length(), undefined, pendingCurrent.address!.shellID);
assert(isCoordinateLineStep(pendingGrid, pendingCurrent.address!.cellID, pendingHistory.address!.cellID));
assert(isCoordinateLineStep(pendingGrid, pendingHistory.address!.cellID, stableHistory.address!.cellID));
assert(isCoordinateLineStep(pendingGrid, pendingCurrent.address!.cellID, pendingOpposition.address!.cellID));
assert(isCoordinateLineStep(pendingGrid, pendingOpposition.address!.cellID, stableOpposition.address!.cellID));

const reasoningHistory: LayoutNode = {
  id: 'reasoning-history',
  type: 'reasoning',
  lineage: { topicId: 'reasoning-topic', proposal: 'optimization', targetId: 'reasoning-current', role: 'history', rank: 1 },
};
assert.equal(isOrdinaryLineageSatellite(reasoningHistory), false, 'ordinary lineage placement must never absorb Reasoning red/white/history semantics');
assert.equal(lineageRoleFor(history1), 'history');

console.log('Ordinary Knowledge lineage 5R shell-coordinate-line occupancy and Reasoning isolation checks passed.');
