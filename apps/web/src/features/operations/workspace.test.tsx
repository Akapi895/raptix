/**
 * Ticket 29: operation live workspace.
 *
 * The live workspace (phases, step statuses, live log) derives from the ONE
 * canonical operation read (`useOperationDetail`), and the human
 * review-required gate is the typed `reviewOperationStep` handler: the
 * screens decide through typed mutations, and every gate — role, read-only
 * context, run state, "the step must actually be awaiting review", the note
 * required for Skip/Reject — is enforced AT THE HANDLER, independently of
 * any screen. The store's live-log mirrors stay display-only. (Ticket 65
 * retired the zero-caller A.reviewStep wrapper; reviews resolve the typed
 * handler directly.)
 *
 * Regression coverage:
 * - the workspace derives from canonical state: typed 27-transitions and typed
 *   review decisions repaint it through one ChangeSet, no reload;
 * - unauthorized reviewers are blocked WITH reasons, by the handler itself —
 *   a UI disabling is never the enforcement;
 * - the live route exercises allowed progress (an authorized reviewer
 *   decides), review blocking (paused work refuses decisions) and the
 *   emergency-stop propagation across the workspace;
 * - step/evidence links resolve into migrated routes;
 * - late-response isolation for the superseded scope;
 * - mutation acceptance: a typed pause/resume and a typed review
 *   decision observe the typed workspace, one dataset both ways.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { mountServices } from '../../test/helpers'
import { createConsoleServices } from '../../demo/services';
import type { ActorRef, ChangeSet, RequestContext } from '../../domain/service'
import { useToastStore } from '../../state/stores'
import { currentRoute, go } from '../../router/navigate'
import { routes } from './views/operation-pages'
import {
  acknowledgeEmergencyStopTransaction, finalizeEmergencyStopTransaction, requestEmergencyStopTransaction,
} from '../estop/service'
import { pauseOperation, reviewOperationStep, resumeOperation } from './service'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const actor = (id: string, role: ActorRef['role']): ActorRef => ({ id, role })
const TAYLOR = actor('Taylor Chen', 'operator')
const ALEX = actor('Alex Morgan', 'manager')
const RILEY = actor('Riley Brooks', 'analyst')
const PAT = actor('Pat Kim', 'reviewer')
const CASEY = actor('Casey Nguyen (Client)', 'viewer')
const P14 = 'RT-2026-014'

let corrSeq = 0
const ctxOf = (a: ActorRef, projectId: string): RequestContext => ({ actor: a, projectId, corr: `ws-${++corrSeq}` })

const S11_REVIEW = 'S11 Automated collection sample — review'
const S11_OK = 'S11 Automated collection sample — ok'

/* ───────────── Handler: the human review gate ───────────── */

