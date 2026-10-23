# 01 · Full Audit Report — Raptix Web (`apps/web`)

Ngày: 2026-10-23 · Nhánh: `frontend` · Snapshot source trước mọi thay đổi Quick Win.
Ghi chú đọc: xem [README](README.md) để biết nhãn `[B]`, `[C]`, `[NV]`, cách ưu tiên P0–P3 và độ phức tạp S/M/L.

## Đính chính (giai đoạn 2, cùng ngày)

Khi triển khai Quick Win, kiểm tra lại source phát hiện hai điểm sai trong bản audit gốc. Các mục bên dưới đã được sửa theo đính chính này.

1. **Header demo không xuất hiện trong real mode.** `shell/shell.tsx:168` chỉ mount `Topbar` (`shell/header.tsx`) khi không ở real mode. Real mode dùng `RealTopbar` trong `shell/real-chrome.tsx`, và comment đầu file ghi rõ không render "demo surfaces, persona switcher, global search…". Vì vậy workspace switcher giả và khối Demo Tools chỉ là **mock-only**. UX-01 và UX-03 được điều chỉnh tương ứng; chỉ phần Settings (trang dùng chung) là rò demo sang real.
2. **Lối thoát "Switch to demo mode" trong menu tài khoản real** (`shell/real-chrome.tsx:55`) là một mục có chủ đích, khác với nút trong màn hình lỗi. Vẫn giữ là quyết định mở (UX-04).

Các phát hiện khác không đổi. Chi tiết việc đã làm và việc còn lại: `QUICK-WINS-IMPLEMENTATION-REPORT.md` cùng thư mục.

## Tóm tắt điều hành

- Không có P0 đã xác minh.
- Ưu tiên cao nhất là **ranh giới demo/real** (UX-01 → UX-04, UX-26, UX-27): demo chrome, copy "hidden in production" không có cơ chế, lối thoát sang demo trong trạng thái lỗi, và một KPI hiển thị số 0 khi nguồn không ghi nhận dữ liệu.
- Mock mode điều hướng và hiển thị ổn định trên desktop, tablet và mobile (không tràn ngang, không button thiếu tên, không input thiếu nhãn trên các trang đã đo).
- Real mode **chưa kiểm chứng trong trình duyệt** vì không có backend. Mọi kết luận về real chỉ dựa trên source (`[C]`) hoặc trạng thái outage (`[B]`).

## Bảng tổng hợp

