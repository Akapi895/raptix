# Asset Map: kết quả kiểm chứng theo phase

- **Plan:** [implementation plan](2026-10-20-asset-map-implementation-plan.md)
- **Branch:** `asset-map`. Không push, không mở PR.
- **Trailer commit:** các commit từ lượt này có `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`, theo chỉ dẫn hệ thống (ưu tiên hơn quy định của repo). Các commit trước lượt này không có trailer; lịch sử không bị viết lại.
- **Lượt này:** các commit sau `ca3c78ec` (`git log ca3c78ec..HEAD`). Sửa bốn lỗi của phản hồi fe6f, đo lại revision trên HEAD, nối capture với evidence, chạy luồng web thật trên Juice Shop, rồi dọn dữ liệu stress.
- **Triển khai:** API, runtime và UI đã build và `up -d --no-deps` từ commit `7a1d7e0c`. Postgres và Neo4j không được tạo lại.
- **Máy đo:** Windows 11, Intel Core i9-13900HX, Docker Desktop. Neo4j Community 5.26 của stack web (`raptix-web-neo4j`, heap tối đa 256 MB), PostgreSQL 16.

## Trạng thái tổng

| Phase | Trạng thái | Ghi chú |
|---|---|---|
| 1. Identity và ranh giới | **Đạt** | Ma trận 31 hàng được đối chiếu bằng test với registry; ADR-0094 có hai amendment. |
| 2. Chuẩn hóa đường ghi | **Đạt cho các ca đã kiểm chứng** | Chỉ nmap có test tương đương giữa adapter legacy và parser registry (host, service, origin, cạnh). Các parser khác chưa có test tương đương; không suy ra từ nmap. |
| 3. Read model | **Đạt một phần** | Baseline 1.000 host đạt ≤ 500 ms khi đo riêng. Stress 10.000 host không đạt (neighborhood và detail khoảng 1,4–1,6 s). |
| 4. Detail và view theo domain | **Đạt một phần** | Capture association đạt trên dữ liệu thật. Chưa import được nmap XML và crawl JSONL làm capture (xem phần web). |
| 5. Canvas | **Đạt một phần** | Camera được lưu theo user và project, kiểm chứng trên browser. **Pin chưa đạt**, đã hoãn; không tính là đạt. |
| 6. Hoạt động và điều hướng | **Đạt một phần** | Overlay của host đạt; overlay của origin (`web_url`) chưa nối được. AI Workspace có run controls sau cờ, mới kiểm bằng unit test. Execution giữ nguyên; chưa cutover. |
| 7. Coverage domain | **Đạt một phần, còn blocked** | Network: dữ liệu thật đã tích hợp và nmap đã chạy live. Web: tích hợp dữ liệu thật đã đạt; tool web live chưa kiểm chứng. Các domain khác blocked hoặc unverified. |
| 8. Migration, hiệu năng, rollout | **Chưa đạt** | Gate latency trên stress chưa đạt; quyết định rollout chưa có. |

Ký hiệu: **đạt** = đã chạy và đạt; **không đạt** = đã chạy và không đạt; **blocked** = thiếu tool, lab, dữ liệu hoặc hardware; **unverified** = chưa chạy.

Hai trạng thái được giữ tách biệt:

- **Tích hợp dữ liệu đã kiểm chứng:** dữ liệu đi qua ingest → persistence → API → inspector. Web Juice Shop: đạt.
- **Tool/provider live đã kiểm chứng:** công cụ thật chạy và tạo output. nmap: đạt (chạy trong sandbox). Web: chưa; katana không có trong sandbox, và `httpx` trong sandbox là client Python thiếu phụ thuộc, không phải ProjectDiscovery httpx.

Ma trận 31 hàng là danh mục kiểm kê, không phải 31 domain đầu cuối; không dựng renderer riêng cho mọi hàng.

## Sửa theo phản hồi fe6f

