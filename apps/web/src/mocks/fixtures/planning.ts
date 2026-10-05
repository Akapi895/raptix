// Sample planning fixtures shared across demo projects. Rendered read-only
// with explicit MOCK labels in the Charter and ScopeBoundaries screens —
// none of this data comes from a live engagement, and nothing here is
// machine-enforced (enforcement of RoE/scope happens in the backend
// engagement runtime, not in this console).

import type { PlanningBundle, ScopeFixture } from '../../features/planning/types'

export const SAMPLE_PLANNING_BUNDLE: PlanningBundle = {
  sourceNote:
    'Sample planning bundle shared across demo projects in this build. ' +
    'Rendered read-only; the console does not write to engagement state.',
  roe: {
    authorizedScope: [
      'acme-corp.com and known subdomains (external)',
      'api.acme-corp.com (external API)',
      '10.10.0.0/24 — internal LAN',
      '10.10.14.0/24 — DMZ',
      'dev.acme-staging.io (staging)',
    ],
    exclusions: [
      '10.10.5.0/24 — production payment systems (PCI-DSS)',
      'hospital-mgmt.acme-corp.com — HIPAA-protected patient data',
      '192.168.99.0/24 — HR & payroll systems (PII, legal hold)',
    ],
    testingWindows: [
      { label: 'Mon–Fri', window: '22:00 — 05:00 UTC', allowed: true },
      { label: 'Weekends', window: '00:00 — 23:59 UTC', allowed: true },
      { label: 'Business hours (09:00–18:00)', window: 'No testing', allowed: false },
    ],
    rules: [
      { title: 'Denial of Service (DoS/DDoS) attacks', detail: 'Risk of service disruption impacting production systems' },
      { title: 'Ransomware deployment or simulation', detail: 'Catastrophic data risk even in simulation mode' },
      { title: 'C-Level / executive phishing without approval', detail: 'Requires White Team sign-off per campaign addendum' },
      { title: 'Physical facility access', detail: 'Outside engagement scope — requires separate authorization' },
      { title: 'Data exfiltration > 10MB without approval', detail: 'Exceeds agreed data handling limits' },
      { title: 'Third-party / partner systems outside scope', detail: 'No authorization for systems not listed in the RoE' },
    ],
    legalAuthorization:
      'Master Services Agreement and Statement of Work referenced in project intake. ' +
      'Authorization confirmation is recorded as project metadata; signed document files, ' +
      'signatures and hashes are not managed by this console.',
  },
  conops: {
    threatModel:
      'Emulates a financially motivated intrusion set (tier-2 adversary): initial access ' +
      'against exposed external services, followed by lateral movement over SMB/Kerberos. ' +
      'TTP selection is scoped to the RoE; noisy techniques are avoided inside business hours.',
    phases: [
      { name: 'recon', goal: 'Port scanning, service and subdomain enumeration; populate attack surface picture' },
      { name: 'initial-access', goal: 'Exploit public-facing services and phishing-aligned paths permitted by the RoE' },
      { name: 'post-exploit', goal: 'Privilege escalation and credential harvesting inside authorized ranges' },
      { name: 'c2', goal: 'Maintain command and control from authorized egress only' },
      { name: 'exfiltration', goal: 'Simulated data handling within the 10MB limit and data-handling plan' },
    ],
  },
  deconfliction: {
    sourceIps: [
      '198.51.100.20 — primary egress (authorized)',
      '198.51.100.21 — backup egress (authorized)',
    ],
    userAgents: [
      'Mozilla/5.0 (compatible; RA-SCAN/2.1) — marked scanning fleet',
      'RA-Deconflict/1.2 — validation requests',
    ],
    timeWindows: ['Mon–Fri 22:00–05:00 UTC', 'Weekends 00:00–23:59 UTC'],
    sharedCode: 'RD-ACME-7Q2 — quote this code when calling the SOC to deconflict an alert',
  },
  opplan: {
    objectives: [
      {
        id: 'OBJ-001',
        title: 'Port scan and service enumeration',
        phase: 'recon',
        opsecLevel: 'standard',
        mitre: ['T1595', 'T1046'],
        dependsOn: [],
        acceptanceCriteria: 'All open ports identified with service versions',
        status: 'completed',
      },
      {
        id: 'OBJ-002',
        title: 'Establish initial foothold (External → Internal)',
        phase: 'initial-access',
        opsecLevel: 'standard',
        mitre: ['T1190'],
        dependsOn: ['OBJ-001'],
        acceptanceCriteria: 'Working code execution on an authorized DMZ web host',
        status: 'in-progress',
      },
      {
        id: 'OBJ-003',
        title: 'Achieve Domain Admin / DCSync rights',
        phase: 'post-exploit',
        opsecLevel: 'careful',
        mitre: ['T1003.006'],
        dependsOn: ['OBJ-002'],
        acceptanceCriteria: 'DCSync executable against an authorized domain controller',
        status: 'pending',
      },
      {
        id: 'OBJ-004',
        title: 'Compromise CEO email account',
        phase: 'initial-access',
        opsecLevel: 'quiet',
        mitre: ['T1566'],
        dependsOn: ['OBJ-001'],
        acceptanceCriteria: 'Mailbox access demonstrated on the phishing-allowed persona list',
        status: 'blocked',
      },
      {
        id: 'OBJ-005',
        title: 'Plant persistence on Domain Controller',
        phase: 'c2',
        opsecLevel: 'careful',
        mitre: ['T1505'],
        dependsOn: ['OBJ-003'],
        acceptanceCriteria: 'Persistence mechanism documented with cleanup command',
        status: 'pending',
      },
      {
        id: 'OBJ-006',
        title: 'Exfiltrate customer database (simulated)',
        phase: 'exfiltration',
        opsecLevel: 'careful',
        mitre: ['T1041'],
        dependsOn: ['OBJ-003'],
        acceptanceCriteria: 'Simulated transfer under the 10MB RoE limit, evidence recorded',
        status: 'pending',
      },
    ],
  },
}

