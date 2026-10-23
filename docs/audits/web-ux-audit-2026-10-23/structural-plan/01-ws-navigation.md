# WS-1 · Chuẩn hóa navigation giữa mock và real

UX-ID: UX-06 (chính), UX-07 (một phần), UX-14 (thuật ngữ). Nguồn: `01-full-audit-report.md`, `02-feature-inventory.md`, `06-verification-gaps.md`.

## 1. Kiến trúc hiện tại

### 1.1 Bốn nơi cùng quyết định "một mục dự án có mặt ở mode nào"

| Nơi | Vai trò | Vị trí |
|---|---|---|
| Bảng mục mock | 14 mục, nhóm PROJECT / PREPARATION / OPERATIONS / RESULTS / MANAGEMENT | `shell/nav.ts`, `MOCK_PROJECT_NAV` (dòng 87–127) |
| Bảng mục real | 18 mục, cùng nhóm, thêm Fleet, Governance, Analysis, Project Settings | `shell/nav.ts`, `REAL_PROJECT_NAV` (dòng 134–177) |
| Alias tab | Ba bảng viết tay: `SHARED_TAB_ALIASES`, `MOCK_TAB_ALIASES`, `REAL_TAB_ALIASES` | `router/aliases.ts` |
| Tab hợp lệ khi render | `navTabs()` lấy từ bảng; `project-detail-page.tsx` chỉ render tab có trong bảng, còn lại rơi về `overview` | `features/projects/views/project-detail-page.tsx`, dòng 54 |

Hệ quả đo được:
- Cùng khái niệm, khác ID: "Sessions" là `sessions` ở mock và `c2` ở real; "Planning" là `plans` ở mock và `planning` ở real. Alias phải dịch hai chiều (`plans`→`planning` ở real, `planning`→`plans` ở mock).
- Khác tập mục: mock có `objectives`, `activity`, `ai-workspace` nhưng không có `fleet`, `governance`, `analysis`, `settings`; real ngược lại.
- Số mục: 14 và 18 đã đo DOM (Round 1 và Round 2).

### 1.2 Highlight dựa trên danh sách `match` viết tay

`match` trong mỗi mục (ví dụ Sessions: `['sessions', 'c2-session', 'c2-console', 'c2-channel']`) là danh sách route key và tab id trộn lẫn. Nó quyết định mục nào sáng khi người dùng đi sâu (operation → Operations, finding → Findings). Ví dụ đã quan sát: `#/c2` và `#/agents` đều hiển thị Infrastructure ở mock (Round 1, `B14`).

### 1.3 Điểm vào theo route key và theo tab

- Route key (`router/routes.ts`) có `real` surface: `shared`, `feature`, `component`, `system`, `unavailable`. Khả dụng của một màn hình ở real nằm ở đây.
- Tab (`?tab=`) là không gian thứ hai, chỉ cho route `project`.
- `GLOBAL_RESOURCE_PAGES` (`routes.ts`, dòng 125) quyết định màn hình nào hiện tài nguyên toàn cục khi không có project. Đây là một quy tắc thứ năm về khả dụng.

### 1.4 Điều chưa xác minh (phải kiểm trước khi triển khai)

- Notices và tác vụ (`features/notices`, `features/tasks`) mang `to: {name, id}` với tab id. Cần liệt kê các tab id này để biết alias nào đang được dùng từ bên ngoài.
- Demo (`src/demo/`) có tham chiếu tab id nội bộ (ví dụ `demo/project-detail/project-tabs.tsx`). Cần đếm trước khi đổi tên.
- `routes.json` (smoke) có địa chỉ `project/{project}?tab=...` nào không. Cần kiểm.

Ba mục này là bước 0 của kế hoạch, không phải giả định.

## 2. Kiến trúc đề xuất

### 2.1 Một module sâu

Đặt tại `features/navigation/project-sections.ts` (feature `navigation` đã tồn tại). Một bảng duy nhất:

```
SECTIONS = [
  { id: 'overview',    label: 'Overview',       group: 'PROJECT',     availability: { mock: true,  real: true  }, legacyIds: [],                    matches: ['overview', 'objectives'] },
  { id: 'scope',       label: 'Scope & ROE',    group: 'PREPARATION', availability: { mock: true,  real: true  }, legacyIds: ['roe'],               matches: ['scope', 'document'] },
  { id: 'planning',    label: 'Planning',       group: 'PREPARATION', availability: { mock: true,  real: true  }, legacyIds: ['plans', 'ai-plans'], matches: ['planning', 'ai-plan', 'ai-plan-review', 'ai-plan-compare'] },
  { id: 'sessions',    label: 'Sessions',       group: 'OPERATIONS',  availability: { mock: true,  real: true  }, legacyIds: ['c2'],                matches: ['sessions', 'c2', 'c2-session', 'c2-console', 'c2-channel'] },
  // … một dòng cho mỗi mục; availability false ghi lý do ở trường reason
]
```

Interface (ba hàm, không hơn):

| Hàm | Trả về | Ai gọi |
|---|---|---|
| `projectSections(mode)` | Các nhóm và mục có `availability[mode]` đúng, theo thứ tự | Sidebar, Overview tab bar |
| `resolveSection(tab, mode?)` | ID chính tắc hoặc `undefined` | `router/aliases.ts`, `project-detail-page.tsx` |
| `sectionFor(route, mode)` | Mục sở hữu của route (highlight) | `shell/nav.ts`, sidebar, nút Ask AI |

Độ sâu: người gọi chỉ biết ba hàm, nhưng phía sau là toàn bộ quy tắc khả dụng, alias và highlight. Deletion test: xóa module thì bốn nơi ở 1.1 đều phải tự quyết lại, tức là độ phức tạp quay về đúng chỗ đang có.

### 2.2 Seam

- Không thêm port hay adapter. Mode chỉ là tham số của một bảng dữ liệu, không phải hai hành vi cần thay thế nhau. Theo nguyên tắc "một adapter là seam giả định": đừng tạo `MockNav` và `RealNav`.
- Seam thật nằm ở `projectSections(mode)`: đầu vào là mode, đầu ra là danh sách đã lọc.

### 2.3 ID chính tắc

Đề xuất lấy ID của mock cho phần lớn mục vì mock đã dùng nhiều nhất trong URL demo: `overview`, `scope`, `assets`, `planning`, `sessions`, `findings`, `evidence`, `reports`, `team`, `audit`, `close`. Với real, các ID cũ (`plans`, `c2`, `roe`, `closure`, `members`, `approvals`, `audit-log`, `ai-plans`) thành `legacyIds`. Đây là lựa chọn kỹ thuật; nhãn hiển thị thuộc D-01.

Đề xuất đặt tên mục theo khái niệm miền (xem `05-terminology.md`): "Sessions" nghĩa là phiên C2 trong dự án (có thể đổi sau khi WS-3 quyết định). Tránh đưa "Session" trơ trọi vì trùng với phiên đăng nhập.

## 3. Thay đổi route và component

| File | Thay đổi | Ghi chú |
|---|---|---|
| `features/navigation/project-sections.ts` | Mới: bảng và ba hàm | Có test bảng |
| `router/aliases.ts` | Xóa ba bảng viết tay; `resolveProjectTab` gọi `resolveSection` | Giữ hàm `canonicalRoute` và hành vi thay một lần |
| `shell/nav.ts` | `MOCK_PROJECT_NAV`, `REAL_PROJECT_NAV`, `projectNavGroups`, `projectSection` đổi thành re-export của module | Giữ `NAV` (global) nguyên |
| `shell/sidebar.tsx` | Dùng `projectSections(mode)` | Không đổi cấu trúc DOM ngoài nội dung |
| `shell/header.tsx`, `shell/real-chrome.tsx` | Nút Ask AI dùng `sectionFor` | |
| `features/projects/views/project-detail-page.tsx` | `navTabs()` lấy từ module | Dòng 54 |
| `demo/project-detail/*` | Đổi tab id sang chính tắc hoặc giữ id mock và dùng alias | Chờ kết quả bước 0 |
| `router/routes.ts` | Không đổi key | WS-3 sẽ đổi các key `c2-*` |
| `tools/verify/routes.json` | Cập nhật địa chỉ có tab nếu có | Chờ kết quả bước 0 |

