import assert from 'node:assert/strict';
import { lineageRoleFor } from '../../domain/KnowledgeLineage';
import {
  generateIcosahedralGrid,
  KNOWLEDGE_BALL_RADIUS,
  LAYOUT_UNIT,
  type LayoutNode,
} from './Deterministic5RLayout';
import {
  applyFixedAnchorOrdinaryLineageFootprint,
  applyOrdinaryLineagePlacement,
  isCoordinateLineStep,
  isOrdinaryLineageSatellite,
  ORDINARY_LINEAGE_SPACING,
} from './OrdinaryLineagePlacement';
import { applyUniformLayerLayout } from './UniformLayerLayout';

const EPSILON = 1e-6;

const cloneLayoutNodes = (nodes: readonly LayoutNode[]): LayoutNode[] => nodes.map(node => ({
  ...node,
  premises: node.premises ? [...node.premises] : undefined,
  lineage: node.lineage ? { ...node.lineage } : undefined,
  address: node.address ? { ...node.address } : undefined,
  pos: node.pos?.clone(),
  homePos: node.homePos?.clone(),
  vel: node.vel?.clone(),
}));

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

// Freeze the exact legacy footprint-planner contract over multiple anchor,
// depth, and hard-obstacle states. The legacy planner accepted the general
// solver only when it kept the proposed anchor cell; the direct solver must
// return the same acceptance result and, when accepted, identical satellite
// addresses in the identical stable node order.
const equivalenceGrid = generateIcosahedralGrid(180, undefined, 'footprint-equivalence-shell');
for (const anchorCell of [0, 1, 7, 19]) {
  const neighbors = [...equivalenceGrid.edges]
    .map(edge => edge.split(':').map(Number) as [number, number])
    .filter(([left, right]) => left === anchorCell || right === anchorCell)
    .map(([left, right]) => left === anchorCell ? right : left)
    .sort((left, right) => left - right);
  for (const [historyLength, oppositionLength] of [[1, 0], [0, 1], [1, 1], [2, 1], [3, 2]] as const) {
    for (const blockedCells of [[], neighbors.slice(0, 1), neighbors.slice(0, 3), neighbors]) {
      const anchor: LayoutNode = {
        id: 'equivalence-current', type: 'fact', premises: [],
        lineage: { topicId: 'equivalence-topic', proposal: 'new', role: 'current', rank: 0 },
        address: { shellID: equivalenceGrid.shellID, cellID: anchorCell },
        pos: equivalenceGrid.vertices[anchorCell]!.clone(),
        homePos: equivalenceGrid.vertices[anchorCell]!.clone(),
      };
      const satellites: LayoutNode[] = [
        ...Array.from({ length: historyLength }, (_, index): LayoutNode => ({
          id: `equivalence-history-${index}`, type: 'fact', premises: [],
          lineage: { topicId: 'equivalence-topic', proposal: 'optimization', targetId: anchor.id, role: 'history', rank: index + 1 },
        })),
        ...Array.from({ length: oppositionLength }, (_, index): LayoutNode => ({
          id: `equivalence-opposition-${index}`, type: 'fact', premises: [],
          lineage: { topicId: 'equivalence-topic', proposal: 'opposition', targetId: anchor.id, role: 'opposition', rank: index + 1 },
        })),
      ];
      const obstacles = blockedCells.map((cellID, index): LayoutNode => ({
        id: `__hard-${index}`, type: 'logic-symbol', premises: [],
        pos: equivalenceGrid.vertices[cellID]!.clone(), homePos: equivalenceGrid.vertices[cellID]!.clone(),
      }));
      const fixture = [anchor, ...satellites, ...obstacles];
      const direct = cloneLayoutNodes(fixture);
      const legacy = cloneLayoutNodes(fixture);
      const directAccepted = applyFixedAnchorOrdinaryLineageFootprint(direct);
      let legacyAccepted = false;
      try {
        applyOrdinaryLineagePlacement(legacy);
        legacyAccepted = legacy[0]!.address?.shellID === equivalenceGrid.shellID
          && legacy[0]!.address?.cellID === anchorCell;
      } catch {
        legacyAccepted = false;
      }
      assert.equal(directAccepted, legacyAccepted, `fixed footprint acceptance must match legacy at anchor ${anchorCell}`);
      if (directAccepted) {
        const addresses = (nodes: readonly LayoutNode[]) => nodes.slice(1, 1 + satellites.length)
          .map(node => [node.id, node.address?.shellID, node.address?.cellID]);
        assert.deepEqual(addresses(direct), addresses(legacy), `fixed footprint addresses must match legacy at anchor ${anchorCell}`);
      }
    }
  }
}

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

