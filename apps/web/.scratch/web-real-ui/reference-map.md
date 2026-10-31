# Reference map: Raptix Real Web (W00)

Ngày: 2026-10-23. Baseline: `d2f82baa` (HEAD), kèm các thay đổi chưa commit được kế thừa từ pre-lab: `apps/web/src/features/c2/{provider.ts,remote.ts,provider-console.tsx,provider-tab.test.tsx}`, `apps/web/src/features/findings/{api.ts,remote.ts,remote.test.ts}`, `apps/web/tools/verify/stack.mjs`, và các file untracked `apps/web/tools/verify/{deployed-checklist.mjs,flows/prelab.mjs}`, cùng các tài liệu `docs/web-*.md`, `docs/runtime-prelab-readiness-2026-10-22.md`. Các thay đổi này được giữ nguyên; không revert.

Nguồn reference: `reference/web/templates/index.html` (7060 dòng) và `reference/web/static/{js,css}`. Reference là tài liệu đọc, không là backend và không được import vào production.

## Số lượng container

Reference có **29 container `page-*`**, khớp R01–R29 của plan. Lưu ý: regex đếm đầu tiên `[a-z-]+` bỏ sót các ID có chữ số, nên chỉ thấy 23; sáu container C2 (`page-c2-*`) nằm trong vùng `page-tasks` (2949–3275). Số dòng dưới đây đã kiểm lại bằng `rg 'id="page-[a-z0-9-]+"'`.

## Bản đồ R01–R29

Ký hiệu trạng thái: **Đang làm** (đang triển khai trong đợt này), **Chờ** (chưa bắt đầu), **Loại trừ** (theo plan §1), **Bị chặn** (thiếu dependency/ADR ngoài thẩm quyền).

