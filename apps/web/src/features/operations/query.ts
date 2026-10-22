/**
 * Operations inventory Query binding (ticket 24, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Feature-local key namespace over the shared console key builders. The key
 * starts with the `operation` entity kind and embeds the auth scope at
 * position 1, so both bridge invalidation paths reach it: any committed
 * operation change (legacy or service) invalidates the `[kind]` prefix, and
 * a persona/project switch cancels the superseded scope's reads before a
 * delayed response can restore old visibility.
 */
import { useMutation, useQuery } from '@tanstack/react-query'
import { actorRef } from '../../demo/persona'
import { useServices } from '../../state/services'
import { useMe } from '../../state/console'
import { consoleKeys, useQueryScope, type QueryScope } from '../../state/keys'
import type { Instant, ServiceFailure, ServiceResult } from '../../domain/service'
import type { DemoRuntimeControls, DisplayClock } from '../../domain/console-services'
import type { Evidence, Operation } from '../../domain/entities'
import { recordAudit, type AuditInput } from '../audit'
import { addOperationEvidence, type OperationEvidenceInput } from '../results'
import { createOperationFromPlanTransaction, readPlanProject, type PlanBridgeRead } from '../plans'
import type { PfCheck } from './checklist'
import type { Check } from './preflight'
import { readOperationMeta, readOperationPreflight, readOperationSpecChecks } from './views'
import type { OperationDetailRead, OperationDraftInput, OperationDraftOptions, OperationDraftPatch, OperationListQuery, OperationListRead, OperationTransitionRead, OperationWriteRead, PreflightRunRead, StepDecision } from './service'

/** Feature-local key namespace: ['operation', scope, 'list', query]. */
export const operationKeys = {
  list: (scope: QueryScope, query: OperationListQuery) => consoleKeys.view('operation', scope, 'list', query),
  draftOptions: (scope: QueryScope, forOperation?: string) => consoleKeys.view('operation', scope, 'draft-options', forOperation ?? ''),
  detail: (scope: QueryScope, id: string) => consoleKeys.view('operation', scope, 'detail', id),
}

/** A service failure rethrown as the query error, so screens render the kind and message. */
export class OperationReadError extends Error {
  constructor(readonly failure: ServiceFailure) {
    super(failure.message)
  }
}

/** Query-backed operations inventory for the current auth/project scope. */
export function useOperationList(query: OperationListQuery) {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: operationKeys.list(scope, query),
    queryFn: async (): Promise<OperationListRead> => {
      const actor = actorRef(scope.actor, scope.role)
      const res = await services
        .operations(actor, scope.project)
        .list({ actor, projectId: scope.project, corr: 'operations-list' }, query)
      if (!res.ok) throw new OperationReadError(res.failure)
      return res.data
    },
    enabled: !!services,
  })
}

/* ── Ticket 25: wizard option read + creation/edit/schedule writes. ── */

let corrSeq = 0
const corr = (act: string) => `${act}-${++corrSeq}`

/** Scoped wizard selections (approved playbooks, eligible agents, in-scope assets) for the active project. */
export function useOperationDraftOptions(forOperation?: string) {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: operationKeys.draftOptions(scope, forOperation),
    queryFn: async (): Promise<OperationDraftOptions> => {
      const actor = actorRef(scope.actor, scope.role)
      const res = await services
        .operations(actor, scope.project)
        .draftOptions({ actor, projectId: scope.project, corr: 'operation-draft-options' }, forOperation)
      if (!res.ok) throw new OperationReadError(res.failure)
      return res.data
    },
    enabled: !!services && !!scope.project && scope.project !== 'all',
  })
}

/**
 * Write mutations: the hook captures the actor/project scope at call time, so
 * a persona/project switch never retargets an in-flight write. The service
 * result — success or typed failure — is surfaced to the caller's onSuccess,
 * so screens render the reason and keep the form on failure.
 */
export function useCreateOperation() {
  const services = useServices()
  const scope = useQueryScope()
  return useMutation({
    mutationFn: async (input: OperationDraftInput): Promise<ServiceResult<OperationWriteRead>> => {
      const actor = actorRef(scope.actor, scope.role)
      return services.operations(actor, scope.project).create({ actor, projectId: scope.project, corr: corr('operation-create') }, input)
    },
  })
}