export const SAMPLE_SCOPE: ScopeFixture = {
  sourceNote:
    'Sample scope derived from the RoE fixture, shared across demo projects in this build. ' +
    'Read-only display; edits are not available in the demo build.',
  targets: [
    { id: 't1', identifier: '10.10.0.0/24', type: 'cidr', environment: 'Internal LAN', permission: 'full-access' },
    { id: 't2', identifier: '192.168.1.0/24', type: 'cidr', environment: 'Corporate', permission: 'enumerate-only' },
    { id: 't3', identifier: 'acme-corp.com', type: 'web', environment: 'External', permission: 'full-access' },
    { id: 't4', identifier: 'api.acme-corp.com', type: 'api', environment: 'External', permission: 'full-access' },
    { id: 't5', identifier: 'mail.acme-corp.com', type: 'web', environment: 'External', permission: 'phishing-allowed' },
    { id: 't6', identifier: '10.10.14.0/24', type: 'cidr', environment: 'DMZ', permission: 'full-access' },
    { id: 't7', identifier: 'dev.acme-corp.com', type: 'web', environment: 'Dev/Staging', permission: 'full-access' },
    { id: 't8', identifier: '203.0.113.50', type: 'host', environment: 'External', permission: 'full-access' },
    { id: 't9', identifier: '203.0.113.51', type: 'host', environment: 'External', permission: 'full-access' },
    { id: 't10', identifier: '198.51.100.0/28', type: 'cidr', environment: 'External', permission: 'enumerate-only' },
    { id: 't11', identifier: 'vpn.acme-corp.com', type: 'web', environment: 'External', permission: 'enumerate-only' },
    { id: 't12', identifier: 'john.doe@acme-corp.com', type: 'email', environment: 'Corporate', permission: 'phishing-allowed' },
    { id: 't13', identifier: 'sarah.miller@acme-corp.com', type: 'email', environment: 'Corporate', permission: 'phishing-allowed' },
    { id: 't14', identifier: 'it.helpdesk@acme-corp.com', type: 'email', environment: 'Corporate', permission: 'phishing-allowed' },
    { id: 't15', identifier: '192.168.2.50', type: 'host', environment: 'DMZ', permission: 'enumerate-only' },
  ],
  blacklist: [
    {
      id: 'b1',
      identifier: '10.10.5.0/24',
      label: 'Production Payment Systems',
      reason: 'PCI-DSS scope — financial transaction processing',
    },
    {
      id: 'b2',
      identifier: 'hospital-mgmt.acme-corp.com',
      label: 'Healthcare Portal',
      reason: 'HIPAA-protected patient data — zero tolerance',
    },
    {
      id: 'b3',
      identifier: '192.168.99.0/24',
      label: 'HR & Payroll Systems',
      reason: 'PII data — legal hold',
    },
  ],
}
