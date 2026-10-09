import { readFileSync, writeFileSync } from 'node:fs';

const UA = 'D:/.VTNet/redteam/raptix/.ua';
const batches = JSON.parse(readFileSync(`${UA}/intermediate/batches.json`, 'utf-8'));

const P = 'packages/raptix/raptix/tools/mcp';
const T = 'packages/raptix/tests/unit/tools';
const R = 'packages/raptix/raptix/tools/research';
const RT = 'packages/raptix/tests/unit/research';
const W = '.github/workflows';

const fwd = (source, target, type, weight) => ({ source, target, type, direction: 'forward', weight });
const fileNode = (path, name, summary, tags, complexity, languageNotes) => ({
  id: `file:${path}`, type: 'file', name, filePath: path, summary, tags, complexity,
  ...(languageNotes ? { languageNotes } : {}),
});
const fnNode = (path, name, lineRange, summary, tags, complexity) => ({
  id: `function:${path}:${name}`, type: 'function', name, filePath: path, lineRange, summary, tags, complexity,
});
const clsNode = (path, name, lineRange, summary, tags, complexity) => ({
  id: `class:${path}:${name}`, type: 'class', name, filePath: path, lineRange, summary, tags, complexity,
});

// ─────────────────────────── batch 51 ───────────────────────────
const b51nodes = [
  fileNode(`${P}/__init__.py`, '__init__.py',
    'Façade công khai của subpackage MCP: re-export MCPServerConfig, load_mcp_tools, mcp_servers_configured và parse_mcp_servers_env từ client.py; không bị import lúc framework start-up, kích hoạt hoàn toàn qua env RAPTIX_MCP__SERVERS.',
    ['mcp', 'facade', 're-export', 'opt-in'], 'simple'),
  fileNode(`${P}/client.py`, 'client.py',
    'Cầu nối duy nhất giữa Raptix và các MCP server bên ngoài (Kali MCP, HexStrike): parse JSON env RAPTIX_MCP__SERVERS thành MCPServerConfig, kết nối từng server qua langchain-mcp-adapters (lazy import), retry 3 lần với backoff nhân đôi; server lỗi chỉ log+skip, thiếu package optional chỉ cảnh báo — không bao giờ làm chết agent.',
    ['mcp', 'tool-server', 'lazy-import', 'fail-safe', 'retry'], 'moderate',
    'Dependency nặng (langchain-mcp-adapters) được import bên trong load_mcp_tools; env theo convention RAPTIX_<SECTION>__<KEY>; _sleep tách module-level để test patch không đụng asyncio.sleep.'),
  clsNode(`${P}/client.py`, 'MCPServerConfig', [65, 103],
    'Dataclass frozen cấu hình một MCP server: transport (streamable_http/sse/stdio), url/command/args/headers; to_client_kwargs render đúng dict mà MultiServerMCPClient của langchain-mcp-adapters mong đợi theo transport đã chọn.',
    ['dataclass', 'config', 'mcp'], 'simple'),
  fnNode(`${P}/client.py`, '_default_transport', [106, 115],
    'Chọn transport mặc định khi operator bỏ trống: entry có "command" → stdio, còn lại → streamable_http (server SSE legacy phải khai báo transport tường minh).',
    ['mcp', 'config', 'default'], 'simple'),
  fnNode(`${P}/client.py`, '_parse_one', [118, 156],
    'Validate và parse một entry server: trả None kèm log warning khi entry không phải JSON object, transport lạ, args không phải list hay headers không phải mapping — entry xấu bị bỏ qua thay vì làm hỏng cả bộ config.',
    ['validation', 'mcp', 'config'], 'simple'),
  fnNode(`${P}/client.py`, 'parse_mcp_servers_env', [159, 191],
    'Parse giá trị JSON của RAPTIX_MCP__SERVERS thành tuple MCPServerConfig; input rỗng, JSON malformed hay top-level không phải object đều trả () kèm warning — env hỏng không bao giờ làm crash agent process.',
    ['mcp', 'env-parsing', 'fail-safe'], 'moderate'),
  fnNode(`${P}/client.py`, 'mcp_servers_configured', [198, 200],
    'Probe boolean: True khi và chỉ khi env có ít nhất một MCP server hợp lệ được cấu hình.',
    ['mcp', 'probe', 'env'], 'simple'),
  fnNode(`${P}/client.py`, 'load_mcp_tools', [203, 269],
    'Kết nối từng MCP server đã cấu hình và gom tools về agent: lazy-import langchain-mcp-adapters (thiếu → warning + []), probe từng server riêng lẻ tối đa 3 lần với backoff 1s/2s; server chết bị skip còn các server khác vẫn đóng góp tools.',
    ['mcp', 'async', 'retry', 'resilience'], 'moderate'),
  fileNode(`${T}/test_mcp_client.py`, 'test_mcp_client.py',
    'Unit test cho MCP client: không chạm mạng thật và không cần langchain-mcp-adapters (giả lập qua monkeypatch sys.modules); phủ parse env (rỗng/malformed/transport lạ/entry xấu), to_client_kwargs theo từng transport, probe mcp_servers_configured và toàn bộ hành vi load_mcp_tools (thiếu package, retry thành công, cạn retry, một server xấu không giết server khác).',
    ['unit-test', 'mcp', 'mock', 'pytest'], 'moderate'),
  fnNode(`${T}/test_mcp_client.py`, '_propagate_mcp_logger', [28, 40],
    'Fixture autouse bật propagate trên logger "raptix" để caplog của pytest thấy được record (logger gốc đặt propagate=False).',
    ['fixture', 'logging', 'pytest'], 'simple'),
  fnNode(`${T}/test_mcp_client.py`, 'test_parse_two_servers_roundtrip', [52, 66],
    'Parse env 2 server (HTTP + stdio) và khẳng định từng trường transport/url/command/args roundtrip đúng vào MCPServerConfig.',
    ['unit-test', 'parsing', 'mcp'], 'simple'),
  fnNode(`${T}/test_mcp_client.py`, 'test_parse_unknown_transport_is_skipped', [95, 106],
    'Transport không hợp lệ (carrier-pigeon) khiến entry đó bị bỏ qua kèm warning "unknown transport", entry tốt vẫn được giữ lại.',
    ['unit-test', 'validation', 'mcp'], 'simple'),
  fnNode(`${T}/test_mcp_client.py`, 'test_to_client_kwargs_http_includes_url_and_headers', [117, 129],
    'to_client_kwargs với transport streamable_http xuất đúng transport/url/headers và không lẫn trường stdio.',
    ['unit-test', 'serialization', 'mcp'], 'simple'),
  fnNode(`${T}/test_mcp_client.py`, 'test_to_client_kwargs_stdio_includes_command_args', [132, 141],
    'to_client_kwargs với transport stdio xuất đúng command và args dạng list.',
    ['unit-test', 'serialization', 'mcp'], 'simple'),
  fnNode(`${T}/test_mcp_client.py`, 'test_load_mcp_tools_missing_package_is_graceful', [177, 189],
    'Chặn import langchain_mcp_adapters qua sys.modules để khẳng định load_mcp_tools trả [] và chỉ warning — MCP không cài không làm chết agent.',
    ['unit-test', 'graceful-degradation', 'mcp'], 'simple'),
  fnNode(`${T}/test_mcp_client.py`, 'test_load_mcp_tools_uses_mock_client_when_package_present', [192, 229],
    'Tiêm fake MultiServerMCPClient vào sys.modules: tools sentinel được trả về và connection dict dựng từ MCPServerConfig truyền đúng (transport/url/headers).',
    ['unit-test', 'mock', 'mcp'], 'moderate'),
  fnNode(`${T}/test_mcp_client.py`, 'test_load_mcp_tools_retries_transient_failures', [232, 271],
    'Fake client fail 2 lần rồi thành công: load_mcp_tools thử đúng 3 lần với 2 khoảng sleep dương (patch _sleep thành no-op) và trả tools ở lần cuối.',
    ['unit-test', 'retry', 'mcp'], 'moderate'),
  fnNode(`${T}/test_mcp_client.py`, 'test_load_mcp_tools_skips_after_all_attempts_exhausted', [274, 307],
    'Server fail mọi lần thử bị log "unreachable" và skip; load_mcp_tools trả [] thay vì raise.',
    ['unit-test', 'retry', 'fail-safe'], 'moderate'),
  fnNode(`${T}/test_mcp_client.py`, 'test_load_mcp_tools_one_bad_server_does_not_kill_others', [310, 338],
    'Hai server (bad/ok): server bad fail ConnectionError còn server ok vẫn đóng góp tool — cô lập lỗi theo từng endpoint hoạt động đúng.',
    ['unit-test', 'resilience', 'mcp'], 'moderate'),
];

