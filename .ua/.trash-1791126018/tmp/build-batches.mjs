// Batch builder for .ua intermediate batch files (46-50).
// Conventions mirror existing batch-1..45 outputs.
import fs from "node:fs";

const ROOT = "D:/.VTNet/redteam/raptix";
const UA = ROOT + "/.ua";
const batches = JSON.parse(fs.readFileSync(UA + "/intermediate/batches.json", "utf8"));
const extractFor = (i) =>
  JSON.parse(fs.readFileSync(UA + `/tmp/ua-file-analyzer-output-${i}.json`, "utf8"));

// ---------------------------------------------------------------- metadata
const FM = {}; // file metadata: path -> {summary, tags, complexity, languageNotes?}
const NM = {}; // symbol metadata: "path::name" -> {summary, tags, complexity, languageNotes?}
const F = (p, summary, tags, complexity, languageNotes) => (FM[p] = { summary, tags, complexity, languageNotes });
const N = (p, name, summary, tags, complexity, languageNotes) =>
  (NM[`${p}::${name}`] = { summary, tags, complexity, languageNotes });

// ===== Batch 46 =====
F("packages/raptix/raptix/middleware/egress.py",
  "Nửa 'authoritative' của guardrail RoE Layer-2: compile_egress_policy biên dịch khối machine_enforcement của roe.json thành EgressPolicy (nftables connect-allowlist + DNS allowlist) mà sandbox thi hành ở biên mạng; re-export renderer/applier từ sandbox_kernel.",
  ["egress", "roe", "guardrail", "nftables"], "moderate",
  "Module chỉ giữ bước phụ thuộc raptix_core (MachineEnforcement → EgressPolicy); renderer/applier chạy bên trong container sandbox nên tách sang raptix.sandbox_kernel.egress.");
F("packages/raptix/raptix/sandbox_kernel/egress.py",
  "Applier egress phía sandbox: phát hiện management plane từ /proc/net/route, render nftables ruleset + DNS allowlist từ EgressPolicy rồi nạp bằng nft -f; chỉ dùng stdlib vì chạy trong sandbox image.",
  ["egress", "nftables", "sandbox", "firewall"], "complex",
  "Không import raptix_core/langchain; management CIDR luôn được accept trước mọi deny để scope rule không thể cắt liên kết agent↔management (Neo4j + HTTP daemon); RAPTIX_EGRESS_DISABLE là opt-out của operator.");
F("packages/raptix/tests/unit/middleware/test_egress.py",
  "Kiểm thử compiler egress Layer-2: pin logic thuần từ MachineEnforcement → EgressPolicy — audit/warn không thực thi, default_drop chỉ khi có in-scope, denylist precedence, OSINT hosts luôn được phép, render nftables/DNS idempotent.",
  ["unit-test", "egress", "roe", "nftables"], "moderate");
F("packages/raptix/tests/unit/sandbox_kernel/test_egress_applier.py",
  "Kiểm thử applier egress phía sandbox với runner nft và reader route/resolver được inject: phát hiện management CIDR từ /proc/net/route, gating enabled/audit, resolve host, fail-closed cho host deny không phân giải được.",
  ["unit-test", "egress", "sandbox", "nftables"], "complex");

const p46m = "packages/raptix/raptix/middleware/egress.py";
N(p46m, "_is_ip_or_cidr", "Kiểm tra token có parse được thành IP/CIDR (ipaddress.ip_network strict=False) để tách pattern scope.", ["egress", "parsing"], "simple");
N(p46m, "_classify", "Tách pattern scope thô thành cặp (CIDR literal, hostname/glob) phục vụ nftables và DNS allowlist.", ["egress", "parsing"], "simple");
N(p46m, "_rule_patterns", "Thu pattern từ danh sách ScopeRule qua network_scope_pattern, hỗ trợ chế độ deny cho out_of_scope.", ["egress", "roe"], "simple");
N(p46m, "_norm", "Chuẩn hoá danh sách địa chỉ: bỏ phần rỗng, dedupe, sort để policy deterministic.", ["egress", "normalization"], "simple");
N(p46m, "osint_egress_hosts", "Danh sách host tìm kiếm OSINT (duckduckgo) luôn được phép kể cả khi enforce in-scope allowlist; override bằng RAPTIX_OSINT_EGRESS_HOSTS, đặt rỗng để tắt.", ["egress", "osint", "env-config"], "simple");
N(p46m, "compile_egress_policy", "Biên dịch MachineEnforcement thành EgressPolicy: enforce chỉ ở chế độ ENFORCE, default_drop chỉ khi có in_scope, gộp forbidden destinations vào deny và nối OSINT hosts vào allow.", ["egress", "roe", "policy-compiler"], "moderate");

const p46s = "packages/raptix/raptix/sandbox_kernel/egress.py";
N(p46s, "EgressPolicy", "Dataclass frozen view biên mạng của scope RoE: enforce/default_drop + 4 tuple allowed/denied CIDR-host; to_dict/from_dict để serialise qua /provision_egress.", ["egress", "dataclass", "serialization"], "simple",
  "Frozen + slots, cố ý chỉ dùng stdlib (không raptix_core) để sống trong sandbox image.");
