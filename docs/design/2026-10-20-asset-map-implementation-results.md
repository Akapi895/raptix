# Asset Map: kết quả kiểm chứng theo phase

- **Plan:** [implementation plan](2026-10-20-asset-map-implementation-plan.md)
- **Branch:** `asset-map`. Không push, không mở PR.
- **Trailer commit:** các commit từ lượt cuối (fe6f) có `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`, theo chỉ dẫn hệ thống. Các commit trước đó không có trailer; lịch sử không bị viết lại.
- **Lượt này (fe6f):** từ `b83426b9` đến commit cuối của nhánh (`git log b83426b9..HEAD`). Năm mục được yêu cầu: mục 1 (lookup/index), mục 2 (capture theo phiên bản, XML/JSONL), mục 3 (web_url → origin), mục 4 (saved view và camera), mục 5 (controls trên browser).
- **Triển khai:** API và UI build từ `53a1bebf`; runtime build từ `234d0bd8`. Đã áp dụng migration V007. Postgres và Neo4j không được tạo lại.
- **Máy đo:** Windows 11, Intel Core i9-13900HX, Docker Desktop. Neo4j Community 5.26.28 của stack web (heap tối đa 256 MB, transaction tối đa 179 MiB), PostgreSQL 16.

## Kết luận lượt này

| Mục | Kết quả | Ghi chú |
|---|---|---|
| 1. Lookup/index | **Đạt** | Truy vấn có label, V007 đã online. Baseline và stress 10.000 host đều dưới 500 ms với dữ liệu khác cùng tồn tại trong database. |
| 2. Capture theo phiên bản, XML/JSONL | **Đạt** | Đã kiểm chứng trên dữ liệu thật: nối đúng phiên bản, replay idempotent, đổi nội dung cùng path không nối nhầm, download khớp digest. |
| 3. web_url → origin overlay | **Đạt** | Finding của Juice Shop xuất hiện ở origin overlay. Bảng vector chung giữa Python và TypeScript. |
| 4. Saved view scope và camera | **Đạt** | Lỗi ghi chéo giữa hai project đã sửa. Browser khôi phục đúng zoom và pan đã đặt khác mặc định. Pin vẫn deferred. |
| 5. Controls trên browser | **Chưa đạt** | Kiểm được: panel, refusal, foreign-run 404, Execution và deep link. **Chưa kiểm được** pause/resume/cancel trên run sống, vì lab chưa có run nào được phép chạy. Xem phần 5. |

**Pilot:** pilot opt-in *đọc* network/web trên dữ liệu thật đáp ứng mục 1–4. Pilot có *điều khiển run* chưa sẵn sàng, vì còn blocker ở mục 5. Ngoài ra, bootstrap KG hiện không chạy được ở kích thước dữ liệu hiện tại (xem phần "Phát hiện"). Cờ Asset Map vẫn tắt mặc định; Execution và deep link cũ vẫn hoạt động; không cutover.

## Commit của lượt này

| Commit | Nội dung | Mục |
|---|---|---|
| `f2dfadf4` | Runtime: observation của file workspace mang digest của đúng bytes được parse | 2 |
| `3e037b93` | Web và migration V007: label cho lookup, index composite không unique, origin mapping cho web_url, evidence nối theo phiên bản, XML/JSONL | 1, 2, 3 |
| `10182ab2` | Web: trang Asset Map được key theo user và project; browser check camera nạp lại sau reload | 4 |
| `53a1bebf` | Web: stop hiển thị "requested" cho đến khi runtime báo run đã kết thúc | 5 |
| `234d0bd8` | Runtime: migration chạy không tăng revision counter (lỗi phát hiện khi triển khai) | 1 |
| `330602c6` | Web: browser check run controls và Execution | 5 |

## Trạng thái theo phase

