⚠️ DEGRADED: single-context critique (no subagent tool exposed; design review preceded the mechanical detector).

# Final UI audit — Raptix standalone frontend

**Date:** 2026-10-31. **Mode:** Operate; Read for API Docs.  
**Outcome:** Stabilization completed; final `npm run check` passed. Export limitations remain explicitly documented below and in [ui-export-checklist.md](ui-export-checklist.md).  
**Boundary:** Standalone frontend and local demo only. The real Raptix backend is unavailable; frontend–backend integration compatibility is not assessed.

## Review method and previous findings

Read the previous final audit, `capabilities-ui-audit.md`, `file-management-redesign.md`, and `c2-ui-redesign.md`, then inspected current source, route registration, initialization, environment configuration, tests and rendered Chromium output. Impeccable context, critique, distill, layout, typeset, polish, audit and craft-floor guidance informed the pass. No native browser tool was exposed; browser review used the installed Playwright Chromium.

The initial Git status already contained unrelated backend changes and the entire untracked `ui-app/` directory. There is no tracked Git baseline for a meaningful package diff. Changes in this pass are enumerated exactly in the export checklist; unrelated files were not edited.

Previously completed work was retained:

- Capabilities inventories, local management/activity navigation, dialog keyboard handling, retry states and native category filters.
- File Management's inventory/Explorer/preview layout, source separation, paging and conversation context.
- C2's four destinations, context-specific task history, status presentation and listener/profile forms.
- Earlier shell-label corrections, the two skipped Settings/Bot heading fixes, Raptix GitHub destination, and the API Docs mobile stylesheet fix.

Several previous claims were stale: the router contains **28 registered IDs including aliases**, not 27 independent pages; the current baseline has **668 tests in 79 files**, not the larger counts in some historical feature reports; classic bridges have already been removed; the API Docs stylesheet no longer produces a missing-asset build warning. Those findings are corrected here rather than repeated as unfinished work.

## Design critique

**Specificity verdict:** The project-scoped operational tables, graph workspaces, conversation activity and findings drawers fit Raptix's operator workflow. The established light/red identity and most page organization are coherent. A new visual identity or page consolidation would add risk without resolving the remaining defects.

| Nielsen heuristic | Score / 4 | Evidence / principal limitation |
| --- | ---: | --- |
| Visibility of system status | 3 | Loading, retry, empty, approval and execution states exist; some demo payloads remain incomplete. |
| Match to the real world | 3 | Separate graph runs, C2 task history and file contexts; technical language suits the operator audience. |
| User control and freedom | 3 | Clear filters, cancellation, drawer dismissal and tested modal focus paths; no universal undo. |
| Consistency and standards | 3 | Shared shell and scoped feature systems; older WebShell and Settings styling still differs. |
| Error prevention | 3 | Existing validation, save guards and destructive confirmations retained. |
| Recognition rather than recall | 3 | Visible inventory actions, project context, named Settings controls and API headings. |
| Flexibility and efficiency | 3 | Search, bulk actions, keyboard controls and reusable workflows; heavy initial bundle remains. |
| Aesthetic and minimalist design | 3 | Stable tables preserved; API testing actions simplified; legacy gradients/containers remain in older screens. |
| Error recovery | 2 | Tested retry paths are useful; nested WebShell demo views still expose fixture-shape failures. |
| Help and documentation | 3 | Contextual form help and API Docs; older feature migration READMEs need historical interpretation. |
| **Total** | **29/40** | **Good; targeted stabilization appropriate.** |

Primary findings were keyboard access, tablet content clipping, API Docs navigation/semantics, and the demo indicator covering phone navigation. For a keyboard-dependent operator, unfocusable Settings sections were the largest navigation problem. For a power user, split token totals and clipped WebShell controls undermined scanning. The first-time operator benefits from clearly distinct project, conversation, definition and execution contexts.

Cognitive load is moderate in long configuration/editor screens: several expose more than four actions, but grouping and existing disclosures provide meaningful structure. Task-critical choices were not hidden or removed just to reduce the count. The emotional low point remains failed or disconnected execution; honest error states were retained rather than replaced with simulated success.

Questions skipped: the user explicitly supplied priorities, visual constraints and authorization to implement safe changes autonomously without intermediate approval.

## Implemented improvements

