/** Project ribbon activity counts and runtime labels derived at the service boundary. */
import type { ConsoleServices } from '../../domain/console-services';
import type { RequestContext } from '../../domain/service'
import { projectView, scopedRows } from '../../domain/projection'
import { useServiceProjection } from '../../state/projection'

export interface ProjectActivityRead {
  running: number; stoppable: number; inScope: number; stopBusy: boolean
  runtime: { id: string; text: string; tone: 'bad' | 'warn' | 'cyan' } | null
}

export function readProjectActivity(services: ConsoleServices, ctx: RequestContext): ProjectActivityRead {
  return projectView(services, ctx, 'project-ribbon-activity', (db) => {
    const ops = scopedRows(db, ctx, db.operations)
    const op = ops.find((o) => ['running', 'paused', 'estop'].includes(o.status))
    const review = op?.steps.some((s) => s.status === 'review')
    return {
      running: ops.filter((o) => o.status === 'running').length,
      stoppable: ops.filter((o) => ['running', 'paused'].includes(o.status)).length,
      inScope: scopedRows(db, ctx, db.assets).filter((a) => a.scope === 'in').length,
      stopBusy: !!db.stopState && ['requested', 'acknowledged', 'stopping', 'unknown', 'failed'].includes(db.stopState.phase),
      runtime: op ? {
        id: op.id, text: op.status === 'estop' ? 'Emergency stopped' : op.status === 'paused' ? 'Paused' : review ? 'Paused — Awaiting Review' : `Running ${op.steps.filter((s) => s.status === 'ok').length}/${op.steps.length} steps`,
        tone: op.status === 'estop' ? 'bad' : op.status === 'paused' || review ? 'warn' : 'cyan',
      } : null,
    }
  })
}

export function useProjectActivity(projectId: string): ProjectActivityRead {
  return useServiceProjection(readProjectActivity, projectId)
}
