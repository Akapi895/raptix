/**
 * Findings inventory Query binding (ticket 31, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Feature-local key namespace over the shared console key builders. Keys
 * start with the `finding` entity kind and embed the auth scope at position
 * 1, so both bridge invalidation paths reach them: any committed finding
 * change (legacy action or service write) invalidates the `[kind]` prefix —
 * a legacy status change updates these views without a reload — and a
 * persona/project switch cancels the superseded scope's reads before a
 * delayed response can restore old visibility.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { actorRef } from '../../auth/persona'
import { useFeatureServices } from '../../state/feature-services'
import { consoleKeys, useQueryScope, type QueryScope } from '../../state/keys'
import type { RequestContext, ServiceFailure, ServiceResult } from '../../domain/service'
import type { Finding } from '../../domain/entities'
import type {
  EvidenceDetailRead, EvidenceListQuery, EvidenceListRead, EvidenceUploadInput,
  EvidenceDownload, FindingActivityKind, FindingActivityPage, FindingDetailRead, FindingListQuery, FindingListRead, FindingReferenceOptions,
  FindingSaveInput, FindingTransitionTarget, RetestInput,
} from './service'

/** Feature-local key namespaces: ['finding', scope, 'list', query] / ['finding', scope, id]. */
export const findingKeys = {
  list: (scope: QueryScope, query: FindingListQuery) => consoleKeys.view('finding', scope, 'list', query),
  detail: (scope: QueryScope, id: string) => consoleKeys.entity('finding', scope, id),
}

/** Evidence-inspector key namespaces (ticket 33): ['evidence', scope, 'list', query] / ['evidence', scope, id]. */
export const evidenceKeys = {
  list: (scope: QueryScope, query: EvidenceListQuery) => consoleKeys.view('evidence', scope, 'list', query),
  detail: (scope: QueryScope, id: string) => consoleKeys.entity('evidence', scope, id),
}

/** A service failure rethrown as the query error, so screens render the kind and message. */
export class FindingReadError extends Error {
  constructor(readonly failure: ServiceFailure) {
    super(failure.message)
    this.name = 'FindingReadError'
  }
}

/** Query-backed findings inventory for the current auth/project scope. */
export function useFindingList(query: FindingListQuery) {
  const services = useFeatureServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: findingKeys.list(scope, query),
    queryFn: async (): Promise<FindingListRead> => {
      const actor = actorRef(scope.actor, scope.role)
      const res = await services
        .findings(actor, scope.project)
        .list({ actor, projectId: scope.project, corr: 'findings-list' }, query)
      if (!res.ok) throw new FindingReadError(res.failure)
      return res.data
    },
    enabled: !!services,
  })
}

/** Query-backed finding detail (history, metadata and masked linked evidence). */
export function useFindingDetail(id?: string) {
  const services = useFeatureServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: findingKeys.detail(scope, id || ''),
    queryFn: async (): Promise<FindingDetailRead> => {
      const actor = actorRef(scope.actor, scope.role)
      const res = await services
        .findings(actor, scope.project)
        .get({ actor, projectId: scope.project, corr: 'finding-detail' }, id || '')
      if (!res.ok) throw new FindingReadError(res.failure)
      return res.data
    },
    enabled: !!services && !!id,
  })
}

export function useFindingReferenceOptions() {
  const services = useFeatureServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: consoleKeys.view('finding', scope, 'reference-options'),
    queryFn: async (): Promise<FindingReferenceOptions> => {
      const actor = actorRef(scope.actor, scope.role)
      const result = await services.findings(actor, scope.project).referenceOptions({ actor, projectId: scope.project, corr: 'finding-reference-options' })
      if (!result.ok) throw new FindingReadError(result.failure)
      return result.data
    },
    enabled: !!services && !!scope.project && scope.project !== 'all',
  })
}

/** A service failure rethrown as the query error, so screens render the kind and message. */
export class EvidenceReadError extends Error {
  constructor(readonly failure: ServiceFailure) {
    super(failure.message)
    this.name = 'EvidenceReadError'
  }
}

