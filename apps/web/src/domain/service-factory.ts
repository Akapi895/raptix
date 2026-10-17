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
import { createIdentityService, type IdentityService } from '../auth/identity'
import { MockClock, Scheduler, formatDemoInstant } from './clock'
import { createDatabaseAuthority, type DbAuthority } from './database'
// Feature appends: every feature service is feature-local (src/features/*);
// the factory only wires each one into a scope with the shared guard. Ticket
// 70: non-critical feature handlers load their module on first call — the
// typed call surface is unchanged (handlers already return promises), while
// the off-page sweep authorities below stay statically wired.
import type { OperationService } from '../features/operations/service'
import type { FindingService } from '../features/findings/service'
import type { ChatService } from '../features/aichat/service'
import { createChatService } from '../features/aichat/service'
import type { AiHistoryService } from '../features/aichat/history'
import type { PlanService } from '../features/plans/service'
import type { PlanBridgeService } from '../features/plans/bridge'
import type { PlanCompareService } from '../features/plans/compare'
import type { AgentService } from '../features/agents/service'
import type { ReportService } from '../features/reports/service'
import type { BranchService } from '../features/branches/service'
import type { LibraryService } from '../features/library/service'
import type { AnalysisService } from '../features/analysis/service'
import type { SettingsService } from '../features/settings/service'
import type { AssetService } from '../features/assets/service'
import type { ScopeService } from '../features/scope/service'
import { unavailableAuditService, type AuditService } from '../features/audit/service'
import type { WorkerService } from '../features/workers/service'
import type { NoticeService } from '../features/notices/service'
import type { ResultsService } from '../features/results/service'
import type { TraceService } from '../features/trace/service'
import type { C2Service } from '../features/c2/service'
// Ticket 46 append: the session-grant deadline lifecycle (15 s sweep + exact
// per-grant deadline callbacks) is feature-local (src/features/c2/grants); the
// factory registers it once so deadlines fire without any C2 screen mounted,
// and the authority's 'reset' publication re-arms it against the fresh dataset.
// It must load eagerly (off-page sweep invariant).
import { createGrantLifecycle } from '../features/c2/grants'
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

/**
 * Per-feature service surface that real-mode adapters implement
 * (ADR-0084). Grows one entry per migrated domain; mock-only plumbing such as
 * `authority`, `clock` and `schedule` is deliberately absent.
 */
export type FeatureServices = Pick<ConsoleServices, 'findings' | 'reports' | 'assets' | 'library' | 'scope' | 'audit'>

export interface ConsoleServices {
  identity: IdentityService
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
  /** Typed conversation-history/provenance reads (ticket 42 — feature-local implementation). */
  aiHistory(actor: ActorRef, projectId: string): AiHistoryService
  /** Typed plan workbench + approval/expiry handlers (ticket 39 — feature-local implementation). */
  plans(actor: ActorRef, projectId: string): PlanService
  /** Typed plan→operation bridge (ticket 40 — feature-local implementation). */
  plansBridge(actor: ActorRef, projectId: string): PlanBridgeService
  /** Typed plan revision-compare reads (ticket 42 — feature-local implementation). */
  plansCompare(actor: ActorRef, projectId: string): PlanCompareService
  /** Typed agent fleet list/detail reads + allocation/group writes (tickets 48–49 — feature-local implementation). */
  agents(actor: ActorRef, projectId: string): AgentService
  /** Typed report catalog reads + draft creation (ticket 34 — feature-local implementation). */
  reports(actor: ActorRef, projectId: string): ReportService
  /** Typed branch group reads + branch action writes (ticket 43 — feature-local implementation). */
  branches(actor: ActorRef, projectId: string): BranchService
  /** Typed tradecraft library reads + revision-review writes (tickets 52–53 — feature-local implementation). */
  library(actor: ActorRef, projectId: string): LibraryService
  /** Typed ATT&CK coverage + detection heatmap read handlers (ticket 54 — feature-local implementation). */
  analysis(actor: ActorRef, projectId: string): AnalysisService
  /** Typed organization settings handlers (ticket 56 — feature-local implementation). */
  settings(actor: ActorRef, projectId: string): SettingsService
  /** Typed asset catalog/detail + scope-classification reads (ticket 50 — feature-local implementation). */
  assets(actor: ActorRef, projectId: string): AssetService
  /** Scope and ROE revisions (plan P09 Scope slice): the mock adapter maps approval records, the real adapter reads the API. */
  scope(actor: ActorRef, projectId: string): ScopeService
  /** Engagement audit read (plan P09 Vault/Audit slice). Real mode only; the mock Activity & Audit tab does not read this port. */
  audit(actor: ActorRef, projectId: string): AuditService
  /** Typed AI worker dependency graph read (ticket 44 — feature-local implementation). */
  workers(actor: ActorRef, projectId: string): WorkerService
  /** Typed notice center handlers (ticket 59 — feature-local implementation). */
  notices(actor: ActorRef, projectId: string): NoticeService
  /** Typed operation results + execution graph read (ticket 30 — feature-local implementation). */
  results(actor: ActorRef, projectId: string): ResultsService
  /** Typed tool-event trace reads with boundary-derived facets (ticket 41 — feature-local implementation). */
  trace(actor: ActorRef, projectId: string): TraceService
  /** Typed C2 overview/session/request/audit/channel reads (ticket 45 — feature-local implementation). */
  c2(actor: ActorRef, projectId: string): C2Service
  /** Cancels in-flight reads for a scope (persona/project switch). */
  cancelScope(actor: ActorRef, projectId: string): void
  /** Demo reset: disposes scheduled callbacks, restores the clock anchor, reseeds the one dataset. */
  reset(variant?: SeedVariant): void
  dispose(): void
}

