# Raptix: danh sách trang và nội dung chi tiết

Trạng thái: MVP đợt "dọn code, tổ chức lại trải nghiệm hiện có" (bước A–D) đã triển khai ngày 2026-10-22. Phần còn lại ghi ở §7 và §8. Đây là MVP, chưa phải toàn bộ đề xuất.

Nguồn đã đối chiếu trong `apps/web/src/`:
- `shell/nav.ts`: điều hướng toàn cục và điều hướng dự án.
- `router/registry.tsx`: 55 route key.
- `screens/a-dashboard.tsx`, `domain/dashboard.ts`: tổng quan và hàng đợi "cần xử lý".
- `screens/b-portfolio.tsx`, `screens/b-detail.tsx`: danh sách dự án và chi tiết dự án.
- `screens/c.tsx`, `c-console.tsx`, `c-results.tsx`: vận hành.
- `screens/e-analysis.tsx`: phân tích.
- `screens/h.tsx`, `h-session.tsx`: C2 và phiên.
- `screens/infrastructure.tsx`, `screens/d-agents.tsx`: hạ tầng và agent.
- `features/findings/`, `features/reports/`, `features/assets/`, `features/library/`, `features/settings/`, `features/team/`, `features/audit/`, `features/vault/`, `features/governance/`, `features/scope/`, `features/copilot/`, `features/aichat/`.

## 0. Quyết định đã chốt

| Quyết định | Hệ quả |
|---|---|
| Bỏ Workflow canvas | Không có trang canvas. Playbook là danh sách bước có thứ tự, chỉnh bằng form. |
| Không có Payload generator | Không có trang sinh payload. Tải trọng (payload) không phải một mục điều hướng. |
| Cần WebShell | WebShell là một loại phiên (`kind: web`). Đã có sẵn hỗ trợ trong `h-session.tsx` (có chỉ số "HTTP session health" cho phiên loại web). Nằm trong Hạ tầng › Phiên và Dự án › Phiên C2. |
| Tri thức toàn cục | Bây giờ chỉ làm tab mock trong Thư viện. RAG làm sau. Tài liệu MITRE ATT&CK và các tài liệu khác sẽ được bổ sung sau. |
| Không có Vai trò agent | Có thể làm sau một tab kiểm soát các specialist hiện có. |
| Nhật ký C2 | Đưa vào Nhật ký toàn cục, dạng bộ lọc. Tạo phiên C2 đi luồng riêng, không qua Nhật ký. |
| Có Skills | Dùng Thư viện › Skills (đã có "Skill library" trong `features/library`). |

## 1. Kiến trúc điều hướng

Hai tầng, mỗi tầng có sidebar riêng.

- **Tầng toàn cục** (7 mục): trả lời "hệ thống đang làm gì, có gì, cần tôi xử lý việc gì".
- **Tầng dự án** (14 mục): mở khi bấm một dự án. Trả lời "dự án này đang ở đâu, bước tiếp theo là gì".

Quy ước URL giữ nguyên dạng hash của raptix: `#/<trang>[/<id>][?tab=<tab>]`. Mọi deep link cũ phải tiếp tục hoạt động qua bảng alias.

Khi đang ở tầng dự án, sidebar toàn cục thu gọn thành một nút "Về Dự án" để giữ ngữ cảnh.

## 2. Tầng toàn cục (7 trang)

### 2.1 Tổng quan (`overview`)

Gộp `overview` và `command-center`. Hiện hai route này cùng render `Dashboard` (`screens/a.tsx`). Giữ `command-center` như alias.

Nội dung theo thứ tự trên màn hình:

1. **Hàng KPI** (6 thẻ, bấm được):
   - Dự án đang hoạt động (kèm số dự án có quyền truy cập).
   - Thao tác đang chạy (kèm tổng số).
   - Kế hoạch chờ duyệt (kèm số phê duyệt khác).
   - Agent kết nối (ví dụ 5 / 7, cảnh báo khi có agent offline).
   - Phiên đang hoạt động (kèm số phiên đang theo dõi).
   - Finding mở (kèm số critical/high; AI suggestion không tính).
2. **"Cần bạn xử lý"** (`attentionItems`, mỗi dòng có loại, mức độ và nút mở đúng chỗ):
   - Agent offline.
   - Kế hoạch đang ở trạng thái `in_review`.
   - Yêu cầu truy cập phiên đang chờ.
   - Vấn đề ROE (dự án không có ROE đã duyệt).
   - Nút C2 offline hoặc suy giảm.
   - Có thể thêm sau (chưa có trong code): báo cáo chờ duyệt, finding bị trả về, phê duyệt khác.
