/**
 * Legacy data module: seed dataset and demo constants.
 *
 * Entity/status types live in `./domain/entities` (one definition each,
 * ADR-0067) and are re-exported below so existing `./data` imports keep
 * working until retirement tickets 65–67 remove the remaining callers.
 */
import type {
  Agent, AiWorker, Approval, Asset, Audit, Branch, BranchGroup, BranchState, C2Node, Channel,
  ChatMsg, Conversation, DetectState, Evidence, ExportRec, Facets, Finding, Group, Integration,
  Notice, Operation, OrgState, Plan, PlanStep, Playbook, Policy, Project, Report, Retention, Role, Session,
  SessionRequest, StopState, Step, StepStatus, Template, Technique, ToolEvent, ToolState,
  WorkerState,
} from './domain/entities'

export type * from './domain/entities'

/** Approval type literals (Approval.type) */
export const APR = { create: 'Project creation', scope: 'Scope change', close: 'Project closure', plan: 'Plan approval', access: 'Session access' } as const

export const BRANCH_LABEL: Record<BranchState, string> = { pending: 'Pending', queued: 'Queued', waiting_approval: 'Waiting Approval', running: 'Running', completed: 'Completed', failed: 'Failed', blocked: 'Blocked', paused: 'Paused', cancelled: 'Cancelled', unknown: 'Unknown' }
export const BRANCH_TERMINAL: BranchState[] = ['completed', 'failed', 'cancelled', 'blocked']

export function toolFacets(t: { state: ToolState }): Facets {
  const s = t.state
  return {
    policy: s === 'denied' ? 'Blocked' : s === 'proposed' ? 'Not evaluated' : 'Allowed',
    approval: s === 'awaiting' ? 'Pending' : s === 'denied' ? 'Denied' : s === 'proposed' ? 'Not required' : 'Approved',
    exec: s === 'running' ? 'Running' : s === 'completed' ? 'Executed' : s === 'failed' ? 'Failed' : s === 'stopped' ? 'Stopped' : 'Not executed',
  }
}

export const planVer = (p: { ver?: string; version: number }) => p.ver ?? `v${p.version}`

export const USERS = [
  { name: 'Alex Morgan', email: 'alex.morgan@acme-security.example.test', role: 'manager' as Role },
  { name: 'Jordan Lee', email: 'jordan.lee@acme-security.example.test', role: 'manager' as Role },
  { name: 'Sam Patel', email: 'sam.patel@acme-security.example.test', role: 'manager' as Role },
  { name: 'Pat Kim', email: 'pat.kim@acme-security.example.test', role: 'reviewer' as Role },
  { name: 'Taylor Chen', email: 'taylor.chen@acme-security.example.test', role: 'operator' as Role },
  { name: 'Riley Brooks', email: 'riley.brooks@acme-security.example.test', role: 'analyst' as Role },
  { name: 'Dana Whitfield', email: 'dana.whitfield@acme-security.example.test', role: 'admin' as Role },
  { name: 'Casey Nguyen (Client)', email: 'casey.nguyen@northwind.example.test', role: 'viewer' as Role },
]

export const TACTICS = ['Reconnaissance', 'Initial Access', 'Execution', 'Persistence', 'Privilege Escalation', 'Defense Evasion', 'Credential Access', 'Discovery', 'Lateral Movement', 'Collection']

export const TECHNIQUES: Technique[] = [
  ['T1595', 'Active Scanning', 0], ['T1592', 'Gather Victim Host Information', 0],
  ['T1078', 'Valid Accounts', 1], ['T1190', 'Exploit Public-Facing Application', 1],
  ['T1059', 'Command and Scripting Interpreter', 2], ['T1053', 'Scheduled Task/Job', 2],
  ['T1547', 'Boot or Logon Autostart Execution', 3], ['T1136', 'Create Account', 3],
  ['T1068', 'Exploitation for Privilege Escalation', 4], ['T1548', 'Abuse Elevation Control Mechanism', 4],
  ['T1562', 'Impair Defenses', 5], ['T1070', 'Indicator Removal', 5],
  ['T1003', 'OS Credential Dumping', 6], ['T1110', 'Brute Force', 6],
  ['T1087', 'Account Discovery', 7], ['T1082', 'System Information Discovery', 7], ['T1046', 'Network Service Discovery', 7], ['T1069', 'Permission Groups Discovery', 7],
  ['T1021', 'Remote Services', 8], ['T1550', 'Use Alternate Authentication Material', 8],
  ['T1005', 'Data from Local System', 9], ['T1119', 'Automated Collection', 9],
].map(([id, name, t]) => ({ id: id as string, name: name as string, tactic: TACTICS[t as number], platforms: ['Windows', 'Linux'], desc: `High-level description of ${name} from the MITRE ATT&CK catalog (demo data).` }))

/** "Oct 13, 2026, 10:42 AM (UTC+7)" */
const D = (md: string, hm: string) => `${md}, 2026, ${hm} (UTC+7)`
const SAFE = 'Sanitized output. No sensitive content.'
const s = (id: string, name: string, agent: string, asset: string, technique: string, status: StepStatus, ts: string, dur: string, output = SAFE, evidence?: string): Step => ({ id, name, agent, asset, technique, status, ts, dur, output, evidence })

const roeBase = { window: 'Mon–Fri, 9:00 AM–5:00 PM (UTC+7)', methods: ['Service discovery', 'Configuration collection', 'Approved TTP simulation'], restrictions: ['No service disruption', 'No access to real customer data', 'Stop immediately on request from the emergency contact'] }

const PB1 = ['Collect system information', 'Enumerate local accounts', 'Enumerate permission groups', 'Discover network services', 'Collect web server details', 'Validate lab credentials (simulated)', 'Review scheduled tasks', 'Collect local data sample', 'Check remote services', 'Simulate defense impairment (safe)', 'Automated collection sample', 'Summarize and clean up']
const PB1T = ['T1082', 'T1087', 'T1069', 'T1046', 'T1592', 'T1078', 'T1053', 'T1005', 'T1021', 'T1562', 'T1119', 'T1070']
const TOOLS = ['host-info-collector', 'account-enumerator', 'group-enumerator', 'service-mapper', 'web-profiler', 'credential-validator (lab)', 'task-reviewer', 'data-sampler', 'remote-service-check', 'defense-sim (safe)', 'collector-sim', 'cleanup-summarizer']

export type SeedVariant = 'default' | 'e2e01'

