// Hand-written Vietnamese data for UA batch 130.
const AE = 'packages/raptix/raptix/skills/defs/shared/adversary-emulation';
const DE = 'packages/raptix/raptix/skills/defs/shared/defense-evasion';
const STD = 'packages/raptix/raptix/skills/defs/standard';

const actors130 = {
  'salt-typhoon': 'Salt Typhoon (G1045 / Earth Estries / GhostEmperor / RedMike / OPERATOR PANDA), TQ MSS: xâm phạm telecom + critical infrastructure toàn cầu, Cisco IOS XE CVE-2023-20198, edge device exploitation, DEMODEX rootkit, GhostSpider/SnappyBee/ZINGDOOR, network device persistence + GRE tunneling, pre-positioning ISP.',
  'sandworm-team': 'Sandworm Team (G0034 / Voodoo Bear / Seashell Blizzard / APT44), Nga GRU Unit 74455: destructive ICS/OT + influence — Industroyer, NotPetya, Olympic Destroyer, BlackEnergy, CaddyWiper/Prestige wiper, nhắm lưới điện Ukraine, microSCADA, BadPilot initial access.',
  'scattered-spider': 'Scattered Spider (G1015 / UNC3944 / Octo Tempest / Muddled Libra), e-crime social-engineering-led: help desk social engineering, SIM swap, MFA fatigue/bypass, vishing, 0ktapus Okta phishing, Entra ID federation abuse, ESXi ransomware (DragonForce/ALPHV/RansomHub), RMM abuse, identity attacks.',
  sidewinder: 'SideWinder (G0121 / Rattlesnake / T-APT-04 / Razor Tiger), Ấn Độ (suspected state): LNK execution chain, HTA JavaScript downloader, StealerBot/WarHawk, DLL side-loading, CVE-2017-11882, spearphishing lure chính phủ nhắm quân sự Pakistan, maritime/nuclear logistics.',
  turla: 'Turla (G0010 / Venomous Bear / Secret Blizzard / Waterbug / Snake), Nga FSB Center 16: Snake rootkit/Uroburos, ComRAT/Carbon framework, Kazuar, LightNeuron Exchange, Penquin Linux, TinyTurla, satellite C2, watering hole, chiếm hạ tầng APT khác, DoH/Gmail C2.',
  'volt-typhoon': 'Volt Typhoon (G1017 / BRONZE SILHOUETTE / Vanguard Panda / DEV-0391), TQ: pre-positioning trong critical infrastructure Mỹ bằng living-off-the-land (LOTL/LOLBins), SOHO router botnet (KV botnet), OT pre-positioning, stealth espionage không malware.',
};

const adSkills = {
  'adcs-esc1': 'Exploit ADCS ESC1 — template cho phép arbitrary SAN, impersonate user tới domain admin; MITRE T1649/T1078.002.',
  'asrep-roasting': 'AS-REP Roasting: request AS-REP cho account có DONT_REQ_PREAUTH rồi crack offline — như kerberoast nhưng không cần auth; MITRE T1558.004.',
  'bloodhound-bhce': 'Vận hành BloodHound Community Edition qua bộ tool bhce_* của Raptix (health check, Cypher passthrough, ingest ZIP SharpHound) — thay pipeline ingest + post-process ESC* in-house theo ADR-0005.',
  'bloodhound-query': 'BloodHound ingest + Cypher query canonical cho AD attack-path enumeration (shortest path kerberoastable, unconstrained delegation); chạy sau khi collector dump zip, promote finding vào knowledge graph.',
  'certipy-esc-chain': 'ADCS abuse qua Certipy: tìm template lỗi (ESC1-15), request cert, authenticate as target, dump krbtgt — full chain 4 lệnh, phủ ESC1 (any SAN), ESC2/3/4, ESC8 (NTLM relay tới CA), ESC9/10/11/13; MITRE T1649/T1078.002.',
  coercer: 'Authentication coercion Windows/AD: PetitPotam (MS-EFSR), PrinterBug (MS-RPRN), DFSCoerce, ShadowCoerce, meta-tool Coercer.py — ép machine NTLM-authenticate về attacker rồi relay hoặc crack offline; MITRE T1187/T1557.001.',
  dcsync: 'DCSync: lạm dụng replication rights (DS-Replication-Get-Changes + GetChangesAll) dump krbtgt và NT hash user từ DC; MITRE T1003.006.',
  kerberoasting: 'Kerberoasting: request TGS cho service account có SPN rồi crack offline bằng hashcat — priv-esc primitive kinh điển của AD; MITRE T1558.003.',
  laps: 'LAPS: extract local admin password quản lý bởi LAPS từ computer object AD (ms-Mcs-AdmPwd / msLAPS-Password) qua LDAP/PowerView/netexec; MITRE T1555.',
  netexec: 'NetExec (kế nhiệm CrackMapExec): auth + post-auth module thống nhất SMB/LDAP/MSSQL/WinRM/RDP/SSH/FTP/VNC, 200+ module (BloodHound auto-ingest, ESC1-15 scan, PrintNightmare, LDAP relay); MITRE T1078/T1110/T1135/T1018/T1021.',
};

