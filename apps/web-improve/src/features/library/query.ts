/**
 * Tradecraft library Query binding (ticket 52, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Feature-local key namespace over the shared console key builders. Keys
 * start with the `playbook`/`technique` entity kinds and embed the auth
 * scope at position 1, so both bridge invalidation paths reach them: any
 * committed tradecraft change (legacy review action or a later service
 * write — status, revision decision) invalidates the `[kind]` prefix — a
 * legacy playbook-state change updates these views without a reload — and a
 * persona/project switch cancels the superseded scope's reads before a
 * delayed response can restore old visibility.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { actorRef } from '../../auth/persona'
import { useServices } from '../../state/services'
import { consoleKeys, useQueryScope, type QueryScope } from '../../state/keys'
import type { RequestContext, ServiceFailure, ServiceResult } from '../../domain/service'
import type { Playbook } from '../../domain/entities'
import type {
  PlaybookDetailRead, PlaybookListQuery, PlaybookListRead, RevisionDecision, RevisionDecisionRead,
  RevisionInput, ReviewQueueRead, TechniqueDetailRead,
} from './service'

/** Feature-local key namespaces: ['playbook', scope, 'list', query] / ['playbook', scope, id] / ['technique', scope, id].
 *  The review queue shares the `playbook` kind prefix, so any committed tradecraft
 *  change (legacy action or typed review write) refetches it from one publication. */
export const libraryKeys = {
  list: (scope: QueryScope, query: PlaybookListQuery) => consoleKeys.view('playbook', scope, 'list', query),
  playbook: (scope: QueryScope, id: string) => consoleKeys.entity('playbook', scope, id),
  technique: (scope: QueryScope, id: string) => consoleKeys.entity('technique', scope, id),
  reviewQueue: (scope: QueryScope) => consoleKeys.view('playbook', scope, 'review-queue'),
}

/** A service failure rethrown as the query error, so screens render the kind and message. */
export class LibraryReadError extends Error {
  constructor(readonly failure: ServiceFailure) {
    super(failure.message)
    this.name = 'LibraryReadError'
  }
}

/** Query-backed playbook library for the current auth/project scope. */
export function usePlaybookList(query: PlaybookListQuery) {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: libraryKeys.list(scope, query),
    queryFn: async (): Promise<PlaybookListRead> => {
      const actor = actorRef(scope.actor, scope.role)
      const res = await services
        .library(actor, scope.project)
        .list({ actor, projectId: scope.project, corr: 'playbooks-list' }, query)
      if (!res.ok) throw new LibraryReadError(res.failure)
      return res.data
    },
    enabled: !!services,
  })
}

/** Query-backed playbook detail (active version, pending revision, scoped usage). */
export function usePlaybookDetail(id?: string) {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: libraryKeys.playbook(scope, id || ''),
    queryFn: async (): Promise<PlaybookDetailRead> => {
      const actor = actorRef(scope.actor, scope.role)
      const res = await services
        .library(actor, scope.project)
        .getPlaybook({ actor, projectId: scope.project, corr: 'playbook-detail' }, id || '')
      if (!res.ok) throw new LibraryReadError(res.failure)
      return res.data
    },
    enabled: !!services && !!id,
  })
}

/** Query-backed technique detail (catalog entry + scoped projections). */
export function useTechniqueDetail(id?: string) {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: libraryKeys.technique(scope, id || ''),
    queryFn: async (): Promise<TechniqueDetailRead> => {
      const actor = actorRef(scope.actor, scope.role)
      const res = await services
        .library(actor, scope.project)
        .getTechnique({ actor, projectId: scope.project, corr: 'technique-detail' }, id || '')
      if (!res.ok) throw new LibraryReadError(res.failure)
      return res.data
    },
    enabled: !!services && !!id,
  })
}

/* ───────────── Revision review (ticket 53) ───────────── */

/** Query-backed review queue: every visible playbook with a pending revision or an initial version awaiting a decision. */
export function usePlaybookReviewQueue() {
  const services = useServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: libraryKeys.reviewQueue(scope),
    queryFn: async (): Promise<ReviewQueueRead> => {
      const actor = actorRef(scope.actor, scope.role)
      const res = await services
        .library(actor, scope.project)
        .reviewQueue({ actor, projectId: scope.project, corr: 'playbook-review-queue' })
      if (!res.ok) throw new LibraryReadError(res.failure)
      return res.data
    },
    enabled: !!services,
  })
}

/**
 * Write-side binding for the revision lifecycle (ticket 53): propose a
 * revision, submit a draft for review, and decide (approve/return) with the
 * mandatory reason. Each call captures actor/project at call time — a
 * persona or project switch never retargets an in-flight write — and every
 * commit publishes one ChangeSet the bridge turns into refetches for the
 * library views and the legacy store. Callers resolve the explicit
 * ServiceResult: a refused write commits nothing and the message is safe to
 * render.
 */
export function usePlaybookReview() {
  const services = useServices()
  const scope = useQueryScope()
  return useMemo(() => {
    const actor = actorRef(scope.actor, scope.role)
    const ctx = (corr: string): RequestContext => ({ actor, projectId: scope.project, corr })
    const svc = () => services.library(actor, scope.project)
    return {
      proposeRevision: (id: string, input: RevisionInput): Promise<ServiceResult<Playbook>> =>
        svc().proposeRevision(ctx('playbook-revision-propose'), id, input),
      submitForReview: (id: string): Promise<ServiceResult<Playbook>> =>
        svc().submitForReview(ctx('playbook-review-submit'), id),
      decideRevision: (id: string, decision: RevisionDecision, reason: string): Promise<ServiceResult<RevisionDecisionRead>> =>
        svc().decideRevision(ctx('playbook-revision-decide'), id, decision, reason),
    }
  }, [services, scope.actor, scope.role, scope.project])
}
