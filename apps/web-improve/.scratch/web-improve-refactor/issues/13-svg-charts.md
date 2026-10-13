# 13: Shared SVG chart extraction

**What to build:** Extract Donut, BarChart, LineChart and their legend from the actual shared UI source; keep graph-specific behavior with feature owners.
**Blocked by:** 12.
**Status:** ready-for-agent
**Owner:** Shared charts.
**Contract:** [execution.md](../execution.md).

- [ ] Empty/zero-value and normal datasets render without invalid geometry; hover/focus information remains usable.
- [ ] Colors/text remain legible in both themes; responsive sizing does not clip labels.
- [ ] Legacy forwarding exports and migrated callers use the same chart implementations.
- [ ] No charting dependency or runtime data source is introduced.
