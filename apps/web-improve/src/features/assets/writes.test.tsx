/**
 * Ticket 51: asset import and scope-change write handlers. The import
 * validates every row BEFORE anything commits — one invalid/duplicate row
 * refuses the whole batch with per-row reasons and leaves the dataset
 * byte-identical — and a valid batch is ONE atomic ChangeSet through ticket
 * 21's governance transaction: imported assets stay pending, a governed
 * scope invalidates at submission (ROE bump, plan expiry, ready-operation
 * reset), and the independent approval admits them afterwards. Scope
 * changes are role-gated with reasons, a pending proposal opens the review
 * in the same commit, and both bridge directions observe one dataset: the
 * typed handler's commits appear in the legacy store, the legacy actions'
 * commits refetch the Query views.
 */
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { ConsoleProviders } from '../../state/query'
import { StoreProvider, useServices, useStore, computePreflight, type Store } from '../../store'
import { createConsoleServices, type ConsoleServices } from '../../domain/service-factory'
import type { ActorRef, ChangeSet, RequestContext } from '../../domain/service'
import { routes } from '../../screens/d'
import { decideApprovalTransaction } from '../approvals/service'
import { changeAssetScopeTransaction, createAssetWriteHandlers, importAssetsTransaction, validateAssetRows } from './writes'
import type { AssetImportRow } from './writes'

afterEach(cleanup)

const ALEX: ActorRef = { id: 'Alex Morgan', role: 'manager' }
const PAT: ActorRef = { id: 'Pat Kim', role: 'reviewer' }
const RILEY: ActorRef = { id: 'Riley Brooks', role: 'analyst' }
const CASEY: ActorRef = { id: 'Casey Nguyen (Client)', role: 'viewer' }
const P14 = 'RT-2026-014'

let corrSeq = 0
const ctxOf = (actor: ActorRef, projectId = P14): RequestContext => ({ actor, projectId, corr: `corr-${++corrSeq}` })

function Probe({ ready }: { ready: (s: Store, v: ConsoleServices) => void }) {
  ready(useStore(), useServices())
  return null
}

/** Mounts the legacy store + Query providers and captures both, so one mutation can be observed from both bridges. */
function mountConsole(me = 'Alex Morgan', extra?: ReactNode) {
  let store!: Store
  let svc!: ConsoleServices
  const view = render(
    <StoreProvider>
      <ConsoleProviders>
        <Probe ready={(s, v) => { store = s; svc = v }} />
        {extra}
      </ConsoleProviders>
    </StoreProvider>,
  )
  if (me !== 'Alex Morgan') act(() => { store.setMe(me) })
  return {
    store: () => store,
    svc: () => svc,
    run: (fn: () => unknown) => act(fn),
    unmount: view.unmount,
    rerender: view.rerender,
  }
}

/** Mounts the providers with a probe plus a real asset route (Query consumers). */
function mountAssets(page: 'assets' | 'asset-scope') {
  let store!: Store
  let svc!: ConsoleServices
  const Screen = routes[page]
  const ui = (
    <StoreProvider>
      <ConsoleProviders>
        <Probe ready={(s, v) => { store = s; svc = v }} />
        <Screen />
      </ConsoleProviders>
    </StoreProvider>
  )
  const view = render(ui)
  return { store: () => store, svc: () => svc, run: (fn: () => unknown) => act(fn), unmount: view.unmount }
}

const row = (over: Partial<AssetImportRow> = {}): AssetImportRow => ({ name: 'hook-01', ident: 'hook-01.example.test', type: 'Host', os: 'Linux', owner: 'Ops Team', scope: 'in', source: 'CSV import', ...over })

