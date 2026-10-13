# 51: Asset import and scope revision

**What to build:** Migrate manual/bulk import and scope proposals through asset handlers that consume 21's governance transaction interface.
**Blocked by:** 50, 21.
**Status:** ready-for-agent
**Owner:** Asset import/scope orchestration; project invalidation stays owned by 21.
**Contract:** [execution.md](../execution.md).

- [ ] Import validates rows and saves proposed assets as pending; invalid/duplicate/error rows are reported without partial hidden acceptance.
- [ ] For an approved scope, revision submission immediately expires approved plans/resets ready operations via the canonical governance transaction.
- [ ] Pending additions cannot be selected as targets until independent approval; approval does not delay invalidation to that moment.
- [ ] Tests exercise the actual asset → governance → operation/plan path and observe both legacy and migrated consumers.
