export const SPATIAL_LAYOUT_SNAPSHOT_SCHEMA_VERSION = 1 as const;
export const SPATIAL_LAYOUT_ALGORITHM_VERSION = 'deterministic-5r-isg-v1' as const;

export interface SpatialSnapshotVector { x: number; y: number; z: number; }
export interface SpatialSnapshotAddress { shellID: string; cellID: number; }
export interface SpatialSnapshotNode {
  id: string;
  address: SpatialSnapshotAddress | null;
  pos: SpatialSnapshotVector | null;
}

/** A cache of existing deterministic layout output; the event stream remains authoritative. */
export interface SpatialLayoutSnapshot {
  schemaVersion: typeof SPATIAL_LAYOUT_SNAPSHOT_SCHEMA_VERSION;
  knowledgeVersion: string;
  algorithmVersion: typeof SPATIAL_LAYOUT_ALGORITHM_VERSION;
  graphSignature: string;
  nodes: SpatialSnapshotNode[];
}
