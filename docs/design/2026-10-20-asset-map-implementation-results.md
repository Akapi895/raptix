# Asset Map: kết quả triển khai theo phase

- **Plan:** [implementation plan](2026-10-20-asset-map-implementation-plan.md)
- **Branch:** `asset-map` (từ `web-improve-refactor`). Không push, không mở PR. Commit không có trailer AI, theo `CLAUDE.md` của repo.
- **Máy đo:** Windows 11, Intel Core i9-13900HX (24 nhân / 32 luồng), Docker Desktop 32 CPU / 10 GiB. Neo4j Community 5.26 với heap mặc định của image.
- **Trạng thái tổng:** phase 1–5 có gate chạy trên stack thật; phase 6 chưa làm; phase 7 và 8 làm được một phần, phần còn lại ghi rõ dưới đây.

Ký hiệu: **pass** = đã chạy và đạt; **fail** = đã chạy và không đạt; **blocked** = thiếu tool, lab, tài khoản hoặc hardware đã kiểm tra; **unverified** = chưa chạy.

## Phase 1–3: identity, ghi graph, read model

- Identity: `asset_id` xác định từ `(engagement, kind, namespace, canonicalKey, keyVersion)`; mã hóa từng trường theo độ dài byte (`ASSET_KEY_VERSION` = 2). Vector parity Python–TypeScript khớp, gồm trường hợp separator và đa byte. ADR-0094 có amendment.
- Ghi graph: nmap và httpx gắn `asset_id` lên Host và Entrypoint; migration `20261031000100_asset_identity` additive, đã áp lên DB live; reconcile idempotent. Ghi khi Web tắt: **pass**.
- Read model: overview, members (cursor gắn revision), search, neighborhood (mọi node cùng identity, phân trang cạnh). Test server **pass**; chạy live **pass**.

## A. Sửa correctness backend

| Lỗi | Sửa | Kiểm chứng |
|---|---|---|
| Parameter gắn nhầm lên Host sau khi thêm origin observation (`observations[1]` đổi nghĩa) | Cạnh HAS trỏ tới đúng Endpoint bằng tham chiếu | Test hồi quy **pass** |
| URL lưu thô, có credential và token trong key và prop | Redact ở ingest (userinfo, fragment, query nhạy cảm) cho katana, arjun, httpx và nuclei; detail redact thêm khi trả về | Test Python và TypeScript **pass** |
| Id nhập nhằng: `(namespace="a:b", key="c")` và `(namespace="a", key="b:c")` ra cùng identity | Mã hóa từng trường theo độ dài byte, version 2, ADR amendment | Test separator và đa byte **pass** |
| Revision tự chế (`count(n)` và `max(lastupdated)`) | Dùng đúng công thức `KGStore.revision` (counter `KGRevision` cộng timestamp) | Test server **pass** |
| Neighborhood chỉ đọc một node (`WITH c LIMIT 1`) | Đọc mọi node mang cùng asset identity; cạnh phân trang bằng cursor gắn revision; trả `centers` | Test paging và revision **pass** |
| Detail không có byte budget | Cắt phần tử cuối đến khi vừa 512 KiB; cursor tiếp tục đúng chỗ đã cắt | Test budget **pass** |
| Chưa có evidence reference | `provenance.evidence` (source, episode, thời điểm); mỗi item có `sourceEpisodeId` | Test contract và server **pass** |

**Writer network và web đang ghi gì** (theo code):

- nmap: Host (`host::IP`, asset props), Service (HOSTS), Entrypoint theo hostname và cổng web (asset props), cạnh HAS Host → Entrypoint.
- httpx: Host (DNS hoặc IP), Service, Entrypoint (URL đã redact), cạnh HAS Host → Entrypoint.
- katana và arjun: Host, Endpoint (URL đã redact, `origin_asset_id`), Parameter (HAS từ Endpoint), Entrypoint của origin.
- nuclei: Vulnerability; target là URL thì redact.

## B. Lát UI network/web

