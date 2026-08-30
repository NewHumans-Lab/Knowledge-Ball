// Backward-compatible entrypoint. Hosted release validation must remain zero-write:
// do not create anonymous auth users or call authenticated RPCs from CI.
await import('./verify-supabase-release-config.mjs');
