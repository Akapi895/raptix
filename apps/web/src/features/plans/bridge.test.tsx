/**
 * Ticket 40: the plan↔operation bridge on typed handlers
 * (src/features/plans/bridge.ts).
 *
 * Covered here: an approved plan admits exactly ONE draft operation that
 * keeps the plan's approval binding — the whole binding (operation, plan pin,
 * pool agents, audit) is one atomic ChangeSet and repeated requests return
 * the same operation instead of duplicating it; unusable approvals refuse at
 * binding time (wrong status and the ticket-39 absolute 24h expiry, re-checked
 * with the factory clock while the stored status string still reads
 * `approved`), as do wrong-project scopes and read-only roles; the real
 * operation API keeps the binding honest — start refuses a failed current
 * preflight and an approval past its deadline, resume refuses at the deadline
 * boundary — and the plan approval itself never starts anything; the bridge
 * is proven both directions (typed write → legacy store + My Tasks + the
 * operations console refetch, legacy console entry → typed operations read).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { createHashRouter, RouterProvider } from 'react-router'
import { createConsoleServices } from '../../demo/services';
import type { ConsoleServices } from '../../domain/console-services';
import type { ActorRef, ChangeSet, RequestContext } from '../../domain/service'
import { selectProject } from '../../router/navigate'
import { mountServices } from '../../test/helpers'
import { createOperationDraft, pauseOperation, resumeOperation, runOperationPreflight, startOperation, stopOperation } from '../operations/service'
import { DAY_MS } from './service'
import { createOperationFromPlanTransaction } from './bridge'
import { MyTasks } from '../../screens/a-tasks'
import { routes } from '../../screens/c'

afterEach(() => { cleanup(); window.location.hash = '' })

const TAYLOR: ActorRef = { id: 'Taylor Chen', role: 'operator' }
const SAM: ActorRef = { id: 'Sam Patel', role: 'manager' }
const PAT: ActorRef = { id: 'Pat Kim', role: 'reviewer' }
const CASEY: ActorRef = { id: 'Casey Nguyen (Client)', role: 'viewer' }
let corrSeq = 0
const ctx = (actor: ActorRef, projectId = 'all'): RequestContext => ({ actor, projectId, corr: `corr-${++corrSeq}` })

/** Mounts the providers (optionally the My Tasks inbox + operations console). */
function mountConsole(me = 'Alex Morgan', withScreens = false) {
  window.location.hash = withScreens ? '#/tasks' : ''
  if (withScreens) {
    const router = createHashRouter([{ path: '*', element: <><MyTasks /><routes.operations /></> }])
    return mountServices(<RouterProvider router={router} />, me)
  }
  return mountServices(null, me)
}

/** Approves a fresh revision of PL-021 (Taylor requests, Pat decides); returns the approved plan id. */
async function approveRevisedPlan(svc: ConsoleServices, changes: string[] = ['Add an approval gate to step 3']) {
  const revised = await svc.plans(TAYLOR, 'all').revise(ctx(TAYLOR), 'PL-021', changes)
  expect(revised.ok).toBe(true)
  const id = revised.ok ? revised.data.planId : ''
  await svc.plans(TAYLOR, 'all').requestReview(ctx(TAYLOR), id)
  const approved = await svc.plans(PAT, 'all').decide(ctx(PAT), id, 'approved', 'Gated as requested.')
  expect(approved.ok).toBe(true)
  return id
}

