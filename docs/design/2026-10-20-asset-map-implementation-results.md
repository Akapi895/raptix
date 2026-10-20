# Asset Map: kết quả triển khai theo phase

- **Plan:** [implementation plan](2026-10-20-asset-map-implementation-plan.md)
- **Branch:** `asset-map` (từ `web-improve-refactor` tại `9b40b02e`). Không push, không mở PR.
- **Máy đo:** Windows 11, Intel Core i9-13900HX (24 nhân / 32 luồng), Docker Desktop 32 CPU / 10 GiB.
- **Trạng thái:** phase 1–4 (backend) và phase 8 (ngân sách read model) có gate đã chạy. Phase 4 UI, phase 5 canvas, phase 6 điều hướng và phần lớn phase 7 chưa làm. Chi tiết ở mục "Chưa hoàn thành".

Ký hiệu: **pass** = đã chạy và đạt; **blocked** = thiếu tool/lab/dữ liệu thật; **unverified** = chưa chạy.

## Backup và rollback (trước khi chạm DB)

- PostgreSQL `raptix_web_raptix`: `pg_dump -Fc`, lưu ngoài Git tại `C:\Users\tuanp\raptix-backups\asset-map-20261020\raptix_web_raptix.dump`. Restore thử vào DB cách ly `restore_check_asset_map`: 3 `WebAsset`, 2 `Engagement`, khớp dữ liệu gốc. **pass**.
- Neo4j (Community, không có online dump): export logic bằng driver, `neo4j-web.json` (2.245 node, 5.941 quan hệ), cùng thư mục backup. Restore thử vào container Neo4j tạm: 2.245 / 5.941, khớp. Container tạm đã xóa. **pass**.
- Rollback migration `20261031000100_asset_identity`: `prisma/rollback/20261031000100_asset_identity.down.sql`. Thử trên bản cách ly: upgrade tạo bảng và 2 index, rollback xóa bảng, `WebAsset` còn 3 dòng. **pass**.

## Phase 1: identity và ranh giới dữ liệu

- ADR-0094 (Accepted): PostgreSQL giữ catalog, Neo4j giữ quan hệ quan sát được, `assetId` xác định từ `(engagement, kind, namespace, canonicalKey, keyVersion)`.
- Core: `raptix_core.types.asset` (`AssetKind`, `AssetRef`, `asset_id`). Runtime: `raptix.knowledge.graph.asset_identity`.
- Coverage matrix: `docs/design/2026-10-20-asset-map-coverage-matrix.json`, khớp với entry point `raptix.domains`, `raptix.subagents`, không đếm số cố định. Test: `plugins/tests/test_asset_map_domain_coverage.py`.
- Gate: unit identity **pass** (22 test core và identity); core suite **pass** (186 test).

## Phase 2: chuẩn hóa đường ghi graph

- nmap và httpx ghi `asset_id` và các phần của nó lên node Host và Entrypoint. Key node không đổi.
- Migration `20261031000100_asset_identity`: additive, đã áp dụng lên DB live bằng `prisma migrate deploy` trong API container.
- Reconcile `POST /api/engagements/:id/assets/catalog/reconcile`: tính lại `assetId` bằng cùng công thức Python, idempotent.
- Gate:
  - Tương đương Python–TypeScript (test vector): **pass**, cùng một `asset_id`.
  - Live: ingest, replay và reconcile lần hai cho `created 0`: **pass**.
  - Test tích hợp round trip và replay đồng thời (Neo4j dev stack): **pass** (2 test).
  - Ingest khi Web API tắt: **pass** (API dừng ~1 phút, ghi vẫn thành công, API khỏe lại).

## Phase 3: read model cho graph lớn

- Overview, members (cursor gắn revision), search, neighborhood (bounded, trim theo byte budget). DTO và validator trong `apps/shared/web-contracts`.
- Cursor đổi revision thì trả 409, không bỏ hoặc lặp dữ liệu. Test: **pass** (21 test server, 5 test contract).
- Live với engagement tạm: overview, phân trang, search và neighborhood đều đúng số liệu. **pass**.

## Phase 4: chi tiết asset (backend)

- Ingest katana và arjun gắn `origin_asset_id` lên Endpoint. Origin cũng được quan sát như Entrypoint để reconcile đưa vào catalog (phát hiện trong phase 8, xem dưới).
- API detail: services cho host, sitemap và parameter cho web origin, loại khác trả `unsupported` kèm lý do.
- Gate: unit **pass** (test katana và origin); server **pass** (6 test detail); live (host 2 service, origin 2 endpoint có parameter) **pass**.
- UI inspector: **chưa làm**.

## Phase 5: canvas

- **Chưa làm.** Đã kiểm tra `cytoscape@3.34.4` có trên npm, chưa cài vào `apps/web`. Canvas cần Playwright trên stack thật để kiểm chứng layout, chưa có.

## Phase 6: hoạt động và điều hướng

- **Chưa làm.** Chưa có overlay và chưa có feature flag điều hướng.

## Phase 7: domain và specialist

- Coverage matrix đã liệt kê toàn bộ registry (11 domain pack, các subagent đã đăng ký). Mỗi hàng có trạng thái và lý do.
- Chỉ network và web có nguồn ghi thật và đã chạy end to end ở phase 2–4. Các domain khác: **blocked** (thiếu lab, hardware hoặc sample) hoặc **unverified** (chưa kiểm tra nguồn ghi). Không có demo nào được tính pass.

