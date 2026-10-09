import fs from 'fs';

const UA = 'D:/.VTNet/redteam/raptix/.ua';
const b = JSON.parse(fs.readFileSync(`${UA}/intermediate/batches.json`, 'utf8'));
const bt = b.batches.find(x => x.batchIndex === 145);

const nodes = [];
const edges = [];
const E = (source, target, type, weight) => edges.push({ source, target, type, direction: 'forward', weight });
const F = (rel, type, name, summary, tags, complexity, notes) => {
  nodes.push({ id: `${type}:${rel}`, type, name, filePath: rel, summary, tags, complexity, ...(notes ? { languageNotes: notes } : {}) });
};
const FN = (rel, name, start, end, summary, tags, complexity) => {
  nodes.push({ id: `function:${rel}:${name}`, type: 'function', name, filePath: rel, lineRange: [start, end], summary, tags, complexity });
  E(`file:${rel}`, `function:${rel}:${name}`, 'contains', 1.0);
  E(`file:${rel}`, `function:${rel}:${name}`, 'exports', 0.8);
};

// ---- scripts/ ----
F('scripts/check_basedpyright_errors.py', 'file', 'check_basedpyright_errors.py',
  'Cổng kiểm tra type: parse báo cáo JSON của basedpyright và fail chỉ khi có diagnostic mức error; warning/info chỉ đếm vì codebase còn warning được theo dõi trên các interface động của langchain.',
  ['ci-cd', 'typecheck', 'basedpyright', 'quality-gate', 'script'], 'simple');
FN('scripts/check_basedpyright_errors.py', 'main', 21, 55,
  'Đọc báo cáo JSON, tách diagnostic theo mức severity, in tổng số warning/error và thoát 1 nếu có error-level diagnostics.',
  ['parsing', 'quality-gate', 'exit-code'], 'simple');

F('scripts/init_neo4j.cypher', 'file', 'init_neo4j.cypher',
  'Khởi tạo schema Neo4j cho Attack Graph: ràng buộc duy nhất cho các label Host/Network/Credential/Vulnerability/Technique…, index hiệu năng theo trạng thái khám phá/severity và hai index full-text tìm kiếm.',
  ['database', 'neo4j', 'schema-definition', 'attack-graph', 'script'], 'simple',
  'File Cypher không có parser cấu trúc — được phân tích thủ công; chạy một lần sau khi Neo4j bật bằng cypher-shell.',
  );
E('file:scripts/init_neo4j.cypher', 'document:docs/design/attack-graph-schema.md', 'related', 0.5);

F('scripts/next_version.py', 'file', 'next_version.py',
  'Tính phiên bản semver tiếp theo từ conventional commits cho workflow auto-tag: BREAKING CHANGE → major, feat → minor, fix/perf/revert → patch, còn lại không release; exit code là tín hiệu workflow phân nhánh.',
  ['versioning', 'conventional-commits', 'ci-cd', 'script'], 'simple');
FN('scripts/next_version.py', 'classify', 39, 52,
  'Phân loại một gói dòng commit thành cấp bump (none/patch/minor/major) bằng regex breaking/feat/fix.',
  ['classification', 'conventional-commits'], 'simple');
FN('scripts/next_version.py', 'bump', 55, 67,
  'Cộng phiên bản hiện tại theo cấp bump đã chọn, từ chối version đầu vào không hợp lệ.',
  ['versioning', 'semver'], 'simple');

F('scripts/render_benchmark_charts.py', 'file', 'render_benchmark_charts.py',
  'Vẽ các biểu đồ PNG cho bài viết benchmark XBOW (leaderboard, độ khó, donut Raptix, coverage) bằng matplotlib/numpy, dữ liệu giữ tập trung trong script như nguồn sự thật duy nhất.',
  ['visualization', 'benchmark', 'matplotlib', 'script'], 'moderate');
FN('scripts/render_benchmark_charts.py', 'chart_leaderboard', 109, 145,
  'Vẽ biểu đồ leaderboard các publisher XBOW kèm tô màu theo nhóm và ghi điểm phần trăm.',
  ['visualization', 'leaderboard'], 'simple');
FN('scripts/render_benchmark_charts.py', 'chart_difficulty', 153, 177,
  'Vẽ biểu đồ độ khó benchmark theo nhóm category cho phần write-up.',
  ['visualization', 'benchmark'], 'simple');
