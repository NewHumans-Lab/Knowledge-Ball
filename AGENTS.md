# Knowledge Ball — Agent Engineering Rules v3

This file is the repository-wide operating contract for Codex, ChatGPT, coding agents, and automated contributors.

**Version 3 priority order:** establish facts → map the causal chain → identify the authoritative owner → reconstruct history when needed → implement the smallest coherent fix → attack it with counterexamples → validate the real affected environment → inspect the diff → open a truthful PR.

Read this file before changing code. The longer rationale and examples live in `docs/engineering-handbook.md`.

---

## 1. Work only within the requested authorization

- If the task is analysis, audit, explanation, or diagnosis only, do not modify the repository.
- If the task explicitly asks for code changes, use a focused branch and PR.
- Never write directly to `main` for ordinary feature or bug-fix work.
- Never merge a PR unless the maintainer explicitly asks for the merge.
- If the maintainer explicitly asks to “create / submit / make a PR”, create a **formal Ready-for-review PR by default**, not a Draft PR.
- Draft PRs are reserved for agent-owned experiments/diagnostics or when the maintainer explicitly asks for a draft.
- Do not enable auto-merge unless explicitly requested.

Before starting a new write, verify the current `main` SHA and relevant PR state. If an earlier PR has already merged, branch from the latest `main`; do not keep extending a merged PR for a new scope.

Do not interpret permission to fix one subsystem as permission to redesign adjacent systems.

### Requirement precedence and supersession

- The maintainer's latest explicit requirement overrides earlier requirements only where they actually conflict.
- Supersession is local, not global: requirements that do not conflict with the new instruction remain in force and must not be casually changed.
- Do not restore an older product behavior merely because it appears in Git history, an old issue, an obsolete requirements document, or remembered chat context.
- Current code/tests describe implemented behavior; they do not outrank a newer explicit maintainer product requirement when the two conflict.
- Versioned historical protocol documents may remain authoritative for replaying their own historical version, but they are not instructions to reintroduce superseded current-product behavior.
- If two sources conflict and recency/authority is genuinely unclear, surface the conflict before coding instead of choosing whichever document is easiest to find.
- For every focused change, preserve adjacent non-conflicting invariants and include regression coverage for any invariant that has repeatedly regressed.
- Remove obsolete unversioned requirement documents once they have been superseded, rather than leaving them as plausible agent instructions.

## 2. Default platform scope is Web

Unless the task explicitly says otherwise:

- treat the Web application as the active development target;
- do not modify `android/`;
- do not modify `ios/`;
- do not use a Web bug as an excuse to refactor native wrappers;
- do not bundle unrelated cleanup, dependency upgrades, formatting churn, or visual redesign.

Shared Web code may still be exercised by Android/iOS CI. A native build failure caused by shared Web code may be fixed at the shared cause without editing native source unless native work was explicitly authorized.

## 3. Establish the evidence hierarchy before proposing a fix

Do not treat remembered repository state, old chat context, or code intuition as current fact.

For any non-trivial task, distinguish these evidence layers:

1. **repository truth** — current `main`, branch, source, migrations, tests;
2. **hosted database truth** — actually applied migrations, tables, RPCs, ACLs, rows, production data;
3. **CI truth** — the exact HEAD, workflow, job, and step that ran;
4. **browser-emulated truth** — Playwright/Chromium behavior under a controlled viewport;
5. **real-device truth** — actual Android/iOS/browser/GPU behavior reported or observed on hardware.

These layers are not interchangeable.

Examples:

- committed migration ≠ deployed migration;
- branch code ≠ deployed production code;
- source containing a blue hex value ≠ the user actually seeing a blue node;
- mobile emulation ≠ a real Android GPU/driver test;
- a previous green run ≠ the current HEAD is green.

When a task depends on production state, inspect production state. When a task depends on a specific CI failure, inspect that run/job/log. If a layer cannot be verified, state that explicitly instead of guessing.