1. **Redaction theo scheme (P1).** `is_web_url` và `redact_text` nhận diện scheme không phân biệt hoa thường, nên `HTTPS://user:pass@…` được redact như chữ thường. Regression: `test_asset_identity.py` (scheme hoa; URL lỗi trả `REDACTED`), `test_kgstore_unit.py` (ghi qua store, không còn credential trong label hoặc property).
2. **Ngữ nghĩa service của nmap (P2).** Parser registry `nmap_xml` ghi cùng key service `service::{ip}:{port}`, cùng label, cùng cạnh `HOSTS` (Host → Service) và `HAS` (Host → Entrypoint) cho cổng web. `TestRegistryAndLegacyWritersAgree::test_services_web_origins_and_edges_have_the_same_shape_from_both_writers` so sánh shape của service, origin và cạnh trên các fixture nmap đầy đủ, không chỉ ID host.
3. **Scope và request guard (P2).** `AssetMapPage` gắn generation cho engagement. Mọi response bất đồng bộ kiểm tra generation trước khi ghi state, và state của project cũ được xóa khi đổi project. Test: `AssetMapPage.test.tsx`.
4. **Phân trang và completeness (P2).** Hosts, Origins, Services và Sitemap có cursor, `completeness` (loaded, total, hasMore, truncated) và nút **Load more**. Cursor bị 409 khi revision đổi thì tải lại từ trang đầu. Test: `AssetMapPage.test.tsx`, `domain-detail.test.tsx` (trang kế không lặp hàng đã có).

"Phase 2 đạt" được hiểu là: các ca đã kiểm chứng đạt. Chưa phải mọi đường ghi network và web đã tương đương.

## Revision (tối ưu, không đổi ngân sách)

- **Nguyên nhân cũ:** truy vấn revision quét mọi quan hệ của database, không bị giới hạn theo engagement.
- **Thay đổi:** `KGRevision {scope}` có counter. `KGStore.execute_write` và `record_observations` tăng counter trong cùng transaction với lần ghi. Đọc revision là một lookup: `MATCH (v:KGRevision {scope: $engagement}) RETURN coalesce(v.counter, 0)`.
- **Kiểm chứng:** `test_execute_write_advances_the_engagement_revision_in_the_same_transaction`, `test_revision_is_one_counter_lookup_not_a_scan_of_the_graph`, và live `test_deletes_advance_the_revision_that_cursors_are_bound_to`.

## Đo lại latency trên HEAD

Dataset sinh bằng `scripts/asset-map/gen_dataset.py`. Đo bằng `scripts/asset-map/measure_read_models.mjs` trong container API, sau khi reconcile catalog. Ngân sách 500 ms không đổi.

**Baseline** (`eng_assetmap_baseline`, 1.000 host, 5.000 service, 19.990 endpoint; 20 lần đo, p50 / p95 tính bằng ms):

| Thao tác | p50 | p95 | Ngân sách | Kết quả |
|---|---|---|---|---|
| overview (catalog) | 2 | 4 | ≤ 500 | đạt |
| members host, trang 50 | 3 | 3 | ≤ 500 | đạt |
| search "10." | 7 | 9 | ≤ 500 | đạt |
| neighborhood host | 157 | 182 | ≤ 500 | đạt |
| detail host (services) | 151 | 179 | ≤ 500 | đạt |
| detail origin (trang 100) | 166 | 196 | ≤ 500 | đạt |

**Stress** (`eng_assetmap_stress`, 10.000 host, 50.000 service, 199.990 endpoint; 10 lần đo). Báo cáo riêng, không thay thế baseline:

| Thao tác | p50 | p95 | Ngân sách | Kết quả |
|---|---|---|---|---|
| overview (catalog) | 9 | 11 | ≤ 500 | đạt |
| members host, trang 50 | 9 | 10 | ≤ 500 | đạt |
| search "10." | 47 | 50 | ≤ 500 | đạt |
| neighborhood host | 1.440 | 1.530 | ≤ 500 | **không đạt** |
| detail host (services) | 1.348 | 1.444 | ≤ 500 | **không đạt** |
| detail origin (trang 100) | 1.466 | 1.591 | ≤ 500 | **không đạt** |

