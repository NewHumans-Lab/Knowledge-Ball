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
/** First constraint: direct graph neighbours prefer exactly five ball diameters. */
export const FCC_NEIGHBOR_DISTANCE = ORDINARY_NODE_DIAMETER * 5;
const FCC_SCALE = FCC_NEIGHBOR_DISTANCE / Math.SQRT2;
/** The Sun only owns its physical centre space; no extra semantic shell is reserved. */
export const CORE_LAYOUT_CLEARANCE_RADIUS = CORE_SUN_RADIUS + ORDINARY_NODE_RADIUS;
const POSITION_EPSILON_SQ = 1e-12;

/** Soft radial targets only; never hard shells or reasons to break x=72. */
export const LAYER_TARGET_RADIUS: Readonly<Record<UserLayoutLayer, number>> = Object.freeze({
  inner: FCC_NEIGHBOR_DISTANCE,
  middle: FCC_NEIGHBOR_DISTANCE * 2,
  outer: FCC_NEIGHBOR_DISTANCE * 3,
});

const LAYER_RANK: Readonly<Record<UserLayoutLayer, number>> = Object.freeze({
  inner: 0,
  middle: 1,
  outer: 2,
});

/** Every FCC step has Euclidean length sqrt(2), therefore exactly one x after scaling. */
export const FCC_NEIGHBOR_STEPS: readonly FccCoord[] = Object.freeze([
  [1, 1, 0], [1, -1, 0], [-1, 1, 0], [-1, -1, 0],
  [1, 0, 1], [1, 0, -1], [-1, 0, 1], [-1, 0, -1],
  [0, 1, 1], [0, 1, -1], [0, -1, 1], [0, -1, -1],
] as FccCoord[]);

function layerOf(node: UniformLayoutNode): KnowledgeLayer {
  const layer = node.effectiveLayer
    ?? node.layer
    ?? (isSystemCoreNodeId(node.id) ? 'core' : undefined);
  if (!layer) throw new Error(`Missing effective layer for layout node ${node.id}`);
  return layer;
}

function userLayerOf(node: UniformLayoutNode): UserLayoutLayer {
  const layer = layerOf(node);
  if (layer === 'core') throw new Error(`Core node ${node.id} does not use user-layer placement`);
  return layer;
}

function isLayoutNode(node: UniformLayoutNode): boolean {
  return layerOf(node) !== 'core';
}

function coordKey(coord: FccCoord): string {
  return `${coord[0]}|${coord[1]}|${coord[2]}`;
}

