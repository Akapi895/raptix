# WS-4 · Chuẩn hóa KPI, data provenance và giảm mật độ Overview

UX-ID: UX-12 (chính), UX-16 (chính). Nguồn: `01-full-audit-report.md` (UX-12, UX-16), checklist G-01 (§3.1), `features/overview/*` tại HEAD `56a29e1a`.

## 1. Kiến trúc hiện tại

### 1.1 Năm read port, mỗi port một vùng

`features/overview/service.ts` khai báo `OverviewService` với năm hàm đọc: `projects()`, `findings()`, `c2()`, `operations()`, `tasks()`. Mỗi vùng trên trang có trạng thái riêng (`SourceState`): pending, lỗi, không ghi nhận. Đây là điểm mạnh và được giữ lại.

### 1.2 Bốn KPI: định nghĩa nằm trong JSX

`features/overview/views/overview-page.tsx` (dòng 58–74):

| KPI | Giá trị | Ghi chú hiển thị | Vấn đề |
|---|---|---|---|
| Active projects | Đếm project có status trong `{active, approved, planning, running}` (dòng 17) | "Planning or running" | Chú thích không liệt kê `approved`. Cùng lỗi đã sửa ở trang Projects (Round 1), còn tồn tại ở đây |
| Active operations | `operations.counts.running`, hoặc "Not recorded" nếu `counts === null` | "Operations running now" | Đã đổi từ "Running binding state" (Round 1). Định nghĩa vẫn không hiện trên màn hình |
| Awaiting decisions | `tasks.length` (chỉ tác vụ từ `/api/tasks`) | "Approvals, reviews and stops" | Không tính tool approval; không tính closure và library proposal. Chú thích gây hiểu nhầm (xem WS-2) |
| Open curated findings | `openCuratedCount`: `confirmed` + `remediation` + `retest` (`service.ts`, dòng 70–74) | "Confirmed, remediation or retest" | Đúng với định nghĩa, nhưng "curated" và "open" không được định nghĩa trên màn hình |

### 1.3 Ba cách đếm findings trên cùng một trang

- Donut "Curated findings" (tổng, gồm cả resolved) — `SeverityBlock`.
- "Risk level" và "Unresolved findings only" — `riskAssessment(unresolvedBySeverity)` (`service.ts`, dòng 53–54) với trọng số 10/5/2/0.5.
- KPI "Open curated findings" — `openCuratedCount`.

Ba con số đúng theo định nghĩa riêng, nhưng không có chỗ nào nói chúng khác nhau. Định nghĩa "unresolved" do server quyết định và chưa được ghi lại trong tài liệu này (cần xác minh trước khi triển khai).

### 1.4 Nguồn không đủ cho sáu KPI theo checklist

Checklist G-01 yêu cầu: active projects, active operations, pending plans/approvals, connected agents, active sessions, open findings. Port hiện tại:
- `projects()`: có. `operations()`: có (`counts.running`). `tasks()`: có (pending plans/approvals một phần). `findings()`: có.
- `c2()`: có `pendingGrants` và `commandsByStatus`, **không có số session đang hoạt động** (`OverviewC2`).
- Connected agents: không có trong port Overview; có trong `RuntimeFleetTab` ở Infrastructure (runtime), đọc theo engagement.

### 1.5 Mật độ

Trang có các vùng: banner chú ý, bốn KPI, donut severity, risk, cụm trạng thái findings, operations queue, decision queue, recent findings, C2, khối khuyến nghị (được mô tả trong comment đầu `overview-page.tsx`, cần xác nhận có render hay không), danh sách project. Đây là khoảng 10 vùng đọc cùng lúc, không có thứ tự ưu tiên ngoài banner (UX-16).

### 1.6 Provenance đã có một phần

