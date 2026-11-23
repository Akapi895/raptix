# 1. Tích hợp BloodHound qua REST API chính thức của BHCE, không tự xây lại

## Bối cảnh

`tools/ad/` hiện đang làm 2 việc tự xây dựng nội bộ:

1. Đọc file ZIP/JSON từ SharpHound và ghi vào Neo4j riêng của mình
   ("KGStore") qua `merge_bloodhound_json`/`ingest_bloodhound_zip`.
2. Tự cài lại logic `PostProcessedRelationships` của BloodHound Community
   Edition bằng Python/Cypher: ADCS ESC1/3/4/6/9/13, GoldenCert, DCSync,
   TrustedForNTAuth, cộng thêm ingest riêng cho từng edge SPNTargets,
   DumpSMSAPassword, HasSIDHistory, RootCA→Domain, v.v.

Đây là gánh nặng duy trì liên tục so với upstream đang thay đổi nhanh
(BHCE ra v9.2.2 ngày 2026-06-01; loại ESC mới, đổi tên edge, và key
Properties mới xuất hiện mỗi bản release). Mỗi edge tự viết cần 1 vòng
RFC, 1 lần kiểm regex, 1 lần dogfood, và 1 PR — mà kết quả vẫn thua phân
tích của BHCE. Cộng đồng đã có câu trả lời được công nhận: BloodHound CE
có REST API chính thức với request ký HMAC, và SpecterOps công bố 1 MCP
wrapper cộng đồng (`mwnickerson/bloodhound_mcp`) chứng minh surface này
đủ cho việc dùng agent.

Chỉ đạo từ chủ dự án (2026-06-05): tool surface AD phải gọi
**BloodHound thật**, không phải bản tự viết lại. MCP cộng đồng chỉ là
tài liệu tham khảo nhiều nhất; nguồn chính là mã nguồn và OpenAPI spec
của chính BHCE.

## Quyết định

Thay toàn bộ lớp BloodHound tự xây bằng 1 client Python mỏng, gọi tới
BHCE chạy sidecar qua REST API chính thức. 3 quyết định con cụ thể:

1. **(Y) Chạy BHCE trên 1 container Neo4j riêng, dùng lại Postgres sẵn
   có.** Neo4j Community Edition chỉ cho 1 database người dùng, và
   KGStore đã chiếm nó rồi; thêm container `raptix-bhce-neo4j` (Neo4j
   4.4.42 hoặc 5.x — tùy driver `dawgs` của BHCE hỗ trợ bản nào làm
   primary) cộng container `raptix-bhce-api` chạy
   `ghcr.io/specterops/bloodhound:v9.2.2`. API của BHCE trỏ vào
   Postgres hiện có (database `bloodhound`, extension `pg_trgm` đã tạo
   sẵn) qua `bhe_database_connection`, và vào Neo4j mới qua
   `bhe_neo4j_connection`. Migration của BHCE (`goose`) tự bootstrap
   lúc boot lần đầu.

2. **(Q) Chuyển đổi theo giai đoạn.** 1 surface mới `tools/ad/bh_*` dựa
   trên REST client xuất hiện song song với tool cũ. Các tool cũ
   `bh_ingest_zip`, `bh_ingest_json`, `dcsync_check`, `delegation_audit`,
   `gpo_audit`, `adcs_audit`, cộng toàn bộ pipeline post-process
   `adcs_post.py` mang `DeprecationWarning` trong 1 minor cycle, rồi
   chuyển vào `decepticon.compat` thêm 1 cycle nữa, sau đó bị xóa (vì
   đang ở pre-1.0; áp dụng theo chính sách shim `compat/` trong
   CLAUDE.md).

