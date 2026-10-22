import type { Project } from '../domain/entities';
import { projectAccessible } from '../domain/policy';
import { createIdentityService } from '../auth/identity';
import { DEMO_TZ, MockClock, Scheduler, formatDemoInstant } from '../domain/clock';
import { fastForward, loseAgent, restoreAgent } from './runtime';
import { createDatabaseAuthority, type DbAuthority } from './authority';
import type { OperationService } from '../features/operations/service';
import type { FindingService } from '../features/findings/index';
import { type ChatService, createChatService } from '../features/aichat/service';
import type { AiHistoryService } from '../features/aichat/history';
import type { PlanService } from '../features/plans/service';
import type { AgentService } from '../features/agents/service';
import type { ReportService } from '../features/reports/service';
import type { BranchService } from '../features/branches/service';
import type { LibraryService } from '../features/library';
import type { OverviewService } from '../features/overview/service';
import type { ProjectsService } from '../features/projects/service';
import type { AnalysisService } from '../features/analysis/service';
import type { SettingsService } from '../features/settings/service';
import type { AssetService } from '../features/assets';
import { MOCK_ASSET_CAPABILITIES } from '../features/assets/service';
import type { ScopeService } from '../features/scope/service';
import type { AuditService } from '../features/audit/service';
import type { TeamService } from '../features/team/service';
import type { VaultService } from '../features/vault/service';
import type { ClosureService } from '../features/closure/service';
import type { PlanningService } from '../features/planning/service';
import type { GovernanceService } from '../features/governance/service';
import type { C2ProviderService } from '../features/c2/provider';
import type { RuntimeOperationsService } from '../features/operations/runtime';
import { createMockNoticeCenter } from '../features/notices/center-mock';
import type { ObservedAnalysisService } from '../features/analysis/observed';
import type { WorkerService } from '../features/workers/service';
import type { NoticeService } from '../features/notices/service';
import type { ResultsService } from '../features/results/service';
import type { TraceService } from '../features/trace/service';
import type { C2Service } from '../features/c2/service';
import { createGrantLifecycle } from '../features/c2/grants';
import type { ActorRef, Instant, ListResult, PageRequest, ReadResult, RequestContext, ServiceResult } from '../domain/service';
import { unavailableService } from '../domain/unavailable';
import type { DisplayClock, ProjectService, ConsoleServices, ScopeGuard } from '../domain/console-services';

/** Scope check: the shared permissions interface is the one membership rule (ticket 06). */
export function canAccess(db: ReturnType<DbAuthority['snapshot']>, actor: ActorRef, projectId: string): boolean {
  return projectAccessible(db.projects.find((x) => x.id === projectId), actor)
}

export function readProject(db: ReturnType<DbAuthority['snapshot']>, ctx: RequestContext, id: string): ReadResult<Project> {
  const p = db.projects.find((x) => x.id === id)
  // Out of scope reads are not-found, never a leaked existence signal.
  if (!p || !canAccess(db, ctx.actor, id)) {
    return { ok: false, failure: { kind: 'not-found', message: `Project ${id} does not exist or is out of scope.`, entity: { kind: 'project', id } } }
  }
  return { ok: true, data: p }
}

export function listProjects(db: ReturnType<DbAuthority['snapshot']>, ctx: RequestContext, page?: PageRequest): ListResult<Project> {
  const accessible = db.projects.filter((p) => canAccess(db, ctx.actor, p.id))
  const items = ctx.projectId ? accessible.filter((p) => p.id === ctx.projectId) : accessible
  const req = page ?? { page: 1, pageSize: Math.max(1, items.length) }
  const start = (req.page - 1) * req.pageSize
  return { ok: true, data: { items: items.slice(start, start + req.pageSize), page: req.page, pageSize: req.pageSize, total: items.length } }
}

/**
 * A handler object whose module loads on first method call (ticket 70). The
 * proxy memoizes the loaded instance per binding; every method awaits the
 * load and delegates, which matches the already-async handler signatures.
 */
