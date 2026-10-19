/**
 * Ticket 50: asset catalog + detail + scope classification on typed
 * services — accessible-only scoping (a non-member is denied without an
 * existence leak), catalog filters/pagination with scope KPIs, detail
 * surfaces (operations, findings, evidence, agents, approvals) with
 * sensitive-evidence masking and technique references that resolve to the
 * live library routes, scope-classification rows with per-project diff
 * contexts, RBAC gates with reasons, and the legacy→Query bridge (a legacy
 * asset change appears in the new views without a reload).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { mountServices } from '../../test/helpers'
import { currentRoute, go, selectProject } from '../../router/navigate'
import type { ActorRef, RequestContext } from '../../domain/service'
import { routes } from '../../screens/d'
import { hasRoute } from '../../router/registry'
import { seed } from '../../data'
import { changeAssetScopeTransaction, importAssetsTransaction } from './writes'
import { getAsset, getAssetScope, listAssets } from './service'

const P14 = 'RT-2026-014'
const P15 = 'RT-2026-015'
const ALEX: ActorRef = { id: 'Alex Morgan', role: 'manager' }
const legacyCtx = (projectId: string): RequestContext => ({ actor: ALEX, projectId, corr: 'legacy' })

beforeEach(() => { window.location.hash = '' })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

/** Mounts the providers with a probe, then optionally mounts a real asset route. */
function mountAssets(page: 'assets' | 'asset' | 'asset-scope', me = 'Alex Morgan') {
  const Screen = routes[page]
  const h = mountServices(null, me)
  return { ...h, show: () => h.show(<Screen />) }
}

describe('asset catalog (ticket 50)', () => {
  it('lists only accessible assets with scope KPIs that filter the rows', async () => {
    const h = mountAssets('assets', 'Riley Brooks') // analyst — member of RT-2026-014 only
    h.show()
    await waitFor(() => expect(screen.getByText('web-01')).toBeInTheDocument())
    expect(screen.getByText('14 total records')).toBeInTheDocument()
    expect(screen.queryByText('cloud-app-01')).not.toBeInTheDocument() // RT-2026-015 — not a member
    expect(screen.queryByText('shop-web')).not.toBeInTheDocument()
    expect(screen.queryByText('purple-lab-dc')).not.toBeInTheDocument()
    // Scope KPIs are visibly distinct: in / out / pending / unclassified.
    fireEvent.click(screen.getByRole('button', { name: /Approved Out of Scope/ }))
    await waitFor(() => expect(screen.getByText('prod-payments-db')).toBeInTheDocument())
    expect(screen.queryByText('web-01')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Pending Approval/ }))
    await waitFor(() => expect(screen.getByText('staging-erp')).toBeInTheDocument())
    expect(screen.queryByText('prod-payments-db')).not.toBeInTheDocument()
    h.unmount()
  })

  it('paginates the scoped rows through the typed read', async () => {
    const h = mountAssets('assets', 'Riley Brooks')
    h.show()
    await waitFor(() => expect(screen.getByText('Page 1 of 2')).toBeInTheDocument())
    expect(screen.getByText('mail-relay')).toBeInTheDocument()
    expect(screen.queryByText('staging-erp')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(screen.getByText('staging-erp')).toBeInTheDocument())
    expect(screen.queryByText('web-01')).not.toBeInTheDocument()
    h.unmount()
  })

  it('search and type filters run through the typed list read', async () => {
    const h = mountAssets('assets')
    h.show()
    await waitFor(() => expect(screen.getByText('Page 1 of 3')).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText('Search name, IP, hostname or URL'), { target: { value: 'win-dc' } })
    await waitFor(() => expect(screen.getByText('Showing all 1 record')).toBeInTheDocument())
    expect(screen.getByText('win-dc-01')).toBeInTheDocument()
    fireEvent.change(await screen.findByPlaceholderText('Search name, IP, hostname or URL'), { target: { value: '' } })
    fireEvent.change(await screen.findByRole('combobox', { name: 'Type' }), { target: { value: 'Host' } })
    await waitFor(() => expect(screen.getByText('Showing all 5 records')).toBeInTheDocument())
    expect(screen.getByText('mail-relay')).toBeInTheDocument()
    expect(screen.queryByText('win-dc-01')).not.toBeInTheDocument()
    h.unmount()
  })

  it('an imported asset appears in the catalog without a reload', async () => {
    const h = mountAssets('assets')
    h.show()
    await waitFor(() => expect(screen.getByText('Page 1 of 3')).toBeInTheDocument())
    // Ticket 65 retired the A.addAssets wrapper; the import commits through
    // the same feature transaction the wrapper forwarded to.
    h.run(() => importAssetsTransaction(h.svc().authority, h.svc().clock, legacyCtx(P14), P14, [{ name: 'bridge-01', ident: 'bridge-01.example.test', type: 'Host', os: 'Linux', owner: 'Ops Team', scope: 'in', source: 'Manual' }]))
    await waitFor(() => expect(screen.getByText('22 total records')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(screen.getByText('bridge-01')).toBeInTheDocument())
    h.unmount()
  })

  it('shows an error state without leaking data for a non-member project', async () => {
    const h = mountAssets('assets', 'Riley Brooks')
    h.show()
    await waitFor(() => expect(screen.getByText('web-01')).toBeInTheDocument())
    h.run(() => selectProject(P15))
    await waitFor(() => expect(screen.getByText('Assets could not be loaded')).toBeInTheDocument())
    expect(screen.getByText('Assets for this project are not available for your account.')).toBeInTheDocument()
    expect(screen.queryByText('cloud-app-01')).not.toBeInTheDocument()
    h.unmount()
  })
})

