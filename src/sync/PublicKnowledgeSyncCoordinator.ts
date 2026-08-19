export const DEFAULT_PUBLIC_KNOWLEDGE_SYNC_INTERVAL_MS = 10_000;

export interface PublicKnowledgeSyncCoordinatorOptions {
  intervalMs?: number;
  onError?: (error: unknown, reason: string) => void;
  windowRef?: Window | null;
  documentRef?: Document | null;
}

/**
 * Owns ongoing convergence of an already-open browser with the authoritative
 * public event stream. The coordinator never stores public knowledge itself;
 * it only asks the supplied server pull to reconcile the in-memory projection.
 */
export class PublicKnowledgeSyncCoordinator {
  private readonly intervalMs: number;
  private readonly onError: (error: unknown, reason: string) => void;
  private readonly windowRef: Window | null;
  private readonly documentRef: Document | null;
  private timer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private running = false;
  private inFlight = false;
  private rerunRequested = false;

  constructor(
    private readonly sync: () => Promise<void>,
    options: PublicKnowledgeSyncCoordinatorOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? DEFAULT_PUBLIC_KNOWLEDGE_SYNC_INTERVAL_MS;
    this.onError = options.onError ?? (() => undefined);
    this.windowRef = options.windowRef === undefined
      ? (typeof window === 'undefined' ? null : window)
      : options.windowRef;
    this.documentRef = options.documentRef === undefined
      ? (typeof document === 'undefined' ? null : document)
      : options.documentRef;
    if (!Number.isFinite(this.intervalMs) || this.intervalMs < 1) throw new Error('public sync interval must be positive');
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.windowRef?.addEventListener('online', this.handleOnline);
    this.windowRef?.addEventListener('knowledge-ball:verdict-finalized', this.handleServerSignal);
    this.documentRef?.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.scheduleNext();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timer !== null) globalThis.clearTimeout(this.timer);
    this.timer = null;
    this.windowRef?.removeEventListener('online', this.handleOnline);
    this.windowRef?.removeEventListener('knowledge-ball:verdict-finalized', this.handleServerSignal);
    this.documentRef?.removeEventListener('visibilitychange', this.handleVisibilityChange);
  }

  requestSync(reason = 'manual'): void {
    if (!this.running) return;
    if (this.inFlight) {
      this.rerunRequested = true;
      return;
    }
    void this.run(reason);
  }

  private readonly handleOnline = () => this.requestSync('online');
  private readonly handleServerSignal = () => this.requestSync('server-signal');
  private readonly handleVisibilityChange = () => {
    if (this.documentRef?.visibilityState === 'visible') this.requestSync('foreground');
  };

  private scheduleNext(): void {
    if (!this.running || this.timer !== null) return;
    this.timer = globalThis.setTimeout(() => {
      this.timer = null;
      this.requestSync('interval');
      this.scheduleNext();
    }, this.intervalMs);
  }

  private async run(reason: string): Promise<void> {
    this.inFlight = true;
    let nextReason = reason;
    try {
      do {
        this.rerunRequested = false;
        try {
          await this.sync();
        } catch (error) {
          this.onError(error, nextReason);
        }
        nextReason = 'coalesced';
      } while (this.running && this.rerunRequested);
    } finally {
      this.inFlight = false;
    }
  }
}
