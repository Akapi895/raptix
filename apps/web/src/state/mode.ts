/**
 * Data-mode resolution (integration ticket 03, ADR-0068 —
 * docs/adr/0068-web-frontend-real-mode-data-boundary.md).
 *
 * The console runs in exactly one data mode per app load: 'mock' (standalone
 * demo authority, deterministic seed) or 'real' (same-origin /api transport).
 * Mode is selected BEFORE any provider or transport is created — resolution
 * happens once at module init, and switching modes reloads the app so every
 * provider, cache entry and subscription is disposed with the old mode.
 *
 * Precedence: `?dataMode=` query parameter (explicit one-off override) >
 * localStorage `raptix.dataMode` (user preference) > `VITE_DATA_MODE` build
 * default > 'mock'.
 */

export type DataMode = 'mock' | 'real'

export const DATA_MODE_STORAGE_KEY = 'raptix.dataMode'

function parseMode(value: unknown): DataMode | null {
  return value === 'mock' || value === 'real' ? value : null
}

function fromQuery(): DataMode | null {
  try {
    return parseMode(new URLSearchParams(window.location.search).get('dataMode'))
  } catch {
    return null
  }
}

function fromStorage(): DataMode | null {
  try {
    return parseMode(window.localStorage.getItem(DATA_MODE_STORAGE_KEY))
  } catch {
    return null
  }
}

function fromBuild(): DataMode | null {
  return parseMode(import.meta.env.VITE_DATA_MODE)
}

/**
 * A production build is always real: the demo data is not reachable from the console (phase 1 of removing the mock path).
 * Development and tests keep the precedence above, so the developer's demo workflow still works until the demo is removed.
 */
export function resolveDataMode(): DataMode {
  if (import.meta.env.PROD) return 'real'
  return fromQuery() ?? fromStorage() ?? fromBuild() ?? 'mock'
}

/** Evaluated once per app load; a mode switch reloads instead of reacting. */
export const DATA_MODE: DataMode = resolveDataMode()

export const isRealMode = (): boolean => DATA_MODE === 'real'

/**
 * Persists the choice and reloads so the other mode's providers, Query cache
 * and subscriptions are fully disposed before the new mode mounts.
 */
export function switchDataMode(mode: DataMode): void {
  if (mode === DATA_MODE) return
  try {
    window.localStorage.setItem(DATA_MODE_STORAGE_KEY, mode)
  } catch {
    // Storage may be unavailable (private mode); the reload still switches
    // for this session via the explicit `?dataMode=` parameter below.
  }
  const url = new URL(window.location.href)
  url.searchParams.set('dataMode', mode)
  window.location.assign(url)
}
