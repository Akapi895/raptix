import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { seed, toolFacets } from '../../data'

vi.useFakeTimers()
const { mountServices } = await import('../helpers')
const { evaluateCloseChecklist: closureChecklist, confirmCloseTransaction, requestCloseTransaction } = await import('../../features/closure/service')
const { useDb, useMe } = await import('../../state/console')
const { CloseTab } = await import('../../screens/b-detail2')
const { detailFor } = await import('../../screens/project-detail/service')

afterEach(() => {
  cleanup()
  vi.clearAllTimers()
})

describe('tool facets separate policy, approval and execution (requirement 42)', () => {
  it.each([
    ['proposed', 'Not evaluated', 'Not required', 'Not executed'],
    ['awaiting', 'Allowed', 'Pending', 'Not executed'],
    ['allowed', 'Allowed', 'Approved', 'Not executed'],
    ['denied', 'Blocked', 'Denied', 'Not executed'],
    ['running', 'Allowed', 'Approved', 'Running'],
    ['completed', 'Allowed', 'Approved', 'Executed'],
    ['failed', 'Allowed', 'Approved', 'Failed'],
    ['stopped', 'Allowed', 'Approved', 'Stopped'],
  ] as const)('%s', (state, policy, approval, exec) => {
    expect(toolFacets({ state })).toEqual({ policy, approval, exec })
  })

  it('an allowed tool that has not run reports Allowed policy with no execution', () => {
    expect(toolFacets({ state: 'allowed' })).toEqual({ policy: 'Allowed', approval: 'Approved', exec: 'Not executed' })
  })
})

describe('closure checklist mirrors the seeded authority state (requirement 22)', () => {
  const db = seed()

  it('RT-2026-014 is not closable: live operations, live sessions and no delivered report', () => {
    const chk = closureChecklist(db, 'RT-2026-014')
    expect(chk.map((c) => [c.id, c.ok])).toEqual([
      ['c1', false], ['c1b', false], ['c2', true], ['c3', false], ['c4', true],
    ])
    expect(chk.find((c) => c.id === 'c1')!.detail).toBe('Still open: OP-014')
    expect(chk.find((c) => c.id === 'c1b')!.detail).toBe('Live: SS-041, SS-042')
  })

  it('RT-2026-016 only fails on the undelivered report', () => {
    const chk = closureChecklist(db, 'RT-2026-016')
    expect(chk.map((c) => [c.id, c.ok])).toEqual([
      ['c1', true], ['c1b', true], ['c2', true], ['c3', false], ['c4', true],
    ])
    expect(chk.find((c) => c.id === 'c3')!.detail).toBe('No report has been delivered')
  })

  it('the closed RT-2026-009 satisfies every condition', () => {
    const chk = closureChecklist(db, 'RT-2026-009')
    expect(chk.every((c) => c.ok)).toBe(true)
    expect(chk.find((c) => c.id === 'c3')!.detail).toBe('A report is Delivered')
  })
})

const Tab = ({ pid }: { pid: string }) => {
  const db = useDb()
  const me = useMe()
  const d = detailFor(db, { id: me.name, role: me.role }, pid)!
  return <CloseTab p={d.project} d={d} setTab={() => {}} />
}

describe('requesting closure is manager-gated and blocked while the checklist fails (requirement 22)', () => {
  // The closure read is asynchronous; the module-level fake timers would stall it.
  beforeEach(() => { vi.useRealTimers() })
  it('a manager sees the failing condition and cannot submit the request yet', async () => {
    const view = mountServices(<Tab pid="RT-2026-016" />)
    expect(await screen.findByText('Closure is blocked. Resolve these first:')).toBeInTheDocument()
    expect(screen.getAllByText('Final report approved and delivered').length).toBeGreaterThan(0)
    const submit = await screen.findByRole('button', { name: 'Request closure' })
    expect(submit).toBeDisabled()
    expect(submit).toHaveAttribute('title', 'Resolve the blockers first')
    fireEvent.change(screen.getByPlaceholderText('Why this engagement is complete'), { target: { value: 'All objectives assessed; perimeter findings covered by this closure.' } })
    expect(submit).toBeDisabled()
    expect(submit).toHaveAttribute('title', 'Resolve the blockers first')
    view.unmount()
  })

  it('an operator cannot request closure', async () => {
    const view = mountServices(<Tab pid="RT-2026-016" />, 'Taylor Chen')
    const request = await screen.findByRole('button', { name: 'Request closure' })
    expect(request).toBeDisabled()
    expect(request).toHaveAttribute('title', 'Only a Red Team Manager can request project closure.')
    expect(screen.getByText('Only a Red Team Manager can request project closure.')).toBeInTheDocument()
    view.unmount()
  })

  it('the request accepts a failing checklist (UI-only request) while the confirmation stays gated by the re-derived checklist (ticket 22)', async () => {
    const view = mountServices(<Tab pid="RT-2026-016" />)
    act(() => {
      requestCloseTransaction(view.svc().authority, view.svc().clock, { actor: { id: 'Alex Morgan', role: 'manager' }, projectId: 'RT-2026-016', corr: 'close-req' }, 'RT-2026-016', { reason: 'Requesting review of closure readiness.' })
    })
    expect(view.db().projects.find((p) => p.id === 'RT-2026-016')!.status).toBe('review')
    expect(view.db().approvals.some((a) => a.projectId === 'RT-2026-016' && a.status === 'pending' && a.note === 'Requesting project closure — 1 checklist condition still open.')).toBe(true)

    view.as('Pat Kim')
    expect(await screen.findByRole('button', { name: 'Confirm (independent)' })).toBeEnabled()
    expect(screen.getByText('Alex Morgan')).toBeInTheDocument()
    const aprId = view.db().approvals.find((a) => a.projectId === 'RT-2026-016')!.id
    const refused = confirmCloseTransaction(view.svc().authority, view.svc().clock, { actor: { id: 'Pat Kim', role: 'reviewer' }, projectId: 'RT-2026-016', corr: 'close-confirm' }, aprId)
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.failure.message).toContain('Final report approved and delivered')
    expect(view.db().projects.find((p) => p.id === 'RT-2026-016')!.status).toBe('review')
    view.unmount()
  })
})
