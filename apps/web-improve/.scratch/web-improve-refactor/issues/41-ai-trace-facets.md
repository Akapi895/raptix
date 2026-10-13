# 41: Tool trace and derived facets

**What to build:** Migrate trace event read models and Policy/Approval/Execution display, deriving facets at the service boundary from the existing stored state.
**Blocked by:** 39.
**Status:** ready-for-agent
**Owner:** Tool-event read/facet interface and trace UI.
**Contract:** [execution.md](../execution.md).

- [ ] Events render durations, evidence links, filters and independent facet labels with scoped empty/error states.
- [ ] A real-helper/service test verifies policy allowed but not executed; rendered tests verify the distinction is visible.
- [ ] Retain one stored state/three derived facets; no invented four-field persistence model or executed proposal.
- [ ] Trace links preserve version/project provenance; no legacy database access remains on this route.
