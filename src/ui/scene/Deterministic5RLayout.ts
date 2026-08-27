import * as THREE from 'three';
import { isSystemCoreNodeId } from '../../domain/KnowledgeLayerPolicy';
import { lineageRoleFor, topicIdFor, type KnowledgeLineageMeta } from '../../domain/KnowledgeLineage';
import { SUN_ORBIT_RADIUS, SUN_TRIAD_IDS } from '../config/KnowledgeUiConfig';

export const KNOWLEDGE_BALL_RADIUS = 7.2;
/** R-scale placement / snapping resolution. */
export const LAYOUT_UNIT = KNOWLEDGE_BALL_RADIUS;
/** Global exclusion radius and minimum radial expansion step. */
export const EXCLUSION_RADIUS = 5 * KNOWLEDGE_BALL_RADIUS;
export const EXPANSION_UNIT = 5 * KNOWLEDGE_BALL_RADIUS;
export const CROSSING_SWEEP_LIMIT = 12;
export const MACRO_DIRECTION_COUNT = 12;

export interface LayoutNode {
  id: string;
  type?: string;
  premises?: string[];
  hidden?: boolean;
  lineage?: KnowledgeLineageMeta;
  declaredLayer?: 'core' | 'inner' | 'middle' | 'outer';
  effectiveLayer?: 'core' | 'inner' | 'middle' | 'outer';
  layer?: 'core' | 'inner' | 'middle' | 'outer';
  pos?: THREE.Vector3;
  homePos?: THREE.Vector3;
  vel?: THREE.Vector3;
}

export type SemanticBoundaries = Readonly<{ cyanBlue: number; bluePurple: number; purpleOuter: null }>;
export type LayoutDiagnostics = Readonly<{
  boundaries: SemanticBoundaries;
  occupiedCells: ReadonlySet<string>;
  reservedCells: ReadonlySet<string>;
  usedAngles: ReadonlyMap<string, number>;
  componentOrders: ReadonlyMap<string, readonly string[]>;
  macroCandidateAngles: readonly number[];
  macroAssignments: ReadonlyMap<string, number>;
  expansionCount: number;
}>;

type Relation = { id: string; premises: string[]; conclusions: string[] };
type Graph = {
  knowledge: LayoutNode[];
  relations: Relation[];
  adjacency: Map<string, Set<string>>;
  outgoing: Map<string, Set<string>>;
  incoming: Map<string, Set<string>>;
};
type LocalNode = { id: string; depth: number; q: number; r: number };
type Component = { id: string; ids: string[]; relations: Relation[]; branching: number; layers: number };
type SolvedComponent = Component & { local: LocalNode[] };
type FccIndex = readonly [number, number, number];
type Placed = { component: SolvedComponent; angle: number; direction: THREE.Vector3; radialExtra: number; positions: THREE.Vector3[] };

const EPSILON = 1e-8;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const MIN_ANGLE_COUNT = 89;
const TOP_COMPONENT_LIMIT = 12;
const FCC_AXIS_STEP = KNOWLEDGE_BALL_RADIUS / Math.sqrt(2);

function setPosition(node: LayoutNode, position: THREE.Vector3): void {
  node.pos = position.clone();
  node.homePos = position.clone();
  node.vel ??= new THREE.Vector3();
  node.vel.set(0, 0, 0);
}

function layerOf(node: LayoutNode): 'inner' | 'middle' | 'outer' {
  return node.effectiveLayer === 'outer' || node.layer === 'outer' || node.declaredLayer === 'outer' ? 'outer'
    : node.effectiveLayer === 'middle' || node.layer === 'middle' || node.declaredLayer === 'middle' ? 'middle'
      : 'inner';
}