| Area | Confirmed problem | Final change / verification |
| --- | --- | --- |
| Settings navigation | Eleven sections were non-focusable div controls. | Twelve native buttons, visible keyboard focus and synchronized `aria-current`; all sections activated with Enter/Space in Chromium. |
| Tablet Settings | Two sidebars squeezed form controls; token totals wrapped into fragments at 768px. | Reused the existing horizontal Settings navigation through 1023px. Token metric/chart layout now responds to its actual container. The 243,630 total remains on one line in the tablet regression test. |
| Tablet shell | Header actions extended beyond the viewport. | Compact icon presentation at 768–1023px retains existing titles/actions. Bounds checks verify API Docs, notifications and account controls remain reachable. |
| Tablet WebShell | Connection list consumed half the already narrow content area. | Scoped stacked list/workspace at 768–1023px. Workspace exceeds 500px at 768px; no execution, service or transport behavior changed. |
| API Docs navigation | The static All APIs link had no group action, so filtering could not be reset correctly. | Connected the existing group action; Enter restores the complete endpoint list and current-group state. |
| API Docs keyboard | Authentication disclosure was a clickable div. | Native button with expanded/controlled-panel state; keyboard toggle and focus outline verified. Description disclosures also expose state. |
| API Docs semantics | h1 → h3 jump, no endpoint headings, labels not associated with generated inputs. | Page h1; authentication/group/endpoint h2; section h3; nested Markdown h4–h6. Added main/navigation landmarks, associated form labels and result status role. Controlled-response browser test exercises path/query/body fields. |
| API Docs readability | White text on yellow Copy cURL and pale method badges; competing red Clear result action. | Neutral secondary actions; darker method colors; red retained for primary action. Measured contrast listed below. |
| API Docs polish | Repeated fallback text, duplicate keyframes, unnecessary colored status rail. | Clean fallback strings, one shared disclosure animation, neutral bordered token notice, reduced-motion disclosure treatment and hidden decorative SVGs where reviewed. Spec-derived parameter/body-description text is escaped. |
| WeChat QR | Meaningful dynamically generated QR had empty alternative text. | Added descriptive alt text. Source assignment, onload/onerror, hidden state and fallback-link behavior are preserved. |
| Demo indicator | Reset badge covered Dashboard/Chat bottom navigation on phones. | Lifted above the navigation safe area; retained explicit fictional-data label; Reset uses the red accent. Bounds and navigation-click regression checks pass. |
| Product/export context | Root README still instructed installing removed classic bridges. | README describes current typed composition/lifecycle; PRODUCT explicitly identifies this standalone single-user Raptix UI and unavailable backend boundary. |

## Application-wide rendered and interaction coverage

All **23 canonical application pages plus API Docs** were rendered at **390, 768, 1366, 1440 and 1920 CSS pixels**: 120 page/width combinations. Additional captures covered all 12 Settings sections, six selected-project tabs and five WebShell tabs at the same widths: another 115 combinations. Layout measurements found no document or active-page horizontal overflow in these captures. Wide tables intentionally retain local scrolling; absence of page overflow alone was not treated as proof of usable content.

Screenshots were reviewed in contact sheets, with full-size inspection of changed API Docs, phone Settings and the tablet Settings/token/WebShell defects and fixes. Captures waited for breakpoint transitions; early transitional screenshots were not treated as stable-layout defects. Browser page-error/console-error collection was empty in the capture runs; handled WebShell errors still appeared as visible toasts and are separately reported below.

| Surface | Nested states / interaction evidence |
| --- | --- |
| Dashboard | Project summary, severity and capability panels; feed/access tabs and token analytics through existing browser tests. |
| Chat | Empty and populated conversations, streaming, mention picker, drafts, model/reasoning selection, project conversation picker, Workspace tabs, files navigation and live approval via tests. |
| Operation Center | Selected-project facts, graph, assets, conversations, vulnerabilities and settings captured; project/fact create/edit and context navigation exercised. |
| Assets / Discover Assets | Inventory, graph, scope/search/filter/reset, failure retry, add/edit and discovery import flows covered. |
| Vulnerabilities | Queue, summary, drawer sections, edit, filters, selected actions, retest failure preservation, asset link, Escape and focus containment tested. |
| Workflows | Builder, Runs, Schedule; node menu/search/edit/delete confirmation/undo, validation, save, run inspection and approvals covered by the suite. |
| Security | Requests, Policy, History and blocking rules; default reviewer, inline approval and validation/error paths covered. |
| WebShell | Connection editor and selection; Terminal, Files, Database, AI and Memo visually inspected. Nested demo errors remain; real remote operations were not tested. |
| C2 | Sessions Terminal/Files/Tasks/Info, listener/profile forms, Activity Tasks/Events/details and payload availability/error presentation exercised against demo/fixtures. |
| File Management | Source/conversation filters, Explorer, previews, edit/rename/folders/upload/download/export requests, errors and keyboard dialogs exercised. |
| Capabilities | All seven routes; MCP JSON/schema, knowledge editor/history detail, skill summary/package editor and agent editor; keyboard, CRUD, filtering and recovery tests pass. |
| Settings | All twelve sections captured and keyboard-activated; audit date picker/detail, terminal, storage and update frontend interactions covered. No real update or cleanup was executed. |
| API Docs | All/group/reset, authentication and description disclosures, form labels, responsive stylesheet, theme/language controls and controlled spec/error boundaries. |
| Shared UI | Login rejection/success/logout, notifications/account presentation, project selection, dropdowns, theme/language and mobile navigation through the existing suite. |

