import type { ServiceFailure } from './service'

/**
 * A service whose listed methods all resolve to one explicit unavailable outcome (ADR-0068). The methods record must name
 * every method of `S`, so a method left out is a type error rather than a silent gap.
 */
export function unavailableService<S extends object>(methods: { readonly [K in keyof S]-?: true }, message: string): S {
  const failure: ServiceFailure = { kind: 'unavailable', message }
  const resolve = () => Promise.resolve({ ok: false as const, failure })
  return Object.fromEntries(Object.keys(methods).map((name) => [name, resolve])) as S
}
