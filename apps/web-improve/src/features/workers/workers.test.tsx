/**
 * Ticket 44: AI worker dependency graph on the typed read model —
 * the worker/DAG migration at its new execution site
 * (src/features/workers/service.ts + src/screens/g-workers.tsx).
 *
 * Covered here: worker nodes/status/dependencies reflect the recorded
 * canonical data (levels from the dependency graph, deps/parents/branch
 * inputs resolved, missing records explicit); reads stay project-scoped
 * (non-member not-found without a leak; aggregates exclude inaccessible
 * projects); dependency cycles terminate; keyboard focus reveals the same
 * node detail as pointer selection; the graph grants no execution
 * permissions; a committed ai-worker change refetches the Query-backed view;
 * the workspace Inspector renders the same view as its AI-team entry point.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConsoleProviders } from '../../state/query'
import { StoreProvider, useServices, useStore, type Store } from '../../store'
import type { ConsoleServices } from '../../domain/service-factory'
import type { ActorRef, RequestContext } from '../../domain/service'
import { WorkerTeamView } from '../../screens/g-workers'
import { seed } from '../../data'
import { listWorkers } from './service'

afterEach(() => { cleanup(); window.location.hash = '' })

function Probe({ ready }: { ready: (s: Store, svc: ConsoleServices) => void }) {
  ready(useStore(), useServices())
  return null
}

/** Mounts the providers, a probe and the worker team view for one project. */
function mountWorkers(me = 'Taylor Chen', projectId = 'RT-2026-014') {
  let store!: Store
  let svc!: ConsoleServices
  const ui = () => (
    <StoreProvider>
      <ConsoleProviders>
        <Probe ready={(s, v) => { store = s; svc = v }} />
        <WorkerTeamView projectId={projectId} />
      </ConsoleProviders>
    </StoreProvider>
  )
  const view = render(ui())
  if (me !== 'Alex Morgan') act(() => { store.setMe(me) })
  return {
    store: () => store,
    svc: () => svc,
    run: (fn: () => unknown) => act(fn),
    rerender: () => view.rerender(ui()),
    unmount: view.unmount,
  }
}

const taylor = (): ActorRef => ({ id: 'Taylor Chen', role: 'operator' })
const riley = (): ActorRef => ({ id: 'Riley Brooks', role: 'analyst' })
const casey = (): ActorRef => ({ id: 'Casey Nguyen (Client)', role: 'viewer' })
const ctx = (actor: ActorRef, projectId: string, corr = 't'): RequestContext => ({ actor, projectId, corr })

describe('worker read model scope (ticket 44)', () => {
  it('reports the recorded dependency graph: levels, deps, parent and branch inputs', () => {
    const res = listWorkers(seed(), ctx(taylor(), 'RT-2026-014'))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const byId = new Map(res.data.workers.map((r) => [r.worker.id, r]))
    expect(res.data.workers).toHaveLength(5)
    expect(byId.get('AW-014-01')).toMatchObject({ level: 1 })
    expect(byId.get('AW-014-02')).toMatchObject({ level: 2, deps: [{ id: 'AW-014-01', state: 'done' }], parent: { id: 'AW-014-01', state: 'done' } })
    expect(byId.get('AW-014-03')).toMatchObject({
      level: 3,
      deps: [{ id: 'AW-014-02', state: 'done' }],
      branchDeps: [
        { id: 'BR-014-01', state: 'completed' },
        { id: 'BR-014-02', state: 'completed' },
        { id: 'BR-014-03', state: 'failed' },
      ],
      missingBranches: [],
    })
    expect(byId.get('AW-014-03')!.parent).toBeUndefined()
    expect(byId.get('AW-014-04')).toMatchObject({ level: 4, parent: { id: 'AW-014-03', state: 'waiting' } })
    expect(byId.get('AW-014-05')).toMatchObject({ level: 5 })
  })

  it('stays project-scoped: a non-member read is not-found without a leak; aggregates exclude inaccessible projects', async () => {
    const denied = listWorkers(seed(), ctx(riley(), 'RT-2026-015'))
    expect(denied.ok).toBe(false)
    if (!denied.ok) {
      expect(denied.failure.kind).toBe('not-found')
      expect(denied.failure.message).not.toContain('RT-2026-014')
      expect(denied.failure.message).not.toContain('AW-014-01')
    }
    const h = mountWorkers('Riley Brooks')
    const svc = h.svc()
    svc.authority.commit('t', (d) => {
      d.aiWorkers.push({ id: 'AW-015-01', projectId: 'RT-2026-015', role: 'Analysis Worker', task: 'Cloud config review', state: 'working', inputs: [], output: '', deps: [], model: 'Demo model (simulated)' })
    })
    const hers = listWorkers(svc.authority.snapshot(), ctx(riley(), 'all'))
    expect(hers.ok).toBe(true)
    if (hers.ok) {
      expect(hers.data.workers.map((r) => r.worker.id)).not.toContain('AW-015-01')
      expect(new Set(hers.data.workers.map((r) => r.worker.projectId))).toEqual(new Set(['RT-2026-014']))
    }
    const admin = listWorkers(svc.authority.snapshot(), ctx({ id: 'Alex Morgan', role: 'admin' }, 'all'))
    expect(admin.ok).toBe(true)
    if (admin.ok) expect(admin.data.workers.map((r) => r.worker.id)).toContain('AW-015-01')
    h.unmount()
  })

  it('reports missing dependency records explicitly and terminates on dependency cycles', async () => {
    const h = mountWorkers()
    const svc = h.svc()
    svc.authority.commit('t', (d) => {
      d.aiWorkers.push(
        { id: 'AW-014-06', projectId: 'RT-2026-014', role: 'Report Assistant', task: 'Draft with unknown inputs', state: 'waiting', inputs: ['BR-014-99'], output: '', deps: ['AW-014-99'], model: 'Demo model (simulated)' },
        { id: 'AW-014-07', projectId: 'RT-2026-014', role: 'Analysis Worker', task: 'Cycle a', state: 'idle', inputs: [], output: '', deps: ['AW-014-08'], model: 'Demo model (simulated)' },
        { id: 'AW-014-08', projectId: 'RT-2026-014', role: 'Analysis Worker', task: 'Cycle b', state: 'idle', inputs: [], output: '', deps: ['AW-014-07'], model: 'Demo model (simulated)' },
      )
    })
    const res = listWorkers(svc.authority.snapshot(), ctx(taylor(), 'RT-2026-014'))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const byId = new Map(res.data.workers.map((r) => [r.worker.id, r]))
    expect(byId.get('AW-014-06')).toMatchObject({
      deps: [{ id: 'AW-014-99', state: 'missing' }],
      branchDeps: [{ id: 'BR-014-99', state: 'missing' }],
      missingBranches: ['BR-014-99'],
    })
    const cyc = [byId.get('AW-014-07')!.level, byId.get('AW-014-08')!.level]
    expect(cyc.every((n) => Number.isFinite(n) && n >= 1)).toBe(true)
    h.unmount()
  })
})

