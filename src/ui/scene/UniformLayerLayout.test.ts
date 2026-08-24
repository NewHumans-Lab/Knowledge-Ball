import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import {
  applyUniformLayerLayout,
  collectDirectLayoutEdges,
  CORE_LAYOUT_CLEARANCE_RADIUS,
  FCC_NEIGHBOR_DISTANCE,
  FCC_NEIGHBOR_STEPS,
  fccPositionForCoord,
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
assertNearly(FCC_NEIGHBOR_DISTANCE, 72, 'five-diameter centre distance must currently be 72 world units');
assert.equal(FCC_NEIGHBOR_STEPS.length, 12, 'FCC must expose exactly twelve nearest neighbours');
for (const step of FCC_NEIGHBOR_STEPS) {
  assertNearly(fccPositionForCoord(step).length(), FCC_NEIGHBOR_DISTANCE, 'every FCC nearest step must equal x');
}

// A real premise -> reasoning -> conclusion chain contains two real one-x edges.
const reasoningChain = [
  node('premise', [], 'inner'),
  node('reasoning', ['premise'], 'middle', 'reasoning'),
  node('conclusion', ['reasoning'], 'outer'),
];
assert.deepEqual(
  collectDirectLayoutEdges(reasoningChain),
  [
    { fromId: 'premise', toId: 'reasoning' },
    { fromId: 'reasoning', toId: 'conclusion' },
  ],
  'reasoning must remain a real layout node instead of being contracted away',
);
applyUniformLayerLayout(reasoningChain);
assertNearly(distance(reasoningChain[0], reasoningChain[1]), FCC_NEIGHBOR_DISTANCE, 'premise -> reasoning must be one x');
assertNearly(distance(reasoningChain[1], reasoningChain[2]), FCC_NEIGHBOR_DISTANCE, 'reasoning -> conclusion must be one x');

// A simple main chain grows from its middle, uses exact-x edges and stays straight.
const straightChain = [
  node('chain-a'),
  node('chain-b', ['chain-a']),
  node('chain-c', ['chain-b']),
  node('chain-d', ['chain-c']),
];
applyUniformLayerLayout(straightChain);
for (let i = 1; i < straightChain.length; i++) {
  assertNearly(distance(straightChain[i - 1], straightChain[i]), FCC_NEIGHBOR_DISTANCE, 'main-chain edge must use one x');
}
const ab = straightChain[1].pos!.clone().sub(straightChain[0].pos!);
const bc = straightChain[2].pos!.clone().sub(straightChain[1].pos!);
const cd = straightChain[3].pos!.clone().sub(straightChain[2].pos!);
const straightDot = FCC_NEIGHBOR_DISTANCE ** 2 - 1e-6;
assert(ab.dot(bc) > straightDot, 'main chain should continue straight when the slot is free');
assert(bc.dot(cd) > straightDot, 'long main chain should keep the same straight direction');

// Branches fill distinct exact-x gaps around their parent.
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

// The root sits one x from the physical Sun, so its inward FCC slot is illegal.
// Every remaining legal exact-x gap must be consumed before a child grows farther.
const crowded = [node('crowded-root')];
for (let i = 0; i < 13; i++) crowded.push(node(`crowded-${i}`, ['crowded-root']));
applyUniformLayerLayout(crowded);
const childDistances = crowded.slice(1).map(child => distance(crowded[0], child));
assert.equal(
  childDistances.filter(value => Math.abs(value - FCC_NEIGHBOR_DISTANCE) <= 1e-8).length,
  11,
  'all eleven legal exact-x gaps beside the physical Sun must fill before a longer edge is allowed',
);
assert(childDistances.some(value => value > FCC_NEIGHBOR_DISTANCE + 1e-8), 'only children without a legal exact slot may exceed x');

// Disconnected roots use geometric gap filling: the first twelve fit the nearest FCC shell evenly.
const isolated = Array.from({ length: 12 }, (_, index) => node(`isolated-${String(index).padStart(2, '0')}`));
applyUniformLayerLayout(isolated);
const isolatedPositions = new Set(isolated.map(item => xyz(item).join('|')));
assert.equal(isolatedPositions.size, isolated.length, 'isolated roots must occupy distinct lattice gaps');
for (const item of isolated) {
  assertNearly(item.pos!.length(), FCC_NEIGHBOR_DISTANCE, 'the first twelve isolated roots should fill the nearest one-x shell');
}

// Layer colours/classification must not steer geometry anymore.
const layersA = [
  node('layer-a', [], 'inner'),
  node('layer-b', ['layer-a'], 'middle'),
  node('layer-c', ['layer-b'], 'outer'),
];
const layersB = [
  node('layer-a', [], 'outer'),
  node('layer-b', ['layer-a'], 'inner'),
  node('layer-c', ['layer-b'], 'middle'),
];
applyUniformLayerLayout(layersA);
applyUniformLayerLayout(layersB);
assert.deepEqual(layersB.map(xyz), layersA.map(xyz), 'inner/middle/outer classification must not change FCC positions');
assert(layersA[0].pos!.length() >= CORE_LAYOUT_CLEARANCE_RADIUS, 'first graph root must stay outside the physical Sun');

// Hidden/history nodes still get real geometry before visibility filtering.
const hidden = [node('visible-root'), node('hidden-node', ['visible-root'], 'outer', 'fact', true)];
applyUniformLayerLayout(hidden);
assertNearly(distance(hidden[0], hidden[1]), FCC_NEIGHBOR_DISTANCE, 'hidden nodes still participate in real direct-edge spacing');

// Full reconstruction is deterministic and does not depend on a session slot cache.
const deterministicA = [node('det-a'), node('det-b', ['det-a']), node('det-c', ['det-b']), node('det-branch', ['det-b'])];
const deterministicB = [node('det-a'), node('det-b', ['det-a']), node('det-c', ['det-b']), node('det-branch', ['det-b'])];
applyUniformLayerLayout(deterministicA);
applyUniformLayerLayout(deterministicB);
assert.deepEqual(deterministicB.map(xyz), deterministicA.map(xyz), 'same graph must reconstruct to the same FCC coordinates');

const uniformSource = readFileSync('src/ui/scene/UniformLayerLayout.ts', 'utf8');
assert(uniformSource.includes('export const ORDINARY_NODE_RADIUS = 7.2;'), 'layout must state the real ordinary-ball radius it is using');
assert(uniformSource.includes('export const FCC_NEIGHBOR_DISTANCE = ORDINARY_NODE_DIAMETER * 5;'), 'spacing must be visibly derived from five diameters');
assert(uniformSource.includes('collectDirectLayoutEdges'), 'layout must use only direct real graph edges');
assert(uniformSource.includes('gapScore'), 'branch placement must retain geometric gap filling');
assert(uniformSource.includes('approximateDiameterPath'), 'main-chain straightness may use one cheap graph spine');
assert(uniformSource.includes('Start a long spine at its middle and grow toward both ends.'), 'long chains must use the compact centre-out geometric schedule');
assert(uniformSource.includes('Only after every exact-x neighbour is occupied may a direct edge grow longer.'), 'longer edges must remain a strict fallback');
assert(!uniformSource.includes('LAYER_RANK'), 'layer-direction scoring must be removed');
assert(!uniformSource.includes('layerDelta'), 'inner/middle/outer must not steer candidate choice');
assert(!uniformSource.includes('ordinarySlotCache'), 'session slot caching must be removed from the simple first version');
assert(!uniformSource.includes('reasoningPerpendicular'), 'reasoning-specific spatial offsets must be removed');
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

console.log('Simple five-diameter FCC layout regression tests passed.');
