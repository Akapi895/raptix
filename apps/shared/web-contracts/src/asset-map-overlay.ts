/**
 * Work and findings on one asset (plan phase 6). A finding counts for an asset only when its owning
 * record names that asset; findings without such a reference are reported as unlinked, never guessed
 * from their text, their hostname or the latest run.
 */
import { isAssetMapAssetRef, type AssetMapAssetRef } from './asset-map.js'
import { isNonEmptyString, isRecord } from './guards.js'

export interface AssetMapOverlayFinding {
  id: string
  title: string
  severity: string
  status: string
}

export interface AssetMapOverlay {
  engagementId: string
  asset: AssetMapAssetRef
  linked: {
    total: number
    byStatus: Record<string, number>
    items: AssetMapOverlayFinding[]
  }
  /** Findings of this engagement that name no catalogued asset: shown as unknown attribution. */
  unlinkedFindings: number
}

function isOverlayFinding(v: unknown): v is AssetMapOverlayFinding {
  return isRecord(v) && isNonEmptyString(v.id) && typeof v.title === 'string' && typeof v.severity === 'string' && typeof v.status === 'string'
}

export function isAssetMapOverlay(v: unknown): v is AssetMapOverlay {
  return (
    isRecord(v) &&
    isNonEmptyString(v.engagementId) &&
    isAssetMapAssetRef(v.asset) &&
    isRecord(v.linked) &&
    typeof v.linked.total === 'number' &&
    isRecord(v.linked.byStatus) &&
    Object.values(v.linked.byStatus).every(count => typeof count === 'number') &&
    Array.isArray(v.linked.items) &&
    v.linked.items.every(isOverlayFinding) &&
    typeof v.unlinkedFindings === 'number'
  )
}
