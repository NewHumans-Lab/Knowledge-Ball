import * as THREE from 'three';
import type { LayoutNode } from './Deterministic5RLayout';

const EPSILON = 1e-12;

function positionedKnowledge(nodes: readonly LayoutNode[]): LayoutNode[] {
  return nodes.filter(node => node.type !== 'reasoning' && !!node.pos && node.pos.lengthSq() > EPSILON);
}

function meanRadius(nodes: readonly LayoutNode[]): number {
  return nodes.reduce((sum, node) => sum + node.pos!.length(), 0) / nodes.length;
}

/**
 * Reasoning is a non-authoritative visual node. Knowledge positions are already
 * final when this projection runs, so Reasoning must never influence ISG
 * occupancy, shell/cell authority, or Knowledge placement.
 *
 * Radial rule:
 * - radius = midpoint between the premise shell radius and conclusion shell radius;
 * - direction = conclusion direction;
 * - therefore Reasoning and its conclusion lie on one line through the ball centre.
 *
 * For the uncommon multi-conclusion relation, the normalized conclusion centroid
 * is the shared radial axis. A normal one-conclusion relation is exactly collinear
 * with that conclusion and the origin.
 */
export function applyReasoningRadialPlacement(nodes: LayoutNode[]): void {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const knowledge = positionedKnowledge(nodes);

  for (const reasoning of nodes) {
    if (reasoning.type !== 'reasoning') continue;

    const premises = [...new Set(reasoning.premises ?? [])]
      .map(id => byId.get(id))
      .filter((node): node is LayoutNode => !!node?.pos && node.type !== 'reasoning' && node.pos.lengthSq() > EPSILON);
    const conclusions = knowledge.filter(node => node.premises?.includes(reasoning.id));
    if (!premises.length || !conclusions.length) continue;

    const conclusionAxis = conclusions.reduce(
      (sum, node) => sum.add(node.pos!.clone().normalize()),
      new THREE.Vector3(),
    );
    if (conclusionAxis.lengthSq() <= EPSILON) conclusionAxis.copy(conclusions[0]!.pos!);
    conclusionAxis.normalize();

    const radius = (meanRadius(premises) + meanRadius(conclusions)) * 0.5;
    const position = conclusionAxis.multiplyScalar(radius);

    reasoning.pos = position.clone();
    reasoning.homePos = position.clone();
    reasoning.vel ??= new THREE.Vector3();
    reasoning.vel.set(0, 0, 0);
    delete reasoning.address;
  }
}
