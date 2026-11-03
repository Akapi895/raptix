# Technical Design: Knowledge Reference Graph, Observation Ingestion, Query Interface, Validated Promotion

- **Ngày:** 2026-11-03.
- **Trạng thái:** Technical Design — bước 6 của `docs/proposals/2026-11-02-graph-architecture-optimization.md`. **Chưa phải ADR, chưa có code/migration nào được áp dụng.**
- **Nền đánh giá:** Đọc source trực tiếp qua 3 lượt khảo sát sâu: (1) schema/migration/multi-db của Neo4j AKG+Skillogy; (2) data model + convention route/migration của `apps/api`; (3) cơ chế RoE gating thật + hạ tầng test của Python runtime. Mọi quyết định dưới đây dựa trên fact đã trích file:line, không suy diễn.
- **Cách đọc:** `[Hiện trạng]` = đã xác minh trong source. `[Quyết định]` = khuyến nghị kỹ thuật có căn cứ, cần người dùng duyệt trước khi code. `[Cần chốt]` = còn mở, ảnh hưởng phạm vi.

---

## 0. Quyết định số database/instance — trả lời trực tiếp câu hỏi của người dùng

**[Quyết định] Không thêm Neo4j instance mới. Knowledge Reference Graph dùng chung instance `neo4j` hiện có (cùng với AKG + Skillogy), tách biệt bằng label vocabulary riêng — không dùng `$engagement`.**

Căn cứ:
- **Tiền lệ đã chạy thật:** Skillogy và AKG đã chia sẻ đúng 1 Neo4j container (`bolt://neo4j:7687`, cả 2 biến `SKILLOGY_NEO4J_URI` và `RAPTIX_NEO4J_URI` cùng trỏ vào đây) từ trước đến nay, tách biệt hoàn toàn chỉ bằng label riêng (`:Skill`/`:Phase`/`:Tag`/`:MoC`/`:Tactic`/`:Technique` của Skillogy không mang property `engagement`, khác hẳn AKG). Đây là mô hình **đã chứng minh hoạt động**, không phải giả thuyết.
- **Chi phí 1 instance mới là có thật và không nhỏ:** AKG hiện tại đã chiếm `mem_limit: 2g`. BloodHound (`bhce-neo4j`) có instance riêng, nhưng lý do là **optional/profile-gated** (chỉ chạy khi `--profile ad`, không chạy mặc định) + ghi schema hoàn toàn ngoài tầm kiểm soát (BloodHound CE tự quản lý schema của nó) — không phải vì "mọi graph mới đều cần instance riêng". Knowledge Reference Graph **luôn chạy** (không optional), read-mostly, không cần resource riêng ở mức đó.
- **Neo4j Community edition xác nhận lại:** cả 2 image đều tag `-community`; không có flag multi-database Enterprise nào trong `docker-compose.yml`. 1 server = 1 database, đã biết từ trước.
- **Hệ thống migration Neo4j đã tồn tại, hỗ trợ thêm schema an toàn:** `packages/raptix/raptix/knowledge/graph/migration_runner.py` + `bootstrap.py` + `migrations/V001..V007__*.cypher`, ghi nhận qua node `:MigrationLog` để không chạy lại. Thêm Knowledge Reference Graph = thêm `V008__knowledge_reference_graph.cypher`, không cần dựng cơ chế mới.

**[Cần chốt] Rủi ro duy nhất cần xử lý ngay khi thiết kế schema: label `:Technique` đã bị dùng 2 lần (AKG — có `engagement` property + unique constraint theo `(key, engagement)`; Skillogy — global, không có `engagement`).** Knowledge Reference Graph **không được** dùng lại bare `:Technique` lần thứ 3. Xem Mục 1.

Vai trò PostgreSQL không đổi: vẫn là transactional store (project/asset catalog/Fact Graph) theo đúng nguyên tắc đã thống nhất ở Mục 2 proposal gốc ("4 graph không bắt buộc chung 1 database"). Knowledge Reference Graph không đặt trong Postgres vì: (a) nó cần được **agent Python runtime** truy vấn trực tiếp lúc reasoning — AKG/Skillogy đều làm vậy qua Neo4j driver in-process, đặt reference graph ở Postgres sẽ buộc agent phải gọi ngược vào HTTP API của `apps/api`, khác hẳn pattern hiện có và thêm latency; (b) cross-taxonomy traversal (CAPEC→CWE, và các loại sẽ resolve sau) tự nhiên hơn ở Cypher so với recursive CTE.

