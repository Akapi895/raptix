# 08e: Shell root composition and compatibility barrel

**What to build:** Extract the shell root (`Shell`, loading state, global modals, toasts) into `src/shell/shell.tsx`, accepting the header/drawer slot props for tickets 59/60; reduce `src/shell.tsx` to a thin compatibility re-export barrel so screen imports keep resolving. Renders the required shell tests.
**Blocked by:** 08d.
**Status:** ready-for-agent
**Owner:** Layout composition; completion leaf of the ticket 08 split (umbrella: [08](08-shell-layout.md)).
**Contract:** [execution.md](../execution.md).

- [ ] Sidebar renders all nav groups and highlights the active section for command-center, operation detail and project detail.
- [ ] Project switcher switches scope with the isolation invariant intact; collapse toggle and mobile Escape/close behavior preserved.
- [ ] Emergency-stop control rendered at 768/1024/1280/1440 breakpoint classes in light/dark.
- [ ] `npm run typecheck` (0 new), `npm run lint` (≤226), `npm test -- --run` (123 existing + new), `npm run build` green.
- [ ] Outgoing blockers transferred here: 09 (primitives) is blocked by this leaf.
