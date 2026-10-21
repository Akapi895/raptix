/**
 * Ticket 30: operation results + execution graph on the typed read model —
 * the results/graph migration at its new execution site
 * (src/features/results/service.ts + src/screens/c-results.tsx).
 *
 * Covered here: the read derives graph and results presentation from
 * canonical records only (step outcomes stay distinct, edges are playbook
 * order — never an inferred attack path, sessions/branches/evidence as
 * recorded, sensitive-output masking policy-derived per actor); reads stay
 * project-scoped (non-member not-found without a leak; a cross-project
 * address returns the switch entity); the graph renders with finite
 * geometry; pointer click and keyboard focus reveal the same inspector;
 * links resolve to migrated routes; a delayed superseded response never
 * pollutes the switched scope; and a legacy execution event refetches the
 * Query-backed graph through the bridge.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { mountServices } from '../../test/helpers'
import { currentRoute, selectProject } from '../../router/navigate'
import { useProjectStore } from '../../state/stores'
import type { ActorRef, RequestContext } from '../../domain/service'
import { GraphTab, ResultsTab } from '../../screens/c-results'
import { seed } from '../../demo/seed';
import { operationResults } from './service'

afterEach(() => { cleanup(); vi.restoreAllMocks(); window.location.hash = '' })

/** Mounts the providers, a probe and one results/graph tab for one operation. */
function mountTab(Tab: typeof GraphTab, opId: string, me = 'Taylor Chen') {
  const op = seed().operations.find((o) => o.id === opId)!
  const ui = <Tab op={op} />
  const h = mountServices(ui, me)
  return { ...h, rerender: () => h.show(ui) }
}

const taylor = (): ActorRef => ({ id: 'Taylor Chen', role: 'operator' })
const riley = (): ActorRef => ({ id: 'Riley Brooks', role: 'analyst' })
const casey = (): ActorRef => ({ id: 'Casey Nguyen (Client)', role: 'viewer' })
const ctx = (actor: ActorRef, projectId: string, corr = 't'): RequestContext => ({ actor, projectId, corr })

describe('results read model (ticket 30)', () => {
  it('derives counts, edges, branches, sessions and finding groups from canonical records', () => {
    const res = operationResults(seed(), ctx(taylor(), 'RT-2026-014'), 'OP-014')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const d = res.data
    expect(d.counts).toMatchObject({ ok: 10, fail: 0, pending: 1, running: 0, notrun: 0, unknown: 0, review: 1, total: 12 })
    expect(d.executed).toBe(10) // a review-gated step has not produced its outcome yet
    expect(d.edges).toHaveLength(11)
    expect(d.edges[0]).toEqual({ from: 'S01', to: 'S02', dashed: false })
    expect(d.edges[11 - 1]).toEqual({ from: 'S11', to: 'S12', dashed: true }) // target has not run
    expect(d.steps[2]!.branches.map((b) => b.id)).toEqual(['BR-014-01', 'BR-014-02'])
    expect(d.failedBranches.map((b) => b.id)).toEqual(['BR-014-03'])
    expect(d.failedBranches[0]).toMatchObject({ stepId: 'S11', failed: true, error: expect.stringContaining('timed out') })
    expect(d.sessions.map((s) => s.id)).toEqual(['SS-041', 'SS-042'])
    expect(d.evidence.map((e) => e.id)).toEqual(['EV-014-01', 'EV-014-02'])
    expect(d.findings.map((f) => f.id)).toEqual(['FD-011'])
    expect(d.proposed.map((f) => f.id)).toEqual(['FD-012'])
    expect(d.reports.map((r) => r.id)).toContain('REP-014')
    expect(d.viewSensitive).toBe(true)
  })

  it('derives sensitive-output masking from the requesting actor, not the screen', () => {
    const operator = operationResults(seed(), ctx(taylor(), 'RT-2026-014'), 'OP-014')
    const viewer = operationResults(seed(), ctx(casey(), 'RT-2026-014'), 'OP-014')
    expect(operator.ok && viewer.ok).toBe(true)
    if (operator.ok && viewer.ok) {
      expect(operator.data.viewSensitive).toBe(true)
      expect(operator.data.steps.every((s) => !s.maskOutput)).toBe(true)
      expect(viewer.data.viewSensitive).toBe(false)
      // S06 carries the sensitive evidence EV-014-02; only its output is masked.
      expect(viewer.data.steps[5]!.maskOutput).toBe(true)
      expect(viewer.data.steps[1]!.maskOutput).toBe(false)
    }
  })

  it('stays project-scoped: a non-member read is not-found without a leak; a cross-project address names the switch target', () => {
    const denied = operationResults(seed(), ctx(riley(), 'RT-2026-014'), 'OP-015')
    expect(denied.ok).toBe(false)
    if (!denied.ok) {
      expect(denied.failure.kind).toBe('not-found')
      expect(denied.failure.message).not.toContain('OP-014')
      expect(denied.failure.message).not.toContain('AG-007')
    }
    const cross = operationResults(seed(), ctx(taylor(), 'RT-2026-014'), 'OP-015')
    expect(cross.ok).toBe(false)
    if (!cross.ok) {
      expect(cross.failure.entity).toEqual({ kind: 'operation', id: 'OP-015', projectId: 'RT-2026-015' })
      expect(cross.failure.message).not.toContain('AG-010')
    }
  })
})

