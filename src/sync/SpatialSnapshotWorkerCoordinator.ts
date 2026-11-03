import { spatialSnapshotChecksum, SPATIAL_LAYOUT_ALGORITHM_VERSION, SPATIAL_LAYOUT_SNAPSHOT_SCHEMA_VERSION, type SpatialLayoutSnapshot, type SpatialSnapshotChunk, type SpatialSnapshotRebuildRequest } from './SpatialSnapshot';
import { SupabaseRealtimeBroadcast } from './SupabaseRealtimeBroadcast';

export interface SpatialSnapshotWorkerClaim {
  knowledge_version: number | string;
  graph_signature: string | null;
  lease_token: string;
  lease_expires_at: string;
  priority: number;
}
export interface SpatialSnapshotWorkerBackend {
  registerSpatialWorker(sessionId: string): Promise<boolean>;
  heartbeatSpatialWorker(sessionId: string, leaseToken: string | null): Promise<boolean>;
  requestSpatialSnapshotRebuild(sessionId: string, version: string, graphSignature: string, submitted: boolean): Promise<boolean>;
  claimSpatialSnapshotJob(sessionId: string): Promise<SpatialSnapshotWorkerClaim | null>;
  releaseSpatialSnapshotJob(sessionId: string, leaseToken: string): Promise<boolean>;
  publishSpatialSnapshotWithLease(snapshot: SpatialLayoutSnapshot, sessionId: string, leaseToken: string): Promise<boolean>;
  loadSpatialSnapshot(): Promise<SpatialLayoutSnapshot | null>;
  realtimeAccessToken(): Promise<string>;
}
export interface SpatialSnapshotGraphIdentity {
  knowledgeVersion: string;
  graphSignature: string;
}
export interface SpatialSnapshotWorkerCoordinatorOptions {
  backend: SpatialSnapshotWorkerBackend;
  sessionId: string;
  syncLatest: () => Promise<void>;
  getGraphIdentity: () => SpatialSnapshotGraphIdentity;
  computeSnapshot: (knowledgeVersion: string) => Promise<SpatialLayoutSnapshot>;
  applySnapshot: (snapshot: SpatialLayoutSnapshot) => Promise<boolean> | boolean;
  onError?: (error: unknown, phase: string) => void;
}
interface SnapshotTransfer {
  key: string;
  knowledgeVersion: string;
  algorithmVersion: string;
  graphSignature: string;
  checksum: string;
  chunkCount: number;
  totalNodes: number;
  chunks: Map<number, SpatialSnapshotChunk['nodes']>;
}
function versionNumber(value: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error('Invalid spatial snapshot knowledge version');
  return BigInt(value);
}

/** Coordinates priority-ordered browser workers, leases, complete Broadcast assembly and CAS publication. */
export class SpatialSnapshotWorkerCoordinator {
  private readonly realtime: SupabaseRealtimeBroadcast;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private active = false;
  private initialSnapshotLoaded = false;
  private pendingSnapshot: SpatialLayoutSnapshot | null = null;
  private computing = false;
  private activeLeaseToken: string | null = null;
  private transfer: SnapshotTransfer | null = null;
  private latestAppliedVersion = -1n;
  private latestRequest: Promise<boolean> | null = null;
  private fallbackAttemptScheduled = false;
  private workPending = false;

  constructor(private readonly options: SpatialSnapshotWorkerCoordinatorOptions, realtimeConfig: { projectUrl: string; publishableKey: string }) {
    this.realtime = new SupabaseRealtimeBroadcast(
      realtimeConfig.projectUrl,
      realtimeConfig.publishableKey,
      () => this.options.backend.realtimeAccessToken(),
      {
        onChunk: chunk => { void this.acceptChunk(chunk); },
        onRebuildRequested: request => { void this.handleRebuildRequest(request); },
        onConnected: reconnected => {
          if (this.initialSnapshotLoaded) void this.reconcileCurrentSnapshot(reconnected ? 'reconnect' : 'late-connect');
        },
        onError: error => this.options.onError?.(error, 'realtime'),
      },
    );
  }

  async start(): Promise<void> {
    if (this.active) return;
    this.active = true;
    await this.options.backend.registerSpatialWorker(this.options.sessionId);
    this.heartbeatTimer = globalThis.setInterval(() => {
      void this.options.backend.heartbeatSpatialWorker(this.options.sessionId, this.activeLeaseToken)
        .catch(error => this.options.onError?.(error, 'heartbeat'));
    }, 20_000);
    // Subscribe without delaying the initial database read. A late first
    // connection re-reads once to close the read/subscribe race.
    void this.realtime.start(900);
  }

