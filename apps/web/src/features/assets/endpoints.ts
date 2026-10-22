import { isAssetsView, type AssetsView } from '@raptix/web-contracts';
import { apiFetch } from '../../platform/transport';
import { owned } from '../planning/remote';

export function fetchAssets(engagementId: string): Promise<AssetsView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/assets`, owned(engagementId, isAssetsView))
}

export interface AssetInventoryView {
  engagementId: string
  assets: { id: string; engagementId: string; identifier: string; kind: string; classification: 'pending' | 'in_scope' | 'out_of_scope'; observed: boolean; version: number; updatedAt: string }[]
  latestApprovedVersion: number | null
  source: 'db'
}

export function isAssetInventoryView(v: unknown): v is AssetInventoryView {
  if (typeof v !== 'object' || v === null) return false
  const doc = v as AssetInventoryView
  return typeof doc.engagementId === 'string' && Array.isArray(doc.assets) && doc.source === 'db'
}

export function fetchAssetInventory(engagementId: string): Promise<AssetInventoryView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/assets/inventory`, owned(engagementId, isAssetInventoryView))
}

export function importAssets(engagementId: string, identifiers: string[], kind: 'host' | 'web_url' | 'ip_range'): Promise<{ imported: number; skipped: number }> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/assets/inventory/import`, (v): v is { imported: number; skipped: number } =>
    typeof v === 'object' && v !== null && typeof (v as { imported?: unknown }).imported === 'number',
  { method: 'POST', body: { identifiers, kind } })
}

export function classifyAsset(engagementId: string, assetId: string, classification: 'in_scope' | 'out_of_scope' | 'pending', expectedVersion?: number): Promise<unknown> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/assets/inventory/${encodeURIComponent(assetId)}`, (v): v is { ok: true } =>
    typeof v === 'object' && v !== null && (v as { ok?: unknown }).ok === true,
  { method: 'PATCH', body: { classification, ...(expectedVersion === undefined ? {} : { expectedVersion }) } })
}
