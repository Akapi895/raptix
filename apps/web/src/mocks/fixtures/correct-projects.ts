export type Screen =
  | 'projects'
  | 'overview'
  | 'charter'
  | 'agent-run'
  | 'assets'
  | 'findings'
  | 'reports'
  | 'logs'
  | 'credentials'
  | 'members'
  | 'project-settings'
  | 'operator-console'
  | 'vector-campaigns'
  | 'c2-sessions'
  | 'scope-boundaries'
  | 'infrastructure'

export type ProjectStatus = 'active' | 'completed' | 'paused' | 'planning'
export type MemberRole = 'Owner' | 'Member' | 'Viewer'

export interface Member {
  id: string
  name: string
  initials: string
  email: string
  role: MemberRole
  status: 'active' | 'invited' | 'inactive'
  lastActivity: string
}

export interface Project {
  id: string
  name: string
  scopeLabel: string
  scopeType: string
  status: ProjectStatus
  currentPhase: string
  myRole: MemberRole
  findings: number
  assets: number
  agents: number
  members: Member[]
  startDate: string
  client: string
  lastActivity: string
}

export const MEMBERS_BY_PROJECT: Record<string, Member[]> = {
  '1': [
    { id: 'm1', name: 'Alex Kim', initials: 'AK', email: 'alex.kim@raptix.io', role: 'Owner', status: 'active', lastActivity: 'Now' },
    { id: 'm2', name: 'Sarah Rowe', initials: 'SR', email: 'sarah.rowe@raptix.io', role: 'Member', status: 'active', lastActivity: '12 min ago' },
    { id: 'm3', name: 'Marcus Lee', initials: 'ML', email: 'm.lee@raptix.io', role: 'Member', status: 'active', lastActivity: '1 hour ago' },
    { id: 'm4', name: 'Phuong Quoc', initials: 'PQ', email: 'pq@acme.com', role: 'Viewer', status: 'active', lastActivity: 'Yesterday' },
    { id: 'm5', name: 'Jordan Diaz', initials: 'JD', email: 'jdiaz@acme.com', role: 'Viewer', status: 'invited', lastActivity: '—' },
  ],
  '2': [
    { id: 'm1', name: 'Jordan Diaz', initials: 'JD', email: 'jdiaz@raptix.io', role: 'Owner', status: 'active', lastActivity: '5 min ago' },
    { id: 'm2', name: 'Alex Kim', initials: 'AK', email: 'alex.kim@raptix.io', role: 'Member', status: 'active', lastActivity: '30 min ago' },
  ],
  '3': [
    { id: 'm1', name: 'Sarah Rowe', initials: 'SR', email: 'sarah.rowe@raptix.io', role: 'Owner', status: 'active', lastActivity: '3 days ago' },
    { id: 'm2', name: 'Marcus Lee', initials: 'ML', email: 'm.lee@raptix.io', role: 'Member', status: 'active', lastActivity: '3 days ago' },
    { id: 'm3', name: 'Phuong Quoc', initials: 'PQ', email: 'pq@raptix.io', role: 'Member', status: 'active', lastActivity: '3 days ago' },
    { id: 'm4', name: 'Jordan Diaz', initials: 'JD', email: 'jdiaz@raptix.io', role: 'Viewer', status: 'active', lastActivity: '5 days ago' },
  ],
  '4': [
    { id: 'm1', name: 'Marcus Lee', initials: 'ML', email: 'm.lee@raptix.io', role: 'Owner', status: 'active', lastActivity: '2 weeks ago' },
  ],
  '5': [
    { id: 'm1', name: 'Alex Kim', initials: 'AK', email: 'alex.kim@raptix.io', role: 'Owner', status: 'active', lastActivity: '1 hour ago' },
    { id: 'm2', name: 'Sarah Rowe', initials: 'SR', email: 'sarah.rowe@raptix.io', role: 'Member', status: 'invited', lastActivity: '—' },
    { id: 'm3', name: 'Marcus Lee', initials: 'ML', email: 'm.lee@raptix.io', role: 'Member', status: 'invited', lastActivity: '—' },
    { id: 'm4', name: 'Phuong Quoc', initials: 'PQ', email: 'pq@raptix.io', role: 'Viewer', status: 'invited', lastActivity: '—' },
    { id: 'm5', name: 'Jordan Diaz', initials: 'JD', email: 'jdiaz@raptix.io', role: 'Viewer', status: 'invited', lastActivity: '—' },
  ],
}

export const PROJECTS: Project[] = [
  {
    id: '1',
    name: 'Acme Corp External Assessment',
    scopeLabel: 'acme.com, *.acme-staging.io (47 hosts)',
    scopeType: 'External Web Pentest',
    client: 'Acme Corporation',
    status: 'active',
    currentPhase: 'Assessment',
    myRole: 'Owner',
    findings: 12,
    assets: 134,
    agents: 3,
    members: MEMBERS_BY_PROJECT['1'],
    startDate: '2026-09-10',
    lastActivity: '14 minutes ago',
  },
  {
    id: '2',
    name: 'FinTech API Red Team',
    scopeLabel: 'api.fintech-internal.io, admin panel',
    scopeType: 'API Security Assessment',
    client: 'NovaPay Ltd.',
    status: 'active',
    currentPhase: 'Reconnaissance',
    myRole: 'Member',
    findings: 7,
    assets: 62,
    agents: 4,
    members: MEMBERS_BY_PROJECT['2'],
    startDate: '2026-09-15',
    lastActivity: '1 hour ago',
  },
  {
    id: '3',
    name: 'Healthcare Portal Audit',
    scopeLabel: 'portal.healthcorp.net (internal)',
    scopeType: 'Web Application',
    client: 'HealthCorp International',
    status: 'completed',
    currentPhase: 'Reporting',
    myRole: 'Member',
    findings: 23,
    assets: 89,
    agents: 0,
    members: MEMBERS_BY_PROJECT['3'],
    startDate: '2026-08-20',
    lastActivity: '3 days ago',
  },
  {
    id: '4',
    name: 'E-commerce Platform Assessment',
    scopeLabel: 'shop.brand.co — full scope',
    scopeType: 'Web Application',
    client: 'BrandCo Retail',
    status: 'paused',
    currentPhase: 'Assessment',
    myRole: 'Viewer',
    findings: 3,
    assets: 28,
    agents: 0,
    members: MEMBERS_BY_PROJECT['4'],
    startDate: '2026-09-01',
    lastActivity: '2 weeks ago',
  },
  {
    id: '5',
    name: 'Gov Agency Cloud Infrastructure',
    scopeLabel: 'AWS us-east-1, 12 accounts',
    scopeType: 'Cloud Infrastructure',
    client: 'Dept. of Infrastructure',
    status: 'planning',
    currentPhase: 'Intake',
    myRole: 'Owner',
    findings: 0,
    assets: 0,
    agents: 0,
    members: MEMBERS_BY_PROJECT['5'],
    startDate: '2026-09-20',
    lastActivity: '1 hour ago',
  },
]
