/**
 * W18 real vault API: hits the new server's scoped vault endpoints. The
 * metadata list is redacted by the server (no ciphertext, no plaintext);
 * plaintext exists only in the explicit reveal response and is never
 * persisted client-side.
 */
import { isVaultRevealView, isVaultSecretView, isVaultView } from '@raptix/web-contracts'
import type { VaultRevealView, VaultSecretView, VaultView } from '@raptix/web-contracts'
import { ApiInvalidResponseError } from '../../shared/api/errors'
import { requestJson, encodePathSegment } from '../../shared/api/http'
import { apiBaseUrl } from '../../app/config'

export interface VaultSecretInput {
  kind: string
  label: string
  plaintext: string
}

export async function listVaultSecrets(engagementId: string, signal: AbortSignal): Promise<VaultView> {
  const view = await requestJson<unknown>(apiBaseUrl, `/engagements/${encodePathSegment(engagementId)}/vault/secrets`, { signal })
  if (!isVaultView(view) || view.engagementId !== engagementId) {
    throw new ApiInvalidResponseError('Vault metadata did not match this engagement')
  }
  return view
}

export async function createVaultSecret(engagementId: string, input: VaultSecretInput, signal: AbortSignal): Promise<VaultSecretView> {
  const view = await requestJson<unknown>(apiBaseUrl, `/engagements/${encodePathSegment(engagementId)}/vault/secrets`, { method: 'POST', body: input, signal, timeoutMs: 15_000 })
  if (!isVaultSecretView(view) || view.engagementId !== engagementId) {
    throw new ApiInvalidResponseError('Created vault secret did not match this engagement')
  }
  return view
}

export async function revealVaultSecret(engagementId: string, secretId: string, signal: AbortSignal): Promise<VaultRevealView> {
  const view = await requestJson<unknown>(apiBaseUrl, `/engagements/${encodePathSegment(engagementId)}/vault/secrets/${encodePathSegment(secretId)}/reveal`, { method: 'POST', signal, timeoutMs: 15_000 })
  if (!isVaultRevealView(view) || view.secretId !== secretId || view.engagementId !== engagementId) {
    throw new ApiInvalidResponseError('Vault reveal did not match the requested secret')
  }
  return view
}

export async function revokeVaultSecret(engagementId: string, secretId: string, signal: AbortSignal): Promise<void> {
  await requestJson<unknown>(apiBaseUrl, `/engagements/${encodePathSegment(engagementId)}/vault/secrets/${encodePathSegment(secretId)}`, { method: 'DELETE', signal, timeoutMs: 15_000 })
}
