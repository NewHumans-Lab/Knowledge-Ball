import * as THREE from 'three';
import { isSystemCoreNodeId } from '../../domain/KnowledgeLayerPolicy';
import { lineageRoleFor, topicIdFor } from '../../domain/KnowledgeLineage';
import {
  RADIAL_LAYOUT_LINK_LENGTH,
  type RadialKnowledgeLayoutNode,
} from './RadialKnowledgeLayout';

export const RELATION_GROUP_BEAM_WIDTH = 96;
export const RELATION_GROUP_CANDIDATES_PER_STATE = 12;
export const RELATION_GROUP_TRANSLATION_RADIUS = 3;

const SQRT3_OVER_2 = Math.sqrt(3) / 2;
const EPSILON = 1e-8;
const AXIAL_DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1],
];

type Axial = { q: number; r: number };
type ContinuousAxial = { q: number; r: number };
type Basis = { radial: THREE.Vector3; u: THREE.Vector3; v: THREE.Vector3 };
type CompressedGraph = {
  knowledgeNodes: RadialKnowledgeLayoutNode[];
  adjacency: Map<string, Set<string>>;
  outgoing: Map<string, Set<string>>;
  incoming: Map<string, Set<string>>;
};
type RelationGroup = {
  id: string;
  anchorId: string;
  memberIds: string[];
  depth: number;
  kind: 'premises' | 'conclusions';
};
type PackingState = {
  coords: Map<string, Axial>;
  occupied: Map<string, string>;
  satisfied: RelationGroup[];
  centerError: number;
};
type Placement = {
  assignments: Map<string, Axial>;
  centerError: number;
};

function isReasoning(node: RadialKnowledgeLayoutNode): boolean {
  return node.type === 'reasoning';
}

