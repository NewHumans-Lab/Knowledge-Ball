import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import * as THREE from 'three';
import {
  collectRelationLayoutEdges,
  displayedRelationLength,
  optimizeRelationLengthLayout,
  totalRelationLineLength,
  type RelationLayoutNode,
} from './RelationLengthLayout';

function node(
  id: string,
  x: number,
  premises: string[] = [],
  hidden = false,
): RelationLayoutNode {
  const position = new THREE.Vector3(x, 0, 0);
  return {
    id,
    effectiveLayer: 'outer',
    layer: 'outer',
    pos: position.clone(),
    homePos: position.clone(),
    vel: new THREE.Vector3(),
    premises,
    hidden,
  };
}

// The objective is true Euclidean distance in 3D, not projected 2D distance or a rendered curve length.
const diagonal3d = displayedRelationLength(
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(3, 4, 12),
);
assert(Math.abs(diagonal3d - 13) < 1e-12, '3D relation length must equal Euclidean endpoint distance');

// Hidden history remains a first-class part of the geometry objective.
const historical = [
  node('visible-a', -100),
  node('hidden-b', 100, ['visible-a'], true),
  node('hidden-c', -95, ['hidden-b'], true),
  node('visible-d', 95, ['hidden-c']),
];
historical[3].logicRuleId = 'visible-a';
const historicalEdges = collectRelationLayoutEdges(historical);
assert(historicalEdges.some(edge => edge.fromId === 'visible-a' && edge.toId === 'hidden-b'), 'visible -> hidden line must remain in the objective');
assert(historicalEdges.some(edge => edge.fromId === 'hidden-b' && edge.toId === 'hidden-c'), 'hidden -> hidden line must remain in the objective');
assert(historicalEdges.some(edge => edge.fromId === 'hidden-c' && edge.toId === 'visible-d'), 'hidden -> visible line must remain in the objective');
assert(historicalEdges.some(edge => edge.kind === 'logic' && edge.fromId === 'visible-a' && edge.toId === 'visible-d'), 'logic relation must remain in the objective');

// Deliberately bad chain assignment: every relation initially jumps across the
// slot set. The optimizer may only permute these exact slots within the layer.
const chain = [
  node('a', -100),
  node('b', 100, ['a']),
  node('c', -95, ['b']),
  node('d', 95, ['c']),
  node('e', -90, ['d'], true),
  node('f', 90, ['e'], true),
];
const slotsBefore = chain.map(item => item.pos!.x).sort((a, b) => a - b);
const lengthBefore = totalRelationLineLength(chain);
const result = optimizeRelationLengthLayout(chain);
const lengthAfter = totalRelationLineLength(chain);
const slotsAfter = chain.map(item => item.pos!.x).sort((a, b) => a - b);

assert.deepEqual(slotsAfter, slotsBefore, 'optimizer must preserve the exact fixed slot set');
assert(lengthAfter <= lengthBefore + 1e-6, 'accepted optimization must never increase total straight 3D line length');
assert(lengthAfter < lengthBefore * 0.5, 'optimizer should materially shorten an obviously bad connected assignment');
assert.equal(result.edgeCount, 5, 'hidden historical chain edges must be counted');
assert(result.acceptedPasses > 0, 'the bad chain should accept at least one improving pass');
assert(Math.abs(result.before - lengthBefore) < 1e-6 && Math.abs(result.after - lengthAfter) < 1e-6, 'reported objective must match the actual straight 3D line total');

// Complexity guard: runtime layout code must not regress to all-pairs node swaps
// or sorting-based assignment. Tests may use sorting only to compare slot sets.
const relationSource = readFileSync('src/ui/scene/RelationLengthLayout.ts', 'utf8');
const uniformSource = readFileSync('src/ui/scene/UniformLayerLayout.ts', 'utf8');
const sceneSource = readFileSync('src/ui/scene/KnowledgeScene.ts', 'utf8');
assert(!relationSource.includes('for (let j = i + 1'), 'relation optimizer must not use all-pairs node comparison');
assert(!relationSource.includes('.sort('), 'relation optimizer must not rely on O(n log n) sorting');
assert(!uniformSource.includes('for (let j = i + 1'), 'uniform slot generation must not use all-pairs relaxation');
assert(!uniformSource.includes('.sort('), 'uniform slot generation must stay linear and sorting-free');
assert(relationSource.includes('LOCAL_CELL_RADIUS = 2'), 'nearest-slot search must stay bounded to a fixed spatial neighborhood');
assert(relationSource.includes('DEFAULT_PASSES = 4'), 'optimization pass count must remain a fixed constant');
assert(!relationSource.includes('CURVE_SEGMENTS'), 'layout objective must not approximate a curved render path');
assert(!relationSource.includes('QuadraticBezierCurve3'), 'layout objective must remain straight-line Euclidean distance');
assert(!sceneSource.includes('QuadraticBezierCurve3'), 'scene renderer must not curve knowledge relations');
assert(sceneSource.includes('l.geometry.setFromPoints([a!.clone(),b!.clone()])'), 'scene relation geometry must contain exactly the two 3D endpoints');

console.log('Complete historical straight-3D relation-length layout regression tests passed.');
