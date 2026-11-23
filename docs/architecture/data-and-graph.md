# Dữ liệu, graph và ranh giới dịch vụ

Raptix dùng 2 kho dữ liệu: **Neo4j** cho mọi quan sát dạng graph (3 graph
khác nhau cùng chia sẻ một server, phân tách bằng label) và **PostgreSQL**
cho bản ghi nghiệp vụ mà Web cần toàn vẹn giao dịch (project, finding đã
duyệt, bằng chứng, workflow). Nguyên tắc chốt: **Neo4j giữ quan sát thô,
PostgreSQL giữ cái đã được duyệt/xác minh** — một sự kiện trong Neo4j có
thể bị ghi chồng bởi quan sát mới hơn, một bản ghi trong PostgreSQL thì
không.

## Ba graph, một Neo4j

| Graph | Phạm vi | Ai ghi | Ai đọc |
| --- | --- | --- | --- |
| **Knowledge Reference Graph** | Corpus tham chiếu dùng chung (CWE/CAPEC/MITRE ATT&CK...), label `Krg*` | `knowledge/reference/loader.py` nạp 1 lần từ YAML + manifest | Tool `kg_query_reference` |
| **Attack Chain Graph (AKG)** | Theo từng engagement/project — đây là "bộ nhớ làm việc" của agent | `KGStore` qua tool `kg_record`/`kg_ingest`, các parser dưới `knowledge/ingest/parsers/` | `KGMiddleware` (tóm tắt chèn vào system prompt mỗi lượt gọi model), tool `kg_query` |
| **Skillogy** | Corpus kỹ năng (SKILL.md) | Bộ dựng graph `skills/engine/builder/` ghi file Cypher tĩnh, seed vào Neo4j lúc container khởi động | `SkillogyMiddleware`, tool `find_skill`/`load_skill`/`traverse` — xem chi tiết ở [Skills và Skillogy](skills-and-skillogy.md) |

Ba graph này **dùng chung một Neo4j container** (`docker-compose.yml`,
service `neo4j`) — `langgraph`, `api` và `skillogy` đều kết nối tới
`bolt://neo4j:7687` bằng cùng một cặp user/password. Sự tách biệt hoàn
toàn nằm ở **tập label**, không phải ở network hay instance. BloodHound
CE (dùng cho chuyên gia AD) là ngoại lệ duy nhất: nó có **Neo4j riêng**
(`bhce-neo4j`, profile `ad`) vì Neo4j Community Edition chỉ cho 1 database
mỗi server — `KGStore` đã chiếm database đó, nên BHCE không thể dùng
chung mà không đụng label/constraint (xem [quyết định 1](../decisions/01-bloodhound-via-bhce-rest-client.md)).

Vì sao gộp 3 graph vào 1 server mà không tách riêng từng cái — xem
[quyết định 11](../decisions/11-project-scoped-graph-retrieval-and-promotion.md):
tránh có một bản sao thứ hai của toàn bộ runtime graph, và tránh để agent
chạy Cypher tự do (chỉ expose qua các tool/route có truy vấn giới hạn
sẵn).

## Schema của Attack Chain Graph

`packages/raptix-core/raptix_core/types/kg.py` định nghĩa `NodeKind`
(label Neo4j, PascalCase) và `EdgeKind` (relationship type, UPPER_CASE).
Node chia 7 nhóm:

- **Hạ tầng**: `Host`, `Network`, `Domain`, `Service`, `URL`, `CloudResource`, `Container`
- **Danh tính**: `User`, `Group`, `Credential`, `Secret`, `Session`
- **Lỗ hổng**: `Vulnerability`, `CVE`, `Misconfiguration`, `Weakness`
- **Mã nguồn**: `Repository`, `SourceFile`, `CodeLocation`, `Contract` (+ các node riêng cho Solidity: `Function`, `StateVar`, `Event`...)
- **Tiến trình tấn công**: `Technique`, `Entrypoint`, `CrownJewel`, `AttackPath`, `Finding`
- **Phân tích**: `Candidate`, `Hypothesis`, `Patch`
- **Phòng thủ (Blue Cell)**: `DetectionFired`, `DefenseAction`