// Properties in `sync` answer at once (constants of the service); every other property is a method that waits for the module.
export function lazyService<S extends object>(load: () => Promise<S>, sync: Partial<S> = {}): S {
  let instance: Promise<S> | null = null
  const ensure = () => (instance ??= load())
  return new Proxy({} as S, {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined
      if (prop in sync) return sync[prop as keyof S]
      return (...args: unknown[]) =>
        ensure().then((svc) => (svc as unknown as Record<string, (...a: unknown[]) => unknown>)[prop](...args))
    },
  })
}

/**
 * Lazy wiring for guard-taking services (ticket 70): the superseded-scope
 * guard is created eagerly at facade-call time so cancelScope supersedes a
 * read even while the service module is still loading; only the module load
 * is deferred.
 */
export function lazyGuarded<S extends object>(
  guard: ScopeGuard,
  load: (guard: ScopeGuard) => Promise<S>,
  sync: Partial<S> = {},
): S {
  return lazyService(() => load(guard), sync)
}

/** The dataset's time fields in the demo zone, read from the factory's injected clock. */
const demoTimeParts = (t: Instant, fields: Intl.DateTimeFormatOptions): Record<string, string> =>
  Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: DEMO_TZ, hourCycle: 'h23', ...fields }).formatToParts(new Date(t)).map((p) => [p.type, p.value]))

