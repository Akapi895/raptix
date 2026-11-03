# 0091. A confirmed planning handoff authorizes execution

- **Status:** Accepted
- **Date:** 2026-10-18
- **Deciders:** Akapi895 (project owner)
- **Related:** ADR-0090 (trusted engagement identity), ADR-0085 (planning handoff)

## Context

Execution was gated by the governed business plan (four-eyes approval with a 24h
deadline) and an operation binding that pins a plan objective to a thread. The
planning flow (Soundwave writes the eight `plan/*.json` documents, the operator
confirms the handoff) never creates a business plan, so a planning-only
engagement could confirm its handoff and still refuse every execution run with
"Execution requires a current approved plan binding". The operator must be able
to move from planning to execution in the same conversation.

## Decision

When an engagement has no business plan, execution is authorized by the planning
handoff plus the existing preflight. Preflight already requires a confirmed
handoff, an approved ROE whose window covers now, in-scope targets, an emergency
contact, and no active emergency stop. Engagements that do have business plans
keep the governed plan and binding path unchanged.

The planning handoff therefore replaces the four-eyes plan approval for the
planning flow only. It is an operator confirmation, not an independent review.

## Threat model

- A planning-only engagement can run execution without a second reviewer. The
  operator who confirms the handoff is the same operator who runs the work, so
  four-eyes separation is lost for this path. Accepted by the owner.
- The ROE window, the scope pin, the emergency-stop check, and the preflight all
  still apply on every execution submit, so a stale or revoked scope still blocks.
- Dangerous tool calls remain gated by the per-conversation HITL rules, which are
  specified separately and are not weakened by this decision.

## Consequences

- `assertExecutionAuthorized` keeps its original checks for engagements with plans.
- `tests/t09-governance.test.ts` covers both sides: refused before the handoff,
  allowed after it without a business plan.
- The local single-user path (`requirePlan=false` with no plans) is unchanged.
