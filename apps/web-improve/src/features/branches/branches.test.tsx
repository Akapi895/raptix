/**
 * Ticket 43: branch groups, timelines and actions on typed services —
 * the fanout migration at its new enforcement site
 * (src/features/branches/service.ts).
 *
 * Covered here: the overview renders scoped branch groups with per-branch
 * timelines/status; retry transitions a failed branch into a pending approval
 * request without executing anything (and refuses completed/double requests
 * with reasons); cancel/reassign are role-, read-only-, state- and
 * eligible-agent-gated; a committed write publishes a ChangeSet both bridges
 * observe (legacy action → Query refetch, service write → legacy projection);
 * cross-project reads/actions are refused without content leak; writes bind to
 * the addressed branch's own project regardless of the active scope.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConsoleProviders } from '../../state/query'
import { StoreProvider, useServices, useStore, type Store } from '../../store'
import type { ConsoleServices } from '../../domain/service-factory'
import type { ActorRef, RequestContext } from '../../domain/service'
import type { Db } from '../../data'
import { FanOutPage } from '../../screens/g-fanout'
import { seed } from '../../data'
import { getBranchGroup, listBranchGroups } from './service'

afterEach(() => { cleanup(); window.location.hash = '' })

function Probe({ ready }: { ready: (s: Store, svc: ConsoleServices) => void }) {
  ready(useStore(), useServices())
  return null
}

/** Mounts the providers (optionally with the execution graph screen) and a probe. */
function mountFanout(me = 'Taylor Chen', hash = '#/ai-fanout/BG-014-01') {
  window.location.hash = hash
  let store!: Store
  let svc!: ConsoleServices
  const ui = (withScreen: boolean) => (
    <StoreProvider>
      <ConsoleProviders>
        <Probe ready={(s, v) => { store = s; svc = v }} />
        {withScreen ? <FanOutPage /> : null}
      </ConsoleProviders>
    </StoreProvider>
  )
  const view = render(ui(false))
  if (me !== 'Alex Morgan') act(() => { store.setMe(me) })
  return {
    store: () => store,
    svc: () => svc,
    run: (fn: () => unknown) => act(fn),
    /** Awaits one async service call inside act so the store projection flushes. */
    runA: async <T,>(fn: () => Promise<T>): Promise<T> => { let out!: T; await act(async () => { out = await fn() }); return out },
    show: () => view.rerender(ui(true)),
    unmount: view.unmount,
  }
}

const taylor = (): ActorRef => ({ id: 'Taylor Chen', role: 'operator' })
const riley = (): ActorRef => ({ id: 'Riley Brooks', role: 'analyst' })
const casey = (): ActorRef => ({ id: 'Casey Nguyen (Client)', role: 'viewer' })
const outsider = (): ActorRef => ({ id: 'No Such User', role: 'analyst' })
const ctx = (actor: ActorRef, projectId = 'all', corr = 't'): RequestContext => ({ actor, projectId, corr })

/** Everything execution-shaped: branch actions must never move any of it. */
const executionShape = (d: Db) =>
  JSON.stringify({
    operations: d.operations.map((o) => [o.id, o.status]),
    toolEvents: d.toolEvents.map((t) => [t.id, t.state, t.result]),
    approvals: d.approvals.map((a) => a.id),
  })

