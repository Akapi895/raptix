import { createContext, useMemo, type ReactElement, type ReactNode } from 'react'
import type { FeatureServices } from '../domain/console-services';
import type { CapabilitiesDocument } from '@raptix/web-contracts';
import { createRealFeatureServices } from './real-services'

/** Real per-feature services; null outside the real composition root. */
// eslint-disable-next-line react-refresh/only-export-components
export const RealFeatureServicesCtx = createContext<FeatureServices | null>(null)

export function RealFeatureServicesProvider({ document, children }: { document: CapabilitiesDocument; children: ReactNode }): ReactElement {
  const services = useMemo(() => createRealFeatureServices(document), [document])
  return <RealFeatureServicesCtx.Provider value={services}>{children}</RealFeatureServicesCtx.Provider>
}
