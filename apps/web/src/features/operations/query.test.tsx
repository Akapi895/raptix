/**
 * Ticket 24: operations inventory read model — scoped aggregation with
 * categorized counts, filters/search/pagination, RBAC gates with reasons,
 * the legacy→Query bridge (a legacy-created operation appears without a
 * reload) and late-response isolation on project switch. Plus focused
 * handler tests for the category/page-clamp/denial edges.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { mountServices } from '../../test/helpers'
import { currentRoute, selectProject } from '../../router/navigate'
import { useProjectStore } from '../../state/stores'
import { useSessionStore } from '../../state/session'
import type { ConsoleServices } from '../../domain/console-services';
import type { RequestContext } from '../../domain/service'
import { routes } from '../../screens/c'
import { seed } from '../../demo/seed';
import { createOperationDraft, listOperations } from './service'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

/**
 * Mounts the providers with a probe, then optionally mounts the real
 * operations route. `show()` is separate so tests can install service spies
 * before the first query fires.
 */
function mountOps(me = 'Alex Morgan') {
  const Ops = routes.operations
  const h = mountServices(null, me)
  return { ...h, show: () => h.show(<Ops />) }
}

const newOp = (svc: ConsoleServices, name: string) => {
  const created = createOperationDraft(svc.authority, svc.clock, { actor: { id: 'Alex Morgan', role: 'manager' }, projectId: 'RT-2026-014', corr: 'operation-refetch' }, { name, owner: 'Taylor Chen', desc: '', objective: '', playbookId: 'PB-001', agents: [], assets: [], mode: 'Manual approval', schedule: '', needConfirm: true, note: '' })
  expect(created.ok).toBe(true)
  return created
}

describe('operations inventory (ticket 24)', () => {
  it('aggregates only accessible projects with categorized counts; non-member operations are invisible', async () => {
    const h = mountOps('Riley Brooks') // analyst — member of RT-2026-014 only
    h.show()
    await waitFor(() => expect(screen.getByText('Internal environment discovery')).toBeInTheDocument())
    expect(screen.getByText('Detection signal baseline')).toBeInTheDocument()
    expect(screen.queryByText('Cloud configuration validation')).not.toBeInTheDocument() // RT-2026-015 — not a member
    expect(screen.queryByText('External exposure mapping')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All 2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Running 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Completed 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Draft 0' })).toBeInTheDocument()
    h.unmount()
  })

  it('status category, search and technique filters apply to the scoped rows', async () => {
    const h = mountOps('Taylor Chen') // member of 014/015/016/017 — 5 operations
    h.show()
    await waitFor(() => expect(screen.getByRole('button', { name: 'All 5' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Running 2' }))
    await waitFor(() => expect(screen.getByText('Cloud configuration validation')).toBeInTheDocument())
    expect(screen.getByText('Internal environment discovery')).toBeInTheDocument()
    expect(screen.queryByText('Detection signal baseline')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'All 5' }))
    fireEvent.change(screen.getByPlaceholderText('Search by ID or name…'), { target: { value: 'Detection' } })
    await waitFor(() => expect(screen.getByText('Detection signal baseline')).toBeInTheDocument())
    expect(screen.queryByText('Internal environment discovery')).not.toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Search by ID or name…'), { target: { value: '' } })
    h.run(() => useSessionStore.getState().setFilter('operations.technique', 'T1087'))
    await waitFor(() => expect(screen.getByText('Showing operations that test technique T1087')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('button', { name: 'All 3' })).toBeInTheDocument())
    h.run(() => useSessionStore.getState().setFilter('operations.technique', ''))
    await waitFor(() => expect(screen.getByRole('button', { name: 'All 5' })).toBeInTheDocument())
    h.unmount()
  })

  it('paginates the scoped rows across pages', async () => {
    const h = mountOps('Taylor Chen')
    h.show()
    await waitFor(() => expect(screen.getByRole('button', { name: 'All 5' })).toBeInTheDocument())
    h.run(() => { for (let i = 0; i < 9; i++) newOp(h.svc(), `Pagination probe ${i + 1}`) })
    h.run(() => selectProject('RT-2026-014'))
    await waitFor(() => expect(screen.getByText('Page 1 of 2')).toBeInTheDocument())
    expect(screen.queryByText('Pagination probe 9')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(screen.getByText('Page 2 of 2')).toBeInTheDocument())
    expect(screen.getByText('Pagination probe 9')).toBeInTheDocument()
    h.unmount()
  })

  it('detail and creation links preserve the active project context', async () => {
    const h = mountOps('Taylor Chen')
    h.show()
    h.run(() => selectProject('RT-2026-014'))
    await waitFor(() => expect(screen.getByText('Internal environment discovery')).toBeInTheDocument())
    expect(useProjectStore.getState().pid).toBe('RT-2026-014')
    fireEvent.click(screen.getByText('Internal environment discovery'))
    await waitFor(() => expect(currentRoute().page).toBe('operation'))
    expect(currentRoute().id).toBe('OP-014')
    expect(useProjectStore.getState().pid).toBe('RT-2026-014')
    fireEvent.click(screen.getByRole('button', { name: 'Create Operation' }))
    await waitFor(() => expect(currentRoute().page).toBe('operation-new'))
    expect(useProjectStore.getState().pid).toBe('RT-2026-014')
    h.unmount()
  })

  it('gates creation behind the read-only context with a reason', async () => {
    const h = mountOps('Casey Nguyen (Client)') // viewer — member of RT-2026-014
    h.show()
    h.run(() => selectProject('RT-2026-014'))
    await waitFor(() => expect(screen.getByText('Internal environment discovery')).toBeInTheDocument())
    const create = screen.getByRole('button', { name: 'Create Operation' }) as HTMLButtonElement
    expect(create.disabled).toBe(true)
    expect(create.title).toBe('The Viewer role has read-only access.')
    expect(screen.getByText(/You can view operations and results only/)).toBeInTheDocument()
    h.unmount()
  })

  it('gates creation behind the run action with a reason for non-run roles', async () => {
    const h = mountOps('Riley Brooks') // analyst — can view RT-2026-014, cannot run
    h.show()
    h.run(() => selectProject('RT-2026-014'))
    await waitFor(() => expect(screen.getByText('Internal environment discovery')).toBeInTheDocument())
    const create = screen.getByRole('button', { name: 'Create Operation' }) as HTMLButtonElement
    expect(create.disabled).toBe(true)
    expect(create.title).toBe('Only a Manager or Operator can create operations.')
    h.unmount()
  })

  it('a legacy-created operation appears in the migrated inventory without a reload', async () => {
    const h = mountOps('Taylor Chen')
    h.show()
    h.run(() => selectProject('RT-2026-014'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'All 2' })).toBeInTheDocument())
    expect(screen.queryByText('Bridge-proof probe')).not.toBeInTheDocument()
    h.run(() => { newOp(h.svc(), 'Bridge-proof probe') })
    await waitFor(() => expect(screen.getByText('Bridge-proof probe')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'All 3' })).toBeInTheDocument()
    h.unmount()
  })

  it('a delayed response for a superseded scope never pollutes the switched view', async () => {
    let resolveGate!: () => void
    const gate = new Promise<void>((r) => { resolveGate = r })
    const h = mountOps()
    const svc = h.svc()
    const orig = svc.operations.bind(svc)
    vi.spyOn(svc, 'operations').mockImplementation((actor, project) => {
      const inner = orig(actor, project)
      if (project !== 'all') return inner
      return { ...inner, list: async (ctx, query) => { await gate; return inner.list(ctx, query) } }
    })
    h.show()
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument())
    h.run(() => selectProject('RT-2026-014'))
    await waitFor(() => expect(screen.getByText('Internal environment discovery')).toBeInTheDocument())
    await act(async () => { resolveGate(); await Promise.resolve() })
    expect(screen.getByText('Internal environment discovery')).toBeInTheDocument()
    expect(screen.queryByText('Cloud configuration validation')).not.toBeInTheDocument()
    expect(screen.queryByText('External exposure mapping')).not.toBeInTheDocument()
    const stale = h.qc().getQueryCache().findAll({ queryKey: ['operation'] })
      .find((q) => (q.queryKey[1] as { project?: string }).project === 'all')
    expect(stale?.state.data).toBeUndefined()
    h.unmount()
  })

  it('shows an error state instead of data when the selected project is out of scope', async () => {
    const h = mountOps('Riley Brooks')
    h.show()
    h.run(() => selectProject('RT-2026-015'))
    await waitFor(() => expect(screen.getByText('Operations could not be loaded')).toBeInTheDocument())
    expect(screen.getByText('Operations for this project are not available for your account.')).toBeInTheDocument()
    expect(screen.queryByText('Cloud configuration validation')).not.toBeInTheDocument()
    h.unmount()
  })

  it('shows the empty state for a project without operations', async () => {
    const h = mountOps('Dana Whitfield') // admin — reaches every project
    h.show()
    h.run(() => selectProject('PT-2026-006'))
    await waitFor(() => expect(screen.getByText('No operations in this project')).toBeInTheDocument())
    h.unmount()
  })
})

