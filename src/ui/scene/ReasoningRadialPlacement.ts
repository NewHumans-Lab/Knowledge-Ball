import * as THREE from 'three';
import {
  isReasoningSideHead,
  lineageRoleFor,
  topicIdFor,
} from '../../domain/KnowledgeLineage';
import { createKnowledgeRelationIndex } from '../../domain/KnowledgeRelations';
import { reasoningConclusionBindingFor } from '../../domain/ReasoningConclusion';
import { LAYOUT_UNIT, type LayoutNode } from './Deterministic5RLayout';

const EPSILON = 1e-12;
const SPACING_EPSILON = 1e-7;
const MAX_ANCHOR_SEARCH_RING = 64;

function meanRadius(nodes: readonly LayoutNode[]): number {
  return nodes.reduce((sum, node) => sum + node.pos!.length(), 0) / nodes.length;
}

function clearReasoningSpatialState(reasoning: LayoutNode): void {
  delete reasoning.address;
  delete reasoning.pos;
  delete reasoning.homePos;
  reasoning.vel?.set(0, 0, 0);
}

function positionedOrdinaryPremises(reasoning: LayoutNode, byId: ReadonlyMap<string, LayoutNode>): LayoutNode[] {
  return [...new Set(reasoning.premises ?? [])]
    .map(id => byId.get(id))
    .filter((node): node is LayoutNode => !!node?.pos && node.type !== 'reasoning' && node.pos.lengthSq() > EPSILON);
}

type FamilyGeometry = Readonly<{
  rawP0: THREE.Vector3;
  radialAxis: THREE.Vector3;
  tangent: THREE.Vector3;
  bitangent: THREE.Vector3;
}>;

function fallbackTangent(radialAxis: THREE.Vector3): THREE.Vector3 {
  const candidates = [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0, 1),
  ].sort((left, right) => Math.abs(left.dot(radialAxis)) - Math.abs(right.dot(radialAxis)));
  const tangent = candidates[0]
    .clone()
    .sub(radialAxis.clone().multiplyScalar(candidates[0].dot(radialAxis)));
  if (tangent.lengthSq() <= EPSILON) throw new Error('Reasoning tangent basis could not be constructed');
  return tangent.normalize();
}

function geometryForReasoning(
  reasoning: LayoutNode,
  byId: ReadonlyMap<string, LayoutNode>,
): FamilyGeometry | undefined {
  const binding = reasoningConclusionBindingFor(reasoning);
  const conclusion = binding ? byId.get(binding.conclusionId) : undefined;
  const premises = positionedOrdinaryPremises(reasoning, byId);
  if (!binding || !conclusion?.pos || conclusion.type === 'reasoning' || conclusion.pos.lengthSq() <= EPSILON || !premises.length) {
    return undefined;
  }

  const radialAxis = conclusion.pos.clone().normalize();
  const radius = (meanRadius(premises) + conclusion.pos.length()) * 0.5;
  const rawP0 = radialAxis.clone().multiplyScalar(radius);

  const premiseCenter = premises
    .reduce((sum, premise) => sum.add(premise.pos!), new THREE.Vector3())
    .multiplyScalar(1 / premises.length);
  const tangentialPremise = premiseCenter
    .clone()
    .sub(radialAxis.clone().multiplyScalar(premiseCenter.dot(radialAxis)));
  const tangent = tangentialPremise.lengthSq() > EPSILON
    ? tangentialPremise.normalize()
    : fallbackTangent(radialAxis);
  const bitangent = radialAxis.clone().cross(tangent).normalize();

  return { rawP0, radialAxis, tangent, bitangent };
}

function reasoningFamilyKey(reasoning: LayoutNode): string {
  const binding = reasoningConclusionBindingFor(reasoning);
  return `${topicIdFor(reasoning)}\u0000${binding?.conclusionId ?? ''}`;
}

function stableReasoningWinner(members: readonly LayoutNode[]): LayoutNode | undefined {
  const heads = members.filter(member => isReasoningSideHead(member));
  return heads.find(member => member.lineage?.reasoningDominant === true)
    ?? (heads.length === 1 ? heads[0] : undefined)
    ?? heads.find(member => !member.lineage?.reasoningSide)
    ?? heads.sort((left, right) => left.id.localeCompare(right.id))[0];
}

