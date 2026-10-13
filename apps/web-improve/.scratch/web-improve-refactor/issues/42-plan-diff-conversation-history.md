# 42: Plan comparison and conversation history

**What to build:** Migrate version comparison and history search/pinning using existing canonical plan/conversation read services.
**Blocked by:** 41.
**Status:** ready-for-agent
**Owner:** AI history/compare surfaces; sequenced shared trace-source edits.
**Contract:** [execution.md](../execution.md).

- [ ] Comparison identifies changes between explicit revisions before approval; pinned versions do not drift.
- [ ] History search/pin/unpin is role/scoped with pagination and loading/empty/error states.
- [ ] Direct compare/history/provenance links preserve project and conversation identity.
- [ ] Legacy AI screen consumers are retired incrementally within measured diff limits.