3. **Thao tác đang chạy**: danh sách thao tác đang chạy hoặc tạm dừng, có tiến độ, nút mở.
4. **Thao tác nhanh**: tạo dự án, tạo thao tác, mở Copilot.
5. **Finding mở theo mức độ**: biểu đồ phân bố theo critical/high/medium/low/info.
6. **Hoạt động gần đây**: lấy từ nhật ký audit toàn cục, có liên kết sang Nhật ký.
7. **Sức khỏe hệ thống**: trạng thái C2 node và agent của các dự án.
8. **Hộp việc của tôi** (`tasks`): các mục đang chờ tôi duyệt hoặc xem xét, nhóm theo loại.

Lưu ý: hiện mock và real có hai bản overview khác nhau (`screens/a-dashboard` và `real/screens/overview`). Phải gộp thành một.

### 2.2 Dự án (`projects`, `project-new`)

Danh sách và portfolio.

- **Cột**: ID (có ghim), tên, khách hàng, loại, chủ sở hữu, ROE (phiên bản và trạng thái), mức sẵn sàng thực thi, trạng thái, ngày cập nhật, menu hành động.
- **Bộ lọc**: trạng thái, loại, chủ sở hữu, khách hàng, tìm kiếm.
- **Nút**: xuất danh sách (không có với vai trò viewer), tạo dự án.
- **Trạng thái rỗng**: "Chưa có dự án" kèm nút tạo; "Không có dự án khớp bộ lọc" kèm nút xóa bộ lọc.
- **Quyền**: chỉ Red Team Manager hoặc Org Admin được tạo dự án.

`project-new` là wizard tạo dự án. Mở từ nút tạo, không có mục riêng trên sidebar.

### 2.3 Phát hiện (`findings`, `finding`, `finding-new`)

Hàng đợi phát hiện xuyên dự án.

- **Tab**: Tất cả, Đã xác nhận (Confirmed), Đang xem xét (In Review), Gợi ý AI (AI Suggestions), Bản nháp (Drafts), Khắc phục (Remediation).
- **Bộ lọc**: dự án, mức độ, trạng thái, tìm kiếm.
- **Trạng thái finding**: draft, review, confirmed, remediation, retest, resolved, returned, ai_suggested.
- **Chi tiết finding**: tab Tóm tắt & quy trình (Summary & workflow), tab Bằng chứng (kèm số lượng), tab Kiểm tra lại (Retest, kèm số lượng), tab Tái hiện (Reproduce).
- **Quy tắc nghiệp vụ** (theo `GLOSSARY.md`): finding "resolved" cần một observation kiểm tra lại có bằng chứng đã phân loại. Finding bị trả về (returned) giữ nguyên lý do trả.
- Gợi ý AI không được tính vào số finding mở.

`finding-new` là form tạo finding, mở từ nút trong trang Phát hiện hoặc trong dự án.

### 2.4 Tài sản (`assets`, `asset-new`, `asset-scope`, `asset`)

Gồm ba tab:

1. **Tổng quan** (chưa có trong raptix, cần xây): phân bố giao thức, biến động tài sản, xu hướng rủi ro, độ phủ quét (tài sản chưa quét hoặc lâu chưa kiểm tra lại). Ý tưởng lấy từ CyberStrikeAI.
2. **Thư viện**: bảng tài sản. Cột: ID, tên, định danh, IP, loại, OS, chủ sở hữu, dự án, phạm vi (in, out, pending, unclassified), nguồn, cập nhật.
   - Có chọn nhiều, lọc theo dự án và phạm vi.
   - Có "Scope Map & Review" (`asset-scope`): xem bản đồ phạm vi và duyệt.
3. **Khám phá** (`asset-new`): ba cách thêm tài sản.
   - Thủ công (Manual).
   - Nhập hàng loạt (Bulk): tải template, kiểm tra trước khi nhập.
   - Khám phá (Discovery): quét để tìm tài sản mới.

Trang chi tiết tài sản (`asset`) có các tab: Tổng quan, Phạm vi (Scope), Thao tác liên quan, Agent, Phát hiện và các tab khác. Tham số `edit` được coi như Tổng quan (theo route inventory).

### 2.5 Thư viện (`playbooks`, `playbook`, `technique`, `playbook-review`)

Gồm các mục sau. Playbook, Kỹ thuật và Skills đã có. Đề xuất có một phần. Tri thức toàn cục cần xây mới.

