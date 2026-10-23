# WS-2 · Thống nhất Decisions, Approvals và Notifications

UX-ID: UX-08 (chính), UX-09 (một phần: inbox và thông báo). Nguồn: `01-full-audit-report.md` (UX-08), `06-verification-gaps.md` mục 8, mã nguồn tại HEAD `56a29e1a`.

## 1. Kiến trúc hiện tại

### 1.1 Nguồn quyết định và nơi chúng xuất hiện

| Loại | Ghi quyết định (server) | Có trong `/api/tasks` | Nơi hiển thị |
|---|---|---|---|
| Scope revision | `POST /engagements/:id/scope/revisions/:rid/decision` | Có (`scope-revision`) | Overview, Tasks, Team tab |
| Business plan | `POST /engagements/:id/plans/:pid/decision` | Có (`business-plan`) | Overview, Tasks, Team tab, Governance |
| C2 access (grant) | `POST /api/engagements/:id/c2/grants/:gid/decision` | Có (`c2-grant`) | Overview, Tasks, Team tab, Infrastructure (Grants) |
| Report review | Có endpoint (không liệt kê trong bước khảo sát này) | Có (`report-review`) | Overview, Tasks, Team tab |
| Finding review | Có endpoint (cùng trạng thái) | Có (`finding-review`) | Overview, Tasks, Team tab |
| Emergency stop (đang hoạt động) | `POST /engagements/:id/estops`, `POST .../estops/:sid/resolve` | Có (`active-stop`) | Overview (banner), Tasks, Team tab, Governance |
| Closure | `POST /api/engagements/:id/closure/decision` | **Không** | Tab Closeout |
| Library proposal | `POST /api/engagements/:id/library-proposals/:pid/decision` | **Không** | Capabilities (proposal) |
| Tool approval (HITL) | `GET/POST /engagements/:id/approvals` (W11, file-backed, theo engagement) | **Không** (thiết kế, xem mục 1.3) | Trong hội thoại AI Workspace |
| Thông báo (notice) | `GET /api/notices`, `POST .../read`, `POST .../dismiss` | Không (feed riêng, theo actor) | Chuông header |

Ba điểm cần chú ý:
- Closure và library proposal có ghi quyết định nhưng không có trong inbox. Người dùng có thể bỏ sót việc cần làm.
- Tool approval là quyết định đúng nghĩa (cho phép một hành động runtime tiếp tục), nhưng không vào inbox, không đếm trong KPI.
- Chuông header là feed thông báo, không phải inbox.

### 1.2 Cùng một danh sách, bốn bề mặt

- Overview: `AttentionBanner` (đếm `tasks.length` và số stop), `DecisionBlock` (danh sách), đều đọc `useOverviewTasks` → `/api/tasks`.
- Tasks: `RealCommandCenter` (real) và `my-tasks.tsx` (mock), đọc `useRealTaskInbox` → `/api/tasks`.
- Project, tab Team & Approvals: `ApprovalInbox` (`features/team/approval-inbox.tsx`) đọc cùng `fetchTasks` và lọc theo engagement. Mô tả của file: "read-only here; each item opens the page that records the decision".
- Chuông header: `HeaderNotices` (`features/notices`), đọc `/api/notices`; nhóm hiển thị suy ra từ `category` hoặc từ tên route đích (`catOf` trong `shell/header.tsx`).

Đây là bốn bản sao của cùng một danh sách và hai cách phân loại thông báo khác nhau.

### 1.3 Tool approval nằm ngoài inbox theo thiết kế (có ghi chú)

`features/overview/mock.ts` ghi: "Approval types the real inbox does not track are left out". Mock và real đồng nhất ở điểm này: cả hai không đưa tool approval vào inbox. Nhưng nhãn của KPI "Awaiting decisions" có ghi "Approvals, reviews and stops" (`overview-page.tsx:68`). Nhãn này gây hiểu nhầm: "Approvals" không bao gồm tool approval.

### 1.4 Stop không phải quyết định

