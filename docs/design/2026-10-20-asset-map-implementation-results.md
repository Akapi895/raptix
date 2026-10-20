# Asset Map: kết quả kiểm chứng theo phase

- **Plan:** [implementation plan](2026-10-20-asset-map-implementation-plan.md)
- **Branch:** `asset-map`. Không push, không mở PR. Commit không có trailer AI, theo `CLAUDE.md` của repo.
- **Lượt này:** 20 commit từ `ca3c78ec` đến `fa7d8e57` (`git log ca3c78ec..HEAD`). Lượt trước là gate phase 1–8 đầu tiên.
- **Máy đo:** Windows 11, Intel Core i9-13900HX, Docker Desktop. Neo4j Community 5.26 (dev stack, `127.0.0.1:7688`), PostgreSQL 16 (dev stack, `127.0.0.1:5433`).

## Trạng thái tổng

| Phase | Trạng thái | Ghi chú ngắn |
|---|---|---|
| 1. Identity và ranh giới | **Đạt** | Ma trận 31 hàng được đối chiếu bằng test với registry; ADR-0094 có hai amendment. |
| 2. Chuẩn hóa đường ghi | **Đạt** | Identity và redaction ở một điểm ghi duy nhất; test live trên Neo4j và gate migration trên PostgreSQL. |
| 3. Read model | **Đạt một phần** | Truy vấn revision chưa bị chặn trên dữ liệu lớn (xem phase 8). |
| 4. Detail và view theo domain | **Đạt một phần** | Chưa có liên kết capture với artifact Web. |
| 5. Canvas | **Đạt một phần** | Chưa có nút pin và chưa lưu camera trong saved view. |
| 6. Hoạt động và điều hướng | **Đạt một phần** | Có overlay và mục nav theo cờ; controls chưa chuyển sang AI Workspace; chưa cutover. |
| 7. Coverage domain | **Đạt một phần, còn blocked** | Chỉ network có dữ liệu thật; web là partial; các domain còn lại blocked hoặc unverified. |
| 8. Migration, hiệu năng, rollout | **Chưa đạt** | Gate latency có revision vẫn fail; quyết định rollout chưa có. |

Ký hiệu: **pass** = đã chạy và đạt; **fail** = đã chạy và không đạt; **blocked** = thiếu tool, lab, dữ liệu hoặc hardware; **unverified** = chưa chạy.

Theo quy tắc của plan, gate bắt buộc chưa chạy là blocked và không tính là pass. Vì vậy các phase 7 và 8 chưa được tính là hoàn thành.

## Phase 1: identity và ranh giới dữ liệu

- **Ma trận coverage** (`docs/design/2026-10-20-asset-map-coverage-matrix.json`, 31 hàng). Mỗi hàng ghi: owner, graph LangGraph, role trong bảng slot, `registration` (entry-point, graph-only, orchestrator, domain-pack, library-only), `activation` (bundle nào bật nó), writer là đường dẫn file có thật, role nào kích hoạt writer, và `write_reason` nếu hàng không ghi asset nào.
- **Đã sửa so với bản trước:** hàng `analyst` từng ghi "không ghi asset", nhưng `kg_record` và `kg_ingest` ghi được Host và Entrypoint. Hàng `web` từng ghi "không có writer cho ffuf", nhưng parser ffuf có tồn tại. Hàng `postexploit` và `exploit` từng ghi "không có asset writer", nhưng auto-ingest của các role này ghi host và origin. Hàng `scanner`, `detector`, `verifier` và các role pipeline được ghi lý do cụ thể.
- **Thiếu được bổ sung:** `autohunt`, `soundwave`, `raptix-delta`, `vulnresearch`, và `raptix` (kèm alias `decepticon`).
- **Test:** `plugins/tests/test_asset_map_domain_coverage.py` kiểm tra mọi graph LangGraph có hàng, mọi role trong `SLOTS_PER_ROLE` có hàng, mọi writer là file có thật, mọi hàng không ghi catalog asset có lý do, và mọi hàng `verified-data` có fixture tồn tại. Kết quả: 15 passed (cả `plugins/tests`).
- **Quyết định kiến trúc:** ADR-0094 đã được Accepted từ trước, và có amendment phiên bản 2 (mã hóa theo độ dài). Amendment ngày 2026-10-21 ghi quy tắc ở điểm ghi KG, lý do, phương án bị loại (từ chối Host/Entrypoint trong `kg_record`) và hệ quả với nhãn AD.
- **Chưa làm:** nhãn AD (`AD_USER`, `AD_COMPUTER` và các nhãn khác) chưa được ánh xạ sang identity catalog; việc này thuộc phase 7.

