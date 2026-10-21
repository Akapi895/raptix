/**
 * Ticket 22: closure policy and independent confirmation. The real handlers
 * own the governance: the manager-gated REQUEST accepts a failing checklist
 * (it is a UI-only request for independent review, recorded with its
 * evaluated checklist), while the CONFIRMATION is gated twice — four-eyes
 * independence and the checklist re-derived from canonical state, so a late
 * blocking change prevents closure. The no-findings waiver and the agent
 * reservation row stay explicit; the checklist is always derived, never
 * stored. Reopening requires the admin role and an audited reason. A failed
 * transaction leaves every entity unchanged, and legacy/new consumers
 * observe the same state from both bridges.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { createConsoleServices } from '../../domain/service-factory'
import type { ActorRef, RequestContext } from '../../domain/service'
import type { DbAuthority } from '../../domain/database'
import { useDb, useMe } from '../../state/console'
import { useSessionStore } from '../../state/session'
import { APR } from '../../domain/catalog';
import type { Db } from '../../demo/seed';
import { CloseTab, TeamTab } from '../../screens/b-detail2'
import { aggregateFor } from '../../screens/dashboard/service'
import { detailFor } from '../../screens/project-detail/service'
import { mountServices } from '../../test/helpers'
import {
  closePanelItems, confirmCloseTransaction, evaluateCloseChecklist, reopenProjectTransaction, requestCloseTransaction,
} from './service'
import { decideApprovalTransaction } from '../approvals/service'

afterEach(cleanup)

const ALEX: ActorRef = { id: 'Alex Morgan', role: 'manager' }
const PAT: ActorRef = { id: 'Pat Kim', role: 'reviewer' }
const DANA: ActorRef = { id: 'Dana Whitfield', role: 'admin' }
const TAYLOR: ActorRef = { id: 'Taylor Chen', role: 'operator' }
const P16 = 'RT-2026-016'

let corrSeq = 0
const ctxOf = (actor: ActorRef, projectId = P16): RequestContext => ({ actor, projectId, corr: `corr-${++corrSeq}` })

/* Ticket 67: the completion % probe moved here from the legacy store — this
   suite is its only consumer, and it pins the canonical checklist fold
   (closeDone/closeTotal) the percentage is derived from. */
function completion(db: Db, pid: string) {
  const p = db.projects.find((x) => x.id === pid)
  const objs = p?.objectives ?? []
  const objPct = objs.length ? Math.round(objs.reduce((a, o) => a + o.progress, 0) / objs.length) : 0
  const ops = db.operations.filter((o) => o.projectId === pid)
  const opsDone = ops.filter((o) => o.status === 'done').length
  const fs = db.findings.filter((f) => f.projectId === pid)
  const confirmed = fs.filter((f) => ['confirmed', 'remediation', 'retest', 'resolved'].includes(f.status)).length
  const suggested = fs.filter((f) => f.status === 'ai_suggested').length
  const inReview = fs.filter((f) => ['draft', 'review', 'returned'].includes(f.status)).length
  const reps = db.reports.filter((r) => r.projectId === pid)
  const delivered = reps.some((r) => r.status === 'delivered')
  const repLabel = delivered ? 'Delivered' : reps.length ? reps.map((r) => r.status).sort()[0].replace(/^./, (c) => c.toUpperCase()) : 'None'
  const chk = evaluateCloseChecklist(db, pid)
  const closeDone = chk.filter((c) => c.ok).length
  const pct = Math.round(objPct * 0.5 + (delivered ? 30 : reps.some((r) => ['approved', 'exported'].includes(r.status)) ? 20 : 0) + (closeDone / chk.length) * 20)
  return { pct, objPct, ops: ops.length, opsDone, confirmed, suggested, inReview, repLabel, delivered, closeDone, closeTotal: chk.length }
}

