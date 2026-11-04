# UI Final Audit — Raptix standalone frontend (`apps/ui-app`)

**Review type:** Read-only critique and inventory. No application code, routes, components, configuration, or data were changed.
**Date:** 2026-11-04.
**Target:** `apps/ui-app` (canonical frontend per `CLAUDE.md`; the only app in the repo with a `PRODUCT.md`).
**Mode:** Operate (app shell and workspace), with Read for API Docs.
**Method:** `impeccable` critique skill, degraded to single-context (see §0). Source review, Impeccable detector, and rendered inspection of all 23 hash routes plus API Docs at three viewport widths.
**Scope boundary:** Frontend in demo mode only. Real Raptix backend is not available here; FE–BE integration readiness is out of scope.

---

## 0. Run notes and method provenance

- **Method:** `⚠️ DEGRADED: single-context (sub-agent spawning not requested for this session; Assessment A and B were run inline by one reviewer)`. The Impeccable critique playbook prefers isolated sub-agents for design review and detector evidence. They were not spawned because the session policy only allows sub-agents on explicit request. Detector output was read after the design read, which partly mitigates anchoring, but the independence the playbook asks for was not achieved.
- **Context:** `impeccable context` returned a target choice (`cli`, `desktop`, `ui-app`). `ui-app` was chosen because `CLAUDE.md` names it the canonical frontend and it is the only app with `PRODUCT.md`. `DESIGN.md` is missing, so visual authority rests on `PRODUCT.md`, the tokens in `src/styles/`, and the rendered product.
- **Rendering:** Vite dev server in demo mode (`npx vite --mode demo --host 127.0.0.1 --port 5180`), which uses the mock transport and fictional data (`Lab Web Perimeter`, `lab.example.com`). Playwright Chromium (root `node_modules`) rendered each route at 1440×900, 1024×768, and 390×844. 69 captures. Screenshots are scratch artifacts and are not committed.
- **Not done:** no clicks on create, edit, delete, save, run, or send controls; no keyboard-only run-through; no axe or contrast measurement; no backend. Chromium-only.
- **Detector:** `impeccable detect --json src` (exit 2, 42 findings; see §8).
- **Prior audit:** `docs/final-ui-audit.md` (dated 2026-10-31) exists. It was read for context. Its claims were not reused as evidence; each finding below is independently verified in this pass.
- **Local server:** started for this review and stopped before final reporting (see §14).

---

## 1. Executive summary

Raptix's frontend is a competent, dense operator console. It has a consistent shell (sidebar, global header, page header with one primary action), real empty and status states in most places, and a restrained red accent that is used consistently. It does not read as a generic AI dashboard, and it is honest about demo data ("Demo data · fictional" is always visible). All 23 routes activated with zero console errors and zero failed requests in demo mode.

The problems are in information architecture, state clarity, and a handful of consistency and layout defects:

1. **Duplicate destinations.** MCP and Skills each have a management page and a monitor page with identical tab structures. The monitors are outside the sidebar.
2. **A safety control with an ambiguous state.** Call blocking says "is on" while showing "0 of 0 rules enabled".
3. **Terminology drift** across the nav, page titles, and mobile tabs (e.g., "Human-in-the-loop" → "Execution Approvals"; mobile "Tasks" → Workflows).
4. **Localization and dialog inconsistency.** Several confirmation strings are hard-coded English despite the existing i18n key; destructive confirmations use native `window.confirm`.
5. **Layout defects at narrower widths** (tablet header wrap, clipped Operation Center table headers, phone header overlap).
6. **Demo-only overlay collision.** The fixed demo pill covers sidebar items and content.
7. **Build weight.** The app chunk is 4.19 MB raw / 1.27 MB gzip, and source maps ship in `dist/`.

The app is worth finishing rather than redesigning. A new visual identity or page consolidation would add risk without resolving these issues.

**Overall design score: 26/40 (Acceptable, lower-middle).** See §4 for the scoring and why it is lower than the prior audit's 29/40.

---

## 2. Route and page inventory

### 2.1 Registered page IDs (`src/router/service.ts`, 28 IDs)

`dashboard`, `chat`, `hitl`, `tool-guard`, `asset-overview`, `asset-management`, `projects`, `vulnerabilities`, `webshell`, `vault`, `file-management`, `mcp-monitor`, `mcp-management`, `knowledge-management`, `agents`, `workflows`, `skills-monitor`, `skills-management`, `settings`, `tasks`, `c2-listeners`, `c2-sessions`, `c2-activity`, `c2-tasks`, `c2-payloads`, `c2-events`, `c2-profiles`.

**Public URL names** (`routeHash`): `projects` → `operation-center`, `asset-management` → `assets`, `file-management` → `files`, `knowledge-management` → `knowledge`.

**Legacy aliases** (`parseRoute`): `c2`, `c2-tasks`, `c2-events`, `c2-profiles`, `operation-center`, `agents-management`, `specialist-management`, `roles-management`, `assets`, `asset-library`, `chat-files`, `files`, `mcp`, `knowledge`, `knowledge-retrieval-logs`, `webshell-management`, `system-settings`, `tasks`, `platform-rbac`, `system-update`, plus `settings?section=rbac|update` (redirect to dashboard).

**Registered but never returned by `parseRoute` (effectively unreachable):** `asset-overview`, `tasks`, `c2-tasks`, `c2-events`, `c2-profiles`. Each is rewritten to another route before it can be activated. They still have `page-lifecycle.ts` cases. See F-15.

### 2.2 Sidebar navigation (`index.html` lines ~180–352)