/** Query-backed standalone evidence list (ticket 33) for the current auth/project scope. */
export function useEvidenceList(query: EvidenceListQuery) {
  const services = useFeatureServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: evidenceKeys.list(scope, query),
    queryFn: async (): Promise<EvidenceListRead> => {
      const actor = actorRef(scope.actor, scope.role)
      const res = await services
        .findings(actor, scope.project)
        .listEvidence({ actor, projectId: scope.project, corr: 'evidence-list' }, query)
      if (!res.ok) throw new EvidenceReadError(res.failure)
      return res.data
    },
    enabled: !!services,
  })
}

/**
 * Query-backed standalone evidence detail (ticket 33): masked view, producer
 * links and simulated capture integrity. The key embeds the auth scope and
 * is invalidated by evidence ChangeSets — an evidence attach/upload (ticket
 * 32's handlers) refetches the linked views without a reload.
 */
export function useEvidenceDetail(id?: string) {
  const services = useFeatureServices()
  const scope = useQueryScope()
  return useQuery({
    queryKey: evidenceKeys.detail(scope, id || ''),
    queryFn: async (): Promise<EvidenceDetailRead> => {
      const actor = actorRef(scope.actor, scope.role)
      const res = await services
        .findings(actor, scope.project)
        .getEvidence({ actor, projectId: scope.project, corr: 'evidence-detail' }, id || '')
      if (!res.ok) throw new EvidenceReadError(res.failure)
      return res.data
    },
    enabled: !!services && !!id,
  })
}

/**
 * Write-side binding (ticket 32): typed finding mutations for the current
 * scope. Each call captures actor/project at call time — a persona or
 * project switch never retargets an in-flight write — and every commit
 * publishes one ChangeSet that the bridge turns into refetches for both the
 * Query views and the legacy store (one data authority, observed both ways).
 * Callers resolve the explicit ServiceResult: a refused write never commits,
 * and the message is safe to render.
 */
export function useFindingWrites() {
  const services = useFeatureServices()
  const scope = useQueryScope()
  return useMemo(() => {
    const actor = actorRef(scope.actor, scope.role)
    const ctx = (corr: string): RequestContext => ({ actor, projectId: scope.project, corr })
    const svc = () => services.findings(actor, scope.project)
    return {
      save: (id: string | null, input: FindingSaveInput): Promise<ServiceResult<Finding>> =>
        svc().save(ctx('finding-save'), id, input),
      transition: (id: string, to: FindingTransitionTarget, note?: string, expectedVersion?: number) =>
        svc().transition(ctx('finding-transition'), id, to, note, expectedVersion),
      loadActivity: (id: string, kind: FindingActivityKind, cursor: string, version: number): Promise<ServiceResult<FindingActivityPage>> => svc().loadActivity(ctx('finding-activity'), id, kind, cursor, version),
      setSuggestionDisposition: (id: string, input: { producerRef: string; dismissed: boolean; reason: string; expectedVersion: number }) => svc().setSuggestionDisposition(ctx('suggestion-disposition'), input),
      addComment: (id: string, text: string, expectedVersion: number, requestId: string) => svc().addComment(ctx('finding-comment'), id, text, expectedVersion, requestId),
      importSuggestion: (id: string) => svc().importSuggestion(ctx('finding-import'), id),
      attachEvidence: (findingId: string, evidenceId: string) =>
        svc().attachEvidence(ctx('finding-attach'), findingId, evidenceId),
      classifyCapture: (captureId: string, classification: 'standard' | 'sensitive', expectedVersion: number, reason: string) =>
        svc().classifyCapture(ctx('capture-classification'), captureId, classification, expectedVersion, reason),
      downloadEvidence: (evidenceId: string): Promise<ServiceResult<EvidenceDownload>> =>
        svc().downloadEvidence(ctx('evidence-download'), evidenceId),
      uploadEvidence: (input: EvidenceUploadInput) => svc().uploadEvidence(ctx('finding-upload'), input),
      importWorkspaceEvidence: () => svc().importWorkspaceEvidence(ctx('evidence-import')),
      recordRetest: (id: string, input: RetestInput) => svc().recordRetest(ctx('finding-retest'), id, input),
    }
  }, [services, scope.actor, scope.role, scope.project])
}