const c = `${P}/client.py`, tf = `${T}/test_mcp_client.py`;
const members51 = [
  `class:${c}:MCPServerConfig`, `function:${c}:_default_transport`, `function:${c}:_parse_one`,
  `function:${c}:parse_mcp_servers_env`, `function:${c}:mcp_servers_configured`, `function:${c}:load_mcp_tools`,
];
const testFns51 = [
  '_propagate_mcp_logger', 'test_parse_two_servers_roundtrip', 'test_parse_unknown_transport_is_skipped',
  'test_to_client_kwargs_http_includes_url_and_headers', 'test_to_client_kwargs_stdio_includes_command_args',
  'test_load_mcp_tools_missing_package_is_graceful', 'test_load_mcp_tools_uses_mock_client_when_package_present',
  'test_load_mcp_tools_retries_transient_failures', 'test_load_mcp_tools_skips_after_all_attempts_exhausted',
  'test_load_mcp_tools_one_bad_server_does_not_kill_others',
];
const b51edges2 = [
  ...members51.map((m) => fwd(`file:${c}`, m, 'contains', 1)),
  ...members51.map((m) => fwd(`file:${c}`, m, 'exports', 0.8)),
  ...testFns51.map((n) => fwd(`file:${tf}`, `function:${tf}:${n}`, 'contains', 1)),
  ...testFns51.map((n) => fwd(`file:${tf}`, `function:${tf}:${n}`, 'exports', 0.8)),
  fwd(`file:${P}/__init__.py`, `file:${c}`, 'imports', 0.7),
  fwd(`file:${tf}`, `file:${c}`, 'imports', 0.7),
  fwd(`function:${c}:_parse_one`, `function:${c}:_default_transport`, 'calls', 0.8),
  fwd(`function:${c}:_parse_one`, `class:${c}:MCPServerConfig`, 'calls', 0.8),
  fwd(`function:${c}:parse_mcp_servers_env`, `function:${c}:_parse_one`, 'calls', 0.8),
  fwd(`function:${tf}:test_parse_two_servers_roundtrip`, `function:${c}:parse_mcp_servers_env`, 'calls', 0.8),
  fwd(`function:${tf}:test_parse_unknown_transport_is_skipped`, `function:${c}:parse_mcp_servers_env`, 'calls', 0.8),
  fwd(`function:${tf}:test_to_client_kwargs_http_includes_url_and_headers`, `class:${c}:MCPServerConfig`, 'calls', 0.8),
  fwd(`function:${tf}:test_to_client_kwargs_stdio_includes_command_args`, `class:${c}:MCPServerConfig`, 'calls', 0.8),
  fwd(`function:${tf}:test_load_mcp_tools_missing_package_is_graceful`, `class:${c}:MCPServerConfig`, 'calls', 0.8),
  fwd(`function:${tf}:test_load_mcp_tools_missing_package_is_graceful`, `function:${c}:load_mcp_tools`, 'calls', 0.8),
  fwd(`function:${tf}:test_load_mcp_tools_uses_mock_client_when_package_present`, `class:${c}:MCPServerConfig`, 'calls', 0.8),
  fwd(`function:${tf}:test_load_mcp_tools_uses_mock_client_when_package_present`, `function:${c}:load_mcp_tools`, 'calls', 0.8),
  fwd(`function:${tf}:test_load_mcp_tools_retries_transient_failures`, `class:${c}:MCPServerConfig`, 'calls', 0.8),
  fwd(`function:${tf}:test_load_mcp_tools_retries_transient_failures`, `function:${c}:load_mcp_tools`, 'calls', 0.8),
  fwd(`function:${tf}:test_load_mcp_tools_skips_after_all_attempts_exhausted`, `class:${c}:MCPServerConfig`, 'calls', 0.8),
  fwd(`function:${tf}:test_load_mcp_tools_skips_after_all_attempts_exhausted`, `function:${c}:load_mcp_tools`, 'calls', 0.8),
  fwd(`function:${tf}:test_load_mcp_tools_one_bad_server_does_not_kill_others`, `class:${c}:MCPServerConfig`, 'calls', 0.8),
  fwd(`function:${tf}:test_load_mcp_tools_one_bad_server_does_not_kill_others`, `function:${c}:load_mcp_tools`, 'calls', 0.8),
  fwd(`file:${c}`, `file:${tf}`, 'tested_by', 0.5),
];