This is extensive source/rendered/automated coverage, **not an exhaustive manual traversal of every generated menu, dialog, asynchronous error and content permutation**.

## Cross-page responsibilities

No page consolidation was justified:

- **Chat / Workflows:** conversation-directed work versus saved graph definitions and their execution records.
- **Workflow tasks / C2 tasks:** orchestration input/run state versus remote-session command history; endpoints and semantics remain distinct.
- **File Management / C2/WebShell files:** project/conversation artifacts and uploads versus remote files.
- **Operation Center / Assets / Vulnerabilities:** project scope/facts, asset inventory and finding triage. Existing links preserve context.
- **Approvals:** Chat's current decision, Security's defaults/pending/history, and Workflow run continuation remain separate execution contexts.
- **Project / conversation / list filters:** project context, selected conversation and local list scope remain separate. Their controls were not merged.
- **Capabilities management / activity:** definitions and recorded usage answer different questions.

## Accessibility and Impeccable evidence

One source detector run after the markup/controller improvements covered `index.html`, `api-docs.html`, `src/features/api-docs`, `src/features/settings/controller.ts` and `src/platform/mock-transport.ts`.

**Result: two warnings, both in `index.html`:**

1. `broken-image`: QR `<img>` has no static source. Intentional dynamic lifecycle: starts hidden, JS assigns the returned image data URL, shows it only on load, and hides it on failure. Adding a placeholder source would misrepresent that lifecycle. Descriptive alt is now present.
2. `flat-type-hierarchy`: source detector assigns all external-CSS heading roles 16px. Rendered Dashboard page/section headings measure **20px / 15px**; other scoped styles also supply distinct roles. This warning is not evidence that every rendered heading is 16px. No global font-scale rewrite was made.

The previous API Docs skipped-heading and decorative-rail warnings are absent. Its rendered title is 32px on desktop, path text 15px and section titles 14px, with semantic levels independent of font size. No live detector overlay was installed or claimed. Later tablet fixes were CSS-only; the source detector's markup findings remain applicable.

Sampled light-theme text contrast from actual computed foreground/background colors:

| API Docs element | Ratio |
| --- | ---: |
| POST method | 7.13:1 |
| GET method | 6.70:1 |
| PUT method | 7.09:1 |
| DELETE method | 6.47:1 |
| Send request | 5.62:1 |
| Copy cURL / Clear result | 17.40:1 |

Keyboard checks verify the changed navigation/disclosures and existing modal/drawer tests verify selected Tab/Shift+Tab containment, Escape and focus restoration. The terminal intentionally takes focus after its Settings section opens; the navigation focus indicator is checked before activation. Decorative SVG paths are not presented as separate controls.

Remaining accessibility work includes a full muted-text/placeholder contrast inventory in older Settings/WebShell surfaces, complete off-canvas keyboard/assistive-technology traversal, and real screen-reader testing. No WCAG or screen-reader compliance claim is made.

## Performance findings

Vite production output, decimal kB; gzip in parentheses:

| Artifact | Before | Final |
| --- | ---: | ---: |
| Main app JS | 4,174.83 (1,279.44) | 4,174.92 (1,279.46) |
| Shared browser JS | 353.77 (110.89) | 353.77 (110.89) |
| Shared CSS | 848.85 (129.80) | 849.27 (129.84) |
| App CSS | 229.44 (39.10) | 230.17 (39.25) |
| API Docs HTML | 24.31 (5.31) | 23.89 (5.31) |
| API Docs JS | 21.09 (6.89) | 21.49 (7.00) |

Removed duplicate API Docs keyframes and redundant secondary-action rules. The responsive/accessibility fixes produce a small net increase; **no material loading-performance improvement is claimed**. Large-chunk warnings remain; no missing-stylesheet warning occurred.

Production source maps identify ELK (~1.61 MB source), Cytoscape (~1.11 MB), XLSX (~896 KB), xterm (~345 KB) and locale data (~246 KB) as large source contributors. These are source sizes, not attributed compressed chunk sizes. Graph, spreadsheet and terminal capabilities genuinely reference them. There was no safe basis to remove these imports or delete shared CSS merely because a selector was absent from one captured page.

