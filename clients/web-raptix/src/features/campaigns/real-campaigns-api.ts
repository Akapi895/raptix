/**
 * W17 real campaigns API: hits the new server's scoped campaign endpoints.
 * Drafts, prepared manifests and job outcomes are persisted server-side.
 */
import { isCampaignJobView, isCampaignView, isCampaignsView, isCampaignProviderCapabilities } from '@raptix/web-contracts'
import type { CampaignJobView, CampaignVector, CampaignView, CampaignsView, CampaignProviderCapabilities } from '@raptix/web-contracts'
import { ApiInvalidResponseError } from '../../shared/api/errors'
import { requestJson } from '../../shared/api/http'
import { apiBaseUrl } from '../../app/config'
import { encodePathSegment } from '../../shared/api/http'

export const CAMPAIGN_VECTOR_OPTIONS = ['phishing', 'web', 'mobile'] as const

export interface CampaignDraftInput {
  name: string
  vector: CampaignVector
  scenario?: string
  gophish?: { templateId: number; pageId: number; groupId: number; smtpId: number }
  evilginx?: { profile: 'lab' }
}

export async function campaignProviderCapabilities(engagementId: string, signal: AbortSignal): Promise<CampaignProviderCapabilities> {
  const view = await requestJson<unknown>(apiBaseUrl, `/engagements/${encodePathSegment(engagementId)}/campaigns/capabilities`, { signal })
  if (!isCampaignProviderCapabilities(view) || view.engagementId !== engagementId) throw new ApiInvalidResponseError('Campaign capabilities did not match this engagement')
  return view
}

export async function listCampaigns(engagementId: string, signal: AbortSignal): Promise<CampaignsView> {
  const view = await requestJson<unknown>(apiBaseUrl, `/engagements/${encodePathSegment(engagementId)}/campaigns`, { signal })
  if (!isCampaignsView(view) || view.engagementId !== engagementId) {
    throw new ApiInvalidResponseError('Campaign list did not match this engagement')
  }
  return view
}

export async function createCampaign(engagementId: string, input: CampaignDraftInput, signal: AbortSignal): Promise<CampaignView> {
  const view = await requestJson<unknown>(apiBaseUrl, `/engagements/${encodePathSegment(engagementId)}/campaigns`, { method: 'POST', body: input, signal, timeoutMs: 15_000 })
  if (!isCampaignView(view) || view.engagementId !== engagementId) {
    throw new ApiInvalidResponseError('Created campaign did not match this engagement')
  }
  return view
}

export async function runCampaignJob(engagementId: string, campaignId: string, kind: 'generate' | 'deploy', signal: AbortSignal, request?: { requestId: string; version: number }): Promise<CampaignJobView> {
  const view = await requestJson<unknown>(apiBaseUrl, `/engagements/${encodePathSegment(engagementId)}/campaigns/${encodePathSegment(campaignId)}/${kind}`, { method: 'POST', body: request, signal, timeoutMs: 15_000 })
  if (!isCampaignJobView(view) || view.campaignId !== campaignId) {
    throw new ApiInvalidResponseError('Campaign job response did not match the requested campaign')
  }
  return view
}

export async function reconcileCampaignJob(engagementId: string, campaignId: string, jobId: string, signal: AbortSignal): Promise<CampaignJobView> {
  const view = await requestJson<unknown>(apiBaseUrl, `/engagements/${encodePathSegment(engagementId)}/campaigns/${encodePathSegment(campaignId)}/jobs/${encodePathSegment(jobId)}/reconcile`, { method: 'POST', signal })
  if (!isCampaignJobView(view) || view.id !== jobId || view.campaignId !== campaignId) throw new ApiInvalidResponseError('Reconciled job did not match this campaign')
  return view
}
