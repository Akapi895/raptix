# 08b: Shell project switcher and global search extraction

**What to build:** Extract the `ProjectSwitcher` (scope selection, search/filters, access gating, isolation invariants) and the `GlobalSearch` command palette from `src/shell.tsx` into `src/shell/project-switcher.tsx` + `src/shell/search.tsx`, moved verbatim.
**Blocked by:** 08a.
**Status:** ready-for-agent
**Owner:** Layout composition; part of the ticket 08 split (umbrella: [08](08-shell-layout.md)).
**Contract:** [execution.md](../execution.md).

- [ ] Switcher scope changes flow through the shared active-project authority (`setPid`); project isolation and dirty-guard behavior are intact (ticket 02 suite stays green).
- [ ] Search hits, recents, keyboard operation (↑↓/↵/Esc, Ctrl/Cmd+K) and per-group limits are unchanged.
- [ ] Leaf diff fits the cap (~185 runtime lines, ≤3 files); full check suite stays green.
