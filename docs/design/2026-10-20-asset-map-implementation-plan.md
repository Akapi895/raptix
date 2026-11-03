# Implementation plan: Asset Map và graph đa domain

- **Trạng thái:** Proposed; chưa triển khai hoặc chạy các gate trong plan này.
- **Ngày:** 2026-10-20.
- **Thiết kế tham chiếu:** [Asset Map: canvas, mô hình asset và quản lý graph](../proposals/2026-10-20-asset-map-canvas-and-graph.md).
- **Phạm vi:** chuẩn hóa dữ liệu asset/quan hệ, xây các view theo domain và canvas, thay bề mặt Execution cho toàn bộ domain/specialist hiện có. Network/web là lát triển khai đầu, không phải giới hạn sản phẩm; cloud/mobile chỉ là ví dụ. Giữ logic lập kế hoạch của agent hiện tại để đánh giá riêng tác động của thay đổi dữ liệu/UI.

## Điểm nghẽn và nguyên tắc triển khai

| Điểm nghẽn | Cần giải quyết ở đâu |
|---|---|
| Chưa chốt authority của asset identity; inventory và KG đang có ID khác nhau | Phase 1. Phương án catalog PostgreSQL trong đề xuất chưa phải quyết định; runtime phải ghi observation được khi Web server không hoạt động |
| Nhiều đường ghi: agent record, scanner adapters, parser registry và legacy tools; quy tắc key/quan hệ chưa thống nhất | Phase 2. Chuẩn hóa bằng code, giữ raw source/provenance và compatibility; không bắt LLM tự deduplicate |
| Graph API hiện trả lát giới hạn 400 node/1.200 cạnh, chưa có overview/expand/search theo nhu cầu canvas | Phase 3. Bổ sung read models và số liệu completeness; tăng limit đơn thuần không giải quyết graph lớn |
| Có dữ liệu hoặc tên loại domain không đồng nghĩa đã có detail API/renderer đầy đủ | Phase 1 lập coverage matrix toàn bộ domain/specialist; phase 4 và 7 kiểm tra source → API → view. Không ép asset phi-IP thành host |
| Execution đang giữ controls và deep links cần dùng | Phase 6. Chuyển đủ chức năng trước khi bỏ entry; không xóa runtime history hoặc API |
| Chưa có kết quả đo canvas lớn, migration và liên kết catalog–KG–artifact trên stack thật | Phase 8. Đây là release gate, không được thay bằng unit tests hoặc mock screenshots |

**Thứ tự:** 1 → 2 → 3; phase 4 và 5 cùng dựa trên 3; phase 6 sau 4–5; phase 7 sau nền tảng 2–5; phase 8 kiểm chứng toàn bộ scope. Phase 6 chuẩn bị chuyển điều hướng, chỉ cutover mặc định sau gate phase 8. Đây là thứ tự phụ thuộc, không phải chỉ dẫn chạy nhiều agent.

**Baseline phạm vi:** đối chiếu [plugin manifests](../../plugins/), [runtime subagent registrations](../../packages/raptix/pyproject.toml) và [graph registry](../../langgraph.json), cùng cấu hình activation. Bao gồm network, web/API, Active Directory, cloud, mobile, wireless, IoT, ICS/OT, smart contracts, reversing, phishing, OSINT, DFIR/forensics, supply chain và defense/blue cell. Các vai trò recon/exploit/postexploit, analyst và pipeline scanner/detector/verifier/patcher/exploiter cũng phải được rà soát nguồn ghi; role không mặc nhiên là một asset type hoặc một plugin domain. Registry hiện tại, không danh sách ví dụ này, là nguồn đối chiếu khi triển khai.

Các đường dẫn test ghi **Tạo** là file dự kiến, chưa tồn tại. Ưu tiên mở rộng file có cùng trách nhiệm thay vì tạo suite trùng. Tên module triển khai có thể đổi, nhưng giữ test ở đúng package sở hữu hành vi.

## Phase 1 — Identity và ranh giới dữ liệu

**Phụ trách:** lập coverage matrix toàn bộ domain/specialist từ registry: loại entity/quan hệ, nguồn ingest/artifact, API, inspector/renderer và acceptance fixture. Chốt ADR về identity, canonical key/namespace, asset–locator–surface–scope, authority và mapping giữa các kho; public contract framework-free trong Core; runtime độc lập với Web.

**Pass khi:** không bỏ sót domain hoặc nguồn ghi của specialist trong matrix; phân biệt registered, config-gated, partial và unverified. Có quyết định kiến trúc rõ trước code boundary mới; identity hỗ trợ cả network, resource, identity, application, device và artifact-backed entity mà không ép dưới IP. Scope/evidence giữ authority hiện có; luồng ghi khi Web unavailable được xác định rõ.

