# Knowledge Ball Engineering Handbook

This handbook explains the engineering method behind `AGENTS.md` and records the failure patterns that must not be relearned from scratch.

It is intentionally project-specific. The goal is not maximum process. The goal is to keep Knowledge Ball understandable while the graph, account system, protocol, Supabase backend, and 3D UI grow.

## 1. The engineering method

Use three ideas together:

```text
Root Cause Analysis
→ finds why the system failed

First Principles
→ asks what the system should have been doing at the lowest useful level

Scientific Method
→ proves or disproves the hypothesis with isolated experiments
```

The compact rule is:

> Root-cause analysis finds why it broke. First-principles reasoning defines what it should do. Experiments prove that the replacement is actually correct.

### Local bug versus wrong architecture

Not every problem deserves a redesign.

If the architecture is already correct and the implementation is wrong, use the smallest local fix. Examples:

- `>` should be `>=`;
- wrong selector;
- missing null check;
- wrong API argument;
- one handler accidentally registered twice.

If the failure exists because the ownership or execution chain is wrong, a local patch is usually a delay rather than a solution.

Signals that the boundary itself may be wrong:

- the same symptom has been “fixed” several times;
- one UI action triggers unrelated GPU, persistence, sync, and domain behavior;
- modules perform competing cleanup or lifecycle operations;
- a test passes while the real interaction still freezes;
- one user action causes an event storm;
- an increasingly long list of conditions is needed to keep the system stable.

## 2. Write the current chain before editing a complex interaction

For a non-trivial interaction, write the actual chain as code currently executes it.

Example of a bad historical node-tap chain:

```text
pointerup
→ raycast
→ node selected
→ canvas removed
→ WebGL context forced lost
→ panel opened
→ DOM changes
→ observer runs
→ mastery command
→ EventStore append
→ subscriber rebuilds panel
→ more DOM changes
→ observer runs again
```

Then write the target chain:

```text
pointerup
→ raycast nodeId
→ onNodeTap(nodeId)
→ openNode(nodeId)
→ panel renders
→ one explicit viewed/mastery transition when required
```

The target chain should normally be shorter and easier to explain than the broken chain.

## 3. First count events, then optimize time

Performance bugs are often control-flow bugs wearing a performance disguise.

When a tap freezes the page, add counters before immediately blaming rendering cost.

A useful interaction trace may include:

```text
pointerdown = 1
pointerup = 1
onNodeTap = 1
openNodePanel = 2
NodeMasterySet attempts = 1461
subscriber callbacks = ...
```

The historical mobile freeze became obvious once one real touch was shown to produce more than a thousand attempted mastery events.

That immediately changes the question from:

> Which line is slow?

into:

> Why is one user action recursively producing so many state transitions?

### Event-count invariant

For every important user action, it should be possible to explain the expected finite effect.

Examples:

```text
open node
→ 1 selection
→ 1 panel presentation
→ 0 or 1 auto-view mastery transition

cast vote
→ 1 vote record
→ 1 energy transaction
→ 2 balanced ledger entries
→ 1 refreshed snapshot
```

If reality differs radically, find the feedback loop before micro-optimizing rendering.

## 4. Do not make the DOM the domain model

The DOM is presentation. It is not a reliable substitute for explicit application state.

Bad pattern:

```text
open panel
→ DOM text changes
→ MutationObserver guesses that a node was viewed
→ command writes state
→ subscriber rebuilds panel
→ DOM changes again
```

Better pattern:

```text
openNode(nodeId)
→ panel.open(nodeId)
→ markViewed(nodeId) when policy requires it
```

The app already knows `nodeId`; it should not rediscover that business fact by watching rendered text.

### MutationObserver failure pattern

A particularly dangerous feedback pattern is:

```text
observer watches subtree A
→ callback mutates subtree A
→ mutation queues observer again
→ callback mutates subtree A again
→ microtask starvation
```

Even assigning the same `textContent` can replace child text nodes and create a new `childList` mutation.

If an observer is necessary, narrow it to a signal that the callback does not itself modify.

## 5. State ownership prevents entire classes of bugs

Each state/resource should have one lifecycle owner.

### Input layer

Owns:

- pointer/touch interpretation;
- drag versus tap;
- raycast intent;
- zoom/pinch intent.

It should emit semantic intent, not manage persistence or GPU destruction.

### Panel/modal layer

Owns:

- showing detail/edit/create/negate/decompose/merge views;
- local form state;
- navigation between presentation layers.

It should not destroy the renderer or re-implement domain truth.

### KnowledgeScene

Owns:

- Three.js scene objects;
- renderer and canvas;
- render scheduling;
- physics/layout work owned by the scene;
- pause/resume/dispose.

### Domain/protocol

Owns:

- what a knowledge operation means;
- validity/invariants;
- versioned policy.

### Event/projection

Owns:

- durable state transitions;
- deterministic replay-derived state.

### Persistence and sync

Persistence owns local durability. Sync owns remote transport/convergence. Neither should silently become the source of domain semantics.

### Auth/account/database

