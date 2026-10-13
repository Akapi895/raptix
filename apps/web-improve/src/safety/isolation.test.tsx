import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { computePreflight, StoreProvider, useServices, useStore, type Store } from '../store'
import type { ConsoleServices } from '../domain/service-factory'
import { importAssetsTransaction } from '../features/assets/writes'

afterEach(cleanup)

function Probe({ ready }: { ready: (s: Store, v: ConsoleServices) => void }) {
  ready(useStore(), useServices())
  return null
}

/** Mounts the legacy store and its service factory (one authority, both handles). */
function mountIsolation(me = 'Alex Morgan') {
  let store!: Store
  let svc!: ConsoleServices
  render(
    <StoreProvider>
      <Probe ready={(s, v) => { store = s; svc = v }} />
    </StoreProvider>,
  )
  if (me !== 'Alex Morgan') act(() => { store.setMe(me) })
  return {
    store: () => store,
    svc: () => svc,
    as(name: string) { act(() => { store.setMe(name) }) },
    run(fn: () => unknown) { act(fn) },
    unmount: () => { cleanup() },
  }
}

const newOp = (store: ReturnType<typeof mountIsolation>['store']) =>
  store().A.createOperation({ name: 'Scope invalidation probe', projectId: 'RT-2026-014', owner: 'Taylor Chen', desc: '', objective: '', playbookId: 'PB-001', agents: ['AG-012'], assets: ['AS-0141'], mode: 'Manual approval', schedule: '', needConfirm: true, note: '' })

describe('project switch isolates reads (requirement 6)', () => {
  it('in All Projects mode scoped reads aggregate only accessible projects, never a mix', () => {
    const h = mountIsolation('Riley Brooks')
    expect(h.store().scoped(h.store().db.findings).map((f) => f.id)).toEqual(['FD-011', 'FD-012'])
    h.unmount()
  })

  it('switching the active project retargets scoped reads to exactly that project, never a mix with the previous one', () => {
    const h = mountIsolation('Taylor Chen')
    h.run(() => h.store().setPid('RT-2026-014'))
    expect(h.store().scoped(h.store().db.findings).every((f) => f.projectId === 'RT-2026-014')).toBe(true)
    h.run(() => h.store().setPid('RT-2026-015'))
    expect(h.store().scoped(h.store().db.findings).map((f) => f.id)).toEqual(['FD-015'])
    h.unmount()
  })
})

describe('scope revisions invalidate at submission (requirement a / spec scope re-validation)', () => {
  it('editing an approved project bumps the ROE, re-locks approval, expires approved plans and resets ready operations', () => {
    const h = mountIsolation()
    h.run(() => h.store().A.assignAgent('AG-012', 'RT-2026-014'))
    const opId = newOp(h.store)
    h.run(() => h.store().A.confirmPreflight(opId))
    expect(h.store().db.operations.find((o) => o.id === opId)?.status).toBe('ready')
    h.run(() => h.store().A.editScope('RT-2026-014', { window: 'Mon–Fri, 10:00 AM–4:00 PM (UTC+7)' }, 'Tighten the window'))
    const d = h.store().db
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
    h.run(() => h.store().A.assignAgent('AG-012', 'RT-2026-014'))
    const opId = newOp(h.store)
    h.run(() => h.store().A.confirmPreflight(opId))
    h.run(() => h.store().A.editScope('RT-2026-014', { window: 'Mon–Fri, 10:00 AM–4:00 PM (UTC+7)' }, 'Tighten the window'))
    const d = h.store().db
    const op = d.operations.find((o) => o.id === opId)!
    const roe = computePreflight(d, op).find((c) => c.code === 'PRE-02')!
    expect(roe.state).toBe('fail')
    expect(roe.detail).toContain('waiting for re-approval')
    h.run(() => h.store().A.startOp(opId))
    expect(h.store().db.operations.find((o) => o.id === opId)?.status).toBe('draft')
    h.unmount()
  })

  it('in-scope asset additions on an active project stay pending until an independent ROE approval (requirement 28)', () => {
    const h = mountIsolation()
    let res!: ReturnType<typeof importAssetsTransaction>
    h.run(() => {
      // Ticket 65 retired the A.addAssets wrapper; the import runs through the
      // same feature transaction (current persona captured at call time).
      res = importAssetsTransaction(h.svc().authority, h.svc().clock, { actor: { id: 'Alex Morgan', role: 'manager' }, projectId: 'RT-2026-015', corr: 'legacy' }, 'RT-2026-015', [{ name: 'cloud-db-01', ident: 'db-01.fabrikam.example.test', type: 'Database', os: 'Linux', owner: 'Cloud Team B', scope: 'in', source: 'Manual' }])
    })
    expect(res.ok && res.data.needsApproval).toBe(true)
    let d = h.store().db
    const asset = d.assets.find((a) => a.projectId === 'RT-2026-015' && a.name === 'cloud-db-01')!
    expect(asset.scope).toBe('pending')
    expect(d.projects.find((x) => x.id === 'RT-2026-015')?.roeStatus).toBe('pending')
    const apr = d.approvals.find((a) => a.projectId === 'RT-2026-015' && a.type === 'Scope change' && a.status === 'pending')!
    h.as('Pat Kim')
    h.run(() => h.store().A.decideApproval(apr.id, 'approved', 'Accepted into scope'))
    d = h.store().db
    expect(d.assets.find((a) => a.id === asset.id)?.scope).toBe('in')
    expect(d.projects.find((x) => x.id === 'RT-2026-015')?.roeStatus).toBe('approved')
    h.unmount()
  })
})
