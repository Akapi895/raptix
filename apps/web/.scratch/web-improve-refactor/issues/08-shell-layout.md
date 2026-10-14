# 08: Shell navigation and project switcher

**What to build:** Extract sidebar, header and project switcher composition using existing UI exports and shared stores. Notifications/copilot retain compatibility slots for their later owners.
**Blocked by:** 07.
**Status:** resolved
**Owner:** Layout composition; integrator owns shared header edits.
**Contract:** [execution.md](../execution.md).

- [x] Navigation/active section/project selection work across legacy and migrated routes, with isolation and dirty guards intact.
- [x] Emergency stop/contact remain visible at 768/1024/1280/1440 widths in light/dark mode.
- [x] Sidebar collapse, keyboard navigation and header slots preserve existing behavior without duplicating store state.
- [x] Layout extraction is split into bounded tracker leaves before coding if its measured diff exceeds the cap.

## Evidence

- **Split:** the 872-line shell monolith exceeded the ≤400-line cap as a single leaf, so before coding it was split into bounded leaves [08a](08a-shell-nav-sidebar.md) → [08b](08b-shell-switcher-search.md) → [08c](08c-shell-header-slots.md) → [08d](08d-shell-context-ribbon.md) → [08e](08e-shell-completion.md) (chain above; the outgoing blocker 09 was transferred to the completion leaf 08e). Each leaf landed as its own green commit on `wi/08-shell`.
- **Extraction:** `src/shell.tsx` (872 lines) is now a thin compatibility barrel; the composition lives in `src/shell/nav.ts`, `sidebar.tsx`, `project-switcher.tsx`, `search.tsx`, `pop.tsx`, `header.tsx`, `context-ribbon.tsx`, `shell/shell.tsx`. Markup/classes/behavior moved verbatim; the redundant `Store & Ext` cast collapsed into `useStore()` (the store context already carries the copilot fields forwarded to the ticket-05 UI store). No screen files needed import fixes — only `router/host.tsx` imports the shell, unchanged.
- **Slot design (tickets 59/60):** named typed slots on the composition — `HeaderSlots { notifications?, askAi? }` on `Topbar` and `ShellSlots extends HeaderSlots { copilotDrawer? }` on `Shell` (`src/shell/header.tsx`, `src/shell/shell.tsx`). Omitted slots render the moved legacy components at their current positions; 59/60 replace them via props at the mount site, serialized by the integrator — no shared-composition edits, no store state duplicated.
- **Tests:** 12 new rendered tests in `src/shell/shell.test.tsx`: nav groups + active-section highlighting for command-center/operation detail/project detail (`aria-current="page"`), collapse toggle (248px↔72px), mobile drawer overlay+Escape close, Arrow/Home/End roving, switcher scope switch via the shared authority, disabled out-of-scope rows for a scoped persona (Riley Brooks, "All" tab), emergency-stop control without responsive-hide classes + emergency-contact chip label spans (`max-2xl:hidden`/`2xl:hidden`) in light and dark, and the 59/60 slot defaults.
- **Verification:** `npm run typecheck` clean (0 new), `npm run lint` 224 warnings / 0 errors (baseline ≤226), `npm test -- --run` 135/135 (123 existing + 12 new; the ticket-02 isolation suite stays green), `npm run build` green. Real-app: `vite preview` served the production build (HTTP 200, root div + bundle), and the served chunk contains the shell markers (`Main navigation`, `Emergency Stop`, `Select project`, `Ask AI`, `Collapse sidebar`, `Skip to main content`).
- **Gaps:** pixel-level light/dark and width verification of the real UI remains with tickets 62/63 (per ticket scope); jsdom cannot measure layout, so breakpoint behavior is asserted structurally (classes/absence of responsive-hide variants).
