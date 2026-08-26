import * as THREE from 'three';
import { isSystemCoreNodeId } from '../../domain/KnowledgeLayerPolicy';
import { lineageRoleFor, topicIdFor } from '../../domain/KnowledgeLineage';
import {
  RADIAL_LAYOUT_LINK_LENGTH,
  RADIAL_LAYOUT_MIN_PLANE_SPACING,
  type RadialKnowledgeLayoutNode,
} from './RadialKnowledgeLayout';

export const LOCAL_CHAIN_OPTIMIZATION_HOPS = 2;
export const LOCAL_CHAIN_OPTIMIZATION_MAX_NODES = 96;
export const LOCAL_CHAIN_OPTIMIZATION_ITERATIONS = 24;

const COLLISION_PASSES_PER_ITERATION = 2;
const FINAL_COLLISION_PASSES = 6;
const STEP_FRACTION = 0.12;
const EPSILON = 1e-8;

type Basis = { radial: THREE.Vector3; u: THREE.Vector3; v: THREE.Vector3 };
type Edge = readonly [string, string];
type CompressedGraph = {
  knowledgeNodes: RadialKnowledgeLayoutNode[];
  adjacency: Map<string, Set<string>>;
  outgoing: Map<string, Set<string>>;
  incoming: Map<string, Set<string>>;
};

type CellLocation = { depth: number; key: string };

function isReasoning(node: RadialKnowledgeLayoutNode): boolean {
  return node.type === 'reasoning';
}

function isPrimaryCurrentNode(node: RadialKnowledgeLayoutNode): boolean {
  if (isSystemCoreNodeId(node.id)) return false;
  if (node.hidden && !node.lineage) return false;
  if (lineageRoleFor(node) !== 'current') return false;
  return node.lineage?.reasoningSide !== 'opposition';
}

function tangentBasis(direction: THREE.Vector3): Basis {
  const radial = direction.clone().normalize();
  const reference = Math.abs(radial.y) < 0.9
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(1, 0, 0);
  const u = reference.clone().cross(radial).normalize();
  const v = radial.clone().cross(u).normalize();
  return { radial, u, v };
}

function setPosition(node: RadialKnowledgeLayoutNode, position: THREE.Vector3): void {
  node.pos = position.clone();
  node.homePos = position.clone();
  node.vel ??= new THREE.Vector3();
  node.vel.set(0, 0, 0);
}

function connectDirected(
  fromId: string,
  toId: string,
  adjacency: Map<string, Set<string>>,
  outgoing: Map<string, Set<string>>,
  incoming: Map<string, Set<string>>,
): void {
  if (fromId === toId) return;
  adjacency.get(fromId)?.add(toId);
  adjacency.get(toId)?.add(fromId);
  outgoing.get(fromId)?.add(toId);
  incoming.get(toId)?.add(fromId);
}

function buildCompressedGraph(nodes: RadialKnowledgeLayoutNode[]): CompressedGraph {
  const primaryNodes = nodes.filter(isPrimaryCurrentNode);
  const byId = new Map(primaryNodes.map(node => [node.id, node] as const));
  const reasoningIds = new Set(primaryNodes.filter(isReasoning).map(node => node.id));
  const knowledgeNodes = primaryNodes.filter(node => !isReasoning(node));
  const knowledgeIds = new Set(knowledgeNodes.map(node => node.id));
  const adjacency = new Map(knowledgeNodes.map(node => [node.id, new Set<string>()] as const));
  const outgoing = new Map(knowledgeNodes.map(node => [node.id, new Set<string>()] as const));
  const incoming = new Map(knowledgeNodes.map(node => [node.id, new Set<string>()] as const));
  const conclusionsByReasoning = new Map<string, string[]>();

  for (const reasoningId of reasoningIds) conclusionsByReasoning.set(reasoningId, []);
  for (const node of knowledgeNodes) {
    for (const sourceId of node.premises ?? []) {
      if (reasoningIds.has(sourceId)) conclusionsByReasoning.get(sourceId)!.push(node.id);
      else if (knowledgeIds.has(sourceId)) connectDirected(sourceId, node.id, adjacency, outgoing, incoming);
    }
  }

  for (const reasoningId of reasoningIds) {
    const reasoning = byId.get(reasoningId);
    if (!reasoning) continue;
    const premises = (reasoning.premises ?? []).filter(id => knowledgeIds.has(id));
    const conclusions = conclusionsByReasoning.get(reasoningId) ?? [];
    for (const premiseId of premises) {
      for (const conclusionId of conclusions) {
        connectDirected(premiseId, conclusionId, adjacency, outgoing, incoming);
      }
    }
  }
  return { knowledgeNodes, adjacency, outgoing, incoming };
}

