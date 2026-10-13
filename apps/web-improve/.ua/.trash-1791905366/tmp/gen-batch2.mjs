import { writeFileSync } from 'node:fs'

const P = (n) => Math.min(200, Math.max(0, n))
const F = (path, name, span, cx, summary, tags, exported, notes) => ({ path, name, span, cx, exported: !!exported, notes: notes || null, summary, tags })

const funcs = {
  'src/screens/b-detail.tsx': [
    F('src/screens/b-detail.tsx', 'parseDate', [8, 8], true, 'Chuyển chuỗi ngày của dự án thành Date, cắt phần giờ; trả về ngày fallback 13/10/2026 khi parse thất bại.', ['date', 'parsing', 'helper'], true),
    F('src/screens/b-detail.tsx', 'Blocked', [22, 37], false, 'Màn hình bị chặn khi project không tồn tại hoặc người dùng không có quyền truy cập, không bao giờ lộ dữ liệu dự án, kèm nút quay về Projects hoặc Command Center.', ['empty-state', 'access-control', 'guard'], false),
    F('src/screens/b-detail.tsx', 'ProjectPage', [39, 46], true, 'Entry route của trang chi tiết dự án: tra cứu project theo route id, chặn bằng Blocked khi không tìm thấy hoặc không có quyền (canAccessProject), sau đó render Detail.', ['react-screen', 'routing', 'guard'], true),
    F('src/screens/b-detail.tsx', 'Detail', [48, 151], false, 'Khung chính của trang dự án: đồng bộ project switcher, gom operations/findings/reports/evidence/plans/sessions/approvals, banner trạng thái phê duyệt và tab bar (MAIN_TABS + menu More) điều hướng qua route.', ['react-component', 'tabs', 'routing'], false),
    F('src/screens/b-detail.tsx', 'Overview', [156, 305], false, 'Tab Overview (PR-03): KPI operations/agents/findings/reports, progress readiness và completion, eligibility kèm lý do chặn, objectives, schedule progress, suggested actions và activity gần nhất.', ['dashboard', 'kpi', 'readiness'], false),
    F('src/screens/b-detail.tsx', 'Objectives', [308, 331], false, 'Tab Objectives (PR-06): bảng mục tiêu với tiến độ, owner, success criteria và các operation liên quan được filter theo owner.', ['table', 'objectives', 'progress'], false),
    F('src/screens/b-detail.tsx', 'Activity', [342, 362], false, 'Tab Activity (PR-08): timeline audit của dự án với bộ lọc theo loại sự kiện (scope, approval, operation, finding, report, close) dựa trên regex trong CATS.', ['timeline', 'audit', 'filter'], false),
    F('src/screens/b-detail.tsx', 'OpsTab', [365, 415], false, 'Tab Operations: bảng operations của dự án với kết quả steps, cảnh báo run bị khóa theo eligibility, nút mở draft/preflight và tạo operation có guard permission.', ['table', 'operations', 'permission'], false),
    F('src/screens/b-detail.tsx', 'FindingsTab', [417, 442], false, 'Tab Findings: bảng findings của dự án hiển thị severity, trạng thái, asset, owner và nút tạo finding theo permission createFinding.', ['table', 'findings', 'permission'], false),
    F('src/screens/b-detail.tsx', 'ReportsTab', [444, 467], false, 'Tab Reports: bảng reports của dự án với version, author, reviewer và nút tạo report draft theo permission editReport.', ['table', 'reports', 'permission'], false),
    F('src/screens/b-detail.tsx', 'EvidenceTab', [469, 489], false, 'Tab Evidence: bảng evidence của dự án, redact tên file và loại với dữ liệu sensitive khi người dùng không có quyền viewSensitive.', ['table', 'evidence', 'redaction'], false),
    F('src/screens/b-detail.tsx', 'AuditTab', [491, 513], false, 'Tab Audit: audit log bất biến của dự án (ai, khi nào, làm gì, vì sao), ẩn hoàn toàn với role viewer, phân trang qua usePaged.', ['audit-log', 'table', 'permission'], false),
    F('src/screens/b-detail.tsx', 'PlansTab', [516, 540], false, 'Tab AI Plans (read-only): bảng plans do AI đề xuất kèm version qua planVer, cảnh báo re-validation và link sang ai-plan-review.', ['table', 'ai-plans', 'read-only'], false),
    F('src/screens/b-detail.tsx', 'SessionsTab', [542, 562], false, 'Tab C2 Sessions (read-only): bảng sessions của dự án với loại reverse/web shell mô phỏng, link tới chi tiết session và operation.', ['table', 'c2-sessions', 'read-only'], false),
  ],
  'src/screens/b-detail2.tsx': [
    F('src/screens/b-detail2.tsx', 'useSubmitApproval', [7, 21], true, 'Hook chuẩn bị submit dự án/ROE để phê duyệt: gom các issue còn thiếu (in-scope asset, emergency contact, assessment window) và trả về submit() gọi A.submitApproval kèm toast.', ['hook', 'approval', 'validation'], true),
    F('src/screens/b-detail2.tsx', 'useReopen', [23, 29], true, 'Hook trả về callback mở confirm dialog yêu cầu lý do bắt buộc để reopen dự án đã đóng, gọi A.reopen và ghi audit log.', ['hook', 'reopen', 'confirm-dialog'], true),
    F('src/screens/b-detail2.tsx', 'ScopeTab', [33, 159], false, 'Tab Scope & ROE (PR-04): so sánh ROE effective vs proposed qua RoeCompare, bảng in/out scope, panel ROE, documents, version history, cảnh báo PRE-03/PRE-08 và modal EditScope với luồng re-approval khi ROE đã approved.', ['scope', 'roe', 'approval'], false),
    F('src/screens/b-detail2.tsx', 'RoeCompare', [165, 197], false, 'So sánh phiên bản ROE đang hiệu lực với bản proposed (PR-V3-04): assets added/removed, assessment window, emergency contact và impact lên plans/operations.', ['diff', 'roe', 'comparison'], false),
    F('src/screens/b-detail2.tsx', 'RoePanel', [199, 216], false, 'Card hiển thị Rules of Engagement: version, assessment window, emergency contact, reviewer, allowed activities, restrictions và nút download PDF mô phỏng.', ['roe', 'card', 'display'], false),
    F('src/screens/b-detail2.tsx', 'EditScope', [218, 240], false, 'Modal chỉnh sửa Scope & ROE (window, emergency contact, methods, restrictions, description) với validation bắt buộc, phát hiện dirty và callback confirmReason để xử lý re-approval.', ['modal', 'form', 'validation'], false),
    F('src/screens/b-detail2.tsx', 'TeamTab', [243, 340], false, 'Tab Members & Approvals (PR-05/07): danh sách approval requests với hành động approve/return/request-info có confirm, quản lý thành viên (đổi role, xóa, thêm) và PersonaHint khi role không đủ duyệt.', ['members', 'approvals', 'rbac'], true),
    F('src/screens/b-detail2.tsx', 'CloseTab', [343, 446], false, 'Tab Closeout (PR-09): KPI tổng kết, closeout checklist từ closureChecklist kèm agent reservations và no-findings waiver, luồng request/approve closure với lý do bắt buộc, modal Close Project.', ['closure', 'checklist', 'approval'], true),
  ],
  'src/screens/b-wizard.tsx': [
    F('src/screens/b-wizard.tsx', 'ProjectNew', [31, 573], true, 'Wizard 5 bước tạo dự án mới: step navigation với validation từng bước (v0–v3), quản lý objectives/assets/members/restrictions, scope check, ROE presets, validation panel với hai outcome Create Draft và Submit for Approval, useDirty bảo vệ dữ liệu form.', ['wizard', 'form', 'validation'], true),
  ],
  'src/screens/b.tsx': [
    F('src/screens/b.tsx', 'ProjectsPage', [11, 116], false, 'Trang danh sách dự án: filter persist theo q/status/type/owner/client, bảng projects với eligibility và pin, export CSV, menu hành động theo hàng, phân trang và ràng buộc tạo dự án theo role.', ['react-screen', 'table', 'filtering'], false),
  ],
  'src/screens/d-agents.tsx': [
    F('src/screens/d-agents.tsx', 'Heartbeat', [15, 29], false, 'SVG 24 cột mô phỏng heartbeat của agent, tô đỏ khi lost (mất mẫu gần đây) và vàng khi unhealthy (delayed), chiều cao cột sinh từ hashNum(a.id).', ['svg', 'visualization', 'simulated'], false),
    F('src/screens/d-agents.tsx', 'GroupModal', [32, 94], false, 'Modal tạo/sửa agent group (AG-03): chọn project cho phép, usage policy, group manager, chọn agents chưa thuộc group; yêu cầu confirm riêng khi gỡ agent đang bị operation sử dụng.', ['modal', 'groups', 'agents'], false),
    F('src/screens/d-agents.tsx', 'AssignDrawer', [98, 211], false, 'Drawer xin phân bổ agent (AG-V3-03): eligibility checks (connected, không conflict reservation, ở pool, project approved/active), luồng Request assignment qua approval hoặc Assign immediately, cảnh báo pending/conflict và gợi ý agent thay thế cùng OS.', ['drawer', 'assignment', 'approval-gate'], false),
    F('src/screens/d-agents.tsx', 'FailurePanel', [223, 292], false, 'Panel xử lý agent mất kết nối (AG-V3-04/E2E-05): impact lên steps của các operation đang mở theo STEP_IMPACT, đề xuất restore kết nối hoặc replace agent cùng project, request replacement từ shared pool.', ['failure-handling', 'agents', 'operations'], false),
    F('src/screens/d-agents.tsx', 'FleetList', [296, 376], false, 'Danh sách fleet (AG-V3-01): 6 KPI lọc nhanh (connected/lost/assigned/pool/busy/attention), search + MoreFilters, DTable agents với cột pending-assignment và nút request assignment có lý do chặn.', ['table', 'fleet', 'filtering'], false),
    F('src/screens/d-agents.tsx', 'GroupsTab', [380, 444], false, 'Tab quản lý agent groups (AG-03): card mỗi group với usage policy, availability, thành viên, gỡ agent khỏi group có confirm khi đang bị operation dùng, và liên kết sang operations/operation-new.', ['groups', 'cards', 'agents'], false),
    F('src/screens/d-agents.tsx', 'HealthTab', [447, 523], false, 'Tab connectivity & health (AG-04): LineChart agents 24 giờ, health score, bảng agent lost/delayed với Heartbeat bars, latency mô phỏng, lỗi version cũ và bảng khuyến nghị remediation.', ['health', 'chart', 'connectivity'], false),
    F('src/screens/d-agents.tsx', 'Agents', [526, 545], false, 'Trang Agents chính: chọn tab list/pool/groups/health qua route, hiển thị GroupModal và AssignDrawer, khóa tạo group theo useGuard và permission editScope.', ['react-screen', 'tabs', 'routing'], false),
    F('src/screens/d-agents.tsx', 'AgentDetail', [548, 675], false, 'Chi tiết agent (AG-02): chặn khi không tồn tại/không có quyền/thuộc project khác, các tab overview/connectivity/ops/log/policy, disable/enable agent, simulate disconnect, request assignment và AssignDrawer.', ['detail-page', 'agents', 'tabs'], false),
  ],
  'src/screens/d-assets.tsx': [
    F('src/screens/d-assets.tsx', 'validateIdent', [18, 25], true, 'Validate định danh asset theo loại (IP, Subnet CIDR, URL, hostname) bằng regex hostRe/ipRe/okIp, trả về chuỗi lỗi hoặc rỗng khi hợp lệ.', ['validation', 'regex', 'assets'], true),
    F('src/screens/d-assets.tsx', 'ScopeBadge', [34, 59], true, 'Badge scope của asset (in/out/pending/unclassified) kèm popover giải thích ý nghĩa từng trạng thái kèm ROE version của project, đóng khi click ra ngoài hoặc Escape.', ['badge', 'popover', 'scope'], true),
    F('src/screens/d-assets.tsx', 'AssetList', [62, 144], false, 'Danh sách assets (AS-01): KPI theo scope bấm để lọc, filter search/type/owner/OS, chọn nhiều dòng để mark out of scope hoặc chọn playbook, DTable với cột chọn và ScopeBadge.', ['table', 'assets', 'bulk-actions'], false),
    F('src/screens/d-assets.tsx', 'ScopeDiff', [148, 179], false, 'Card diff scope (AS-V3-03): liệt kê assets pending thêm so với ROE đang hiệu lực và impact lên plans cần re-validate, ready operations trả về Draft, running operations giữ nguyên policy.', ['diff', 'scope', 'impact'], false),
    F('src/screens/d-assets.tsx', 'AssetScope', [182, 311], false, 'Scope Map & Review (AS-04): bản đồ SVG phân nhóm asset theo 4 scope, chế độ table, panel chi tiết asset, luồng request/approve/reject scope change với lý do và ScopeDiff impact.', ['svg-map', 'scope-review', 'approval'], false),
    F('src/screens/d-assets.tsx', 'ImportPreview', [316, 343], false, 'Bảng preview import CSV/discovery: sửa identifier trực tiếp, đếm dòng invalid/duplicate, chỉ import các dòng keep hợp lệ dưới dạng Pending Review.', ['import', 'preview', 'validation'], false),
    F('src/screens/d-assets.tsx', 'AssetNew', [345, 462], false, 'Trang Add Asset (AS-02) 3 tab: form manual với validateIdent và check trùng, bulk import CSV (drag-drop/paste/parse/sample) và discovery preview mô phỏng; mọi bản ghi vào dạng Pending Review.', ['form', 'import', 'assets'], false),
    F('src/screens/d-assets.tsx', 'AssetDetail', [465, 529], false, 'Chi tiết asset (AS-03): chặn truy cập theo project, các tab overview/scope/operations/agents/findings/approvals/history, propose scope change hoặc mark out of scope có confirm và audit.', ['detail-page', 'assets', 'tabs'], false),
  ],
  'src/screens/d-library.tsx': [
    F('src/screens/d-library.tsx', 'Playbooks', [16, 91], false, 'Trang Playbooks & TTPs (PB-01): 3 tab playbooks/adversary profiles/MITRE ATT&CK techniques, filter search/tactic/status/OS, card grid playbook và danh sách technique nhóm theo tactic kèm detection status.', ['library', 'playbooks', 'mitre-attack'], false),
    F('src/screens/d-library.tsx', 'PlaybookDetail', [94, 201], false, 'Chi tiết playbook (PB-02/03): steps kèm technique tags, attach-to-project với compatibility checks (scope, version lock, blocked variants), request approval, duplicate draft, version history và usage/impact của plans/operations đang pin version.', ['detail-page', 'playbooks', 'versioning'], false),
    F('src/screens/d-library.tsx', 'PlaybookReview', [204, 293], false, 'Màn review revision playbook (PB-V3-03/V3-14): diff steps và techniques giữa bản frozen và bản pending, risk notes, quyết định approve/return-to-draft với lý do qua A.decidePlaybookRevision.', ['review', 'diff', 'approvals'], false),
    F('src/screens/d-library.tsx', 'TechniqueDetail', [296, 351], false, 'Chi tiết technique ATT&CK (PB-04): KPI playbooks/steps/findings liên quan, approved simulations, kết quả test theo project, detection status phụ thuộc integration SIEM và danh sách findings.', ['detail-page', 'techniques', 'detection'], false),
  ],
  'src/screens/d-shared.tsx': [
    F('src/screens/d-shared.tsx', 'withLoading', [8, 13], true, 'HOC bọc màn hình: render PageSkeleton khi store đang loading (đang chuyển project), ngược lại render component gốc.', ['hoc', 'loading', 'skeleton'], true),
    F('src/screens/d-shared.tsx', 'hashNum', [15, 15], true, 'Hash chuỗi đơn giản (cơ số 31 mod 9973) dùng để sinh dữ liệu mô phỏng ổn định như heartbeat và latency.', ['hash', 'simulated-data', 'helper'], true),
    F('src/screens/d-shared.tsx', 'useProjectName', [19, 22], true, 'Hook trả về hàm format "id — name" của project từ db, hoặc POOL_LABEL khi id rỗng (agent ở shared pool).', ['hook', 'formatting', 'projects'], true),
    F('src/screens/d-shared.tsx', 'useVisibleAgents', [25, 29], true, 'Hook lọc agents theo pid đang chọn hoặc theo tập project user có thể truy cập khi ở chế độ All Projects; agents pool (projectId rỗng) luôn được liệt kê.', ['hook', 'filtering', 'agents'], true),
    F('src/screens/d-shared.tsx', 'PickProjectBanner', [32, 39], true, 'Banner cảnh báo ở chế độ All Projects: yêu cầu chọn project cụ thể để thực hiện hành động, nút mở project switcher qua setSwitcherOpen.', ['banner', 'ux', 'projects'], true),
    F('src/screens/d-shared.tsx', 'Blocked', [41, 43], true, 'Wrapper quanh Empty với icon Lock hiển thị trạng thái bị chặn kèm title, mô tả và actions.', ['empty-state', 'guard', 'helper'], true),
    F('src/screens/d-shared.tsx', 'wsLabel', [45, 45], true, 'Format "n <unit>" xử lý số ít/số nhiều cho nhãn đếm.', ['formatting', 'helper', 'i18n'], true),
    F('src/screens/d-shared.tsx', 'Id', [48, 48], true, 'Span Mono không xuống dòng dùng để hiển thị định danh (ID).', ['typography', 'display', 'helper'], true),
    F('src/screens/d-shared.tsx', 'IdL', [51, 51], true, 'Button mono màu accent cho ID có onClick, kèm stopPropagation để không kích hoạt row click.', ['button', 'display', 'helper'], true),
    F('src/screens/d-shared.tsx', 'MoreFilters', [54, 69], true, 'Popover "More filters" cho filter bar gọn: đóng khi click ra ngoài qua document listener, hiển thị số filter đang active.', ['popover', 'filtering', 'ux'], true),
    F('src/screens/d-shared.tsx', 'DTable', [73, 95], false, 'Bảng dữ liệu generic (DCol) với sticky header và sticky cột ID đầu tiên, scroll trong container, row click/keyboard, selectedKey và empty state.', ['table', 'component', 'sticky'], true),
    F('src/screens/d-shared.tsx', 'Trunc', [98, 98], true, 'Span truncate với max-width tùy chọn và giá trị đầy đủ trong title.', ['typography', 'display', 'helper'], true),
    F('src/screens/d-shared.tsx', 'shortDate', [101, 101], true, 'Chuẩn hóa chuỗi ngày hiển thị: bỏ đuôi "(UTC+7)" và năm khỏi timestamp.', ['formatting', 'date', 'helper'], true),
  ],
  'src/screens/d.tsx': [],
  'src/ui.tsx': [
    F('src/ui.tsx', 'cx', [5, 5], true, 'Nối các class truthy thành một chuỗi className (bản clsx thu gọn).', ['utility', 'classnames', 'helper'], true),
    F('src/ui.tsx', 'Status', [64, 75], true, 'Badge trạng thái chuẩn hóa theo kind/value tra bảng STATUS: luôn kết hợp icon + label (không chỉ dùng màu), size sm/md, icon Loader2 có animate-spin.', ['component', 'status', 'badge'], true),
    F('src/ui.tsx', 'Sev', [76, 76], true, 'Shortcut hiển thị severity (critical/high/medium/low/info) qua Status kind="sev".', ['component', 'severity', 'badge'], true),
    F('src/ui.tsx', 'toneText', [77, 77], true, 'Map tone (ok/warn/bad/accent/cyan/neutral) sang class text-* tương ứng.', ['utility', 'tone', 'helper'], true),
    F('src/ui.tsx', 'AiModeBadge', [80, 87], true, 'Badge chế độ AI operator (Observe/Propose/Approved Execution) với icon và bảng màu riêng từng mode.', ['component', 'badge', 'ai'], true),
    F('src/ui.tsx', 'ApprovalBanner', [88, 106], true, 'Banner trạng thái phê duyệt (none/waiting/approved/rejected/expired) với icon, role=status/alert và action tùy chọn.', ['component', 'banner', 'approval'], true),
    F('src/ui.tsx', 'DemoTag', [107, 107], true, 'Tag nhỏ "Demo data" với icon flask đánh dấu dữ liệu mô phỏng.', ['component', 'badge', 'demo'], true),
    F('src/ui.tsx', 'ConsolePane', [108, 110], true, 'Khung console mono tối màu, overflow auto, dùng cho log/terminal.', ['component', 'console', 'display'], true),
    F('src/ui.tsx', 'ReasonCode', [112, 115], true, 'Chip mã lý do bị chặn (Missing approval, Out of scope, Expired grant…) với icon tương ứng từng code.', ['component', 'chip', 'reason'], true),
    F('src/ui.tsx', 'Button', [127, 137], true, 'Button đa variant (primary/secondary/ghost/danger/dangerSolid) với size sm/md/lg, icon tùy chọn và style disabled đồng nhất.', ['component', 'button', 'form'], true),
    F('src/ui.tsx', 'IconButton', [138, 144], true, 'Nút icon vuông 40px bắt buộc có aria-label và title.', ['component', 'button', 'accessibility'], true),
    F('src/ui.tsx', 'Card', [147, 149], true, 'Khối panel bo góc viền line, bật/tắt padding qua prop pad.', ['component', 'layout', 'card'], true),
    F('src/ui.tsx', 'CardHeader', [150, 160], true, 'Header của Card: title, sub mô tả và khu actions bên phải.', ['component', 'layout', 'card'], true),
    F('src/ui.tsx', 'PageHeader', [161, 191], true, 'Header trang: breadcrumb nav, nút back, title + meta, sub và actions.', ['component', 'layout', 'header'], true),
    F('src/ui.tsx', 'Tabs', [192, 217], true, 'Tab bar với roving tabindex, điều hướng bàn phím (ArrowLeft/Right, Home, End), count badge và aria-selected.', ['component', 'tabs', 'accessibility'], true),
    F('src/ui.tsx', 'Segmented', [218, 226], true, 'Nhóm nút segmented control generic theo kiểu T với aria-pressed.', ['component', 'control', 'form'], true),
    F('src/ui.tsx', 'Banner', [229, 242], true, 'Banner thông báo info/warn/bad/ok với icon tùy chỉnh, action và role alert/status.', ['component', 'banner', 'feedback'], true),
    F('src/ui.tsx', 'Empty', [243, 252], true, 'Empty state với icon tròn, title, mô tả và action.', ['component', 'empty-state', 'display'], true),
    F('src/ui.tsx', 'Skeleton', [253, 253], true, 'Khối pulse animation làm placeholder loading.', ['component', 'skeleton', 'loading'], true),
    F('src/ui.tsx', 'PageSkeleton', [254, 262], true, 'Skeleton toàn trang (title, subtitle, grid 4 KPI, khối nội dung) với aria-busy.', ['component', 'skeleton', 'loading'], true),
    F('src/ui.tsx', 'Field', [266, 274], true, 'Label bọc control form với dấu required, hint và error hiển thị kèm icon cảnh báo.', ['component', 'form', 'field'], true),
    F('src/ui.tsx', 'Input', [275, 275], true, 'Input chuẩn hóa theo fieldCls (viền, focus ring, disabled).', ['component', 'form', 'input'], true),
    F('src/ui.tsx', 'Textarea', [276, 276], true, 'Textarea chuẩn hóa theo fieldCls với min-height.', ['component', 'form', 'textarea'], true),
    F('src/ui.tsx', 'Select', [277, 277], true, 'Select chuẩn hóa theo fieldCls với appearance-none.', ['component', 'form', 'select'], true),
    F('src/ui.tsx', 'SearchBox', [278, 285], true, 'Ô tìm kiếm controlled có icon Search bên trái và aria-label theo placeholder.', ['component', 'search', 'form'], true),
    F('src/ui.tsx', 'Check', [286, 293], true, 'Checkbox với label tùy chọn, trạng thái disabled.', ['component', 'form', 'checkbox'], true),
    F('src/ui.tsx', 'Toggle', [294, 300], true, 'Switch toggle với role=switch, aria-checked và knob trượt.', ['component', 'form', 'toggle'], true),
    F('src/ui.tsx', 'FilterBar', [301, 308], true, 'Hàng filter wrap các control bên trái và slot "right" căn phải.', ['component', 'layout', 'filtering'], true),
    F('src/ui.tsx', 'Table', [312, 336], true, 'Bảng generic theo Col<T>: ẩn cột theo breakpoint (hideBelow md/lg), row click + Enter, selectedKey highlight và empty state.', ['component', 'table', 'display'], true),
    F('src/ui.tsx', 'usePaged', [337, 342], true, 'Hook phân trang client-side trả về rows trang hiện tại, page, pages, setPage và total.', ['hook', 'pagination', 'table'], true),
    F('src/ui.tsx', 'Pager', [343, 355], true, 'Điều hướng trang trước/sau kèm tổng số bản ghi, ẩn khi chỉ 1 trang.', ['component', 'pagination', 'table'], true),
    F('src/ui.tsx', 'useDialogFocus', [358, 402], false, 'Hook focus-trap cho dialog: Escape đóng, Tab vòng trong focusable items, hỗ trợ nhiều dialog layer qua data-dialog-layer và khôi phục focus trước đó.', ['hook', 'focus-trap', 'accessibility'], false),
    F('src/ui.tsx', 'Modal', [404, 421], true, 'Modal dialog với overlay click để đóng, focus trap qua useDialogFocus, width tùy chỉnh, danger variant và footer.', ['component', 'modal', 'dialog'], true),
    F('src/ui.tsx', 'Drawer', [422, 439], true, 'Drawer trượt từ phải với overlay, focus trap, title và footer.', ['component', 'drawer', 'dialog'], true),
    F('src/ui.tsx', 'Menu', [440, 462], true, 'Dropdown menu đóng khi click ra ngoài, item có icon/danger/disabled/hint, align left/right.', ['component', 'menu', 'dropdown'], true),
    F('src/ui.tsx', 'Mono', [465, 465], true, 'Span font-mono 13px dùng cho identifier/giá trị kỹ thuật.', ['typography', 'display', 'helper'], true),
    F('src/ui.tsx', 'IdLink', [466, 466], true, 'Button mono màu accent cho ID có onClick kèm stopPropagation.', ['component', 'link', 'helper'], true),
    F('src/ui.tsx', 'DescList', [467, 475], true, 'Danh sách mô tả key-value dạng dl với 1–3 cột responsive.', ['component', 'display', 'list'], true),
    F('src/ui.tsx', 'Kpi', [476, 485], true, 'Thẻ KPI: label, value lớn, tone màu, sub text, icon tùy chọn và optional onClick chuyển thành button.', ['component', 'kpi', 'display'], true),
    F('src/ui.tsx', 'Progress', [486, 494], true, 'Thanh tiến trình với role=progressbar, aria-valuenow, tone màu và % hiển thị.', ['component', 'progress', 'display'], true),
    F('src/ui.tsx', 'Avatar', [495, 498], true, 'Avatar chữ initials sinh từ 2 từ cuối của tên với size tùy chỉnh.', ['component', 'avatar', 'display'], true),
    F('src/ui.tsx', 'Person', [499, 499], true, 'Hiển thị Avatar nhỏ + tên người dùng inline.', ['component', 'display', 'person'], true),
    F('src/ui.tsx', 'Timeline', [500, 513], true, 'Timeline dọc với dot màu theo tone, title, sub và timestamp monospace.', ['component', 'timeline', 'display'], true),
    F('src/ui.tsx', 'Stepper', [514, 527], true, 'Stepper các bước với trạng thái hoàn thành/hiện tại, optional onJump để nhảy bước.', ['component', 'stepper', 'wizard'], true),
    F('src/ui.tsx', 'Donut', [530, 543], true, 'Biểu đồ donut SVG từ segments data với center content và aria-label.', ['component', 'chart', 'svg'], true),
    F('src/ui.tsx', 'Legend', [544, 546], true, 'Legend màu cho chart với label, value và ô màu vuông.', ['component', 'chart', 'legend'], true),
    F('src/ui.tsx', 'BarChart', [547, 560], true, 'Biểu đồ cột đơn giản với max scaling, value label và màu tùy từng cột.', ['component', 'chart', 'display'], true),
    F('src/ui.tsx', 'LineChart', [561, 578], true, 'Biểu đồ đường SVG đa series với gridlines, điểm đánh dấu và nhãn trục x.', ['component', 'chart', 'svg'], true),
    F('src/ui.tsx', 'Gated', [582, 600], true, 'Bọc control bị vô hiệu hóa: hover/focus/click hiện tooltip giải thích lý do, render con với inert khi bị chặn.', ['component', 'guard', 'accessibility'], true),
    F('src/ui.tsx', 'Locked', [602, 604], true, 'Nhãn nhỏ icon Lock + lý do hành động bị khóa (permission/read-only).', ['component', 'guard', 'display'], true),
    F('src/ui.tsx', 'useGuard', [606, 612], true, 'Hook kiểm tra read-only theo project (role viewer hoặc project closed) qua store.readOnly và trả về reason giải thích cho UI.', ['hook', 'guard', 'permission'], true),
    F('src/ui.tsx', 'PersonaHint', [614, 623], true, 'Gợi ý đổi persona trong demo khi role hiện tại không đủ quyền, nút Switch to persona gọi setMe.', ['component', 'demo', 'ux'], true),
    F('src/ui.tsx', 'useDebounced', [625, 629], true, 'Hook debounce giá trị theo khoảng ms (mặc định 200) bằng setTimeout trong useEffect.', ['hook', 'debounce', 'utility'], true),
    F('src/ui.tsx', 'useMemoList', [630, 630], true, 'Alias re-export của useMemo dùng để memoize danh sách.', ['hook', 'memo', 'utility'], true),
  ],
}