| Group | Item | Route(s) reached | Notes |
|---|---|---|---|
| Workspace | Dashboard | `dashboard` | |
| Workspace | Chat | `chat` | |
| Workspace | Security ▸ Human-in-the-loop | `hitl` | Page title "Execution Approvals" |
| Workspace | Security ▸ Call blocking | `tool-guard` | |
| Security Operations | Operation Center | `projects` (`#operation-center`) | Facts / Attack path / Conversations tabs |
| Security Operations | Assets | `asset-management` (`#assets`) | Inventory / Asset Graph tabs |
| Security Operations | Vulnerabilities | `vulnerabilities` | Page title "Vulnerability Management" |
| Security Operations | Workflows | `workflows` | Builder / Runs / Schedule tabs; `tasks` alias lands on Schedule |
| Security Operations | WebShell | `webshell` | |
| Security Operations | Vault | `vault` | |
| Security Operations | C2 ▸ Sessions / Listeners / Activity / Payloads | `c2-sessions`, `c2-listeners`, `c2-activity`, `c2-payloads` | Listeners page hosts Traffic profiles tab; Activity hosts Tasks / Events tabs |
| Security Operations | Files | `file-management` (`#files`) | |
| Capabilities | MCP | `mcp-management` | `mcp-monitor` **not** in nav |
| Capabilities | Knowledge | `knowledge-management` | Knowledge Library / Retrieval History |
| Capabilities | Skills | `skills-management` | `skills-monitor` **not** in nav |
| Capabilities | Agents | `agents` | Specialists / Custom Agents |
| — | Settings | `settings` | 11 sections in left rail |

**Global header (every route):** project switcher, `+`, `···`, API Docs (opens `api-docs.html`), GitHub, System, language (English), notifications, account. **Mobile tab bar (390px):** Dashboard, Chat, Human-in-the-loop, Tasks, plus a hamburger for the full sidebar.

**Not routed from nav but reachable:** MCP Status Monitor (`mcp-monitor`, via Dashboard "View monitor"), Skills Monitor (`skills-monitor`), C2 Tasks/Events/Profiles (folded into Activity and Listeners tabs), Chat's Workspace panel, Asset detail, and WebShell connection actions.

---

## 3. Review coverage matrix

Legend: **R** = rendered in Chromium and activated correctly. **S** = screenshot individually reviewed. **D** = DOM and metrics probed. **—** = not reviewed.

| Route | Desktop 1440 | Tablet 1024 | Phone 390 | Interaction depth | Notes |
|---|---|---|---|---|---|
| Dashboard | R S | R D | R S | Read-only | Reviewed KPI cards, severity chart, Needs-attention banner |
| Chat (new task) | R S | R D | R S | Read-only | Composer, Workspace panel; no send, no conversation loaded |
| Human-in-the-loop | R S | R D | R D | Read-only | Requests / Policy / History tabs; only Requests reviewed |
| Call blocking | R S | R D | R D | Read-only | Zero-rule state reviewed |
| Operation Center | R S (6 s) | R S (1.2 s) | R D | Read-only | First load shows "Loading…"; reviewed after 6 s |
| Assets | R S | R D | R D | Read-only | Inventory tab only; Asset Graph not opened |
| Vulnerabilities | R S | R D | R D | Read-only | List; detail and "More filters" not opened |
| Workflows | R S | R D | R D | Read-only | Builder canvas; Runs and Schedule tabs not opened |
| WebShell | R S | R D | R D | Read-only | Empty-selection state; no connection opened |
| Vault | R S | R D | R D | Read-only | No secrets visible; "Add secret" hidden |
| C2 Sessions | R D | R D | R D | Read-only | **Screenshot not individually reviewed** |
| C2 Listeners | R S | R D | R D | Read-only | Listeners tab; Traffic profiles tab not opened |
| C2 Activity | R S | R D | R D | Read-only | Tasks tab; Events tab not opened |
| C2 Payloads | R S | R D | R D | Read-only | Form states; no generation |
| Files | R S | R D | R D | Read-only | Folder list; no folder expanded |
| MCP (management) | R S | R D | R D | Read-only | Servers & tools; Execution activity not opened |
| MCP Status Monitor | R S | R D | R D | Read-only | Execution activity; 7-day trend reviewed |
| Knowledge | R S | R D | R D | Read-only | Library; Retrieval History not opened |
| Skills Management | R S (probe) | R D | R D | Read-only | Installed skills |
| Skills Monitor | R S | R D | R D | Read-only | Usage activity |
| Agents | R S | R D | R D | Read-only | Specialists; Custom Agents not opened |
| Settings | R S | R D | R D | Read-only | "Basic" section only; other 10 sections not reviewed |
| API Docs (`api-docs.html`) | R S (top) | — | — | Read-only | Top of page; groups list partially covered by demo pill |

**Totals:** 23 routes × 3 viewports = 69 renders. Zero console errors, zero failed or ≥400 network responses, zero horizontal document overflow. Two unnamed controls on Chat at all viewports (F-12). Slowest first render: 1,492 ms (desktop Dashboard).

**Not covered:** keyboard-only navigation, focus order and focus trapping, screen-reader semantics, contrast measurement, Create / Edit / Delete flows and their dialogs, pagination beyond 20 rows, sort controls, Asset Graph (zoom, pan, fullscreen), Knowledge Graph, Retrieval History, WebShell terminal and files, C2 terminal and file transfer, Chat streaming and approvals, Workflow connection creation and validation, Settings sections 2–11, Agents "Custom Agents", and API Docs body beyond the first endpoints.

---

## 4. Overall design assessment

### 4.1 Design specificity

The product feels authored for operators rather than category-interchangeable. The clearest product-specific choices are:

- **Operation Center** separates **Facts**, **Attack path**, and **Conversations**, and says explicitly that vulnerabilities remain separate records. That matches the PRODUCT.md principle of keeping project context connected without merging records.
- **Vulnerabilities** uses severity colors and a count strip that reads quickly.
- **Workflows** shows node types as labeled chips, a "Definition valid" status, and Saved / version state next to the title.
- **Call blocking** and **Human-in-the-loop** name their controls in operator language ("Execution Approvals", "Human approval: Off", "Default reviewer").

The chrome, however, is conventional: a left sidebar with grouped sections, a top bar of pills, card-based dashboards, and standard admin tables. The brand is almost entirely the red accent and the Raptix mark. That is restrained and appropriate for Operate mode, but it means the product's identity lives in content more than in the interface.