function addCoord(a: FccCoord, b: FccCoord): FccCoord {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subtractCoord(a: FccCoord, b: FccCoord): FccCoord {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function coordLengthSq(coord: FccCoord): number {
  return coord[0] ** 2 + coord[1] ** 2 + coord[2] ** 2;
}

function coordRadius(coord: FccCoord): number {
  return Math.sqrt(coordLengthSq(coord)) * FCC_SCALE;
}

function directionDot(a: FccCoord, b: FccCoord): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function isNearestFccStep(delta: FccCoord): boolean {
  return coordLengthSq(delta) === 2
    && Math.abs(delta[0]) <= 1
    && Math.abs(delta[1]) <= 1
    && Math.abs(delta[2]) <= 1;
}

export function fccPositionForCoord(coord: FccCoord): THREE.Vector3 {
  return new THREE.Vector3(coord[0] * FCC_SCALE, coord[1] * FCC_SCALE, coord[2] * FCC_SCALE);
}

function coreSlot(id: string): THREE.Vector3 {
  const index = Math.max(0, SUN_TRIAD_IDS.indexOf(id as (typeof SUN_TRIAD_IDS)[number]));
  const angle = index * Math.PI * 2 / SUN_TRIAD_IDS.length;
  return new THREE.Vector3(
    Math.cos(angle) * SUN_ORBIT_RADIUS,
    Math.sin(angle) * SUN_ORBIT_RADIUS,
    0,
  );
}

export interface FccLayoutEdge {
  fromId: string;
  toId: string;
}

/**
 * Layout uses only real direct premise edges. Reasoning balls remain real nodes:
 * premise -> reasoning -> conclusion is two real edges, each preferring one x.
 */
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

function buildAdjacency(
  nodes: readonly UniformLayoutNode[],
  edges: readonly FccLayoutEdge[],
): Map<string, string[]> {
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

function buildDirectedIndex(
  nodes: readonly UniformLayoutNode[],
  edges: readonly FccLayoutEdge[],
): DirectedIndex {
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
  const ids = [...adjacency.keys()].sort();

  for (const seed of ids) {
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
  return components;
}

type BfsResult = {
  farthest: string;
  parent: Map<string, string | null>;
  distance: Map<string, number>;
};

function bfsWithin(
  start: string,
  allowed: ReadonlySet<string>,
  adjacency: ReadonlyMap<string, string[]>,
): BfsResult {
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
  return { farthest, parent, distance };
}

/** Cheap main-chain estimate; it controls straightness, never the one-x contract. */
function approximateDiameterPath(
  component: readonly string[],
  adjacency: ReadonlyMap<string, string[]>,
): string[] {
  if (component.length <= 1) return [...component];
  const allowed = new Set(component);
  const first = bfsWithin(component[0], allowed, adjacency);
  const second = bfsWithin(first.farthest, allowed, adjacency);
  const path: string[] = [];
  let cursor: string | null | undefined = second.farthest;
  while (cursor) {
    path.push(cursor);
    if (cursor === first.farthest) break;
    cursor = second.parent.get(cursor);
  }
  return path.reverse();
}

function endpointDownstreamScore(id: string, directed: DirectedIndex): number {
  return (directed.incomingCount.get(id) ?? 0) - (directed.outgoingCount.get(id) ?? 0);
}

/**
 * The layout anchor is the conclusion side, not the premise side. Orient the cheap
 * main spine so semantic arrows run toward index 0: conclusion -> ... -> premise.
 * If direction is tied, prefer the higher colour layer as the outer anchor
 * (purple/outer, then blue/middle, then cyan/inner).
 */
function orientSpine(
  spine: readonly string[],
  directed: DirectedIndex,
  byId: ReadonlyMap<string, UniformLayoutNode>,
): string[] {
  if (spine.length <= 1) return [...spine];
  let directionScore = 0;
  for (let i = 1; i < spine.length; i++) {
    directionScore += directedRelation(spine[i - 1], spine[i], directed);
  }
  if (directionScore > 0) return [...spine].reverse();
  if (directionScore < 0) return [...spine];

  const first = spine[0];
  const last = spine[spine.length - 1];
  const firstDownstream = endpointDownstreamScore(first, directed);
  const lastDownstream = endpointDownstreamScore(last, directed);
  if (lastDownstream > firstDownstream) return [...spine].reverse();
  if (firstDownstream > lastDownstream) return [...spine];

  const firstLayer = byId.get(first);
  const lastLayer = byId.get(last);
  if (firstLayer && lastLayer) {
    const firstRank = LAYER_RANK[userLayerOf(firstLayer)];
    const lastRank = LAYER_RANK[userLayerOf(lastLayer)];
    if (lastRank > firstRank) return [...spine].reverse();
    if (firstRank > lastRank) return [...spine];
  }
  return first <= last ? [...spine] : [...spine].reverse();
}

type ComponentSchedule = {
  order: string[];
  parentById: Map<string, string>;
};

/**
 * Place the conclusion side first and walk backward toward premises. Incoming
 * semantic neighbours are therefore scheduled before outgoing neighbours. Within
 * a direction tie, higher colour layers are placed first as the outer side.
 */
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
    if (scheduled.has(id)) continue;
    scheduled.add(id);
    order.push(id);
    queue.push(id);
    if (index > 0) parentById.set(id, spine[index - 1]);
  }

  const neighbourOrder = (fromId: string, a: string, b: string) => {
    const aDirection = directedRelation(fromId, a, directed);
    const bDirection = directedRelation(fromId, b, directed);
    if (aDirection !== bDirection) return aDirection - bDirection;
    const aNode = byId.get(a);
    const bNode = byId.get(b);
    if (aNode && bNode) {
      const layerDifference = LAYER_RANK[userLayerOf(bNode)] - LAYER_RANK[userLayerOf(aNode)];
      if (layerDifference !== 0) return layerDifference;
    }
    return a.localeCompare(b);
  };

  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
    const neighbours = [...(adjacency.get(id) ?? [])].sort((a, b) => neighbourOrder(id, a, b));
    for (const neighbourId of neighbours) {
      if (!allowed.has(neighbourId) || scheduled.has(neighbourId)) continue;
      scheduled.add(neighbourId);
      parentById.set(neighbourId, id);
      order.push(neighbourId);
      queue.push(neighbourId);
    }
  }
  return { order, parentById };
}

function validFreeSlot(coord: FccCoord, occupied: ReadonlySet<string>): boolean {
  return !occupied.has(coordKey(coord))
    && fccPositionForCoord(coord).length() >= CORE_LAYOUT_CLEARANCE_RADIUS;
}

function minimumDistanceSqToAssigned(
  candidate: FccCoord,
  assigned: ReadonlyMap<string, FccCoord>,
): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (const coord of assigned.values()) {
    const delta = subtractCoord(candidate, coord);
    minimum = Math.min(minimum, coordLengthSq(delta));
  }
  return minimum;
}