FN('scripts/render_benchmark_charts.py', 'chart_raptix_donut', 185, 253,
  'Vẽ donut chart thể hiện tỷ lệ nhiệm vụ Raptix giải được theo lớp độ khó với chú thích chi tiết.',
  ['visualization', 'donut-chart'], 'moderate');
FN('scripts/render_benchmark_charts.py', 'chart_coverage', 261, 282,
  'Vẽ biểu đồ độ phủ kỹ năng/kịch bản benchmark cho mục coverage của write-up.',
  ['visualization', 'coverage'], 'simple');

// ---- telemetry-gateway ----
F('telemetry-gateway/build_dashboard.py', 'file', 'build_dashboard.py',
  'Dựng lại dashboard PostHog thành ba mục định hướng (Usage, Tactics, Corpus) qua REST API: bao nhiêu OSS user dùng harness, tactic/MITRE nào chạy nhiều và trạng thái corpus huấn luyện đã mask.',
  ['telemetry', 'posthog', 'dashboard', 'analytics', 'script'], 'complex');
FN('telemetry-gateway/build_dashboard.py', 'api', 30, 40,
  'Gửi request authenticated tới PostHog API (GET/POST) và parse JSON trả về.',
  ['http-client', 'posthog', 'api'], 'simple');
FN('telemetry-gateway/build_dashboard.py', 'exclude_test_data', 65, 79,
  'Thêm mệnh đề HogQL loại bỏ event throwaway deploy-verify/live-verify khỏi mọi truy vấn dashboard.',
  ['hogql', 'data-quality', 'filtering'], 'simple');
FN('telemetry-gateway/build_dashboard.py', 'main', 254, 304,
  'Xóa dashboard cũ (tùy chọn), tạo dashboard mới cùng các insight HogQL theo ba mục và ghim layout.',
  ['posthog', 'dashboard', 'orchestration'], 'moderate');

F('telemetry-gateway/export_corpus.py', 'file', 'export_corpus.py',
  'Export corpus suy luận red-team đã mask từ PostHog về JSONL huấn luyện: ghép các event trajectory.step thành chuỗi turn có nhãn vai trò theo từng engagement, phân trang qua HogQL vì giới hạn kích thước query.',
  ['telemetry', 'posthog', 'training-corpus', 'export', 'script'], 'complex',
  'Nội dung đã được client masker che định danh trước khi tới PostHog nên bản export an toàn để chia sẻ.');
FN('telemetry-gateway/export_corpus.py', 'group_trajectories', 56, 88,
  'Gom các dòng event theo session_id, sắp xếp theo step và dựng một object trajectory với mảng steps có nhãn vai trò.',
  ['grouping', 'trajectory', 'transformation'], 'moderate');
FN('telemetry-gateway/export_corpus.py', '_query', 98, 154,
  'Chạy truy vấn HogQL phân trang lên events của PostHog, parse từng trang 10k dòng và nối kết quả có bảo toàn thứ tự.',
  ['hogql', 'pagination', 'posthog'], 'moderate');
FN('telemetry-gateway/export_corpus.py', '_bump_ms', 157, 168,
  'Đẩy mốc thời gian truy vấn theo từng trang để phân trang không trùng/khểnh event ở biên.',
  ['pagination', 'time-window'], 'simple');
FN('telemetry-gateway/export_corpus.py', '_self_test', 179, 188,
  'Self-test offline kiểm tra logic group/parse mà không cần gọi mạng.',
  ['self-test', 'offline'], 'simple');
FN('telemetry-gateway/export_corpus.py', 'main', 191, 233,
  'Điều phối CLI: phân tích đối số, chạy export (tùy --since-hours/--self-test) và ghi JSONL corpus ra file đầu ra.',
  ['cli', 'export', 'orchestration'], 'moderate');

F('telemetry-gateway/redact_corpus.py', 'file', 'redact_corpus.py',
  'Cổng redaction ngữ nghĩa lớp 2 trước khi corpus vào training: hai lượt LLM (redact định danh còn sót rồi verify độc lập) trên từng trajectory, fail-closed — trajectory còn lộ định danh bị chuyển vào quarantine thay vì được xuất bản.',
  ['telemetry', 'redaction', 'privacy', 'llm', 'security'], 'complex',
  'Đặt sau thu thập và trước training theo khuyến nghị OpenTelemetry/ISO 27559; placeholder tái dùng đúng shape <TYPE_n> của client masker để trajectory nhất quán.');
