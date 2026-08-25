import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import * as THREE from 'three';
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
function assertPairwiseMinimum(items: UniformLayoutNode[], message: string): void {
  for (let left = 0; left < items.length; left++) {
    for (let right = left + 1; right < items.length; right++) {
      assert(distance(items[left], items[right]) >= FCC_NEIGHBOR_DISTANCE - 1e-7, `${message}: ${items[left].id}/${items[right].id}`);
    }
  }
}
function gapScore(candidate: THREE.Vector3, occupied: readonly THREE.Vector3[]): number {
  if (occupied.length === 0) return 2;
  const unit = candidate.clone().normalize();
  return 1 - Math.max(...occupied.map(direction => unit.dot(direction)));
}
function approximateMaximumGap(occupied: readonly THREE.Vector3[], samples = 4096): number {
  if (occupied.length === 0) return 2;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  let best = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < samples; index++) {
    const y = 1 - 2 * (index + 0.5) / samples;
    const radial = Math.sqrt(Math.max(0, 1 - y * y));
    const angle = index * goldenAngle;
    const candidate = new THREE.Vector3(Math.cos(angle) * radial, y, Math.sin(angle) * radial);
    best = Math.max(best, gapScore(candidate, occupied));
  }
  return best;
}

assertNearly(ORDINARY_NODE_RADIUS, 7.2, 'ordinary ball radius must remain the live scene radius');
assertNearly(ORDINARY_NODE_DIAMETER, 14.4, 'ordinary ball diameter must remain 14.4');
assertNearly(FCC_NEIGHBOR_DISTANCE, 72, 'first constraint must remain exactly 72 world units');
assertNearly(INITIAL_LAYOUT_RADIUS, 216, 'knowledge sphere must start at 3x');
assertNearly(LAYOUT_RADIUS_INCREMENT, 216, 'every real global capacity expansion must increase R by exactly 216');
assert.equal(FCC_NEIGHBOR_STEPS.length, 12, 'reference FCC nearest-neighbour set stays intact');
for (const step of FCC_NEIGHBOR_STEPS) assertNearly(fccPositionForCoord(step).length(), 72, 'every reference FCC step remains one x');
assertNearly(LAYER_TARGET_RADIUS.inner, 72, 'initial cyan target is inner third');
assertNearly(LAYER_TARGET_RADIUS.middle, 144, 'initial blue target is middle third');
assertNearly(LAYER_TARGET_RADIUS.outer, 216, 'initial purple target is the outer surface');

// Reasoning is a real node. Exact local geometry owns the 72 constraint before global packing exists.
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
assert(radius(premise) < radius(reasoning) && radius(reasoning) < radius(conclusion), 'semantic inference should point outward when the exact inward shape fits');

// A shared premise is one local topology problem. It must be solved before world packing,
// preserving all exact 72 relations and ordinary-node non-overlap.
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
assertPairwiseMinimum(sharedPremise, 'shared-premise local geometry must not self-overlap');

// A long chain whose strict radial path would cross the Sun must bend locally before
// global capacity is considered. R remains 216 and every direct edge remains 72.
const blueLong = [
  node('blue-a'),
  node('blue-b', ['blue-a']),
  node('blue-c', ['blue-b']),
  node('blue-d', ['blue-c']),
];
applyUniformLayerLayout(blueLong);
const blueOrder = ['blue-a', 'blue-b', 'blue-c', 'blue-d'].map(id => blueLong.find(item => item.id === id)!);
for (let index = 1; index < blueOrder.length; index++) assertNearly(distance(blueOrder[index - 1], blueOrder[index]), 72, 'long blue chain must preserve every x');
assertNearly(radius(blueOrder[3]), 144, 'blue conclusion must remain at the initial middle target when a legal bend exists');
assert(Math.max(...blueLong.map(radius)) <= INITIAL_LAYOUT_RADIUS + 1e-7, 'bendable local topology must not expand the world');
assertPairwiseMinimum(blueLong, 'bent long chain must not self-overlap');

// Adding a later component that fits must not move an already-valid rigid component.
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
  assert(after.distanceTo(before) <= 1e-7, 'fitting a later chain must not cause false global expansion');
}
for (const [left, right] of [['a0', 'a1'], ['a1', 'a2'], ['a2', 'a3']] as const) {
  assertNearly(distance(combined.find(item => item.id === left)!, combined.find(item => item.id === right)!), 72, 'rigid component spacing must remain exact');
}

