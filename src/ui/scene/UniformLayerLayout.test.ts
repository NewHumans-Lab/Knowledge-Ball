import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import * as THREE from 'three';
import {
  applyUniformLayerLayout,
  collectFccOrdinaryEdges,
  CORE_LAYOUT_CLEARANCE_RADIUS,
  FCC_NEIGHBOR_DISTANCE,
  FCC_NEIGHBOR_STEPS,
  fccPositionForCoord,
  resetUniformLayoutCacheForTests,
  type UniformLayoutNode,
} from './UniformLayerLayout';

function ordinary(
  id: string,
  premises: string[] = [],
  layer: 'inner' | 'middle' | 'outer' = 'middle',
  hidden = false,
): UniformLayoutNode {
  return {
    id,
    type: 'fact',
    premises,
    effectiveLayer: layer,
    hidden,
  };
}

function reasoning(
  id: string,
  premises: string[] = [],
  side?: 'normal' | 'opposition',
  dominant?: boolean,
  sideRank = 0,
): UniformLayoutNode {
  return {
    id,
    type: 'reasoning',
    premises,
    effectiveLayer: 'middle',
    lineage: side ? {
      reasoningSide: side,
      reasoningSideRank: sideRank,
      reasoningDominant: dominant,
    } : undefined,
  };
}

function xyz(node: UniformLayoutNode): [number, number, number] {
  assert(node.pos, `node ${node.id} is missing a layout position`);
  return [node.pos.x, node.pos.y, node.pos.z];
}

function distance(a: UniformLayoutNode, b: UniformLayoutNode): number {
  assert(a.pos && b.pos, 'distance endpoints must be laid out');
  return a.pos.distanceTo(b.pos);
}

function assertNearly(actual: number, expected: number, message: string, epsilon = 1e-8): void {
  assert(Math.abs(actual - expected) <= epsilon, `${message}: expected ${expected}, got ${actual}`);
}

assert.equal(FCC_NEIGHBOR_DISTANCE, 35, 'FCC x must be 35 directly in Three.js world units');
assert.equal(FCC_NEIGHBOR_STEPS.length, 12, 'FCC must expose exactly twelve nearest x-neighbours');
for (const step of FCC_NEIGHBOR_STEPS) {
  assertNearly(fccPositionForCoord(step).length(), FCC_NEIGHBOR_DISTANCE, 'every FCC nearest step must equal x');
}

// A simple long chain should use exact-x edges and continue in one straight 3D direction.
resetUniformLayoutCacheForTests();
const straightChain = [
  ordinary('chain-a', [], 'middle'),
  ordinary('chain-b', ['chain-a'], 'middle'),
  ordinary('chain-c', ['chain-b'], 'middle'),
  ordinary('chain-d', ['chain-c'], 'middle'),
];
applyUniformLayerLayout(straightChain);
assertNearly(distance(straightChain[0], straightChain[1]), FCC_NEIGHBOR_DISTANCE, 'first main-chain edge must use x');
assertNearly(distance(straightChain[1], straightChain[2]), FCC_NEIGHBOR_DISTANCE, 'second main-chain edge must use x');
assertNearly(distance(straightChain[2], straightChain[3]), FCC_NEIGHBOR_DISTANCE, 'third main-chain edge must use x');
const ab = straightChain[1].pos!.clone().sub(straightChain[0].pos!);
const bc = straightChain[2].pos!.clone().sub(straightChain[1].pos!);
const cd = straightChain[3].pos!.clone().sub(straightChain[2].pos!);
const straightDot = FCC_NEIGHBOR_DISTANCE * FCC_NEIGHBOR_DISTANCE - 1e-6;
assert(ab.dot(bc) > straightDot, 'main-chain continuation should keep the same direction when the x-slot is free');
assert(bc.dot(cd) > straightDot, 'long main chains should remain straight while free FCC slots exist');

// A normal fork should consume different exact-x slots around its parent.
resetUniformLayoutCacheForTests();
const fork = [
  ordinary('fork-root', [], 'outer'),
  ordinary('fork-a', ['fork-root'], 'outer'),
  ordinary('fork-b', ['fork-root'], 'outer'),
  ordinary('fork-c', ['fork-root'], 'outer'),
];
applyUniformLayerLayout(fork);
for (const child of fork.slice(1)) assertNearly(distance(fork[0], child), FCC_NEIGHBOR_DISTANCE, 'free fork child must stay exactly x from parent');
for (let i = 0; i < fork.length; i++) {
  for (let j = i + 1; j < fork.length; j++) {
    assert(distance(fork[i], fork[j]) >= FCC_NEIGHBOR_DISTANCE - 1e-8, 'distinct ordinary FCC nodes must never be closer than x');
  }
}

