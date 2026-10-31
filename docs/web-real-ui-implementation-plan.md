# Raptix Real Web — implementation plan dựa trên CyberStrikeAI

**Ngày:** 2026-10-22. **Trạng thái:** đặc tả giao việc, chưa phải báo cáo đã triển khai.

**Kết quả bắt buộc:** một Raptix Web real-mode dùng được trên `http://127.0.0.1:3001`, có thiết kế mới học kỹ từ `reference/web/`, đầy đủ các miền trong phạm vi dưới đây và có evidence UI → API → service/runtime → persisted outcome. Hoàn thành không phải chỉ rebuild, thay theme, mở được route hoặc viết thêm checklist.

Prompt giao việc: [web-real-ui-agent-prompt.md](web-real-ui-agent-prompt.md).

**Điều chỉnh phạm vi AI Workspace theo yêu cầu mới:** giữ bố cục và interaction hiện có của Raptix real-mode; bổ sung tăng dần theo A13/§5.3. Đặc tả ba cột history–chat–inspector trước đây đã được thay thế; sidebar của project được tính trong tổng layout khi nghiệm thu.

## 0. Cách thực thi tài liệu

1. Đọc §1–§4, sau đó thực hiện W00 → W13 theo §8; đọc lại đặc tả trang ở §5 khi tới wave liên quan.
2. Trước khi sửa mỗi trang, đọc HTML fragment, CSS cascade và JS module tương ứng trong §3. Ghi những gì học được và cách adapt vào reference map của W00.
3. Mỗi tracer bullet phải kết thúc bằng hành vi real có thể dùng, kiểm failure path và evidence; cập nhật progress ở §11.
4. Những quyết định tại §2 là mặc định đã chốt cho nhiệm vụ này. Tiếp tục làm theo chúng, không gửi questionnaire hoặc dừng để hỏi sở thích.
5. Thiếu endpoint/resource cần thiết: implement contract/service/persistence thuộc đúng layer, sau Proposed ADR theo quy định repo. Một placeholder `unavailable` không hoàn thành một capability bắt buộc đang thiếu implementation.
6. External dependency thực sự không thể có trong môi trường: ghi đúng blocker, tiếp tục các wave độc lập và bàn giao trạng thái `BLOCKED`, không tự giảm scope hoặc nhận đã hoàn tất. Không giả dữ liệu để vượt gate.

Kế thừa các fix findings/C2 và verification harness chưa commit trong working tree. W00 phải đọc `git status`/`git diff`, phân biệt user work và thay đổi của nhiệm vụ; giữ regression fixes đang có khi tổ chức lại presentation.

**Thứ tự authority:** hướng dẫn hệ thống/repo và accepted ADRs → yêu cầu real-only cùng quyết định trong plan này → semantics/contract Raptix hiện tại → reference cho visual/content/workflow → các checklist lịch sử.

Plan này thay các quyết định UI còn mở của [checklist cũ](web-ui-completion-checklist-2026-10-22.md), đặc biệt Knowledge mock. Các quyết định an toàn/authorization của accepted ADRs giữ nguyên. Kế hoạch không tự thay status ADR hay cấp quyền bỏ guardrails.

## 1. Phạm vi và nền tảng

### Bắt buộc

- Global: Overview, Projects, Findings, Assets, Library, Infrastructure, Settings.
- Project: Overview/facts, Scope & ROE/documents, Assets/map, Planning, AI Workspace, Execution/trace/instances, Sessions, Findings, Evidence, Analysis, Reports, Team & Approvals, Activity & Audit, Project Settings/governance/vault/closeout.
- Real aggregates xuyên project; real CRUD/review/import/export; chat/model/tool execution; persistence/recovery; real configuration consumers.
- Library có Skills, Techniques, Proposals, managed Playbooks/Profiles và Knowledge tài liệu/index/search/retrieval history thật.
- Settings có trusted identity, accounts/memberships, AI & Models/usage, Integrations/MCP, Tool Guard/HITL policies, Audit, Retention và personal preferences đúng scope.
- Sessions có native C2 registry/grants/command audit; WebShell connection domain và PTY được triển khai đúng provider contracts/threat models, không đồng nhất HTTP transport với WebShell.
- Light/dark, desktop/tablet/mobile, keyboard/accessibility và final deployment verification.

### Adaptations đã chốt, không clone máy móc

- Giữ Raptix brand/logo, React/Vite, hash routes, project/engagement semantics, server/runtime boundaries. UI labels mặc định English, nhất quán với app hiện tại; tài liệu này dùng tiếng Việt.
- Workflow dùng ordered steps/form, không thêm canvas. Không có production payload generator, agent-role editor, skill usage-statistics page, one-click updater hoặc WeChat-specific integration.
- Học task queue layout để trình bày Raptix operations/schedules; inbox phê duyệt và runtime queue là hai read models khác nhau. Không thêm một batch engine không thuộc contract hiện có chỉ vì reference có nút Batch.
- Existing demo/test infrastructure có thể giữ để tránh phá user work. Production build mặc định real, không có CTA đổi sang demo, không có seed authority/fallback trong đường real.
- Fixtures dùng trong unit/failure tests và dữ liệu canary tạo qua API thật là dữ liệu kiểm tra, không phải production data source. Final functional/native evidence dùng services thật, không intercept response thành success.

### Nền tảng phải tái sử dụng

| Layer | Owner |
|---|---|
| Shared tokens/primitives, app shell, navigation | `apps/web/src/{index.css,ui,shell,router}/` |
| Feature presentation/query/port/adapter | `apps/web/src/features/<domain>/{views,query.ts,service.ts,remote.ts,api.ts,index.ts}`; theo ADR-0096, không ép tạo file vô ích |
| Transport/session/streaming | `apps/web/src/platform/`; composition ở `src/state/` |
| Wire DTO/validators/events | `apps/shared/web-contracts/`, `apps/shared/streaming/` |
| HTTP/business records/migrations | `apps/web/server/src/{http/routes,services,repositories,auth,security}/`, `server/prisma/` |
| Thread/run/checkpoint/agent execution | Python runtime; Web gọi public HTTP APIs |
| Observed graph/normalization | Neo4j + `knowledge/ingest/`; giữ authority và provenance |
| Documents/captures/report files | Workspace bytes + owned business metadata/references; không đồng bộ toàn bộ runtime state vào Prisma |

Đọc `AGENTS.md`, `apps/web/AGENTS.md`, `CONTRIBUTING_AGENT.md`, `docs/QUALITY_BAR.md`, runtime/dependency boundary docs và integration spec/coverage/execution trước coding. Source/manifests/route registry hiện hành thắng inventory lịch sử. Mỗi PR/patch concern theo giới hạn repo; một wave có thể cần nhiều patch. Commit/push cần yêu cầu riêng.

Các pointers cụ thể:

- Integration contract/evidence: `apps/web/.scratch/frontend-backend-integration/{spec,coverage,execution}.md` và follow-ups/issues liên quan tới feature đang sửa.
- Import/ownership: `docs/architecture/runtime-boundaries.md`, `docs/architecture/dependency-rules.md`.
- Accepted semantics: `docs/adr/0091-handoff-authorizes-execution.md`, `docs/adr/0096-feature-owned-web-presentation-and-adapters.md`; các data/identity ADR được chúng dẫn tới.
- Native session proposal/gates: `docs/adr/0095-interactive-c2-console-pty.md` và `docs/adr/0036-sliver-c2-bridge.md`.

## 2. Quyết định đã chốt để agent tự triển khai