  stop(): void {
    this.active = false;
    this.realtime.stop();
    if (this.heartbeatTimer !== null) globalThis.clearInterval(this.heartbeatTimer);
    if (this.retryTimer !== null) globalThis.clearTimeout(this.retryTimer);
    this.heartbeatTimer = null;
    this.retryTimer = null;
  }

  async markInitialSnapshotLoaded(): Promise<void> {
    this.initialSnapshotLoaded = true;
    const pending = this.pendingSnapshot;
    this.pendingSnapshot = null;
    if (pending) await this.applyCompleteSnapshot(pending);
  }

  /** Requester calls this only after the event has been acknowledged by Supabase. */
  async requestLatestRebuild(submitted = false): Promise<boolean> {
    if (!this.active) return false;
    if (this.latestRequest && !submitted) return this.latestRequest;
    const request = (async () => {
      await this.options.syncLatest();
      const identity = this.options.getGraphIdentity();
      if (this.computing) this.workPending = true;
      this.fallbackAttemptScheduled = false;
      const accepted = await this.options.backend.requestSpatialSnapshotRebuild(
        this.options.sessionId, identity.knowledgeVersion, identity.graphSignature, submitted,
      );
      this.scheduleClaim(submitted ? 0 : 3_000);
      return accepted;
    })();
    this.latestRequest = request;
    try { return await request; }
    catch (error) {
      this.options.onError?.(error, 'request');
      this.scheduleClaim(5_000);
      return false;
    } finally {
      if (this.latestRequest === request) this.latestRequest = null;
    }
  }

  private async handleRebuildRequest(request: SpatialSnapshotRebuildRequest): Promise<void> {
    try {
      const requested = String(request?.knowledgeVersion ?? '');
      if (!/^\d+$/.test(requested)) return;
      await this.options.syncLatest();
      const identity = this.options.getGraphIdentity();
      if (versionNumber(identity.knowledgeVersion) < versionNumber(requested)) {
        this.scheduleClaim(2_000);
        return;
      }
      if (this.computing) this.workPending = true;
      this.fallbackAttemptScheduled = false;
      await this.options.backend.requestSpatialSnapshotRebuild(
        this.options.sessionId, identity.knowledgeVersion, identity.graphSignature, false,
      );
      this.scheduleClaim(3_000);
    } catch (error) {
      this.options.onError?.(error, 'rebuild-request');
      this.scheduleClaim(5_000);
    }
  }

  private scheduleClaim(delayMs: number): void {
    if (!this.active || this.computing) return;
    if (this.retryTimer !== null) globalThis.clearTimeout(this.retryTimer);
    this.retryTimer = globalThis.setTimeout(() => {
      this.retryTimer = null;
      void this.claimAndCompute();
    }, delayMs);
  }

  private async claimAndCompute(): Promise<void> {
    if (!this.active || this.computing) return;
    this.computing = true;
    let claim: SpatialSnapshotWorkerClaim | null = null;
    let published = false;
    let retryDelay: number | null = null;
    try {
      claim = await this.options.backend.claimSpatialSnapshotJob(this.options.sessionId);
      if (!claim) {
        // Give existing online workers time to win. A newly opened page makes
        // one delayed fallback attempt, not a periodic database polling loop.
        if (!this.fallbackAttemptScheduled) {
          this.fallbackAttemptScheduled = true;
          retryDelay = 20_000;
        }
        return;
      }
      this.fallbackAttemptScheduled = false;
      this.activeLeaseToken = claim.lease_token;
      const targetVersion = String(claim.knowledge_version);
      await this.options.syncLatest();
      const identity = this.options.getGraphIdentity();
      if (identity.knowledgeVersion !== targetVersion
        || (claim.graph_signature && identity.graphSignature !== claim.graph_signature)) {
        await this.options.backend.releaseSpatialSnapshotJob(this.options.sessionId, claim.lease_token);
        claim = null;
        retryDelay = 1_500;
        return;
      }

      const snapshot = await this.options.computeSnapshot(targetVersion);
      if (snapshot.knowledgeVersion !== targetVersion
        || snapshot.algorithmVersion !== SPATIAL_LAYOUT_ALGORITHM_VERSION
        || (claim.graph_signature && snapshot.graphSignature !== claim.graph_signature)) {
        throw new Error('Computed spatial snapshot does not match the leased graph version');
      }
      published = await this.options.backend.publishSpatialSnapshotWithLease(
        snapshot, this.options.sessionId, claim.lease_token,
      );
      if (published) {
        await this.applyCompleteSnapshot(snapshot);
      } else {
        await this.options.backend.releaseSpatialSnapshotJob(this.options.sessionId, claim.lease_token);
        claim = null;
        retryDelay = 1_000;
      }
    } catch (error) {
      this.options.onError?.(error, 'compute-or-publish');
      if (claim) {
        await this.options.backend.releaseSpatialSnapshotJob(this.options.sessionId, claim.lease_token)
          .catch(releaseError => this.options.onError?.(releaseError, 'lease-release'));
        claim = null;
      }
      retryDelay = 5_000;
    } finally {
      this.activeLeaseToken = null;
      this.computing = false;
      if (this.workPending && this.active) {
        this.workPending = false;
        retryDelay = 1_000;
      }
      if (retryDelay !== null && this.active) this.scheduleClaim(retryDelay);
    }
  }