// Force every first-step direction around Current to be occupied. The lineage
// invariant must win: the implementation must take a canonical 5R shell line and
// locally move only the ordinary blockers instead of throwing or abandoning ISG.
const conflictShellID = 'conflict-shell';
const conflictGrid = generateIcosahedralGrid(220, undefined, conflictShellID);
const conflictAnchorCell = 0;
const conflictNeighborCells = [...conflictGrid.edges]
  .map(edge => edge.split(':').map(Number) as [number, number])
  .filter(([left, right]) => left === conflictAnchorCell || right === conflictAnchorCell)
  .map(([left, right]) => left === conflictAnchorCell ? right : left)
  .sort((left, right) => left - right);
assert(conflictNeighborCells.length >= 5, 'test anchor must expose normal icosahedral shell neighbours');

const conflictCurrent: LayoutNode = {
  id: 'conflict-current',
  type: 'fact',
  premises: [],
  declaredLayer: 'inner',
  lineage: { topicId: 'conflict-topic', proposal: 'new', role: 'current', rank: 0 },
  address: { shellID: conflictShellID, cellID: conflictAnchorCell },
  pos: conflictGrid.vertices[conflictAnchorCell]!.clone(),
  homePos: conflictGrid.vertices[conflictAnchorCell]!.clone(),
};
const conflictHistory: LayoutNode = {
  id: 'conflict-history',
  type: 'fact',
  premises: [],
  declaredLayer: 'inner',
  lineage: { topicId: 'conflict-topic', proposal: 'optimization', targetId: 'conflict-current', role: 'history', rank: 1 },
};
const conflictOpposition: LayoutNode = {
  id: 'conflict-opposition',
  type: 'fact',
  premises: [],
  declaredLayer: 'inner',
  lineage: { topicId: 'conflict-topic', proposal: 'opposition', targetId: 'conflict-current', role: 'opposition', rank: 1 },
};
const blockers: LayoutNode[] = conflictNeighborCells.map((cellID, index) => ({
  id: `conflict-blocker-${index}`,
  type: 'fact',
  premises: [],
  declaredLayer: 'inner',
  address: { shellID: conflictShellID, cellID },
  pos: conflictGrid.vertices[cellID]!.clone(),
  homePos: conflictGrid.vertices[cellID]!.clone(),
}));
const blockerOriginalCells = new Map(blockers.map(blocker => [blocker.id, blocker.address!.cellID]));
const conflictNodes = [conflictCurrent, conflictHistory, conflictOpposition, ...blockers];
applyOrdinaryLineagePlacement(conflictNodes);

assert(conflictHistory.address && conflictHistory.pos);
assert(conflictOpposition.address && conflictOpposition.pos);
assert.equal(conflictHistory.address.shellID, conflictShellID);
assert.equal(conflictOpposition.address.shellID, conflictShellID);
assert(isCoordinateLineStep(conflictGrid, conflictAnchorCell, conflictHistory.address.cellID));
assert(isCoordinateLineStep(conflictGrid, conflictAnchorCell, conflictOpposition.address.cellID));
assert.notEqual(conflictHistory.address.cellID, conflictOpposition.address.cellID);
const movedBlockers = blockers.filter(blocker => blocker.address!.cellID !== blockerOriginalCells.get(blocker.id));
assert(movedBlockers.length >= 2, 'lineage priority locally reflows the ordinary blockers occupying its two first-step cells');

const conflictAddressKeys = conflictNodes
  .filter(node => node.address)
  .map(node => `${node.address!.shellID}:${node.address!.cellID}`);
assert.equal(new Set(conflictAddressKeys).size, conflictAddressKeys.length, 'local reflow keeps authoritative shell cells unique');
for (let left = 0; left < conflictNodes.length; left++) {
  for (let right = left + 1; right < conflictNodes.length; right++) {
    const leftNode = conflictNodes[left]!;
    const rightNode = conflictNodes[right]!;
    if (!leftNode.pos || !rightNode.pos) continue;
    assert(
      leftNode.pos.distanceTo(rightNode.pos) >= ORDINARY_LINEAGE_SPACING - EPSILON,
      `local reflow preserves global 5R spacing: ${leftNode.id} / ${rightNode.id}`,
    );
  }
}

const reasoningHistory: LayoutNode = {
  id: 'reasoning-history',
  type: 'reasoning',
  lineage: { topicId: 'reasoning-topic', proposal: 'optimization', targetId: 'reasoning-current', role: 'history', rank: 1 },
};
assert.equal(isOrdinaryLineageSatellite(reasoningHistory), false, 'ordinary lineage placement must never absorb Reasoning red/white/history semantics');
assert.equal(lineageRoleFor(history1), 'history');

console.log('Ordinary Knowledge lineage 5R shell-coordinate occupancy, lineage-priority local reflow and Reasoning isolation checks passed.');
