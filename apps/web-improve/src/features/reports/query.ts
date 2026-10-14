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
import { useServices } from '../../state/services'
import { consoleKeys, useQueryScope, type QueryScope } from '../../state/keys'
import type { RequestContext, ServiceFailure, ServiceResult } from '../../domain/service'
import type { Report, Template } from '../../domain/entities'
import type { DeliveryListQuery, DraftOptionsRead, DeliveryInput, NoFind, ReportDecision, ReportDraftInput, ReportEditorRead, ReportListQuery, ReportListRead, ReportReviewRead, ReportSubmitInput } from './service'

/** Feature-local key namespaces, each aligned with its owning entity kind.
 *  The editor/preview key shares the `report` kind prefix, so any committed
 *  report change (legacy action or typed section write) refetches both
 *  screens and the catalog from one publication. */
export const reportKeys = {
  list: (scope: QueryScope, query: ReportListQuery) => consoleKeys.view('report', scope, 'list', query),
  templates: (scope: QueryScope) => consoleKeys.view('template', scope, 'list'),
  deliveries: (scope: QueryScope, query: DeliveryListQuery) => consoleKeys.view('report-export', scope, 'list', query),
  draftOptions: (scope: QueryScope) => consoleKeys.view('finding', scope, 'report-draft-options'),
  /** One editor/preview read of a report (ticket 35) — both screens consume it. */
  editor: (scope: QueryScope, id: string) => consoleKeys.view('report', scope, 'editor', id),
  /** One review read (ticket 36); the variant is part of the read's inputs. */
  review: (scope: QueryScope, id: string, variant: string) => consoleKeys.view('report', scope, 'review', id, variant),
}

/** A service failure rethrown as the query error, so screens render the kind and message. */
export class ReportReadError extends Error {
  constructor(readonly failure: ServiceFailure) {
    super(failure.message)
    this.name = 'ReportReadError'
  }
}

const ctxOf = (scope: QueryScope, corr: string): RequestContext => {
  const actor = actorRef(scope.actor, scope.role)
  return { actor, projectId: scope.project, corr }
}

/** Query-backed report catalog (KPI counts, filter options, page) for the current scope. */
export function useReportList(query: ReportListQuery) {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: reportKeys.list(scope, query),
    queryFn: async (): Promise<ReportListRead> => {
      const res = await services.reports(actorRef(scope.actor, scope.role), scope.project).list(ctxOf(scope, 'report-list'), query)
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
      const res = await services.reports(actorRef(scope.actor, scope.role), scope.project).templates()
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
      const res = await services.reports(actorRef(scope.actor, scope.role), scope.project).deliveries(ctxOf(scope, 'report-deliveries'), query)
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
      const res = await services.reports(actorRef(scope.actor, scope.role), scope.project).draftOptions(ctxOf(scope, 'report-draft-options'))
      if (!res.ok) throw new ReportReadError(res.failure)
      return res.data
    },
    enabled: !!services && enabled,
  })
}

/**
 * Query-backed editor/preview read of one report (ticket 35): the report
 * aggregate, its project summary, the handler-computed edit gate and the
 * resolved finding rows. Keyed under the `report` kind, so a committed
 * report change — a typed section write or a legacy `saveReportSection` —
 * invalidates it and both screens refetch from the one publication. A
 * non-member's read resolves to a not-found failure (no existence leak).
 * An empty id (malformed deep link) also refuses with not-found.
 */
export function useReportEditor(id: string) {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: reportKeys.editor(scope, id),
    queryFn: async (): Promise<ReportEditorRead> => {
      const res = await services.reports(actorRef(scope.actor, scope.role), scope.project).editor(ctxOf(scope, 'report-editor'), id)
      if (!res.ok) throw new ReportReadError(res.failure)
      return res.data
    },
    enabled: !!services,
  })
}

/**
 * Query-backed review read (ticket 36): the report aggregate, its project,
 * the review checklist, the linked findings with redaction markers, this
 * report's export/delivery records and the handler-computed action gates.
 * Keyed under the `report` kind, so any committed report change — a typed
 * review decision, a legacy approval or a section write — refetches it.
 * `nf` (the no-findings variant) is part of the key.
 */
export function useReportReview(id: string, nf?: NoFind) {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: reportKeys.review(scope, id, nf?.on ? 'nf' : 'std'),
    queryFn: async (): Promise<ReportReviewRead> => {
      const res = await services.reports(actorRef(scope.actor, scope.role), scope.project).review(ctxOf(scope, 'report-review'), id, nf)
      if (!res.ok) throw new ReportReadError(res.failure)
      return res.data
    },
    enabled: !!services,
  })
}

/**
 * Write-side binding (tickets 34 + 35): the validated draft creation and the
 * section/findings writes for the current scope. Each call captures
 * actor/project at call time — a persona or project switch never retargets
 * an in-flight write — and every commit publishes one ChangeSet that the
 * bridge turns into refetches for both the Query views and the legacy store.
 * Callers resolve the explicit ServiceResult: a refused write commits
 * nothing and the message is safe to render.
 */
export function useReportWrites() {
  const services = useServices()
  const scope = useQueryScope()
  return useMemo(() => {
    const actor = actorRef(scope.actor, scope.role)
    const ctx = (corr: string): RequestContext => ({ actor, projectId: scope.project, corr })
    const svc = () => services.reports(actor, scope.project)
    return {
      createDraft: (input: ReportDraftInput): Promise<ServiceResult<Report>> =>
        svc().createDraft(ctx('report-create'), input),
      saveSection: (id: string, sectionId: string, body: string): Promise<ServiceResult<Report>> =>
        svc().saveSection(ctx('report-section-save'), id, sectionId, body),
      addSection: (id: string, title: string): Promise<ServiceResult<Report>> =>
        svc().addSection(ctx('report-section-add'), id, title),
      removeSection: (id: string, sectionId: string): Promise<ServiceResult<Report>> =>
        svc().removeSection(ctx('report-section-remove'), id, sectionId),
      reorderSections: (id: string, order: string[]): Promise<ServiceResult<Report>> =>
        svc().reorderSections(ctx('report-section-reorder'), id, order),
      setFindings: (id: string, ids: string[]): Promise<ServiceResult<Report>> =>
        svc().setFindings(ctx('report-findings-set'), id, ids),
      /* Ticket 36: submit/approve/return + export/delivery. */
      submit: (id: string, input: ReportSubmitInput): Promise<ServiceResult<Report>> =>
        svc().submit(ctx('report-submit'), id, input),
      decide: (id: string, decision: ReportDecision, note: string): Promise<ServiceResult<Report>> =>
        svc().decide(ctx('report-decide'), id, decision, note),
      exportVersion: (id: string, format: 'PDF' | 'DOCX') =>
        svc().exportVersion(ctx('report-export'), id, format),
      deliver: (id: string, input: DeliveryInput): Promise<ServiceResult<Report>> =>
        svc().deliver(ctx('report-deliver'), id, input),
      acknowledge: (id: string) => svc().acknowledge(ctx('report-ack'), id),
    }
  }, [services, scope.actor, scope.project])
}
