// Hand-written Vietnamese data for UA batch 129.
const AE = 'packages/raptix/raptix/skills/defs/shared/adversary-emulation';
const VP = 'packages/raptix/raptix/skills/defs/plugins';

const actors129 = {
  'apt10-stone-panda': 'APT10 (G0045 / Stone Panda / menuPass / POTASSIUM / Red Apollo), TQ MSS Tianjin: cyber-espionage qua MSP/supply-chain (Cloud Hopper), Operation Soft Cell telecom; PlugX/QuasarRAT/Poison Ivy, DLL side-loading, custom HTTP/DNS C2 — hồ sơ tái tạo TTP trong RoE scope.',
  'apt28-fancy-bear': 'APT28 (G0007 / Fancy Bear / Forest Blizzard / Sofacy / STRONTIUM), Nga GRU Unit 26165: NTLM relay CVE-2023-23397 Outlook, GooseEgg print spooler, password spray, credential harvesting nhắm NATO/Ukraine logistics — hồ sơ espionage GRU.',
  'apt29-cozy-bear': 'APT29 (G0016 / Cozy Bear / Midnight Blizzard / NOBELIUM / The Dukes), Nga SVR: SolarWinds supply-chain, golden SAML, OAuth abuse, password spray cloud access, APT dwell dài stealthy — hồ sơ cloud espionage.',
  'apt33-elfin': 'APT33 (G0064 / Elfin / Peach Sandstorm / HOLMIUM), Iran (suspected): password spray à ồ nhắm aviation/energy/petrochemical/defense, spearphishing .hta, FalseFont/Tickler, Azure abuse (AzureHound, Roadtools), WinRAR CVE-2018-20250.',
  'apt34-oilrig': 'APT34 (G0049 / OilRig / Helix Kitten / Hazel Sandstorm), Iran MOIS: DNS tunneling (BONDUPDATER), POWRUNER/SideTwist, Outlook Home Page persistence, Exchange exfiltration, password filter DLL — nhắm Trung Đông.',
  'apt36-transparent-tribe': 'APT36 (G0134 / Transparent Tribe / Mythic Leopard / COPPER FIELDSTONE), Pakistan: CrimsonRAT/ObliqueRAT/CapraRAT, spearphishing Office weaponized nhắm quân sự Ấn Độ, Android surveillance, honey trap, USB watering hole.',
  'apt37-reaper': 'APT37 (G0067 / Reaper / ScarCruft / Ricochet Chollima / InkySquid), Triều Tiên RGB: RoKRAT/BLUELIGHT/Chinotto, HWP spearphishing, Flash/IE zero-day, watering hole, Bluetooth harvesting, giám sát NK defector tại Hàn.',
  'apt41-double-dragon': 'APT41 (G0096 / Double Dragon / Wicked Panda / BARIUM / Brass Typhoon), TQ dual-mandate espionage+cybercrime: ShadowPad/PlugX/KEYPLUG/DUSTTRAP, supply-chain, web shell, ăn cắp code-signing cert, nhắm ngành game.',
  'dark-caracal': 'Dark Caracal (G0070), Lebanon GDGS: Bandook RAT/CrossRAT/Pallas/Poco RAT, mobile surveillance Android trojan, multi-platform RAT, watering hole + trojanized apps, phishing Facebook/WhatsApp, Operation Manul.',
  'fin7-carbanak': 'FIN7 (G0046 / Carbanak / Carbon Spider / Sangria Tempest / GOLD NIAGARA), tội phạm Nga-motivated tài chính: POS/payment-card theft, big game hunting ransomware affiliate (Darkside/ALPHV/LockBit), POWERTRASH/Carbanak backdoor/Lizar loader, BadUSB, AvNeutralizer EDR killer, ESXi ransomware.',
  kimsuky: 'Kimsuky (G0094 / Velvet Chollima / Emerald Sleet / THALLIUM / APT43), Triều Tiên RGB 63rd: credential phishing think tank/academia, journalist impersonation, malicious browser extension, CHM/LNK execution, ClickFix, TRANSLATEXT/Troll Stealer, nhắm nuclear policy.',
  'lazarus-group': 'Lazarus Group (G0032 / Hidden Cobra / Diamond Sleet / Labyrinth Chollima), Triều Tiên RGB: AppleJeus, Operation Dream Job, 3CX supply-chain, FastCash, WannaCry, Bangladesh Bank SWIFT, cryptocurrency theft, fake job offer, wiper destructive.',
  muddywater: 'MuddyWater (G0069 / Mercury / Mango Sandstorm / Static Kitten / TEMP.Zagros), Iran MOIS: POWERSTATS PowerShell RAT, MuddyC2Go/PhonyC2/PowGoop, Mori DNS tunneling, RMM tool abuse (Atera/ScreenConnect/SimpleHelp), spearphishing macro, DLL side-loading nhắm chính phủ Middle East.',
  'mustang-panda': 'Mustang Panda (G0129 / Bronze President / Stately Taurus / RedDelta / TA416), TQ: PlugX/Korplug RAT, TONESHELL loader, DLL side-loading, USB worm propagation, spearphishing themed lure nhắm chính phủ SEA/EU/Vatican.',
  patchwork: 'Patchwork (G0040 / Dropping Elephant / MONSOON / Hangover Group), Ấn Độ-linked: BADNEWS/Ragnatela RAT, QuasarRAT/VajraSpy, DLL side-loading, copy-paste APT, RTF exploit CVE-2017-11882, nhắm chính phủ Pakistan.',
  'pink-sandstorm': 'Pink Sandstorm (G1030 / Agrius / Agonizing Serpens / BlackShadow / DEV-0227), Iran MOIS: wiper giả ransomware (Apostle/Fantasy/DEADWOOD/MultiLayer), BFG Agonizer, Moneybird, IPsec Helper backdoor, ASPXSpy web shell, nhắm Israel + ngành kim cương.',
};

