# Asset Map: kết quả triển khai theo phase

- **Plan:** [implementation plan](2026-10-20-asset-map-implementation-plan.md)
- **Branch:** `asset-map` (từ `web-improve-refactor`). Không push, không mở PR. Commit không có trailer AI, theo `CLAUDE.md` của repo.
- **Máy đo:** Windows 11, Intel Core i9-13900HX (24 nhân / 32 luồng), Docker Desktop 32 CPU / 10 GiB. Neo4j Community 5.26 với heap mặc định của image.
- **Trạng thái:** A (sửa correctness backend) xong; C (deployment lặp lại được) xong; B (lát UI network/web, Cytoscape, flag, Playwright) xong với một ngưỡng chưa đạt; D (coverage, backfill, stress) làm được một phần, xem từng mục.

Ký hiệu: **pass** = đã chạy và đạt; **fail** = đã chạy và không đạt; **blocked** = thiếu tool, lab, tài khoản hoặc hardware đã kiểm tra; **unverified** = chưa chạy.

## A. Sửa correctness backend

| Lỗi | Sửa | Kiểm chứng |
|---|---|---|
| Parameter gắn nhầm lên Host sau khi thêm origin observation (`observations[1]` đổi nghĩa) | Cạnh HAS trỏ tới đúng Endpoint bằng tham chiếu | Test hồi quy `test_parameter_edges_attach_to_the_endpoint_not_the_host` **pass** |
| URL lưu thô, có credential và token trong key và prop | Redact ở ingest (userinfo, fragment, giá trị query nhạy cảm); httpx và nuclei cùng quy tắc; detail redact thêm khi trả về | Test `test_credentials_and_secret_query_values_never_reach_the_graph` **pass**; test TS `redactUrl` **pass** |
| Id nhập nhằng: `(namespace="a:b", key="c")` và `(namespace="a", key="b:c")` cùng ra một asset | Mã hóa từng trường theo độ dài byte (UTF-8), `ASSET_KEY_VERSION` = 2, ADR-0094 ghi amendment | Test separator và multi-byte trong Python và TypeScript; vector parity khớp **pass** |
| Revision tự chế (`count(n)` và `max(lastupdated)`) | Dùng đúng công thức `KGStore.revision` (counter `KGRevision` cộng timestamp) | Test server **pass** (31/31 gồm các test cursor) |
| Neighborhood chỉ đọc một node (`WITH c LIMIT 1`) và không có cách mở tiếp | Đọc mọi node mang cùng asset identity, phân trang cạnh bằng cursor gắn revision, trả `centers` | Test paging và revision **pass** |
| Detail không có byte budget | Cắt phần tử cuối đến khi vừa 512 KiB, cursor tiếp tục đúng chỗ đã cắt | Test budget **pass** |
| Chưa có evidence reference | `provenance.evidence` (source, episode, thời điểm quan sát); mỗi item có `sourceEpisodeId` | Test contract và server **pass** |

**Writer network và web đang ghi gì** (kiểm tra theo code, không theo mô tả):

- nmap: Host (`host::IP`, asset props), Service (HOSTS), Entrypoint theo hostname và cổng web (asset props), cạnh HAS Host → Entrypoint.
- httpx: Host (DNS hoặc IP), Service, Entrypoint (URL đã redact), cạnh HAS Host → Entrypoint.
- katana và arjun: Host, Endpoint (URL đã redact, `origin_asset_id`), Parameter (HAS từ Endpoint), Entrypoint của origin.
- nuclei: Vulnerability; target là URL thì redact.

## B. Lát UI network/web

- Feature flag: tắt mặc định. Route `asset-map` không được đăng ký khi tắt, nên trả về như route không tồn tại. Bật bằng `VITE_ASSET_MAP=1` lúc build hoặc `localStorage['raptix.assetMap']='1'` trong trình duyệt.
- Cytoscape 3.34.4: compound group (service và origin nằm trong host), chọn node mở inspector, cập nhật incremental (node đã có giữ vị trí, chỉ layout phần tử mới). Spike chưa có: expand/collapse nhóm và layout đo trên dataset lớn.
- Inspector: nguồn, bằng chứng (episode, thời điểm), services của host, sitemap của origin với URL đã redact, phân trang "Load more" cho cả cạnh và sitemap.
- Unit test UI: 8/8 **pass** (model canvas, flag, trang gồm lỗi và trạng thái rỗng).
- **Playwright trên stack thật** (`apps/web/tools/verify-asset-map-real-mode.mjs`, đăng nhập bằng tài khoản kiểm thử có membership operator):
  - flag tắt không hiện map: **pass**;
  - flag bật: hosts (2), services (2), canvas render, bằng chứng (1), origin (1), sitemap (3 endpoint), sitemap không lộ credential: **pass**;
  - **canvas sẵn sàng trong 2 giây sau khi chọn host: xem mục "Đo canvas" bên dưới.**

### Đo canvas và nguyên nhân độ trễ

