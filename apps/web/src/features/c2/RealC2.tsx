/** Native Sliver registry, HTTP profiles, listener ownership and audited commands. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { isC2View, isC2CommandView, type C2View, type C2CommandView, type ProjectViewModel } from '@raptix/web-contracts'
import { requestJson, encodePathSegment } from '../../shared/api/http'
import { ApiClientError } from '../../shared/api/errors'
import { apiBaseUrl } from '../../app/config'

const CARD = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 10, padding: 16 }
const INPUT = { padding: 8, border: '1px solid #CBD5E1', borderRadius: 6, fontSize: 12 }
export default function RealC2({ project }: { project: ProjectViewModel }): React.JSX.Element {
  const [registry, setRegistry] = useState<C2View | null>(null)
  const [history, setHistory] = useState<C2CommandView[]>([])
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [session, setSession] = useState('')
  const [path, setPath] = useState('/usr/bin/whoami')
  const [args, setArgs] = useState('[]')
  const [profile, setProfile] = useState('lab')
  const pending = useRef<{ requestId: string; path: string; args: string[]; sessionId: string } | null>(null)
  const controllers = useRef(new Set<AbortController>())
  const base = `/engagements/${encodePathSegment(project.id)}/c2`
  const refresh = useCallback(async (signal: AbortSignal): Promise<void> => {
    const view = await requestJson<unknown>(apiBaseUrl, `${base}/sessions`, { signal, timeoutMs: 30_000 })
    const commands = await requestJson<unknown>(apiBaseUrl, `${base}/commands`, { signal })
    if (!isC2View(view) || view.engagementId !== project.id || !Array.isArray(commands) || !commands.every(isC2CommandView) || commands.some(c => c.engagementId !== project.id)) throw new Error('Invalid scoped C2 response')
    if (signal.aborted) return
    setRegistry(view); setHistory(commands); setError(null); setStatus(200)
  }, [base, project.id])
  useEffect(() => {
    const controller = new AbortController()
    setRegistry(null); setHistory([]); setSession(''); setError(null); setStatus(null); setBusy(false); pending.current = null
    void refresh(controller.signal).catch(cause => {
      if (controller.signal.aborted) return
      setError(cause instanceof Error ? cause.message : 'C2 provider failed')
      setStatus(cause instanceof ApiClientError && 'statusCode' in cause ? cause.statusCode as number : null)
    })
    const active = controllers.current
    return () => { controller.abort(); for (const c of active) c.abort(); active.clear() }
  }, [refresh])

  async function act(endpoint: string, body?: unknown, method: 'POST' | 'DELETE' = 'POST'): Promise<void> {
    if (busy) return
    const controller = new AbortController(); controllers.current.add(controller)
    setBusy(true); setError(null)
    try {
      const result = await requestJson<unknown>(apiBaseUrl, `${base}${endpoint}`, { method, body, signal: controller.signal, timeoutMs: 105_000 })
      if (controller.signal.aborted) return
      if (endpoint.includes('/commands') && !isC2CommandView(result)) throw new Error('Invalid command response')
      if (isC2CommandView(result) && ['succeeded','failed'].includes(result.status)) pending.current = null
      await refresh(controller.signal)
    } catch (cause) {
      if (!controller.signal.aborted) {
        if (cause instanceof ApiClientError && 'statusCode' in cause && [400,403,404].includes(cause.statusCode as number)) pending.current = null
        setError(cause instanceof Error ? cause.message : 'C2 operation failed')
      }
    }
    finally { controllers.current.delete(controller); if (!controller.signal.aborted) setBusy(false) }
  }
  async function execute(): Promise<void> {
    try {
      const parsed: unknown = JSON.parse(args)
      if (!Array.isArray(parsed) || !parsed.every(a => typeof a === 'string')) throw new Error('Arguments must be a JSON array of strings')
      const prior = pending.current
      if (prior && (prior.path !== path || prior.sessionId !== session || JSON.stringify(prior.args) !== JSON.stringify(parsed))) throw new Error('Reconcile the pending command before changing its input')
      const request = prior ?? { requestId: crypto.randomUUID(), path, args: parsed as string[], sessionId: session }
      pending.current = request
      await act(`/sessions/${encodePathSegment(session)}/commands`, { requestId: request.requestId, path: request.path, args: request.args })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid command') }
  }
  return <div style={{ background: '#F8FAFC', minHeight: '100%', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
    <header><h1 style={{ margin: 0, fontSize: 18 }}>C2 &amp; Sessions</h1><p style={{ fontSize: 12, color: '#64748B' }}>Sliver gRPC/mTLS through the private lab bridge. Sessions belong to this engagement's listeners. HTTP C2 profiles are distinct from implant build profiles.</p></header>
    {error && <div role="alert" style={{ ...CARD, color: '#B45309' }}>{error}</div>}
    {!registry && <div role="status" style={CARD}><strong>C2 provider {status === 503 ? 'not configured' : 'unavailable'}</strong><p>{status === null && !error ? 'Checking the session provider…' : `Server answered ${status ?? 'error'}: ${error ?? 'provider unavailable'}`}</p><p>Agent threads, CLI PTYs and C2 sessions remain distinct transports.</p></div>}
    {registry && <>
      <section style={CARD}><h2 style={{ fontSize: 14 }}>Owned lab listeners</h2><button disabled={busy} onClick={() => void act('/listeners', { protocol: 'mtls' })}>Start mTLS listener</button>{' '}<button disabled={busy} onClick={() => void act('/listeners', { protocol: 'http' })}>Start HTTP listener</button>
        {registry.listeners.length === 0 && <p>No listener is assigned to this engagement.</p>}
        {registry.listeners.map(l => <div key={l.port} style={{ marginTop: 8 }}>{l.protocol} :{l.port} · job {l.jobId} · {l.active ? 'active' : 'stopped'} {l.active && <button disabled={busy} onClick={() => void act(`/listeners/${l.jobId}`, undefined, 'DELETE')}>Stop</button>}</div>)}
      </section>
      <section style={CARD}><h2 style={{ fontSize: 14 }}>Native sessions</h2><button disabled={busy} onClick={() => { const c = new AbortController(); void refresh(c.signal).catch(e => setError(e.message)) }}>Refresh</button>
        {registry.sessions.length === 0 && <p>No owned session is currently observed.</p>}
        {registry.sessions.map(s => <div key={s.id} style={{ marginTop: 8, overflowWrap: 'anywhere' }}>{s.name} · {s.hostname} · {s.username} · {s.os}/{s.arch} · listener :{s.listenerPort} · {s.isDead ? 'disconnected' : 'connected'}<br/><code>{s.id}</code></div>)}
      </section>
      <section style={CARD}><h2 style={{ fontSize: 14 }}>HTTP C2 profiles</h2><label>Profile name <input aria-label="HTTP profile name" style={INPUT} value={profile} onChange={e => setProfile(e.target.value)} /></label>{' '}<button disabled={busy || !profile} onClick={() => void act('/profiles', { name: profile })}>Create scoped profile</button>
        <p style={{ fontSize: 11 }}>Clones native default traffic configuration into this engagement's namespace. Existing implants are not changed.</p>
        {registry.profiles.map(p => <div key={p.name} style={{ fontSize: 12, overflowWrap: 'anywhere' }}><code>{p.name}</code> · {p.headerCount} headers · {p.cookieCount} cookies · {p.pathSegmentCount} path segments</div>)}
      </section>
      <section style={CARD}><h2 style={{ fontSize: 14 }}>Audited native command</h2>
        <select aria-label="C2 session" style={INPUT} value={session} onChange={e => setSession(e.target.value)}><option value="">Choose an owned session</option>{registry.sessions.map(s => <option key={s.id} value={s.id} disabled={s.isDead}>{s.hostname} · {s.name}</option>)}</select>{' '}
        <input aria-label="Binary path" style={INPUT} value={path} onChange={e => setPath(e.target.value)} />{' '}<input aria-label="Arguments JSON" style={INPUT} value={args} onChange={e => setArgs(e.target.value)} />{' '}
        <button disabled={busy || !session || !path} onClick={() => void execute()}>{busy ? 'Waiting for native outcome…' : 'Execute'}</button>
        <p style={{ fontSize: 11 }}>Explicit path + argv; no implicit shell. Unknown outcomes are retained for reconciliation, not automatically executed again.</p>
      </section>
      <section style={CARD}><h2 style={{ fontSize: 14 }}>Command audit history (latest 100)</h2>{history.length === 0 && <p>No commands recorded.</p>}
        {history.map(c => <article key={c.id} style={{ borderTop: '1px solid #E2E8F0', paddingTop: 8, overflowWrap: 'anywhere' }}><code>{c.path} {JSON.stringify(c.args)}</code> · {c.status} · exit {c.exitCode ?? 'unknown'}<p style={{ fontSize: 11 }}>request {c.requestId} · {c.createdAt}</p>
          {!['succeeded','failed'].includes(c.status) && <button disabled={busy} onClick={() => void act(`/commands/${encodePathSegment(c.id)}/reconcile`)}>Reconcile command</button>}
          <pre style={{ whiteSpace: 'pre-wrap' }}>{c.stdout}{c.stdoutTruncated ? '\n[stdout truncated]' : ''}</pre><pre style={{ color: '#B45309', whiteSpace: 'pre-wrap' }}>{c.stderr}{c.stderrTruncated ? '\n[stderr truncated]' : ''}</pre></article>)}
      </section>
    </>}
  </div>
}
