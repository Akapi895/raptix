# Kế hoạch manual migrate theo phase — Security Platform V1

**Căn cứ:** `repository_structure_v1.md` đã chốt. Khi đưa vào repo, dùng bản kiến trúc tương ứng tại `docs/repository_structure.md` làm nguồn quyết định ownership.

**Mục tiêu:** migrate từng nhóm chức năng từ Strix/CyberStrikeAI sang backend Go, theo thứ tự phụ thuộc và tăng dần độ khó của lõi. Tài liệu chỉ quy định folder, mục tiêu và mốc hoàn thành; coding agent tự đọc repo gốc để chọn file và cách chuyển đổi.

## Cách sử dụng

- Làm tuần tự từng phase. “Hoàn thành folder” nghĩa là hoàn thành phạm vi của phase hiện tại; một folder có thể được mở rộng ở phase sau.
- Migrate hành vi phù hợp với kiến trúc đích. Có thể tách/gộp file nguồn; không cần giữ cấu trúc thư mục hoặc runtime của repo gốc.
- Không cần chọn một repo làm nguồn duy nhất. Ưu tiên đọc CyberStrikeAI cho phần Go, tích hợp model, catalog và MCP; ưu tiên đọc Strix cho content, agent loop, sandbox và verification. Đây là hướng tìm kiếm, không phải mapping file đã được kiểm chứng.
- Coding agent xác nhận khả năng thực tế trong phiên bản nguồn đang dùng. Phần nguồn không có hoặc không phù hợp thì viết mới theo kiến trúc V1.
- Backend/agent engine đích là Go; công cụ bên ngoài vẫn có thể dùng runtime riêng theo thiết kế sandbox.
- `app/`, migrations, API contracts và kiểm chứng liên quan được cập nhật cùng mỗi phase. Không để toàn bộ integration/test đến cuối.

> Trong các phase dưới, đường dẫn `engine/`, `tools/`, `execution/`, `workspace/`, `platform/`, `infrastructure/`, `app/`, `api/`, `cli/` đều nằm dưới `backend/internal/`.

## Phase 0 — Đối chiếu và lập danh sách migrate

**Folder:** `docs/`, `docs/adr/`.

- Đọc kiến trúc V1 và chốt commit nguồn của hai repo để đối chiếu ổn định.
- Lập danh sách ngắn: file/chức năng nguồn → folder đích → migrate, viết mới hoặc bỏ qua.
- Chỉ cần mapping đủ cho phase sắp làm; bổ sung dần khi đọc code.

**Xong khi:** coding agent xác định được phần nào lấy từ nguồn và phần nào phải viết mới; chưa thay đổi layout đã chốt.

## Phase 1 — Khung ứng dụng và kết nối lưu trữ

**Folder/file, theo thứ tự:** `backend/go.mod` → `configs/` → `infrastructure/database/` → `backend/migrations/` + `backend/cmd/migrate/` → `app/` + `backend/cmd/server/` + `api/` tối thiểu.

- Dựng backend Go, cấu hình, kết nối PostgreSQL và filesystem adapter.
- Dựng startup/shutdown, health endpoint và luồng migration.
- Thêm `Makefile`, `scripts/`, CI cơ bản và `deploy/compose.yaml` đủ để chạy môi trường phát triển.

**Nguồn đối chiếu:** CyberStrikeAI cho cách tổ chức ứng dụng Go; viết mới wiring và persistence theo kiến trúc đích.

**Xong khi:** backend build/chạy được, kết nối DB và chạy migration. Chưa cần agent hoặc công cụ bảo mật.

## Phase 2 — Content, catalog và model adapter

**Folder, theo thứ tự:** `contracts/manifests/` + `content/agents/` + `content/skills/` + `content/tools/` + `content/resources/` + `content/runtimes/` → `tools/output/` + `tools/registry/` → `engine/llm/` + `engine/llm/adapters/eino/`.

- Migrate một tập nhỏ profile, prompt, skill và manifest đủ cho luồng đầu tiên; chưa chuyển toàn bộ catalog.
- Hoàn thiện việc nạp/validate content, resolve version và contract tool output.
- Kết nối một model provider qua adapter Eino cho model call/streaming, theo đúng ranh giới V1.

**Nguồn đối chiếu:** Strix cho content; CyberStrikeAI cho registry, manifest và model integration. Agent tự xác nhận implementation tương ứng trong nguồn.

**Xong khi:** nạp được một profile/skill/tool manifest và gọi được model độc lập. Tool trong catalog chưa đồng nghĩa được phép chạy.

## Phase 3 — Dữ liệu lõi và quyền tối thiểu

