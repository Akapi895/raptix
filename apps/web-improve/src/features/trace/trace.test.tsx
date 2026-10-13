/**
 * Ticket 41: tool/analysis trace on the typed read model — the facet
 * invariant (execution.md requirement 4) at its new execution site
 * (src/features/trace/service.ts + src/screens/g-trace.tsx).
 *
 * Covered here: the one stored tool-event state derives the three
 * independent Policy/Approval/Execution facets at the service boundary
 * (policy Allowed is never execution, and no facet field is persisted);
 * reads stay project-scoped (non-member not-found without a leak;
 * aggregates exclude inaccessible projects); sensitive params/results are
 * masked at the boundary without rewriting the stored record; provenance a
 * trace link needs (plan version, plan-step name, branch state) is resolved
 * on the same snapshot; the rendered trace keeps keyboard access, facet
 * filters, evidence links and the Allowed-vs-Executed distinction visible;
 * a legacy tool decision publishes through the change bridge and the
 * Query-backed view refetches; a delayed superseded read never restores old
 * visibility; and the migrated route keeps no raw location writes or legacy
 * database reads (grep-verified on the source).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ConsoleProviders } from '../../state/query'
import { StoreProvider, useServices, useStore, type Store } from '../../store'
import type { ConsoleServices } from '../../domain/service-factory'
import type { ActorRef, RequestContext } from '../../domain/service'
import type { ToolState } from '../../data'
import { seed, toolFacets } from '../../data'
import { AiTrace } from '../../screens/g-trace'
import { listToolEvents, maskSensitive } from './service'

afterEach(() => { cleanup(); window.location.hash = '' })

function Probe({ ready }: { ready: (s: Store, svc: ConsoleServices) => void }) {
  ready(useStore(), useServices())
  return null
}

/** Mounts the providers, a probe and the migrated trace screen. */
function mountTrace(me = 'Taylor Chen', projectId = 'RT-2026-014') {
  window.location.hash = '#/ai-trace'
  let store!: Store
  let svc!: ConsoleServices
  const ui = () => (
    <StoreProvider>
      <ConsoleProviders>
        <Probe ready={(s, v) => { store = s; svc = v }} />
        <AiTrace />
      </ConsoleProviders>
    </StoreProvider>
  )
  const view = render(ui())
  if (me !== 'Alex Morgan') act(() => { store.setMe(me) })
  act(() => { store.setPid(projectId) })
  return { store: () => store, svc: () => svc, run: (fn: () => unknown) => act(fn), unmount: view.unmount }
}

const taylor = (): ActorRef => ({ id: 'Taylor Chen', role: 'operator' })
const riley = (): ActorRef => ({ id: 'Riley Brooks', role: 'analyst' })
const ctx = (actor: ActorRef, projectId: string, corr = 't'): RequestContext => ({ actor, projectId, corr })

function defer() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => { resolve = r })
  return { promise, resolve }
}

