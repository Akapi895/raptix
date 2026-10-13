# 23: Project related-entity and secondary tabs

**What to build:** Complete operations/findings/reports tabs and service-backed existing objectives/activity/plans/sessions/evidence/audit/close panels.
**Blocked by:** 22.
**Status:** resolved
**Owner:** Project relationship read models/panels.
**Contract:** [execution.md](../execution.md).

- [x] All six mandatory tabs are functional; source secondary-tab URLs/aliases retain their behavior.
- [x] Related records are project-scoped and update after canonical mutations; detail links may target bridged legacy features.
- [x] Close panel delegates 22's policy; no panel duplicates operation/report/grant enforcement.
- [x] Every project-detail consumer is service-backed, including empty/error and role/masking cases; no legacy db reader remains.

## Evidence

Branch `wi/23-closedetails` (worktree), all checks run in `apps/web-improve`:

- **Panels migrated to the typed detail read (ticket 20's `ProjectDetail`, extended in ticket 23):** objectives, activity, operations, plans, sessions, findings, reports, evidence, audit and close now render `src/screens/project-detail/service.ts`'s projection — cross-entity slices from the service's project-narrowed `DashboardAggregate`, evidence from the read, and the close checklist from ticket 22's `closePanelItems`/`noConfirmedFindings` derivations over the same snapshot (base + waiver variants + `noFindingsWaiverOk` precondition). `b-detail.tsx`/`b-detail2.tsx` panels no longer read the legacy store database; `CloseTab` dropped its `closePanelItems` import and the checkbox only selects the service-derived waiver variant.
- **db-access closure proof:** `Select-String -Pattern '\bdb\.|[{,]\s*db\s*[,}]'` over `src/screens/b-detail.tsx` and `src/screens/b-detail2.tsx` → 0 hits; the same assertion is enforced as a source test (`the detail shell files read the typed service, never the legacy database`).
- **Scoping/empty/masking:** `detail.test.tsx` — RT-2026-014 renders its slices (OP-013, FD-011, REP-014, PL-021, SS-041, audit rows, objectives with related operations); RT-2026-015 renders SS-043 but not SS-041; RT-2026-017 shows the sessions/plans empty states; viewer redaction path retained; unknown/out-of-scope still fail closed to the blocked state.
- **Links resolve:** findings → `#/finding/FD-011`, reports → `#/report/REP-014`, sessions → `#/c2-session/SS-041` (all canonical legacy-feature routes from the router registry) — asserted by hash after clicking the panel links.
- **Bridge:** legacy mutation appears in panels — `store.A.addEvidence(...)` (commits through the shared transaction bridge) publishes a ChangeSet, the change bridge refetches the `project-detail` view, and the new evidence row renders (test `a legacy mutation reaches the migrated panels through the change bridge`). The close console's pending-approval state updates through the same path (covered by `closure-facets.test.tsx` on the migrated CloseTab).
- **Commands:** `npm run typecheck` → 0 diagnostics; `npm run lint` → 203 warnings / 0 errors (pre-existing baseline unchanged); `npm test -- --run` → 700 passed (694 baseline + 6 new detail tests, including the updated CloseTab callers in `features/closure/service.test.tsx` and `safety/closure-facets.test.tsx`); `npm run build` → built in ~10s (pre-existing chunk-size warnings only).
- **Gap:** browser/preview route exercise skipped — per AGENTS.md § Windows Temporary Process Safety the preview HTTP check is optional and was not run; all route/tab/link behavior above is covered by the mounted-router tests instead.