describe('branch service gates (ticket 43)', () => {
  it('retry transitions a failed branch into a pending approval request without executing anything', async () => {
    const h = mountFanout()
    const svc = h.svc().branches(taylor(), 'RT-2026-014')
    const before = executionShape(h.store().db)
    const res = await h.runA(() => svc.retry(ctx(taylor(), 'RT-2026-014'), 'BR-014-03', 'Transient timeout — rerun approved.'))
    expect(res.ok).toBe(true)
    const b = h.store().db.branches.find((x) => x.id === 'BR-014-03')!
    expect(b.state).toBe('failed') // the request waits; nothing re-ran
    expect(b).toMatchObject({ pendingRequest: 'retry', approval: 'pending' })
    expect(b.lastEvent).toContain('approval and preflight')
    expect(b.timeline.at(-1)!.text).toContain('Retry requested')
    expect(h.store().db.audit[0]).toMatchObject({ action: 'Requested branch retry', obj: 'BR-014-03', projectId: 'RT-2026-014', result: 'Pending', actor: 'Taylor Chen' })
    expect(executionShape(h.store().db)).toBe(before)
    h.unmount()
  })

  it('refuses retries on finished branches and duplicate pending requests, with reasons', async () => {
    const h = mountFanout()
    const svc = h.svc().branches(taylor(), 'RT-2026-014')
    const done = await h.runA(() => svc.retry(ctx(taylor(), 'RT-2026-014'), 'BR-014-01', 'why not'))
    expect(done.ok).toBe(false)
    if (!done.ok) expect(done.failure.message).toContain('Only failed, cancelled, paused or unknown')
    const first = await h.runA(() => svc.retry(ctx(taylor(), 'RT-2026-014'), 'BR-014-03', 'first'))
    expect(first.ok).toBe(true)
    const again = await h.runA(() => svc.retry(ctx(taylor(), 'RT-2026-014'), 'BR-014-03', 'second'))
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.failure.message).toContain('already pending approval')
    h.unmount()
  })

  it('cancel requires a reason, refuses terminal branches and is role/read-only-gated', async () => {
    const h = mountFanout('Alex Morgan')
    const svc = h.svc().branches(taylor(), 'RT-2026-014')
    const noReason = await h.runA(() => svc.cancel(ctx(taylor(), 'RT-2026-014'), 'BR-014-05', '   '))
    expect(noReason.ok).toBe(false)
    if (!noReason.ok) expect(noReason.failure.message).toContain('A reason is required')
    const terminal = await h.runA(() => svc.cancel(ctx(taylor(), 'RT-2026-014'), 'BR-014-01', 'already done'))
    expect(terminal.ok).toBe(false)
    if (!terminal.ok) expect(terminal.failure.message).toContain('already finished and cannot be cancelled')
    const ok = await h.runA(() => svc.cancel(ctx(taylor(), 'RT-2026-014'), 'BR-014-05', 'Not needed for the objective'))
    expect(ok.ok).toBe(true)
    expect(h.store().db.branches.find((x) => x.id === 'BR-014-05')).toMatchObject({ state: 'cancelled', pendingRequest: undefined })
    expect(h.store().db.audit[0]).toMatchObject({ action: 'Cancelled branch', result: 'Success', reason: 'Not needed for the objective' })
    // Viewer member: read-only context refuses with a reason (no content shown).
    const viewer = await h.runA(() => h.svc().branches(casey(), 'RT-2026-014').retry(ctx(casey(), 'RT-2026-014'), 'BR-014-03', 'why'))
    expect(viewer.ok).toBe(false)
    if (!viewer.ok) { expect(viewer.failure.kind).toBe('forbidden'); expect(viewer.failure.message).toContain('read-only') }
    // Analyst member: the role matrix refuses with a reason.
    const analyst = await h.runA(() => h.svc().branches(riley(), 'RT-2026-014').retry(ctx(riley(), 'RT-2026-014'), 'BR-014-03', 'why'))
    expect(analyst.ok).toBe(false)
    if (!analyst.ok) { expect(analyst.failure.kind).toBe('forbidden'); expect(analyst.failure.message).toContain('Your role cannot run or modify operations') }
    h.unmount()
  })

  it('reassign enforces eligible agents: connected and assigned to the branch project', async () => {
    const h = mountFanout()
    const svc = h.svc().branches(taylor(), 'RT-2026-014')
    const call = (agentId: string) => h.runA(() => svc.reassign(ctx(taylor(), 'RT-2026-014'), 'BR-014-03', agentId, 'spread the load'))
    const pool = await call('AG-012')
    expect(pool.ok).toBe(false)
    if (!pool.ok) expect(pool.failure.message).toContain('shared pool')
    const other = await call('AG-010')
    expect(other.ok).toBe(false)
    if (!other.ok) expect(other.failure.message).toContain('belongs to another project')
    const lost = await call('AG-009')
    expect(lost.ok).toBe(false)
    if (!lost.ok) expect(lost.failure.message).toContain('not connected')
    const ok = await call('AG-007')
    expect(ok.ok).toBe(true)
    const b = h.store().db.branches.find((x) => x.id === 'BR-014-03')!
    expect(b).toMatchObject({ pendingRequest: 'reassign', approval: 'pending' })
    expect(b.assignLog.at(-1)!.text).toContain('AG-008 → AG-007')
    expect(h.store().db.audit[0]).toMatchObject({ action: 'Requested branch reassignment', result: 'Pending' })
    h.unmount()
  })

  it('refuses cross-project actions without leaking branch content; non-members get not-found', async () => {
    const h = mountFanout()
    const svc = h.svc().branches(taylor(), 'RT-2026-015')
    const res = await h.runA(() => svc.retry(ctx(taylor(), 'RT-2026-015'), 'BR-014-01', 'why'))
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.failure.kind).toBe('forbidden')
      expect(res.failure.entity?.projectId).toBe('RT-2026-014')
      expect(res.failure.message).not.toContain('win-dc-01')
      expect(res.failure.message).not.toContain('host-info-collector')
    }
    const hidden = getBranchGroup(seed(), ctx(outsider(), 'all'), 'BG-014-01')
    expect(hidden.ok).toBe(false)
    if (!hidden.ok) {
      expect(hidden.failure.kind).toBe('not-found')
      expect(hidden.failure.message).not.toContain('Collect host')
      expect(hidden.failure.message).not.toContain('RT-2026-014')
    }
    h.unmount()
  })

  it('writes bind to the addressed branch: an aggregate-scope action lands on the branch project even after a project switch', async () => {
    const h = mountFanout()
    h.run(() => h.store().setPid('RT-2026-015'))
    const svc = h.svc().branches(taylor(), 'all')
    const res = await h.runA(() => svc.retry(ctx(taylor(), 'all'), 'BR-014-03', 'rerun after timeout'))
    expect(res.ok).toBe(true)
    expect(h.store().db.audit[0]).toMatchObject({ projectId: 'RT-2026-014', actor: 'Taylor Chen' })
    expect(h.store().db.branches.find((x) => x.id === 'BR-014-03')!.pendingRequest).toBe('retry')
    h.unmount()
  })
})

