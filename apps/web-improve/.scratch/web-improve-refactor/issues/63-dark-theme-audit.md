# 63: Dark-theme parity audit

**What to build:** Audit existing per-feature dark-mode evidence and make bounded shared token/chart/overlay contrast fixes.
**Blocked by:** 62.
**Status:** resolved
**Owner:** Theme token/contrast audit; shared-style writes sequenced after 62.
**Contract:** [execution.md](../execution.md).

- [x] Every route group, dialog and graph is inspected in both themes with readable states/labels and no overlap artifacts.
- [x] Shared token fixes preserve the visual baseline and contrast; feature-local failures get separate leaves.
- [x] Toggle/persistence/reset behavior stays coherent across all consumers.
- [x] Audit closes only after linked defects and missing verification are resolved, not by asserting unobserved pixel parity.

## Evidence

### Audit method

- jsdom renders no pixels, so both-theme parity was asserted structurally (the
  ticket-62 precedent): the `dark` class lands on `<html>` through the shared
  `useThemeStore`, and a sweep fails on any Tailwind palette shade that assumes
  a light backdrop (`(text|bg|border)-<palette>-<n>`) unless it sits inside a
  `[data-paper]` intentional fixed-light surface.
- Swept every non-test `.tsx` for hardcoded colors: no `#hex`/`rgb()` in SVG
  fills, strokes or inline styles anywhere; the only hex was the dashboard
  `high` severity. A full class-inventory scan against the `@theme inline`
  registry found exactly two classes referenced but never registered
  (`text-console-info/warn/bad`) plus the palette shades in the two print
  simulations. Shared primitives (`card/dialog/drawer/menu/tabs/table/banner/
  segmented/input/skeleton/toast`) are token-clean; the C2 console docks are
  `bg-console` fixed-dark in both themes, and `bg-black/…` scrims plus
  `text-white`-on-accent are reviewed theme-safe patterns.
- New audit suite: `src/screens/dark-theme-audit.test.tsx` (5 tests) covers
  the dark sweep over one representative surface per route group (command
  center, projects, project detail, live operation, agents, findings, report
  preview, AI operator, C2, settings, demo scenarios), the `data-paper` print
  simulations, the dashboard severity chart token mapping (no hex in any
  inline style), the fixed-dark operation dock with its now-registered accent
  tokens, and toggle/persistence/reset coherence across the header and
  settings consumers.

### Shared fixes (3 defects, 4 files, ~20 runtime lines + 180 test lines)

1. `src/screens/a-dashboard.tsx` — the "high" severity chart color was the
   hardcoded hex `#F2894F`; now `var(--c-orange)`.
2. `src/index.css` — added the `--c-orange` chart token (defined once in
   `:root` like the console tokens: it is legible on both the light page and
   the dark panels, so the visual baseline is byte-identical), and registered
   the missing console accent tokens `--c-console-info/warn/bad` +
   `--color-console-info/warn/bad`. The console level colors and dock links
   (`text-console-info/warn/bad` in the operation dock) previously generated
   no CSS and silently fell back to `text-console-fg`; they now render the
   intended hues tuned for the always-dark console panel.
3. `src/screens/f-report.tsx` + `src/screens/f.tsx` — the report print
   preview (paper pages, watermark, missing-field chips, PDF desk) and the
   report-template miniature thumbnails are intentional fixed-light print
   simulations; both now carry `data-paper` so the audit scan can distinguish
   them from real light-assuming defects. No class changes: light-theme
   pixels are untouched and dark-theme paper stays paper.
- Toggle/persistence/reset were verified coherent, not changed: header
  account-menu and settings appearance write the same `useThemeStore`, the
  choice persists across navigation, and a provider remount restores the
  light default (`resetSharedStores`).

### Check results

- `npm run typecheck`: 0 errors.
- `npm run lint`: 198 warnings / 0 errors (baseline; the new test file adds none).
- `npm test -- --run`: 918 passed (913 baseline + 5 new), including ticket 13's
  chart theme assertions.
- `npm run build`: green (pre-existing chunk-size warning only).
- Preview HTTP smoke check: skipped per AGENTS.md § Windows Temporary Process
  Safety (optional verification).

### Gaps (per contract, these stay recorded)

- The pixel-level light/dark contrast sweep of the real UI at
  768/1024/1280/1440 is not exercised (jsdom); structural token/class
  assertions stand in, and any visual residue stays with the browser-based
  audit pass.
- Buttons inside a wrapping `<label>` (e.g. the settings Theme/Table-density
  `Segmented`) get their accessible name overridden by the label text ("Theme
  Dark System") — a readable-labels defect found by this audit but affecting
  forms app-wide; it belongs to the a11y ticket (64), not this theme leaf.