| ID | Quyết định triển khai |
|---|---|
| A01 Navigation | 7 global items; 14 project items ở §4. Preserve mọi deep link/alias cũ; Fleet nằm trong Execution, Governance/Vault/Closeout nằm trong Project Settings. Asset Map ở Assets, giữ feature rollout theo capability hiện có |
| A02 Visual | Học blue/slate palette, card hierarchy, density, sidebar và master/detail của reference. Raptix wordmark/logo giữ nguyên; red dùng severity/destructive, không là primary toàn app |
| A03 Global sources | Server-side authorized aggregates/catalogs, pagination/filter/sort thật. Browser không fan-out tất cả projects để dựng global inventory. Phân biệt numeric zero, partial, unavailable và not recorded |
| A04 Accounts | Deployment/workspace accounts dựa trên auth thật hiện có + engagement memberships. Giữ fixed roles owner/operator/reviewer/viewer theo server; bổ sung admin management có authorization rõ, không dựng multi-tenant organization/custom-role engine mới và không suy admin từ việc sở hữu một project |
| A05 AI/model | UI quản lý named model profiles/provider references, defaults và per-role overrides. Cấu hình versioned, audit, consumer thật cho thread/run mới; run/thread hiện có giữ pinned configuration. Credentials server-side/vault reference, masked trên wire |
| A06 Tool policy | Workspace defaults + project overrides, evaluator và dry-run dùng cùng runtime logic. Global/project denies cộng dồn; allowlist không vượt RoE, SafeCommand, egress, mandatory HITL hoặc invocation authorization. Không thêm autonomous audit-agent thay người duyệt độc lập |
| A07 Audit | Workspace audit + project audit dùng cùng event taxonomy có scope/source/actor/resource/correlation. C2/HITL/execution events được project rõ; command audit và transcript vẫn giữ authority riêng |
| A08 No-findings report | Implement real report variant ghi scope, coverage, limitations và kết luận không có confirmed findings. Independent review vẫn áp dụng; không tạo finding giả để qua report gate |
| A09 Knowledge | Real document catalogue, upload, categories, indexing jobs, search và retrieval records. Mặc định PostgreSQL full-text search có engine label `lexical`; embeddings/semantic retrieval chỉ khi có executor thật. Không gọi lexical search là semantic/RAG inference, không cần mock tab |
| A10 Library | Skills corpus read-only + proposal/review; managed Playbook/Profile versions riêng, ordered steps tham chiếu capability/technique identities. Chỉ phiên bản approved, hợp lệ mới được dùng tạo/bind operation qua existing execution gates |
| A11 Sessions | C2 single-shot và PTY là contracts khác nhau. WebShell là explicit connection/provider record, không phải `session.transport=http`. Thực hiện §5.9 và ADR-0095; proof bằng native provider, không qua transcript mẫu |
| A12 Scope of completion | Các module bắt buộc phải có implementation real. Empty state hợp lệ khi thật sự chưa có records; missing implementation không được đổi nhãn thành empty rồi coi là done. Optional external provider thiếu cấu hình có configuration UX đúng nhưng native case tương ứng vẫn blocked |
| A13 AI Workspace | Giữ `RealConversation` hiện có: conversation dropdown/header, vùng chat/composer, optional resizable Agent sidebar và History/drawers. Bổ sung chức năng tại các seam này; không thêm fixed left history rail, inspector thứ hai hoặc thay màn bằng bố cục ba cột bên trong project sidebar. Reference Chat chỉ dẫn interaction/content refinements, không thay topology Raptix |

## 3. Reference map bắt buộc — đọc từng trang trước khi sửa

Reference nằm trong repo nhưng có thể bị ignore bởi file-search defaults. Dùng đường dẫn cụ thể vào `reference/web/templates/index.html` và `reference/web/static/`; không kết luận không có file chỉ vì glob trả rỗng. Không import `/static/*`, Go templates hoặc API paths CyberStrikeAI vào production Raptix.

**Mỗi hàng phải có một reference-map record:** HTML ID + JS functions/actions + CSS selectors/computed metrics → nội dung/interaction học được → adaptation Raptix → contract/data owner → acceptance IDs. Đọc cả renderer/form/detail logic trong JS, không chỉ heading hoặc screenshot.

| Ref | HTML ID trong `templates/index.html` | JS/CSS cần đọc trong `static/` | Học và adapt bắt buộc |
|---|---|---|---|
| R01 | `page-dashboard` | `js/dashboard.js`; `.dashboard-*` trong `css/style.css` | KPI/drill-down, last-updated/stale/refresh, severity chart+legend, recent findings/facts, access overview, recommendations, queue, tool stats, resources → Overview theo §5.1 |
| R02 | `page-chat` | `js/{chat,chat-scroll,chat-plan-progress,attack-chain-context,router}.js`; `css/chat-plan-progress.css`, final chat overrides | Học conversation search/composer/tool cards/scroll/progress/HITL/session settings; adapt vào dropdown/header/chat/Agent sidebar hiện có theo A13, không copy fixed history rail |
| R03 | `page-tool-guard` | `js/tool-guard.js`, `css/tool-guard.css` | Rule order/editor, enabled/count, dirty save/reset, matching dry-run, save/effective feedback → additive tool policies |
| R04 | `page-hitl` | `js/hitl.js`; HITL selectors | Pending/strategy/whitelist/log tabs, reason/deadline/context → Raptix inbox + human tool approvals + policy settings; giữ các approval types riêng |
| R05 | `page-mcp-monitor` | `js/monitor.js` | Overview metrics, latest executions, tool/status filters, blocked/timeout states → actual tool telemetry/trace monitor |
| R06 | `page-mcp-management` | `js/{settings,builtin-tools}.js` | Tool catalogue vs external-server configuration, search/enable/health → Raptix tool exposure/configuration with authorization unchanged |
| R07 | `page-knowledge-management` | `js/knowledge.js` | Catalogue/categories, add/edit, index/rebuild progress/error, counts/search → real Knowledge document/index flow |
| R08 | `page-knowledge-retrieval-logs` | `js/knowledge.js` | Retrieval metrics/history and conversation/message filters → actual query result/citation records, with engine/source labels |
| R09 | `page-asset-overview` | `js/assets.js`; `.asset-*` | Total/type/protocol, recent discovery, 7/30/90-day trends, risk/scan coverage → observed+managed data with honest denominators |
| R10 | `page-asset-library` | `js/assets.js` | Primary/advanced filters, chips, saved views, multi-select/bulk actions, metadata table, pagination, detail/editor/import → global/project Assets |
| R11 | `page-info-collect` | `js/info-collect.js` | Discovery input/provider/status/result/import workflow → discovery operation through existing Raptix capability/runtime, not a second scanner engine |
| R12 | `page-projects` | `js/{projects,fact-graph}.js` | Searchable project master/detail, header stats, facts/graph/assets/conversations/findings/settings → project workspace and facts/Analysis |
| R13 | `page-vulnerabilities` | `js/vulnerability.js` | Clickable severity cards, filter chips, detail/create/retest/export, source links → Finding lifecycle + retained evidence/reproduce, not CyberStrike statuses |
| R14 | `page-webshell` | `js/{webshell,terminal}.js` | Searchable/resizable connections rail, health, workspace/files/terminal → explicit WebShell provider connection, scoped session controls |
| R15 | `page-chat-files` | `js/chat-files.js` | Upload/drop/progress, source grouping, project/thread filters, copy reference, download/export → Evidence + actual chat attachments |
| R16 | `page-tasks` | `js/tasks.js` | Status/search/queue details/progress/auto-refresh → Operations/schedules; approvals inbox stays a different resource |
| R17 | `page-c2-listeners` | `js/c2.js`, `css/c2.css` | Listener cards, form, state/actions → authorized native provider listeners |
| R18 | `page-c2-sessions` | `js/{c2,terminal}.js`, `css/c2.css` | Session master/detail, filters, metadata, task history, terminal/files panes → owned sessions, expiring grants, command/reconcile/native PTY |
| R19 | `page-c2-tasks` | `js/c2.js` | Command/task status/search/detail/output → durable C2 command ledger; unknown outcome never silently resent |
| R20 | `page-c2-payloads` | `js/c2.js` | Read for mapping completeness; production payload generator remains excluded. Native test-session enrolment is test-harness-only |
| R21 | `page-c2-events` | `js/c2.js` | Scope/time/type/outcome event filters → global/project audit projection and links to command/session |
| R22 | `page-c2-profiles` | `js/c2.js`, `css/c2.css` | Profile catalogue/detail/create → native scoped HTTP traffic profiles supported by provider, not arbitrary unvalidated traffic config |
| R23 | `page-workflows` | `js/workflows.js`, `js/workflow-package-client.js`, related package UI tests | Metadata/version/ordered actions/import/export concepts → managed Playbook/Profile forms; canvas excluded |
| R24 | `page-roles-management` | `js/roles.js` | Reference-only specialist descriptions; editable agent-role management excluded. Preserve runtime graph/role definitions |
| R25 | `page-skills-monitor` | `js/skills.js` | Usage-statistics page excluded; relevant source/failure semantics may inform tool monitor |
| R26 | `page-skills-management` | `js/skills.js` | Search/detail/description/provenance → canonical Skills + change proposals; publishing follows corpus gates |
| R27 | `page-agents-management` | `js/agents.js` | Agent catalogue/list/detail → graph definitions and actual invocation roster; never invent host heartbeat/allocation |
| R28 | `page-settings` | `js/{settings,token-usage,audit,theme,storage}.js` | Sidebar sections, channel editor/probes, usage, security/audit/storage → Settings with real scopes/consumers; updater/WeChat excluded |
| R29 | `page-platform-rbac` | `js/{rbac,rbac-guards,auth}.js` | User list/detail, assignments, permission explanation, dirty feedback → real accounts + engagement membership and server-owned permissions |

