# 53: Independent playbook revision review

**What to build:** Migrate revision submit/approve/return to real handlers enforcing author independence and pinned active versions.
**Blocked by:** 52.
**Status:** resolved
**Owner:** Playbook version/review policy.
**Contract:** [execution.md](../execution.md).

- [x] Submitting a revision preserves the approved active version and shows pending-review metadata.
- [x] Real handlers reject author self-review, wrong role/state and invalid decisions; return records actionable notes.
- [x] Independent approval activates the reviewed version; pending revisions are never executable selections.
- [x] Operation wizard/preflight consumers observe canonical version eligibility and baseline UI checks migrate to actual enforcement tests.

## Implementation

- **Write handlers** (`src/features/library/service.ts`, feature-local append): `proposeRevision` (role-gated `editScope`; refuses non-approved state and an already-pending revision with `conflict`; validates a strict `maj.min` version bump above the active version, a non-empty changelog, steps and ATT&CK catalog technique ids before one atomic commit that records `revision` metadata only — the approved active version is untouched and stays in use), `submitForReview` (draft → `review` state transition, never a version change), and `decideRevision` (refusal order: sharing scope → `not-found` without existence leak, nothing pending → `conflict`, invalid decision value → `validation`, `reviewPlaybook` role or the author themself → `forbidden`, missing reason → `validation`). Approval promotes the reviewed version (`version`/`steps`/`techniques`, status `approved`, candidate cleared) — operations already pinned to the previous version stay pinned. A return clears the candidate, never touches an approved active version, and records the reviewer's note in the audit log plus a notice addressed to the author (actionable note). Every write publishes one ChangeSet from the factory clock.
- **Review policy:** `reviewPlaybook(actor)` names the shared `approve` action (Reviewers + Admins) as the one gate, reused by the handler and the screen affordance; `decideGate` computes the per-actor reason (role first, then author independence) for both the queue rows and the screen.
- **Review queue read:** `reviewQueue` over the actor-visible sharing base (52's rule), one row per playbook with something pending (revision or initial version), carrying the pending metadata and the handler-computed decide gate.
- **Query binding** (`src/features/library/query.ts`): `usePlaybookReviewQueue` (key `['playbook', scope, 'review-queue']`, kind-prefixed so any committed tradecraft change refetches it) and `usePlaybookReview` write binding (propose/submit/decide; ctx captured at call time; explicit ServiceResult to the caller).
- **Screens** (`src/screens/d-library.tsx`): `PlaybookReview` migrated off the legacy store — detail via `usePlaybookDetail`, decisions via the typed writes through the existing reason-required confirm dialogs, propose form (version + changelog) on the review route for approved playbooks without a pending revision, submit-for-review card for drafts, and the review queue when deep-linked without an id. No component inspects the database directly anymore. `PlaybookDetail`'s entry points (Review Playbook / Compare Versions / banners) unchanged.
- **Factory** (`src/domain/service-factory.ts`): one line — `createLibraryService` now receives the factory clock for the review writes. No interface or wiring change beyond that.

## Evidence

- `npm run typecheck` — clean (0 new diagnostics).
- `npm run lint` — 217 warnings (budget ≤217, 0 new).
- `npm test -- --run` — 559 passed (546 baseline + 13 new in `src/features/library/review.test.tsx`).
- `npm run build` — success.
- Required tests (all in `src/features/library/review.test.tsx`):
  - Proposal validation: version not a bump / bad format / empty changelog / unknown technique → `validation`; already-pending and draft-state proposals → `conflict`; a valid proposal leaves the active version approved and records pending metadata + audit + notice.
  - Decision gates: manager role → `forbidden` ("Only Reviewers and Admins…"), author self-review → `forbidden`, empty reason → `validation`, unknown decision value → `validation`, nothing pending → `conflict`; all without committing.
  - Approval activates the reviewed version (v2.4 active, candidate cleared, steps 13, audit reason recorded); a return records the actionable note (audit + author notice) and keeps v2.3 active.
  - Screen: independent reviewer approves the seeded revision through the confirm dialog → detail shows `PB-001 · v2.4` with `Steps (13)` and the pending banner cleared; the legacy store observes the same snapshot (service→legacy bridge).
  - Screen gate: wrong role sees the Locked reason with both decision buttons disabled.
  - Screen propose form: invalid version refused with the handler reason; valid proposal shows `Pending v1.2` while v1.1 stays approved and active.
  - Bridge both directions: legacy `A.setPlaybookStatus('PB-004','review')` appears in the new review queue without a reload; a typed service decision drops the row from the queue and updates the legacy store.
  - Cross-project refused: a non-member's propose/decide on `Project RT-2026-015`-shared PB-003 → `not-found`, no audit row, no state change.
  - Canonical eligibility: operation draft options expose the active version only — a pending revision (v1.2 while v1.1 active) is never selectable, approval makes v1.2 selectable, and a never-approved draft never appears (wizard/preflight consumer check, ticket 25/26 seam).
- Review budget: 4 runtime files touched (+2/+56/+269/+71 net = ~398 runtime lines), 5 files total; one concern.
- Preview HTTP check skipped per AGENTS.md § Windows Temporary Process Safety (process safety gap; route-level behavior covered by the mounted route-host tests above).
- Browser gap: real-browser click-through of the review route and light/dark + width sweep not exercised; in-app flows (queue → review → decide → detail, propose validation refusal) are covered by the route-host tests.
