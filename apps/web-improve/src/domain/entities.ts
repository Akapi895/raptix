/**
 * Domain entity and status types for the web console.
 *
 * Each type has exactly one definition (ADR-0067,
 * docs/adr/0067-web-console-service-domain-boundary.md). `src/data.ts`
 * re-exports these so legacy `./data` imports keep working until the
 * retirement tickets (65–67) remove the remaining callers.
 *
 * Evidence-bearing string fields (`Step.evidence`, `Finding.evidence`,
 * `ToolEvent.evidence`, `Branch.evidence`) hold opaque evidence references —
 * see `./evidence` for the findings/evidence vocabulary.
 */

/* ───────────── Status enums ───────────── */
export type ProjectStatus = 'draft' | 'pending' | 'approved' | 'active' | 'review' | 'closed' | 'rejected' | 'paused' | 'cancelled'
export type OpStatus = 'draft' | 'pending' | 'ready' | 'running' | 'paused' | 'done' | 'error' | 'cancelled' | 'estop'
export type StepStatus = 'ok' | 'fail' | 'pending' | 'running' | 'notrun' | 'unknown' | 'review'
export type AgentStatus = 'online' | 'idle' | 'lost' | 'disabled' | 'unknown' | 'unhealthy'
export type FindingStatus = 'draft' | 'review' | 'confirmed' | 'remediation' | 'retest' | 'resolved' | 'returned' | 'ai_suggested'
export type ReportStatus = 'draft' | 'review' | 'approved' | 'exported' | 'delivered' | 'returned'
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'
export type Role = 'admin' | 'manager' | 'operator' | 'reviewer' | 'analyst' | 'viewer'

/* ───────────── Engagement entities ───────────── */
export interface Objective { id: string; text: string; criteria: string; owner: string; progress: number }
export interface Member { user: string; role: Role; since: string }
export interface Project {
  id: string; name: string; client: string; owner: string; type: string; status: ProjectStatus
  start: string; end: string; tz: string; desc: string; pinned: boolean
  roeStatus: 'none' | 'draft' | 'pending' | 'approved' | 'rejected'; roeVersion: string
  window: string; emergency: string; methods: string[]; restrictions: string[]
  objectives: Objective[]; members: Member[]; closedAt?: string; updated: string
}
export interface Step { id: string; name: string; agent: string; asset: string; technique: string; status: StepStatus; ts: string; dur: string; output: string; evidence?: string }
export interface Operation {
  id: string; projectId: string; name: string; status: OpStatus; owner: string; playbookId: string
  agents: string[]; assets: string[]; mode: string; startedAt: string; updated: string; steps: Step[]
  planId?: string; sessionId?: string; schedule?: string
  /** Canonical absolute instant (ISO-8601) of a scheduled start; `schedule` is its UTC+7 projection (ticket 25). */
  scheduleAt?: string
  stopReason?: string; stopBy?: string; stopAt?: string; preflightAt?: string
}
export interface Agent { id: string; host: string; os: string; version: string; projectId: string; status: AgentStatus; lastSeen: string; op: string | null; group: string; conn: string; ip: string }
export interface Asset { id: string; name: string; ident: string; ip: string; type: string; os: string; owner: string; projectId: string; scope: 'in' | 'out' | 'pending' | 'unclassified'; source: string; updated: string }
export interface Evidence { id: string; name: string; kind: string; source: string; at: string; by: string; projectId: string; findingId?: string; opId?: string; sensitive: boolean }
export interface Finding {
  id: string; projectId: string; title: string; severity: Severity; status: FindingStatus; asset: string; op: string
  technique: string; owner: string; date: string; updated: string; desc: string; impact: string; rec: string
  evidence: string[]; comments: { by: string; at: string; text: string }[]; history: { at: string; by: string; text: string }[]
  retests: { at: string; by: string; result: string; note: string }[]
}
export interface Report {
  id: string; projectId: string; title: string; template: string; version: string; status: ReportStatus
  author: string; reviewer: string; updated: string; deliveredAt?: string; findings: string[]
  sections: { id: string; title: string; body: string }[]
  reviews: { at: string; by: string; action: string; note: string; version: string }[]
  /** Canonical version snapshots (ticket 36): one per submitted version; approval pins the approved content. */
  snapshots?: ReportSnapshot[]
}
/** Immutable content of one submitted report version; `pinned` marks the approved snapshot. */
export interface ReportSnapshot { version: string; at: string; by: string; bodies: Record<string, string>; findings: string[]; pinned?: boolean }
export interface ExportRec { id: string; reportId: string; version: string; format: string; by: string; at: string; recipient: string; status: string; checksum: string; /** Delivery handover details (ticket 36), stamped on the delivered record. */ channel?: string; notes?: string; ackAt?: string }
export interface PlaybookRevision { version: string; by: string; at: string; summary: string[]; steps: string[]; techniques: string[] }
export interface Playbook { revision?: PlaybookRevision; id: string; name: string; kind: 'playbook' | 'profile'; version: string; owner: string; status: 'approved' | 'draft' | 'review'; os: string[]; techniques: string[]; steps: string[]; desc: string; goal: string; updated: string; share: string }
export interface Technique { id: string; name: string; tactic: string; platforms: string[]; desc: string }
export interface Approval { id: string; projectId: string; type: string; by: string; reviewer: string; at: string; status: 'pending' | 'approved' | 'returned' | 'withdrawn'; note: string; diff?: string; refId?: string }
export interface Group { id: string; name: string; projectId: string; desc: string; agents: string[]; owner: string; policy: string; updated: string }
export interface Template { id: string; name: string; kind: string; version: string; owner: string; status: 'published' | 'draft'; lang: string; updated: string; sections: string[] }
export interface Integration { id: string; name: string; kind: string; status: 'connected' | 'disconnected' | 'authfail'; updated: string; owner: string; scope: string; secret: string; history: string[] }
export type DetectState = 'detected' | 'undetected' | 'nodata'
export interface Policy { id: string; name: string; desc: string; approvers: string; count: number; enabled: boolean; impact: string; updated: string }
export interface Retention { id: string; name: string; scope: string; period: string; label: string; owner: string; expires: string; state: string }
export interface Audit { corr?: string; id: string; at: string; actor: string; role: string; action: string; obj: string; projectId: string; result: string; reason: string }
export interface Notice { id: string; group: 'todo' | 'update' | 'system'; text: string; projectId: string; at: string; read: boolean; to: { name: string; id?: string }; category?: 'approvals' | 'agents' | 'sessions' | 'plans' | 'reports' | 'system' }

