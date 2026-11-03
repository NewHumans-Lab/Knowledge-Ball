import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { LayoutNode } from './Deterministic5RLayout';
import { applyUniformLayerLayout } from './UniformLayerLayout';
import { createSpatialLayoutSnapshot, restoreSpatialLayoutSnapshot } from './SpatialLayoutSnapshot';

const source: LayoutNode[] = [
  { id: 'ordinary-a', type: 'fact', premises: [], effectiveLayer: 'inner' },
  { id: 'reasoning-a', type: 'reasoning', premises: ['ordinary-a'], effectiveLayer: 'middle' },
  { id: 'ordinary-b', type: 'theorem', premises: ['reasoning-a'], effectiveLayer: 'middle' },
  { id: 'unplaced-reasoning', type: 'reasoning', premises: [], effectiveLayer: 'middle' },
  { id: 'rejected-history', type: 'fact', premises: [], effectiveLayer: 'outer', lineage: { topicId: 'topic-a', proposal: 'optimization', targetId: 'ordinary-a', role: 'rejected', rank: 1 } },
];

// Generate the cache through the real production geometry owners. The test does
// not invent shell IDs, cell IDs or XYZ positions.
applyUniformLayerLayout(source);
const originalById = new Map(source.map(node => [node.id, node]));
assert.ok(originalById.get('ordinary-a')?.address, 'ordinary Knowledge must use an authoritative icosahedral address');
assert.ok(originalById.get('ordinary-b')?.address, 'ordinary conclusion must use an authoritative icosahedral address');
assert.equal(originalById.get('reasoning-a')?.address, undefined, 'Reasoning must remain outside ISG occupancy');
assert.ok(originalById.get('reasoning-a')?.pos, 'bound Reasoning must retain its original radial projection');
assert.equal(originalById.get('unplaced-reasoning')?.pos, undefined, 'unbound Reasoning remains unplaced');
assert.equal(originalById.get('rejected-history')?.address, undefined, 'rejected lineage remains outside spatial occupancy');
assert.equal(originalById.get('rejected-history')?.pos, undefined, 'rejected lineage remains unplaced');

const snapshot = createSpatialLayoutSnapshot(source, '44');
assert.equal(snapshot.nodes.length, source.length);
assert.equal(snapshot.nodes.find(node => node.id === 'reasoning-a')?.address, null);
assert.equal(snapshot.nodes.find(node => node.id === 'unplaced-reasoning')?.pos, null);

const restored: LayoutNode[] = source.map(node => ({
  id: node.id,
  type: node.type,
  premises: [...(node.premises ?? [])],
  effectiveLayer: node.effectiveLayer,
  lineage: node.lineage ? { ...node.lineage } : undefined,
  vel: new THREE.Vector3(7, 7, 7),
}));
assert.equal(restoreSpatialLayoutSnapshot(restored, snapshot, '44'), true);
for (const node of restored) {
  const original = originalById.get(node.id)!;
  assert.equal(Boolean(node.pos), Boolean(original.pos), node.id + ' position presence must survive snapshot restore');
  if (node.pos && original.pos) {
    assert.equal(node.pos.distanceTo(original.pos), 0, node.id + ' position must be restored exactly');
    assert.equal(node.homePos?.distanceTo(original.homePos!), 0, node.id + ' home position must be restored exactly');
  }
  assert.equal(node.vel?.lengthSq(), 0, node.id + ' restored movement must start from rest');
  assert.deepEqual(node.address ?? null, original.address ?? null, node.id + ' shell/cell address must be restored exactly');
}

assert.equal(restoreSpatialLayoutSnapshot(restored, snapshot, '45'), false, 'stale event head cannot be restored');
const changedGraph = restored.map(node => ({ ...node, premises: [...(node.premises ?? [])] }));
changedGraph[0]!.premises = ['new-premise'];
assert.equal(restoreSpatialLayoutSnapshot(changedGraph, snapshot, '44'), false, 'changed graph cannot be restored');

