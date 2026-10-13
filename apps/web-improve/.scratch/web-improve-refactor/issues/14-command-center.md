# 14: Command Center

**What to build:** Migrate the home dashboard to typed aggregate service reads, Query and real shared scope: KPIs, readiness, completion, activity and quick actions.
**Blocked by:** 13.
**Status:** ready-for-agent
**Owner:** Dashboard feature and aggregate read service.
**Contract:** [execution.md](../execution.md).

- [ ] All-project and selected-project dashboards use only accessible data and update after shared-authority mutations.
- [ ] Readiness/completion computations leave the component and retain their baseline expectations.
- [ ] Quick actions and KPI links reach the correct scoped routes; loading/empty/error states work.
- [ ] No dashboard consumer needs the legacy store/data path; verify persona/project switch and a new-project update.
