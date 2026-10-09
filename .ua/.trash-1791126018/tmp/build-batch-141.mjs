import fs from 'fs';

const UA = 'D:/.VTNet/redteam/raptix/.ua';
const b = JSON.parse(fs.readFileSync(`${UA}/intermediate/batches.json`, 'utf8'));
const bt = b.batches.find(x => x.batchIndex === 141);
const P = 'packages/raptix/raptix/skills/defs/standard/';

const nodes = [];
const edges = [];
const E = (source, target, type, weight) => edges.push({ source, target, type, direction: 'forward', weight });

// ---- File-level nodes (24 documents + 1 code file) ----
const D = (rel, name, summary, tags, complexity, notes) => {
  nodes.push({ id: `document:${P}${rel}`, type: 'document', name, filePath: `${P}${rel}`, summary, tags, complexity, ...(notes ? { languageNotes: notes } : {}) });
};

D('soundwave/threat-profile/emulation/sandworm/SKILL.md', 'SKILL.md',
  'Playbook adversary-emulation cho nhóm Sandworm (APT44 / Seashell Blizzard, GRU Unit 74455): xâm nhập IT→OT kết thúc bằng tác động phá hoại ICS; mọi bước destructive/ICS-write đều giới hạn lab canary và cần phê duyệt operator + kỹ sư OT.',
  ['adversary-emulation', 'threat-profile', 'ics-ot', 'safety-critical', 'documentation'], 'moderate');
D('soundwave/threat-profile/emulation/scattered-spider/SKILL.md', 'SKILL.md',
  'Playbook adversary-emulation cho Scattered Spider (UNC3944 / Octo Tempest): vishing qua help desk, chiếm MFA, leo thang đặc quyền trên cloud/SaaS identity, persistence qua RMM và tống tiền bằng đánh cắp dữ liệu.',
  ['adversary-emulation', 'threat-profile', 'social-engineering', 'identity', 'documentation'], 'moderate');
D('soundwave/threat-profile/emulation/volt-typhoon/SKILL.md', 'SKILL.md',
  'Playbook adversary-emulation cho Volt Typhoon (Vanguard Panda, PRC): initial access qua thiết bị biên giới, hoạt động living-off-the-land thuần túy, đánh cắp credential NTDS và tiền định vị dài hạn vào hạ tầng trọng yếu qua proxy nhiều chặng.',
  ['adversary-emulation', 'threat-profile', 'lotl', 'critical-infrastructure', 'documentation'], 'moderate');
D('soundwave/threat-profile/references/adversary-archetypes.md', 'adversary-archetypes.md',
  'Bộ archetype mối đe dọa dựng sẵn theo ba tier (cơ hội, có tổ chức, nation-state) dạng JSON seed kèm hồ sơ hành vi, phục vụ việc khởi tạo threat-profile cho các kịch bản engagement phổ biến.',
  ['threat-profile', 'reference', 'archetypes', 'mitre', 'documentation'], 'moderate');
D('soundwave/threat-profile/references/apt-groups.md', 'apt-groups.md',
  'Sổ tay tham chiếu nhanh các nhóm APT nổi tiếng (APT29, APT41, Sandworm, Scattered Spider, Volt Typhoon…) với attribution, mục tiêu, động cơ và bảng TTP MITRE theo ngành, dùng để chọn actor mô phỏng phù hợp với threat model của khách hàng.',
  ['threat-profile', 'reference', 'apt', 'mitre', 'documentation'], 'complex');
D('supply-chain/SKILL.md', 'SKILL.md',
  'Catalog kỹ năng operator cho mô phỏng tấn công chuỗi cung ứng: typosquatting package, dependency confusion, đào secret qua GitHub Actions, đầu độc internal mirror và giả mạo OAuth-app, mặc định publish vào mock registry cục bộ.',
  ['supply-chain', 'skill-catalog', 'typosquatting', 'safety-critical', 'documentation'], 'moderate');
D('surface_exploit/authn_jwt/SKILL.md', 'SKILL.md',
  'Cell Surface Exploit giới hạn phạm vi: xác nhận lỗi xác thực/JWT trên đúng một endpoint và parameter được phân công, không dump dữ liệu hay chuyển lớp lỗ hổng khác.',
  ['adversary-emulation', 'web-exploitation', 'jwt', 'bounded-scope', 'documentation'], 'simple');
D('surface_exploit/authz/SKILL.md', 'SKILL.md',
  'Cell Surface Exploit giới hạn phạm vi: xác nhận lỗi phân quyền (authorization bypass) trên một endpoint/parameter được phân công theo luồng xác nhận có kiểm soát.',
  ['adversary-emulation', 'web-exploitation', 'authorization', 'bounded-scope', 'documentation'], 'simple');
