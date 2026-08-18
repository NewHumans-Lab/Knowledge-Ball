# Uniform Layer Occupancy

This phase deliberately optimizes **only spatial uniformity**. It does not minimize relation-line length.

## Invariants

1. Every projected knowledge node participates in the layout, including hidden, falsified, superseded, or otherwise non-rendered history.
2. Visibility is applied only after positions are assigned. A hidden node therefore owns a real slot and leaves a real gap in the visible graph.
3. Each non-core layer uses deterministic equal-volume radial strata and near-uniform angular spacing.
4. Ordinary nodes return to their assigned slot after transient dragging. Relationship, premise, logic-rule, and twin edges do not deform the point set in this phase.
5. Core nodes retain their existing central orbit.
6. The mobile render cap is unchanged for performance, but capped/hidden nodes still participate in global slot generation before the visible subset is selected.

## Algorithm

For a layer containing `n` nodes:

- Radius is assigned by equal-volume quantiles:

  `r_i = cbrt(r_min^3 + q_i (r_max^3 - r_min^3))`, where `q_i = (i + 0.5) / n`.

- Directions start from a Fibonacci sphere.
- Radial ranks are deterministically permuted so radius and latitude are not correlated.
- A bounded tangential repulsion pass improves nearest-neighbour spacing while preserving every radius exactly.

This gives the next optimization phase a fixed uniform slot set. Line-length minimization can then operate only on the assignment `node -> slot`, so it cannot destroy the uniform distribution.
