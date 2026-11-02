import * as THREE from 'three';
import type { LayoutNode } from './Deterministic5RLayout';
import {
  SPATIAL_LAYOUT_ALGORITHM_VERSION,
  SPATIAL_LAYOUT_SNAPSHOT_SCHEMA_VERSION,
  type SpatialLayoutSnapshot,
  type SpatialSnapshotNode,
} from '../../sync/SpatialSnapshot';

type SnapshotInputNode = LayoutNode & { status?: string };
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
    nodes: snapshotNodes,
  };
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
