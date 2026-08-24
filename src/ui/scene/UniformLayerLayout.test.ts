import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import {
  applyUniformLayerLayout,
  collectDirectLayoutEdges,
  CORE_LAYOUT_CLEARANCE_RADIUS,
  FCC_NEIGHBOR_DISTANCE,
  FCC_NEIGHBOR_STEPS,
  fccPositionForCoord,
  LAYER_TARGET_RADIUS,
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

function xyz(item: UniformLayoutNode): [number, number, number] {
  assert(item.pos, `node ${item.id} is missing a layout position`);
  return [item.pos.x, item.pos.y, item.pos.z];
}

function radius(item: UniformLayoutNode): number {
  assert(item.pos, `node ${item.id} is missing a layout position`);
  return item.pos.length();
}

function distance(a: UniformLayoutNode, b: UniformLayoutNode): number {
  assert(a.pos && b.pos, 'distance endpoints must be laid out');
  return a.pos.distanceTo(b.pos);
}

function assertNearly(actual: number, expected: number, message: string, epsilon = 1e-8): void {
  assert(Math.abs(actual - expected) <= epsilon, `${message}: expected ${expected}, got ${actual}`);
}

assertNearly(ORDINARY_NODE_RADIUS, 7.2, 'ordinary ball radius must match the live scene default');
assertNearly(ORDINARY_NODE_DIAMETER, 14.4, 'ordinary ball diameter must be 14.4 world units');
assertNearly(FCC_NEIGHBOR_DISTANCE, ORDINARY_NODE_DIAMETER * 5, 'direct-neighbour spacing must be five ordinary-ball diameters');
assertNearly(FCC_NEIGHBOR_DISTANCE, 72, 'first constraint must remain exactly 72 world units');
assert.equal(FCC_NEIGHBOR_STEPS.length, 12, 'FCC must expose exactly twelve nearest neighbours');
for (const step of FCC_NEIGHBOR_STEPS) {
  assertNearly(fccPositionForCoord(step).length(), FCC_NEIGHBOR_DISTANCE, 'every FCC nearest step must equal x');
}
assertNearly(LAYER_TARGET_RADIUS.inner, 72, 'inner soft target must be one x');
assertNearly(LAYER_TARGET_RADIUS.middle, 144, 'middle soft target must be two x');
assertNearly(LAYER_TARGET_RADIUS.outer, 216, 'outer soft target must be three x');

// A real premise -> reasoning -> conclusion chain contains two real one-x edges.
// Placement starts from the conclusion side, but final geometry must read inward
// premise -> reasoning -> conclusion outward.
const reasoningChain = [
  node('conclusion', ['reasoning'], 'outer'),
  node('premise', [], 'inner'),
  node('reasoning', ['premise'], 'middle', 'reasoning'),
];
assert.deepEqual(
  collectDirectLayoutEdges(reasoningChain),
  [
    { fromId: 'reasoning', toId: 'conclusion' },
    { fromId: 'premise', toId: 'reasoning' },
  ],
  'reasoning must remain a real directed layout node instead of being contracted away',
);
applyUniformLayerLayout(reasoningChain);
const premise = reasoningChain.find(item => item.id === 'premise')!;
const reasoning = reasoningChain.find(item => item.id === 'reasoning')!;
const conclusion = reasoningChain.find(item => item.id === 'conclusion')!;
assertNearly(distance(premise, reasoning), FCC_NEIGHBOR_DISTANCE, 'premise -> reasoning must remain one x');
assertNearly(distance(reasoning, conclusion), FCC_NEIGHBOR_DISTANCE, 'reasoning -> conclusion must remain one x');
assert(radius(premise) < radius(reasoning), 'premise must be closer to the centre than reasoning');
assert(radius(reasoning) < radius(conclusion), 'reasoning must be closer to the centre than conclusion');
assertNearly(radius(premise), LAYER_TARGET_RADIUS.inner, 'inner premise should hit its soft target when unconstrained');
assertNearly(radius(reasoning), LAYER_TARGET_RADIUS.middle, 'middle reasoning should hit its soft target when unconstrained');
assertNearly(radius(conclusion), LAYER_TARGET_RADIUS.outer, 'outer conclusion should be the first outer anchor');

// A simple main chain is anchored at the conclusion, then walks backward toward
// premises. Final semantic order still moves strictly outward and stays straight.
const straightChain = [
  node('chain-d', ['chain-c']),
  node('chain-b', ['chain-a']),
  node('chain-a'),
  node('chain-c', ['chain-b']),
];
applyUniformLayerLayout(straightChain);
const orderedStraight = ['chain-a', 'chain-b', 'chain-c', 'chain-d'].map(id => straightChain.find(item => item.id === id)!);
for (let i = 1; i < orderedStraight.length; i++) {
  assertNearly(distance(orderedStraight[i - 1], orderedStraight[i]), FCC_NEIGHBOR_DISTANCE, 'main-chain edge must use one x');
  assert(radius(orderedStraight[i]) > radius(orderedStraight[i - 1]), 'semantic premise-to-conclusion direction must move outward');
}
assertNearly(radius(orderedStraight[3]), FCC_NEIGHBOR_DISTANCE * 4, 'four-node blue chain must place its conclusion far enough out to walk three exact steps inward');
assertNearly(radius(orderedStraight[0]), FCC_NEIGHBOR_DISTANCE, 'four-node blue chain must finish its earliest premise at the inner one-x radius');
const ab = orderedStraight[1].pos!.clone().sub(orderedStraight[0].pos!);
const bc = orderedStraight[2].pos!.clone().sub(orderedStraight[1].pos!);
const cd = orderedStraight[3].pos!.clone().sub(orderedStraight[2].pos!);
const straightDot = FCC_NEIGHBOR_DISTANCE ** 2 - 1e-6;
assert(ab.dot(bc) > straightDot, 'main chain should continue straight when the exact inward/outward ray is free');
assert(bc.dot(cd) > straightDot, 'long main chain should keep one straight radial direction');

// Direction outranks colour-layer preference. Even if the conclusion says inner
// and the premise says outer, conclusion-first placement must push the conclusion
// outward enough to leave an exact inward slot for the premise.
const directionVsLayer = [
  node('outer-source', [], 'outer'),
  node('inner-conclusion', ['outer-source'], 'inner'),
];
applyUniformLayerLayout(directionVsLayer);
assertNearly(distance(directionVsLayer[0], directionVsLayer[1]), FCC_NEIGHBOR_DISTANCE, 'direction/layer conflict must not break x');
assert(radius(directionVsLayer[0]) < radius(directionVsLayer[1]), 'source must remain inward of target even when colour layers disagree');
assertNearly(radius(directionVsLayer[1]), FCC_NEIGHBOR_DISTANCE * 2, 'inner conclusion may move beyond its soft target to preserve inference direction');
assertNearly(radius(directionVsLayer[0]), FCC_NEIGHBOR_DISTANCE, 'outer source may move inside its soft target when direction has higher priority');

// Branches fill distinct exact-x gaps around their parent. Radial preference may
// rank those legal gaps, but it may not replace them with farther positions.
const fork = [node('fork-root')];
for (let i = 0; i < 8; i++) fork.push(node(`fork-${i}`, ['fork-root']));
applyUniformLayerLayout(fork);
for (const child of fork.slice(1)) {
  assertNearly(distance(fork[0], child), FCC_NEIGHBOR_DISTANCE, 'free branch child must stay exactly one x from its parent');
}
for (let i = 0; i < fork.length; i++) {
  for (let j = i + 1; j < fork.length; j++) {
    assert(distance(fork[i], fork[j]) >= FCC_NEIGHBOR_DISTANCE - 1e-8, 'distinct FCC balls must never be closer than x');
  }
}

// A 13-way directed star has one conclusion used as the outer chain anchor, then
// its shared premise is placed inward. All twelve exact FCC directions around that
// premise must be occupied before the final conclusion is allowed to exceed x.
const crowded = [node('crowded-root')];
for (let i = 0; i < 13; i++) crowded.push(node(`crowded-${i}`, ['crowded-root']));
applyUniformLayerLayout(crowded);
const childDistances = crowded.slice(1).map(child => distance(crowded[0], child));
assert.equal(
  childDistances.filter(value => Math.abs(value - FCC_NEIGHBOR_DISTANCE) <= 1e-8).length,
  12,
  'all twelve legal exact-x gaps must fill before a longer edge is allowed',
);
assert(childDistances.some(value => value > FCC_NEIGHBOR_DISTANCE + 1e-8), 'only a child without any legal exact slot may exceed x');

// Isolated roots show the layer tendency directly without turning it into a hard
// boundary: cyan/inner near 1x, blue/middle near 2x, purple/outer near 3x.
const isolatedInner = [node('isolated-inner', [], 'inner')];
const isolatedMiddle = [node('isolated-middle', [], 'middle')];
const isolatedOuter = [node('isolated-outer', [], 'outer')];
applyUniformLayerLayout(isolatedInner);
applyUniformLayerLayout(isolatedMiddle);
applyUniformLayerLayout(isolatedOuter);
assertNearly(radius(isolatedInner[0]), LAYER_TARGET_RADIUS.inner, 'isolated inner node should prefer the inner target');
assertNearly(radius(isolatedMiddle[0]), LAYER_TARGET_RADIUS.middle, 'isolated middle node should prefer the middle target');
assertNearly(radius(isolatedOuter[0]), LAYER_TARGET_RADIUS.outer, 'isolated outer node should prefer the outer target');
assert(radius(isolatedInner[0]) < radius(isolatedMiddle[0]) && radius(isolatedMiddle[0]) < radius(isolatedOuter[0]), 'soft layer targets must order inner < middle < outer');
assert(radius(isolatedInner[0]) >= CORE_LAYOUT_CLEARANCE_RADIUS, 'inner target must remain outside the physical Sun');

// Multiple roots of the same layer use different FCC sites while remaining near
// that layer's preferred radial band when capacity exists.
const isolatedMiddleSet = Array.from({ length: 12 }, (_, index) => node(`isolated-${String(index).padStart(2, '0')}`));
applyUniformLayerLayout(isolatedMiddleSet);
const isolatedPositions = new Set(isolatedMiddleSet.map(item => xyz(item).join('|')));
assert.equal(isolatedPositions.size, isolatedMiddleSet.length, 'isolated roots must occupy distinct lattice gaps');
for (const item of isolatedMiddleSet) {
  assertNearly(radius(item), LAYER_TARGET_RADIUS.middle, 'first twelve middle roots should fit the 2x target shell');
}

// Hidden/history nodes still get real geometry before visibility filtering.
const hidden = [node('visible-root'), node('hidden-node', ['visible-root'], 'outer', 'fact', true)];
applyUniformLayerLayout(hidden);
assertNearly(distance(hidden[0], hidden[1]), FCC_NEIGHBOR_DISTANCE, 'hidden nodes still participate in real direct-edge spacing');
assert(radius(hidden[0]) < radius(hidden[1]), 'hidden target must still sit outward of its real source');

// Full reconstruction is deterministic and does not depend on a session slot cache.
const deterministicA = [node('det-a', [], 'inner'), node('det-b', ['det-a']), node('det-c', ['det-b'], 'outer'), node('det-branch', ['det-b'])];
const deterministicB = [node('det-a', [], 'inner'), node('det-b', ['det-a']), node('det-c', ['det-b'], 'outer'), node('det-branch', ['det-b'])];
applyUniformLayerLayout(deterministicA);
applyUniformLayerLayout(deterministicB);
assert.deepEqual(deterministicB.map(xyz), deterministicA.map(xyz), 'same graph must reconstruct to the same FCC coordinates');

const uniformSource = readFileSync('src/ui/scene/UniformLayerLayout.ts', 'utf8');
assert(uniformSource.includes('export const ORDINARY_NODE_RADIUS = 7.2;'), 'layout must state the real ordinary-ball radius it is using');
assert(uniformSource.includes('export const FCC_NEIGHBOR_DISTANCE = ORDINARY_NODE_DIAMETER * 5;'), 'spacing must remain visibly derived from five diameters');
assert(uniformSource.includes('collectDirectLayoutEdges'), 'layout must use only direct real graph edges');
assert(uniformSource.includes('gapScore'), 'branch placement must retain geometric gap filling');
assert(uniformSource.includes('approximateDiameterPath'), 'main-chain straightness may retain one cheap graph spine');
assert(uniformSource.includes('endpointDownstreamScore'), 'main spine must identify the conclusion side instead of the premise side');
assert(uniformSource.includes('orientSpine'), 'long spine must be oriented conclusion-first');
assert(uniformSource.includes('mainSpineRadialBudget'), 'conclusion anchor must reserve inward space for the whole main spine');
assert(uniformSource.includes('directedRadialScore'), 'candidate choice must encode source-inward / target-outward direction');
assert(uniformSource.includes('LAYER_TARGET_RADIUS'), 'inner/middle/outer must have soft radial targets');
assert(uniformSource.includes('Only after every legal exact-x neighbour is unavailable may a direct edge grow longer.'), 'longer edges must remain a strict fallback');
assert(!uniformSource.includes('Start a long spine at its middle and grow toward both ends.'), 'old centre-out chain reversal must stay removed');
assert(!uniformSource.includes('endpointUpstreamScore'), 'premise-first orientation must stay removed');
assert(!uniformSource.includes('ordinarySlotCache'), 'session slot caching must stay absent');
assert(!uniformSource.includes('reasoningPerpendicular'), 'reasoning-specific spatial offsets must stay absent');
assert(!uniformSource.includes('reasoningDominant'), 'reasoning camp dominance must not affect layout');
assert(!uniformSource.includes('reasoningSide'), 'reasoning camp side must not affect layout');
assert(!uniformSource.includes('LAYER_BANDS'), 'hard radial layer shells must remain absent');
assert(!uniformSource.includes('Fibonacci'), 'Fibonacci shell distribution must remain absent');
assert(!uniformSource.includes('optimizeRelationLengthLayout'), 'old semantic/relation optimizer must not re-enter the live layout');

const sceneSource = readFileSync('src/ui/scene/KnowledgeScene.ts', 'utf8');
const physicsMatch = /const\s+physics\s*=/.exec(sceneSource);
const labelsMatch = /const\s+labels\s*=/.exec(sceneSource);
assert(physicsMatch && labelsMatch && labelsMatch.index > physicsMatch.index, 'scene physics implementation must remain discoverable');
const physicsSource = sceneSource.slice(physicsMatch.index, labelsMatch.index);
assert(/n\.pos!\.copy\(n\.homePos!\)/.test(physicsSource), 'scene motion must return to the fixed projection coordinate');
assert(!physicsSource.includes('applyUniformLayerLayout'), 'camera/physics frames must never trigger relayout');

console.log('Five-diameter FCC + conclusion-first outward inference + soft layer-target regression tests passed.');
