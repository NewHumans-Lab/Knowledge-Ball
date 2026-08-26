import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import {
  MOBILE_ACTIVE_NODE_ENTER_RANK,
  MOBILE_ACTIVE_NODE_EXIT_RANK,
  MOBILE_ACTIVE_NODE_TARGET,
  selectMobileActiveNodeIds,
} from './MobileSceneLod';

const appSource = readFileSync('src/ui/app.ts', 'utf8');
const sceneSource = readFileSync('src/ui/scene/KnowledgeScene.ts', 'utf8');
const layoutEntrySource = readFileSync('src/ui/scene/UniformLayerLayout.ts', 'utf8');
const radialSource = readFileSync('src/ui/scene/RadialKnowledgeLayout.ts', 'utf8');

assert(appSource.includes("import { applyUniformLayerLayout } from './scene/UniformLayerLayout';"), 'user app must use the single layout entry point');
const allNodesIndex = appSource.indexOf('layoutNodes = domainNodes.map');
const layoutCallIndex = appSource.indexOf('applyUniformLayerLayout(layoutNodes)');
const renderFilterIndex = appSource.indexOf('renderNodes = layoutNodes.filter');
assert(allNodesIndex >= 0, 'user app must build layout from every projected node');
assert(layoutCallIndex > allNodesIndex, 'radial layout must run after the full projected graph is materialized');
assert(renderFilterIndex > layoutCallIndex, 'hidden rendering filter must run only after full-graph layout');
assert(appSource.includes('function getSceneNodes(): KnowledgeSceneNode[] {\n  return renderNodes;\n}'), 'the live scene must receive the complete visible render-node set on mobile and desktop');
assert(!appSource.includes('mobileSceneNodeLimit'), 'mobile knowledge truth must not restore a fixed scene-node cap');

assert(layoutEntrySource.includes("import { applyRadialKnowledgeLayout } from './RadialKnowledgeLayout';"), 'the compatibility layout entry must delegate only to RadialKnowledgeLayout');
assert(layoutEntrySource.includes('return applyRadialKnowledgeLayout(nodes);'), 'the compatibility entry must not perform its own positioning');
assert(!layoutEntrySource.includes('RelationLengthLayout'), 'retired relation-length layout must not remain in the runtime entry');
assert(radialSource.includes('RADIAL_LAYOUT_LINK_LENGTH = RADIAL_LAYOUT_NODE_RADIUS * 5'), 'radial owner must preserve L=5r');
assert(radialSource.includes('positionsOnPerpendicularPlane'), 'radial owner must contain the perpendicular-plane expansion geometry');
assert(!radialSource.includes('optimizeRelationLengthLayout'), 'radial owner must not call the retired optimizer');

assert.equal(MOBILE_ACTIVE_NODE_TARGET, 49, 'mobile high-detail working set target must remain 49');
assert.equal(MOBILE_ACTIVE_NODE_ENTER_RANK, 45, 'new mobile nodes must enter only after moving clearly into the near set');
assert.equal(MOBILE_ACTIVE_NODE_EXIT_RANK, 55, 'existing mobile nodes must receive a wider exit band to prevent boundary flicker');
assert(MOBILE_ACTIVE_NODE_ENTER_RANK < MOBILE_ACTIVE_NODE_TARGET, 'entry rank must be stricter than the target boundary');
assert(MOBILE_ACTIVE_NODE_EXIT_RANK > MOBILE_ACTIVE_NODE_TARGET, 'exit rank must be wider than the target boundary');

const ranked = Array.from({ length: 80 }, (_, index) => ({ id: `n-${index}`, score: 1000 - index }));
const initial = selectMobileActiveNodeIds(ranked, new Set(), new Set(['n-70']));
assert.equal(initial.size, MOBILE_ACTIVE_NODE_TARGET, 'mobile LOD must cap the high-detail working set rather than knowledge truth');
assert(initial.has('n-70'), 'forced selected/related nodes must stay in the high-detail set even when distant');
const previous = new Set(Array.from({ length: MOBILE_ACTIVE_NODE_TARGET }, (_, index) => `n-${index}`));
const shifted = ranked.map((candidate, index) => ({ ...candidate, score: candidate.score + (index >= 45 && index < 55 ? 20 : 0) }));
const next = selectMobileActiveNodeIds(shifted, previous, new Set());
assert.equal(next.size, MOBILE_ACTIVE_NODE_TARGET, 'hysteresis must keep a bounded working set');

assert(sceneSource.includes('selectMobileActiveNodeIds'), 'scene must dynamically select its mobile high-detail working set');
assert(sceneSource.includes('largeGraphDirty = true;') && sceneSource.includes("mode === 'rotate'"), 'rotation must invalidate the mobile working set so near/far membership updates while rotating');
assert(sceneSource.includes('const nodeId = !moved && !pinchOccurred ? draggedNodeId : null;'), 'pointerup must reuse the pointerdown hit instead of rescanning the whole working set');
assert(sceneSource.includes('syncEdges(allNodes)'), 'relation lifecycle must follow the complete graph rather than the mobile high-detail working set');
assert(!sceneSource.includes('syncEdges(activeNodes)'), 'mobile LOD membership must not create, remove, or restore relations');
assert(!sceneSource.includes('edgesGroup.visible=false'), 'large mobile graphs must not globally hide all relations');
assert(sceneSource.includes('getActiveNodeCount'), 'runtime must expose active-node count for production-scale regression checks');

console.log('Radial layout ownership and dynamic mobile LOD wiring regression tests passed.');
