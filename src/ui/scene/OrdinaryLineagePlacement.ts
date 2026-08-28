import * as THREE from 'three';
import { lineageRoleFor, topicIdFor } from '../../domain/KnowledgeLineage';
import { KNOWLEDGE_BALL_RADIUS, type LayoutNode } from './Deterministic5RLayout';

/**
 * In the current layout vocabulary one ordinary Knowledge-ball diameter is R.
 * Stable/pending ordinary lineage neighbours therefore use exactly one diameter.
 */
export const ORDINARY_LINEAGE_SPACING = 2 * KNOWLEDGE_BALL_RADIUS;

const EPSILON = 1e-7;
const AXIS_CANDIDATE_COUNT = 180;

type Family = Readonly<{
  topicId: string;
  anchor: LayoutNode;
  historySide: readonly LayoutNode[];
  oppositionSide: readonly LayoutNode[];
}>;

type AxisCandidate = Readonly<{
  tangent: THREE.Vector3;
  positions: ReadonlyMap<string, THREE.Vector3>;
  compactness: number;
  angleIndex: number;
}>;

export function isOrdinaryLineageSatellite(node: LayoutNode): boolean {
  if (node.type === 'reasoning') return false;
  const role = lineageRoleFor(node);
  return role === 'history'
    || role === 'opposition'
    || role === 'candidate-history'
    || role === 'candidate-opposition';
}

function stableHash(text: string): number {
  let hash = 2166136261;
  for (const char of text) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function rankThenId(left: LayoutNode, right: LayoutNode): number {
  return (left.lineage?.rank ?? Number.MAX_SAFE_INTEGER)
    - (right.lineage?.rank ?? Number.MAX_SAFE_INTEGER)
    || left.id.localeCompare(right.id);
}

function collectFamilies(nodes: readonly LayoutNode[]): Family[] {
  const byTopic = new Map<string, LayoutNode[]>();
  for (const node of nodes) {
    if (node.type === 'reasoning' || lineageRoleFor(node) === 'rejected') continue;
    const topicId = topicIdFor(node);
    const members = byTopic.get(topicId);
    if (members) members.push(node);
    else byTopic.set(topicId, [node]);
  }

  const families: Family[] = [];
  for (const [topicId, members] of byTopic) {
    const anchor = members.find(node => lineageRoleFor(node) === 'current');
    if (!anchor?.pos || anchor.pos.lengthSq() <= EPSILON) continue;

    const pendingHistory = members
      .filter(node => lineageRoleFor(node) === 'candidate-history')
      .sort((left, right) => left.id.localeCompare(right.id));
    const stableHistory = members
      .filter(node => lineageRoleFor(node) === 'history')
      .sort(rankThenId);
    const pendingOpposition = members
      .filter(node => lineageRoleFor(node) === 'candidate-opposition')
      .sort((left, right) => left.id.localeCompare(right.id));
    const stableOpposition = members
      .filter(node => lineageRoleFor(node) === 'opposition')
      .sort(rankThenId);

    if (!pendingHistory.length && !stableHistory.length && !pendingOpposition.length && !stableOpposition.length) continue;
    families.push({
      topicId,
      anchor,
      historySide: [...pendingHistory, ...stableHistory],
      oppositionSide: [...pendingOpposition, ...stableOpposition],
    });
  }

  return families.sort((left, right) => left.topicId.localeCompare(right.topicId));
}

function tangentBasis(radial: THREE.Vector3): readonly [THREE.Vector3, THREE.Vector3] {
  const candidates = [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0, 1),
  ].sort((left, right) => Math.abs(left.dot(radial)) - Math.abs(right.dot(radial)));
  const first = candidates[0]!
    .clone()
    .addScaledVector(radial, -candidates[0]!.dot(radial))
    .normalize();
  const second = radial.clone().cross(first).normalize();
  return [first, second];
}

function positionAtOffset(
  radial: THREE.Vector3,
  tangent: THREE.Vector3,
  radius: number,
  stepAngle: number,
  offset: number,
): THREE.Vector3 {
  const angle = stepAngle * offset;
  return radial.clone()
    .multiplyScalar(Math.cos(angle))
    .addScaledVector(tangent, Math.sin(angle))
    .multiplyScalar(radius);
}

function internalSpacingIsLegal(positions: readonly THREE.Vector3[]): boolean {
  for (let left = 0; left < positions.length; left++) {
    for (let right = left + 1; right < positions.length; right++) {
      if (positions[left]!.distanceTo(positions[right]!) + EPSILON < ORDINARY_LINEAGE_SPACING) return false;
    }
  }
  return true;
}

