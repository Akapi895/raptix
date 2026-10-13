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
// Feature appends: every feature service is feature-local (src/features/*);
// the factory only wires each one into a scope with the shared guard.
import { createOperationService, type OperationService } from '../features/operations/service'
import { createFindingService, type FindingService } from '../features/findings/service'
import { createChatService, type ChatService } from '../features/aichat/service'
import { createPlanService, type PlanService } from '../features/plans/service'
import { createPlanBridgeService, type PlanBridgeService } from '../features/plans/bridge'
import { createAgentService, type AgentService } from '../features/agents/service'
import { createReportService, type ReportService } from '../features/reports/service'
import { createBranchService, type BranchService } from '../features/branches/service'
import { createLibraryService, type LibraryService } from '../features/library/service'
import { createAnalysisService, type AnalysisService } from '../features/analysis/service'
import { createSettingsService, type SettingsService } from '../features/settings/service'
import { createAssetService, type AssetService } from '../features/assets/service'
import { createWorkerService, type WorkerService } from '../features/workers/service'
import { createNoticeService, type NoticeService } from '../features/notices/service'
import { createResultsService, type ResultsService } from '../features/results/service'
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
  /** Typed plan workbench + approval/expiry handlers (ticket 39 — feature-local implementation). */
  plans(actor: ActorRef, projectId: string): PlanService
  /** Typed plan→operation bridge (ticket 40 — feature-local implementation). */
  plansBridge(actor: ActorRef, projectId: string): PlanBridgeService
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
  /** Typed AI worker dependency graph read (ticket 44 — feature-local implementation). */
  workers(actor: ActorRef, projectId: string): WorkerService
  /** Typed notice center handlers (ticket 59 — feature-local implementation). */
  notices(actor: ActorRef, projectId: string): NoticeService
  /** Typed operation results + execution graph read (ticket 30 — feature-local implementation). */
  results(actor: ActorRef, projectId: string): ResultsService
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

  /* Shared superseded-scope guard: every feature wiring passes reads through
   * this, so cancelScope covers all in-flight feature reads on a persona/
   * project switch. Writes never cancel mid-flight. */
  const scopeGuard = (actor: ActorRef, projectId: string) =>
    async <T>(produce: () => ServiceResult<T>): Promise<ServiceResult<T>> => {
      let superseded = false
      const cancel = () => { superseded = true }
      const key = scopeKey(actor, projectId)
      let set = inFlight.get(key)
      if (!set) { set = new Set(); inFlight.set(key, set) }
      set.add(cancel)
      await Promise.resolve()
      set.delete(cancel)
      if (superseded) return { ok: false, failure: { kind: 'unavailable', message: 'Request superseded by a scope change.' } }
      return produce()
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
    createOperationService(authority, clock, scopeGuard(actor, projectId))
  const forFindings = (actor: ActorRef, projectId: string): FindingService =>
    createFindingService(authority, clock, scopeGuard(actor, projectId))
  const forChat = (actor: ActorRef, projectId: string): ChatService =>
    createChatService(authority, clock, scopeGuard(actor, projectId))
  const forPlans = (actor: ActorRef, projectId: string): PlanService =>
    createPlanService(authority, clock, scopeGuard(actor, projectId))
  const forAgents = (actor: ActorRef, projectId: string): AgentService =>
    createAgentService(authority, clock, scopeGuard(actor, projectId))
  const forReports = (actor: ActorRef, projectId: string): ReportService =>
    createReportService(authority, clock, scopeGuard(actor, projectId))
  const forBranches = (actor: ActorRef, projectId: string): BranchService =>
    createBranchService(authority, clock, scopeGuard(actor, projectId))
  const forLibrary = (actor: ActorRef, projectId: string): LibraryService =>
    createLibraryService(authority, clock, scopeGuard(actor, projectId))
  const forAnalysis = (actor: ActorRef, projectId: string): AnalysisService =>
    createAnalysisService(authority, scopeGuard(actor, projectId))
  const forSettings = (actor: ActorRef, projectId: string): SettingsService =>
    createSettingsService(authority, clock, scopeGuard(actor, projectId))
  const forAssets = (actor: ActorRef, projectId: string): AssetService =>
    createAssetService(authority, scopeGuard(actor, projectId))
  const forWorkers = (actor: ActorRef, projectId: string): WorkerService =>
    createWorkerService(authority, scopeGuard(actor, projectId))
  const forNotices = (actor: ActorRef, projectId: string): NoticeService =>
    createNoticeService(authority, clock, scopeGuard(actor, projectId))
  const forResults = (actor: ActorRef, projectId: string): ResultsService =>
    createResultsService(authority, scopeGuard(actor, projectId))

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
    plans: forPlans,
    // Ticket 40: the bridge is write-only over the shared authority — no
    // scope-guarded reads, so the wiring needs no per-scope state.
    plansBridge: () => createPlanBridgeService(authority, clock),
    agents: forAgents,
    reports: forReports,
    branches: forBranches,
    library: forLibrary,
    analysis: forAnalysis,
    settings: forSettings,
    assets: forAssets,
    workers: forWorkers,
    notices: forNotices,
    results: forResults,
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
