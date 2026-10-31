# Raptix UI export checklist

Date: 2026-10-31. Destination: <https://github.com/Akapi895/raptix>.  
Scope: standalone `ui-app`; no real Raptix backend is included or assessed. Full evidence: [final-ui-audit.md](final-ui-audit.md).

## Completed

- [x] Preserve the existing light theme, red accent, routes and feature responsibilities.
- [x] Verify prior Capabilities, C2 and File Management improvements instead of repeating their redesigns.
- [x] Make all twelve Settings sections native keyboard controls with visible focus/current state.
- [x] Correct tablet Settings/form/token layout, compact header utilities and stack WebShell's narrow workspace.
- [x] Repair API Docs All APIs reset, keyboard disclosures, heading structure, generated labels and secondary-action contrast.
- [x] Keep dynamic WeChat QR source behavior; supply meaningful alternative text.
- [x] Keep the fictional-data indicator clear of mobile bottom navigation.
- [x] Correct standalone product context and current initialization guidance.
- [x] Complete the test/build gate and record actual remaining limitations.

## Remaining unresolved issues / deferred work

| Issue | Scope and priority | Reason deferred |
| --- | --- | --- |
| WebShell demo AI-history array mismatch and failing file-list fixture | P1 demo limitation, visible on connection selection / Files tab | Fix requires a separate mock/contract review of existing WebShell behavior. No service, execution or transport contract changed; no successful interaction fabricated. |
| MCP demo new-server upsert/config differences and sparse execution details | P2 demo limitation | Existing documented mock gaps; isolated fixtures cover the supported frontend paths. |
| File downloads/export in demo are fixtures, not actual remote/project bytes | Demo boundary | Preserve honest simulation; real file behavior requires the corresponding backend. |
| Muted hints/placeholders in older Settings/WebShell surfaces need a complete contrast pass | P2 accessibility | Sampled improved API controls pass; no application-wide conformance claim. Broad token changes require their own state/contrast verification. |
| Full assistive-technology/off-canvas keyboard/zoom/touch audit | Verification gap | No real screen reader or physical device session was available; browser tests are selected interaction coverage. |
| Large initial JavaScript/CSS and old cascading styles | P2 performance | Defer library-loading changes and cascade extraction to a separately profiled pass; avoid architecture churn before export. |
| One baseline workflow rerun-title timing failure | P2 test reliability | Five isolated passes and subsequent complete suites passed. Root cause was not established; execution changes were out of scope. |
| Historical feature migration READMEs describe removed bridges | Documentation history | Root README and current source supersede those installation examples. Preserve technical history rather than restore obsolete runtime code. |
| Root-relative hosting / same-origin realtime URLs | Deployment consideration | Subpath hosting and real backend endpoints unavailable; no transport rewrite made. |

## Legacy cleanup status

- [x] User-facing GitHub destination: `https://github.com/Akapi895/raptix`.
- [x] No old repository URL or visible CyberStrikeAI brand found in frontend entries/runtime/static assets. Root README intentionally retains extraction provenance.
- [x] `PRODUCT.md` identifies single-user local Raptix UI and explicitly states the backend is unavailable here.
- [x] No classic runtime / bridge files remain; architecture tests enforce that boundary.
- [x] Referenced `afterClassicScripts()` lifecycle methods remain intact in typed HITL/audit/token composition. Naming alone is not justification to remove them.
- [x] Storage keys, route aliases, DOM hooks, backend literal mappings and public API payloads preserved.
- [x] No backend, database, agent orchestration or remote execution behavior changed.

## Visual and accessibility verification

- Rendered **23 canonical SPA pages + API Docs** at **390 / 768 / 1366 / 1440 / 1920px** (120 combinations).
- Rendered 12 Settings sections, six selected-project tabs and five WebShell tabs at those widths (115 more combinations).
- No document/active-page horizontal overflow in the final 235 captures. Local table/code scrolling remains intentional. Tablet clipping that page-width tests missed was corrected and inspected full-size.
- Existing suite exercises capability editors, vulnerability drawer, file previews/mutations, C2 details/forms, workflow menus/dialogs, project/conversation/model selectors, audit picker, authentication and security approvals.
- New regression coverage verifies Settings Enter/Space navigation, API disclosure state/form labels/group reset, mobile badge/nav separation and tablet control/value/workspace bounds.
- API Docs sampled text contrast: method badges **6.47–7.13:1**, primary action **5.62:1**, secondary actions **17.40:1**.
- Impeccable source detector: **two warnings in `index.html`**. Dynamic hidden QR source is intentional; external-CSS type hierarchy warning disagrees with rendered 20px/15px page/section headings. API Docs heading/rail findings are resolved. No live overlay or WCAG certification claimed.
- Not verified: all generated menus/dialog/error permutations, physical touch/gestures, native screen readers, Firefox/WebKit, exhaustive zoom and color-contrast inventory.

## Frontend performance

| Production artifact | Before, kB (gzip) | Final, kB (gzip) |
| --- | ---: | ---: |
| Main JS | 4,174.83 (1,279.44) | 4,174.92 (1,279.46) |
| Shared CSS | 848.85 (129.80) | 849.27 (129.84) |
| App CSS | 229.44 (39.10) | 230.17 (39.25) |
| API Docs HTML | 24.31 (5.31) | 23.89 (5.31) |

Duplicate API disclosure keyframes and redundant action CSS were removed. Accessibility/responsive fixes slightly increase net output; this is not a bundle-size optimization claim. ELK, Cytoscape, XLSX, xterm and locale data remain large, genuinely referenced contributors. Both builds retain the large-chunk warning. No missing API Docs stylesheet warning remains. No loading-time, low-end-device or throttled-network budget was measured.

