import { generate } from './ua-gen-engine.mjs';

const T = 'raptix/telemetry/';

const files = {
  'raptix/cli/telemetry.py': {
    summary: 'CLI con `telemetry` của Raptix: xem trạng thái, preview payload mẫu, bật chế độ basic/research và tắt telemetry.',
    tags: ['cli', 'telemetry', 'entry-point'],
    complexity: 'moderate',
    symbolTags: ['cli', 'telemetry'],
  },
  [T + '__init__.py']: {
    summary: 'Façade công khai của package telemetry: re-export TelemetrySink, get_sink, config và otel helpers cho phần còn lại của hệ thống.',
    tags: ['barrel', 'entry-point', 'telemetry', 'facade'],
    complexity: 'simple',
    symbolTags: ['telemetry', 'facade'],
  },
  [T + 'config.py']: {
    summary: 'Cấu hình telemetry: enum TelemetryMode (off/basic/research), ưu tiên env > persisted > default, opt-out marker, DNT và install id bền vững.',
    tags: ['configuration', 'telemetry', 'privacy'],
    complexity: 'moderate',
    symbolTags: ['telemetry', 'configuration', 'privacy'],
  },
  [T + 'exporter.py']: {
    summary: 'BatchExporter: hàng đợi giới hạn (drop cũ nhất khi đầy), gom event theo batch size và flush qua HTTP POST với fail-open.',
    tags: ['telemetry', 'exporter', 'batching', 'http'],
    complexity: 'moderate',
    symbolTags: ['telemetry', 'exporter', 'http'],
  },
  [T + 'otel.py']: {
    summary: 'Tích hợp OpenTelemetry: khởi tạo tracer provider, span hierarchy engagement→agent→tool→llm và helpers ghi chi phí/token; no-op an toàn khi thiếu package.',
    tags: ['telemetry', 'opentelemetry', 'tracing', 'observability'],
    complexity: 'complex',
    symbolTags: ['telemetry', 'opentelemetry', 'tracing'],
  },
  [T + 'redact.py']: {
    summary: 'Redactor che giấu dữ liệu nhạy cảm trong payload telemetry: IP/CIDR, hostname đã biết, credential dạng cặp key=value và cờ command line.',
    tags: ['telemetry', 'redaction', 'security', 'privacy'],
    complexity: 'complex',
    symbolTags: ['telemetry', 'redaction', 'security'],
  },
  [T + 'sanitizer.py']: {
    summary: 'Chuyển sự kiện nội bộ thành sự kiện Tier A đã chuẩn hóa: whitelist trường theo event type, bucket hóa output/tin nhắn và quét Tier C phát hiện rò rỉ.',
    tags: ['telemetry', 'sanitization', 'privacy', 'schema'],
    complexity: 'moderate',
    symbolTags: ['telemetry', 'sanitization', 'privacy'],
  },
  [T + 'sink.py']: {
    summary: 'TelemetrySink trung tâm: map event miền sang schema telemetry, gắn session id băm muối, redact theo tier và ship qua BatchExporter; get_sink singleton.',
    tags: ['telemetry', 'sink', 'session', 'singleton'],
    complexity: 'complex',
    symbolTags: ['telemetry', 'sink', 'session'],
  },
  'tests/unit/telemetry/test_otel.py': {
    summary: 'Kiểm thử otel: tắt mặc định, hierarchy span engagement/agent/tool/llm, thuộc tính, fallback ghi cost và an toàn khi thiếu package.',
    tags: ['test', 'opentelemetry', 'telemetry'],
    complexity: 'moderate',
    symbolTags: ['test', 'opentelemetry', 'telemetry'],
  },
  'tests/unit/telemetry/test_telemetry_behavioral.py': {
    summary: 'Kiểm thử hành vi telemetry end-to-end: ghi finding/phase, ưu tiên mode, envelope arch/py và đếm drop Tier C.',
    tags: ['test', 'telemetry', 'behavioral'],
    complexity: 'moderate',
    symbolTags: ['test', 'telemetry', 'behavioral'],
  },
  'tests/unit/telemetry/test_telemetry_config.py': {
    summary: 'Kiểm thử resolve_mode: opt-in mặc định, DNT ép off, giá trị lạ fail-closed và install id chỉ mint khi bật.',
    tags: ['test', 'configuration', 'telemetry'],
    complexity: 'simple',
    symbolTags: ['test', 'configuration', 'telemetry'],
  },
  'tests/unit/telemetry/test_telemetry_exporter.py': {
    summary: 'Kiểm thử BatchExporter: user-agent, flush khi đầy batch, close flush phần dư, swallow lỗi offline và queue bounded drop-oldest.',
    tags: ['test', 'exporter', 'telemetry'],
    complexity: 'simple',
    symbolTags: ['test', 'exporter', 'telemetry'],
  },
  'tests/unit/telemetry/test_telemetry_redact.py': {
    summary: 'Kiểm thử Redactor: placeholder ổn định, mask target/credential, không mask nhầm prose, mã nguồn chấm và địa chỉ IPv6/giờ hệ thống.',
    tags: ['test', 'redaction', 'security'],
    complexity: 'moderate',
    symbolTags: ['test', 'redaction', 'telemetry'],
  },
  'tests/unit/telemetry/test_telemetry_sanitizer.py': {
    summary: 'Kiểm thử sanitizer: whitelist trường theo event type, bucket hóa output, passthrough MITRE/CVE và bắt rò rỉ Tier C.',
    tags: ['test', 'sanitization', 'telemetry'],
    complexity: 'simple',
    symbolTags: ['test', 'sanitization', 'telemetry'],
  },
  'tests/unit/telemetry/test_telemetry_sink.py': {
    summary: 'Kiểm thử TelemetrySink: no-op khi tắt, map và ship event, session id ổn định, fail-closed với Tier C và chế độ research-only.',
    tags: ['test', 'sink', 'telemetry'],
    complexity: 'moderate',
    symbolTags: ['test', 'sink', 'telemetry'],
  },
};

