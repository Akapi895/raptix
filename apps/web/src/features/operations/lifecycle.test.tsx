/**
 * Ticket 27: operation lifecycle controls on typed handlers.
 *
 * The reservation contract: start binds the agent reservations ATOMICALLY in
 * the same commit that starts the run (operation + reservations + first
 * session + plan + audit — one ChangeSet); stop/complete release them in the
 * same atomic commit as the terminal state. Start refuses without a currently
 * passing preflight (ticket 26's re-derived gate) and with an expired linked
 * plan approval; role gates refuse with reasons; stopped/estopped operations
 * never resume. Both consumers — the typed mutations and the mounted screens'
 * controls — run the same handlers (the zero-caller
 * A.confirmPreflight/A.startOp wrappers were retired by ticket 65).
 *
 * resumeOperation — the rechecks the corrected spec requires at the handler
 * (stories 19/22, ticket 27's re-derived controls, ticket 40's live approval
 * deadline), each with its boundary test in this file or bridge.test.tsx:
 * 1. existence and scope — out-of-scope or foreign requests are not-found,
 *    no existence leak (lifecycleGate);
 * 2. read-only context — the Viewer role and closed/cancelled projects
 *    refuse (lifecycleGate);
 * 3. role — only a Manager or Operator (`run`) resumes (lifecycleGate);
 * 4. lifecycle state — only a `paused` operation resumes: stopped,
 *    emergency-stopped, running, ready and done never resume automatically;
 * 5. agent readiness — every assigned agent must still be online;
 * 6. linked plan state — the plan must be approved/executed; a revision
 *    needs re-approval;
 * 7. live approval deadline — `usableApproval` re-checks the absolute 24h
 *    deadline at the resume instant (stored status may still read approved).
 * The resume dialog additionally previews ROE/window and full preflight rows
 * in the UI; the handler's own enforcement set is the list above.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { mountServices } from '../../test/helpers'
import { createConsoleServices } from '../../demo/services';
import type { ConsoleServices } from '../../domain/console-services';
import type { ActorRef, ChangeSet, RequestContext } from '../../domain/service'
import { useToastStore } from '../../state/stores'
import { selectProject, go } from '../../router/navigate'
import { routes } from './routes'
import { useAgentList } from '../agents/query'
import { createOperationDraft } from './service'
import { startOperation } from './mock'
import { completeOperation, pauseOperation, resumeOperation, stopOperation } from './mock'
import { runOperationPreflight } from './mock'
import type { OperationDraftInput } from './service'
import { assignAgentTransaction } from '../agents/writes'
import { reviseScopeTransaction } from '../approvals/service'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

let corrSeq = 0
const actor = (id: string, role: ActorRef['role']): ActorRef => ({ id, role })
const ctxOf = (a: ActorRef, projectId: string): RequestContext => ({ actor: a, projectId, corr: `lc-${++corrSeq}` })
const ALEX = actor('Alex Morgan', 'manager')
const TAYLOR = actor('Taylor Chen', 'operator')
const RILEY = actor('Riley Brooks', 'analyst')
const CASEY = actor('Casey Nguyen (Client)', 'viewer')
const P14 = 'RT-2026-014'

const draftInput = (over: Partial<OperationDraftInput> = {}): OperationDraftInput => ({
  name: 'Lifecycle probe', owner: 'Taylor Chen', desc: '', objective: '', playbookId: 'PB-001',
  agents: ['AG-012'], assets: ['AS-0141'], mode: 'Manual with confirmation', needConfirm: true,
  note: '', schedule: 'now', ...over,
})

/** Fixture: a draft whose preflight currently passes (ready). */
function readyOperation(svc: ConsoleServices, over: Partial<OperationDraftInput> = {}): string {
  const created = createOperationDraft(svc.authority, svc.clock, ctxOf(TAYLOR, P14), draftInput(over))
  if (!created.ok) throw new Error(created.failure.message)
  const run = runOperationPreflight(svc.authority, svc.clock, ctxOf(TAYLOR, P14), created.data.op.id)
  if (!run.ok || !run.data.pass) throw new Error('fixture preflight did not pass')
  return created.data.op.id
}

