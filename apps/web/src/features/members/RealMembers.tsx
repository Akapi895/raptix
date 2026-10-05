/**
 * W19 real Members: the truthful local single-user topology served by the
 * new API. One operator row, an explicit stated-absent invite/RBAC card
 * carrying the server's reason, and no imported demo people or role
 * dropdowns pretending to enforce anything.
 */
import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { ProjectViewModel } from '@raptix/web-contracts'
import type { MembersView } from '@raptix/web-contracts'
import { loadMembers } from './real-members-api'

const C = { page: '#F8FAFC', card: '#FFFFFF', border: '#E2E8F0', ink: '#0F172A', body: '#475569', muted: '#94A3B8', red: '#DC2626', amber: '#B45309' }
const MONO = "'JetBrains Mono', monospace"
const PARA: CSSProperties = { margin: 0, fontSize: 12, lineHeight: 1.6, color: '#475569' }
const CARD: CSSProperties = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 10 }
const LABEL: CSSProperties = { fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }

export default function RealMembers({ project }: { project: ProjectViewModel }): React.JSX.Element {
  const [state, setState] = useState<{ loading: boolean; data: MembersView | null; error: string | null }>({ loading: true, data: null, error: null })

  useEffect(() => {
    const controller = new AbortController()
    void (async (): Promise<void> => {
      try {
        const view = await loadMembers(project.id, controller.signal)
        setState({ loading: false, data: view, error: null })
      } catch (cause) {
        if (controller.signal.aborted) return
        setState({ loading: false, data: null, error: cause instanceof Error ? cause.message : 'Members view failed to load' })
      }
    })()
    return () => controller.abort()
  }, [project.id])

  return (
    <div style={{ background: C.page, minHeight: '100%', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.ink }}>Members</h1>
        <p style={{ ...PARA, marginTop: 4, fontSize: 11, color: C.muted }}>This deployment runs in local single-user mode: one operator identity, enforced by server-side ownership on every scoped API.</p>
      </div>

      {state.loading && <div style={PARA}>Loading members…</div>}
      {state.error && <div role="alert" style={{ ...CARD, padding: '12px 16px', fontSize: 12, color: C.red }}>{state.error}</div>}

      {state.data && (
        <>
          <div style={{ ...CARD, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
                <thead>
                  <tr style={{ background: C.page, borderBottom: `1px solid ${C.border}` }}>
                    {['Member', 'Role', 'Source', 'ID'].map(head => (
                      <th key={head} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748B', letterSpacing: '0.06em' }}>{head}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {state.data.members.map(member => (
                    <tr key={member.id} style={{ borderBottom: '1px solid #F1F5F9', background: '#FFFFFF' }}>
                      <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600, color: C.ink }}>{member.label}</td>
                      <td style={{ padding: '10px 14px', fontSize: 12, color: C.body }}>{member.role}</td>
                      <td style={{ padding: '10px 14px', fontSize: 12, color: C.body }}>{member.source}</td>
                      <td style={{ padding: '10px 14px', fontSize: 12, color: C.muted, fontFamily: MONO }}>{member.id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div role="status" style={{ ...CARD, padding: 20, display: 'flex', flexDirection: 'column', gap: 8, background: '#FFFBEB' }}>
            <div style={LABEL}>Invites &amp; roles</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.amber }}>Not available in this build</div>
            <p style={PARA}>{state.data.reason}</p>
            <p style={{ ...PARA, fontSize: 11, color: C.muted }}>
              A frontend role dropdown is not enforcement. When hosted authentication lands (sessions, CSRF, origin policy and server-side authorization on every scoped API), invite and role management will be wired to real membership records — never to a display-only hierarchy.
            </p>
          </div>
        </>
      )}
    </div>
  )
}
