/**
 * Ticket 59: notification center handlers, Query binding and shell slot.
 * The notice list is persona-scoped (system + accessible projects only),
 * read/unread and mark-all stay inside the caller's scope, dismissal is
 * role-gated at the handler with a renderable reason and audited, and the
 * bridge is observed in both directions: a legacy `A.notify` mutation
 * appears in the Query view without a reload, and a service write is seen
 * by the legacy store. The popover composes through the ticket-08
 * `notifications` shell slot on the real route host.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createHashRouter, RouterProvider } from 'react-router'
import { ConsoleProviders } from '../../state/query'
import { StoreProvider, useServices, useStore, type Store } from '../../store'
import { setActiveRouter } from '../../router/active'
import { RouteHost } from '../../router/host'
import type { ConsoleServices } from '../../domain/service-factory'
import { createDatabaseAuthority } from '../../domain/database'
import { MockClock } from '../../domain/clock'
import type { ActorRef, RequestContext } from '../../domain/service'
import { dismissNotice, listNotices, markAllNoticesRead, setNoticeRead } from './service'
import { useNotices } from './query'

afterEach(() => { cleanup(); setActiveRouter(null); window.location.hash = '' })

/* ───────────── handler harness ───────────── */
function harness() {
  const clock = new MockClock()
  return { clock, authority: createDatabaseAuthority(clock) }
}
const ctxOf = (a: ActorRef, projectId = 'all', corr = 't'): RequestContext => ({ actor: a, projectId, corr })
const alex = { id: 'Alex Morgan', role: 'manager' } as ActorRef
const riley = { id: 'Riley Brooks', role: 'analyst' } as ActorRef
const casey = { id: 'Casey Nguyen (Client)', role: 'viewer' } as ActorRef

describe('persona-scoped notice list (ticket 59)', () => {
  it('scopes the list to system notices plus accessible projects, with the unread badge count', () => {
    const h = harness()
    const mine = listNotices(h.authority.snapshot(), ctxOf(riley))
    expect(mine.ok).toBe(true)
    if (mine.ok) {
      const ids = mine.data.items.map((n) => n.id)
      expect(ids).toEqual(expect.arrayContaining(['N3', 'N4', 'N5', 'N7']))
      expect(ids).not.toContain('N1') // PT-2026-006: Riley is not a member
      expect(ids).not.toContain('N2') // RT-2026-015: out of scope
      expect(ids).not.toContain('N6')
      expect(mine.data.unread).toBe(3)
      expect(mine.data.total).toBe(4)
      expect(mine.data.canMutate).toBe(true)
    }
    // Elevated roles reach every project; the chip resolves for the popover filter.
    const all = listNotices(h.authority.snapshot(), ctxOf(alex))
    expect(all.ok && all.data.total === 7 && all.data.unread === 5).toBe(true)
    if (all.ok) expect(all.data.items.find((n) => n.id === 'N2')!.chip).toBe('AI plans')
    h.authority.reset()
  })

  it('marks read/unread per notice; out-of-scope and unknown ids are not-found without leaking existence', () => {
    const h = harness()
    const ok = setNoticeRead(h.authority, h.clock, ctxOf(riley, 'all', 'read'), 'N3', true)
    expect(ok.ok).toBe(true)
    expect(h.authority.snapshot().notices.find((n) => n.id === 'N3')!.read).toBe(true)
    const unread = setNoticeRead(h.authority, h.clock, ctxOf(riley), 'N3', false)
    expect(unread.ok).toBe(true)
    expect(h.authority.snapshot().notices.find((n) => n.id === 'N3')!.read).toBe(false)
    expect(setNoticeRead(h.authority, h.clock, ctxOf(riley), 'N2', true)).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'not-found', message: expect.stringContaining('out of scope') }) })
    expect(setNoticeRead(h.authority, h.clock, ctxOf(riley), 'N999', true)).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'not-found', message: expect.stringContaining('no longer exists') }) })
    h.authority.reset()
  })

  it('mark-all-read touches in-scope notices only — other personas keep their unread rows', () => {
    const h = harness()
    const res = markAllNoticesRead(h.authority, h.clock, ctxOf(riley, 'all', 'read-all'))
    expect(res.ok).toBe(true)
    const db = h.authority.snapshot()
    expect(['N3', 'N4', 'N5', 'N7'].every((id) => db.notices.find((n) => n.id === id)!.read)).toBe(true)
    // Out-of-scope rows are untouched: the legacy unscoped mark-all leak is fixed at the handler.
    expect(['N1', 'N2', 'N6'].every((id) => db.notices.find((n) => n.id === id)!.read)).toBe(false)
    expect(res.ok && res.data.unread).toBe(0)
    h.authority.reset()
  })

  it('dismiss removes the notice, appends the audit row and is role-gated with a reason', () => {
    const h = harness()
    const ok = dismissNotice(h.authority, h.clock, ctxOf(alex, 'all', 'dismiss'), 'N5')
    expect(ok.ok).toBe(true)
    const db = h.authority.snapshot()
    expect(db.notices.some((n) => n.id === 'N5')).toBe(false)
    expect(db.audit[0]).toMatchObject({ action: 'Dismissed notification', obj: 'N5', actor: 'Alex Morgan', reason: 'AG-009 disconnected since Oct 12, 6:05 PM' })
    expect(dismissNotice(h.authority, h.clock, ctxOf(casey), 'N3')).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: expect.stringContaining('Viewers have read-only access') }) })
    expect(dismissNotice(h.authority, h.clock, ctxOf(riley), 'N2')).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'not-found' }) })
    expect(db.notices.some((n) => n.id === 'N3')).toBe(true)
    h.authority.reset()
  })
})