N(p46s, "EgressApplyResult", "Kết quả áp dụng egress: applied/enforce, nft_ruleset đã render, DNS allowlist, management CIDRs, IP host đã resolve và detail lỗi.", ["egress", "result", "dataclass"], "simple");
N(p46s, "_norm", "Chuẩn hoá danh sách địa chỉ: dedupe + sort.", ["egress", "normalization"], "simple");
N(p46s, "_split_family", "Tách địa chỉ thành nhóm IPv4/IPv6 để sinh rule daddr đúng họ.", ["egress", "ipv6"], "simple");
N(p46s, "_daddr_rules", "Sinh dòng 'ip/ip6 daddr { … } <verb>'; tách họ địa chỉ vì trộn IPv6 vào ip daddr là lỗi nft load.", ["egress", "nftables"], "simple");
N(p46s, "_wildcard_host", "Kiểm tra host chứa ký tự wildcard (* ? [ ]).", ["egress", "dns"], "simple");
N(p46s, "render_nftables", "Render ruleset 'nft -f' cho policy: table riêng add-then-delete để idempotent khi re-provision, policy drop/accept, loopback + management + resolver accept trước deny, denylist precedence trước scope allow; wildcard deny không resolve được bật deny_all_external.", ["egress", "nftables", "renderer"], "complex");
N(p46s, "render_dns_allowlist", "Danh sách hostname/wildcard in-scope mà resolver sandbox được trả lời; rỗng khi không enforce, loại host bị deny phủ (fnmatchcase).", ["egress", "dns"], "simple");
N(p46s, "discover_management_cidrs", "Phát hiện subnet on-link (management plane) — nguồn chính /proc/net/route, union 'ip -o route show' nếu binary tồn tại; loopback thêm vô điều kiện, hỏng thì degrade về loopback.", ["egress", "discovery", "management-plane"], "moderate");
N(p46s, "_proc_route_onlink_cidrs", "Parse /proc/net/route (hex little-endian): row gateway 00000000 là on-link, đổi Destination+Mask thành CIDR; bỏ default route và /0 để không tự mở internet.", ["egress", "proc-net", "parsing"], "moderate");
N(p46s, "_le_hex_to_ipv4", "Đổi word hex little-endian 8 ký tự của /proc thành dotted-quad.", ["egress", "parsing"], "simple");
N(p46s, "_read_ip_routes", "Chạy 'ip -o route show' làm nguồn phụ, timeout 5s, check=False.", ["egress", "subprocess"], "simple");
N(p46s, "discover_resolvers", "Đọc nameserver từ /etc/resolv.conf (Docker → 127.0.0.11) để resolver DNS luôn được phép.", ["egress", "dns", "discovery"], "simple");
N(p46s, "resolve_hosts", "Resolve best-effort hostname in-scope thành IP cho nft allowlist; bỏ qua wildcard (do DNS allowlist xử lý), nuốt lỗi resolve — host chưa được pre-authorise theo IP.", ["egress", "dns", "resolution"], "simple");
N(p46s, "_resolve_one", "getaddrinfo một host, trả danh sách IP.", ["egress", "dns"], "simple");
N(p46s, "apply_egress", "Điểm vào applier: phát hiện management/resolver, resolve host allow/deny (fail-closed nếu host deny không phân giải được), render ruleset rồi nạp bằng nft -f khi enabled và enforce; không bao giờ raise vào hot path — trả EgressApplyResult kèm detail.", ["egress", "nftables", "apply", "fail-safe"], "complex");
N(p46s, "_run_nft", "Runner mặc định: subprocess nft với stdin là ruleset, timeout 10s, check=False.", ["egress", "subprocess"], "simple");

const p46t1 = "packages/raptix/tests/unit/middleware/test_egress.py";
N(p46t1, "_rules", "Helper dựng MachineEnforcement.from_dict từ kwargs cho từng test.", ["test-helper"], "simple");
N(p46t1, "test_audit_mode_does_not_enforce", "Audit mode: compile_egress_policy trả policy enforce=False.", ["unit-test", "egress"], "simple");
N(p46t1, "test_warn_mode_does_not_enforce", "Warn mode cũng không bật enforce.", ["unit-test", "egress"], "simple");
N(p46t1, "test_enforce_with_in_scope_sets_default_drop", "ENFORCE + có in_scope → default_drop=True.", ["unit-test", "egress"], "simple");
N(p46t1, "test_in_scope_literal_ip_is_allowed_cidr", "IP/CIDR literal trong in_scope xếp vào allowed_cidrs.", ["unit-test", "egress"], "simple");
N(p46t1, "test_in_scope_host_and_glob_go_to_allowed_hosts", "Hostname và glob trong in_scope xếp vào allowed_hosts.", ["unit-test", "egress"], "simple");
N(p46t1, "test_signed_root_url_compiles_to_host_allowlist", "Signed root URL biên dịch thành host allowlist.", ["unit-test", "egress", "url"], "simple");
N(p46t1, "test_path_specific_url_cannot_open_egress", "URL có path cụ thể không được mở egress — chỉ origin được phép.", ["unit-test", "egress", "url"], "simple");
N(p46t1, "test_url_exclusion_denies_host_even_with_path", "URL exclusion từ chối host kể cả khi rule có path.", ["unit-test", "egress", "url"], "simple");
N(p46t1, "test_osint_search_providers_are_always_allowed", "Provider tìm kiếm OSINT luôn được nối vào allowed_hosts.", ["unit-test", "egress", "osint"], "simple");
N(p46t1, "test_cloud_metadata_denied_by_default", "Cloud metadata (169.254.169.254) bị deny mặc định qua effective_forbidden_destinations.", ["unit-test", "egress", "metadata"], "simple");
N(p46t1, "test_cloud_metadata_opt_out_removes_default_denies", "Opt-out cloud metadata xoá các deny mặc định.", ["unit-test", "egress", "metadata"], "simple");
N(p46t1, "test_out_of_scope_cidr_and_host_are_denied", "out_of_scope CIDR/host chuyển thành denied_cidrs/denied_hosts.", ["unit-test", "egress"], "simple");
N(p46t1, "test_enforce_without_in_scope_does_not_default_drop", "ENFORCE nhưng không in_scope → không default_drop, chỉ siết các deny.", ["unit-test", "egress"], "simple");
N(p46t1, "test_render_flushes_table_for_idempotent_reapply", "Render add-then-delete table để re-apply idempotent.", ["unit-test", "nftables"], "simple");
N(p46t1, "test_render_audit_mode_has_no_drop_policy", "Audit mode render chain output policy accept, không drop.", ["unit-test", "nftables"], "simple");
N(p46t1, "test_render_enforce_emits_drop_policy_and_management_allow", "Enforce render policy drop + accept loopback/management/resolver.", ["unit-test", "nftables"], "simple");
N(p46t1, "test_render_resolved_host_ips_added_to_allow_set", "IP đã resolve của host in-scope được nối vào allow set.", ["unit-test", "nftables", "dns"], "simple");
N(p46t1, "test_render_denies_precede_allows", "Rule deny đứng trước allow (denylist precedence).", ["unit-test", "nftables"], "simple");
N(p46t1, "test_render_allows_dns_resolver_for_name_resolution", "Resolver DNS được allow để tên vẫn phân giải được.", ["unit-test", "nftables", "dns"], "simple");
N(p46t1, "test_render_audit_mode_with_no_rules_is_valid_nonempty_script", "Audit + không rule vẫn render script nft hợp lệ, khác rỗng.", ["unit-test", "nftables"], "simple");
N(p46t1, "test_dns_allowlist_lists_in_scope_hosts_only", "DNS allowlist chỉ liệt kê host in-scope, loại host bị deny phủ.", ["unit-test", "dns"], "simple");
N(p46t1, "test_dns_allowlist_empty_when_not_enforcing", "Không enforce → DNS allowlist rỗng.", ["unit-test", "dns"], "simple");
N(p46t1, "test_egress_policy_is_frozen", "EgressPolicy frozen: gán thuộc tính bị chặn (FrozenInstanceError).", ["unit-test", "egress"], "simple");

