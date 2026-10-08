// Mock findings fixtures — sample engagement data for the demo build.
// Read-only: the backend contract (GET /api/engagements/:id/findings) parses
// FIND-*.md and has no review/mutation API, so these fixtures are display-only.
// Provenance: this sample set belongs to the demo archive project only
// (SAMPLE_PROJECT_ID); other demo projects have no findings recorded here.

// The only project whose demo fixtures represent recorded outcomes.
export const SAMPLE_PROJECT_ID = '1'

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'
export type FindingStatus = 'Open' | 'In Review' | 'Closed' | 'False Positive'
export type ReportStatus = 'Draft' | 'Generated' | 'Approved'

export interface Finding {
  id: string
  title: string
  severity: Severity
  asset: string
  status: FindingStatus
  report: ReportStatus
  lastUpdated: string
  cve?: string
  cvss?: number
  description: string
  affectedAsset: string
  discoveredDate: string
  assignedTo?: string
  remediation: string
  reportMarkdown: string
}

export const FINDINGS_FIXTURES: Finding[] = [
  {
    id: '1',
    title: 'Unauthenticated RCE via PHP Deserialization',
    severity: 'critical',
    asset: 'admin.acme-staging.io',
    status: 'In Review',
    report: 'Generated',
    lastUpdated: '2 min ago',
    cve: 'CVE-2024-49113',
    cvss: 9.8,
    description: 'AdminLite v2.3.1 contains a PHP deserialization vulnerability that allows unauthenticated remote code execution. An attacker can send a crafted POST request to `/admin/upload.php` to achieve RCE with web server privileges. This was confirmed by obtaining a reverse shell.',
    affectedAsset: 'admin.acme-staging.io:8080',
    discoveredDate: '2026-09-18',
    assignedTo: 'Local Operator',
    remediation: 'Upgrade AdminLite to version 2.3.2 or later. Apply input validation and avoid deserializing untrusted data. Implement a WAF rule to block crafted POST requests to the upload endpoint.',
    reportMarkdown: `## Finding: Unauthenticated RCE via PHP Deserialization\n\n**Severity:** Critical (CVSS 9.8)\n**CVE:** CVE-2024-49113\n\n### Summary\n\nAn unauthenticated remote code execution vulnerability was discovered in AdminLite v2.3.1 running on \`admin.acme-staging.io:8080\`. The vulnerability stems from unsafe PHP object deserialization in the file upload handler.\n\n### Technical Details\n\nThe endpoint \`/admin/upload.php\` accepts serialized PHP objects without validation. By crafting a malicious payload, an attacker can trigger arbitrary code execution as the \`www-data\` user.\n\n**Proof of Concept:**\n\`\`\`\ncurl -X POST https://admin.acme-staging.io:8080/admin/upload.php \\\n  -d 'file=O:8:"stdClass":1:{s:4:"exec";s:6:"id"}'\n\`\`\`\n\n### Impact\n\nFull server compromise. Attacker can read sensitive files, pivot to internal network, install backdoors.\n\n### Remediation\n\nUpgrade to AdminLite ≥ 2.3.2. Disable PHP deserialization or use \`json_decode()\` instead. Apply WAF rules.`,
  },
  {
    id: '2',
    title: 'Exposed .env File with Plaintext Credentials',
    severity: 'critical',
    asset: 'api.acme.com',
    status: 'Open',
    report: 'Draft',
    lastUpdated: '5 min ago',
    cvss: 9.1,
    description: 'The application root exposes a `.env` file via HTTP, containing plaintext database credentials, API keys, and secret tokens. This file is publicly accessible without authentication from any IP.',
    affectedAsset: 'api.acme.com/.env',
    discoveredDate: '2026-09-18',
    remediation: 'Immediately rotate all exposed credentials. Block direct access to `.env` files via web server configuration. Ensure `.env` files are excluded from web-accessible directories.',
    reportMarkdown: `## Finding: Exposed .env File with Plaintext Credentials\n\n**Severity:** Critical (CVSS 9.1)\n\n### Summary\n\nA \`.env\` configuration file is publicly accessible at \`https://api.acme.com/.env\`, exposing database passwords, API keys, and JWT secrets in plaintext.\n\n### Technical Details\n\n**Request:**\n\`\`\`\nGET https://api.acme.com/.env HTTP/1.1\nResponse: 200 OK\n\`\`\`\n\n**Exposed Secrets:**\n- DB_PASSWORD: ••••••••\n- API_SECRET: ••••••••\n- JWT_SECRET: ••••••••\n\n### Impact\n\nFull access to backend database. Ability to forge JWT tokens. Third-party API access with acme.com's credentials.\n\n### Remediation\n\nRotate all secrets immediately. Configure web server to return 403 for .env files.`,
  },
  {
    id: '3',
    title: 'SQL Injection on Login Endpoint',
    severity: 'high',
    asset: 'api.acme.com',
    status: 'Open',
    report: 'Draft',
    lastUpdated: '10 min ago',
    cvss: 8.2,
    description: 'The `username` parameter in POST /api/auth is vulnerable to UNION-based SQL injection. Exploitation allows full database enumeration, credential extraction, and potential authentication bypass.',
    affectedAsset: 'api.acme.com/api/auth',
    discoveredDate: '2026-09-18',
    remediation: 'Use parameterized queries or prepared statements for all database interactions. Implement an ORM with built-in SQL injection protection. Deploy a WAF with SQL injection detection rules.',
    reportMarkdown: `## Finding: SQL Injection on Login Endpoint\n\n**Severity:** High (CVSS 8.2)\n\n### Summary\n\nA UNION-based SQL injection was identified in the \`username\` parameter of \`POST /api/auth\`.\n\n### Payload\n\n\`\`\`sql\nusername=admin' UNION SELECT 1,username,password,4 FROM users--\n\`\`\`\n\n### Extracted Data\n\n3 tables extracted: users, sessions, api_keys. 47 user records retrieved including password hashes.\n\n### Remediation\n\nReplace string concatenation with parameterized queries. Enforce least-privilege DB accounts.`,
  },
  {
    id: '4',
    title: 'JWT Algorithm Confusion Attack',
    severity: 'high',
    asset: 'api.acme.com',
    status: 'In Review',
    report: 'Generated',
    lastUpdated: '20 min ago',
    cvss: 7.8,
    description: 'The API accepts JWTs signed with the `none` algorithm, allowing token forgery without the secret key. An attacker can impersonate any user including administrators by crafting unsigned tokens.',
    affectedAsset: 'api.acme.com/api/v1/*',
    discoveredDate: '2026-09-17',
    assignedTo: 'Local Operator',
    remediation: 'Explicitly reject tokens with algorithm `none`. Pin the expected algorithm server-side and reject any deviation.',
    reportMarkdown: `## Finding: JWT Algorithm Confusion Attack\n\n**Severity:** High (CVSS 7.8)\n\n### Summary\n\nThe API accepts JWTs signed with \`alg: none\`, allowing unauthenticated token forgery and privilege escalation to administrator.\n\n### Proof of Concept\n\nForged JWT with \`sub: admin\` and \`alg: none\` was accepted by the API, granting full admin access.\n\n### Remediation\n\nExplicitly validate JWT algorithm server-side. Reject \`none\` and pin to expected algorithm (e.g., RS256).`,
  },
  {
    id: '5',
    title: 'Unauthenticated Admin Panel Access',
    severity: 'high',
    asset: 'admin.acme-staging.io',
    status: 'Open',
    report: 'Draft',
    lastUpdated: '25 min ago',
    cvss: 7.3,
    description: 'The admin panel is accessible from external IPs without IP allowlisting or additional authentication. All admin functionality — including user management, config changes, and data exports — is exposed.',
    affectedAsset: 'admin.acme-staging.io',
    discoveredDate: '2026-09-17',
    remediation: 'Implement IP allowlisting for the admin panel. Require MFA for all admin logins. Move the panel off the public internet.',
    reportMarkdown: `## Finding: Unauthenticated Admin Panel Access\n\n**Severity:** High (CVSS 7.3)\n\n### Summary\n\nAdmin panel accessible from external IP without restriction.\n\n### Remediation\n\nImplement IP allowlisting and MFA.`,
  },
  {
    id: '6',
    title: 'FortiGate SSL-VPN Auth Bypass',
    severity: 'critical',
    asset: 'vpn.acme.com',
    status: 'Open',
    report: 'Draft',
    lastUpdated: '30 min ago',
    cve: 'CVE-2022-42475',
    cvss: 9.3,
    description: 'FortiOS and FortiProxy SSL-VPN are vulnerable to an authentication bypass that allows unauthenticated attackers to obtain administrator session via specially crafted HTTP requests.',
    affectedAsset: 'vpn.acme.com',
    discoveredDate: '2026-09-18',
    remediation: 'Upgrade FortiOS to 7.2.3 or later. Apply the vendor-provided patch. Monitor VPN logs for unusual session activity.',
    reportMarkdown: `## Finding: FortiGate SSL-VPN Auth Bypass (CVE-2022-42475)\n\n**Severity:** Critical (CVSS 9.3)\n\n### Summary\n\nFortiGate SSL-VPN at \`vpn.acme.com\` is running a version vulnerable to CVE-2022-42475, allowing session hijack without credentials.\n\n### Remediation\n\nUpgrade FortiOS immediately to 7.2.3+.`,
  },
  {
    id: '7',
    title: 'Tomcat Manager Default Credentials',
    severity: 'critical',
    asset: '10.0.1.45',
    status: 'Closed',
    report: 'Approved',
    lastUpdated: '1 hour ago',
    cvss: 9.0,
    description: 'Apache Tomcat Manager interface accessible on port 8080 with default credentials (tomcat/tomcat). Access allows WAR file deployment and full server compromise.',
    affectedAsset: '10.0.1.45:8080/manager',
    discoveredDate: '2026-09-16',
    assignedTo: 'Local Operator',
    remediation: 'Change default credentials immediately. Restrict Tomcat Manager access to localhost or management network only. Disable the manager if not needed.',
    reportMarkdown: `## Finding: Tomcat Manager Default Credentials\n\n**Severity:** Critical (CVSS 9.0) — CLOSED\n\n### Summary\n\nTomcat Manager at 10.0.1.45:8080 was accessible with credentials \`tomcat/tomcat\`. Remediated on 2026-09-17.\n\n### Resolution\n\nCredentials changed. Manager interface restricted to internal network.`,
  },
  {
    id: '8',
    title: 'Outdated jQuery with XSS Vector',
    severity: 'medium',
    asset: 'portal.acme.com',
    status: 'Open',
    report: 'Draft',
    lastUpdated: '1.5 hours ago',
    cve: 'CVE-2020-11022',
    cvss: 5.1,
    description: 'The application uses jQuery 1.7.1, vulnerable to XSS in `html()` calls when unsanitized user input is rendered. Exploitable via hash-based routing.',
    affectedAsset: 'portal.acme.com',
    discoveredDate: '2026-09-17',
    remediation: 'Upgrade jQuery to 3.7.1 or later. Sanitize all user-supplied data before passing to jQuery DOM manipulation methods.',
    reportMarkdown: `## Finding: Outdated jQuery XSS (CVE-2020-11022)\n\n**Severity:** Medium (CVSS 5.1)\n\n### Summary\n\nPortal uses jQuery 1.7.1 with known XSS vulnerability in \`html()\`.\n\n### Remediation\n\nUpgrade to jQuery 3.7.1+.`,
  },
  {
    id: '9',
    title: 'Missing HSTS Header on HTTPS Endpoints',
    severity: 'medium',
    asset: 'acme.com',
    status: 'False Positive',
    report: 'Approved',
    lastUpdated: '2 hours ago',
    cvss: 4.3,
    description: 'No Strict-Transport-Security header set, allowing potential protocol downgrade attacks. Accepted as false positive — client uses a CDN that handles HSTS.',
    affectedAsset: 'acme.com',
    discoveredDate: '2026-09-16',
    assignedTo: 'Local Operator',
    remediation: 'N/A — HSTS is configured at CDN level.',
    reportMarkdown: `## Finding: Missing HSTS — False Positive\n\n**Severity:** Medium — FALSE POSITIVE\n\n### Notes\n\nHSTS is applied at CloudFront CDN layer. Not present at origin but effective for all clients.`,
  },
  {
    id: '10',
    title: 'Service Account with Domain Admin Rights',
    severity: 'high',
    asset: '10.0.1.45',
    status: 'Open',
    report: 'Draft',
    lastUpdated: '2.5 hours ago',
    cvss: 7.5,
    description: 'Service account `svc_backup` holds Domain Admin privileges with a password that has not been changed in 900+ days. If compromised, it grants full domain control.',
    affectedAsset: 'ACME\\svc_backup',
    discoveredDate: '2026-09-18',
    remediation: 'Remove Domain Admin rights from svc_backup. Rotate the password. Implement LAPS for service accounts. Enable audit logging for privileged account usage.',
    reportMarkdown: `## Finding: Service Account with Domain Admin Rights\n\n**Severity:** High (CVSS 7.5)\n\n### Summary\n\nsvc_backup has Domain Admin rights and an unchanged password (900+ days).\n\n### Remediation\n\nRemove excessive privileges. Rotate credentials. Enable LAPS.`,
  },
  {
    id: '11',
    title: 'Weak SSH Cipher Suites Enabled',
    severity: 'medium',
    asset: '10.0.1.45',
    status: 'Open',
    report: 'Draft',
    lastUpdated: '3 hours ago',
    cvss: 4.8,
    description: 'The SSH service on port 22 supports deprecated cipher suites including arcfour and 3des-cbc, which are known to be weak and susceptible to theoretical attacks.',
    affectedAsset: '10.0.1.45:22',
    discoveredDate: '2026-09-18',
    remediation: 'Disable weak cipher suites in /etc/ssh/sshd_config. Allow only strong ciphers: chacha20-poly1305, aes256-gcm.',
    reportMarkdown: `## Finding: Weak SSH Cipher Suites\n\n**Severity:** Medium (CVSS 4.8)\n\n### Summary\n\nSSH service supports deprecated arcfour and 3des-cbc cipher suites.\n\n### Remediation\n\nUpdate sshd_config to allow only strong modern ciphers.`,
  },
  {
    id: '12',
    title: 'Development Environment Publicly Accessible',
    severity: 'high',
    asset: 'dev.acme.com',
    status: 'In Review',
    report: 'Generated',
    lastUpdated: '4 hours ago',
    cvss: 7.2,
    description: 'The development environment is publicly accessible on the internet, exposing Swagger UI with full API documentation, internal API endpoints, and debug endpoints with verbose error messages.',
    affectedAsset: 'dev.acme.com',
    discoveredDate: '2026-09-17',
    assignedTo: 'Local Operator',
    remediation: 'Restrict dev.acme.com to internal network only. Implement authentication. Remove Swagger UI from production-facing hosts.',
    reportMarkdown: `## Finding: Development Environment Publicly Accessible\n\n**Severity:** High (CVSS 7.2)\n\n### Summary\n\ndev.acme.com is internet-facing with Swagger UI exposing full internal API structure.\n\n### Remediation\n\nRestrict to internal network. Require auth. Remove Swagger in public-facing environments.`,
  },
  {
    id: '13',
    title: 'Expired TLS Certificate on Internal Host',
    severity: 'low',
    asset: '10.0.1.22',
    status: 'Open',
    report: 'Draft',
    lastUpdated: '5 hours ago',
    cvss: 2.6,
    description: 'TLS certificate on 10.0.1.22:443 expired on 2025-01-01. While only affecting internal clients, this creates potential for MITM within the internal network.',
    affectedAsset: '10.0.1.22:443',
    discoveredDate: '2026-09-18',
    remediation: "Renew the TLS certificate. Automate certificate renewal using Let's Encrypt or internal PKI.",
    reportMarkdown: `## Finding: Expired TLS Certificate\n\n**Severity:** Low (CVSS 2.6)\n\n### Summary\n\nTLS cert expired Jan 2025 on internal host 10.0.1.22.\n\n### Remediation\n\nRenew certificate. Automate with ACME protocol.`,
  },
]

export function getFinding(findingId: string): Finding | undefined {
  return FINDINGS_FIXTURES.find(finding => finding.id === findingId)
}
