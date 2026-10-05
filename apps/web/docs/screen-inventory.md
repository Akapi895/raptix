# Screen & interaction inventory — web-raptix

> Phase 0 (W00) deliverable. Baseline khảo sát tại: 2026-10-01, source `src/` trước refactor.
> Nhãn scope: `single-user` (trong release), `deferred` (backlog), `mock-only`, `design-ref` (giữ nguồn tham chiếu, không mount).

## 1. Điểm xuất phát render

- `src/main.tsx` → `App.tsx`. App có 2 mode: **Home mode** (`inProject === false`) và **Project workspace mode**.
- Navigation hiện tại: `useState<Screen>` trong `App.tsx` — không có URL routing, reload luôn về Home.
- Route params không tồn tại; project selection chỉ trong memory.

## 2. Screens

| # | Screen file | Dòng | Mount | Reachable từ | Scope | Nguồn dữ liệu hiện tại |
|---|---|---|---|---|---|---|
| 1 | `screens/Home.tsx` | 816 | Home mode | Mặc định khi mở app | single-user | `PROJECTS` fixture |
| 2 | `screens/ProjectList.tsx` | 276 | **Không mount** | — | design-ref | `PROJECTS` fixture |
| 3 | `screens/ProjectOverview.tsx` | 543 | Có | Sidebar `overview`, breadcrumb | single-user | fixture + counters hardcode |
| 4 | `screens/AgentRun.tsx` | 1048 | Có | NewChatModal → `agent-run`; không có ở sidebar | single-user | mock sessions + `setTimeout` simulation |
| 5 | `screens/Chat.tsx` | 542 | **Không mount** | — | design-ref | mock |
| 6 | `screens/OperatorConsole.tsx` | 1071 | Có | Sidebar EXECUTION | single-user | simulation engine riêng trong file |
| 7 | `screens/Charter.tsx` | 369 | Có | Sidebar ENGAGEMENT | single-user | hardcoded content |
| 8 | `screens/ScopeBoundaries.tsx` | 400 | Có | Sidebar ENGAGEMENT | single-user | hardcoded RoE content |
| 9 | `screens/Orchestrator.tsx` | 304 | **Không mount** | — | design-ref | mock |
| 10 | `screens/Phases.tsx` | 316 | **Không mount** | — | design-ref | mock |
| 11 | `screens/InfrastructureData.tsx` | 1244 | Có (3 screens: `infrastructure`/`assets`/`credentials`) | Sidebar INFRASTRUCTURE & DATA | assets: single-user; credentials: **deferred** | fixture |
| 12 | `screens/Assets.tsx` | 794 | **Không mount** (InfrastructureData render thay) | — | design-ref | fixture |
| 13 | `screens/Credentials.tsx` | 512 | **Không mount** (InfrastructureData render thay) | — | design-ref / deferred | fixture |
| 14 | `screens/AttackGraph.tsx` | 953 | Có | Header/Overview CTA (không có ở sidebar) | single-user (P1) | mock nodes/edges |
| 15 | `screens/KnowledgeGraph.tsx` | 760 | Có | Overview CTA (không có ở sidebar) | single-user | mock nodes/edges |
| 16 | `screens/Findings.tsx` | 1049 | Có | Sidebar OUTCOMES | single-user | mock findings |
| 17 | `screens/Evidence.tsx` | 645 | Có | Header label; từ Findings? | single-user | mock artifacts |
| 18 | `screens/Logs.tsx` | 522 | Có | Sidebar OUTCOMES | single-user | mock events |
| 19 | `screens/Reports.tsx` | 660 | Có | Sidebar OUTCOMES | single-user | mock report data |
| 20 | `screens/Members.tsx` | 468 | Có | Sidebar (nhóm cuối) | **deferred** | `MEMBERS_BY_PROJECT` fixture |
| 21 | `screens/ProjectSettings.tsx` | 1025 | Có | Sidebar (nhóm cuối) | single-user (giảm scope) | fixture + form local state |
| 22 | `screens/VectorCampaigns.tsx` | 477 | Có | Sidebar EXECUTION | **deferred** (chưa có backend contract) | mock |
| 23 | `screens/C2Sessions.tsx` | 1596 | Có | Sidebar EXECUTION | **deferred** (chưa có backend contract) | mock + badge "3 Live" hardcode |

Quy tắc đã chốt (decision 0001): screens `Chat`, `Orchestrator`, `Phases`, `ProjectList`, `Assets`, `Credentials` chỉ là **design reference** — không xóa ngay trong Phase 0/1, chỉ loại bỏ sau khi refactor có inventory đối chiếu và canonical screen thay thế hoạt động.

## 3. Canonical screens (chốt cho refactor)

| Nhóm | Canonical | Giữ làm design-ref |
|---|---|---|
| Project list | `Home` (Home mode) | `ProjectList` |
| Chat/run | `AgentRun` | `Chat` |
| Console | `OperatorConsole` | — |
| Assets/env | `InfrastructureData` (tách theo feature) | `Assets`, `Credentials` |
| Agent inspection/OPPLAN | Chưa có canonical mounted | `Orchestrator`, `Phases` |