/* ───────────── AI Operator ───────────── */
export type AiMode = 'observe' | 'propose' | 'execution'
export type PlanStatus = 'draft' | 'proposed' | 'in_review' | 'approved' | 'rejected' | 'expired' | 'executed' | 'superseded'
export interface PlanStep { phase?: string; id: string; name: string; technique: string; asset: string; agent: string; tool: string; risk: 'low' | 'medium' | 'high'; needsApproval: boolean; rationale: string }
export interface Plan {
  ver?: string
  id: string; projectId: string; title: string; version: number; status: PlanStatus; author: string; requestedBy: string; reviewer: string
  created: string; updated: string; playbookId: string; assets: string[]; agents: string[]; steps: PlanStep[]; rationale: string; risks: string[]
  roeVersion: string; opId?: string; prevPlanId?: string; changes?: string[]; decision?: { by: string; at: string; note: string }; expires?: string; conversationId: string
}
export type ToolState = 'proposed' | 'awaiting' | 'allowed' | 'denied' | 'running' | 'completed' | 'failed' | 'stopped'
export interface ToolEvent { id: string; conversationId: string; planId?: string; projectId: string; tool: string; target: string; params: string; state: ToolState; at: string; reason?: string; result?: string; opId?: string; stepId?: string; branchId?: string; agentId?: string; corr?: string; evidence?: string[]; ms?: number }
export interface ChatMsg { id: string; role: 'user' | 'ai' | 'system'; text: string; at: string; kind?: 'text' | 'plan' | 'tool' | 'blocked'; planId?: string; toolId?: string; card?: 'answer' | 'proposal' | 'revision' | 'tool' | 'policy' | 'approval' | 'result' | 'analysis' | 'error'; refs?: string[] }
export interface Conversation { id: string; projectId: string; title: string; mode: AiMode; messages: ChatMsg[]; updated: string; owner: string; pinned?: boolean }

