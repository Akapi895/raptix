# Raptix Web: tổng hợp hoàn thiện giao diện

Ngày lập: **2026-10-22**. Baseline: **`d2f82baa` + các fix pre-lab chưa commit**.

**Kết luận:** migration cấu trúc đã tiến xa; khung điều hướng và nhiều workflow theo dự án đã hoạt động. Chưa đủ điều kiện nghiệm thu toàn bộ giao diện theo đề xuất: còn thiếu nội dung tổng hợp toàn cục, một số nhóm Library/Settings, policy editor và WebShell/PTY.

Tài liệu này dùng để review từng trang và đối chiếu sau fix. Checklist runtime nằm tại [runtime-prelab-readiness-2026-10-22.md](runtime-prelab-readiness-2026-10-22.md). Đề xuất gốc: [2026-10-22-web-page-details.md](proposals/2026-10-22-web-page-details.md).

## 1. Thế nào là giao diện hoàn chỉnh?

Một nhóm chức năng chỉ hoàn chỉnh khi đáp ứng đủ:

1. **Điều hướng:** người dùng tìm được chức năng, giữ đúng ngữ cảnh project và quay lại được.
2. **Nội dung:** các trường, tab, bộ lọc và trạng thái cần thiết hiện đúng ý nghĩa nghiệp vụ.
3. **Tương tác:** thao tác đọc/ghi/review/download hoạt động qua interface thật hoặc được xác định rõ là mock-only.
4. **Dữ liệu và quyền:** reload giữ được kết quả; server quyết định quyền và trạng thái; real không dùng demo fallback.
5. **Trải nghiệm:** loading, empty, error, unavailable, denied, conflict và recovery có thông báo/hành động phù hợp; dùng được trên màn hình hẹp, keyboard và dark mode.
6. **Evidence:** có kết quả kiểm tra đúng build/mode/role. Route tồn tại, tab render được hoặc strict gate pass chưa đủ để kết luận workflow hoàn chỉnh.

### Quy ước trạng thái

| Trạng thái | Ý nghĩa |
|---|---|
| Có implementation | Có code và đường wiring; khả năng deployment/live outcome cần ghi riêng |
| Đã kiểm chứng | Đã chạy đúng hành vi nêu trong evidence |
| Partial/unwired | Có một phần nhưng thiếu nội dung, thao tác hoặc integration |
| Missing Web surface | Chưa có UI/contract Web tương ứng trong phần đã đối chiếu |
| Config-gated | Có implementation, deployment thiếu cấu hình/provider |
| Unverified | Chưa có bằng chứng đủ để kết luận |
| Excluded/deferred | Đã chấp nhận không làm ở phạm vi tương ứng |

Các kết luận thiếu bên dưới nói về Web surface/integration, không tự khẳng định Python runtime thiếu capability.

## 2. Baseline đã hoàn thành và inventory hiện tại

### 2.1. Cấu trúc

- Đã bỏ `apps/web/src/screens/` và `apps/web/src/real/`.
- Presentation nằm trong feature hoặc shell; shared browser machinery nằm trong `platform/`; composition nằm trong `state/`.
- Route declaration tập trung tại `src/router/routes.ts`; registry vẫn sở hữu việc mount slice.
- Overview dùng một presentation cho mock/real.
- Alias `command-center → overview`, `plans ↔ planning`, `sessions ↔ c2` đã có.

Boundary checker vẫn có **411 vi phạm được baseline cho phép**:

| Loại | Số lượng |
|---|---:|
| Production imports demo | 39 |
| Production type imports demo | 65 |
| Production imports composition | 30 |
| Presentation imports adapter | 10 |
| Presentation mock plumbing | 49 |
| Deep feature imports | 218 |

Ví dụ: `features/projects/views/project-settings-panel.tsx` còn import trực tiếp `../remote`.

Strict pass hiện là ratchet không tăng nợ. Khi hoàn thiện một feature, đưa các consumer bị sửa về public interface/query/port của feature, thay vì chỉ đổi thư mục hoặc thêm barrel. Mục tiêu ADR-0096 và nghiệm thu UX là hai tiêu chí cần ghi riêng.

### 2.2. Route và navigation

| Inventory | Source hiện tại |
|---|---|
| CyberStrikeAI reference | 29 page containers trong `web/templates/index.html` |
| Raptix | 54 route mặc định; 55 khi bật Asset Map |
| Global sidebar | 7 mục |
| Project sidebar mock | 13 mục; 14 khi bật Asset Map |
| Project sidebar real | 17 mục; 18 khi bật Asset Map |

Source authority: `src/router/{routes.ts,aliases.ts,host.tsx}` và `src/shell/nav.ts`.

**Đích điều hướng:** giữ hai tầng và một vocabulary thống nhất. Số “14 mục dự án” trong proposal chưa khớp implementation; cần chốt cách nhóm nội dung trước khi coi đó là acceptance count. Không xóa khả năng chỉ để đạt số mục.

- Assets hiện chưa có mục sidebar dự án riêng như đề xuất; các resource route đang được nhóm vào Scope & ROE.
- Real còn các mục Fleet, Governance, Vault, Project Settings, Closeout riêng.
- Giữ các deep link/alias và đúng highlight khi drill-down sang finding, report, asset, operation, session.
- Reports nằm trong dự án; không cần thêm lại một mục global Reports để đạt parity.

### 2.3. Cập nhật sau đánh giá ban đầu

- Đã sửa mất remediation khi import AI suggestion thành curated draft.
- Đã sửa C2 argv; thêm retained stdout/stderr đầy đủ và truncation flags.
- Workflow findings/evidence với API/DB thật, independent review, reload/download đã pass.
- Reports checklist 27 thao tác đã pass, gồm PDF export. Không tiếp tục coi comment cũ “PDF/DOCX là gap” là kết luận hiện hành; mỗi format phải đối chiếu implementation/evidence riêng.
- Sidebar/breadcrumb contrast và layout đã có browser checks pass. Các vấn đề contrast còn lại phải ghi đúng component/state, không gọi chung là toàn bộ dark mode chưa đọc được.
- Ở baseline pre-lab, các fix frontend mới build local. Audit deployment sau đó đã xác nhận cổng 3001 phục vụ một bản rebuild có marker C2 argv/output mới; các nội dung UI còn thiếu trong tài liệu chưa được implement chỉ bằng việc rebuild.

## 3. Tầng toàn cục: bảy mục cần hoàn thiện

Các đường dẫn `features/...`, `shell/...`, `ui/...` trong phần này tương đối với `apps/web/src/`.