/** Forces every closure condition of `pid` to pass in the one dataset (the delivered final report is the seeded gap). */
const arrangeClosable = (authority: DbAuthority, pid = P16) => {
  authority.commit('arrange', (d) => {
    d.operations.forEach((o) => { if (o.projectId === pid && o.status !== 'done') o.status = 'done' })
    d.sessions.forEach((s) => { if (s.projectId === pid && s.state !== 'terminated') s.state = 'terminated' })
    d.findings.forEach((f) => { if (f.projectId === pid && ['draft', 'review', 'returned'].includes(f.status)) f.status = 'resolved' })
    d.approvals.forEach((a) => { if (a.projectId === pid && a.status === 'pending' && a.type !== APR.close) a.status = 'withdrawn' })
    d.reports.unshift({ id: 'REP-016T', projectId: pid, title: 'Retail Perimeter Review — Final', template: 'Standard', version: 'v1.0', status: 'delivered', author: 'Alex Morgan', reviewer: 'Pat Kim', updated: 'Oct 13, 2026, 10:45 AM (UTC+7)', findings: [], sections: [], reviews: [] })
  })
}

const pendingCloseOf = (authority: DbAuthority, pid = P16) =>
  authority.snapshot().approvals.find((a) => a.projectId === pid && a.type === APR.close && a.status === 'pending')!

describe('closure checklist derivation (ticket 22)', () => {
  it('the canonical derivation drives the store completion consumers for the seeded projects', () => {
    const svc = createConsoleServices()
    const db = svc.authority.snapshot()
    for (const pid of ['RT-2026-014', P16, 'RT-2026-009']) {
      const chk = evaluateCloseChecklist(db, pid)
      expect(completion(db, pid)).toMatchObject({ closeDone: chk.filter((c) => c.ok).length, closeTotal: chk.length })
      expect(JSON.stringify(evaluateCloseChecklist(db, pid))).toBe(JSON.stringify(chk))
    }
    svc.dispose()
  })

  it('the close panel adds the agent-reservation condition the console owns', () => {
    const svc = createConsoleServices()
    const db = svc.authority.snapshot()
    expect(closePanelItems(db, P16).find((i) => i.id === 'c5')).toMatchObject({ ok: true, detail: 'No agent is reserved by an active operation' })
    // A running operation holds its agent's reservation: the row fails and names it.
    svc.authority.commit('arrange', (d) => {
      const op = d.operations.find((o) => o.id === 'OP-016')!
      op.status = 'running'
      d.agents.find((a) => a.id === 'AG-014')!.op = 'OP-016'
    })
    expect(closePanelItems(svc.authority.snapshot(), P16).find((i) => i.id === 'c5')).toMatchObject({ ok: false, detail: 'Still reserved: AG-014' })
    svc.dispose()
  })

  it('the documented no-findings waiver replaces the report condition only while nothing was confirmed', () => {
    const svc = createConsoleServices()
    const waived = evaluateCloseChecklist(svc.authority.snapshot(), P16, { waiverNoFindings: true }).find((i) => i.id === 'c3')!
    expect(waived).toMatchObject({ ok: true, detail: 'Waived: approved no-findings closure (documented statement replaces the final report)' })
    // A confirmed finding voids the waiver: the report condition fails again.
    svc.authority.commit('arrange', (d) => {
      d.findings.find((f) => f.projectId === 'RT-2026-014' && f.status === 'confirmed')!.projectId = P16
    })
    expect(evaluateCloseChecklist(svc.authority.snapshot(), P16, { waiverNoFindings: true }).find((i) => i.id === 'c3')!.ok).toBe(false)
    svc.dispose()
  })
})

