# 43: Branch groups, timelines and actions

**What to build:** Migrate fanout/branch views and retry/reassign/cancel requests through scoped branch services.
**Blocked by:** 13.
**Status:** ready-for-agent
**Owner:** Branch handlers and fanout surfaces.
**Contract:** [execution.md](../execution.md).

- [ ] Groups/branches show canonical status, timeline and evidence; missing outcomes are not inferred as success.
- [ ] Retry/reassign preserve approval/preflight waiting states from the source; requesting them does not silently execute a branch.
- [ ] Real handlers enforce role, actor/project and eligible-agent checks; cancel requires confirmation/reason and audit.
- [ ] Plan/trace links can use bridged legacy routes; this ticket does not rewrite plan or operation services.