1. **Playbook** (`playbooks`, tab mặc định): danh sách playbook. Mỗi playbook có tên, loại (playbook hoặc profile), phiên bản, chủ sở hữu, trạng thái (approved, draft, review), hệ điều hành, kỹ thuật, các bước, mục tiêu, lần cập nhật. Trang chi tiết có lịch sử phiên bản và trang đề xuất thay đổi (`playbook-review`).
2. **Profile**: cùng cấu trúc với playbook nhưng `kind: profile`.
3. **Kỹ thuật** (`technique`): danh mục kỹ thuật MITRE ATT&CK. Mỗi kỹ thuật có ID, tên, chiến thuật (tactic), nền tảng, mô tả.
4. **Skills** (đã có, `features/library`): "Skill library" là corpus skill chỉ đọc. Thay đổi phải đi qua quy trình đề xuất. Có trang chi tiết skill. Không làm tab thống kê lượt gọi skill.
5. **Đề xuất** (Proposals, đã có một phần): đề xuất thay thế nội dung SKILL.md cho một engagement. Được duyệt bởi người review độc lập. Phê duyệt chỉ ghi nhận quyết định, không sửa corpus gốc.
6. **Tri thức toàn cục** (chỉ tab mock ở giai đoạn này): hiển thị danh sách mục tri thức mẫu, danh mục, trạng thái lập chỉ mục và lịch sử truy xuất mẫu. Không có backend, không có tải tài liệu thật. Không dùng số liệu mẫu ở chế độ real. Ở chế độ real hiện trạng thái "chưa tích hợp" (dùng `real/not-integrated.tsx`), theo quy tắc ADR-0068 về việc không fallback sang dữ liệu demo. Cấu trúc theo ADR-0096: `features/knowledge/` gồm `service.ts` (port), `mock.ts`, `views/`. Adapter thật làm sau khi có RAG.
7. Không có mục Vai trò agent. Sau này có thể làm một tab kiểm soát các specialist hiện có.

Ghi chú: không còn canvas workflow.

### 2.6 Hạ tầng (`infrastructure`, `agents`, `agent`, `c2`, `c2-channel`, `c2-session`, `c2-console`)

Ba tab (đã có trong `screens/infrastructure.tsx`):

1. **Agent thực thi** (`agents`): bốn chế độ.
   - Danh sách (list): host, OS, phiên bản, dự án, trạng thái (online, idle, lost, disabled, unknown, unhealthy), nhóm, kết nối, IP, lần cuối thấy.
   - Pool: agent chưa gán dự án.
   - Nhóm (groups): tên, dự án, mô tả, danh sách agent, chủ sở hữu, chính sách, cập nhật.
   - Sức khỏe (health): agent lost, agent delayed, lỗi và gợi ý khắc phục.
   - Trang chi tiết agent (`agent`) có tab Tổng quan.
2. **Hạ tầng C2** (`c2`): nút C2 (team server, redirector, relay) với trạng thái, phiên bản, độ trễ, tải, dự án được gán. Kênh C2 (`c2-channel`) có giao thức, nút, trạng thái, số phiên, beacon, jitter.
3. **Phiên** (`sessions`): tất cả phiên, kèm chế độ giám sát. Gồm cả phiên C2 và phiên WebShell (lọc theo `kind`).
   - Trang chi tiết phiên (`c2-session`) có các tab: Transcript, Session Events, Evidence, Policy.
   - Quyền truy cập: chỉ đọc (read-only) hoặc tương tác (interactive), có thời hạn. Yêu cầu quyền có lịch sử và có người duyệt.
   - Console (`c2-console`) là giao diện tương tác, mở từ phiên.
   - Phiên WebShell hiển thị thêm "HTTP session health".

Nhật ký C2 nằm trong Nhật ký toàn cục (mục 3.13), không có tab nhật ký riêng ở đây. Tạo phiên C2 đi luồng riêng, không qua Nhật ký.

### 2.7 Cài đặt (`settings`)

Có sẵn các tab (theo `apps/web/.scratch/web-improve-refactor/route-inventory.md`): Tổ chức (org), Người dùng (users), Tích hợp (integrations), Chính sách (policies), Lưu trữ (retention), Mẫu (templates), Phát hiện (detection), Nhật ký (audit), Thông báo (notifications), Bảo mật (security).

Nội dung đã thấy trong `settings-page.tsx`:
- **Người dùng & vai trò**: Người dùng, Vai trò và quyền, Lời mời.
- **Chính sách**: ma trận phê duyệt (approval matrix), công tắc chính sách và quy tắc phiên.
- **Hồ sơ cá nhân**: giao diện sáng/tối, mật độ bảng.