## Phase 8: migration, hiệu năng và rollout

### Phát hiện: KG chưa có constraint và index trên DB live

- `apply_migrations` (runner của V001–V006) không được gọi ở đường production. DB Neo4j web-stack không có `MigrationLog` và không có constraint nào, nên mọi MERGE theo `(key, engagement)` là quét toàn bộ.
- Hệ quả: ghi cạnh dùng `MATCH (s {key: ...})` không có label, mỗi dòng quét toàn graph. Dataset 1.000 host bị kẹt hơn 15 phút ở batch cạnh đầu tiên.
- Hành động:
  1. Kiểm tra không có nhóm trùng `(key, engagement)` trên DB live.
  2. Áp migration V001–V006 bằng chính runner của dự án. Đã ghi `MigrationLog` cho cả 6. Có thể đảo bằng `DROP CONSTRAINT`.
  3. Sửa store: thêm label đầu cạnh khi biết (từ cùng batch), dùng MATCH có label để tận dụng index. Trường hợp không biết thì giữ MATCH cũ.
- Kết quả: cùng dataset, ingest xong trong **8,0 giây** (trước đó bị kẹt). Sau khi bổ sung origin entrypoint: **13,1 giây**.
- Follow-up chưa làm: đường khởi động production vẫn chưa gọi `apply_migrations`. Cần ADR riêng vì có thể gặp dữ liệu trùng khi tạo constraint trên engagement cũ.

### Phát hiện: origin theo IP không được catalog

- nmap tạo Entrypoint theo hostname (`http://h501.lab.local:80`), katana tạo URL theo IP (`http://10.1.2.2:80`). Origin theo IP không có node Entrypoint nên không vào catalog, sitemap không truy cập được.
- Hành động: katana và arjun phát thêm observation Entrypoint cho origin của mỗi endpoint (key `entrypoint::<origin>/`). Hai origin theo IP và theo hostname vẫn là hai asset riêng, đúng như proposal.

### Dataset và số đo

- Dataset tổng hợp: 1.000 host, 5.000 service, 19.990 endpoint (chia đều, lệch 10 so với 20.000 do làm tròn), 2 entrypoint mỗi host. Host 0 có ~10.000 endpoint để đo phân trang sâu.
- Đo: `measure.mjs`, 20 lần mỗi thao tác sau khi warm, trên Postgres và Neo4j của stack web. Dữ liệu tổng hợp chỉ chứng minh scalability của view, không chứng minh độ phủ ingest.

| Thao tác | p50 | p95 | Byte | Ngân sách |
|---|---|---|---|---|
| overview (catalog) | 3 ms | 11 ms | 282 | p95 ≤ 500 ms |
| members host, trang 50 | 3 ms | 5 ms | 6.184 | p95 ≤ 500 ms |
| search "10.1.2" | 6 ms | 9 ms | 3.150 | p95 ≤ 500 ms |
| neighborhood host (Neo4j) | 36 ms | 47 ms | 7.575 | p95 ≤ 500 ms, ≤ 512 KiB |
| detail host (services) | 111 ms | 122 ms | 1.138 | p95 ≤ 500 ms |
| detail origin (endpoint trang 100) | 123 ms | 221 ms | 2.150 | p95 ≤ 500 ms, ≤ 512 KiB |
| detail origin lớn, offset ~4000 | 138 ms | 172 ms | 18.366 | p95 ≤ 500 ms, ≤ 512 KiB |

- Tất cả đạt ngân sách p95 500 ms. Thời gian chủ yếu nằm ở query đếm revision trên toàn engagement (`count(n)`, `max(lastupdated)`). Đây là điểm cần tối ưu nếu graph lớn hơn nhiều.
- Canvas tải trong ≤ 2 giây: **unverified**, cần phase 5.
- Dataset 10k/50k/200k (stress): **chưa chạy**. Plan yêu cầu chạy sau khi baseline đạt; baseline đã đạt, nhưng chưa có thời gian chạy stress.

### Gate tích hợp và rollout

- Rehearsal backfill trên DB thật: **chưa chạy**. Migration additive đã được kiểm chứng; catalog hiện có được tạo từ KG, không có backfill từ dữ liệu cũ.
- Real-mode UI qua Playwright: **blocked** (phase 5 và 6 chưa làm).
- Feature flag mặc định tắt và cutover: **chưa làm**. Execution vẫn là bề mặt hiện tại.

## Lỗi test có sẵn (không do thay đổi này)

- `packages/raptix/tests/integration/kg/test_kg_ingest_live.py` và `test_kg_live.py`: 10 test fail với `missing $engagement scope`. Test dùng tham số `$eng` thay vì `$engagement`, bị guard của store chặn. Hai file này không được sửa trong phase này.
- `apps/web/server/src/main.ts:266` có `prefer-const` (`sessionProvider`), và `ruff` có 3 lỗi I001 ở `resolver.py`, `store.py`, `test_kg_live.py`. Đều có sẵn từ trước.

## Chưa hoàn thành

- Phase 4 UI, phase 5 canvas (Cytoscape, chưa cài), phase 6 điều hướng và flag, phase 7 cho các domain còn lại, phase 8 rehearsal backfill, stress 10k/50k/200k, và real-mode Playwright.
- Follow-up: đưa `apply_migrations` vào đường khởi động production (cần ADR).
