/**
 * Report catalog Query binding (ticket 34, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Feature-local key namespaces aligned with the owning entity kinds, so the
 * ChangeSetBridge's kind-prefix invalidation reaches them: a committed report
 * change (legacy action or the typed create) invalidates the `report` keys,
 * an export commit the `report-export` keys, and a finding change (e.g. a
 * reviewer confirming a finding) the draft-options key. Keys embed the auth
 * scope at position 1, so a persona/project switch reads a different cache
 * entry and cancels the superseded scope's in-flight reads.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { actorRef } from '../../auth/persona'
import { useServices } from '../../store'
import { consoleKeys, useQueryScope, type QueryScope } from '../../state/keys'
import type { RequestContext, ServiceFailure, ServiceResult } from '../../domain/service'
import type { Report, Template } from '../../domain/entities'
import type { DeliveryListQuery, DraftOptionsRead, ReportDraftInput, ReportListQuery, ReportListRead } from './service'

/** Feature-local key namespaces, each aligned with its owning entity kind. */
export const reportKeys = {
  list: (scope: QueryScope, query: ReportListQuery) => consoleKeys.view('report', scope, 'list', query),
  templates: (scope: QueryScope) => consoleKeys.view('template', scope, 'list'),
  deliveries: (scope: QueryScope, query: DeliveryListQuery) => consoleKeys.view('report-export', scope, 'list', query),
  draftOptions: (scope: QueryScope) => consoleKeys.view('finding', scope, 'report-draft-options'),
}

/** A service failure rethrown as the query error, so screens render the kind and message. */
export class ReportReadError extends Error {
  constructor(readonly failure: ServiceFailure) {
    super(failure.message)
    this.name = 'ReportReadError'
  }
}

const ctxOf = (scope: QueryScope, corr: string): RequestContext => {
  const actor = actorRef(scope.actor)
  return { actor, projectId: scope.project, corr }
}

/** Query-backed report catalog (KPI counts, filter options, page) for the current scope. */
export function useReportList(query: ReportListQuery) {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: reportKeys.list(scope, query),
    queryFn: async (): Promise<ReportListRead> => {
      const res = await services.reports(actorRef(scope.actor), scope.project).list(ctxOf(scope, 'report-list'), query)
      if (!res.ok) throw new ReportReadError(res.failure)
      return res.data
    },
    enabled: !!services,
  })
}

/** Query-backed template gallery (organization assets; any signed-in actor). */
export function useTemplates() {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: reportKeys.templates(scope),
    queryFn: async (): Promise<Template[]> => {
      const res = await services.reports(actorRef(scope.actor), scope.project).templates()
      if (!res.ok) throw new ReportReadError(res.failure)
      return res.data
    },
    enabled: !!services,
  })
}

/** Query-backed delivery history for the reports the scope can access. */
export function useDeliveryHistory(query: DeliveryListQuery) {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: reportKeys.deliveries(scope, query),
    queryFn: async () => {
      const res = await services.reports(actorRef(scope.actor), scope.project).deliveries(ctxOf(scope, 'report-deliveries'), query)
      if (!res.ok) throw new ReportReadError(res.failure)
      return res.data
    },
    enabled: !!services,
  })
}

/**
 * Query-backed draft-creation options (templates, the project's findings
 * with reportability, reviewer candidates and the handler-computed role
 * gate). Keyed under the `finding` kind so a confirmed-finding change
 * refetches the form's selectable findings. Pass `enabled: false` for the
 * aggregate view — draft creation needs a specific project.
 */
export function useDraftOptions(enabled = true) {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: reportKeys.draftOptions(scope),
    queryFn: async (): Promise<DraftOptionsRead> => {
      const res = await services.reports(actorRef(scope.actor), scope.project).draftOptions(ctxOf(scope, 'report-draft-options'))
      if (!res.ok) throw new ReportReadError(res.failure)
      return res.data
    },
    enabled: !!services && enabled,
  })
}

/**
 * Write-side binding (ticket 34): the validated draft creation for the
 * current scope. The call captures actor/project at call time — a persona or
 * project switch never retargets an in-flight write — and the commit
 * publishes one ChangeSet that the bridge turns into refetches for both the
 * Query views and the legacy store. Callers resolve the explicit
 * ServiceResult: a refused create commits nothing and the message is safe to
 * render.
 */
export function useReportWrites() {
  const services = useServices()
  const scope = useQueryScope()
  return useMemo(() => {
    const actor = actorRef(scope.actor)
    const ctx = (corr: string): RequestContext => ({ actor, projectId: scope.project, corr })
    const svc = () => services.reports(actor, scope.project)
    return {
      createDraft: (input: ReportDraftInput): Promise<ServiceResult<Report>> =>
        svc().createDraft(ctx('report-create'), input),
    }
  }, [services, scope.actor, scope.project])
}
