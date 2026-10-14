/**
 * Ticket 67 enablers D/E: the canonical console read seam
 * (src/state/console.ts) and the demo runtime (src/features/demo/runtime.ts).
 *
 * Identity overrides, membership, project selection and permission decisions
 * observe the canonical authority; demo transitions publish actual outcomes.
 */
import { act, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountServices } from '../test/helpers'
import { resetSharedStores, useAuthStore } from './stores'
import { resetSessionStores, useSessionStore } from './session'
import { selectProject } from '../router/navigate'
import { useDb, useMe, useAccessible, useCan, useReadOnly, useScoped, useActiveProject } from './console'
import { emergencyStop as runtimeEmergencyStop, terminateSession as runtimeTerminateSession } from '../features/demo/runtime'

let latest: {
  db: ReturnType<typeof useDb>
  me: ReturnType<typeof useMe>
  accessible: ReturnType<typeof useAccessible>
  project: ReturnType<typeof useActiveProject>
  can: (a: Parameters<ReturnType<typeof useCan>>[0], pid?: string) => boolean
  readOnly: (pid?: string) => boolean
  scoped: <T extends { projectId: string }>(arr: T[]) => T[]
}
function Probe() {
  latest = {
    db: useDb(),
    me: useMe(),
    accessible: useAccessible(),
    project: useActiveProject(),
    can: useCan(),
    readOnly: useReadOnly(),
    scoped: useScoped(),
  }
  return null
}

beforeEach(() => {
  vi.useFakeTimers()
  resetSharedStores()
  resetSessionStores()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  window.location.hash = ''
})

describe('console read seam (enabler D)', () => {
  it('the mounted snapshot subscriber observes committed authority updates', () => {
    const h = mountServices(<Probe />)
    expect(latest.db).toBe(h.db())
    const before = latest.db
    h.run(() => { h.svc().authority.commit('snapshot-subscription', (d) => { d.projects.find((p) => p.id === 'RT-2026-014')!.pinned = false }) })
    expect(latest.db.projects.find((p) => p.id === 'RT-2026-014')?.pinned).toBe(false)
    expect(latest.db).toBe(h.db())
    expect(latest.db).not.toBe(before)
  })

  it('identity follows persona selection and committed role overrides', () => {
    const h = mountServices(<Probe />)
    expect(latest.me.role).toBe('manager')
    expect(latest.me.name).toBe('Alex Morgan')
    h.as('Taylor Chen')
    expect(latest.me.role).toBe('operator')
    expect(latest.me.name).toBe('Taylor Chen')
    h.run(() => { h.svc().authority.commit('role-override-fixture', (d) => { d.org.members['Taylor Chen'] = { ...d.org.members['Taylor Chen'], role: 'analyst' } }) })
    expect(latest.me.role).toBe('analyst')
    expect(useAuthStore.getState().meName).toBe('Taylor Chen')
  })

  it('manager membership, edit and read-only decisions cover every seeded project', () => {
    mountServices(<Probe />)
    expect(latest.accessible.map((p) => p.id)).toEqual(['RT-2026-014', 'RT-2026-015', 'RT-2026-017', 'RT-2026-016', 'PT-2026-006', 'RT-2026-009'])
    for (const p of latest.db.projects) {
      expect(latest.can('editScope', p.id), p.id).toBe(p.status !== 'closed' && p.status !== 'cancelled')
      expect(latest.readOnly(p.id), p.id).toBe(p.status === 'closed' || p.status === 'cancelled')
    }
    expect(latest.can('editScope')).toBe(true)
    const rows = [...latest.db.findings, ...latest.db.operations]
    expect(latest.scoped(rows)).toEqual(rows)
  })

  it('active-project selection resolves the committed project and all selects none', () => {
    const h = mountServices(<Probe />)
    expect(latest.project).toBeNull()
    act(() => { selectProject('RT-2026-014') })
    expect(latest.project?.id).toBe('RT-2026-014')
    expect(latest.project).toBe(h.db().projects.find((p) => p.id === 'RT-2026-014'))
    act(() => { selectProject('all') })
    expect(latest.project).toBeNull()
  })

  it('a viewer persona reads the scoped viewer decisions from the same authority', () => {
    const h = mountServices(<Probe />)
    h.as('Casey Nguyen (Client)')
    expect(latest.me.role).toBe('viewer')
    const viewerRows = latest.db.findings.filter((f) => latest.scoped([f]).length > 0)
    expect(viewerRows.length).toBeGreaterThan(0)
    expect(latest.can('editScope')).toBe(false)
    expect(latest.readOnly('RT-2026-014')).toBe(true)
    expect(viewerRows.map((r) => r.id)).toEqual(['FD-011', 'FD-012'])
  })
})

describe('demo runtime (enabler E)', () => {
  it('runtime emergency stop publishes a request then the selected failure outcome', () => {
    const { db, run } = mountServices(<Probe />)
    act(() => { useSessionStore.getState().setStopOutcome('fail') })
    run(() => runtimeEmergencyStop('project', 'RT-2026-014', 'runtime probe'))
    const stop = db().stopState
    expect(stop?.scope).toBe('project')
    expect(stop?.phase).toBe('requested')
    // The simulated failure outcome lands on the tracked delay.
    act(() => { vi.advanceTimersByTime(1900) })
    expect(db().stopState?.phase).toBe('failed')
  })

  it('runtime terminateSession drives the revoking → terminated lifecycle with revoked grants', () => {
    const { db, run } = mountServices(<Probe />)
    const sid = db().sessions.find((s) => s.state === 'connected')!.id
    const before = db().sessions.find((s) => s.id === sid)!.grants.length
    run(() => runtimeTerminateSession(sid, 'probe'))
    expect(db().sessions.find((s) => s.id === sid)!.state).toBe('revoking')
    act(() => { vi.advanceTimersByTime(2100) })
    const after = db().sessions.find((s) => s.id === sid)!
    expect(after.state).toBe('terminated')
    expect(after.grants).toEqual([])
    expect(before).toBeGreaterThanOrEqual(0)
  })
})
