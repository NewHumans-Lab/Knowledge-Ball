import type { LayoutNode } from './Deterministic5RLayout';
import { applyUniformLayerLayout } from './UniformLayerLayout';
import { createSpatialLayoutSnapshot } from './SpatialLayoutSnapshot';

interface LayoutWorkerRequest {
  requestId: number;
  knowledgeVersion: string;
  nodes: LayoutNode[];
}
interface LayoutWorkerResponse {
  requestId: number;
  snapshot?: ReturnType<typeof createSpatialLayoutSnapshot>;
  error?: string;
}

const workerScope = self as unknown as {
  addEventListener(type: 'message', listener: (event: MessageEvent<LayoutWorkerRequest>) => void): void;
  postMessage(message: LayoutWorkerResponse): void;
};

workerScope.addEventListener('message', event => {
  const { requestId, knowledgeVersion, nodes } = event.data;
  try {
    // Preserve the existing deterministic 5R / icosahedral solver unchanged.
    // It operates only on an isolated worker-owned copy, never on live scene nodes.
    applyUniformLayerLayout(nodes);
    workerScope.postMessage({
      requestId,
      snapshot: createSpatialLayoutSnapshot(nodes, knowledgeVersion),
    });
  } catch (error) {
    workerScope.postMessage({
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