function connectedComponents(
  nodeIds: readonly string[],
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
): string[][] {
  const components: string[][] = [];
  const visited = new Set<string>();
  for (const seed of [...nodeIds].sort()) {
    if (visited.has(seed)) continue;
    const queue = [seed];
    const component: string[] = [];
    visited.add(seed);
    let head = 0;
    while (head < queue.length) {
      const id = queue[head++]!;
      component.push(id);
      for (const nextId of [...(adjacency.get(id) ?? [])].sort()) {
        if (visited.has(nextId)) continue;
        visited.add(nextId);
        queue.push(nextId);
      }
    }
    components.push(component.sort());
  }
  return components.sort((a, b) => a[0]!.localeCompare(b[0]!));
}

function computeDepths(
  component: readonly string[],
  incoming: ReadonlyMap<string, ReadonlySet<string>>,
  outgoing: ReadonlyMap<string, ReadonlySet<string>>,
): Map<string, number> {
  const componentSet = new Set(component);
  const indegree = new Map<string, number>();
  const depth = new Map<string, number>();

  for (const id of component) {
    const degree = [...(incoming.get(id) ?? [])].filter(parent => componentSet.has(parent)).length;
    indegree.set(id, degree);
    if (degree === 0) depth.set(id, 0);
  }

  const queue = component.filter(id => indegree.get(id) === 0).sort();
  let head = 0;
  while (head < queue.length) {
    const id = queue[head++]!;
    const baseDepth = depth.get(id) ?? 0;
    for (const childId of [...(outgoing.get(id) ?? [])].filter(id => componentSet.has(id)).sort()) {
      depth.set(childId, Math.max(depth.get(childId) ?? 0, baseDepth + 1));
      const remaining = (indegree.get(childId) ?? 0) - 1;
      indegree.set(childId, remaining);
      if (remaining === 0) queue.push(childId);
    }
  }

  const maxKnownDepth = Math.max(0, ...depth.values());
  for (const id of component) if (!depth.has(id)) depth.set(id, maxKnownDepth + 1);
  return depth;
}

function componentBasis(
  component: readonly string[],
  byId: ReadonlyMap<string, RadialKnowledgeLayoutNode>,
  depths: ReadonlyMap<string, number>,
): Basis | null {
  const positioned = component
    .map(id => byId.get(id))
    .filter((node): node is RadialKnowledgeLayoutNode & { pos: THREE.Vector3 } => Boolean(node?.pos));
  if (!positioned.length) return null;

  const minDepth = Math.min(...component.map(id => depths.get(id) ?? 0));
  const rootPlane = component
    .filter(id => (depths.get(id) ?? 0) === minDepth)
    .map(id => byId.get(id))
    .filter((node): node is RadialKnowledgeLayoutNode & { pos: THREE.Vector3 } => Boolean(node?.pos));
  const anchors = rootPlane.length ? rootPlane : positioned;
  const direction = anchors
    .reduce((sum, node) => sum.add(node.pos), new THREE.Vector3())
    .multiplyScalar(1 / anchors.length);
  if (direction.lengthSq() <= EPSILON) direction.copy(positioned[0]!.pos);
  return direction.lengthSq() > EPSILON ? tangentBasis(direction) : null;
}

function graphEdges(
  component: readonly string[],
  outgoing: ReadonlyMap<string, ReadonlySet<string>>,
): Edge[] {
  const componentSet = new Set(component);
  const edges: Edge[] = [];
  for (const fromId of [...component].sort()) {
    for (const toId of [...(outgoing.get(fromId) ?? [])].filter(id => componentSet.has(id)).sort()) {
      edges.push([fromId, toId]);
    }
  }
  return edges;
}

