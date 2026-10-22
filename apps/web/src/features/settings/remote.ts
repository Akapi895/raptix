import type { ServiceResult } from '../../domain/service'
import type { Audit } from '../../domain/entities'
import type { AuditQuery, AuditRead, SettingsService } from './service'
import { fetchWorkspaceAudit, type AuditEntryView } from '../audit/api';
import { fetchWorkspaceSettings, saveWorkspaceSetting as writeWorkspaceSetting } from './api';
import { guarded } from '../../platform/adapter-shared'
import { unavailable } from '../../platform/adapter-stub'

/**
 * Named exclusions of the settings port in real mode. Each names what the
 * deployment does not model, so the shared page shows the reason where the
 * control would be, never an empty registry that reads as "none".
 */
const NOT_MODELLED = {
  profile: 'The organization profile is not a record in this deployment. The trusted identity is shown on the Profile section.',
  members: 'Organization-level members are not modelled here. Memberships are engagement-scoped and managed on each project Team tab.',
  integrations: 'The integration registry is not modelled in this deployment. Connection and key management are unavailable.',
  policies: 'Policies are numeric workspace settings in this deployment and are edited in the Policies section.',
  retention: 'Retention is a numeric workspace setting in this deployment and is edited in the Retention section.',
  holds: 'Legal holds and data deletion are not modelled; retention is configuration only in this deployment.',
  write: 'This change is not available in this deployment.',
} as const

function toAudit(entry: AuditEntryView): Audit {
  return {
    id: entry.id,
    at: entry.createdAt,
    actor: entry.actorId ?? '',
    role: '',
    action: entry.action,
    obj: entry.targetId ?? '',
    projectId: entry.engagementId ?? '',
    result: 'Recorded',
    reason: entry.reason ?? '',
  }
}

const unmodelled = <T>(message: string): Promise<ServiceResult<T>> => unavailable<T>(message)

export function createRealSettingsService(): SettingsService {
  return {
    getProfile: () => unmodelled(NOT_MODELLED.profile),
    getMembers: () => unmodelled(NOT_MODELLED.members),
    updateProfile: () => unmodelled(NOT_MODELLED.profile),
    setMemberRole: () => unmodelled(NOT_MODELLED.members),
    setMemberStatus: () => unmodelled(NOT_MODELLED.members),
    inviteMember: () => unmodelled(NOT_MODELLED.members),
    getIntegrations: () => unmodelled(NOT_MODELLED.integrations),
    getPolicies: () => unmodelled(NOT_MODELLED.policies),
    setIntegrationConnection: () => unmodelled(NOT_MODELLED.integrations),
    updateIntegrationKey: () => unmodelled(NOT_MODELLED.integrations),
    setPolicyEnabled: () => unmodelled(NOT_MODELLED.policies),
    getRetention: () => unmodelled(NOT_MODELLED.retention),
    getAudit: (_ctx, query: AuditQuery) => guarded(async (): Promise<ServiceResult<AuditRead>> => {
      // The workspace audit filters by action prefix, actor and free text; the other filters have no backend field.
      const view = await fetchWorkspaceAudit({ action: query.action || undefined, actor: query.actor || undefined, q: query.q || undefined })
      return {
        ok: true,
        data: {
          items: view.entries.map(toAudit),
          total: view.total,
          options: { actors: view.actors, actions: view.actions, results: ['Recorded'], corrs: [] },
          canExport: false,
        },
      }
    }),
    updateRetention: () => unmodelled(NOT_MODELLED.write),
    setRetentionHold: () => unmodelled(NOT_MODELLED.holds),
    deleteRetentionData: () => unmodelled(NOT_MODELLED.holds),
    getWorkspaceSettings: () => guarded(async () => {
      const view = await fetchWorkspaceSettings()
      return { ok: true, data: { settings: view.settings } }
    }),
    saveWorkspaceSetting: (_ctx, key, input) => guarded(async () => ({ ok: true, data: await writeWorkspaceSetting(key, input) })),
  }
}