describe('startOperation — the atomic reservation contract', () => {
  it('binds run state, agent reservations, the first session, the plan and the audit in ONE ChangeSet', () => {
    const svc = createConsoleServices()
    const opId = readyOperation(svc)
    const seen: ChangeSet[] = []
    svc.subscribe((cs) => seen.push(cs))
    const ctx = ctxOf(TAYLOR, P14)
    const res = startOperation(svc.authority, svc.clock, ctx, opId)
    expect(res.ok).toBe(true)
    // Exactly one commit: a partial start (running without reservations, or
    // reservations without the session/audit) is impossible.
    expect(seen).toHaveLength(1)
    expect(seen[0]!.entities.map((e) => e.kind)).toEqual(expect.arrayContaining(['operation', 'agent', 'session', 'audit']))
    expect(seen[0]!.corr).toBe(ctx.corr)
    const d = svc.authority.snapshot()
    const op = d.operations.find((o) => o.id === opId)!
    expect(op).toMatchObject({ status: 'running', startedAt: expect.stringContaining('(UTC+7)') })
    expect(op.steps[0]).toMatchObject({ status: 'running' })
    expect(op.sessionId).toBeDefined()
    // The reservation: one agent, one operation — bound in the same commit.
    expect(d.agents.find((a) => a.id === 'AG-012')!.op).toBe(opId)
    expect(d.sessions.find((s) => s.id === op.sessionId)!.state).toBe('connected')
    expect(d.audit[0]).toMatchObject({ action: 'Started operation', obj: opId, result: 'Success', actor: 'Taylor Chen' })
    svc.dispose()
  })

  it('executes the linked plan atomically with the start', () => {
    const svc = createConsoleServices()
    // PL-021 is approved in the seed; the draft links it and preflight passes.
    const opId = readyOperation(svc, { planId: 'PL-021' })
    expect(svc.authority.snapshot().plans.find((p) => p.id === 'PL-021')!.status).toBe('approved')
    expect(startOperation(svc.authority, svc.clock, ctxOf(TAYLOR, P14), opId).ok).toBe(true)
    expect(svc.authority.snapshot().plans.find((p) => p.id === 'PL-021')!.status).toBe('executed')
    svc.dispose()
  })
})

describe('startOperation — refusals commit nothing', () => {
  it('refuses without a currently passing preflight (failing check) and with an expired linked plan', () => {
    const svc = createConsoleServices()
    // PRE-02 fails right now: RT-2026-016's ROE is not approved — no start.
    expect(startOperation(svc.authority, svc.clock, ctxOf(ALEX, 'RT-2026-016'), 'OP-016'))
      .toMatchObject({ ok: false, failure: { kind: 'validation', message: expect.stringContaining('PRE-02') } })
    // An expired linked plan approval blocks start with the PRE-07 reason…
    svc.authority.commit('fixture', (d) => { d.plans.find((p) => p.id === 'PL-021')!.status = 'expired' })
    const created = createOperationDraft(svc.authority, svc.clock, ctxOf(TAYLOR, P14), draftInput({ planId: 'PL-021' }))
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const opId = created.data.op.id
    const run = runOperationPreflight(svc.authority, svc.clock, ctxOf(TAYLOR, P14), opId)
    expect(run.ok && run.data.pass).toBe(false)
    expect(startOperation(svc.authority, svc.clock, ctxOf(TAYLOR, P14), opId))
      .toMatchObject({ ok: false, failure: { kind: 'validation', message: expect.stringContaining('PRE-07') } })
    // …and nothing was started: status, reservation and audit unchanged.
    const d = svc.authority.snapshot()
    expect(d.operations.find((o) => o.id === opId)!.status).toBe('draft')
    expect(d.agents.find((a) => a.id === 'AG-012')!.op).toBeNull()
    expect(d.audit.some((a) => a.action === 'Started operation' && a.obj === opId)).toBe(false)
    svc.dispose()
  })

  it('enforces role gates with reasons: viewer, non-run role, non-member — committing nothing', () => {
    const svc = createConsoleServices()
    const opId = readyOperation(svc)
    const before = svc.authority.snapshot()
    expect(startOperation(svc.authority, svc.clock, ctxOf(CASEY, P14), opId))
      .toMatchObject({ ok: false, failure: { kind: 'forbidden', message: expect.stringContaining('read-only access') } })
    expect(startOperation(svc.authority, svc.clock, ctxOf(RILEY, P14), opId))
      .toMatchObject({ ok: false, failure: { kind: 'forbidden', message: 'Only a Manager or Operator can start operations.' } })
    // A non-member's addressed start is not-found — no existence leak.
    expect(startOperation(svc.authority, svc.clock, ctxOf(RILEY, 'RT-2026-016'), opId))
      .toMatchObject({ ok: false, failure: { kind: 'not-found' } })
    const after = svc.authority.snapshot()
    expect(after.operations).toEqual(before.operations)
    expect(after.agents).toEqual(before.agents)
    expect(after.audit).toEqual(before.audit)
    svc.dispose()
  })
})

