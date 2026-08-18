import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { nodeVisibleInPersonalMode } from './KnowledgeScene';

assert(nodeVisibleInPersonalMode({ id: 'ordinary-none', mastery: 'none' }, false), 'full graph mode must show untouched ordinary nodes');
assert(!nodeVisibleInPersonalMode({ id: 'ordinary-none', mastery: 'none' }, true), 'personal mode must hide untouched ordinary nodes');
assert(nodeVisibleInPersonalMode({ id: 'ordinary-touched', mastery: 'touched' }, true), 'personal mode must retain touched nodes');
assert(nodeVisibleInPersonalMode({ id: 'ordinary-mastered', mastery: 'mastered' }, true), 'personal mode must retain mastered nodes');
assert(nodeVisibleInPersonalMode({ id: 'n1', mastery: 'none' }, true), 'system core must remain visible in personal mode');

const sceneSource = readFileSync('src/ui/scene/KnowledgeScene.ts', 'utf8');
assert(/edgeMap\[key\]\.userData\.edgeEndpoints\s*=\s*\[p,\s*n\.id\]/.test(sceneSource), 'premise/logic edges must retain endpoint identity for visibility filtering');
assert(/edgeMap\[key\]\.userData\.edgeEndpoints\s*=\s*\[n\.id,\s*twin\.id\]/.test(sceneSource), 'twin edges must retain endpoint identity for visibility filtering');
assert(/const\s+visibleIds\s*=\s*new Set<string>\(\)/.test(sceneSource), 'personal visibility must derive one canonical visible-node set');
assert(/\.userData\.geometryVisible\s*=\s*true/.test(sceneSource), 'edge geometry validity must be stored independently from Personal visibility');
assert(/edge\.visible\s*=\s*edge\.userData\.geometryVisible\s*===\s*true\s*&&\s*visibleIds\.has\(endpoints\[0\]\)\s*&&\s*visibleIds\.has\(endpoints\[1\]\)/.test(sceneSource), 'a rendered edge must require valid geometry and two visible endpoints');
assert(/setHideUntouched:\s*enabled\s*=>\s*\{\s*hideUntouched\s*=\s*enabled;\s*applyVisibility\(\);\s*largeGraphDirty\s*=\s*true;\s*\}/.test(sceneSource), 'Personal toggles must apply endpoint visibility immediately and then invalidate LOD membership');
assert(!/setHideUntouched:[^}]*syncEdges\(/s.test(sceneSource), 'Personal toggles must never synchronously rebuild all edges');

const visibilityMatch = /const\s+applyVisibility\s*=/.exec(sceneSource);
const syncMatch = /const\s+sync\s*=/.exec(sceneSource);
assert(visibilityMatch && syncMatch && syncMatch.index > visibilityMatch.index, 'personal visibility implementation must remain discoverable');
const visibilitySource = sceneSource.slice(visibilityMatch.index, syncMatch.index);
assert(!visibilitySource.includes('homePos'), 'personal visibility must never alter fixed layout slots');
assert(!visibilitySource.includes('optimizeRelationLengthLayout'), 'personal visibility must never rerun relation-length optimization');
assert(!visibilitySource.includes('syncEdges('), 'personal visibility must never rebuild relation geometry itself');

console.log('Personal node/edge visibility regression tests passed.');