---

## 1. Knowledge Reference Graph — schema

### 1.1. Label vocabulary — tránh trùng với AKG và Skillogy

Namespace riêng bằng prefix `Krg` (Knowledge Reference Graph) cho mọi label, không tái dùng bare `:Technique`/`:Vulnerability`/... đã có ở AKG hoặc Skillogy:

| Label | Nguồn | Khóa định danh |
|---|---|---|
| `:KrgAttackTechnique` | ATT&CK (ưu tiên `data/knowledge/attack/`, không dùng pipeline Skillogy — xem proposal Mục 4 Vấn đề 5) | `attack:T####` (`source_id`) |
| `:KrgAttackTactic` | ATT&CK | `attack:TA####` |
| `:KrgMitigation` | ATT&CK `course-of-action` (Skillogy hiện KHÔNG parse loại này — đây là dữ liệu mới so với Skillogy) | `attack:M####` |
| `:KrgCwe` | CWE | `cwe:CWE-###` |
| `:KrgCapec` | CAPEC | `capec:CAPEC-###` |
| `:KrgCisaKev` | CISA KEV | `cisa:CVE-####-#####` |
| `:KrgOwaspControl` | OWASP (cheatsheet/top10/api-top10/asvs/wstg — xem 1.3) | theo subtype, ví dụ `owasp:top10:2025:A01` |
| `:KrgAtlasCase`/`:KrgAtlasTechnique` | MITRE ATLAS | `atlas:AML.*` |

Property chung mọi node: `id` (khóa trên, duy nhất toàn graph), `name`, `description`, `source` (`attack`/`cwe`/`capec`/`cisa`/`owasp`/`atlas`), `source_version` (vd `attack_version: '19.2'`, `catalog_version: '4.20'` — lấy đúng field đã có trong `data/knowledge`), `ingested_at`, `ingestion_batch_id`. **Không có property `engagement`** — đây là dữ liệu toàn cục, không thuộc project nào (giống Skillogy, khác AKG).

### 1.2. Relationship types

| Edge | Chiều | Trạng thái resolve (từ `data/knowledge`) |
|---|---|---|
| `IMPLEMENTS_TACTIC` | Technique → Tactic | resolved (intra-ATT&CK) |
| `HAS_SUBTECHNIQUE` | Technique → Technique | resolved |
| `MITIGATED_BY` | Technique → Mitigation | resolved |
| `RELATED_WEAKNESS` | Capec → Cwe | **resolved** (xác nhận trong `data/knowledge/capec/*.yaml`) |
| `CHILD_OF` | Cwe → Cwe, Capec → Capec | resolved (intra-taxonomy) |
| `ENRICHES` | CisaKev → (CVE, namespace `nvd:`) | **unresolved** — giữ edge với property `resolution_status: 'external_unresolved'`, không tạo node `nvd:` ảo. Query Interface phải trả về cả edge này kèm trạng thái, không âm thầm bỏ qua. |
| `EMPLOYS` | AtlasCase → AtlasTechnique | resolved (intra-ATLAS) |

**[Cần chốt]** Không có edge ATT&CK↔CWE/CAPEC/CVE nào được xác nhận trong mẫu đã đọc (proposal Mục 3.1-3.2). Nếu cần liên kết này (vd "technique nào khai thác CWE nào"), phải quét toàn bộ 5.850 file để xác nhận có tồn tại ở file khác không — **chưa làm ở bước audit trước, cần làm trước khi implement nếu quyết định cần liên kết này ngay từ v1**; nếu không, v1 chỉ ingest các relationship đã xác nhận ở trên.

### 1.3. Migration file

Thêm `packages/raptix/raptix/knowledge/graph/migrations/V008__knowledge_reference_graph.cypher`, theo đúng pattern `V001`:

```cypher
CREATE CONSTRAINT krg_technique_id IF NOT EXISTS FOR (n:KrgAttackTechnique) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT krg_tactic_id IF NOT EXISTS FOR (n:KrgAttackTactic) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT krg_mitigation_id IF NOT EXISTS FOR (n:KrgMitigation) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT krg_cwe_id IF NOT EXISTS FOR (n:KrgCwe) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT krg_capec_id IF NOT EXISTS FOR (n:KrgCapec) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT krg_cisakev_id IF NOT EXISTS FOR (n:KrgCisaKev) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT krg_owasp_id IF NOT EXISTS FOR (n:KrgOwaspControl) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT krg_atlas_case_id IF NOT EXISTS FOR (n:KrgAtlasCase) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT krg_atlas_technique_id IF NOT EXISTS FOR (n:KrgAtlasTechnique) REQUIRE n.id IS UNIQUE;
CREATE INDEX krg_technique_name IF NOT EXISTS FOR (n:KrgAttackTechnique) ON (n.name);
```

Chạy qua `migration_runner.py` hiện có — ghi nhận ở `:MigrationLog{name: 'V008__knowledge_reference_graph'}`, idempotent như các migration trước.

---

## 2. Ingestion pipeline (Knowledge Reference Graph)

**[Quyết định] Không tái dùng `record_observations()`.** Hàm này bắt buộc `engagement`/`created_by`/`source_episode_id` non-empty (store.py:404-407) và bump `KGRevision` mỗi lần — đúng cho observation nhỏ/thường xuyên từ agent, **sai hoàn toàn** cho 1 lần load hàng nghìn node tham khảo không thuộc engagement nào. Viết UNWIND/MERGE riêng, theo đúng cách các file `V00*.cypher` đã làm (fact, không phải suy đoán — xem Mục 1 của agent khảo sát).

**Nguồn dữ liệu:** `data/knowledge/{attack,cwe,capec,cisa,owasp,atlas}/*.yaml` — đã chuẩn hóa, có provenance thật (xem proposal). **Không dùng pipeline Skillogy** (`stix_bootstrap.py`) cho phần ATT&CK — pipeline đó chỉ trích tactic+technique, thiếu mitigation/detection mà `data/knowledge/attack/` đã có sẵn.

**Thiết kế loader** (`packages/raptix/raptix/knowledge/reference/` — module mới, song song `knowledge/graph/`, không sửa `knowledge/graph/`):
1. Đọc từng file YAML theo subfolder → map vào 1 trong 8 label ở Mục 1.1 theo `type` field.
2. Validate shape trước khi ghi: field `id`/`source`/`type`/`name` bắt buộc; bỏ qua (log, không crash) file thiếu field bắt buộc.
3. Batch theo label (giống `record_observations`'s group-by-label), `UNWIND $rows AS row MERGE (n:KrgXxx {id: row.id}) SET n += row.props`.
4. Ghi `ingestion_batch_id` (UUID theo lần chạy) + `ingested_at` lên mọi node/edge của batch — cho phép rollback/audit theo batch.
5. Idempotent: `MERGE` theo `id`, chạy lại không tạo trùng.
6. Quan hệ `ENRICHES` (CisaKev→CVE chưa resolve): ghi edge tới 1 node placeholder `(:KrgUnresolvedRef {namespace, id})` thay vì bỏ qua — giữ được thông tin, không giả vờ đã resolve.

**[Cần chốt]** Vấn đề gitignore của `data/knowledge` (đã nêu ở proposal Mục 4): loader cần biết tìm thư mục ở đâu trên máy khác — đề xuất 1 env var `RAPTIX_KNOWLEDGE_CORPUS_DIR` (default trỏ `data/knowledge` nếu tồn tại), và 1 file manifest nhỏ (hash + nguồn + hướng dẫn tái tạo) được commit vào git dù thư mục đầy đủ vẫn gitignore — **không mặc định commit 5.850 file**, đúng yêu cầu trước đó.

**Chạy 1 lần, không phải mỗi request** — khác hẳn `kg-assets-sync.ts`'s pattern (đã xác nhận không tái dùng được). Đề xuất: lệnh `make` mới (`make ingest-knowledge-reference-graph`) hoặc `raptix-cli` subcommand, chạy thủ công/CI riêng — **không** chạy tự động trong request path của agent.

---

## 3. Graph Query Interface

**[Hiện trạng xác nhận lại]** Hôm nay AKG chỉ có: (a) summary cố định force-inject mỗi turn, (b) vài `@tool` hẹp (`kg_surface_inventory`, `challenge_inventory`), (c) đường thoát `bash('cypher-shell ...')` — không có query interface thật theo nghĩa "truy vấn có chọn lọc, có giới hạn tài nguyên."

**[Quyết định] Thêm 1 `@tool` mới `kg_query_reference(query_type, params)` cho Knowledge Reference Graph**, KHÔNG dùng raw Cypher tùy ý:
- `query_type` là 1 tập đóng (enum trong code, không phải string tự do): `technique_by_id`, `mitigations_for_technique`, `capec_for_cwe`, `neighbors` (1-2 hop quanh 1 node theo id), `search_by_name` (full-text trên `name`/`description`, giới hạn label).
- Mỗi `query_type` map tới 1 Cypher cố định, tham số hóa — **không có đường nào LLM tự viết Cypher cho graph này**. Đây sửa đúng vấn đề "tránh trao quyền thực thi Cypher tùy ý" đã nêu trong Technical Design requirements.
- Giới hạn cứng: `neighbors`/`search_by_name` trả tối đa 20 node + edge liên quan, traversal depth ≤ 2. Vượt giới hạn → trả `truncated: true`, không trả toàn bộ.
- Trả kèm `source`, `source_version`, và với edge `ENRICHES` chưa resolve: `resolution_status`.
- **Không force-inject** — chỉ chạy khi agent gọi tool, đúng nguyên tắc Graph-aware Reasoning Policy (proposal Mục 1).

**[Cần chốt] Có nên áp RoE scope lên query này không?** Theo khảo sát Mục 3: Knowledge Reference Graph không gắn `engagement`/target nào (nó là tri thức chung, không phải dữ liệu của 1 host cụ thể) — RoE's `evaluate_target` vốn kiểm tra host/IP cụ thể, không có ý nghĩa với "tra cứu CWE-120 là gì." **Khuyến nghị: không cần RoE-gate query này** (khác với Mục 4's quyết định về AKG write, vốn CÓ claim về host/target cụ thể). Cần người dùng xác nhận đồng ý với lý do này.

