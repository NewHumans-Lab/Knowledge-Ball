export interface RemoteFirstBootstrapOptions {
  hosted: boolean;
  hydrateRemote: () => Promise<void>;
  hasKnowledge: () => boolean;
  seedDemo: () => Promise<void>;
}

/**
 * Hosted sessions are remote-authoritative at startup: pull finishes before any
 * initialization decision and demo data is never created or queued there.
 * The demo remains an idempotent local-only fallback for unconfigured builds.
 */
export async function bootstrapRemoteFirst(options: RemoteFirstBootstrapOptions): Promise<{ seeded: boolean }> {
  if (options.hosted) {
    await options.hydrateRemote();
    return { seeded: false };
  }
  if (options.hasKnowledge()) return { seeded: false };
  await options.seedDemo();
  return { seeded: true };
}
