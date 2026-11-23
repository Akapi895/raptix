# Neo4j hardening

Container `neo4j` tham gia cả `sandbox-net` và `raptix-net` để
orchestrator đọc được dữ liệu agent ghi từ sandbox — nhưng chính vì vậy
nó cũng là 1 phần ranh giới giữa sandbox và management. Mô hình mối đe
dọa đầy đủ (Cypher-injection → đọc `/proc/self/environ` → lộ credential
LiteLLM/Postgres) đã nêu ở [mô hình mối đe dọa](threat-model.md) — tài
liệu này chỉ tập trung vào **runbook hardening cụ thể**, không lặp lại
bảng STRIDE.

## Cấu hình server (`docker-compose.yml`)

```yaml
NEO4J_PLUGINS: '["apoc"]'

# Chỉ cho phép theo allowlist. File-I/O, runFile, system-db, trigger
# KHÔNG nằm trong danh sách này -> không thể gọi từ Cypher.
NEO4J_dbms_security_procedures_allowlist: >-
  apoc.coll.*,apoc.text.*,apoc.path.*,apoc.create.*,
  apoc.merge.*,apoc.refactor.*,apoc.periodic.iterate,
  apoc.lock.*,apoc.case,apoc.do.case,apoc.do.when,apoc.when,
  apoc.help,apoc.version,apoc.diff.*,apoc.label.*,
  apoc.node.*,apoc.nodes.*,apoc.rel.*,apoc.util.*

# Từ chối boot nếu gặp key config lạ -> gõ sai không thể âm thầm mở lại _unrestricted.
NEO4J_server_config_strict__validation_enabled: "true"
```

**Đã gỡ bỏ, không thêm lại**: `NEO4J_dbms_security_procedures_unrestricted: apoc.*`
(bỏ qua toàn bộ sandbox an toàn của APOC — mở cả `apoc.cypher.runFile`,
`apoc.load.json`, `apoc.export.csv.query`, `apoc.systemdb.execute`,
`apoc.trigger.add`), cùng `apoc_export_file_enabled`/
`apoc_import_file_enabled`. Allowlist hiện tại thay thế cả 3, chỉ giữ
lại nhóm hàm collection/string/path/merge/refactor/batch-write mà
`kg_add_node`/`kg_add_edge` và các pattern MERGE nội bộ thực sự dùng.

| Nhóm hàm | Vì sao giữ |
| --- | --- |
| `apoc.coll.*`, `apoc.text.*`, `apoc.util.*` | Helper list/string/hash trong query builder |
| `apoc.path.*` | Mở rộng path dùng cho chain planner |
| `apoc.create.*`, `apoc.merge.*` | MERGE shortcut cho upsert |
| `apoc.refactor.*` | Rename label/property lúc migrate |
| `apoc.periodic.iterate` | MERGE theo batch cho ingest >10k node (nmap mass scan) |
| `apoc.lock.*` | Concurrency control khi nhiều sub-agent ghi song song |
| `apoc.label.*`, `apoc.node.*`, `apoc.nodes.*`, `apoc.rel.*` | Chỉ đọc, dùng để introspect graph |
| `apoc.diff.*` | So sánh giữa 2 engagement |

**Thêm 1 hàm vào allowlist**: mở PR sửa `docker-compose.yml`, ghi rõ
tool/middleware nào cần hàm đó + link dòng gọi, xác nhận hàm không nằm
trong các nhóm cấm (`apoc.cypher.run*`, `apoc.load.*`,
`apoc.import/export.*`, `apoc.systemdb.*`, `apoc.trigger.*`,
`apoc.dbms.exec`, `apoc.spatial.geocode`, `apoc.metrics.*`), cập nhật
đồng thời allowlist phía client
(`execution/tools/research/_apoc_safety.py` — hàm bị chặn nếu không nằm
trong CẢ 2 allowlist), mở rộng test tương ứng.

## Kiểm soát phía client (defense-in-depth)

Allowlist phía server là ranh giới thật; `_apoc_safety.py` chỉ bắt lỗi
sớm ở phía Python để lỗi hiện rõ (exception có thông báo) thay vì âm
thầm lỗi sâu trong driver Neo4j. `find_violations(cypher)` trả về danh
sách hàm bị cấm xuất hiện trong chuỗi Cypher; `ensure_safe(cypher)` raise
`CypherSafetyError` nếu có. Regex cố tình bắt rộng — thà dương tính giả
(1 query hợp lệ nhắc tên hàm cấm trong string literal) hơn bỏ lọt thật.

## Kiểm chứng

```bash
# Phải thành công - hàm trong allowlist
docker compose exec neo4j cypher-shell -u neo4j -p "$NEO4J_PASSWORD" \
  "CALL apoc.help('coll') YIELD name RETURN count(name)"

# Phải lỗi "no procedure with the name apoc.cypher.runFile"
docker compose exec neo4j cypher-shell -u neo4j -p "$NEO4J_PASSWORD" \
  "CALL apoc.cypher.runFile('file:///etc/passwd')"
```

Validation strict ở boot-time cũng bắt được lỗi gõ sai config:
`Configuration setting 'dbms.security.procedures.unrestriced' not recognised.`

## Hướng tiếp theo

Kế hoạch tách user Cypher / database riêng theo từng engagement đã gộp
vào mục "Hướng hardening tiếp theo" của [mô hình mối đe dọa](threat-model.md)
— không lặp lại ở đây để tránh 2 nơi cùng mô tả 1 kế hoạch.

## Tham khảo

[Neo4j 5.x APOC security model](https://neo4j.com/labs/apoc/5/installation/#restricted) ·
CVE-2021-34371 (Neo4j APOC RCE qua `apoc.cypher.runFile`) ·
[Neo4j strict config validation](https://neo4j.com/docs/operations-manual/current/configuration/configuration-settings/#config_server.config.strict_validation.enabled)