function layerRadiusScore(node: UniformLayoutNode, candidate: FccCoord): number {
  const target = LAYER_TARGET_RADIUS[userLayerOf(node)];
  return -Math.abs(coordRadius(candidate) - target) / FCC_NEIGHBOR_DISTANCE;
}

function chooseRootCandidate(
  node: UniformLayoutNode,
  candidates: readonly FccCoord[],
  assigned: ReadonlyMap<string, FccCoord>,
): FccCoord {
  let best = candidates[0];
  let bestLayer = Number.NEGATIVE_INFINITY;
  let bestGap = Number.NEGATIVE_INFINITY;
  let bestKey = coordKey(best);
  for (const candidate of candidates) {
    const layer = layerRadiusScore(node, candidate);
    const gap = minimumDistanceSqToAssigned(candidate, assigned);
    const key = coordKey(candidate);
    const better = layer > bestLayer + 1e-9
      || (Math.abs(layer - bestLayer) <= 1e-9 && gap > bestGap)
      || (Math.abs(layer - bestLayer) <= 1e-9 && gap === bestGap && key < bestKey);
    if (!better) continue;
    best = candidate;
    bestLayer = layer;
    bestGap = gap;
    bestKey = key;
  }
  return best;
}

/**
 * The conclusion-side root uses its colour layer as an approximate location only:
 * purple near 3x, blue near 2x, cyan near 1x. We do not push it outward by chain
 * length; if a long chain eventually cannot keep moving inward, x=72 wins and the
 * next legal step may become tangent or less inward.
 */
