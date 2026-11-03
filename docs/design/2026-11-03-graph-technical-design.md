# Technical Design: Knowledge Reference Graph, Observation Ingestion, Query Interface, Validated Promotion

- **Ngày:** 2026-11-03 (bản gốc) → sửa sau review kỹ thuật lần 2 → **bản 3: chốt 5 quyết định + 2 điểm kiểm tra bổ sung (auth endpoint Python, tương tác KGMiddleware/compaction), cùng ngày**.
- **Trạng thái:** Technical Design — bước 6 của `docs/proposals/2026-11-02-graph-architecture-optimization.md`. **Chưa phải ADR, chưa có code/migration/ingestion nào được áp dụng.**
- **Nền đánh giá:** Bản gốc dựa trên 3 lượt khảo sát sâu (schema/migration Neo4j; convention `apps/api`; RoE + test infra). **Bản này** dựa trên **5 lượt khảo sát bổ sung**, chạy song song, đối chiếu trực tiếp source để phản biện từng điểm review của người dùng: (A) Observation Ingestion + Graph-aware Reasoning Policy thật; (B) Project authorization + Node↔Python transport thật; (C) `ProjectFact`/`ProjectFactEdge` schema đầy đủ + concurrency pattern thật; (D) Neo4j constraint/full-text/versioning convention thật; (E) RoE threat-model phân loại hành vi + CI test infra thật. Mọi quyết định dưới đây dựa trên fact đã trích file:line.
- **Cách đọc:** `[Hiện trạng]` = đã xác minh trong source. `[Quyết định đề xuất]` = khuyến nghị kỹ thuật có căn cứ, người dùng có thể để agent tự quyết khi implement. `[Cần thiết kế thêm]` = chưa đủ thông tin để chốt chi tiết, cần làm rõ lúc implement, không chặn việc duyệt tài liệu này. `[Cần người dùng phê duyệt]` = ảnh hưởng hành vi runtime/ranh giới bảo mật/phạm vi, cần quyết định của người dùng trước khi code.

---

## 0. Quyết định số database/instance — giữ nguyên, không có bằng chứng mới mâu thuẫn

**[Quyết định đề xuất — giữ nguyên bản gốc]** Không thêm Neo4j instance mới. Knowledge Reference Graph dùng chung instance `neo4j` hiện có (cùng AKG + Skillogy), tách biệt bằng label vocabulary riêng.

Căn cứ không đổi so với bản gốc (tiền lệ Skillogy chia sẻ instance qua label riêng; BloodHound có instance riêng vì optional/profile-gated, không phải quy luật chung; Community edition = 1 DB/server; hệ thống migration `migration_runner.py`/`bootstrap.py`/V001-V007 đã hỗ trợ thêm schema an toàn). Lượt khảo sát lần 2 (D) đọc lại toàn bộ V001-V007 xác nhận **không có gì mâu thuẫn** với quyết định này — chỉ phát hiện thêm chi tiết về cách uniqueness/versioning hoạt động, xử lý ở Mục 1 và 2 dưới đây.

**Trả lời thêm câu hỏi "dùng chung instance có ảnh hưởng isolation/performance/resource không?" (review điểm 5):**
- **Isolation:** không ảnh hưởng — Krg labels không mang property `engagement`, không có constraint hay query nào của AKG filter theo `engagement` chạm vào label `Krg*` (khác namespace hoàn toàn, giống Skillogy). Không có đường nào 1 Cypher statement vô tình đọc chéo giữa AKG-scoped và Krg-global data trừ khi code tự viết sai.
- **Performance:** Knowledge Reference Graph ước tính ~5.850 node (tổng mọi nguồn: ATT&CK 1.813, CAPEC 558, CISA KEV 1.665, CWE 969, OWASP 583, ATLAS 262) — nhỏ so với quy mô Neo4j vận hành bình thường, và **read-mostly** (chỉ ghi lại khi re-ingest). Không có lý do kỹ thuật để lo ngại ảnh hưởng tới AKG's query latency.
- **Resource:** container hiện `mem_limit: 2g`. **[Cần thiết kế thêm]** Không đo được mức tăng thực tế mà không ingest thật — khuyến nghị: không tăng `mem_limit` trước, đo lại sau bước 3 (ingest thật) ở Mục 9 roadmap, không tối ưu sớm cho vấn đề chưa chứng minh tồn tại.

---

## 1. Knowledge Reference Graph — schema

### 1.1. Label vocabulary — không đổi, chỉ làm rõ lại phạm vi "unique"

Giữ nguyên bảng label `Krg*` ở bản gốc (không đổi).

**[Hiện trạng — sửa lại cho chính xác, review điểm 5 đúng]** Khảo sát lại toàn bộ `V001__*.cypher` đến `V007__*.cypher` xác nhận: **mọi `CREATE CONSTRAINT ... IS UNIQUE` của AKG đều theo từng LABEL riêng** (ví dụ `host_key_engagement FOR (n:Host) REQUIRE (n.key, n.engagement) IS UNIQUE`), **không có cách nào Neo4j (cả Community/Enterprise) tạo 1 constraint uniqueness xuyên nhiều label**. Comment gốc của AKG tự ghi rõ: *"Plugin-supplied labels not listed here are unconstrained at the schema level; KGStore.record_observations enforces the dedup key application-side."* — tức AKG cũng chỉ bảo đảm uniqueness xuyên label bằng **quy ước ở tầng application** (namespace trong giá trị key), không phải DB-side.

→ Câu "tài liệu nói `id` duy nhất toàn graph" ở bản gốc **không sai về mục tiêu, nhưng gây hiểu lầm về cơ chế bảo đảm**. Sửa lại: `id` của mọi node Knowledge Reference Graph **duy nhất xuyên label theo quy ước đặt tên** (`attack:T1059`, `cwe:CWE-120`, `capec:CAPEC-66`...) — mỗi label có 1 `CREATE CONSTRAINT ... IS UNIQUE` riêng (DB-side, trong phạm vi label đó), còn "không trùng xuyên label" đến từ việc mỗi nguồn dữ liệu có prefix riêng, đúng **cùng quy ước AKG đang dùng** — không phải 1 pattern mới, không cần giải pháp gì khác.

### 1.2. Relationship types — không đổi

Giữ nguyên bảng ở bản gốc (`IMPLEMENTS_TACTIC`, `HAS_SUBTECHNIQUE`, `MITIGATED_BY`, `RELATED_WEAKNESS`, `CHILD_OF`, `ENRICHES`, `EMPLOYS`).

**[Cần thiết kế thêm — không đổi]** Vẫn cần quét toàn bộ 5.850 file nếu v1 cần edge ATT&CK↔CWE/CAPEC/CVE — chưa làm, không chặn việc duyệt tài liệu.

### 1.3. Soft-delete / staleness — bổ sung mới (review điểm 5, "nguồn dữ liệu cập nhật/xóa")

**[Hiện trạng]** Repo có 1 convention soft-delete đã dùng thật: `ProjectFact.deprecated` (Boolean, Postgres) — field đánh dấu "không hiệu lực nữa" mà không xóa record, giữ audit trail.

