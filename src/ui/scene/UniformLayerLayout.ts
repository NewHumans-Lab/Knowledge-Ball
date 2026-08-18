import * as THREE from 'three';
import type { KnowledgeLayer } from '../../domain/KnowledgeLayerPolicy';
import { isSystemCoreNodeId } from '../../domain/KnowledgeLayerPolicy';
import {
  CORE_SUN_RADIUS,
  LAYER_BANDS,
  SUN_ORBIT_RADIUS,
  SUN_TRIAD_IDS,
} from '../config/KnowledgeUiConfig';

export interface UniformLayoutNode {
  id: string;
  effectiveLayer?: KnowledgeLayer;
  layer?: KnowledgeLayer;
  pos?: THREE.Vector3;
  vel?: THREE.Vector3;
  homePos?: THREE.Vector3;
  hidden?: boolean;
}

type NonCoreLayer = Exclude<KnowledgeLayer, 'core'>;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const LAYER_PHASE: Record<NonCoreLayer, number> = {
  inner: 0.37,
  middle: 1.91,
  outer: 3.43,
};

export const INNER_LAYOUT_MIN_RADIUS = Math.min(
  LAYER_BANDS.inner.rMax - 1,
  CORE_SUN_RADIUS + 9,
);

export function layoutBandForLayer(layer: NonCoreLayer): { rMin: number; rMax: number } {
  const band = LAYER_BANDS[layer];
  return {
    rMin: layer === 'inner' ? Math.max(band.rMin, INNER_LAYOUT_MIN_RADIUS) : band.rMin,
    rMax: band.rMax,
  };
}

/**
 * Generates a deterministic equal-volume low-discrepancy point set in O(n).
 * Angular directions use a Fibonacci sphere. Radial ranks use step (n - 1),
 * which is always coprime with n, so every radial stratum is visited exactly
 * once without sorting or all-pairs relaxation.
 */
export function uniformLayerSlots(layer: NonCoreLayer, count: number): THREE.Vector3[] {
  if (count <= 0) return [];

  const { rMin, rMax } = layoutBandForLayer(layer);
  const points: THREE.Vector3[] = [];
  const radialStep = count <= 1 ? 1 : count - 1;

  for (let index = 0; index < count; index++) {
    const z = 1 - 2 * ((index + 0.5) / count);
    const phi = index * GOLDEN_ANGLE + LAYER_PHASE[layer];
    const xy = Math.sqrt(Math.max(0, 1 - z * z));
    const radialRank = count <= 1 ? 0 : (index * radialStep) % count;
    const radialQuantile = (radialRank + 0.5) / count;
    const radius = Math.cbrt(
      rMin ** 3 + radialQuantile * (rMax ** 3 - rMin ** 3),
    );

    points.push(new THREE.Vector3(
      radius * xy * Math.cos(phi),
      radius * xy * Math.sin(phi),
      radius * z,
    ));
  }

  return points;
}

function coreSlot(id: string): THREE.Vector3 {
  const index = Math.max(0, SUN_TRIAD_IDS.indexOf(id as (typeof SUN_TRIAD_IDS)[number]));
  const angle = index * Math.PI * 2 / SUN_TRIAD_IDS.length;
  return new THREE.Vector3(
    Math.cos(angle) * SUN_ORBIT_RADIUS,
    Math.sin(angle) * SUN_ORBIT_RADIUS,
    0,
  );
}

/**
 * Applies one global layout pass to every current node, including hidden or
 * falsified history. Visibility is deliberately ignored: a hidden node owns a
 * real slot and therefore leaves a real gap in the visible graph.
 *
 * Node order is the authoritative projection event order, avoiding any sorting
 * step in the layout path.
 */
export function applyUniformLayerLayout<T extends UniformLayoutNode>(nodes: T[]): T[] {
  const groups: Record<NonCoreLayer, T[]> = {
    inner: [],
    middle: [],
    outer: [],
  };

  for (const node of nodes) {
    const layer = node.effectiveLayer
      ?? node.layer
      ?? (isSystemCoreNodeId(node.id) ? 'core' : undefined);
    if (!layer) throw new Error(`Missing effective layer for layout node ${node.id}`);

    node.layer = layer;
    if (layer === 'core') {
      const position = coreSlot(node.id);
      node.pos = position.clone();
      node.homePos = position.clone();
      node.vel = new THREE.Vector3();
    } else {
      groups[layer].push(node);
    }
  }

  (Object.keys(groups) as NonCoreLayer[]).forEach(layer => {
    const ordered = groups[layer];
    const slots = uniformLayerSlots(layer, ordered.length);
    ordered.forEach((node, index) => {
      const position = slots[index];
      node.pos = position.clone();
      node.homePos = position.clone();
      node.vel = new THREE.Vector3();
      node.layer = layer;
    });
  });

  return nodes;
}
