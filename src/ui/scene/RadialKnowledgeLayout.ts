import * as THREE from 'three';
import { isSystemCoreNodeId } from '../../domain/KnowledgeLayerPolicy';
import {
  lineageRoleFor,
  topicIdFor,
  type KnowledgeLineageMeta,
} from '../../domain/KnowledgeLineage';
import { SUN_ORBIT_RADIUS, SUN_TRIAD_IDS } from '../config/KnowledgeUiConfig';

/** Canonical phase-1 geometry. */
export const RADIAL_LAYOUT_NODE_RADIUS = 7.2;
export const RADIAL_LAYOUT_LINK_LENGTH = RADIAL_LAYOUT_NODE_RADIUS * 5;
export const RADIAL_LAYOUT_PLANE_EDGE_LENGTH = RADIAL_LAYOUT_LINK_LENGTH;
export const RADIAL_LAYOUT_MIN_PLANE_SPACING = RADIAL_LAYOUT_PLANE_EDGE_LENGTH;

const CHAIN_START_RADIUS = RADIAL_LAYOUT_LINK_LENGTH * 2;
const MAX_COMPONENT_Z = 0.65;
const EPSILON = 1e-9;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export interface RadialKnowledgeLayoutNode {
  id: string;
  type?: string;
  premises?: string[];
  hidden?: boolean;
  lineage?: KnowledgeLineageMeta;
  pos?: THREE.Vector3;
  homePos?: THREE.Vector3;
  vel?: THREE.Vector3;
}

type Basis = {
  radial: THREE.Vector3;
  u: THREE.Vector3;
  v: THREE.Vector3;
};

type CompressedKnowledgeGraph = {
  knowledgeNodes: RadialKnowledgeLayoutNode[];
  adjacency: Map<string, Set<string>>;
  outgoing: Map<string, Set<string>>;
  incoming: Map<string, Set<string>>;
};

function setPosition(node: RadialKnowledgeLayoutNode, position: THREE.Vector3): void {
  node.pos = position.clone();
  node.homePos = position.clone();
  node.vel ??= new THREE.Vector3();
  node.vel.set(0, 0, 0);
}

function clearLayoutPosition(node: RadialKnowledgeLayoutNode): void {
  node.pos = undefined;
  node.homePos = undefined;
  node.vel ??= new THREE.Vector3();
  node.vel.set(0, 0, 0);
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

function componentDirection(index: number, count: number): THREE.Vector3 {
  if (count <= 1) return new THREE.Vector3(1, 0, 0);
  const z = MAX_COMPONENT_Z * (1 - 2 * ((index + 0.5) / count));
  const phi = index * GOLDEN_ANGLE;
  const xy = Math.sqrt(Math.max(0, 1 - z * z));
  return new THREE.Vector3(xy * Math.cos(phi), xy * Math.sin(phi), z).normalize();
}

function axialToPlane(q: number, r: number, edgeLength: number): THREE.Vector2 {
  return new THREE.Vector2(
    edgeLength * (q + r / 2),
    edgeLength * (Math.sqrt(3) / 2) * r,
  );
}

function ringAxialCoordinates(radius: number): Array<[number, number]> {
  const result: Array<[number, number]> = [];
  for (let q = -radius; q <= radius; q += 1) {
    for (let r = -radius; r <= radius; r += 1) {
      const s = -q - r;
      if (Math.max(Math.abs(q), Math.abs(r), Math.abs(s)) !== radius) continue;
      result.push([q, r]);
    }
  }
  return result.sort((left, right) => {
    const a = axialToPlane(left[0], left[1], 1);
    const b = axialToPlane(right[0], right[1], 1);
    return Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x);
  });
}

function evenlySampleRing<T>(items: readonly T[], count: number): T[] {
  if (count >= items.length) return [...items];
  return Array.from({ length: count }, (_, index) =>
    items[Math.floor(index * items.length / count)]!,
  );
}

/**
 * Compact points on a triangular/hexagonal lattice with nearest-neighbour edge L.
 * 3 points are an exact equilateral triangle; 7 points are center + regular hexagon.
 */
export function compactTriangularPlaneOffsets(
  count: number,
  edgeLength = RADIAL_LAYOUT_PLANE_EDGE_LENGTH,
): THREE.Vector2[] {
  if (count <= 0) return [];
  if (count === 1) return [new THREE.Vector2(0, 0)];
  if (count === 2) {
    return [
      new THREE.Vector2(-edgeLength / 2, 0),
      new THREE.Vector2(edgeLength / 2, 0),
    ];
  }
  if (count === 3) {
    const h = Math.sqrt(3) * edgeLength / 2;
    return [
      new THREE.Vector2(-edgeLength / 2, -h / 3),
      new THREE.Vector2(edgeLength / 2, -h / 3),
      new THREE.Vector2(0, h * 2 / 3),
    ];
  }

  const points = [new THREE.Vector2(0, 0)];
  let remaining = count - 1;
  let radius = 1;
  while (remaining > 0) {
    const ring = ringAxialCoordinates(radius);
    const take = Math.min(remaining, ring.length);
    for (const [q, r] of evenlySampleRing(ring, take)) {
      points.push(axialToPlane(q, r, edgeLength));
    }
    remaining -= take;
    radius += 1;
  }

  const centroid = points.reduce(
    (sum, point) => sum.add(point),
    new THREE.Vector2(),
  ).multiplyScalar(1 / points.length);
  return points.map(point => point.clone().sub(centroid));
}