| ID / trang | Hiện trạng | Nội dung đích và việc còn lại | Layer phụ thuộc / acceptance |
|---|---|---|---|
| G-01 Overview | Shared view có quick actions, projects, findings rollup, C2 audit rollup, task inbox | Hoàn thiện KPI có định nghĩa rõ; active operations; system health; recent audit; attention items mở đúng đối tượng | `features/overview/` + shared contract/server aggregates. Số liệu đúng authorized scope; source lỗi không thành số 0; mỗi CTA có đường đi thực dụng |
| G-02 Projects | Shared portfolio; create/detail có integration và browser evidence | Đối chiếu các cột/filter/export của proposal với DTO; hiển thị lifecycle thật, preparation checks và bước tiếp theo; preserve project context | `features/projects/`. Create/open/reload/denial pass; không dùng bộ trạng thái project mock thay contract thật |
| G-03 Findings | Real global chỉ có count rollup và link về project | Hàng đợi xuyên dự án, filter project/severity/status/search, phân biệt curated và AI suggestions, pagination và drill-down | `features/findings/` + aggregate contract/service. Phải có inventory thật; count không thay list; foreign projects không lộ dữ liệu |
| G-04 Assets | Inventory/import/classification theo engagement; chưa có global inventory và analytics | Ba nhóm Overview / Library / Discovery; project filter, nguồn observed/managed, phân bố/risk/scan coverage có provenance; discovery có kết quả và trạng thái thật | `features/assets/` + inventory/graph/runtime projections. Không suy ra coverage từ managed rows; global aggregation và discovery cần contract phù hợp |
| G-05 Library | Route `playbooks` hiện render Skill library; có skill detail, technique detail, proposal/review | Phân định rõ Skills/Proposals và Playbook/Profile; nếu giữ đầy đủ proposal thì cần ordered-step form, version/review và technique catalog tương ứng; thêm Knowledge mock | `features/library/`, feature Knowledge dự kiến và contract/corpus owners. Không gọi skill detail là Playbook/Profile builder; Knowledge real báo chưa tích hợp |
| G-06 Infrastructure | Global có rollup/link về project; chưa có live global fleet/session inventory | Agent/fleet observations, C2 infrastructure và sessions theo nguồn thật; giữ giám sát khác cấu hình; chọn/open đúng project/resource | `features/overview/views/global-resource.tsx`, `features/{operations,c2}/` + provider projections. Không dùng graph ID làm host heartbeat; provider absent có reason |
| G-07 Settings | Real có Organization, Integrations, Policies, Retention, Audit; nhiều tab khác chỉ mock | Sửa copy demo; bổ sung AI/model settings, Tool Guard/HITL defaults; làm rõ tích hợp MCP; chốt scope organization-level administration | `features/settings/` + config/identity/service owners. Save/read-back/version/audit thật; không nhận lưu config là đã enforcement |

### 3.1. Overview: acceptance nội dung cụ thể

- [ ] Sáu KPI theo đề xuất: active projects, active operations, pending plans/approvals, connected agents, active sessions, open findings.
- [ ] Mỗi KPI phân biệt được dữ liệu không có, không đọc được, truncated và con số thực sự bằng 0.
- [ ] Attention/task items có target, scope và CTA đúng; không dẫn người dùng vào một trang unavailable mà thiếu hướng tiếp tục.
- [ ] Active operations, recent audit và system health dùng source thật với định nghĩa/độ mới rõ ràng.
- [ ] AI suggestions không bị tính thành confirmed/open curated findings.

### 3.2. Settings: acceptance nội dung cụ thể

- [ ] Real header/banner không còn `Acme Security (Demo)`, “This is a simulation” hoặc project IDs mẫu.
- [ ] Organization/workspace/project/personal scope được ghi đúng; không nói workspace setting áp dụng/enforce mọi nơi nếu chưa có consumer.
- [ ] AI/model settings thể hiện model/provider/default/profile, read/write quyền hạn, effective configuration và phạm vi áp dụng cho thread/run.
- [ ] Tool Guard/HITL defaults và project override có supported schema, persistence và enforcement site; session HITL switch không thay thế policy editor.
- [ ] Integrations phân biệt capability availability với connect/configure/monitor operations.
- [ ] Retention vẫn ghi rõ configuration-only nếu chưa có scheduled enforcement.
- [ ] Quyết định rõ organization-wide user/role registry: xây domain tương ứng, hoặc chấp nhận engagement-scoped membership và điều chỉnh mục tiêu UI. Không đồng nhất tab mock với registry thật.

## 4. Project workspace: checklist theo miền chức năng

Bảng này liệt kê các surface/resource flow, không phải yêu cầu phải có tương ứng từng mục sidebar.

