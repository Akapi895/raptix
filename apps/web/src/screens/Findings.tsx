import { useState } from 'react'
import {
  SearchIcon,
  DownloadIcon,
  CheckIcon,
  ClockIcon,
  XIcon,
  EyeIcon,
  ChevronRightIcon,
  UserIcon,
} from '../components/Icons'

type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'
type FindingStatus = 'Open' | 'In Review' | 'Closed' | 'False Positive'
type ReportStatus = 'Draft' | 'Generated' | 'Approved'

interface EvidenceRef {
  id: string
  title: string
  type: 'screenshot' | 'log' | 'tool_output' | 'extracted_data'
}

interface Finding {
  id: string
  title: string
  severity: Severity
  asset: string
  status: FindingStatus
  report: ReportStatus
  evidenceCount: number
  lastUpdated: string
  cve?: string
  cvss?: number
  description: string
  affectedAsset: string
  discoveredDate: string
  assignedTo?: string
  remediation: string
  evidence: EvidenceRef[]
  reportMarkdown: string
}

const MOCK_FINDINGS: Finding[] = [
  {
    id: '1',
    title: 'Unauthenticated RCE via PHP Deserialization',
    severity: 'critical',
    asset: 'admin.acme-staging.io',
    status: 'In Review',
    report: 'Generated',
    evidenceCount: 3,
    lastUpdated: '2 min ago',
    cve: 'CVE-2024-49113',
    cvss: 9.8,
    description: 'AdminLite v2.3.1 contains a PHP deserialization vulnerability that allows unauthenticated remote code execution. An attacker can send a crafted POST request to `/admin/upload.php` to achieve RCE with web server privileges. This was confirmed by obtaining a reverse shell.',
    affectedAsset: 'admin.acme-staging.io:8080',
    discoveredDate: '2026-09-18',
    assignedTo: 'Alex Kim',
    remediation: 'Upgrade AdminLite to version 2.3.2 or later. Apply input validation and avoid deserializing untrusted data. Implement a WAF rule to block crafted POST requests to the upload endpoint.',
    evidence: [
      { id: 'e1', title: 'RCE Reverse Shell Screenshot', type: 'screenshot' },
      { id: 'e2', title: 'Exploit Script Output', type: 'tool_output' },
      { id: 'e3', title: 'PoC Curl Command Log', type: 'log' },
    ],
    reportMarkdown: `## Finding: Unauthenticated RCE via PHP Deserialization\n\n**Severity:** Critical (CVSS 9.8)\n**CVE:** CVE-2024-49113\n\n### Summary\n\nAn unauthenticated remote code execution vulnerability was discovered in AdminLite v2.3.1 running on \`admin.acme-staging.io:8080\`. The vulnerability stems from unsafe PHP object deserialization in the file upload handler.\n\n### Technical Details\n\nThe endpoint \`/admin/upload.php\` accepts serialized PHP objects without validation. By crafting a malicious payload, an attacker can trigger arbitrary code execution as the \`www-data\` user.\n\n**Proof of Concept:**\n\`\`\`\ncurl -X POST https://admin.acme-staging.io:8080/admin/upload.php \\\n  -d 'file=O:8:"stdClass":1:{s:4:"exec";s:6:"id"}'\n\`\`\`\n\n### Impact\n\nFull server compromise. Attacker can read sensitive files, pivot to internal network, install backdoors.\n\n### Remediation\n\nUpgrade to AdminLite ≥ 2.3.2. Disable PHP deserialization or use \`json_decode()\` instead. Apply WAF rules.`,
  },
  {
    id: '2',
    title: 'Exposed .env File with Plaintext Credentials',
    severity: 'critical',
    asset: 'api.acme.com',
    status: 'Open',
    report: 'Draft',
    evidenceCount: 2,
    lastUpdated: '5 min ago',
    cvss: 9.1,
    description: 'The application root exposes a `.env` file via HTTP, containing plaintext database credentials, API keys, and secret tokens. This file is publicly accessible without authentication from any IP.',
    affectedAsset: 'api.acme.com/.env',
    discoveredDate: '2026-09-18',
    remediation: 'Immediately rotate all exposed credentials. Block direct access to `.env` files via web server configuration. Ensure `.env` files are excluded from web-accessible directories.',
    evidence: [
      { id: 'e4', title: '.env File Contents (Redacted)', type: 'extracted_data' },
      { id: 'e5', title: 'HTTP 200 Response Screenshot', type: 'screenshot' },
    ],
    reportMarkdown: `## Finding: Exposed .env File with Plaintext Credentials\n\n**Severity:** Critical (CVSS 9.1)\n\n### Summary\n\nA \`.env\` configuration file is publicly accessible at \`https://api.acme.com/.env\`, exposing database passwords, API keys, and JWT secrets in plaintext.\n\n### Technical Details\n\n**Request:**\n\`\`\`\nGET https://api.acme.com/.env HTTP/1.1\nResponse: 200 OK\n\`\`\`\n\n**Exposed Secrets:**\n- DB_PASSWORD: ••••••••\n- API_SECRET: ••••••••\n- JWT_SECRET: ••••••••\n\n### Impact\n\nFull access to backend database. Ability to forge JWT tokens. Third-party API access with acme.com's credentials.\n\n### Remediation\n\nRotate all secrets immediately. Configure web server to return 403 for .env files.`,
  },
  {
    id: '3',
    title: 'SQL Injection on Login Endpoint',
    severity: 'high',
    asset: 'api.acme.com',
    status: 'Open',
    report: 'Draft',
    evidenceCount: 4,
    lastUpdated: '10 min ago',
    cvss: 8.2,
    description: 'The `username` parameter in POST /api/auth is vulnerable to UNION-based SQL injection. Exploitation allows full database enumeration, credential extraction, and potential authentication bypass.',
    affectedAsset: 'api.acme.com/api/auth',
    discoveredDate: '2026-09-18',
    remediation: 'Use parameterized queries or prepared statements for all database interactions. Implement an ORM with built-in SQL injection protection. Deploy a WAF with SQL injection detection rules.',
    evidence: [
      { id: 'e6', title: 'sqlmap Output Log', type: 'tool_output' },
      { id: 'e7', title: 'Extracted users Table', type: 'extracted_data' },
      { id: 'e8', title: 'Injection Payload Screenshot', type: 'screenshot' },
      { id: 'e9', title: 'Burp Suite Request Log', type: 'log' },
    ],
    reportMarkdown: `## Finding: SQL Injection on Login Endpoint\n\n**Severity:** High (CVSS 8.2)\n\n### Summary\n\nA UNION-based SQL injection was identified in the \`username\` parameter of \`POST /api/auth\`.\n\n### Payload\n\n\`\`\`sql\nusername=admin' UNION SELECT 1,username,password,4 FROM users--\n\`\`\`\n\n### Extracted Data\n\n3 tables extracted: users, sessions, api_keys. 47 user records retrieved including password hashes.\n\n### Remediation\n\nReplace string concatenation with parameterized queries. Enforce least-privilege DB accounts.`,
  },
  {
    id: '4',
    title: 'JWT Algorithm Confusion Attack',
    severity: 'high',
    asset: 'api.acme.com',
    status: 'In Review',
    report: 'Generated',
    evidenceCount: 2,
    lastUpdated: '20 min ago',
    cvss: 7.8,
    description: 'The API accepts JWTs signed with the `none` algorithm, allowing token forgery without the secret key. An attacker can impersonate any user including administrators by crafting unsigned tokens.',
    affectedAsset: 'api.acme.com/api/v1/*',
    discoveredDate: '2026-09-17',
    assignedTo: 'Sarah Rowe',
    remediation: 'Explicitly reject tokens with algorithm `none`. Pin the expected algorithm server-side and reject any deviation.',
    evidence: [
      { id: 'e10', title: 'Forged JWT Token Payload', type: 'tool_output' },
      { id: 'e11', title: 'Admin Access Screenshot', type: 'screenshot' },
    ],
    reportMarkdown: `## Finding: JWT Algorithm Confusion Attack\n\n**Severity:** High (CVSS 7.8)\n\n### Summary\n\nThe API accepts JWTs signed with \`alg: none\`, allowing unauthenticated token forgery and privilege escalation to administrator.\n\n### Proof of Concept\n\nForged JWT with \`sub: admin\` and \`alg: none\` was accepted by the API, granting full admin access.\n\n### Remediation\n\nExplicitly validate JWT algorithm server-side. Reject \`none\` and pin to expected algorithm (e.g., RS256).`,
  },
  {
    id: '5',
    title: 'Unauthenticated Admin Panel Access',
    severity: 'high',
    asset: 'admin.acme-staging.io',
    status: 'Open',
    report: 'Draft',
    evidenceCount: 1,
    lastUpdated: '25 min ago',
    cvss: 7.3,
    description: 'The admin panel is accessible from external IPs without IP allowlisting or additional authentication. All admin functionality — including user management, config changes, and data exports — is exposed.',
    affectedAsset: 'admin.acme-staging.io',
    discoveredDate: '2026-09-17',
    remediation: 'Implement IP allowlisting for the admin panel. Require MFA for all admin logins. Move the panel off the public internet.',
    evidence: [
      { id: 'e12', title: 'Admin Dashboard Screenshot', type: 'screenshot' },
    ],
    reportMarkdown: `## Finding: Unauthenticated Admin Panel Access\n\n**Severity:** High (CVSS 7.3)\n\n### Summary\n\nAdmin panel accessible from external IP without restriction.\n\n### Remediation\n\nImplement IP allowlisting and MFA.`,
  },
  {
    id: '6',
    title: 'FortiGate SSL-VPN Auth Bypass',
    severity: 'critical',
    asset: 'vpn.acme.com',
    status: 'Open',
    report: 'Draft',
    evidenceCount: 2,
    lastUpdated: '30 min ago',
    cve: 'CVE-2022-42475',
    cvss: 9.3,
    description: 'FortiOS and FortiProxy SSL-VPN are vulnerable to an authentication bypass that allows unauthenticated attackers to obtain administrator session via specially crafted HTTP requests.',
    affectedAsset: 'vpn.acme.com',
    discoveredDate: '2026-09-18',
    remediation: 'Upgrade FortiOS to 7.2.3 or later. Apply the vendor-provided patch. Monitor VPN logs for unusual session activity.',
    evidence: [
      { id: 'e13', title: 'CVE PoC Output', type: 'tool_output' },
      { id: 'e14', title: 'Session Cookie Capture', type: 'log' },
    ],
    reportMarkdown: `## Finding: FortiGate SSL-VPN Auth Bypass (CVE-2022-42475)\n\n**Severity:** Critical (CVSS 9.3)\n\n### Summary\n\nFortiGate SSL-VPN at \`vpn.acme.com\` is running a version vulnerable to CVE-2022-42475, allowing session hijack without credentials.\n\n### Remediation\n\nUpgrade FortiOS immediately to 7.2.3+.`,
  },
  {
    id: '7',
    title: 'Tomcat Manager Default Credentials',
    severity: 'critical',
    asset: '10.0.1.45',
    status: 'Closed',
    report: 'Approved',
    evidenceCount: 2,
    lastUpdated: '1 hour ago',
    cvss: 9.0,
    description: 'Apache Tomcat Manager interface accessible on port 8080 with default credentials (tomcat/tomcat). Access allows WAR file deployment and full server compromise.',
    affectedAsset: '10.0.1.45:8080/manager',
    discoveredDate: '2026-09-16',
    assignedTo: 'Marcus Lee',
    remediation: 'Change default credentials immediately. Restrict Tomcat Manager access to localhost or management network only. Disable the manager if not needed.',
    evidence: [
      { id: 'e15', title: 'Manager Login Screenshot', type: 'screenshot' },
      { id: 'e16', title: 'WAR Deploy Log', type: 'log' },
    ],
    reportMarkdown: `## Finding: Tomcat Manager Default Credentials\n\n**Severity:** Critical (CVSS 9.0) — CLOSED\n\n### Summary\n\nTomcat Manager at 10.0.1.45:8080 was accessible with credentials \`tomcat/tomcat\`. Remediated on 2026-09-17.\n\n### Resolution\n\nCredentials changed. Manager interface restricted to internal network.`,
  },
  {
    id: '8',
    title: 'Outdated jQuery with XSS Vector',
    severity: 'medium',
    asset: 'portal.acme.com',
    status: 'Open',
    report: 'Draft',
    evidenceCount: 1,
    lastUpdated: '1.5 hours ago',
    cve: 'CVE-2020-11022',
    cvss: 5.1,
    description: 'The application uses jQuery 1.7.1, vulnerable to XSS in `html()` calls when unsanitized user input is rendered. Exploitable via hash-based routing.',
    affectedAsset: 'portal.acme.com',
    discoveredDate: '2026-09-17',
    remediation: 'Upgrade jQuery to 3.7.1 or later. Sanitize all user-supplied data before passing to jQuery DOM manipulation methods.',
    evidence: [
      { id: 'e17', title: 'XSS PoC Screenshot', type: 'screenshot' },
    ],
    reportMarkdown: `## Finding: Outdated jQuery XSS (CVE-2020-11022)\n\n**Severity:** Medium (CVSS 5.1)\n\n### Summary\n\nPortal uses jQuery 1.7.1 with known XSS vulnerability in \`html()\`.\n\n### Remediation\n\nUpgrade to jQuery 3.7.1+.`,
  },
  {
    id: '9',
    title: 'Missing HSTS Header on HTTPS Endpoints',
    severity: 'medium',
    asset: 'acme.com',
    status: 'False Positive',
    report: 'Approved',
    evidenceCount: 1,
    lastUpdated: '2 hours ago',
    cvss: 4.3,
    description: 'No Strict-Transport-Security header set, allowing potential protocol downgrade attacks. Accepted as false positive — client uses a CDN that handles HSTS.',
    affectedAsset: 'acme.com',
    discoveredDate: '2026-09-16',
    assignedTo: 'Alex Kim',
    remediation: 'N/A — HSTS is configured at CDN level.',
    evidence: [
      { id: 'e18', title: 'HTTP Headers Response Log', type: 'log' },
    ],
    reportMarkdown: `## Finding: Missing HSTS — False Positive\n\n**Severity:** Medium — FALSE POSITIVE\n\n### Notes\n\nHSTS is applied at CloudFront CDN layer. Not present at origin but effective for all clients.`,
  },
  {
    id: '10',
    title: 'Service Account with Domain Admin Rights',
    severity: 'high',
    asset: '10.0.1.45',
    status: 'Open',
    report: 'Draft',
    evidenceCount: 2,
    lastUpdated: '2.5 hours ago',
    cvss: 7.5,
    description: 'Service account `svc_backup` holds Domain Admin privileges with a password that has not been changed in 900+ days. If compromised, it grants full domain control.',
    affectedAsset: 'ACME\\svc_backup',
    discoveredDate: '2026-09-18',
    remediation: 'Remove Domain Admin rights from svc_backup. Rotate the password. Implement LAPS for service accounts. Enable audit logging for privileged account usage.',
    evidence: [
      { id: 'e19', title: 'LDAP Enumeration Output', type: 'tool_output' },
      { id: 'e20', title: 'AD Group Membership Screenshot', type: 'screenshot' },
    ],
    reportMarkdown: `## Finding: Service Account with Domain Admin Rights\n\n**Severity:** High (CVSS 7.5)\n\n### Summary\n\nsvc_backup has Domain Admin rights and an unchanged password (900+ days).\n\n### Remediation\n\nRemove excessive privileges. Rotate credentials. Enable LAPS.`,
  },
  {
    id: '11',
    title: 'Weak SSH Cipher Suites Enabled',
    severity: 'medium',
    asset: '10.0.1.45',
    status: 'Open',
    report: 'Draft',
    evidenceCount: 1,
    lastUpdated: '3 hours ago',
    cvss: 4.8,
    description: 'The SSH service on port 22 supports deprecated cipher suites including arcfour and 3des-cbc, which are known to be weak and susceptible to theoretical attacks.',
    affectedAsset: '10.0.1.45:22',
    discoveredDate: '2026-09-18',
    remediation: 'Disable weak cipher suites in /etc/ssh/sshd_config. Allow only strong ciphers: chacha20-poly1305, aes256-gcm.',
    evidence: [
      { id: 'e21', title: 'ssh-audit Output', type: 'tool_output' },
    ],
    reportMarkdown: `## Finding: Weak SSH Cipher Suites\n\n**Severity:** Medium (CVSS 4.8)\n\n### Summary\n\nSSH service supports deprecated arcfour and 3des-cbc cipher suites.\n\n### Remediation\n\nUpdate sshd_config to allow only strong modern ciphers.`,
  },
  {
    id: '12',
    title: 'Development Environment Publicly Accessible',
    severity: 'high',
    asset: 'dev.acme.com',
    status: 'In Review',
    report: 'Generated',
    evidenceCount: 3,
    lastUpdated: '4 hours ago',
    cvss: 7.2,
    description: 'The development environment is publicly accessible on the internet, exposing Swagger UI with full API documentation, internal API endpoints, and debug endpoints with verbose error messages.',
    affectedAsset: 'dev.acme.com',
    discoveredDate: '2026-09-17',
    assignedTo: 'Sarah Rowe',
    remediation: 'Restrict dev.acme.com to internal network only. Implement authentication. Remove Swagger UI from production-facing hosts.',
    evidence: [
      { id: 'e22', title: 'Swagger UI Screenshot', type: 'screenshot' },
      { id: 'e23', title: 'Internal API Endpoints List', type: 'extracted_data' },
      { id: 'e24', title: 'Verbose Error Response', type: 'log' },
    ],
    reportMarkdown: `## Finding: Development Environment Publicly Accessible\n\n**Severity:** High (CVSS 7.2)\n\n### Summary\n\ndev.acme.com is internet-facing with Swagger UI exposing full internal API structure.\n\n### Remediation\n\nRestrict to internal network. Require auth. Remove Swagger in public-facing environments.`,
  },
  {
    id: '13',
    title: 'Expired TLS Certificate on Internal Host',
    severity: 'low',
    asset: '10.0.1.22',
    status: 'Open',
    report: 'Draft',
    evidenceCount: 1,
    lastUpdated: '5 hours ago',
    cvss: 2.6,
    description: 'TLS certificate on 10.0.1.22:443 expired on 2025-01-01. While only affecting internal clients, this creates potential for MITM within the internal network.',
    affectedAsset: '10.0.1.22:443',
    discoveredDate: '2026-09-18',
    remediation: 'Renew the TLS certificate. Automate certificate renewal using Let\'s Encrypt or internal PKI.',
    evidence: [
      { id: 'e25', title: 'openssl Certificate Output', type: 'log' },
    ],
    reportMarkdown: `## Finding: Expired TLS Certificate\n\n**Severity:** Low (CVSS 2.6)\n\n### Summary\n\nTLS cert expired Jan 2025 on internal host 10.0.1.22.\n\n### Remediation\n\nRenew certificate. Automate with ACME protocol.`,
  },
]