### 4.2 Heuristics (Nielsen, Operate mode, all ten applicable)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | Call blocking "on" with 0 rules (F-02); Skills stats show 128 calls and 0 outcomes (F-13) |
| 2 | Match system / real world | 3 | Terminology drift across nav, titles, and mobile tabs (F-14) |
| 3 | User control and freedom | 3 | Cancel, discard, and drawer dismissal exist; no undo anywhere; confirmations are native (F-05) |
| 4 | Consistency and standards | 2 | Duplicate monitor/management patterns (F-01); mobile label mismatch (F-09); i18n bypass (F-05) |
| 5 | Error prevention | 3 | Permission gates and confirms present; delete controls sit beside edit in red text (F-18) |
| 6 | Recognition rather than recall | 3 | Visible tabs and actions; icon-only controls in Chat (F-12) |
| 7 | Flexibility and efficiency | 2 | Bulk selection and filters exist; keyboard shortcuts not evaluated; C2 Activity stacks five filter controls |
| 8 | Aesthetic and minimalist design | 3 | Dense but purposeful; Dashboard has 6 oversized KPI tiles, two of which carry little operational value |
| 9 | Error recovery | 2 | Operation Center loads without a timeout or error path visible within 1.2 s; error states not exercised |
| 10 | Help and documentation | 2 | Helper text on forms; no in-app help entry point; API Docs is a separate page |
| | **Total** | **26/40** | **Acceptable (65%)** |

**Why 26 rather than the prior audit's 29:** this pass weights duplicated destinations and the Call blocking state more heavily, and it scores mobile label and i18n inconsistencies as consistency failures rather than polish. Both scores are subjective; the individual findings are the reliable part.

### 4.3 Cognitive load (checklist)

| Item | Result |
|---|---|
| Single focus on primary task | Pass on most pages; fails on Operation Center's three-tab mix of facts, graph, and conversations (not separately rated) |
| Chunking (≤4 per group) | Sidebar groups ≤5 items; C2 Activity exposes 5 filter controls before the table |
| Grouping | Pass |
| Visual hierarchy | Mostly pass; Dashboard KPI tiles compete with the severity chart |
| One thing at a time | Pass |
| Minimal choices (≤4 visible options) | Fail on C2 Activity (quick ranges + status + type + session + search) and MCP config (All / Enabled / Disabled plus Select / Deselect all) |
| Working memory | Pass; project context remains visible in the header |
| Progressive disclosure | Pass in Knowledge (Details), MCP (connection details), Operation Center (runtime observations) |

**Result:** 2 failures → moderate cognitive load. Action: address C2 Activity filter density (F-19).

---

## 5. Information architecture findings

### IA-1 — Duplicate management and monitor pages (F-01)

**What overlaps:** MCP management (`mcp-management`) and MCP Status Monitor (`mcp-monitor`) both render the tabs **Servers & tools** and **Execution activity**. Skills Management (`skills-management`) and Skills Monitor (`skills-monitor`) both render **Installed skills** and **Usage activity**. The monitors are not in the sidebar. They are reached from the Dashboard's "View monitor" link.

**Genuinely duplicated or related?** Related but not identical. The management pages are for configuration (connect servers, enable tools; install skills, edit instructions). The monitors are for observation (call trends, outcomes). The duplication is the tab structure, which invites users to look for the same data in two places.

**Recommendation:** Keep the separation of configuration and observation. Make monitoring a tab or a page-level view on the management page (for example, `Execution activity` as the single observation surface), and keep `mcp-monitor` and `skills-monitor` as route aliases so Dashboard deep links keep working.

**Behavior to preserve:** Dashboard "View monitor" deep link; the 30-day retention note on MCP Status Monitor ("Execution records are kept for 30 days"); time-window controls (24h / 7d / 30d).

**Risks:** Merging could push the monitor's trend chart below the configuration panel on smaller screens. Auto-refresh on the monitor must not be lost. Scoped to Medium complexity.

### IA-2 — Terminology drift (F-14)

| Nav / label | Page title / route | Other label |
|---|---|---|
| Human-in-the-loop (under Security) | Execution Approvals (`hitl`) | Composer: "Human approval: Off" |
| Vulnerabilities | Vulnerability Management | Dashboard: "Total vulnerabilities" |
| Call blocking | `tool-guard` (route name) | "Blocking rules" |
| Operation Center | `projects` route; header project switcher | Dashboard "Lab Web Perimeter" |
| Files | `file-management` (`#files`) | Chat workspace panel "Files" |
| Workflows (desktop nav) | Workflows | Mobile tab: **Tasks** → lands on Workflows › Schedule |

**Recommendation:** Pick one noun per concept (for example, "Approvals" or "Human-in-the-loop" everywhere) and align page titles with nav labels. Align the mobile tab with its destination.

### IA-3 — Tool availability controlled in three places

Tool availability is set in **MCP → MCP tool config** (per-tool enable and pin), **Security → Call blocking** (rules that block calls), and **Agents** (specialist tool sets). The three answer different questions (available? allowed? assigned?), but nothing on the pages explains the difference. This is a hypothesis about user confusion, not a verified defect. Recommend one sentence of relationship copy on each page.

### IA-4 — Dead route IDs (F-15)

Five page IDs (`asset-overview`, `tasks`, `c2-tasks`, `c2-events`, `c2-profiles`) are registered and have lifecycle cases but are never returned by `parseRoute`. They appear to be dead code kept for compatibility. Removal is low risk only if no test or bookmarked hash depends on the registered ID. Verify before removal.

### IA-5 — Files placement

Files appears in **Security Operations**, grouped with operations pages, though its contents are chat uploads, workspace files, tool outputs, and conversation artifacts. It might sit better under Workspace next to Chat. This is an IA judgment, not a defect; keep unless user research says otherwise.

### IA-6 — Settings sprawl

Settings shows 11 sections in its secondary rail (Basic, Token usage, Human-in-the-loop, Asset management, Knowledge base, C2, Bots, Terminal, Security, Audit logs, Storage cleanup). The prior audit counted 12; the rail in this pass shows 11. Human-in-the-loop appears both in the Security section and in Settings. Recommend a cross-link, not a merge, since the Security page is operational and the Settings entry is configuration.

### IA-7 — Operation Center vs Dashboard overlap

Dashboard shows vulnerability severity and tool counts; Operation Center shows fact and vulnerability counts per project. Both are project-scoped, and the overlap is acceptable: Dashboard is a summary, Operation Center is the working record.

---

## 6. Page-by-page critique

Ratings: **Strong** / **Adequate** / **Weak**. Findings link to §10.

