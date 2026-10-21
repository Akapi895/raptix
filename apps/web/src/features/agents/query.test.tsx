/**
 * Ticket 48: agent fleet + health detail on typed services — accessible-only
 * scoping (pool agents always visible, assigned agents only within their
 * project), pool/project fleet modes with KPI filters and pagination,
 * detail health/capabilities/history as observed state, RBAC gates with
 * reasons, the legacy→Query bridge (a legacy agent-state change appears in
 * the new detail without a reload) and late-response isolation on project
 * switch. Plus focused handler tests for the denial/clamp edges.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { mountServices } from '../../test/helpers'
import { go, selectProject } from '../../router/navigate'
import { assignAgentTransaction } from './writes'
import { loseAgent, restoreAgent } from '../../demo/runtime'
import type { RequestContext } from '../../domain/service'
import { routes } from '../../screens/d'
import { seed } from '../../demo/seed';
import { getAgent, listAgents } from './service'

beforeEach(() => { window.location.hash = '' })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

/**
 * Mounts the providers with a probe, then optionally mounts a real agent
 * route. `show()` is separate so tests can install service spies before the
 * first query fires.
 */
function mountAgents(page: 'agents' | 'agent', me = 'Alex Morgan') {
  const Screen = routes[page]
  const h = mountServices(null, me)
  return { ...h, show: () => h.show(<Screen />) }
}

describe('agent fleet (ticket 48)', () => {
  it('renders only accessible agents in the project tab; pool agents are shared inventory', async () => {
    const h = mountAgents('agents', 'Riley Brooks') // analyst — member of RT-2026-014 only
    h.show()
    await waitFor(() => expect(screen.getByText('WIN-LAB-01')).toBeInTheDocument())
    expect(screen.getByText('Showing all 3 records')).toBeInTheDocument()
    expect(screen.queryByText('CLOUD-LAB-01')).not.toBeInTheDocument() // RT-2026-015 — not a member
    expect(screen.queryByText('RETAIL-LAB-01')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Shared Pool/ }))
    await waitFor(() => expect(screen.getByText('POOL-LAB-01')).toBeInTheDocument())
    expect(screen.getByText('POOL-LAB-02')).toBeInTheDocument()
    expect(screen.getByText('Showing all 2 records')).toBeInTheDocument()
    h.unmount()
  })

  it('distinguishes pool from assigned rows per project scope, with live tab badges', async () => {
    const h = mountAgents('agents')
    h.show()
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Project Agents7' })).toBeInTheDocument())
    expect(screen.queryByText('POOL-LAB-01')).not.toBeInTheDocument()
    h.run(() => selectProject('RT-2026-014'))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Project Agents3' })).toBeInTheDocument())
    expect(screen.getAllByText('WIN-LAB-01').length).toBeGreaterThan(0)
    expect(screen.queryByText('CLOUD-LAB-01')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Shared Pool2' }))
    await waitFor(() => expect(screen.getByText('POOL-LAB-01')).toBeInTheDocument())
    h.unmount()
  })

  it('renders observed-health sparklines in the connectivity tab for the scoped base', async () => {
    const h = mountAgents('agents', 'Riley Brooks')
    h.show()
    fireEvent.click(screen.getByRole('tab', { name: /Connectivity/ }))
    await waitFor(() => expect(screen.getAllByRole('img', { name: /Heartbeat/ }).length).toBeGreaterThan(0))
    expect(screen.getAllByText('AG-009').length).toBeGreaterThan(0) // lost agent of RT-2026-014
    expect(screen.getByRole('img', { name: 'Heartbeat missing for the most recent samples' })).toBeInTheDocument()
    expect(screen.queryByText('CLOUD-LAB-02')).not.toBeInTheDocument()
    h.unmount()
  })

  it('KPI pills filter the scoped rows between available and busy agents', async () => {
    const h = mountAgents('agents')
    h.show()
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Project Agents7' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('tab', { name: 'Shared Pool2' }))
    await waitFor(() => expect(screen.getByText('POOL-LAB-01')).toBeInTheDocument())
    // Pool KPI: connected, unassigned, unreserved — both pool agents initially.
    fireEvent.click(screen.getByRole('button', { name: /Available in Shared Pool/ }))
    await waitFor(() => expect(screen.getByText('Showing all 2 records')).toBeInTheDocument())
    h.run(() => { expect(assignAgentTransaction(h.svc().authority, h.svc().clock, { actor: { id: 'Alex Morgan', role: 'manager' }, projectId: 'RT-2026-014', corr: 'assignment-refetch' }, 'AG-012', { projectId: 'RT-2026-014' }).ok).toBe(true) })
    await waitFor(() => expect(screen.getByText('Showing all 1 record')).toBeInTheDocument())
    expect(screen.getByText('POOL-LAB-02')).toBeInTheDocument()
    expect(screen.queryByText('POOL-LAB-01')).not.toBeInTheDocument()
    h.unmount()
  })

  it('paginates the scoped rows across pages', async () => {
    const h = mountAgents('agents')
    h.show()
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Project Agents7' })).toBeInTheDocument())
    expect(screen.queryByText('Page 1 of 2')).not.toBeInTheDocument()
    h.run(() => h.svc().authority.commit('test', (d) => {
      for (let i = 0; i < 12; i++) d.agents.push({ id: `AG-9${String(i).padStart(2, '0')}`, host: `LAB-9${i}`, os: 'Windows', version: '5.2.1', projectId: 'RT-2026-014', status: 'online', lastSeen: 'Oct 13, 2026, 10:42 AM (UTC+7)', op: null, group: '', conn: 'HTTPS (simulated)', ip: `203.0.113.9${i}` })
    }))
    await waitFor(() => expect(screen.getByText('Page 1 of 2')).toBeInTheDocument())
    expect(screen.queryByText('LAB-99')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(screen.getByText('LAB-99')).toBeInTheDocument())
    h.unmount()
  })

  it('shows an error state instead of data when the selected project is out of scope', async () => {
    const h = mountAgents('agents', 'Riley Brooks')
    h.show()
    await waitFor(() => expect(screen.getByText('WIN-LAB-01')).toBeInTheDocument())
    h.run(() => selectProject('RT-2026-015'))
    await waitFor(() => expect(screen.getByText('Agents could not be loaded')).toBeInTheDocument())
    expect(screen.getByText('Agents for this project are not available for your account.')).toBeInTheDocument()
    expect(screen.queryByText('CLOUD-LAB-01')).not.toBeInTheDocument()
    h.unmount()
  })
})