const p46t2 = "packages/raptix/tests/unit/sandbox_kernel/test_egress_applier.py";
N(p46t2, "_enforce_policy", "Helper dựng EgressPolicy enforce+default_drop với allowed_cidrs tuỳ chọn.", ["test-helper"], "simple");
N(p46t2, "_OkProc", "Stub CompletedProcess thành công cho runner nft inject.", ["test-helper", "stub"], "simple");
N(p46t2, "_FailProc", "Stub CompletedProcess thất bại (returncode khác 0) cho runner nft inject.", ["test-helper", "stub"], "simple");
N(p46t2, "test_discover_management_cidrs_from_ip_route_onlink", "Union 'ip route' vào CIDR on-link phát hiện được khi binary tồn tại.", ["unit-test", "discovery"], "simple");
N(p46t2, "test_discover_management_cidrs_from_proc_route_no_ip_binary", "Không có binary ip: /proc/net/route vẫn ra subnet on-link 172.19.0.0/16 — đúng shape sandbox Kali thật.", ["unit-test", "discovery", "proc-net"], "simple");
N(p46t2, "test_discover_management_cidrs_survives_total_failure", "Cả hai nguồn hỏng → degrade về loopback, không raise vào apply.", ["unit-test", "discovery", "fail-safe"], "simple");
N(p46t2, "test_discover_management_cidrs_default_proc_path_is_readable", "Path /proc/net/route mặc định đọc được trên Linux.", ["unit-test", "discovery"], "simple");
N(p46t2, "test_discover_resolvers_reads_nameservers", "Đọc đúng nameserver từ nội dung resolv.conf giả lập.", ["unit-test", "dns"], "simple");
N(p46t2, "test_resolve_hosts_skips_wildcards_and_resolves_literals", "Bỏ qua wildcard, resolve host literal thành IP.", ["unit-test", "dns"], "simple");
N(p46t2, "test_apply_disabled_never_runs_nft", "enabled=False (RAPTIX_EGRESS_DISABLE): không đụng mạng, ruleset chỉ trả về để xem, management plane nguyên vẹn.", ["unit-test", "egress", "fail-safe"], "simple");
N(p46t2, "test_apply_audit_policy_does_not_run_nft_even_when_enabled", "Policy audit: dù enabled=True vẫn không nạp nft.", ["unit-test", "egress"], "simple");
N(p46t2, "test_apply_enabled_loads_ruleset_via_nft", "Enforce + enabled: ruleset nạp qua 'nft -f -', result applied=True.", ["unit-test", "nftables"], "simple");
N(p46t2, "test_apply_reports_nft_failure_without_raising", "nft lỗi: result applied=False kèm detail stderr, không raise.", ["unit-test", "nftables", "fail-safe"], "simple");
N(p46t2, "test_apply_resolves_allowed_hosts_into_nft_allow", "Host in-scope được resolve nối vào nft allow set.", ["unit-test", "nftables", "dns"], "simple");
N(p46t2, "test_denied_host_wins_over_allowed_host_and_cidr", "Host deny thắng host/CIDR allow — IP deny drop trước allow trong ruleset.", ["unit-test", "nftables", "precedence"], "simple");
N(p46t2, "test_wildcard_denied_host_fails_closed_without_dns_firewall", "Wildcard deny không resolve được → deny_all_external (fail closed).", ["unit-test", "egress", "fail-closed"], "simple");
N(p46t2, "test_unresolved_denied_host_fails_closed", "Host deny không phân giải được → fail closed toàn bộ external.", ["unit-test", "egress", "fail-closed"], "simple");
N(p46t2, "test_unresolved_cloud_metadata_alias_keeps_signed_target_reachable", "Alias metadata không resolve nhưng IP 169.254.169.254 đã nằm trong denied_cidrs → không fail closed toàn cục, target signed vẫn tới được.", ["unit-test", "egress", "metadata"], "simple");
N(p46t2, "test_render_matches_apply_disabled_ruleset", "Ruleset khi disabled trùng khớp render thuần — chỉ render, không nạp.", ["unit-test", "nftables"], "simple");

// ===== Batch 47 =====
F("packages/raptix/raptix/tools/browser/__init__.py",
  "Package browser session Playwright bền vững cho agent Raptix: expose browser_action — một LangChain tool multiplex cho SPA auth flow, OAuth callback, DOM-XSS verification; Playwright import lazily nên agent vẫn boot khi thiếu dependency.",
  ["browser", "playwright", "tools"], "simple",
  "Cài Playwright + Chromium trong sandbox image và wiring docker-compose thuộc PR sau, cố ý ngoài phạm vi thư viện này.");
F("packages/raptix/raptix/tools/browser/tools.py",
  "Triển khai browser_action: BrowserSessionManager singleton giữ state Playwright (browser/context/tabs/console buffer) serialize qua asyncio.Lock; 13 sub-action trả JSON, lỗi chuyển thành {\"error\": …} thay vì raise để agent loop tiếp tục; cleanup đóng có timeout và log đầy đủ.",
  ["browser", "playwright", "session-manager", "langchain-tool"], "complex");
F("packages/raptix/tests/unit/tools/test_browser.py",
  "Unit test BrowserSessionManager + dispatcher browser_action với Playwright mock: singleton, validate action/params, thiếu Playwright trả install hint, từng action (goto/click/type/screenshot/eval_js/console/page_source/tabs/close) và 'No active tab'.",
  ["unit-test", "browser", "playwright", "mocking"], "complex");
F("packages/raptix/tests/unit/tools/test_browser_cleanup.py",
  "Test cleanup bounded có log trong raptix.tools.browser.tools: _safe_close timeout 5s + log exception, close vẫn tiếp tục khi một page.close() raise và hoàn tất khi browser.close() treo.",
  ["unit-test", "browser", "cleanup", "timeout"], "moderate");

