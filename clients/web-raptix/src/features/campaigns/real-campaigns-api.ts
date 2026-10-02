/**
 * W17 real campaigns API: hits the new server's scoped campaign endpoints.
 * Drafts and job history are persisted server-side; generate/deploy return
 * the durable job whose status honestly reports the absent provider — the
 * UI can therefore never claim a Generated/Delivered outcome.
 */
import { isCampaignJobView, isCampaignView, isCampaignsView } from '@raptix/web-contracts'
import type { CampaignJobView, CampaignVector, CampaignView, CampaignsView } from '@raptix/web-contracts'
import { ApiInvalidResponseError } from '../../shared/api/errors'
import { requestJson } from '../../shared/api/http'
import { apiBaseUrl } from '../../app/config'
import { encodePathSegment } from '../../shared/api/http'

export const CAMPAIGN_VECTOR_OPTIONS = ['phishing', 'web', 'mobile'] as const

export interface CampaignDraftInput {
  name: string
  vector: CampaignVector
  scenario?: string
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

export async function runCampaignJob(engagementId: string, campaignId: string, kind: 'generate' | 'deploy', signal: AbortSignal): Promise<CampaignJobView> {
  const view = await requestJson<unknown>(apiBaseUrl, `/engagements/${encodePathSegment(engagementId)}/campaigns/${encodePathSegment(campaignId)}/${kind}`, { method: 'POST', signal, timeoutMs: 15_000 })
  if (!isCampaignJobView(view) || view.campaignId !== campaignId) {
    throw new ApiInvalidResponseError('Campaign job response did not match the requested campaign')
  }
  return view
}
