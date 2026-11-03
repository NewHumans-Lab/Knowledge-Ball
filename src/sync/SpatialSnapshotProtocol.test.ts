import assert from 'node:assert/strict';
import { spatialSnapshotChecksum, type SpatialSnapshotNode } from './SpatialSnapshot';

const first: SpatialSnapshotNode[] = [
  { id: 'a', address: { shellID: 'shell:180.000000', cellID: 3 }, pos: { x: 1.25, y: -2, z: 0 } },
  { id: 'b', address: null, pos: null },
];
const reordered = JSON.parse(JSON.stringify(first).replace(
  '{"id":"a","address":{"shellID":"shell:180.000000","cellID":3},"pos":{"x":1.25,"y":-2,"z":0}}',
  '{"pos":{"z":0,"y":-2,"x":1.25},"address":{"cellID":3,"shellID":"shell:180.000000"},"id":"a"}',
)) as SpatialSnapshotNode[];
assert.equal(spatialSnapshotChecksum(first), spatialSnapshotChecksum(reordered),
  'checksum must ignore object-key ordering introduced by JSONB/Realtime');
assert.match(spatialSnapshotChecksum(first), /^[0-9a-f]{8}$/);
const altered = structuredClone(first);
altered[0]!.pos!.x += 0.001;
assert.notEqual(spatialSnapshotChecksum(first), spatialSnapshotChecksum(altered),
  'coordinate changes must invalidate the complete-transfer checksum');
assert.notEqual(spatialSnapshotChecksum(first), spatialSnapshotChecksum(first.slice(1)),
  'missing nodes must invalidate the complete-transfer checksum');
console.log('Canonical spatial snapshot checksum and corruption detection tests passed');
