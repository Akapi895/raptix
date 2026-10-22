import type { FeatureServices } from '../domain/console-services';
import type { FindingService } from '../features/findings'
import type { AssetService } from '../features/assets';
import type { ReportService } from '../features/reports/service';
import type { LibraryService } from '../features/library';
import type { SettingsService } from '../features/settings/service'
import type { ScopeService } from '../features/scope/service'
import type { AuditService } from '../features/audit/service'
import type { TeamService } from '../features/team/service'
import { capabilityState } from '../platform/capabilities';
import type { CapabilitiesDocument } from '@raptix/web-contracts';
import { createRealAssetService } from '../features/assets/remote'
import { createRealOverviewService } from '../features/overview'
import { createRealProjectsService, projectsUnavailableReason } from '../features/projects'
import { createRealFindingService } from '../real/service-adapter/findings'
import { createRealLibraryService } from '../features/library/remote'
import { createRealReportService } from '../features/reports/remote';
import { createRealAuditService } from '../features/audit/remote'
import { createRealScopeService } from '../features/scope/remote'
import { createRealTeamService } from '../features/team/remote'
import { createRealSettingsService } from '../real/service-adapter/settings'
import { createRealVaultService } from '../features/vault/remote'
import { createRealClosureService } from '../features/closure/remote'
import { createRealObservedAnalysisService } from '../features/analysis/remote'
import type { ObservedAnalysisService } from '../features/analysis/observed'
import type { ClosureService } from '../features/closure/service'
import type { VaultService } from '../features/vault/service'
import type { PlanningService } from '../features/planning/service'
import type { GovernanceService } from '../features/governance/service'
import { createRealPlanningService } from '../real/service-adapter/planning'
import { createRealGovernanceService } from '../features/governance/remote'
import type { C2ProviderService } from '../features/c2/provider'
import { createRealC2ProviderService } from '../real/service-adapter/c2-provider'
import type { RuntimeOperationsService } from '../features/operations/runtime'
import { createRealRuntimeOperationsService } from '../real/service-adapter/runtime-operations'
import type { NoticeCenterService } from '../features/notices/center'
import { createRealNoticeCenterService } from '../features/notices/remote'
import { notIntegratedService } from '../platform/adapter-stub'
import { unavailableService } from '../domain/unavailable'

/**
 * Composes real per-feature services from the server's capability document
 * (ADR-0084). A domain without a supported capability, or without an adapter,
 * resolves every call to an explicit unavailable outcome.
 */
