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
const uniformSource = readFileSync('src/ui/scene/UniformLayerLayout.ts', 'utf8');

assert(appSource.includes("import { applyUniformLayerLayout } from './scene/UniformLayerLayout';"), 'user app must retain the single layout entry point');
const allNodesIndex = appSource.indexOf('layoutNodes = domainNodes.map');
const layoutCallIndex = appSource.indexOf('applyUniformLayerLayout(layoutNodes)');
const renderFilterIndex = appSource.indexOf('renderNodes = layoutNodes.filter');
assert(allNodesIndex >= 0 && layoutCallIndex > allNodesIndex && renderFilterIndex > layoutCallIndex, 'visibility must remain downstream from full-graph layout');
assert(appSource.includes('function getSceneNodes(): KnowledgeSceneNode[] {\n  return renderNodes;\n}'));
assert(!appSource.includes('mobileSceneNodeLimit'));

assert.equal(MOBILE_ACTIVE_NODE_TARGET, 49);
assert.equal(MOBILE_ACTIVE_NODE_ENTER_RANK, 45);
assert.equal(MOBILE_ACTIVE_NODE_EXIT_RANK, 55);
const ranked = Array.from({ length: 80 }, (_, index) => ({ id: `n-${index}`, score: 1000 - index }));
const initial = selectMobileActiveNodeIds(ranked, new Set(), new Set(['n-70']));
assert.equal(initial.size, MOBILE_ACTIVE_NODE_TARGET);
assert(initial.has('n-70'));

assert(sceneSource.includes('selectMobileActiveNodeIds'));
assert(sceneSource.includes('largeGraphDirty = true;') && sceneSource.includes("mode === 'rotate'"), 'rotation must not mutate layout coordinates');
assert(sceneSource.includes('const nodeId = !moved && !pinchOccurred ? draggedNodeId : null;'));
assert(sceneSource.includes('syncEdges(allNodes)'));
assert(!sceneSource.includes('syncEdges(activeNodes)'));
assert(!sceneSource.includes('edgesGroup.visible=false'));
assert(sceneSource.includes('getActiveNodeCount'));
assert(sceneSource.includes('let graphZoom = 1;'));
assert(!sceneSource.includes('let graphZoom = 1.27;'));
assert(sceneSource.includes("if (typeof id === 'string' && distance <= 24 && (!nearest || distance < nearest.distance))"));
assert(!sceneSource.includes('detailReasoningPresentationPositions'));
assert(!sceneSource.includes('detailDisplayPositions'));

assert(uniformSource.includes('export const ORDINARY_NODE_RADIUS = 7.2;'));
assert(uniformSource.includes('export const FCC_NEIGHBOR_DISTANCE = ORDINARY_NODE_DIAMETER * 5;'));
assert(uniformSource.includes('export const INITIAL_LAYOUT_RADIUS = FCC_NEIGHBOR_DISTANCE * 3;'));
assert(uniformSource.includes('export const LAYOUT_RADIUS_INCREMENT = FCC_NEIGHBOR_DISTANCE * 3;'));
assert(uniformSource.includes('collectDirectLayoutEdges'));
assert(uniformSource.includes('components.sort((a, b) => b.length - a.length'), 'larger chains must enter the sphere first');
assert(uniformSource.includes('chooseConclusionAnchor'), 'a chain must be anchored from its outer/conclusion side');
assert(uniformSource.includes('conclusionFirstSpine'), 'main chain must be laid conclusion -> premise');
assert(uniformSource.includes('directed.incomingIds.get(id)'), 'main spine must only walk semantic edges inward toward premises');
assert(uniformSource.includes("if (layer === 'outer') return sphereRadius;"), 'purple root must sit on the current outer surface');
assert(uniformSource.includes('BASE_ANCHOR_DIRECTIONS'), 'front/back/up/down/left/right must remain first insertion directions');
assert(uniformSource.includes('orderedAnchorDirections'), 'every new component must recompute the current insertion order');
assert(uniformSource.includes('angularGapScore(b, used) - angularGapScore(a, used)'), 'live placement must rank current largest angular gaps');
assert(!uniformSource.includes('requiredSphereRadiusForSpine'), 'layer depth must never pre-expand R before current gaps are tried');
assert(uniformSource.includes('if (!candidate && allowLongEdges) candidate = chooseLongCandidate'), 'blocked straight inward steps must try other exact-72 directions before relaxation');
assert(uniformSource.includes('expandSphere'), 'real capacity failure must use rigid expansion');
assert(uniformSource.includes('for (const id of component.ids) positions.get(id)?.add(delta);'), 'real sphere growth must translate each existing chain as one rigid body');
assert(uniformSource.includes('parentDegree > 12'), 'geometrically impossible local crowding may relax the 72 edge');
assert(!uniformSource.includes('ordinarySlotCache'));
assert(!uniformSource.includes('reasoningPerpendicular'));
assert(!uniformSource.includes('reasoningDominant'));
assert(!uniformSource.includes('reasoningSide'));
assert(!uniformSource.includes('optimizeRelationLengthLayout'));
assert(!uniformSource.includes('Fibonacci'));

console.log('User-page five-diameter live-gap chain-capacity wiring regression tests passed.');
