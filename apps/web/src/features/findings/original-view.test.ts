import { describe, expect, it } from 'vitest'
import { formatDemoInstant, MockClock } from '../../domain/clock'
import { createDatabaseAuthority } from '../../domain/database'
import { recordOriginalView } from './service'

describe('mock original-evidence view', () => {
  it('records the view in the review log, stamped by the injected clock', () => {
    const clock = new MockClock()
    const authority = createDatabaseAuthority(clock)
    clock.advance(5 * 60 * 1000)
    const result = recordOriginalView(authority, clock, { actor: { id: 'Taylor Chen', role: 'operator' }, projectId: 'RT-2026-014', corr: 'evidence-view' }, { ref: 'EV-014-02', projectId: 'RT-2026-014' })

    expect(result).toEqual({ ok: true, data: undefined })
    expect(authority.snapshot().audit[0]).toMatchObject({ action: 'Viewed original evidence', obj: 'EV-014-02', projectId: 'RT-2026-014', actor: 'Taylor Chen', role: 'Operator', result: 'Success', reason: '', at: formatDemoInstant(clock.now()) })
  })

  it('does not record original access outside the active project or for a role that cannot read it', () => {
    const clock = new MockClock()
    const authority = createDatabaseAuthority(clock)
    const count = authority.snapshot().audit.length
    const evidence = { ref: 'EV-014-02', projectId: 'RT-2026-014' }
    const foreign = recordOriginalView(authority, clock, { actor: { id: 'Alex Morgan', role: 'manager' }, projectId: 'RT-2026-015', corr: 'foreign-view' }, evidence)
    const viewer = recordOriginalView(authority, clock, { actor: { id: 'Taylor Chen', role: 'viewer' }, projectId: 'RT-2026-014', corr: 'viewer' }, evidence)
    expect(foreign).toMatchObject({ ok: false, failure: { kind: 'forbidden' } })
    expect(viewer).toMatchObject({ ok: false, failure: { kind: 'forbidden' } })
    expect(authority.snapshot().audit.length).toBe(count)
  })
})