| ID / surface | Baseline | Việc cần hoàn thiện / acceptance |
|---|---|---|
| J-01 Overview | Có Next step, preparation checks, environment, identity, counts, shortcuts | Facts/objectives/completion/recent activity/closeout summary phải có source hoặc exclusion; nhãn preparation không thay authoritative preflight; CTA mở đúng phần cần xử lý |
| J-02 Scope & ROE / Documents | Có scope revision, asset classification và planning document flows | Hiển thị effective version, diff, review, expiry/window/emergency contact; lỗi/denial có hướng sửa; document không bị gọi là Web scope approval |
| J-03 Assets | Có resource routes và engagement inventory | Chốt entry từ project; list/detail/import/scope review giữ scope; quan hệ operations/findings/evidence hiện còn unmodelled phải ghi rõ, chỉ bổ sung khi có persisted refs |
| J-04 Planning | Có readiness/handoff và governed plan surfaces | Phân biệt planning bundle, OPPLAN và business plan; review/compare/bind đúng version/thread; không ghi mọi execution đều bắt buộc approved business plan |
| J-05 AI Workspace / Copilot | Có real conversation dropdown/header, chat/composer, optional Agent sidebar, History drawer, interrupts/HITL và execution context | Giữ layout RealConversation; bổ sung context/tool cards/attachments/recovery vào controls và Agents/Progress/Artifacts hiện có; không thêm fixed history rail, inspector thứ hai hoặc cột thứ tư khi project sidebar mở |
| J-06 Execution / Operation / Trace | Có runtime runs, lifecycle, trace và results | Chuẩn hóa các view list/detail/live/timeline/results; raw status, failed/partial branch và uncertain request rõ ràng; không hứa graph/cancel/retry/reassign ngoài action contract thực có |
| J-07 Asset Map | Feature-flagged, off mặc định | Navigation và deep link đúng khi bật/tắt; graph/filter/detail/selection giữ project; không thay run controls hoặc inference readiness |
| J-08 Fleet / Fanout | Có graph/thread/branch observations | Phân biệt graph catalog, agent invocation và host executor; drill-down đúng identity; controls chỉ mở khi runtime có contract tương ứng |
| J-09 C2 Sessions / Console | Có provider registry, listeners/profiles, grants, single-shot commands; provider hiện config-gated | Owned session/channel/detail, grant request/review/expiry, output/reconcile và reload; WebShell/PTY là phần riêng chưa có parity. C2 thật deferred cho lượt lab AI, chưa phải xóa khỏi đích sản phẩm |
| J-10 Findings | Có curation/lifecycle/comment/retest/reproduce; remediation import đã sửa | Đi hết AI suggestion → draft → evidence → review → confirm; version conflict giữ form; execution/asset/technique refs đúng identities; từng tab có dữ liệu hoặc thiếu-source state |
| J-11 Evidence / Inspector | Có captures, classify, download/digest, workspace import | Có upload/import progress/result/skipped, source/lineage, finding links, classification/permission reason; original bytes đúng digest; không coi claim text là capture |
| J-12 Analysis | Có observed graph/coverage presentation | Chốt parity của overview, attack paths, MITRE, detection với source thực; dữ liệu thiếu không thành “không bị phát hiện”; detection mapping không được suy ra khi chưa có telemetry |
| J-13 Reports | Có stored templates, editor, review, export, delivery, revision | Kiểm nội dung từ chính finding/evidence của live run; version snapshots và independent review; preview/download đúng format/content; readiness/refusal có cách sửa |
| J-14 Team & Approvals | Membership theo engagement và approval workflows có integration | Role labels phải khớp trusted membership; reviewer khác author; phân biệt business approvals, tool HITL và graph interrupt; refresh/revocation/refusal đúng |
| J-15 Activity & Audit | Có project audit/filter và workspace audit riêng | Chốt event taxonomy và mapping C2/HITL/execution; resource links/correlation ID; không đổi project audit thành global chỉ bằng tên nhãn |
| J-16 Vault | Có project secret workflow | Quyền create/reveal/delete, reveal audit, masked state, refusal/reload; không đưa secret vào telemetry/copy debug |
| J-17 Governance | Có plan bindings, scheduling/stop-related controls | Hiển thị version/pin/window/expiry; thao tác refused giải thích đúng; stop acknowledged/terminal không bị gộp thành đã dừng |
| J-18 Project Settings | Real form chủ yếu display name + primary target; Vault/Governance tách riêng | Đối chiếu metadata/danger-zone support; thêm Tool Guard/HITL overrides khi có contract; target lifecycle refusal giữ draft và reason |
| J-19 Closeout | Có closure feature | Checklist phải dùng run/session/evidence/report state thật; chỉ đóng khi điều kiện thật đạt; không giả định grant revoked là provider session đã kết thúc |

## 5. Chất lượng UI xuyên suốt cần đóng

| ID | Việc cần làm | Acceptance |
|---|---|---|
| X-01 Scope/navigation | Một model nhãn/group/alias rõ cho mock/real; back/deep link/project switch đúng | Drill-down finding/report/asset/session rồi Back không rơi về sai global/project; URL mang identities đúng |
| X-02 States | Chuẩn hóa loading, no records, filtered empty, source unavailable, denied, conflict, partial/truncated, expired và recovery | Không có fake zero/seed fallback; có reason và next action; source lỗi không xóa draft |
| X-03 Contrast | Tách token button fill khỏi text/link nếu cần; kiểm normal/hover/active/focus trong hai theme | Chữ thường đạt 4.5:1. Dark primary white trên `#E5484D` khoảng 3.91:1, solid danger white trên `#F87171` khoảng 2.77:1, accent trên panel khoảng 4.45:1 là các điểm cần đóng |
| X-04 Responsive/keyboard | Conversation header/Agent sidebar hiện có, tables, command output, modals/drawers, sticky controls | Không tràn toàn trang; chat vẫn đủ không gian với project sidebar mở; bảng/pre có scroll riêng; focus/escape/submit/return-focus hoạt động, không chỉ chuột |
| X-05 Forms/async | Dirty guard, validation, pending, duplicate submit, version conflict và saved/error messages | Dữ liệu người dùng không mất khi denied/timeout/conflict; refresh thể hiện persisted state; uncertain command có recovery đúng identity |
| X-06 Mode/authority | Shared presentation đọc port/query; demo vocabulary/dataset không lọt vào real | Real outage hiện source/refusal; mock độc lập backend; chuyển mode/actor không tái dùng cache/recovery sai scope |
| X-07 Terminology | Thống nhất Project/Engagement, Planning/Plan, Runtime Agent/Fleet, Evidence/Claim, Audit/Transcript | Labels không tạo kỳ vọng capability/enforcement không có; raw provider/runtime status được giữ khi chưa có mapping |
| X-08 Delivery | Source/build, deployment image và evidence phải cùng phiên bản | UI người dùng mở thực sự chứa fix; kiểm build artifact/proxy/session path, không chỉ source dev server |

**Contrast note:** đợt browser check gần nhất đã pass sidebar inactive text, section labels, breadcrumb và layout tại 390px. Các ratio button/accent trên là kết quả đối chiếu token/component, cần kiểm browser các state sau sửa. Không tối toàn bộ accent để chữa button rồi làm link khó đọc hơn.

## 6. Mapping CyberStrikeAI → đích Raptix

CyberStrikeAI là nguồn tham khảo thông tin/workflow. Số page containers không là denominator cho phần trăm hoàn thiện của Raptix.