describe('plan → operation binding (ticket 40)', () => {
  it('binds an approved plan to one draft operation in a single atomic ChangeSet; repeats never duplicate', async () => {
    const svc = createConsoleServices()
    const seen: ChangeSet[] = []
    svc.subscribe((cs) => seen.push(cs))
    await approveRevisedPlan(svc)
    seen.length = 0
    const bridged = createOperationFromPlanTransaction(svc.authority, svc.clock, ctx(TAYLOR, 'RT-2026-014'), 'PL-024')
    expect(bridged.ok).toBe(true)
    if (!bridged.ok) return
    expect(bridged.data).toMatchObject({ planId: 'PL-024', projectId: 'RT-2026-014', opId: 'OP-017', created: true })
    const d = svc.authority.snapshot()
    const op = d.operations.find((o) => o.id === 'OP-017')!
    // The approval admitted a DRAFT: nothing started, nothing reserved, no session.
    expect(op).toMatchObject({ status: 'draft', startedAt: '—', planId: 'PL-024', owner: 'Taylor Chen', mode: 'Manual approval', agents: ['AG-007', 'AG-008'] })
    expect(op.sessionId).toBeUndefined()
    expect(op.steps).toHaveLength(d.plans.find((p) => p.id === 'PL-024')!.steps.length)
    expect(d.agents.find((a) => a.id === 'AG-007')!.op).toBe('OP-014') // reservations happen at start, not at binding
    // The binding is committed with the operation in ONE ChangeSet; the plan stays approved.
    expect(d.plans.find((p) => p.id === 'PL-024')!.opId).toBe('OP-017')
    expect(d.plans.find((p) => p.id === 'PL-024')!.status).toBe('approved')
    expect(seen).toHaveLength(1)
    expect(seen[0]!.entities).toContainEqual({ kind: 'operation', id: 'OP-017', projectId: 'RT-2026-014' })
    expect(seen[0]!.entities).toContainEqual({ kind: 'plan', id: 'PL-024', projectId: 'RT-2026-014' })
    expect(d.audit[0]).toMatchObject({ action: 'Created operation from plan', obj: 'OP-017', actor: 'Taylor Chen' })
    // A repeated request returns the same operation and commits nothing.
    seen.length = 0
    const again = createOperationFromPlanTransaction(svc.authority, svc.clock, ctx(TAYLOR, 'RT-2026-014'), 'PL-024')
    expect(again.ok && again.data.opId === 'OP-017' && again.data.created === false).toBe(true)
    expect(seen).toHaveLength(0)
    expect(svc.authority.snapshot().operations).toHaveLength(d.operations.length)
    svc.dispose()
  })

  it('refuses unusable approvals at binding time — status, expiry, wrong-project scope, read-only role', async () => {
    const svc = createConsoleServices()
    const before = svc.authority.snapshot()
    // Draft, in-review and superseded plans cannot bridge.
    for (const id of ['PL-023', 'PL-022', 'PL-020']) {
      const refused = createOperationFromPlanTransaction(svc.authority, svc.clock, ctx(TAYLOR), id)
      expect(refused).toMatchObject({ ok: false, failure: { kind: 'conflict', message: 'Only an approved plan can be executed.' } })
    }
    // A rejected plan cannot bridge either (decided through the lifecycle handlers).
    expect((await svc.plans(PAT, 'all').decide(ctx(PAT), 'PL-022', 'rejected', 'Not this quarter.')).ok).toBe(true)
    expect(createOperationFromPlanTransaction(svc.authority, svc.clock, ctx(TAYLOR), 'PL-022').ok).toBe(false)
    // An approval past its absolute deadline refuses even while the stored status reads approved.
    const deadline = Date.parse('2026-10-14T09:25:00+07:00')
    svc.clock.advance(deadline - svc.clock.now())
    const expired = createOperationFromPlanTransaction(svc.authority, svc.clock, ctx(TAYLOR), 'PL-021')
    expect(expired.ok).toBe(false)
    if (!expired.ok) expect(expired.failure.message).toContain('expired')
    expect(svc.authority.snapshot().plans.find((p) => p.id === 'PL-021')!.status).toBe('approved')
    // Wrong-project scope and read-only roles refuse with reasons; nothing committed anywhere.
    expect(createOperationFromPlanTransaction(svc.authority, svc.clock, ctx(TAYLOR, 'RT-2026-015'), 'PL-021'))
      .toMatchObject({ ok: false, failure: { kind: 'forbidden', message: expect.stringContaining('Switch to that project') } })
    expect(createOperationFromPlanTransaction(svc.authority, svc.clock, ctx(CASEY, 'RT-2026-014'), 'PL-021'))
      .toMatchObject({ ok: false, failure: { kind: 'forbidden', message: expect.stringContaining('read-only access') } })
    expect(createOperationFromPlanTransaction(svc.authority, svc.clock, ctx(TAYLOR), 'PL-999'))
      .toMatchObject({ ok: false, failure: { kind: 'not-found' } })
    expect(svc.authority.snapshot().operations).toHaveLength(before.operations.length)
    expect(svc.authority.snapshot().counters.op).toBe(before.counters.op)
    svc.dispose()
  })
})

