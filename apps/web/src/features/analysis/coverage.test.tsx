/**
 * Ticket 54: ATT&CK coverage + detection heatmap read model — matrix cells
 * roll up only observed operation events (executed ok/fail), scoped to
 * accessible projects; the heatmap separates detected / undetected (verified)
 * / no data (unverified) and never reads a disconnected source as
 * "undetected"; keyboard-operable matrix interactions and router-only
 * navigation; the Query bridge updates the aggregate after a recorded step
 * review without a reload; late responses for a superseded scope are
 * cancelled. Plus focused handler edges (planned ≠ executed, non-member
 * denial, aggregate scope folding).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mountServices } from '../../test/helpers'
import { currentRoute } from '../../router/navigate'
import { useProjectStore } from '../../state/stores'
import { setIntegrationConnection } from '../settings/service'
import { analysisRoutes } from '../../screens/e-analysis'
import { seed } from '../../data'
import { coverageOf } from './service'
import { reviewOperationStep } from '../operations/service'
import type { ActorRef } from '../../domain/service'

afterEach(() => { cleanup(); vi.restoreAllMocks(); window.location.hash = '' })

const TAYLOR: ActorRef = { id: 'Taylor Chen', role: 'operator' }

/** Mounts the providers with a probe, then optionally the real analysis route at `hash`. */
function mountAnalysis(me = 'Alex Morgan', hash = '#/analysis') {
  const Analysis = analysisRoutes.analysis
  window.location.hash = hash
  const h = mountServices(null, me)
  return { ...h, show: () => h.show(<Analysis />) }
}

