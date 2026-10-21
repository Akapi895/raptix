/**
 * Ticket 16: the project portfolio runs on the typed project service through
 * Query — accessible canonical projects only (non-members never see rows),
 * search/status/clear filters, pagination, CSV export and pinning, RBAC
 * gates with the shared policy's reasons, the bidirectional legacy bridge
 * (legacy createProject appears in the new list; a service pin updates
 * legacy views and a legacy edit refetches the new list) and
 * delayed-response isolation on project switch.
 */
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import type { ProjectDraft } from '../features/wizard/draft'
import { createProjectTransaction } from '../features/wizard/service'
import type { ConsoleServices } from '../domain/console-services';
import { createConsoleServices } from '../demo/services';
import type { ActorRef, RequestContext } from '../domain/service'
import type { Role } from '../domain/entities'
import { useDb } from '../state/console'
import { useToastStore } from '../state/stores'
import { selectProject } from '../router/navigate'
import { createPortfolioHandlers } from './portfolio-handlers'
import { mountServices } from '../test/helpers'
import { ProjectPortfolio } from './b-portfolio'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  Reflect.deleteProperty(window.URL, 'createObjectURL')
  Reflect.deleteProperty(window.URL, 'revokeObjectURL')
})

const ALEX: ActorRef = { id: 'Alex Morgan', role: 'manager' }
let corrSeq = 0
const ctxOf = (): RequestContext => ({ actor: ALEX, projectId: '', corr: `pf-${++corrSeq}` })

/** Typed consumer observing the one dataset — the canonical view of the bridge proof. */
function PinProbe({ id }: { id: string }) {
  const p = useDb().projects.find((x) => x.id === id)
  return <p data-testid="legacy-pin">{p ? `${p.id}:${p.pinned}` : 'missing'}</p>
}

function mountPortfolio({ me, wire, extra }: { me?: string; wire?: (svc: ConsoleServices) => void; extra?: ReactNode } = {}) {
  const view = mountServices(
    <>
      {extra}
      <ProjectPortfolio />
    </>,
    me,
    wire,
  )
  return { svc: view.svc, db: view.db, run: (fn: () => unknown) => act(fn), unmount: view.unmount }
}

const draft = (id: string): ProjectDraft => ({
  name: `Portfolio Bridge ${id}`, id, client: 'Contoso Labs (Demo)', type: 'Red Team', desc: 'Created by the legacy action for the bridge proof.',
  start: 'Oct 13, 2026', end: 'Nov 13, 2026', tz: 'UTC+07:00', owner: 'Alex Morgan', tags: [],
  goal: 'Prove the bridge', objectives: [], metrics: '', unit: '', reportReq: '',
  scopeDesc: '', window: 'Mon–Fri, 9:00 AM–5:00 PM (UTC+7)', limits: [], emergency: 'Robin Vale — +1 (555) 010-0014',
  channel: '', roeFile: '', approver: 'Pat Kim', assets: [], members: [],
})

function openRowMenu(id: string) {
  fireEvent.click(screen.getByLabelText(`More actions for ${id}`))
}

describe('accessible canonical projects', () => {
  it('renders only the projects the persona can access; a non-member project is hidden', async () => {
    mountPortfolio({ me: 'Riley Brooks' })
    expect(await screen.findByText('RT-2026-014')).toBeInTheDocument()
    expect(screen.getByText('Showing all 1 record')).toBeInTheDocument()
    expect(screen.queryByText('RT-2026-015')).not.toBeInTheDocument()
    expect(screen.queryByText('PT-2026-006')).not.toBeInTheDocument()
  })
})

describe('search, filters and pagination', () => {
  it('search narrows rows by id, name and client; Clear filters restores the list', async () => {
    mountPortfolio()
    await screen.findByText('RT-2026-014')
    fireEvent.change(screen.getByLabelText('Search ID, name, client…'), { target: { value: 'Northwind' } })
    expect(screen.getByText('RT-2026-014')).toBeInTheDocument()
    expect(screen.getByText('PT-2026-006')).toBeInTheDocument()
    expect(screen.queryByText('RT-2026-015')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(await screen.findByText('RT-2026-015')).toBeInTheDocument()
    expect(screen.getByText('Showing all 6 records')).toBeInTheDocument()
  })

  it('the status filter narrows rows and the pager paginates past the page size', async () => {
    const h = mountPortfolio()
    await screen.findByText('RT-2026-014')
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'active' } })
    expect(screen.getByText('RT-2026-014')).toBeInTheDocument()
    expect(screen.getByText('RT-2026-015')).toBeInTheDocument()
    expect(screen.queryByText('RT-2026-016')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))

    for (const id of ['RT-2026-018', 'RT-2026-019', 'RT-2026-020']) h.run(() => { expect(createProjectTransaction(h.svc().authority, h.svc().clock, ctxOf(), draft(id), true).ok).toBe(true) })
    h.run(() => { selectProject('all') })
    expect(await screen.findByText('RT-2026-020')).toBeInTheDocument()
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(await screen.findByText('RT-2026-009')).toBeInTheDocument()
    expect(screen.queryByText('RT-2026-020')).not.toBeInTheDocument()
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument()
  })
})