Stop đang hoạt động được gộp vào inbox như một mục, nhưng ngữ nghĩa khác: người dùng không "quyết" stop, họ theo dõi trạng thái (`requested`, `acknowledged`, `stopped`, `failed`, `unknown`). Checklist J-17 yêu cầu không gộp "acknowledged" và "stopped". Hiện trạng gộp chung mục vào inbox dễ tạo nhầm lẫn này.

## 2. Thuật ngữ đề xuất (chi tiết ở `05-terminology.md`)

- **Decision** (quyết định): yêu cầu có câu trả lời của một vai trò xác định, và câu trả lời đó thay đổi trạng thái miền. Thuật ngữ chung cho mọi mục inbox trừ stop.
- **Tool approval** (phê duyệt công cụ): quyết định đặc biệt cho một hành động runtime cụ thể trong một hội thoại. Dùng "approval" chỉ cho loại này.
- **Notification** (thông báo): thông tin về một sự kiện, có trạng thái đã đọc. Không đóng một quyết định.
- **Attention item** (mục cần chú ý): mục hiển thị tổng hợp. Gồm decision, stop đang hoạt động, run thất bại và nguồn không khả dụng. Đây là khái niệm trình bày, không phải thực thể lưu trữ.
- Stop được xếp vào **Attention item**, không phải **Decision**.

## 3. Kiến trúc đề xuất

### 3.1 Module sâu `DecisionInbox`

Đặt tại `features/decisions/` (feature mới, có `index.ts` công khai, theo ADR-0096).

```
pending(scope): Promise<ServiceResult<PendingDecisions>>   // bounded, có provenance và trạng thái nguồn
counts(scope): Counts                                       // một định nghĩa duy nhất, kèm chú thích phạm vi
actionFor(item, actor): { route: Route; requiredRole: Role; state: 'open' | 'refused' }
```

- `PendingDecisions` gồm: `items` (mỗi item có `kind`, `engagementId`, `refId`, `requestedAt`, `source`), `sources` (mỗi nguồn `available` / `unavailable` với lý do), `truncated`.
- Ghi quyết định KHÔNG nằm trong module. Mỗi miền giữ endpoint ghi của mình. Inbox chỉ điều hướng và hiển thị. Lý do: gộp endpoint ghi sẽ gộp ngữ nghĩa phân quyền và xác nhận của từng miền, và đó là điều server đã kiểm tra riêng.
- Độ sâu: bốn bề mặt hiện nay biết về `/api/tasks`, khác nhau về cách lọc và đếm. Sau thay đổi, chúng chỉ biết `DecisionInbox`. Deletion test: xóa module thì logic đếm và lọc quay lại bốn nơi.

### 3.2 Notification tách hẳn khỏi decision

- `NotificationCenter` giữ nguyên là feed theo actor. Thông báo có thể liên kết tới một decision, nhưng việc đọc hoặc bỏ thông báo không đổi trạng thái decision.
- Nhóm hiển thị lấy từ `category` do server gửi, bỏ `catOf` suy ra từ tên route đích (dễ vỡ khi đổi route).

### 3.3 Tool approval: ba lựa chọn (D-02)

| Lựa chọn | Mô tả | Chi phí | Đánh giá |
|---|---|---|---|
| A | Giữ tool approval ngoài inbox toàn cục. Thêm nó vào bề mặt theo engagement (Team tab và hội thoại). Đổi nhãn KPI thành "Decisions (excluding tool approvals)" | Thấp (client) | Khuyến nghị làm ngay |
| B | Thêm aggregate server cho tool approval, bị giới hạn (bounded) theo actor | Cao: dữ liệu W11 là file theo engagement, phải quét nhiều engagement; cần chỉ mục và giới hạn | Cần ADR trước khi làm |
| C | Chỉ đổi nhãn, không làm gì thêm | Rất thấp | Chấp nhận được nếu D-02 chọn "không ưu tiên" |

Khuyến nghị: A ngay, B là ADR riêng khi có yêu cầu từ vận hành.

### 3.4 Đưa closure và library proposal vào inbox

Cần thêm hai kind (`closure`, `library-proposal`) vào aggregate server và vào `DecisionInbox`. Đây là thay đổi contract (`apps/shared/web-contracts`, `inbox-service.ts`, `/api/tasks`) và cần đối chiếu quyền của từng miền.