describe('ATT&CK coverage matrix (ticket 54)', () => {
  it('renders coverage from observed operations, scoped to accessible projects', async () => {
    const h = mountAnalysis('Dana Whitfield', '#/analysis?tab=matrix') // admin — reaches every project
    h.show()
    await waitFor(() => expect(screen.getByText(/11\/22 techniques tested/)).toBeInTheDocument())
    // RT-2026-009's executed T1046 step is detected, so the aggregate cell is Detected.
    const cell = screen.getByRole('button', { name: /T1046/ })
    expect(cell).toHaveTextContent('Executed & Detected')
    // Scoping to one project drops the out-of-scope observation: the cell falls back to No Data.
    h.run(() => useProjectStore.getState().setPid('RT-2026-014'))
    await waitFor(() => expect(screen.getByRole('button', { name: /T1046/ })).toHaveTextContent('Executed & No Data'))
    expect(screen.getByText(/11\/22 techniques tested/)).toBeInTheDocument()
    // Catalog techniques with no recorded events stay explicitly "Not Tested".
    expect(screen.getByRole('button', { name: /T1190/ })).toHaveTextContent('Not Tested')
    h.unmount()
  })

  it('a planned-only technique is not counted as executed coverage', async () => {
    const h = mountAnalysis('Dana Whitfield', '#/analysis?tab=matrix')
    h.show()
    await waitFor(() => expect(screen.getByText(/11\/22 techniques tested/)).toBeInTheDocument())
    // T1119's only observed event awaits operator review (OP-014/S11) — planned, never executed.
    expect(screen.getByRole('button', { name: /T1119/ })).toHaveTextContent('Planned Only')
    h.unmount()
  })

  it('the heatmap separates detected, verified-undetected and unverified no-data outcomes', async () => {
    const h = mountAnalysis('Taylor Chen', '#/analysis?tab=detection') // operator — viewSensitive granted
    h.show()
    h.run(() => useProjectStore.getState().setPid('RT-2026-014'))
    await waitFor(() => expect(screen.getByText('67%')).toBeInTheDocument()) // 2 detected / 3 with data
    // Tactic bars label their split: Discovery has 2 detected + 2 no data; Initial Access is the verified gap.
    expect(screen.getByRole('img', { name: '2 detected, 0 not detected, 2 no data' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '0 detected, 1 not detected, 0 no data' })).toBeInTheDocument()
    // The verified gap appears in the pairs, telemetry and gaps tables; executed no-data rows stay unverified.
    expect(screen.getAllByText('Not Detected')).toHaveLength(3)
    expect(screen.getAllByText('Unverified').length).toBeGreaterThan(0)
    expect(screen.getByText(/Add alert rules for unusual privileged-account sign-ins/)).toBeInTheDocument()
    h.unmount()
  })

  it('a disconnected detection source reads as No Data, never as Not Detected', async () => {
    const h = mountAnalysis('Taylor Chen', '#/analysis?tab=matrix')
    h.show()
    h.run(() => useProjectStore.getState().setPid('RT-2026-014'))
    await waitFor(() => expect(screen.getByRole('button', { name: /T1078/ })).toHaveTextContent('Executed & Not Detected'))
    h.run(() => { expect(setIntegrationConnection(h.svc().authority, h.svc().clock, { actor: { id: 'Dana Whitfield', role: 'admin' }, projectId: 'all', corr: 'test-disconnect' }, 'IN-1', 'disconnect', 'Verify disconnected detection source').ok).toBe(true) })
    await waitFor(() => expect(screen.getByText('Detection integration unavailable')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /T1078/ })).toHaveTextContent('Executed & No Data')
    expect(screen.getByRole('button', { name: /T1082/ })).toHaveTextContent('Executed & No Data')
    h.unmount()
  })

  it('matrix cells are keyboard-operable and technique links resolve through the router', async () => {
    const user = userEvent.setup()
    const h = mountAnalysis('Taylor Chen', '#/analysis?tab=matrix')
    h.show()
    const cell = await waitFor(() => screen.getByRole('button', { name: /T1087/ }))
    cell.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    expect(screen.getByText(/High-level description of Account Discovery/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open technique in Playbooks' }))
    await waitFor(() => expect(currentRoute().page).toBe('technique'))
    expect(currentRoute().id).toBe('T1087')
    h.unmount()
  })

  it('a recorded step review updates the aggregate without a reload', async () => {
    const h = mountAnalysis('Taylor Chen', '#/analysis?tab=matrix')
    h.show()
    h.run(() => useProjectStore.getState().setPid('RT-2026-014'))
    await waitFor(() => expect(screen.getByText(/11\/22 techniques tested/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /T1119/ })).toHaveTextContent('Planned Only')
    // Ticket 65 retired the A.reviewStep wrapper; the review commits through
    // the same typed handler the wrapper delegated to.
    h.run(() => { reviewOperationStep(h.svc().authority, h.svc().clock, { actor: TAYLOR, projectId: 'RT-2026-014', corr: 'legacy' }, 'OP-014', 'S11', 'approve') })
    await waitFor(() => expect(screen.getByText(/12\/22 techniques tested/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /T1119/ })).toHaveTextContent('Executed & No Data')
    h.unmount()
  })

  it('a delayed coverage response for a superseded scope never pollutes the switched view', async () => {
    let resolveGate!: () => void
    const gate = new Promise<void>((r) => { resolveGate = r })
    const h = mountAnalysis()
    const svc = h.svc()
    const orig = svc.analysis.bind(svc)
    vi.spyOn(svc, 'analysis').mockImplementation((actor, project) => {
      const inner = orig(actor, project)
      if (project !== 'all') return inner
      return { ...inner, coverage: async (ctx, query) => { await gate; return inner.coverage(ctx, query) } }
    })
    h.show()
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument())
    h.run(() => useProjectStore.getState().setPid('RT-2026-014'))
    await waitFor(() => expect(screen.getByText('All operations (2)')).toBeInTheDocument())
    await act(async () => { resolveGate(); await Promise.resolve() })
    expect(screen.getByText('All operations (2)')).toBeInTheDocument()
    expect(screen.queryByText('Cloud configuration validation')).not.toBeInTheDocument()
    const stale = h.qc().getQueryCache().findAll({ queryKey: ['operation'] })
      .find((q) => (q.queryKey[1] as { project?: string }).project === 'all')
    expect(stale?.state.data).toBeUndefined()
    h.unmount()
  })

  it('keeps no raw location writes in the surface: the router is the single writer', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'screens', 'e-analysis.tsx'), 'utf8')
    expect(src).not.toMatch(/window\.location|history\.(replaceState|pushState)\(|location\.assign\(/)
    expect(src).toMatch(/useAnalysisCoverage\(/)
  })
})

