/**
 * Ticket 25: operation creation and scheduling on typed services.
 *
 * Handlers: scoped draft options, atomic create (selections re-validated,
 * pool-agent assignment, plan linkage, audit), draft updates that invalidate
 * stale preflight and refuse in-flight operations, and schedule writes that
 * normalize input to an absolute instant and publish one atomic ChangeSet.
 * Screens: the wizard creates through the service and the ticket-24 list
 * refetches it via the change bridge; a refused write keeps the form; the
 * schedule page blocks invalid input and the deep link resolves.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { ConsoleProviders } from '../../state/query'
import { StoreProvider, useServices, useStore, type Store } from '../../store'
import { createConsoleServices, type ConsoleServices } from '../../domain/service-factory'
import type { ActorRef, ChangeSet, RequestContext } from '../../domain/service'
import { routes } from '../../screens/c'
import { createOperationDraft, scheduleOperation, updateOperationDraft, type OperationDraftInput } from './service'

const Ops = routes.operations
const NewOp = routes['operation-new']
const Schedule = routes['operation-schedule']

afterEach(() => { cleanup(); vi.restoreAllMocks() })

let corrSeq = 0
const actor = (id: string, role: ActorRef['role']): ActorRef => ({ id, role })
const ctxOf = (a: ActorRef, projectId: string): RequestContext => ({ actor: a, projectId, corr: `w-${++corrSeq}` })
const ALEX = actor('Alex Morgan', 'manager')

const draftInput = (over: Partial<OperationDraftInput> = {}): OperationDraftInput => ({
  name: 'Service write proof', owner: 'Taylor Chen', desc: '', objective: '', playbookId: 'PB-001',
  agents: ['AG-012'], assets: ['AS-0141'], mode: 'Manual with confirmation', needConfirm: true,
  note: '', schedule: 'now', ...over,
})

describe('operation write handlers (ticket 25)', () => {
  it('creates a draft atomically: steps, pool-agent assignment, plan linkage and audit in one commit', () => {
    const svc = createConsoleServices()
    const seen: ChangeSet[] = []
    svc.subscribe((cs) => seen.push(cs))
    const res = createOperationDraft(svc.authority, svc.clock, ctxOf(ALEX, 'RT-2026-014'), draftInput({ planId: 'PL-021' }))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const db = svc.authority.snapshot()
    const op = db.operations.find((o) => o.id === res.data.op.id)!
    expect(op.id).toBe('OP-017')
    expect(op.status).toBe('draft')
    expect(op.agents).toEqual(['AG-012'])
    expect(db.agents.find((a) => a.id === 'AG-012')!.projectId).toBe('RT-2026-014')
    expect(op.steps).toHaveLength(db.plans.find((p) => p.id === 'PL-021')!.steps.length)
    expect(db.plans.find((p) => p.id === 'PL-021')!.opId).toBe('OP-017')
    expect(db.audit[0]).toMatchObject({ action: 'Created operation (draft)', obj: 'OP-017', actor: 'Alex Morgan', corr: expect.stringContaining('w-') })
    expect(seen).toHaveLength(1)
    expect(seen[0]!.entities).toContainEqual({ kind: 'operation', id: 'OP-017', projectId: 'RT-2026-014' })
    svc.dispose()
  })

  it('refuses out-of-scope selections and unapproved playbooks, committing nothing', () => {
    const svc = createConsoleServices()
    const before = svc.authority.snapshot()
    expect(createOperationDraft(svc.authority, svc.clock, ctxOf(ALEX, 'RT-2026-014'), draftInput({ assets: ['AS-0154'] })))
      .toMatchObject({ ok: false, failure: { kind: 'validation', message: expect.stringContaining('not approved in scope') } })
    expect(createOperationDraft(svc.authority, svc.clock, ctxOf(ALEX, 'RT-2026-014'), draftInput({ assets: ['AS-0201'] })))
      .toMatchObject({ ok: false, failure: { kind: 'validation', message: expect.stringContaining('does not belong to project') } })
    expect(createOperationDraft(svc.authority, svc.clock, ctxOf(ALEX, 'RT-2026-014'), draftInput({ playbookId: 'PB-004' })))
      .toMatchObject({ ok: false, failure: { kind: 'validation', message: expect.stringContaining('not approved') } })
    expect(createOperationDraft(svc.authority, svc.clock, ctxOf(ALEX, 'RT-2026-014'), draftInput({ agents: ['AG-007'] })))
      .toMatchObject({ ok: false, failure: { kind: 'validation', message: expect.stringContaining('busy with OP-014') } })
    expect(svc.authority.snapshot().operations).toHaveLength(before.operations.length)
    expect(svc.authority.snapshot().counters.op).toBe(before.counters.op)
    svc.dispose()
  })

  it('normalizes a schedule write to an absolute instant and publishes one atomic ChangeSet', () => {
    const svc = createConsoleServices()
    const seen: ChangeSet[] = []
    svc.subscribe((cs) => seen.push(cs))
    const res = scheduleOperation(svc.authority, svc.clock, ctxOf(ALEX, 'RT-2026-016'), 'OP-016', '2026-10-20T10:00')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const op = svc.authority.snapshot().operations.find((o) => o.id === 'OP-016')!
    expect(op.schedule).toBe('2026-10-20T10:00')
    expect(op.scheduleAt).toBe('2026-10-20T03:00:00.000Z')
    expect(res.data.scheduleInstant).toBe(Date.parse('2026-10-20T03:00:00.000Z'))
    // One atomic commit: the schedule, the preflight invalidation and the audit publish together.
    expect(seen).toHaveLength(1)
    expect(seen[0]!.entities).toContainEqual({ kind: 'operation', id: 'OP-016', projectId: 'RT-2026-016' })
    expect(seen[0]!.entities.some((e) => e.kind === 'audit')).toBe(true)
    expect(seen[0]!.at).toBe(svc.clock.now())
    svc.dispose()
  })

  it('refuses invalid schedules with a reason and never commits', () => {
    const svc = createConsoleServices()
    const cases: [string, string][] = [
      ['2026-10-13T09:00', 'Start time is in the past'],
      ['2026-10-17T20:00', 'outside the ROE window'],
      ['not-a-date', 'not a valid date and time'],
    ]
    for (const [at, reason] of cases) {
      expect(scheduleOperation(svc.authority, svc.clock, ctxOf(ALEX, 'RT-2026-016'), 'OP-016', at))
        .toMatchObject({ ok: false, failure: { kind: 'validation', message: expect.stringContaining(reason) } })
    }
    expect(svc.authority.snapshot().operations.find((o) => o.id === 'OP-016')!.schedule).toBeUndefined()
    svc.dispose()
  })

  it('blocks a schedule that conflicts with a reserved agent', () => {
    const svc = createConsoleServices()
    const first = createOperationDraft(svc.authority, svc.clock, ctxOf(ALEX, 'RT-2026-014'), draftInput())
    const second = createOperationDraft(svc.authority, svc.clock, ctxOf(ALEX, 'RT-2026-014'), draftInput({ agents: ['AG-012'], assets: ['AS-0142'] }))
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(scheduleOperation(svc.authority, svc.clock, ctxOf(ALEX, 'RT-2026-014'), first.data.op.id, '2026-10-20T10:00').ok).toBe(true)
    expect(scheduleOperation(svc.authority, svc.clock, ctxOf(ALEX, 'RT-2026-014'), second.data.op.id, '2026-10-20T10:30'))
      .toMatchObject({ ok: false, failure: { kind: 'validation', message: expect.stringContaining('AG-012 is reserved') } })
    expect(svc.authority.snapshot().operations.find((o) => o.id === second.data.op.id)!.schedule).toBeUndefined()
    svc.dispose()
  })

  it('refuses in-flight operations and enforces role gates with reasons', () => {
    const svc = createConsoleServices()
    expect(scheduleOperation(svc.authority, svc.clock, ctxOf(ALEX, 'RT-2026-014'), 'OP-014', '2026-10-20T10:00'))
      .toMatchObject({ ok: false, failure: { kind: 'validation', message: expect.stringContaining('only Draft or Ready operations can be scheduled') } })
    expect(updateOperationDraft(svc.authority, svc.clock, ctxOf(ALEX, 'RT-2026-014'), 'OP-014', { name: 'Nope' }))
      .toMatchObject({ ok: false, failure: { kind: 'validation', message: expect.stringContaining('can be edited') } })
    const riley = actor('Riley Brooks', 'analyst')
    expect(createOperationDraft(svc.authority, svc.clock, ctxOf(riley, 'RT-2026-014'), draftInput()))
      .toMatchObject({ ok: false, failure: { kind: 'forbidden', message: 'Only a Manager or Operator can create operations.' } })
    // Riley is a member of RT-2026-014 only; schedule the addressed draft there.
    const memberDraft = createOperationDraft(svc.authority, svc.clock, ctxOf(ALEX, 'RT-2026-014'), draftInput())
    expect(memberDraft.ok).toBe(true)
    if (!memberDraft.ok) return
    expect(scheduleOperation(svc.authority, svc.clock, ctxOf(riley, 'RT-2026-014'), memberDraft.data.op.id, '2026-10-20T10:00'))
      .toMatchObject({ ok: false, failure: { kind: 'forbidden', message: 'Only a Manager or Operator can schedule operations.' } })
    const casey = actor('Casey Nguyen (Client)', 'viewer')
    expect(createOperationDraft(svc.authority, svc.clock, ctxOf(casey, 'RT-2026-014'), draftInput()))
      .toMatchObject({ ok: false, failure: { kind: 'forbidden', message: expect.stringContaining('read-only access') } })
    // A non-member's addressed write stays not-found (no existence leak).
    expect(scheduleOperation(svc.authority, svc.clock, ctxOf(riley, 'RT-2026-016'), 'OP-016', '2026-10-20T10:00'))
      .toMatchObject({ ok: false, failure: { kind: 'not-found' } })
    svc.dispose()
  })

  it('draft updates invalidate the stale preflight snapshot; a foreign selection is refused', () => {
    const svc = createConsoleServices()
    svc.authority.commit('setup', (d) => {
      const op = d.operations.find((o) => o.id === 'OP-DRAFT-017')!
      op.status = 'ready'
      op.preflightAt = 'Oct 13, 2026, 9:00 AM (UTC+7)'
    })
    expect(updateOperationDraft(svc.authority, svc.clock, ctxOf(ALEX, 'RT-2026-017'), 'OP-DRAFT-017', { name: 'Renamed draft' }).ok).toBe(true)
    const op = svc.authority.snapshot().operations.find((o) => o.id === 'OP-DRAFT-017')!
    expect(op.name).toBe('Renamed draft')
    expect(op.preflightAt).toBeUndefined()
    expect(op.status).toBe('draft')
    expect(updateOperationDraft(svc.authority, svc.clock, ctxOf(ALEX, 'RT-2026-017'), 'OP-DRAFT-017', { assets: ['AS-0141'] }))
      .toMatchObject({ ok: false, failure: { kind: 'validation', message: expect.stringContaining('does not belong to project') } })
    svc.dispose()
  })

  it('scopes the draft options: approved playbooks only, eligible agents, in-scope assets', async () => {
    const svc = createConsoleServices()
    const read = svc.operations(ALEX, 'RT-2026-014')
    let res!: Awaited<ReturnType<typeof read.draftOptions>>
    await act(async () => { res = await read.draftOptions(ctxOf(ALEX, 'RT-2026-014')) })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.playbooks.map((p) => p.id)).toEqual(['PB-001', 'PB-002', 'PB-003']) // PB-004 is a draft — unavailable
    expect(res.data.agents.find((r) => r.agent.id === 'AG-007')?.issue).toContain('Busy with OP-014')
    expect(res.data.agents.find((r) => r.agent.id === 'AG-009')?.issue).toBe('') // disconnected agents stay selectable; preflight fails later
    expect(res.data.agents.find((r) => r.agent.id === 'AG-012')?.issue).toBe('')
    expect(res.data.assets.find((r) => r.asset.id === 'AS-0153')?.issue).toContain('Out of scope')
    expect(res.data.assets.find((r) => r.asset.id === 'AS-0154')?.issue).toContain('pending')
    expect(res.data.assets.find((r) => r.asset.id === 'AS-0141')?.issue).toBe('')
    // Editing an addressed draft resolves its own project, with edit-aware agent issues.
    let edit!: Awaited<ReturnType<typeof read.draftOptions>>
    await act(async () => { edit = await svc.operations(ALEX, 'all').draftOptions(ctxOf(ALEX, 'all'), 'OP-DRAFT-017') })
    expect(edit.ok && edit.data.project.id).toBe('RT-2026-017')
    svc.dispose()
  })
})

/* ───────────── Screen tests ───────────── */

