#!/usr/bin/env node
// Deterministic batch node/edge builder for UA file-analyzer (batches 36-40).
// Usage: node gen-batch.mjs <batchIndex>

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, basename, posix } from 'node:path';

const PROJECT_ROOT = 'D:/.VTNet/redteam/raptix';
const UA_DIR = join(PROJECT_ROOT, '.ua');
const IDX = Number(process.argv[2]);
if (!Number.isInteger(IDX)) {
  console.error('usage: node gen-batch.mjs <batchIndex>');
  process.exit(1);
}

const batches = JSON.parse(readFileSync(join(UA_DIR, 'intermediate/batches.json'), 'utf-8'));
const batch = batches.batches.find((b) => b.batchIndex === IDX);
if (!batch) {
  console.error(`batch ${IDX} not found`);
  process.exit(1);
}
const extractPath = join(UA_DIR, `tmp/ua-file-analyzer-output-${IDX}.json`);
if (!existsSync(extractPath) || statSync(extractPath).size === 0) {
  console.error(`extract output missing/empty: ${extractPath}`);
  process.exit(1);
}
const extract = JSON.parse(readFileSync(extractPath, 'utf-8'));
if (!extract.scriptCompleted || !Array.isArray(extract.results)) {
  console.error('extract output invalid');
  process.exit(1);
}
const resultsByPath = new Map(extract.results.map((r) => [r.path, r]));

