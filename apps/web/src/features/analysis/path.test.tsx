/**
 * Ticket 55: attack-path graph on typed reads — the graph derives from
 * scoped canonical records only, and observed edges connect recorded
 * execution events (ok/fail) so missing/unknown data never invents lateral
 * movement or success. Nodes/edges keep step/session/evidence provenance;
 * keyboard and pointer selection expose the same details and links resolve
 * through the router; a recorded step review updates the graph without a
 * reload; non-member reads are denied without an existence leak; late
 * responses for a superseded scope never restore old visibility.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mountServices } from '../../test/helpers'
import { currentRoute } from '../../router/navigate'
import { useProjectStore } from '../../state/stores'
import { analysisRoutes } from './views/analysis-page'
import { seed } from '../../demo/seed';
import { pathOf } from './path'
import { reviewOperationStep } from '../operations/service'
import type { ActorRef } from '../../domain/service'

afterEach(() => { cleanup(); vi.restoreAllMocks(); window.location.hash = '' })

const TAYLOR: ActorRef = { id: 'Taylor Chen', role: 'operator' }

/** Mounts the providers with a probe, then optionally the real analysis route at `hash`. */
function mountAnalysis(me = 'Alex Morgan', hash = '#/analysis?tab=chain') {
  const Analysis = analysisRoutes.analysis
  window.location.hash = hash
  const h = mountServices(null, me)
  return { ...h, show: () => h.show(<Analysis />) }
}

