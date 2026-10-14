# 69: Final acceptance and knowledge-graph refresh

**What to build:** Verify the complete corrected spec and rebuild the knowledge graph against the integrated tree. This is a verification/documentation gate, not a catch-all implementation ticket.
**Blocked by:** 68.
**Status:** in-progress — gates recorded below on the exact final tree (`168fecc`); 68 criterion 1 (blocking [70](70-initial-load-architecture.md)), browser/AT evidence, KG refresh and the §5 enforcement-boundary residuals are open. Not complete.
**Owner:** Final integration verification.
**Contract:** [execution.md](../execution.md).

## Evidence recorded on the final tree

Worktree `wi/69-final`, app HEAD `168fecc` (docs evidence commit `b77d867`), Node v24.18.0, Windows. Full-suite run intentionally not executed (acceptance-session constraint): only the affected-file suites from the lint batches and the invariant-focused commands below ran; the full `npm test -- --run` gate remains a 69 completion requirement.

- [x] **Route inventory gate: PASS (static).** `node .scratch/web-improve-refactor/route-manifest-check.mjs src` (committed, exit 0): registry `MANIFEST` = **53 keys, set-equal** to the frozen ticket-07 inventory (plan §4); group counts a=9 b=3 c=5 d=10 e=6 f=6 g=8 h=4 s=2 match; no `dashboard` alias; every registry key resolves in its slice module's exported routes record (including composed slices d=agent+asset+library, e=analysis+finding, g incl. `...fanout`); no slice exports foreign keys. This compares the manifest **set** and each slice record as plan §4.1 requires; per-route render behavior was not re-swept in a browser (gap below).
- [x] **Invariant-focused suites: PASS at the recorded sites.** The four focused commands from the verification plan (§3/§5), `--maxWorkers=2`, all exit 0 on the final tree:
  1. `src/router/routes.test.tsx src/router/navigate.test.tsx src/App.test.tsx src/screens/project-detail/detail.test.tsx` → 4 files, 45 tests, exit 0.
  2. `src/safety src/auth/auth.test.tsx src/domain/bridge.test.tsx src/state/{services,query-bridge,query-notifications,console}.test.tsx` → 13 files, 114 tests, exit 0.
  3. `src/features/{operations/preflight,operations/lifecycle,operations/workspace}.test.tsx src/features/estop src/features/{approvals,closure}/service.test.tsx src/features/plans src/features/reports/review.test.tsx src/features/library/review.test.tsx src/features/c2 src/features/trace src/features/aichat/query.test.tsx src/features/{findings,assets}/writes.test.tsx` → 21 files, 268 tests, exit 0.
  4. `src/screens/{responsive,dark-theme,a11y}-audit.test.tsx src/ui/{dialog,table-navigation,charts}.test.tsx` → 6 files, 55 tests, exit 0.
  Total: 44 files, 482 tests. These exercise the ten families at the enforcement sites mapped in plan §5; the residuals below are boundary gaps, not failures.
- [x] **Typecheck/lint full-tree: zero diagnostics.** `npm run typecheck` exit 0; `npm run lint -- --max-warnings=0` exit 0. The five warning rules (`react-refresh/only-export-components`, `@typescript-eslint/no-explicit-any`, `no-unused-vars`, both react-hooks rules) were promoted to `error` in eslint.config.js after the cleanup; the historical 226→143 warning inventory in [diagnostics.md](../diagnostics.md) is closed. `npm run build -- --manifest` exit 0 (production artifact measured in [68](68-performance-budget.md)). Lint-batch verification also ran focused suites for every touched file at each batch (209, 149, 108, 189+301 tests; one unrelated flake in the first batch run did not reproduce across two re-runs).
- [ ] **Typecheck/lint/full tests/build + browser evidence on the exact final tree — partially open.** Full tests: not run (constraint above). Build: pass. Responsive/dark/a11y **browser** evidence (768/1024/1280/1440 × light/dark, real keyboard, AT) was NOT executed — the jsdom audit suites (group 4) pass structurally but cannot establish pixels, contrast, layout or network transfer (plan §7). No interactive browser tool and no app-owned Playwright harness exist; recorded as a gap, not a pass.
- [ ] **Knowledge graph refresh — NOT executed.** `.ua` metadata still points at `b500187` (2026-10-13), stale for the final tree. The plan §8 semantic refresh needs an agent-assisted skill run (`/understand apps/web-improve --full --no-auto-update` from the main checkout) that this session cannot dispatch; incremental scripts exist but were not run. Recorded as a gap; do not advance metadata to fake freshness.

## Exactly what remains for 69 completion

1. **[70](70-initial-load-architecture.md)** — initial-load budget is 72 KB over (68 criterion 1 FAIL); blocks 69's performance-evidence checkbox.
2. **Browser harness** — supply a reviewed app-owned Playwright config (plan §3), then run: the full 53-route/ID/tab/alias render sweep with valid/missing/foreign IDs and persona refusals (plan §4.2), direct-load/refresh/back-forward/dirty-guard behavior against `/` and `/qa-base/` (§4.3–4.4), the width×theme matrix with real keyboard and AT evidence (§7), and the declared 4G/TTI measurement (68 criterion 3).
3. **Deep-link/URL-state decisions** (plan §4.6): findings/asset-new/ai-fanout (and much of ai-plan) take only the initial URL value into local `useState`; the C2 channel/session detail panels (`overview/agents/health/ops/policy`, `transcript/events/evidence/policy`) are local-only. Either accept and document these scopes or open a bounded follow-up; a fabricated URL pass is not acceptable.
4. **Invariant boundary residuals** (plan §5): exact `deadline-1/deadline/deadline+1` matrix for **each** plan-expiry entrypoint (execute/bind/start/resume) at the real handlers; edited/narrowed ROE-window honor proof beyond the fixed Mon–Fri 09:00–17:00 UTC+7 placeholder tests; explicit list of which conditions `resumeOperation` must recheck per the corrected spec. Preserve existing tests while adding the missing boundaries.
5. **Full test suite + build on the final tree** (`npm test -- --run`, `npm run build`) once the above land, per the execution contract; this session ran the focused subsets only.
6. **KG refresh** per §8 with anomalies explained, then verify meta commit == final tested SHA.
