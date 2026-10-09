import fs from 'fs';

const UA = 'D:/.VTNet/redteam/raptix/.ua';
const b = JSON.parse(fs.readFileSync(`${UA}/intermediate/batches.json`, 'utf8'));
const bt = b.batches.find(x => x.batchIndex === 143);
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

// ---- core ----
F('core/test_logging.py',
  'Kiểm tra raptix_core.utils.logging: logger dùng chung qua get_logger, formatter text và JSON, cùng configure_logging bật/tắt theo môi trường mà không phá handler hiện có.',
  ['test', 'logging', 'core', 'formatting'], 'moderate');
F('core/test_schemas.py',
  'Kiểm tra schema raptix_core.types.engagement: xây dựng tối thiểu ThreatProfile, round-trip qua JSON, mặc định CleanupPlan/AbortPlan (3 trigger, ngưỡng hallucination > 0), ContactPlan và các ràng buộc escalation.',
  ['test', 'schemas', 'data-model', 'validation', 'core'], 'complex');
F('core/test_workspace_scaffold.py',
  'Kiểm tra EngagementBundle: lưu bundle không tự tạo sẵn scaffold artifact — artifact chỉ xuất hiện khi thật sự được ghi, tránh rác trong workspace engagement.',
  ['test', 'workspace', 'scaffold', 'engagement'], 'simple');
F('installer/test_install_sh.py',
  'Kiểm tra hành vi script cài đặt scripts/install.sh: resolver bản phát hành ổn định phải đọc release payload do curl ghi ra và pin đúng artifact.',
  ['test', 'installer', 'shell', 'release-pinning'], 'simple');

// ---- llm ----
F('llm/test_claude_code_handler_cache_dedup.py',
  'Kiểm tra hàm _cap_cache_control của Claude Code handler: chỉ dedup cache_control khi vượt ngưỡng số block, giữ block đầu/cuối và loại đúng một block trùng nội dung giữa chuỗi.',
  ['test', 'llm', 'prompt-caching', 'dedup'], 'moderate');
F('llm/test_claude_code_handler_streaming.py',
  'Kiểm tra streaming SSE của Claude Code handler: text tới dạng delta tăng dần, tham số tool_call được tái ghép từ fragment JSON, cache bucket bám vào chunk cuối và ping/thinking không lẫn vào assistant text.',
  ['test', 'llm', 'streaming', 'sse', 'tool-calls'], 'complex');
F('llm/test_codex_chatgpt_handler_streaming.py',
  'Kiểm tra streaming handler Codex/ChatGPT: delta text tăng dần, function_call arguments tái ghép trước khi release, name backfill từ sự kiện done, response failed raise khi close và các dòng malformed bị bỏ qua.',
  ['test', 'llm', 'streaming', 'codex', 'tool-calls'], 'complex');
F('llm/test_gemini_handler_session_cookies.py',
  'Kiểm tra tách bạch session cookies và access token của Gemini handler: env cookie bị bỏ qua khi load tokens, chỉ set cookie không đủ để lấy access token và cookie không loang vào token path.',
  ['test', 'llm', 'oauth', 'gemini', 'session-cookies'], 'moderate');
F('llm/test_http_client.py',
  'Kiểm tra HTTP client dùng chung cho các handler: mặc định retry, post chuyển tiếp đúng headers/body và hình dạng drop-in thay thế giữ nguyên hợp đồng gọi.',
  ['test', 'llm', 'http-client', 'retry'], 'moderate');
F('llm/test_litellm_dynamic_config.py',
  'Bộ test lớn cho litellm_dynamic_config: thu thập model theo role override, mapping api-key env theo provider, route Ollama chat/cloud về api_base đúng, cùng validation và ưu tiên cấu hình động giữa các nguồn.',
  ['test', 'llm', 'litellm', 'dynamic-config', 'model-routing'], 'complex');
F('llm/test_models.py',
  'Kiểm tra raptix_core.types.llm: tier agent, auth method, profile model, chuỗi resolve credential/gateway, chain Ollama/llama.cpp cục bộ và bảng ánh xạ model-method đầy đủ.',
  ['test', 'llm', 'model-profiles', 'resolve-chain', 'core'], 'complex');
F('llm/test_oauth_handlers.py',
  'Kiểm tra các OAuth handler LiteLLM tùy biến trong config/: refresh không rò secret, tool call streaming, finish reason Gemini, mint hardening Copilot/Claude/Gemini và parse completion với body reasoning đúng chuẩn.',
  ['test', 'llm', 'oauth', 'security', 'streaming'], 'complex');