Cần thêm (chưa có):
- **AI & mô hình**: kênh AI, model mặc định, cấu hình phân tích ảnh, cấu hình agent mặc định, số liệu token (CyberStrikeAI có mục này).
- **Chính sách mặc định** cho công cụ và HITL. Dự án có thể ghi đè.
- **Tích hợp MCP và robot** (đã có một phần trong Tích hợp).
- Không có tab Cập nhật (theo quyết định).

## 3. Tầng dự án (14 trang)

Header cố định của mọi trang dự án:
- Tên dự án, khách hàng.
- Trạng thái dự án (draft, pending, approved, active, review, closed, rejected, paused, cancelled).
- Giai đoạn (Chuẩn bị → Thực thi → Kết quả → Đóng).
- Trạng thái phạm vi (ROE đã duyệt hay chưa).
- Nút **Dừng khẩn** (theo `features/estop`: dừng ở phạm vi thao tác, dự án hoặc workspace, có các pha requested → acknowledged → stopped).
- Nút Copilot.
- Nút "Về Dự án".
- Khi có phê duyệt đang chờ: banner cảnh báo kèm nút mở yêu cầu.

### 3.1 Tổng quan dự án (`project?tab=overview`)

Đây là trang bắt đầu của dự án.

- **Khối "Bước tiếp theo"** (`Next`): danh sách hành động được đề xuất theo trạng thái:
  - Gỡ từng lý do chặn (ví dụ "ROE chưa duyệt", "không có liên hệ khẩn cấp").
  - Hoàn tất thiết lập và gửi duyệt (nếu là draft hoặc rejected).
  - Xem yêu cầu phê duyệt (nếu pending).
  - Tạo thao tác, tạo bản nháp kế hoạch, tạo bản nháp báo cáo, thêm phạm vi (bị khóa khi ROE chưa duyệt, có lý do hiển thị).
  - Mở thao tác đang chạy.
  - Xem các finding cần duyệt.
  - Quản lý tài sản.
- **Khối sẵn sàng thực thi** (Execution Readiness): nhãn và lý do (ví dụ "Thực thi bị khóa, ROE chưa duyệt", "Sẵn sàng preflight, cần agent").
- **Tiến độ dự án** (Project Completion): phần đã hoàn thành, theo mục tiêu (objectives) và thao tác.
- **Facts blackboard** (tóm tắt): các sự kiện đã xác lập.
- **Checklist kết thúc** (Closeout): các bước để đóng dự án (từ tab `close` cũ).
- **Số liệu token theo dự án** (mới, tùy chọn).
- **Hoạt động gần đây** của dự án.

Trạng thái đóng: dự án `closed` chỉ đọc, nút hành động quay về tổng quan toàn cục.

### 3.2 Phạm vi & ROE (`scope`, `documents`)

Hai phần chính (`features/scope/tab.tsx`):
- **Tài sản** (Assets, kèm số lượng): tài sản trong và ngoài phạm vi, trạng thái phê duyệt thay đổi phạm vi.
- **ROE**: phiên bản, trạng thái, mục tiêu, liên hệ khẩn cấp, ngày hết hạn, người quyết định, các ràng buộc.
- **Tài liệu kế hoạch** (`features/documents`): tài liệu của dự án.
- Thay đổi phạm vi cần phê duyệt lại và có thể làm kế hoạch, thao tác bị kiểm tra lại (theo PM-2 trong chính sách).

Chính sách công cụ (từ "Kiểm soát tool" của CyberStrikeAI) đặt ở mục 3.14 (Cài đặt dự án).

### 3.3 Tài sản (`asset`, `asset-new`, `asset-scope` lọc theo dự án)

Cùng view với tầng toàn cục, chỉ hiện tài sản của dự án. Có thêm trang Scope Map & Review (`asset-scope`).

### 3.4 Kế hoạch (`plans`, `ai-plan`, `ai-plan-review`, `ai-plan-compare`)

- **Danh sách kế hoạch**: ID, phiên bản, tiêu đề, trạng thái (draft, proposed, in_review, approved, rejected, expired, executed, superseded), số bước, rủi ro.
- **Chi tiết kế hoạch** (`ai-plan`): tab Builder, Tổng quan, Các bước (`step-<id>` mở một bước), Nhánh, Tài sản, Rủi ro, Tham chiếu, Lịch sử.
- **Duyệt kế hoạch** (`ai-plan-review`): người duyệt xem từng bước, lý do, cần phê duyệt hay không.
- **So sánh** (`ai-plan-compare`): so sánh hai phiên bản kế hoạch (trạng thái, mục tiêu, phương pháp, ROE đã ghim, người quyết định, hạn).
- Quy tắc: AI chỉ đề xuất, không có công cụ nào chạy khi chưa có kế hoạch đã duyệt.