3. **(M2) Tự viết 1 Python client nhắm vào REST surface chính thức của
   BHCE; KHÔNG vendor hay chạy subprocess MCP cộng đồng.** Client nhắm
   vào spec OpenAPI 3.0.3 v9.2.2 đóng gói tại
   `packages/go/openapi/src/openapi.yaml` trong repo BHCE (cũng truy
   cập được lúc runtime qua `GET /api/v2/spec` dạng `text/x-yaml`,
   không cần auth). Mọi endpoint, header, và bước ký đều bắt nguồn từ
   mã nguồn BHCE, không từ MCP cộng đồng. *Hình dạng interface* của MCP
   cộng đồng (13 tool tổng hợp, 10 tài liệu markdown) được phép dùng
   làm cảm hứng cho cách nhóm `@tool` trong `tools/ad/bh_*`, nhưng không
   lấy bất kỳ thông tin thực tế nào từ nó. Tài liệu muốn có cho context
   của agent (`cypher/offensive-queries`, `guides/adcs-methodology`...)
   được vendor từ trang docs chính thức của SpecterOps
   (`bloodhound.specterops.io`) thay vì từ repo cộng đồng.

### Thông tin xác thực client phải mã hóa đúng (có trích nguồn)

Lấy từ BHCE v9.2.2 (`/tmp/bhce-clone/`), phải được ghim vào test của
client:

- **Chuỗi HMAC** (`cmd/api/src/api/signature.go:97-145`): 3 tầng
  HMAC-SHA-256. `OperationKey = HMAC(token_secret, METHOD || URI)`;
  `DateKey = HMAC(OperationKey, RFC3339_truncated_to_hour)`;
  `BodyKey = HMAC(DateKey, body_bytes)`; signature = `base64(BodyKey)`.
  Body rỗng vẫn chạy tầng HMAC thứ 3.
- **Header bắt buộc** (`signature.go:169-171`):
  `Authorization: bhesignature <TOKEN_ID>`,
  `RequestDate: <RFC3339 full datetime>`, `Signature: <base64 BodyKey>`.
  Lưu ý: chuỗi ngày đưa vào signature bị cắt theo giờ; header thật là
  RFC3339 đầy đủ.
- **Cửa sổ lệch giờ**: ±1 giờ (`cmd/api/src/api/auth.go:276-296`,
  `maxClockSkew = time.Hour`). Trang docs diễn đạt là "2 giờ"; code mới
  là đúng.
- **Cypher**: `POST /api/v2/graphs/cypher` với
  `{query: string, include_properties: bool}` — KHÔNG phải
  `/api/v2/cypher`. Mount tại `cmd/api/src/api/registration/v2.go:217`.
- **Upload file (ingest SharpHound)** là luồng 3 bước + polling:
  `POST /api/v2/file-upload/start` → `POST /api/v2/file-upload/{job_id}`
  (Content-Type ∈ {`application/json`, `application/zip`,
  `application/zip-compressed`, `application/x-zip-compressed`}) →
  `POST /api/v2/file-upload/{job_id}/end`. Kiểm tra trạng thái qua
  `GET /api/v2/file-upload/{job_id}`. Không có webhook/SSE.
- **CRUD token**: tạo `POST /api/v2/tokens`, list `GET /api/v2/tokens`,
  revoke `DELETE /api/v2/tokens/{token_id}` (`registration/v2.go:108-110`).
- **OpenAPI**: 3.0.3, 223 path dưới `/api/v2/*`, phục vụ tại
  `GET /api/v2/spec`. Ghim theo bản vendor của spec v9.2.2 để phát hiện
  lệch upstream trong CI.

## Hệ quả

- **Dễ hơn**
  - Có 1 nguồn chân lý duy nhất cho phân tích ADCS/ESC: chính BHCE, do
    SpecterOps duy trì. Codebase không còn phải mang Cypher
    ESC1/3/4/6/9/13.
  - Tin tưởng xuyên team: người dùng red-team đã quen hình dạng output
    của BloodHound; dùng lại cho ra finding dễ nhận biết hơn là tự chế.
  - Ngữ nghĩa ingest của SharpHound (file JSON theo từng loại, Trust
    4-way split, bẫy PrimaryGroupSID...) trở thành việc của BHCE, không
    còn là việc của mình.
  - Cypher passthrough cho phép agent thử nghiệm truy vấn attack-path
    trên 1 schema đã quen.

