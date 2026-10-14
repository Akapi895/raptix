/**
 * Ticket 05: Query keys carry the actor/authorization/project scope, the
 * change bridge invalidates matching consumers when the authority publishes
 * a ChangeSet, persona/project switches cancel obsolete reads so a delayed
 * old response never restores cross-project visibility, demo reset clears
 * the cache, and bridge teardown works across repeated provider mounts.
 */
import { type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, screen, waitFor } from '@testing-library/react'
import { hashKey, useQuery } from '@tanstack/react-query'
import { useServices } from './services'
import { mountServices } from '../test/helpers'
import { selectProject } from '../router/navigate'
import { resetDemo } from '../features/demo/runtime'
import { useToastStore } from './stores'
import type { ChangeSet } from '../domain/service'
import { consoleKeys, useQueryScope, type QueryScope } from './keys'

afterEach(() => { cleanup(); vi.useRealTimers() })

let corrSeq = 0
const nextCorr = () => `corr-${++corrSeq}`

function defer() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => { resolve = r })
  return { promise, resolve }
}

function mountConsole(ui?: ReactNode) {
  const h = mountServices(ui)
  return { ...h, client: h.qc }
}

describe('query keys', () => {
  it('embed actor, authorization role and project so scopes never collide', () => {
    const alex: QueryScope = { actor: 'Alex Morgan', role: 'manager', project: 'RT-2026-014' }
    const jordan: QueryScope = { actor: 'Jordan Lee', role: 'manager', project: 'RT-2026-014' }
    const other: QueryScope = { actor: 'Alex Morgan', role: 'manager', project: 'RT-2026-015' }
    const keys = [
      hashKey(consoleKeys.list('project', alex)),
      hashKey(consoleKeys.list('project', jordan)),
      hashKey(consoleKeys.list('project', other)),
      hashKey(consoleKeys.entity('finding', alex, 'FD-001')),
      hashKey(consoleKeys.entity('finding', alex, 'FD-002')),
    ]
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('change bridge', () => {
  it('a committed ChangeSet refetches matching Query consumers with fresh authority data', async () => {
    let fetches = 0
    function ProjectList() {
      const scope = useQueryScope()
      const svc = useServices()
      const q = useQuery({
        queryKey: consoleKeys.list('project', scope),
        queryFn: () => {
          fetches++
          return Promise.resolve(svc.authority.snapshot().projects.map((p) => `${p.id}:${p.pinned}`))
        },
      })
      return <ul>{q.data?.map((x) => <li key={x}>{x}</li>)}</ul>
    }
    const h = mountConsole(<ProjectList />)
    await waitFor(() => expect(fetches).toBe(1))
    await waitFor(() => expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('RT-2026-014:true'))
    h.run(() => { h.svc().authority.commit(nextCorr(), (d) => { d.projects.find((p) => p.id === 'RT-2026-014')!.pinned = false }) })
    await waitFor(() => expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('RT-2026-014:false'))
    expect(fetches).toBe(2)
    h.unmount()
  })

  it('a project-scoped commit also invalidates aggregate views of that project', async () => {
    let fetches = 0
    function AggregateSummary() {
      const scope = useQueryScope()
      const svc = useServices()
      const q = useQuery({
        queryKey: consoleKeys.view('summary', scope),
        queryFn: () => {
          fetches++
          return Promise.resolve(svc.authority.snapshot().findings.length)
        },
      })
      return <p data-testid="summary">{q.data}</p>
    }
    const h = mountConsole(<AggregateSummary />)
    await waitFor(() => expect(fetches).toBe(1))
    h.run(() => { h.svc().authority.commit(nextCorr(), (d) => { d.findings[0].title = 'Changed by the bridge test' }) })
    await waitFor(() => expect(fetches).toBe(2))
    h.unmount()
  })
})

describe('scope cancellation', () => {
  it('switching projects cancels the stale read; the late response never surfaces in the new view', async () => {
    const gate = defer()
    const signals: AbortSignal[] = []
    function ScopedList() {
      const scope = useQueryScope()
      const q = useQuery({
        queryKey: consoleKeys.list('project', scope),
        queryFn: async ({ signal }) => {
          signals.push(signal)
          if (scope.project === 'RT-2026-014') await gate.promise
          return `visible:${scope.project}`
        },
      })
      return <p data-testid="scoped-view">{q.data ?? 'loading'}</p>
    }
    const h = mountConsole(<ScopedList />)
    await waitFor(() => expect(screen.getByTestId('scoped-view')).toHaveTextContent('visible:all'))
    const cancelSpy = vi.spyOn(h.svc(), 'cancelScope')

    h.run(() => { selectProject('RT-2026-014') })
    await waitFor(() => expect(signals.length).toBe(2))
    h.run(() => { selectProject('RT-2026-015') })
    await waitFor(() => expect(screen.getByTestId('scoped-view')).toHaveTextContent('visible:RT-2026-015'))

    expect(signals[1].aborted).toBe(true)
    expect(signals[2].aborted).toBe(false)
    expect(cancelSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'Alex Morgan' }), 'RT-2026-014')

    /* The delayed project-A response resolves after the switch — flush it and
       assert the B view is untouched and no A cache entry holds its data. */
    await act(async () => {
      gate.resolve()
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(screen.getByTestId('scoped-view')).toHaveTextContent('visible:RT-2026-015')
    expect(h.client().getQueryData(consoleKeys.list('project', { actor: 'Alex Morgan', role: 'manager', project: 'RT-2026-014' }))).toBeUndefined()
    h.unmount()
  })

  it('switching persona cancels that actor’s stale reads', async () => {
    const gate = defer()
    const signals: AbortSignal[] = []
    function ActorView() {
      const scope = useQueryScope()
      const q = useQuery({
        queryKey: consoleKeys.list('project', scope),
        queryFn: async ({ signal }) => {
          signals.push(signal)
          if (scope.actor === 'Alex Morgan') await gate.promise
          return `visible:${scope.actor}`
        },
      })
      return <p data-testid="actor-view">{q.data ?? 'loading'}</p>
    }
    const h = mountConsole(<ActorView />)
    await waitFor(() => expect(signals.length).toBe(1))
    h.as('Jordan Lee')
    await waitFor(() => expect(screen.getByTestId('actor-view')).toHaveTextContent('visible:Jordan Lee'))
    expect(signals[0].aborted).toBe(true)
    await act(async () => {
      gate.resolve()
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(screen.getByTestId('actor-view')).toHaveTextContent('visible:Jordan Lee')
    h.unmount()
  })
})

describe('demo reset and teardown', () => {
  it('demo reset clears the cache and refetches from the reseeded authority', async () => {
    let fetches = 0
    function PinnedFlag() {
      const scope = useQueryScope()
      const svc = useServices()
      const q = useQuery({
        queryKey: consoleKeys.view('pinned', scope),
        queryFn: () => {
          fetches++
          return Promise.resolve(svc.authority.snapshot().projects.find((p) => p.id === 'RT-2026-014')!.pinned)
        },
      })
      return <p data-testid="pinned">{String(q.data)}</p>
    }
    const h = mountConsole(<PinnedFlag />)
    await waitFor(() => expect(fetches).toBe(1))
    h.run(() => { h.svc().authority.commit(nextCorr(), (d) => { d.projects.find((p) => p.id === 'RT-2026-014')!.pinned = false }) })
    await waitFor(() => expect(screen.getByTestId('pinned')).toHaveTextContent('false'))
    h.run(() => { resetDemo() })
    await waitFor(() => expect(screen.getByTestId('pinned')).toHaveTextContent('true'))
    expect(fetches).toBeGreaterThanOrEqual(3)
    expect(useToastStore.getState().toasts.some((t) => t.text.startsWith('Demo state reset'))).toBe(true)
    h.unmount()
  })

  it('bridges unsubscribe on unmount and a remount rewires exactly once per commit', async () => {
    const offs: (() => void)[] = []
    const spied = new WeakSet<object>()
    function SubscribeSpy() {
      const svc = useServices()
      if (!spied.has(svc)) {
        spied.add(svc)
        const orig = svc.subscribe.bind(svc)
        svc.subscribe = (fn: (cs: ChangeSet) => void) => {
          const off = orig(fn)
          offs.push(off)
          return () => {
            const i = offs.indexOf(off)
            if (i >= 0) offs.splice(i, 1)
            off()
          }
        }
      }
      return null
    }
    let probeFetches = 0
    function ProbeView() {
      const scope = useQueryScope()
      const svc = useServices()
      const q = useQuery({
        queryKey: consoleKeys.view('probe', scope),
        queryFn: () => {
          probeFetches++
          return Promise.resolve(svc.authority.snapshot().projects.length)
        },
      })
      return <p data-testid="probe">{String(q.data)}-{probeFetches}</p>
    }

    const first = mountConsole(<><SubscribeSpy /><ProbeView /></>)
    // One services.subscribe listener: the ChangeSet bridge (the scope bridge
    // subscribes to the zustand authorities directly and cleans up with React).
    await waitFor(() => expect(offs.length).toBe(1))
    first.unmount()
    expect(offs.length).toBe(0)

    const second = mountConsole(<><SubscribeSpy /><ProbeView /></>)
    await waitFor(() => expect(offs.length).toBe(1))
    await waitFor(() => expect(probeFetches).toBe(2))
    second.run(() => { second.svc().authority.commit(nextCorr(), (d) => { d.projects[0].pinned = !d.projects[0].pinned }) })
    await waitFor(() => expect(probeFetches).toBe(3))
    second.unmount()
    expect(offs.length).toBe(0)
  })
})
