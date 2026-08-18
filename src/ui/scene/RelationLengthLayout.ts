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

const DEFAULT_PASSES = 4;
const GRID_SCALE = 1.6;
const LOCAL_CELL_RADIUS = 2;
const MAX_BUCKET_SCAN = 16;
const IMPROVEMENT_EPSILON = 1e-6;

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

/**
 * Builds the complete historical relation graph from every layout node. Hidden,
 * falsified and superseded nodes are deliberately NOT filtered here: invisibility
 * changes rendering only, never spatial ownership or historical line cost.
 *
 * Premise + logic edges use the same directed-key de-duplication as the scene.
 * Twin groups use the scene's effective star topology for groups larger than 2.
 */
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

/** Matches the straight 3D segment rendered by KnowledgeScene.updateLine. */
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

function candidateTraversalAssignment(
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

  let maxDegree = 0;
  const degreeById = new Map<string, number>();
  for (const node of nodes) {
    const degree = adjacency.get(node.id)?.length ?? 0;
    degreeById.set(node.id, degree);
    maxDegree = Math.max(maxDegree, degree);
  }
  const degreeBuckets: RelationLayoutNode[][] = Array.from({ length: maxDegree + 1 }, () => []);
  for (const node of nodes) {
    if (layerOf(node) !== 'core') degreeBuckets[degreeById.get(node.id) ?? 0].push(node);
  }

  const scheduled = new Set<string>();
  const queue: string[] = [];
  let queueHead = 0;

  const assignNode = (node: RelationLayoutNode): void => {
    if (assigned.has(node.id)) return;
    const layer = layerOf(node);
    if (layer === 'core') return;
    const neighbours = adjacency.get(node.id) ?? [];
    const target = new THREE.Vector3();
    let targetCount = 0;
    for (const neighbourId of neighbours) {
      const neighbourPosition = assigned.get(neighbourId);
      if (!neighbourPosition) continue;
      target.add(neighbourPosition);
      targetCount++;
    }
    if (targetCount > 0) target.multiplyScalar(1 / targetCount);
    else target.copy(positions.get(node.id)!);

    const pool = pools.get(layer)!;
    const slotIndex = takeNearestLocalSlot(pool, target);
    assigned.set(node.id, pool.slots[slotIndex].clone());
  };

  for (let degree = maxDegree; degree >= 0; degree--) {
    for (const seed of degreeBuckets[degree]) {
      if (assigned.has(seed.id) || scheduled.has(seed.id)) continue;
      scheduled.add(seed.id);
      queue.push(seed.id);

      while (queueHead < queue.length) {
        const id = queue[queueHead++];
        const node = byId.get(id);
        if (!node) continue;
        assignNode(node);

        for (const neighbourId of adjacency.get(id) ?? []) {
          if (assigned.has(neighbourId) || scheduled.has(neighbourId)) continue;
          const neighbour = byId.get(neighbourId);
          if (!neighbour || layerOf(neighbour) === 'core') continue;
          scheduled.add(neighbourId);
          queue.push(neighbourId);
        }
      }
    }
  }

  return assigned;
}

/**
 * Near-linear fixed-slot optimizer.
 *
 * The globally exact fixed-slot minimum is a quadratic-assignment problem, so
 * this deliberately avoids O(n²) pair swaps. Each pass traverses the complete
 * historical relation graph once, grows high-degree-connected regions through
 * BFS, and assigns each node to a nearby free slot using a bounded spatial hash.
 * A candidate pass is committed only when the actual displayed straight 3D line
 * total gets smaller. With a fixed small pass count, expected work is O(k(n + m)).
 */
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
    const candidate = candidateTraversalAssignment(nodes, adjacency);
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