| Phase | Trạng thái | Ghi chú |
|---|---|---|
| 1. Identity và ranh giới | **Đạt** | Không đổi trong lượt này. |
| 2. Chuẩn hóa đường ghi | **Đạt cho các ca đã kiểm chứng** | Chỉ nmap có test tương đương giữa adapter legacy và parser registry. Các parser khác chưa có test tương đương. |
| 3. Read model | **Đạt** cho baseline 1.000 host và stress 10.000 host | Revision là một lookup; cursor gắn revision; pagination có completeness. |
| 4. Detail và view theo domain | **Đạt cho network và web** | Capture association đúng phiên bản. Domain khác vẫn unsupported có lý do. |
| 5. Canvas | **Đạt một phần** | Camera đạt; pin chưa đạt (deferred, không tính là đạt). |
| 6. Hoạt động và điều hướng | **Đạt một phần** | Overlay origin và host đạt. Controls trên run sống chưa kiểm chứng (blocker). |
| 7. Coverage domain | **Đạt một phần, còn blocked** | Network và web có dữ liệu thật đã tích hợp. Tool web live (katana, httpx) chưa kiểm chứng. Các domain khác blocked hoặc unverified. |
| 8. Migration, hiệu năng, rollout | **Chưa đóng** | Hiệu năng và V007 đạt. Bootstrap preflight chưa chạy được ở kích thước hiện tại. Quyết định rollout chưa có. |

Hai trạng thái được giữ tách biệt:

- **Tích hợp dữ liệu đã kiểm chứng:** dữ liệu thật đi qua ingest → persistence → API → inspector. Web Juice Shop: đạt.
- **Tool/provider live đã kiểm chứng:** công cụ thật chạy và tạo output. nmap: đạt (chạy trong sandbox, 2026-10-21). Web: chưa; katana không có trong sandbox, và `httpx` trong sandbox là client Python thiếu phụ thuộc. Scripted crawl được ghi nhãn `scripted-crawl`, không phải katana.

## Mục 1: lookup và index

**Nguyên nhân.** Các truy vấn theo `asset_id` và `origin_asset_id` viết `MATCH (c) WHERE …`, không có label. Neo4j không có index để seek nên quét mọi node của database. Với graph hiện tại (552.227 node), một lookup host tốn 1.196.002 database hit, và đếm endpoint của một origin tốn 1.252.286 (PROFILE trước khi sửa, trong lúc stress 500.000 node cùng database).

**Thay đổi.**

- Sáu lookup của asset map và một lookup catalog đặt label: `Host|Entrypoint` cho `asset_id`, `Host` cho service, `Endpoint` cho `origin_asset_id`. Chỉ `Host` và `Entrypoint` mang `asset_id` (ASSET_BEARING_KINDS); `Endpoint` mang `origin_asset_id`.
- Migration `V007__asset_identity_lookup_indexes.cypher`: ba index composite `(engagement, asset_id)` trên `Host` và `Entrypoint`, và `(engagement, origin_asset_id)` trên `Endpoint`. Không đặt uniqueness, vì nhiều node KG có thể cùng đại diện một canonical asset.
- Test: `labels every identity lookup, so the planner can seek the index instead of scanning the graph` (server) đọc các câu lệnh đã gửi và yêu cầu label.

**Kế hoạch PROFILE sau sửa.** Lookup host dùng `Union` của hai `NodeIndexSeek` (Host, Entrypoint), tổng 8 database access. Đếm endpoint dùng `NodeIndexSeek` trên `RANGE INDEX e:Endpoint(engagement, origin_asset_id)`, tổng 1 database access. Plan lưu ở thư mục scratch của phiên.

**Đo trước và sau sửa, với dữ liệu khác cùng tồn tại.** Tất cả đo trên cùng một database (552.227 node: baseline 49.980, stress 499.980, webflow và các engagement khác). Số là p50 / p95 tính bằng ms, 20 lần cho baseline và 10 lần cho stress.

| Thao tác | Baseline trước | Baseline sau | Stress trước | Stress sau | Ngân sách |
|---|---|---|---|---|---|
| overview | 3 / 6 | 2 / 5 | 12 / 14 | 9 / 9 | ≤ 500 |
| members host, trang 50 | 3 / 3 | 3 / 5 | 10 / 15 | 8 / 10 | ≤ 500 |
| search "10." | 7 / 8 | 6 / 7 | 45 / 50 | 46 / 60 | ≤ 500 |
| neighborhood host | 498 / 563 | 22 / 36 | 1.390 / 1.511 | 14 / 18 | ≤ 500 |
| detail host (services) | 902 / 1.016 | 24 / 44 | 1.287 / 1.388 | 19 / 33 | ≤ 500 |
| detail origin (trang 100) | 979 / 1.771 | 22 / 32 | 1.468 / 1.527 | 20 / 28 | ≤ 500 |

**Kích thước dữ liệu.** Baseline: 1.000 Host, 5.000 Service, 4.000 Entrypoint, 19.990 Endpoint, 19.990 Parameter. Stress: 10.000 Host, 50.000 Service, 40.000 Entrypoint, 199.985 Endpoint, 199.985 Parameter.