## 4. Components shell

| Component | Ghi chú |
|---|---|
| `components/Sidebar.tsx` (250) | Nav groups hardcode; project switcher; footer user "Alex Kim / Lead Pentester" hardcode; badge HITL global; badge "3 Live" hardcode cho C2 |
| `components/Header.tsx` (127) | Breadcrumb; **bug label**: `agent-run` → "Scope & Boundaries", `attack-graph` → "Environment Map"; search box decorative (không có state) |
| `components/HitlModal.tsx` (218) | Modal HITL global; theme tối `#121821` + brand `#EE0033`; Approve/Reject chỉ set state local; "Ask for Detail" gắn nhầm vào toggle detail |
| `components/NewProjectModal.tsx` (184) | Form name/scopeType/client; tạo project với `id = Date.now().toString()` |
| `components/NewChatModal.tsx` (212) | Chọn project có sẵn để vào `agent-run` |
| `components/Icons.tsx` (151) | Icon set dùng chung |

## 5. Modals & CTAs

| CTA/Modal | Nơi trigger | Hành vi hiện tại | Ghi chú scope |
|---|---|---|---|
| New Project modal | Home, NewChatModal | Tạo project fixture với `Date.now()` id, status `planning`, phase `Intake` | Cần map sang `POST /api/engagements` (P5); form fields hiện có `scopeType`/`client` không có trong backend contract |
| New Chat modal | Home | Chọn project → vào màn agent-run | Thread selection cần backend (P6) |
| HITL modal | Sidebar badge, Header, ProjectOverview | Approve/Reject chỉ đổi UI local; `hitlPending` reset global khi close | `hitlPending` là boolean **global** (không theo project); cần map sang Approvals API (P6) |
| Project switcher | Sidebar | `enterProject(p)` — không reset theo-route state | Cần route-based state (P3) |

## 6. Dữ liệu giả cần xử lý khi ra real mode

- `PROJECTS`, `MEMBERS_BY_PROJECT` fixtures trong `types.ts` (cùng file với domain types).
- `members` array trong mỗi `Project` + `myRole` — **Members/RBAC deferred**: không render như capability active.
- Counters `findings`/`assets`/`agents` hardcode trên project.
- `currentPhase` hardcode ("Assessment", "Intake"...).
- Badge "3 Live" C2; HITL badge global; simulated actions `setTimeout` trong AgentRun/OperatorConsole.
- Footer user hardcode (single-user: "Local Operator").
- `status` UI (`active/paused/completed/planning`) khác backend enum (`draft/planning/running/completed/failed`) — xem `docs/api-mapping.md` §Status mapping.

## 7. Visual baseline (P0.2)

Được ghi dạng token/tham số đo được (screenshot capture thủ công sẽ bổ sung khi chạy preview):

| Hạng mục | Giá trị baseline (từ code) |
|---|---|
| Brand chính (light UI) | `#DC2626` (index.css `--color-brand`), hover `#B91C1C` |
| Brand trong modal HITL (dark) | `#EE0033` / hover `#CC002B` — **khác** light brand; cần chốt decision 0002 |
| Background app | `#F8FAFC`; surface `#FFFFFF`; elevated `#F1F5F9` |
| Border | `#E2E8F0`; subtle `#F1F5F9` |
| Text | primary `#0F172A`; secondary `#475569`; muted `#94A3B8` |
| Status | success `#16A34A`; warning `#D97706`; info `#2563EB`; paused `#D97706`; completed `#64748B` |
| Sidebar | 240px fixed, bg trắng, border phải `#E2E8F0`; logo block 60px |
| Header | 60px fixed top, `left: 240`, bg trắng |
| Font | Inter (300–700), JetBrains Mono (400/500) qua Google Fonts — cần offline strategy (P1.4) |
| Radius | card/modal 16px (`rounded-2xl`), control 8px (`rounded-lg`), nav 6px (`rounded-md`) |
| Modal overlay | `bg-black/60 backdrop-blur-sm`, z-50 |
| Dark modal palette | bg `#121821`, border `#273142`, panel `#161D27`, deep `#0B0F14`, text `#F3F4F6`/`#9CA3AF` |
| Table density | row nhỏ, font 12–13px, padding 8–12px |

Viewport capture mục tiêu (desktop 1440×900): Home/Projects, Overview, AgentRun, OperatorConsole, Charter, Findings, Logs, Reports, KnowledgeGraph, AttackGraph + modal New Project và HITL. **Trạng thái chưa capture** — ghi lại để làm ngay sau P1 khi preview server chạy được (không chặn các phase tiếp theo vì baseline token đã chốt từ code).

## 8. Empty/loading/error states hiện có

- Hầu hết screens render trực tiếp fixture — **không có** loading/error state thật.
- Modal New Project không có validation error state.
- Ghi vào inventory: empty/error/unavailable states là công việc P3, không phải hiện trạng.