function rootSlot(
  node: UniformLayoutNode,
  occupied: ReadonlySet<string>,
  assigned: ReadonlyMap<string, FccCoord>,
): FccCoord {
  const targetDepth = LAYER_RANK[userLayerOf(node)] + 1;
  const visited = new Set<string>([coordKey([0, 0, 0])]);
  let frontier: FccCoord[] = [[0, 0, 0]];
  const candidates: FccCoord[] = [];

  for (let depth = 1; depth <= targetDepth; depth++) {
    const nextByKey = new Map<string, FccCoord>();
    for (const coord of frontier) {
      for (const step of FCC_NEIGHBOR_STEPS) {
        const next = addCoord(coord, step);
        const key = coordKey(next);
        if (visited.has(key)) continue;
        visited.add(key);
        nextByKey.set(key, next);
      }
    }
    frontier = [...nextByKey.values()];
    candidates.push(...frontier.filter(coord => validFreeSlot(coord, occupied)));
  }
  if (candidates.length > 0) return chooseRootCandidate(node, candidates, assigned);

  for (;;) {
    const nextByKey = new Map<string, FccCoord>();
    for (const coord of frontier) {
      for (const step of FCC_NEIGHBOR_STEPS) {
        const next = addCoord(coord, step);
        const key = coordKey(next);
        if (visited.has(key)) continue;
        visited.add(key);
        nextByKey.set(key, next);
      }
    }
    frontier = [...nextByKey.values()];
    const free = frontier.filter(coord => validFreeSlot(coord, occupied));
    if (free.length > 0) return chooseRootCandidate(node, free, assigned);
  }
}

function exactAssignedNeighbourCount(
  id: string,
  candidate: FccCoord,
  adjacency: ReadonlyMap<string, string[]>,
  assigned: ReadonlyMap<string, FccCoord>,
): number {
  let count = 0;
  for (const neighbourId of adjacency.get(id) ?? []) {
    const neighbourCoord = assigned.get(neighbourId);
    if (!neighbourCoord) continue;
    if (isNearestFccStep(subtractCoord(candidate, neighbourCoord))) count++;
  }
  return count;
}

/** Larger score means the candidate points into a larger unoccupied local angle. */
function gapScore(
  parentCoord: FccCoord,
  candidateCoord: FccCoord,
  occupied: ReadonlySet<string>,
): number {
  const candidateDirection = subtractCoord(candidateCoord, parentCoord);
  const candidateLength = Math.sqrt(coordLengthSq(candidateDirection));
  let maxAlignment = -1;
  let found = false;

  for (const step of FCC_NEIGHBOR_STEPS) {
    if (!occupied.has(coordKey(addCoord(parentCoord, step)))) continue;
    found = true;
    const alignment = directionDot(candidateDirection, step) / (candidateLength * Math.SQRT2);
    maxAlignment = Math.max(maxAlignment, alignment);
  }
  return found ? -maxAlignment : 1;
}

function continuityScore(candidate: FccCoord, parent: FccCoord, previousStep: FccCoord | null): number {
  if (!previousStep) return 0;
  const direction = subtractCoord(candidate, parent);
  const a = Math.sqrt(coordLengthSq(direction));
  const b = Math.sqrt(coordLengthSq(previousStep));
  if (a <= POSITION_EPSILON_SQ || b <= POSITION_EPSILON_SQ) return 0;
  return directionDot(direction, previousStep) / (a * b);
}

/**
 * Second constraint: semantic source should lie inward of its target whenever the
 * first constraint leaves such an exact-x candidate. Because layout starts from
 * the conclusion side, target -> source placement prefers a negative radial delta.
 */
function directedRadialScore(
  parentId: string,
  id: string,
  parentCoord: FccCoord,
  candidate: FccCoord,
  directed: DirectedIndex,
): number {
  const relation = directedRelation(parentId, id, directed);
  if (relation === 0) return 0;
  const outwardDelta = coordRadius(candidate) - coordRadius(parentCoord);
  return relation * outwardDelta / FCC_NEIGHBOR_DISTANCE;
}