**Payload.** Kích thước phản hồi giữ nguyên, trừ một trường mới: `artifactDigest` của evidence, nên detail tăng 22 đến 28 byte. Ngân sách số item không đổi. Test phân trang và revision vẫn pass.

**Kết luận.** Baseline và stress 10.000 host đều dưới 500 ms. Không cần đổi ngưỡng, và không cần tối ưu thêm cho stress.

## Mục 2: capture theo phiên bản, XML và JSONL

**Runtime (`f2dfadf4`).** `ingest()` đọc file một lần, băm đúng các bytes đó, và để adapter parse một bản sao của chính các bytes đó trong thư mục tạm. Mỗi observation có thêm `source_artifact_digest` cùng `source_artifact_ref`. File bị ghi đè trong lúc ingest không thể được parse dưới digest của phiên bản cũ.

**Web (`3e037b93`).**

- Import: mỗi phiên bản của một path là một capture. Khóa là `path + digest`. Các row import theo khóa cũ (chỉ path) vẫn khớp khi bytes không đổi, nên không sinh bản trùng.
- Import cho phép `.xml` (`application/xml`) và `.jsonl` (`application/x-ndjson`). Bytes, digest, classification, quyền truy cập và giới hạn 256 KiB giữ nguyên.
- Evidence: observation chỉ nối với capture có **cả path lẫn digest** trùng khớp. Observation không có digest không được nối.

**Kết quả trên dữ liệu thật (Juice Shop, engagement `asset-map-webflow`):**

| Kiểm tra | Kết quả |
|---|---|
| Nmap XML → evidence của host | Nối với capture `f4d68cb4` (standard). Download có header `x-content-sha256` = bytes = digest của observation (`91e6dc0f7ee5…`). |
| Crawl JSONL → evidence của origin | Nối với capture `ed0813e7` (standard). Download khớp digest của observation (`26154135d2f2…`). |
| Replay import (không đổi file) | Vẫn 4 capture, không tạo bản mới, không skip. |
| Ghi đè nội dung cùng path (crawl chạy lại) | Sau ingest, observation của origin mang digest mới `26154135…`. Evidence hiển thị **UNLINKED**: không nối với phiên bản cũ `3f90328d…` (capture `ff843656`, vẫn giữ làm lịch sử). |
| Import phiên bản mới | Tạo capture `ed0813e7`. Evidence nối với phiên bản mới; phiên bản cũ không đổi. |

**Test.** `findings-artifacts.test.ts`: `imports XML and JSONL evidence as the bytes they were written with…`; `imports the evidence an agent wrote as unclassified captures, idempotently…` (file đổi nội dung tạo capture mới, replay không tạo bản mới). `asset-domain-details.test.ts`: `links an observation only to the imported version whose digest it was parsed from…` (capture cùng digest ở engagement khác không được nối). Runtime `test_kg_ingest_unit.py`: `test_ingest_stamps_the_digest_of_the_bytes_the_adapter_parsed`, `test_a_file_rewritten_at_the_same_path_gets_the_digest_of_its_new_bytes`, `test_stamped_writes_keep_existing_props_and_delegate_everything_else`.

**Giới hạn.** Import vẫn là thao tác của operator, như trước. Một file đổi nội dung chỉ được nối sau khi operator import phiên bản mới. Đây là hành vi đúng theo yêu cầu "không nối nhầm", nhưng có nghĩa là evidence mới chưa tự xuất hiện.

## Mục 3: web_url → origin overlay

**Quy tắc (`3e037b93`).** `webOriginKey()` (TypeScript) và `web_origin_ref()` (Python) cùng cho ra `scheme://host:port`: scheme và host viết thường, bỏ dấu chấm cuối, port mặc định được ghi rõ, userinfo/path/query/fragment bị bỏ, IPv6 có ngoặc vuông. Spelling mà parser WHATWG sẽ viết lại (IPv6 không chuẩn, IPv4 dạng hex hoặc octal, IPv4 ngoài 0–255) trả null: identifier đó không được nối.

**Vector dùng chung.** `apps/web/tests/fixtures/asset-map/origin-identity-vectors.json`, 22 vector. Python: `test_origin_identity_vectors.py` (22 tham số). TypeScript: `asset-origin-identity.test.ts` (22 vector + 1 test refusal). Vector gồm HTTP và HTTPS, port khác nhau, port mặc định, path và query khác nhau, userinfo, dấu chấm cuối, IPv4, IPv6, và các input không hợp lệ.