**Số đo bị nhiễu, không dùng làm kết quả.** Lần đo baseline đầu tiên trên HEAD được thực hiện khi dataset stress (khoảng 500.000 node) vẫn nằm trong cùng Neo4j: neighborhood p50 504 ms, detail host 899 ms, detail origin 927 ms. Sau khi xóa stress và đo lại, con số trở về mức trên.

**Nguyên nhân** (đã đo trước đó trên stress, PROFILE: 1.600.412 DbHits): lookup theo asset là `MATCH (c) WHERE c.engagement = $e AND c.asset_id = $id`. Truy vấn không có label và không có index trên `asset_id`, nên quét mọi node của database. Vì vậy độ trễ phụ thuộc tổng kích thước graph của mọi engagement, không chỉ engagement đang đọc. Đây là phần còn lại của phase 3 và phase 8; cần quyết định (xem phần cuối).

## Luồng web thật (Juice Shop)

Engagement `asset-map-webflow` (id `cmvhgj34i000042pktbsdubxs`), target `http://host.docker.internal:3000`, tạo bằng API. Owner là `asset-map-verify`.

| Bước | Việc làm | Kết quả |
|---|---|---|
| Phát hiện | nmap `-sT -sV -Pn` chạy trong sandbox (`raptix-web-raptix-web-sandbox-1`) tới `host.docker.internal`, cổng 22, 80, 443, 3000, 8080, 8443 | Mở: 22 (ssh), 80, 3000 (Juice Shop, HTTP 200), 8080 (nginx). XML ghi vào `findings/evidence/nmap-juice.xml`. |
| Crawl | Script python3 chỉ GET, 8 request, tất cả 200. Mỗi dòng ghi `crawler: scripted-python-crawl (not katana)` | `findings/evidence/scripted-crawl-juice.json`. Katana không có trong sandbox. |
| Ingest | Trong runtime đã triển khai. nmap qua dispatcher `ingest("nmap_xml")`. Crawl qua `_surface_observations` với source `scripted-crawl`, đi qua wrapper gắn artifact | nmap: 7 node, 6 cạnh (revision 4). Crawl: 9 node tạo, 16 merge, 9 cạnh (revision 5). Trước đó xóa 18 node cũ của engagement. |
| Asset | Thêm inventory host `host.docker.internal` và web_url `http://host.docker.internal:3000` (pending). Reconcile catalog | 5 identity được tạo. |
| Sitemap | `GET .../asset-map/assets/<origin>/detail` | 8 endpoint, source `scripted-crawl`. Provenance: `artifactRef: findings/evidence/scripted-crawl-juice.json`, capture `87b9a924…`, digest `a354aed5…`. |
| Finding | Hai finding mức informational, mô tả đúng những gì quan sát được | Finding trên host nối overlay: linked 1. Finding trên origin: không nối (xem gap). |
| Evidence | Attach capture: crawl vào finding origin, nmap text vào finding host. Phân loại capture crawl là `standard` để mở được | Attach 200. `content` 200, sha256 khớp digest đã ghi. |

**Browser trên engagement này:**

- Real-mode, `--origin http://host.docker.internal:3000`: **10/10 pass**. Canvas sẵn sàng 1.394 ms sau khi chọn host (budget 2 s), trên dataset nhỏ (7 node).
- Canvas: **9/9 pass**. Node 7, cạnh 6. Zoom 1,15 → 1,21 → 1,15. Kéo làm pan. Thu gọn 7 → 1 → 7. Refresh giữ digest vị trí. Origin mở bằng bàn phím có 8 endpoint. Saved view mở lại sau reload. Không cuộn ngang ở 390 px.
- **Lưu ý về bước khôi phục camera:** 3 → 3. Giá trị này trùng với mức fit mặc định của origin nên bước này chưa phân biệt được khôi phục với mặc định. Cần một case có mức zoom khác để kết luận.

**Gap và giới hạn, không sửa trong lượt này:**

