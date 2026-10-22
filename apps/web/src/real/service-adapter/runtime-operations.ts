import type { OperationView, RequestRecoveryView, ScopedRunView } from '@raptix/web-contracts'
import type { RequestContext, ServiceResult } from '../../domain/service'
import type { RuntimeFleet, RuntimeOperationsService, RuntimeRun, RuntimeTimeline } from '../../features/operations/runtime'
import { cancelRun, completeOperation, fetchFleet, fetchOperation, pauseOperationRun, resumeOperation } from '../../features/operations/remote';
import { fetchTimeline } from '../../features/analysis/remote';
import { getThread, listRunsOfThread, listThreads } from '../../features/aichat/remote';
import { guarded } from '../../platform/adapter-shared'

const NO_ENGAGEMENT = { kind: 'validation' as const, message: 'Select an engagement before reading its operations.' }

const runOf = (view: ScopedRunView): RuntimeRun => ({
  runId: view.runId,
  requestId: view.requestId,
  threadId: view.threadId,
  rawStatus: view.rawStatus,
  createdAt: view.createdAt,
  updatedAt: view.updatedAt,
})

/** The runtime's own answers only: every read goes to the owning engagement's runtime binding. */
export function createRealRuntimeOperationsService(): RuntimeOperationsService {
  const engagementOf = (ctx: RequestContext): string | null => (ctx.projectId && ctx.projectId !== 'all' ? ctx.projectId : null)
  const scoped = <T>(ctx: RequestContext, run: (engagementId: string) => Promise<ServiceResult<T>>) => guarded(async () => {
    const engagementId = engagementOf(ctx)
    return engagementId === null ? { ok: false as const, failure: NO_ENGAGEMENT } : run(engagementId)
  })
  return {
    fleet: (ctx) => scoped(ctx, async (engagementId): Promise<ServiceResult<RuntimeFleet>> => {
      const view = await fetchFleet(engagementId)
      return {
        ok: true,
        data: {
          agents: view.agents.map((a) => ({ graphId: a.graphId })),
          threads: view.threads.map((t) => ({ threadId: t.threadId, assistantId: t.assistantId, kind: t.kind, rawStatus: t.rawStatus, activeRunId: t.activeRunId })),
          branches: view.branches.map((b) => ({ threadId: b.threadId, key: b.key, agent: b.agent, state: b.state, outcome: b.outcome, startedAt: b.startedAt, endedAt: b.endedAt })),
          counts: view.counts,
          excludedActions: view.excludedActions,
          sources: view.sources,
        },
      }
    }),
    threads: (ctx) => scoped(ctx, async (engagementId) => {
      const list = await listThreads(engagementId)
      return {
        ok: true,
        data: list.threads
          .filter((t) => t.kind === 'execution')
          .map((t) => ({ threadId: t.threadId, assistantId: t.assistantId, createdAt: t.createdAt })),
      }
    }),
    runs: (ctx, threadId) => scoped(ctx, async (engagementId) => {
      const page = await listRunsOfThread(engagementId, threadId)
      return { ok: true, data: page.runs.map(runOf) }
    }),
    snapshot: (ctx, threadId) => scoped(ctx, async (engagementId) => {
      const view = await getThread(engagementId, threadId)
      return { ok: true, data: { transcripts: view.transcripts ?? [], transcriptsTruncated: view.transcriptsTruncated ?? false } }
    }),
    cancelRun: (ctx, threadId, runId) => scoped(ctx, async (engagementId) => ({ ok: true, data: runOf(await cancelRun(engagementId, threadId, runId)) })),
    operation: (ctx, threadId) => scoped(ctx, async (engagementId): Promise<ServiceResult<OperationView>> => ({ ok: true, data: await fetchOperation(engagementId, threadId) })),
    pauseRun: (ctx, threadId, runId) => scoped(ctx, async (engagementId): Promise<ServiceResult<OperationView>> => ({ ok: true, data: await pauseOperationRun(engagementId, threadId, runId) })),
    resumeOperation: (ctx, threadId, requestId) => scoped(ctx, async (engagementId): Promise<ServiceResult<RequestRecoveryView>> => ({ ok: true, data: await resumeOperation(engagementId, threadId, requestId) })),
    completeOperation: (ctx, threadId) => scoped(ctx, async (engagementId): Promise<ServiceResult<OperationView>> => ({ ok: true, data: await completeOperation(engagementId, threadId) })),
    timeline: (ctx) => scoped(ctx, async (engagementId): Promise<ServiceResult<RuntimeTimeline>> => {
      const view = await fetchTimeline(engagementId)
      return { ok: true, data: { entries: view.entries, truncated: view.truncated, unavailableThreads: view.unavailableThreads } }
    }),
  }
}
