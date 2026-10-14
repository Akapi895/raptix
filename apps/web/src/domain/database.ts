/**
 * The one canonical database authority (ticket 04, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Owns the single seed/snapshot for the whole app: the legacy store context
 * and migrated services both commit through {@link DbAuthority.commit}; there
 * is no second seed. Every commit is atomic (clone → apply → replace) and
 * publishes one ChangeSet with the affected entity identities, so Query
 * invalidation and legacy subscriptions observe the same publication.
 */
import { seed, type Db, type SeedVariant } from '../data'
import type { ChangeSet, Clock, EntityKind, EntityRef } from './service'

type Row = { id: string; projectId?: string }

/** Db collections that map 1:1 to an entity kind for ChangeSet publication. */
const COLLECTIONS: readonly (readonly [keyof Db, EntityKind])[] = [
  ['projects', 'project'], ['operations', 'operation'], ['agents', 'agent'], ['assets', 'asset'],
  ['evidence', 'evidence'], ['findings', 'finding'], ['reports', 'report'], ['exportsList', 'report-export'],
  ['playbooks', 'playbook'], ['approvals', 'approval'], ['templates', 'template'], ['integrations', 'integration'],
  ['policies', 'policy'], ['retention', 'retention'], ['audit', 'audit'], ['notices', 'notice'],
  ['plans', 'plan'], ['conversations', 'conversation'], ['toolEvents', 'tool-event'], ['branches', 'branch'],
  ['branchGroups', 'branch-group'], ['aiWorkers', 'ai-worker'], ['c2Nodes', 'c2-node'], ['channels', 'channel'],
  ['sessions', 'session'], ['sessionRequests', 'session-request'], ['groups', 'agent-group'],
]

const json = (v: unknown) => JSON.stringify(v)

/** EntityRefs whose serialized value changed between two snapshots of one collection. */
function changedRefs(kind: EntityKind, before: readonly Row[], after: readonly Row[]): EntityRef[] {
  const a = new Map(before.map((x) => [x.id, json(x)]))
  const b = new Map(after.map((x) => [x.id, json(x)]))
  const projectOf = new Map([...before, ...after].map((x) => [x.id, x.projectId || undefined]))
  const refs: EntityRef[] = []
  const push = (id: string) => {
    // A project entity owns itself; everything else names its owning project when present.
    const projectId = kind === 'project' ? id : projectOf.get(id)
    refs.push(projectId ? { kind, id, projectId } : { kind, id })
  }
  b.forEach((v, id) => { if (a.get(id) !== v) push(id) })
  a.forEach((_, id) => { if (!b.has(id)) push(id) })
  return refs
}

/** The single project scoped by a change set, when all changed entities share one. */
function singleProject(entities: EntityRef[]): string | undefined {
  const ids = new Set(entities.map((r) => r.projectId).filter((x): x is string => !!x))
  return ids.size === 1 ? [...ids][0] : undefined
}

export interface DbAuthority {
  /** Current committed snapshot; replaced atomically on every commit. */
  snapshot(): Db
  /**
   * Atomically applies `mutate` to a clone of the snapshot, replaces it and
   * publishes one ChangeSet with the affected identities. `corr` correlates
   * all commits of one user-visible action.
   */
  commit(corr: string, mutate: (d: Db) => void): ChangeSet
  subscribe(listener: (cs: ChangeSet) => void): () => void
  /**
   * Replaces the dataset with a fresh seed and notifies subscribers. The
   * published ChangeSet carries corr 'reset' — consumers treat it as
   * wholesale invalidation (every cache/UI state derived from the dataset).
   */
  reset(variant?: SeedVariant): ChangeSet
}

export function createDatabaseAuthority(clock: Clock): DbAuthority {
  let db: Db = seed()
  const listeners = new Set<(cs: ChangeSet) => void>()
  const publish = (cs: ChangeSet) => listeners.forEach((fn) => fn(cs))

  const diff = (before: Db, next: Db): EntityRef[] => {
    const entities: EntityRef[] = []
    for (const [key, kind] of COLLECTIONS) {
      if (before[key] === next[key]) continue
      entities.push(...changedRefs(kind, before[key] as readonly Row[], next[key] as readonly Row[]))
    }
    if (json(before.stopState) !== json(next.stopState)) entities.push({ kind: 'stop-state', id: 'workspace' })
    // Ticket 56: organization settings publish one workspace-level identity.
    if (json(before.org) !== json(next.org)) entities.push({ kind: 'org', id: 'workspace' })
    return entities
  }

  return {
    snapshot: () => db,
    commit(corr, mutate) {
      const before = db
      const next = structuredClone(before)
      mutate(next)
      const entities = diff(before, next)
      db = next
      const cs: ChangeSet = { entities, projectId: singleProject(entities), at: clock.now(), corr }
      publish(cs)
      return cs
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    reset(variant) {
      db = seed(variant ?? 'default')
      const cs: ChangeSet = { entities: [], projectId: undefined, at: clock.now(), corr: 'reset' }
      publish(cs)
      return cs
    },
  }
}
