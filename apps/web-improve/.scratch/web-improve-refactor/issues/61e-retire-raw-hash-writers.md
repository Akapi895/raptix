# 61e: Retire the last raw hash-location writers

**What to build:** Convert the two remaining out-of-router location writes (route-inventory "Known raw reads/writes outside the router" — the owning tickets 35–37/41–42 are resolved but two writers remain) to the single-writer navigation seam, in the screens that still carry them:
- `src/screens/f-report.tsx:25` — `hardGo` writes `window.location.hash = toHash(...)` directly (report preview/review flows).
- `src/screens/g-common.tsx:201` — `useTraceLink` writes `window.location.hash = '#/ai-trace/<id>'` directly.
Both must navigate through the store's guarded `go`/router (the dirty-guarded single writer) or be deleted if their callers are already on `go`. These are live single-writer violations, not wrappers: contraction batch B (66) must not delete or rewrite them blindly, so this leaf blocks 66.
**Blocked by:** 61 (discovered by ticket 61's route-coverage closure; the two writers post-date the resolved f/g feature tickets).
**Status:** ready-for-agent
**Owner:** Route single-writer closure; flagged by the ticket 61 coverage audit.
**Contract:** [execution.md](../execution.md).

- [ ] No screen module writes `window.location.hash` / `location.assign` / `history.replaceState` outside `src/router/`; the route inventory's raw-reads list is empty.
- [ ] The affected report/trace flows still navigate with the addressed entity identity preserved (rendered regression at the call site).
- [ ] Diff fits the cap; typecheck/lint/test/build stay green.