// ─────────────────────────── batch 52 ───────────────────────────
const s = `${R}/sarif_export.py`, t1 = `${RT}/test_sarif_export.py`, t2 = `${RT}/test_sarif_export_props_attr.py`;
const b52nodes = [
  fileNode(s, 'sarif_export.py',
    'Export Finding nodes của KnowledgeGraph ra SARIF v2.1.0 (chiều ngược với module sarif ingest): gom rule theo ruleId (ưu tiên CVE > CWE > vuln_class > MITRE technique > label), map severity→level/security-severity (critical 10.0 … info 0.0), dựng physicalLocation từ file/start_line; kèm write_sarif ghi file và severity_threshold_breach làm CI gate fail-on cho Code Scanning/DefectDojo.',
    ['sarif', 'export', 'findings', 'ci-gate', 'security'], 'moderate',
    'Graph duck-typed (.nodes/.kind/.props hoặc .properties) để không kéo import raptix_core nặng; node kind enum hoặc string đều so sánh lowercase; severity thiếu mặc định medium.'),
  fnNode(s, '_finding_rule_id', [59, 78],
    'Suy ra ruleId cho một finding theo thứ tự ưu tiên CVE > CWE (tự thêm prefix CWE- khi thiếu) > vuln_class > MITRE technique > label đã sanitize; mọi id đều mang prefix "decepticon/".',
    ['sarif', 'rule-id', 'dedup'], 'simple'),
  fnNode(s, '_result_locations', [81, 105],
    'Dự danh sách SARIF physicalLocation từ props file/uri/file_path và start_line/end_line (coerce int an toàn); không có file → trả [] nên result không mang locations.',
    ['sarif', 'location'], 'simple'),
  fnNode(s, '_build_rule', [108, 130],
    'Dự một SARIF rule object: shortDescription/fullDescription từ title/description, helpUri trỏ decepticon.red, properties.security-severity suy từ severity và tags gộp vuln_class/mitre_attack/severity.',
    ['sarif', 'rule'], 'simple'),
  fnNode(s, '_iter_findings', [144, 160],
    'Duyệt graph duck-typed và yield (node, props) cho mọi node kind finding/vulnerability/candidate (so sánh lowercase nên enum lẫn string đều khớp, test double không cần import raptix_core); severity thiếu được gán medium.',
    ['sarif', 'iteration', 'duck-typing'], 'simple'),
  fnNode(s, 'export_findings_to_sarif', [163, 225],
    'Hàm chính dựng SARIF v2.1.0 document: gom rules_by_id để mỗi rule chỉ xuất một lần, mỗi finding thành result (ruleId, level, message, properties security-severity + raptix-finding-id/raptix-engagement, locations), bọc trong runs[0] với driver name Raptix và raptix-finding-count.',
    ['sarif', 'export', 'transform'], 'moderate'),
  fnNode(s, 'write_sarif', [228, 242],
    'Serialize export_findings_to_sarif ra output_path (mkdir -p thư mục cha, indent 2, ensure_ascii=False, UTF-8) và trả Path.',
    ['sarif', 'io'], 'simple'),
  fnNode(s, 'severity_threshold_breach', [245, 261],
    'CI gate: True khi SARIF document có result với security-severity ≥ ngưỡng fail_on (mặc định high); parse float an toàn nên document lạ không làm raise.',
    ['sarif', 'ci-gate', 'threshold'], 'simple'),
  fileNode(t1, 'test_sarif_export.py',
    'Unit test sarif_export bằng _FakeNode/_FakeGraph duck-typed: envelope v2.1.0 + driver Raptix, zero results khi graph rỗng, gom rule theo ruleId, map severity→level, security-severity, locations từ file/line (và bỏ khi không có file), ruleId ưu tiên CVE > technique > label, ba nhánh severity_threshold_breach, round-trip write_sarif và default severity medium.',
    ['unit-test', 'sarif', 'fake-graph'], 'moderate'),
  fnNode(t1, 'test_export_groups_results_by_rule_id', [47, 59],
    '3 finding (2 sqli high, 1 xss medium) phải gom thành đúng 2 rule decepticon/sqli + decepticon/xss và 3 results.',
    ['unit-test', 'sarif'], 'simple'),
  fnNode(t1, 'test_export_severity_mapping_to_level', [62, 73],
    'Mapping severity→level: critical/high→error, medium→warning, low→note.',
    ['unit-test', 'severity'], 'simple'),
  fnNode(t1, 'test_export_rule_id_falls_back_to_technique_then_label', [104, 113],
    'Khi không có CVE/CWE/vuln_class, ruleId rơi về decepticon/T1190 (MITRE technique) hoặc decepticon/<label> đã sanitize.',
    ['unit-test', 'rule-id'], 'simple'),
  fileNode(t2, 'test_sarif_export_props_attr.py',
    'Regression test khóa contract props: Node thật của raptix_core mang .props (không có .properties) vẫn phải đưa severity/location chảy qua SARIF — severity high/critical phải bắn CI gate fail-on=high còn medium thì không, location xuất từ file/start_line.',
    ['unit-test', 'regression', 'kg', 'sarif'], 'simple'),
  fnNode(t2, '_real_finding_node', [10, 19],
    'Helper dựng Node.make(NodeKind.FINDING, …) thật với severity/vuln_class/description/file/start_line để test đúng đường đi props của raptix_core.',
    ['test-helper', 'kg'], 'simple'),
];

