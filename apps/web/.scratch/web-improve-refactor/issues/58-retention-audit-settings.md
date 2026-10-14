# 58: Simulated retention and audit log

**What to build:** Complete the six settings tabs with session-persistent simulated retention controls and canonical searchable audit history.
**Blocked by:** 57.
**Status:** resolved
**Owner:** Retention/audit settings and audit read API.
**Contract:** [execution.md](../execution.md).

- [x] Retention save/reset/hold/delete UI remains clearly simulated, validated and permission-gated.
- [x] Audit supports search/filter/pagination and actor/reason/time/project/correlation views.
- [x] Actions from legacy and migrated feature paths appear in the same audit history; sensitive/scoped filtering applies.
- [x] Six required settings tabs and retained secondary links function without direct legacy database access.

## Implementation

- `src/features/settings/service.ts` — ticket 58 handlers over the one authority:
  `getRetention` (staff-gated read: policies, committed `db.org.holds`, retention-relevant
  audit slice), `updateRetention` (admin-only, period/label validation, audited),
  `setRetentionHold` (place/release, reason both ways, repeat conflict, hold blocks deletion),
  `deleteRetentionData` (admin-only, reason-required, blocked before expiry or under hold,
  records `Deleted (simulated)` without destroying seeded data), and `getAudit` — the
  canonical history read: staff-gated, scoped projection (workspace-level rows admin-only,
  other rows follow project access, matching the baseline), sensitive-evidence reason
  masking (PM-7) below admin, search/actor/action/project/result/origin/correlation/estop
  filters and derived filter-option universes. `auditCorr` is the shared correlation helper.
- `src/features/settings/query.ts` — `retentionKeys`/`auditKeys` with the entity kind at
  position 0, so the ChangeSet bridge refetches both tabs on any committed mutation
  (every commit appends its audit row) whoever commits it; `useRetention`, `useAudit`
  (filter object in the query key), `useRetentionWrites` (save/setHold/remove).
- `src/screens/f-settings.tsx` — `RetentionTab`/`AuditTab` rewritten on the typed reads;
  no direct `db.retention`/`db.audit` access remains in either tab. Retention: expiring
  banner with hold action, Edit modal (Save/Reset/Cancel, validated, admin-gated),
  place/release hold, Delete (disabled with the refusal reason), details drawer, history
  timeline from the canonical audit read. Audit: search, correlation/result selects,
  emergency-stop filter, actor/action/project/origin "More filters", paged table (12),
  CSV export (admin/reviewer, masked reasons flow into the export), event drawer.
- `db.org.holds` (entities + seed) — legal holds persist for the demo session in the one
  database, commit atomically with their audit rows and publish the org ChangeSet; demo
  reset restores the seed.

## Evidence

- `npm run typecheck` — clean (0 new diagnostics).
- `npm run lint` — 217 warnings / 0 errors (at the recorded baseline; `eslint` over the six
  touched files reports 0 problems).
- `npm test -- --run` — 43 files, **605 passed** (594 pre-existing + 11 new): retention
  save validated/audited/session-persistent; admin gates with renderable reasons; hold
  place/release with reason, repeat conflict, deletion blocked while held; delete
  expired-gated and clearly simulated (`Deleted (simulated)`, seed data never destroyed);
  audit search/origin/corr/result filters + option universes; scoped projection
  (workspace rows admin-only, operator refused with the tab reason); sensitive-evidence
  masking (admin sees the reason, manager gets `••••`); unified-history bridge test (a
  typed `updateRetention` row and a legacy `A.audit` row both returned by one `getAudit`);
  screen tests: six required tabs render from typed reads + Templates secondary tab works,
  retention save/reset/hold through the typed writes, audit search/pagination with a
  legacy-path row refetching into the typed view via the ChangeSet bridge.
- `npm run build` — succeeds.
- Browser verification: **gap** (skipped per AGENTS.md § Windows Temporary Process Safety —
  the preview HTTP check is optional and was not exercised; unit/screen tests cover the
  routes `#/settings?tab=retention` and `#/settings?tab=audit`).

## Check results

| Check | Result |
|---|---|
| typecheck | clean |
| lint | 0 errors, 217 warnings (baseline ≤217; touched files clean) |
| tests | 605 passed / 0 failed |
| build | ok |
| Budget | 6 files touched; ~374 runtime lines added (≤400) |