Auth owns stable actor identity/session. Database transactions own server-side invariants that the browser cannot safely guarantee, especially energy conservation, uniqueness, idempotency, and concurrent voting.

## 6. Resource lifecycle: pause is not destroy

Long-lived resources need separate lifecycle concepts:

```text
CREATE
→ RUNNING
↔ SUSPENDED
→ DESTROYED
```

A modal or node detail view is normally a suspension concern, not destruction.

### Historical WebGL lesson

Calling:

```text
renderer.forceContextLoss()
renderer.forceContextRestore()
remove canvas
append canvas again
```

for ordinary node-panel interaction was architecturally wrong, even though it initially looked like a way to “pause expensive rendering”.

On Android Chrome/WebView, GPU context loss/recovery also interacts with vendor drivers and browser resource recovery, making it a poor routine lifecycle primitive.

The correct ordinary flow is:

```text
panel opens
→ pause expensive scene work if needed
→ keep context/canvas/resources

panel closes
→ resume existing resources
```

## 7. Product invariants must live below the UI

UI should display product policy; it should not become the canonical policy owner.

Important Knowledge Ball invariants include:

- public knowledge is public; private mastery is separate personal state;
- durable public changes are event-driven/replayable;
- frozen protocol versions preserve historical meaning;
- energy/account invariants are authoritative in database/domain layers;
- published/history records are not silently rewritten into a different meaning.

### Knowledge edit/replacement model

A user “editing” an existing knowledge node does not mean mutating the old public record in place.

Conceptually:

```text
Node A
creator = user_1
status = current

user_2 proposes an improved formulation

Node B
creator = user_2
status = pending
replaces / derives from A

if B wins
A → historical/superseded
B → current
```

The old node remains the old contributor's historical node. It is not retroactively reassigned to the new author.

Historical states such as `superseded`, `falsified`, and `rejected` may all be hidden from the default graph view, but they are not identical concepts and should not be flattened into physical deletion.

## 8. Identity: immutable reference, mutable presentation

Durable identity references use the stable account UUID/user ID.

```text
knowledge node / event / ownership
→ creator_user_id / actor_id
→ stable UUID

UI
→ fetch current profile
→ username / display name / avatar
```

Username is presentation and may change. It must not be the canonical ownership key.

This prevents old nodes from becoming inconsistent when a user renames their profile.

## 9. Reuse the data chain before creating schema

Before adding database schema, ask:

1. Does the database already store this fact?
2. Is the fact being dropped by sync/projection/UI?
3. Does an existing account/event/ledger table already model the concept?
4. Is the proposed new table truly a new entity or just a duplicate projection?

A recurring anti-pattern is creating a second system because an existing value was not propagated far enough.

Example:

```text
Supabase already stores actor_id
→ sync ignores actor_id
→ UI cannot show creator
```

The first question should be whether to propagate `actor_id`, not whether to invent a second author database.

## 10. Database transactions are part of the architecture

Browser JavaScript cannot safely guarantee multi-user transactional invariants.

For operations like pending-node voting with a stake, the desired server chain is atomic:

```text
authenticate actor
→ validate node still pending
→ enforce one vote per actor/node
→ lock relevant rows/key
→ debit exact stake
→ create balanced system ledger entry
→ store vote
→ verify conservation
→ commit
```

If any step fails, all steps roll back.

### Security checklist for migrations

When a migration introduces a protected RPC/table, inspect:

- primary/unique/check constraints;
- foreign keys;
- indexes needed for expected reads/locks;
- RLS enabled;
- direct browser INSERT/UPDATE/DELETE privileges;
- minimal `GRANT EXECUTE` surface;
- `SECURITY DEFINER` safe `search_path`;
- idempotency;
- concurrent requests;
- exact numeric precision;
- conservation or other cross-table invariant checks.

Never put a service-role secret into frontend source or Vite public variables.

### Repository migration versus production migration

These are different truths:

```text
migration committed to GitHub
≠ migration applied to hosted Supabase
```

A PR can be code-complete while production is not yet schema-ready. Report both states explicitly.

## 11. Large-graph performance: frequency × scope matters

Complexity must be evaluated together with execution frequency.

An `O(N)` operation may be acceptable on a rare submit and disastrous every animation frame.

Ask:

- how many nodes/edges are touched?
- how often does this run?
- how many draw calls/materials/DOM nodes does it create?
- does it allocate on every frame?
- can it be indexed, incremental, batched, instanced, culled, or moved to GPU visual computation?

### Repeated animation rule

Do not create one timer per node.

Bad:

```text
node 1 → setInterval
node 2 → setInterval
...
node N → setInterval
```

Better:

```text
one shared frame time
→ each visible pending node uses time + stable phase
```

For visual-only effects, shared uniforms/shaders can keep CPU coordination close to constant while the GPU performs per-visible-fragment/vertex work in parallel.

### Visual scalability is also human scalability

Even if the GPU can animate thousands of pending nodes, thousands of equally strong alerts may make the graph unusable.

Use visual priority/LOD when scale demands it:

- new/relevant/nearby pending nodes stronger;
- distant or old pending nodes weaker;
- distant nodes may lose secondary effects;
- very low-priority effects may stop animating when not perceptually useful.

## 12. Mobile-Web verification must prove the user-visible fact

Tests should match the actual claim.

If the requirement is:

> The mobile detail view has a visible top-right close control.

Then a source test such as:

```text
source contains "❌"
```

is insufficient.

The browser test should verify:

```text
control visible
+ bounding box inside viewport
+ adequate touch target
+ click/tap works
+ resulting navigation state is correct
```

This prevents cases where a higher-z-index header hides a perfectly valid button in source code.

### Real device versus emulation

Desktop Chromium with a mobile viewport can catch many DOM/layout/raycast issues. It cannot perfectly reproduce:

- Android vendor GPU drivers;
- Chrome/WebView versions;
- device memory pressure;
- OS composition behavior.

When the defect is known to depend on those factors, real-device smoke testing remains the final evidence.

## 13. Testing strategy: smallest proof first

During diagnosis, do not repeatedly run the entire repository if a 2-second focused experiment can falsify the hypothesis.

A useful progression is:

```text
focused instrumentation / unit test
→ targeted regression
→ production build
→ full test suite
→ browser interaction test
→ production/deployed test when needed
→ real device when needed
```

### Avoid unstable test proxies

A timer heartbeat is not automatically a reliable measure of interactivity. Scheduler timing can make the same build appear red or green.

Prefer tests that exercise the real user action and directly assert the state/action count/response time that matters.

For production-only/minified call-stack ambiguity, a development/source-mapped reproduction can be used to identify the true caller, followed by production regression validation.

## 14. PR scope is part of correctness

A PR is easier to trust when its change set matches its claimed causal scope.

Before opening a PR, compare against the intended base and inspect:

```text
changed files
additions/deletions
unexpected platform paths
unexpected schema/protocol paths
large file rewrites
binary/generated artifacts
```

### Accidental large rewrite guard

A previous diagnostic concurrency mistake replaced a large `index.html` with a tiny truncated version. The branch could then fail for reasons unrelated to the actual bug.

If an intended small change suddenly causes a large file to shrink dramatically, stop. Restore the known-good file and re-apply the minimal edit.

Do not trust “the patch command succeeded” as evidence that the file remains structurally valid.

## 15. PR state and branch hygiene

Before new work:

- check whether the previous PR is still open, merged, or stale;
- check current `main`;
- branch from the correct current base;
- do not continue a merged PR as if it were still an editable review container.

When the maintainer asks for a PR, open a formal Ready-for-review PR by default. CI failures are fixed by adding commits to that same open PR; Draft is not required for ordinary requested work.

Never merge without explicit maintainer approval.

## 16. Truthful engineering reports

Use exact states instead of optimistic language.

Good:

```text
build passed
mobile Chromium regression passed
hosted migration not yet applied
real Android device not yet tested
PR open and mergeable
```

Bad:

```text
fully deployed
all mobile devices verified
production fixed
```

when those facts were not actually observed.

The purpose of engineering reporting is to preserve decision quality, not to make the work sound more complete than it is.

## 17. Recommended full quality review

For a broad quality audit, the preferred sequence is:

```text
TypeScript compile / production build
→ ESLint if configured
→ unit tests
→ integration/protocol tests
→ production build checks
→ browser E2E
→ Supabase/RLS/security checks
→ architecture audit
→ complexity audit
→ performance benchmark
→ dead-code / duplication audit
```

The resulting report should separate:

- correctness;
- architecture;
- type safety;
- testing;
- security;
- performance;
- maintainability;
- Critical / High / Medium / Low findings.

Do not invent a numeric score without evidence; scores should be justified by the findings.

## 18. Governance should eventually become executable

Documentation is the first layer, not the final layer.

```text
AGENTS.md
→ tells agents what rules to follow

docs/engineering-handbook.md
→ explains why and records failure patterns

CI / architecture guards
→ automatically reject known dangerous patterns
```

Good future executable guards include:

- forbid routine `forceContextLoss()` / `forceContextRestore()` in UI interaction paths;
- protect frozen protocol files from accidental semantic edits;
- flag native Android/iOS changes in Web-only PRs;
- detect forbidden direct browser mutation of protected ledger tables;
- preserve interaction regression tests for one-action/finite-event behavior;
- detect accidental app-root loss or extreme entry-file truncation.

A guard should be introduced only when `main` can satisfy it. Do not knowingly add a permanent-red CI rule and call that governance.

## 19. Decision checklist before coding

Before a non-trivial change, answer:

```text
What exact user-visible or domain outcome is required?
What layer currently owns this behavior?
What is the current execution/state chain?
What is the shortest correct target chain?
Which existing model/data path can be reused?
What must explicitly remain untouched?
What single observation would falsify my root-cause hypothesis?
What regression proves the actual requirement rather than a proxy?
Does this require hosted migration/deployment or only repository code?
What remains unverified after CI?
```

If those answers are clear, implementation usually becomes smaller, testing becomes sharper, and debugging becomes much faster.