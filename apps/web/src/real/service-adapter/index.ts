import type { FeatureServices } from '../../domain/service-factory'
import { capabilityState, type CapabilitiesDocument } from '../api'
import { createRealFindingService } from './findings'
import { notIntegratedService } from './stub'
import type { FindingService } from '../../features/findings/service'

/**
 * Composes real per-feature services from the server's capability document
 * (ADR-0084). A domain without a supported capability, or without an adapter,
 * resolves every call to an explicit unavailable outcome.
 */
export function createRealFeatureServices(capabilities: CapabilitiesDocument): FeatureServices {
  const findingsSupported = capabilityState(capabilities, 'findings')?.supported === true
  const findings: FeatureServices['findings'] = findingsSupported
    ? (() => {
        const service = createRealFindingService()
        return () => service
      })()
    : () => notIntegratedService<FindingService>('Findings')
  return { findings }
}