describe('closure request — manager-gated, not checklist-gated (ticket 22)', () => {
  it('a failing checklist is accepted as a UI-only request and the evaluation is recorded', () => {
    const svc = createConsoleServices()
    const res = requestCloseTransaction(svc.authority, svc.clock, ctxOf(ALEX), P16, { reason: 'Requesting review of closure readiness.' })
    expect(res.ok).toBe(true)
    const d = svc.authority.snapshot()
    expect(d.projects.find((x) => x.id === P16)?.status).toBe('review')
    const apr = d.approvals.find((a) => a.type === APR.close && a.projectId === P16)!
    expect(apr).toMatchObject({ status: 'pending', by: 'Alex Morgan', reviewer: 'Pat Kim', note: 'Requesting project closure — 1 checklist condition still open.' })
    expect(apr.diff).toContain('[open] Final report approved and delivered — No report has been delivered')
    expect(apr.diff).toContain('[met] No running or paused operations')
    expect(d.audit[0]).toMatchObject({ action: 'Closure reason', obj: P16, reason: 'Requesting review of closure readiness.' })
    expect(d.audit[1]).toMatchObject({ action: 'Requested project closure', obj: P16 })
    expect(d.notices[0]).toMatchObject({ text: `${P16} requested closure — awaiting confirmation`, category: 'approvals' })
    svc.dispose()
  })

  it('the no-findings waiver is recorded on the request when it applies', () => {
    const svc = createConsoleServices()
    const res = requestCloseTransaction(svc.authority, svc.clock, ctxOf(ALEX), P16, { reason: 'No confirmed findings; documented statement replaces the report.', waiverNoFindings: true })
    expect(res.ok).toBe(true)
    expect(svc.authority.snapshot().approvals.find((a) => a.type === APR.close)!.refId).toBe('no-findings-waiver')
    svc.dispose()
  })

  it('refusals — operator role, foreign project, duplicate pending, missing reason — commit nothing', () => {
    const svc = createConsoleServices()
    const before = JSON.stringify(svc.authority.snapshot())
    expect(requestCloseTransaction(svc.authority, svc.clock, ctxOf(TAYLOR), P16, { reason: 'Trying to close' }))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: expect.stringContaining('Only a Red Team Manager') }) })
    expect(requestCloseTransaction(svc.authority, svc.clock, ctxOf(ALEX), 'RT-2026-999', { reason: 'x' }))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'not-found' }) })
    expect(requestCloseTransaction(svc.authority, svc.clock, ctxOf(ALEX), P16, { reason: '   ' }))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: expect.stringContaining('A reason is required') }) })
    expect(JSON.stringify(svc.authority.snapshot())).toBe(before)
    expect(requestCloseTransaction(svc.authority, svc.clock, ctxOf(ALEX), P16, { reason: 'First request' }).ok).toBe(true)
    const afterFirst = JSON.stringify(svc.authority.snapshot())
    expect(requestCloseTransaction(svc.authority, svc.clock, ctxOf(ALEX), P16, { reason: 'Second request' }))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'conflict', message: expect.stringContaining('already has a pending closure request') }) })
    expect(JSON.stringify(svc.authority.snapshot())).toBe(afterFirst)
    svc.dispose()
  })
})

