# 0032. Structured operational-state projection in shadow mode (Step 5 of control-plane fixes)

- **Status:** Accepted
- **Date:** 2026-10-02
- **Deciders:** @PurpleCHOIms
- **Related:** [ARCHITECTURE_AUDIT.md](../../ARCHITECTURE_AUDIT.md), [ARCHITECTURE_AUDIT_FIX.md](../../ARCHITECTURE_AUDIT_FIX.md), [ADR-0027](0027-baseline-freeze-for-control-plane-fixes.md), [ADR-0029](0029-kg-freshness-refresh.md), [ADR-0030](0030-if-contract-consistency.md), [ADR-0031](0031-verified-foothold-gate.md)

## Context

The architecture audit identified P1-4: the planner's KG context is
built from a narrative summary (`kg_summary`, nodes / top vulns /
entrypoints / crown jewels) that never surfaces the operational facts
an operator would act on — who has a session where, which credentials
were captured for which principal, which direct access edges exist.
The data is in the graph (BloodHound ingest writes `HAS_SESSION`
computer→user edges, the cme ingest writes `Credential` nodes with
`AUTHENTICATES_TO` principals, local-group and GPO ingests write
`CAN_ACCESS` / `ADMIN_TO`), but the planner cannot see it without
spending tool calls on `cypher-shell`.

The follow-up review (`ARCHITECTURE_AUDIT_FIX.md` §5) prescribed the
shape: a **read-only structured projection** of `access`,
`credentials`, `reachability` (and `recent_failures`), applied at the
**planner boundary** in **shadow mode** — injected or logged in
parallel with the existing narrative, rejecting no action — and made
load-bearing only after an experiment isolates the benefit of
*structure* from the benefit of *more information*.

## Decision

### 1. `kg_internal.operational_state` — the projection

`build_operational_state(store, *, engagement) -> str` runs three
scoped reads and renders a markdown block headed
`## OPERATIONAL STATE (SHADOW)`:

- **Access** — `HAS_SESSION` edges (computer → user, the direction
  BloodHound's `HasSession` is recorded in) with `logon_type`,
  `privileged`, and `source` edge props when present.
- **Credentials** — `Credential` nodes with `source` / `protocol` /
  `target` / `secret_type` / `admin` props and their
  `AUTHENTICATES_TO` principal(s).
- **Reachability** — direct `CAN_ACCESS` / `ADMIN_TO` edges
  (principal → target).

Every query binds `$engagement` (the store rejects unscoped Cypher).
Row budgets: `MAX_ACCESS_ROWS = 5`, `MAX_CREDENTIAL_ROWS = 10`,
`MAX_REACH_ROWS = 10`; principal lists per credential cap at 3.
Empty sections are dropped; a graph with none of the three returns
`""`, which the injection layer treats as "no block".

Only facts present in the graph are rendered — nothing is inferred or
re-derived. The shadow experiment needs "same facts, structured" so a
T2 comparison against the narrative summary measures structure, not
additional information.

### 2. State and injection

`KGState` gains `kg_operational_state` (`NotRequired`, the same
`reduce_converging_value` reducer as its siblings — the KG slot runs in
parallel subagent branches, cf. #183). The projection is built at both
existing summary refresh points (`before_agent` hydration and the
`before_model` dirty-refresh from ADR-0029), in a **separate
try/except** from the summary: a projection failure logs a warning and
falls back to `""`, and must never take the narrative summary down.

`wrap_model_call` appends the block after the dynamic summary block,
only when non-empty. The summary's block positions (`static`,
`summary`) are unchanged when the projection is empty — the common
case for engagements without AD ingest.

### 3. Shadow semantics

The block is advisory context. Nothing gates on it: no tool call is
refused, no status transition rejected, no prompt rule demands action
from it. It becomes load-bearing (e.g. "pick the source session from
the projection, not from memory") only after the T2 benchmark in the
§5 experiment design shows the planner picks better source sessions /
preconditions with it.

## What is deliberately NOT included

- **`recent_failures`** — deferred. Failure outcomes are typed at the
  dispatch layer (Step 1, ADR-0028) but are not recorded as KG
  observations, so there is nothing to project yet; tried-edge
  recording is the separate L7-obs initiative. The section lands when
  the data does.
- **`REACHES` edges** — derived crown-jewel chain edges, already
  surfaced by the summary's crown-jewel section; including them would
  duplicate the narrative rather than add primitives.
- **No env opt-out flag** — the block is additive and bounded, and an
  "off" switch would make it indistinguishable from an empty graph in
  experiments (same reasoning as ADR-0031's rejected flag).
- **No wiring into the Step-4 gate** — ADR-0031 explicitly deferred
  KG-derived access evidence; coupling them now would couple two
  one-concern-per-PR steps and skip the shadow-measurement the
  prescription requires.

## Consequences

- **Easier:** the planner sees sessions / credentials / direct access
  without spending tool calls on ad-hoc Cypher; the gap P1-4 named is
  closed at the same freshness contract as the narrative summary.
- **Easier:** the structure-vs-information experiment is runnable as
  designed — same facts, one block, deterministic rebuild on revision
  advance, independent channel to toggle in a control arm.
- **Neutral:** engagements without AD ingest render nothing (`""`);
  no state, prompt, or tool surface changes otherwise.
- **Harder:** the system message grows by up to ~20 bounded lines on
  AD-heavy engagements — the caps keep the memory-anti-pattern budget
  (15–25 lines narrative + bounded projection) defensible.
- **Given up:** `recent_failures` visibility until failure outcomes
  reach the KG; a structured (machine-readable) projection format
  until the planner-boundary experiment needs one.
- **Migration:** none. The state field is `NotRequired`; agents built
  without the KG slot are untouched; existing plans and tool calls are
  unaffected.

## Alternatives considered

- **Append the projection to `build_summary` as extra sections.**
  Rejected: couples the two blocks' lifecycles, blurs the
  monkeypatch/experiment surface, and makes the "same facts" control
  arm impossible — you could not toggle structure without also
  dropping the narrative sections.
- **Gate actions on the projection** (e.g., refuse exploitation when
  no session row exists). Rejected outright: violates the shadow-mode
  prescription; blocking/pruning is outside the safe subset and needs
  explicit sign-off plus a T2 before/after benchmark.
- **Include `REACHES` edges in reachability.** Rejected: they are
  derived chain edges to crown jewels, already reported with viable
  path counts; the planner's actual gap is the direct primitives.
- **Env opt-out flag.** Rejected: an additive, bounded block does not
  need a runtime escape hatch, and a flag whose "off" state is
  indistinguishable from "empty graph" poisons the very experiments
  this step exists to enable.
- **JSON block instead of markdown.** Deferred: the injection channel
  is text blocks and `kg_summary` already set the markdown convention;
  a machine-readable projection belongs to the planner-boundary
  experiment if its harness needs one.