const sarifFns = ['_finding_rule_id', '_result_locations', '_build_rule', '_iter_findings', 'export_findings_to_sarif', 'write_sarif', 'severity_threshold_breach'];
const t1Fns = ['test_export_groups_results_by_rule_id', 'test_export_severity_mapping_to_level', 'test_export_rule_id_falls_back_to_technique_then_label'];
const b52edges = [
  ...sarifFns.map((n) => fwd(`file:${s}`, `function:${s}:${n}`, 'contains', 1)),
  ...sarifFns.map((n) => fwd(`file:${s}`, `function:${s}:${n}`, 'exports', 0.8)),
  ...t1Fns.map((n) => fwd(`file:${t1}`, `function:${t1}:${n}`, 'contains', 1)),
  ...t1Fns.map((n) => fwd(`file:${t1}`, `function:${t1}:${n}`, 'exports', 0.8)),
  fwd(`file:${t2}`, `function:${t2}:_real_finding_node`, 'contains', 1),
  fwd(`file:${t2}`, `function:${t2}:_real_finding_node`, 'exports', 0.8),
  fwd(`file:${t1}`, `file:${s}`, 'imports', 0.7),
  fwd(`file:${t2}`, `file:${s}`, 'imports', 0.7),
  fwd(`function:${s}:export_findings_to_sarif`, `function:${s}:_iter_findings`, 'calls', 0.8),
  fwd(`function:${s}:export_findings_to_sarif`, `function:${s}:_finding_rule_id`, 'calls', 0.8),
  fwd(`function:${s}:export_findings_to_sarif`, `function:${s}:_build_rule`, 'calls', 0.8),
  fwd(`function:${s}:export_findings_to_sarif`, `function:${s}:_result_locations`, 'calls', 0.8),
  fwd(`function:${s}:write_sarif`, `function:${s}:export_findings_to_sarif`, 'calls', 0.8),
  fwd(`function:${t1}:test_export_groups_results_by_rule_id`, `function:${s}:export_findings_to_sarif`, 'calls', 0.8),
  fwd(`function:${t1}:test_export_severity_mapping_to_level`, `function:${s}:export_findings_to_sarif`, 'calls', 0.8),
  fwd(`function:${t1}:test_export_rule_id_falls_back_to_technique_then_label`, `function:${s}:export_findings_to_sarif`, 'calls', 0.8),
  fwd(`file:${s}`, `file:${t1}`, 'tested_by', 0.5),
  fwd(`file:${s}`, `file:${t2}`, 'tested_by', 0.5),
];

