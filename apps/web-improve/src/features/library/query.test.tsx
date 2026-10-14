/**
 * Ticket 52: playbook library + technique detail on typed services — the
 * library list with kind/status/search/OS filters, pagination and the
 * approved-version vs pending-revision distinction, playbook detail showing
 * the active (approved) version read-only with the pending-revision banner,
 * technique detail resolving from playbook step/technique references with
 * scoped projections, non-member denial without existence leaks, and the
 * legacy→Query bridge (a legacy playbook-state change appears in the new
 * views without a reload). Plus focused handler tests for the sharing-scope
 * visibility rule, filters, page clamping and scoped projections.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { mountServices } from '../../test/helpers'
import { go, selectProject, useRoute } from '../../router/navigate'
import type { RequestContext } from '../../domain/service'
import { routes } from '../../screens/d'
import { seed } from '../../data'
import { decideRevision, getPlaybook, getTechnique, listLibrary, submitForReview } from './service'

beforeEach(() => { window.location.hash = '' })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

/**
 * Mounts the providers with a probe plus a minimal route host (the store's
 * route projection picks the screen record), so deep links and cross-page
 * `go()` navigation behave like the real app. The initial hash seeds the
 * entry route; `show()` is separate so tests can prepare state first.
 */
function mountLibrary(me = 'Alex Morgan', hash = '#/playbooks') {
  window.location.hash = hash
  const Host = () => {
    const route = useRoute()
    const C = routes[route.page]
    return C ? <C /> : null
  }
  const h = mountServices(null, me)
  return { ...h, show: () => h.show(<Host />) }
}

describe('playbook library (ticket 52)', () => {
  it('renders active-version cards that distinguish approved versions from pending revisions', async () => {
    const h = mountLibrary()
    h.show()
    await waitFor(() => expect(screen.getByText('PB-001 · v2.3')).toBeInTheDocument())
    expect(screen.getByText('v2.4 pending review · v2.3 stays approved')).toBeInTheDocument()
    expect(screen.getByText('PB-004 · v0.9')).toBeInTheDocument()
    expect(screen.getByText('Draft: Preview Draft only, not usable in operations')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Playbooks4' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Adversary profiles1' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'MITRE ATT&CK techniques22' })).toBeInTheDocument()
    expect(screen.getByText('4 records')).toBeInTheDocument()
    h.unmount()
  })

  it('kind tabs, search, status and OS filters narrow the scoped rows', async () => {
    const h = mountLibrary()
    h.show()
    await waitFor(() => expect(screen.getByText('PB-001 · v2.3')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('tab', { name: 'Adversary profiles1' }))
    await waitFor(() => expect(screen.getByText('AP-01 · v1.0')).toBeInTheDocument())
    expect(screen.queryByText('PB-001 · v2.3')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Playbooks4' }))
    await waitFor(() => expect(screen.getByText('PB-001 · v2.3')).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText('Search name, ID or goal'), { target: { value: 'lateral' } })
    await waitFor(() => expect(screen.getByText('PB-004 · v0.9')).toBeInTheDocument())
    expect(screen.queryByText('PB-001 · v2.3')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    await waitFor(() => expect(screen.getByText('PB-001 · v2.3')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'approved' } })
    await waitFor(() => expect(screen.getByText('3 records')).toBeInTheDocument())
    expect(screen.queryByText('PB-004 · v0.9')).not.toBeInTheDocument()
    h.unmount()
  })

  it('paginates the scoped rows across pages', async () => {
    const h = mountLibrary()
    h.show()
    await waitFor(() => expect(screen.getByText('4 records')).toBeInTheDocument())
    expect(screen.queryByText('Page 1 of 2')).not.toBeInTheDocument()
    h.run(() => h.svc().authority.commit('test', (d) => {
      for (let i = 0; i < 12; i++) d.playbooks.push({ id: `PB-9${String(i).padStart(2, '0')}`, name: `Generated playbook ${i}`, kind: 'playbook', version: '1.0', owner: 'Red Team', status: 'approved', os: ['Windows'], techniques: ['T1082'], steps: ['One generated step'], desc: 'Generated for the pagination check.', goal: 'Test pagination', updated: 'Oct 13, 2026', share: 'Organization' })
    }))
    await waitFor(() => expect(screen.getByText('Page 1 of 2')).toBeInTheDocument())
    expect(screen.queryByText('PB-911 · v1.0')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(screen.getByText('PB-911 · v1.0')).toBeInTheDocument())
    h.unmount()
  })

  it('a legacy playbook-state change appears in the new views without a reload', async () => {
    const h = mountLibrary()
    h.show()
    await waitFor(() => expect(screen.getByText('PB-004 · v0.9')).toBeInTheDocument())
    expect(screen.getByText('Draft, not usable yet')).toBeInTheDocument()
    h.run(() => { expect(submitForReview(h.svc().authority, h.svc().clock, { actor: { id: 'Alex Morgan', role: 'manager' }, projectId: 'all', corr: 'library-submit' }, 'PB-004').ok).toBe(true) })
    await waitFor(() => expect(screen.getByText('In review')).toBeInTheDocument())
    h.run(() => { expect(decideRevision(h.svc().authority, h.svc().clock, { actor: { id: 'Pat Kim', role: 'reviewer' }, projectId: 'all', corr: 'library-decide' }, 'PB-001', 'approve', 'Independent review confirms the new steps').ok).toBe(true) })
    await waitFor(() => expect(screen.getByText('PB-001 · v2.4')).toBeInTheDocument())
    expect(screen.queryByText('v2.4 pending review · v2.3 stays approved')).not.toBeInTheDocument()
    h.unmount()
  })

  it('hides project-shared and team-internal playbooks from a non-member, denying the deep link without leaking existence', async () => {
    const h = mountLibrary('Riley Brooks') // analyst — member of RT-2026-014 only
    h.show()
    await waitFor(() => expect(screen.getByText('PB-001 · v2.3')).toBeInTheDocument())
    expect(screen.queryByText('PB-003 · v1.1')).not.toBeInTheDocument() // shared with RT-2026-015
    expect(screen.queryByText('PB-004 · v0.9')).not.toBeInTheDocument() // team-internal
    expect(screen.getByText('2 records')).toBeInTheDocument()
    h.run(() => go('playbook', { id: 'PB-003' }))
    await waitFor(() => expect(screen.getByText('Playbook not found')).toBeInTheDocument())
    expect(screen.getByText('No playbook “PB-003”')).toBeInTheDocument()
    h.unmount()
  })
})