FN('telemetry-gateway/redact_corpus.py', '_chat', 138, 150,
  'Gửi prompt tới LLM proxy kèm retry wrapper cho các lỗi tạm thời.',
  ['llm-client', 'retry'], 'simple');
FN('telemetry-gateway/redact_corpus.py', '_chat_once', 153, 167,
  'Một lượt gọi LLM thuần: dựng request POST tới proxy, trả về nội dung text của assistant.',
  ['llm-client', 'http'], 'simple');
FN('telemetry-gateway/redact_corpus.py', '_parse_json', 170, 187,
  'Parse phản hồi LLM thành JSON an toàn: tách fence code, bắt lỗi giải mã và trả None thay vì raise.',
  ['parsing', 'json', 'robustness'], 'simple');
FN('telemetry-gateway/redact_corpus.py', 'text_windows', 190, 215,
  'Chia text dài thành các cửa sổ có chồng lấn để redact theo phần mà không vượt giới hạn context của model.',
  ['chunking', 'windowing'], 'moderate');
FN('telemetry-gateway/redact_corpus.py', 'apply_identifiers', 218, 261,
  'Áp dụng map định danh → placeholder <TYPE_n> lên các trường text, tái dùng số placeholder cũ để trajectory giữ tính nhất quán giữa các cửa sổ.',
  ['redaction', 'placeholder', 'mapping'], 'moderate');
FN('telemetry-gateway/redact_corpus.py', 'redact_trajectory', 273, 305,
  'Điều phối hai lượt redact + verify cho một trajectory: trả bản đã làm sạch hoặc đánh dấu quarantine khi lượt verify phát hiện còn định danh.',
  ['redaction', 'verify', 'fail-closed'], 'moderate');
FN('telemetry-gateway/redact_corpus.py', '_self_test', 323, 361,
  'Self-test offline với trajectory mẫu kiểm tra windowing, parse JSON và luồng quarantine không cần LLM thật.',
  ['self-test', 'offline'], 'simple');
FN('telemetry-gateway/redact_corpus.py', 'main', 364, 448,
  'Điều phối CLI: đọc corpus JSONL vào, chạy song song qua ThreadPoolExecutor, ghi corpus sạch và quarantine, in thống kê tóm tắt.',
  ['cli', 'concurrency', 'orchestration'], 'complex');

F('telemetry-gateway/vitest.config.ts', 'file', 'vitest.config.ts',
  'Cấu hình Vitest cho các test gateway telemetry của dự án (defineConfig tối giản).',
  ['configuration', 'vitest', 'test-runner', 'typescript'], 'simple');

// ---- tests/local ----
F('tests/local/README.md', 'document', 'README.md',
  'Tài liệu thư mục tests/local: quy định harness cục bộ (T2 probe, Juice Shop A/B runner, B0 live gate) là opt-in, cách chạy từ gốc repo và nguyên tắc lưu artifact ngoài git.',
  ['documentation', 'local-testing', 'harnesses', 'conventions'], 'simple');

F('tests/local/harnesses/juice_shop_t2.py', 'file', 'juice_shop_t2.py',
  'Runner benchmark T2 A/B cho Juice Shop chạy trên WSL host: đổi ảnh LangGraph theo arm, tái tạo Juice Shop từ digest pin, dispatch orchestrator qua LangGraph API với ngân sách cố định, chấm bằng verifier solved-transition đóng băng và lưu bằng chứng mỗi run.',
  ['benchmark', 'harness', 'a-b-test', 'juice-shop', 'orchestration'], 'complex',
  'File orchestration 1.4k dòng; mọi thao tác với target chỉ đọc và agent tự chạy dưới RoE enforcement.');
FN('tests/local/harnesses/juice_shop_t2.py', 'preflight', 185, 209,
  'Kiểm tra điều kiện tiền lệ trước khi chạy: docker khả dụng, ảnh/commit arm tồn tại, ground truth đã nạp.',
  ['preflight', 'validation'], 'simple');
FN('tests/local/harnesses/juice_shop_t2.py', 'inventory', 222, 239,
  'Đọc inventory challenge Juice Shop từ ground-truth table để làm mốc đối chiếu kết quả.',
  ['inventory', 'ground-truth'], 'simple');
