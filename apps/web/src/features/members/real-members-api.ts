/**
 * W19 real members API: reads the truthful single-user members view. There
 * is deliberately no invite/role mutation helper — those APIs do not exist
 * server-side and the view states the reason.
 */
import { isMembersView } from '@raptix/web-contracts'
import type { MembersView } from '@raptix/web-contracts'
import { ApiInvalidResponseError } from '../../shared/api/errors'
import { requestJson, encodePathSegment } from '../../shared/api/http'
import { apiBaseUrl } from '../../app/config'

export async function loadMembers(engagementId: string, signal: AbortSignal): Promise<MembersView> {
  const view = await requestJson<unknown>(apiBaseUrl, `/engagements/${encodePathSegment(engagementId)}/members`, { signal })
  if (!isMembersView(view) || view.engagementId !== engagementId) {
    throw new ApiInvalidResponseError('Members view did not match this engagement')
  }
  return view
}
