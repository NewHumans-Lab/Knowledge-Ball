import * as THREE from 'three';
import { bindReasoningConclusions } from '../../domain/ReasoningConclusion';
import { lineageRoleFor } from '../../domain/KnowledgeLineage';
import { isSystemCoreNodeId } from '../../domain/KnowledgeLayerPolicy';
import {
  generateIcosahedralGrid,
  LAYOUT_UNIT,
  type LayoutNode,
} from './Deterministic5RLayout';
import { applyReasoningRadialPlacement } from './ReasoningRadialPlacement';
import { SUN_ORBIT_RADIUS, SUN_TRIAD_IDS } from '../config/KnowledgeUiConfig';
import {
  SPATIAL_LAYOUT_ALGORITHM_VERSION,
  SPATIAL_LAYOUT_SNAPSHOT_SCHEMA_VERSION,
  spatialSnapshotChecksum,
  type SpatialLayoutSnapshot,
  type SpatialSnapshotNode,
} from '../../sync/SpatialSnapshot';

type SnapshotInputNode = LayoutNode & { status?: string };
const EPSILON = 1e-6;

function finiteVector(value: { x: number; y: number; z: number } | undefined): boolean {
  return Boolean(value && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z));
}

/** Compatibility fingerprint only; it never participates in node placement or ordering. */
export function spatialLayoutGraphSignature(nodes: readonly LayoutNode[]): string {
  const canonical = [...nodes].sort((a, b) => a.id.localeCompare(b.id)).map(node => {
    const value = node as SnapshotInputNode;
    const lineage = node.lineage;
    return {
      id: node.id,
      type: node.type ?? null,
      status: value.status ?? null,
      premises: [...(node.premises ?? [])].sort(),
      hidden: node.hidden ?? false,
      declaredLayer: node.declaredLayer ?? null,
      effectiveLayer: node.effectiveLayer ?? null,
      layer: node.layer ?? null,
      lineage: lineage ? {
        topicId: lineage.topicId,
        proposal: lineage.proposal,
        targetId: lineage.targetId ?? null,
        role: lineage.role,
        rank: lineage.rank,
        reasoningSide: lineage.reasoningSide ?? null,
        reasoningSideRank: lineage.reasoningSideRank ?? null,
        reasoningDominant: lineage.reasoningDominant ?? null,
      } : null,
    };
  });
  const source = JSON.stringify(canonical);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Persist the exact address and position fields produced by applyUniformLayerLayout. */
export function createSpatialLayoutSnapshot(nodes: readonly LayoutNode[], knowledgeVersion: string): SpatialLayoutSnapshot {
  if (!/^\d+$/.test(knowledgeVersion)) throw new Error('Spatial snapshot knowledge version must be a non-negative integer string');
  const snapshotNodes: SpatialSnapshotNode[] = [...nodes].sort((a, b) => a.id.localeCompare(b.id)).map(node => {
    if (node.pos && !finiteVector(node.pos)) throw new Error('Cannot persist non-finite spatial position for ' + node.id);
    if (node.address && !node.pos) throw new Error('Cannot persist a spatial address without a position for ' + node.id);
    return {
      id: node.id,
      address: node.address ? { shellID: node.address.shellID, cellID: node.address.cellID } : null,
      pos: node.pos ? { x: node.pos.x, y: node.pos.y, z: node.pos.z } : null,
    };
  });
  return {
    schemaVersion: SPATIAL_LAYOUT_SNAPSHOT_SCHEMA_VERSION,
    knowledgeVersion,
    algorithmVersion: SPATIAL_LAYOUT_ALGORITHM_VERSION,
    graphSignature: spatialLayoutGraphSignature(nodes),
    checksum: spatialSnapshotChecksum(snapshotNodes),
    nodes: snapshotNodes,
  };
}

function hasFiveRSpacing(points: readonly THREE.Vector3[]): boolean {
  const buckets = new Map<string, THREE.Vector3[]>();
  const coordinate = (value: number) => Math.floor(value / LAYOUT_UNIT);
  const key = (x: number, y: number, z: number) => x + ':' + y + ':' + z;
  for (const point of points) {
    const x = coordinate(point.x), y = coordinate(point.y), z = coordinate(point.z);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          const nearby = buckets.get(key(x + dx, y + dy, z + dz)) ?? [];
          if (nearby.some(other => other.distanceTo(point) + EPSILON < LAYOUT_UNIT)) return false;
        }
      }
    }
    const bucket = buckets.get(key(x, y, z)) ?? [];
    bucket.push(point);
    buckets.set(key(x, y, z), bucket);
  }
  return true;
}