**Với AKG (Runtime Graph), không phải Knowledge Reference Graph:** việc "force-inject toàn bộ summary mỗi turn" đã xác nhận là vấn đề thật (proposal Mục 3.2/3.4). Thiết kế đồng bộ: giữ summary nhỏ hiện tại cho tình huống bắt buộc có context (đổi sang do agent quyết định bật/tắt nếu khả thi — cần thêm khảo sát middleware thật trước khi đổi, không đưa vào scope lần này), và thêm 1 `@tool` `kg_query(query_type, params)` tương tự, giới hạn resource tương tự, thay cho đường thoát `cypher-shell`.

---

## 4. Security boundaries — xử lý dứt điểm lỗ hổng RoE-gating

**[Hiện trạng — đã xác nhận là lỗ hổng thật, không còn "cần xác minh thêm"]** Trace đầy đủ (khảo sát Mục 1-2):
- Tool bị gate thật (`bash`, `http_request`...) qua `_evaluate()` trong `middleware/roe.py`: trích target cụ thể từ argument (URL/host hoặc parse từ command string) → `evaluate_target(host, rules)` đối chiếu `in_scope`/`out_of_scope`/`forbidden_destinations`/sensitive-TLD — **argument-aware, target-aware**.
- `kg_record`/`kg_ingest` (`knowledge/graph/tools.py`) chỉ gọi `_resolve_engagement(state)` — kiểm tra có engagement identity, **không kiểm tra target nào trong payload**. `_safe_label()` chỉ là regex hình dạng (chống Cypher injection), không phải whitelist loại node.
- **Hệ quả thật:** agent (hoặc nội dung bị prompt-injection) có thể `kg_record` 1 node `Vulnerability`/`Host` với `target`/`host` prop là 1 host **chưa từng được RoE cho phép**, không bị chặn ở đâu cả — khác hẳn mức bảo vệ mà `bash` scan cùng host đó sẽ bị chặn.