function Probe({ ready }: { ready: (s: Store, svc: ConsoleServices, qc: QueryClient) => void }) {
  ready(useStore(), useServices(), useQueryClient())
  return null
}

/** Mounts the providers with a probe; `show(ui)` then mounts the screens under test. */
function mountProbe(me = 'Alex Morgan') {
  let store!: Store
  let svc!: ConsoleServices
  let qc!: QueryClient
  const ui = (children: React.ReactNode) => (
    <StoreProvider>
      <ConsoleProviders>
        <Probe ready={(s, v, c) => { store = s; svc = v; qc = c }} />
        {children}
      </ConsoleProviders>
    </StoreProvider>
  )
  const view = render(ui(null))
  if (me !== 'Alex Morgan') act(() => { store.setMe(me) })
  return {
    store: () => store,
    svc: () => svc,
    qc: () => qc,
    run: (fn: () => unknown) => act(fn),
    show: (children: React.ReactNode) => view.rerender(ui(children)),
    unmount: view.unmount,
  }
}

describe('operation wizard (ticket 25 — screens)', () => {
  it('creates an operation with playbook/agents/assets selection; the ticket-24 list refetches it', async () => {
    const h = mountProbe()
    h.run(() => h.store().setPid('RT-2026-014'))
    h.show(<>
      <Ops />
      <NewOp />
    </>)
    await waitFor(() => expect(screen.getByRole('button', { name: 'All 2' })).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText('e.g. Environment discovery simulation'), { target: { value: 'Service write proof' } })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'PB-001' } })
    await waitFor(() => expect(screen.getByText('Windows, Linux')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /web-01/ })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('checkbox', { name: /web-01/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /AG-012/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Save Draft' })[0]!)
    // The ChangeSet invalidated the ticket-24 list query: the new draft appears without a reload.
    await waitFor(() => expect(screen.getByRole('button', { name: 'All 3' })).toBeInTheDocument())
    const created = h.store().db.operations.find((o) => o.name === 'Service write proof')!
    expect(created.id).toBe('OP-017')
    expect(created.playbookId).toBe('PB-001')
    expect(created.agents).toEqual(['AG-012'])
    expect(created.assets).toContain('AS-0141')
    expect(h.store().db.agents.find((a) => a.id === 'AG-012')!.projectId).toBe('RT-2026-014')
    h.unmount()
  })

  it('a refused write renders the reason, keeps the form data and never duplicates', async () => {
    const h = mountProbe()
    h.run(() => h.store().setPid('RT-2026-014'))
    const before = h.store().db.operations.length
    h.show(<NewOp />)
    await waitFor(() => expect(screen.getByPlaceholderText('e.g. Environment discovery simulation')).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText('e.g. Environment discovery simulation'), { target: { value: 'Refused write proof' } })
    const svc = h.svc()
    const orig = svc.operations.bind(svc)
    vi.spyOn(svc, 'operations').mockImplementation((a, p) => {
      const inner = orig(a, p)
      return { ...inner, create: async () => ({ ok: false as const, failure: { kind: 'validation' as const, message: 'Simulated service refusal.' } }) }
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Save Draft' })[0]!)
    await waitFor(() => expect(screen.getByText(/Simulated service refusal\./)).toBeInTheDocument())
    // Form data preserved, no navigation, no operation created or duplicated.
    expect((screen.getByPlaceholderText('e.g. Environment discovery simulation') as HTMLInputElement).value).toBe('Refused write proof')
    expect(h.store().db.operations).toHaveLength(before)
    h.unmount()
  })
})

describe('operation schedule (ticket 25 — screens)', () => {
  it('blocks invalid input at the button and saves a valid schedule through the service', async () => {
    const h = mountProbe()
    h.run(() => { h.store().setPid('RT-2026-016'); h.store().go('operation-schedule', { id: 'OP-016' }) })
    h.show(<Schedule />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Schedule — OP-016' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }))
    const at = screen.getByLabelText(/^Scheduled start/) as HTMLInputElement
    // Past start: the reason is shown and the save button cannot be pressed.
    fireEvent.change(at, { target: { value: '2026-10-13T09:00' } })
    const save = screen.getByRole('button', { name: /Save schedule/ }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    expect(screen.getByText('Start time is in the past.')).toBeInTheDocument()
    expect(h.store().db.operations.find((o) => o.id === 'OP-016')!.schedule).toBeUndefined()
    // Valid schedule: the typed write commits and the screen navigates to preflight.
    fireEvent.change(at, { target: { value: '2026-10-20T10:00' } })
    expect((screen.getByRole('button', { name: /Save schedule/ }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: /Save schedule/ }))
    await waitFor(() => expect(h.store().route.page).toBe('preflight'))
    const op = h.store().db.operations.find((o) => o.id === 'OP-016')!
    expect(op.schedule).toBe('2026-10-20T10:00')
    expect(op.scheduleAt).toBe('2026-10-20T03:00:00.000Z')
    expect(op.preflightAt).toBeUndefined()
    h.unmount()
  })

  it('the deep link #/operation-schedule/OP-016 resolves to the schedule screen', () => {
    window.location.hash = '#/operation-schedule/OP-016'
    const h = mountProbe()
    h.show(<Schedule />)
    expect(screen.getByRole('heading', { name: 'Schedule — OP-016' })).toBeInTheDocument()
    expect(screen.getByText('Start time')).toBeInTheDocument()
    expect(screen.getByText(/ROE window/)).toBeInTheDocument()
    h.unmount()
    window.location.hash = ''
  })
})