const sevConfig: Record<Severity, { label: string; color: string; bg: string; bar: string }> = {
  critical: { label: 'Critical', color: '#DC2626', bg: 'rgba(238,0,51,0.15)',  bar: '#DC2626' },
  high:     { label: 'High',     color: '#F97316', bg: 'rgba(249,115,22,0.15)', bar: '#F97316' },
  medium:   { label: 'Medium',   color: '#F59E0B', bg: 'rgba(245,158,11,0.15)', bar: '#F59E0B' },
  low:      { label: 'Low',      color: '#3B82F6', bg: 'rgba(59,130,246,0.15)', bar: '#3B82F6' },
  info:     { label: 'Info',     color: '#94A3B8', bg: 'rgba(107,114,128,0.15)',bar: '#94A3B8' },
}

const statusConfig: Record<FindingStatus, { color: string; bg: string }> = {
  'Open':          { color: '#DC2626', bg: 'rgba(238,0,51,0.15)' },
  'In Review':     { color: '#F59E0B', bg: 'rgba(245,158,11,0.15)' },
  'Closed':        { color: '#22C55E', bg: 'rgba(34,197,94,0.15)' },
  'False Positive':{ color: '#94A3B8', bg: 'rgba(107,114,128,0.15)' },
}

const reportConfig: Record<ReportStatus, { color: string; bg: string }> = {
  Draft:     { color: '#475569', bg: 'rgba(156,163,175,0.1)' },
  Generated: { color: '#3B82F6', bg: 'rgba(59,130,246,0.15)' },
  Approved:  { color: '#22C55E', bg: 'rgba(34,197,94,0.15)' },
}

