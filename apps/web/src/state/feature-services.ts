import { useContext } from 'react'
import type { FeatureServices } from '../domain/feature-services'
import { RealFeatureServicesCtx } from './real-services-provider'

/**
 * Per-feature service facade (ADR-0084): the adapter composed from the server's capability document, mounted by the real
 * composition root. A surface that renders outside that root fails fast instead of falling back to any other data.
 */
export function useFeatureServices(): FeatureServices {
  const services = useContext(RealFeatureServicesCtx)
  if (!services) throw new Error('Real feature services are not mounted for this surface.')
  return services
}
