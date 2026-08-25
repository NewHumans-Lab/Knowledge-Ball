import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import * as THREE from 'three';
import {
  collectRelationLayoutEdges,
  displayedRelationLength,
  optimizeRelationLengthLayout,
  scoreRelationComponentMorphology,
  totalRelationLineLength,
  type RelationLayoutNode,
} from './RelationLengthLayout';

function node(
  id: string,
  x: number,
  premises: string[] = [],
  hidden = false,
  layer: 'inner' | 'middle' | 'outer' = 'outer',
): RelationLayoutNode {
  const position = new THREE.Vector3(x, 0, 0);
  return {
    id,
    effectiveLayer: layer,
    layer,
    pos: position.clone(),
    homePos: position.clone(),
    vel: new THREE.Vector3(),
    premises,
    hidden,
  };
}

function slotXsByLayer(nodes: RelationLayoutNode[]) {
  return Object.fromEntries((['inner', 'middle', 'outer'] as const).map(layer => [
    layer,
    nodes.filter(item => item.layer === layer).map(item => item.pos!.x).sort((a, b) => a - b),
  ]));
}

const diagonal3d = displayedRelationLength(
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(3, 4, 12),
);
assert(Math.abs(diagonal3d - 13) < 1e-12, '3D relation length must equal Euclidean endpoint distance');

// Historical hidden records still occupy slots, but layout relation ownership is
// now only the real node-to-node chain. No logic metadata or twin UI link can
// create an extra optimization edge.
const historical = [
  node('visible-a', -100),
  node('hidden-b', 100, ['visible-a'], true),
  node('hidden-c', -95, ['hidden-b'], true),
  node('visible-d', 95, ['hidden-c']),
];
const historicalEdges = collectRelationLayoutEdges(historical);
assert(historicalEdges.some(edge => edge.fromId === 'visible-a' && edge.toId === 'hidden-b'), 'visible -> hidden chain edge must remain in the objective');
assert(historicalEdges.some(edge => edge.fromId === 'hidden-b' && edge.toId === 'hidden-c'), 'hidden -> hidden chain edge must remain in the objective');
assert(historicalEdges.some(edge => edge.fromId === 'hidden-c' && edge.toId === 'visible-d'), 'hidden -> visible chain edge must remain in the objective');
assert(historicalEdges.every(edge => edge.kind === 'chain'), 'layout must expose only the canonical chain edge class');

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
assert(lengthAfter < lengthBefore * 0.5, 'adaptive branch layout should materially shorten an obviously bad chain');
assert.equal(result.edgeCount, 5, 'all real chain edges must be counted');
assert(result.acceptedPasses > 0, 'the bad chain should accept at least one improving pass');
assert(Math.abs(result.before - lengthBefore) < 1e-6 && Math.abs(result.after - lengthAfter) < 1e-6, 'reported objective must match the actual straight 3D line total');

const longChainShape = scoreRelationComponentMorphology(12, 11, 11, 0);
const branchingTreeShape = scoreRelationComponentMorphology(15, 14, 6, 4);
const denseMeshShape = scoreRelationComponentMorphology(12, 30, 3, 8);
assert(longChainShape.branchWeight > branchingTreeShape.branchWeight, 'long sparse chains must lean more strongly toward branch continuation');
assert(branchingTreeShape.branchWeight > denseMeshShape.branchWeight, 'branching trees must remain between long chains and compact meshes');
assert(longChainShape.branchWeight > 0.9, 'a pure long chain should strongly prefer elongated placement');
assert(denseMeshShape.branchWeight < 0.2, 'a short redundant mesh should strongly prefer compact placement');
const nearShapeA = scoreRelationComponentMorphology(20, 22, 8, 3).branchWeight;
const nearShapeB = scoreRelationComponentMorphology(20, 22, 9, 3).branchWeight;
assert(Math.abs(nearShapeA - nearShapeB) < 0.1, 'shape selection must change continuously rather than jump at a hard threshold');

