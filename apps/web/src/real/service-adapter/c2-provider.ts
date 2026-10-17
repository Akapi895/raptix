import type { C2CommandView } from '@raptix/web-contracts'
import type { RequestContext, ServiceResult } from '../../domain/service'
import type { C2ProviderCommand, C2ProviderGrant, C2ProviderService, C2ProviderSurface } from '../../features/c2/provider'
import {
  configureC2Listener, configureC2Profile, decideC2Grant, dispatchC2Command, fetchC2Commands, fetchC2Grants, fetchC2Sessions, reconcileC2Command, requestC2Grant, stopC2Listener,
  type C2GrantView,
} from '../api'
import { guarded } from './shared'

const NO_ENGAGEMENT = { kind: 'validation' as const, message: 'Select an engagement before reading or changing its C2 console.' }

const grantOf = (view: C2GrantView): C2ProviderGrant => ({
  id: view.id,
  sessionId: view.sessionId,
  status: view.status,
  reason: view.reason,
  actorId: view.actorId,
  reviewerId: view.reviewerId,
  expiresAt: view.expiresAt,
})

const commandOf = (view: C2CommandView): C2ProviderCommand => ({
  id: view.id,
  requestId: view.requestId,
  sessionId: view.sessionId,
  path: view.path,
  args: view.args,
  status: view.status,
  exitCode: view.exitCode,
  stdout: view.stdout,
  stdoutTruncated: view.stdoutTruncated,
  createdAt: view.createdAt,
})

/** The provider reports the check-in in unix seconds; the console shows it as an ISO instant. */
const instantOf = (unixSeconds: number): string => new Date(unixSeconds * 1000).toISOString()

/** Every call goes to the owning engagement's provider namespace; the server decides what it may do. */
export function createRealC2ProviderService(): C2ProviderService {
  const engagementOf = (ctx: RequestContext): string | null => (ctx.projectId && ctx.projectId !== 'all' ? ctx.projectId : null)
  const scoped = <T>(ctx: RequestContext, run: (engagementId: string) => Promise<ServiceResult<T>>) => guarded(async () => {
    const engagementId = engagementOf(ctx)
    return engagementId === null ? { ok: false as const, failure: NO_ENGAGEMENT } : run(engagementId)
  })
  return {
    surface: (ctx) => scoped(ctx, async (engagementId): Promise<ServiceResult<C2ProviderSurface>> => {
      const view = await fetchC2Sessions(engagementId)
      return {
        ok: true,
        data: {
          sessions: view.sessions.map((s) => ({
            id: s.id,
            hostname: s.hostname,
            username: s.username,
            os: s.os,
            arch: s.arch,
            transport: s.transport,
            activeC2: s.activeC2,
            remoteAddress: s.remoteAddress,
            listenerPort: s.listenerPort,
            lastCheckin: instantOf(s.lastCheckin),
            isDead: s.isDead,
          })),
          listeners: view.listeners.map((l) => ({ jobId: l.jobId, protocol: l.protocol, port: l.port, active: l.active })),
          profiles: view.profiles.map((p) => ({ name: p.name, userAgent: p.userAgent })),
        },
      }
    }),
    grants: (ctx) => scoped(ctx, async (engagementId) => {
      const view = await fetchC2Grants(engagementId)
      return { ok: true, data: { grants: view.grants.map(grantOf), bounds: { minHours: view.minGrantHours, maxHours: view.maxGrantHours } } }
    }),
    commands: (ctx) => scoped(ctx, async (engagementId) => ({ ok: true, data: (await fetchC2Commands(engagementId)).map(commandOf) })),
    requestGrant: (ctx, input) => scoped(ctx, async (engagementId) => ({ ok: true, data: grantOf(await requestC2Grant(engagementId, input)) })),
    decideGrant: (ctx, grantId, decision) => scoped(ctx, async (engagementId) => ({ ok: true, data: grantOf(await decideC2Grant(engagementId, grantId, decision)) })),
    dispatch: (ctx, input) => scoped(ctx, async (engagementId) => ({
      ok: true,
      data: commandOf(await dispatchC2Command(engagementId, input.sessionId, { requestId: input.requestId, path: input.path, args: input.args })),
    })),
    reconcile: (ctx, commandId) => scoped(ctx, async (engagementId) => ({ ok: true, data: commandOf(await reconcileC2Command(engagementId, commandId)) })),
    startListener: (ctx, protocol) => scoped(ctx, async (engagementId) => {
      await configureC2Listener(engagementId, protocol)
      return { ok: true, data: null }
    }),
    stopListener: (ctx, jobId) => scoped(ctx, async (engagementId) => {
      await stopC2Listener(engagementId, jobId)
      return { ok: true, data: null }
    }),
    createProfile: (ctx, name) => scoped(ctx, async (engagementId) => {
      await configureC2Profile(engagementId, name)
      return { ok: true, data: null }
    }),
  }
}
