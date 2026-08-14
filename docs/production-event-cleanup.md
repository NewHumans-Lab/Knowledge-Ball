# Production E2E event cleanup runbook

## Affected range

The failed production browser run appended public event sequences **287–338**.
These rows are part of the append-only audit log and must not be updated or
deleted in place.

## Safe procedure

1. Freeze automated production E2E writes while auditing the range.
2. Export `sequence`, `event_id`, `actor_id`, `created_at`, and the complete
   `envelope` for 287–338, then store a SHA-256 digest of the ordered export.
3. Confirm that every event belongs to the failed E2E actor/run. Stop if the
   range contains an unrelated actor or a referenced non-E2E node.
4. Do **not** issue `DELETE`, `UPDATE`, truncate, reset the identity sequence,
   or rewrite an event envelope.
5. Add a protocol-level retraction/moderation event before hiding this data.
   Its payload must name every affected `event_id`, the audit digest, actor,
   reason, and replacement/retraction decision. Projections can then rebuild by
   excluding the named events while the source log remains intact.
6. Verify replay from sequence zero, cross-client refresh, references, and the
   stream head before promoting the compensating event.

Audit query (read only):

```sql
select sequence, event_id, actor_id, created_at, envelope
from public.public_knowledge_events
where sequence between 287 and 338
order by sequence;
```

Until the canonical retraction event is implemented and reviewed, preserving
the polluted rows is safer than an ad-hoc cleanup that breaks append-only
history, references, cursors, or event-id idempotency.