F('llm/test_oauth_token_store.py',
  'Kiểm tra oauth_token_store: đọc JSON an toàn, ghi nguyên tử với mode bảo mật, temp path duy nhất, xoay refresh token và xử lý AuthenticationError/khóa file khi nhiều tiến trình tranh chấp.',
  ['test', 'llm', 'oauth', 'token-store', 'concurrency'], 'complex');
F('llm/test_ollama_probe.py',
  'Kiểm tra ollama_probe: phát hiện route Ollama, extract model, reachability qua nhiều opener (nội bộ/cloud), khả năng tool-call, lọc prefix và native api_base — kết quả probe bất biến.',
  ['test', 'llm', 'ollama', 'probe', 'model-discovery'], 'complex');

// ---- prompts ----
F('prompts/test_claude4_compat.py',
  'Kiểm tra claude4_compat: nhận diện họ Claude 4, thay thế thuật ngữ trigger bằng từ trung lập, prepend persona trung tính và áp dụng compat pipeline lên prompt hệ thống.',
  ['test', 'prompts', 'compat', 'llm'], 'moderate');

// ---- research ----
F('research/test_apoc_safety.py',
  'Kiểm tra _apoc_safety: find_violations bắt đúng procedure bị cấm/dưới allowlist, ensure_safe raise CypherSafetyError và bất biến allowlist/denylist không giao nhau.',
  ['test', 'security', 'cypher', 'neo4j'], 'moderate');
F('research/test_fuzz.py',
  'Kiểm tra fuzz.py: classify_target nhận đúng ngôn ngữ/engine theo manifest, tổng hợp harness cho từng engine, parser ASan trích stack chuẩn và record_crash ghi node/edge vào KnowledgeGraph.',
  ['test', 'fuzzing', 'research', 'crash-parsing'], 'moderate');

// ---- empty __init__ files ----
const emptyInits = ['llm', 'middleware', 'ops', 'prompts', 'references', 'reporting', 'research'];
for (const d of emptyInits) {
  F(`${d}/__init__.py`,
    `Package __init__ rỗng đánh dấu nhánh test unit ${d} cho pytest discovery.`,
    ['entry-point', 'barrel', 'test'], 'simple');
}
F('mcp_server/__init__.py',
  'Package __init__ đánh dấu nhánh test unit mcp_server cho pytest discovery.',
  ['entry-point', 'barrel', 'test'], 'simple');

// ---- significant functions (≥10 dòng hoặc public API trọng yếu) ----
FN('core/test_workspace_scaffold.py', '_bundle', 17, 37,
  'Helper dựng EngagementBundle mẫu với engagement/workspace tạm phục vụ các test scaffold.',
  ['test-helper', 'fixture', 'engagement'], 'simple');
FN('core/test_workspace_scaffold.py', 'test_engagement_bundle_save_does_not_precreate_artifact_scaffold', 40, 57,
  'Assert sau khi save bundle, cây artifact không được tạo trước — chỉ những artifact thật sự ghi mới tồn tại.',
  ['test', 'scaffold', 'workspace'], 'simple');
FN('installer/test_install_sh.py', 'test_stable_resolver_reads_release_payload_from_curl', 14, 47,
  'Chạy install.sh với curl giả lập ghi payload release, assert resolver ổn định đọc đúng artifact và pin phiên bản từ payload.',
  ['test', 'installer', 'release-pinning'], 'simple');
FN('llm/test_claude_code_handler_cache_dedup.py', 'test_five_blocks_with_duplicate_content_strips_exactly_one', 66, 77,
  'Với 5 block có nội dung trùng, dedup chỉ loại đúng một block và giữ cấu trúc cache_control hợp lệ.',
  ['test', 'prompt-caching', 'dedup'], 'simple');
FN('llm/test_claude_code_handler_cache_dedup.py', 'test_plain_blocks_in_middle_not_affected', 94, 105,
  'Các block thường nằm giữa chuỗi không bị gắn/tháo cache_control khi dedup chạy.',
  ['test', 'prompt-caching', 'dedup'], 'simple');
FN('llm/test_claude_code_handler_streaming.py', '_install', 49, 60,
  'Helper nạp module handler Claude Code với stub litellm/oauth/httpx qua importlib để test không cần phụ thuộc thật.',
  ['test-helper', 'importlib', 'stubbing'], 'simple');