## Mock/demo separation

- `npm run dev -- --mode demo` and `npm run build:demo` load `src/mock/` through the demo entry.
- Development `VITE_MOCK=1` also enables the demo; ordinary production builds exclude it even when that development flag is set.
- `dist/` and `dist-demo/` remain separate. Production tests check absence of fixture/mock behavior using controlled responses.
- HTTP/WebSocket/EventSource interception is demo-only and restored on disposal. Persisted demo storage keys are unchanged.
- Fictional badge, simulated output and unavailable real Beacon compilation remain explicit. Demo results are not real execution evidence.
- Keep the mock in the exported source for visual testing; do not ship `dist-demo` as the production UI.

## Portability / files to carry

- [x] Static relative-import inspection of **478 TypeScript files** found **zero imports outside `ui-app`**; TypeScript and architecture checks pass.
- [x] Entry `/static/` references resolve within `public/`; both entries and their hashed styles build successfully.
- [x] `npm ls --depth=0` succeeds; no package dependencies were added or replaced.
- Carry `package.json`, lockfile, TypeScript/Vite/ESLint/Vitest/Playwright configs, `index.html`, `api-docs.html`, `.env.example`, `src/`, `public/`, `build/`, `tests/`, `scripts/`, `docs/`, `PRODUCT.md` and README. Keep design context if useful.
- Install with `npm ci` on Node **>=22.12**; install Chromium for browser tests. Do not depend on this parent repository's scripts or backend to build the package.
- Preserve typed composition/startup/reverse-order disposal in `src/main.ts` and `src/app/domains/index.ts`.
- Preserve `/static/` and `/api/` root paths. Subpath deployment is not verified.
- Static hosting must serve both built entries and map **`/api-docs` → `/api-docs.html`**. Vite's dev/preview middleware is not a deployed-server configuration.
- `VITE_API_BASE` is the shared HTTP base. Some realtime/legacy calls remain same-origin; see [ui-api-endpoints.md](ui-api-endpoints.md). Do not infer or invent Raptix backend compatibility.
- `API_PROXY_TARGET` is development-only, default `http://127.0.0.1:8080`. Preview tests start fresh servers on **4173 demo / 4174 production**.
- Production source maps are currently emitted; decide whether to publish maps as part of the eventual hosting setup. No deployment was performed here.

## Executed tests and builds

Final complete command: **`npm run check`**.

| Check | Actual result |
| --- | --- |
| Typecheck | Passed |
| ESLint | Passed |
| Vitest | **668 tests / 79 files passed** |
| Production build | Passed; existing chunk-size warning |
| Demo build | Passed; existing chunk-size warning |
| Playwright Chromium | **153 passed**, three workers, no retries |
| Additional rendered sweep | 235 page/nested-state/width combinations; no page exceptions/console errors or document/active-page overflow; visible handled WebShell demo errors documented |
| Impeccable scan | Ran once over relevant changed frontend sources; two investigated warnings |
| Package/import/static-asset inspection | Passed within the limitations above |

Intermediate results are not hidden: the baseline full suite had one intermittent workflow rerun-title failure; isolated repeats and later full runs passed. The first new Settings test expected focus to stay on navigation after the terminal deliberately focused its input; the assertion was corrected to check navigation focus before activation. Final gate is green.

## Exact files changed in this pass

Paths are relative to `ui-app/`. Because the entire package was untracked at session start, this explicit ledger is the change boundary; Git cannot provide a useful tracked before/after package diff.

1. `PRODUCT.md` — standalone Raptix purpose/backend boundary.
2. `README.md` — current lifecycle/export guidance.
3. `index.html` — native Settings navigation, current state and QR alternative text.
4. `api-docs.html` — accessible authentication/groups/landmarks, fallback copy, method/action styling, focus/reduced motion and duplicate CSS cleanup.
5. `src/features/api-docs/index.ts` — current-group/disclosure state and neutral token notice.
6. `src/features/api-docs/view.ts` — semantic endpoint/section headings, label associations, description controls, status role and escaped spec text.
7. `src/features/api-docs/model.ts` — description heading levels nested below endpoint sections.
8. `src/features/api-docs/model.test.ts` — retain formatting regression assertion at the corrected heading level.
9. `src/features/settings/controller.ts` — synchronized section `aria-current`.
10. `src/platform/mock-transport.ts` — demo indicator offset and red Reset treatment.
11. `src/styles/style.css` — native Settings button reset/focus and container-responsive token summaries.
12. `src/styles/mobile.css` — demo safe-area offset and scoped tablet header/Settings/WebShell layout fixes.
13. `src/styles/api-docs-mobile.css` — group-heading selector follows semantic correction.
14. `tests/e2e/api-docs.spec.ts` — keyboard/reset/headings/label/disclosure regression coverage.
15. `tests/e2e/export-stability.spec.ts` — Settings keyboard, mobile demo navigation and tablet bounds regressions.
16. `docs/final-ui-audit.md` — replace stale assertions with final evidence/limitations.
17. `docs/ui-export-checklist.md` — this export ledger and checklist.

Build outputs and Playwright results were regenerated under ignored `dist/`, `dist-demo/` and `test-results/`. Temporary review scripts/screenshots are outside the package in the approved OS temporary directory. Review servers were stopped. No commit, push, deployment, backend integration or repository export was performed.

**Export conclusion:** Source package builds independently and passes its final frontend verification gate. Carry its documented limitations with it; this checklist does not certify live frontend–backend integration.
