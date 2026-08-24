import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import {
  applyUniformLayerLayout,
  collectDirectLayoutEdges,
  CORE_LAYOUT_CLEARANCE_RADIUS,
  FCC_NEIGHBOR_DISTANCE,
  FCC_NEIGHBOR_STEPS,
  fccPositionForCoord,
  INITIAL_LAYOUT_RADIUS,
  LAYER_TARGET_RADIUS,
  LAYOUT_RADIUS_INCREMENT,
  ORDINARY_NODE_DIAMETER,
  ORDINARY_NODE_RADIUS,
  type UniformLayoutNode,
} from './UniformLayerLayout';

function node(
  id: string,
  premises: string[] = [],
  layer: 'inner' | 'middle' | 'outer' = 'middle',
  type = 'fact',
  hidden = false,
): UniformLayoutNode {
  return { id, premises, effectiveLayer: layer, type, hidden };
}

function radius(item: UniformLayoutNode): number { assert(item.pos); return item.pos.length(); }
function distance(a: UniformLayoutNode, b: UniformLayoutNode): number { assert(a.pos && b.pos); return a.pos.distanceTo(b.pos); }
function xyz(item: UniformLayoutNode): [number, number, number] { assert(item.pos); return [item.pos.x, item.pos.y, item.pos.z]; }
function assertNearly(actual: number, expected: number, message: string, epsilon = 1e-7): void {
  assert(Math.abs(actual - expected) <= epsilon, `${message}: expected ${expected}, got ${actual}`);
}

assertNearly(ORDINARY_NODE_RADIUS, 7.2, 'ordinary ball radius must remain the live scene radius');
assertNearly(ORDINARY_NODE_DIAMETER, 14.4, 'ordinary ball diameter must remain 14.4');
assertNearly(FCC_NEIGHBOR_DISTANCE, 72, 'first constraint must remain exactly 72 world units');
assertNearly(INITIAL_LAYOUT_RADIUS, 216, 'knowledge sphere must start at 3x');
assertNearly(LAYOUT_RADIUS_INCREMENT, 216, 'every real capacity expansion must be exactly 3x');
assert.equal(FCC_NEIGHBOR_STEPS.length, 12, 'reference FCC nearest-neighbour set stays intact');
for (const step of FCC_NEIGHBOR_STEPS) assertNearly(fccPositionForCoord(step).length(), 72, 'every reference FCC step remains one x');
assertNearly(LAYER_TARGET_RADIUS.inner, 72, 'initial cyan target is inner third');
assertNearly(LAYER_TARGET_RADIUS.middle, 144, 'initial blue target is middle third');
assertNearly(LAYER_TARGET_RADIUS.outer, 216, 'initial purple target is the outer surface');

const reasoningChain = [
  node('conclusion', ['reasoning'], 'outer'),
  node('premise', [], 'inner'),
  node('reasoning', ['premise'], 'middle', 'reasoning'),
];
assert.deepEqual(collectDirectLayoutEdges(reasoningChain), [
  { fromId: 'reasoning', toId: 'conclusion' },
  { fromId: 'premise', toId: 'reasoning' },
]);
applyUniformLayerLayout(reasoningChain);
const premise = reasoningChain.find(item => item.id === 'premise')!;
const reasoning = reasoningChain.find(item => item.id === 'reasoning')!;
const conclusion = reasoningChain.find(item => item.id === 'conclusion')!;
assertNearly(distance(premise, reasoning), 72, 'premise -> reasoning must stay one x');
assertNearly(distance(reasoning, conclusion), 72, 'reasoning -> conclusion must stay one x');
assertNearly(radius(conclusion), 216, 'purple conclusion anchor must sit on the current outer surface');
assert(radius(premise) < radius(reasoning) && radius(reasoning) < radius(conclusion), 'semantic inference direction should point outward when exact inward slots are legal');

