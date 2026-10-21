/** Owns the console authority and its mounted demo lifecycle. */
import { createContext, useContext, useEffect, useRef, type ReactElement, type ReactNode } from 'react'
import { createConsoleServices, type ConsoleServices } from '../domain/service-factory'
import { resetDemoClock } from '../domain/demo-clock'
import { buildLogs, initDemoRuntime, tickOperations } from '../features/demo/runtime'
import { resetNavStores } from '../router/navigate'
import { resetSharedStores } from './stores'
import { resetSessionStores, useSessionStore } from './session'
import { DATA_MODE } from './mode'

const ServicesCtx = createContext<ConsoleServices | null>(null)

// eslint-disable-next-line react-refresh/only-export-components
export function useServices(): ConsoleServices {
  if (DATA_MODE === 'real') {
    throw new Error('Mock console services are unavailable in real mode — this surface is not integrated with the real backend yet.')
  }
  return useContext(ServicesCtx)!
}

/** Tolerant read for composition roots that run in both modes. */
// eslint-disable-next-line react-refresh/only-export-components
export function useServicesOrNull(): ConsoleServices | null {
  if (DATA_MODE === 'real') return null
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useContext(ServicesCtx)
}

export function ServicesProvider({ children }: { children: ReactNode }): ReactElement {
  const servicesRef = useRef<ConsoleServices | null>(null)
  const lifecycle = useRef({ epoch: 0 })
  if (!servicesRef.current) {
    servicesRef.current = createConsoleServices()
    resetDemoClock()
    resetSharedStores()
    resetSessionStores()
    resetNavStores()
  }
  const services = servicesRef.current
  useEffect(() => {
    const mounted = lifecycle.current
    ++mounted.epoch
    const offRuntime = initDemoRuntime(services)
    useSessionStore.getState().setLogs(buildLogs(services.authority.snapshot()))
    let last = Date.now()
    const offReset = services.clock.onReset(() => { last = Date.now(); resetDemoClock() })
    const clock = window.setInterval(() => {
      const elapsed = Date.now() - last
      last = Date.now()
      if (elapsed > 0) services.clock.advance(elapsed)
    }, 15_000)
    const ticker = window.setInterval(() => tickOperations(services), 4000)
    return () => {
      offRuntime()
      offReset()
      clearInterval(clock)
      clearInterval(ticker)
      const epoch = ++mounted.epoch
      // StrictMode replays effects synchronously on the same authority.
      queueMicrotask(() => { if (mounted.epoch === epoch) services.dispose() })
    }
  }, [services])
  return <ServicesCtx.Provider value={services}>{children}</ServicesCtx.Provider>
}