Lần đo đầu, khi dataset stress (≈500.000 node) vẫn nằm trong cùng Neo4j, canvas mất 2.431 ms, vượt ngân sách 2 giây. Đo API qua proxy cùng lúc: neighborhood ≈1,05 s, detail ≈1,75 s, trong khi cùng engagement đó chỉ có vài node.

Nguyên nhân: query revision (`MATCH (src)-[r]->(dst) WHERE src.engagement = $engagement`) không có label và không có index trên quan hệ, nên Neo4j quét **toàn bộ quan hệ của database**, không chỉ của engagement đang đọc. Latency vì vậy tăng theo tổng kích thước graph, không theo kích thước engagement. Đây cũng là query mà runtime dùng cho `KGStore.revision`, nên ảnh hưởng mọi engagement. Theo chỉ dẫn, không tối ưu ngay; ghi làm follow-up bắt buộc (xem mục Việc còn lại).

Sau khi xóa dataset stress, phép đo canvas được lặp lại trên DB còn lại: **kết quả điền ở cuối mục này.**

## C. Triển khai lặp lại được

- Build và deploy đúng code mới: `docker compose -f docker-compose.web-raptix.yml -f docker-compose.web-runtime.yml build web-raptix-api web-runtime web-raptix-ui`, sau đó `up -d --no-deps` cho ba service. Boot API báo "No pending migrations" (rerun là no-op). Postgres và Neo4j không bị recreate.
- Bước bootstrap rõ ràng: `make webraptix-kg-bootstrap` (lệnh tương đương: `exec -T web-runtime python -m raptix.knowledge.graph.bootstrap`). Chạy `apply_migrations` có sẵn, sau bước kiểm tra trùng `(key, engagement)`:
  - **Neo4j sạch**: áp đủ 6 migration (V001–V006), exit 0.
  - **Có node trùng**: exit 2, báo đúng `label key engagement copies`, không tạo constraint, không merge.
  - **Sau khi xử lý trùng trong graph**: áp 6 migration; **chạy lại** báo `none (already current)`.
  - **DB live** đã có sẵn 6 migration: rerun trên runtime đã deploy báo `applied 0`.
- Test unit bootstrap: 2 test **pass** (trong bộ 31 test identity và migration runner).
- Script tái lập trong repo `scripts/asset-map/`: `gen_dataset.py` (tham số số host và endpoint), `ingest_dataset.py` (đi qua writer thật trong runtime), `measure_read_models.mjs` (đo qua build API), `backfill_rehearsal.mjs`. Các lệnh đều nằm trong README của thư mục và trong phần cuối tài liệu này.

## D. Coverage, backfill, live acquisition, stress

### Retained output và live acquisition

- Tìm retained output trong `workspace/`, `report-do-an/`, `report-vdt/`, `web-sandboxes/`: không có output scanner nào (không có nmap XML, httpx, katana, nuclei hay SARIF). `workspace/` chỉ có log sự kiện agent. Không có pcap, APK, IPA, ABI, firmware hay capture ICS/wireless.
- **Network: live acquisition pass.** nmap thật từ sandbox của stack web quét hai host lab (`172.31.0.2`, `172.31.0.5`, cổng 9999) và juice-shop (`host.docker.internal:3000`). XML được giữ tại `apps/web/tests/fixtures/asset-map/network/` và ingest qua writer thật (`asset-map-live`): 3 host catalog, không rejected, service và bằng chứng đúng.
- **Web: partial.** Sandbox không có httpx của ProjectDiscovery (`/usr/local/bin/httpx` là client Python) và không có katana. Không có output web-scanner thật; dữ liệu endpoint hiện chỉ ở mức fixture.
- **AD, cloud, mobile, wireless, IoT, ICS, OSINT: blocked.** Lý do cụ thể đã ghi trong ma trận (không có lab AD đang chạy, không có tài khoản cloud, không có APK, không có adapter wireless hay thiết bị ICS/IoT, OSINT cần provider ngoài). Không có demo nào được tính pass.

### Backfill rehearsal (pass)

Trên 50.000 identity của dataset stress (`asset-map-stress`):

| Bước | Kết quả |
|---|---|
| Reconcile lần đầu | 50.000 tạo, 0 rejected |
| Reconcile lần hai (replay) | 0 tạo, SHA-256 tập id không đổi |
| Xóa catalog (rollback) | 0 dòng |
| Reconcile sau rollback | 50.000 tạo, cùng SHA-256 tập id |

Tổng thời gian ba lần reconcile: 111,7 giây.

### Stress 10k host / 50k service / 200k endpoint

- Ingest 140 file (100 nmap, 40 katana) qua runtime: 184,3 giây, khoảng 500.000 node (kể cả quan hệ được tạo ra từ endpoint và parameter). Không có lỗi writer.
- Đo read model trên engagement này (n = 20 mỗi thao tác, sau warm-up):