// Shared premise is a branch point, never permission to turn through it into a
// different conclusion and call the combined path one main chain.
const sharedPremise = [
  node('n3', [], 'inner'),
  node('r-n6', ['n3'], 'middle', 'reasoning'),
  node('n6', ['r-n6'], 'middle'),
  node('r-n15', ['n3'], 'middle', 'reasoning'),
  node('n15', ['r-n15'], 'middle'),
  node('r-n7', ['n3'], 'middle', 'reasoning'),
  node('n7', ['r-n7'], 'outer'),
];
applyUniformLayerLayout(sharedPremise);
for (const [left, right] of [
  ['n3', 'r-n6'], ['r-n6', 'n6'],
  ['n3', 'r-n15'], ['r-n15', 'n15'],
  ['n3', 'r-n7'], ['r-n7', 'n7'],
] as const) {
  assertNearly(
    distance(sharedPremise.find(item => item.id === left)!, sharedPremise.find(item => item.id === right)!),
    72,
    `${left} -> ${right} shared-premise branch must remain one x`,
  );
}
for (const item of sharedPremise) {
  for (const other of sharedPremise) {
    if (item.id >= other.id) continue;
    assert(distance(item, other) >= 72 - 1e-7, `shared-premise branches ${item.id}/${other.id} must not overlap`);
  }
}

// A long blue chain must first bend through other legal 72-unit directions inside
// the existing R=216 sphere. It must not pre-expand the entire world merely because
// strict radial inward continuation would hit the Sun.
const blueLong = [
  node('blue-a'),
  node('blue-b', ['blue-a']),
  node('blue-c', ['blue-b']),
  node('blue-d', ['blue-c']),
];
applyUniformLayerLayout(blueLong);
const blueOrder = ['blue-a', 'blue-b', 'blue-c', 'blue-d'].map(id => blueLong.find(item => item.id === id)!);
for (let index = 1; index < blueOrder.length; index++) assertNearly(distance(blueOrder[index - 1], blueOrder[index]), 72, 'long blue chain must preserve every x');
assertNearly(radius(blueOrder[3]), 144, 'blue conclusion starts at the middle target before any proven capacity failure');
assert(Math.max(...blueLong.map(radius)) <= INITIAL_LAYOUT_RADIUS + 1e-7, 'a bendable long blue chain must fit before radius expansion');

// Adding a small independent chain that fits the current live gaps must not move an
// already-valid chain at all. This catches the old pre-expansion ×1.5/×3 behaviour.
const firstOnly = [
  node('a0', [], 'outer'),
  node('a1', ['a0'], 'outer'),
  node('a2', ['a1'], 'outer'),
  node('a3', ['a2'], 'outer'),
];
applyUniformLayerLayout(firstOnly);
const combined = [
  node('a0', [], 'outer'),
  node('a1', ['a0'], 'outer'),
  node('a2', ['a1'], 'outer'),
  node('a3', ['a2'], 'outer'),
  node('b0', [], 'inner'),
  node('b1', ['b0'], 'inner'),
  node('b2', ['b1'], 'inner'),
];
applyUniformLayerLayout(combined);
for (const id of ['a0', 'a1', 'a2', 'a3']) {
  const before = firstOnly.find(item => item.id === id)!.pos!;
  const after = combined.find(item => item.id === id)!.pos!;
  assert(after.distanceTo(before) <= 1e-7, 'fitting a later chain must not trigger unnecessary whole-world expansion');
}
for (const [left, right] of [['a0', 'a1'], ['a1', 'a2'], ['a2', 'a3']] as const) {
  assertNearly(distance(combined.find(item => item.id === left)!, combined.find(item => item.id === right)!), 72, 'existing chain spacing must stay exact');
}

// Components are scheduled by size: larger chains claim the first major direction.
const sizePriority = [
  node('big-a', [], 'outer'),
  node('big-b', ['big-a'], 'outer'),
  node('big-c', ['big-b'], 'outer'),
  node('aaa-isolated', [], 'outer'),
];
applyUniformLayerLayout(sizePriority);
assert(sizePriority.find(item => item.id === 'big-c')!.pos!.z > 0, 'larger chain must receive the first front direction');
assert(sizePriority.find(item => item.id === 'aaa-isolated')!.pos!.z < 0, 'smaller later chain must receive the next free back direction');