**[Quyết định] Thêm extractor target cho `kg_record`/`kg_ingest`, đăng ký vào `NETWORK_TARGET_EXTRACTORS` (hoặc tương đương) trong `middleware/roe.py`, và thêm 2 tool này vào `GATED_TOOL_NAMES`:**
- Extractor đọc `host`/`ip`/`domain`/`url` property (nếu có) từ mọi `observations[].props` trong payload của `kg_record`, và từ kết quả parse của `kg_ingest`'s scanner output.
- Chạy qua `evaluate_target()` — đúng mức bảo vệ các tool khác đã có, **không đổi cơ chế `evaluate_target` đã có**, chỉ thêm 1 extractor mới cho 2 tool này.
- Observation không mang target nào (vd ghi 1 hypothesis thuần suy luận, không gắn host cụ thể) → không có gì để extract → `allow_default()`, không bị chặn sai.

**Đây là thay đổi chạm `middleware/roe.py` (guard rail theo CLAUDE.md) — cần ADR + threat-model paragraph riêng theo đúng CONTRIBUTING_AGENT.md, không gộp vào 1 PR chung với schema/ingestion.** Đề xuất tách thành 1 PR độc lập, làm TRƯỚC các phần khác ở Mục 5-6 (rủi ro thấp nhất, giá trị an ninh cao nhất — khớp thứ tự ưu tiên đã thống nhất ở proposal).

---

## 5. Validated Knowledge Promotion (AKG ↔ Fact Graph, hoàn thiện 4A)

**[Hiện trạng]** `kg-assets-sync.ts` xác nhận KHÔNG tái dùng được: 1 chiều, bulk toàn engagement, upsert máy móc theo `(projectId, host)`, âm thầm bỏ qua lỗi Neo4j (`.catch(() => [])`), không có bước xác minh con người. Promotion cần ngược lại ở mọi điểm này: chọn lọc, có thể cần duyệt, giữ evidence.

**[Quyết định] Postgres migration — thêm cột trạng thái cho `ProjectFact`, theo đúng convention đã xác nhận (toàn bộ `schema.prisma` không dùng Prisma `enum` ở đâu cả):**

```prisma
model ProjectFact {
  // ... giữ nguyên các field hiện có (factKey, category, confidence, pinned, deprecated, ...)
  provenanceState    String   @default("observed")  // proposed | observed | verified | rejected | stale
  provenanceSource   String   @default("")          // "akg" | "manual" | "chat-promote" | ""
  sourceObservationId String  @default("")           // id/key của node AKG gốc, rỗng nếu tạo tay
  verifiedAt         DateTime?
  verifiedBy         String   @default("")
  @@index([projectId, provenanceState])
}
```

Lý do dùng `String` thay enum: khớp 100% với convention hiện tại của file (agent khảo sát xác nhận 0 enum trong toàn schema), tránh là chỗ đầu tiên phá lệ.

**Migration file mới**, theo đúng naming convention đã thấy: `apps/api/prisma/migrations/<timestamp>_project_fact_provenance_state/migration.sql`, chạy qua `prisma migrate dev` (ghi nhận: script có sẵn trong repo là `migrate deploy`, việc tạo migration mới là bước thủ công của dev, không có script riêng — theo đúng khảo sát).

**Luồng promotion** (`apps/api/src/services/fact-promotion.ts` — module mới, theo đúng pattern `register*Routes(app, options)` + `BuildAppOptions` đã khảo sát):
1. Operator (hoặc 1 tool đề xuất) chọn 1 observation cụ thể từ AKG (qua `kg_query` Mục 3, không phải quét toàn bộ).
2. Tạo `ProjectFact` mới với `provenanceState: 'proposed'`, `provenanceSource: 'akg'`, `sourceObservationId` = key AKG gốc — **không copy toàn bộ properties**, chỉ các field đã map rõ (category/summary/body).
3. Operator xác nhận → `provenanceState: 'verified'`, `verifiedAt`/`verifiedBy` set. Từ chối → `'rejected'`, giữ lại record (không xóa) để có audit trail.
4. `stale`: đặt thủ công hoặc qua job định kỳ (ví dụ fact không được re-verify sau N ngày) — **không tự động** theo yêu cầu "verification before learning."
5. **Không tự động chia sẻ giữa project** — `sourceObservationId` chỉ có ý nghĩa trong cùng `projectId` (đã xác nhận engagement=project ở proposal Mục 3.6).

