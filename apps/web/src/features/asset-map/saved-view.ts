/**
 * The asset last opened on the map, remembered per project in this browser. It is a convenience
 * for reloads only: the server never reads it, other viewers never see it, and a blocked or
 * cleared storage simply means no restore.
 */
const PREFIX = 'raptix.assetMap.selected.'

export function loadSavedSelection(engagementId: string): string | null {
  try {
    return globalThis.localStorage?.getItem(PREFIX + engagementId) ?? null
  } catch {
    return null
  }
}

export function saveSelection(engagementId: string, assetId: string): void {
  try {
    globalThis.localStorage?.setItem(PREFIX + engagementId, assetId)
  } catch {
    // Storage is unavailable (private window, blocked site data): the map still works without a saved view.
  }
}
