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

/**
 * Ordinary inner-layer nodes should not occupy the core Sun itself. The value is
 * still inside the canonical inner band; it only removes the visually unusable
 * central volume already owned by the core system.
 */
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

function radicalInverse(index: number, base: number): number {
  let i = index;
  let factor = 1 / base;
  let result = 0;
  while (i > 0) {
    result += factor * (i % base);
    i = Math.floor(i / base);
    factor /= base;
  }
  return result;
}

function stableHash32(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return h >>> 0;
}

function stableNodeOrder<T extends Pick<UniformLayoutNode, 'id'>>(nodes: T[]): T[] {
  return [...nodes].sort((a, b) => {
    const ah = stableHash32(a.id);
    const bh = stableHash32(b.id);
    return ah === bh ? a.id.localeCompare(b.id) : ah - bh;
  });
}

function radialPermutation(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index)
    .sort((a, b) => radicalInverse(a + 1, 2) - radicalInverse(b + 1, 2));
}

function relaxationIterations(count: number): number {
  if (count <= 1) return 0;
  if (count <= 128) return 24;
  if (count <= 512) return 12;
  if (count <= 1024) return 6;
  return 0;
}

/**
 * Generates a deterministic, equal-volume, blue-noise-like point set inside one
 * layer. Radial ranks are hard-stratified by shell volume. Angular directions
 * start from a Fibonacci sphere and are relaxed tangentially, so relaxation can
 * improve nearest-neighbour spacing without changing any node's radial quantile.
 */
export function uniformLayerSlots(layer: NonCoreLayer, count: number): THREE.Vector3[] {
  if (count <= 0) return [];

  const { rMin, rMax } = layoutBandForLayer(layer);
  const radialRanks = radialPermutation(count);
  const points: THREE.Vector3[] = [];
  const radii: number[] = [];

  for (let index = 0; index < count; index++) {
    const z = 1 - 2 * ((index + 0.5) / count);
    const phi = index * GOLDEN_ANGLE + LAYER_PHASE[layer];
    const xy = Math.sqrt(Math.max(0, 1 - z * z));
    const radialQuantile = (radialRanks[index] + 0.5) / count;
    const radius = Math.cbrt(
      rMin ** 3 + radialQuantile * (rMax ** 3 - rMin ** 3),
    );
    radii.push(radius);
    points.push(new THREE.Vector3(
      radius * xy * Math.cos(phi),
      radius * xy * Math.sin(phi),
      radius * z,
    ));
  }

  const iterations = relaxationIterations(count);
  if (iterations === 0) return points;

  const forces = Array.from({ length: count }, () => new THREE.Vector3());
  const delta = new THREE.Vector3();
  const unit = new THREE.Vector3();
  const tangent = new THREE.Vector3();

  for (let iteration = 0; iteration < iterations; iteration++) {
    for (const force of forces) force.set(0, 0, 0);

    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        delta.copy(points[i]).sub(points[j]);
        const distanceSq = Math.max(delta.lengthSq(), 1e-6);
        const inverseCube = 1 / (distanceSq * Math.sqrt(distanceSq));
        delta.multiplyScalar(inverseCube);
        forces[i].add(delta);
        forces[j].sub(delta);
      }
    }

    const anneal = 0.12 * (1 - iteration / iterations);
    for (let i = 0; i < count; i++) {
      const radius = radii[i];
      unit.copy(points[i]).multiplyScalar(1 / radius);
      tangent.copy(forces[i]).addScaledVector(unit, -forces[i].dot(unit));
      const tangentMagnitude = tangent.length();
      if (tangentMagnitude <= 1e-12) continue;

      const angularStep = Math.min(
        0.08,
        anneal * tangentMagnitude * radius * radius,
      );
      tangent.multiplyScalar(angularStep / tangentMagnitude);
      unit.add(tangent).normalize();
      points[i].copy(unit).multiplyScalar(radius);
    }
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
    const ordered = stableNodeOrder(groups[layer]);
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