**Đầu ra gate:** ghi coverage matrix có thể kiểm tra bằng máy và quyết định ADR. Mỗi hàng chỉ rõ source/owner, identity/relationship, read model, renderer, fixture và mức kiểm chứng; vai trò không ghi asset có lý do và đường liên quan thay vì adapter giả. Chốt nơi cấp ID, version normalization, xử lý concurrent writes/reconciliation và ngân sách dữ liệu/hiệu năng trước khi triển khai lớp phụ thuộc.

**Test:**
- **Tạo** `packages/raptix-core/tests/test_asset_identity_contracts.py`: identity/namespace, asset reference và compatibility của contract.
- **Tạo** `packages/raptix/tests/unit/knowledge/test_asset_identity.py`: normalization, ca không được merge và key ổn định cho các nhóm identity trong matrix. Cập nhật `test_public_api_stability.py`/CHANGELOG nếu Core public API đổi.
- **Tạo** `plugins/tests/test_asset_map_domain_coverage.py`: đối chiếu coverage matrix với domain/subagent/graph metadata, không dùng một số lượng domain hardcode để thay kiểm tra nội dung.

## Phase 2 — Chuẩn hóa các đường ghi graph

**Phụ trách:** xây boundary ghi chung cho agent record, scanner/parser, plugin outputs và legacy writes; nối lát network/web và giữ compatibility các domain còn lại. Thêm schema migration/mapping, artifact references và retry/reconcile theo ADR; phase 7 hoàn thiện mappings đặc thù. Không sửa thuật toán lập kế hoạch agent trong phase này.

**Pass khi:** cùng output ingest lại, kể cả đồng thời, không nhân đôi entity/quan hệ; các đường ghi đã nối resolve nhất quán, giữ supporting sources và key/reference cũ. Domain chưa chuyển tiếp tục ghi/đọc được. Web unavailable không chặn observation; lỗi giữa các bước ghi replay/reconcile được. Migration schema có upgrade/rollback test ngay khi thêm, không chờ phase 8.

**Test:**
- **Mở rộng** `packages/raptix/tests/unit/middleware/test_kg_ingest_unit.py`, `test_kg_autoingest.py` và `packages/raptix/tests/unit/knowledge/ingest/test_materialize.py`: cùng kết quả semantic giữa các đường ghi, provenance và failure paths.
- **Tạo** `packages/raptix/tests/integration/kg/test_asset_ingest_roundtrip.py`: ghi/đọc Neo4j thật, replay và recovery; chạy thêm kho persistence được ADR chọn khi cần, gồm ca Web service tắt.
- **Tạo** `apps/web/server/tests/asset-map-migration-live.ts` nếu có catalog/schema Web mới: upgrade/rollback, mapping và concurrent writes trên DB thật; phase 8 mở rộng file này cho backfill rehearsal.

## Phase 3 — Read models cho graph lớn

**Phụ trách:** shared DTO/validators, server services và API cho overview, group members, neighborhood, search/locate; stable asset references, nguồn, revision, totals và cursor. Giữ compatibility với endpoint graph cũ trong thời gian chuyển đổi.

**Pass khi:** tìm được tài sản ngoài vùng đang tải; paging theo revision/snapshot hoặc restart rõ ràng khi revision đổi, không âm thầm bỏ/trùng dữ liệu. Phân biệt loaded với total, unknown total với zero, truncated/unavailable với empty. Query/traversal và payload đều có giới hạn; lookup có index phù hợp. Mọi read kiểm tra quyền/project, gồm thành viên được phép, không chỉ owner.

**Test:**
- **Tạo** `apps/shared/web-contracts/tests/asset-map.test.ts`: validators và semantics của identity, paging, completeness, availability.
- **Tạo** `apps/web/server/tests/asset-map-projection.test.ts`; **mở rộng** `graph-service.test.ts` khi dùng lại projection: revision đổi giữa các trang, query bounds, nhóm/lân cận, member/foreign IDs, redaction và nguồn lỗi; xác minh query thực trên Neo4j ở gate tích hợp.

## Phase 4 — Asset detail và view theo domain

**Phụ trách:** inspector chung, domain detail API và renderer seam cho toàn bộ matrix; hoàn thiện network services và web sitemap/API inventory làm lát đầu tiên. Nối asset ↔ observation ↔ artifact; domain chưa cần view đặc thù dùng typed inspector giữ đúng loại, thuộc tính và nguồn, không rơi về host/IP.