/** Semantic shells are resolved at R precision. Purple remains unbounded. */
export function computeSemanticBoundaries(nodes: readonly LayoutNode[]): SemanticBoundaries {
  const occupiable = nodes.filter(node => node.type !== 'reasoning' && !isSystemCoreNodeId(node.id));
  const inner = occupiable.filter(node => layerOf(node) === 'inner').length;
  const middle = occupiable.filter(node => layerOf(node) === 'middle').length;
  const radiusForCapacity = (count: number) => Math.max(LAYOUT_UNIT, Math.ceil(Math.cbrt(Math.max(1, count))) * LAYOUT_UNIT);
  const cyanBlue = radiusForCapacity(inner);
  const bluePurple = Math.max(cyanBlue + LAYOUT_UNIT, radiusForCapacity(inner + middle));
  return Object.freeze({ cyanBlue, bluePurple, purpleOuter: null });
}

function buildGraph(nodes: LayoutNode[]): Graph {
  const knowledge = nodes.filter(node => node.type !== 'reasoning' && !isSystemCoreNodeId(node.id) && (!node.hidden || Boolean(node.lineage)) && lineageRoleFor(node) === 'current' && node.lineage?.reasoningSide !== 'opposition');
  const ids = new Set(knowledge.map(node => node.id));
  const reasoning = nodes.filter(node => node.type === 'reasoning');
  const relations = reasoning.map(node => ({
    id: node.id,
    premises: [...new Set(node.premises ?? [])].filter(id => ids.has(id)).sort(),
    conclusions: knowledge.filter(candidate => (candidate.premises ?? []).includes(node.id)).map(node => node.id).sort(),
  })).filter(relation => relation.premises.length || relation.conclusions.length);
  const adjacency = new Map(knowledge.map(node => [node.id, new Set<string>()]));
  const outgoing = new Map(knowledge.map(node => [node.id, new Set<string>()]));
  const incoming = new Map(knowledge.map(node => [node.id, new Set<string>()]));
  const connect = (from: string, to: string) => {
    if (from === to) return;
    adjacency.get(from)?.add(to);
    adjacency.get(to)?.add(from);
    outgoing.get(from)?.add(to);
    incoming.get(to)?.add(from);
  };
  for (const relation of relations) for (const premise of relation.premises) for (const conclusion of relation.conclusions) connect(premise, conclusion);
  for (const node of knowledge) for (const premise of node.premises ?? []) if (ids.has(premise)) connect(premise, node.id);
  return { knowledge, relations, adjacency, outgoing, incoming };
}

function connectedComponents(graph: Graph): string[][] {
  const result: string[][] = [];
  const seen = new Set<string>();
  for (const seed of graph.knowledge.map(node => node.id).sort()) {
    if (seen.has(seed)) continue;
    const queue = [seed];
    const ids: string[] = [];
    seen.add(seed);
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i]!;
      ids.push(id);
      for (const next of [...(graph.adjacency.get(id) ?? [])].sort()) if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
    result.push(ids.sort());
  }
  return result;
}

function depthsFor(ids: readonly string[], graph: Graph): Map<string, number> {
  const set = new Set(ids);
  const indegree = new Map<string, number>();
  const depth = new Map<string, number>();
  for (const id of ids) {
    const count = [...(graph.incoming.get(id) ?? [])].filter(parent => set.has(parent)).length;
    indegree.set(id, count);
    if (!count) depth.set(id, 0);
  }
  const queue = ids.filter(id => indegree.get(id) === 0).sort();
  for (let i = 0; i < queue.length; i++) {
    const parent = queue[i]!;
    for (const child of [...(graph.outgoing.get(parent) ?? [])].filter(id => set.has(id)).sort()) {
      depth.set(child, Math.max(depth.get(child) ?? 0, (depth.get(parent) ?? 0) + 1));
      indegree.set(child, (indegree.get(child) ?? 0) - 1);
      if (indegree.get(child) === 0) queue.push(child);
    }
  }
  const fallback = Math.max(0, ...depth.values()) + 1;
  for (const id of ids) if (!depth.has(id)) depth.set(id, fallback);
  return depth;
}