export function seed(variant: SeedVariant = 'default') {
  const projects: Project[] = [
    { id: 'RT-2026-014', name: 'Internal Red Team Q4', client: 'Northwind Bank (Demo)', owner: 'Alex Morgan', type: 'Red Team', status: 'active', start: 'Oct 1, 2026', end: 'Nov 15, 2026', tz: 'UTC+07:00', desc: 'Simulated insider-threat engagement against the Northwind Bank lab environment.', pinned: true, roeStatus: 'approved', roeVersion: 'ROE-014-v2', emergency: 'Robin Vale — +1 (555) 010-0014', ...roeBase,
      objectives: [
        { id: 'o1', text: 'Assess internal discovery exposure in the lab', criteria: 'Complete ≥ 10 of 12 steps in OP-014', owner: 'Taylor Chen', progress: 60 },
        { id: 'o2', text: 'Measure SOC detection coverage', criteria: 'Detection data for ≥ 80% of techniques', owner: 'Alex Morgan', progress: 25 },
        { id: 'o3', text: 'Identify access-control gaps', criteria: 'At least 1 confirmed finding', owner: 'Taylor Chen', progress: 40 },
      ],
      members: [{ user: 'Alex Morgan', role: 'manager', since: 'Sep 20, 2026' }, { user: 'Taylor Chen', role: 'operator', since: 'Sep 22, 2026' }, { user: 'Pat Kim', role: 'reviewer', since: 'Sep 22, 2026' }, { user: 'Riley Brooks', role: 'analyst', since: 'Sep 24, 2026' }, { user: 'Casey Nguyen (Client)', role: 'viewer', since: 'Oct 1, 2026' }], updated: D('Oct 13', '9:30 AM') },
    { id: 'RT-2026-015', name: 'Cloud Security Assessment', client: 'Fabrikam Cloud (Demo)', owner: 'Sam Patel', type: 'Assessment', status: 'active', start: 'Oct 5, 2026', end: 'Oct 30, 2026', tz: 'UTC+07:00', desc: 'Configuration assessment of the Fabrikam cloud lab.', pinned: false, roeStatus: 'approved', roeVersion: 'ROE-015-v1', emergency: 'Mai Ellis — +1 (555) 010-0015', ...roeBase,
      objectives: [{ id: 'o1', text: 'Verify cloud lab configuration', criteria: 'Review all in-scope assets', owner: 'Sam Patel', progress: 70 }],
      members: [{ user: 'Sam Patel', role: 'manager', since: 'Sep 25, 2026' }, { user: 'Pat Kim', role: 'reviewer', since: 'Sep 25, 2026' }, { user: 'Taylor Chen', role: 'operator', since: 'Sep 26, 2026' }], updated: D('Oct 13', '8:50 AM') },
    { id: 'RT-2026-017', name: 'Draft Review', client: 'Fabrikam Cloud (Demo)', owner: 'Alex Morgan', type: 'Assessment', status: 'draft', start: 'Oct 20, 2026', end: 'Nov 20, 2026', tz: 'UTC+07:00', desc: 'Draft engagement used to demonstrate guardrails: ROE is a draft, no assets are approved and execution stays locked.', pinned: false, roeStatus: 'draft', roeVersion: 'ROE-017-v1', emergency: '', window: 'Mon–Fri, 9:00 AM–5:00 PM (UTC+7)', methods: ['Service discovery'], restrictions: [],
      objectives: [{ id: 'o1', text: 'Define scope for the Fabrikam draft review', criteria: 'ROE approved with at least 1 asset', owner: 'Alex Morgan', progress: 0 }],
      members: [{ user: 'Alex Morgan', role: 'manager', since: 'Oct 12, 2026' }, { user: 'Taylor Chen', role: 'operator', since: 'Oct 12, 2026' }, { user: 'Pat Kim', role: 'reviewer', since: 'Oct 12, 2026' }], updated: D('Oct 13', '8:00 AM') },
    { id: 'RT-2026-016', name: 'Retail Perimeter Review', client: 'Lumen Retail (Demo)', owner: 'Alex Morgan', type: 'Red Team', status: 'approved', start: 'Oct 12, 2026', end: 'Nov 20, 2026', tz: 'UTC+07:00', desc: 'Perimeter review. ROE is still in draft, so execution is blocked.', pinned: false, roeStatus: 'draft', roeVersion: 'ROE-016-v1', emergency: 'Lee Hart — +1 (555) 010-0016', ...roeBase,
      objectives: [{ id: 'o1', text: 'Map external exposure', criteria: 'Complete discovery playbook', owner: 'Alex Morgan', progress: 0 }],
      members: [{ user: 'Alex Morgan', role: 'manager', since: 'Oct 8, 2026' }, { user: 'Taylor Chen', role: 'operator', since: 'Oct 8, 2026' }, { user: 'Pat Kim', role: 'reviewer', since: 'Oct 8, 2026' }], updated: D('Oct 12', '2:00 PM') },
    { id: 'PT-2026-006', name: 'Purple Team Exercise Q4', client: 'Northwind Bank (Demo)', owner: 'Jordan Lee', type: 'Purple Team', status: 'pending', start: 'Oct 12, 2026', end: 'Nov 20, 2026', tz: 'UTC+07:00', desc: 'Joint Red/Blue exercise to measure detection effectiveness.', pinned: false, roeStatus: 'pending', roeVersion: 'ROE-006-v1', emergency: '', ...roeBase,
      objectives: [{ id: 'o1', text: 'Measure mean time to detect', criteria: 'Data for 10 techniques', owner: 'Jordan Lee', progress: 0 }],
      members: [{ user: 'Jordan Lee', role: 'manager', since: 'Oct 1, 2026' }, { user: 'Pat Kim', role: 'reviewer', since: 'Oct 1, 2026' }], updated: D('Oct 12', '4:10 PM') },
    { id: 'RT-2026-009', name: 'Completed Internal Assessment', client: 'Contoso Labs (Demo)', owner: 'Pat Kim', type: 'Red Team', status: 'closed', start: 'Jul 1, 2026', end: 'Aug 15, 2026', tz: 'UTC+07:00', desc: 'Completed and archived engagement.', pinned: false, roeStatus: 'approved', roeVersion: 'ROE-009-v3', emergency: 'Kim Doyle — +1 (555) 010-0009', ...roeBase,
      objectives: [{ id: 'o1', text: 'Assess lab network segmentation', criteria: 'Completed', owner: 'Pat Kim', progress: 100 }],
      members: [{ user: 'Pat Kim', role: 'manager', since: 'Jun 20, 2026' }], closedAt: D('Aug 30', '5:00 PM'), updated: D('Aug 30', '5:00 PM') },
  ]

  const mkSteps = (agents: string[], assets: string[], doneTo: number, runIdx: number, reviewIdx = -1): Step[] =>
    PB1.map((name, i) => {
      const status: StepStatus = i < doneTo ? 'ok' : i === runIdx ? 'running' : i === reviewIdx ? 'review' : i < 12 ? 'pending' : 'notrun'
      const h = 9 + Math.floor((31 + i * 7) / 60), m = (31 + i * 7) % 60
      return s('S' + String(i + 1).padStart(2, '0'), name, agents[i % agents.length], assets[i % assets.length], PB1T[i], status,
        status === 'ok' || status === 'running' || status === 'review' ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` : '—', status === 'ok' ? `0${1 + (i % 3)}:${String(10 + ((i * 13) % 50))}` : '—',
        status === 'ok' ? SAFE : status === 'running' ? 'Waiting for agent result.' : status === 'review' ? 'Output ready — waiting for operator review.' : status === 'pending' ? 'No output yet.' : 'Not run.', i === 1 ? 'EV-014-01' : i === 5 ? 'EV-014-02' : undefined)
    })

  const operations: Operation[] = [
    { id: 'OP-014', projectId: 'RT-2026-014', name: 'Internal environment discovery', status: 'running', owner: 'Taylor Chen', playbookId: 'PB-001', agents: ['AG-007', 'AG-008'], assets: ['AS-0141', 'AS-0142', 'AS-0143'], mode: 'Manual approval', startedAt: D('Oct 13', '9:30 AM'), updated: D('Oct 13', '10:42 AM'), preflightAt: D('Oct 13', '9:28 AM'), planId: 'PL-021', sessionId: 'SS-041',
      steps: mkSteps(['AG-007', 'AG-008'], ['win-dc-01', 'api-01', 'web-01'], 10, -1, 10) },
    { id: 'OP-013', projectId: 'RT-2026-014', name: 'Detection signal baseline', status: 'done', owner: 'Taylor Chen', playbookId: 'PB-002', agents: ['AG-007'], assets: ['AS-0143'], mode: 'Manual approval', startedAt: D('Oct 6', '9:00 AM'), updated: D('Oct 6', '11:20 AM'), sessionId: 'SS-040',
      steps: [s('S01', 'Generate discovery signal', 'AG-007', 'win-dc-01', 'T1087', 'ok', '09:02', '00:40'), s('S02', 'Generate valid-account signal', 'AG-007', 'win-dc-01', 'T1078', 'ok', '09:20', '01:12'), s('S03', 'Generate password-guessing signal (limited)', 'AG-007', 'win-dc-01', 'T1110', 'fail', '09:41', '00:30', 'Blocked by lab policy.')] },
    { id: 'OP-015', projectId: 'RT-2026-015', name: 'Cloud configuration validation', status: 'running', owner: 'Sam Patel', playbookId: 'PB-003', agents: ['AG-010'], assets: ['AS-0201', 'AS-0202'], mode: 'Policy-based', startedAt: D('Oct 13', '8:45 AM'), updated: D('Oct 13', '10:30 AM'), planId: 'PL-022', sessionId: 'SS-043',
      steps: [
        s('S01', 'List service configuration', 'AG-010', 'cloud-app-01', 'T1082', 'ok', '08:46', '01:10'),
        s('S02', 'Review identity permissions', 'AG-010', 'cloud-app-01', 'T1069', 'ok', '08:55', '02:30', SAFE, 'EV-301'),
        s('S03', 'Discover internal network services', 'AG-010', 'cloud-node-01', 'T1046', 'running', '10:28', '—', 'Waiting for agent result.'),
        s('S04', 'Reconcile audit logs', 'AG-010', 'cloud-node-01', 'T1070', 'notrun', '—', '—', 'Not run.'),
      ] },
    { id: 'OP-DRAFT-017', projectId: 'RT-2026-017', name: 'Fabrikam discovery (draft)', status: 'draft', owner: 'Alex Morgan', playbookId: 'PB-003', agents: [], assets: [], mode: 'Manual approval', startedAt: '—', updated: D('Oct 13', '8:05 AM'),
      steps: [] },
    { id: 'OP-016', projectId: 'RT-2026-016', name: 'External exposure mapping', status: 'draft', owner: 'Alex Morgan', playbookId: 'PB-001', agents: ['AG-014'], assets: ['AS-0301', 'AS-0302'], mode: 'Manual approval', startedAt: '—', updated: D('Oct 12', '2:00 PM'),
      steps: PB1.map((n, i) => s('S' + String(i + 1).padStart(2, '0'), n, 'AG-014', i % 2 ? 'shop-api' : 'shop-web', PB1T[i], 'notrun', '—', '—', 'Not run.')) },
    { id: 'OP-009', projectId: 'RT-2026-009', name: 'Network segmentation assessment', status: 'done', owner: 'Pat Kim', playbookId: 'PB-001', agents: [], assets: ['AS-0901'], mode: 'Manual approval', startedAt: D('Jul 10', '9:00 AM'), updated: D('Jul 10', '4:00 PM'),
      steps: [s('S01', 'Discover network services', '—', 'segment-lab', 'T1046', 'ok', '09:10', '05:00')] },
  ]

  const agents: Agent[] = [
    { id: 'AG-007', host: 'WIN-LAB-01', os: 'Windows', version: '5.2.1', projectId: 'RT-2026-014', status: 'online', lastSeen: D('Oct 13', '10:42 AM'), op: 'OP-014', group: 'Windows Lab A', conn: 'HTTPS (simulated)', ip: '192.0.2.21' },
    { id: 'AG-008', host: 'LAB-LNX-01', os: 'Linux', version: '5.2.1', projectId: 'RT-2026-014', status: 'online', lastSeen: D('Oct 13', '10:42 AM'), op: 'OP-014', group: 'Linux Lab A', conn: 'HTTPS (simulated)', ip: '192.0.2.12' },
    { id: 'AG-009', host: 'WIN-LAB-03', os: 'Windows', version: '5.1.8', projectId: 'RT-2026-014', status: 'lost', lastSeen: D('Oct 12', '6:05 PM'), op: null, group: 'Windows Lab A', conn: 'HTTPS (simulated)', ip: '192.0.2.23' },
    { id: 'AG-010', host: 'CLOUD-LAB-01', os: 'Linux', version: '5.2.1', projectId: 'RT-2026-015', status: 'online', lastSeen: D('Oct 13', '10:41 AM'), op: 'OP-015', group: 'Cloud B', conn: 'HTTPS (simulated)', ip: '198.51.100.31' },
    { id: 'AG-011', host: 'CLOUD-LAB-02', os: 'Linux', version: '5.2.0', projectId: 'RT-2026-015', status: 'online', lastSeen: D('Oct 13', '10:40 AM'), op: null, group: 'Cloud B', conn: 'HTTPS (simulated)', ip: '198.51.100.32' },
    { id: 'AG-012', host: 'POOL-LAB-01', os: 'Windows', version: '5.2.1', projectId: '', status: 'online', lastSeen: D('Oct 13', '10:41 AM'), op: null, group: '', conn: 'HTTPS (simulated)', ip: '203.0.113.41' },
    { id: 'AG-013', host: 'POOL-LAB-02', os: 'Linux', version: '5.2.1', projectId: '', status: 'online', lastSeen: D('Oct 13', '10:39 AM'), op: null, group: '', conn: 'HTTPS (simulated)', ip: '203.0.113.42' },
    { id: 'AG-014', host: 'RETAIL-LAB-01', os: 'Linux', version: '5.2.1', projectId: 'RT-2026-016', status: 'online', lastSeen: D('Oct 13', '10:38 AM'), op: null, group: '', conn: 'HTTPS (simulated)', ip: '203.0.113.51' },
    { id: 'AG-015', host: 'PURPLE-LAB-01', os: 'Linux', version: '5.2.1', projectId: 'PT-2026-006', status: 'idle', lastSeen: D('Oct 13', '10:40 AM'), op: null, group: '', conn: 'HTTPS (simulated)', ip: '203.0.113.61' },
  ]

  const A = (id: string, name: string, ident: string, ip: string, type: string, os: string, owner: string, projectId: string, scope: Asset['scope'], source: string, updated: string): Asset =>
    ({ id, name, ident, ip, type, os, owner, projectId, scope, source, updated })
  const nw = (h: string) => `${h}.northwind.example.test`
  const assets: Asset[] = [
    A('AS-0141', 'web-01', nw('web-01'), '192.0.2.11', 'Web server', 'Linux', 'Infrastructure Team', 'RT-2026-014', 'in', 'CSV import', D('Oct 2', '10:00 AM')),
    A('AS-0142', 'api-01', nw('api-01'), '192.0.2.12', 'Application', 'Linux', 'Platform Team', 'RT-2026-014', 'in', 'Manual', D('Oct 2', '10:05 AM')),
    A('AS-0143', 'win-dc-01', nw('win-dc-01'), '192.0.2.21', 'Domain controller', 'Windows', 'Infrastructure Team', 'RT-2026-014', 'in', 'Manual', D('Oct 2', '10:06 AM')),
    A('AS-0144', 'win-app-02', nw('win-app-02'), '192.0.2.22', 'Host', 'Windows', 'Platform Team', 'RT-2026-014', 'in', 'CSV import', D('Oct 2', '10:07 AM')),
    A('AS-0145', 'file-srv-01', nw('file-srv-01'), '192.0.2.24', 'File server', 'Windows', 'Infrastructure Team', 'RT-2026-014', 'in', 'CSV import', D('Oct 2', '10:08 AM')),
    A('AS-0146', 'db-01', nw('db-01'), '198.51.100.14', 'Database', 'Linux', 'Data Team', 'RT-2026-014', 'in', 'CSV import', D('Oct 2', '10:09 AM')),
    A('AS-0147', 'jump-01', nw('jump-01'), '192.0.2.31', 'Host', 'Linux', 'Infrastructure Team', 'RT-2026-014', 'in', 'Manual', D('Oct 2', '10:10 AM')),
    A('AS-0148', 'hr-portal', nw('hr-portal'), '192.0.2.41', 'Web application', 'Linux', 'HR Systems', 'RT-2026-014', 'in', 'Manual', D('Oct 2', '10:11 AM')),
    A('AS-0149', 'vpn-gw', nw('vpn-gw'), '192.0.2.51', 'Network device', 'Linux', 'Network Team', 'RT-2026-014', 'in', 'CSV import', D('Oct 2', '10:12 AM')),
    A('AS-0150', 'mail-relay', nw('mail-relay'), '192.0.2.61', 'Host', 'Linux', 'Infrastructure Team', 'RT-2026-014', 'in', 'CSV import', D('Oct 2', '10:13 AM')),
    A('AS-0151', 'wiki-01', nw('wiki-01'), '192.0.2.71', 'Web application', 'Linux', 'Platform Team', 'RT-2026-014', 'in', 'Manual', D('Oct 2', '10:14 AM')),
    A('AS-0152', 'build-01', nw('build-01'), '192.0.2.81', 'Host', 'Linux', 'Platform Team', 'RT-2026-014', 'in', 'Manual', D('Oct 2', '10:15 AM')),
    A('AS-0153', 'prod-payments-db', nw('prod-payments-db'), '198.51.100.99', 'Database', 'Linux', 'Payments Team', 'RT-2026-014', 'out', 'ROE', D('Oct 2', '10:16 AM')),
    A('AS-0154', 'staging-erp', nw('staging-erp'), '198.51.100.77', 'Application', 'Linux', 'Finance Systems', 'RT-2026-014', 'pending', 'Manual', D('Oct 12', '3:00 PM')),
    A('AS-0201', 'cloud-app-01', 'app-01.fabrikam.example.test', '198.51.100.31', 'Application', 'Linux', 'Cloud Team B', 'RT-2026-015', 'in', 'Manual', D('Oct 5', '9:00 AM')),
    A('AS-0202', 'cloud-node-01', 'node-01.fabrikam.example.test', '198.51.100.32', 'Host', 'Linux', 'Cloud Team B', 'RT-2026-015', 'in', 'Manual', D('Oct 5', '9:02 AM')),
    A('AS-0203', 'cloud-store-01', 'store-01.fabrikam.example.test', '198.51.100.33', 'Storage', 'Linux', 'Cloud Team B', 'RT-2026-015', 'in', 'CSV import', D('Oct 5', '9:05 AM')),
    A('AS-0301', 'shop-web', 'shop.lumen.example.test', '203.0.113.71', 'Web application', 'Linux', 'Retail IT', 'RT-2026-016', 'in', 'Manual', D('Oct 9', '11:00 AM')),
    A('AS-0302', 'shop-api', 'api.lumen.example.test', '203.0.113.72', 'Application', 'Linux', 'Retail IT', 'RT-2026-016', 'in', 'Manual', D('Oct 9', '11:02 AM')),
    A('AS-0601', 'purple-lab-dc', 'dc.purple.northwind.example.test', '203.0.113.81', 'Domain controller', 'Windows', 'Security Team', 'PT-2026-006', 'pending', 'Manual', D('Oct 11', '2:00 PM')),
    A('AS-0901', 'segment-lab', 'segment.contoso.example.test', '203.0.113.91', 'Subnet', '—', 'Contoso Labs', 'RT-2026-009', 'in', 'CSV import', D('Jul 1', '9:00 AM')),
  ]
  const evidence: Evidence[] = [
    { id: 'EV-014-01', name: 'accounts-output.txt', kind: 'Text', source: 'OP-014 / S02', at: D('Oct 13', '9:35 AM'), by: 'Taylor Chen', projectId: 'RT-2026-014', opId: 'OP-014', sensitive: false },
    { id: 'EV-014-02', name: 'evidence-027.png', kind: 'Image (redacted)', source: 'OP-014 / S06', at: D('Oct 13', '10:08 AM'), by: 'Taylor Chen', projectId: 'RT-2026-014', opId: 'OP-014', findingId: 'FD-011', sensitive: true },
    { id: 'EV-301', name: 'iam-review.json', kind: 'JSON', source: 'OP-015 / S02', at: D('Oct 13', '8:58 AM'), by: 'Sam Patel', projectId: 'RT-2026-015', opId: 'OP-015', findingId: 'FD-015', sensitive: false },
  ]
  const findings: Finding[] = [
    { id: 'FD-011', projectId: 'RT-2026-014', title: 'Excessive account privileges (simulated)', severity: 'high', status: 'confirmed', asset: 'win-dc-01', op: 'OP-014', technique: 'T1078', owner: 'Taylor Chen', date: D('Oct 13', '10:15 AM'), updated: D('Oct 13', '10:20 AM'),
      desc: 'A demo account in the lab holds more privileges than its business role requires.', impact: 'Allows an internal user to reach resources outside their job scope (simulated).', rec: 'Apply least privilege and review group membership on a recurring schedule.',
      evidence: ['EV-014-02'], comments: [], history: [{ at: D('Oct 13', '10:15 AM'), by: 'Taylor Chen', text: 'Draft created' }, { at: D('Oct 13', '10:20 AM'), by: 'Taylor Chen', text: 'Submitted for review' }, { at: D('Oct 13', '10:35 AM'), by: 'Pat Kim', text: 'Confirmed' }], retests: [] },
    { id: 'FD-012', projectId: 'RT-2026-014', title: 'AI suggestion: possible detection gap on api-01 (unverified)', severity: 'medium', status: 'ai_suggested', asset: 'api-01', op: 'OP-014', technique: 'T1046', owner: 'Taylor Chen', date: D('Oct 13', '9:55 AM'), updated: D('Oct 13', '9:55 AM'),
      desc: 'No signal was observed from the monitoring source for the network service discovery step.', impact: 'A detection gap may exist; needs verification with the Blue Team.', rec: 'Cross-check SIEM logs and add a detection rule if needed.', evidence: [], comments: [], history: [{ at: D('Oct 13', '9:55 AM'), by: 'AI Operator', text: 'Suggested from OP-014 step 4 — not yet verified by a human' }], retests: [] },
    { id: 'FD-015', projectId: 'RT-2026-015', title: 'Cloud lab configuration drift', severity: 'medium', status: 'confirmed', asset: 'cloud-app-01', op: 'OP-015', technique: 'T1069', owner: 'Sam Patel', date: D('Oct 13', '9:00 AM'), updated: D('Oct 13', '9:40 AM'),
      desc: 'A service role is granted broader permissions than policy allows.', impact: 'Expands the internal attack surface (simulated).', rec: 'Narrow the service role permissions.', evidence: ['EV-301'], comments: [{ by: 'Pat Kim', at: D('Oct 13', '9:40 AM'), text: 'Verified against IAM evidence.' }], history: [{ at: D('Oct 13', '9:40 AM'), by: 'Pat Kim', text: 'Confirmed' }], retests: [] },
    { id: 'FD-009', projectId: 'RT-2026-009', title: 'Incomplete network segmentation', severity: 'low', status: 'resolved', asset: 'segment-lab', op: 'OP-009', technique: 'T1046', owner: 'Pat Kim', date: D('Jul 10', '4:00 PM'), updated: D('Aug 20', '10:00 AM'), desc: 'Some services are reachable across segments.', impact: 'Low.', rec: 'Update ACLs.', evidence: [], comments: [], history: [], retests: [{ at: D('Aug 20', '10:00 AM'), by: 'Pat Kim', result: 'Resolved', note: 'ACLs updated.' }] },
  ]
  const secs = (client: string) => [
    ['cover', 'Cover Page', `Security Assessment Report — ${client}`], ['exec', 'Executive Summary', 'During the assessment period the Red Team ran simulated test operations in the lab environment, within the approved scope.'],
    ['scope', 'Scope', 'In-scope assets are listed according to the approved ROE.'], ['method', 'Methodology', 'Applies the MITRE ATT&CK framework and reviewed playbooks.'],
    ['goals', 'Objectives', ''], ['timeline', 'Timeline', ''], ['narrative', 'Operation Narrative', ''], ['results', 'Results', ''],
    ['findings', 'Detailed Findings', ''], ['recs', 'Recommendations', ''], ['appendix', 'Appendix', ''],
  ].map(([id, title, body]) => ({ id, title, body }))
  const reports: Report[] = [
    { id: 'REP-014', projectId: 'RT-2026-014', title: 'Red Team Q4 Report — Northwind Bank', template: 'Standard Red Team v3', version: 'v0.3', status: 'draft', author: 'Alex Morgan', reviewer: 'Pat Kim', updated: D('Oct 13', '9:00 AM'), findings: ['FD-011'], sections: secs('Northwind Bank'), reviews: [] },
    { id: 'REP-015', projectId: 'RT-2026-015', title: 'Cloud Lab Report — Fabrikam Cloud', template: 'Assessment v2', version: 'v1.0', status: 'review', author: 'Sam Patel', reviewer: 'Pat Kim', updated: D('Oct 12', '5:00 PM'), findings: ['FD-015'], sections: secs('Fabrikam Cloud'), reviews: [{ at: D('Oct 12', '5:00 PM'), by: 'Sam Patel', action: 'Submitted for review', note: '', version: 'v1.0' }] },
    { id: 'REP-009', projectId: 'RT-2026-009', title: 'Final Report — Contoso Labs', template: 'Standard Red Team v3', version: 'v2.0', status: 'delivered', author: 'Pat Kim', reviewer: 'Pat Kim', updated: D('Aug 25', '10:00 AM'), deliveredAt: D('Aug 28', '3:00 PM'), findings: ['FD-009'], sections: secs('Contoso Labs'), reviews: [{ at: D('Aug 25', '10:00 AM'), by: 'Pat Kim', action: 'Approved', note: '', version: 'v2.0' }] },
  ]
  reports.push({ id: 'REP-DRAFT-017', projectId: 'RT-2026-017', title: 'Draft Review Report — Fabrikam Cloud', template: 'Assessment v2', version: 'v0.1', status: 'draft', author: 'Alex Morgan', reviewer: 'Pat Kim', updated: D('Oct 13', '8:10 AM'), findings: [], sections: secs('Fabrikam Cloud'), reviews: [] })
  const exportsList: ExportRec[] = [{ id: 'EX-090', reportId: 'REP-009', version: 'v2.0', format: 'PDF', by: 'Pat Kim', at: D('Aug 28', '2:50 PM'), recipient: 'Contoso Labs (Demo)', status: 'Delivered', checksum: 'sha256:9f3c…a71e' }]
  const playbooks: Playbook[] = [
    { id: 'PB-001', name: 'Internal environment discovery', kind: 'playbook', version: '2.3', owner: 'Red Team', status: 'approved', os: ['Windows', 'Linux'], techniques: PB1T, steps: PB1, revision: { version: '2.4', by: 'Jordan Lee', at: D('Oct 12', '3:30 PM'), summary: ['Added step 13: validate audit-log forwarding (safe)', 'Reworded step 6 to state lab-only credentials', 'Technique T1119 now requires manual approval'], steps: [...PB1, 'Validate audit-log forwarding (safe)'], techniques: [...PB1T, 'T1562'] }, desc: 'Safe discovery sequence for lab environments.', goal: 'Assess internal visibility and controls', updated: 'Oct 1, 2026', share: 'Organization' },
    { id: 'PB-002', name: 'Baseline detection measurement', kind: 'playbook', version: '1.4', owner: 'Purple Team', status: 'approved', os: ['Windows', 'Linux'], techniques: ['T1087', 'T1078', 'T1110'], steps: ['Generate discovery signal', 'Generate valid-account signal', 'Generate password-guessing signal (limited)'], desc: 'Generates controlled signals to measure SOC response.', goal: 'Measure detection coverage', updated: 'Sep 28, 2026', share: 'Organization' },
    { id: 'PB-003', name: 'Cloud lab configuration review', kind: 'playbook', version: '1.1', owner: 'Cloud Team', status: 'approved', os: ['Linux'], techniques: ['T1082', 'T1069', 'T1046', 'T1070'], steps: ['List service configuration', 'Review identity permissions', 'Discover internal network services', 'Reconcile audit logs'], desc: 'Simulated configuration checks.', goal: 'Find configuration drift', updated: 'Oct 2, 2026', share: 'Project RT-2026-015' },
    { id: 'PB-004', name: 'Simulated lateral movement', kind: 'playbook', version: '0.9', owner: 'Red Team', status: 'draft', os: ['Windows'], techniques: ['T1021', 'T1550'], steps: ['Check remote services', 'Simulate alternate authentication material'], desc: 'Draft; not approved for use.', goal: 'Assess segmentation', updated: 'Oct 11, 2026', share: 'Team only' },
    { id: 'AP-01', name: 'Insider adversary profile (simulated)', kind: 'profile', version: '1.0', owner: 'Threat Intel', status: 'approved', os: ['Windows', 'Linux'], techniques: ['T1078', 'T1087', 'T1069', 'T1021'], steps: ['Access with valid account', 'Discovery', 'Lateral movement'], desc: 'Simulates the behavior of a malicious insider.', goal: 'Simulate insider threat', updated: 'Sep 15, 2026', share: 'Organization' },
  ]

  const PHASES = ['Host discovery', 'Identity & access review', 'Controlled validation', 'Collection & summary']
  const planSteps = (agents: string[], assets: string[], pbSteps: string[], techs: string[], tools: string[]): PlanStep[] =>
    pbSteps.map((name, i) => ({ id: 'P' + String(i + 1).padStart(2, '0'), name, technique: techs[i], asset: assets[i % assets.length], agent: agents[i % agents.length], tool: tools[i % tools.length],
      phase: PHASES[Math.min(3, Math.floor(i / Math.max(1, Math.ceil(pbSteps.length / 4))))], risk: i === 5 || i === 9 ? 'medium' : 'low', needsApproval: i === 5 || i === 9, rationale: `Supports the project objective using only approved, in-scope targets (${techs[i]}).` }))
  const plans: Plan[] = [
    { id: 'PL-021', ver: 'v1.2', projectId: 'RT-2026-014', title: 'Internal environment discovery plan', version: 2, status: 'approved', author: 'AI Operator', requestedBy: 'Taylor Chen', reviewer: 'Pat Kim', created: D('Oct 13', '9:05 AM'), updated: D('Oct 13', '9:25 AM'), playbookId: 'PB-001',
      assets: ['AS-0141', 'AS-0142', 'AS-0143'], agents: ['AG-007', 'AG-008'], steps: planSteps(['AG-007', 'AG-008'], ['win-dc-01', 'api-01', 'web-01'], PB1, PB1T, TOOLS),
      rationale: 'Runs the approved Internal environment discovery playbook against in-scope lab assets using healthy, project-assigned agents.', risks: ['Two steps simulate credential and defense behavior; both require explicit approval.', 'Agent WIN-LAB-03 is disconnected and excluded.'],
      roeVersion: 'ROE-014-v2', opId: 'OP-014', prevPlanId: 'PL-020', changes: ['Added approval gate to step 10 (defense simulation)', 'Removed AG-009 (disconnected)'], decision: { by: 'Pat Kim', at: D('Oct 13', '9:25 AM'), note: 'Approved within ROE-014-v2.' }, expires: D('Oct 14', '9:25 AM'), conversationId: 'CV-014-03' },
    { id: 'PL-020', ver: 'v1.1', projectId: 'RT-2026-014', title: 'Internal environment discovery plan', version: 1, status: 'superseded', author: 'AI Operator', requestedBy: 'Taylor Chen', reviewer: 'Pat Kim', created: D('Oct 13', '8:40 AM'), updated: D('Oct 13', '9:05 AM'), playbookId: 'PB-001',
      assets: ['AS-0141', 'AS-0142', 'AS-0143'], agents: ['AG-007', 'AG-008', 'AG-009'], steps: planSteps(['AG-007', 'AG-008', 'AG-009'], ['win-dc-01', 'api-01', 'web-01'], PB1, PB1T, TOOLS),
      rationale: 'First draft of the discovery plan.', risks: ['Includes a disconnected agent.'], roeVersion: 'ROE-014-v2', decision: { by: 'Pat Kim', at: D('Oct 13', '9:00 AM'), note: 'Returned: remove disconnected agent and gate step 10.' }, conversationId: 'CV-014-03' },
    { id: 'PL-022', projectId: 'RT-2026-015', title: 'Cloud configuration validation plan', version: 1, status: 'in_review', author: 'AI Operator', requestedBy: 'Sam Patel', reviewer: 'Pat Kim', created: D('Oct 13', '8:20 AM'), updated: D('Oct 13', '8:30 AM'), playbookId: 'PB-003',
      assets: ['AS-0201', 'AS-0202'], agents: ['AG-010'], steps: planSteps(['AG-010'], ['cloud-app-01', 'cloud-node-01'], ['List service configuration', 'Review identity permissions', 'Discover internal network services', 'Reconcile audit logs'], ['T1082', 'T1069', 'T1046', 'T1070'], ['config-lister', 'iam-reviewer', 'service-mapper', 'audit-reconciler']),
      rationale: 'Validates cloud lab configuration using the approved Cloud lab configuration review playbook.', risks: ['None above low.'], roeVersion: 'ROE v1', opId: 'OP-015', conversationId: 'CV-015-01' },
    { id: 'PL-023', projectId: 'RT-2026-016', title: 'External exposure mapping plan', version: 1, status: 'draft', author: 'AI Operator', requestedBy: 'Alex Morgan', reviewer: 'Pat Kim', created: D('Oct 12', '2:10 PM'), updated: D('Oct 12', '2:10 PM'), playbookId: 'PB-001',
      assets: ['AS-0301', 'AS-0302'], agents: ['AG-014'], steps: planSteps(['AG-014'], ['shop-web', 'shop-api'], PB1.slice(0, 6), PB1T.slice(0, 6), TOOLS), rationale: 'Draft plan. Cannot be approved until ROE is approved.', risks: ['ROE is not approved.'], roeVersion: 'ROE v1', conversationId: 'CV-016-01' },
  ]
  const toolEvents: ToolEvent[] = [
    { id: 'TL-01', conversationId: 'CV-014-03', planId: 'PL-021', projectId: 'RT-2026-014', tool: 'host-info-collector', target: 'win-dc-01', params: 'scope=system-summary', state: 'completed', at: D('Oct 13', '9:31 AM'), result: 'Demo data — 1 host summary captured.', opId: 'OP-014', stepId: 'S03', branchId: 'BR-014-01', agentId: 'AG-007', corr: 'COR-014-01', evidence: ['EV-014-01'], ms: 41000 },
    { id: 'TL-02', conversationId: 'CV-014-03', planId: 'PL-021', projectId: 'RT-2026-014', tool: 'account-enumerator', target: 'win-dc-01', params: 'scope=local-accounts', state: 'completed', at: D('Oct 13', '9:34 AM'), result: 'Demo data — 6 accounts listed.', opId: 'OP-014', stepId: 'S03', branchId: 'BR-014-02', agentId: 'AG-007', corr: 'COR-014-02', evidence: ['EV-014-02'], ms: 38000 },
    { id: 'TL-03', conversationId: 'CV-014-03', planId: 'PL-021', projectId: 'RT-2026-014', tool: 'defense-sim (safe)', target: 'win-dc-01', params: 'mode=simulate-only', state: 'awaiting', at: D('Oct 13', '10:41 AM'), reason: 'Requires explicit approval before execution.', opId: 'OP-014', stepId: 'S10', branchId: 'BR-014-04', agentId: 'AG-007', corr: 'COR-014-04' },
    { id: 'TL-04', conversationId: 'CV-014-03', projectId: 'RT-2026-014', tool: 'service-mapper', target: 'prod-payments-db', params: 'scope=services', state: 'denied', at: D('Oct 13', '9:12 AM'), reason: 'Out of scope — asset is excluded by ROE-014-v2.', opId: 'OP-014', corr: 'COR-014-05' },
    { id: 'TL-06', conversationId: 'CV-014-03', planId: 'PL-021', projectId: 'RT-2026-014', tool: 'remote-service-check', target: 'api-01', params: 'scope=service-reachability', state: 'failed', at: D('Oct 13', '10:38 AM'), reason: 'Agent response timed out — step S11 requires review.', result: 'Demo data — no result returned; no evidence captured.', opId: 'OP-014', stepId: 'S11', branchId: 'BR-014-03', agentId: 'AG-008', corr: 'COR-014-03', ms: 30000 },
    { id: 'TL-07', conversationId: 'CV-014-03', planId: 'PL-021', projectId: 'RT-2026-014', tool: 'cleanup-summarizer', target: 'web-01', params: 'scope=run-summary', state: 'proposed', at: D('Oct 13', '10:42 AM'), opId: 'OP-014', stepId: 'S12', branchId: 'BR-014-05', agentId: 'AG-008', corr: 'COR-014-06' },
    { id: 'TL-05', conversationId: 'CV-015-01', planId: 'PL-022', projectId: 'RT-2026-015', tool: 'config-lister', target: 'cloud-app-01', params: 'scope=service-config', state: 'proposed', at: D('Oct 13', '8:30 AM') },
  ]

  const mk = (n: number, st: string, ag: string, tgt: string, tool: string, state: BranchState, extra: Partial<Branch> = {}): Branch => ({
    id: `BR-014-0${n}`, groupId: 'BG-014-01', opId: 'OP-014', projectId: 'RT-2026-014', stepId: st, agent: ag, target: tgt, tool, state, evidence: [], lastEvent: '', approval: 'none', corr: `COR-014-0${n}`,
    timeline: [], assignLog: [{ at: D('Oct 13', '9:30 AM'), text: `Assigned to ${ag} by plan PL-021 v1.2` }], policy: 'In scope — ROE-014-v2', ...extra })
  const branches: Branch[] = [
    mk(1, 'S03', 'AG-007', 'win-dc-01', 'host-info-collector', 'completed', { start: D('Oct 13', '9:30 AM'), dur: '41 s', evidence: ['EV-014-01'], toolEventId: 'TL-01', output: 'Demo data — 1 host summary captured.', lastEvent: 'Completed with 1 evidence item', timeline: [{ at: D('Oct 13', '9:30 AM'), text: 'Started' }, { at: D('Oct 13', '9:31 AM'), text: 'Completed' }] }),
    mk(2, 'S03', 'AG-007', 'win-dc-01', 'account-enumerator', 'completed', { start: D('Oct 13', '9:33 AM'), dur: '38 s', evidence: ['EV-014-02'], toolEventId: 'TL-02', output: 'Demo data — 6 accounts listed.', lastEvent: 'Completed with 1 evidence item', timeline: [{ at: D('Oct 13', '9:33 AM'), text: 'Started' }, { at: D('Oct 13', '9:34 AM'), text: 'Completed' }] }),
    mk(3, 'S11', 'AG-008', 'api-01', 'remote-service-check', 'failed', { start: D('Oct 13', '10:37 AM'), dur: '30 s', toolEventId: 'TL-06', error: 'Agent response timed out — no result, no evidence.', lastEvent: 'Failed: agent response timed out', timeline: [{ at: D('Oct 13', '10:37 AM'), text: 'Started' }, { at: D('Oct 13', '10:38 AM'), text: 'Timed out' }] }),
    mk(4, 'S10', 'AG-007', 'win-dc-01', 'defense-sim (safe)', 'waiting_approval', { approval: 'pending', toolEventId: 'TL-03', lastEvent: 'Approval requested from Pat Kim', timeline: [{ at: D('Oct 13', '10:41 AM'), text: 'Approval requested' }] }),
    mk(5, 'S12', 'AG-008', 'web-01', 'cleanup-summarizer', 'queued', { toolEventId: 'TL-07', lastEvent: 'Queued behind step S11 review', timeline: [{ at: D('Oct 13', '10:42 AM'), text: 'Queued' }] }),
  ]
  const branchGroups: BranchGroup[] = [{ id: 'BG-014-01', planId: 'PL-021', planVer: 'v1.2', opId: 'OP-014', projectId: 'RT-2026-014', parentStep: 'S02', aggStep: 'S12', objective: 'Collect host, account and service data from in-scope lab hosts in parallel.', policy: ['Max 2 concurrent branches', 'Only ROE-014-v2 in-scope targets', 'Defense simulation requires human approval'], maxConcurrency: 2 }]
  const wk = (n: number, role: AiWorker['role'], task: string, state: WorkerState, inputs: string[], output: string, deps: string[] = [], parent?: string): AiWorker => ({ id: `AW-014-0${n}`, projectId: 'RT-2026-014', role, task, state, inputs, output, deps, parent, model: 'Demo model (simulated)' })
  const aiWorkers: AiWorker[] = [
    wk(1, 'Planner', 'Draft plan revision PL-021 v1.2', 'done', ['CV-014-03', 'ROE-014-v2'], 'PL-021 v1.2'),
    wk(2, 'Policy Reviewer', 'Check plan steps against ROE', 'done', ['PL-021 v1.2', 'ROE-014-v2'], 'Policy check: 12 steps in scope', ['AW-014-01'], 'AW-014-01'),
    wk(3, 'Analysis Worker', 'Summarize branch results BG-014-01', 'waiting', ['BR-014-01', 'BR-014-02', 'BR-014-03'], 'Waiting for remaining branches', ['AW-014-02']),
    wk(4, 'Evidence Reviewer', 'Check evidence EV-014-01, EV-014-02', 'working', ['EV-014-01', 'EV-014-02'], 'In progress', ['AW-014-03'], 'AW-014-03'),
    wk(5, 'Report Assistant', 'Draft report outline for REP-014', 'idle', ['FD-011'], 'Not started', ['AW-014-04']),
  ]
  const msg = (id: string, role: ChatMsg['role'], text: string, at: string, extra: Partial<ChatMsg> = {}): ChatMsg => ({ id, role, text, at, ...extra })
  const conversations: Conversation[] = [
    { id: 'CV-014-03', projectId: 'RT-2026-014', title: 'Plan internal discovery', mode: 'execution', owner: 'Taylor Chen', pinned: true, updated: D('Oct 13', '10:41 AM'), messages: [
      msg('m1', 'user', 'Plan an internal discovery run for the in-scope Windows and Linux lab hosts.', D('Oct 13', '8:40 AM')),
      msg('m2', 'ai', 'I proposed plan PL-020 using the approved Internal environment discovery playbook (12 steps, 3 in-scope assets). This is a proposal only; nothing has run.', D('Oct 13', '8:41 AM'), { kind: 'plan', planId: 'PL-020' }),
      msg('m3', 'system', 'PL-020 returned by Pat Kim: remove disconnected agent AG-009 and gate step 10.', D('Oct 13', '9:00 AM')),
      msg('m4', 'ai', 'Revised as PL-021 (v2). Removed AG-009 and added an approval gate on the defense simulation step.', D('Oct 13', '9:05 AM'), { kind: 'plan', planId: 'PL-021' }),
      msg('m5', 'system', 'PL-021 approved by Pat Kim under ROE-014-v2. OP-014 started.', D('Oct 13', '9:30 AM')),
      msg('m6', 'user', 'Scan the production payments database too.', D('Oct 13', '9:12 AM')),
      msg('m7', 'ai', 'I can’t do that. prod-payments-db is out of scope under ROE-014-v2, so the tool call was blocked.', D('Oct 13', '9:12 AM'), { kind: 'blocked', toolId: 'TL-04' }),
      msg('m8', 'ai', 'Step 10 (defense simulation, safe mode) is waiting for approval.', D('Oct 13', '10:41 AM'), { kind: 'tool', toolId: 'TL-03', card: 'tool' }),
      msg('m9', 'ai', 'Approval requested from Pat Kim for the defense simulation (step S10, TL-03). The step stays unexecuted until a reviewer decides.', D('Oct 13', '10:41 AM'), { card: 'approval', toolId: 'TL-03', planId: 'PL-021', refs: ['OP-014'] }),
      msg('m10', 'ai', 'Step S03 (host-info-collector) finished on win-dc-01: 1 host summary captured as demo data. Evidence EV-014-01 attached.', D('Oct 13', '10:42 AM'), { card: 'result', toolId: 'TL-01', planId: 'PL-021', refs: ['OP-014', 'EV-014-01', 'AG-007'] }),
      msg('m11', 'ai', 'Step S11 (remote-service-check on api-01) timed out. No result and no evidence were captured, so the step requires review before the operation continues.', D('Oct 13', '10:42 AM'), { card: 'error', toolId: 'TL-06', planId: 'PL-021', refs: ['OP-014', 'AG-008'] }),
      msg('m12', 'ai', 'Analysis summary (AI estimate, not a verified finding): EV-014-01 and EV-014-02 show consistent local-account results on win-dc-01. A person should verify before this is recorded as a finding.', D('Oct 13', '10:42 AM'), { card: 'analysis', refs: ['EV-014-01', 'EV-014-02', 'FD-012'] }),
    ] },
    { id: 'CV-014-01', projectId: 'RT-2026-014', title: 'Scope and ROE questions', mode: 'observe', owner: 'Alex Morgan', updated: D('Oct 2', '11:30 AM'), messages: [
      msg('s1', 'user', 'Which assets are in scope under the current ROE?', D('Oct 2', '11:25 AM')),
      msg('s2', 'ai', '12 assets are approved under ROE-014-v2. prod-payments-db is excluded and staging-erp is pending classification.', D('Oct 2', '11:26 AM')),
    ] },
    { id: 'CV-017-01', projectId: 'RT-2026-017', title: 'Plan Fabrikam draft review', mode: 'execution', owner: 'Alex Morgan', updated: D('Oct 13', '8:05 AM'), messages: [
      msg('d1', 'user', 'Plan a discovery operation for the Fabrikam draft review.', D('Oct 13', '8:00 AM')),
      msg('d2', 'ai', 'Execution locked — ROE-017-v1 is a draft with 0 approved assets. I can help you draft the scope and a plan outline, but nothing can be proposed for execution until the ROE is approved.', D('Oct 13', '8:01 AM'), { kind: 'blocked' }),
    ] },
    { id: 'CV-015-01', projectId: 'RT-2026-015', title: 'Cloud configuration validation', mode: 'propose', owner: 'Sam Patel', updated: D('Oct 13', '8:30 AM'), messages: [
      msg('c1', 'user', 'Draft a plan to validate the cloud lab configuration.', D('Oct 13', '8:20 AM')),
      msg('c2', 'ai', 'Proposed PL-022 from the Cloud lab configuration review playbook. Awaiting review.', D('Oct 13', '8:30 AM'), { kind: 'plan', planId: 'PL-022' }),
    ] },
    { id: 'CV-016-01', projectId: 'RT-2026-016', title: 'External exposure mapping', mode: 'propose', owner: 'Alex Morgan', updated: D('Oct 12', '2:10 PM'), messages: [
      msg('r1', 'user', 'Map the external exposure of the retail perimeter.', D('Oct 12', '2:05 PM')),
      msg('r2', 'ai', 'Drafted PL-023. It cannot be approved or executed until the ROE is approved.', D('Oct 12', '2:10 PM'), { kind: 'plan', planId: 'PL-023' }),
    ] },
  ]

  const c2Nodes: C2Node[] = [
    { id: 'C2-01', name: 'lab-c2-01', region: 'Singapore (demo)', kind: 'Team server', status: 'healthy', version: '4.2.0', projectIds: ['RT-2026-014', 'RT-2026-015'], latency: '38 ms', load: 34, last: D('Oct 13', '10:42 AM') },
    { id: 'C2-02', name: 'lab-redirector-03', region: 'Singapore (demo)', kind: 'Redirector', status: 'healthy', version: '4.2.0', projectIds: ['RT-2026-014'], latency: '41 ms', load: 22, last: D('Oct 13', '10:42 AM') },
    { id: 'C2-03', name: 'lab-relay-02', region: 'Frankfurt (demo)', kind: 'Relay', status: 'degraded', version: '4.1.9', projectIds: ['RT-2026-014', 'RT-2026-015'], latency: '212 ms', load: 71, last: D('Oct 13', '10:40 AM') },
    { id: 'C2-04', name: 'ts-eu-02', region: 'Frankfurt (demo)', kind: 'Team server', status: 'maintenance', version: '4.2.0', projectIds: [], latency: '—', load: 0, last: D('Oct 12', '11:00 PM') },
  ]
  const channels: Channel[] = [
    { id: 'CH-014', name: 'northwind-https', protocol: 'HTTPS', nodeId: 'C2-01', status: 'connected', sessions: 2, projectId: 'RT-2026-014', beacon: '30s', jitter: '15%', last: D('Oct 13', '10:42 AM') },
    { id: 'CH-014B', name: 'northwind-dns', protocol: 'DNS', nodeId: 'C2-02', status: 'connected', sessions: 0, projectId: 'RT-2026-014', beacon: '60s', jitter: '20%', last: D('Oct 13', '10:41 AM') },
    { id: 'CH-015', name: 'fabrikam-https', protocol: 'HTTPS', nodeId: 'C2-03', status: 'degraded', sessions: 1, projectId: 'RT-2026-015', beacon: '30s', jitter: '10%', last: D('Oct 13', '10:40 AM') },
  ]
  const tr = (t: string, who: 'system' | 'user' | 'target', text: string) => ({ ts: t, who, text })
  const sessions: Session[] = [
    { id: 'SS-041', projectId: 'RT-2026-014', opId: 'OP-014', agentId: 'AG-007', asset: 'win-dc-01', kind: 'reverse', channelId: 'CH-014', account: 'svc-demo', integrity: 'Standard', state: 'connected', started: D('Oct 13', '9:31 AM'), last: D('Oct 13', '10:42 AM'),
      grants: [{ user: 'Taylor Chen', perm: 'interactive', expires: D('Oct 13', '11:15 AM'), by: 'Alex Morgan' }], transcript: [
        tr('09:31:02', 'system', 'Session established over northwind-https (demo).'), tr('09:32:10', 'user', '[simulated] list working directory'), tr('09:32:11', 'target', 'Demo data — 4 entries returned.'),
        tr('09:35:40', 'user', '[simulated] show current account'), tr('09:35:41', 'target', 'Demo data — svc-demo (standard integrity).'),
      ] },
    { id: 'SS-042', projectId: 'RT-2026-014', opId: 'OP-014', agentId: 'AG-008', asset: 'web-01', kind: 'web', channelId: 'CH-014', account: 'www-demo', integrity: 'Standard', state: 'connected', started: D('Oct 13', '9:45 AM'), last: D('Oct 13', '10:40 AM'), grants: [], transcript: [
      tr('09:45:12', 'system', 'Web session attached to web-01 (demo).'), tr('09:46:00', 'target', 'Demo data — application profile captured (read-only).'),
    ] },
    { id: 'SS-043', projectId: 'RT-2026-015', opId: 'OP-015', agentId: 'AG-010', asset: 'cloud-app-01', kind: 'reverse', channelId: 'CH-015', account: 'svc-cloud-demo', integrity: 'Standard', state: 'connected', started: D('Oct 13', '8:46 AM'), last: D('Oct 13', '10:38 AM'), grants: [], transcript: [
      tr('08:46:20', 'system', 'Session established over fabrikam-https (demo).'), tr('08:50:00', 'target', 'Demo data — configuration summary captured.'),
    ] },
    { id: 'SS-040', projectId: 'RT-2026-014', opId: 'OP-013', agentId: 'AG-007', asset: 'win-dc-01', kind: 'reverse', channelId: 'CH-014', account: 'svc-demo', integrity: 'Standard', state: 'terminated', started: D('Oct 6', '9:02 AM'), last: D('Oct 6', '11:20 AM'), grants: [], transcript: [
      tr('09:02:01', 'system', 'Session established (demo).'), tr('11:20:00', 'system', 'Session terminated at operation completion.'),
    ] },
  ]
  const sessionRequests: SessionRequest[] = [
    { id: 'AR-011', sessionId: 'SS-041', projectId: 'RT-2026-014', by: 'Taylor Chen', reason: 'Interactive access to validate step 8 output.', mode: 'interactive', duration: 'Until 11:15 AM (UTC+7)', status: 'approved', at: D('Oct 13', '9:55 AM'), decidedBy: 'Alex Morgan', note: 'Approved for OP-014 only.' },
    { id: 'AR-012', sessionId: 'SS-042', projectId: 'RT-2026-014', by: 'Riley Brooks', reason: 'Need interactive access to confirm web profile findings.', mode: 'interactive', duration: '1 hour', status: 'pending', at: D('Oct 13', '10:30 AM') },
  ]

  const approvals: Approval[] = [
    { id: 'APR-061', projectId: 'PT-2026-006', type: APR.create, by: 'Jordan Lee', reviewer: 'Pat Kim', at: D('Oct 12', '4:10 PM'), status: 'pending', note: 'Requesting approval of ROE v1.', diff: 'New ROE: Mon–Fri 9:00 AM–5:00 PM; 1 asset pending classification; emergency contact missing.' },
    { id: 'APR-141', projectId: 'RT-2026-014', type: APR.create, by: 'Alex Morgan', reviewer: 'Pat Kim', at: D('Sep 25', '10:00 AM'), status: 'approved', note: 'Eligible.' },
    { id: 'APR-142', projectId: 'RT-2026-014', type: APR.scope, by: 'Alex Morgan', reviewer: 'Pat Kim', at: D('Oct 2', '11:00 AM'), status: 'approved', note: 'ROE-014-v2: 12 assets in scope.' },
    { id: 'APR-151', projectId: 'RT-2026-015', type: APR.create, by: 'Sam Patel', reviewer: 'Pat Kim', at: D('Sep 30', '10:00 AM'), status: 'approved', note: '' },
    { id: 'APR-161', projectId: 'RT-2026-016', type: APR.create, by: 'Alex Morgan', reviewer: 'Pat Kim', at: D('Oct 8', '10:00 AM'), status: 'approved', note: 'Project approved; ROE still in draft.' },
  ]
  const audit: Audit[] = [
    { corr: 'COR-014-01', id: 'AU-1', at: D('Oct 13', '10:30 AM'), actor: 'Riley Brooks', role: 'Analyst', action: 'Requested interactive session access', obj: 'SS-042', projectId: 'RT-2026-014', result: 'Pending', reason: 'Confirm web profile findings' },
    { corr: 'COR-014-01', id: 'AU-2', at: D('Oct 13', '9:55 AM'), actor: 'Alex Morgan', role: 'Red Team Manager', action: 'Approved session access', obj: 'SS-041', projectId: 'RT-2026-014', result: 'Success', reason: 'Approved for OP-014 only' },
    { corr: 'COR-014-01', id: 'AU-3', at: D('Oct 13', '9:30 AM'), actor: 'Taylor Chen', role: 'Operator', action: 'Started operation', obj: 'OP-014', projectId: 'RT-2026-014', result: 'Success', reason: 'Preflight passed' },
    { corr: 'COR-014-01', id: 'AU-4', at: D('Oct 13', '9:25 AM'), actor: 'Pat Kim', role: 'Reviewer', action: 'Approved AI plan', obj: 'PL-021', projectId: 'RT-2026-014', result: 'Success', reason: 'Approved within ROE-014-v2' },
    { corr: 'COR-014-01', id: 'AU-5', at: D('Oct 13', '9:12 AM'), actor: 'AI Operator', role: 'System', action: 'Blocked tool call', obj: 'prod-payments-db', projectId: 'RT-2026-014', result: 'Denied', reason: 'Out of scope' },
    { id: 'AU-6', at: D('Oct 13', '8:45 AM'), actor: 'Sam Patel', role: 'Red Team Manager', action: 'Started operation', obj: 'OP-015', projectId: 'RT-2026-015', result: 'Success', reason: '' },
    { id: 'AU-7', at: D('Oct 12', '4:10 PM'), actor: 'Jordan Lee', role: 'Red Team Manager', action: 'Submitted for approval', obj: 'PT-2026-006', projectId: 'PT-2026-006', result: 'Pending', reason: '' },
    { id: 'AU-8', at: D('Aug 30', '5:00 PM'), actor: 'Pat Kim', role: 'Red Team Manager', action: 'Closed project', obj: 'RT-2026-009', projectId: 'RT-2026-009', result: 'Success', reason: 'Delivery complete' },
  ]
  const notices: Notice[] = [
    { id: 'N1', group: 'todo', category: 'approvals', text: 'PT-2026-006 is waiting for your ROE approval', projectId: 'PT-2026-006', at: D('Oct 12', '4:10 PM'), read: false, to: { name: 'project', id: 'PT-2026-006' } },
    { id: 'N2', group: 'todo', category: 'plans', text: 'AI plan PL-022 needs review', projectId: 'RT-2026-015', at: D('Oct 13', '8:30 AM'), read: false, to: { name: 'ai-plan-review', id: 'PL-022' } },
    { id: 'N3', group: 'todo', category: 'sessions', text: 'Session access request AR-012 is pending', projectId: 'RT-2026-014', at: D('Oct 13', '10:30 AM'), read: false, to: { name: 'c2', id: 'AR-012' } },
    { id: 'N4', group: 'todo', category: 'plans', text: 'FD-011 needs review', projectId: 'RT-2026-014', at: D('Oct 13', '10:20 AM'), read: false, to: { name: 'finding', id: 'FD-011' } },
    { id: 'N5', group: 'update', category: 'agents', text: 'AG-009 disconnected since Oct 12, 6:05 PM', projectId: 'RT-2026-014', at: D('Oct 12', '6:20 PM'), read: false, to: { name: 'agent', id: 'AG-009' } },
    { id: 'N6', group: 'update', category: 'reports', text: 'REP-015 is waiting for review', projectId: 'RT-2026-015', at: D('Oct 12', '5:00 PM'), read: true, to: { name: 'report-review', id: 'REP-015' } },
    { id: 'N7', group: 'system', category: 'system', text: 'SIEM-Lab integration synced at 10:00 AM', projectId: '', at: D('Oct 13', '10:00 AM'), read: true, to: { name: 'settings' } },
  ]
  const groups: Group[] = [
    { id: 'GR-01', name: 'Windows Lab A', projectId: 'RT-2026-014', desc: 'Windows agent group for RT-2026-014', agents: ['AG-007', 'AG-009'], owner: 'Alex Morgan', policy: 'Project use only', updated: 'Oct 2, 2026' },
    { id: 'GR-02', name: 'Linux Lab A', projectId: 'RT-2026-014', desc: 'Linux agent group for RT-2026-014', agents: ['AG-008'], owner: 'Alex Morgan', policy: 'Project use only', updated: 'Oct 2, 2026' },
    { id: 'GR-03', name: 'Cloud B', projectId: 'RT-2026-015', desc: 'Cloud lab agent group', agents: ['AG-010', 'AG-011'], owner: 'Sam Patel', policy: 'Project use only', updated: 'Oct 5, 2026' },
  ]
  const templates: Template[] = [
    { id: 'TP-1', name: 'Standard Red Team v3', kind: 'Red Team', version: 'v3', owner: 'Dana Whitfield', status: 'published', lang: 'English', updated: 'Sep 1, 2026', sections: ['Cover Page', 'Executive Summary', 'Scope', 'Methodology', 'Findings', 'Recommendations', 'Appendix'] },
    { id: 'TP-2', name: 'Assessment v2', kind: 'Assessment', version: 'v2', owner: 'Dana Whitfield', status: 'published', lang: 'English', updated: 'Aug 15, 2026', sections: ['Cover Page', 'Executive Summary', 'Scope', 'Results', 'Recommendations'] },
    { id: 'TP-3', name: 'Purple Team v1', kind: 'Purple Team', version: 'v1', owner: 'Dana Whitfield', status: 'published', lang: 'English', updated: 'Sep 20, 2026', sections: ['Cover Page', 'Summary', 'Detection Coverage', 'Recommendations'] },
    { id: 'TP-4', name: 'Executive Brief (draft)', kind: 'Red Team', version: 'v0.2', owner: 'Dana Whitfield', status: 'draft', lang: 'English', updated: 'Oct 10, 2026', sections: ['Cover Page', 'Executive Summary'] },
  ]
  const integrations: Integration[] = [
    { id: 'IN-1', name: 'SIEM-Lab', kind: 'SIEM', status: 'connected', updated: D('Oct 13', '10:00 AM'), owner: 'Dana Whitfield', scope: 'Lab alert logs (read-only)', secret: '••••••••••••a91f', history: ['Oct 13, 10:00 AM — Synced 1,204 records', 'Oct 13, 9:00 AM — Synced 988 records'] },
    { id: 'IN-2', name: 'MITRE ATT&CK Catalog', kind: 'ATT&CK catalog', status: 'connected', updated: D('Oct 1', '8:00 AM'), owner: 'Dana Whitfield', scope: 'Techniques & tactics (v16)', secret: '—', history: ['Oct 1, 8:00 AM — Catalog updated'] },
    { id: 'IN-3', name: 'Evidence Store', kind: 'File store', status: 'connected', updated: D('Oct 13', '9:10 AM'), owner: 'Dana Whitfield', scope: 'Per-project evidence storage', secret: '••••••••••••7c02', history: ['Oct 13, 9:10 AM — Connection check passed'] },
    { id: 'IN-4', name: 'Ticketing', kind: 'Task management', status: 'authfail', updated: D('Oct 11', '4:00 PM'), owner: 'Dana Whitfield', scope: 'Create remediation tasks', secret: '••••••••••••e5d3', history: ['Oct 11, 4:00 PM — Authentication failed: token expired'] },
    { id: 'IN-5', name: 'Agent Execution Gateway', kind: 'Execution system', status: 'connected', updated: D('Oct 13', '10:42 AM'), owner: 'Dana Whitfield', scope: 'Agent orchestration (simulated)', secret: '••••••••••••1b44', history: ['Oct 13, 10:42 AM — Heartbeat'] },
  ]
  const policies: Policy[] = [
    { id: 'PL-1', name: 'Project creation', desc: 'New projects need approval before operations can be prepared.', approvers: 'Reviewer group', count: 1, enabled: true, impact: 'New projects start as Pending Approval', updated: 'Sep 1, 2026' },
    { id: 'PL-2', name: 'Scope change', desc: 'Scope changes after approval must be re-approved.', approvers: 'Reviewer group', count: 1, enabled: true, impact: 'New operations are locked until re-approval', updated: 'Sep 1, 2026' },
    { id: 'PL-3', name: 'Run operation', desc: 'Preflight must pass every required check.', approvers: 'Red Team Manager', count: 1, enabled: true, impact: 'An operation cannot start with a failed check', updated: 'Sep 1, 2026' },
    { id: 'PL-4', name: 'Prohibited assets', desc: 'Blocks restricted-zone assets from operations.', approvers: 'Organization Admin', count: 1, enabled: true, impact: 'Out-of-scope assets do not appear in the target picker', updated: 'Sep 1, 2026' },
    { id: 'PL-5', name: 'Time-window override', desc: 'Allows exceptions outside the ROE window with special approval.', approvers: 'Organization Admin', count: 2, enabled: false, impact: 'Off: every operation must fall inside the ROE window', updated: 'Sep 1, 2026' },
    { id: 'PL-6', name: 'Concurrent agent use', desc: 'An agent serves one operation at a time.', approvers: 'Red Team Manager', count: 1, enabled: true, impact: 'Resource-conflict warning when scheduling', updated: 'Sep 1, 2026' },
    { id: 'PL-7', name: 'Emergency stop', desc: 'Reason is required and the action is audited.', approvers: 'No approval needed', count: 0, enabled: true, impact: 'Operations move to Stopped (emergency) and never auto-restart', updated: 'Sep 1, 2026' },
    { id: 'PL-8', name: 'Report export', desc: 'Only approved reports can be exported.', approvers: 'Reviewer group', count: 1, enabled: true, impact: 'Export is locked until the report is approved', updated: 'Sep 1, 2026' },
    { id: 'PL-9', name: 'Close / reopen project', desc: 'Requires a reason and approval; audited.', approvers: 'Organization Admin', count: 1, enabled: true, impact: 'Closed projects are read-only', updated: 'Sep 1, 2026' },
    { id: 'PL-10', name: 'AI plan approval', desc: 'AI-proposed plans must be approved before any tool executes.', approvers: 'Reviewer group', count: 1, enabled: true, impact: 'AI can propose but never execute without an approved plan', updated: 'Oct 1, 2026' },
    { id: 'PL-11', name: 'Interactive session access', desc: 'Interactive consoles require a time-boxed, audited grant.', approvers: 'Red Team Manager', count: 1, enabled: true, impact: 'Consoles are read-only until a grant is approved', updated: 'Oct 1, 2026' },
  ]
  const retention: Retention[] = [
    { id: 'RP-1', name: 'Closed project evidence', scope: 'Organization', period: '24 months', label: 'Confidential', owner: 'Dana Whitfield', expires: 'Aug 30, 2028', state: 'Retained' },
    { id: 'RP-2', name: 'Delivered reports', scope: 'Organization', period: '60 months', label: 'Internal', owner: 'Dana Whitfield', expires: 'Aug 28, 2031', state: 'Retained' },
    { id: 'RP-3', name: 'Operation logs', scope: 'RT-2026-009', period: '12 months', label: 'Confidential', owner: 'Pat Kim', expires: 'Nov 30, 2026', state: 'Expiring soon' },
  ]
  const detection: Record<string, Record<string, DetectState>> = {
    'RT-2026-014': { T1082: 'detected', T1087: 'detected', T1078: 'undetected', T1069: 'nodata', T1046: 'nodata', T1592: 'nodata', T1053: 'nodata', T1005: 'nodata' },
    'RT-2026-015': { T1082: 'detected', T1069: 'detected', T1087: 'detected', T1078: 'detected', T1110: 'undetected', T1046: 'nodata' },
    'RT-2026-009': { T1046: 'detected' },
  }
  const counters = { op: 16, plan: 23, session: variant === 'e2e01' ? 50 : 43, finding: 16, report: 16, approval: 200, request: 12, audit: 8 }
  const stopState = null as StopState | null
  // Ticket 56: organization settings live in the one database so profile edits
  // and member role/status overrides persist for the demo session and publish
  // ChangeSets through the shared commit bridge.
  const org: OrgState = {
    profile: { name: 'Acme Security (Demo)', tz: 'Asia/Ho_Chi_Minh (UTC+7)', dateFmt: 'MMM D, YYYY', landing: 'Dashboard', contact: 'dana.whitfield@acme-security.example.test', policy: 'Data stays in the demo region; evidence is encrypted; least-privilege access.', defWorkspace: 'WS-02' },
    members: {},
    invites: [],
    holds: [],
  }
  return { groups, templates, integrations, policies, retention, detection, projects, operations, agents, assets, evidence, findings, reports, exportsList, playbooks, approvals, audit, notices, plans, conversations, toolEvents, branches, branchGroups, aiWorkers, c2Nodes, channels, sessions, sessionRequests, counters, stopState, org }
}
export type Db = ReturnType<typeof seed>