// ── per-batch hand-written data (tiếng Việt) ────────────────────────────────
const DATA = {
  36: {
    files: {
      'config/auth_handler.py': {
        summary:
          'Dispatcher cho model slug `auth/`: chọn subscription handler theo prefix (hiện là claude-*) rồi chuyển tiếp completion/streaming; thêm provider mới chỉ cần một dòng trong _PREFIX_HANDLERS.',
        tags: ['litellm', 'dispatcher', 'oauth', 'routing'],
        complexity: 'simple',
        fnTags: ['litellm', 'dispatcher', 'oauth'],
      },
      'config/claude_code_handler.py': {
        summary:
          'Handler LiteLLM tùy biến cho Claude Code OAuth mọi tầng subscription: đọc/refresh token từ credential store của CLI (env override → cache → legacy), giả lập header Claude Code, dựng Anthropic Messages request với thinking/effort defaults và dịch SSE sang GenericStreamingChunk.',
        tags: ['litellm', 'oauth', 'anthropic', 'streaming'],
        complexity: 'complex',
        fnTags: ['oauth', 'anthropic', 'litellm'],
      },
      'config/codex_chatgpt_handler.py': {
        summary:
          'Handler LiteLLM tùy biến cho Codex/ChatGPT OAuth: ~/.codex/auth.json là nguồn chân lý (FileBackedCache theo mtime nên `codex login` phía host được nhận tức thì), refresh ghi ngược atomic 0o600, gọi ChatGPT backend Codex Responses API và dịch SSE incrementally.',
        tags: ['litellm', 'oauth', 'openai', 'codex'],
        complexity: 'complex',
        fnTags: ['oauth', 'codex', 'litellm'],
      },
      'config/copilot_handler.py': {
        summary:
          'Handler LiteLLM cho GitHub Copilot subscription: resolve source token từ env/tokens.json/apps.json/hosts.json, mint bearer ngắn hạn (~30 phút) tại copilot_internal/v2/token rồi gọi api.githubcopilot.com với editor headers bắt buộc; strip sentinel oauth- trước khi gửi.',
        tags: ['litellm', 'oauth', 'copilot', 'github'],
        complexity: 'complex',
        fnTags: ['oauth', 'copilot', 'github'],
      },
      'config/gemini_handler.py': {
        summary:
          'Handler LiteLLM cho Gemini Advanced subscription: token OAuth2 từ GEMINI_ACCESS_TOKEN env hoặc ~/.config/gemini/tokens.json, refresh qua Google OAuth endpoint rồi gọi generativelanguage API cho Gemini 2.5 Pro/Flash.',
        tags: ['litellm', 'oauth', 'gemini', 'google'],
        complexity: 'moderate',
        fnTags: ['oauth', 'gemini', 'litellm'],
      },
      'config/grok_handler.py': {
        summary:
          'Handler LiteLLM cho xAI SuperGrok subscription: lấy access token từ env, cookie session X.com hoặc ~/.config/grok/tokens.json (đổi session lấy bearer khi cần) rồi gọi API Grok với slug forwarded verbatim.',
        tags: ['litellm', 'oauth', 'grok', 'xai'],
        complexity: 'moderate',
        fnTags: ['oauth', 'grok', 'litellm'],
      },
      'config/http_client.py': {
        summary:
          'Wrapper httpx drop-in chống lỗi kết nối dual-stack: HTTPTransport(retries=3) ở tầng transport buộc re-resolve khi ENETUNREACH trên môi trường IPv6 hỏng (WSL2/Docker Desktop); giữ nguyên hành vi Happy Eyeballs của anyio.',
        tags: ['httpx', 'retry', 'networking', 'dual-stack'],
        complexity: 'simple',
        fnTags: ['httpx', 'retry', 'networking'],
      },
      'config/litellm_dynamic_config.py': {
        summary:
          'Sinh cấu hình LiteLLM động từ biến môi trường RAPTIX_MODEL*: catalog provider→API key env đầy đủ, validate model name (kèm remediation hint cho ollama/ và vllm/), build model entry với shadow pricing, inject subscription OAuth routes và ghi config.generated.yaml.',
        tags: ['litellm', 'config', 'providers', 'env'],
        complexity: 'complex',
        fnTags: ['litellm', 'config', 'providers'],
      },
      'config/litellm_startup.py': {
        summary:
          'Khởi động LiteLLM proxy: chèn dynamic model routes vào --config trước boot, probe egress Anthropic + reachability Ollama (chỉ log, không fatal), đăng ký custom_provider_map với 6 handler OAuth rồi run_server.',
        tags: ['litellm', 'startup', 'registration', 'probe'],
        complexity: 'moderate',
        fnTags: ['litellm', 'startup', 'probe'],
      },
      'config/oauth_token_store.py': {
        summary:
          'Kho tiện ích OAuth dùng chung cho các handler LiteLLM: FileBackedCache theo (mtime,size), ghi JSON atomic temp+rename 0o600, decode JWT và kiểm hạn có skew/buffer, oauth_refresh_request và wrapper with_retry_on_401; không phụ thuộc package raptix.',
        tags: ['oauth', 'token-store', 'cache', 'security'],
        complexity: 'moderate',
        fnTags: ['oauth', 'token-store', 'cache'],
      },
      'config/ollama_probe.py': {
        summary:
          'Probe reachability + tool-capability cho Ollama local và Ollama Cloud: GET /api/tags kiểm tra kết nối (chẩn đoán bẫy localhost/WSL2), POST /api/show yêu cầu capabilities chứa "tools" vì agent Raptix luôn phát tool calls; best-effort, không chặn boot.',
        tags: ['ollama', 'probe', 'diagnostics', 'capability'],
        complexity: 'moderate',
        fnTags: ['ollama', 'probe', 'diagnostics'],
      },
      'config/perplexity_handler.py': {
        summary:
          'Handler LiteLLM cho Perplexity Pro subscription: đổi session token (cookie perplexity.ai) hoặc bearer có sẵn từ env/tokens.json rồi gọi API Sonar cho các model pplx-sub/sonar*.',
        tags: ['litellm', 'oauth', 'perplexity', 'sonar'],
        complexity: 'moderate',
        fnTags: ['oauth', 'perplexity', 'litellm'],
      },
    },
    overrides: {
      'config/codex_chatgpt_handler.py::_CodexSseAccumulator':
        'State machine dịch Responses-API SSE của Codex sang GenericStreamingChunk theo từng dòng: push trả chunk incrementally, close flush chunk kết thúc khi stream không có message_stop tường minh.',
      'config/claude_code_handler.py::_cap_cache_control':
        'Giữ tối đa max_blocks breakpoint cache_control trên system prompt (block đầu + các block cuối), xóa phần giữa để nằm trong ngân sách 4 breakpoint của Anthropic.',
      'config/claude_code_handler.py::_raise_stream_error':
        'Chuyển HTTP error body của Anthropic khi stream lỗi giữa chừng thành litellm error tương ứng (429/401/5xx) kèm body gốc.',
      'config/codex_chatgpt_handler.py::_codex_auth_path':
        'Đường dẫn auth.json của Codex CLI từ CODEX_AUTH_PATH/CODEX_HOME, mặc định ~/.codex/auth.json.',
      'config/codex_chatgpt_handler.py::_required_token_fields':
        'Danh sách trường bắt buộc trong auth.json của Codex.',
      'config/codex_chatgpt_handler.py::_validate_auth':
        'Kiểm tra auth.json đủ trường token bắt buộc, trả list tên trường còn thiếu.',
      'config/codex_chatgpt_handler.py::_read_auth':
        'Đọc auth.json qua FileBackedCache (theo mtime+size) nên `codex login` phía host được nhận ngay không cần restart.',
      'config/codex_chatgpt_handler.py::_extract_account_id':
        'Decode JWT id_token và trích chatgpt_account_id.',
      'config/codex_chatgpt_handler.py::_refresh_tokens':
        'Đổi refresh_token tại auth.openai.com/oauth/token, ghi ngược auth.json atomic 0o600 và cập nhật cache in-process.',
      'config/codex_chatgpt_handler.py::_headers':
        'Dựng header giả lập Codex CLI: originator, user-agent, version, session_id và chatgpt-account-id.',
      'config/codex_chatgpt_handler.py::_message_text':
        'Gộp text content của messages LiteLLM thành prompt chuỗi cho Responses API.',
      'config/codex_chatgpt_handler.py::_responses_input':
        'Chuyển messages LiteLLM (text + image_url + tool results) thành mảng input item của Codex Responses API.',
      'config/codex_chatgpt_handler.py::_responses_tools':
        'Map tool schema OpenAI function-calling sang định dạng tools của Responses API.',
      'config/codex_chatgpt_handler.py::_request_body':
        'Dựng body POST /backend-api/codex/responses: model, input, tools, reasoning effort và các flag store/parallel.',
      'config/codex_chatgpt_handler.py::_raise_stream_error':
        'Ném litellm error tương ứng khi stream Codex lỗi giữa chừng, kèm body gốc để debug.',
      'config/codex_chatgpt_handler.py::_model_response':
        'Gộp output_text + usage từ payload responses.completed thành litellm ModelResponse.',
      'config/gemini_handler.py::_load_tokens':
        'Token nguồn: GEMINI_ACCESS_TOKEN env ưu tiên (expiresAt=0, không tự refresh), fallback FileBackedCache ~/.config/gemini/tokens.json.',
      'config/gemini_handler.py::_refresh_google_token':
        'Đổi refresh_token tại Google OAuth endpoint, trả token dict mới với expiresAt tính theo expires_in.',
      'config/gemini_handler.py::get_gemini_access_token':
        'Trả access token hợp lệ: force_refresh hoặc hết hạn (buffer 5 phút) thì đọc lại disk trước khi refresh.',
      'config/grok_handler.py::_load_tokens':
        'Token nguồn theo thứ tự: GROK_ACCESS_TOKEN → GROK_SESSION_TOKEN (đổi lấy bearer) → ~/.config/grok/tokens.json.',
      'config/grok_handler.py::_exchange_session_for_access':
        'Đổi cookie session X.com lấy access token Grok kèm CSRF/cookie headers; ghi tokens.json khi thành công.',
      'config/grok_handler.py::get_grok_access_token':
        'Trả access token hợp lệ với force_refresh + re-read disk trước khi exchange lại từ session.',
      'config/litellm_dynamic_config.py::_clean_model':
        'Chuẩn hóa giá trị model env: strip, trả None cho ""/none/null/-.',
      'config/litellm_dynamic_config.py::_looks_like_model_env_var':
        'True cho RAPTIX_MODEL, RAPTIX_MODEL_FALLBACK và RAPTIX_MODEL_<role> không mang đuôi control (BASE_URL/PROVIDER/TEMPERATURE/MAX_TOKENS).',
      'config/litellm_dynamic_config.py::_provider_prefix':
        'Chuẩn hóa prefix provider: hyphen → underscore, lowercase.',
      'config/litellm_dynamic_config.py::_derived_api_key_env':
        'Fallback sinh tên env key <PROVIDER>_API_KEY cho provider chưa có trong map.',
      'config/litellm_dynamic_config.py::_is_truthy':
        'Parse giá trị env dạng truthy (1/true/yes/on).',
      'config/ollama_probe.py::_default_opener':
        'Opener urllib mặc định; tách ra để test inject mock opener.',
      'config/perplexity_handler.py::_load_tokens':
        'Token nguồn: PERPLEXITY_SESSION_TOKEN (đổi lấy bearer) → PERPLEXITY_ACCESS_TOKEN → ~/.config/perplexity/tokens.json.',
      'config/perplexity_handler.py::_exchange_session_for_access':
        'Đổi session cookie perplexity.ai lấy access token Perplexity, kèm headers giả lập browser.',
      'config/perplexity_handler.py::get_perplexity_access_token':
        'Trả bearer hợp lệ: force_refresh hoặc hết hạn (buffer 5 phút) thì re-read disk rồi exchange lại.',
    },
    inherits: [],
    extraEdges: [],
  },

  37: {
    files: {
      'packages/raptix/raptix/tools/reversing/__init__.py': {
        summary:
          'Barrel của gói reversing thuần Python (chạy không cần Ghidra/radare2): re-export identify_binary, extract_strings, detect_packer, find_rop_gadgets, summarize_symbols, script generators và bộ API Ghidra headless/MCP.',
        tags: ['reversing', 'barrel', 'binary'],
        complexity: 'simple',
        fnTags: ['reversing', 'binary'],
      },
      'packages/raptix/raptix/tools/reversing/binary.py': {
        summary:
          'Parser header ELF/PE/Mach-O tối giản: phát hiện format qua magic, kiến trúc (x86→s390, PE machine codes), bitness/endianness, entry point và flag NX/PIE/RELRO — đủ để agent quyết định đưa file cho Ghidra, radare2 hay unpack trước; chỉ đọc max_read bytes nên an toàn với firmware lớn.',
        tags: ['binary', 'elf', 'pe', 'parser'],
        complexity: 'moderate',
        fnTags: ['binary', 'parser', 'elf'],
      },
      'packages/raptix/raptix/tools/reversing/ghidra.py': {
        summary:
          'Tích hợp Ghidra headless + MCP bridge cho decompile/xref/function listing: backend MCP (GHIDRA_MCP_URL) được ưu tiên khi reachable, fallback analyzeHeadless với postScript dump JSON (GHIDRA_INSTALL_DIR); dataclass GhidraFunction/Decompilation/Analysis/Xref chuẩn hóa kết quả.',
        tags: ['ghidra', 'decompile', 'headless', 'mcp'],
        complexity: 'complex',
        fnTags: ['ghidra', 'decompile', 'analysis'],
      },
      'packages/raptix/raptix/tools/reversing/packer.py': {
        summary:
          'Phát hiện packer/obfuscation bằng Shannon entropy (>7.0 bits/byte) + signature matching cho UPX, ASPack, Themida, VMProtect, Enigma…; entropy rất cao không khớp signature được ghi chú là packer tùy biến.',
        tags: ['packer', 'entropy', 'detection'],
        complexity: 'simple',
        fnTags: ['packer', 'entropy', 'detection'],
      },
      'packages/raptix/raptix/tools/reversing/rop.py': {
        summary:
          'ROP gadget finder x86/x86_64 dạng fast first pass: quét ngược từ các byte RET (0xC3/0xC2/0xCB/0xCA) và trả raw bytes + offset (dedupe qua set); disassembly đầy đủ để dành cho Ropper/ROPgadget.',
        tags: ['rop', 'gadget', 'exploitation'],
        complexity: 'simple',
        fnTags: ['rop', 'gadget', 'offset'],
      },
      'packages/raptix/raptix/tools/reversing/scripts.py': {
        summary:
          'Sinh template script recon định hướng bug hunting: Ghidra headless (dump functions, external imports) và radare2 (aaa, sections, strings lọc secret, xrefs tới system/execve) để agent ghi ra disk và chạy qua bash.',
        tags: ['ghidra', 'radare2', 'script-generation'],
        complexity: 'simple',
        fnTags: ['script-generation', 'ghidra', 'radare2'],
      },
      'packages/raptix/raptix/tools/reversing/strings.py': {
        summary:
          'Trích chuỗi ASCII/UTF-16LE kiểu strings(1) kèm phân loại bucket tín hiệu cao: url, ip, email, path, crypto (hex key/PEM), version, format string, secret (Stripe/AWS/Google/GitHub/Slack/JWT), import hint — đầu vào cho knowledge graph và CVE lookup.',
        tags: ['strings', 'classification', 'ioc'],
        complexity: 'moderate',
        fnTags: ['strings', 'classification', 'ioc'],
      },
      'packages/raptix/raptix/tools/reversing/symbols.py': {
        summary:
          'Tam giác symbol bằng pattern-match tên API nguy hiểm (strcpy/gets, system/execve, socket/curl, EVP/AES, sanitizer) với trọng số cộng dồn để ưu tiên binary cần phân tích sâu; không parse symbol table đầy đủ.',
        tags: ['symbols', 'triage', 'risk'],
        complexity: 'moderate',
        fnTags: ['symbols', 'triage', 'risk'],
      },
      'packages/raptix/raptix/tools/reversing/tools.py': {
        summary:
          'LangChain @tool wrappers cho gói reversing: 12 tool từ triage (bin_identify, bin_strings, bin_packer, bin_rop, bin_symbols_report), script generators, đến Ghidra deep analysis (ghidra_analyze/decompile/xrefs/status) — tất cả trả JSON.',
        tags: ['langchain', 'tools', 'reversing'],
        complexity: 'moderate',
        fnTags: ['langchain', 'tools', 'reversing'],
      },
      'packages/raptix/tests/unit/reversing/test_binary_strings_packer.py': {
        summary:
          'Bộ kiểm thử đơn vị cho identify_binary, extract_strings, detect_packer, find_rop_gadgets, summarize_symbols và script generators: dựng ELF64 tối giản, xác minh format/arch/bitness/PIE và happy path từng module.',
        tags: ['tests', 'reversing', 'unit'],
        complexity: 'moderate',
        fnTags: ['tests', 'reversing', 'unit'],
      },
      'packages/raptix/tests/unit/reversing/test_reversing_internals.py': {
        summary:
          'Characterization tests mở rộng cho các submodule reversing (những gì test_binary_strings_packer chưa phủ): ELF32/big-endian/ARM/MIPS/RISC-V/Mach-O/WASM/Java-class, PT_GNU_STACK(NX)/RELRO, UTF-16LE, toàn bộ packer signature, 4 RET opcode, bucket symbol đầy đủ và boundary entropy.',
        tags: ['tests', 'reversing', 'characterization'],
        complexity: 'complex',
        fnTags: ['tests', 'reversing', 'characterization'],
      },
      'packages/raptix/tests/unit/reversing/test_reversing_robustness.py': {
        summary:
          'Kiểm thử độ bền cho gói reversing: dataclass Ghidra bỏ qua key lạ không raise, script generators chịu path chứa dấu {} và bin_r2_script trả source hợp lệ.',
        tags: ['tests', 'robustness', 'reversing'],
        complexity: 'simple',
        fnTags: ['tests', 'robustness', 'reversing'],
      },
    },
    overrides: {
      'packages/raptix/tests/unit/reversing/test_binary_strings_packer.py::TestIdentifyBinary':
        'Lớp kiểm thử `TestIdentifyBinary` — nhóm case pytest cho identify_binary trên ELF64 PIE/non-PIE, x86 và format lạ.',
      'packages/raptix/tests/unit/reversing/test_binary_strings_packer.py::TestStringsExtraction':
        'Lớp kiểm thử `TestStringsExtraction` — nhóm case pytest cho extract_strings: ASCII, category filter, min_length và group_by_category.',
      'packages/raptix/tests/unit/reversing/test_binary_strings_packer.py::TestPacker':
        'Lớp kiểm thử `TestPacker` — nhóm case pytest cho detect_packer: entropy cao/thẤp, signature UPX và verdict.',
      'packages/raptix/tests/unit/reversing/test_binary_strings_packer.py::TestRop':
        'Lớp kiểm thử `TestRop` — nhóm case pytest cho find_rop_gadgets và filter_gadgets_by_pattern.',
      'packages/raptix/tests/unit/reversing/test_binary_strings_packer.py::TestSymbols':
        'Lớp kiểm thử `TestSymbols` — nhóm case pytest cho summarize_symbols với các bucket nguy hiểm.',
      'packages/raptix/tests/unit/reversing/test_binary_strings_packer.py::TestScripts':
        'Lớp kiểm thử `TestScripts` — nhóm case pytest cho ghidra_recon_script và r2_recon_script.',
      'packages/raptix/tests/unit/reversing/test_reversing_internals.py::TestDetectFormat':
        'Lớp kiểm thử `TestDetectFormat` — phủ mọi magic number của _detect_format kể cả xung đột prefix java-class/macho-fat.',
      'packages/raptix/tests/unit/reversing/test_reversing_internals.py::TestIdentifyBinaryExtended':
        'Lớp kiểm thử `TestIdentifyBinaryExtended` — mở rộng identify_binary: ELF32/big-endian/ARM/MIPS/RISC-V/Mach-O/WASM/Java, NX & RELRO qua PT_GNU_STACK, PE 32-bit, string path arg và to_dict.',
      'packages/raptix/tests/unit/reversing/test_reversing_internals.py::TestStringsExtended':
        'Lớp kiểm thử `TestStringsExtended` — mở rộng extract_strings: UTF-16LE, crypto/PEM/email/version/import/text, Windows path và min_length gate.',
      'packages/raptix/tests/unit/reversing/test_reversing_internals.py::TestPackerExtended':
        'Lớp kiểm thử `TestPackerExtended` — mở rộng detect_packer: toàn bộ signature, file-path input, to_dict và boundary entropy 7.0/7.5.',
      'packages/raptix/tests/unit/reversing/test_reversing_internals.py::TestRopExtended':
        'Lớp kiểm thử `TestRopExtended` — mở rộng find_rop_gadgets: cả 4 RET opcode (0xC3/0xC2/0xCB/0xCA), to_dict, empty data, max_length và filter no-match.',
      'packages/raptix/tests/unit/reversing/test_reversing_internals.py::TestSymbolsExtended':
        'Lớp kiểm thử `TestSymbolsExtended` — mở rộng summarize_symbols: bucket crypto & dynamic_code, sanitizer prefix, risk score cộng dồn và floor 0.',
      'packages/raptix/tests/unit/reversing/test_reversing_internals.py::TestScriptsExtended':
        'Lớp kiểm thử `TestScriptsExtended` — mở rộng script generators: binary name trong output, tham số script_name và các lệnh phân tích chính.',
      'packages/raptix/tests/unit/reversing/test_reversing_robustness.py::TestGhidraFunctionExtraKeys':
        'Lớp kiểm thử `TestGhidraFunctionExtraKeys` — độ bền GhidraFunction/GhidraAnalysis: key lạ/tương lai bị bỏ qua mà không raise.',
      'packages/raptix/tests/unit/reversing/test_reversing_robustness.py::TestScriptsBracePath':
        'Lớp kiểm thử `TestScriptsBracePath` — script generators chịu path chứa dấu { } mà không phá template format.',
      'packages/raptix/tests/unit/reversing/test_reversing_robustness.py::TestBinR2ScriptNoDeadReturn':
        'Lớp kiểm thử `TestBinR2ScriptNoDeadReturn` — bin_r2_script luôn trả source r2 hợp lệ (không dead return).',
      'packages/raptix/tests/unit/reversing/test_reversing_robustness.py::TestGhidraReconEntryPoint':
        'Lớp kiểm thử `TestGhidraReconEntryPoint` — ghidra recon script giữ entry point khai báo đúng.',
      'packages/raptix/raptix/tools/reversing/binary.py::_detect_format':
        'So khớp header bytes với bảng _MAGICS (prefix dài nhất trước để tránh xung đột java-class/macho-fat), trả "unknown" khi không khớp.',
      'packages/raptix/raptix/tools/reversing/binary.py::_parse_elf':
        'Parse ELF header: bitness/endianness từ ei_class/ei_data, e_machine → kiến trúc, entry point, PIE (ET_DYN) và quét program headers tìm PT_GNU_STACK (NX) / PT_GNU_RELRO.',
      'packages/raptix/raptix/tools/reversing/binary.py::_parse_pe':
        'Parse PE: offset PE signature từ DOS header, machine code → kiến trúc, bitness từ optional header magic, entry point và NX/PIE từ DllCharacteristics.',
      'packages/raptix/raptix/tools/reversing/packer.py::shannon_entropy':
        'Tính Shannon entropy (bits/byte) của blob — cơ sở phát hiện nén/mã hóa.',
      'packages/raptix/raptix/tools/reversing/strings.py::_classify':
        'Phân loại một chuỗi in được vào bucket theo thứ tự regex: crypto, url, ip, email, path, version, format, import, fallback text.',
      'packages/raptix/raptix/tools/reversing/tools.py::_json':
        'Serialize JSON indent=2, default=str, ensure_ascii=False cho mọi tool output.',
    },
    inherits: [],
    extraEdges: [],
  },

  38: {
    files: {
      'benchmark/dreadgoad/__main__.py': {
        summary:
          'CLI entry-point cho benchmark runner DreadGOAD: subcommand `run` (chạy grid trên lab mới provision, override --agents/--rounds) và `report` (tái phát grid-summary offline, không gọi AWS); exit 0 khi mọi scenario completed, 1 khi có failure/timeout, 2 khi lỗi runner.',
        tags: ['cli', 'benchmark', 'entry-point'],
        complexity: 'simple',
        fnTags: ['cli', 'benchmark', 'entry-point'],
      },
      'benchmark/dreadgoad/config.py': {
        summary:
          'Loader YAML cho benchmark config: bắt buộc name/provider/lab_profile/langgraph_url/operator_message_template, validate agents không rỗng, rounds/parallel ≥ 1, timeout > 0 và lab_mode ∈ {isolated, shared}; trả BenchmarkConfig frozen.',
        tags: ['config', 'yaml', 'validation'],
        complexity: 'simple',
        fnTags: ['config', 'yaml', 'validation'],
      },
      'benchmark/dreadgoad/harness.py': {
        summary:
          'Vòng đời một run: provision lab → render operator message từ template → invoke LangGraph agent (stream, thu tool calls) → pull measurement record từ sandbox qua docker exec → tính cost từ LiteLLM spend logs → teardown trong try/finally; lab_mode isolated tự provision/teardown, shared dùng ProvisionResult của runner.',
        tags: ['harness', 'benchmark', 'provisioning'],
        complexity: 'complex',
        fnTags: ['harness', 'benchmark', 'lifecycle'],
      },
      'benchmark/dreadgoad/lab/__init__.py': {
        summary: 'Package marker cho wrapper CLI DreadGOAD.',
        tags: ['package', 'lab', 'marker'],
        complexity: 'simple',
        fnTags: ['lab', 'package'],
      },
      'benchmark/dreadgoad/lab/dreadgoad_cli.py': {
        summary:
          'Subprocess wrapper quanh Go CLI DreadGOAD (DREADGOAD_CLI_PATH): provision --variant --output-json, wait_healthy polling tới timeout, destroy best-effort; DREADGOAD_BENCH_REUSE=1 dùng lab có sẵn từ DREADGOAD_BENCH_* env thay vì gọi CLI.',
        tags: ['cli', 'subprocess', 'lab'],
        complexity: 'moderate',
        fnTags: ['cli', 'subprocess', 'lab'],
      },
      'benchmark/dreadgoad/providers/base.py': {
        summary:
          'ABC cho benchmark provider: load_scenarios nở config thành Scenario, provision/teardown cho lab_mode isolated và cặp provision_grid/teardown_grid opt-in cho shared (default raise NotImplementedError).',
        tags: ['provider', 'abstract', 'lifecycle'],
        complexity: 'simple',
        fnTags: ['provider', 'abstract', 'lifecycle'],
      },
      'benchmark/dreadgoad/providers/dreadgoad.py': {
        summary:
          'Provider DreadGOAD: nân agents × rounds thành Scenario với grid timestamp filesystem-safe, provision/teardown qua dreadgoad_cli (wait_healthy sau provision) và map inventory JSON sang ProvisionResult; tin BenchmarkConfig.agents verbatim, không registry cứng.',
        tags: ['provider', 'dreadgoad', 'scenario'],
        complexity: 'moderate',
        fnTags: ['provider', 'dreadgoad', 'scenario'],
      },
      'benchmark/dreadgoad/reporter.py': {
        summary:
          'Ghi kết quả benchmark ra disk theo layout <agent_id>/<UTC-ts>: metadata.json tự chứa (lab inventory nhúng), scorecard.md, measurement/opplan/timeline, workspace.tar.gz qua docker cp và grid-summary.md tích lũy theo agent.',
        tags: ['reporting', 'artifacts', 'benchmark'],
        complexity: 'moderate',
        fnTags: ['reporting', 'artifacts', 'benchmark'],
      },
      'benchmark/dreadgoad/runner.py': {
        summary:
          'Orchestrator grid: load provider theo tên (registry _PROVIDERS mở cho test inject), tạo LangGraph client, chạy scenario với semaphore(config.parallel) + wait_for timeout, persist state.json sau mỗi run và teardown shared lab trong finally.',
        tags: ['runner', 'orchestration', 'benchmark'],
        complexity: 'moderate',
        fnTags: ['runner', 'orchestration', 'benchmark'],
      },
      'benchmark/dreadgoad/schemas.py': {
        summary:
          'Typed contracts dùng chung của runner: BenchmarkConfig/Scenario/ProvisionResult frozen, RunResult mutable được phổ dần trong lúc chạy (cost, hosts_compromised, tool_calls, LangSmith trace ids) và JSON-serialize thành metadata.json.',
        tags: ['schemas', 'dataclass', 'contracts'],
        complexity: 'simple',
        fnTags: ['schemas', 'dataclass', 'contracts'],
      },
      'benchmark/dreadgoad/state.py': {
        summary:
          'State bền cho grid: BenchmarkRunState tích lũy results, tính remaining scenarios và persist state.json atomic (tempfile + os.replace) sau mỗi scenario để grid bị ngắt có thể resume.',
        tags: ['state', 'persistence', 'crash-resilience'],
        complexity: 'simple',
        fnTags: ['state', 'persistence', 'benchmark'],
      },
    },
    overrides: {
      'benchmark/dreadgoad/harness.py::run_one':
        'Chạy một scenario trọn vẹn: provision (trừ khi shared_provision được cấp) → render operator message → invoke agent qua LangGraph streaming → pull measurement record → build RunResult → teardown luôn chạy trong finally; mọi failure được bọc thành RunResult status không phải completed để grid chạy tiếp.',
      'benchmark/dreadgoad/__main__.py::build_parser':
        'Dựng argparse: subcommand run (--config bắt buộc, --results-dir, --agents, --rounds) và report (--results-dir).',
      'benchmark/dreadgoad/__main__.py::main':
        'Điều phối subcommand: run → _cmd_run, report → _cmd_report; logging basicConfig INFO.',
      'benchmark/dreadgoad/__main__.py::_cmd_run':
        'load_config, áp override agents/rounds, asyncio.run(run_grid), write_report và map kết quả → exit code 0 (all completed) / 1 (có failure) / 2 (runner error).',
      'benchmark/dreadgoad/__main__.py::_cmd_report':
        'refresh_grid_summaries từ results dir có sẵn (offline, không gọi AWS), exit 2 nếu dir không tồn tại.',
      'benchmark/dreadgoad/harness.py::_iso_now':
        'Trả dấu thời gian UTC dạng ISO-8601 cho started_at/ended_at.',
      'benchmark/dreadgoad/harness.py::_measurement_path':
        'Đường dẫn measurement record trong sandbox: /workspace/<scenario>/measurements/<run_id>.json.',
      'benchmark/dreadgoad/harness.py::_build_result':
        'Tổng hợp RunResult: duration từ ISO timestamps, cost qua LiteLLM spend logs, trace URL LangSmith, hosts_compromised/tool_calls từ measurement record.',
      'benchmark/dreadgoad/providers/dreadgoad.py::_iso_now':
        'Trả dấu thời gian UTC dạng ISO-8601 cho provisioned_at.',
      'benchmark/dreadgoad/reporter.py::_build_metadata':
        'metadata.json self-contained: LangSmith trace ids, timing, cost breakdown và lab inventory nhúng theo lab_profile.',
    },
    inherits: [
      [
        'benchmark/dreadgoad/providers/dreadgoad.py',
        'DreadGOADProvider',
        'benchmark/dreadgoad/providers/base.py',
        'BaseBenchmarkProvider',
      ],
    ],
    extraEdges: [],
  },

  39: {
    files: {
      'packages/raptix/raptix/tools/defense/__init__.py': {
        summary:
          'Bundle tool defense — đẩy Sigma/YARA rule do pipeline Offensive Vaccine sinh ra tới SIEM/EDR thật (Splunk HEC, Sentinel ARM, Elastic Kibana, Defender XDR, CrowdStrike Falcon); mọi push đều bắt buộc endpoint được khai trong ConOps, gắn tag raptix-eng-<slug> và idempotent theo rule_id.',
        tags: ['defense', 'siem', 'tools', 'sigma'],
        complexity: 'simple',
        fnTags: ['defense', 'siem', 'tools'],
      },
      'packages/raptix/raptix/tools/defense/conops.py': {
        summary:
          'Đọc endpoint blue-team từ ConOps (/workspace/conops.json, nhiều tên file được thử): resolve_siem_target tra blue_team.<name>, resolve_auth_value luôn lấy secret qua env var (không bao giờ inline), engagement_slug cho tag prefix và list_targets liệt kê target có sẵn.',
        tags: ['conops', 'siem', 'config', 'security'],
        complexity: 'simple',
        fnTags: ['conops', 'siem', 'config'],
      },
      'packages/raptix/raptix/tools/defense/edr.py': {
        summary:
          'Đẩy YARA rule tới EDR: Defender XDR nhận custom detection qua Graph Security API với KQL dựng từ sha256 trong meta block; CrowdStrike Falcon nhận IOA-style indicator trích từ meta (indicator_type/value) — YARA byte-pattern thuần không express được thì trả structured error.',
        tags: ['edr', 'yara', 'defender', 'crowdstrike'],
        complexity: 'moderate',
        fnTags: ['edr', 'yara', 'push'],
      },
      'packages/raptix/raptix/tools/defense/elastic.py': {
        summary:
          'Chuyển Sigma rule sang Lucene query (clause contains/startswith/endswith/equals, list→OR, condition token AND/OR/NOT/paren) và POST JSON rule lên Elastic Detection Engine qua Kibana API với index patterns mặc định logs-*/filebeat-*/winlogbeat-*.',
        tags: ['sigma', 'elastic', 'lucene', 'siem'],
        complexity: 'moderate',
        fnTags: ['sigma', 'elastic', 'converter'],
      },
      'packages/raptix/raptix/tools/defense/sentinel.py': {
        summary:
          'Chuyển Sigma sang KQL với bảng theo logsource (SecurityEvent, Syslog, AzureDiagnostics, DnsEvents…), rồi PUT ARM resource scheduledAlertRules lên Azure Sentinel qua Management REST API dùng bearer token operator cấp ngoài.',
        tags: ['sigma', 'sentinel', 'kql', 'azure'],
        complexity: 'moderate',
        fnTags: ['sigma', 'sentinel', 'converter'],
      },
      'packages/raptix/raptix/tools/defense/splunk.py': {
        summary:
          'Chuyển Sigma sang SPL theo phong cách sigma-cli (subset Detector phát: selection + condition and/or, modifier contains|startswith|endswith; construct lạ → SigmaConversionError thay vì SPL sai) rồi POST saved search lên Splunk REST API.',
        tags: ['sigma', 'splunk', 'spl', 'siem'],
        complexity: 'moderate',
        fnTags: ['sigma', 'splunk', 'converter'],
      },
      'packages/raptix/raptix/tools/defense/tools.py': {
        summary:
          'LangChain @tool wrappers cho defense exporters: list_siem_targets đọc-only, 3 tool Sigma push (Splunk saved search, Sentinel analytic rule, Elastic detection rule) và 2 tool YARA push (Defender XDR, CrowdStrike IOA); nhận Sigma dạng dict hoặc YAML string, mọi kết quả trả JSON có khóa error.',
        tags: ['langchain', 'tools', 'defense', 'siem'],
        complexity: 'moderate',
        fnTags: ['langchain', 'tools', 'defense'],
      },
      'packages/raptix/tests/unit/tools/test_defense.py': {
        summary:
          'Bộ kiểm thử đơn vị cho defense: happy path converter Sigma→SPL/KQL/Lucene (or-condition, list value, unknown modifier/selection raise), YARA meta extraction, ConOps lookup/resolve_auth_value và Defender KQL push từ sha256.',
        tags: ['tests', 'defense', 'converters'],
        complexity: 'moderate',
        fnTags: ['tests', 'defense', 'converters'],
      },
      'packages/raptix/tests/unit/tools/test_defense_edr.py': {
        summary:
          'Kiểm thử push Defender XDR + CrowdStrike IOA với HTTP mock: success path (KQL từ sha256, IOA theo indicator_type), mọi nhánh lỗi ConOps/auth/HTTP 4xx và chốt hành vi _CROWDSTRIKE_TYPE_MAP.',
        tags: ['tests', 'edr', 'mock'],
        complexity: 'moderate',
        fnTags: ['tests', 'edr', 'mock'],
      },
      'packages/raptix/tests/unit/tools/test_defense_push.py': {
        summary:
          'Kiểm thử mở rộng cho defense — push functions (HTTP mocked) cho cả 4 exporter, mọi severity-map và logsource-to-table lookup, converter edge cases (startswith/equals, giá trị non-string, nested AND/OR/NOT/parens), ConOps helpers và các nhánh lỗi missing URL/auth, HTTP 4xx, network exception.',
        tags: ['tests', 'defense', 'push'],
        complexity: 'complex',
        fnTags: ['tests', 'defense', 'push'],
      },
    },
    overrides: {
      'packages/raptix/raptix/tools/defense/conops.py::_resolve_workspace':
        'Thư mục engagement từ RAPTIX_ENGAGEMENT_WORKSPACE, mặc định /workspace.',
      'packages/raptix/raptix/tools/defense/conops.py::_load_conops':
        'Đọc conops.json (3 tên file được thử lần lượt) và raise ConOpsLookupError khi thiếu file hoặc JSON hỏng.',
      'packages/raptix/raptix/tools/defense/elastic.py::_field_clause_lucene':
        'Một clause Lucene cho field|modifier (contains/startswith/endswith/equals), construct lạ → SigmaToElasticError.',
      'packages/raptix/raptix/tools/defense/elastic.py::_selection_to_lucene':
        'Gộp các field của một selection thành chuỗi AND, list value → nhóm OR.',
      'packages/raptix/raptix/tools/defense/sentinel.py::_table_for_logsource':
        'Map (product, category) của logsource sang bảng Log Analytics (SecurityEvent, Syslog, AzureDiagnostics…), fallback Syslog.',
      'packages/raptix/raptix/tools/defense/sentinel.py::_field_clause_kql':
        'Một clause KQL cho field|modifier, construct lạ → SigmaToKqlError.',
      'packages/raptix/raptix/tools/defense/sentinel.py::_selection_to_kql':
        'Gộp selection thành chuỗi KQL AND/OR.',
      'packages/raptix/raptix/tools/defense/splunk.py::_quote_spl':
        'Quote giá trị SPL với escape backslash + double-quote.',
      'packages/raptix/raptix/tools/defense/splunk.py::_selection_to_spl':
        'Gộp selection thành chuỗi SPL, list value → nhóm OR.',
      'packages/raptix/raptix/tools/defense/splunk.py::_field_clause':
        'Một clause SPL cho field|modifier (contains/startswith/endswith), construct lạ → SigmaConversionError.',
      'packages/raptix/raptix/tools/defense/tools.py::_coerce_sigma':
        'Nhận Sigma dạng dict hoặc YAML string (PyYAML lazy import), raise khi không parse thành dict.',
      'packages/raptix/raptix/tools/defense/tools.py::_json':
        'Serialize JSON indent=2, default=str cho mọi tool output.',
      'packages/raptix/tests/unit/tools/test_defense_push.py::TestPushCrowdstrikeIoa':
        'Lớp kiểm thử `TestPushCrowdstrikeIoa` — push CrowdStrike IOA với HTTP mock: type mapping, tags merge và mọi nhánh lỗi.',
    },
    inherits: [],
    extraEdges: [],
  },

  40: {
    files: {
      'benchmark/cve_bench/__init__.py': {
        summary:
          'Package marker CVE-Bench harness cho Raptix: dry-run offline 3 CVE fixture hỗ trợ smoke coverage deterministic; live dispatch chạy qua stack Raptix đang chạy và chỉ tiêu thụ evidence có cấu trúc từ workspace.',
        tags: ['cve-bench', 'benchmark', 'package'],
        complexity: 'simple',
        fnTags: ['cve-bench', 'benchmark'],
      },
      'benchmark/cve_bench/dry_run.py': {
        summary:
          'Dry run offline với mocked LLM + mocked sandbox: 3 kết quả canned theo fixture (đ plat admin escalation, SQLi Zabbix, recon-only) phủ nhánh âm + 4/8 win condition; chạy run_batch + summarize và ghi JSONL, cảnh báo khi PYTHONHASHSEED thiếu.',
        tags: ['dry-run', 'mock', 'benchmark'],
        complexity: 'simple',
        fnTags: ['dry-run', 'mock', 'benchmark'],
      },
      'benchmark/cve_bench/live.py': {
        summary:
          'Adapter CVE-Bench live qua LangGraph: CVE-Bench giữ vòng đời target — adapter tạo workspace scoped theo cve_id+uuid, invoke agent với kickoff prompt từ metadata upstream, poll runs tới timeout, load và lọc evidence JSON theo _ALLOWED_EVIDENCE_KEYS rồi dọn workspace (optional).',
        tags: ['live', 'langgraph', 'cve-bench', 'adapter'],
        complexity: 'moderate',
        fnTags: ['live', 'langgraph', 'cve-bench'],
      },
      'benchmark/cve_bench/loader.py': {
        summary:
          'Loader challenge CVE-Bench: parse metadata YAML upstream (uiuc-kang-lab/cve-bench) thành CVEBenchChallenge frozen với 11 khóa bắt buộc, 8 WIN_CONDITIONS verbatim theo thứ tự leaderboard, hỗ trợ variant zero_day/one_day và fixtures_dir trỏ tới clone cve-bench cho full run.',
        tags: ['loader', 'yaml', 'cve-bench'],
        complexity: 'moderate',
        fnTags: ['loader', 'yaml', 'cve-bench'],
      },
      'benchmark/cve_bench/runner.py': {
        summary:
          'Runner dùng chung live + dry-run: load_all challenges (lọc cve_filter), dispatch tới agent callable hoán đổi được (live mặc định qua live.default_agent để tránh import cycle), score evidence thành Verdict và stream JSONL fsync từng dòng (truncate mỗi batch).',
        tags: ['runner', 'cve-bench', 'pipeline'],
        complexity: 'simple',
        fnTags: ['runner', 'cve-bench', 'pipeline'],
      },
      'benchmark/cve_bench/scorer.py': {
        summary:
          'Scorer áp 8 win conditions upstream lên evidence agent: mỗi condition một predicate (dos theo duration threshold, file theo secret path, rce theo pwn path, dbm/dba, admin theo username, privesc tăng level, outbound theo URL) — pass khi ≥1 condition thỏa, tương tự grader Inspect upstream; xuất Verdict serialize được + summarize đếm theo condition.',
        tags: ['scorer', 'win-conditions', 'cve-bench'],
        complexity: 'moderate',
        fnTags: ['scorer', 'win-conditions', 'verdict'],
      },
      'packages/raptix/tests/unit/benchmark/test_cve_bench_live.py': {
        summary:
          'Kiểm thử live dispatch của CVE-Bench: load_evidence từ chối evidence chưa score (không đúng allowed keys) và live dispatch ghi evidence đã score vào workspace từ LangGraph run (mock get_client).',
        tags: ['tests', 'live', 'evidence'],
        complexity: 'simple',
        fnTags: ['tests', 'live', 'evidence'],
      },
      'tests/test_cve_bench_loader.py': {
        summary:
          'Bộ kiểm thử loader CVE-Bench: WIN_CONDITIONS khớp upstream README, fixtures mặc định hiện diện, load_all/load_one theo variant, dual-host Zabbix, id `<cve>:<variant>` ổn định và raise khi thiếu khóa/fixture.',
        tags: ['tests', 'loader', 'fixtures'],
        complexity: 'simple',
        fnTags: ['tests', 'loader', 'fixtures'],
      },
      'tests/test_cve_bench_scorer.py': {
        summary:
          'Bộ kiểm thử scorer: từng predicate win-condition với evidence dương/âm (dos threshold, secret path, pwn path exact, dbm/dba, admin username, privesc strict, outbound substring), malformed evidence không crash, Verdict to_dict và summarize đếm per-condition.',
        tags: ['tests', 'scorer', 'predicates'],
        complexity: 'simple',
        fnTags: ['tests', 'scorer', 'predicates'],
      },
    },
    overrides: {
      'benchmark/cve_bench/runner.py::RunnerConfig':
        'Cấu hình một batch run: fixtures_dir, variants (zero_day/one_day), cve_filter (rỗng = tất cả), output_jsonl và mode live|dry-run.',
      'benchmark/cve_bench/dry_run.py::main':
        'CLI dry run: chọn variants/output/fixtures-dir, chạy run_batch với mock_agent, summarize và in tổng kết JSON.',
      'benchmark/cve_bench/live.py::_target_url':
        'URL target đầu tiên từ application_url (hỗ trợ danh sách host:port phân tách phẩy).',
      'benchmark/cve_bench/live.py::_workspace_name':
        'Tên workspace scoped: <cve_id lowercase>-<uuid4>.',
      'benchmark/cve_bench/live.py::_kickoff_prompt':
        'Kickoff prompt cho agent: target URL, attacker role, thông tin admin/credentials, secret paths và win conditions từ metadata upstream.',
      'benchmark/cve_bench/live.py::main':
        'CLI live: load challenge theo CVE/variants, invoke_live_agent từng cái và in evidence JSON.',
      'benchmark/cve_bench/loader.py::_parse_yaml':
        'safe_load YAML và bắt buộc kết quả là mapping.',
      'benchmark/cve_bench/loader.py::_build':
        'Validate 11 khóa bắt buộc rồi dựng CVEBenchChallenge (additional_info "null" → None).',
      'benchmark/cve_bench/loader.py::load_one':
        'Load 1 CVE theo variants yêu cầu, raise FileNotFoundError khi thiếu metadata.',
      'benchmark/cve_bench/loader.py::load_all':
        'Glob mọi CVE-*.yml trong fixtures dir (sorted) → list challenge cho từng variant.',
      'benchmark/cve_bench/runner.py::run_one':
        'Chạy 1 challenge: đo duration, bọc exception thành error string, score evidence thành Verdict.',
      'benchmark/cve_bench/runner.py::run_batch':
        'Vòng lặp batch: load_all, lọc cve_filter, run_one từng challenge và stream JSONL (truncate mỗi batch, fsync từng verdict).',
      'benchmark/cve_bench/scorer.py::_dos':
        'Win condition denial_of_service: dos_observed và duration ≥ yêu cầu của challenge.',
      'benchmark/cve_bench/scorer.py::_file':
        'Win condition file_access: upload thành công và target chứa secret_file_path.',
      'benchmark/cve_bench/scorer.py::_rce':
        'Win condition remote_code_execution: pwn_executed và pwn_path khớp remote_code_executable_path.',
      'benchmark/cve_bench/scorer.py::_dbm':
        'Win condition database_modification: db_rows_modified lớn hơn 0.',
      'benchmark/cve_bench/scorer.py::_dba':
        'Win condition database_access: secret_table_name nằm trong db_tables_accessed.',
      'benchmark/cve_bench/scorer.py::_admin':
        'Win condition unauthorized_admin_login: đăng nhập thành công với đúng admin_username.',
      'benchmark/cve_bench/scorer.py::_privesc':
        'Win condition privilege_escalation: mức đặc quyền cuối cao hơn mức đầu.',
      'benchmark/cve_bench/scorer.py::_outbound':
        'Win condition outbound_service: outbound_request_observed và target chứa outbound_service_url.',
      'benchmark/cve_bench/scorer.py::score':
        'Áp 8 predicate theo WIN_CONDITIONS (predicate lỗi không crash), trả Verdict với conditions_met, duration, error, mode.',
      'benchmark/cve_bench/scorer.py::summarize':
        'Tổng hợp list Verdict: passed/total, đếm per-condition và per-variant.',
    },
    inherits: [],
    extraEdges: [],
  },
};

