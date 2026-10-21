import { apiFetch } from '../../platform/transport';

/* ───────────── Workspace settings, audit and vault (integration ticket 16) ───────────── */
export interface WorkspaceSettingView {
  key: string
  kind: string
  value: number
  version: number
  updatedBy: string | null
  updatedAt: string | null
  consumer: string | null
  enforcement: string
  description: string
}

export interface WorkspaceSettingsView {
  settings: WorkspaceSettingView[]
  source: 'db'
}

export function isWorkspaceSettingsView(v: unknown): v is WorkspaceSettingsView {
  if (typeof v !== 'object' || v === null) return false
  const doc = v as WorkspaceSettingsView
  return Array.isArray(doc.settings) && doc.settings.every((s) => typeof s.key === 'string' && typeof s.value === 'number' && typeof s.version === 'number') && doc.source === 'db'
}

export function fetchWorkspaceSettings(): Promise<WorkspaceSettingsView> {
  return apiFetch('/workspace/settings', isWorkspaceSettingsView)
}

export interface SaveSettingInput { value: number; expectedVersion: number; reason: string }

export function saveWorkspaceSetting(key: string, input: SaveSettingInput): Promise<WorkspaceSettingView> {
  return apiFetch(`/workspace/settings/${encodeURIComponent(key)}`, (v): v is WorkspaceSettingView =>
    typeof v === 'object' && v !== null && typeof (v as WorkspaceSettingView).key === 'string' && typeof (v as WorkspaceSettingView).version === 'number',
  { method: 'PUT', body: input })
}