### Dashboard — Adequate
- Good: the "Needs attention" callout names a concrete failure and links to the two places to fix it.
- Weak: six KPI tiles with large numerals ("0 Running conversations · System idle", "4 Tool invocations") give little action. The donut and four side cards compete for the same attention. (F-21)
- The demo pill sits on top of the sidebar's lower items at 900px height (F-06).

### Chat — Adequate
- Good: clear empty-state prompt, `@ Tools`, approval toggle, and model selector in the composer footer.
- Weak: "New task" appears twice (conversation selector and button) on desktop and phone (F-04). Two icon-only buttons have no accessible name (F-12).
- Phone: the Workspace panel sits below the composer, so agent activity is off-screen until scrolled (not a defect, but a discoverability cost on mobile).

### Human-in-the-loop (Execution Approvals) — Adequate
- Good: the default reviewer control explains that changes are saved immediately as the global default.
- Weak: the page title, nav label, and composer label disagree (F-14). Tabs Requests / Policy / History were not all reviewed.

### Call blocking — Weak (safety clarity)
- Header: "Call blocking is on — Checks for risks before tool execution. Save to apply changes." and the summary "0 of 0 rules enabled" with "No rules yet."
- The state "on, zero rules" is ambiguous: a user could read it as protection, while no call is blocked. (F-02)

### Operation Center — Strong structure, weak first load
- Good: the project header carries the status, counts, and related links; Facts / Attack path / Conversations are separate tabs; search, category, confidence, "Sparse only", and "Hide deprecated" filters sit in one toolbar.
- Weak: the table shows "Loading…" for more than 1.2 s on first open and resolves by about 6 s, with no visible progress (F-07). At 1024px the table headers truncate ("Categor", "Links:", "Confider") (F-07).

### Assets — Strong
- Good: summary tiles, a labeled saved-view disclosure, and a clear inventory table. "3 matching assets · summary follows filters" states the relationship.
- Weak: each row ends with red text links "Scan · Edit · Delete" with minimal spacing between Edit and Delete (F-18). Native confirm is used for delete (F-05).

### Vulnerabilities — Strong
- Good: severity strip doubles as a filter; status pills and the row menu are consistent; sort and page size are present.
- Minor: "Vulnerability Management" title vs "Vulnerabilities" nav label (F-14).

### Workflows — Strong
- Good: the canvas is legible at 85%, nodes are typed (Start / Tool / Approval / Output), and the header states the version and saved state. Dry run, Run, and Save are distinct.
- Not verified: node selection, deletion, connection creation, validation feedback beyond "Definition valid".

### WebShell — Adequate
- Good: list-plus-detail layout with a clear empty-selection state.
- Not verified: connection detail, terminal, and file interactions.

### Vault — Weak
- The page shows two description-only cards ("Secrets" and "Promoted (global) secrets") and no list, empty state, or visible action. "Add secret" exists in the DOM but is `disabled` and permission-gated (`vault:write`), so it is hidden in this session. (F-10)
- Note: the permission gate is correct; the page's zero state is not.

### C2 — Listeners — Adequate
- Good: a compact table with status, session count, and per-row Start / Edit / Delete; "Traffic profiles" is a tab, not a separate page.
- Weak: "Delete" sits beside "Start" and "Edit" with equal weight (native confirm applies, F-05).

### C2 — Activity — Adequate, dense
- Good: explicit "Workflow runs are managed in Workflows" copy; Tasks / Events split.
- Weak: five filter controls above a single-row table (F-19); "Delete selected" is disabled with no explanation.

### C2 — Payloads — Adequate
- Weak: the **Kind** select's placeholder reads "Select a listener", not "Select a kind" (F-11). Both generate buttons look disabled until a listener is selected; helper text explains this but only after the fact.

### Files — Strong
- Good: folder rows show item counts and `READ-ONLY` badges where relevant; "Export Current Results" is clearly separate from "Upload".
- Not verified: folder expansion, preview, raw vs rendered Markdown.

### MCP — Adequate, duplicated
- Good: "Total / Connected / Enabled / Disabled" counts; per-tool checkboxes with a "Pinned" toggle; a Parameters link per tool.
- Weak: the same tab structure appears on MCP Status Monitor (F-01).

### MCP Status Monitor — Adequate
- Good: "Refreshed …" timestamp, "Execution records are kept for 30 days" disclosure, 24h/7d/30d segmented control, and a clickable bar to filter records.
- Weak: under **7d**, the trend panel says "No calls in this period" while the summary shows 4 total calls and last call 11/3/2026 9:28 PM (within 7 days of the demo date 11/4). This may be a fixture or a bucketing bug, so it is recorded as unverified (F-03).

### Knowledge — Strong
- Good: index status card ("4 / 5 items indexed", "Build index"), grouped rows by category, source/type column, and a Knowledge Graph toggle with "Disabled for new runs".
- Weak: row actions "Details / Edit / Delete" are equal weight; delete has a native confirm with hard-coded English (F-05).

### Skills Management — Adequate
- Weak: the **Package** column reads "Not reported" in every row; "Files —" and "Scripts —" are em dashes. The table is mostly placeholders for these fields.

### Skills Monitor — Weak (data clarity)
- "Total Call Count 128", "Successful 0", "Failed 0", "Success Rate —", and every skill's "Last call: Not recorded". This may be a demo fixture or a real gap in outcome capture; either way it reads as broken. (F-13)

### Agents — Adequate, sparse
- Good: "Specialists" and "Custom Agents" are a segmented control; cards show tool and skill counts and a "Built-in only" pill.
- Weak: three cards leave most of the page empty; Custom Agents was not reviewed.

### Settings — Adequate
- Good: a secondary rail with 11 sections; "AI channel config" shows probe, copy, set default, and delete as distinct actions.
- Weak: channel chips (`Default channel`, `OpenAI compatible`, `demo-large`, `llm.example.com`, `Complete`) are five badges in a row; "Set default" and "Copy" sit near "Delete" in the header. Other sections were not reviewed.

### API Docs — Strong top section
- Good: method badges (GET/POST) and a Test block with Send request, Copy cURL, and Clear result. The API Authentication disclosure is clear.
- Weak: the groups rail is long (about 20 groups) and the demo pill covers its lower part (F-06).

---

