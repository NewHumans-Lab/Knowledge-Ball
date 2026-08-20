import * as THREE from 'three';
import type { KnowledgeLayer } from '../../domain/KnowledgeLayerPolicy';
import { isSystemCoreNodeId } from '../../domain/KnowledgeLayerPolicy';
import { LAYER_BANDS } from '../config/KnowledgeUiConfig';
import type { UniformLayoutNode } from './UniformLayerLayout';

type NonCoreLayer = Exclude<KnowledgeLayer, 'core'>;

export interface RelationLayoutNode extends UniformLayoutNode {
  premises?: string[];
  logicRuleId?: string;
  twinGroup?: string;
}

export interface RelationLayoutEdge {
  fromId: string;
  toId: string;
  kind: 'premise' | 'logic' | 'twin';
}

export interface RelationLayoutResult {
  before: number;
  after: number;
  edgeCount: number;
  acceptedPasses: number;
}

export interface RelationComponentMorphology {
  nodeCount: number;
  edgeCount: number;
  approximateDiameter: number;
  elongation: number;
  redundancy: number;
  forkRatio: number;
  branchWeight: number;
}

const DEFAULT_PASSES = 4;
const GRID_SCALE = 1.6;
const LOCAL_CELL_RADIUS = 2;
const MAX_BUCKET_SCAN = 16;
const IMPROVEMENT_EPSILON = 1e-6;
const POSITION_EPSILON_SQ = 1e-12;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function layerOf(node: RelationLayoutNode): KnowledgeLayer {
  const layer = node.effectiveLayer
    ?? node.layer
    ?? (isSystemCoreNodeId(node.id) ? 'core' : undefined);
  if (!layer) throw new Error(`Missing effective layer for relation-layout node ${node.id}`);
  return layer;
}

function lineEligible(fromId: string, toId: string): boolean {
  return fromId !== toId
    && !isSystemCoreNodeId(fromId)
    && !isSystemCoreNodeId(toId);
}

export function collectRelationLayoutEdges(nodes: RelationLayoutNode[]): RelationLayoutEdge[] {
  const ids = new Set(nodes.map(node => node.id));
  const seenDirected = new Set<string>();
  const edges: RelationLayoutEdge[] = [];

  for (const node of nodes) {
    const sources = [
      ...(node.premises ?? []).map(id => ({ id, kind: 'premise' as const })),
      ...(node.logicRuleId ? [{ id: node.logicRuleId, kind: 'logic' as const }] : []),
    ];
    for (const source of sources) {
      if (!ids.has(source.id) || !lineEligible(source.id, node.id)) continue;
      const key = `${source.id}->${node.id}`;
      if (seenDirected.has(key)) continue;
      seenDirected.add(key);
      edges.push({ fromId: source.id, toId: node.id, kind: source.kind });
    }
  }

  const twinFirst = new Map<string, string>();
  const seenTwins = new Set<string>();
  for (const node of nodes) {
    if (!node.twinGroup || isSystemCoreNodeId(node.id)) continue;
    const first = twinFirst.get(node.twinGroup);
    if (!first) {
      twinFirst.set(node.twinGroup, node.id);
      continue;
    }
    if (!lineEligible(first, node.id)) continue;
    const pair = first < node.id ? `${first}<->${node.id}` : `${node.id}<->${first}`;
    if (seenTwins.has(pair)) continue;
    seenTwins.add(pair);
    edges.push({ fromId: first, toId: node.id, kind: 'twin' });
  }

  return edges;
}

export function displayedRelationLength(a: THREE.Vector3, b: THREE.Vector3): number {
  const distance = a.distanceTo(b);
  return Number.isFinite(distance) ? distance : Number.POSITIVE_INFINITY;
}

function positionMap(nodes: RelationLayoutNode[]): Map<string, THREE.Vector3> {
  const map = new Map<string, THREE.Vector3>();
  for (const node of nodes) {
    if (!node.pos) throw new Error(`Missing slot position for relation-layout node ${node.id}`);
    map.set(node.id, node.pos);
  }
  return map;
}

function lineLengthFromPositions(
  positions: ReadonlyMap<string, THREE.Vector3>,
  edges: readonly RelationLayoutEdge[],
): number {
  let total = 0;
  for (const edge of edges) {
    const from = positions.get(edge.fromId);
    const to = positions.get(edge.toId);
    if (!from || !to) continue;
    total += displayedRelationLength(from, to);
  }
  return total;
}

export function totalRelationLineLength(
  nodes: RelationLayoutNode[],
  edges = collectRelationLayoutEdges(nodes),
): number {
  return lineLengthFromPositions(positionMap(nodes), edges);
}

