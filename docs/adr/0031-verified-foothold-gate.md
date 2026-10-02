# 0031. Verified foothold gate at the IF→NP boundary (Step 4 of control-plane fixes)

- **Status:** Accepted
- **Date:** 2026-10-02
- **Deciders:** @PurpleCHOIms
- **Related:** [ARCHITECTURE_AUDIT.md](../../ARCHITECTURE_AUDIT.md), [ARCHITECTURE_AUDIT_FIX.md](../../ARCHITECTURE_AUDIT_FIX.md), [ADR-0027](0027-baseline-freeze-for-control-plane-fixes.md), [ADR-0028](0028-typed-dispatch-failure-outcome.md), [ADR-0029](0029-kg-freshness-refresh.md), [ADR-0030](0030-if-contract-consistency.md)

## Context

The architecture audit identified P0-3 as the largest IF→NP
correctness gap: OPPLAN validates status transitions and dependencies
but never ties a transition to a real capability. Exploit can return
RCE, a captured credential, or data extraction — none of which is
equivalent to being able to propagate. Raptix already has the
vocabulary (Session, Credential, HAS_SESSION, CAN_ACCESS, ADMIN_TO,
shell inventories, privilege evidence) but nothing crystallizes it
into a typed artifact the controller is *forced to consume*.

The follow-up review (`ARCHITECTURE_AUDIT_FIX.md` §4) fixed the
boundary precisely:

```text
Initial Foothold
        |
        |   requires verified usable access
        v
Network Propagation
```

NOT:

```text
every IF exploit action
        |
        |   requires managed session
        v
allowed to continue exploring
```

The five test states come from the audit's experiment-3 fixtures
(captured in the Step-0 baseline fixture
`tests/fixtures/baseline/recon_exploit_handoff.json`):

| State | Description | IF→NP? |
|---|---|---|
| A | One-shot RCE, no managed session | No |
| B | Credential exists but unusable for desired access | No |
| C | Live session, insufficient privilege | No |
| D | Dead session | No |
| E | Live access + required execution/reachability | **Yes** |

If A–D may continue Initial-Foothold work but are not treated as
propagation-ready, the gate costs almost no IF breadth — that is the
regression principle for this step.

## Decision

Three changes:

### 1. `raptix_core.types.foothold` — the contract (pure layer)

`AccessEvidence` is a pydantic model with the fixture's evidence
fields (`execution_capability`, `session_managed`, `session_live`,
`privilege`, `required_privilege`, `credential_captured`,
`credential_usable`, `reachability_verified`).

`is_usable_access()` is the fail-closed state-E predicate: execution
capability PLUS one of

1. **Managed-session path** — a session the controller drives that is
   currently live, with privilege ≥ `required_privilege` (unknown
   privilege levels fail closed), or
2. **Credential path** — a captured credential verified usable, with
   verified reachability.

`unmet_access_preconditions()` returns the human-readable list of why
access is not usable, worded after the fixture rationale so the
orchestrator can act on it directly. `is_usable_access` is defined as
"no unmet preconditions" — one source of truth.

`Objective.access_evidence` is a declared field on the OPPLAN
objective schema, so evidence round-trips through
`_build_opplan_payload` → `OPPLAN(**data)` reloads (an ad-hoc dict key
would be silently dropped by the pydantic extra-field policy).

### 2. The gate in `update_objective`

New optional `access_evidence` parameter. When a **propagation-phase**
objective (`post-exploit`, `c2`, `exfiltration`) moves to
`in-progress`, the gate requires typed evidence of usable access —
passed on this call or recorded on a previous one. The rejection
message names the unmet preconditions and states explicitly that
Initial-Foothold work is NOT blocked.

Evidence is validated (pydantic) and persisted whenever provided,
independent of status — the orchestrator can record it alongside
completing the Initial-Foothold objective, and the gate's
already-recorded path keeps working across `blocked → in-progress`
retries.

### 3. The orchestrator prompt documents the contract

`decepticon.md` §E gains one bullet: the gate exists, evidence must be
verified before declaring it, and a rejection means "continue IF
work", not "retry blindly".

## What is deliberately NOT gated

- **Initial-Foothold phases** (`recon`, `initial-access`) starting
  work — never gated.
- **Intra-IF exploration** — recon→exploit cycles, worker
  self-rotation, pivot rules (ADR-0030 preserved the worker's freedom
  there; this gate does not touch it).
- **Completing an IF objective** — exploit success (credential
  capture, data extraction, confirmed RCE) legitimately completes IF
  work without being propagation-ready. Forcing evidence at completion
  would be the "every IF exploit action requires managed session"
  anti-pattern the review rejects.

## Consequences

- **Easier:** the false-ready rate becomes measurable. A state-E claim
  whose first propagation task fails is now a *typed, recorded claim*
  that can be diffed against the outcome — the audit's experiment-3
  metric (`false_ready_rate`, first-propagation-task success) is
  measurable instead of lost in narrative.
- **Easier:** the kill-chain boundary is enforced by the controller,
  not by prompt discipline. A hallucinated "exploit succeeded" can no
  longer silently open the propagation phase.
- **Neutral:** states A–D continue Initial-Foothold work unchanged;
  the gate costs no IF breadth by construction.
- **Harder:** the orchestrator must now verify access before declaring
  evidence. The prompt guides this; a too-loose evidence claim shows
  up as propagation-task failure in the T2 benchmark, which is the
  designed feedback loop.
- **Given up:** implicit propagation starts. An operator who wants
  propagation without a verified foothold must record the
  operator-granted access explicitly (the assumption-breach pattern) —
  the declaration is the point.
- **Migration:** none. `access_evidence` defaults to `None`; existing
  plans load unchanged; recon/initial-access flows are untouched.

## Alternatives considered

- **Gate at objective completion** (IF objective cannot complete
  without evidence). Rejected: conflates exploit success with
  propagation capability — credential capture legitimately completes
  IF work; the audit's anti-pattern diagram explicitly rejects this.
- **Free-text evidence in `notes`.** Rejected: the audit's root cause
  is "semantic transitions living in natural-language interpretation".
  A string in notes is exactly the shape the controller cannot
  consume; the false-ready rate would stay unmeasurable.
- **Gate inside the postexploit worker prompt** (worker refuses to
  start without a session). Rejected: the worker has no OPPLAN tools
  and no visibility into the objective phase; the boundary belongs to
  the controller, which owns plan state.
- **Derive evidence automatically from the KG** (HAS_SESSION /
  CAN_ACCESS edges → usable access). Deferred: KG is the canonical
  state store (Step 2 made it fresh), but auto-derivation couples the
  gate to KG availability and ingest fidelity before the T2 benchmark
  can measure the manual-declaration baseline. Shadow-derivation is a
  natural follow-up once the declaration-based baseline exists.
- **Env-gate the whole check** (opt-in flag). Rejected: the safe-subset
  plan treats the gate as the fix; an opt-out flag would re-open the
  exact failure mode at runtime with no telemetry distinguishing
  "operator override" from "model bypassed it".