describe('trace read model scope and facets (ticket 41)', () => {
  it('derives the three independent facets from the one stored state — policy Allowed is not executed', () => {
    const db = seed()
    const states: ToolState[] = ['proposed', 'awaiting', 'allowed', 'denied', 'running', 'completed', 'failed', 'stopped']
    states.forEach((state, i) => {
      db.toolEvents.push({ id: `TL-X${i}`, conversationId: 'CV-014-03', projectId: 'RT-2026-014', tool: 'service-mapper', target: 'api-01', params: 'scope=services', state, at: db.toolEvents[0]!.at })
    })
    const res = listToolEvents(db, ctx(taylor(), 'RT-2026-014'))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    for (const [i, state] of states.entries()) {
      const row = res.data.events.find((r) => r.event.id === `TL-X${i}`)!
      // Derived on every read from the single stored state — never persisted alongside it.
      expect(row.facets).toEqual(toolFacets(row.event))
      expect(row.event).not.toHaveProperty('policy')
      expect(row.event).not.toHaveProperty('approval')
      expect(row.event).not.toHaveProperty('exec')
      void state
    }
    const allowed = res.data.events.find((r) => r.event.id === 'TL-X2')!
    expect(allowed.facets.policy).toBe('Allowed')
    expect(allowed.facets.exec).toBe('Not executed')
    expect(res.data.events.find((r) => r.event.id === 'TL-X1')!.facets).toEqual({ policy: 'Allowed', approval: 'Pending', exec: 'Not executed' })
    expect(res.data.events.find((r) => r.event.id === 'TL-X3')!.facets).toEqual({ policy: 'Blocked', approval: 'Denied', exec: 'Not executed' })
    expect(res.data.events.find((r) => r.event.id === 'TL-X0')!.facets).toEqual({ policy: 'Not evaluated', approval: 'Not required', exec: 'Not executed' })
  })

  it('stays project-scoped: a non-member read is not-found without a leak; aggregates exclude inaccessible projects', () => {
    const denied = listToolEvents(seed(), ctx(riley(), 'RT-2026-015'))
    expect(denied.ok).toBe(false)
    if (!denied.ok) {
      expect(denied.failure.kind).toBe('not-found')
      expect(denied.failure.message).not.toContain('RT-2026-014')
      expect(denied.failure.message).not.toContain('TL-01')
    }
    const db = seed()
    const agg = listToolEvents(db, ctx(riley(), 'all'))
    expect(agg.ok).toBe(true)
    if (agg.ok) {
      expect(agg.data.events.map((r) => r.event.id)).not.toContain('TL-05')
      expect(new Set(agg.data.events.map((r) => r.event.projectId))).toEqual(new Set(['RT-2026-014']))
    }
    const admin = listToolEvents(db, ctx({ id: 'Dana Whitfield', role: 'admin' }, 'all'))
    expect(admin.ok).toBe(true)
    if (admin.ok) expect(admin.data.events.map((r) => r.event.id)).toContain('TL-05')
  })

  it('masks sensitive params and results at the service boundary without rewriting the stored record', () => {
    const db = seed()
    db.toolEvents.push({ id: 'TL-90', conversationId: 'CV-014-03', projectId: 'RT-2026-014', tool: 'credential-validator (lab)', target: 'win-dc-01', params: 'user=svc-scan password=hunter2 host=192.0.2.99', state: 'completed', at: db.toolEvents[0]!.at, result: 'token=abc123 captured from 10.0.0.7' })
    const res = listToolEvents(db, ctx(taylor(), 'RT-2026-014'))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const row = res.data.events.find((r) => r.event.id === 'TL-90')!
    expect(row.params).not.toContain('hunter2')
    expect(row.params).toContain('password=[redacted]')
    expect(row.params).toContain('host=[ip redacted]')
    expect(row.result).not.toContain('abc123')
    expect(row.result).toContain('token=[redacted]')
    expect(row.result).toContain('[ip redacted]')
    // Masking is boundary-only: the stored event keeps its recorded values.
    expect(db.toolEvents.find((e) => e.id === 'TL-90')!.params).toContain('hunter2')
    expect(maskSensitive('plain scope=services')).toBe('plain scope=services')
  })

  it('resolves plan version, step name and branch state for trace links from the same snapshot', () => {
    const res = listToolEvents(seed(), ctx(taylor(), 'RT-2026-014'))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const byId = new Map(res.data.events.map((r) => [r.event.id, r]))
    expect(byId.get('TL-01')!.plan).toEqual({ id: 'PL-021', version: 'v1.2', stepName: 'Enumerate permission groups' })
    expect(byId.get('TL-06')!.branch).toEqual({ id: 'BR-014-03', state: 'failed' })
    expect(byId.get('TL-04')!.plan).toBeUndefined()
    expect(byId.get('TL-04')!.branch).toBeUndefined()
  })
})

