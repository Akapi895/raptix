# 05: Shared UI stores and Query providers

**What to build:** Establish auth, active-project, theme, toast and UI Zustand authorities plus the Query provider/change bridge. Legacy consumers forward to the same shared state; server entities remain in services/Query.
**Blocked by:** 04.
**Status:** ready-for-agent
**Owner:** Shared stores/providers/cache integration.
**Contract:** [execution.md](../execution.md).

- [ ] Both legacy and migrated consumers observe persona/project/theme/toast/UI changes without duplicate state.
- [ ] Query keys include actor/authorization scope and project; committed changes invalidate matching consumers.
- [ ] Project/persona switching cancels stale reads; a delayed old response never restores cross-project visibility.
- [ ] Demo reset clears related caches and UI state; subscription/timer teardown works across repeated provider mounts.