// ─────────────────────────── batch 53 ───────────────────────────
const b53 = 'containers/campaign-bridge/Dockerfile';
const b53nodes = [
  fileNode(b53, 'Dockerfile',
    'Multi-stage build image campaign-bridge: stage native clone evilginx2 ở commit pin 5557960 (verify bằng git rev-parse trước khi build) và go build CGO_ENABLED=0; runtime python:3.13-slim chạy user non-root bridge (uid 10001), copy binary evilginx, profile lab.yaml và evilginx_bridge.py, EXPOSE 9000/8443, CMD python /app/evilginx_bridge.py.',
    ['dockerfile', 'phishing', 'evilginx2', 'campaign', 'non-root'], 'simple',
    'Commit pin được verify bằng rev-parse (chống supply-chain); HOME=/state để evilginx ghi state vào volume; /profiles mount lab.yaml.'),
  {
    id: `service:${b53}:campaign-bridge`, type: 'service', name: 'campaign-bridge', filePath: b53,
    summary: 'Service phishing-lab chạy evilginx2 làm campaign bridge cho Raptix: serving phishing site qua cổng 9000/8443, state/profiles/redirectors nằm ở /state /profiles /redirectors, được điều khiển bởi evilginx_bridge.py.',
    tags: ['service', 'phishing', 'evilginx2', 'container'], complexity: 'simple',
  },
];
const b53edges = [
  fwd(`file:${b53}`, `service:${b53}:campaign-bridge`, 'deploys', 0.9),
];

