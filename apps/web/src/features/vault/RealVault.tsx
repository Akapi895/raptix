/**
 * W18 real Credentials Vault: redacted server metadata by default, explicit
 * reveal with an acknowledged warning (plaintext is shown once, never
 * stored in component state beyond the current view), audited revocation.
 * No fixture eye-toggle: every value comes from the real API.
 */
import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { ProjectViewModel } from '@raptix/web-contracts'
import type { VaultRevealView, VaultSecretView, VaultView } from '@raptix/web-contracts'
import { ApiClientError } from '../../shared/api/errors'
import { createVaultSecret, listVaultSecrets, revokeVaultSecret, revealVaultSecret } from './real-vault-api'

const C = { page: '#F8FAFC', card: '#FFFFFF', border: '#E2E8F0', ink: '#0F172A', body: '#475569', muted: '#94A3B8', red: '#DC2626', green: '#15803D', amber: '#B45309' }
const MONO = "'JetBrains Mono', monospace"
const PARA: CSSProperties = { margin: 0, fontSize: 12, lineHeight: 1.6, color: '#475569' }
const CARD: CSSProperties = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 10 }
const LABEL: CSSProperties = { fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }
const INPUT: CSSProperties = { width: '100%', border: `1px solid ${C.border}`, borderRadius: 7, padding: '8px 10px', fontSize: 13, color: C.ink, background: C.card, boxSizing: 'border-box' }

const KIND_OPTIONS = ['password', 'api-key', 'token', 'note'] as const

interface LoadState { loading: boolean; data: VaultView | null; error: string | null }
interface AddState { busy: boolean; error: string | null }
interface RevealState { busyId: string | null; shown: VaultRevealView | null; error: string | null }