function isPrimaryCurrentNode(node: RadialKnowledgeLayoutNode): boolean {
  if (isSystemCoreNodeId(node.id)) return false;
  if (node.hidden && !node.lineage) return false;
  if (lineageRoleFor(node) !== 'current') return false;
  return node.lineage?.reasoningSide !== 'opposition';
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
  const visited = new Set<string>();
  const components: string[][] = [];
  for (const seed of [...nodeIds].sort()) {
    if (visited.has(seed)) continue;
    visited.add(seed);
    const queue = [seed];
    const component: string[] = [];
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
  const depths = new Map<string, number>();
  for (const id of component) {
    const degree = [...(incoming.get(id) ?? [])].filter(parent => componentSet.has(parent)).length;
    indegree.set(id, degree);
    if (degree === 0) depths.set(id, 0);
  }

  const queue = component.filter(id => indegree.get(id) === 0).sort();
  let head = 0;
  while (head < queue.length) {
    const id = queue[head++]!;
    const baseDepth = depths.get(id) ?? 0;
    for (const childId of [...(outgoing.get(id) ?? [])].filter(id => componentSet.has(id)).sort()) {
      depths.set(childId, Math.max(depths.get(childId) ?? 0, baseDepth + 1));
      const remaining = (indegree.get(childId) ?? 0) - 1;
      indegree.set(childId, remaining);
      if (remaining === 0) queue.push(childId);
    }
  }

  const maxKnownDepth = Math.max(0, ...depths.values());
  for (const id of component) if (!depths.has(id)) depths.set(id, maxKnownDepth + 1);
  return depths;
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

function componentBasis(
  component: readonly string[],
  byId: ReadonlyMap<string, RadialKnowledgeLayoutNode>,
  depths: ReadonlyMap<string, number>,
): Basis | null {
  const minDepth = Math.min(...component.map(id => depths.get(id) ?? 0));
  const roots = component
    .filter(id => (depths.get(id) ?? 0) === minDepth)
    .map(id => byId.get(id))
    .filter((node): node is RadialKnowledgeLayoutNode & { pos: THREE.Vector3 } => Boolean(node?.pos));
  const fallback = component
    .map(id => byId.get(id))
    .filter((node): node is RadialKnowledgeLayoutNode & { pos: THREE.Vector3 } => Boolean(node?.pos));
  const anchors = roots.length ? roots : fallback;
  if (!anchors.length) return null;
  const direction = anchors
    .reduce((sum, node) => sum.add(node.pos), new THREE.Vector3())
    .multiplyScalar(1 / anchors.length);
  if (direction.lengthSq() <= EPSILON) direction.copy(anchors[0]!.pos);
  return direction.lengthSq() > EPSILON ? tangentBasis(direction) : null;
}

function axialKey(point: Axial): string {
  return `${point.q},${point.r}`;
}

function axialRadius(point: Axial): number {
  return Math.max(Math.abs(point.q), Math.abs(point.r), Math.abs(-point.q - point.r));
}

function axialDistance(a: Axial, b: Axial): number {
  return axialRadius({ q: a.q - b.q, r: a.r - b.r });
}

function axialToPlane(point: ContinuousAxial): THREE.Vector2 {
  return new THREE.Vector2(
    RADIAL_LAYOUT_LINK_LENGTH * (point.q + point.r / 2),
    RADIAL_LAYOUT_LINK_LENGTH * SQRT3_OVER_2 * point.r,
  );
}

function planeToAxial(point: THREE.Vector2): ContinuousAxial {
  const r = point.y / (RADIAL_LAYOUT_LINK_LENGTH * SQRT3_OVER_2);
  return { q: point.x / RADIAL_LAYOUT_LINK_LENGTH - r / 2, r };
}

function roundAxial(point: ContinuousAxial): Axial {
  let x = point.q;
  let z = point.r;
  let y = -x - z;
  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);
  const dx = Math.abs(rx - x);
  const dy = Math.abs(ry - y);
  const dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  x = rx; y = ry; z = rz;
  return { q: x, r: z };
}

function rotate60(point: Axial): Axial {
  return { q: -point.r, r: point.q + point.r };
}

function reflect(point: Axial): Axial {
  return { q: point.q, r: -point.q - point.r };
}

function transform(point: Axial, transformIndex: number): Axial {
  let result = transformIndex >= 6 ? reflect(point) : { ...point };
  for (let i = 0; i < transformIndex % 6; i += 1) result = rotate60(result);
  return result;
}

function translated(point: Axial, offset: Axial): Axial {
  return { q: point.q + offset.q, r: point.r + offset.r };
}

function compactTranslationOffsets(radius: number): Axial[] {
  const points: Axial[] = [];
  for (let q = -radius; q <= radius; q += 1) {
    for (let r = -radius; r <= radius; r += 1) {
      const point = { q, r };
      if (axialRadius(point) <= radius) points.push(point);
    }
  }
  return points.sort((a, b) => {
    const radiusDelta = axialRadius(a) - axialRadius(b);
    if (radiusDelta) return radiusDelta;
    const pa = axialToPlane(a);
    const pb = axialToPlane(b);
    const distanceDelta = pa.lengthSq() - pb.lengthSq();
    if (Math.abs(distanceDelta) > EPSILON) return distanceDelta;
    return Math.atan2(pa.y, pa.x) - Math.atan2(pb.y, pb.x);
  });
}

/**
 * Deterministic compact triangular-lattice growth. Each added point first tries
 * to touch as many already-placed points as possible, then stays on the smallest
 * shell. Three points therefore form one equilateral triangle; seven become one
 * centre plus a regular six-neighbour ring; eight continues outward compactly.
 */
export function compactRelationGroupAxialCoordinates(count: number): Array<[number, number]> {
  if (count <= 0) return [];
  const selected: Axial[] = [{ q: 0, r: 0 }];
  const selectedKeys = new Set([axialKey(selected[0]!)]);
  while (selected.length < count) {
    const candidates = new Map<string, Axial>();
    for (const point of selected) {
      for (const [dq, dr] of AXIAL_DIRECTIONS) {
        const candidate = { q: point.q + dq, r: point.r + dr };
        const key = axialKey(candidate);
        if (!selectedKeys.has(key)) candidates.set(key, candidate);
      }
    }
    const next = [...candidates.values()].sort((a, b) => {
      const adjacencyA = selected.filter(point => axialDistance(point, a) === 1).length;
      const adjacencyB = selected.filter(point => axialDistance(point, b) === 1).length;
      if (adjacencyA !== adjacencyB) return adjacencyB - adjacencyA;
      const radiusDelta = axialRadius(a) - axialRadius(b);
      if (radiusDelta) return radiusDelta;
      const pa = axialToPlane(a);
      const pb = axialToPlane(b);
      const lengthDelta = pa.lengthSq() - pb.lengthSq();
      if (Math.abs(lengthDelta) > EPSILON) return lengthDelta;
      const angleDelta = Math.atan2(pa.y, pa.x) - Math.atan2(pb.y, pb.x);
      if (Math.abs(angleDelta) > EPSILON) return angleDelta;
      return axialKey(a).localeCompare(axialKey(b));
    })[0]!;
    selected.push(next);
    selectedKeys.add(axialKey(next));
  }
  return selected.map(point => [point.q, point.r]);
}

function canonicalShape(count: number): Axial[] {
  return compactRelationGroupAxialCoordinates(count).map(([q, r]) => ({ q, r }));
}

function shapeCentroid(shape: readonly Axial[]): ContinuousAxial {
  return shape.reduce(
    (sum, point) => ({ q: sum.q + point.q, r: sum.r + point.r }),
    { q: 0, r: 0 },
  );
}

function normalizedCentroid(shape: readonly Axial[]): ContinuousAxial {
  const sum = shapeCentroid(shape);
  return { q: sum.q / shape.length, r: sum.r / shape.length };
}

function buildRelationGroups(
  component: readonly string[],
  depths: ReadonlyMap<string, number>,
  incoming: ReadonlyMap<string, ReadonlySet<string>>,
  outgoing: ReadonlyMap<string, ReadonlySet<string>>,
): RelationGroup[] {
  const componentSet = new Set(component);
  const groups: RelationGroup[] = [];

  const addDepthGroups = (
    kind: RelationGroup['kind'],
    anchorId: string,
    memberIds: string[],
  ) => {
    const byDepth = new Map<number, string[]>();
    for (const memberId of memberIds) {
      const depth = depths.get(memberId) ?? 0;
      const bucket = byDepth.get(depth);
      if (bucket) bucket.push(memberId);
      else byDepth.set(depth, [memberId]);
    }
    for (const [depth, members] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
      const uniqueMembers = [...new Set(members)].sort();
      if (uniqueMembers.length < 3) continue;
      groups.push({
        id: `${kind}:${anchorId}:${depth}:${uniqueMembers.join(',')}`,
        anchorId,
        memberIds: uniqueMembers,
        depth,
        kind,
      });
    }
  };

  for (const anchorId of [...component].sort()) {
    addDepthGroups(
      'premises',
      anchorId,
      [...(incoming.get(anchorId) ?? [])].filter(id => componentSet.has(id)).sort(),
    );
    addDepthGroups(
      'conclusions',
      anchorId,
      [...(outgoing.get(anchorId) ?? [])].filter(id => componentSet.has(id)).sort(),
    );
  }
  return groups.sort((a, b) => a.id.localeCompare(b.id));
}

function groupConflictComponents(groups: readonly RelationGroup[]): RelationGroup[][] {
  const byMember = new Map<string, RelationGroup[]>();
  for (const group of groups) {
    for (const memberId of group.memberIds) {
      const bucket = byMember.get(memberId);
      if (bucket) bucket.push(group);
      else byMember.set(memberId, [group]);
    }
  }
  const byId = new Map(groups.map(group => [group.id, group] as const));
  const visited = new Set<string>();
  const components: RelationGroup[][] = [];
  for (const seed of groups) {
    if (visited.has(seed.id)) continue;
    visited.add(seed.id);
    const queue = [seed.id];
    const component: RelationGroup[] = [];
    let head = 0;
    while (head < queue.length) {
      const id = queue[head++]!;
      const group = byId.get(id);
      if (!group) continue;
      component.push(group);
      for (const memberId of group.memberIds) {
        for (const neighbor of byMember.get(memberId) ?? []) {
          if (visited.has(neighbor.id)) continue;
          visited.add(neighbor.id);
          queue.push(neighbor.id);
        }
      }
    }
    components.push(component.sort((a, b) => a.id.localeCompare(b.id)));
  }
  return components.sort((a, b) => {
    const maxA = Math.max(...a.map(group => group.memberIds.length));
    const maxB = Math.max(...b.map(group => group.memberIds.length));
    if (maxA !== maxB) return maxB - maxA;
    return a[0]!.id.localeCompare(b[0]!.id);
  });
}

function projectNodeAxial(node: RadialKnowledgeLayoutNode | undefined, basis: Basis): ContinuousAxial {
  if (!node?.pos) return { q: 0, r: 0 };
  return planeToAxial(new THREE.Vector2(node.pos.dot(basis.u), node.pos.dot(basis.v)));
}

function preferredByMember(
  groups: readonly RelationGroup[],
  byId: ReadonlyMap<string, RadialKnowledgeLayoutNode>,
  basis: Basis,
): Map<string, ContinuousAxial> {
  const anchorsByMember = new Map<string, ContinuousAxial[]>();
  for (const group of groups) {
    const anchor = projectNodeAxial(byId.get(group.anchorId), basis);
    for (const memberId of group.memberIds) {
      const bucket = anchorsByMember.get(memberId);
      if (bucket) bucket.push(anchor);
      else anchorsByMember.set(memberId, [anchor]);
    }
  }
  const preferred = new Map<string, ContinuousAxial>();
  for (const [memberId, anchors] of anchorsByMember) {
    preferred.set(memberId, {
      q: anchors.reduce((sum, point) => sum + point.q, 0) / anchors.length,
      r: anchors.reduce((sum, point) => sum + point.r, 0) / anchors.length,
    });
  }
  return preferred;
}

function membershipCounts(groups: readonly RelationGroup[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const group of groups) {
    for (const memberId of group.memberIds) counts.set(memberId, (counts.get(memberId) ?? 0) + 1);
  }
  return counts;
}

function planeDistanceSquared(a: ContinuousAxial, b: ContinuousAxial): number {
  return axialToPlane({ q: a.q - b.q, r: a.r - b.r }).lengthSq();
}

function candidatePlacements(
  group: RelationGroup,
  state: PackingState,
  anchor: ContinuousAxial,
  preferred: ReadonlyMap<string, ContinuousAxial>,
  memberships: ReadonlyMap<string, number>,
): Placement[] {
  const baseShape = canonicalShape(group.memberIds.length);
  const fixedMembers = group.memberIds.filter(id => state.coords.has(id));
  const placements = new Map<string, Placement>();

  for (let transformIndex = 0; transformIndex < 12; transformIndex += 1) {
    const oriented = baseShape.map(point => transform(point, transformIndex));
    const translations = new Map<string, Axial>();
    if (fixedMembers.length) {
      for (const memberId of fixedMembers) {
        const fixed = state.coords.get(memberId)!;
        for (const slot of oriented) {
          const offset = { q: fixed.q - slot.q, r: fixed.r - slot.r };
          translations.set(axialKey(offset), offset);
        }
      }
    } else {
      const centroid = normalizedCentroid(oriented);
      const target = roundAxial({ q: anchor.q - centroid.q, r: anchor.r - centroid.r });
      for (const nearby of compactTranslationOffsets(RELATION_GROUP_TRANSLATION_RADIUS)) {
        const offset = translated(target, nearby);
        translations.set(axialKey(offset), offset);
      }
    }

    for (const offset of translations.values()) {
      const cells = oriented.map(point => translated(point, offset));
      const cellKeys = new Set(cells.map(axialKey));
      if (fixedMembers.some(id => !cellKeys.has(axialKey(state.coords.get(id)!)))) continue;

      let blocked = false;
      for (const cell of cells) {
        const occupant = state.occupied.get(axialKey(cell));
        if (occupant && !group.memberIds.includes(occupant)) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;

      const assignments = new Map<string, Axial>();
      const usedCells = new Set<string>();
      for (const memberId of fixedMembers) {
        const cell = state.coords.get(memberId)!;
        assignments.set(memberId, { ...cell });
        usedCells.add(axialKey(cell));
      }

      const unassigned = group.memberIds
        .filter(id => !assignments.has(id))
        .sort((a, b) => {
          const countDelta = (memberships.get(b) ?? 0) - (memberships.get(a) ?? 0);
          return countDelta || a.localeCompare(b);
        });
      const remaining = cells.filter(cell => !usedCells.has(axialKey(cell)));
      for (const memberId of unassigned) {
        const target = preferred.get(memberId) ?? anchor;
        remaining.sort((a, b) => {
          const distanceDelta = planeDistanceSquared(a, target) - planeDistanceSquared(b, target);
          if (Math.abs(distanceDelta) > EPSILON) return distanceDelta;
          return axialKey(a).localeCompare(axialKey(b));
        });
        const cell = remaining.shift();
        if (!cell) {
          blocked = true;
          break;
        }
        assignments.set(memberId, { ...cell });
        usedCells.add(axialKey(cell));
      }
      if (blocked) continue;

      const centroid = normalizedCentroid(cells);
      const centerError = planeDistanceSquared(centroid, anchor);
      const signature = [...assignments.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([id, point]) => `${id}@${axialKey(point)}`)
        .join('|');
      const previous = placements.get(signature);
      if (!previous || centerError < previous.centerError) {
        placements.set(signature, { assignments, centerError });
      }
    }
  }

  return [...placements.values()]
    .sort((a, b) => a.centerError - b.centerError || placementSignature(a).localeCompare(placementSignature(b)))
    .slice(0, RELATION_GROUP_CANDIDATES_PER_STATE);
}

function placementSignature(placement: Placement): string {
  return [...placement.assignments.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([id, point]) => `${id}@${axialKey(point)}`)
    .join('|');
}

function cloneState(state: PackingState): PackingState {
  return {
    coords: new Map([...state.coords].map(([id, point]) => [id, { ...point }] as const)),
    occupied: new Map(state.occupied),
    satisfied: [...state.satisfied],
    centerError: state.centerError,
  };
}

function applyPlacement(state: PackingState, group: RelationGroup, placement: Placement): PackingState {
  const next = cloneState(state);
  for (const [id, point] of placement.assignments) {
    const old = next.coords.get(id);
    if (old && axialKey(old) !== axialKey(point)) return state;
    const occupant = next.occupied.get(axialKey(point));
    if (occupant && occupant !== id) return state;
    next.coords.set(id, { ...point });
    next.occupied.set(axialKey(point), id);
  }
  next.satisfied.push(group);
  next.centerError += placement.centerError;
  return next;
}

function satisfiedSizes(state: PackingState): number[] {
  return state.satisfied.map(group => group.memberIds.length).sort((a, b) => b - a);
}

/**
 * Ordering is intentionally lexicographic: satisfy more relation groups first;
 * if that count ties, prefer the solution containing the larger satisfied group,
 * then the next larger one, and only then use centre alignment as a soft tie-break.
 */
export function compareRelationPackingPriority(aSizes: readonly number[], bSizes: readonly number[]): number {
  if (aSizes.length !== bSizes.length) return bSizes.length - aSizes.length;
  const a = [...aSizes].sort((x, y) => y - x);
  const b = [...bSizes].sort((x, y) => y - x);
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return b[i]! - a[i]!;
  }
  return 0;
}

function compareStates(a: PackingState, b: PackingState): number {
  const priority = compareRelationPackingPriority(satisfiedSizes(a), satisfiedSizes(b));
  if (priority) return priority;
  if (Math.abs(a.centerError - b.centerError) > EPSILON) return a.centerError - b.centerError;
  return stateSignature(a).localeCompare(stateSignature(b));
}

function stateSignature(state: PackingState): string {
  return [...state.coords.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([id, point]) => `${id}@${axialKey(point)}`)
    .join('|');
}

function solveConflictGroup(
  groups: readonly RelationGroup[],
  globallyOccupied: ReadonlyMap<string, string>,
  anchors: ReadonlyMap<string, ContinuousAxial>,
  preferred: ReadonlyMap<string, ContinuousAxial>,
  memberships: ReadonlyMap<string, number>,
): PackingState {
  const ordered = [...groups].sort((a, b) => {
    const sizeDelta = b.memberIds.length - a.memberIds.length;
    if (sizeDelta) return sizeDelta;
    return a.id.localeCompare(b.id);
  });
  let beam: PackingState[] = [{
    coords: new Map(),
    occupied: new Map(globallyOccupied),
    satisfied: [],
    centerError: 0,
  }];

  for (const group of ordered) {
    const nextStates: PackingState[] = [];
    for (const state of beam) {
      nextStates.push(state);
      const anchor = anchors.get(group.id) ?? { q: 0, r: 0 };
      for (const placement of candidatePlacements(group, state, anchor, preferred, memberships)) {
        const next = applyPlacement(state, group, placement);
        if (next !== state) nextStates.push(next);
      }
    }
    const deduped = new Map<string, PackingState>();
    for (const state of nextStates) {
      const signature = `${state.satisfied.map(group => group.id).sort().join(';')}::${stateSignature(state)}`;
      const previous = deduped.get(signature);
      if (!previous || compareStates(state, previous) < 0) deduped.set(signature, state);
    }
    beam = [...deduped.values()].sort(compareStates).slice(0, RELATION_GROUP_BEAM_WIDTH);
  }
  return beam.sort(compareStates)[0]!;
}

function assignedPeerAdjacency(
  memberId: string,
  candidate: Axial,
  groupsByMember: ReadonlyMap<string, readonly RelationGroup[]>,
  coords: ReadonlyMap<string, Axial>,
): number {
  const peers = new Set<string>();
  for (const group of groupsByMember.get(memberId) ?? []) {
    for (const peerId of group.memberIds) if (peerId !== memberId) peers.add(peerId);
  }
  let adjacency = 0;
  for (const peerId of peers) {
    const peer = coords.get(peerId);
    if (peer && axialDistance(candidate, peer) === 1) adjacency += 1;
  }
  return adjacency;
}

function targetForUnassigned(
  memberId: string,
  groupsByMember: ReadonlyMap<string, readonly RelationGroup[]>,
  anchors: ReadonlyMap<string, ContinuousAxial>,
  preferred: ReadonlyMap<string, ContinuousAxial>,
  coords: ReadonlyMap<string, Axial>,
): ContinuousAxial {
  const points: ContinuousAxial[] = [preferred.get(memberId) ?? { q: 0, r: 0 }];
  for (const group of groupsByMember.get(memberId) ?? []) {
    const anchor = anchors.get(group.id);
    if (anchor) points.push(anchor);
    for (const peerId of group.memberIds) {
      const peer = coords.get(peerId);
      if (peer) points.push(peer);
    }
  }
  return {
    q: points.reduce((sum, point) => sum + point.q, 0) / points.length,
    r: points.reduce((sum, point) => sum + point.r, 0) / points.length,
  };
}

function findCompactFreeCell(
  memberId: string,
  target: ContinuousAxial,
  occupied: ReadonlyMap<string, string>,
  groupsByMember: ReadonlyMap<string, readonly RelationGroup[]>,
  coords: ReadonlyMap<string, Axial>,
): Axial {
  const center = roundAxial(target);
  for (let radius = 0; radius <= 24; radius += 1) {
    const candidates = compactTranslationOffsets(radius)
      .filter(offset => axialRadius(offset) === radius)
      .map(offset => translated(center, offset))
      .filter(point => !occupied.has(axialKey(point)));
    if (!candidates.length) continue;
    candidates.sort((a, b) => {
      const adjacencyDelta = assignedPeerAdjacency(memberId, b, groupsByMember, coords)
        - assignedPeerAdjacency(memberId, a, groupsByMember, coords);
      if (adjacencyDelta) return adjacencyDelta;
      const distanceDelta = planeDistanceSquared(a, target) - planeDistanceSquared(b, target);
      if (Math.abs(distanceDelta) > EPSILON) return distanceDelta;
      const radiusDelta = axialRadius(a) - axialRadius(b);
      if (radiusDelta) return radiusDelta;
      return axialKey(a).localeCompare(axialKey(b));
    });
    return candidates[0]!;
  }
  let fallback = { ...center };
  while (occupied.has(axialKey(fallback))) fallback = { q: fallback.q + 1, r: fallback.r };
  return fallback;
}

function packComponent(
  component: readonly string[],
  byId: ReadonlyMap<string, RadialKnowledgeLayoutNode>,
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
  incoming: ReadonlyMap<string, ReadonlySet<string>>,
  outgoing: ReadonlyMap<string, ReadonlySet<string>>,
): void {
  const depths = computeDepths(component, incoming, outgoing);
  const basis = componentBasis(component, byId, depths);
  if (!basis) return;
  const groups = buildRelationGroups(component, depths, incoming, outgoing);
  const groupsByDepth = new Map<number, RelationGroup[]>();
  for (const group of groups) {
    const bucket = groupsByDepth.get(group.depth);
    if (bucket) bucket.push(group);
    else groupsByDepth.set(group.depth, [group]);
  }
  const radialCoordinates = new Map<string, number>();
  const initialPreferred = new Map<string, ContinuousAxial>();
  for (const id of component) {
    const node = byId.get(id);
    if (!node?.pos) continue;
    radialCoordinates.set(id, node.pos.dot(basis.radial));
    initialPreferred.set(id, projectNodeAxial(node, basis));
  }

  const anchors = new Map<string, ContinuousAxial>();
  for (const group of groups) anchors.set(group.id, projectNodeAxial(byId.get(group.anchorId), basis));
  const preferred = preferredByMember(groups, byId, basis);
  for (const [id, point] of initialPreferred) if (!preferred.has(id)) preferred.set(id, point);
  const memberships = membershipCounts(groups);

  for (const depth of [...new Set(component.map(id => depths.get(id) ?? 0))].sort((a, b) => a - b)) {
    const layerIds = component.filter(id => (depths.get(id) ?? 0) === depth).sort();
    const layerGroups = groupsByDepth.get(depth) ?? [];
    const groupsByMember = new Map<string, RelationGroup[]>();
    for (const group of layerGroups) {
      for (const memberId of group.memberIds) {
        const bucket = groupsByMember.get(memberId);
        if (bucket) bucket.push(group);
        else groupsByMember.set(memberId, [group]);
      }
    }

    const occupied = new Map<string, string>();
    const coords = new Map<string, Axial>();
    for (const conflict of groupConflictComponents(layerGroups)) {
      const solved = solveConflictGroup(conflict, occupied, anchors, preferred, memberships);
      for (const [id, point] of solved.coords) {
        coords.set(id, { ...point });
        occupied.set(axialKey(point), id);
      }
    }

    const unassigned = layerIds.filter(id => !coords.has(id)).sort((a, b) => {
      const largestA = Math.max(0, ...(groupsByMember.get(a) ?? []).map(group => group.memberIds.length));
      const largestB = Math.max(0, ...(groupsByMember.get(b) ?? []).map(group => group.memberIds.length));
      if (largestA !== largestB) return largestB - largestA;
      const membershipDelta = (memberships.get(b) ?? 0) - (memberships.get(a) ?? 0);
      return membershipDelta || a.localeCompare(b);
    });
    for (const id of unassigned) {
      const target = targetForUnassigned(id, groupsByMember, anchors, preferred, coords);
      const point = findCompactFreeCell(id, target, occupied, groupsByMember, coords);
      coords.set(id, point);
      occupied.set(axialKey(point), id);
    }

    for (const id of layerIds) {
      const node = byId.get(id);
      const point = coords.get(id);
      if (!node || !point) continue;
      const plane = axialToPlane(point);
      setPosition(
        node,
        basis.radial.clone().multiplyScalar(radialCoordinates.get(id) ?? 0)
          .addScaledVector(basis.u, plane.x)
          .addScaledVector(basis.v, plane.y),
      );
    }
  }
}

function shiftLineageBranches(
  nodes: RadialKnowledgeLayoutNode[],
  before: ReadonlyMap<string, THREE.Vector3>,
): void {
  const groups = new Map<string, RadialKnowledgeLayoutNode[]>();
  for (const node of nodes) {
    if (!node.lineage || isReasoning(node)) continue;
    const topicId = topicIdFor(node);
    const bucket = groups.get(topicId);
    if (bucket) bucket.push(node);
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

/**
 * Final same-plane layout stage. Knowledge nodes stay on their radial planes and
 * occupy unique triangular-lattice cells, so same-plane centre spacing is never
 * below 5R. Relation groups are satisfied by compact canonical clusters whenever
 * possible. Shared-node conflicts use bounded beam search with this priority:
 * more satisfied groups -> larger satisfied groups -> closer anchor-centre match.
 * Remaining nodes fill nearest compact cells and prefer touching already placed
 * members, preventing a compact hexagonal solution from degenerating into a row.
 */
export function applyTriangularRelationGroupPacking<T extends RadialKnowledgeLayoutNode>(nodes: T[]): T[] {
  const before = new Map(
    nodes.filter(node => node.pos).map(node => [node.id, node.pos!.clone()] as const),
  );
  const graph = buildCompressedGraph(nodes);
  const byId = new Map(graph.knowledgeNodes.map(node => [node.id, node] as const));
  const components = connectedComponents(graph.knowledgeNodes.map(node => node.id), graph.adjacency);
  for (const component of components) {
    packComponent(component, byId, graph.adjacency, graph.incoming, graph.outgoing);
  }
  shiftLineageBranches(nodes, before);
  return nodes;
}
