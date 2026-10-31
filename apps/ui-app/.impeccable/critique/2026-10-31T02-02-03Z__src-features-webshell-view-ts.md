---
target: "Raptix /#webshell — all five tabs"
total_score: 18
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 6
target_identity: "file:D:\\.VTNet\\redteam\\CyberStrikeAI\\ui-app\\src\\features\\webshell\\view.ts"
target_fingerprint: "sha256:f8cd79b211061fbdcdb2520facb3a854ca8eac9f6702ced0e938d862680319c4"
target_path: "D:\\.VTNet\\redteam\\CyberStrikeAI\\ui-app\\src\\features\\webshell\\view.ts"
timestamp: 2026-10-31T02-02-03Z
slug: src-features-webshell-view-ts
---
⚠️ DEGRADED: single-context (no sub-agent tool exposed; design assessment completed before detector assessment).

# Raptix WebShell UI/UX critique

## Verdict

Keep the existing shell, connection rail, five tabs, and Raptix visual language. The surface needs workflow hardening and more disciplined space allocation before cosmetic polish. The most serious issues are discarded work, ambiguous operation state, and cramped or inaccessible task areas.

Reviewed the running demo at http://127.0.0.1:5173/#webshell and current source. Used fresh Playwright browser contexts and temporary full-contract browser fixtures for active, delayed, disconnected, and failed operations. Inspected desktop 1440×1000, smaller desktop 1024×768, and mobile 390×844. Fixture behavior is evidence of frontend behavior, not successful production connectivity. Backend execution against a real shell/database was not tested. No application code was modified.

## Design specificity and strengths

The Raptix identity is coherent: light workspace surfaces, red active treatments, a dark terminal, and task-oriented tabs. The domain structure is appropriate for a security operator. This is a refinement problem, not a reason to replace the visual system.

- A persistent connection rail and five clear task tabs provide useful continuity.
- Xterm editing/history, multiple terminal windows, file/tree navigation, DB profiles, and bulk file actions already provide real operator utility.
- AI tool-execution details and Memo autosave are useful foundations for evidence and continuity.

## Five highest-priority findings

### 1. [P1] Routine navigation can discard or misapply work

Observed File Manager -> edit file -> type -> Memo -> File Manager discards the editor and unsaved changes. Expanding a DB table replaces an existing SQL draft. Deleting the active DB profile activates another profile without replacing the old SQL editor value. Unsent AI input disappears when switching connections. Source additionally shows failed saved-state restoration silently falls back to defaults and marks the connection loaded, allowing later saves against that fallback state.

Impact: lost work and ambiguous query targeting undermine trust in routine navigation. Preserve drafts per connection/profile/file, separate schema expansion from explicit query insertion, synchronize query text on every profile transition, and make failed restoration recoverable before saving over it. Treatment: functional fixes. Suggested commands: /impeccable harden and /impeccable shape.

Evidence: src/features/webshell/controller.ts:107-120,147-150,255,273-277; service.ts:95-103.

### 2. [P1] Secondary panes consume the primary work area

At 1440px the File Manager filename column computes to 0px: fixed metadata columns consume the table width. The filter is squeezed to roughly 40px. The file editor renders as a narrow, largely browser-default textarea with actions attached at its lower edge. AI's 280px history rail and inline project/role controls leave approximately 140px for the composer. At 1024px the tabs clip and stacked file controls leave almost no result height. At 390px the terminal falls below the constrained pane and the AI input row measures 0px wide outside the visible workspace.

Impact: core tasks become difficult or unavailable at supported widths. Retain the current layout, but compact/collapse secondary rails, reserve a minimum filename width, demote optional metadata, stack the AI composer controls, and base internal breakpoints on available workspace width. Keep task panels scrollable and all tabs reachable. Treatment: layout changes plus functional responsive fixes. Suggested commands: /impeccable layout and /impeccable adapt.

Evidence: src/styles/style.css:21253-21281,22148-22225,22540-22544,23207-23267,23384-23389; mobile.css:1355-1369.

### 3. [P1] Loading and error feedback do not reliably describe the latest operation

Run SQL remains enabled while pending, with no visible operation progress. A failed SQL transport request leaves the previous successful result in place and reports only a toast. A failed Memo save displays webshell.aiMemoSaveFailed, while success says Saved locally although persistence uses a server PUT. A simulated AI HTTP 503 appears as a normal assistant message without the intended error class or a retry action. Connection selection waits for saved state without an explicit selection-loading treatment.