const fileMeta = {
  'src/screens/b-detail.tsx': { nonEmpty: 530, cx: 'complex', summary: 'Trang chi tiết dự án của phân hệ Projects: kiểm tra quyền truy cập, điều hướng 13 tab (overview, scope & ROE, operations, plans, findings, reports, evidence, audit, team, sessions, close) qua MAIN_TABS/MORE_TABS, banner trạng thái phê duyệt/đóng và các tab hiển thị dữ liệu read-only lọc theo projectId.', tags: ['react-screen', 'project-detail', 'tabs', 'routing'], notes: 'Tách tab phức tạp (scope/team/close) sang file b-detail2.tsx; dùng useGuard và eligibility để gate hành động.' },
  'src/screens/b-detail2.tsx': { nonEmpty: 421, cx: 'complex', summary: 'Các tab phức tạp của trang chi tiết dự án: ScopeTab (so sánh và chỉnh sửa ROE với luồng re-approval), TeamTab (members và approvals) và CloseTab (closeout checklist), cùng hai hook useSubmitApproval và useReopen dùng chung.', tags: ['scope', 'approvals', 'closure', 'hooks'], notes: 'Xử lý các business rule PRE-03, PRE-08 và bump ROE version khi sửa scope đã approved.' },
  'src/screens/b-wizard.tsx': { nonEmpty: 549, cx: 'complex', summary: 'Wizard tạo dự án mới 5 bước (basic details, objectives, scope, ROE & approvals, review) với validation riêng từng bước, đề xuất project code, scope check, quản lý members theo role rank và hai luồng kết quả Create Draft hoặc Submit for Approval.', tags: ['wizard', 'form', 'validation', 'projects'], notes: 'Dùng useDirty để chặn mất dữ liệu và navigator.onLine check trước khi tạo.' },
  'src/screens/b.tsx': { nonEmpty: 108, cx: 'moderate', summary: 'Trang danh sách dự án với filter persist qua store, bảng Table + Pager, export CSV (BOM + escape), pin/unpin và định nghĩa routes map cho cả phân hệ Projects (projects, project-new, project).', tags: ['react-screen', 'table', 'export-csv', 'routing'], notes: 'routes nối ProjectNew (wizard) và ProjectPage (chi tiết) vào router của App.' },
  'src/screens/d-agents.tsx': { nonEmpty: 662, cx: 'complex', summary: 'Phân hệ Agents: fleet list với 6 KPI và bộ lọc, shared pool, quản lý agent groups (GroupModal/GroupsTab), connectivity & health (Heartbeat, LineChart, remediation), AssignDrawer xin phân bổ qua approval gate, FailurePanel xử lý agent mất kết nối và AgentDetail nhiều tab.', tags: ['agents', 'fleet', 'health', 'approval-gate'], notes: 'agentRoutes bọc Agents và AgentDetail bằng withLoading để hiển thị skeleton khi đổi project.' },
  'src/screens/d-assets.tsx': { nonEmpty: 522, cx: 'complex', summary: 'Phân hệ Assets: danh sách với ScopeBadge giải thích scope, scope map SVG + review approve/reject thay đổi scope, thêm asset thủ công/CSV/discovery mô phỏng qua validateIdent và ImportPreview, trang chi tiết asset với các tab liên quan operations/agents/findings/approvals.', tags: ['assets', 'scope', 'import', 'validation'], notes: 'validateIdent và ScopeBadge được export để dùng lại; assetRoutes map assets/asset-new/asset-scope/asset.' },
  'src/screens/d-library.tsx': { nonEmpty: 346, cx: 'complex', summary: 'Thư viện Playbooks & TTPs: danh sách playbook/adversary profile theo tab, catalog MITRE ATT&CK techniques nhóm theo tactic với detection status, chi tiết playbook với compatibility checks và version lock, màn review revision (diff steps) và chi tiết technique.', tags: ['playbooks', 'mitre-attack', 'review', 'library'], notes: 'libraryRoutes map playbooks/playbook/technique/playbook-review qua withLoading.' },
  'src/screens/d-shared.tsx': { nonEmpty: 87, cx: 'moderate', summary: 'Tiện ích dùng chung cho các màn hình phân hệ D (Agents/Assets/Library): HOC withLoading, hooks useProjectName/useVisibleAgents, banner PickProjectBanner, Blocked, popover MoreFilters, bảng DTable sticky và các helper hiển thị Id/IdL/Trunc/shortDate/hashNum.', tags: ['shared-components', 'hooks', 'table', 'helpers'], notes: 'POOL_LABEL là hằng nhãn cho agent chưa gán project.' },
  'src/screens/d.tsx': { nonEmpty: 5, cx: 'simple', summary: 'Barrel route của phân hệ Agents/Assets/Library: gộp agentRoutes, assetRoutes và libraryRoutes thành một routes map duy nhất cho router.', tags: ['routing', 'barrel', 'routes'], notes: '' },
  'src/ui.tsx': { nonEmpty: 615, cx: 'complex', summary: 'Thư viện UI dùng chung toàn app: bảng STATUS badge cho mọi loại trạng thái, Button/Card/PageHeader/Tabs/Table/Modal/Drawer/Menu, biểu đồ SVG (Donut, BarChart, LineChart), guard Gated/Locked/useGuard/PersonaHint và các hook usePaged/useDialogFocus/useDebounced.', tags: ['ui-kit', 'components', 'hooks', 'accessibility'], notes: 'Dùng useStore chỉ trong các guard (useGuard, PersonaHint); phần còn lại là component thuần.' },
}

