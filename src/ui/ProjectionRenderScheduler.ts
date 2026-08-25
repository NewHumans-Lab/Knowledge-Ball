export type ProjectionRenderFlush = () => void;
export type ProjectionRenderSchedule = (flush: () => void) => void;

/**
 * Coalesces a synchronous burst of authoritative graph events into one
 * expensive projection-to-layout/render refresh. GraphProjection itself stays
 * event-by-event; only the derived view waits until the microtask boundary.
 */
export class ProjectionRenderScheduler {
  private scheduled = false;
  private flushes = 0;

  constructor(
    private readonly flush: ProjectionRenderFlush,
    private readonly schedule: ProjectionRenderSchedule = callback => queueMicrotask(callback),
  ) {}

  request(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    this.schedule(() => {
      if (!this.scheduled) return;
      this.scheduled = false;
      this.flushes += 1;
      this.flush();
    });
  }

  flushNow(): void {
    if (!this.scheduled) return;
    this.scheduled = false;
    this.flushes += 1;
    this.flush();
  }

  isScheduled(): boolean { return this.scheduled; }
  flushCount(): number { return this.flushes; }
}
