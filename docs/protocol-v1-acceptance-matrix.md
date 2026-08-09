# Knowledge Protocol v1 independent acceptance matrix

This matrix records executable evidence rather than inferring compliance from implementation text. `Covered` means the named test executes the behavior. `Gap` is an explicit acceptance blocker and must not be reported as passing.

| Requirement | Executable tests | Level | Positive / negative cases | Atomicity | Replay / refresh | Server parity | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Canonical domain vocabulary | `KnowledgeModel.test.ts`; TypeScript build; `ProtocolAdversarialRegression.test.ts` | architecture/runtime | event, storage and UI derive canonical types; invalid endpoints rejected | n/a | n/a | server batch tests | Partial: server JavaScript still mirrors runtime constants |
| Public/personal separation | `KnowledgeModel.test.ts`; `KnowledgeMigration.test.ts`; gateway and server validation tests | domain/gateway/server runtime | Alice/Bob display differs; public record succeeds without mastery; mastery payload rejected | request rejected before write | deterministic legacy migration | exact `PERSONAL_STATE_IN_PUBLIC_PAYLOAD` | Partial: new personal state is separate, but legacy UI events still pass through the old local EventStore |
| Status transitions | `KnowledgeModel.test.ts`; `KnowledgeEditEventRegression.test.ts` | domain/command/event | public epistemic status and availability are separate; falsified direct/manual restore rejected | failed append leaves event count unchanged | reload covered | stable error model | Partial: exhaustive every-source/every-target matrix is not yet present |
| Premise/conclusion/logic semantics | `KnowledgeEditingProtocol.test.ts`; `ProtocolAdversarialRegression.test.ts`; `validation.test.mjs` | domain + server | complete chain accepted; reasoning/logic-symbol premises, extra conclusion dependency, missing rule rejected | invalid edit returns unchanged node array / event count | edit replay covered | complete/partial batch cases | Partial: relations are fields, not first-class typed relations |
| Add atomic/theory | `KnowledgeEditingProtocol.test.ts`; `KnowledgeEditEventRegression.test.ts` | command/projection | atomic types and P→R→C; incomplete theory rejected | one event; invalid zero events | reload covered | batch chain covered | Covered for implemented v1 representation |
| Negate/recovery | `KnowledgeEditingProtocol.test.ts`; `KnowledgeEditEventRegression.test.ts`; adversarial counterexample case | command/projection | evidence-bearing negation; direct restore and invalid counterexample rejected | one event / zero on failure | reload covered | snapshot parity not covered | Partial: multi-counterexample recovery matrix incomplete |
| Decompose | existing protocol and event regression tests | command/projection | two-step chain; malformed counts and missing correction rejected | one event | reload covered | server persists resulting batch | Gap: three-step and generated-N coverage absent |
| Definition merge | existing protocol tests; adversarial downstream redirect | command/projection | two sources accepted; hidden-history duplicate rejected; dependants redirected | one event | replay covered | batch merge test | Partial: full invalid-source matrix absent |
| Theory merge | existing protocol tests; adversarial downstream redirect | command/projection | two chains accepted; premise/rule/type checks; dependants redirected | one event | replay covered | batch structure checks | Partial: multi-chain and full invalid-source matrix remain incomplete |
| Historical uniqueness | protocol tests; `validation.test.mjs` | domain/server | NFKC/case/whitespace paths and hidden history | invalid batch does not call store | reload implicitly retains history | batch-update collision reproduced | Partial: command error codes are not uniformly stable |
| Public hard delete | HTTP smoke test against `server/index.mjs` | server API | reads allowed; DELETE returns 405 | no store mutation | server reread unchanged | server-only | Covered |
| Concurrency/revision/idempotency | store concurrency and queue recovery tests | persistence | two same-revision writes race; transient write recovery | one winner, loser gets `REVISION_CONFLICT` | reread covered | same server store | Partial: commandId idempotency and the complete competition matrix remain absent |
| Migration | `KnowledgeMigration.test.ts`; persistence regression | domain/client persistence | mastery split from public record; suspended split into availability; deterministic repeat | migration output deterministic | repeated migration covered | remote API migration rollout not covered | Partial |
| UI behavior | `KnowledgeEditUiRegression.test.ts` | source regression | controls/text contracts | n/a | n/a | n/a | **Gap:** current test is source-string based, not DOM behavior |
| 3D display | `KnowledgeSceneRegression.test.ts` | scene calculation | reasoning radius ratio and visibility | n/a | scene rebuild | n/a | Covered for calculation; browser visual assertions remain manual |
| Random command invariants | none | property/invariant | none | none | none | none | **Gap** |

## Reproduced failures fixed by the adversarial audit

1. A `reasoning` node was accepted as an ordinary premise.
2. A `logic-symbol` node was accepted as an ordinary premise and as a counterexample.
3. A conclusion with an additional direct premise was accepted because validation used `includes` rather than exact cardinality.
4. Definition merge hid sources without redirecting active downstream dependencies.
5. Public node payloads contained personal `mastery` state.
6. Two updates in one server batch could converge on the same normalized title or description.
7. Public knowledge could be hard-deleted through the API.

The failing reproductions were committed before the production fixes and remain enabled in the normal `npm test` command.