| Ref | Container (dòng) | Nội dung chính (dịch) | Đích Raptix | Xử lý | Wave | Ca nghiệm thu | Trạng thái |
|---|---|---|---|---|---|---|---|
| R01 | `page-dashboard` (481–933) | Dashboard: refresh, lọc trạng thái, phân bố severity, khuyến nghị, hàng đợi tác vụ, số lần gọi công cụ, sự kiện gần đây, năng lực truy cập | Global Overview (G-01, §5.1) | Học và adapt | W03 | E07, G-01, U-01 | **Đang làm** (xem bản ghi chi tiết bên dưới) |
| R02 | `page-chat` (934–1381) | Chat: chọn project/role, lịch sử, composer, thẻ tool, tiến trình kế hoạch, HITL, audit agent | Project AI Workspace (J-05, U-03) | Học và adapt | W06 | E02, E03, E04 | Chờ |
| R03 | `page-tool-guard` (1382–1468) | Tool Guard: danh sách quy tắc, thứ tự, thêm/sửa, kiểm thử khớp, lưu và có hiệu lực | Tool policy: mặc định workspace + override project (A06, D-06) | Học và adapt | W09 | E09 | Chờ |
| R04 | `page-hitl` (1469–1654) | HITL: tab approval/audit agent, chính sách audit, whitelist công cụ, nhật ký | Team & Approvals + policy (giữ các loại approval riêng) | Học và adapt | W09 (policy), W06 (interrupt) | E09 | Chờ |
| R05 | `page-mcp-monitor` (1655–1717) | Monitor MCP: chỉ số, lần thực thi gần nhất, lọc theo tool/trạng thái | Monitor trace tool thật (telemetry công cụ) | Học và adapt | W09 | E09 | Chờ |
| R06 | `page-mcp-management` (1718–1769) | Quản lý MCP: cấu hình công cụ, MCP bên ngoài, bật/tắt | Settings → Integrations/MCP (A05, A06) | Học và adapt | W09 | E09 | Chờ |
| R07 | `page-knowledge-management` (1770–1830) | Quản lý tri thức: xây index, thêm tri thức, tìm kiếm | Library → Knowledge thật (A09) | Thay bằng dữ liệu thật | W08 | E08 | Bị chặn (chưa có backend Knowledge: document, index, search) |
| R08 | `page-knowledge-retrieval-logs` (1831–1874) | Lịch sử truy xuất: bộ lọc, số liệu | Library → Knowledge retrieval history | Thay bằng dữ liệu thật | W08 | E08 | Bị chặn (như R07) |
| R09 | `page-asset-overview` (1875–1954) | Tổng quan asset: phân bố giao thức, xu hướng 7/30/90 ngày, rủi ro, độ phủ quét | Assets → Overview (G-04) | Học và adapt | W07 | E07 | Chờ |
| R10 | `page-asset-library` (1955–2197) | Thư viện asset: bộ lọc nâng cao, chip, view đã lưu, chọn nhiều, nhập/sửa hàng loạt, bảng 11 cột | Assets → Inventory (global + project) | Học và adapt | W07 | E07 | Chờ |
| R11 | `page-info-collect` (2198–2324) | Thu thập thông tin: truy vấn, phân tích AI, xuất CSV/JSON/XLSX, nhập vào kho, quét hàng loạt | Assets → Discovery qua capability sẵn có | Học và adapt | W07 | E07 | Chờ |
| R12 | `page-projects` (2325–2686) | Projects: master/detail, fact blackboard, attack path, asset, hội thoại, lỗ hổng, cài đặt project | Projects + workspace project (facts/Analysis) | Học và adapt | W05 | E01, E02 | Chờ |
| R13 | `page-vulnerabilities` (2687–2852) | Quản lý lỗ hổng: xuất/xóa hàng loạt, lọc, thêm | Findings global queue + lifecycle project (G-03, J-10) | Học và adapt | W04 | E05, E06 | Chờ |
| R14 | `page-webshell` (2853–2889) | WebShell: thêm kết nối, probe hàng loạt, sidebar kết nối, workspace | WebShell là provider connection riêng (A11, D-09) | Học và adapt, sau ADR | W12 | E10 | Bị chặn (ADR-0095 còn Proposed) |
| R15 | `page-chat-files` (2890–2948) | File: tải lên, tìm kiếm, xuất kết quả | Evidence inventory + chat attachment (J-11) | Học và adapt | W04 | E05 | Chờ |
| R16 | `page-tasks` (2949–2991) | Hàng đợi tác vụ: trạng thái, tìm kiếm, tiến trình, tự làm mới | Operations/schedules (J-06); inbox phê duyệt là resource khác | Học và adapt | W06 | E03, E04 | Chờ |
| R17 | `page-c2-listeners` (2992–3004) | Listener C2: thẻ, form, trạng thái | Infrastructure listeners qua native provider | Học và adapt | W12 | E10 | Bị chặn (native provider, config-gated) |
| R18 | `page-c2-sessions` (3005–3025) | Phiên C2: master/detail, bộ lọc, lệnh, terminal | Owned sessions, grant có hạn, command/reconcile, PTY (ADR-0095) | Học và adapt | W12 | E10 | Bị chặn (như R17) |
| R19 | `page-c2-tasks` (3026–3108) | Lệnh C2: trạng thái, tìm kiếm, output | Command ledger bền vững; unknown không tự gửi lại | Học và adapt | W12 | E10 | Bị chặn (như R17) |
| R20 | `page-c2-payloads` (3109–3180) | Payload generator | **Loại trừ** (plan §1). Native test enrolment chỉ trong harness | — | — | — | Loại trừ |
| R21 | `page-c2-events` (3181–3255) | Sự kiện C2: lọc theo scope, thời gian, loại, kết quả | Audit projection + liên kết sang command/session (A07, D-07) | Học và adapt | W10 | E09 | Chờ |
| R22 | `page-c2-profiles` (3256–3275) | Profile traffic C2 | Profile HTTP có phạm vi do provider hỗ trợ | Học và adapt | W12 | E10 | Bị chặn (như R17) |
| R23 | `page-workflows` (3276–3412) | Workflow: metadata, phiên bản, bước có thứ tự, import/export | Playbook/Profile dạng form có thứ tự (A10) | Học và adapt, **bỏ canvas** | W08 | E08 | Chờ |
| R24 | `page-roles-management` (3413–3439) | Quản lý vai trò agent | **Loại trừ**: editor vai trò agent không nằm trong phạm vi. RBAC nền tảng là R29 | — | — | — | Loại trừ |
| R25 | `page-skills-monitor` (3440–3472) | Thống kê sử dụng Skills | **Loại trừ**: trang thống kê sử dụng. Ngữ nghĩa lỗi có thể đưa vào monitor R05 | — | — | — | Loại trừ |
| R26 | `page-skills-management` (3473–3518) | Quản lý Skills: tìm kiếm, chi tiết, mô tả | Library → Skills (corpus chỉ đọc) + proposal/review (A10) | Học và adapt | W08 | E08 | Chờ |
| R27 | `page-agents-management` (3519–3593) | Quản lý agent: danh sách, chi tiết | Fleet/Infrastructure theo graph và invocation thật; không bịa heartbeat | Học và adapt | W06 | E03 | Chờ |
| R28 | `page-settings` (3594–5239) | Cài đặt: Token usage, kênh AI, vision, agent, HITL, approval, retention, audit | Settings theo scope thật (A04, A05, A06); bỏ Update và WeChat | Học và adapt | W09 | E09 | Chờ (copy demo cần bỏ trong real: G-07) |
| R29 | `page-platform-rbac` (5240–7061) | RBAC nền tảng: người dùng, phân quyền, vai trò, tài nguyên | Accounts + membership engagement (A04) | Học và adapt | W09 | E01, E09 | Chờ (quyết định phạm vi tổ chức: D-04) |

