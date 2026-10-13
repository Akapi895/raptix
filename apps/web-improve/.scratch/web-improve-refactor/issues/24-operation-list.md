# 24: Operations inventory

**What to build:** Migrate the operations list to typed services/Query with status/technique filters and categorized counts.
**Blocked by:** 13.
**Status:** ready-for-agent
**Owner:** Operation list/read handlers.
**Contract:** [execution.md](../execution.md).

- [ ] Counts/filter/search/pagination reflect only accessible canonical operations; loading/empty/error states work.
- [ ] Creation/detail/preflight/schedule links preserve project context and may use bridged legacy routes.
- [ ] Role/read-only gates and late-response isolation are verified.
- [ ] Legacy-created operations appear in the migrated inventory without reseeding or page reload.
