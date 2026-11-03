# Đóng Structural (vòng 5)

Mã sản phẩm: `67ddf571`; HEAD tài liệu sau commit cuối của vòng. Nhánh `frontend`. Không tự cho điểm 100%: vẫn còn NV và BLOCKED (xem mục 7).

## 1. Ma trận hoàn thành

| WS / subtask | Trạng thái | Commit | Ghi chú |
|---|---|---|---|
| **P0.1 Dark mode** | VERIFIED | `65eb3b14` | Lỗi nằm ở script (ảnh "dark" là sáng); ảnh thật và kiểm class/nền |
| **P0.2 Canary actor** | VERIFIED trên stack (10/10); draft/thread: NV | — | Mutation: test đơn vị bắt được, canary không (ghi rõ) |
| **P0.3 Real regression** | VERIFIED một phần | `bfa26841` (harness) | Smoke real 42 đạt, 14 khai báo, 0 mới; Team real kiểm; Overview/drawer/tablet real: NV |
| **P1.1 Team & Approvals** | VERIFIED (mock không có; real kiểm trên stack) | `000dea15`, `67ddf571` | Membership, decisions, footer AI Workspace, quyền xem/quyền quyết định |
| **P1.2 Trạng thái decision** | PARTIAL | `52f587aa`, `000dea15` | Pending/unavailable/limited/empty đủ; "resolved" không có nguồn |
| **P1.3 Closure & library** | PARTIAL | `000dea15` | Đọc theo project; chưa vào Overview aggregate (BL-03, cần server) |
| **P1.4 Acceptance** | Đạt, trừ phần NV | — | Không nhập tool approval hay stop vào decisions; không số giả |
| **P2.1 Overview density** | VERIFIED (mock) | `990c4a4b` | Severity thành disclosure, liên kết tới Findings |
| **P2.2 Attention region** | VERIFIED (mock) | `837e1d9d`, `000dea15` | Loaded/pending/unavailable/limited/empty |
| **P2.3 Thiết kế** | VERIFIED (mock 5 khung; real chỉ Team) | `304df2e8`, `65eb3b14` | Overview real chưa chụp |
| **P3.1 Ownership doc** | VERIFIED (tài liệu) | — | `WS-3-COMPLETION.md` |
| **P3.2 C2 read-only** | PARTIAL | `9efa9f11` | Resolver và thông báo console; view có sẵn được tái dùng |
| **P3.3 Route consolidation** | VERIFIED (unit) | `9efa9f11` | Mọi địa chỉ giữ tham số và fallback |
| **P3.4 Global infrastructure** | VERIFIED (mã) | — | Chỉ đọc; không có nút ghi |
| **P3.5 Verification C2** | PARTIAL | — | Không có provider thật; các trạng thái đã có test |
| **P4 UX-15** | PARTIAL | `b9d2b8a7` | Huy hiệu có nghĩa; lặp tên project giữ (lựa chọn bố cục) |
| **P4 UX-18** | VERIFIED (demo) | `bf3863e0` | Nhãn không co lại; chú thích xuống dòng |
| **P4 UX-20** | VERIFIED (tài liệu) | `d9e7daf7` | Quy tắc đã có trong comment token; không đổi giá trị |
| **P4 UX-25** | VERIFIED (test đơn vị + mock) | `b9d2b8a7` | Nút đóng, focus, ba cách đóng |
| **P4 GLOBAL-1** | VERIFIED | `17dfff1a` | Quy tắc resource pages vào module navigation |
| **P4 MOCK-1** | Giữ có chủ đích | — | Danh sách tab demo, có lý do trong code |
| **P4 FLAKY-1** | VERIFIED | `c5714006` | Dán thay gõ; không nới ngưỡng |
| **Phụ: lỗi disabled không có lý do** | VERIFIED | `67ddf571` | Tooltip của control disabled |
| **Phụ: `.gitignore` workspace** | VERIFIED | `01b9d0e9` | Ngoại lệ hẹp |

## 2. Thay đổi code thực tế

- Navigation: `features/navigation/{project-sections,index}.ts`; `GLOBAL_RESOURCE_PAGES` chuyển vào đây.
- Decisions: `features/decisions/{remote,model,index}.ts` (một nơi gọi `/api/tasks`; `inboxLimits`, `splitTasks`, `countText`).
- Team: `features/team/{approval-inbox,waiting}.tsx|ts`; `members.tsx` và `ui/button.tsx` (lý do disabled).
- Overview: `features/overview/{measures,service,remote,mock}.ts`, `views/overview-page.tsx`, `views/overview-blocks.tsx`.
- C2: `features/c2/workspace/view.ts`, `provider-tab.tsx`.
- Shell: `shell/sidebar.tsx` (drawer, huy hiệu), `shell/nav.ts`, `shell/header.tsx`.
- Server: `services/inbox-service.ts` (`limited`, `limitedKinds`).
- Harness: `tools/verify/route-smoke.mjs`.
- Demo: `demo/project-detail/project-page.tsx`, `demo/login-page.tsx`.
- Tài liệu: `apps/web/AGENTS.md` (mục màu), `.gitignore`.

## 3. Git

Vòng 4 (đã đóng trước): `d67d2665` → `ffe85384`, `692577a5`.

Vòng 5 (theo thứ tự):

