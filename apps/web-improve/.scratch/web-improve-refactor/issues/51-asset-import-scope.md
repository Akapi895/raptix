# 51: Asset import and scope revision

**What to build:** Migrate manual/bulk import and scope proposals through asset handlers that consume 21's governance transaction interface.
**Blocked by:** 50, 21.
**Status:** resolved
**Owner:** Asset import/scope orchestration; project invalidation stays owned by 21.
**Contract:** [execution.md](../execution.md).

- [x] Import validates rows and saves proposed assets as pending; invalid/duplicate/error rows are reported without partial hidden acceptance.
- [x] For an approved scope, revision submission immediately expires approved plans/resets ready operations via the canonical governance transaction.
- [x] Pending additions cannot be selected as targets until independent approval; approval does not delay invalidation to that moment.
- [x] Tests exercise the actual asset → governance → operation/plan path and observe both legacy and migrated consumers.

## Implementation

Write-side handlers in `src/features/assets/writes.ts` (ADR-0067, ticket 21's transaction + portfolio-handlers patterns):

- `validateAssetRows` — the one pure row validator (name, non-empty type, identifier syntax per `validateIdent` — moved verbatim from the screen — and duplicates against the project's committed assets and within the batch; duplicate detection fires only on otherwise-valid rows). The import preview's err/dup/keep columns derive from the same validator the transaction enforces. The type vocabulary is intentionally open (the catalog hosts `Database`, `Web server`, … beyond the select options), so only an empty type is a row error.
- `importAssetsTransaction` — all-or-nothing: project resolution (`not-found`), read-only and `editScope` role gates with reasons, empty-selection and per-row validation BEFORE anything commits; one invalid/duplicate row refuses the whole batch with the first three rows' reasons (kind `validation`, "Nothing was committed") and leaves the dataset byte-identical. A valid batch is ONE atomic commit through ticket 21's `reviseScopeTransaction` (the canonical governance transaction): imported assets land `pending` (`out` rows stay `out`), and on a governed scope the submission invalidates immediately — ROE bump, approval re-lock, approved-plan expiry, ready-operation reset with preflight cleared. Returns the revision outcome (`invalidated`, `roeVersion`, `plansExpired`, `operationsReset`, `needsApproval`).
- `changeAssetScopeTransaction` — one scope change per asset: foreign asset → `not-found` (no existence leak); accessible asset outside the active project context → `forbidden` naming the owning project; read-only context and role gate (`editScope`, or `approve` for the review decision) refuse with reasons; same-scope → `conflict`. Commits the flip + audited reason in one ChangeSet; a `pending` proposal under a governed ROE opens the scope-change request in the SAME commit when none is open and the ROE essentials hold (second proposals ride the open review), and the asset never auto-promotes.
- `createAssetWriteHandlers(svc, actor, scopeProject)` — screen-facing handlers with call-time contexts (persona/project switch never retargets a mutation).

Wiring: legacy `A.addAssets` delegates to `importAssetsTransaction` (now `{ ok, needsApproval, error }`), `A.setAssetScope` delegates to `changeAssetScopeTransaction` (the handler owns the audit; the delegated change publishes ONE ChangeSet instead of the old mutate+audit pair — `domain/bridge.test.tsx` re-pointed accordingly). Screens (`d-assets.tsx`) call the typed handlers via `useMutation`: manual/bulk/discovery import, bulk out-of-scope, scope-review approve/reject, and the detail propose/out actions; refusals surface as bad toasts with the handler's reason, and the import preview errors come from the shared validator.

Dispatch note: the dispatch referenced "asset tags/notes"; the tracker leaf for 51 is import + scope revision and the asset domain has no tags/notes entity (the manual form's labels/note fields were write-nowhere legacy UI before and after this ticket). The "validated + role-gated with reasons" requirement maps to the row validation above and the audited reasons on every gated write.

## Evidence

- `npm run typecheck` — 0 errors (0 new diagnostics).
- `npm run lint` — 0 errors, 203 warnings (baseline 204; the retired screen-local `validateIdent` export removes a react-refresh warning, none added).
- `npm test -- --run --maxWorkers=4` — 649 passed (638 baseline + 11 new in `src/features/assets/writes.test.tsx`; unbounded parallel runs intermittently time out unrelated suites on this machine — every suite passes in bounded/isolated runs). Baseline re-points: `domain/bridge.test.tsx` expects the delegated scope change as ONE ChangeSet.
- `npm run build` — succeeds.
- Import atomicity proof: an invalid batch (invalid IP, duplicate of an existing asset, in-batch duplicate, missing name alongside a valid row) is refused with `4 of 5 rows cannot be imported (…). Nothing was committed.` and the full dataset snapshot is byte-identical; a valid batch publishes exactly ONE ChangeSet carrying asset/project/plan/operation/approval/notice/audit with `plansExpired: ['PL-021']` and the ready op reset with preflight cleared.
- Pending-until-approval proof: an imported `in` row lands `pending`; an operation targeting it fails PRE-03 ("Assets outside the allowed scope"); the independent reviewer's `decideApprovalTransaction` admits it to `in` and PRE-03 turns pass — while the ROE bump/plan expiry already happened at submission (`ROE-014-v3`, `needsApproval: true`).
- Bridge both directions: a direct `importAssetsTransaction` commit is observed by the legacy store context (asset pending, audit row, same snapshot identity); legacy `A.addAssets` and the typed handler's import/scope change both refetch the ticket-50 catalog Query views without a reload (`22 records` / `16 records`) and the typed scope read observes the committed classification.
- Role gates with reasons: analyst/viewer imports and scope changes refuse `forbidden` naming the role or read-only context; foreign-project scope change refuses with the owning project on the entity; same-scope refuses `conflict`; unknown asset `not-found` — all leaving the snapshot unchanged.
- Budget: 5 touched files (2 new: `writes.ts` 235 lines incl. docs, `writes.test.tsx`), ~290 net runtime lines.
- Browser route verification: **gap** — preview HTTP check skipped per AGENTS.md § Windows Temporary Process Safety; UI behavior covered by the component-level tests above (screen mutations through the real routes via Query providers).
