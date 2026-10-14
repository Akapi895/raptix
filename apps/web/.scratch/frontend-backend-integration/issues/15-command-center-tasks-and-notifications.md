# 15: Populate Command Center, Tasks and notifications with real state

**What to build:** A user sees truthful engagement readiness/KPIs, actionable
pending work and durable notices in the shell without querying a demo snapshot.

**Blocked by:** 09 (governed operations), 11 (report lifecycle), 12 (C2 grants).
**Status:** complete
**Requirements:** R03-R05, R08-R10.
**Contract:** [execution.md](../execution.md).

## Acceptance

- [x] Command Center/readiness/completion/activity uses defined real aggregate
  sources. Missing sources show unavailable/not-reported, not a fake zero or
  demo KPI; all-project views aggregate only authorized engagements.
  *(InboxService.overview consumes `GovernanceService.preflight` — the
  authoritative checklist, never re-decided; a refusal (e.g. viewer role) or
  missing governance service degrades to an explicit `unavailable` state with
  the reason. `/api/tasks` aggregates only engagements the actor owns or holds a
  membership on (foreign engagements 404/absent). Completion counts are raw
  observed counts; activity is the audited trail.)*
- [x] My Tasks/inbox groups real tool/business approvals, assigned findings,
  reports and operation/session work with distinct types and correct deep links.
  Actions delegate to the owning feature's authoritative handler.
  *(TaskItemView kinds: scope-revision / business-plan / c2-grant / report-review /
  finding-review / active-stop with `href` deep links into the owning project tab;
  the UI opens the link — the owning surface's own handlers stay the only actors.)*
- [x] Header notices/unread/read/dismiss state is persisted and scoped to the
  trusted actor. Polling/stream updates are bounded and dispose on scope/session
  changes; stale responses cannot leak another user's/project's work.
  *(WebNotice rows persist per actorId; read/dismiss/read-all are server-authoritative
  and foreign notices 404. The header bell polls GET /api/notices every 30s (bounded),
  disposes with the component, and every response is filtered by the session's actorId
  server-side.)*
- [x] Project switcher badges and global search resolve API-backed read models
  rather than a mock database snapshot, using supported pagination/search
  semantics and correct source-of-truth refresh behavior.
  *(The real switcher already reads the API portfolio (ticket 03); the command
  center and bell add refetch-on-mutation/invalidate so lifecycle transitions refresh
  their sources. Global search has no API-backed read model in this milestone — the
  real shell does not render a mock search; recorded as not-applicable rather than
  simulating one.)*
- [x] Every relevant state transition from prerequisite workflows updates the
  affected overview/inbox views; read-all/dismiss operations preserve permissions
  and persistence across refresh.
  *(The four decision points (scope revision decision, plan decision, C2 grant
  decision, report review) now create durable notices for the requesting actor via a
  best-effort `createNotice` helper that can never block the authoritative transition;
  panels/bell invalidate on mutations and refetch. Read-all/dismiss persist through
  the API and survive refresh.)*

## Verification selection

Select aggregate/inbox/notice scope and unread mutation tests plus changed shell/
dashboard/tasks interactions. Live smoke: trigger one actual approval/task/notice
and observe its resolved state, then switch scope or refuse a foreign action.
Reuse underlying operation/report/C2 lifecycle evidence; do not rerun all those
feature suites solely because the dashboard consumes their data. No full suite.

**Evidence:** `apps/web/server/tests/t15-inbox.test.ts` (4 tests: preflight-consuming
readiness + observed counts + foreign 404; explicit unavailable without governance and
for a refused viewer; tasks aggregate only from authorized engagements with distinct
kinds/deep links/awaiting-actor; notice read/dismiss/read-all persistence with foreign
404 + best-effort creation that never breaks a decision). Notice creation at the four
decision points is exercised by the unchanged t08/t09/t11/t12 suites (their fakes lack
the webNotice table, proving best-effort). Reused underlying lifecycle evidence; no
feature suites rerun. Server suite 36 files / 321 tests green; web `src/real` 98 tests
green; server+web typecheck and lint clean.

## Scope boundary

Do not implement business decisions twice in summary endpoints. Copilot remains
owned by 04; summary views consume rather than redefine its conversations.