describe('CSV export', () => {
  it('exports the filtered rows as CSV and toasts the count', async () => {
    const blobs: Blob[] = []
    Object.defineProperty(window.URL, 'createObjectURL', { configurable: true, value: (b: Blob) => { blobs.push(b); return `blob:${blobs.length}` } })
    Object.defineProperty(window.URL, 'revokeObjectURL', { configurable: true, value: () => {} })
    mountPortfolio()
    await screen.findByText('RT-2026-014')
    fireEvent.click(screen.getByRole('button', { name: 'Export List' }))
    expect(useToastStore.getState().toasts.some((t) => t.text === 'Exported 6 projects (demo data)')).toBe(true)
    expect((await blobs[0].text())).toContain('Project ID')
    expect(await blobs[0].text()).toContain('RT-2026-016')

    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'active' } })
    await screen.findByText('RT-2026-015')
    fireEvent.click(screen.getByRole('button', { name: 'Export List' }))
    const csv = await blobs[1].text()
    expect(csv).toContain('RT-2026-014')
    expect(csv).toContain('RT-2026-015')
    expect(csv).not.toContain('RT-2026-016')
  })
})

describe('pinning and the bidirectional legacy bridge', () => {
  it('a service pin updates the legacy view; a legacy edit refetches the new list', async () => {
    const h = mountPortfolio({ extra: <PinProbe id="RT-2026-014" /> })
    expect(await screen.findByLabelText('Pinned')).toBeInTheDocument()
    expect(screen.getByTestId('legacy-pin')).toHaveTextContent('RT-2026-014:true')

    openRowMenu('RT-2026-014')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Unpin' }))
    await waitFor(() => expect(screen.getByTestId('legacy-pin')).toHaveTextContent('RT-2026-014:false'))
    expect(useToastStore.getState().toasts.some((t) => t.text === 'Unpinned RT-2026-014')).toBe(true)
    await waitFor(() => expect(screen.queryByLabelText('Pinned')).not.toBeInTheDocument())

    const repin = await act(async () => createPortfolioHandlers(h.svc(), ALEX, 'all').setPinned('RT-2026-014', true))
    expect(repin).toMatchObject({ ok: true })
    await waitFor(() => expect(screen.getByTestId('legacy-pin')).toHaveTextContent('RT-2026-014:true'))
    expect(await screen.findByLabelText('Pinned')).toBeInTheDocument()
  })

  it('a legacy-created project appears in the new portfolio (bridge direction 1)', async () => {
    const h = mountPortfolio()
    await screen.findByText('RT-2026-014')
    h.run(() => { expect(createProjectTransaction(h.svc().authority, h.svc().clock, ctxOf(), draft('RT-2026-018'), true).ok).toBe(true) })
    expect(await screen.findByText('RT-2026-018')).toBeInTheDocument()
    expect(h.db().projects.some((p) => p.id === 'RT-2026-018')).toBe(true)
  })
})

describe('RBAC gates with reasons', () => {
  it('a viewer sees disabled create/export/pin/edit controls that state the rule', async () => {
    mountPortfolio({ me: 'Casey Nguyen (Client)' })
    expect(await screen.findByText('RT-2026-014')).toBeInTheDocument()
    expect(screen.getByText('You cannot create projects. Ask a Red Team Manager or Organization Admin.')).toBeInTheDocument()

    const create = screen.getByRole('button', { name: 'Create Project' })
    expect(create).toBeDisabled()
    expect(create).toHaveAttribute('title', 'Only a Red Team Manager or Organization Admin can create projects')
    const exportBtn = screen.getByRole('button', { name: 'Export List' })
    expect(exportBtn).toBeDisabled()
    expect(exportBtn).toHaveAttribute('title', 'Viewers cannot export the list')

    openRowMenu('RT-2026-014')
    const edit = screen.getByRole('menuitem', { name: 'Edit Project' })
    expect(edit).toBeDisabled()
    expect(edit).toHaveAttribute('title', 'Requires permission to edit scope')
    const pin = screen.getByRole('menuitem', { name: 'Unpin' })
    expect(pin).toBeDisabled()
    expect(pin).toHaveAttribute('title', 'Viewers have read-only access')
  })
})