describe('stop/complete — release reservations atomically', () => {
  it('the normal stop releases the reservations and terminates sessions in the same atomic commit', () => {
    const svc = createConsoleServices()
    const opId = readyOperation(svc)
    expect(startOperation(svc.authority, svc.clock, ctxOf(TAYLOR, P14), opId).ok).toBe(true)
    const seen: ChangeSet[] = []
    svc.subscribe((cs) => seen.push(cs))
    const res = stopOperation(svc.authority, svc.clock, ctxOf(TAYLOR, P14), opId, 'Client asked to halt')
    expect(res.ok).toBe(true)
    expect(seen).toHaveLength(1)
    expect(seen[0]!.entities.map((e) => e.kind)).toEqual(expect.arrayContaining(['operation', 'agent', 'session', 'audit']))
    const d = svc.authority.snapshot()
    expect(d.operations.find((o) => o.id === opId)).toMatchObject({ status: 'cancelled', stopReason: 'Client asked to halt', stopBy: 'Taylor Chen' })
    // The reservation is gone; the linked session is terminated with a transcript line.
    expect(d.agents.find((a) => a.id === 'AG-012')!.op).toBeNull()
    expect(d.sessions.filter((s) => s.opId === opId).every((s) => s.state === 'terminated')).toBe(true)
    expect(d.audit[0]).toMatchObject({ action: 'Stopped operation', obj: opId, result: 'Success', reason: 'Client asked to halt' })
    svc.dispose()
  })

  it('completion refuses a running step and otherwise releases in the same commit as the done state', () => {
    const svc = createConsoleServices()
    const opId = readyOperation(svc)
    expect(startOperation(svc.authority, svc.clock, ctxOf(TAYLOR, P14), opId).ok).toBe(true)
    expect(completeOperation(svc.authority, svc.clock, ctxOf(TAYLOR, P14), opId))
      .toMatchObject({ ok: false, failure: { kind: 'validation', message: expect.stringContaining('a step is still running') } })
    svc.authority.commit('fixture', (d) => { d.operations.find((o) => o.id === opId)!.steps.forEach((s) => { if (s.status === 'running') { s.status = 'ok'; s.output = 'Sanitized output.' } }) })
    const seen: ChangeSet[] = []
    svc.subscribe((cs) => seen.push(cs))
    expect(completeOperation(svc.authority, svc.clock, ctxOf(TAYLOR, P14), opId).ok).toBe(true)
    expect(seen).toHaveLength(1)
    expect(seen[0]!.entities.map((e) => e.kind)).toEqual(expect.arrayContaining(['operation', 'agent', 'session', 'audit']))
    const d = svc.authority.snapshot()
    expect(d.operations.find((o) => o.id === opId)).toMatchObject({ status: 'done' })
    expect(d.agents.find((a) => a.id === 'AG-012')!.op).toBeNull()
    expect(d.sessions.filter((s) => s.opId === opId).every((s) => s.state === 'terminated')).toBe(true)
    svc.dispose()
  })

  it('stop requires a reason and refuses non-active operations and non-run roles', () => {
    const svc = createConsoleServices()
    const opId = readyOperation(svc)
    expect(stopOperation(svc.authority, svc.clock, ctxOf(TAYLOR, P14), opId, '   '))
      .toMatchObject({ ok: false, failure: { kind: 'validation', message: expect.stringContaining('reason is required') } })
    // Stopping a ready (never started) operation is refused with its reason.
    expect(stopOperation(svc.authority, svc.clock, ctxOf(TAYLOR, P14), opId, 'halt'))
      .toMatchObject({ ok: false, failure: { kind: 'validation', message: expect.stringContaining('only a running or paused operation') } })
    expect(stopOperation(svc.authority, svc.clock, ctxOf(RILEY, P14), 'OP-014', 'halt'))
      .toMatchObject({ ok: false, failure: { kind: 'forbidden', message: 'Only a Manager or Operator can stop operations.' } })
    svc.dispose()
  })
})