// Larger components are packed first; equal empty directions remain deterministically stable.
const sizePriority = [
  node('big-a', [], 'outer'),
  node('big-b', ['big-a'], 'outer'),
  node('big-c', ['big-b'], 'outer'),
  node('aaa-isolated', [], 'outer'),
];
applyUniformLayerLayout(sizePriority);
assert(sizePriority.find(item => item.id === 'big-c')!.pos!.z > 0, 'larger chain must receive the first unconstrained direction');
assert(sizePriority.find(item => item.id === 'aaa-isolated')!.pos!.z < 0, 'next component should occupy the opposite largest empty direction');

// This is the user-visible gap invariant: every new independent root must be near the
// true largest current spherical gap, not merely the next member of a fixed direction list.
const liveGapRoots = Array.from({ length: 12 }, (_, index) => node(`gap-${String(index).padStart(2, '0')}`, [], 'outer'));
applyUniformLayerLayout(liveGapRoots);
for (let index = 1; index < liveGapRoots.length; index++) {
  const occupied = liveGapRoots.slice(0, index).map(item => item.pos!.clone().normalize());
  const chosen = liveGapRoots[index].pos!.clone().normalize();
  const chosenGap = gapScore(chosen, occupied);
  const approximateBest = approximateMaximumGap(occupied);
  assert(
    chosenGap >= approximateBest - 0.045,
    `chain ${index} must enter the current largest live gap (chosen=${chosenGap}, approximate best=${approximateBest})`,
  );
}
assertPairwiseMinimum(liveGapRoots, 'live-gap roots must preserve non-overlap');

// Many unrelated outer roots fit on R=216. They must consume real empty surface area
// before any capacity expansion is permitted.
const roomyOuterRoots = Array.from({ length: 18 }, (_, index) => node(`room-${String(index).padStart(2, '0')}`, [], 'outer'));
applyUniformLayerLayout(roomyOuterRoots);
for (const item of roomyOuterRoots) assertNearly(radius(item), 216, 'roomy purple roots must remain on the original sphere surface');
assertPairwiseMinimum(roomyOuterRoots, 'roomy outer roots must keep the 72 minimum while filling live gaps');

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

// A legal local star keeps all direct edges exactly one x.
const forkChildren = Array.from({ length: 6 }, (_, index) => node(`fork-${index}`, [], 'inner'));
const fork = [node('fork-root', forkChildren.map(item => item.id), 'middle'), ...forkChildren];
applyUniformLayerLayout(fork);
for (const child of forkChildren) assertNearly(distance(fork[0], child), 72, 'a legal branch relation must remain exactly one x');
assertPairwiseMinimum(fork, 'legal local star must not overlap');

// Thirteen neighbours cannot all sit at distance 72 from one equal centre while also
// remaining pairwise >=72. This impossibility is resolved in LOCAL geometry: >=72 is
// preserved and at least one relation relaxes, without waiting for repeated R growth.
const crowdedChildren = Array.from({ length: 13 }, (_, index) => node(`crowded-${String(index).padStart(2, '0')}`, [], 'inner'));
const crowded = [node('crowded-root', crowdedChildren.map(item => item.id), 'middle'), ...crowdedChildren];
applyUniformLayerLayout(crowded);
const crowdedDistances = crowdedChildren.map(child => distance(crowded[0], child));
assert(crowdedDistances.every(value => value >= 72 - 1e-7), 'locally crowded fallback must never make a relation shorter than x');
assert(crowdedDistances.some(value => value > 72 + 1e-7), 'only locally impossible crowding may exceed x');
assertPairwiseMinimum(crowded, 'locally relaxed crowded star must still avoid overlap');

// Hidden real nodes remain part of geometry; visibility is downstream and cannot own layout.
const hidden = [node('visible-root'), node('hidden-node', ['visible-root'], 'outer', 'fact', true)];
applyUniformLayerLayout(hidden);
assertNearly(distance(hidden[0], hidden[1]), 72, 'hidden real nodes still participate in direct spacing');

// Same graph -> same projection. No frame-time/random placement state may leak in.
const deterministicA = [node('det-a', [], 'inner'), node('det-b', ['det-a']), node('det-c', ['det-b'], 'outer'), node('det-branch', ['det-b'])];
const deterministicB = [node('det-a', [], 'inner'), node('det-b', ['det-a']), node('det-c', ['det-b'], 'outer'), node('det-branch', ['det-b'])];
applyUniformLayerLayout(deterministicA);
applyUniformLayerLayout(deterministicB);
assert.deepEqual(deterministicB.map(xyz), deterministicA.map(xyz), 'same graph must reconstruct to identical two-phase coordinates');

