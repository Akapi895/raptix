import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'
import { mountServices } from '../helpers'
import { useDb, useScoped } from '../../state/console'
import { computePreflightChecks } from '../../features/operations/preflight'
import { importAssetsTransaction } from '../../features/assets/writes'
import { createOperationDraft, runOperationPreflight, startOperation } from '../../features/operations/service'
import { assignAgentTransaction } from '../../features/agents/writes'
import { decideApprovalTransaction, reviseScopeTransaction } from '../../features/approvals/service'
import { selectProject } from '../../router/navigate'
import type { ActorRef, RequestContext } from '../../domain/service'
import type { Db } from '../../demo/seed';

afterEach(cleanup)

const ALEX: ActorRef = { id: 'Alex Morgan', role: 'manager' }
const PAT: ActorRef = { id: 'Pat Kim', role: 'reviewer' }
const ctxOf = (projectId: string, actor: ActorRef = ALEX, corr = 'legacy'): RequestContext => ({ actor, projectId, corr })

/* The console scope seam probe: the G-12 filter and the authority snapshot the
   components consume (the store context's replacement). */
let latest!: { scoped: <T extends { projectId: string }>(arr: T[]) => T[]; db: Db }
function ScopeProbe() {
  latest = { scoped: useScoped(), db: useDb() }
  return null
}

/** Mounts the service authority and its scope seam (one authority, both handles). */
function mountIsolation(me = 'Alex Morgan') {
  return mountServices(<ScopeProbe />, me)
}

const newOp = (h: ReturnType<typeof mountIsolation>) => {
  const res = createOperationDraft(h.svc().authority, h.svc().clock, ctxOf('RT-2026-014'), { name: 'Scope invalidation probe', owner: 'Taylor Chen', desc: '', objective: '', playbookId: 'PB-001', agents: ['AG-012'], assets: ['AS-0141'], mode: 'Manual approval', schedule: '', needConfirm: true, note: '' })
  if (!res.ok) throw new Error(res.failure.message)
  return res.data.op.id
}

const assign = (h: ReturnType<typeof mountIsolation>, agentId: string, projectId: string) => {
  const res = assignAgentTransaction(h.svc().authority, h.svc().clock, ctxOf(projectId), agentId, { projectId })
  if (!res.ok) throw new Error(res.failure.message)
}

describe('project switch isolates reads (requirement 6)', () => {
  it('in All Projects mode scoped reads aggregate only accessible projects, never a mix', () => {
    const h = mountIsolation('Riley Brooks')
    expect(latest.scoped(latest.db.findings).map((f) => f.id)).toEqual(['FD-011', 'FD-012'])
    h.unmount()
  })

  it('switching the active project retargets scoped reads to exactly that project, never a mix with the previous one', () => {
    const h = mountIsolation('Taylor Chen')
    h.run(() => selectProject('RT-2026-014'))
    expect(latest.scoped(latest.db.findings).every((f) => f.projectId === 'RT-2026-014')).toBe(true)
    h.run(() => selectProject('RT-2026-015'))
    expect(latest.scoped(latest.db.findings).map((f) => f.id)).toEqual(['FD-015'])
    h.unmount()
  })
})

