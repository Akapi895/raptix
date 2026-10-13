# Execution ledger — baseline gaps (ticket 02)

Each row records enforcement that is **missing in the baseline app today**, the baseline test that
pins the actual current behavior, and the owning ticket(s). Owners follow the site table in
[execution.md](execution.md). No skipped/xfail tests exist; every baseline test is green against
today's behavior.

| # | Gap (verified against `src/store.tsx` / `src/screens/*`) | Pinned by | Owner(s) |
|---|---|---|---|
| G-1 | Preflight gate PRE-04 (time window) always passes — placeholder check, never inspects the schedule | `preflight.test.tsx` "PRE-04" | 26 |
| G-2 | Preflight gate PRE-07 only requires the plan to exist in a soft `review` state; an approved/required-plan gate does not exist | `preflight.test.tsx` "PRE-07" | 26 |
| G-3 | Plan approval expiry is stored (`expires`) and displayed but never enforced — `executePlan`/`startOp`/`resume` ignore the deadline | `ai-proposals.test.tsx` | 39, 40 |
| G-4 | `decideApproval` has no four-eyes check: a user can decide (approve) an approval they filed themselves; only role membership is checked | `rbac.test.tsx` (roles only), store `decideApproval` | 21 |
| G-5 | `requestClose` is gated only in the UI (`CloseTab` modal disables Submit); the store action accepts a request with a failing checklist. `confirmClose` does not verify the confirmer is independent of the requester | `closure-facets.test.tsx` (UI gate + action-level gap) | 22 |
| G-6 | `approveReport` has no author ≠ reviewer check | store `approveReport` | 36 |
| G-7 | `decideSessionRequest` has no self-approval rejection | store `decideSessionRequest` | 46 |
| G-8 | `decidePlaybookRevision` does not reject the revision author acting as reviewer | store `decidePlaybookRevision` | 53 |
| G-9 | Grant expiry runs only from `useGrantWatch` inside mounted C2 screens (15 s interval); there is no sweep and commands are only deadline-checked in the UI layer | `grants.test.tsx` (mounted watch) | 46, 47 |
| G-10 | `resolveStop('confirmed-stopped')` marks `stopState` stopped but leaves linked operations in their prior state; the ticker keeps progressing them | `emergency-stop.test.tsx` (manual confirm) | 28 |
| G-11 | `can()` checks role + project status only; project membership is not consulted (screens/`scoped` reads enforce it instead) | `rbac.test.tsx` membership table | 05–07 |
| G-12 | `scoped()` in specific-project mode filters by `projectId` without verifying `canAccessProject` (membership) | `isolation.test.tsx` | 05–07 |

## Pinning notes

- `setPid` writes `location.hash` inside a `setRoute` state updater (store.tsx:483-488). The updater
  runs at render-flush, after any later `navRaw` write, so navigating to a detail route *before*
  switching projects clobbers the hash with the stale redirect and a delayed `hashchange` resets the
  route. Tests mount on a non-detail route and navigate after `setPid`. UI hardening belongs to the
  router tickets (07–13).
- Fake timers are installed before the dynamic store import in every suite: the module-level clock
  anchor (`T0 = Date.now()`) is captured at evaluation time.