describe('import validation (ticket 51)', () => {
  it('refuses an invalid batch with per-row reasons and commits nothing (snapshot equality)', () => {
    const svc = createConsoleServices()
    const before = JSON.stringify(svc.authority.snapshot())
    const rows = [
      row(),
      row({ name: 'bad-ip', ident: '300.1.1.1', type: 'IP' }),
      row({ name: 'dup-existing', ident: 'web-01.northwind.example.test' }),
      row({ name: 'dup-batch', ident: 'hook-01.example.test' }),
      row({ name: '   ', ident: 'nameless.example.test' }),
    ]
    const res = importAssetsTransaction(svc.authority, svc.clock, ctxOf(ALEX), P14, rows)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.failure.kind).toBe('validation')
      expect(res.failure.message).toContain('4 of 5 rows cannot be imported')
      expect(res.failure.message).toContain('Nothing was committed')
      expect(res.failure.message).toContain('bad-ip: Invalid IP address')
      expect(res.failure.message).toContain('dup-existing: identifier already exists in this project')
      expect(res.failure.message).toContain('dup-batch: duplicate identifier within this import')
      expect(res.failure.message).toContain('…')
    }
    expect(JSON.stringify(svc.authority.snapshot())).toBe(before)
    svc.dispose()
  })

  it('the pure validator is the one authority the preview shares (duplicate detection only on otherwise-valid rows)', () => {
    const issues = validateAssetRows(createConsoleServices().authority.snapshot(), P14, [
      row(),
      row({ name: 'second', ident: 'HOOK-01.example.test' }),
      row({ ident: '' }),
    ])
    expect(issues.map((i) => [i.index, i.duplicate, i.reasons])).toEqual([
      [1, true, ['duplicate identifier within this import']],
      [2, false, ['Enter an identifier (IP, hostname or URL).']],
    ])
  })

  it('gates the import behind role and project context with reasons', () => {
    const svc = createConsoleServices()
    const before = JSON.stringify(svc.authority.snapshot())
    expect(importAssetsTransaction(svc.authority, svc.clock, ctxOf(RILEY), P14, [row()]))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: expect.stringContaining('cannot add assets') }) })
    expect(importAssetsTransaction(svc.authority, svc.clock, ctxOf(CASEY), P14, [row()]))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: expect.stringContaining('read-only access') }) })
    expect(importAssetsTransaction(svc.authority, svc.clock, ctxOf(ALEX), 'RT-2026-999', [row()]))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'not-found' }) })
    expect(importAssetsTransaction(svc.authority, svc.clock, ctxOf(ALEX), P14, []))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'validation', message: expect.stringContaining('No rows') }) })
    expect(JSON.stringify(svc.authority.snapshot())).toBe(before)
    svc.dispose()
  })
})

describe('atomic import through the governance transaction (invariant a, asset path)', () => {
  const newReadyOperation = (h: ReturnType<typeof mountConsole>) => {
    h.run(() => h.store().A.assignAgent('AG-012', P14))
    let opId = ''
    h.run(() => { opId = h.store().A.createOperation({ name: 'Import probe', projectId: P14, owner: 'Taylor Chen', desc: '', objective: '', playbookId: 'PB-001', agents: ['AG-012'], assets: ['AS-0141'], mode: 'Manual approval', schedule: '', needConfirm: true, note: '' }) })
    h.run(() => h.store().A.confirmPreflight(opId))
    return opId
  }

  it('commits ONE ChangeSet: assets pending, ROE bump, plan expiry and ready-op reset at submission', () => {
    const h = mountConsole()
    const opId = newReadyOperation(h)
    const seen: ChangeSet[] = []
    h.svc().subscribe((cs) => seen.push(cs))

    let res!: ReturnType<typeof importAssetsTransaction>
    act(() => { res = importAssetsTransaction(h.svc().authority, h.svc().clock, ctxOf(ALEX), P14, [row(), row({ name: 'hook-out', ident: 'hook-out.example.test', scope: 'out' })]) })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(seen).toHaveLength(1)
    expect(seen[0].entities.map((e) => e.kind)).toEqual(expect.arrayContaining(['asset', 'project', 'plan', 'operation', 'approval', 'notice', 'audit']))
    expect(seen[0].projectId).toBe(P14)
    expect(res.data).toMatchObject({ added: 2, invalidated: true, roeVersion: 'ROE-014-v3', needsApproval: true, plansExpired: ['PL-021'], operationsReset: [opId] })

    const d = h.store().db
    const pending = d.assets.find((a) => a.projectId === P14 && a.name === 'hook-01')!
    const out = d.assets.find((a) => a.projectId === P14 && a.name === 'hook-out')!
    expect(pending.scope).toBe('pending')
    expect(out.scope).toBe('out')
    expect(d.projects.find((x) => x.id === P14)?.roeVersion).toBe('ROE-014-v3')
    expect(d.plans.find((x) => x.id === 'PL-021')?.status).toBe('expired')
    expect(d.operations.find((o) => o.id === opId)).toMatchObject({ status: 'draft', preflightAt: undefined })
    h.unmount()
  })

  it('imported pending assets cannot be targeted until the independent approval admits them', () => {
    const h = mountConsole()
    h.run(() => h.store().A.assignAgent('AG-012', P14))
    let res!: ReturnType<typeof importAssetsTransaction>
    act(() => { res = importAssetsTransaction(h.svc().authority, h.svc().clock, ctxOf(ALEX), P14, [row()]) })
    expect(res.ok).toBe(true)
    const importedId = h.store().db.assets.find((a) => a.projectId === P14 && a.name === 'hook-01')!.id
    let opId = ''
    h.run(() => { opId = h.store().A.createOperation({ name: 'Pending target probe', projectId: P14, owner: 'Taylor Chen', desc: '', objective: '', playbookId: 'PB-001', agents: ['AG-012'], assets: [importedId], mode: 'Manual approval', schedule: '', needConfirm: true, note: '' }) })

    // Still pending: preflight refuses the target (PRE-03) before any approval.
    const before = computePreflight(h.store().db, h.store().db.operations.find((o) => o.id === opId)!)
    expect(before.find((c) => c.code === 'PRE-03')?.state).toBe('fail')
    expect(before.find((c) => c.code === 'PRE-03')?.detail).toContain('hook-01')

    // The independent reviewer admits the revision (invalidation did not wait
    // for this approval — it already happened at submission above).
    const apr = h.store().db.approvals.find((a) => a.projectId === P14 && a.type === 'Scope change' && a.status === 'pending')!
    let decided!: ReturnType<typeof decideApprovalTransaction>
    act(() => { decided = decideApprovalTransaction(h.svc().authority, h.svc().clock, ctxOf(PAT), apr.id, 'approved', 'Accepted into scope') })
    expect(decided.ok).toBe(true)
    expect(h.store().db.assets.find((a) => a.id === importedId)?.scope).toBe('in')
    expect(computePreflight(h.store().db, h.store().db.operations.find((o) => o.id === opId)!).find((c) => c.code === 'PRE-03')?.state).toBe('pass')
    h.unmount()
  })
})

