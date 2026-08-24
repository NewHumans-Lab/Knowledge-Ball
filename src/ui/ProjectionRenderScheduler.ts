export type ProjectionRenderFlush = () => void;
export type ProjectionRenderSchedule = (flush: () => void) => void;

/**
 * Coalesces a synchronous burst of authoritative events into one expensive
 * projection-to-layout/render refresh. Domain projection remains event-by-event;
 * only the derived 3D view is deferred to the microtask boundary.
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
