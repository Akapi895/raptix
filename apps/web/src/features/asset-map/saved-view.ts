/**
 * The asset last opened on the map, remembered per signed-in user and project in this browser. It is
 * a convenience for reloads only: the server never reads it, other viewers and other users of the
 * same browser never see it, and a blocked or cleared storage simply means no restore.
 */
const PREFIX = 'raptix.assetMap.selected.'

function keyFor(actorId: string, engagementId: string): string {
  return `${PREFIX}${encodeURIComponent(actorId)}.${encodeURIComponent(engagementId)}`
}

export function loadSavedSelection(actorId: string | null, engagementId: string): string | null {
  if (!actorId) return null
  try {
    return globalThis.localStorage?.getItem(keyFor(actorId, engagementId)) ?? null
  } catch {
    return null
  }
}

export function saveSelection(actorId: string | null, engagementId: string, assetId: string): void {
  if (!actorId) return
  try {
    globalThis.localStorage?.setItem(keyFor(actorId, engagementId), assetId)
  } catch {
    // Storage is unavailable (private window, blocked site data): the map still works without a saved view.
  }
}
