# 25: Operation creation and scheduling

**What to build:** Migrate configured operation creation/edit/schedule using validated forms and canonical services; approval/gate computation belongs to 26.
**Blocked by:** 24.
**Status:** resolved
**Owner:** Operation draft/create/update/schedule handlers.
**Contract:** [execution.md](../execution.md).

- [x] Project/playbook/agent/asset selections are scoped; pending/out-of-scope assets and unapproved revisions are unavailable.
- [x] Creation saves a draft with correct linkage; updates invalidate stale preflight and preserve unsupported-in-flight edit refusal.
- [x] Scheduling has explicit timezone/window input and direct-link coverage; invalid input cannot submit.
- [x] Legacy consumers observe the created/updated draft; failure preserves form data and does not duplicate operations.

## Evidence

**Handlers** (`src/features/operations/service.ts`): `operationDraftOptions` (scoped selections: approved playbooks only, project/pool agents with issue flags, project-scope assets with pending/out-of-scope flags), `createOperationDraft` (gate → validate selections → entity + plan + audit in one ChangeSet), `updateOperationDraft` (in-flight refusal, preflight invalidation `preflightAt: undefined`, steps regenerated only when selections changed && `status==='draft'` && `!planId`), `scheduleOperation` (parseable → past → ROE window → blocking agent conflicts, one atomic ChangeSet with audit).

**Schedule as absolute instant:** `Operation.scheduleAt?: string` (ISO-8601) added to `src/domain/entities.ts`; wall-clock `schedule` (UTC+7, `YYYY-MM-DDTHH:mm`) remains the projection via `scheduleInstantOf` (`Date.UTC(...) - PROJECT_TZ_OFFSET_MS`, exported 7h offset, rollover guard) and `scheduleLabelOf`. Scheduling validates at the boundary on instants, never on strings. Ticket 26 consumes `scheduleAt` for real preflight window gates.

**Screens** (`src/screens/c.tsx`): `OperationNew` wizard selects from `useOperationDraftOptions` and submits via `useCreateOperation`/`useUpdateOperation`; `SchedulePage` uses `useScheduleOperation` with explicit datetime-local input, ROE-window hint, and `ConflictPanel` recomputed on absolute instants via `findScheduleConflicts`/`occupancyOf`. `c-common.tsx` `windowIssue` delegates to `roeWindowIssue`, `stepMinutes` to `draftMinutes`; old `occupancy`/`findConflicts` removed.

**Gates:** active/passive verb pairs — create `('create operations','created')`, update `('edit operations','edited')`, schedule `('schedule operations','scheduled')`; Manager/Operator only; aggregate-scope writes allowed to match baseline screens (create requires a specific project).

**Tests** (`src/features/operations/write.test.tsx`, 12): atomic create with plan linkage + pool-agent assignment + audit; refusals commit nothing; schedule stores `scheduleAt` ('2026-10-20T10:00' → `2026-10-20T03:00:00.000Z`) and a single ChangeSet `{kind:'operation', id:'OP-016', projectId:'RT-2026-016'}` + audit entity; invalid schedules (past/window/unparseable) refused; blocking agent conflict; in-flight + role gates; preflight invalidation on update; scoped draft options (PB-004 excluded); wizard creates OP-017 and ticket-24 list refetches; refused write preserves form, no duplicate; schedule page blocks invalid submit, saves valid, navigates; deep link `#/operation-schedule/OP-016` resolves.

**Checks:** typecheck 0 errors; lint 218 warnings (baseline 219, 0 new); tests 280 passed (24 files; 268 baseline + 12 new); `vite build` succeeds.

**Gaps:** no browser-based verification (tests cover screens via render/deep-link); aggregate-scope writes kept intentionally to match baseline screens — tightening is ticket 26 territory.
