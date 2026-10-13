# 08: Shell navigation and project switcher

**What to build:** Extract sidebar, header and project switcher composition using existing UI exports and shared stores. Notifications/copilot retain compatibility slots for their later owners.
**Blocked by:** 07.
**Status:** ready-for-agent
**Owner:** Layout composition; integrator owns shared header edits.
**Contract:** [execution.md](../execution.md).

- [ ] Navigation/active section/project selection work across legacy and migrated routes, with isolation and dirty guards intact.
- [ ] Emergency stop/contact remain visible at 768/1024/1280/1440 widths in light/dark mode.
- [ ] Sidebar collapse, keyboard navigation and header slots preserve existing behavior without duplicating store state.
- [ ] Layout extraction is split into bounded tracker leaves before coding if its measured diff exceeds the cap.