- **Flag:** tắt mặc định. Route `asset-map` không được đăng ký khi tắt, nên trả về như route không tồn tại. Bật bằng `VITE_ASSET_MAP=1` lúc build hoặc `localStorage['raptix.assetMap']='1'` trong trình duyệt.
- **Canvas (Cytoscape 3.34.4):** nhóm host gồm service và origin; chọn node mở inspector; cập nhật incremental (node đã có không bị layout lại); budget hiển thị 100 node và 250 cạnh, phần vượt được đếm và báo rõ.
- **Trạng thái và lỗi:** response của lần chọn cũ bị bỏ; tải thêm relation hoặc sitemap gặp 409 thì tải lại từ trang đầu; lựa chọn được lưu theo engagement trong trình duyệt (không phải trạng thái server).
- **Inspector:** nguồn, bằng chứng (episode, thời điểm), services của host, sitemap của origin với URL đã redact, phân trang "Load more".
- **Responsive:** dưới breakpoint `md` các cột xếp chồng, không tràn ngang.
- **Test UI:** 17/17 **pass** (model canvas, budget, flag, trang gồm lỗi, stale response, restart khi 409, saved view theo project, domain detail: sitemap, unsupported, nạp thêm services).
- **Real-mode trên stack thật** (`tools/verify-asset-map-real-mode.mjs`, tài khoản kiểm thử có membership operator): **pass** toàn bộ. Flag tắt không hiện map. Flag bật: hosts 2, services 2, canvas render, bằng chứng 1, origin 1, sitemap 3 endpoint, sitemap không lộ credential.
- **Canvas trên stack thật** (`tools/verify-asset-map-canvas.mjs`): **pass**. Chọn host vẽ 4 node và 3 cạnh; zoom bằng con lăn 1,58 → 1,66 → 1,58; điều hướng bàn phím chọn origin và mở sitemap; reload khôi phục lựa chọn; không tràn ngang ở 390 px.
- **Ngưỡng canvas ≤ 2 giây:** đo trên DB đã dọn dataset stress: **841 ms sau khi chọn host, pass.**

**Chưa làm trong B:** pan bằng kéo chuột không có chỉ số để kiểm chứng; expand và collapse nhóm chưa có điều khiển (nhóm luôn mở); saved view chỉ lưu asset đang chọn, chưa lưu camera hay pin; renderer riêng cho domain khác ngoài network và web.

### Ghi chú về độ trễ khi có dữ liệu lớn

Lần đo đầu của canvas (2.431 ms, vượt ngân sách) xảy ra khi dataset stress (≈500.000 node) còn trong cùng Neo4j. Đo API cùng lúc: neighborhood ≈1,05 s, detail ≈1,75 s, dù engagement đó chỉ có vài node. Nguyên nhân: query revision (`MATCH (src)-[r]->(dst) WHERE src.engagement = $engagement`) không có label và không có index trên quan hệ, nên Neo4j quét toàn bộ quan hệ của database. Latency tăng theo tổng kích thước graph. Theo chỉ dẫn, chưa tối ưu; xem follow-up.

## C. Triển khai lặp lại được

- **Build và deploy đúng code mới:** `docker compose -f docker-compose.web-raptix.yml -f docker-compose.web-runtime.yml build web-raptix-api web-runtime web-raptix-ui`, sau đó `up -d --no-deps` cho từng service. Postgres và Neo4j không bị recreate. Boot API báo "No pending migrations" (chạy lại là no-op).
- **Bước bootstrap rõ ràng:** `make webraptix-kg-bootstrap` (tương đương `exec -T web-runtime python -m raptix.knowledge.graph.bootstrap`). Chạy `apply_migrations` có sẵn, sau bước kiểm tra trùng `(key, engagement)`:
  - Neo4j sạch: áp đủ 6 migration (V001–V006), exit 0.
  - Có node trùng: exit 2, báo đúng `label key engagement copies`, không tạo constraint, không merge.
  - Sau khi xử lý trùng trong graph: áp 6 migration; chạy lại báo `none (already current)`.
  - DB live đã có sẵn 6 migration: chạy trên runtime đã deploy báo `applied 0`.
- **Test bootstrap và migration runner:** 31/31 **pass**.
- **Script tái lập trong repo `scripts/asset-map/`:** `gen_dataset.py` (tham số số host và endpoint), `ingest_dataset.py` (đi qua writer thật trong runtime), `measure_read_models.mjs` (đo qua build API đã deploy), `backfill_rehearsal.mjs`. Lệnh đầy đủ nằm trong phần đầu mỗi file.

