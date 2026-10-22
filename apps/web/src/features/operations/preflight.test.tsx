/**
 * Ticket 26: eight preflight checks and execution eligibility.
 *
 * The deterministic policy (src/features/operations/preflight.ts) re-derives
 * the eight canonical checks from canonical records at the calling instant:
 * the real time-window gate (PRE-04, absolute instants in the project
 * timezone), the required-plan approval gate (PRE-07), and missing/cross-
 * project record validation. The typed run/start-gate handlers re-derive at
 * the handler — a scope revision (ticket 21) clears preflight and the re-run
 * fails until re-approval — and the console detail read projects the phases,
 * steps and linked events from the same canonical state.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, screen, waitFor } from '@testing-library/react'
import { mountServices } from '../../test/helpers'
import { createConsoleServices } from '../../demo/services';
import type { ActorRef, ChangeSet, RequestContext } from '../../domain/service'
import { DEMO_ANCHOR } from '../../domain/clock'
import { APR } from '../../domain/catalog';
import type { Db } from '../../demo/seed';
import type { Operation } from '../../domain/entities'
import { reviseScopeTransaction, decideApprovalTransaction } from '../approvals/service'
import { assignAgentTransaction } from '../agents/writes'
import { selectProject, go } from '../../router/navigate'
import { routes } from './routes'
import { seed } from '../../demo/seed';
import { computePreflightChecks, eligibility, preflightPass, roeWindowIssue } from './preflight'
import { createOperationDraft, listOperations, operationDetail } from './service'
import { operationStartGate } from './mock'
import { runOperationPreflight } from './mock'
import { scheduleOperation, updateOperationDraft } from './mock'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

let corrSeq = 0
const actor = (id: string, role: ActorRef['role']): ActorRef => ({ id, role })
const ctxOf = (a: ActorRef, projectId: string): RequestContext => ({ actor: a, projectId, corr: `pf-${++corrSeq}` })
const ALEX = actor('Alex Morgan', 'manager')
const TAYLOR = actor('Taylor Chen', 'operator')
const PAT = actor('Pat Kim', 'reviewer')
const RILEY = actor('Riley Brooks', 'analyst')
const CASEY = actor('Casey Nguyen (Client)', 'viewer')

const db = seed()
const checksOf = (d: Db, opId: string, now: number = DEMO_ANCHOR) => {
  const op = d.operations.find((o) => o.id === opId)!
  return Object.fromEntries(computePreflightChecks(d, op, now).map((c) => [c.code, c]))
}
const checksFor = (opId: string, now: number = DEMO_ANCHOR) => checksOf(db, opId, now)
const withOp = (opId: string, patch: (op: Operation) => void): Db => {
  const d = structuredClone(db)
  patch(d.operations.find((o) => o.id === opId)!)
  return d
}

describe('PRE-04 — the real time-window gate (project timezone, absolute instants)', () => {
  it('passes a manual start inside the window at the current demo instant and a scheduled start inside it', () => {
    // Demo anchor: Tue Oct 13, 2026, 10:42 AM (UTC+7) — inside Mon–Fri 9–5.
    expect(checksFor('OP-016')['PRE-04'].state).toBe('pass')
    const d = withOp('OP-016', (op) => { op.schedule = '2026-10-16T10:00' }) // Friday 10:00 project time
    const check = checksOf(d, 'OP-016')['PRE-04']
    expect(check.state).toBe('pass')
    expect(check.detail).toContain('2026-10-16T10:00')
  })

  it('enforces the before/after boundaries of the window in project time', () => {
    const at = (v: string) => checksOf(withOp('OP-016', (op) => { op.schedule = v }), 'OP-016')['PRE-04'].state
    expect(at('2026-10-16T08:59')).toBe('fail') // Friday, one minute before the window
    expect(at('2026-10-16T09:00')).toBe('pass') // opening boundary
    expect(at('2026-10-16T16:59')).toBe('pass') // closing boundary (exclusive end)
    expect(at('2026-10-16T17:00')).toBe('fail') // one minute after the window
    expect(at('2026-10-17T11:00')).toBe('fail') // Saturday
  })

  it('fails a scheduled start in the past and a manual start outside the window, each with a fix link', () => {
    const past = checksOf(withOp('OP-016', (op) => { op.schedule = '2026-10-13T09:00' }), 'OP-016')['PRE-04']
    expect(past.state).toBe('fail')
    expect(past.detail).toContain('has passed')
    expect(past.fix).toBe('Reschedule')
    expect(past.fixRoute).toMatchObject({ page: 'operation-schedule', id: 'OP-016' })
    // Saturday 8:00 PM project time — outside Mon–Fri 9–5.
    const outside = checksFor('OP-014', Date.parse('2026-10-17T20:00:00+07:00'))['PRE-04']
    expect(outside.state).toBe('fail')
    expect(outside.detail).toContain('outside the ROE window')
    expect(preflightPass(Object.values(checksFor('OP-014', Date.parse('2026-10-17T20:00:00+07:00'))))).toBe(false)
  })
})

describe('edited ROE windows are honored at the enforcement sites (ticket 69 residual)', () => {
  /** A planless draft whose preflight passes under the seeded window. */
  function windowProbe(svc: ReturnType<typeof createConsoleServices>): string {
    const created = createOperationDraft(svc.authority, svc.clock, ctxOf(TAYLOR, 'RT-2026-014'), { ...draftInput })
    if (!created.ok) throw new Error(created.failure.message)
    return created.data.op.id
  }

  /** Edits the window through the real governance path and re-approves it independently. */
  function editWindow(svc: ReturnType<typeof createConsoleServices>, window: string) {
    const revised = reviseScopeTransaction(svc.authority, svc.clock, ctxOf(ALEX, 'RT-2026-014'), 'RT-2026-014', { patch: { window }, reason: 'Change the ROE window' })
    if (!revised.ok || !revised.data.invalidated) throw new Error('fixture scope revision did not invalidate')
    expect(svc.authority.snapshot().projects.find((p) => p.id === 'RT-2026-014')!.roeStatus).toBe('pending')
    const approval = svc.authority.snapshot().approvals.find((a) => a.projectId === 'RT-2026-014' && a.type === APR.scope && a.status === 'pending')!
    expect(decideApprovalTransaction(svc.authority, svc.clock, ctxOf(PAT, 'RT-2026-014'), approval.id, 'approved', 'Window change accepted')).toMatchObject({ ok: true })
  }

  it('a narrowed window refuses at the schedule and start gates what the seeded window allowed', () => {
    const svc = createConsoleServices()
    const opId = windowProbe(svc)
    // Under the seeded window (Mon–Fri, 9:00 AM–5:00 PM) a 09:30 Wednesday start is allowed…
    expect(scheduleOperation(svc.authority, svc.clock, ctxOf(TAYLOR, 'RT-2026-014'), opId, '2026-10-14T09:30').ok).toBe(true)
    // …the window is edited mid-engagement and re-approved…
    editWindow(svc, 'Mon–Fri, 10:00 AM–4:00 PM (UTC+7)')
    // …and the same 09:30 start now refuses at the schedule handler, committing nothing.
    const refused = scheduleOperation(svc.authority, svc.clock, ctxOf(TAYLOR, 'RT-2026-014'), opId, '2026-10-14T09:30')
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.failure.message).toContain('outside the ROE window')
    expect(svc.authority.snapshot().operations.find((o) => o.id === opId)!.scheduleAt).toBe('2026-10-14T02:30:00.000Z')
    // The stored 09:30 schedule now fails preflight at the execution gate…
    const run = runOperationPreflight(svc.authority, svc.clock, ctxOf(TAYLOR, 'RT-2026-014'), opId)
    expect(run.ok && run.data.pass).toBe(false)
    if (!run.ok) return
    const pre04 = run.data.checks.find((c) => c.code === 'PRE-04')!
    expect(pre04.state).toBe('fail')
    expect(pre04.detail).toContain('10:00 AM–4:00 PM')
    expect(operationStartGate(svc.authority, svc.clock, ctxOf(TAYLOR, 'RT-2026-014'), opId))
      .toMatchObject({ ok: false, failure: { kind: 'validation', message: expect.stringContaining('PRE-04') } })
    // …while a start inside the edited window is admitted by the same gates.
    expect(scheduleOperation(svc.authority, svc.clock, ctxOf(TAYLOR, 'RT-2026-014'), opId, '2026-10-14T10:30').ok).toBe(true)
    const rerun = runOperationPreflight(svc.authority, svc.clock, ctxOf(TAYLOR, 'RT-2026-014'), opId)
    expect(rerun.ok && rerun.data.pass).toBe(true)
    svc.dispose()
  })

  it('a widened window admits at the same gates what the seeded window refused', () => {
    const svc = createConsoleServices()
    const opId = windowProbe(svc)
    // Saturday 11:00 is outside the seeded Mon–Fri window…
    const weekend = scheduleOperation(svc.authority, svc.clock, ctxOf(TAYLOR, 'RT-2026-014'), opId, '2026-10-17T11:00')
    expect(weekend.ok).toBe(false)
    if (!weekend.ok) expect(weekend.failure.message).toContain('outside the ROE window')
    // …the widening edit runs through the same governance path…
    editWindow(svc, 'Mon–Sat, 9:00 AM–5:00 PM (UTC+7)')
    // …and the same Saturday start is admitted by the schedule handler and preflight.
    expect(scheduleOperation(svc.authority, svc.clock, ctxOf(TAYLOR, 'RT-2026-014'), opId, '2026-10-17T11:00').ok).toBe(true)
    const run = runOperationPreflight(svc.authority, svc.clock, ctxOf(TAYLOR, 'RT-2026-014'), opId)
    expect(run.ok && run.data.pass).toBe(true)
    expect(operationStartGate(svc.authority, svc.clock, ctxOf(TAYLOR, 'RT-2026-014'), opId).ok).toBe(true)
    svc.dispose()
  })

  it('roeWindowIssue evaluates the edited text boundaries, overnight wrap and the unparseable fallback', () => {
    const at = (window: string, iso: string) => roeWindowIssue({ window }, Date.parse(iso))
    const narrowed = 'Mon–Fri, 10:00 AM–4:00 PM (UTC+7)'
    expect(at(narrowed, '2026-10-14T09:59:00+07:00')).not.toBe('')
    expect(at(narrowed, '2026-10-14T10:00:00+07:00')).toBe('')
    expect(at(narrowed, '2026-10-14T15:59:00+07:00')).toBe('')
    expect(at(narrowed, '2026-10-14T16:00:00+07:00')).not.toBe('')
    expect(at(narrowed, '2026-10-17T11:00:00+07:00')).not.toBe('')
    // The documented overnight shape wraps midnight: the late evening and the
    // following morning are inside, midday is not.
    const overnight = 'Mon–Fri, 8:00 PM–4:00 AM (UTC+7)'
    expect(at(overnight, '2026-10-16T21:00:00+07:00')).toBe('')
    expect(at(overnight, '2026-10-17T02:00:00+07:00')).toBe('')
    expect(at(overnight, '2026-10-16T12:00:00+07:00')).not.toBe('')
    // Wording that does not parse falls back to the fixed Mon–Fri 9–5 baseline.
    expect(at('By appointment', '2026-10-14T11:00:00+07:00')).toBe('')
    expect(at('By appointment', '2026-10-17T11:00:00+07:00')).not.toBe('')
  })
})

