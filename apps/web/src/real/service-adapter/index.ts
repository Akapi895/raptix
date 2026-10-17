import type { FeatureServices } from '../../domain/service-factory'
import type { FindingService } from '../../features/findings/service'
import type { AssetService } from '../../features/assets/service'
import type { ReportService } from '../../features/reports/service'
import { capabilityState, type CapabilitiesDocument } from '../api'
import { createRealAssetService } from './assets'
import { createRealFindingService } from './findings'
import { createRealReportService } from './reports'
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
  return { findings, reports, assets }
}
