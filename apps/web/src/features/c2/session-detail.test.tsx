/**
 * Ticket 47: session detail and console panels on the typed session read —
 * scoping without existence leaks, masking gated on the shared viewSensitive
 * policy action, linked panels derived from the one authority (this
 * session's audit rows, its operation's evidence, the target's findings),
 * deep links that resolve, loading/empty states, and the bridge proof both
 * directions (a typed grant decision refetches the mounted detail; a legacy
 * drawer request reaches the typed read). Command authorization stays in
 * the 46 grant lifecycle — see ./grants.test.tsx for the deadline−1/at/+1
 * handler tests and ./session-console.test.tsx for the mounted command path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { mountServices } from '../../test/helpers'
import { go, selectProject } from '../../router/navigate'
import type { RequestContext } from '../../domain/service'
import { routes } from './views/c2-pages'
import { seed } from '../../demo/seed';
import { decideSessionRequestTransaction, requestSessionAccessTransaction } from './grants'
import { getSessionDetail } from './service'

beforeEach(() => { window.location.hash = '' })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

function mountSession(hash: string, me = 'Alex Morgan', pid?: string) {
  /* setPid must run while the route is NOT a detail page: its redirect branch
     writes location.hash inside a state updater, which lands after go()'s write. */
  window.location.hash = pid ? '#/c2' : hash
  const key = hash.startsWith('#/c2-console') ? 'c2-console' : 'c2-session'
  const Screen = routes[key]
  const h = mountServices(<Screen />, me)
  if (pid) {
    const m = /^#\/([a-z0-9-]+)\/([^?]+)/.exec(hash)
    act(() => { selectProject(pid); if (m) go(m[1], { id: m[2] }) })
  }
  return h
}

const opCtx = (projectId = 'RT-2026-014'): RequestContext => ({ actor: { id: 'Alex Morgan', role: 'manager' }, projectId, corr: 'test' })

describe('session detail handler (ticket 47)', () => {
  const alex = { id: 'Alex Morgan', role: 'manager' as const }

  it('a session of another project is not-found in a specific-project scope, without leaking the target', () => {
    const res = getSessionDetail(seed(), { actor: { id: 'Riley Brooks', role: 'analyst' }, projectId: 'RT-2026-014', corr: 't' }, 'SS-043')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.failure.kind).toBe('not-found')
  })

  it('masks the sensitive evidence identity without viewSensitive and reports the own grant as an absolute instant', () => {
    const d = seed()
    const viewer = getSessionDetail(d, { actor: { id: 'Casey Nguyen (Client)', role: 'viewer' }, projectId: 'RT-2026-014', corr: 't' }, 'SS-041')
    expect(viewer.ok).toBe(true)
    if (viewer.ok) {
      expect(viewer.data.perm).toBe('none')
      expect(viewer.data.canViewSensitive).toBe(false)
      expect(viewer.data.evidence.find((e) => e.sensitive)?.name).toBe('•••••• (redacted)')
      expect(viewer.data.evidence.find((e) => !e.sensitive)?.name).toBe('accounts-output.txt')
    }
    const manager = getSessionDetail(d, { actor: alex, projectId: 'RT-2026-014', corr: 't' }, 'SS-041')
    expect(manager.ok).toBe(true)
    if (manager.ok) {
      expect(manager.data.canViewSensitive).toBe(true)
      expect(manager.data.evidence.find((e) => e.sensitive)?.name).toBe('evidence-027.png')
      expect(manager.data.myGrant).toBeUndefined()
    }
    const taylor = getSessionDetail(d, { actor: { id: 'Taylor Chen', role: 'operator' }, projectId: 'RT-2026-014', corr: 't' }, 'SS-041')
    expect(taylor.ok).toBe(true)
    if (taylor.ok) {
      expect(taylor.data.myGrant).toMatchObject({ perm: 'interactive', by: 'Alex Morgan', expiresAt: Date.parse('2026-10-13T11:15:00+07:00') })
      expect(taylor.data.access.key).toBe('interactive')
    }
  })

  it("linked panels stay in scope: this session only, its operation's evidence, the target's findings", () => {
    const r = getSessionDetail(seed(), { actor: alex, projectId: 'RT-2026-014', corr: 't' }, 'SS-041')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.audit.length).toBeGreaterThan(0)
      expect(r.data.audit.every((a) => a.obj === 'SS-041' && a.projectId === 'RT-2026-014')).toBe(true)
      expect(r.data.evidence.map((e) => e.id)).toEqual(['EV-014-01', 'EV-014-02'])
      expect(r.data.findings.map((f) => f.id)).toEqual(['FD-011'])
      expect(r.data.requests.map((x) => x.id)).toEqual(['AR-011'])
      expect(r.data.channel).toMatchObject({ id: 'CH-014', status: 'connected' })
      expect(r.data.channel?.nodeLatency).toBeTruthy()
      expect(r.data.asset).toMatchObject({ id: 'AS-0143', scope: 'in' })
      expect(r.data.project).toMatchObject({ roeVersion: 'ROE-014-v2' })
    }
  })

  it("the aggregate scope folds every accessible project's session", () => {
    const all = getSessionDetail(seed(), { actor: alex, projectId: 'all', corr: 't' }, 'SS-043')
    expect(all.ok).toBe(true)
    if (all.ok) expect(all.data.session.asset).toBe('cloud-app-01')
  })
})

