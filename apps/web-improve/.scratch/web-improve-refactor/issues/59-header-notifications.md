# 59: Header notifications

**What to build:** Migrate notification grouping/read-state/deep links to canonical notice services and the shared header slot.
**Blocked by:** 13.
**Status:** ready-for-agent
**Owner:** Notice read/write services; integrator applies header wiring.
**Contract:** [execution.md](../execution.md).

- [ ] Approval and operational submissions produce grouped notices visible without reload, from both legacy and migrated actions.
- [ ] Read/unread handling and target links preserve project authorization and identity.
- [ ] Empty/loading/error states and accessible announcements work; late requests cannot leak previous-scope notices.
- [ ] Header composition changes are serialized by the integrator, not concurrent edits to shared layout files.
