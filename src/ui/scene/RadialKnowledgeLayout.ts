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
export const RADIAL_LAYOUT_MIN_PLANE_SPACING = RADIAL_LAYOUT_NODE_RADIUS * 2;

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

function setPosition(node: RadialKnowledgeLayoutNode, position: THREE.Vector3): void {
  node.pos = position.clone();
  node.homePos = position.clone();
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

/**
 * Gives every independent component its own outward radial direction.
 * The z clamp keeps components away from a camera-depth degeneracy while still
 * distributing them over the full visible sphere belt.
 */
function componentDirection(index: number, count: number): THREE.Vector3 {
  if (count <= 1) return new THREE.Vector3(1, 0, 0);
  const z = MAX_COMPONENT_Z * (1 - 2 * ((index + 0.5) / count));
  const phi = index * GOLDEN_ANGLE;
  const xy = Math.sqrt(Math.max(0, 1 - z * z));
  return new THREE.Vector3(xy * Math.cos(phi), xy * Math.sin(phi), z).normalize();
}

/**
 * Places n neighbours on one plane perpendicular to the component radial axis.
 * Every neighbour is exactly L from center.
 *
 * For n>1, adjacent chord distance is 2ρsin(π/n), therefore the smallest ring
 * radius that satisfies spacing x is ρ=x/(2sin(π/n)). The axial offset is
 * h=sqrt(L²-ρ²). If ρ>L, fixed L is mathematically incompatible with x on a
 * single plane/circle; fixed L wins and ρ is clamped to L.
 */
export function positionsOnPerpendicularPlane(
  center: THREE.Vector3,
  radialDirection: THREE.Vector3,
  count: number,
  outward: boolean,
  minSpacing = RADIAL_LAYOUT_MIN_PLANE_SPACING,
): THREE.Vector3[] {
  if (count <= 0) return [];
  const { radial, u, v } = tangentBasis(radialDirection);
  const sign = outward ? 1 : -1;

  if (count === 1) {
    return [center.clone().addScaledVector(radial, sign * RADIAL_LAYOUT_LINK_LENGTH)];
  }

  const requiredRingRadius = minSpacing / (2 * Math.sin(Math.PI / count));
  const ringRadius = Math.min(requiredRingRadius, RADIAL_LAYOUT_LINK_LENGTH);
  const axialOffset = Math.sqrt(Math.max(
    0,
    RADIAL_LAYOUT_LINK_LENGTH ** 2 - ringRadius ** 2,
  ));
  const phase = count % 2 === 0 ? Math.PI / count : 0;

  return Array.from({ length: count }, (_, index) => {
    const angle = phase + index * Math.PI * 2 / count;
    return center.clone()
      .addScaledVector(radial, sign * axialOffset)
      .addScaledVector(u, ringRadius * Math.cos(angle))
      .addScaledVector(v, ringRadius * Math.sin(angle));
  });
}

function isPrimaryNode(node: RadialKnowledgeLayoutNode): boolean {
  if (isSystemCoreNodeId(node.id)) return false;
  if (node.hidden && !node.lineage) return false;
  if (lineageRoleFor(node) !== 'current') return false;
  return node.lineage?.reasoningSide !== 'opposition';
}

function isReasoning(node: RadialKnowledgeLayoutNode): boolean {
  return node.type === 'reasoning';
}

function buildPrimaryAdjacency(
  primaryNodes: RadialKnowledgeLayoutNode[],
): {
  adjacency: Map<string, Set<string>>;
  conclusionsByReasoning: Map<string, string[]>;
  producerByKnowledge: Map<string, string[]>;
} {
  const byId = new Map(primaryNodes.map(node => [node.id, node] as const));
  const reasoningIds = new Set(primaryNodes.filter(isReasoning).map(node => node.id));
  const adjacency = new Map(primaryNodes.map(node => [node.id, new Set<string>()] as const));
  const conclusionsByReasoning = new Map<string, string[]>();
  const producerByKnowledge = new Map<string, string[]>();

  for (const reasoningId of reasoningIds) conclusionsByReasoning.set(reasoningId, []);

  for (const node of primaryNodes) {
    if (isReasoning(node)) {
      for (const premiseId of node.premises ?? []) {
        if (!byId.has(premiseId)) continue;
        adjacency.get(node.id)!.add(premiseId);
        adjacency.get(premiseId)!.add(node.id);
      }
      continue;
    }

    for (const sourceId of node.premises ?? []) {
      if (!reasoningIds.has(sourceId)) continue;
      conclusionsByReasoning.get(sourceId)!.push(node.id);
      const producers = producerByKnowledge.get(node.id);
      if (producers) producers.push(sourceId);
      else producerByKnowledge.set(node.id, [sourceId]);
      adjacency.get(node.id)!.add(sourceId);
      adjacency.get(sourceId)!.add(node.id);
    }
  }

  return { adjacency, conclusionsByReasoning, producerByKnowledge };
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
      const id = queue[head++];
      component.push(id);
      const neighbours = [...(adjacency.get(id) ?? [])].sort();
      for (const nextId of neighbours) {
        if (visited.has(nextId)) continue;
        visited.add(nextId);
        queue.push(nextId);
      }
    }
    components.push(component.sort());
  }

  return components.sort((left, right) => left[0].localeCompare(right[0]));
}