// ─────────────────────────── batch 54 ───────────────────────────
const b54 = 'containers/sliver-bridge/Dockerfile';
const b54nodes = [
  fileNode(b54, 'Dockerfile',
    'Image sliver-bridge hai stage trên python:3.13-slim pin digest: stage native tải sliver-server v1.7.7 (verify sha256), sparse-checkout thư mục protobuf ở commit pin rồi sinh gRPC stub bằng grpcio-tools; runtime tạo user non-root c2bridge, copy sliver-server + stubs /app/gen + LICENSE, entrypoint.sh (strip CRLF), EXPOSE 9000.',
    ['dockerfile', 'c2', 'sliver', 'grpc', 'supply-chain'], 'moderate',
    'Base image pin digest + release binary verify sha256 + git commit pin — chuỗi supply-chain kiểm soát chặt; entrypoint.sh được sed bỏ \\r để chạy trên Linux.'),
  {
    id: `service:${b54}:sliver-bridge`, type: 'service', name: 'sliver-bridge', filePath: b54,
    summary: 'Service C2 bridge chạy sliver-server multiplayer cho lab Raptix: điều khiển implant qua gRPC stub rpcpb đã sinh sẵn trong /app/gen, state nằm ở /state, expose cổng 9000.',
    tags: ['service', 'c2', 'sliver', 'container'], complexity: 'simple',
  },
];
const b54edges = [
  fwd(`file:${b54}`, `service:${b54}:sliver-bridge`, 'deploys', 0.9),
];