/**
 * Validate the cache against the existing layout primitives before restoring it:
 * ordinary nodes must be actual vertices in their saved icosahedral shell, and
 * Reasoning positions must reproduce the existing radial-placement routine.
 * No full 5R component search is run on a cache hit.
 */
function snapshotMatchesExistingGeometry(nodes: readonly LayoutNode[], byId: ReadonlyMap<string, SpatialSnapshotNode>): boolean {
  const grids = new Map<string, ReturnType<typeof generateIcosahedralGrid>>();
  const ordinaryPositions: THREE.Vector3[] = [];
  const candidates: LayoutNode[] = [];

  for (const node of nodes) {
    const saved = byId.get(node.id);
    if (!saved) return false;
    const isReasoning = node.type === 'reasoning';
    const isCore = isSystemCoreNodeId(node.id);
    const shouldHaveOrdinaryPlacement = !isReasoning && !isCore
      && lineageRoleFor(node) !== 'rejected'
      && (!node.hidden || !!node.lineage);

    if (saved.address) {
      if (isReasoning || isCore || !saved.pos) return false;
      const match = /^shell:(\d+\.\d{6})$/.exec(saved.address.shellID);
      if (!match) return false;
      const radius = Number(match[1]);
      if (!Number.isFinite(radius) || radius <= 0) return false;
      let grid = grids.get(saved.address.shellID);
      if (!grid) {
        try {
          grid = generateIcosahedralGrid(radius, undefined, saved.address.shellID);
        } catch {
          return false;
        }
        grids.set(saved.address.shellID, grid);
      }
      const vertex = grid.vertices[saved.address.cellID];
      const position = new THREE.Vector3(saved.pos.x, saved.pos.y, saved.pos.z);
      if (!vertex || vertex.distanceTo(position) > EPSILON) return false;
      ordinaryPositions.push(position);
    } else if (shouldHaveOrdinaryPlacement) {
      return false;
    } else if (isReasoning && saved.address !== null) {
      return false;
    }

    if (isCore) {
      const index = Math.max(0, SUN_TRIAD_IDS.indexOf(node.id as (typeof SUN_TRIAD_IDS)[number]));
      const angle = index * Math.PI * 2 / SUN_TRIAD_IDS.length;
      const expected = new THREE.Vector3(
        Math.cos(angle) * SUN_ORBIT_RADIUS,
        Math.sin(angle) * SUN_ORBIT_RADIUS,
        0,
      );
      if (!saved.pos || new THREE.Vector3(saved.pos.x, saved.pos.y, saved.pos.z).distanceTo(expected) > EPSILON) return false;
    }

    const clone: LayoutNode = {
      ...node,
      premises: [...(node.premises ?? [])],
      lineage: node.lineage ? { ...node.lineage } : undefined,
      address: saved.address ? { ...saved.address } : undefined,
      pos: saved.pos ? new THREE.Vector3(saved.pos.x, saved.pos.y, saved.pos.z) : undefined,
      homePos: saved.pos ? new THREE.Vector3(saved.pos.x, saved.pos.y, saved.pos.z) : undefined,
      vel: new THREE.Vector3(),
    };
    candidates.push(clone);
  }

  if (!hasFiveRSpacing(ordinaryPositions)) return false;

  try {
    bindReasoningConclusions(candidates);
    applyReasoningRadialPlacement(candidates);
  } catch {
    return false;
  }

  const candidateById = new Map(candidates.map(node => [node.id, node]));
  for (const node of nodes) {
    if (node.type !== 'reasoning') continue;
    const expected = candidateById.get(node.id)?.pos;
    const saved = byId.get(node.id)?.pos;
    if (Boolean(expected) !== Boolean(saved)) return false;
    if (expected && saved) {
      if (expected.distanceTo(new THREE.Vector3(saved.x, saved.y, saved.z)) > EPSILON) return false;
    }
  }
  return true;
}

