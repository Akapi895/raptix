import type { ServiceFailure, ServiceResult } from '../domain/service'
import { REAL_CONTROL_GAPS } from './control-gaps'

/** Explicit unavailable outcome for a call the real backend cannot serve (ADR-0068 D4). */
export function unavailable<T>(message: string): Promise<ServiceResult<T>> {
  const failure: ServiceFailure = { kind: 'unavailable', message }
  return Promise.resolve({ ok: false, failure })
}

/** Unavailable outcome whose message is the registered reason for a control gap. */
export function unsupportedControl<T>(gapId: string): Promise<ServiceResult<T>> {
  return unavailable<T>(REAL_CONTROL_GAPS[gapId] ?? `${gapId} is not available in real mode.`)
}

/** A whole domain without a real adapter: every method resolves to an unavailable outcome. */
export function notIntegratedService<S extends object>(surface: string): S {
  const message = `${surface} is not integrated with the real backend yet.`
  return new Proxy({} as S, {
    get: (_target, prop) => {
      if (typeof prop !== 'string' || prop === 'then') return undefined
      return () => unavailable(message)
    },
  })
}
