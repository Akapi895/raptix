import fs from 'fs';

const UA = 'D:/.VTNet/redteam/raptix/.ua';
const b = JSON.parse(fs.readFileSync(`${UA}/intermediate/batches.json`, 'utf8'));
const bt = b.batches.find(x => x.batchIndex === 144);
const T = 'packages/raptix/tests/unit/';

const nodes = [];
const edges = [];
const E = (source, target, type, weight) => edges.push({ source, target, type, direction: 'forward', weight });
const F = (rel, summary, tags, complexity, notes) => {
  nodes.push({ id: `file:${T}${rel}`, type: 'file', name: rel.split('/').pop(), filePath: `${T}${rel}`, summary, tags, complexity, ...(notes ? { languageNotes: notes } : {}) });
};
const FN = (rel, name, start, end, summary, tags, complexity) => {
  nodes.push({ id: `function:${T}${rel}:${name}`, type: 'function', name, filePath: `${T}${rel}`, lineRange: [start, end], summary, tags, complexity });
  E(`file:${T}${rel}`, `function:${T}${rel}:${name}`, 'contains', 1.0);
  E(`file:${T}${rel}`, `function:${T}${rel}:${name}`, 'exports', 0.8);
};

// ---- research ----
F('research/test_graph.py',
  'Kiểm tra KnowledgeGraph trong bộ raptix_core.types.kg: dedup node, thêm/xóa edge, truy vấn theo kind, duyệt đường đi và thống kê đồ thị trên cấu trúc in-memory.',
  ['test', 'knowledge-graph', 'core', 'data-model'], 'complex');
F('research/test_no_neo4j_at_import.py',
  'Kiểm tra ràng buộc kiến trúc: import raptix.tools.research.tools ở mức module không được kéo neo4j vào — neo4j chỉ nạp khi thật sự kết nối.',
  ['test', 'architecture', 'research', 'import-boundary'], 'simple');

// ---- runtime ----
F('runtime/test_shutdown.py',
  'Kiểm tra graceful shutdown có chặn (bounded): SIGINT flush findings/opplan/partial executive rồi exit 130, SIGTERM exit 143, signal kép buộc thoát ngay, checkpoint events JSONL và flush theo thành phần với timeout riêng.',
  ['test', 'runtime', 'signal-handling', 'shutdown', 'checkpoint'], 'complex');

// ---- sandbox_server ----
F('sandbox_server/test_app.py',
  'Kiểm tra FastAPI app của sandbox daemon: healthz không đụng backend, execute/timeout/422, upload/download mã hóa base64 và áp dụng egress qua raptix.sandbox_kernel.egress khi chạy lệnh.',
  ['test', 'sandbox', 'fastapi', 'api-handler'], 'complex');
F('sandbox_server/test_app_consttime_auth.py',
  'Kiểm tra xác thực token của sandbox app dùng so sánh thời gian hằng (compare_digest): token đúng được cấp quyền, token sai trả 401 và đường verify không lộ timing.',
  ['test', 'sandbox', 'security', 'constant-time', 'auth'], 'moderate');

// ---- server ----
F('server/test_checkpoint_persistence.py',
  'Kiểm tra bền vững checkpoint qua sqlite_checkpointer: pending question và cô lập thread phải sống sót khi đóng/mở lại kết nối — mô phỏng bằng graph LangGraph nhỏ.',
  ['test', 'server', 'checkpoint', 'sqlite', 'langgraph'], 'moderate');

// ---- skillogy ----
F('skillogy/test_stix_bootstrap.py',
  'Kiểm tra stix_bootstrap: checksum bundle pin khớp bản phát hành hiện tại, bootstrap tải–xác minh–tái sử dụng bundle và từ chối bundle hỏng sẵn có mà không phát sinh network.',
  ['test', 'skillogy', 'stix', 'integrity'], 'moderate');

// ---- root unit tests ----
F('test_next_version.py',
  'Kiểm tra scripts/next_version.py: feat tăng minor, fix tăng patch, BREAKING CHANGE tăng major, cấp mạnh nhất thắng và từ loại không release không kích hoạt bump.',
  ['test', 'versioning', 'conventional-commits', 'ci-cd'], 'simple');
F('test_plugin_loader.py',
  'Kiểm tra raptix_core.plugin_loader: discovery rỗng, entry-point list/factory, gói đối tượng runtime đơn được bọc thành list, lỗi load/factory được ghi log và bỏ qua, cùng chuẩn hóa graph module cho subagents.',
  ['test', 'plugin-loader', 'entry-point', 'core'], 'complex');
