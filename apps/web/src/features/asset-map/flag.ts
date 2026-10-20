/**
 * The Asset Map is off unless a build enables it (VITE_ASSET_MAP=1) or one browser opts in
 * (localStorage `raptix.assetMap` = "1"). Off means the route is not registered at all, so the
 * page resolves exactly like an unknown route.
 */
const STORAGE_KEY = 'raptix.assetMap'

export function isAssetMapEnabled(): boolean {
  if (import.meta.env.VITE_ASSET_MAP === '1') return true
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}