/* ───────────── bridge harness (legacy store + services, one authority) ───────────── */
function BridgeProbe({ ready }: { ready: (s: Store, svc: ConsoleServices) => void }) {
  ready(useStore(), useServices())
  return null
}
function mountBridge(me = 'Alex Morgan') {
  let store!: Store
  let svc!: ConsoleServices
  const view = render(
    <StoreProvider>
      <BridgeProbe ready={(s, v) => { store = s; svc = v }} />
    </StoreProvider>,
  )
  if (me !== 'Alex Morgan') act(() => { store.setMe(me) })
  return { store: () => store, svc: () => svc, run: (fn: () => unknown) => act(fn), unmount: view.unmount }
}

describe('notice bridge both directions', () => {
  it('a service dismissal is observed by the legacy store without a reload (new → legacy)', async () => {
    const h = mountBridge()
    await act(async () => {
      await h.svc().notices(alex, 'all').dismiss(ctxOf(alex, 'all', 'svc-dismiss'), 'N4')
    })
    expect(h.store().db.notices.some((n) => n.id === 'N4')).toBe(false)
    expect(h.store().db).toBe(h.svc().authority.snapshot())
    expect(h.store().db.audit[0]).toMatchObject({ action: 'Dismissed notification', obj: 'N4' })
    h.unmount()
  })

  it('a superseded-scope notice read resolves unavailable so a late response cannot leak previous visibility', async () => {
    const h = mountBridge('Riley Brooks')
    const pending = h.svc().notices(riley, 'all').list(ctxOf(riley, 'all', 'late'))
    h.svc().cancelScope(riley, 'all')
    const res = await pending
    expect(res).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'unavailable', message: expect.stringContaining('superseded') }) })
    h.unmount()
  })
})

/* ───────────── Query views + the real header slot composition ───────────── */
function ViewsProbe({ ready }: { ready: (s: Store, svc: ConsoleServices) => void }) {
  ready(useStore(), useServices())
  return <NoticeViews />
}