describe('pause/resume — rechecks enforced at the handler', () => {
  it('pauses a running operation with a required audited reason; resume restores the run', () => {
    const svc = createConsoleServices()
    const opId = readyOperation(svc)
    expect(startOperation(svc.authority, svc.clock, ctxOf(TAYLOR, P14), opId).ok).toBe(true)
    expect(pauseOperation(svc.authority, svc.clock, ctxOf(TAYLOR, P14), opId, ''))
      .toMatchObject({ ok: false, failure: { kind: 'validation', message: expect.stringContaining('reason is required') } })
    expect(pauseOperation(svc.authority, svc.clock, ctxOf(TAYLOR, P14), opId, 'Step 2 needs a decision').ok).toBe(true)
    expect(svc.authority.snapshot().operations.find((o) => o.id === opId)).toMatchObject({ status: 'paused', stopReason: 'Step 2 needs a decision' })
    expect(svc.authority.snapshot().audit[0]).toMatchObject({ action: 'Paused operation', reason: 'Step 2 needs a decision' })
    // Reservations persist across a pause; resume rechecks and restores the run.
    expect(svc.authority.snapshot().agents.find((a) => a.id === 'AG-012')!.op).toBe(opId)
    expect(resumeOperation(svc.authority, svc.clock, ctxOf(TAYLOR, P14), opId).ok).toBe(true)
    expect(svc.authority.snapshot().operations.find((o) => o.id === opId)).toMatchObject({ status: 'running' })
    svc.dispose()
  })

  it('stopped and emergency-stopped operations never resume; disconnected agents and unapproved plans block', () => {
    const svc = createConsoleServices()
    const opId = readyOperation(svc)
    expect(startOperation(svc.authority, svc.clock, ctxOf(TAYLOR, P14), opId).ok).toBe(true)
    expect(stopOperation(svc.authority, svc.clock, ctxOf(TAYLOR, P14), opId, 'halt').ok).toBe(true)
    expect(resumeOperation(svc.authority, svc.clock, ctxOf(TAYLOR, P14), opId))
      .toMatchObject({ ok: false, failure: { kind: 'validation', message: expect.stringContaining('does not resume automatically') } })
    // An estopped operation refuses the same way (ticket 28's finalize has
    // released the reservation, so later fixtures can reuse the agent).
    const estopped = readyOperation(svc)
    expect(startOperation(svc.authority, svc.clock, ctxOf(TAYLOR, P14), estopped).ok).toBe(true)
    svc.authority.commit('fixture', (d) => { d.operations.find((o) => o.id === estopped)!.status = 'estop'; d.agents.find((a) => a.id === 'AG-012')!.op = null })
    expect(resumeOperation(svc.authority, svc.clock, ctxOf(TAYLOR, P14), estopped))
      .toMatchObject({ ok: false, failure: { kind: 'validation', message: expect.stringContaining('emergency stopped') } })
    // A paused operation with a disconnected agent cannot resume…
    const paused = readyOperation(svc)
    expect(startOperation(svc.authority, svc.clock, ctxOf(TAYLOR, P14), paused).ok).toBe(true)
    svc.authority.commit('fixture', (d) => { const o = d.operations.find((x) => x.id === paused)!; o.status = 'paused'; d.agents.find((a) => a.id === 'AG-012')!.status = 'lost' })
    expect(resumeOperation(svc.authority, svc.clock, ctxOf(TAYLOR, P14), paused))
      .toMatchObject({ ok: false, failure: { kind: 'validation', message: expect.stringContaining('AG-012 not connected') } })
    // Reset the fixture state (the paused op keeps its reservation by design).
    svc.authority.commit('fixture', (d) => { d.agents.find((a) => a.id === 'AG-012')!.status = 'online'; d.agents.find((a) => a.id === 'AG-012')!.op = null })
    // …nor one whose linked plan needs re-approval.
    const planned = readyOperation(svc, { planId: 'PL-021' })
    expect(startOperation(svc.authority, svc.clock, ctxOf(TAYLOR, P14), planned).ok).toBe(true)
    svc.authority.commit('fixture', (d) => { const o = d.operations.find((x) => x.id === planned)!; o.status = 'paused'; d.plans.find((p) => p.id === 'PL-021')!.status = 'expired' })
    expect(resumeOperation(svc.authority, svc.clock, ctxOf(TAYLOR, P14), planned))
      .toMatchObject({ ok: false, failure: { kind: 'validation', message: expect.stringContaining('needs re-approval') } })
    svc.dispose()
  })

  it('resume rechecks scope, read-only context and the run role at the handler, committing nothing', () => {
    const svc = createConsoleServices()
    const opId = readyOperation(svc)
    expect(startOperation(svc.authority, svc.clock, ctxOf(TAYLOR, P14), opId).ok).toBe(true)
    expect(pauseOperation(svc.authority, svc.clock, ctxOf(TAYLOR, P14), opId, 'Recheck probe').ok).toBe(true)
    const before = svc.authority.snapshot()
    // A viewer cannot resume a paused run…
    expect(resumeOperation(svc.authority, svc.clock, ctxOf(CASEY, P14), opId))
      .toMatchObject({ ok: false, failure: { kind: 'forbidden', message: expect.stringContaining('read-only access') } })
    // …nor can a non-run role…
    expect(resumeOperation(svc.authority, svc.clock, ctxOf(RILEY, P14), opId))
      .toMatchObject({ ok: false, failure: { kind: 'forbidden', message: 'Only a Manager or Operator can resume operations.' } })
    // …and an out-of-scope actor learns nothing: not-found with no existence leak.
    expect(resumeOperation(svc.authority, svc.clock, ctxOf(RILEY, 'RT-2026-016'), opId))
      .toMatchObject({ ok: false, failure: { kind: 'not-found' } })
    const after = svc.authority.snapshot()
    expect(after.operations).toEqual(before.operations)
    expect(after.audit).toEqual(before.audit)
    svc.dispose()
  })
})