`templates/api-docs.html` và `js/api-docs.js` là reference phụ cho API discovery/help links. `js/modal.js`, `theme.js`, `mobile-ui.js`, `sanitize-markdown.js` là reference chung cho interaction, không là runtime dependency cần copy.

### Reference study gate trước implementation

- Preview reference qua local static HTTP server trên cổng riêng; map đúng `/static/` và `templates/index.html`. Giữ reference read-only; Go template placeholders có thể được bỏ/inert trong preview tạm, không đưa thay đổi đó vào production source.
- Reference frontend không bao gồm backend Go. Nếu chỉ render được empty/loading state, ghi giới hạn này; đọc JS render/detail/form để inventory đủ populated states, không coi shell screenshot là toàn bộ trang.
- Structural fixtures chỉ được dùng trong isolated reference preview/component tests để quan sát states; gắn nhãn rõ. Final Raptix visual/functional evidence dùng records/services thật của canary.
- Với chat/HITL/tool guard/import/indexing, đọc các reference regression tests liên quan như `chat-input-keyboard.test.cjs`, `chat-scroll-refresh.test.cjs`, `hitl-conversation-isolation.test.cjs`, `tool-guard.test.cjs`, `asset-scan-prompt.test.cjs`, `knowledge-index-error.test.cjs`. Chuyển invariant hữu ích thành Raptix test tại đúng seam; tests CyberStrikeAI không chứng nhận Raptix.
- Reference map cho mỗi trang phải liệt kê sections, columns, filters, primary/secondary/bulk actions, detail/editor states, data requests, refresh/recovery và mobile behavior. Chỉ đánh W00 complete khi không còn một trang adapted nào được mô tả đơn thuần bằng heading.

## 4. Visual system và information architecture đã chốt

### 4.1. Tokens và layout

Nguồn: `css/style.css` phần `:root`, dark overrides, `.main-sidebar`, `.page-header`, `.dashboard-*`; `css/mobile.css`; `css/c2.css`. CSS reference có nhiều override, cần đọc final cascade/computed style, không lấy rule đầu tiên làm toàn bộ thiết kế.

| Thành phần | Đặc tả Raptix |
|---|---|
| Light | Background `#f8f9fa`, panel/input `#ffffff`, secondary surface `#f1f3f5`, primary text `#1a1a1a`, secondary `#6c757d`, border `#e9ecef`, primary/link `#0066ff`, hover `#0052cc` |
| Dark | Background `#0b1120`, panel `#111827`, raised `#1f2937`, border `#263244`, text `#e5e7eb`, secondary `#a7b0c0`, link `#60a5fa`. Filled primary dùng `#2563eb` với text white; không dùng light-blue text token làm button fill |
| Status | Success/warning/error theo semantic reference; destructive fill/text tokens tách riêng. Mọi chữ thường đạt 4.5:1; điều chỉnh các muted colors của reference nếu contrast không đạt |
| Type | System sans như reference, monospace cho IDs/output; body 14px, labels 12–13px, title 20–24px, KPI 30px/tabular digits. Không phụ thuộc Google Fonts để app dùng được |
| Spacing | Scale 4/8/12/16/20/24/32; desktop content padding 24px, mobile 14–16px; card gaps 16–24px |
| Cards | Radius 12–14px, border 1px, restrained shadow; KPI khoảng 116px cao, icon tile 28px, secondary metadata và keyboard focus/drill-down |
| Navigation | Single contextual sidebar 224px, collapsed 64px, header khoảng 56–64px. Project replaces sidebar content, không thêm hai full-width sidebars |
| Forms/tables | Desktop controls 40px; touch targets 44px; table rows khoảng 44–52px, action menu, filter bar/chips, page-size/pagination; scroll riêng cho table/code |
| Responsive | 1440/1360/1024/768/390px; breakpoint mobile dưới 768px dùng drawer/sheet. AI Workspace giữ layout A13, kiểm cả project sidebar mở/thu gọn và Agent sidebar bật/tắt; composer không bị keyboard/viewport che, table không gây horizontal scroll toàn page |
| Motion | 150–200ms, honor reduced-motion; không dùng hiệu ứng làm mất nội dung đang stream hoặc thay thế feedback thực |

Phải có reusable primitives cho PageHeader, MetricCard, SectionCard, filter/chips, master/detail, table/pagination, empty/error/partial/stale state, form sections, drawer/dialog, status, timeline, chart/legend và code/output. Tái sử dụng `ui/`, không thêm UI framework mới để tránh phải viết code thích ứng.

### 4.2. Navigation

Global giữ: **Overview / Projects / Findings / Assets / Library / Infrastructure / Settings**.

Project có đúng 14 entry chính:

1. Overview.
2. Scope & ROE — assets in/out, revisions, documents.
3. Assets — Overview, Inventory, Discovery, Map nếu available.
4. Planning — bundle, OPPLAN, business plans/review/compare/binding.
5. AI Workspace.
6. Execution — operations/runs, live/trace/results, instances/fleet.
7. Sessions — C2, WebShell, console, grants, commands.
8. Findings.
9. Evidence.
10. Analysis.
11. Reports.
12. Team & Approvals.
13. Activity & Audit.
14. Project Settings — General, Tool/HITL policies, Governance/Schedules, Vault, Closeout.

Các URL `project?tab=fleet|vault|governance|close` và alias cũ vẫn hoạt động, rewrite tới đúng canonical section. Nếu cần `section=` thì bổ sung parser/type/serializer và tests, không đánh mất resource IDs/history. Global Reports/Operations/Analysis legacy links dẫn đúng scoped/aggregate surface, không thêm sidebar slot chỉ để giữ route count.

## 5. Đặc tả nội dung và workflow real theo miền

### 5.1. Overview — phải học R01, không chỉ thêm vài con số

```text
Header: System Overview | scope | last updated/stale | Refresh
Attention banner: actionable issues + deep links
6 KPI cards, responsive grid
Main column                            Right column ~360–380px
Severity distribution + workflow       Active operations/decision queue
Recent findings / Recent facts tabs    Tool execution statistics
Project portfolio/active work          Recent audit/events
Recommended next actions               Resource + integration health
Quick start for genuine empty state; link tới Create Project/Planning
```

- Sáu KPI: active projects, active operations, awaiting decisions, open curated findings, active agent instances, active sessions. Mỗi metric có definition/source/freshness và click-through đúng filter/scope.
- `Active agent instances` dùng actual invocation/dispatch/checkpoint telemetry; không đổi graph count thành connected endpoint count. Session KPI dùng actual provider; chưa đọc được là unavailable, không phải 0.
- Open curated findings = confirmed/remediation/retest chưa resolved; review/draft và AI suggestions có count riêng. Các cross-tabs severity × workflow tính server-side cùng scope, không suy từ hai marginal totals.
- Tool calls/success rate và model usage/cache/input/output là secondary telemetry cards từ events thật. Unknown usage là not recorded; recorded token usage không là provider bill.
- Severity chart có legend/count, filter synchronized với Findings. Recent findings/facts và audit có resource links. Facts là recorded claims với provenance/confidence, không tự là verified finding.
- Poll/manual refresh hủy read lỗi thời, giữ dữ liệu trước khi background refresh, hiển thị partial/stale; tạm dừng khi page hidden. Không copy reference pattern biến mọi fetch lỗi thành null rồi trình bày như healthy.
- Required backend: reuse `InboxService`, existing overview/tasks/audit endpoints; bổ sung workspace overview/read catalogue sau ADR khi chưa có, với bounded provider fan-out ở server.

**Done:** trên dữ liệu canary thực, các count/filters khớp records; có active run/tool telemetry mới đi vào đúng sections; screenshot light/dark cho thấy hierarchy như reference; không còn chỉ một cột cards trống trải.