describe('agent detail (ticket 48)', () => {
  it('describes observed health, capabilities and history for an assigned agent', async () => {
    const h = mountAgents('agent')
    h.show()
    h.run(() => go('agent', { id: 'AG-007' }))
    await waitFor(() => expect(screen.getAllByText('WIN-LAB-01').length).toBeGreaterThan(0))
    expect(screen.getAllByText('192.0.2.21').length).toBeGreaterThan(0)
    expect(screen.getAllByText('5.2.1').length).toBeGreaterThan(0)
    expect(screen.getByText(/Reserved by/)).toBeInTheDocument()
    expect(screen.getByText(/Assigned to/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Connectivity/ }))
    await waitFor(() => expect(screen.getByRole('img', { name: 'Heartbeat, last 24 samples' })).toBeInTheDocument())
    expect(screen.getByText('Average latency')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Event History/ }))
    await waitFor(() => expect(screen.getByText(/Latest heartbeat \(normal\)/)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('tab', { name: /Operations & Sessions/ }))
    await waitFor(() => expect(screen.getByText('SS-041')).toBeInTheDocument())
    expect(screen.getByText('OP-013')).toBeInTheDocument()
    h.unmount()
  })

  it('a pool agent is readable in any scope and shows the pool banner and eligible projects', async () => {
    const h = mountAgents('agent')
    h.show()
    h.run(() => { selectProject('RT-2026-014'); go('agent', { id: 'AG-012' }) })
    await waitFor(() => expect(screen.getAllByText('POOL-LAB-01').length).toBeGreaterThan(0))
    expect(screen.getByText('Agent is not assigned to a project')).toBeInTheDocument()
    expect(screen.getByText('RT-2026-014, RT-2026-015, RT-2026-016')).toBeInTheDocument()
    h.unmount()
  })

  it('refuses an assigned agent outside the active project context with a switch action', async () => {
    const h = mountAgents('agent', 'Taylor Chen')
    h.show()
    h.run(() => { selectProject('RT-2026-015'); go('agent', { id: 'AG-007' }) })
    await waitFor(() => expect(screen.getByText('Agent belongs to a different project')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'View all projects' })).toBeInTheDocument()
    expect(screen.queryByText('192.0.2.21')).not.toBeInTheDocument()
    h.unmount()
  })

  it('an agent in a project without a membership grant is not found', async () => {
    const h = mountAgents('agent', 'Riley Brooks')
    h.show()
    h.run(() => go('agent', { id: 'AG-010' }))
    await waitFor(() => expect(screen.getByText('Agent not found')).toBeInTheDocument())
    h.unmount()
  })

  it('gates agent management behind role and read-only context with reasons', async () => {
    const h = mountAgents('agent', 'Casey Nguyen (Client)') // viewer — member of RT-2026-014
    h.show()
    h.run(() => { selectProject('RT-2026-014'); go('agent', { id: 'AG-007' }) })
    await waitFor(() => expect(screen.getAllByText('WIN-LAB-01').length).toBeGreaterThan(0))
    const disable = screen.getByRole('button', { name: 'Disable Agent' }) as HTMLButtonElement
    expect(disable.disabled).toBe(true)
    expect(disable.title).toBe('The Viewer role has read-only access.')
    expect(screen.getByText('Disable / enable: The Viewer role has read-only access.')).toBeInTheDocument()
    h.unmount()
    const a = mountAgents('agent', 'Riley Brooks') // analyst — can view, cannot manage
    a.show()
    a.run(() => { selectProject('RT-2026-014'); go('agent', { id: 'AG-007' }) })
    await waitFor(() => expect(screen.getAllByText('WIN-LAB-01').length).toBeGreaterThan(0))
    const disable2 = screen.getByRole('button', { name: 'Disable Agent' }) as HTMLButtonElement
    expect(disable2.disabled).toBe(true)
    expect(disable2.title).toBe('Only Admins can disable or enable agents.')
    a.unmount()
  })

  it('a legacy agent-state change appears in the new detail without a reload', async () => {
    const h = mountAgents('agent')
    h.show()
    h.run(() => go('agent', { id: 'AG-007' }))
    await waitFor(() => expect(screen.getAllByText('WIN-LAB-01').length).toBeGreaterThan(0))
    expect(screen.getAllByText('Connected').length).toBeGreaterThan(0)
    h.run(() => loseAgent('AG-007'))
    await waitFor(() => expect(screen.getAllByText('Disconnected').length).toBeGreaterThan(0))
    expect(screen.getByText(/Health failure: AG-007/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Event History/ }))
    await waitFor(() => expect(screen.getByText(/Agent disconnected — Alex Morgan/)).toBeInTheDocument())
    expect(screen.getByText('Disconnected — last heartbeat recorded')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Connectivity/ }))
    await waitFor(() => expect(screen.getByRole('img', { name: 'Heartbeat missing for the most recent samples' })).toBeInTheDocument())
    h.run(() => restoreAgent('AG-007'))
    await waitFor(() => expect(screen.getAllByText('Connected').length).toBeGreaterThan(0))
    h.unmount()
  })

  it('a delayed response for a superseded scope never pollutes the switched view', async () => {
    let resolveGate!: () => void
    const gate = new Promise<void>((r) => { resolveGate = r })
    const h = mountAgents('agents')
    const svc = h.svc()
    const orig = svc.agents.bind(svc)
    vi.spyOn(svc, 'agents').mockImplementation((actor, project) => {
      const inner = orig(actor, project)
      if (project !== 'all') return inner
      return { ...inner, list: async (ctx, query) => { await gate; return inner.list(ctx, query) } }
    })
    h.show()
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument())
    h.run(() => selectProject('RT-2026-014'))
    await waitFor(() => expect(screen.getAllByText('WIN-LAB-01').length).toBeGreaterThan(0))
    await act(async () => { resolveGate(); await Promise.resolve() })
    expect(screen.getAllByText('WIN-LAB-01').length).toBeGreaterThan(0)
    expect(screen.queryByText('CLOUD-LAB-01')).not.toBeInTheDocument()
    const stale = h.qc().getQueryCache().findAll({ queryKey: ['agent'] })
      .find((q) => (q.queryKey[1] as { project?: string }).project === 'all')
    expect(stale?.state.data).toBeUndefined()
    h.unmount()
  })
})