| CyberStrikeAI page/group | Đích Raptix | Trạng thái cần ghi nhận |
|---|---|---|
| Dashboard | Global Overview | Partial; G-01 |
| Chat | Project AI Workspace / Copilot | Có real integration; live E2E cần evidence |
| Tool Guard | Workspace defaults + Project Settings override | Missing policy editor như đề xuất |
| HITL | Task inbox, Team & Approvals, AI tool approvals, policy settings | Approval/switch có; policy/whitelist editor còn thiếu |
| Projects | Projects + project workspace | Các luồng chính có; kiểm từng resource flow ở §4 |
| Asset overview / asset library / info collect | Assets Overview/Library/Discovery + Execution | Inventory theo project có; analytics/global aggregation/discovery parity còn thiếu |
| Vulnerabilities | Findings global/project | Project lifecycle có; cross-project queue còn thiếu |
| Tasks | Overview inbox + Execution | Không coi inbox là batch execution UI |
| Workflows | Library Playbook/Profile dạng form có thứ tự | Canvas đã excluded; không tự suy ra ordered-step builder đã có |
| WebShell | Session domain / console | Chưa có WebShell/PTY real parity; ADR-0095 Proposed |
| Chat files | Evidence + chat attachment/source flow | Evidence có; attachment wiring phải kiểm riêng |
| C2 listeners / sessions / tasks / profiles | Infrastructure + project C2 | Có một phần provider-backed; global inventory thiếu; live provider config-gated |
| C2 events | Audit filters + command audit | Mapping event đầy đủ chưa kiểm chứng |
| C2 payloads | Không có mục tương ứng | Payload generator đã excluded |
| MCP monitor / management | Execution tool trace + Settings Integrations/monitoring | Availability list chưa tương đương quản trị/giám sát MCP |
| Knowledge management / retrieval logs | Library Knowledge | Chưa có cả tab mock; RAG backend để sau |
| Skills management | Library Skills + proposal/review | Có corpus read-only/review; publish không tự sửa corpus từ UI |
| Skills monitor | Không có usage-statistics tab | Đã excluded |
| Agents management | Fleet / Infrastructure | Có runtime observations theo project; chưa phải global host-agent administration |
| Roles management | Specialist control tương lai | Agent-role management đã excluded/deferred; khác platform RBAC |
| Platform RBAC | Settings + Team | Engagement membership có; org-wide registry cần quyết định scope |
| Settings | Workspace/Project settings | AI/model và Tool Guard/HITL defaults còn thiếu; Update tab đã excluded |

### Exclusions đã chốt

- Workflow canvas.
- Payload generator.
- Agent-role management; specialist-control tab là khả năng tương lai.
- Skill usage-statistics tab.
- Settings Update tab.
- Knowledge giai đoạn này chỉ cần mock tab và real unavailable state; RAG thật làm sau.

**Phân biệt:** C2 provider thật chỉ được hoãn cho lượt lab AI hiện tại; chưa là quyết định bỏ C2 khỏi toàn bộ sản phẩm. WebShell là yêu cầu chưa hoàn thành, không được đánh dấu implemented chỉ vì mock có `kind: web`.

## 7. Chỉnh tài liệu và contract trước khi dùng làm acceptance

- [ ] Sửa source paths `screens/*`, `real/*` đã xóa trong proposal.
- [ ] Cập nhật route/sidebar counts và ghi điều kiện Asset Map flag.
- [ ] Ghi nhận Overview đã gộp; bỏ các todo gộp cũ.
- [ ] Thay “đầy đủ” bằng trạng thái theo read/write/realtime và mock/real từng surface.
- [ ] Sửa nhận định WebShell có sẵn; đối chiếu ADR-0095 trước PTY implementation.
- [ ] Sửa authorization ở §3.4 theo hai đường của ADR-0091.
- [ ] Chốt project audit/workspace audit và nơi tích hợp C2 events.
- [ ] Chốt nhãn và semantics Library: skill corpus, proposal, playbook/profile và technique catalog.
- [ ] Chốt phạm vi organization users/roles và canonical project navigation; không dùng inventory mock cũ để kết luận backend membership chưa có.

Với khoảng trống cần contract/API mới, trace `UI → apps/shared/web-contracts → server route/service → runtime/provider → persisted evidence` trước implementation. Availability và quyền invocation là các trục riêng. API/subsystem boundary mới theo contribution contract/ADR của repo.

## 8. Thứ tự triển khai đề nghị

| Mốc | Mục tiêu | Các việc ưu tiên | Nghiệm thu |
|---|---|---|---|
| UI-A: usable project workflow | Luồng vận hành thật trước lab | Deploy các fix; sửa Settings demo copy; đóng contrast đúng component; xử lý blocker chat/navigation/dirty/recovery; hoàn thiện entry findings/evidence/report | Một project canary đi hết workflow. Điều kiện execution theo checklist runtime companion |
| UI-B: đủ nội dung tầng toàn cục | Bảy mục navigation thực sự có ích | Overview theo G-01; Findings queue xuyên project; global Assets; Infrastructure aggregates đúng nguồn; tránh CTA dead end | Dữ liệu đúng authorized scope; filter/drill-down/pagination và source-error states |
| UI-C: đủ các miền đã chốt trong proposal | Library/Settings/policy content | Playbook/Profile semantics và interface; Knowledge mock; AI/model settings; Tool Guard/HITL defaults và override; MCP monitoring/configuration scope | Read/write/review/persistence thật theo contract; mock-only và exclusions rõ |
| UI-D: advanced sessions và polish | Đóng parity còn lại | WebShell/PTY sau ADR; live C2/global infrastructure khi provider có; tiếp tục responsive/a11y/performance theo surface | Native/provider evidence đúng tính năng; đủ states; không lấy fixture làm chứng nhận live |

Mỗi thay đổi một concern, giới hạn diff theo repo. Boundary debt được giảm khi chạm feature; không biến đợt hoàn thiện UX thành một refactor toàn repo.

## 9. Kiểm tra và gate nghiệm thu giao diện

### 9.1. Ma trận tối thiểu theo surface bị đổi

| Trục | Các trường hợp cần chọn |
|---|---|
| Mode | Mock và real; real khi dependency/provider thiếu |
| Actor | Owner/operator, reviewer khác author, viewer/foreign engagement theo hành vi bị sửa |
| Data | Có dữ liệu, rỗng, filter không khớp, partial/truncated, stale version |
| Transport | Loading, refusal, outage/timeout, reconnect hoặc reconcile nếu có execution |
| Navigation | Entry, detail, Back, refresh/deep link, project switch; giữ đúng selected resource |
| UI | Light/dark; normal/hover/focus/active ở control sửa; desktop và viewport hẹp |
| Persistence | Save/read-back/reload; version/ref/audit/digest tương ứng với loại mutation |

Targeted tests theo feature; chỉ chạy thêm browser flows/stack consumers bị ảnh hưởng. Fixture kiểm presentation/transport mapping, không chứng minh model, provider hoặc benchmark outcome.

### 9.2. Gate “giao diện hoàn chỉnh”

- [ ] Navigation/model/alias được chốt và tài liệu khớp source.
- [ ] Mỗi mục global có nội dung đúng G-01…G-07 hoặc exclusion được chấp nhận rõ.
- [ ] Các project workflow cần dùng trong J-01…J-19 hoàn thành; phần config-gated có reason và đường tiếp tục.
- [ ] Các tính năng mock-only được tách rõ; real không có demo facts, fake health hoặc fake success.
- [ ] Không còn mất dữ liệu khi save/import/review/reload; version/ref/digest đúng.
- [ ] Cross-project inventory và drill-down không đổi nghĩa scope hoặc lộ project không được phép.
- [ ] Forms, empty/error/refusal/recovery states đã được dùng thật, không chỉ snapshot render.
- [ ] Contrast, keyboard và responsive pass trên component/state được sử dụng.
- [ ] Các thay đổi nằm trong build/image thực tế người dùng mở.
- [ ] Evidence ghi đúng revision/mode/role/config; unexecuted live checks giữ nguyên là unverified.