describe('loading, error and delayed-response isolation', () => {
  it('switching projects cancels the stale aggregate read; the late response never widens the view', async () => {
    let resolveAll!: () => void
    const gate = new Promise<void>((r) => { resolveAll = r })
    mountPortfolio({
      wire: (svc) => {
        const orig = svc.forScope.bind(svc)
        vi.spyOn(svc, 'forScope').mockImplementation((actor, project) => {
          const ps = orig(actor, project)
          if (project !== 'all') return ps
          return { ...ps, list: async (...args) => { await gate; return ps.list(...args) } }
        })
      },
    })
    expect(screen.getByLabelText('Loading projects')).toBeInTheDocument()

    act(() => { selectProject('RT-2026-014') })
    expect(await screen.findByText('RT-2026-014')).toBeInTheDocument()
    expect(screen.queryByText('RT-2026-015')).not.toBeInTheDocument()
    expect(screen.getByText('Showing all 1 record')).toBeInTheDocument()

    await act(async () => { resolveAll(); await new Promise((r) => setTimeout(r, 0)) })
    expect(screen.getByText('RT-2026-014')).toBeInTheDocument()
    expect(screen.queryByText('RT-2026-015')).not.toBeInTheDocument()
    expect(screen.queryByText('PT-2026-006')).not.toBeInTheDocument()
  })

  it('a service failure renders the error state and Retry refetches successfully', async () => {
    let fail = true
    const h = mountPortfolio({
      wire: (svc) => {
        const orig = svc.forScope.bind(svc)
        vi.spyOn(svc, 'forScope').mockImplementation((actor, project) => {
          const ps = orig(actor, project)
          return { ...ps, list: async (...args) => (fail ? { ok: false as const, failure: { kind: 'unavailable' as const, message: 'The console service is temporarily unavailable.' } } : ps.list(...args)) }
        })
      },
    })
    expect(await screen.findByText('Could not load projects')).toBeInTheDocument()
    expect(screen.getByText('The console service is temporarily unavailable.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('RT-2026-014')).toBeInTheDocument()
    expect(h.db().projects.length).toBe(6)
  })
})

describe('portfolio handlers: authorization reasons', () => {
  const actor = (id: string, role: Role) => ({ id, role })

  it('maps the store aggregate id to the service aggregate read and scopes narrow reads', async () => {
    const svc = createConsoleServices()
    const all = await createPortfolioHandlers(svc, actor('Alex Morgan', 'manager'), 'all').listAccessible()
    expect(all.ok && all.data.total).toBe(6)
    const one = await createPortfolioHandlers(svc, actor('Alex Morgan', 'manager'), 'RT-2026-014').listAccessible()
    expect(one.ok && one.data.items.map((p) => p.id)).toEqual(['RT-2026-014'])
    svc.dispose()
  })

  it('pin refuses a viewer and a closed project with the matching reason, without committing', async () => {
    const svc = createConsoleServices()
    const seen: unknown[] = []
    svc.subscribe((cs) => seen.push(cs))
    const casey = createPortfolioHandlers(svc, actor('Casey Nguyen (Client)', 'viewer'), 'all')
    const viewerDenial = await casey.setPinned('RT-2026-014', false)
    expect(viewerDenial).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: 'Only a Red Team Manager or Organization Admin can pin projects.' }) })

    const pat = createPortfolioHandlers(svc, actor('Pat Kim', 'reviewer'), 'all')
    const closedDenial = await pat.setPinned('RT-2026-009', true)
    expect(closedDenial).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: 'This project is closed or cancelled and is read-only.' }) })
    expect(seen).toEqual([])
    expect(svc.authority.snapshot().projects.find((p) => p.id === 'RT-2026-014')!.pinned).toBe(true)
    svc.dispose()
  })

  it('a member read of a foreign project stays not-found; a manager pin commits', async () => {
    const svc = createConsoleServices()
    const riley = createPortfolioHandlers(svc, actor('Riley Brooks', 'analyst'), 'all')
    const foreign = await riley.read('RT-2026-015')
    expect(foreign).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'not-found' }) })

    const alex = createPortfolioHandlers(svc, actor('Alex Morgan', 'manager'), 'all')
    const pinned = await alex.setPinned('RT-2026-014', false)
    expect(pinned.ok && pinned.data.pinned).toBe(false)
    expect(svc.authority.snapshot().projects.find((p) => p.id === 'RT-2026-014')!.pinned).toBe(false)
    svc.dispose()
  })
})