const symbols = {
  'raptix/cli/telemetry.py::_status': { summary: 'In trạng thái telemetry hiện tại (mode, endpoint, install id) ra stdout.', tags: ['cli', 'status'] },
  'raptix/cli/telemetry.py::_preview': { summary: 'Sinh và hiển thị payload telemetry mẫu (đã sanitize) để người dùng xem trước khi bật.', tags: ['cli', 'preview', 'privacy'] },
  'raptix/cli/telemetry.py::_enable': { summary: 'Bật telemetry với mode được chọn và persist vào cấu hình cục bộ.', tags: ['cli', 'configuration'] },
  'raptix/cli/telemetry.py::main': { summary: 'Điều hướng subcommand telemetry: status/preview/enable/off.', tags: ['cli', 'entry-point'] },

  [T + 'config.py::TelemetryMode']: { summary: 'Enum mức telemetry: off, basic và research.', tags: ['enum', 'telemetry', 'configuration'] },
  [T + 'config.py::TelemetryConfig']: { summary: 'Dataclass cấu hình telemetry đã resolve: mode, endpoint, install id và cờ debug.', tags: ['data-model', 'configuration'] },
  [T + 'config.py::resolve_mode']: { summary: 'Chọn TelemetryMode theo thứ tự ưu tiên: env override > persisted > mặc định off (opt-in).', tags: ['configuration', 'telemetry'] },
  [T + 'config.py::is_opted_out']: { summary: 'Kiểm tra marker opt-out (DO_NOT_TRACK hoặc file marker) trên máy.', tags: ['privacy', 'configuration'] },
  [T + 'config.py::set_opted_out']: { summary: 'Ghi/xóa marker opt-out telemetry theo lựa chọn người dùng.', tags: ['privacy', 'configuration'] },
  [T + 'config.py::persisted_mode']: { summary: 'Đọc mode telemetry đã persist trên đĩa; trả None khi chưa có.', tags: ['configuration', 'persistence'] },
  [T + 'config.py::set_persisted_mode']: { summary: 'Ghi mode telemetry vào file cấu hình cục bộ một cách atomic.', tags: ['configuration', 'persistence'] },
  [T + 'config.py::install_id']: { summary: 'Đọc/tạo install id ngẫu nhiên bền vững, chỉ mint khi telemetry được bật.', tags: ['identity', 'privacy'] },
  [T + 'config.py::resolve_config']: { summary: 'Tổng hợp TelemetryConfig hoàn chỉnh: mode, endpoint, install id, arch và phiên bản Python.', tags: ['configuration', 'telemetry'], complexity: 'moderate' },
  [T + 'config.py::_arch']: { summary: 'Xác định kiến trúc máy (machine) để đưa vào envelope.', tags: ['utility', 'envelope'] },
  [T + 'config.py::_detect_version']: { summary: 'Lấy phiên bản Python đang chạy cho envelope telemetry.', tags: ['utility', 'envelope'] },

  [T + 'exporter.py::_http_post']: { summary: 'Gửi POST HTTP tới endpoint telemetry với timeout ngắn; không raise khi lỗi mạng.', tags: ['http', 'exporter'] },
  [T + 'exporter.py::BatchExporter']: { summary: 'Exporter gom sự kiện vào hàng đợi bounded, flush theo batch size qua HTTP POST; lỗi mạng được nuốt để không ảnh hưởng runtime.', tags: ['exporter', 'batching', 'telemetry'], complexity: 'moderate' },

  [T + 'otel.py::init_otel']: { summary: 'Khởi tạo TracerProvider OTLP nếu telemetry bật; idempotent và trả False khi tắt/thiếu package.', tags: ['opentelemetry', 'initialization'] },
  [T + 'otel.py::start_engagement_span']: { summary: 'Mở span gốc cho engagement với thuộc tính mục tiêu và workspace.', tags: ['opentelemetry', 'span'] },
  [T + 'otel.py::start_agent_span']: { summary: 'Mở span con cho agent với vai trò và model; parent là span engagement hiện hành.', tags: ['opentelemetry', 'span'] },
  [T + 'otel.py::start_tool_span']: { summary: 'Mở span cho lần gọi tool với tên tool và trạng thái thực thi.', tags: ['opentelemetry', 'span'] },
  [T + 'otel.py::start_llm_span']: { summary: 'Mở span cho lời gọi LLM với model và loại prompt.', tags: ['opentelemetry', 'span'] },
  [T + 'otel.py::_set_span_attribute']: { summary: 'Ghi attribute an toàn vào span hiện hành, bỏ qua khi disabled.', tags: ['opentelemetry', 'utility'] },
  [T + 'otel.py::record_llm_cost']: { summary: 'Ghi chi phí LLM lên span llm hiện hành, fallback về span engagement; bỏ qua None.', tags: ['opentelemetry', 'cost'] },
  [T + 'otel.py::record_llm_token_usage']: { summary: 'Ghi số token prompt/completion lên span llm hiện hành.', tags: ['opentelemetry', 'token-usage'] },
  [T + 'otel.py::set_current_objective_id']: { summary: 'Gắn objective id vào context OTel để các span con kế thừa.', tags: ['opentelemetry', 'context'] },
  [T + 'otel.py::reset_current_objective_id']: { summary: 'Xóa objective id khỏi context OTel khi kết thúc mục tiêu.', tags: ['opentelemetry', 'context'] },

  [T + 'redact.py::_group_detector']: { summary: 'Dựng detector theo nhóm: compile pattern và thay bằng placeholder có nhãn.', tags: ['redaction', 'regex'] },
  [T + 'redact.py::_builtin_detectors']: { summary: 'Danh sách detector sẵn có: IPv4/IPv6/CIDR, hostname, các cặp credential phổ biến và flag mật khẩu.', tags: ['redaction', 'detection'], complexity: 'moderate' },
  [T + 'redactor.py::Redactor']: { summary: 'Redactor chính: redact chuỗi/đối tượng đệ quy, hỗ trợ known-target tùy chọn và giữ placeholder ổn định giữa các lần chạy.', tags: ['redaction', 'security'], complexity: 'complex' },

  [T + 'sanitizer.py::slug']: { summary: 'Chuẩn hóa chuỗi thành slug an toàn dùng làm định danh trong schema telemetry.', tags: ['utility', 'normalization'] },
  [T + 'sanitizer.py::event_to_tier_a']: { summary: 'Chuyển sự kiện nội bộ thành sự kiện Tier A: whitelist trường theo event type, bucket hóa output/messages, bỏ trường lạ.', tags: ['sanitization', 'schema'], complexity: 'complex' },
  [T + 'sanitizer.py::scan_tier_c']: { summary: 'Quét payload tìm dữ liệu nhạy cảm (Tier C); trả marker phát hiện mà không trả lại giá trị gốc.', tags: ['sanitization', 'privacy'] },

  [T + 'sink.py::TelemetrySink']: { summary: 'Sink trung tâm gom sự kiện từ middleware/tools: map sang schema, redact theo tier, gắn session id và đẩy vào BatchExporter.', tags: ['telemetry', 'sink', 'session'], complexity: 'complex' },
  [T + 'sink.py::set_current_session']: { summary: 'Đặt contextvar session id hiện hành để mọi sự kiện sau được gắn nhãn.', tags: ['session', 'context'] },
  [T + 'sink.py::reset_current_session']: { summary: 'Xóa session id hiện hành khi engagement kết thúc.', tags: ['session', 'context'] },
  [T + 'sink.py::current_session']: { summary: 'Đọc session id hiện hành từ contextvar.', tags: ['session', 'context'] },
  [T + 'sink.py::session_id_for']: { summary: 'Băm HMAC install-salt + engagement thành session id ổn định và không đảo ngược.', tags: ['session', 'hash', 'privacy'] },
  [T + 'sink.py::get_sink']: { summary: 'Singleton truy cập TelemetrySink theo cấu hình hiện tại; trả sink no-op khi tắt.', tags: ['singleton', 'sink'] },
};

const symbolsFixed = {
  ...symbols,
  [T + 'redact.py::Redactor']: symbols[T + 'redactor.py::Redactor'],
};
delete symbolsFixed[T + 'redactor.py::Redactor'];

const calls = [
  { source: 'function:raptix/cli/telemetry.py:main', target: `function:${T}sink.py:get_sink` },
  { source: `class:${T}sink.py:TelemetrySink`, target: `class:${T}exporter.py:BatchExporter` },
  { source: `class:${T}sink.py:TelemetrySink`, target: `class:${T}redact.py:Redactor` },
  { source: `class:${T}sink.py:TelemetrySink`, target: `function:${T}config.py:resolve_config` },
  { source: `class:${T}sink.py:TelemetrySink`, target: `function:${T}sanitizer.py:scan_tier_c` },
  { source: `function:${T}sink.py:get_sink`, target: `function:${T}config.py:resolve_config` },
];

generate(18, { files, symbols: symbolsFixed, calls });
