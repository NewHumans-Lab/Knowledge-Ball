import assert from 'node:assert/strict';
import * as THREE from 'three';
import { lineageRoleFor } from '../../domain/KnowledgeLineage';
import { getLastLayoutDiagnostics, type LayoutNode } from './Deterministic5RLayout';
import {
  applyOrdinaryLineagePlacement,
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
const diagnostics = getLastLayoutDiagnostics()!;

assert(current.address, 'ordinary current remains in the global authoritative main-chain layout');
assert(unrelated.address, 'unrelated current Knowledge remains in the global authoritative main-chain layout');
for (const satellite of [history1, history2, opposition1]) {
  assert(satellite.pos, `${satellite.id} receives local lineage geometry`);
  assert.equal(satellite.address, undefined, `${satellite.id} is extracted from global ISG occupancy`);
  assert(Math.abs(satellite.pos!.length() - current.pos!.length()) < EPSILON, `${satellite.id} stays on the current shell radius`);
  assert(!diagnostics.addresses.has(satellite.id), `${satellite.id} never consumes a global main-chain address`);
}

assert(Math.abs(current.pos!.distanceTo(history1.pos!) - ORDINARY_LINEAGE_SPACING) < EPSILON, 'current to nearest history is exactly R');
assert(Math.abs(history1.pos!.distanceTo(history2.pos!) - ORDINARY_LINEAGE_SPACING) < EPSILON, 'history chain remains exactly R-spaced');
assert(Math.abs(current.pos!.distanceTo(opposition1.pos!) - ORDINARY_LINEAGE_SPACING) < EPSILON, 'current to nearest opposition is exactly R');
assert(history1.pos!.distanceTo(unrelated.pos!) >= ORDINARY_LINEAGE_SPACING - EPSILON, 'lineage rotation avoids overlapping ordinary main-chain geometry');
assert(history2.pos!.distanceTo(unrelated.pos!) >= ORDINARY_LINEAGE_SPACING - EPSILON, 'deeper history still avoids ordinary main-chain geometry');
assert(opposition1.pos!.distanceTo(unrelated.pos!) >= ORDINARY_LINEAGE_SPACING - EPSILON, 'opposition side still avoids ordinary main-chain geometry');

const radial = current.pos!.clone().normalize();
const tangentProjection = (position: THREE.Vector3) => position.clone().addScaledVector(radial, -position.dot(radial));
const projectedHistory1 = tangentProjection(history1.pos!);
const projectedHistory2 = tangentProjection(history2.pos!);
const projectedOpposition1 = tangentProjection(opposition1.pos!);
assert(projectedHistory1.clone().cross(projectedHistory2).length() < EPSILON, 'history tangent-plane projections are collinear');
assert(projectedHistory1.clone().cross(projectedOpposition1).length() < EPSILON, 'history/current/opposition tangent-plane projection is one line');
assert(projectedHistory1.dot(projectedOpposition1) < 0, 'history and opposition stay on opposite sides of current');

// Pending lineage uses only existing members: no future slots are reserved. A
// present candidate simply becomes the nearest member on its semantic side.
const pendingNodes: LayoutNode[] = [
  {
    ...ordinary('ordinary-current', 'current', 0),
    pos: new THREE.Vector3(0, 0, 100),
    homePos: new THREE.Vector3(0, 0, 100),
  },
  ordinary('pending-history', 'candidate-history', 0),
  ordinary('stable-history', 'history', 1),
  ordinary('pending-opposition', 'candidate-opposition', 0),
  ordinary('stable-opposition', 'opposition', 1),
  { id: 'nearby-obstacle', type: 'fact', pos: new THREE.Vector3(ORDINARY_LINEAGE_SPACING, 0, 100).normalize().multiplyScalar(100) },
];
applyOrdinaryLineagePlacement(pendingNodes);
const pendingCurrent = pendingNodes[0]!;
const pendingHistory = pendingNodes.find(node => node.id === 'pending-history')!;
const stableHistory = pendingNodes.find(node => node.id === 'stable-history')!;
const pendingOpposition = pendingNodes.find(node => node.id === 'pending-opposition')!;
const stableOpposition = pendingNodes.find(node => node.id === 'stable-opposition')!;
assert(Math.abs(pendingCurrent.pos!.distanceTo(pendingHistory.pos!) - ORDINARY_LINEAGE_SPACING) < EPSILON);
assert(Math.abs(pendingHistory.pos!.distanceTo(stableHistory.pos!) - ORDINARY_LINEAGE_SPACING) < EPSILON);
assert(Math.abs(pendingCurrent.pos!.distanceTo(pendingOpposition.pos!) - ORDINARY_LINEAGE_SPACING) < EPSILON);
assert(Math.abs(pendingOpposition.pos!.distanceTo(stableOpposition.pos!) - ORDINARY_LINEAGE_SPACING) < EPSILON);

const reasoningHistory: LayoutNode = {
  id: 'reasoning-history',
  type: 'reasoning',
  lineage: { topicId: 'reasoning-topic', proposal: 'optimization', targetId: 'reasoning-current', role: 'history', rank: 1 },
};
assert.equal(isOrdinaryLineageSatellite(reasoningHistory), false, 'ordinary lineage placement must never absorb Reasoning red/white/history semantics');
assert.equal(lineageRoleFor(history1), 'history');

console.log('Ordinary Knowledge lineage local R-spacing, straight projection, collision priority and Reasoning isolation checks passed.');