Port đã trả `null` khi nguồn không ghi nhận (`latestCreatedAt`, `commandsByStatus`, `counts`), và trang hiển thị "Not recorded" thay vì 0. Đây là nền tảng tốt. Thiếu: thời điểm đọc (as-of), định nghĩa trên màn hình, và phân biệt "0 thật" với "không có nguồn" ở mọi KPI.

## 2. Kiến trúc đề xuất

### 2.1 Module sâu `OverviewMeasures`

Đặt tại `features/overview/measures.ts`. Mỗi chỉ số là một `Measure`:

```
type Measure = {
  id: MeasureId                       // ổn định, dùng cho test và liên kết
  label: string
  value: number | null
  state: 'value' | 'zero' | 'not-recorded' | 'unavailable' | 'pending'
  definition: string                  // một câu, cùng nguồn với chú thích hiển thị
  source: { port: 'projects' | 'findings' | 'operations' | 'tasks' | 'c2'; asOf: string | null }
  scope: 'accessible projects' | 'this engagement'
  open?: Route                        // liên kết
}

measures(view: OverviewReads): Measure[]   // hàm thuần, không đọc mạng
```

Độ sâu: một hàm thuần chứa mọi định nghĩa và mọi quy tắc trạng thái. Trang chỉ render `Measure` bằng một component. Deletion test: xóa module thì định nghĩa quay lại JSX và `kpiDisplay` ở mỗi KPI.

Ràng buộc: `definition` và chú thích hiển thị được sinh từ cùng một chuỗi, để không bao giờ lệch (lỗi của Round 1 và của "Active projects" hôm nay).

### 2.2 Vùng "Cần xử lý" (attention) ở đầu trang

`AttentionRegion` gom: decision đang chờ (WS-2: `DecisionInbox.counts`), stop đang hoạt động, run thất bại (nếu có nguồn), nguồn không khả dụng. Mỗi mục có liên kết. Đây là khái niệm trình bày (attention item), không phải thực thể lưu trữ (xem `05-terminology.md`).

### 2.3 Bố cục đề xuất

1. Vùng "Cần xử lý" (attention).
2. Hàng KPI: 4 measure (hoặc 6 nếu D-04 chọn 6, cần nguồn cho connected agents và active sessions).
3. Operations (danh sách ngắn, có liên kết).
4. Projects (năm mục gần nhất, liên kết tới trang Projects).

Chuyển ra trang Findings (hoặc sau một disclosure): donut severity, risk level, cụm trạng thái findings, recent findings. Lý do: đây là phân tích findings, thuộc trang Findings; để trên Overview là trùng với trang đó.

### 2.4 Định nghĩa thống nhất

| Từ | Nghĩa duy nhất | Dùng ở đâu |
|---|---|---|
| Curated finding | Finding đã được người dùng xác nhận là finding (không phải AI suggestion, không phải draft) | Mọi chỗ đếm findings |
| Open | Curated và thuộc `confirmed`, `remediation`, `retest` | KPI "Open curated findings" |
| Unresolved | Định nghĩa của server (cần xác minh); dùng cho risk level | Trang Findings |
| Active project | Status thuộc tập đã định nghĩa trong module (một nguồn) | KPI, chú thích tự sinh |

### 2.5 Ba chọn lựa về số KPI (D-04)

| Lựa chọn | Mô tả | Nguồn cần thêm |
|---|---|---|
| A (khuyến nghị) | 4 measure + vùng attention; sửa định nghĩa | Không |
| B | 6 measure theo checklist | Connected agents (port fleet), active sessions (port C2 có số session) |
| C | 4 measure, cập nhật acceptance của checklist cho khớp | Không |

## 3. Route và component