- **Khó hơn**
  - Tăng độ phức tạp deploy: thêm 1 container API và 1 container Neo4j.
    Luồng smoke/dogfood cần cập nhật để chờ health của BHCE
    (`GET /api/version`) và seed token HMAC lúc boot lần đầu.
  - Join xuyên graph (AD ↔ web ↔ cloud ↔ smart-contract) không còn xảy
    ra trong 1 session Cypher — graph của BHCE và graph của KGStore
    tách biệt vật lý. Workflow chain-planner từng join `:HasVuln` (web)
    với `:AdminTo` (AD) phải chuyển sang mirror finding của BHCE vào
    phía KGStore, hoặc chấp nhận kế hoạch 2 bước.
  - Xoay token HMAC, lưu secret, và bootstrap mật khẩu admin của BHCE
    gia nhập diện tích quản lý secret.

- **Đánh đổi**
  - Không còn tự viết Cypher mới cho ADCS/SIDHistory/GMSA trong repo.
  - Không còn coi KGStore là nguồn chân lý AD duy nhất.
  - Bất biến "Neo4j là dịch vụ chia sẻ chủ đích duy nhất" của
    `raptix-net` nới ra thành "2 instance Neo4j, cả 2 trong `raptix-net`,
    vai trò khác nhau" — CLAUDE.md cần sửa theo sau.

- **Lịch trình chuyển đổi**
  - Sprint 1: PR #2 compose stack (BHCE API + Neo4j + bootstrap
    Postgres), PR #3 `bhce_client.py` + vector test HMAC, PR #4 surface
    `@tool` LangChain cho `tools/ad/bh_*`, PR #5 vendor docs/resources
    từ `bloodhound.specterops.io`.
  - Sprint 2: PR #6 `DeprecationWarning` cho `tools/ad/*` cũ (1 minor
    cycle chồng lấp), cập nhật CLAUDE.md và `docs/architecture.md`.
  - Sprint 3 (minor tiếp theo sau Sprint 2): chuyển tool cũ vào
    `decepticon.compat`. Minor sau đó: xóa cứng.

## Phương án đã xem xét và loại bỏ

- **(X) Chạy BHCE trên Neo4j hiện có bằng cách nâng lên Neo4j
  Enterprise.** Loại: chi phí license cho người dùng OSS (triết lý
  curl|bash install trong CLAUDE.md), không có lợi gì hơn ngoài tránh
  thêm 1 container.
- **(Z) Dùng Neo4j của BHCE làm Neo4j duy nhất, chuyển state
  web/cloud của KGStore vào cùng database.** Loại: driver `dawgs` của
  BHCE sở hữu schema; tính duy nhất `(key, engagement)` và label
  xuyên-domain của KGStore sẽ đụng constraint `:User`/`:Computer` của
  BHCE hoặc tranh quyền migration của BHCE mỗi bản release.
- **(P) Xóa cứng lớp AD tự xây trong 1 PR duy nhất.** Loại: xóa mất
  ~5 ngày công việc đã merge mà không cho agent downstream kịp chuyển
  call site. Chính sách shim `compat/` có sẵn cho đúng trường hợp này.
- **(R) Chạy cả 2 surface song song vô thời hạn.** Loại: output ESC*
  tự xây và của BHCE sẽ lệch dần (trọng số edge khác, thiếu edge, nguồn
  gốc `via_*` khác), và agent không có quy tắc rõ ràng để biết tin cái
  nào. Chi phí duy trì nhân đôi.
- **(M1) Nhúng `mwnickerson/bloodhound_mcp` như subprocess MCP stdio và
  để `langchain-mcp-adapters` lộ 13 tool tổng hợp của nó.** Loại: thêm
  phụ thuộc ngoài vào 1 wrapper cộng đồng không do SpecterOps sở hữu
  (GPL-3.0 so với Apache-2.0 OSS của Raptix — cần review license), glue
  stdio khó debug hơn, và vẫn cần 1 Python REST client cho workflow
  `file-upload` mà MCP không lộ rõ. Hình dạng tool tổng hợp của MCP chỉ
  được phép làm cảm hứng, không phải phụ thuộc cốt lõi.