function indexEdgesByNode(edges: readonly Edge[]): Map<string, Edge[]> {
  const index = new Map<string, Edge[]>();
  for (const edge of edges) {
    for (const id of edge) {
      const bucket = index.get(id);
      if (bucket) bucket.push(edge);
      else index.set(id, [edge]);
    }
  }
  return index;
}

function edgesForRegion(
  region: readonly string[],
  edgeIndex: ReadonlyMap<string, readonly Edge[]>,
): Edge[] {
  const seen = new Set<string>();
  const result: Edge[] = [];
  for (const id of region) {
    for (const edge of edgeIndex.get(id) ?? []) {
      const key = `${edge[0]}\u0000${edge[1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(edge);
    }
  }
  return result;
}

export function collectBoundedNeighborhood(
  seedId: string,
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
  maxHops = LOCAL_CHAIN_OPTIMIZATION_HOPS,
  maxNodes = LOCAL_CHAIN_OPTIMIZATION_MAX_NODES,
): string[] {
  const visited = new Set<string>([seedId]);
  const queue: Array<{ id: string; hops: number }> = [{ id: seedId, hops: 0 }];
  const result: string[] = [];
  let head = 0;
  while (head < queue.length && result.length < maxNodes) {
    const current = queue[head++]!;
    result.push(current.id);
    if (current.hops >= maxHops) continue;
    for (const nextId of [...(adjacency.get(current.id) ?? [])].sort()) {
      if (visited.has(nextId) || visited.size >= maxNodes) continue;
      visited.add(nextId);
      queue.push({ id: nextId, hops: current.hops + 1 });
    }
  }
  return result;
}

class PlaneSpatialHash {
  private readonly buckets = new Map<number, Map<string, Set<string>>>();
  private readonly locations = new Map<string, CellLocation>();

  constructor(private readonly cellSize: number) {}

  private cell(point: THREE.Vector2): [number, number] {
    return [Math.floor(point.x / this.cellSize), Math.floor(point.y / this.cellSize)];
  }

  private key(x: number, y: number): string {
    return `${x},${y}`;
  }

  insert(id: string, depth: number, point: THREE.Vector2): void {
    const [x, y] = this.cell(point);
    const key = this.key(x, y);
    let plane = this.buckets.get(depth);
    if (!plane) {
      plane = new Map();
      this.buckets.set(depth, plane);
    }
    let bucket = plane.get(key);
    if (!bucket) {
      bucket = new Set();
      plane.set(key, bucket);
    }
    bucket.add(id);
    this.locations.set(id, { depth, key });
  }

  move(id: string, depth: number, from: THREE.Vector2, to: THREE.Vector2): void {
    const [fromX, fromY] = this.cell(from);
    const [toX, toY] = this.cell(to);
    if (fromX === toX && fromY === toY) return;
    const location = this.locations.get(id);
    if (location) {
      const plane = this.buckets.get(location.depth);
      const bucket = plane?.get(location.key);
      bucket?.delete(id);
      if (bucket?.size === 0) plane?.delete(location.key);
    }
    this.insert(id, depth, to);
  }

  nearby(depth: number, point: THREE.Vector2): string[] {
    const [x, y] = this.cell(point);
    const plane = this.buckets.get(depth);
    if (!plane) return [];
    const ids = new Set<string>();
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const id of plane.get(this.key(x + dx, y + dy)) ?? []) ids.add(id);
      }
    }
    return [...ids].sort();
  }
}

function deterministicDirection(id: string, otherId: string): THREE.Vector2 {
  const low = id < otherId ? id : otherId;
  const high = id < otherId ? otherId : id;
  let hash = 2166136261;
  for (const char of `${low}|${high}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const angle = ((hash >>> 0) / 0xffffffff) * Math.PI * 2;
  const direction = new THREE.Vector2(Math.cos(angle), Math.sin(angle));
  return id === low ? direction : direction.multiplyScalar(-1);
}

function movePoint(
  id: string,
  delta: THREE.Vector2,
  coordinates: Map<string, THREE.Vector2>,
  depths: ReadonlyMap<string, number>,
  hash: PlaneSpatialHash,
): void {
  const point = coordinates.get(id);
  if (!point) return;
  const before = point.clone();
  point.add(delta);
  hash.move(id, depths.get(id) ?? 0, before, point);
}

function projectMinimumSpacing(
  movable: ReadonlySet<string>,
  coordinates: Map<string, THREE.Vector2>,
  depths: ReadonlyMap<string, number>,
  hash: PlaneSpatialHash,
  passes: number,
): void {
  for (let pass = 0; pass < passes; pass += 1) {
    for (const id of [...movable].sort()) {
      let point = coordinates.get(id);
      if (!point) continue;
      const depth = depths.get(id) ?? 0;
      for (const otherId of hash.nearby(depth, point)) {
        if (otherId === id) continue;
        const otherMovable = movable.has(otherId);
        if (otherMovable && id.localeCompare(otherId) > 0) continue;
        const other = coordinates.get(otherId);
        if (!other) continue;
        const delta = point.clone().sub(other);
        const distance = delta.length();
        if (distance + EPSILON >= RADIAL_LAYOUT_MIN_PLANE_SPACING) continue;
        const direction = distance > EPSILON
          ? delta.multiplyScalar(1 / distance)
          : deterministicDirection(id, otherId);
        const overlap = RADIAL_LAYOUT_MIN_PLANE_SPACING - distance;
        if (otherMovable) {
          movePoint(id, direction.clone().multiplyScalar(overlap * 0.5), coordinates, depths, hash);
          movePoint(otherId, direction.clone().multiplyScalar(-overlap * 0.5), coordinates, depths, hash);
        } else {
          movePoint(id, direction.multiplyScalar(overlap), coordinates, depths, hash);
        }
        point = coordinates.get(id);
        if (!point) break;
      }
    }
  }
}

function edgeLength(
  edge: Edge,
  coordinates: ReadonlyMap<string, THREE.Vector2>,
  radialCoordinates: ReadonlyMap<string, number>,
): number {
  const a = coordinates.get(edge[0]);
  const b = coordinates.get(edge[1]);
  if (!a || !b) return 0;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dr = (radialCoordinates.get(edge[0]) ?? 0) - (radialCoordinates.get(edge[1]) ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dr * dr);
}

function edgeTotal(
  edges: readonly Edge[],
  coordinates: ReadonlyMap<string, THREE.Vector2>,
  radialCoordinates: ReadonlyMap<string, number>,
): number {
  return edges.reduce((sum, edge) => sum + edgeLength(edge, coordinates, radialCoordinates), 0);
}

function pullTowardShorterEdges(
  edges: readonly Edge[],
  movable: ReadonlySet<string>,
  coordinates: Map<string, THREE.Vector2>,
  radialCoordinates: ReadonlyMap<string, number>,
  depths: ReadonlyMap<string, number>,
  hash: PlaneSpatialHash,
  step: number,
): void {
  const gradients = new Map<string, THREE.Vector2>();
  const counts = new Map<string, number>();
  for (const [fromId, toId] of edges) {
    const from = coordinates.get(fromId);
    const to = coordinates.get(toId);
    if (!from || !to) continue;
    const dx = from.x - to.x;
    const dy = from.y - to.y;
    const dr = (radialCoordinates.get(fromId) ?? 0) - (radialCoordinates.get(toId) ?? 0);
    const length = Math.sqrt(dx * dx + dy * dy + dr * dr);
    if (length <= EPSILON) continue;
    const gradient = new THREE.Vector2(dx / length, dy / length);
    if (movable.has(fromId)) {
      gradients.set(fromId, (gradients.get(fromId) ?? new THREE.Vector2()).add(gradient));
      counts.set(fromId, (counts.get(fromId) ?? 0) + 1);
    }
    if (movable.has(toId)) {
      gradients.set(toId, (gradients.get(toId) ?? new THREE.Vector2()).sub(gradient));
      counts.set(toId, (counts.get(toId) ?? 0) + 1);
    }
  }

  for (const id of [...movable].sort()) {
    const gradient = gradients.get(id);
    const count = counts.get(id) ?? 0;
    if (!gradient || count === 0) continue;
    movePoint(id, gradient.multiplyScalar(-step / count), coordinates, depths, hash);
  }
}

function spacingSatisfied(
  movable: ReadonlySet<string>,
  coordinates: ReadonlyMap<string, THREE.Vector2>,
  depths: ReadonlyMap<string, number>,
  hash: PlaneSpatialHash,
): boolean {
  for (const id of movable) {
    const point = coordinates.get(id);
    if (!point) continue;
    for (const otherId of hash.nearby(depths.get(id) ?? 0, point)) {
      if (otherId === id) continue;
      const other = coordinates.get(otherId);
      if (other && point.distanceTo(other) + 1e-6 < RADIAL_LAYOUT_MIN_PLANE_SPACING) return false;
    }
  }
  return true;
}

function optimizeRegion(
  region: readonly string[],
  edges: readonly Edge[],
  coordinates: Map<string, THREE.Vector2>,
  radialCoordinates: ReadonlyMap<string, number>,
  depths: ReadonlyMap<string, number>,
  hash: PlaneSpatialHash,
): void {
  const movable = new Set(region.filter(id => coordinates.has(id)));
  if (movable.size <= 1 || !edges.length) return;
  const snapshot = new Map([...movable].map(id => [id, coordinates.get(id)!.clone()] as const));
  const baseline = edgeTotal(edges, coordinates, radialCoordinates);

  for (let iteration = 0; iteration < LOCAL_CHAIN_OPTIMIZATION_ITERATIONS; iteration += 1) {
    const progress = iteration / Math.max(1, LOCAL_CHAIN_OPTIMIZATION_ITERATIONS - 1);
    const step = RADIAL_LAYOUT_LINK_LENGTH * STEP_FRACTION * (1 - 0.75 * progress);
    pullTowardShorterEdges(edges, movable, coordinates, radialCoordinates, depths, hash, step);
    projectMinimumSpacing(movable, coordinates, depths, hash, COLLISION_PASSES_PER_ITERATION);
  }
  projectMinimumSpacing(movable, coordinates, depths, hash, FINAL_COLLISION_PASSES);

  const finalTotal = edgeTotal(edges, coordinates, radialCoordinates);
  if (finalTotal <= baseline + 1e-6 && spacingSatisfied(movable, coordinates, depths, hash)) return;

  for (const [id, original] of snapshot) {
    const current = coordinates.get(id);
    if (!current) continue;
    hash.move(id, depths.get(id) ?? 0, current, original);
    coordinates.set(id, original.clone());
  }
}

function optimizeComponent(
  component: readonly string[],
  byId: ReadonlyMap<string, RadialKnowledgeLayoutNode>,
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
  incoming: ReadonlyMap<string, ReadonlySet<string>>,
  outgoing: ReadonlyMap<string, ReadonlySet<string>>,
): void {
  const depths = computeDepths(component, incoming, outgoing);
  const basis = componentBasis(component, byId, depths);
  if (!basis) return;

  const coordinates = new Map<string, THREE.Vector2>();
  const radialCoordinates = new Map<string, number>();
  for (const id of component) {
    const node = byId.get(id);
    if (!node?.pos) continue;
    coordinates.set(id, new THREE.Vector2(node.pos.dot(basis.u), node.pos.dot(basis.v)));
    radialCoordinates.set(id, node.pos.dot(basis.radial));
  }
  if (coordinates.size <= 1) return;

  const allEdges = graphEdges(component, outgoing);
  const edgeIndex = indexEdgesByNode(allEdges);
  const hash = new PlaneSpatialHash(RADIAL_LAYOUT_MIN_PLANE_SPACING);
  for (const [id, point] of coordinates) hash.insert(id, depths.get(id) ?? 0, point);

  const regions: string[][] = [];
  if (component.length <= LOCAL_CHAIN_OPTIMIZATION_MAX_NODES) {
    regions.push([...component]);
  } else {
    const signatures = new Set<string>();
    const branchSeeds = component.filter(id =>
      (incoming.get(id)?.size ?? 0) > 1 || (outgoing.get(id)?.size ?? 0) > 1,
    ).sort();
    for (const seedId of branchSeeds) {
      const region = collectBoundedNeighborhood(seedId, adjacency);
      const signature = [...region].sort().join('|');
      if (region.length <= 1 || signatures.has(signature)) continue;
      signatures.add(signature);
      regions.push(region);
    }
  }

  for (const region of regions) {
    optimizeRegion(
      region,
      edgesForRegion(region, edgeIndex),
      coordinates,
      radialCoordinates,
      depths,
      hash,
    );
  }

  for (const [id, point] of coordinates) {
    const node = byId.get(id);
    if (!node) continue;
    setPosition(
      node,
      basis.radial.clone().multiplyScalar(radialCoordinates.get(id) ?? 0)
        .addScaledVector(basis.u, point.x)
        .addScaledVector(basis.v, point.y),
    );
  }
}

function meanPosition(nodes: readonly RadialKnowledgeLayoutNode[]): THREE.Vector3 | null {
  const positioned = nodes.filter(
    (node): node is RadialKnowledgeLayoutNode & { pos: THREE.Vector3 } => Boolean(node.pos),
  );
  if (!positioned.length) return null;
  return positioned.reduce((sum, node) => sum.add(node.pos), new THREE.Vector3())
    .multiplyScalar(1 / positioned.length);
}

function shiftLineageBranches(
  nodes: RadialKnowledgeLayoutNode[],
  before: ReadonlyMap<string, THREE.Vector3>,
): void {
  const groups = new Map<string, RadialKnowledgeLayoutNode[]>();
  for (const node of nodes) {
    if (!node.lineage || isReasoning(node)) continue;
    const topicId = topicIdFor(node);
    const group = groups.get(topicId);
    if (group) group.push(node);
    else groups.set(topicId, [node]);
  }

  for (const members of groups.values()) {
    const base = members.find(node =>
      lineageRoleFor(node) === 'current' && node.lineage?.reasoningSide !== 'opposition',
    );
    if (!base?.pos) continue;
    const oldBase = before.get(base.id);
    if (!oldBase) continue;
    const delta = base.pos.clone().sub(oldBase);
    if (delta.lengthSq() <= EPSILON) continue;
    for (const member of members) {
      if (member === base || isPrimaryCurrentNode(member) || !member.pos) continue;
      setPosition(member, member.pos.clone().add(delta));
    }
  }
}

function repositionReasoning(nodes: RadialKnowledgeLayoutNode[]): void {
  const byId = new Map(nodes.map(node => [node.id, node] as const));
  const knowledgeNodes = nodes.filter(node => !isReasoning(node));
  for (const reasoning of nodes.filter(isReasoning)) {
    const premises = (reasoning.premises ?? [])
      .map(id => byId.get(id))
      .filter((node): node is RadialKnowledgeLayoutNode => Boolean(node && !isReasoning(node)));
    const conclusions = knowledgeNodes.filter(node => (node.premises ?? []).includes(reasoning.id));
    const premiseCenter = meanPosition(premises);
    const conclusionCenter = meanPosition(conclusions);
    if (premiseCenter && conclusionCenter) {
      setPosition(reasoning, premiseCenter.add(conclusionCenter).multiplyScalar(0.5));
    } else if (premiseCenter) {
      setPosition(reasoning, premiseCenter);
    } else if (conclusionCenter) {
      setPosition(reasoning, conclusionCenter);
    }
  }
}

/**
 * Radial planes stay fixed. Small chains minimize their whole relation total;
 * giant connected graphs optimize only bounded fan-in/fan-out neighborhoods.
 * A per-component edge index and plane spatial hash keep each local solve local.
 */
export function applyLocalChainLengthOptimization<T extends RadialKnowledgeLayoutNode>(nodes: T[]): T[] {
  const before = new Map(
    nodes.filter(node => node.pos).map(node => [node.id, node.pos!.clone()] as const),
  );
  const graph = buildCompressedGraph(nodes);
  const byId = new Map(graph.knowledgeNodes.map(node => [node.id, node] as const));
  const components = connectedComponents(graph.knowledgeNodes.map(node => node.id), graph.adjacency);
  for (const component of components) {
    optimizeComponent(component, byId, graph.adjacency, graph.incoming, graph.outgoing);
  }
  shiftLineageBranches(nodes, before);
  repositionReasoning(nodes);
  return nodes;
}
