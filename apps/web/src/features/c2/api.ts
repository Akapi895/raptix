import { type C2View, type C2CommandView, type CampaignProviderCapabilities, type CampaignsView, type CampaignView, type CampaignJobView, type CampaignVector, isC2View, isC2Listener, isC2Profile, isC2CommandView, isCampaignProviderCapabilities, isCampaignsView, isCampaignView, isCampaignJobView } from '@raptix/web-contracts';
import { apiFetch } from '../../platform/transport';
import { owned } from '../../platform/ownership';

export interface C2GrantView {
  id: string
  engagementId: string
  sessionId: string
  actorId: string
  reviewerId: string | null
  status: 'requested' | 'approved' | 'rejected' | 'revoked' | 'expired'
  reason: string
  commandPrefix: string | null
  expiresAt: string
  createdAt: string
}

export interface C2GrantsView {
  engagementId: string
  grants: C2GrantView[]
  /** W14: effective enforced bounds from the server — never a hard-coded clamp. */
  minGrantHours: number
  maxGrantHours: number
  source: 'db'
}

export function isC2GrantsView(v: unknown): v is C2GrantsView {
  if (typeof v !== 'object' || v === null) return false
  const doc = v as C2GrantsView
  return typeof doc.engagementId === 'string' && Array.isArray(doc.grants) && doc.source === 'db'
}

export function fetchC2Grants(engagementId: string): Promise<C2GrantsView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/c2/grants`, owned(engagementId, isC2GrantsView))
}

export function requestC2Grant(engagementId: string, input: { sessionId: string; reason: string; expiresAt: string }): Promise<C2GrantView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/c2/grants`, (v): v is C2GrantView =>
    typeof v === 'object' && v !== null && typeof (v as C2GrantView).id === 'string' && (v as C2GrantView).status === 'requested',
  { method: 'POST', body: input })
}

export function decideC2Grant(engagementId: string, grantId: string, decision: 'approved' | 'rejected' | 'revoked'): Promise<C2GrantView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/c2/grants/${encodeURIComponent(grantId)}/decision`, (v): v is C2GrantView =>
    typeof v === 'object' && v !== null && typeof (v as C2GrantView).status === 'string',
  { method: 'POST', body: { decision } })
}

/* ───────────── C2 provider console (integration ticket 12): real sessions and the durable command audit ───────────── */
export function fetchC2Sessions(engagementId: string): Promise<C2View> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/c2/sessions`, (v): v is C2View =>
    isC2View(v) && v.engagementId === engagementId)
}

export function dispatchC2Command(engagementId: string, sessionId: string, input: { requestId: string; path: string; args: string[] }): Promise<C2CommandView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/c2/sessions/${encodeURIComponent(sessionId)}/commands`, isC2CommandView,
    { method: 'POST', body: input })
}

export function fetchC2Commands(engagementId: string): Promise<C2CommandView[]> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/c2/commands`, (v): v is C2CommandView[] =>
    Array.isArray(v) && v.every(isC2CommandView))
}

export function reconcileC2Command(engagementId: string, commandId: string): Promise<C2CommandView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/c2/commands/${encodeURIComponent(commandId)}/reconcile`, isC2CommandView,
    { method: 'POST', body: {} })
}

/* W15: real provider management — listeners and lab profiles, per the provider contract. */
export function configureC2Listener(engagementId: string, protocol: 'mtls' | 'http'): Promise<Record<string, unknown>> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/c2/listeners`, (v): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && isC2Listener((v as { listener?: unknown }).listener),
  { method: 'POST', body: { protocol } })
}

export function configureC2Profile(engagementId: string, name: string): Promise<Record<string, unknown>> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/c2/profiles`, (v): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && isC2Profile((v as { profile?: unknown }).profile),
  { method: 'POST', body: { name } })
}

export function stopC2Listener(engagementId: string, jobId: number): Promise<Record<string, unknown>> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/c2/listeners/${encodeURIComponent(String(jobId))}`, (v): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null,
  { method: 'DELETE' })
}

/* ───────────── Campaign drafts and provider jobs (integration ticket 12, D5 placement) ───────────── */
export function fetchCampaignCapabilities(engagementId: string): Promise<CampaignProviderCapabilities> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/campaigns/capabilities`, (v): v is CampaignProviderCapabilities =>
    isCampaignProviderCapabilities(v) && v.engagementId === engagementId)
}

export function fetchCampaigns(engagementId: string): Promise<CampaignsView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/campaigns`, (v): v is CampaignsView =>
    isCampaignsView(v) && v.engagementId === engagementId)
}

export interface GoPhishAssetsInput { templateId: number; pageId: number; groupId: number; smtpId: number }

export function createCampaign(engagementId: string, input: { name: string; vector: CampaignVector; scenario?: string; gophish?: GoPhishAssetsInput; evilginxLab?: boolean }): Promise<CampaignView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/campaigns`, (v): v is CampaignView =>
    isCampaignView(v) && v.status === 'draft',
    {
      method: 'POST',
      body: {
        name: input.name,
        vector: input.vector,
        ...(input.scenario !== undefined ? { scenario: input.scenario } : {}),
        ...(input.gophish !== undefined ? { gophish: input.gophish } : {}),
        ...(input.evilginxLab === true ? { evilginx: { profile: 'lab' } } : {}),
      },
    })
}

export function runCampaignJob(engagementId: string, campaignId: string, kind: 'generate' | 'deploy', intent: { requestId: string; version: number }): Promise<CampaignJobView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/campaigns/${encodeURIComponent(campaignId)}/${kind}`, isCampaignJobView,
    { method: 'POST', body: intent })
}

export function reconcileCampaignJob(engagementId: string, campaignId: string, jobId: string): Promise<CampaignJobView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/campaigns/${encodeURIComponent(campaignId)}/jobs/${encodeURIComponent(jobId)}/reconcile`, isCampaignJobView,
    { method: 'POST', body: {} })
}
