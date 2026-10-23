# 04 · Implementation Roadmap

Ba giai đoạn. Mỗi mục ghi UX-ID, độ phức tạp (S ≤ 1 ngày, M vài ngày, L > 1 tuần hoặc cần contract) và điều kiện trước khi làm.

## Giai đoạn 1 · Quick Wins (1–2 tuần, đa số S)

Tiêu chí: thay đổi nhỏ, không đổi API, business logic, permission model hay safety control; kiểm được bằng typecheck, test, build và Playwright.

| # | Việc | UX-ID | Độ phức tạp | Trạng thái (cập nhật trong `QUICK-WINS-IMPLEMENTATION-REPORT.md`) |
|---|---|---|---|---|
| 1 | Gate demo chrome theo mode: switcher, Demo Tools, Settings header và note | UX-01, UX-03 | S | Xem báo cáo |
| 2 | Thay copy "hidden in production" bằng copy đúng theo mode | UX-02 | S | Xem báo cáo |
| 3 | Outage real: copy người dùng; lệnh dev và nút chuyển demo chỉ ở dev | UX-04 | S | Xem báo cáo |
| 4 | Trang prototype/QA: gate bằng cờ build | UX-05 | S–M | Xem báo cáo |
| 5 | Sidebar dự án: dải mờ báo còn nội dung cuộn | UX-07 | S | Xem báo cáo |
| 6 | Copy: số ít/số nhiều; "Library" → "Capabilities"; bỏ "binding state" | UX-12, UX-14 | S | Xem báo cáo |
| 7 | Projects: "Not recorded" thay "—"; KPI Metadata không hiển thị 0 giả; note Active khớp tập trạng thái | UX-13, UX-26 | S | Xem báo cáo |
| 8 | Contrast: chỉnh hai token; test validation cho các cặp | UX-19 | S | Xem báo cáo |
| 9 | Cập nhật checklist owner theo kết quả đã xác minh | — | S (tài liệu) | Xem báo cáo |

**Điều kiện chung**: typecheck, lint (không thêm lỗi mới so với baseline), build production, targeted tests, check boundaries, Playwright before/after ở desktop, tablet và mobile.

## Giai đoạn 2 · Structural Improvements (2–6 tuần)

| # | Việc | UX-ID | Độ phức tạp | Điều kiện |
|---|---|---|---|---|
| S1 | Một từ vựng và một cây điều hướng cho cả hai mode | UX-06, UX-08, UX-11 | M | Quyết định sản phẩm về nhãn chuẩn; checklist D-01, X-01, X-07 |
| S2 | Một inbox quyết định; hợp nhất approvals và chuông thông báo | UX-08 | M | Quyết định vị trí trong sidebar |
| S3 | Một component list Findings dùng chung | UX-10 | M | Không đổi contract findings |
| S4 | Overview: định nghĩa và nguồn cho từng KPI; aggregate Running operations; trạng thái chưa có nguồn; giảm mật độ | UX-12, UX-16 | M–L | Contract read-only mới cần trace theo quy trình repo (UI → contracts → server → runtime); ADR nếu có contract mới |
| S5 | Quyết định Ask AI và Plans/Planning | UX-09 | M | Quyết định sản phẩm |
| S6 | Bảng Projects và trạng thái theo lời hứa đầy đủ (cột thật từ source) | UX-13 | M | Có source cho target và metadata |
| S7 | Đăng nhập mock: nguyên nhân và phản hồi | UX-23 | S–M | Tái hiện được nguyên nhân |
| S8 | Mục "Switch to demo mode" trong menu tài khoản real | UX-04 | S | Quyết định sản phẩm |

## Giai đoạn 3 · Long-term Optimization

| # | Việc | UX-ID | Độ phức tạp |
|---|---|---|---|
| L1 | Một quy tắc accent và primary được ghi trong design; gate contrast trong CI | UX-19, UX-20 | S–M |
| L2 | Gộp primitive KPI/Chip/Pill vào `ui/` | UX-21 | M |
| L3 | Tách code demo khỏi production bundle (không chỉ gate route); chia chunk; bỏ import trùng | UX-22, UX-05 | M |
| L4 | Kiểm tự động trạng thái empty, denied, conflict và outage cho mọi trang | checklist X-02 | M–L |
| L5 | Accessibility: pass keyboard và screen reader; focus visible; đường đóng drawer; hit target | UX-25 | M |
| L6 | Đưa phạm vi Settings (áp dụng cho mọi project) vào consumer kiểm chứng | UX-27 | M |
| L7 | Làm rõ mục đích các feature chưa có mô tả (documents, navigation, trace, wizard, workers) | §3 feature inventory | S |
| L8 | Real mode: kiểm trong trình duyệt với backend thật (xem 06) | Toàn bộ mục real | L |