function rootReasonings(
  component: readonly string[],
  byId: ReadonlyMap<string, RadialKnowledgeLayoutNode>,
  producerByKnowledge: ReadonlyMap<string, readonly string[]>,
): string[] {
  const componentSet = new Set(component);
  const reasonings = component.filter(id => isReasoning(byId.get(id)!));
  const roots = reasonings.filter(reasoningId => {
    const reasoning = byId.get(reasoningId)!;
    return (reasoning.premises ?? []).every(premiseId =>
      (producerByKnowledge.get(premiseId) ?? [])
        .every(parentReasoningId => !componentSet.has(parentReasoningId)),
    );
  });
  return (roots.length ? roots : reasonings.slice(0, 1)).sort();
}

function placeRootReasonings(
  rootIds: readonly string[],
  byId: ReadonlyMap<string, RadialKnowledgeLayoutNode>,
  direction: THREE.Vector3,
): string[] {
  if (!rootIds.length) return [];
  const anchor = direction.clone().multiplyScalar(CHAIN_START_RADIUS);
  const { u, v } = tangentBasis(direction);
  const ringRadius = rootIds.length <= 1
    ? 0
    : Math.min(
        RADIAL_LAYOUT_LINK_LENGTH,
        RADIAL_LAYOUT_MIN_PLANE_SPACING / (2 * Math.sin(Math.PI / rootIds.length)),
      );

  rootIds.forEach((id, index) => {
    const node = byId.get(id);
    if (!node) return;
    if (rootIds.length === 1) {
      setPosition(node, anchor);
      return;
    }
    const angle = index * Math.PI * 2 / rootIds.length;
    setPosition(
      node,
      anchor.clone()
        .addScaledVector(u, ringRadius * Math.cos(angle))
        .addScaledVector(v, ringRadius * Math.sin(angle)),
    );
  });
  return [...rootIds];
}

