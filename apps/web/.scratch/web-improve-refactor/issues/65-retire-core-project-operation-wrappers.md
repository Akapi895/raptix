# 65: Retire core/project/operation compatibility wrappers

**What to build:** Remove remaining zero-caller wrappers/registries from the core/project/operation legacy groups after definitions were retired incrementally by feature owners.
**Blocked by:** 64.
**Status:** resolved
**Owner:** Contraction batch A.
**Contract:** [execution.md](../execution.md).

- [x] Import and route inventory prove each removed wrapper has no callers, including tests/demo/aliases.
- [x] Delete at most eight wrapper files within ≤400 runtime lines; enumerate and split further if the residual inventory is larger. *(Split into two commits on `wi/65-retirecore`: 7 + 3 wrappers, 9 + 10 touched files, both under the caps.)*
- [x] Core/project/operation routes still resolve directly and their baseline adapters use final interfaces only.
- [x] Shared bridge/UI still needed by other groups remains intact until its dedicated contraction leaf.

## Retired wrappers (10 + 1 helper)

Split across two commits to respect the per-leaf caps:

1. `17e7bd2` — zero-caller project/asset group (9 files):
   - `A.withdrawApproval` — zero callers anywhere; the submitter-side path is `withdrawApprovalTransaction`.
   - `A.estopOp` — zero callers; `A.emergencyStop` (the ticket-28 machine entry) stays untouched.
   - `A.addAssets`, `A.setAssetScope` — pure delegates to `importAssetsTransaction`/`changeAssetScopeTransaction`; their only callers were tests (bridge proofs re-pointed to the same transactions, `corr: 'legacy'` kept, assertions verbatim).
   - `closureChecklist` store export — pure delegate to `evaluateCloseChecklist`; the remaining internal consumer (`completion`) resolves the canonical derivation directly.
   - `hhmm12`, `nextProjectId` — zero-caller core exports (`hhmm12` inlined for `stamp`).
2. `20af829` — zero-caller operation controls (10 files):
   - `A.confirmPreflight` → `runOperationPreflight`, `A.startOp` → `startOperation`, `A.reviewStep` → `reviewOperationStep` — pure delegates whose only callers were tests (fixtures/bridge proofs re-pointed; only the display-only live-log mirror is skipped — no suite asserts it).

## Kept intentionally (not this ticket)

- `A.createOperation`/`A.updateOperation` — still live *definitions* (12/1 test callers; the typed `createOperationDraft`/`updateOperationDraft` enforce stricter wizard gates, so re-pointing setups would change behavior). Retirement belongs to 67's final store contraction.
- `A.pauseOp`/`A.resumeOp`/`A.stopOp`/`A.completeOp`/`A.fastForward` — src callers in `c-console.tsx`.
- All non-core wrappers (findings/reports/playbooks/AI/branches/C2/settings/agents) — owner 66; final Context/store bridge — owner 67.

## Evidence

- `npm run typecheck` — 0 diagnostics (before and after).
- `npm run lint` — 0 errors; 198 warnings at the ticket base → 196 after (3 findings removed by the deletions, 1 new file-level import grouping; no new findings per file-level diff of the lint output).
- `npm test -- --run` — 69 files / 926 tests green. One transient single-test failure occurred on the first post-edit run and did not reproduce in three consecutive full re-runs (all 926 green); no time/fake-timer assertion was changed by this ticket.
- `npm run build` — succeeds (vite build ✓).
- Grep proof (code, comments excluded): `git grep -E "A\.(withdrawApproval|estopOp|addAssets|setAssetScope|confirmPreflight|startOp|reviewStep)\b"` → 0 hits; `export (const|function) (closureChecklist|nextProjectId|hhmm12)` → 0 hits. Surviving typed entries (`runOperationPreflight`, `startOperation`, `reviewOperationStep`, `importAssetsTransaction`, `changeAssetScopeTransaction`, `evaluateCloseChecklist`) referenced at their established import sites.
- Behavior-identical evidence: every re-pointed caller now invokes the exact function its wrapper delegated to (same authority/clock/context, `corr` preserved where a ChangeSet assertion reads it); all baseline suites pass unchanged (assertions kept, only titles/fixture entries retitled per the delegation).
- Browser route exercise: skipped — preview HTTP check optional per AGENTS.md § Windows Temporary Process Safety (recorded as a verification gap; route resolution is covered by the router/registry suites and `npm run build`).