F('test_wheel_contents.py',
  'Kiểm chứng nội dung wheel: build bằng uv build rồi assert wheel đóng gói đủ bộ skill standard/shared/plugins và loại bỏ skill benchmark.',
  ['test', 'packaging', 'wheel', 'skill-bundling'], 'simple');
F('tools/test_misc_tool_wrappers.py',
  'Kiểm tra các wrapper công cụ rải rác: solidity scan/slither ingest, foundry test wrappers, export/list session recordings, IAM/S3/user-data/K8s/tfstate audit và metadata endpoints — mỗi nhóm chạy qua monkeypatch workspace tạm.',
  ['test', 'tools', 'wrappers', 'cloud', 'reversing'], 'complex');

// ---- empty __init__ files ----
const emptyInits = ['reversing', 'runtime', 'sandbox_kernel', 'sandbox_server', 'schemas', 'server', 'skill_audit', 'skillogy', 'telemetry', 'tools', 'tools/bash', 'tools/web', 'web'];
for (const d of emptyInits) {
  F(`${d}/__init__.py`,
    `Package __init__ rỗng đánh dấu nhánh test unit ${d} cho pytest discovery.`,
    ['entry-point', 'barrel', 'test'], 'simple');
}

// ---- scripts/bootstrap_skillogy_stix.py ----
nodes.push({
  id: 'file:scripts/bootstrap_skillogy_stix.py', type: 'file', name: 'bootstrap_skillogy_stix.py',
  filePath: 'scripts/bootstrap_skillogy_stix.py',
  summary: 'CLI bootstrap STIX cho dịch vụ Skillogy: gọi ensure_stix_bundle với URL/checksum pin để đặt bundle MITRE đúng chỗ trước khi khởi động stack.',
  tags: ['script', 'bootstrap', 'stix', 'skillogy'], complexity: 'simple'
});

// ---- significant functions ----
FN('research/test_no_neo4j_at_import.py', 'test_research_tools_do_not_import_neo4j_at_module_load', 5, 15,
  'Chạy subprocess import raptix.tools.research.tools và assert neo4j không xuất hiện trong sys.modules sau khi nạp module.',
  ['test', 'import-boundary', 'architecture'], 'simple');
FN('runtime/test_shutdown.py', '_write_driver', 23, 80,
  'Sinh script driver Python tạm mô phỏng tiến trình agent chạy dài với cài đặt shutdown handler, để test signal trong tiến trình con thật.',
  ['test-helper', 'subprocess', 'signal-handling'], 'moderate');
FN('runtime/test_shutdown.py', '_run_driver', 83, 94,
  'Chạy driver script đã sinh, thu stdout/stderr/exit code để các test signal assert hành vi thoát.',
  ['test-helper', 'subprocess'], 'simple');
FN('sandbox_server/test_app.py', '_reset_module_globals', 39, 51,
  'Đặt lại global state module app về mặc định giữa các test để token auth và backend không rò rỉ sang test khác.',
  ['test-helper', 'isolation'], 'simple');
FN('sandbox_server/test_app.py', '_make_backend', 54, 74,
  'Dựng backend giả lập với hành vi execute/upload/download cấu hình được cho từng test case.',
  ['test-helper', 'stubbing', 'sandbox'], 'simple');
FN('sandbox_server/test_app.py', '_client', 78, 99,
  'Khởi tạo TestClient FastAPI ghép với backend giả lập, dùng chung cho các test endpoint của sandbox daemon.',
  ['test-helper', 'fastapi', 'test-client'], 'simple');
FN('sandbox_server/test_app_consttime_auth.py', '_client', 38, 50,
  'Dựng TestClient với token auth cấu hình sẵn phục vụ các test xác thực thời gian hằng.',
  ['test-helper', 'auth', 'test-client'], 'simple');
FN('sandbox_server/test_app_consttime_auth.py', 'test_verify_token_uses_compare_digest', 53, 70,
  'Assert đường verify token gọi hmac.compare_digest thay vì so sánh == để tránh timing attack.',
  ['test', 'security', 'constant-time'], 'simple');
FN('sandbox_server/test_app_consttime_auth.py', 'test_wrong_token_is_rejected_401', 84, 93,
  'Token sai bị từ chối với mã 401 trên mọi endpoint được bảo vệ.',
  ['test', 'security', 'auth'], 'simple');