## Phase 2: chuẩn hóa các đường ghi graph

**Điểm ghi chung.** `KGStore.record_observations` là điểm ghi duy nhất. Tại đây:

- Host và Entrypoint không có `asset_id` được gắn identity theo locator (suffix của key trước, rồi đến thuộc tính `ip` hoặc `url`). Locator không hợp lệ thì node vẫn được ghi, không có identity, và được đếm là `unidentified` trong kết quả. Không đoán.
- Key Entrypoint, label, thuộc tính `url` và đích của cạnh được redact bằng `redact_url` trước khi ghi. Trước đây parser registry và `research/tools.py` ghi URL thô (có credential và token) vào key.
- Node đã có `asset_id` (ingest của adapter legacy) giữ nguyên.

**Đường ghi được nối:** adapter legacy (nmap, httpx, nuclei, katana, arjun, `kg_ingest`), parser registry (subfinder, dnsx, ffuf, masscan, gobuster qua auto-ingest), `kg_record` của agent, và shim legacy (`research/_state.py`). Các domain chưa chuyển (AD, contracts, defense) vẫn ghi và đọc như trước.

**Bằng chứng:**

- Test unit: `test_asset_identity.py` (quy tắc identity, redaction, lỗi không lộ URL), `test_kgstore_unit.py` (store: identity, redaction, `unidentified`), `test_materialize.py` (`TestRegistryAndLegacyWritersAgree`: nmap cùng file cho cùng `asset_id` qua adapter legacy và parser registry). Lượt này: `packages/raptix/tests/unit/knowledge` và các test KG liên quan có 296 passed.
- Test live trên Neo4j (`packages/raptix/tests/integration/kg/test_asset_ingest_roundtrip.py`): 3 passed. Ca mới `test_agent_records_get_identity_and_redacted_entrypoints` đọc lại node từ Neo4j và xác nhận identity đúng, URL đã redact, và `unidentified == 1`.
- Gate migration trên PostgreSQL thật (`apps/web/server/tests/asset-map-migration-live.ts`, DB cách ly `raptix_web_asset_map_gate_20261021`, đã xóa sau khi chạy): 9/9 kiểm tra đạt. Gồm nâng cấp và các index, 8 kết nối ghi đồng thời cùng 500 identity (mỗi identity đúng một dòng), xung đột locator bị từ chối bởi unique index, rollback chỉ xóa `AssetIdentity` và giữ `WebAsset`, và chu kỳ lặp lại sạch.
- Ghi khi Web không chạy: đường ghi chỉ đi tới Neo4j, không gọi Web. Bằng chứng từ lượt trước (dừng API khoảng 1 phút, ingest vẫn thành công) chưa được chạy lại trong lượt này.

**Chưa làm:** `test_kg_autoingest.py` không có ca mới. File này đã có test provenance và failure path cho cả hai nhánh (adapter legacy và parser registry, gồm lỗi parse không ghi gì). Identity của đường auto-ingest được kiểm ở ranh giới store và trong roundtrip live, nên không lặp lại trong file này.

## Phase 3: read model cho graph lớn

- **Đạt:** overview, members, search, neighborhood, detail. Cursor gắn revision; revision đổi thì trả 409 và phải đọc lại từ trang đầu. Phân biệt loaded, total (có thể unknown), truncated, và nguồn lỗi. Mọi đọc kiểm tra thành viên dự án (`requireEngagementAccess`, vai trò tối thiểu `viewer`, không chỉ owner).
- **Test server:** `asset-map-projection.test.ts`, `asset-domain-details.test.ts` (thành viên đọc được, người ngoài nhận 404, asset của engagement khác nhận 404, graph không tới được trả `GraphUnavailableError`, tức 503 ở route).
- **Chưa đạt:** truy vấn revision (`MATCH (src)-[r]->(dst) WHERE src.engagement = $engagement`) quét toàn bộ quan hệ của database, không bị chặn theo engagement. Đây là điểm plan yêu cầu "query có giới hạn". Xem phase 8.
- **Index:** lookup theo ID và theo engagement dùng index của catalog. Search là `contains` trong một engagement, bị chặn bởi LIMIT 50. Không có index trigram.