describe('the operation API keeps the binding honest (ticket 40)', () => {
  it('start refuses a failed current preflight and an expired approval — the approval never starts it', async () => {
    const svc = createConsoleServices()
    await approveRevisedPlan(svc)
    const bridged = createOperationFromPlanTransaction(svc.authority, svc.clock, ctx(TAYLOR, 'RT-2026-014'), 'PL-024')
    expect(bridged.ok).toBe(true)
    const opId = bridged.ok ? bridged.data.opId : ''
    // Current preflight fails (the agents are still reserved by the pinned operation) — start refuses.
    const early = startOperation(svc.authority, svc.clock, ctx(TAYLOR, 'RT-2026-014'), opId)
    expect(early.ok).toBe(false)
    if (!early.ok) expect(early.failure.message).toContain('PRE-06')
    expect(svc.authority.snapshot().operations.find((o) => o.id === opId)!.status).toBe('draft')
    // Once the current preflight passes the operation is ready…
    expect(stopOperation(svc.authority, svc.clock, ctx(SAM, 'RT-2026-014'), 'OP-014', 'Hand over to the revised plan').ok).toBe(true)
    const pf = runOperationPreflight(svc.authority, svc.clock, ctx(TAYLOR, 'RT-2026-014'), opId)
    expect(pf.ok && pf.data.pass).toBe(true)
    // …but the approval expires (decision + 24h) and start refuses at the re-derived gate.
    svc.clock.advance(DAY_MS + 60_000)
    const late = startOperation(svc.authority, svc.clock, ctx(TAYLOR, 'RT-2026-014'), opId)
    expect(late.ok).toBe(false)
    if (!late.ok) expect(late.failure.message).toContain('expired')
    expect(svc.authority.snapshot().operations.find((o) => o.id === opId)!.status).toBe('ready')
    expect(svc.authority.snapshot().plans.find((p) => p.id === 'PL-024')!.status).toBe('approved')
    svc.dispose()
  })

  it('start honors the approval deadline exactly: deadline−1 starts, deadline and deadline+1 refuse', async () => {
    const svc = createConsoleServices()
    await approveRevisedPlan(svc)
    const deadline = Date.parse('2026-10-14T10:42:00+07:00')
    svc.clock.advance(deadline - 1 - svc.clock.now())
    // deadline−1: bind, preflight and start all succeed at the re-derived gate.
    const bridged = createOperationFromPlanTransaction(svc.authority, svc.clock, ctx(TAYLOR, 'RT-2026-014'), 'PL-024')
    expect(bridged.ok).toBe(true)
    const opId = bridged.ok ? bridged.data.opId : ''
    expect(stopOperation(svc.authority, svc.clock, ctx(SAM, 'RT-2026-014'), 'OP-014', 'Hand over to the revised plan').ok).toBe(true)
    expect(runOperationPreflight(svc.authority, svc.clock, ctx(TAYLOR, 'RT-2026-014'), opId).ok).toBe(true)
    expect(startOperation(svc.authority, svc.clock, ctx(TAYLOR, 'RT-2026-014'), opId).ok).toBe(true)
    expect(svc.authority.snapshot().plans.find((p) => p.id === 'PL-024')!.status).toBe('executed')
    // A second bound operation — the executed approval stays usable inside the window.
    const second = createOperationDraft(svc.authority, svc.clock, ctx(TAYLOR, 'RT-2026-014'), { name: 'Deadline boundary probe', owner: 'Taylor Chen', desc: '', objective: '', playbookId: 'PB-001', agents: ['AG-012'], assets: ['AS-0141'], mode: 'Manual approval', needConfirm: true, note: '', schedule: 'now', planId: 'PL-024' })
    expect(second.ok).toBe(true)
    const nextId = second.ok ? second.data.op.id : ''
    const pf = runOperationPreflight(svc.authority, svc.clock, ctx(TAYLOR, 'RT-2026-014'), nextId)
    expect(pf.ok && pf.data.pass).toBe(true)
    // At the deadline exactly the re-derived start gate refuses…
    svc.clock.advance(1)
    expect(startOperation(svc.authority, svc.clock, ctx(TAYLOR, 'RT-2026-014'), nextId))
      .toMatchObject({ ok: false, failure: { kind: 'validation', message: expect.stringContaining('expired') } })
    // …and one instant past it the refusal persists — nothing was started either way.
    svc.clock.advance(1)
    expect(startOperation(svc.authority, svc.clock, ctx(TAYLOR, 'RT-2026-014'), nextId).ok).toBe(false)
    expect(svc.authority.snapshot().operations.find((o) => o.id === nextId)!.status).toBe('ready')
    expect(svc.authority.snapshot().plans.find((p) => p.id === 'PL-024')!.status).toBe('executed')
    svc.dispose()
  })

  it('resume honors the approval deadline exactly: deadline−1 resumes, deadline and deadline+1 refuse', () => {
    const svc = createConsoleServices()
    expect(pauseOperation(svc.authority, svc.clock, ctx(SAM, 'RT-2026-014'), 'OP-014', 'Investigate the failed step').ok).toBe(true)
    const deadline = Date.parse('2026-10-14T09:25:00+07:00')
    svc.clock.advance(deadline - 1 - svc.clock.now())
    expect(resumeOperation(svc.authority, svc.clock, ctx(TAYLOR, 'RT-2026-014'), 'OP-014').ok).toBe(true)
    expect(pauseOperation(svc.authority, svc.clock, ctx(SAM, 'RT-2026-014'), 'OP-014', 'Investigate again').ok).toBe(true)
    svc.clock.advance(1)
    const refused = resumeOperation(svc.authority, svc.clock, ctx(TAYLOR, 'RT-2026-014'), 'OP-014')
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.failure.message).toContain('expired')
    // One instant past the deadline the refusal persists — the run state never moved.
    svc.clock.advance(1)
    expect(resumeOperation(svc.authority, svc.clock, ctx(TAYLOR, 'RT-2026-014'), 'OP-014').ok).toBe(false)
    // The stored status string stays untouched — expiry is enforced at the gate.
    expect(svc.authority.snapshot().plans.find((p) => p.id === 'PL-021')!.status).toBe('approved')
    expect(svc.authority.snapshot().operations.find((o) => o.id === 'OP-014')!.status).toBe('paused')
    svc.dispose()
  })
})

