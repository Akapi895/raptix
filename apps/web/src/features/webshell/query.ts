import { useQuery, useQueryClient } from '@tanstack/react-query'
import { actorRef } from '../../domain/actor'
import { useFeatureServices as useServices } from '../../state/feature-services'
import { consoleKeys, useQueryScope, type QueryScope } from '../../state/keys'
import type { RequestContext, ServiceFailure, ServiceResult } from '../../domain/service'
import type { WebShellAcquisitionCreateInput, WebShellCommandCreateInput, WebShellConnectionCreateInput } from '@raptix/web-contracts'
import type { WebShellService, WebShellUpdateInput } from './service'

export class WebShellError extends Error {
  constructor(readonly failure: ServiceFailure) {
    super(failure.message)
    this.name = 'WebShellError'
  }
}

export const messageOf = (error: unknown, fallback: string): string => (error instanceof Error ? error.message : fallback)

async function unwrap<T>(result: Promise<ServiceResult<T>>): Promise<T> {
  const res = await result
  if (!res.ok) throw new WebShellError(res.failure)
  return res.data
}

const ctxOf = (scope: QueryScope, engagementId: string, corr: string): RequestContext => ({ actor: actorRef(scope.actor, scope.role), projectId: engagementId, corr })

function useWebShellClient(engagementId: string) {
  const services = useServices()
  const scope = useQueryScope()
  const service = (): WebShellService => services.webshell(actorRef(scope.actor, scope.role), engagementId)
  return { services, scope, service }
}

export function useWebShellConnections(engagementId: string) {
  const { services, scope, service } = useWebShellClient(engagementId)
  return useQuery({
    queryKey: consoleKeys.view('webshell', scope, engagementId, 'connections'),
    queryFn: () => unwrap(service().list(ctxOf(scope, engagementId, 'webshell-list'))),
    enabled: !!services,
    retry: false,
  })
}

export function useWebShellCommands(engagementId: string, connectionId: string | null) {
  const { services, scope, service } = useWebShellClient(engagementId)
  return useQuery({
    queryKey: consoleKeys.view('webshell', scope, engagementId, 'commands', connectionId),
    queryFn: () => unwrap(service().commands(ctxOf(scope, engagementId, 'webshell-commands'), connectionId!)),
    enabled: !!services && connectionId !== null,
    retry: false,
  })
}

export function useWebShellProbes(engagementId: string, connectionId: string | null) {
  const { services, scope, service } = useWebShellClient(engagementId)
  return useQuery({
    queryKey: consoleKeys.view('webshell', scope, engagementId, 'probes', connectionId),
    queryFn: () => unwrap(service().probes(ctxOf(scope, engagementId, 'webshell-probes'), connectionId!)),
    enabled: !!services && connectionId !== null,
    retry: false,
  })
}

export function useWebShellWrites(engagementId: string) {
  const { scope, service } = useWebShellClient(engagementId)
  const client = useQueryClient()
  const run = async <T>(corr: string, call: (svc: WebShellService, ctx: RequestContext) => Promise<ServiceResult<T>>): Promise<T> => {
    const data = await unwrap(call(service(), ctxOf(scope, engagementId, corr)))
    await client.invalidateQueries({ queryKey: ['webshell'] })
    return data
  }
  return {
    create: (input: WebShellConnectionCreateInput) => run('webshell-create', (s, c) => s.create(c, input)),
    update: (connectionId: string, input: WebShellUpdateInput) => run('webshell-update', (s, c) => s.update(c, connectionId, input)),
    close: (connectionId: string) => run('webshell-close', (s, c) => s.close(c, connectionId)),
    probe: (connectionId: string, requestId: string) => run('webshell-probe', (s, c) => s.probe(c, connectionId, requestId)),
    execute: (connectionId: string, input: WebShellCommandCreateInput) => run('webshell-execute', (s, c) => s.execute(c, connectionId, input)),
    createAcquisition: (input: WebShellAcquisitionCreateInput) => run('webshell-acquire', (s, c) => s.createAcquisition(c, input)),
    retryAcquisition: (acquisitionId: string) => run('webshell-retry', (s, c) => s.retryAcquisition(c, acquisitionId)),
  }
}

export function useWebShellAcquisitions(engagementId: string) {
  const { services, scope, service } = useWebShellClient(engagementId)
  return useQuery({
    queryKey: consoleKeys.view('webshell', scope, engagementId, 'acquisitions'),
    queryFn: () => unwrap(service().listAcquisitions(ctxOf(scope, engagementId, 'webshell-acq-list'))),
    enabled: !!services,
    retry: false,
  })
}
