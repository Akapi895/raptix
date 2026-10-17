/**
 * C2 provider query binding (plan P12, C2 slice). The surface, the grants and the
 * command ledger are separate reads, so one unavailable source never hides the
 * others. Writes resolve to the committed record or throw a C2ProviderError with
 * the provider's own refusal; a committed write refreshes every provider read.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { actorRef } from '../../auth/persona'
import { useFeatureServices as useServices } from '../../state/feature-services'
import { consoleKeys, useQueryScope, type QueryScope } from '../../state/keys'
import type { RequestContext, ServiceFailure, ServiceResult } from '../../domain/service'
import type { C2DispatchInput, C2ProviderService } from './provider'

export class C2ProviderError extends Error {
  constructor(readonly failure: ServiceFailure) {
    super(failure.message)
    this.name = 'C2ProviderError'
  }
}

/** The message a failed call shows: the server's own words when it gave them. */
export const messageOf = (error: unknown, fallback: string): string => (error instanceof Error ? error.message : fallback)

const COMMAND_POLL_MS = 15_000

async function unwrap<T>(result: Promise<ServiceResult<T>>): Promise<T> {
  const res = await result
  if (!res.ok) throw new C2ProviderError(res.failure)
  return res.data
}

const ctxOf = (scope: QueryScope, engagementId: string, corr: string): RequestContext => ({ actor: actorRef(scope.actor, scope.role), projectId: engagementId, corr })

function useProviderClient(engagementId: string) {
  const services = useServices()
  const scope = useQueryScope()
  const service = (): C2ProviderService => services.c2Provider(actorRef(scope.actor, scope.role), engagementId)
  return { services, scope, service }
}

export function useProviderSurface(engagementId: string) {
  const { services, scope, service } = useProviderClient(engagementId)
  return useQuery({
    queryKey: consoleKeys.view('c2-provider', scope, engagementId, 'surface'),
    queryFn: () => unwrap(service().surface(ctxOf(scope, engagementId, 'c2-surface'))),
    enabled: !!services,
    retry: false,
  })
}

export function useProviderGrants(engagementId: string) {
  const { services, scope, service } = useProviderClient(engagementId)
  return useQuery({
    queryKey: consoleKeys.view('c2-provider', scope, engagementId, 'grants'),
    queryFn: () => unwrap(service().grants(ctxOf(scope, engagementId, 'c2-grants'))),
    enabled: !!services,
  })
}

export function useProviderCommands(engagementId: string) {
  const { services, scope, service } = useProviderClient(engagementId)
  return useQuery({
    queryKey: consoleKeys.view('c2-provider', scope, engagementId, 'commands'),
    queryFn: () => unwrap(service().commands(ctxOf(scope, engagementId, 'c2-commands'))),
    enabled: !!services,
    refetchInterval: COMMAND_POLL_MS,
    retry: false,
  })
}

/** Writes against the provider; each committed write refreshes every provider read of the engagement. */
export function useProviderWrites(engagementId: string) {
  const { scope, service } = useProviderClient(engagementId)
  const client = useQueryClient()
  const run = async <T>(corr: string, call: (svc: C2ProviderService, ctx: RequestContext) => Promise<ServiceResult<T>>): Promise<T> => {
    const data = await unwrap(call(service(), ctxOf(scope, engagementId, corr)))
    await client.invalidateQueries({ queryKey: ['c2-provider'] })
    return data
  }
  return {
    requestGrant: (input: { sessionId: string; reason: string; expiresAt: string }) => run('c2-grant-request', (s, c) => s.requestGrant(c, input)),
    decideGrant: (grantId: string, decision: 'approved' | 'rejected' | 'revoked') => run('c2-grant-decide', (s, c) => s.decideGrant(c, grantId, decision)),
    dispatch: (input: C2DispatchInput) => run('c2-dispatch', (s, c) => s.dispatch(c, input)),
    reconcile: (commandId: string) => run('c2-reconcile', (s, c) => s.reconcile(c, commandId)),
    startListener: (protocol: 'mtls' | 'http') => run('c2-listener-start', (s, c) => s.startListener(c, protocol)),
    stopListener: (jobId: number) => run('c2-listener-stop', (s, c) => s.stopListener(c, jobId)),
    createProfile: (name: string) => run('c2-profile-create', (s, c) => s.createProfile(c, name)),
  }
}