describe('closure confirmation — four-eyes plus the re-derived checklist (ticket 22)', () => {
  it('an independent reviewer confirms a closable project; a self-confirmation is refused (four-eyes)', () => {
    const svc = createConsoleServices()
    arrangeClosable(svc.authority)
    expect(requestCloseTransaction(svc.authority, svc.clock, ctxOf(ALEX), P16, { reason: 'All objectives assessed; final report delivered.' }).ok).toBe(true)
    const apr = pendingCloseOf(svc.authority)

    // A manager cannot confirm at all (confirmClose is a Reviewer/Admin action).
    const self = confirmCloseTransaction(svc.authority, svc.clock, ctxOf(ALEX), apr.id)
    expect(self).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: expect.stringContaining('Only a Reviewer or Organization Admin') }) })
    expect(svc.authority.snapshot().approvals.find((a) => a.id === apr.id)?.status).toBe('pending')

    // Four-eyes is identity-based: even a reviewer who filed the request cannot confirm it.
    svc.authority.commit('arrange', (d) => { d.approvals.find((a) => a.id === apr.id)!.by = 'Pat Kim' })
    expect(confirmCloseTransaction(svc.authority, svc.clock, ctxOf(PAT), apr.id))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: expect.stringContaining('four-eyes') }) })
    svc.authority.commit('arrange', (d) => { d.approvals.find((a) => a.id === apr.id)!.by = 'Alex Morgan' })

    const ok = confirmCloseTransaction(svc.authority, svc.clock, ctxOf(PAT), apr.id)
    expect(ok.ok).toBe(true)
    const d = svc.authority.snapshot()
    expect(d.projects.find((x) => x.id === P16)).toMatchObject({ status: 'closed' })
    expect(d.projects.find((x) => x.id === P16)?.closedAt).toBeTruthy()
    expect(d.approvals.find((a) => a.id === apr.id)?.status).toBe('approved')
    expect(d.audit[0]).toMatchObject({ action: 'Confirmed project closure', actor: 'Pat Kim', result: 'Success' })
    svc.dispose()
  })

  it('a role without confirmClose and an already-decided request are refused', () => {
    const svc = createConsoleServices()
    arrangeClosable(svc.authority)
    expect(requestCloseTransaction(svc.authority, svc.clock, ctxOf(ALEX), P16, { reason: 'Ready.' }).ok).toBe(true)
    const apr = pendingCloseOf(svc.authority)
    expect(confirmCloseTransaction(svc.authority, svc.clock, ctxOf(TAYLOR), apr.id))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: expect.stringContaining('Only a Reviewer or Organization Admin') }) })
    expect(confirmCloseTransaction(svc.authority, svc.clock, ctxOf(PAT), 'APR-999'))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'not-found' }) })
    svc.dispose()
  })

  it('a late blocking change prevents closure: the checklist is re-derived from canonical state at confirmation', () => {
    const svc = createConsoleServices()
    arrangeClosable(svc.authority)
    expect(requestCloseTransaction(svc.authority, svc.clock, ctxOf(ALEX), P16, { reason: 'Ready.' }).ok).toBe(true)
    const apr = pendingCloseOf(svc.authority)
    const recorded = svc.authority.snapshot().approvals.find((a) => a.id === apr.id)!.diff!
    expect(recorded).toContain('[met] No running or paused operations')
    // After the request, an operation resumes — the recorded snapshot says [met], canonical state no longer does.
    svc.authority.commit('arrange', (d) => {
      const op = d.operations.find((o) => o.id === 'OP-016')!
      op.status = 'running'
      d.agents.find((a) => a.id === 'AG-014')!.op = 'OP-016'
    })
    const refused = confirmCloseTransaction(svc.authority, svc.clock, ctxOf(PAT), apr.id)
    expect(refused).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: expect.stringContaining('No running or paused operations (Still open: OP-016)') }) })
    expect(refused.ok ? '' : refused.failure.message).toContain('A late blocking change prevents closure')
    const d = svc.authority.snapshot()
    expect(d.projects.find((x) => x.id === P16)?.status).toBe('review')
    expect(d.approvals.find((a) => a.id === apr.id)?.status).toBe('pending')
    svc.dispose()
  })

  it('a confirmed finding voids the recorded no-findings waiver before closure', () => {
    const svc = createConsoleServices()
    expect(requestCloseTransaction(svc.authority, svc.clock, ctxOf(ALEX), P16, { reason: 'No confirmed findings.', waiverNoFindings: true }).ok).toBe(true)
    const apr = pendingCloseOf(svc.authority)
    svc.authority.commit('arrange', (d) => {
      d.findings.unshift({ id: 'FD-T22', projectId: P16, title: 'Late confirmed finding', severity: 'high', status: 'confirmed', asset: 'AS-0301', op: '', technique: 'T1082', owner: 'Riley Brooks', date: 'Oct 13, 2026', updated: 'Oct 13, 2026', desc: '', impact: '', rec: '', evidence: [], comments: [], history: [], retests: [] })
    })
    const refused = confirmCloseTransaction(svc.authority, svc.clock, ctxOf(PAT), apr.id)
    expect(refused.ok ? '' : refused.failure.message).toContain('Final report approved and delivered (No report has been delivered)')
    svc.dispose()
  })

  it('the waiver completes a no-findings closure and decideApproval can no longer bypass the gate', () => {
    const svc = createConsoleServices()
    // RT-2026-016 has no findings at all: the waiver legitimately completes closure without a report.
    expect(requestCloseTransaction(svc.authority, svc.clock, ctxOf(ALEX), P16, { reason: 'No confirmed findings; documented in this reason.', waiverNoFindings: true }).ok).toBe(true)
    const apr = pendingCloseOf(svc.authority)
    expect(confirmCloseTransaction(svc.authority, svc.clock, ctxOf(PAT), apr.id).ok).toBe(true)
    expect(svc.authority.snapshot().projects.find((x) => x.id === P16)?.status).toBe('closed')

    // The generic decision path refuses closure approvals (returned decisions still work).
    expect(requestCloseTransaction(svc.authority, svc.clock, ctxOf(DANA), P16, { reason: 'x' })).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden' }) })
    svc.authority.commit('arrange', (d) => {
      const pr = d.projects.find((x) => x.id === P16)!
      pr.status = 'active'
      pr.closedAt = undefined
    })
    expect(requestCloseTransaction(svc.authority, svc.clock, ctxOf(ALEX), P16, { reason: 'Re-request after reopen.' }).ok).toBe(true)
    const apr2 = pendingCloseOf(svc.authority)
    expect(decideApprovalTransaction(svc.authority, svc.clock, ctxOf(PAT, P16), apr2.id, 'approved', 'ok'))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'conflict', message: expect.stringContaining('closure console') }) })
    const ret = decideApprovalTransaction(svc.authority, svc.clock, ctxOf(PAT, P16), apr2.id, 'returned', 'Please attach the handover record first.')
    expect(ret.ok).toBe(true)
    expect(svc.authority.snapshot().projects.find((x) => x.id === P16)?.status).toBe('active')
    svc.dispose()
  })
})