Loại trừ theo plan §1: workflow canvas, payload generator, editor vai trò agent, trang thống kê sử dụng Skills, tab Update, tích hợp riêng WeChat, updater một chọn.

## R01: bản ghi chi tiết (Overview)

- **HTML** (`templates/index.html` 481–933): header `仪表盘` (Dashboard), nút `刷新` (Refresh), banner cảnh báo, sáu KPI, cột trái: `漏洞严重程度分布` (phân bố severity: vòng tròn, legend, số Open/Confirmed/Fixed/Ignored/False positive, Fix rate), `推荐操作` (khuyến nghị), cột phải: `批量任务队列` (hàng đợi: Pending/Running/Completed), `工具执行次数` (biểu đồ cột công cụ), `最近事件` (sự kiện gần đây), `能力总览` (C2/WebShell), tab `最近漏洞`/`近期事实`/`C2`/`WebShell`.
- **JS** (`static/js/dashboard.js`, 2525 dòng): `refreshDashboard`, `renderSeverityInsights`, `renderVulnStatusPanel`, `renderDashboardToolsBar`, `renderRecommendedActions`, `renderRecentEvents`, `renderRecentVulns`, `renderRecentFacts`, `renderDashboardAccessOverview`, `renderDashboardAlertBanner`, `checkDashboardStale`/`startDashboardAutoRefresh` (làm mới tự động và trạng thái stale), `switchDashboardFeedTab`.
- **CSS**: `.dashboard-page`, `.dashboard-kpi-row`, `.dashboard-kpi-card` (gradient nền riêng từng thẻ, icon 28px), `.dashboard-access-strip`, `.dashboard-alert-banner.is-warning|is-danger`, `.dashboard-last-updated` (dấu thời gian và trạng thái làm mới).
- **Học và adapt sang Raptix**:
  1. Header có scope, thời gian cập nhật và nút Refresh (Raptix: `PageHeader` với `actions`).
  2. Banner ưu tiên việc cần xử lý, có link sâu (Raptix: banner dừng khẩn cấp; các quyết định cần xử lý).
  3. Sáu KPI, mỗi thẻ có nguồn và đường drill-down (Raptix: active projects, active operations, awaiting decisions, open curated findings, active agent instances, active sessions).
  4. Cột chính: phân bố severity và workflow; danh sách project; khuyến nghị. Cột phụ: hàng đợi quyết định; operations đang hoạt động; C2; nguồn dữ liệu.
  5. Nguồn dữ liệu: số không đọc được là "Unavailable"; số không được ghi nhận là "Not recorded"; thành phần runtime là "Per project".
- **Chỗ khác với reference, có chủ đích**: reference gộp "tool execution count" và "token usage" vào Overview. Raptix chưa đưa vào vì chưa có tổng hợp toàn cục cho tool/model usage (cần nguồn telemetry, W03 mở rộng sau). Reference dùng màu đỏ cho nhiều thẻ KPI; Raptix giữ đỏ cho severity và destructive, KPI dùng màu trung tính (A02).
- **Data owner**: `features/overview/` (port, adapter, mock), `server/src/services/inbox-service.ts` (rollup theo miền), `server/src/http/routes/inbox.routes.ts`. Section operations mới: ADR-0097 (Proposed).
- **Ca nghiệm thu**: E07 (aggregate và khớp số đếm), G-01 (định nghĩa KPI, nguồn lỗi không thành số 0, CTA đúng), U-01 (điều hướng sau đăng nhập). Chi tiết trạng thái: xem `docs/web-real-ui-implementation-plan.md` §11.

## Bằng chứng reference

- Ảnh reference Overview (trang bị modal đăng nhập chặn): `scratchpad/checkpoint5/ref/shots/ref-dashboard-1440.png`. Đây là preview tĩnh, không phải giao diện đã đăng nhập; bố cục và thứ tự khối vẫn đọc được.
- Server preview reference: `reference/web` phục vụ tĩnh trên cổng riêng (script trong scratchpad, không thuộc repo).

## Gate W00

Gate của plan yêu cầu mọi trang đã adapt phải có bản ghi chi tiết, không chỉ heading. Hiện có: **R01 đầy đủ**; **R02–R29 ở mức cấu trúc và xử lý** (container, dòng, nội dung chính, đích, wave, ca nghiệm thu). Bản ghi chi tiết cho từng trang sẽ được bổ sung trước khi trang đó bắt đầu triển khai (W02–W12). Vì vậy **W00 chưa đạt gate**, và tài liệu này ghi rõ phần còn lại.