export function useUpdateOperation() {
  const services = useServices()
  const scope = useQueryScope()
  return useMutation({
    mutationFn: async (v: { id: string; patch: OperationDraftPatch }): Promise<ServiceResult<OperationWriteRead>> => {
      const actor = actorRef(scope.actor, scope.role)
      return services.operations(actor, scope.project).update({ actor, projectId: scope.project, corr: corr('operation-update') }, v.id, v.patch)
    },
  })
}

/** `at` is 'now' (manual start) or a datetime-local value normalized at the service boundary. */
export function useScheduleOperation() {
  const services = useServices()
  const scope = useQueryScope()
  return useMutation({
    mutationFn: async (v: { id: string; at: 'now' | string }): Promise<ServiceResult<OperationWriteRead>> => {
      const actor = actorRef(scope.actor, scope.role)
      return services.operations(actor, scope.project).schedule({ actor, projectId: scope.project, corr: corr('operation-schedule') }, v.id, v.at)
    },
  })
}

/* ── Ticket 26: console detail read + preflight run. ── */

/**
 * The canonical detail bundle for one operation (phases, steps, linked
 * plan/conversation/branch groups). The key embeds the scope, so a persona or
 * project switch reads a different entry and the superseded read is cancelled
 * before a delayed response can restore old visibility.
 */
export function useOperationDetail(id: string) {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: operationKeys.detail(scope, id),
    queryFn: async (): Promise<OperationDetailRead> => {
      const actor = actorRef(scope.actor, scope.role)
      const res = await services
        .operations(actor, scope.project)
        .detail({ actor, projectId: scope.project, corr: 'operation-detail' }, id)
      if (!res.ok) throw new OperationReadError(res.failure)
      return res.data
    },
    enabled: !!services && !!id,
  })
}

/**
 * Runs preflight through the typed handler: the eight checks are re-derived
 * from canonical state at the handler, so a scope revision that cleared the
 * stored preflight fails the re-run until the ROE is re-approved. The typed
 * result — success or refusal reason — is surfaced to the caller.
 */
export function useRunPreflight() {
  const services = useServices()
  const scope = useQueryScope()
  return useMutation({
    mutationFn: async (v: { id: string }): Promise<ServiceResult<PreflightRunRead>> => {
      const actor = actorRef(scope.actor, scope.role)
      return services.operations(actor, scope.project).preflight({ actor, projectId: scope.project, corr: corr('operation-preflight') }, v.id)
    },
  })
}

/* ── Ticket 27: operation lifecycle control writes. ── */

/**
 * The lifecycle controls (start/pause/resume/stop/complete): each mutation
 * captures the actor/project scope at call time, so a persona/project switch
 * never retargets an in-flight transition, and the typed result — success or
 * the refusal reason the handler re-derived at click time — is surfaced to
 * the caller's onSuccess. The commit publishes one ChangeSet, so the
 * operation views and the agent fleet refetch together.
 */
export function useStartOperation() {
  const services = useServices()
  const scope = useQueryScope()
  return useMutation({
    mutationFn: async (v: { id: string }): Promise<ServiceResult<OperationTransitionRead>> => {
      const actor = actorRef(scope.actor, scope.role)
      return services.operations(actor, scope.project).start({ actor, projectId: scope.project, corr: corr('operation-start') }, v.id)
    },
  })
}

export function usePauseOperation() {
  const services = useServices()
  const scope = useQueryScope()
  return useMutation({
    mutationFn: async (v: { id: string; reason: string }): Promise<ServiceResult<OperationTransitionRead>> => {
      const actor = actorRef(scope.actor, scope.role)
      return services.operations(actor, scope.project).pause({ actor, projectId: scope.project, corr: corr('operation-pause') }, v.id, v.reason)
    },
  })
}

export function useResumeOperation() {
  const services = useServices()
  const scope = useQueryScope()
  return useMutation({
    mutationFn: async (v: { id: string }): Promise<ServiceResult<OperationTransitionRead>> => {
      const actor = actorRef(scope.actor, scope.role)
      return services.operations(actor, scope.project).resume({ actor, projectId: scope.project, corr: corr('operation-resume') }, v.id)
    },
  })
}

