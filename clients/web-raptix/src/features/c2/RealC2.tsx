/**
 * W17 real C2 & Sessions: the scoped session route is live and engagement-
 * scoped, but no session provider registry exists in this build. The page
 * renders the server's own truthful 503 answer — no agent identity, hostname
 * or command output is ever fabricated.
 */
import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { ProjectViewModel } from '@raptix/web-contracts'
import { requestJson } from '../../shared/api/http'
import { ApiClientError } from '../../shared/api/errors'
import { apiBaseUrl } from '../../app/config'
import { encodePathSegment } from '../../shared/api/http'

const C = { page: '#F8FAFC', card: '#FFFFFF', border: '#E2E8F0', ink: '#0F172A', body: '#475569', muted: '#94A3B8', amber: '#B45309' }
const MONO = "'JetBrains Mono', monospace"
const PARA: CSSProperties = { margin: 0, fontSize: 12, lineHeight: 1.6, color: '#475569' }
const CARD: CSSProperties = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 10 }

export default function RealC2({ project }: { project: ProjectViewModel }): React.JSX.Element {
  const [state, setState] = useState<{ checked: boolean; status: number | null; message: string | null }>({ checked: false, status: null, message: null })

  useEffect(() => {
    const controller = new AbortController()
    void (async (): Promise<void> => {
      try {
        await requestJson<unknown>(apiBaseUrl, `/engagements/${encodePathSegment(project.id)}/c2/sessions`, { signal: controller.signal })
        setState({ checked: true, status: 200, message: null })
      } catch (error) {
        if (controller.signal.aborted) return
        const status = error instanceof ApiClientError && 'statusCode' in error ? (error as { statusCode: number }).statusCode : null
        setState({ checked: true, status, message: error instanceof Error ? error.message : 'C2 session check failed' })
      }
    })()
    return () => controller.abort()
  }, [project.id])

  return (
    <div style={{ background: C.page, minHeight: '100%', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.ink }}>C2 &amp; Sessions</h1>
        <p style={{ ...PARA, marginTop: 4, fontSize: 11, color: C.muted }}>Session and command routes are engagement-scoped on the new server. No C2 provider is configured in this build, so no session registry exists and no command can be dispatched.</p>
      </div>

      <div role="status" style={{ ...CARD, padding: 20, display: 'flex', flexDirection: 'column', gap: 8, background: '#FFFBEB' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.amber }}>C2 provider not configured</div>
        <p style={PARA}>
          {state.checked
            ? state.status === 200
              ? 'The server reported an available session provider, which is not expected in this build.'
              : `Server answered ${state.status ?? 'error'}: ${state.message ?? 'provider unavailable'}`
            : 'Checking the session provider…'}
        </p>
        <p style={{ ...PARA, fontSize: 11, color: C.muted }}>
          Agent threads (Operator Console), a CLI PTY and C2 sessions are distinct transports; this page will only list sessions from a real provider registry. No generic shell forwarding route exists.
        </p>
      </div>
      <div style={{ ...CARD, padding: '12px 16px', ...PARA, fontSize: 11, color: C.muted, fontFamily: MONO }}>
        GET /api/engagements/{project.id}/c2/sessions — 503 provider_unavailable
      </div>
    </div>
  )
}