Impact: users cannot reliably tell pending work, old results, current failures, and durable saves apart. Add per-operation pending/success/error state, associate output with target/profile/query/time, label retained results as previous, block duplicate submits, and provide contextual recovery without clearing drafts. Fix Memo copy and provide retry/unsaved-state handling. Treatment: functional fixes and copy polish. Suggested commands: /impeccable harden and /impeccable clarify.

Evidence: controller.ts:30-31,56-60,200,297-300; service.ts:86-103,208-220; ai.ts:10-11; i18n/resources/en-US.json:1872-1873.

### 4. [P1] Selected connection, reachability, and execution status are conflated

Selecting a card opens an idle terminal without testing connectivity. Online/Offline is the result of an explicit batch probe, with no freshness timestamp; it is not a persistent transport connection. Terminal Idle means no command is running. Ctrl+C states it cannot interrupt a remote command, then prints a new prompt while Running remains. Busy and AI-send state are global while the selected connection can change, weakening the association between the visible host and an operation still running elsewhere. The terminal uses independent HTTP command execution rather than a persistent interactive shell.

Impact: operators may misinterpret readiness, cancellation, and the host associated with work. Show a compact target/context line; distinguish selected, not checked, last reachable, running, and failed. Keep running work attributed to its originating host. Explain finite-command terminal behavior and avoid showing a usable new prompt before a pending request finishes. Do not advertise cancellation or session semantics the current backend does not support. Treatment: simplification, clearer labels, and functional state fixes. Suggested commands: /impeccable clarify and /impeccable harden.

Evidence: controller.ts:68-104,286-296; service.ts:63-68,134-147,183-205,248-256.

### 5. [P1] Keyboard users cannot enter the main workflow reliably

Connection cards are clickable divs with neither role nor tabindex. Task-tab buttons have no selected-state semantics or associated tabpanel roles. SQL, AI, and Memo textareas have no accessible labels. Custom select replacements hide native selects but lack standard arrow-key/typeahead behavior and label association; the DB modal also renders both the replacement options and native dropdown visibly.

Impact: primary selection, context, and editing are unreliable for keyboard and screen-reader users. Use accessible selection controls, semantic tabs, persistent editor labels, named icon buttons, and one accessible select implementation. Treatment: functional fixes plus polish. Suggested commands: /impeccable audit and /impeccable harden.

Evidence: view.ts:27-29,44-49; controller.ts:210-220.

No production-wide P0 was established. P1 means major task difficulty or incorrect behavior; P2 means avoidable friction with a workaround; P3 means polish.

## Tab-by-tab review and additional findings

### Connection management

- [P2, simplification/layout] The add form exposes ten fields at once and places the friendly name last, below the visible fold at 1440×1000. Group URL/key/type/name first and disclose transport/OS/encoding settings as advanced, retaining every setting.
- [P2, functional/copy] Global project, saved connection project, and AI conversation project can differ without scoped labels. Name those scopes explicitly and show the selected connection identity within the task pane. Restore the last task/path per connection instead of always returning to Terminal.
- [P2, simplification] Batch probe tests all saved connections even when search filters the list. Label it Test all connections, show its scope, retain progress/results, and add last-checked time. A per-connection test should not require opening Edit.
- [P2, polish] Password / Key is a plain-text input. Provide a masked input and explicit reveal control. Keep validation beside the URL field and show test results in the dialog, rather than relying only on global toasts.

Source: index.html:6180-6250; controller.ts:36-60,107-111; service.ts:190-205,223-227.

### Virtual Terminal

- [P2, simplification/functional] Eleven quick commands compete with Clear, Copy log, status, and terminal windows. The same Unix-oriented commands appear for Windows connections. Keep a small OS-appropriate common set visible and retain the rest in a command menu.
- [P2, functional/polish] Quick-command clicks append output without echoing the command in the visible terminal. Error text is not appended to the copyable terminal log, and Copy log has no success confirmation. Echo each invocation and retain errors consistently in the transcript; confirm copying.
- [P2, clarity] Terminal windows provide independent logs/history but should not imply independent persistent remote shells. Explain this once near the terminal and expose the existing history and Ctrl+L behavior through concise help.

The large empty terminal canvas is useful capacity, not whitespace that needs decorative filling. The waste is in surrounding controls and secondary rails.

Source: view.ts:42-45,52-54; controller.ts:74-104,256-257; service.ts:139-147,309-313.

### File Manager