describe('scope changes (ticket 51)', () => {
  it('gates scope changes behind role, project context and state with reasons (snapshot equality)', () => {
    const svc = createConsoleServices()
    const before = JSON.stringify(svc.authority.snapshot())
    expect(changeAssetScopeTransaction(svc.authority, svc.clock, ctxOf(RILEY), 'AS-0141', 'out'))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: expect.stringContaining('cannot change asset scope') }) })
    expect(changeAssetScopeTransaction(svc.authority, svc.clock, ctxOf(CASEY), 'AS-0141', 'out'))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: expect.stringContaining('read-only access') }) })
    const foreign = changeAssetScopeTransaction(svc.authority, svc.clock, ctxOf(ALEX, 'RT-2026-015'), 'AS-0141', 'out')
    expect(foreign).toEqual({ ok: false, failure: expect.objectContaining({ kind: 'forbidden', message: expect.stringContaining('Switch to that project') }) })
    if (!foreign.ok) expect(foreign.failure.entity?.projectId).toBe(P14)
    expect(changeAssetScopeTransaction(svc.authority, svc.clock, ctxOf(ALEX), 'AS-0141', 'in'))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'conflict', message: expect.stringContaining('already in scope') }) })
    expect(changeAssetScopeTransaction(svc.authority, svc.clock, ctxOf(ALEX), 'AS-9999', 'out'))
      .toEqual({ ok: false, failure: expect.objectContaining({ kind: 'not-found' }) })
    expect(JSON.stringify(svc.authority.snapshot())).toBe(before)
    svc.dispose()
  })

  it('a pending proposal opens the scope review in the same commit and never auto-promotes', () => {
    const h = mountConsole()
    const seen: ChangeSet[] = []
    h.svc().subscribe((cs) => seen.push(cs))
    let res!: ReturnType<typeof changeAssetScopeTransaction>
    act(() => { res = changeAssetScopeTransaction(h.svc().authority, h.svc().clock, ctxOf(ALEX), 'AS-0141', 'pending', { reason: 'Needs ROE re-check' }) })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(seen).toHaveLength(1)
    expect(res.data.reviewRequested).toBeDefined()
    const d = h.store().db
    expect(d.assets.find((a) => a.id === 'AS-0141')?.scope).toBe('pending')
    const aprId = res.data.reviewRequested!
    const apr = d.approvals.find((a) => a.id === aprId)!
    expect(apr).toMatchObject({ projectId: P14, type: 'Scope change', status: 'pending', by: 'Alex Morgan' })
    expect(apr.diff).toContain('web-01')
    expect(apr.note).toBe('Needs ROE re-check')
    // A second proposal rides the open review instead of duplicating it.
    let second!: ReturnType<typeof changeAssetScopeTransaction>
    act(() => { second = changeAssetScopeTransaction(h.svc().authority, h.svc().clock, ctxOf(ALEX), 'AS-0142', 'pending', { reason: 'Same ROE question' }) })
    expect(second.ok && second.data.reviewRequested).toBeUndefined()
    expect(h.store().db.assets.find((a) => a.id === 'AS-0142')?.scope).toBe('pending')
    h.unmount()
  })

  it('the review decision is the reviewer gate: approve role suffices where editScope does not', () => {
    const svc = createConsoleServices()
    const res = changeAssetScopeTransaction(svc.authority, svc.clock, ctxOf(PAT), 'AS-0154', 'in', { action: 'Approved scope change', reason: 'Admitted into scope' })
    expect(res.ok).toBe(true)
    expect(svc.authority.snapshot().assets.find((a) => a.id === 'AS-0154')?.scope).toBe('in')
    expect(svc.authority.snapshot().audit[0]).toMatchObject({ action: 'Approved scope change', actor: 'Pat Kim', reason: 'Admitted into scope', projectId: P14 })
    svc.dispose()
  })
})

