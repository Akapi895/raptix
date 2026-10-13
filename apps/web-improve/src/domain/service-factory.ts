/**
 * Service factory — the composition root for console services (ticket 04,
 * ADR-0067 — docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Creates the one database authority, the mock clock and the scheduler, and
 * hands handlers their context: actor, project and clock are explicit per
 * scope, so a persona/project switch never retargets an in-flight request.
 * Reads observe cancellation when their scope is superseded; mutations are
 * atomic commits through the shared bridge and publish a ChangeSet both the
 * legacy store and migrated consumers observe.
 *
 * The {@link ProjectService} below is the representative typed read/write
 * adapter later feature tickets copy: scope-checked reads, one atomic typed
 * write, ChangeSet publication with the factory clock instant.
 */
import type { Project, SeedVariant } from '../data'
import { projectAccessible } from '../auth/policy'
import { MockClock, Scheduler, formatDemoInstant } from './clock'
import { createDatabaseAuthority, type DbAuthority } from './database'
// Ticket 24 append: operations inventory list/read handlers are feature-local
// (src/features/operations/service.ts); the factory only wires them into a scope.
import { createOperationService, type OperationService } from '../features/operations/service'
// Ticket 31 append: findings inventory list/detail read handlers are feature-local
// (src/features/findings/service.ts); the factory only wires them into a scope.
import { createFindingService, type FindingService } from '../features/findings/service'
// Ticket 48 append: agent fleet list/detail read handlers are feature-local
// (src/features/agents/service.ts); the factory only wires them into a scope.
import { createAgentService, type AgentService } from '../features/agents/service'
import type {
  ActorRef, ChangeSet, EntityReader, Instant, ListResult, PageRequest,
  ReadResult, RequestContext, ServiceResult,
} from './service'

/** Fields the representative project write may change (ticket 04 exemplar). */
export interface ProjectPatch {
  pinned?: boolean
  desc?: string
}

export interface ProjectService extends EntityReader<Project> {
  /** Representative typed write: authorization + atomic commit + ChangeSet. */
  update(ctx: RequestContext, id: string, patch: ProjectPatch): Promise<ServiceResult<Project>>
}

/** Scope check: the shared permissions interface is the one membership rule (ticket 06). */
function canAccess(db: ReturnType<DbAuthority['snapshot']>, actor: ActorRef, projectId: string): boolean {
  return projectAccessible(db.projects.find((x) => x.id === projectId), actor)
}

function readProject(db: ReturnType<DbAuthority['snapshot']>, ctx: RequestContext, id: string): ReadResult<Project> {
  const p = db.projects.find((x) => x.id === id)
  // Out of scope reads are not-found, never a leaked existence signal.
  if (!p || !canAccess(db, ctx.actor, id)) {
    return { ok: false, failure: { kind: 'not-found', message: `Project ${id} does not exist or is out of scope.`, entity: { kind: 'project', id } } }
  }
  return { ok: true, data: p }
}

function listProjects(db: ReturnType<DbAuthority['snapshot']>, ctx: RequestContext, page?: PageRequest): ListResult<Project> {
  const accessible = db.projects.filter((p) => canAccess(db, ctx.actor, p.id))
  const items = ctx.projectId ? accessible.filter((p) => p.id === ctx.projectId) : accessible
  const req = page ?? { page: 1, pageSize: Math.max(1, items.length) }
  const start = (req.page - 1) * req.pageSize
  return { ok: true, data: { items: items.slice(start, start + req.pageSize), page: req.page, pageSize: req.pageSize, total: items.length } }
}

export interface ConsoleServices {
  authority: DbAuthority
  clock: MockClock
  /** Schedules a callback at an absolute clock instant; disposed on reset. */
  schedule(at: Instant, fn: () => void): () => void
  /** Recurring sweep every `intervalMs` of clock time; returns cancel. */
  sweep(intervalMs: number, fn: () => void): () => void
  /** Bridge subscription: every commit — legacy or service — publishes here. */
  subscribe(onChange: (cs: ChangeSet) => void): () => void
  /** Typed handlers with actor/project/clock injected for one scope. */
  forScope(actor: ActorRef, projectId: string): ProjectService
  /** Typed operations list/read handlers (ticket 24 — feature-local implementation). */
  operations(actor: ActorRef, projectId: string): OperationService
  /** Typed findings inventory list/detail read handlers (ticket 31 — feature-local implementation). */
  findings(actor: ActorRef, projectId: string): FindingService
  /** Typed agent fleet list/detail read handlers (ticket 48 — feature-local implementation). */
  agents(actor: ActorRef, projectId: string): AgentService
  /** Cancels in-flight reads for a scope (persona/project switch). */
  cancelScope(actor: ActorRef, projectId: string): void
  /** Demo reset: disposes scheduled callbacks, restores the clock anchor, reseeds the one dataset. */
  reset(variant?: SeedVariant): void
  dispose(): void
}