## 7. Cross-page design inconsistencies

| Pattern | Where it varies | Evidence |
|---|---|---|
| Destructive confirmation | Native `window.confirm()` in C2, Projects, Assets, Knowledge, Vulnerabilities | `src/features/c2/controller.ts`, `src/features/projects/list.ts`, `src/features/assets/view.ts`, `src/features/knowledge/controller.ts`, `src/features/vulnerability/view.ts` |
| Confirmation copy | Some strings use i18n keys; some are hard-coded English | Knowledge `'Delete this knowledge item?'` vs `en-US.json` `deleteItemConfirm`; Assets `Delete saved view "${name}"?`; Vulnerabilities `Permanently delete … This cannot be undone.` |
| Tab structure | Monitor vs management pages | MCP and Skills (IA-1) |
| Row actions | Some tables use red text links (Assets: Scan/Edit/Delete); others use outlined buttons (Knowledge, C2) | Screenshots |
| Empty states | Good in HITL, WebShell, Agents; absent on Vault | Screenshots |
| Filter placement | Operation Center and Vulnerabilities put filters in a toolbar; C2 Activity stacks filters above the table | Screenshots |
| Page header | Most pages use title + description + right-aligned primary action; C2 Payloads and Settings do not show a description | Screenshots |
| Mobile tab labels | "Tasks" on mobile vs "Workflows" on desktop | `#m-tabbar`, §2.2 |

**Shared components to standardize:** a single confirmation dialog (replacing `window.confirm`), a shared empty-state component, a shared page-header with optional description, and one row-action pattern (menu for 3+ actions, buttons for 1–2).

---

## 8. Technical audit findings

### 8.1 Accessibility

- **Unnamed controls (F-12):** two visible, icon-only buttons on Chat have no accessible name at 1440, 1024, and 390 (`#conversation-sort-btn` and `.batch-manage-btn` have neither `aria-label` nor `title` in the DOM). Confirmed in DOM.
- **Native confirm dialogs (F-05):** they are not styled, not focus-managed by the app, and are blocked by some browsers' popup policies. Keyboard handling is the browser's.
- **Not verified:** focus order, focus trap in modals, Escape handling, screen-reader announcements for loading and status changes, color contrast of muted text (e.g., "Demo data · fictional", helper copy in grey), touch target sizes on phone.
- **Color-only cues:** status uses color plus text in Vulnerabilities and Knowledge. In MCP, a "Parameters" link is red underlined text; contrast not measured.

### 8.2 Responsiveness

- **Document overflow:** none at 1440, 1024, or 390 (`scrollWidth` equal to viewport for all 69 renders).
- **Tablet (1024):** the header's "Current version" badge and the "API Docs" button wrap to two lines (F-08). Operation Center table headers truncate (F-07).
- **Phone (390):** the project switcher overlaps the Raptix logo; the header is crowded (F-09). The demo pill covers the Dashboard's "Cache hit" line and part of the Chat Workspace panel copy on phone (F-06).
- **Phone tab bar:** "Human-in-the-loop" is truncated to "Human-in-the-l…" (F-09).

### 8.3 Performance

Measured from `dist/` (production build of the current source):

| Asset | Raw | Gzip |
|---|---|---|
| `app-8ASx-iLH.js` | 4,187,043 B | 1,265,388 B |
| `browser-vOlRcjjm.js` | 353,863 B | 110,083 B |
| `browser-DkN2Laci.css` | 837,443 B | 127,953 B |
| `app-Dgswwev0.css` | 270,421 B | 45,688 B |
| `app-8ASx-iLH.js.map` | 13,485,991 B | — |

- **App chunk (F-16):** 1.27 MB gzip is large for an admin shell. The source-level cause is not profiled, so first-open cost is a hypothesis until measured.
- **Source maps shipped (F-16):** `vite.config.ts` sets `sourcemap: true` for every mode, so `dist/` includes 13.5 MB of app maps. Whether the production deployment exposes them is a deployment decision; the build config does not distinguish.
- **Source size:** `index.html` is 637 KB of markup. The sidebar and every page's skeleton live there. Not measured as a runtime cost.
- **First-open loading:** Operation Center's facts table took more than 1.2 s to populate in demo mode; the first render of Dashboard took 1.49 s. Both are demo timings, not production.

### 8.4 Reliability

- **Zero console errors and zero failed requests** across 69 demo renders. No broken navigation was found among the 23 routes.
- **Stale or misleading status:** Call blocking "on" with zero rules (F-02); MCP trend "No calls" with 4 recorded calls (F-03, unverified); Skills Monitor 128 calls with no outcomes (F-13).
- **Loading that does not show progress:** Operation Center facts (F-07).

### 8.5 Impeccable detector (42 findings)

`impeccable detect --json src` exit 2. All findings are in `src/styles/style.css`.

| Rule | Count | Lines (sample) | Assessment |
|---|---|---|---|
| side-tab (thick one-sided accent border) | 30 | 3942, 4272, 7694, 8252, 8258, 8264, 8270, 18928, 19284, 19547, 20202, 20386–20398, 22044, 22055, 23493, 26585–26597, 35046–35063, 43386, 43495, 2193, 16475, 17153 | Mixed. Several are `border-left: 3px solid transparent` or neutral borders used as state indicators (likely false positives). The red active-nav bar and accent card borders are real instances. |
| bounce-easing (advisory) | 6 | 3763, 6503, 25219, 25306, 25313, 25392 | Real. Overshoot curves on chat dots and transitions. Low priority; respects reduced-motion only if verified. |
| gradient-text | 5 | 198, 1035, 6801, 16402, 34467 | Real. Decorative gradient text is a known AI-generated tell; review each use. |
| border-accent-on-rounded | 1 | 20953 | Real but small. |

**Detector agreement with design review:** the detector flags decorative accents the design review also finds (side-tab and gradient). It does not flag any of the functional issues (duplicate tabs, ambiguous states, i18n bypass), which are outside its scope.

---

## 9. Performance and functional UX concerns