describe('reviewOperationStep — the human review gate (ticket 29)', () => {
  it('commits the step outcome and its audit row in ONE ChangeSet, for each decision', () => {
    // approve
    let svc = createConsoleServices()
    let seen: ChangeSet[] = []
    svc.subscribe((cs) => seen.push(cs))
    let res = reviewOperationStep(svc.authority, svc.clock, ctxOf(TAYLOR, P14), 'OP-014', 'S11', 'approve', 'Result verified.')
    expect(res.ok).toBe(true)
    expect(seen).toHaveLength(1)
    expect(seen[0]!.entities.map((e) => e.kind)).toEqual(expect.arrayContaining(['operation', 'audit']))
    expect(res.ok && res.data.op.steps.find((s) => s.id === 'S11')).toMatchObject({ status: 'ok', dur: '01:20', output: 'Sanitized output. No sensitive content.' })
    expect(svc.authority.snapshot().audit[0]).toMatchObject({ action: 'Step review: approve', obj: 'OP-014/S11', actor: 'Taylor Chen', reason: 'Result verified.' })
    svc.dispose()
    // skip
    svc = createConsoleServices(); seen = []
    svc.subscribe((cs) => seen.push(cs))
    res = reviewOperationStep(svc.authority, svc.clock, ctxOf(TAYLOR, P14), 'OP-014', 'S11', 'skip', 'Not needed for this run.')
    expect(res.ok).toBe(true)
    expect(seen).toHaveLength(1)
    expect(svc.authority.snapshot().operations.find((o) => o.id === 'OP-014')!.steps.find((s) => s.id === 'S11')).toMatchObject({ status: 'notrun', dur: '—', output: 'Skipped by operator.' })
    svc.dispose()
    // reject
    svc = createConsoleServices(); seen = []
    svc.subscribe((cs) => seen.push(cs))
    res = reviewOperationStep(svc.authority, svc.clock, ctxOf(TAYLOR, P14), 'OP-014', 'S11', 'fail', 'Evidence inconclusive.')
    expect(res.ok).toBe(true)
    expect(seen).toHaveLength(1)
    expect(svc.authority.snapshot().operations.find((o) => o.id === 'OP-014')!.steps.find((s) => s.id === 'S11')).toMatchObject({ status: 'fail', dur: '—', output: 'Rejected at review.' })
    svc.dispose()
  })

  it('refuses unauthorized reviewers with reasons — independently of any screen', () => {
    const svc = createConsoleServices()
    const before = svc.authority.snapshot()
    // A read-only viewer may never decide on a human-gated step.
    expect(reviewOperationStep(svc.authority, svc.clock, ctxOf(CASEY, P14), 'OP-014', 'S11', 'approve'))
      .toMatchObject({ ok: false, failure: { kind: 'forbidden', message: expect.stringContaining('read-only access') } })
    // Analyst/reviewer roles can neither.
    expect(reviewOperationStep(svc.authority, svc.clock, ctxOf(RILEY, P14), 'OP-014', 'S11', 'approve'))
      .toMatchObject({ ok: false, failure: { kind: 'forbidden', message: 'Only a Manager or Operator can decide on review steps.' } })
    expect(reviewOperationStep(svc.authority, svc.clock, ctxOf(PAT, P14), 'OP-014', 'S11', 'approve'))
      .toMatchObject({ ok: false, failure: { kind: 'forbidden' } })
    // Someone outside the project learns nothing about the gate: not-found.
    expect(reviewOperationStep(svc.authority, svc.clock, ctxOf(RILEY, 'RT-2026-016'), 'OP-014', 'S11', 'approve'))
      .toMatchObject({ ok: false, failure: { kind: 'not-found' } })
    expect(reviewOperationStep(svc.authority, svc.clock, ctxOf(TAYLOR, P14), 'OP-999', 'S11', 'approve'))
      .toMatchObject({ ok: false, failure: { kind: 'not-found' } })
    // Every refusal commits nothing.
    const after = svc.authority.snapshot()
    expect(after.operations).toEqual(before.operations)
    expect(after.audit.length).toBe(before.audit.length)
    svc.dispose()
  })

  it('refuses decisions outside the legal moment: not running, wrong step, missing note', () => {
    const svc = createConsoleServices()
    // The operation must be running for a decision to be recorded.
    expect(pauseOperation(svc.authority, svc.clock, ctxOf(TAYLOR, P14), 'OP-014', 'hold for the reviewer').ok).toBe(true)
    expect(reviewOperationStep(svc.authority, svc.clock, ctxOf(TAYLOR, P14), 'OP-014', 'S11', 'approve'))
      .toMatchObject({ ok: false, failure: { kind: 'validation', message: expect.stringContaining('while it is running') } })
    expect(resumeOperation(svc.authority, svc.clock, ctxOf(TAYLOR, P14), 'OP-014').ok).toBe(true)
    // Only the step that is actually awaiting review can be decided.
    expect(reviewOperationStep(svc.authority, svc.clock, ctxOf(TAYLOR, P14), 'OP-014', 'S10', 'approve'))
      .toMatchObject({ ok: false, failure: { kind: 'validation', message: expect.stringContaining('not awaiting a reviewer decision') } })
    expect(reviewOperationStep(svc.authority, svc.clock, ctxOf(TAYLOR, P14), 'OP-014', 'S99', 'approve'))
      .toMatchObject({ ok: false, failure: { kind: 'validation', message: expect.stringContaining('was not found on operation OP-014') } })
    // Skip and Reject require a reviewer note (recorded in the audit log).
    expect(reviewOperationStep(svc.authority, svc.clock, ctxOf(TAYLOR, P14), 'OP-014', 'S11', 'skip', ''))
      .toMatchObject({ ok: false, failure: { kind: 'validation', message: expect.stringContaining('A reviewer note is required') } })
    expect(reviewOperationStep(svc.authority, svc.clock, ctxOf(TAYLOR, P14), 'OP-014', 'S11', 'fail', '   '))
      .toMatchObject({ ok: false, failure: { kind: 'validation', message: expect.stringContaining('A reviewer note is required') } })
    // Nothing was decided by the refusals.
    expect(svc.authority.snapshot().operations.find((o) => o.id === 'OP-014')!.steps.find((s) => s.id === 'S11')!.status).toBe('review')
    svc.dispose()
  })
})

/* ───────────── Screens: the live workspace ───────────── */