FN('llm/test_claude_code_handler_streaming.py', 'test_text_arrives_as_incremental_deltas', 84, 124,
  'Feed chuỗi SSE mẫu và assert text tới handler theo delta tăng dần đúng thứ tự, không gộp cục bộ.',
  ['test', 'streaming', 'sse'], 'moderate');
FN('llm/test_claude_code_handler_streaming.py', 'test_tool_arguments_are_reassembled_from_json_fragments', 127, 165,
  'Assert tham số tool_call tới từng fragment JSON được tái ghép đầy đủ và đúng thứ tự trước khi handler phát hành tool call.',
  ['test', 'streaming', 'tool-calls'], 'moderate');
FN('llm/test_claude_code_handler_streaming.py', 'test_cache_buckets_survive_onto_the_final_chunk', 168, 195,
  'Cache bucket metadata phải bám vào chunk cuối cùng của stream để prompt caching vẫn hiệu quả qua các turn.',
  ['test', 'streaming', 'prompt-caching'], 'moderate');
FN('llm/test_claude_code_handler_streaming.py', 'test_thinking_deltas_and_pings_do_not_leak_into_assistant_text', 198, 218,
  'Sự kiện thinking delta và ping phải được tách khỏi assistant text — không lọt vào nội dung hiển thị.',
  ['test', 'streaming', 'sse'], 'simple');
FN('llm/test_claude_code_handler_streaming.py', 'test_truncated_stream_still_terminates', 221, 236,
  'Stream bị cắt giữa chừng vẫn phải kết thúc có kiểm soát, không treo handler.',
  ['test', 'streaming', 'robustness'], 'simple');
FN('llm/test_codex_chatgpt_handler_streaming.py', '_install', 61, 72,
  'Helper nạp module handler Codex/ChatGPT với stub litellm/oauth/http_client để cô lập phụ thuộc ngoài.',
  ['test-helper', 'importlib', 'stubbing'], 'simple');
FN('llm/test_codex_chatgpt_handler_streaming.py', 'test_text_arrives_as_incremental_deltas', 97, 116,
  'Assert text từ stream Codex tới dạng delta tăng dần đúng thứ tự sự kiện.',
  ['test', 'streaming', 'sse'], 'simple');
FN('llm/test_codex_chatgpt_handler_streaming.py', 'test_function_call_arguments_are_reassembled_before_release', 119, 152,
  'Function_call arguments nhận dạng fragment phải ghép đủ mới được release cho runtime — không phát hành JSON dở dang.',
  ['test', 'streaming', 'tool-calls'], 'moderate');
FN('llm/test_codex_chatgpt_handler_streaming.py', 'test_name_is_backfilled_when_only_the_done_event_carries_it', 155, 177,
  'Khi chỉ sự kiện done mang tên tool call, handler phải backfill name về đúng cuộc gọi tương ứng.',
  ['test', 'streaming', 'tool-calls'], 'simple');
FN('llm/test_codex_chatgpt_handler_streaming.py', 'test_malformed_and_done_lines_are_skipped', 195, 207,
  'Các dòng SSE malformed và sự kiện done trùng lặp được bỏ qua an toàn mà không làm hỏng state stream.',
  ['test', 'streaming', 'robustness'], 'simple');
FN('llm/test_gemini_handler_session_cookies.py', 'test_session_cookies_env_var_is_ignored_load_tokens_falls_through', 69, 83,
  'Env session cookies không còn được nuốt vào đường load tokens — fall-through về token store chuẩn.',
  ['test', 'oauth', 'gemini'], 'simple');
FN('llm/test_gemini_handler_session_cookies.py', 'test_get_gemini_access_token_raises_when_only_cookies_env_set', 86, 98,
  'Chỉ đặt env cookies (không token) phải raise thay vì âm thầm trả token sai.',
  ['test', 'oauth', 'gemini'], 'simple');
FN('llm/test_gemini_handler_session_cookies.py', 'test_access_token_env_still_works_after_cookies_removal', 101, 110,
  'Đường access token env tiếp tục hoạt động bình thường sau khi tách cookie ra khỏi luồng token.',
  ['test', 'oauth', 'gemini'], 'simple');