// More children than the twelve FCC neighbours may exceed x, but only after all exact-x choices are exhausted.
resetUniformLayoutCacheForTests();
const crowded = [ordinary('crowded-root', [], 'outer')];
for (let i = 0; i < 13; i++) crowded.push(ordinary(`crowded-${i}`, ['crowded-root'], 'outer'));
applyUniformLayerLayout(crowded);
const childDistances = crowded.slice(1).map(child => distance(crowded[0], child));
assert.equal(childDistances.filter(value => Math.abs(value - FCC_NEIGHBOR_DISTANCE) <= 1e-8).length, 12, 'all twelve exact-x FCC neighbours must be used before a longer edge is allowed');
assert(childDistances.some(value => value > FCC_NEIGHBOR_DISTANCE + 1e-8), 'the thirteenth crowded child may grow beyond x');
for (let i = 0; i < crowded.length; i++) {
  for (let j = i + 1; j < crowded.length; j++) {
    assert(distance(crowded[i], crowded[j]) >= FCC_NEIGHBOR_DISTANCE - 1e-8, 'crowded ordinary nodes must still keep the FCC >= x invariant');
  }
}

// Layer changes are direction preferences, not hard radial shells.
resetUniformLayoutCacheForTests();
const outward = [ordinary('layer-parent-out', [], 'middle'), ordinary('layer-child-out', ['layer-parent-out'], 'outer')];
applyUniformLayerLayout(outward);
assert(outward[1].pos!.length() > outward[0].pos!.length(), 'middle -> outer should prefer an outward x-slot');
resetUniformLayoutCacheForTests();
const inward = [ordinary('layer-parent-in', [], 'middle'), ordinary('layer-child-in', ['layer-parent-in'], 'inner')];
applyUniformLayerLayout(inward);
assert(inward[1].pos!.length() < inward[0].pos!.length(), 'middle -> inner should prefer an inward x-slot when one is free');
assert(outward[0].pos!.length() >= CORE_LAYOUT_CLEARANCE_RADIUS, 'ordinary roots must stay outside the independent Sun space');

// A real reasoning node is contracted out of ordinary FCC occupancy and placed between ordinary endpoints.
resetUniformLayoutCacheForTests();
const reasoningChain = [
  ordinary('premise', [], 'inner'),
  reasoning('reasoning', ['premise']),
  ordinary('conclusion', ['reasoning'], 'middle'),
];
const contracted = collectFccOrdinaryEdges(reasoningChain);
assert.deepEqual(contracted, [{ fromId: 'premise', toId: 'conclusion' }], 'reasoning must contract to the real ordinary endpoints for FCC occupancy');
applyUniformLayerLayout(reasoningChain);
assertNearly(distance(reasoningChain[0], reasoningChain[2]), FCC_NEIGHBOR_DISTANCE, 'ordinary endpoints across reasoning should still prefer one x, not two x');
const midpoint = reasoningChain[0].pos!.clone().add(reasoningChain[2].pos!).multiplyScalar(0.5);
assert(reasoningChain[1].pos!.distanceTo(midpoint) < 1e-8, 'single reasoning ball should sit on the ordinary chain instead of consuming an FCC slot');

// Persistent white/red reasoning camps may share the same logical endpoints without consuming extra ordinary slots.
resetUniformLayoutCacheForTests();
const dualReasoning = [
  ordinary('dual-premise', [], 'inner'),
  reasoning('white-head', ['dual-premise'], 'normal', false),
  reasoning('red-head', ['dual-premise'], 'opposition', true),
  ordinary('dual-conclusion', ['red-head'], 'middle'),
];
applyUniformLayerLayout(dualReasoning);
assertNearly(distance(dualReasoning[0], dualReasoning[3]), FCC_NEIGHBOR_DISTANCE, 'dominant reasoning camp must not multiply x across the reasoning ball');
const dualMidpoint = dualReasoning[0].pos!.clone().add(dualReasoning[3].pos!).multiplyScalar(0.5);
assert(dualReasoning[2].pos!.distanceTo(dualMidpoint) < 1e-8, 'dominant reasoning head should occupy the live chain axis');
assert(dualReasoning[1].pos!.distanceTo(dualMidpoint) > 0, 'non-dominant reasoning head should remain separately visible without occupying an ordinary slot');

// Hidden historical ordinary nodes still own real projection slots even when visibility later hides them.
resetUniformLayoutCacheForTests();
const hiddenHistory = [ordinary('visible-history-root', [], 'outer'), ordinary('hidden-history', ['visible-history-root'], 'outer', true)];
applyUniformLayerLayout(hiddenHistory);
assert(hiddenHistory[1].pos, 'hidden history must still receive a stable FCC projection position');
assertNearly(distance(hiddenHistory[0], hiddenHistory[1]), FCC_NEIGHBOR_DISTANCE, 'hidden history participates in occupancy before visibility filtering');