function chooseCandidate(
  candidates: readonly FccCoord[],
  node: UniformLayoutNode,
  parentId: string,
  parentCoord: FccCoord,
  preserveContinuity: boolean,
  previousStep: FccCoord | null,
  occupied: ReadonlySet<string>,
  adjacency: ReadonlyMap<string, string[]>,
  assigned: ReadonlyMap<string, FccCoord>,
  directed: DirectedIndex,
): FccCoord {
  let best = candidates[0];
  let bestExact = -1;
  let bestRadial = Number.NEGATIVE_INFINITY;
  let bestContinuity = Number.NEGATIVE_INFINITY;
  let bestLayer = Number.NEGATIVE_INFINITY;
  let bestGap = Number.NEGATIVE_INFINITY;
  let bestKey = coordKey(best);

  for (const candidate of candidates) {
    const exact = exactAssignedNeighbourCount(node.id, candidate, adjacency, assigned);
    const radial = directedRadialScore(parentId, node.id, parentCoord, candidate, directed);
    const continuity = preserveContinuity ? continuityScore(candidate, parentCoord, previousStep) : 0;
    const layer = layerRadiusScore(node, candidate);
    const gap = gapScore(parentCoord, candidate, occupied);
    const key = coordKey(candidate);
    const sameExact = exact === bestExact;
    const sameRadial = Math.abs(radial - bestRadial) <= 1e-9;
    const sameContinuity = Math.abs(continuity - bestContinuity) <= 1e-9;
    const sameLayer = Math.abs(layer - bestLayer) <= 1e-9;
    const better = exact > bestExact
      || (sameExact && radial > bestRadial + 1e-9)
      || (sameExact && sameRadial && continuity > bestContinuity + 1e-9)
      || (sameExact && sameRadial && sameContinuity && layer > bestLayer + 1e-9)
      || (sameExact && sameRadial && sameContinuity && sameLayer && gap > bestGap + 1e-9)
      || (sameExact && sameRadial && sameContinuity && sameLayer && Math.abs(gap - bestGap) <= 1e-9 && key < bestKey);
    if (!better) continue;
    best = candidate;
    bestExact = exact;
    bestRadial = radial;
    bestContinuity = continuity;
    bestLayer = layer;
    bestGap = gap;
    bestKey = key;
  }
  return best;
}

function nearestFreeSlot(
  node: UniformLayoutNode,
  parentId: string,
  parentCoord: FccCoord,
  preserveContinuity: boolean,
  previousStep: FccCoord | null,
  occupied: ReadonlySet<string>,
  adjacency: ReadonlyMap<string, string[]>,
  assigned: ReadonlyMap<string, FccCoord>,
  directed: DirectedIndex,
): FccCoord {
  const exact = FCC_NEIGHBOR_STEPS
    .map(step => addCoord(parentCoord, step))
    .filter(coord => validFreeSlot(coord, occupied));
  if (exact.length > 0) {
    return chooseCandidate(exact, node, parentId, parentCoord, preserveContinuity, previousStep, occupied, adjacency, assigned, directed);
  }

  // Only after every legal exact-x neighbour is unavailable may a direct edge grow longer.
  const visited = new Set<string>([coordKey(parentCoord)]);
  let frontier: FccCoord[] = [parentCoord];
  for (let depth = 1; ; depth++) {
    const nextByKey = new Map<string, FccCoord>();
    for (const coord of frontier) {
      for (const step of FCC_NEIGHBOR_STEPS) {
        const next = addCoord(coord, step);
        const key = coordKey(next);
        if (visited.has(key)) continue;
        visited.add(key);
        nextByKey.set(key, next);
      }
    }
    const next = [...nextByKey.values()];
    if (depth > 1) {
      const free = next.filter(coord => validFreeSlot(coord, occupied));
      if (free.length > 0) {
        let minimumDistanceSq = Number.POSITIVE_INFINITY;
        for (const candidate of free) {
          minimumDistanceSq = Math.min(minimumDistanceSq, coordLengthSq(subtractCoord(candidate, parentCoord)));
        }
        const closest = free.filter(candidate => coordLengthSq(subtractCoord(candidate, parentCoord)) === minimumDistanceSq);
        return chooseCandidate(closest, node, parentId, parentCoord, preserveContinuity, previousStep, occupied, adjacency, assigned, directed);
      }
    }
    frontier = next;
  }
}

