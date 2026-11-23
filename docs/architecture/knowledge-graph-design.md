# Knowledge graph và bằng chứng

Neo4j lưu dữ liệu tra cứu và quan sát của runtime. PostgreSQL lưu finding, snapshot bằng chứng và lịch sử xác minh của project. Mỗi tầng có nguồn dữ liệu riêng để giữ được bằng chứng đã duyệt khi graph thay đổi.

## Nguồn dữ liệu và chủ sở hữu

| Dữ liệu | Phạm vi | Nguồn chính |
| --- | --- | --- |
| Knowledge Reference Graph | Tài liệu tham chiếu dùng chung | Label `Krg*` trong Neo4j, do loader của `knowledge/reference/` quản lý |
| Runtime Graph (AKG) | Engagement hoặc project workspace | Node, edge và quan sát trong Neo4j |
| Skillogy | Corpus kỹ năng | Các label riêng trong Neo4j, do bộ dựng đồ thị kỹ năng quản lý |
| Knowledge Library | Danh mục, cấu hình và trạng thái nhập tài liệu hiển thị trên Web | Dịch vụ Knowledge Library của Web API, schema PostgreSQL và corpus đã đăng ký |
| Finding đã duyệt | Project | `ProjectFact`, `ProjectFactEvidence` và `ProjectFactVerification` trong PostgreSQL |

Knowledge Reference Graph, AKG và Skillogy dùng chung Neo4j với các tập label riêng. Một node `Technology` trong AKG lưu dấu hiệu nhận dạng và nguồn quan sát. Kết nối `RUNS` gắn công nghệ với `Service` hoặc `Host`. Một dấu hiệu nhận dạng có độ tin cậy thấp chỉ dùng để đối chiếu bằng chứng. [Kiểu dữ liệu KG](../../packages/raptix-core/raptix_core/types/kg.py) · [Schema Web API](../../apps/api/prisma/schema.prisma) · [Knowledge Library](../../apps/api/src/services/knowledge-library.ts)

## Nhập và đọc dữ liệu

- Loader của graph tham chiếu dùng schema và manifest của corpus để kiểm tra dữ liệu đầu vào. Label, quan hệ và constraint được định nghĩa trong migration.
- Runtime chuẩn hóa quan sát qua `knowledge/ingest/` trước khi ghi vào AKG. Các bản ghi giữ thông tin về nguồn và độ tin cậy.
- Web API phân giải project từ bản ghi đã lưu rồi truyền workspace slug đến runtime. Runtime kiểm tra xác thực và giới hạn truy vấn theo mẫu, phạm vi, số kết quả và thời gian xử lý. Nội dung trả về được xử lý như dữ liệu.
- Runtime dựng lại system message ở mỗi lần gọi model. Bản tóm tắt graph được chèn lại theo giới hạn của middleware. Compaction xử lý lịch sử message riêng.

[Loader tham chiếu](../../packages/raptix/raptix/knowledge/reference/loader.py) · [Migration Neo4j](../../packages/raptix/raptix/knowledge/graph/migrations/) · [Truy vấn runtime](../../packages/raptix/raptix/knowledge/graph/query.py) · [Middleware KG](../../packages/raptix/raptix/middleware/kg.py)

## Lưu finding và bằng chứng

1. Web API đọc quan sát trong phạm vi project. Khi có yêu cầu lưu finding, API kiểm tra lại quan sát và hash snapshot.
2. Fact store ghi finding và snapshot bằng chứng trong một transaction ở PostgreSQL.
3. Trạng thái xác minh có thể là `observed`, `proposed`, `verified`, `rejected` hoặc `stale`. Store đối chiếu revision khi đổi trạng thái và ghi lịch sử xác minh.

Snapshot là bản ghi đã dùng khi duyệt. Dữ liệu Neo4j có thể cập nhật sau đó trong khi PostgreSQL giữ bản đã lưu. Quy tắc RoE tiếp tục áp dụng cho mọi hành động mạng. [Luồng lưu finding](../../apps/api/src/services/fact-promotion.ts) · [Fact store](../../apps/api/src/db/fact-store.ts) · [Quy tắc chuyển trạng thái](../../apps/api/src/db/fact-verification.ts) · [RoE](../security/roe-machine-enforcement.md)

## Auto-capture theo project

Mỗi project lưu hai tùy chọn độc lập, `autoIngestEnabled` và `triedEdgesEnabled`. Cả hai mặc định tắt trong schema. API đọc giá trị từ project và truyền cấu hình khi tạo run. Thay đổi áp dụng cho run mới. Cấu hình này điều khiển các hook tự ghi AKG. [Schema project](../../apps/api/prisma/schema.prisma) · [Kiểm thử cấu hình theo run](../../packages/raptix/tests/unit/agents/test_project_graph_toggles.py)

## Kiểm thử và dữ liệu đối chiếu

- Kiểm thử truy vấn runtime kiểm tra giới hạn và phân tách phạm vi. [Graph query tests](../../packages/raptix/tests/unit/knowledge/test_graph_query.py)
- Kiểm thử HTTP kiểm tra luồng lưu finding, snapshot và xử lý revision xung đột. [Fact promotion tests](../../apps/api/tests/http/fact-promotion.routes.test.ts)
- Manifest corpus là đầu vào đối chiếu checksum của bài kiểm thử Knowledge Management. [Manifest](../../apps/api/tests/fixtures/graph-corpus-manifest.json) · [Integration test](../../apps/api/tests/integration/knowledge-management.live.ts)

Thiết kế ban đầu và các số đo của lần chạy ngày 2026-11-03 nằm trong `docs/design/2026-11-03-graph-technical-design.md` tại commit `8e5d356b`.