### 3.5 Không gian AI (`ai-workspace`, `ai-operator`, `ai-history`)

Thay cho trang Chat của CyberStrikeAI. Ba vùng:

1. **Thanh bên trái** (rail), bộ lọc: Tất cả, Hội thoại, Kế hoạch, Xem xét.
   - Tab "Xem xét" có hai nhóm: "Chờ tôi duyệt" và "Chờ người duyệt khác".
2. **Khung hội thoại** ở giữa:
   - Chế độ AI: quan sát (observe), đề xuất (propose), thực thi (execution). Chế độ được chọn bằng radio.
   - Dự án bị khóa (read-only) thì không thể đổi chế độ.
   - Tin nhắn có các loại thẻ: trả lời, đề xuất, sửa đổi, công cụ, chính sách, phê duyệt, kết quả, phân tích, lỗi.
   - Đính kèm bằng chứng ("Attach evidence"): hiện là nút demo, chưa hoạt động.
   - Cấu hình HITL theo phiên.
3. **Bảng phụ bên phải** (inspector), các tab:
   - Context: lý do không sẵn sàng thực thi, các mục chặn.
   - Agents: agent đang làm việc.
   - Operations: thao tác liên quan.
   - Approvals: yêu cầu phê duyệt.
   - Sources: ROE, phạm vi, tài liệu nguồn.

Copilot (`features/copilot`) là lối tắt toàn cục, mở được từ mọi trang. Không phải trang riêng.

### 3.6 Vận hành (`operations`, `operation`, `operation-new`, `preflight`, `operation-schedule`, `ai-trace`, `ai-fanout`, `ai-branch`)

- **Danh sách thao tác**: ID, tên, trạng thái, tiến độ, thời gian. Có nút tạo thao tác từ kế hoạch đã duyệt.
- **Điều kiện chặn** (hiển thị rõ lý do):
  - Dự án chưa được duyệt.
  - ROE chưa duyệt.
  - Không có liên hệ khẩn cấp trên ROE.
- **Tạo thao tác** (`operation-new`): chọn kế hoạch, mục tiêu, agent.
- **Preflight** (`preflight`): các bước kiểm tra trước khi chạy, có trạng thái pass, fail, warn. Mỗi bước lỗi có nút sửa, mở đúng chỗ.
- **Lịch chạy** (`operation-schedule`): thao tác đặt lịch.
- **Chi tiết thao tác** (`operation`): tab Tổng quan, Trực tiếp (live), Agent, Dòng thời gian, Đồ thị, Kết quả.
- **Tool calls** (từ `c-console`/`ExecutionTrace`): nhật ký gọi công cụ, mở từ đây.
- **Trace AI** (`ai-trace`): sự kiện công cụ, có liên kết deep link theo `?event=`.
- **Fan-out và nhánh** (`ai-fanout`, `ai-branch`): các nhánh chạy song song của agent, dạng đồ thị hoặc bảng.
- **Batch**: raptix chưa có màn hình batch riêng (cần xác nhận có cần không). Tác vụ của tôi nằm ở Tổng quan.
- **Dừng khẩn**: nút trong header, dừng ở phạm vi thao tác.

Ghi chú: Thu thập thông tin (Info collect) của CyberStrikeAI tương ứng với recon do Vận hành chạy. Kết quả tài sản đưa vào Tài sản (Khám phá).

### 3.7 Phiên C2 (`sessions`, `c2-session`, `c2-console`)

Danh sách phiên của dự án, lọc theo loại:
- **C2**: phiên beacon từ agent.
- **WebShell** (`kind: web`): phiên HTTP, có chỉ số sức khỏe.

Cột: ID, tài sản đích, loại, trạng thái (connected, available, awaiting, suspended, expired, terminated, revoking, disconnected), quyền (none, read-only, interactive), thời hạn, thao tác liên quan.

Chi tiết phiên:
- Tab Transcript, Session Events, Evidence (kèm số lượng), Policy.
- Quyền truy cập: danh sách người được cấp quyền, thời hạn, người cấp. Có lịch sử yêu cầu (yêu cầu, duyệt, từ chối, yêu cầu sửa).
- Nhật ký audit của phiên, có correlation ID.
- Đối tượng liên quan: thao tác, tài sản.

