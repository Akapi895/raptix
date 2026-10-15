/**
 * Real vault panel (integration ticket 16 — the D5 credential-placement).
 * The credentials vault is engagement-scoped: redacted metadata only in the
 * list, plaintext exists solely in an explicit reveal response the operator
 * triggers, and every create/reveal/revoke is a server-side audited record
 * (surfaced in the audit tab with `vault` source attribution). An unconfigured
 * vault key answers 503 with the server's reason — shown, never worked around.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactElement } from 'react'
import { Eye, EyeOff, KeyRound, Loader2, Trash2 } from 'lucide-react'
import { createVaultSecret, fetchVault, revealVaultSecret, revokeVaultSecret, type CreateVaultSecretInput } from '../api'
import { Banner, Button, Card, CardHeader, Empty, Input, Skeleton } from '../../ui'
import { utcMinute } from '../format'

export function RealVaultPanel({ engagementId }: { engagementId: string }): ReactElement {
  const client = useQueryClient()
  const vault = useQuery({ queryKey: ['real', 'vault', engagementId], queryFn: () => fetchVault(engagementId) })
  const [form, setForm] = useState<CreateVaultSecretInput>({ kind: '', label: '', plaintext: '' })
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<Record<string, string>>({})

  const invalidate = (): void => { void client.invalidateQueries({ queryKey: ['real', 'vault', engagementId] }) }

  const create = useMutation({
    mutationFn: () => createVaultSecret(engagementId, form),
    onSuccess: () => {
      setForm({ kind: '', label: '', plaintext: '' })
      setError(null)
      setNotice('Secret stored encrypted server-side; the plaintext was never part of the list view.')
      invalidate()
    },
    onError: (err) => { setNotice(null); setError(err instanceof Error ? err.message : 'The secret was refused.') },
  })
  const reveal = useMutation({
    mutationFn: (secretId: string) => revealVaultSecret(engagementId, secretId),
    onSuccess: (view) => {
      setError(null)
      setRevealed((r) => ({ ...r, [view.secretId]: view.plaintext }))
      invalidate()
    },
    onError: (err) => { setNotice(null); setError(err instanceof Error ? err.message : 'The reveal was refused.') },
  })
  const revoke = useMutation({
    mutationFn: (secretId: string) => revokeVaultSecret(engagementId, secretId),
    onSuccess: (_, secretId) => {
      setError(null)
      setNotice('Secret revoked; the encrypted material was deleted and the action audited.')
      // W25: a revoked secret's plaintext must not linger in this browser session.
      setRevealed((r) => {
        const next = { ...r }
        delete next[secretId]
        return next
      })
      invalidate()
    },
    onError: (err) => { setNotice(null); setError(err instanceof Error ? err.message : 'The revoke was refused.') },
  })

  if (vault.isPending) return <Card><CardHeader title="Credentials vault" /><div className="p-4"><Skeleton className="h-24" /></div></Card>
  if (vault.isError || !vault.data) {
    return <Empty icon={KeyRound} title="The vault is unavailable" action={<Button onClick={() => void vault.refetch()}>Retry</Button>}>
      {vault.error instanceof Error ? vault.error.message : 'The vault read failed.'}
    </Empty>
  }
  const view = vault.data

  return (
    <div className="space-y-4">
      <Banner tone="info" title="Redacted by construction">
        The list never carries a plaintext secret. Reveal is an explicit, audited server action and the decrypted value exists only in this browser session until you hide it.
      </Banner>
      {error !== null && <p className="text-sm text-bad" role="alert">{error}</p>}
      {notice !== null && <p className="text-sm text-good" role="status">{notice}</p>}

      <Card>
        <CardHeader title={`Secrets (${view.secrets.length}${view.truncated ? '+, truncated' : ''})`} sub="Encrypted metadata with server-tracked reveal counts" />
        <div className="p-4">
          {view.secrets.length === 0 ? (
            <p className="text-sm text-muted">No secrets stored for this engagement yet.</p>
          ) : (
            <ul className="space-y-2">
              {view.secrets.map((s) => (
                <li key={s.id} className="rounded-lg border border-line px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-fg">{s.label}</span>
                    <span className="rounded border border-line px-1.5 py-0.5 font-mono text-xs text-muted">{s.kind}</span>
                    <span className="text-xs text-muted">revealed {s.revealCount}×{s.lastRevealedAt ? ` · last ${utcMinute(s.lastRevealedAt)}` : ''}</span>
                    <span className="flex-1" />
                    {revealed[s.id] !== undefined ? (
                      <Button variant="ghost" icon={EyeOff} aria-label={`Hide ${s.label}`} onClick={() => setRevealed((r) => { const n = { ...r }; delete n[s.id]; return n })} />
                    ) : (
                      <Button variant="ghost" icon={Eye} aria-label={`Reveal ${s.label}`} disabled={reveal.isPending} onClick={() => reveal.mutate(s.id)} />
                    )}
                    <Button variant="ghost" icon={Trash2} aria-label={`Revoke ${s.label}`} disabled={revoke.isPending} onClick={() => revoke.mutate(s.id)} />
                  </div>
                  {revealed[s.id] !== undefined && (
                    <p className="mt-2 break-all rounded bg-subtle px-2 py-1 font-mono text-xs text-fg" aria-live="polite">{revealed[s.id]}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Store a secret" sub="Encrypted with the deployment's server-side key (AES-256-GCM); an unconfigured key refuses writes with the server's reason" />
        <form
          className="grid gap-3 p-4 sm:grid-cols-3"
          onSubmit={(e) => { e.preventDefault(); if (form.kind.trim() && form.label.trim() && form.plaintext) create.mutate() }}
        >
          <label className="grid gap-1 text-xs text-muted" htmlFor="vault-kind">
            Kind
            <Input id="vault-kind" required maxLength={64} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} placeholder="api-key" />
          </label>
          <label className="grid gap-1 text-xs text-muted" htmlFor="vault-label">
            Label
            <Input id="vault-label" required maxLength={120} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="SIEM token" />
          </label>
          <label className="grid gap-1 text-xs text-muted" htmlFor="vault-plaintext">
            Secret value
            <Input id="vault-plaintext" type="password" required value={form.plaintext} onChange={(e) => setForm({ ...form, plaintext: e.target.value })} />
          </label>
          <div className="sm:col-span-3">
            <Button type="submit" variant="primary" icon={KeyRound} disabled={create.isPending}>
              {create.isPending ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
              Store encrypted
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