| # | Concern | Status | Evidence |
|---|---|---|---|
| P-1 | Operation Center first-open shows "Loading…" for >1.2 s with no progress or error path | Observed in demo | Screenshot at 1.2 s; resolved by 6 s |
| P-2 | Repeated catalog fetches on Agents/Skills/MCP first open | **Not measured** | Hypothesis; would need a network trace in production mode |
| P-3 | Large lists (Vulnerabilities, Assets, Knowledge) without virtualization | **Not measured** | Only 3–20 rows in demo; paging exists |
| P-4 | Asset Graph / Knowledge Graph large-graph behavior | **Not verified** | Not opened |
| P-5 | Unnecessary remounts on tab switching | **Not verified** | Requires profiling |
| P-6 | Initial bundle size | Measured | §8.3 |
| P-7 | Source maps in production build | Measured (config) | §8.3 |

---

## 10. Prioritized issue register

Severity per the critique scale: **P0** blocking · **P1** major · **P2** meaningful · **P3** polish. "Shared" means the same root cause appears on multiple pages.

| ID | Sev | Page(s) / route(s) | Element / interaction | Problem | Evidence | Impact | Recommendation | Impeccable command | Complexity | Regression risk | Scope |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F-01 | P1 | MCP (`mcp-management`, `mcp-monitor`); Skills (`skills-management`, `skills-monitor`) | Tab bars; Dashboard "View monitor" | Management and monitor pages have identical tab structure; monitors are off-nav | Screenshots (desktop-mcp_management, desktop-mcp_monitor, desktop-skills_management, desktop-skills_monitor, probe-skills-mgmt) | Users look for the same execution data in two places; confusion about which page is current | Make Execution activity / Usage activity a tab on the management page; keep monitor routes as aliases | /impeccable distill, /impeccable layout | Medium | Medium (time-window and refresh behavior, Dashboard deep link) | Shared (2 pages) |
| F-02 | P1 | Call blocking (`tool-guard`) | Header "Call blocking is on"; "0 of 0 rules enabled" | Enabled state with no rules is ambiguous for a safety control | Screenshot desktop-tool_guard | Operator may believe calls are being checked/blocked when none are | State effective behavior: "On, no rules: no calls are blocked" (confirm semantics with backend) | /impeccable clarify | Low | Low | Local |
| F-03 | P2 (unverified; P1 if real) | MCP Status Monitor | 7d trend panel | "No calls in this period" while summary shows 4 calls, last call 3 days before demo date | Screenshot desktop-mcp_monitor | If real, a misleading status on the page used to diagnose tool failures | Verify time bucketing against the data source before any UI change | /impeccable audit (after verification) | Low to investigate | Low | Local |
| F-04 | P2 | Chat | Conversation selector "New task ▾" and "+ New task" button | Two affordances with the same label at once | Screenshots desktop-chat, phone-chat | Duplicate action, unclear which starts a new conversation | Keep one; use the selector for switching and the button for new | /impeccable clarify, /impeccable layout | Low | Low | Local (Chat) |
| F-05 | P2 | Knowledge, Assets, Vulnerabilities, C2, Projects | Destructive confirmations | Native `window.confirm()` for most deletes; hard-coded English in Knowledge, Assets, Vulnerabilities despite `deleteItemConfirm` in `en-US.json` | Source: `knowledge/controller.ts:99,121,195`; `assets/view.ts:83,100`; `vulnerability/view.ts:99` | Inconsistent dialogs; localization not honored; no in-app styling | Add one in-app confirm component; route all confirm copy through i18n | /impeccable harden, /impeccable clarify | Medium | Medium (tests may assert native confirm) | Shared (5 features) |
| F-06 | P2 | All pages (demo mode) | Fixed "Demo data · fictional / Reset" pill (bottom-left) | Covers sidebar items at 900px height when C2 is expanded (Skills, Agents, Settings), API Docs group list, and phone content | Screenshots desktop-c2_listeners, desktop-c2_activity, api-docs, phone-dashboard, phone-chat | Hides navigation in the demo; does not appear in production builds (assumed; verify) | Dock the pill into the header or make it collapsible | /impeccable adapt | Low | Low | Shared (demo) |
| F-07 | P2 | Operation Center (`projects`) | Facts table; header at 1024 | No progress indicator in first load; table headers clipped at 1024 | Screenshots desktop-operation_center, probe-opcenter-6s, tablet-operation_center | Users may think the table is empty or broken for >1 s | Add skeleton rows; give table a minimum column width with horizontal scroll | /impeccable harden, /impeccable adapt | Low to Medium | Low | Local |
| F-08 | P2 | All (tablet 1024) | Global header: "Current version" badge, "API Docs" button | Wrap to two lines at 1024 | Screenshot tablet-operation_center | Header crowding; wrapping reduces scan clarity | Hide badge label or move it below 1100px | /impeccable adapt | Low | Low | Shared |
| F-09 | P2 | All (phone 390); mobile tab bar | Project switcher and logo; "Human-in-the-loop" and "Tasks" tabs | Project switcher overlaps logo; tab label truncated; "Tasks" label points to Workflows | Screenshots phone-dashboard, phone-chat; `#m-tabbar` | Mobile identity and navigation labels are inconsistent | Give the logo a fixed slot; shorten tab labels; rename "Tasks" to match its destination | /impeccable adapt, /impeccable clarify | Low | Low | Shared (mobile) |
| F-10 | P2 | Vault (`vault`) | Page body | No list, empty state, or visible primary action; "Add secret" is permission-gated (`vault:write`) and disabled | Screenshot desktop-vault; DOM probe | Users without `vault:write` see a page with no purpose; users with it may see no empty-state guidance | Add an empty state explaining the page and, when gated, why no action is available | /impeccable onboard | Low | Low | Local |
| F-11 | P2 | C2 Payloads (`c2-payloads`) | "Kind" select; generate buttons | Kind placeholder reads "Select a listener"; primary buttons look disabled without explanation | Screenshot desktop-c2_payloads | Copy error; unclear dependency between Listener and Kind | Fix placeholder to "Select a kind"; show the dependency inline | /impeccable clarify | Low | Low | Local |
| F-12 | P2 | Chat (`chat`) | `#conversation-sort-btn`, `.batch-manage-btn` | Two icon-only buttons with no accessible name | DOM probe at 1440, 1024, 390 | Screen-reader users hear an unnamed button | Add `aria-label` from existing i18n keys | /impeccable audit | Low | Low | Local |
| F-13 | P2 | Skills Monitor (`skills-monitor`); Skills Management | Call stats; Package column | 128 calls with 0 successful, 0 failed, "—" success rate; "Not reported" on all rows | Screenshots desktop-skills_monitor, probe-skills-mgmt | Stats look broken or misleading | Verify whether outcome capture is missing; show "Outcome not recorded" rather than zeros | /impeccable clarify, /impeccable harden | Low to investigate | Low | Local |
| F-14 | P2 | Nav, page titles, Chat, Dashboard, mobile | Labels listed in IA-2 | Terminology drift | §2.2, §5 IA-2 | Users must map labels to pages | Pick one noun per concept; align titles and nav | /impeccable clarify | Low | Low | Shared |
| F-15 | P3 | Router (`service.ts`, `page-lifecycle.ts`) | Registered IDs `asset-overview`, `tasks`, `c2-tasks`, `c2-events`, `c2-profiles` | Registered and lifecycle-wired but unreachable via `parseRoute` | Source | Maintenance cost; false sense of coverage | Remove after confirming no tests or links depend on them | — (engineering) | Low | Low to Medium (tests) | Local |
| F-16 | P2 | Build (`vite.config.ts`, `dist/`) | Bundle and source maps | 1.27 MB gzip app chunk; 13.5 MB source map shipped in every build | §8.3 | Slower first open on constrained networks; maps may expose source if deployed | Profile the chunk split; disable production source maps or make them opt-in | /impeccable optimize | Medium | Medium (debugging workflows) | Shared |
| F-17 | P3 | Global styles (`style.css`) | Detector findings | 30 side-tab, 5 gradient-text, 6 bounce, 1 border-accent | §8.5 | Generic AI-tell patterns; some are false positives | Remove decorative gradient text; replace accent borders with neutral state treatment where they decorate cards | /impeccable quieter | Low to Medium | Low | Shared |
| F-18 | P3 | Assets (`asset-management`) | Row actions "Scan / Edit / Delete" in red text | Edit and Delete adjacent with equal visual weight | Screenshot desktop-assets | Misclick risk | Move Delete into a row menu; keep Scan and Edit | /impeccable layout | Low | Low | Local |
| F-19 | P2 | C2 Activity (`c2-activity`) | Five filters above the table | Filter density; "Delete selected" disabled without explanation | Screenshot desktop-c2_activity | Cognitive load on a read-heavy page | Collapse quick ranges and secondary filters behind "Filters" | /impeccable distill | Medium | Medium | Local |
| F-20 | P2 | Dashboard (`dashboard`) | Six KPI tiles; side cards | KPI tiles compete with severity chart; "Running conversations 0 · System idle" adds little | Screenshot desktop-dashboard | Weak hierarchy | Reduce to one primary KPI row with inline secondary values | /impeccable distill | Medium | Low | Local |
| F-21 | P3 | Dashboard, Settings | Oversized stat tiles and channel badges | Decorative density in summary surfaces | Screenshots | Minor | Fold into F-20 | — | — | — | Local |