export default function RealVault({ project }: { project: ProjectViewModel }): React.JSX.Element {
  const [load, setLoad] = useState<LoadState>({ loading: true, data: null, error: null })
  const [form, setForm] = useState({ kind: 'password', label: '', plaintext: '' })
  const [add, setAdd] = useState<AddState>({ busy: false, error: null })
  const [reveal, setReveal] = useState<RevealState>({ busyId: null, shown: null, error: null })
  const [revoking, setRevoking] = useState<string | null>(null)

  const refresh = useCallback(async (signal: AbortSignal): Promise<void> => {
    setLoad(prev => ({ ...prev, loading: true, error: null }))
    try {
      const view = await listVaultSecrets(project.id, signal)
      setLoad({ loading: false, data: view, error: null })
    } catch (cause) {
      if (signal.aborted) return
      setLoad({ loading: false, data: null, error: cause instanceof Error ? cause.message : 'Vault metadata failed to load' })
    }
  }, [project.id])

  useEffect(() => {
    const controller = new AbortController()
    void refresh(controller.signal)
    return () => controller.abort()
  }, [refresh])

  async function submitSecret(): Promise<void> {
    if (add.busy || form.label.trim().length === 0 || form.plaintext.length === 0) return
    setAdd({ busy: true, error: null })
    try {
      await createVaultSecret(project.id, { kind: form.kind, label: form.label.trim(), plaintext: form.plaintext }, new AbortController().signal)
      setAdd({ busy: false, error: null })
      setForm(prev => ({ ...prev, label: '', plaintext: '' }))
      await refresh(new AbortController().signal)
    } catch (cause) {
      setAdd({ busy: false, error: cause instanceof ApiClientError ? cause.message : 'Vault storage failed' })
    }
  }

  async function revealSecret(secret: VaultSecretView): Promise<void> {
    if (reveal.busyId !== null) return
    setReveal({ busyId: secret.id, shown: null, error: null })
    try {
      const view = await revealVaultSecret(project.id, secret.id, new AbortController().signal)
      setReveal({ busyId: null, shown: view, error: null })
      await refresh(new AbortController().signal)
    } catch (cause) {
      setReveal({ busyId: null, shown: null, error: cause instanceof Error ? cause.message : 'Vault reveal failed' })
    }
  }

  async function revokeSecret(secret: VaultSecretView): Promise<void> {
    if (revoking !== null) return
    setRevoking(secret.id)
    try {
      await revokeVaultSecret(project.id, secret.id, new AbortController().signal)
      if (reveal.shown?.secretId === secret.id) setReveal(prev => ({ ...prev, shown: null }))
      await refresh(new AbortController().signal)
    } catch (cause) {
      setLoad(prev => ({ ...prev, error: cause instanceof Error ? cause.message : 'Vault revocation failed' }))
    } finally {
      setRevoking(null)
    }
  }

  return (
    <div style={{ background: C.page, minHeight: '100%', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.ink }}>Credentials Vault</h1>
        <p style={{ ...PARA, marginTop: 4, fontSize: 11, color: C.muted }}>Server-side encrypted storage (AES-256-GCM). Metadata is redacted by default; plaintext exists only in the explicit reveal response, and every reveal and revocation is audited.</p>
      </div>

      <div style={{ ...CARD, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={LABEL}>Store a secret</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 150 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: C.body }}>Kind</span>
            <select style={INPUT} value={form.kind} aria-label="Secret kind" onChange={event => setForm(prev => ({ ...prev, kind: event.target.value }))}>
              {KIND_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 200px' }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: C.body }}>Label</span>
            <input style={INPUT} value={form.label} maxLength={120} aria-label="Secret label" placeholder="e.g. Router admin" onChange={event => setForm(prev => ({ ...prev, label: event.target.value }))} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 200px' }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: C.body }}>Secret value</span>
            <input style={INPUT} type="password" value={form.plaintext} aria-label="Secret value" onChange={event => setForm(prev => ({ ...prev, plaintext: event.target.value }))} />
          </label>
          <button disabled={add.busy || form.label.trim().length === 0 || form.plaintext.length === 0} onClick={() => { void submitSecret() }}
            style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: '8px 16px', fontSize: 13, fontWeight: 600, color: C.ink, background: C.card, cursor: add.busy ? 'wait' : 'pointer' }}>
            {add.busy ? 'Encrypting…' : 'Store secret'}
          </button>
        </div>
        {add.error && <div role="alert" style={{ fontSize: 12, color: C.red }}>{add.error}</div>}
      </div>

      {reveal.error && <div role="alert" style={{ ...CARD, padding: '12px 16px', fontSize: 12, color: C.red }}>{reveal.error}</div>}
      {reveal.shown && (
        <div role="status" style={{ ...CARD, padding: '12px 16px', fontSize: 12, color: C.amber, background: '#FFFBEB' }}>
          Reveal acknowledged for <span style={{ fontFamily: MONO }}>{reveal.shown.secretId}</span> — this access is written to the engagement audit log. Value: <b style={{ fontFamily: MONO }}>{reveal.shown.plaintext}</b>
        </div>
      )}

      {load.loading && <div style={PARA}>Loading vault metadata…</div>}
      {load.error && <div role="alert" style={{ ...CARD, padding: '12px 16px', fontSize: 12, color: C.red }}>{load.error}</div>}
      {load.data && load.data.secrets.length === 0 && !load.loading && (
        <div style={{ ...CARD, padding: 20, ...PARA }}>No secrets stored for this engagement.</div>
      )}

      {load.data?.secrets.map(secret => (
        <div key={secret.id} style={{ ...CARD, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>{secret.label}</div>
              <div style={{ ...PARA, fontSize: 11, color: C.muted, fontFamily: MONO }}>{secret.id} · kind {secret.kind} · stored by {secret.createdBy} · {secret.createdAt}</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button disabled={reveal.busyId !== null} onClick={() => { void revealSecret(secret) }}
                style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: '6px 12px', fontSize: 12, fontWeight: 600, color: C.ink, background: C.card, cursor: reveal.busyId ? 'wait' : 'pointer' }}>
                {reveal.busyId === secret.id ? 'Revealing…' : 'Reveal'}
              </button>
              <button disabled={revoking !== null} onClick={() => { void revokeSecret(secret) }}
                style={{ border: `1px solid ${C.red}`, borderRadius: 7, padding: '6px 12px', fontSize: 12, fontWeight: 600, color: C.red, background: C.card, cursor: revoking ? 'wait' : 'pointer' }}>
                {revoking === secret.id ? 'Revoking…' : 'Revoke'}
              </button>
            </div>
          </div>
          <div style={PARA}>
            Reveals: <b style={{ color: C.ink }}>{secret.revealCount}</b>{secret.lastRevealedAt ? ` · last ${secret.lastRevealedAt}` : ' · never revealed'}
          </div>
        </div>
      ))}

      {load.data?.truncated && (
        <div style={{ ...CARD, padding: '12px 16px', fontSize: 12, color: C.muted }}>Vault metadata is truncated at 200 secrets (oldest omitted).</div>
      )}
    </div>
  )
}
