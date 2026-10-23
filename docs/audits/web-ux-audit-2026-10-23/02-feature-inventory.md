# 02 · Feature Inventory — Routes, Features, Components, Trùng lặp

Nguồn: `apps/web/src/router/routes.ts` (54 khóa mặc định + 1 khóa theo cờ `asset-map` = 55), `apps/web/src/shell/nav.ts`, và đầu file `index.ts` của 35 thư mục trong `apps/web/src/features/`.
Nhãn: `[C]` đọc source; `[B]` quan sát trong trình duyệt (mock, build production scratch).

## 1. Navigation

| Bề mặt | Số mục | Nguồn | Ghi chú |
|---|---:|---|---|
| Sidebar global | 7 | `nav.ts:27–45` `[C]` `[B] B01` | Overview, Projects, Findings / Assets, Capabilities, Infrastructure / Settings |
| Sidebar dự án mock | 14 | `nav.ts:87–127` `[C]`; đếm DOM `[B]` | PROJECT 1, PREPARATION 3, OPERATIONS 3, RESULTS 3, MANAGEMENT 4 |
| Sidebar dự án real | 18 | `nav.ts:134–177` `[C]` (chưa đếm DOM) | PROJECT 1, PREPARATION 3, OPERATIONS 3, RESULTS 4, MANAGEMENT 7 |
| Mục theo cờ `asset-map` | +1 | `nav.ts:106, 152` `[C]` | Mặc định tắt; khi tắt, `#/asset-map` → "Page not found" `[B]` |
| Header | — | `shell/header.tsx` `[C]` | Workspace switcher, project switcher, search, Emergency Stop (khi có project), Ask AI (khi có project), chuông, profile |
| Menu profile | — | `shell/header.tsx:137–202` `[C]` | Theme, Settings, Sign out, khối Demo Tools |
| Menu tài khoản real | — | `shell/real-chrome.tsx` `[C]` | Account/sign out, Switch to demo mode |

Lưu ý: checklist owner §2.2 ghi "project sidebar mock 13 / real 17"; đếm lại cho ra 14 (mock, DOM xác nhận) và 18 (real, theo source).

## 2. Route inventory (55 khóa)

Cột "Real" lấy từ `RealSurface` trong `routes.ts`: `shared` = cùng presentation với mock; `feature` = panel ghép bởi `RealFeatureRoute`; `component` = component real riêng; `system` = trang hệ thống; `unavailable` = panel "not connected".

| Khóa | Slice | Real | Đường vào chính | Ghi chú |
|---|---|---|---|---|
| login | a | component (real-login) | Chuyển hướng khi chưa đăng nhập | |
| forbidden | a | system | — | |
| notfound | a | system | Khóa không tồn tại | `B` `#/no-such-page` |
| error | a | system | — | |
| offline | a | system | — | |
| session-expired | a | system | — | |
| states | a | unavailable | Demo Pages (không có trong nav) | **UX-05** |
| overview | ov | shared | Global nav | |
| tasks | a | component (RealCommandCenter) | Nút "Open decision queue" và các CTA | **UX-08**, không có trong nav |
| projects | pj | shared | Global nav | |
| project-new | b | component | Projects → New Project | |
| project | dp | component (RealProjectDetail) | Project switcher, Projects | |
| operations | c | feature [operations] | Project nav: Operations | |
| operation-new | c | feature [governance, operations] | Operations | |
| preflight | c | feature [governance] | Operations | |
| operation-schedule | c | feature [governance, operations] | Operations | |
| operation | c | feature [operations] | Operations | |
| infrastructure | i | component (RealInfrastructureRoute) | Global nav | **UX-11** |
| agents | i | feature [fleet] | Alias → Infrastructure `[B] B14` | |
| agent | d | feature [fleet] | Project nav: Fleet (real) | |
| assets | d | shared | Global nav, Project nav | |
| asset-new | d | shared | Assets | |
| asset-scope | d | shared | Assets | |
| asset | d | shared | Assets | |
| capabilities | d | shared | Global nav | **UX-14** (nhãn Library) |
| playbook | d | shared | Capabilities | |
| technique | d | shared | Capabilities | |
| playbook-review | d | shared | Capabilities | |
| analysis | e | feature [analysis] | Project nav: Analysis (real) | |
| findings | e | shared | Global nav, Project nav | **UX-10** (ba bố cục) |
| finding-new | e | shared | Findings | |
| finding | e | shared | Findings | |
| evidence | e | shared | Project nav: Evidence | |
| evidence-inspector | e | shared | Evidence | |
| reports | f | shared | Project nav: Reports | |
| report-new | f | shared | Reports | |
| report | f | shared | Reports | |
| report-preview | f | shared | Reports | |
| report-review | f | shared | Reports | |
| settings | st | shared | Global nav, menu profile | **UX-01** (chuỗi demo) |
| ai-operator | g | component (RealWorkspace) | Project nav: AI Workspace | |
| ai-plan | g | feature [governance] | Planning | |
| ai-plan-review | g | feature [governance] | Planning | |
| ai-plan-compare | g | feature [governance] | Planning | |
| ai-trace | g | component (RealTrace) | Operations (trace) | |
| ai-history | g | component (RealWorkspace) | AI Workspace | |
| ai-fanout | g | feature [fleet] | Operations | |
| ai-branch | g | feature [fleet] | Operations | |
| c2 | i | feature [c2, campaigns] | Alias → Infrastructure `[B] B14`; project "Sessions" (real) | **UX-11** |
| c2-channel | h | feature [c2, campaigns] | Sessions | |
| c2-session | h | feature [c2, campaigns] | Sessions | |
| c2-console | h | feature [c2] | Sessions | |
| scenarios | s | unavailable | Menu profile → Prototype Home | **UX-05** |
| workspaces | s | unavailable | Chỉ gõ URL; `#/workspaces` hiển thị "Select a workspace" `[B]` | **UX-05** |
| asset-map (cờ) | a | component | Project nav khi bật cờ | Mặc định tắt |

