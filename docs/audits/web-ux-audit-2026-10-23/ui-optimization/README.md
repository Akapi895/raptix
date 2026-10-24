# UI optimisation pass: colour, links and buttons

Scope: visual and interaction polish of the real console (owner account on the test stack). No feature, API, route or data change. Changes stay in `src/index.css`, `src/ui/`, `src/shell/` and the views of each feature, as the web app's UI-only rules require.

## What was measured

`evidence/contrast-baseline.json` and `evidence/contrast-after.json` come from a script that opens 14 real pages in light and dark theme (28 captures) and reads every visible text node: its colour is composited over the ancestors' backgrounds, and text on a gradient background is measured against each colour stop of the gradient (the worst case).

| | Light theme, texts below 4.5:1 (or 3:1 for large text) | Dark theme |
|---|---|---|
| Before | 13 | 0 |
| After | 0 | 0 |

The baseline was measured before the gradient rule was added to the script, so the baseline can only under-count. The number of texts checked changed between the runs (2850 and 2739) because the pages render slightly differently with the account menu closed. Pages checked: overview, projects, project overview, scope, planning, governance, team, findings, reports, operations, project settings, infrastructure, assets, settings.

Mobile (390 px): no horizontal scroll on overview, governance and findings.

## Changes

1. **Light-theme text contrast** (`src/index.css`, `src/ui/status-map.ts`, `src/ui/banner.tsx`).
   - The light primary and link blue is darker (`#0052CC`). The white label on the fill is 6.8:1, and primary text on the info tint is 5.6:1 (it was 4.0:1).
   - A new `--c-warn-text` token (`#92400E` in light, the warning colour in dark) is used for warning text on warning tints. The fill colour stays for dots, bars and borders.
   - Focus ring follows the primary blue.
   - `theme-contrast.test.ts` now covers text on the status and banner tints in both themes.
2. **Colour roles** (AGENTS.md: primary for actions and links, accent for brand, severity and destructive).
   - 46 link-style buttons (View, Open, Fix, Mark all read, and similar) moved from the accent red to the link blue. Destructive and state-driven actions keep the accent.
   - Finding identifiers are plain muted text instead of red monospace. The finding title shows the link colour on hover.
   - The active sidebar item uses the info tint with a primary bar, not the accent red.
   - Zero counts on the Overview use the neutral tint; a zero is not a status.
3. **Buttons.** The solid destructive variant is a single one (`destructive`); the duplicate `dangerSolid` is removed (2 call sites updated).
4. **Project name first.** The project switcher shows the name, with the identifier as muted monospace. Two shell tests were updated to find the row by identifier anywhere in it.
5. **Governance plans.** A superseded plan is neutral (it was drawn as a failed gate). The drafting form labels sit above their fields instead of in a split column.

## Verification

- `npm run test` for the web app: 190 files, 1678 tests passed.
- `npx tsc --noEmit`, `npx eslint src` and `node tools/check-boundaries.mjs --strict` (408, baseline) all pass.
- The theme contrast test passes with the new text-on-tint pairs.

## Not changed on purpose

- KPI card tints (blue, green, amber, red) on the Overview are the design reference's own colour coding. Only the zero-count case changed.
- Secondary button borders are light grey (`#E5E7EB` on white, about 1.2:1). WCAG asks for 3:1 only when the border is the only cue; the label is present, so the border was left as is.
- The accent is still used for about 120 places that are not links (icons, headings, state text). A full audit of those is a separate pass.
- No automated accessibility audit (axe) was run; keyboard-only navigation was not walked through.
