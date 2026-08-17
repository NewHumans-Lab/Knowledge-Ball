## Summary

<!-- What does this PR change? Keep the scope focused and concrete. -->

## Authorization / scope

- [ ] This task explicitly authorized repository changes.
- [ ] This is a formal Ready-for-review PR (not Draft) unless Draft was explicitly requested or this is an agent-owned experiment.
- [ ] No unrelated refactor, cleanup, dependency upgrade, or visual redesign is bundled here.
- [ ] Android native source was not modified unless Android work was explicitly requested.
- [ ] iOS native source was not modified unless iOS work was explicitly requested.
- [ ] Frozen protocol semantics were not silently changed.

## Root cause / design reason

<!-- For a bug: identify the first incorrect responsibility, state transition, invariant, or implementation detail. For a feature: explain the design reason. -->

## Evidence / hypothesis test

<!-- What observation proved or falsified the diagnosis? Prefer direct event counts, call stacks, timings, database invariants, or real interaction evidence over guesses. -->

## Before chain

```text
<!-- Relevant execution/state/data chain before the change. -->
```

## After chain

```text
<!-- Simplified intended execution/state/data chain after the change. -->
```

## Why this is the smallest coherent fix

<!-- Explain why this removes the broken mechanism or implements the requirement without duplicating nearby systems. If not applicable, explain. -->

## Existing systems reused

<!-- List existing event/model/database/account/sync/render paths reused instead of creating parallel mechanisms. -->

## Product / data invariants checked

- [ ] Durable identity references use stable `user_id`/UUID rather than username text where relevant.
- [ ] Published/history knowledge is not silently mutated in place where replacement/new-node semantics apply.
- [ ] Public knowledge and private mastery/personal state remain separated.
- [ ] Energy/account/protocol constants remain owned by canonical domain/database policy rather than duplicated in UI.
- [ ] N/A — explain below.

Notes:

## Database / deployment state

- [ ] No schema/database change.
- [ ] Migration added but **not yet applied** to hosted Supabase.
- [ ] Migration applied and hosted schema/RPC/table verified.
- [ ] Production database deployment was explicitly authorized.

Details:

<!-- Never equate “migration exists in Git” with “production schema is live”. -->

## Interaction / performance invariants

For interaction or performance work, record the expected finite action chain.

```text
<!-- Example: 1 touch → 1 open → 1 intended domain event -->
```

- [ ] No unexpected event/subscriber/render storm was observed.
- [ ] No per-node timer was introduced for graph-scale repeated animation.
- [ ] High-frequency complexity/frequency was considered where relevant.
- [ ] N/A.

## Validation

Executed successfully:

- [ ] `npm run build`
- [ ] focused relevant regression test(s)
- [ ] `npm test` when shared behavior can be affected
- [ ] `npm run test:pages` when page/build structure can be affected
- [ ] relevant Playwright/mobile browser test for interaction/UI changes
- [ ] relevant auth/persistence/sync/database/architecture checks
- [ ] merge preflight when available

Exact commands/results:

```text
<!-- List only checks that actually ran and passed. -->
```

Not executed / blocked:

```text
<!-- Environment, credentials, hosted schema, deployment, device, or platform limitations. -->
```

## Mobile / real-device verification

- [ ] Mobile browser test verifies the actual visible/clickable behavior rather than only source text.
- [ ] Real Android Chrome/WebView tested when the defect depends on real-device/GPU behavior.
- [ ] Desktop mobile emulation only; real-device verification is still outstanding.
- [ ] Not applicable.

Details:

## Diff guard

- [ ] Changed-file list matches the intended scope.
- [ ] Additions/deletions were reviewed for accidental large rewrites/truncation.
- [ ] No unexpected Android/iOS files.
- [ ] No unexpected database/protocol files.
- [ ] No unintended generated/binary artifacts.
- [ ] Branch is based on the intended current `main`.

## Residual risk

<!-- Remaining uncertainty: real device, GPU/driver, scale, concurrency, production data, hosted schema, deployment, etc. -->

## Merge

- [ ] Ready for review.
- [ ] Do **not** merge automatically.
- [ ] Merge only after explicit maintainer instruction and re-check the live PR head/checks immediately before merging.