- [P2, simplification] List directory and Refresh invoke the same handler. Combine into one Go/refresh action tied to the path field, with Enter support. Parent navigation, breadcrumbs, and the tree are complementary, but the tree should collapse when space is scarce.
- [P2, functional/layout] Filtering rebuilds the rows and loses checkbox selection; there is no selected-count action bar. Keep selection keyed by path, show selected count, and expose batch actions when relevant. Retain read/edit/download/rename/delete, but make Upload and New discoverable outside an undifferentiated More actions menu.
- [P2, functional/copy] Empty directory and no filter matches both say No data. Distinguish these states, show Clear filter for no matches, and put Retry beside list errors. Existing list loading/error treatment is a good base. Upload/download batches need visible progress and completion feedback.

Source: view.ts:46,56-68; controller.ts:113-120,147-158,258-267; service.ts:173-180.

### Database Manager

- [P1, functional; source-confirmed] Generated SQL and schema selection do not consistently honor database dialect. SQL Server receives LIMIT, and PostgreSQL/SQL Server schema names are also assigned as the connection database. Fix frontend query generation and keep database versus schema separate using the existing transport. Cross-engine execution needs verification against actual supported targets.
- [P2, functional/polish] Add connection opens an Edit connection dialog. Database type shows custom-option buttons and a native select simultaneously. Changing type can retain the previous engine's port. Use one labeled selector, accurate add/edit titles, recognizable engine names, and type-appropriate defaults. Distinguish Add database connection from the page-level shell action.
- [P2, simplification/layout] Results appear twice as a table and raw output. Prefer the table with an optional Raw output disclosure. Single-column results currently do not get table rendering; tables silently show only the first 200 rows while reporting the total. Support one-column tables, label displayed/total rows, and provide local reveal/paging without altering backend behavior.
- [P2, clarity] A default DB-1 profile can look configured before credentials are entered. Show an explicit untested/setup state and the active engine/host/database near Run SQL. Clarify that DB commands run via installed target-host CLI tools; keep detailed prerequisites contextual instead of repeating a footer everywhere.

Source: controller.ts:200-208,271-277; database.ts:10-40; view.ts:70-77; model.ts:108-117.

### AI Assistant

- [P2, clarification] Its useful purpose is connection-scoped execution and interpretation with tool evidence, conversation continuity, and optional project-linked findings. The generic System is ready welcome does not explain that distinction from global Chat. State what host it acts on and provide two or three task examples aligned to existing tools.
- [P2, clarity/functional] Explain the actual context boundary. Requests include connection/conversation/role and an optional conversation project; Memo, current file selection, and the terminal transcript are not automatically included by the frontend. Do not imply the assistant sees those automatically. Distinguish the agent role from permissions and conversation project from global project context.
- [P2, simplification/functional] A full-height empty conversation rail steals substantial space before history exists. Keep New conversation and history, but make empty history compact/collapsible. Preserve unsent drafts by connection/conversation, keep running work attributed to its original conversation, and make Stop outcome and errors explicit.

Tool-execution disclosure is useful and should stay. Improve the compact status summary before exposing detailed events; avoid fabricated counters such as 0/0 when counts are absent.

Source: view.ts:47,114-128; controller.ts:159-170,278-281; service.ts:248-298; ../internal/handler/webshell_context.go:16-22,45-70.

### Memo

- [P2, clarity] Label it Notes for this connection and state its persistence scope accurately. Its current name does not establish whether notes are shared with AI or tied to a project. The current AI request does not automatically send the memo.
- [P3, polish] Memo title repeats the tab title and multiple inset bordered layers spend space without adding meaning. Reduce internal framing and keep clear/save status on one quiet header/footer treatment. The large writing area itself is appropriate. Preserve autosave and existing clear confirmation.

Source: view.ts:48; controller.ts:268-269,297-300; service.ts:86-103,255.

## State coverage

| State | Assessment |
|---|---|
| No connection / no selection | Existing instructions give a next step. Avoid presenting an uncompleted fetch as an empty list; add persistent load-failure recovery. |
| Loading | File list loading and batch-probe progress exist; connection state, schema/query execution, and transfer operations need scoped feedback. |
| Disconnected | Failed probes can show Offline while terminal still shows Idle. Keep reachability, selection and task readiness distinct, with last-check time and Retest. |
| Active | Terminal, file editing, DB results/schema, AI tool evidence and Memo save states inspected with fixtures; workspace sizing and draft protection are the main weaknesses. |
| Error | File error persists locally but is also toasted. SQL transport failures retain unlabelled previous results. AI HTTP errors lack proper recovery. Memo save error exposes a translation key. |
| Empty tab | Distinguish empty directories, filtered-out items, no schema, empty AI history, no query output and blank notes. Provide a next action where needed. |