## 3. Feature directories (35)

Mô tả lấy từ đầu `index.ts` của từng feature. Cột "Trùng/chồng" đánh dấu các cặp cần quyết định (structural, không làm trong quick win).

| Feature | Mục đích (theo source) | Trùng/chồng |
|---|---|---|
| agents | Panel agent execution và observed invocation trong AI conversation | Infrastructure (fleet) |
| aichat | Cards chat dùng chung; `RealWorkspace`, `RealConversation` | Copilot (Ask AI) — **UX-09** |
| analysis | Tab observed analysis của project | Results, Trace |
| approvals | Đọc approval và ghi quyết định HITL cho conversation | Team (`ApprovalInbox`), Tasks — **UX-08** |
| asset-map | Bản đồ tài sản (cờ, mặc định tắt) | — |
| assets | Feature asset (ADR-0096) | — |
| audit | Đọc audit workspace, bảng, recorder | — |
| branches | Trình bày fan-out và branch | Trace, Analysis |
| c2 | Tab provider của project: sessions, grants, lệnh một lần | Infrastructure — **UX-11** |
| capabilities | Thư viện skill (ADR-0096), tên trong nav là "Capabilities" | Tên "Library" trong copy — **UX-14** |
| closure | Tab closeout | — |
| copilot | Drawer Ask AI (mock và real) | AI Workspace — **UX-09** |
| documents | Không có mô tả đầu file | Reports, Planning |
| estop | Emergency Stop: dialog, trạng thái, panel (mock-side operation) | Operations, header — giữ (UX-24) |
| execution | Đọc runtime context (real) | Operations |
| findings | Presentation và contract findings | — **UX-10** |
| governance | Tab governance: binding kế hoạch, dừng | Operations (stop) |
| infrastructure | Route infrastructure real | Overview (global resource) |
| navigation | Không có mô tả đầu file | Shell nav |
| notices | Thông báo (header, center) | Tasks/Overview decision queue — **UX-08** |
| operations | Đọc fleet runtime; tab Operations; operation console mock-side | Execution, Trace |
| overview | Route group Overview, port, types | — |
| planning | Đọc trạng thái chuẩn bị, query | Plans — **UX-09** |
| plans | Cầu nối plan → operation | Planning — **UX-09** |
| projects | Đọc project, tạo project, query keys, portfolio | — |
| reports | Query và mutation report; `ReportsPage` | Documents |
| results | Ghi evidence của operation | Findings, Evidence |
| scope | Scope tab và query | — |
| settings | Settings tổ chức, tab mock/real | Project Settings (real) — đặt tên gần nhau |
| tasks | Command center real và inbox | Approvals — **UX-08** |
| team | Thành viên và nhãn; `ApprovalInbox` | Approvals — **UX-08** |
| trace | Không có mô tả đầu file | Analysis, Operations |
| vault | Tab vault của project | — |
| wizard | Không có mô tả đầu file (wizard tạo project/operation) | Projects |
| workers | Không có mô tả đầu file | Agents, Infrastructure |

Ghi chú: `CLAUDE.md` của `apps/web` nói "31 domains"; đếm thực tế 35 thư mục. Ba thư mục không có mô tả đầu file (`documents`, `navigation`, `trace`, `wizard`, `workers`, `estop` có mô tả ngắn) — cần owner xác nhận mục đích.

## 4. Primitive và component trùng lặp

| Primitive | Định nghĩa ở | Ghi chú |
|---|---|---|
| `StatCard` / `Kpi` / `Chip` / `Pill` | `features/aichat/common.tsx`, `features/analysis/views/analysis-page.tsx`, `features/findings/all-findings.tsx`, `features/projects/views/project-overview.tsx`, `ui/data.tsx` | **UX-21** |
| `StatTile` | `features/projects/views/portfolio-page.tsx:63` | Nhận `value: number`; không hiển thị "Not recorded" |
| `Unrecorded` | `features/projects/views/portfolio-page.tsx:40` | Hiển thị "—" kèm tooltip; **UX-13** |
| Overview KPI | `features/overview/views/overview-page.tsx` | Dùng `kpiDisplay` |

## 5. Ứng viên trùng lặp (tổng hợp)

1. Ask AI drawer và AI Workspace (UX-09).
2. Plans và Planning (UX-09).
3. Ba inbox phê duyệt: Overview decision queue, Tasks & Approval Inbox, Team & Approvals (UX-08).
4. Notifications bell và decision queue (cùng loại thông tin "cần chú ý").
5. Findings: tab project, route trong project, global (UX-10).
6. C2: Infrastructure, Sessions, alias `c2` (UX-11).
7. Hai Settings: org và Project Settings (đặt tên gần nhau).
8. Workspace switcher (demo) và Settings "Organization" (cùng khái niệm tổ chức, tên khác nhau) — UX-01.
9. Năm primitive KPI/Chip/Pill (UX-21).
