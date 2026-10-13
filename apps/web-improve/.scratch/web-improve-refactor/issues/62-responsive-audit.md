# 62: Responsive coverage audit and bounded shared fixes

**What to build:** Verify per-feature viewport evidence and correct only remaining shared layout defects; feature-specific defects become bounded follow-up leaves.
**Blocked by:** 61d (completion leaf of the split ticket 61 system/demo surfaces; umbrella [61](61-system-demo-surfaces.md)).
**Status:** ready-for-agent
**Owner:** Shared responsive layout audit.
**Contract:** [execution.md](../execution.md).

- [ ] Every migrated route group is checked at 768/1024/1280/1440; tables/forms/wizard/header have no clipped critical controls.
- [ ] Shared collapse/overflow fixes fit the diff cap; this is not permission to rewrite all screens in one PR.
- [ ] Missing per-feature verification and defects are recorded in actual follow-up leaves and block audit completion.
- [ ] Relevant breakpoint interactions and the baseline suite remain green.
