import fs from 'fs';

const UA = 'D:/.VTNet/redteam/raptix/.ua';
const b = JSON.parse(fs.readFileSync(`${UA}/intermediate/batches.json`, 'utf8'));
const bt = b.batches.find(x => x.batchIndex === 142);
const R = 'packages/raptix/raptix/';
const T = 'packages/raptix/tests/';

const nodes = [];
const edges = [];
const E = (source, target, type, weight) => edges.push({ source, target, type, direction: 'forward', weight });
const F = (rel, type, name, summary, tags, complexity, notes) => {
  nodes.push({ id: `${type}:${rel}`, type, name, filePath: rel, summary, tags, complexity, ...(notes ? { languageNotes: notes } : {}) });
};

// ---- raptix/skills/engine/client/__init__.py ----
F(`${R}skills/engine/client/__init__.py`, 'file', '__init__.py',
  'Package barrel cho client Skillogy: re-export RestSkillogyClient và SkillogyClientError để middleware chỉ cần import từ gói gốc.',
  ['entry-point', 'barrel', 'client', 'skill-engine'], 'simple');

// ---- rest.py + class + function ----
F(`${R}skills/engine/client/rest.py`, 'file', 'rest.py',
  'REST client đồng bộ (httpx) cho dịch vụ Skillogy Phase 1a: phản chiếu đúng bề mặt Neo4jBackend (health/find/load/traverse/moc) nên wrapper tool của middleware không phân biệt backend cục bộ hay container standalone.',
  ['client', 'rest', 'httpx', 'skill-engine', 'api-handler'], 'moderate',
  'Dùng một httpx.Client dùng chung suốt tiến trình để giữ connection pool ấm qua các lookup tuần tự.');
nodes.push({
  id: `class:${R}skills/engine/client/rest.py:RestSkillogyClient`, type: 'class', name: 'RestSkillogyClient',
  filePath: `${R}skills/engine/client/rest.py`, lineRange: [28, 169],
  summary: 'Client REST mỏng thay thế drop-in cho Neo4jBackend: gọi 5 endpoint /v1/ của server Skillogy, gắn Bearer api_key và ném SkillogyClientError khi transport lỗi hoặc response không 2xx.',
  tags: ['rest-client', 'api-handler', 'service-client', 'skill-engine'], complexity: 'complex'
});
E(`file:${R}skills/engine/client/rest.py`, `class:${R}skills/engine/client/rest.py:RestSkillogyClient`, 'contains', 1.0);
E(`file:${R}skills/engine/client/rest.py`, `class:${R}skills/engine/client/rest.py:RestSkillogyClient`, 'exports', 0.8);
nodes.push({
  id: `function:${R}skills/engine/client/rest.py:from_env`, type: 'function', name: 'from_env',
  filePath: `${R}skills/engine/client/rest.py`, lineRange: [175, 184],
  summary: 'Khởi tạo RestSkillogyClient từ biến môi trường (base URL, timeout, api key) với giá trị mặc định cho deploy compose.',
  tags: ['factory', 'env-config', 'client'], complexity: 'simple'
});
E(`file:${R}skills/engine/client/rest.py`, `function:${R}skills/engine/client/rest.py:from_env`, 'contains', 1.0);
E(`file:${R}skills/engine/client/rest.py`, `function:${R}skills/engine/client/rest.py:from_env`, 'exports', 0.8);

// ---- skillogy.proto (data → schema) ----
F(`${R}skills/engine/proto/skillogy.proto`, 'schema', 'skillogy.proto',
  'Định nghĩa wire protocol Skillogy (proto3, package decepticon.skillogy.v1): SkillMeta, SkillEnvelope cùng các message request/response cho list/load/traverse — nguồn tham chiếu chuẩn cho cả REST lẫn gRPC.',
  ['schema-definition', 'protobuf', 'wire-protocol', 'skill-engine', 'data-pipeline'], 'moderate',
  'Mỗi phương thức gRPC ánh xạ 1:1 sang endpoint HTTP+JSON dưới /v1/; các dataclass Python hiện mirror thủ công cho tới khi protoc được nối vào build.');