/** The mock console's display labels, derived from the factory's clock so they advance with the dataset, not the host. */
const displayAt = (clock: MockClock): DisplayClock => ({
  stamp: () => formatDemoInstant(clock.now()),
  hhmm: () => { const p = demoTimeParts(clock.now(), { hour: '2-digit', minute: '2-digit' }); return `${p.hour}:${p.minute}` },
  hhmmss: () => { const p = demoTimeParts(clock.now(), { hour: '2-digit', minute: '2-digit', second: '2-digit' }); return `${p.hour}:${p.minute}:${p.second}` },
})

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
    lazyGuarded(scopeGuard(actor, projectId), (guard) => import('../features/reports/mock').then((m) => m.createReportService(authority, clock, guard)))
  const forBranches = (actor: ActorRef, projectId: string): BranchService =>
    lazyGuarded(scopeGuard(actor, projectId), (guard) => import('../features/branches/service').then((m) => m.createBranchService(authority, clock, guard)))
  const forProjects = (actor: ActorRef): ProjectsService =>
    lazyService(() => import('../features/projects/mock').then((m) => m.createProjectsService(() => forScope(actor, 'all').list({ actor, projectId: '', corr: 'projects-list' }))))
  const forOverview = (actor: ActorRef): OverviewService =>
    lazyService(() => import('../features/overview/mock').then((m) => m.createOverviewService(authority, actor)))
  const forLibrary = (actor: ActorRef, projectId: string): LibraryService =>
    lazyGuarded(scopeGuard(actor, projectId), (guard) => import('../features/library/mock').then((m) => m.createLibraryService(authority, clock, guard)))
  const forAnalysis = (actor: ActorRef, projectId: string): AnalysisService =>
    lazyGuarded(scopeGuard(actor, projectId), (guard) => import('../features/analysis/service').then((m) => m.createAnalysisService(authority, guard)))
  const forSettings = (actor: ActorRef, projectId: string): SettingsService =>
    lazyGuarded(scopeGuard(actor, projectId), (guard) => import('../features/settings/service').then((m) => m.createSettingsService(authority, clock, guard)))
  const forObservedAnalysis = (actor: ActorRef, projectId: string): ObservedAnalysisService =>
    lazyGuarded(scopeGuard(actor, projectId), (guard) => import('../features/analysis/observed-mock').then((m) => m.createMockObservedAnalysisService(authority, guard)))
  const forClosure = (actor: ActorRef, projectId: string): ClosureService =>
    lazyGuarded(scopeGuard(actor, projectId), (guard) => import('../features/closure/mock').then((m) => m.createMockClosureService(authority, clock, guard)))
  const forVault = (actor: ActorRef, projectId: string): VaultService =>
    lazyGuarded(scopeGuard(actor, projectId), (guard) => import('../features/vault/mock').then((m) => m.createMockVaultService(authority, guard)))
  const forTeam = (actor: ActorRef, projectId: string): TeamService =>
    lazyGuarded(scopeGuard(actor, projectId), (guard) => import('../features/team/mock').then((m) => m.createMockTeamService(authority, guard)))
  const forRoeScope = (actor: ActorRef, projectId: string): ScopeService =>
    lazyGuarded(scopeGuard(actor, projectId), (guard) => import('../features/scope/mock').then((m) => m.createMockScopeService(authority, clock, guard)))
  const forAssets = (actor: ActorRef, projectId: string): AssetService =>
    lazyGuarded<AssetService>(scopeGuard(actor, projectId), (guard) => import('../features/assets/mock').then((m) => m.createAssetService(authority, clock, guard)), { capabilities: MOCK_ASSET_CAPABILITIES })
  const forWorkers = (actor: ActorRef, projectId: string): WorkerService =>
    lazyGuarded(scopeGuard(actor, projectId), (guard) => import('../features/workers/service').then((m) => m.createWorkerService(authority, guard)))
  const forNotices = (actor: ActorRef, projectId: string): NoticeService =>
    lazyGuarded(scopeGuard(actor, projectId), (guard) => import('../features/notices/service').then((m) => m.createNoticeService(authority, clock, guard)))
  const forResults = (actor: ActorRef, projectId: string): ResultsService =>
    lazyGuarded(scopeGuard(actor, projectId), (guard) => import('../features/results/service').then((m) => m.createResultsService(authority, guard)))
  const forTrace = (actor: ActorRef, projectId: string): TraceService =>
    lazyGuarded(scopeGuard(actor, projectId), (guard) => import('../features/trace/service').then((m) => m.createTraceService(authority, clock, guard)))
  const forC2 = (actor: ActorRef, projectId: string): C2Service =>
    lazyGuarded(scopeGuard(actor, projectId), (guard) => import('../features/c2/service').then((m) => m.createC2Service(authority, clock, guard)))
  const grants = createGrantLifecycle(authority, clock, scheduler)

  const cancelScope = (actor: ActorRef, projectId: string) => {
    const key = scopeKey(actor, projectId)
    scopeGen.set(key, (scopeGen.get(key) ?? 0) + 1)
  }

  return {
    identity,
    authority,
    clock,
    display: displayAt(clock),
    demo: { loseAgent, restoreAgent, fastForward },
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
    overview: forOverview,
    projects: forProjects,
    analysis: forAnalysis,
    settings: forSettings,
    assets: forAssets,
    scope: forRoeScope,
    team: forTeam,
    vault: forVault,
    closure: forClosure,
    observedAnalysis: forObservedAnalysis,
    planning: () => unavailableService<PlanningService>({ read: true, confirmHandoff: true, source: true, saveDraft: true, publish: true, discardDraft: true }, 'Planning documents are not available on this server.'),
    governance: () => unavailableService<GovernanceService>({ plans: true, draftPlan: true, proposePlan: true, decidePlan: true, revisePlan: true, comparePlans: true, preflight: true, bindPlan: true, executionThreads: true, stops: true, requestStop: true, resolveStop: true, schedules: true, createSchedule: true, cancelSchedule: true, rescheduleSchedule: true }, 'Governance is not available on this server.'),
    c2Provider: () => unavailableService<C2ProviderService>({ surface: true, grants: true, commands: true, requestGrant: true, decideGrant: true, dispatch: true, reconcile: true, startListener: true, stopListener: true, createProfile: true }, 'The C2 provider is not available on this server.'),
    runtimeOperations: () => unavailableService<RuntimeOperationsService>({ fleet: true, threads: true, runs: true, snapshot: true, cancelRun: true, operation: true, pauseRun: true, resumeOperation: true, completeOperation: true, timeline: true }, 'Runtime operations are not available on this server.'),
    noticeCenter: (actor, projectId) => createMockNoticeCenter(forNotices(actor, projectId)),
    audit: () => unavailableService<AuditService>({ read: true }, 'The mock console shows its audit log in the project Activity & Audit tab; this port serves the real backend only.'),
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
