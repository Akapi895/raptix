# 10: Tables, pagination and tab navigation

**What to build:** Extract table/pager and tabs/segmented primitives with their existing sorting, responsive and navigation behavior.
**Blocked by:** 09.
**Status:** ready-for-agent
**Owner:** Table/navigation primitives and compatibility exports.
**Contract:** [execution.md](../execution.md).

- [ ] Table sorting/selection/empty state and responsive column hiding work without clipped headers.
- [ ] Pagination handles empty/filtered data and boundary pages; tabs/segmented controls expose selection and keyboard behavior.
- [ ] Legacy consumers continue to render through forwarding exports; extraction introduces no domain logic into primitives.
- [ ] Focused widget regressions verify observable interaction and accessible names.