function crossingCount(layers: Map<number, string[]>, graph: Graph, depth: Map<string, number>): number {
  const order = new Map<string, number>();
  for (const ids of layers.values()) ids.forEach((id, index) => order.set(id, index));
  const edges = [...graph.outgoing].flatMap(([from, targets]) => [...targets]
    .filter(to => depth.get(to) === (depth.get(from) ?? 0) + 1)
    .map(to => [from, to] as const));
  let count = 0;
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    const [a, b] = edges[i]!;
    const [c, d] = edges[j]!;
    if (a === c || a === d || b === c || b === d) continue;
    if (depth.get(a) !== depth.get(c) || depth.get(b) !== depth.get(d)) continue;
    if ((order.get(a)! - order.get(c)!) * (order.get(b)! - order.get(d)!) < 0) count++;
  }
  return count;
}

function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle]! : (values[middle - 1]! + values[middle]!) / 2;
}

function minimizeCrossings(ids: readonly string[], depth: Map<string, number>, graph: Graph): Map<number, string[]> {
  const layers = new Map<number, string[]>();
  for (const id of ids) {
    const d = depth.get(id)!;
    const layer = layers.get(d) ?? [];
    layer.push(id);
    layers.set(d, layer);
  }
  for (const layer of layers.values()) layer.sort();
  let best = new Map([...layers].map(([d, values]) => [d, [...values]]));
  let bestCount = crossingCount(layers, graph, depth);
  const depthKeys = [...layers.keys()].sort((a, b) => a - b);
  for (let pass = 0; pass < CROSSING_SWEEP_LIMIT; pass++) {
    const forward = pass % 2 === 0;
    const scan = forward ? depthKeys : [...depthKeys].reverse();
    for (const d of scan) {
      const positions = new Map<string, number>();
      for (const values of layers.values()) values.forEach((id, index) => positions.set(id, index));
      layers.get(d)!.sort((a, b) => {
        const neighborScores = (id: string) => [...(forward ? graph.incoming.get(id) ?? [] : graph.outgoing.get(id) ?? [])]
          .map(neighbor => positions.get(neighbor))
          .filter((value): value is number => value !== undefined)
          .sort((x, y) => x - y);
        const compare = (id: string) => {
          const values = neighborScores(id);
          const barycenter = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : positions.get(id)!;
          return [values.length ? median(values) : positions.get(id)!, barycenter, positions.get(id)!] as const;
        };
        const sa = compare(a);
        const sb = compare(b);
        return sa[0] - sb[0] || sa[1] - sb[1] || sa[2] - sb[2] || a.localeCompare(b);
      });
    }
    const count = crossingCount(layers, graph, depth);
    const signature = [...layers].sort(([a], [b]) => a - b).flatMap(([d, values]) => values.map(id => `${d}:${id}`)).join('|');
    const bestSignature = [...best].sort(([a], [b]) => a - b).flatMap(([d, values]) => values.map(id => `${d}:${id}`)).join('|');
    if (count < bestCount || (count === bestCount && signature < bestSignature)) {
      bestCount = count;
      best = new Map([...layers].map(([d, values]) => [d, [...values]]));
    }
  }
  return best;
}

function axialRing(radius: number): Array<[number, number]> {
  if (radius === 0) return [[0, 0]];
  const result: Array<[number, number]> = [];
  let q = radius;
  let r = 0;
  const directions: Array<[number, number]> = [[-1, 1], [-1, 0], [0, -1], [1, -1], [1, 0], [0, 1]];
  for (const [dq, dr] of directions) for (let step = 0; step < radius; step++) {
    result.push([q, r]);
    q += dq;
    r += dr;
  }
  return result;
}

export function compactTriangularCoordinates(count: number): Array<[number, number]> {
  if (count <= 0) return [];
  const result: Array<[number, number]> = [[0, 0]];
  for (let radius = 1; result.length < count; radius++) result.push(...axialRing(radius));
  return result.slice(0, count);
}

function buildComponentMetadata(graph: Graph): Component[] {
  const byId = new Map(graph.knowledge.map(node => [node.id, node]));
  return connectedComponents(graph).map(ids => {
    const relationSet = new Set(ids);
    const relations = graph.relations.filter(relation => [...relation.premises, ...relation.conclusions].some(id => relationSet.has(id)));
    const branching = relations.reduce((sum, relation) => sum + Math.max(0, relation.premises.length + relation.conclusions.length - 2), 0);
    return { id: ids[0]!, ids, relations, branching, layers: new Set(ids.map(id => layerOf(byId.get(id)!))).size };
  });
}