const files = {
  [`${VP}/llm-redteam/t15-human-ai-coupling/SKILL.md`]: { summary: 'Sub-skill AATMF T15 — Human-AI Coupling: deepfake escalation, voice clone vishing, deepfake-image-driven social engineering, tự động hoá tấn công nhắm con người; map MITRE T1566, subdomain ai-security.', tags: ['skill', 'aatmf', 'deepfake', 'social-engineering'], complexity: 'simple' },
  [`${VP}/patcher/SKILL.md`]: { summary: 'Playbook patcher-overview (stage 4 vulnresearch): sinh patch diff tối thiểu cho validated finding với bắt buộc patch_verify chứng minh fix giữ vững; load lúc patcher-agent startup.', tags: ['skill', 'patcher', 'vulnresearch', 'patch'], complexity: 'simple' },
  [`${VP}/scanner/SKILL.md`]: { summary: 'Playbook scanner-overview (stage 1 vulnresearch): broad-spectrum sweep sharded trên codebase rất lớn sinh CANDIDATE node cho Detector lý luận; stage rẻ-nhanh nhất của pipeline; load lúc scanner-agent startup.', tags: ['skill', 'scanner', 'vulnresearch', 'candidate'], complexity: 'simple' },
  [`${VP}/verifier/SKILL.md`]: { summary: 'Playbook verifier-overview (stage 3 vulnresearch): quality gate Zero-False-Positive — triage, craft PoC tối thiểu, chạy với ZFP controls, promote bug validated thành FINDING node có CVSS; FINDING không có PoC chạy được là lỗi quy trình; load lúc verifier-agent startup.', tags: ['skill', 'verifier', 'zfp', 'poc'], complexity: 'moderate' },
  [`${VP}/verifier/bounty-report/SKILL.md`]: { summary: 'Skill bounty-report-formatter: format validated finding thành bug bounty report sẵn sàng nộp cho HackerOne, Bugcrowd, Immunefi và GitHub Security Advisories (GHSA) — template submission, triage, CVSS, writeup; load sau khi validate_finding thành công.', tags: ['skill', 'bug-bounty', 'report', 'hackerone'], complexity: 'moderate' },
  [`${VP}/verifier/seven-question-gate/SKILL.md`]: { summary: 'Skill seven-question-gate: gate 7 câu hỏi chạy SAU khi validate_finding trả success nhưng TRƯỚC khi promote FINDING + mở report — giết finding yếu/thiếu impact trước khi tới stage report và hủy hoại validity ratio; MITRE T1497, subdomain verification.', tags: ['skill', 'triage', 'gate', 'verification'], complexity: 'moderate' },
  [`${VP}/vulnresearch/SKILL.md`]: { summary: 'Skill vulnresearch-orchestrator: orchestrator pipeline nghiên cứu lỗ hổng 5 stage (scan → detect → verify → patch → exploit) — DELEGATE qua OPPLAN objectives tới scanner/detector/verifier/patcher/exploiter, không tự chạy các stage; load lúc orchestrator startup.', tags: ['skill', 'orchestrator', 'vulnresearch', 'pipeline'], complexity: 'simple' },
  [`${AE}/SKILL.md`]: { summary: 'Skill adversary-emulation: threat-informed emulation — chọn APT thật, load profile, tái tạo TTP trong RoE scope để test detection & response; index của 22 actor profile + phương pháp emulation; purple team, ATT&CK evaluation, TTP replay.', tags: ['skill', 'adversary-emulation', 'mitre', 'purple-team'], complexity: 'moderate' },
  [`${AE}/references/anyrun-free-iocs.md`]: { summary: 'Reference IOC threat-intel free-tier ANY.RUN (cập nhật 2025-06): quick reference cú pháp TI Lookup (30+ search field AND/OR/NOT/wildcard), IOC từ sandbox community + vendor advisories (Trend Micro, ESET, Fortinet, Kaspersky, Unit 42, GTIG) và CSA chính phủ — nguồn calibrate detection cho adversary-emulation.', tags: ['reference', 'ioc', 'threat-intel', 'anyrun'], complexity: 'simple' },
};