D('surface_exploit/graphql/SKILL.md', 'SKILL.md',
  'Cell Surface Exploit giới hạn phạm vi: xác nhận lỗ hổng trên bề mặt GraphQL (introspection, injection) cho đúng mục tiêu được phân công.',
  ['adversary-emulation', 'web-exploitation', 'graphql', 'bounded-scope', 'documentation'], 'simple');
D('surface_exploit/idor/SKILL.md', 'SKILL.md',
  'Cell Surface Exploit giới hạn phạm vi: xác nhận IDOR trên đúng một endpoint/parameter được phân công, giữ nguyên baseline và exchange ID.',
  ['adversary-emulation', 'web-exploitation', 'idor', 'bounded-scope', 'documentation'], 'simple');
D('surface_exploit/open_redirect/SKILL.md', 'SKILL.md',
  'Cell Surface Exploit giới hạn phạm vi: xác nhận open redirect trên một URL/parameter được phân công theo luồng xác nhận có giới hạn.',
  ['adversary-emulation', 'web-exploitation', 'open-redirect', 'bounded-scope', 'documentation'], 'simple');
D('surface_exploit/sqli/SKILL.md', 'SKILL.md',
  'Cell Surface Exploit giới hạn phạm vi: xác nhận SQL injection trên đúng một endpoint và parameter được phân công, phải nạp skill SQLi chính trước khi probe và không dump dữ liệu.',
  ['adversary-emulation', 'web-exploitation', 'sqli', 'bounded-scope', 'documentation'], 'simple');
D('surface_exploit/ssrf/SKILL.md', 'SKILL.md',
  'Cell Surface Exploit giới hạn phạm vi: xác nhận SSRF trên một endpoint/parameter được phân công theo luồng xác nhận bounded.',
  ['adversary-emulation', 'web-exploitation', 'ssrf', 'bounded-scope', 'documentation'], 'simple');
D('surface_exploit/ssti/SKILL.md', 'SKILL.md',
  'Cell Surface Exploit giới hạn phạm vi: xác nhận server-side template injection trên một endpoint/parameter được phân công.',
  ['adversary-emulation', 'web-exploitation', 'ssti', 'bounded-scope', 'documentation'], 'simple');
D('surface_exploit/xss/SKILL.md', 'SKILL.md',
  'Cell Surface Exploit giới hạn phạm vi: xác nhận XSS trên một endpoint/parameter được phân công theo luồng xác nhận có kiểm soát.',
  ['adversary-emulation', 'web-exploitation', 'xss', 'bounded-scope', 'documentation'], 'simple');
D('surface_exploit/xxe/SKILL.md', 'SKILL.md',
  'Cell Surface Exploit giới hạn phạm vi: xác nhận XML external entity injection trên một endpoint/parameter được phân công.',
  ['adversary-emulation', 'web-exploitation', 'xxe', 'bounded-scope', 'documentation'], 'simple');
D('wireless/SKILL.md', 'SKILL.md',
  'Index định tuyến cấp cao cho bộ kỹ năng tấn công không dây 802.11: điều hướng WirelessOperator tới skill lá đúng theo cột mã hóa của AP mục tiêu (PSK/SAE/MGT/WPS) và ghi chú BLE/Zigbee thuộc suite iot/.',
  ['wireless', 'skill-catalog', 'routing-index', '802.11', 'documentation'], 'moderate');
D('wireless/deauth-pmf/SKILL.md', 'SKILL.md',
  'Skill lá không dây: deauth có mục tiêu để ép client reconnect và đánh giá tư thế bảo vệ 802.11w/PMF của mạng mục tiêu.',
  ['wireless', 'deauth', 'pmf', 'skill', 'documentation'], 'moderate');
D('wireless/evil-twin-karma/SKILL.md', 'SKILL.md',
  'Skill lá không dây: dựng rogue AP kiểu evil-twin/Karma khai thác PNL leakage và captive portal để thu thập credential của client.',
  ['wireless', 'evil-twin', 'karma', 'rogue-ap', 'documentation'], 'moderate');
D('wireless/krack-fragattacks/SKILL.md', 'SKILL.md',
  'Skill lá không dây: kiểm tra key-reinstallation (KRACK) và fragmentation attacks chống supplicant legacy/nhúng.',
  ['wireless', 'krack', 'fragmentation', 'skill', 'documentation'], 'moderate');
D('wireless/wpa-enterprise-eap/SKILL.md', 'SKILL.md',
  'Skill lá không dây: tấn công WPA-Enterprise/802.1X qua các vector EAP (evil-twin RADIUS, credential harvesting) cho cột mã hóa MGT.',
  ['wireless', 'wpa-enterprise', 'eap', '802.1x', 'documentation'], 'moderate');
