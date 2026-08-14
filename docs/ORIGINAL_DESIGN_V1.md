# KnowledgeTruthProtocol / ORIGINAL_DESIGN_V1

This document locks the repository's V1 truth-policy interpreter. The executable single source is
`src/domain/truth-protocol/v1/original-design-policy.ts`; clients must consume its outputs rather than copy constants.

V1 preserves immutable claim versions and history. New claims begin `PENDING` with a one-energy creator/system
position and a first verification round. Semantic edits create a new claim version. Logic-symbol classification is
optional and cannot gate submission; structural identity, required fields, references, uniqueness, idempotency,
balances, and state transitions remain mandatory.

Rounds snapshot eligible-user count, threshold, deadline, and `policy_version`. Ordinary ballots may close a round
at the snapshotted threshold; the initiator vote participates only in the UTC 720-hour timeout majority. Challenges
start at 10 energy with ungated `GLOBAL`, then ungated `LOCAL_10`, followed by each 50..100 accuracy gate in global/local
pairs. An unchanged verdict advances; a flip resets the next challenge to the initial 10-energy stage. Higher stake
tiers repeat the gated cycle without an upper bound.

Every movement is an append-only, balanced ledger entry. Settlements are per-round; flips append the difference between
the new entitlement and the already-applied entitlement for every historical position. No protocol entity is hard
deleted. Any semantic policy change requires a new interpreter and `ORIGINAL_DESIGN_V2`; V1 events continue replaying
through V1.