describe('bridge proof both directions (ticket 40)', () => {
  it('the typed bridge is observed by the legacy store; the legacy console entry is observed by the typed read', async () => {
    const h = mountConsole()
    // Console entry → typed: the console entry binds PL-024; the typed operations read observes it.
    await act(async () => { await approveRevisedPlan(h.svc()) })
    h.run(() => { expect(createOperationFromPlanTransaction(h.svc().authority, h.svc().clock, ctx(TAYLOR, 'RT-2026-014'), 'PL-024').ok).toBe(true) })
    const typed = await h.svc().operations(TAYLOR, 'all').list(ctx(TAYLOR), {})
    expect(typed.ok).toBe(true)
    if (typed.ok) {
      expect(typed.data.items.find((it) => it.op.id === 'OP-017')?.planLabel).toBe('PL-024 v1.3')
      expect(typed.data.readyPlans.some((p) => p.id === 'PL-024')).toBe(false)
    }
    // Typed → console: the bridge binds the next revision; the canonical snapshot observes it.
    await act(async () => { await approveRevisedPlan(h.svc(), ['Narrow the scope']) })
    let bridged!: Awaited<ReturnType<ReturnType<ConsoleServices['plansBridge']>['createOperation']>>
    await act(async () => { bridged = await h.svc().plansBridge(TAYLOR, 'all').createOperation(ctx(TAYLOR), 'PL-025') })
    expect(bridged.ok).toBe(true)
    const d = h.db()
    expect(d.operations.find((o) => o.id === (bridged.ok ? bridged.data.opId : ''))!.planId).toBe('PL-025')
    expect(d.plans.find((p) => p.id === 'PL-025')!.opId).toBe(bridged.ok ? bridged.data.opId : '')
    h.unmount()
  })

  it('a bridge commit refetches My Tasks and the operations console — the linked draft appears without a reload', async () => {
    const h = mountConsole('Alex Morgan', true)
    await screen.findByText(/All \(4\)/)
    h.run(() => selectProject('RT-2026-014'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'All 2' })).toBeInTheDocument())
    // The revision enters review; the inbox observes the ChangeSet…
    await act(async () => { await h.svc().plans(TAYLOR, 'all').revise(ctx(TAYLOR), 'PL-021', ['Add an approval gate to step 3']) })
    await act(async () => { await h.svc().plans(TAYLOR, 'all').requestReview(ctx(TAYLOR), 'PL-024') })
    expect(await screen.findByText('PL-024 — Internal environment discovery plan')).toBeInTheDocument()
    await act(async () => { await h.svc().plans(PAT, 'all').decide(ctx(PAT), 'PL-024', 'approved', 'Gated as requested.') })
    await waitFor(() => expect(screen.queryByText('PL-024 — Internal environment discovery plan')).not.toBeInTheDocument())
    // …and the bridge commit puts the linked draft on the console.
    await act(async () => { await h.svc().plansBridge(TAYLOR, 'all').createOperation(ctx(TAYLOR), 'PL-024') })
    await waitFor(() => expect(screen.getByRole('button', { name: 'All 3' })).toBeInTheDocument())
    expect(screen.getByText(/PL-024 v1\.3/)).toBeInTheDocument()
    expect(h.db().operations.find((o) => o.id === 'OP-017')!.planId).toBe('PL-024')
    h.unmount()
  })

  it('the console bridge entry creates the correctly linked draft and the ready banner clears', async () => {
    const h = mountConsole('Alex Morgan', true)
    await screen.findByText(/All \(4\)/)
    h.run(() => selectProject('RT-2026-014'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'All 2' })).toBeInTheDocument())
    await act(async () => { await approveRevisedPlan(h.svc()) })
    expect(await screen.findByText(/approved plan ready for an operation/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create Operation from plan' }))
    await waitFor(() => expect(screen.queryByText(/approved plan ready for an operation/)).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('button', { name: 'All 3' })).toBeInTheDocument())
    const d = h.db()
    expect(d.operations.find((o) => o.id === 'OP-017')).toMatchObject({ status: 'draft', planId: 'PL-024' })
    expect(d.plans.find((p) => p.id === 'PL-024')!.opId).toBe('OP-017')
    // A second click is idempotent — no duplicate.
    h.run(() => { expect(createOperationFromPlanTransaction(h.svc().authority, h.svc().clock, ctx(TAYLOR, 'RT-2026-014'), 'PL-024').ok).toBe(true) })
    expect(h.db().operations.filter((o) => o.planId === 'PL-024')).toHaveLength(1)
    h.unmount()
  })
})
