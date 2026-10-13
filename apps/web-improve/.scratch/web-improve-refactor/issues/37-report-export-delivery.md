# 37: Report export and delivery records

**What to build:** Migrate simulated PDF/DOCX export and recipient handover to separate canonical audited actions bound to approved report versions.
**Blocked by:** 36.
**Status:** resolved
**Owner:** Export/delivery service and UI.
**Contract:** [execution.md](../execution.md).

- [x] Export requires an eligible approved version; existing simulated export checksums remain on export records, not preview content.
- [x] Delivery requires a valid export of that exact version, recipient and confirmation; export alone is not delivery.
- [x] Actor/reason/timestamp/version and handover history persist; unauthorized/stale-version attempts are refused.
- [x] Project closure consumers observe delivery through the shared authority; full reporting routes no longer need legacy state.

## Evidence

- Handlers (`src/features/reports/service.ts`, one owner — ticket 36 built the export/delivery chain, 37 closes the
  enforcement gaps and retires the legacy mutation path):
  - `DeliveryInput.confirm` — the handover confirmation is now a handler gate (`deliverReportVersion` refuses with
    `Confirm that the handover happened before marking delivery.` after the recipient check); the screen's checkbox
    feeds it. A refused unconfirmed attempt commits nothing: the export record stays `Completed`/unclaimed and no
    audit row lands.
  - Handover history persists on the delivered export records (`ExportRec.deliveredBy`/`deliveredAt` — the delivery
    actor and its own instant, distinct from the export stamp; append-style fields in `src/domain/entities.ts`) plus
    recipient/channel/notes (36), and the immutable audit row carries actor/reason/timestamp with the version on the
    record. `readReportReview` resolves `deliveryAuditId` so the review screen never inspects `db.audit` directly.
  - Stale-version refusal: delivery requires an export of the *exact* current version — an export of v1.0 cannot
    deliver a resubmitted+re-approved v1.1 (validated refusal; the stale record is untouched until a fresh export of
    the new version exists). Export stays bound to the eligible approved version (36's state gate), checksum on the
    record only.
- Legacy actions retired from raw mutation (`src/store.tsx`): `A.exportReport`/`A.deliverReport` now delegate to
  `exportReportVersion`/`deliverReportVersion` (ticket-19 `createProject` delegation pattern; `deliverReport` takes
  the full `DeliveryInput` so the confirmation gate is universal — it had zero remaining callers). Both publish the
  ChangeSet the `report-export` Query keys refetch; the review route's remaining legacy read (`db.audit`) moved into
  the typed read model, so full reporting routes read service contracts only.
- Closure consumer: `closureChecklist` (store.tsx c3 "Final report approved and delivered") observes a typed
  approve→export→deliver chain through the shared authority — proven by a handler test; ticket 02's
  `src/safety/closure-facets.test.tsx` (15 tests) stays green.
- Tests: `src/features/reports/review.test.tsx` +5 (21 total in file) — confirmation gate with nothing-committed
  proof, stale-version delivery refusal + fresh-export path, handover history persistence (actor/instant distinct
  from export/notes/version + audit row + `deliveryAuditId` on the read), closure-consumer observation, and the
  legacy→new bridge (legacy export refetches the typed delivery history with the checksum on the record; legacy
  deliver records the handover with `deliveredBy`). Ticket 36's deliver inputs updated for the new `confirm` field.
- Checks: `npm run typecheck` clean (0 new) · `npm test -- --run` 599 passed (43 files; baseline 594 + 5) ·
  `npm run lint` 217 warnings / 0 errors (baseline) · `npm run build` ok.
- Gaps: preview HTTP smoke skipped per Windows temporary-process safety allowance (server lifecycle not managed from
  this session); route-level success/refusal behavior covered by rendered-screen tests instead.