**Folder, theo thứ tự:** `platform/projects/` + `platform/governance/` + `platform/audit/` + `content/policies/` → `engine/runs/` → `workspace/evidence/` → `workspace/assessment/` + `workspace/findings/`.

- Hoàn thiện project, scope, grant và audit đủ cho một run.
- Hoàn thiện lifecycle run/task/agent cơ bản, lưu evidence và observation.
- Có finding draft gắn evidence; chưa cần workflow review/report đầy đủ.
- Cập nhật repository và migration trong từng module theo ownership V1.

**Nguồn đối chiếu:** cả hai repo cho hành vi cần giữ; mô hình dữ liệu và persistence đích phải theo V1.

**Xong khi:** tạo/đọc được project và run, lưu artifact/observation/draft; các giới hạn quyền cơ bản có hiệu lực.

## Phase 4 — Một capability chạy qua execution

**Folder:** `tools/builtin/` + `tools/registry/` + `tools/output/`; `execution/invocation/` + `execution/sandbox/` + `execution/artifact/` + phần cancellation cơ bản trong `execution/cancel/`; `containers/sandbox/`; `evals/fixtures/`.

- Migrate một capability đơn giản và implementation cần thiết, chạy trong lab trước khi có agent tự điều khiển.
- Ghép registry với execution, sandbox và evidence; kiểm tra scope/grant/budget/trạng thái hủy tại dispatch.
- Có timeout/cancel cơ bản và raw/structured output. Hành động cần approval chưa được hỗ trợ thì chưa dispatch.
- Chuẩn bị lab/fixture có kết quả kỳ vọng để dùng tiếp ở phase 5.

**Nguồn đối chiếu:** Strix cho sandbox/tool interaction; CyberStrikeAI cho đăng ký và adapter capability.

**Xong khi:** gọi một tool từ ứng dụng qua execution, nhận kết quả và evidence; chạy được cả trường hợp thành công và lỗi cơ bản.

## Phase 5 — Một agent hoàn chỉnh, có verifier

**Folder, theo thứ tự:** `engine/contextbuild/` → `engine/agents/` + `engine/runs/` → `workspace/verifier/` + `workspace/findings/` + `workspace/assessment/`; mở rộng `evals/`.

- Migrate agent loop cho một agent: dựng context, gọi model, yêu cầu tool qua execution và nhận kết quả.
- Nối Requested/Available/Granted và content snapshot; context ban đầu dùng conversation cùng evidence, chưa cần memory nâng cao.
- Implement một loại verification, gắn verdict với evidence/finding revision; kiểm tra chủ động vẫn qua execution.
- Có runner, oracle và reset lab đủ để đánh giá luồng đầu tiên. Điểm khởi chạy dùng kế hoạch tối thiểu, chưa cần spawn nhiều agent.

**Nguồn đối chiếu:** ưu tiên Strix cho agent loop, context và validation; tận dụng adapter Go đã có từ các phase trước.

**Xong khi:** một run đi từ task → agent → tool → evidence/observation → verifier → finding draft có căn cứ, đánh giá được trên lab.

## Phase 6 — Độ tin cậy của execution và run

**Folder:** `execution/cancel/`, `execution/invocation/`, `execution/artifact/`, `engine/runs/`, `engine/agents/`, `workspace/evidence/`, `backend/tests/integration/`.

- Hoàn thiện cancel/restart, đối soát invocation và xử lý trạng thái chưa rõ kết quả.
- Kiểm soát retry để không thực thi lặp hoạt động ngoài; giữ nhất quán lifecycle và artifact.
- Đối chiếu cách nguồn xử lý lỗi, nhưng triển khai phục hồi theo PostgreSQL và ownership của V1.

**Xong khi:** luồng phase 5 chịu được hủy và restart; không mặc nhiên báo thành công hoặc chạy lại tool khi chưa biết kết quả lần trước.

## Phase 7 — API, CLI và giao diện sử dụng cơ bản

**Folder/file, theo thứ tự:** `contracts/openapi.yaml` + `contracts/events/` → `api/handlers/` + `api/middleware/` + `api/sse/` → `backend/cmd/cli/` + `cli/` → `web/src/shared/` + `web/src/app/` + các feature project/run/evidence/finding.

- Mở các use case đã chạy ổn qua API và stream tiến độ.
- Implement CLI dạng client của server; thêm UI tối thiểu để tạo, xem, hủy run và đọc kết quả.
- Hoàn thiện đăng nhập/phân quyền qua transport trước khi dùng với nhiều người dùng.

**Nguồn đối chiếu:** cả hai repo cho hành vi CLI/API và cách trình bày; UI đích theo React/TypeScript của V1.