describe('execution graph screen (ticket 30)', () => {
  it('renders canonical events with finite geometry; connectors stay playbook order', async () => {
    const h = mountTab(GraphTab, 'OP-014')
    const nodes = await screen.findAllByRole('button', { name: /^Step S\d+,.+/ })
    expect(nodes).toHaveLength(12)
    expect(screen.getByRole('button', { name: 'Step S01, Completed — Collect system information' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Step S11, Needs review — Automated collection sample' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Step S12, Queued — Summarize and clean up' })).toBeInTheDocument()
    const canvas = screen.getByRole('button', { name: 'Step S01, Completed — Collect system information' }).parentElement!
    const svg = canvas.querySelector('svg')!
    expect(Number(svg.getAttribute('width'))).toBeGreaterThan(0)
    expect(Number.isFinite(Number(svg.getAttribute('height')))).toBe(true)
    for (const n of nodes) {
      expect(Number.isFinite(parseFloat((n as HTMLElement).style.left))).toBe(true)
      expect(Number.isFinite(parseFloat((n as HTMLElement).style.top))).toBe(true)
    }
    expect(screen.getByText(/No attack path is inferred/)).toBeInTheDocument()
    expect(screen.getByLabelText('Recorded sessions')).toHaveTextContent('SS-041')
    h.unmount()
  })

  it('pointer click and keyboard focus reveal the same step inspector', async () => {
    const h = mountTab(GraphTab, 'OP-014')
    const node = await screen.findByRole('button', { name: 'Step S03, Completed — Enumerate permission groups' })
    fireEvent.click(node)
    let dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('S03')
    expect(dialog).toHaveTextContent('Enumerate permission groups')
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]!)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    fireEvent.focus(screen.getByRole('button', { name: 'Step S05, Completed — Collect web server details' }))
    dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('S05')
    h.unmount()
  })

  it('shows the not-enough-events empty state before two steps have execution data', async () => {
    const h = mountTab(GraphTab, 'OP-016')
    expect(await screen.findByText('Not enough events to draw the graph')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Step S\d+,.+/ })).not.toBeInTheDocument()
    h.unmount()
  })

  it('renders the refusal reason for an out-of-scope read without a leak', async () => {
    const h = mountTab(GraphTab, 'OP-015', 'Riley Brooks') // analyst — member of RT-2026-014 only
    h.rerender()
    expect(await screen.findByText('Results could not be loaded')).toBeInTheDocument()
    expect(screen.getByText('Operations for this project are not available for your account.')).toBeInTheDocument()
    expect(screen.queryByText(/AG-010/)).not.toBeInTheDocument()
    h.unmount()
  })

  it('a legacy execution event refetches the graph through the bridge', async () => {
    const h = mountTab(GraphTab, 'OP-014')
    await screen.findByRole('button', { name: 'Step S11, Needs review — Automated collection sample' })
    h.run(() => {
      h.svc().authority.commit('legacy-step-event', (d) => {
        const s = d.operations.find((o) => o.id === 'OP-014')!.steps.find((x) => x.id === 'S11')!
        s.status = 'fail'
        s.output = 'Agent response timed out — no result.'
      })
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Step S11, Failed — Automated collection sample' })).toBeInTheDocument())
    h.unmount()
  })

  it('a delayed response for a superseded scope never pollutes the switched view', async () => {
    let resolveGate!: () => void
    const gate = new Promise<void>((r) => { resolveGate = r })
    const h = mountTab(GraphTab, 'OP-014')
    const svc = h.svc()
    const orig = svc.results.bind(svc)
    vi.spyOn(svc, 'results').mockImplementation((actor, project) => {
      const inner = orig(actor, project)
      if (project !== 'all') return inner
      return { ...inner, detail: async (c, id) => { await gate; return inner.detail(c, id) } }
    })
    h.rerender()
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument())
    h.run(() => selectProject('RT-2026-014'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Step S01, Completed — Collect system information' })).toBeInTheDocument())
    await act(async () => { resolveGate(); await Promise.resolve() })
    expect(screen.getByRole('button', { name: 'Step S01, Completed — Collect system information' })).toBeInTheDocument()
    const stale = h.qc().getQueryCache().findAll({ queryKey: ['operation'] })
      .find((q) => (q.queryKey[1] as { project?: string }).project === 'all')
    expect(stale?.state.data).toBeUndefined()
    h.unmount()
  })
})

describe('results screen (ticket 30)', () => {
  it('renders the outcome summary, findings split and evidence from the typed read', async () => {
    const h = mountTab(ResultsTab, 'OP-014')
    expect(await screen.findByText('Provisional')).toBeInTheDocument()
    expect(screen.getByText(/The operation has not ended and 1 branch\(es\) already failed \(BR-014-03\)/)).toBeInTheDocument()
    expect(screen.getByText('Findings (1)')).toBeInTheDocument()
    expect(screen.getAllByText('FD-011').length).toBeGreaterThan(0)
    expect(screen.getByText('Proposed findings (AI suggested)')).toBeInTheDocument()
    expect(screen.getByText('Operation evidence')).toBeInTheDocument()
    expect(screen.getAllByText('EV-014-01').length).toBeGreaterThan(0)
    h.unmount()
  })

  it('technique and finding links resolve to migrated routes with the project scope kept', async () => {
    const h = mountTab(ResultsTab, 'OP-014')
    h.run(() => selectProject('RT-2026-014'))
    await screen.findByText('Provisional')
    fireEvent.click(screen.getByRole('button', { name: 'T1082' }))
    await waitFor(() => expect(currentRoute().page).toBe('technique'))
    expect(currentRoute().id).toBe('T1082')
    expect(useProjectStore.getState().pid).toBe('RT-2026-014')
    fireEvent.click(screen.getAllByRole('button', { name: 'FD-011' })[0]!)
    await waitFor(() => expect(currentRoute().page).toBe('finding'))
    expect(currentRoute().id).toBe('FD-011')
    expect(useProjectStore.getState().pid).toBe('RT-2026-014')
    h.unmount()
  })

  it('masks sensitive evidence output for a role without the view-sensitive permission', async () => {
    const h = mountTab(ResultsTab, 'OP-014', 'Casey Nguyen (Client)')
    await screen.findByText('Provisional')
    const masked = screen.getAllByText(/sensitive data — masked for your role/)
    expect(masked.length).toBeGreaterThan(0)
    expect(screen.getByText('•••••••• (sensitive — masked)')).toBeInTheDocument() // EV-014-02 file name
    h.unmount()
  })
})