describe('trace screen on the typed read (ticket 41)', () => {
  it('renders durations, evidence links and independent facet labels; Policy Allowed stays visibly distinct from Executed', async () => {
    const h = mountTrace()
    await waitFor(() => expect(screen.getByText('TL-01')).toBeInTheDocument())
    const done = screen.getByText('TL-01').closest('tr')!
    expect(within(done).getByText('41 s')).toBeInTheDocument()
    expect(within(done).getByText('Allowed')).toBeInTheDocument()
    expect(within(done).getByText('Executed')).toBeInTheDocument()
    const pending = screen.getByText('TL-03').closest('tr')!
    expect(within(pending).getByText('Allowed')).toBeInTheDocument()
    expect(within(pending).getByText('Not executed')).toBeInTheDocument()
    expect(within(pending).getByText('Pending')).toBeInTheDocument()
    h.unmount()
  })

  it('opens the same inspector from keyboard activation; the inspector preserves plan version and project-scoped evidence provenance', async () => {
    const h = mountTrace()
    await waitFor(() => expect(screen.getByText('TL-01')).toBeInTheDocument())
    fireEvent.keyDown(screen.getByText('TL-01'), { key: 'Enter' })
    const drawer = await screen.findByRole('dialog', { name: 'Tool Event Inspector — TL-01' })
    expect(within(drawer).getByText('Enumerate permission groups')).toBeInTheDocument()
    expect(within(drawer).getByText('PL-021')).toBeInTheDocument()
    expect(within(drawer).getByText('v1.2')).toBeInTheDocument()
    // Evidence links carry the event's own project, not just the active scope.
    fireEvent.click(within(drawer).getByRole('button', { name: 'EV-014-01' }))
    expect(window.location.hash).toBe('#/project/RT-2026-014?tab=evidence')
    h.unmount()
  })

  it('filters by facet, status chip and search; keyboard escape closes the facet popover', async () => {
    const h = mountTrace()
    await waitFor(() => expect(screen.getByText('TL-01')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'More filters' }))
    const popover = screen.getByRole('dialog', { name: 'More filters' })
    fireEvent.change(within(popover).getByLabelText('Policy facet'), { target: { value: 'Blocked' } })
    expect(screen.getByText('TL-04')).toBeInTheDocument()
    expect(screen.queryByText('TL-01')).not.toBeInTheDocument()
    fireEvent.click(within(popover).getByRole('button', { name: 'Reset facets' }))
    await waitFor(() => expect(screen.getByText('TL-01')).toBeInTheDocument())
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByLabelText('Policy facet')).not.toBeInTheDocument()
    // Exclusive status chip: every event falls in exactly one bucket.
    fireEvent.click(screen.getByRole('button', { name: /^Failed/ }))
    expect(screen.getByText('TL-06')).toBeInTheDocument()
    expect(screen.queryByText('TL-01')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    await waitFor(() => expect(screen.getByText('TL-01')).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText('Search event, tool, target, agent, branch'), { target: { value: 'payments' } })
    expect(screen.getByText('TL-04')).toBeInTheDocument()
    expect(screen.queryByText('TL-01')).not.toBeInTheDocument()
    h.unmount()
  })

  it('renders masked sensitive values — raw credentials and IPs never reach the DOM', async () => {
    const h = mountTrace()
    await waitFor(() => expect(screen.getByText('TL-01')).toBeInTheDocument())
    h.run(() => {
      h.svc().authority.commit('t', (d) => {
        d.toolEvents.unshift({ id: 'TL-90', conversationId: 'CV-014-03', projectId: 'RT-2026-014', tool: 'credential-validator (lab)', target: 'win-dc-01', params: 'user=svc-scan password=hunter2 host=192.0.2.99', state: 'completed', at: d.toolEvents[0]!.at, result: 'token=abc123 captured from 10.0.0.7' })
      })
    })
    fireEvent.click(await screen.findByText('TL-90'))
    await screen.findByRole('dialog', { name: 'Tool Event Inspector — TL-90' })
    expect(screen.getByText(/password=\[redacted\] host=\[ip redacted\]/)).toBeInTheDocument()
    expect(screen.getByText(/token=\[redacted\] captured from \[ip redacted\]/)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('hunter2')
    expect(document.body.textContent).not.toContain('abc123')
    h.unmount()
  })

  it('a legacy tool decision publishes through the change bridge and the Query-backed trace refetches without a reload', async () => {
    const h = mountTrace()
    await waitFor(() => expect(screen.getByText('TL-03')).toBeInTheDocument())
    const pendingRow = () => screen.getByText('TL-03').closest('tr')!
    expect(within(pendingRow()).getByText('Pending')).toBeInTheDocument()
    expect(screen.getByText(/tool call pending approval/)).toBeInTheDocument()
    h.run(() => { h.store().A.decideTool('TL-03', 'denied', 'Not needed for this objective') })
    await waitFor(() => expect(within(screen.getByText('TL-03').closest('tr')!).getByText('Blocked')).toBeInTheDocument())
    expect(within(screen.getByText('TL-03').closest('tr')!).getByText('Denied')).toBeInTheDocument()
    expect(screen.queryByText(/tool call pending approval/)).not.toBeInTheDocument()
    h.unmount()
  })

  it('a delayed superseded read never restores the old project after a scope switch', async () => {
    window.location.hash = '#/ai-trace'
    let store!: Store
    let svc!: ConsoleServices
    render(
      <StoreProvider>
        <ConsoleProviders>
          <Probe ready={(s, v) => { store = s; svc = v }} />
          <AiTrace />
        </ConsoleProviders>
      </StoreProvider>,
    )
    act(() => { store.setMe('Taylor Chen') })
    // Gate the RT-2026-014 read before the project switch triggers it.
    const gate = defer()
    const base = svc.trace.bind(svc)
    svc.trace = (actor, project) => {
      const s = base(actor, project)
      return project === 'RT-2026-014' ? { ...s, list: (c: RequestContext) => gate.promise.then(() => s.list(c)) } : s
    }
    act(() => { store.setPid('RT-2026-014') })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Loading tool trace'))
    act(() => { store.setPid('RT-2026-015') }) // Taylor is a member here too
    expect(await screen.findByText('TL-05')).toBeInTheDocument()
    await act(async () => { gate.resolve(); await Promise.resolve() })
    expect(screen.queryByText('TL-01')).not.toBeInTheDocument()
    expect(screen.getByText('TL-05')).toBeInTheDocument()
    cleanup()
  })

  it('the event deep link resolves through the router route projection — no raw location writes on this surface', async () => {
    const h = mountTrace()
    await waitFor(() => expect(screen.getByText('TL-01')).toBeInTheDocument())
    h.run(() => { h.store().go('ai-trace', { id: 'TL-03' }) })
    expect(await screen.findByRole('dialog', { name: 'Tool Event Inspector — TL-03' })).toBeInTheDocument()
    expect(window.location.hash).toBe('#/ai-trace/TL-03')
    h.unmount()
  })

  it('renders the scoped empty state and the out-of-scope error state without a leak', async () => {
    const h = mountTrace('Taylor Chen', 'RT-2026-016')
    expect(await screen.findByText('No AI tool activity in this project yet')).toBeInTheDocument()
    h.unmount()
    const h2 = mountTrace('Riley Brooks', 'RT-2026-015')
    expect(await screen.findByText('Could not load tool trace')).toBeInTheDocument()
    expect(screen.getByText('Tool trace for this project is not available for your account.')).toBeInTheDocument()
    expect(screen.queryByText('TL-01')).not.toBeInTheDocument()
    h2.unmount()
  })

  it('keeps the trace on the typed read: no raw location writes and no legacy database reads on the ai-trace route', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'screens', 'g-trace.tsx'), 'utf8')
    const traceSlice = src.slice(src.indexOf('export function AiTrace'), src.indexOf('/* ───────────── AI History'))
    expect(traceSlice).toContain('useTraceEvents(')
    expect(traceSlice).not.toMatch(/\bdb\./)
    expect(traceSlice).not.toMatch(/toolFacets\(/)
    expect(traceSlice).not.toMatch(/location\.hash|replaceState/)
    expect(src).not.toMatch(/window\.location\.hash/)
    expect(src).not.toMatch(/history\.replaceState/)
    expect(src).not.toMatch(/hashParam|setHash\b/)
    expect(src).not.toContain('?event=')
    expect(src).toMatch(/from '\.\.\/features\/trace\/query'/)
  })
})