describe('session detail route (ticket 47)', () => {
  it('renders the scoped detail and resolves the deep links', async () => {
    const h = mountSession('#/c2-session/SS-041')
    await waitFor(() => expect(screen.getByText('Session identity')).toBeInTheDocument())
    expect(screen.getByText('Connection health')).toBeInTheDocument()
    fireEvent.click(screen.getAllByText('OP-014')[0])
    await waitFor(() => expect(window.location.hash).toBe('#/operation/OP-014?tab=overview'))
    h.unmount()
    const ch = mountSession('#/c2-session/SS-041')
    await waitFor(() => expect(screen.getByText('Session identity')).toBeInTheDocument())
    fireEvent.click(screen.getAllByText('CH-014')[0])
    await waitFor(() => expect(window.location.hash).toBe('#/c2-channel/CH-014'))
    ch.unmount()
    const ev = mountSession('#/c2-session/SS-041')
    await waitFor(() => expect(screen.getByText('Session identity')).toBeInTheDocument())
    fireEvent.click(screen.getAllByText('EV-014-01')[0])
    await waitFor(() => expect(window.location.hash).toBe('#/evidence/EV-014-01?engagement=RT-2026-014'))
    ev.unmount()
  })

  it('shows a loading skeleton first and a not-found empty for an out-of-scope deep link, without leaking the target', async () => {
    const h = mountSession('#/c2-session/SS-043', 'Riley Brooks', 'RT-2026-014')
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Session not found')).toBeInTheDocument())
    expect(screen.getAllByText(/No session "SS-043" in this project/).length).toBeGreaterThan(0)
    expect(screen.queryByText('cloud-app-01')).not.toBeInTheDocument()
    h.unmount()
  })

  it('the viewer sees session metadata only, with the sensitive evidence masked by the typed read', async () => {
    const h = mountSession('#/c2-session/SS-041', 'Casey Nguyen (Client)')
    await waitFor(() => expect(screen.getByText('Metadata only')).toBeInTheDocument())
    expect(screen.getByText(/Transcripts are not visible to the Client \/ Viewer role/)).toBeInTheDocument()
    // The masked identity is the read model's — the linked evidence ids stay navigable.
    expect(screen.getAllByText('EV-014-02').length).toBeGreaterThan(0)
    h.unmount()
  })

  it('a typed grant decision refetches the mounted detail through the bridge', async () => {
    // Riley is the pending requester on SS-042 — the approved grant binds to him.
    const h = mountSession('#/c2-session/SS-042', 'Riley Brooks')
    await waitFor(() => expect(screen.getByText('Request history')).toBeInTheDocument())
    expect(screen.getByText('AR-012')).toBeInTheDocument()
    expect(screen.getByText('Pending request')).toBeInTheDocument()
    h.run(() => {
      const r = decideSessionRequestTransaction(h.svc().authority, h.svc().clock, opCtx(), { requestId: 'AR-012', decision: 'approved', note: 'Confirmed web profile findings', minutes: 30 })
      expect(r.ok).toBe(true)
    })
    await waitFor(() => expect(screen.getByText(/Interactive until/)).toBeInTheDocument())
    expect(screen.queryByText('Pending request')).not.toBeInTheDocument()
    // The decision is visible in the request history of the same snapshot.
    expect(screen.getAllByText('AR-012')[0].closest('tr')).toHaveTextContent('Approved')
    h.unmount()
  })

  it('a legacy drawer request reaches the typed detail read without a reload', async () => {
    const h = mountSession('#/c2-session/SS-042', 'Taylor Chen', 'RT-2026-014')
    await waitFor(() => expect(screen.getByText('Request history')).toBeInTheDocument())
    fireEvent.click(screen.getAllByRole('button', { name: 'Request access' })[0])
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit request' })).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText(/Why do you need this access/), { target: { value: 'Validate step 8 output on the domain controller.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }))
    await waitFor(() => expect(screen.getByText('AR-013')).toBeInTheDocument())
    expect(screen.getByText('Pending request')).toBeInTheDocument()
    // The commit went through the feature-local transaction the legacy entry bridges to.
    h.run(() => {
      const read = requestSessionAccessTransaction(h.svc().authority, h.svc().clock, { actor: { id: 'Taylor Chen', role: 'operator' }, projectId: 'RT-2026-014', corr: 't' }, { sessionId: 'SS-042', mode: 'interactive', duration: '1 hour', reason: 'Second request must conflict.' })
      expect(read.ok).toBe(false)
      if (!read.ok) expect(read.failure.kind).toBe('conflict')
    })
    h.unmount()
  })
})
