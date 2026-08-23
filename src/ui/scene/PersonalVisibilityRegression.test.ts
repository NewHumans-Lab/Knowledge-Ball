import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import {
  edgeVisibleInPersonalMode,
  nodeVisibleInPersonalMode,
} from './KnowledgeScene';

assert(nodeVisibleInPersonalMode({ id: 'ordinary-none', mastery: 'none' }, false), 'legacy full-graph compatibility must show untouched ordinary nodes');
assert(!nodeVisibleInPersonalMode({ id: 'ordinary-none', mastery: 'none' }, true), 'legacy personal compatibility must hide untouched ordinary nodes');
assert(nodeVisibleInPersonalMode({ id: 'ordinary-touched', mastery: 'touched' }, true), 'personal mode must retain touched nodes');
assert(nodeVisibleInPersonalMode({ id: 'ordinary-mastered', mastery: 'mastered' }, true), 'personal mode must retain mastered nodes');
assert(nodeVisibleInPersonalMode({ id: 'n1', mastery: 'none' }, true), 'system core must remain visible in personal mode');

const touched = { id: 'touched', mastery: 'touched' as const };
const untouched = { id: 'untouched', mastery: 'none' as const };
assert(edgeVisibleInPersonalMode(touched, untouched, false, true), 'legacy full-graph compatibility must show a valid relation regardless of Personal mastery');
assert(!edgeVisibleInPersonalMode(touched, untouched, true, true), 'Personal mode must hide a relation when either endpoint is untouched');
assert(edgeVisibleInPersonalMode(touched, touched, true, true), 'Personal mode must retain relations whose two endpoints remain visible');
assert(!edgeVisibleInPersonalMode(touched, touched, false, false), 'invalid relation geometry must never render');
assert(!edgeVisibleInPersonalMode(undefined, touched, false, true), 'a relation whose endpoint was removed by node data changes must not render');
assert(edgeVisibleInPersonalMode(touched, untouched, false, true), 'leaving legacy Personal compatibility must restore the original relation visibility');

const sceneSource = readFileSync('src/ui/scene/KnowledgeScene.ts', 'utf8');
const syncEdgesStart = sceneSource.indexOf('const syncEdges =');
const visibilityStart = sceneSource.indexOf('const applyVisibility =');
assert(syncEdgesStart >= 0 && visibilityStart > syncEdgesStart, 'canonical scene-edge implementation must remain discoverable');
const syncEdgesSource = sceneSource.slice(syncEdgesStart, visibilityStart);
assert(/edgeMap\[key\]\.userData\.edgeEndpoints\s*=\s*\[from\.id,\s*to\.id\]/.test(syncEdgesSource), 'every canonical chain edge must retain its two real node IDs for visibility filtering');
assert(/updateLineGeometry\(edgeMap\[key\],\s*from\.pos,\s*to\.pos\)/.test(syncEdgesSource), 'canonical chain geometry must use authoritative endpoint positions even when an endpoint has no rendered mesh');
assert(syncEdgesSource.includes('collectKnowledgeChainEdges(nodes)'), 'scene edge lifecycle must come from the canonical real-node chain');
assert(!syncEdgesSource.includes('logicRuleId'), 'visibility/runtime edge ownership must not restore logic metadata as a line');
assert(!syncEdgesSource.includes('twinGroup'), 'visibility/runtime edge ownership must not restore legacy twin links');
assert(/\.userData\.geometryVisible\s*=\s*true/.test(sceneSource), 'edge geometry validity must be stored independently from mode visibility');
assert(sceneSource.includes('syncEdges(allNodes)'), 'relation lifecycle and geometry must be derived from the complete graph, not the current mobile LOD node subset');
assert(!sceneSource.includes('syncEdges(activeNodes)'), 'mobile LOD membership must never create, remove, or restore relation lines');
assert(/setVisibilityMode:\s*mode\s*=>\s*\{\s*visibilityMode\s*=\s*mode;\s*applyVisibility\(\);\s*largeGraphDirty\s*=\s*true;\s*\}/.test(sceneSource), 'Current/Personal/All mode changes must apply endpoint visibility immediately and then invalidate LOD membership');
assert(!/setVisibilityMode:[^}]*syncEdges\(/s.test(sceneSource), 'visibility mode changes must never synchronously rebuild relation geometry');

const geometryMatch = /const\s+updateLineGeometry\s*=/.exec(sceneSource);
const syncEdgesMatch = /const\s+syncEdges\s*=/.exec(sceneSource);
assert(geometryMatch && syncEdgesMatch && syncEdgesMatch.index > geometryMatch.index, 'edge geometry implementation must remain discoverable');
const geometrySource = sceneSource.slice(geometryMatch.index, syncEdgesMatch.index);
assert(!geometrySource.includes('.visible'), 'edge geometry updates must never own line visibility');

const visibilityMatch = /const\s+applyVisibility\s*=/.exec(sceneSource);
const syncMatch = /const\s+sync\s*=/.exec(sceneSource);
assert(visibilityMatch && syncMatch && syncMatch.index > visibilityMatch.index, 'knowledge-mode visibility implementation must remain discoverable');
const visibilitySource = sceneSource.slice(visibilityMatch.index, syncMatch.index);
assert(visibilitySource.includes('edgeVisibleInKnowledgeMode('), 'edge visibility must be derived from Current/Personal/All endpoint state through one canonical rule');
assert(!visibilitySource.includes('visibleIds'), 'edge visibility must not depend on whichever nodes currently have rendered meshes');
assert(!visibilitySource.includes('homePos'), 'visibility changes must never alter fixed layout slots');
assert(!visibilitySource.includes('optimizeRelationLengthLayout'), 'visibility changes must never rerun relation-length optimization');
assert(!visibilitySource.includes('syncEdges('), 'visibility changes must never rebuild relation geometry themselves');
assert.equal((sceneSource.match(/edge\.visible\s*=/g) ?? []).length, 1, 'applyVisibility must be the only runtime owner that writes edge.visible');

console.log('Canonical-chain Personal node/edge visibility authority regression tests passed.');