### 5.2. Projects, facts, scope, planning và environment

- Portfolio có search/status/owner/updated filters, counts và create wizard. Chi tiết dùng contextual shell, summary/status/preparation/next action, facts preview, recent work và counts.
- Facts master/detail, category/confidence/search và graph học R12; source là knowledge authority hiện tại. Mutation ghi qua owning runtime/public service, không tạo một blackboard DB copy độc lập.
- Scope/ROE có version/diff/review/time window/emergency contacts/effective targets, documents preview/edit qua supported contracts; asset import/classification và scope approval là các workflow liên quan nhưng khác record.
- Planning documents, OPPLAN, business plan giữ semantic khác nhau. ADR-0091: không có business plan dùng confirmed handoff + preflight; có plan dùng approved/current binding. Error CTA mở đúng blocker.
- Environment panel thể hiện resource thật, endpoint/sandbox binding và readiness scope; lifecycle integration/configuration có setup flow thay vì một nút giả success.
- Trusted identity/role từ session và server; sửa Settings đang hard-code Local Operator trong multi-user deployment.

**Done:** owner tạo project, reviewer xử lý scope; planning tạo documents thật; handoff/preflight/bind hoạt động qua UI; project/assistant/sandbox identities nhất quán sau refresh.

### 5.3. AI Workspace, Execution, agent instances và monitor

- Học R02/R04/R05/R16/R27 nhưng giữ cấu trúc Raptix đang dùng. Baseline real là `features/aichat/views/workspace.tsx:RealConversation`, không phải mock-only `operator-page.tsx`/`mock-workspace.tsx` có LeftRail. Conversation selector/search/rename/details ở header; chat/composer ở vùng chính; Agent sidebar có Agents/Progress/Artifacts, toggle và resize; embedded History mở drawer.
- Không dựng lại AI Workspace theo ba vùng cố định. Khi project sidebar đang mở, chỉ có chat và optional Agent sidebar trong phần content. Giữ selected conversation, scroll, draft, active run, observation selection, responsive behavior và các state đang hoạt động.
- Thêm thread search theo title/ID/kind vào dropdown hiện có; giữ rename/details/new planning/new execution và History launcher. Context/scope/plan version/blockers hiển thị gọn ở header badge/popover/expandable section, không chiếm thêm một cột.
- Giữ composer ở vị trí hiện tại; bổ sung upload/source chips, send/stop feedback, accessible shortcuts, drag/drop/progress. Tham chiếu capture/document identity và server-authorized context; giữ question/HITL cards trong flow hiện có, không chuyển sang một approval rail mới.
- Message types: text, thought/progress được phép expose, tool-call, bounded tool-result, approval, question, error, final/partial result. Long outputs collapse/copy đúng bytes/text; chat-scroll không giật khỏi vị trí đọc, có Return to latest.
- Stream/replay/dedup, same stable request ID, accepted/uncertain/rejected, reconcile; switch actor/project không cài late result vào scope khác. Graph interrupt khác operation pause và business approval.
- Bổ sung vào Agent sidebar hiện có: Agents hiển thị actual instance/objective/outcome; Progress hiển thị actual step/tool/document progress; Artifacts hiển thị actual files/captures/reports và links về owning surfaces. Mỗi count/list phải đúng selected thread/run hoặc ghi rõ project scope; không mở thêm context inspector song song.
- Run/trace/finding/evidence/session details sâu mở bằng existing drawer hoặc link sang Execution/Planning/Evidence/Sessions; giữ chat state khi đi và quay lại. Giữ flow chọn agent để quan sát invocation và quay về root conversation, không đổi đích gửi message một cách ngầm định.
- Execution list/detail có actual run raw statuses, timeline, trace, branch outcomes, graph/results; instance roster cho role/dispatch/objective/parent/outcome và các controls có contract thật. Giữ cancellation/complete semantics đúng server.
- Tool monitor có actual counts, status/tool/project/run/date filters, latency, bounded detail/source link. Exposure enabled, binary availability, invocation authorization và tool outcome là các trục riêng.
- Mọi filesystem/bash call của subagent phải truyền explicit run config đến per-engagement sandbox; kiểm cả upload/read và command execution, không chỉ một lệnh bash.

**Done:** một canary qua browser thực sự hỏi/trả lời, delegate, dùng tool, tạo artifact; refresh/reconnect không tạo run trùng; monitor/trace/results cập nhật từ producing execution và hiển thị đúng failed/partial branch. Before/after chứng minh các chức năng được bổ sung trên layout cũ: không có fixed history rail/cột thứ tư; kiểm desktop với project sidebar mở/thu gọn, Agent sidebar bật/tắt/resize và drawer ở viewport hẹp, trong cả embedded/standalone views.

### 5.4. Findings, Evidence và chat files

- Học R13/R15: clickable severity cards, primary/advanced filters, removable chips, sorting/pagination, master/detail với Summary & workflow / Evidence / Retest / Reproduce / History.
- Global inventory có authorized cross-project list; project view dùng cùng presentation với scope cố định. AI suggestions tách biệt curated workflow và count; preserve source quality, remediation, producer reference/digest.
- Edit/import/status transitions/comment/reference pickers hoạt động bằng persisted identities, expectedVersion và independent review. Returned reason không biến mất khi edit; approved/confirmed content update invalidate đúng theo server.
- Evidence có upload/import, classification, retained source/lineage, digest/size/media, related finding/run/session, original preview/download/copy. Phân biệt hash đã lưu và bytes đã được verify; original unclassified/sensitive theo quyền server.
- Agent producer format `findings/FIND-<id>.md`, evidence prefix `findings/evidence/FIND-<id>_*` giữ tương thích. Hiển thị từng skipped import; không âm thầm bỏ file lớn/unsupported. Nếu nâng bound hiện có, sửa contract/server/runtime tests và limit UI cùng nhau.
- Chat attachments dùng retained capture/document record và download authorization, hiển thị attachment trong history thực; upload không chỉ là toast hoặc local filename chip.

**Done:** agent artifact → AI suggestion → draft import giữ remediation → classify/attach → reviewer confirm → original download khớp digest; global filter/drill-down và operation references đúng sau reload.

### 5.5. Assets và Discovery

- Học đủ R09/R10/R11: summary/type/protocol, 7/30/90 trends, scan coverage; search + advanced filter/chips, saved views, multi-select, table/detail/import/export, Send to AI/Start operation.
- Managed metadata và observed graph data giữ origin riêng; ID dedup có strategy và references, không overwrite observation. Unknown OS/owner/protocol/scan time hiển thị chưa biết, không lấy dataset clock hoặc hash ID sinh dữ liệu.
- Coverage dựa trên actual completed scan observations/records có timestamp; never-scanned khác unavailable history. Risk dựa vào linked curated finding/observed claim với label phù hợp, không suy asset safe từ việc chưa có finding.
- Thêm schema/record cho metadata hoặc scan history còn thiếu; record discovery chỉ khi runtime có acknowledgement/outcome thật. Provider-specific recon ngoài scope hiện có không tự dựng endpoint giả; chọn actual available Raptix discovery capability và biểu diễn selection/state/output.
- Global inventory/filter/sort/pagination query server-side theo memberships; saved views per trusted actor; project list/detail dùng cùng read model. Bulk actions validate từng identity và báo partial/refusal.

**Done:** import dedup, scope classification, discovery canary tạo observed assets thật, coverage/trends thay đổi từ actual records; chọn asset mở chat/operation mang đúng context và gate.

### 5.6. Library, Playbook/Profile và Knowledge thật

- Học R07/R08/R23/R26. Navigation: Skills / Techniques / Playbooks / Profiles / Proposals / Knowledge. Public corpus không bị sửa trực tiếp từ Web.
- Managed Playbook/Profile: metadata, ordered steps, target constraints, canonical capability/technique refs, version/history, draft→review→approved/returned, independent reviewer, import/export validated. Dùng approval/version pin khi tạo operation; không tự bypass execution authorization.
- Knowledge: add/upload document, title/category/tags, actual bytes/digest/version, edit/delete/access scope; workspace-shared items và project-restricted items có explicit ACL và authorized citations.
- Index jobs là persisted jobs có pending/running/succeeded/failed, retry và version; index source text thật bằng PostgreSQL full-text search mặc định, worker có cơ chế claim/idempotency. Parse text/Markdown/JSON bằng executor thật; binary format chỉ expose khi có real extractor, lỗi phải hiện rõ.
- Search trả snippets, engine, matching document/version/source refs; retrieval history có actor/project/thread/run IDs khi có, result IDs/count/latency/outcome và redacted query metadata. Query từ UI và agent retrieval đi qua cùng authorized service; model answer có citations nguồn thật khi sử dụng tài liệu.
- Semantic/vector backend là optional capability. Có embeddings thì adapter/availability/probe thật; lexical mode không hiện label semantic hoặc lời hứa RAG chưa thực hiện.