Cộng thêm một khối lớn node/edge riêng cho Active Directory (mirror schema
BloodHound 5.x: `ADUser`, `ADComputer`, `ADCertTemplate`... và các edge
ADCS `ADCS_ESC1`...`ESC16`, `DCSYNC`, `GOLDEN_CERT`...), và `Technology` —
một node kiểu riêng cho sản phẩm/runtime phát hiện được trên một `Service`
hoặc `Host` qua cạnh `RUNS` (thêm vì lý do cụ thể, xem
[quyết định 2](../decisions/02-ai-surface-technology-node.md): trước đó một
cổng như Ollama 11434 chỉ được ghi thành `Service{service=unknown}`,
không thể truy vấn theo loại công nghệ).

## `KGStore` — ghi/đọc có kiểm soát

`packages/raptix/raptix/knowledge/graph/store.py` là đường ghi/đọc Neo4j
duy nhất của AKG:

- Mọi lệnh Cypher gọi qua `execute_read`/`execute_write` đều bị
  `_check_scoped_cypher` kiểm tra phải chứa tham số `$engagement` — đây là
  rào kỹ thuật, không phải quy ước: không thể vô tình viết một truy vấn
  tràn phạm vi sang engagement khác.
- `record_observations` là đường ghi batch nguyên tử phía sau tool
  `kg_record`: tự gắn `engagement`, `firstseen`, `lastupdated`,
  `created_by`, kênh nguồn (`provenance_channel`); băm SHA-256 giá trị
  credential trước khi ghi; và áp **thứ hạng tin cậy** (`trust_rank`) —
  một ghi từ parser (tin cậy cao) có thể ghi đè ghi từ agent tự khai báo
  (tin cậy thấp), nhưng không có chiều ngược lại.
- Mỗi lần ghi đều tăng một counter `KGRevision{scope: engagement}` trong
  cùng transaction — đây là tín hiệu để `KGMiddleware` biết khi nào cần
  dựng lại bản tóm tắt graph, tránh phải query lại toàn bộ mỗi lượt.
- Các node mang "asset" (`Host`, `Entrypoint`) được gắn `asset_id` xác
  định (deterministic) theo [quyết định 6](../decisions/06-asset-identity-authority.md)
  — PostgreSQL mới là nguồn chân lý của danh tính asset, Neo4j chỉ giữ
  quan hệ quan sát gắn với ID đó.

## Nạp dữ liệu (ingest)

`knowledge/ingest/parsers/` có sẵn adapter cho nhiều công cụ recon/scan:
`masscan`, `nmap_xml`, `nuclei_jsonl`, `httpx_jsonl`, `dnsx`, `ffuf`,
`gobuster`, `subfinder`, `testssl`, `crackmapexec`, `slither_json`,
`sqlmap_log`... Ví dụ `masscan.py` parse output `masscan -oJ` và phát ra
cặp quan sát `Host -[:EXPOSES]-> Service -[:HOSTS]-> Host`, gắn
`source: "masscan"`.

Tool `kg_record`/`kg_ingest` mà agent gọi **không** nhận `engagement` từ
chính LLM — giá trị này được middleware tiêm vào qua state và server
validate lại (chủ động phòng một bug đã biết của LangChain,
`langchain-ai/langchain#31688`), nên model không thể tự xưng mình đang ở
engagement nào khác.

## `KGMiddleware` — đưa graph vào context của agent