function localFamilyOffsets(
  members: readonly LayoutNode[],
  winner: LayoutNode,
  tangent: THREE.Vector3,
  bitangent: THREE.Vector3,
): Map<string, THREE.Vector3> {
  const offsets = new Map<string, THREE.Vector3>();
  const zero = new THREE.Vector3();
  offsets.set(winner.id, zero.clone());

  const winnerSide = winner.lineage?.reasoningSide;
  const stableHeads = members
    .filter(member => member.id !== winner.id && isReasoningSideHead(member))
    .sort((left, right) => left.id.localeCompare(right.id));
  stableHeads.forEach((head, index) => {
    offsets.set(head.id, tangent.clone().multiplyScalar((index + 1) * LAYOUT_UNIT));
  });

  const nonCandidates = members
    .filter(member => {
      const role = lineageRoleFor(member);
      return member.id !== winner.id
        && !offsets.has(member.id)
        && role !== 'candidate-history'
        && role !== 'candidate-opposition'
        && role !== 'rejected';
    })
    .sort((left, right) => left.id.localeCompare(right.id));

  let fallbackPositiveRank = stableHeads.length + 1;
  for (const member of nonCandidates) {
    const role = lineageRoleFor(member);
    const sideRank = member.lineage?.reasoningSideRank;
    const rank = Math.max(1, sideRank ?? member.lineage?.rank ?? 1);
    let scalar: number;

    if (winnerSide && member.lineage?.reasoningSide) {
      scalar = member.lineage.reasoningSide === winnerSide ? -rank : rank + 1;
    } else if (role === 'history') {
      scalar = -rank;
    } else if (role === 'opposition') {
      scalar = rank + 1;
    } else {
      scalar = ++fallbackPositiveRank;
    }
    offsets.set(member.id, tangent.clone().multiplyScalar(scalar * LAYOUT_UNIT));
  }

  const candidates = members
    .filter(member => {
      const role = lineageRoleFor(member);
      return role === 'candidate-history' || role === 'candidate-opposition';
    })
    .sort((left, right) => left.id.localeCompare(right.id));

  candidates.forEach((candidate, index) => {
    const targetOffset = candidate.lineage?.targetId
      ? offsets.get(candidate.lineage.targetId)
      : undefined;
    const step = Math.floor(index / 2) + 1;
    const sign = index % 2 === 0 ? 1 : -1;
    offsets.set(
      candidate.id,
      (targetOffset ?? zero).clone().add(bitangent.clone().multiplyScalar(sign * step * LAYOUT_UNIT)),
    );
  });

  return offsets;
}

function assertLocalReasoningSpacing(offsets: ReadonlyMap<string, THREE.Vector3>, familyKey: string): void {
  const entries = [...offsets.entries()];
  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
      const distance = entries[leftIndex][1].distanceTo(entries[rightIndex][1]);
      if (distance + SPACING_EPSILON < LAYOUT_UNIT) {
        throw new Error(
          `Reasoning family ${familyKey} violates 5R spacing: ${entries[leftIndex][0]} / ${entries[rightIndex][0]} = ${distance}`,
        );
      }
    }
  }
}

class ReasoningSpatialIndex {
  private readonly buckets = new Map<string, THREE.Vector3[]>();

  private bucketCoordinate(value: number): number {
    return Math.floor(value / LAYOUT_UNIT);
  }

  private key(x: number, y: number, z: number): string {
    return `${x}:${y}:${z}`;
  }

  canPlace(position: THREE.Vector3): boolean {
    const x = this.bucketCoordinate(position.x);
    const y = this.bucketCoordinate(position.y);
    const z = this.bucketCoordinate(position.z);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          const nearby = this.buckets.get(this.key(x + dx, y + dy, z + dz)) ?? [];
          if (nearby.some(other => other.distanceTo(position) + SPACING_EPSILON < LAYOUT_UNIT)) return false;
        }
      }
    }
    return true;
  }

  add(position: THREE.Vector3): void {
    const key = this.key(
      this.bucketCoordinate(position.x),
      this.bucketCoordinate(position.y),
      this.bucketCoordinate(position.z),
    );
    const bucket = this.buckets.get(key) ?? [];
    bucket.push(position.clone());
    this.buckets.set(key, bucket);
  }
}

function translationCandidates(geometry: FamilyGeometry): THREE.Vector3[] {
  const candidates = [new THREE.Vector3()];
  for (let ring = 1; ring <= MAX_ANCHOR_SEARCH_RING; ring += 1) {
    const coordinates: Array<readonly [number, number]> = [];
    for (let x = -ring; x <= ring; x += 1) {
      for (let y = -ring; y <= ring; y += 1) {
        if (Math.max(Math.abs(x), Math.abs(y)) !== ring) continue;
        coordinates.push([x, y]);
      }
    }
    coordinates.sort((left, right) => {
      const leftDistance = left[0] * left[0] + left[1] * left[1];
      const rightDistance = right[0] * right[0] + right[1] * right[1];
      return leftDistance - rightDistance || left[0] - right[0] || left[1] - right[1];
    });
    for (const [x, y] of coordinates) {
      candidates.push(
        geometry.tangent.clone().multiplyScalar(x * LAYOUT_UNIT)
          .add(geometry.bitangent.clone().multiplyScalar(y * LAYOUT_UNIT)),
      );
    }
  }
  return candidates;
}

