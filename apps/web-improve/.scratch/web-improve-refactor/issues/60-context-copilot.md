# 60: Context-aware copilot drawer

**What to build:** Migrate the copilot drawer to shared UI context and typed assistance services, preserving proposal-only behavior.
**Blocked by:** 59.
**Status:** ready-for-agent
**Owner:** Copilot feature; header wiring sequenced after 59.
**Contract:** [execution.md](../execution.md).

- [ ] Drawer opens from each feature with the active route/entity/project context and an accessible focus lifecycle.
- [ ] Persona/project changes cancel stale assistance and refresh context without exposing old engagement content.
- [ ] Suggested actions remain proposals and use permission-gated navigation; opening the drawer grants no execution authority.
- [ ] Notifications/drawer exclusivity and reset behavior retain one UI state authority.