**Xong khi:** CLI và web cùng thao tác một run trên server, hiển thị đúng dữ liệu đã lưu. Chưa cần inspector và dashboard đầy đủ.

## Phase 8 — Review, báo cáo và background jobs

**Folder, theo thứ tự:** `workspace/findings/` → `infrastructure/jobs/` + `workspace/reporting/` → `content/templates/findings/` + `content/templates/reports/` → API/CLI/UI liên quan.

- Mở rộng review history, finding revision và report snapshot.
- Dùng River cho report/background job phù hợp, nối kết quả về evidence.
- Migrate template và trải nghiệm xuất báo cáo cần thiết.

**Nguồn đối chiếu:** cả hai repo cho finding/report; transaction và job ownership theo kiến trúc V1.

**Xong khi:** review một kết quả và tạo báo cáo từ snapshot; retry job không tạo kết quả nghiệp vụ trùng.

## Phase 9 — Memory, knowledge và context mở rộng

**Folder:** `engine/memory/` → `engine/knowledge/` + `content/knowledge/` → `engine/contextbuild/`; mở rộng `content/skills/` và `content/resources/` khi cần.

- Migrate cơ chế lưu/đọc thông tin phục vụ reasoning, retrieval và quản lý context phù hợp.
- Giữ namespace, source refs, expiry và quyền chia sẻ; phân biệt memory với evidence và finding.
- Mở rộng từ một agent đã chạy ổn; so sánh kết quả với baseline phase 5–6.

**Nguồn đối chiếu:** đọc cả hai repo và chọn phần có bằng chứng hoạt động phù hợp; không mặc định phải chuyển nguyên cơ chế memory của nguồn.

**Xong khi:** agent sử dụng được memory/knowledge đúng phạm vi và truy lại được nguồn thông tin đã dùng.

## Phase 10 — Điều phối nhiều agent

**Folder:** `engine/orchestrator/` → mở rộng `engine/runs/` + `engine/agents/` + capability liên quan trong `tools/builtin/`; cập nhật `workspace/assessment/`, agent inspector và `evals/`.

- Migrate phân công task, spawn, handoff/message và hợp nhất kết quả.
- Tách dependency task khỏi cây agent; quản lý budget/concurrency và tránh trùng mà vẫn giữ verification độc lập.
- Giữ quyền plan/replan/lifecycle ở ứng dụng, đúng ranh giới Eino trong V1.

**Nguồn đối chiếu:** Strix cho phối hợp agent; CyberStrikeAI cho cách tổ chức orchestration. Chọn hành vi phù hợp, không ghép hai vòng điều phối độc lập.

**Xong khi:** một run nhiều agent hoàn thành task có evidence, xử lý được child lỗi/hủy, và có kết quả so sánh với baseline một agent.

## Phase 11 — Tích hợp mở rộng và hoàn thiện bản phát hành

**Folder:** `platform/vault/`, `tools/mcp/`, `tools/guard/`, `tools/hitl/`, các manifest/skill bổ sung; UI inspector/approval/settings; `containers/app/`, `deploy/`, `.github/workflows/`, `docs/authoring/`.

- Migrate lần lượt credential/session grey-box, external MCP, policy/HITL nâng cao và tool bổ sung như CVE search.
- Thêm một integration tại một thời điểm, tiếp tục đi qua execution và ownership đã có.
- Hoàn thiện đóng gói binary/web/content, tài liệu vận hành và kiểm chứng phát hành. Các phần build/test/deploy cơ bản đã được làm từ trước.

**Nguồn đối chiếu:** ưu tiên CyberStrikeAI cho MCP/catalog/integration, Strix cho capability và skill cần bổ sung; viết mới phần không có trong nguồn.

**Xong khi:** các integration đã chọn hoạt động xuyên suốt và bản phát hành tái dựng/chạy được theo tài liệu. Chỉ migrate tập công cụ cần cho V1.

## Chỉ dẫn ngắn cho coding agent ở mỗi phase

1. Đọc phase hiện tại, kiến trúc V1 và những file nguồn liên quan, bao gồm dependency của chúng.
2. Chọn file/chức năng cần migrate; xác định folder đích trước khi sửa.
3. Chuyển từng phần nhỏ sang contract Go của hệ thống, nối vào wiring hiện có.
4. Kiểm chứng phạm vi vừa thay đổi và mốc hoàn thành phase.
5. Ghi ngắn: đã migrate gì, viết mới gì, khác nguồn ở đâu và còn thiếu gì.

Không cần hoàn thiện toàn bộ engine, toàn bộ UI hoặc toàn bộ catalog trước khi chạy luồng đầu tiên. Mốc quan trọng đầu tiên là phase 5; phase 6 làm luồng đó đủ tin cậy để tiếp tục mở rộng.
