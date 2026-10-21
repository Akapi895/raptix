/**
 * Library Query binding (corpus reads and proposal workflow). Reads and writes
 * go through the feature port, so the same screens serve the mock store and the
 * real adapter. Keys embed the auth scope so a persona or project switch
 * cancels superseded reads.
 */
import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { actorRef } from '../../demo/persona'
import { useFeatureServices } from '../../state/feature-services'
import { consoleKeys, useQueryScope, type QueryScope } from '../../state/keys'
import type { ServiceFailure } from '../../domain/service'
import type { LibraryCorpusQuery, LibraryCorpusRead, LibraryProposal, LibraryProposalsRead, LibrarySkillDetail, LibraryTechniqueRead, LibraryService } from './service'

export const libraryKeys = {
  corpus: (scope: QueryScope, query: LibraryCorpusQuery) => consoleKeys.view('playbook', scope, 'corpus', query),
  skill: (scope: QueryScope, name: string) => consoleKeys.entity('playbook', scope, `skill:${name}`),
  technique: (scope: QueryScope, id: string) => consoleKeys.entity('playbook', scope, `technique:${id}`),
  proposals: (scope: QueryScope) => consoleKeys.view('library-proposal', scope, 'list'),
  proposal: (scope: QueryScope, id: string) => consoleKeys.entity('library-proposal', scope, id),
}

/** A service failure rethrown as the query error so screens render the kind and message. */
export class LibraryReadError extends Error {
  constructor(readonly failure: ServiceFailure) {
    super(failure.message)
    this.name = 'LibraryReadError'
  }
}

function useLibraryPort(): { port: () => LibraryService; scope: QueryScope } {
  const services = useFeatureServices()
  const scope = useQueryScope()
  const port = useMemo(() => () => services.library(actorRef(scope.actor, scope.role), scope.project), [services, scope.actor, scope.role, scope.project])
  return { port, scope }
}

/** The canonical corpus (organization-wide reference data). */
export function useLibraryCorpus(query: LibraryCorpusQuery) {
  const { port, scope } = useLibraryPort()
  return useQuery({
    queryKey: libraryKeys.corpus(scope, query),
    queryFn: async (): Promise<LibraryCorpusRead> => {
      const ctx = { actor: actorRef(scope.actor, scope.role), projectId: scope.project, corr: 'library-corpus' }
      const res = await port().corpus(ctx, query)
      if (!res.ok) throw new LibraryReadError(res.failure)
      return res.data
    },
  })
}

/** One canonical skill with its body and fingerprint. */
export function useSkillDetail(name?: string) {
  const { port, scope } = useLibraryPort()
  return useQuery({
    queryKey: libraryKeys.skill(scope, name ?? ''),
    queryFn: async (): Promise<LibrarySkillDetail> => {
      const ctx = { actor: actorRef(scope.actor, scope.role), projectId: scope.project, corr: 'library-skill' }
      const res = await port().skill(ctx, name ?? '')
      if (!res.ok) throw new LibraryReadError(res.failure)
      return res.data
    },
    enabled: !!name,
  })
}

export function useTechniqueDetail(id?: string) {
  const { port, scope } = useLibraryPort()
  return useQuery({
    queryKey: libraryKeys.technique(scope, id ?? ''),
    queryFn: async (): Promise<LibraryTechniqueRead> => {
      const ctx = { actor: actorRef(scope.actor, scope.role), projectId: scope.project, corr: 'library-technique' }
      const res = await port().technique(ctx, id ?? '')
      if (!res.ok) throw new LibraryReadError(res.failure)
      return res.data
    },
    enabled: !!id,
  })
}

/** Proposals for the active engagement. */
export function useLibraryProposals() {
  const { port, scope } = useLibraryPort()
  return useQuery({
    queryKey: libraryKeys.proposals(scope),
    queryFn: async (): Promise<LibraryProposalsRead> => {
      const ctx = { actor: actorRef(scope.actor, scope.role), projectId: scope.project, corr: 'library-proposals' }
      const res = await port().proposals(ctx)
      if (!res.ok) throw new LibraryReadError(res.failure)
      return res.data
    },
  })
}

export function useLibraryProposal(id?: string) {
  const { port, scope } = useLibraryPort()
  return useQuery({
    queryKey: libraryKeys.proposal(scope, id ?? ''),
    queryFn: async (): Promise<LibraryProposal> => {
      const ctx = { actor: actorRef(scope.actor, scope.role), projectId: scope.project, corr: 'library-proposal' }
      const res = await port().proposal(ctx, id ?? '')
      if (!res.ok) throw new LibraryReadError(res.failure)
      return res.data
    },
    enabled: !!id,
  })
}

/**
 * Proposal writes. Each write is an explicit call; the caller passes the version it
 * read, and a success refreshes the proposal views.
 */
export function useLibraryWrites() {
  const { port, scope } = useLibraryPort()
  const client = useQueryClient()
  const ctx = (corr: string) => ({ actor: actorRef(scope.actor, scope.role), projectId: scope.project, corr })
  const refresh = () => { void client.invalidateQueries({ queryKey: consoleKeys.view('library-proposal', scope, 'list') }); void client.invalidateQueries({ queryKey: ['library-proposal', scope.project] }) }
  return useMemo(() => ({
    submit: async (input: { skillName: string; proposedBody: string; rationale?: string }) => { const res = await port().submit(ctx('library-submit'), input); if (res.ok) refresh(); return res },
    amend: async (id: string, input: { proposedBody: string; expectedVersion: number; rationale?: string }) => { const res = await port().amend(ctx('library-amend'), id, input); if (res.ok) refresh(); return res },
    propose: async (id: string) => { const res = await port().propose(ctx('library-propose'), id); if (res.ok) refresh(); return res },
    decide: async (id: string, input: { decision: 'approved' | 'rejected'; expectedVersion: number; comment?: string }) => { const res = await port().decide(ctx('library-decide'), id, input); if (res.ok) refresh(); return res },
    exportProposal: (id: string) => port().exportProposal(ctx('library-export'), id),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the port and scope drive the closures
  }), [port, scope.actor, scope.role, scope.project])
}
