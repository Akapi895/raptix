/**
 * Mock adapter for the vault port (plan P09, Vault slice). Wraps the mock
 * vault transactions: list is metadata only, reveal returns the seeded demo
 * value once and audits it, store and revoke publish their audit rows.
 */
import { can, ROLE_LABEL } from '../../auth/policy'
import type { DbAuthority } from '../../domain/database'
import type { RequestContext, ServiceResult } from '../../domain/service'
import { createVaultSecret, listVaultSecrets, revealVaultSecret, revokeVaultSecret, type VaultRead, type VaultRevealed, type VaultService } from './service'

export function createMockVaultService(authority: DbAuthority, guard: <T>(produce: () => ServiceResult<T>) => Promise<ServiceResult<T>>): VaultService {
  return {
    list: (ctx: RequestContext) => guard((): ServiceResult<VaultRead> => {
      const listed = listVaultSecrets(authority, ctx)
      if (!listed.ok) return listed
      const project = authority.snapshot().projects.find((x) => x.id === ctx.projectId)
      const canReveal = !!project && can(ctx.actor, 'viewSensitive', project)
      const canManage = !!project && can(ctx.actor, 'editScope', project)
      const role = ROLE_LABEL[ctx.actor.role]
      return {
        ok: true,
        data: {
          secrets: listed.data,
          truncated: false,
          canReveal,
          revealReason: canReveal ? null : `The ${role} role cannot reveal secrets.`,
          canManage,
          manageReason: canManage ? null : 'Only a Red Team Manager or Organization Admin can store or revoke secrets.',
        },
      }
    }),
    reveal: (ctx: RequestContext, secretId: string) => guard((): ServiceResult<VaultRevealed> => {
      const revealed = revealVaultSecret(authority, ctx, secretId)
      return revealed.ok ? { ok: true, data: { secretId: revealed.data.secretId, plaintext: revealed.data.plaintext, revealedAt: null } } : revealed
    }),
    store: (ctx, input) => guard(() => createVaultSecret(authority, ctx, input)),
    revoke: (ctx, secretId) => guard(() => revokeVaultSecret(authority, ctx, secretId)),
  }
}