FN('tests/local/harnesses/juice_shop_t2.py', 'validate_ground_truth', 242, 258,
  'Kiểm tra bảng ground truth hợp lệ (đủ cột, tham chiếu challenge tồn tại) trước khi cho phép dispatch run.',
  ['validation', 'ground-truth'], 'simple');
FN('tests/local/harnesses/juice_shop_t2.py', '_recreate_juice_shop', 320, 341,
  'Tái tạo container Juice Shop từ digest pin trên port cục bộ, đảm bảo target mới tinh cho từng run.',
  ['docker', 'target-setup'], 'simple');
FN('tests/local/harnesses/juice_shop_t2.py', '_read_sandbox_opplan', 360, 380,
  'Đọc opplan từ workspace sandbox container để phục vụ lưu bằng chứng và scoring.',
  ['sandbox', 'evidence'], 'simple');
FN('tests/local/harnesses/juice_shop_t2.py', '_archive_sandbox_workspace', 383, 409,
  'Sao chép workspace engagement từ container sandbox về thư mục bằng chứng của run kèm hash.',
  ['archive', 'evidence', 'docker'], 'moderate');
FN('tests/local/harnesses/juice_shop_t2.py', '_pg', 466, 493,
  'Kết nối trực tiếp Postgres container (checkpoint DB) cho các thao tác dọn/checkpoint phục vụ social hóa state giữa các run.',
  ['postgres', 'checkpoint', 'database'], 'simple');
FN('tests/local/harnesses/juice_shop_t2.py', '_await_run_terminal', 646, 700,
  'Poll thread state LangGraph đến khi run kết thúc terminal hoặc hết ngân sách thời gian, xử lý retry lỗi tạm thời.',
  ['polling', 'langgraph', 'async'], 'moderate');
FN('tests/local/harnesses/juice_shop_t2.py', '_snapshotter', 722, 757,
  'Chụp snapshot objective/state định kỳ trong lúc run để có timeline phục vụ phân tích sau.',
  ['snapshot', 'evidence'], 'moderate');
FN('tests/local/harnesses/juice_shop_t2.py', '_ensure_resumable_thread', 760, 795,
  'Đảm bảo thread LangGraph có thể resume: kiểm tra trạng thái thread và checkpoint trước khi dispatch tiếp.',
  ['langgraph', 'checkpoint'], 'moderate');
FN('tests/local/harnesses/juice_shop_t2.py', '_dispatch', 798, 938,
  'Gửi nhiệm vụ tới orchestrator decepticon qua LangGraph API theo mô hình turn-by-turn với proceed message standing-approval, xử lý interrupt và thu transcript.',
  ['dispatch', 'langgraph', 'orchestration'], 'complex');
FN('tests/local/harnesses/juice_shop_t2.py', '_coverage_recall', 941, 970,
  'Đối chiếu challenge đã giải với ground truth để tính coverage và liệt kê mục còn thiếu cho báo cáo run.',
  ['scoring', 'coverage'], 'simple');
FN('tests/local/harnesses/juice_shop_t2.py', '_score', 973, 1000,
  'Chấm kết quả run bằng verifier solved-transition đóng băng và tổng hợp điểm vào summary.',
  ['scoring', 'verifier'], 'moderate');
FN('tests/local/harnesses/juice_shop_t2.py', '_execute_run', 1003, 1244,
  'Thực thi trọn vẹn một run A/B: chuyển arm, tái tạo target, dựng workspace, dispatch agent, snapshot, chấm và lưu bằng chứng — hàm trung tâm của runner.',
  ['orchestration', 'benchmark', 'evidence'], 'complex');
FN('tests/local/harnesses/juice_shop_t2.py', 'run', 1247, 1342,
  'Vòng lặp lịch A/B đóng băng (A1,B1,A2,B2,A3,B3): gọi _execute_run cho từng lượt và tổng hợp kết quả loạt.',
  ['orchestration', 'a-b-test'], 'complex');
FN('tests/local/harnesses/juice_shop_t2.py', 'main', 1345, 1431,
  'CLI chính: phân tích subcommand (setup/run/probe…), kiểm tra authorization operator và điều phối luồng tương ứng.',
  ['cli', 'entry-point', 'orchestration'], 'complex');

