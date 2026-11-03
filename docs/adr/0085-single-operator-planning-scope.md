# 0085. Approve the planner's scope at the handoff for single-operator engagements

- **Status:** Proposed
- **Date:** 2026-10-17
- **Deciders:** the project owner (single-operator lab use)
- **Related:** ADR-0083 (plan document drafts), ADR-0084 (real service adapter boundary); guard rails in `CLAUDE.md`

## Context

The planner (Soundwave) writes the scope into `plan/roe.json`. The web console's
Scope & ROE tab reads a separate, database-backed revision workflow, so nothing
connected the two: the tab stayed empty after a successful planning run. The
revision workflow requires an independent actor to decide a revision
(`requireIndependentActor`), which a single operator cannot satisfy.

Relaxing that rule is a change to a scope guard rail. It is accepted here only
for engagements with exactly one member, and only through the planning handoff.

## Decision

When the operator confirms the planning handoff on an engagement with exactly
one member (role `reviewer` or above), the server:

1. refuses the handoff unless every required planning document is ready (the
   handoff gate is now enforced on the server, not only in the UI);
2. submits a scope revision built from `roe.json` (`in_scope` targets, the
   start/end dates as a UTC window, escalation contacts, and `prohibited_actions`
   as restrictions);
3. approves that revision in the same request, with the operator as both
   requester and decider.

Engagements with more than one member keep the independent review: the handoff
is refused with 409 for the scope step, and a reviewer decides the revision.

## Consequences

- **Easier:** a single operator gets an effective scope from the planning run
  without re-entering it. The planner's output and the scope the runtime
  enforces come from the same document.
- **Harder:** the approval record for single-operator engagements shows the same
  person as requester and decider. Audit reads must treat `singleOperatorHandoff`
  (audit comment `Single-operator planning handoff`) as a distinct approval path.
- **Given up:** the four-eyes guarantee for single-operator engagements. Adding a
  second member restores it, because the scope step is then refused until a
  reviewer decides the revision.
- **Migration:** none for existing engagements. The handoff now requires ready
  planning documents on every engagement.

## Threat model

- *Operator approves a scope they did not review.* Accepted for one-person labs,
  where the operator is the reviewer. The approval is attributed to the operator
  and recorded as a planning-handoff approval.
- *Second member added after approval.* The approved revision remains valid; new
  scope changes then require a reviewer. Adding a member does not revoke it.
- *Planner writes a scope wider than intended.* The handoff shows the document
  and the operator confirms it; the scope is limited to `roe.json` targets and
  the dates it states.

## Alternatives considered

- **Keep four-eyes for every engagement.** Rejected for single-operator labs:
  the scope tab could never be filled without a second account.
- **Let the planner submit and approve scope directly.** Rejected: the agent
  would decide its own authorization, which is the boundary this design protects.