## 4. Use Root Cause Analysis + First Principles + Scientific Method

For non-trivial defects:

1. observe the real failure;
2. classify the failing layer;
3. write the current end-to-end chain;
4. state a falsifiable hypothesis;
5. isolate one variable when practical;
6. measure the result;
7. identify the **first incorrect responsibility, transition, invariant, or ownership boundary**;
8. ask whether that path should exist at all;
9. write the desired target chain;
10. implement the shortest coherent change from the wrong chain to the correct chain;
11. add regression evidence that proves the responsible mechanism cannot silently return.

Classify defects as one or more of:

- local implementation bug;
- execution-chain bug;
- state-ownership bug;
- lifecycle/resource-management bug;
- concurrency/idempotency bug;
- protocol/economic bug;
- architecture/design bug.

A local bug gets the smallest correct local fix. Ownership, lifecycle, concurrency, protocol, or architecture bugs require fixing the wrong boundary rather than stacking another workaround.

If the same symptom has already received several attempted fixes, stop adding patches and re-evaluate the chain and ownership model.

## 5. Always map the complete causal chain

For important behavior, do not inspect only the visible UI method. Follow the operation through all relevant layers.

A typical public knowledge operation may be:

```text
user action
→ UI intent
→ command
→ domain event
→ local projection
→ persistence
→ sync adapter
→ database RPC / authoritative transaction
→ public event stream
→ remote client pull
→ projection
→ visible UI
```

A vote may be:

```text
button tap
→ authenticated RPC
→ lock
→ validate round
→ debit stake
→ record ballot
→ compute threshold/timeout
→ atomic settlement
→ server verdict event
→ sync
→ graph projection
→ node becomes verified or historical/hidden
```

Find the first step where actual behavior differs from intended behavior. Do not patch only the final symptom if the wrong state was created earlier.

## 6. One user action must have a finite, explainable effect

For interaction bugs, **count events before guessing about performance**.

A user action should produce a finite and predictable set of domain/state changes. Example:

```text
1 touch
→ 1 node selection
→ 1 panel open
→ at most the intended domain event(s)
```

If one touch produces tens, hundreds, or thousands of repeated appends, renders, subscriptions, or commands, treat that as a feedback-loop/ownership defect first.

Useful counters include:

- pointer/touch events;
- intent handler calls;
- panel open calls;
- command invocations;
- `EventStore.append` calls by event type;
- subscriber callbacks;
- projection rebuilds;
- network requests;
- render/rebuild counts.

Explicitly look for loops such as:

```text
event
→ subscriber
→ render
→ DOM mutation
→ observer
→ command/event
→ subscriber
→ ...
```

Rule of thumb: **count events before timing; find feedback loops before micro-optimizing.**

## 7. Do not use DOM presentation as durable business truth

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

## 8. One authoritative owner per important state or lifecycle

Each important resource/state must have one clear owner.

- Input/pointer code owns interpretation of touch/pointer intent.
- Panel/modal code owns presentation and local UI state.
- `KnowledgeScene` owns Three.js renderer/canvas, scene resources, animation scheduling, and scene pause/resume/dispose.
- Domain/protocol code owns semantic validity and versioned knowledge rules.
- Event/projection code owns deterministic derived graph state.
- Persistence owns local persisted event state.
- Sync owns remote synchronization/convergence.
- Auth/account code owns identity/session/account presentation.
- Database functions/migrations own transactional server invariants that cannot safely be enforced by browser code alone.

For public shared facts, ask explicitly: **who is authoritative?**

Examples that must not be decided by browser presentation code:

- final vote verdict;
- conserved energy balances;
- authoritative global vote totals;
- unique account/identity constraints;
- one-time settlement/idempotency outcomes.

Clients may request, cache, project, and display those results. They must not forge them.

Do not let two modules independently start/stop, create/destroy, finalize, or mutate the same lifecycle without a documented coordinator.

## 9. Separate suspend/resume from destroy/recreate

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

