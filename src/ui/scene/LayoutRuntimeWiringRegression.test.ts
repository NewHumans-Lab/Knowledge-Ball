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
assert(!sceneSource.includes('detailReasoningPresentationPositions'), 'detail-only reasoning displacement must be removed');
assert(!sceneSource.includes('detailDisplayPositions'), 'rendered node positions must come directly from authoritative scene coordinates');

assert(uniformSource.includes('export const ORDINARY_NODE_RADIUS = 7.2;'), 'live layout must state the ordinary-ball radius');
assert(uniformSource.includes('export const FCC_NEIGHBOR_DISTANCE = ORDINARY_NODE_DIAMETER * 5;'), 'live spacing must equal five ordinary-ball diameters');
assert(uniformSource.includes('collectDirectLayoutEdges'), 'only direct real graph edges may drive adjacency');
assert(uniformSource.includes('FCC_NEIGHBOR_STEPS'), 'live layout must use the twelve FCC nearest-neighbour slots');
assert(uniformSource.includes('gapScore'), 'branches must fill the largest local geometric gap');
assert(uniformSource.includes('approximateDiameterPath'), 'one cheap main spine may preserve straight long chains');
assert(uniformSource.includes('Only after every exact-x neighbour is occupied may a direct edge grow longer.'), 'greater-than-x placement must remain fallback only');
assert(!uniformSource.includes('ordinarySlotCache'), 'session slot-cache policy must be absent from the simple layout');
assert(!uniformSource.includes('LAYER_RANK'), 'layer direction bias must be absent');
assert(!uniformSource.includes('layerDelta'), 'layer direction scoring must be absent');
assert(!uniformSource.includes('reasoningPerpendicular'), 'reasoning-specific offsets must be absent');
assert(!uniformSource.includes('reasoningDominant'), 'reasoning dominance must not influence coordinates');
assert(!uniformSource.includes('reasoningSide'), 'reasoning camp must not influence coordinates');
assert(!uniformSource.includes('LAYER_BANDS'), 'hard radial layer boundaries must stay absent');
assert(!uniformSource.includes('optimizeRelationLengthLayout'), 'old relation optimizer must stay out of the live path');
assert(!uniformSource.includes('Fibonacci'), 'old Fibonacci shell distribution must stay absent');

console.log('User-page simple five-diameter FCC layout and mobile wiring regression tests passed.');