**Pass khi:** chọn IP thấy services; mở web origin thấy sitemap có method/parameters và nguồn capture; hàng nghìn endpoint không bung thành node toàn cảnh. View có paging/search, phân biệt thiếu dữ liệu với nguồn lỗi, giữ asset context khi quay lại và không giả lập phần chưa hỗ trợ.

**Test:**
- **Tạo** `apps/web/server/tests/asset-domain-details.test.ts`: service/endpoint grouping, capture association, paging, thiếu nguồn và truy cập sai project.
- **Tạo** `apps/web/src/features/asset-map/domain-detail.test.tsx`: chọn đúng renderer, sitemap/inspector flow, quay lại context và unsupported state.

## Phase 5 — Canvas sơ đồ

**Phụ trách:** chọn layout engine sau thử nghiệm nhỏ; canvas node/card, cạnh có nhãn, nhóm mở rộng, inspector, search/focus, filters, pan/zoom, pin và view state. Canvas dùng projections, không render nguyên KG hoặc dùng code tree thay sơ đồ.

**Pass khi:** một IP với HTTP/HTTPS được gom nhưng vẫn mở từng service/origin; nhóm mở tại chỗ, camera/selection/pin không nhảy khi cập nhật. Saved view khôi phục sau reload đúng user/project, không sửa canonical asset. CIDR không tạo sẵn từng host; graph có giới hạn, keyboard/list tương đương và cơ chế refresh/invalidation có revision để nhận discovery mới.

**Phạm vi pass cập nhật (2026-10-21):** pin được hoãn sang lượt sau. Mục pin trong tiêu chí trên **chưa đạt** và không được tính là đạt. Camera (zoom, pan) được lưu trong saved view theo user và project. Browser đã kiểm chứng với zoom và pan khác mặc định: sau reload khôi phục đúng, xem phase 5 của kết quả. Pin vẫn deferred.

**Test:**
- **Tạo** `apps/web/src/features/asset-map/canvas-model.test.ts` và `canvas.test.tsx`: grouping, visible budget, selection, stale responses, revision refresh, saved-view reload/isolation và inspector/keyboard behavior.
- **Tạo** `apps/web/tools/verify-asset-map-canvas.mjs`: dùng Playwright hiện có với fixture xác định để kiểm tra pan/zoom, expand, vị trí và responsive trong browser thật. Không dùng jsdom làm bằng chứng layout hay gọi fixture gate là real-backend E2E.

## Phase 6 — Hoạt động và điều hướng

**Phụ trách:** overlay trạng thái công việc/finding trên asset; đặt controls và diagnostics trong AI Workspace theo context; chuyển navigation Execution sang Asset Map, xử lý history/deep links và phân vai lại Analysis.

Overlay dùng asset references từ owning source; thiếu attribution thì hiện unknown/unlinked, không đoán từ message text, hostname tương tự hoặc run mới nhất.

**Pass khi:** người dùng điều hướng bằng tên mục tiêu/asset/công việc; ID kỹ thuật nằm trong details. Pause/resume/cancel và các action hiện có vẫn tới đúng đối tượng; emergency stop giữ scope riêng. Lịch sử, evidence và link cũ vẫn truy được; không còn hai bề mặt hiển thị cùng run table.

**Test:**
- **Mở rộng** `apps/web/src/shell/shell.test.tsx` và `apps/web/src/real/screens/workspace.test.tsx`: navigation, history/redirect và controls sau chuyển vị trí.
- **Mở rộng** `apps/web/src/features/operations/runtime-tab.test.tsx`: hồi quy lifecycle/controls còn được tái sử dụng; chỉ retire test của UI cũ sau khi hành vi tương ứng được kiểm tra ở nơi mới.
- **Mở rộng** `apps/web/server/tests/asset-map-projection.test.ts`: overlay join qua asset references, attribution thiếu hoặc sai project không gắn nhầm hoạt động/finding lên node.

## Phase 7 — Hoàn thiện coverage toàn bộ domain/specialist

**Phụ trách:** hoàn thiện từng hàng của coverage matrix sau lát network/web: AD, cloud, mobile, wireless, IoT, ICS/OT, contracts, reversing, phishing, OSINT, DFIR, supply chain và defense; rà cả các vai trò dùng chung/pipeline. Bổ sung mapping, domain detail và cross-domain references qua seams hiện có; chọn renderer chuyên biệt theo ngữ nghĩa dữ liệu, không tạo một stack cho mỗi role.