// ---- tools/README.md ----
F(`${R}tools/README.md`, 'document', 'README.md',
  'Catalog công cụ agent chia theo domain tấn công (bash, network, web, cloud, AD, reversing…) với cảnh báo các đường dẫn bị đóng băng bởi guardrail và quy ước đăng ký plugin.',
  ['documentation', 'tool-catalog', 'guardrails', 'conventions'], 'simple');

// ---- killchain.yaml (config) ----
F(`${R}tools/references/killchain.yaml`, 'config', 'killchain.yaml',
  'Mapping committed fallback giữa 14 pha kill-chain (recon → impact) và công cụ tương ứng (nmap, masscan, subfinder…); bị overlay bởi bản parse README RedTeam-Tools khi cache được hydrate.',
  ['reference-data', 'kill-chain', 'tool-mapping', 'configuration'], 'complex');

// ---- _apoc_safety.py ----
F(`${R}tools/research/_apoc_safety.py`, 'file', '_apoc_safety.py',
  'Lớp phòng vệ thứ hai kiểm tra an toàn APOC cho chuỗi Cypher: từ chối procedure bị cấm (file I/O, sub-cypher, system-db, trigger) trước khi gửi xuống driver, bổ sung cho allowlist phía server Neo4j.',
  ['security', 'cypher', 'validation', 'defense-in-depth', 'neo4j'], 'moderate',
  'Không phải parser Cypher — chỉ chặn các lớp payload rõ ràng để lỗi phát ra sớm và ồn ào.');
nodes.push({
  id: `function:${R}tools/research/_apoc_safety.py:find_violations`, type: 'function', name: 'find_violations',
  filePath: `${R}tools/research/_apoc_safety.py`, lineRange: [123, 138],
  summary: 'Quét chuỗi Cypher và trả về danh sách procedure APOC vi phạm allowlist/denylist để caller báo lỗi chi tiết.',
  tags: ['validation', 'cypher', 'security'], complexity: 'simple'
});
E(`file:${R}tools/research/_apoc_safety.py`, `function:${R}tools/research/_apoc_safety.py:find_violations`, 'contains', 1.0);
E(`file:${R}tools/research/_apoc_safety.py`, `function:${R}tools/research/_apoc_safety.py:find_violations`, 'exports', 0.8);
nodes.push({
  id: `function:${R}tools/research/_apoc_safety.py:ensure_safe`, type: 'function', name: 'ensure_safe',
  filePath: `${R}tools/research/_apoc_safety.py`, lineRange: [141, 145],
  summary: 'Entry-point công khai: raise CypherSafetyError nếu chuỗi Cypher chứa procedure APOC bị cấm, ngược lại cho qua.',
  tags: ['guard', 'security', 'api'], complexity: 'simple'
});
E(`file:${R}tools/research/_apoc_safety.py`, `function:${R}tools/research/_apoc_safety.py:ensure_safe`, 'contains', 1.0);
E(`file:${R}tools/research/_apoc_safety.py`, `function:${R}tools/research/_apoc_safety.py:ensure_safe`, 'exports', 0.8);

// ---- fuzz.py + fns + classes ----
F(`${R}tools/research/fuzz.py`, 'file', 'fuzz.py',
  'Điều phối fuzzing cho discovery 0-day: phân loại target theo dấu vết source layout, tổng hợp harness skeleton cho libFuzzer/AFL++/Jazzer/boofuzz/atheris và parse crash output (ASan, UBSan) thành bản ghi Crash có cấu trúc để đẩy vào knowledge graph.',
  ['fuzzing', 'research', 'harness-synthesis', 'crash-parsing', '0-day'], 'complex',
  'Thư viện pure-Python — script không tự chạy fuzzer; agent thực thi qua bash nên test không cần C toolchain.');