function familyPositions(
  geometry: FamilyGeometry,
  offsets: ReadonlyMap<string, THREE.Vector3>,
  translation: THREE.Vector3,
): Map<string, THREE.Vector3> {
  const anchor = geometry.rawP0.clone().add(translation);
  return new Map(
    [...offsets.entries()].map(([id, offset]) => [id, anchor.clone().add(offset)] as const),
  );
}

function chooseFamilyPositions(
  familyKey: string,
  geometry: FamilyGeometry,
  offsets: ReadonlyMap<string, THREE.Vector3>,
  spatialIndex: ReasoningSpatialIndex,
): Map<string, THREE.Vector3> {
  for (const translation of translationCandidates(geometry)) {
    const positions = familyPositions(geometry, offsets, translation);
    if ([...positions.values()].every(position => spatialIndex.canPlace(position))) return positions;
  }
  throw new Error(`Reasoning family ${familyKey} could not find a collision-free >=5R anchor`);
}

function applyPosition(reasoning: LayoutNode, position: THREE.Vector3): void {
  reasoning.pos = position.clone();
  reasoning.homePos = position.clone();
  reasoning.vel ??= new THREE.Vector3();
  reasoning.vel.set(0, 0, 0);
  delete reasoning.address;
}

/**
 * Reasoning remains non-authoritative: Knowledge geometry is final before this
 * pass and Reasoning never consumes shellID/cellID.
 *
 * Per family:
 * - the dominant/winning head owns P0;
 * - the losing head is exactly 5R from P0;
 * - winning history extends from P0 in the opposite direction at 5R steps;
 * - losing history continues beyond the losing head at 5R steps;
 * - a pending candidate sits 5R from its target on the perpendicular tangent;
 * - every pair of positioned Reasoning balls is kept at least 5R apart;
 * - a Reasoning node with zero canonical semantic edges receives no position and
 *   therefore can never appear as a free-floating standalone ball.
 *
 * P0 starts at the original radial midpoint between ordinary premises and the
 * served concrete conclusion. If an unrelated Reasoning family would collide,
 * the whole family is translated in the local tangent plane to the nearest
 * deterministic legal anchor; no Knowledge position is changed.
 */
export function applyReasoningRadialPlacement(nodes: LayoutNode[]): void {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const reasoningNodes = nodes.filter(node => node.type === 'reasoning');
  reasoningNodes.forEach(clearReasoningSpatialState);

  // Canonical topology is the authority for whether a Reasoning ball actually
  // participates in Knowledge. LayoutNode intentionally carries no UI title, so
  // project only the semantic fields required by the relation index.
  const relationNodes = nodes.map(node => ({
    id: node.id,
    title: node.id,
    premises: node.premises ?? [],
    type: node.type as Parameters<typeof createKnowledgeRelationIndex>[0][number]['type'],
    lineage: node.lineage,
  }));
  const connectedReasoningIds = new Set<string>();
  for (const edge of createKnowledgeRelationIndex(relationNodes).edges) {
    if (byId.get(edge.fromId)?.type === 'reasoning') connectedReasoningIds.add(edge.fromId);
    if (byId.get(edge.toId)?.type === 'reasoning') connectedReasoningIds.add(edge.toId);
  }

  const families = new Map<string, LayoutNode[]>();
  for (const reasoning of reasoningNodes) {
    if (lineageRoleFor(reasoning) === 'rejected') continue;
    if (!connectedReasoningIds.has(reasoning.id)) continue;
    const binding = reasoningConclusionBindingFor(reasoning);
    const conclusion = binding ? byId.get(binding.conclusionId) : undefined;
    if (!binding || !conclusion?.pos || conclusion.type === 'reasoning' || conclusion.pos.lengthSq() <= EPSILON) continue;
    const key = reasoningFamilyKey(reasoning);
    const members = families.get(key) ?? [];
    members.push(reasoning);
    families.set(key, members);
  }

  const spatialIndex = new ReasoningSpatialIndex();
  const orderedFamilies = [...families.entries()].sort(([left], [right]) => left.localeCompare(right));

  for (const [familyKey, members] of orderedFamilies) {
    const winner = stableReasoningWinner(members);
    if (!winner) continue;
    const geometry = geometryForReasoning(winner, byId)
      ?? members.map(member => geometryForReasoning(member, byId)).find(Boolean);
    if (!geometry) continue;

    const offsets = localFamilyOffsets(members, winner, geometry.tangent, geometry.bitangent);
    assertLocalReasoningSpacing(offsets, familyKey);
    const positions = chooseFamilyPositions(familyKey, geometry, offsets, spatialIndex);

    for (const member of members) {
      const position = positions.get(member.id);
      if (!position) continue;
      applyPosition(member, position);
      spatialIndex.add(position);
    }
  }
}