describe('coverageOf handler', () => {
  it('folds only accessible projects into the aggregate and attaches scope-checked findings', () => {
    const riley = { id: 'Riley Brooks', role: 'analyst' as const }
    const res = coverageOf(seed(), { actor: riley, projectId: 'all', corr: 't' })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.allOps.map((o) => o.id).sort()).toEqual(['OP-013', 'OP-014'])
      expect(res.data.pairs.every((p) => p.projectId === 'RT-2026-014')).toBe(true)
      const t1078 = res.data.pairs.find((p) => p.projectId === 'RT-2026-014' && p.tech.id === 'T1078')
      expect(t1078?.state).toBe('undetected')
      expect(t1078?.findings.map((f) => f.id)).toContain('FD-011')
    }
  })

  it('denies a non-member specific-project read without leaking existence', () => {
    const riley = { id: 'Riley Brooks', role: 'analyst' as const }
    const res = coverageOf(seed(), { actor: riley, projectId: 'RT-2026-015', corr: 't' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.failure.kind).toBe('not-found')
  })

  it('counts only executed steps as coverage; review/pending are planned', () => {
    const res = coverageOf(seed(), { actor: { id: 'Taylor Chen', role: 'operator' }, projectId: 'RT-2026-014', corr: 't' })
    expect(res.ok).toBe(true)
    if (res.ok) {
      const t1119 = res.data.cells.find((c) => c.tech.id === 'T1119')!
      expect(t1119.runs).toHaveLength(0)
      expect(t1119.planned.map((p) => p.step.id)).toEqual(['S11'])
      expect(t1119.state).toBe('planned')
      expect(res.data.nRun).toBe(11)
    }
  })

  it('a disconnected detection source reports no-data (unverified), never undetected', () => {
    const d = structuredClone(seed())
    d.integrations.find((i) => i.id === 'IN-1')!.status = 'disconnected'
    const res = coverageOf(d, { actor: { id: 'Taylor Chen', role: 'operator' }, projectId: 'RT-2026-014', corr: 't' })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.siemOn).toBe(false)
      const t1078 = res.data.cells.find((c) => c.tech.id === 'T1078')!
      expect(t1078.runs.length).toBeGreaterThan(0)
      expect(t1078.state).toBe('nodata')
      expect(res.data.nUndetected).toBe(0)
    }
  })

  it('agent and operating-system filters narrow the observed entries', () => {
    const linux = coverageOf(seed(), { actor: { id: 'Taylor Chen', role: 'operator' }, projectId: 'RT-2026-014', corr: 't' }, { os: 'Linux' })
    const agent = coverageOf(seed(), { actor: { id: 'Taylor Chen', role: 'operator' }, projectId: 'RT-2026-014', corr: 't' }, { agent: 'AG-007' })
    expect(linux.ok && agent.ok).toBe(true)
    if (linux.ok && agent.ok) {
      expect(linux.data.entries.every((e) => e.step.agent === 'AG-008')).toBe(true)
      expect(agent.data.entries.every((e) => e.step.agent === 'AG-007')).toBe(true)
      expect(agent.data.nRun).toBeGreaterThan(0)
      expect(agent.data.nRun).toBeLessThan(linux.ok ? 22 : 0)
    }
  })
})
