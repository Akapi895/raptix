# 58: Simulated retention and audit log

**What to build:** Complete the six settings tabs with session-persistent simulated retention controls and canonical searchable audit history.
**Blocked by:** 57.
**Status:** ready-for-agent
**Owner:** Retention/audit settings and audit read API.
**Contract:** [execution.md](../execution.md).

- [ ] Retention save/reset/hold/delete UI remains clearly simulated, validated and permission-gated.
- [ ] Audit supports search/filter/pagination and actor/reason/time/project/correlation views.
- [ ] Actions from legacy and migrated feature paths appear in the same audit history; sensitive/scoped filtering applies.
- [ ] Six required settings tabs and retained secondary links function without direct legacy database access.