function placeChainComponent(
  component: readonly string[],
  byId: ReadonlyMap<string, RadialKnowledgeLayoutNode>,
  conclusionsByReasoning: ReadonlyMap<string, readonly string[]>,
  producerByKnowledge: ReadonlyMap<string, readonly string[]>,
  direction: THREE.Vector3,
): void {
  const reasoningIds = component.filter(id => isReasoning(byId.get(id)!));
  if (!reasoningIds.length) {
    const standalone = byId.get(component[0]);
    if (standalone) setPosition(standalone, direction.clone().multiplyScalar(CHAIN_START_RADIUS));
    return;
  }

  const placed = new Set<string>();
  const roots = rootReasonings(component, byId, producerByKnowledge);
  const queue = placeRootReasonings(roots, byId, direction);
  roots.forEach(id => placed.add(id));
  let head = 0;

  while (head < queue.length) {
    const reasoningId = queue[head++];
    const reasoning = byId.get(reasoningId);
    if (!reasoning?.pos) continue;

    const premises = (reasoning.premises ?? [])
      .filter(id => component.includes(id) && !placed.has(id))
      .map(id => byId.get(id))
      .filter((node): node is RadialKnowledgeLayoutNode => Boolean(node));
    const premisePositions = positionsOnPerpendicularPlane(
      reasoning.pos,
      direction,
      premises.length,
      false,
    );
    premises.forEach((node, index) => {
      setPosition(node, premisePositions[index]);
      placed.add(node.id);
    });

    const conclusions = (conclusionsByReasoning.get(reasoningId) ?? [])
      .filter(id => component.includes(id))
      .map(id => byId.get(id))
      .filter((node): node is RadialKnowledgeLayoutNode => Boolean(node));
    const unplacedConclusions = conclusions.filter(node => !placed.has(node.id));
    const conclusionPositions = positionsOnPerpendicularPlane(
      reasoning.pos,
      direction,
      unplacedConclusions.length,
      true,
    );
    unplacedConclusions.forEach((node, index) => {
      setPosition(node, conclusionPositions[index]);
      placed.add(node.id);
    });

    for (const conclusion of conclusions) {
      if (!conclusion.pos) continue;
      const children = reasoningIds
        .filter(id => !placed.has(id) && (byId.get(id)?.premises ?? []).includes(conclusion.id))
        .sort();
      const childPositions = positionsOnPerpendicularPlane(
        conclusion.pos,
        direction,
        children.length,
        true,
      );
      children.forEach((childId, index) => {
        const child = byId.get(childId);
        if (!child) return;
        setPosition(child, childPositions[index]);
        placed.add(childId);
        queue.push(childId);
      });
    }
  }

  // Phase 1 deliberately does not solve arbitrary cyclic/merge constraints.
  // Any still-unplaced node gets a deterministic reserved position on this spoke
  // without changing positions that already satisfy the single-chain equations.
  let reserveIndex = 0;
  for (const id of component) {
    if (placed.has(id)) continue;
    const node = byId.get(id);
    if (!node) continue;
    const reserveRadius = CHAIN_START_RADIUS + RADIAL_LAYOUT_LINK_LENGTH * (reserveIndex + 1);
    setPosition(node, direction.clone().multiplyScalar(reserveRadius));
    reserveIndex += 1;
  }
}

function placeLineageBranches(nodes: RadialKnowledgeLayoutNode[]): void {
  const groups = new Map<string, RadialKnowledgeLayoutNode[]>();
  for (const node of nodes) {
    if (!node.lineage) continue;
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
    if (grayCandidate) {
      setPosition(grayCandidate, base.pos.clone().addScaledVector(v, RADIAL_LAYOUT_LINK_LENGTH));
    }
    const redCandidate = members.find(node => lineageRoleFor(node) === 'candidate-opposition');
    if (redCandidate) {
      setPosition(redCandidate, base.pos.clone().addScaledVector(v, -RADIAL_LAYOUT_LINK_LENGTH));
    }
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

/**
 * Single runtime owner for knowledge-node geometry.
 *
 * Old uniform-layer and relation-length layouts are intentionally not called.
 * Current main knowledge forms radial components; premise -> reasoning ->
 * conclusion chains grow from the ball center outward with L=5r. Gray/red
 * lineage branches are perpendicular to that radial direction.
 */
export function applyRadialKnowledgeLayout<T extends RadialKnowledgeLayoutNode>(nodes: T[]): T[] {
  placeCoreNodes(nodes);

  const primaryNodes = nodes.filter(isPrimaryNode);
  const byId = new Map(primaryNodes.map(node => [node.id, node] as const));
  const { adjacency, conclusionsByReasoning, producerByKnowledge } = buildPrimaryAdjacency(primaryNodes);
  const components = connectedComponents(primaryNodes.map(node => node.id), adjacency);

  components.forEach((component, index) => {
    placeChainComponent(
      component,
      byId,
      conclusionsByReasoning,
      producerByKnowledge,
      componentDirection(index, components.length),
    );
  });

  placeLineageBranches(nodes);

  // Legacy hidden records that are neither current nor formal lineage still get
  // finite coordinates so scene internals never receive an undefined position.
  let hiddenReserve = 0;
  for (const node of nodes) {
    if (node.pos) continue;
    const direction = componentDirection(hiddenReserve, Math.max(1, nodes.length));
    setPosition(node, direction.multiplyScalar(CHAIN_START_RADIUS + RADIAL_LAYOUT_LINK_LENGTH * 6));
    hiddenReserve += 1;
  }

  return nodes;
}