const NUMERIC_ATTRS = ['x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'width', 'height', 'rx']

/** No NaN may ever reach the SVG geometry: every numeric attribute and path coordinate is finite. */
function expectFiniteGeometry(svg: Element) {
  expect(svg.getAttribute('viewBox')).toMatch(/^0 0 \d+(\.\d+)? \d+(\.\d+)?$/)
  svg.querySelectorAll('circle, rect, line, polygon, text').forEach((el) => {
    for (const a of NUMERIC_ATTRS) {
      const v = el.getAttribute(a)
      if (v !== null) expect(Number.isFinite(Number(v)), `${el.tagName}[${a}]=${v}`).toBe(true)
    }
  })
  svg.querySelectorAll('path').forEach((p) => {
    for (const n of p.getAttribute('d')?.match(/-?\d+(?:\.\d+)?/g) ?? []) {
      expect(Number.isFinite(Number(n)), `path d coordinate ${n}`).toBe(true)
    }
  })
}

const dana = { id: 'Dana Whitfield', role: 'admin' as const }

describe('pathOf handler (recorded fixtures)', () => {
  it('derives observed edges only between recorded execution events', () => {
    const res = pathOf(seed(), { actor: dana, projectId: 'RT-2026-015', corr: 't' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const p = res.data.selected!
    expect(p.op.id).toBe('OP-015')
    expect(p.projectId).toBe('RT-2026-015')
    expect(p.steps.map((ps) => ps.step.id)).toEqual(['S01', 'S02', 'S03', 'S04'])
    const edge = (from: string, to: string) => p.edges.find((e) => e.kind === 'step-step' && e.from === from && e.to === to)!
    // S01→S02: both steps reached recorded outcomes (ok/ok) — the one observed transition.
    expect(edge('S01', 'S02').observed).toBe(true)
    // S02 (ok) → S03 (running, no recorded outcome): planned — movement is never invented.
    expect(edge('S02', 'S03').observed).toBe(false)
    // S03 (running) → S04 (notrun): planned.
    expect(edge('S03', 'S04').observed).toBe(false)
    // asset→step anchors observe only executed steps.
    const anchor = (from: string, to: string) => p.edges.find((e) => e.kind === 'asset-step' && e.from === from && e.to === to)!
    expect(anchor('cloud-app-01', 'S01').observed).toBe(true)
    expect(anchor('cloud-node-01', 'S03').observed).toBe(false)
    expect(anchor('cloud-node-01', 'S04').observed).toBe(false)
    expect(p.nObserved).toBe(2)
  })

  it('an operation with no recorded outcomes yields zero observed edges', () => {
    const res = pathOf(seed(), { actor: dana, projectId: 'all', corr: 't' }, { opId: 'OP-016' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const p = res.data.selected!
    expect(p.op.id).toBe('OP-016')
    expect(p.steps.length).toBeGreaterThan(0)
    expect(p.edges.length).toBeGreaterThan(0)
    expect(p.edges.every((e) => !e.observed)).toBe(true)
    expect(p.nObserved).toBe(0)
  })

  it('keeps provenance: technique nodes carry step references and project-scoped findings', () => {
    const res = pathOf(seed(), { actor: dana, projectId: 'all', corr: 't' }, { opId: 'OP-014' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const p = res.data.selected!
    expect(p.op.sessionId).toBe('SS-041')
    const t1078 = p.techniques.find((t) => t.id === 'T1078')!
    expect(t1078.tactic).toBe('Initial Access')
    expect(t1078.stepIds).toEqual(['S06'])
    expect(t1078.findings.map((f) => f.id)).toEqual(['FD-011'])
    // Evidence references survive on the recorded steps (S02 → EV-014-01).
    const s02 = p.steps.find((ps) => ps.step.id === 'S02')!
    expect(s02.step.evidence).toBe('EV-014-01')
    // An aggregate read never mixes another project's findings into this chain.
    const t1087 = p.techniques.find((t) => t.id === 'T1087')!
    expect(t1087.findings).toEqual([])
  })

  it('folds only accessible operations into the aggregate; a non-member read is denied without a leak', () => {
    const riley = { id: 'Riley Brooks', role: 'analyst' as const }
    const agg = pathOf(seed(), { actor: riley, projectId: 'all', corr: 't' })
    expect(agg.ok).toBe(true)
    if (agg.ok) expect(agg.data.ops.every((o) => ['OP-013', 'OP-014'].includes(o.id))).toBe(true)
    const denied = pathOf(seed(), { actor: riley, projectId: 'RT-2026-015', corr: 't' })
    expect(denied.ok).toBe(false)
    if (!denied.ok) {
      expect(denied.failure.kind).toBe('not-found')
      expect(denied.failure.message).not.toContain('RT-2026-015')
      expect(denied.failure.message).not.toContain('Cloud configuration validation')
    }
  })

  it('agent and operating-system filters narrow the chain to the recorded subset', () => {
    const res = pathOf(seed(), { actor: dana, projectId: 'RT-2026-014', corr: 't' }, { agent: 'AG-008' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const p = res.data.selected!
    expect(p.op.id).toBe('OP-014')
    expect(p.steps.map((ps) => ps.step.agent)).toEqual(['AG-008', 'AG-008', 'AG-008', 'AG-008', 'AG-008', 'AG-008'])
    // Only the filtered steps remain — and the chain re-derives from them alone.
    expect(p.edges.every((e) => p.steps.some((ps) => ps.step.id === e.to))).toBe(true)
  })
})

describe('attack-path graph (ticket 55)', () => {
  it('renders the scoped chain with finite geometry; planned hops are never presented as observed', async () => {
    const h = mountAnalysis('Dana Whitfield')
    h.show()
    h.run(() => useProjectStore.getState().setPid('RT-2026-014'))
    const svg = await waitFor(() => screen.getByRole('img', { name: 'Attack path graph for operation OP-014' }))
    expectFiniteGeometry(svg)
    // OP-014: 12 recorded steps; S01→S02 is an observed transition, S10→S11 (review) stays planned.
    expect(screen.getByText('Observed: S01 → S02')).toBeInTheDocument()
    expect(screen.getByText('Planned — not executed: S10 → S11')).toBeInTheDocument()
    expect(screen.getByText('Planned — not executed: S11 → S12')).toBeInTheDocument()
    expect(screen.getByText('Observed: win-dc-01 → S01')).toBeInTheDocument()
    // The selector only offers operations in scope.
    expect(screen.queryByRole('option', { name: 'OP-015' })).not.toBeInTheDocument()
    h.unmount()
  })

  it('keyboard focus and pointer selection expose the same provenance details', async () => {
    const user = userEvent.setup()
    const h = mountAnalysis('Dana Whitfield')
    h.show()
    h.run(() => useProjectStore.getState().setPid('RT-2026-014'))
    const step = await waitFor(() => screen.getByRole('button', { name: 'Step S02 Enumerate local accounts' }))
    // Keyboard: focus + Enter opens the same drawer pointer selection would.
    step.focus()
    expect(step).toHaveFocus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    expect(screen.getByText('Observed — recorded in operation data.')).toBeInTheDocument()
    expect(screen.getByText('SS-041')).toBeInTheDocument() // session provenance
    expect(screen.getByText('EV-014-01')).toBeInTheDocument() // evidence provenance
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // Pointer: the asset node opens the equivalent details.
    fireEvent.click(screen.getByRole('button', { name: 'Asset win-dc-01' }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    expect(screen.getByText('AS-0143')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    h.unmount()
  })

  it('node links resolve through the router: operation, technique and finding', async () => {
    const user = userEvent.setup()
    const h = mountAnalysis('Dana Whitfield')
    h.show()
    h.run(() => useProjectStore.getState().setPid('RT-2026-014'))
    const step = await waitFor(() => screen.getByRole('button', { name: 'Step S02 Enumerate local accounts' }))
    step.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Open execution step' }))
    await waitFor(() => expect(currentRoute().page).toBe('operation'))
    expect(currentRoute().id).toBe('OP-014')
    h.unmount()
  })

  it('the technique drawer resolves the technique page and finding links', async () => {
    const user = userEvent.setup()
    const h = mountAnalysis('Dana Whitfield')
    h.show()
    h.run(() => useProjectStore.getState().setPid('RT-2026-014'))
    const tech = await waitFor(() => screen.getByRole('button', { name: 'Technique T1078' }))
    tech.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Technique page' }))
    await waitFor(() => expect(currentRoute().page).toBe('technique'))
    expect(currentRoute().id).toBe('T1078')
    h.unmount()
  })

  it('a recorded step review updates the graph without a reload', async () => {
    const h = mountAnalysis('Taylor Chen')
    h.show()
    h.run(() => useProjectStore.getState().setPid('RT-2026-014'))
    await waitFor(() => expect(screen.getByRole('img', { name: 'Attack path graph for operation OP-014' })).toBeInTheDocument())
    // S11 awaits review: its hop from S10 is planned, never observed.
    expect(screen.getByText('In review')).toBeInTheDocument()
    expect(screen.getByText('Planned — not executed: S10 → S11')).toBeInTheDocument()
    // Ticket 65 retired the A.reviewStep wrapper; the review commits through
    // the same typed handler the wrapper delegated to.
    h.run(() => { reviewOperationStep(h.svc().authority, h.svc().clock, { actor: TAYLOR, projectId: 'RT-2026-014', corr: 'legacy' }, 'OP-014', 'S11', 'approve') })
    // The recorded outcome makes the transition observed — via [operation]-key invalidation, no reload.
    await waitFor(() => expect(screen.getByText('Observed: S10 → S11')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Step S11/ })).toHaveTextContent('Succeeded')
    h.unmount()
  })

  it('a delayed path response for a superseded scope never pollutes the switched view', async () => {
    let resolveGate!: () => void
    const gate = new Promise<void>((r) => { resolveGate = r })
    const h = mountAnalysis()
    const svc = h.svc()
    const orig = svc.analysis.bind(svc)
    vi.spyOn(svc, 'analysis').mockImplementation((actor, project) => {
      const inner = orig(actor, project)
      if (project !== 'all') return inner
      return { ...inner, path: async (ctx, query) => { await gate; return inner.path(ctx, query) } }
    })
    h.show()
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument())
    h.run(() => useProjectStore.getState().setPid('RT-2026-014'))
    await waitFor(() => expect(screen.getByRole('img', { name: 'Attack path graph for operation OP-014' })).toBeInTheDocument())
    await act(async () => { resolveGate(); await Promise.resolve() })
    expect(screen.getByRole('img', { name: 'Attack path graph for operation OP-014' })).toBeInTheDocument()
    expect(screen.queryByText('Cloud configuration validation')).not.toBeInTheDocument()
    const stale = h.qc().getQueryCache().findAll({ queryKey: ['operation'] })
      .find((q) => (q.queryKey[1] as { project?: string }).project === 'all' && q.queryKey[2] === 'path')
    expect(stale?.state.data).toBeUndefined()
    h.unmount()
  })

  it('keeps the graph on the typed path read, not a store-side derivation', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'features', 'analysis', 'views', 'analysis-page.tsx'), 'utf8')
    expect(src).toMatch(/useAttackPath\(/)
    expect(src).not.toMatch(/ana\.entries\.filter\(\(e\) => e\.op\.id === op\.id\)/)
    expect(src).not.toMatch(/s\.status === 'ok' \| \| s\.status === 'fail'/)
  })
})
