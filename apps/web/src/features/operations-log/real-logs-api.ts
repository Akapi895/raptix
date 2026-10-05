/**
 * W14 operations-log API: new-server only. The merged timeline is validated
 * with the shared contract guards before use; every entry carries an explicit
 * `source` label so runtime events, checkpoint transcripts and workspace
 * artifact markers are never conflated.
 */
import { isTimelineView } from '@raptix/web-contracts'
import type { TimelineView } from '@raptix/web-contracts'
import { apiBaseUrl } from '../../app/config'
import { ApiInvalidResponseError } from '../../shared/api/errors'
import { requestJson } from '../../shared/api/http'

export async function loadTimeline(engagementId: string, signal: AbortSignal): Promise<TimelineView> {
  const view: unknown = await requestJson(apiBaseUrl, `/engagements/${encodeURIComponent(engagementId)}/timeline`, { signal, retries: 1 })
  if (!isTimelineView(view) || view.engagementId !== engagementId) throw new ApiInvalidResponseError('Operations timeline did not match this engagement')
  return view
}
