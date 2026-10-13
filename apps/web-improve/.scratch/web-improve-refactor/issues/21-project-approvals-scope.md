# 21: Project approvals and scope re-validation

**What to build:** Migrate submit/withdraw/decide approvals and scope revision transactions, with real role/self-approval checks and immediate dependent invalidation.
**Blocked by:** 20.
**Status:** resolved
**Owner:** Project approval/scope domain and handlers.
**Contract:** [execution.md](../execution.md).

- [x] Real handlers reject unauthorized/self decisions and missing required review information; UI explains refusal.
- [x] Scope revision submission atomically bumps ROE, expires approved plans, resets ready operations and clears preflight; added assets stay pending.
- [x] Independent approval admits the pending scope/assets; running operations keep documented last-approved-scope behavior.
- [x] Test new/legacy plan-operation consumers observing the same invalidation, and failed transaction leaving all entities unchanged.

## Implementation

Feature-local handlers in `src/features/approvals/service.ts` (ADR-0067 pattern, ticket 19 exemplar):

- `submitApprovalTransaction` — one atomic commit (request + project state for creations + reviewer notice + audit). Refusal order: out-of-scope → `not-found`; closed/cancelled → `forbidden`; missing `editScope` for project/scope types → `forbidden`; duplicate pending governance request → `conflict`; missing submission essentials (in-scope asset, emergency contact, window) → `validation` naming the gaps.
- `withdrawApprovalTransaction` — submitter or scope manager/admin, pending-only, audited.
- `decideApprovalTransaction` — four-eyes owned by the handler: missing `approve` role → `forbidden`; the request's own submitter → `forbidden` (four-eyes); approving a project/scope request without emergency contact or in-scope assets → `validation` (baseline messages kept); returning without a reason → `validation`. Decision + dependent effects (project state, admitted pending assets, agent assignment) + audit + notice commit together. Closure specifics stay with ticket 22 (the legacy close branch keeps working); plan expiry enforcement stays with 39.
- `reviseScopeTransaction` — the one governance transaction behind `editScope` AND `addAssets` (ticket 51 consumes this same interface). On a governed scope (approved ROE on an approved/active project) any revision invalidates at SUBMISSION in ONE commit: ROE bumps to the next draft version, approval re-locks pending, approved plans expire with a Re-validation Required risk, ready operations return to Draft with `preflightAt` cleared, and added assets stay `pending`. Running operations are untouched (last-approved-scope behavior; resume stays refused while the plan needs re-approval). Non-governed projects keep plain draft edits with no invalidation.

Legacy wiring: `A.submitApproval`/`A.withdrawApproval`/`A.decideApproval`/`A.editScope`/`A.addAssets` now delegate to the handlers (Res-shaped refusals; `bumpRoe` retired from the store). Governance panels: `useSubmitApproval`/`useReopen` moved to `src/features/approvals/hooks.ts` (b-detail2 is components-only again — its two react-refresh warnings are gone); ScopeTab renders a refusal banner for editScope/resubmission; TeamTab renders the handler's decision refusal; wizard self-decision now surfaces the refusal and the independent reviewer decides.

## Evidence

- `npm run typecheck` — 0 errors (0 new diagnostics).
- `npm run lint` — 0 errors, 204 warnings (baseline 207; the two b-detail2 react-refresh warnings fixed, no new warnings in `src/features/approvals` or the touched screens).
- `npm test -- --run` — 638 passed (626 baseline + 12 new in `src/features/approvals/service.test.tsx`). Baseline `safety/isolation.test.tsx` scope-invalidation tests re-pointed to a scope-managing persona (the handler now enforces `editScope`, the exact gap this ticket closes) and the wizard baseline decision now proves the four-eyes refusal before the independent approval.
- `npm run build` — succeeds.
- Required cases covered in `src/features/approvals/service.test.tsx`: unauthorized decision refused with reason (snapshot unchanged); submitter self-decision refused (four-eyes) while an independent admin's decision commits; approval without emergency contact rejected + return without reason rejected; scope revision = ONE ChangeSet carrying project/plan/operation/approval/notice/audit with ROE bump to `ROE-014-v3`, PL-021 expired with re-validation risk, ready op → Draft with preflight cleared; failed revision (forbidden/not-found/validation ×2) leaves the full snapshot byte-identical; running OP-014 keeps status/plan/preflight while the reset draft fails PRE-02 and `startOp` refuses; new consumer (typed `operations` list read) and legacy consumer (store context) observe the same invalidation from one mutation, and a direct handler decision is observed by the legacy consumer (both bridge directions); added assets stay pending with the pending approval naming them, admitted only by the independent approval; seeded 24h plan-expiry metadata (+24h after decision) survives the invalidation.
- Browser route verification: **gap** — preview HTTP check skipped per AGENTS.md § Windows Temporary Process Safety; UI behavior covered by the component-level tests above (TeamTab refusal banner, wizard refusal flow).
