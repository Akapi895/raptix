import { generate } from './ua-gen-engine.mjs';

const M = 'raptix/mcp_server/';

const files = {
  [M + '__init__.py']: {
    summary: 'Barrel package của MCP server: re-export build_server và cấu hình để nhúng server MCP vào ứng dụng khác.',
    tags: ['barrel', 'entry-point', 'mcp-server'],
    complexity: 'simple',
    symbolTags: ['mcp-server', 'config'],
  },
  [M + '__main__.py']: {
    summary: 'Entry point CLI cho MCP server: parse tham số (transport, host, port, auth), ghi đè config từ CLI và khởi chạy server stdio hoặc HTTP.',
    tags: ['entry-point', 'cli', 'mcp-server'],
    complexity: 'moderate',
    symbolTags: ['cli', 'entry-point', 'mcp-server'],
  },
  [M + 'auth.py']: {
    summary: 'Xác thực cho MCP server: kiểm tra loopback, verifier shared secret và JWT, suy luận auth mode từ env và dựng middleware FastMCP.',
    tags: ['authentication', 'security', 'mcp-server', 'middleware'],
    complexity: 'moderate',
    symbolTags: ['authentication', 'security', 'mcp-server'],
  },
  [M + 'config.py']: {
    summary: 'Cấu hình MCP server (ServerConfig): transport, timeout, scopes và auth mode, load từ biến môi trường với fallback an toàn.',
    tags: ['configuration', 'mcp-server', 'environment'],
    complexity: 'simple',
    symbolTags: ['configuration', 'mcp-server'],
  },
  [M + 'conversation.py']: {
    summary: 'Chuyển LangGraph state thành transcript tin nhắn và trạng thái engagement rút gọn cho MCP client, với windowing và compact giá trị lớn.',
    tags: ['transcript', 'conversation', 'mcp-server'],
    complexity: 'moderate',
    symbolTags: ['transcript', 'conversation', 'mcp-server'],
  },
  [M + 'engagements.py']: {
    summary: 'EngagementClient bao bọc LangGraph SDK client: start/send/cancel/watch engagement, xử lý lệnh model override trong tin nhắn.',
    tags: ['engagement', 'client', 'langgraph', 'mcp-server'],
    complexity: 'complex',
    symbolTags: ['engagement', 'client', 'langgraph'],
  },
  [M + 'findings.py']: {
    summary: 'Đọc findings graph từ workspace engagement và tóm tắt mức độ nghiêm trọng, tùy chọn gắn tài liệu SARIF.',
    tags: ['findings', 'reporting', 'mcp-server'],
    complexity: 'simple',
    symbolTags: ['findings', 'reporting', 'mcp-server'],
  },
  [M + 'models.py']: {
    summary: 'Bộ pydantic model định nghĩa hợp đồng API của MCP server: graph, run, status, transcript, stream event và findings.',
    tags: ['data-model', 'type-definition', 'mcp-server', 'api-schema'],
    complexity: 'moderate',
    symbolTags: ['data-model', 'pydantic', 'api-schema'],
  },
  [M + 'server.py']: {
    summary: 'build_server: dựng FastMCP server, gắn middleware auth theo cấu hình và đăng ký nhóm tool lifecycle + interactive.',
    tags: ['mcp-server', 'factory', 'entry-point'],
    complexity: 'simple',
    symbolTags: ['mcp-server', 'factory'],
  },
  [M + 'streaming.py']: {
    summary: 'watch_run: theo dõi stream events của một run LangGraph, gom StreamEvent với giới hạn số lượng và compact payload.',
    tags: ['streaming', 'events', 'mcp-server'],
    complexity: 'simple',
    symbolTags: ['streaming', 'events', 'mcp-server'],
  },
  [M + 'tools_interactive.py']: {
    summary: 'Đăng ký các tool tương tác MCP: xem trạng thái run, xem transcript, watch realtime và gửi tin nhắn tiếp theo cho engagement.',
    tags: ['mcp-server', 'tools', 'interactive'],
    complexity: 'moderate',
    symbolTags: ['tool', 'interactive', 'mcp-server'],
  },
  [M + 'tools_lifecycle.py']: {
    summary: 'Đăng ký các tool vòng đời MCP: tạo/list engagement, gửi tin nhắn, cancel run, lấy findings và tóm tắt trạng thái.',
    tags: ['mcp-server', 'tools', 'lifecycle'],
    complexity: 'moderate',
    symbolTags: ['tool', 'lifecycle', 'mcp-server'],
  },
  'tests/unit/mcp_server/test_auth.py': {
    summary: 'Kiểm thử auth MCP server: loopback, shared secret, JWT (audience/issuer/scopes), suy luận mode và middleware trên build_server.',
    tags: ['test', 'authentication', 'jwt'],
    complexity: 'moderate',
    symbolTags: ['test', 'authentication', 'mcp-server'],
  },
  'tests/unit/mcp_server/test_config.py': {
    summary: 'Kiểm thử load_config: giá trị mặc định, env override, timeout không hợp lệ và các biến auth (JWT, shared secret).',
    tags: ['test', 'configuration', 'mcp-server'],
    complexity: 'simple',
    symbolTags: ['test', 'configuration', 'mcp-server'],
  },
  'tests/unit/mcp_server/test_conversation.py': {
    summary: 'Kiểm thử build_transcript: parse vai trò, delegation, windowing, flatten content block và compact trạng thái engagement.',
    tags: ['test', 'transcript', 'conversation'],
    complexity: 'simple',
    symbolTags: ['test', 'transcript', 'mcp-server'],
  },
  'tests/unit/mcp_server/test_engagements.py': {
    summary: 'Kiểm thử EngagementClient với fake LangGraph client: start scoped run, gửi tin nhắn, lệnh model, cancel và watch stream.',
    tags: ['test', 'engagement', 'client'],
    complexity: 'moderate',
    symbolTags: ['test', 'engagement', 'mcp-server'],
  },
  'tests/unit/mcp_server/test_findings.py': {
    summary: 'Kiểm thử findings: tóm tắt graph vắng mặt, đếm mức nghiêm trọng, đính kèm SARIF và chặn tên workspace không an toàn.',
    tags: ['test', 'findings', 'reporting'],
    complexity: 'simple',
    symbolTags: ['test', 'findings', 'mcp-server'],
  },
};