describe('listAgents handler', () => {
  const alex = { id: 'Alex Morgan', role: 'manager' as const }
  const allCtx: RequestContext = { actor: alex, projectId: 'all', corr: 't' }

  it('denies a non-member specific-project read without leaking existence', () => {
    const riley = { id: 'Riley Brooks', role: 'analyst' as const }
    const res = listAgents(seed(), { actor: riley, projectId: 'RT-2026-015', corr: 't' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.failure.kind).toBe('not-found')
  })

  it('pool mode returns only unassigned agents; project mode only assigned ones', () => {
    const d = seed()
    const pool = listAgents(d, allCtx, { mode: 'pool' })
    const assigned = listAgents(d, allCtx, { mode: 'project' })
    expect(pool.ok && assigned.ok).toBe(true)
    if (pool.ok && assigned.ok) {
      expect(pool.data.items.map((i) => i.agent.id)).toEqual(['AG-012', 'AG-013'])
      expect(assigned.data.items.every((i) => i.agent.projectId !== '')).toBe(true)
      expect(assigned.data.total).toBe(7)
    }
  })

  it('KPI filters distinguish reserved (busy) from available pool agents', () => {
    const d = seed()
    const busy = listAgents(d, allCtx, { mode: 'pool', kpi: 'busy' })
    const avail = listAgents(d, allCtx, { mode: 'pool', kpi: 'avail' })
    expect(busy.ok && avail.ok).toBe(true)
    if (busy.ok && avail.ok) {
      expect(busy.data.items).toEqual([])
      expect(avail.data.items.map((i) => i.agent.id)).toEqual(['AG-012', 'AG-013'])
      expect(avail.data.kpis.busy).toBe(3) // AG-007/AG-008 reserved by OP-014, AG-010 by OP-015
    }
  })

  it('decorates rows with in-scope active sessions and pending assignment approvals', () => {
    const d = seed()
    d.approvals.unshift({ id: 'APR-T48', projectId: 'RT-2026-014', type: 'Agent assignment (request)', by: 'Taylor Chen', reviewer: 'Pat Kim', at: d.agents[0].lastSeen, status: 'pending', note: '', diff: 'AG-012 → RT-2026-014' })
    const res = listAgents(d, allCtx, { mode: 'pool' })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.items.find((i) => i.agent.id === 'AG-012')?.pendingAssignment?.id).toBe('APR-T48')
      expect(res.data.items.find((i) => i.agent.id === 'AG-013')?.pendingAssignment).toBeUndefined()
    }
    const sessions = listAgents(d, { actor: alex, projectId: 'RT-2026-014', corr: 't' }, { mode: 'project' })
    expect(sessions.ok).toBe(true)
    if (sessions.ok) {
      expect(sessions.data.items.find((i) => i.agent.id === 'AG-007')?.sessions).toBe(1)
      expect(sessions.data.items.find((i) => i.agent.id === 'AG-009')?.sessions).toBe(0)
    }
  })

  it('clamps out-of-range pages into the valid range', () => {
    const high = listAgents(seed(), allCtx, { mode: 'project', page: 99 })
    const low = listAgents(seed(), allCtx, { mode: 'project', page: 0 })
    expect(high.ok && low.ok).toBe(true)
    if (high.ok && low.ok) {
      expect(high.data.page).toBe(1)
      expect(low.data.page).toBe(1)
    }
  })
})

