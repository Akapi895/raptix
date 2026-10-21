import type { BranchState, Facets, Role, Technique, ToolState } from './entities';

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
