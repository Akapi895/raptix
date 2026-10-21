/**
 * Feature-local project handlers for the portfolio screen (ticket 16,
 * ADR-0067 — docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Extends the representative ProjectService (ticket 04) with the operations
 * the portfolio needs — aggregate list, single read and pin — without
 * editing the shared factory. Request contexts are built at call time, so a
 * persona/project switch never retargets an in-flight request, and
 * authorization reasons come from the shared permission policy (ticket 06)
 * so UI hints and handler refusals state the same rule.
 */
import { can, projectLocked } from '../domain/policy'
import type { Project } from '../domain/entities'
import type {
  ActorRef, ListResult, ReadResult, RequestContext, ServiceFailure, ServiceResult,
} from '../domain/service'
import type { ConsoleServices } from '../domain/service-factory'

/** Query-facing error carrying the typed service failure into the error state. */
export class ServiceReadError extends Error {
  constructor(readonly failure: ServiceFailure) {
    super(failure.message)
    this.name = 'ServiceReadError'
  }
}

export interface PortfolioHandlers {
  /** Canonical accessible projects for the active scope ('all' aggregates). */
  listAccessible(): Promise<ListResult<Project>>
  /** One scope-checked project read. */
  read(id: string): Promise<ReadResult<Project>>
  /** Pin/unpin with the shared role/read-only policy enforced by the handler. */
  setPinned(id: string, pinned: boolean): Promise<ServiceResult<Project>>
}

/**
 * Builds the portfolio's project handlers for one actor/scope. `scopeProject`
 * uses the store's project vocabulary ('all' included) so the factory's
 * in-flight guard registers where the cancel bridge looks; the read context
 * maps the aggregate back to the service's '' token.
 */
export function createPortfolioHandlers(svc: ConsoleServices, actor: ActorRef, scopeProject: string): PortfolioHandlers {
  const project = svc.forScope(actor, scopeProject)
  let seq = 0
  const ctx = (): RequestContext => ({ actor, projectId: scopeProject === 'all' ? '' : scopeProject, corr: `pf-${++seq}` })
  return {
    listAccessible: () => project.list(ctx()),
    read: (id) => project.get(ctx(), id),
    setPinned: async (id, pinned) => {
      const req = ctx()
      const got = await project.get(req, id)
      if (!got.ok) return got
      if (!can(actor, 'editScope', got.data)) {
        const message = projectLocked(got.data)
          ? 'This project is closed or cancelled and is read-only.'
          : 'Only a Red Team Manager or Organization Admin can pin projects.'
        return { ok: false, failure: { kind: 'forbidden', message, entity: { kind: 'project', id, projectId: id } } }
      }
      return project.update(req, id, { pinned })
    },
  }
}