describe('PRE-07 — the required-plan approval gate (ledger gap G-2)', () => {
  it('blocks a plan-linked operation while the plan awaits approval and after rejection or expiry', () => {
    expect(checksFor('OP-015')['PRE-07'].state).toBe('review') // PL-022 in_review — never passes the gate
    expect(preflightPass(Object.values(checksFor('OP-015')))).toBe(false)
    const rejected = checksOf(withOp('OP-015', () => {}), 'OP-015') // shape guard
    void rejected
    const d1 = structuredClone(db)
    d1.plans.find((p) => p.id === 'PL-022')!.status = 'rejected'
    expect(checksOf(d1, 'OP-015')['PRE-07'].state).toBe('fail')
    const d2 = structuredClone(db)
    d2.plans.find((p) => p.id === 'PL-022')!.status = 'expired'
    const expired = checksOf(d2, 'OP-015')['PRE-07']
    expect(expired.state).toBe('fail')
    expect(expired.reason).toContain('no longer valid')
  })

  it('fails a link to a missing plan record but passes an approved or executed plan', () => {
    const d = structuredClone(db)
    d.plans = d.plans.filter((p) => p.id !== 'PL-021')
    const missing = checksOf(d, 'OP-014')['PRE-07']
    expect(missing.state).toBe('fail')
    expect(missing.detail).toContain('PL-021')
    expect(checksFor('OP-014')['PRE-07'].state).toBe('pass') // PL-021 approved
  })

  it('keeps manual planless operations allowed under policy, pending only while another approval is open', () => {
    expect(checksFor('OP-016')['PRE-07'].state).toBe('pass')
    const d = structuredClone(db)
    d.approvals.unshift({ id: 'APR-x', projectId: 'RT-2026-016', type: APR.plan, by: 'Alex Morgan', reviewer: 'Pat Kim', at: 'Oct 13, 2026, 9:00 AM (UTC+7)', status: 'pending', note: '' })
    expect(checksOf(d, 'OP-016')['PRE-07'].state).toBe('review')
  })
})

