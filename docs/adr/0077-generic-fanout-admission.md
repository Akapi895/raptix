# 0077. Generic, safety-aware fan-out admission from annotated work units

- **Status:** Proposed
- **Date:** 2026-10-16
- **Deciders:** operator (raptix workspace)
- **Related:** ADR-0021 (bounded fan-out), ADR-0026 (concurrent-batch budget), ADR-0067 (dispatch concurrency ceiling), ADR-0075 (challenge inventory), docs/design/2026-10-16-generic-fanout-admission-implementation.md, docs/exploitation-effectiveness-diagnosis-2026-10-15.md

## Context

Dispatch admission today (ADR-0067) is blind: `DispatchMiddleware._prepare`
counts concurrent slots per engagement and nothing else. Whether the
candidate dispatch would concurrently mutate the same directory account as
an in-flight dispatch, or probe a single-worker service that a sibling
already wedged, is invisible to the gate. The orchestrator prompt partially
compensates with web/scoreboard-shaped fan-out prescriptions (coverage
matrix, challenge sweep), which do not generalize: nothing in the runtime
stops an Active Directory or network fan-out from repeating the
concurrency-caused lockout/wedge incidents already observed in production.

Two facts must therefore be separated and connected:

1. **What is safe to run concurrently is domain knowledge** — kerberoasting
   against one account, NTLM relay, DCSync, concurrent scans of embedded
   devices each carry different blast radius and noise. Hardcoding any of
   this into the scheduler would create per-domain code paths and cannot
   generalize.
2. **Deciding admission must be deterministic code** — an LLM asked to
   self-regulate concurrency under load skips the rule exactly when the
   rule matters (ADR-0067's whole premise).

## Decision

Introduce one generic admission gate, driven by declarative annotations the
producers already control:

1. **Work-unit contract on `Objective`** (raptix-core): `effects`
   (`read`/`mutate`/`destructive`), `resources` (concrete shared-mutable
   identifiers, e.g. `account:svc`, `host:10.0.0.5`, `surface:/api/Users`),
   and `parallel_safe` (`true`/`false`/unset). All optional; unset
   `effects` defaults to `mutate` and unset `parallel_safe` is treated as
   `False` for mutating work — **unknown means conservative**.
2. **Pure policy module** `raptix.middleware.fanout_admission`: given a
   candidate work unit, the in-flight units, ceilings (global, per-target,
   engagement OPSEC tier, destructive allowance) and a resilience map, it
   returns admit/reject with a machine-readable code
   (`resource_conflict`, `effect_conflict`, `opsec_conflict`,
   `fragile_cap`, `capacity_exceeded`) and the blocking unit ids. No I/O,
   no domain names — the module is unit-tested to contain none.
3. **Wiring in `DispatchMiddleware._prepare`**: the blind capacity branch
   is replaced (behind `RAPTIX_FANOUT_ADMISSION`, default off = today's
   behaviour byte-for-byte) by the policy call. Rejections reuse the
   existing structured `_reply` codes so the orchestrator can adapt, and
   every decision is emitted to `events.jsonl` as `dispatch.admission`
   for audit.
4. **Progressive widening**: per-target resilience starts narrow
   (per-target cap 1) and widens only after consecutive clean dispatch
   outcomes; any failure on a target drops it back to the narrow cap.
   This generalizes `_surface_registry.FRAGILE_UNDER_CONCURRENCY`, which
   remains as the advisory orchestrator-side seed table it already is.

Domain facts enter only through data: objective annotations written by
`objective_expand`/`add_objective`/registries, and an optional
`metadata.fanout` block in skill front-matter consumed by the producers.
No `if domain == ...` branch exists anywhere in the gate.

## Consequences

- **Easier:** AD/cloud/network fan-outs inherit the same safety the web
  matrix hand-tuned; concurrency-caused lockouts and single-worker wedges
  become structurally prevented rather than prompt-hoped; admission is
  measurable from `events.jsonl`.
- **Harder:** every producer of child objectives should annotate `effects`
  /`resources`/`parallel_safe` — unannotated mutating work serializes,
  trading throughput for safety by default; the orchestrator prompt must
  teach the fields and the reject-code contract.
- **Given up:** the fiction that a single global slot count is a safety
  control; it stays only as the outermost ceiling.
- **Migration:** none — new Objective fields are optional with safe
  defaults; existing plans, registries, and the flag-off path behave
  exactly as before.

## Alternatives considered

- **Per-domain scheduler code** (`if role == "ad_operator"`): rejected —
  every new domain reopens the scheduler, and the codebase's registry work
  (ADR-0075) just established target-data-driven derivation as the norm.
- **Prompt-only scheduling discipline**: rejected — non-deterministic and
  historically skipped under load; ADR-0067 exists precisely because of
  this.
- **Queueing rejected dispatches**: rejected — a queued mutating dispatch
  still fires later against context the orchestrator believed stale;
  structured rejection keeps the orchestrator authoritative.
- **Extending `recommended_in_flight` (advisory) instead**: rejected — it
  informs but does not constrain; the incidents happened despite it.