function candidateFor(
  family: Family,
  tangent: THREE.Vector3,
  obstacles: readonly LayoutNode[],
  angleIndex: number,
): AxisCandidate | null {
  const radius = family.anchor.pos!.length();
  if (ORDINARY_LINEAGE_SPACING > 2 * radius + EPSILON) return null;
  const stepAngle = 2 * Math.asin(Math.min(1, ORDINARY_LINEAGE_SPACING / (2 * radius)));
  const maxSideDepth = Math.max(family.historySide.length, family.oppositionSide.length);
  if (maxSideDepth * stepAngle >= Math.PI - EPSILON) return null;

  const positions = new Map<string, THREE.Vector3>();
  family.historySide.forEach((node, index) => {
    positions.set(node.id, positionAtOffset(
      family.anchor.pos!.clone().normalize(), tangent, radius, stepAngle, -(index + 1),
    ));
  });
  family.oppositionSide.forEach((node, index) => {
    positions.set(node.id, positionAtOffset(
      family.anchor.pos!.clone().normalize(), tangent, radius, stepAngle, index + 1,
    ));
  });

  const familyPositions = [...positions.values()];
  if (!internalSpacingIsLegal([family.anchor.pos!, ...familyPositions])) return null;

  let compactness = 0;
  const familyIds = new Set([family.anchor.id, ...positions.keys()]);
  for (const position of familyPositions) {
    let nearest = Infinity;
    for (const obstacle of obstacles) {
      if (familyIds.has(obstacle.id) || !obstacle.pos) continue;
      const distance = position.distanceTo(obstacle.pos);
      if (distance + EPSILON < ORDINARY_LINEAGE_SPACING) return null;
      nearest = Math.min(nearest, distance);
    }
    if (Number.isFinite(nearest)) compactness += nearest;
  }

  return { tangent: tangent.clone(), positions, compactness, angleIndex };
}

function chooseAxis(family: Family, obstacles: readonly LayoutNode[]): AxisCandidate {
  const radial = family.anchor.pos!.clone().normalize();
  const [basisU, basisV] = tangentBasis(radial);
  const start = stableHash(family.topicId) % AXIS_CANDIDATE_COUNT;
  let best: AxisCandidate | null = null;

  for (let step = 0; step < AXIS_CANDIDATE_COUNT; step++) {
    const angleIndex = (start + step) % AXIS_CANDIDATE_COUNT;
    const angle = (2 * Math.PI * angleIndex) / AXIS_CANDIDATE_COUNT;
    const tangent = basisU.clone()
      .multiplyScalar(Math.cos(angle))
      .addScaledVector(basisV, Math.sin(angle))
      .normalize();
    const candidate = candidateFor(family, tangent, obstacles, angleIndex);
    if (!candidate) continue;
    if (!best
      || candidate.compactness < best.compactness - EPSILON
      || (Math.abs(candidate.compactness - best.compactness) <= EPSILON && candidate.angleIndex < best.angleIndex)) {
      best = candidate;
    }
  }

  if (!best) {
    throw new Error(`Ordinary lineage has no collision-free tangent axis: ${family.topicId}`);
  }
  return best;
}

/**
 * Ordinary Knowledge lineage is a local rigid family, not part of the global
 * main-chain occupancy search:
 *
 *   history ... <- current -> opposition ...
 *
 * Existing members only are placed; no future slots are reserved. Every family
 * member stays on the anchor radius, adjacent family centres are exactly R apart,
 * and the tangent-plane projection is one straight line. The whole line may
 * rotate around the anchor radial axis to avoid current geometry. Among legal
 * orientations, the most compact current arrangement wins.
 *
 * These local lineage positions intentionally have no global ISG address. The
 * current head remains the globally authoritative anchor; history/opposition are
 * derived local geometry and are recomputed whenever the local neighbourhood
 * changes.
 */
export function applyOrdinaryLineagePlacement(nodes: LayoutNode[]): void {
  const satellites = nodes.filter(isOrdinaryLineageSatellite);
  for (const node of satellites) {
    delete node.address;
    delete node.pos;
    delete node.homePos;
    node.vel?.set(0, 0, 0);
  }

  const families = collectFamilies(nodes);
  for (const family of families) {
    const candidate = chooseAxis(family, nodes);
    for (const [nodeId, position] of candidate.positions) {
      const node = nodes.find(item => item.id === nodeId);
      if (!node) continue;
      node.pos = position.clone();
      node.homePos = position.clone();
      node.vel ??= new THREE.Vector3();
      node.vel.set(0, 0, 0);
      delete node.address;
    }
  }
}