describe('canonical record validation (missing and cross-project ids)', () => {
  it('fails targets from another project or missing from the inventory', () => {
    const foreign = checksOf(withOp('OP-016', (op) => { op.assets = ['AS-0301', 'AS-0201'] }), 'OP-016')['PRE-03']
    expect(foreign.state).toBe('fail')
    expect(foreign.detail).toContain('another project')
    const missing = checksOf(withOp('OP-016', (op) => { op.assets = ['AS-9999'] }), 'OP-016')['PRE-03']
    expect(missing.state).toBe('fail')
    expect(missing.detail).toContain('AS-9999')
  })

  it('fails missing agents and a missing project instead of crashing or passing', () => {
    const noAgent = checksOf(withOp('OP-016', (op) => { op.agents = ['AG-014', 'AG-9999'] }), 'OP-016')['PRE-06']
    expect(noAgent.state).toBe('fail')
    expect(noAgent.detail).toContain('AG-9999')
    const d = withOp('OP-016', (op) => { op.projectId = 'RT-9999' })
    const map = checksOf(d, 'OP-016')
    expect(map['PRE-01'].state).toBe('fail')
    expect(map['PRE-01'].detail).toContain('RT-9999')
    expect(map['PRE-02'].state).toBe('fail')
    expect(map['PRE-04'].state).toBe('fail')
    expect(map['PRE-08'].state).toBe('fail')
  })
})

