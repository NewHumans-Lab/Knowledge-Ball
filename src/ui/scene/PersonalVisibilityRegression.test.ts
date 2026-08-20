import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import {
  edgeVisibleInPersonalMode,
  nodeVisibleInPersonalMode,
} from './KnowledgeScene';

assert(nodeVisibleInPersonalMode({ id: 'ordinary-none', mastery: 'none' }, false), 'full graph mode must show untouched ordinary nodes');
assert(!nodeVisibleInPersonalMode({ id: 'ordinary-none', mastery: 'none' }, true), 'personal mode must hide untouched ordinary nodes');
assert(nodeVisibleInPersonalMode({ id: 'ordinary-touched', mastery: 'touched' }, true), 'personal mode must retain touched nodes');
assert(nodeVisibleInPersonalMode({ id: 'ordinary-mastered', mastery: 'mastered' }, true), 'personal mode must retain mastered nodes');
assert(nodeVisibleInPersonalMode({ id: 'n1', mastery: 'none' }, true), 'system core must remain visible in personal mode');

const touched = { id: 'touched', mastery: 'touched' as const };
const untouched = { id: 'untouched', mastery: 'none' as const };
assert(edgeVisibleInPersonalMode(touched, untouched, false, true), 'full graph mode must show a valid relation regardless of Personal mastery');
assert(!edgeVisibleInPersonalMode(touched, untouched, true, true), 'Personal mode must hide a relation when either endpoint is untouched');
assert(edgeVisibleInPersonalMode(touched, touched, true, true), 'Personal mode must retain relations whose two endpoints remain visible');
assert(!edgeVisibleInPersonalMode(touched, touched, false, false), 'invalid relation geometry must never render');
assert(!edgeVisibleInPersonalMode(undefined, touched, false, true), 'a relation whose endpoint was removed by node data changes must not render');
assert(edgeVisibleInPersonalMode(touched, untouched, false, true), 'leaving Personal mode must restore the original relation visibility');

const sceneSource = readFileSync('src/ui/scene/KnowledgeScene.ts', 'utf8');
assert(/edgeMap\[key\]\.userData\.edgeEndpoints\s*=\s*\[p,\s*n\.id\]/.test(sceneSource), 'premise/logic edges must retain endpoint identity for visibility filtering');
assert(/edgeMap\[key\]\.userData\.edgeEndpoints\s*=\s*\[n\.id,\s*twin\.id\]/.test(sceneSource), 'twin edges must retain endpoint identity for visibility filtering');
assert(/\.userData\.geometryVisible\s*=\s*true/.test(sceneSource), 'edge geometry validity must be stored independently from Personal visibility');
assert(sceneSource.includes('syncEdges(allNodes)'), 'relation lifecycle and geometry must be derived from the complete graph, not the current mobile LOD node subset');
assert(!sceneSource.includes('syncEdges(activeNodes)'), 'mobile LOD membership must never create, remove, or restore relation lines');
assert(/updateLineGeometry\(edgeMap\[key\],\s*byId\.get\(p\)\?\.pos,\s*n\.pos\)/.test(sceneSource), 'premise/logic geometry must use authoritative node positions even when an endpoint has no rendered mesh');
assert(/updateLineGeometry\(edgeMap\[key\],\s*n\.pos,\s*twin\.pos\)/.test(sceneSource), 'twin geometry must use authoritative node positions even when an endpoint has no rendered mesh');
assert(/setHideUntouched:\s*enabled\s*=>\s*\{\s*hideUntouched\s*=\s*enabled;\s*applyVisibility\(\);\s*largeGraphDirty\s*=\s*true;\s*\}/.test(sceneSource), 'Personal toggles must apply endpoint visibility immediately and then invalidate LOD membership');
assert(!/setHideUntouched:[^}]*syncEdges\(/s.test(sceneSource), 'Personal toggles must never synchronously rebuild relation geometry');

const geometryMatch = /const\s+updateLineGeometry\s*=/.exec(sceneSource);
const syncEdgesMatch = /const\s+syncEdges\s*=/.exec(sceneSource);
assert(geometryMatch && syncEdgesMatch && syncEdgesMatch.index > geometryMatch.index, 'edge geometry implementation must remain discoverable');
const geometrySource = sceneSource.slice(geometryMatch.index, syncEdgesMatch.index);
assert(!geometrySource.includes('.visible'), 'edge geometry updates must never own line visibility');

const visibilityMatch = /const\s+applyVisibility\s*=/.exec(sceneSource);
const syncMatch = /const\s+sync\s*=/.exec(sceneSource);
assert(visibilityMatch && syncMatch && syncMatch.index > visibilityMatch.index, 'personal visibility implementation must remain discoverable');
const visibilitySource = sceneSource.slice(visibilityMatch.index, syncMatch.index);
assert(visibilitySource.includes('edgeVisibleInPersonalMode('), 'edge visibility must be derived from Personal endpoint state through one canonical rule');
assert(!visibilitySource.includes('visibleIds'), 'edge visibility must not depend on whichever nodes currently have rendered meshes');
assert(!visibilitySource.includes('homePos'), 'personal visibility must never alter fixed layout slots');
assert(!visibilitySource.includes('optimizeRelationLengthLayout'), 'personal visibility must never rerun relation-length optimization');
assert(!visibilitySource.includes('syncEdges('), 'personal visibility must never rebuild relation geometry itself');
assert.equal((sceneSource.match(/edge\.visible\s*=/g) ?? []).length, 1, 'applyVisibility must be the only runtime owner that writes edge.visible');

console.log('Personal node/edge visibility authority regression tests passed.');
