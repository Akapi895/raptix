/**
 * Mock credentials-vault panel (parity with the real-mode vault placement).
 * Metadata-only list, audited reveal/revoke/store through the mock authority,
 * and demo labeling — the plaintext shown on reveal is seeded demo data; the
 * real integration keeps plaintext server-side and never in any list.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactElement } from 'react'
import { Eye, EyeOff, KeyRound, Loader2, Trash2 } from 'lucide-react'
import type { Project } from '../../domain/entities'
import type { RequestContext, ServiceResult } from '../../domain/service'
import type { VaultSecretMeta } from './service'
import { createVaultSecret, listVaultSecrets, revealVaultSecret, revokeVaultSecret } from './service'
import { useServices } from '../../state/services'
import { useCan, useMe } from '../../state/console'
import { Banner, Button, Card, CardHeader, DemoTag, Empty, Input } from '../../ui'

export function VaultTab({ p }: { p: Project }): ReactElement {
  const svc = useServices()
  const me = useMe()
  const can = useCan()
  const client = useQueryClient()
  const [form, setForm] = useState({ kind: '', label: '', plaintext: '' })
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  /** Revealed demo values live only in this session until hidden (parity with the real panel). */
  const [revealed, setRevealed] = useState<Record<string, string>>({})

  const ctx = (): RequestContext => ({ actor: { id: me.name, role: me.role }, projectId: p.id, corr: `vault-${Date.now().toString(36)}` })
  const sync = <T,>(fn: () => ServiceResult<T>) => async () => {
    const res = fn()
    if (!res.ok) throw new Error(res.failure.message)
    return res.data
  }
  const invalidate = (): void => { void client.invalidateQueries({ queryKey: ['vault', p.id] }); void client.invalidateQueries({ queryKey: ['project-detail'] }) }

  const vault = useQuery({
    queryKey: ['vault', p.id],
    queryFn: async (): Promise<VaultSecretMeta[]> => {
      const res = listVaultSecrets(svc, ctx())
      if (!res.ok) throw new Error(res.failure.message)
      return res.data
    },
  })

  const reveal = useMutation({
    mutationFn: (secretId: string) => sync(() => revealVaultSecret(svc, ctx(), secretId))(),
    onSuccess: (view) => {
      setError(null)
      setRevealed((r) => ({ ...r, [view.secretId]: view.plaintext }))
      setNotice('Demo value revealed — the reveal was recorded in Activity & Audit. Hide it when done.')
      invalidate()
    },
    onError: (err) => { setNotice(null); setError(err instanceof Error ? err.message : 'The reveal was refused.') },
  })
  const revoke = useMutation({
    mutationFn: (secretId: string) => sync(() => revokeVaultSecret(svc, ctx(), secretId))(),
    onSuccess: (_, secretId) => {
      setError(null)
      setNotice('Secret revoked; the stored material was deleted and the action audited.')
      setRevealed((r) => { const n = { ...r }; delete n[secretId]; return n })
      invalidate()
    },
    onError: (err) => { setNotice(null); setError(err instanceof Error ? err.message : 'The revoke was refused.') },
  })
  const create = useMutation({
    mutationFn: () => sync(() => createVaultSecret(svc, ctx(), form))(),
    onSuccess: () => {
      setError(null)
      setForm({ kind: '', label: '', plaintext: '' })
      setNotice('Secret stored (demo); the plaintext never appears in the list view.')
      invalidate()
    },
    onError: (err) => { setNotice(null); setError(err instanceof Error ? err.message : 'The secret was refused.') },
  })

  const canReveal = can('viewSensitive', p.id)
  const canManage = can('editScope', p.id)
  const list = vault.data ?? []

  return (
    <div className="space-y-4">
      <Banner tone="info" title="Redacted by construction — Demo Data">
        The list never carries a secret value. Reveal is an explicit, audited action and the demo value exists only in this browser session until you hide it.
      </Banner>
      {error && <p className="text-sm text-bad" role="alert">{error}</p>}
      {notice && <p className="text-sm text-good" role="status">{notice}</p>}

      <Card>
        <CardHeader title={`Secrets (${list.length})`} sub="Encrypted metadata with tracked reveal counts — Demo Data" />
        <div className="p-4">
          {list.length === 0 ? (
            <Empty icon={KeyRound} title="No secrets stored for this project yet">Store a lab credential below; every reveal and revocation is audited.</Empty>
          ) : (
            <ul className="space-y-2">
              {list.map((s) => (
                <li key={s.id} className="rounded-lg border border-line px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-fg">{s.label}</span>
                    <span className="rounded border border-line px-1.5 py-0.5 font-mono text-xs text-muted">{s.kind}</span>
                    <span className="font-mono text-xs text-neutral">{s.id}</span>
                    <span className="text-xs text-muted">revealed {s.revealCount}×{s.lastRevealedAt ? ` · last ${s.lastRevealedAt}` : ''}</span>
                    <span className="text-xs text-muted">stored by {s.createdBy}</span>
                    <span className="flex-1" />
                    {revealed[s.id] !== undefined ? (
                      <Button variant="ghost" icon={EyeOff} aria-label={`Hide ${s.label}`} onClick={() => setRevealed((r) => { const n = { ...r }; delete n[s.id]; return n })} />
                    ) : (
                      <Button variant="ghost" icon={Eye} aria-label={`Reveal ${s.label}`} disabled={!canReveal || reveal.isPending} title={canReveal ? undefined : 'Your role cannot reveal secrets.'} onClick={() => reveal.mutate(s.id)} />
                    )}
                    <Button variant="ghost" icon={Trash2} aria-label={`Revoke ${s.label}`} disabled={!canManage || revoke.isPending} title={canManage ? 'Revoke and audit' : 'Only a Red Team Manager or Organization Admin can revoke secrets'} onClick={() => revoke.mutate(s.id)} />
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
        <CardHeader title="Store a secret" sub="Demo storage with the same rules as the real vault: metadata-only list, audited store action" />
        <form className="grid gap-3 p-4 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); if (form.kind.trim() && form.label.trim() && form.plaintext) create.mutate() }}>
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
            <Button type="submit" variant="primary" icon={KeyRound} disabled={!canManage || create.isPending} title={canManage ? undefined : 'Only a Red Team Manager or Organization Admin can store secrets'}>
              {create.isPending ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
              Store encrypted <DemoTag />
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}

export type { VaultSecretMeta }