export function positionsOnTriangularPlane(
  center: THREE.Vector3,
  radialDirection: THREE.Vector3,
  count: number,
  edgeLength = RADIAL_LAYOUT_PLANE_EDGE_LENGTH,
): THREE.Vector3[] {
  const { u, v } = tangentBasis(radialDirection);
  return compactTriangularPlaneOffsets(count, edgeLength).map(offset =>
    center.clone()
      .addScaledVector(u, offset.x)
      .addScaledVector(v, offset.y),
  );
}

function isReasoning(node: RadialKnowledgeLayoutNode): boolean {
  return node.type === 'reasoning';
}

function isPrimaryCurrentNode(node: RadialKnowledgeLayoutNode): boolean {
  if (isSystemCoreNodeId(node.id)) return false;
  if (node.hidden && !node.lineage) return false;
  if (lineageRoleFor(node) !== 'current') return false;
  return node.lineage?.reasoningSide !== 'opposition';
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

/**
 * Reasoning nodes are deliberately removed from the primary layout graph.
 * premise -> reasoning -> conclusion becomes premise -> conclusion for geometry.
 * The reasoning ball is inserted afterwards at the midpoint of both side centres.
 */
function buildCompressedKnowledgeGraph(nodes: RadialKnowledgeLayoutNode[]): CompressedKnowledgeGraph {
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
  nodeIds: string[],
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
  return components.sort((left, right) => left[0]!.localeCompare(right[0]!));
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
  for (const id of component) {
    if (!depth.has(id)) depth.set(id, maxKnownDepth + 1);
  }
  return depth;
}

function relationOrderKey(
  id: string,
  incoming: ReadonlyMap<string, ReadonlySet<string>>,
  outgoing: ReadonlyMap<string, ReadonlySet<string>>,
): string {
  const parents = [...(incoming.get(id) ?? [])].sort().join(',');
  const children = [...(outgoing.get(id) ?? [])].sort().join(',');
  return `${parents}|${children}|${id}`;
}

function placeCompressedComponent(
  component: readonly string[],
  byId: ReadonlyMap<string, RadialKnowledgeLayoutNode>,
  incoming: ReadonlyMap<string, ReadonlySet<string>>,
  outgoing: ReadonlyMap<string, ReadonlySet<string>>,
  direction: THREE.Vector3,
): void {
  const depths = computeDepths(component, incoming, outgoing);
  const groups = new Map<number, string[]>();
  for (const id of component) {
    const d = depths.get(id) ?? 0;
    const group = groups.get(d);
    if (group) group.push(id);
    else groups.set(d, [id]);
  }

  for (const depth of [...groups.keys()].sort((a, b) => a - b)) {
    const ids = groups.get(depth)!
      .sort((a, b) => relationOrderKey(a, incoming, outgoing).localeCompare(relationOrderKey(b, incoming, outgoing)));
    const planeCenter = direction.clone().multiplyScalar(
      CHAIN_START_RADIUS + depth * RADIAL_LAYOUT_LINK_LENGTH,
    );
    const positions = positionsOnTriangularPlane(
      planeCenter,
      direction,
      ids.length,
      RADIAL_LAYOUT_PLANE_EDGE_LENGTH,
    );
    ids.forEach((id, index) => {
      const node = byId.get(id);
      if (node) setPosition(node, positions[index]!);
    });
  }
}

function placeLineageBranches(nodes: RadialKnowledgeLayoutNode[]): void {
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
      lineageRoleFor(node) === 'current'
        && node.lineage?.reasoningSide !== 'opposition',
    );
    if (!base?.pos || base.pos.lengthSq() <= EPSILON) continue;
    const { u, v } = tangentBasis(base.pos);

    const grayHistory = members
      .filter(node => {
        const rank = node.lineage?.reasoningSideRank ?? node.lineage?.rank ?? 0;
        return rank > 0
          && node.lineage?.reasoningSide !== 'opposition'
          && (lineageRoleFor(node) === 'history' || lineageRoleFor(node) === 'candidate-history');
      })
      .sort((left, right) =>
        (left.lineage?.reasoningSideRank ?? left.lineage?.rank ?? 0)
        - (right.lineage?.reasoningSideRank ?? right.lineage?.rank ?? 0),
      );
    grayHistory.forEach((node, index) => {
      setPosition(node, base.pos!.clone().addScaledVector(u, RADIAL_LAYOUT_LINK_LENGTH * (index + 1)));
    });

    const oppositionHead = members.find(node =>
      node.lineage?.reasoningSide === 'opposition'
        && (node.lineage?.reasoningSideRank ?? 0) === 0,
    ) ?? members.find(node => lineageRoleFor(node) === 'opposition');
    if (oppositionHead) {
      setPosition(oppositionHead, base.pos.clone().addScaledVector(u, -RADIAL_LAYOUT_LINK_LENGTH));
    }

    const oppositionHistory = members
      .filter(node =>
        node !== oppositionHead
          && node.lineage?.reasoningSide === 'opposition'
          && (node.lineage?.reasoningSideRank ?? node.lineage?.rank ?? 0) > 0,
      )
      .sort((left, right) =>
        (left.lineage?.reasoningSideRank ?? left.lineage?.rank ?? 0)
        - (right.lineage?.reasoningSideRank ?? right.lineage?.rank ?? 0),
      );
    oppositionHistory.forEach((node, index) => {
      setPosition(node, base.pos!.clone().addScaledVector(u, -RADIAL_LAYOUT_LINK_LENGTH * (index + 2)));
    });

    const grayCandidate = members.find(node => lineageRoleFor(node) === 'candidate-history');
    if (grayCandidate) setPosition(grayCandidate, base.pos.clone().addScaledVector(v, RADIAL_LAYOUT_LINK_LENGTH));
    const redCandidate = members.find(node => lineageRoleFor(node) === 'candidate-opposition');
    if (redCandidate) setPosition(redCandidate, base.pos.clone().addScaledVector(v, -RADIAL_LAYOUT_LINK_LENGTH));
  }
}