const p47i = "packages/raptix/raptix/tools/browser/__init__.py";
const p47t = "packages/raptix/raptix/tools/browser/tools.py";
N(p47t, "_safe_close", "Await obj.<method>() với timeout bounded (5s), log mọi timeout/exception — thay cho except-pass âm thầm để operator chẩn đoán được leak handle Playwright.", ["cleanup", "asyncio", "logging"], "moderate");
N(p47t, "BrowserActionError", "Lỗi nội bộ của manager, bắt ở biên tool và đổi thành JSON {\"error\": …} để LLM xử lý in-band (thiếu Playwright, trang đóng, timeout điều hướng, selector sai) mà không kết thúc run.", ["error-handling", "exception"], "simple");
N(p47t, "_Tab", "Dataclass một tab Playwright do manager theo dõi: page + console deque bounded 500 dòng để trang nói nhiều không làm phình memory.", ["dataclass", "console"], "simple");
N(p47t, "BrowserSessionManager", "Singleton per-process giữ state browser sống: launch Chromium headless, quản lý tabs dict + tab active, mọi method async serialize qua asyncio.Lock để các tool turn không interleaved navigation; close tuần tự page→context→browser→playwright qua _safe_close.", ["session-manager", "playwright", "singleton", "asyncio"], "complex");
N(p47t, "get_session_manager", "Trả singleton BrowserSessionManager toàn process (threading.Lock bảo trợ lazy init).", ["singleton", "factory"], "simple");
N(p47t, "_reset_session_manager_for_tests", "Test-only: drop singleton để mỗi test nhận manager mới.", ["test-helper"], "simple");
N(p47t, "_json", "Serialize dict thành chuỗi JSON indent=2, default=str, ensure_ascii=False.", ["json"], "simple");
N(p47t, "_dispatch", "Route action → method của manager: validate action thuộc _SUPPORTED_ACTIONS, ép kiểu tham số từ kwargs JSON, thiếu action lạ raise BrowserActionError.", ["dispatcher", "validation"], "moderate");
N(p47t, "browser_action", "LangChain @tool multiplex duy nhất điều khiển browser bền vững: parse params_json (JSON lỗi/không phải object trả error), dispatch tới manager và bọc mọi exception thành {\"error\": …} để agent loop tiếp tục.", ["langchain-tool", "multiplexer", "error-handling"], "moderate");

const p47ta = "packages/raptix/tests/unit/tools/test_browser.py";
N(p47ta, "_reset_singleton", "Fixture autouse reset singleton manager trước/sau mỗi test.", ["test-helper"], "simple");
N(p47ta, "_async_mock", "Helper tạo AsyncMock với giá trị trả về cho thuộc tính awaitable.", ["test-helper", "mocking"], "simple");
N(p47ta, "_fake_page", "Dựng MagicMock page Playwright giả: url, title, goto, click, fill, screenshot, evaluate, content, pdf, console event.", ["test-helper", "mocking"], "simple");
N(p47ta, "_fake_browser_chain", "Dựng chuỗi playwright→browser→context giả cho launch/close.", ["test-helper", "mocking"], "simple");
N(p47ta, "test_get_session_manager_is_singleton", "get_session_manager trả cùng instance gọi nhiều lần.", ["unit-test", "singleton"], "simple");
N(p47ta, "test_dispatcher_rejects_unknown_action", "Action lạ → error JSON liệt kê các action hỗ trợ.", ["unit-test", "dispatcher"], "simple");
N(p47ta, "test_dispatcher_rejects_bad_params_json", "params_json sai JSON → error kèm thông tin decode.", ["unit-test", "dispatcher"], "simple");
N(p47ta, "test_dispatcher_rejects_non_object_params", "params_json decode thành mảng/scalar → error 'must decode to a JSON object'.", ["unit-test", "dispatcher"], "simple");
N(p47ta, "test_missing_required_parameter_surfaces_as_error_json", "Thiếu tham số bắt buộc (url/selector/expression) → error 'missing required parameter', không crash.", ["unit-test", "dispatcher"], "simple");
N(p47ta, "test_missing_playwright_surfaces_install_hint", "Thiếu Playwright → error chỉ dẫn cài extra browser/playwright + chromium.", ["unit-test", "playwright"], "simple");
N(p47ta, "test_launch_starts_browser_and_creates_main_tab", "launch khởi động browser và tạo tab 'main' làm tab active.", ["unit-test", "browser"], "simple");
N(p47ta, "test_goto_returns_url_status_title", "goto điều hướng và trả url/status/title từ response Playwright.", ["unit-test", "browser"], "simple");
N(p47ta, "test_click_invokes_page_click", "click gọi page.click với selector + timeout_ms.", ["unit-test", "browser"], "simple");
N(p47ta, "test_type_invokes_page_fill", "type gọi page.fill với selector/text, delay_ms sleep tương ứng.", ["unit-test", "browser"], "simple");
N(p47ta, "test_screenshot_returns_base64_png", "screenshot trả base64 PNG kèm số bytes; full_page chuyển tiếp.", ["unit-test", "browser"], "simple");
N(p47ta, "test_eval_js_returns_result", "eval_js trả kết quả page.evaluate bọc trong JSON.", ["unit-test", "browser"], "simple");
N(p47ta, "test_console_logs_returns_captured_messages", "console_logs trả buffer console đã capture kèm count; clear=True xoá buffer.", ["unit-test", "browser", "console"], "simple");
N(p47ta, "test_page_source_returns_html_and_url", "page_source trả HTML + url + số bytes.", ["unit-test", "browser"], "simple");
N(p47ta, "test_list_tabs_and_switch_tab", "list_tabs liệt kê tab; switch_tab chuyển hoặc tạo tab mới khi id chưa tồn tại.", ["unit-test", "browser"], "simple");
N(p47ta, "test_close_resets_session_state", "close reset tabs/active và đóng browser qua manager.", ["unit-test", "browser", "cleanup"], "simple");
N(p47ta, "test_browser_tools_export", "BROWSER_TOOLS chứa đúng browser_action.", ["unit-test", "exports"], "simple");
N(p47ta, "test_active_tab_required_for_navigation", "Điều hướng khi chưa launch → error 'No active tab'.", ["unit-test", "browser"], "simple");

const p47tc = "packages/raptix/tests/unit/tools/test_browser_cleanup.py";
N(p47tc, "_reset_singleton", "Fixture autouse reset singleton manager trước/sau mỗi test.", ["test-helper"], "simple");
N(p47tc, "_propagate_decepticon_logger", "Patch logger 'raptix.tools.browser.tools' để assert các warning cleanup.", ["test-helper", "logging"], "simple");
N(p47tc, "test_safe_close_logs_raised_exception", "close() raise → _safe_close log warning kèm tên handle, không re-raise.", ["unit-test", "cleanup", "logging"], "simple");
N(p47tc, "test_safe_close_bounded_by_timeout", "Handle treo → asyncio.wait_for hủy sau timeout, log 'timed out', bỏ handle thay vì wedge cleanup.", ["unit-test", "cleanup", "timeout"], "simple");
N(p47tc, "test_close_continues_when_page_close_raises", "Một page.close() raise: các page còn lại + context/browser/playwright vẫn đóng theo thứ tự, state manager reset sạch.", ["unit-test", "cleanup", "resilience"], "moderate");
N(p47tc, "test_close_bounded_when_browser_close_hangs", "browser.close() treo → bị hủy sau 5s, close vẫn hoàn tất và manager reset sạch.", ["unit-test", "cleanup", "timeout"], "simple");