/* ───────────── Screen bridge: both control consumers, both refetch paths ───────────── */

/** The agent-fleet probe: the KPI the fleet screen derives from the canonical reservations. */
function FleetBusy() {
  const list = useAgentList({})
  return <div>fleet busy {list.data ? list.data.kpis.busy : '…'}</div>
}

const assign = (h: ReturnType<typeof mountServices>, agentId: string, projectId: string, actorRef: ActorRef = ALEX) => {
  const res = assignAgentTransaction(h.svc().authority, h.svc().clock, ctxOf(actorRef, projectId), agentId, { projectId })
  if (!res.ok) throw new Error(res.failure.message)
}

const newDraft = (h: ReturnType<typeof mountServices>, input: Partial<OperationDraftInput>, actorRef: ActorRef = ALEX) => {
  let opId = ''
  h.run(() => {
    const res = createOperationDraft(h.svc().authority, h.svc().clock, ctxOf(actorRef, P14), draftInput(input))
    if (!res.ok) throw new Error(res.failure.message)
    opId = res.data.op.id
  })
  return opId
}

describe('operation controls (ticket 27 — screens)', () => {
  it('the typed Start control starts through the handler; the fleet and the authority observe one commit', async () => {
    const h = mountServices()
    h.run(() => selectProject(P14))
    h.run(() => assign(h, 'AG-012', P14))
    const opId = newDraft(h, { name: 'Control bridge op', mode: 'Manual approval', schedule: '' })
    h.run(() => go('preflight', { id: opId }))
    h.show(<>
      <FleetBusy />
      <routes.preflight />
    </>)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run Preflight' })).toBeInTheDocument())
    // A fresh draft cannot start: no preflight run yet (the render gate mirrors the handler).
    expect((screen.getByRole('button', { name: 'Start Operation' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Run Preflight' }))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Start Operation' }) as HTMLButtonElement).disabled).toBe(false))
    // Direction 1 — the new typed control: the start binds the reservations atomically.
    fireEvent.click(screen.getByRole('button', { name: 'Start Operation' }))
    await waitFor(() => expect(h.db().operations.find((o) => o.id === opId)!.status).toBe('running'))
    expect(h.db().agents.find((a) => a.id === 'AG-012')!.op).toBe(opId)
    // The fleet query refetched from the same ChangeSet: the reservation is visible there.
    await waitFor(() => expect(screen.getByText('fleet busy 3')).toBeInTheDocument())
    h.unmount()
  })

  it('a typed stop releases the reservation observed by the typed fleet read', async () => {
    const h = mountServices()
    h.run(() => selectProject(P14))
    h.run(() => assign(h, 'AG-012', P14))
    const opId = newDraft(h, { name: 'Legacy stop bridge op', mode: 'Manual approval', schedule: '' })
    // The setup runs the typed preflight + start handlers the retired wrappers delegated to.
    h.run(() => { runOperationPreflight(h.svc().authority, h.svc().clock, ctxOf(ALEX, P14), opId) })
    h.run(() => { startOperation(h.svc().authority, h.svc().clock, ctxOf(ALEX, P14), opId) })
    h.show(<>
      <FleetBusy />
      <routes.operations />
    </>)
    // Direction 2 — the typed stop runs the same handler; the typed fleet
    // read observes the reservation (AG-007/AG-008 by OP-014 + AG-012 here).
    await waitFor(() => expect(screen.getByText('fleet busy 3')).toBeInTheDocument())
    // The stop releases it: the fleet KPI and the canonical agent both update.
    h.run(() => { stopOperation(h.svc().authority, h.svc().clock, ctxOf(ALEX, P14), opId, 'Bridge stop proof') })
    await waitFor(() => expect(screen.getByText('fleet busy 2')).toBeInTheDocument())
    await waitFor(() => expect(h.db().operations.find((o) => o.id === opId)!.status).toBe('cancelled'))
    expect(h.db().agents.find((a) => a.id === 'AG-012')!.op).toBeNull()
    h.unmount()
  })

  it('a policy change after the snapshot invalidates the start; the click-time gate refuses with its reason', async () => {
    const h = mountServices()
    h.run(() => selectProject(P14))
    h.run(() => assign(h, 'AG-012', P14))
    const opId = newDraft(h, { name: 'Late policy change op', owner: 'Alex Morgan', mode: 'Manual approval', schedule: '' })
    h.run(() => go('preflight', { id: opId }))
    h.show(<routes.preflight />)
    fireEvent.click(screen.getByRole('button', { name: 'Run Preflight' }))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Start Operation' }) as HTMLButtonElement).disabled).toBe(false))
    // The ROE is revised AFTER the snapshot the button was gated on: the
    // control reflects the refusal (disabled, invalidated snapshot banner).
    h.run(() => {
      const res = reviseScopeTransaction(h.svc().authority, h.svc().clock, ctxOf(ALEX, P14), P14, { patch: { window: 'Mon–Fri, 10:00 AM–4:00 PM (UTC+7)' }, reason: 'Tighten the window' })
      if (!res.ok) throw new Error(res.failure.message)
    })
    await waitFor(() => expect((screen.getByRole('button', { name: 'Start Operation' }) as HTMLButtonElement).disabled).toBe(true))
    expect(screen.getByText('Snapshot invalidated')).toBeInTheDocument()
    // And the gate the click invokes re-derives at call time: it refuses with
    // the failed check and nothing is started.
    await act(async () => {
      const res = await h.svc().operations(TAYLOR, P14).start(ctxOf(TAYLOR, P14), opId)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.failure.message).toContain('PRE-02')
    })
    expect(h.db().operations.find((o) => o.id === opId)!.status).toBe('draft')
    expect(h.db().agents.find((a) => a.id === 'AG-012')!.op).toBeNull()
    h.unmount()
  })

  it('a refused start renders its reason through the toast channel, keeping the operation unstarted', async () => {
    const h = mountServices()
    h.run(() => selectProject(P14))
    h.run(() => assign(h, 'AG-012', P14))
    const opId = newDraft(h, { name: 'Refusal render op', mode: 'Manual approval', schedule: '' })
    h.run(() => go('preflight', { id: opId }))
    h.show(<routes.preflight />)
    fireEvent.click(screen.getByRole('button', { name: 'Run Preflight' }))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Start Operation' }) as HTMLButtonElement).disabled).toBe(false))
    // A gate refusal at click time (simulated service refusal): the control
    // surfaces the typed reason — never a silent start or navigation.
    const svc = h.svc()
    const orig = svc.operations.bind(svc)
    vi.spyOn(svc, 'operations').mockImplementation((a, p) => {
      const inner = orig(a, p)
      return { ...inner, start: async () => ({ ok: false as const, failure: { kind: 'validation' as const, message: 'Simulated start refusal: PRE-07 failed.' } }) }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start Operation' }))
    await waitFor(() => expect(useToastStore.getState().toasts.some((t) => t.text.includes('Simulated start refusal'))).toBe(true))
    // The refusal committed nothing: the operation stays in its (ready) state
    // with no reservation bound and no session created.
    const op = h.db().operations.find((o) => o.id === opId)!
    expect(op.status).toBe('ready')
    expect(op.sessionId).toBeUndefined()
    expect(h.db().agents.find((a) => a.id === 'AG-012')!.op).toBeNull()
    h.unmount()
  })
})
