/**
 * C2 provider port (plan P12, C2 slice). The real console reads what the
 * provider reports: sessions, listeners and profiles from its registry, the
 * grants that authorize command dispatch, and the durable command ledger. A
 * connected session is not an authorization: a command needs a live approved
 * grant with an absolute deadline, and the server checks it at dispatch and
 * again at completion. The mock console keeps its own session model (ROE
 * targets, transcripts), so this port has no mock adapter.
 */
import type { RequestContext, ServiceResult } from '../../domain/service'

export interface C2ProviderSession {
  id: string
  hostname: string
  username: string
  os: string
  arch: string
  transport: string
  activeC2: string
  remoteAddress: string
  listenerPort: number
  /** The provider's last check-in as an ISO instant. */
  lastCheckin: string
  isDead: boolean
}

export interface C2ProviderListener { jobId: number; protocol: 'mtls' | 'http'; port: number; active: boolean }

export interface C2ProviderProfile { name: string; userAgent: string }

export interface C2ProviderSurface {
  sessions: C2ProviderSession[]
  listeners: C2ProviderListener[]
  profiles: C2ProviderProfile[]
}

export type C2GrantStatus = 'requested' | 'approved' | 'rejected' | 'revoked' | 'expired'

export interface C2ProviderGrant {
  id: string
  sessionId: string
  status: C2GrantStatus
  reason: string
  actorId: string
  reviewerId: string | null
  expiresAt: string
}

/** The grant duration the server enforces; the request form clamps to it. */
export interface C2GrantBounds { minHours: number; maxHours: number }

export interface C2GrantList { grants: C2ProviderGrant[]; bounds: C2GrantBounds }

export type C2CommandStatus = 'creating' | 'succeeded' | 'failed' | 'uncertain'

export interface C2ProviderCommand {
  id: string
  requestId: string
  sessionId: string
  path: string
  args: string[]
  status: C2CommandStatus
  exitCode: number | null
  stdout: string
  stdoutTruncated: boolean
  createdAt: string
}

export interface C2DispatchInput { sessionId: string; requestId: string; path: string; args: string[] }

export interface C2ProviderService {
  surface(ctx: RequestContext): Promise<ServiceResult<C2ProviderSurface>>
  grants(ctx: RequestContext): Promise<ServiceResult<C2GrantList>>
  commands(ctx: RequestContext): Promise<ServiceResult<C2ProviderCommand[]>>
  requestGrant(ctx: RequestContext, input: { sessionId: string; reason: string; expiresAt: string }): Promise<ServiceResult<C2ProviderGrant>>
  decideGrant(ctx: RequestContext, grantId: string, decision: 'approved' | 'rejected' | 'revoked'): Promise<ServiceResult<C2ProviderGrant>>
  /** Dispatches only under a live approved grant; the server refuses otherwise. */
  dispatch(ctx: RequestContext, input: C2DispatchInput): Promise<ServiceResult<C2ProviderCommand>>
  reconcile(ctx: RequestContext, commandId: string): Promise<ServiceResult<C2ProviderCommand>>
  startListener(ctx: RequestContext, protocol: 'mtls' | 'http'): Promise<ServiceResult<null>>
  stopListener(ctx: RequestContext, jobId: number): Promise<ServiceResult<null>>
  createProfile(ctx: RequestContext, name: string): Promise<ServiceResult<null>>
}

