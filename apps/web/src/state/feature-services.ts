/* eslint-disable react-hooks/rules-of-hooks -- mode branches are keyed on the module-constant DATA_MODE */
import { useContext } from 'react'
import type { FeatureServices } from '../domain/console-services';
import { DATA_MODE } from './mode'
import { RealFeatureServicesCtx } from './real-services-provider'
import { useServices } from './services'

/**
 * Per-feature service facade for both modes (ADR-0084). Mock mode returns the
 * authority-backed services unchanged; real mode returns the adapter composed
 * from the server's capability document.
 */
export function useFeatureServices(): FeatureServices {
  if (DATA_MODE === 'real') {
    const services = useContext(RealFeatureServicesCtx)
    if (!services) throw new Error('Real feature services are not mounted for this surface.')
    return services
  }
  return useServices()
}
