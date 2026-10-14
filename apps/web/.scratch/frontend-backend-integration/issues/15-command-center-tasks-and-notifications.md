# 15: Populate Command Center, Tasks and notifications with real state

**What to build:** A user sees truthful engagement readiness/KPIs, actionable
pending work and durable notices in the shell without querying a demo snapshot.

**Blocked by:** 09 (governed operations), 11 (report lifecycle), 12 (C2 grants).
**Status:** ready-for-agent
**Requirements:** R03-R05, R08-R10.
**Contract:** [execution.md](../execution.md).

## Acceptance

- [ ] Command Center/readiness/completion/activity uses defined real aggregate
  sources. Missing sources show unavailable/not-reported, not a fake zero or
  demo KPI; all-project views aggregate only authorized engagements.
- [ ] My Tasks/inbox groups real tool/business approvals, assigned findings,
  reports and operation/session work with distinct types and correct deep links.
  Actions delegate to the owning feature's authoritative handler.
- [ ] Header notices/unread/read/dismiss state is persisted and scoped to the
  trusted actor. Polling/stream updates are bounded and dispose on scope/session
  changes; stale responses cannot leak another user's/project's work.
- [ ] Project switcher badges and global search resolve API-backed read models
  rather than a mock database snapshot, using supported pagination/search
  semantics and correct source-of-truth refresh behavior.
- [ ] Every relevant state transition from prerequisite workflows updates the
  affected overview/inbox views; read-all/dismiss operations preserve permissions
  and persistence across refresh.

## Verification selection

Select aggregate/inbox/notice scope and unread mutation tests plus changed shell/
dashboard/tasks interactions. Live smoke: trigger one actual approval/task/notice
and observe its resolved state, then switch scope or refuse a foreign action.
Reuse underlying operation/report/C2 lifecycle evidence; do not rerun all those
feature suites solely because the dashboard consumes their data. No full suite.

## Scope boundary

Do not implement business decisions twice in summary endpoints. Copilot remains
owned by 04; summary views consume rather than redefine its conversations.
