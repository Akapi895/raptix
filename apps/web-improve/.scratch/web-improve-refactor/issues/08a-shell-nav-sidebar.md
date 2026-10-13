# 08a: Shell nav model and sidebar extraction

**What to build:** Extract the navigation model (`NAV`, wide-page rule, badge counts) and the `Sidebar` (desktop rail, mobile drawer, keyboard roving, collapse toggle) from `src/shell.tsx` into `src/shell/nav.ts` + `src/shell/sidebar.tsx`. `src/shell.tsx` imports them back — behavior, classes and markup are moved verbatim, not redesigned.
**Blocked by:** 07.
**Status:** ready-for-agent
**Owner:** Layout composition; part of the ticket 08 split (umbrella: [08](08-shell-layout.md)).
**Contract:** [execution.md](../execution.md).

- [ ] `NAV` groups/aliases and active-section highlighting are unchanged (match arrays stay nav aliases, not routes).
- [ ] Sidebar collapse toggle, mobile drawer Escape/overlay close and arrow/Home/End keyboard roving work as before, without duplicating store state.
- [ ] Leaf diff fits the cap (~120 runtime lines, ≤3 files); `npm run typecheck`, `npm run lint`, `npm test -- --run`, `npm run build` stay green.