describe('branch read scope (ticket 43)', () => {
  it('lists the scoped groups with rollups; a non-member specific-project read is not-found', () => {
    const mine = listBranchGroups(seed(), ctx(taylor(), 'RT-2026-014'))
    expect(mine.ok).toBe(true)
    if (mine.ok) {
      expect(mine.data.groups).toHaveLength(1)
      expect(mine.data.groups[0]).toMatchObject({ overall: 'In progress' })
      expect(mine.data.groups[0]!.counts).toMatchObject({ total: 5, done: 2, failed: 1, open: 2, missing: 2 })
    }
    const denied = listBranchGroups(seed(), ctx(riley(), 'RT-2026-015'))
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.failure.kind).toBe('not-found')
  })

  it('a cross-context group read is refused with the owning project and no content', () => {
    const res = getBranchGroup(seed(), ctx(riley(), 'RT-2026-015'), 'BG-014-01')
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.failure.kind).toBe('forbidden')
      expect(res.failure.entity?.projectId).toBe('RT-2026-014')
      expect(res.failure.message).not.toContain('Collect host, account and service data')
    }
  })
})

describe('fanout screen on typed services (ticket 43)', () => {
  it('renders the scoped branch group with per-branch states; out-of-scope projects render the empty state without a leak', async () => {
    const h = mountFanout('Riley Brooks', '#/ai-fanout')
    h.show()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open branch BR-014-03, Failed' })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Open branch BR-014-05, Queued' })).toBeInTheDocument()
    // Keyboard operation on the graph nodes stays available (native buttons).
    fireEvent.click(screen.getByRole('button', { name: 'Open branch BR-014-01, Completed' }))
    expect(await screen.findByText('Branch Inspector')).toBeInTheDocument()
    // Timeline entries render in the drawer (alongside the Started field label).
    await waitFor(() => expect(screen.getAllByText('Started').length).toBeGreaterThan(1))
    h.unmount()
    // Switching to a project without an accessible group shows the empty state, no foreign data.
    const h2 = mountFanout('Riley Brooks', '#/ai-fanout')
    h2.show()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open branch BR-014-03, Failed' })).toBeInTheDocument())
    h2.run(() => h2.store().setPid('RT-2026-015'))
    await waitFor(() => expect(screen.getByText('No branch group in this project')).toBeInTheDocument())
    expect(screen.queryByText(/BG-014-01/)).not.toBeInTheDocument()
    h2.unmount()
  })

  it('the retry flow runs through the typed service and refetches the inspector', async () => {
    const h = mountFanout()
    h.show()
    fireEvent.click(await screen.findByRole('button', { name: 'Open branch BR-014-03, Failed' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Request Retry' }))
    fireEvent.change(screen.getByPlaceholderText('Why should this branch be retried?'), { target: { value: 'Transient timeout — rerun approved.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }))
    await waitFor(() => expect(screen.getByText('Retry pending approval')).toBeInTheDocument())
    expect(h.store().db.branches.find((x) => x.id === 'BR-014-03')).toMatchObject({ pendingRequest: 'retry', approval: 'pending', state: 'failed' })
    expect(screen.getByText(/Requested branch retry/)).toBeInTheDocument()
    h.unmount()
  })

  it('a legacy branch write publishes a ChangeSet and the Query-backed view refetches', async () => {
    const h = mountFanout()
    h.show()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open branch BR-014-05, Queued' })).toBeInTheDocument())
    h.run(() => h.store().A.cancelBranch('BR-014-05', 'Not needed for the objective'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open branch BR-014-05, Cancelled' })).toBeInTheDocument())
    h.unmount()
  })

  it('trace navigation goes through the router — no raw hash writer on this surface', async () => {
    const h = mountFanout()
    h.show()
    fireEvent.click(await screen.findByRole('button', { name: 'View Trace' }))
    await waitFor(() => expect(window.location.hash).toBe('#/ai-trace'))
    h.unmount()
  })
})
