# 21: Project approvals and scope re-validation

**What to build:** Migrate submit/withdraw/decide approvals and scope revision transactions, with real role/self-approval checks and immediate dependent invalidation.
**Blocked by:** 20.
**Status:** ready-for-agent
**Owner:** Project approval/scope domain and handlers.
**Contract:** [execution.md](../execution.md).

- [ ] Real handlers reject unauthorized/self decisions and missing required review information; UI explains refusal.
- [ ] Scope revision submission atomically bumps ROE, expires approved plans, resets ready operations and clears preflight; added assets stay pending.
- [ ] Independent approval admits the pending scope/assets; running operations keep documented last-approved-scope behavior.
- [ ] Test new/legacy plan-operation consumers observing the same invalidation, and failed transaction leaving all entities unchanged.