## D. Coverage, backfill, live acquisition, stress

### Retained output: tìm kiếm và kết quả

Đã tìm trong `workspace/`, `report-do-an/`, `report-vdt/`, `web-sandboxes/`, `benchmarks/results/runs/` (mentor, silentium, reddish, htb, cve-bench, decision-eval, tool-eval) và các fixture của package:

- **Có output thật:** 9 file nmap XML từ benchmark runs (mentor: 6, silentium: 3). Các file text nmap (`nmap-high.txt`, `nmap-p-sV.txt`) cũng là output thật nhưng writer chưa có parser cho định dạng text.
- **Không có output thật:** httpx, katana, nuclei, ffuf, gobuster, sqlmap (chỉ xuất hiện trong text của agent), BloodHound hoặc output AD, APK, pcap, firmware, capture ICS hay wireless, output cloud, Slither hay Ghidra.
- **Kiểm tra thủ công:** `secretsdump`, `ldapsearch`, `smbclient`, `ffuf` xuất hiện trong state và trace của agent dưới dạng hướng dẫn, không phải kết quả tool.

### Network

- **Data integration với retained output (pass):** test `test_retained_nmap_outputs.py` (10/10) parse 8 file XML hoàn chỉnh; số host và số cổng mở khớp với đếm regex trên chính file (không dùng writer để kiểm chính nó). File thứ 2 (`services-top1000.xml`) bị cắt cụt (không có `</nmaprun>`, không có `Nmap done`): writer trả lỗi, không ghi gì. Đây là failure path có kiểm chứng.
- **Ingest qua deploy (pass):** 9 file đi qua writer thật trong runtime đã deploy. 8 file vào graph; file bị cắt cụt báo lỗi có cấu trúc, các file khác không bị ảnh hưởng. Catalog: 3 host (`10.129.228.102`, `10.129.245.103`, `10.129.14.169`) và 4 origin, không có rejected. Host `10.129.228.102` có 2 service, bằng chứng trỏ về file nguồn.
- **Live acquisition (pass):** nmap thật từ sandbox của stack web quét hai host lab (`172.31.0.2`, `172.31.0.5`, cổng 9999), và juice-shop (`host.docker.internal:3000`). Output XML giữ tại `apps/web/tests/fixtures/asset-map/network/` và ingest qua writer thật: 3 host, không rejected.

### Web

- **partial.** Không có output scanner web thật trong benchmark runs và sandbox. Sandbox `httpx` là client Python; katana không có. Dữ liệu endpoint hiện mới ở mức fixture.

### AD, cloud, mobile, wireless, IoT, ICS, OSINT

- **blocked.** Không có output tool thật, lab đang chạy hoặc hardware. Lý do cụ thể ghi trong ma trận. Không có demo nào được tính pass.

### Backfill rehearsal (pass)

Trên 50.000 identity của dataset stress:

| Bước | Kết quả |
|---|---|
| Reconcile lần đầu | 50.000 tạo, 0 rejected |
| Reconcile lần hai (replay) | 0 tạo, SHA-256 tập id không đổi |
| Xóa catalog (rollback) | 0 dòng |
| Reconcile sau rollback | 50.000 tạo, cùng SHA-256 tập id |

Tổng thời gian ba lần reconcile: 111,7 giây.

### Stress 10k host / 50k service / 200k endpoint

- Ingest 140 file (100 nmap, 40 katana) qua runtime: 184,3 giây, khoảng 500.000 node. Không có lỗi writer.
- Đo read model (n = 20 mỗi thao tác, sau warm-up), khi dataset còn trong DB:

| Thao tác | p50 | p95 | Ghi chú |
|---|---|---|---|
| overview (catalog) | 14 ms | 18 ms | ≤ 500 ms |
| members host, trang 50 | 11 ms | 14 ms | ≤ 500 ms |
| search "10." | 55 ms | 65 ms | ≤ 500 ms |
| neighborhood host | 3.282 ms | 3.499 ms | vượt 500 ms; do query revision |
| detail host (services) | 3.066 ms | 3.371 ms | vượt 500 ms; do query revision |
| detail origin (trang 100) | 3.289 ms | 3.452 ms | vượt 500 ms; do query revision |