**Notes on consolidation:** F-05, F-08, F-09, F-14, and F-16 are shared root causes. Fixing F-05 once fixes five pages. Fixing F-14 requires one agreed glossary (GLOSSARY.md is the place to record terms).

---

## 11. Redundant components and pages analysis

| Candidate | Overlaps with | Genuinely duplicated or related? | Recommendation | Preserve | Risk |
|---|---|---|---|---|---|
| MCP Status Monitor (`mcp-monitor`) | MCP management | Related (observation vs configuration), but tab structure is duplicated | Merge observation into an Execution activity tab; keep route alias | 30-day retention note; 24h/7d/30d; Dashboard deep link | Medium |
| Skills Monitor (`skills-monitor`) | Skills Management | Related; "Installed skills" tab duplicates the management list | Merge Usage activity into Skills Management; keep alias | Call stats; Clear stats action | Medium |
| Chat conversation "New task" control | "+ New task" button | Duplicated | Keep one | Conversation switching | Low |
| Tasks (`tasks`) | Workflows › Schedule | Already redirected; the route ID is dead | Remove ID, keep the redirect | Schedule tab | Low |
| C2 Tasks / Events / Profiles routes | C2 Activity / Listeners tabs | Already consolidated; route IDs are dead | Remove IDs, keep aliases | Deep links | Low |
| Asset Overview (`asset-overview`) | Assets | Already redirected | Remove ID | Asset inventory | Low |
| Operation Center vs Dashboard | Project counts | Related (summary vs working record) | Keep both | — | — |
| Human-in-the-loop in Settings and Security | Each other | Related (configuration vs operations) | Cross-link; do not merge | Default reviewer control | Low |
| Settings (11 sections) | Several operational pages | Related configuration | Keep; consider grouping sections into three headings | All sections | Low |

**Not recommended for removal:** Vault (the empty state is the problem, not the page), Call blocking (safety function), WebShell (functional), Files (distinct from chat uploads in content, though placement is debatable).

---

## 12. Recommended implementation roadmap

Effort is relative (S / M / L). Items within each group are in priority order.

### A. Quick wins (low risk, high value)

1. **F-02** Call blocking state copy: effective-behavior line for zero rules. (S) — `/impeccable clarify`
2. **F-11** Payloads Kind placeholder copy. (S) — `/impeccable clarify`
3. **F-12** Name the two icon-only Chat buttons from existing i18n keys. (S) — `/impeccable audit`
4. **F-04** Remove the duplicate "New task" affordance. (S) — `/impeccable clarify`
5. **F-06** Dock or collapse the demo pill so it no longer covers navigation. (S) — `/impeccable adapt`

### B. Shared design-system improvements (central, fix once)

1. **F-05** In-app confirm component; route copy through i18n. (M) — `/impeccable harden`
2. **F-14** Glossary-backed label pass across nav, titles, mobile tabs. (S–M) — `/impeccable clarify`
3. **F-08 / F-09** Header behavior at 1024 and 390 (badge, logo slot, tab labels). (M) — `/impeccable adapt`
4. **Shared empty-state component** used by Vault (F-10), WebShell, Agents. (S) — `/impeccable onboard`
5. **Row-action pattern** (menu for 3+ actions) for Assets (F-18), Knowledge, C2 Listeners. (M) — `/impeccable layout`

