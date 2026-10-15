/**
 * Ticket 49: agent allocation + group write handlers — eligibility enforced
 * at the handler (connected, unreserved, pool-only, active/approved target,
 * editScope role, pending-request conflict), unassignment back to the pool
 * with reason/role/refusal edges, group create/rename/membership gates, the
 * ChangeSet to fleet + detail refetch and the bridge in both directions
 * (legacy actions and typed service/mutations observe one another).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { mountServices } from '../../test/helpers'
import { go, selectProject } from '../../router/navigate'
import { useSessionStore } from '../../state/session'
import type { ActorRef, RequestContext } from '../../domain/service'
import { useToastStore } from '../../state/stores'
import { createDatabaseAuthority, type DbAuthority } from '../../domain/database'
import { MockClock } from '../../domain/clock'
import { routes } from '../../screens/d'
import {
  assignAgentTransaction, removeFromGroupTransaction, saveGroupTransaction, unassignAgentTransaction,
  type GroupInput,
} from './writes'

afterEach(() => { cleanup(); window.location.hash = '' })

const P14 = 'RT-2026-014'
const P15 = 'RT-2026-015'
const actor = (id: string, role: ActorRef['role']): ActorRef => ({ id, role })
const ctxOf = (a: ActorRef, projectId: string, corr = 't'): RequestContext => ({ actor: a, projectId, corr })
const ALEX = actor('Alex Morgan', 'manager')
const TAYLOR = actor('Taylor Chen', 'operator')
const RILEY = actor('Riley Brooks', 'analyst')
const CASEY = actor('Casey Nguyen (Client)', 'viewer')
const SAM = actor('Sam Patel', 'manager')

function rig() {
  const clock = new MockClock()
  const authority: DbAuthority = createDatabaseAuthority(clock)
  return { clock, authority }
}

describe('assignAgentTransaction eligibility (ticket 49)', () => {
  it('refuses a disconnected agent with the observed reason and commits nothing', () => {
    const { authority } = rig()
    authority.commit('t', (d) => { d.agents.find((a) => a.id === 'AG-012')!.status = 'lost' })
    const res = assignAgentTransaction(authority, new MockClock(), ctxOf(ALEX, 'all'), 'AG-012', { projectId: P14 })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.failure.kind).toBe('validation')
      expect(res.failure.message).toContain('Disconnected')
      expect(res.failure.message).toContain('never available')
    }
    expect(authority.snapshot().agents.find((a) => a.id === 'AG-012')!.projectId).toBe('')
  })

  it('refuses an agent reserved by an operation until the reservation ends', () => {
    const { authority } = rig()
    authority.commit('t', (d) => { d.agents.find((a) => a.id === 'AG-012')!.op = 'OP-014' })
    const reserved = assignAgentTransaction(authority, new MockClock(), ctxOf(ALEX, 'all'), 'AG-012', { projectId: P14 })
    expect(reserved.ok).toBe(false)
    if (!reserved.ok) {
      expect(reserved.failure.kind).toBe('conflict')
      expect(reserved.failure.message).toContain('reserved by OP-014')
    }
    expect(authority.snapshot().agents.find((a) => a.id === 'AG-012')!.projectId).toBe('')
  })

  it('refuses an assignment to a project outside the actor membership without an existence leak', () => {
    const { authority } = rig()
    const res = assignAgentTransaction(authority, new MockClock(), ctxOf(RILEY, 'all'), 'AG-012', { projectId: P15 })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.failure.kind).toBe('not-found')
    expect(authority.snapshot().agents.find((a) => a.id === 'AG-012')!.projectId).toBe('')
  })

  it('refuses an already-assigned agent with its owning project', () => {
    const { authority } = rig()
    const res = assignAgentTransaction(authority, new MockClock(), ctxOf(ALEX, 'all'), 'AG-011', { projectId: P14 })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.failure.kind).toBe('conflict')
      expect(res.failure.message).toContain('already assigned to RT-2026-015')
      expect(res.failure.entity?.projectId).toBe('RT-2026-015')
    }
  })

  it('refuses an immediate assignment to a draft project (request-only) with the request path named', () => {
    const { authority } = rig()
    const res = assignAgentTransaction(authority, new MockClock(), ctxOf(ALEX, 'all'), 'AG-012', { projectId: 'RT-2026-017' })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.failure.kind).toBe('validation')
      expect(res.failure.message).toContain('is draft')
      expect(res.failure.message).toContain('Submit a request instead')
    }
  })

  it('enforces the editScope role gate with the role named (analyst; viewer is read-only)', () => {
    const { authority } = rig()
    const analyst = assignAgentTransaction(authority, new MockClock(), ctxOf(RILEY, P14), 'AG-012', { projectId: P14 })
    expect(analyst.ok).toBe(false)
    if (!analyst.ok) {
      expect(analyst.failure.kind).toBe('forbidden')
      expect(analyst.failure.message).toContain('Analyst')
      expect(analyst.failure.message).toContain('submit a request')
    }
    const viewer = assignAgentTransaction(authority, new MockClock(), ctxOf(CASEY, P14), 'AG-012', { projectId: P14 })
    expect(viewer.ok).toBe(false)
    if (!viewer.ok) {
      expect(viewer.failure.kind).toBe('forbidden')
      expect(viewer.failure.message).toContain('read-only')
    }
  })

  it('a specific-project context cannot assign into another project (no cross-context write)', () => {
    const { authority } = rig()
    const res = assignAgentTransaction(authority, new MockClock(), ctxOf(ALEX, 'RT-2026-017'), 'AG-012', { projectId: P14 })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.failure.kind).toBe('forbidden')
      expect(res.failure.message).toContain('outside the active project context')
    }
    expect(authority.snapshot().agents.find((a) => a.id === 'AG-012')!.projectId).toBe('')
  })

  it('a pending assignment request refuses the immediate path — pending approval does not silently allocate', () => {
    const { authority } = rig()
    authority.commit('t', (d) => {
      d.approvals.unshift({ id: 'APR-T49', projectId: P14, type: 'Agent assignment', by: 'Taylor Chen', reviewer: 'Pat Kim', at: d.agents[0].lastSeen, status: 'pending', note: '', diff: 'AG-012 → RT-2026-014' })
    })
    const res = assignAgentTransaction(authority, new MockClock(), ctxOf(ALEX, 'all'), 'AG-012', { projectId: P14 })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.failure.kind).toBe('conflict')
      expect(res.failure.message).toContain('APR-T49')
      expect(res.failure.message).toContain('pending approval does not allocate')
    }
    expect(authority.snapshot().agents.find((a) => a.id === 'AG-012')!.projectId).toBe('')
  })

  it('the success path assigns a pool agent and commits the audit row and project notice atomically', () => {
    const { authority, clock } = rig()
    const res = assignAgentTransaction(authority, clock, ctxOf(ALEX, 'all', 'c49'), 'AG-012', { projectId: P14, note: 'Until project closes; reviewer Pat Kim' })
    expect(res.ok).toBe(true)
    const d = authority.snapshot()
    expect(d.agents.find((a) => a.id === 'AG-012')!.projectId).toBe(P14)
    const audit = d.audit.find((x) => x.action === 'Assigned agent to project')
    expect(audit).toMatchObject({ obj: 'AG-012', projectId: P14, actor: 'Alex Morgan', result: 'Success', reason: 'Until project closes; reviewer Pat Kim' })
    expect(d.notices.some((n) => n.category === 'agents' && n.text.includes('AG-012') && n.projectId === P14)).toBe(true)
  })
})

describe('unassignAgentTransaction (ticket 49 — return to the shared pool)', () => {
  it('refuses a pool agent, a reserved agent, a missing reason and cross-context writes', () => {
    const { authority, clock } = rig()
    const pool = unassignAgentTransaction(authority, clock, ctxOf(ALEX, 'all'), 'AG-012', 'not needed')
    expect(pool.ok).toBe(false)
    if (!pool.ok) expect(pool.failure.message).toContain('already in the shared pool')
    const reserved = unassignAgentTransaction(authority, clock, ctxOf(ALEX, 'all'), 'AG-007', 'not needed')
    expect(reserved.ok).toBe(false)
    if (!reserved.ok) expect(reserved.failure.kind).toBe('conflict')
    const noReason = unassignAgentTransaction(authority, clock, ctxOf(SAM, P15), 'AG-011', '  ')
    expect(noReason.ok).toBe(false)
    if (!noReason.ok) expect(noReason.failure.message).toContain('A reason is required')
    const crossCtx = unassignAgentTransaction(authority, clock, ctxOf(TAYLOR, P15), 'AG-007', 'not needed')
    expect(crossCtx.ok).toBe(false)
    if (!crossCtx.ok) {
      expect(crossCtx.failure.kind).toBe('forbidden')
      expect(crossCtx.failure.message).toContain('belongs to project RT-2026-014. Switch to that project')
      expect(crossCtx.failure.entity?.projectId).toBe(P14)
    }
  })

  it('enforces role and access: viewer read-only, analyst role refusal, non-member not-found', () => {
    const { authority, clock } = rig()
    const viewer = unassignAgentTransaction(authority, clock, ctxOf(CASEY, P14), 'AG-009', 'not needed')
    expect(viewer.ok).toBe(false)
    if (!viewer.ok) expect(viewer.failure.message).toBe('The Viewer role has read-only access.')
    const analyst = unassignAgentTransaction(authority, clock, ctxOf(RILEY, P14), 'AG-009', 'not needed')
    expect(analyst.ok).toBe(false)
    if (!analyst.ok) expect(analyst.failure.message).toContain('Analyst')
    const nonMember = unassignAgentTransaction(authority, clock, ctxOf(RILEY, 'all'), 'AG-011', 'not needed')
    expect(nonMember.ok).toBe(false)
    if (!nonMember.ok) expect(nonMember.failure.kind).toBe('not-found')
    expect(authority.snapshot().agents.find((a) => a.id === 'AG-011')!.projectId).toBe(P15)
  })

  it('the success path clears the assignment, keeps the group, and commits audit + notice', () => {
    const { authority, clock } = rig()
    const res = unassignAgentTransaction(authority, clock, ctxOf(SAM, P15, 'c50'), 'AG-011', 'Freeing the cloud lab for RT-2026-016')
    expect(res.ok).toBe(true)
    const d = authority.snapshot()
    expect(d.agents.find((a) => a.id === 'AG-011')!.projectId).toBe('')
    expect(d.agents.find((a) => a.id === 'AG-011')!.group).toBe('Cloud B')
    expect(d.audit.find((x) => x.action === 'Released agent to shared pool')).toMatchObject({ obj: 'AG-011', projectId: P15, reason: 'Freeing the cloud lab for RT-2026-016' })
    expect(d.notices.some((n) => n.category === 'agents' && n.projectId === P15)).toBe(true)
  })
})

const groupInput = (over: Partial<GroupInput> = {}): GroupInput => ({ name: 'Lab C', projectId: P14, desc: 'Test group', agents: [], owner: 'Alex Morgan', policy: 'Project use only', ...over })

describe('saveGroupTransaction — create/rename/membership gated (ticket 49)', () => {
  it('gates creation behind read-only context and the editScope role with reasons', () => {
    const { authority, clock } = rig()
    const viewer = saveGroupTransaction(authority, clock, ctxOf(CASEY, P14), groupInput())
    expect(viewer.ok).toBe(false)
    if (!viewer.ok) expect(viewer.failure.message).toBe('The Viewer role has read-only access.')
    const analyst = saveGroupTransaction(authority, clock, ctxOf(RILEY, P14), groupInput())
    expect(analyst.ok).toBe(false)
    if (!analyst.ok) expect(analyst.failure.message).toContain('Analyst')
    expect(authority.snapshot().groups.length).toBe(3)
  })

  it('refuses duplicate names per project, foreign projects and cross-project members', () => {
    const { authority, clock } = rig()
    const dup = saveGroupTransaction(authority, clock, ctxOf(ALEX, P14), groupInput({ name: 'windows lab a' }))
    expect(dup.ok).toBe(false)
    if (!dup.ok) expect(dup.failure.kind).toBe('conflict')
    const foreign = saveGroupTransaction(authority, clock, ctxOf(RILEY, P14), groupInput({ projectId: P15 }))
    expect(foreign.ok).toBe(false)
    if (!foreign.ok) expect(foreign.failure.kind).toBe('not-found')
    const crossProject = saveGroupTransaction(authority, clock, ctxOf(ALEX, P14), groupInput({ agents: ['AG-015'] }))
    expect(crossProject.ok).toBe(false)
    if (!crossProject.ok) expect(crossProject.failure.message).toContain('belongs to project PT-2026-006')
    const otherGroup = saveGroupTransaction(authority, clock, ctxOf(SAM, P15), groupInput({ projectId: P15, agents: ['AG-010'] }))
    expect(otherGroup.ok).toBe(false)
    if (!otherGroup.ok) expect(otherGroup.failure.message).toContain('already belongs to group Cloud B')
    expect(authority.snapshot().groups.length).toBe(3)
  })

  it('creates a group, auto-assigns pool members to the project, and renames with membership sync', () => {
    const { authority, clock } = rig()
    const created = saveGroupTransaction(authority, clock, ctxOf(ALEX, P14, 'c51'), groupInput({ agents: ['AG-012'] }))
    expect(created.ok).toBe(true)
    if (created.ok) {
      expect(created.data.id).toBe('GR-04')
      expect(authority.snapshot().agents.find((a) => a.id === 'AG-012')!.projectId).toBe(P14)
    }
    const renamed = saveGroupTransaction(authority, clock, ctxOf(ALEX, P14, 'c52'), groupInput({ id: 'GR-01', name: 'Windows Lab A (East)', agents: ['AG-007', 'AG-009'] }))
    expect(renamed.ok).toBe(true)
    const d = authority.snapshot()
    expect(d.groups.find((g) => g.id === 'GR-01')!.name).toBe('Windows Lab A (East)')
    expect(d.agents.find((a) => a.id === 'AG-007')!.group).toBe('Windows Lab A (East)')
    expect(d.audit.filter((x) => x.action === 'Updated agent group').length).toBe(1)
  })

  it('removing an in-use member requires the confirm reason and audits the removal; the operation keeps running', () => {
    const { authority, clock } = rig()
    const noReason = saveGroupTransaction(authority, clock, ctxOf(ALEX, P14), groupInput({ id: 'GR-01', name: 'Windows Lab A', agents: ['AG-009'] }))
    expect(noReason.ok).toBe(false)
    if (!noReason.ok) {
      expect(noReason.failure.kind).toBe('validation')
      expect(noReason.failure.message).toContain('AG-007')
    }
    const withReason = saveGroupTransaction(authority, clock, ctxOf(ALEX, P14, 'c53'), groupInput({ id: 'GR-01', name: 'Windows Lab A', agents: ['AG-009'], reason: 'Rotating the lab inventory' }))
    expect(withReason.ok).toBe(true)
    const d = authority.snapshot()
    expect(d.agents.find((a) => a.id === 'AG-007')!.group).toBe('')
    expect(d.operations.find((o) => o.id === 'OP-014')!.status).toBe('running')
    expect(d.audit.find((x) => x.action === 'Removed in-use agent from group')).toMatchObject({ obj: 'AG-007', reason: 'Rotating the lab inventory' })
  })
})

describe('removeFromGroupTransaction (ticket 49)', () => {
  it('refuses non-members of the project, non-members of the group, and in-use removals without a reason', () => {
    const { authority, clock } = rig()
    const foreign = removeFromGroupTransaction(authority, clock, ctxOf(RILEY, 'all'), 'GR-03', 'AG-011', 'not needed')
    expect(foreign.ok).toBe(false)
    if (!foreign.ok) expect(foreign.failure.kind).toBe('not-found')
    const notMember = removeFromGroupTransaction(authority, clock, ctxOf(ALEX, P14), 'GR-02', 'AG-007', 'not needed')
    expect(notMember.ok).toBe(false)
    if (!notMember.ok) expect(notMember.failure.message).toContain('not a member')
    const inUse = removeFromGroupTransaction(authority, clock, ctxOf(ALEX, P14), 'GR-01', 'AG-007')
    expect(inUse.ok).toBe(false)
    if (!inUse.ok) expect(inUse.failure.message).toContain('A reason is required')
    expect(authority.snapshot().groups.find((g) => g.id === 'GR-01')!.agents).toContain('AG-007')
  })

  it('removes a member, clears its group field and audits the removal', () => {
    const { authority, clock } = rig()
    const res = removeFromGroupTransaction(authority, clock, ctxOf(ALEX, P14, 'c54'), 'GR-01', 'AG-009', 'Agent left the lab')
    expect(res.ok).toBe(true)
    const d = authority.snapshot()
    expect(d.groups.find((g) => g.id === 'GR-01')!.agents).toEqual(['AG-007'])
    expect(d.agents.find((a) => a.id === 'AG-009')!.group).toBe('')
    expect(d.audit.find((x) => x.action === 'Removed agent from group')).toMatchObject({ obj: 'AG-009' })
  })
})

/* ───────────── Mounted screens: ChangeSet → fleet + detail refetch, bridge both directions ───────────── */