## Phase 4: detail và view theo domain

- **Đã làm:** dịch vụ của host hoặc DNS name; sitemap của web origin (method, URL đã redact, status, tham số, episode của từng dòng); phân trang theo cursor; bộ lọc sitemap theo URL hoặc path (tham số `q`, tối đa 200 ký tự, cursor gắn với bộ lọc, đổi bộ lọc mà giữ cursor cũ thì trả 400); `unsupported` có lý do cho mọi kind khác.
- **Đã làm:** finding gắn vào asset qua owning record (`FindingRecord.assetId` → `WebAsset` → identity), xem phase 6.
- **Renderer:** bảng `domain-renderers.ts` ghi view của từng kind (services, sitemap, typed-fallback), và inspector hiển thị tên view đang dùng.
- **Test:** `domain-detail.test.tsx` (sitemap, unsupported, nạp thêm services, lọc giữ qua trang sau, khôi phục asset sau khi mở lại trang), `asset-domain-mapping.test.ts` (mỗi kind được trả view đúng hoặc unsupported có lý do).
- **Chưa làm:** liên kết capture với artifact Web (`RetainedCapture`). KG chỉ lưu `source_episode_id` và, với parser registry, `source_artifact_id`. Không có digest của artifact trong provenance của observation, nên không thể nối chắc chắn. Cần đổi provenance ghi trước; đây là quyết định cần người dùng chốt.

## Phase 5: canvas

- **Đã làm:** canvas Cytoscape (nhóm host gồm service và origin); chọn node mở inspector; cập nhật tăng dần (node đã có giữ vị trí); budget hiển thị 100 node và 250 cạnh, phần vượt được đếm và báo; **thu gọn và mở nhóm** (nút trên thanh công cụ và double-tap); **fit view**; **bật/tắt kind** (Services, Origins; trung tâm luôn hiện); **tìm asset** (ô tìm kiếm, kết quả mở asset và canvas căn giữa node); **refresh** đọc lại danh sách và asset đang mở, báo khi revision của catalog đổi, và giữ vị trí node (digest vị trí không đổi); **saved view theo user và project** (khóa `actor` + `engagement`, không khôi phục asset của user khác trên cùng trình duyệt).
- **Chưa làm:** nút pin (vị trí chỉ được giữ qua kéo và qua refresh, không có điều khiển pin); lưu camera (zoom, pan) trong saved view.
- **Test UI:** `canvas-model.test.ts` (ngân sách, kind, trạng thái bị tắt), `canvas.test.tsx` (fake core: số node/cạnh, tap chọn asset, thu gọn/mở nhóm và số node hiển thị, double-tap, định vị theo token, digest vị trí, fit), `AssetMapPage.test.tsx` (stale response, restart 409, tìm và mở asset ngoài danh sách, refresh có thông báo, kind tắt, saved view theo user, khôi phục asset nằm ngoài trang đầu). Lượt này: 57 passed (9 file, gồm shell).
- **Browser (stack thật, đã triển khai):** `tools/verify-asset-map-canvas.mjs --origin http://10.1.0.1:80`: **8/8 pass**. Nodes 9, edges 8; zoom 1.07 → 1.12 → 1.07; kéo chuột làm pan (-15,-14) → (-163,-64); thu gọn nhóm 9 → 1, mở lại 1 → 9; refresh giữ digest vị trí; origin mở bằng bàn phím có 10 endpoint; saved view mở lại sau reload; không cuộn ngang ở 390 px.
- **Ghi chú fixture:** dữ liệu kiểm chứng là dataset tổng hợp xác định từ `scripts/asset-map/gen_dataset.py` (100 host, 20 endpoint). Đây là dữ liệu sinh ra và đi qua writer thật, không phải output của công cụ. Gate hình ảnh/hiệu năng trên dữ liệu thật vẫn là phần của phase 8.

## Phase 6: hoạt động và điều hướng