## 10. Preserve protocol invariants and use one semantic source of truth

`ORIGINAL_DESIGN_V1` is a frozen semantic policy version.

When a protocol/design already exists, inspect in this order:

```text
design document
→ executable policy/interpreter
→ contract tests
→ database implementation
→ projection
→ UI
```

The executable policy is the semantic source of truth. Database code implements it transactionally. Projection derives displayable state. UI presents it.

Do not silently create a second policy in UI, SQL, or tests.

- Do not silently change V1 semantics for a new product requirement.
- Existing V1 events must remain replayable under the same meaning.
- Semantic changes should use a new versioned policy/design unless explicitly identified as a backward-compatible implementation bug fix.
- Do not duplicate canonical protocol constants into UI code if a domain/database policy already owns them.

Current Knowledge Ball model constraints that must not be casually violated:

- public knowledge and private personal mastery/state are separate concerns;
- durable knowledge/history is event-driven and replayable;
- a published knowledge node is not silently edited in place: a semantic edit/replacement creates a new knowledge node/version and the older node remains historical;
- history may be hidden by default in UI, but it is not equivalent to deleting the underlying record;
- `superseded`, `falsified`, and `rejected` are distinct meanings and must not be collapsed into a generic trash state.

## 11. Historical repair must reconstruct the timeline, not reinterpret aggregates

This is a hard rule for migrations, voting, settlements, balances, histories, and protocol repair.

**Do not use today’s aggregate state to guess what should have happened in the past.**

Reconstruct the relevant historical inputs:

- creation/open time;
- policy version;
- user/eligibility snapshot at that time;
- snapshotted threshold;
- ordered actions by authoritative timestamp plus deterministic tie-breaker;
- which action first crossed a threshold;
- whether later actions should ever have been accepted;
- what funds were actually charged at the time.

Example:

```text
current aggregate: AGREE 1 / DISAGREE 1
historical threshold: 1
ordered ballots: DISAGREE first, AGREE later
```

That is **not** a tie. The first ballot should already have closed the round.

If an old system bug accepted actions after the state should have closed, preserve those rows as audit history but do not silently make them valid retroactively. Prefer an explicit `late` / `void` / compatibility interpretation and repair any user funds accordingly.

### Historical user-harm rule

When repairing a past implementation defect:

- do not retroactively charge a user for a stake/fee the old system never charged;
- do not make a user lose assets because the old system accepted an action that should have been rejected;
- preserve audit evidence rather than deleting inconvenient historical rows;
- make the smallest forward repair that restores protocol meaning and accounting consistency.

The goal is to repair the system bug, not transfer the cost of that bug to users.

## 12. Identity references use immutable IDs

Durable ownership/authorship/account references must point to stable `user_id`/UUID identity, never username text.

Presentation resolves:

```text
user_id → current profile → username / display name / avatar
```

A username may change. The durable identity reference must not.

Do not store a username as the authoritative ownership key merely because it is what the UI displays.

## 13. Reuse existing models before adding schema or state paths

Before adding a table, column, event type, account model, timer, cache, or persistence path:

1. search for the existing canonical data path;
2. confirm whether the needed data already exists but is not propagated;
3. extend/reuse the existing model when coherent;
4. add new state/schema only when the existing model cannot represent the requirement correctly.

Do not create a second account, energy, vote, identity, verdict, or knowledge-state model as a shortcut.

## 14. Database operations must be atomic, concurrent-safe, idempotent, and permission-safe

For Supabase/Postgres changes:

- browser code must not be trusted to enforce conservation, uniqueness, final verdicts, idempotency, or multi-table atomicity;
- business operations that must succeed/fail together belong in one transaction/RPC;
- validate invariants before committing authoritative state;
- migrations must include relevant constraints, indexes, RLS/privilege changes, and concurrency guards;
- `SECURITY DEFINER` functions must use an explicit safe `search_path` and minimal executable privileges;
- never expose service-role credentials to browser/Vite public variables;
- never grant browser roles direct mutation rights to protected ledger/internal tables unless the architecture explicitly requires it.