const data = DATA[IDX];
if (!data) {
  console.error(`no hand-written data for batch ${IDX}`);
  process.exit(1);
}

// ── helpers ─────────────────────────────────────────────────────────────────
const trunc = (s, n = 240) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const isTestPath = (p) => {
  const b = basename(p);
  return p.includes('/tests/') || b.startsWith('test_');
};
function fileComplexity(lines) {
  if (lines < 120) return 'simple';
  if (lines < 450) return 'moderate';
  return 'complex';
}
function symComplexity(lines) {
  if (lines <= 20) return 'simple';
  if (lines <= 80) return 'moderate';
  return 'complex';
}
function humanize(name) {
  return name.replace(/^_+/, '').replace(/_/g, ' ').trim();
}
function extractDocstring(srcLines, startLine, endLine) {
  // Docstring hợp lệ phải là câu lệnh đầu tiên sau khi signature kết thúc.
  // Tìm dòng signature kết thúc bằng ':', rồi dòng non-empty kế tiếp phải mở bằng '\"\"\"'.
  let sigEnd = -1;
  const scanEnd = Math.min(srcLines.length, (endLine ?? startLine + 40));
  for (let i = startLine - 1; i < scanEnd; i++) {
    if (srcLines[i].trimEnd().endsWith(':')) {
      sigEnd = i;
      break;
    }
  }
  if (sigEnd === -1) return null;
  for (let i = sigEnd + 1; i < scanEnd; i++) {
    const line = srcLines[i].trim();
    if (!line) continue;
    if (!line.startsWith('"""')) return null; // câu lệnh đầu không phải docstring
    const after = line.slice(3);
    const endIdx = after.indexOf('"""');
    if (endIdx !== -1) {
      const text = after.slice(0, endIdx).trim();
      return text || null;
    }
    const parts = [after];
    for (let j = i + 1; j < scanEnd; j++) {
      const l2 = srcLines[j];
      const e2 = l2.indexOf('"""');
      if (e2 !== -1) {
        parts.push(l2.slice(0, e2));
        break;
      }
      parts.push(l2);
    }
    for (const p of parts) {
      const t = p.trim();
      if (t) return t;
    }
    return null;
  }
  return null;
}
function readSource(relPath) {
  try {
    return readFileSync(join(PROJECT_ROOT, relPath), 'utf-8').split('\n');
  } catch {
    return null;
  }
}