D('wireless/wpa2-psk/SKILL.md', 'SKILL.md',
  'Skill lá không dây: bắt WPA2-PSK four-way handshake hoặc PMKID (không cần deauth) rồi crack offline bằng hashcat; hai đường acquisition PMKID ưu tiên vì OPSEC-quiet.',
  ['wireless', 'wpa2', 'handshake', 'pmkid', 'hashcat'], 'moderate');
D('wireless/wpa3-sae/SKILL.md', 'SKILL.md',
  'Skill lá không dây: đánh giá WPA3-SAE gồm downgrade sang WPA2, timing/dragonfly leak và transition-mode abuse.',
  ['wireless', 'wpa3', 'sae', 'downgrade', 'documentation'], 'moderate');
D('wireless/wps-pixie-dust/SKILL.md', 'SKILL.md',
  'Skill lá không dây: khai thác WPS Pixie Dust để thu PIN/Psk khẩu khỏi AP bật WPS, dựa trên wash/reaver.',
  ['wireless', 'wps', 'pixie-dust', 'skill', 'documentation'], 'moderate');

// ---- Code file + functions ----
const FILE = 'packages/raptix/raptix/skills/engine/builder/stix_bootstrap.py';
nodes.push({
  id: `file:${FILE}`, type: 'file', name: 'stix_bootstrap.py', filePath: FILE,
  summary: 'Bootstrap bundle MITRE STIX pin sẵn: tải xuống, xác minh SHA-256 theo pin, tái sử dụng bundle hợp lệ hiện có và thay thế nguyên tử qua file tạm — phục vụ check-skill-graph trong CI.',
  tags: ['bootstrap', 'stix', 'integrity', 'download', 'builder'], complexity: 'moderate',
  languageNotes: 'Dùng tempfile + Path.replace để ghi nguyên tử, tránh bundle hỏng khi tải đứt giữa chừng.'
});
const FN = (name, start, end, summary, tags, complexity) => {
  nodes.push({ id: `function:${FILE}:${name}`, type: 'function', name, filePath: FILE, lineRange: [start, end], summary, tags, complexity });
  E(`file:${FILE}`, `function:${FILE}:${name}`, 'contains', 1.0);
  E(`file:${FILE}`, `function:${FILE}:${name}`, 'exports', 0.8);
};
FN('default_bundle_path', 25, 32, 'Trả về đường dẫn bundle STIX mặc định từ biến môi trường, fallback về ~/.cache/raptix.', ['path-resolution', 'env-config', 'utility'], 'simple');
FN('sha256_file', 35, 41, 'Tính SHA-256 của file theo chunk để xác minh tính toàn vẹn của bundle STIX.', ['hashing', 'integrity', 'utility'], 'simple');
FN('_validate_hash', 44, 50, 'Đối chiếu SHA-256 thực tế của file với giá trị pin, raise ValueError khi lệch.', ['validation', 'integrity', 'internal'], 'simple');
FN('ensure_stix_bundle', 53, 82, 'Đảm bảo bundle STIX tồn tại: tái sử dụng file hợp lệ, còn thiếu thì tải từ URL pin vào file tạm, xác minh hash rồi replace nguyên tử; dọn file tạm khi lỗi.',
  ['bootstrap', 'download', 'integrity', 'atomic-write'], 'moderate');

// ---- Edges: tested_by (neighborMap), related (non-code) ----
E(`file:${FILE}`, 'file:packages/raptix/tests/unit/skillogy/test_stix_bootstrap.py', 'tested_by', 0.5);
E(`document:${P}soundwave/threat-profile/emulation/sandworm/SKILL.md`, `document:${P}soundwave/threat-profile/references/apt-groups.md`, 'related', 0.5);
E(`document:${P}soundwave/threat-profile/emulation/volt-typhoon/SKILL.md`, `document:${P}soundwave/threat-profile/references/apt-groups.md`, 'related', 0.5);
for (const leaf of ['deauth-pmf', 'evil-twin-karma', 'krack-fragattacks', 'wpa-enterprise-eap', 'wpa2-psk', 'wpa3-sae', 'wps-pixie-dust']) {
  E(`document:${P}wireless/SKILL.md`, `document:${P}wireless/${leaf}/SKILL.md`, 'related', 0.5);
}

const out = { batchIndex: 141, batchFiles: bt.files, nodes, edges };
fs.writeFileSync(`${UA}/intermediate/batch-141.json`, JSON.stringify(out, null, 2), 'utf8');
console.log('batch-141.json written | nodes:', nodes.length, '| edges:', edges.length,
  '| imports-expected: 0 | contains:', edges.filter(e => e.type === 'contains').length,
  '| exports:', edges.filter(e => e.type === 'exports').length);