**[Quyết định đề xuất]** Mọi label `Krg*` thêm property `deprecated_at: DateTime | null` (mặc định `null`). Mỗi lần ingest lại 1 nguồn (ví dụ CWE phiên bản mới), loader tính tập `id` hiện có trong batch mới, rồi với mọi node `Krg*` cùng `source` mà `id` KHÔNG còn trong batch mới: `SET n.deprecated_at = $now` (không `DELETE`). `kg_query_reference` (Mục 5) mặc định filter `WHERE n.deprecated_at IS NULL`, có tham số `include_deprecated` để operator vẫn tra cứu được item đã deprecated khi cần (ví dụ đọc báo cáo cũ tham chiếu 1 CWE đã rút). Lý do chọn soft-delete thay vì `DETACH DELETE`: tránh phá vỡ bất kỳ edge/tham chiếu nào từ `ProjectFactEvidence` (Mục 7) hoặc `KrgUnresolvedRef` đang trỏ tới node đó — khớp đúng nguyên tắc "ưu tiên tái dùng convention sẵn có" (ở đây là Postgres's `deprecated` pattern, áp dụng tương tự sang Neo4j).

### 1.4. Migration file — cập nhật, bỏ full-text, thêm property mới

**[Hiện trạng — sửa lại]** Khảo sát (D) xác nhận: **không có `CREATE FULLTEXT INDEX`/`db.index.fulltext` nào trong migration path đang sống** (V001-V007 + `migration_runner.py`). Có 1 tiền lệ cú pháp cũ (`db.index.fulltext.createNodeIndex`) trong `scripts/init_neo4j.cypher`, nhưng file này **không được gọi bởi Makefile/docker-compose nào** — thuộc schema pre-engagement-scoping đã lỗi thời, không phải precedent đang dùng.

**[Quyết định đề xuất — sửa lại theo review điểm 5]** Không dùng full-text index cho v1. `search_by_name` (Mục 5) thực hiện bằng `WHERE toLower(n.name) CONTAINS toLower($q)` trên 1 label cụ thể mỗi lần gọi — mỗi label có cardinality nhỏ (lớn nhất ~1.813 node, ATT&CK), full-label-scan + `CONTAINS` là đủ nhanh ở quy mô này, không cần giới thiệu 1 tính năng Neo4j chưa từng chạy thật trong deployment này. Giữ 1 `CREATE INDEX ... ON (n.name)` (b-tree) cho mỗi label — không phải để tăng tốc `CONTAINS` (b-tree không hỗ trợ tốt `CONTAINS`), mà cho các truy vấn exact/prefix-match khác có thể cần sau. Nếu corpus tăng đáng kể và `CONTAINS` chậm thật (đo được), thêm full-text index sau — đây là thay đổi tương thích ngược, không phải quyết định phải chốt ngay.

```cypher
-- V008__knowledge_reference_graph.cypher
CREATE CONSTRAINT krg_technique_id IF NOT EXISTS FOR (n:KrgAttackTechnique) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT krg_tactic_id IF NOT EXISTS FOR (n:KrgAttackTactic) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT krg_mitigation_id IF NOT EXISTS FOR (n:KrgMitigation) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT krg_cwe_id IF NOT EXISTS FOR (n:KrgCwe) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT krg_capec_id IF NOT EXISTS FOR (n:KrgCapec) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT krg_cisakev_id IF NOT EXISTS FOR (n:KrgCisaKev) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT krg_owasp_id IF NOT EXISTS FOR (n:KrgOwaspControl) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT krg_atlas_case_id IF NOT EXISTS FOR (n:KrgAtlasCase) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT krg_atlas_technique_id IF NOT EXISTS FOR (n:KrgAtlasTechnique) REQUIRE n.id IS UNIQUE;
CREATE CONSTRAINT krg_unresolved_ref IF NOT EXISTS FOR (n:KrgUnresolvedRef) REQUIRE (n.namespace, n.id) IS UNIQUE;
CREATE INDEX krg_technique_name IF NOT EXISTS FOR (n:KrgAttackTechnique) ON (n.name);
CREATE INDEX krg_cwe_name IF NOT EXISTS FOR (n:KrgCwe) ON (n.name);
CREATE INDEX krg_capec_name IF NOT EXISTS FOR (n:KrgCapec) ON (n.name);
```

Chạy qua `migration_runner.py` hiện có — ghi nhận ở `:MigrationLog{name: 'V008__knowledge_reference_graph'}`, idempotent như trước.

**[Hiện trạng — bổ sung quan trọng từ review (D)]** `migration_runner.py` chạy **từng statement trong 1 transaction riêng** (không bọc cả file trong 1 transaction), **forward-only, không có rollback**. Nếu 1 statement giữa file fail, các statement trước đã commit, `MigrationLog` không được ghi (nằm sau loop) → lần chạy lại sẽ chạy lại từ đầu file. Vì mọi statement ở trên đều `IF NOT EXISTS`, re-run an toàn — **không cần thay đổi gì ở `migration_runner.py`**, chỉ cần viết migration mới theo đúng tính chất này (mọi statement phải idempotent, đã đúng ở trên).

---

## 2. Ingestion pipeline (Knowledge Reference Graph)

Giữ nguyên quyết định gốc: không tái dùng `record_observations()`, viết loader riêng ở `knowledge/reference/`, nguồn là `data/knowledge/`, không dùng pipeline Skillogy cho ATT&CK.

**[Quyết định đề xuất — bổ sung theo review điểm 5 "không âm thầm bỏ qua file lỗi", "có manifest/checksum/báo cáo"]**

1. Loader xử lý từng file, validate shape (`id`/`source`/`type`/`name` bắt buộc). File thiếu field bắt buộc → ghi vào **ingestion report** (không chỉ log rời), **không coi là thành công toàn phần**: loader exit code ≠ 0 nếu có ≥1 file invalid, trừ khi chạy với cờ `--allow-partial` (operator tự chọn bỏ qua, có ghi rõ trong report file nào bị skip và lý do).
2. Report cuối mỗi lần chạy (in ra stdout + ghi file JSON có timestamp, không commit git — cùng chỗ với `data/knowledge`, đã gitignore sẵn): số file đọc được theo từng `source`, số node created/merged/deprecated (theo cơ chế soft-delete ở Mục 1.3), số file skip kèm lý do, số relationship `ENRICHES` unresolved.
3. Checksum: loader tự tính `sha256` theo từng file đã ingest (không phụ thuộc `data/knowledge`'s `MANIFEST.json` vì không phải mọi nguồn đều có hash sẵn — ví dụ CISA KEV yếu nhất, theo audit cũ), lưu vào property `source_file_hash` trên node/trong report — cho phép phát hiện "file đã đổi từ lần ingest trước" mà không cần parse lại toàn bộ để so sánh.
4. Soft-delete diff (Mục 1.3): với mỗi `source`, tính tập `id` hiện tại trong batch, đánh dấu `deprecated_at` cho node cũ không còn trong batch. Không `DETACH DELETE` bao giờ.
5. `ENRICHES` (CisaKev→CVE chưa resolve): giữ nguyên quyết định gốc — ghi tới `(:KrgUnresolvedRef {namespace, id})`. **[Cần thiết kế thêm]** Khi nguồn `nvd:` được ingest trong tương lai (ngoài scope tài liệu này), cần 1 script chuyển `KrgUnresolvedRef` → edge thật tới node `nvd:` + xóa `KrgUnresolvedRef` nếu không còn gì trỏ tới — chỉ ghi nhận là việc cần làm sau, không thiết kế chi tiết ở đây (chưa có nguồn `nvd:` để code against).

Các điểm còn lại (idempotent MERGE, `RAPTIX_KNOWLEDGE_CORPUS_DIR` env var, chạy qua `make ingest-knowledge-reference-graph` thủ công/CI riêng, không chạy trong request path của agent) **giữ nguyên bản gốc, vẫn đúng**.

---

## 3. Observation Ingestion Layer cho Runtime Graph (AKG) — [Sửa lớn] đã tồn tại, không phải xây mới

**[Hiện trạng — phát hiện quan trọng, SỬA LẠI kết luận của Architecture Proposal]** Review điểm 1 yêu cầu kiểm tra xem có hook/middleware nào tái dùng được để tự động cập nhật Runtime Graph từ tool result. Khảo sát (A) xác nhận: **component này đã tồn tại thật**, không phải thiết kế từ đầu:

- **`KGAutoIngestMiddleware`** (`packages/raptix/raptix/middleware/kg_autoingest.py`) — `awrap_tool_call` chạy **sau khi** tool `bash` thực thi xong (await handler trước, dòng 151-161), nhận diện tool output có phải output của 1 scanner đã biết (`nmap`/`httpx`/`nuclei`/`katana`/`arjun`/`subfinder`/`dnsx`/`ffuf`/`masscan`/`gobuster`...) qua regex command + cờ output file (`-oX`/`-o`/`-oJ`), tự tải file output từ sandbox, gọi `knowledge/ingest/registry.py`'s `ParserRegistry.parse()` (code thật, "Wave T3", không phải proposal) để chuẩn hóa, rồi ghi vào Neo4j theo đúng cơ chế dedup/MERGE của `KGStore`.
- **`TriedEdgesMiddleware`** (`packages/raptix/raptix/middleware/tried_edges.py`) — cùng pattern (quan sát tool call sau khi chạy), tự ghi "tried edge" (`Candidate-MAPS_TO`) từ regex trích actor/target trong command, không cần agent gọi tool ghi tay.
- Cả 2 đăng ký qua `MiddlewareSlot` (`middleware_slots.py`, slot `KG_AUTOINGEST`/`TRIED_EDGES`) **nhưng mặc định OFF** — gate bởi env var (`RAPTIX_KG_AUTOINGEST`, `RAPTIX_KG_TRIED_EDGES`, default `"0"`).
- **Giới hạn phạm vi hiện tại:** chỉ áp dụng cho tool `bash` (so khớp `request.tool.name == "bash"`) — **không** áp dụng cho các domain tool khác (`http_request`, `browser_action`, `web_fetch`...). Lý do hợp lý: hầu hết scanner CLI (nmap/nuclei/ffuf...) chạy qua `bash`, không qua tool domain riêng — phạm vi hiện tại đã khớp với cách agent thực tế dùng scanner.

**→ Sửa Architecture Proposal:** câu "Không có gì tự ghi sau mỗi tool call" (Mục 3.2/3.4/Vấn đề 2 bản gốc) **sai một phần** — đã có cơ chế, chỉ là **tắt mặc định** và **phạm vi hẹp** (chỉ `bash` + scanner đã biết tên). Đã sửa trực tiếp vào file proposal (xem ghi chú cuối Mục 2 phần "Việc KHÔNG làm").

**[Quyết định đề xuất]** Không xây "Observation Ingestion Layer" mới. Thay vào đó:
1. Rà soát lại `KGAutoIngestMiddleware`'s scanner registry hiện có — nếu đã đủ các scanner agent thường dùng (theo tools README), không cần mở rộng.
2. Xác nhận lại cách middleware này phân biệt observation/hypothesis: dữ liệu ghi qua `ParserRegistry.parse()` → `record_observations()` luôn mang `kind` cụ thể theo parser (ví dụ `Host`/`Service`/`Vulnerability` quan sát được từ scan) — đây vốn là **observation thật từ tool output**, không phải hypothesis (hypothesis vẫn chỉ ghi qua `kg_record` tay, đúng thiết kế "agent vẫn chủ động ghi hypothesis khi cần" ở proposal Mục 2).
3. Dedup/idempotency: đã có sẵn qua `KGStore`'s MERGE theo key — không cần thêm gì.
4. **[Cần thiết kế thêm]** Error handling khi parse thất bại/output thiếu/graph write lỗi: chưa xác minh được hành vi thật (fail-open hay raise) trong lượt khảo sát này — cần đọc kỹ `kg_autoingest.py`'s exception handling lúc implement, không chặn việc duyệt thiết kế tổng thể vì đây là 1 middleware đã tồn tại, không phải code mới cần thiết kế từ đầu.
5. Raw output: middleware chỉ trích field đã parse (không dump raw scanner output vào graph) — đã đúng nguyên tắc "không lưu toàn bộ raw output" ngay từ thiết kế hiện tại.
6. Liên kết xuyên conversation cùng project: đã có sẵn, không liên quan middleware này — do AKG scope theo project (Mục 3.6 proposal), không theo conversation.

**[Đã người dùng chốt]** Chưa bật mặc định. Giữ nguyên feature flag (`RAPTIX_KG_AUTOINGEST`/`RAPTIX_KG_TRIED_EDGES`, default off), và thêm 1 bước kiểm thử bắt buộc **trước khi** xét bật mặc định — **ưu tiên `KGAutoIngestMiddleware` trước `TriedEdgesMiddleware`**:

1. Kiểm thử `KGAutoIngestMiddleware` trên tool output thực tế (không phải fixture tối giản) cho từng scanner đã đăng ký (`nmap`/`httpx`/`nuclei`/`katana`/`arjun`/`subfinder`/`dnsx`/`ffuf`/`masscan`/`gobuster`) — xác nhận: (a) parser nhận diện đúng output thật của từng binary (không chỉ cờ `-oX`/`-o`/`-oJ` mẫu), (b) observation ghi vào AKG đúng `kind`/props, không sai lệch so với output gốc, (c) không tạo duplicate ngoài dự kiến qua nhiều lần chạy cùng scan, (d) hành vi khi parse lỗi/output rỗng/file không tồn tại — không crash tool call, không âm thầm ghi dữ liệu rác.
2. Chỉ sau khi (1) đạt, lặp lại tương tự cho `TriedEdgesMiddleware` (regex trích actor/target từ command).
3. Chỉ sau khi cả 2 đạt + không có regression nào trong functional/integration test (Mục 8) mới xét chuyển `RAPTIX_KG_AUTOINGEST`/`RAPTIX_KG_TRIED_EDGES` sang default on — quyết định này vẫn cần người dùng duyệt lại ở thời điểm đó, không tự động.

Không chạm guard rail nào (`middleware/roe.py`/`SafeCommand`/`EngagementContext`) nên không cần ADR+threat-model cho bước test/bật flag này.

---

## 4. Graph-aware Reasoning Policy — [Sửa] áp dụng vào middleware thật, không xây reasoning engine mới

**[Hiện trạng — làm rõ lại, review điểm 2]** Khảo sát (A) đọc kỹ `middleware/kg.py`:
- `_hydrate_kg_state` **có cache theo revision** — chỉ rebuild `build_summary()` (tốn chi phí) khi `store.revision()` đổi so với lần trước, không phải tính lại vô điều kiện mỗi turn. Vấn đề thật **không phải chi phí tính toán**, mà là bước **chèn (`_inject_kg_context`) chạy mỗi turn vô điều kiện** một khi `kg_engagement` đã có trên state — agent không được chọn bỏ qua.
- **`kg_surface_inventory`** đã là 1 tool on-demand thật (`knowledge/graph/tools.py`, docstring "read-only"), nhưng **chỉ enable cho role `"raptix"` (orchestrator)** — specialist subagent không gọi được.
- `builder.py` (system prompt tĩnh) và `KGMiddleware` (chèn runtime, mỗi turn) là **2 pipeline tách biệt hoàn toàn** — KG summary luôn được append SAU khi system prompt tĩnh đã build xong, không đi qua `builder.py`.
- Có 1 cơ chế context management khác đã chạy thật: `_SafeSummarizationProxy` (slot `SUMMARIZATION`) — compaction/truncation cho model output, có `context_epoch`, fail-open. Không trực tiếp liên quan KG, nhưng là ví dụ cụ thể cho "cơ chế context đã có" mà user hỏi có tái dùng được không — câu trả lời: **không áp dụng trực tiếp** (nó xử lý model output dài, không xử lý "có nên chèn block KG hay không"), nhưng xác nhận pattern "theo dõi 1 epoch/revision để quyết định có cần làm lại việc gì không" đã có tiền lệ trong codebase (giống đúng cách `_hydrate_kg_state` đã làm với `revision`).

**[Hiện trạng — kiểm tra thêm, review điểm bổ sung "KGMiddleware phải xử lý đúng compaction/resume"]** Khảo sát sâu hơn `_hydrate_kg_state`/`_inject_kg_context` + `_SafeSummarizationProxy` cho thấy **giả thiết ban đầu ("compaction có thể xoá block KG đã chèn trước đó") sai ở cơ chế, nhưng không đổi kết luận thiết kế:**
- `request.system_message` **không phải state được persist/checkpoint** — nó là 1 `ModelRequest` object mới, dựng lại **mỗi lần `wrap_model_call` chạy**, từ system prompt tĩnh (đóng lúc `create_agent` compile) + block KG được `_inject_kg_context` append **tại chỗ, mỗi turn**, đọc từ `kg_summary` (1 state field riêng). Compaction (`_SafeSummarizationProxy`) chỉ đọc/viết `state["messages"]` (lịch sử Human/AI/Tool) — **không bao giờ chạm `system_message`**. Hai cơ chế độc lập hoàn toàn, không có đường nào compaction "xoá" 1 block đã từng nằm trong system message, vì system message chưa bao giờ được lưu lại giữa các turn để có gì bị xoá.
- Hệ quả đúng: nếu đổi `_inject_kg_context` để **bỏ qua append khi revision không đổi**, turn đó system message **đơn giản là không có block KG nào** — không phải "bị mất do compaction", mà là "không được thêm lại ở turn này" (đúng như chủ ý thiết kế: không lặp lại nội dung không đổi).
- `kg_revision`/`kg_summary`/`last_injected_revision` (field mới sẽ thêm) đều là **field trong `KGState`** (`NotRequired`, có reducer `reduce_converging_value`), merge vào `AgentState` chuẩn — **được LangGraph checkpoint cùng `messages`**, không phải instance attribute của middleware object (xác nhận: `KGMiddleware.__init__` chỉ set config tĩnh, không có state theo-turn nào lưu vào `self`). → **Resume qua checkpoint hoạt động đúng**: giá trị `last_injected_revision` của lần chạy trước được load lại chính xác, không bị reset về rỗng chỉ vì tạo lại process/instance.
- Thứ tự slot `KG` (822, outer) chạy trước `SUMMARIZATION` (831, inner) trong cùng 1 turn — không tạo tương tác nguy hiểm vì 2 middleware ghi vào 2 phần khác nhau của request (system message vs messages).

**Kết luận: không cần sửa gì thêm để "xử lý đúng compaction" — vì không có tương tác nào giữa 2 cơ chế để xử lý.**

**[Cập nhật tại thời điểm implementation — item 1 dưới đây đã bị RÚT LẠI, xem ADR-0108 "Alternatives considered"]** Đề xuất `last_injected_revision` ở item 1 (dòng dưới) hoá ra sai ở đúng điểm đoạn trên vừa chứng minh: "turn đó system message đơn giản là không có block KG nào" — nghĩa là agent **mất hoàn toàn khả năng nhìn thấy summary ở turn đó**, không phải "đã biết rồi nên khỏi nhắc lại". Vì system message không persist, agent không có cách nào "nhớ" block đã thấy ở turn trước; gate theo revision chỉ tạo ra các turn mù thông tin, đổi lấy tiết kiệm vài trăm token của 1 block đã vốn bị cap ở `MAX_KG_CONTEXT_CHARS=1800`. ADR-0108 (`docs/adr/0108-project-scoped-graph-retrieval-and-promotion.md`, mục "Alternatives considered") ghi nhận rõ: *"Revision-only injection suppression: rejected because system messages do not persist."* Quyết định cuối: **giữ nguyên hành vi chèn vô điều kiện mỗi turn** (block nhỏ, đã cap sẵn) — "selective/on-demand retrieval" được đáp ứng ở tầng **chi tiết** (agent phải tự gọi `kg_query`/`kg_surface_inventory` để đào sâu), không phải ở tầng "có hiện summary hay không". Code thực tế (`middleware/kg.py::_inject_kg_context`) khớp đúng quyết định này — không cần sửa.

**[Quyết định đề xuất]** Không xây 1 reasoning engine mới. 3 thay đổi nhỏ, tận dụng đúng pattern đã có:

1. **~~Giảm force-injection~~ — RÚT LẠI, xem ADR-0108.** Đề xuất ban đầu: gate `_inject_kg_context` bằng `last_injected_revision`, chỉ append khi (a) lượt đầu hoặc (b) revision đổi. Analysis ở trên (ngay phía trên "Kết luận") cho thấy cách này không tiết kiệm được gì có ý nghĩa (block đã cap 1800 ký tự) mà lại tạo ra turn mù hoàn toàn với KG summary — ADR-0108 ghi nhận rõ as "rejected". **Giữ nguyên hành vi hiện tại: chèn block nhỏ vô điều kiện mỗi turn**, khai thác chi tiết qua `kg_query`/`kg_surface_inventory` on-demand.
2. **Mở rộng quyền gọi tool on-demand — [Đã người dùng chốt].** `kg_surface_inventory` hiện chỉ role `"raptix"`. Mở thêm quyền **đọc** (read-only, qua `kg_surface_inventory` hiện có + `kg_query`/`kg_query_reference` mới ở Mục 5) cho đúng 3 role: **`recon`, `exploit`, `postexploit`** — các role trực tiếp cần tra cứu AKG giữa lúc tác chiến, không mở tràn cho mọi specialist khác. Điều kiện giữ nguyên:
   - Vẫn giữ project-scoping (`$engagement` ép buộc như hiện có, không đổi).
   - Vẫn giữ giới hạn resource đã thiết kế ở Mục 5 (≤20 node/edge, depth ≤2).
   - **Không mở quyền ghi** (`kg_record`/`kg_ingest`) ngoài cơ chế đã có — việc mở role đọc ở đây không liên quan, không nới quyền ghi cho role nào.
   - Cách làm: thêm 3 role này vào `enabled_tools` set tương ứng ở `middleware_slots.py` (cùng chỗ đang set `{"kg_surface_inventory", "challenge_inventory"}` cho `role == "raptix"`), theo đúng `intelligence/tooling/exposure.py`'s rollout convention hiện có — không tạo cơ chế gating mới.
3. **Policy ở tầng prompt, không phải code mới.** Các yêu cầu "so sánh nhiều hypothesis", "evidence mâu thuẫn ưu tiên thực tế hơn tri thức", "không mặc nhiên theo attack pattern tìm được" — đúng bản chất là **hướng dẫn suy luận**, nên đưa vào `intelligence/prompts/standard/raptix.md`/prompt specialist tương ứng (nơi mọi hướng dẫn hành vi suy luận khác của agent đã sống), không phải 1 cơ chế middleware mới. **[Cần thiết kế thêm]** Soạn đúng đoạn prompt — việc này nên làm cùng lúc viết `kg_query_reference`/`kg_query` (Mục 5) để có ví dụ cụ thể minh họa trong prompt, không soạn trước khi tool tồn tại.

**Không mất thông tin khi giảm injection:** vì (1) chỉ bỏ chèn LẶP LẠI (không đổi), không bỏ chèn lần đầu/lần có thay đổi thật — agent vẫn luôn thấy summary mới nhất khi nó thật sự mới, và vẫn có tool chủ động tra lại bất cứ lúc nào.

---

## 5. Graph Query Interface

**[Hiện trạng xác nhận lại]** Không đổi so với bản gốc: AKG hôm nay chỉ có forced summary + `kg_surface_inventory` hẹp + đường thoát `bash('cypher-shell ...')`.

**[Quyết định đề xuất — không đổi]** `kg_query_reference(query_type, params)` cho Knowledge Reference Graph, tập đóng `query_type`, giới hạn resource cứng — giữ nguyên thiết kế bản gốc, chỉ cập nhật `search_by_name` dùng `CONTAINS` thay full-text (Mục 1.4).

**[Hiện trạng — RoE scope cho Knowledge Reference Graph, không đổi kết luận]** Review không phản đối điểm này, giữ nguyên: Knowledge Reference Graph không gắn `engagement`/target cụ thể — `evaluate_target()` không có đối tượng để kiểm tra, **không cần RoE-gate**. (Khác hẳn câu hỏi RoE cho AKG writes ở Mục 6 — 2 câu hỏi RoE tách biệt, không nhầm lẫn.)

### 5.1. Node.js ↔ Python transport — [Bổ sung cụ thể, review điểm 3]

**[Hiện trạng — quan trọng]** Khảo sát (B) xác nhận: `RuntimeTransport` (`apps/api/src/adapters/runtime/client.ts`) hôm nay **chỉ** expose các method LangGraph chuẩn (`createThread/createRun/streamRun/...`) — **không có đường "gọi 1 tool rời không qua agent run"**. Nhưng **đã có tiền lệ kỹ thuật thật** để thêm đường này: `interfaces/api/plugins_api.py` (Python, mount qua `langgraph.json`'s `http.app` hook) đã `include_router` 3 router **không đi qua thread/run LangGraph** — `finding_poc_router`/`webshell_router`/`specialist_router`. Ví dụ cụ thể: `interfaces/api/finding_poc_routes.py`'s `POST /_raptix/findings/{id}/poc` gọi thẳng hàm Python (`read_sealed_poc`), chỉ cần `sandbox_url`/`sandbox_token` trong body — không tạo thread/run nào.

**[Quyết định đề xuất]** Theo đúng pattern đã có, không phát minh transport mới: thêm 1 router Python mới `interfaces/api/kg_query_routes.py`, mount cùng cách `finding_poc_routes.py` đã làm, expose ví dụ `POST /_raptix/kg/query` nhận `{engagement, query_type, params}` — gọi trực tiếp hàm Cypher cố định của `kg_query_reference`/`kg_query` (Mục 3 cũ/5), không qua agent run. Phía `apps/api`, thêm 1 method mới trên `RuntimeTransport` (ví dụ `queryKnowledgeGraph(engagement, queryType, params)`) gọi endpoint này trực tiếp — cùng tầng với các method LangGraph hiện có, không cần route mới trong `langgraph.json`.

**[Hiện trạng — xác nhận theo yêu cầu kiểm tra bổ sung "endpoint Python phải có cơ chế xác thực/ủy quyền nội bộ"]** Đã xác minh: `plugins_api.py:143` khai `FastAPI(..., dependencies=[Depends(require_runtime_token)])` ở **cấp app** — áp dụng tự động cho MỌI router `include_router()` sau đó, không cần mỗi router tự khai auth riêng (comment trong file tự nói rõ ý định này). `require_runtime_token` (`interfaces/api/auth.py`) so sánh header `Authorization: Bearer <token>` với nội dung file `RAPTIX_RUNTIME_API_TOKEN_FILE` bằng `hmac.compare_digest` (≥32 bytes, hằng-thời-gian). Đây **đúng cùng token** mà `apps/api/src/adapters/runtime/client.ts`'s `RuntimeClient` đã gửi cho MỌI request hiện có (LangGraph thread/run và cả `finding_poc`/`webshell`/`specialist` router). **→ Nếu `kg_query_routes.py` chỉ khai `APIRouter()` không tự thêm `Depends` riêng (đúng pattern `finding_poc_routes.py` đã làm), nó tự động được bảo vệ bởi cùng cơ chế — không cần code auth mới.**

Về việc "không tin tưởng tùy ý giá trị `engagement` trong request body" — chuỗi tin cậy đầy đủ: (1) request Node→Python phải qua `require_runtime_token` trước (chỉ `apps/api` giữ token này, theo CLAUDE.md "Only `apps/api` may hold `RAPTIX_RUNTIME_API_TOKEN_FILE`"); (2) **`apps/api` tự nó không bao giờ lấy `engagement` từ client** — luôn resolve server-side từ `ProjectStore.findById(id)` (Mục 5.2, không đổi). Vậy giá trị `engagement` trong body gửi sang Python **luôn do `apps/api` tự tính, không phải pass-through từ request gốc của user** — 2 lớp (ai được gọi + engagement từ đâu) độc lập và đã đủ, không cần thêm cơ chế ủy quyền nào ở Python side ngoài `require_runtime_token` đã có.

**[Hiện trạng — rủi ro đã tồn tại từ trước, không phải do thiết kế này, ghi nhận để biết]** Token là static (đọc 1 lần, cache cả process, không rotate runtime), không phân quyền per-route (ai cầm token có quyền như nhau trên toàn bộ `plugins_api.app`, kể cả router KG mới). Đây là giới hạn đã tồn tại với 3 router hiện có, không phải vấn đề mới phát sinh do thêm KG — không xử lý trong tài liệu này.

### 5.2. Project authorization cho endpoint mới — [Bổ sung, review điểm 3]

**[Hiện trạng — quan trọng]** Khảo sát (B) xác nhận: hệ thống **không có RBAC, không có kiểm tra project-ownership nào** ở route layer hôm nay — `createRequireSession` (`apps/api/src/http/plugins/auth-guard.ts`) chỉ xác thực session còn sống, không check ai sở hữu project/asset nào. `model Project` không có `ownerId`. Đây là **thiết kế single-tenant chủ đích** (schema comment: "Tier 1... a single-operator credential"), không phải lỗ hổng bị bỏ sót. Mọi route `/:id` hiện tại (assets, roles...) đều chỉ `requireSession`, không filter theo operator.

**→ Hệ quả cho thiết kế mới:** "authorization" ở mức operator-vs-operator **không phải vấn đề cần giải quyết thêm** (hệ thống chưa có khái niệm đó ở bất kỳ route nào khác — thêm riêng cho route KG sẽ không nhất quán với toàn bộ `apps/api`, ngoài phạm vi tài liệu này). **Ranh giới thật sự cần giữ** là: **endpoint mới không được cho phép 1 request truy cập project KHÁC với project nó khai báo** — tức đúng yêu cầu "project ID tùy ý không thể đọc dữ liệu project khác", nhưng cơ chế là **data-scoping**, không phải **access-control giữa người dùng**.

**[Quyết định đề xuất]** Route mới (`GET /api/projects/:id/akg-candidates`, `POST .../facts/:factId/promote`) phải:
1. Luôn resolve `engagement` (= `workspaceSlug`) từ `ProjectStore.findById(id)` **server-side** — đúng convention đã xác nhận (`workspaceSlug` chưa bao giờ nhận từ client ở bất kỳ route nào, luôn đọc lại từ DB sau `findById`). **Không bao giờ** nhận `engagement`/`workspaceSlug` trực tiếp từ request body/query của endpoint mới.
2. Mọi Cypher ở Python side vẫn giữ nguyên cơ chế ép buộc `$engagement` đã có (không đổi `store.py`) — route Node chỉ truyền đúng giá trị đã resolve ở bước 1, không có đường nào client tự set `engagement` khác với project `:id` trong URL.
→ Với 2 điểm này, project isolation được giữ đúng mà không cần thêm RBAC mới, không tạo tiền lệ khác biệt so với route khác trong `apps/api`.

---

## 6. Security boundaries — [ĐẢO NGƯỢC kết luận bản gốc] không gate RoE cho `kg_record`/`kg_ingest`

**Review điểm 6 yêu cầu phản biện lại kết luận cũ, không chỉ xác nhận lại. Sau khi phân loại 3 loại hành vi (a) hành động mạng thật, (b) ghi observation thụ động, (c) ghi dữ liệu giả mạo — kết luận bản gốc KHÔNG đứng được. Đảo ngược.**

**[Hiện trạng — bằng chứng từ khảo sát (E)]**
1. Toàn bộ 9 tool trong `GATED_TOOL_NAMES` (`middleware/roe.py`) đều thuộc 1 trong 2 nhóm: thực thi lệnh sandbox (`bash*`) hoặc tự phát gói tin/HTTP request ra 1 host (`http_request`/`proxy_send_request`/`browser_action`/`web_fetch`/`detect_tech_stack`/`verify_workspace_candidate`). **Không có tool thuần đọc/quan sát (read-only, không I/O mạng) nào trong danh sách.** `_evaluate()` chỉ gọi `evaluate_target()` khi tool nằm trong `self._gated` — tool không gated thì `allow_default()` ngay, không chạm target-check.
2. `kg_record`/`kg_ingest` **không có side-effect mạng/lệnh nào**: `kg_record` chỉ ghi Neo4j transaction; `kg_ingest` chỉ đọc **1 file đã có sẵn trong sandbox** (do 1 tool khác — đã bị RoE-gate ở bước thu thập — tạo ra) rồi ghi Neo4j. Không mở socket, không dispatch lệnh.
3. Không có ADR/threat-model nào trong repo đặt tên "graph data integrity"/"KG poisoning" như rủi ro riêng. Tài liệu gần nhất liên quan (`docs/architecture/tool-classification.md`) gọi `kg_record` là "control-plane tool... LLM should not CRUD canonical state directly" — đây là concern về **giảm tool-exposure** (kiến trúc), không phải concern RoE/scope.
4. Provenance đã bị khóa ở tầng server cho field quan trọng nhất (`engagement`/`firstseen`/`lastupdated`/`created_by`/`source_episode_id` — agent gửi gì cũng bị `props.pop()` trước khi ghi, server set lại). Field agent vẫn tự set: `kind`/`key`/`label`/props khác — chỉ kiểm tra cú pháp (`_safe_label()`, regex PascalCase), không phải enum đóng dù comment gọi "closed-vocabulary". Đây là 1 khoảng hở nhỏ về đặt tên/validation, không phải lỗ hổng RoE.
5. `record_observations()` không bắt buộc field target nào — `key`/`kind` là đủ để ghi 1 hypothesis thuần suy luận, không gắn host cụ thể.

**[Phân tích — vì sao `evaluate_target()` sai công cụ cho loại rủi ro (b)/(c)]**
- `evaluate_target()` tồn tại để chặn agent **THỰC HIỆN** 1 hành động có tác động thật (gửi request/lệnh) tới 1 target ngoài RoE scope — rủi ro là **hành động vượt phạm vi được phép, có thể gây hậu quả pháp lý/vận hành thật** lên hệ thống của khách hàng/bên thứ ba.
- Ghi 1 node "host X có vulnerability Y" vào graph **không chạm gì tới host X** — không gửi packet, không có tác động ngoài hệ thống Raptix. Đây là rủi ro loại (c) **graph poisoning / data integrity** (dữ liệu sai/giả ảnh hưởng *reasoning của agent*, hoặc đánh lừa operator đọc báo cáo sau này) — khác hoàn toàn bản chất với (a).
- Nếu áp `evaluate_target()` cho graph write (như kết luận cũ đề xuất): sẽ **chặn sai** các trường hợp hợp lệ — ví dụ agent passive-recon phát hiện 1 domain liên quan nhưng ngoài scope, muốn ghi chú "đã thấy, không theo đuổi vì ngoài scope" — đúng điều review điểm 6 cảnh báo ("ảnh hưởng chức năng passive recon/linking findings hiện tại"). Ghi chú thụ công này **nên được phép**, vì nó giúp agent (và operator) biết ranh giới, không phải hành vi cần chặn.

**[Quyết định đề xuất — đảo ngược]** **Không thêm `kg_record`/`kg_ingest` vào `GATED_TOOL_NAMES`. Không thêm target-extractor. Không sửa `middleware/roe.py`.** Rủi ro thật (graph poisoning/unverified claims) đã được khống chế đúng chỗ bởi cơ chế khác, không cần RoE:
- Provenance server-lock đã có (mục 4 trên) — agent không thể giả mạo *nguồn gốc* của 1 write.
- **Validated Knowledge Promotion (Mục 7)** là lưới chặn thật cho rủi ro "dữ liệu sai trở thành tri thức lâu dài" — AKG observation không bao giờ tự động trở thành `ProjectFact` đã verified; luôn cần operator xác nhận trước khi 1 claim có giá trị "finding đã xác minh". Đây đúng là nguyên tắc "verification before learning" đã thống nhất ở proposal Mục 1 — và nó áp dụng ở đúng điểm cần áp dụng (trước khi persist lâu dài), không phải ở điểm ghi tạm vào working memory.

**Hệ quả:** không cần ADR + threat-model paragraph nào cho mục này nữa (vì không chạm `middleware/roe.py`). **Xóa bước "vá RoE-gating" khỏi Mục 9 roadmap.**

**[Cần thiết kế thêm, mức độ thấp, không chặn duyệt tài liệu]** `_safe_label()` chỉ kiểm tra cú pháp, không phải enum đóng dù comment gọi vậy — có thể làm chặt hơn thành enum thật ở 1 PR riêng sau này nếu team muốn, không liên quan RoE, không urgent.

**[Đã người dùng chốt]** Đồng ý không sửa `roe.py`. **Nhưng người dùng phản biện đúng 1 điểm:** Validated Promotion (Mục 7) chỉ chặn dữ liệu sai **trở thành finding đã xác minh** — nó không chặn dữ liệu sai **ảnh hưởng reasoning của agent trong lúc tác chiến**, trước khi bất kỳ ai nghĩ đến promote. 1 observation giả/sai do prompt-injection hoặc LLM tự suy diễn sai vẫn nằm trong AKG, vẫn được agent khác (hoặc chính agent đó ở turn sau) đọc lại qua `kg_surface_inventory`/`kg_query`, có thể dẫn reasoning sai hướng — đây là rủi ro thật, cần xử lý **ở điểm ghi/đọc, không chỉ ở điểm promote**. Thiết kế bổ sung ở Mục 6.1.

### 6.1. Trust classification cho Runtime Graph writes [bổ sung theo yêu cầu người dùng]

**[Hiện trạng — xác minh]** `record_observations()` hiện **không có cách phân biệt** observation ghi bởi `KGAutoIngestMiddleware` (tự động, từ output 1 scanner đã biết, qua `ParserRegistry` có validate format) với observation ghi bởi `kg_record` (LLM tự soạn JSON tay, không qua parser nào). Cả 2 call site truyền cùng bộ tham số (`created_by`, `source_episode_id`) với cùng format — không có field `channel`/`origin`/`confidence` nào tồn tại trong schema hiện tại để phân biệt độ tin cậy nguồn ghi.

**[Quyết định đề xuất]** Thêm 1 reserved property mới vào `record_observations()`, theo đúng cơ chế server-lock đã có cho `engagement`/`created_by`/... (bị `props.pop()` khỏi input của agent, server tự gán):

- `provenance_channel`: `"tool_autoingest"` | `"agent_authored"`. Gán **tại call site**, không phải tham số LLM điều khiển được:
  - `KGAutoIngestMiddleware`/`TriedEdgesMiddleware` (`middleware/kg_autoingest.py`/`tried_edges.py`) gọi `record_observations(..., provenance_channel="tool_autoingest")` — hardcode tại nơi gọi.
  - `kg_record` tool (`knowledge/graph/tools.py`) gọi `record_observations(..., provenance_channel="agent_authored")` — hardcode tại nơi gọi, LLM không có tham số nào để tự set giá trị này.
- **Quy tắc precedence, chặn 1 dạng poisoning cụ thể:** nếu node đã tồn tại với `provenance_channel = "tool_autoingest"` (đã được 1 scanner xác nhận qua parser có validate), 1 lần `MERGE` sau đó mang `provenance_channel = "agent_authored"` **không được hạ cấp** giá trị này — giữ `"tool_autoingest"` (xử lý trong `record_observations()`'s prop-merge logic, tương tự cách `engagement`/`created_by` đã được khóa, không phải LLM override được). Lý do: ngăn agent (hoặc nội dung bị prompt-injection) "ghi đè" 1 fact đã được xác nhận bởi tool thật bằng 1 claim tự soạn, dưới danh nghĩa cùng node.
- **Đây là thay đổi ở `knowledge/graph/store.py` (2 call site + 1 quy tắc precedence) — KHÔNG phải `middleware/roe.py`/`SafeCommand`/`EngagementContext`, không nằm trong danh sách guard rail của CLAUDE.md, không cần ADR+threat-model.**

**[Quyết định đề xuất — surfacing, không phải validation chặn cứng]** Thay vì chặn write của `kg_record` (dễ over-block passive recon hợp lệ, đúng lý lẽ đã bác RoE-gating ở Mục 6), xử lý rủi ro bằng cách làm **trust visible tại điểm đọc**, để reasoning (agent) và review (operator) tự cân nhắc:
1. `kg_surface_inventory`/`kg_query` (Mục 5): mọi observation trả về kèm `provenance_channel`. Summary injection (Mục 4) tiếp tục dùng bucket "claims chưa verify" đã có sẵn trong thiết kế cũ — mở rộng bucket này để tách riêng `agent_authored` (độ tin cậy thấp hơn, chưa qua parser nào) khỏi `tool_autoingest` (đã qua parser có validate format).
2. `GET /api/projects/:id/akg-candidates` (Mục 7): response trả kèm `provenance_channel` + `created_by` cho mỗi candidate — operator thấy rõ nguồn gốc trước khi quyết định `verified`/`rejected`. Đây là bổ sung field, không đổi luồng promotion đã thiết kế.

**Không làm (tránh over-engineering theo đúng yêu cầu):** không xây 1 "graph-write validation engine" tổng quát (kiểm tra ngữ nghĩa/plausibility của mọi claim) — không có cơ sở để biết claim nào "đúng" ngoài so khớp parser đã biết; không chặn `kg_record` ghi node mới hoàn toàn (chỉ chặn hạ cấp 1 node đã có nguồn tool xác nhận); không thêm bảng audit riêng cho mọi write (đã có `firstseen`/`lastupdated`/`created_by`/`source_episode_id` làm audit trail tối thiểu, đủ dùng).

---

## 7. Validated Knowledge Promotion (AKG ↔ Fact Graph, hoàn thiện 4A) — [Sửa schema theo review điểm 4]

**[Hiện trạng — bổ sung quan trọng từ khảo sát (C)]**
- `ProjectFact` đã có sẵn field provenance-like dạng string-FK-không-thật: `sourceConversationId`, `sourceMessageId` (default `""`), do route **"Promote" đã triển khai đầy đủ** (`POST /api/projects/:id/promote-attack-chain/:conversationId`, `projects.routes.ts:599-664`) set — **không phải stub 501** như 1 draft trước từng giả định (comment cũ trong schema đã lỗi thời, route thật đã code xong).
- **Không có model `Evidence`/`Observation` nào** trong `schema.prisma`. Gần nhất: `Vulnerability.evidence` (free-text, không liên quan), `ScanLink` (join lỏng, 1 chiều, comment ghi rõ **không** dùng cho liên kết AKG).
- `ProjectFactEdge` là **model join nhiều-nhiều có thật duy nhất** hiện có (fact↔fact) — đây là pattern nên tái dùng, không phải phát minh mới.
- **Không có `$transaction` nào** được dùng cho fact write ở bất kỳ đâu trong `apps/api` (chỉ 2 chỗ dùng `$transaction` trong toàn app, cả 2 không liên quan fact). An toàn concurrency duy nhất là `@@unique([projectId, factKey])` + catch `P2002` (`isUniqueViolation()`) — nhưng **chỉ 2/N write path có catch này**; **route Promote hiện tại KHÔNG có catch này** → 2 request Promote đồng thời cho cùng conversation có thể surface lỗi 500 thô thay vì 409 (gap thật, đã tồn tại từ trước, không phải do thiết kế mới).
- `kg-assets-sync.ts` xác nhận lại: chỉ 1 chiều, đọc Neo4j rồi upsert Postgres, không có pattern dual-write 2-phase nào trong toàn `apps/api` để tham khảo.

**[Quyết định đề xuất — sửa theo review điểm 4]**

**1. Đổi tên cột, theo đúng góp ý review (đúng — tên cũ mô tả sai bản chất):**

```prisma
model ProjectFact {
  // ... giữ nguyên field hiện có (factKey, category, confidence, pinned, deprecated,
  //     sourceConversationId, sourceMessageId, relatedVulnerabilityId, ...)
  verificationState String    @default("observed")  // proposed | observed | verified | rejected | stale
  verificationSource String  @default("")           // "akg" | "manual" | "chat-promote" | ""
  verifiedAt        DateTime?
  verifiedBy        String   @default("")
  @@index([projectId, verificationState])
}
```

`provenanceState` → `verificationState` (đúng góp ý: giá trị `proposed/observed/verified/rejected/stale` là 1 state machine xác minh, không phải "nguồn gốc dữ liệu" — "nguồn gốc" đã có field riêng `verificationSource` + `sourceConversationId`/`sourceMessageId` sẵn có). Giữ `String`, không enum — khớp 100% convention đã xác nhận lại (0 enum trong schema).

**2. Thay `sourceObservationId` (string đơn) bằng join table — theo đúng pattern `ProjectFactEdge` đã có, giải quyết đúng review điểm 4's tình huống "1 finding nhiều observation" / "1 observation nhiều finding":**

```prisma
model ProjectFactEvidence {
  id                String      @id @default(cuid())
  projectId         String
  project           Project     @relation(fields: [projectId], references: [id], onDelete: Cascade)
  fact              ProjectFact @relation(fields: [factId], references: [id], onDelete: Cascade)
  factId            String
  akgObservationKind String     // label AKG gốc (ví dụ "Vulnerability"/"Host") — bắt buộc, xem lý do bên dưới
  akgObservationKey String      // key của node AKG gốc (không phải FK thật — AKG ở Neo4j, không join được)
  provenanceChannel String      @default("")  // copy từ node AKG lúc promote: "tool_autoingest" | "agent_authored" (Mục 6.1)
  createdAt         DateTime    @default(now())

  @@unique([factId, akgObservationKind, akgObservationKey])
  @@index([projectId])
  @@index([akgObservationKind, akgObservationKey])
}
```

Lý do: 1 cột string đơn (`sourceObservationId`) không biểu diễn được "1 fact có nhiều evidence hỗ trợ" hay "1 observation hỗ trợ nhiều fact" — cả 2 tình huống review điểm 4 nêu là **thật** với mục tiêu post-exploitation/attack-chain (1 privesc path thường được xác nhận bởi nhiều quan sát riêng lẻ). `@@unique([factId, akgObservationKind, akgObservationKey])` chặn double-link cùng 1 cặp (idempotent promotion), nhưng vẫn cho phép 1 observation gắn nhiều fact khác nhau (hợp lệ) và 1 fact có nhiều observation (hợp lệ) — đúng yêu cầu, tái dùng đúng shape bảng `ProjectFactEdge` đã có (string-key không enforce FK thật, vì AKG ở Neo4j không join được bằng Prisma) — **không tạo abstraction mới, chỉ nhân bản pattern đã kiểm chứng.**

**[Bổ sung theo yêu cầu kiểm tra thêm — "định danh observation không mơ hồ giữa các project"]** Constraint uniqueness thật của AKG là `(key, engagement)` theo TỪNG LABEL (Mục 1.1, xác nhận từ V001-V007) — nghĩa là cùng 1 giá trị `key` có thể tồn tại ở 2 project (engagement) khác nhau như 2 node hoàn toàn khác nhau. `akgObservationKey` một mình **không đủ để biết node nào** nếu không biết thêm label + engagement. Giải quyết:
- Thêm `akgObservationKind` (label) vào bảng trên — bắt buộc, không optional, cho đủ thông tin truy vết (key + kind + project đã resolve ra đúng 1 engagement, theo Mục 5.2 — không cần lưu thêm `engagement` riêng vì nó suy ra 1:1 từ `projectId` của chính `ProjectFact`).
- **Route `POST /promote` phải re-verify tồn tại trước khi ghi `ProjectFactEvidence`:** gọi lại `kg_query` (Mục 5) với đúng `engagement` đã resolve từ `project:id` + `akgObservationKind`/`akgObservationKey` client gửi lên, xác nhận node đó THẬT SỰ tồn tại trong scope của chính project này — nếu không tìm thấy (ví dụ key có thật nhưng ở project khác, hoặc key không tồn tại), trả 404, không tạo `ProjectFactEvidence`. Đây là chặn chính cho "không thể dùng key tùy ý để trỏ sang observation của project khác" — không dựa vào lòng tin với giá trị client gửi lên.

**[Bổ sung — "bảo toàn evidence khi AKG thay đổi/reset"]** `ProjectFact.summary`/`body` được **copy 1 lần lúc promote** (không đổi so với thiết kế gốc — "không copy toàn bộ properties, chỉ field đã map rõ"), nên nội dung fact đã verified **không phụ thuộc AKG còn tồn tại hay không** sau đó. Nếu operator chạy `raptix-cli kg reset --engagement ... --yes` (cơ chế đã có, Mục 3.2 proposal), `ProjectFactEvidence.akgObservationKey` trở thành tham chiếu treo (node gốc không còn) — đây là **hành vi dự kiến, không xử lý dọn dẹp chủ động**: evidence record vẫn còn giá trị lịch sử ("fact này từng được xác nhận từ 1 observation tồn tại lúc promote"), không cần job nào maintain tính còn-tồn-tại của nó. Nếu cần biết trạng thái "còn tồn tại hay không" sau này, tính lazy qua `kg_query` khi hiển thị, không lưu cờ riêng (tránh thêm state phải đồng bộ).

**3. State machine — làm rõ transition hợp lệ (review điểm 4 yêu cầu):**

| Từ | Đến | Điều kiện |
|---|---|---|
| (mới) | `proposed` | Operator/tool chọn 1 observation để promote |
| `proposed` | `verified` | Operator xác nhận, set `verifiedAt`/`verifiedBy` |
| `proposed` | `rejected` | Operator từ chối, giữ record (audit trail, không xóa) |
| `rejected` | `proposed` | Có evidence mới, operator re-propose (không tạo fact trùng — cùng `factKey`, update tại chỗ) |
| `verified` | `stale` | Thủ công, hoặc job định kỳ (không re-verify sau N ngày) — **không tự động theo review/threat-model "verification before learning"** |
| `stale` | `proposed` | Re-verify lại khi có evidence mới |

Transition không hợp lệ (ví dụ `rejected` → `verified` trực tiếp, bỏ qua `proposed`) → route trả 409, không cho phép nhảy bước.

**4. Concurrency fix — tái dùng helper đã có, không xây mới:**

`fact-promotion.ts`'s create/update path **phải** gọi `isUniqueViolation()` (đã có ở `projects.routes.ts:68-71`) giống đúng route manual create/update — vá đúng gap đã xác nhận ở route Promote hiện tại (không có catch này). Đây là sửa 1 bug concurrency đã tồn tại từ trước khi có thiết kế này, tận dụng helper có sẵn, không cần `$transaction` mới cho trường hợp đơn giản 1-write-1-catch.

**4b. Kiểm soát concurrent state transition — [bổ sung theo yêu cầu người dùng]** 2 request `POST /promote` cùng lúc cho CÙNG 1 `factId` (ví dụ 2 operator cùng bấm "Verify") không được phép cả 2 cùng thành công nếu chúng mâu thuẫn nhau (1 verify, 1 reject). Cơ chế: **conditional update theo state hiện tại**, không cần `$transaction`/optimistic-lock version field mới — dùng đúng khả năng chuẩn của Prisma, chưa có tiền lệ dùng trong repo nhưng không phải abstraction mới:

```ts
const result = await db.projectFact.updateMany({
  where: { id: factId, verificationState: expectedCurrentState }, // vd 'proposed'
  data: { verificationState: 'verified', verifiedAt: new Date(), verifiedBy },
});
if (result.count === 0) {
  // Someone else already transitioned it, or state machine step is invalid (Mục 7 bảng transition).
  return reply.code(409).send({ error: 'Fact is not in a promotable state' });
}
```

`updateMany` với `where` chứa cả `id` VÀ `verificationState` kỳ vọng → chỉ 1 trong 2 request đồng thời match và update (do Postgres row-level locking tại thời điểm UPDATE); request thua trả `count === 0` → 409, đúng ngữ nghĩa conflict, không cần đọc `isUniqueViolation()` cho trường hợp này (khác lỗi, cùng HTTP code 409 nhưng lý do khác: trùng `factKey` khi tạo mới vs sai state lúc transition).

**[Cập nhật tại thời điểm implementation]** Khi viết code thật, phát sinh thêm 1 nhu cầu mà snippet trên chưa tính: Mục 5 (Validated Knowledge Promotion) đòi "giữ lại ... lịch sử xác minh" — nghĩa là mỗi state-transition phải ghi thêm 1 dòng `ProjectFactVerification` audit **atomically cùng** với chính transition đó (không để lệch nhau nếu 1 trong 2 write fail giữa đường). Để đáp ứng, implementation thêm 1 cột `revision: Int` (optimistic-lock version, tăng dần ở MỌI write — kể cả edit nội dung thủ công, vá luôn gap concurrency đã xác nhận ở `update()` trước đây không có bất kỳ khoá nào) và bọc conditional-update + ghi audit row trong 1 `db.$transaction(...)` của Prisma. Đây **không phải** 2-phase-commit/dual-write xuyên store (vẫn chỉ 1 Postgres, không đụng Neo4j — đúng "Cross-store consistency" ở điểm 5 dưới), nên không vi phạm "ưu tiên giải pháp đơn giản, không 2PC". ADR-0108 ghi nhận đây là quyết định cuối ("Compare-and-set revisions reject concurrent edits and state transitions") — snippet ở trên vẫn đúng *ý tưởng* (conditional update theo state), chỉ không còn là *toàn bộ* cơ chế.

**5. Cross-store consistency — không cần 2-phase commit, vì shape thật là 1 chiều:**

Promotion **đọc** AKG (qua `kg_query`, Mục 5) rồi **chỉ viết Postgres** — không viết ngược lại Neo4j, không có "2 store cùng phải thành công". Giống đúng shape `kg-assets-sync.ts` đã làm (đọc Neo4j, viết Postgres, không dual-write) — không có vấn đề consistency 2-phase cần giải, vì chưa từng có.

**6. AKG node cập nhật sau khi finding đã verified:** không cần sync ngược — `ProjectFactEvidence.akgObservationKey` chỉ là tham chiếu; nếu operator cần nội dung mới nhất, GET `akg-candidates` (Mục 5) luôn query AKG live. Không copy toàn bộ properties của AKG node vào Postgres (đúng yêu cầu "không copy toàn bộ Runtime Graph sang PostgreSQL").

**API mới — cập nhật field so với bản gốc:**
- `GET /api/projects/:id/akg-candidates?query_type=...` — qua `RuntimeTransport.queryKnowledgeGraph()` mới (Mục 5.1), response kèm `provenance_channel`/`created_by` mỗi candidate (Mục 6.1) để operator cân nhắc trước khi verify.
- `POST /api/projects/:id/facts/:factId/promote` — áp state machine (bảng transition trên), dùng `isUniqueViolation()` (tạo mới) + conditional `updateMany` theo state (chuyển trạng thái, mục 4b), re-verify tồn tại observation qua `kg_query` trước khi ghi `ProjectFactEvidence` (mục bổ sung "định danh không mơ hồ" trên).
- `createRequireSession`, không RBAC — đúng Mục 5.2.

---

## 8. Test plan — [Bằng chứng mạnh hơn, không đổi quyết định]

**[Hiện trạng — xác nhận mạnh hơn bản gốc, review điểm 7]** Khảo sát (E) đọc `.github/workflows/ci.yml` đầy đủ: **không có bất kỳ `services:` DB nào trong toàn bộ CI — không chỉ thiếu Neo4j, Postgres cũng không chạy thật trong CI.** Comment của chính repo (`ci.yml` job `web`) nói rõ: *"apps/api's own test suite depends only on in-memory fakes... live Postgres/server verification is done by hand per tier... not in CI."*

**→ Kết luận mạnh hơn bản gốc:** "chấp nhận giới hạn local-only cho Knowledge Reference Graph integration test" **không phải hạ chuẩn so với phần còn lại của hệ thống** — mà **khớp đúng convention CI thật của toàn repo**, kể cả cho Postgres (DB quan trọng hơn Neo4j về mặt business-critical). Không có cơ sở để yêu cầu Knowledge Reference Graph đạt chuẩn CI cao hơn chuẩn mà `apps/api` tự áp cho chính Postgres của nó. **Giữ nguyên quyết định gốc, không mở CI lane mới.**

Các phần còn lại của Mục test plan (unit mock driver, integration fixture skip-if-unreachable, `FakeFactStore` mở rộng, `assets.routes.test.ts`'s seed-call-assert pattern) **giữ nguyên bản gốc**, chỉ cập nhật tên field theo Mục 7 (`verificationState` thay `provenanceState`, test thêm cho `ProjectFactEvidence`).

---

## 9. Thứ tự triển khai — [Chốt sau 5 quyết định của người dùng]

1. **Kiểm thử `KGAutoIngestMiddleware` trên tool output thật** (Mục 3) — chưa đổi default, chỉ test; đạt rồi mới làm bước tương tự cho `TriedEdgesMiddleware`. Không có code mới ngoài test fixtures.
2. **Trust classification: `provenance_channel` + quy tắc precedence** (Mục 6.1) — 2 call site + 1 rule trong `knowledge/graph/store.py`, không chạm guard rail. Làm sớm vì Mục 5/7 cần field này để surface cho agent/operator.
3. ~~Giảm force-injection trong `KGMiddleware`~~ — **rút lại, xem Mục 4 + ADR-0108**; không còn việc cần làm ở bước này.
4. **Migration Postgres** cho `ProjectFact.verificationState` + `ProjectFactEvidence` (kind+key+provenanceChannel, Mục 7) — schema thuần, rủi ro thấp.
5. **Migration Neo4j `V008`** + loader ingest `data/knowledge`, có report/checksum/soft-delete (Mục 1-2) — chưa expose gì cho agent.
6. **`kg_query_reference` tool** (Mục 5) — expose Knowledge Reference Graph, kèm transport Node↔Python mới (Mục 5.1, auth đã xác nhận tự động áp dụng).
7. **Mở quyền đọc AKG cho `recon`/`exploit`/`postexploit`** (Mục 4) — cùng lúc với bước 6/8 vì cùng đụng `middleware_slots.py`'s role-gating.
8. **Fact-promotion API + luồng** — re-verify tồn tại observation, conditional-update cho state transition, vá concurrency gap đã xác nhận (Mục 7).
9. **`kg_query` tool cho AKG** (Mục 5, phần Runtime Graph) — thay đường thoát `cypher-shell`.
10. Benchmark/so sánh reasoning — ngoài scope tài liệu này (giữ nguyên quyết định đã chốt ở proposal). **4B (Curated Reusable Experience) không nằm trong phạm vi triển khai này.**

**Không có bước "vá RoE-gating cho `kg_record`/`kg_ingest`"** trong roadmap — xem lý do đảo ngược ở Mục 6, đã được người dùng xác nhận.

**Yêu cầu bắt buộc mọi bước 2-9:** có functional/integration test tương ứng theo Mục 8 trước khi coi bước đó là xong — không merge code mới mà chỉ có unit test mock.

---

## 10. Việc KHÔNG làm trong tài liệu này

Chưa viết code, chưa chạy migration, chưa ingest dữ liệu thật, **chưa và sẽ không sửa `middleware/roe.py`** (đảo ngược so với bản gốc — xem Mục 6). Tài liệu này là thiết kế kỹ thuật để duyệt trước khi bắt đầu bước 1 ở Mục 9.
