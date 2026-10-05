// Mock evidence fixtures — artifacts linked to FINDINGS_FIXTURES by finding id.
// Single source of truth for the findings ↔ evidence linkage: findings screens
// derive evidence counts from here, evidence screens resolve finding refs here.

import { getFinding } from './findings'
import type { Finding, Severity } from './findings'

export type EvidenceType = 'screenshot' | 'log' | 'extracted_data' | 'tool_output' | 'terminal_capture'

export interface EvidenceItem {
  id: string
  title: string
  type: EvidenceType
  sourceAgent: string
  findingIds: string[]
  timestamp: string
  description: string
  preview: string[]
  tags: string[]
  size: string
}

export interface LinkedFindingRef {
  id: string
  title: string
  severity: Severity
}

export const EVIDENCE_FIXTURES: EvidenceItem[] = [
  {
    id: 'e1',
    title: 'RCE Reverse Shell — www-data',
    type: 'screenshot',
    sourceAgent: 'exploit-agent',
    findingIds: ['1'],
    timestamp: '2 min ago',
    description: 'Screenshot showing successful reverse shell connection from admin.acme-staging.io:8080. Shell session running as www-data. Confirmed RCE via PHP deserialization exploit.',
    preview: [],
    tags: ['rce', 'shell', 'critical'],
    size: '128 KB',
  },
  {
    id: 'e2',
    title: 'Exploit Script Output — CVE-2024-49113',
    type: 'tool_output',
    sourceAgent: 'exploit-agent',
    findingIds: ['1'],
    timestamp: '3 min ago',
    description: 'Output from custom PHP deserialization exploit script targeting AdminLite v2.3.1 upload endpoint.',
    preview: [
      '[*] Target: https://admin.acme-staging.io:8080/admin/upload.php',
      '[+] Payload sent. Awaiting callback on 10.10.14.5:4444...',
    ],
    tags: ['exploit', 'php', 'deserialization'],
    size: '4.2 KB',
  },
  {
    id: 'e3',
    title: '.env File Contents (Redacted)',
    type: 'extracted_data',
    sourceAgent: 'recon-agent',
    findingIds: ['2'],
    timestamp: '5 min ago',
    description: 'Full contents of the exposed .env file at https://api.acme.com/.env. Sensitive values redacted for report.',
    preview: [
      'DB_HOST=10.0.1.22',
      'DB_PASSWORD=••••••••••••••••',
    ],
    tags: ['credentials', 'exposure', 'env'],
    size: '1.8 KB',
  },
  {
    id: 'e4',
    title: 'HTTP 200 Response — .env Accessible',
    type: 'screenshot',
    sourceAgent: 'recon-agent',
    findingIds: ['2'],
    timestamp: '5 min ago',
    description: 'Browser screenshot confirming HTTP 200 response for GET https://api.acme.com/.env, showing plaintext secrets rendered in browser.',
    preview: [],
    tags: ['env', 'http', 'exposure'],
    size: '87 KB',
  },
  {
    id: 'e5',
    title: 'sqlmap Full Output — /api/auth',
    type: 'tool_output',
    sourceAgent: 'sqli-agent',
    findingIds: ['3'],
    timestamp: '10 min ago',
    description: 'Complete sqlmap output confirming UNION-based SQL injection on POST /api/auth username parameter. 3 tables extracted.',
    preview: [
      '[*] testing connection to target URL',
      "[+] GET parameter 'username' is vulnerable. Do you want to keep testing?",
    ],
    tags: ['sqli', 'sqlmap', 'auth'],
    size: '23.4 KB',
  },
  {
    id: 'e6',
    title: 'Extracted Users Table',
    type: 'extracted_data',
    sourceAgent: 'sqli-agent',
    findingIds: ['3'],
    timestamp: '11 min ago',
    description: 'CSV dump of the `users` table extracted via SQL injection. Contains 47 records with email, bcrypt hashes, and account flags.',
    preview: [
      'id,email,password_hash,role,created_at',
      '1,admin@acme.com,$2b$12$LQ...,admin,2024-01-10',
    ],
    tags: ['sqli', 'data-extraction', 'users'],
    size: '8.1 KB',
  },
  {
    id: 'e7',
    title: 'Terminal Capture — SSH Lateral Movement',
    type: 'terminal_capture',
    sourceAgent: 'post-exploit-agent',
    findingIds: ['1', '10'],
    timestamp: '15 min ago',
    description: 'Full terminal session recording showing lateral movement from web server to domain controller using extracted service account credentials.',
    preview: [
      'www-data@web01:~$ cat /etc/passwd | grep svc_backup',
      'svc_backup:x:1002:1002::/home/svc_backup:/bin/bash',
    ],
    tags: ['lateral-movement', 'ssh', 'post-exploit'],
    size: '64.0 KB',
  },
  {
    id: 'e8',
    title: 'FortiGate CVE-2022-42475 PoC Output',
    type: 'tool_output',
    sourceAgent: 'vuln-agent',
    findingIds: ['6'],
    timestamp: '30 min ago',
    description: 'Output from public PoC for CVE-2022-42475. Confirms the target is running vulnerable FortiOS 7.2.0 and is susceptible to unauthenticated session takeover.',
    preview: [
      '[*] Checking target vpn.acme.com for CVE-2022-42475...',
      '[+] VULNERABLE: FortiOS 7.2.0 detected. Proceeding with exploit...',
    ],
    tags: ['fortinet', 'vpn', 'cve-2022-42475'],
    size: '3.7 KB',
  },
  {
    id: 'e9',
    title: 'Admin Panel Access Screenshot',
    type: 'screenshot',
    sourceAgent: 'recon-agent',
    findingIds: ['5'],
    timestamp: '25 min ago',
    description: 'Screenshot confirming unauthenticated access to the admin panel at admin.acme-staging.io from external IP 203.0.113.5. Full dashboard visible without credentials.',
    preview: [],
    tags: ['admin', 'unauth', 'staging'],
    size: '212 KB',
  },
  {
    id: 'e10',
    title: 'LDAP Enumeration — svc_backup Account',
    type: 'log',
    sourceAgent: 'ad-enum-agent',
    findingIds: ['10'],
    timestamp: '2.5 hours ago',
    description: 'LDAP enumeration log confirming svc_backup membership in Domain Admins group and last password change timestamp.',
    preview: [
      'dn: CN=svc_backup,OU=Service Accounts,DC=acme,DC=com',
      'memberOf: CN=Domain Admins,CN=Users,DC=acme,DC=com',
    ],
    tags: ['ldap', 'ad', 'service-account'],
    size: '6.3 KB',
  },
  {
    id: 'e11',
    title: 'ssh-audit Output — Weak Ciphers',
    type: 'tool_output',
    sourceAgent: 'nmap-agent',
    findingIds: ['11'],
    timestamp: '3 hours ago',
    description: 'ssh-audit scan output against 10.0.1.45:22 showing deprecated cipher suites and weak key exchange algorithms.',
    preview: [
      '(rec) -arcfour        -- enc algorithm to avoid',
      '(rec) -3des-cbc       -- enc algorithm to avoid',
    ],
    tags: ['ssh', 'crypto', 'audit'],
    size: '2.1 KB',
  },
  {
    id: 'e12',
    title: 'Swagger UI — Internal API Endpoints',
    type: 'screenshot',
    sourceAgent: 'recon-agent',
    findingIds: ['12'],
    timestamp: '4 hours ago',
    description: 'Screenshot of Swagger UI at dev.acme.com exposing 47 internal API endpoints including admin routes and webhook configurations.',
    preview: [],
    tags: ['swagger', 'dev', 'api-disclosure'],
    size: '345 KB',
  },
  {
    id: 'e13',
    title: 'Forged JWT Token Payload',
    type: 'tool_output',
    sourceAgent: 'exploit-agent',
    findingIds: ['4'],
    timestamp: '20 min ago',
    description: 'Decoded payload of the forged JWT accepted by the API. Header declares alg:none and the claim set impersonates an administrator account.',
    preview: [
      '{ "alg": "none", "typ": "JWT" }',
      '{ "sub": "admin", "role": "administrator", "iat": 1726550000 }',
    ],
    tags: ['jwt', 'auth-bypass', 'privesc'],
    size: '1.2 KB',
  },
  {
    id: 'e14',
    title: 'Tomcat Manager Login Screenshot',
    type: 'screenshot',
    sourceAgent: 'vuln-agent',
    findingIds: ['7'],
    timestamp: '1 hour ago',
    description: 'Screenshot of the Tomcat Manager dashboard at 10.0.1.45:8080/manager after signing in with default credentials tomcat/tomcat.',
    preview: [],
    tags: ['tomcat', 'default-creds'],
    size: '96 KB',
  },
  {
    id: 'e15',
    title: 'WAR Deploy Log — Manager Access',
    type: 'log',
    sourceAgent: 'post-exploit-agent',
    findingIds: ['7'],
    timestamp: '1.1 hours ago',
    description: 'Tomcat catalina.out excerpt recording the test WAR deployment used to confirm manager access. Deployment was removed during remediation.',
    preview: [
      '[INFO] Deploying web application archive /manager/audit-test.war',
      '[INFO] Deployment of audit-test.war finished in 812 ms',
    ],
    tags: ['tomcat', 'deploy', 'log'],
    size: '2.9 KB',
  },
  {
    id: 'e16',
    title: 'XSS PoC — Hash Route Payload',
    type: 'screenshot',
    sourceAgent: 'vuln-agent',
    findingIds: ['8'],
    timestamp: '1.5 hours ago',
    description: 'Screenshot showing the jQuery html() XSS payload executed from a crafted hash route on portal.acme.com.',
    preview: [],
    tags: ['xss', 'jquery', 'dom'],
    size: '74 KB',
  },
  {
    id: 'e17',
    title: 'HTTP Headers — Missing HSTS',
    type: 'log',
    sourceAgent: 'recon-agent',
    findingIds: ['9'],
    timestamp: '2 hours ago',
    description: 'Response header capture for https://acme.com showing no Strict-Transport-Security header at origin. Marked false positive — HSTS is enforced at the CDN layer.',
    preview: [
      'HTTP/1.1 200 OK',
      'strict-transport-security: (not present)',
    ],
    tags: ['hsts', 'headers', 'false-positive'],
    size: '1.1 KB',
  },
  {
    id: 'e18',
    title: 'openssl Certificate Output — 10.0.1.22',
    type: 'log',
    sourceAgent: 'nmap-agent',
    findingIds: ['13'],
    timestamp: '5 hours ago',
    description: 'openssl s_client output showing the expired TLS certificate presented by 10.0.1.22:443.',
    preview: [
      'notAfter=Jan  1 00:00:00 2025 GMT',
      'verify error: certificate has expired',
    ],
    tags: ['tls', 'certificate', 'expired'],
    size: '1.6 KB',
  },
]

export function evidenceForFinding(findingId: string): EvidenceItem[] {
  return EVIDENCE_FIXTURES.filter(item => item.findingIds.includes(findingId))
}

export function linkedFindingsFor(item: EvidenceItem): LinkedFindingRef[] {
  const refs: LinkedFindingRef[] = []
  for (const id of item.findingIds) {
    const finding = getFinding(id)
    if (finding) refs.push({ id: finding.id, title: finding.title, severity: finding.severity })
  }
  return refs
}

export function findingTitle(findingId: string): string {
  const finding: Finding | undefined = getFinding(findingId)
  return finding ? finding.title : findingId
}
