# 0014. Record tried edges without restricting retries

- **Status:** Proposed
- **Date:** 2026-09-28
- **Related:** `docs/incalmo-lessons-implementation-guide.md` WP-L7-obs

## Context

The existing KG records discovered attack surface, but not the outcome of a tool
attempt. This lets agents repeat unproductive actions. Blocking repeats would change
which paths the model can explore and is out of scope without a T2 benchmark.

## Decision

Add a flag-gated `tried-edges` middleware slot before the RoE guardrail, so it
also observes RoE refusals without changing the guardrail. The handler is always
called once and its original response is returned; bounded best-effort recording
follows it. Store attempts in the engagement-scoped KG on a `MAPS_TO` relationship
between two existing `Candidate` nodes, distinguished by `tried_ledger=true` and
reserved `tried::` keys. This reuses existing schema without making a failure edge
traversable by the attack-chain planner. Each target/role relationship holds at most
20 compact entries. At most two KG operations per middleware instance may be in
flight, even if the wait times out. A scoped query reads at most 20 such relationships and injects
at most 20 recent attempts into the next system context.

Only a trusted engagement and target from agent state are used. Tool output is
classified into coarse fixed outcome and reason codes; raw output is never promoted
to system instructions. Rendered KG fields are allowlisted again because other KG
writers exist. `DECEPTICON_KG_TRIED_EDGES` defaults off and is independent of L2a's
flag. An absent target, unavailable KG or timeout skips observation without changing
execution. The text suggests avoiding blind repetition; it neither denies retries
nor changes OPPLAN transitions, action selection, or tool arguments.

## Verification

T0 checks blocked/failed/success classifications, engagement scope, bound on
recording/rendering, and that KG failures return the original tool/model response.
T1 replays a recorded refused attempt through the same middleware; the response
remains refused for the same RoE reason, rather than being blocked by the ledger.
No agent A/B benchmark (T2) is required for this observational change.
