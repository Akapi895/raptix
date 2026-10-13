# 64: Accessibility, announcements and state audit

**What to build:** Verify keyboard/focus/loading/empty/error behavior already owned by each feature; complete bounded shared route/toast/status announcement wiring.
**Blocked by:** 63.
**Status:** resolved
**Owner:** Shared accessibility announcements and audit.
**Contract:** [execution.md](../execution.md).

- [x] Critical flows support logical focus, Enter/Space/Escape and dialog focus restore; graph/SVG controls are labeled and keyboard-operable.
- [x] Route changes/toasts/status transitions are announced without duplicate live-region output.
- [x] Each page/list has loading/empty/error handling and a feature boundary isolates crashes.
- [x] Remaining feature defects become budgeted blocking leaves; audit completion includes actual browser evidence.

## Evidence

### Audit method

- Swept every Menu/Segmented/Field/Toggle/Tabs/Pager/Status usage and the
  shell announcer/toast surfaces for the four owned defect classes: keyboard
  operability, accessible names, focus management, aria state. `Tabs`
  (roving tabindex + arrows), `Pager`/`IconButton` (labeled), `Status`
  (text labels), `Toggle` (aria-checked + explicit label) and the SVG chart
  family (non-interactive, `role="img"` + `aria-label`, no SVG controls
  anywhere — verified by scan) already passed; the defects below were fixed.
- Loading/empty/error and crash isolation were verified as already owned:
  every typed-service tab renders `aria-busy` skeletons, error empties with
  retry, and the route host keeps `PageBoundary` (`role="alert"`) +
  `RouteErrorBoundary` (ticket 61a family); per-feature evidence lives in
  the owning tickets, so no new code was needed for that criterion.

### Shared fixes (5 defects, 5 runtime files, ~28 runtime lines)

1. `src/ui/menu.tsx` — the recorded ticket-11 keyboard gap: Escape now
   closes the open menu (document keydown listener added/removed once per
   open cycle, alongside the outside-mousedown listener) and ArrowDown on
   the focused trigger opens it (no arrow roving was invented beyond the
   baseline brief). Focus management now mirrors `useDialogFocus`: focus
   moves to the first enabled item on open via rAF and restores to the
   previously focused element on close while it is still connected. Element
   triggers get `aria-haspopup="menu"` + `aria-expanded` via cloneElement.
2. `src/ui/segmented.tsx` — the recorded ticket-63 label pollution: each
   option button carries `aria-label={o.label}`, so a wrapping `<label>`
   (the `Field` used by settings Theme/Table-density, c.tsx, h.tsx,
   h-session.tsx) can no longer override the button name with the field
   text ("Theme Dark"). Fixed at all five Field+Segmented sites with one
   primitive change.
3. `src/screens/b-detail.tsx` — the project-detail "More" tab trigger was a
   `<span role="tab">`: unfocusable, so its menu was unreachable by
   keyboard. Now a real `<button type="button" role="tab">` with identical
   classes.
4. `src/screens/b-portfolio.tsx` — the projects row "More actions" trigger
   was a `<span aria-label>` (aria-label ignored on a span with no role).
   Now a real `<button type="button">` with the same classes/label.
5. `src/shell/shell.tsx` — bounded route announcement wiring: one `sr-only`
   `role="status" aria-live="polite"` region whose text is written after
   mount and only when page/id changes, so a navigation announces once and
   same-page tab/filter updates stay silent (no duplicate live-region
   output). Toasts already announce through the single fixed polite region;
   loading states already use `role="status"`.

### Assertions

- `src/ui/dialog.test.tsx` (+2 menu tests): ArrowDown opens and focuses the
  first enabled item (disabled item skipped) while the trigger reports
  `aria-haspopup="menu"`/`aria-expanded`; Escape closes, flips
  `aria-expanded` back and restores focus to the trigger.
- `src/ui/primitives.test.tsx` (+1): inside a wrapping `Field` label the
  Segmented options keep their own names (`queryByRole('button', { name:
  /Theme / })` stays null), `aria-pressed` tracks the selection and clicks
  toggle it.
- `src/screens/a11y-audit.test.tsx` (new, 5 tests on the real routes): the
  b-detail More tab is a button whose menu opens with ArrowDown, focuses the
  first item and closes with Escape back to the trigger; the projects row
  menu trigger is a keyboard-operable button; settings Theme/Table-density
  options expose their own names inside the real labels; the route
  announcer exists once, announces each page/id change once and stays
  silent on a same-page tab change; exactly one route announcer and one
  fixed toast live region render.
- `src/screens/dark-theme-audit.test.tsx` — the settings consumer now clicks
  the Theme option by role + name (the spot where the pollution was
  recorded). Test-only: the 11-mount dark sweep got a 20s per-test budget
  (it timed out at the default 5s under full-suite parallel load on this
  box even on the untouched base — verified by a clean-base run before the
  bump); no assertion changed.

### Check results

- `npm run typecheck`: 0 errors.
- `npm run lint`: 198 warnings / 0 errors (baseline; the new test file adds none).
- `npm test -- --run`: 926 passed (918 baseline + 8 new), two consecutive
  clean full-suite runs.
- `npm run build`: green (pre-existing chunk-size warning only).

### Gaps (per contract, these stay recorded)

- Screen-reader sweeps of the real UI (announcement phrasing, focus order
  feel, live-region verbosity in a real AT) are not exercised (jsdom);
  structural role/name/keyboard assertions stand in.
- Real-browser keyboard walkthroughs (Tab/Enter/Escape on every migrated
  route) are not exercised; the preview HTTP check was skipped per AGENTS.md
  § Windows Temporary Process Safety. Route changes are announced via the
  new live region, but focus does not move to `main` on navigation —
  changing that alters UX/test behavior and stays out of this bounded pass.
