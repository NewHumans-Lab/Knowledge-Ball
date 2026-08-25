import * as THREE from 'three';
import type { KnowledgeLayer } from '../../domain/KnowledgeLayerPolicy';
import { isSystemCoreNodeId } from '../../domain/KnowledgeLayerPolicy';
import {
  CORE_SUN_RADIUS,
  SUN_ORBIT_RADIUS,
  SUN_TRIAD_IDS,
} from '../config/KnowledgeUiConfig';

export interface UniformLayoutNode {
  id: string;
  effectiveLayer?: KnowledgeLayer;
  layer?: KnowledgeLayer;
  type?: string;
  premises?: string[];
  pos?: THREE.Vector3;
  vel?: THREE.Vector3;
  homePos?: THREE.Vector3;
  hidden?: boolean;
}

export type FccCoord = [number, number, number];
type UserLayoutLayer = Exclude<KnowledgeLayer, 'core'>;
type GeometryMode = 'inward' | 'compact';

export const ORDINARY_NODE_RADIUS = 7.2;
export const ORDINARY_NODE_DIAMETER = ORDINARY_NODE_RADIUS * 2;
/** First constraint. Never relax this while a legal exact local placement exists. */
export const FCC_NEIGHBOR_DISTANCE = ORDINARY_NODE_DIAMETER * 5;
const FCC_SCALE = FCC_NEIGHBOR_DISTANCE / Math.SQRT2;
export const CORE_LAYOUT_CLEARANCE_RADIUS = CORE_SUN_RADIUS + ORDINARY_NODE_RADIUS;
export const INITIAL_LAYOUT_RADIUS = FCC_NEIGHBOR_DISTANCE * 3;
export const LAYOUT_RADIUS_INCREMENT = FCC_NEIGHBOR_DISTANCE * 3;
const POSITION_EPSILON = 1e-7;
const MAX_LAYOUT_EXPANSIONS = 32;
const GAP_SEED_COUNT = 192;
const GAP_DIRECTION_LIMIT = 96;
const GAP_REFINEMENT_SEEDS = 24;
const OCCUPANCY_DIRECTION_LIMIT = 192;

export const LAYER_TARGET_RADIUS: Readonly<Record<UserLayoutLayer, number>> = Object.freeze({
  inner: FCC_NEIGHBOR_DISTANCE,
  middle: FCC_NEIGHBOR_DISTANCE * 2,
  outer: FCC_NEIGHBOR_DISTANCE * 3,
});

const LAYER_RANK: Readonly<Record<UserLayoutLayer, number>> = Object.freeze({ inner: 0, middle: 1, outer: 2 });

/** Reference one-x FCC neighbour set retained as the canonical 72-unit geometry. */
export const FCC_NEIGHBOR_STEPS: readonly FccCoord[] = Object.freeze([
  [1, 1, 0], [1, -1, 0], [-1, 1, 0], [-1, -1, 0],
  [1, 0, 1], [1, 0, -1], [-1, 0, 1], [-1, 0, -1],
  [0, 1, 1], [0, 1, -1], [0, -1, 1], [0, -1, -1],
] as FccCoord[]);

const BASE_ANCHOR_DIRECTIONS = Object.freeze([
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, 0, -1),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(-1, 0, 0),
]);
const LOCAL_OUTWARD_AXIS = new THREE.Vector3(0, 0, 1);

function layerOf(node: UniformLayoutNode): KnowledgeLayer {
  const layer = node.effectiveLayer ?? node.layer ?? (isSystemCoreNodeId(node.id) ? 'core' : undefined);
  if (!layer) throw new Error(`Missing effective layer for layout node ${node.id}`);
  return layer;
}

function userLayerOf(node: UniformLayoutNode): UserLayoutLayer {
  const layer = layerOf(node);
  if (layer === 'core') throw new Error(`Core node ${node.id} does not use user-layer placement`);
  return layer;
}

function isLayoutNode(node: UniformLayoutNode): boolean { return layerOf(node) !== 'core'; }

export function fccPositionForCoord(coord: FccCoord): THREE.Vector3 {
  return new THREE.Vector3(coord[0] * FCC_SCALE, coord[1] * FCC_SCALE, coord[2] * FCC_SCALE);
}

function coreSlot(id: string): THREE.Vector3 {
  const index = Math.max(0, SUN_TRIAD_IDS.indexOf(id as (typeof SUN_TRIAD_IDS)[number]));
  const angle = index * Math.PI * 2 / SUN_TRIAD_IDS.length;
  return new THREE.Vector3(Math.cos(angle) * SUN_ORBIT_RADIUS, Math.sin(angle) * SUN_ORBIT_RADIUS, 0);
}

export interface FccLayoutEdge { fromId: string; toId: string; }