describe('playbook detail (ticket 52)', () => {
  it('shows the approved version read-only with the pending-revision banner and scoped usage', async () => {
    const h = mountLibrary('Alex Morgan', '#/playbook/PB-001')
    h.show()
    await waitFor(() => expect(screen.getByText('v2.4 is pending review')).toBeInTheDocument())
    expect(screen.getByText('Steps (12)')).toBeInTheDocument()
    expect(screen.getByText(/v2.3 is the approved version and stays in use; it is read-only/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Review Playbook v2.4' })).toBeInTheDocument()
    expect(screen.getAllByText('OP-014').length).toBeGreaterThan(0)
    expect(screen.getByText('PL-021')).toBeInTheDocument()
    expect(screen.getAllByText(/pins v2.3/).length).toBeGreaterThan(0)
    expect(screen.getByText('RT-2026-014')).toBeInTheDocument()
    h.unmount()
  })

  it('a draft playbook cannot be used in operations and offers the read-only preview instead', async () => {
    const h = mountLibrary('Alex Morgan', '#/playbook/PB-004')
    h.show()
    await waitFor(() => expect(screen.getByText('Draft: cannot be used yet')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Preview Draft' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Use in operation' })).not.toBeInTheDocument()
    h.unmount()
  })

  it('approving the pending revision through the legacy review action activates it in the detail', async () => {
    const h = mountLibrary('Alex Morgan', '#/playbook/PB-001')
    h.show()
    await waitFor(() => expect(screen.getByText('Steps (12)')).toBeInTheDocument())
    h.run(() => { expect(decideRevision(h.svc().authority, h.svc().clock, { actor: { id: 'Pat Kim', role: 'reviewer' }, projectId: 'all', corr: 'library-decide' }, 'PB-001', 'approve', 'Independent review confirms the new steps').ok).toBe(true) })
    await waitFor(() => expect(screen.getByText('Steps (13)')).toBeInTheDocument())
    expect(screen.queryByText('v2.4 is pending review')).not.toBeInTheDocument()
    h.unmount()
  })

  it('technique references in steps resolve to the technique detail route', async () => {
    const h = mountLibrary('Alex Morgan', '#/playbook/PB-003')
    h.show()
    await waitFor(() => expect(screen.getByText('Related ATT&CK techniques')).toBeInTheDocument())
    fireEvent.click(screen.getByTitle('System Information Discovery'))
    await waitFor(() => expect(screen.getAllByText('T1082').length).toBeGreaterThan(0))
    expect(screen.getByText('Related playbooks')).toBeInTheDocument()
    expect(screen.getAllByText('PB-003').length).toBeGreaterThan(0)
    expect(screen.getAllByText('OP-014').length).toBeGreaterThan(0)
    expect(screen.getAllByText('OP-015').length).toBeGreaterThan(0)
    h.unmount()
  })
})

describe('technique detail (ticket 52)', () => {
  it('a non-member specific-project read yields an empty projection, never the project data', async () => {
    const h = mountLibrary('Riley Brooks')
    h.show()
    await waitFor(() => expect(screen.getByText('PB-001 · v2.3')).toBeInTheDocument())
    h.run(() => { selectProject('RT-2026-015'); go('technique', { id: 'T1046' }) })
    await waitFor(() => expect(screen.getByText('No test data yet')).toBeInTheDocument())
    expect(screen.queryByText('OP-015')).not.toBeInTheDocument()
    h.unmount()
  })

  it('an unknown catalog id renders the not-found state', async () => {
    const h = mountLibrary('Alex Morgan', '#/technique/T9999')
    h.show()
    await waitFor(() => expect(screen.getByText('Technique not found')).toBeInTheDocument())
    expect(screen.getByText('No technique “T9999”')).toBeInTheDocument()
    h.unmount()
  })
})

describe('listLibrary handler', () => {
  const alex = { id: 'Alex Morgan', role: 'manager' as const }
  const riley = { id: 'Riley Brooks', role: 'analyst' as const }
  const pat = { id: 'Pat Kim', role: 'reviewer' as const }
  const ctx = (actor: { id: string; role: 'manager' | 'analyst' | 'reviewer' }, projectId = 'all'): RequestContext => ({ actor, projectId, corr: 't' })

  it('the sharing rule scopes the library: organization-wide visible, project-shared to members, team-internal to elevated roles', () => {
    const all = listLibrary(seed(), ctx(alex))
    expect(all.ok && all.data.total).toBe(4)
    const limited = listLibrary(seed(), ctx(riley))
    expect(limited.ok && limited.data.total).toBe(2)
    expect(limited.ok && limited.data.items.every(({ playbook }) => playbook.share === 'Organization')).toBe(true)
    const reviewer = listLibrary(seed(), ctx(pat))
    expect(reviewer.ok && reviewer.data.total).toBe(4)
  })

  it('filters apply on top of the visible base and tab badge counts stay unfiltered', () => {
    const d = seed()
    const approved = listLibrary(d, ctx(alex), { status: 'approved' })
    expect(approved.ok && approved.data.total).toBe(3)
    const lateral = listLibrary(d, ctx(alex), { tactic: 'Lateral Movement' })
    expect(lateral.ok && lateral.data.items.map((i) => i.playbook.id).sort()).toEqual(['PB-001', 'PB-004'])
    const linux = listLibrary(d, ctx(alex), { os: 'Linux' })
    expect(linux.ok && linux.data.total).toBe(3)
    const badges = listLibrary(d, ctx(alex), { status: 'draft' })
    expect(badges.ok && badges.data.counts).toEqual({ playbooks: 4, profiles: 1, techniques: 22 })
  })

  it('pending revisions decorate the active version and never count as separate items', () => {
    const res = listLibrary(seed(), ctx(alex))
    expect(res.ok).toBe(true)
    if (res.ok) {
      const pb1 = res.data.items.find((i) => i.playbook.id === 'PB-001')
      expect(pb1?.playbook.version).toBe('2.3')
      expect(pb1?.pendingRevision?.version).toBe('2.4')
      expect(pb1?.pendingRevision?.by).toBe('Jordan Lee')
      expect(res.data.total).toBe(4)
    }
  })

  it('the detection overlay is present for an accessible specific project and absent otherwise', () => {
    const scoped = listLibrary(seed(), ctx(alex, 'RT-2026-014'))
    expect(scoped.ok && scoped.data.detection?.T1082).toBe('detected')
    const aggregate = listLibrary(seed(), ctx(alex, 'all'))
    expect(aggregate.ok && aggregate.data.detection).toBeUndefined()
    const denied = listLibrary(seed(), ctx(riley, 'RT-2026-015'))
    expect(denied.ok && denied.data.detection).toBeUndefined()
  })

  it('clamps out-of-range pages into the valid range', () => {
    const high = listLibrary(seed(), ctx(alex), { page: 99 })
    const low = listLibrary(seed(), ctx(alex), { page: 0 })
    expect(high.ok && low.ok).toBe(true)
    if (high.ok && low.ok) {
      expect(high.data.page).toBe(1)
      expect(low.data.page).toBe(1)
    }
  })
})

describe('getPlaybook handler', () => {
  const alex = { id: 'Alex Morgan', role: 'manager' as const }
  const riley = { id: 'Riley Brooks', role: 'analyst' as const }

  it('describes the active version, tactics, versions and scoped usage', () => {
    const res = getPlaybook(seed(), { actor: alex, projectId: 'all', corr: 't' }, 'PB-001')
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.playbook.id).toBe('PB-001')
      expect(res.data.approved).toBe(true)
      expect(res.data.pending).toBe(true)
      expect(res.data.pendingRevision?.version).toBe('2.4')
      expect(res.data.playbook.steps).toHaveLength(12)
      expect(res.data.usage.operations.map((o) => o.id)).toEqual(['OP-014', 'OP-016', 'OP-009'])
      expect(res.data.usage.plans.map((p) => p.id)).toEqual(['PL-021', 'PL-020', 'PL-023'])
      expect(res.data.usedProjects).toEqual([
        { id: 'RT-2026-014', operations: ['OP-014'] },
        { id: 'RT-2026-016', operations: ['OP-016'] },
        { id: 'RT-2026-009', operations: ['OP-009'] },
      ])
      expect(res.data.tactics.length).toBeGreaterThan(0)
      expect(res.data.versions[0].title).toContain('approved')
    }
  })

  it('a playbook outside the sharing scope is not-found with no existence leak', () => {
    const shared = getPlaybook(seed(), { actor: riley, projectId: 'RT-2026-014', corr: 't' }, 'PB-003')
    expect(shared.ok).toBe(false)
    if (!shared.ok) expect(shared.failure.kind).toBe('not-found')
    const team = getPlaybook(seed(), { actor: riley, projectId: 'all', corr: 't' }, 'PB-004')
    expect(team.ok).toBe(false)
    if (!team.ok) expect(team.failure.kind).toBe('not-found')
    const missing = getPlaybook(seed(), { actor: alex, projectId: 'all', corr: 't' }, 'PB-999')
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.failure.kind).toBe('not-found')
  })

  it('the attach-compat projection follows the accessible active project', () => {
    // The compat card describes the active project context (legacy semantics),
    // not the playbook's own share scope.
    const scoped = getPlaybook(seed(), { actor: alex, projectId: 'RT-2026-014', corr: 't' }, 'PB-003')
    expect(scoped.ok && scoped.data.compat?.projectId).toBe('RT-2026-014')
    const member = getPlaybook(seed(), { actor: { id: 'Sam Patel', role: 'manager' }, projectId: 'RT-2026-015', corr: 't' }, 'PB-003')
    expect(member.ok && member.data.compat?.projectId).toBe('RT-2026-015')
    const aggregate = getPlaybook(seed(), { actor: alex, projectId: 'all', corr: 't' }, 'PB-001')
    expect(aggregate.ok && aggregate.data.compat).toBeUndefined()
    const denied = getPlaybook(seed(), { actor: riley, projectId: 'RT-2026-015', corr: 't' }, 'PB-001')
    expect(denied.ok && denied.data.compat).toBeUndefined()
  })
})

