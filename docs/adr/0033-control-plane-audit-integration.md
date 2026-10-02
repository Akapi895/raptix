# 0033. Integrate audit fixes at verified control boundaries

- **Status:** Proposed
- **Date:** 2026-10-02
- **Related:** `ARCHITECTURE_AUDIT_FIX.md` on `origin/audit`; review of audit commits 6f9a6f0–e162e14.

## Decision

Adopt the IF prompt/skill contract corrections; make dispatch failure a
thread-persisted controller outcome rather than a child-only AIMessage; use an
engagement-scoped Neo4j counter for same-second, multi-writer KG revisions.
Foothold evaluation and operational-state projection are **opt-in experiments**.
No change in this branch authorizes propagation or changes RoE enforcement.

### Task boundary

The existing DeepAgents task tool returns a ToolMessage made from the last
AIMessage's **text**, discarding child `additional_kwargs`. A local wrapper
around that tool copies a typed failure into the parent ToolMessage and a
bounded `dispatch_ledger` state channel. The ledger is omitted from graph
input and merges concurrent updates by dispatch ID. It distinguishes retries
of the same objective/intent from a genuinely new strategy or objective;
after the configured failure cap the exact intent is rejected before invoking
the worker. Tool outputs and subagent transcripts remain on their existing
channels. Child role/tool surface stays unchanged.

`task` gains optional `objective_id` and `dispatch_id`. When omitted, a
fingerprint of role/objective/description groups identical retries. The
controller cannot tell whether a substantially reworded description is the
same strategy; experiment metrics must track this limitation. The ledger is
bounded per thread; a new thread is required when exhausted. A successful
dispatch is not silently repeated under the same identity.

### Graph freshness

`KGStore.record_observations` advances `KGRevision.counter` in its write
transaction. The unique scope constraint is ensured before the first runtime
write even on installations that have not invoked the migration runner. The
marker lacks an `engagement` property and therefore does not appear in public
graph projections. The revision token also considers legacy node and edge
timestamps, using independent subqueries. Before each model decision the
middleware compares revision, including writes by child agents. It only
rebuilds the summary when changed. Uninstrumented legacy writers whose
same-second writes do not update timestamps still need migration to the same
counter; this branch does not claim to fix their timestamps.

### Foothold experiment

`RAPTIX_FOOTHOLD_MODE=shadow` classifies operation kinds, not blanket phases.
Preparation and privilege escalation are not treated as propagation attempts.
The optional `AccessVerifier` protocol receives a reference and must obtain
its observation independently; model arguments cannot set `session_live` or
`verified_at`. Unknown, missing or stale observations report `unverified`.
The tool still follows ordinary OPPLAN transitions: shadow output is **not an
authorization decision** and cannot replace existing RoE/HITL checks. The
default is off; no hard gate is provided until a trusted runtime/C2 adapter
and an IF→NP live comparison are available.

### Operational-state experiment

`RAPTIX_KG_OPERATIONAL_SHADOW=1` enables a bounded graph-observation block
only for the orchestrator. Login and access relationships are explicitly
marked **unverified**; a BloodHound `HAS_SESSION` edge is not a live implant.
Credential labels/keys are never copied. Rows, fields, and the total block
are bounded. This injected context may influence the model even though it
does not gate tools; its benefit/cost must be measured against the same-facts
narrative control before it becomes a default.

## Verification needed before merging

1. Focused task boundary sync/async regressions: terminal intent blocked,
   next objective unaffected, parent receives typed outcome and transcript.
2. KG multi-writer, external-write and edge-only tests; migration/constraint
   and a scoped live Neo4j smoke test.
3. Recon→exploit prompt/skill resolution smoke test.
4. Shadow modes off/on and failure cases; assert no hard phase gate appears.
5. Full fast Python lane, typecheck, and a bounded IF→NP replay with metrics
   (redispatch, no-information calls, quality of first propagation choice).

Historical benchmark reports do not contain enough per-dispatch or KG revision
metrics to substantiate a causal improvement. No claim of improved exploit
success or horizontal breadth is made until that replay is run.