| ID | Tiêu đề ngắn | Ưu tiên | Độ phức tạp | Nhãn | Quick Win? |
|---|---|---|---|---|---|
| UX-01 | Settings (trang dùng chung) hiển thị chuỗi demo ở real; switcher và Demo Tools chỉ ở mock (đính chính) | P1 | S–M | C + B | Có |
| UX-02 | Copy "hidden in production" không có cơ chế | P1 | S | B (build) + C | Có |
| UX-03 | Demo controls (persona, Reset demo, outcome) chỉ tồn tại ở mock; không phải lỗi real (đính chính) | P3 | — | C | Không |
| UX-04 | Outage real lộ lệnh dev và lối thoát sang demo | P1 | S | B (build, không backend) | Có |
| UX-05 | Trang prototype/QA có trong bản build | P2 | S–M | B | Có (phần an toàn) |
| UX-06 | Hai mô hình sidebar dự án, số mục và ID khác nhau | P2 | M | C + B | Không (structural) |
| UX-07 | Sidebar dự án cuộn nhưng không có dấu hiệu | P2 | S | B | Có |
| UX-08 | Tasks & Approvals là đích của 4 CTA nhưng không có mục sidebar; ba tên | P2 | S (nav) / M | C + B | Không (structural) |
| UX-09 | Trùng bề mặt AI (Ask AI / AI Workspace) và kế hoạch (plans / planning) | P2 | M | C | Không (cần quyết định) |
| UX-10 | Cùng danh sách findings, ba bố cục | P2 | S | B | Không (structural) |
| UX-11 | C2 ở ba nơi, alias `c2` → Infrastructure | P2 | S | B + C | Không (structural) |
| UX-12 | Overview toàn cục mâu thuẫn với dự án; thiếu 2/6 KPI; jargon | P2 | M | B + C + checklist | Một phần (copy) |
| UX-13 | Cột thiếu dữ liệu hiển thị "—"; chip và KPI "Active" lệch | P2 | S | B + C | Có |
| UX-14 | Copy và thuật ngữ (số ít/số nhiều, "Library", "binding state") | P3 | S | B + C | Có |
| UX-15 | ID đỏ thương hiệu, badge không nhãn, tên project lặp | P3 | S | B | Không |
| UX-16 | Mật độ cao ở Overview và Project Overview | P2 | S–M | B | Không (structural) |
| UX-17 | Thanh severity đơn sắc; đếm lặp giữa tab và KPI | P3 | S | B | Không |
| UX-18 | Nhãn "Findings" và dòng chú thích chồng nhau | P3 | S | B | Không |
| UX-19 | Contrast: dark primary text 3.43:1; light neutral trên hover 4.39:1 | P2 | S | C (tính toán) | Có |
| UX-20 | Hai hệ accent không có quy tắc được ghi trong design | P3 | S | C | Không |
| UX-21 | Năm file tự định nghĩa primitive KPI/Chip/Pill | P3 | M | C | Không |
| UX-22 | Build: chunk > 500 kB; import tĩnh/động trùng; demo code trong bundle | P3 | S | B (build output) | Một phần (cùng UX-05) |
| UX-23 | Đăng nhập mock: Continue không phản hồi | P2 | S | B (một cấu hình) | Không (chưa xác định nguyên nhân) |
| UX-24 | Emergency Stop: giữ nguyên; luồng xác nhận thật chưa kiểm | — (giữ) | — | B + NV | Không |
| UX-25 | Mobile drawer: đường đóng chưa rõ; hit target nhỏ | P3 | S | B + NV | Không |
| UX-26 | **Mới:** KPI "Metadata to review" hiển thị 0 khi nguồn không ghi nhận metadata | P2 | S | B + C | Có |
| UX-27 | **Mới:** Settings cam kết "áp dụng cho mọi project" cần đối chiếu consumer | P3 | — | C + checklist 3.2 | Không (ghi nhận) |

---

## UX-01 · Demo chrome không gắn theo mode · P1 · S–M · [C] + [B] (mock) — đính chính: phạm vi thu hẹp

**Đính chính:** bản gốc ghi header "rendered in both modes". Sai: `Topbar` chỉ mount ở mock (`shell/shell.tsx:168`). Phần dưới mô tả header ở mock; phần rò sang real là Settings (mục "Hiện trạng", dòng về `settings-page.tsx`).

**Vị trí**
- `apps/web/src/shell/header.tsx:37–54` — `WorkspaceSwitcher`: tên cứng "Raptix Workspace — Test Lab", mục disabled "Production Workspace — No access", ghi chú "Simulated: only one workspace is available in this prototype".
- `apps/web/src/shell/header.tsx:171–196` — `ProfileMenu` → khối "Demo Tools" (persona, Emergency Stop outcome, Reset demo, Prototype Home).
- `apps/web/src/features/settings/views/settings-page.tsx:80–84` — `PageHeader` có sub "Acme Security (Demo) · Raptix Workspace — Test Lab. This is a simulation: the backend enforces every control." và note có ID cứng "RT-2026-014 and RT-2026-017".

**Hiện trạng**
- Các chuỗi trên render không điều kiện. `header.tsx` không import `isRealMode` hay `DATA_MODE`.
- Route `settings` là `shared` (`router/routes.ts:86`): cùng một presentation cho cả hai mode. Chỉ phần body có gate theo mode (`settings-page.tsx:61–62`), phần header và note thì không.
- Mâu thuẫn tên tổ chức trong real: `shell/organization.ts:7` trả về "Local workspace", trong khi switcher nói "Raptix Workspace — Test Lab" và Settings nói "Acme Security (Demo)".

**Bằng chứng**
- Mock: Demo Tools và switcher hiển thị (B06, B01).
- Real: không chụp được (cần backend). Kết luận dựa trên code `[C]`.

**Tác động**: người dùng real thấy dữ liệu demo trên trang cấu hình bảo mật; không biết thay đổi có thực sự áp dụng hay không.

**Giải pháp đề xuất**: nhãn tổ chức lấy từ một nguồn theo mode; xóa chuỗi cứng; Demo Tools và switcher demo chỉ render khi `!isRealMode()`.