describe('listOperations handler', () => {
  const alex = { id: 'Alex Morgan', role: 'manager' as const }
  const allCtx: RequestContext = { actor: alex, projectId: 'all', corr: 't' }

  it('categorizes "needs approval" only for drafts linked to an in-review plan', () => {
    const d = structuredClone(seed())
    const pl = d.plans.find((x) => x.id === 'PL-023')!
    pl.status = 'in_review'
    d.operations.find((x) => x.id === 'OP-016')!.planId = 'PL-023'
    const res = listOperations(d, allCtx, { project: 'RT-2026-016' })
    expect(res.ok).toBe(true)
    if (res.ok) {
      // A review-pending draft appears under both pills, matching the legacy category semantics.
      expect(res.data.counts.needs).toBe(1)
      expect(res.data.counts.draft).toBe(1)
      expect(res.data.counts.all).toBe(1)
      expect(res.data.counts.running).toBe(0)
    }
  })

  it('clamps out-of-range pages into the valid range', () => {
    const high = listOperations(seed(), { actor: alex, projectId: 'RT-2026-014', corr: 't' }, { page: 99 })
    const low = listOperations(seed(), { actor: alex, projectId: 'RT-2026-014', corr: 't' }, { page: 0 })
    expect(high.ok).toBe(true)
    expect(low.ok).toBe(true)
    if (high.ok && low.ok) {
      expect(high.data.page).toBe(1)
      expect(low.data.page).toBe(1)
    }
  })

  it('denies a non-member specific-project read without leaking existence', () => {
    const riley = { id: 'Riley Brooks', role: 'analyst' as const }
    const res = listOperations(seed(), { actor: riley, projectId: 'RT-2026-015', corr: 't' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.failure.kind).toBe('not-found')
  })

  it('exposes approved, unlinked plans as ready operations references', () => {
    const res = listOperations(seed(), { actor: alex, projectId: 'RT-2026-014', corr: 't' })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.readyPlans).toEqual([])
      const d = structuredClone(seed())
      d.plans.find((x) => x.id === 'PL-021')!.opId = undefined
      const ready = listOperations(d, { actor: alex, projectId: 'RT-2026-014', corr: 't' })
      expect(ready.ok && ready.data.readyPlans.map((p) => p.id)).toEqual(['PL-021'])
    }
  })
})