/* ───────────── Multi-agent orchestration (simulated) ───────────── */
export type BranchState = 'pending' | 'queued' | 'waiting_approval' | 'running' | 'completed' | 'failed' | 'blocked' | 'paused' | 'cancelled' | 'unknown'
export type BranchApproval = 'none' | 'pending' | 'approved' | 'denied'
export interface BranchLog { at: string; text: string }
export interface Branch {
  id: string; groupId: string; opId: string; projectId: string; stepId: string; agent: string; target: string; tool: string
  state: BranchState; start?: string; dur?: string; progress?: number; evidence: string[]; lastEvent: string; approval: BranchApproval
  toolEventId?: string; output?: string; error?: string; corr: string; timeline: BranchLog[]; assignLog: BranchLog[]; policy: string; pendingRequest?: 'retry' | 'reassign'
}
export interface BranchGroup { id: string; planId: string; planVer: string; opId: string; projectId: string; parentStep: string; aggStep: string; objective: string; policy: string[]; maxConcurrency: number }
export type WorkerState = 'idle' | 'working' | 'waiting' | 'done' | 'failed'
export interface AiWorker { id: string; projectId: string; role: 'Planner' | 'Policy Reviewer' | 'Analysis Worker' | 'Evidence Reviewer' | 'Report Assistant'; task: string; state: WorkerState; inputs: string[]; output: string; parent?: string; deps: string[]; model: string }
export interface Facets { policy: 'Allowed' | 'Blocked' | 'Not evaluated'; approval: 'Not required' | 'Pending' | 'Approved' | 'Denied'; exec: 'Not executed' | 'Running' | 'Executed' | 'Failed' | 'Stopped' }

/* ───────────── C2 & Sessions ───────────── */
export interface C2Node { id: string; name: string; region: string; kind: 'Team server' | 'Redirector' | 'Relay'; status: 'healthy' | 'degraded' | 'offline' | 'maintenance'; version: string; projectIds: string[]; latency: string; load: number; last: string }
export interface Channel { id: string; name: string; protocol: string; nodeId: string; status: 'connected' | 'degraded' | 'disconnected'; sessions: number; projectId: string; beacon: string; jitter: string; last: string }
export type SessionState = 'connected' | 'available' | 'awaiting' | 'suspended' | 'expired' | 'terminated' | 'revoking' | 'disconnected'
export type SessionPerm = 'none' | 'read-only' | 'interactive'
export interface SessionGrant { user: string; perm: 'read-only' | 'interactive'; expires: string; by: string }
export interface Session {
  id: string; projectId: string; opId: string; agentId: string; asset: string; kind: 'reverse' | 'web'; channelId: string; account: string; integrity: string
  state: SessionState; started: string; last: string; grants: SessionGrant[]; transcript: { ts: string; who: 'system' | 'user' | 'target'; text: string }[]
}
export interface SessionRequest { id: string; sessionId: string; projectId: string; by: string; reason: string; mode: 'read-only' | 'interactive'; duration: string; status: 'pending' | 'approved' | 'rejected' | 'changes' | 'expired'; at: string; decidedBy?: string; note?: string }
export type StopPhase = 'requested' | 'acknowledged' | 'failed' | 'unknown' | 'stopping' | 'stopped'
export interface StopState { scope: 'operation' | 'project' | 'workspace'; id: string; phase: StopPhase; reason: string; at: string; by: string }

/* ───────────── Organization settings (ticket 56) ───────────── */
/** Per-member overrides authored in settings; the seeded roles stay in USERS. */
export interface OrgMemberOverride { role?: Role; locked?: boolean; revoked?: boolean }
export interface OrgInvite { id: string; email: string; role: Role; project: string; days: string; note: string; at: string }
export interface OrgProfile {
  name: string; tz: string; dateFmt: string; landing: string; contact: string; policy: string
  /** Workspace chosen as the sign-in default (WS-02 in the demo dataset). */
  defWorkspace: string
}
/** Organization/workspace settings persisted for the demo session in the one database. */
export interface OrgState { profile: OrgProfile; members: Record<string, OrgMemberOverride>; invites: OrgInvite[]
  /** Retention ids under an active legal hold (ticket 58; blocks scheduled deletion). */ holds: string[] }