For critical concurrent operations, actively test/inspect cases such as:

- two users submit the final vote simultaneously;
- RPC succeeds but client times out and retries;
- same idempotency key is reused with different parameters;
- two opposite transfers lock accounts in different orders;
- finalization is called twice;
- a settlement event already exists;
- an operation fails after some apparent local UI state changed.

Use deterministic lock ordering, row/advisory locks, unique constraints, idempotency keys, and transaction boundaries where appropriate.

A safe critical chain should look like:

```text
lock
→ validate
→ write all authoritative records
→ settle accounting
→ append authoritative event
→ assert invariants
→ COMMIT
```

not several loosely coupled browser requests.

### Migration immutability and production drift

- Once a migration has been applied to a hosted environment, do not rewrite that historical migration to change production behavior. Add a new forward migration.
- If a migration has **not** been applied anywhere and exists only on an unmerged branch, cleanly consolidate intermediate experimental migrations before formalizing the PR when doing so improves maintainability.
- Any production DDL/hotfix must be represented in the repository by a migration so Git history and hosted schema do not drift apart.
- Destructive or irreversible migrations require explicit maintainer approval and a stated backup/rollback/recovery plan before production execution.
- Verify hosted schema/RPC/table/ACL/data after applying a migration; do not assume SQL succeeded merely because it was committed.

Repository migration and hosted deployment are separate states. Do not claim a database-backed feature is live until the required migration is actually applied to the hosted project and verified.

Do not apply a production migration unless the task explicitly authorizes deployment or the maintainer directly asks for it.

### Secrets and privacy

- Never commit or paste service-role keys, JWTs, SMS-provider secrets, private API keys, recovery credentials, or other production secrets into source, fixtures, PR descriptions, issues, or logs.
- Do not log full auth tokens or sensitive personal data merely for debugging.
- Use redacted/synthetic values in tests and examples.
- Minimize identity/contact data exposure to the layers that actually need it.

## 15. Treat economic logic as explicit value flows, not just arithmetic

For any stake/reward/energy feature, draw the value flow before implementing it.

Answer explicitly:

- who pays;
- who temporarily holds value;
- who can win;
- who can lose;
- when value is locked;
- when it is returned;
- where rewards originate;
- what happens on timeout/tie/cancel/invalid historical action;
- how the ledger remains balanced.

**Global conservation does not prove the business logic is correct.** Two incorrect economic channels can still sum to zero.

If the design contains separate economic relationships, keep them separate in settlement.

Example:

```text
ordinary voter pool
≠
creator ↔ system wager
```

Do not contaminate ordinary voter reward ratios by silently adding the system or creator as an ordinary ballot position unless the protocol explicitly says so.

Every ledger transaction should be independently auditable and balanced, and the materialized balances must match ledger history.

## 16. Performance rules for large graphs

Before adding work to high-frequency paths, identify both **complexity and frequency**.

High-frequency paths include taps, animation frames, physics/layout ticks, label updates, edge updates, panel opens, submit flows, sync polling, and visual state updates.

Avoid:

- unbounded full-graph rebuilds on ordinary taps;
- one `setInterval` / `setTimeout` / network poll per node;
- repeated material/object allocation per frame;
- large transparent-mesh overdraw when a cheaper shared/GPU effect can express the same visual state;
- hidden background work continuing at full cost behind overlays;
- polling all nodes when only the currently open node needs fresh detail.

Prefer:

- shared clocks/uniforms for repeated animation;
- one bounded global/background sync cadence instead of N node timers;
- batching/instancing where appropriate;
- incremental/indexed/cached updates;
- LOD/culling for distant or low-priority visuals;
- dirty rendering;
- GPU work for massively parallel visual-only effects when it reduces main-thread churn.