/** Reasoning remains a real node: premise -> reasoning -> conclusion is two direct edges. */
export function collectDirectLayoutEdges(nodes: readonly UniformLayoutNode[]): FccLayoutEdge[] {
  const byId = new Map(nodes.map(node => [node.id, node] as const));
  const seen = new Set<string>();
  const edges: FccLayoutEdge[] = [];
  for (const target of nodes) {
    if (!isLayoutNode(target)) continue;
    for (const sourceId of target.premises ?? []) {
      const source = byId.get(sourceId);
      if (!source || !isLayoutNode(source) || source.id === target.id) continue;
      const key = `${source.id}->${target.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ fromId: source.id, toId: target.id });
    }
  }
  return edges;
}

function buildAdjacency(nodes: readonly UniformLayoutNode[], edges: readonly FccLayoutEdge[]): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) if (isLayoutNode(node)) adjacency.set(node.id, []);
  for (const edge of edges) {
    adjacency.get(edge.fromId)?.push(edge.toId);
    adjacency.get(edge.toId)?.push(edge.fromId);
  }
  for (const neighbours of adjacency.values()) neighbours.sort();
  return adjacency;
}

type DirectedIndex = {
  edgeKeys: Set<string>;
  incomingCount: Map<string, number>;
  outgoingCount: Map<string, number>;
  incomingIds: Map<string, string[]>;
  outgoingIds: Map<string, string[]>;
};

function buildDirectedIndex(nodes: readonly UniformLayoutNode[], edges: readonly FccLayoutEdge[]): DirectedIndex {
  const edgeKeys = new Set<string>();
  const incomingCount = new Map<string, number>();
  const outgoingCount = new Map<string, number>();
  const incomingIds = new Map<string, string[]>();
  const outgoingIds = new Map<string, string[]>();
  for (const node of nodes) {
    if (!isLayoutNode(node)) continue;
    incomingCount.set(node.id, 0);
    outgoingCount.set(node.id, 0);
    incomingIds.set(node.id, []);
    outgoingIds.set(node.id, []);
  }
  for (const edge of edges) {
    edgeKeys.add(`${edge.fromId}->${edge.toId}`);
    incomingCount.set(edge.toId, (incomingCount.get(edge.toId) ?? 0) + 1);
    outgoingCount.set(edge.fromId, (outgoingCount.get(edge.fromId) ?? 0) + 1);
    incomingIds.get(edge.toId)?.push(edge.fromId);
    outgoingIds.get(edge.fromId)?.push(edge.toId);
  }
  for (const ids of incomingIds.values()) ids.sort();
  for (const ids of outgoingIds.values()) ids.sort();
  return { edgeKeys, incomingCount, outgoingCount, incomingIds, outgoingIds };
}

function directedRelation(parentId: string, childId: string, directed: DirectedIndex): -1 | 0 | 1 {
  const forward = directed.edgeKeys.has(`${parentId}->${childId}`);
  const reverse = directed.edgeKeys.has(`${childId}->${parentId}`);
  if (forward === reverse) return 0;
  return forward ? 1 : -1;
}

function connectedComponents(adjacency: ReadonlyMap<string, string[]>): string[][] {
  const visited = new Set<string>();
  const components: string[][] = [];
  for (const seed of [...adjacency.keys()].sort()) {
    if (visited.has(seed)) continue;
    const component: string[] = [];
    const queue = [seed];
    visited.add(seed);
    for (let head = 0; head < queue.length; head++) {
      const id = queue[head];
      component.push(id);
      for (const neighbourId of adjacency.get(id) ?? []) {
        if (visited.has(neighbourId)) continue;
        visited.add(neighbourId);
        queue.push(neighbourId);
      }
    }
    components.push(component);
  }
  components.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
  return components;
}

function endpointDownstreamScore(id: string, directed: DirectedIndex): number {
  return (directed.incomingCount.get(id) ?? 0) - (directed.outgoingCount.get(id) ?? 0);
}

/** Purple wins the outer anchor; within a layer, the more conclusion-like node wins. */
function chooseConclusionAnchor(component: readonly string[], byId: ReadonlyMap<string, UniformLayoutNode>, directed: DirectedIndex): string {
  return [...component].sort((a, b) => {
    const aNode = byId.get(a)!;
    const bNode = byId.get(b)!;
    const layerDelta = LAYER_RANK[userLayerOf(bNode)] - LAYER_RANK[userLayerOf(aNode)];
    if (layerDelta !== 0) return layerDelta;
    const directionDelta = endpointDownstreamScore(b, directed) - endpointDownstreamScore(a, directed);
    if (directionDelta !== 0) return directionDelta;
    return a.localeCompare(b);
  })[0];
}

/** Walk only incoming semantic edges from the chosen conclusion toward premises. */
function conclusionFirstSpine(anchorId: string, component: readonly string[], directed: DirectedIndex): string[] {
  const allowed = new Set(component);
  const parent = new Map<string, string | null>([[anchorId, null]]);
  const distance = new Map<string, number>([[anchorId, 0]]);
  const queue = [anchorId];
  let farthest = anchorId;
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
    const nextDistance = (distance.get(id) ?? 0) + 1;
    for (const premiseId of directed.incomingIds.get(id) ?? []) {
      if (!allowed.has(premiseId) || distance.has(premiseId)) continue;
      parent.set(premiseId, id);
      distance.set(premiseId, nextDistance);
      queue.push(premiseId);
      if (nextDistance > (distance.get(farthest) ?? 0)) farthest = premiseId;
    }
  }
  const reversed: string[] = [];
  let cursor: string | null | undefined = farthest;
  while (cursor) {
    reversed.push(cursor);
    if (cursor === anchorId) break;
    cursor = parent.get(cursor);
  }
  return reversed.reverse();
}

type ComponentSchedule = { order: string[]; parentById: Map<string, string> };

function scheduleComponent(
  component: readonly string[],
  spine: readonly string[],
  adjacency: ReadonlyMap<string, string[]>,
  directed: DirectedIndex,
  byId: ReadonlyMap<string, UniformLayoutNode>,
): ComponentSchedule {
  const allowed = new Set(component);
  const scheduled = new Set<string>();
  const parentById = new Map<string, string>();
  const order: string[] = [];
  const queue: string[] = [];
  for (let index = 0; index < spine.length; index++) {
    const id = spine[index];
    scheduled.add(id);
    order.push(id);
    queue.push(id);
    if (index > 0) parentById.set(id, spine[index - 1]);
  }
  const neighbourOrder = (fromId: string, a: string, b: string) => {
    const aDirection = directedRelation(fromId, a, directed);
    const bDirection = directedRelation(fromId, b, directed);
    if (aDirection !== bDirection) return aDirection - bDirection;
    const aNode = byId.get(a)!;
    const bNode = byId.get(b)!;
    const layerDelta = LAYER_RANK[userLayerOf(aNode)] - LAYER_RANK[userLayerOf(bNode)];
    if (layerDelta !== 0) return layerDelta;
    return a.localeCompare(b);
  };
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
    for (const neighbourId of [...(adjacency.get(id) ?? [])].sort((a, b) => neighbourOrder(id, a, b))) {
      if (!allowed.has(neighbourId) || scheduled.has(neighbourId)) continue;
      scheduled.add(neighbourId);
      parentById.set(neighbourId, id);
      order.push(neighbourId);
      queue.push(neighbourId);
    }
  }
  return { order, parentById };
}

function layerRadiusForSphere(node: UniformLayoutNode, sphereRadius: number): number {
  const layer = userLayerOf(node);
  if (layer === 'outer') return sphereRadius;
  if (layer === 'middle') return sphereRadius * 2 / 3;
  return sphereRadius / 3;
}

function directionKey(direction: THREE.Vector3): string {
  return `${direction.x.toFixed(6)}|${direction.y.toFixed(6)}|${direction.z.toFixed(6)}`;
}

function uniqueDirections(directions: readonly THREE.Vector3[]): THREE.Vector3[] {
  const unique: THREE.Vector3[] = [];
  for (const direction of directions) {
    if (direction.lengthSq() <= POSITION_EPSILON) continue;
    const unit = direction.clone().normalize();
    if (!unique.some(existing => existing.dot(unit) > 0.999999)) unique.push(unit);
  }
  return unique;
}

function buildLocalDirectionSet(): THREE.Vector3[] {
  const directions: THREE.Vector3[] = [];
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        if (x === 0 && y === 0 && z === 0) continue;
        directions.push(new THREE.Vector3(x, y, z).normalize());
      }
    }
  }
  return uniqueDirections(directions).sort((a, b) => directionKey(a).localeCompare(directionKey(b)));
}

const LOCAL_EXACT_DIRECTIONS = buildLocalDirectionSet();

function cellCoordinate(value: number): number { return Math.floor(value / FCC_NEIGHBOR_DISTANCE); }
function cellKey(x: number, y: number, z: number): string { return `${x}|${y}|${z}`; }

class PositionIndex {
  private readonly cells = new Map<string, Array<{ id: string; position: THREE.Vector3 }>>();
  constructor(positions?: ReadonlyMap<string, THREE.Vector3>) {
    if (positions) for (const [id, position] of positions) this.add(id, position);
  }
  add(id: string, position: THREE.Vector3): void {
    const key = cellKey(cellCoordinate(position.x), cellCoordinate(position.y), cellCoordinate(position.z));
    const bucket = this.cells.get(key) ?? [];
    bucket.push({ id, position });
    this.cells.set(key, bucket);
  }
  conflicts(candidate: THREE.Vector3): boolean {
    const cx = cellCoordinate(candidate.x);
    const cy = cellCoordinate(candidate.y);
    const cz = cellCoordinate(candidate.z);
    const minimumSq = (FCC_NEIGHBOR_DISTANCE - POSITION_EPSILON) ** 2;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (const entry of this.cells.get(cellKey(cx + dx, cy + dy, cz + dz)) ?? []) {
            if (candidate.distanceToSquared(entry.position) < minimumSq) return true;
          }
        }
      }
    }
    return false;
  }
}

function exactAssignedNeighbourCount(
  id: string,
  candidate: THREE.Vector3,
  adjacency: ReadonlyMap<string, string[]>,
  positions: ReadonlyMap<string, THREE.Vector3>,
): number {
  let count = 0;
  for (const neighbourId of adjacency.get(id) ?? []) {
    const neighbour = positions.get(neighbourId);
    if (neighbour && Math.abs(candidate.distanceTo(neighbour) - FCC_NEIGHBOR_DISTANCE) <= POSITION_EPSILON) count++;
  }
  return count;
}

function localAxialScore(parentId: string, id: string, parent: THREE.Vector3, candidate: THREE.Vector3, directed: DirectedIndex): number {
  const relation = directedRelation(parentId, id, directed);
  return relation * (candidate.z - parent.z);
}

function localLayerScore(node: UniformLayoutNode, rootLayer: UserLayoutLayer, candidate: THREE.Vector3): number {
  const targetZ = (LAYER_RANK[userLayerOf(node)] - LAYER_RANK[rootLayer]) * FCC_NEIGHBOR_DISTANCE;
  return -Math.abs(candidate.z - targetZ);
}

function chooseLocalExactCandidate(
  id: string,
  node: UniformLayoutNode,
  rootLayer: UserLayoutLayer,
  parentId: string,
  parent: THREE.Vector3,
  previousStep: THREE.Vector3 | null,
  preferredDirections: readonly THREE.Vector3[],
  adjacency: ReadonlyMap<string, string[]>,
  positions: ReadonlyMap<string, THREE.Vector3>,
  directed: DirectedIndex,
  index: PositionIndex,
  mode: GeometryMode,
): THREE.Vector3 | null {
  let best: THREE.Vector3 | null = null;
  let bestExact = -1;
  let bestPrimary = Number.NEGATIVE_INFINITY;
  let bestSecondary = Number.NEGATIVE_INFINITY;
  let bestContinuity = Number.NEGATIVE_INFINITY;
  let bestLayer = Number.NEGATIVE_INFINITY;
  let bestKey = '';
  for (const direction of uniqueDirections([...preferredDirections, ...LOCAL_EXACT_DIRECTIONS])) {
    const candidate = parent.clone().add(direction.clone().multiplyScalar(FCC_NEIGHBOR_DISTANCE));
    if (index.conflicts(candidate)) continue;
    const exact = exactAssignedNeighbourCount(id, candidate, adjacency, positions);
    const axial = localAxialScore(parentId, id, parent, candidate, directed);
    const compact = -candidate.lengthSq();
    const primary = mode === 'compact' ? compact : axial;
    const secondary = mode === 'compact' ? axial : compact;
    const continuity = previousStep ? direction.dot(previousStep.clone().normalize()) : 0;
    const layer = localLayerScore(node, rootLayer, candidate);
    const key = directionKey(direction);
    const better = exact > bestExact
      || (exact === bestExact && primary > bestPrimary + POSITION_EPSILON)
      || (exact === bestExact && Math.abs(primary - bestPrimary) <= POSITION_EPSILON && secondary > bestSecondary + POSITION_EPSILON)
      || (exact === bestExact && Math.abs(primary - bestPrimary) <= POSITION_EPSILON && Math.abs(secondary - bestSecondary) <= POSITION_EPSILON && continuity > bestContinuity + POSITION_EPSILON)
      || (exact === bestExact && Math.abs(primary - bestPrimary) <= POSITION_EPSILON && Math.abs(secondary - bestSecondary) <= POSITION_EPSILON && Math.abs(continuity - bestContinuity) <= POSITION_EPSILON && layer > bestLayer + POSITION_EPSILON)
      || (exact === bestExact && Math.abs(primary - bestPrimary) <= POSITION_EPSILON && Math.abs(secondary - bestSecondary) <= POSITION_EPSILON && Math.abs(continuity - bestContinuity) <= POSITION_EPSILON && Math.abs(layer - bestLayer) <= POSITION_EPSILON && (!bestKey || key < bestKey));
    if (!better) continue;
    best = candidate;
    bestExact = exact;
    bestPrimary = primary;
    bestSecondary = secondary;
    bestContinuity = continuity;
    bestLayer = layer;
    bestKey = key;
  }
  return best;
}

function chooseLocalLongCandidate(
  id: string,
  node: UniformLayoutNode,
  rootLayer: UserLayoutLayer,
  parentId: string,
  parent: THREE.Vector3,
  previousStep: THREE.Vector3 | null,
  preferredDirections: readonly THREE.Vector3[],
  directed: DirectedIndex,
  index: PositionIndex,
  mode: GeometryMode,
): THREE.Vector3 | null {
  for (let multiplier = 2; multiplier <= 8; multiplier++) {
    let best: THREE.Vector3 | null = null;
    let bestPrimary = Number.NEGATIVE_INFINITY;
    let bestSecondary = Number.NEGATIVE_INFINITY;
    let bestContinuity = Number.NEGATIVE_INFINITY;
    let bestLayer = Number.NEGATIVE_INFINITY;
    let bestKey = '';
    for (const direction of uniqueDirections([...preferredDirections, ...LOCAL_EXACT_DIRECTIONS])) {
      const candidate = parent.clone().add(direction.clone().multiplyScalar(FCC_NEIGHBOR_DISTANCE * multiplier));
      if (index.conflicts(candidate)) continue;
      const axial = localAxialScore(parentId, id, parent, candidate, directed);
      const compact = -candidate.lengthSq();
      const primary = mode === 'compact' ? compact : axial;
      const secondary = mode === 'compact' ? axial : compact;
      const continuity = previousStep ? direction.dot(previousStep.clone().normalize()) : 0;
      const layer = localLayerScore(node, rootLayer, candidate);
      const key = directionKey(direction);
      const better = primary > bestPrimary + POSITION_EPSILON
        || (Math.abs(primary - bestPrimary) <= POSITION_EPSILON && secondary > bestSecondary + POSITION_EPSILON)
        || (Math.abs(primary - bestPrimary) <= POSITION_EPSILON && Math.abs(secondary - bestSecondary) <= POSITION_EPSILON && continuity > bestContinuity + POSITION_EPSILON)
        || (Math.abs(primary - bestPrimary) <= POSITION_EPSILON && Math.abs(secondary - bestSecondary) <= POSITION_EPSILON && Math.abs(continuity - bestContinuity) <= POSITION_EPSILON && layer > bestLayer + POSITION_EPSILON)
        || (Math.abs(primary - bestPrimary) <= POSITION_EPSILON && Math.abs(secondary - bestSecondary) <= POSITION_EPSILON && Math.abs(continuity - bestContinuity) <= POSITION_EPSILON && Math.abs(layer - bestLayer) <= POSITION_EPSILON && (!bestKey || key < bestKey));
      if (!better) continue;
      best = candidate;
      bestPrimary = primary;
      bestSecondary = secondary;
      bestContinuity = continuity;
      bestLayer = layer;
      bestKey = key;
    }
    if (best) return best;
  }
  return null;
}

type ComponentPlan = { ids: string[]; rootId: string; spine: string[]; schedule: ComponentSchedule };
type LocalComponentGeometry = { offsets: Map<string, THREE.Vector3>; relaxed: boolean; mode: GeometryMode };
type PlacedComponent = { ids: string[]; rootId: string; anchorDirection: THREE.Vector3 };

function makeComponentPlans(
  components: readonly string[][],
  adjacency: ReadonlyMap<string, string[]>,
  directed: DirectedIndex,
  byId: ReadonlyMap<string, UniformLayoutNode>,
): ComponentPlan[] {
  return components.map(component => {
    const rootId = chooseConclusionAnchor(component, byId, directed);
    const spine = conclusionFirstSpine(rootId, component, directed);
    return { ids: [...component], rootId, spine, schedule: scheduleComponent(component, spine, adjacency, directed, byId) };
  });
}

/**
 * Phase 1: shape one connected component in its own coordinate system.
 * No sphere radius, other component, or expansion state is visible here. Therefore
 * a local self-collision can never be misclassified as global capacity pressure.
 */
function buildLocalComponentGeometry(
  plan: ComponentPlan,
  adjacency: ReadonlyMap<string, string[]>,
  directed: DirectedIndex,
  byId: ReadonlyMap<string, UniformLayoutNode>,
  mode: GeometryMode,
  allowLongEdges: boolean,
): LocalComponentGeometry | null {
  const offsets = new Map<string, THREE.Vector3>();
  const index = new PositionIndex();
  const rootNode = byId.get(plan.rootId)!;
  const rootLayer = userLayerOf(rootNode);
  const root = new THREE.Vector3();
  offsets.set(plan.rootId, root);
  index.add(plan.rootId, root);

  let previousSpineStep: THREE.Vector3 | null = null;
  for (let position = 1; position < plan.spine.length; position++) {
    const id = plan.spine[position];
    const node = byId.get(id)!;
    const parentId = plan.spine[position - 1];
    const parent = offsets.get(parentId)!;
    const preferred = [
      LOCAL_OUTWARD_AXIS.clone().negate(),
      ...(previousSpineStep ? [previousSpineStep.clone().normalize()] : []),
    ];
    let candidate = chooseLocalExactCandidate(
      id, node, rootLayer, parentId, parent, previousSpineStep, preferred,
      adjacency, offsets, directed, index, mode,
    );
    if (!candidate && allowLongEdges) {
      candidate = chooseLocalLongCandidate(
        id, node, rootLayer, parentId, parent, previousSpineStep, preferred,
        directed, index, mode,
      );
    }
    if (!candidate) return null;
    previousSpineStep = candidate.clone().sub(parent);
    offsets.set(id, candidate);
    index.add(id, candidate);
  }

  const spineSet = new Set(plan.spine);
  for (const id of plan.schedule.order) {
    if (spineSet.has(id)) continue;
    const node = byId.get(id)!;
    const parentId = plan.schedule.parentById.get(id);
    if (!parentId) return null;
    const parent = offsets.get(parentId);
    if (!parent) return null;
    const grandparentId = plan.schedule.parentById.get(parentId);
    const grandparent = grandparentId ? offsets.get(grandparentId) : undefined;
    const previousStep = grandparent ? parent.clone().sub(grandparent) : null;
    const relation = directedRelation(parentId, id, directed);
    const preferredAxis = LOCAL_OUTWARD_AXIS.clone().multiplyScalar(relation > 0 ? 1 : -1);
    const preferred = [
      preferredAxis,
      ...(previousStep ? [previousStep.clone().normalize()] : []),
    ];
    let candidate = chooseLocalExactCandidate(
      id, node, rootLayer, parentId, parent, previousStep, preferred,
      adjacency, offsets, directed, index, mode,
    );
    if (!candidate && allowLongEdges) {
      candidate = chooseLocalLongCandidate(
        id, node, rootLayer, parentId, parent, previousStep, preferred,
        directed, index, mode,
      );
    }
    if (!candidate) return null;
    offsets.set(id, candidate);
    index.add(id, candidate);
  }

  return { offsets, relaxed: allowLongEdges, mode };
}

function buildLocalComponentVariants(
  plan: ComponentPlan,
  adjacency: ReadonlyMap<string, string[]>,
  directed: DirectedIndex,
  byId: ReadonlyMap<string, UniformLayoutNode>,
): LocalComponentGeometry[] {
  const exact = (['inward', 'compact'] as const)
    .map(mode => buildLocalComponentGeometry(plan, adjacency, directed, byId, mode, false))
    .filter((geometry): geometry is LocalComponentGeometry => Boolean(geometry));
  if (exact.length > 0) return exact;

  const relaxed = (['inward', 'compact'] as const)
    .map(mode => buildLocalComponentGeometry(plan, adjacency, directed, byId, mode, true))
    .filter((geometry): geometry is LocalComponentGeometry => Boolean(geometry));
  if (relaxed.length === 0) throw new Error(`Unable to construct local knowledge chain rooted at ${plan.rootId}`);
  return relaxed;
}

function buildGapSeedDirections(): THREE.Vector3[] {
  const directions = BASE_ANCHOR_DIRECTIONS.map(direction => direction.clone());
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let index = 0; index < GAP_SEED_COUNT; index++) {
    const y = 1 - 2 * (index + 0.5) / GAP_SEED_COUNT;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const angle = index * goldenAngle;
    directions.push(new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius));
  }
  return uniqueDirections(directions);
}

const GAP_SEED_DIRECTIONS = buildGapSeedDirections();

function angularGapScore(candidate: THREE.Vector3, occupied: readonly THREE.Vector3[]): number {
  if (occupied.length === 0) return 2;
  let nearestDot = -1;
  for (const direction of occupied) nearestDot = Math.max(nearestDot, candidate.dot(direction));
  return 1 - nearestDot;
}

function compressOccupiedDirections(directions: THREE.Vector3[]): THREE.Vector3[] {
  const unique = uniqueDirections(directions);
  if (unique.length <= OCCUPANCY_DIRECTION_LIMIT) return unique;
  const ordered = [...unique].sort((a, b) => directionKey(a).localeCompare(directionKey(b)));
  const selected: THREE.Vector3[] = [ordered[0]];
  while (selected.length < OCCUPANCY_DIRECTION_LIMIT) {
    let best: THREE.Vector3 | null = null;
    let bestGap = Number.NEGATIVE_INFINITY;
    let bestKey = '';
    for (const candidate of ordered) {
      if (selected.some(existing => existing.dot(candidate) > 0.999999)) continue;
      const gap = angularGapScore(candidate, selected);
      const key = directionKey(candidate);
      if (gap > bestGap + POSITION_EPSILON || (Math.abs(gap - bestGap) <= POSITION_EPSILON && (!bestKey || key < bestKey))) {
        best = candidate;
        bestGap = gap;
        bestKey = key;
      }
    }
    if (!best) break;
    selected.push(best);
  }
  return selected;
}

/** Use actual already-placed node positions, not component anchor labels, as occupancy. */
function liveOccupiedDirections(positions: ReadonlyMap<string, THREE.Vector3>): THREE.Vector3[] {
  const directions: THREE.Vector3[] = [];
  for (const position of positions.values()) {
    if (position.lengthSq() <= POSITION_EPSILON) continue;
    directions.push(position.clone().normalize());
  }
  return compressOccupiedDirections(directions);
}

function refineGapDirection(seed: THREE.Vector3, occupied: readonly THREE.Vector3[]): THREE.Vector3 {
  if (occupied.length === 0) return seed.clone().normalize();
  let current = seed.clone().normalize();
  let currentScore = angularGapScore(current, occupied);
  let step = 0.35;
  for (let iteration = 0; iteration < 18; iteration++) {
    let nearest = occupied[0];
    let nearestDot = current.dot(nearest);
    for (let index = 1; index < occupied.length; index++) {
      const dot = current.dot(occupied[index]);
      if (dot > nearestDot) {
        nearestDot = dot;
        nearest = occupied[index];
      }
    }
    const tangent = nearest.clone().sub(current.clone().multiplyScalar(nearestDot));
    if (tangent.lengthSq() <= 1e-12) {
      step *= 0.5;
      continue;
    }
    const candidate = current.clone().sub(tangent.normalize().multiplyScalar(step)).normalize();
    const score = angularGapScore(candidate, occupied);
    if (score > currentScore + 1e-10) {
      current = candidate;
      currentScore = score;
    } else {
      step *= 0.5;
    }
    if (step < 1e-4) break;
  }
  return current;
}

function cardinalPriority(direction: THREE.Vector3): number {
  const index = BASE_ANCHOR_DIRECTIONS.findIndex(axis => axis.dot(direction) > 0.999999);
  return index < 0 ? BASE_ANCHOR_DIRECTIONS.length : index;
}

/**
 * Phase 2 input: rank true live spherical gaps from actual occupied node directions.
 * Seeds only start the continuous refinement; they are not a fixed placement order.
 */
function liveGapDirections(positions: ReadonlyMap<string, THREE.Vector3>): THREE.Vector3[] {
  const occupied = liveOccupiedDirections(positions);
  if (occupied.length === 0) return [...BASE_ANCHOR_DIRECTIONS.map(direction => direction.clone()), ...GAP_SEED_DIRECTIONS].slice(0, GAP_DIRECTION_LIMIT);

  const initial = [...GAP_SEED_DIRECTIONS].sort((a, b) => {
    const gapDelta = angularGapScore(b, occupied) - angularGapScore(a, occupied);
    if (Math.abs(gapDelta) > POSITION_EPSILON) return gapDelta;
    const priorityDelta = cardinalPriority(a) - cardinalPriority(b);
    if (priorityDelta !== 0) return priorityDelta;
    return directionKey(a).localeCompare(directionKey(b));
  });
  const refined = initial.slice(0, GAP_REFINEMENT_SEEDS).map(seed => refineGapDirection(seed, occupied));
  const ranked = uniqueDirections([...refined, ...initial]).sort((a, b) => {
    const gapDelta = angularGapScore(b, occupied) - angularGapScore(a, occupied);
    if (Math.abs(gapDelta) > POSITION_EPSILON) return gapDelta;
    const priorityDelta = cardinalPriority(a) - cardinalPriority(b);
    if (priorityDelta !== 0) return priorityDelta;
    return directionKey(a).localeCompare(directionKey(b));
  });
  return ranked.slice(0, GAP_DIRECTION_LIMIT);
}

function worldPositionLegal(candidate: THREE.Vector3, sphereRadius: number, globalIndex: PositionIndex): boolean {
  const radius = candidate.length();
  return radius >= CORE_LAYOUT_CLEARANCE_RADIUS - POSITION_EPSILON
    && radius <= sphereRadius + POSITION_EPSILON
    && !globalIndex.conflicts(candidate);
}

function spinAnglesFor(geometry: LocalComponentGeometry): number[] {
  if (geometry.offsets.size <= 1) return [0];
  return Array.from({ length: 12 }, (_, index) => index * Math.PI / 6);
}

function transformLocalGeometry(
  geometry: LocalComponentGeometry,
  rootNode: UniformLayoutNode,
  anchorDirection: THREE.Vector3,
  spinAngle: number,
  sphereRadius: number,
  globalPositions: ReadonlyMap<string, THREE.Vector3>,
): Map<string, THREE.Vector3> | null {
  const globalIndex = new PositionIndex(globalPositions);
  const rootWorld = anchorDirection.clone().multiplyScalar(layerRadiusForSphere(rootNode, sphereRadius));
  const spin = new THREE.Quaternion().setFromAxisAngle(LOCAL_OUTWARD_AXIS, spinAngle);
  const align = new THREE.Quaternion().setFromUnitVectors(LOCAL_OUTWARD_AXIS, anchorDirection.clone().normalize());
  const transformed = new Map<string, THREE.Vector3>();
  for (const [id, offset] of geometry.offsets) {
    const world = offset.clone().applyQuaternion(spin).applyQuaternion(align).add(rootWorld);
    if (!worldPositionLegal(world, sphereRadius, globalIndex)) return null;
    transformed.set(id, world);
  }
  return transformed;
}

/** Try the largest live empty direction first; only fall through when the whole rigid chain cannot fit there. */
function findBestComponentPlacement(
  plan: ComponentPlan,
  geometries: readonly LocalComponentGeometry[],
  sphereRadius: number,
  globalPositions: ReadonlyMap<string, THREE.Vector3>,
  byId: ReadonlyMap<string, UniformLayoutNode>,
): { positions: Map<string, THREE.Vector3>; anchorDirection: THREE.Vector3 } | null {
  const rootNode = byId.get(plan.rootId)!;
  for (const anchorDirection of liveGapDirections(globalPositions)) {
    for (const geometry of geometries) {
      for (const spinAngle of spinAnglesFor(geometry)) {
        const positions = transformLocalGeometry(geometry, rootNode, anchorDirection, spinAngle, sphereRadius, globalPositions);
        if (positions) return { positions, anchorDirection: anchorDirection.clone() };
      }
    }
  }
  return null;
}

/**
 * Expansion is a global packing operation only. Each already-placed component moves
 * rigidly by the change in its own layer target radius: inner +72, middle +144,
 * outer +216 for one R += 216 expansion.
 */
function expandSphere(
  sphereRadius: number,
  placed: readonly PlacedComponent[],
  positions: Map<string, THREE.Vector3>,
  byId: ReadonlyMap<string, UniformLayoutNode>,
): number {
  const nextRadius = sphereRadius + LAYOUT_RADIUS_INCREMENT;
  for (const component of placed) {
    const rootNode = byId.get(component.rootId)!;
    const distance = layerRadiusForSphere(rootNode, nextRadius) - layerRadiusForSphere(rootNode, sphereRadius);
    const delta = component.anchorDirection.clone().multiplyScalar(distance);
    for (const id of component.ids) positions.get(id)?.add(delta);
  }
  return nextRadius;
}

function placeGraphNodes(nodes: readonly UniformLayoutNode[]): Map<string, THREE.Vector3> {
  const byId = new Map(nodes.map(node => [node.id, node] as const));
  const edges = collectDirectLayoutEdges(nodes);
  const adjacency = buildAdjacency(nodes, edges);
  const directed = buildDirectedIndex(nodes, edges);
  const plans = makeComponentPlans(connectedComponents(adjacency), adjacency, directed, byId);
  const geometries = new Map<string, LocalComponentGeometry[]>();
  for (const plan of plans) geometries.set(plan.rootId, buildLocalComponentVariants(plan, adjacency, directed, byId));

  const positions = new Map<string, THREE.Vector3>();
  const placed: PlacedComponent[] = [];
  let sphereRadius = INITIAL_LAYOUT_RADIUS;

  for (const plan of plans) {
    let expansions = 0;
    for (;;) {
      const placement = findBestComponentPlacement(plan, geometries.get(plan.rootId)!, sphereRadius, positions, byId);
      if (placement) {
        for (const [id, position] of placement.positions) positions.set(id, position);
        placed.push({ ids: plan.ids, rootId: plan.rootId, anchorDirection: placement.anchorDirection });
        break;
      }
      sphereRadius = expandSphere(sphereRadius, placed, positions, byId);
      expansions++;
      if (expansions > MAX_LAYOUT_EXPANSIONS) {
        throw new Error(`Global knowledge-sphere capacity exhausted while packing chain rooted at ${plan.rootId}`);
      }
    }
  }
  return positions;
}

/**
 * Architecture contract:
 * 1) direct relation = 72 whenever the component has any legal exact local geometry;
 * 2) local chain shaping never sees sphere capacity or other components;
 * 3) global packing ranks actual occupied node directions, then tries the largest live gap first;
 * 4) only global rigid-chain packing failure may grow R;
 * 5) expansion preserves each component and moves it by its own layer-radius delta.
 */
export function applyUniformLayerLayout<T extends UniformLayoutNode>(nodes: T[]): T[] {
  const positions = placeGraphNodes(nodes);
  for (const node of nodes) {
    const layer = layerOf(node);
    node.layer = layer;
    if (layer === 'core') {
      const position = coreSlot(node.id);
      node.pos = position.clone();
      node.homePos = position.clone();
      node.vel = new THREE.Vector3();
      continue;
    }
    const position = positions.get(node.id);
    if (!position) throw new Error(`Missing layout position for node ${node.id}`);
    node.pos = position.clone();
    node.homePos = position.clone();
    node.vel ??= new THREE.Vector3();
    node.vel.set(0, 0, 0);
  }
  return nodes;
}
