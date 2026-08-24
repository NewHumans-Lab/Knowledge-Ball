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

// Lexicographic layout contract: 72 first; conclusion-side direction second;
// soft colour radius after direction; no chain-length radial inflation.
assert(uniformSource.includes('export const ORDINARY_NODE_RADIUS = 7.2;'));
assert(uniformSource.includes('export const FCC_NEIGHBOR_DISTANCE = ORDINARY_NODE_DIAMETER * 5;'));
assert(uniformSource.includes('FCC_NEIGHBOR_STEPS'));
assert(uniformSource.includes('collectDirectLayoutEdges'));
assert(uniformSource.includes('exactAssignedNeighbourCount'));
assert(uniformSource.includes('endpointDownstreamScore'), 'chain must identify conclusion side');
assert(uniformSource.includes('orientSpine'), 'chain must be scheduled conclusion-first');
assert(uniformSource.includes('minimumConclusionRadius'), 'connected conclusion may reserve one inward x step');
assert(!uniformSource.includes('mainSpineRadialBudget'), 'whole-chain radial expansion must stay absent');
assert(uniformSource.includes('directedRadialScore'), 'premise-side candidates must prefer inward progress');
assert(uniformSource.includes('LAYER_TARGET_RADIUS'));
assert(uniformSource.includes('inner: FCC_NEIGHBOR_DISTANCE'));
assert(uniformSource.includes('middle: FCC_NEIGHBOR_DISTANCE * 2'));
assert(uniformSource.includes('outer: FCC_NEIGHBOR_DISTANCE * 3'));
assert(uniformSource.includes('gapScore'));
assert(uniformSource.includes('approximateDiameterPath'));
assert(uniformSource.includes('Only after every legal exact-x neighbour is unavailable may a direct edge grow longer.'));
assert(!uniformSource.includes('endpointUpstreamScore'));
assert(!uniformSource.includes('ordinarySlotCache'));
assert(!uniformSource.includes('reasoningPerpendicular'));
assert(!uniformSource.includes('reasoningDominant'));
assert(!uniformSource.includes('reasoningSide'));
assert(!uniformSource.includes('LAYER_BANDS'));
assert(!uniformSource.includes('optimizeRelationLengthLayout'));
assert(!uniformSource.includes('Fibonacci'));

console.log('User-page five-diameter + bounded conclusion-first direction + soft-layer wiring regression tests passed.');