---

## UX-02 · Copy "hidden in production" không có cơ chế · P1 · S · [B] (build production) + [C]

**Vị trí**
- `apps/web/src/shell/header.tsx` (khối Demo Tools): "Prototype only, hidden in production."
- `apps/web/src/demo/login-page.tsx`: "Demo accounts and the role picker are hidden in production."

**Hiện trạng**
- Grep trong `shell/`, `features/`, `demo/`: không có `import.meta.env.PROD`, `DEV` hay `MODE` nào.
- Build production (`vite build`, bản scratch) vẫn hiển thị persona picker và Demo Tools khi chạy ở chế độ mock (mặc định).

**Tác động**: một lời khẳng định về phạm vi bảo mật không đúng với code. Người đọc có thể tin demo không có trong bản triển khai.

**Giải pháp**: sửa copy thành điều đúng theo mode ("Demo mode only…"); không dùng "hidden in production" trừ khi có gate thật.

**Ghi chú phân biệt**: build production ≠ real mode. Mode chọn theo `?dataMode=` > `localStorage raptix.dataMode` > `VITE_DATA_MODE` > `mock` (`state/mode.ts`). Một build production có thể chạy mock.

---

## UX-03 · (Đính chính) Demo controls chỉ ở mock · P3 · — · [C]

**Đính chính:** các điều khiển dưới đây không được render ở real mode (xem đính chính đầu tài liệu). Mục giữ lại như ghi nhận về hành vi mock; không còn là P1 real.

- **Persona switch vô hiệu**: `useMe()` (`state/console.ts:74–81`) đọc session khi real, nên `setMe` (`authStore`) không đổi người dùng. Dấu check luôn ở người thật.
- **Reset demo lỗi**: `resetDemo` (`demo/runtime.ts:278`) gọi `demand()` (`:68`) và ném "The demo runtime is not initialized". `state/services.tsx` chỉ khởi tạo demo runtime ngoài real mode (`:15, :24, :42`).
- **"Next Emergency Stop ends with: Acknowledged / Failed / Unknown"**: trong real có tên giống kết quả thật nhưng không có tác dụng. Chỉ `demo/runtime.ts:129` đọc giá trị này.

**Tác động**: điều khiển có tên như thao tác thật nhưng không làm gì, hoặc ném lỗi. Trên một control an toàn (Emergency Stop) đây là rủi ro nhận thức.

**Giải pháp**: loại toàn bộ khối Demo Tools khỏi real (cùng UX-01). Không để nút không có tác dụng.

**Xác minh real**: `[NV]` trong trình duyệt (không có backend để đăng nhập real).

---

## UX-04 · Outage real lộ lệnh dev và lối thoát sang demo · P1 · S · [B] (build production, không backend)

**Vị trí**
- `apps/web/src/shell/real-bootstrap.tsx:36–41` — `BootError`: "Cannot reach the Raptix API", "Real mode shows no demo data. Start the API (npm run dev:api) or switch to demo mode.", nút "Switch to demo mode".
- `apps/web/src/shell/not-integrated.tsx:29` — "Switch to demo mode" trên các panel "Not connected in real mode".
- `apps/web/src/platform/transport.ts:70` — "The API returned a non-JSON response." (chuỗi kỹ thuật).
- `apps/web/src/shell/real-chrome.tsx:55` — mục "Switch to demo mode" trong menu tài khoản real (có chủ đích, xem mục quyết định).

**Bằng chứng**: `B10-real-mode-no-backend-outage-before.png` — hiển thị đúng các chuỗi trên.

**Tác động**: người dùng cuối thấy lệnh dev. Ở trạng thái sự cố, "Switch to demo mode" đưa người dùng sang dữ liệu tổng hợp trông như hoạt động bình thường.

**Giải pháp**
- Chuỗi người dùng cho production; lệnh dev và nút chuyển demo chỉ hiện khi `import.meta.env.DEV`.
- Giữ "Retry" và câu "Real mode shows no demo data."
- Không thay chuỗi trong `platform/transport.ts` (ranh giới platform); chỉ thay cách hiển thị.