describe('getTechnique handler', () => {
  const alex = { id: 'Alex Morgan', role: 'manager' as const }
  const riley = { id: 'Riley Brooks', role: 'analyst' as const }

  it('aggregates scoped steps, findings and playbooks for the accessible projects', () => {
    const res = getTechnique(seed(), { actor: alex, projectId: 'all', corr: 't' }, 'T1046')
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.steps.map((s) => s.opId).sort()).toEqual(['OP-009', 'OP-014', 'OP-015', 'OP-016'])
      expect(res.data.findings.map((f) => f.id)).toEqual(['FD-012', 'FD-009'])
      expect(res.data.playbooks.map((p) => p.id)).toEqual(['PB-001', 'PB-003'])
      expect(res.data.siem).toEqual({ connected: true, name: 'SIEM-Lab' })
      expect(res.data.detection.length).toBeGreaterThan(0)
    }
  })

  it('a non-member specific-project read yields empty projections, never the project data', () => {
    const denied = getTechnique(seed(), { actor: riley, projectId: 'RT-2026-015', corr: 't' }, 'T1046')
    expect(denied.ok).toBe(true)
    if (denied.ok) {
      expect(denied.data.steps).toEqual([])
      expect(denied.data.findings).toEqual([])
      expect(denied.data.detection).toEqual([])
    }
    const member = getTechnique(seed(), { actor: { id: 'Sam Patel', role: 'manager' }, projectId: 'RT-2026-015', corr: 't' }, 'T1046')
    expect(member.ok && member.data.steps.map((s) => s.opId)).toEqual(['OP-015'])
  })

  it('an unknown catalog id is not-found', () => {
    const res = getTechnique(seed(), { actor: alex, projectId: 'all', corr: 't' }, 'T9999')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.failure.kind).toBe('not-found')
  })
})