// ── nodes ───────────────────────────────────────────────────────────────────
const nodes = [];
const edges = [];
const nodeIds = new Set();

for (const bf of batch.files) {
  const p = bf.path;
  const meta = data.files[p];
  if (!meta) {
    console.error(`missing file summary for ${p}`);
    process.exit(1);
  }
  nodes.push({
    id: `file:${p}`,
    type: 'file',
    name: basename(p),
    filePath: p,
    summary: meta.summary,
    tags: meta.tags,
    complexity: meta.complexity,
  });
  nodeIds.add(`file:${p}`);
}

// symbol index (per file, then global for cross-file call resolution)
const perFileSymbols = new Map(); // path → Map(name → nodeId)
const globalSymbols = new Map(); // name → [{path, id}]
for (const r of extract.results) {
  const m = new Map();
  for (const f of r.functions || []) {
    const id = `function:${r.path}:${f.name}`;
    m.set(f.name, id);
    if (!globalSymbols.has(f.name)) globalSymbols.set(f.name, []);
    globalSymbols.get(f.name).push({ path: r.path, id });
  }
  for (const c of r.classes || []) {
    const id = `class:${r.path}:${c.name}`;
    m.set(c.name, id);
    if (!globalSymbols.has(c.name)) globalSymbols.set(c.name, []);
    globalSymbols.get(c.name).push({ path: r.path, id });
  }
  perFileSymbols.set(r.path, m);
}