**Overlay.** Finding chỉ nối khi identity của web asset tồn tại trong catalog của engagement. Identity chưa có asset được đếm là unlinked, không được đoán.

**Kết quả trên dữ liệu thật:**

| Overlay | Linked | Unlinked | Ghi chú |
|---|---|---|---|
| Origin `http://host.docker.internal:3000` | 1 (finding web_url "Product search endpoint …") | 0 | Trước sửa là 0. |
| DNS `host.docker.internal` | 1 (finding host "Host answers on several open TCP ports …") | 0 | |
| Host IP `192.168.65.254` | 0 | 0 | Không gộp với DNS name; đúng quyết định. |

**Test.** HTTP/HTTPS khác nhau, port khác nhau và engagement khác không được gắn nhầm (`keeps web URLs on another scheme, another port or another engagement away from the origin`). Finding trên origin chưa có asset được đếm là unlinked.

## Mục 4: saved view theo scope và camera

**Lỗi.** Trước khi sửa, khi đổi project, `selected` của project cũ còn tồn tại trong một render. Effect lưu saved view chạy với engagement mới và asset cũ, nên ghi asset cũ vào saved view của project mới. Camera report còn sót từ canvas cũ cũng có thể đến sau khi đổi project.

**Sửa (`10182ab2`).** `AssetMapPage` bọc một `AssetMapScope` được key theo `actorId` và `engagementId`. Mỗi scope có state, camera ref và các request riêng. Response của scope cũ không còn chỗ để ghi.

**Test.** `keeps the saved asset and camera of each project apart when the operator goes A to B and back in one session`. Test này **thất bại** khi bỏ key (đã kiểm chứng: project B nhận asset A và camera A), và pass khi có key.

**Browser (`verify-asset-map-canvas.mjs`, đã sửa).** Đo fit zoom trước mọi tương tác, đặt zoom và pan khác mặc định, chờ lưu, kiểm tra saved view có đúng camera theo user và project, reload, rồi chờ đúng zoom đã lưu. Không còn `catch` nuốt lỗi. Kết quả trên webflow: fit zoom 3, camera đặt là zoom 2,74 và pan (−846, −528), camera được lưu, sau reload khôi phục đúng (2,74, −846, −528). Asset đã chọn được mở lại.

**Chưa làm.** Chưa chạy A → B → A trên browser thật; phần này được phủ bởi unit test. Pin vẫn deferred, không tính là đạt.

## Mục 5: controls trên browser

**Đã có trước lượt này.** Pause, resume và cancel gửi thread id và run id. Server: cancel chỉ áp dụng cho run đang chạy, yêu cầu vai trò operator; run không thuộc thread bị từ chối (404). Operation state của runtime (`pause_requested`, `paused`) đã được hiển thị.

**Đã thêm (`53a1bebf`).** Sau khi runtime nhận yêu cầu dừng, dòng run hiển thị "Stop requested" và nút bị khóa, kèm dòng "The runtime accepted the stop; it has not yet confirmed that the run ended." Chỉ khi status của chính run rời tập đang chạy, dòng mới báo "Run ended after the stop request; the runtime reports <status>." Yêu cầu bị từ chối giữ run đang chạy và hiển thị lỗi. Test: `runtime-runs.test.tsx` (2 test).

**Browser check (`330602c6`, `verify-ai-run-controls.mjs`), 4/4 bước đạt:**

1. AI Workspace hiển thị panel điều khiển cho execution thread thật (`f1b0a0d5…`), với "No runs on this thread yet."
2. Yêu cầu chạy qua cùng API của UI bị preflight từ chối: HTTP 409 với lý do "Planning handoff is not confirmed yet", "No approved ROE revision exists yet", "The approved ROE revision carries no emergency contact".
3. Yêu cầu pause trên một run không thuộc thread bị từ chối: HTTP 404.
4. Execution (`#/operations`) và deep link cũ (`#/operations?engagement=…`) vẫn render.

**Chưa kiểm chứng: pause, resume và cancel trên một run sống.** Lab không có run nào để thao tác. Để có run, runtime yêu cầu hai điều kiện mà tôi không tự thỏa:

- **ROE đã được duyệt bởi người độc lập.** Hệ thống từ chối tự duyệt (`requireIndependentActor`). Tạo tài khoản thứ hai để tự duyệt sẽ là vượt qua kiểm soát này, nên không làm.
- **Planning handoff đã được xác nhận.** Cần bộ tài liệu planning và xác nhận của operator.