**Quyết định mở**: mục "Switch to demo mode" trong menu tài khoản real là chủ đích sản phẩm (có copy cảnh báo "Demo mode shows simulated data"). Không tự gỡ; cần chủ sản phẩm.

---

## UX-05 · Trang prototype/QA có trong bản build · P2 · S–M · [B]

**Vị trí**: `router/routes.ts:48, 102, 103` (`states`, `scenarios`, `workspaces`); `shell/header.tsx:195` ("Prototype Home"); nội dung ở `demo/pages.tsx`.

**Bằng chứng**
- `#/scenarios` render "Prototype Home" (`B12`).
- `#/states` render "Universal state set" (`B13`). Nội dung source có các trạng thái "Not click-tested", "Prototype-simulated", "25 acceptance criteria for the V3.1 upgrade. Nothing here is signed off."

**Tác động**: nội dung QA nội bộ hiển thị với người dùng cuối nếu bản build được triển khai.

**Giới hạn**: route được đăng ký theo key; code của `demo/pages` vẫn nằm trong bundle nếu import động vẫn còn trong registry (xem UX-22).

**Giải pháp**: đăng ký ba route này chỉ khi build cho phép (cờ build `VITE_PROTOTYPE_PAGES`, mặc định tắt, hoặc dev). Không xóa code trong quick win.

---

## UX-06 · Hai mô hình sidebar dự án, số mục và ID khác nhau · P2 · M · [C] + [B]

- Mock: 14 mục (đếm trong DOM, `B02`). Real: 18 mục (đếm theo `shell/nav.ts:134–177`, chưa đếm trong DOM).
- Cùng khái niệm khác ID: "Sessions" là `sessions` (mock) và `c2` (real); "Planning" là `plans` (mock) và `planning` (real).
- Checklist §2.2 ghi 13/17. Trong §2.2 cũng ghi "Assets chưa có mục sidebar dự án riêng", điều này sai: `nav.ts:96` (mock) và `:143` (real) đều có "Assets".

**Giải pháp**: một từ vựng, một cây điều hướng; mode chỉ khác dữ liệu. (Structural.)

---

## UX-07 · Sidebar dự án cuộn nhưng không có dấu hiệu · P2 · S · [B]

- `apps/web/src/shell/sidebar.tsx:50` — `<nav className="no-scrollbar flex-1 overflow-y-auto …">`: thanh cuộn bị ẩn.
- Ở 1440×900, nhóm MANAGEMENT (Team & Approvals, Vault, Closeout) nằm dưới nút Collapse. DOM xác nhận các mục vẫn có trong vùng cuộn (`B02`).

**Giải pháp**: hiện dải mờ phía dưới khi còn nội dung cuộn xuống. Không đổi cấu trúc nhóm.

---

## UX-08 · Tasks & Approvals là đích của 4 CTA nhưng không có mục sidebar · P2 · S (nav) / M · [C] + [B]

- Route `tasks` (h1 "Tasks & Approval Inbox") không có trong `NAV` (`nav.ts:27–45`). Đích của: "Open decision queue" (`features/overview/views/overview-blocks.tsx:102`), "Open full task inbox" (`:371`), KPI "Awaiting decisions" (`overview-page.tsx:68`), và "Open in Tasks & Approvals" (`demo/project-detail/project-tabs.tsx:72`, mock-only).
- Approval có ở ba feature: `approvals`, `team` (export `ApprovalInbox`), `tasks`.
- Ba tên: "Tasks & Approval Inbox", "Team & Approvals", "Approvals".

**Giải pháp**: một inbox quyết định có tên thống nhất; mở từ Overview và từ một mục sidebar. (Structural — cần quyết định về mục sidebar.)

---

## UX-09 · Trùng bề mặt AI và kế hoạch · P2 · M · [C]

- Hai bề mặt chat: Ask AI drawer (`features/copilot`, bật từ header khi có project: `header.tsx:246`) và AI Workspace (`features/aichat`).
- Hai bề mặt kế hoạch: `features/plans` (cầu nối plan→operation) và `features/planning` (trạng thái chuẩn bị).

**Giải pháp**: quyết định sản phẩm. Ask AI nên mở đúng conversation trong AI Workspace, hoặc bỏ nếu không có ngữ cảnh riêng. (Structural.)

---