## 4. Route và component

| Thay đổi | File |
|---|---|
| Module mới | `features/decisions/` (index, read model, actionFor) |
| Bỏ gọi `fetchTasks` trực tiếp | `features/overview/views/overview-blocks.tsx`, `features/tasks/query.ts`, `features/team/approval-inbox.tsx`, `shell/header.tsx` (badge) |
| Tab Team & Approvals | Chỉ còn thành viên và vai trò; mục quyết định chuyển sang inbox (liên kết) |
| Chuông | `features/notices/*`: nhóm theo `category`; bỏ `catOf` |
| Route | Không đổi key. Có thể thêm mục sidebar "Decisions" (D-01, D-02) |
| Server (giai đoạn sau) | `inbox-service.ts`, `/api/tasks` thêm kind; `web-contracts` cập nhật |

## 5. Phụ thuộc

- WS-4: con số "Awaiting decisions" lấy từ `DecisionInbox.counts`. Nhãn KPI phải thống nhất với WS-4.
- WS-3: grant (`c2-grant`) là decision nhưng định nghĩa "access" thuộc glossary và WS-3.
- WS-1: nếu có mục sidebar "Decisions", phải đi qua bảng mục của WS-1.
- Server: thay đổi contract cho closure, library proposal, và (nếu chọn B) tool approval.

## 6. Tác động UX

- Một danh sách việc cần làm duy nhất, ở mọi nơi hiện danh sách.
- Nhãn KPI nói đúng những gì đếm được.
- Thông báo và quyết định tách bạch: đọc thông báo không đóng việc.
- Viewer và người không có vai trò vẫn thấy mục, nhưng hành động được đánh dấu "requires role" theo phản hồi của server (không suy ra ở client).

## 7. Rủi ro hồi quy

| Rủi ro | Giảm thiểu |
|---|---|
| Đếm đôi khi thêm kind mới | Test: tổng `DecisionInbox` = tổng theo kind; không đếm stop như decision |
| Phân quyền: client hiển thị hành động cho người không đủ quyền | Hành động lấy từ phản hồi server; test với viewer và reviewer khác author (checklist U-05) |
| Thông báo thay đổi trạng thái decision | Test: `read`/`dismiss` không gọi endpoint ghi của miền |
| Mock và real lệch nhau khi thêm kind | Test song song mock và real cho danh sách kind |
| Deep link từ thông báo tới decision cũ | Giữ route đích; kiểm bằng `routes.json` |
| Tool approval bị hiểu là "đã xử lý" khi không thấy trong inbox | Nhãn rõ "excluding tool approvals" và liên kết tới hội thoại |

## 8. Tiêu chí nghiệm thu

1. Chỉ `features/decisions` gọi `/api/tasks`. Kiểm bằng `grep`.
2. Overview, Tasks, Team tab và chuông (badge) dùng cùng `counts` và cùng `items`. Test so sánh.
3. Nhãn KPI và chú thích phạm vi khớp với định nghĩa trong module.
4. Stop hiển thị trong danh sách attention, không đếm trong decision.
5. Không có nút quyết định nào hiển thị cho người không đủ quyền khi server trả về `requiredRole` (test với viewer).
6. Đọc hoặc bỏ thông báo không thay đổi trạng thái decision (test).
7. Route smoke mock và real không có lỗi mới.

## 9. Trình tự triển khai

1. Characterization: ghi lại danh sách hiện có (kind, id) của `/api/tasks` và của mock, trên stack và trên mock.
2. Thêm `features/decisions` chỉ đọc; chuyển bốn bề mặt sang module. Không đổi server.
3. Đổi nhãn KPI và copy phạm vi (phụ thuộc WS-4 phần định nghĩa).
4. Team & Approvals: bỏ danh sách quyết định, giữ thành viên, thêm liên kết.
5. Chuông: nhóm theo `category`; bỏ `catOf`.
6. Quyết định D-02 (ADR nếu chọn B).
7. Thêm closure và library proposal vào aggregate (thay đổi contract, cần review server).
