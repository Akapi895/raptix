// Typed model for the planning slice (Charter & ScopeBoundaries screens).
// Shapes follow the engagement planning bundle described in
// docs/engagement-workflow.md: Soundwave writes `plan/*.json`; the
// orchestrator builds `plan/opplan.json`. All data shown in the UI is
// fixture data — nothing here is a live engagement contract.

export type KillChainPhase = 'recon' | 'initial-access' | 'post-exploit' | 'c2' | 'exfiltration'

export type OpsecLevel = 'loud' | 'standard' | 'careful' | 'quiet' | 'silent'

export type OpplanStatus = 'pending' | 'in-progress' | 'completed' | 'blocked' | 'cancelled'

export interface TestingWindow {
  label: string
  window: string
  allowed: boolean
}

export interface RoEDoc {
  authorizedScope: string[]
  exclusions: string[]
  testingWindows: TestingWindow[]
  rules: { title: string; detail: string }[]
  legalAuthorization: string
}

export interface ConopsDoc {
  threatModel: string
  phases: { name: KillChainPhase; goal: string }[]
}

export interface DeconflictionDoc {
  sourceIps: string[]
  userAgents: string[]
  timeWindows: string[]
  sharedCode: string
}

export interface OpplanObjective {
  id: string
  title: string
  phase: KillChainPhase
  opsecLevel: OpsecLevel
  mitre: string[]
  dependsOn: string[]
  acceptanceCriteria: string
  status: OpplanStatus
}

export interface OpplanDoc {
  objectives: OpplanObjective[]
}

export interface PlanningBundle {
  sourceNote: string
  roe: RoEDoc
  conops: ConopsDoc
  deconfliction: DeconflictionDoc
  opplan: OpplanDoc
}

export type ScopeTargetType = 'cidr' | 'web' | 'api' | 'host' | 'email'

export type ScopePermission = 'full-access' | 'enumerate-only' | 'phishing-allowed'

export interface ScopeTarget {
  id: string
  identifier: string
  type: ScopeTargetType
  environment: string
  permission: ScopePermission
}

export interface BlacklistEntry {
  id: string
  identifier: string
  label: string
  reason: string
}

export interface ScopeFixture {
  sourceNote: string
  targets: ScopeTarget[]
  blacklist: BlacklistEntry[]
}
