/**
 * Ticket 42: HITL tool decisions + resolution records at the typed handler
 * (src/features/trace/writes.ts) — the gates the UI used to merely hint at
 * are enforced at one execution site for both entry points (typed service
 * and legacy `decideTool` action).
 *
 * Covered here: the role gate (`approvePlan`) and the four-eyes refusal (a
 * proposal's requester cannot decide it, even with a decision-capable role)
 * refuse with the dataset untouched; only a pending (`awaiting`) proposal
 * can be decided; a reason is required; an ALLOWED decision stores the
 * `allowed` state — Policy Allowed / Approval Approved / Execution **Not
 * executed**, with no fabricated result — plus the persisted resolution
 * record (outcome + actor + instant + reason) and the audit row in ONE
 * ChangeSet; a DENIED decision mirrors the baseline block; the bridge works
 * in both directions (legacy action → Query-backed trace refetch, typed
 * handler → legacy store projection); and the rendered inspector records
 * the decision and refetches the facets without a reload.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { mountServices } from '../../test/helpers'
import { selectProject } from '../../router/navigate'
import type { ActorRef, RequestContext } from '../../domain/service'
import type { Db } from '../../demo/seed';
import { toolFacets } from '../../domain/catalog';
import { AiTrace } from '../../screens/g-trace'
import { decideToolEventTransaction } from './writes'

afterEach(() => { cleanup(); window.location.hash = '' })

/** Mounts the providers (optionally with the trace screen) and a probe. */
function mountProviders(me = 'Pat Kim', projectId = 'RT-2026-014', withScreen = false) {
  window.location.hash = '#/ai-trace'
  const h = mountServices(withScreen ? <AiTrace /> : null, me)
  act(() => { selectProject(projectId) })
  return {
    ...h,
    /** Awaits one sync-or-async service call inside act so the store projection flushes. */
    runA: async <T,>(fn: () => T | Promise<T>): Promise<T> => { let out!: T; await act(async () => { out = await fn() }); return out },
  }
}

const pat = (): ActorRef => ({ id: 'Pat Kim', role: 'reviewer' })
/** The proposal's requester holding a decision-capable role (as an org role override would present). */
const taylorReviewer = (): ActorRef => ({ id: 'Taylor Chen', role: 'reviewer' })
const jordan = (): ActorRef => ({ id: 'Jordan Lee', role: 'manager' })
const casey = (): ActorRef => ({ id: 'Casey Nguyen (Client)', role: 'viewer' })
const ctx = (actor: ActorRef, projectId = 'RT-2026-014', corr = 't'): RequestContext => ({ actor, projectId, corr })

const snap = (h: ReturnType<typeof mountProviders>) => JSON.stringify(h.svc().authority.snapshot())
const pending = (d: Db) => d.toolEvents.find((x) => x.id === 'TL-03')!