// ─────────────────────────── batch 55 ───────────────────────────
const b55nodes = [
  fileNode(`${W}/ci.yml`, 'ci.yml',
    'CI tổng hợp của repo: job "changes" dùng dorny/paths-filter tính 6 scope (python/cli/web-raptix/desktop/launcher/compose) cùng danh sách Docker image; các lane đắt được gate theo scope — python chạy make ci-lint/ci-test (+ coverage trên main, audit-skills-strict, check-skill-graph với MITRE STIX), CLI/desktop/launcher chạy matrix đa OS (launcher: go vet + go test trên 3 OS), web-raptix chạy prisma/typecheck/lint/build/test + Docker real-mode smoke, docker-build kèm Trivy SARIF, docker-build-arm64 smoke QEMU cho cli/langgraph, security chạy pip-audit blocking, cộng actionlint cho mọi workflow — khép lại bằng job ci-ok duy nhất làm required check (skipped=PASS, failure/cancelled=FAIL).',
    ['ci', 'github-actions', 'path-filter', 'matrix', 'required-check'], 'complex',
    'Không dùng paths-ignore ở trigger (issue #561: check bị skip trên pull_request kẹt Pending) — mọi job luôn chạy và tự emit noop success khi scope không đổi; coverage-report chạy song song non-blocking, cố tình không nằm trong required-status set.'),
  fileNode(`${W}/pin-digests.yml`, 'pin-digests.yml',
    'Sau khi release published: resolve manifest-list digest cho 8 image ghcr.io/akapi895/raptix-* ở đúng version bằng docker buildx imagetools inspect rồi upload image-digests.txt làm release asset, để operator pin compose theo sha256 thay vì tag trôi :latest/:stable.',
    ['release', 'supply-chain', 'digest-pinning'], 'simple'),
  fileNode(`${W}/promote-stable.yml`, 'promote-stable.yml',
    'Channel :stable theo mô hình soak kiểu Claude-Code: chạy daily + workflow_dispatch, chọn release FINAL mới nhất đã baked ≥ 7 ngày (input soak_days buộc chỉ-cho-phép-digit chống injection qua arithmetic, floor 7 ngày), preflight toàn bộ 8 image (kèm check OCI label version với web-raptix) rồi retag :stable bằng buildx imagetools; idempotent khi re-point cùng version.',
    ['release', 'update-channel', 'soak', 'ghcr'], 'moderate'),
  fileNode(`${W}/release-recover.yml`, 'release-recover.yml',
    'Công cụ khôi phục release chạy tay (workflow_dispatch): verify đủ 8 image raptix-*:<version> trên GHCR (check label version với web image), tùy chọn promote :latest theo input promote_latest, rồi gh release edit --draft=false (--prerelease tự suy từ suffix version) — dùng khi job publish-release của release.yml gãy giữa chừng.',
    ['release', 'recovery', 'ops'], 'simple'),
  fileNode(`${W}/release.yml`, 'release.yml',
    'Pipeline release khi push tag v*: publish 3 wheel workspace (raptix-core/raptix/raptix-sdk) lên PyPI bằng Trusted Publishing OIDC sau khi stamp version từ tag vào 4 pyproject; GoReleaser build launcher Go kèm upload config-checksums.txt (sha256 manifest chống CDN tampering cho compose/litellm.yaml/.env.example); build 8 Docker image đa arch với cosign sign keyless, SBOM CycloneDX và cosign attest (sandbox bỏ Rekor do cap ~5MiB, mọi attestation retry 5 lần backoff rồi warning); sandbox/c2-sliver build tách runner native amd64/arm64 rồi merge manifest ở docker-heavy-merge; job publish-release verify đủ image trên GHCR rồi promote :latest (final-only) và undraft GitHub release.',
    ['release', 'pypi', 'cosign', 'sbom', 'multi-arch'], 'complex',
    'Version source-tree giữ sentinel 0.0.0 — stamp vào image qua --build-arg VERSION lúc build; :stable do promote-stable.yml riêng quản, workflow này chỉ move :latest cho release final.'),
  fileNode(`${W}/scorecard.yml`, 'scorecard.yml',
    'OpenSSF Scorecard: chạy theo lịch weekly + push main + branch_protection_rule + dispatch, publish kết quả lên OSSF dashboard và upload scorecard.sarif vào Code Scanning qua codeql-action; permissions read-all ở top-level, job analysis xin đúng security-events/id-token cần thiết.',
    ['supply-chain', 'scorecard', 'sarif', 'security'], 'simple'),
  fileNode(`${W}/security-scan-example.yml`, 'security-scan-example.yml',
    'Ví dụ dogfooding chạy Raptix quét chính repo: workflow_dispatch, gate kép bằng repo variable ENABLE_RAPTIX_SCAN và secret ANTHROPIC_API_KEY (thiếu key thì skip êm), gọi composite action ./.github/actions/raptix-scan ở chế độ quick/diff, fail-on high, upload SARIF.',
    ['security', 'dogfood', 'example', 'workflow-dispatch'], 'simple'),
  fileNode(`${W}/security.yml`, 'security.yml',
    'Workflow security hợp nhất (thay CodeQL standalone + bộ 18 tool): CodeQL security-and-quality cho python + javascript-typescript theo matrix, Semgrep chạy rule riêng .semgrep/raptix-rules.yml (hard gate --error trên ERROR), Trivy quét fs (CVE dependencies) + config (Dockerfile/compose) xuất SARIF, TruffleHog --only-verified trên diff PR, dependency-review chặn dep có CVE high+ hoặc license bị cấm (probe dependency graph trước khi enforce); style/lint để dành cho pre-commit, không duplicate.',
    ['security', 'codeql', 'semgrep', 'trivy', 'trufflehog'], 'moderate',
    'Re-scan weekly (cron 27 4 * * 1) để CVE mới lộ diện vẫn soi được cây không đổi; paths-ignore docs/license/assets ở cả push lẫn pull_request.'),
  fileNode(`${W}/todo-to-issue.yml`, 'todo-to-issue.yml',
    'Push lên main quét marker TODO/FIXME/HACK bằng alstr/todo-to-issue-action pin commit SHA và tự mở/đóng issue kèm label (todo/bug/tech-debt); INSERT_ISSUE_URLS=false để action không push annotation ngược main (giữ contents: read); paths-ignore docs/license/assets vì workflow chạy trên push nên check skip không kẹt merge.',
    ['automation', 'issues', 'tech-debt'], 'simple'),
];
const b55edges = [
  fwd(`file:${W}/pin-digests.yml`, `file:${W}/release.yml`, 'depends_on', 0.6),
  fwd(`file:${W}/promote-stable.yml`, `file:${W}/release.yml`, 'depends_on', 0.6),
  fwd(`file:${W}/release-recover.yml`, `file:${W}/release.yml`, 'depends_on', 0.6),
];

// ─────────────────────────── emit ───────────────────────────
const out = {
  51: [b51nodes, b51edges2],
  52: [b52nodes, b52edges],
  53: [b53nodes, b53edges],
  54: [b54nodes, b54edges],
  55: [b55nodes, b55edges],
};

for (const idx of [51, 52, 53, 54, 55]) {
  const src = batches.batches.find((b) => b.batchIndex === idx);
  if (!src) throw new Error(`batch ${idx} not found in batches.json`);
  const doc = {
    batchIndex: idx,
    batchFiles: src.files.map((f) => ({ ...f })),
    nodes: out[idx][0],
    edges: out[idx][1],
  };
  writeFileSync(`${UA}/intermediate/batch-${idx}.json`, JSON.stringify(doc, null, 2) + '\n', 'utf-8');
  const counts = {};
  for (const n of doc.nodes) counts[n.type] = (counts[n.type] || 0) + 1;
  const ecounts = {};
  for (const e of doc.edges) ecounts[e.type] = (ecounts[e.type] || 0) + 1;
  console.log(`batch ${idx}: nodes=${doc.nodes.length} (${Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(' ')}) edges=${doc.edges.length} (${Object.entries(ecounts).map(([k, v]) => `${k}:${v}`).join(' ')})`);
}