function buildAdjacency(
  nodes: RelationLayoutNode[],
  edges: readonly RelationLayoutEdge[],
): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) adjacency.set(node.id, []);
  for (const edge of edges) {
    adjacency.get(edge.fromId)?.push(edge.toId);
    adjacency.get(edge.toId)?.push(edge.fromId);
  }
  return adjacency;
}

type SlotPool = {
  slots: THREE.Vector3[];
  used: boolean[];
  buckets: Map<string, number[]>;
  slotBucketKeys: string[];
  grid: number;
  radius: number;
  fallbackCursor: number;
};

function cellIndex(value: number, radius: number, grid: number): number {
  const normalized = (value + radius) / (2 * radius);
  return Math.max(0, Math.min(grid - 1, Math.floor(normalized * grid)));
}

function cellKey(x: number, y: number, z: number): string {
  return `${x}|${y}|${z}`;
}

function pointCell(point: THREE.Vector3, pool: Pick<SlotPool, 'radius' | 'grid'>): [number, number, number] {
  return [
    cellIndex(point.x, pool.radius, pool.grid),
    cellIndex(point.y, pool.radius, pool.grid),
    cellIndex(point.z, pool.radius, pool.grid),
  ];
}

function makeSlotPool(layer: NonCoreLayer, slots: THREE.Vector3[]): SlotPool {
  const grid = Math.max(2, Math.ceil(Math.cbrt(Math.max(1, slots.length)) * GRID_SCALE));
  const radius = LAYER_BANDS[layer].rMax;
  const buckets = new Map<string, number[]>();
  const slotBucketKeys: string[] = [];

  slots.forEach((slot, index) => {
    const [x, y, z] = pointCell(slot, { radius, grid });
    const key = cellKey(x, y, z);
    slotBucketKeys[index] = key;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(index);
    else buckets.set(key, [index]);
  });

  return {
    slots,
    used: Array(slots.length).fill(false),
    buckets,
    slotBucketKeys,
    grid,
    radius,
    fallbackCursor: 0,
  };
}

function removeSlotFromBucket(pool: SlotPool, slotIndex: number): void {
  const key = pool.slotBucketKeys[slotIndex];
  const bucket = pool.buckets.get(key);
  if (!bucket) return;
  const position = bucket.indexOf(slotIndex);
  if (position < 0) return;
  const last = bucket.pop()!;
  if (position < bucket.length) bucket[position] = last;
  if (bucket.length === 0) pool.buckets.delete(key);
}

function takeNearestLocalSlot(pool: SlotPool, target: THREE.Vector3): number {
  const [cx, cy, cz] = pointCell(target, pool);
  let bestIndex = -1;
  let bestDistanceSq = Number.POSITIVE_INFINITY;

  for (let radius = 0; radius <= LOCAL_CELL_RADIUS; radius++) {
    let foundAtRadius = false;
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dz = -radius; dz <= radius; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== radius) continue;
          const x = cx + dx;
          const y = cy + dy;
          const z = cz + dz;
          if (x < 0 || x >= pool.grid || y < 0 || y >= pool.grid || z < 0 || z >= pool.grid) continue;
          const bucket = pool.buckets.get(cellKey(x, y, z));
          if (!bucket) continue;
          const scan = Math.min(bucket.length, MAX_BUCKET_SCAN);
          for (let i = 0; i < scan; i++) {
            const slotIndex = bucket[i];
            if (pool.used[slotIndex]) continue;
            const distanceSq = pool.slots[slotIndex].distanceToSquared(target);
            if (distanceSq < bestDistanceSq) {
              bestDistanceSq = distanceSq;
              bestIndex = slotIndex;
              foundAtRadius = true;
            }
          }
        }
      }
    }
    if (foundAtRadius) break;
  }

  if (bestIndex >= 0) {
    pool.used[bestIndex] = true;
    removeSlotFromBucket(pool, bestIndex);
    return bestIndex;
  }

  while (pool.fallbackCursor < pool.slots.length && pool.used[pool.fallbackCursor]) {
    pool.fallbackCursor++;
  }
  if (pool.fallbackCursor >= pool.slots.length) throw new Error('Relation-layout slot pool exhausted');
  const fallback = pool.fallbackCursor++;
  pool.used[fallback] = true;
  removeSlotFromBucket(pool, fallback);
  return fallback;
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
  let head = 0;
  let farthest = start;

  while (head < queue.length) {
    const id = queue[head++];
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
  const firstSweep = bfsWithin(component[0], allowed, adjacency);
  const secondSweep = bfsWithin(firstSweep.farthest, allowed, adjacency);
  const path: string[] = [];
  let cursor: string | null | undefined = secondSweep.farthest;

  while (cursor) {
    path.push(cursor);
    if (cursor === firstSweep.farthest) break;
    cursor = secondSweep.parent.get(cursor);
  }

  return path.reverse();
}