const imports = {
  'src/screens/b-detail.tsx': ['src/data.ts', 'src/screens/b-detail2.tsx', 'src/store.tsx', 'src/ui.tsx'],
  'src/screens/b-detail2.tsx': ['src/data.ts', 'src/store.tsx', 'src/ui.tsx'],
  'src/screens/b-wizard.tsx': ['src/data.ts', 'src/store.tsx', 'src/ui.tsx'],
  'src/screens/b.tsx': ['src/data.ts', 'src/screens/b-detail.tsx', 'src/screens/b-wizard.tsx', 'src/store.tsx', 'src/ui.tsx'],
  'src/screens/d-agents.tsx': ['src/data.ts', 'src/screens/d-shared.tsx', 'src/store.tsx', 'src/ui.tsx'],
  'src/screens/d-assets.tsx': ['src/data.ts', 'src/screens/d-shared.tsx', 'src/store.tsx', 'src/ui.tsx'],
  'src/screens/d-library.tsx': ['src/data.ts', 'src/screens/d-shared.tsx', 'src/store.tsx', 'src/ui.tsx'],
  'src/screens/d-shared.tsx': ['src/data.ts', 'src/store.tsx', 'src/ui.tsx'],
  'src/screens/d.tsx': ['src/screens/d-agents.tsx', 'src/screens/d-assets.tsx', 'src/screens/d-library.tsx'],
  'src/ui.tsx': ['src/store.tsx'],
}