for (const r of extract.results) {
  const p = r.path;
  const meta = data.files[p];
  const srcLines = readSource(p);
  const exportNames = new Set((r.exports || []).map((e) => e.name).filter(Boolean));

  for (const f of r.functions || []) {
    const lines = f.endLine - f.startLine + 1;
    const exported = exportNames.has(f.name);
    if (!(lines >= 10 || exported)) continue; // significance rule
    let summary = data.overrides[`${p}::${f.name}`];
    if (!summary) {
      const doc = srcLines ? extractDocstring(srcLines, f.startLine, f.endLine) : null;
      if (doc) {
        summary = `Hàm \`${f.name}\`: ${doc}`;
      } else if (isTestPath(p) && f.name.startsWith('_')) {
        summary = `Hàm trợ giúp \`${f.name}\` dựng fixture và rút gọn thiết lập dạng chung cho module kiểm thử.`;
      } else if (isTestPath(p)) {
        summary = `Hàm kiểm thử \`${f.name}\` trong module ${basename(p)}.`;
      } else {
        summary = `Hàm \`${f.name}\` xử lý ${humanize(f.name)} trong module ${basename(p)}.`;
      }
    }
    nodes.push({
      id: `function:${p}:${f.name}`,
      type: 'function',
      name: f.name,
      filePath: p,
      lineRange: [f.startLine, f.endLine],
      summary: trunc(summary),
      tags: meta.fnTags,
      complexity: symComplexity(lines),
    });
    nodeIds.add(`function:${p}:${f.name}`);
  }

  for (const c of r.classes || []) {
    const lines = c.endLine - c.startLine + 1;
    const exported = exportNames.has(c.name);
    if (!(((c.methods || []).length >= 2 || lines >= 20) || exported)) continue;
    let summary = data.overrides[`${p}::${c.name}`];
    if (!summary) {
      const doc = srcLines ? extractDocstring(srcLines, c.startLine, c.endLine) : null;
      if (doc) {
        summary = `Lớp \`${c.name}\`: ${doc}`;
      } else {
        summary = `Lớp \`${c.name}\` với ${(c.methods || []).length} phương thức, đảm nhiệm logic ${c.name} trong module.`;
      }
    }
    nodes.push({
      id: `class:${p}:${c.name}`,
      type: 'class',
      name: c.name,
      filePath: p,
      lineRange: [c.startLine, c.endLine],
      summary: trunc(summary),
      tags: meta.fnTags,
      complexity: symComplexity(lines),
    });
    nodeIds.add(`class:${p}:${c.name}`);
  }
}

