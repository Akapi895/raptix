# 29: Operation overview and live console

**What to build:** Migrate operation overview/live step logs and the human review-required gate to canonical reads/control services.
**Blocked by:** 28.
**Status:** resolved
**Owner:** Live operation workspace and step-review handlers.
**Contract:** [execution.md](../execution.md).

- [x] Live steps/logs/status update from real simulation events; missing/stale data is shown honestly.
- [x] AI cannot approve/skip/reject human-gated steps; handlers independently reject unauthorized decisions.
- [x] Stop/failure/unknown banners, controls and evidence links remain scoped and usable with keyboard/light/dark layouts.
- [x] Live route exercise covers allowed progress, review blocking and emergency stop; remaining detail tabs stay bridged.

## Evidence

- Handler: `reviewOperationStep` in `src/features/operations/service.ts` (appended ticket-29 section) — role/read-only/run-state/step-in-review/note gates re-derived at the handler with typed refusal reasons; the step outcome and its audit row commit in ONE atomic ChangeSet (`authority.commit` publishes entity kinds `operation` + `audit`). `lifecycleGate` gained additive default message params (`rolePhrase`/`readonlyPhrase`) so review refusals read naturally ("Only a Manager or Operator can decide on review steps.").
- Screen: `ConsoleTab.decide()` in `src/screens/c-console.tsx` now calls the typed mutation `useReviewStep()` (`src/features/operations/query.ts`); refusals surface the handler's reason as a toast and record nothing. The legacy bridge entry `A.reviewStep` in `src/store.tsx` delegates to the same handler, keeping only the display-only live-log mirror — one implementation both ways.
- Derivation: the live workspace renders from the one canonical read (`useOperationDetail`); typed 27-transitions (pause), review decisions, the legacy bridge (A.pauseOp/A.resumeOp/A.reviewStep) and the emergency-stop propagation (request → acknowledge → finalize) all repaint it through ChangeSet-driven refetch, no reload.
- Tests: `src/features/operations/workspace.test.tsx` — 10 tests (3 handler: per-decision one-ChangeSet commit; unauthorized/out-of-scope/unknown-op refusals with nothing committed; paused op / wrong step / missing step / missing-note refusals; 7 screen: derivation + approve, viewer blocked with reason, typed pause reflects + review refused while paused, legacy-bridge acceptance, estop propagation, step/evidence links resolve into migrated routes — technique T1119 → technique page, evidence EV-014-01 → operation Results tab — and delayed-response isolation: the superseded Taylor/'all'-scope read is gated past a persona switch and its cache entry never gains data).
- Verification: `npm run typecheck` clean; `npm test -- --run` 747/747 green (52 files, baseline 737 + 10 new); `npm run lint` 203 warnings + 6 pre-existing errors (generated `.ua/.trash-*`, at baseline); `npm run build` succeeds. Budget: 4 runtime files modified + 1 test file, ~133 runtime lines.