## 4. Phụ thuộc

- D-01 (nhãn và ID): bắt buộc trước khi đổi ID hiển thị.
- WS-2: mục "Team & Approvals" chỉ giữ thành viên sau khi quyết định được chuyển sang inbox. Có thể đổi nhãn trước, đổi nội dung sau.
- WS-3: mục "Sessions" và highlight Infrastructure phụ thuộc quyết định cấu trúc C2.

## 5. Tác động UX

- Cùng một danh mục khái niệm xuất hiện ở hai mode; khác biệt chỉ là mục không có ở mode nào, và lý do được ghi trong bảng.
- Người dùng đổi mode (hoặc nhận link từ đồng nghiệp ở mode khác) không gặp tên khác cho cùng một phần việc.
- Số mục vẫn khác giữa mock và real nếu tính theo availability. Đây là hành vi có chủ đích, không phải lỗi.

## 6. Rủi ro hồi quy

| Rủi ro | Giảm thiểu |
|---|---|
| Deep link từ thông báo, tác vụ, email bị hỏng | Liệt kê mọi `to.tab` và `?tab=` trước; alias giữ nguyên; test bảng cho từng ID đã từng xuất hiện |
| Highlight sai khi đi sâu (operation, finding, report, asset, session) | Test bảng: mỗi route trong `routes.json` có `sectionFor` mong đợi |
| Demo guides dùng tab id cũ | Đếm trước; đổi bằng alias, không đổi hàng loạt |
| Route smoke lệch | Chạy `route-smoke` mock và real (bộ kiểm tra của Round 2) |
| Hai nguồn khả dụng còn lại (`GLOBAL_RESOURCE_PAGES`, `routes.ts`) lệch bảng | Ghi nhận; đưa `GLOBAL_RESOURCE_PAGES` vào cùng module ở bước sau |

## 7. Tiêu chí nghiệm thu

1. Không còn bảng alias viết tay: `grep` cho `MOCK_TAB_ALIASES` và `REAL_TAB_ALIASES` trả về rỗng.
2. Mọi ID từng xuất hiện trong mã (danh sách kiểm kê ở bước 0) đều được `resolveSection` nhận ra.
3. Sidebar mock và real được sinh từ cùng bảng; số mục bằng số mục có `availability` đúng. Đo DOM: mock và real khớp với bảng.
4. Test characterization: trước khi đổi, ghi lại danh sách mục và highlight hiện có cho từng mode; sau khi đổi, khớp ngoại trừ các thay đổi ID đã duyệt.
5. Route smoke mock và real không có lỗi mới.
6. Không đổi API, quyền hay dữ liệu.

## 8. Trình tự triển khai (commit nhỏ)

0. Kiểm kê: liệt kê mọi tab id và route key được dùng trong mã, demo, thông báo, `routes.json` (không đổi gì).
1. Test characterization cho nav hiện tại của hai mode (không đổi mã sản phẩm).
2. Thêm module và bảng, tái tạo đúng đầu ra hiện tại (test so sánh).
3. Chuyển `aliases.ts` sang module (kết quả giống hệt, test alias chạy lại).
4. Chuyển `nav.ts` và sidebar.
5. Chuyển `project-detail-page.tsx` và Ask AI.
6. Đổi ID chính tắc (nếu D-01 duyệt), giữ alias cũ.
7. Xóa bảng cũ và tài liệu hóa thuật ngữ "project section" trong `05-terminology.md`.