- **Đã làm:** overlay công việc và finding trên asset. Finding được gắn khi owning record là một `WebAsset` kind host có identifier là IPv4 hoặc DNS name, và identifier đó resolve tới asset. Finding không có liên kết được đếm là **chưa rõ attribution** (không đoán từ text, hostname hay run mới nhất). Test: `asset-domain-details.test.ts` (`findings on an asset`, `web inventory identities`).
- **Kiểm chứng trên stack thật:** tạo một WebAsset và hai finding (một có liên kết, một không), đăng nhập thật và gọi `GET .../assets/:id/overlay`: `linked.total = 1`, `unlinkedFindings = 1`. Dữ liệu này đã được xóa.
- **Điều hướng theo cờ:** khi bật asset map, nhóm EXECUTION có thêm mục **Asset Map** sau Execution (`shell/nav.ts`, test `shell/nav.test.ts`). Mục Execution được giữ lại vì các nút pause, resume, cancel chưa được chuyển, nên gỡ mục này sẽ làm mất đường vào các nút đó.
- **Chưa làm:** chuyển controls và diagnostics sang AI Workspace; phân vai lại Analysis; bỏ hai bề mặt cùng hiển thị một run table; cutover mặc định (plan yêu cầu sau gate phase 8). Lịch sử và deep link cũ vẫn truy cập được vì không có route nào bị xóa.

## Phase 7: coverage toàn bộ domain và specialist

- **Network (verified-data):** 10 file nmap XML đi qua adapter legacy (`_adapt_nmap_xml`): 8 file retained từ benchmark đầy đủ, 2 file live từ sandbox và juice-shop. Parser registry được kiểm trên cùng dữ liệu trong `test_materialize.py`. Test `packages/raptix/tests/unit/knowledge/test_asset_domain_mapping.py` (31 case) kiểm tra identity của host và origin, mỗi origin nối với host phơi nó, và provenance (`source`, episode). Đường dẫn fixture lấy từ hàng của ma trận.
- **Web (partial):** không có output scanner web thật. Sandbox không có katana; httpx trong sandbox là client Python. Sitemap hiện chỉ có dữ liệu tổng hợp qua writer thật.
- **AD, cloud, mobile, wireless, IoT, ICS, OSINT:** blocked. Không có output công cụ, lab đang chạy, hoặc hardware trong repo và workspace. Nhãn AD đã có writer (`bloodhound.py`, `adcs_post.py`) nhưng không có identity.
- **Contracts, reversing, phishing, DFIR, supply chain:** unverified. Slither có writer (`contracts/slither.py`) nhưng không có output.
- **Đã làm:** renderer seam cho các kind có dữ liệu; fallback có nhãn "No typed view yet" cho mọi kind còn lại.
- **Chưa đạt:** theo plan, mọi hàng cần mapping phải có retained output hoặc dữ liệu lab đi qua ingest → persistence → API → inspector. Chưa có. Theo quy tắc `CLAUDE.md` của repo, không dựng lab hay dịch vụ trả phí mới.

## Phase 8: migration, hiệu năng, rollout

**Đạt:**

- **Migration:** gate PostgreSQL thật (xem phase 2): 9/9.
- **Backfill rehearsal** (`scripts/asset-map/backfill_rehearsal.mjs`, trong container API đã triển khai):
  - Engagement dữ liệu tổng hợp: 401 identity, 0 bị từ chối; replay không tạo gì; rollback về 0; restore cho cùng tập ID. Tất cả `ok: true`.
  - Engagement retained: 10 identity (6 host, 4 origin), 0 bị từ chối; `ok: true`.
- **Ingest retained qua runtime đã triển khai:** 11 file. 10 file hoàn chỉnh được ghi. File `retained-02-services-top1000.xml` bị cắt cụt báo `nmap xml parse failed: no element found` và không ghi gì.
- **Real-mode** (`tools/verify-asset-map-real-mode.mjs --origin http://10.1.0.1:80`, UI đã triển khai, tài khoản kiểm thử có quyền owner): **10/10 pass**. Gồm flag tắt, flag bật, hosts và origins từ catalog, services, canvas trong 126 ms (budget 2 s), evidence, sitemap 10 endpoint, không lộ credential.
- **Canvas trên stack thật:** 8/8 (phần phase 5).

**Chưa đạt:**

- **Gate latency:** chưa đo lại trong lượt này. Số đo gần nhất (trên dataset 500.000 node, commit `ca3c78ec`):

