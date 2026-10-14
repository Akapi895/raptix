# 08e: Shell root composition and compatibility barrel

**What to build:** Extract the shell root (`Shell`, loading state, global modals, toasts) into `src/shell/shell.tsx`, accepting the header/drawer slot props for tickets 59/60; reduce `src/shell.tsx` to a thin compatibility re-export barrel so screen imports keep resolving. Renders the required shell tests.
**Blocked by:** 08d.
**Status:** resolved
**Owner:** Layout composition; completion leaf of the ticket 08 split (umbrella: [08](08-shell-layout.md)).
**Contract:** [execution.md](../execution.md).

- [x] Sidebar renders all nav groups and highlights the active section for command-center, operation detail and project detail.
- [x] Project switcher switches scope with the isolation invariant intact; collapse toggle and mobile Escape/close behavior preserved.
- [x] Emergency-stop control rendered at 768/1024/1280/1440 breakpoint classes in light/dark.
- [x] `npm run typecheck` (0 new), `npm run lint` (≤226), `npm test -- --run` (123 existing + new), `npm run build` green.
- [x] Outgoing blockers transferred here: 09 (primitives) is blocked by this leaf.

## Evidence

- Commit `refactor(web-improve): shell root composition, compatibility barrel and layout tests (ticket 08e)`: `src/shell/shell.tsx` (Shell + `ShellSlots`, GlobalModals, Toasts, LoadingState) and `src/shell.tsx` reduced to a thin compatibility barrel (872 → 12 lines).
- 12 new rendered tests in `src/shell/shell.test.tsx` cover the four criteria above; ticket-02 suites stay green.
- Final verification: `npm run typecheck` clean (0 new), `npm run lint` 224 warnings / 0 errors (≤226 baseline), `npm test -- --run` 135/135 (123 existing + 12 new), `npm run build` green.
- Real-app: `vite preview` on the production build → HTTP 200 with root div; the served JS chunk contains the shell markers (Main navigation, Emergency Stop, Select project, Ask AI, Collapse sidebar, Skip to main content). Interactive browser walkthrough not available in this environment — reported as a gap; structure-level verification only.
