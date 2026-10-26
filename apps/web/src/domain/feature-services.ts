import type { ActorRef } from './service'
import type { OverviewService } from '../features/overview'
import type { ProjectsService } from '../features/projects'
import type { FindingService } from '../features/findings/index'
import type { ReportService } from '../features/reports/service'
import type { AssetService } from '../features/assets'
import type { LibraryService } from '../features/capabilities'
import type { ScopeService } from '../features/scope/service'
import type { AuditService } from '../features/audit/service'
import type { TeamService } from '../features/team/service'
import type { VaultService } from '../features/vault/service'
import type { ClosureService } from '../features/closure/service'
import type { ObservedAnalysisService } from '../features/analysis/observed'
import type { PlanningService } from '../features/planning/service'
import type { GovernanceService } from '../features/governance/service'
import type { C2ProviderService } from '../features/c2/provider'
import type { WebShellService } from '../features/webshell/service'
import type { RuntimeOperationsService } from '../features/operations/runtime'
import type { NoticeCenterService } from '../features/notices/center'
import type { SettingsService } from '../features/settings/service'

/** Per-feature service surface that the real adapters implement (ADR-0084). Grows one entry per migrated domain. */
export interface FeatureServices {
  overview(actor: ActorRef): OverviewService
  projects(actor: ActorRef): ProjectsService
  findings(actor: ActorRef, projectId: string): FindingService
  reports(actor: ActorRef, projectId: string): ReportService
  assets(actor: ActorRef, projectId: string): AssetService
  library(actor: ActorRef, projectId: string): LibraryService
  scope(actor: ActorRef, projectId: string): ScopeService
  audit(actor: ActorRef, projectId: string): AuditService
  team(actor: ActorRef, projectId: string): TeamService
  settings(actor: ActorRef, projectId: string): SettingsService
  vault(actor: ActorRef, projectId: string): VaultService
  closure(actor: ActorRef, projectId: string): ClosureService
  observedAnalysis(actor: ActorRef, projectId: string): ObservedAnalysisService
  planning(actor: ActorRef, projectId: string): PlanningService
  governance(actor: ActorRef, projectId: string): GovernanceService
  c2Provider(actor: ActorRef, projectId: string): C2ProviderService
  webshell(actor: ActorRef, projectId: string): WebShellService
  runtimeOperations(actor: ActorRef, projectId: string): RuntimeOperationsService
  noticeCenter(actor: ActorRef, projectId: string): NoticeCenterService
}
