import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
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
const address = (shellID: string, cellID: number) => ({ shellID, cellID });
const nodes = [
  { id: 'a', type: 'fact', address: address('shell-1', 1), homePos: v(100) },
  { id: 'r1', type: 'reasoning', homePos: v(118) },
  { id: 'b', type: 'theorem', address: address('shell-2', 2), homePos: v(136, 10) },
  { id: 'c', type: 'fact', address: address('shell-2', 3), homePos: v(137, -10) },
  { id: 'r2', type: 'reasoning', homePos: v(154) },
  { id: 'd', type: 'theorem', address: address('shell-3', 4), homePos: v(172) },
  { id: 'other', type: 'fact', address: address('shell-other', 5), homePos: v(-200) },
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
assert(Math.abs(center.x - 136.5) < 1e-12, 'middle occupied canonical shell must be selected from knowledge nodes');
assert(Math.abs(center.y) < 1e-12 && Math.abs(center.z) < 1e-12, 'all chain knowledge nodes on the middle shell must share the anchor centroid');
assert(center.distanceTo(nodes[2]!.homePos) > 0 && center.distanceTo(nodes[3]!.homePos) > 0, 'anchor must be the shell-chain centroid, never the long-pressed ball');
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

const sceneSource = readFileSync('src/ui/scene/KnowledgeScene.ts', 'utf8');
assert(sceneSource.includes('chainHoldTimer = window.setTimeout'), 'scene must wire a real hold timer instead of treating ordinary taps as chain isolation');
assert(sceneSource.includes('}, CHAIN_ISOLATION_LONG_PRESS_MS);'), 'hold timer must use the shared 2.5 second threshold');
assert(sceneSource.includes('Math.hypot(point.x - downX, point.y - downY) > CHAIN_ISOLATION_MOVE_TOLERANCE_PX'), 'movement must cancel a pending long press');
assert(sceneSource.includes('beginChainIsolation(draggedNodeId)'), 'long press must enter isolation for the picked knowledge node');
assert(sceneSource.includes('anchorCenter: middleShellChainCenter(nodes, chainIds)'), 'isolation center must come from the chain middle shell, never the long-pressed node');
assert(sceneSource.includes("mode = chainIsolationState ? 'rotate' : draggedNodeId ? 'node' : 'rotate'"), 'isolated chain must rotate as a rigid view instead of dragging authoritative nodes');
assert(sceneSource.includes("if (chainIsolationState?.phase === 'isolated') {\n        beginChainIsolationExit();"), 'blank tap in stable isolation must start the reverse animation');
assert(sceneSource.includes('window.setTimeout(() => callbacks.onNodeTap(nodeId), 0)'), 'knowledge-node tap must keep the existing detail-opening path inside isolation');
assert(sceneSource.includes('worldGroup.quaternion.copy(state.exitQuaternion).slerp(state.normalQuaternion, progress)'), 'exit must restore the pre-isolation orientation');
assert(sceneSource.includes('graphZoom = THREE.MathUtils.lerp(state.exitGraphZoom, state.normalGraphZoom, progress)'), 'exit must restore the pre-isolation zoom');
assert(sceneSource.includes('coreSunGroup.scale.setScalar(sunScale)'), 'sun must visibly shrink and regrow during the transition');
const presentationStart = sceneSource.indexOf('const applyChainIsolationPresentation =');
const pointerStart = sceneSource.indexOf('const down =', presentationStart);
assert(presentationStart >= 0 && pointerStart > presentationStart, 'chain-isolation presentation block must remain discoverable');
const presentationSource = sceneSource.slice(presentationStart, pointerStart);
assert(!/node\.pos\.(?:add|copy|lerp|set)/.test(presentationSource), 'isolation presentation must never mutate canonical node positions');
assert(presentationSource.includes('record.group.position.copy(rendered)'), 'isolation must change render transforms only');

console.log('Chain isolation tests passed');