describe('scope revisions invalidate at submission (requirement a / spec scope re-validation)', () => {
  it('editing an approved project bumps the ROE, re-locks approval, expires approved plans and resets ready operations', () => {
    const h = mountIsolation()
    h.run(() => assign(h, 'AG-012', 'RT-2026-014'))
    const opId = newOp(h)
    h.run(() => { runOperationPreflight(h.svc().authority, h.svc().clock, ctxOf('RT-2026-014'), opId) })
    expect(h.db().operations.find((o) => o.id === opId)?.status).toBe('ready')
    h.run(() => {
      const res = reviseScopeTransaction(h.svc().authority, h.svc().clock, ctxOf('RT-2026-014'), 'RT-2026-014', { patch: { window: 'Mon–Fri, 10:00 AM–4:00 PM (UTC+7)' }, reason: 'Tighten the window' })
      if (!res.ok) throw new Error(res.failure.message)
    })
    const d = h.db()
    const p = d.projects.find((x) => x.id === 'RT-2026-014')!
    expect(p.roeVersion).toBe('ROE-014-v3')
    expect(p.roeStatus).toBe('pending')
    expect(d.approvals.some((a) => a.projectId === 'RT-2026-014' && a.type === 'Scope change' && a.status === 'pending')).toBe(true)
    const pl = d.plans.find((x) => x.id === 'PL-021')!
    expect(pl.status).toBe('expired')
    expect(pl.risks.some((r) => r.includes('Re-validation required'))).toBe(true)
    const op = d.operations.find((o) => o.id === opId)!
    expect(op.status).toBe('draft')
    expect(op.preflightAt).toBeUndefined()
    h.unmount()
  })

  it('after a scope revision preflight denies start until the ROE is re-approved', () => {
    const h = mountIsolation()
    h.run(() => assign(h, 'AG-012', 'RT-2026-014'))
    const opId = newOp(h)
    h.run(() => { runOperationPreflight(h.svc().authority, h.svc().clock, ctxOf('RT-2026-014'), opId) })
    h.run(() => {
      const res = reviseScopeTransaction(h.svc().authority, h.svc().clock, ctxOf('RT-2026-014'), 'RT-2026-014', { patch: { window: 'Mon–Fri, 10:00 AM–4:00 PM (UTC+7)' }, reason: 'Tighten the window' })
      if (!res.ok) throw new Error(res.failure.message)
    })
    const d = h.db()
    const op = d.operations.find((o) => o.id === opId)!
    const roe = computePreflightChecks(d, op, h.svc().clock.now()).find((c) => c.code === 'PRE-02')!
    expect(roe.state).toBe('fail')
    expect(roe.detail).toContain('waiting for re-approval')
    h.run(() => { startOperation(h.svc().authority, h.svc().clock, ctxOf('RT-2026-014'), opId) })
    expect(h.db().operations.find((o) => o.id === opId)?.status).toBe('draft')
    h.unmount()
  })

  it('in-scope asset additions on an active project stay pending until an independent ROE approval (requirement 28)', () => {
    const h = mountIsolation()
    let res!: ReturnType<typeof importAssetsTransaction>
    h.run(() => {
      // The import path runs through the feature transaction (current persona
      // captured at call time).
      res = importAssetsTransaction(h.svc().authority, h.svc().clock, ctxOf('RT-2026-015'), 'RT-2026-015', [{ name: 'cloud-db-01', ident: 'db-01.fabrikam.example.test', type: 'Database', os: 'Linux', owner: 'Cloud Team B', scope: 'in', source: 'Manual' }])
    })
    expect(res.ok && res.data.needsApproval).toBe(true)
    let d = h.db()
    const asset = d.assets.find((a) => a.projectId === 'RT-2026-015' && a.name === 'cloud-db-01')!
    expect(asset.scope).toBe('pending')
    expect(d.projects.find((x) => x.id === 'RT-2026-015')?.roeStatus).toBe('pending')
    const apr = d.approvals.find((a) => a.projectId === 'RT-2026-015' && a.type === 'Scope change' && a.status === 'pending')!
    h.as('Pat Kim')
    h.run(() => {
      const decided = decideApprovalTransaction(h.svc().authority, h.svc().clock, ctxOf('RT-2026-015', PAT), apr.id, 'approved', 'Accepted into scope')
      if (!decided.ok) throw new Error(decided.failure.message)
    })
    d = h.db()
    expect(d.assets.find((a) => a.id === asset.id)?.scope).toBe('in')
    expect(d.projects.find((x) => x.id === 'RT-2026-015')?.roeStatus).toBe('approved')
    h.unmount()
  })
})
