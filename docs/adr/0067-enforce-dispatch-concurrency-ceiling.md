# 0067. Enforce a real dispatch concurrency ceiling

- **Status:** Proposed
- **Date:** 2026-10-14
- **Related:** ADR-0021, ADR-0023, ADR-0026

## Context

ADR-0021 (B0 session isolation gate), ADR-0023 (bounded iterative surface
re-expansion), and ADR-0026 (bounded parallel surface fan-out, `max_in_flight=3`)
together justify a 3-wide concurrent dispatch bound. All three ground that
bound entirely in orchestrator-side isolation: distinct tmux sessions,
distinct workspace directories, proof that two coroutines can write to
separate `/workspace/se/b0-*` paths without interfering. None of them
examine the target side — whether the thing being probed can itself
tolerate concurrent load.

`DispatchMiddleware._prepare` (`packages/raptix/raptix/middleware/dispatch.py`)
reflects this gap exactly. Its `_active` set only rejects a dispatch whose
`(scope, dispatch_id)` key is already in flight — it prevents re-firing one
identical dispatch, but counts nothing about how many *different*
dispatches share a scope. The orchestrator prompt's "up to 3 at a time" is
pure prompt-level convention (`intelligence/prompts/standard/raptix.md`);
nothing in code enforces it. A real engagement produced the failure mode
this predicts: an injected payload with no client-side timeout blocked
forever on a single-worker service's only worker, permanently wedging it —
every subsequent request, including later recovery attempts and any
sibling dispatch probing the same host, queued behind the same block
(documented in `docs/design/2026-10-12-p4-system-optimization-research.md`,
"self-DoS wedge" finding, and in
`docs/proposals/2026-10-14-auto-fanout-dispatch-mechanism.md`).

This matters more as fan-out usage grows: the web coverage-matrix's
trigger condition is separately being made more reliable (see the fan-out
proposal above), which only increases how often multiple concurrent
dispatches actually get issued in practice. Enforcing the ceiling now, at
the one true dispatch chokepoint every role goes through, closes the gap
before it is exercised more.

## Decision

Add a per-scope admission counter in `DispatchMiddleware`, alongside the
existing `_active` set. Default ceiling is 3, matching the number
ADR-0026 already assumes; override with `RAPTIX_MAX_CONCURRENT_DISPATCHES`,
following the exact resolver pattern `DISPATCH_TIMEOUT_ENV` /
`_resolve_dispatch_timeout_seconds` already establish in the same module.

In `_prepare`, after the existing identical-dispatch check and before
admitting a new dispatch, count active entries whose scope matches the
new dispatch's scope. If that count has already reached the ceiling,
reject with a new `dispatch_capacity_exceeded` error — same shape as the
existing `dispatch_in_flight` / `dispatch_conflict` replies, so the model
sees an explicit, actionable signal rather than an unbounded number of
dispatches silently proceeding or deadlocking against a shared target.

The counter is scoped per `(engagement/thread)`, not global — one
engagement reaching its ceiling must never throttle a different,
unrelated engagement running concurrently.

## Consequences

No attack technique, tool, or role is restricted by this change — it
only bounds how many *simultaneous* dispatches one engagement may have
in flight at once, which the system already assumed was bounded at 3 and
never verified. The practical effect is converting a possible unbounded
pile-up against a fragile target into a bounded, explicit rejection the
orchestrator can react to (wait, or retry serially). This is a safety
backstop against self-inflicted loss of foothold, not a capability
reduction.

This ADR does not add target-awareness (e.g. detecting that a specific
service is single-worker and should get an even lower cap) — that is
addressed separately, as an opportunistic signal in
`docs/proposals/2026-10-14-auto-fanout-dispatch-mechanism.md`'s Phase 1,
which still cannot exceed the ceiling this ADR enforces.

## Alternatives considered

- Raise `max_in_flight` enforcement into the orchestrator prompt more
  forcefully (better wording, stronger instruction): rejected — a
  generative instruction is not a guarantee, and the real incident this
  guards against already happened under the existing prompt wording.
- Enforce the ceiling via `RoEGuardrailMiddleware`'s existing
  `max_concurrent_connections` semaphore instead of a new counter:
  rejected — that semaphore is a global, per-engagement cap on
  network/bash-adjacent tool calls across *all* concurrent work, not
  scoped to sibling dispatches of the same fan-out batch; overloading it
  would conflate two different concerns (raw request-rate limiting vs.
  dispatch-count bounding) and make either one harder to reason about or
  tune independently.