nodes.push({
  id: `class:${R}tools/research/fuzz.py:Engine`, type: 'class', name: 'Engine',
  filePath: `${R}tools/research/fuzz.py`, lineRange: [34, 42],
  summary: 'StrEnum liệt kê các fuzz engine hỗ trợ: libfuzzer, afl++, jazzer, atheris, cargo-fuzz, go-fuzz, boofuzz…',
  tags: ['enum', 'fuzzing', 'type-definition'], complexity: 'simple'
});
E(`file:${R}tools/research/fuzz.py`, `class:${R}tools/research/fuzz.py:Engine`, 'contains', 1.0);
E(`file:${R}tools/research/fuzz.py`, `class:${R}tools/research/fuzz.py:Engine`, 'exports', 0.8);
nodes.push({
  id: `class:${R}tools/research/fuzz.py:TargetProfile`, type: 'class', name: 'TargetProfile',
  filePath: `${R}tools/research/fuzz.py`, lineRange: [81, 88],
  summary: 'Dataclass ghi lại kết quả phân loại target: ngôn ngữ, engine mặc định, ứng viên entry-point và ghi chú từ source layout.',
  tags: ['data-model', 'dataclass', 'fuzzing'], complexity: 'simple'
});
E(`file:${R}tools/research/fuzz.py`, `class:${R}tools/research/fuzz.py:TargetProfile`, 'contains', 1.0);
E(`file:${R}tools/research/fuzz.py`, `class:${R}tools/research/fuzz.py:TargetProfile`, 'exports', 0.8);
nodes.push({
  id: `function:${R}tools/research/fuzz.py:classify_target`, type: 'function', name: 'classify_target',
  filePath: `${R}tools/research/fuzz.py`, lineRange: [91, 137],
  summary: 'Phân loại target fuzz theo thứ tự ưu tiên manifest (Cargo.toml trước Makefile…) và phần mở rộng file, trả về TargetProfile với engine mặc định phù hợp.',
  tags: ['classification', 'fuzzing', 'heuristic'], complexity: 'moderate'
});
E(`file:${R}tools/research/fuzz.py`, `function:${R}tools/research/fuzz.py:classify_target`, 'contains', 1.0);
E(`file:${R}tools/research/fuzz.py`, `function:${R}tools/research/fuzz.py:classify_target`, 'exports', 0.8);
nodes.push({
  id: `function:${R}tools/research/fuzz.py:harness_for`, type: 'function', name: 'harness_for',
  filePath: `${R}tools/research/fuzz.py`, lineRange: [247, 252],
  summary: 'Trả về skeleton harness cho engine được chọn — điểm vào công khai để agent tổng hợp harness trước khi chạy campaign.',
  tags: ['harness-synthesis', 'factory', 'fuzzing'], complexity: 'simple'
});
E(`file:${R}tools/research/fuzz.py`, `function:${R}tools/research/fuzz.py:harness_for`, 'contains', 1.0);
E(`file:${R}tools/research/fuzz.py`, `function:${R}tools/research/fuzz.py:harness_for`, 'exports', 0.8);
nodes.push({
  id: `function:${R}tools/research/fuzz.py:parse_asan`, type: 'function', name: 'parse_asan',
  filePath: `${R}tools/research/fuzz.py`, lineRange: [293, 326],
  summary: 'Parse crash output ASan/UBSan/Jazzer/boofuzz thành bản ghi Crash có cấu trúc (loại lỗi, stack, khung sự cố đầu tiên).',
  tags: ['crash-parsing', 'sanitizer', 'parsing'], complexity: 'moderate'
});
E(`file:${R}tools/research/fuzz.py`, `function:${R}tools/research/fuzz.py:parse_asan`, 'contains', 1.0);
E(`file:${R}tools/research/fuzz.py`, `function:${R}tools/research/fuzz.py:parse_asan`, 'exports', 0.8);
nodes.push({
  id: `function:${R}tools/research/fuzz.py:record_crash`, type: 'function', name: 'record_crash',
  filePath: `${R}tools/research/fuzz.py`, lineRange: [329, 357],
  summary: 'Ghi crash vào KnowledgeGraph dạng node VULNERABILITY + CODE_LOCATION kèm edge liên kết để phục vụ truy vết sau này.',
  tags: ['knowledge-graph', 'vulnerability', 'fuzzing'], complexity: 'moderate'
});
E(`file:${R}tools/research/fuzz.py`, `function:${R}tools/research/fuzz.py:record_crash`, 'contains', 1.0);
E(`file:${R}tools/research/fuzz.py`, `function:${R}tools/research/fuzz.py:record_crash`, 'exports', 0.8);
nodes.push({
  id: `class:${R}tools/research/fuzz.py:Crash`, type: 'class', name: 'Crash',
  filePath: `${R}tools/research/fuzz.py`, lineRange: [259, 269],
  summary: 'Dataclass mô tả một crash đã được parse: engine, loại lỗi, stack rút gọn và input gây lỗi.',
  tags: ['data-model', 'dataclass', 'crash'], complexity: 'simple'
});
E(`file:${R}tools/research/fuzz.py`, `class:${R}tools/research/fuzz.py:Crash`, 'contains', 1.0);
E(`file:${R}tools/research/fuzz.py`, `class:${R}tools/research/fuzz.py:Crash`, 'exports', 0.8);