/** Solve a component only when it is about to be placed. */
function solveComponent(component: Component, graph: Graph): SolvedComponent {
  const depth = depthsFor(component.ids, graph);
  const ordered = minimizeCrossings(component.ids, depth, graph);
  const local: LocalNode[] = [];
  for (const [d, layer] of [...ordered].sort(([a], [b]) => a - b)) {
    const coordinates = compactTriangularCoordinates(layer.length);
    layer.forEach((id, index) => local.push({ id, depth: d, q: coordinates[index]![0], r: coordinates[index]![1] }));
  }
  return { ...component, local };
}

function compareHardness(a: Component, b: Component): number {
  return b.ids.length - a.ids.length || b.layers - a.layers || b.branching - a.branching || a.id.localeCompare(b.id);
}

function selectTopComponents(components: readonly Component[], limit = TOP_COMPONENT_LIMIT): Component[] {
  return [...components].sort(compareHardness).slice(0, limit);
}

export function fibonacciDirections(count: number): THREE.Vector3[] {
  return Array.from({ length: count }, (_, index) => {
    const z = 1 - 2 * ((index + 0.5) / count);
    const radius = Math.sqrt(Math.max(0, 1 - z * z));
    const phi = index * GOLDEN_ANGLE;
    return new THREE.Vector3(Math.cos(phi) * radius, Math.sin(phi) * radius, z);
  });
}

export function icosahedronMacroDirections(): THREE.Vector3[] {
  const phi = (1 + Math.sqrt(5)) / 2;
  const result: THREE.Vector3[] = [];
  for (const y of [-1, 1]) for (const z of [-phi, phi]) result.push(new THREE.Vector3(0, y, z).normalize());
  for (const x of [-1, 1]) for (const y of [-phi, phi]) result.push(new THREE.Vector3(x, y, 0).normalize());
  for (const x of [-phi, phi]) for (const z of [-1, 1]) result.push(new THREE.Vector3(x, 0, z).normalize());
  return result;
}

export function mapMacroDirectionsToCandidates(macros: readonly THREE.Vector3[], candidates: readonly THREE.Vector3[]): number[] {
  const used = new Set<number>();
  return macros.map(macro => {
    let bestIndex = -1;
    let bestDot = -Infinity;
    for (let index = 0; index < candidates.length; index++) {
      if (used.has(index)) continue;
      const dot = macro.dot(candidates[index]!);
      if (dot > bestDot + EPSILON || (Math.abs(dot - bestDot) <= EPSILON && index < bestIndex)) {
        bestDot = dot;
        bestIndex = index;
      }
    }
    if (bestIndex < 0) throw new Error('Not enough distinct Fibonacci candidates for macro directions');
    used.add(bestIndex);
    return bestIndex;
  });
}