describe('asset detail (ticket 50)', () => {
  it('describes scoped surfaces: operations, findings, evidence, agents and approvals', async () => {
    const h = mountAssets('asset')
    h.show()
    h.run(() => go('asset', { id: 'AS-0143' }))
    await waitFor(() => expect(screen.getAllByText('win-dc-01').length).toBeGreaterThan(0))
    expect(screen.getAllByText('ROE-014-v2').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('tab', { name: /Related operations/ }))
    await waitFor(() => expect(screen.getByText('OP-014')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('tab', { name: /Agents/ }))
    await waitFor(() => expect(screen.getByText('AG-007')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('tab', { name: /Approval history/ }))
    await waitFor(() => expect(screen.getByText('No approval records for this asset')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('tab', { name: /History/ }))
    await waitFor(() => expect(screen.getByText(/Last updated/)).toBeInTheDocument())
    h.unmount()
  })

  it('resolves technique references to the live library routes and links related records', async () => {
    const h = mountAssets('asset')
    h.show()
    h.run(() => go('asset', { id: 'AS-0143' }))
    await waitFor(() => expect(screen.getAllByText('win-dc-01').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('tab', { name: /Findings & Evidence/ }))
    await waitFor(() => expect(screen.getByText('FD-011')).toBeInTheDocument())
    expect(screen.getByText('Techniques referenced:')).toBeInTheDocument()
    // The reference targets the live technique route (library routes are live since ticket 52).
    expect(hasRoute('technique')).toBe(true)
    fireEvent.click(screen.getAllByRole('button', { name: 'T1078' })[0])
    await waitFor(() => expect(currentRoute()).toMatchObject({ page: 'technique', id: 'T1078' }))
    h.unmount()
  })

  it('an asset scope change appears in the new detail without a reload', async () => {
    const h = mountAssets('asset')
    h.show()
    h.run(() => go('asset', { id: 'AS-0141' }))
    await waitFor(() => expect(screen.getAllByText('web-01').length).toBeGreaterThan(0))
    expect(screen.getAllByText('In Scope').length).toBeGreaterThan(0)
    h.run(() => changeAssetScopeTransaction(h.svc().authority, h.svc().clock, legacyCtx(''), 'AS-0141', 'out'))
    await waitFor(() => expect(screen.getAllByText('Out of Scope').length).toBeGreaterThan(0))
    expect(screen.getByText('Asset is not in approved scope')).toBeInTheDocument()
    h.unmount()
  })

  it('masks sensitive evidence for a role without viewSensitive', async () => {
    const h = mountAssets('asset', 'Casey Nguyen (Client)') // viewer — member of RT-2026-014
    h.show()
    h.run(() => go('asset', { id: 'AS-0143' }))
    await waitFor(() => expect(screen.getAllByText('win-dc-01').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('tab', { name: /Findings & Evidence/ }))
    await waitFor(() => expect(screen.getByText('EV-014-02')).toBeInTheDocument())
    expect(screen.getAllByText('Redacted (sensitive)').length).toBeGreaterThan(0)
    expect(screen.queryByText(/evidence-027\.png/)).not.toBeInTheDocument()
    h.unmount()
    const t = mountAssets('asset', 'Taylor Chen') // operator — viewSensitive granted
    t.show()
    t.run(() => go('asset', { id: 'AS-0143' }))
    await waitFor(() => expect(screen.getAllByText('win-dc-01').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('tab', { name: /Findings & Evidence/ }))
    await waitFor(() => expect(screen.getByText(/evidence-027\.png/)).toBeInTheDocument())
    t.unmount()
  })

  it('an asset in a project without a membership grant is not found (no existence leak)', async () => {
    const h = mountAssets('asset', 'Riley Brooks')
    h.show()
    h.run(() => go('asset', { id: 'AS-0201' }))
    await waitFor(() => expect(screen.getByText('Asset not found')).toBeInTheDocument())
    expect(screen.getByText('Asset AS-0201 does not exist or is not available for your account.')).toBeInTheDocument()
    expect(screen.queryByText('cloud-app-01')).not.toBeInTheDocument()
    expect(screen.queryByText('RT-2026-015')).not.toBeInTheDocument()
    h.unmount()
  })

  it('refuses an accessible asset outside the active project context with a switch action', async () => {
    const h = mountAssets('asset')
    h.show()
    h.run(() => { selectProject(P15); go('asset', { id: 'AS-0143' }) })
    await waitFor(() => expect(screen.getByText('Asset belongs to a different project')).toBeInTheDocument())
    expect(screen.getByText(/you are working in RT-2026-015/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View all projects' })).toBeInTheDocument()
    expect(screen.queryByText('192.0.2.21')).not.toBeInTheDocument()
    h.unmount()
  })

  it('gates scope changes behind role and read-only context with reasons', async () => {
    const h = mountAssets('asset', 'Casey Nguyen (Client)')
    h.show()
    h.run(() => { selectProject(P14); go('asset', { id: 'AS-0143' }) })
    await waitFor(() => expect(screen.getAllByText('win-dc-01').length).toBeGreaterThan(0))
    const out = screen.getByRole('button', { name: 'Mark out of scope' }) as HTMLButtonElement
    expect(out.disabled).toBe(true)
    expect(out.title).toBe('The Viewer role has read-only access.')
    expect(screen.getByText('Scope change: The Viewer role has read-only access.')).toBeInTheDocument()
    h.unmount()
    const a = mountAssets('asset', 'Riley Brooks')
    a.show()
    a.run(() => { selectProject(P14); go('asset', { id: 'AS-0143' }) })
    await waitFor(() => expect(screen.getAllByText('win-dc-01').length).toBeGreaterThan(0))
    const out2 = screen.getByRole('button', { name: 'Mark out of scope' }) as HTMLButtonElement
    expect(out2.disabled).toBe(true)
    expect(out2.title).toBe('Only Red Team Managers and Admins can change asset scope.')
    a.unmount()
  })
})

describe('scope classification (ticket 50)', () => {
  it('renders scoped rows and the per-project scope diff for the active project', async () => {
    const h = mountAssets('asset-scope', 'Pat Kim')
    h.show()
    await waitFor(() => expect(screen.getByText('Scope classification')).toBeInTheDocument())
    expect(screen.getAllByText('staging-erp').length).toBeGreaterThan(0)
    expect(screen.queryByText('cloud-app-01')).not.toBeInTheDocument()
    h.run(() => selectProject(P14))
    await waitFor(() => expect(screen.getByText('Scope diff & approval impact')).toBeInTheDocument())
    expect(screen.getAllByText('staging-erp').length).toBeGreaterThan(0)
    expect(screen.queryByText('purple-lab-dc')).not.toBeInTheDocument()
    // The scope diff names the approved plan and the running operation it would impact.
    expect(screen.getByText('PL-021 (v1.2)')).toBeInTheDocument()
    expect(screen.getAllByText(/OP-014/).length).toBeGreaterThan(0)
    h.unmount()
  })

  it('gates scope review behind role and project context with reasons', async () => {
    const h = mountAssets('asset-scope', 'Riley Brooks')
    h.show()
    await waitFor(() => expect(screen.getByText('Scope classification')).toBeInTheDocument())
    h.run(() => selectProject(P14))
    await waitFor(() => expect(screen.getByText(/Only Reviewers and Admins can approve or reject scope changes./)).toBeInTheDocument())
    const approve = screen.getByRole('button', { name: 'Approve Change' }) as HTMLButtonElement
    expect(approve.disabled).toBe(true)
    const request = screen.getByRole('button', { name: 'Request Scope Approval' }) as HTMLButtonElement
    expect(request.disabled).toBe(true)
    expect(request.title).toBe('Only Red Team Managers and Admins can request scope approval.')
    h.unmount()
  })
})

describe('asset service handlers', () => {
  const alex = { id: 'Alex Morgan', role: 'manager' as const }
  const p14Ctx: RequestContext = { actor: alex, projectId: P14, corr: 't' }

  it('listAssets denies a non-member specific-project read without leaking existence', () => {
    const riley = { id: 'Riley Brooks', role: 'analyst' as const }
    const res = listAssets(seed(), { actor: riley, projectId: P15, corr: 't' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.failure.kind).toBe('not-found')
  })

  it('listAssets scopes the base, counts scope KPIs and labels aggregate rows', () => {
    const riley = { id: 'Riley Brooks', role: 'analyst' as const }
    const scoped = listAssets(seed(), { actor: riley, projectId: 'all', corr: 't' })
    expect(scoped.ok && scoped.data.total).toBe(14)
    expect(scoped.ok && scoped.data.kpis).toEqual({ in: 12, out: 1, pending: 1, unclassified: 0 })
    expect(scoped.ok && scoped.data.items.every((i) => i.projectId === P14)).toBe(true)
    const specific = listAssets(seed(), p14Ctx)
    expect(specific.ok && specific.data.items.every((i) => i.projectId === undefined)).toBe(true)
  })

  it('listAssets clamps out-of-range pages into the valid range', () => {
    const high = listAssets(seed(), p14Ctx, { page: 99 })
    const low = listAssets(seed(), p14Ctx, { page: 0 })
    expect(high.ok && low.ok).toBe(true)
    if (high.ok && low.ok) {
      expect(high.data.page).toBe(2)
      expect(low.data.page).toBe(1)
    }
  })

  it('getAsset masks sensitive evidence without viewSensitive and resolves technique refs', () => {
    const casey = { id: 'Casey Nguyen (Client)', role: 'viewer' as const }
    const masked = getAsset(seed(), { actor: casey, projectId: P14, corr: 't' }, 'AS-0143')
    expect(masked.ok).toBe(true)
    if (masked.ok) {
      expect(masked.data.evidence.find((e) => e.id === 'EV-014-02')).toMatchObject({ id: 'EV-014-02', masked: true, sensitive: true, name: 'Redacted (sensitive)' })
      expect(masked.data.canViewSensitive).toBe(false)
      expect(masked.data.techniques).toEqual([{ id: 'T1078', name: 'Valid Accounts', tactic: 'Initial Access' }])
    }
    const visible = getAsset(seed(), p14Ctx, 'AS-0143')
    expect(visible.ok && visible.data.evidence.find((e) => e.id === 'EV-014-02')?.name).toBe('evidence-027.png')
  })

  it('getAsset refuses an accessible asset outside the active context with the owning project', () => {
    const res = getAsset(seed(), { actor: alex, projectId: P15, corr: 't' }, 'AS-0143')
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.failure.kind).toBe('forbidden')
      expect(res.failure.entity?.projectId).toBe(P14)
    }
  })

  it('getAsset keeps the history scoped to the asset project (no cross-project leak)', () => {
    const d = seed()
    d.audit.unshift({ id: 'AU-T50', at: d.assets[0].updated, actor: 'Sam Patel', role: 'Red Team Manager', action: 'Touched cross-project object', obj: 'AS-0143', projectId: P15, result: 'Success', reason: '' })
    const res = getAsset(d, p14Ctx, 'AS-0143')
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.data.history.some((h) => h.title.includes('Touched cross-project object'))).toBe(false)
  })

  it('getAssetScope scopes rows with impacted operations and denies non-members', () => {
    const riley = { id: 'Riley Brooks', role: 'analyst' as const }
    expect(getAssetScope(seed(), { actor: riley, projectId: P15, corr: 't' }).ok).toBe(false)
    const res = getAssetScope(seed(), p14Ctx)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.rows.length).toBe(14)
      expect(res.data.projects.map((p) => p.id)).toEqual([P14])
      const proj = res.data.projects[0]!
      expect(proj.roeVersion).toBe('ROE-014-v2')
      expect(proj.plansToRevalidate).toEqual([{ id: 'PL-021', ver: 'v1.2' }])
      expect(proj.runningOps).toEqual(['OP-014'])
      const pendingRow = res.data.rows.find((r) => r.asset.id === 'AS-0154')
      expect(pendingRow && pendingRow.impactedOps).toEqual([])
    }
  })
})