describe('reopen — admin role and audited reason (ticket 22)', () => {
  it('a manager is refused, a missing reason is refused, and the admin reopens with the reason audited', () => {
    const svc = createConsoleServices()
    arrangeClosable(svc.authority)
    expect(requestCloseTransaction(svc.authority, svc.clock, ctxOf(ALEX), P16, { reason: 'Ready.' }).ok).toBe(true)
    expect(confirmCloseTransaction(svc.authority, svc.clock, ctxOf(PAT), pendingCloseOf(svc.authority).id).ok).toBe(true)
    const before = JSON.stringify(svc.authority.snapshot())
    expect(reopenProjectTransaction(svc.authority, svc.clock, ctxOf(ALEX), P16, 'manager try'))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: expect.stringContaining('Only an Organization Admin') }) })
    expect(reopenProjectTransaction(svc.authority, svc.clock, ctxOf(DANA), P16, '   '))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: expect.stringContaining('A reason is required') }) })
    expect(reopenProjectTransaction(svc.authority, svc.clock, ctxOf(DANA), 'RT-2026-999', 'x'))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'not-found' }) })
    expect(JSON.stringify(svc.authority.snapshot())).toBe(before)
    const ok = reopenProjectTransaction(svc.authority, svc.clock, ctxOf(DANA), P16, 'Client extended the window; new objectives added.')
    expect(ok.ok).toBe(true)
    const d = svc.authority.snapshot()
    expect(d.projects.find((x) => x.id === P16)).toMatchObject({ status: 'active' })
    expect(d.projects.find((x) => x.id === P16)?.closedAt).toBeUndefined()
    expect(d.audit[0]).toMatchObject({ action: 'Reopened project', actor: 'Dana Whitfield', reason: 'Client extended the window; new objectives added.' })
    // A project that is not closed cannot be reopened.
    expect(reopenProjectTransaction(svc.authority, svc.clock, ctxOf(DANA), P16, 'again'))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'conflict', message: expect.stringContaining('Only a closed project') }) })
    svc.dispose()
  })
})