function mountWorkspace(me = 'Taylor Chen') {
  return mountServices(null, me)
}

describe('live workspace (ticket 29 — screens)', () => {
  it('derives from the canonical read; an authorized reviewer progresses the gate', async () => {
    const h = mountWorkspace()
    h.show(<routes.operation />)
    h.run(() => go('operation', { id: 'OP-014', tab: 'live' }))
    // S11 awaits its human decision; the gate says who decides.
    await screen.findByRole('button', { name: S11_REVIEW })
    expect(screen.getByText('A human reviewer decides. The AI cannot approve, skip or reject.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    // One typed decision: the pipeline repaints from the canonical read, no reload.
    await waitFor(() => expect(screen.queryByText('A human reviewer decides. The AI cannot approve, skip or reject.')).not.toBeInTheDocument())
    await screen.findByRole('button', { name: S11_OK })
    expect(h.db().operations.find((o) => o.id === 'OP-014')!.steps.find((s) => s.id === 'S11')!.status).toBe('ok')
    h.unmount()
  })

  it('blocks unauthorized viewers at the handler with its reason — the AI never decides', async () => {
    const h = mountWorkspace('Casey Nguyen (Client)')
    h.show(<routes.operation />)
    h.run(() => go('operation', { id: 'OP-014', tab: 'live' }))
    await screen.findByRole('button', { name: S11_REVIEW })
    // The UI keeps the control rendered but visibly disabled and explains why
    // (the enforcement itself stays at the handler, asserted below).
    const gated = screen.getByRole('button', { name: 'Approve' }).closest('[aria-disabled="true"]')
    expect(gated).not.toBeNull()
    fireEvent.click(gated!)
    expect(screen.getAllByText(/read-only/).length).toBeGreaterThan(0)
    // The handler refuses a viewer's decision with its reason and commits nothing.
    const refused = reviewOperationStep(h.svc().authority, h.svc().clock, ctxOf(CASEY, P14), 'OP-014', 'S11', 'approve')
    expect(refused).toMatchObject({ ok: false, failure: { kind: 'forbidden', message: expect.stringContaining('read-only access') } })
    // The step is untouched.
    expect(h.db().operations.find((o) => o.id === 'OP-014')!.steps.find((s) => s.id === 'S11')!.status).toBe('review')
    await screen.findByRole('button', { name: S11_REVIEW })
    h.unmount()
  })

  it('reflects 27’s typed transitions and refuses review decisions while paused', async () => {
    const h = mountWorkspace()
    h.show(<routes.operation />)
    h.run(() => go('operation', { id: 'OP-014', tab: 'live' }))
    await screen.findByRole('button', { name: S11_REVIEW })
    // A typed pause (27's handler) repaints the live workspace: while the step
    // awaits its review, the banner shows the review gate, not the pause.
    h.run(() => { pauseOperation(h.svc().authority, h.svc().clock, ctxOf(TAYLOR, P14), 'OP-014', 'hold for the reviewer') })
    await screen.findByText(/needs a human decision/)
    // Review blocking: the paused operation refuses decisions at the handler.
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(useToastStore.getState().toasts.some((t) => t.text.includes('while it is running'))).toBe(true))
    expect(h.db().operations.find((o) => o.id === 'OP-014')!.steps.find((s) => s.id === 'S11')!.status).toBe('review')
    await screen.findByRole('button', { name: S11_REVIEW })
    h.unmount()
  })

  it('accepts mutations from both entry points: the typed pause/resume and the typed review handler', async () => {
    const h = mountWorkspace()
    h.show(<routes.operation />)
    h.run(() => go('operation', { id: 'OP-014', tab: 'live' }))
    await screen.findByRole('button', { name: S11_REVIEW })
    // The typed pause runs the handler; the workspace refetches.
    h.run(() => { pauseOperation(h.svc().authority, h.svc().clock, ctxOf(TAYLOR, P14), 'OP-014', 'Bridge pause') })
    expect(h.db().operations.find((o) => o.id === 'OP-014')!.status).toBe('paused')
    h.run(() => { resumeOperation(h.svc().authority, h.svc().clock, ctxOf(TAYLOR, P14), 'OP-014') })
    expect(h.db().operations.find((o) => o.id === 'OP-014')!.status).toBe('running')
    // The review decision runs the typed handler too (ticket 65 retired the
    // A.reviewStep wrapper): the gate resolves.
    h.run(() => { reviewOperationStep(h.svc().authority, h.svc().clock, ctxOf(ALEX, P14), 'OP-014', 'S11', 'fail', 'Wrong target window') })
    await waitFor(() => expect(screen.queryByText('A human reviewer decides. The AI cannot approve, skip or reject.')).not.toBeInTheDocument())
    expect(h.db().operations.find((o) => o.id === 'OP-014')!.steps.find((s) => s.id === 'S11')!.status).toBe('fail')
    h.unmount()
  })

  it('propagates an emergency stop honestly across the live workspace', async () => {
    const h = mountWorkspace()
    h.show(<routes.operation />)
    h.run(() => go('operation', { id: 'OP-014', tab: 'live' }))
    await screen.findByRole('button', { name: S11_REVIEW })
    const svc = h.svc()
    // Request → requested: operations keep running until agents acknowledge.
    h.run(() => { requestEmergencyStopTransaction(svc.authority, svc.clock, ctxOf(ALEX, P14), { scope: 'operation', id: 'OP-014', reason: 'Customer requested an immediate halt.' }) })
    await screen.findByText('Waiting for agents to acknowledge. The operation is still shown as active until they do.')
    await screen.findByRole('button', { name: S11_REVIEW })
    // Acknowledge → the operation halts: the pending review dissolves into notrun.
    h.run(() => { acknowledgeEmergencyStopTransaction(svc.authority, svc.clock, ctxOf(ALEX, P14), { scope: 'operation', id: 'OP-014', reason: 'Customer requested an immediate halt.' }) })
    await waitFor(() => expect(screen.queryByText('A human reviewer decides. The AI cannot approve, skip or reject.')).not.toBeInTheDocument())
    expect(h.db().operations.find((o) => o.id === 'OP-014')!.status).toBe('estop')
    // Finalize → stopped, with no fabricated success beyond the audit trail.
    h.run(() => { finalizeEmergencyStopTransaction(svc.authority, svc.clock, ctxOf(ALEX, P14), { scope: 'operation', id: 'OP-014' }) })
    expect(screen.getByText(/acknowledged by agents\. No automatic restart\./)).toBeInTheDocument()
    h.unmount()
  })

  it('resolves step and evidence links into migrated routes', async () => {
    const h = mountWorkspace()
    h.show(<routes.operation />)
    h.run(() => go('operation', { id: 'OP-014', tab: 'live' }))
    await screen.findByRole('button', { name: S11_REVIEW })
    // A pipeline step opens the step inspector.
    fireEvent.click(screen.getByRole('button', { name: S11_REVIEW }))
    const drawer = await screen.findByRole('dialog')
    expect(drawer).toBeInTheDocument()
    // The inspector's technique link resolves into the (migrated) technique page.
    fireEvent.click(screen.getByText('T1119'))
    await waitFor(() => expect(currentRoute().page).toBe('technique'))
    expect(currentRoute().id).toBe('T1119')
    h.run(() => go('operation', { id: 'OP-014', tab: 'live' }))
    // The dock's evidence link resolves into the operation's Results tab.
    await screen.findByRole('button', { name: S11_REVIEW })
    fireEvent.click(screen.getByRole('tab', { name: 'evidence' }))
    fireEvent.click(await screen.findByText('EV-014-01'))
    await waitFor(() => expect(currentRoute().page).toBe('operation'))
    expect(currentRoute().tab).toBe('results')
    h.unmount()
  })

  it('never lets a delayed response for a superseded scope restore old visibility', async () => {
    let resolveGate!: () => void
    const gate = new Promise<void>((r) => { resolveGate = r })
    const h = mountWorkspace()
    const svc = h.svc()
    const orig = svc.operations.bind(svc)
    vi.spyOn(svc, 'operations').mockImplementation((a, project) => {
      const inner = orig(a, project)
      if (project !== 'all' || a.id !== 'Taylor Chen') return inner
      return { ...inner, detail: async (ctx, id) => { await gate; return inner.detail(ctx, id) } }
    })
    h.show(<routes.operation />)
    h.run(() => go('operation', { id: 'OP-014', tab: 'live' }))
    // Taylor's aggregate-scope read is gated, so the workspace stays pending…
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument())
    h.as('Alex Morgan')
    // …the new scope's workspace renders, unpolluted by the delayed response…
    await screen.findByRole('button', { name: S11_REVIEW })
    await act(async () => {
      resolveGate()
      await Promise.resolve()
    })
    // …and the superseded scope's cache entry never gains data.
    const stale = h.qc().getQueryCache().findAll({ queryKey: ['operation'] })
      .find((q) => (q.queryKey[1] as { project?: string }).project === 'all' && (q.queryKey[1] as { actor?: string }).actor === 'Taylor Chen')
    expect(stale?.state.data).toBeUndefined()
    h.unmount()
  })
})
