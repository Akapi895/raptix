# 16: Project portfolio

**What to build:** Migrate project list/search/status filters/pagination/export/pinning using the project service and Query.
**Blocked by:** 13.
**Status:** ready-for-agent
**Owner:** Project list and basic project read/pin handlers.
**Contract:** [execution.md](../execution.md).

- [ ] Search/filter/pagination/CSV/pin behavior uses accessible canonical projects, with loading/empty/error states.
- [ ] Creation and pin/edit controls retain role/read-only reasons.
- [ ] A legacy-created project appears in the new portfolio and a new pin mutation updates legacy project views.
- [ ] Route registration is integrated serially; wizard/detail may still use bridged legacy routes.
