import { isPlanningView, isDocumentSourceView, type PlanningView, type DocumentSourceView } from '@raptix/web-contracts';
import { apiFetch } from '../../platform/transport';

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Planning documents (ticket 04) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
export function fetchPlanning(engagementId: string): Promise<PlanningView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/plan-docs`, owned(engagementId, isPlanningView))
}

/* ─────────── Plan document drafts (O06, ADR-0083) ─────────── */
export function fetchDocumentSource(engagementId: string, name: string): Promise<DocumentSourceView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/documents/${encodeURIComponent(name)}`, owned(engagementId, isDocumentSourceView))
}

export function saveDocumentDraft(engagementId: string, name: string, input: { body: string; baseDigest: string | null }): Promise<DocumentSourceView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/documents/${encodeURIComponent(name)}/draft`, owned(engagementId, isDocumentSourceView), { method: 'PUT', body: input })
}

export function publishDocumentDraft(engagementId: string, name: string, input: { body: string; baseDigest: string | null }): Promise<{ name: string; digest: string; updatedAt: string }> {
  return apiFetch(
    `/engagements/${encodeURIComponent(engagementId)}/documents/${encodeURIComponent(name)}/publish`,
    (v): v is { name: string; digest: string; updatedAt: string } =>
      typeof v === 'object' && v !== null && (v as Record<string, unknown>).name === name &&
      typeof (v as Record<string, unknown>).digest === 'string' && typeof (v as Record<string, unknown>).updatedAt === 'string',
    { method: 'POST', body: input },
  )
}

export function discardDocumentDraft(engagementId: string, name: string): Promise<{ discarded: boolean }> {
  return apiFetch(
    `/engagements/${encodeURIComponent(engagementId)}/documents/${encodeURIComponent(name)}/draft`,
    (v): v is { discarded: boolean } => typeof v === 'object' && v !== null && typeof (v as Record<string, unknown>).discarded === 'boolean',
    { method: 'DELETE' },
  )
}

export function owned<T extends { engagementId: string }>(id: string, guard: (v: unknown) => v is T): (v: unknown) => v is T {
  return (v): v is T => guard(v) && v.engagementId === id
}
