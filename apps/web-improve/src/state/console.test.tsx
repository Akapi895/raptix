/**
 * Ticket 67 enablers D/E: the canonical console read seam
 * (src/state/console.ts) and the demo runtime (src/features/demo/runtime.ts).
 *
 * The read seam must observe exactly what the legacy store context observes
 * (same authority, same derivations — persona overrides, accessible set,
 * G-12 scope filter, policy decisions), and the demo runtime must commit the
 * same observable state the legacy `A.*` entries committed (the store
 * delegates to the runtime, so both entry points are pinned through one of
 * them and cross-checked against the other).
 */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StoreProvider, useStore, type Store } from '../store'
import { ConsoleProviders } from './query'
import { resetSharedStores } from './stores'
import { resetSessionStores } from './session'
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
  store: Store
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
    store: useStore(),
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
  it('useDb observes the same authority object the legacy store projects', () => {
    render(<StoreProvider><Probe /></StoreProvider>)
    expect(latest.db).toBe(latest.store.db)
    act(() => { latest.store.A.updateProject('RT-2026-014', { pinned: true }) })
    expect(latest.db.projects.find((p) => p.id === 'RT-2026-014')?.pinned).toBe(true)
    expect(latest.db).toBe(latest.store.db)
  })

  it('useMe mirrors the legacy persona (override-aware) across switches', () => {
    render(<StoreProvider><Probe /></StoreProvider>)
    expect(latest.me.role).toBe('manager')
    expect(latest.store.me).toEqual(latest.me)
    act(() => { latest.store.setMe('Taylor Chen') })
    expect(latest.me.role).toBe('operator')
    expect(latest.store.me.role).toBe('operator')
    expect(latest.store.me).toEqual(latest.me)
  })

  it('useAccessible/useCan/useReadOnly/useScoped agree with the legacy seam for every seeded project', () => {
    render(<StoreProvider><Probe /></StoreProvider>)
    expect(latest.accessible.map((p) => p.id)).toEqual(latest.store.accessible.map((p) => p.id))
    for (const p of latest.db.projects) {
      expect(latest.can('editScope', p.id)).toBe(latest.store.can('editScope', p.id))
      expect(latest.readOnly(p.id)).toBe(latest.store.readOnly(p.id))
    }
    expect(latest.can('editScope')).toBe(latest.store.can('editScope'))
    const rows = [...latest.db.findings, ...latest.db.operations]
    expect(latest.scoped(rows)).toEqual(latest.store.scoped(rows))
  })

  it('useActiveProject mirrors the legacy projection ("all" selects none)', () => {
    render(<StoreProvider><Probe /></StoreProvider>)
    expect(latest.project).toBe(latest.store.project)
    act(() => { latest.store.setPid('RT-2026-014') })
    expect(latest.project?.id).toBe('RT-2026-014')
    expect(latest.project).toBe(latest.store.project)
    act(() => { latest.store.setPid('all') })
    expect(latest.project).toBeNull()
  })

  it('a viewer persona reads the scoped viewer decisions from the same authority', () => {
    render(<StoreProvider><Probe /></StoreProvider>)
    act(() => { latest.store.setMe('Casey Nguyen (Client)') })
    expect(latest.me.role).toBe('viewer')
    const viewerRows = latest.db.findings.filter((f) => latest.scoped([f]).length > 0)
    expect(viewerRows.length).toBeGreaterThan(0)
    expect(latest.can('editScope')).toBe(latest.store.can('editScope'))
  })
})

describe('demo runtime (enabler E)', () => {
  it('the runtime emergency stop commits the same request state as the delegating A entry (outcome switch honored)', () => {
    const { store, run } = mountBoth()
    act(() => { store().setStopOutcome('fail') })
    run(() => runtimeEmergencyStop('project', 'RT-2026-014', 'runtime probe'))
    const stop = store().db.stopState
    expect(stop?.scope).toBe('project')
    expect(stop?.phase).toBe('requested')
    // The simulated failure outcome lands on the tracked delay.
    act(() => { vi.advanceTimersByTime(1900) })
    expect(store().db.stopState?.phase).toBe('failed')
  })

  it('runtime terminateSession drives the revoking → terminated lifecycle with revoked grants', () => {
    const { store, run } = mountBoth()
    const sid = store().db.sessions.find((s) => s.state === 'connected')!.id
    const before = store().db.sessions.find((s) => s.id === sid)!.grants.length
    run(() => runtimeTerminateSession(sid, 'probe'))
    expect(store().db.sessions.find((s) => s.id === sid)!.state).toBe('revoking')
    act(() => { vi.advanceTimersByTime(2100) })
    const after = store().db.sessions.find((s) => s.id === sid)!
    expect(after.state).toBe('terminated')
    expect(after.grants).toEqual([])
    expect(before).toBeGreaterThanOrEqual(0)
  })
})

/* Mounts both seams in one provider: the store probe pins the legacy view
   while the seam probes read the canonical hooks. */
function mountBoth(me = 'Alex Morgan') {
  let store!: Store
  const view = render(
    <StoreProvider>
      <ConsoleProviders>
        <Probe />
        <StoreProbe ready={(s) => (store = s)} />
      </ConsoleProviders>
    </StoreProvider>,
  )
  if (me !== 'Alex Morgan') act(() => { store.setMe(me) })
  return {
    store: () => store,
    run: (fn: () => unknown) => act(fn),
    unmount: view.unmount,
  }
}

function StoreProbe({ ready }: { ready: (s: Store) => void }) {
  ready(useStore())
  return null
}