export function createRealFeatureServices(capabilities: CapabilitiesDocument): FeatureServices {
  const supported = (name: string) => capabilityState(capabilities, name)?.supported === true
  const findings: FeatureServices['findings'] = supported('findings')
    ? (() => {
        const service = createRealFindingService()
        return () => service
      })()
    : () => notIntegratedService<FindingService>('Findings')
  const reports: FeatureServices['reports'] = supported('reports')
    ? (() => {
        const service = createRealReportService()
        return () => service
      })()
    : () => notIntegratedService<ReportService>('Reports')
  const assets: FeatureServices['assets'] = supported('assets')
    ? (() => {
        const service = createRealAssetService()
        return () => service
      })()
    : () => notIntegratedService<AssetService>('Assets')
  const scope: FeatureServices['scope'] = supported('scope')
    ? (() => {
        const service = createRealScopeService()
        return () => service
      })()
    : () => unavailableService<ScopeService>({ read: true, submit: true, decide: true }, 'Scope revisions are not available on this server.')
  const library: FeatureServices['library'] = supported('graphs')
    ? (() => {
        const service = createRealLibraryService()
        return () => service
      })()
    : () => notIntegratedService<LibraryService>('Library')
  const audit: FeatureServices['audit'] = supported('audit')
    ? (() => {
        const service = createRealAuditService()
        return () => service
      })()
    : () => unavailableService<AuditService>({ read: true }, 'The mock console shows its audit log in the project Activity & Audit tab; this port serves the real backend only.')
  const team: FeatureServices['team'] = supported('projects')
    ? (() => {
        const service = createRealTeamService()
        return () => service
      })()
    : () => unavailableService<TeamService>({ read: true, invite: true, changeRole: true, remove: true }, 'Memberships are not available on this server.')
  const settings: FeatureServices['settings'] = supported('projects')
    ? (() => {
        const service = createRealSettingsService()
        return () => service
      })()
    : () => notIntegratedService<SettingsService>('Settings')
  const vault: FeatureServices['vault'] = supported('vault')
    ? (() => {
        const service = createRealVaultService()
        return () => service
      })()
    : () => unavailableService<VaultService>({ list: true, reveal: true, store: true, revoke: true }, 'The credentials vault is not available on this server.')
  const closure: FeatureServices['closure'] = supported('projects')
    ? (() => {
        const service = createRealClosureService()
        return () => service
      })()
    : () => unavailableService<ClosureService>({ read: true, request: true, decide: true }, 'Closure is not available on this server.')
  const observedAnalysis: FeatureServices['observedAnalysis'] = supported('graphs')
    ? (() => {
        const service = createRealObservedAnalysisService()
        return () => service
      })()
    : () => unavailableService<ObservedAnalysisService>({ read: true }, 'Analysis is not available on this server: the knowledge graph is not configured here.')
  const planning: FeatureServices['planning'] = supported('planning')
    ? (() => {
        const service: PlanningService = createRealPlanningService()
        return () => service
      })()
    : () => unavailableService<PlanningService>({ read: true, confirmHandoff: true, source: true, saveDraft: true, publish: true, discardDraft: true }, 'Planning documents are not available on this server.')
  const governance: FeatureServices['governance'] = supported('projects')
    ? (() => {
        const service: GovernanceService = createRealGovernanceService()
        return () => service
      })()
    : () => unavailableService<GovernanceService>({ plans: true, draftPlan: true, proposePlan: true, decidePlan: true, revisePlan: true, comparePlans: true, preflight: true, bindPlan: true, executionThreads: true, stops: true, requestStop: true, resolveStop: true, schedules: true, createSchedule: true, cancelSchedule: true, rescheduleSchedule: true }, 'Governance is not available on this server.')
  const c2Provider: FeatureServices['c2Provider'] = supported('c2')
    ? (() => {
        const service: C2ProviderService = createRealC2ProviderService()
        return () => service
      })()
    : () => unavailableService<C2ProviderService>({ surface: true, grants: true, commands: true, requestGrant: true, decideGrant: true, dispatch: true, reconcile: true, startListener: true, stopListener: true, createProfile: true }, 'The C2 provider is not available on this server.')
  const runtimeOperations: FeatureServices['runtimeOperations'] = supported('runs')
    ? (() => {
        const service: RuntimeOperationsService = createRealRuntimeOperationsService()
        return () => service
      })()
    : () => unavailableService<RuntimeOperationsService>({ fleet: true, threads: true, runs: true, snapshot: true, cancelRun: true, operation: true, pauseRun: true, resumeOperation: true, completeOperation: true, timeline: true }, 'Runtime operations are not available on this server.')
  const noticeCenter: FeatureServices['noticeCenter'] = supported('projects')
    ? (() => {
        const service: NoticeCenterService = createRealNoticeCenterService()
        return () => service
      })()
    : () => unavailableService<NoticeCenterService>({ list: true, setRead: true, dismiss: true, markAllRead: true }, 'Notifications are not available on this server.')
  const overview = createRealOverviewService()
  const projectsCapability = capabilityState(capabilities, 'projects')
  const projectsReader: FeatureServices['projects'] = projectsCapability?.supported && projectsCapability.available
    ? (() => { const service = createRealProjectsService(); return () => service })()
    : () => ({ list: async () => ({ ok: false as const, failure: { kind: 'unavailable' as const, message: projectsUnavailableReason(projectsCapability) } }) })
  return { overview: () => overview, projects: projectsReader, findings, reports, assets, library, scope, audit, team, settings, vault, closure, observedAnalysis, planning, governance, c2Provider, runtimeOperations, noticeCenter }
}