const SEV_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info']
const STATUSES: (FindingStatus | 'All')[] = ['All', 'Open', 'In Review', 'Closed', 'False Positive']

type DrawerTab = 'summary' | 'evidence' | 'report'

const evidenceTypeIcons: Record<string, string> = {
  screenshot: '📷',
  log: '📋',
  tool_output: '🖥',
  extracted_data: '🗄',
  terminal_capture: '⌨',
}

function extractPoc(md: string): string | null {
  const match = md.match(/```[\w]*\n([\s\S]*?)```/)
  return match ? match[1].trim() : null
}

export default function Findings() {
  const [sevFilter, setSevFilter] = useState<Severity | 'All'>('All')
  const [statusFilter, setStatusFilter] = useState<FindingStatus | 'All'>('All')
  const [search, setSearch] = useState('')
  const [selectedItem, setSelectedItem] = useState<Finding | null>(null)
  const [drawer, setDrawer] = useState<Finding | null>(null)
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('summary')

  const filtered = MOCK_FINDINGS.filter(f => {
    if (sevFilter !== 'All' && f.severity !== sevFilter) return false
    if (statusFilter !== 'All' && f.status !== statusFilter) return false
    if (search && !f.title.toLowerCase().includes(search.toLowerCase()) && !f.asset.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const counts = Object.fromEntries(
    SEV_ORDER.map(s => [s, MOCK_FINDINGS.filter(f => f.severity === s).length])
  ) as Record<Severity, number>

  const total = MOCK_FINDINGS.length

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: '#F8FAFC' }}>
      {/* Top bar */}
      <div
        className="flex items-center justify-between px-6 py-4 border-b"
        style={{ borderColor: '#E2E8F0', backgroundColor: '#F8FAFC' }}
      >
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold" style={{ color: '#0F172A' }}>Findings</h1>
          <span
            className="text-xs font-semibold px-2 py-0.5 rounded-full"
            style={{ backgroundColor: 'rgba(238,0,51,0.15)', color: '#DC2626' }}
          >
            {total}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <SearchIcon size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#94A3B8' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search findings…"
              className="pl-8 pr-3 py-1.5 text-xs rounded-lg outline-none w-44 transition-all"
              style={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', color: '#0F172A' }}
            />
          </div>
          {/* Status filter */}
          <div className="flex items-center gap-1 px-1 py-1 rounded-lg" style={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0' }}>
            {STATUSES.map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className="px-2.5 py-1 rounded text-xs font-medium transition-all"
                style={statusFilter === s
                  ? { backgroundColor: '#E2E8F0', color: '#0F172A' }
                  : { color: '#475569' }
                }
              >
                {s}
              </button>
            ))}
          </div>
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
            style={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', color: '#475569' }}
          >
            <DownloadIcon size={12} /> Export
          </button>
        </div>
      </div>

      {/* Severity summary bar */}
      <div
        className="flex items-center gap-3 px-6 py-3 border-b"
        style={{ borderColor: '#F1F5F9', backgroundColor: '#FFFFFF' }}
      >
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#94A3B8' }}>Severity</span>
        <div className="flex items-center gap-1.5 flex-1">
          {/* Visual bar */}
          <div className="flex h-2 rounded-full overflow-hidden flex-1 max-w-xs gap-px">
            {SEV_ORDER.filter(s => counts[s] > 0).map(s => (
              <div
                key={s}
                className="h-full rounded-sm"
                style={{
                  backgroundColor: sevConfig[s].bar,
                  flex: counts[s],
                }}
                title={`${sevConfig[s].label}: ${counts[s]}`}
              />
            ))}
          </div>
          <div className="flex items-center gap-3 ml-2">
            {SEV_ORDER.map(s => (
              <button
                key={s}
                onClick={() => setSevFilter(sevFilter === s ? 'All' : s)}
                className="flex items-center gap-1.5 transition-all"
              >
                <span
                  className="w-2 h-2 rounded-sm"
                  style={{ backgroundColor: sevConfig[s].bar, opacity: counts[s] === 0 ? 0.3 : 1 }}
                />
                <span
                  className="text-[11px] font-medium"
                  style={{
                    color: sevFilter === s ? sevConfig[s].color : '#475569',
                    opacity: counts[s] === 0 ? 0.4 : 1,
                  }}
                >
                  {sevConfig[s].label}
                </span>
                <span
                  className="text-[10px] font-bold px-1.5 py-0 rounded-full"
                  style={{
                    backgroundColor: sevFilter === s ? sevConfig[s].bg : 'rgba(75,85,99,0.2)',
                    color: sevFilter === s ? sevConfig[s].color : '#94A3B8',
                  }}
                >
                  {counts[s]}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Table header */}
      <div
        className="grid text-[10px] font-semibold uppercase tracking-wider px-6 py-2.5 sticky top-0"
        style={{
          gridTemplateColumns: '100px 1fr 140px 110px 90px 90px 110px',
          backgroundColor: '#FFFFFF',
          borderBottom: '1px solid #E2E8F0',
          color: '#94A3B8',
        }}
      >
        <span>Severity</span>
        <span>Title</span>
        <span>Asset</span>
        <span>Status</span>
        <span>Evidence</span>
        <span>Report</span>
        <span>Last Updated</span>
      </div>

      {/* Table rows */}
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 && (
          <div className="flex items-center justify-center h-32">
            <span className="text-sm" style={{ color: '#94A3B8' }}>No findings match your filters</span>
          </div>
        )}
        {filtered.map((f, idx) => {
          const sc = sevConfig[f.severity]
          const st = statusConfig[f.status]
          return (
            <button
              key={f.id}
              onClick={() => setSelectedItem(f)}
              className="w-full grid px-6 py-3 text-left transition-colors"
              style={{
                gridTemplateColumns: '100px 1fr 140px 110px 90px 90px 110px',
                backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC',
                borderBottom: '1px solid #F1F5F9',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = '#F1F5F9' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC' }}
            >
              {/* Severity */}
              <div className="flex items-center">
                <span
                  className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: sc.bg, color: sc.color }}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: sc.bar }} />
                  {sc.label}
                </span>
              </div>

              {/* Title */}
              <div className="flex flex-col justify-center pr-4 min-w-0">
                <span className="text-xs font-semibold truncate" style={{ color: '#0F172A' }}>{f.title}</span>
                {f.cve && (
                  <span className="text-[10px] font-mono mt-0.5" style={{ color: '#3B82F6' }}>{f.cve}</span>
                )}
                {f.cvss && !f.cve && (
                  <span className="text-[10px] mt-0.5" style={{ color: sc.color }}>CVSS {f.cvss}</span>
                )}
              </div>

              {/* Asset */}
              <div className="flex items-center">
                <span className="font-mono text-[11px] truncate" style={{ color: '#475569' }}>{f.asset}</span>
              </div>

              {/* Status */}
              <div className="flex items-center">
                <span
                  className="text-[10px] font-semibold px-2 py-0.5 rounded"
                  style={{ backgroundColor: st.bg, color: st.color }}
                >
                  {f.status}
                </span>
              </div>

              {/* Evidence count */}
              <div className="flex items-center">
                <span
                  className="text-xs font-semibold"
                  style={{ color: f.evidenceCount > 0 ? '#0F172A' : '#94A3B8' }}
                >
                  {f.evidenceCount > 0 ? `${f.evidenceCount} item${f.evidenceCount > 1 ? 's' : ''}` : '—'}
                </span>
              </div>

              {/* Report */}
              <div className="flex items-center">
                <span
                  className="text-[10px] font-semibold px-2 py-0.5 rounded"
                  style={{ backgroundColor: reportConfig[f.report].bg, color: reportConfig[f.report].color }}
                >
                  {f.report}
                </span>
              </div>

              {/* Last updated */}
              <div className="flex items-center gap-1">
                <ClockIcon size={11} style={{ color: '#94A3B8' }} />
                <span className="text-[11px]" style={{ color: '#475569' }}>{f.lastUpdated}</span>
              </div>
            </button>
          )
        })}
      </div>

      {/* Centered Modal */}
      {selectedItem && (
        <FindingModal finding={selectedItem} onClose={() => setSelectedItem(null)} />
      )}

      {/* Drawer (legacy, kept for backwards compat) */}
      {drawer && !selectedItem && (
        <FindingDrawer
          finding={drawer}
          tab={drawerTab}
          onTabChange={setDrawerTab}
          onClose={() => setDrawer(null)}
        />
      )}
    </div>
  )
}

