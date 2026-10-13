# 17: Project wizard shell, information and objectives

**What to build:** Establish the wizard draft/form shell and migrate information/objective steps; retain the remaining steps through the shared draft adapter until their owners land.
**Blocked by:** 16.
**Status:** ready-for-agent
**Owner:** Wizard shell and draft schema.
**Contract:** [execution.md](../execution.md).

- [ ] Information/objectives validate inline; invalid data cannot advance.
- [ ] Back/forward retains the same draft and completion state across migrated and compatibility steps.
- [ ] The existing end-to-end creation flow remains usable; no second project creation path/database is introduced.
- [ ] Dirty/cancel behavior is wired and exercised; draft shapes are typed for later steps.