**Done:** upload document thật → index thật → search/retrieval trả nội dung đúng version → agent tham chiếu tài liệu theo ACL → update/reindex làm kết quả đổi → history ghi actual retrieval. Không còn Knowledge mock hoặc production demo items.

### 5.7. Settings, Accounts, AI & Models, HITL/Tool Guard, MCP

- Học R03/R04/R06/R28/R29. Settings dùng section sidebar + form sections như reference, scope badge chính xác; General/Accounts/AI & Models/Usage/Integrations/Policies/Retention/Audit/Personal.
- Accounts master/detail và engagement assignments dựa trên actual users/session/memberships; fixed roles có permission explanation; độc lập owner/operator/reviewer/viewer và deployment-admin privilege. Account disable/password/session actions có server enforcement; không tự copy custom-role permissions của CyberStrikeAI.
- AI profile editor: name, model/provider reference, role mappings, defaults, supported generation settings, effective source/version; clone/default/delete/probe có persistence. Model probe gọi provider thật, bounded concurrency 2, timestamp/result, không ghi key/token vào log. Profile mới được runtime thread mới consume, thread đang chạy giữ pin.
- Usage: model/run/project/date aggregation từ native usage metadata; input/output/cache/reasoning accounting đúng source, cost chỉ khi có pricing/version thực. Empty/unknown không hiển thị như zero bill.
- Tool Guard: rule list/order/count/detail, dirty/reset/save, runtime-effective version, dry-run tool+arguments kiểm cùng evaluator mà không invoke tool. Matcher chỉ expose backend-supported bounded selectors; regex chỉ khi có validator/engine bounded phù hợp. Quy tắc additive, giữ last-known-good khi config invalid.
- HITL: workspace/project policy, per-thread settings và approvals/history hiển thị hiệu lực và inherited override. Mandatory dangerous-action controls và independent business review giữ nguyên.
- MCP: catalogue từ assembled tools và configured servers, health/probe, edit enabled/configured exposure qua supported public config. External server secrets server-side; endpoint/transport validation, authorization, timeout và threat model trước new boundary. Probe/connection thật và runtime consumer version, không chỉ sửa một row Prisma không ai đọc.
- Retention UI phân biệt persisted configuration với worker enforcement; implement worker nếu expose cleanup action, có legal hold/access semantics từ domain. Audit immutable; local theme/density là UI preference, không authorization state.

**Done:** authenticated identity đúng ở mọi header/detail; owner/admin save profile/policy/server config → consumer thật đổi ở phạm vi đã chốt → refresh/audit đúng; reviewer/viewer/refused/stale cases pass.

### 5.8. Analysis, Reports, Audit, Vault và Closeout

- Học fact graph R12, vulnerability detail R13, file patterns R15 và audit/settings R28; các workflow Raptix riêng phải giữ nguyên và đạt cùng visual system.
- Analysis: observed overview, attack paths/graph, MITRE coverage, detection signals với source/confidence/time và unknown/partial states. Detection absent không suy thành undetected/safe. Drill-down node/technique/finding/run đúng identities.
- Reports: template/editor/finding snapshots/preview/review/export/delivery/ack/revision thật; no-findings variant A08. Sensitive evidence/classification và approved versions giữ gates hiện tại; mỗi format chỉ bật khi có working renderer.
- Audit: workspace/project filters category/actor/time/resource/outcome, actual source/correlation/deep links; bridge runtime/C2/HITL events qua projection có source labels, không rewrite raw KG evidence.
- Vault: encrypted secret refs, masked metadata, authorized reveal/delete và audit; no secrets in general telemetry. Closeout kiểm actual active runs/sessions, pending review, retained evidence và reports; hoàn tất operation khác đóng engagement.

**Done:** report từ live canary finding và report no-findings đều review/export được; graph và audit dẫn lại producing execution; closeout block khi còn actual work và read-only sau khi đóng đúng lifecycle.

### 5.9. C2, WebShell và PTY

- Học R14/R17/R18/R19/R21/R22, `c2.css`; sidebar/list/detail/console/output/event hierarchy, không chỉ một form command.
- Reuse Raptix Sliver bridge/client/services/grant ledger. Listener/profile/session identity thuộc engagement; command có absolute binary + argv, exit/stdout/stderr/truncation, stable request ID và reconcile. Không replay một input unknown thành request mới.
- Native C2 acceptance dùng isolated local Sliver và owned test target/session; tạo actual profiles/listeners/grants, command, restart/reload/reconcile, expiry/refusal. Enrolment chỉ trong harness, không production payload UI.
- WebShell: implement explicit adapter contract cho một configured, operator-owned HTTP execution connection; encrypted credential reference, scope/grant/health/timeout/outcome/capture. Chỉ hiển thị file/terminal actions adapter thực hỗ trợ. Có thể dùng controlled local HTTP execution target để native test, không tạo WebShell bằng cách đổi label C2 transport.
- PTY: theo ADR-0095, explicit executable, open/input/resize/detach/terminate, một controller lease, operator takeover, transcript retained/capped, authorization và e-stop tại mỗi provider operation. Closing tab detaches; reload reattaches; terminate PTY khác kill implant.
- New boundary/safety-sensitive additions cần ADR/threat model trước code. Giữ đúng review/status requirements của repo; không tự chuyển Proposed thành Accepted. Nếu acceptance/status hoặc external access còn chặn release, ghi blocker chính xác và tiếp tục phần độc lập, không gọi single-shot là PTY hoàn chỉnh.

**Done:** provider round-trip thật; native PTY chứng minh `cd`/environment/Ctrl+C/detach/reload/takeover/cap; WebShell connection có actual request/outcome; unsupported provider là config state, không fixture transcript.

## 6. Contract/data implementation rules

- Recheck `apps/web/server/src/http/routes/` và `src/main.ts` trước thêm API. Các nguồn đã có gồm inbox/overview/tasks/notices, scoped runtime runs/events, scope/governance, findings/captures, reports, library, fleet, C2, workspace settings/audit. Existing route không tự chứng minh route available trong deployment.
- Bổ sung missing workspace catalog/overview endpoints, profile/policy/MCP/Knowledge/Playbook resources theo owning subsystem; Proposed ADR ghi request/response/errors/authorization/persistence/runtime consumer trước implementation. Không dùng endpoint CyberStrikeAI làm backend Raptix.
- New DTO có runtime validators; lists có total/pageSize/cursor hoặc documented bounds; mutations expectedVersion/requestId khi cần, transaction/audit, uniform foreign-resource refusal. Error giữ actionable reason và server code.
- Aggregation phải query từ authorized engagement set trước aggregate/pagination; kiểm foreign counts, truncated/lower-bound và consistency giữa charts và inventory cùng filter.
- Metric result có source availability, generated/observed time, scope và truncation; số không chỉ khi source thực sự đọc được. Provider health khác model/tool execution, stored config khác enforced policy.
- Browser query keys có actor/deployment/scope/filters; late responses không được đổi current scope. Time lấy từ record/server, không từ mock clock; các read model không fabricate missing fields.
- Runtime state/checkpoint, graph và raw artifacts giữ authority. Persist Web metadata, settings versions, managed documents/jobs/Playbooks và references tại server-owned DB/workspace. SDK/plugins không import runtime internals trái boundary.
- Khi đụng capability contracts, public Core API, middleware/concurrency hoặc safety, thực hiện invariant/ADR/test gates của root AGENTS; UI rollout/exposure không thay invocation authorization.

## 7. Tiêu chuẩn visual và functional parity

### Visual gate cho từng mapped page