### 9.3. Bảng đối chiếu sau fix

| Ngày / revision / image | ID G/J/X hoặc UI-A…D | Hiện trạng trước fix | Thay đổi + layer sở hữu | Targeted check / browser flow | Evidence | Trạng thái còn lại |
|---|---|---|---|---|---|---|
| Chưa cập nhật | Điền ID | Missing / partial / config-gated / unverified | Điền file/contract/service | Ghi thao tác thực chạy | Đường dẫn + kết quả | Pass / còn blocker / exclusion |

**Điểm bắt đầu:** chốt usable project workflow trước; sau đó hoàn thiện global data/content và Library/Settings. Migration file/folder đã gần hoàn tất, phần còn lại chủ yếu là semantics, nội dung và integration của các workflow.

## 10. Acceptance chi tiết theo hành trình người dùng

Các mục dưới đây mô tả đích nghiệm thu sau fix. Trạng thái đã thực hiện vẫn theo baseline ở §2 và evidence được cập nhật trong §9.3.

### U-01. Đăng nhập → chọn hoặc tạo dự án → vào workspace

- [ ] Đăng nhập xong quay về URL hợp lệ đã yêu cầu, giữ project/resource nếu actor có quyền.
- [ ] Projects chỉ hiện các engagement được phép; create CTA theo đúng quyền server và có refusal rõ nếu quyền đã thay đổi.
- [ ] Create form giữ dữ liệu khi validation/save lỗi; thông báo thành công chỉ xuất hiện sau khi server xác nhận.
- [ ] Tạo xong mở đúng project; reload hoặc mở lại từ portfolio vẫn là cùng record.
- [ ] Header/sidebar cho thấy tên project, lifecycle và phần đang mở; có đường về Projects.
- [ ] Environment panel phân biệt chưa chuẩn bị, đang chuẩn bị, sẵn sàng, lỗi và không có lifecycle integration. Dependency-ready không được trình bày thành model/tool execution đã thành công.

**Tình huống phải kiểm:** deep link trước login; viewer mở create route; project bị xóa hoặc actor bị gỡ membership; environment chưa cấu hình.

### U-02. Planning chat → trả lời câu hỏi → handoff

- [ ] Tạo/chọn planning thread từ AI Workspace; conversation dropdown/header hiện đúng thread và loại hội thoại.
- [ ] Composer thể hiện gửi đang pending, accepted, refused hoặc chưa xác nhận; không tự gửi lại thành request mới khi mất ACK.
- [ ] Câu hỏi của planner có câu trả lời đúng định dạng, trạng thái đang chờ và lỗi submit; refresh phục hồi đúng pending question.
- [ ] Planning documents mở xem được từ nguồn thật; thiếu hoặc invalid document chỉ rõ tên và lý do.
- [ ] Handoff CTA chỉ có hiệu lực khi server chấp nhận readiness; lỗi handoff giữ nguyên ngữ cảnh và có hướng sửa.
- [ ] Sau handoff, chuyển sang execution đúng project/thread kind; nội dung planning vẫn đọc lại được.
- [ ] Nếu dùng business plan, người dùng tìm thấy propose/review/compare/bind và thấy version/ROE pin/expiry liên quan. UI không gộp planning bundle, OPPLAN và business plan thành cùng một record.

**Tình huống phải kiểm:** còn document invalid; câu trả lời parallel questions; handoff chưa xác nhận; plan thay version hoặc hết hạn; refresh giữa planning và execution.

### U-03. Execution chat → theo dõi agent/tool → phục hồi

Đích bố cục của AI Workspace theo yêu cầu mới: giữ real-mode layout hiện có, bổ sung tăng dần. Baseline là `features/aichat/views/workspace.tsx:RealConversation`; mock-only LeftRail không là chuẩn để rewrite màn real.

```text
Project sidebar | AI Workspace content
                | Conversation dropdown + actions + History / panel toggle
                | ┌───────────────────────────┬─────────────────────────┐
                | │ Conversation + composer   │ Existing Agent sidebar  │
                | │ Text/tool/question/HITL    │ Agents/Progress/Artifacts│
                | │ Context badge/popover     │ Toggle / resize         │
                | └───────────────────────────┴─────────────────────────┘
                | History/details dùng menu hoặc drawer, không thêm left rail
```

- [ ] Thread được bind đúng assistant/project; UI cho xem identity nhưng không lấy role/persona phía browser làm authority.
- [ ] Text stream, tool call, tool result, question, approval và error phân biệt bằng cấu trúc/nhãn, không chỉ màu.
- [ ] Agent sidebar hiện có cho biết instance/objective khi runtime có source; Progress/Artifacts được bổ sung bằng output thật, scope đúng selected thread/run hoặc ghi rõ project-level.
- [ ] Chuyển tab hoặc toggle Agent sidebar không tự dispatch lại message, hủy run hoặc làm mất chat state.
- [ ] Reload/reconnect khôi phục thread, draft và run observation đúng scope; có đường reconcile cho request chưa rõ kết quả.
- [ ] Tool/HITL action ghi rõ đang quyết định loại gì; graph question không được trình bày như một business approval.
- [ ] Sources/attachments mở đúng document/capture có quyền; nút chưa tích hợp không báo đã attach thành công.
- [ ] Giữ conversation selector/history drawer và responsive panel behavior; composer/status/questions vẫn thao tác được khi project sidebar mở/thu gọn hoặc Agent sidebar bật/tắt/resize. Không phát sinh cột thứ tư.

**Tình huống phải kiểm:** streaming bị ngắt; user đổi project/actor; một branch lỗi; tool timeout; submit bị refused; interrupt rồi refresh/resume.

### U-04. Execution list/detail → trace → results

- [ ] Tìm được execution thread/run vừa tạo từ chat, không phải một danh sách mock riêng.
- [ ] Live, timeline, agent/branch và results cùng chỉ về producing execution; deep link trace event giữ đúng project/thread/run.
- [ ] Phân biệt run đang chạy, interrupted, failed, timeout và terminal success bằng trạng thái runtime thực tế.
- [ ] Pause/resume, trả lời interrupt, cancel và complete có semantics/label riêng; action chỉ xuất hiện khi contract hỗ trợ.
- [ ] Kết quả partial hoặc branch không có success outcome vẫn nhìn thấy; không mặc định completed là assessment thành công.
- [ ] Từ Results mở được artifact, finding hoặc tạo finding với execution references đúng; nếu chưa có finding cite operation thì hiện lý do thực tế.

