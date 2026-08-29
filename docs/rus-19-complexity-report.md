# RUS-19 complexity and equivalence report

This report records the repository evidence used for the behavior-preserving
reductions. The authoritative baseline is `main` at
`6f6be9f52a2939e34090ca8461802af66ba8621a` (including PR #177).

## Changed paths

| Hotspot | Previous work | New work | Equivalence evidence |
| --- | --- | --- | --- |
| Projection premise canonicalization | For every node, rebuild `byId`; for every premise, scan all nodes to find Current. Worst case O(N² + EN). | Build `byId`, `byTopic`, and `currentByTopic` once and reuse the same generation index for premise and relation derivation. O(N + E), excluding the existing small per-topic lineage selection. | `KnowledgeGraphIndex.test.ts` fixes substitution, order, de-duplication, missing IDs, and node identity. |
| Reasoning conclusion binding | Every Reasoning resolution scanned every ordinary node; inherited Reasoning recursively repeated those scans. Worst case O(RN + R²). | Build direct ordinary conclusions by Reasoning ID once and memoize root-independent direct/inherited resolutions. O(N + E + R) for valid graphs. Root-relative cycle errors deliberately remain uncached. | Immutable-conclusion, multi-topic rejection, inheritance, and exact per-root cycle-error tests preserve output. |
| DAG validation | Rebuild O(N + E) downstream adjacency for each premise/conclusion pair. | Build adjacency once, then reuse it for each reachability traversal. | Existing protocol and adversarial validation messages remain unchanged. |
| Nearest ISG candidates | Sort every V-cell shell for one nearest cell or a seven-cell candidate window: O(V log V), O(V) temporary records. | One-pass nearest selection O(V)/O(1), and bounded ordered top-K O(VK)/O(K). | `RadialKnowledgeLayout.test.ts` compares the complete old sort order for multiple grids, rays, and K values, including cell-ID tie breaks. |
| Reasoning translation | Allocate every bounded ring and vector before testing the origin. | Yield rings lazily in the same sorted order and stop allocating at the first accepted candidate. | Existing cross-family collision and deterministic Reasoning geometry tests pass unchanged. |
| Global → lineage footprint | Every global Current-cell candidate cloned a temporary graph and invoked the general joint-family solver, including family backtracking, all-cell anchor ordering, relocation snapshots, and recursive reflow even though the temporary state contains exactly one fixed-anchor family and only hard obstacles. | The footprint invokes a direct fixed-anchor coordinate-line solve. It performs the same neighbor ordering, score, tie string, and first-candidate selection but cannot enter relocation/backtracking code that is unreachable for this state. | Latest-main golden addresses, boundaries, direction level/slot, expansion count, 5R edges, Reasoning positions, and component order are frozen in scene tests. The runtime wiring test forbids the nested general solver call. |
| Static scene frames | Every desktop frame reset every fixed node to `homePos`, reapplied every material/scale, synchronized all edge geometry, rebuilt visibility maps, and scanned N+E even while idle. | Explicit graph/style/position dirty flags run those owners only when their inputs change. Visibility setters still apply immediately. Idle frames retain core orbit, pulse, labels, camera compositing, and rendering, but perform zero synchronization passes. | `test:rus19-browser` measures the real page and requires idle frames with zero synchronization passes. Existing RUS-18 camera and shell-priority label tests remain in `test:scene`. |
| Detail visibility | Every bulk visibility check queried the overlay DOM and scanned related controls. | `KnowledgeScene` derives one explicit related-ID set when detail identity changes; pure visibility receives O(1) membership state. | Current/Personal/All and detail reveal tests pass without a synthetic DOM. |
| Panel DTOs | `getPanelNodeById` and `getPanelNodes` independently copied the same fields. | One `panelNodeSummary` conversion owns the DTO. | Existing edit/panel/browser tests cover both consumers. |

Representative synthetic benchmark command: `npm run test:rus19-performance`.
On this container, a final run reported projection **551.50 ms → 2.42 ms** for
2,000 nodes, nearest-seven selection **0.245 ms → 0.132 ms** for an
812-cell shell, and fixed-lineage layout **90.38 ms on clean main → 22.47 ms
on this branch** for the same 20-generation fixture. A later controlled run after
the complete review measured projection **388.23 ms → 2.02 ms**, DAG validation
adjacency **6.02 ms → 2.83 ms**, nearest-seven **0.212 ms → 0.085 ms**, indexed
Reasoning binding **6.32 ms**, and the branch fixed-lineage fixture **17.42 ms**.
Timing is diagnostic; strict output equivalence assertions run
inside the benchmark before results are printed.

## Intentionally unchanged after audit

* **General ordinary-lineage repair recursion:** it is no longer reachable from
  global candidate planning; its only repository consumer is the adversarial
  repair regression. That test deliberately supplies multiple families and soft
  blockers where earlier-family backtracking and cascading displacement change
  the accepted authoritative cells. A finite expansion bound cannot be proved
  for arbitrary finite imported occupancy because the first free shell depends
  on the occupied radial envelope. Bounding it would turn a currently accepted
  valid state into an error, so the general repair solver remains unbounded while
  the production nested multiplicative call is removed.
* **Global candidate path width and direction expansion:** retained because
  path width, candidate order, direction slot, and outward expansion are recorded
  authoritative behavior. Golden tests demonstrate exact addresses; reducing
  either search bound changes those addresses on branching fixtures.
* **Additional controller responsibility merges:** controller ownership differs
  (interaction intent, panel presentation, and create validation). The duplicated
  panel DTO conversion was removed, but merging controllers would remove no
  repeated algorithm and would change lifecycle ownership.
* **Database Reasoning identity:** no Supabase/Postgres connection, `psql`, or
  Docker runtime is available in this environment, so representative
  `EXPLAIN (ANALYZE, BUFFERS)` cannot be truthfully produced. The current trigger
  enforces server-authoritative concrete immutable conclusion identity and
  concurrency semantics. Without hosted/local measurements, no schema/index
  migration is justified; the migration remains immutable and unchanged.

## Mobile A/B classification

`npm run test:browser-mobile` was first run from clean latest main and from this
branch using the same installed browser and SwiftShader environment. Both
produced the same palette counts (`greenDominant: 0`, cyan calibration 197, blue
197, purple 197) and both timed out at the same post-detail label wait. The wait
assumed an arbitrary tappable sphere must own a label, which conflicts with PR
#177's authoritative shell budget/front-facing selection. The acceptance now
chooses a sphere whose label the RUS-18 selector actually selected before opening
detail, then still requires that exact label to be hidden during detail and
restored after close. The complete mobile browser gate passes with this stronger
precondition instead of weakening the visibility assertion.

The Issue #51 wrapper was also A/B tested: its host-side Playwright tap duration
failed on clean main at **603.96 ms** and on the branch at **704.93 ms**, while
both retained 371 rendered / 49 active nodes and identical state assertions.
That measurement included automation/protocol delivery rather than only browser
application latency. Runtime instrumentation now measures the actual pointer-up
to visible-detail chain in the browser; a final run measured **222.8 ms** while
the automation wall was **522.7 ms**. The unchanged 250 ms product threshold now
applies to the causal browser chain, and the Issue #51 gate passes.