| Thao tác | p50 | p95 | Ngân sách | Kết quả |
|---|---|---|---|---|
| overview (catalog) | 14 ms | 18 ms | ≤ 500 ms | đạt |
| members host, trang 50 | 11 ms | 14 ms | ≤ 500 ms | đạt |
| search "10." | 55 ms | 65 ms | ≤ 500 ms | đạt |
| neighborhood host | 3.282 ms | 3.499 ms | ≤ 500 ms | **fail** |
| detail host (services) | 3.066 ms | 3.371 ms | ≤ 500 ms | **fail** |
| detail origin (trang 100) | 3.289 ms | 3.452 ms | ≤ 500 ms | **fail** |

  Nguyên nhân: truy vấn revision quét mọi quan hệ của database (đo riêng bằng `cypher-shell` ≈ 5,8 s, gồm overhead docker). Theo chỉ dẫn của người dùng, lượt này không tối ưu chỉ vì chậm. Bộ lọc sitemap mới thêm một điều kiện `WHERE` vào truy vấn endpoint; chưa đo lại.
- **Rollout và cutover:** chưa có quyết định. Cutover mặc định của Asset Map và việc thay Execution nằm sau gate, và cần người dùng chốt.

## Lỗi test có sẵn (không do thay đổi này)

- `packages/raptix/tests/integration/kg/test_kg_ingest_live.py` và `test_kg_live.py`: 10 test lỗi `missing $engagement scope` (dùng tham số `$eng`). Lượt này không chạy lại.
- `apps/shared/web-contracts/tests/run-api.test.ts`: 1 test lỗi `isMembersView` (mong `true` cho `local-single-user` không có `inviteSupported`). `run-api.ts` không đổi kể từ `ca3c78ec`, nên lỗi này có sẵn từ trước. Không sửa vì ngoài phạm vi.
- `apps/web/server/src/main.ts:266` `prefer-const` (`sessionProvider`): không thuộc phạm vi.

## Lệnh đã chạy trong lượt này

- Gate: `npx vitest run --config vitest.config.ts tests/asset-domain-details.test.ts tests/asset-domain-mapping.test.ts tests/asset-catalog.test.ts tests/asset-map-projection.test.ts tests/graph-service.test.ts` (server): 5 file, 54 passed.
- UI: `npm run test --workspace=@raptix/web-raptix -- src/features/asset-map src/shell`: 9 file, 57 passed.
- Typecheck: `npm run typecheck --workspace=@raptix/web-raptix` và `--workspace=@raptix/web-raptix-server`: đều exit 0.
- Lint: `eslint` trên các file asset map đã đổi (web và server): sạch.
- Python: `uv run pytest -q plugins/tests` (15 passed); `uv run pytest -q packages/raptix/tests/unit/knowledge ...` (296 passed).
- Live: `RAPTIX_NEO4J_URI=bolt://127.0.0.1:7688 uv run pytest -q packages/raptix/tests/integration/kg/test_asset_ingest_roundtrip.py` (3 passed); `ASSET_MAP_MIGRATION_TEST_DATABASE_URL=... npx tsx apps/web/server/tests/asset-map-migration-live.ts` (9/9).
- Triển khai: `docker compose -f docker-compose.web-raptix.yml -f docker-compose.web-runtime.yml build web-raptix-api web-runtime web-raptix-ui`, rồi `up -d --no-deps` cho ba service. Postgres và Neo4j không bị tạo lại.

## Dọn dẹp

Đã tạo và đã xóa: người dùng kiểm thử `asset-map-verify`, hai engagement (`asset-map-verify`, `asset-map-retained-verify`), phiên đăng nhập, WebAsset và hai finding kiểm thử, toàn bộ `AssetIdentity` của hai engagement, 940 node KG, các KGRevision tương ứng, thư mục tạm trong container runtime, và file mật khẩu tạm. Kiểm tra sau khi xóa: 0 dòng còn lại trong Postgres, 0 node và 0 KGRevision còn lại trong Neo4j.

## Việc cần người dùng quyết định

1. **Truy vấn revision (chặn phase 8):** chọn một trong ba hướng: (a) tối ưu revision (ví dụ bounded theo label hoặc counter theo engagement) rồi đo lại; (b) giữ ngân sách và chấp nhận rollout bị chặn; (c) đổi ngân sách, nhưng plan cấm đặt lại ngưỡng sau khi đo.
2. **Cutover và controls (phase 6, 8):** khi nào đưa Asset Map thay Execution, và có chuyển controls sang AI Workspace trước khi cutover không.
3. **Capture association (phase 4):** có đổi provenance của observation để ghi digest artifact không.
4. **Pin và camera (phase 5):** có cần trong phạm vi này không.
5. **Dữ liệu cho phase 7:** các domain còn blocked cần output công cụ thật hoặc lab. Chỉ dùng lab đang có, hay được phép dựng lab?
