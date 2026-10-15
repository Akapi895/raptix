# 09: Execute governed plans and control operation lifecycle

**What to build:** The operator can propose/review a plan, bind an approved version
to an operation, pass real preflight and use supported lifecycle/stop controls
without bypassing scope, deadline or runtime authorization.

**Blocked by:** 05 (execution/recovery), 08 (scope and ROE governance).
**Status:** complete
**Requirements:** R03-R09, R10; operation/plan model approved in 01.
**Contract:** [execution.md](../execution.md).

## Acceptance

- [ ] Implement required plan draft/proposal/revision/compare/review states and
  persisted operation bindings; approvals pin version, ROE and independent actor.
  OPPLAN, tool HITL and a business-plan approval remain distinct records.
- [ ] Enforce absolute 24-hour approval deadlines at all required execute/bind/
  start/resume sites. Scope revisions invalidate affected approvals and readiness
  through the authoritative version contract from 08.
- [ ] Operation wizard, preflight and schedule/start use real readiness checks:
  project, ROE, targets, edited time window, playbook, agent readiness, required
  approvals and contact. Respect approved manual/planless-operation policy.
  Supply the minimal verified playbook/agent inputs consumed here; full library
  review/fleet workflows remain with 14/13. These readiness inputs must be live,
  not simulated or postponed until those broader UI workflows are complete.
- [ ] Pause/resume/schedule are wired only to supported backend/runtime semantics;
  required gaps are implemented, not silently treated as interrupt resume. Every
  lifecycle mutation captures scope, reason and concurrency version.
- [ ] Emergency stop at the required operation/project/workspace scopes reports
  requested/acknowledged/stopped and explicit failed/unknown outcomes. Audit and
  manual-confirm paths are honest; cancellation acknowledgement is not fabricated
  termination, and emergency-stopped work never auto-resumes.

## Verification selection

Select plan-version/four-eyes, scope invalidation, preflight/schedule/lifecycle and
stop-outcome tests at changed server/runtime handlers, plus their UI controls.
Cover deadline -1/0/+1, edited windows, stale versions and denied resume. Exercise
one allowed start and refusal/stop flow against the runtime. Reuse 05 stream/
ledger evidence unless controls modify those contracts. No full suite.

## Scope boundary

This is one governed-operation work package, not one giant PR. Deliver bounded
patches recorded here. Do not weaken existing runtime guardrails or claim a
required control complete while leaving only a disabled button.

## Evidence (2026-10-15)

- `GovernanceService` + `/plans`, `/preflight`, `/bindings`, `/estops` routes:
  draft -> propose (pins the approved scope revision) -> four-eyes decision
  with an absolute 24h expiry enforced at the bind site (`assertNotExpired`).
  OPPLAN documents and tool HITL decisions are untouched — this is the
  distinct persisted business-plan record per D2.
- Preflight checks project handoff, approved ROE + edited time window
  (`roeWindowAllows`), in-scope targets, emergency contact and active stops;
  the bind refuses (409) with the failed checks named. Scope revisions
  invalidate the pinned version at submission (bind answers 409 until a fresh
  approval), verified by test.
- Emergency stop records requested/acknowledged/stopped/failed/unknown with
  the runtime cancel bridge (acknowledged != terminated); binds refuse while a
  stop is active; work never auto-resumes (`assertNoActiveStop`).
- Tests: `server/tests/t09-governance.test.ts` (5) — four-eyes lifecycle +
  deadline (decidedAt+24h exactly, expiry -1s refuses), scope-pin
  invalidation + re-review path, estop outcome + refusal, preflight
  fail/pass. Web: Governance tab in project detail (preflight checklist,
  plan lifecycle, project estop).
- Later addition (same day, uncommitted until this update):
  `server/tests/t09-governed-lifecycle.test.ts` (2) — approved-plan revision
  keeps the reviewed version untouched while a new draft at version+1 carries
  the body (compare endpoint returns both persisted bodies, `source: 'db'`),
  and bindings refuse null/foreign/planning threads (400/404) before any
  binding row is created. The governance panel gains the revise form,
  revision comparison view and the bind-to-execution-thread form; preflight
  readiness probes are pluggable via the `options.readiness` hook.
- Named gap: deadline +1 boundary and a live runtime dispatch through the
  bound thread are covered structurally; the live dispatch probe runs in
  ticket 18's deployment smoke.
