# 48: Agent fleet and health detail

**What to build:** Migrate agent status/allocation reads and detail health/capability/connection/history presentation through typed services.
**Blocked by:** 13.
**Status:** ready-for-agent
**Owner:** Agent read services and fleet/detail views.
**Contract:** [execution.md](../execution.md).

- [ ] Fleet search/status/project filters and pagination distinguish pool, allocated, unavailable and busy agents.
- [ ] Detail sparklines/capabilities/history describe observed health rather than guaranteed execution ability.
- [ ] Scope/permission and closed/read-only states apply; legacy assignment actions remain bridged until 49.
- [ ] Operation updates from either architecture refresh the fleet without stale or cross-project data.