describe('eligibility labels from canonical state', () => {
  it('labels locked, active and eligible projects; list rows carry the label', () => {
    expect(eligibility(db, 'RT-2026-017')).toMatchObject({ kind: 'locked', label: 'Execution locked — ROE not approved' })
    expect(eligibility(db, 'RT-2026-014')).toMatchObject({ kind: 'active', label: 'Execution active' })
    const res = listOperations(db, { actor: ALEX, projectId: 'RT-2026-017', corr: 't' })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.items).toHaveLength(1)
      expect(res.data.items[0]!.eligibility).toEqual({ kind: 'locked', label: 'Execution locked — ROE not approved' })
    }
  })
})

/* ───────────── Typed handlers: run preflight, start gate ───────────── */

const draftInput = { name: 'Preflight gate probe', owner: 'Taylor Chen', desc: '', objective: '', playbookId: 'PB-001', agents: ['AG-012'], assets: ['AS-0141'], mode: 'Manual with confirmation', needConfirm: true, note: '', schedule: 'now' }

describe('runOperationPreflight — re-derives the checks at the handler', () => {
  it('commits a passing run to Ready with the audit row and one ChangeSet', () => {
    const svc = createConsoleServices()
    const seen: ChangeSet[] = []
    svc.subscribe((cs) => seen.push(cs))
    const created = createOperationDraft(svc.authority, svc.clock, ctxOf(TAYLOR, 'RT-2026-014'), { ...draftInput })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const res = runOperationPreflight(svc.authority, svc.clock, ctxOf(TAYLOR, 'RT-2026-014'), created.data.op.id)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.pass).toBe(true)
    expect(res.data.checks).toHaveLength(8)
    expect(res.data.op.status).toBe('ready')
    expect(res.data.op.preflightAt).toBeDefined()
    expect(svc.authority.snapshot().audit[0]).toMatchObject({ action: 'Ran preflight', obj: created.data.op.id, result: 'Passed' })
    expect(seen.at(-1)!.entities).toContainEqual({ kind: 'operation', id: created.data.op.id, projectId: 'RT-2026-014' })
    svc.dispose()
  })

  it('records a failing run: the operation stays in draft and the audit names the failed checks', () => {
    const svc = createConsoleServices()
    const res = runOperationPreflight(svc.authority, svc.clock, ctxOf(ALEX, 'RT-2026-016'), 'OP-016')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.pass).toBe(false)
    expect(res.data.op.status).toBe('draft')
    expect(res.data.checks.find((c) => c.code === 'PRE-02')?.state).toBe('fail')
    expect(svc.authority.snapshot().audit[0]).toMatchObject({ action: 'Ran preflight', result: 'Failed', reason: expect.stringContaining('PRE-02') })
    svc.dispose()
  })

  it('refuses viewers, non-run roles, out-of-scope actors and in-flight operations — committing nothing', () => {
    const svc = createConsoleServices()
    const before = structuredClone(svc.authority.snapshot())
    expect(runOperationPreflight(svc.authority, svc.clock, ctxOf(CASEY, 'RT-2026-014'), 'OP-014'))
      .toMatchObject({ ok: false, failure: { kind: 'forbidden', message: expect.stringContaining('read-only access') } })
    expect(runOperationPreflight(svc.authority, svc.clock, ctxOf(RILEY, 'RT-2026-014'), 'OP-014'))
      .toMatchObject({ ok: false, failure: { kind: 'forbidden', message: 'Only a Manager or Operator can run preflight.' } })
    expect(runOperationPreflight(svc.authority, svc.clock, ctxOf(RILEY, 'RT-2026-016'), 'OP-016'))
      .toMatchObject({ ok: false, failure: { kind: 'not-found' } }) // non-member: no existence leak
    expect(runOperationPreflight(svc.authority, svc.clock, ctxOf(ALEX, 'RT-2026-014'), 'OP-014'))
      .toMatchObject({ ok: false, failure: { kind: 'validation', message: expect.stringContaining('preflight applies to Draft or Ready') } })
    const after = svc.authority.snapshot()
    expect(after.operations).toEqual(before.operations)
    expect(after.audit).toEqual(before.audit)
    svc.dispose()
  })

  it('re-derives after a scope revision: preflight fails until the ROE is re-approved (ticket 21 invalidation)', () => {
    const svc = createConsoleServices()
    const created = createOperationDraft(svc.authority, svc.clock, ctxOf(TAYLOR, 'RT-2026-014'), { ...draftInput })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const opId = created.data.op.id
    expect(runOperationPreflight(svc.authority, svc.clock, ctxOf(TAYLOR, 'RT-2026-014'), opId).ok).toBe(true)
    expect(svc.authority.snapshot().operations.find((o) => o.id === opId)!.status).toBe('ready')
    // The governed scope revision invalidates at submission — one commit clears preflight.
    const revised = reviseScopeTransaction(svc.authority, svc.clock, ctxOf(ALEX, 'RT-2026-014'), 'RT-2026-014', { patch: { window: 'Mon–Fri, 10:00 AM–4:00 PM (UTC+7)' }, reason: 'Tighten the window' })
    expect(revised.ok).toBe(true)
    const op = svc.authority.snapshot().operations.find((o) => o.id === opId)!
    expect(op.status).toBe('draft')
    expect(op.preflightAt).toBeUndefined()
    // The start gate re-derives from canonical state: it refuses with the failed check…
    expect(operationStartGate(svc.authority, svc.clock, ctxOf(TAYLOR, 'RT-2026-014'), opId))
      .toMatchObject({ ok: false, failure: { kind: 'validation', message: expect.stringContaining('PRE-02') } })
    // …and even a fresh preflight run fails until the ROE is re-approved.
    const rerun = runOperationPreflight(svc.authority, svc.clock, ctxOf(TAYLOR, 'RT-2026-014'), opId)
    expect(rerun.ok).toBe(true)
    if (rerun.ok) {
      expect(rerun.data.pass).toBe(false)
      expect(rerun.data.checks.find((c) => c.code === 'PRE-02')?.detail).toContain('waiting for re-approval')
      expect(rerun.data.op.status).toBe('draft')
    }
    svc.dispose()
  })
})