FN('server/test_checkpoint_persistence.py', 'test_pending_question_and_thread_isolation_survive_connection_reopen', 27, 54,
  'Mô phỏng interrupt/pending question qua graph LangGraph, đóng và mở lại checkpointer rồi assert trạng thái pending và sự cô lập thread được khôi phục đúng.',
  ['test', 'checkpoint', 'persistence'], 'moderate');
FN('skillogy/test_stix_bootstrap.py', 'test_bootstrap_downloads_verifies_and_reuses_pinned_bundle', 27, 49,
  'Với opener giả lập trả bundle pin, assert bootstrap tải về, xác minh checksum, và lần chạy sau tái sử dụng bundle hợp lệ mà không tải lại.',
  ['test', 'stix', 'bootstrap', 'integrity'], 'moderate');
FN('skillogy/test_stix_bootstrap.py', 'test_bootstrap_rejects_corrupt_existing_bundle_without_network', 52, 64,
  'Bundle sẵn có bị hỏng checksum phải bị từ chối và không phát sinh request mạng nào khi đang offline.',
  ['test', 'stix', 'integrity'], 'simple');
FN('test_plugin_loader.py', '_spec', 157, 166,
  'Helper dựng ModuleSpec/EntryPoint giả cho các kịch bản discovery plugin trong test loader.',
  ['test-helper', 'plugin-loader', 'stubbing'], 'simple');
FN('test_wheel_contents.py', 'test_wheel_bundles_skills_but_excludes_benchmark', 10, 35,
  'Build wheel bằng uv build rồi kiểm tra danh sách file: đủ skill standard/shared/plugins, không có skill benchmark.',
  ['test', 'packaging', 'wheel'], 'simple');

// ================= EDGES =================
// imports (1:1 batchImportData — tổng 2)
E(`file:${T}server/test_checkpoint_persistence.py`, 'file:packages/raptix/raptix/server/checkpointer.py', 'imports', 0.7);
E(`file:${T}skillogy/test_stix_bootstrap.py`, 'file:packages/raptix/raptix/skills/engine/builder/stix_bootstrap.py', 'imports', 0.7);

// tested_by (production → test)
E('file:packages/raptix-core/raptix_core/types/kg.py', `file:${T}research/test_graph.py`, 'tested_by', 0.5);
E('file:packages/raptix/raptix/tools/research/tools.py', `file:${T}research/test_no_neo4j_at_import.py`, 'tested_by', 0.5);
E('file:packages/raptix/raptix/runtime/shutdown.py', `file:${T}runtime/test_shutdown.py`, 'tested_by', 0.5);
E('file:packages/raptix/raptix/sandbox_server/app.py', `file:${T}sandbox_server/test_app.py`, 'tested_by', 0.5);
E('file:packages/raptix/raptix/sandbox_server/app.py', `file:${T}sandbox_server/test_app_consttime_auth.py`, 'tested_by', 0.5);
E('file:packages/raptix/raptix/server/checkpointer.py', `file:${T}server/test_checkpoint_persistence.py`, 'tested_by', 0.5);
E('file:packages/raptix/raptix/skills/engine/builder/stix_bootstrap.py', `file:${T}skillogy/test_stix_bootstrap.py`, 'tested_by', 0.5);
E('file:scripts/next_version.py', `file:${T}test_next_version.py`, 'tested_by', 0.5);
E('file:packages/raptix-core/raptix_core/plugin_loader.py', `file:${T}test_plugin_loader.py`, 'tested_by', 0.5);
E('file:packages/raptix/raptix/tools/contracts/tools.py', `file:${T}tools/test_misc_tool_wrappers.py`, 'tested_by', 0.5);
E('file:packages/raptix/raptix/tools/evidence/tools.py', `file:${T}tools/test_misc_tool_wrappers.py`, 'tested_by', 0.5);
E('file:packages/raptix/raptix/tools/cloud/tools.py', `file:${T}tools/test_misc_tool_wrappers.py`, 'tested_by', 0.5);

// depends_on: CLI script phụ thuộc runtime module stix_bootstrap
E('file:scripts/bootstrap_skillogy_stix.py', 'file:packages/raptix/raptix/skills/engine/builder/stix_bootstrap.py', 'depends_on', 0.6);

const out = { batchIndex: 144, batchFiles: bt.files, nodes, edges };
fs.writeFileSync(`${UA}/intermediate/batch-144.json`, JSON.stringify(out, null, 2), 'utf8');
const imp = edges.filter(e => e.type === 'imports').length;
console.log('batch-144.json written | nodes:', nodes.length, '| edges:', edges.length, '| imports:', imp, '(expected 2)');