// The first six independent chains occupy front/back/up/down/right/left. Every
// later chain must be placed by recomputing the largest current angular gap.
const directionRoots = Array.from({ length: 10 }, (_, index) => node(`dir-${index}`, [], 'outer'));
applyUniformLayerLayout(directionRoots);
const normalized = directionRoots.map(item => item.pos!.clone().normalize());
const expectedAxes = [
  [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0],
];
for (let index = 0; index < expectedAxes.length; index++) {
  const [x, y, z] = expectedAxes[index];
  assertNearly(normalized[index].x, x, `chain ${index} axis x`);
  assertNearly(normalized[index].y, y, `chain ${index} axis y`);
  assertNearly(normalized[index].z, z, `chain ${index} axis z`);
}
for (let index = 6; index < normalized.length; index++) {
  const nearestDot = Math.max(...normalized.slice(0, index).map(direction => direction.dot(normalized[index])));
  assert(nearestDot < 0.95, `later chain ${index} must enter a real remaining angular gap instead of crowding an existing direction`);
}

// Plenty of unrelated purple roots fit on the initial surface. They must consume
// live empty directions before any R+216 capacity expansion is considered.
const roomyOuterRoots = Array.from({ length: 18 }, (_, index) => node(`room-${index}`, [], 'outer'));
applyUniformLayerLayout(roomyOuterRoots);
for (const item of roomyOuterRoots) assertNearly(radius(item), 216, 'roomy independent purple roots must remain on the original sphere surface');
for (const item of roomyOuterRoots) {
  for (const other of roomyOuterRoots) {
    if (item.id >= other.id) continue;
    assert(distance(item, other) >= 72 - 1e-7, 'unrelated roots must keep the non-overlap minimum while filling live gaps');
  }
}

const isolatedInner = [node('isolated-inner', [], 'inner')];
const isolatedMiddle = [node('isolated-middle', [], 'middle')];
const isolatedOuter = [node('isolated-outer', [], 'outer')];
applyUniformLayerLayout(isolatedInner);
applyUniformLayerLayout(isolatedMiddle);
applyUniformLayerLayout(isolatedOuter);
assertNearly(radius(isolatedInner[0]), 72, 'cyan starts in the inner third');
assertNearly(radius(isolatedMiddle[0]), 144, 'blue starts in the middle third');
assertNearly(radius(isolatedOuter[0]), 216, 'purple starts on the outer surface');
assert(radius(isolatedInner[0]) >= CORE_LAYOUT_CLEARANCE_RADIUS, 'inner placement stays outside the physical Sun');

const forkChildren = Array.from({ length: 6 }, (_, index) => node(`fork-${index}`, [], 'inner'));
const fork = [node('fork-root', forkChildren.map(item => item.id), 'middle'), ...forkChildren];
applyUniformLayerLayout(fork);
for (const child of forkChildren) assertNearly(distance(fork[0], child), 72, 'a legal branch relation must remain exactly one x');
for (const item of fork) {
  for (const other of fork) {
    if (item.id >= other.id) continue;
    assert(distance(item, other) >= 72 - 1e-7, 'non-identical balls must not overlap the 72 minimum spacing');
  }
}

// Thirteen neighbours cannot all kiss one equal sphere with pairwise >=72. The
// impossible remainder may use >72, but no edge may become shorter than x.
const crowdedChildren = Array.from({ length: 13 }, (_, index) => node(`crowded-${index}`, [], 'inner'));
const crowded = [node('crowded-root', crowdedChildren.map(item => item.id), 'middle'), ...crowdedChildren];
applyUniformLayerLayout(crowded);
const crowdedDistances = crowdedChildren.map(child => distance(crowded[0], child));
assert(crowdedDistances.every(value => value >= 72 - 1e-7), 'crowded fallback must never make a relation shorter than x');
assert(crowdedDistances.some(value => value > 72 + 1e-7), 'only an intrinsically impossible crowded relation may exceed x');