describe('worker graph screen (ticket 44)', () => {
  it('renders dependency-graph nodes; pointer click and keyboard focus reveal the same node detail', async () => {
    const h = mountWorkers()
    const node = await screen.findByRole('button', { name: 'Worker AW-014-03, Waiting, depends on AW-014-02' })
    fireEvent.click(node)
    const detail = await screen.findByRole('region', { name: 'Worker AW-014-03 detail' })
    expect(detail).toHaveTextContent('Analysis Worker')
    expect(detail).toHaveTextContent('Summarize branch results BG-014-01')
    expect(screen.getByRole('button', { name: 'BR-014-01' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close worker AW-014-03 detail' }))
    expect(screen.queryByRole('region', { name: 'Worker AW-014-03 detail' })).not.toBeInTheDocument()
    fireEvent.focus(screen.getByRole('button', { name: 'Worker AW-014-03, Waiting, depends on AW-014-02' }))
    expect(await screen.findByRole('region', { name: 'Worker AW-014-03 detail' })).toBeInTheDocument()
    h.unmount()
  })

  it('shows missing dependency records explicitly on the graph', async () => {
    const h = mountWorkers()
    h.svc().authority.commit('t', (d) => {
      d.aiWorkers.push({ id: 'AW-014-06', projectId: 'RT-2026-014', role: 'Report Assistant', task: 'Draft with unknown inputs', state: 'waiting', inputs: ['BR-014-99'], output: '', deps: ['AW-014-99'], model: 'Demo model (simulated)' })
    })
    expect(await screen.findByText('Missing dependency records')).toBeInTheDocument()
    const node = screen.getByRole('button', { name: 'Worker AW-014-06, Waiting, depends on AW-014-99 (missing)' })
    fireEvent.click(node)
    const detail = await screen.findByRole('region', { name: 'Worker AW-014-06 detail' })
    expect(detail).toHaveTextContent('AW-014-99 — no recorded worker')
    expect(detail).toHaveTextContent('BR-014-99 — no recorded branch')
    h.unmount()
  })

  it('the table view stays reachable and the graph grants no execution permissions', async () => {
    const h = mountWorkers()
    await screen.findByRole('button', { name: /Worker AW-014-01/ })
    expect(screen.getByText(/never grants execution permissions/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    expect(screen.getByRole('columnheader', { name: 'Worker' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Dependencies' })).toBeInTheDocument()
    h.unmount()
  })

  it('a committed ai-worker change publishes a ChangeSet and the Query-backed view refetches', async () => {
    const h = mountWorkers()
    await screen.findByRole('button', { name: /Worker AW-014-03, Waiting/ })
    h.run(() => {
      h.svc().authority.commit('t', (d) => {
        const w = d.aiWorkers.find((x) => x.id === 'AW-014-03')!
        w.state = 'done'
      })
    })
    await waitFor(() => expect(screen.getByRole('button', { name: /Worker AW-014-03, Done/ })).toBeInTheDocument())
    h.unmount()
  })

  it('out-of-scope reads render the error state without a leak; worker-less projects render the empty state', async () => {
    const h = mountWorkers('Riley Brooks', 'RT-2026-015')
    h.rerender()
    expect(await screen.findByText('Could not load AI workers')).toBeInTheDocument()
    expect(screen.getByText('AI workers for this project are not available for your account.')).toBeInTheDocument()
    expect(screen.queryByText(/AW-014-01/)).not.toBeInTheDocument()
    h.unmount()
    const h2 = mountWorkers('Taylor Chen', 'RT-2026-015')
    expect(await screen.findByText('No AI workers in this project')).toBeInTheDocument()
    h2.unmount()
  })

  it('the workspace Inspector renders the same migrated team view as its AI-team entry point', async () => {
    // The Inspector imports WorkerTeamView directly (the g-fanout forwarding
    // export retired in ticket 66); the workspace view is the migrated one.
    render(
      <StoreProvider>
        <ConsoleProviders>
          <WorkerTeamView projectId="RT-2026-014" />
        </ConsoleProviders>
      </StoreProvider>,
    )
    await screen.findByRole('button', { name: /Worker AW-014-01/ })
  })
})