// ===== Batch 48 =====
F("packages/raptix/raptix/tools/network/__init__.py",
  "Bộ tool network reconnaissance của Raptix: re-export 16 tool từ 3 module con (scanners — port/service/OS/inventory, protocols — recon 8 giao thức, vulnerability — CVE + misconfiguration); mọi thao tác read-only, rate-limited, tuân RoE và scope.",
  ["network", "reconnaissance", "tools", "re-export"], "simple");
F("packages/raptix/raptix/tools/network/protocols.py",
  "Bộ tool recon theo giao thức bất đồng bộ: HTTP/HTTPS (aiohttp), DNS (dig), SMB (smbclient/nmblookup), RPC (rpcinfo), SNMP (snmpwalk), FTP (ftp/nc), SSH (ssh-keyscan/nc) — mỗi tool trả ProtocolResult kèm parser banner/output riêng; tôn trọng RoE và scope.",
  ["reconnaissance", "protocols", "asyncio", "banner-parsing"], "complex");
F("packages/raptix/raptix/tools/network/scanners.py",
  "Bộ scanner mạng: TCP connect scan asyncio có giới hạn concurrency, nmap (binary ngoài hoặc fallback Python), suy luận service từ banner, OS fingerprint (nmap -O hoặc TCP stack thủ công), network inventory theo profile; kèm bảng COMMON_PORTS/SERVICE_PORTS.",
  ["port-scan", "nmap", "os-fingerprint", "inventory"], "complex");
F("packages/raptix/raptix/tools/network/vulnerability.py",
  "Bộ tool đánh giá lỗ hổng: cve_scan đối chiếu service/version với DB KNOWN_VULNERABILITIES nội bộ, _check_misconfigurations quét pattern banner/credential/version cũ, security_misconfiguration_scan theo giao thức; xuất VulnerabilityScanReport (dict/JSON/markdown).",
  ["vulnerability", "cve", "misconfiguration", "reporting"], "complex");

const p48pr = "packages/raptix/raptix/tools/network/protocols.py";
N(p48pr, "ProtocolResult", "Dataclass kết quả recon một giao thức: target/port/protocol/success/data/error/timestamp + to_dict.", ["dataclass", "result"], "simple");
N(p48pr, "http_recon", "Recon HTTP: GET với UA/redirect/timeout/verify tuỳ chọn, trích status/headers/server/content-type/title/forms/links từ body (giới hạn 10KB) vào ProtocolResult.", ["http", "recon", "aiohttp"], "complex");
N(p48pr, "https_recon", "Wrapper HTTPS: gọi http_recon với use_https=True, verify_ssl mặc định False cho recon.", ["https", "recon"], "moderate");
N(p48pr, "dns_recon", "Recon DNS qua dig +short cho từng record type (A, AAAA, MX, TXT, CNAME, NS, SOA, PTR), tuỳ chọn dns_server; gộp bản ghi/lỗi vào data.queries.", ["dns", "recon", "subprocess"], "moderate");
N(p48pr, "smb_recon", "Recon SMB 445: smbclient -L null session liệt kê share, smbclient -V lấy phiên bản, nmblookup -A lấy NetBIOS name; parse share qua _parse_smb_shares.", ["smb", "recon", "null-session"], "complex");
N(p48pr, "_parse_smb_shares", "Parse output smbclient thành danh sách share (tên/loại/comment).", ["smb", "parsing"], "simple");
N(p48pr, "rpc_recon", "Recon RPC: rpcinfo -p liệt kê program/version/protocol/port từ endpoint mapper.", ["rpc", "recon", "subprocess"], "moderate");
N(p48pr, "_parse_rpcinfo_output", "Parse dòng rpcinfo thành entry service.", ["rpc", "parsing"], "simple");
N(p48pr, "snmp_recon", "Recon SNMP: snmpwalk với community/version tuỳ chọn lấy SYSTEM (sysDescr/sysName) và IF-MIB::ifDescr; parse qua _parse_snmp_output.", ["snmp", "recon", "community"], "moderate");
N(p48pr, "_parse_snmp_output", "Parse cặp OID/value từ output snmpwalk.", ["snmp", "parsing"], "simple");
N(p48pr, "ftp_recon", "Recon FTP 21: banner qua ftp/nc, thử anonymous login và liệt kê thư mục; parse banner qua _parse_ftp_banner.", ["ftp", "recon", "anonymous"], "moderate");
N(p48pr, "_parse_ftp_banner", "Trích server software/version từ banner FTP 220.", ["ftp", "parsing"], "simple");
N(p48pr, "ssh_recon", "Recon SSH 22: ssh-keyscan lấy host key, nc lấy banner; parse key và version qua _parse_ssh_key/_parse_ssh_version.", ["ssh", "recon", "banner"], "moderate");
N(p48pr, "_parse_ssh_key", "Parse dòng host key từ ssh-keyscan (loại key + fingerprint thô).", ["ssh", "parsing"], "simple");
N(p48pr, "_parse_ssh_version", "Trích protocol/product/version SSH (OpenSSH, Dropbear…) từ banner SSH-x.y.", ["ssh", "parsing"], "simple");