describe('operationStartGate — execution eligibility with reasons', () => {
  it('allows a fully passing operation and refuses the rest with the first failing check', () => {
    const svc = createConsoleServices()
    const created = createOperationDraft(svc.authority, svc.clock, ctxOf(TAYLOR, 'RT-2026-014'), { ...draftInput })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(runOperationPreflight(svc.authority, svc.clock, ctxOf(TAYLOR, 'RT-2026-014'), created.data.op.id).ok).toBe(true)
    const ok = operationStartGate(svc.authority, svc.clock, ctxOf(TAYLOR, 'RT-2026-014'), created.data.op.id)
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.data.checks.every((c) => c.state === 'pass')).toBe(true)
    // An un-preflighted draft on a draft-ROE project fails PRE-02 with its reason and fix.
    const refused = operationStartGate(svc.authority, svc.clock, ctxOf(ALEX, 'RT-2026-016'), 'OP-016')
    expect(refused.ok).toBe(false)
    if (!refused.ok) {
      expect(refused.failure.kind).toBe('validation')
      expect(refused.failure.message).toContain('PRE-02')
      expect(refused.failure.message).toContain('Open Scope & ROE')
    }
    svc.dispose()
  })

  it('refuses unknown ids, non-run roles, viewers and already-started operations', () => {
    const svc = createConsoleServices()
    expect(operationStartGate(svc.authority, svc.clock, ctxOf(ALEX, 'RT-2026-014'), 'OP-999'))
      .toMatchObject({ ok: false, failure: { kind: 'not-found' } })
    expect(operationStartGate(svc.authority, svc.clock, ctxOf(RILEY, 'RT-2026-014'), 'OP-014'))
      .toMatchObject({ ok: false, failure: { kind: 'forbidden', message: 'Only a Manager or Operator can start operations.' } })
    expect(operationStartGate(svc.authority, svc.clock, ctxOf(CASEY, 'RT-2026-014'), 'OP-014'))
      .toMatchObject({ ok: false, failure: { kind: 'forbidden', message: expect.stringContaining('read-only') } })
    expect(operationStartGate(svc.authority, svc.clock, ctxOf(ALEX, 'RT-2026-014'), 'OP-014'))
      .toMatchObject({ ok: false, failure: { kind: 'validation', message: expect.stringContaining('already started') } })
    svc.dispose()
  })
})

