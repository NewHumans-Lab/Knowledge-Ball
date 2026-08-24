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

/** The live ordinary ball radius in KnowledgeScene, in Three.js world units. */
export const ORDINARY_NODE_RADIUS = 7.2;
export const ORDINARY_NODE_DIAMETER = ORDINARY_NODE_RADIUS * 2;
/** First constraint: a direct graph relation is exactly five ball diameters whenever geometrically possible. */
export const FCC_NEIGHBOR_DISTANCE = ORDINARY_NODE_DIAMETER * 5;
const FCC_SCALE = FCC_NEIGHBOR_DISTANCE / Math.SQRT2;
export const CORE_LAYOUT_CLEARANCE_RADIUS = CORE_SUN_RADIUS + ORDINARY_NODE_RADIUS;
/** The knowledge sphere starts at three relation units and expands only in whole 3x steps. */
export const INITIAL_LAYOUT_RADIUS = FCC_NEIGHBOR_DISTANCE * 3;
export const LAYOUT_RADIUS_INCREMENT = FCC_NEIGHBOR_DISTANCE * 3;
const POSITION_EPSILON = 1e-7;
const MAX_WIDTH_EXPANSIONS_BEFORE_RELAXED_EDGE = 6;

/** Initial nominal layer radii; live placement scales these as thirds of the current sphere radius. */
export const LAYER_TARGET_RADIUS: Readonly<Record<UserLayoutLayer, number>> = Object.freeze({
  inner: FCC_NEIGHBOR_DISTANCE,
  middle: FCC_NEIGHBOR_DISTANCE * 2,
  outer: FCC_NEIGHBOR_DISTANCE * 3,
});

const LAYER_RANK: Readonly<Record<UserLayoutLayer, number>> = Object.freeze({ inner: 0, middle: 1, outer: 2 });

/** Retained as the exact-x reference lattice used by tests and local branch directions. */
export const FCC_NEIGHBOR_STEPS: readonly FccCoord[] = Object.freeze([
  [1, 1, 0], [1, -1, 0], [-1, 1, 0], [-1, -1, 0],
  [1, 0, 1], [1, 0, -1], [-1, 0, 1], [-1, 0, -1],
  [0, 1, 1], [0, 1, -1], [0, -1, 1], [0, -1, -1],
] as FccCoord[]);

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

/** Reasoning remains a real node: premise -> reasoning -> conclusion is two real direct edges. */
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
};

function buildDirectedIndex(nodes: readonly UniformLayoutNode[], edges: readonly FccLayoutEdge[]): DirectedIndex {
  const edgeKeys = new Set<string>();
  const incomingCount = new Map<string, number>();
  const outgoingCount = new Map<string, number>();
  for (const node of nodes) {
    if (!isLayoutNode(node)) continue;
    incomingCount.set(node.id, 0);
    outgoingCount.set(node.id, 0);
  }
  for (const edge of edges) {
    edgeKeys.add(`${edge.fromId}->${edge.toId}`);
    incomingCount.set(edge.toId, (incomingCount.get(edge.toId) ?? 0) + 1);
    outgoingCount.set(edge.fromId, (outgoingCount.get(edge.fromId) ?? 0) + 1);
  }
  return { edgeKeys, incomingCount, outgoingCount };
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

type BfsTree = { parent: Map<string, string | null>; distance: Map<string, number>; farthest: string };

function bfsFrom(start: string, allowed: ReadonlySet<string>, adjacency: ReadonlyMap<string, string[]>): BfsTree {
  const parent = new Map<string, string | null>([[start, null]]);
  const distance = new Map<string, number>([[start, 0]]);
  const queue = [start];
  let farthest = start;
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
    const nextDistance = (distance.get(id) ?? 0) + 1;
    for (const neighbourId of adjacency.get(id) ?? []) {
      if (!allowed.has(neighbourId) || distance.has(neighbourId)) continue;
      parent.set(neighbourId, id);
      distance.set(neighbourId, nextDistance);
      queue.push(neighbourId);
      if (nextDistance > (distance.get(farthest) ?? 0)) farthest = neighbourId;
    }
  }
  return { parent, distance, farthest };
}