function stableHash(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function seededPermutation(count: number, seed: number): number[] {
  const values = Array.from({ length: count }, (_, index) => index);
  const random = seededRandom(seed);
  for (let index = values.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [values[index], values[other]] = [values[other]!, values[index]!];
  }
  return values;
}

function macroSectorFor(direction: THREE.Vector3, macros: readonly THREE.Vector3[]): number {
  let best = 0;
  let bestDot = -Infinity;
  for (let index = 0; index < macros.length; index++) {
    const dot = direction.dot(macros[index]!);
    if (dot > bestDot + EPSILON || (Math.abs(dot - bestDot) <= EPSILON && index < best)) {
      best = index;
      bestDot = dot;
    }
  }
  return best;
}

function candidateSectors(candidates: readonly THREE.Vector3[], macros: readonly THREE.Vector3[]): number[][] {
  const sectors = Array.from({ length: macros.length }, () => [] as number[]);
  candidates.forEach((candidate, index) => sectors[macroSectorFor(candidate, macros)]!.push(index));
  sectors.forEach((indices, macroIndex) => indices.sort((a, b) => macros[macroIndex]!.dot(candidates[b]!) - macros[macroIndex]!.dot(candidates[a]!) || a - b));
  return sectors;
}

function basis(direction: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  const ref = Math.abs(direction.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = ref.clone().cross(direction).normalize();
  return [u, direction.clone().cross(u).normalize()];
}

function anchorOffset(component: SolvedComponent, byId: Map<string, LayoutNode>, boundaries: SemanticBoundaries): number {
  const outer = component.local.filter(local => layerOf(byId.get(local.id)!) === 'outer').sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id));
  if (outer.length) return boundaries.bluePurple - outer[0]!.depth * LAYOUT_UNIT;

  const middle = component.local.some(local => layerOf(byId.get(local.id)!) === 'middle');
  const inner = component.local.filter(local => layerOf(byId.get(local.id)!) === 'inner').sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id));
  if (middle && inner.length) return boundaries.cyanBlue - inner[0]!.depth * LAYOUT_UNIT;

  return Math.max(2 * LAYOUT_UNIT, component.local.reduce((minimum, local) => {
    const layer = layerOf(byId.get(local.id)!);
    const shell = layer === 'middle' ? boundaries.cyanBlue : layer === 'outer' ? boundaries.bluePurple : LAYOUT_UNIT;
    return Math.max(minimum, shell - local.depth * LAYOUT_UNIT);
  }, 0));
}

function idealWorld(local: LocalNode, direction: THREE.Vector3, offset: number): THREE.Vector3 {
  const [u, v] = basis(direction);
  return direction.clone().multiplyScalar(offset + local.depth * LAYOUT_UNIT)
    .addScaledVector(u, LAYOUT_UNIT * (local.q + local.r / 2))
    .addScaledVector(v, LAYOUT_UNIT * Math.sqrt(3) * local.r / 2);
}

function fccIndexKey(index: FccIndex): string { return `${index[0]}:${index[1]}:${index[2]}`; }
function isFccIndex(i: number, j: number, k: number): boolean { return ((i + j + k) & 1) === 0; }
function fccIndexToWorld(index: FccIndex): THREE.Vector3 {
  return new THREE.Vector3(index[0] * FCC_AXIS_STEP, index[1] * FCC_AXIS_STEP, index[2] * FCC_AXIS_STEP);
}

export function snapToNearestFcc(position: THREE.Vector3): THREE.Vector3 {
  const base: FccIndex = [
    Math.round(position.x / FCC_AXIS_STEP),
    Math.round(position.y / FCC_AXIS_STEP),
    Math.round(position.z / FCC_AXIS_STEP),
  ];
  let best: FccIndex | null = null;
  let bestDistance = Infinity;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
    const candidate: FccIndex = [base[0] + dx, base[1] + dy, base[2] + dz];
    if (!isFccIndex(candidate[0], candidate[1], candidate[2])) continue;
    const world = fccIndexToWorld(candidate);
    const distance = world.distanceToSquared(position);
    if (distance < bestDistance - EPSILON || (Math.abs(distance - bestDistance) <= EPSILON && (!best || fccIndexKey(candidate) < fccIndexKey(best)))) {
      best = candidate;
      bestDistance = distance;
    }
  }
  if (!best) throw new Error('FCC snap failed');
  return fccIndexToWorld(best);
}

function fccIndexFromWorld(position: THREE.Vector3): FccIndex {
  return [
    Math.round(position.x / FCC_AXIS_STEP),
    Math.round(position.y / FCC_AXIS_STEP),
    Math.round(position.z / FCC_AXIS_STEP),
  ];
}

export function positionsCollide(a: THREE.Vector3, b: THREE.Vector3): boolean {
  const threshold = EXCLUSION_RADIUS + EPSILON;
  return a.distanceToSquared(b) <= threshold * threshold;
}

class FccOccupancy {
  private readonly occupied = new Set<string>();
  private readonly reserved = new Set<string>();

  canPlace(positions: readonly THREE.Vector3[]): boolean {
    const local = new Set<string>();
    for (const position of positions) {
      const key = fccIndexKey(fccIndexFromWorld(position));
      if (local.has(key) || this.reserved.has(key)) return false;
      local.add(key);
    }
    return true;
  }