const calls = {
  'src/screens/b-detail.tsx': [
    ['function:src/screens/b-detail2.tsx:useSubmitApproval', 0.8], ['function:src/screens/b-detail2.tsx:useReopen', 0.8],
    ['function:src/screens/b-detail2.tsx:ScopeTab', 0.8], ['function:src/screens/b-detail2.tsx:TeamTab', 0.8], ['function:src/screens/b-detail2.tsx:CloseTab', 0.8],
    ['function:src/ui.tsx:useGuard', 0.8], ['function:src/ui.tsx:Table', 0.8], ['function:src/ui.tsx:usePaged', 0.8],
    ['function:src/store.tsx:useStore', 0.8], ['function:src/store.tsx:eligibility', 0.8], ['function:src/store.tsx:readiness', 0.8],
    ['function:src/store.tsx:completion', 0.8], ['function:src/store.tsx:canAccessProject', 0.8],
  ],
  'src/screens/b-detail2.tsx': [
    ['function:src/ui.tsx:useGuard', 0.8], ['function:src/ui.tsx:Modal', 0.8],
    ['function:src/store.tsx:useStore', 0.8], ['function:src/store.tsx:closureChecklist', 0.8],
  ],
  'src/screens/b-wizard.tsx': [
    ['function:src/store.tsx:useStore', 0.8], ['function:src/store.tsx:useDirty', 0.8],
  ],
  'src/screens/b.tsx': [
    ['function:src/screens/b-wizard.tsx:ProjectNew', 0.8], ['function:src/screens/b-detail.tsx:ProjectPage', 0.8],
    ['function:src/ui.tsx:Table', 0.8], ['function:src/ui.tsx:PageHeader', 0.8], ['function:src/ui.tsx:usePaged', 0.8],
    ['function:src/store.tsx:useStore', 0.8], ['function:src/store.tsx:eligibility', 0.8],
  ],
  'src/screens/d-agents.tsx': [
    ['function:src/screens/d-shared.tsx:withLoading', 0.8], ['function:src/screens/d-shared.tsx:useVisibleAgents', 0.8],
    ['function:src/screens/d-shared.tsx:useProjectName', 0.8], ['function:src/screens/d-shared.tsx:Blocked', 0.8],
    ['function:src/screens/d-shared.tsx:DTable', 0.8], ['function:src/screens/d-shared.tsx:hashNum', 0.8],
    ['function:src/screens/d-shared.tsx:Id', 0.8], ['function:src/screens/d-shared.tsx:IdL', 0.8],
    ['function:src/screens/d-shared.tsx:MoreFilters', 0.8], ['function:src/screens/d-shared.tsx:shortDate', 0.8],
    ['function:src/screens/d-shared.tsx:Trunc', 0.8],
    ['function:src/ui.tsx:useGuard', 0.8], ['function:src/ui.tsx:usePaged', 0.8],
    ['function:src/store.tsx:useStore', 0.8],
  ],
  'src/screens/d-assets.tsx': [
    ['function:src/screens/d-shared.tsx:withLoading', 0.8], ['function:src/screens/d-shared.tsx:PickProjectBanner', 0.8],
    ['function:src/screens/d-shared.tsx:Blocked', 0.8], ['function:src/screens/d-shared.tsx:DTable', 0.8],
    ['function:src/screens/d-shared.tsx:hashNum', 0.8], ['function:src/screens/d-shared.tsx:Id', 0.8],
    ['function:src/screens/d-shared.tsx:IdL', 0.8], ['function:src/screens/d-shared.tsx:MoreFilters', 0.8],
    ['function:src/screens/d-shared.tsx:shortDate', 0.8], ['function:src/screens/d-shared.tsx:Trunc', 0.8],
    ['function:src/ui.tsx:useGuard', 0.8], ['function:src/ui.tsx:usePaged', 0.8],
    ['function:src/store.tsx:useStore', 0.8],
  ],
  'src/screens/d-library.tsx': [
    ['function:src/screens/d-shared.tsx:withLoading', 0.8], ['function:src/screens/d-shared.tsx:Id', 0.8],
    ['function:src/screens/d-shared.tsx:IdL', 0.8], ['function:src/screens/d-shared.tsx:MoreFilters', 0.8],
    ['function:src/ui.tsx:useGuard', 0.8], ['function:src/store.tsx:useStore', 0.8],
  ],
  'src/screens/d-shared.tsx': [
    ['function:src/store.tsx:useStore', 0.8],
    ['function:src/ui.tsx:PageSkeleton', 0.8], ['function:src/ui.tsx:Banner', 0.8], ['function:src/ui.tsx:Button', 0.8],
    ['function:src/ui.tsx:Empty', 0.8], ['function:src/ui.tsx:Mono', 0.8], ['function:src/ui.tsx:cx', 0.8],
  ],
  'src/screens/d.tsx': [],
  'src/ui.tsx': [['function:src/store.tsx:useStore', 0.8]],
}

