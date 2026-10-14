# 62: Responsive coverage audit and bounded shared fixes

**What to build:** Verify per-feature viewport evidence and correct only remaining shared layout defects; feature-specific defects become bounded follow-up leaves.
**Blocked by:** 61d (completion leaf of the split ticket 61 system/demo surfaces; umbrella [61](61-system-demo-surfaces.md)).
**Status:** resolved
**Owner:** Shared responsive layout audit.
**Contract:** [execution.md](../execution.md).

- [x] Every migrated route group is checked at 768/1024/1280/1440; tables/forms/wizard/header have no clipped critical controls.
- [x] Shared collapse/overflow fixes fit the diff cap; this is not permission to rewrite all screens in one PR.
- [x] Missing per-feature verification and defects are recorded in actual follow-up leaves and block audit completion.
- [x] Relevant breakpoint interactions and the baseline suite remain green.

## Evidence

### Audit method

- jsdom has no layout engine, so breakpoint behavior was asserted structurally
  (ticket-08 precedent): the responsive classes implementing 768/1024/1280/1440
  stay on the migrated surfaces, critical controls carry no responsive-hide
  variants, overflow containers keep horizontal scrolling instead of clipping,
  and overlay surfaces stay inside the viewport.
- Swept the shell (`shell/sidebar/header/search/project-switcher/pop/context-ribbon`),
  primitives (`table/layout/dialog/tabs/filter-bar/data/input/button/banner/menu/pager/segmented/charts`)
  and every migrated screen group. The codebase is largely consistent: Tables
  wrap in `overflow-x-auto` with `min-w-[640px]`, `hideBelow` maps to
  `max-md:hidden`/`max-lg:hidden`, KPI grids collapse to two columns, hand-rolled
  tablists carry overflow scrollers, the sidebar is `hidden lg:flex` with an
  `lg:hidden` mobile drawer, and the header responsive-hides at xl/1500px.
- New audit suite: `src/screens/responsive-audit.test.tsx` (11 tests) covers
  shell chrome (sidebar/drawer/header/switcher/AI-mode/Ask AI/profile/copilot
  drawer/notices panel), the shared table contract with row menus escaping the
  scroll container, project detail (tab strip, More menu, no-hide on Create
  Operation/Close Project/Emergency Stop), the team members table plus the
  shared `DTable` sticky-first-column contract, the wizard step rail and form
  grid collapse, the live operation workspace (wide layout, pipeline strip,
  workspace grid, Health strip, dock console), the AI operator drawers, findings
  (severity strip, hidden columns, right-anchored filter popover), C2, settings
  (tab bar + permission matrix) and the demo scenario matrix.

### Shared fixes (2 defects, 4 files, ~35 runtime lines)

1. `src/ui/menu.tsx` — the Menu popover was absolutely positioned inside its
   trigger container and clamped to `min-w-52` with no viewport max-width. In
   table scroll containers (`overflow-x-auto` on projects/findings/settings)
   it was clipped, and near a screen edge it overflowed the viewport. The panel
   now renders through `createPortal` into `document.body` and is fixed-
   positioned from the trigger rect (right-anchor default, left-anchor clamped,
   `max-w-[calc(100vw-1.5rem)]`); outside-click closes only when the target is
   outside both wrapper and panel. Portal events still bubble through the React
   tree, so table-row click protection is preserved.
2. `src/screens/b-detail.tsx` — the project-detail "More" tab menu used
   `align="left"` at the far-right end of the tab strip, extending past the
   viewport; removed so it right-anchors and grows leftward.
- `src/ui/dialog.test.tsx` — the Menu test now asserts the portal, per-align
  fixed positioning and the viewport clamp.

### Check results

- `npm run typecheck`: 0 errors.
- `npm run lint`: 198 warnings / 0 errors (baseline).
- `npm test -- --run`: 913 passed (902 baseline + 11 new); two consecutive
  clean full-suite runs, one earlier run had a single unrelated test flake.
- `npm run build`: green (pre-existing chunk-size warning only).

### Gaps (per contract, these stay recorded)

- Real-browser width sweep at 768/1024/1280/1440 and the pixel-level
  light/dark visual verification are not exercised by this audit; visual
  residue belongs to the ticket 63 pass.
- The Menu primitive's Escape-dismissal/ArrowDown-open keyboard a11y gap
  (recorded in ticket 11's deviation) remains; it is owned by the a11y ticket
  (64), not this one.