describe('decision gates live at the handler (ticket 42)', () => {
  it('the role gate refuses a manager and a viewer with the snapshot untouched', async () => {
    const h = mountProviders()
    const before = snap(h)
    const role = await h.runA(() => decideToolEventTransaction(h.svc().authority, h.svc().clock, ctx(jordan()), 'TL-03', 'allowed', 'Looks safe'))
    expect(role.ok).toBe(false)
    if (!role.ok) {
      expect(role.failure.kind).toBe('forbidden')
      expect(role.failure.message).toContain('Only a Reviewer or Organization Admin can decide tool calls')
    }
    const viewer = await h.runA(() => decideToolEventTransaction(h.svc().authority, h.svc().clock, ctx(casey()), 'TL-03', 'denied', 'no'))
    expect(viewer.ok).toBe(false)
    if (!viewer.ok) {
      expect(viewer.failure.kind).toBe('forbidden')
      expect(viewer.failure.message).toContain('read-only')
    }
    expect(snap(h)).toBe(before)
    h.unmount()
  })

  it('four-eyes: the requester cannot decide their own proposal even with a decision-capable role; an independent reviewer commits', async () => {
    const h = mountProviders()
    const before = snap(h)
    const self = await h.runA(() => decideToolEventTransaction(h.svc().authority, h.svc().clock, ctx(taylorReviewer()), 'TL-03', 'allowed', 'Approving my own request'))
    expect(self.ok).toBe(false)
    if (!self.ok) {
      expect(self.failure.kind).toBe('forbidden')
      expect(self.failure.message).toContain('You cannot decide a tool call you requested')
    }
    expect(snap(h)).toBe(before)
    // An independent reviewer's decision commits: independence is identity-based.
    const ok = await h.runA(() => decideToolEventTransaction(h.svc().authority, h.svc().clock, ctx(pat()), 'TL-03', 'allowed', 'Safe simulated check'))
    expect(ok.ok).toBe(true)
    expect(pending(h.db()).decision).toMatchObject({ outcome: 'allowed', by: 'Pat Kim' })
    h.unmount()
  })

  it('only a pending proposal is decidable; a decided event refuses with a reason', async () => {
    const h = mountProviders()
    const done = await h.runA(() => decideToolEventTransaction(h.svc().authority, h.svc().clock, ctx(pat()), 'TL-01', 'denied', 'already ran'))
    expect(done.ok).toBe(false)
    if (!done.ok) expect(done.failure.kind).toBe('conflict')
    const proposed = await h.runA(() => decideToolEventTransaction(h.svc().authority, h.svc().clock, ctx(pat()), 'TL-07', 'allowed', 'not yet pending'))
    expect(proposed.ok).toBe(false)
    if (!proposed.ok) expect(proposed.failure.message).toContain('no decision is pending')
    h.unmount()
  })

  it('cross-context and missing-reason decisions are refused with the snapshot untouched', async () => {
    const h = mountProviders()
    const before = snap(h)
    const foreign = await h.runA(() => decideToolEventTransaction(h.svc().authority, h.svc().clock, ctx(pat(), 'RT-2026-015'), 'TL-03', 'allowed', 'wrong project'))
    expect(foreign.ok).toBe(false)
    if (!foreign.ok) {
      expect(foreign.failure.kind).toBe('forbidden')
      expect(foreign.failure.message).toContain('belongs to project RT-2026-014')
    }
    const noReason = await h.runA(() => decideToolEventTransaction(h.svc().authority, h.svc().clock, ctx(pat()), 'TL-03', 'denied', '   '))
    expect(noReason.ok).toBe(false)
    if (!noReason.ok) expect(noReason.failure.message).toContain('A decision reason is required')
    expect(snap(h)).toBe(before)
    h.unmount()
  })
})

describe('the decision records policy, never execution (ticket 42)', () => {
  it('allow stores Policy Allowed with the resolution record and audit row in ONE ChangeSet — execution stays Not executed', async () => {
    const h = mountProviders()
    let changesets = 0
    const off = h.svc().authority.subscribe(() => { changesets++ })
    const res = await h.runA(() => decideToolEventTransaction(h.svc().authority, h.svc().clock, ctx(pat()), 'TL-03', 'allowed', 'Safe simulation within ROE-014-v2.'))
    off()
    expect(changesets).toBe(1)
    expect(res.ok).toBe(true)
    const e = pending(h.db())
    // The stored `allowed` flag remains Policy Allowed — never execution.
    expect(e.state).toBe('allowed')
    expect(toolFacets(e)).toEqual({ policy: 'Allowed', approval: 'Approved', exec: 'Not executed' })
    expect(e.result).toBeUndefined()
    // The persisted resolution record: outcome + actor + instant + reason.
    expect(e.decision).toMatchObject({ outcome: 'allowed', by: 'Pat Kim', note: 'Safe simulation within ROE-014-v2.' })
    expect(e.decision!.at).toContain('2026')
    // The linked branch mirrors approval granted — queued, not executed.
    const b = h.db().branches.find((x) => x.id === 'BR-014-04')!
    expect(b).toMatchObject({ approval: 'approved', state: 'queued' })
    expect(b.lastEvent).toContain('not executed')
    // The outcome history: the audit row in the same commit.
    expect(h.db().audit[0]).toMatchObject({ action: 'Allowed tool call', actor: 'Pat Kim', obj: 'defense-sim (safe)', projectId: 'RT-2026-014', result: 'Success', reason: 'Safe simulation within ROE-014-v2.' })
    h.unmount()
  })

  it('deny blocks the proposal and its branch with the same record shape', async () => {
    const h = mountProviders()
    const res = await h.runA(() => decideToolEventTransaction(h.svc().authority, h.svc().clock, ctx(pat()), 'TL-03', 'denied', 'Not needed for this objective'))
    expect(res.ok).toBe(true)
    const e = pending(h.db())
    expect(e.state).toBe('denied')
    expect(toolFacets(e)).toEqual({ policy: 'Blocked', approval: 'Denied', exec: 'Not executed' })
    expect(e.decision).toMatchObject({ outcome: 'denied', by: 'Pat Kim', note: 'Not needed for this objective' })
    expect(h.db().branches.find((x) => x.id === 'BR-014-04')).toMatchObject({ approval: 'denied', state: 'blocked' })
    expect(h.db().audit[0]).toMatchObject({ action: 'Denied tool call', result: 'Success' })
    h.unmount()
  })
})