/**
 * A handler object whose module loads on first method call (ticket 70). The
 * proxy memoizes the loaded instance per binding; every method awaits the
 * load and delegates, which matches the already-async handler signatures.
 */
function lazyService<S extends object>(load: () => Promise<S>): S {
  let instance: Promise<S> | null = null
  const ensure = () => (instance ??= load())
  return new Proxy({} as S, {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined
      return (...args: unknown[]) =>
        ensure().then((svc) => (svc as unknown as Record<string, (...a: unknown[]) => unknown>)[prop](...args))
    },
  })
}

/** The factory's superseded-scope read guard (see createConsoleServices). */
export type ScopeGuard = <T>(produce: () => ServiceResult<T>) => Promise<ServiceResult<T>>

/**
 * Lazy wiring for guard-taking services (ticket 70): the superseded-scope
 * guard is created eagerly at facade-call time so cancelScope supersedes a
 * read even while the service module is still loading; only the module load
 * is deferred.
 */
function lazyGuarded<S extends object>(
  guard: ScopeGuard,
  load: (guard: ScopeGuard) => Promise<S>,
): S {
  return lazyService(() => load(guard))
}

export function createConsoleServices(): ConsoleServices {
  const clock = new MockClock()
  const scheduler = new Scheduler()
  const offAdvance = clock.onAdvance((now) => scheduler.runDue(now))
  const authority = createDatabaseAuthority(clock)
  const identity = createIdentityService(authority)

  /* Superseded-scope guard: every feature wiring passes reads through this,
   * so cancelScope covers all feature reads on a persona/project switch.
   * Each guard captures the scope's cancellation generation at creation; a
   * bump (cancelScope) makes every read of that scope resolve `unavailable`
   * after one microtask — including reads whose guard was created while a
   * lazy-bound service module was still loading (ticket 70). Writes never
   * cancel mid-flight. */
  const scopeGen = new Map<string, number>()
  const scopeKey = (actor: ActorRef, projectId: string): string => `${actor.id} ${actor.role} ${projectId}`

  const scopeGuard = (actor: ActorRef, projectId: string): ScopeGuard => {
    const key = scopeKey(actor, projectId)
    /* Capture the scope's generation at guard creation — the facade call —
     * not at produce time: a lazy-bound service's first read runs its guard
     * only after the module import resolves, and a cancelScope in between
     * must still supersede it (ticket 70 regression guard). */
    const gen = scopeGen.get(key) ?? 0
    return async <T>(produce: () => ServiceResult<T>): Promise<ServiceResult<T>> => {
      await Promise.resolve()
      if ((scopeGen.get(key) ?? 0) !== gen) return { ok: false, failure: { kind: 'unavailable', message: 'Request superseded by a scope change.' } }
      return produce()
    }
  }

  const forScope = (actor: ActorRef, projectId: string): ProjectService => {
    const guard = scopeGuard(actor, projectId)
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

  const forOperations = (actor: ActorRef, projectId: string): OperationService =>
    lazyGuarded(scopeGuard(actor, projectId), (guard) => import('../features/operations/service').then((m) => m.createOperationService(authority, clock, guard)))
  const forFindings = (actor: ActorRef, projectId: string): FindingService =>
    lazyGuarded(scopeGuard(actor, projectId), (guard) => import('../features/findings/service').then((m) => m.createFindingService(authority, clock, guard)))
  const forChat = (actor: ActorRef, projectId: string): ChatService =>
    createChatService(authority, clock, scopeGuard(actor, projectId))
  const forAiHistory = (actor: ActorRef, projectId: string): AiHistoryService =>
    lazyGuarded(scopeGuard(actor, projectId), (guard) => import('../features/aichat/history').then((m) => m.createAiHistoryService(authority, guard)))
  const forPlans = (actor: ActorRef, projectId: string): PlanService =>
    lazyGuarded(scopeGuard(actor, projectId), (guard) => import('../features/plans/service').then((m) => m.createPlanService(authority, clock, guard)))
  const forAgents = (actor: ActorRef, projectId: string): AgentService =>
    lazyGuarded(scopeGuard(actor, projectId), (guard) => import('../features/agents/service').then((m) => m.createAgentService(authority, clock, guard)))
  const forReports = (actor: ActorRef, projectId: string): ReportService =>
    lazyGuarded(scopeGuard(actor, projectId), (guard) => import('../features/reports/service').then((m) => m.createReportService(authority, clock, guard)))
  const forBranches = (actor: ActorRef, projectId: string): BranchService =>
    lazyGuarded(scopeGuard(actor, projectId), (guard) => import('../features/branches/service').then((m) => m.createBranchService(authority, clock, guard)))
  const forLibrary = (actor: ActorRef, projectId: string): LibraryService =>
    lazyGuarded(scopeGuard(actor, projectId), (guard) => import('../features/library/service').then((m) => m.createLibraryService(authority, clock, guard)))
  const forAnalysis = (actor: ActorRef, projectId: string): AnalysisService =>
    lazyGuarded(scopeGuard(actor, projectId), (guard) => import('../features/analysis/service').then((m) => m.createAnalysisService(authority, guard)))
  const forSettings = (actor: ActorRef, projectId: string): SettingsService =>
    lazyGuarded(scopeGuard(actor, projectId), (guard) => import('../features/settings/service').then((m) => m.createSettingsService(authority, clock, guard)))
  const forRoeScope = (actor: ActorRef, projectId: string): ScopeService =>
    lazyGuarded(scopeGuard(actor, projectId), (guard) => import('../features/scope/mock').then((m) => m.createMockScopeService(authority, clock, guard)))
  const forAssets = (actor: ActorRef, projectId: string): AssetService =>
    lazyGuarded(scopeGuard(actor, projectId), (guard) => import('../features/assets/service').then((m) => m.createAssetService(authority, clock, guard)))
  const forWorkers = (actor: ActorRef, projectId: string): WorkerService =>
    lazyGuarded(scopeGuard(actor, projectId), (guard) => import('../features/workers/service').then((m) => m.createWorkerService(authority, guard)))
  const forNotices = (actor: ActorRef, projectId: string): NoticeService =>
    lazyGuarded(scopeGuard(actor, projectId), (guard) => import('../features/notices/service').then((m) => m.createNoticeService(authority, clock, guard)))
  const forResults = (actor: ActorRef, projectId: string): ResultsService =>
    lazyGuarded(scopeGuard(actor, projectId), (guard) => import('../features/results/service').then((m) => m.createResultsService(authority, guard)))
  const forTrace = (actor: ActorRef, projectId: string): TraceService =>
    lazyGuarded(scopeGuard(actor, projectId), (guard) => import('../features/trace/service').then((m) => m.createTraceService(authority, clock, guard)))
  const forC2 = (actor: ActorRef, projectId: string): C2Service =>
    lazyGuarded(scopeGuard(actor, projectId), (guard) => import('../features/c2/service').then((m) => m.createC2Service(authority, guard)))
  const grants = createGrantLifecycle(authority, clock, scheduler)

  const cancelScope = (actor: ActorRef, projectId: string) => {
    const key = scopeKey(actor, projectId)
    scopeGen.set(key, (scopeGen.get(key) ?? 0) + 1)
  }

  return {
    identity,
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
    aiHistory: forAiHistory,
    plans: forPlans,
    // Ticket 40: the bridge is write-only over the shared authority — no
    // scope-guarded reads, so the wiring needs no per-scope state.
    plansBridge: () =>
      lazyService(() => import('../features/plans/bridge').then((m) => m.createPlanBridgeService(authority, clock))),
    // Ticket 42: the compare read shares the plans feature's scope rules.
    plansCompare: (actor, projectId) =>
      lazyGuarded(scopeGuard(actor, projectId), (guard) => import('../features/plans/compare').then((m) => m.createPlanCompareService(authority, guard))),
    agents: forAgents,
    reports: forReports,
    branches: forBranches,
    library: forLibrary,
    analysis: forAnalysis,
    settings: forSettings,
    assets: forAssets,
    scope: forRoeScope,
    audit: () => unavailableAuditService(),
    workers: forWorkers,
    notices: forNotices,
    results: forResults,
    trace: forTrace,
    c2: forC2,
    cancelScope,
    reset(variant) {
      scheduler.clear()
      clock.reset()
      authority.reset(variant)
    },
    dispose() {
      identity.dispose()
      grants.dispose()
      scheduler.clear()
      offAdvance()
      clock.reset()
    },
  }
}