export function useStopOperation() {
  const services = useServices()
  const scope = useQueryScope()
  return useMutation({
    mutationFn: async (v: { id: string; reason: string }): Promise<ServiceResult<OperationTransitionRead>> => {
      const actor = actorRef(scope.actor, scope.role)
      return services.operations(actor, scope.project).stop({ actor, projectId: scope.project, corr: corr('operation-stop') }, v.id, v.reason)
    },
  })
}

export function useCompleteOperation() {
  const services = useServices()
  const scope = useQueryScope()
  return useMutation({
    mutationFn: async (v: { id: string }): Promise<ServiceResult<OperationTransitionRead>> => {
      const actor = actorRef(scope.actor, scope.role)
      return services.operations(actor, scope.project).complete({ actor, projectId: scope.project, corr: corr('operation-complete') }, v.id)
    },
  })
}

/* ── Ticket 29: live-workspace review decisions. ── */

/**
 * Records a reviewer's decision on a review-gated step (approve / skip /
 * reject): the handler re-derives the role, read-only-context and run-state
 * gates at click time and refuses unauthorized decisions on its own — the
 * screen's disable reason is a courtesy, never the enforcement. Scope is
 * captured at call time, so a persona/project switch never retargets a
 * decision mid-flight.
 */
export function useReviewStep() {
  const services = useServices()
  const scope = useQueryScope()
  return useMutation({
    mutationFn: async (v: { id: string; stepId: string; decision: StepDecision; note: string }): Promise<ServiceResult<OperationTransitionRead>> => {
      const actor = actorRef(scope.actor, scope.role)
      return services.operations(actor, scope.project).reviewStep({ actor, projectId: scope.project, corr: corr('operation-review') }, v.id, v.stepId, v.decision, v.note)
    },
  })
}

/* ── Mock console adapter for the operation pages: the display clock, the demo runtime, and the legacy-correlated reads and writes the mirrored console always made. The pages reach the mock authority through this hook only. ── */

export interface OperationMockConsole {
  display: DisplayClock
  demo: DemoRuntimeControls
  now(): Instant
  projectOf(opId: string): string | undefined
  checks(op: Operation, at: Instant): { spec: PfCheck[]; engine: Check[] }
  planProject(planId: string): string | undefined
  createOperationFromPlan(projectId: string, planId: string): ServiceResult<PlanBridgeRead>
  pause(projectId: string, opId: string, reason: string): Promise<ServiceResult<OperationTransitionRead>>
  resume(projectId: string, opId: string): Promise<ServiceResult<OperationTransitionRead>>
  stop(projectId: string, opId: string, reason: string): Promise<ServiceResult<OperationTransitionRead>>
  complete(projectId: string, opId: string): Promise<ServiceResult<OperationTransitionRead>>
  preflightChecks(projectId: string, opId: string): Promise<ServiceResult<Check[]>>
  audit(projectId: string, input: AuditInput): void
  addEvidence(projectId: string, input: OperationEvidenceInput): ServiceResult<Evidence>
}

export function useOperationMockConsole(): OperationMockConsole {
  const services = useServices()
  const me = useMe()
  const actor = { id: me.name, role: me.role }
  const ctx = (projectId: string) => ({ actor, projectId, corr: 'legacy' })
  const ops = (projectId: string) => services.operations(actor, projectId)
  return {
    display: services.display,
    demo: services.demo,
    now: () => services.clock.now(),
    projectOf: (opId) => readOperationMeta(services, opId)?.projectId,
    checks: (op, at) => ({ spec: readOperationSpecChecks(services, op, at), engine: readOperationPreflight(services, op, at) }),
    planProject: (planId) => readPlanProject(services.authority, planId),
    createOperationFromPlan: (projectId, planId) => createOperationFromPlanTransaction(services.authority, services.clock, ctx(projectId), planId),
    pause: (projectId, opId, reason) => ops(projectId).pause(ctx(projectId), opId, reason),
    resume: (projectId, opId) => ops(projectId).resume(ctx(projectId), opId),
    stop: (projectId, opId, reason) => ops(projectId).stop(ctx(projectId), opId, reason),
    complete: (projectId, opId) => ops(projectId).complete(ctx(projectId), opId),
    preflightChecks: (projectId, opId) => ops(projectId).preflightChecks(ctx(projectId), opId),
    audit: (projectId, input) => recordAudit(services, ctx(projectId), input),
    addEvidence: (projectId, input) => addOperationEvidence(services, ctx(projectId), input),
  }
}