describe('bridge both directions (ticket 51)', () => {
  it('a typed import commit is observed by the legacy consumer (one dataset)', () => {
    const h = mountConsole()
    const seen: ChangeSet[] = []
    h.svc().subscribe((cs) => seen.push(cs))
    act(() => { importAssetsTransaction(h.svc().authority, h.svc().clock, ctxOf(ALEX), P14, [row()]) })
    expect(seen.map((cs) => cs.corr)).toEqual(['corr-' + corrSeq])
    const d = h.store().db
    expect(d.assets.find((a) => a.projectId === P14 && a.name === 'hook-01')?.scope).toBe('pending')
    expect(d.projects.find((x) => x.id === P14)?.roeVersion).toBe('ROE-014-v3')
    expect(d.audit.some((a) => a.action === 'Added assets' && a.obj.includes('hook-01'))).toBe(true)
    expect(h.store().db).toBe(h.svc().authority.snapshot())
    h.unmount()
  })

  it('a legacy-context import mutation is observed by the new catalog without a reload', async () => {
    const h = mountAssets('assets')
    await waitFor(() => expect(screen.getByText('Page 1 of 3')).toBeInTheDocument())
    // Ticket 65 retired the A.addAssets wrapper; the legacy-context entry is
    // the same import transaction the wrapper forwarded to (corr 'legacy').
    h.run(() => { importAssetsTransaction(h.svc().authority, h.svc().clock, { actor: ALEX, projectId: P14, corr: 'legacy' }, P14, [row({ name: 'legacy-bridge', ident: 'legacy-bridge.example.test' })]) })
    await waitFor(() => expect(screen.getByText('22 records')).toBeInTheDocument())
    h.unmount()
  })

  it('a typed handler import and scope change refetch the catalog and scope views (ticket 50 keys)', async () => {
    const h = mountAssets('assets')
    await waitFor(() => expect(screen.getByText('Page 1 of 3')).toBeInTheDocument())
    h.run(() => h.store().setPid(P14))
    await waitFor(() => expect(screen.getByText('14 records')).toBeInTheDocument())
    const write = createAssetWriteHandlers(h.svc(), ALEX, P14)
    await act(async () => { await write.importRows([row(), row({ name: 'hook-02', ident: 'hook-02.example.test' })]) })
    await waitFor(() => expect(screen.getByText('16 records')).toBeInTheDocument())
    const importedId = h.store().db.assets.find((a) => a.projectId === P14 && a.name === 'hook-02')!.id
    await act(async () => { await write.changeScope(importedId, 'out', { reason: 'Out for the demo' }) })
    // The scope view (same [asset] key prefix) refetches the changed classification.
    const scope = await h.svc().assets(ALEX, P14).scope({ actor: ALEX, projectId: P14, corr: 'scope-read' })
    expect(scope.ok && scope.data.rows.find((r) => r.asset.id === importedId)?.asset.scope).toBe('out')
    h.unmount()
  })
})
