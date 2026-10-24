# WS-4 · Overview: measures và bố cục (Trạng thái: VERIFIED cho mock; real NV)

UX-ID: UX-12, UX-16 (một phần). UX-26 (ghi chú Active khớp tập trạng thái) đã xử lý trong measures.

## WS-4A · Measures (commit `349bcbc5`)

### Trước

- Định nghĩa rải trong JSX (`overview-page.tsx`): `kpiDisplay` và `ACTIVE_PROJECT_STATUSES` nằm ở view.
- "Awaiting decisions" đếm cả `active-stop`.
- "Active projects" có caption "Planning or running" nhưng đếm bốn trạng thái.

### Sau

- `features/overview/measures.ts`: bốn measure với `id`, `label`, `definition` (caption), `state`, `value`, `limited`, `target`.
- Trạng thái: `value`, `zero` (chỉ khi nguồn xác nhận 0), `not-recorded` (không có số đếm), `unavailable` (đọc lỗi), `pending` (đang tải).
- Hiển thị: `Pending`, `Unavailable`, `Not recorded`, số hoặc số có dấu `+` khi giới hạn.
- Định nghĩa là nguồn duy nhất cho số, caption và điểm đến.

### Quyết định

- D-04: 4 measure và vùng Attention, không 6 KPI.
- DL-06: giữ tập đếm "Active projects" (approved, planning, active, running). Contract thật chỉ có planning và running; ghi chú nguồn trong code.

### Chưa làm (WS-4A)

- Provenance `asOf` theo nguồn: không có nguồn thời điểm đáng tin cho từng số. Trang chỉ có "Read at" (thời điểm đọc trình duyệt). Không tự tạo timestamp (quy tắc của prompt). Ghi vào OPEN-ISSUES.

## WS-4B · Bố cục (commit `837e1d9d`, ảnh `304df2e8`)

### Trước

- Một banner một dòng (chỉ hiện stop, hoặc decision khi không có stop).
- Bốn KPI; khối mức độ ở đầu; hàng đợi vận hành và decision ở dưới.

### Sau

1. Vùng "Needs attention" (`AttentionRegion`): stop, decision (có `+` khi giới hạn), các measure không đọc được (kèm câu "không phải số 0"). Khi không có gì cần xử lý và mọi đọc đã xong: "Nothing needs your attention right now."
2. Bốn measure.
3. Decision queue và Operations queue ngang hàng.
4. Projects: năm dòng đầu theo thứ tự nguồn trả về. Không gọi là "mới nhất".
5. Severity distribution (phân tích chi tiết findings), đưa xuống cuối với caption trỏ tới trang Findings.

Năm khối top-level (trong giới hạn sáu của plan).

### Kiểm tra

- Playwright, build mock production trong scratchpad: 1440 (sáng, tối), 834 (sáng), 390 (sáng). Không tràn ngang (0 px), không lỗi trang, thứ tự vùng đúng.
- Ảnh: `structural-execution/evidence/WS4B-overview-after-*.png`.
- Test: `overview-page.test.tsx` (9 test, thêm 1), `measures.test.ts`, `shell/a11y-audit` xanh.

### Chưa làm (WS-4B)

- Vùng Attention chưa có các mục "failed operations" (nguồn không cung cấp dạng đếm đáng tin trên Overview). Không tự tạo.
- Không giảm số finding detail: severity giữ nguyên, chỉ đổi thứ tự (progressive disclosure chưa làm vì trang Findings chưa có phân tích tương đương).
- Phần "Team & Approvals" và Overview real với backend: NV.

## Rủi ro

- Số đếm "Awaiting decisions" có thể thấp hơn trước (stop bị loại). Đã nêu trong caption.
- Thứ tự khối đổi: người dùng quen vị trí cũ sẽ thấy khác. Có ảnh trước/sau trong báo cáo WS-4B.

## Đính chính dark mode

Ảnh dark trước đó là ảnh sáng (script sai, không phải lỗi ứng dụng). Ảnh dark thật đã thay bằng theme chọn qua menu tài khoản; xem `VERIFICATION-LOG.md`, mục "Đính chính".