export function scoreRelationComponentMorphology(
  nodeCount: number,
  edgeCount: number,
  approximateDiameter: number,
  forkNodeCount: number,
): RelationComponentMorphology {
  const safeNodes = Math.max(0, nodeCount);
  const elongation = safeNodes <= 1
    ? 0
    : clamp01(approximateDiameter / Math.max(1, safeNodes - 1));
  const excessEdges = Math.max(0, edgeCount - Math.max(0, safeNodes - 1));
  const redundancyRaw = safeNodes === 0 ? 0 : excessEdges / safeNodes;
  const redundancy = redundancyRaw / (1 + redundancyRaw);
  const forkRatio = safeNodes === 0 ? 0 : clamp01(forkNodeCount / safeNodes);
  const branchWeight = clamp01(
    0.10
      + 0.90 * elongation
      - 0.55 * redundancy
      - 0.20 * clamp01(forkRatio * 1.5),
  );

  return {
    nodeCount: safeNodes,
    edgeCount: Math.max(0, edgeCount),
    approximateDiameter: Math.max(0, approximateDiameter),
    elongation,
    redundancy,
    forkRatio,
    branchWeight,
  };
}

function morphologyForComponent(
  component: readonly string[],
  diameterPath: readonly string[],
  adjacency: ReadonlyMap<string, string[]>,
): RelationComponentMorphology {
  let degreeTotal = 0;
  let forkNodeCount = 0;
  for (const id of component) {
    const degree = adjacency.get(id)?.length ?? 0;
    degreeTotal += degree;
    if (degree >= 3) forkNodeCount++;
  }
  return scoreRelationComponentMorphology(
    component.length,
    Math.floor(degreeTotal / 2),
    Math.max(0, diameterPath.length - 1),
    forkNodeCount,
  );
}

function connectedComponents(
  nodes: readonly RelationLayoutNode[],
  adjacency: ReadonlyMap<string, string[]>,
): string[][] {
  const nonCoreIds = nodes
    .filter(node => layerOf(node) !== 'core')
    .map(node => node.id);
  const allowed = new Set(nonCoreIds);
  const visited = new Set<string>();
  const components: string[][] = [];

  for (const seed of nonCoreIds) {
    if (visited.has(seed)) continue;
    const component: string[] = [];
    const queue = [seed];
    let head = 0;
    visited.add(seed);

    while (head < queue.length) {
      const id = queue[head++];
      component.push(id);
      for (const neighbourId of adjacency.get(id) ?? []) {
        if (!allowed.has(neighbourId) || visited.has(neighbourId)) continue;
        visited.add(neighbourId);
        queue.push(neighbourId);
      }
    }

    components.push(component);
  }

  return components;
}

type ComponentSchedule = {
  order: string[];
  parentById: Map<string, string>;
  spineIds: Set<string>;
};

function scheduleComponent(
  component: readonly string[],
  diameterPath: readonly string[],
  adjacency: ReadonlyMap<string, string[]>,
): ComponentSchedule {
  const allowed = new Set(component);
  const scheduled = new Set<string>();
  const parentById = new Map<string, string>();
  const spineIds = new Set(diameterPath);
  const order: string[] = [];
  const queue: string[] = [];
  let head = 0;

  diameterPath.forEach((id, index) => {
    if (scheduled.has(id)) return;
    scheduled.add(id);
    order.push(id);
    queue.push(id);
    if (index > 0) parentById.set(id, diameterPath[index - 1]);
  });

  while (head < queue.length) {
    const id = queue[head++];
    for (const neighbourId of adjacency.get(id) ?? []) {
      if (!allowed.has(neighbourId) || scheduled.has(neighbourId)) continue;
      scheduled.add(neighbourId);
      parentById.set(neighbourId, id);
      order.push(neighbourId);
      queue.push(neighbourId);
    }
  }

  for (const id of component) {
    if (scheduled.has(id)) continue;
    scheduled.add(id);
    order.push(id);
  }

  return { order, parentById, spineIds };
}

function assignedNeighbourCentroid(
  id: string,
  adjacency: ReadonlyMap<string, string[]>,
  assigned: ReadonlyMap<string, THREE.Vector3>,
  fallback: THREE.Vector3,
): THREE.Vector3 {
  const target = new THREE.Vector3();
  let count = 0;
  for (const neighbourId of adjacency.get(id) ?? []) {
    const position = assigned.get(neighbourId);
    if (!position) continue;
    target.add(position);
    count++;
  }
  return count > 0 ? target.multiplyScalar(1 / count) : fallback.clone();
}

