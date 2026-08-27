import * as THREE from 'three';
import { isSystemCoreNodeId } from '../../domain/KnowledgeLayerPolicy';
import { lineageRoleFor, topicIdFor, type KnowledgeLineageMeta } from '../../domain/KnowledgeLineage';
import { SUN_ORBIT_RADIUS, SUN_TRIAD_IDS } from '../config/KnowledgeUiConfig';

export const KNOWLEDGE_BALL_RADIUS = 7.2;
export const LAYOUT_UNIT = 5 * KNOWLEDGE_BALL_RADIUS;
export const CROSSING_SWEEP_LIMIT = 12;

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
  usedAngles: ReadonlyMap<string, number>;
  componentOrders: ReadonlyMap<string, readonly string[]>;
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
type Component = { id: string; ids: string[]; relations: Relation[]; local: LocalNode[]; branching: number; layers: number };
type Placed = { component: Component; angle: number; direction: THREE.Vector3; offset: number; cells: string[] };

const EPSILON = 1e-8;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const MIN_ANGLE_COUNT = 89;

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

/** Capacity is measured in occupancy cells; every returned boundary is snapped upward to L. */
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
    adjacency.get(from)?.add(to); adjacency.get(to)?.add(from);
    outgoing.get(from)?.add(to); incoming.get(to)?.add(from);
  };
  for (const relation of relations) for (const premise of relation.premises) for (const conclusion of relation.conclusions) connect(premise, conclusion);
  for (const node of knowledge) for (const premise of node.premises ?? []) if (ids.has(premise)) connect(premise, node.id);
  return { knowledge, relations, adjacency, outgoing, incoming };
}

function components(graph: Graph): string[][] {
  const result: string[][] = [], seen = new Set<string>();
  for (const seed of graph.knowledge.map(node => node.id).sort()) {
    if (seen.has(seed)) continue;
    const queue = [seed], ids: string[] = []; seen.add(seed);
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i]!; ids.push(id);
      for (const next of [...(graph.adjacency.get(id) ?? [])].sort()) if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
    result.push(ids.sort());
  }
  return result;
}

function depthsFor(ids: readonly string[], graph: Graph): Map<string, number> {
  const set = new Set(ids), indegree = new Map<string, number>(), depth = new Map<string, number>();
  for (const id of ids) {
    const n = [...(graph.incoming.get(id) ?? [])].filter(parent => set.has(parent)).length;
    indegree.set(id, n); if (!n) depth.set(id, 0);
  }
  const queue = ids.filter(id => indegree.get(id) === 0).sort();
  for (let i = 0; i < queue.length; i++) for (const child of [...(graph.outgoing.get(queue[i]!) ?? [])].filter(id => set.has(id)).sort()) {
    depth.set(child, Math.max(depth.get(child) ?? 0, (depth.get(queue[i]!) ?? 0) + 1));
    indegree.set(child, (indegree.get(child) ?? 0) - 1); if (indegree.get(child) === 0) queue.push(child);
  }
  const fallback = Math.max(0, ...depth.values()) + 1;
  for (const id of ids) if (!depth.has(id)) depth.set(id, fallback);
  return depth;
}

function crossingCount(layers: Map<number, string[]>, graph: Graph): number {
  const order = new Map<string, number>(); for (const ids of layers.values()) ids.forEach((id, i) => order.set(id, i));
  let count = 0;
  const edges = [...graph.outgoing].flatMap(([a, bs]) => [...bs].map(b => [a, b] as const));
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    const [a, b] = edges[i]!, [c, d] = edges[j]!;
    if ((order.get(a)! - order.get(c)!) * (order.get(b)! - order.get(d)!) < 0) count++;
  }
  return count;
}

/** Deterministic median/barycenter sweeps; no second tangent dimension exists. */
function minimizeCrossings(ids: readonly string[], depth: Map<string, number>, graph: Graph): Map<number, string[]> {
  const layers = new Map<number, string[]>();
  for (const id of ids) { const d = depth.get(id)!; const layer = layers.get(d) ?? []; layer.push(id); layers.set(d, layer); }
  for (const layer of layers.values()) layer.sort();
  let best = new Map([...layers].map(([d, values]) => [d, [...values]])), bestCount = crossingCount(layers, graph);
  const depthKeys = [...layers.keys()].sort((a, b) => a - b);
  for (let pass = 0; pass < CROSSING_SWEEP_LIMIT; pass++) {
    const forward = pass % 2 === 0, scan = forward ? depthKeys : [...depthKeys].reverse();
    const positions = () => new Map([...layers.values()].flatMap(values => values.map((id, i) => [id, i] as const)));
    for (const d of scan) {
      const pos = positions();
      layers.get(d)!.sort((a, b) => {
        const neighbors = (id: string) => [...(forward ? graph.incoming.get(id) ?? [] : graph.outgoing.get(id) ?? [])].map(id => pos.get(id)).filter((x): x is number => x !== undefined).sort((x, y) => x - y);
        const score = (id: string) => { const n = neighbors(id); return n.length ? n.reduce((x, y) => x + y, 0) / n.length : pos.get(id)!; };
        return score(a) - score(b) || a.localeCompare(b);
      });
    }
    const count = crossingCount(layers, graph);
    const signature = [...layers].flatMap(([d, values]) => values.map(id => `${d}:${id}`)).join('|');
    const bestSignature = [...best].flatMap(([d, values]) => values.map(id => `${d}:${id}`)).join('|');
    if (count < bestCount || (count === bestCount && signature < bestSignature)) { bestCount = count; best = new Map([...layers].map(([d, values]) => [d, [...values]])); }
  }
  return best;
}