/** The main spine starts at the conclusion anchor and follows the longest available premise-side depth. */
function conclusionFirstSpine(anchorId: string, component: readonly string[], adjacency: ReadonlyMap<string, string[]>): string[] {
  const tree = bfsFrom(anchorId, new Set(component), adjacency);
  const path: string[] = [];
  let cursor: string | null | undefined = tree.farthest;
  while (cursor) {
    path.push(cursor);
    if (cursor === anchorId) break;
    cursor = tree.parent.get(cursor);
  }
  return path.reverse();
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

const BASE_ANCHOR_DIRECTIONS = Object.freeze([
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, 0, -1),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(-1, 0, 0),
]);

function directionKey(direction: THREE.Vector3): string {
  return `${direction.x.toFixed(6)}|${direction.y.toFixed(6)}|${direction.z.toFixed(6)}`;
}

/**
 * Build one deterministic insertion order once: front/back/up/down/right/left,
 * then repeatedly choose the direction in the largest angular gap. Runtime never
 * re-sorts the entire sphere for every component.
 */
function buildAnchorDirectionSequence(): THREE.Vector3[] {
  const candidates = new Map<string, THREE.Vector3>();
  for (let x = -4; x <= 4; x++) {
    for (let y = -4; y <= 4; y++) {
      for (let z = -4; z <= 4; z++) {
        if (x === 0 && y === 0 && z === 0) continue;
        const direction = new THREE.Vector3(x, y, z).normalize();
        candidates.set(directionKey(direction), direction);
      }
    }
  }

  const sequence = BASE_ANCHOR_DIRECTIONS.map(direction => direction.clone());
  for (const direction of sequence) candidates.delete(directionKey(direction));
  const maxDot = new Map<string, number>();
  for (const [key, candidate] of candidates) {
    let value = -1;
    for (const selected of sequence) value = Math.max(value, candidate.dot(selected));
    maxDot.set(key, value);
  }

  while (candidates.size > 0) {
    let bestKey = '';
    let bestDot = Number.POSITIVE_INFINITY;
    for (const key of candidates.keys()) {
      const dot = maxDot.get(key) ?? 1;
      if (dot < bestDot - POSITION_EPSILON || (Math.abs(dot - bestDot) <= POSITION_EPSILON && (!bestKey || key < bestKey))) {
        bestKey = key;
        bestDot = dot;
      }
    }
    const selected = candidates.get(bestKey)!;
    sequence.push(selected);
    candidates.delete(bestKey);
    maxDot.delete(bestKey);
    for (const [key, candidate] of candidates) {
      maxDot.set(key, Math.max(maxDot.get(key) ?? -1, candidate.dot(selected)));
    }
  }
  return sequence;
}

const ANCHOR_DIRECTION_SEQUENCE = buildAnchorDirectionSequence();

function angularGapScore(candidate: THREE.Vector3, used: readonly THREE.Vector3[]): number {
  if (used.length === 0) return 2;
  let nearestDot = -1;
  for (const direction of used) nearestDot = Math.max(nearestDot, candidate.dot(direction));
  return 1 - nearestDot;
}

