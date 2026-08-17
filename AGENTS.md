# Knowledge Ball — Agent Engineering Rules

This file is the repository-wide operating contract for Codex, ChatGPT, coding agents, and automated contributors.

Read it before changing code. The longer rationale and examples live in `docs/engineering-handbook.md`.

## 1. Work only within the requested authorization

- If the task is analysis, audit, explanation, or diagnosis only, do not modify the repository.
- If the task explicitly asks for code changes, use a focused branch and PR.
- Never write directly to `main` for ordinary feature or bug-fix work.
- Never merge a PR unless the maintainer explicitly asks for the merge.
- If the maintainer explicitly asks to “create / submit / make a PR”, create a **formal Ready-for-review PR by default**, not a Draft PR.
- Draft PRs are reserved for agent-owned experiments/diagnostics or when the maintainer explicitly asks for a draft.
- Do not enable auto-merge unless explicitly requested.

Before starting a new write, verify the current `main` and relevant PR state. If an earlier PR has already merged, branch from the latest `main`; do not keep extending a merged PR for a new scope.

## 2. Default platform scope is Web

Unless the task explicitly says otherwise:

- treat the Web application as the active development target;
- do not modify `android/`;
- do not modify `ios/`;
- do not use a Web bug as an excuse to refactor native wrappers;
- do not bundle unrelated cleanup, dependency upgrades, formatting churn, or visual redesign.

Shared Web code may still be exercised by Android/iOS CI. A native build failure caused by a shared Web change may be fixed at the shared cause without editing native source unless native work was explicitly authorized.

## 3. Use Root Cause Analysis + First Principles + Scientific Method

For non-trivial defects:

1. observe the real failure;
2. classify the failing layer;
3. state a falsifiable hypothesis;
4. isolate one variable when practical;
5. measure the result;
6. identify the first incorrect responsibility, transition, or invariant;
7. ask whether that layer/path should exist at all;
8. implement the shortest correct target chain;
9. add a regression test that proves the root cause cannot silently return.

Classify defects as one or more of:

- local implementation bug;
- execution-chain bug;
- state-ownership bug;
- lifecycle/resource-management bug;
- architecture/design bug.

A local bug gets the smallest correct local fix. Ownership/lifecycle/architecture bugs require fixing the wrong boundary rather than stacking another workaround.

If the same symptom has already received several attempted fixes, stop adding patches and re-evaluate the execution chain and ownership model.

## 4. One user action must have a finite, explainable effect

For interaction bugs, count events before guessing about performance.

A user action should produce a finite and predictable set of domain/state changes. Example:

```text
1 touch
→ 1 node selection
→ 1 panel open
→ at most the intended domain event(s)
```

If one touch produces tens, hundreds, or thousands of repeated appends, renders, subscriptions, or commands, treat that as a feedback-loop/ownership defect first.

Useful counters include:

- `pointerdown` / `pointerup`;
- intent handler calls;
- panel open calls;
- command invocations;
- `EventStore.append` calls by event type;
- subscriber callbacks;
- render/rebuild counts.

Rule of thumb: **count events before timing; find feedback loops before micro-optimizing.**

## 5. Do not use DOM mutation as durable business truth

Prefer explicit semantic signals such as:

```text
onNodeTap(nodeId)
→ openNode(nodeId)
→ command/event
→ projection
→ render
```

Do not infer durable business facts from incidental DOM mutations when the application already knows the semantic event.

### MutationObserver rules

- Never observe a subtree that the observer callback also mutates unless the feedback is deliberately bounded and proven safe.
- Do not use `MutationObserver` as a substitute for explicit application events/state ownership.
- If an observer is unavoidable, observe the narrowest non-self-mutating signal.
- A DOM write of the same visible text may still replace child nodes and trigger `childList` mutations; do not assume “same text” means “no mutation”.

## 6. One owner per important state or lifecycle

Each important resource/state must have one clear owner.

- Input/pointer code owns interpretation of touch/pointer intent.
- Panel/modal code owns presentation and local UI state.
- `KnowledgeScene` owns Three.js renderer/canvas, scene resources, animation scheduling, and scene pause/resume/dispose.
- Domain/protocol code owns semantic validity and versioned knowledge rules.
- Event/projection code owns durable domain transitions and deterministic derived state.
- Persistence owns local persistence.
- Sync owns remote synchronization/convergence.
- Auth/account code owns identity/session/account presentation.
- Database functions/migrations own transactional server invariants that cannot safely be enforced by browser code alone.

Do not let two modules independently start/stop, create/destroy, or mutate the same lifecycle without a documented coordinator.

## 7. Separate suspend/resume from destroy/recreate

Long-lived resources should follow an explicit lifecycle:

```text
CREATE → RUNNING ↔ SUSPENDED → DESTROYED
```

Routine UI transitions should normally use `RUNNING ↔ SUSPENDED`.

For WebGL specifically, ordinary panel/modal/account/settings interactions must not:

- call `renderer.forceContextLoss()` / `forceContextRestore()`;
- remove/re-append the renderer canvas;
- dispose/recreate the renderer merely to pause background work.

Context loss/recovery is exceptional browser/GPU behavior or diagnostic tooling. Renderer disposal belongs to actual scene destruction.

## 8. Preserve product and protocol invariants

`ORIGINAL_DESIGN_V1` is a frozen semantic policy version.

