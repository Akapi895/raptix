import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { toolFacets } from '../data'

vi.useFakeTimers()
const { mountStore, mountScreen } = await import('../test/helpers')
const { evaluateCloseChecklist: closureChecklist } = await import('../features/closure/service')
const { useStore } = await import('../store')
const { CloseTab } = await import('../screens/b-detail2')
const { detailFor } = await import('../screens/project-detail/service')

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

describe('closure checklist mirrors the store state (requirement 22)', () => {
  const h = mountStore()

  it('RT-2026-014 is not closable: live operations, live sessions and no delivered report', () => {
    const chk = closureChecklist(h.store().db, 'RT-2026-014')
    expect(chk.map((c) => [c.id, c.ok])).toEqual([
      ['c1', false], ['c1b', false], ['c2', true], ['c3', false], ['c4', true],
    ])
    expect(chk.find((c) => c.id === 'c1')!.detail).toBe('Still open: OP-014')
    expect(chk.find((c) => c.id === 'c1b')!.detail).toBe('Live: SS-041, SS-042')
  })

  it('RT-2026-016 only fails on the undelivered report', () => {
    const chk = closureChecklist(h.store().db, 'RT-2026-016')
    expect(chk.map((c) => [c.id, c.ok])).toEqual([
      ['c1', true], ['c1b', true], ['c2', true], ['c3', false], ['c4', true],
    ])
    expect(chk.find((c) => c.id === 'c3')!.detail).toBe('No report has been delivered')
  })

  it('the closed RT-2026-009 satisfies every condition', () => {
    const chk = closureChecklist(h.store().db, 'RT-2026-009')
    expect(chk.every((c) => c.ok)).toBe(true)
    expect(chk.find((c) => c.id === 'c3')!.detail).toBe('A report is Delivered')
  })
})

const Tab = ({ pid }: { pid: string }) => {
  const { db, me } = useStore()
  const d = detailFor(db, { id: me.name, role: me.role }, pid)!
  return <CloseTab p={d.project} d={d} setTab={() => {}} />
}

describe('requesting closure is manager-gated and blocked while the checklist fails (requirement 22)', () => {
  it('a manager sees the failing condition and cannot submit the request yet', () => {
    const view = mountScreen(<Tab pid="RT-2026-016" />)
    const close = screen.getByRole('button', { name: 'Close Project' })
    expect(close).toBeEnabled()
    fireEvent.click(close)
    expect(screen.getByText('Closure is blocked. Resolve these first:')).toBeInTheDocument()
    expect(screen.getAllByText('Final report approved and delivered').length).toBeGreaterThan(0)
    const submit = screen.getByRole('button', { name: 'Submit closure request' })
    expect(submit).toBeDisabled()
    expect(submit).toHaveAttribute('title', 'Resolve the blockers first')
    fireEvent.change(screen.getByPlaceholderText('e.g. All objectives assessed; final report delivered.'), { target: { value: 'All objectives assessed; perimeter findings covered by this closure.' } })
    expect(submit).toBeDisabled()
    expect(submit).toHaveAttribute('title', 'Resolve the blockers first')
    view.unmount()
  })

  it('an operator cannot request closure', () => {
    const view = mountScreen(<Tab pid="RT-2026-016" />, 'Taylor Chen')
    const close = screen.getByRole('button', { name: 'Close Project' })
    expect(close).toBeDisabled()
    expect(close).toHaveAttribute('title', 'Only a Red Team Manager can request project closure')
    expect(screen.getByText('Only a Red Team Manager can request project closure.')).toBeInTheDocument()
    view.unmount()
  })

  it('the request accepts a failing checklist (UI-only request) while the confirmation stays gated by the re-derived checklist (ticket 22)', () => {
    const view = mountScreen(<Tab pid="RT-2026-016" />)
    act(() => {
      view.store().A.requestClose('RT-2026-016', { reason: 'Requesting review of closure readiness.' })
    })
    const h = view.store()
    expect(h.db.projects.find((p) => p.id === 'RT-2026-016')!.status).toBe('review')
    expect(h.db.approvals.some((a) => a.projectId === 'RT-2026-016' && a.status === 'pending' && a.note === 'Requesting project closure — 1 checklist condition still open.')).toBe(true)

    act(() => {
      view.store().setMe('Pat Kim')
    })
    expect(screen.getByRole('button', { name: 'Approve Closure' })).toBeEnabled()
    expect(screen.getByText(/Requested by Alex Morgan on/)).toBeInTheDocument()
    const refused = view.store().A.confirmClose(h.db.approvals.find((a) => a.projectId === 'RT-2026-016')!.id)
    expect(refused.ok).toBe(false)
    expect(refused.error).toContain('Final report approved and delivered')
    expect(view.store().db.projects.find((p) => p.id === 'RT-2026-016')!.status).toBe('review')
    view.unmount()
  })
})