function buildComponents(graph: Graph): Component[] {
  const byId = new Map(graph.knowledge.map(node => [node.id, node]));
  return components(graph).map(ids => {
    const depth = depthsFor(ids, graph), ordered = minimizeCrossings(ids, depth, graph), local: LocalNode[] = [];
    for (const [d, layer] of [...ordered].sort(([a], [b]) => a - b)) layer.forEach((id, index) => local.push({ id, depth: d, q: index - Math.floor((layer.length - 1) / 2), r: 0 }));
    const relations = graph.relations.filter(relation => [...relation.premises, ...relation.conclusions].some(id => ids.includes(id)));
    const branching = relations.reduce((sum, relation) => sum + Math.max(0, relation.premises.length + relation.conclusions.length - 2), 0);
    return { id: ids[0]!, ids, relations, local, branching, layers: new Set(ids.map(id => layerOf(byId.get(id)!))).size };
  }).sort((a, b) => b.ids.length - a.ids.length || b.layers - a.layers || b.branching - a.branching || a.id.localeCompare(b.id));
}

function directions(count: number): THREE.Vector3[] {
  return Array.from({ length: count }, (_, index) => {
    const z = 1 - 2 * ((index + 0.5) / count), radius = Math.sqrt(1 - z * z), phi = index * GOLDEN_ANGLE;
    return new THREE.Vector3(Math.cos(phi) * radius, Math.sin(phi) * radius, z);
  });
}

function chooseAngles(used: Set<number>, candidates: readonly THREE.Vector3[]): number[] {
  // A production-scale graph can contain thousands of singleton components. The
  // Fibonacci sequence is itself a deterministic progressive largest-gap fill;
  // avoid rebuilding an O(n^2) all-pairs gap table for that equivalent prefix.
  if (candidates.length > 512) {
    for (let index = 0; index < candidates.length; index++) if (!used.has(index)) return [index];
    return [];
  }
  return candidates.map((direction, index) => ({ index, gap: used.size ? Math.min(...[...used].map(other => direction.angleTo(candidates[other]!))) : Math.PI }))
    .filter(candidate => !used.has(candidate.index)).sort((a, b) => b.gap - a.gap || a.index - b.index).map(candidate => candidate.index);
}

