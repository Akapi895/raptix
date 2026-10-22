/**
 * Ticket 39: plan workbench + approval/expiry on typed services — the plan
 * four-eyes policy enforced at the feature boundary
 * (src/features/plans/service.ts).
 *
 * Covered here: the review request is the one gated import path for chat
 * proposals (role-gated, draft/proposed only) and stamps a real absolute
 * review window from the factory clock; the independent-reviewer decision
 * refuses self-approval with the legacy message and planless roles outright;
 * approving without a current approved ROE binding is a validation refusal;
 * approval expiry is decision + 24h (re-approval stamps its own decision
 * time — never a timer extension), the typed read normalizes a
 * past-deadline approval to `expired` while the stored status string stays
 * untouched, and the legacy store refuses execution of an unusable approval;
 * revisions create a validated draft that never modifies the approved plan;
 * withdraw is requester/manager-only and clears the window; draft edits and
 * discard are draft/proposed-only. Both directions of the legacy↔typed
 * bridge and the ChangeSet → My Tasks refetch are proven.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, screen, waitFor } from '@testing-library/react'
import { createHashRouter, RouterProvider } from 'react-router'
import { createConsoleServices } from '../../demo/services';
import type { ConsoleServices } from '../../domain/console-services';
import type { ActorRef, RequestContext } from '../../domain/service'
import { DEMO_ANCHOR } from '../../domain/clock'
import { mountServices } from '../../test/helpers'
import { DAY_MS, createPlanService, effectivePlanStatus, usableApproval } from './service'
import { createOperationFromPlanTransaction } from './bridge'
import { MyTasks } from '../tasks/views/my-tasks'

afterEach(() => { cleanup(); window.location.hash = '' })

const TAYLOR: ActorRef = { id: 'Taylor Chen', role: 'operator' }
const SAM: ActorRef = { id: 'Sam Patel', role: 'manager' }
const PAT: ActorRef = { id: 'Pat Kim', role: 'reviewer' }
const ALEX: ActorRef = { id: 'Alex Morgan', role: 'manager' }
const DANA: ActorRef = { id: 'Dana Whitfield', role: 'admin' }
let corrSeq = 0
const ctx = (actor: ActorRef, projectId = 'all'): RequestContext => ({ actor, projectId, corr: `corr-${++corrSeq}` })

/** Mounts the providers (optionally the My Tasks screen). */
function mountConsole(me = 'Alex Morgan', withTasks = false) {
  window.location.hash = withTasks ? '#/tasks' : ''
  if (withTasks) {
    const router = createHashRouter([{ path: '*', element: <MyTasks /> }])
    return mountServices(<RouterProvider router={router} />, me)
  }
  return mountServices(null, me)
}

describe('plan review request gates (ticket 39)', () => {
  it('requests are role-gated, status-gated and stamp a real 24h window from the factory clock', async () => {
    const svc = createConsoleServices()
    const plans = svc.plans(TAYLOR, 'all')
    // A reviewer cannot import a proposal into review — the request needs a plan-capable role.
    const byPat = await plans.requestReview(ctx(PAT), 'PL-023')
    expect(byPat.ok).toBe(false)
    if (!byPat.ok) expect(byPat.failure.message).toContain('cannot request plan approval')
    // The refusal committed nothing.
    expect(svc.authority.snapshot().plans.find((p) => p.id === 'PL-023')!.status).toBe('draft')
    // An already-approved plan cannot re-enter review through the request path.
    const onApproved = await plans.requestReview(ctx(TAYLOR), 'PL-021')
    expect(onApproved.ok).toBe(false)
    if (!onApproved.ok) expect(onApproved.failure.kind).toBe('conflict')
    // The gated import succeeds for a plan-capable member and stamps now + 24h.
    const ok = await plans.requestReview(ctx(TAYLOR), 'PL-023')
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.data).toMatchObject({ planId: 'PL-023', projectId: 'RT-2026-016', status: 'in_review', expiresAt: DEMO_ANCHOR + DAY_MS })
    const d = svc.authority.snapshot()
    const plan = d.plans.find((p) => p.id === 'PL-023')!
    expect(plan.status).toBe('in_review')
    expect(plan.expires).toBe('Oct 14, 2026, 10:42 AM (UTC+7)')
    // The import is observable: chat card, audit row and a review notice committed together.
    expect(d.conversations.find((c) => c.id === 'CV-016-01')!.messages.some((m) => m.text.includes('sent to Pat Kim for approval'))).toBe(true)
    expect(d.audit[0]).toMatchObject({ action: 'Requested plan approval', obj: 'PL-023', actor: 'Taylor Chen' })
    // A second request conflicts with the in-review status.
    const again = await plans.requestReview(ctx(TAYLOR), 'PL-023')
    expect(again.ok).toBe(false)
    svc.dispose()
  })
})