Changing animation frequency does not automatically multiply computation if the same shared per-frame time function is used; object count, draw calls, overdraw, DOM work, networking, and per-object CPU mutation are often the real bottlenecks.

### Motion and flashing safety

- Attention-grabbing animation must not rely on dangerous high-frequency flashing.
- Keep flashing well below accessibility risk thresholds; never introduce rapid full-contrast flashing merely to make a state more noticeable.
- Respect `prefers-reduced-motion` where practical.
- Motion must carry meaning without becoming the only way a user can discover critical information.

## 17. Real visual acceptance must evaluate final compositing

For visual work, source tokens are not the final product.

The user sees the result of:

```text
background
× geometry
× base semantic color
× material/shading
× opacity/depth
× lighting
× glow/sprites
× labels/overlays
× renderer antialias/DPR
× viewport/GPU
```

If the requirement says “the sphere is blue,” verify that the final rendered sphere still reads as blue. A correct hex constant can become muddy/dark/green after transparency, lighting, glow, or background compositing.

For semantic node colors, presentation effects should not destroy semantic meaning. Prefer:

- opaque semantic body color;
- bounded neutral shading for 3D depth;
- separate glow/highlight layers;
- background occlusion by the body;
- explicit brightness floors where semantic color must remain legible.

For mobile-Web visual changes, use real browser screenshots when practical (for example 390×844 Chromium/WebGL), combine automated pixel/brightness checks with **human inspection**, and keep the automated metric aligned with actual perception.

If a visual regression test conflicts with a deliberately changed correct design, determine whether the test encodes an obsolete invariant. Do not preserve a wrong design merely to keep an old test green; replace the obsolete test with one that verifies the new invariant.

## 18. UI acceptance must test actual visible/tappable behavior

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

## 19. Attack the proposed fix with counterexamples before declaring success

Do not only prove the happy path. Try to break the design.

For relevant tasks, ask at least:

- What if two users act simultaneously?
- What if the user double taps or retries?
- What if the response is lost after the server committed?
- What if the browser refreshes or restarts?
- What if the client is offline, then reconnects?
- What if the server already finalized but the client has stale local state?
- What if historical data is in a state the correct system should never have produced?
- What if both aggregates now exceed a historical threshold?
- Which side crossed the threshold first?
- What if an action arrived after the state should already have closed?
- What if the balance is exactly at the `-10` floor?
- What if a migration/RPC is invoked twice?
- What if two locks can be acquired in opposite order?
- What if the selected node is outside a mobile LOD limit?
- What if a visual layer is hidden by another layer even though its source value is correct?

If a plausible counterexample breaks the intended invariant, continue the fix.

## 20. Validate the smallest thing first, then the full affected path

During iteration, run the narrowest useful regression. Before declaring the task complete, run the appropriate full checks.

Typical sequence:

1. TypeScript compile / `npm run build`;
2. focused unit/regression test;
3. protocol/domain tests;
4. migration/architecture guards when relevant;
5. `npm test` for shared behavior;
6. Pages/deployment-structure checks;
7. real mobile browser E2E for interaction/visual changes;
8. Issue #51 production-scale touch/performance regression when scene/mobile interaction can be affected;
9. persistence/sync/auth/security checks for those paths;
10. Android compatibility build;
11. iOS compatibility build;
12. merge preflight;
13. hosted Supabase migration + hosted verification when deployment is authorized and required.

For database-backed changes, hosted verification should inspect the actual properties that matter, such as:

- schema version;
- tables/columns/constraints;
- function definitions/signatures;
- RLS and grants;
- real row migration/backfill results;
- historical repair outcomes;
- event stream output;
- energy conservation/materialized balance invariants.

Never claim a check passed if it was not executed successfully.

Do not substitute a current-state explanation for a requested test, and do not call repository CI “production verified.”

## 21. Interpret test failures causally

A red check is evidence, not automatically evidence that product code is wrong.

Classify the failure:

- compile/type error;
- deterministic regression assertion;
- product runtime failure;
- migration/permission failure;
- real visual mismatch;
- performance regression;
- CI infrastructure/environment failure (runner download, dependency install, transient navigation timeout, etc.).

Use logs and reproduction to distinguish them.

Do not weaken a valid product assertion merely to turn CI green. Conversely, do not change product code to compensate for a clearly isolated runner/infrastructure failure without evidence that the product is responsible.

If a rerun of the exact same HEAD passes after a runner-only failure, report that accurately and consider improving test robustness only if the flake is recurring.

## 22. Inspect the diff before opening the PR

Before creating a PR, verify:

- changed file list;
- additions/deletions;
- branch base/current `main` relationship;
- unexpected native files;
- unexpected database/protocol files;
- accidental dependency or lockfile updates;
- accidental large rewrites or file truncation;
- generated/binary artifacts that were not requested;
- temporary experiment files.

A small intended edit that suddenly rewrites or shrinks a large app entry file is a stop signal. Investigate before opening the PR.

### Diagnostic code hygiene

Temporary diagnosis mechanisms must not silently ship as product behavior.

Before opening a formal PR, remove temporary:

- runtime CSS deletion/injection used only to isolate a selector;
- monkeypatches that bypass real EventStore/database/render behavior;
- artificial event interception that changes projection state;
- debug timers/counters/log spam that are not intentional diagnostics;
- test-only bypasses inserted into runtime code;
- temporary branches/files created only to inspect one hypothesis.

Keep a diagnostic only if it has been deliberately converted into a supported debug facility or regression test and is safe for production.

## 23. PR reporting must be truthful, causal, and scoped

A non-trivial PR should clearly state:

- root cause / design gap;
- important evidence;
- before chain;
- after chain;
- authoritative owner after the fix;
- important invariants;
- historical-data handling, if any;
- concurrency/idempotency/security behavior, if any;
- economic flow, if any;
- scope intentionally not changed;
- validation actually executed;
- hosted migration/deployment state when relevant;
- browser-emulation vs real-device status;
- residual risk.

Do not call a mitigation a root-cause fix. Do not call an unmerged branch deployed. Do not call a committed migration applied. Do not call desktop emulation a real Android test.

## 24. Communicate new evidence, not repetitive progress

During long investigations, status updates should be short and evidence-driven.

Useful updates are things like:

- “Root cause is now confirmed: the mobile optimization hides the solid semantic shell.”
- “The current aggregate is misleading; historical vote order shows DISAGREE crossed the threshold first.”
- “The only failing step is Chromium installation; product tests have not run yet.”
- “This settlement model incorrectly mixes creator/system wager with the ordinary voter pool, so I am separating them.”
- “The screenshot is visually correct; the pixel classifier is using an invalid absolute-brightness threshold.”

Avoid repeatedly saying that work is still running without new information.

If earlier reasoning proves wrong, correct it immediately and explain the new evidence.

## 25. Completion means the whole affected system is coherent

“Code written” is not completion.

For the requested scope, completion means the relevant combination of these is true:

- the design/authority boundary is correct;
- the causal chain is correct end-to-end;
- state ownership is unambiguous;
- concurrency/idempotency behavior is safe;
- protocol/economic invariants are preserved;
- historical data is repaired without inventing false history or unfair user loss;
- security/RLS/ACL boundaries are correct;
- performance remains acceptable;
- real UI/visual behavior matches the requirement;
- appropriate automated checks pass;
- hosted state is verified when deployment was part of the task;
- the diff contains only the intended scope;
- the formal PR reports evidence truthfully.

Before final reporting, provide the most relevant concrete identifiers when available:

```text
Root cause / design gap
Implemented fix
Key invariants
Historical-data treatment
Security/concurrency result
Tests and real-environment validation
Hosted deployment verification
PR URL
HEAD SHA
mergeable/check status
merged? yes/no
```

The coding task is **not** permission to merge.

Merge only after an explicit maintainer instruction, and re-check the live PR head/checks immediately before merging.