**Pass khi:** mọi hàng matrix cần mapping có retained output thật hoặc dữ liệu lab chạy qua ingest → persistence → API → inspector, kèm failure path; identity/quan hệ và evidence resolve đúng. Shared typed inspector được chấp nhận nếu đáp ứng tác vụ đã nêu trong matrix; sitemap, permissions, radio/protocol inventory, binary/contracts analysis hoặc forensic timeline dùng view riêng khi cần. Gate tích hợp dữ liệu bằng retained output không chứng minh tool/hardware chạy live: ghi riêng acquisition smoke và config-gated/unverified. Không dùng demo hoặc chỉ cloud/mobile để thay coverage toàn bộ scope.

**Test:**
- **Tạo** `packages/raptix/tests/unit/knowledge/test_asset_domain_mapping.py`: parameterized fixtures theo matrix, kiểm tra identity, quan hệ, provenance và cross-domain references; mở rộng integration roundtrip của phase 2 cho các domain mới. Fixture Python ở owning Python test package; Web fixture chỉ phục vụ DTO/renderer, tránh Python tests phụ thuộc cây frontend.
- **Tạo** `apps/web/server/tests/asset-domain-mapping.test.ts` và `apps/web/src/features/asset-map/domain-renderers.test.tsx`: parameterized API/renderer cases, typed fallback và partial/unavailable states. Mẫu trong `apps/web/tests/fixtures/asset-map/<domain>/`; giữ provenance, loại bỏ secrets và xác minh flow thực của từng domain được công bố khả dụng.

## Phase 8 — Migration, hiệu năng và rollout

**Phụ trách:** backfill/alias dữ liệu cũ, reconciliation và rollback; real-mode integration gate; đo graph lớn và tối ưu để đạt ngân sách đã chốt ở phase 1. Chạy rollout theo engagement/domain đã đạt gate, bảo toàn dữ liệu gốc.

**Pass khi:** migration chạy lại an toàn, ambiguous matches được báo thay vì merge đoán, ID/link/evidence cũ còn resolve và có đường rollback. Một engagement thật đi từ ingest tới canvas/detail/controls; outage và cross-store restart có kết quả rõ. Domain coverage được đối chiếu lại với registry/activation tại thời điểm rollout; baseline network/web không thay thế kiểm chứng các domain còn lại. Overview, expand, search và các domain detail lớn đạt ngân sách payload/latency/browser đã chốt trên dataset và máy đo được ghi lại.

**Test:**
- **Mở rộng** `apps/web/server/tests/asset-map-migration-live.ts` của phase 2: rehearsal backfill trên PostgreSQL/Neo4j thật theo authority đã chọn; dữ liệu cũ, replay, concurrent ingest, crash/reconcile và rollback trên dữ liệu test cách ly. Nếu ADR không thêm persistence Web, đặt rehearsal ở owning runtime integration suite thay vì tạo file server không có trách nhiệm.
- **Tạo** `apps/web/tools/verify-asset-map-real-mode.mjs`: browser + API/KG thật, không intercept để thay dữ liệu; thu kết quả flow, failure paths và số đo hiệu năng. Dùng fixture nguồn nhỏ trong `apps/web/tests/fixtures/asset-map/`, sinh dataset lớn và lưu output ngoài source fixtures.

## Quy tắc xác nhận pass

- Mỗi phase có thể gồm nhiều patch; giữ contribution budget và [integration execution contract](../../apps/web/.scratch/frontend-backend-integration/execution.md). Một phase không đồng nghĩa một PR lớn.
- Pass dựa trên hành vi đã chạy, không dựa trên file test tồn tại. Regression mới phải được thấy fail trước fix; mock/unit evidence không thay cho gate Neo4j/DB/browser thật tương ứng.
- Chọn test theo file/package bị ảnh hưởng, không chạy full suite mặc định. Python: `uv run pytest <file>::<test>`; JS: `npm run test --workspace=<owner> -- <file>`. Build shared `dist/` và generate Prisma trước các server checks khi liên quan.
- Ghi exact commands, cấu hình/domain, dataset, kết quả và phần chưa chạy. Gate bắt buộc chưa chạy là **blocked/unverified**, chưa tính phase pass. Ngưỡng hiệu năng phải được chốt trước phép đo nghiệm thu, không đặt lại theo kết quả để hợp thức hóa pass.
- Mỗi phase có gate hẹp kiểm chứng đường thực thi vừa thay đổi; phase 8 là rehearsal tổng hợp, không phải lần đầu chạm DB/browser thật. Phân biệt data-integration verified bằng retained output với live acquisition verified; phần chưa có dữ liệu kiểm chứng giữ blocked. Thay đổi scope cần quyết định rõ, không âm thầm loại domain để tính pass.
- Plan này chỉ đề xuất file test và thứ tự công việc; không tạo các test rỗng hoặc đánh dấu phase hoàn tất khi chưa triển khai.