| Thao tác | p50 | p95 | Ghi chú |
|---|---|---|---|
| overview (catalog) | 14 ms | 18 ms | ≤ 500 ms |
| members host, trang 50 | 11 ms | 14 ms | ≤ 500 ms |
| search "10." | 55 ms | 65 ms | ≤ 500 ms |
| neighborhood host | 3.282 ms | 3.499 ms | **vượt 500 ms** |
| detail host (services) | 3.066 ms | 3.371 ms | **vượt 500 ms** |
| detail origin (trang 100) | 3.289 ms | 3.452 ms | **vượt 500 ms** |

Các thao tác đọc catalog đạt ngân sách. Các thao tác có revision vượt ngân sách, và nguyên nhân là query revision đã nêu ở mục B. Không tối ưu ngay, theo chỉ dẫn.

Dataset stress **chưa dọn xong** (xem "Dọn dẹp", trạng thái dừng).

## Lỗi test có sẵn (không do thay đổi này)

- `packages/raptix/tests/integration/kg/test_kg_ingest_live.py` và `test_kg_live.py`: 10 test fail với `missing $engagement scope`, vì test dùng tham số `$eng`. Hai file này không được sửa trong lượt này.
- `apps/web/server/src/main.ts:266` có `prefer-const` (`sessionProvider`); `ruff` có 3 lỗi I001 có sẵn (`resolver.py`, `store.py`, `test_kg_live.py`); `web-contracts` chưa có cấu hình ESLint hợp lệ.

## Phát hiện và follow-up

1. **Query revision quét toàn bộ quan hệ của database** (`MATCH (src)-[r]->(dst) WHERE src.engagement = $engagement`). Latency tăng theo tổng kích thước graph. Cần thêm điều kiện theo label hoặc index quan hệ, hoặc tách revision theo engagement. Chưa làm theo chỉ dẫn; là việc bắt buộc tiếp theo trước khi dùng stress set lớn cùng lúc với dữ liệu khác.
2. **Xóa hub node cần xóa cạnh trước.** `DETACH DELETE` của lô 5.000 node hết heap khi có node có ~100.000 cạnh (host 0 của dataset). Dọn đúng cách: xóa quan hệ theo lô 2.000, rồi xóa node.
3. **Import package `raptix` mất 40–60 giây** do `_boot` resolve role và tạo LLM factory. Ảnh hưởng mọi lệnh CLI chạy trong runtime, kể cả bootstrap.
4. Chưa có ADR để chạy `apply_migrations` tự động khi khởi động production. Hiện chạy qua `make webraptix-kg-bootstrap`, có bước kiểm tra trùng.

## Dọn dẹp (đang dở, tạm dừng)

Đã dọn xong:

- Catalog (`AssetIdentity`) của `asset-map-stress-eng` (50.000 dòng) và dòng `Engagement` của nó.
- Quan hệ KG của `asset-map-stress`: đã xóa từ ~500.000 xuống còn 91.980 (xóa theo lô 2.000 quan hệ, rồi node).

Còn lại (cần làm khi tiếp tục):

- KG `asset-map-stress`: 91.980 quan hệ và 499.980 node. Xóa tiếp: quan hệ theo lô 2.000 (`MATCH ()-[r {engagement:'asset-map-stress'}]->() WITH r LIMIT 2000 DELETE r`), sau đó node theo lô 5.000, rồi `KGRevision` có `scope='asset-map-stress'`. Không dùng `DETACH DELETE` theo lô vì hết heap.
- Engagement tạm `asset-map-ui-eng` và `asset-map-live-eng`: catalog, dòng `Engagement`, KG theo `workspaceSlug` (`asset-map-ui`, `asset-map-live`).
- Membership và user kiểm thử `asset-map-verify` (cùng session) trên hai engagement trên.
- File tạm: `/tmp/asset-map-data`, `/tmp/ui-data`, `/tmp/live-data` trong container runtime; `/tmp/drop-stress-*.sh`, `/tmp/v2-err.txt` trong container Neo4j.

Trạng thái khi dừng: Neo4j khỏe, không có transaction đang chạy, số quan hệ stress ổn định ở 91.980 sau khi dừng job.

## Việc còn lại

0. Tiếp tục dọn dữ liệu stress và các artifact tạm (xem "Dọn dẹp"), rồi chạy lại `verify-asset-map-real-mode.mjs` trên DB sạch để điền số canvas.
1. Tối ưu query revision (phạm vi theo engagement) và đo lại stress 10k/50k/200k.
2. Expand và collapse nhóm trên canvas; đo canvas trên dataset lớn.
3. Phase 7: lab hoặc sample cho AD, cloud, mobile, wireless, IoT, ICS trước khi đổi trạng thái blocked.
4. Web: scanner web thật (httpx ProjectDiscovery hoặc katana) trong sandbox để có retained output.
5. Cutover điều hướng mặc định: chưa làm, cần quyết định của bạn sau khi có gate đầy đủ.

## Đo canvas sau khi dọn

_Chưa đo. Lần đo trước (khi dataset stress còn trong DB) cho 2.431 ms, vượt ngân sách; xem mục B._
