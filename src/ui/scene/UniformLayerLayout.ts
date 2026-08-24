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
  lineage?: {
    reasoningSide?: 'normal' | 'opposition';
    reasoningSideRank?: number;
    reasoningDominant?: boolean;
    targetId?: string;
  };
  pos?: THREE.Vector3;
  vel?: THREE.Vector3;
  homePos?: THREE.Vector3;
  hidden?: boolean;
}

type NonCoreLayer = Exclude<KnowledgeLayer, 'core'>;
export type FccCoord = [number, number, number];

/**
 * Ordinary knowledge-node centres prefer exactly this distance from a related
 * ordinary neighbour. The value is intentionally a single visual-layout
 * constant so it can be tuned later without changing graph semantics.
 */
export const FCC_NEIGHBOR_DISTANCE = 5;
const FCC_SCALE = FCC_NEIGHBOR_DISTANCE / Math.SQRT2;
export const CORE_LAYOUT_CLEARANCE_RADIUS = CORE_SUN_RADIUS + 2 * FCC_NEIGHBOR_DISTANCE;
const MAX_FCC_SEARCH_DEPTH = 6;
const POSITION_EPSILON_SQ = 1e-12;

/** Every FCC step below has Euclidean length sqrt(2), therefore x after scaling. */
export const FCC_NEIGHBOR_STEPS: readonly FccCoord[] = Object.freeze([
  [1, 1, 0], [1, -1, 0], [-1, 1, 0], [-1, -1, 0],
  [1, 0, 1], [1, 0, -1], [-1, 0, 1], [-1, 0, -1],
  [0, 1, 1], [0, 1, -1], [0, -1, 1], [0, -1, -1],
] as FccCoord[]);

const LAYER_RANK: Record<NonCoreLayer, number> = {
  inner: 0,
  middle: 1,
  outer: 2,
};

// Projection-only cache: public graph truth never depends on these slots. Keeping
// surviving IDs here makes ordinary additions incremental during one page session.
const ordinarySlotCache = new Map<string, FccCoord>();

function layerOf(node: UniformLayoutNode): KnowledgeLayer {
  const layer = node.effectiveLayer
    ?? node.layer
    ?? (isSystemCoreNodeId(node.id) ? 'core' : undefined);
  if (!layer) throw new Error(`Missing effective layer for layout node ${node.id}`);
  return layer;
}

function isReasoningNode(node: UniformLayoutNode): boolean {
  return node.type === 'reasoning';
}

function isOrdinaryNode(node: UniformLayoutNode): boolean {
  return layerOf(node) !== 'core' && !isReasoningNode(node);
}

function coordKey(coord: FccCoord): string {
  return `${coord[0]}|${coord[1]}|${coord[2]}`;
}