function NoticeViews() {
  const q = useNotices()
  return (
    <div>
      <div data-testid="badge">{q.data ? String(q.data.unread) : '…'}</div>
      <div data-testid="rows">{q.data ? q.data.items.map((n) => n.id).join(',') : '…'}</div>
    </div>
  )
}

function mountViews(me = 'Alex Morgan') {
  let store!: Store
  let svc!: ConsoleServices
  const view = render(
    <StoreProvider>
      <ConsoleProviders>
        <ViewsProbe ready={(s, v) => { store = s; svc = v }} />
      </ConsoleProviders>
    </StoreProvider>,
  )
  if (me !== 'Alex Morgan') act(() => { store.setMe(me) })
  return { store: () => store, svc: () => svc, run: (fn: () => unknown) => act(fn), unmount: view.unmount }
}

describe('notice Query views through the ChangeSet bridge', () => {
  it('a legacy A.notify mutation appears in the Query view without a reload (legacy → new)', async () => {
    const h = mountViews('Riley Brooks')
    await waitFor(() => expect(screen.getByTestId('rows').textContent).not.toBe('…'))
    expect(screen.getByTestId('rows').textContent).not.toContain('N2')
    h.run(() => h.store().A.notify('AR-014 needs your review', 'RT-2026-014', { name: 'c2', id: 'AR-014' }, 'todo', 'sessions'))
    await waitFor(() => expect(screen.getByTestId('rows').textContent).toContain('N8-'))
    expect(screen.getByTestId('badge').textContent).toBe('4')
    h.unmount()
  })
  it('a service write updates the badge count through the bridge without a reload', async () => {
    const h = mountViews()
    await waitFor(() => expect(screen.getByTestId('badge').textContent).toBe('5'))
    await act(async () => {
      await h.svc().notices(alex, 'all').markAllRead(ctxOf(alex, 'all', 'svc-read-all'))
    })
    await waitFor(() => expect(screen.getByTestId('badge').textContent).toBe('0'))
    h.unmount()
  })

  it('a persona switch re-scopes the list and never shows the other persona\'s rows', async () => {
    const h = mountViews('Riley Brooks')
    await waitFor(() => expect(screen.getByTestId('rows').textContent).toContain('N3'))
    expect(screen.getByTestId('rows').textContent).not.toContain('N2')
    h.run(() => h.store().setMe('Taylor Chen'))
    await waitFor(() => expect(screen.getByTestId('rows').textContent).toContain('N2'))
    h.run(() => h.store().setMe('Riley Brooks'))
    await waitFor(() => expect(screen.getByTestId('rows').textContent).toContain('N3'))
    expect(screen.getByTestId('rows').textContent).not.toContain('N2')
    h.unmount()
  })
})

/* ───────────── the migrated popover on the real route host (shell slot) ───────────── */
function SlotProbe({ ready }: { ready: (s: Store) => void }) {
  ready(useStore())
  return null
}
function mountApp(hash: string, me?: string) {
  window.location.hash = hash
  let store!: Store
  const router = createHashRouter([
    { path: '*', element: <><SlotProbe ready={(s) => (store = s)} /><RouteHost /></>, errorElement: <div />, hydrateFallbackElement: null },
  ])
  setActiveRouter(router)
  const view = render(
    <StoreProvider>
      <ConsoleProviders>
        <RouterProvider router={router} />
      </ConsoleProviders>
    </StoreProvider>,
  )
  // Deep links do not auto-authenticate (ticket 06): sign in, then switch persona.
  fireEvent.click(screen.getByRole('button', { name: /Alex Morgan/ }))
  if (me) act(() => { store.setMe(me) })
  return { store: () => store, view }
}