function FindingModal({ finding, onClose }: { finding: Finding; onClose: () => void }) {
  const sc = sevConfig[finding.severity]
  const st = statusConfig[finding.status]
  const poc = extractPoc(finding.reportMarkdown)
  const [pocRunning, setPocRunning] = useState(false)
  const [pocOutput, setPocOutput] = useState<string | null>(null)

  const runPoc = () => {
    setPocRunning(true)
    setPocOutput(null)
    setTimeout(() => {
      setPocRunning(false)
      setPocOutput(
        finding.severity === 'critical' || finding.severity === 'high'
          ? `[+] Target: ${finding.affectedAsset}\n[+] Payload sent successfully\n[+] Response: HTTP 200 OK\n[!] VULNERABILITY CONFIRMED — RCE achieved\n[+] Output: uid=33(www-data) gid=33(www-data) groups=33(www-data)\n[✓] PoC verified at ${new Date().toISOString()}`
          : `[+] Target: ${finding.affectedAsset}\n[+] Payload sent\n[~] Response: HTTP 200 OK\n[~] Behavior matches expected vulnerable pattern\n[✓] PoC verified at ${new Date().toISOString()}`
      )
    }, 1800)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl mx-4 rounded-xl shadow-xl flex flex-col"
        style={{ backgroundColor: '#FFFFFF', maxHeight: '90vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b" style={{ borderColor: '#E2E8F0' }}>
          <div className="flex-1 min-w-0 pr-4">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ backgroundColor: sc.bg, color: sc.color }}
              >
                {sc.label}
              </span>
              {finding.cvss && (
                <span className="text-[11px] font-bold" style={{ color: sc.color }}>CVSS {finding.cvss}</span>
              )}
              {finding.cve && (
                <span
                  className="text-[10px] font-semibold px-2 py-0.5 rounded"
                  style={{ backgroundColor: 'rgba(59,130,246,0.15)', color: '#2563EB' }}
                >
                  {finding.cve}
                </span>
              )}
            </div>
            <h2 className="text-base font-bold leading-snug" style={{ color: '#0F172A' }}>{finding.title}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg transition-colors hover:bg-gray-100"
            style={{ color: '#94A3B8' }}
          >
            <XIcon size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-4">
          {/* Meta grid */}
          <div className="grid grid-cols-2 gap-x-8 gap-y-3">
            <ModalRow label="Asset" value={finding.affectedAsset} mono />
            <ModalRow label="CVSS Score" value={finding.cvss ? String(finding.cvss) : 'N/A'} />
            <ModalRow label="CWE ID" value={finding.cve ? finding.cve.replace('CVE', 'CWE') : 'N/A'} />
            <ModalRow
              label="Status"
              value={finding.status}
              badge
              badgeBg={st.bg}
              badgeColor={st.color}
            />
            <ModalRow label="Discovery Date" value={finding.discoveredDate} />
            {finding.assignedTo && <ModalRow label="Assigned To" value={finding.assignedTo} />}
          </div>

          {/* Description */}
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#94A3B8' }}>Description</div>
            <p className="text-xs leading-relaxed" style={{ color: '#475569' }}>{finding.description}</p>
          </div>

          {/* Evidence (embedded; drawer evidence-tab markup, source kept as-is) */}
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#94A3B8' }}>Evidence</div>
            <div className="space-y-2">
              {finding.evidence.length === 0 && (
                <p className="text-xs text-center py-4" style={{ color: '#94A3B8' }}>
                  No evidence linked
                </p>
              )}
              {finding.evidence.map(ev => (
                <div
                  key={ev.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors"
                  style={{ backgroundColor: '#F1F5F9', border: '1px solid #F1F5F9' }}
                >
                  <span className="text-base">{evidenceTypeIcons[ev.type]}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate" style={{ color: '#0F172A' }}>
                      {ev.title}
                    </div>
                    <div className="text-[10px] capitalize mt-0.5" style={{ color: '#94A3B8' }}>
                      {ev.type.replace('_', ' ')}
                    </div>
                  </div>
                  <ChevronRightIcon size={12} style={{ color: '#94A3B8' }} />
                </div>
              ))}
            </div>
          </div>

          {/* Proof of Concept */}
          {poc && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#94A3B8' }}>Proof of Concept</div>
                <button
                  onClick={runPoc}
                  disabled={pocRunning}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-semibold transition-all"
                  style={{
                    background: pocRunning ? '#F1F5F9' : '#0B0F19',
                    color: pocRunning ? '#94A3B8' : '#22C55E',
                    border: '1px solid #1E2736',
                    cursor: pocRunning ? 'not-allowed' : 'pointer',
                  }}
                >
                  {pocRunning ? (
                    <>
                      <span className="animate-spin inline-block" style={{ width: 10, height: 10, border: '2px solid #94A3B8', borderTopColor: 'transparent', borderRadius: '50%' }} />
                      Running…
                    </>
                  ) : (
                    <>▶ Run PoC</>
                  )}
                </button>
              </div>
              <pre
                className="rounded-lg p-3 text-[11px] leading-relaxed overflow-x-auto"
                style={{ backgroundColor: '#0B0F19', color: '#9CA3AF', fontFamily: 'monospace', border: '1px solid #1E2736' }}
              >
                {poc}
              </pre>
              {pocOutput && (
                <div className="mt-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: '#22C55E' }}>Verification Output</div>
                  <pre
                    className="rounded-lg p-3 text-[11px] leading-relaxed overflow-x-auto"
                    style={{ backgroundColor: '#061A0E', color: '#4ADE80', fontFamily: 'monospace', border: '1px solid #14532D' }}
                  >
                    {pocOutput}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* Remediation */}
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#94A3B8' }}>Remediation</div>
            <p className="text-xs leading-relaxed" style={{ color: '#475569' }}>{finding.remediation}</p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-6 py-4 border-t" style={{ borderColor: '#E2E8F0' }}>
          <button
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold"
            style={{ backgroundColor: '#DC2626', color: '#FFFFFF' }}
          >
            <CheckIcon size={12} /> Mark as Verified
          </button>
          <button
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold"
            style={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', color: '#475569' }}
          >
            <DownloadIcon size={12} /> Export
          </button>
          <button
            onClick={onClose}
            className="ml-auto px-4 py-2 rounded-lg text-xs font-medium"
            style={{ backgroundColor: '#F1F5F9', color: '#475569' }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

function ModalRow({
  label, value, mono, badge, badgeBg, badgeColor,
}: {
  label: string; value: string; mono?: boolean; badge?: boolean; badgeBg?: string; badgeColor?: string
}) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: '#94A3B8' }}>{label}</div>
      {badge ? (
        <span
          className="text-[10px] font-semibold px-2 py-0.5 rounded"
          style={{ backgroundColor: badgeBg, color: badgeColor }}
        >
          {value}
        </span>
      ) : (
        <span
          className={`text-xs font-medium ${mono ? 'font-mono' : ''}`}
          style={{ color: '#475569' }}
        >
          {value}
        </span>
      )}
    </div>
  )
}

function FindingDrawer({
  finding,
  tab,
  onTabChange,
  onClose,
}: {
  finding: Finding
  tab: DrawerTab
  onTabChange: (t: DrawerTab) => void
  onClose: () => void
}) {
  const sc = sevConfig[finding.severity]
  const st = statusConfig[finding.status]

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
        onClick={onClose}
      />
      <div
        className="fixed right-0 top-[56px] bottom-0 z-50 flex flex-col overflow-hidden"
        style={{ width: 480, backgroundColor: '#FFFFFF', borderLeft: '1px solid #E2E8F0' }}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b" style={{ borderColor: '#E2E8F0' }}>
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0 pr-3">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: sc.bg, color: sc.color }}
                >
                  {sc.label}
                </span>
                {finding.cvss && (
                  <span className="text-[11px] font-bold" style={{ color: sc.color }}>
                    CVSS {finding.cvss}
                  </span>
                )}
                {finding.cve && (
                  <span
                    className="text-[10px] font-semibold px-2 py-0.5 rounded"
                    style={{ backgroundColor: 'rgba(59,130,246,0.15)', color: '#2563EB' }}
                  >
                    {finding.cve}
                  </span>
                )}
                <span
                  className="text-[10px] font-semibold px-2 py-0.5 rounded"
                  style={{ backgroundColor: st.bg, color: st.color }}
                >
                  {finding.status}
                </span>
              </div>
              <h3 className="text-sm font-bold leading-snug" style={{ color: '#0F172A' }}>
                {finding.title}
              </h3>
              <div className="font-mono text-[11px] mt-1" style={{ color: '#DC2626' }}>
                {finding.asset}
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded transition-colors"
              style={{ color: '#94A3B8' }}
            >
              <XIcon size={16} />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mt-3">
            {(['summary', 'evidence', 'report'] as DrawerTab[]).map(t => (
              <button
                key={t}
                onClick={() => onTabChange(t)}
                className="px-3 py-1.5 rounded text-xs font-semibold capitalize transition-all"
                style={tab === t
                  ? { backgroundColor: '#E2E8F0', color: '#0F172A' }
                  : { color: '#475569' }
                }
              >
                {t}
                {t === 'evidence' && (
                  <span className="ml-1 text-[10px]" style={{ color: '#94A3B8' }}>
                    {finding.evidenceCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* ─── Summary Tab ─── */}
          {tab === 'summary' && (
            <div className="space-y-5">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: '#94A3B8' }}>
                  Description
                </div>
                <p className="text-xs leading-relaxed" style={{ color: '#475569' }}>
                  {finding.description}
                </p>
              </div>

              <div className="space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: '#94A3B8' }}>
                  Details
                </div>
                <DrawerRow label="Affected Asset" value={finding.affectedAsset} mono />
                <DrawerRow label="Discovered" value={finding.discoveredDate} />
                {finding.assignedTo && <DrawerRow label="Assigned To" value={finding.assignedTo} />}
                <DrawerRow label="Report" value={finding.report} />
              </div>

              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: '#94A3B8' }}>
                  Remediation
                </div>
                <p className="text-xs leading-relaxed" style={{ color: '#475569' }}>
                  {finding.remediation}
                </p>
              </div>
            </div>
          )}

          {/* ─── Evidence Tab ─── */}
          {tab === 'evidence' && (
            <div className="space-y-2">
              {finding.evidence.length === 0 && (
                <p className="text-xs text-center py-8" style={{ color: '#94A3B8' }}>
                  No evidence linked
                </p>
              )}
              {finding.evidence.map(ev => (
                <div
                  key={ev.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors"
                  style={{ backgroundColor: '#F1F5F9', border: '1px solid #F1F5F9' }}
                >
                  <span className="text-base">{evidenceTypeIcons[ev.type]}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate" style={{ color: '#0F172A' }}>
                      {ev.title}
                    </div>
                    <div className="text-[10px] capitalize mt-0.5" style={{ color: '#94A3B8' }}>
                      {ev.type.replace('_', ' ')}
                    </div>
                  </div>
                  <ChevronRightIcon size={12} style={{ color: '#94A3B8' }} />
                </div>
              ))}
            </div>
          )}

          {/* ─── Report Tab ─── */}
          {tab === 'report' && (
            <div>
              <div
                className="rounded-lg p-4 text-xs leading-relaxed"
                style={{
                  backgroundColor: '#F1F5F9',
                  border: '1px solid #F1F5F9',
                  color: '#475569',
                  fontFamily: 'inherit',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {/* Render markdown-ish content as structured text */}
                {finding.reportMarkdown.split('\n').map((line, i) => {
                  if (line.startsWith('## ')) {
                    return (
                      <div key={i} className="text-sm font-bold mb-3 mt-1" style={{ color: '#0F172A' }}>
                        {line.replace('## ', '')}
                      </div>
                    )
                  }
                  if (line.startsWith('### ')) {
                    return (
                      <div key={i} className="text-xs font-semibold mt-3 mb-1" style={{ color: '#0F172A' }}>
                        {line.replace('### ', '')}
                      </div>
                    )
                  }
                  if (line.startsWith('**') && line.endsWith('**')) {
                    return (
                      <div key={i} className="font-semibold mb-1" style={{ color: '#0F172A' }}>
                        {line.replace(/\*\*/g, '')}
                      </div>
                    )
                  }
                  if (line.startsWith('```')) {
                    return null
                  }
                  if (line.trim() === '') {
                    return <div key={i} className="h-2" />
                  }
                  return (
                    <div key={i} style={{ color: '#475569' }}>
                      {line}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="px-5 py-3 border-t flex gap-2"
          style={{ borderColor: '#E2E8F0' }}
        >
          {finding.status === 'Open' && (
            <button
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-colors"
              style={{ backgroundColor: '#DC2626', color: '#fff' }}
            >
              <UserIcon size={12} /> Assign Review
            </button>
          )}
          {finding.status === 'Closed' && (
            <div
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold"
              style={{ backgroundColor: 'rgba(34,197,94,0.15)', color: '#16A34A' }}
            >
              <CheckIcon size={12} /> Closed
            </div>
          )}
          {finding.status === 'In Review' && (
            <button
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold"
              style={{ backgroundColor: 'rgba(245,158,11,0.15)', color: '#F59E0B' }}
            >
              In Review
            </button>
          )}
          {finding.status === 'False Positive' && (
            <div
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold"
              style={{ backgroundColor: 'rgba(107,114,128,0.15)', color: '#475569' }}
            >
              False Positive
            </div>
          )}
          <button
            className="px-3 py-2 rounded-lg text-xs transition-colors"
            style={{ backgroundColor: '#F1F5F9', border: '1px solid #E2E8F0', color: '#475569' }}
          >
            <DownloadIcon size={14} />
          </button>
          <button
            className="px-3 py-2 rounded-lg text-xs transition-colors"
            style={{ backgroundColor: '#F1F5F9', border: '1px solid #E2E8F0', color: '#475569' }}
          >
            <EyeIcon size={14} />
          </button>
        </div>
      </div>
    </>
  )
}

function DrawerRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px]" style={{ color: '#94A3B8' }}>{label}</span>
      <span
        className={`text-[11px] font-medium ${mono ? 'font-mono text-[10px]' : ''}`}
        style={{ color: '#475569' }}
      >
        {value}
      </span>
    </div>
  )
}
