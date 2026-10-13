# 45: C2 infrastructure, channels and overview

**What to build:** Migrate the five-tab C2 shell, infrastructure/channel/session reads and channel detail; request/grant mutations remain bridged until 46.
**Blocked by:** 13, 28.
**Status:** ready-for-agent
**Owner:** C2 read models and overview/channel surfaces.
**Contract:** [execution.md](../execution.md).

- [ ] Infrastructure/channels/sessions/requests/audit tabs resolve directly, with scoped search/filter/pagination and loading/empty/error states.
- [ ] Channel/session links preserve identity; connection health is distinct from access permission.
- [ ] Ticket 28's actual stop outcomes update sessions in the overview, including failure/unknown without fake termination.
- [ ] Legacy grant requests still work through the bridge; no separate C2 data authority exists.