describe('close console and governance panels agree with the handlers (ticket 22)', () => {
  it('the typed request is observed by the typed consumers and a direct confirmation closes the project', () => {
    const h = mountServices()
    arrangeClosable(h.svc().authority)
    h.run(() => { expect(requestCloseTransaction(h.svc().authority, h.svc().clock, ctxOf(ALEX), P16, { reason: 'Legacy entry point.' }).ok).toBe(true) })
    // Request → typed: the same authority holds the recorded request.
    const apr = pendingCloseOf(h.svc().authority)
    expect(apr.by).toBe('Alex Morgan')
    expect(h.db().approvals.some((a) => a.id === apr.id && a.status === 'pending')).toBe(true)

    // Confirmation → canonical: a direct handler confirmation closes the project.
    let res!: ReturnType<typeof confirmCloseTransaction>
    act(() => { res = confirmCloseTransaction(h.svc().authority, h.svc().clock, ctxOf(PAT), apr.id) })
    expect(res.ok).toBe(true)
    expect(h.db().projects.find((x) => x.id === P16)?.status).toBe('closed')
    h.unmount()
  })

  it('the rendered close console completes a valid request and an independent confirmation', async () => {
    const h = mountServices(<ClosePanel />)
    arrangeClosable(h.svc().authority)
    fireEvent.change(await screen.findByPlaceholderText('Why this engagement is complete'), { target: { value: 'All objectives assessed; final report delivered.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Request closure' }))
    expect(await screen.findByText('All objectives assessed; final report delivered.')).toBeInTheDocument()
    const apr = pendingCloseOf(h.svc().authority)
    expect(apr.note).toBe('Requesting project closure — checklist complete.')
    expect(h.db().projects.find((x) => x.id === P16)?.status).toBe('review')

    h.as('Pat Kim')
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm (independent)' }))
    await waitFor(() => expect(h.db().projects.find((x) => x.id === P16)?.status).toBe('closed'))
    expect(h.db().projects.find((x) => x.id === P16)?.closedAt).toBeTruthy()
    h.unmount()
  })

  it('the gated refusal renders on the governance panel while a condition is open', () => {
    const h = mountServices(<TeamPanel />)
    h.run(() => { expect(requestCloseTransaction(h.svc().authority, h.svc().clock, ctxOf(ALEX), P16, { reason: 'Failing checklist request.' }).ok).toBe(true) })
    h.as('Pat Kim')
    fireEvent.click(screen.getByRole('button', { name: 'Approve Closure' }))
    expect(useSessionStore.getState().confirmState).not.toBeNull()
    act(() => { useSessionStore.getState().confirmState!.onConfirm('') })
    expect(screen.getByText('Cannot approve')).toBeInTheDocument()
    expect(h.db().projects.find((x) => x.id === P16)?.status).toBe('review')
    h.unmount()
  })
})

/* Renders the close console for the active dataset. */
function ClosePanel() {
  const db = useDb()
  const me = useMe()
  const d = detailFor(db, { id: me.name, role: me.role }, P16)!
  return <CloseTab p={d.project} d={d} setTab={() => {}} />
}

/* Renders the team governance panel (the closure confirmation surface). */
function TeamPanel() {
  const db = useDb()
  const me = useMe()
  const p = db.projects.find((x) => x.id === P16)!
  return <TeamTab p={p} ds={aggregateFor(db, { id: me.name, role: me.role }, P16)} />
}
