import type { RequestContext, ServiceResult } from '../../domain/service'
import { guarded } from '../../platform/adapter-shared'
import {
  closeWebShellConnection,
  createWebShellAcquisition,
  createWebShellConnection,
  executeWebShellCommand,
  fetchWebShellAcquisition,
  fetchWebShellAcquisitions,
  fetchWebShellCommand,
  fetchWebShellCommands,
  fetchWebShellConnection,
  fetchWebShellConnections,
  fetchWebShellProbes,
  probeWebShellConnection,
  retryWebShellAcquisition,
  updateWebShellConnection,
} from './api'
import type { WebShellService } from './service'

const NO_ENGAGEMENT = { kind: 'validation' as const, message: 'Select an engagement before reading or changing its WebShell sessions.' }

export function createRealWebShellService(): WebShellService {
  const engagementOf = (ctx: RequestContext): string | null => (ctx.projectId && ctx.projectId !== 'all' ? ctx.projectId : null)
  const scoped = <T>(ctx: RequestContext, run: (engagementId: string) => Promise<ServiceResult<T>>) => guarded(async () => {
    const engagementId = engagementOf(ctx)
    return engagementId === null ? { ok: false as const, failure: NO_ENGAGEMENT } : run(engagementId)
  })
  return {
    list: (ctx) => scoped(ctx, async (engagementId) => ({ ok: true, data: await fetchWebShellConnections(engagementId) })),
    get: (ctx, connectionId) => scoped(ctx, async (engagementId) => ({ ok: true, data: await fetchWebShellConnection(engagementId, connectionId) })),
    create: (ctx, input) => scoped(ctx, async (engagementId) => ({ ok: true, data: await createWebShellConnection(engagementId, input) })),
    update: (ctx, connectionId, input) => scoped(ctx, async (engagementId) => ({ ok: true, data: await updateWebShellConnection(engagementId, connectionId, input) })),
    close: (ctx, connectionId) => scoped(ctx, async (engagementId) => ({ ok: true, data: await closeWebShellConnection(engagementId, connectionId) })),
    probe: (ctx, connectionId, requestId) => scoped(ctx, async (engagementId) => ({ ok: true, data: await probeWebShellConnection(engagementId, connectionId, requestId) })),
    probes: (ctx, connectionId) => scoped(ctx, async (engagementId) => ({ ok: true, data: await fetchWebShellProbes(engagementId, connectionId) })),
    commands: (ctx, connectionId) => scoped(ctx, async (engagementId) => ({ ok: true, data: await fetchWebShellCommands(engagementId, connectionId) })),
    command: (ctx, connectionId, commandId) => scoped(ctx, async (engagementId) => ({ ok: true, data: await fetchWebShellCommand(engagementId, connectionId, commandId) })),
    execute: (ctx, connectionId, input) => scoped(ctx, async (engagementId) => ({ ok: true, data: await executeWebShellCommand(engagementId, connectionId, input) })),
    listAcquisitions: (ctx) => scoped(ctx, async (engagementId) => ({ ok: true, data: await fetchWebShellAcquisitions(engagementId) })),
    getAcquisition: (ctx, acquisitionId) => scoped(ctx, async (engagementId) => ({ ok: true, data: await fetchWebShellAcquisition(engagementId, acquisitionId) })),
    createAcquisition: (ctx, input) => scoped(ctx, async (engagementId) => ({ ok: true, data: await createWebShellAcquisition(engagementId, input) })),
    retryAcquisition: (ctx, acquisitionId) => scoped(ctx, async (engagementId) => ({ ok: true, data: await retryWebShellAcquisition(engagementId, acquisitionId) })),
  }
}