## UX-10 · Cùng danh sách findings, ba bố cục · P2 · S · [B]

- Tab Findings của project: bảng, dòng "2 findings in RT-2026-014", không KPI (`B04`).
- `#/findings` trong cùng project: KPI, thanh severity, tab, bộ lọc, card (`B04`).
- Global `#/findings` (All Projects): danh sách xuyên dự án, bộ lọc project (`B05`).

**Giải pháp**: một component list với prop `scope`. (Structural.)

---

## UX-11 · C2 ở ba nơi, alias `c2` → Infrastructure · P2 · S · [B] + [C]

- Global "Infrastructure" chứa C2 (`nav.ts:41`). Project có "Sessions" (`nav.ts:107, 153`). Route `c2` mang tên "C2 access and console" (`routes.ts:97`).
- `#/c2` và `#/agents` chuyển sang Infrastructure (`B14`).

**Giải pháp**: đặt tên một lần; ghi rõ "Sessions = phiên C2 trong dự án". (Structural.)

---

## UX-12 · Overview toàn cục mâu thuẫn với dự án · P2 · M · [B] + [C] + checklist G-01

- Overview: "Active operations — Not recorded — Running binding state" (`overview-page.tsx:64–65`). Project RT-2026-014: "Running Operations 1" (`B02`). Cùng một môi trường mock.
- Overview có 4 KPI (`B01`): Active projects, Active operations, Awaiting decisions, Open curated findings. Checklist G-01 yêu cầu 6 (thiếu connected agents, active sessions).
- Donut "3 Curated findings" và KPI "Open curated findings 2" có định nghĩa không hiển thị trên màn hình. Thang trọng số rủi ro được giải thích trong dòng nhỏ.
- Jargon: "Running binding state", và "The operation binding state is not recorded for this source." (`overview-blocks.tsx:299`).

**Giải pháp**
- Mỗi KPI có định nghĩa, nguồn và trạng thái (0 thật / không đọc được / chưa có nguồn).
- Aggregate read-only "Running operations" có lý do rõ (dự án đã có dữ liệu này và đã có CTA "Open running operation"). Đây là bổ sung duy nhất được đề xuất.
- Phần thiếu 2 KPI là structural.

---

## UX-13 · Cột thiếu dữ liệu hiển thị "—"; chip và KPI "Active" lệch · P2 · S · [B] + [C]

- Projects (`features/projects/views/portfolio-page.tsx`): cột TARGET và METADATA hiển thị "—" ở cả 6 hàng (`B07`), từ component `Unrecorded` (`:40–42`) và cell metadata (`:147–149`).
- Subtitle (`:161`) nói: "A column the connected source does not record shows as unavailable rather than a placeholder value." Hành vi hiện tại dùng đúng placeholder mà subtitle nói là không dùng.
- Chip "active 2" (lọc theo status `active`) và KPI "Active 3" với note "Planning or running" (`:153, :174`). Tập `ACTIVE_STATUSES` (`:16`) = `{active, approved, planning, running}`. Với dữ liệu mock, `approved` (1) được tính vào KPI nhưng note không nói như vậy.

**Giải pháp**: hiển thị "Not recorded" (quy ước của app, kèm lý do ở tooltip) thay "—"; sửa subtitle cho khớp; note KPI được tạo từ chính tập trạng thái.

---

## UX-14 · Copy và thuật ngữ · P3 · S · [B] + [C]

- "1 decision await your review." (`overview-blocks.tsx:100`): sai số ít/số nhiều.
- "5/6 ready. Can reach 100% before anything runs." (`demo/project-detail/project-page.tsx:272`): mơ hồ. (Mock-only.)
- "Library proposals" (`capabilities-pages.tsx:277`) và "The library could not be read." (`:25`), trong khi nav và title là "Capabilities".
- Tên agent "Raptix" trùng tên sản phẩm (AI Workspace). Không sửa trong quick win (dữ liệu demo và định danh agent).

**Giải pháp**: áp dụng thuật ngữ đã có trong `GLOSSARY.md`.

---

## UX-15 · Nhận diện và trùng lặp · P3 · S · [B]

- ID dự án trong bảng Projects màu đỏ thương hiệu, cùng màu với danger và Emergency Stop.
- Badge "1" trên Infrastructure không có nhãn.
- Tên project lặp 3–4 lần: switcher trên header, khối đầu sidebar, breadcrumb, H1.

