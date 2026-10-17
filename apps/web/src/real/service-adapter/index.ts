import type { FeatureServices } from '../../domain/service-factory'
import type { FindingService } from '../../features/findings/service'
import type { AssetService } from '../../features/assets/service'
import type { ReportService } from '../../features/reports/service'
import type { LibraryService } from '../../features/library/service'
import type { SettingsService } from '../../features/settings/service'
import { unavailableScopeService } from '../../features/scope/service'
import { unavailableAuditService } from '../../features/audit/service'
import { unavailableTeamService } from '../../features/team/service'
import { capabilityState, type CapabilitiesDocument } from '../api'
import { createRealAssetService } from './assets'
import { createRealFindingService } from './findings'
import { createRealLibraryService } from './library'
import { createRealReportService } from './reports'
import { createRealAuditService } from './audit'
import { createRealScopeService } from './scope'
import { createRealTeamService } from './team'
import { createRealSettingsService } from './settings'
import { createRealVaultService } from './vault'
import { createRealClosureService } from './closure'
import { createRealObservedAnalysisService } from './analysis'
import { unavailableObservedAnalysisService } from '../../features/analysis/observed'
import { unavailableClosureService } from '../../features/closure/service'
import { unavailableVaultService } from '../../features/vault/service'
import { unavailablePlanningService, type PlanningService } from '../../features/planning/service'
import { unavailableGovernanceService, type GovernanceService } from '../../features/governance/service'
import { createRealPlanningService } from './planning'
import { createRealGovernanceService } from './governance'
import { unavailableC2ProviderService, type C2ProviderService } from '../../features/c2/provider'
import { createRealC2ProviderService } from './c2-provider'
import { unavailableRuntimeOperationsService, type RuntimeOperationsService } from '../../features/operations/runtime'
import { createRealRuntimeOperationsService } from './runtime-operations'
import { notIntegratedService } from './stub'

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
    : () => unavailableScopeService()
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
    : () => unavailableAuditService()
  const team: FeatureServices['team'] = supported('projects')
    ? (() => {
        const service = createRealTeamService()
        return () => service
      })()
    : () => unavailableTeamService()
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
    : () => unavailableVaultService()
  const closure: FeatureServices['closure'] = supported('projects')
    ? (() => {
        const service = createRealClosureService()
        return () => service
      })()
    : () => unavailableClosureService()
  const observedAnalysis: FeatureServices['observedAnalysis'] = supported('graphs')
    ? (() => {
        const service = createRealObservedAnalysisService()
        return () => service
      })()
    : () => unavailableObservedAnalysisService()
  const planning: FeatureServices['planning'] = supported('planning')
    ? (() => {
        const service: PlanningService = createRealPlanningService()
        return () => service
      })()
    : () => unavailablePlanningService()
  const governance: FeatureServices['governance'] = supported('projects')
    ? (() => {
        const service: GovernanceService = createRealGovernanceService()
        return () => service
      })()
    : () => unavailableGovernanceService()
  const c2Provider: FeatureServices['c2Provider'] = supported('c2')
    ? (() => {
        const service: C2ProviderService = createRealC2ProviderService()
        return () => service
      })()
    : () => unavailableC2ProviderService()
  const runtimeOperations: FeatureServices['runtimeOperations'] = supported('runs')
    ? (() => {
        const service: RuntimeOperationsService = createRealRuntimeOperationsService()
        return () => service
      })()
    : () => unavailableRuntimeOperationsService()
  return { findings, reports, assets, library, scope, audit, team, settings, vault, closure, observedAnalysis, planning, governance, c2Provider, runtimeOperations }
}