- **Finding trên `web_url` không hiện trên overlay của origin.** `catalogIdForWebAsset` chỉ ánh xạ WebAsset kind `host`. Cần ánh xạ web_url sang web_origin theo canonical key của ADR-0094, và phải giữ parity giữa TypeScript và Python.
- **Cùng một máy, hai identity.** nmap ghi host theo IP `192.168.65.254`, còn crawl dùng hostname `host.docker.internal`. Catalog có cả `host` và `dns_name`. Không gộp, vì chưa có bằng chứng resolution trong graph.
- **nmap XML không import được thành capture.** `artifacts-service` chỉ nhận `json`, `pdf`, `bin`, `gif`, `jpg`, `png`, `txt`. File `nmap-juice.xml` bị bỏ qua với lý do `unsupported file type`, nên observation của nmap hiển thị "chưa được import thành capture". Bản text `nmap-juice.txt` được import và đính vào finding như bằng chứng của cùng lần quét, nhưng không phải nguồn của observation. Hành vi này đúng với quy tắc không đoán, nhưng nmap chưa được nối.
- **Crawl ghi JSON thay vì JSONL.** `.jsonl` không nằm trong danh sách import. Các hàng giữ cấu trúc katana (`request.endpoint`, `status_code`).
- **Source của crawl.** Adapter katana gán `source="katana"` cứng, nên crawl được ingest qua `_surface_observations` với source `scripted-crawl`. Đây là hàm private, dùng cho lần kiểm chứng này; không có thay đổi runtime.
- **Tool web live chưa có.** Katana không có trong sandbox. `httpx` trong sandbox là client Python thiếu phụ thuộc (`httpx[cli]`), không phải ProjectDiscovery httpx.

## Capture association (phase 4)

- **Runtime.** File dưới `/workspace/<engagement>/` nhận `source_artifact_ref` là đường dẫn tương đối trong engagement. `_ArtifactStampedStore` chỉ thêm prop nếu chưa có, giữ nguyên shape của adapter và delegate các phương thức khác. Test: `test_kg_ingest_unit.py`.
- **Web.** `evidenceRefs` nối theo `(engagement, producer = workspace:<artifactRef>)`. Artifact chưa import có `capture: null` và được báo là unlinked. Capture của engagement khác không bao giờ được nối. Guard `isEvidenceRef` kiểm tra kiểu của cả hai trường mới.
- **UI.** Inspector hiển thị capture, classification và digest (prefix), cùng link tới `/api/engagements/:id/artifacts/captures/:captureId/content`. Capture `unclassified` ghi "classify to open" vì server giữ bytes cho tới khi phân loại. Artifact không được import ghi "not imported as a capture".
- **Không đoán.** Không nối theo tên file hay digest trùng. Dữ liệu cũ không có liên kết được đánh dấu unlinked.

## Camera và controls (phase 5, 6)

- **Camera.** Saved view là JSON `{assetId, camera: {zoom, x, y}}`, khóa theo user và project (`raptix.assetMap.selected.<actor>.<engagement>`). Giá trị cũ dạng id trần vẫn đọc được. Camera được áp dụng sau layout đầu tiên. Test: `saved-view.test.ts`, `canvas.test.tsx`. Browser: xem phần web.
- **Pin.** Đã hoãn và **chưa đạt**. Phạm vi của phase 5 được cập nhật trong plan để ghi rõ điều này.
- **AI Workspace run controls.** `AiRunControls` nằm trong tab AI Workspace và chỉ hiện khi cờ asset map bật. Dùng `useRuntimeThreads` và `ThreadRuns` có sẵn. Execution giữ nguyên controls. Chưa kiểm trên browser; có 3 unit test.

## Lệnh đã chạy trong lượt này

