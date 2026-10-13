# 09: Input, button and status primitives

**What to build:** Extract buttons, text/select/check/toggle inputs and status/severity presentation from the legacy UI module in bounded groups, preserving compatibility exports and tokens.
**Blocked by:** 08e (completion leaf of the split ticket 08 shell layout extraction; umbrella [08](08-shell-layout.md)).
**Status:** resolved
**Owner:** Input/status primitives.
**Contract:** [execution.md](../execution.md).

- [x] Existing props, disabled/loading/reason behavior and status mappings remain compatible.
- [x] Labels, invalid/required states and keyboard operation are preserved in light/dark mode.
- [x] Shared input/status definitions have one implementation; remaining legacy consumers use forwarding exports.
- [x] Group extraction uses explicit sub-leaves when file/line estimates exceed the cap; test interaction/state behavior rather than render-only snapshots for every primitive.

## Evidence

- Commit `refactor(web-improve): input, button and status primitives (ticket 09)` on `wi/09-primitives`: 8 files (≤10), one concern. `src/ui.tsx` 630 → 503 lines and is now a compatibility barrel (ticket 08e pattern) re-exporting the extracted primitives; the new `src/ui/` modules hold 155 non-blank runtime lines, ~147 of them moved verbatim (class strings, markup, props and tone maps unchanged; the only edit is `Status`'s `(STATUS[kind] as any)[value]` becoming a typed `Record<string, StatusEntry | undefined>` lookup — behavior-identical, clears one pre-existing `no-explicit-any`).
  - `src/ui/cx.ts` (1) — shared class joiner.
  - `src/ui/status-map.ts` (58) — `Tone`/`TONE`/`S`, the `STATUS` map (`StatusKind`), `toneText`; pure data, so the two `react-refresh/only-export-components` warnings on `STATUS`/`toneText` definitions leave `ui.tsx`.
  - `src/ui/status.tsx` (16) — `Status`, `Sev`.
  - `src/ui/button.tsx` (31) — `Button` (6 variants × sm/md/lg, icon, disabled/title), `IconButton`.
  - `src/ui/input.tsx` (40) — `fieldCls`, `Field`, `Input`, `Textarea`, `Select`, `SearchBox`, `Check`, `Toggle`.
  - `src/ui/identity.tsx` (9) — `Mono`, `IdLink`, `Avatar`, `Person`.
  - `src/ui/primitives.test.tsx` (213, test-only) — focused accessible-widget tests.
- Remaining in `ui.tsx` untouched for their owners: FilterBar + table/pager/tabs/segmented (10), Modal/Drawer/Menu (11), badges/banners/composed + `Gated`/`Locked`/`useGuard`/`PersonaHint` (12), charts (13), `useDebounced`/`useMemoList` hooks. All still resolve via the same `./ui` import path.
- Tests (`src/ui/primitives.test.tsx`, 16 passing, through the `../ui` forwarding barrel): the full `STATUS` mapping loop — 22 categories × every value asserts rendered label, tone class (`text-ok`…`text-muted`) and icon identity by comparing the lucide svg class against a reference render of `entry.icon`, plus the `sev`/`critical` solid style; label override and unknown-value fallback (`mystery` → raw value, neutral); sm/md sizes. Buttons: all 6 variants render their token classes and fire clicks, `h-8/h-10/h-11` sizes, native keyboard operation (focus + Enter), disabled swallows clicks and keeps `title`, icon renders; IconButton accessible name + tooltip. Inputs: Input/Textarea type through their `Field` label, Select changes value, SearchBox exposes the placeholder as accessible name and reports changes; Toggle operates by click **and** keyboard (Enter) reflecting `aria-checked`, disabled is inert; Check toggles/disables; Field shows required marker, hint, and error replacing hint. Identity: Mono, IdLink stops row-click propagation, Avatar initials from last two words, Person pairing.
- Checks at this leaf: `npm run typecheck` 0 diagnostics; `npm run lint` **222 warnings / 0 errors** (base of this branch measured 224; original baseline 226 — react-refresh findings dropped; the 2 remaining in `ui.tsx` are the unavoidable non-component re-exports `cx`/`toneText` on the compatibility barrel, plus the pre-existing `usePaged`/`useGuard`/`useDebounced`/`useMemoList` local-hook warnings and Kpi's `any`, owned by tickets 10/12; the status `as any` warning was cleared). `npm test -- --run` 151 passed (135 existing + 16 new, 15 files). `npm run build` ✓ (`vite build`, 376ms).
- Real app: production build served via `npm run preview` → HTTP 200 with the `#root` shell and bundled asset. Interactive browser click-through (typing/toggling in the live app, light/dark screenshots) not available in this environment — recorded as a gap for tickets 62–64 audits rather than claimed as a pass.
- Deviation note: the dispatch brief said "16 status categories"; the actual `STATUS` surface has 22 categories (project, op, step, agent, finding, report, scope, approval, roe, sev, check, detect, integ, generic, plan, session, perm, c2, channel, tool, access, gate). All 22 are covered by the mapping test, and the test pins that count. Button has no loading prop (the brief's "loading/disabled" read both) — disabled is covered; no loading behavior was invented.