Deferred: independently profile/defer graph layout and spreadsheet entry points, extract standalone documentation styles from the large shared cascade, and inventory repeated/dead CSS with complete dynamic-state coverage. No dependency replacement, initialization rewrite or broad code-splitting was attempted.

## Legacy cleanup and portability

- The user-facing repository destination is already `https://github.com/Akapi895/raptix`; source/static searches found no old repository URL or visible CyberStrikeAI branding in the entries/runtime/assets. README's extraction provenance is intentional.
- PRODUCT now describes the standalone Raptix UI, not an available old backend. Existing API contracts remain an inventory, not a Raptix backend promise.
- Architecture tests and source inspection confirm no `src/legacy` runtime or bridge files. Required historical method names such as `afterClassicScripts()` in HITL/audit/token initialization remain referenced in typed domain composition and were preserved.
- Older feature READMEs contain historical bridge-installation instructions. Treat them as migration history; current initialization truth is `src/main.ts`, `src/app/domains/index.ts`, the root README and architecture tests. Do not recreate removed bridges from those examples.
- Existing `csai`/Raptix storage keys, route aliases, DOM IDs, Unicode backend literals, API payloads, same-origin realtime calls and initialization/disposal ordering remain unchanged.
- Static relative-import audit checked 478 TypeScript files: **zero relative imports outside `ui-app`**. Entry `/static/` references all resolve in `public/`. Dependencies are package-managed; `npm ls --depth=0` succeeds.
- Hosting assumes an origin-root package: `/static/`, `/api/` and realtime URLs are root-relative. Vite's `/api-docs` rewrite exists only in dev/preview; a static host must map `/api-docs` to `api-docs.html` and serve both built entries. Subpath hosting is not verified.
- `VITE_API_BASE` affects shared HTTP, not every same-origin transport. `API_PROXY_TARGET` is development-only, defaulting to `http://127.0.0.1:8080`. Preserve these contracts; no unavailable backend was contacted.

## Demo separation and remaining issues

`--mode demo` and development `VITE_MOCK=1` load the local mock; ordinary production builds exclude it. The explicit fictional-data badge and simulated terminal/output messages remain. Production startup tests use controlled responses and verify absence of demo fixtures. Demo state is not evidence of real execution.

| Priority / scope | Remaining issue | Handling |
| --- | --- | --- |
| P1, demo only | Selecting WebShell exposes an AI conversation response-shape error (`…map is not a function`); its Files tab reports File operation failed because the fixture's list result does not match the view's expected shape. | Documented from rendered UI; no fake success or replacement data added. WebShell service/remote execution contracts were outside this pass. |
| P2, demo only | Known MCP new-server upsert/config differences; incomplete execution-detail fields; demo file downloads are fixtures. | Preserve separate mock boundary; see Capabilities/File Management reports. |
| P2, frontend | Large JS/CSS; older surfaces retain low-contrast muted hints and denser visual decoration. | Broader loading/token/cascade work deferred to a separately verified pass. |
| P2, test reliability | Initial baseline full suite failed once at workflow rerun queue title; original isolated test passed once plus four repeats, and both subsequent full suites passed. | Intermittent baseline timing concern retained for follow-up; no execution logic changed and retries were not enabled to mask it. |
| Hosting / unavailable backend | Subpath deployment, actual backend contracts and remote transports are not validated. | Export notes only; no integration-readiness claim. |

## Final executed verification

The final **`npm run check`** on the implementation completed successfully:

| Check | Result |
| --- | --- |
| TypeScript `tsc --noEmit` | Pass |
| ESLint | Pass |
| Vitest | **668 tests / 79 files passed** |
| Production build | Pass; existing large-chunk warning |
| Demo build | Pass; existing large-chunk warning |
| Full Playwright Chromium suite | **153 passed**, 3 workers, no retries |
| Additional final page/state captures | **235 combinations**, five requested widths; no document/active-page horizontal overflow |
| Static portability / assets | Zero outside relative imports or missing entry static assets |
| Impeccable | Two investigated source warnings described above; no API Docs warnings |

The first version of the new keyboard test incorrectly expected navigation focus to remain after terminal activation. It was corrected to check visible focus before activation while still verifying keyboard navigation and the active panel. All final assertions pass.

Not verified: physical touch devices, Firefox/WebKit, screen readers, exhaustive browser zoom/contrast and all asynchronous dialog-state combinations, network-throttled performance budgets, static-host deployment, or live Raptix/backend behavior. Temporary browser servers were local-only and stopped after review; screenshots are in the approved OS temporary directory, not product assets.

**Conclusion:** The standalone frontend has a green verification gate and targeted usability fixes, with stable existing structure preserved. It is prepared for source export with the documented demo, accessibility, performance and hosting limitations. This conclusion does not establish frontend–backend integration readiness.
