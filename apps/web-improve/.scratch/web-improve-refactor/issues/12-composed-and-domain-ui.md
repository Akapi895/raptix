# 12: Composed and domain UI blocks

**What to build:** Extract cards/page headers/fields/banners/skeletons/timelines and domain display/gating blocks in bounded batches with legacy forwarding exports.
**Blocked by:** 11.
**Status:** ready-for-agent
**Owner:** Composed/domain UI exports.
**Contract:** [execution.md](../execution.md).

- [ ] Blocks preserve tokens/layout and accessible names; permission reasons remain visible for gated controls.
- [ ] Loading/empty/error/form feedback remain reusable without reading the database or embedding policy.
- [ ] Barrel exports are tree-shakeable and existing consumers stay wired.
- [ ] Pre-code inventory accounts for every shared export and creates actual split leaves if needed; extraction is not one 40-file PR.