F('tests/local/harnesses/lab_run.py', 'file', 'lab_run.py',
  'Runner tự động một lab duy nhất với thu thập trace đầy đủ: lưu input/trace/workspace/logs/manifest, suy diễn model/tool-call từ message diff của thread LangGraph mà không cần chỉnh mã hệ thống đang test; exit code 0/2/1 phân biệt hoàn thành, terminal khác và lỗi setup.',
  ['harness', 'lab-runner', 'trace-capture', 'langgraph'], 'complex',
  'Một engagement = một engagement_name + workspace container + thread mới; không tái sử dụng thread giữa các lab.');
FN('tests/local/harnesses/lab_run.py', '_await_run_terminal', 105, 147,
  'Poll trạng thái thread tới khi run terminal, phân biệt giữa các trạng thái actionable và xử lý lỗi tạm thời.',
  ['polling', 'langgraph'], 'moderate');
FN('tests/local/harnesses/lab_run.py', '_derive_calls', 172, 209,
  'Suy diễn model_calls.jsonl/tool_calls.jsonl từ chuỗi message (AIMessage → model call, ToolMessage → tool call) và ghi ra file trace.',
  ['trace', 'derivation', 'evidence'], 'moderate');
FN('tests/local/harnesses/lab_run.py', '_parse_args', 216, 235,
  'Phân tích CLI của runner: target, assistant, ngân sách, thư mục bằng chứng và các cờ snapshot.',
  ['cli', 'argument-parsing'], 'simple');
FN('tests/local/harnesses/lab_run.py', '_snapshotter', 238, 263,
  'Trả về coroutine snapshotter chụp objective/state định kỳ trong suốt run.',
  ['snapshot', 'evidence'], 'simple');
FN('tests/local/harnesses/lab_run.py', '_amain', 266, 473,
  'Luồng chính async: dựng thread, gửi kickoff, dẫn dắt turn-by-turn với proceed message, snapshot định kỳ và lưu toàn bộ bằng chứng.',
  ['async', 'orchestration', 'langgraph'], 'complex');
FN('tests/local/harnesses/lab_run.py', 'main', 476, 560,
  'Entry-point đồng bộ: chạy _amain, ánh xạ terminal state sang exit code và in tóm tắt outcome.',
  ['entry-point', 'cli'], 'complex');

F('tests/local/harnesses/lab_collect.py', 'file', 'lab_collect.py',
  'Collector bóng (shadow collector): gắn vào thread LangGraph đang chạy do CLI điều khiển, poll đến khi run terminal và message ngừng tăng, rồi ghi cùng layout bằng chứng như lab_run.py với cùng quy tắc suy diễn model/tool-call.',
  ['harness', 'collector', 'trace-capture', 'langgraph'], 'complex');
FN('tests/local/harnesses/lab_collect.py', '_amain', 119, 341,
  'Luồng async chính: chọn thread theo id hoặc mới nhất, poll state, ghi transcript/trace/workspace/logs và manifest khi run đi đến terminal hoặc timeout.',
  ['async', 'polling', 'evidence'], 'complex');
FN('tests/local/harnesses/lab_collect.py', 'main', 344, 390,
  'Entry-point đồng bộ: chạy _amain, xử lý Ctrl-C để finalise những gì đã chụp và ánh xạ exit code.',
  ['entry-point', 'cli'], 'moderate');

F('tests/local/harnesses/t2_probe.py', 'file', 't2_probe.py',
  'Probe cục bộ in tóm tắt trạng thái thread T2 đang sống (số message, token, objectives) ngoài suite chính, dùng langgraph_sdk.',
  ['harness', 'probe', 'diagnostics', 'langgraph'], 'simple');
FN('tests/local/harnesses/t2_probe.py', 'main', 13, 34,
  'Đọc provenance.json của run, lấy state thread qua langgraph_sdk và in dòng tóm tắt message/token/objectives.',
  ['probe', 'diagnostics'], 'simple');

F('tests/local/manual/test_b0_session_isolation_live.py', 'file', 'test_b0_session_isolation_live.py',
  'Gate B0 thủ công (slow/manual, cần RAPTIX_B0_LIVE=1): chứng minh hai session tmux sandbox thật không tráo state chéo, chạy qua đúng đường bash tool production thay vì gọi transport trực tiếp.',
  ['test', 'sandbox', 'session-isolation', 'manual-gate'], 'complex');
FN('tests/local/manual/test_b0_session_isolation_live.py', '_marker_command', 46, 56,
  'Dựng lệnh shell ghi marker độc nhất vào artifact trong session chỉ định để kiểm tra cô lập.',
  ['test-helper', 'isolation'], 'simple');
