# 15: My Tasks and approval inbox

**What to build:** Migrate the tasks inbox to aggregate service reads and canonical action dispatch, grouping project/scope/closure/plan/access/report/finding work by role and project.
**Blocked by:** 14.
**Status:** ready-for-agent
**Owner:** Tasks feature; legacy dashboard-source edits are sequenced after 14.
**Contract:** [execution.md](../execution.md).

- [ ] All/mine filters, counts and task links match accessible canonical records; empty/loading/error states work.
- [ ] Role and self-review restrictions remain visible; action requests go to their owning service or compatibility bridge.
- [ ] Creating/deciding an approval in either migrated or legacy UI updates the inbox without reload.
- [ ] No tasks consumer reads the legacy database directly; late results cannot restore the previous project's tasks.
