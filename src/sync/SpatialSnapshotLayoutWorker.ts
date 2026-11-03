import type { LayoutNode } from '../ui/scene/Deterministic5RLayout';
import type { SpatialLayoutSnapshot } from './SpatialSnapshot';

let nextRequestId = 1;

/**
 * Executes the existing production layout pipeline away from the browser main
 * thread. No fallback solver is maintained here: the worker imports the same
 * UniformLayerLayout implementation used by the original scene.
 */
type SnapshotLayoutInput = LayoutNode & { status?: string };

export function computeSpatialLayoutSnapshotInWorker(
  nodes: readonly SnapshotLayoutInput[],
  knowledgeVersion: string,
): Promise<SpatialLayoutSnapshot> {
  if (typeof Worker === 'undefined') {
    return Promise.reject(new Error('Web Workers are required for spatial snapshot computation'));
  }

  const requestId = nextRequestId++;
  const worker = new Worker(
    new URL('../ui/scene/SpatialSnapshotLayoutWorker.ts', import.meta.url),
    { type: 'module', name: 'knowledge-ball-spatial-snapshot' },
  );
  const workerNodes = nodes.map(node => ({
    id: node.id,
    type: node.type,
    status: node.status,
    premises: [...(node.premises ?? [])],
    hidden: node.hidden,
    declaredLayer: node.declaredLayer,
    effectiveLayer: node.effectiveLayer,
    layer: node.layer,
    lineage: node.lineage ? { ...node.lineage } : undefined,
  })) as LayoutNode[];

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, snapshot?: SpatialLayoutSnapshot) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      if (error) reject(error);
      else if (snapshot) resolve(snapshot);
      else reject(new Error('Spatial layout worker returned no snapshot'));
    };
    worker.onmessage = event => {
      const result = event.data as { requestId?: number; snapshot?: SpatialLayoutSnapshot; error?: string };
      if (result.requestId !== requestId) return;
      if (result.error) finish(new Error(result.error));
      else finish(undefined, result.snapshot);
    };
    worker.onerror = event => finish(new Error(event.message || 'Spatial layout worker failed'));
    worker.onmessageerror = () => finish(new Error('Spatial layout worker returned an unreadable message'));
    worker.postMessage({ requestId, knowledgeVersion, nodes: workerNodes });
  });
}
