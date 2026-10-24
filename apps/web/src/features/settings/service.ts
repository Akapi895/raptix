import type { RequestContext, ServiceResult } from '../../domain/service'
import type { Audit, Integration, OrgInvite, OrgProfile, Policy, Retention, Role } from '../../domain/entities'

export type { OrgInvite, OrgProfile } from '../../domain/entities'

/** The workspace list is demo display data; only the default choice is state. */
export const WORKSPACES: readonly { id: string; name: string; state: string }[] = [
  { id: 'WS-01', name: 'Raptix Workspace — Production', state: 'Active' },
  { id: 'WS-02', name: 'Raptix Workspace — Test Lab', state: 'Active (current)' },
  { id: 'WS-03', name: 'Archive workspace 2025', state: 'Read-only' },
]

/** One organization profile read: settings plus the workspace list. The
 *  admin contact is masked for non-admin readers (they cannot save either). */
export interface OrgProfileRead {
  profile: OrgProfile
  workspaces: typeof WORKSPACES
  contactMasked: boolean
}

/** One member row: the seeded identity plus the committed overrides. */
export interface OrgMemberView {
  name: string
  email: string
  role: Role
  seededRole: Role
  overridden: boolean
  locked: boolean
  revoked: boolean
  /** Project ids the member belongs to (elevated roles reach every project). */
  projects: string[]
  /** Recent audit events for this member (access history view). */
  history: Audit[]
  self: boolean
}

export interface OrgMembersRead {
  members: OrgMemberView[]
  invites: OrgInvite[]
  /** All workspaces' projects (invite project-scope options). */
  projectOptions: { id: string; name: string }[]
  /** Surfaced for UI hints; every mutation re-checks at the handler. */
  canEdit: boolean
}

/** Validated profile patch; `undefined` fields keep the committed value. */
export interface OrgProfilePatch { name?: string; tz?: string; dateFmt?: string; landing?: string; contact?: string; policy?: string; defWorkspace?: string }

/** Member status action; `lock`/`revoke` require a reason, `unlock` does not. */
export type OrgMemberStatusAction = 'lock' | 'unlock' | 'revoke'

/** Payload for a new invitation. */
export interface OrgInviteInput { email: string; role: Role; project: string; days: string; note: string }

/**
 * One integration-registry read. The masked access key is stored masked at
 * the seed boundary and never unmasked here; `siem` is the detection-source
 * summary the analysis screens' indicators derive from, and `canEdit` is the
 * UI hint — every mutation re-checks the role at the handler.
 */
export interface IntegrationsRead {
  integrations: Integration[]
  siem: { id: string; name: string; connected: boolean } | null
  canEdit: boolean
}

/** Connection action: `connect` succeeds a disconnected/failed source;
 *  `disconnect` is the destructive revoke and requires a reason. */
export type IntegrationAction = 'connect' | 'disconnect'

/** One policy-list read: the recorded toggles plus the edit hint. */
export interface PoliciesRead {
  policies: Policy[]
  /** Recent audit rows per policy object id, newest first (the "last change" line). */
  recentAudit: Audit[]
  canEdit: boolean
}

/**
 * One retention read: the seeded policies, the committed legal holds and the
 * retention-relevant audit slice. Holds live in `db.org` (the ticket 56
 * workspace state) so a hold placed here persists for the demo session,
 * commits atomically with its audit row and demo reset restores the seed.
 * Every control stays clearly simulated — saving or deleting records
 * configuration/audit rows and never destroys seeded data.
 */
/** A workspace setting: a numeric value the server applies to its consumers, versioned for optimistic writes. */
export interface WorkspaceSetting {
  key: string
  kind: string
  value: number
  version: number
  updatedBy: string | null
  updatedAt: string | null
  consumer: string | null
  enforcement: string
  description: string
}

export interface WorkspaceSettingsRead { settings: WorkspaceSetting[] }

export interface WorkspaceSettingWriteInput { value: number; expectedVersion: number; reason: string }

export interface RetentionRead {
  policies: Retention[]
  /** Retention ids currently under a legal hold (blocks scheduled deletion). */
  holds: string[]
  /** Retention-relevant audit rows, scoped and sensitive-filtered, newest first. */
  history: Audit[]
  /** UI hint; every mutation re-checks the role at the handler. */
  canEdit: boolean
}

/** Validated retention policy patch; `undefined` fields keep the committed value. */
export interface RetentionPatch { period?: string; label?: string }

/** One audit-history query: every field is an optional narrowing filter. */
export interface AuditQuery { q?: string; actor?: string; action?: string; project?: string; result?: string; origin?: '' | 'human' | 'ai'; corr?: string; kind?: '' | 'estop' }

/** One audit-history read: the filtered rows plus the filter option universes. */
export interface AuditRead {
  /** Newest-first filtered rows (the tab paginates for display). */
  items: Audit[]
  total: number
  options: { actors: string[]; actions: string[]; results: string[]; corrs: string[] }
  /** Export gate: Organization Admins and Reviewers only (baseline policy). */
  canExport: boolean
}

/** Builds the typed organization settings service; `guard` is the factory's
 *  superseded-scope read guard. Reads observe scope cancellation; mutations
 *  capture their context at call time and commit once. */
export interface SettingsService {
  getProfile(ctx: RequestContext): Promise<ServiceResult<OrgProfileRead>>
  getMembers(ctx: RequestContext): Promise<ServiceResult<OrgMembersRead>>
  updateProfile(ctx: RequestContext, patch: OrgProfilePatch): Promise<ServiceResult<OrgProfile>>
  setMemberRole(ctx: RequestContext, name: string, role: Role, reason: string): Promise<ServiceResult<OrgMemberView>>
  setMemberStatus(ctx: RequestContext, name: string, action: OrgMemberStatusAction, reason: string): Promise<ServiceResult<OrgMemberView>>
  inviteMember(ctx: RequestContext, input: OrgInviteInput): Promise<ServiceResult<OrgInvite>>
  /* Ticket 57: integration registry + policy configuration. */
  getIntegrations(ctx: RequestContext): Promise<ServiceResult<IntegrationsRead>>
  getPolicies(ctx: RequestContext): Promise<ServiceResult<PoliciesRead>>
  setIntegrationConnection(ctx: RequestContext, id: string, action: IntegrationAction, reason: string): Promise<ServiceResult<Integration>>
  updateIntegrationKey(ctx: RequestContext, id: string, key: string): Promise<ServiceResult<Integration>>
  setPolicyEnabled(ctx: RequestContext, id: string, enabled: boolean, reason: string): Promise<ServiceResult<Policy>>
  /* Ticket 58: retention controls + canonical audit history. */
  getRetention(ctx: RequestContext): Promise<ServiceResult<RetentionRead>>
  getAudit(ctx: RequestContext, query: AuditQuery): Promise<ServiceResult<AuditRead>>
  updateRetention(ctx: RequestContext, id: string, patch: RetentionPatch): Promise<ServiceResult<Retention>>
  setRetentionHold(ctx: RequestContext, id: string, held: boolean, reason: string): Promise<ServiceResult<Retention>>
  deleteRetentionData(ctx: RequestContext, id: string, reason: string): Promise<ServiceResult<Retention>>
  /* Workspace settings are real numeric configuration; the simulated store keeps policies and retention as records instead. */
  getWorkspaceSettings(ctx: RequestContext): Promise<ServiceResult<WorkspaceSettingsRead>>
  saveWorkspaceSetting(ctx: RequestContext, key: string, input: WorkspaceSettingWriteInput): Promise<ServiceResult<WorkspaceSetting>>
}