// Architecture guards: local chain topology and global sphere packing must never be
// collapsed back into one ambiguous success/null loop.
const source = readFileSync('src/ui/scene/UniformLayerLayout.ts', 'utf8');
assert(source.includes('export const FCC_NEIGHBOR_DISTANCE = ORDINARY_NODE_DIAMETER * 5;'));
assert(source.includes('export const INITIAL_LAYOUT_RADIUS = FCC_NEIGHBOR_DISTANCE * 3;'));
assert(source.includes('export const LAYOUT_RADIUS_INCREMENT = FCC_NEIGHBOR_DISTANCE * 3;'));
assert(source.includes('components.sort((a, b) => b.length - a.length'), 'larger components must be scheduled first');
assert(source.includes('chooseConclusionAnchor'));
assert(source.includes('conclusionFirstSpine'));
assert(source.includes('directed.incomingIds.get(id)'));
assert(source.includes('function buildLocalComponentGeometry('), 'local geometry owner must remain explicit');
assert(source.includes('buildLocalComponentGeometry(plan, adjacency, directed, byId, mode, false)'), 'exact local geometry must precede relaxation');
assert(source.includes('if (exact.length > 0) return exact;'), 'exact local solution must block relaxed variants');
assert(source.includes('buildLocalComponentGeometry(plan, adjacency, directed, byId, mode, true)'), 'local relaxation is allowed only after exact local failure');
assert(source.includes('function liveOccupiedDirections('));
assert(source.includes('for (const position of positions.values())'), 'all actual occupied node directions must feed the gap calculation');
assert(source.includes('function refineGapDirection('), 'live gap search must refine directions continuously');
assert(source.includes('function liveGapDirections('));
assert(source.includes('function findBestComponentPlacement('));
assert(source.includes('sphereRadius = expandSphere(sphereRadius, placed, positions, byId);'), 'only global packing owns R growth');
assert(source.includes('layerRadiusForSphere(rootNode, nextRadius) - layerRadiusForSphere(rootNode, sphereRadius)'), 'expansion must apply inner/middle/outer radial deltas instead of universal +216');
assert(source.includes('for (const id of component.ids) positions.get(id)?.add(delta);'), 'each existing component must move rigidly');
assert(!source.includes('ANCHOR_DIRECTION_SEQUENCE'), 'fixed anchor sequence must stay removed');
assert(!source.includes('orderedAnchorDirections'), 'anchor-only occupancy ranking must stay removed');
assert(!source.includes('requiredSphereRadiusForSpine'), 'local depth must not pre-expand the world');
assert(!source.includes('RELAXED_EDGE_EXPANSION_THRESHOLD'), 'local relation relaxation must not depend on global expansion count');
assert(!source.includes('ordinarySlotCache'));
assert(!source.includes('reasoningPerpendicular'));
assert(!source.includes('reasoningDominant'));
assert(!source.includes('reasoningSide'));
assert(!source.includes('Fibonacci'));
assert(!source.includes('optimizeRelationLengthLayout'));

const localStart = source.indexOf('function buildLocalComponentGeometry(');
const localEnd = source.indexOf('function buildLocalComponentVariants(', localStart);
const localSource = source.slice(localStart, localEnd);
assert(!localSource.includes('sphereRadius'), 'local topology must not know global radius');
assert(!localSource.includes('globalPositions'), 'local topology must not know other components');
assert(!localSource.includes('expandSphere'), 'local topology must never expand the world');

const sceneSource = readFileSync('src/ui/scene/KnowledgeScene.ts', 'utf8');
const physicsMatch = /const\s+physics\s*=/.exec(sceneSource);
const labelsMatch = /const\s+labels\s*=/.exec(sceneSource);
assert(physicsMatch && labelsMatch && labelsMatch.index > physicsMatch.index);
const physicsSource = sceneSource.slice(physicsMatch.index, labelsMatch.index);
assert(/n\.pos!\.copy\(n\.homePos!\)/.test(physicsSource), 'scene physics must preserve the authoritative layout projection');
assert(!physicsSource.includes('applyUniformLayerLayout'), 'camera/physics frames must never trigger relayout');

console.log('Two-phase local-chain geometry and true live-gap global packing regression tests passed.');
