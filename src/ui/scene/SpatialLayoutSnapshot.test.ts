import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { LayoutNode } from './Deterministic5RLayout';
import { createSpatialLayoutSnapshot, restoreSpatialLayoutSnapshot } from './SpatialLayoutSnapshot';

const source: LayoutNode[] = [
  {
    id: 'ordinary-a', type: 'fact', premises: [], effectiveLayer: 'inner',
    address: { shellID: 'shell:180.000000', cellID: 12 },
    pos: new THREE.Vector3(1, 2, 3), homePos: new THREE.Vector3(1, 2, 3), vel: new THREE.Vector3(9, 9, 9),
  },
  {
    id: 'reasoning-a', type: 'reasoning', premises: ['ordinary-a'], effectiveLayer: 'middle',
    pos: new THREE.Vector3(4, 5, 6), homePos: new THREE.Vector3(4, 5, 6), vel: new THREE.Vector3(3, 2, 1),
  },
  { id: 'unplaced-reasoning', type: 'reasoning', premises: [], effectiveLayer: 'middle' },
];

const snapshot = createSpatialLayoutSnapshot(source, '44');
assert.equal(snapshot.nodes.length, 3);
assert.deepEqual(snapshot.nodes[0], {
  id: 'ordinary-a', address: { shellID: 'shell:180.000000', cellID: 12 }, pos: { x: 1, y: 2, z: 3 },
});
assert.equal(snapshot.nodes[1]?.address, null, 'Reasoning remains non-ISG geometry');
assert.equal(snapshot.nodes[2]?.pos, null, 'unplaced nodes remain unplaced');

const restored: LayoutNode[] = source.map(node => ({
  id: node.id, type: node.type, premises: [...(node.premises ?? [])],
  effectiveLayer: node.effectiveLayer, vel: new THREE.Vector3(7, 7, 7),
}));
assert.equal(restoreSpatialLayoutSnapshot(restored, snapshot, '44'), true);
assert.equal(restored[0]?.address?.shellID, 'shell:180.000000');
assert.equal(restored[0]?.address?.cellID, 12);
assert.equal(restored[0]?.pos?.distanceTo(new THREE.Vector3(1, 2, 3)), 0);
assert.equal(restored[0]?.homePos?.distanceTo(new THREE.Vector3(1, 2, 3)), 0);
assert.equal(restored[0]?.vel?.lengthSq(), 0);
assert.equal(restored[1]?.pos?.distanceTo(new THREE.Vector3(4, 5, 6)), 0);
assert.equal(restored[1]?.address, undefined);
assert.equal(restored[2]?.pos, undefined);

assert.equal(restoreSpatialLayoutSnapshot(restored, snapshot, '45'), false, 'stale event head cannot be restored');
const changedGraph = restored.map(node => ({ ...node, premises: [...(node.premises ?? [])] }));
changedGraph[0]!.premises = ['new-premise'];
assert.equal(restoreSpatialLayoutSnapshot(changedGraph, snapshot, '44'), false, 'changed graph cannot be restored');

const duplicateAddress = structuredClone(snapshot);
duplicateAddress.nodes[1] = { ...duplicateAddress.nodes[1]!, address: { shellID: 'shell:180.000000', cellID: 12 } };
assert.equal(restoreSpatialLayoutSnapshot(restored, duplicateAddress, '44'), false, 'duplicate shell occupancy is rejected');

const nonFinite = structuredClone(snapshot);
nonFinite.nodes[0]!.pos = { x: Number.NaN, y: 2, z: 3 };
assert.equal(restoreSpatialLayoutSnapshot(restored, nonFinite, '44'), false, 'non-finite coordinates are rejected');

const wrongAlgorithm = structuredClone(snapshot);
wrongAlgorithm.algorithmVersion = 'unknown' as typeof wrongAlgorithm.algorithmVersion;
assert.equal(restoreSpatialLayoutSnapshot(restored, wrongAlgorithm, '44'), false, 'unknown solver versions are recomputed');

console.log('Persisted deterministic 5R spatial snapshot round-trip and invalidation tests passed');