- Runtime: `uv run pytest -q` trên `test_kg_ingest_unit.py`, `test_surface_inventory_ingest.py`, `test_kgstore_unit.py` và `packages/raptix/tests/unit/knowledge`: 247 passed. `ruff check` trên các file runtime đã đổi: sạch.
- Web (trước commit cuối, cùng lượt): UI asset-map 46 passed; server `asset-domain-details` 15 passed; projection và contracts đều pass; typecheck exit 0.
- Triển khai: `docker compose -f docker-compose.web-raptix.yml -f docker-compose.web-runtime.yml build web-raptix-api web-runtime web-raptix-ui`, rồi `up -d --no-deps` cho ba service. Cả ba healthy.
- Browser trên `asset-map-webflow`: real-mode 10/10; canvas 9/9 (`verify-asset-map-canvas.mjs` có thêm `--host`, mặc định là host đầu tiên trong danh sách; trước đây cố định dải `10.`/`172.`).
- Đo: `measure_read_models.mjs` cho baseline (hai lần: một lần bị nhiễu, một lần đo riêng) và stress.

## Dọn dẹp

- **Đã xóa:** 499.980 node KG của `asset-map-stress`, xóa theo label theo lô 500 qua `KGStore.execute_write`; KGRevision `asset-map-stress`. Từ Postgres: 50.000 dòng `AssetIdentity` và dòng `Engagement` của `eng_assetmap_stress`. Tám `WebSession` của `wu_assetmap_verify`. File mật khẩu tạm và cookie jar. Hai thư mục dataset stress cục bộ (khoảng 26 MB). Dataset có thể tái tạo bằng `gen_dataset.py` (deterministic).
- **Giữ lại:** engagement `asset-map-baseline` (49.980 node) để đo lại; engagement `asset-map-webflow` (18 node, hai finding, hai capture, 5 identity) để người dùng mở lại; user `asset-map-verify`; dataset baseline cục bộ (khoảng 2,5 MB).
- **Lưu ý:** lần xóa đầu tiên theo một lệnh Cypher lớn và lần `delete_engagement` thất bại vì heap 256 MB của Neo4j. Không có dữ liệu nào bị mất trong các lần thất bại đó; số đếm được kiểm lại sau mỗi lần.

## Lỗi test có sẵn (không do thay đổi này)

- `packages/raptix/tests/integration/kg/test_kg_ingest_live.py` và `test_kg_live.py`: 10 test lỗi `missing $engagement scope` (dùng tham số `$eng`). Không chạy lại trong lượt này.
- `apps/shared/web-contracts/tests/run-api.test.ts`: 1 test lỗi `isMembersView`. `run-api.ts` không đổi kể từ `ca3c78ec`, nên lỗi có sẵn từ trước. Không sửa vì ngoài phạm vi.
- `apps/web/server/src/main.ts:266` `prefer-const` (`sessionProvider`): ngoài phạm vi.

## Việc cần người dùng quyết định

1. **Lookup theo `asset_id` (chặn stress 10.000 host).** Hai hướng: (a) thêm index hoặc label cho `asset_id` trong một migration additive, rồi đo lại; (b) giữ kết quả hiện tại và giới hạn rollout tới cỡ baseline. Ngân sách 500 ms không đổi. Lưu ý: độ trễ hiện phụ thuộc tổng node của mọi engagement, nên hướng (a) cũng sửa tác động giữa các engagement.
2. **Gộp identity IP và DNS name.** Chính sách khi nmap ghi host theo IP còn crawl ghi theo hostname cho cùng một máy.
3. **Overlay cho `web_url`.** Có ánh xạ WebAsset `web_url` sang web_origin hay không, và theo quy tắc nào của canonical key.
4. **Chính sách import capture.** Có cho phép XML (nmap) và JSONL làm capture không, hay giữ như hiện tại.
5. **Tool web live.** Cài katana và ProjectDiscovery httpx vào sandbox để có tool live, hay chấp nhận trạng thái "tích hợp dữ liệu" như hiện tại.
6. **Pin.** Đưa vào pilot hay để sau.
7. **Cutover và rollout.** Giữ cờ tắt mặc định. Quyết định khi nào Asset Map thay Execution, sau khi các mục trên được chốt. Execution và deep link cũ được giữ nguyên.