  add(position: THREE.Vector3): void {
    const center = fccIndexFromWorld(position);
    this.occupied.add(fccIndexKey(center));
    const reach = Math.ceil(EXCLUSION_RADIUS / FCC_AXIS_STEP);
    for (let dx = -reach; dx <= reach; dx++) for (let dy = -reach; dy <= reach; dy++) for (let dz = -reach; dz <= reach; dz++) {
      const candidate: FccIndex = [center[0] + dx, center[1] + dy, center[2] + dz];
      if (!isFccIndex(candidate[0], candidate[1], candidate[2])) continue;
      if (fccIndexToWorld(candidate).distanceToSquared(position) <= EXCLUSION_RADIUS * EXCLUSION_RADIUS + EPSILON) this.reserved.add(fccIndexKey(candidate));
    }
  }

  occupiedKeys(): ReadonlySet<string> { return new Set(this.occupied); }
  reservedKeys(): ReadonlySet<string> { return new Set(this.reserved); }
}

function placeLineage(nodes: LayoutNode[]): void {
  const groups = new Map<string, LayoutNode[]>();
  for (const node of nodes) if (node.lineage && node.type !== 'reasoning') {
    const id = topicIdFor(node);
    const group = groups.get(id) ?? [];
    group.push(node);
    groups.set(id, group);
  }
  for (const members of groups.values()) {
    const current = members.find(node => lineageRoleFor(node) === 'current' && node.lineage?.reasoningSide !== 'opposition');
    if (!current?.pos) continue;
    const [u, v] = basis(current.pos.clone().normalize());
    const others = members.filter(node => node !== current).sort((a, b) => a.id.localeCompare(b.id));
    others.forEach((node, index) => setPosition(node, current.pos!.clone().addScaledVector(index % 2 ? v : u, LAYOUT_UNIT * (Math.floor(index / 2) + 1) * (node.lineage?.reasoningSide === 'opposition' ? -1 : 1))));
  }
}

function placeReasoning(nodes: LayoutNode[], graph: Graph): void {
  const byId = new Map(nodes.map(node => [node.id, node]));
  for (const relation of graph.relations) {
    const reasoning = byId.get(relation.id);
    if (!reasoning || !relation.premises.length || !relation.conclusions.length) continue;
    const mean = (ids: string[]) => ids.reduce((sum, id) => sum.add(byId.get(id)?.pos ?? new THREE.Vector3()), new THREE.Vector3()).multiplyScalar(1 / ids.length);
    setPosition(reasoning, mean(relation.premises).add(mean(relation.conclusions)).multiplyScalar(0.5));
  }
}

function graphSignature(nodes: readonly LayoutNode[]): string {
  return [...nodes].sort((a, b) => a.id.localeCompare(b.id)).map(node => `${node.id}:${node.type ?? ''}:${[...(node.premises ?? [])].sort().join(',')}:${node.effectiveLayer ?? node.layer ?? node.declaredLayer ?? ''}:${node.hidden ? 1 : 0}:${node.lineage?.topicId ?? ''}:${node.lineage?.role ?? ''}:${node.lineage?.reasoningSide ?? ''}`).join('|');
}

