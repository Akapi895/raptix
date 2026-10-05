/**
 * W13 real graph/assets API: new-server only. Every response is validated with
 * the shared contract guards before use; the server has already redacted
 * credential-like properties before the response, so the browser never sees
 * raw graph secrets.
 */
import { isAssetsView, isGraphView } from '@raptix/web-contracts'
import { apiBaseUrl } from '../../app/config'
import { ApiInvalidResponseError } from '../../shared/api/errors'
import { requestJson } from '../../shared/api/http'
import type { AssetsView, GraphView } from '@raptix/web-contracts'

const engagementPath = (engagementId: string): string => `/engagements/${encodeURIComponent(engagementId)}`

export async function loadGraph(engagementId: string, signal: AbortSignal): Promise<GraphView> {
  const view: unknown = await requestJson(apiBaseUrl, `${engagementPath(engagementId)}/graph`, { signal, retries: 1 })
  if (!isGraphView(view) || view.engagementId !== engagementId) throw new ApiInvalidResponseError('Graph did not match this engagement')
  return view
}

export async function loadAssets(engagementId: string, signal: AbortSignal): Promise<AssetsView> {
  const view: unknown = await requestJson(apiBaseUrl, `${engagementPath(engagementId)}/assets`, { signal, retries: 1 })
  if (!isAssetsView(view) || view.engagementId !== engagementId) throw new ApiInvalidResponseError('Assets did not match this engagement')
  return view
}