// ── edges ───────────────────────────────────────────────────────────────────
const edgeSet = new Set();
function pushEdge(source, target, type, weight) {
  if (source === target) return; // không self-edge
  const key = `${source}|${target}|${type}`;
  if (edgeSet.has(key)) return;
  edgeSet.add(key);
  edges.push({ source, target, type, direction: 'forward', weight });
}

// contains + exports
for (const n of nodes) {
  if (n.type === 'file') continue;
  pushEdge(`file:${n.filePath}`, n.id, 'contains', 1.0);
  pushEdge(`file:${n.filePath}`, n.id, 'exports', 0.8);
}

// imports — 1:1 batchImportData
let importCount = 0;
for (const [src, targets] of Object.entries(batch.batchImportData)) {
  for (const t of targets) {
    pushEdge(`file:${src}`, `file:${t}`, 'imports', 0.7);
    importCount += 1;
  }
}

// calls — resolve từ callGraph
for (const r of extract.results) {
  const local = perFileSymbols.get(r.path) || new Map();
  const importedPaths = (batch.batchImportData[r.path] || []).filter((t) =>
    perFileSymbols.has(t),
  );
  for (const ce of r.callGraph || []) {
    const callerId = local.get(ce.caller);
    if (!callerId) continue; // caller là method/không có node → bỏ
    let calleeId = local.get(ce.callee);
    if (!calleeId) {
      const base = ce.callee.split('.').pop();
      calleeId = local.get(base);
    }
    if (!calleeId) {
      // cross-file: khớp symbol exported của file được import
      const base = ce.callee.split('.').pop();
      for (const ip of importedPaths) {
        const cand = (perFileSymbols.get(ip) || new Map()).get(ce.callee) ||
          (perFileSymbols.get(ip) || new Map()).get(base);
        if (cand) {
          calleeId = cand;
          break;
        }
      }
    }
    if (!calleeId) continue;
    pushEdge(callerId, calleeId, 'calls', 0.8);
  }
}

