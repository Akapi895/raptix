# 34: Report catalog, templates and draft creation

**What to build:** Migrate report inventory/template/delivery-history reads and validated draft creation from eligible confirmed findings.
**Blocked by:** 32.
**Status:** ready-for-agent
**Owner:** Report catalog/template reads and create handler.
**Contract:** [execution.md](../execution.md).

- [ ] Search/filter/pagination/templates and history are scoped, with loading/empty/error states.
- [ ] Creation is role-gated; suggested/unreviewed findings cannot be included; selected evidence/finding IDs belong to the project.
- [ ] Independent reviewer selection is validated; the draft opens in the bridged editor until 35.
- [ ] Created report appears in legacy and migrated inventories; failed creation cannot leave partial records.