## Design health score

| Heuristic | Score / 4 | Reason |
|---|---:|---|
| Visibility of system status | 2 | Some useful indicators, but operation/reachability/save state is ambiguous. |
| Match with real-world expectations | 3 | Task names are recognizable; terminal and DB scope semantics need correction. |
| User control and freedom | 2 | Navigation/cancel exist; drafts and remote interruption are weak. |
| Consistency and standards | 2 | Cohesive shell, inconsistent editor/select/error behavior. |
| Error prevention | 1 | Silent draft loss, stale profile/query text, duplicate SQL submissions. |
| Recognition rather than recall | 2 | Visible tasks/tree, but target and project scopes require recall. |
| Flexibility and efficiency | 2 | Useful history, profiles and bulk actions; excessive switching and cramped controls. |
| Aesthetic and minimalist design | 2 | Coherent identity with competing rails and repeated framing/output. |
| Error recovery | 1 | Toast-only failures, stale results and untranslated save failure. |
| Help and documentation | 1 | Hints exist but do not explain core terminal/AI/context limits. |
| Total | 18/40 | Poor usability health; targeted workflow fixes are warranted. |

## Cognitive load, emotional journey, and persona red flags

Five of eight cognitive-load checks fail: chunking, hierarchy, minimal choices, working-memory support and progressive disclosure. The eleven-command toolbar and ten-field connection form are the clearest overload points. Five task tabs are justified navigation and should remain.

The opening instruction and selected connection card create confidence. Navigation that discards edits, waiting without scoped progress and ambiguous completion then erode it. Reliable save/result/cancellation feedback is the largest opportunity to improve the end of each task.

- Alex, power user: loses file/SQL drafts, must navigate crowded toolbars, and cannot trust command provenance or current SQL output.
- Sam, keyboard/screen-reader user: cannot focus-select a connection and lacks labels and selected-state semantics for editors/tabs.
- Jordan, first-time user: may read Idle as connected, confuse shell and database Add connection, and assume AI sees Memo/current file automatically.

## Detector evidence

Source feature-directory scan returned zero findings; the dynamic TypeScript markup limits its value. The full index.html scan reported four warnings: broken-image, flat-type-hierarchy, and two skipped-heading findings. None establishes a visible WebShell-specific defect: runtime images render, static typography lacks loaded stylesheet context, and heading findings are from other hidden pages.

Browser scans reported 11 flags on File Manager, 13 on Database Manager, and 9 on AI Assistant. These overlap and include shared shell, demo and offscreen nodes; they are not unique WebShell issue totals. Relevant signals: connection search placeholder about 4.4:1, selected connection URL about 4.0:1, and DB empty-schema text about 2.1:1 contrast, plus nested-card warnings. Treat these as polish inputs alongside manual review, not a mandate to remove functional pane boundaries. Demo badge/reset and unrelated hidden headings are excluded from scoped recommendations.

Detector injection succeeded in disposable automated review pages; no persistent user-visible browser overlay is available. The temporary detector server was stopped. Screenshots and scripts remain in the approved temporary workspace, not application source.

## Recommended scope and sequence

1. /impeccable harden: draft protection, profile/query synchronization, scoped pending/error/retry states, restore/save failure handling, target attribution and accessible primary controls.
2. /impeccable layout and /impeccable adapt: filename width, secondary-pane sizing, AI composer, internal scrolling and reachable tabs.
3. /impeccable distill and /impeccable clarify: duplicate file actions/result output, OS-aware quick commands, connection form groups, scoped project labels and AI purpose/context.
4. /impeccable polish: contrast, field/select consistency, action naming, editor treatment and excess inset framing.

Preserve the five tabs, resizable connection rail, useful tree/schema/history/bulk capabilities, established Raptix tokens and existing backend contracts. Terminal and Memo blank canvases are legitimate working space; collapse low-value rails and repeated controls rather than filling that space.

## Questions for a later implementation pass

1. Which should lead: A. draft/state correctness, B. workspace/responsive layout, or C. both in one coordinated pass?
2. Should the first implementation cover A. P1 issues across all tabs, B. Terminal/File Manager first, or C. all findings including polish?
