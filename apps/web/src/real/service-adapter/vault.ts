import type { RequestContext, ServiceResult } from '../../domain/service'
import type { VaultRead, VaultRevealed, VaultSecretMeta, VaultService } from '../../features/vault/service'
import type { VaultSecretView } from '@raptix/web-contracts'
import { createVaultSecret, fetchVault, revealVaultSecret, revokeVaultSecret } from '../../features/vault/remote';
import { guarded } from '../../platform/adapter-shared'

const NO_ENGAGEMENT = { kind: 'validation' as const, message: 'Select an engagement before reading its vault.' }

/** Metadata only: the plaintext never crosses the list or the store response. */
function toMeta(view: VaultSecretView): VaultSecretMeta {
  return {
    id: view.id,
    projectId: view.engagementId,
    kind: view.kind,
    label: view.label,
    revealCount: view.revealCount,
    lastRevealedAt: view.lastRevealedAt ?? undefined,
    createdAt: view.createdAt,
    createdBy: view.createdBy,
  }
}

export function createRealVaultService(): VaultService {
  const engagementOf = (ctx: RequestContext): string | null => (ctx.projectId && ctx.projectId !== 'all' ? ctx.projectId : null)
  return {
    list: (ctx) => guarded(async (): Promise<ServiceResult<VaultRead>> => {
      const engagementId = engagementOf(ctx)
      if (engagementId === null) return { ok: false, failure: NO_ENGAGEMENT }
      const view = await fetchVault(engagementId)
      // The server refuses what the role may not do; the console offers the controls and shows the refusal it returns.
      return { ok: true, data: { secrets: view.secrets.map(toMeta), truncated: view.truncated, canReveal: true, revealReason: null, canManage: true, manageReason: null } }
    }),
    reveal: (ctx, secretId) => guarded(async (): Promise<ServiceResult<VaultRevealed>> => {
      const engagementId = engagementOf(ctx)
      if (engagementId === null) return { ok: false, failure: NO_ENGAGEMENT }
      const view = await revealVaultSecret(engagementId, secretId)
      return { ok: true, data: { secretId: view.secretId, plaintext: view.plaintext, revealedAt: view.revealedAt } }
    }),
    store: (ctx, input) => guarded(async () => {
      const engagementId = engagementOf(ctx)
      if (engagementId === null) return { ok: false, failure: NO_ENGAGEMENT }
      return { ok: true, data: toMeta(await createVaultSecret(engagementId, input)) }
    }),
    revoke: (ctx, secretId) => guarded(async () => {
      const engagementId = engagementOf(ctx)
      if (engagementId === null) return { ok: false, failure: NO_ENGAGEMENT }
      return { ok: true, data: await revokeVaultSecret(engagementId, secretId) }
    }),
  }
}
