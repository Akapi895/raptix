/**
 * Credentials vault tab (plan P09, Vault slice), shared by the mock and the
 * real project detail. The list carries metadata only; a reveal is an explicit
 * audited action and its value stays in this session until hidden. Mock mode
 * labels the seeded values as demo data.
 */
import { useState, type ReactElement } from 'react'
import { Eye, EyeOff, KeyRound, Loader2, Trash2 } from 'lucide-react'
import { isRealMode } from '../../state/mode'
import { utcMinute } from '../../platform/format'
import { Banner, Button, Card, CardHeader, DemoTag, Empty, Input, Skeleton } from '../../ui/index'
import { VaultError, useVaultRead, useVaultWrites } from './query'

export function VaultTab({ engagementId }: { engagementId: string }): ReactElement {
  const vault = useVaultRead(engagementId)
  const writes = useVaultWrites(engagementId)
  const [form, setForm] = useState({ kind: '', label: '', plaintext: '' })
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const real = isRealMode()

  if (vault.isPending) return <Card><CardHeader title="Credentials vault" /><div className="p-4"><Skeleton className="h-24" /></div></Card>
  if (vault.isError || !vault.data) {
    return <Empty icon={KeyRound} title="The vault is unavailable" action={<Button onClick={() => void vault.refetch()}>Retry</Button>}>
      {vault.error instanceof Error ? vault.error.message : 'The vault read failed.'}
    </Empty>
  }
  const view = vault.data
  const refused = (err: unknown, fallback: string) => {
    setNotice(null)
    setError(err instanceof VaultError || err instanceof Error ? err.message : fallback)
  }

  const reveal = async (secretId: string) => {
    setBusy(true)
    try {
      const value = await writes.reveal(secretId)
      setError(null)
      setRevealed((r) => ({ ...r, [value.secretId]: value.plaintext }))
    } catch (err) {
      refused(err, 'The reveal was refused.')
    } finally {
      setBusy(false)
    }
  }
  const revoke = async (secretId: string) => {
    setBusy(true)
    try {
      await writes.revoke(secretId)
      setError(null)
      setNotice('Secret revoked; the encrypted material was deleted and the action audited.')
      setRevealed((r) => {
        const next = { ...r }
        delete next[secretId]
        return next
      })
    } catch (err) {
      refused(err, 'The revoke was refused.')
    } finally {
      setBusy(false)
    }
  }
  const store = async () => {
    setBusy(true)
    try {
      await writes.store({ kind: form.kind.trim(), label: form.label.trim(), plaintext: form.plaintext })
      setForm({ kind: '', label: '', plaintext: '' })
      setError(null)
      setNotice(real ? 'Secret stored encrypted server-side; the plaintext was never part of the list view.' : 'Secret stored.')
    } catch (err) {
      refused(err, 'The secret was refused.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <Banner tone="info" title={real ? 'Redacted by construction' : <span className="inline-flex items-center gap-2">Redacted by construction — <DemoTag /></span>}>
        The list never carries a plaintext secret. Reveal is an explicit, audited action and the decrypted value exists only in this browser session until you hide it.
      </Banner>
      {error !== null && <p className="text-sm text-bad" role="alert">{error}</p>}
      {notice !== null && <p className="text-sm text-good" role="status">{notice}</p>}

      <Card>
        <CardHeader title={`Secrets (${view.secrets.length}${view.truncated ? '+, truncated' : ''})`} sub={real ? 'Encrypted metadata with server-tracked reveal counts' : 'Encrypted metadata with tracked reveal counts — Demo Data'} />
        <div className="p-4">
          {view.secrets.length === 0 ? (
            <Empty icon={KeyRound} title="No secrets stored for this engagement yet">Store a lab credential below; every reveal and revocation is audited.</Empty>
          ) : (
            <ul className="space-y-2">
              {view.secrets.map((s) => (
                <li key={s.id} className="rounded-lg border border-line px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-fg">{s.label}</span>
                    <span className="font-mono text-xs text-muted">{s.id}</span>
                    <span className="rounded border border-line px-1.5 py-0.5 font-mono text-xs text-muted">{s.kind}</span>
                    <span className="text-xs text-muted">revealed {s.revealCount}×{s.lastRevealedAt ? ` · last ${utcMinute(s.lastRevealedAt)}` : ''}</span>
                    <span className="flex-1" />
                    {revealed[s.id] !== undefined ? (
                      <Button variant="ghost" icon={EyeOff} aria-label={`Hide ${s.label}`} onClick={() => setRevealed((r) => { const n = { ...r }; delete n[s.id]; return n })} />
                    ) : (
                      <Button variant="ghost" icon={Eye} aria-label={`Reveal ${s.label}`} disabled={busy || !view.canReveal} title={view.canReveal ? undefined : view.revealReason ?? undefined} onClick={() => void reveal(s.id)} />
                    )}
                    <Button variant="ghost" icon={Trash2} aria-label={`Revoke ${s.label}`} disabled={busy || !view.canManage} title={view.canManage ? 'Revoke and audit' : view.manageReason ?? undefined} onClick={() => void revoke(s.id)} />
                  </div>
                  {revealed[s.id] !== undefined && (
                    <>
                      <p className="mt-2 break-all rounded bg-subtle px-2 py-1 font-mono text-xs text-fg" aria-live="polite">{revealed[s.id]}</p>
                      {!real && <p className="mt-1 text-xs text-muted">Reveal recorded in Activity & Audit.</p>}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Store a secret" sub={real ? "Encrypted with the deployment's server-side key (AES-256-GCM); an unconfigured key refuses writes with the server's reason" : 'Demo storage with the same rules as the real vault: metadata-only list, audited store action'} />
        <form className="grid gap-3 p-4 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); if (form.kind.trim() && form.label.trim() && form.plaintext) void store() }}>
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
            <Button type="submit" variant="primary" icon={KeyRound} disabled={busy || !view.canManage} title={view.canManage ? undefined : view.manageReason ?? undefined}>
              {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
              Store encrypted{real ? null : <> <DemoTag /></>}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
