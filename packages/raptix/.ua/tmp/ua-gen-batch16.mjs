import { generate } from './ua-gen-engine.mjs';

const AD = 'raptix/tools/ad/';
const KG_STORE = 'raptix/middleware/kg_internal/store.py';

const files = {
  [AD + '__init__.py']: {
    summary: 'Barrel package cho bộ công cụ Active Directory: re-export các API audit ADCS, BloodHound, dcsync, delegation, GPO, Kerberos và shadow credentials.',
    tags: ['barrel', 'entry-point', 'active-directory', 'tools'],
    complexity: 'simple',
  },
  [AD + 'adcs.py']: {
    summary: 'Phân tích template và CA của ADCS từ dữ liệu BloodHound để phát hiện các đường leo thang đặc quyền ESC1–ESC13.',
    tags: ['active-directory', 'adcs', 'privilege-escalation', 'analysis'],
    complexity: 'complex',
    symbolTags: ['adcs', 'analysis', 'active-directory'],
  },
  [AD + 'adcs_post.py']: {
    summary: 'Hậu kiểm các phát hiện ADCS bằng truy vấn Cypher trên KG store (golden cert, ESC1/3/4/6, ESC13, ESC9, dcsync) và tổng hợp thành thống kê PostProcessStats.',
    tags: ['adcs', 'knowledge-graph', 'cypher', 'post-processing'],
    complexity: 'complex',
    symbolTags: ['adcs', 'knowledge-graph', 'cypher'],
  },
  [AD + 'bh_tools.py']: {
    summary: 'Ba tool LangChain thao tác BloodHound CE qua REST: kiểm tra trạng thái, chạy truy vấn Cypher và ingest file ZIP.',
    tags: ['bloodhound', 'tools', 'rest-client'],
    complexity: 'moderate',
    symbolTags: ['bloodhound', 'tool', 'rest-client'],
  },
  [AD + 'bhce_client.py']: {
    summary: 'REST client xác thực HMAC-SHA256 cho BloodHound CE, ký request theo spec tham chiếu Go và quản lý token xác thực.',
    tags: ['rest-client', 'hmac', 'bloodhound', 'authentication'],
    complexity: 'complex',
    symbolTags: ['bloodhound', 'rest-client', 'hmac'],
  },
  [AD + 'bloodhound.py']: {
    summary: 'Ingest dump BloodHound JSON/ZIP vào KG store: ánh xạ node/edge (ACE, membership, session, trust, GPO, local group, ADCS...) với provenance đầy đủ.',
    tags: ['bloodhound', 'ingest', 'knowledge-graph', 'active-directory'],
    complexity: 'complex',
    symbolTags: ['bloodhound', 'ingest', 'knowledge-graph'],
  },
  [AD + 'dcsync.py']: {
    summary: 'Xác định ứng viên dcsync từ KG: các principal có quyền replication (GetChanges/GetChangesAll) lên domain controller.',
    tags: ['active-directory', 'dcsync', 'knowledge-graph'],
    complexity: 'simple',
    symbolTags: ['dcsync', 'active-directory', 'knowledge-graph'],
  },
  [AD + 'delegation.py']: {
    summary: 'Phân tích các dạng Kerberos delegation (RBCD, constrained...) từ dữ liệu BloodHound và sinh DelegationFinding.',
    tags: ['active-directory', 'kerberos', 'delegation'],
    complexity: 'moderate',
    symbolTags: ['delegation', 'kerberos', 'active-directory'],
  },
  [AD + 'gpo.py']: {
    summary: 'Phát hiện lạm dụng GPO từ dữ liệu BloodHound: OU nhạy cảm, GPO áp dụng lên đối tượng quan trọng và thành viên nhóm có quyền.',
    tags: ['active-directory', 'gpo', 'privilege-escalation'],
    complexity: 'moderate',
    symbolTags: ['gpo', 'active-directory', 'analysis'],
  },
  [AD + 'kerberos.py']: {
    summary: 'Tiện ích Kerberos: parse ticket và phân loại hash hashcat (AS-REP, TGS-REP, Kerberoast) phục vụ cracking.',
    tags: ['kerberos', 'hashcat', 'parsing', 'active-directory'],
    complexity: 'moderate',
    symbolTags: ['kerberos', 'hashcat', 'parsing'],
  },
  [AD + 'shadow_creds.py']: {
    summary: 'Phát hiện shadow credentials: các principal có quyền Key Credential Link lên đối tượng khác, kỹ thuật leo thang qua certificate.',
    tags: ['active-directory', 'shadow-credentials', 'privilege-escalation'],
    complexity: 'simple',
    symbolTags: ['shadow-credentials', 'active-directory', 'analysis'],
  },
  [AD + 'tools.py']: {
    summary: 'Registry các tool LangChain cho domain Active Directory: bọc từng engine phân tích (ADCS, BloodHound, dcsync, GPO...) thành tool JSON-schema cho agent.',
    tags: ['tools', 'active-directory', 'langchain', 'entry-point'],
    complexity: 'moderate',
    symbolTags: ['tool', 'active-directory', 'langchain'],
  },
  'raptix/tools/research/graph.py': {
    summary: 'Shim tương thích: chuyển hướng import raptix.tools.research.graph sang KG store mới trong tools.research._state, kèm cảnh báo deprecation.',
    tags: ['compatibility', 'shim', 'knowledge-graph'],
    complexity: 'simple',
    symbolTags: ['compatibility', 'shim', 'knowledge-graph'],
  },
  'tests/unit/ad/test_ad.py': {
    summary: 'Kiểm thử đơn vị cho phân tích Kerberos ticket (hashcat) và template ADCS trên dữ liệu mẫu.',
    tags: ['test', 'kerberos', 'adcs'],
    complexity: 'moderate',
    symbolTags: ['test', 'fixture', 'ad'],
  },
  'tests/unit/ad/test_ad_tools.py': {
    summary: 'Kiểm thử cho gpo.py, delegation.py và shadow_creds.py trên graph BloodHound giả lập dựng từ helper node/edge.',
    tags: ['test', 'gpo', 'delegation', 'shadow-credentials'],
    complexity: 'complex',
    symbolTags: ['test', 'fixture', 'ad-tools'],
  },
  'tests/unit/ad/test_adcs_post.py': {
    summary: 'Kiểm thử các truy vấn hậu kiểm ADCS (ESC1–ESC13, golden cert, dcsync) trên KGStore giả với fixture Cypher chuẩn.',
    tags: ['test', 'adcs', 'cypher'],
    complexity: 'complex',
    symbolTags: ['test', 'adcs', 'cypher'],
  },
  'tests/unit/ad/test_bh_tools.py': {
    summary: 'Kiểm thử ba tool BloodHound CE với transport HTTP giả: status, cypher passthrough và luồng ingest ZIP 3 bước.',
    tags: ['test', 'bloodhound', 'tools'],
    complexity: 'moderate',
    symbolTags: ['test', 'bloodhound', 'bh-tools'],
  },
  'tests/unit/ad/test_bhce_client.py': {
    summary: 'Kiểm thử chữ ký HMAC của BHCEClient đối chiếu vector tham chiếu Go: canonical request, query string và giờ khóa theo giờ.',
    tags: ['test', 'hmac', 'signature'],
    complexity: 'moderate',
    symbolTags: ['test', 'hmac', 'bhce-client'],
  },
  'tests/unit/ad/test_bloodhound_kgstore.py': {
    summary: 'Kiểm thử toàn diện việc ingest BloodHound vào KGStore: ACE, session, trust 4 chiều, local group, GPO, user rights, SPN, RootCA, SID history.',
    tags: ['test', 'bloodhound', 'knowledge-graph'],
    complexity: 'complex',
    symbolTags: ['test', 'bloodhound', 'kgstore'],
  },
};