Console (`c2-console`): giao diện dòng lệnh tương tác, chỉ mở khi có quyền interactive.

Ghi chú: "Terminal" của CyberStrikeAI không có trang riêng. Nằm trong console của phiên (ADR-0095 cần được chấp nhận trước khi triển khai PTY, theo `CLAUDE.md`).

### 3.8 Phát hiện (`findings`, `finding`)

Cùng view với tầng toàn cục, lọc theo dự án. Tab như mục 2.3.

### 3.9 Phân tích (`analysis`)

Bốn tab (`features/analysis`, `screens/e-analysis.tsx`):
1. **Tổng quan**: KPI kỹ thuật đã kiểm thử (số kỹ thuật đã chạy trên tổng số trong danh mục, số kế hoạch chưa chạy), khoảng trống phát hiện (số kỹ thuật không bị phát hiện, cần xem xét qua finding), dòng thời gian thực thi.
2. **Đường tấn công** (Attack Paths): đồ thị kẻ tấn công đi qua các tài sản, có phóng to, thu nhỏ, chọn node.
3. **MITRE ATT&CK**: ma trận kỹ thuật theo chiến thuật, trạng thái từng ô (đã chạy, đã kế hoạch, đã phát hiện, không phát hiện).
4. **Phát hiện** (Detection): kết quả phát hiện từ tích hợp (SIEM/EDR). Khi chưa có dữ liệu, hiện cảnh báo kèm liên kết cấu hình tích hợp.

Mục "Cần xem xét": kỹ thuật đã thực thi nhưng không có tín hiệu phát hiện hoặc chưa được xác minh.

### 3.10 Bằng chứng (`evidence`, `evidence-inspector`)

Bảng và trình kiểm tra.

- **Cột**: ID, tên, loại, nguồn, người thu thập, thời điểm, finding liên kết, phân loại (unclassified, standard, sensitive), kích thước, digest.
- **Phân loại**: chưa phân loại thì nội dung gốc bị ẩn đến khi người có thẩm quyền gán nhãn.
- **Bằng chứng nhạy cảm**: bị che theo vai trò.
- **Inspector**: xem nội dung (nếu có quyền), kiểm tra digest khớp hay không, nguồn tạo (producer lineage), các finding và phiên liên quan.
- Tệp chat (từ "Quản lý tệp" của CyberStrikeAI) nằm ở đây.

### 3.11 Báo cáo (`reports`, `report-new`, `report`, `report-preview`, `report-review`)

- **Danh sách**: tên, dự án, mẫu, loại, trạng thái (draft, review, approved, exported, delivered, returned). Hành động theo trạng thái: "Sửa bản nháp", "Sửa lại" (returned), "Duyệt" (review), "Xuất" (approved), "Giao" (exported), "Xem bản xem trước" (delivered).
- **Tạo báo cáo** (`report-new`, hai bước): chọn dự án, mẫu, loại, tiêu đề, tác giả; sau đó soạn.
- **Trình soạn** (`report`): nội dung theo finding, biến thể "không có finding", phiên bản snapshot.
- **Xem trước** (`report-preview`): chế độ desktop hoặc PDF, phóng to, thu nhỏ.
- **Duyệt và xuất** (`report-review`): danh sách kiểm tra trước khi xuất:
  - Bằng chứng nhạy cảm đã được che.
  - Phiên bản ROE được tham chiếu.
  - Tên khách hàng và thương hiệu.
  - Bản xuất có checksum.
  - Giao nhận: kênh, người nhận, ngày xác nhận.
- Quy tắc: chỉ báo cáo đã duyệt và đã xuất mới được giao (PM-8).

### 3.12 Thành viên & duyệt (`team`, `approvals`)

- **Thành viên**: người dùng trong dự án, vai trò (admin, manager, operator, reviewer, analyst, viewer), ngày tham gia.
- **Hộp phê duyệt**: yêu cầu theo loại (kế hoạch, thay đổi ROE, thay đổi phạm vi, báo cáo, quyền truy cập phiên, ...), trạng thái (pending, approved, returned, withdrawn), người yêu cầu, người duyệt, ghi chú, diff.
- Người duyệt có thể duyệt, trả về kèm ghi chú, hoặc rút lại yêu cầu do chính mình tạo.

### 3.13 Nhật ký (`audit`)

Nhật ký bất biến của dự án: thời gian, người thực hiện, vai trò, hành động, đối tượng, kết quả, lý do, correlation ID.

- Lọc theo loại sự kiện: thao tác, phiên C2, HITL, phê duyệt, báo cáo, bằng chứng.
- Xuất có kiểm soát (ở Cài đặt).
- Sự kiện C2 của CyberStrikeAI đưa vào đây dưới dạng bộ lọc.