describe('header notifications popover through the shell slot (ticket 59)', () => {
  it('the migrated center replaces the legacy default at the mount site and lists scoped rows', async () => {
    mountApp('#/command-center', 'Riley Brooks')
    await screen.findByRole('heading', { name: /command center/i })
    expect(screen.getByTestId('notice-center')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: /Notifications \(\d+ unread\)/ }))
    const panel = await screen.findByRole('dialog', { name: 'Notifications' })
    expect(within(panel).getByTestId('notice-row-N3')).toBeInTheDocument()
    expect(within(panel).queryByTestId('notice-row-N2')).not.toBeInTheDocument()
  })

  it('read toggle and mark-all update the badge; empty state renders when everything is read', async () => {
    const { store } = mountApp('#/command-center')
    await screen.findByRole('heading', { name: /command center/i })
    fireEvent.click(await screen.findByRole('button', { name: /Notifications \(\d+ unread\)/ }))
    await screen.findByRole('dialog', { name: 'Notifications' })
    expect(await screen.findByTestId('notice-badge')).toHaveTextContent('5')
    fireEvent.click(screen.getByRole('button', { name: 'Mark N1 as read' }))
    await waitFor(() => expect(screen.queryByTestId('notice-badge')).not.toHaveTextContent('5'))
    expect(screen.getByTestId('notice-badge')).toHaveTextContent('4')
    fireEvent.click(screen.getByRole('button', { name: /Mark all read/ }))
    await waitFor(() => expect(screen.queryByTestId('notice-badge')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'All' }))
    await waitFor(() => expect(screen.queryByTestId('notice-empty')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('tab', { name: /^Unread/ }))
    await waitFor(() => expect(screen.getByTestId('notice-empty')).toBeInTheDocument())
    expect(store().db.notices.every((n) => n.read)).toBe(true)
  })

  it('a legacy A.notify appears in the open popover without a reload (bridge on the real route)', async () => {
    const { store } = mountApp('#/command-center')
    await screen.findByRole('heading', { name: /command center/i })
    fireEvent.click(await screen.findByRole('button', { name: /Notifications \(\d+ unread\)/ }))
    const panel = await screen.findByRole('dialog', { name: 'Notifications' })
    expect(within(panel).queryByText('OP-2026-118 finished — results ready')).not.toBeInTheDocument()
    act(() => { store().A.notify('OP-2026-118 finished — results ready', 'RT-2026-014', { name: 'operation', id: 'OP-2026-118' }, 'update') })
    await waitFor(() => expect(within(panel).getByText('OP-2026-118 finished — results ready')).toBeInTheDocument())
  })

  it('dismissal asks for confirmation, removes the row and records the audit entry', async () => {
    const { store } = mountApp('#/command-center')
    await screen.findByRole('heading', { name: /command center/i })
    fireEvent.click(await screen.findByRole('button', { name: /Notifications \(\d+ unread\)/ }))
    const panel = await screen.findByRole('dialog', { name: 'Notifications' })
    fireEvent.click(within(panel).getByRole('button', { name: 'Dismiss N3' }))
    const modal = await screen.findByRole('dialog', { name: 'Dismiss notification?' })
    fireEvent.click(within(modal).getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(screen.queryByTestId('notice-row-N3')).not.toBeInTheDocument())
    expect(store().db.notices.some((n) => n.id === 'N3')).toBe(false)
    expect(store().db.audit[0]).toMatchObject({ action: 'Dismissed notification', obj: 'N3' })
  })

  it('a viewer persona sees the list but the dismiss gate is disabled with the reason visible', async () => {
    mountApp('#/command-center', 'Casey Nguyen (Client)')
    await screen.findByRole('heading', { name: /command center/i })
    fireEvent.click(await screen.findByRole('button', { name: /Notifications \(\d+ unread\)/ }))
    const panel = await screen.findByRole('dialog', { name: 'Notifications' })
    expect(within(panel).getByTestId('notice-row-N3')).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Dismiss N3 (read-only account)' })).toBeDisabled()
    expect(within(panel).getByText('Your account has read-only access: you can review notifications but not dismiss them.')).toBeInTheDocument()
  })
})