const symbols = {
  [AD + 'adcs.py::ADCSFinding']: { summary: 'Dataclass kết quả phát hiện ADCS, hỗ trợ to_dict để serialize vào báo cáo.', tags: ['data-model', 'adcs', 'serialization'] },
  [AD + 'adcs.py::_template_analysis']: { summary: 'Đánh giá từng certificate template: enrollable rights, ESC1–ESC4, yêu cầu phê duyệt quản trị và flag enrollment agent.', tags: ['adcs', 'privilege-escalation', 'analysis'] },
  [AD + 'adcs.py::_ca_analysis']: { summary: 'Đánh giá cấu hình CA: CASecurity, quyền rủi ro và các điều kiện ESC6–ESC13 trên cấp CA.', tags: ['adcs', 'ca', 'analysis'] },
  [AD + 'adcs.py::analyze_adcs_templates']: { summary: 'Entry point phân tích dữ liệu ADCS: gom findings từ template và CA, trả danh sách ADCSFinding.', tags: ['adcs', 'entry-point', 'analysis'] },

  [AD + 'adcs_post.py::PostProcessStats']: { summary: 'Dataclass thống kê kết quả hậu kiểm ADCS theo từng loại truy vấn Cypher.', tags: ['data-model', 'statistics', 'adcs'] },
  [AD + 'adcs_post.py::synthesise_adcs_post']: { summary: 'Chạy bộ truy vấn Cypher trên KGStore (golden cert, các kịch bản ESC, dcsync) và tổng hợp thành PostProcessStats.', tags: ['cypher', 'knowledge-graph', 'adcs'], complexity: 'complex' },

  [AD + 'bh_tools.py::bhce_status']: { summary: 'Kiểm tra trạng thái BloodHound CE: version, health và user đang xác thực.', tags: ['bloodhound', 'status', 'diagnostics'] },
  [AD + 'bh_tools.py::bhce_cypher']: { summary: 'Chạy truy vấn Cypher read-only trên BloodHound CE và trả kết quả JSON.', tags: ['bloodhound', 'cypher', 'query'] },
  [AD + 'bh_tools.py::bhce_ingest_zip']: { summary: 'Ingest file ZIP BloodHound CE theo trình tự start/poll/status, chờ đến trạng thái terminal.', tags: ['bloodhound', 'ingest', 'zip'] },
  [AD + 'bh_tools.py::_config_error']: { summary: 'Sinh thông báo lỗi cấu hình BHCE (thiếu env URL/token) kèm hướng dẫn khắc phục.', tags: ['error-handling', 'configuration'] },

  [AD + 'bhce_client.py::_rfc3339_now']: { summary: 'Sinh timestamp RFC3339 cắt về đầu giờ, dùng làm mốc tính chữ ký HMAC.', tags: ['time', 'hmac', 'utility'] },
  [AD + 'bhce_client.py::sign_request']: { summary: 'Ký request HTTP bằng HMAC-SHA256 theo spec BloodHound CE: method, path, query, body và timestamp khóa giờ.', tags: ['hmac', 'security', 'signature'], complexity: 'moderate' },
  [AD + 'bhce_client.py::BHCEHTTPError']: { summary: 'Exception HTTP kèm status code và body trả về từ BloodHound CE.', tags: ['error-handling', 'http'] },
  [AD + 'bhce_client.py::BHCEClient']: { summary: 'Client BloodHound CE đầy đủ: from_env, tự ký mọi request, gọi endpoint cypher/file-ingest/status và xử lý token.', tags: ['rest-client', 'bloodhound', 'api-client'], complexity: 'complex' },

  [AD + 'bloodhound.py::ImportStats']: { summary: 'Dataclass thống kê kết quả ingest BloodHound: số node, edge và cảnh báo.', tags: ['data-model', 'statistics'] },
  [AD + 'bloodhound.py::_IngestState']: { summary: 'Trạng thái buffer của phiên ingest: node/edge chờ ghi, cờ cấu hình và placeholder đã tạo.', tags: ['ingest', 'state'] },
  [AD + 'bloodhound.py::_node_kind_for_bh']: { summary: 'Ánh xạ loại đối tượng BloodHound sang node label của KG (user, group, computer, domain, CA...).', tags: ['mapping', 'normalization'] },
  [AD + 'bloodhound.py::_trust_edge_kind']: { summary: 'Tách trust BloodHound thành các edge KG riêng theo hướng và thuộc tính (trusting/trusted, SID filtering).', tags: ['trust', 'mapping'] },
  [AD + 'bloodhound.py::_ensure_placeholder']: { summary: 'Đảm bảo node placeholder tồn tại trong KG trước khi tạo edge tham chiếu tới nó.', tags: ['knowledge-graph', 'utility'] },
  [AD + 'bloodhound.py::_ingest_object']: { summary: 'Upsert một đối tượng BloodHound thành node KG với props đã chuẩn hóa.', tags: ['ingest', 'knowledge-graph'] },
  [AD + 'bloodhound.py::_ingest_aces']: { summary: 'Chuyển ACE thành các edge quyền (GenericAll, Owns, WriteDacl...) giữa principal và target.', tags: ['acl', 'privilege-escalation', 'ingest'] },
  [AD + 'bloodhound.py::_ingest_memberships']: { summary: 'Tạo edge MemberOf từ dữ liệu nhóm/membership của BloodHound.', tags: ['membership', 'ingest'] },
  [AD + 'bloodhound.py::_ingest_delegation_edges']: { summary: 'Ghi các quan hệ delegation Kerberos (RBCD, constrained) thành edge KG.', tags: ['kerberos', 'delegation', 'ingest'] },
  [AD + 'bloodhound.py::_ingest_sessions']: { summary: 'Ingest session đăng nhập; tùy cờ cấu hình có thể đảo chiều edge HasSession.', tags: ['sessions', 'ingest'] },
  [AD + 'bloodhound.py::_ingest_contained_by']: { summary: 'Ingest quan hệ container, hỗ trợ đảo chiều edge contained-by.', tags: ['container', 'ingest'] },
  [AD + 'bloodhound.py::_ingest_child_objects']: { summary: 'Ingest quan hệ child object thành edge KG tương ứng.', tags: ['ingest', 'mapping'] },
  [AD + 'bloodhound.py::_ingest_gp_links']: { summary: 'Ingest gpLink giữa OU/domain và GPO thành edge áp dụng chính sách.', tags: ['gpo', 'ingest'] },
  [AD + 'bloodhound.py::_ingest_spn_targets']: { summary: 'Tạo edge SPN target cho tài khoản có SPN (tiềm năng Kerberoast).', tags: ['kerberos', 'spn', 'ingest'] },
  [AD + 'bloodhound.py::_ingest_dump_smsa_password']: { summary: 'Ingest các edge rò rỉ mật khẩu SMSA từ dump BloodHound.', tags: ['credential', 'ingest'] },
  [AD + 'bloodhound.py::_ingest_root_ca_for']: { summary: 'Ingest quan hệ RootCA giữa enterprise CA và domain.', tags: ['adcs', 'ingest'] },
  [AD + 'bloodhound.py::_ingest_has_sid_history']: { summary: 'Ingest edge SID history phục vụ phát hiện leo thang qua SID history.', tags: ['sid-history', 'ingest'] },
  [AD + 'bloodhound.py::_rid_from_local_group_id']: { summary: 'Trích RID từ định danh local group của BloodHound.', tags: ['utility', 'parsing'] },
  [AD + 'bloodhound.py::_ingest_local_groups']: { summary: 'Ingest local group, member và ACL với xử lý RID ẩn danh và external member.', tags: ['local-group', 'ingest'], complexity: 'complex' },
  [AD + 'bloodhound.py::_ingest_gpo_changes']: { summary: 'Ingest thay đổi GPO thành node/edge phản vọng lịch sử chỉnh sửa chính sách.', tags: ['gpo', 'ingest'] },
  [AD + 'bloodhound.py::_ingest_user_rights']: { summary: 'Ingest user rights assignment (Logon privileged, Remote access...) thành edge KG.', tags: ['user-rights', 'ingest'] },
  [AD + 'bloodhound.py::_ingest_enterprise_ca_edges']: { summary: 'Ingest các edge liên quan enterprise CA trong đồ thị ADCS.', tags: ['adcs', 'ingest'] },
  [AD + 'bloodhound.py::_ingest_issuance_policy_link']: { summary: 'Ingest liên kết issuance policy của certificate template.', tags: ['adcs', 'ingest'] },
  [AD + 'bloodhound.py::_ingest_trusts']: { summary: 'Ingest domain trust với phân tách hướng và thuộc tính trust.', tags: ['trust', 'ingest'] },
  [AD + 'bloodhound.py::_merge_one_payload']: { summary: 'Merge một data blob BloodHound vào trạng thái ingest theo data type.', tags: ['merge', 'ingest'] },
  [AD + 'bloodhound.py::_merge_payload']: { summary: 'Merge toàn bộ payload BloodHound (nhiều data blob) vào trạng thái ingest.', tags: ['merge', 'ingest'] },
  [AD + 'bloodhound.py::merge_bloodhound_json']: { summary: 'Entry point merge payload BloodHound JSON vào KG store và trả ImportStats.', tags: ['entry-point', 'ingest', 'knowledge-graph'] },
  [AD + 'bloodhound.py::ingest_bloodhound_zip']: { summary: 'Entry point ingest file ZIP BloodHound: giải nén, merge từng JSON bên trong và flush lên KG.', tags: ['entry-point', 'ingest', 'zip'], complexity: 'complex' },
  [AD + 'bloodhound.py::_flush']: { summary: 'Đẩy buffer node/edge tích lũy lên KGStore theo lô và ghi provenance.', tags: ['flush', 'knowledge-graph'] },

  [AD + 'dcsync.py::dcsync_candidates']: { summary: 'Truy vấn KG để liệt kê principal có quyền Replication (GetChanges/GetChangesAll) trên domain — ứng viên dcsync.', tags: ['dcsync', 'knowledge-graph', 'query'], complexity: 'moderate' },

  [AD + 'delegation.py::DelegationFinding']: { summary: 'Dataclass kết quả phát hiện delegation, hỗ trợ to_dict cho báo cáo.', tags: ['data-model', 'delegation', 'serialization'] },
  [AD + 'delegation.py::analyze_delegation']: { summary: 'Phân tích các quan hệ delegation từ KG và sinh DelegationFinding kèm mức độ rủi ro.', tags: ['delegation', 'analysis', 'kerberos'], complexity: 'complex' },

  [AD + 'gpo.py::GPOFinding']: { summary: 'Dataclass kết quả phát hiện lạm dụng GPO, hỗ trợ to_dict cho báo cáo.', tags: ['data-model', 'gpo', 'serialization'] },
  [AD + 'gpo.py::analyze_gpo_abuse']: { summary: 'Truy vấn KG tìm GPO áp dụng lên OU nhạy cảm và thành viên có quyền sửa GPO, sinh GPOFinding.', tags: ['gpo', 'analysis', 'privilege-escalation'], complexity: 'complex' },

  [AD + 'kerberos.py::KerberosTicket']: { summary: 'Dataclass biểu diễn ticket Kerberos đã parse (user, service, thời gian, loại hash).', tags: ['data-model', 'kerberos'] },
  [AD + 'kerberos.py::classify_hashcat_hash']: { summary: 'Phân loại chuỗi hash Kerberos sang mode hashcat tương ứng (AS-REP roast, Kerberoast, LM...).', tags: ['hashcat', 'classification', 'kerberos'], complexity: 'moderate' },
  [AD + 'kerberos.py::parse_ticket']: { summary: 'Parse chuỗi ticket/hash Kerberos thành KerberosTicket kèm phân loại hashcat.', tags: ['kerberos', 'parsing'], complexity: 'moderate' },

  [AD + 'shadow_creds.py::ShadowCredsFinding']: { summary: 'Dataclass kết quả phát hiện shadow credentials, hỗ trợ to_dict cho báo cáo.', tags: ['data-model', 'shadow-credentials', 'serialization'] },
  [AD + 'shadow_creds.py::analyze_shadow_credentials']: { summary: 'Truy vấn KG tìm quan hệ Key Credential Link bất thường và sinh ShadowCredsFinding.', tags: ['shadow-credentials', 'analysis', 'privilege-escalation'] },

  [AD + 'tools.py::_warn_deprecated']: { summary: 'In cảnh báo deprecation cho các tool AD cũ.', tags: ['deprecation', 'utility'] },
  [AD + 'tools.py::_resolve_engagement']: { summary: 'Xác định engagement/workspace hiện tại từ context cho các tool AD.', tags: ['utility', 'engagement'] },
  [AD + 'tools.py::bh_ingest_zip']: { summary: 'Tool bọc ingest_bloodhound_zip: đọc ZIP BloodHound từ sandbox và ingest vào KG.', tags: ['tool', 'bloodhound', 'ingest'] },
  [AD + 'tools.py::bh_ingest_json']: { summary: 'Tool bọc merge_bloodhound_json: ingest payload BloodHound JSON trực tiếp.', tags: ['tool', 'bloodhound', 'json'] },
  [AD + 'tools.py::dcsync_check']: { summary: 'Tool liệt kê ứng viên dcsync từ KG và trả kết quả JSON cho agent.', tags: ['tool', 'dcsync'] },
  [AD + 'tools.py::kerberos_classify']: { summary: 'Tool phân loại hash Kerberos sang mode hashcat.', tags: ['tool', 'kerberos', 'hashcat'] },
  [AD + 'tools.py::adcs_audit']: { summary: 'Tool chạy phân tích ADCS và trả danh sách findings ESC.', tags: ['tool', 'adcs', 'audit'] },
  [AD + 'tools.py::delegation_audit']: { summary: 'Tool chạy phân tích delegation Kerberos trên KG.', tags: ['tool', 'delegation', 'audit'] },
  [AD + 'tools.py::gpo_audit']: { summary: 'Tool chạy phân tích lạm dụng GPO trên KG.', tags: ['tool', 'gpo', 'audit'] },
  [AD + 'tools.py::shadow_creds_audit']: { summary: 'Tool chạy phân tích shadow credentials trên KG.', tags: ['tool', 'shadow-credentials', 'audit'] },
  [AD + 'tools.py::adcs_post_process']: { summary: 'Tool chạy hậu kiểm ADCS (synthesise_adcs_post) và trả thống kê.', tags: ['tool', 'adcs', 'post-processing'] },

  'raptix/tools/research/graph.py::__getattr__': { summary: 'Chuyển hướng thuộc tính truy cập sang module tools.research._state, kèm cảnh báo deprecation.', tags: ['compatibility', 'shim'] },

  'tests/unit/ad/test_ad.py::TestKerberos': { summary: 'Bộ kiểm thử parse ticket và phân loại hash Kerberos.', tags: ['test', 'kerberos'] },
  'tests/unit/ad/test_ad.py::TestADCS': { summary: 'Bộ kiểm thử phân tích template ADCS với dữ liệu mẫu.', tags: ['test', 'adcs'] },

  'tests/unit/ad/test_adcs_post.py::_FakeKGStore': { summary: 'KGStore giả ghi nhận truy vấn Cypher và trả kết quả fixture cho test hậu kiểm ADCS.', tags: ['test-double', 'fixture', 'knowledge-graph'] },

  'tests/unit/ad/test_bloodhound_kgstore.py::_FakeKGStore': { summary: 'KGStore giả thu thập node/edge được ingest để assert ánh xạ BloodHound.', tags: ['test-double', 'fixture', 'knowledge-graph'] },
};

