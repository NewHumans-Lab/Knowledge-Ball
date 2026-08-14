# Knowledge-Ball

Knowledge-Ball is a local-first shared knowledge graph. The web production flow is:

`UI command → immutable local event → EventStore → projection/UI → SyncEngine → Supabase Postgres/Auth/RLS → other web clients`

The local event log is authoritative for responsiveness and offline use. Public knowledge events replicate in the background; projections are derived. Personal events such as mastery remain in the browser-local personal event log and are structurally excluded from the public stream.

## Run the web app

```bash
npm install
npm run dev
```

Without Supabase configuration the app starts normally in explicit local-only mode. Local creation, edits, statuses, premises, and mastery survive reload through `localStorage`; remote success is never simulated.

## Supabase setup

1. Create/select a hosted Supabase project and enable anonymous sign-ins under Authentication settings.
2. Apply `supabase/migrations/202608130001_scheme7_event_streams.sql` with the Supabase CLI or SQL editor.
3. Apply the remaining migrations in timestamp order. Enable Supabase anonymous sign-ins; phone authentication and an SMS provider are not used. Anonymous sessions provide a technical `auth.uid()` for RLS, syncing, profiles, voting, and knowledge edits without presenting registration to visitors.
4. Set these browser-safe Vite values (and matching GitHub Actions repository variables for Pages):

```text
VITE_SUPABASE_URL=https://PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

After changing either Pages repository variable, trigger a fresh `Deploy to GitHub Pages` workflow run so Vite rebuilds the static bundle with the new values.

Never expose a service-role key, database password, GitHub PAT, or other privileged secret in Vite variables. The migration enables RLS, authenticated reads, an atomic expected-head append RPC, immutable rows, and an owner-scoped private table reserved for future account-linked personal sync.

## Synchronization and conflicts

`SyncEngine` persists a separate `knowledge-ball.sync-metadata.v1` record containing the remote cursor plus pending, acknowledged, and failed event IDs. Network failures keep pending work queued. Reconnect/startup sync pulls paginated remote events, then flushes pending public events. Expected-head conflicts cause pull/rebase/revalidation/retry; invalidated local work is retained as an explicit conflict report instead of being silently discarded. Event IDs make remote append idempotent, and acknowledged events are not repushed after reload.

Projected node snapshots are not a production persistence model. The former bundled Node JSON server and `/api/knowledge` gateway have been removed; GitHub Pages remains a static frontend and Supabase is the sole production remote event exchange.
