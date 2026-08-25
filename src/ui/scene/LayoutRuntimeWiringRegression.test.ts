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

// Layout remains a pure projection upstream from scene visibility/interaction.
assert(sceneSource.includes('selectMobileActiveNodeIds'));
assert(sceneSource.includes('largeGraphDirty = true;') && sceneSource.includes("mode === 'rotate'"), 'rotation must not mutate layout coordinates');
assert(sceneSource.includes('const nodeId = !moved && !pinchOccurred ? draggedNodeId : null;'));
assert(sceneSource.includes('syncEdges(allNodes)'));
assert(!sceneSource.includes('syncEdges(activeNodes)'));
assert(!sceneSource.includes('edgesGroup.visible=false'));
assert(sceneSource.includes('getActiveNodeCount'));
assert(sceneSource.includes('let graphZoom = 1;'));
assert(!sceneSource.includes('let graphZoom = 1.27;'));
assert(sceneSource.includes("if (typeof id === 'string' && distance <= 24 && (!nearest || distance < nearest.distance))"), 'layout work must not rewrite mobile hit-test ownership');
assert(!sceneSource.includes('detailReasoningPresentationPositions'));
assert(!sceneSource.includes('detailDisplayPositions'));

// Spatial constants and semantic graph ownership stay stable.
assert(uniformSource.includes('export const ORDINARY_NODE_RADIUS = 7.2;'));
assert(uniformSource.includes('export const FCC_NEIGHBOR_DISTANCE = ORDINARY_NODE_DIAMETER * 5;'));
assert(uniformSource.includes('export const INITIAL_LAYOUT_RADIUS = FCC_NEIGHBOR_DISTANCE * 3;'));
assert(uniformSource.includes('export const LAYOUT_RADIUS_INCREMENT = FCC_NEIGHBOR_DISTANCE * 3;'));
assert(uniformSource.includes('collectDirectLayoutEdges'));
assert(uniformSource.includes('components.sort((a, b) => b.length - a.length'), 'larger components must be shaped/packed first');
assert(uniformSource.includes('chooseConclusionAnchor'), 'component orientation starts from the conclusion/outer side');
assert(uniformSource.includes('conclusionFirstSpine'), 'main semantic spine must remain conclusion -> premise');
assert(uniformSource.includes('directed.incomingIds.get(id)'), 'main spine must only walk incoming semantic edges toward premises');
assert(uniformSource.includes("if (layer === 'outer') return sphereRadius;"), 'purple root target remains the current outer surface');

// Architecture boundary 1: local topology is solved without knowing global capacity.
const localStart = uniformSource.indexOf('function buildLocalComponentGeometry(');
const localEnd = uniformSource.indexOf('function buildLocalComponentVariants(', localStart);
assert(localStart >= 0 && localEnd > localStart, 'local component geometry phase must remain explicit');
const localSource = uniformSource.slice(localStart, localEnd);
assert(!localSource.includes('sphereRadius'), 'local chain shaping must not know the sphere radius');
assert(!localSource.includes('globalPositions'), 'local chain shaping must not inspect other components');
assert(!localSource.includes('expandSphere'), 'local self-collision must never request world expansion');
assert(uniformSource.includes('buildLocalComponentGeometry(plan, adjacency, directed, byId, mode, false)'), 'exact local geometry must be attempted before any relation relaxation');
assert(uniformSource.includes('if (exact.length > 0) return exact;'), 'a legal exact-72 local shape must prohibit relaxed alternatives');
assert(uniformSource.includes('buildLocalComponentGeometry(plan, adjacency, directed, byId, mode, true)'), 'only locally impossible exact geometry may use >72 fallback');

// Architecture boundary 2: global packing owns occupancy and capacity.
assert(uniformSource.includes('function liveOccupiedDirections('), 'global packer must expose live occupancy extraction');
assert(uniformSource.includes('for (const position of positions.values())'), 'live gaps must be derived from every already-placed node position, not only component anchors');
assert(uniformSource.includes('function refineGapDirection('), 'largest-gap candidates must be continuously refined from current occupancy');
assert(uniformSource.includes('function liveGapDirections('), 'global packer must rank current empty directions');
assert(uniformSource.includes('function findBestComponentPlacement('), 'rigid component packing must be a distinct phase');
assert(!uniformSource.includes('ANCHOR_DIRECTION_SEQUENCE'), 'global packing must not regress to one static anchor sequence');
assert(!uniformSource.includes('orderedAnchorDirections'), 'anchor-only gap ranking must stay removed');
assert(!uniformSource.includes('requiredSphereRadiusForSpine'), 'local chain depth must never pre-expand the world');
assert(!uniformSource.includes('RELAXED_EDGE_EXPANSION_THRESHOLD'), 'relation relaxation must not depend on repeated global expansion attempts');

// Architecture boundary 3: expansion is only the fallback of failed rigid packing and respects layer radius deltas.
const graphStart = uniformSource.indexOf('function placeGraphNodes(');
const applyStart = uniformSource.indexOf('export function applyUniformLayerLayout', graphStart);
assert(graphStart >= 0 && applyStart > graphStart, 'global graph packing phase must remain explicit');
const graphSource = uniformSource.slice(graphStart, applyStart);
const placementIndex = graphSource.indexOf('findBestComponentPlacement(');
const expansionIndex = graphSource.indexOf('sphereRadius = expandSphere(');
assert(placementIndex >= 0 && expansionIndex > placementIndex, 'world expansion may occur only after rigid packing fails');
assert(uniformSource.includes('layerRadiusForSphere(rootNode, nextRadius) - layerRadiusForSphere(rootNode, sphereRadius)'), 'expansion distance must follow each component root layer, not blindly add +216 to every chain');
assert(uniformSource.includes('for (const id of component.ids) positions.get(id)?.add(delta);'), 'expansion must translate each component as one rigid body');

assert(!uniformSource.includes('ordinarySlotCache'));
assert(!uniformSource.includes('reasoningPerpendicular'));
assert(!uniformSource.includes('reasoningDominant'));
assert(!uniformSource.includes('reasoningSide'));
assert(!uniformSource.includes('optimizeRelationLengthLayout'));
assert(!uniformSource.includes('Fibonacci'));

console.log('User-page two-phase local-geometry/global-packing architecture regression tests passed.');
