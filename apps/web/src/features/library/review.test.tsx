/**
 * Ticket 53: independent playbook revision review on typed services — the
 * validated revision proposal (strict version bump, changelog, catalog
 * techniques, one-pending-at-a-time state), the draft submit-for-review
 * transition, the role-gated + author-independent + reason-mandatory
 * decision (approve promotes the reviewed version to the one active
 * version; return records an actionable note and never touches an approved
 * active version), the cross-project refusal without existence leaks, the
 * operation wizard's canonical eligibility (a pending revision is never a
 * selectable version), the review-queue read, and the bidirectional bridge
 * (typed decisions observed by the legacy store; legacy review actions
 * refetch the new queue views).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { mountServices } from '../../test/helpers'
import { useRoute } from '../../router/navigate'
import { useSessionStore } from '../../state/session'
import { useToastStore } from '../../state/stores'
import type { RequestContext } from '../../domain/service'
import { createDatabaseAuthority, type DbAuthority } from '../../domain/database'
import { DEMO_ANCHOR } from '../../domain/clock'
import { routes } from '../../screens/d'
import { seed } from '../../data'
import { operationDraftOptions } from '../operations/service'
import { decideRevision, proposeRevision, reviewQueue, submitForReview } from './service'

beforeEach(() => { window.location.hash = '' })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

function mountReview(me = 'Alex Morgan', hash = '#/playbook-review') {
  window.location.hash = hash
  const Host = () => {
    const route = useRoute()
    const C = routes[route.page]
    return C ? <C /> : null
  }
  const h = mountServices(null, me)
  return { ...h, show: () => h.show(<Host />) }
}

const fakeClock = { now: () => DEMO_ANCHOR }
const freshAuthority = (): DbAuthority => createDatabaseAuthority(fakeClock)

describe('revision review handlers (ticket 53)', () => {
  const alex = { id: 'Alex Morgan', role: 'manager' as const }
  const jordan = { id: 'Jordan Lee', role: 'manager' as const }
  const pat = { id: 'Pat Kim', role: 'reviewer' as const }
  const dana = { id: 'Dana Whitfield', role: 'admin' as const }
  const riley = { id: 'Riley Brooks', role: 'analyst' as const }
  const ctx = (actor: RequestContext['actor'], projectId = 'all'): RequestContext => ({ actor, projectId, corr: 't' })
  const pbOf = (auth: DbAuthority, id: string) => auth.snapshot().playbooks.find((x) => x.id === id)!

  it('a revision proposal is validated: strict version bump, changelog, catalog techniques and state', () => {
    const auth = freshAuthority()
    const noBump = proposeRevision(auth, fakeClock, ctx(alex), 'PB-003', { version: '1.1', summary: ['Tighten step names'] })
    expect(!noBump.ok && noBump.failure.kind).toBe('validation')
    const badFormat = proposeRevision(auth, fakeClock, ctx(alex), 'PB-003', { version: 'next', summary: ['x'] })
    expect(!badFormat.ok && badFormat.failure.kind).toBe('validation')
    const noChangelog = proposeRevision(auth, fakeClock, ctx(alex), 'PB-003', { version: '1.2', summary: ['  '] })
    expect(!noChangelog.ok && noChangelog.failure.message).toContain('changelog')
    const unknownTech = proposeRevision(auth, fakeClock, ctx(alex), 'PB-003', { version: '1.2', summary: ['x'], techniques: ['T9999'] })
    expect(!unknownTech.ok && unknownTech.failure.message).toContain('T9999')
    const alreadyPending = proposeRevision(auth, fakeClock, ctx(alex), 'PB-001', { version: '2.5', summary: ['x'] })
    expect(!alreadyPending.ok && alreadyPending.failure.kind).toBe('conflict')
    const onDraft = proposeRevision(auth, fakeClock, ctx(alex), 'PB-004', { version: '1.0', summary: ['x'] })
    expect(!onDraft.ok && onDraft.failure.message).toContain('submit it for review')
    expect(pbOf(auth, 'PB-003').revision).toBeUndefined()
  })

  it('a valid proposal preserves the approved active version and records pending-review metadata', () => {
    const auth = freshAuthority()
    const res = proposeRevision(auth, fakeClock, ctx(jordan), 'PB-003', { version: '1.2', summary: ['Tighten step names', ''], steps: [...pbOf(auth, 'PB-003').steps, 'Reconcile audit-log export'] })
    expect(res.ok).toBe(true)
    if (res.ok) {
      const p = pbOf(auth, 'PB-003')
      expect(p.version).toBe('1.1')
      expect(p.status).toBe('approved')
      expect(p.revision?.version).toBe('1.2')
      expect(p.revision?.by).toBe('Jordan Lee')
      expect(p.revision?.summary).toEqual(['Tighten step names'])
      expect(auth.snapshot().audit[0].action).toBe('Submitted playbook revision')
      expect(auth.snapshot().audit[0].result).toBe('Pending')
      expect(auth.snapshot().notices[0].text).toContain('PB-003 v1.2 is waiting for review')
    }
  })

  it('submitting a draft for review is a state transition, and approval activates the initial version', () => {
    const auth = freshAuthority()
    // PB-004 is 'Team only': a non-elevated actor is refused before the role
    // check even runs — visibility first, no existence leak.
    const invisible = submitForReview(auth, fakeClock, ctx(riley), 'PB-004')
    expect(!invisible.ok && invisible.failure.kind).toBe('not-found')
    const res = submitForReview(auth, fakeClock, ctx(alex), 'PB-004')
    expect(res.ok && pbOf(auth, 'PB-004').status).toBe('review')
    const again = submitForReview(auth, fakeClock, ctx(alex), 'PB-004')
    expect(!again.ok && again.failure.kind).toBe('conflict')
    const decided = decideRevision(auth, fakeClock, ctx(pat), 'PB-004', 'approve', 'First version looks safe')
    expect(decided.ok && decided.data.activated).toBe(true)
    expect(pbOf(auth, 'PB-004').status).toBe('approved')
    expect(pbOf(auth, 'PB-004').version).toBe('0.9')
  })

  it('decisions are role-gated, author-independent, reason-mandatory and state-checked', () => {
    const auth = freshAuthority()
    const wrongRole = decideRevision(auth, fakeClock, ctx(jordan), 'PB-001', 'approve', 'Looks fine')
    expect(!wrongRole.ok && wrongRole.failure.kind).toBe('forbidden')
    expect(!wrongRole.ok && wrongRole.failure.message).toContain('Only Reviewers and Admins')
    const selfReview = decideRevision(auth, fakeClock, ctx(dana), (() => {
      expect(proposeRevision(auth, fakeClock, ctx(dana), 'PB-003', { version: '1.2', summary: ['x'] }).ok).toBe(true)
      return 'PB-003'
    })(), 'approve', 'My own work')
    expect(!selfReview.ok && selfReview.failure.message).toContain('cannot review your own')
    const noReason = decideRevision(auth, fakeClock, ctx(pat), 'PB-001', 'approve', '   ')
    expect(!noReason.ok && noReason.failure.message).toContain('reason is required')
    const invalid = decideRevision(auth, fakeClock, ctx(pat), 'PB-001', 'reject' as 'approve', 'x')
    expect(!invalid.ok && invalid.failure.kind).toBe('validation')
    const nothing = decideRevision(auth, fakeClock, ctx(pat), 'PB-002', 'approve', 'x')
    expect(!nothing.ok && nothing.failure.kind).toBe('conflict')
    expect(pbOf(auth, 'PB-001').version).toBe('2.3')
  })

  it('an independent approval activates the reviewed version and clears the pending candidate', () => {
    const auth = freshAuthority()
    const res = decideRevision(auth, fakeClock, ctx(pat), 'PB-001', 'approve', 'Changelog verified, version bumped')
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.version).toBe('2.4')
      expect(res.data.activeVersion).toBe('2.4')
      expect(res.data.activated).toBe(true)
    }
    const p = pbOf(auth, 'PB-001')
    expect(p.version).toBe('2.4')
    expect(p.status).toBe('approved')
    expect(p.revision).toBeUndefined()
    expect(p.steps).toHaveLength(13)
    expect(auth.snapshot().audit[0].reason).toBe('Changelog verified, version bumped')
  })

  it('a return records the actionable note and never touches the approved active version', () => {
    const auth = freshAuthority()
    const res = decideRevision(auth, fakeClock, ctx(pat), 'PB-001', 'return', 'Step 13 needs a safer description')
    expect(res.ok && res.data.activated).toBe(false)
    const p = pbOf(auth, 'PB-001')
    expect(p.version).toBe('2.3')
    expect(p.status).toBe('approved')
    expect(p.revision).toBeUndefined()
    expect(p.steps).toHaveLength(12)
    expect(auth.snapshot().audit[0].reason).toBe('Step 13 needs a safer description')
    expect(auth.snapshot().notices[0].text).toContain('returned to draft: Step 13 needs a safer description')
  })

  it('a cross-project actor is refused without an existence leak and nothing commits', () => {
    const auth = freshAuthority()
    const before = auth.snapshot().audit.length
    const propose = proposeRevision(auth, fakeClock, ctx(riley, 'RT-2026-014'), 'PB-003', { version: '1.2', summary: ['x'] })
    expect(!propose.ok && propose.failure.kind).toBe('not-found')
    const decide = decideRevision(auth, fakeClock, ctx(riley), 'PB-003', 'approve', 'x')
    expect(!decide.ok && decide.failure.kind).toBe('not-found')
    expect(pbOf(auth, 'PB-003').version).toBe('1.1')
    expect(auth.snapshot().audit.length).toBe(before)
  })

  it('the review queue lists the visible pending work with handler-computed gates', () => {
    const res = reviewQueue(seed(), ctx(pat))
    expect(res.ok).toBe(true)
    if (res.ok) {
      const pb1 = res.data.items.find((x) => x.playbookId === 'PB-001')
      expect(pb1?.pending.kind).toBe('revision')
      expect(pb1?.pending.version).toBe('2.4')
      expect(pb1?.activeVersion).toBe('2.3')
      expect(pb1?.canDecide).toBe(true)
    }
    const author = reviewQueue(seed(), ctx(jordan))
    expect(author.ok && author.data.items.find((x) => x.playbookId === 'PB-001')?.canDecide).toBe(false)
    const limited = reviewQueue(seed(), ctx(riley))
    expect(limited.ok && limited.data.items.map((x) => x.playbookId)).toEqual(['PB-001'])
  })

  it('operation wizard options observe canonical eligibility: a pending revision is never a selectable version', () => {
    const auth = freshAuthority()
    const selectable = () => {
      const res = operationDraftOptions(auth.snapshot(), ctx(alex, 'RT-2026-014'))
      expect(res.ok).toBe(true)
      return res.ok ? res.data.playbooks : []
    }
    expect(selectable().find((x) => x.id === 'PB-001')?.version).toBe('2.3')
    expect(proposeRevision(auth, fakeClock, ctx(jordan), 'PB-003', { version: '1.2', summary: ['x'] }).ok).toBe(true)
    expect(selectable().find((x) => x.id === 'PB-003')?.version).toBe('1.1')
    expect(decideRevision(auth, fakeClock, ctx(pat), 'PB-003', 'approve', 'ok').ok).toBe(true)
    expect(selectable().find((x) => x.id === 'PB-003')?.version).toBe('1.2')
    expect(selectable().some((x) => x.id === 'PB-004')).toBe(false)
  })
})

describe('playbook review screen (ticket 53)', () => {
  it('an independent reviewer approves the seeded revision and the detail shows v2.4 active with the banner cleared', async () => {
    const h = mountReview('Pat Kim', '#/playbook-review/PB-001')
    h.show()
    await waitFor(() => expect(screen.getByText('Step & technique diff: v2.3 → v2.4')).toBeInTheDocument())
    expect(screen.getByText('Validate audit-log forwarding (safe)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Approve v2.4' }))
    expect(useSessionStore.getState().confirmState).not.toBeNull()
    h.run(() => useSessionStore.getState().confirmState!.onConfirm('Changelog verified against the lab scope'))
    await waitFor(() => expect(screen.getByText('Steps (13)')).toBeInTheDocument())
    expect(screen.getByText('PB-001 · v2.4')).toBeInTheDocument()
    expect(screen.queryByText('v2.4 is pending review')).not.toBeInTheDocument()
    expect(h.db().playbooks.find((x) => x.id === 'PB-001')?.version).toBe('2.4')
    h.unmount()
  })

  it('the review gate locks the decisions for a non-approver and for the revision author', async () => {
    const h = mountReview('Jordan Lee', '#/playbook-review/PB-001')
    h.show()
    await waitFor(() => expect(screen.getByText('Step & technique diff: v2.3 → v2.4')).toBeInTheDocument())
    const locked = screen.getAllByText('Only Reviewers and Admins can approve or return playbooks.').length
    expect(locked).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Approve v2.4' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Return to Draft' })).toBeDisabled()
    h.unmount()
  })

  it('a revision proposal is validated in the screen and a valid one shows the pending metadata while v1.1 stays active', async () => {
    const h = mountReview('Alex Morgan', '#/playbook-review/PB-003')
    h.show()
    await waitFor(() => expect(screen.getByText('Propose revision after v1.1')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText(/New version/), { target: { value: '1.1' } })
    fireEvent.change(screen.getByLabelText(/Changelog/), { target: { value: 'Tighten step names' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit revision' }))
    await waitFor(() => expect(useToastStore.getState().toasts[0]?.text).toContain('bump above v1.1'))
    expect(screen.getByText('Propose revision after v1.1')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/New version/), { target: { value: '1.2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit revision' }))
    await waitFor(() => expect(screen.getByText('Pending v1.2')).toBeInTheDocument())
    expect(screen.getByText('v1.1 is Approved and frozen')).toBeInTheDocument()
    expect(h.db().playbooks.find((x) => x.id === 'PB-003')?.version).toBe('1.1')
    h.unmount()
  })

  it('the review queue lists pending work, legacy review actions refetch it, and typed decisions update the legacy store', async () => {
    const h = mountReview('Alex Morgan', '#/playbook-review')
    h.show()
    await waitFor(() => expect(screen.getByText('PB-001 · v2.4 → v2.3')).toBeInTheDocument())
    expect(screen.queryByText('PB-004')).not.toBeInTheDocument()
    h.run(() => { expect(submitForReview(h.svc().authority, h.svc().clock, { actor: { id: 'Alex Morgan', role: 'manager' }, projectId: 'all', corr: 'review-queue-refetch' }, 'PB-004').ok).toBe(true) })
    await waitFor(() => expect(screen.getByText('PB-004 · v0.9 → v0.9')).toBeInTheDocument())
    h.run(() => {
      return h.svc().library({ id: 'Pat Kim', role: 'reviewer' }, 'all')
        .decideRevision({ actor: { id: 'Pat Kim', role: 'reviewer' }, projectId: 'all', corr: 'test' }, 'PB-001', 'approve', 'Queue decision')
    })
    await waitFor(() => expect(screen.queryByText('PB-001 · v2.4 → v2.3')).not.toBeInTheDocument())
    expect(h.db().playbooks.find((x) => x.id === 'PB-001')?.version).toBe('2.4')
    h.unmount()
  })
})
