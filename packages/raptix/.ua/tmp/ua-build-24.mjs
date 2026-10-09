import { fileN, fnN, clsN, E, contains, exportsFrom, importEdges, input, finish } from './ua-helpers.mjs';

const MW = 'raptix/middleware/egress.py';
const SK = 'raptix/sandbox_kernel/egress.py';
const TMW = 'tests/unit/middleware/test_egress.py';
const TSK = 'tests/unit/sandbox_kernel/test_egress_applier.py';

const n24 = [
  fileN(MW,
    'Layer-2 egress guardrail phía agent: compile block machine_enforcement của roe.json thành EgressPolicy (allowed/denied CIDR + host, default_drop) để sandbox thi hành tại biên mạng; bổ sung allowlist OSINT search provider và re-export renderer từ sandbox_kernel.',
    ['security', 'egress', 'roe', 'middleware'], 'moderate',
    'Một định nghĩa scope, hai điểm thi hành: parser-side RoE middleware là fast-fail UX, còn nftables/DNS allowlist mới là biên authoritative.'),
  fileN(SK,
    'Applier egress phía sandbox (thuần stdlib): tái dựng EgressPolicy nhận qua /provision_egress, tự phát hiện management CIDR từ /proc/net/route, resolve host in-scope, render ruleset nftables + DNS allowlist và nạp bằng nft -f; fail-closed cho denied host chưa phân giải được.',
    ['security', 'nftables', 'sandbox', 'egress'], 'complex',
    'Chỉ dùng stdlib vì chạy trong sandbox image không có raptix_core; management plane luôn được phát hiện cục bộ để scope rule không thể cắt kết nối agent↔management (Neo4j, daemon, DNS).'),
  fileN(TMW,
    'Kiểm thử compile_egress_policy: audit/warn không thi hành, enforce bật default_drop, phân loại CIDR/host, URL ký sign không mở egress, deny ưu tiên allow và chính sách OSINT/cloud metadata.',
    ['test', 'egress', 'policy'], 'moderate'),
  fileN(TSK,
    'Kiểm thử applier egress sandbox: phát hiện management CIDR từ ip route//proc, resolve hosts, nạp nft -f với runner giả, fail-closed cho denied host và trường hợp cloud metadata alias.',
    ['test', 'nftables', 'egress', 'fail-closed'], 'complex'),

  fnN(MW, 'compile_egress_policy', [102, 133],
    'Compile MachineEnforcement thành EgressPolicy: chỉ enforce ở chế độ ENFORCE, default_drop chỉ khi có in_scope allowlist, tách CIDR/host cho allow/deny và ghép OSINT hosts vào allowed_hosts.',
    ['policy', 'compiler', 'security'], 'moderate'),

  clsN(SK, 'EgressPolicy', [48, 86],
    'Frozen dataclass là góc nhìn mạng của MachineEnforcement: enforce, default_drop và 4 tập allowed/denied CIDR+host; serialize to_dict/from_dict để truyền qua /provision_egress.',
    ['data-model', 'policy', 'serialization'], 'simple'),
  fnN(SK, '_split_family', [104, 113],
    'Tách địa chỉ thành family v4/v6 và chuẩn hoá CIDR cho ruleset nftables.',
    ['utility', 'ip'], 'simple'),
  fnN(SK, '_daddr_rules', [116, 128],
    'Sinh các dòng rule daddr nftables cho một tập địa chỉ, tách theo family v4/v6.',
    ['nftables', 'utility'], 'simple'),
  fnN(SK, 'render_nftables', [135, 191],
    'Render toàn bộ ruleset nftables inet decepticon_egress: flush table để re-apply an toàn, drop cloud metadata/out-of-scope trước allow (đảm bảo deny precedence), cho phép management CIDR, resolver và IP host đã resolve.',
    ['nftables', 'render', 'security'], 'complex'),
  fnN(SK, 'render_dns_allowlist', [194, 205],
    'Render danh sách hostname in-scope cho DNS allowlist của sandbox resolver (rỗng khi không enforcing).',
    ['dns', 'render', 'security'], 'simple'),
  fnN(SK, 'discover_management_cidrs', [208, 248],
    'Phát hiện management subnet từ /proc/net/route (fallback ip route onlink); không bao giờ raise — trả danh sách an toàn khi mọi nguồn lỗi.',
    ['discovery', 'network', 'robustness'], 'moderate'),
  fnN(SK, '_proc_route_onlink_cidrs', [251, 286],
    'Parse /proc/net/route hex little-endian thành CIDR onlink cho gateway/interface route khi image không có binary ip.',
    ['parser', 'network', 'utility'], 'moderate'),
  fnN(SK, 'discover_resolvers', [307, 320],
    'Đọc nameserver từ /etc/resolv.conf để firewall cho phép DNS resolution.',
    ['dns', 'discovery'], 'simple'),
  fnN(SK, 'resolve_hosts', [323, 344],
    'Resolve các host in-scope (wildcard/literal) thành IP cụ thể đưa vào allowlist; bỏ qua wildcard khi DNS firewall không đảm bảo và giới hạn số lượng.',
    ['dns', 'resolution', 'security'], 'moderate'),
  fnN(SK, 'apply_egress', [352, 443],
    'Áp dụng egress trong sandbox: opt-out bằng RAPTIX_EGRESS_DISABLE, audit mode không chạy nft, fold management plane + resolver + IP đã resolve vào policy, render nftables và nạp bằng nft -f; trả EgressApplyResult chi tiết, không raise.',
    ['nftables', 'apply', 'fail-closed'], 'complex'),
  fnN(SK, '_run_nft', [446, 454],
    'Thực thi nft -f với runner có thể inject để unit test không cần nft thật.',
    ['subprocess', 'nftables', 'utility'], 'simple'),

  fnN(TMW, 'test_url_exclusion_denies_host_even_with_path', [70, 78],
    'Test URL exclusion biến thành denied host kể cả khi host cũng khớp allowlist theo path.',
    ['test', 'policy'], 'simple'),
  fnN(TMW, 'test_out_of_scope_cidr_and_host_are_denied', [114, 123],
    'Test CIDR/host ngoài scope đều bị đưa vào denied của policy.',
    ['test', 'policy'], 'simple'),

  fnN(TSK, 'test_discover_management_cidrs_from_ip_route_onlink', [43, 56],
    'Test phát hiện management CIDR từ output ip route với route onlink.',
    ['test', 'discovery'], 'simple'),
  fnN(TSK, 'test_discover_management_cidrs_from_proc_route_no_ip_binary', [59, 71],
    'Test fallback parse /proc/net/route khi sandbox image không có binary ip.',
    ['test', 'discovery', 'robustness'], 'simple'),
  fnN(TSK, 'test_apply_disabled_never_runs_nft', [108, 126],
    'Test enabled=False (RAPTIX_EGRESS_DISABLE) không bao giờ chạy nft dù policy enforcing.',
    ['test', 'apply'], 'simple'),
  fnN(TSK, 'test_apply_audit_policy_does_not_run_nft_even_when_enabled', [129, 146],
    'Test policy audit mode không thi hành nftables dù enabled.',
    ['test', 'apply'], 'simple'),
  fnN(TSK, 'test_apply_enabled_loads_ruleset_via_nft', [155, 175],
    'Test enforcing policy render ruleset và nạp qua nft -f với runner giả.',
    ['test', 'apply', 'nftables'], 'simple'),
  fnN(TSK, 'test_apply_reports_nft_failure_without_raising', [184, 194],
    'Test nft thất bại được báo cáo trong EgressApplyResult thay vì raise.',
    ['test', 'error-handling'], 'simple'),
  fnN(TSK, 'test_apply_resolves_allowed_hosts_into_nft_allow', [197, 214],
    'Test host in-scope được resolve thành IP và đưa vào allow set của ruleset.',
    ['test', 'resolution', 'nftables'], 'moderate'),
  fnN(TSK, 'test_denied_host_wins_over_allowed_host_and_cidr', [217, 244],
    'Test denied host luôn thắng allowed host và allowed CIDR (deny precedence).',
    ['test', 'fail-closed', 'security'], 'moderate'),
  fnN(TSK, 'test_wildcard_denied_host_fails_closed_without_dns_firewall', [247, 264],
    'Test wildcard denied host fail-closed khi không có DNS firewall.',
    ['test', 'fail-closed', 'security'], 'moderate'),
  fnN(TSK, 'test_unresolved_denied_host_fails_closed', [267, 283],
    'Test denied host không resolve được IP vẫn bị fail-closed.',
    ['test', 'fail-closed'], 'simple'),
  fnN(TSK, 'test_unresolved_cloud_metadata_alias_keeps_signed_target_reachable', [286, 310],
    'Test alias cloud metadata trỏ tới target đã ký sign vẫn giữ target reach được (không nhầm với metadata IP bị chặn).',
    ['test', 'edge-case', 'security'], 'moderate'),
  fnN(TSK, 'test_render_matches_apply_disabled_ruleset', [313, 323],
    'Test ruleset render khớp với ruleset apply khi policy disabled.',
    ['test', 'render'], 'simple'),
];

const e24 = [];
for (const n of n24) e24.push(contains(n));
for (const n of n24) {
  if (n.type === 'file') continue;
  if (n.filePath === MW && n.name === 'compile_egress_policy') e24.push(exportsFrom(n));
  if (n.filePath === SK && ['EgressPolicy', 'render_nftables', 'render_dns_allowlist', 'apply_egress'].includes(n.name)) e24.push(exportsFrom(n));
}
for (const e of importEdges(input(24).batchImportData)) e24.push(e);
e24.push(
  E(`file:${MW}`, `file:${TMW}`, 'tested_by'),
  E(`file:${MW}`, `file:${TSK}`, 'tested_by'),
  E(`file:${SK}`, `file:${TSK}`, 'tested_by'),
);

finish(24, n24, e24);