const parts = {
  'batch-2-part-1.json': ['src/screens/b-detail.tsx', 'src/screens/b-detail2.tsx', 'src/screens/b-wizard.tsx', 'src/screens/b.tsx', 'src/screens/d-agents.tsx'],
  'batch-2-part-2.json': ['src/screens/d-assets.tsx', 'src/screens/d-library.tsx', 'src/screens/d-shared.tsx', 'src/screens/d.tsx'],
  'batch-2-part-3.json': ['src/ui.tsx'],
}

const outDir = 'D:/.VTNet/redteam/raptix/apps/web-improve/.ua/intermediate'

function fnNode(f) {
  const span = f.span
  const len = span[1] - span[0] + 1
  const cxc = len > 200 ? 'complex' : len >= 50 ? 'moderate' : 'simple'
  return { id: `function:${f.path}:${f.name}`, type: 'function', name: f.name, filePath: f.path, lineRange: span, summary: f.summary, tags: f.tags, complexity: cxc }
}

const rebuilt = []
const rebuiltEdges = []
for (const [path, meta] of Object.entries(fileMeta)) {
  const fid = `file:${path}`
  const name = path.split('/').pop()
  const node = { id: fid, type: 'file', name, filePath: path, summary: meta.summary, tags: meta.tags, complexity: meta.cx }
  if (meta.notes) node.languageNotes = meta.notes
  rebuilt.push(node)
  for (const f of funcs[path] || []) {
    const n = fnNode(f)
    rebuilt.push(n)
    rebuiltEdges.push({ source: fid, target: n.id, type: 'contains', weight: 1.0, direction: 'forward' })
    if (f.exported) rebuiltEdges.push({ source: fid, target: n.id, type: 'exports', weight: 0.8, direction: 'forward' })
  }
  for (const imp of imports[path] || []) rebuiltEdges.push({ source: fid, target: `file:${imp}`, type: 'imports', weight: 0.7, direction: 'forward' })
  for (const [tgt, w] of calls[path] || []) rebuiltEdges.push({ source: fid, target: tgt, type: 'calls', weight: w, direction: 'forward' })
}

