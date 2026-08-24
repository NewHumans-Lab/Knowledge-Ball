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

function node(id: string, premises: string[] = [], layer: 'inner' | 'middle' | 'outer' = 'middle', type = 'fact', hidden = false): UniformLayoutNode {
  return { id, premises, effectiveLayer: layer, type, hidden };
}
function xyz(item: UniformLayoutNode): [number, number, number] { assert(item.pos); return [item.pos.x, item.pos.y, item.pos.z]; }
function radius(item: UniformLayoutNode): number { assert(item.pos); return item.pos.length(); }
function distance(a: UniformLayoutNode, b: UniformLayoutNode): number { assert(a.pos && b.pos); return a.pos.distanceTo(b.pos); }
function assertNearly(actual: number, expected: number, message: string, epsilon = 1e-8): void { assert(Math.abs(actual - expected) <= epsilon, `${message}: expected ${expected}, got ${actual}`); }

assertNearly(ORDINARY_NODE_RADIUS, 7.2, 'ordinary ball radius must match the live scene default');
assertNearly(ORDINARY_NODE_DIAMETER, 14.4, 'ordinary ball diameter must be 14.4 world units');
assertNearly(FCC_NEIGHBOR_DISTANCE, ORDINARY_NODE_DIAMETER * 5, 'direct-neighbour spacing must be five ordinary-ball diameters');
assertNearly(FCC_NEIGHBOR_DISTANCE, 72, 'first constraint must remain exactly 72 world units');
assert.equal(FCC_NEIGHBOR_STEPS.length, 12, 'FCC must expose exactly twelve nearest neighbours');
for (const step of FCC_NEIGHBOR_STEPS) assertNearly(fccPositionForCoord(step).length(), FCC_NEIGHBOR_DISTANCE, 'every FCC nearest step must equal x');
assertNearly(LAYER_TARGET_RADIUS.inner, 72, 'inner soft target must be one x');
assertNearly(LAYER_TARGET_RADIUS.middle, 144, 'middle soft target must be two x');
assertNearly(LAYER_TARGET_RADIUS.outer, 216, 'outer soft target must be three x');

const reasoningChain = [
  node('conclusion', ['reasoning'], 'outer'),
  node('premise', [], 'inner'),
  node('reasoning', ['premise'], 'middle', 'reasoning'),
];
assert.deepEqual(collectDirectLayoutEdges(reasoningChain), [
  { fromId: 'reasoning', toId: 'conclusion' },
  { fromId: 'premise', toId: 'reasoning' },
], 'reasoning must remain a real directed layout node');
applyUniformLayerLayout(reasoningChain);
const premise = reasoningChain.find(item => item.id === 'premise')!;
const reasoning = reasoningChain.find(item => item.id === 'reasoning')!;
const conclusion = reasoningChain.find(item => item.id === 'conclusion')!;
assertNearly(distance(premise, reasoning), 72, 'premise -> reasoning must remain one x');
assertNearly(distance(reasoning, conclusion), 72, 'reasoning -> conclusion must remain one x');
assertNearly(radius(premise), 72, 'inner premise should occupy the inner target');
assertNearly(radius(reasoning), 144, 'middle reasoning should occupy the middle target');
assertNearly(radius(conclusion), 216, 'purple conclusion should be the outer anchor');
assert(radius(premise) < radius(reasoning) && radius(reasoning) < radius(conclusion), 'three-layer inference chain must point outward');

// Conclusion-first does not mean chain-length-times-72. A long all-blue chain
// starts near blue's 2x target, then keeps 72 and moves inward where possible.
const straightChain = [
  node('chain-d', ['chain-c']),
  node('chain-b', ['chain-a']),
  node('chain-a'),
  node('chain-c', ['chain-b']),
];
applyUniformLayerLayout(straightChain);
const ordered = ['chain-a', 'chain-b', 'chain-c', 'chain-d'].map(id => straightChain.find(item => item.id === id)!);
for (let i = 1; i < ordered.length; i++) assertNearly(distance(ordered[i - 1], ordered[i]), 72, 'long-chain direct edge must remain x');
assertNearly(radius(ordered[3]), 144, 'blue conclusion anchor must stay near the blue target instead of expanding with chain length');
assert(radius(ordered[2]) < radius(ordered[3]), 'first premise-side step from a blue conclusion should move inward when legal');
assert(Math.max(...ordered.map(radius)) <= 144 + 1e-8, 'all-blue chain must not be blown outward by total chain length');

// Direction outranks contradictory layer preference locally: a connected inner
// conclusion is allowed to use 2x so the first outer-labelled source can sit inward.
const directionVsLayer = [
  node('outer-source', [], 'outer'),
  node('inner-conclusion', ['outer-source'], 'inner'),
];
applyUniformLayerLayout(directionVsLayer);
assertNearly(distance(directionVsLayer[0], directionVsLayer[1]), 72, 'direction/layer conflict must not break x');
assertNearly(radius(directionVsLayer[1]), 144, 'connected inner conclusion may move to 2x to leave one inward slot');
assertNearly(radius(directionVsLayer[0]), 72, 'source should take the inward exact slot');
assert(radius(directionVsLayer[0]) < radius(directionVsLayer[1]), 'source must remain inward of target when a legal x slot exists');

const fork = [node('fork-root')];
for (let i = 0; i < 8; i++) fork.push(node(`fork-${i}`, ['fork-root']));
applyUniformLayerLayout(fork);
for (const child of fork.slice(1)) assertNearly(distance(fork[0], child), 72, 'free branch child must stay exactly one x from its parent');
for (let i = 0; i < fork.length; i++) for (let j = i + 1; j < fork.length; j++) assert(distance(fork[i], fork[j]) >= 72 - 1e-8, 'distinct FCC balls must never be closer than x');

