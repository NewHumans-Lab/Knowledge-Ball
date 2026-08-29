import * as THREE from 'three';
import { reasoningConclusionBindingFor } from '../../domain/ReasoningConclusion';
import type { LayoutNode } from './Deterministic5RLayout';

const EPSILON = 1e-12;

function meanRadius(nodes: readonly LayoutNode[]): number {
  return nodes.reduce((sum, node) => sum + node.pos!.length(), 0) / nodes.length;
}

function clearReasoningSpatialState(reasoning: LayoutNode): void {
  delete reasoning.address;
  delete reasoning.pos;
  delete reasoning.homePos;
  reasoning.vel?.set(0, 0, 0);
}

/**
 * Reasoning is a non-authoritative visual node. Knowledge positions are already
 * final when this projection runs, so Reasoning must never influence ISG
 * occupancy, shell/cell authority, or Knowledge placement.
 *
 * Semantic ownership is resolved before geometry: every Reasoning ball serves
 * exactly one concrete ordinary Knowledge conclusion ball. Reasoning side/history
 * variants inherit that exact conclusion through their Reasoning lineage target;
 * they never retarget themselves to a newer Current ball of the same topic.
 *
 * Radial rule remains deliberately narrow:
 * - radius = midpoint between premise shell radius and the served conclusion radius;
 * - direction = the served conclusion direction;
 * - therefore Reasoning and its conclusion lie on one line through the ball centre.
 */
export function applyReasoningRadialPlacement(nodes: LayoutNode[]): void {
  const byId = new Map(nodes.map(node => [node.id, node]));

  for (const reasoning of nodes) {
    if (reasoning.type !== 'reasoning') continue;

    const binding = reasoningConclusionBindingFor(reasoning);
    const conclusion = binding ? byId.get(binding.conclusionId) : undefined;
    const premises = [...new Set(reasoning.premises ?? [])]
      .map(id => byId.get(id))
      .filter((node): node is LayoutNode => !!node?.pos && node.type !== 'reasoning' && node.pos.lengthSq() > EPSILON);

    if (!binding || !conclusion?.pos || conclusion.type === 'reasoning' || conclusion.pos.lengthSq() <= EPSILON || !premises.length) {
      // Invalid/incomplete Reasoning must not inherit a stale position from a
      // prior render generation and become a free-floating semantic orphan.
      clearReasoningSpatialState(reasoning);
      continue;
    }

    const conclusionAxis = conclusion.pos.clone().normalize();
    const radius = (meanRadius(premises) + conclusion.pos.length()) * 0.5;
    const position = conclusionAxis.multiplyScalar(radius);

    reasoning.pos = position.clone();
    reasoning.homePos = position.clone();
    reasoning.vel ??= new THREE.Vector3();
    reasoning.vel.set(0, 0, 0);
    delete reasoning.address;
  }
}