### 3.14 Cài đặt dự án (`settings`, `vault`, `governance`)

Sáu khối:
1. **Thông tin cơ bản**: tên, khách hàng, loại, chủ sở hữu, mô tả.
2. **Chính sách công cụ** (từ "Kiểm soát tool" của CyberStrikeAI): danh sách quy tắc chặn hoặc cho phép theo công cụ, có số lượng, trạng thái bật/tắt, người duyệt thay đổi.
3. **Chính sách HITL của dự án**: chiến lược duyệt (approval hoặc review_edit), danh sách trắng. Ghi đè chính sách mặc định toàn cục.
4. **Két bí mật** (Vault): các bí mật của dự án (loại, nhãn, người tạo, số lần đã hiển thị). Mỗi lần hiển thị được ghi nhật ký.
5. **Quản trị** (Governance): lịch chạy, lịch sử dừng khẩn, so sánh phiên bản kế hoạch khi cần.
6. **Vùng nguy hiểm**: lưu trữ, xóa, đổi trạng thái đóng dự án.

## 4. Trang con và luồng tạo (không có mục sidebar)

| Nhóm | Route | Mở từ đâu |
|---|---|---|
| Tạo | `project-new` | Nút "Tạo dự án" ở Dự án |
| Tạo | `operation-new` | Tổng quan dự án, Vận hành |
| Tạo | `asset-new` | Tài sản, Phạm vi |
| Tạo | `finding-new` | Phát hiện |
| Tạo | `report-new` | Báo cáo, Tổng quan dự án |
| Chi tiết | `project` | Dự án (bấm hàng) |
| Chi tiết | `operation` | Vận hành |
| Chi tiết | `asset` | Tài sản |
| Chi tiết | `finding` | Phát hiện |
| Chi tiết | `report` | Báo cáo |
| Chi tiết | `playbook`, `technique`, `playbook-review` | Thư viện |
| Chi tiết | `agent` | Hạ tầng |
| Chi tiết | `c2-session`, `c2-channel`, `c2-console` | Hạ tầng, Phiên C2 |
| Quy trình | `preflight`, `operation-schedule` | Vận hành |
| Quy trình | `report-preview`, `report-review` | Báo cáo |
| Quy trình | `ai-plan-review`, `ai-plan-compare` | Kế hoạch |
| Quy trình | `evidence-inspector` | Bằng chứng |
| Quy trình | `asset-scope` | Tài sản |
| Deep link | `ai-trace`, `ai-fanout`, `ai-branch`, `ai-history` | Không gian AI, Vận hành |

Ngoài ra: `login`, `forbidden`, `notfound`, `error`, `offline`, `session-expired` là trang hệ thống, không có trên sidebar. `states` (thư viện trạng thái), `scenarios`, `workspaces` là trang dev/demo, không đưa vào điều hướng production.

## 5. Trạng thái so với hiện tại

| Mảng | Có sẵn | Cần xây mới hoặc sửa |
|---|---|---|
| Tổng quan toàn cục | `a-dashboard` (mock) và `real/screens/overview` (real) | Gộp hai bản. Thêm hàng đợi "cần xử lý" xuyên dự án nếu chưa có. |
| Dự án | Portfolio, chi tiết dự án, wizard tạo | Giữ nguyên, chỉ đổi cách hiển thị tab. |
| Phát hiện | Đầy đủ các tab và quy trình | Không cần đổi lớn. |
| Tài sản | Thư viện, nhập, phạm vi | Thêm tab Tổng quan (phân bố, xu hướng, độ phủ quét). |
| Thư viện | Playbook, Profile, Kỹ thuật, Skill library, Đề xuất | Thêm tab Tri thức (mock). |
| Hạ tầng | Agent, C2 node, kênh, phiên | Thêm loại WebShell trong phiên (đã có `kind: web`, cần kiểm tra UI). |
| Không gian AI | Đầy đủ | Không cần đổi lớn. |
| Vận hành | Đầy đủ | Không cần làm canvas workflow. |
| Phân tích | Đầy đủ 4 tab | Không cần đổi. |
| Bằng chứng | Đầy đủ | Không cần đổi. |
| Báo cáo | Đầy đủ | Không cần đổi. |
| Thành viên & duyệt | Đầy đủ | Không cần đổi. |
| Nhật ký | Đầy đủ | Thêm bộ lọc loại sự kiện C2. |
| Cài đặt toàn cục | Users, roles, policies, profile | Thêm tab AI & mô hình và Chính sách mặc định. |
| Cài đặt dự án | Thông tin cơ bản, scope, governance, vault | Thêm chính sách công cụ (Tool Guard) nếu chưa có. |
| Payload | Không có | Không làm (theo quyết định). |
| Workflow canvas | Không có | Không làm (theo quyết định). |

