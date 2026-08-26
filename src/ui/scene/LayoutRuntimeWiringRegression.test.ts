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
const localOptimizerSource = readFileSync('src/ui/scene/LocalChainLengthOptimizer.ts', 'utf8');

assert(appSource.includes("import { applyUniformLayerLayout } from './scene/UniformLayerLayout';"), 'user app must use the single layout entry point');
const allNodesIndex = appSource.indexOf('layoutNodes = domainNodes.map');
const layoutCallIndex = appSource.indexOf('applyUniformLayerLayout(layoutNodes)');
const renderFilterIndex = appSource.indexOf('renderNodes = layoutNodes.filter');
assert(allNodesIndex >= 0, 'user app must build layout from every projected node');
assert(layoutCallIndex > allNodesIndex, 'radial layout must run after the full projected graph is materialized');
assert(renderFilterIndex > layoutCallIndex, 'hidden rendering filter must run only after full-graph layout');
assert(!appSource.includes('mobileSceneNodeLimit'), 'mobile knowledge truth must not restore a fixed scene-node cap');

assert(layoutEntrySource.includes("import { applyRadialKnowledgeLayout } from './RadialKnowledgeLayout';"), 'the compatibility layout entry must preserve RadialKnowledgeLayout as the first geometry stage');
assert(layoutEntrySource.includes("import { applyLocalChainLengthOptimization } from './LocalChainLengthOptimizer';"), 'the single layout entry must add only the bounded local line minimizer');
const radialCallIndex = layoutEntrySource.indexOf('applyRadialKnowledgeLayout(nodes);');
const localCallIndex = layoutEntrySource.indexOf('applyLocalChainLengthOptimization(nodes)');
assert(radialCallIndex >= 0 && localCallIndex > radialCallIndex, 'local line minimization must run only after canonical radial planes are established');
assert(!layoutEntrySource.includes('compressReasoningForPhaseOne'), 'layout entry must not mutate reasoning visibility or relation truth');
assert(!layoutEntrySource.includes('RelationLengthLayout'), 'retired relation-length layout must not return to the runtime entry');
assert(radialSource.includes('RADIAL_LAYOUT_LINK_LENGTH = RADIAL_LAYOUT_NODE_RADIUS * 5'), 'radial owner must preserve L=5R');
assert(radialSource.includes('RADIAL_LAYOUT_PLANE_EDGE_LENGTH = RADIAL_LAYOUT_LINK_LENGTH'), 'same-layer initial triangular edge must equal 5R');
assert(radialSource.includes('compactTriangularPlaneOffsets'), 'radial owner must retain deterministic triangular initial geometry');
assert(radialSource.includes('buildCompressedKnowledgeGraph'), 'reasoning must remain compressed out of the primary knowledge-position solve');
assert(radialSource.includes('placeReasoningAtRelationCenters'), 'reasoning balls must still be inserted after knowledge positions are solved');
assert(radialSource.includes('premiseCenter.add(conclusionCenter).multiplyScalar(0.5)'), 'reasoning position must remain the midpoint of equal-weight premise and conclusion centres');
assert(!radialSource.includes('optimizeRelationLengthLayout'), 'retired global relation optimizer must not return');

assert(localOptimizerSource.includes('LOCAL_CHAIN_OPTIMIZATION_HOPS = 2'), 'large-chain optimization must be bounded by graph hops');
assert(localOptimizerSource.includes('LOCAL_CHAIN_OPTIMIZATION_MAX_NODES = 96'), 'one local solve must have a hard node cap');
assert(localOptimizerSource.includes('PlaneSpatialHash'), 'same-plane 5R enforcement must use local spatial hashing rather than all-pairs scans');
assert(localOptimizerSource.includes('component.length <= LOCAL_CHAIN_OPTIMIZATION_MAX_NODES'), 'small chains may minimize the whole chain while giant connected graphs must not');
assert(localOptimizerSource.includes("(incoming.get(id)?.size ?? 0) > 1 || (outgoing.get(id)?.size ?? 0) > 1"), 'large connected graphs must optimize only around fan-in/fan-out junctions');
assert(localOptimizerSource.includes('RADIAL_LAYOUT_MIN_PLANE_SPACING'), 'the local minimizer must preserve the existing 5R same-plane hard spacing');
assert(localOptimizerSource.includes('finalTotal <= baseline'), 'a local solve must be rejected when it fails to shorten or preserve total relation length');
assert(localOptimizerSource.includes('indexEdgesByNode'), 'giant-chain edges must be indexed once instead of rescanned for every local window');
assert(localOptimizerSource.includes('edgesForRegion(region, edgeIndex)'), 'each bounded solve must consume only its incident edge set');
assert(!localOptimizerSource.includes('edges.filter(edge => movable.has'), 'bounded windows must not filter the full component edge list on every solve');
assert(localOptimizerSource.includes('repositionReasoning(nodes);'), 'reasoning midpoint positions must be refreshed after knowledge nodes move');

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

console.log('Radial 5R layout plus bounded local chain minimization wiring checks passed.');