const p48sc = "packages/raptix/raptix/tools/network/scanners.py";
N(p48sc, "ScanResult", "Dataclass kết quả scan một port: state (open/closed/filtered/unknown), service/version/banner/timestamp/error + to_dict.", ["dataclass", "result"], "simple");
N(p48sc, "NetworkScanReport", "Report scan tổng hợp: target/scan_type/thời gian, danh sách ScanResult, summary thống kê; xuất to_dict/to_json/to_md (bảng port mở + chi tiết banner).", ["report", "markdown", "dataclass"], "moderate");
N(p48sc, "port_scan", "TCP connect scan bất đồng bộ: asyncio.open_connection + banner grab (500 ký tự), Semaphore giới hạn concurrency, TimeoutError→filtered, ConnectionRefused→closed.", ["tcp", "port-scan", "asyncio"], "complex");
N(p48sc, "_grab_banner", "Đọc banner từ StreamReader vừa kết nối (1024 byte, timeout 1s), decode bỏ lỗi.", ["banner", "asyncio"], "simple");
N(p48sc, "nmap_scan", "Entry nmap: shutil.which('nmap') → _nmap_scan_external, không có thì warning + fallback _python_nmap_scan.", ["nmap", "fallback"], "moderate");
N(p48sc, "_nmap_scan_external", "Chạy nmap CLI (-Pn, --max-retries 1, --host-timeout) qua subprocess và parse XML output.", ["nmap", "subprocess"], "moderate");
N(p48sc, "_python_nmap_scan", "Fallback khi thiếu nmap: port_scan Python trên port tuỳ chọn (mặc định COMMON_PORTS) rồi đóng gói NetworkScanReport với scan_method=python_connect_scan.", ["nmap", "fallback", "port-scan"], "moderate");
N(p48sc, "_parse_nmap_xml", "Parse XML nmap (-oX) thành ScanResult per host/port/service/version/banner.", ["nmap", "xml", "parsing"], "moderate");
N(p48sc, "service_version_scan", "Scan phiên bản service: nếu không chỉ định ports thì quick scan COMMON_PORTS tìm port mở trước, sau đó nmap -sV hoặc banner + detect service.", ["service-detection", "version"], "complex");
N(p48sc, "_detect_service_from_banner", "Suy luận service/version từ banner thô bằng mẫu regex cho HTTP/SSH/FTP/SMTP/MySQL/Redis…", ["banner", "fingerprint", "regex"], "complex");
N(p48sc, "os_fingerprint_scan", "Fingerprint OS: nmap -O khi có binary, fallback TCP stack fingerprinting thủ công.", ["os-fingerprint", "nmap"], "moderate");
N(p48sc, "_nmap_os_detection", "Chạy nmap OS detection và lấy kết luận OS guess từ XML.", ["nmap", "os-fingerprint"], "moderate");
N(p48sc, "_parse_nmap_os_output", "Parse phần OS trong XML nmap (name/accuracy/CPE).", ["nmap", "parsing"], "moderate");
N(p48sc, "_tcp_stack_fingerprinting", "Fingerprint TCP stack thủ công: TTL/window/MSS/options từ SYN-ACK suy đoán OS phổ biến.", ["tcp", "fingerprint"], "complex");
N(p48sc, "network_inventory", "Tổng hợp inventory: quét theo profile port (quick/full/web/database/management) cho danh sách targets, gộp thành báo cáo asset.", ["inventory", "asset-discovery"], "moderate");

const p48vu = "packages/raptix/raptix/tools/network/vulnerability.py";
N(p48vu, "Vulnerability", "Dataclass một lỗ hổng phát hiện được: id (CVE/tự đặt), title, severity, description, service/version ảnh hưởng, solution, references, CVSS score+vector + to_dict.", ["dataclass", "vulnerability"], "simple");
N(p48vu, "VulnerabilityScanReport", "Report scan lỗ hổng: danh sách Vulnerability, summary đếm theo severity; xuất dict/JSON/markdown (bảng sort severity + mục chi tiết từng CVE).", ["report", "markdown", "dataclass"], "moderate");
N(p48vu, "cve_scan", "Đối chiếu service/version với DB KNOWN_VULNERABILITIES (Apache, OpenSSH, MySQL…): khớp đúng affected_versions hoặc version cũ hơn tất cả bản bị ảnh hưởng — trả danh sách Vulnerability.", ["cve", "version-matching"], "complex");
N(p48vu, "_version_less_than", "So sánh chuỗi phiên bản đơn giản theo từng thành phần số.", ["versioning", "parsing"], "simple");
N(p48vu, "vulnerability_assessment", "Assessment tổng hợp: với mỗi ScanResult đang mở có service → cve_scan; bật thêm _check_misconfigurations; gộp thành VulnerabilityScanReport kèm summary theo severity.", ["assessment", "orchestration"], "moderate");
N(p48vu, "_check_misconfigurations", "Dò misconfig phổ biến từ COMMON_MISCONFIGURATIONS: pattern banner HTTP, default credential, version cũ (1.0/2.x/200x/201x), thiếu security header — mỗi match sinh Vulnerability.", ["misconfiguration", "checks", "regex"], "complex");
N(p48vu, "security_misconfiguration_scan", "Scan misconfig theo giao thức: chọn entry COMMON_MISCONFIGURATIONS khớp services rồi chạy các check_type (http/credentials/version), trả danh sách Vulnerability.", ["misconfiguration", "scan"], "moderate");

// ===== Batch 49 =====
F("clients/shared/streaming/src/types.ts",
  "Hợp đồng kiểu sự kiện streaming dùng chung: SubagentEventType (8 loại), SubagentCustomEvent payload thô từ StreamingRunnable.get_stream_writer() (khớp decepticon/core/subagent_streaming.py) và StreamEvent shape tối thiểu cho các utility shared — nguồn chân lý duy nhất cho cả Web và CLI.",
  ["streaming", "types", "contract", "subagent"], "moderate",
  "session_id là khóa nhóm theo-lần-gọi; id nullable của ask_user_question là tool_call_id dùng để dedupe lần emit thứ hai sau Command(resume=...).");
F("clients/shared/streaming/src/normalize.ts",
  "Normalizer thuần từ custom event thô của backend sang NormalizedSubagentEvent có shape chốt: snake_case→camelCase, drop field sai kiểu, giữ tri-state toolId/questionId (undefined/null/string) và toolPhase; không React/SDK — an toàn cho browser, CLI và node test.",
  ["streaming", "normalizer", "validation", "subagent"], "complex",
  "Không phải reducer hay transport (phạm vi W08): xử lý 1 event/lần, không drop/dedupe/re-truncate content; elapsed giữ nguyên đơn vị GIÂY.");
F("clients/shared/streaming/src/sessions.ts",
  "Dẫn xuất sub-agent session thuần từ event stream phẳng: quét cặp subagent_start/subagent_end, nhóm theo key sessionId::subagent (fallback tên agent cho stream cũ), đếm tool_result/bash_result và xác định status completed/error từ status hoặc error boolean.",
  ["streaming", "sessions", "grouping", "subagent"], "moderate",
  "Trích từ hook useSubAgentSessions của CLI để dùng chéo Web/CLI; key trước đây theo tên agent khiến 2 dispatch song song cùng agent bị gộp nhầm.");