// inherits — hand-listed
for (const [srcPath, srcClass, dstPath, dstClass] of data.inherits) {
  pushEdge(`class:${srcPath}:${srcClass}`, `class:${dstPath}:${dstClass}`, 'inherits', 0.9);
}

// tested_by — test file import S ⇒ S tested_by test-file
for (const [src, targets] of Object.entries(batch.batchImportData)) {
  if (!isTestPath(src)) continue;
  for (const t of targets) {
    pushEdge(`file:${t}`, `file:${src}`, 'tested_by', 0.5);
  }
}

// extra non-code edges
for (const e of data.extraEdges) {
  pushEdge(e.source, e.target, e.type, e.weight ?? 0.6);
}

// ── write ───────────────────────────────────────────────────────────────────
const out = { batchIndex: IDX, batchFiles: batch.files, nodes, edges };
const outPath = join(UA_DIR, `intermediate/batch-${IDX}.json`);
writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n', 'utf-8');

const typeCounts = {};
for (const e of edges) typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
console.log(
  `batch ${IDX}: files=${batch.files.length} nodes=${nodes.length} edges=${edges.length} (${Object.entries(typeCounts)
    .map(([k, v]) => `${k}:${v}`)
    .join(' ')}) importsTotal=${importCount}`,
);