const duplicateAddress = structuredClone(snapshot);
const firstAddressed = duplicateAddress.nodes.findIndex(node => node.address !== null);
const secondAddressed = duplicateAddress.nodes.findIndex((node, index) => index !== firstAddressed && node.address !== null);
duplicateAddress.nodes[secondAddressed] = {
  ...duplicateAddress.nodes[secondAddressed]!,
  address: { ...duplicateAddress.nodes[firstAddressed]!.address! },
};
assert.equal(restoreSpatialLayoutSnapshot(restored, duplicateAddress, '44'), false, 'duplicate shell occupancy is rejected');

const nonFinite = structuredClone(snapshot);
const firstPositioned = nonFinite.nodes.findIndex(node => node.pos !== null);
nonFinite.nodes[firstPositioned] = {
  ...nonFinite.nodes[firstPositioned]!,
  pos: { x: Number.NaN, y: 2, z: 3 },
};
assert.equal(restoreSpatialLayoutSnapshot(restored, nonFinite, '44'), false, 'non-finite coordinates are rejected');

const wrongAlgorithm = structuredClone(snapshot);
wrongAlgorithm.algorithmVersion = 'unknown' as typeof wrongAlgorithm.algorithmVersion;
assert.equal(restoreSpatialLayoutSnapshot(restored, wrongAlgorithm, '44'), false, 'unknown solver versions are recomputed');

const movedCell = structuredClone(snapshot);
const movedIndex = movedCell.nodes.findIndex(node => node.address !== null);
movedCell.nodes[movedIndex] = {
  ...movedCell.nodes[movedIndex]!,
  pos: { x: 1, y: 2, z: 3 },
};
assert.equal(restoreSpatialLayoutSnapshot(restored, movedCell, '44'), false, 'a saved XYZ that does not match its shell/cell cannot be restored');

// Orphan lineage metadata is valid input but has no spatial anchor. The
// layout solver intentionally leaves those history/opposition records unplaced,
// so strict snapshot restore must preserve that exact behavior rather than
// inventing a shell address for an incomplete lineage family.
const orphanLineageSource: LayoutNode[] = [
  { id: 'orphan-main', type: 'fact', premises: [], effectiveLayer: 'inner' },
  {
    id: 'orphan-history',
    type: 'fact',
    premises: [],
    lineage: { topicId: 'topic-without-current', proposal: 'optimization', role: 'history', rank: 1 },
  },
  {
    id: 'orphan-opposition',
    type: 'fact',
    premises: [],
    lineage: { topicId: 'topic-without-current', proposal: 'opposition', role: 'opposition', rank: 1 },
  },
];
applyUniformLayerLayout(orphanLineageSource);
assert.ok(orphanLineageSource.find(node => node.id === 'orphan-main')?.address);
assert.equal(orphanLineageSource.find(node => node.id === 'orphan-history')?.address, undefined);
assert.equal(orphanLineageSource.find(node => node.id === 'orphan-history')?.pos, undefined);
assert.equal(orphanLineageSource.find(node => node.id === 'orphan-opposition')?.address, undefined);
assert.equal(orphanLineageSource.find(node => node.id === 'orphan-opposition')?.pos, undefined);

const orphanSnapshot = createSpatialLayoutSnapshot(orphanLineageSource, '46');
const orphanRestored: LayoutNode[] = orphanLineageSource.map(node => ({
  id: node.id,
  type: node.type,
  premises: [...(node.premises ?? [])],
  lineage: node.lineage ? { ...node.lineage } : undefined,
  effectiveLayer: node.effectiveLayer,
}));
assert.equal(
  restoreSpatialLayoutSnapshot(orphanRestored, orphanSnapshot, '46'),
  true,
  'unanchored history/opposition metadata must remain a valid unplaced snapshot entry',
);
assert.equal(orphanRestored.find(node => node.id === 'orphan-history')?.pos, undefined);
assert.equal(orphanRestored.find(node => node.id === 'orphan-opposition')?.pos, undefined);

console.log('Persisted deterministic 5R spatial snapshot round-trip and invalidation tests passed');