1. Có reference excerpt/screenshots và Raptix screenshot cùng theme/viewport, ghi rõ R01…R29 và adaptation.
2. Section hierarchy/content density, primary/secondary actions, filter/selection/pagination/detail, states và typography không nghèo hơn reference trong miền đã chọn.
3. Palette/light-dark/spacing/card/table/form dùng unified tokens. Các trang redesign phải đạt content/layout hierarchy đã đặc tả; riêng AI Workspace giữ topology được người dùng chấp nhận theo A13 và nâng cấp tăng dần, không lấy visual parity làm lý do rebuild màn này.
4. Screenshot ở 1360/1440px, 1024px và 390px; không overlap/clipping/blank panels/whole-page horizontal scroll; keyboard/focus/reduced-motion và 4.5:1 text contrast.
5. Screenshot so với reference dùng để review intent; không đòi pixel-identical khi domain/data khác. Không bless thiếu nội dung thành screenshot baseline mới.

### Functional gate

Mỗi visible enabled action có actual implementation và positive/refusal/persistence checks. Production data source là API/runtime/provider; seeded demo, timer progress, hard-coded healthy và toast-only save không đạt. Optional unconfigured integration có reason/setup, nhưng required backend còn thiếu vẫn là blocker.

## 8. Execution waves và dependency gates

Mỗi wave chia thành tracer bullets vừa budget repo, không là một mega-PR. Ưu tiên một đường real xuyên layer trước khi nhân rộng. Không tự commit/push. Bổ sung tests trước fix khi có bug; docs-only không chạy full app suite.

| Wave | Phụ thuộc | Công việc và deliverable | Gate trước chuyển tiếp |
|---|---|---|---|
| W00 Baseline/reference/ADRs | — | Inventory source/deployment; R01…R29 reference map; map G/J/X/U cũ sang new mandatory cases; Proposed ADR cho boundary mới; identify actual config/credentials/provider prerequisites | Mọi reference page có adaptation/disposition; decisions A01…A13 được áp dụng; ghi baseline UI/source/image, không hỏi lại D-items |
| W01 Design system | W00 | Tokens, theme bootstrap/system preference, primitives, charts/legend/filter/master-detail, output/empty/error/loading; sửa contrast | Primitive gallery kiểm bằng tests only; light/dark/browser metrics pass, không ship demo gallery thành sản phẩm |
| W02 Shell/navigation/identity | W01 | Global 7 + project 14, subviews/aliases/back/history, responsive shell; session-driven identity; real-only default | Real user nhìn đúng identity; old links giữ scope; screenshots shell khác rõ bản cũ và học reference |
| W03 Overview/aggregate foundations | W02 | §5.1, authorized aggregates, metric definitions, telemetry ingestion/read projection còn thiếu | Actual records khớp filters/counts; cards/charts/feeds/queues/resources có sources và full dashboard hierarchy |
| W04 Findings/Evidence/files | W02 | §5.4, global inventory, attachment handling, original bytes/reproduce/retest/versioning | Import/review/retained capture/download/digest/foreign/stale checks pass; no lost remediation |
| W05 Projects/scope/planning | W02, W04 | §5.2, facts/documents/environment/project entries, effective scope, dual execution paths | Create→planning docs→handoff→scope/preflight/bind real; independent reviewer and correct sandbox binding |
| W06 AI/execution/monitor | W03–W05 | §5.3/A13, incremental additions vào header/chat/composer/Agent sidebar; actual stream/instances/tool monitor và recovery | Browser native model+tool+subagent canary; giữ layout hiện có khi project sidebar mở; questions/resume/timeout/cancel/read-back; telemetry cập nhật Overview |
| W07 Assets/discovery | W03, W05, W06 | §5.5, globals, metadata/history/coverage/trends/saved views, observed links | Actual discovery/import/dedup/scope/refusals; chart denominator và drill-down cùng source |
| W08 Library/Knowledge | W04, W06 | §5.6, managed steps/versions/review/execution pin; document bytes/jobs/index/search/history/agent retrieval | Approved Playbook thực sự tiêu thụ; document→index→query→agent citation→update/reindex real, zero mock Knowledge |
| W09 Settings/accounts/config/policy/MCP | W02, W06 | §5.7, admin/memberships, profiles and runtime consumer, usage, policy evaluator/probe/version, integrations | Save→read-back→consumer effect→audit; independent/denied/stale/secret-masking cases; no fake enabled state |
| W10 Analysis/facts/audit | W06, W07, W09 | §5.8 observed paths/coverage/detection, event taxonomy/projection and links | Actual tool outputs/graph/source refs; no inferred detection success; workspace/project scope filters |
| W11 Reports/vault/closeout | W04, W05, W10 | §5.8 plus no-findings variant; template/snapshot/review/export/revision; closeout consumers | Two real reporting variants; bytes/format/digest; actual blockers and lifecycle/read-only behavior |
| W12 C2/WebShell/PTY | W04, W05, W09, ADR boundary gates | §5.9 and native provider setup; adapters, grants, command/stream/transcripts | Native provider acceptance; no fixture success substitution; ADR/status blockers explicit |
| W13 Deployment/acceptance/polish | W03–W12 | Full real feature cases, visual comparisons, targeted regressions, source/build trace, deploy correct stack port 3001, final reports | §9–§10 complete; every mandatory case verified; exclusions only those declared in §1 |

Các wave về policy/config có thể cần server/runtime prerequisites sớm hơn: chia boundary/consumer tracer bullet trước, không vẽ UI editable rồi để consumer tới cuối mới làm. Mỗi wave tiếp tục sửa acceptance failures của chính mình trước khi tự đánh dấu complete.

## 9. Kiểm chứng tự động — từ checklist tới assertions thật

### 9.1. Machine-readable coverage

- Tạo/duy trì `apps/web/tools/verify/real-ui-cases.json` hoặc mở rộng manifest hiện có: stable case ID, reference ID, G/J/X/U mapping, route/section, role, real dependencies, actions/assertions, persistence check, evidence, required/excluded.
- Resolve old Knowledge mock criterion sang A09 real criterion bằng disposition `superseded`, không âm thầm skip. Các D-items cũ đã có default A-items, không còn lấy đó làm lý do hỏi owner.
- Extend runner để chạy actual cases; `deployed-checklist.mjs` chỉ read-only inventory/probes, không dùng output đó làm full certification. 200/heading/rendered là probe, không phải assertion của workflow.
- Mọi required criterion phải có executable case hoặc external blocker có evidence. `unverified`, config-gated required, baseline exception, `--discover` không làm release green.
- Unit/contract/permission/conflict/failure tests chạy targeted theo thay đổi; full checklist acceptance là danh sách được user yêu cầu, không đồng nghĩa chạy full Python/JS repo suite.

### 9.2. Các real end-to-end gate bắt buộc

| ID | Gate | Proof |
|---|---|---|
| E01 | Login/roles/scope/alias | Owner/operator/reviewer/viewer + foreign project, direct URL/back/refresh/mode cache isolation |
| E02 | Planning → execution | Real model, valid documents, handoff + preflight; governed-plan variant và refused stale/binding case |
| E03 | Agent/subagent/tool → persisted output | Actual per-project sandbox, explicit run config, marker/files + observed results; không chỉ direct factory probe |
| E04 | Stream/recovery/interrupt/stop | Same request/run IDs across reload/lost ACK; pending question restoration; real refused/timeout/cancel outcomes |
| E05 | Finding/evidence/report | Native producer → import giữ nội dung → classify/attach → independent confirm → report bytes/export/delivery/revision |
| E06 | No-findings report | Report thật không tạo fake finding; coverage/limitations + independent review/export |
| E07 | Aggregate/asset/discovery | Count/filter/permission consistency, actual discovery/scan records → history/trends/coverage; empty vs missing source |
| E08 | Knowledge/Playbook | Actual document/index/search/retrieval/citation/version; managed approved step profile used under gates |
| E09 | Config/policy/MCP | Persist version → effective runtime consumer; dry-run without invocation; actual provider/connection probe; safe refusal/source state |
| E10 | C2/WebShell/PTY | Native local providers/session, grants, command/output/reconcile, HTTP connection, PTY persistence/control/reattach/caps |
| E11 | Visual/accessibility | Reference/Raptix comparisons for all adapted pages, light/dark/responsive/keyboard/contrast; no dead required controls |
| E12 | Deployment | Correct image/assets/mode on 3001, final canary against that origin and real API, persisted data survives required reload/restart |

Dùng isolated canary records/services và namespace riêng; có thể bootstrap actual DB/users/providers bằng API thật. Không tấn công lab mục tiêu để thử harness, không reset user volumes, không reveal existing user secrets. Credentials từ approved local config hoặc generated isolated test setup; không đưa vào chat/report/log.