function assign(
  id: string,
  coord: FccCoord,
  assigned: Map<string, FccCoord>,
  occupied: Set<string>,
): void {
  assigned.set(id, coord);
  occupied.add(coordKey(coord));
}

function placeGraphNodes(nodes: readonly UniformLayoutNode[]): Map<string, FccCoord> {
  const byId = new Map(nodes.map(node => [node.id, node] as const));
  const edges = collectDirectLayoutEdges(nodes);
  const adjacency = buildAdjacency(nodes, edges);
  const directed = buildDirectedIndex(nodes, edges);
  const components = connectedComponents(adjacency);
  const assigned = new Map<string, FccCoord>();
  const occupied = new Set<string>();

  for (const component of components) {
    const rawSpine = approximateDiameterPath(component, adjacency);
    const spine = orientSpine(rawSpine, directed, byId);
    const spineIndex = new Map(spine.map((id, index) => [id, index] as const));
    const schedule = scheduleComponent(component, spine, adjacency, directed, byId);
    const rootId = schedule.order[0];
    const rootNode = rootId ? byId.get(rootId) : undefined;
    if (!rootId || !rootNode) continue;
    assign(rootId, rootSlot(rootNode, occupied, assigned), assigned, occupied);

    for (const id of schedule.order.slice(1)) {
      const node = byId.get(id);
      const parentId = schedule.parentById.get(id);
      const parentCoord = parentId ? assigned.get(parentId) : undefined;
      if (!node) continue;
      if (!parentId || !parentCoord) {
        assign(id, rootSlot(node, occupied, assigned), assigned, occupied);
        continue;
      }

      const parentIndex = spineIndex.get(parentId);
      const childIndex = spineIndex.get(id);
      const isSpine = parentIndex !== undefined
        && childIndex !== undefined
        && childIndex === parentIndex + 1;
      let previousStep: FccCoord | null = null;
      let preserveContinuity = false;

      if (isSpine && childIndex !== undefined && childIndex >= 2) {
        const previousCoord = assigned.get(spine[childIndex - 2]);
        if (previousCoord) {
          previousStep = subtractCoord(parentCoord, previousCoord);
          preserveContinuity = true;
        }
      }

      if (!previousStep && (adjacency.get(parentId)?.length ?? 0) === 2) {
        const otherId = (adjacency.get(parentId) ?? []).find(neighbourId => neighbourId !== id && assigned.has(neighbourId));
        const otherCoord = otherId ? assigned.get(otherId) : undefined;
        if (otherCoord) {
          previousStep = subtractCoord(parentCoord, otherCoord);
          preserveContinuity = true;
        }
      }

      const coord = nearestFreeSlot(node, parentId, parentCoord, preserveContinuity, previousStep, occupied, adjacency, assigned, directed);
      assign(id, coord, assigned, occupied);
    }
  }
  return assigned;
}

/**
 * One live layout algorithm with lexicographic constraints:
 * 1) keep direct real graph neighbours at x=72 whenever a legal exact FCC slot exists;
 * 2) choose the conclusion side first (purple, then blue, then cyan on direction ties);
 * 3) walking toward premises, prefer exact-x slots that move toward the centre;
 * 4) use colour layers only as soft approximate radii, never hard shells;
 * 5) use continuity and gap filling only after those rules.
 */
export function applyUniformLayerLayout<T extends UniformLayoutNode>(nodes: T[]): T[] {
  const coords = placeGraphNodes(nodes);

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

    const coord = coords.get(node.id);
    if (!coord) throw new Error(`Missing FCC slot for layout node ${node.id}`);
    const position = fccPositionForCoord(coord);
    node.pos = position.clone();
    node.homePos = position.clone();
    node.vel ??= new THREE.Vector3();
    node.vel.set(0, 0, 0);
  }
  return nodes;
}