describe('plan decision gates (ticket 39)', () => {
  it('four-eyes: the requester cannot approve their own plan; planless roles cannot decide at all', async () => {
    const svc = createConsoleServices()
    const plans = svc.plans(TAYLOR, 'all')
    // Taylor revises the approved plan (the requester of the revision is Taylor) and sends it to review.
    await plans.revise(ctx(TAYLOR), 'PL-021', ['Add an approval gate to step 3'])
    await plans.requestReview(ctx(TAYLOR), 'PL-024')
    // The request's own author is refused with the legacy four-eyes message.
    const self = await plans.decide(ctx(TAYLOR), 'PL-024', 'approved', 'looks fine')
    expect(self.ok).toBe(false)
    if (!self.ok) expect(self.failure.message).toBe('You cannot approve a plan you requested. Ask another reviewer.')
    // An operator cannot decide someone else's plan either way.
    const byOperator = await plans.decide(ctx(TAYLOR), 'PL-022', 'approved', 'ok')
    expect(byOperator.ok).toBe(false)
    if (!byOperator.ok) expect(byOperator.failure.message).toContain('Only a Reviewer or Organization Admin can decide AI plans')
    // The refusal order leaves both plans untouched.
    const d = svc.authority.snapshot()
    expect(d.plans.find((p) => p.id === 'PL-024')!.status).toBe('in_review')
    expect(d.plans.find((p) => p.id === 'PL-022')!.status).toBe('in_review')
    // A returning decision by an eligible reviewer needs a justification.
    const noNote = await svc.plans(PAT, 'all').decide(ctx(PAT), 'PL-022', 'returned', '   ')
    expect(noNote.ok).toBe(false)
    if (!noNote.ok) expect(noNote.failure.kind).toBe('validation')
    // The justified return sends the plan back to draft with the decision recorded.
    const returned = await svc.plans(PAT, 'all').decide(ctx(PAT), 'PL-022', 'returned', 'Tighten the scope first.')
    expect(returned.ok).toBe(true)
    const plan = svc.authority.snapshot().plans.find((p) => p.id === 'PL-022')!
    expect(plan.status).toBe('draft')
    expect(plan.decision).toMatchObject({ by: 'Pat Kim', note: 'Tighten the scope first.' })
    expect(plan.expires).toBeUndefined()
    svc.dispose()
  })

  it('approving stamps decision + 24h from the factory clock and the ROE binding must be current', async () => {
    const svc = createConsoleServices()
    // PL-022 sits in review pinned to a superseded ROE version: approval is a validation refusal.
    const stale = await svc.plans(PAT, 'all').decide(ctx(PAT), 'PL-022', 'approved', 'ok')
    expect(stale.ok).toBe(false)
    if (!stale.ok) expect(stale.failure.message).toBe('Cannot approve: the plan is pinned to ROE v1, but the project is on ROE-015-v1. Re-approve under the current ROE.')
    // A revision re-pins to the project's current ROE; request and approve it.
    const revised = await svc.plans(TAYLOR, 'all').revise(ctx(TAYLOR), 'PL-021', ['Add an approval gate to step 3'])
    expect(revised.ok).toBe(true)
    const draftId = revised.ok ? revised.data.planId : ''
    expect(draftId).toBe('PL-024')
    const plans = svc.plans(TAYLOR, 'all')
    await plans.requestReview(ctx(TAYLOR), draftId)
    svc.clock.advance(90 * 60 * 1000)
    const approved = await svc.plans(PAT, 'all').decide(ctx(PAT), draftId, 'approved', 'Gated as requested.')
    expect(approved.ok).toBe(true)
    if (approved.ok) expect(approved.data.status).toBe('approved')
    const d = svc.authority.snapshot()
    const plan = d.plans.find((p) => p.id === draftId)!
    // The expiry derives from THIS decision instant (12:12 PM + 24h), not the request or the seed.
    expect(plan.decision!.at).toBe('Oct 13, 2026, 12:12 PM (UTC+7)')
    expect(plan.expires).toBe('Oct 14, 2026, 12:12 PM (UTC+7)')
    expect(plan.status).toBe('approved')
    // The approved predecessor stays pinned: status, operation and seeded expiry untouched.
    const prev = d.plans.find((p) => p.id === 'PL-021')!
    expect(prev).toMatchObject({ status: 'approved', opId: 'OP-014', expires: 'Oct 14, 2026, 9:25 AM (UTC+7)' })
    // The seeded demo decision was never rewritten.
    expect(d.plans.find((p) => p.id === 'PL-021')!.decision!.note).toBe('Approved within ROE-014-v2.')
    svc.dispose()
  })
})