`packages/raptix/raptix/middleware/kg.py` là phía đọc chính: trước mỗi
lượt gọi model, nó lấy `store.revision()`; nếu đã tăng so với lần trước,
dựng lại một bản tóm tắt markdown ngắn (15-25 dòng — top 5 lỗ hổng theo
độ nghiêm trọng, tối đa 3 entrypoint chưa khai thác, crown jewel kèm số
hop ngắn nhất) và tiêm vào system message. Thiết kế **luôn tiêm lại mỗi
lượt** (không bỏ qua khi revision không đổi) là quyết định có chủ đích
trong 0108 — nếu bỏ qua, model sẽ "mù" với graph đúng ở lượt đó vì không
có cơ chế nào khác mang bản tóm tắt đi tiếp.

## PostgreSQL — nơi giữ cái đã được duyệt

`apps/api` sở hữu toàn bộ bản ghi nghiệp vụ: project, liên kết
conversation↔thread runtime, và quan trọng nhất — **finding đã duyệt**
(`ProjectFact`, `ProjectFactEvidence`, `ProjectFactVerification`). Luồng
lưu finding gồm 3 bước nguyên tử: (1) Web API đọc lại quan sát trong
Neo4j theo phạm vi project và băm snapshot bằng chứng, (2) ghi finding +
snapshot bằng chứng trong một transaction Postgres, (3) trạng thái xác
minh (`observed`/`proposed`/`verified`/`rejected`/`stale`) được cập nhật
có kiểm tra revision (compare-and-set) để tránh ghi đè đồng thời.

Vì sao finding **không bao giờ** ghi lại vào Neo4j: snapshot phải là bản
cố định đã dùng để duyệt, trong khi Neo4j có thể tiếp tục thay đổi — tách
hai nơi giữ hai thứ khác nhau thay vì để Postgres chạy theo một graph
đang di chuyển.

Mỗi project có 2 cờ độc lập, mặc định tắt: `autoIngestEnabled` (tự ghi
quan sát recon vào AKG) và `triedEdgesEnabled`. Bật/tắt chỉ ảnh hưởng run
mới, không hồi tố.

## An toàn Neo4j (tóm tắt — chi tiết ở [neo4j-hardening.md](../security/neo4j-hardening.md))

Container `neo4j` **dual-homed** trên cả `sandbox-net` và `raptix-net` để
orchestrator phía management đọc được dữ liệu agent ghi từ trong sandbox
— nhưng đây cũng là cầu nối duy nhất mà một payload prompt-injection
trong sandbox có thể lợi dụng để vươn sang management. Vì vậy APOC chỉ mở
theo **allowlist** (các hàm `coll`/`text`/`path`/`create`/`merge`/
`refactor`...), toàn bộ APOC file-I/O và cross-database bị tắt hẳn (từng
có CVE-2021-34371 khai thác đúng đường này), và Neo4j refuse boot nếu gặp
key config lạ (chặn việc vô tình gõ sai `unrestricted` mà mở lại lỗ hổng).

## Web ↔ Runtime

`apps/ui-app` (console) nói chuyện với `apps/api` (BFF dịch hợp đồng
OpenAPI của ui-app sang domain model Raptix — lý do có lớp dịch riêng
này, xem [quyết định 10](../decisions/10-retire-apps-web-for-ui-app-and-api.md)),
`apps/api` xác thực với runtime Python bằng token phía server
(`RAPTIX_RUNTIME_API_TOKEN_FILE` — chỉ `apps/api` được giữ, `apps/ui-app`
không bao giờ nhận). Trạng thái các route hiện tại:

| Khu vực | Trạng thái |
| --- | --- |
| Project, conversation | Đã có, gắn với thread runtime |
| Chat, batch run | Đã có qua runtime transport |
| File, phê duyệt | Đã có qua project sandbox; phê duyệt cần bật policy HITL |
| Finding, bằng chứng graph | Đã có — API giới hạn đọc theo project, lưu bằng chứng ở Postgres |
| Workflow | Route CRUD đã có; route thực thi trả `501` (chủ động chưa làm, không phải bug) |

Thiết kế gốc và các tier quyết định ban đầu của việc tích hợp
`apps/ui-app` nằm ở Git, không còn trong cây docs hiện tại (tham khảo
lịch sử commit nếu cần).