const hidden = [node('visible-root'), node('hidden-node', ['visible-root'], 'outer', 'fact', true)];
applyUniformLayerLayout(hidden);
assertNearly(distance(hidden[0], hidden[1]), 72, 'hidden real nodes still participate in direct spacing');

const deterministicA = [node('det-a', [], 'inner'), node('det-b', ['det-a']), node('det-c', ['det-b'], 'outer'), node('det-branch', ['det-b'])];
const deterministicB = [node('det-a', [], 'inner'), node('det-b', ['det-a']), node('det-c', ['det-b'], 'outer'), node('det-branch', ['det-b'])];
applyUniformLayerLayout(deterministicA);
applyUniformLayerLayout(deterministicB);
assert.deepEqual(deterministicB.map(xyz), deterministicA.map(xyz), 'same graph must reconstruct to the same chain-envelope coordinates');

const source = readFileSync('src/ui/scene/UniformLayerLayout.ts', 'utf8');
assert(source.includes('export const FCC_NEIGHBOR_DISTANCE = ORDINARY_NODE_DIAMETER * 5;'));
assert(source.includes('export const INITIAL_LAYOUT_RADIUS = FCC_NEIGHBOR_DISTANCE * 3;'));
assert(source.includes('export const LAYOUT_RADIUS_INCREMENT = FCC_NEIGHBOR_DISTANCE * 3;'));
assert(source.includes('components.sort((a, b) => b.length - a.length'), 'larger chains must be scheduled first');
assert(source.includes('chooseConclusionAnchor'), 'layout must choose the conclusion/outer side before premises');
assert(source.includes("if (layer === 'outer') return sphereRadius;"), 'purple anchor must use the current outer surface');
assert(source.includes('BASE_ANCHOR_DIRECTIONS'), 'six large cardinal insertion directions must remain explicit');
assert(source.includes('orderedAnchorDirections'), 'every component must recompute live insertion order');
assert(source.includes('angularGapScore(b, used) - angularGapScore(a, used)'), 'later components must actually sort by the current largest spherical gap');
assert(!source.includes('requiredSphereRadiusForSpine'), 'layer depth must not pre-expand the entire sphere before real placement is attempted');
assert(source.includes('if (!candidate && allowLongEdges) candidate = chooseLongCandidate'), 'main chain may relax only after repeated real capacity failures');
assert(source.includes('expandSphere'), 'real width/depth capacity failure must share one expansion path');
assert(source.includes('multiplyScalar(LAYOUT_RADIUS_INCREMENT)'), 'whole-chain outward translation remains exactly 3x when expansion is truly needed');
assert(source.includes('for (const id of component.ids) positions.get(id)?.add(delta);'), 'real expansion must translate a whole chain rigidly');
assert(source.includes('directed.incomingIds.get(id)'), 'main spine must only walk incoming semantic edges toward premises');
assert(source.includes('parentDegree > 12'), 'intrinsically overfull local stars may relax x without pointless radius growth');
assert(!source.includes('ordinarySlotCache'));
assert(!source.includes('reasoningPerpendicular'));
assert(!source.includes('reasoningDominant'));
assert(!source.includes('reasoningSide'));
assert(!source.includes('Fibonacci'));
assert(!source.includes('optimizeRelationLengthLayout'));

const sceneSource = readFileSync('src/ui/scene/KnowledgeScene.ts', 'utf8');
const physicsMatch = /const\s+physics\s*=/.exec(sceneSource);
const labelsMatch = /const\s+labels\s*=/.exec(sceneSource);
assert(physicsMatch && labelsMatch && labelsMatch.index > physicsMatch.index);
const physicsSource = sceneSource.slice(physicsMatch.index, labelsMatch.index);
assert(/n\.pos!\.copy\(n\.homePos!\)/.test(physicsSource), 'scene motion must return to the fixed projection coordinate');
assert(!physicsSource.includes('applyUniformLayerLayout'), 'camera/physics frames must never trigger relayout');

console.log('Five-diameter dynamic-gap chain-capacity layout regression tests passed.');