describe('approval expiry (ticket 39)', () => {
  it('the typed read normalizes a past-deadline approval and the store refuses execution while the stored status is untouched', async () => {
    const h = mountConsole()
    const plans = h.svc().plans(TAYLOR, 'all')
    const deadline = Date.parse('2026-10-14T09:25:00+07:00')
    const until = (t: number) => h.svc().clock.advance(t - h.svc().clock.now())
    const raw = () => h.db().plans.find((p) => p.id === 'PL-021')!
    const read = async () => {
      const r = await plans.get(ctx(TAYLOR), 'PL-021')
      return r.ok ? r.data.status : 'error'
    }
    // One instant before the deadline the approval is usable and execution returns the pinned operation.
    until(deadline - 1)
    expect(effectivePlanStatus(raw(), h.svc().clock.now())).toBe('approved')
    expect(usableApproval(raw(), h.svc().clock.now()).ok).toBe(true)
    expect(await read()).toBe('approved')
    const bound = h.run(() => createOperationFromPlanTransaction(h.svc().authority, h.svc().clock, ctx(TAYLOR), 'PL-021'))
    expect(bound).toMatchObject({ ok: true })
    expect(bound.ok ? bound.data.opId : '').toBe('OP-014')
    // The factory-wired typed bind surface reads the same window at the same handler.
    let bridged!: Awaited<ReturnType<ReturnType<ConsoleServices['plansBridge']>['createOperation']>>
    await act(async () => { bridged = await h.svc().plansBridge(TAYLOR, 'all').createOperation(ctx(TAYLOR), 'PL-021') })
    expect(bridged.ok && bridged.data.opId === 'OP-014' && bridged.data.created === false).toBe(true)
    // At the deadline exactly, the approval is spent: the read flips and execution refuses.
    until(deadline)
    expect(effectivePlanStatus(raw(), h.svc().clock.now())).toBe('expired')
    expect(await read()).toBe('expired')
    const refused = h.run(() => createOperationFromPlanTransaction(h.svc().authority, h.svc().clock, ctx(TAYLOR), 'PL-021'))
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.failure.message).toContain('expired')
    await act(async () => { bridged = await h.svc().plansBridge(TAYLOR, 'all').createOperation(ctx(TAYLOR), 'PL-021') })
    expect(bridged.ok).toBe(false)
    if (!bridged.ok) expect(bridged.failure.message).toContain('expired')
    // One instant past the deadline both bind entries still refuse.
    until(deadline + 1)
    expect(usableApproval(raw(), h.svc().clock.now()).ok).toBe(false)
    expect(h.run(() => createOperationFromPlanTransaction(h.svc().authority, h.svc().clock, ctx(TAYLOR), 'PL-021')).ok).toBe(false)
    await act(async () => { bridged = await h.svc().plansBridge(TAYLOR, 'all').createOperation(ctx(TAYLOR), 'PL-021') })
    expect(bridged.ok).toBe(false)
    // Farther past the deadline the refusal persists.
    until(deadline + 60_000)
    expect(h.run(() => createOperationFromPlanTransaction(h.svc().authority, h.svc().clock, ctx(TAYLOR), 'PL-021')).ok).toBe(false)
    // The stored status string stays 'approved' — expiry is read-side until something commits.
    expect(raw().status).toBe('approved')
    expect(raw().expires).toBe('Oct 14, 2026, 9:25 AM (UTC+7)')
    h.unmount()
  })

  it('re-approval stamps its own decision time — never a silent extension of the old window', async () => {
    const svc = createConsoleServices()
    const plans = svc.plans(TAYLOR, 'all')
    await plans.revise(ctx(TAYLOR), 'PL-021', ['Add an approval gate to step 3'])
    await plans.requestReview(ctx(TAYLOR), 'PL-024')
    svc.clock.advance(6 * 60 * 60 * 1000)
    const reviewer = svc.plans(PAT, 'all')
    await reviewer.decide(ctx(PAT), 'PL-024', 'approved', 'ok')
    expect(svc.authority.snapshot().plans.find((p) => p.id === 'PL-024')!.expires).toBe('Oct 14, 2026, 4:42 PM (UTC+7)')
    // The path back into review is a revision: PL-025 re-pins to the current ROE as a fresh draft.
    svc.clock.advance(6 * 60 * 60 * 1000)
    const revised = await plans.revise(ctx(TAYLOR), 'PL-024', ['Narrow the scope'])
    expect(revised.ok).toBe(true)
    if (revised.ok) expect(revised.data.planId).toBe('PL-025')
    await plans.requestReview(ctx(TAYLOR), 'PL-025')
    svc.clock.advance(2 * 60 * 60 * 1000)
    await reviewer.decide(ctx(PAT), 'PL-025', 'approved', 'ok now')
    const expires = svc.authority.snapshot().plans.find((p) => p.id === 'PL-025')!.expires
    // The window starts at the LATEST decision (anchor + 14h + 24h), never at the old expiry + 24h.
    expect(expires).toBe('Oct 15, 2026, 12:42 AM (UTC+7)')
    expect(expires).not.toBe('Oct 15, 2026, 4:42 PM (UTC+7)')
    svc.dispose()
  })
})