const p49n = "clients/shared/streaming/src/normalize.ts";
N(p49n, "asOptions", "Lọc mảng options thô của ask_user_question: chỉ giữ entry có label+description là string, trả AskUserOption[] hoặc undefined.", ["validation", "ask-user"], "simple");
N(p49n, "normalizedEventKey", "Khoá định danh sự kiện chứng minh được: 'scope::type#id' khi có tool/question id, 'scope::type@createdAt' khi có timestamp hợp lệ, còn lại null — caller phải tự đánh chỉ số lần xảy ra thay vì coi event cùng loại là một.", ["identity", "dedup", "streaming"], "simple");
N(p49n, "normalizedGroupKey", "Khoá nhóm theo session: 'sessionId::agent', fallback từ sessionId về agent cho stream cũ — khớp semantics nhóm của deriveSubAgentSessions.", ["grouping", "streaming"], "simple");
N(p49n, "normalizeSubagentEvent", "Validate + normalize một raw custom event: reject nếu không phải object/type lạ/agent rỗng; map từng field snake_case→camelCase với kiểm tra kiểu per-field, giữ tri-state id, gắn toolPhase cho tool event.", ["normalizer", "validation", "streaming"], "complex");

const p49s = "clients/shared/streaming/src/sessions.ts";
N(p49s, "deriveSubAgentSessions", "Quét event stream phẳng để dựng SubAgentSession[] theo trình tự thời gian: subagent_start mở session (key sessionId::subagent), subagent_end chốt endTime/status (error từ status hoặc error boolean), event giữa chừng cộng vào eventIds/toolCount.", ["sessions", "grouping", "streaming"], "moderate");

// ===== Batch 50 =====
F("packages/raptix-sdk/raptix_sdk/scaffold/__init__.py",
  "Entry point plugin scaffolding của raptix-sdk (Phase 3 tách core/framework/sdk): re-export typer app để chạy 'raptix-sdk plugin new --kind=…' sinh ngay một plugin package build được cho 6 loại plugin.",
  ["sdk", "scaffold", "cli", "plugin"], "simple");
F("packages/raptix-sdk/raptix_sdk/scaffold/cli.py",
  "CLI typer 'raptix-sdk plugin new': nhận --kind/--name/--path/--force, chuẩn hoá tên module từ tên PyPI, sinh pyproject.toml + README.md + src/<module>/__init__.py wired đúng entry-point group, từ chối ghi đè khi thiếu --force.",
  ["sdk", "scaffold", "typer", "cli"], "moderate",
  "Ví dụ chạy: raptix-sdk plugin new --kind=middleware --name=my-plugin --path=./my-plugin; uv build; pip install dist/*.whl.");
F("packages/raptix-sdk/raptix_sdk/scaffold/templates.py",
  "Template inline cho scaffolder: 6 ScaffoldTemplate (tool, middleware, agent, callback, skill, prompt) chứa entry_point_group + stub module body + README, và pyproject_for sinh pyproject.toml chuẩn hatch để uv build; dùng string .format thay Jinja2 giữ SDK nhẹ.",
  ["sdk", "scaffold", "templates", "entry-points"], "moderate");

const p50c = "packages/raptix-sdk/raptix_sdk/scaffold/cli.py";
N(p50c, "_normalize_module_name", "Đổi tên plugin kiểu PyPI 'my-plugin' thành tên module 'my_plugin'.", ["naming", "normalization"], "simple");
N(p50c, "plugin_new", "Lệnh 'plugin new': validate kind trong TEMPLATES, chuẩn hoá module name, mkdir target/src, ghi pyproject.toml (pyproject_for), README và __init__.py từ template, từ chối ghi đè khi file tồn tại mà thiếu --force, rồi in hướng dẫn next steps (uv build, pip install).", ["scaffold", "cli", "codegen"], "moderate");

const p50t = "packages/raptix-sdk/raptix_sdk/scaffold/templates.py";
N(p50t, "ScaffoldTemplate", "Dataclass frozen một spec scaffold theo plugin kind: entry_point_group, stub module_body và readme_body.", ["dataclass", "template"], "simple");
N(p50t, "pyproject_for", "Sinh nội dung pyproject.toml cho plugin mới: tên PyPI, module, hatch build backend và entry-point group tương ứng kind.", ["scaffold", "pyproject", "codegen"], "moderate");

// ---------------------------------------------------------------- helpers
const isTestPath = (p) => /(^|\/)tests?\//.test(p) || /(^|\/)test_[^/]*$/.test(p);
const base = (p) => p.split("/").pop();

