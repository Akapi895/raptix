/**
 * W15 settings API: the persisted settings view plus the validated save path.
 * Saving PATCHes the existing engagement route (same lifecycle policy) and the
 * caller reloads the GET view afterwards, so the UI only ever shows
 * server-acknowledged state.
 */
import { isEngagementSettingsView } from '@raptix/web-contracts'
import type { EngagementSettingsView } from '@raptix/web-contracts'
import { apiBaseUrl } from '../../app/config'
import { ApiInvalidResponseError } from '../../shared/api/errors'
import { requestJson } from '../../shared/api/http'

const engagementPath = (engagementId: string): string => `/engagements/${encodeURIComponent(engagementId)}`

export interface SettingsPatch {
  displayName?: string
  targetType?: string
  targetValue?: string
}

export async function loadSettings(engagementId: string, signal: AbortSignal): Promise<EngagementSettingsView> {
  const view: unknown = await requestJson(apiBaseUrl, `${engagementPath(engagementId)}/settings`, { signal, retries: 1 })
  if (!isEngagementSettingsView(view) || view.engagementId !== engagementId) throw new ApiInvalidResponseError('Settings did not match this engagement')
  return view
}

export async function saveSettings(engagementId: string, patch: SettingsPatch, signal: AbortSignal): Promise<void> {
  const body: unknown = { ...patch }
  const view: unknown = await requestJson(apiBaseUrl, engagementPath(engagementId), { method: 'PATCH', body, signal })
  if (typeof view !== 'object' || view === null || (view as { id?: unknown }).id !== engagementId) {
    throw new ApiInvalidResponseError('Save response did not match this engagement')
  }
}

export async function deleteEngagement(engagementId: string, signal: AbortSignal): Promise<{ workspaceRetained: boolean }> {
  const view: unknown = await requestJson(apiBaseUrl, engagementPath(engagementId), { method: 'DELETE', signal })
  if (typeof view !== 'object' || view === null || (view as { ok?: unknown }).ok !== true) {
    throw new ApiInvalidResponseError('Delete response was not acknowledged')
  }
  return { workspaceRetained: (view as { workspaceRetained?: unknown }).workspaceRetained === true }
}