describe('proposal import path (invariant 5 at the plan boundary)', () => {
  it('chat proposals enter the lifecycle only through the gated requestReview; the service surface has no execution path', async () => {
    const svc = createConsoleServices()
    const chat = svc.chat(SAM, 'RT-2026-015')
    expect(chat.respond(ctx(SAM, 'RT-2026-015'), 'CV-015-01', 'Plan a validation run for the in-scope cloud assets.').ok).toBe(true)
    const proposed = svc.authority.snapshot().plans[0]!
    expect(proposed.status).toBe('proposed')
    // Surface keys: proposal-shaped capabilities only — no execute, no start.
    // (Ticket 70 binds feature services lazily; the key surface the factory
    // scope wires is the feature service created on first call.)
    const materialized = createPlanService(svc.authority, svc.clock, (produce) => Promise.resolve(produce()))
    expect(Object.keys(materialized).sort()).toEqual(['decide', 'discard', 'editDraft', 'get', 'requestReview', 'revise', 'withdrawReview'])
    // A reviewer cannot import the proposal; a plan-capable member can.
    const byPat = await svc.plans(PAT, 'all').requestReview(ctx(PAT), proposed.id)
    expect(byPat.ok).toBe(false)
    if (!byPat.ok) expect(byPat.failure.kind).toBe('forbidden')
    const ok = await svc.plans(SAM, 'all').requestReview(ctx(SAM, 'RT-2026-015'), proposed.id)
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.data.status).toBe('in_review')
    expect(svc.authority.snapshot().plans.find((p) => p.id === proposed.id)!.status).toBe('in_review')
    svc.dispose()
  })
})