const calls = [
  { source: `function:${AD}tools.py:adcs_audit`, target: `function:${AD}adcs.py:analyze_adcs_templates` },
  { source: `function:${AD}tools.py:bh_ingest_zip`, target: `function:${AD}bloodhound.py:ingest_bloodhound_zip` },
  { source: `function:${AD}tools.py:dcsync_check`, target: `function:${AD}dcsync.py:dcsync_candidates` },
  { source: `function:${AD}tools.py:kerberos_classify`, target: `function:${AD}kerberos.py:classify_hashcat_hash` },
  { source: `function:${AD}tools.py:delegation_audit`, target: `function:${AD}delegation.py:analyze_delegation` },
  { source: `function:${AD}tools.py:gpo_audit`, target: `function:${AD}gpo.py:analyze_gpo_abuse` },
  { source: `function:${AD}tools.py:shadow_creds_audit`, target: `function:${AD}shadow_creds.py:analyze_shadow_credentials` },
  { source: `function:${AD}tools.py:adcs_post_process`, target: `function:${AD}adcs_post.py:synthesise_adcs_post` },
  { source: `function:${AD}bh_tools.py:bhce_ingest_zip`, target: `class:${AD}bhce_client.py:BHCEClient` },
  { source: `function:${AD}bh_tools.py:bhce_status`, target: `class:${AD}bhce_client.py:BHCEClient` },
  { source: `function:${AD}adcs_post.py:synthesise_adcs_post`, target: `class:${KG_STORE}:KGStore` },
];

generate(16, { files, symbols, calls });