## 10. Build/deploy đúng nơi người dùng xem

1. Xác định container port 3001 bằng `docker ps/inspect` và Compose labels; dùng đúng project name, config files và environment đang vận hành. Baseline từng dùng `docker-compose.web-raptix.yml` + `docker-compose.web-runtime.yml`; recheck thay vì giả định.
2. Build bằng root lockfile/shared packages/Prisma prerequisites theo repo. UI Dockerfile là `infra/containers/web-raptix.Dockerfile`, API là `web-raptix-server.Dockerfile`. Vite inlines mode tại build; set real build đúng chỗ.
3. Tạo public-safe build manifest hoặc equivalent metadata: commit, dirty/source tree fingerprint, build time, data mode và entry asset fingerprint. HEAD label không đủ nhận diện working-tree changes.
4. Build/recreate đúng services thay đổi; giữ data volumes, port/network và runtime bindings. Không dùng `make smoke/clean`, blanket container cleanup, runtime restart toàn stack hoặc `docker cp dist` hot patch thay cho reproducible image release.
5. Migrate bằng owning API startup/deployment path; API update không tạo lại user DB. Runtime/sandbox image thay đổi phải version/pin và verify theo affected runtime gate.
6. Fetch `/` và assets từ 3001, đối chiếu manifest/marker; fresh browser real-mode login và inspect actual DOM/actions. Hash khác giữa OS/build không tự là stale; browser cache không là lời giải thích mặc định.
7. Giữ before/after screenshots, entry/image IDs, final acceptance results và cleanup status. Tạo rollback instruction cho đúng prior images, không rollback database bằng xóa volumes.

**Done:** screenshot và native workflow cuối là từ `http://127.0.0.1:3001`, không chỉ Vite 5273 hoặc disposable API đã bị dọn.

## 11. Progress và delivery record

Cập nhật bảng này theo evidence, đồng thời link kết quả vào integration coverage hiện có; không tạo thêm issue/ticket graph ngoài quyết định repo.

| Wave | Status | Source/contract/runtime changes | Targeted checks | Real/visual evidence | Blocker / next action |
|---|---|---|---|---|---|
| W00 | Partial, gate not met | Bản đồ R01–R29 tại `apps/web/.scratch/web-real-ui/reference-map.md` (29 container; R01 đầy đủ, R02–R29 mức cấu trúc) | Kiểm lại số container: 29 (6 container C2 nằm trong vùng `page-tasks`) | Ảnh reference: `scratchpad/checkpoint5/ref/shots/ref-dashboard-1440.png` (modal đăng nhập chặn, bố cục đọc được) | Hoàn thiện bản ghi chi tiết R02–R29 trước khi mỗi trang bắt đầu. Các trang R07, R08 (Knowledge) và R14, R17–R19, R22 (C2/WebShell) bị chặn bởi backend và ADR-0095 |
| W01 | Partial | `apps/web/src/index.css`: token primary blue, danger-fill, slate dark, focus; `ui/button.tsx`, `ui/status.tsx`, `ui/tabs.tsx`, `ui/input.tsx`, `ui/data.tsx`; badge và bước đang chọn trong shell/features | `src/ui` + `src/shell` (9 file / 105 test pass); `src/shell` (9 file / 67 test pass); typecheck và lint pass; `integration-path-click` dark pass: 8/8 (trước sửa 1/8) | Ảnh mock: `scratchpad/checkpoint5/ref/shots2/overview-*.png` | Chưa đo focus/hover/active cho từng control; chưa so sánh màu với reference cho từng trang |
| W02 | Partial | `shell/organization.ts` thay tên demo trong header, context ribbon bằng "Local workspace" ở real mode; giữ "Acme Security (Demo)" ở mock | `src/shell` 9 file / 67 test pass | — | Chưa làm: navigation project canonical 14 mục (real đang 17), Settings copy demo (logo "Acme Security", "Policy simulation", organization trong hồ sơ), route alias |
| W03 | Partial | Overview: sáu KPI, severity và workflow, hàng đợi quyết định, active operations, C2, nguồn dữ liệu (`features/overview/`). Server: `GET /api/overview/operations` (`inbox-service.ts`, `inbox.routes.ts`); ADR-0097 Proposed | `features/overview` 4 file / 15 test pass; `server` t15-inbox 6/6 pass; typecheck web và server pass; `stack.mjs --modes real --smoke-only --routes overview,tasks`: 2/2 route, 0 lỗi mới | Ảnh mock desktop, dark và phone trong `scratchpad/checkpoint5/ref/shots2/` | Thiếu: thời gian làm mới hiển thị; KPI agent instances và session còn "Per project" (runtime-backed, cần ADR riêng); chưa có tổng hợp tool/model usage |
| W04 | Pending | — | — | — | Findings/Evidence/files |
| W05 | Pending | — | — | — | Projects/scope/planning |
| W06 | Pending | — | — | — | AI/execution/monitor |
| W07 | Pending | — | — | — | Assets/discovery |
| W08 | Pending | — | — | — | Library/Knowledge |
| W09 | Pending | — | — | — | Settings/accounts/config/policy/MCP |
| W10 | Pending | — | — | — | Analysis/facts/audit |
| W11 | Pending | — | — | — | Reports/vault/closeout |
| W12 | Pending | — | — | — | C2/WebShell/PTY |
| W13 | Pending | — | — | — | Deployment/acceptance |

Agent phải tạo và duy trì:

- Reference map R01…R29 và design token/component adaptation notes.
- Case manifest + coverage report cho old checklist mapping và E01…E12.
- Evidence bundle tại `tests/local/artifacts/web-real-ui/<run-id>/`: screenshots/reference comparisons, sanitized browser/network/error results, actual record/thread/run/capture/report IDs, provider/config versions và generated artifacts.
- Source/status report có waves completed, pending/blocked, migrations, commands, deployment/rollback information và counts verified/failed/partial/unverified/excluded.

Khi context/session phải dừng, ghi completed wave, current failing case, exact reproduction, changed files và next command. Không gọi handoff là completed delivery.

## 12. Definition of Done cuối cùng

- [ ] Tất cả 29 reference pages đã được đọc/map; chỉ exclusions ở §1 được loại.
- [ ] Design system và các trang đạt hierarchy/content theo reference, giữ domain Raptix; AI Workspace bổ sung chức năng trên layout hiện có theo A13 thay vì rewrite thành ba cột.
- [ ] Global/project workflow bắt buộc có real contracts, consumers, records và outcomes; production không dùng mock data.
- [ ] Knowledge thật, config có consumer, accounts identity đúng, no-findings report và các global inventories hoàn thành.
- [ ] Native AI/subagent/sandbox/stream/evidence/report và native session gates pass với actual services. Required gate còn blocked/unverified nghĩa là mục này chưa hoàn tất.
- [ ] Mọi required action có success/refusal/persistence/recovery phù hợp; không còn placeholder/toast-only/dummy metrics để nhận parity.
- [ ] Old deep links, authorization, safety invariants, evidence authority và user data được bảo toàn.
- [ ] Targeted tests và visual/a11y gates pass trên tested tree; full acceptance coverage không còn required unverified cases.
- [ ] Bản đã build/recreate đúng stack và được kiểm trên 3001; final manifest/image/evidence truy xuất được.

**Final verdict chỉ có `COMPLETE` khi mọi mandatory gate đạt.** Báo `BLOCKED` kèm evidence và phần còn lại nếu dependency/ADR acceptance ngoài thẩm quyền chặn; tiếp tục mọi phần độc lập. Không thay implementation bằng việc viết lại kế hoạch hoặc kết thúc ở “đã build thành công”.

## 11.1 Bằng chứng đợt 2026-10-23

**Revision triển khai trên 3001:** `d2f82baa-wt-974ce59012` (HEAD `d2f82baa` cộng working tree; fingerprint là 10 ký tự đầu của sha1 của `git diff HEAD` và các file untracked trong `apps/web/src`, `apps/web/server/src`, `apps/web/tools`, `docs/adr`).

