# 20: Project overview, scope and team panels

**What to build:** Migrate project detail shell and overview/scope/team reads using project services; retain secondary panels through adapters until 23.
**Blocked by:** 19.
**Status:** ready-for-agent
**Owner:** Project detail composition and core panels.
**Contract:** [execution.md](../execution.md).

- [ ] Overview readiness/completion and scope/team metadata use typed canonical reads; membership edits are permission-gated.
- [ ] Direct detail URLs select the correct project; forbidden/not-found states expose no record content.
- [ ] Tab/search state and old aliases survive back/forward, scope changes and dirty guards.
- [ ] Unmigrated panels remain functional via adapters; governance is delegated to its dedicated owners.