Khi hai điều kiện này được thỏa bởi người có thẩm quyền, cần một lần chạy kiểm chứng ngắn: pause → `paused`, resume → chạy tiếp, cancel → "Stop requested" rồi "Run ended …", với cả thread và run id khớp giữa browser và backend.

## Phát hiện trong lúc triển khai

1. **Migration runner bị lỗi do bộ đếm revision (đã sửa, `234d0bd8`).** Runner gửi từng câu lệnh migration qua `execute_write`, và `execute_write` thêm một lệnh MERGE tăng revision trong cùng transaction. Neo4j từ chối ghi sau một thay đổi schema trong cùng transaction (`Tried to execute Write query after executing Schema modification`). Lỗi này đã tái hiện với V007. Các migration trước đó (đến V006) đã được áp dụng từ trước, nên không kiểm chứng lại được đường chạy cũ. Sửa: `execute_migration_statement()` giữ nguyên kiểm tra, không tăng bộ đếm. Test: `test_a_migration_statement_runs_alone_and_advances_no_revision_counter`.
2. **Bootstrap KG không chạy được ở kích thước hiện tại (chưa sửa).** `make webraptix-kg-bootstrap` chạy preflight trùng lặp trên toàn bộ node (`MATCH (n) … WITH head(labels(n)) …`). Với 552.227 node, preflight vượt giới hạn transaction 179 MiB và trả `MemoryPoolOutOfMemoryError`; không migration nào được áp dụng. V007 được áp dụng bằng `apply_migrations` (cùng câu lệnh, bỏ qua preflight). Lý do bỏ qua an toàn: preflight để bảo vệ các constraint unique, còn V007 chỉ tạo index không unique. Cần quyết định sửa preflight (chạy theo từng label hoặc chia lô) trước lần nâng cấp kế tiếp.
3. **Generator với tham số `10000 199990` tạo 199.985 endpoint.** Đây là số đếm trong bảng kích thước dữ liệu của lượt này.

## Dữ liệu, sao lưu và dọn dẹp

**Sao lưu trước thay đổi DB (trong thư mục scratch của phiên):**

- Postgres `raptix_web_raptix`: `pg_dump -Fc`, 1,5 MB (`raptix_web_raptix-pre-v007.dump`).
- Neo4j: dump offline sau khi dừng container, 290 MB (`neo4j.dump`), container được khởi động lại sau đó.

**Giữ lại (để đo lại và mở trên UI):**

- Engagement `eng_assetmap_baseline` (`asset-map-baseline`, 49.980 node KG).
- Engagement stress mới `cmvhhyq1w000k42pkj4niu6qf` (`asset-map-stress`, 499.980 node KG). Được giữ **cùng database** với baseline vì phép đo cần dữ liệu cùng tồn tại. Dataset tái tạo được bằng `gen_dataset.py`.
- Engagement web `cmvhgj34i000042pktbsdubxs` (`asset-map-webflow`): asset, sitemap, hai finding (mỗi finding có evidence), các capture (hai phiên bản JSONL, XML, TXT, JSON cũ).
- Tài khoản `asset-map-verify`. Mật khẩu được đặt lại bằng hàm băm của server; mật khẩu mới chỉ nằm trong file scratch.

**Đã xóa:** `/tmp/asset-map-data` trong runtime. Cookie jar và file CSRF tạm nằm trong scratch sẽ được xóa khi kết thúc phiên; dataset stress trong scratch (26 MB) được giữ để tái tạo nếu cần.

**Luồng web đã kiểm chứng (phát hiện → asset → sitemap → finding → evidence):**

1. **Phát hiện.** nmap thật từ sandbox tới `host.docker.internal`: 22 (ssh), 80, 3000 (Juice Shop), 8080 (nginx) mở. XML lưu ở `findings/evidence/nmap-juice.xml`. Ingest qua runtime: 7 node, 6 cạnh (rev 10).
2. **Asset.** Host IP `192.168.65.254` (identity từ nmap), DNS `host.docker.internal` (từ finding và inventory), origin `http://host.docker.internal:3000`. Reconcile catalog tạo identity.
3. **Sitemap và services.** Host có 4 service. Origin có 8 endpoint từ crawl GET-only (`scripted-crawl`, không phải katana), mỗi endpoint có `source_artifact_digest`.
4. **Finding.** Finding web_url nối origin overlay (linked 1). Finding host nối DNS overlay (linked 1). Host IP không nhận finding nào (không gộp identity).
5. **Evidence.** Host → nmap XML `f4d68cb4` (standard). Origin → crawl JSONL `ed0813e7` (standard). Download khớp digest của observation. Hai finding đã được attach với capture tương ứng.

