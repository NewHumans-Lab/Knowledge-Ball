export const SPATIAL_LAYOUT_SNAPSHOT_SCHEMA_VERSION = 1 as const;
export const SPATIAL_LAYOUT_ALGORITHM_VERSION = 'deterministic-5r-isg-v1' as const;

export interface SpatialSnapshotVector { x: number; y: number; z: number; }
export interface SpatialSnapshotAddress { shellID: string; cellID: number; }
export interface SpatialSnapshotNode {
  id: string;
  address: SpatialSnapshotAddress | null;
  pos: SpatialSnapshotVector | null;
}

/** Canonical JSON is independent of key order after JSONB/Realtime round trips. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? 'null' : encoded;
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const record = value as Record<string, unknown>;
  return '{' + Object.keys(record).sort().map(key =>
    JSON.stringify(key) + ':' + canonicalJson(record[key]),
  ).join(',') + '}';
}

export function spatialSnapshotChecksum(nodes: readonly SpatialSnapshotNode[]): string {
  const source = canonicalJson(nodes);
  let hash = 2166136261;
  for (const character of source) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** A cache of exact deterministic layout output; the event stream remains authoritative. */
export interface SpatialLayoutSnapshot {
  schemaVersion: typeof SPATIAL_LAYOUT_SNAPSHOT_SCHEMA_VERSION;
  knowledgeVersion: string;
  algorithmVersion: typeof SPATIAL_LAYOUT_ALGORITHM_VERSION;
  graphSignature: string;
  checksum: string;
  nodes: SpatialSnapshotNode[];
}

export interface SpatialSnapshotRebuildRequest { knowledgeVersion: string; }
export interface SpatialSnapshotChunk {
  knowledgeVersion: string;
  algorithmVersion: string;
  graphSignature: string;
  checksum: string;
  chunkIndex: number;
  chunkCount: number;
  totalNodes: number;
  nodes: SpatialSnapshotNode[];
}
