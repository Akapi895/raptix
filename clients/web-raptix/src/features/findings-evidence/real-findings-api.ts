/**
 * W12 real findings/artifacts API: new-server only, no legacy imports.
 * Every response is validated with the shared contract guards before use.
 */
import { isArtifactContentView, isArtifactsView, isFindingsView } from '@raptix/web-contracts'
import { apiBaseUrl } from '../../app/config'
import { ApiInvalidResponseError } from '../../shared/api/errors'
import { requestJson } from '../../shared/api/http'
import type { ArtifactContentView, ArtifactsView, FindingsView } from '@raptix/web-contracts'

const engagementPath = (engagementId: string): string => `/engagements/${encodeURIComponent(engagementId)}`

export async function loadFindings(engagementId: string, signal: AbortSignal): Promise<FindingsView> {
  const view: unknown = await requestJson(apiBaseUrl, `${engagementPath(engagementId)}/findings`, { signal, retries: 1 })
  if (!isFindingsView(view) || view.engagementId !== engagementId) throw new ApiInvalidResponseError('Findings did not match this engagement')
  return view
}

export async function loadArtifacts(engagementId: string, signal: AbortSignal): Promise<ArtifactsView> {
  const view: unknown = await requestJson(apiBaseUrl, `${engagementPath(engagementId)}/artifacts`, { signal, retries: 1 })
  if (!isArtifactsView(view) || view.engagementId !== engagementId) throw new ApiInvalidResponseError('Artifacts did not match this engagement')
  return view
}

export async function loadArtifactContent(engagementId: string, path: string, signal: AbortSignal): Promise<ArtifactContentView> {
  const view: unknown = await requestJson(apiBaseUrl, `${engagementPath(engagementId)}/artifacts/content?path=${encodeURIComponent(path)}`, { signal, retries: 1 })
  if (!isArtifactContentView(view) || view.engagementId !== engagementId || view.path !== path) throw new ApiInvalidResponseError('Artifact content did not match this engagement/path')
  return view
}
