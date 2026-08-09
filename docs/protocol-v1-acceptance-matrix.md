# Knowledge Protocol v1 independent acceptance matrix

This matrix records executable evidence rather than inferring compliance from implementation text. `Covered` means the named test executes the behavior. `Gap` is an explicit acceptance blocker and must not be reported as passing.

| Requirement | Executable tests | Level | Positive / negative cases | Atomicity | Replay / refresh | Server parity | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Canonical domain vocabulary | TypeScript build; `ProtocolAdversarialRegression.test.ts` | architecture/runtime | UI, event, storage import `KnowledgeModel`; invalid endpoints rejected | n/a | n/a | server batch tests | Partial: server is JavaScript and still mirrors constants |
| Public/personal separation | `GitHubKnowledgeGatewayRegression.test.ts`; `validation.test.mjs` | gateway/server runtime | public record succeeds without mastery; mastery payload rejected | request rejected before write | legacy remote mastery ignored on import | exact `PERSONAL_STATE_IN_PUBLIC_PAYLOAD` | Covered for API payloads; personal events still share the local EventStore |
| Status transitions | `KnowledgeEditEventRegression.test.ts` | command/event | falsified direct resolve rejected | failed append leaves event count unchanged | reload covered | not command-parity tested | Gap: no exhaustive transition matrix; availability is still encoded as `suspended` status |
| Premise/conclusion/logic semantics | `KnowledgeEditingProtocol.test.ts`; `ProtocolAdversarialRegression.test.ts`; `validation.test.mjs` | domain + server | complete chain accepted; reasoning/logic-symbol premises, extra conclusion dependency, missing rule rejected | invalid edit returns unchanged node array / event count | edit replay covered | complete/partial batch cases | Partial: relations are fields, not first-class typed relations |
| Add atomic/theory | `KnowledgeEditingProtocol.test.ts`; `KnowledgeEditEventRegression.test.ts` | command/projection | atomic types and P→R→C; incomplete theory rejected | one event; invalid zero events | reload covered | batch chain covered | Covered for implemented v1 representation |
| Negate/recovery | `KnowledgeEditingProtocol.test.ts`; `KnowledgeEditEventRegression.test.ts`; adversarial counterexample case | command/projection | evidence-bearing negation; direct restore and invalid counterexample rejected | one event / zero on failure | reload covered | snapshot parity not covered | Partial: multi-counterexample recovery matrix incomplete |
| Decompose | existing protocol and event regression tests | command/projection | two-step chain; malformed counts and missing correction rejected | one event | reload covered | server persists resulting batch | Gap: three-step and generated-N coverage absent |
| Definition merge | existing protocol tests; adversarial downstream redirect | command/projection | two sources accepted; hidden-history duplicate rejected; dependants redirected | one event | replay covered | batch merge test | Partial: full invalid-source matrix absent |
| Theory merge | existing protocol tests; adversarial downstream redirect | command/projection | two chains accepted; premise/rule/type checks; dependants redirected | one event | replay covered | batch structure checks | Partial: multi-chain and full invalid-source matrix remain incomplete |
| Historical uniqueness | protocol tests; `validation.test.mjs` | domain/server | NFKC/case/whitespace paths and hidden history | invalid batch does not call store | reload implicitly retains history | batch-update collision reproduced | Partial: command error codes are not uniformly stable |
| Public hard delete | HTTP smoke test against `server/index.mjs` | server API | reads allowed; DELETE returns 405 | no store mutation | server reread unchanged | server-only | Covered |
| Concurrency/revision/idempotency | store queue recovery test only | persistence | transient write recovery | serialized within one server store | reread covered | same store | **Gap:** expectedRevision, commandId, multi-client races not implemented |
| Migration | legacy import path and persistence regression | client persistence | remote mastery ignored; local event reload | dedupe by event ID | repeated reload covered | remote snapshot migration not covered | Partial |
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
