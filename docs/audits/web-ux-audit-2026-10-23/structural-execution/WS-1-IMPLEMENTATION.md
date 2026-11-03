# WS-1 · Navigation một nguồn cho hai mode (Trạng thái: VERIFIED cho mock; real smoke NV)

UX-ID: UX-06 (chính), UX-14 (phần thuật ngữ "Sessions" → "C2 Sessions"). UX-07 không đổi.

## Trước

- Hai bảng mục viết tay (`MOCK_PROJECT_NAV` 14 mục, `REAL_PROJECT_NAV` 18 mục) trong `shell/nav.ts`.
- Ba bảng alias viết tay trong `router/aliases.ts` (`SHARED`, `MOCK`, `REAL`).
- `shell/header.tsx` đọc bảng mock để đặt nhãn Ask AI, kể cả khi ở real mode.

## Sau

- `features/navigation/project-sections.ts`: một bảng `SECTIONS` cho cả hai mode. Mỗi section có `key` không đổi theo mode, `tab` của từng mode, `legacy` của từng mode, `match` của từng mode và `when` (flag Asset Map).
- `projectMenu(mode)`, `resolveProjectTab(tab, mode)`, `projectSection(route, groups)` là public surface (`features/navigation/index.ts`).
- `shell/nav.ts` sinh `MOCK_PROJECT_NAV` và `REAL_PROJECT_NAV` từ module. `router/aliases.ts` re-export resolver; ba bảng alias đã xóa (A1: grep rỗng).
- Header dùng menu của mode đang chạy.
- Nhãn "Sessions" → "C2 Sessions" ở cả hai menu (D-01).

## File đã đổi (commit `b9d28f3c`, 10 file)

`features/navigation/{index.ts, project-sections.ts, project-sections.test.ts}`, `shell/{nav.ts, header.tsx, nav.test.ts, shell.test.tsx, project-nav.characterization.test.ts}`, `router/aliases.ts`, `app-routing.real.test.tsx`.

## Quyết định

- DL-05: tab id giữ nguyên theo từng mode (D-01 cấm đổi query parameter vì thẩm mỹ). Đổi id sẽ làm đổi URL demo và link đã lưu.
- D-01 nhãn: "C2 Sessions" (tránh nhầm với phiên đăng nhập). Giữ "Planning", "Team & Approvals", "Project Settings" như D-01 yêu cầu giữ.

## Kiểm thử

- Characterization (`project-nav.characterization.test.ts`, viết trước khi refactor): hàng menu, nhóm, match, mọi alias của hai mode, flag Asset Map bật/tắt, và quyền sở hữu route. Xanh trên mã cũ, xanh sau refactor (sau đổi nhãn thì cập nhật nhãn).
- Module test: không trùng tab id trong một mode; mọi tab canonical resolve về chính nó; nhãn chung giữa hai mode.
- Route smoke mock: 56/56 cả hai cấu hình cờ (trên HEAD `ffe85384`).

## Đã xác minh

- Typecheck, lint, boundary (không tăng), test nhóm navigation/shell/router/demo/projects.
- Ảnh sidebar dự án mock (`structural-execution/evidence` không có; ảnh tạm trong scratchpad): nhãn "C2 Sessions", "Planning" và các nhóm đúng.

## Chưa xác minh

- Route smoke real (cần stack): **NV**.
- Real mode sidebar trên trình duyệt: **NV**. Đã kiểm bằng test (`app-routing.real.test.tsx`, nav tests).

## Rủi ro hồi quy

- Nhãn đổi "Sessions" → "C2 Sessions": đã cập nhật mọi test tìm theo nhãn. Các chỗ khác trong mã là chip thông báo, nhóm tìm kiếm, hoặc tab UI nội bộ, không phải mục menu.
- Ask AI trong real mode đổi nhãn ngữ cảnh (ví dụ route `c2` từ "Infrastructure" thành "Sessions"). Đây là cải thiện có chủ đích.

## Còn tồn tại

- `MOCK_PROJECT_TABS` (`shell/nav.ts`) là danh sách id của demo, còn có `objectives` và `activity` không có mục menu. Giữ có chủ đích cho demo, ghi trong code.
- `GLOBAL_RESOURCE_PAGES` (`router/routes.ts`) là quy tắc khả dụng riêng, chưa đưa vào module (plan bước sau). Không phải bảng menu.
- Chưa đổi tên canonical id (không có lý do ngoài thẩm mỹ, theo D-01).