// ensure 3-5 tags per node: append a module-context tag when a node has < 3
const MODULE_TAG = [
  [/^packages\/raptix\/raptix\/middleware\/egress\.py$/, "policy"],
  [/^packages\/raptix\/raptix\/sandbox_kernel\/egress\.py$/, "sandbox"],
  [/^packages\/raptix\/tests\/unit\/middleware\//, "middleware"],
  [/^packages\/raptix\/tests\/unit\/sandbox_kernel\//, "sandbox"],
  [/^packages\/raptix\/raptix\/tools\/browser\//, "browser"],
  [/^packages\/raptix\/tests\/unit\/tools\/test_browser\.py$/, "browser"],
  [/^packages\/raptix\/tests\/unit\/tools\/test_browser_cleanup\.py$/, "browser"],
  [/^packages\/raptix\/raptix\/tools\/network\/protocols\.py$/, "recon"],
  [/^packages\/raptix\/raptix\/tools\/network\/scanners\.py$/, "scanning"],
  [/^packages\/raptix\/raptix\/tools\/network\/vulnerability\.py$/, "cve"],
  [/^clients\/shared\/streaming\//, "subagent"],
  [/^packages\/raptix-sdk\/raptix_sdk\/scaffold\//, "scaffold"],
];
const withTags = (node) => {
  if ((node.tags || []).length >= 3) return node;
  const rule = MODULE_TAG.find(([re]) => re.test(node.filePath));
  if (rule && !node.tags.includes(rule[1])) node.tags = [...node.tags, rule[1]];
  if ((node.tags || []).length < 3) {
    const extra = EXTRA_THIRD[node.name];
    if (extra && !node.tags.includes(extra)) node.tags = [...node.tags, extra];
  }
  return node;
};
const EXTRA_THIRD = {
  _rules: "egress",
  _enforce_policy: "egress",
  _reset_session_manager_for_tests: "singleton",
  _json: "serialization",
  _reset_singleton: "playwright",
  test_launch_starts_browser_and_creates_main_tab: "playwright",
  test_goto_returns_url_status_title: "playwright",
  test_click_invokes_page_click: "playwright",
  test_type_invokes_page_fill: "playwright",
  test_screenshot_returns_base64_png: "playwright",
  test_eval_js_returns_result: "playwright",
  test_page_source_returns_html_and_url: "playwright",
  test_list_tabs_and_switch_tab: "playwright",
  test_active_tab_required_for_navigation: "playwright",
  https_recon: "aiohttp",
  cve_scan: "recon",
};
const mkId = (type, p, name) => `${type}:${p}${type === "file" ? "" : ":" + name}`;

function metaFor(p, name, kind) {
  const m = NM[`${p}::${name}`];
  if (m) return m;
  // deterministic fallback so no node ships without a Vietnamese summary
  if (kind === "class")
    return { summary: `Lớp \`${name}\` trong ${base(p)}.`, tags: ["class"], complexity: "simple" };
  return {
    summary: `Hàm \`${name}\` trong ${base(p)}.`,
    tags: ["function"],
    complexity: "simple",
  };
}

function buildBatch(idx) {
  const bd = batches.batches.find((b) => b.batchIndex === idx);
  const ex = extractFor(idx);
  const byPath = new Map(ex.results.map((r) => [r.path, r]));

  const nodes = [];
  const edges = [];
  const seen = new Set();
  const addEdge = (source, target, type, weight) => {
    if (source === target) return;
    const k = `${type}|${source}|${target}`;
    if (seen.has(k)) return;
    seen.add(k);
    edges.push({ source, target, type, direction: "forward", weight });
  };

  // file nodes
  for (const f of bd.files) {
    const fm = FM[f.path] || {
      summary: `Tệp ${base(f.path)} (${f.language}).`,
      tags: [f.language || "file"],
      complexity: "simple",
    };
    const node = withTags({
      id: mkId("file", f.path),
      type: "file",
      name: base(f.path),
      filePath: f.path,
      summary: fm.summary,
      tags: fm.tags,
      complexity: fm.complexity,
    });
    if (fm.languageNotes) node.languageNotes = fm.languageNotes;
    nodes.push(node);
  }

  // symbol nodes + contains/exports edges
  const symNodes = new Map(); // path -> [{name,type,node}]
  for (const f of bd.files) {
    const r = byPath.get(f.path);
    if (!r) continue;
    const list = [];
    const fileId = mkId("file", f.path);
    for (const c of r.classes || []) {
      const meta = metaFor(f.path, c.name, "class");
      const node = withTags({
        id: mkId("class", f.path, c.name),
        type: "class",
        name: c.name,
        filePath: f.path,
        lineRange: [c.startLine, c.endLine],
        summary: meta.summary,
        tags: meta.tags,
        complexity: meta.complexity,
      });
      if (meta.languageNotes) node.languageNotes = meta.languageNotes;
      nodes.push(node);
      list.push({ name: c.name, type: "class", node });
      addEdge(fileId, node.id, "contains", 1);
      addEdge(fileId, node.id, "exports", 0.8);
    }
    for (const fn of r.functions || []) {
      const exported = (r.exports || []).some((e) => e.name === fn.name);
      const lines = fn.endLine - fn.startLine + 1;
      if (!exported && lines < 10) continue; // significance: exported OR 10+ lines
      const meta = metaFor(f.path, fn.name, "function");
      const node = withTags({
        id: mkId("function", f.path, fn.name),
        type: "function",
        name: fn.name,
        filePath: f.path,
        lineRange: [fn.startLine, fn.endLine],
        summary: meta.summary,
        tags: meta.tags,
        complexity: meta.complexity,
      });
      if (meta.languageNotes) node.languageNotes = meta.languageNotes;
      nodes.push(node);
      list.push({ name: fn.name, type: "function", node });
      addEdge(fileId, node.id, "contains", 1);
      addEdge(fileId, node.id, "exports", 0.8);
    }
    symNodes.set(f.path, list);
  }

  // imports edges 1:1 with batchImportData (+ tested_by reverse for test importers)
  let importCount = 0;
  for (const [src, deps] of Object.entries(bd.batchImportData)) {
    for (const dst of deps) {
      importCount++;
      addEdge(mkId("file", src), mkId("file", dst), "imports", 0.7);
      if (isTestPath(src)) addEdge(mkId("file", dst), mkId("file", src), "tested_by", 0.5);
    }
  }

  // calls edges from callGraphs (in-batch function/class targets only)
  const nameIndex = new Map(); // name -> [{path,type,node}]
  for (const [p, list] of symNodes) {
    for (const s of list) {
      if (!nameIndex.has(s.name)) nameIndex.set(s.name, []);
      nameIndex.get(s.name).push({ path: p, type: s.type, node: s.node });
    }
  }
  const resolveTarget = (callee, callerPath) => {
    const m = callee.match(/([A-Za-z_][A-Za-z0-9_]*)\s*$/);
    if (!m) return null;
    const cands = nameIndex.get(m[1]);
    if (!cands) return null;
    const same = cands.filter((c) => c.path === callerPath);
    if (same.length === 1) return same[0].node.id;
    if (same.length === 0 && cands.length === 1) return cands[0].node.id;
    return null; // ambiguous across files -> skip
  };
  for (const f of bd.files) {
    const r = byPath.get(f.path);
    if (!r || !r.callGraph) continue;
    const fns = new Map((symNodes.get(f.path) || []).map((s) => [s.name, s.node]));
    for (const call of r.callGraph) {
      const src = fns.get(call.caller);
      if (!src || src.type !== "function") continue;
      const tgtId = resolveTarget(call.callee, f.path);
      if (tgtId) addEdge(src.id, tgtId, "calls", 0.8);
    }
  }

  const out = { batchIndex: idx, batchFiles: bd.files, nodes, edges };
  const dest = `${UA}/intermediate/batch-${idx}.json`;
  fs.writeFileSync(dest, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(
    `batch-${idx}.json: files=${bd.files.length} nodes=${nodes.length} edges=${edges.length} ` +
      `(imports=${importCount}, byType=${edges.reduce((a, e) => ((a[e.type] = (a[e.type] || 0) + 1), a), {}) &&
        Object.entries(edges.reduce((a, e) => ((a[e.type] = (a[e.type] || 0) + 1), a), {}))
          .map(([k, v]) => k + "=" + v)
          .join(",")})`
  );
  return out;
}

for (const i of [46, 47, 48, 49, 50]) buildBatch(i);