- Do not silently change V1 semantics for a new product requirement.
- Existing V1 events must remain replayable under the same meaning.
- Semantic changes should use a new versioned policy/design unless explicitly identified as a backward-compatible implementation bug fix.
- Do not duplicate canonical protocol constants into UI code if a domain/database policy already owns them.

Current Knowledge Ball model constraints that must not be casually violated:

- public knowledge and private personal mastery/state are separate concerns;
- durable knowledge/history is event-driven and replayable;
- a published knowledge node is not silently edited in place: an edit/replacement creates a new knowledge node and the older node remains historical (for example superseded/falsified/rejected) rather than being rewritten away;
- history may be hidden by default in UI, but it is not equivalent to deleting the underlying record.

## 9. Identity references use immutable IDs

Durable ownership/authorship/account references must point to the stable `user_id`/UUID, never to username text.

Presentation resolves:

```text
user_id → current profile → username / display name / avatar
```

A username may change. The durable identity reference must not.

Do not store a username as the authoritative ownership key merely because it is what the UI displays.

## 10. Reuse existing data models before adding schema

Before adding a table, column, event type, account model, or persistence path:

1. search for the existing canonical data path;
2. confirm whether the needed data already exists but is not propagated;
3. extend/reuse the existing model when coherent;
4. add new schema only when the existing model cannot represent the requirement correctly.

Do not create a second account, energy, vote, identity, or knowledge-state model as a shortcut.

## 11. Database and energy changes must be atomic and permission-safe

For Supabase/Postgres changes:

- browser code must not be trusted to enforce conservation, uniqueness, idempotency, or multi-table atomicity;
- multi-step business operations that must succeed/fail together belong in one database transaction/RPC;
- migrations must include relevant constraints, indexes, RLS/privilege changes, and idempotency/concurrency guards where needed;
- `SECURITY DEFINER` functions must use an explicit safe `search_path` and minimal executable privileges;
- never expose service-role credentials to browser/Vite public variables;
- never grant browser roles direct mutation rights to protected ledger/internal tables unless the architecture explicitly requires it.

Repository migration and hosted deployment are separate states. Do not claim a database-backed feature is live until the required migration is actually applied to the hosted project and verified.

Do not apply a production migration unless the task explicitly authorizes deployment or the maintainer directly asks for it.

## 12. Performance rules for large graphs

Before adding work to high-frequency paths, identify both complexity and frequency.

High-frequency paths include taps, animation frames, physics/layout ticks, label updates, edge updates, panel opens, and submit flows.

Avoid:

- unbounded full-graph rebuilds on ordinary taps;
- one `setInterval` / `setTimeout` per node;
- repeated material/object allocation per frame;
- large transparent-mesh overdraw when a cheaper GPU/shared-clock effect can express the same visual state;
- hidden background work continuing at full cost behind overlays.

Prefer:

- explicit shared clocks/uniforms for repeated animation;
- batching/instancing where appropriate;
- incremental/indexed/cached updates;
- LOD/culling for distant or low-priority visuals;
- GPU work for massively parallel visual-only effects when it reduces main-thread churn.

Changing animation frequency does not automatically multiply computation if the same shared per-frame time function is used; object count, draw calls, overdraw, DOM work, and per-object CPU mutation are often the real bottlenecks.

## 13. UI acceptance must test the real visible behavior

Static source assertions are not enough for interaction/UI defects.

For mobile-Web UI changes, test when practical that the control is actually:

- visible;
- inside the intended viewport;
- not hidden behind a higher z-index layer;
- large enough to tap (normally at least 44×44 CSS px for primary mobile controls);
- clickable/tappable;
- wired to the correct navigation/state transition.

A test that only proves “the source contains `❌`” does not prove that a user can see or tap it.

For Android Chrome/WebView/GPU-specific defects, desktop mobile emulation is useful but not equivalent to real-device verification. Report the distinction truthfully.

## 14. Validate the smallest thing first, then the full affected path

During iteration run the narrowest useful regression. Before declaring the task complete, run the appropriate repository checks.

Typical Web sequence:

1. TypeScript / `npm run build`;
2. focused unit/regression test;
3. `npm test` for shared behavior;
4. Pages/build checks when deployment structure can be affected;
5. Playwright/mobile browser checks for interaction changes;
6. relevant architecture/auth/persistence/sync/database guards;
7. merge preflight where available.

Never claim a check passed if it was not executed successfully.

## 15. Inspect the diff before opening the PR

Before creating a PR, verify:

- changed file list;
- additions/deletions;
- unexpected native files;
- unexpected database/protocol files;
- accidental large rewrites or file truncation;
- generated/binary artifacts that were not requested;
- branch is based on the intended current `main`.

A small intended edit that suddenly rewrites or shrinks a large app entry file is a stop signal. Investigate before opening the PR.

## 16. PR reporting must be truthful and causal

A non-trivial PR should clearly state:

- root cause / design reason;
- before chain;
- after chain;
- why the change fixes the responsible mechanism;
- scope intentionally not changed;
- validation actually executed;
- hosted migration/deployment state when relevant;
- real-device status when relevant;
- residual risk.

Do not call a mitigation a root-cause fix. Do not call an unmerged branch deployed. Do not call desktop emulation a real Android test.

## 17. Completion and merge policy

The coding task is complete when the requested implementation is in a focused formal PR with truthful validation and remaining risks stated.

The coding task is **not** permission to merge.

Merge only after an explicit maintainer instruction, and re-check the live PR head/checks before merging.