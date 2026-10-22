import { isVaultView, isVaultRevealView, type VaultView, type VaultSecretView, type VaultRevealView } from '@raptix/web-contracts';
import { apiFetch } from '../../platform/transport';
import { owned } from '../planning/remote';

export function fetchVault(engagementId: string): Promise<VaultView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/vault/secrets`, owned(engagementId, isVaultView))
}

export interface CreateVaultSecretInput { kind: string; label: string; plaintext: string }

export function createVaultSecret(engagementId: string, input: CreateVaultSecretInput): Promise<VaultSecretView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/vault/secrets`, (v): v is VaultSecretView =>
    typeof v === 'object' && v !== null && typeof (v as VaultSecretView).id === 'string' && typeof (v as VaultSecretView).revealCount === 'number',
  { method: 'POST', body: input })
}

export function revealVaultSecret(engagementId: string, secretId: string): Promise<VaultRevealView> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/vault/secrets/${encodeURIComponent(secretId)}/reveal`, isVaultRevealView, { method: 'POST', body: {} })
}

export function revokeVaultSecret(engagementId: string, secretId: string): Promise<{ ok: true }> {
  return apiFetch(`/engagements/${encodeURIComponent(engagementId)}/vault/secrets/${encodeURIComponent(secretId)}`, (v): v is { ok: true } =>
    typeof v === 'object' && v !== null && (v as { ok?: unknown }).ok === true,
  { method: 'DELETE' })
}
