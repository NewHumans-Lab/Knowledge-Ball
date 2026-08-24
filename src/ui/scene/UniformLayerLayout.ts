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

/** The live ordinary ball radius in KnowledgeScene, in Three.js world units. */
export const ORDINARY_NODE_RADIUS = 7.2;
export const ORDINARY_NODE_DIAMETER = ORDINARY_NODE_RADIUS * 2;
/** Direct graph neighbours prefer five ordinary-ball diameters centre-to-centre. */
export const FCC_NEIGHBOR_DISTANCE = ORDINARY_NODE_DIAMETER * 5;
const FCC_SCALE = FCC_NEIGHBOR_DISTANCE / Math.SQRT2;
/** The Sun only owns its physical centre space; no extra semantic shell is reserved. */
export const CORE_LAYOUT_CLEARANCE_RADIUS = CORE_SUN_RADIUS + ORDINARY_NODE_RADIUS;
const POSITION_EPSILON_SQ = 1e-12;

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
 * Layout uses only real direct premise edges. Reasoning balls are real nodes here,
 * so premise -> reasoning -> conclusion is two real one-x edges. No lineage,
 * colour layer, semantic similarity, or reasoning-camp metadata affects placement.
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

/** Cheap main-chain estimate; it only controls straightness, never node proximity. */
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
  spineCenterIndex: number;
};

/**
 * Start a long spine at its middle and grow toward both ends. This is purely a
 * geometric compactness rule: it halves one-sided extent without changing x.
 */
