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
assertNearly(LAYOUT_RADIUS_INCREMENT, 216, 'every capacity expansion must be exactly 3x');
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
assertNearly(radius(reasoning), 144, 'middle reasoning should follow one inward x');
assertNearly(radius(premise), 72, 'inner premise should follow the second inward x');
assert(radius(premise) < radius(reasoning) && radius(reasoning) < radius(conclusion), 'semantic inference direction must point outward');

// Depth capacity is solved by growing the whole sphere in 216-unit steps, not by
// stretching any direct relation. Four blue nodes require one expansion: 216 -> 432.
const blueLong = [
  node('blue-a'),
  node('blue-b', ['blue-a']),
  node('blue-c', ['blue-b']),
  node('blue-d', ['blue-c']),
];
applyUniformLayerLayout(blueLong);
const blueOrder = ['blue-a', 'blue-b', 'blue-c', 'blue-d'].map(id => blueLong.find(item => item.id === id)!);
for (let index = 1; index < blueOrder.length; index++) assertNearly(distance(blueOrder[index - 1], blueOrder[index]), 72, 'expanded long chain must preserve every x');
assertNearly(radius(blueOrder[3]), 288, 'blue conclusion uses the middle third of expanded radius 432');
assertNearly(radius(blueOrder[2]), 216, 'expanded chain walks inward by one x');
assertNearly(radius(blueOrder[1]), 144, 'expanded chain walks inward by two x');
assertNearly(radius(blueOrder[0]), 72, 'expanded chain walks inward by three x');

// If a later, smaller chain needs more room, every already-placed node in an older
// chain receives the same rigid +216 translation. Internal geometry is unchanged.
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
const deltas = ['a0', 'a1', 'a2', 'a3'].map(id => {
  const before = firstOnly.find(item => item.id === id)!.pos!;
  const after = combined.find(item => item.id === id)!.pos!;
  return after.clone().sub(before);
});
for (const delta of deltas) assertNearly(delta.length(), 216, 'capacity expansion must move the whole older chain outward by exactly 3x');
for (const delta of deltas.slice(1)) assert(delta.distanceTo(deltas[0]) <= 1e-7, 'every node of one chain must receive the exact same rigid translation');
for (const [left, right] of [['a0', 'a1'], ['a1', 'a2'], ['a2', 'a3']] as const) {
  assertNearly(distance(combined.find(item => item.id === left)!, combined.find(item => item.id === right)!), 72, 'rigid expansion must not alter direct spacing');
}

// Components are chains for envelope placement: larger chains claim the large
// directions first, regardless of lexicographic node ids.
const sizePriority = [
  node('big-a', [], 'outer'),
  node('big-b', ['big-a'], 'outer'),
  node('big-c', ['big-b'], 'outer'),
  node('aaa-isolated', [], 'outer'),
];
applyUniformLayerLayout(sizePriority);
assert(sizePriority.find(item => item.id === 'big-c')!.pos!.z > 0, 'larger chain must receive the first front direction');
assert(sizePriority.find(item => item.id === 'aaa-isolated')!.pos!.z < 0, 'smaller later chain must receive the back direction next');

// The first six independent chains occupy front/back/up/down/right/left. The next
// chain is inserted into the largest angular gap created by those six directions.
const directionRoots = Array.from({ length: 7 }, (_, index) => node(`dir-${index}`, [], 'outer'));
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
assert(Math.abs(normalized[6].x) > 0.5 && Math.abs(normalized[6].y) > 0.5 && Math.abs(normalized[6].z) > 0.5, 'seventh chain must fill an octant-sized largest gap rather than crowd an existing axis');

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
assert(source.includes('angularGapScore'), 'later chains must fill the largest spherical gap');
assert(source.includes('requiredSphereRadiusForSpine'), 'depth must trigger sphere capacity expansion');
assert(source.includes('expandSphere'), 'width/depth capacity must share one expansion path');
assert(source.includes('multiplyScalar(LAYOUT_RADIUS_INCREMENT)'), 'whole-chain outward translation must be exactly 3x');
assert(source.includes('for (const id of component.ids) positions.get(id)?.add(delta);'), 'expansion must translate a whole chain rigidly');
assert(source.includes('Long/main chain first: conclusion -> premise, straight toward the centre.'));
assert(source.includes('parentDegree > 12'), 'only intrinsically overfull local stars may immediately relax x');
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

console.log('Five-diameter rigid-chain sphere-capacity layout regression tests passed.');
