export type KnowledgeSurfaceKind = 'none' | 'detail' | 'panel';

export interface KnowledgeSurfaceSnapshot {
  nodeId: string | null;
  surface: KnowledgeSurfaceKind;
}

/**
 * Authoritative app navigation state for knowledge-node surfaces. Controllers may
 * keep private render caches, but app decisions must never be inferred back from
 * DOM classes or controller-local selected ids.
 */
export class KnowledgeSurfaceState {
  private value: KnowledgeSurfaceSnapshot = { nodeId: null, surface: 'none' };

  get nodeId(): string | null {
    return this.value.nodeId;
  }

  get surface(): KnowledgeSurfaceKind {
    return this.value.surface;
  }

  snapshot(): Readonly<KnowledgeSurfaceSnapshot> {
    return this.value;
  }

  open(surface: Exclude<KnowledgeSurfaceKind, 'none'>, nodeId: string): void {
    this.value = { nodeId, surface };
  }

  close(surface: Exclude<KnowledgeSurfaceKind, 'none'>): void {
    if (this.value.surface === surface) this.clear();
  }

  clear(): void {
    this.value = { nodeId: null, surface: 'none' };
  }
}