| Thay đổi | File |
|---|---|
| Module mới | `features/overview/measures.ts` (+ test) |
| Component `MeasureCard` | `features/overview/views/measure-card.tsx` (thay `OverviewKpi`) |
| Vùng attention | `features/overview/views/attention-region.tsx` (thay `AttentionBanner` và `DecisionBlock`) |
| Trang | `features/overview/views/overview-page.tsx`: bỏ `kpiDisplay`, bỏ block findings, sắp xếp lại |
| Findings | Nhận khối severity, risk, trạng thái (WS-4 không làm trang Findings, chỉ chuyển khối) |
| Port | Không đổi chữ ký. Nếu chọn B: thêm trường vào `OverviewC2` và `OverviewOperations` (contract, cần review) |
| Route | Không đổi key |

## 4. Phụ thuộc

- WS-2: "Awaiting decisions" lấy từ `DecisionInbox.counts`. Nếu WS-2 chưa xong, giữ `tasks.length` nhưng ghi phạm vi đúng ("excluding tool approvals").
- WS-3: "Active sessions" (nếu D-04 chọn B) cần số session từ provider, phải đi qua `C2Workspace` hoặc port tương đương.
- WS-1: liên kết trong measure dùng bảng mục.
- ADR-0097 (`docs/adr/0097-overview-operations-read-section.md`, **untracked**): quyết định về vùng operations trên Overview. Cần đối chiếu trước khi đổi bố cục.
- Findings page: nơi nhận khối severity; chưa rõ trang này đã có đủ bộ lọc để nhận (cần đối chiếu).

## 5. Tác động UX

- Người dùng thấy việc cần làm trước, số liệu sau.
- Mỗi số có định nghĩa và nguồn; "0" không còn có thể nghĩa là "không có dữ liệu".
- Overview ngắn hơn đáng kể; phân tích findings đến đúng trang.
- Người dùng quen severity trên Overview cần tìm trên Findings (rủi ro thay đổi thói quen).

## 6. Rủi ro hồi quy

| Rủi ro | Giảm thiểu |
|---|---|
| Đổi số làm vỡ test hiện có (`overview-page.test.tsx`, `service.test.ts`, `mock.test.ts`) | Cập nhật có chủ đích; giữ nguyên trạng thái "not recorded" và "unavailable" |
| Mất thông tin severity cho chủ dự án | Chuyển sang Findings; liên kết rõ ở vùng KPI |
| Hai định nghĩa "open" và "unresolved" bị nhập làm một | Test: mỗi measure có `definition` khác nhau khi nguồn khác nhau |
| Port thêm trường làm chậm read tổng hợp | Giữ giới hạn (`truncated`); đo độ trễ trước và sau |
| Mock không tạo đủ trạng thái để kiểm | Thêm fixture cho từng trạng thái trong `mock.ts` |

## 7. Tiêu chí nghiệm thu

1. Mọi measure có `definition`; chú thích hiển thị trùng `definition` (test so sánh chuỗi).
2. Năm trạng thái (`value`, `zero`, `not-recorded`, `unavailable`, `pending`) có văn bản khác nhau trên màn hình (test).
3. "Active projects" không còn chú thích mâu thuẫn với tập status.
4. Vùng attention đứng đầu; số mục top-level giảm từ khoảng 10 xuống không quá 6 (đếm landmark trong DOM).
5. Severity, risk và cụm trạng thái findings không còn trên Overview (hoặc chỉ sau disclosure, theo D-04).
6. Mock và real render cùng cấu trúc measure; khác biệt chỉ là nguồn.
7. Route smoke mock và real không có lỗi mới.

## 8. Trình tự triển khai

1. Characterization: ghi lại DOM và text của Overview ở mock và real (trên stack) trước khi đổi.
2. Thêm `measures.ts` và test định nghĩa (không đổi UI).
3. Thay KPI bằng `MeasureCard` (không đổi số liệu, chỉ đổi định nghĩa và chú thích).
4. Thêm vùng attention (dùng `tasks` hiện có; WS-2 sau thay nguồn).
5. Chuyển khối findings sang trang Findings; sắp xếp lại.
6. Quyết định D-04; nếu B, thêm trường port (contract review).
7. Đối chiếu ADR-0097 và cập nhật.
