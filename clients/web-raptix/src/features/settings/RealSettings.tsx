/**
 * W15 real Settings: only the fields the new server actually persists, saved
 * through the validated PATCH with save/reload acknowledgement. Unsupported
 * feature areas are stated as absent with their owning work package; the
 * danger zone names exactly what deletion removes (DB record, bound threads,
 * request ledger) and that workspace artifacts are retained.
 */
import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { ProjectViewModel } from '@raptix/web-contracts'
import { useRealSettings } from './use-real-settings'

const C = { page: '#F8FAFC', card: '#FFFFFF', border: '#E2E8F0', ink: '#0F172A', body: '#475569', muted: '#94A3B8', red: '#DC2626', green: '#15803D', amber: '#92400E' }
const MONO = "'JetBrains Mono', monospace"
const PARA: CSSProperties = { margin: 0, fontSize: 12, lineHeight: 1.6, color: '#475569' }
const CARD: CSSProperties = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 10 }
const LABEL: CSSProperties = { fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }
const INPUT: CSSProperties = { border: `1px solid ${C.border}`, borderRadius: 7, padding: '8px 10px', fontSize: 13, color: C.ink, background: C.card, outline: 'none', width: '100%' }

const UNSUPPORTED: Array<{ title: string; reason: string }> = [
  { title: 'AI provider / model / runtime', reason: 'No generic settings contract exists for runtime configuration yet; runtime identity comes from the server environment (W17+ provider work).' },
  { title: 'Integrations & keys', reason: 'No integration registry or secret storage service exists in this build (W18 vault work). Nothing here can be connected.' },
  { title: 'Notification delivery', reason: 'No delivery provider or preferences schema exists yet.' },
  { title: 'Report templates', reason: 'Report rendering has no template API; exports are the validated JSON/Markdown attachments (W14).' },
]

export default function RealSettings({ project, onDeleted }: { project: ProjectViewModel; onDeleted: () => void }): React.JSX.Element {
  const state = useRealSettings(project)
  const [displayName, setDisplayName] = useState('')
  const [targetType, setTargetType] = useState('web_url')
  const [targetValue, setTargetValue] = useState('')
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (state.settings) {
      setDisplayName(state.settings.displayName)
      setTargetType(state.settings.targetType)
      setTargetValue(state.settings.targetValue)
    }
  }, [state.settings])

  useEffect(() => {
    if (state.deleted) onDeleted()
  }, [state.deleted, onDeleted])

  const targetLocked = state.settings !== null && !state.settings.targetChange.allowed
  const dirty = state.settings !== null && (displayName !== state.settings.displayName || targetType !== state.settings.targetType || targetValue !== state.settings.targetValue)

  return (
    <div style={{ background: C.page, minHeight: '100%', padding: 24, display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 860 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.ink }}>Settings</h1>
        <p style={{ ...PARA, marginTop: 4, fontSize: 11, color: C.muted }}>Persisted engagement fields only. Save is acknowledged by the server and reloaded before it is reported.</p>
      </div>

      {state.loading && <div style={CARD}><div style={{ padding: 20, ...PARA, color: C.muted }}>Loading persisted settings…</div></div>}
      {state.error && <div role="alert" style={{ ...CARD, padding: 16, fontSize: 12, color: C.red }}>{state.error}</div>}

      {state.settings && (
        <>
          <div style={{ ...CARD, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={LABEL}>General</div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: C.body }}>Display name</span>
              <input value={displayName} onChange={event => setDisplayName(event.target.value)} style={INPUT} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: C.body }}>Project name (workspace slug, immutable)</span>
              <input value={state.settings.name} readOnly disabled style={{ ...INPUT, fontFamily: MONO, color: C.muted, background: C.page }} />
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: C.body }}>Target type</span>
                <select value={targetType} disabled={targetLocked} onChange={event => setTargetType(event.target.value)} style={{ ...INPUT, opacity: targetLocked ? 0.6 : 1 }}>
                  <option value="web_url">web_url</option>
                  <option value="ip_range">ip_range</option>
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: C.body }}>Target value</span>
                <input value={targetValue} disabled={targetLocked} onChange={event => setTargetValue(event.target.value)} style={{ ...INPUT, fontFamily: MONO, opacity: targetLocked ? 0.6 : 1 }} />
              </label>
            </div>
            {targetLocked && state.settings.targetChange.reason && (
              <div role="note" style={{ padding: '8px 12px', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 7, fontSize: 11, color: C.amber }}>
                Target locked: {state.settings.targetChange.reason}.
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <button disabled={state.saving || !dirty} onClick={() => state.save(targetLocked ? { displayName } : { displayName, targetType, targetValue })}
                style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: dirty ? '#DC2626' : C.border, color: dirty ? '#FFFFFF' : C.muted, fontSize: 13, fontWeight: 600, cursor: dirty ? 'pointer' : 'default' }}>
                {state.saving ? 'Saving…' : 'Save changes'}
              </button>
              {state.saved && <span role="status" style={{ fontSize: 12, color: C.green }}>Saved — reloaded from the server.</span>}
              {state.saveError && <span role="alert" style={{ fontSize: 12, color: C.red }}>{state.saveField ? `${state.saveField}: ${state.saveError}` : state.saveError}</span>}
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
              <span style={{ fontSize: 11, color: C.muted }}>Lifecycle: <b style={{ color: C.body }}>{state.settings.lifecycleStatus}</b></span>
              <span style={{ fontSize: 11, color: C.muted }}>Authorization: <b style={{ color: C.body }}>{state.settings.authorizationConfirmed ? 'confirmed' : 'not confirmed'}</b></span>
            </div>
          </div>

          <div style={{ ...CARD, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={LABEL}>Not available in this build</div>
            {UNSUPPORTED.map(item => (
              <div key={item.title} style={{ borderBottom: '1px solid #F1F5F9', paddingBottom: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.ink }}>{item.title}</div>
                <div style={{ ...PARA, fontSize: 11, color: C.muted }}>{item.reason}</div>
              </div>
            ))}
          </div>

          <div style={{ ...CARD, padding: 20, borderColor: '#FCA5A5', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ ...LABEL, color: C.red }}>Danger zone</div>
            <p style={{ ...PARA, fontSize: 11 }}>
              Delete engagement removes the database record, its bound runtime threads and the request ledger for this project. Workspace artifacts on disk are <b>retained</b>. Active or in-flight runtime requests block deletion until they settle. This is a database delete, not an archive, and it does not clean artifact retention or C2 state.
            </p>
            {state.deleteError && <div role="alert" style={{ fontSize: 12, color: C.red }}>{state.deleteError}</div>}
            {!confirming ? (
              <button onClick={() => setConfirming(true)} style={{ alignSelf: 'flex-start', padding: '8px 14px', borderRadius: 8, border: `1px solid ${C.red}`, background: C.card, color: C.red, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                Delete engagement
              </button>
            ) : (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button disabled={state.deleting} onClick={state.destroy} style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: C.red, color: '#FFFFFF', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  {state.deleting ? 'Deleting…' : 'Confirm delete'}
                </button>
                <button onClick={() => setConfirming(false)} style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, color: C.body, fontSize: 13, cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