// The shared source lands at 1x. One of its twelve FCC directions points into the
// physical Sun, so eleven legal 72-neighbour positions exist; only after those are
// consumed may another direct child exceed 72.
const crowded = [node('crowded-root')];
for (let i = 0; i < 13; i++) crowded.push(node(`crowded-${i}`, ['crowded-root']));
applyUniformLayerLayout(crowded);
const childDistances = crowded.slice(1).map(child => distance(crowded[0], child));
assert.equal(childDistances.filter(value => Math.abs(value - 72) <= 1e-8).length, 11, 'all eleven legal x gaps beside the Sun must fill first');
assert(childDistances.some(value => value > 72 + 1e-8), 'only a child without a legal exact slot may exceed x');

const isolatedInner = [node('isolated-inner', [], 'inner')];
const isolatedMiddle = [node('isolated-middle', [], 'middle')];
const isolatedOuter = [node('isolated-outer', [], 'outer')];
applyUniformLayerLayout(isolatedInner); applyUniformLayerLayout(isolatedMiddle); applyUniformLayerLayout(isolatedOuter);
assertNearly(radius(isolatedInner[0]), 72, 'isolated inner node should prefer 1x');
assertNearly(radius(isolatedMiddle[0]), 144, 'isolated middle node should prefer 2x');
assertNearly(radius(isolatedOuter[0]), 216, 'isolated outer node should prefer 3x');
assert(radius(isolatedInner[0]) >= CORE_LAYOUT_CLEARANCE_RADIUS, 'inner target must remain outside the physical Sun');

const isolatedMiddleSet = Array.from({ length: 12 }, (_, index) => node(`isolated-${String(index).padStart(2, '0')}`));
applyUniformLayerLayout(isolatedMiddleSet);
assert.equal(new Set(isolatedMiddleSet.map(item => xyz(item).join('|'))).size, isolatedMiddleSet.length, 'isolated roots must occupy distinct lattice sites');
for (const item of isolatedMiddleSet) assertNearly(radius(item), 144, 'first twelve middle roots should fit the 2x target radius');

const hidden = [node('visible-root'), node('hidden-node', ['visible-root'], 'outer', 'fact', true)];
applyUniformLayerLayout(hidden);
assertNearly(distance(hidden[0], hidden[1]), 72, 'hidden nodes still participate in real direct-edge spacing');
assert(radius(hidden[0]) < radius(hidden[1]), 'hidden target should still be outward of its source');

const deterministicA = [node('det-a', [], 'inner'), node('det-b', ['det-a']), node('det-c', ['det-b'], 'outer'), node('det-branch', ['det-b'])];
const deterministicB = [node('det-a', [], 'inner'), node('det-b', ['det-a']), node('det-c', ['det-b'], 'outer'), node('det-branch', ['det-b'])];
applyUniformLayerLayout(deterministicA); applyUniformLayerLayout(deterministicB);
assert.deepEqual(deterministicB.map(xyz), deterministicA.map(xyz), 'same graph must reconstruct to the same FCC coordinates');

const uniformSource = readFileSync('src/ui/scene/UniformLayerLayout.ts', 'utf8');
assert(uniformSource.includes('export const ORDINARY_NODE_RADIUS = 7.2;'));
assert(uniformSource.includes('export const FCC_NEIGHBOR_DISTANCE = ORDINARY_NODE_DIAMETER * 5;'));
assert(uniformSource.includes('collectDirectLayoutEdges'));
assert(uniformSource.includes('FCC_NEIGHBOR_STEPS'));
assert(uniformSource.includes('endpointDownstreamScore'), 'main spine must identify the conclusion side');
assert(uniformSource.includes('orientSpine'), 'main spine must be conclusion-first');
assert(uniformSource.includes('minimumConclusionRadius'), 'connected conclusion must reserve one inward step only');
assert(!uniformSource.includes('mainSpineRadialBudget'), 'chain-length radial expansion must stay removed');
assert(uniformSource.includes('directedRadialScore'), 'candidate choice must prefer source inward / target outward');
assert(uniformSource.includes('LAYER_TARGET_RADIUS'), 'colour layers must remain soft targets');
assert(uniformSource.includes('gapScore'), 'branch gap filling must remain last-stage aesthetics');
assert(uniformSource.includes('approximateDiameterPath'), 'one cheap main spine may remain for chain continuity');
assert(uniformSource.includes('Only after every legal exact-x neighbour is unavailable may a direct edge grow longer.'));
assert(!uniformSource.includes('endpointUpstreamScore'));
assert(!uniformSource.includes('ordinarySlotCache'));
assert(!uniformSource.includes('reasoningPerpendicular'));
assert(!uniformSource.includes('reasoningDominant'));
assert(!uniformSource.includes('reasoningSide'));
assert(!uniformSource.includes('LAYER_BANDS'));
assert(!uniformSource.includes('Fibonacci'));
assert(!uniformSource.includes('optimizeRelationLengthLayout'));

const sceneSource = readFileSync('src/ui/scene/KnowledgeScene.ts', 'utf8');
const physicsMatch = /const\s+physics\s*=/.exec(sceneSource);
const labelsMatch = /const\s+labels\s*=/.exec(sceneSource);
assert(physicsMatch && labelsMatch && labelsMatch.index > physicsMatch.index);
const physicsSource = sceneSource.slice(physicsMatch.index, labelsMatch.index);
assert(/n\.pos!\.copy\(n\.homePos!\)/.test(physicsSource), 'scene motion must return to the fixed projection coordinate');
assert(!physicsSource.includes('applyUniformLayerLayout'), 'camera/physics frames must never trigger relayout');

console.log('Five-diameter FCC + bounded conclusion-first direction + soft layer-target regression tests passed.');