---

## UX-16 · Mật độ cao ở Overview và Project Overview · P2 · S–M · [B]

- Overview toàn cục: 4 KPI, donut, rủi ro, 5 ô trạng thái, và nhiều khối (`B01`).
- Project Overview: readiness, completion, eligibility, schedule, suggested actions, activity (`B02`). Không có thứ tự ưu tiên rõ ngoài banner.

**Giải pháp**: đưa "Cần xử lý" lên đầu, progressive disclosure, chuyển phân tích severity sang Findings. (Structural.)

---

## UX-17 · Thanh severity đơn sắc; đếm lặp · P3 · S · [B]

- Thanh severity trên Findings (`B05`, `B04`) tô một màu đỏ cho toàn bộ chiều rộng, không phân đoạn theo severity.
- Số đếm xuất hiện cả trong tab và trong KPI.

---

## UX-18 · Nhãn "Findings" và chú thích chồng nhau · P3 · S · [B]

- Project Completion (`B02`): nhãn "Findings" và dòng "1 confirmed · 0 in review · 1 AI-suggested (unverified)" bị xuống dòng và sát nhau.

---

## UX-19 · Contrast · P2 · S · [C] (tính toán từ token) + [B] cho một phần

Tỉ lệ WCAG tính từ `apps/web/src/index.css`:

| Cặp | Tỉ lệ | Kết luận |
|---|---|---|
| Light: chữ trắng trên primary `#0066FF` | 4.83 | Đạt AA |
| Light: chữ trắng trên danger `#C62828` | 5.62 | Đạt AA |
| Light: neutral `#6B7280` trên panel `#FFFFFF` | 4.83 | Đạt AA |
| Light: neutral `#6B7280` trên hover `#F3F4F6` | 4.39 | **Dưới 4.5 cho chữ thường** |
| Dark: chữ trắng trên primary `#2563EB` | 5.17 | Đạt AA |
| Dark: chữ trắng trên danger `#B91C1C` | 6.47 | Đạt AA |
| Dark: primary `#2563EB` làm chữ trên panel `#111827` | 3.43 | **Không đạt khi dùng làm chữ/link** |

- `text-primary` được dùng làm chữ ở nhiều nơi (13 vị trí): ví dụ `overview-page.tsx:79` (link), `overview-blocks.tsx:37` (trạng thái "Confirmed"), `project-overview.tsx:610`. Vì vậy cặp 3.43 là vấn đề thật.
- Checklist X-03 nêu `#E5484D` và `#F87171` (chữ trắng trên fill). Các giá trị đó không còn trong token hiện tại. `#F87171` hiện là `--c-bad` dùng làm chữ, đạt 6.41 trên panel dark.
- Có sẵn `apps/web/tools/verify/contrast.mjs` (helper cho token audit) nhưng không có test nào khóa các cặp token theo mode.

**Giải pháp**
- Điều chỉnh `--c-primary` dark để vừa đạt 4.5 làm chữ trên panel vừa đạt 4.5 chữ trắng trên fill (cùng một token, không phải đổi 13 chỗ dùng).
- Điều chỉnh `--c-neutral` light đủ đậm để đạt 4.5 trên hover.
- Thêm test validation cho các cặp này.

---

## UX-20 · Hai hệ accent không có quy tắc được ghi trong design · P3 · S · [C]

- `--c-accent` (đỏ thương hiệu) và `--c-primary` (xanh) cùng tồn tại. Quy tắc chỉ nằm trong comment token (`index.css:17–19`).
- CTA chính màu xanh; ID, nhận diện và Emergency Stop màu đỏ.

---

## UX-21 · Primitive KPI/Chip/Pill trùng lặp · P3 · M · [C]

- Năm file tự định nghĩa một trong `StatCard`, `Kpi`, `Chip`, `Pill`: `features/aichat/common.tsx`, `features/analysis/views/analysis-page.tsx`, `features/findings/all-findings.tsx`, `features/projects/views/project-overview.tsx`, `ui/data.tsx`.

---

## UX-22 · Build: chunk lớn, import trùng, demo code trong bundle · P3 · S · [B]