function scheduleComponent(
  component: readonly string[],
  spine: readonly string[],
  adjacency: ReadonlyMap<string, string[]>,
): ComponentSchedule {
  const allowed = new Set(component);
  const scheduled = new Set<string>();
  const parentById = new Map<string, string>();
  const order: string[] = [];
  const queue: string[] = [];
  const spineCenterIndex = Math.floor((spine.length - 1) / 2);

  const scheduleSpineNode = (index: number, parentIndex?: number) => {
    const id = spine[index];
    if (!id || scheduled.has(id)) return;
    scheduled.add(id);
    order.push(id);
    queue.push(id);
    if (parentIndex !== undefined) parentById.set(id, spine[parentIndex]);
  };

  if (spine.length > 0) {
    scheduleSpineNode(spineCenterIndex);
    for (let offset = 1; offset < spine.length; offset++) {
      const right = spineCenterIndex + offset;
      const left = spineCenterIndex - offset;
      if (right < spine.length) scheduleSpineNode(right, right - 1);
      if (left >= 0) scheduleSpineNode(left, left + 1);
    }
  }

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
  return { order, parentById, spineCenterIndex };
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

/**
 * Disconnected roots fill the nearest available lattice shell first. Within that
 * shell, the largest empty geometric gap wins. This keeps the cloud compact and
 * even without any semantic-region heuristic.
 */
function rootSlot(
  occupied: ReadonlySet<string>,
  assigned: ReadonlyMap<string, FccCoord>,
): FccCoord {
  const visited = new Set<string>([coordKey([0, 0, 0])]);
  let frontier: FccCoord[] = [[0, 0, 0]];

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
    const next = [...nextByKey.values()];
    const free = next.filter(coord => validFreeSlot(coord, occupied));
    if (free.length > 0) {
      let best = free[0];
      let bestGap = minimumDistanceSqToAssigned(best, assigned);
      let bestKey = coordKey(best);
      for (const candidate of free.slice(1)) {
        const gap = minimumDistanceSqToAssigned(candidate, assigned);
        const key = coordKey(candidate);
        if (gap > bestGap || (gap === bestGap && key < bestKey)) {
          best = candidate;
          bestGap = gap;
          bestKey = key;
        }
      }
      return best;
    }
    frontier = next;
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

/** Choose the FCC direction most tangent to the centre, keeping both spine halves compact. */
function tangentStepAt(coord: FccCoord): FccCoord {
  let best = FCC_NEIGHBOR_STEPS[0];
  let bestRadial = Math.abs(directionDot(coord, best));
  let bestKey = coordKey(best);
  for (const step of FCC_NEIGHBOR_STEPS.slice(1)) {
    const radial = Math.abs(directionDot(coord, step));
    const key = coordKey(step);
    if (radial < bestRadial || (radial === bestRadial && key < bestKey)) {
      best = step;
      bestRadial = radial;
      bestKey = key;
    }
  }
  return best;
}

function chooseCandidate(
  candidates: readonly FccCoord[],
  id: string,
  parentCoord: FccCoord,
  isSpine: boolean,
  previousStep: FccCoord | null,
  occupied: ReadonlySet<string>,
  adjacency: ReadonlyMap<string, string[]>,
  assigned: ReadonlyMap<string, FccCoord>,
): FccCoord {
  let best = candidates[0];
  let bestExact = -1;
  let bestContinuity = Number.NEGATIVE_INFINITY;
  let bestGap = Number.NEGATIVE_INFINITY;
  let bestKey = coordKey(best);

  for (const candidate of candidates) {
    const exact = exactAssignedNeighbourCount(id, candidate, adjacency, assigned);
    const continuity = isSpine ? continuityScore(candidate, parentCoord, previousStep) : 0;
    const gap = gapScore(parentCoord, candidate, occupied);
    const key = coordKey(candidate);
    const better = exact > bestExact
      || (exact === bestExact && continuity > bestContinuity + 1e-9)
      || (exact === bestExact && Math.abs(continuity - bestContinuity) <= 1e-9 && gap > bestGap + 1e-9)
      || (exact === bestExact && Math.abs(continuity - bestContinuity) <= 1e-9 && Math.abs(gap - bestGap) <= 1e-9 && key < bestKey);
    if (!better) continue;
    best = candidate;
    bestExact = exact;
    bestContinuity = continuity;
    bestGap = gap;
    bestKey = key;
  }
  return best;
}

function nearestFreeSlot(
  id: string,
  parentCoord: FccCoord,
  isSpine: boolean,
  previousStep: FccCoord | null,
  occupied: ReadonlySet<string>,
  adjacency: ReadonlyMap<string, string[]>,
  assigned: ReadonlyMap<string, FccCoord>,
): FccCoord {
  const exact = FCC_NEIGHBOR_STEPS
    .map(step => addCoord(parentCoord, step))
    .filter(coord => validFreeSlot(coord, occupied));
  if (exact.length > 0) {
    return chooseCandidate(exact, id, parentCoord, isSpine, previousStep, occupied, adjacency, assigned);
  }

  // Only after every exact-x neighbour is occupied may a direct edge grow longer.
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
        return chooseCandidate(closest, id, parentCoord, isSpine, previousStep, occupied, adjacency, assigned);
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
  const edges = collectDirectLayoutEdges(nodes);
  const adjacency = buildAdjacency(nodes, edges);
  const components = connectedComponents(adjacency);
  const assigned = new Map<string, FccCoord>();
  const occupied = new Set<string>();

  for (const component of components) {
    const spine = approximateDiameterPath(component, adjacency);
    const spineIndex = new Map(spine.map((id, index) => [id, index] as const));
    const schedule = scheduleComponent(component, spine, adjacency);
    const rootId = schedule.order[0];
    if (!rootId) continue;
    assign(rootId, rootSlot(occupied, assigned), assigned, occupied);

    for (const id of schedule.order.slice(1)) {
      const parentId = schedule.parentById.get(id);
      const parentCoord = parentId ? assigned.get(parentId) : undefined;
      if (!parentId || !parentCoord) {
        assign(id, rootSlot(occupied, assigned), assigned, occupied);
        continue;
      }

      const parentIndex = spineIndex.get(parentId);
      const childIndex = spineIndex.get(id);
      const isSpine = parentIndex !== undefined
        && childIndex !== undefined
        && Math.abs(childIndex - parentIndex) === 1;
      let previousStep: FccCoord | null = null;

      if (isSpine && parentIndex !== undefined && childIndex !== undefined) {
        const center = schedule.spineCenterIndex;
        if (parentIndex === center) {
          const siblingIndex = childIndex < center ? center + 1 : center - 1;
          const siblingCoord = siblingIndex >= 0 && siblingIndex < spine.length
            ? assigned.get(spine[siblingIndex])
            : undefined;
          previousStep = siblingCoord
            ? subtractCoord(parentCoord, siblingCoord)
            : tangentStepAt(parentCoord);
        } else {
          const towardCenterIndex = parentIndex < center ? parentIndex + 1 : parentIndex - 1;
          const towardCenterCoord = assigned.get(spine[towardCenterIndex]);
          if (towardCenterCoord) previousStep = subtractCoord(parentCoord, towardCenterCoord);
        }
      }

      const coord = nearestFreeSlot(id, parentCoord, isSpine, previousStep, occupied, adjacency, assigned);
      assign(id, coord, assigned, occupied);
    }
  }
  return assigned;
}

/**
 * One live layout algorithm: direct graph nodes occupy FCC slots at five ordinary
 * ball diameters. Main chains grow from their middle and stay straight when
 * possible; branches fill the largest local geometric gap. No semantic/layer
 * proximity policy participates.
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
