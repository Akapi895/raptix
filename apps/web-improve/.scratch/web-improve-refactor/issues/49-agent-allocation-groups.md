# 49: Agent assignment and groups

**What to build:** Migrate assignment/unassignment/group actions with canonical conflict checks and approval behavior.
**Blocked by:** 48, 21.
**Status:** ready-for-agent
**Owner:** Agent allocation/group write handlers.
**Contract:** [execution.md](../execution.md).

- [ ] Real actions check actor/project/role, existing reservations and conflicting assignments; pending approval does not silently allocate.
- [ ] Group create/edit/remove and project/pool views stay coherent after commit.
- [ ] Destructive actions confirm reasons and publish audit/notices; independent assignment review uses 21's approval interface.
- [ ] Both legacy operations and migrated agent views observe assignments; agent feature no longer needs direct Context data.
