export type Screen =
  | 'projects' | 'overview' | 'charter' | 'agent-run' | 'attack-graph'
  | 'knowledge-graph' | 'assets' | 'findings' | 'evidence' | 'reports' | 'logs'
  | 'credentials' | 'members' | 'project-settings' | 'operator-console'
  | 'vector-campaigns' | 'c2-sessions' | 'scope-boundaries' | 'infrastructure'

export type ProjectStatus = 'active' | 'completed' | 'paused' | 'planning'
export type MemberRole = 'Owner' | 'Member' | 'Viewer'
export type TargetType = 'web_url' | 'ip_range'

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
  workspaceSlug?: string
  targetType?: TargetType
  targetValue?: string
  authorizationConfirmed?: boolean
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

export interface CreateProjectInput {
  displayName: string
  workspaceSlug: string
  targetType: TargetType
  targetValue: string
  authorizationConfirmed: boolean
}