function basis(direction: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  const ref = Math.abs(direction.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = ref.cross(direction).normalize(); return [u, direction.clone().cross(u).normalize()];
}

function minimumRadius(component: Component, byId: Map<string, LayoutNode>, boundaries: SemanticBoundaries): number {
  let offset = 2 * LAYOUT_UNIT;
  for (const local of component.local) {
    const layer = layerOf(byId.get(local.id)!);
    const minimum = layer === 'outer' ? boundaries.bluePurple : layer === 'middle' ? boundaries.cyanBlue : LAYOUT_UNIT;
    offset = Math.max(offset, minimum - local.depth * LAYOUT_UNIT);
  }
  return Math.ceil(offset / LAYOUT_UNIT) * LAYOUT_UNIT;
}

function world(local: LocalNode, direction: THREE.Vector3, offset: number): THREE.Vector3 {
  const [u, v] = basis(direction);
  return direction.clone().multiplyScalar(offset + local.depth * LAYOUT_UNIT)
    .addScaledVector(u, LAYOUT_UNIT * (local.q + local.r / 2)).addScaledVector(v, LAYOUT_UNIT * Math.sqrt(3) * local.r / 2);
}

function cellKey(position: THREE.Vector3): string {
  return [position.x, position.y, position.z].map(value => Math.round(value / (LAYOUT_UNIT * 1e-5))).join(':');
}

function placeLineage(nodes: LayoutNode[]): void {
  const groups = new Map<string, LayoutNode[]>();
  for (const node of nodes) if (node.lineage && node.type !== 'reasoning') { const id = topicIdFor(node), group = groups.get(id) ?? []; group.push(node); groups.set(id, group); }
  for (const members of groups.values()) {
    const current = members.find(node => lineageRoleFor(node) === 'current' && node.lineage?.reasoningSide !== 'opposition');
    if (!current?.pos) continue; const [u, v] = basis(current.pos.clone().normalize());
    const others = members.filter(node => node !== current).sort((a, b) => a.id.localeCompare(b.id));
    others.forEach((node, i) => setPosition(node, current.pos!.clone().addScaledVector(i % 2 ? v : u, LAYOUT_UNIT * (Math.floor(i / 2) + 1) * (node.lineage?.reasoningSide === 'opposition' ? -1 : 1))));
  }
}

function placeReasoning(nodes: LayoutNode[], graph: Graph): void {
  const byId = new Map(nodes.map(node => [node.id, node]));
  for (const relation of graph.relations) {
    const reasoning = byId.get(relation.id); if (!reasoning) continue;
    const mean = (ids: string[]) => ids.reduce((sum, id) => sum.add(byId.get(id)?.pos ?? new THREE.Vector3()), new THREE.Vector3()).multiplyScalar(1 / ids.length);
    if (relation.premises.length && relation.conclusions.length) setPosition(reasoning, mean(relation.premises).add(mean(relation.conclusions)).multiplyScalar(0.5));
  }
}

export function applyDeterministic5RLayout<T extends LayoutNode>(nodes: T[]): T[] {
  const signature = nodes.map(node => `${node.id}:${node.type ?? ''}:${(node.premises ?? []).join(',')}:${node.effectiveLayer ?? node.layer ?? node.declaredLayer ?? ''}:${node.hidden ? 1 : 0}:${node.lineage?.topicId ?? ''}:${node.lineage?.role ?? ''}`).join('|');
  if (layoutCache?.signature === signature) {
    for (const node of nodes) {
      const position = layoutCache.positions.get(node.id);
      if (position) setPosition(node, position);
    }
    lastDiagnostics = layoutCache.diagnostics;
    return nodes;
  }
  const graph = buildGraph(nodes), byId = new Map(nodes.map(node => [node.id, node])), boundaries = computeSemanticBoundaries(nodes);
  const layoutComponents = buildComponents(graph);
  const occupied = new Set<string>(), usedAngles = new Set<number>(), placed: Placed[] = [], candidates = directions(Math.max(MIN_ANGLE_COUNT, layoutComponents.length)); let expansionCount = 0;
  for (const component of layoutComponents) {
    let success = false;
    while (!success) {
      for (const angle of chooseAngles(usedAngles, candidates)) {
        const direction = candidates[angle]!, offset = minimumRadius(component, byId, boundaries) + expansionCount * LAYOUT_UNIT;
        const positions = component.local.map(local => world(local, direction, offset)), cells = positions.map(cellKey);
        if (new Set(cells).size !== cells.length || cells.some(key => occupied.has(key))) continue;
        component.local.forEach((local, i) => setPosition(byId.get(local.id)!, positions[i]!));
        cells.forEach(key => occupied.add(key)); usedAngles.add(angle); placed.push({ component, angle, direction, offset, cells }); success = true; break;
      }
      if (!success) {
        expansionCount++;
        for (const prior of placed) {
          prior.cells.forEach(key => occupied.delete(key)); prior.offset += LAYOUT_UNIT;
          const positions = prior.component.local.map(local => world(local, prior.direction, prior.offset)); prior.cells = positions.map(cellKey);
          prior.component.local.forEach((local, i) => setPosition(byId.get(local.id)!, positions[i]!)); prior.cells.forEach(key => occupied.add(key));
        }
      }
    }
  }
  for (const node of nodes.filter(node => isSystemCoreNodeId(node.id))) { const i = Math.max(0, SUN_TRIAD_IDS.indexOf(node.id as never)), a = i * Math.PI * 2 / SUN_TRIAD_IDS.length; setPosition(node, new THREE.Vector3(Math.cos(a) * SUN_ORBIT_RADIUS, Math.sin(a) * SUN_ORBIT_RADIUS, 0)); }
  placeReasoning(nodes, graph); placeLineage(nodes);
  const orders = new Map(placed.map(item => [item.component.id, item.component.local.slice().sort((a, b) => a.depth - b.depth || a.q - b.q || a.id.localeCompare(b.id)).map(node => node.id)]));
  lastDiagnostics = Object.freeze({ boundaries, occupiedCells: new Set(occupied), usedAngles: new Map(placed.map(item => [item.component.id, item.angle])), componentOrders: orders, expansionCount });
  layoutCache = { signature, positions: new Map(nodes.filter(node => node.pos).map(node => [node.id, node.pos!.clone()])), diagnostics: lastDiagnostics };
  return nodes;
}

let lastDiagnostics: LayoutDiagnostics | null = null;
let layoutCache: { signature: string; positions: Map<string, THREE.Vector3>; diagnostics: LayoutDiagnostics } | null = null;
export function getLastLayoutDiagnostics(): LayoutDiagnostics | null { return lastDiagnostics; }

export function countLayerCrossings(nodes: readonly LayoutNode[]): number {
  const graph = buildGraph([...nodes]), depth = depthsFor(graph.knowledge.map(node => node.id), graph);
  const layers = new Map<number, string[]>();
  for (const node of graph.knowledge) { const d = depth.get(node.id)!; const values = layers.get(d) ?? []; values.push(node.id); layers.set(d, values); }
  return crossingCount(layers, graph);
}
