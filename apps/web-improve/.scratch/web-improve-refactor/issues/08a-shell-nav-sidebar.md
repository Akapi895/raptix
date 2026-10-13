# 08a: Shell nav model and sidebar extraction

**What to build:** Extract the navigation model (`NAV`, wide-page rule, badge counts) and the `Sidebar` (desktop rail, mobile drawer, keyboard roving, collapse toggle) from `src/shell.tsx` into `src/shell/nav.ts` + `src/shell/sidebar.tsx`. `src/shell.tsx` imports them back — behavior, classes and markup are moved verbatim, not redesigned.
**Blocked by:** 07.
**Status:** resolved
**Owner:** Layout composition; part of the ticket 08 split (umbrella: [08](08-shell-layout.md)).
**Contract:** [execution.md](../execution.md).

- [x] `NAV` groups/aliases and active-section highlighting are unchanged (match arrays stay nav aliases, not routes).
- [x] Sidebar collapse toggle, mobile drawer Escape/overlay close and arrow/Home/End keyboard roving work as before, without duplicating store state.
- [x] Leaf diff fits the cap (~120 runtime lines, ≤3 files); `npm run typecheck`, `npm run lint`, `npm test -- --run`, `npm run build` stay green.

## Evidence

- Commit `refactor(web-improve): shell nav model and sidebar extraction (ticket 08a)`: `src/shell/nav.ts` (NAV/WIDE_PAGES/`isWide`/`useBadges` + nav-alias note from the route inventory), `src/shell/sidebar.tsx` (verbatim), `src/shell.tsx` imports them back.
- Rendered checks in `src/shell/shell.test.tsx`: all groups/items render, `aria-current` highlighting for command-center/operation detail/project detail, collapse 248px↔72px, drawer overlay+Escape, Arrow/Home/End roving.
- At this leaf: typecheck clean, lint 222/0 (below the 226 baseline), 123/123 tests, build green.