## 6. Quy tắc thiết kế chung

1. Mỗi trang có `PageHeader` với tiêu đề và nút hành động ở cùng một vị trí.
2. KPI là đường dẫn: mỗi thẻ mở đúng trang hoặc tab chi tiết.
3. Trạng thái rỗng luôn có lý do và một hành động tiếp theo.
4. Hành động bị khóa phải hiện lý do ngay bên cạnh, không chỉ tooltip.
5. Quyền được kiểm tra ở cả giao diện và server. Không có quyền thì ẩn hoặc khóa, không để lộ dữ liệu.
6. Tab chỉ dùng khi cùng một đối tượng có nhiều góc nhìn.
7. Mỗi trang phải dùng được ở màn hình hẹp (raptix có kiểm thử responsive trong `screens/responsive-audit.test.tsx`) và có chế độ tối.

## 7. Thứ tự làm

Trạng thái sau đợt MVP (2026-10-22):
- Bước 1, 4, 5: đã làm. Bảng alias nằm ở `router/aliases.ts` (trang `command-center` → `overview`; `?tab=` theo từng chế độ). Sidebar toàn cục còn 7 mục, Báo cáo nằm trong tầng dự án.
- Bước 2: đã bỏ route `command-center`. Chưa gộp hai bản tổng quan: mock vẫn dùng `screens/a-dashboard.tsx`, real dùng `real/screens/overview.tsx`.
- Bước 3: chưa làm mới. Tổng quan real đã có KPI theo nguồn, hàng đợi và bảng dự án; mock chưa đổi.
- Bước 6–9: chưa làm (WebShell, Tri thức, AI & mô hình, Tổng quan Tài sản đều nằm ngoài phạm vi MVP).
- Trạng thái dự án thật theo contract (`ENGAGEMENT_STATUSES`): draft, planning, running, completed, failed. Danh sách draft/pending/approved/… ở §3 không có trong contract và không được dùng.
- Thêm đã làm: "Bước tiếp theo", readiness và lối tắt của tổng quan dự án real (`features/projects/views/workspace-status.tsx`, logic thuần ở `features/projects/workspace.ts`); nhãn giai đoạn ở tiêu đề dự án.

Thứ tự gốc của đề xuất:

1. Thống nhất model điều hướng cho mock và real (`shell/nav.ts`), có bảng alias.
2. Gộp `command-center` vào `overview`. Gộp hai bản tổng quan.
3. Tổng quan toàn cục: KPI, hàng đợi "cần xử lý", bảng dự án.
4. Sidebar dự án 14 mục, giữ alias `?tab=`.
5. Chuyển Báo cáo vào tầng dự án.
6. Thêm WebShell vào Phiên (kiểm tra UI của `kind: web`).
7. Thêm tab Tri thức (mock, chưa có backend).
8. Thêm tab AI & mô hình, Chính sách mặc định trong Cài đặt.
9. Thêm tab Tổng quan cho Tài sản.

Mỗi bước là một PR nhỏ, theo `CONTRIBUTING_AGENT.md`: không quá 400 dòng runtime, không quá 10 file, một mối quan tâm.

## 8. Câu hỏi còn mở

Đã chốt: bỏ Vai trò agent, bỏ thống kê lượt gọi skill, bỏ tab Cập nhật, Nhật ký C2 đưa vào Nhật ký toàn cục dưới dạng bộ lọc, Tri thức toàn cục chỉ làm tab mock.

Việc để sau (không nằm trong phạm vi hiện tại):
1. RAG cho Tri thức toàn cục, gồm tải tài liệu, lập chỉ mục, truy xuất và nhật ký truy xuất.
2. Bổ sung tài liệu MITRE ATT&CK và các tài liệu đã tổng hợp khác vào hệ thống.
3. Tab kiểm soát các specialist hiện có.
4. Độ tương phản dark mode: mục sidebar không active và liên kết breadcrumb hiển thị mờ trên nền tối (token có sẵn, đã thấy ở đợt kiểm chứng 2026-10-22, chưa đổi).
5. Gộp hai bản Tổng quan (mock `screens/a-dashboard.tsx`, real `real/screens/overview.tsx`) và tổng quan toàn cục theo §2.1.
