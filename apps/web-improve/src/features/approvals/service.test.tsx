/**
 * Ticket 21: project approvals and scope re-validation. The real handlers
 * own the four-eyes decisions (unauthorized roles and the request's own
 * submitter are refused with an explainable reason; approvals without the
 * required review information are rejected) and the one governance
 * transaction that invalidates a governed scope at SUBMISSION — ROE bump,
 * approved-plan expiry, ready-operation reset, preflight clear and
 * pending-only assets in a single atomic ChangeSet — while a running
 * operation keeps its last approved scope and new/legacy plan-operation
 * consumers observe the same invalidation. A failed transaction leaves
 * every entity unchanged.
 */
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ConsoleProviders } from '../../state/query'
import { StoreProvider, useServices, useStore, computePreflight, type Store } from '../../store'
import { createConsoleServices, type ConsoleServices } from '../../domain/service-factory'
import type { ActorRef, ChangeSet, RequestContext } from '../../domain/service'
import { parseDemoInstant } from '../../domain/clock'
import { TeamTab } from '../../screens/b-detail2'
import { aggregateFor } from '../../screens/dashboard/service'
import {
  decideApprovalTransaction, reviseScopeTransaction, submitApprovalTransaction, withdrawApprovalTransaction,
} from './service'
import { importAssetsTransaction } from '../assets/writes'
import { runOperationPreflight, startOperation } from '../operations/service'

afterEach(cleanup)

const ALEX: ActorRef = { id: 'Alex Morgan', role: 'manager' }
const PAT: ActorRef = { id: 'Pat Kim', role: 'reviewer' }
const DANA: ActorRef = { id: 'Dana Whitfield', role: 'admin' }
const RILEY: ActorRef = { id: 'Riley Brooks', role: 'analyst' }
const P14 = 'RT-2026-014'

let corrSeq = 0
const ctxOf = (actor: ActorRef, projectId = P14): RequestContext => ({ actor, projectId, corr: `corr-${++corrSeq}` })

function Probe({ ready }: { ready: (s: Store, v: ConsoleServices) => void }) {
  ready(useStore(), useServices())
  return null
}

/** Mounts the legacy store + Query providers and captures both, so one mutation can be observed from both bridges. */
function mountConsole(me = 'Alex Morgan', extra?: ReactNode) {
  let store!: Store
  let svc!: ConsoleServices
  const view = render(
    <StoreProvider>
      <ConsoleProviders>
        <Probe ready={(s, v) => { store = s; svc = v }} />
        {extra}
      </ConsoleProviders>
    </StoreProvider>,
  )
  if (me !== 'Alex Morgan') act(() => { store.setMe(me) })
  return { store: () => store, svc: () => svc, run: (fn: () => unknown) => act(fn), unmount: view.unmount }
}

/** Renders the team governance panel for the store's current persona/dataset. */
function TeamPanel({ id }: { id: string }) {
  const { db, me } = useStore()
  const p = db.projects.find((x) => x.id === id)!
  return <TeamTab p={p} ds={aggregateFor(db, { id: me.name, role: me.role }, id)} />
}

const newReadyOperation = (h: ReturnType<typeof mountConsole>) => {
  h.run(() => h.store().A.assignAgent('AG-012', P14))
  let opId = ''
  h.run(() => { opId = h.store().A.createOperation({ name: 'Approvals probe', projectId: P14, owner: 'Taylor Chen', desc: '', objective: '', playbookId: 'PB-001', agents: ['AG-012'], assets: ['AS-0141'], mode: 'Manual approval', schedule: '', needConfirm: true, note: '' }) })
  // Ticket 65 retired the A.confirmPreflight wrapper; the fixture runs the
  // same typed handler the wrapper delegated to.
  h.run(() => { runOperationPreflight(h.svc().authority, h.svc().clock, ctxOf(ALEX), opId) })
  return opId
}