FN('llm/test_gemini_handler_session_cookies.py', 'test_session_cookies_does_not_bleed_into_access_token_when_both_set', 113, 122,
  'Đặt cả cookies lẫn access token: cookie không được loang vào header token của request.',
  ['test', 'oauth', 'gemini'], 'simple');
FN('llm/test_oauth_handlers.py', '_ensure_litellm_stub', 45, 59,
  'Cài stub module litellm tối thiểu vào sys.modules để các handler OAuth import được mà không cần thư viện thật.',
  ['test-helper', 'stubbing', 'oauth'], 'simple');
FN('llm/test_oauth_handlers.py', '_ensure_real_oauth_token_store', 67, 88,
  'Nạp module oauth_token_store thật từ config/ vào sys.modules để handler dùng hành vi store chuẩn trong test.',
  ['test-helper', 'oauth', 'token-store'], 'simple');
FN('llm/test_ollama_probe.py', '_cloud_opener', 384, 404,
  'Helper dựng opener giả lập endpoint cloud Ollama để test nhánh probe cloud tách khỏi máy cục bộ.',
  ['test-helper', 'ollama', 'stubbing'], 'simple');

// ================= EDGES =================
// imports (1:1 batchImportData — tổng 2)
E(`file:${T}research/test_apoc_safety.py`, 'file:packages/raptix/raptix/tools/research/_apoc_safety.py', 'imports', 0.7);
E(`file:${T}research/test_fuzz.py`, 'file:packages/raptix/raptix/tools/research/fuzz.py', 'imports', 0.7);

// tested_by (production → test)
E('file:packages/raptix-core/raptix_core/utils/logging.py', `file:${T}core/test_logging.py`, 'tested_by', 0.5);
E('file:packages/raptix-core/raptix_core/types/engagement.py', `file:${T}core/test_schemas.py`, 'tested_by', 0.5);
E('file:packages/raptix-core/raptix_core/types/engagement.py', `file:${T}core/test_workspace_scaffold.py`, 'tested_by', 0.5);
E('file:scripts/install.sh', `file:${T}installer/test_install_sh.py`, 'tested_by', 0.5);
E('file:config/claude_code_handler.py', `file:${T}llm/test_claude_code_handler_cache_dedup.py`, 'tested_by', 0.5);
E('file:config/claude_code_handler.py', `file:${T}llm/test_claude_code_handler_streaming.py`, 'tested_by', 0.5);
E('file:config/codex_chatgpt_handler.py', `file:${T}llm/test_codex_chatgpt_handler_streaming.py`, 'tested_by', 0.5);
E('file:config/gemini_handler.py', `file:${T}llm/test_gemini_handler_session_cookies.py`, 'tested_by', 0.5);
E('file:config/http_client.py', `file:${T}llm/test_http_client.py`, 'tested_by', 0.5);
E('file:config/litellm_dynamic_config.py', `file:${T}llm/test_litellm_dynamic_config.py`, 'tested_by', 0.5);
E('file:packages/raptix-core/raptix_core/types/llm.py', `file:${T}llm/test_models.py`, 'tested_by', 0.5);
for (const h of ['codex_chatgpt_handler', 'claude_code_handler', 'copilot_handler', 'grok_handler', 'gemini_handler', 'perplexity_handler']) {
  E(`file:config/${h}.py`, `file:${T}llm/test_oauth_handlers.py`, 'tested_by', 0.5);
}
E('file:config/oauth_token_store.py', `file:${T}llm/test_oauth_token_store.py`, 'tested_by', 0.5);
E('file:config/ollama_probe.py', `file:${T}llm/test_ollama_probe.py`, 'tested_by', 0.5);
E('file:packages/raptix/raptix/agents/prompts/claude4_compat.py', `file:${T}prompts/test_claude4_compat.py`, 'tested_by', 0.5);
E('file:packages/raptix/raptix/tools/research/_apoc_safety.py', `file:${T}research/test_apoc_safety.py`, 'tested_by', 0.5);
E('file:packages/raptix/raptix/tools/research/fuzz.py', `file:${T}research/test_fuzz.py`, 'tested_by', 0.5);

const out = { batchIndex: 143, batchFiles: bt.files, nodes, edges };
fs.writeFileSync(`${UA}/intermediate/batch-143.json`, JSON.stringify(out, null, 2), 'utf8');
const imp = edges.filter(e => e.type === 'imports').length;
console.log('batch-143.json written | nodes:', nodes.length, '| edges:', edges.length, '| imports:', imp, '(expected 2)');