Triển khai và kiểm tra trên 3001:
- `docker compose -f docker-compose.web-raptix.yml -f docker-compose.web-runtime.yml build web-raptix-api` và `build web-raptix-ui`: exit 0. Sau đó `up -d --no-deps web-raptix-api web-raptix-ui`: exit 0. DB, runtime và các container khác không bị tạo lại.
- Label `org.opencontainers.image.revision` của hai container: `d2f82baa-wt-974ce59012`. API healthy. `/api/health` trả 200. `/api/overview/operations` và `/api/overview/findings` trả 401 khi chưa đăng nhập.
- Bundle đã deploy: `index` chứa `Local workspace`; chunk `keys-*.js` chứa `Active agent instances`, `Operation bindings by governance state` và `Recommended next actions`.
- Trang đăng nhập real render, không có lỗi console.
- **Trạng thái tại lần báo cáo này:** chưa kiểm tra được trên 3001 khi đã đăng nhập. Review độc lập tại §11.2 đã đăng nhập thành công bằng cấu hình local, nên blocker này đã được gỡ.

| Kiểm tra | Kết quả |
|---|---|
| Route smoke real, stack isolated có Neo4j, 55 route | 0 lỗi mới. 13 route khai báo do môi trường (runtime, C2 server, fixture chưa tạo). 3 khai báo không xảy ra |
| Route smoke mock, 55 route (sau khi khởi động lại dev server) | 0 lỗi mới |
| Flow mock | operations 7/7; agents 8/8; integration 24/24 (path 8, phone 8, dark 8); settings 2/2; projects 1/1; reports 1/1; analysis 1/1 |
| Vitest có mục tiêu | `src/ui` + `src/shell` audits: 9 file / 105 test. `src/shell`: 9 file / 67 test. `src/features/overview`: 4 file / 15 test. Server `t15-inbox`: 6/6 |
| Typecheck | web pass; server pass |
| Lint | web pass. Server có 3 lỗi đã có sẵn ở `main.ts`, `environment-recovery-live.ts`, `instance-mailbox.test.ts`, không thuộc thay đổi này |
| Boundary strict | pass; số vi phạm bằng baseline ở mọi rule |

**Thay đổi chưa commit** (không commit vì chưa có yêu cầu): các thay đổi pre-lab được kế thừa (C2 `provider*`, findings `api`/`remote`, `tools/verify/stack.mjs`, `deployed-checklist.mjs`, `flows/prelab.mjs`, các docs pre-lab); token và primitive (`index.css`, `ui/button`, `ui/status`, `ui/tabs`, `ui/input`, `ui/data`); badge và bước đang chọn (shell, notices, trace, wizard, findings, aichat); `shell/organization.ts` và header/context ribbon; overview (`features/overview/*`); server `inbox-service.ts`, `inbox.routes.ts`, `t15-inbox.test.ts`; `tools/verify/stack.mjs` (thêm `--smoke-only`); `docs/adr/0097-overview-operations-read-section.md` (Proposed); `apps/web/.scratch/web-real-ui/reference-map.md`.

**Chưa làm trong đợt này:**
- W04 đến W13 chưa bắt đầu. W02 còn navigation canonical 14 mục và copy demo trong Settings. W03 còn thời gian làm mới hiển thị, tổng hợp tool/model usage, và KPI agent/session cần ADR riêng.
- Canary runtime (T-01 đến T-12, T-R1 đến T-R3) chưa chạy. Lab `10.129.232.100` không được dùng trong đợt này: §9.2 cấm dùng lab mục tiêu để thử harness, và đợt này là UI. Canary runtime cần engagement và RoE cấu hình hợp lệ trước.
- Trạng thái "Đã hoàn tất" của plan chưa đạt. Không có mục nào đánh COMPLETE.

**Rủi ro cần xử lý ngoài đợt này:** `docker compose config` in ra giá trị secret dạng plaintext trong env của service `web-raptix-api` (mật khẩu DB và một API key). Nên chuyển sang `.env` đã loại khỏi git hoặc secret store. Không thay đổi trong đợt này.

## 11.2 Review độc lập sau deployment W00–W03

**Verdict: có thay đổi thật đã deploy, nhưng W00–W03 vẫn partial; chưa phải giao diện đạt reference và chưa có live workflow acceptance.**

- Container UI: revision `d2f82baa-wt-974ce59012`, image ID `sha256:8e00dfb40bcc5a00e80bdf349464ed71f12e54cd99d8e5f88b8db19260a83637`.
- Deployed entry: `/assets/index-Bs9Cw_8Q.js`; stylesheet `/assets/index-DSXaPg6v.css`.
- Fresh browser real mode đã login thành công trên 3001 bằng cấu hình local có sẵn; credentials không được in ra hoặc lưu vào báo cáo. Authenticated reads `/api/overview/findings`, `/api/overview/operations`, `/api/tasks` đều trả **200**.
- Read-only sweep đã mở 7 global pages và 17 project sections, không submit run, không reveal secrets và không dùng lab mục tiêu.
- Focused evidence sau khi hiệu chỉnh audit: `tests/local/artifacts/deployed-ui-after-w03-final/{audit.json,audit.md,G-01-real.png,G-07-real.png}`. Sweep rộng hơn: `tests/local/artifacts/deployed-ui-after-w03-verified/`.

| Mục | Quan sát trên deployment | Kết luận |
|---|---|---|
| Overview | Có hàng sáu cards, two-column sections, Refresh, Decision queue và Active operations | Thay đổi UI có thật; chưa đạt toàn bộ §5.1 |
| Agent/session KPI | Hai card vẫn ghi `Per project` | Chưa có required aggregate; không được tính thành hai metrics đã hoàn thành |
| Severity | Badge/count + workflow text | Chưa có severity chart/legend và interaction parity như reference |
| Freshness/resources | Thiếu last-updated/stale, tool/model usage, recent findings/facts/events, system health | W03 còn việc phải implement, không phải chỉ cần rebuild |
| Recommendations | Các nút quick actions tĩnh dưới tên Recommended next actions | Chưa chứng minh recommendation dựa vào trạng thái thực tế |
| Shell | Sidebar active vẫn dùng red accent và hình thức cũ; canonical project navigation chưa làm | W02 partial, các page/project views chưa có full visual redesign |
| Settings | Vẫn có `Acme Security (Demo)`, simulation text, project IDs mẫu và `Local Operator / local-single-user` trong deployment multi-user | Copy/identity bugs còn tồn tại và có screenshot thật |
| Native runtime | Chưa thực hiện canary planning→agent/subagent→sandbox→evidence/report trong review này | Giữ unverified; không lấy route smoke làm native proof |

**Contrast đã kiểm lại:** semantic dark primary label **5.169:1**, destructive label **6.470:1**, link/panel **6.977:1**, accent/panel **5.641:1**. Đây là token-combination checks, không là toàn bộ focus/hover/active audit. Hai contrast warnings trong các report sweep cũ không dùng để kết luận button mới lỗi: checker cũ đo sai token fill và không expand CSS shorthand `#fff`. Helper đã sửa, 4 regression tests pass; report focused nêu trên dùng phép đo đúng.

### Các điều chỉnh cần thực hiện khi tiếp tục

1. Gỡ trạng thái blocked về đăng nhập; dùng local configuration hoặc trusted session một cách kín, không dump `docker compose config`/env/headers. File `.env` không nằm trong git không tự ngăn Compose in resolved secrets vào log.
2. Hoàn thiện reference study: Dashboard reference thực tế có **5 KPI cards**; sáu KPI là adaptation Raptix. Screenshot bị login overlay che không đủ chứng minh visual parity. R01 chưa được gọi đầy đủ chỉ vì có bảng mapping; R02–R29 đọc chi tiết trước implementation.
3. Hoàn thiện W02 và W03 theo đặc tả, không tự giảm agent/session aggregates thành project links hoặc chart thành badges để nhận done.
4. Thêm regression source-failure cho operations summary: implementation hiện có `operationBinding.findMany(...).catch(() => [])`. Cần bảo đảm DB/read failure không bị chuyển thành `0 operations` và source `Read`. Đây là source-level finding cần tái hiện/đóng trong next fix.
5. Backend Knowledge chưa có là công việc W08 được yêu cầu implement, không phải external blocker để dừng cả nhiệm vụ. Native provider/PTY prerequisites chỉ chặn phần tương ứng W12; không chặn Findings/Assets/Settings/Library và các wave độc lập.
6. W04–W13 chưa bắt đầu vẫn là pending work. Nếu phiên làm việc dừng vì thời gian/context, báo `PAUSED` với next case/command; không đổi pending implementation thành environmental `BLOCKED`.
