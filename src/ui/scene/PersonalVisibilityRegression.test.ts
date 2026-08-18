import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { nodeVisibleInPersonalMode } from './KnowledgeScene';

assert(nodeVisibleInPersonalMode({ id: 'ordinary-none', mastery: 'none' }, false), 'full graph mode must show untouched ordinary nodes');
assert(!nodeVisibleInPersonalMode({ id: 'ordinary-none', mastery: 'none' }, true), 'personal mode must hide untouched ordinary nodes');
assert(nodeVisibleInPersonalMode({ id: 'ordinary-touched', mastery: 'touched' }, true), 'personal mode must retain touched nodes');
assert(nodeVisibleInPersonalMode({ id: 'ordinary-mastered', mastery: 'mastered' }, true), 'personal mode must retain mastered nodes');
assert(nodeVisibleInPersonalMode({ id: 'n1', mastery: 'none' }, true), 'system core must remain visible in personal mode');

const sceneSource = readFileSync('src/ui/scene/KnowledgeScene.ts', 'utf8');
assert(sceneSource.includes('edgeMap[k].userData.edgeEndpoints=[p,n.id]'), 'premise/logic edges must retain endpoint identity for visibility filtering');
assert(sceneSource.includes('edgeMap[k].userData.edgeEndpoints=[n.id,t.id]'), 'twin edges must retain endpoint identity for visibility filtering');
assert(sceneSource.includes('visibleIds=new Set<string>()'), 'personal visibility must derive one canonical visible-node set');
assert(sceneSource.includes('edge.visible=edge.visible&&visibleIds.has(endpoints[0])&&visibleIds.has(endpoints[1])'), 'a rendered edge must require both endpoints to be visible');
assert(sceneSource.includes('setHideUntouched:e=>{hideUntouched=e;syncEdges(getNodes());applyVisibility();largeGraphDirty=true;}'), 'personal-mode toggles must restore real edge geometry before applying endpoint visibility');

const visibilityStart = sceneSource.indexOf('const applyVisibility=');
const syncStart = sceneSource.indexOf('const sync=');
assert(visibilityStart >= 0 && syncStart > visibilityStart, 'personal visibility implementation must remain discoverable');
const visibilitySource = sceneSource.slice(visibilityStart, syncStart);
assert(!visibilitySource.includes('homePos'), 'personal visibility must never alter fixed layout slots');
assert(!visibilitySource.includes('optimizeRelationLengthLayout'), 'personal visibility must never rerun relation-length optimization');

console.log('Personal node/edge visibility regression tests passed.');
