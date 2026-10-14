# 32: Finding forms, lifecycle and AI draft import

**What to build:** Migrate finding create/edit/review/remediation/retest transitions and attachment actions to validated forms and real scoped handlers.
**Blocked by:** 31.
**Status:** resolved
**Owner:** Finding lifecycle/write handlers.
**Contract:** [execution.md](../execution.md).

- [x] Draft → review → confirmed → remediation → retest → resolved and return paths enforce current role/state policy at the handler.
- [x] Forms validate severity/technique/evidence, track dirty state and preserve drafts on submission failure.
- [x] AI suggestions import as drafts only; evidence attachment checks compatible project scope and masking.
- [x] Report/project/legacy consumers observe transitions; baseline proposal regressions stay green with new refusal cases.
- [x] Split into bounded tracker leaves before coding (diff exceeded the cap as one leaf).

## Evidence

- **Split:** the leaf measured ~481 runtime lines as a single unit — over the ≤400-line cap — so it was split into bounded leaves [32a](32a-finding-forms-lifecycle.md) (forms, lifecycle transitions, AI draft import; ~363 runtime lines) → [32b](32b-finding-evidence-retest.md) (evidence attachment/upload and retest recording; ~121 runtime lines; the completion leaf, which now owns the outgoing blockers of 33/34). Each leaf landed as its own green commit on `wi/32-findingforms`.
- **Invariants:** invariant 5 (AI proposals) is enforced at the handler — the `TRANSITIONS` map gives `ai_suggested` no route except `draft` and the AI's only write path is the draft import, so no caller can publish a suggestion; requirement 33's role/state gates and the evidence scope/masking rules live in the handlers, never the screen (site table row 5: tickets 32/38/40).
- **Verification:** full battery green at both leaves — `npm run typecheck` clean, `npm run lint` 219 warnings / 0 errors (baseline 219), `npm test -- --run` 291/291 (268 baseline + 23 new), `npm run build` green. Bridge proven both directions: a service write is observed by the legacy store (same db authority) and a legacy write is observed by the typed read.
- **Gaps:** report attachment stays with the bridged legacy actions until ticket 36; evidence inspector masking facets are ticket 33's scope.