export function applyDeterministic5RLayout<T extends LayoutNode>(nodes: T[]): T[] {
  const signature = graphSignature(nodes);
  if (layoutCache?.signature === signature) {
    for (const node of nodes) {
      const position = layoutCache.positions.get(node.id);
      if (position) setPosition(node, position);
    }
    lastDiagnostics = layoutCache.diagnostics;
    return nodes;
  }

  const graph = buildGraph(nodes);
  const byId = new Map(nodes.map(node => [node.id, node]));
  const boundaries = computeSemanticBoundaries(nodes);
  const metadata = buildComponentMetadata(graph);
  const processingOrder = [...metadata].sort(compareHardness);
  const candidateCount = Math.max(MIN_ANGLE_COUNT, processingOrder.length);
  const candidates = fibonacciDirections(candidateCount);
  const macros = icosahedronMacroDirections();
  const macroCandidates = mapMacroDirectionsToCandidates(macros, candidates);
  const sectors = candidateSectors(candidates, macros);
  const graphSeed = stableHash(signature);
  const top = selectTopComponents(processingOrder);
  const macroOrder = seededPermutation(MACRO_DIRECTION_COUNT, graphSeed ^ 0x9e3779b9);
  const macroAssignments = new Map<string, number>();
  top.forEach((component, index) => macroAssignments.set(component.id, macroOrder[index]!));

  const occupancy = new FccOccupancy();
  const usedAngles = new Set<number>();
  const placed: Placed[] = [];
  let expansionCount = 0;

  for (const metadataComponent of processingOrder) {
    const component = solveComponent(metadataComponent, graph);
    const macroIndex = macroAssignments.get(component.id);
    const fixedOrder = macroIndex === undefined
      ? seededPermutation(candidateCount, graphSeed ^ stableHash(component.id) ^ 0x85ebca6b)
      : [macroCandidates[macroIndex]!, ...sectors[macroIndex]!.filter(index => index !== macroCandidates[macroIndex])];
    let radialExtra = 0;
    let success = false;

    while (!success) {
      const tried = new Set<number>();
      for (const angle of fixedOrder) {
        if (usedAngles.has(angle) || tried.has(angle)) continue;
        tried.add(angle);
        const direction = candidates[angle]!;
        const offset = anchorOffset(component, byId, boundaries) + radialExtra;
        const positions = component.local.map(local => snapToNearestFcc(idealWorld(local, direction, offset)));
        if (!occupancy.canPlace(positions)) continue;

        component.local.forEach((local, index) => setPosition(byId.get(local.id)!, positions[index]!));
        positions.forEach(position => occupancy.add(position));
        usedAngles.add(angle);
        placed.push({ component, angle, direction, radialExtra, positions });
        success = true;
        break;
      }

      if (!success) {
        radialExtra += EXPANSION_UNIT;
        expansionCount++;
      }
    }
  }

  for (const node of nodes.filter(node => isSystemCoreNodeId(node.id))) {
    const index = Math.max(0, SUN_TRIAD_IDS.indexOf(node.id as never));
    const angle = index * Math.PI * 2 / SUN_TRIAD_IDS.length;
    setPosition(node, new THREE.Vector3(Math.cos(angle) * SUN_ORBIT_RADIUS, Math.sin(angle) * SUN_ORBIT_RADIUS, 0));
  }
  placeReasoning(nodes, graph);
  placeLineage(nodes);

  const componentOrders = new Map(placed.map(item => [item.component.id, item.component.local.slice().sort((a, b) => a.depth - b.depth || a.q - b.q || a.r - b.r || a.id.localeCompare(b.id)).map(node => node.id)]));
  lastDiagnostics = Object.freeze({
    boundaries,
    occupiedCells: occupancy.occupiedKeys(),
    reservedCells: occupancy.reservedKeys(),
    usedAngles: new Map(placed.map(item => [item.component.id, item.angle])),
    componentOrders,
    macroCandidateAngles: [...macroCandidates],
    macroAssignments: new Map(macroAssignments),
    expansionCount,
  });
  layoutCache = { signature, positions: new Map(nodes.filter(node => node.pos).map(node => [node.id, node.pos!.clone()])), diagnostics: lastDiagnostics };
  return nodes;
}

let lastDiagnostics: LayoutDiagnostics | null = null;
let layoutCache: { signature: string; positions: Map<string, THREE.Vector3>; diagnostics: LayoutDiagnostics } | null = null;
export function getLastLayoutDiagnostics(): LayoutDiagnostics | null { return lastDiagnostics; }

export function countLayerCrossings(nodes: readonly LayoutNode[]): number {
  const graph = buildGraph([...nodes]);
  const ids = graph.knowledge.map(node => node.id);
  const depth = depthsFor(ids, graph);
  const layers = new Map<number, string[]>();
  for (const id of ids.sort()) {
    const d = depth.get(id)!;
    const values = layers.get(d) ?? [];
    values.push(id);
    layers.set(d, values);
  }
  return crossingCount(layers, graph, depth);
}
