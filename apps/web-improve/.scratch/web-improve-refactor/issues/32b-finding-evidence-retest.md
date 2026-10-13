# 32b: Finding evidence attachment and retest recording

**What to build:** Migrate evidence link/upload and retest recording to typed scoped handlers and the tab wiring: attachment checks compatible project scope and masking; a retest observation records its outcome in one commit (Resolved closes the finding; a failed retest from `retest` returns it to remediation).
**Blocked by:** 32a.
**Status:** resolved
**Owner:** Finding lifecycle/write handlers; part of the ticket 32 split (umbrella: [32](32-finding-forms-lifecycle.md)).
**Contract:** [execution.md](../execution.md).

- [x] Evidence attachment checks compatible project scope and masking.
- [x] Retest recording writes the observation and its outcome in one commit through the typed handler.
- [x] Leaf diff fits the cap (~121 runtime lines, 4 files); typecheck, lint, tests and build stay green.

## Evidence

- **Handlers** (`src/features/findings/service.ts`): `attachFindingEvidence` (opaque reference matched by equality against the finding's own project records; refuses cross-project references and evidence another finding holds; sensitive captures need `viewSensitive`), `uploadFindingEvidence` (the capture's scope is derived from the finding, never claimed by the caller; record + link in one commit), `recordFindingRetest` (observation + outcome in one commit; gated to confirmed+ stages, `Resolved` closes, a failed retest from `retest` returns to remediation with the reason in the history). Evidence references are never parsed or dereferenced by the console.
- **Query binding** (`src/features/findings/query.ts`): `useFindingWrites()` gains `attachEvidence` / `uploadEvidence` / `recordRetest` with the same call-time context capture and single ChangeSet publication as 32a.
- **Screen** (`src/screens/e-findings.tsx`): the Evidence tab's Link button and Upload modal run through the typed writes with handler-refusal banners; the Retest tab records through `writes.recordRetest` (failure renders above the form, the stage/role gate copy unchanged).
- **Tests** (5 new in `src/features/findings/writes.test.tsx`): cross-project and already-linked refusals, viewer denial, upload landing inside the finding's own project with the audit row, Resolved-closes and failed-retest-returns flows, and the stage/note/role gates.
- **Verification:** `npm run typecheck` clean (0 new), `npm run lint` 219 warnings / 0 errors (baseline 219), `npm test -- --run` 291/291 (268 baseline + 23 new), `npm run build` green.