describe('revision rules (ticket 39)', () => {
  it('revisions are approved-only, non-empty and plan-capable; the approved plan is never modified', async () => {
    const svc = createConsoleServices()
    const plans = svc.plans(TAYLOR, 'all')
    const before = JSON.stringify(svc.authority.snapshot().plans.find((p) => p.id === 'PL-021'))
    // In-review plans refuse revision; so do empty change lists and planless roles.
    const onReview = await plans.revise(ctx(TAYLOR), 'PL-022', ['change'])
    expect(onReview.ok).toBe(false)
    if (!onReview.ok) expect(onReview.failure.message).toContain('Only an approved plan can be revised')
    const empty = await plans.revise(ctx(TAYLOR), 'PL-021', ['  ', ''])
    expect(empty.ok).toBe(false)
    if (!empty.ok) expect(empty.failure.kind).toBe('validation')
    const byReviewer = await svc.plans(PAT, 'all').revise(ctx(PAT), 'PL-021', ['change'])
    expect(byReviewer.ok).toBe(false)
    if (!byReviewer.ok) expect(byReviewer.failure.message).toContain('cannot revise plans')
    // A valid revision creates PL-024 as a draft pinned to the project's current ROE.
    const ok = await plans.revise(ctx(TAYLOR), 'PL-021', ['Add an approval gate to step 3', '  Trim scope to two hosts  '])
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.data).toEqual({ planId: 'PL-024', prevPlanId: 'PL-021', version: 3 })
    const d = svc.authority.snapshot()
    const draft = d.plans.find((p) => p.id === 'PL-024')!
    expect(draft).toMatchObject({ status: 'draft', ver: 'v1.3', prevPlanId: 'PL-021', requestedBy: 'Taylor Chen', roeVersion: 'ROE-014-v2' })
    expect(draft.changes).toEqual(['Add an approval gate to step 3', 'Trim scope to two hosts'])
    expect(draft.opId).toBeUndefined()
    expect(draft.expires).toBeUndefined()
    expect(draft.decision).toBeUndefined()
    // The addressed approved plan is byte-identical after the revision.
    expect(JSON.stringify(d.plans.find((p) => p.id === 'PL-021'))).toBe(before)
    svc.dispose()
  })
})

describe('withdraw review (ticket 39)', () => {
  it('only the requester or a scope manager withdraws, in_review only, and the window clears', async () => {
    const svc = createConsoleServices()
    const plans = svc.plans(SAM, 'all')
    // Approved plans are not withdrawable — the status gate names it.
    const onApproved = await plans.withdrawReview(ctx(SAM), 'PL-021')
    expect(onApproved.ok).toBe(false)
    if (!onApproved.ok) expect(onApproved.failure.message).toContain('Only a plan in review can be withdrawn')
    // A reviewer who is neither requester nor scope manager is refused.
    const byPat = await svc.plans(PAT, 'all').withdrawReview(ctx(PAT), 'PL-022')
    expect(byPat.ok).toBe(false)
    if (!byPat.ok) expect(byPat.failure.message).toBe('Only the requester, a Red Team Manager or an Organization Admin can withdraw this review.')
    // The requester pulls the plan out of review; the window clears so no stale countdown survives.
    expect(await plans.withdrawReview(ctx(SAM), 'PL-022').then((r) => r.ok)).toBe(true)
    const d = svc.authority.snapshot()
    const plan = d.plans.find((p) => p.id === 'PL-022')!
    expect(plan).toMatchObject({ status: 'draft', expires: undefined })
    expect(d.audit[0]).toMatchObject({ action: 'Withdrew plan review', obj: 'PL-022', actor: 'Sam Patel' })
    // Re-requested, a scope manager can withdraw on the requester's behalf.
    expect((await plans.requestReview(ctx(SAM), 'PL-022')).ok).toBe(true)
    expect((await svc.plans(ALEX, 'all').withdrawReview(ctx(ALEX), 'PL-022')).ok).toBe(true)
    expect(svc.authority.snapshot().plans.find((p) => p.id === 'PL-022')!.status).toBe('draft')
    svc.dispose()
  })
})