  private async acceptChunk(chunk: SpatialSnapshotChunk): Promise<void> {
    try {
      if (!chunk || !/^\d+$/.test(String(chunk.knowledgeVersion))
        || chunk.algorithmVersion !== SPATIAL_LAYOUT_ALGORITHM_VERSION
        || !/^[0-9a-f]{8}$/.test(chunk.graphSignature)
        || !/^[0-9a-f]{8}$/.test(chunk.checksum)
        || !Number.isSafeInteger(chunk.chunkIndex)
        || !Number.isSafeInteger(chunk.chunkCount)
        || !Number.isSafeInteger(chunk.totalNodes)
        || chunk.chunkIndex < 0 || chunk.chunkCount < 1
        || chunk.chunkCount > 4096 || chunk.chunkIndex >= chunk.chunkCount
        || chunk.totalNodes < 0 || chunk.totalNodes > 200_000
        || !Array.isArray(chunk.nodes)) return;

      const version = versionNumber(String(chunk.knowledgeVersion));
      if (version < this.latestAppliedVersion) return;
      const key = [chunk.knowledgeVersion, chunk.algorithmVersion, chunk.graphSignature, chunk.checksum].join(':');
      if (!this.transfer || this.transfer.key !== key) {
        if (this.transfer && versionNumber(this.transfer.knowledgeVersion) > version) return;
        this.transfer = {
          key, knowledgeVersion: String(chunk.knowledgeVersion), algorithmVersion: chunk.algorithmVersion,
          graphSignature: chunk.graphSignature, checksum: chunk.checksum,
          chunkCount: chunk.chunkCount, totalNodes: chunk.totalNodes, chunks: new Map(),
        };
      }
      const transfer = this.transfer;
      if (transfer.chunkCount !== chunk.chunkCount || transfer.totalNodes !== chunk.totalNodes) {
        this.transfer = null;
        return;
      }
      const existing = transfer.chunks.get(chunk.chunkIndex);
      if (existing) {
        if (spatialSnapshotChecksum(existing) !== spatialSnapshotChecksum(chunk.nodes)) this.transfer = null;
        return;
      }
      transfer.chunks.set(chunk.chunkIndex, chunk.nodes);
      if (transfer.chunks.size !== transfer.chunkCount) return;

      const nodes: SpatialLayoutSnapshot['nodes'] = [];
      for (let index = 0; index < transfer.chunkCount; index += 1) {
        const part = transfer.chunks.get(index);
        if (!part) return;
        nodes.push(...part);
      }
      this.transfer = null;
      if (nodes.length !== transfer.totalNodes || spatialSnapshotChecksum(nodes) !== transfer.checksum) {
        throw new Error('Spatial snapshot broadcast failed completeness/checksum validation');
      }
      await this.applyCompleteSnapshot({
        schemaVersion: SPATIAL_LAYOUT_SNAPSHOT_SCHEMA_VERSION,
        knowledgeVersion: transfer.knowledgeVersion,
        algorithmVersion: SPATIAL_LAYOUT_ALGORITHM_VERSION,
        graphSignature: transfer.graphSignature,
        checksum: transfer.checksum,
        nodes,
      });
    } catch (error) {
      this.options.onError?.(error, 'broadcast-assembly');
      this.transfer = null;
    }
  }

  private async applyCompleteSnapshot(snapshot: SpatialLayoutSnapshot): Promise<void> {
    if (!this.initialSnapshotLoaded) {
      if (!this.pendingSnapshot
        || versionNumber(snapshot.knowledgeVersion) >= versionNumber(this.pendingSnapshot.knowledgeVersion)) {
        this.pendingSnapshot = snapshot;
      }
      return;
    }
    const applied = await this.options.applySnapshot(snapshot);
    if (applied) {
      const version = versionNumber(snapshot.knowledgeVersion);
      if (version > this.latestAppliedVersion) this.latestAppliedVersion = version;
    } else {
      void this.requestLatestRebuild(false);
    }
  }

  private async reconcileCurrentSnapshot(reason: string): Promise<void> {
    try {
      const snapshot = await this.options.backend.loadSpatialSnapshot();
      if (snapshot) await this.applyCompleteSnapshot(snapshot);
      else if (reason === 'reconnect') void this.requestLatestRebuild(false);
    } catch (error) {
      this.options.onError?.(error, 'snapshot-reconcile');
    }
  }
}