// ---- tests/__init__.py + fixtures ----
F(`${T}__init__.py`, 'file', '__init__.py', 'Gốc package test của package raptix, đánh dấu cây tests cho pytest discovery.', ['entry-point', 'barrel', 'test'], 'simple');
F(`${T}fixtures/capabilities/held-out.jsonl`, 'file', 'held-out.jsonl',
  'Fixture JSONL các dòng capability held-out (lane, verified, duration, cost, root_cause_id) dùng làm dữ liệu chấm benchmark không tham gia huấn luyện.',
  ['fixture', 'benchmark', 'data', 'capabilities'], 'simple',
  'Mỗi dòng một object JSON phẳng; file bị parser cấu trúc bỏ qua nên được phân tích thủ công.');
F(`${T}integration/__init__.py`, 'file', '__init__.py',
  'Package test tích hợp yêu cầu hạ tầng sống (compose Neo4j, langgraph, sandbox); các test tự skip khi dịch vụ không với tới được.',
  ['entry-point', 'barrel', 'integration-test'], 'simple');
F(`${T}integration/kg/__init__.py`, 'file', '__init__.py',
  'Package test tích hợp KGStore + migration runner + KGMiddleware, yêu cầu Neo4j 5.x và tự skip qua fixture kgstore khi không kết nối được.',
  ['entry-point', 'barrel', 'integration-test', 'neo4j'], 'simple');

// ---- empty unit __init__ files ----
const emptyInits = ['tests/unit/__init__.py', 'tests/unit/ad/__init__.py', 'tests/unit/agents/__init__.py', 'tests/unit/agents/standard/__init__.py', 'tests/unit/backends/__init__.py', 'tests/unit/benchmark/__init__.py', 'tests/unit/blue_cell/__init__.py', 'tests/unit/cli/__init__.py', 'tests/unit/cloud/__init__.py', 'tests/unit/contracts/__init__.py', 'tests/unit/core/__init__.py'];
for (const rel of emptyInits) {
  F(`${T}${rel.replace('tests/', '')}`, 'file', '__init__.py',
    `Package __init__ rỗng đánh dấu nhánh test unit ${rel.replace('tests/unit/', '').replace('/__init__.py', '') || 'gốc'} cho pytest discovery.`,
    ['entry-point', 'barrel', 'test'], 'simple');
}