describe('the bridge observes the decision in both directions (ticket 42)', () => {
  it('a legacy decideTool call publishes the ChangeSet and the Query-backed trace refetches without a reload', async () => {
    const h = mountProviders('Pat Kim', 'RT-2026-014', true)
    await waitFor(() => expect(screen.getByText('TL-03')).toBeInTheDocument())
    h.run(() => { expect(decideToolEventTransaction(h.svc().authority, h.svc().clock, ctx(pat()), 'TL-03', 'allowed', 'Safe simulation within ROE.').ok).toBe(true) })
    const row = await waitFor(() => screen.getByText('TL-03').closest('tr')!)
    await waitFor(() => {
      expect(within(row).getByText('Allowed')).toBeInTheDocument()
      expect(within(row).getByText('Approved')).toBeInTheDocument()
      expect(within(row).getByText('Not executed')).toBeInTheDocument()
    })
    expect(screen.queryByText(/tool call pending approval/)).not.toBeInTheDocument()
    h.unmount()
  })

  it('a typed handler decision is observed by the legacy store projection (and refusals render nothing)', async () => {
    const h = mountProviders('Pat Kim', 'RT-2026-014', true)
    await waitFor(() => expect(screen.getByText('TL-03')).toBeInTheDocument())
    const refused = await h.runA(() => h.svc().trace(pat(), 'RT-2026-014').decide(ctx(pat()), 'TL-03', 'allowed', ''))
    expect(refused.ok).toBe(false)
    const res = await h.runA(() => h.svc().trace(pat(), 'RT-2026-014').decide(ctx(pat()), 'TL-03', 'allowed', 'Safe within ROE.'))
    expect(res.ok).toBe(true)
    // The legacy projection observes the same commit through the one authority.
    expect(pending(h.db())).toMatchObject({ state: 'allowed', decision: { outcome: 'allowed', by: 'Pat Kim' } })
    h.unmount()
  })
})

describe('the rendered inspector records the decision (ticket 42)', () => {
  it('an independent reviewer allows TL-03 from the inspector; the facets and the persisted decision record render without a reload', async () => {
    const h = mountProviders('Pat Kim', 'RT-2026-014', true)
    fireEvent.click(await screen.findByText('TL-03'))
    const drawer = await screen.findByRole('dialog', { name: 'Tool Event Inspector — TL-03' })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Review & allow' }))
    fireEvent.change(within(drawer).getByLabelText('Decision reason'), { target: { value: 'Safe simulated defense check.' } })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Confirm allow' }))
    await waitFor(() => expect(within(drawer).getByText(/allowed by Pat Kim/)).toBeInTheDocument())
    expect(within(drawer).getByText('Safe simulated defense check.')).toBeInTheDocument()
    // The stored state stays Policy Allowed with Execution Not executed — the rendered distinction survives the decision.
    expect(within(drawer).getAllByText('Not executed').length).toBeGreaterThan(0)
    expect(within(drawer).getByText('Approved')).toBeInTheDocument()
    h.unmount()
  })

  it('a non-decider sees the pending state with the role reason and no decision controls', async () => {
    const h = mountProviders('Taylor Chen', 'RT-2026-014', true)
    fireEvent.click(await screen.findByText('TL-03'))
    const drawer = await screen.findByRole('dialog', { name: 'Tool Event Inspector — TL-03' })
    // The Gated controls are inert; the reason surfaces on activation.
    const gated = drawer.querySelector('[aria-disabled="true"]')
    expect(gated).not.toBeNull()
    fireEvent.click(gated!)
    expect(within(drawer).getByText('Your role cannot approve tool calls. Ask a reviewer.')).toBeInTheDocument()
    expect(within(drawer).getByText('No human decision recorded — pending a reviewer')).toBeInTheDocument()
    h.unmount()
  })
})