const nodeIds = new Set(rebuilt.map((n) => n.id))
const importTargets = new Set(Object.entries(imports).flatMap(([k, v]) => v.map((p) => `file:${p}`)))
const neighborSyms = new Set(['function:src/store.tsx:useStore', 'function:src/store.tsx:eligibility', 'function:src/store.tsx:readiness', 'function:src/store.tsx:completion', 'function:src/store.tsx:closureChecklist', 'function:src/store.tsx:useDirty', 'function:src/store.tsx:canAccessProject'])
let bad = 0
for (const e of rebuiltEdges) {
  if (e.source === e.target) { console.error('SELF EDGE', e); bad++ }
  const ok = nodeIds.has(e.target) || importTargets.has(e.target) || neighborSyms.has(e.target)
  if (!ok) { console.error('BAD TARGET', e); bad++ }
  if (e.direction !== 'forward') { console.error('BAD DIR', e); bad++ }
}
const dupIds = rebuilt.map((n) => n.id).filter((id, i, a) => a.indexOf(id) !== i)
if (dupIds.length) { console.error('DUP IDS', dupIds); bad++ }
const importCount = rebuiltEdges.filter((e) => e.type === 'imports').length
const expectedImports = Object.values(imports).reduce((a, b) => a + b.length, 0)
if (importCount !== expectedImports) { console.error('IMPORT COUNT', importCount, expectedImports); bad++ }

console.log('nodes:', rebuilt.length, 'edges:', rebuiltEdges.length, 'imports:', importCount, '/', expectedImports, 'errors:', bad)
if (bad > 0) process.exit(1)

for (const [file, files] of Object.entries(parts)) {
  const set = new Set(parts[file])
  const srcSet = new Set(parts[file].map((p) => `file:${p}`))
  const nodes = rebuilt.filter((n) => set.has(n.filePath))
  const nodeSet = new Set(nodes.map((n) => n.id))
  const edges = rebuiltEdges.filter((e) => srcSet.has(e.source))
  writeFileSync(`${outDir}/${file}`, JSON.stringify({ nodes, edges }, null, 2))
  console.log(file, 'nodes:', nodes.length, 'edges:', edges.length)
}