### C. Page-specific UX improvements

1. **F-07** Operation Center loading skeleton and table min-width. (M) — `/impeccable harden`, `/impeccable adapt`
2. **F-10** Vault empty state and gated-action explanation. (S) — `/impeccable onboard`
3. **F-13** Skills outcome display ("Outcome not recorded" vs zeros). (S, after verification) — `/impeccable clarify`
4. **F-19** C2 Activity filter collapse. (M) — `/impeccable distill`
5. **F-20** Dashboard KPI reduction. (M) — `/impeccable distill`
6. **F-03** MCP trend verification, then fix or close. (S investigate) — `/impeccable audit`

### D. Structural changes

1. **F-01** Merge MCP and Skills monitors into their management pages; keep aliases. (M–L) — `/impeccable distill`, `/impeccable layout`. Dependency: F-14 terminology first, so the merged tab names are final.
2. **IA-3** One-line relationship copy between MCP tool config, Call blocking, and Agents. (S) — `/impeccable clarify`
3. **IA-5** Decide whether Files moves under Workspace. Requires user input; recorded as a recommendation only.

### E. Functional and performance issues (need runtime investigation)

1. **F-16** Bundle profiling and chunk splitting; decide on production source maps. (M) — `/impeccable optimize`
2. **F-03** Verify MCP trend bucketing against real data. (S)
3. **F-13** Verify whether skill outcome capture is missing in the backend. (S)
4. **F-15** Remove dead route IDs after checking tests. (S)
5. **P-2 / P-5** Network and render profiling of first-open catalog fetches and tab remounts in production mode. (M)

**Sequencing:** A → B (F-14 before F-01) → C → D → E. E items can run in parallel with A–C because they investigate rather than change UI.

---

## 13. Suggested Impeccable command sequence

1. `/impeccable clarify` — F-02, F-04, F-11, F-14, IA-3 copy. Resolves the copy-only items in one pass.
2. `/impeccable audit` — F-12, plus keyboard and focus checks not covered here.
3. `/impeccable harden` — F-05 (confirm component), F-07 (loading), F-13 (outcome display).
4. `/impeccable adapt` — F-06, F-08, F-09 (demo pill, tablet header, phone header and tabs).
5. `/impeccable onboard` — F-10 (Vault empty state), shared empty-state component.
6. `/impeccable distill` — F-01 (monitor merge), F-19, F-20.
7. `/impeccable layout` — F-18, row-action pattern.
8. `/impeccable quieter` — F-17 (decorative accents and gradient text). Run after `distill` so the accents that remain are intentional.
9. `/impeccable optimize` — F-16 (bundle and source maps).
10. `/impeccable polish` — final pass after all of the above.

Run `/impeccable critique` again after steps 1–6 and compare the heuristic total.

---

## 14. Unverified areas and inspection limitations

- **Real backend:** not available. All data is demo data. Behavior depends on the mock transport. Several findings (F-03, F-13, F-10 permission state, F-02 semantics) may be fixture artifacts and need backend confirmation.
- **Interactions not exercised:** create, edit, save, run, send, delete, upload, connect, start, stop, generate, probe, and every modal and dialog. Only visible states were inspected.
- **Accessibility:** no keyboard run-through, no focus inspection, no screen reader, no contrast measurement, no axe run. §8.1 lists what is unverified.
- **Viewports:** 1440, 1024, and 390 only. Ultra-wide, 768, and landscape phone were not checked.
- **Pages not screenshot-reviewed:** C2 Sessions (metrics only), Settings sections 2–11, Agents Custom Agents, Asset Graph, Knowledge Retrieval History, MCP Execution activity beyond the monitor's default view, Workflow Runs and Schedule tabs, Human-in-the-loop Policy and History tabs.
- **Performance:** only static bundle sizes were measured. No runtime profiling, no network trace in production mode, no large-dataset testing.
- **Browser:** Chromium only. No Firefox or Safari checks.
- **Detector:** run on source only. The browser overlay was not injected into the live pages; the detector findings reflect CSS source, not rendered elements.
- **Tests:** `npm run test`, `typecheck`, `lint`, and the Playwright e2e suite were not run as part of this review.
- **Sub-agents:** not used (see §0). A dual-agent run would be the stronger version of this audit.

---

## 15. Overall assessment and the 10 highest-value improvements

**Strengths (keep):**
1. Consistent shell and page header; one primary action per page.
2. Honest demo labeling and honest empty states in HITL, WebShell, and Agents.
3. Operation Center's separation of Facts, Attack path, and Conversations, with explicit copy about vulnerabilities staying separate.
4. Restrained red accent and consistent severity colors.
5. Workflow builder status and version display.
6. Zero console errors and zero failed requests across 69 demo renders.

**Highest-value improvements (ordered):**
1. **F-02** Make the Call blocking zero-rule state unambiguous. Safety clarity, low effort.
2. **F-01** Remove duplicated monitor and management tab structures on MCP and Skills.
3. **F-05** One in-app confirm component with i18n copy. Fixes five pages.
4. **F-14** One glossary-backed label pass (nav, titles, mobile tabs).
5. **F-07** Operation Center loading state and table minimum width.
6. **F-09** Phone header logo slot and mobile tab labels.
7. **F-10** Vault empty state and explanation for gated actions.
8. **F-16** Bundle profiling and production source-map policy.
9. **F-06** Demo pill placement so it stops covering navigation and content.
10. **F-12** Name the two icon-only Chat controls (accessibility, low effort).

**Open decisions (recorded as recommendations, not questions):**
- **Monitor placement:** merge into management pages (recommended, IA-1) vs keep as separate observation pages with clearer nav entries. Trade-off: separate pages keep density low; merged pages reduce duplication.
- **Files placement:** keep under Security Operations vs move under Workspace (IA-5). Trade-off: consistent with operator grouping vs closer to Chat.
- **Confirmation dialog style:** one in-app dialog for all deletes (recommended) vs keep native confirm for speed. Trade-off: consistency and i18n vs fewer lines of code.
- **Production source maps:** disable vs keep for debugging. Trade-off: smaller exposure vs easier incident debugging; a deployment decision.