function addCoord(a: FccCoord, b: FccCoord): FccCoord {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scaleCoord(coord: FccCoord, scalar: number): FccCoord {
  return [coord[0] * scalar, coord[1] * scalar, coord[2] * scalar];
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

function hash01(input: string, salt: number): number {
  let h = (2166136261 ^ salt) >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

function directionDot(a: FccCoord, b: FccCoord): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function rootCoordForNode(node: UniformLayoutNode, occupied: ReadonlySet<string>): FccCoord {
  const layer = layerOf(node);
  if (layer === 'core') return [0, 0, 0];

  const primaryIndex = Math.floor(hash01(node.id, 17) * FCC_NEIGHBOR_STEPS.length) % FCC_NEIGHBOR_STEPS.length;
  const primary = FCC_NEIGHBOR_STEPS[primaryIndex];
  const secondaryPool = FCC_NEIGHBOR_STEPS.filter(step => directionDot(primary, step) > -2);
  const secondaryIndex = Math.floor(hash01(node.id, 31) * secondaryPool.length) % secondaryPool.length;
  const secondary = secondaryPool[secondaryIndex];
  const lateralSteps = Math.floor(hash01(node.id, 47) * 3);
  const radialSteps = Math.ceil(CORE_LAYOUT_CLEARANCE_RADIUS / FCC_NEIGHBOR_DISTANCE) + LAYER_RANK[layer] * 2;

  let coord = addCoord(scaleCoord(primary, radialSteps), scaleCoord(secondary, lateralSteps));
  while (fccPositionForCoord(coord).length() < CORE_LAYOUT_CLEARANCE_RADIUS || occupied.has(coordKey(coord))) {
    coord = addCoord(coord, primary);
  }
  return coord;
}

export function fallbackFccRootPosition(id: string, layer: NonCoreLayer): THREE.Vector3 {
  return fccPositionForCoord(rootCoordForNode({ id, effectiveLayer: layer }, new Set()));
}

export interface FccLayoutEdge {
  fromId: string;
  toId: string;
}

function ordinarySourcesFor(
  id: string,
  byId: ReadonlyMap<string, UniformLayoutNode>,
  visiting: Set<string>,
): string[] {
  const node = byId.get(id);
  if (!node || layerOf(node) === 'core') return [];
  if (!isReasoningNode(node)) return [id];
  if (visiting.has(id)) return [];
  visiting.add(id);
  const result = new Set<string>();
  for (const premiseId of node.premises ?? []) {
    for (const sourceId of ordinarySourcesFor(premiseId, byId, visiting)) result.add(sourceId);
  }
  visiting.delete(id);
  return [...result];
}

/**
 * Reasoning balls are real graph nodes but do not consume ordinary FCC slots.
 * For spatial growth only, a premise -> reasoning -> conclusion path is
 * contracted to the two ordinary endpoints.
 */
export function collectFccOrdinaryEdges(nodes: UniformLayoutNode[]): FccLayoutEdge[] {
  const byId = new Map(nodes.map(node => [node.id, node] as const));
  const seen = new Set<string>();
  const edges: FccLayoutEdge[] = [];

  for (const target of nodes) {
    if (!isOrdinaryNode(target)) continue;
    for (const premiseId of target.premises ?? []) {
      for (const sourceId of ordinarySourcesFor(premiseId, byId, new Set())) {
        if (sourceId === target.id || !byId.has(sourceId)) continue;
        const key = `${sourceId}->${target.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ fromId: sourceId, toId: target.id });
      }
    }
  }

  return edges;
}

function buildOrdinaryAdjacency(
  nodes: readonly UniformLayoutNode[],
  edges: readonly FccLayoutEdge[],
): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) if (isOrdinaryNode(node)) adjacency.set(node.id, []);
  for (const edge of edges) {
    adjacency.get(edge.fromId)?.push(edge.toId);
    adjacency.get(edge.toId)?.push(edge.fromId);
  }
  for (const neighbours of adjacency.values()) neighbours.sort();
  return adjacency;
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

type ComponentSchedule = {
  order: string[];
  parentById: Map<string, string>;
};

function scheduleFreshComponent(
  component: readonly string[],
  diameterPath: readonly string[],
  adjacency: ReadonlyMap<string, string[]>,
): ComponentSchedule {
  const allowed = new Set(component);
  const scheduled = new Set<string>();
  const parentById = new Map<string, string>();
  const order: string[] = [];
  const queue: string[] = [];

  diameterPath.forEach((id, index) => {
    if (scheduled.has(id)) return;
    scheduled.add(id);
    order.push(id);
    queue.push(id);
    if (index > 0) parentById.set(id, diameterPath[index - 1]);
  });

  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
    for (const neighbourId of adjacency.get(id) ?? []) {
      if (!allowed.has(neighbourId) || scheduled.has(neighbourId)) continue;
      scheduled.add(neighbourId);
      parentById.set(neighbourId, id);
      order.push(neighbourId);
      queue.push(neighbourId);
    }
  }

  return { order, parentById };
}

function previousDirection(
  parentId: string,
  childId: string,
  diameterPath: readonly string[],
  adjacency: ReadonlyMap<string, string[]>,
  assigned: ReadonlyMap<string, FccCoord>,
): THREE.Vector3 | null {
  const parentCoord = assigned.get(parentId);
  if (!parentCoord) return null;
  const parentIndex = diameterPath.indexOf(parentId);
  const childIndex = diameterPath.indexOf(childId);

  if (parentIndex >= 0 && childIndex >= 0 && Math.abs(parentIndex - childIndex) === 1) {
    const oppositeIndex = parentIndex + (parentIndex < childIndex ? -1 : 1);
    if (oppositeIndex >= 0 && oppositeIndex < diameterPath.length) {
      const oppositeCoord = assigned.get(diameterPath[oppositeIndex]);
      if (oppositeCoord) {
        return fccPositionForCoord(parentCoord).sub(fccPositionForCoord(oppositeCoord));
      }
    }
  }

  for (const neighbourId of adjacency.get(parentId) ?? []) {
    if (neighbourId === childId) continue;
    const neighbourCoord = assigned.get(neighbourId);
    if (!neighbourCoord) continue;
    return fccPositionForCoord(parentCoord).sub(fccPositionForCoord(neighbourCoord));
  }
  return null;
}

function candidateDirectionScore(
  node: UniformLayoutNode,
  parent: UniformLayoutNode,
  parentCoord: FccCoord,
  candidateCoord: FccCoord,
  isSpine: boolean,
  previous: THREE.Vector3 | null,
  adjacency: ReadonlyMap<string, string[]>,
  assigned: ReadonlyMap<string, FccCoord>,
): number {
  const parentPosition = fccPositionForCoord(parentCoord);
  const candidatePosition = fccPositionForCoord(candidateCoord);
  const step = candidatePosition.clone().sub(parentPosition).normalize();
  const radial = parentPosition.lengthSq() > POSITION_EPSILON_SQ
    ? parentPosition.clone().normalize()
    : new THREE.Vector3(0, 0, 1);
  const previousUnit = previous && previous.lengthSq() > POSITION_EPSILON_SQ
    ? previous.clone().normalize()
    : null;
  const continuity = previousUnit ? step.dot(previousUnit) : 0;

  const nodeLayer = layerOf(node) as NonCoreLayer;
  const parentLayer = layerOf(parent) as NonCoreLayer;
  const layerDelta = LAYER_RANK[nodeLayer] - LAYER_RANK[parentLayer];
  const radialDot = step.dot(radial);
  const layerScore = layerDelta > 0
    ? radialDot
    : layerDelta < 0
      ? -radialDot
      : previousUnit
        ? continuity
        : -Math.abs(radialDot);

  let maxNeighbourAlignment = -1;
  let neighbourCount = 0;
  for (const neighbourId of adjacency.get(parent.id) ?? []) {
    if (neighbourId === node.id) continue;
    const neighbourCoord = assigned.get(neighbourId);
    if (!neighbourCoord) continue;
    const direction = fccPositionForCoord(neighbourCoord).sub(parentPosition).normalize();
    maxNeighbourAlignment = Math.max(maxNeighbourAlignment, step.dot(direction));
    neighbourCount++;
  }
  const spreadScore = neighbourCount > 0 ? -maxNeighbourAlignment : 0;

  if (isSpine) return continuity * 1000 + layerScore * 100 + spreadScore * 10;
  if (layerDelta !== 0) return layerScore * 1000 + spreadScore * 100 + continuity * 10;
  return continuity * 300 + spreadScore * 100 - Math.abs(radialDot) * 10;
}

function chooseBestCandidate(
  candidates: readonly FccCoord[],
  node: UniformLayoutNode,
  parent: UniformLayoutNode,
  parentCoord: FccCoord,
  isSpine: boolean,
  previous: THREE.Vector3 | null,
  adjacency: ReadonlyMap<string, string[]>,
  assigned: ReadonlyMap<string, FccCoord>,
): FccCoord {
  let best = candidates[0];
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestKey = coordKey(best);

  for (const candidate of candidates) {
    const score = candidateDirectionScore(
      node,
      parent,
      parentCoord,
      candidate,
      isSpine,
      previous,
      adjacency,
      assigned,
    );
    const key = coordKey(candidate);
    if (score > bestScore + 1e-9 || (Math.abs(score - bestScore) <= 1e-9 && key < bestKey)) {
      best = candidate;
      bestScore = score;
      bestKey = key;
    }
  }
  return best;
}

function validFreeOrdinarySlot(coord: FccCoord, occupied: ReadonlySet<string>): boolean {
  return !occupied.has(coordKey(coord))
    && fccPositionForCoord(coord).length() >= CORE_LAYOUT_CLEARANCE_RADIUS;
}

function nearestFreeSlot(
  node: UniformLayoutNode,
  parent: UniformLayoutNode,
  parentCoord: FccCoord,
  isSpine: boolean,
  previous: THREE.Vector3 | null,
  occupied: ReadonlySet<string>,
  adjacency: ReadonlyMap<string, string[]>,
  assigned: ReadonlyMap<string, FccCoord>,
): FccCoord {
  const nearest = FCC_NEIGHBOR_STEPS
    .map(step => addCoord(parentCoord, step))
    .filter(coord => validFreeOrdinarySlot(coord, occupied));

  if (nearest.length > 0) {
    return chooseBestCandidate(nearest, node, parent, parentCoord, isSpine, previous, adjacency, assigned);
  }

  // Only after every exact-x neighbour is unavailable may an edge grow longer.
  const visited = new Set<string>([coordKey(parentCoord)]);
  let frontier: FccCoord[] = [parentCoord];
  const parentPosition = fccPositionForCoord(parentCoord);

  for (let depth = 1; depth <= MAX_FCC_SEARCH_DEPTH; depth++) {
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
      const free = next.filter(coord => validFreeOrdinarySlot(coord, occupied));
      if (free.length > 0) {
        let minDistanceSq = Number.POSITIVE_INFINITY;
        for (const coord of free) {
          minDistanceSq = Math.min(minDistanceSq, parentPosition.distanceToSquared(fccPositionForCoord(coord)));
        }
        const closest = free.filter(coord => Math.abs(
          parentPosition.distanceToSquared(fccPositionForCoord(coord)) - minDistanceSq,
        ) <= 1e-9);
        return chooseBestCandidate(closest, node, parent, parentCoord, isSpine, previous, adjacency, assigned);
      }
    }
    frontier = next;
  }

  // Finite safety fallback. It still stays on the FCC lattice and therefore
  // preserves the ordinary-node >= x separation invariant.
  const outward = FCC_NEIGHBOR_STEPS[Math.floor(hash01(node.id, 73) * FCC_NEIGHBOR_STEPS.length) % FCC_NEIGHBOR_STEPS.length];
  let fallback = addCoord(parentCoord, scaleCoord(outward, MAX_FCC_SEARCH_DEPTH + 1));
  while (!validFreeOrdinarySlot(fallback, occupied)) fallback = addCoord(fallback, outward);
  return fallback;
}

function assignOrdinaryCoord(
  id: string,
  coord: FccCoord,
  assigned: Map<string, FccCoord>,
  occupied: Set<string>,
): void {
  assigned.set(id, coord);
  occupied.add(coordKey(coord));
  ordinarySlotCache.set(id, coord);
}

function placeOrdinaryNodes(nodes: UniformLayoutNode[]): Map<string, FccCoord> {
  const byId = new Map(nodes.map(node => [node.id, node] as const));
  const ordinaryIds = new Set(nodes.filter(isOrdinaryNode).map(node => node.id));
  for (const id of [...ordinarySlotCache.keys()]) {
    if (!ordinaryIds.has(id)) ordinarySlotCache.delete(id);
  }

  const assigned = new Map<string, FccCoord>();
  const occupied = new Set<string>();
  for (const id of ordinaryIds) {
    const cached = ordinarySlotCache.get(id);
    if (!cached) continue;
    assigned.set(id, cached);
    occupied.add(coordKey(cached));
  }

  const edges = collectFccOrdinaryEdges(nodes);
  const adjacency = buildOrdinaryAdjacency(nodes, edges);
  const components = connectedComponents(adjacency);

  for (const component of components) {
    const diameterPath = approximateDiameterPath(component, adjacency);
    const spineIndex = new Map(diameterPath.map((id, index) => [id, index] as const));
    const alreadyPlaced = component.filter(id => assigned.has(id));

    if (alreadyPlaced.length === 0) {
      const schedule = scheduleFreshComponent(component, diameterPath, adjacency);
      const rootId = schedule.order[0];
      const root = byId.get(rootId);
      if (rootId && root) assignOrdinaryCoord(rootId, rootCoordForNode(root, occupied), assigned, occupied);

      for (const id of schedule.order.slice(1)) {
        if (assigned.has(id)) continue;
        const node = byId.get(id);
        const parentId = schedule.parentById.get(id);
        const parent = parentId ? byId.get(parentId) : undefined;
        const parentCoord = parentId ? assigned.get(parentId) : undefined;
        if (!parentId || !node || !parent || !parentCoord) {
          if (node) assignOrdinaryCoord(id, rootCoordForNode(node, occupied), assigned, occupied);
          continue;
        }
        const parentIndex = spineIndex.get(parentId);
        const childIndex = spineIndex.get(id);
        const isSpine = parentIndex !== undefined && childIndex !== undefined && Math.abs(parentIndex - childIndex) === 1;
        const previous = previousDirection(parentId, id, diameterPath, adjacency, assigned);
        const coord = nearestFreeSlot(node, parent, parentCoord, isSpine, previous, occupied, adjacency, assigned);
        assignOrdinaryCoord(id, coord, assigned, occupied);
      }
      continue;
    }

    const pending = new Set(component.filter(id => !assigned.has(id)));
    while (pending.size > 0) {
      let progressed = false;
      for (const id of [...pending].sort()) {
        const node = byId.get(id);
        if (!node) {
          pending.delete(id);
          progressed = true;
          continue;
        }
        const assignedNeighbours = (adjacency.get(id) ?? []).filter(neighbourId => assigned.has(neighbourId));
        if (assignedNeighbours.length === 0) continue;

        assignedNeighbours.sort((a, b) => {
          const aSpine = spineIndex.has(a) && spineIndex.has(id) && Math.abs(spineIndex.get(a)! - spineIndex.get(id)!) === 1;
          const bSpine = spineIndex.has(b) && spineIndex.has(id) && Math.abs(spineIndex.get(b)! - spineIndex.get(id)!) === 1;
          if (aSpine !== bSpine) return aSpine ? -1 : 1;
          return a.localeCompare(b);
        });
        const parentId = assignedNeighbours[0];
        if (!parentId) continue;
        const parent = byId.get(parentId)!;
        const parentCoord = assigned.get(parentId)!;
        const isSpine = spineIndex.has(parentId) && spineIndex.has(id) && Math.abs(spineIndex.get(parentId)! - spineIndex.get(id)!) === 1;
        const previous = previousDirection(parentId, id, diameterPath, adjacency, assigned);
        const coord = nearestFreeSlot(node, parent, parentCoord, isSpine, previous, occupied, adjacency, assigned);
        assignOrdinaryCoord(id, coord, assigned, occupied);
        pending.delete(id);
        progressed = true;
      }

      if (progressed) continue;
      const id = [...pending].sort()[0];
      if (!id) break;
      const node = byId.get(id);
      if (node) assignOrdinaryCoord(id, rootCoordForNode(node, occupied), assigned, occupied);
      pending.delete(id);
    }
  }

  return assigned;
}

function buildFullAdjacency(nodes: readonly UniformLayoutNode[]): Map<string, string[]> {
  const ids = new Set(nodes.map(node => node.id));
  const adjacency = new Map(nodes.map(node => [node.id, [] as string[]] as const));
  for (const node of nodes) {
    for (const premiseId of node.premises ?? []) {
      if (!ids.has(premiseId) || premiseId === node.id) continue;
      adjacency.get(premiseId)?.push(node.id);
      adjacency.get(node.id)?.push(premiseId);
    }
  }
  return adjacency;
}

function reasoningPerpendicular(axis: THREE.Vector3, id: string): THREE.Vector3 {
  const unit = axis.lengthSq() > POSITION_EPSILON_SQ
    ? axis.clone().normalize()
    : new THREE.Vector3(0, 0, 1);
  const reference = Math.abs(unit.z) < 0.8
    ? new THREE.Vector3(0, 0, 1)
    : new THREE.Vector3(0, 1, 0);
  const perpendicular = unit.clone().cross(reference).normalize();
  if (hash01(id, 89) < 0.5) perpendicular.multiplyScalar(-1);
  return perpendicular;
}

function placeReasoningNodes(nodes: UniformLayoutNode[]): void {
  const byId = new Map(nodes.map(node => [node.id, node] as const));
  const adjacency = buildFullAdjacency(nodes);

  for (const node of nodes) {
    if (!isReasoningNode(node) || layerOf(node) === 'core') continue;
    const ordinaryNeighbours = (adjacency.get(node.id) ?? [])
      .map(id => byId.get(id))
      .filter((item): item is UniformLayoutNode => Boolean(item && !isReasoningNode(item) && layerOf(item) !== 'core' && item.pos));

    let position: THREE.Vector3;
    let axis = new THREE.Vector3(0, 0, 1);
    if (ordinaryNeighbours.length >= 2) {
      position = ordinaryNeighbours
        .reduce((sum, neighbour) => sum.add(neighbour.pos!), new THREE.Vector3())
        .multiplyScalar(1 / ordinaryNeighbours.length);
      axis = ordinaryNeighbours[ordinaryNeighbours.length - 1].pos!.clone().sub(ordinaryNeighbours[0].pos!);
    } else if (ordinaryNeighbours.length === 1) {
      const anchor = ordinaryNeighbours[0].pos!;
      const outward = anchor.lengthSq() > POSITION_EPSILON_SQ
        ? anchor.clone().normalize()
        : new THREE.Vector3(0, 0, 1);
      position = anchor.clone().addScaledVector(outward, FCC_NEIGHBOR_DISTANCE / 2);
      axis = outward;
    } else {
      const target = node.lineage?.targetId ? byId.get(node.lineage.targetId) : undefined;
      if (target?.pos) {
        position = target.pos.clone();
        axis = target.pos.clone();
      } else {
        const layer = layerOf(node) as NonCoreLayer;
        position = fallbackFccRootPosition(node.id, layer);
        axis = position.clone();
      }
    }

    const side = node.lineage?.reasoningSide;
    if (side) {
      const sideRank = Math.max(0, node.lineage?.reasoningSideRank ?? 0);
      const dominant = node.lineage?.reasoningDominant === true;
      if (!dominant) {
        const offset = FCC_NEIGHBOR_DISTANCE * (0.5 + sideRank * 0.5);
        const sign = side === 'opposition' ? 1 : -1;
        position.addScaledVector(reasoningPerpendicular(axis, node.id), sign * offset);
      }
    }

    node.pos = position.clone();
    node.homePos = position.clone();
    node.vel ??= new THREE.Vector3();
    node.vel.set(0, 0, 0);
  }
}

export function resetUniformLayoutCacheForTests(): void {
  ordinarySlotCache.clear();
}

/**
 * Legacy entry-point name retained so the app wiring stays narrow. The actual
 * projection is now an incrementally stable FCC knowledge tree: ordinary balls
 * occupy FCC slots, related ordinary neighbours prefer x=5, reasoning balls do
 * not consume ordinary slots, long component spines prefer straight growth, and
 * layer changes bias branch direction rather than impose hard shells.
 */
export function applyUniformLayerLayout<T extends UniformLayoutNode>(nodes: T[]): T[] {
  const ordinaryCoords = placeOrdinaryNodes(nodes);

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
    if (isReasoningNode(node)) continue;

    const coord = ordinaryCoords.get(node.id);
    if (!coord) throw new Error(`Missing FCC slot for ordinary layout node ${node.id}`);
    const position = fccPositionForCoord(coord);
    node.pos = position.clone();
    node.homePos = position.clone();
    node.vel ??= new THREE.Vector3();
    node.vel.set(0, 0, 0);
  }

  placeReasoningNodes(nodes);
  return nodes;
}
