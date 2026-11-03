# Tiến độ

Trạng thái: TODO, IN_PROGRESS, IMPLEMENTED, VERIFIED, PARTIAL, BLOCKED, FAILED, SKIPPED.

| Task | Workstream | Status | Commit | Tests | Remaining |
|---|---|---|---|---|---|
| Pre-flight, kiểm kê, tài liệu tiến độ | Phase 0 | VERIFIED | (tài liệu trong thư mục này) | Đọc mã; baseline test xanh | — |
| Namespace query key và planning-seed theo actor | WS-0 | IMPLEMENTED | `d67d2665` | Test mới `query.test.tsx` (3), `planning-seed.test.ts` (+1); full suite 187 file, 1639 test | Canary hai tài khoản trên trình duyệt: BL-01 |
| Browser canary owner → viewer | WS-0 | BLOCKED | — | — | BL-01 (không có tài khoản thứ hai trên môi trường cho phép; không tạo tài khoản trên 3001) |
| Bảng mục navigation một nguồn cho hai mode | WS-1 | VERIFIED | `b9d28f3c` | Characterization (16 → giữ nguyên), module test; smoke mock 56/56 cả hai cờ | Real smoke: NV (cần stack). Bảng `MOCK_PROJECT_TABS` giữ có chủ đích cho demo |
| Measures Overview (định nghĩa, trạng thái, provenance) | WS-4A | VERIFIED | `349bcbc5` | `measures.test.ts` (9); overview và shell xanh; smoke mock 56/56 | Provenance `asOf` theo nguồn: chưa có nguồn đáng tin (xem OPEN-ISSUES) |
| Cờ giới hạn của task inbox (server) | WS-2 | IMPLEMENTED | `76826809` | `t15-inbox` (7 test, +1); tsc server 0 | Trạng thái giới hạn đã vào client |
| Read model Decisions (`features/decisions`) | WS-2 | PARTIAL | `b3195015` | Full suite 188 file, 1649 test; boundary khóa baseline 408 | Tab Team (vai trò membership) và closure/library: BL-03. Trình duyệt: NV |
| Layout Overview (Attention, 4 measure, giảm mật độ) | WS-4B | TODO | — | — | Phụ thuộc WS-2 cho khối decision |
| C2 workspace presentation, alias c2-* | WS-3 | TODO | — | — | BL-02 cho phần ghi |

## Nhật ký

### Pre-flight (HEAD `d3225f63`)

- Branch `frontend`. Thay đổi chưa commit là của owner, không đụng: GLOSSARY.md, ADR 0095/0098/0099, design C2, R03 screenshot, các untracked (kể cả `apps/web/.scratch/web-real-ui/`).
- Đọc `structural-plan/00..06`, `apps/web/AGENTS.md`, `apps/web/CLAUDE.md`.

### WS-0 (commit `d67d2665`)

- Xác minh từ mã: cách ly cache đã có qua `ActorQueries key={actor}`; storage chat, findings, capture, asset-map đã theo actor và nằm trong danh sách dọn dẹp. Phần dư: hằng số `local` trong key project/members; `planning-seed` là sessionStorage theo engagement.
- Sửa: key project và members lấy actor từ phiên (`useProjectCacheActor`, export qua `features/projects/index.ts`); cờ planning-seed theo actor.
- Tests: `query.test.tsx` (đỏ trên mã cũ cho hai trường hợp actor, xanh cho single-user), `planning-seed.test.ts` (thêm test actor khác không thấy cờ).
- Không đổi authentication, authorization, API contract.

### WS-1 (commit `b9d28f3c`)

- Kiểm kê: hai bảng mục, ba bảng alias, `MOCK_PROJECT_TABS` (danh sách của demo), `GLOBAL_RESOURCE_PAGES` (chưa đưa vào module, ghi nhận). Consumer: `sidebar.tsx`, `header.tsx`, `aliases.ts`, `project-detail-page.tsx`, `demo/project-detail/project-page.tsx`.
- Lệch thật đã sửa: `header.tsx` đọc bảng mock trong real mode.
- Đổi nhãn: "Sessions" → "C2 Sessions" (D-01).
- Không đổi tab id, route key, query parameter.

### WS-4A (commit `349bcbc5`)

- Lệch thật đã sửa: "Awaiting decisions" đếm cả `active-stop` (trái D-02). Nay loại khỏi số đếm và banner.
- Lệch thật đã sửa: "Active projects" ghi "Planning or running" nhưng đếm bốn trạng thái. Mô tả nay khớp tập đếm; ghi chú nguồn: contract thật chỉ có planning và running.
- Banner: "N workflow decisions pending in your projects." thay cho "await your review" (số đếm không chỉ là việc của người dùng).