**Hạn chế của luồng.** Crawl là script GET-only tự viết, không phải katana và không phải agent tự crawl; ghi nhãn rõ trong dữ liệu. Công cụ web live chưa kiểm chứng.

## Gate đã chạy

Tất cả chạy trên commit ghi trong bảng.

| Gate | Kết quả | Commit |
|---|---|---|
| Runtime: `uv run pytest` trên `test_kg_ingest_unit.py`, `test_surface_inventory_ingest.py`, `test_kgstore_unit.py`, `test_kg_migration_runner.py`, `packages/raptix/tests/unit/knowledge` | 271 passed (trước sửa runner), 261 passed (sau sửa runner) | `f2dfadf4`, `234d0bd8` |
| Runtime: `test_origin_identity_vectors.py` + `test_asset_identity.py` | 47 passed | `3e037b93` |
| Runtime live: `test_asset_ingest_roundtrip.py` (dev Neo4j 7688) | 4 passed | `234d0bd8` |
| Plugins: `test_asset_map_domain_coverage.py` | 12 passed | — |
| Ruff trên các file runtime đã đổi | sạch | `234d0bd8` |
| Server (vitest): `asset-domain-details`, `asset-origin-identity`, `asset-map-projection`, `asset-domain-mapping`, `asset-catalog`, `findings-artifacts`, `t10-findings-workflow` | 110 passed | `3e037b93` |
| Web UI (vitest): `src/features/asset-map` và `src/features/operations` | 52 passed, sau đó 23 passed cho page và domain-detail sau khi thêm test A→B→A | `10182ab2`, `53a1bebf` |
| Contracts (vitest) | 63 passed, 1 fail có sẵn (`run-api.test.ts`, `isMembersView`, không thuộc phạm vi) | `3e037b93` |
| Typecheck: `web-raptix`, `web-raptix-server`, build `web-contracts` | exit 0 | `3e037b93` |
| ESLint trên các file web và server đã đổi | sạch | `10182ab2`, `3e037b93` |
| Browser: `verify-asset-map-real-mode.mjs --origin http://host.docker.internal:3000` | **10/10 pass** | đã triển khai |
| Browser: `verify-asset-map-canvas.mjs --origin …` (gồm bước camera mới) | **11/11 pass** | đã triển khai |
| Browser: `verify-ai-run-controls.mjs` | **4/4 bước pass**; pause/resume/cancel trên run sống **chưa kiểm** | đã triển khai |
| Đo latency: `measure_read_models.mjs` trước và sau sửa | bảng ở mục 1 | `53a1bebf` và `234d0bd8` |
| PROFILE | `Union` của `NodeIndexSeek` (host, 8 db hits) và `NodeIndexSeek` (endpoint, 1 db hit) | sau `V007` |

## Việc còn lại và quyết định cần người dùng

1. **Chạy kiểm chứng controls trên run sống (blocker của mục 5).** Cần một người có thẩm quyền duyệt ROE của engagement lab với người duyệt độc lập, và xác nhận planning handoff. Không tự tạo để vượt qua. Khi đủ điều kiện, cần một lần chạy ngắn để kiểm chứng pause, resume và cancel.
2. **Sửa bootstrap preflight (blocker của nâng cấp kế tiếp).** Chạy preflight theo từng label hoặc chia lô, rồi đo lại. Cần quyết định có làm ngay không.
3. **Pin.** Deferred. Quyết định có đưa vào pilot không.
4. **Tool web live.** Cài katana và ProjectDiscovery httpx vào sandbox để có tool live, hoặc chấp nhận trạng thái "tích hợp dữ liệu" cho web như hiện tại.
5. **Identity IP và DNS.** Không gộp (quyết định đã chốt). Quan hệ resolution chỉ thêm khi có bằng chứng.
6. **Import capture.** Hiện là thao tác thủ công của operator; file đổi nội dung chỉ được nối sau khi import phiên bản mới. Cần quyết định có import tự động không.
7. **Parser registry ngoài nmap.** Chưa có test tương đương với adapter legacy (httpx, nuclei, katana, arjun, subfinder, ffuf).
8. **Cutover và rollout.** Giữ cờ tắt mặc định, Execution giữ nguyên. Quyết định sau khi các mục 1 và 2 được chốt.