const files = {
  [`${AE}/references/cve-apt-mapping.md`]: { summary: 'Reference CVE-to-APT mapping (cập nhật 2025-06): map CVE đang bị exploit chủ động với threat actor có attribution từ CISA KEV, MITRE ATT&CK, vendor advisory, Google GTIG, Mandiant; cột "Exploit Skill in Raptix" trỏ tới skill có sẵn dưới skills/standard/exploit/ hoặc đánh dấu NEW.', tags: ['reference', 'cve', 'apt', 'mapping'], complexity: 'moderate' },
  [`${DE}/SKILL.md`]: { summary: 'Skill defense-evasion: router tham chiếu cho đánh giá host-side defense-evasion được ủy quyền — trỏ tới các reference kỹ thuật (AMSI bypass, modern evasion) khi tradecraft cần thiết; MITRE T1562/T1027, subdomain defense-evasion.', tags: ['skill', 'defense-evasion', 'router', 'reference'], complexity: 'simple' },
  [`${DE}/references/amsi-bypass-techniques.md`]: { summary: 'Deep reference AMSI bypass: kiến trúc AMSI (AmsiInitialize → AmsiScanBuffer/String → AV provider) rồi các kỹ thuật bypass qua từng tầng — patch amsi.dll, hook, memory tampering, PowerShell downgraded host…', tags: ['reference', 'amsi', 'evasion', 'powershell'], complexity: 'moderate' },
  [`${DE}/references/modern-evasion-techniques.md`]: { summary: 'Reference evasion hiện đại 2024-2026 từ threat intel: bảng MITRE ATT&CK (ETW bypass T1562.006/.002, smart contract C2 T1102, asymmetric crypto channel T1573.002…) kèm phân tích pattern từng kỹ thuật và các campaign thật — bổ sung cho defense-evasion/SKILL.md và amsi-bypass-techniques.md.', tags: ['reference', 'evasion', 'etw', 'threat-intel'], complexity: 'complex' },
};

files['packages/raptix/raptix/skills/defs/shared/finding-protocol/SKILL.md'] = {
  summary: 'Skill finding-protocol: template finding tier operational — các field tối thiểu (FIND-id, severity, target, evidence, recommendation) cho sub-agent ghi quyết định vào findings/; promotion deliverable nặng nằm ở skills/raptix/final-report.',
  tags: ['skill', 'finding', 'template', 'reporting'],
  complexity: 'simple',
};
files['packages/raptix/raptix/skills/defs/shared/opsec/SKILL.md'] = {
  summary: 'Skill opsec: quản lý operational security — traffic shaping, scan rate limiting, source IP management, tránh tool signature, evidence handling, anti-detection patterns; MITRE T1562/T1070/T1036; dùng cho OPSEC check, stealth, scan timing, scope check, clean up.',
  tags: ['skill', 'opsec', 'stealth', 'rate-limit'],
  complexity: 'moderate',
};
files['packages/raptix/raptix/skills/defs/shared/references/SKILL.md'] = {
  summary: 'Skill references: tích hợp kiến thức bên ngoài — HackerOne disclosed reports, PayloadsAllTheThings, Book of Secret Knowledge, CVE PoC corpora, bug bounty methodologies và reference pentest agent architectures; query metadata hoặc fetch full repo vào sandbox để grep-level access.',
  tags: ['skill', 'reference', 'payloads', 'calibration'],
  complexity: 'simple',
};
files['packages/raptix/raptix/skills/defs/shared/stealth-infra/SKILL.md'] = {
  summary: 'Skill stealth-infra: anti-bot evasion, proxy rotation, lấy credential từ password manager (1Password, GNOME Keyring) và stealth HTTP tooling cho web operation covert — captcha/Cloudflare bypass, cookie injection, TLS fingerprint browser impersonation; MITRE T1562/T1036/T1090.',
  tags: ['skill', 'stealth', 'anti-bot', 'proxy'],
  complexity: 'moderate',
};
files[`${STD}/ad/SKILL.md`] = {
  summary: 'Skill ad-overview: attack lane Active Directory — BloodHound ingestion, Kerberoasting, ADCS ESC scanning, DCSync, LAPS extraction; capability contract lane active-directory (isolated-lab, bloodhound-ce/certipy/netexec), verification bằng replay trong lab reset + negative control sau remediation, scorecard DreadGoad.',
  tags: ['skill', 'ad', 'lane', 'routing'],
  complexity: 'simple',
};

for (const [slug, desc] of Object.entries(actors130)) {
  files[`${AE}/${slug}/SKILL.md`] = {
    summary: `Hồ sơ adversary-emulation cho ${desc}`,
    tags: ['skill', 'adversary-emulation', 'apt', 'mitre'],
    complexity: 'moderate',
  };
}
for (const [slug, desc] of Object.entries(adSkills)) {
  files[`${STD}/ad/${slug}/SKILL.md`] = {
    summary: `Skill AD ${slug}: ${desc}`,
    tags: ['skill', 'ad', 'active-directory', 'exploitation'],
    complexity: 'simple',
  };
}

const extraEdges = [
  [`document:${DE}/SKILL.md`, `document:${DE}/references/amsi-bypass-techniques.md`, 'documents', 0.5],
  [`document:${DE}/SKILL.md`, `document:${DE}/references/modern-evasion-techniques.md`, 'documents', 0.5],
  [`document:${DE}/references/modern-evasion-techniques.md`, `document:${DE}/references/amsi-bypass-techniques.md`, 'related', 0.5],
  [`document:packages/raptix/raptix/skills/defs/shared/opsec/SKILL.md`, `document:packages/raptix/raptix/skills/defs/shared/stealth-infra/SKILL.md`, 'related', 0.5],
  [`document:${AE}/references/cve-apt-mapping.md`, `document:${AE}/SKILL.md`, 'related', 0.5],
];
for (const slug of Object.keys(adSkills)) {
  extraEdges.push([
    `document:${STD}/ad/SKILL.md`,
    `document:${STD}/ad/${slug}/SKILL.md`,
    'documents', 0.5,
  ]);
}

module.exports = { files, overrides: {}, calls: [], inherits: [], testedBy: [], extraEdges };