describe('operationDetail — console phases, steps and events from canonical reads', () => {
  it('returns the operation with steps, plan, conversation, branch groups and eligibility', () => {
    const res = operationDetail(db, ctxOf(TAYLOR, 'RT-2026-014'), 'OP-014')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.op.steps.length).toBeGreaterThan(0)
    expect(res.data.plan?.id).toBe('PL-021')
    expect(res.data.planLabel).toBe('PL-021 v1.2')
    expect(res.data.conversation?.id).toBe('CV-014-03')
    expect(res.data.branchGroups.map((g) => g.id)).toEqual(['BG-014-01'])
    expect(res.data.eligibility).toEqual({ kind: 'active', label: 'Execution active' })
  })

  it('denies a non-member without leaking existence and points a member back from a foreign scope', () => {
    const denied = operationDetail(db, ctxOf(RILEY, 'RT-2026-015'), 'OP-015')
    expect(denied).toMatchObject({ ok: false, failure: { kind: 'not-found' } })
    if (!denied.ok) expect(denied.failure.entity).toBeUndefined()
    const foreign = operationDetail(db, ctxOf(TAYLOR, 'RT-2026-015'), 'OP-014')
    expect(foreign).toMatchObject({ ok: false, failure: { kind: 'not-found' } })
    if (!foreign.ok) expect(foreign.failure.entity?.projectId).toBe('RT-2026-014')
  })
})

