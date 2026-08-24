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
assert(allNodesIndex >= 0, 'user app must build layout from every projected node');
assert(layoutCallIndex > allNodesIndex, 'layout must run after the full projected graph is materialized');
assert(renderFilterIndex > layoutCallIndex, 'visibility filtering must stay downstream from geometry');
assert(appSource.includes('function getSceneNodes(): KnowledgeSceneNode[] {\n  return renderNodes;\n}'), 'scene must receive the complete visible render-node set');
assert(!appSource.includes('mobileSceneNodeLimit'), 'mobile knowledge truth must not restore a fixed scene-node cap');

assert.equal(MOBILE_ACTIVE_NODE_TARGET, 49, 'mobile high-detail working set target must remain 49');
assert.equal(MOBILE_ACTIVE_NODE_ENTER_RANK, 45, 'new mobile nodes must enter only after moving clearly into the near set');
assert.equal(MOBILE_ACTIVE_NODE_EXIT_RANK, 55, 'existing mobile nodes must receive a wider exit band');
assert(MOBILE_ACTIVE_NODE_ENTER_RANK < MOBILE_ACTIVE_NODE_TARGET, 'entry rank must be stricter than target');
assert(MOBILE_ACTIVE_NODE_EXIT_RANK > MOBILE_ACTIVE_NODE_TARGET, 'exit rank must be wider than target');

const ranked = Array.from({ length: 80 }, (_, index) => ({ id: `n-${index}`, score: 1000 - index }));
const initial = selectMobileActiveNodeIds(ranked, new Set(), new Set(['n-70']));
assert.equal(initial.size, MOBILE_ACTIVE_NODE_TARGET, 'mobile LOD must cap only the high-detail set');
assert(initial.has('n-70'), 'forced selected/related nodes must stay materialized');
const previous = new Set(Array.from({ length: MOBILE_ACTIVE_NODE_TARGET }, (_, index) => `n-${index}`));
const shifted = ranked.map((candidate, index) => ({ ...candidate, score: candidate.score + (index >= 45 && index < 55 ? 20 : 0) }));
const next = selectMobileActiveNodeIds(shifted, previous, new Set());
assert.equal(next.size, MOBILE_ACTIVE_NODE_TARGET, 'hysteresis must keep a bounded working set');

assert(sceneSource.includes('selectMobileActiveNodeIds'), 'scene must dynamically select its mobile high-detail working set');
assert(sceneSource.includes('largeGraphDirty = true;') && sceneSource.includes("mode === 'rotate'"), 'rotation must not mutate layout coordinates');
assert(sceneSource.includes('const nodeId = !moved && !pinchOccurred ? draggedNodeId : null;'), 'pointerup must reuse the pointerdown hit');
assert(sceneSource.includes('syncEdges(allNodes)'), 'relation lifecycle must follow the complete graph');
assert(!sceneSource.includes('syncEdges(activeNodes)'), 'mobile LOD must not own relation lifecycle');
assert(!sceneSource.includes('edgesGroup.visible=false'), 'large mobile graphs must not globally hide relations');
assert(sceneSource.includes('getActiveNodeCount'), 'runtime must expose active-node count for production-scale checks');
assert(sceneSource.includes('let graphZoom = 1;'), 'initial graph scale must remain neutral');
assert(!sceneSource.includes('let graphZoom = 1.27;'), 'the old 1.27 initial enlargement must not return');
assert(!sceneSource.includes('if (Math.hypot(sx - x, sy - y) <= 24) return focusedNodeId;'), 'focused mobile node must not steal a tap from a nearer projected neighbour');
assert(sceneSource.includes("if (typeof id === 'string' && distance <= 24 && (!nearest || distance < nearest.distance))"), 'mobile taps must resolve by the nearest visible projected ball');
assert(!sceneSource.includes('detailReasoningPresentationPositions'), 'detail-only reasoning displacement must stay removed');
assert(!sceneSource.includes('detailDisplayPositions'), 'rendered node positions must come directly from authoritative scene coordinates');

// Layout priority is lexicographic, not a blended force simulation:
// exact x first, conclusion-side anchoring/directed radial order second, colour layer after that.
assert(uniformSource.includes('export const ORDINARY_NODE_RADIUS = 7.2;'), 'live layout must state the ordinary-ball radius');
assert(uniformSource.includes('export const FCC_NEIGHBOR_DISTANCE = ORDINARY_NODE_DIAMETER * 5;'), 'first constraint must remain five ordinary-ball diameters');
assert(uniformSource.includes('FCC_NEIGHBOR_STEPS'), 'live layout must retain the twelve FCC nearest-neighbour slots');
assert(uniformSource.includes('collectDirectLayoutEdges'), 'only direct real graph edges may drive adjacency');
assert(uniformSource.includes('exactAssignedNeighbourCount'), 'candidate choice must first preserve as many exact-x real relations as possible');
assert(uniformSource.includes('endpointDownstreamScore'), 'chain orientation must identify the conclusion side');
assert(uniformSource.includes('orientSpine'), 'long chains must be scheduled conclusion-first');
assert(uniformSource.includes('mainSpineRadialBudget'), 'the conclusion anchor must reserve enough radial room to walk back toward premises');
assert(uniformSource.includes('directedRadialScore'), 'second constraint must keep semantic source inward and target outward');
assert(uniformSource.includes('LAYER_TARGET_RADIUS'), 'inner/middle/outer must have soft radial targets');
assert(uniformSource.includes('inner: FCC_NEIGHBOR_DISTANCE'), 'inner target must remain 1x');
assert(uniformSource.includes('middle: FCC_NEIGHBOR_DISTANCE * 2'), 'middle target must remain 2x');
assert(uniformSource.includes('outer: FCC_NEIGHBOR_DISTANCE * 3'), 'outer target must remain 3x');
assert(uniformSource.includes('gapScore'), 'branches must retain geometric gap filling after higher-priority rules');
assert(uniformSource.includes('approximateDiameterPath'), 'one cheap main spine may preserve long-chain straightness');
assert(uniformSource.includes('Only after every legal exact-x neighbour is unavailable may a direct edge grow longer.'), 'greater-than-x placement must remain fallback only');
assert(!uniformSource.includes('Start a long spine at its middle and grow toward both ends.'), 'centre-out chain reversal must stay removed');
assert(!uniformSource.includes('endpointUpstreamScore'), 'premise-first chain anchoring must stay removed');
assert(!uniformSource.includes('ordinarySlotCache'), 'session slot-cache policy must stay absent');
assert(!uniformSource.includes('reasoningPerpendicular'), 'reasoning-specific offsets must stay absent');
assert(!uniformSource.includes('reasoningDominant'), 'reasoning dominance must not influence coordinates');
assert(!uniformSource.includes('reasoningSide'), 'reasoning camp must not influence coordinates');
assert(!uniformSource.includes('LAYER_BANDS'), 'soft targets must not become old hard radial shells');
assert(!uniformSource.includes('optimizeRelationLengthLayout'), 'old relation optimizer must stay out of the live path');
assert(!uniformSource.includes('Fibonacci'), 'old Fibonacci distribution must stay absent');

console.log('User-page five-diameter + conclusion-first outward-chain + soft-layer wiring regression tests passed.');
