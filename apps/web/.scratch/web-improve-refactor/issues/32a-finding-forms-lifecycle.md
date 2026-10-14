# 32a: Finding forms, lifecycle and AI draft import

**What to build:** Migrate finding create/edit forms and the 6-stage lifecycle transitions (draft → review → confirmed → remediation → retest → resolved, plus the return path) to validated typed handlers and the screen wiring; AI suggestions import as DRAFTS only.
**Blocked by:** 31.
**Status:** resolved
**Owner:** Finding lifecycle/write handlers; part of the ticket 32 split (umbrella: [32](32-finding-forms-lifecycle.md)).
**Contract:** [execution.md](../execution.md).

- [x] Draft → review → confirmed → remediation → retest → resolved and return paths enforce current role/state policy at the handler.
- [x] Forms validate severity/technique/evidence, track dirty state and preserve drafts on submission failure.
- [x] AI suggestions import as drafts only (invariant 5 at the handler, not the screen).
- [x] Report/project/legacy consumers observe transitions; baseline proposal regressions stay green with new refusal cases.
- [x] Leaf diff fits the cap (~363 runtime lines, 5 files); typecheck, lint, tests and build stay green.

## Evidence

- **Handlers** (`src/features/findings/service.ts`): `saveFinding` (create/edit in one atomic commit — content, evidence links, severity rationale and the optional submit share one corr), `transitionFinding` (one lifecycle move; refusal order: out-of-scope → not-found without existence leak, cross-project context → forbidden with the owning project, read-only context → forbidden, illegal from→to pair → conflict, then the role matrix, then the stage's own validation), `importFindingSuggestion` (delegates to the `draft` transition — the AI's only write path). The `TRANSITIONS` map encodes requirement 33 structurally: `ai_suggested` has no route except `draft`, so no caller can make the AI publish. `saveValidationFailure` re-checks the form inline (defense in depth; unified so create+submit and edit+submit both require ≥1 evidence).
- **Query binding** (`src/features/findings/query.ts`): `useFindingWrites()` captures actor/project at call time — a persona or project switch never retargets an in-flight write — and every commit publishes one ChangeSet that the bridge turns into refetches for Query views and the legacy store.
- **Screen** (`src/screens/e-findings.tsx`): `FindingForm.persist` saves/submits through `writes.save` (a refusal returns without navigating — the draft stays in the form with the failure banner above it); `FindingDetail` transitions run through `runTransition` with handler-refusal reasons surfaced; the AI "Verify & create finding" confirm imports the suggestion as a draft for curation instead of publishing it to review.
- **Tests** (18 new in `src/features/findings/writes.test.tsx`): save validation (sparse drafts, submit requirements incl. asset-scope/technique/evidence), role gates per transition (analyst/operator submit, reviewer-only confirm/return, viewer denied, non-member not-found, closed-project read-only), the invariant-5 map assertions, bridge both directions (service write observed by legacy store; legacy write observed by the typed read), mid-flight write surviving a scope cancel, and the form screen blocking a bad submit while preserving typed content.
- **Verification:** `npm run typecheck` clean (0 new), `npm run lint` 219 warnings / 0 errors (baseline 219), `npm test -- --run` 286/286 (268 baseline + 18 new), `npm run build` green. Baseline invariant regressions (`ai-proposals.test.tsx`) stay green with the legacy `A.setFindingStatus` path untouched.