/* ───────────── Screen bridge and isolation ───────────── */

describe('operation console (ticket 26 — screens)', () => {
  it('bridge: a typed draft edit reaches the typed detail read; a typed preflight run reaches the console projection', async () => {
    const h = mountServices(null, 'Taylor Chen')
    // Setup: the pool assignment is role-gated at the typed handler (ticket
    // 49), so the setup runs it as the manager persona; the bridge proof
    // below still exercises the operator's preflight actions.
    h.run(() => selectProject('RT-2026-014'))
    h.run(() => assignAgentTransaction(h.svc().authority, h.svc().clock, ctxOf(ALEX, 'all'), 'AG-012', { projectId: 'RT-2026-014' }))
    let opId = ''
    h.run(() => {
      const created = createOperationDraft(h.svc().authority, h.svc().clock, ctxOf(TAYLOR, 'RT-2026-014'), { name: 'Bridge proof op', owner: 'Taylor Chen', desc: '', objective: '', playbookId: 'PB-001', agents: ['AG-012'], assets: ['AS-0141'], mode: 'Manual approval', schedule: '', needConfirm: true, note: '' })
      if (!created.ok) throw new Error(created.failure.message)
      opId = created.data.op.id
    })
    h.run(() => go('operation', { id: opId }))
    h.show(<routes.operation />)
    await waitFor(() => expect(screen.getByText('Bridge proof op')).toBeInTheDocument())
    // Direction 1 — the typed draft edit (which invalidates any preflight
    // snapshot) → the Query detail read refetches.
    h.run(() => { updateOperationDraft(h.svc().authority, h.svc().clock, ctxOf(TAYLOR, 'RT-2026-014'), opId, { name: 'Bridge proof op' }) })
    await waitFor(() => expect(screen.getByText('Draft')).toBeInTheDocument())
    // Direction 2 — the typed preflight run is observed by the console projection.
    await act(async () => { runOperationPreflight(h.svc().authority, h.svc().clock, ctxOf(TAYLOR, 'RT-2026-014'), opId) })
    await waitFor(() => expect(screen.getByText('Ready')).toBeInTheDocument())
    const op = h.db().operations.find((o) => o.id === opId)!
    expect(op.status).toBe('ready')
    expect(op.preflightAt).toBeDefined()
    h.unmount()
  })

  it('list rows show the canonical eligibility label for a locked project', async () => {
    const h = mountServices(null, 'Dana Whitfield')
    h.run(() => selectProject('RT-2026-017'))
    h.show(<routes.operations />)
    await waitFor(() => expect(screen.getByText('Fabrikam discovery (draft)')).toBeInTheDocument())
    expect(screen.getByText('Execution locked — ROE not approved')).toBeInTheDocument()
    h.unmount()
  })

  it('a delayed detail response for a superseded scope never pollutes the switched view', async () => {
    let resolveGate!: () => void
    const gate = new Promise<void>((r) => { resolveGate = r })
    const h = mountServices()
    const svc = h.svc()
    const orig = svc.operations.bind(svc)
    vi.spyOn(svc, 'operations').mockImplementation((actor_, project) => {
      const inner = orig(actor_, project)
      if (project !== 'all' || actor_.id !== 'Alex Morgan') return inner
      return { ...inner, detail: async (ctx: RequestContext, id: string) => { await gate; return inner.detail(ctx, id) } }
    })
    h.run(() => go('operation', { id: 'OP-014' }))
    h.show(<routes.operation />)
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument())
    // A persona switch supersedes the in-flight aggregate-scope read (selectProject on a
    // detail route is avoided — see the execution-ledger pinning notes).
    h.as('Dana Whitfield')
    await waitFor(() => expect(screen.getByText('Internal environment discovery')).toBeInTheDocument())
    await act(async () => { resolveGate(); await Promise.resolve() })
    expect(screen.getByText('Internal environment discovery')).toBeInTheDocument()
    const stale = h.qc().getQueryCache().findAll({ queryKey: ['operation'] })
      .find((q) => (q.queryKey[1] as { actor?: string }).actor === 'Alex Morgan')
    expect(stale?.state.data).toBeUndefined()
    h.unmount()
  })
})