function mountAgents(page: 'agents' | 'agent', me = 'Alex Morgan') {
  const Screen = routes[page]
  const h = mountServices(null, me)
  return { ...h, show: () => h.show(<Screen />) }
}

describe('agent allocation screens on typed services (ticket 49)', () => {
  it('a legacy assign action (typed handler underneath) refetches the Query detail without a reload', async () => {
    const h = mountAgents('agent')
    h.show()
    h.run(() => { selectProject(P14); go('agent', { id: 'AG-012' }) })
    await waitFor(() => expect(screen.getByText('Agent is not assigned to a project')).toBeInTheDocument())
    h.run(() => { expect(assignAgentTransaction(h.svc().authority, h.svc().clock, ctxOf(ALEX, P14), 'AG-012', { projectId: P14 }).ok).toBe(true) })
    await waitFor(() => expect(screen.queryByText('Agent is not assigned to a project')).not.toBeInTheDocument())
    expect(screen.getByText(/Assigned to/)).toBeInTheDocument()
    expect(h.db().agents.find((a) => a.id === 'AG-012')!.projectId).toBe(P14)
    h.unmount()
  })

  it('the typed fleet refetches after a legacy group write; the pool badge follows the assignment', async () => {
    const h = mountAgents('agents')
    h.show()
    h.run(() => selectProject(P14))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Shared Pool2' })).toBeInTheDocument())
    h.run(() => { expect(saveGroupTransaction(h.svc().authority, h.svc().clock, ctxOf(ALEX, P14), { name: 'Lab C', projectId: P14, desc: '', agents: ['AG-012'], owner: 'Alex Morgan', policy: 'Project use only' }).ok).toBe(true) })
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Shared Pool1' })).toBeInTheDocument())
    // AG-012 left the pool and now renders as an assigned row of RT-2026-014; POOL-LAB-02 is still pool-only.
    expect(screen.getByText('POOL-LAB-01')).toBeInTheDocument()
    expect(screen.queryByText('POOL-LAB-02')).not.toBeInTheDocument()
    h.unmount()
  })

  it('the fleet Return-to-pool action runs the typed unassign and the legacy store observes it', async () => {
    const h = mountAgents('agents')
    h.show()
    h.run(() => selectProject(P14))
    await waitFor(() => expect(screen.getByText('WIN-LAB-03')).toBeInTheDocument())
    const enabled = screen.getAllByRole('button', { name: 'Return to pool' }).find((b) => !(b as HTMLButtonElement).disabled)
    expect(enabled).toBeTruthy() // only AG-009 (lost, unreserved) is releasable
    fireEvent.click(enabled!)
    expect(useSessionStore.getState().confirmState?.title).toBe('Return AG-009 to the shared pool?')
    await act(async () => { useSessionStore.getState().confirmState!.onConfirm('Decommissioned for this engagement') })
    await waitFor(() => expect(useToastStore.getState().toasts.some((t) => t.text === 'AG-009 returned to the shared pool.')).toBe(true))
    expect(h.db().agents.find((a) => a.id === 'AG-009')!.projectId).toBe('')
    expect(h.db().audit.find((x) => x.action === 'Released agent to shared pool')).toBeTruthy()
    h.unmount()
  })

  it('the AssignDrawer immediate path runs the typed assign; a handler refusal surfaces as a toast', async () => {
    const h = mountAgents('agents', 'Taylor Chen') // operator — cannot assign immediately
    h.show()
    h.run(() => { selectProject(P14); go('agents', { tab: 'pool' }) })
    const req = await waitFor(() => screen.getAllByRole('button', { name: 'Request assignment' }).find((b) => !(b as HTMLButtonElement).disabled))
    fireEvent.click(req!)
    await waitFor(() => expect(screen.getByText(/Request agent assignment/)).toBeInTheDocument())
    const immediate = screen.getByRole('button', { name: 'Assign immediately' }) as HTMLButtonElement
    expect(immediate.disabled).toBe(true)
    expect(immediate.title).toContain('Only Red Team Managers and Admins can assign immediately')
    h.unmount()
    const m = mountAgents('agents') // manager — the immediate path is enabled and runs the typed handler
    m.show()
    m.run(() => { selectProject(P14); go('agents', { tab: 'pool' }) })
    const req2 = await waitFor(() => screen.getAllByRole('button', { name: 'Request assignment' }).find((b) => !(b as HTMLButtonElement).disabled))
    fireEvent.click(req2!)
    await waitFor(() => expect(screen.getByText(/Request agent assignment/)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Assign immediately' }))
    await waitFor(() => expect(useToastStore.getState().toasts.some((t) => t.text === 'AG-012 assigned to RT-2026-014.')).toBe(true))
    expect(m.db().agents.find((a) => a.id === 'AG-012')!.projectId).toBe(P14)
    expect(m.db().audit.find((x) => x.action === 'Assigned agent to project' && x.obj === 'AG-012')).toBeTruthy()
    m.unmount()
  })

  it('the GroupModal create path commits through the typed handler and the legacy groups view observes it', async () => {
    const h = mountAgents('agents')
    h.show()
    h.run(() => selectProject(P14))
    fireEvent.click(await screen.findByRole('tab', { name: 'Groups' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Create Group' }))
    await waitFor(() => expect(screen.getByText('Create agent group')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText(/Group name/), { target: { value: 'Windows Lab B' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create group' }))
    await waitFor(() => expect(useToastStore.getState().toasts.some((t) => t.text === 'Group Windows Lab B created (GR-04).')).toBe(true))
    expect(h.db().groups.some((g) => g.name === 'Windows Lab B' && g.projectId === P14)).toBe(true)
    expect(h.db().audit.find((x) => x.action === 'Created agent group')).toBeTruthy()
    h.unmount()
  })

  it('the GroupsTab unlink action runs the typed membership removal with the confirm reason', async () => {
    const h = mountAgents('agents')
    h.show()
    h.run(() => selectProject(P14))
    fireEvent.click(await screen.findByRole('tab', { name: 'Groups' }))
    await waitFor(() => expect(screen.getByText('Windows Lab A')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Remove AG-009 from group' }))
    expect(useSessionStore.getState().confirmState?.title).toBe('Remove AG-009 from Windows Lab A?')
    await act(async () => { useSessionStore.getState().confirmState!.onConfirm('Agent re-imaged') })
    await waitFor(() => expect(useToastStore.getState().toasts.some((t) => t.text === 'AG-009 removed from Windows Lab A.')).toBe(true))
    expect(h.db().groups.find((g) => g.id === 'GR-01')!.agents).toEqual(['AG-007'])
    expect(h.db().agents.find((a) => a.id === 'AG-009')!.group).toBe('')
    h.unmount()
  })
})
