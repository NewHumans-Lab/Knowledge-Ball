import type { SpatialSnapshotChunk, SpatialSnapshotRebuildRequest } from './SpatialSnapshot';

export interface SupabaseRealtimeBroadcastHandlers {
  onChunk: (chunk: SpatialSnapshotChunk) => void;
  onRebuildRequested: (request: SpatialSnapshotRebuildRequest) => void;
  onConnected: (reconnected: boolean) => void;
  onError?: (error: unknown) => void;
}

/**
 * Minimal Phoenix/Reatime WebSocket transport for the one public snapshot topic.
 * It intentionally avoids a second Supabase client/runtime dependency.
 */
export class SupabaseRealtimeBroadcast {
  private socket: WebSocket | null = null;
  private ref = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private retryIndex = 0;
  private running = false;
  private connected = false;
  private everConnected = false;
  private pendingJoin: { resolve: () => void; reject: (error: Error) => void } | null = null;
  private joinRef: string | null = null;
  private activeAccessToken: string | null = null;

  constructor(
    private readonly projectUrl: string,
    private readonly publishableKey: string,
    private readonly accessToken: () => Promise<string>,
    private readonly handlers: SupabaseRealtimeBroadcastHandlers,
  ) {}

  async start(timeoutMs = 2_500): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await Promise.race([
        this.connect(),
        new Promise<never>((_, reject) => globalThis.setTimeout(
          () => reject(new Error('Realtime subscription startup timed out')),
          timeoutMs,
        )),
      ]);
    } catch (error) {
      this.handlers.onError?.(error);
      // The reconnect loop remains active; initial page bootstrap must not wait
      // for Realtime availability before it can read the current snapshot once.
      this.scheduleReconnect();
    }
  }

  stop(): void {
    this.running = false;
    if (this.reconnectTimer !== null) globalThis.clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer !== null) globalThis.clearInterval(this.heartbeatTimer);
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.pendingJoin?.reject(new Error('Realtime stopped'));
    this.pendingJoin = null;
    const socket = this.socket;
    this.socket = null;
    this.connected = false;
    this.joinRef = null;
    this.activeAccessToken = null;
    socket?.close(1000, 'client stopped');
  }

  isConnected(): boolean { return this.connected; }

  private async connect(): Promise<void> {
    if (!this.running || this.connected) return;
    if (this.socket && (this.socket.readyState === WebSocket.CONNECTING || this.socket.readyState === WebSocket.OPEN)) return;
    const token = await this.accessToken();
    const endpoint = new URL('/realtime/v1/websocket', this.projectUrl);
    endpoint.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:';
    endpoint.searchParams.set('apikey', this.publishableKey);
    endpoint.searchParams.set('vsn', '1.0.0');

    const socket = new WebSocket(endpoint);
    this.socket = socket;
    const joinRef = this.nextRef();
    this.joinRef = joinRef;
    this.activeAccessToken = token;

    await new Promise<void>((resolve, reject) => {
      const joinTimeout = globalThis.setTimeout(() => {
        if (this.pendingJoin) this.pendingJoin = null;
        reject(new Error('Realtime channel join timed out'));
        socket.close(4000, 'channel join timed out');
      }, 8_000);
      this.pendingJoin = {
        resolve: () => {
          globalThis.clearTimeout(joinTimeout);
          resolve();
        },
        reject: error => {
          globalThis.clearTimeout(joinTimeout);
          reject(error);
        },
      };

      socket.onopen = () => {
        this.send({
          topic: 'realtime:public-spatial-snapshot',
          event: 'phx_join',
          payload: {
            config: {
              broadcast: { ack: false, self: false },
              presence: { key: '', enabled: false },
              postgres_changes: [],
              private: true,
            },
            access_token: token,
          },
          ref: joinRef,
          join_ref: joinRef,
        });
      };

      socket.onmessage = event => this.handleMessage(event.data);
      socket.onerror = () => {
        this.pendingJoin?.reject(new Error('Realtime WebSocket connection failed'));
      };
      socket.onclose = () => {
        this.connected = false;
        this.joinRef = null;
        this.activeAccessToken = null;
        if (this.heartbeatTimer !== null) globalThis.clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
        this.pendingJoin?.reject(new Error('Realtime WebSocket closed before join completed'));
        this.pendingJoin = null;
        if (this.running) this.scheduleReconnect();
      };
    });
  }

  private handleMessage(raw: unknown): void {
    let message: Record<string, unknown>;
    try {
      if (typeof raw !== 'string') return;
      message = JSON.parse(raw) as Record<string, unknown>;
    } catch (error) {
      this.handlers.onError?.(error);
      return;
    }

    if (message.event === 'phx_reply') {
      // Only the pending phx_join reply establishes the channel. Heartbeat
      // replies are also phx_reply frames and must not trigger DB reconciliation.
      if (!this.pendingJoin) return;
      const payload = message.payload as { status?: string; response?: unknown } | undefined;
      if (payload?.status === 'ok') {
        this.connected = true;
        this.retryIndex = 0;
        const reconnected = this.everConnected;
        this.everConnected = true;
        this.pendingJoin?.resolve();
        this.pendingJoin = null;
        this.startHeartbeat();
        this.handlers.onConnected(reconnected);
      } else if (payload?.status === 'error') {
        this.pendingJoin?.reject(new Error('Realtime channel authorization/join failed'));
        this.pendingJoin = null;
        this.socket?.close(4003, 'channel join failed');
      }
      return;
    }

    if (message.event === 'system') {
      const systemPayload = message.payload as { status?: string; message?: string } | undefined;
      if (systemPayload?.status === 'error') {
        this.handlers.onError?.(new Error(systemPayload.message || 'Realtime channel system error'));
        this.socket?.close(4003, 'Realtime channel system error');
      }
      return;
    }
    if (message.event === 'phx_error' || message.event === 'phx_close') {
      this.socket?.close(4003, 'Realtime channel closed by server');
      return;
    }
    if (message.event !== 'broadcast') return;
    const payload = message.payload as { type?: string; event?: string; payload?: unknown } | undefined;
    if (payload?.type !== 'broadcast' || typeof payload.event !== 'string' || !payload.payload || typeof payload.payload !== 'object') return;
    if (payload.event === 'spatial_snapshot_chunk') {
      this.handlers.onChunk(payload.payload as SpatialSnapshotChunk);
    } else if (payload.event === 'spatial_snapshot_rebuild_requested') {
      this.handlers.onRebuildRequested(payload.payload as SpatialSnapshotRebuildRequest);
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer !== null) globalThis.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = globalThis.setInterval(() => {
      const socket = this.socket;
      if (!this.connected || socket?.readyState !== WebSocket.OPEN) return;
      void this.sendHeartbeatAndRefreshToken(socket);
    }, 25_000);
  }

  private async sendHeartbeatAndRefreshToken(socket: WebSocket): Promise<void> {
    try {
      // publicSession refreshes a JWT when it is within 60 seconds of expiry.
      // Supabase's private-channel protocol accepts access_token in-band, so a
      // long-lived page need not wait for expiry and reconnect before it can
      // continue receiving authenticated snapshot broadcasts.
      const token = await this.accessToken();
      if (!this.connected || this.socket !== socket || socket.readyState !== WebSocket.OPEN) return;
      if (token && token !== this.activeAccessToken && this.joinRef) {
        this.send({
          topic: 'realtime:public-spatial-snapshot',
          event: 'access_token',
          payload: { access_token: token },
          ref: this.nextRef(),
          join_ref: this.joinRef,
        });
        this.activeAccessToken = token;
      }
    } catch (error) {
      this.handlers.onError?.(error);
      // Keep the socket heartbeat alive; a transient auth refresh failure should
      // be surfaced but must not silently stop server-side connection liveness.
    }
    if (this.connected && this.socket === socket && socket.readyState === WebSocket.OPEN) {
      this.send({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: this.nextRef() });
    }
  }

  private scheduleReconnect(): void {
    if (!this.running || this.reconnectTimer !== null) return;
    const delays = [1_000, 2_000, 5_000, 10_000];
    const delay = delays[Math.min(this.retryIndex, delays.length - 1)]!;
    this.retryIndex += 1;
    this.reconnectTimer = globalThis.setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch(error => {
        this.handlers.onError?.(error);
        this.scheduleReconnect();
      });
    }, delay);
  }

  private send(message: Record<string, unknown>): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private nextRef(): string {
    this.ref += 1;
    return String(this.ref);
  }
}