- Build có cảnh báo "Some chunks are larger than 500 kB".
- Cảnh báo "dynamically imported but also statically imported": `shell/real-login.tsx` (từ `routes.ts`, và từ `real-bootstrap.tsx`), `features/notices/service.ts` (từ `demo/services.ts`, và từ `header-notices.tsx`, `header.tsx`).
- Code demo nằm trong bundle production (liên quan UX-05).

---

## UX-23 · Đăng nhập mock: "Continue" không phản hồi · P2 · S · [B] (một cấu hình, hai lần thử)

- Trên `#/` mock, điền sẵn email và mật khẩu rồi bấm "Continue": không chuyển trang, không thông báo lỗi (`login-probe2`). Chỉ các chip persona đăng nhập được.
- Nguyên nhân chưa xác định. Real mode `[NV]`.

---

## UX-24 · Emergency Stop · GIỮ NGUYÊN · [B] + [NV]

- Nút Emergency Stop ở header luôn hiển thị khi có project (`context-ribbon.tsx:96–113`), màu đỏ, cạnh "Ask AI".
- Dialog `EmergencyStop` (`shell/context-ribbon.tsx:23`) có: chọn phạm vi, impact, lý do bắt buộc, checkbox xác nhận, Cancel và "Stop now". Escape đóng được (`B11`).
- Dòng "Prototype only. This simulates a stop request; no real system is affected." nằm trong `EmergencyStopDialog` (`features/estop/ui.tsx:124`), là component khác. Chỉ `operation-console` (mock-side) import component này. Kết luận: không lộ sang real (đã kiểm tra import graph).
- Chưa thực thi luồng xác nhận (không chạy, theo nguyên tắc an toàn).

**Hành động**: giữ vị trí và hành vi. Kiểm luồng thật ở real `[NV]`.

---

## UX-25 · Mobile drawer và hit target · P3 · S · [B] + [NV]

- Mobile 390 px: drawer hiển thị đủ 7 mục global (`B08`).
- Ảnh không cho thấy nút đóng rõ ràng. Đường đóng bằng overlay chưa kiểm.
- Mỗi trang mobile đo có 1–5 nút dưới 32 px. Không có nút dưới 24 px trong các trang đã đo.

---

## UX-26 · KPI "Metadata to review" hiển thị 0 khi nguồn không ghi nhận metadata · P2 · S · [B] + [C] · *phát hiện mới*

- `portfolio-page.tsx:153–176`: `reviewCount = items.filter((p) => p.metadataVerified === false).length`. Với dữ liệu mock, `metadataVerified` là `null` ở cả 6 dự án (cell hiển thị "—").
- Kết quả: KPI hiển thị **0** trong khi không có dữ liệu nào. Đây là số 0 giả.
- Nguyên tắc của chính app (`features/overview/views/overview-blocks.tsx:5`: "a count the source does not record shows as not recorded; neither is shown as zero") và của checklist X-02: không fake zero.

**Giải pháp**: nếu không có dự án nào có `metadataVerified` xác định, KPI hiển thị "Not recorded".

## UX-27 · Settings cam kết áp dụng cho mọi project · P3 · [C] + checklist 3.2 · *ghi nhận*

- `settings-page.tsx` (note): "Changes here apply to every project in this workspace… and to running operations and sessions."
- Chưa kiểm consumer cho từng phạm vi. Checklist §3.2 đã yêu cầu xác nhận. Không đổi trong quick win; ghi nhận cho owner.

---

## Điểm giữ nguyên (đã quan sát)

- Trạng thái trung thực: "Not recorded" ở Overview, thông báo outage real "Real mode shows no demo data", KPI Findings chỉ đếm bản đã verify, AI suggestion "not counted until verified", "Project tool approval · instance not attributed".
- Vòng đời tool call trong AI Workspace (Proposed → Policy → Approval → Execution) và bộ đếm "Needs you (2)" (`B03`).
- Responsive: không tràn ngang ở 390, 834 và 1440 px trên các trang đã đo.
- Tự động kiểm tên truy cập được: không có button không tên và input không nhãn trên 12 trang mobile (chỉ là kiểm tự động).
- Dark mode đọc được (`B06`).
- Real Settings đã giới hạn tab về 5 (`REAL_TABS`, `settings-page.tsx:57`).
