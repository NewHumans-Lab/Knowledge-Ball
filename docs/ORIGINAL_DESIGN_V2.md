# Knowledge Truth Protocol — ORIGINAL_DESIGN_V2

`ORIGINAL_DESIGN_V2` changes the **initial pending-node verification round only**. `ORIGINAL_DESIGN_V1` remains immutable and replayable for historical meaning.

## Product goal

A new knowledge node must earn enough explicit support before it becomes ordinary visible knowledge. Silence is not evidence of truth.

This prevents low-interest, low-quality, or simply wrong submissions from permanently occupying the default Knowledge Ball visual field merely because nobody spent energy opposing them.

## First-round window

The round opens with the knowledge-node creation event and lasts exactly:

```text
720 hours = 30 × 24 hours
```

The eligible-user count and ordinary-vote threshold are frozen when the round is created. Later user growth does not change an already-open round.

The existing threshold function remains unchanged:

```text
users < 10       -> 1 ordinary vote
users < 100      -> 2
users < 1,000    -> 4
users < 10,000   -> 8
then each ×10 users -> ×2 votes
```

## Verdict rule

During the 30-day window:

```text
AGREE first reaches required_votes    -> CORRECT
DISAGREE first reaches required_votes -> INCORRECT
```

If the deadline arrives while neither side has reached the frozen threshold:

```text
-> INCORRECT (TIMEOUT)
```

There is no timeout tie and no timeout-majority promotion in V2. A sub-threshold AGREE majority is still insufficient support.

Examples with `required_votes = 2`:

| AGREE | DISAGREE | At 30-day deadline |
|---:|---:|---|
| 0 | 0 | INCORRECT |
| 1 | 0 | INCORRECT |
| 1 | 1 | INCORRECT |
| 0 | 1 | INCORRECT |

`2 / 0` or `0 / 2` would already have closed before timeout because a side reached threshold.

## Creator position

Creating a new claim locks exactly **1 energy** in the creator/system wager.

The creator does **not** receive a second ordinary vote on the same first-round claim. Their creator position and ordinary-user voting pool are separate economic roles.

```text
CORRECT   -> creator receives locked 1 back + exactly 1 from SYSTEM
INCORRECT -> creator's locked 1 remains in SYSTEM
```

This also applies to an insufficient-support timeout.

## Ordinary voter pool

Every ordinary AGREE or DISAGREE vote stakes exactly **1 energy**.

Threshold settlement remains symmetric:

```text
winning ordinary voters
-> recover their own stake
-> split losing ordinary-voter stakes
```

The creator/system wager never enters the ordinary voter pool.

### V2 timeout with opposition

If a round times out below threshold and at least one valid DISAGREE voter exists, the verdict is INCORRECT and DISAGREE is the winning ordinary side.

DISAGREE voters recover their own stakes and split valid AGREE losing stakes using the existing deterministic largest-remainder micro-energy allocation.

### V2 timeout with no opposition

If nobody cast a valid DISAGREE vote, there is no synthetic user winner.

```text
valid AGREE stakes -> remain in SYSTEM
creator failed stake -> remain in SYSTEM
```

No new energy is created and no special system payout is required: those stakes were already transferred to the system account when locked.

## Historical compatibility

The repository previously contained V1 round/settlement migrations, but at the time V2 was introduced the production Supabase schema was still `202608170001`; the vote-round/finalizer migrations had never been applied to a hosted Supabase environment.

Therefore hosted first-round adjudication begins with V2. The V1 TypeScript policy remains unchanged for historical/replay semantics.

Historical rows from the older vote-only implementation are never silently deleted:

- a ballot accepted after the round should already have closed is kept as `VOID_LATE` and refunded exactly;
- a creator ordinary ballot is kept as `VOID_CREATOR` and refunded exactly;
- invalid historical ballots do not participate in verdict or reward math;
- no historical creator is retroactively charged a claim stake that the old system never collected.

## Authority and concurrency

The database is authoritative for public vote totals and verdicts.

The intended server chain is:

```text
cast vote
-> per-node advisory lock
-> round row lock / validate
-> debit exact 1-energy stake
-> append vote
-> evaluate threshold/timeout
-> atomically settle if ready
-> append server KnowledgeVerdictFinalized event
-> assert energy conservation
-> COMMIT
```

The browser cannot forge `KnowledgeVerdictFinalized` and cannot directly mutate protected vote/ledger tables.

## Projection / visibility

```text
CORRECT   -> node status verified -> remains in default graph
INCORRECT -> node status falsified + hidden -> preserved in public error/history data but removed from the default graph
```

This is a cleanliness gate, not deletion of historical knowledge.