const crossLayer = [
  node('i1', 30, [], false, 'inner'),
  node('i2', -30, ['i1'], false, 'inner'),
  node('m1', 120, ['i2'], false, 'middle'),
  node('m2', -120, ['m1'], false, 'middle'),
  node('o1', 220, ['m2'], false, 'outer'),
  node('o2', -220, ['o1'], false, 'outer'),
];
const crossSlotsBefore = slotXsByLayer(crossLayer);
const crossLengthBefore = totalRelationLineLength(crossLayer);
optimizeRelationLengthLayout(crossLayer);
const crossSlotsAfter = slotXsByLayer(crossLayer);
const crossLengthAfter = totalRelationLineLength(crossLayer);
assert.deepEqual(crossSlotsAfter, crossSlotsBefore, 'cross-layer branch assignment must preserve every layer-specific slot set exactly');
assert(crossLengthAfter <= crossLengthBefore + 1e-6, 'cross-layer branch assignment must never increase total line length');

const deterministicA = chain.map(item => ({ ...item, pos: item.pos!.clone(), homePos: item.homePos!.clone(), vel: item.vel!.clone() }));
const deterministicB = chain.map(item => ({ ...item, pos: item.pos!.clone(), homePos: item.homePos!.clone(), vel: item.vel!.clone() }));
optimizeRelationLengthLayout(deterministicA);
optimizeRelationLengthLayout(deterministicB);
assert.deepEqual(
  deterministicA.map(item => [item.id, item.pos!.x, item.pos!.y, item.pos!.z]),
  deterministicB.map(item => [item.id, item.pos!.x, item.pos!.y, item.pos!.z]),
  'adaptive branch assignment must be deterministic for identical input',
);

const relationSource = readFileSync('src/ui/scene/RelationLengthLayout.ts', 'utf8');
const uniformSource = readFileSync('src/ui/scene/UniformLayerLayout.ts', 'utf8');
const sceneSource = readFileSync('src/ui/scene/KnowledgeScene.ts', 'utf8');
assert(!relationSource.includes('for (let j = i + 1'), 'relation optimizer must not use all-pairs node comparison');
assert(!relationSource.includes('.sort('), 'relation optimizer must not rely on O(n log n) sorting');
assert(!uniformSource.includes('for (let j = i + 1'), 'uniform slot generation must not use all-pairs relaxation');
assert(!uniformSource.includes('.sort('), 'uniform slot generation must stay linear and sorting-free');
assert(relationSource.includes('LOCAL_CELL_RADIUS = 2'), 'nearest-slot search must stay bounded to a fixed spatial neighborhood');
assert(relationSource.includes('DEFAULT_PASSES = 4'), 'optimization pass count must remain a fixed constant');
assert(relationSource.includes('approximateDiameterPath'), 'adaptive layout must inspect component extent without exact longest-path search');
assert(relationSource.includes('scoreRelationComponentMorphology'), 'adaptive layout must blend branch and compact placement continuously');
const collectorStart = relationSource.indexOf('export function collectRelationLayoutEdges');
const collectorEnd = relationSource.indexOf('export function displayedRelationLength');
assert(collectorStart >= 0 && collectorEnd > collectorStart, 'canonical line-layout collector must remain discoverable');
const collectorSource = relationSource.slice(collectorStart, collectorEnd);
assert(!collectorSource.includes('logicRuleId'), 'logic-rule metadata must not re-enter the actual line-layout edge collector');
assert(!collectorSource.includes('twinGroup'), 'legacy twin UI metadata must not re-enter the actual line-layout edge collector');
assert(!relationSource.includes('CURVE_SEGMENTS'), 'layout objective must not approximate a curved render path');
assert(!relationSource.includes('QuadraticBezierCurve3'), 'layout objective must remain straight-line Euclidean distance');
assert(!sceneSource.includes('QuadraticBezierCurve3'), 'scene renderer must not curve knowledge relations');
assert(/\.geometry\.setFromPoints\(\[a!\.clone\(\),\s*b!\.clone\(\)\]\)/.test(sceneSource), 'scene relation geometry must contain exactly the two 3D endpoints');

console.log('Canonical-chain adaptive relation-layout regression tests passed.');
