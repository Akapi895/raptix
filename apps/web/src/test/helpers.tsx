import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { createElement, type ComponentType, type ReactNode } from 'react'
import { RealContext } from '../state/real-context'
import { REAL_IDENTITY } from '../state/real-identity'
import { RealFeatureServicesCtx } from '../state/real-services-provider'
import { createRealFeatureServices } from '../state/real-services'
import { resetSharedStores } from '../state/stores'
import { resetSessionStores } from '../state/session'
import { resetNavStores } from '../router/navigate'

const CAPABILITIES = { version: 1, mode: 'multi-user', capabilities: { projects: { supported: true, available: true } } } as never

/**
 * Mounts a screen with the real console context the app provides: the capability document, the trusted identity and the
 * feature adapters. Tests that need data stub `fetch` themselves.
 */
export function mountConsole(ui: ComponentType | ReactNode = null) {
  resetSharedStores()
  resetSessionStores()
  resetNavStores()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const services = createRealFeatureServices(CAPABILITIES)
  return render(
    <QueryClientProvider client={client}>
      <RealContext.Provider value={{ document: CAPABILITIES, identity: REAL_IDENTITY }}>
        <RealFeatureServicesCtx.Provider value={services}>
          {typeof ui === 'function' ? createElement(ui) : ui}
        </RealFeatureServicesCtx.Provider>
      </RealContext.Provider>
    </QueryClientProvider>,
  )
}

