import type { ReportDocumentDef, ReportMeta } from '../../features/reports/types'

// Sample report fixtures for the demo archive project (SAMPLE_PROJECT_ID in
// findings.ts). Authors are the local single-user operator — no fabricated
// team members. Severity totals mirror the actual FINDINGS_FIXTURES counts.
export const REPORT_FIXTURES: ReportMeta[] = [
  { id: 'r1', title: 'Acme Corp External Assessment — Full Technical Report', type: 'Full Technical', status: 'In Review', framework: 'NIST 800-115', author: 'Local Operator', modified: '2026-09-28', pages: 84, words: 32400 },
  { id: 'r2', title: 'Acme Corp External Assessment — Executive Summary', type: 'Executive Summary', status: 'Draft', framework: 'OWASP Top 10', author: 'Local Operator', modified: '2026-09-27', pages: 8, words: 3100 },
  { id: 'r3', title: 'AD Lateral Movement — Remediation Playbook', type: 'Remediation Playbook', framework: 'MITRE ATT&CK', status: 'Approved', author: 'Local Operator', modified: '2026-09-25', pages: 22, words: 8900 },
  { id: 'r4', title: 'Penetration Test Attestation Letter — ISO 27001', type: 'Attestation Certificate', status: 'Delivered', framework: 'ISO 27001', author: 'Local Operator', modified: '2026-09-20', pages: 3, words: 980 },
]

export const DEMO_REPORT_DOCUMENT: ReportDocumentDef = {
  classification: 'CONFIDENTIAL // TLP:AMBER',
  sections: [
    {
      def: { num: '1', title: 'Executive Summary', sub: ['Scope Overview', 'Crown Jewels Impact', 'Risk Score'] },
      blocks: [
        { kind: 'paragraph', text: "This report presents the findings of a comprehensive external penetration test conducted against Acme Corporation's internet-facing infrastructure between September 10–28, 2026." },
        { kind: 'riskScore', level: 'CRITICAL', cvss: '9.8' },
        {
          kind: 'table',
          columns: ['Severity', 'Count', '% Total'],
          severityColorColumns: [0],
          rows: [
            ['Critical', '4', '31%'],
            ['High', '5', '38%'],
            ['Medium', '3', '23%'],
            ['Low', '1', '8%'],
          ],
        },
        { kind: 'note', tone: 'success', title: 'Crown Jewels Impact', text: '1 of 5 crown jewel objectives achieved during this engagement.' },
      ],
    },
    {
      def: { num: '2', title: 'Engagement Methodology', sub: ['Rules of Engagement', 'Testing Window'] },
      blocks: [
        { kind: 'paragraph', text: 'The engagement followed a black-box external penetration testing methodology aligned to NIST SP 800-115 and PTES (Penetration Testing Execution Standard). All activities were conducted from external IP ranges without prior knowledge of the internal environment.' },
        { kind: 'note', tone: 'info', title: 'Rules of Engagement', text: 'Active exploitation permitted against in-scope targets. DoS techniques prohibited. HITL approval required for domain controller attacks.' },
        { kind: 'note', tone: 'info', title: 'Testing Window', text: 'September 10–28, 2026 (weekdays, 08:00–22:00 EST)' },
      ],
    },
    {
      def: { num: '3', title: 'Attack Narrative', sub: ['Phase 1: Initial Foothold', 'Phase 2: Lateral Movement', 'Phase 3: Objectives'] },
      blocks: [
        {
          kind: 'phases',
          items: [
            { state: 'completed', title: 'Phase 1: Initial Foothold', text: 'Initial foothold established via unauthenticated RCE on AdminLite v2.3.1 (CVE-2024-49113). Reverse shell obtained as www-data on WEB-01 (10.10.1.10).' },
            { state: 'active', title: 'Phase 2: Lateral Movement', text: 'Lateral movement achieved via SMB relay from WEB-01 to DEV-WS-01. Credentials for jdavis (local admin) captured via Responder.' },
            { state: 'pending', title: 'Phase 3: Objectives', text: 'NTDS.dit dump pending HITL approval on DC-01 (10.10.14.67).' },
          ],
        },
        {
          kind: 'code',
          code: `$ secretsdump.py jdavis:Password123@10.10.14.67
[*] Dumping Domain Credentials (domain\\uid:rid:lmhash:nthash)
Administrator:500:aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c0:::
svc_backup:1103:aad3b435b51404eeaad3b435b51404ee:e4c3b5d8a9f7234e12bc3a5d789ea041:::`,
        },
      ],
    },
    {
      def: { num: '4', title: 'Findings Matrix', sub: ['Critical Findings', 'High Findings', 'Risk Summary'] },
      blocks: [
        {
          kind: 'table',
          columns: ['ID', 'Severity', 'Title', 'CVSS', 'Asset', 'Status'],
          severityColorColumns: [1, 3],
          rows: [
            ['1', 'Critical', 'Unauthenticated RCE via PHP Deserialization', '9.8', 'admin.acme-staging.io:8080', 'In Review'],
            ['2', 'Critical', 'Exposed .env File with Plaintext Credentials', '9.1', 'api.acme.com/.env', 'Open'],
            ['3', 'High', 'SQL Injection on Login Endpoint', '8.2', 'api.acme.com/api/auth', 'Open'],
          ],
        },
      ],
    },
    {
      def: { num: '5', title: 'Remediation Roadmap', sub: ['Priority Actions', 'Effort-Impact Matrix'] },
      blocks: [
        { kind: 'paragraph', text: 'The following priority actions are recommended based on exploitability and business impact. Each item includes estimated effort and risk reduction.' },
        {
          kind: 'steps',
          items: [
            { action: 'Patch AdminLite to v2.4.0 or later (CVE-2024-49113)', effort: 'Low', impact: 'Critical' },
            { action: 'Enable SMB Signing on all domain-joined hosts via GPO', effort: 'Low', impact: 'High' },
            { action: 'Segment WEB-01 from internal corporate network', effort: 'Medium', impact: 'Critical' },
          ],
        },
      ],
    },
  ],
}
