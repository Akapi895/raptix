# 08b: Shell project switcher and global search extraction

**What to build:** Extract the `ProjectSwitcher` (scope selection, search/filters, access gating, isolation invariants) and the `GlobalSearch` command palette from `src/shell.tsx` into `src/shell/project-switcher.tsx` + `src/shell/search.tsx`, moved verbatim.
**Blocked by:** 08a.
**Status:** resolved
**Owner:** Layout composition; part of the ticket 08 split (umbrella: [08](08-shell-layout.md)).
**Contract:** [execution.md](../execution.md).

- [x] Switcher scope changes flow through the shared active-project authority (`setPid`); project isolation and dirty-guard behavior are intact (ticket 02 suite stays green).
- [x] Search hits, recents, keyboard operation (↑↓/↵/Esc, Ctrl/Cmd+K) and per-group limits are unchanged.
- [x] Leaf diff fits the cap (~185 runtime lines, ≤3 files); full check suite stays green.

## Evidence

- Commit `refactor(web-improve): shell project switcher and global search extraction (ticket 08b)`: `src/shell/project-switcher.tsx` + `src/shell/search.tsx` moved verbatim; `shell.tsx` imports them back and drops now-unused imports.
- Rendered checks in `src/shell/shell.test.tsx`: scope switch through `setPid` (All Projects → RT-2026-014), disabled "No access" rows for a scoped persona on the All tab.
- At this leaf: typecheck clean, lint 222/0, 123/123 tests (isolation suite green), build green.
