/**
 * The asset last opened on the map and the camera it was seen with, remembered per signed-in user and
 * project in this browser. It is a convenience for reloads only: the server never reads it, other viewers
 * and other users of the same browser never see it, and a blocked or cleared storage means no restore.
 * A value written before the camera was saved (a bare asset id) still restores the asset.
 */
const PREFIX = 'raptix.assetMap.selected.'

export interface SavedCamera {
  zoom: number
  x: number
  y: number
}

export interface SavedView {
  assetId: string
  camera: SavedCamera | null
}

function keyFor(actorId: string, engagementId: string): string {
  return `${PREFIX}${encodeURIComponent(actorId)}.${encodeURIComponent(engagementId)}`
}

function isCamera(value: unknown): value is SavedCamera {
  if (typeof value !== 'object' || value === null) return false
  const camera = value as Record<string, unknown>
  return Number.isFinite(camera.zoom) && Number.isFinite(camera.x) && Number.isFinite(camera.y)
}

function parse(raw: string): SavedView | null {
  if (!raw.startsWith('{')) return { assetId: raw, camera: null }
  try {
    const value = JSON.parse(raw) as { assetId?: unknown; camera?: unknown }
    if (typeof value.assetId !== 'string' || value.assetId === '') return null
    return { assetId: value.assetId, camera: isCamera(value.camera) ? value.camera : null }
  } catch {
    return null
  }
}

export function loadSavedView(actorId: string | null, engagementId: string): SavedView | null {
  if (!actorId) return null
  try {
    const raw = globalThis.localStorage?.getItem(keyFor(actorId, engagementId))
    return raw ? parse(raw) : null
  } catch {
    return null
  }
}

export function loadSavedSelection(actorId: string | null, engagementId: string): string | null {
  return loadSavedView(actorId, engagementId)?.assetId ?? null
}

export function saveSelection(actorId: string | null, engagementId: string, assetId: string, camera: SavedCamera | null = null): void {
  if (!actorId) return
  try {
    globalThis.localStorage?.setItem(keyFor(actorId, engagementId), JSON.stringify({ assetId, camera }))
  } catch {
    // Storage is unavailable (private window, blocked site data): the map still works without a saved view.
  }
}
