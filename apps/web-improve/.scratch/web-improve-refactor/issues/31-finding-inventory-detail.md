# 31: Findings inventory and detail reads

**What to build:** Migrate findings list/detail reads, severity breakdowns, history and linked evidence through typed services, retaining mutation compatibility until 32.
**Blocked by:** 13.
**Status:** resolved
**Owner:** Finding read models and evidence-tab presentation.
**Contract:** [execution.md](../execution.md).

- [x] Search/severity/status filters/pagination/counts reflect scoped canonical records, including AI suggestions as proposals.
- [x] Detail history/metadata and evidence list apply role-sensitive masking and not-found/forbidden handling.
- [x] Evidence references remain opaque; UI does not present recorded claims as proven exploitability.
- [x] Existing create/review links remain functional via the bridge; a legacy status change updates the new views.

## Evidence

- `src/features/findings/service.ts` — typed read model: `listFindings` (scoped aggregate with search/severity/status/owner/asset/op filters, live counts via `core` projection that excludes severity+status dims, verified-only severity KPIs, dismissed excluded only from the AI tab, page size 10 with clamp) and `getFinding` (project-scoped access, `not-found` without existence leaks, `forbidden` with `entity.projectId` for cross-context refs, role-sensitive evidence masking via `policyCan(ctx.actor,'viewSensitive',project)` returning `EvidenceView`s with opaque refs).
- `src/features/findings/query.ts` — feature-local Query keys (`consoleKeys.view/entity('finding', …)`) and `useFindingList`/`useFindingDetail` hooks with per-request `RequestContext` (actor, project, correlation id).
- `src/screens/e-findings.tsx` — `FindingList`/`FindingDetail`/`EvidenceTab`/`EvidencePreview` now read through the hooks; tabs/KPIs render from `data.counts`/`data.severity`; `FindingDenied` switches on `failure.entity.projectId`; masking renders "Restricted name" for viewers without `viewSensitive`; confidence copy states linked evidence is "a recorded claim, not proven exploitability" and the evidence tab states links are opaque references needing reviewer verification. Forms/lifecycle stay on the legacy store (ticket 32); evidence inspector route untouched (ticket 33).
- Bridge: legacy `A.setFindingStatus` → authority commit publishes ChangeSet kind `finding` → `['finding']`-prefixed keys invalidate → list and detail refetch without reload (covered by a test).
- `src/safety/ai-proposals.test.tsx` — FD-012 safety test updated to flush Query's notifications under fake timers (`vi.advanceTimersByTimeAsync(0)` inside `act`).
- `src/domain/service-factory.ts` — append-only `findings` wiring following the ticket-24 pattern (superseded-scope guard included). Also replaced a single NUL byte inside the pre-existing `scopeKey` template literal that arrived with the d6fe526 merge: it made git treat the file as binary in every diff (unreviewable). No behavior change; the file diffs as text after this merges.
- Tests: 17 new in `src/features/findings/query.test.tsx` (scoped list + counts, filters, pagination, masking by role, not-found, cross-project refusal + switch prompt, AI-proposal presentation, bridge proof, link compatibility; plus 8 handler tests for ai-excluded severity, dismissed semantics, denials, page clamp, masking, forbidden entity, step resolution). Full suite 268/268 across 23 files; `tsc --noEmit` clean; lint 219 warnings (budget ≤221, none from touched files); `vite build` green.
