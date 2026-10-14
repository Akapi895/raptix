# 39: Independent plan approval and 24-hour enforcement

**What to build:** Migrate plan request/approve/reject/return/revise policy with independent reviewer, current ROE binding and a real absolute approval deadline.
**Blocked by:** 38, 26.
**Status:** resolved
**Owner:** Plan approval/version/expiry handlers, not the operation control module.
**Contract:** [execution.md](../execution.md).

- [x] Author/requester cannot self-approve; role, justification, version and current ROE binding are checked by real handlers.
- [x] Approval sets expiry to decision time +24h; seeded deadlines remain explicit. Re-approval is an independent decision, not a silent timer extension.
- [x] Deadline−1/deadline/deadline+1 tests exercise the real policy without an AI page mounted; expired approval is unusable even before cleanup runs.
- [x] Scope submission invalidation from 21 stays immediate; version revision leaves the pinned executed/approved plan traceable.

## Evidence

- `src/features/plans/service.ts` — the plan lifecycle as feature-local transactions over the one database authority: `requestPlanReviewTransaction` (the one gated import path from a chat proposal to review; `can('plan')`, draft/proposed only, stamps a real now+24h review window), `decidePlanTransaction` (refusal order: not-found → read-only → not in_review → self-approval with the legacy message `'You cannot approve a plan you requested. Ask another reviewer.'` → `approvePlan` role → ROE-approved validation → current ROE binding `plan.roeVersion !== project.roeVersion` → open newer revision → justification required for returned/rejected; approve stamps `decision + 24h` and supersedes the planless predecessor), `withdrawPlanReviewTransaction` (requester or `editScope`, in_review only, clears the window), `revisePlanTransaction` (approved/executed only, non-empty changes, new draft re-pinned to the project's current ROE, never touching the pinned approved plan), `editPlanDraftTransaction`/`discardPlanTransaction` (draft/proposed only), plus `usableApproval` and `effectivePlanStatus` (an approved/executed plan at/after its parsed deadline reads as `expired` and refuses use — no mutation, no cleanup required).
- `src/domain/service-factory.ts` wires `plans(actor, projectId): PlanService`; `src/store.tsx` delegates all six legacy plan actions to the transactions and gates `executePlan` with `usableApproval` at the factory clock (the operation bridge itself remains ticket 40). `src/screens/g-plan.tsx` now surfaces handler refusals as toasts, imports the risk policy from `src/features/plans/policy.ts`, and adds a Withdraw control in the review sticky bar.
- `src/features/plans/service.test.tsx` (11 tests) proves: role/status/conflict gates commit nothing; approve stamps `formatDemoInstant(anchor+24h)` while the seeded PL-021 decision and expiry stay explicit; deadline−1/deadline/deadline+1 run without any AI page mounted (typed read flips to `expired`, store `executePlan` refuses, stored status string stays `'approved'`); re-approval via revision stamps its own decision time, never old-expiry+24h; chat proposals enter the lifecycle only through the gated request (surface keys assert no execution path); revision rules keep the approved plan byte-identical; withdraw/discard gating; both directions of the legacy↔typed bridge; and a ChangeSet → My Tasks refetch without reload.
- Checks: `npm run typecheck` clean; `npm test -- --run` 748 passed (737 baseline + 11 new); `npm run lint` 202 warnings (≤ 203 baseline; the 6 errors are the pre-existing `.ua/.trash-1791905366` junk files); `npm run build` succeeds.