const symbols = {
  [M + '__main__.py::_build_parser']: { summary: 'Dựng argparse parser cho MCP server: transport, host, port và các cờ auth.', tags: ['cli', 'argparse'] },
  [M + '__main__.py::_apply_cli']: { summary: 'Ghi đè ServerConfig bằng tham số CLI trước khi khởi chạy server.', tags: ['cli', 'configuration'] },
  [M + '__main__.py::main']: { summary: 'Entry point chạy MCP server theo transport stdio hoặc HTTP đã cấu hình.', tags: ['entry-point', 'mcp-server'] },

  [M + 'auth.py::is_loopback_host']: { summary: 'Kiểm tra host có phải loopback (localhost/127.0.0.1/::1) để cho phép bind không auth.', tags: ['security', 'utility'] },
  [M + 'auth.py::resolve_auth_mode']: { summary: 'Suy luận auth mode (none/shared_secret/jwt) từ env: token, issuer và key source.', tags: ['authentication', 'configuration'] },
  [M + 'auth.py::open_bind_error']: { summary: 'Sinh lỗi chặn bind public khi chưa bật auth, kèm gợi ý khắc phục.', tags: ['security', 'error-handling'] },
  [M + 'auth.py::build_auth']: { summary: 'Dựng middleware auth FastMCP từ ServerConfig: shared secret verifier hoặc JWT verifier.', tags: ['authentication', 'middleware', 'factory'], complexity: 'moderate' },
  [M + 'auth.py::SharedSecretVerifier']: { summary: 'Verifier so khớp bearer token với shared secret đã cấu hình.', tags: ['authentication', 'security'] },
  [M + 'auth.py::JwtVerifier']: { summary: 'Verifier JWT kiểm tra chữ ký, audience, issuer và trích scopes từ claims.', tags: ['authentication', 'jwt', 'security'] },

  [M + 'config.py::ServerConfig']: { summary: 'Dataclass cấu hình MCP server: transport, host, port, timeout, scopes và auth settings.', tags: ['data-model', 'configuration'] },
  [M + 'config.py::load_config']: { summary: 'Load ServerConfig từ biến môi trường với parse an toàn và fallback khi giá trị không hợp lệ.', tags: ['configuration', 'environment'] },

  [M + 'conversation.py::_content_text']: { summary: 'Gộp các content block của tin nhắn LangChain thành text phẳng.', tags: ['utility', 'transcript'] },
  [M + 'conversation.py::_to_message']: { summary: 'Chuyển một message LangGraph thành TranscriptMessage với vai trò chuẩn hóa.', tags: ['transcript', 'mapping'] },
  [M + 'conversation.py::build_transcript']: { summary: 'Dựng Transcript (danh sách tin nhắn) từ LangGraph state, có windowing theo số tin nhắn.', tags: ['transcript', 'conversation'] },
  [M + 'conversation.py::build_engagement_state']: { summary: 'Dựng EngagementState rút gọn (không tin nhắn, giá trị lớn được compact) cho MCP client.', tags: ['engagement', 'state'] },

  [M + 'engagements.py::_split_model_command']: { summary: 'Tách lệnh model override (ví dụ "/model gpt-5") khỏi phần nội dung tin nhắn.', tags: ['parsing', 'model-override'] },
  [M + 'engagements.py::_engagement_input']: { summary: 'Chuyển gói tham số thành input payload cho run LangGraph.', tags: ['engagement', 'mapping'] },
  [M + 'engagements.py::EngagementClient']: { summary: 'Client quản lý engagement trên LangGraph SDK: start với scope, gửi tin nhắn, cancel run, watch stream và liệt kê graph/thread.', tags: ['engagement', 'client', 'langgraph'], complexity: 'complex' },

  [M + 'findings.py::engagement_workspace']: { summary: 'Xác định thư mục workspace của engagement, chặn tên không an toàn (path traversal).', tags: ['workspace', 'security'] },
  [M + 'findings.py::load_findings_graph']: { summary: 'Đọc findings graph JSON từ workspace; trả None khi thiếu hoặc path không an toàn.', tags: ['findings', 'parsing'] },
  [M + 'findings.py::summarize_findings']: { summary: 'Tóm tắt findings graph: đếm theo mức nghiêm trọng, tùy chọn gắn SARIF document.', tags: ['findings', 'reporting'] },

  [M + 'models.py::GraphInfo']: { summary: 'Model mô tả một graph khả dụng: tên, mô tả và metadata.', tags: ['data-model', 'pydantic'] },
  [M + 'models.py::StartResult']: { summary: 'Model kết quả khởi tạo engagement: engagement_id, run handle và trạng thái ban đầu.', tags: ['data-model', 'pydantic'] },
  [M + 'models.py::RunHandle']: { summary: 'Model định danh một run đang chạy: run_id và attempt.', tags: ['data-model', 'pydantic'] },
  [M + 'models.py::StatusResult']: { summary: 'Model trạng thái run: trạng thái, bước hiện tại và lỗi (nếu có).', tags: ['data-model', 'pydantic'] },
  [M + 'models.py::EngagementSummary']: { summary: 'Model tóm tắt engagement: tên, workspace, trạng thái và con số findings.', tags: ['data-model', 'pydantic'] },
  [M + 'models.py::TranscriptMessage']: { summary: 'Model một tin nhắn transcript: vai trò, nội dung và metadata tool call.', tags: ['data-model', 'pydantic'] },
  [M + 'models.py::Transcript']: { summary: 'Model transcript: danh sách tin nhắn và tổng số đã cắt bớt.', tags: ['data-model', 'pydantic'] },
  [M + 'models.py::EngagementState']: { summary: 'Model trạng thái engagement rút gọn: giai đoạn, mục tiêu và metadata.', tags: ['data-model', 'pydantic'] },
  [M + 'models.py::StreamEvent']: { summary: 'Model một stream event từ run: loại, payload và timestamp.', tags: ['data-model', 'pydantic'] },
  [M + 'models.py::WatchResult']: { summary: 'Model kết quả watch: các stream event thu được và cờ run kết thúc.', tags: ['data-model', 'pydantic'] },
  [M + 'models.py::FindingsResult']: { summary: 'Model kết quả findings: tóm tắt mức nghiêm trọng và SARIF tùy chọn.', tags: ['data-model', 'pydantic'] },

  [M + 'server.py::build_server']: { summary: 'Dựng FastMCP server hoàn chỉnh: gắn middleware auth khi cấu hình và đăng ký tool lifecycle + interactive.', tags: ['factory', 'mcp-server', 'entry-point'] },

  [M + 'streaming.py::watch_run']: { summary: 'Subscribe stream của run LangGraph, gom StreamEvent đến khi run kết thúc hoặc đạt cap sự kiện.', tags: ['streaming', 'events'], complexity: 'moderate' },

  [M + 'tools_interactive.py::register_interactive_tools']: { summary: 'Đăng ký nhóm tool tương tác: run_status, get_transcript, watch và send_message.', tags: ['tool', 'interactive', 'mcp-server'], complexity: 'complex' },

  [M + 'tools_lifecycle.py::default_engagement_name']: { summary: 'Sinh tên engagement mặc định theo ngày giờ hiện tại.', tags: ['utility', 'naming'] },
  [M + 'tools_lifecycle.py::register_lifecycle_tools']: { summary: 'Đăng ký nhóm tool vòng đời: create_engagement, list_engagements, cancel, get_findings và engagement_status.', tags: ['tool', 'lifecycle', 'mcp-server'], complexity: 'complex' },

  'tests/unit/mcp_server/test_engagements.py::_FakeThreads': { summary: 'Fake threads API của LangGraph SDK phục vụ test EngagementClient.', tags: ['test-double', 'fixture', 'langgraph'] },
  'tests/unit/mcp_server/test_engagements.py::_FakeRuns': { summary: 'Fake runs API mô phỏng create/cancel/stream của LangGraph SDK.', tags: ['test-double', 'fixture', 'langgraph'] },
  'tests/unit/mcp_server/test_findings.py::_Node': { summary: 'Node giả lập tối giản cho findings graph trong test.', tags: ['test-double', 'fixture'] },
  'tests/unit/mcp_server/test_findings.py::_Graph': { summary: 'Graph giả lập tối giản cho test tóm tắt findings.', tags: ['test-double', 'fixture'] },
};

const calls = [
  { source: `function:${M}server.py:build_server`, target: `function:${M}tools_interactive.py:register_interactive_tools` },
  { source: `function:${M}server.py:build_server`, target: `function:${M}tools_lifecycle.py:register_lifecycle_tools` },
  { source: `function:${M}server.py:build_server`, target: `function:${M}auth.py:build_auth` },
  { source: `function:${M}tools_lifecycle.py:register_lifecycle_tools`, target: `class:${M}engagements.py:EngagementClient` },
  { source: `function:${M}tools_interactive.py:register_interactive_tools`, target: `class:${M}engagements.py:EngagementClient` },
  { source: `function:${M}__main__.py:main`, target: `function:${M}server.py:build_server` },
];

generate(17, { files, symbols, calls });
