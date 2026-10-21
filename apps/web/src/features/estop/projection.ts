/** Scope-checked emergency-stop state and impact identities for synchronous controls. */
import type { Operation, Session, StopState } from '../../domain/entities'
import type { ConsoleServices } from '../../domain/service-factory'
import type { RequestContext } from '../../domain/service'
import { projectView, scopedRows } from '../../domain/projection'
import { projectAccessible } from '../../domain/policy'
import { useServiceProjection } from '../../state/projection'

export interface StopRead {
  stopState: StopState | null
  operations: Pick<Operation, 'id' | 'projectId' | 'status'>[]
  sessions: Pick<Session, 'id' | 'projectId' | 'opId' | 'state'>[]
}

export function readStop(services: ConsoleServices, ctx: RequestContext): StopRead {
  return projectView(services, ctx, 'stop-state-impact', (db) => {
    const stop = db.stopState
    const stopProject = stop?.scope === 'operation' ? db.operations.find((o) => o.id === stop.id)?.projectId : stop?.id
    const visible = !stop || stop.scope === 'workspace' || projectAccessible(db.projects.find((p) => p.id === stopProject), ctx.actor)
    return {
      stopState: visible ? stop : null,
      operations: scopedRows(db, ctx, db.operations).map(({ id, projectId, status }) => ({ id, projectId, status })),
      sessions: scopedRows(db, ctx, db.sessions).map(({ id, projectId, opId, state }) => ({ id, projectId, opId, state })),
    }
  })
}

export function useStopRead(projectId?: string): StopRead {
  return useServiceProjection(readStop, projectId)
}