**Tình huống phải kiểm:** run chưa có output; một branch thất bại; artifact tạo được trước timeout; result chưa được curate thành finding; cancel đã được nhận nhưng run chưa terminal.

### U-05. AI suggestion → curated finding → review

- [ ] AI Suggestions hiển thị provenance/quality và không nằm trong count curated confirmed findings.
- [ ] Import mở đúng draft, giữ producer reference/digest và remediation; không tự confirm claim.
- [ ] Draft form có title, severity/rationale, description, impact, recommendation, scope note và references được backend hỗ trợ.
- [ ] Chọn asset/execution/technique bằng identity hợp lệ; display label không được âm thầm lưu thành ID.
- [ ] Summary/workflow, Evidence, Retest, Reproduce và activity/history có nội dung đúng version và nguồn.
- [ ] Từ Evidence attach capture cùng project; thiếu capture hoặc classification có reason và CTA phù hợp.
- [ ] Submit/review/returned/confirmed hiển thị quyết định và lý do; reviewer độc lập hoàn thành được và author bị từ chối tự duyệt.
- [ ] Conflict không ghi đè version mới hoặc xóa form; người dùng thấy bản mình đang sửa khác bản server ở đâu.
- [ ] Finding confirmed mở được từ report và operation nếu đã có persisted references tương ứng.

**Tình huống phải kiểm:** source producer thay đổi sau import; evidence import có file skipped; reviewer trả về; edit làm mất hiệu lực review trước; reference ngoài project; stale-version save.

### U-06. Evidence inventory → classify → inspect/download

- [ ] Inventory phân biệt retained capture, link từ finding và artifact chưa được retain; có entry upload/import rõ ràng.
- [ ] Sau import, hiện số file thành công và từng file skipped kèm lý do; không dùng một toast chung để che partial result.
- [ ] Unclassified capture hiện metadata được phép và giải thích vì sao original đang khóa; người có quyền tìm được classify action.
- [ ] Inspector thể hiện capture ID, classification, size/media type, digest, producer/source và các finding links thực sự có.
- [ ] **Có digest** và **đã kiểm bytes khớp digest** là hai trạng thái khác nhau. UI không tự đổi integrity sang verified chỉ vì metadata có hash.
- [ ] Preview/copy/download giữ đúng bytes hoặc thông báo loại dữ liệu không thể preview; binary không bị đoán thành text.
- [ ] Reclassify/revoke quyền áp dụng trên lần đọc tiếp theo; UI xử lý refusal thay vì giữ original từ cache sai quyền.
- [ ] Reload mở lại đúng capture; rename/display alias không làm đổi identity hoặc producer lineage.

**Tình huống phải kiểm:** sensitive/unclassified; original không còn retained; digest mismatch; unsupported/oversized file; liên kết capture ngoài project; source không đọc được.

### U-07. Finding đã duyệt → report → export/delivery

- [ ] Tạo draft chọn được template/reviewer/period hợp lệ và finding ở trạng thái reportable.
- [ ] Editor hiển thị đúng finding snapshot/version và các section bắt buộc; dirty/save/error/conflict hoạt động.
- [ ] Thay finding/evidence sau khi chọn vào report được phát hiện đúng theo readiness/version rules, không âm thầm dùng snapshot sai.
- [ ] Reviewer mở checklist, xem được nội dung cần duyệt và quyết định đúng version; author không tự duyệt report.
- [ ] Export tạo file thật và giữ nội dung/format/encoding/digest; chỉ bật format đã được implementation và deployment hỗ trợ.
- [ ] Delivery hiển thị đúng ý nghĩa: ghi nhận bàn giao và receipt, hoặc gửi qua integration nếu thật sự có integration. Không coi ghi record là đã gửi email/file tự động.
- [ ] Revision giữ approved/delivered version cũ; reload đọc được revision mới và lịch sử liên quan.

**Trường hợp chưa có finding:** real adapter hiện khai báo `noFindingsVariant: false`. Cần chốt có xây report variant không có finding cho đích sản phẩm hay chấp nhận exclusion; UI phải giải thích giới hạn và cho giữ/export dữ liệu hiện có qua action thực được hỗ trợ. Không tạo finding giả để đi qua readiness.

**Tình huống phải kiểm:** finding còn AI/draft/review; capture unclassified; reviewer trùng author; selected snapshot stale; export lỗi; report đã approved nhưng bị sửa/revise.

### U-08. Hoàn tất project và đọc lại kết quả

- [ ] Operator complete đúng operation; UI phân biệt hoàn tất operation với đóng engagement.
- [ ] Closeout đọc blockers từ run/session/evidence/report state thực; mở được đúng nơi để xử lý từng blocker.
- [ ] Đóng xong các form/mutations bị khóa theo lifecycle, nhưng dữ liệu và export được đọc theo quyền còn hiệu lực.
- [ ] Audit và các resource links đủ để đọc lại ai làm gì, ở version/run nào và outcome nào.
- [ ] Khi provider không có dữ liệu kết thúc session, UI giữ trạng thái unknown/unavailable; không tự cho pass closeout bằng một giả định.

## 11. Các quyết định nội dung cần chốt để tránh làm lại UI

| ID | Quyết định | Hiện trạng và đầu ra cần có |
|---|---|---|
| D-01 | Project navigation giữ 17 mục real hay nhóm về con số khác? | Chốt một canonical model và mode mapping; bảo toàn Assets/Fleet/Governance/Vault/Closeout và alias. Count là hệ quả của model, không phải mục tiêu duy nhất |
| D-02 | Library là skill corpus hay có thêm managed Playbook/Profile? | Ghi domain/owner/version/review semantics của từng loại; không dùng một route name để che khác biệt. Ordered-step builder cần resource thật nếu được giữ trong đích sản phẩm |
| D-03 | Global data source cho Findings/Assets/Infrastructure | Chốt aggregate API/read model, authorized scope, pagination/truncation, source freshness; tránh fan-out browser không có giới hạn |
| D-04 | Organization administration | Chốt registry toàn tổ chức hay engagement membership; cập nhật labels/navigation và acceptance tương ứng |
| D-05 | AI/model configuration | Chốt giá trị mặc định, quyền thay đổi, effective config và tác động tới thread/run hiện có; xác định phần nào read-only hoặc deployment-managed |
| D-06 | Tool Guard/HITL policy | Chốt defaults/override, schema rule, reviewer và nơi enforcement; không gộp ba khái niệm tool approval, graph interrupt, business approval |
| D-07 | Audit taxonomy | Chốt project/workspace source, event categories và resource/correlation mapping, đặc biệt C2/HITL/execution |
| D-08 | Report khi không có finding | Chốt variant cần implement hay exclusion công khai; ghi đúng capability trong UI |
| D-09 | WebShell/PTY | Cần hoàn tất ADR-0095 và native verification; thiết kế session identity, lifecycle, attach/detach, lease và transcript theo contract được chấp nhận |

