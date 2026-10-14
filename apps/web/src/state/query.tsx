/**
 * Console Query provider and change bridge (ticket 05, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * ConsoleProviders wraps the app in a QueryClientProvider and wires two
 * bridges to the one data authority:
 * - ChangeSetBridge: every committed ChangeSet (legacy or service write)
 *   invalidates the Query entries for the affected entity kinds and, when
 *   the change is project-scoped, every view of that project or the
 *   aggregate. corr 'reset' (demo reset) clears the cache wholesale.
 * - ScopeCancelBridge: a persona/project switch cancels the superseded
 *   scope's in-flight reads — both Query fetches and the service factory's
 *   registered reads — so a delayed old response can never restore
 *   cross-project visibility.
 *
 * Both bridges unsubscribe on unmount, so repeated provider mounts rewire
 * exactly once. Render inside ServicesProvider (the bridges need services).
 */
import { useEffect, useMemo, type ReactNode } from 'react'
import { notifyManager, QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { useServicesOrNull } from './services'
import { readActor } from '../auth/identity'
import type { ConsoleServices } from '../domain/service-factory'
import type { ActorRef, ChangeSet, EntityKind } from '../domain/service'
import { createConsoleQueryClient, scopeOf } from './keys'
import { useAuthStore, useProjectStore } from './stores'

// Observer delivery must not require another demo-clock tick after a commit.
notifyManager.setScheduler(queueMicrotask)

function ChangeSetBridge({ client, services }: { client: QueryClient; services: ConsoleServices }) {
  useEffect(
    () =>
      services.subscribe((cs: ChangeSet) => {
        if (cs.corr === 'reset') {
          client.cancelQueries()
          client.removeQueries({ type: 'inactive' })
          client.invalidateQueries()
          return
        }
        const kinds = new Set(cs.entities.map((e) => e.kind))
        for (const kind of kinds) {
          client.invalidateQueries({ queryKey: [kind] })
        }
        const pid = cs.projectId
        if (pid) {
          // Views keyed by project ('all' aggregate included) that no entity-kind
          // invalidation already covers; excluded kinds are handled above.
          client.invalidateQueries({
            predicate: (q) => {
              const scope = scopeOf(q)
              return !!scope && !kinds.has(q.queryKey[0] as EntityKind) && (scope.project === pid || scope.project === 'all' || scope.project === '')
            },
          })
        }
      }),
    [client, services],
  )
  return null
}

/** Cancels Query fetches and factory reads captured under a superseded scope. */
function supersedeScope(client: QueryClient, services: ConsoleServices, actor: ActorRef, project: string): void {
  client.cancelQueries({
    predicate: (q) => {
      const scope = scopeOf(q)
      return !!scope && scope.actor === actor.id && scope.role === actor.role && scope.project === project
    },
  })
  services.cancelScope(actor, project)
}

function ScopeCancelBridge({ client, services }: { client: QueryClient; services: ConsoleServices }) {
  useEffect(() => {
    let actor = readActor(services, useAuthStore.getState().meName)
    let project = useProjectStore.getState().pid
    const offActor = useAuthStore.subscribe((s) => {
      if (s.meName === actor.id) return
      const prevActor = actor
      actor = readActor(services, s.meName)
      supersedeScope(client, services, prevActor, project)
    })
    const offProject = useProjectStore.subscribe((s) => {
      if (s.pid === project) return
      const prevProject = project
      project = s.pid
      supersedeScope(client, services, actor, prevProject)
    })
    const offRole = services.authority.subscribe(() => {
      const next = readActor(services, actor.id)
      if (next.role === actor.role) return
      const previous = actor
      actor = next
      supersedeScope(client, services, previous, project)
    })
    return () => {
      offActor()
      offProject()
      offRole()
    }
  }, [client, services])
  return null
}

/** Query provider + authority bridges; bridges no-op in real mode (no mock authority). */
export function ConsoleProviders({ children }: { children: ReactNode }) {
  const services = useServicesOrNull()
  const client = useMemo(() => createConsoleQueryClient(), [])
  useEffect(() => () => client.clear(), [client])
  if (!services) return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return (
    <QueryClientProvider client={client}>
      <ChangeSetBridge client={client} services={services} />
      <ScopeCancelBridge client={client} services={services} />
      {children}
    </QueryClientProvider>
  )
}
