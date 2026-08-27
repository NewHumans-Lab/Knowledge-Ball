import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  applyDeterministic5RLayout,
  compactTriangularCoordinates,
  computeSemanticBoundaries,
  fibonacciDirections,
  getLastLayoutDiagnostics,
  icosahedronMacroDirections,
  KNOWLEDGE_BALL_RADIUS,
  LAYOUT_UNIT,
  MACRO_DIRECTION_COUNT,
  mapMacroDirectionsToCandidates,
  positionsCollide,
  type LayoutNode,
} from './Deterministic5RLayout';

const EPSILON = 1e-7;
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
assert.equal(positionsCollide(new THREE.Vector3(0, 0, 0), new THREE.Vector3(LAYOUT_UNIT - 1e-4, 0, 0)), true, 'distance < L must collide');
assert.equal(positionsCollide(new THREE.Vector3(0, 0, 0), new THREE.Vector3(LAYOUT_UNIT, 0, 0)), false, 'distance == L must be allowed');

const compact7 = compactTriangularCoordinates(7);
assert.deepEqual(compact7[0], [0, 0], 'compact triangular template starts at the centre');
assert.equal(new Set(compact7.map(([q, r]) => `${q}:${r}`)).size, 7, 'triangular template cells must be unique');
assert(compact7.some(([, r]) => r !== 0), 'same-depth triangular lattice must use two axial dimensions, not an r=0 row');
const hexDistance = ([q, r]: [number, number]) => Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
assert.equal(compact7.slice(1).filter(cell => hexDistance(cell) === 1).length, 6, 'seven-cell template must be centre + six nearest neighbours');

const macros = icosahedronMacroDirections();
assert.equal(macros.length, MACRO_DIRECTION_COUNT, 'there must be exactly 12 fixed macro directions');
const fibonacci = fibonacciDirections(89);
const macroCandidates = mapMacroDirectionsToCandidates(macros, fibonacci);
assert.equal(new Set(macroCandidates).size, MACRO_DIRECTION_COUNT, 'macro directions must map to distinct Fibonacci candidates');

const boundaries = computeSemanticBoundaries([...fixture(), ...Array.from({ length: 9 }, (_, i) => node(`capacity-${i}`))]);
assert.equal(boundaries.cyanBlue % LAYOUT_UNIT, 0);
assert.equal(boundaries.bluePurple % LAYOUT_UNIT, 0);
assert.equal(boundaries.purpleOuter, null, 'purple must not acquire a semantic outer boundary');

const first = fixture();
applyDeterministic5RLayout(first);
const diagnostics = getLastLayoutDiagnostics()!;
assert.equal(diagnostics.usedAngles.size, 1, 'shared premises and conclusions form one atomic connected component');
assert.equal(diagnostics.occupiedCells.size, first.filter(n => n.type !== 'reasoning').length, 'reasoning consumes no occupancy cell');
assert.equal(new Set(diagnostics.macroCandidateAngles).size, MACRO_DIRECTION_COUNT, 'diagnostics retain the 12 distinct macro candidate mappings');

for (const reasoning of first.filter(n => n.type === 'reasoning')) {
  const premises = reasoning.premises!.map(id => first.find(n => n.id === id)!.pos!);
  const conclusions = first.filter(n => n.premises?.includes(reasoning.id)).map(n => n.pos!);
  const mean = (values: THREE.Vector3[]) => values.reduce((sum, p) => sum.add(p), new THREE.Vector3()).multiplyScalar(1 / values.length);
  assert(reasoning.pos!.distanceTo(mean(premises).add(mean(conclusions)).multiplyScalar(0.5)) < EPSILON, 'reasoning is the exact premise/conclusion centre midpoint');
}

const [, componentAngle] = [...diagnostics.usedAngles][0]!;
const direction = fibonacciDirections(89)[componentAngle]!;
const radialProjection = (id: string) => first.find(n => n.id === id)!.pos!.dot(direction);
assert(Math.abs((radialProjection('conclusion-1') - radialProjection('shared-a')) - LAYOUT_UNIT) < EPSILON, 'knowledge radial depth spacing is exactly L');

const sameLayer = ['premise-c', 'shared-a', 'shared-b'].map(id => first.find(n => n.id === id)!.pos!);
for (let i = 0; i < sameLayer.length; i++) for (let j = i + 1; j < sameLayer.length; j++) {
  assert(Math.abs(sameLayer[i]!.distanceTo(sameLayer[j]!) - LAYOUT_UNIT) < EPSILON, 'first three same-depth knowledge nodes form a 5R equilateral triangular template');
}

const second = fixture();
applyDeterministic5RLayout(second);
for (const original of first) assert(original.pos!.distanceTo(second.find(n => n.id === original.id)!.pos!) < 1e-9, `${original.id} must be deterministic`);
assert.deepEqual([...getLastLayoutDiagnostics()!.usedAngles], [...diagnostics.usedAngles], 'identical graph input must preserve angle assignments');
assert.deepEqual([...getLastLayoutDiagnostics()!.macroAssignments], [...diagnostics.macroAssignments], 'identical graph input must preserve seeded macro assignments');

const standalone = Array.from({ length: 13 }, (_, index) => node(`standalone-${String(index).padStart(2, '0')}`));
applyDeterministic5RLayout(standalone);
const standaloneDiagnostics = getLastLayoutDiagnostics()!;
assert.equal(standaloneDiagnostics.macroAssignments.size, MACRO_DIRECTION_COUNT, 'only the bounded top-12 set receives macro sectors');
assert.equal(new Set(standaloneDiagnostics.macroAssignments.values()).size, MACRO_DIRECTION_COUNT, 'top-12 components must occupy different macro sectors');
assert.equal(standaloneDiagnostics.usedAngles.size, standalone.length, 'each successful standalone component consumes exactly one global angle');

console.log('Deterministic 5R occupancy, triangular lattice, macro-sector, midpoint and determinism checks passed.');
