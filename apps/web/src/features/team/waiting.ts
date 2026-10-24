/**
* Workflow decisions one project waits on that the global task inbox does not list yet: a pending closure request and
 * library proposals in review. Both are read per project through their existing endpoints, so this reads no new contract.
 * They are shown on the project's team tab and are not added to the Overview count until the server aggregate covers them.
 */
import { useQuery } from '@tanstack/react-query'
import { fetchClosure, type ClosureSurfaceView } from '../closure'
import { fetchLibraryProposals, type LibraryProposalView } from '../capabilities'
import { useProjectCacheActor } from '../projects'

export interface ProjectWaitingItem {
  kind: 'closure' | 'library'
  refId: string
  title: string
}

/** The pending items of one project. A closure request counts only while it is requested; a proposal only while proposed. */
export function projectWaitingItems(closure: ClosureSurfaceView | undefined, proposals: readonly LibraryProposalView[] | undefined): ProjectWaitingItem[] {
  const items: ProjectWaitingItem[] = []
  if (closure?.closure?.status === 'requested') {
    items.push({ kind: 'closure', refId: closure.closure.id, title: 'Engagement closure awaiting decision' })
  }
  for (const proposal of proposals ?? []) {
    if (proposal.status === 'proposed') {
      items.push({ kind: 'library', refId: proposal.id, title: `Library proposal for ${proposal.skillName} awaiting review` })
    }
  }
  return items
}

/** The two reads behind the items, each with its own state so one unreadable source does not hide the other. */
export function useProjectWaiting(engagementId: string, enabled: boolean) {
  const actor = useProjectCacheActor()
  const closure = useQuery({ queryKey: ['real', 'decisions', 'waiting', 'closure', actor, engagementId], queryFn: () => fetchClosure(engagementId), enabled: enabled && engagementId !== '' })
  const library = useQuery({ queryKey: ['real', 'decisions', 'waiting', 'library', actor, engagementId], queryFn: () => fetchLibraryProposals(engagementId), enabled: enabled && engagementId !== '' })
  return {
    closure,
    library,
    items: projectWaitingItems(closure.data, library.data?.proposals),
  }
}