// Normal additions are incremental: surviving node IDs keep their previous coordinates.
resetUniformLayoutCacheForTests();
const initial = [ordinary('stable-a', [], 'middle'), ordinary('stable-b', ['stable-a'], 'middle')];
applyUniformLayerLayout(initial);
const stableA = xyz(initial[0]);
const stableB = xyz(initial[1]);
const extended = [
  ordinary('stable-a', [], 'middle'),
  ordinary('stable-b', ['stable-a'], 'middle'),
  ordinary('stable-c', ['stable-b'], 'outer'),
];
applyUniformLayerLayout(extended);
assert.deepEqual(xyz(extended[0]), stableA, 'adding knowledge must not move an already placed ordinary node');
assert.deepEqual(xyz(extended[1]), stableB, 'adding knowledge must preserve the existing chain geometry');
assertNearly(distance(extended[1], extended[2]), FCC_NEIGHBOR_DISTANCE, 'new node should use an exact-x local slot when available');

// A full reconstruction is deterministic for the same graph.
resetUniformLayoutCacheForTests();
const deterministicA = [ordinary('det-a'), ordinary('det-b', ['det-a']), ordinary('det-c', ['det-b'], 'outer')];
applyUniformLayerLayout(deterministicA);
const rebuiltA = deterministicA.map(xyz);
resetUniformLayoutCacheForTests();
const deterministicB = [ordinary('det-a'), ordinary('det-b', ['det-a']), ordinary('det-c', ['det-b'], 'outer')];
applyUniformLayerLayout(deterministicB);
assert.deepEqual(deterministicB.map(xyz), rebuiltA, 'FCC projection must reconstruct deterministically from the same graph');

const uniformSource = readFileSync('src/ui/scene/UniformLayerLayout.ts', 'utf8');
assert(uniformSource.includes('export const FCC_NEIGHBOR_DISTANCE = 35;'), 'x=35 world units must remain the explicit tunable visual-layout constant');
assert(!uniformSource.includes('FCC_WORLD_UNITS_PER_DISTANCE_UNIT'), 'x must remain a direct Three.js world distance without a second scale multiplier');
assert(!uniformSource.includes('stepSpan: 1 | 2'), 'reasoning occupancy must not reintroduce a two-x span');
assert(uniformSource.includes('FCC_NEIGHBOR_STEPS'), 'FCC nearest-neighbour directions must remain explicit');
assert(uniformSource.includes('Only after every exact-x neighbour is unavailable may an edge grow longer.'), 'longer-edge fallback must remain subordinate to exact-x placement');
assert(!uniformSource.includes('LAYER_BANDS'), 'new layout must not restore hard inner/middle/outer shells');
assert(!uniformSource.includes('Fibonacci'), 'new layout must not restore Fibonacci shell slots');
assert(!uniformSource.includes('optimizeRelationLengthLayout'), 'new layout must not rerun the old global relation slot optimizer');
assert(!uniformSource.includes('for (let j = i + 1'), 'FCC occupancy must not depend on all-pairs collision relaxation');

const sceneSource = readFileSync('src/ui/scene/KnowledgeScene.ts', 'utf8');
const physicsMatch = /const\s+physics\s*=/.exec(sceneSource);
const labelsMatch = /const\s+labels\s*=/.exec(sceneSource);
assert(physicsMatch && labelsMatch && labelsMatch.index > physicsMatch.index, 'scene physics implementation must remain discoverable');
const physicsSource = sceneSource.slice(physicsMatch.index, labelsMatch.index);
assert(/n\.pos!\.copy\(n\.homePos!\)/.test(physicsSource), 'ordinary scene motion must return to the fixed projection coordinate');
assert(!physicsSource.includes('applyUniformLayerLayout'), 'camera/physics frames must never trigger a new layout');

const appSource = readFileSync('src/ui/app.ts', 'utf8');
assert(appSource.includes('layoutNodes = domainNodes.map'), 'layout must still be built from every projected node before visibility filtering');
assert(appSource.includes('applyUniformLayerLayout(layoutNodes)'), 'the live page must use the FCC layout entry point');
assert(appSource.includes('renderNodes = layoutNodes.filter'), 'Current/Personal/All scene membership must remain downstream from layout occupancy');
assert(appSource.includes('nodeBelongsInLineageScene(node)'), 'formal lineage nodes must still enter layout before visibility filtering');

console.log('FCC tree layout regression tests passed.');