describe('getAgent handler', () => {
  const alex = { id: 'Alex Morgan', role: 'manager' as const }

  it('scopes history, sessions and branches to the request context', () => {
    const d = seed()
    d.audit.unshift({ id: 'AU-T48', at: d.agents[0].lastSeen, actor: 'Sam Patel', role: 'Red Team Manager', action: 'Touched cross-project object', obj: 'AG-007', projectId: 'RT-2026-015', result: 'Success', reason: '' })
    const res = getAgent(d, { actor: alex, projectId: 'RT-2026-014', corr: 't' }, 'AG-007')
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.agent.id).toBe('AG-007')
      expect(res.data.project?.id).toBe('RT-2026-014')
      expect(res.data.operations.map((o) => o.id)).toEqual(['OP-014', 'OP-013'])
      expect(res.data.activeSessions.map((s) => s.id)).toEqual(['SS-041'])
      // The cross-project audit entry mentioning AG-007 is never leaked.
      expect(res.data.history.some((h) => h.title.includes('Touched cross-project object'))).toBe(false)
      expect(res.data.history.some((h) => h.title.startsWith('Latest heartbeat'))).toBe(true)
    }
  })

  it('refuses an assigned agent outside the active context with the owning project on the entity', () => {
    const res = getAgent(seed(), { actor: { id: 'Taylor Chen', role: 'operator' }, projectId: 'RT-2026-015', corr: 't' }, 'AG-007')
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.failure.kind).toBe('forbidden')
      expect(res.failure.entity?.projectId).toBe('RT-2026-014')
    }
  })

  it('an agent in an inaccessible project is not-found; a pool agent is readable anywhere', () => {
    const riley = { id: 'Riley Brooks', role: 'analyst' as const }
    const denied = getAgent(seed(), { actor: riley, projectId: 'all', corr: 't' }, 'AG-010')
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.failure.kind).toBe('not-found')
    const pool = getAgent(seed(), { actor: riley, projectId: 'RT-2026-014', corr: 't' }, 'AG-012')
    expect(pool.ok).toBe(true)
    if (pool.ok) expect(pool.data.project).toBeUndefined()
  })
})
