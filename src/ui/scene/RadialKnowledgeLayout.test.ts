import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  applyDeterministic5RLayout,
  computeSemanticBoundaries,
  getLastLayoutDiagnostics,
  KNOWLEDGE_BALL_RADIUS,
  LAYOUT_UNIT,
  type LayoutNode,
} from './Deterministic5RLayout';

const node = (id: string, premises: string[] = [], type = 'fact', layer: LayoutNode['declaredLayer'] = 'inner'): LayoutNode => ({ id, premises, type, declaredLayer: layer });
const fixture = (): LayoutNode[] => [
  node('shared-a'), node('shared-b'), node('premise-c'),
  node('reason-1', ['shared-a', 'shared-b'], 'reasoning'),
  node('conclusion-1', ['reason-1'], 'theorem', 'middle'),
  node('reason-2', ['shared-a', 'premise-c'], 'reasoning'),
  node('conclusion-2', ['reason-2'], 'theorem', 'middle'),
  node('reason-3', ['conclusion-1', 'conclusion-2'], 'reasoning'),
  node('final-a', ['reason-3'], 'hypothesis', 'outer'),
  node('final-b', ['reason-3'], 'hypothesis', 'outer'),
];

assert.equal(LAYOUT_UNIT, 5 * KNOWLEDGE_BALL_RADIUS, 'the single geometry unit must be L = 5R');
const boundaries = computeSemanticBoundaries([...fixture(), ...Array.from({ length: 9 }, (_, i) => node(`capacity-${i}`))]);
assert.equal(boundaries.cyanBlue % LAYOUT_UNIT, 0);
assert.equal(boundaries.bluePurple % LAYOUT_UNIT, 0);
assert.equal(boundaries.purpleOuter, null, 'purple must not acquire a semantic outer boundary');

const first = fixture(); applyDeterministic5RLayout(first);
const diagnostics = getLastLayoutDiagnostics()!;
assert.equal(diagnostics.usedAngles.size, 1, 'shared premises and conclusions form one atomic component');
assert.equal(diagnostics.occupiedCells.size, first.filter(n => n.type !== 'reasoning').length, 'reasoning consumes no occupancy cell');
for (const reasoning of first.filter(n => n.type === 'reasoning')) {
  const premises = reasoning.premises!.map(id => first.find(n => n.id === id)!.pos!);
  const conclusions = first.filter(n => n.premises?.includes(reasoning.id)).map(n => n.pos!);
  const mean = (values: THREE.Vector3[]) => values.reduce((sum, p) => sum.add(p), new THREE.Vector3()).multiplyScalar(1 / values.length);
  assert(reasoning.pos!.distanceTo(mean(premises).add(mean(conclusions)).multiplyScalar(0.5)) < 1e-8, 'reasoning is the exact side-centre midpoint');
}

const radial = (id: string) => first.find(n => n.id === id)!.pos!.length();
assert(radial('conclusion-1') > radial('shared-a'), 'premises must be inward of conclusions');
assert(Math.abs((radial('conclusion-1') - radial('shared-a')) - LAYOUT_UNIT) < 1e-7, 'radial depth spacing is exactly L');
const sameLayer = ['shared-a', 'shared-b', 'premise-c'].map(id => first.find(n => n.id === id)!.pos!);
assert(sameLayer.some((a, i) => sameLayer.some((b, j) => i !== j && Math.abs(a.distanceTo(b) - LAYOUT_UNIT) < 1e-7)), 'same-layer lattice nearest neighbours are exactly L');

const second = fixture(); applyDeterministic5RLayout(second);
for (const original of first) assert(original.pos!.distanceTo(second.find(n => n.id === original.id)!.pos!) < 1e-9, `${original.id} must be deterministic`);
assert.deepEqual([...getLastLayoutDiagnostics()!.usedAngles], [...diagnostics.usedAngles]);
console.log('Deterministic 5R component layout regression checks passed.');