function orthonormalBasis(direction: THREE.Vector3): [THREE.Vector3, THREE.Vector3, THREE.Vector3] {
  const w = direction.clone().normalize();
  const reference = Math.abs(w.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = reference.clone().cross(w).normalize();
  const v = w.clone().cross(u).normalize();
  return [u, v, w];
}

/** Small local direction set: straight axes first, then diagonals that fill their gaps. */
function localExactDirections(anchorDirection: THREE.Vector3): THREE.Vector3[] {
  const [u, v, w] = orthonormalBasis(anchorDirection);
  const local = [
    w.clone().negate(), w.clone(), u.clone(), u.clone().negate(), v.clone(), v.clone().negate(),
  ];
  for (let a = -1; a <= 1; a++) {
    for (let b = -1; b <= 1; b++) {
      for (let c = -1; c <= 1; c++) {
        if (a === 0 && b === 0 && c === 0) continue;
        const direction = u.clone().multiplyScalar(a).add(v.clone().multiplyScalar(b)).add(w.clone().multiplyScalar(c));
        if (direction.lengthSq() <= POSITION_EPSILON) continue;
        direction.normalize();
        if (!local.some(existing => existing.dot(direction) > 0.999999)) local.push(direction);
      }
    }
  }
  return local;
}

function cellCoordinate(value: number): number { return Math.floor(value / FCC_NEIGHBOR_DISTANCE); }
function cellKey(x: number, y: number, z: number): string { return `${x}|${y}|${z}`; }

/** 72-unit spatial hash: collision queries inspect only neighbouring cells. */
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

function positionLegal(candidate: THREE.Vector3, sphereRadius: number, index: PositionIndex): boolean {
  const radius = candidate.length();
  return radius >= CORE_LAYOUT_CLEARANCE_RADIUS - POSITION_EPSILON
    && radius <= sphereRadius + POSITION_EPSILON
    && !index.conflicts(candidate);
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

function candidateRadialScore(parentId: string, id: string, parent: THREE.Vector3, candidate: THREE.Vector3, directed: DirectedIndex): number {
  const relation = directedRelation(parentId, id, directed);
  return relation * (candidate.length() - parent.length());
}

function layerCandidateScore(node: UniformLayoutNode, candidate: THREE.Vector3, sphereRadius: number): number {
  return -Math.abs(candidate.length() - layerRadiusForSphere(node, sphereRadius));
}

function chooseExactCandidate(
  id: string,
  node: UniformLayoutNode,
  parentId: string,
  parent: THREE.Vector3,
  previousStep: THREE.Vector3 | null,
  directions: readonly THREE.Vector3[],
  sphereRadius: number,
  adjacency: ReadonlyMap<string, string[]>,
  positions: ReadonlyMap<string, THREE.Vector3>,
  directed: DirectedIndex,
  index: PositionIndex,
): THREE.Vector3 | null {
  let best: THREE.Vector3 | null = null;
  let bestExact = -1;
  let bestRadial = Number.NEGATIVE_INFINITY;
  let bestContinuity = Number.NEGATIVE_INFINITY;
  let bestLayer = Number.NEGATIVE_INFINITY;
  let bestKey = '';
  for (const direction of directions) {
    const candidate = parent.clone().add(direction.clone().multiplyScalar(FCC_NEIGHBOR_DISTANCE));
    if (!positionLegal(candidate, sphereRadius, index)) continue;
    const exact = exactAssignedNeighbourCount(id, candidate, adjacency, positions);
    const radial = candidateRadialScore(parentId, id, parent, candidate, directed);
    const continuity = previousStep ? direction.dot(previousStep.clone().normalize()) : 0;
    const layer = layerCandidateScore(node, candidate, sphereRadius);
    const key = directionKey(direction);
    const better = exact > bestExact
      || (exact === bestExact && radial > bestRadial + POSITION_EPSILON)
      || (exact === bestExact && Math.abs(radial - bestRadial) <= POSITION_EPSILON && continuity > bestContinuity + POSITION_EPSILON)
      || (exact === bestExact && Math.abs(radial - bestRadial) <= POSITION_EPSILON && Math.abs(continuity - bestContinuity) <= POSITION_EPSILON && layer > bestLayer + POSITION_EPSILON)
      || (exact === bestExact && Math.abs(radial - bestRadial) <= POSITION_EPSILON && Math.abs(continuity - bestContinuity) <= POSITION_EPSILON && Math.abs(layer - bestLayer) <= POSITION_EPSILON && (!bestKey || key < bestKey));
    if (!better) continue;
    best = candidate;
    bestExact = exact;
    bestRadial = radial;
    bestContinuity = continuity;
    bestLayer = layer;
    bestKey = key;
  }
  return best;
}

function chooseLongCandidate(
  parent: THREE.Vector3,
  directions: readonly THREE.Vector3[],
  sphereRadius: number,
  index: PositionIndex,
): THREE.Vector3 | null {
  for (let multiplier = 2; multiplier <= 8; multiplier++) {
    for (const direction of directions) {
      const candidate = parent.clone().add(direction.clone().multiplyScalar(FCC_NEIGHBOR_DISTANCE * multiplier));
      if (positionLegal(candidate, sphereRadius, index)) return candidate;
    }
  }
  return null;
}

type ComponentPlan = {
  ids: string[];
  rootId: string;
  spine: string[];
  schedule: ComponentSchedule;
};

type PlacedComponent = { ids: string[]; anchorDirection: THREE.Vector3 };

function makeComponentPlans(
  components: readonly string[][],
  adjacency: ReadonlyMap<string, string[]>,
  directed: DirectedIndex,
  byId: ReadonlyMap<string, UniformLayoutNode>,
): ComponentPlan[] {
  return components.map(component => {
    const rootId = chooseConclusionAnchor(component, byId, directed);
    const spine = conclusionFirstSpine(rootId, component, adjacency);
    return { ids: [...component], rootId, spine, schedule: scheduleComponent(component, spine, adjacency, directed, byId) };
  });
}

function requiredSphereRadiusForSpine(plan: ComponentPlan, byId: ReadonlyMap<string, UniformLayoutNode>): number {
  const root = byId.get(plan.rootId)!;
  const requiredRootRadius = CORE_LAYOUT_CLEARANCE_RADIUS + Math.max(0, plan.spine.length - 1) * FCC_NEIGHBOR_DISTANCE;
  const layer = userLayerOf(root);
  if (layer === 'outer') return requiredRootRadius;
  if (layer === 'middle') return requiredRootRadius * 3 / 2;
  return requiredRootRadius * 3;
}

function tryPlaceComponent(
  plan: ComponentPlan,
  anchorDirection: THREE.Vector3,
  sphereRadius: number,
  globalPositions: ReadonlyMap<string, THREE.Vector3>,
  adjacency: ReadonlyMap<string, string[]>,
  directed: DirectedIndex,
  byId: ReadonlyMap<string, UniformLayoutNode>,
  allowLongEdges: boolean,
): Map<string, THREE.Vector3> | null {
  const local = new Map<string, THREE.Vector3>();
  const combinedPositions = new Map(globalPositions);
  const index = new PositionIndex(globalPositions);
  const rootNode = byId.get(plan.rootId)!;
  const root = anchorDirection.clone().multiplyScalar(layerRadiusForSphere(rootNode, sphereRadius));
  if (!positionLegal(root, sphereRadius, index)) return null;
  local.set(plan.rootId, root);
  combinedPositions.set(plan.rootId, root);
  index.add(plan.rootId, root);

  // Long/main chain first: conclusion -> premise, straight toward the centre.
  for (let position = 1; position < plan.spine.length; position++) {
    const id = plan.spine[position];
    const parentId = plan.spine[position - 1];
    const parent = local.get(parentId)!;
    const relation = directedRelation(parentId, id, directed);
    const sign = relation > 0 ? 1 : -1;
    const candidate = parent.clone().add(anchorDirection.clone().multiplyScalar(sign * FCC_NEIGHBOR_DISTANCE));
    if (!positionLegal(candidate, sphereRadius, index)) return null;
    local.set(id, candidate);
    combinedPositions.set(id, candidate);
    index.add(id, candidate);
  }

  const localDirections = localExactDirections(anchorDirection);
  const spineSet = new Set(plan.spine);
  for (const id of plan.schedule.order) {
    if (spineSet.has(id)) continue;
    const node = byId.get(id)!;
    const parentId = plan.schedule.parentById.get(id);
    if (!parentId) return null;
    const parent = local.get(parentId);
    if (!parent) return null;
    const grandparentId = plan.schedule.parentById.get(parentId);
    const grandparent = grandparentId ? local.get(grandparentId) : undefined;
    const previousStep = grandparent ? parent.clone().sub(grandparent) : null;
    const radial = parent.lengthSq() > POSITION_EPSILON ? parent.clone().normalize() : anchorDirection.clone();
    const relation = directedRelation(parentId, id, directed);
    const preferredRadial = radial.multiplyScalar(relation > 0 ? 1 : -1);
    const directions = [preferredRadial];
    if (previousStep && previousStep.lengthSq() > POSITION_EPSILON) directions.push(previousStep.clone().normalize());
    directions.push(...localDirections);
    let candidate = chooseExactCandidate(
      id,
      node,
      parentId,
      parent,
      previousStep,
      directions,
      sphereRadius,
      adjacency,
      combinedPositions,
      directed,
      index,
    );
    const parentDegree = adjacency.get(parentId)?.length ?? 0;
    if (!candidate && (allowLongEdges || parentDegree > 12)) candidate = chooseLongCandidate(parent, directions, sphereRadius, index);
    if (!candidate) return null;
    local.set(id, candidate);
    combinedPositions.set(id, candidate);
    index.add(id, candidate);
  }
  return local;
}

function expandSphere(
  sphereRadius: number,
  placed: readonly PlacedComponent[],
  positions: Map<string, THREE.Vector3>,
): number {
  for (const component of placed) {
    const delta = component.anchorDirection.clone().multiplyScalar(LAYOUT_RADIUS_INCREMENT);
    for (const id of component.ids) positions.get(id)?.add(delta);
  }
  return sphereRadius + LAYOUT_RADIUS_INCREMENT;
}

function placeGraphNodes(nodes: readonly UniformLayoutNode[]): Map<string, THREE.Vector3> {
  const byId = new Map(nodes.map(node => [node.id, node] as const));
  const edges = collectDirectLayoutEdges(nodes);
  const adjacency = buildAdjacency(nodes, edges);
  const directed = buildDirectedIndex(nodes, edges);
  const plans = makeComponentPlans(connectedComponents(adjacency), adjacency, directed, byId);
  const positions = new Map<string, THREE.Vector3>();
  const placed: PlacedComponent[] = [];
  let sphereRadius = INITIAL_LAYOUT_RADIUS;

  for (const plan of plans) {
    const requiredRadius = requiredSphereRadiusForSpine(plan, byId);
    while (sphereRadius + POSITION_EPSILON < requiredRadius) sphereRadius = expandSphere(sphereRadius, placed, positions);

    let widthExpansions = 0;
    for (;;) {
      let local: Map<string, THREE.Vector3> | null = null;
      let chosenDirection: THREE.Vector3 | null = null;
      for (const direction of ANCHOR_DIRECTION_SEQUENCE) {
        local = tryPlaceComponent(
          plan,
          direction,
          sphereRadius,
          positions,
          adjacency,
          directed,
          byId,
          widthExpansions >= MAX_WIDTH_EXPANSIONS_BEFORE_RELAXED_EDGE,
        );
        if (!local) continue;
        chosenDirection = direction;
        break;
      }
      if (local && chosenDirection) {
        for (const [id, position] of local) positions.set(id, position);
        placed.push({ ids: plan.ids, anchorDirection: chosenDirection.clone() });
        break;
      }
      sphereRadius = expandSphere(sphereRadius, placed, positions);
      widthExpansions++;
      if (widthExpansions > 24) throw new Error(`Unable to place knowledge chain rooted at ${plan.rootId}`);
    }
  }
  return positions;
}

/**
 * Layout contract:
 * 1) direct relation = 72 whenever possible;
 * 2) larger chains are placed first, conclusion side first, premises toward centre;
 * 3) purple anchors the current sphere surface, blue/cyan use middle/inner thirds;
 * 4) front/back/up/down/left/right fill first, then the largest spherical gaps;
 * 5) if depth/width is insufficient, sphere radius += 3x and every existing chain
 *    is translated outward by the same 3x vector as a rigid body.
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