for (const [slug, desc] of Object.entries(actors129)) {
  files[`${AE}/${slug}/SKILL.md`] = {
    summary: `Hồ sơ adversary-emulation cho ${desc}`,
    tags: ['skill', 'adversary-emulation', 'apt', 'mitre'],
    complexity: 'moderate',
  };
}

const extraEdges = [];
for (const slug of [...Object.keys(actors129), 'salt-typhoon', 'sandworm-team', 'scattered-spider', 'sidewinder', 'turla', 'volt-typhoon']) {
  extraEdges.push([
    `document:${AE}/SKILL.md`,
    `document:${AE}/${slug}/SKILL.md`,
    'documents', 0.5,
  ]);
}
extraEdges.push(
  [`document:${VP}/vulnresearch/SKILL.md`, `document:${VP}/scanner/SKILL.md`, 'documents', 0.5],
  [`document:${VP}/vulnresearch/SKILL.md`, `document:${VP}/patcher/SKILL.md`, 'documents', 0.5],
  [`document:${VP}/vulnresearch/SKILL.md`, `document:${VP}/verifier/SKILL.md`, 'documents', 0.5],
  [`document:${VP}/vulnresearch/SKILL.md`, `document:${VP}/verifier/bounty-report/SKILL.md`, 'documents', 0.5],
  [`document:${VP}/vulnresearch/SKILL.md`, `document:${VP}/verifier/seven-question-gate/SKILL.md`, 'documents', 0.5],
  [`document:${VP}/verifier/SKILL.md`, `document:${VP}/verifier/bounty-report/SKILL.md`, 'documents', 0.5],
  [`document:${VP}/verifier/SKILL.md`, `document:${VP}/verifier/seven-question-gate/SKILL.md`, 'documents', 0.5],
  [`document:${VP}/verifier/seven-question-gate/SKILL.md`, `document:${VP}/verifier/bounty-report/SKILL.md`, 'related', 0.5],
  [`document:${AE}/references/anyrun-free-iocs.md`, `document:${AE}/SKILL.md`, 'related', 0.5],
);

module.exports = { files, overrides: {}, calls: [], inherits: [], testedBy: [], extraEdges };