function branchContinuationTarget(
  id: string,
  parentById: ReadonlyMap<string, string>,
  spineIds: ReadonlySet<string>,
  assigned: ReadonlyMap<string, THREE.Vector3>,
  fallback: THREE.Vector3,
): THREE.Vector3 {
  const parentId = parentById.get(id);
  if (!parentId) return fallback.clone();
  const parentPosition = assigned.get(parentId);
  if (!parentPosition) return fallback.clone();

  if (!spineIds.has(id) && spineIds.has(parentId)) return parentPosition.clone();

  const grandParentId = parentById.get(parentId);
  if (!grandParentId) return parentPosition.clone();
  const grandParentPosition = assigned.get(grandParentId);
  if (!grandParentPosition) return parentPosition.clone();

  const direction = parentPosition.clone().sub(grandParentPosition);
  if (direction.lengthSq() <= POSITION_EPSILON_SQ) return parentPosition.clone();
  return parentPosition.clone().add(direction);
}

function blendedPlacementTarget(
  id: string,
  morphology: RelationComponentMorphology,
  schedule: ComponentSchedule,
  adjacency: ReadonlyMap<string, string[]>,
  assigned: ReadonlyMap<string, THREE.Vector3>,
  fallback: THREE.Vector3,
): THREE.Vector3 {
  const compactTarget = assignedNeighbourCentroid(id, adjacency, assigned, fallback);
  const branchTarget = branchContinuationTarget(
    id,
    schedule.parentById,
    schedule.spineIds,
    assigned,
    fallback,
  );
  const branchWeight = morphology.branchWeight;
  return compactTarget
    .multiplyScalar(1 - branchWeight)
    .add(branchTarget.multiplyScalar(branchWeight));
}

function candidateAdaptiveBranchAssignment(
  nodes: RelationLayoutNode[],
  adjacency: ReadonlyMap<string, string[]>,
): Map<string, THREE.Vector3> {
  const byId = new Map(nodes.map(node => [node.id, node] as const));
  const positions = positionMap(nodes);
  const groups: Record<NonCoreLayer, RelationLayoutNode[]> = { inner: [], middle: [], outer: [] };

  for (const node of nodes) {
    const layer = layerOf(node);
    if (layer !== 'core') groups[layer].push(node);
  }

  const pools = new Map<NonCoreLayer, SlotPool>();
  (Object.keys(groups) as NonCoreLayer[]).forEach(layer => {
    pools.set(layer, makeSlotPool(layer, groups[layer].map(node => node.pos!.clone())));
  });

  const assigned = new Map<string, THREE.Vector3>();
  for (const node of nodes) {
    if (layerOf(node) === 'core') assigned.set(node.id, node.pos!.clone());
  }

  const components = connectedComponents(nodes, adjacency);

  const assignComponent = (component: readonly string[]) => {
    const diameterPath = approximateDiameterPath(component, adjacency);
    const morphology = morphologyForComponent(component, diameterPath, adjacency);
    const schedule = scheduleComponent(component, diameterPath, adjacency);

    for (const id of schedule.order) {
      if (assigned.has(id)) continue;
      const node = byId.get(id);
      const fallback = positions.get(id);
      if (!node || !fallback) continue;
      const layer = layerOf(node);
      if (layer === 'core') continue;
      const target = blendedPlacementTarget(
        id,
        morphology,
        schedule,
        adjacency,
        assigned,
        fallback,
      );
      const pool = pools.get(layer)!;
      const slotIndex = takeNearestLocalSlot(pool, target);
      assigned.set(id, pool.slots[slotIndex].clone());
    }
  };

  for (const component of components) {
    if (component.length > 1) assignComponent(component);
  }
  for (const component of components) {
    if (component.length === 1) assignComponent(component);
  }

  return assigned;
}

export function optimizeRelationLengthLayout(
  nodes: RelationLayoutNode[],
  passes = DEFAULT_PASSES,
): RelationLayoutResult {
  const edges = collectRelationLayoutEdges(nodes);
  if (edges.length === 0 || nodes.length <= 1) {
    const length = totalRelationLineLength(nodes, edges);
    return { before: length, after: length, edgeCount: edges.length, acceptedPasses: 0 };
  }

  const adjacency = buildAdjacency(nodes, edges);
  const before = totalRelationLineLength(nodes, edges);
  let current = before;
  let acceptedPasses = 0;

  for (let pass = 0; pass < Math.max(1, passes); pass++) {
    const candidate = candidateAdaptiveBranchAssignment(nodes, adjacency);
    const candidateLength = lineLengthFromPositions(candidate, edges);
    if (!(candidateLength + IMPROVEMENT_EPSILON < current)) break;

    for (const node of nodes) {
      const position = candidate.get(node.id);
      if (!position) continue;
      node.pos = position.clone();
      node.homePos = position.clone();
      node.vel ??= new THREE.Vector3();
      node.vel.set(0, 0, 0);
    }
    current = candidateLength;
    acceptedPasses++;
  }

  return { before, after: current, edgeCount: edges.length, acceptedPasses };
}
