# 67-typed-runtime: Typed runtime reads and owning-service writes

**Status:** in-progress.
**Owner:** `wi/67-typed`, base `b46ce97`; runtime screens/shell/features/auth/console only.
**Contract:** execution.md lines 48–59; ADR-0067. Parent 67 retains completion blockers.

Serial split ledger, created before implementation. Each leaf is one concern,
<=400 changed runtime lines and <=10 files; subdivide a leaf before exceeding it.

1. Authorization identity: narrow synchronous persona/project reads; override-aware
   Query scope and captured request actors; cancel superseded role scopes.
2. Audit/notification writes: typed service transactions and bounded caller batches.
3. Project/team and operation recovery/evidence writes: owning transactions,
   preserving guards, reasons, atomic publication and request scope.
4. Shell views: service-owned scoped search, badges, notices, context and switcher projections.
5. Project/wizard supplementary reads: existing Query models plus narrow synchronous projections.
6. Operation supplementary reads: list/draft/preflight and console subviews, in separate batches.
7. Fleet/catalog supplementary reads: agents/assets/library, separate feature batches.
8. Findings/report supplementary reads: separate feature batches.
9. AI supplementary reads: plans/chat/branches/workers/trace, separate feature batches.
10. Settings/analysis/estop supplementary reads: separate feature batches.
11. Final residual census, full typecheck/lint/test/build and parent-67 evidence.

Existing tests, `src/test/*` and `src/store.tsx` are owned by another worker.
New regression tests use distinct filenames. No integration checkout or push.
