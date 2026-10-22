import type { SeedVariant } from '../demo/seed';
import type { Project } from './entities';
import type { IdentityService } from '../auth/identity';
import { MockClock } from './clock';
import type { DbAuthority } from '../demo/authority';
import type { OperationService } from '../features/operations/service';
import type { FindingService } from '../features/findings/index';
import type { ChatService } from '../features/aichat/service';
import type { AiHistoryService } from '../features/aichat/history';
import type { PlanService } from '../features/plans/service';
import type { PlanBridgeService } from '../features/plans/bridge';
import type { PlanCompareService } from '../features/plans/compare';
import type { AgentService } from '../features/agents/service';
import type { ReportService } from '../features/reports/service';
import type { BranchService } from '../features/branches/service';
import type { LibraryService } from '../features/library';
import type { OverviewService } from '../features/overview';
import type { ProjectsService } from '../features/projects';
import type { AnalysisService } from '../features/analysis/service';
import type { SettingsService } from '../features/settings/service';
import type { AssetService } from '../features/assets';
import type { ScopeService } from '../features/scope/service';
import type { AuditService } from '../features/audit/service';
import type { TeamService } from '../features/team/service';
import type { VaultService } from '../features/vault/service';
import type { ClosureService } from '../features/closure/service';
import type { PlanningService } from '../features/planning/service';
import type { GovernanceService } from '../features/governance/service';
import type { C2ProviderService } from '../features/c2/provider';
import type { RuntimeOperationsService } from '../features/operations/runtime';
import type { NoticeCenterService } from '../features/notices/center';
import type { ObservedAnalysisService } from '../features/analysis/observed';
import type { WorkerService } from '../features/workers/service';
import type { NoticeService } from '../features/notices/service';
import type { ResultsService } from '../features/results/service';
import type { TraceService } from '../features/trace/service';
import type { C2Service } from '../features/c2/service';
import type { ActorRef, ChangeSet, EntityReader, Instant, RequestContext, ServiceResult } from './service';

/** Fields the representative project write may change (ticket 04 exemplar). */
export interface ProjectPatch {
  pinned?: boolean
  desc?: string
}

export interface ProjectService extends EntityReader<Project> {
  /** Representative typed write: authorization + atomic commit + ChangeSet. */
  update(ctx: RequestContext, id: string, patch: ProjectPatch): Promise<ServiceResult<Project>>
}

/** Mock-only display labels anchored at the dataset's demo instant (the real console has no demo clock). */
export interface DisplayClock {
  stamp(): string
  hhmm(): string
  hhmmss(): string
}

/** Mock-only demo runtime controls: agent loss and recovery, and fast-forwarding a running operation. */
export interface DemoRuntimeControls {
  loseAgent(agentId: string): void
  restoreAgent(agentId: string): void
  fastForward(opId: string): void
}

/**
 * Per-feature service surface that real-mode adapters implement
 * (ADR-0084). Grows one entry per migrated domain; mock-only plumbing such as
 * `authority`, `clock` and `schedule` is deliberately absent.
 */
export type FeatureServices = Pick<ConsoleServices, 'overview' | 'projects' | 'findings' | 'reports' | 'assets' | 'library' | 'scope' | 'audit' | 'team' | 'settings' | 'vault' | 'closure' | 'observedAnalysis' | 'planning' | 'governance' | 'c2Provider' | 'runtimeOperations' | 'noticeCenter'>

export interface ConsoleServices {
  identity: IdentityService
  authority: DbAuthority
  clock: MockClock
  /** Mock-only display clock and demo runtime controls; the composition root supplies them, features reach them through hooks. */
  display: DisplayClock
  demo: DemoRuntimeControls
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
  /** Global overview reads for the actor across accessible projects (migration Mốc 2, feature-local implementation). */
  overview(actor: ActorRef): OverviewService
  /** Project list reads for the actor (migration Mốc 2, feature-local implementation). */
  projects(actor: ActorRef): ProjectsService
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
  /** Project membership (plan P09 Team slice): the mock adapter maps its project members, the real adapter reads the API. */
  team(actor: ActorRef, projectId: string): TeamService
  /** Credentials vault (plan P09 Vault slice): the mock adapter maps its vault records, the real adapter reads the API. */
  vault(actor: ActorRef, projectId: string): VaultService
  /** Project closure (plan P09 Closure slice): the mock adapter maps its close approvals, the real adapter reads the closure API. */
  closure(actor: ActorRef, projectId: string): ClosureService
  /** Planning handoff documents (plan P09 Planning slice). Real mode only: the mock console keeps its own document workspace. */
  planning(actor: ActorRef, projectId: string): PlanningService
  /** Business plan, preflight, binding, schedules and stops (plan P09 Governance slice). Real mode only: the mock console keeps its own plan review. */
  governance(actor: ActorRef, projectId: string): GovernanceService
  /** C2 provider sessions, grants and command ledger (plan P12 C2 slice). Real mode only: the mock console keeps its own session model. */
  c2Provider(actor: ActorRef, projectId: string): C2ProviderService
  /** Execution threads, runs and the runtime timeline (plan P12 Operations slice). Real mode only: the mock console keeps its own lifecycle. */
  runtimeOperations(actor: ActorRef, projectId: string): RuntimeOperationsService
  /** Observed analysis (plan P09 Analysis slice): the mock adapter maps its executed steps, the real adapter reads the knowledge graph. */
  observedAnalysis(actor: ActorRef, projectId: string): ObservedAnalysisService
  /** Typed AI worker dependency graph read (ticket 44 — feature-local implementation). */
  workers(actor: ActorRef, projectId: string): WorkerService
  /** Typed notice center handlers (ticket 59 — feature-local implementation). */
  notices(actor: ActorRef, projectId: string): NoticeService
  /** The header notification center (plan P09 Notices slice): the mock adapter presents its notices, the real adapter reads the API. */
  noticeCenter(actor: ActorRef, projectId: string): NoticeCenterService
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

/** The factory's superseded-scope read guard (see createConsoleServices). */
export type ScopeGuard = <T>(produce: () => ServiceResult<T>) => Promise<ServiceResult<T>>