## Cập nhật cuối vòng

| Task | Workstream | Status | Commit | Tests | Remaining |
|---|---|---|---|---|---|
| Thay nhãn Sessions → C2 Sessions; header đúng mode; bảng menu một nguồn | WS-1 | VERIFIED (mock) | `b9d28f3c` | Characterization; smoke 56/56 hai cờ | Real smoke NV |
| Overview: attention đầu trang; Projects; thứ tự khối | WS-4B | VERIFIED (mock) | `837e1d9d`, ảnh `304df2e8` | Test overview; Playwright 4 khung nhìn | Real NV |
| Mật khẩu demo không trong lỗi đăng nhập (S-03, D-06) | Follow-up | VERIFIED | `ffe85384` | `auth.test` (+1) | — |
| Tab Team & Approvals; closure/library | WS-2 | PARTIAL | — | — | TEAM-1; BL-03 |
| C2Workspace; alias c2-*; rollup | WS-3 | PARTIAL (BLOCKED) | — | Mã kiểm: global infrastructure không có nút ghi | BL-02; D-03 |
| Tài liệu vòng: WS-0..WS-4, hồi quy, vấn đề mở, báo cáo cuối, RESUME | Tài liệu | VERIFIED | commit tài liệu cuối | — | — |

HEAD mã sản phẩm: `ffe85384`. Gate cuối: xem `VERIFICATION-LOG.md`.

## Cập nhật vòng 5 (HEAD `67ddf571`, tài liệu sau commit cuối)

| Task | Workstream | Status | Commit | Tests | Remaining |
|---|---|---|---|---|---|
| Dark mode: sửa bằng chứng (script sai) | P0.1 | VERIFIED | `65eb3b14` | Đo class và nền | — |
| Canary actor trên stack cô lập | P0.2 | VERIFIED (10/10); draft/thread NV | — | `WS-0-CANARY-REPORT.md` | Draft cần runtime |
| Smoke real trên stack; sửa harness | P0.3 | VERIFIED một phần | `bfa26841` | 42 đạt, 14 khai báo, 0 mới | Overview/drawer/tablet real NV |
| Team & Approvals (membership, decisions, AI Workspace, quyền) | P1.1 | VERIFIED (real trên stack) | `000dea15`, `67ddf571` | Test team, team-check | — |
| Giới hạn theo từng loại (server + client) | P1.2 | PARTIAL | `52f587aa`, `000dea15` | t15 8 test; client | "Resolved" không có nguồn |
| Closure và library theo project | P1.3 | PARTIAL | `000dea15` | Test team | BL-03 (aggregate server) |
| Severity thành disclosure | P2.1 | VERIFIED (mock) | `990c4a4b` | Overview 32 test | — |
| Resolver C2 và thông báo console | P3.2/P3.3 | VERIFIED (unit) | `9efa9f11` | `view.test.ts`, provider-tab | Provider thật NV |
| Ngoại lệ .gitignore cho thư mục C2 | P3 (hạ tầng) | VERIFIED | `01b9d0e9` | `git check-ignore` | — |
| GLOBAL-1 (resource pages) | P4 | VERIFIED | `17dfff1a` | router, shell | — |
| Drawer mobile: nút đóng và focus; huy hiệu có nghĩa | P4 (UX-25, UX-15) | VERIFIED (unit + mock) | `b9d2b8a7` | `sidebar-drawer.test` | Real mobile NV |
| FLAKY-1: dán thay gõ | P4 | VERIFIED | `c5714006` | `real-screens` 11/11 | — |
| UX-18: nhãn và chú thích | P4 | VERIFIED | `bf3863e0` | demo 43 test | — |
| UX-20: quy tắc màu trong AGENTS.md | P4 | VERIFIED (tài liệu) | `d9e7daf7` | — | — |
| Lý do của control disabled | Phụ | VERIFIED | `67ddf571` | members test; probe real | — |
| Harness route smoke: gắn response theo route | Phụ | VERIFIED | `bfa26841` | smoke lại | — |
| Gate cuối | Tất cả | VERIFIED | — | web 190/1664; server 64/623; mock 56/56 hai cờ; real 0 mới | — |

Nhật ký chi tiết: `VERIFICATION-LOG.md` (mục "Vòng 5"). Quyết định: `DECISION-LOG.md` (DL-09 đến DL-21).