- `65eb3b14` docs: sửa bằng chứng dark mode
- `52f587aa` server: `limitedKinds`
- `000dea15` client: giới hạn theo từng số; Team tab có "Also waiting" (16 file, xem DL-09)
- `990c4a4b` Overview: severity thành disclosure
- `01b9d0e9` chore: ngoại lệ `.gitignore`
- `9efa9f11` C2: resolver và thông báo console
- `17dfff1a` navigation: resource pages
- `b9d2b8a7` drawer và huy hiệu
- `c5714006` test: dán (FLAKY-1)
- `bf3863e0` UX-18
- `d9e7daf7` UX-20 (AGENTS.md)
- `67ddf571` lý do disabled
- `bfa26841` harness route smoke
- Commit tài liệu cuối của vòng (xem `git log`)

Không commit: thay đổi của owner (GLOSSARY, ADR 0095/0098/0099, design C2, R03 PNG đã sửa, các untracked), `docs/audits/web-ux-audit-2026-10-23.zip`, `docs/audits/web-ux-audit-2026-10-23/structural-execution.zip` (không do phiên này tạo, giữ nguyên), `evidence/R03-real-settings-before-identity-fix.png` (phiên trước).

## 4. Kết quả kiểm thử

Xem `FINAL-REGRESSION-REPORT.md`:

- Web: 190 file, 1664 test. Server: 64 file, 623 test.
- Typecheck, lint, boundary (408, khớp baseline), build hai cấu hình.
- Smoke mock: 56/56 (cả hai cấu hình). Smoke real: 42 đạt, 14 khai báo, 0 mới.
- Canary actor: 10/10 (stack cô lập).

## 5. Kiểm chứng mock và real

- Mock: Overview (sáng, tối, tablet, mobile); sidebar project; smoke mọi route.
- Real (stack cô lập): canary; smoke real; Team tab owner (sáng, tối) và viewer (sáng); `/api/tasks` có `limited` và `limitedKinds`.
- Real chưa kiểm: Overview với dữ liệu thật, drawer mobile, tablet, dark trên các màn hình khác.

## 6. Ảnh chụp

- Overview mock: `evidence/WS4B-overview-after-{desktop-light,desktop-dark,tablet-light,mobile-light,mobile-dark}.png`.
- Sidebar project: `evidence/WS1-project-sidebar-after-desktop-light.png`.
- Team real: `evidence/WS2-team-owner-dark-real.png`, `evidence/WS2-team-viewer-light-real.png`.

## 7. Còn lại và lý do

| Mục | Phân loại | Lý do |
|---|---|---|
| Closure và library trong Overview aggregate | BLOCKED (BL-03), có điều kiện | Cần đổi server aggregate: phân quyền, consumer, test tương thích |
| "Resolved" trong số đếm | Không có nguồn | `/api/tasks` chỉ trả mục đang chờ |
| Provenance `asOf` theo measure | BLOCKED (PROV-1), có điều kiện | Cần thời điểm nguồn từ server; không tự tạo timestamp |
| Thực thi C2, PTY console, lease, dispatch | BLOCKED (BL-02) | ADR-0095/0098/0099 Proposed; file có thay đổi chưa commit của owner |
| Draft chat với thread runtime (canary) | NV | Không có runtime trong stack |
| Smoke real Overview/drawer/tablet | NV | Chưa chụp; có smoke route và test đơn vị |
| Triển khai 3001 | BLOCKED (DEP-1) | Thao tác production; cần quyết định của bạn |
| Xóa hai file tạm trong `D:\Program Files\Git\` | BLOCKED (CLEAN-1) | Bộ kiểm tra an toàn chặn; cần bạn xóa tay |
| Lặp tên project trong breadcrumb | Giữ | Lựa chọn bố cục, không phải lỗi |
| `MOCK_PROJECT_TABS` | Giữ có chủ đích | Danh sách tab của demo |

## 8. Blocker không thể xử lý trong phiên

- BL-02 (ADR C2): không có cách hợp lệ để triển khai ghi khi ADR chưa được duyệt.
- BL-03 (aggregate server): cần thay đổi server có đánh giá phân quyền; ngoài phạm vi "không đổi contract ngoài cờ tương thích".
- DEP-1 và CLEAN-1: cần người dùng.

## 9. Thay đổi contract và tương thích

- `GET /api/tasks`: thêm `limited` (bool) và `limitedKinds` (mảng). Trường cũ giữ nguyên nghĩa. Client đọc thiếu trường như "không giới hạn" (`limitedKinds`) hoặc như `limited` chung (server cũ). Không đổi quyền, không đổi endpoint ghi.
- Port overview `tasks()`: kiểu `OverviewTaskList` gồm `items`, `limited`, `stopsLimited`. Mock và real đều cập nhật; không còn consumer dùng mảng.
- Đọc theo project (closure, library): dùng endpoint hiện có, không đổi contract.
- Không đổi authentication, authorization, hay runtime.

## 10. Mức sẵn sàng deploy và rollback

- Sẵn sàng về mã: gate đầy đủ đạt; smoke mock và real không có lỗi mới; canary đạt.
- Chưa sẵn sàng để chạy trên 3001 mà không quyết định: container đang chạy `d3225f63`; HEAD đã đi trước nhiều commit. Deploy cần quy trình có rollback (mục 10 của `docs/web-real-ui-implementation-plan.md`).
- Rollback: quay về `d3225f63` (image cũ) bằng lệnh đã ghi trong `RESUME.md` của vòng 4; thay đổi server (`limitedKinds`) tương thích ngược, nên rollback UI không cần rollback server.
- Rủi ro khi deploy: số "Awaiting decisions" thấp hơn; thứ tự khối Overview; Team tab có khu vực mới. Cần thông báo người dùng trước khi deploy.
