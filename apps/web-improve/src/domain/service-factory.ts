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
// Ticket 38 append: AI chat + plan proposal handlers are feature-local
// (src/features/aichat/service.ts); the factory only wires them into a scope.
import { createChatService, type ChatService } from '../features/aichat/service'
// Ticket 48 append: agent fleet list/detail read handlers are feature-local
// (src/features/agents/service.ts); the factory only wires them into a scope.
import { createAgentService, type AgentService } from '../features/agents/service'
// Ticket 34 append: report catalog reads + validated draft creation are
// feature-local (src/features/reports/service.ts); the factory wires the scope.
import { createReportService, type ReportService } from '../features/reports/service'
// Ticket 43 append: branch group reads + branch action writes are feature-local
// (src/features/branches/service.ts); the factory only wires them into a scope.
import { createBranchService, type BranchService } from '../features/branches/service'
// Ticket 52 append: tradecraft library reads (playbooks + techniques) are
// feature-local (src/features/library/service.ts); the factory only wires
// them into a scope.
import { createLibraryService, type LibraryService } from '../features/library/service'
// Ticket 54 append: ATT&CK coverage + detection heatmap read handlers are
// feature-local (src/features/analysis/service.ts); the factory only wires
// them into a scope.
import { createAnalysisService, type AnalysisService } from '../features/analysis/service'
// Ticket 56 append: organization settings handlers (profile, members,
// invitations) are feature-local (src/features/settings/service.ts); the
// factory only wires them into a scope.
import { createSettingsService, type SettingsService } from '../features/settings/service'
// Ticket 59 append: notice center handlers (scoped list, read/unread,
// dismiss) are feature-local (src/features/notices/service.ts); the factory
// only wires them into a scope.
import { createNoticeService, type NoticeService } from '../features/notices/service'
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
  /** Typed AI chat + plan proposal handlers (ticket 38 — feature-local implementation). */
  chat(actor: ActorRef, projectId: string): ChatService
  /** Typed agent fleet list/detail read handlers (ticket 48 — feature-local implementation). */
  agents(actor: ActorRef, projectId: string): AgentService
  /** Typed report catalog reads + draft creation (ticket 34 — feature-local implementation). */
  reports(actor: ActorRef, projectId: string): ReportService
  /** Typed branch group reads + branch action writes (ticket 43 — feature-local implementation). */
  branches(actor: ActorRef, projectId: string): BranchService
  /** Typed tradecraft library read handlers (ticket 52 — feature-local implementation). */
  library(actor: ActorRef, projectId: string): LibraryService
  /** Typed ATT&CK coverage + detection heatmap read handlers (ticket 54 — feature-local implementation). */
  analysis(actor: ActorRef, projectId: string): AnalysisService
  /** Typed organization settings handlers (ticket 56 — feature-local implementation). */
  settings(actor: ActorRef, projectId: string): SettingsService
  /** Typed notice center handlers (ticket 59 — feature-local implementation). */
  notices(actor: ActorRef, projectId: string): NoticeService
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
     operation reads on a persona/project switch. Ticket 25 appends the
     creation/scheduling writes; the clock stamps commits and validates
     schedule instants. ── */
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
    return createOperationService(authority, clock, guard)
  }

  /* ── Ticket 31/32 append: findings inventory reads + write handlers
     (forms, lifecycle transitions, AI draft import, evidence attachment,
     retests). Same superseded-scope guard as forScope for reads; mutations
     capture their context at call time and commit once, publishing the
     ChangeSet both bridges observe. ── */
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
    return createFindingService(authority, clock, guard)
  }

  /* ── Ticket 38 append: AI chat + plan proposals. Reads share the
     superseded-scope guard so cancelScope covers in-flight conversation
     reads on a persona/project switch; writes commit synchronously through
     the authority with the context captured at call time. ── */
  const forChat = (actor: ActorRef, projectId: string): ChatService => {
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
    return createChatService(authority, clock, guard)
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

  /* ── Ticket 54 append: ATT&CK coverage + detection heatmap read. Same
     superseded-scope guard as forScope, so the ScopeCancelBridge's
     cancelScope covers in-flight coverage reads on a persona/project switch. ── */
  const forAnalysis = (actor: ActorRef, projectId: string): AnalysisService => {
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
    return createAnalysisService(authority, guard)
  }

  /* ── Ticket 52 append: tradecraft library reads (playbook list/detail,
     technique detail). Same superseded-scope guard as forScope, so the
     ScopeCancelBridge's cancelScope covers in-flight library reads on a
     persona/project switch. Reads only — tradecraft mutations stay with the
     legacy actions until ticket 53 migrates review. ── */
  const forLibrary = (actor: ActorRef, projectId: string): LibraryService => {
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
    return createLibraryService(authority, guard)
  }

  /* ── Ticket 34 append: report catalog reads (list/templates/delivery
     history/draft options) + the validated draft creation. Same
     superseded-scope guard as forScope, so cancelScope covers in-flight
     report reads on a persona/project switch; the create captures its
     context at call time and commits once through the authority. ── */
  const forReports = (actor: ActorRef, projectId: string): ReportService => {
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
    return createReportService(authority, clock, guard)
  }

  /* ── Ticket 43 append: branch groups + branch actions. Reads share the
     superseded-scope guard so cancelScope covers in-flight branch reads on a
     persona/project switch; retry/reassign/cancel capture their context at
     call time and bind to the addressed branch's own project. ── */
  const forBranches = (actor: ActorRef, projectId: string): BranchService => {
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
    return createBranchService(authority, clock, guard)
  }

  /* ── Ticket 56 append: organization settings (profile read/update,
     member role/status writes, invitations). Reads share the superseded-scope
     guard so cancelScope covers in-flight settings reads on a persona/project
     switch; writes capture their context at call time and commit once. ── */
  const forSettings = (actor: ActorRef, projectId: string): SettingsService => {
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
    return createSettingsService(authority, clock, guard)
  }

  /* ── Ticket 59 append: notification center (persona-scoped list,
     read/unread, mark-all, dismiss). Reads share the superseded-scope guard
     so cancelScope covers in-flight notice reads on a persona/project switch
     and a late response cannot restore previous-scope visibility; writes
     capture their context at call time and commit once. ── */
  const forNotices = (actor: ActorRef, projectId: string): NoticeService => {
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
    return createNoticeService(authority, clock, guard)
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
    chat: forChat,
    agents: forAgents,
    reports: forReports,
    branches: forBranches,
    library: forLibrary,
    analysis: forAnalysis,
    settings: forSettings,
    notices: forNotices,
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
