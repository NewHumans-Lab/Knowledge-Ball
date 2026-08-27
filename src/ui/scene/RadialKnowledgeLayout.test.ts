import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  applyDeterministic5RLayout,
  compactTriangularCoordinates,
  computeSemanticBoundaries,
  EXCLUSION_RADIUS,
  EXPANSION_UNIT,
  fibonacciDirections,
  getLastLayoutDiagnostics,
  icosahedronMacroDirections,
  KNOWLEDGE_BALL_RADIUS,
  LAYOUT_UNIT,
  MACRO_DIRECTION_COUNT,
  mapMacroDirectionsToCandidates,
  positionsCollide,
  snapToNearestFcc,
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

assert.equal(LAYOUT_UNIT, KNOWLEDGE_BALL_RADIUS, 'placement precision must be R, not 5R');
assert.equal(EXCLUSION_RADIUS, 5 * KNOWLEDGE_BALL_RADIUS, 'dedup exclusion radius remains 5R');
assert.equal(EXPANSION_UNIT, 5 * KNOWLEDGE_BALL_RADIUS, 'minimum outward expansion remains 5R');
assert.equal(positionsCollide(new THREE.Vector3(), new THREE.Vector3(EXCLUSION_RADIUS, 0, 0)), true, 'positions at 5R are reserved');
assert.equal(positionsCollide(new THREE.Vector3(), new THREE.Vector3(EXCLUSION_RADIUS + 1e-4, 0, 0)), false, 'positions beyond 5R are not reserved');

const compact7 = compactTriangularCoordinates(7);
assert.deepEqual(compact7[0], [0, 0]);
assert.equal(new Set(compact7.map(([q, r]) => `${q}:${r}`)).size, 7);
assert(compact7.some(([, r]) => r !== 0), 'local branch solve must retain two tangential axes');

const snappedOrigin = snapToNearestFcc(new THREE.Vector3(0.1, 0.1, 0.1));
assert(snappedOrigin.length() < KNOWLEDGE_BALL_RADIUS, 'FCC snapping must be R-scale rather than a coarse 5R jump');
const snappedNeighbor = snapToNearestFcc(new THREE.Vector3(KNOWLEDGE_BALL_RADIUS / Math.sqrt(2), KNOWLEDGE_BALL_RADIUS / Math.sqrt(2), 0));
assert(Math.abs(snappedNeighbor.length() - KNOWLEDGE_BALL_RADIUS) < EPSILON, 'FCC nearest-neighbour distance must be R');

const macros = icosahedronMacroDirections();
assert.equal(macros.length, MACRO_DIRECTION_COUNT);
const fibonacci = fibonacciDirections(89);
const macroCandidates = mapMacroDirectionsToCandidates(macros, fibonacci);
assert.equal(new Set(macroCandidates).size, MACRO_DIRECTION_COUNT);

const boundaries = computeSemanticBoundaries([...fixture(), ...Array.from({ length: 9 }, (_, i) => node(`capacity-${i}`))]);
assert.equal(boundaries.cyanBlue % LAYOUT_UNIT, 0, 'semantic shells resolve at R precision');
assert.equal(boundaries.bluePurple % LAYOUT_UNIT, 0, 'semantic shells resolve at R precision');
assert.equal(boundaries.purpleOuter, null);

const first = fixture();
applyDeterministic5RLayout(first);
const diagnostics = getLastLayoutDiagnostics()!;
assert.equal(diagnostics.usedAngles.size, 1, 'shared premise/conclusion graph remains one connected component');
assert.equal(diagnostics.occupiedCells.size, first.filter(n => n.type !== 'reasoning').length, 'reasoning consumes no FCC occupancy point');
assert(diagnostics.reservedCells.size > diagnostics.occupiedCells.size, 'successful placement must reserve surrounding FCC points within 5R');

for (const reasoning of first.filter(n => n.type === 'reasoning')) {
  const premises = reasoning.premises!.map(id => first.find(n => n.id === id)!.pos!);
  const conclusions = first.filter(n => n.premises?.includes(reasoning.id)).map(n => n.pos!);
  const mean = (values: THREE.Vector3[]) => values.reduce((sum, p) => sum.add(p), new THREE.Vector3()).multiplyScalar(1 / values.length);
  assert(reasoning.pos!.distanceTo(mean(premises).add(mean(conclusions)).multiplyScalar(0.5)) < EPSILON, 'reasoning remains the exact premise/conclusion midpoint');
}

const [, componentAngle] = [...diagnostics.usedAngles][0]!;
const direction = fibonacciDirections(89)[componentAngle]!;
const outer = first.filter(n => n.declaredLayer === 'outer').map(n => n.pos!.dot(direction));
assert(Math.min(...outer.map(value => Math.abs(value - diagnostics.boundaries.bluePurple))) <= KNOWLEDGE_BALL_RADIUS, 'innermost Purple node must anchor to the Blue/Purple shell before FCC snapping');

const knowledgeKeys = first.filter(n => n.type !== 'reasoning').map(n => {
  const p = n.pos!;
  return `${p.x.toFixed(8)}:${p.y.toFixed(8)}:${p.z.toFixed(8)}`;
});
assert.equal(new Set(knowledgeKeys).size, knowledgeKeys.length, 'one component may use R-scale internal FCC detail but may not self-overlap the exact same FCC point');

const second = fixture();
applyDeterministic5RLayout(second);
for (const original of first) assert(original.pos!.distanceTo(second.find(n => n.id === original.id)!.pos!) < 1e-9, `${original.id} must be deterministic`);
assert.deepEqual([...getLastLayoutDiagnostics()!.usedAngles], [...diagnostics.usedAngles]);
assert.deepEqual([...getLastLayoutDiagnostics()!.macroAssignments], [...diagnostics.macroAssignments]);

const cyanBlueOnly: LayoutNode[] = [
  node('cyan-start'),
  node('cyan-reason', ['cyan-start'], 'reasoning'),
  node('blue-end', ['cyan-reason'], 'theorem', 'middle'),
];
applyDeterministic5RLayout(cyanBlueOnly);
const cyanBlueDiagnostics = getLastLayoutDiagnostics()!;
const [, cyanBlueAngle] = [...cyanBlueDiagnostics.usedAngles][0]!;
const cyanBlueDirection = fibonacciDirections(89)[cyanBlueAngle]!;
assert(Math.abs(cyanBlueOnly[0]!.pos!.dot(cyanBlueDirection) - cyanBlueDiagnostics.boundaries.cyanBlue) <= KNOWLEDGE_BALL_RADIUS, 'Cyan start node must anchor to the Cyan/Blue shell before FCC snapping');

const standalone = Array.from({ length: 13 }, (_, index) => node(`standalone-${String(index).padStart(2, '0')}`));
applyDeterministic5RLayout(standalone);
const standaloneDiagnostics = getLastLayoutDiagnostics()!;
assert.equal(standaloneDiagnostics.macroAssignments.size, MACRO_DIRECTION_COUNT, 'top-12 still receive distinct macro sectors');
assert.equal(new Set(standaloneDiagnostics.macroAssignments.values()).size, MACRO_DIRECTION_COUNT);
assert.equal(standaloneDiagnostics.usedAngles.size, standalone.length);

console.log('R-resolution FCC, 5R exclusion/expansion, shell anchoring, progressive component placement and determinism checks passed.');