export function createConsoleServices(): ConsoleServices {
  const clock = new MockClock()
  const scheduler = new Scheduler()
  const offAdvance = clock.onAdvance((now) => scheduler.runDue(now))
  const authority = createDatabaseAuthority(clock)

  /* In-flight read registry per scope: cancellation resolves the promise as
   * `unavailable` instead of restoring stale visibility. Mutations are never
   * cancelled mid-flight — they capture ctx at call time and commit once. */
  const inFlight = new Map<string, Set<() => void>>()
  const scopeKey = (actor: ActorRef, projectId: string) => `${actor.id} ${projectId}`

  const forScope = (actor: ActorRef, projectId: string): ProjectService => {
    const key = scopeKey(actor, projectId)
    const guard = async <T>(produce: () => ServiceResult<T>): Promise<ServiceResult<T>> => {
      let superseded = false
      const cancel = () => { superseded = true }
      let set = inFlight.get(key)
      if (!set) { set = new Set(); inFlight.set(key, set) }
      set.add(cancel)
      await Promise.resolve()
      set.delete(cancel)
      if (superseded) return { ok: false, failure: { kind: 'unavailable', message: 'Request superseded by a scope change.' } }
      return produce()
    }
    return {
      get: (ctx, id) => guard(() => readProject(authority.snapshot(), ctx, id)),
      list: (ctx, page) => guard(() => listProjects(authority.snapshot(), ctx, page)),
      update: (ctx, id, patch) => {
        const db = authority.snapshot()
        const p = db.projects.find((x) => x.id === id)
        if (!p || !canAccess(db, ctx.actor, id)) {
          return Promise.resolve({ ok: false, failure: { kind: 'not-found', message: `Project ${id} does not exist or is out of scope.`, entity: { kind: 'project', id } } })
        }
        if (ctx.actor.role !== 'admin' && ctx.actor.role !== 'manager') {
          return Promise.resolve({ ok: false, failure: { kind: 'forbidden', message: 'Only managers and admins can change a project.', entity: { kind: 'project', id, projectId: id } } })
        }
        authority.commit(ctx.corr, (d) => {
          const target = d.projects.find((x) => x.id === id)!
          if (patch.pinned !== undefined) target.pinned = patch.pinned
          if (patch.desc !== undefined) target.desc = patch.desc
          target.updated = formatDemoInstant(clock.now())
        })
        return Promise.resolve({ ok: true, data: authority.snapshot().projects.find((x) => x.id === id)! })
      },
    }
  }

  /* ── Ticket 24 append: operations inventory list/read. Same superseded-scope
     guard as forScope, so the ScopeCancelBridge's cancelScope covers in-flight
     operation reads on a persona/project switch. ── */
  const forOperations = (actor: ActorRef, projectId: string): OperationService => {
    const key = scopeKey(actor, projectId)
    const guard = async <T>(produce: () => ServiceResult<T>): Promise<ServiceResult<T>> => {
      let superseded = false
      const cancel = () => { superseded = true }
      let set = inFlight.get(key)
      if (!set) { set = new Set(); inFlight.set(key, set) }
      set.add(cancel)
      await Promise.resolve()
      set.delete(cancel)
      if (superseded) return { ok: false, failure: { kind: 'unavailable', message: 'Request superseded by a scope change.' } }
      return produce()
    }
    return createOperationService(authority, guard)
  }

  /* ── Ticket 31 append: findings inventory list/detail reads. Same
     superseded-scope guard as forScope, so the ScopeCancelBridge's
     cancelScope covers in-flight finding reads on a persona/project switch. ── */
  const forFindings = (actor: ActorRef, projectId: string): FindingService => {
    const key = scopeKey(actor, projectId)
    const guard = async <T>(produce: () => ServiceResult<T>): Promise<ServiceResult<T>> => {
      let superseded = false
      const cancel = () => { superseded = true }
      let set = inFlight.get(key)
      if (!set) { set = new Set(); inFlight.set(key, set) }
      set.add(cancel)
      await Promise.resolve()
      set.delete(cancel)
      if (superseded) return { ok: false, failure: { kind: 'unavailable', message: 'Request superseded by a scope change.' } }
      return produce()
    }
    return createFindingService(authority, guard)
  }

  /* ── Ticket 48 append: agent fleet list/detail reads. Same superseded-scope
     guard as forScope, so the ScopeCancelBridge's cancelScope covers in-flight
     agent reads on a persona/project switch. ── */
  const forAgents = (actor: ActorRef, projectId: string): AgentService => {
    const key = scopeKey(actor, projectId)
    const guard = async <T>(produce: () => ServiceResult<T>): Promise<ServiceResult<T>> => {
      let superseded = false
      const cancel = () => { superseded = true }
      let set = inFlight.get(key)
      if (!set) { set = new Set(); inFlight.set(key, set) }
      set.add(cancel)
      await Promise.resolve()
      set.delete(cancel)
      if (superseded) return { ok: false, failure: { kind: 'unavailable', message: 'Request superseded by a scope change.' } }
      return produce()
    }
    return createAgentService(authority, guard)
  }

  const cancelScope = (actor: ActorRef, projectId: string) => {
    const set = inFlight.get(scopeKey(actor, projectId))
    set?.forEach((cancel) => cancel())
    inFlight.delete(scopeKey(actor, projectId))
  }

  return {
    authority,
    clock,
    schedule: (at, fn) => scheduler.schedule(at, fn),
    sweep(intervalMs, fn) {
      let cancelled = false
      // Reschedule from the tick's scheduled slot (not the fire moment) so one
      // long clock advance still covers every elapsed interval.
      const tick = (slot: Instant) => {
        if (cancelled) return
        fn()
        const next = slot + intervalMs
        scheduler.schedule(next, () => tick(next))
      }
      const first = clock.now() + intervalMs
      scheduler.schedule(first, () => tick(first))
      return () => { cancelled = true }
    },
    subscribe: (onChange) => authority.subscribe(onChange),
    forScope,
    operations: forOperations,
    findings: forFindings,
    agents: forAgents,
    cancelScope,
    reset(variant) {
      scheduler.clear()
      clock.reset()
      authority.reset(variant)
    },
    dispose() {
      scheduler.clear()
      offAdvance()
      clock.reset()
    },
  }
}
