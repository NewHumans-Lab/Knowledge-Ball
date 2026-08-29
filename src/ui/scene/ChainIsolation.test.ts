import { strict as assert } from 'node:assert';
import * as THREE from 'three';
import {
  CHAIN_ISOLATION_ABSORB_FRACTION,
  CHAIN_ISOLATION_CORE_SCALE,
  CHAIN_ISOLATION_LONG_PRESS_MS,
  CHAIN_ISOLATION_MOVE_TOLERANCE_PX,
  chainIsolationNodeScale,
  chainIsolationRenderPosition,
  connectedChainIds,
  middleShellChainCenter,
} from './ChainIsolation';

const v = (x: number, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const nodes = [
  { id: 'a', type: 'fact', homePos: v(100) },
  { id: 'r1', type: 'reasoning', homePos: v(118) },
  { id: 'b', type: 'theorem', homePos: v(136, 10) },
  { id: 'c', type: 'fact', homePos: v(136, -10) },
  { id: 'r2', type: 'reasoning', homePos: v(154) },
  { id: 'd', type: 'theorem', homePos: v(172) },
  { id: 'other', type: 'fact', homePos: v(-200) },
];
const edges = [
  { fromId: 'a', toId: 'r1' },
  { fromId: 'r1', toId: 'b' },
  { fromId: 'r1', toId: 'c' },
  { fromId: 'b', toId: 'r2' },
  { fromId: 'r2', toId: 'd' },
];

assert.equal(CHAIN_ISOLATION_LONG_PRESS_MS, 2500, 'long press should stay inside the requested 2-3 second band');
assert(CHAIN_ISOLATION_MOVE_TOLERANCE_PX >= 8 && CHAIN_ISOLATION_MOVE_TOLERANCE_PX <= 12, 'movement tolerance must cancel accidental holds without making drag sticky');
assert(CHAIN_ISOLATION_CORE_SCALE > 0 && CHAIN_ISOLATION_CORE_SCALE <= .1, 'sun must shrink to a visible bright point, not disappear');

const chain = connectedChainIds('b', nodes, edges);
assert.deepEqual([...chain].sort(), ['a', 'b', 'c', 'd', 'r1', 'r2'].sort(), 'seed must resolve the full connected reasoning chain');
assert.deepEqual([...connectedChainIds('other', nodes, edges)], ['other'], 'isolated knowledge node is the minimum chain');
const eligible = new Set(['a', 'r1', 'b']);
assert.deepEqual([...connectedChainIds('b', nodes, edges, eligible)].sort(), ['a', 'b', 'r1'].sort(), 'chain resolution must respect the currently visible graph');

const center = middleShellChainCenter(nodes, chain);
assert(Math.abs(center.x - 136.36737602222409) < 1e-9, 'middle occupied shell must be selected from knowledge nodes');
assert(Math.abs(center.y) < 1e-12 && Math.abs(center.z) < 1e-12, 'all chain knowledge nodes on the middle shell must share the anchor centroid');
const isolatedCenter = middleShellChainCenter(nodes, new Set(['other']));
assert(isolatedCenter.distanceTo(v(-200)) < 1e-12, 'single-node chain must center that node on the former sun position');

const authoritative = v(136, 10);
const anchor = center;
const enteringAbsorbed = chainIsolationRenderPosition(authoritative, anchor, true, true, CHAIN_ISOLATION_ABSORB_FRACTION);
assert(enteringAbsorbed.length() < 1e-12, 'selected chain must first be absorbed into the core');
const enteringFinal = chainIsolationRenderPosition(authoritative, anchor, true, true, 1);
assert(enteringFinal.distanceTo(authoritative.clone().sub(anchor)) < 1e-12, 'final chain geometry must be translated only, never recomputed');
const outsideFinal = chainIsolationRenderPosition(v(-200), anchor, false, true, 1);
assert(outsideFinal.length() < 1e-12, 'non-chain nodes must finish absorbed at the core');
assert.equal(chainIsolationNodeScale(false, true, 1), 0, 'non-chain nodes must not remain rendered after entry');
assert(Math.abs(chainIsolationNodeScale(true, true, 1) - 1) < 1e-12, 'chain nodes must regrow to normal size');

const exitStart = chainIsolationRenderPosition(authoritative, anchor, true, false, 0);
assert(exitStart.distanceTo(authoritative.clone().sub(anchor)) < 1e-12, 'exit must start from the isolated chain location');
const exitAbsorbed = chainIsolationRenderPosition(authoritative, anchor, true, false, CHAIN_ISOLATION_ABSORB_FRACTION);
assert(exitAbsorbed.length() < 1e-12, 'exit must collapse the isolated chain back into the core before restoring the graph');
const exitFinal = chainIsolationRenderPosition(authoritative, anchor, true, false, 1);
assert(exitFinal.distanceTo(authoritative) < 1e-12, 'exit must restore authoritative position exactly');
assert.equal(chainIsolationNodeScale(false, false, 0), 0, 'outside nodes stay hidden at the start of exit');
assert.equal(chainIsolationNodeScale(false, false, 1), 1, 'outside nodes must restore to full size');

console.log('Chain isolation tests passed');