## 12. Thứ tự các phần việc nhỏ để hoàn thiện UI

Các hàng dưới đây là nhóm thay đổi đề nghị để review từng phần, không phải toàn bộ cùng một PR.

| Thứ tự | Phần việc | Phụ thuộc | Kết quả nhìn thấy được |
|---|---|---|---|
| 1 | Cập nhật acceptance/source paths và chốt baseline | §2, §7 | Không còn todo/path/count lỗi thời làm sai kết luận |
| 2 | Sửa Settings header/banner trong real | X-06, D-04 | Không còn demo organization/project facts trên màn real |
| 3 | Sửa contrast button/text tokens theo component/state | X-03 | Primary/destructive/link đọc được trong hai theme |
| 4 | Đóng canonical project navigation và entry Assets | D-01 | Một đường tìm chức năng rõ, deep link/Back giữ scope |
| 5 | Đóng U-01…U-08 ở những bước đang bị chặn | Contract hiện có và runtime companion | Một project thực đi hết các tab quan trọng |
| 6 | Hoàn thiện Overview bằng các read models có nguồn | G-01, D-03 | KPI/attention/active work/audit có click-through đúng |
| 7 | Global Findings queue | G-03, D-03 | Review xuyên project bằng inventory thật |
| 8 | Global Assets inventory rồi Overview/Discovery | G-04, D-03 | Có dữ liệu tổng hợp trước khi bổ sung analytics và execution entry |
| 9 | Infrastructure observations/management theo scope đã chốt | G-06, D-03 | Nguồn fleet/session rõ; provider missing không thành fake health |
| 10 | Library sections và Knowledge mock | G-05, D-02 | Skills/Proposals/Playbook/Profile/Knowledge có semantics riêng |
| 11 | AI/model settings và policy editor | G-07, D-05, D-06 | Read/write/effective config và defaults/override có persistence |
| 12 | MCP/audit integration và advanced sessions | D-07, D-09 | Giám sát/configuration đúng nguồn; WebShell/PTY có native outcome |

Với mỗi phần: khai báo port/read model → dùng adapter/service hiện có hoặc bổ sung contract đã review → nối presentation → kiểm success/refusal/persistence → ghi evidence → cập nhật checklist.

## 13. Mẫu ghi kết quả review cho từng luồng

```text
Checklist ID: G-xx / J-xx / X-xx / U-xx
Tested commit + local changes:
Frontend/API/runtime/provider image hoặc version:
Mode + actor role + feature flags:
Project/resource/thread/run IDs cần đối chiếu:
Đường vào và các thao tác đã thực hiện:
Kết quả mong đợi:
Kết quả thực tế:
Persistence/reload đã kiểm:
Refusal/error/recovery đã kiểm:
Screenshot/recording/network result/artifact evidence:
Verdict: pass / partial / config-gated / unverified / exclusion
File hoặc layer cần fix tiếp:
```

**Chốt review:** ghi đúng phạm vi kết luận. Một screenshot tốt chứng minh presentation tại thời điểm chụp; một API mutation pass chứng minh đường ghi đó; một workflow xuyên suốt mới chứng minh các tab phối hợp thành một luồng sử dụng hoàn chỉnh.

## 14. Hợp đồng chạy audit tự động cho agent

### 14.1. Phân biệt rebuild, implementation và verification

- **Rebuild:** đóng gói source hiện có thành artifact/image; không tạo thêm các tính năng đang được liệt kê là missing/partial.
- **Implementation:** thay đổi presentation/contract/service/runtime để đạt một acceptance cụ thể.
- **Verification:** quan sát hành vi trên đúng build/mode/role, theo đúng tiêu chí; ghi cả phần chưa thực hiện.

Audit cổng `http://127.0.0.1:3001` ngày 2026-10-22 đã thấy:

- Container `raptix-web-raptix-ui`, Compose service `web-raptix-ui`, image revision label `d2f82baa`.
- Bundle C2 đang phục vụ có `Arguments (JSON array)` và `stderr truncated by provider`: có bằng chứng rebuild đã chứa các thay đổi này.
- CSS entry vẫn cùng tên `index-CzmP6Vwm.css` với local build: các thay đổi vừa rồi không phải một đợt redesign theme/layout.
- Source và deployed Settings vẫn còn copy demo; các mục Overview/global inventory/AI-model settings trong checklist vẫn cần implementation.

Revision label theo HEAD không nhận diện đầy đủ uncommitted source. Asset hash khác giữa local và Docker build cũng không tự chứng minh image cũ, vì build environment có thể khác. Đối chiếu artifact/marker và hành vi cụ thể trước khi kết luận lỗi cache.

### 14.2. Runner kiểm tra đọc trên deployment hiện tại

Runner: `apps/web/tools/verify/deployed-checklist.mjs`.

```powershell
# Cung cấp RAPTIX_VERIFY_USER / RAPTIX_VERIFY_PASSWORD qua môi trường local.
node apps/web/tools/verify/deployed-checklist.mjs --app http://127.0.0.1:3001 --out tests/local/artifacts/deployed-ui-review
```

- Đọc toàn bộ các group G/J/X/U/D và checkbox criteria trong file này; lưu checklist hash, source line và fingerprint từng criterion.
- Mở global pages và project sections hiện có trong real mode. Mặc định chọn project đầu tiên được phép đọc; dùng `--project <id>` khi cần chọn rõ project.
- Ghi entry asset/hash, deployment ID, capabilities, route observations, issues và screenshots Overview/Settings.
- Chặn business mutation trên browser; chỉ cho login và read requests. Không gửi message/run/tool command và không reveal secret.
- Xuất `audit.json` và `audit.md`, trong đó từng mục chưa có evidence vẫn là `unverified`; decision items là `decision-required`; provider thiếu cấu hình là `config-gated`.
- Một render probe pass không làm group hoặc các checkbox bên trong pass. Runner trả exit code khác 0 khi có issue hoặc còn criterion chưa kiểm chứng.

Đây là baseline inspection trên app thật, không phải full E2E certification.

### 14.3. Phần agent cần thực hiện để test đầy đủ checklist