describe('approval decisions (ticket 21)', () => {
  it('an unauthorized role cannot decide; the refusal explains the missing role and commits nothing', () => {
    const svc = createConsoleServices()
    const submitted = submitApprovalTransaction(svc.authority, svc.clock, ctxOf(ALEX), { projectId: P14, type: 'Agent assignment', note: 'Assign AG-012 for one week', diff: 'AG-012 → RT-2026-014' })
    expect(submitted.ok).toBe(true)
    const afterSubmit = JSON.stringify(svc.authority.snapshot())

    const res = decideApprovalTransaction(svc.authority, svc.clock, ctxOf(RILEY), submitted.ok ? submitted.data.id : '', 'approved', 'ok')
    expect(res).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: expect.stringContaining('Only a Reviewer or Organization Admin') }) })
    expect(JSON.stringify(svc.authority.snapshot())).toBe(afterSubmit)
    svc.dispose()
  })

  it('the submitter cannot decide their own request (four-eyes); an independent admin can', () => {
    const svc = createConsoleServices()
    const submitted = submitApprovalTransaction(svc.authority, svc.clock, ctxOf(PAT), { projectId: P14, type: 'Agent assignment', note: 'Assign AG-012 for one week', diff: 'AG-012 → RT-2026-014' })
    expect(submitted.ok).toBe(true)
    const id = submitted.ok ? submitted.data.id : ''

    const self = decideApprovalTransaction(svc.authority, svc.clock, ctxOf(PAT), id, 'approved', 'self-approved')
    expect(self).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: expect.stringContaining('four-eyes') }) })
    expect(svc.authority.snapshot().approvals.find((a) => a.id === id)?.status).toBe('pending')

    const ok = decideApprovalTransaction(svc.authority, svc.clock, ctxOf(DANA), id, 'approved', 'Assignment accepted')
    expect(ok.ok).toBe(true)
    expect(svc.authority.snapshot().approvals.find((a) => a.id === id)?.status).toBe('approved')
    expect(svc.authority.snapshot().agents.find((a) => a.id === 'AG-012')?.projectId).toBe(P14)
    svc.dispose()
  })

  it('approving without the required review information is rejected with the reason; returning needs one', () => {
    const svc = createConsoleServices()
    // A scope request can only be submitted while the ROE essentials hold;
    // the decision re-checks them so an approval can never land on a broken ROE.
    const submitted = submitApprovalTransaction(svc.authority, svc.clock, ctxOf(ALEX), { projectId: P14, type: 'Scope change', note: 'Tighten the window', diff: 'New version ROE-014-v3' })
    expect(submitted.ok).toBe(true)
    const id = submitted.ok ? submitted.data.id : ''
    svc.authority.commit('arrange', (d) => { d.projects.find((x) => x.id === P14)!.emergency = '' })

    const approve = decideApprovalTransaction(svc.authority, svc.clock, ctxOf(PAT), id, 'approved', 'ok')
    expect(approve).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: expect.stringContaining('no emergency contact') }) })

    const returned = decideApprovalTransaction(svc.authority, svc.clock, ctxOf(PAT), id, 'returned', '   ')
    expect(returned).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: expect.stringContaining('reason is required') }) })
    expect(svc.authority.snapshot().approvals.find((a) => a.id === id)?.status).toBe('pending')
    svc.dispose()
  })

  it('an independent scope approval admits the pending scope and its pending assets', () => {
    const h = mountConsole()
    h.run(() => { h.store().A.editScope(P14, { window: 'Mon–Fri, 10:00 AM–4:00 PM (UTC+7)' }, 'Tighten the window') })
    h.run(() => { importAssetsTransaction(h.svc().authority, h.svc().clock, ctxOf(ALEX), P14, [{ name: 'cloud-db-02', ident: 'db-02.fabrikam.example.test', type: 'Database', os: 'Linux', owner: 'Ops Team', scope: 'in', source: 'Manual' }]) })
    let d = h.store().db
    expect(d.assets.find((a) => a.projectId === P14 && a.name === 'cloud-db-02')?.scope).toBe('pending')
    const apr = d.approvals.find((a) => a.projectId === P14 && a.type === 'Scope change' && a.status === 'pending')!
    expect(apr.by).toBe('Alex Morgan')

    h.run(() => { h.store().setMe('Pat Kim') })
    h.run(() => { h.store().A.decideApproval(apr.id, 'approved', 'Accepted into scope') })
    d = h.store().db
    expect(d.projects.find((x) => x.id === P14)?.roeStatus).toBe('approved')
    expect(d.assets.find((a) => a.projectId === P14 && a.name === 'cloud-db-02')?.scope).toBe('in')
    h.unmount()
  })

  it('the team panel explains a four-eyes refusal with the handler reason', () => {
    const h = mountConsole('Pat Kim', <TeamPanel id={P14} />)
    h.run(() => { h.store().A.submitApproval(P14, 'Agent assignment', 'Assign AG-012 for one week', 'AG-012 → RT-2026-014') })
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    // The shared confirm dialog lives in the shell; invoke its confirmed callback directly.
    act(() => { h.store().confirmState?.onConfirm('self-approved') })
    expect(screen.getByText('Cannot approve')).toBeInTheDocument()
    expect(screen.getByText(/four-eyes principle/)).toBeInTheDocument()
    h.unmount()
  })

  it('withdraw refuses foreign or decided requests and works for the submitter', () => {
    const svc = createConsoleServices()
    const submitted = submitApprovalTransaction(svc.authority, svc.clock, ctxOf(ALEX), { projectId: P14, type: 'Agent assignment', note: 'Assign AG-012', diff: 'AG-012 → RT-2026-014' })
    const id = submitted.ok ? submitted.data.id : ''
    expect(withdrawApprovalTransaction(svc.authority, svc.clock, ctxOf(RILEY), id))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden' }) })
    expect(withdrawApprovalTransaction(svc.authority, svc.clock, ctxOf(ALEX), id).ok).toBe(true)
    expect(withdrawApprovalTransaction(svc.authority, svc.clock, ctxOf(ALEX), id))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'conflict', message: expect.stringContaining('pending') }) })
    svc.dispose()
  })
})

