/**
 * The Asset Map is off unless a build enables it (VITE_ASSET_MAP=1) or one browser opts in
 * (localStorage `raptix.assetMap` = "1"). Off means the route is not registered at all, so the
 * page resolves exactly like an unknown route.
 *
 * An address can set the opt-in without the console: `?assetMap=1` (before or after the hash) turns
 * it on for this browser, and `?assetMap=0` turns it off. The address is read on the first full load,
 * so open the app as `/?assetMap=1` once; later loads in the same browser keep the opt-in.
 */
const STORAGE_KEY = 'raptix.assetMap'
const ADDRESS_KEY = 'assetMap'

/** Applies `assetMap` from the address to the stored opt-in. Storage that is unavailable leaves it off. */
function optInFromAddress(): void {
  const hash = globalThis.location?.hash ?? ''
  const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : ''
  const value = new URLSearchParams(`${globalThis.location?.search ?? ''}&${hashQuery}`).get(ADDRESS_KEY)
  if (value === null) return
  try {
    if (value === '1') globalThis.localStorage?.setItem(STORAGE_KEY, '1')
    else if (value === '0') globalThis.localStorage?.removeItem(STORAGE_KEY)
  } catch {
    // Storage is blocked in this browser: the address still cannot turn the flag on.
  }
}

export function isAssetMapEnabled(): boolean {
  if (import.meta.env.VITE_ASSET_MAP === '1') return true
  optInFromAddress()
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}
