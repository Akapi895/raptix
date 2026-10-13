# 40: Approved plan to draft operation

**What to build:** Connect approved plans to the existing canonical operation creation/control APIs; the AI feature consumes these APIs instead of editing their modules.
**Blocked by:** 39, 27.
**Status:** resolved
**Owner:** Plan-operation orchestration adapter.
**Contract:** [execution.md](../execution.md).

- [x] An authorized human creates a correctly linked draft operation from a valid approved plan; repeated requests do not duplicate it.
- [x] Draft/proposed/rejected/expired/wrong-project plans cannot bridge, and chat never calls execution controls.
- [x] The actual operation API rejects start/resume requiring expired approval and failed current preflight, including changes between click and commit.
- [x] New operation is visible in migrated and legacy consumers; plan approval itself never starts it.

## Implementation

- `src/features/plans/bridge.ts` (new) — the plan→operation orchestration adapter: `createOperationFromPlanTransaction` gates the binding (unknown/foreign plan → `not-found`, wrong specific-project scope → `forbidden`, read-only role/closed project → `forbidden`, approval validity → `conflict`) and commits the binding in ONE atomic ChangeSet: draft operation (plan steps/agents/assets + `planId` linkage), the plan's `opId` pin, pool-agent assignment and the audit row. Repeated requests are idempotent — an already-bound plan returns the same operation and commits nothing. The plan's approval status is deliberately untouched (`startOperation` flips it to `executed`); `createPlanBridgeService` is a separate typed surface so the plans lifecycle surface stays proposal-shaped (chat never reaches execution; ticket 39's surface-key invariant test stays green).
- Expiry re-check site: the binding gate re-runs ticket 39's `usableApproval` with the factory clock at binding time (`bridge.ts`, `createOperationFromPlanTransaction`), so an approval past its absolute 24h deadline refuses even while the stored status string still reads `approved`. Integrated into the execution path per execution.md row b: `computePreflightChecks` PRE-07 fails on an expired approval (re-derived at every preflight run and at `operationStartGate`'s click-time re-check, so changes between click and commit cannot admit a start), and `resumeOperation` re-checks the approval before resuming.
- `src/store.tsx` — the legacy `executePlan` action delegates to the bridge transaction (the workbench screen's "Create operation & run preflight" and the operations console's "Create Operation from plan" banner share the one implementation).
- `src/screens/g-plan.tsx` — the Create Operation courtesy derives the effective (expiry-aware) status via `effectivePlanStatus`, so an expired approval disables the button with the re-approve reason; the handler re-checks at click time either way.

## Evidence

- `npm run typecheck` — 0 errors (0 new).
- `npm run lint` — 202 warnings / 0 errors (at the recorded baseline; none added).
- `npm test -- --run` — 776 passed (55 files): 769 baseline + 7 new in `src/features/plans/bridge.test.tsx`.
- `npm run build` — succeeds.
- New tests (`src/features/plans/bridge.test.tsx`):
  - binding: one atomic ChangeSet (operation + plan entities observed), draft-only outcome (`status: 'draft'`, `startedAt: '—'`, no session, no agent reservations), plan stays `approved`, audit row, idempotent repeat (`created: false`, zero commits);
  - refusals at binding time: draft/in_review/rejected/superseded → `Only an approved plan can be executed.`; expired deadline (advanced to `PL-021`'s seeded `Oct 14, 2026, 9:25 AM (UTC+7)` instant) → refusal naming the expiry while the stored status stays `approved`; wrong-project scope → `forbidden` "Switch to that project"; viewer → `forbidden` read-only; unknown plan → `not-found`; nothing committed (operation count and `counters.op` unchanged);
  - the operation API: `startOperation` refuses a failed current preflight (PRE-06, agents reserved by the pinned operation) and refuses after the approval deadline (PRE-07 expiry reason) with the operation left `ready`; `resumeOperation` resumes one instant before the deadline and refuses at it;
  - bridge both directions: typed bridge → legacy store projection + My Tasks inbox + operations console refetch (linked draft appears, ready banner drops, `All 3` count) without reload; the console's legacy entry (`A.executePlan`) → typed operations read observes `planLabel 'PL-024 v1.3'` and the plan leaving `readyPlans`.
- Gap: live browser exercise of the routes (success + refusal toast paths) was not performed — the preview server check is optional per AGENTS.md § Windows Temporary Process Safety and was skipped; the screen-level behaviors are covered by the mounted-screen tests above.
