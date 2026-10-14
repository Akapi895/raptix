# 02: Characterize existing safety behavior

**What to build:** Baseline behavioral regressions at the current store/helper/UI execution sites. Record missing enforcement against its target owner instead of requiring ten future invariants to pass through the store today.
**Blocked by:** 01.
**Status:** resolved
**Owner:** Baseline suite and execution-site adapters.
**Contract:** [execution.md](../execution.md).

- [x] Working preflight, stop outcomes, scope invalidation, facets, proposal and isolation paths have meaningful allowed/denied regressions.
- [x] UI-owned four-eyes/grant-watch behavior is exercised with the relevant screen/hook mounted; fake timers precede the export's clock import.
- [x] The 6-role × 19-action baseline covers membership and closed/cancelled contexts; expected values come from documented policy, not calling the same implementation twice.
- [x] Missing deadline/time-window/action enforcement is recorded in the execution ledger with owning tickets; no skipped/xfail tests or false baseline-green claims are shipped.

## Evidence

- 7 suites / 60 tests under `src/safety/` + shared harness `src/test/helpers.tsx`
  (`mountStore` / `mountScreen`, act-wrapped persona switches):
  - `preflight.test.tsx` (8): 8-point gate, PRE-02/03/06/08 denials, PRE-04 placeholder, PRE-07 review state, confirm/refusal paths.
  - `emergency-stop.test.tsx` (6): requested → acknowledged/failed/unknown → stopped, project scoping, retry, manual confirm, no auto-resume after 120 s.
  - `isolation.test.tsx` (5): scoped reads, scope/ROE invalidation (asset removal, ROE bump, expired plan, op reset), PRE-02 re-check, pending scope approval, blocked chat send for out-of-scope assets.
  - `rbac.test.tsx` (11): 6-role × 19-action matrix, closed/cancelled read-only, membership table, `readOnly`.
  - `ai-proposals.test.tsx` (8): proposal-only plans, propose-mode execution refusal, approve → execute → draft op, in_review/draft/superseded refusals, out-of-scope tool block, observe mode, AI finding import gating.
  - `grants.test.tsx` (6): countdown against the module clock, live grant over watch ticks, expiry lock (mounted `useGrantWatch`), store-side expiry effects, in-flight command interrupt, non-holder scope.
  - `closure-facets.test.tsx` (15): `toolFacets` 8-state facet table, `closureChecklist` for RT-2026-014/016/009, manager-gated close modal with failing checklist, operator denial, action-level request gap + reviewer confirmation.
- Gaps and owners recorded in [execution-ledger.md](../execution-ledger.md) (G-1…G-12).
- Fake timers precede every dynamic store import; jsdom `hashchange` timing is handled by
  mounting on a non-detail route before `setPid` (see ledger pinning notes).
- Verification: `npm test -- --run` 60/60, `npm run typecheck` clean, `npm run lint` 226 warnings / 0 errors (baseline unchanged), `npm run build` green.