function placeCoreNodes(nodes: RadialKnowledgeLayoutNode[]): void {
  for (const node of nodes) {
    if (!isSystemCoreNodeId(node.id)) continue;
    const index = Math.max(0, SUN_TRIAD_IDS.indexOf(node.id as (typeof SUN_TRIAD_IDS)[number]));
    const angle = index * Math.PI * 2 / SUN_TRIAD_IDS.length;
    setPosition(
      node,
      new THREE.Vector3(
        Math.cos(angle) * SUN_ORBIT_RADIUS,
        Math.sin(angle) * SUN_ORBIT_RADIUS,
        0,
      ),
    );
  }
}

function meanPosition(nodes: readonly RadialKnowledgeLayoutNode[]): THREE.Vector3 | null {
  const positioned = nodes.filter(
    (node): node is RadialKnowledgeLayoutNode & { pos: THREE.Vector3 } => Boolean(node.pos),
  );
  if (!positioned.length) return null;
  return positioned.reduce(
    (sum, node) => sum.add(node.pos),
    new THREE.Vector3(),
  ).multiplyScalar(1 / positioned.length);
}

/**
 * A reasoning ball does not influence the knowledge layout. After all knowledge
 * positions are fixed, it is inserted at the midpoint between the geometric
 * centre of its premise set and the geometric centre of its conclusion set:
 * R = (mean(P) + mean(C)) / 2.
 */
export function placeReasoningAtRelationCenters(nodes: RadialKnowledgeLayoutNode[]): void {
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
 * Runtime owner for the current chain geometry. Knowledge nodes are laid out on
 * radial planes first; reasoning nodes are excluded from that solve and inserted
 * afterwards at their relation geometry centres.
 */
export function applyRadialKnowledgeLayout<T extends RadialKnowledgeLayoutNode>(nodes: T[]): T[] {
  for (const node of nodes) {
    if (isReasoning(node)) clearLayoutPosition(node);
  }
  placeCoreNodes(nodes);

  const graph = buildCompressedKnowledgeGraph(nodes);
  const byId = new Map(graph.knowledgeNodes.map(node => [node.id, node] as const));
  const components = connectedComponents(graph.knowledgeNodes.map(node => node.id), graph.adjacency);
  components.forEach((component, index) => {
    placeCompressedComponent(
      component,
      byId,
      graph.incoming,
      graph.outgoing,
      componentDirection(index, components.length),
    );
  });

  placeLineageBranches(nodes);

  let reserveIndex = 0;
  for (const node of nodes) {
    if (isReasoning(node) || node.pos) continue;
    const direction = componentDirection(reserveIndex, Math.max(1, nodes.length));
    setPosition(
      node,
      direction.multiplyScalar(CHAIN_START_RADIUS + RADIAL_LAYOUT_LINK_LENGTH * 6),
    );
    reserveIndex += 1;
  }

  placeReasoningAtRelationCenters(nodes);
  return nodes;
}