- Thao tác đọc catalog đạt ngân sách. Thao tác có revision vượt ngân sách vì query revision quét toàn bộ quan hệ của DB, như mục B đã nêu.
- Đo `cypher-shell` riêng cho query revision: khoảng 5,8 giây (gồm overhead docker), cùng bậc với độ trễ đo qua API.

### Dọn dẹp (đã xong)

- Catalog và dòng `Engagement` của stress; KG stress (quan hệ theo lô, sau đó node; `KGRevision` tương ứng).
- Engagement tạm `asset-map-ui-eng`, `asset-map-live-eng`, `asset-map-retained-eng`, cùng catalog và KG theo `workspaceSlug` tương ứng.
- User kiểm thử `asset-map-verify`, session và membership.
- File tạm trong `/tmp` của runtime (`asset-map-data`, `ui-data`, `live-data`, `retained-data`) và Neo4j (`drop-stress-*.sh`, `v2-err.txt`).
- Kết quả: Postgres còn 2 engagement gốc, 0 catalog, `WebAsset` vẫn 3. Neo4j không còn node của engagement tạm; 6 `MigrationLog` của bootstrap và các node tri thức có sẵn từ Skillogy là dữ liệu hệ thống.

## Phase 6: hoạt động và điều hướng

- **Chưa làm.** Overlay công việc và finding trên asset cần attribution từ owning source. Hiện chưa có nguồn đó trong KG, nên sẽ chỉ hiện "unknown". Chuyển điều hướng Execution sang Asset Map chỉ làm sau gate phase 8 đầy đủ, theo plan. Flag vẫn tắt.

## Phase 8: rehearsal và gate

- Đã có: backfill rehearsal (pass), stress 10k/50k/200k có số đo (ngân sách catalog đạt; ngân sách có revision chưa đạt), real-mode UI trên stack thật (pass), canvas ≤ 2 giây trên DB sạch (841 ms, pass), bootstrap trên Neo4j sạch (pass).
- Chưa có: migration live test trong `apps/web/server/tests/asset-map-migration-live.ts` (không tạo file rỗng; rehearsal đã chạy bằng script). Ngưỡng latency có revision vẫn fail cho đến khi tối ưu revision.

## Lỗi test có sẵn (không do thay đổi này)

- `packages/raptix/tests/integration/kg/test_kg_ingest_live.py` và `test_kg_live.py`: 10 test fail với `missing $engagement scope`, vì test dùng tham số `$eng`. Không sửa trong lượt này.
- `apps/web/server/src/main.ts:266` có `prefer-const` (`sessionProvider`); `ruff` có 3 lỗi I001 có sẵn (`resolver.py`, `store.py`, `test_kg_live.py`); `web-contracts` chưa có cấu hình ESLint hợp lệ.

## Phát hiện và follow-up

1. **Query revision quét toàn bộ quan hệ của database** (`MATCH (src)-[r]->(dst) WHERE src.engagement = $engagement`). Latency tăng theo tổng kích thước graph, không theo engagement. Cần label hoặc index trên quan hệ, hoặc tách theo engagement. **Bắt buộc trước khi chạy stress cùng dữ liệu khác.** Chưa làm theo chỉ dẫn.
2. **Xóa hub node cần xóa quan hệ trước.** `DETACH DELETE` của lô 5.000 node hết heap khi một node có ~100.000 quan hệ. Cách dọn đúng: quan hệ theo lô 2.000, rồi node.
3. **Import package `raptix` mất 40–60 giây** do `_boot` resolve role và tạo LLM factory. Ảnh hưởng mọi lệnh CLI chạy trong runtime, kể cả bootstrap.
4. **Benchmark chưa có parser text nmap** (`nmap-high.txt`, `nmap-p-sV.txt`): chỉ XML được ingest.
5. **Canvas:** chưa có expand/collapse, pan chưa có kiểm chứng, saved view chưa lưu camera.
6. **Chưa có ADR** để chạy `apply_migrations` tự động khi khởi động production. Hiện chạy qua `make webraptix-kg-bootstrap`.
7. Cutover điều hướng mặc định: chưa làm, cần quyết định của bạn sau khi có gate đầy đủ.