// ---- test_reverser_workload_fallback.py ----
F(`${T}unit/agents/test_reverser_workload_fallback.py`, 'file', 'test_reverser_workload_fallback.py',
  'Kiểm tra định tuyến workload reverser: orchestrator vẫn giao triage Radare2 cho reverser khi không có workload, prompt quảng bá fallback Ghidra-only và catalog skill có workflow virtualized protectors.',
  ['test', 'agents', 'reverser', 'routing', 'skill-catalog'], 'moderate');

// ---- test_task_spec.py ----
F(`${T}unit/agents/test_task_spec.py`, 'file', 'test_task_spec.py',
  'Kiểm tra SubAgentTaskSpec: render deterministic với JSON sort, liệt kê expected outputs/artifacts, payload scoped dispatch gọn hơn full history và dataclass frozen/serializable.',
  ['test', 'agents', 'task-spec', 'serialization', 'determinism'], 'moderate');

// ---- test_config.py ----
F(`${T}unit/core/test_config.py`, 'file', 'test_config.py',
  'Kiểm tra raptix_core.utils.config: giá trị mặc định RaptixConfig, override qua biến môi trường RAPTIX_* và load_config trả về defaults.',
  ['test', 'config', 'core', 'env-override'], 'simple');

// ================= EDGES =================
// imports (1:1 với batchImportData — tổng 2)
E(`file:${R}skills/engine/client/__init__.py`, `file:${R}skills/engine/client/rest.py`, 'imports', 0.7);
E(`file:${T}unit/agents/test_task_spec.py`, 'file:packages/raptix/raptix/agents/task_spec.py', 'imports', 0.7);
// defines_schema
E(`schema:${R}skills/engine/proto/skillogy.proto`, `file:${R}skills/engine/client/rest.py`, 'defines_schema', 0.8);
// documents
E(`document:${R}tools/README.md`, `file:${R}tools/research/fuzz.py`, 'documents', 0.5);
E(`document:${R}tools/README.md`, `file:${R}tools/research/_apoc_safety.py`, 'documents', 0.5);
// tested_by
E(`file:${R}tools/research/_apoc_safety.py`, `file:${T}unit/research/test_apoc_safety.py`, 'tested_by', 0.5);
E(`file:${R}tools/research/fuzz.py`, `file:${T}unit/research/test_fuzz.py`, 'tested_by', 0.5);
E('file:packages/raptix/raptix/agents/task_spec.py', `file:${T}unit/agents/test_task_spec.py`, 'tested_by', 0.5);
E('file:packages/raptix-core/raptix_core/utils/config.py', `file:${T}unit/core/test_config.py`, 'tested_by', 0.5);
E('document:packages/raptix/raptix/agents/prompts/standard/raptix.md', `file:${T}unit/agents/test_reverser_workload_fallback.py`, 'tested_by', 0.5);
E('file:packages/raptix/raptix/agents/standard/reverser.py', `file:${T}unit/agents/test_reverser_workload_fallback.py`, 'tested_by', 0.5);
E('document:packages/raptix/raptix/skills/defs/standard/reverser/SKILL.md', `file:${T}unit/agents/test_reverser_workload_fallback.py`, 'tested_by', 0.5);
E('document:packages/raptix/raptix/skills/defs/standard/reverser/virtualized-protectors/SKILL.md', `file:${T}unit/agents/test_reverser_workload_fallback.py`, 'tested_by', 0.5);

const out = { batchIndex: 142, batchFiles: bt.files, nodes, edges };
fs.writeFileSync(`${UA}/intermediate/batch-142.json`, JSON.stringify(out, null, 2), 'utf8');
const imp = edges.filter(e => e.type === 'imports').length;
console.log('batch-142.json written | nodes:', nodes.length, '| edges:', edges.length, '| imports:', imp, '(expected 2)');