describe('legacy ↔ typed bridge (ticket 39)', () => {
  it('the typed service write is observed by the canonical snapshot, and a typed decision is observed by the typed read', async () => {
    const h = mountConsole()
    // Write → snapshot: the request commits through the authority; the canonical projection sees it.
    const plans = h.svc().plans(TAYLOR, 'all')
    await act(async () => { await plans.requestReview(ctx(TAYLOR), 'PL-023') })
    const d = h.db()
    expect(d.plans.find((p) => p.id === 'PL-023')!.status).toBe('in_review')
    expect(d.conversations.find((c) => c.id === 'CV-016-01')!.messages.some((m) => m.text.includes('sent to Pat Kim for approval'))).toBe(true)
    expect(d.notices.some((n) => n.text === 'AI plan PL-023 needs review')).toBe(true)
    // Decision → typed read: the admin decides through the typed boundary; the read observes it.
    expect((await plans.decide(ctx(DANA), 'PL-023', 'rejected', 'Out of scope for this quarter')).ok).toBe(true)
    const read = await plans.get(ctx(TAYLOR), 'PL-023')
    expect(read.ok).toBe(true)
    if (read.ok) {
      expect(read.data.status).toBe('rejected')
      expect(read.data.decision).toMatchObject({ by: 'Dana Whitfield', note: 'Out of scope for this quarter' })
    }
    h.unmount()
  })
})

describe('draft edits and discard (ticket 39)', () => {
  it('draft/proposed-only edits and discard; discard removes the plan and its chat cards', async () => {
    const svc = createConsoleServices()
    const plans = svc.plans(TAYLOR, 'all')
    // Approved plans are frozen — the refusal names Revise as the path.
    const frozen = await plans.editDraft(ctx(TAYLOR), 'PL-021', { title: 'nope' })
    expect(frozen.ok).toBe(false)
    if (!frozen.ok) expect(frozen.failure.message).toContain('frozen — use Revise to create a new version')
    // Reviewers cannot edit drafts either.
    const byPat = await svc.plans(PAT, 'all').editDraft(ctx(PAT), 'PL-023', { title: 'nope' })
    expect(byPat.ok).toBe(false)
    if (!byPat.ok) expect(byPat.failure.message).toContain('cannot edit plans')
    // A plan-capable member saves the draft edit with the clock stamp.
    const ok = await plans.editDraft(ctx(TAYLOR), 'PL-023', { title: 'External exposure mapping plan (tightened)' })
    expect(ok.ok).toBe(true)
    const edited = svc.authority.snapshot().plans.find((p) => p.id === 'PL-023')!
    expect(edited.title).toBe('External exposure mapping plan (tightened)')
    expect(edited.updated).toBe('Oct 13, 2026, 10:42 AM (UTC+7)')
    // In-review plans cannot be discarded; the draft proposal can.
    const onReview = await plans.discard(ctx(TAYLOR), 'PL-022')
    expect(onReview.ok).toBe(false)
    if (!onReview.ok) expect(onReview.failure.message).toContain('Only a draft proposal can be discarded')
    expect((await plans.discard(ctx(TAYLOR), 'PL-023')).ok).toBe(true)
    const d = svc.authority.snapshot()
    expect(d.plans.some((p) => p.id === 'PL-023')).toBe(false)
    expect(d.conversations.find((c) => c.id === 'CV-016-01')!.messages.some((m) => m.planId === 'PL-023')).toBe(false)
    svc.dispose()
  })
})

describe('ChangeSet → My Tasks refetch (ticket 39)', () => {
  it('a typed service write publishes a ChangeSet the inbox refetches on — no reload', async () => {
    const h = mountConsole('Alex Morgan', true)
    await screen.findByText(/All \(4\)/)
    expect(screen.queryByText('PL-023 — External exposure mapping plan')).not.toBeInTheDocument()
    // Taylor (plan-capable member) imports the draft into review; the inbox observes the ChangeSet.
    const plans = h.svc().plans(TAYLOR, 'all')
    await act(async () => { await plans.requestReview(ctx(TAYLOR), 'PL-023') })
    expect(await screen.findByText('PL-023 — External exposure mapping plan')).toBeInTheDocument()
    expect(screen.getByText(/expires in 2[34] h/)).toBeInTheDocument()
    // The requester withdraws the review; the row clears through the same bridge.
    const requester = h.svc().plans(ALEX, 'all')
    await act(async () => { await requester.withdrawReview(ctx(ALEX), 'PL-023') })
    await waitFor(() => expect(screen.queryByText('PL-023 — External exposure mapping plan')).not.toBeInTheDocument())
    expect(screen.getByText(/All \(4\)/)).toBeInTheDocument()
    h.unmount()
  })
})
