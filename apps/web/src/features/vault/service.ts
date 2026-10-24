import type { VaultSecret } from '../../domain/entities'
import type { RequestContext, ServiceResult } from '../../domain/service'

/** List-safe metadata projection; never carries the demo plaintext. */
export type VaultSecretMeta = Omit<VaultSecret, 'demoPlaintext'>

/** Vault port (plan P09, Vault slice): list, reveal, store and revoke for one engagement. */
export interface VaultRead {
  secrets: VaultSecretMeta[]
  truncated: boolean
  /** Whether this actor may reveal a value or revoke a secret; the reason is shown where the control would be. */
  canReveal: boolean
  revealReason: string | null
  canManage: boolean
  manageReason: string | null
}

export interface VaultRevealed { secretId: string; plaintext: string; revealedAt: string | null }

export interface VaultService {
  list(ctx: RequestContext): Promise<ServiceResult<VaultRead>>
  reveal(ctx: RequestContext, secretId: string): Promise<ServiceResult<VaultRevealed>>
  store(ctx: RequestContext, input: { kind: string; label: string; plaintext: string }): Promise<ServiceResult<VaultSecretMeta>>
  revoke(ctx: RequestContext, secretId: string): Promise<ServiceResult<{ ok: true }>>
}