/** Restore only a full snapshot for the exact event head, solver version and graph input. */
export function restoreSpatialLayoutSnapshot(
  nodes: LayoutNode[],
  snapshot: SpatialLayoutSnapshot | null,
  expectedKnowledgeVersion: string,
): boolean {
  if (!snapshot
    || snapshot.schemaVersion !== SPATIAL_LAYOUT_SNAPSHOT_SCHEMA_VERSION
    || snapshot.algorithmVersion !== SPATIAL_LAYOUT_ALGORITHM_VERSION
    || snapshot.knowledgeVersion !== expectedKnowledgeVersion
    || snapshot.graphSignature !== spatialLayoutGraphSignature(nodes)
    || !Array.isArray(snapshot.nodes)
    || snapshot.checksum !== spatialSnapshotChecksum(snapshot.nodes)
    || snapshot.nodes.length !== nodes.length) return false;

  const currentIds = [...nodes].map(node => node.id).sort((a, b) => a.localeCompare(b));
  const savedIds = snapshot.nodes.map(node => node.id).sort((a, b) => a.localeCompare(b));
  if (currentIds.some((id, index) => id !== savedIds[index])) return false;

  const byId = new Map<string, SpatialSnapshotNode>();
  const occupiedAddresses = new Set<string>();
  for (const saved of snapshot.nodes) {
    if (!saved.id || byId.has(saved.id)) return false;
    if (saved.pos !== null && !finiteVector(saved.pos)) return false;
    if (saved.address !== null) {
      if (!saved.address
        || typeof saved.address.shellID !== 'string'
        || !saved.address.shellID
        || !Number.isSafeInteger(saved.address.cellID)
        || saved.address.cellID < 0
        || saved.pos === null) return false;
      const key = saved.address.shellID + ':' + saved.address.cellID;
      if (occupiedAddresses.has(key)) return false;
      occupiedAddresses.add(key);
    }
    byId.set(saved.id, saved);
  }

  if (!snapshotMatchesExistingGeometry(nodes, byId)) return false;

  // All validation is complete; only now mutate the scene nodes.
  for (const node of nodes) {
    const saved = byId.get(node.id)!;
    if (saved.address) node.address = { shellID: saved.address.shellID, cellID: saved.address.cellID };
    else delete node.address;
    if (saved.pos) {
      const position = new THREE.Vector3(saved.pos.x, saved.pos.y, saved.pos.z);
      node.pos = position.clone();
      node.homePos = position.clone();
    } else {
      delete node.pos;
      delete node.homePos;
    }
    node.vel ??= new THREE.Vector3();
    node.vel.set(0, 0, 0);
  }
  return true;
}

/**
 * Preserve the previous visible geometry while a newer graph version is being
 * solved. This is deliberately permissive and MUST NOT be used for publication:
 * strict restoreSpatialLayoutSnapshot remains the only acceptance path.
 */
export function restoreSpatialLayoutSnapshotPositions(
  nodes: LayoutNode[],
  snapshot: SpatialLayoutSnapshot | null,
): boolean {
  if (!snapshot
    || snapshot.schemaVersion !== SPATIAL_LAYOUT_SNAPSHOT_SCHEMA_VERSION
    || snapshot.algorithmVersion !== SPATIAL_LAYOUT_ALGORITHM_VERSION
    || !Array.isArray(snapshot.nodes)
    || snapshot.checksum !== spatialSnapshotChecksum(snapshot.nodes)) return false;

  const byId = new Map<string, SpatialSnapshotNode>();
  const occupied = new Set<string>();
  for (const saved of snapshot.nodes) {
    if (!saved.id || byId.has(saved.id)) return false;
    if (saved.pos !== null && !finiteVector(saved.pos)) return false;
    if (saved.address !== null) {
      if (!saved.address
        || typeof saved.address.shellID !== 'string'
        || !saved.address.shellID
        || !Number.isSafeInteger(saved.address.cellID)
        || saved.address.cellID < 0
        || saved.pos === null) return false;
      const key = saved.address.shellID + ':' + saved.address.cellID;
      if (occupied.has(key)) return false;
      occupied.add(key);
    }
    byId.set(saved.id, saved);
  }

  for (const node of nodes) {
    const saved = byId.get(node.id);
    if (!saved) {
      delete node.address;
      delete node.pos;
      delete node.homePos;
      node.vel?.set(0, 0, 0);
      continue;
    }
    if (saved.address) node.address = { ...saved.address };
    else delete node.address;
    if (saved.pos) {
      const position = new THREE.Vector3(saved.pos.x, saved.pos.y, saved.pos.z);
      node.pos = position.clone();
      node.homePos = position.clone();
    } else {
      delete node.pos;
      delete node.homePos;
    }
    node.vel ??= new THREE.Vector3();
    node.vel.set(0, 0, 0);
  }
  return true;
}