describe('scope revisions invalidate at submission (invariant a)', () => {
  it('one revision commits ALL invalidation in ONE ChangeSet: ROE bump, plan expiry, op reset, preflight clear', () => {
    const h = mountConsole()
    const opId = newReadyOperation(h)
    expect(h.store().db.operations.find((o) => o.id === opId)?.status).toBe('ready')

    const seen: ChangeSet[] = []
    h.svc().subscribe((cs) => seen.push(cs))
    h.run(() => { h.store().A.editScope(P14, { window: 'Mon–Fri, 10:00 AM–4:00 PM (UTC+7)' }, 'Tighten the window') })
    expect(seen).toHaveLength(1)
    expect(seen[0].entities.map((e) => e.kind)).toEqual(expect.arrayContaining(['project', 'plan', 'operation', 'approval', 'notice', 'audit']))
    expect(seen[0].projectId).toBe(P14)

    const d = h.store().db
    expect(d.projects.find((x) => x.id === P14)?.roeVersion).toBe('ROE-014-v3')
    expect(d.projects.find((x) => x.id === P14)?.roeStatus).toBe('pending')
    const pl = d.plans.find((x) => x.id === 'PL-021')!
    expect(pl.status).toBe('expired')
    expect(pl.risks.some((r) => r.startsWith('Re-validation required'))).toBe(true)
    const op = d.operations.find((o) => o.id === opId)!
    expect(op.status).toBe('draft')
    expect(op.preflightAt).toBeUndefined()
    h.unmount()
  })

  it('a running operation keeps its last approved scope while new work is blocked', () => {
    const h = mountConsole()
    const opId = newReadyOperation(h)
    h.run(() => { h.store().A.editScope(P14, { window: 'Mon–Fri, 10:00 AM–4:00 PM (UTC+7)' }, 'Tighten the window') })
    const d = h.store().db
    // OP-014 was running at submission: untouched, still on its (now expired) approved plan.
    const running = d.operations.find((o) => o.id === 'OP-014')!
    expect(running.status).toBe('running')
    expect(running.planId).toBe('PL-021')
    expect(running.preflightAt).toBeDefined()
    // The reset draft is blocked: preflight denies the ROE and start refuses.
    const op = d.operations.find((o) => o.id === opId)!
    expect(computePreflight(d, op).find((c) => c.code === 'PRE-02')?.state).toBe('fail')
    h.run(() => { startOperation(h.svc().authority, h.svc().clock, ctxOf(ALEX), opId) })
    expect(d.operations.find((o) => o.id === opId)?.status).toBe('draft')
    h.unmount()
  })

  it('new and legacy plan-operation consumers observe the SAME invalidation from one mutation', async () => {
    const h = mountConsole()
    const opId = newReadyOperation(h)
    const svc = h.svc()
    const read = async () => {
      const res = await svc.operations(ALEX, P14).list(ctxOf(ALEX))
      return res.ok ? res.data.items.find((i) => i.op.id === opId) : undefined
    }
    expect((await read())?.op.status).toBe('ready')

    const seen: ChangeSet[] = []
    svc.subscribe((cs) => seen.push(cs))
    h.run(() => { h.store().A.editScope(P14, { window: 'Mon–Fri, 10:00 AM–4:00 PM (UTC+7)' }, 'Tighten the window') })

    // Legacy observation (store context): expired plan + reset operation.
    expect(h.store().db.plans.find((x) => x.id === 'PL-021')?.status).toBe('expired')
    expect(h.store().db.operations.find((o) => o.id === opId)?.status).toBe('draft')
    // New consumer observation (typed read): the same reset through the same ChangeSet.
    expect((await read())?.op.status).toBe('draft')
    expect((await read())?.roeVersion).toBe('ROE-014-v3')
    // Reverse direction: a direct handler decision is observed by the legacy consumer.
    const apr = svc.authority.snapshot().approvals.find((a) => a.projectId === P14 && a.type === 'Scope change' && a.status === 'pending')!
    let decided!: ReturnType<typeof decideApprovalTransaction>
    act(() => { decided = decideApprovalTransaction(svc.authority, svc.clock, ctxOf(PAT), apr.id, 'approved', 'Accepted') })
    expect(decided.ok).toBe(true)
    expect(h.store().db.projects.find((x) => x.id === P14)?.roeStatus).toBe('approved')
    expect(seen.some((cs) => cs.entities.some((e) => e.kind === 'approval' && e.id === apr.id))).toBe(true)
    h.unmount()
  })

  it('added assets stay pending on revision submission and are admitted only by the independent approval', () => {
    const h = mountConsole()
    h.run(() => { importAssetsTransaction(h.svc().authority, h.svc().clock, ctxOf(ALEX), P14, [{ name: 'cloud-db-03', ident: 'db-03.fabrikam.example.test', type: 'Database', os: 'Linux', owner: 'Ops Team', scope: 'in', source: 'Manual' }]) })
    const d = h.store().db
    expect(d.assets.find((a) => a.projectId === P14 && a.name === 'cloud-db-03')?.scope).toBe('pending')
    expect(d.projects.find((x) => x.id === P14)?.roeVersion).toBe('ROE-014-v3')
    expect(d.projects.find((x) => x.id === P14)?.roeStatus).toBe('pending')
    expect(d.plans.find((x) => x.id === 'PL-021')?.status).toBe('expired')
    // The pending scope approval names the added assets; approval (above) admits them.
    expect(d.approvals.find((a) => a.projectId === P14 && a.status === 'pending')?.diff).toContain('cloud-db-03')
    h.unmount()
  })

  it('a failed revision leaves every entity unchanged (full snapshot equality)', () => {
    const svc = createConsoleServices()
    const before = JSON.stringify(svc.authority.snapshot())
    expect(reviseScopeTransaction(svc.authority, svc.clock, ctxOf(RILEY), P14, { patch: { window: 'x' } }))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden' }) })
    expect(reviseScopeTransaction(svc.authority, svc.clock, ctxOf(ALEX), 'RT-2026-999', { patch: { window: 'x' } }))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'not-found' }) })
    expect(reviseScopeTransaction(svc.authority, svc.clock, ctxOf(ALEX), P14, {}))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: expect.stringContaining('Provide scope changes') }) })
    expect(reviseScopeTransaction(svc.authority, svc.clock, ctxOf(ALEX), P14, { patch: { emergency: '   ' } }))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: expect.stringContaining('Emergency contact is required') }) })
    expect(JSON.stringify(svc.authority.snapshot())).toBe(before)
    svc.dispose()
  })

  it('the 24h plan-expiry seam survives the invalidation (ticket 39 still owns enforcement)', () => {
    const h = mountConsole()
    const seeded = h.store().db.plans.find((x) => x.id === 'PL-021')!
    const decidedAt = parseDemoInstant(seeded.decision!.at)!
    expect(parseDemoInstant(seeded.expires!)! - decidedAt).toBe(24 * 60 * 60 * 1000)
    h.run(() => { h.store().A.editScope(P14, { window: 'Mon–Fri, 10:00 AM–4:00 PM (UTC+7)' }, 'Tighten the window') })
    const expired = h.store().db.plans.find((x) => x.id === 'PL-021')!
    expect(expired.status).toBe('expired')
    expect(expired.expires).toBe(seeded.expires)
    h.unmount()
  })
})