| Lớp kiểm tra | Agent phải làm | Evidence / điều kiện hoàn tất |
|---|---|---|
| Inventory | Ánh xạ từng ID và checkbox tới test/probe/manual decision; ghi source checksum | Không có mục bị bỏ qua hoặc được pass mặc định |
| Deployed UI | Dùng đúng app URL, fresh browser context, mode/flags/roles; kiểm nội dung và states | Screenshot/DOM assertions và network results cho đúng criterion |
| Workflow với dữ liệu tổng hợp | Tạo engagement canary riêng; author/reviewer khác nhau; chạy create/edit/import/classify/review/export/reload | API/DB persistence, expected-version/ref/digest và browser state nhất quán |
| Live AI runtime | Chạy U-02…U-04 trên canary; có model, agent/subagent, sandbox và stream/recovery thật | Producing run IDs, tool/artifact evidence; không dùng fixture để chứng nhận live execution |
| Negative/recovery | Đúng quyền từ chối, stale version, source outage, timeout/interrupt/cancel có kiểm soát | Refusal và recovery outcome đúng server/runtime; không mất draft hoặc dispatch trùng |
| Accessibility/layout | Component/state đang dùng, light/dark, narrow viewport, keyboard | Contrast/layout/focus evidence; không chỉ screenshot đẹp |
| Product decisions | D-01…D-09 cần owner chốt hoặc exclusion được chấp nhận | Ghi quyết định; không tự thêm backend domain hoặc gỡ requirement để làm xanh báo cáo |

### 14.4. Quy tắc báo cáo và fix-loop

1. Mỗi issue ghi checklist ID, actual/expected, nguồn evidence, owning layer, mức ảnh hưởng và acceptance check.
2. Tách lỗi render/crash, nội dung missing, integration partial, config-gated và unverified. Một banner unavailable trung thực có thể là UI state đúng nhưng vẫn chưa đạt functional parity.
3. Chỉ sửa concern đã xác định; sau fix chạy lại criterion và consumer liên quan, không mặc định chạy full repository suite.
4. Không dùng `--discover`, baseline exceptions hoặc missing fixtures làm chứng nhận hoàn thành checklist.
5. Không sửa checkbox thành checked chỉ vì source có component hoặc route trả 200.
6. Kết luận cuối phải có số mục verified, failed/partial, config-gated, excluded/decision-required và unverified; đầy đủ inventory không đồng nghĩa đã test đầy đủ.

---

## Cập nhật sau Full UX Audit (2026-10-23)

Phần này ghi kết quả đối chiếu với audit `docs/audits/web-ux-audit-2026-10-23/` và các commit Quick Win. Các mục trên không bị sửa; phần đã đổi nằm ở đây. Nhãn: `[B]` quan sát trong trình duyệt (build production cục bộ, mock mode), `[C]` đọc source, `[NV]` chưa kiểm được.

### Sai lệch trong nội dung checklist (đã xác minh)

| Vị trí | Nội dung cũ | Thực tế | Nguồn |
|---|---|---|---|
| §2.2 | "Assets hiện chưa có mục sidebar dự án riêng" | Có mục "Assets" trong PREPARATION ở cả mock và real | `[C]` `shell/nav.ts` |
| §2.2 | Sidebar dự án mock 13 / real 17 | Mock 14 (đếm DOM `[B]`); real 18 (theo source, `[C]`) | `[B]` `[C]` |
| §3.1 | Overview có 6 KPI theo đề xuất | 4 KPI: Active projects, Active operations, Awaiting decisions, Open curated findings | `[B]` |
| §5 X-03 | Nút `#E5484D`, `#F87171` nền trắng 3.91 / 2.77 | Token hiện tại khác. Đo lại: chữ trắng trên `#C62828` 5.62; `#B91C1C` 6.47; `#2563EB` 5.17 (trước khi đổi). Cặp thật sự hỏng: xanh dark làm chữ trên panel 3.43; neutral light trên hover 4.39 | `[C]` tính từ `index.css` |
| §3.2 | Settings real còn "Acme Security (Demo)" | Đúng trước khi sửa. Đã sửa ở phần Settings (xem bên dưới) | `[C]` |

### Trạng thái các mục sau Quick Win

| Mục | Trạng thái | Ghi chú |
|---|---|---|
| G-07 / §3.2 — header và note Settings ở real | Đã sửa; test real-mode `[C]`; trình duyệt real `[B]` trên stack có graph (2026-10-23): không có tổ chức demo, không có ID demo, 5 tab | `real-chrome.demo-free.test.tsx`; `audits/web-ux-audit-2026-10-23/verification/` |
| X-06 — demo copy trong real | Một phần | Settings đã sạch. Outage real đã có thông báo người dùng. Switcher, Demo Tools chỉ mount ở mock (`shell/shell.tsx:168`) |
| X-02 — trạng thái outage | Một phần | Thông báo người dùng, không lệnh dev. Thông điệp kỹ thuật "non-JSON response" từ `platform/transport.ts` còn nguyên |
| X-03 — contrast | Đã sửa cặp hỏng; có test | `ui/theme-contrast.test.ts` đọc token từ `index.css` |
| X-07 — thuật ngữ | Một phần | Đã sửa "Library" trong heading và lỗi của Capabilities; "Assets/Capabilities/Sessions/C2" vẫn cần quyết định (D-01) |
| J-18 / prototype pages | Đã gate | `scenarios`, `states`, `workspaces` chỉ đăng ký khi dev hoặc `VITE_PROTOTYPE_PAGES=true` |
| Overview — KPI sai nghĩa | Một phần | "Operations running now" thay "binding state". Aggregate chạy thật và 2 KPI còn thiếu: chưa làm (cần contract) |
| Projects — cột và KPI | Đã sửa | "Not recorded" thay "—"; KPI Metadata không còn hiển thị 0 khi không có nguồn; note Active liệt kê đủ 4 trạng thái |
| Sidebar dự án | Đã sửa | Dải mờ khi còn mục bên dưới |

### Mục còn mở (chuyển sang Structural)

- D-01: một từ vựng và một cây điều hướng cho mock và real.
- D-04: phạm vi tổ chức (registry toàn tổ chức hay engagement membership).
- D-05 / D-06: quyết định AI/model và Tool Guard/HITL.
- Quyết định mục "Switch to demo mode" trong menu tài khoản real (có chủ đích, vẫn còn).
- Gộp Ask AI với AI Workspace; Plans với Planning; ba inbox phê duyệt.
- Loại code demo khỏi bundle production (hiện route bị gate nhưng `demo/pages` và `shell/system/gallery` vẫn nằm trong bundle vì `slice-a` import tĩnh).

Nguồn đầy đủ: `docs/audits/web-ux-audit-2026-10-23/` và `docs/audits/web-ux-audit-2026-10-23/QUICK-WINS-IMPLEMENTATION-REPORT.md` (sẽ tạo).