**API mới** (route file mới `apps/api/src/http/routes/fact-promotion.routes.ts`, theo đúng khuôn `specialists.routes.ts`/`knowledge.routes.ts`):
- `GET /api/projects/:id/akg-candidates?query_type=...` — proxy có kiểm soát tới `kg_query` (Mục 3) qua runtime, không expose Cypher.
- `POST /api/projects/:id/facts/:factId/promote` — chuyển `proposed` → `verified`/`rejected`.
- Dùng lại `createRequireSession` preHandler, lỗi 400/404/409 theo đúng convention đã khảo sát (không có RBAC role-check ở route layer hôm nay — single-operator model, giữ nguyên, không tự thêm).

---

## 6. Test plan

**[Quyết định] Không dựng hạ tầng test mới — tái dùng 2 pattern đã xác nhận đang chạy:**

**Python/Neo4j (Knowledge Reference Graph + RoE extractor mới):**
- Unit, mock driver: theo `packages/raptix/tests/unit/middleware/test_kgstore_unit.py`'s style — test loader's YAML→Cypher mapping, extractor's target-parsing, không cần Neo4j thật.
- Integration, live Neo4j: theo `packages/raptix/tests/integration/kg/conftest.py`'s `kgstore` fixture (skip nếu không reachable) — thêm test ingest 1 bộ YAML mẫu nhỏ, xác nhận constraint/MERGE idempotent, xác nhận `:KrgAttackTechnique` không đụng `:Technique` của AKG/Skillogy trong cùng DB.
- **[Cần chốt]** Khảo sát xác nhận: hiện KHÔNG có CI lane nào chạy live-Neo4j integration test (không có `services:` Neo4j trong `ci.yml`) — suite này chỉ chạy local. Quyết định có cần thêm CI lane cho Knowledge Reference Graph ingestion hay chấp nhận cùng giới hạn hiện tại — đề xuất: **chấp nhận giới hạn hiện tại cho v1** (nhất quán với AKG/Skillogy, không mở rộng phạm vi ngoài yêu cầu).
- RoE extractor mới: unit test theo style `middleware/roe.py`'s existing test suite (nếu có — cần kiểm tra thêm khi implement), xác nhận `kg_record` với host ngoài scope bị `Decision.deny`, với host trong scope hoặc không có host nào thì `allow`.

**apps/api (Postgres/API mới):**
- Theo đúng `apps/api/tests/support/build-test-app.ts` — thêm `FakeFactPromotionService` nếu cần, hoặc tái dùng `FakeFactStore` đã có (thêm field provenance vào fake).
- Theo pattern `assets.routes.test.ts`'s "seed fake 1 bên, gọi route, assert cả 2 bên" cho `POST /promote`: seed 1 `ProjectFact` `proposed`, gọi promote, assert `provenanceState` đổi + `verifiedAt` set + gọi lại không đổi thêm (idempotent theo đúng style `roles.routes.test.ts`/`assets.routes.test.ts`).
- Functional/integration criteria — map trực tiếp vào bảng đã có ở proposal Mục 5, không tạo bảng mới.

---

## 7. Thứ tự triển khai (giữ nguyên nguyên tắc rủi ro thấp → cao đã thống nhất)

1. **Vá RoE-gating cho `kg_record`/`kg_ingest`** (Mục 4) — PR riêng, kèm ADR + threat-model, không chung với phần dưới.
2. **Migration Postgres** cho `ProjectFact` provenance state (Mục 5) — không có logic mới, rủi ro thấp.
3. **Migration Neo4j `V008`** + loader ingest `data/knowledge` (Mục 1-2) — chưa expose gì cho agent, chỉ nạp dữ liệu.
4. **`kg_query_reference` tool** (Mục 3) — expose Knowledge Reference Graph cho agent, có giới hạn.
5. **Fact-promotion API + luồng** (Mục 5) — nối AKG ↔ Fact Graph có kiểm soát.
6. **`kg_query` tool cho AKG** (Mục 3, phần Runtime Graph) — thay đường thoát `cypher-shell`.
7. Benchmark/so sánh reasoning (ngoài scope tài liệu này theo quyết định đã chốt ở proposal — chỉ functional/integration test).

---

## 8. Việc KHÔNG làm trong tài liệu này

Chưa viết code, chưa chạy migration, chưa ingest dữ liệu thật, chưa sửa `middleware/roe.py`. Tài liệu này là thiết kế kỹ thuật để duyệt trước khi bắt đầu bước 1 ở Mục 7.