FN('tests/local/manual/test_b0_session_isolation_live.py', '_run_cell', 70, 97,
  'Chạy một cell qua bash tool trong session riêng, thu artifact marker làm bằng chứng cho test isolation.',
  ['test-helper', 'sandbox'], 'moderate');
FN('tests/local/manual/test_b0_session_isolation_live.py', 'test_b0_real_sessions_overlap_without_cross_session_state', 101, 191,
  'Chạy hai session chồng thời gian, assert marker của session này không lộ trong session kia qua artifact và workspace — bằng chứng B0 isolation trên stack thật.',
  ['test', 'session-isolation', 'evidence'], 'moderate');

F('tests/test_compose_langgraph_command.py', 'file', 'test_compose_langgraph_command.py',
  'Kiểm tra hợp đồng compose: lệnh langgraph trong docker-compose.yml phải tôn trọng LANGGRAPH_STRICT_ASYNC — bật biến thì bỏ --allow-blocking, mặc định thì giữ, xác minh trên file compose đã render.',
  ['test', 'docker-compose', 'configuration', 'contract-test'], 'moderate');

F('tests/test_compose_network_isolation.py', 'file', 'test_compose_network_isolation.py',
  'Bất biến cô lập mạng cho docker-compose.yml đã render: dịch vụ operational không vào management network, cấm host networking, cấm mount docker.sock, mọi port publish gắn 127.0.0.1 và dịch vụ dual-homed phải nằm allowlist.',
  ['test', 'network-isolation', 'security', 'docker-compose', 'contract-test'], 'complex');

F('tests/test_web_raptix_ci.py', 'file', 'test_web_raptix_ci.py',
  'Kiểm tra workflow CI thực sự điều hướng thay đổi web tới các bước quality chạy được: web filter output được export và tiêu thụ, status check phụ thuộc hợp lệ, change detection không cần write permission và Prisma client tạo trước typecheck.',
  ['test', 'ci-cd', 'web', 'contract-test'], 'moderate');

F('tests/test_web_raptix_release.py', 'file', 'test_web_raptix_release.py',
  'Kiểm tra asset release khớp web stack mới: release.yml build đủ hai ảnh web với version stamping, các workflow lifecycle dùng catalog ảnh mới, installer/updater/checksum manifest gồm docker-compose.web-raptix.yml.',
  ['test', 'release', 'ci-cd', 'contract-test'], 'simple');

// ================= EDGES =================
// tested_by (production → test)
E('service:docker-compose.yml', 'file:tests/test_compose_langgraph_command.py', 'tested_by', 0.5);
E('service:docker-compose.yml', 'file:tests/test_compose_network_isolation.py', 'tested_by', 0.5);
E('file:.github/workflows/ci.yml', 'file:tests/test_web_raptix_ci.py', 'tested_by', 0.5);
E('file:.github/workflows/release.yml', 'file:tests/test_web_raptix_release.py', 'tested_by', 0.5);
E('file:packages/raptix/raptix/tools/bash/bash.py', 'file:tests/local/manual/test_b0_session_isolation_live.py', 'tested_by', 0.5);
E('file:packages/raptix/raptix/backends/factory.py', 'file:tests/local/manual/test_b0_session_isolation_live.py', 'tested_by', 0.5);

// documents
E('document:tests/local/README.md', 'file:tests/local/harnesses/juice_shop_t2.py', 'documents', 0.5);
E('document:tests/local/README.md', 'file:tests/local/harnesses/lab_run.py', 'documents', 0.5);
E('document:tests/local/README.md', 'file:tests/local/harnesses/lab_collect.py', 'documents', 0.5);
E('document:tests/local/README.md', 'file:tests/local/harnesses/t2_probe.py', 'documents', 0.5);
E('document:tests/local/README.md', 'file:tests/local/manual/test_b0_session_isolation_live.py', 'documents', 0.5);

const out = { batchIndex: 145, batchFiles: bt.files, nodes, edges };
fs.writeFileSync(`${UA}/intermediate/batch-145.json`, JSON.stringify(out, null, 2), 'utf8');
const imp = edges.filter(e => e.type === 'imports').length;
console.log('batch-145.json written | nodes:', nodes.length, '| edges:', edges.length, '| imports:', imp, '(expected 0)');
