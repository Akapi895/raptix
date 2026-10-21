import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Ban, BookOpen, CheckCircle2, FileUp, Map as MapIcon, Plus, Radar, Server, Upload, X } from 'lucide-react'
import { useServices } from '../state/services'
import { isRealMode } from '../state/mode'
import { useDirty } from '../state/session'
import type { Asset } from '../domain/entities'
import { useAssetImportRead, type AssetImportRead } from '../features/assets/import-read'
import { Banner, Button, Card, CardHeader, Check, DescList, Empty, Field, FilterBar, IdLink, Input, Kpi, Locked, Mono, PageHeader, Pager, SearchBox, Segmented, Select, Skeleton, Status, Table, Tabs, Textarea, Timeline, useGuard, cx } from '../ui/index'
import { Blocked, DTable, hashNum, Id, IdL, MoreFilters, shortDate, Trunc, withLoading } from './d-shared'
// Ticket 50: catalog list, asset detail and scope views read through the
// typed asset service via Query (feature-local handlers).
import { AssetReadError, useAssetDetail, useAssetList, useAssetPort, useAssetScope, useObservedGraph } from '../features/assets/query'
import type { AssetListItem, AssetScopeProject } from '../features/assets/service'
// Ticket 51: imports and scope changes run through the feature-local write
// transactions (validated, atomic, role-gated) via the screen handlers.
import { ASSET_TYPES, createAssetWriteHandlers, okIp, validateIdent, type AssetImportRow } from '../features/assets/writes'
import { go, selectProject, useRoute } from '../router/navigate'
import { useActiveProject, useCan, usePolicyProjects, useMe } from '../state/console'
import { useProjectStore, useToastStore, useUiStore } from '../state/stores'
import { useSessionStore } from '../state/session'
import { submitApprovalTransaction } from '../features/approvals/service'

const SCOPES: Asset['scope'][] = ['in', 'out', 'pending', 'unclassified']
const SCOPE_LABEL: Record<Asset['scope'], string> = { in: 'Approved In Scope', out: 'Approved Out of Scope', pending: 'Pending Approval', unclassified: 'Unclassified' }
const SCOPE_COLOR: Record<Asset['scope'], string> = { in: 'var(--c-ok)', out: 'var(--c-bad)', pending: 'var(--c-warn)', unclassified: 'var(--c-neutral)' }
const envOf = (a: Asset) => (['Lab', 'Staging', 'Lab', 'Isolated range'] as const)[hashNum(a.id) % 4]

/* ───────────── Scope badge with explanation popover ───────────── */
const SCOPE_WHY: Record<Asset['scope'], string> = {
  in: 'Approved by a reviewer under the ROE version shown. It can be selected as an execution target (still subject to plan approval and policy checks).',
  out: 'Explicitly excluded by the approved ROE. It can never be selected as a target and AI plans touching it are blocked.',
  pending: 'Proposed for scope but not yet approved. It is NOT in scope and is never auto-promoted; a reviewer must approve the scope change.',
  unclassified: 'Present in the inventory but not classified. It is not targetable until it is proposed and approved.',
}
export function ScopeBadge({ a }: { a: Asset }) {
  const projects = usePolicyProjects()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  const p = projects.find((x) => x.id === a.projectId)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k)
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k) }
  }, [open])
  return (
    <span ref={ref} className="relative inline-flex" onClick={(e) => e.stopPropagation()}>
      <button type="button" aria-expanded={open} aria-label={`${SCOPE_LABEL[a.scope]}: explain scope status`} onClick={() => setOpen(!open)} className="whitespace-nowrap rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"><Status kind="scope" value={a.scope} /></button>
      {open && (
        <span role="dialog" aria-label="Scope status explanation" className="absolute left-0 top-full z-40 mt-1.5 w-72 whitespace-normal rounded-xl border border-line bg-panel p-3 text-left text-xs font-normal normal-case tracking-normal text-fg shadow-xl">
          <b className="block text-sm">{SCOPE_LABEL[a.scope]}</b>
          <span className="mt-1 block text-muted">{SCOPE_WHY[a.scope]}</span>
          <span className="mt-2 block">ROE: <Mono>{p?.roeVersion || '—'}</Mono> ({p ? (p.roeStatus === 'approved' ? 'approved' : p.roeStatus === 'none' ? 'missing' : p.roeStatus) : '—'})</span>
          <span className="mt-1 block text-muted">Demo Data: scope is simulated and not enforced by a real backend.</span>
        </span>
      )}
    </span>
  )
}

/* ───────────── List (AS-01, ticket 50: typed service read + Query) ───────────── */
function AssetList() {
  const pid = useProjectStore((s) => s.pid)
  const can = useCan()
  const me = useMe()
  const confirm = useSessionStore((s) => s.confirm)
  const toast = useToastStore((s) => s.toast)
  const setFilter = useSessionStore((s) => s.setFilter)
  const persistFilters = useSessionStore((s) => s.persistFilters)
  const port = useAssetPort()
  const guard = useGuard(pid === 'all' ? undefined : pid)
  /* Filter convention: persistFilters['assets.scope'] = 'in' | 'out' | 'pending' | 'unclassified' ('in' = Approved In Scope) */
  const sc = (persistFilters['assets.scope'] as string) || ''
  const setSc = (v: string) => setFilter('assets.scope', v)
  const [q, setQ] = useState(''), [ty, setTy] = useState(''), [ow, setOw] = useState(''), [os, setOs] = useState('')
  const [page, setPage] = useState(1)
  const [sel, setSel] = useState<string[]>([])
  /* The one catalog read: scope-checked typed service; rows, scope KPIs and
     filter options derive from the actor's accessible projects only. */
  const list = useAssetList({ q: q || undefined, type: ty || undefined, scope: sc || undefined, owner: ow || undefined, os: os || undefined, page: page > 1 ? page : undefined })
  useEffect(() => { setPage(1); setSel([]) }, [q, ty, sc, ow, os])
  const read = list.data
  const rows = read?.items ?? []
  const owners = read?.owners ?? []
  const filtered = !!(q || ty || sc || ow || os)
  const clear = () => { setQ(''); setTy(''); setSc(''); setOw(''); setOs('') }
  /* Selection is page-scoped (server-side pagination): a page or filter change resets it. */
  const selected = rows.filter((r) => sel.includes(r.asset.id))
  const notIn = selected.filter((r) => r.asset.scope !== 'in')
  const addWhy = pid === 'all' ? 'Select a specific project to add assets.' : guard.ro ? guard.reason : !can('editScope') ? 'Only Red Team Managers and Admins can add assets to scope.' : ''
  const toggle = (id: string, on: boolean) => setSel((s) => (on ? [...s, id] : s.filter((x) => x !== id)))
  const allOnPage = rows.length > 0 && rows.every((r) => sel.includes(r.asset.id))
  /* Ticket 51: bulk scope changes run through the role-gated transaction; the
     handler's refusal (with its reason) surfaces instead of a silent flip. */
  const write = useMemo(() => createAssetWriteHandlers(port, { id: me.name, role: me.role }, pid), [port, me.name, me.role, pid])
  const bulkOutMut = useMutation({
    mutationFn: async (input: { ids: string[]; reason: string }) => {
      const results = await Promise.all(input.ids.map((id) => write.changeScope(id, 'out', { action: 'Marked out of scope (bulk)', reason: input.reason })))
      return results.find((r) => !r.ok) ?? results[0]
    },
    onSuccess: (res) => {
      if (!res) return
      if (res.ok) { toast(`${sel.length} assets marked out of scope.`, 'warn'); setSel([]) }
      else toast(res.failure.message, 'bad')
    },
  })
  const bulkOut = () => confirm({
    title: `Mark ${selected.length} assets out of scope?`, danger: true, confirmLabel: 'Mark out of scope', reasonLabel: 'Reason', reasonRequired: true,
    body: <>Out-of-scope assets will not appear in the target list of new operations{selected.some((r) => r.asset.scope === 'in') ? '. Some are currently in approved scope; the change is recorded in the audit log.' : '.'}</>,
    onConfirm: (r) => bulkOutMut.mutate({ ids: selected.map((x) => x.asset.id), reason: r }),
  })
  const pickPlaybook = () => { setFilter('operation-new.assets', selected.filter((r) => r.asset.scope === 'in').map((r) => r.asset.id)); go('playbooks') }
  return (
    <>
      <PageHeader title="Assets" sub="Asset inventory and scope status by project. Assets outside approved scope cannot be selected as targets."
        actions={<>
          <Button icon={MapIcon} onClick={() => go('asset-scope')}>Scope map</Button>
          {/* Import/Add change project scope: only offered inside a project, never as disabled global CTAs (plan 2026-10-16 §5). */}
          {pid !== 'all' && <>
            <Button icon={Upload} disabled={!!addWhy} title={addWhy || 'Import assets from CSV'} onClick={() => go('asset-new', { tab: 'bulk' })}>Import</Button>
            <Button variant="primary" icon={Plus} disabled={!!addWhy} title={addWhy || 'Add an asset'} onClick={() => go('asset-new')}>Add Asset</Button>
          </>}
        </>} />
      {addWhy && pid !== 'all' && <div className="-mt-2 mb-3"><Locked reason={`Add Asset: ${addWhy}`} /></div>}
      {list.isPending ? (
        <div aria-busy="true" aria-label="Loading assets"><Skeleton className="h-96" /></div>
      ) : list.isError ? (
        <Empty icon={Server} title="Assets could not be loaded" action={<Button onClick={() => list.refetch()}>Retry</Button>}>
          {(list.error as AssetReadError).failure.message}
        </Empty>
      ) : read && (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
            {SCOPES.map((s) => <Kpi key={s} label={SCOPE_LABEL[s]} value={read.kpis[s]} tone={({ in: 'ok', out: 'bad', pending: 'warn', unclassified: 'neutral' } as const)[s]} onClick={() => setSc(sc === s ? '' : s)} sub={s === 'pending' ? 'Stays Pending until a reviewer approves, even if proposed in scope' : sc === s ? 'Filter active, click to clear' : 'Click to filter'} />)}
          </div>
          <FilterBar>
            <SearchBox className="w-64" value={q} onChange={setQ} placeholder="Search name, IP, hostname or URL" />
            <Select className="!w-44" aria-label="Scope" value={sc} onChange={(e) => setSc(e.target.value)}><option value="">All scope states</option>{SCOPES.map((s) => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}</Select>
            <Select className="!w-36" aria-label="Type" value={ty} onChange={(e) => setTy(e.target.value)}><option value="">All types</option>{ASSET_TYPES.map((t) => <option key={t}>{t}</option>)}</Select>
            <MoreFilters active={[ow, os].filter(Boolean).length}>
              <Select aria-label="Owner" value={ow} onChange={(e) => setOw(e.target.value)}><option value="">All owners</option>{owners.map((o) => <option key={o}>{o}</option>)}</Select>
              <Select aria-label="OS" value={os} onChange={(e) => setOs(e.target.value)}><option value="">All OS</option><option>Windows</option><option>Linux</option></Select>
            </MoreFilters>
            {filtered && <Button variant="ghost" size="sm" icon={X} onClick={clear}>Clear filters</Button>}
          </FilterBar>
          {sel.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-accent/40 bg-accent/10 px-4 py-2.5 text-sm">
              <b>{sel.length} {sel.length === 1 ? 'asset' : 'assets'} selected</b>
              {notIn.length > 0 && <span className="text-xs text-warn">{notIn.length} not in scope, so they will not be used as targets.</span>}
              <span className="ml-auto flex flex-wrap gap-2">
                <Button size="sm" icon={BookOpen} onClick={pickPlaybook} disabled={selected.length === notIn.length} title={selected.length === notIn.length ? 'None of the selected assets are in scope. Request a scope change first.' : 'Choose a playbook for the in-scope assets'}>Choose playbook</Button>
                <Button size="sm" variant="danger" icon={Ban} onClick={bulkOut} disabled={!can('editScope') || guard.ro || pid === 'all'} title={pid === 'all' ? 'Select a specific project.' : guard.ro ? guard.reason : !can('editScope') ? 'Requires scope management permission.' : 'Mark out of scope'}>Mark out of scope</Button>
                <Button size="sm" variant="ghost" onClick={() => setSel([])}>Clear selection</Button>
              </span>
            </div>
          )}
          {sc && <div className="-mt-2 mb-3 flex flex-wrap items-center gap-2 text-xs text-muted">Filtered by scope: <b className="text-fg">{SCOPE_LABEL[sc as Asset['scope']] || sc}</b><button className="text-accent hover:underline" onClick={() => setSc('')}>Clear scope filter</button></div>}
          <DTable
            rows={rows} rowKey={(r) => r.asset.id} onRow={(r) => go('asset', { id: r.asset.id })}
            empty={filtered ? <Empty icon={Server} title="No assets match the filters" action={<Button onClick={clear}>Clear filters</Button>}>Try relaxing the filters.</Empty> : <Empty icon={Server} title="0 assets in this project" action={<Button variant="primary" icon={Plus} disabled={!!addWhy} title={addWhy} onClick={() => go('asset-new')}>Add Asset</Button>}>No approved or pending assets yet, so no operation can pick a target. Add assets manually, import a CSV, or use Simulated Preview discovery; imports start as Pending Approval.</Empty>}
            cols={[
              { key: 'id', header: 'Asset ID', width: '110px', render: (r) => <Id className="text-accent">{r.asset.id}</Id> },
              { key: 'sel', header: <Check checked={allOnPage} onChange={(v) => setSel(v ? rows.map((r) => r.asset.id) : [])} label={<span className="sr-only">Select all on this page</span>} />, width: '44px', render: (r) => <span onClick={(e) => e.stopPropagation()}><Check checked={sel.includes(r.asset.id)} onChange={(v) => toggle(r.asset.id, v)} label={<span className="sr-only">Select {r.asset.name}</span>} /></span> },
              { key: 'n', header: 'Name', render: (r) => <Trunc max="max-w-[180px]">{r.asset.name}</Trunc> },
              { key: 'i', header: 'Identifier', hideBelow: 'md', render: (r) => <div><span title={r.asset.ident} className="block max-w-[200px] truncate"><Mono className="text-muted">{r.asset.ident}</Mono></span><div><Mono className="text-xs text-muted">{r.asset.ip}</Mono></div></div> },
              { key: 't', header: 'Type', hideBelow: 'md', render: (r) => r.asset.type },
              { key: 'o', header: 'Owner', hideBelow: 'lg', render: (r) => <Trunc max="max-w-[140px]">{r.asset.owner}</Trunc> },
              { key: 'env', header: 'Environment', hideBelow: 'lg', render: (r) => envOf(r.asset) },
              { key: 'os', header: 'OS', hideBelow: 'lg', render: (r) => r.asset.os },
              ...(pid === 'all' ? [{ key: 'p', header: 'Project', render: (r: AssetListItem) => <span className="text-xs">{r.projectId}</span> }] : []),
              { key: 's', header: 'Scope', render: (r) => <ScopeBadge a={r.asset} /> },
              { key: 'src', header: 'Data source', hideBelow: 'lg', render: (r) => r.asset.source },
              { key: 'u', header: 'Last updated (UTC+7)', hideBelow: 'lg', render: (r) => <span className="whitespace-nowrap text-xs text-muted">{shortDate(r.asset.updated)}</span> },
            ]}
          />
          <Pager page={read.page} pages={Math.max(1, Math.ceil(read.total / read.pageSize))} setPage={setPage} total={read.total} />
          <p className="mt-3 text-xs text-muted">Assets marked “{SCOPE_LABEL.unclassified}” or “{SCOPE_LABEL.pending}” stay in the inventory but are never selected automatically for execution.</p>
        </>
      )}
    </>
  )
}

/* ───────────── Scope diff & approval impact (AS-V3-03, ticket 50: typed scope read) ───────────── */
const bumpV = (v: string) => (/v\d+$/.test(v) ? v.replace(/v(\d+)$/, (_, n) => 'v' + (+n + 1)) : `${v} (proposed)`)
function ScopeDiff({ pending, proj, impactedOps }: { pending: Asset[]; proj?: AssetScopeProject; impactedOps: string[] }) {
  if (!proj) return <Card className="mb-4"><p className="text-sm text-muted">Select a project to compare its approved ROE against the proposed version.</p></Card>
  const approved = proj.roeStatus === 'approved'
  const apr = proj.pendingScopeApproval
  return (
    <Card className="mb-4">
      <CardHeader title="Scope diff & approval impact" sub={approved ? <>Approved <Mono>{proj.roeVersion}</Mono> vs proposed <Mono>{bumpV(proj.roeVersion)}</Mono></> : <>Current <Mono>{proj.roeVersion}</Mono> is {proj.roeStatus}; pending assets are reviewed together with the ROE.</>}
        actions={apr ? <Button size="sm" onClick={() => go('approval', { id: apr.id })}>Open review {apr.id}</Button> : <Button size="sm" onClick={() => go('project', { id: proj.id, tab: 'scope' })}>Open scope & ROE</Button>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <div className="mb-1.5 text-xs font-medium text-muted">Assets</div>
          <ul className="divide-y divide-line rounded-lg border border-line text-sm">
            {pending.map((a) => <li key={a.id} className="flex flex-wrap items-center gap-2 px-3 py-2"><span className="rounded bg-ok/10 px-1.5 text-xs font-medium text-ok">+ Add</span><span className="font-medium">{a.name}</span><Id className="text-xs text-muted">{a.id}</Id><span className="ml-auto text-xs text-muted">Owner: {a.owner}</span></li>)}
            <li className="flex items-center gap-2 px-3 py-2 text-xs text-muted"><span className="rounded bg-bad/10 px-1.5 font-medium text-bad">− Remove</span>None proposed</li>
          </ul>
          <p className="mt-1.5 text-xs text-muted">Owner consent: the listed owner must confirm each added asset before approval. Consent is not recorded automatically.</p>
        </div>
        <DescList cols={1} items={[
          { k: 'Time window', v: <span>{proj.window} <span className="text-xs text-muted">(unchanged)</span></span> },
          { k: 'Approved plans to re-validate', v: proj.plansToRevalidate.length ? proj.plansToRevalidate.map((p) => <span key={p.id} className="mr-2 whitespace-nowrap">{p.id} ({p.ver})</span>) : 'None' },
          { k: 'Ready operations', v: proj.readyOps.length ? <span>{proj.readyOps.join(', ')}: returned to Draft, preflight must be re-run</span> : 'None' },
          { k: 'Running operations', v: proj.runningOps.length ? <span>{proj.runningOps.join(', ')}: keep running under current approved policy; new assets are not targetable until approved</span> : 'None' },
          { k: 'Operations referencing pending assets', v: impactedOps.length ? impactedOps.join(', ') : 'None' },
        ]} />
      </div>
    </Card>
  )
}

/* ───────────── Scope map + review (AS-04, asset-scope, ticket 50: typed scope read) ───────────── */
function AssetScope() {
  const pid = useProjectStore((s) => s.pid)
  const can = useCan()
  const me = useMe()
  const services = useServices()
  const confirm = useSessionStore((s) => s.confirm)
  const toast = useToastStore((s) => s.toast)
  const guard = useGuard(pid === 'all' ? undefined : pid)
  const scope = useAssetScope()
  const read = scope.data
  const all = read?.rows.map((r) => r.asset) ?? []
  const impactedOf = (id: string) => read?.rows.find((r) => r.asset.id === id)?.impactedOps ?? []
  const [q, setQ] = useState(''), [zone, setZone] = useState<'' | Asset['scope']>(''), [view, setView] = useState<'map' | 'table'>('map')
  const [selId, setSelId] = useState('')
  const rows = all.filter((a) => (!q || (a.name + a.ident + a.ip).toLowerCase().includes(q.toLowerCase())))
  const sel = all.find((a) => a.id === selId)
  const pending = all.filter((a) => a.scope === 'pending')
  const W = 760, H = 440
  const quad = (i: number) => ({ x: (i % 2) * (W / 2) + 8, y: Math.floor(i / 2) * (H / 2) + 8, w: W / 2 - 16, h: H / 2 - 16 })
  /* The reviewed project: the active project when specific, the selected asset's project in aggregate. */
  const proj = pid !== 'all' ? read?.projects.find((p) => p.id === pid) : sel ? read?.projects.find((p) => p.id === sel.projectId) : undefined
  const reviewWhy = pid === 'all' ? 'Select a specific project to review scope changes.' : guard.ro ? guard.reason : !can('approve') ? 'Only Reviewers and Admins can approve or reject scope changes.' : ''
  const reqWhy = pid === 'all' ? 'Select a specific project to request scope approval.' : guard.ro ? guard.reason : !can('editScope') ? 'Only Red Team Managers and Admins can request scope approval.' : ''
  /* Ticket 51: the review decision flips each pending asset through the
     role-gated transaction; refusals surface with the handler's reason. */
  const port = useAssetPort()
  const write = useMemo(() => createAssetWriteHandlers(port, { id: me.name, role: me.role }, pid), [port, me.name, me.role, pid])
  const reviewMut = useMutation({
    mutationFn: async (input: { decision: 'approved' | 'rejected'; reason: string }) => {
      const action = input.decision === 'approved' ? 'Approved scope change' : 'Rejected scope change'
      const scope: Asset['scope'] = input.decision === 'approved' ? 'in' : 'unclassified'
      const results = await Promise.all(pending.map((a) => write.changeScope(a.id, scope, { action, reason: input.reason })))
      return results.find((r) => !r.ok) ?? results[0]
    },
    onSuccess: (res, vars) => {
      if (!res) return
      if (res.ok) toast(vars.decision === 'approved' ? 'Scope change approved.' : 'Scope change rejected.', vars.decision === 'approved' ? undefined : 'warn')
      else toast(res.failure.message, 'bad')
    },
  })
  const approve = () => confirm({
    title: `Approve scope change for ${pending.length} ${pending.length === 1 ? 'asset' : 'assets'}?`, confirmLabel: 'Approve Change', reasonLabel: 'Approval note', reasonRequired: true,
    body: <>The assets below will become <b>In Scope</b> under {proj?.roeVersion}. Plans, checks and runbooks that referenced the previous scope will be marked for re-validation.</>,
    onConfirm: (r) => reviewMut.mutate({ decision: 'approved', reason: r }),
  })
  const reject = () => confirm({
    title: `Reject scope change for ${pending.length} ${pending.length === 1 ? 'asset' : 'assets'}?`, danger: true, confirmLabel: 'Reject Change', reasonLabel: 'Reason for rejection', reasonRequired: true,
    body: <>The assets will return to <b>Unclassified</b> and remain unavailable as targets. The requester is notified with your reason.</>,
    onConfirm: (r) => reviewMut.mutate({ decision: 'rejected', reason: r }),
  })
  // Real mode raises scope changes from the Scope revisions panel; the mock approval transaction has no real counterpart here.
  const requestApproval = () => (isRealMode() ? toast('Scope change requests are raised from the Scope revisions panel in real mode.', 'info') : confirm({
    title: 'Request scope approval?', confirmLabel: 'Submit request', reasonLabel: 'Justification', reasonRequired: true,
    body: <>A scope change request covering {pending.length || 'the selected'} pending {pending.length === 1 ? 'asset' : 'assets'} is sent to the reviewer. Nothing becomes in scope until it is approved.</>,
    onConfirm: (r) => { /* The legacy `A.submitApproval` entry's exact transaction + request context. */ submitApprovalTransaction(services.authority, services.clock, { actor: { id: me.name, role: me.role }, projectId: pid, corr: 'legacy' }, { projectId: pid, type: 'Scope change', note: r, diff: pending.map((a) => `${a.name} → in scope`).join(', ') || 'Scope review' }); toast('Scope approval requested.', 'info') },
  }))
  const impactedOps = [...new Set(pending.flatMap((a) => impactedOf(a.id)))]
  return (
    <>
      <PageHeader back={{ label: 'Assets', to: () => go('assets') }} title="Scope Map & Review"
        sub={`Group assets by scope classification and review pending changes.${proj ? ` ROE ${proj.roeVersion}.` : ''} This is not an attack path diagram.`}
        meta={proj ? <Status kind="roe" value={proj.roeStatus} /> : undefined}
        actions={<Button variant="primary" disabled={!!reqWhy || !pending.length} title={reqWhy || (!pending.length ? 'No pending assets. Propose a scope change on an asset first.' : 'Request scope approval')} onClick={requestApproval}>Request Scope Approval</Button>} />
      {reqWhy && pid !== 'all' && <div className="-mt-2 mb-3"><Locked reason={`Request Scope Approval: ${reqWhy}`} /></div>}
      {scope.isPending ? (
        <div aria-busy="true" aria-label="Loading scope map"><Skeleton className="h-96" /></div>
      ) : scope.isError || !read ? (
        <Empty icon={MapIcon} title="Scope map could not be loaded" action={<Button onClick={() => scope.refetch()}>Retry</Button>}>
          {scope.isError ? (scope.error as AssetReadError).failure.message : 'No scope data available.'}
        </Empty>
      ) : !all.length ? <Empty icon={MapIcon} title="No assets to display" action={<Button onClick={() => go('assets')}>Back to assets</Button>}>There is no map or relationship data yet. Add assets first.</Empty> : (
        <>
          <div className="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)_320px]">
            <Card>
              <CardHeader title="Legend & groups" />
              <ul className="space-y-1.5">
                <li><button onClick={() => setZone('')} className={cx('flex h-10 w-full items-center justify-between rounded-lg px-3 text-sm hover:bg-hover', zone === '' && 'bg-hover')}>All<span className="text-muted">{all.length}</span></button></li>
                {SCOPES.map((s) => (
                  <li key={s}><button onClick={() => setZone(zone === s ? '' : s)} aria-pressed={zone === s} className={cx('flex h-10 w-full items-center gap-2 rounded-lg px-3 text-sm hover:bg-hover', zone === s && 'bg-hover')}>
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: SCOPE_COLOR[s] }} aria-hidden />{SCOPE_LABEL[s]}<span className="ml-auto text-muted">{all.filter((a) => a.scope === s).length}</span>
                  </button></li>
                ))}
              </ul>
              <SearchBox className="mt-3" value={q} onChange={setQ} placeholder="Search assets" />
              <p className="mt-3 text-xs text-muted">Assets cannot be dragged into scope. Every change goes through the ROE approval process.</p>
            </Card>
            <Card pad={false} className="min-w-0 p-4">
              <div className="mb-3 flex items-center justify-between"><h3 className="text-[15px] font-semibold">Scope classification</h3><Segmented value={view} onChange={setView} options={[{ id: 'map', label: 'Map' }, { id: 'table', label: 'Table' }]} /></div>
              {view === 'map' ? (
                <div className="no-scrollbar overflow-x-auto"><svg viewBox={`0 0 ${W} ${H}`} className="min-w-[560px] w-full" role="group" aria-label="Asset scope map">
                  {SCOPES.map((s, i) => {
                    const z = quad(i)
                    const items = rows.filter((a) => a.scope === s)
                    const dim = zone && zone !== s
                    return (
                      <g key={s} opacity={dim ? 0.3 : 1}>
                        <rect x={z.x} y={z.y} width={z.w} height={z.h} rx={12} fill={SCOPE_COLOR[s]} fillOpacity={0.07} stroke={SCOPE_COLOR[s]} strokeOpacity={0.5} strokeDasharray={s === 'unclassified' || s === 'pending' ? '5 4' : undefined} />
                        <text x={z.x + 14} y={z.y + 24} fontSize="13" fontWeight="600" fill="var(--c-fg)">{SCOPE_LABEL[s]} · {items.length}</text>
                        {items.length === 0 && <text x={z.x + 14} y={z.y + 52} fontSize="12" fill="var(--c-muted)">No assets</text>}
                        {items.slice(0, 12).map((a, k) => {
                          const cx_ = z.x + 40 + (k % 5) * 70, cy = z.y + 66 + Math.floor(k / 5) * 62
                          const on = selId === a.id
                          return (
                            <g key={a.id} tabIndex={0} role="button" aria-label={`${a.name}, ${SCOPE_LABEL[s]}`} className="cursor-pointer outline-none" onClick={() => setSelId(a.id)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setSelId(a.id)}>
                              <circle cx={cx_} cy={cy} r={on ? 19 : 16} fill="var(--c-panel)" stroke={SCOPE_COLOR[s]} strokeWidth={on ? 3 : 1.5} />
                              <text x={cx_} y={cy + 4} fontSize="10" textAnchor="middle" fill="var(--c-fg)" fontWeight="600">{s === 'in' ? '✓' : s === 'out' ? '✕' : s === 'pending' ? '…' : '?'}</text>
                              <text x={cx_} y={cy + 32} fontSize="10" textAnchor="middle" fill="var(--c-muted)">{a.name.length > 11 ? a.name.slice(0, 10) + '…' : a.name}</text>
                            </g>
                          )
                        })}
                        {items.length > 12 && <text x={z.x + z.w - 14} y={z.y + 24} fontSize="11" textAnchor="end" fill="var(--c-muted)">+{items.length - 12} more (see table)</text>}
                      </g>
                    )
                  })}
                </svg></div>
              ) : (
                <Table dense rows={rows.filter((a) => !zone || a.scope === zone)} rowKey={(a) => a.id} selectedKey={selId} onRow={(a) => setSelId(a.id)} empty={<Empty title="No matching assets" />}
                  cols={[{ key: 'n', header: 'Asset', render: (a) => <span className="font-medium">{a.name}</span> }, { key: 'i', header: 'IP', hideBelow: 'md', render: (a) => <Mono className="text-muted">{a.ip}</Mono> }, { key: 's', header: 'Scope', render: (a) => <Status kind="scope" value={a.scope} /> }]} />
              )}
            </Card>
            <Card>
              <CardHeader title="Asset details" />
              {!sel ? <p className="text-sm text-muted">Select an asset on the map or in the table to see its details and related ROE.</p> : (
                <div className="space-y-4">
                  <div><div className="text-base font-semibold">{sel.name}</div><Mono className="text-muted">{sel.ident}</Mono></div>
                  <Status kind="scope" value={sel.scope} />
                  <DescList cols={1} items={[{ k: 'Type / OS', v: `${sel.type} · ${sel.os}` }, { k: 'IP address', v: <Mono>{sel.ip}</Mono> }, { k: 'Owner', v: sel.owner }, { k: 'Project', v: sel.projectId }, { k: 'ROE', v: proj ? `${proj.roeVersion} (${proj.roeStatus === 'approved' ? 'approved' : proj.roeStatus === 'pending' ? 'pending review' : 'not approved'})` : '—' }]} />
                  {sel.scope !== 'in' && <p className="rounded-lg border border-warn/30 bg-warn/10 p-3 text-xs text-warn">This asset is not in approved scope and cannot be selected as an execution target.</p>}
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => go('asset', { id: sel.id })}>View details</Button>
                    <Button size="sm" onClick={() => go('project', { id: sel.projectId, tab: 'scope' })}>Open project scope & ROE</Button>
                  </div>
                </div>
              )}
            </Card>
          </div>
          <h3 className="mb-3 mt-6 text-[15px] font-semibold">Scope change review</h3>
          {!pending.length ? <Card><p className="text-sm text-muted">No scope changes are awaiting review{pid === 'all' ? ' in the projects you can access' : ' in this project'}. Propose a change from an asset's detail page.</p></Card> : (
            <>
              <ScopeDiff pending={pending} proj={proj} impactedOps={impactedOps} />
              <Table rows={pending} rowKey={(a) => a.id} onRow={(a) => go('asset', { id: a.id })}
                cols={[
                  { key: 'n', header: 'Asset', render: (a) => <div><span className="font-medium">{a.name}</span><div><Mono className="text-xs text-muted">{a.ip}</Mono></div></div> },
                  { key: 'b', header: 'Before', render: () => <Status kind="scope" value="unclassified" size="sm" /> },
                  { key: 'af', header: 'After (if approved)', render: () => <Status kind="scope" value="in" size="sm" /> },
                  { key: 'j', header: 'Justification', hideBelow: 'md', render: (a) => <span className="text-xs text-muted">Proposed by {a.owner} via {a.source}</span> },
                  { key: 'ops', header: 'Operations affected', hideBelow: 'lg', render: (a) => impactedOf(a.id).join(', ') || <span className="text-muted">None</span> },
                ]} />
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button variant="primary" icon={CheckCircle2} disabled={!!reviewWhy} title={reviewWhy || 'Approve all pending scope changes'} onClick={approve}>Approve Change</Button>
                <Button variant="danger" icon={Ban} disabled={!!reviewWhy} title={reviewWhy || 'Reject pending scope changes'} onClick={reject}>Reject</Button>
                {reviewWhy && <Locked reason={reviewWhy} />}
              </div>
              <p className="mt-2 text-xs text-muted">A reason is required for both approval and rejection. Accessible projects: {read.accessibleCount}.</p>
            </>
          )}
        </>
      )}
    </>
  )
}

/* ───────────── Add asset (AS-02) ───────────── */
type Row = AssetImportRow & { err: string; dup: boolean; keep: boolean; k: number }

/** Applies the feature validator to preview rows: err/dup/keep derive from the one authority the import transaction enforces (ticket 51). */
const applyIssues = (db: AssetImportRead, pid: string, rows: Row[], onlyK?: number): Row[] => {
  const byIndex = new Map(db.validate(pid, rows).map((i) => [i.index, i] as const))
  return rows.map((r, i) => {
    if (onlyK !== undefined && r.k !== onlyK) return r
    const issue = byIndex.get(i)
    const err = issue && !issue.duplicate ? issue.reasons.join('; ') : ''
    const dup = !!issue?.duplicate
    return { ...r, err, dup, keep: !err && !dup }
  })
}

function ImportPreview({ rows, setRows, onConfirm, disabled, why, db, pid }: { rows: Row[]; setRows: (r: Row[]) => void; onConfirm: () => void; disabled: boolean; why: string; db: AssetImportRead; pid: string }) {
  const fix = (r: Row, ident: string) => setRows(applyIssues(db, pid, rows.map((x) => (x.k === r.k ? { ...x, ident } : x)), r.k))
  const kept = rows.filter((r) => r.keep && !r.err)
  const bad = rows.filter((r) => r.err).length, dups = rows.filter((r) => r.dup && !r.err).length
  return (
    <div className="mt-4">
      <div className="mb-2 flex flex-wrap items-center gap-3 text-sm"><b>Preview of {rows.length} {rows.length === 1 ? 'record' : 'records'}</b>
        {bad > 0 && <span className="text-xs text-bad">{bad} with invalid syntax (cannot be imported)</span>}
        {dups > 0 && <span className="text-xs text-warn">{dups} duplicate existing assets, skipped by default. Tick to import anyway.</span>}
      </div>
      <Banner tone="info">Imported records start as Pending Review. They are never placed in scope automatically: submit a Scope Change afterwards so a reviewer can approve them under the matching ROE version. Fix invalid or duplicate identifiers in the table before importing.</Banner>
      <Table dense rows={rows} rowKey={(r) => r.name + r.k}
        cols={[
          { key: 'k', header: 'Keep', width: '56px', render: (r) => <Check checked={r.keep && !r.err} disabled={!!r.err} onChange={(v) => setRows(rows.map((x) => x === r ? { ...x, keep: v } : x))} label={<span className="sr-only">Keep {r.name}</span>} /> },
          { key: 'n', header: 'Name', render: (r) => <span className="font-medium">{r.name}</span> },
          { key: 'i', header: 'Identifier', render: (r) => r.err || r.dup ? <Input aria-label={`Fix identifier for ${r.name}`} className="!h-8 font-mono text-xs" value={r.ident} onChange={(e) => fix(r, e.target.value)} /> : <Mono>{r.ident}</Mono> },
          { key: 't', header: 'Type', hideBelow: 'md', render: (r) => r.type },
          { key: 'sc', header: 'Proposed scope', hideBelow: 'md', render: (r) => r.scope === 'in' ? 'Pending Approval' : 'Out of Scope' },
          { key: 'e', header: 'Validation', render: (r) => r.err ? <span className="text-xs text-bad">{r.err}</span> : r.dup ? <span className="text-xs text-warn">Duplicate identifier</span> : <span className="inline-flex items-center gap-1 text-xs text-ok"><CheckCircle2 size={12} />Valid</span> },
        ]} />
      <div className="mt-3 flex flex-wrap items-center gap-3"><Button variant="primary" disabled={disabled || !kept.length} title={why || (!kept.length ? 'No records are selected to import.' : 'Creates records as Pending Review')} onClick={onConfirm}>Import {kept.length} {kept.length === 1 ? 'record' : 'records'} as Pending</Button>{why && <Locked reason={why} />}</div>
    </div>
  )
}

function AssetNew() {
  const db = useAssetImportRead()
  const pid = useProjectStore((s) => s.pid)
  const project = useActiveProject()
  const can = useCan()
  const me = useMe()
  const toast = useToastStore((s) => s.toast)
  const dirty = useSessionStore((s) => s.dirty)
  const setSwitcherOpen = useUiStore((s) => s.setSwitcherOpen)
  const route = useRoute()
  const port = useAssetPort()
  const guard = useGuard(pid === 'all' ? undefined : pid)
  const [tab, setTab] = useState<'manual' | 'bulk' | 'disc'>(route.tab === 'bulk' || route.tab === 'disc' ? route.tab : 'manual')
  const blank = { type: 'Host', name: '', ident: '', ip: '', os: 'Linux', desc: '', owner: '', labels: '', scope: 'in' as 'in' | 'out', note: '' }
  const [f, setF] = useState(blank)
  const [tried, setTried] = useState(false)
  const [done, setDone] = useState<{ needs: boolean; n: number; stay?: boolean } | null>(null)
  const [paste, setPaste] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [scanning, setScanning] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const existing = db.assets.filter((a) => a.projectId === pid)
  const roeDraft = !project || ['none', 'draft'].includes(project.roeStatus)
  const why = pid === 'all' ? 'Select a specific project before adding assets.' : guard.ro ? guard.reason : !can('editScope') ? 'Only Red Team Managers and Admins can add assets.' : ''
  const isDirty = (!!(f.name || f.ident || f.desc || f.owner || f.labels || f.note) || !!paste || rows.length > 0)
  useDirty(isDirty, () => toast('Asset form draft saved.', 'info'))
  useEffect(() => { if (done && !done.needs && !done.stay && !dirty) go('assets') }, [done, dirty])

  /* Ticket 51: manual and bulk saves run through the atomic import
     transaction — the handler re-validates every row, so a refusal (with its
     per-row reasons) commits nothing and is surfaced here. */
  const write = useMemo(() => createAssetWriteHandlers(port, { id: me.name, role: me.role }, pid), [port, me.name, me.role, pid])
  const importMut = useMutation({
    mutationFn: (input: { rows: readonly AssetImportRow[]; stay?: boolean; single?: string }) => write.importRows(input.rows),
    onSuccess: (res, input) => {
      if (!res.ok) { toast(res.failure.message, 'bad'); return }
      toast(input.single ? `Asset ${input.single} saved as pending review.` : `${res.data.added} ${res.data.added === 1 ? 'asset' : 'assets'} imported as pending review.`)
      setRows([]); setPaste(''); setTried(false)
      setDone({ needs: !!res.data.needsApproval, n: res.data.added, stay: input.stay })
    },
  })

  const identErr = validateIdent(f.type, f.ident)
  const ipErr = f.ip && !okIp(f.ip.trim()) ? 'Invalid IP address (example: 192.0.2.15).' : ''
  const dupManual = existing.some((a) => a.ident.toLowerCase() === f.ident.trim().toLowerCase())
  const err = { name: f.name.trim() ? '' : 'Enter an asset name.', ident: identErr || (dupManual ? 'This identifier already exists in the project. Open that asset to update it instead of creating a duplicate.' : ''), owner: f.owner.trim() ? '' : 'Enter an owner so we know who to contact during an incident.' }
  const submit = (again: boolean) => {
    setTried(true)
    if (why || err.name || err.ident || err.owner || ipErr) return
    importMut.mutate({ rows: [{ name: f.name.trim(), ident: f.ident.trim(), ip: f.ip.trim() || undefined, type: f.type, os: f.os, owner: f.owner.trim(), scope: f.scope, source: 'Manual' }], stay: again, single: f.name.trim() })
    setF({ ...blank, type: f.type, owner: f.owner })
  }
  const parse = (text: string, source: string) => {
    const parsed = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^name\s*,/i.test(l)).map((l) => {
      const [name = '', ident = '', type = 'Host', os = 'Linux', owner = '', scope = 'in'] = l.split(',').map((x) => x.trim())
      return { name, ident, type, os, owner: owner || 'Unknown', scope: scope === 'out' ? 'out' : 'in', source }
    })
    setRows(applyIssues(db, pid, parsed.map((r, i) => ({ ...r, err: '', dup: false, keep: true, k: i + 1 } as Row))))
  }
  const sample = 'name,ident,type,os,owner,scope\nfile-lab-01,file-lab-01.example.test,Host,Windows,Infrastructure Team A,in\nintranet-lab,https://intranet.example.test,URL,Linux,Development Team A,in\nweb-lab-01,web-lab-01.example.test,Host,Linux,Infrastructure Team A,in\nlab-dmz,198.51.100.0/24,Subnet,—,Security Team A,out\nbad-entry,300.1.1.1,IP,—,Security Team A,in'
  const confirmImport = (src: string) => {
    importMut.mutate({ rows: rows.filter((r) => r.keep && !r.err).map(({ name, ident, type, os, owner, scope }) => ({ name, ident, type, os, owner, scope, source: src })) })
  }
  const scan = () => {
    setScanning(true)
    setTimeout(() => {
      setScanning(false)
      const found = [['disc-lab-01', 'disc-lab-01.example.test', 'Host', 'Linux'], ['disc-lab-02', 'disc-lab-02.example.test', 'Host', 'Windows'], ['web-lab-01', 'web-lab-01.example.test', 'Host', 'Linux']]
      setRows(applyIssues(db, pid, found.map(([name, ident, type, os], k) => ({ k: k + 1, name, ident, type, os, owner: 'Unknown', scope: 'in' as const, source: 'Discovery', err: '', dup: false, keep: true } as Row))))
    }, 1200)
  }
  const onFile = (file?: File) => { if (!file) return; const rd = new FileReader(); rd.onload = () => { const t = String(rd.result || ''); setPaste(t); parse(t, 'CSV import') }; rd.readAsText(file) }
  const cancel = () => go('assets')

  return (
    <>
      <PageHeader back={{ label: 'Assets', to: () => go('assets') }} title="Add Asset" sub={project ? `Project: ${project.id} — ${project.name}` : 'Add manually, import in bulk or run discovery (simulated).'} />
      {pid === 'all' && <Banner tone="warn" title="Select a specific project" action={<Button size="sm" onClick={() => setSwitcherOpen(true)}>Select project</Button>}>Assets cannot be added in “All Projects” mode. Choose a project in the top bar to continue.</Banner>}
      {pid !== 'all' && why && <Banner tone="bad" title="You cannot add assets">{why}</Banner>}
      {done && (done.needs
        ? <Banner tone="warn" title="Approved scope changed. ROE re-approval required" action={<><Button size="sm" onClick={() => go('asset-scope')}>Review scope</Button> <Button size="sm" variant="primary" onClick={() => go('assets')}>Back to assets</Button></>}>{done.n} {done.n === 1 ? 'asset was' : 'assets were'} added as Pending Approval. The project has an approved ROE, so a new ROE version is submitted for review. Assets can be used as targets only after a reviewer approves them.</Banner>
        : <Banner tone="ok" title={`${done.n} ${done.n === 1 ? 'asset' : 'assets'} saved as Pending Review`} action={<><Button size="sm" variant="primary" onClick={() => go('asset-scope')}>Submit Scope Change</Button> <Button size="sm" onClick={() => go('assets')}>Back to assets</Button></>}>Records stay Pending and are not targetable. Submit a Scope Change for review under {project?.roeVersion || 'the current ROE'}. You can keep adding more assets.</Banner>)}
      <Tabs value={tab} onChange={(t) => setTab(t as typeof tab)} tabs={[{ id: 'manual', label: 'Manual' }, { id: 'bulk', label: 'Bulk Import' }, { id: 'disc', label: 'Discovery Preview' }]} />
      {tab === 'manual' && (
        <Card className="max-w-3xl">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Asset type" required><Select value={f.type} disabled={!!why} onChange={(e) => setF({ ...f, type: e.target.value })}>{ASSET_TYPES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
            <Field label="Operating system"><Select value={f.os} disabled={!!why} onChange={(e) => setF({ ...f, os: e.target.value })}><option>Linux</option><option>Windows</option><option>—</option></Select></Field>
            <Field label="Asset name" required error={tried && err.name}><Input disabled={!!why} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. file-lab-01" /></Field>
            <Field label={f.type === 'IP' ? 'IP address' : f.type === 'URL' ? 'URL' : f.type === 'Subnet' ? 'Subnet (CIDR)' : 'Hostname'} required error={(tried || f.ident) && err.ident} hint="Original data is kept as entered and is not normalized."><Input disabled={!!why} value={f.ident} onChange={(e) => setF({ ...f, ident: e.target.value })} placeholder={f.type === 'IP' ? '192.0.2.15' : f.type === 'URL' ? 'https://app.example.test' : f.type === 'Subnet' ? '198.51.100.0/24' : 'file-lab-01.example.test'} className="font-mono" /></Field>
            <Field label="IP address" error={tried && ipErr} hint="Optional. Use documentation ranges only (192.0.2.x, 198.51.100.x, 203.0.113.x)."><Input disabled={!!why} value={f.ip} onChange={(e) => setF({ ...f, ip: e.target.value })} placeholder="203.0.113.20" className="font-mono" /></Field>
            <Field label="Owner" required error={tried && err.owner}><Input disabled={!!why} value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })} placeholder="e.g. Infrastructure Team A" /></Field>
            <Field label="Labels" hint="Separate with commas."><Input disabled={!!why} value={f.labels} onChange={(e) => setF({ ...f, labels: e.target.value })} placeholder="lab, windows" /></Field>
            <Field label="Project"><Input value={project ? `${project.id} — ${project.name}` : 'No project selected'} disabled readOnly /></Field>
            <Field label="Description" className="sm:col-span-2"><Textarea className="min-h-16" disabled={!!why} value={f.desc} onChange={(e) => setF({ ...f, desc: e.target.value })} /></Field>
            <Field label="Proposed scope status" hint="An asset enters scope only after approval."><Select value={f.scope} disabled={!!why} onChange={(e) => setF({ ...f, scope: e.target.value as 'in' | 'out' })}><option value="in">Propose Scope Change (in scope)</option><option value="out">Out of Scope</option></Select></Field>
            <Field label="Approval note" className="sm:col-span-2"><Textarea className="min-h-16" disabled={!!why} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Why this asset should be added to scope (optional)." /></Field>
          </div>
          {project && ['active', 'approved'].includes(project.status) && project.roeStatus === 'approved' && <p className="mt-4 text-xs text-warn">ROE {project.roeVersion} is approved. Proposing an asset as in scope requires re-approval once operations exist.</p>}
          <div className="sticky bottom-0 -mx-5 mt-5 flex flex-wrap justify-end gap-2 border-t border-line bg-panel px-5 pt-4">
            <Button onClick={cancel}>Cancel</Button>
            <Button disabled={!!why} title={why} onClick={() => submit(true)}>Save and add another</Button>
            <Button variant="primary" disabled={!!why} title={why} onClick={() => submit(false)}>Save as Pending Review</Button>
          </div>
        </Card>
      )}
      {tab === 'bulk' && (
        <Card>
          <CardHeader title="Import multiple assets" sub="One line per asset: name,ident,type,os,owner,scope (scope: in | out). Types: Host, IP, URL, Application, Subnet." />
          <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files[0]) }} className="mb-3 flex flex-col items-center gap-2 rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">
            <FileUp size={22} aria-hidden />Drag and drop a .csv file here, or
            <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            <Button size="sm" icon={Upload} disabled={!!why} onClick={() => fileRef.current?.click()}>Choose file</Button>
          </div>
          <Field label="Or paste a list"><Textarea className="min-h-32 font-mono text-xs" disabled={!!why} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="name,ident,type,os,owner,scope" /></Field>
          <div className="mt-3 flex flex-wrap gap-2"><Button variant="primary" disabled={!!why || !paste.trim()} title={why || (!paste.trim() ? 'Paste content or choose a file first.' : '')} onClick={() => parse(paste, 'CSV import')}>Preview</Button><Button disabled={!!why} onClick={() => { setPaste(sample); parse(sample, 'CSV import') }}>Use sample data</Button><Button variant="ghost" onClick={() => { setPaste(''); setRows([]) }}>Clear</Button></div>
          {rows.length > 0 && <ImportPreview rows={rows} setRows={setRows} db={db} pid={pid} disabled={!!why} why={why} onConfirm={() => confirmImport('CSV import')} />}
        </Card>
      )}
      {tab === 'disc' && (
        <Card>
          <CardHeader title={<span className="flex flex-wrap items-center gap-2">Asset discovery <span className="inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-full border border-warn/30 bg-warn-soft px-2 text-xs font-medium text-warn"><Radar size={12} aria-hidden />Demo Preview</span></span>}
            sub={roeDraft ? 'The ROE is still a draft, so this only generates sample data. No network scan is run and no real asset is contacted.' : 'Simulated Preview: no real network access or scan happens. Records below are sample data and must be reviewed before import.'} />
          <Button icon={Radar} disabled={!!why || scanning} title={why} onClick={scan}>{scanning ? 'Generating…' : roeDraft ? 'Generate sample data' : 'Run simulated discovery'}</Button>
          {rows.length > 0 && !scanning && <ImportPreview rows={rows} setRows={setRows} db={db} pid={pid} disabled={!!why} why={why} onConfirm={() => confirmImport('Simulated discovery')} />}
          {!rows.length && !scanning && <p className="mt-3 text-xs text-muted">No sample results yet. Nothing has been scanned. Imported records start as Pending Review.</p>}
        </Card>
      )}
    </>
  )
}

/* ───────────── Asset detail (AS-03, ticket 50: typed service read + Query) ───────────── */
function AssetDetail() {
  const route = useRoute()
  const pid = useProjectStore((s) => s.pid)
  const can = useCan()
  const me = useMe()
  const confirm = useSessionStore((s) => s.confirm)
  const toast = useToastStore((s) => s.toast)
  const port = useAssetPort()
  const detail = useAssetDetail(route.id)
  const read = detail.data
  const tab = route.tab === 'edit' ? 'overview' : route.tab || 'overview'
  const guard = useGuard(read?.project.id)
  const back = { label: 'Assets', to: () => go('assets') }
  /* Ticket 51: scope changes run through the role-gated transaction; a
     governed-ROE proposal opens the scope-change review in the same commit. */
  const write = useMemo(() => createAssetWriteHandlers(port, { id: me.name, role: me.role }, pid), [port, me.name, me.role, pid])
  const scopeMut = useMutation({
    mutationFn: (input: { id: string; name: string; scope: Asset['scope']; reason: string }) =>
      write.changeScope(input.id, input.scope, { reason: input.reason, action: input.scope === 'out' ? 'Asset scope change reason' : undefined }),
    onSuccess: (res, input) => {
      if (!res.ok) { toast(res.failure.message, 'bad'); return }
      if (res.data.scope === 'out') toast(`${input.name} marked out of scope.`, 'warn')
      else toast(res.data.reviewRequested ? 'Scope change approval submitted.' : 'Asset proposed for scope.', 'info')
    },
  })
  if (detail.isPending) return <div aria-busy="true" aria-label="Loading asset"><Skeleton className="h-96" /></div>
  if (detail.isError || !read) {
    const failure = detail.isError ? (detail.error as AssetReadError).failure : undefined
    if (failure?.kind === 'forbidden' && failure.entity?.projectId) return <><PageHeader title={`Asset ${route.id}`} back={back} /><Blocked title="Asset belongs to a different project" actions={<><Button onClick={() => go('assets')}>Back to assets</Button><Button onClick={() => selectProject('all')}>View all projects</Button></>}>This asset belongs to {failure.entity.projectId}, but you are working in {pid}.</Blocked></>
    return <><PageHeader title="Asset not found" back={back} /><Empty icon={Server} title={`No asset “${route.id}”`} action={<Button onClick={() => go('assets')}>Back to assets</Button>}>{failure?.message || 'No asset data available.'}</Empty></>
  }
  const { asset: a, project: p, operations: ops, findings: fs, evidence: ev, agents, approvals: apprs, techniques, history: hist, canViewSensitive } = read
  const approvedScope = p.roeStatus === 'approved' && ['approved', 'active'].includes(p.status)
  const why = guard.ro ? guard.reason : !can('editScope', a.projectId) ? 'Only Red Team Managers and Admins can change asset scope.' : ''
  const toOut = () => confirm({
    title: `Mark ${a.name} out of scope?`, danger: true, confirmLabel: 'Mark out of scope', reasonLabel: 'Reason', reasonRequired: approvedScope || a.scope === 'in',
    body: <>{a.scope === 'in' ? <>This asset is in scope{approvedScope ? ` under approved ${p.roeVersion}` : ''}. </> : null}After the change it cannot be selected as a target. {ops.filter((o) => ['running', 'paused'].includes(o.status)).length ? <b>Running operations use this asset. Review them.</b> : null}</>,
    onConfirm: (r) => scopeMut.mutate({ id: a.id, name: a.name, scope: 'out', reason: r }),
  })
  const toIn = () => confirm({
    title: `Propose ${a.name} for project scope?`, confirmLabel: approvedScope ? 'Submit for approval' : 'Propose scope change', reasonLabel: 'Justification / approval note', reasonRequired: true,
    body: approvedScope ? <>The project has approved ROE {p.roeVersion}. The asset becomes <b>Pending Approval</b> and a “Scope change” request goes to the reviewer. It cannot be a target until approved.</> : <>The asset is proposed as in scope and waits for approval together with the project ROE.</>,
    onConfirm: (r) => scopeMut.mutate({ id: a.id, name: a.name, scope: 'pending', reason: r }),
  })
  return (
    <>
      <PageHeader back={back} title={<span className="flex flex-wrap items-center gap-3">{a.name}<Mono className="text-sm text-muted">{a.id}</Mono></span>} meta={<ScopeBadge a={a} />} sub={`${a.ident} · ${a.ip} · ${envOf(a)} · ROE ${p.roeVersion}`}
        actions={<>
          <Button icon={CheckCircle2} disabled={!!why || a.scope === 'in' || a.scope === 'pending'} title={why || (a.scope === 'in' ? 'Asset is already in scope.' : a.scope === 'pending' ? 'Awaiting approval.' : 'Propose adding to project scope')} onClick={toIn}>Propose Scope Change</Button>
          <Button variant="danger" icon={Ban} disabled={!!why || a.scope === 'out'} title={why || (a.scope === 'out' ? 'Asset is already out of scope.' : 'Mark out of scope')} onClick={toOut}>Mark out of scope</Button>
        </>} />
      {why && <div className="-mt-2 mb-3"><Locked reason={`Scope change: ${why}`} /></div>}
      {a.scope !== 'in' && <Banner tone="warn" title="Asset is not in approved scope" action={<Button size="sm" onClick={() => go('asset-scope')}>Open scope review</Button>}>This asset cannot be selected as an execution target until it is approved in the ROE.</Banner>}
      <Tabs value={tab} onChange={(t) => go('asset', { id: a.id, tab: t })} tabs={[{ id: 'overview', label: 'Overview' }, { id: 'scope', label: 'Scope' }, { id: 'ops', label: 'Related operations', count: ops.length }, { id: 'agents', label: 'Agents', count: agents.length }, { id: 'findings', label: 'Findings & Evidence', count: fs.length + ev.length }, { id: 'approvals', label: 'Approval history', count: apprs.length }, { id: 'history', label: 'History' }]} />
      {tab === 'overview' && <Card><CardHeader title="Attributes" /><DescList cols={3} items={[
        { k: 'Identifier', v: <Mono>{a.ident}</Mono> }, { k: 'IP address', v: <Mono>{a.ip}</Mono> }, { k: 'Type', v: a.type }, { k: 'Operating system', v: a.os }, { k: 'Owner', v: a.owner }, { k: 'Environment', v: envOf(a) },
        { k: 'Data source', v: a.source }, { k: 'Last updated', v: a.updated },
        { k: 'Project', v: <IdLink onClick={() => go('project', { id: a.projectId })}>{a.projectId}</IdLink> }, { k: 'Scope', v: <ScopeBadge a={a} /> }, { k: 'ROE version', v: <span className="flex items-center gap-2"><Mono>{p.roeVersion}</Mono><Status kind="roe" value={p.roeStatus} size="sm" /></span> }, { k: 'Operations / agents / findings / evidence', v: `${ops.length} / ${agents.length} / ${fs.length} / ${ev.length}` },
      ]} /></Card>}
      {tab === 'scope' && <Card><CardHeader title="Scope status by project" sub="An asset has a scope status only in projects you can access." />
        <Table rows={[a]} rowKey={(x) => x.id} cols={[{ key: 'p', header: 'Project', render: () => <div><div className="font-medium">{p.name}</div><Mono className="text-muted">{p.id}</Mono></div> }, { key: 's', header: 'Scope', render: (x) => <ScopeBadge a={x} /> }, { key: 'r', header: 'ROE', render: () => <span className="flex items-center gap-2"><Mono>{p.roeVersion}</Mono><Status kind="roe" value={p.roeStatus} size="sm" /></span> }, { key: 'a', header: '', render: () => <span className="flex gap-2"><Button size="sm" onClick={() => go('asset-scope')}>Scope review</Button><Button size="sm" onClick={() => go('project', { id: p.id, tab: 'scope' })}>Open scope & ROE</Button></span> }]} />
      </Card>}
      {tab === 'ops' && <Table rows={ops} rowKey={(o) => o.id} onRow={(o) => go('operation', { id: o.id })} empty={<Empty icon={Server} title="No operations use this asset yet" />} cols={[{ key: 'i', header: 'Operation', render: (o) => <Mono className="text-accent">{o.id}</Mono> }, { key: 'n', header: 'Name', render: (o) => o.name }, { key: 's', header: 'Status', render: (o) => <Status kind="op" value={o.status} /> }, { key: 'u', header: 'Updated', hideBelow: 'md', render: (o) => o.updated }]} />}
      {tab === 'findings' && <>
        {techniques.length > 0 && <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted">Techniques referenced:{techniques.map((t) => <IdL key={t.id} onClick={() => go('technique', { id: t.id })}>{t.id}</IdL>)}<span className="text-muted">{techniques.map((t) => t.name).join(', ')}</span></div>}
        <Table rows={fs} rowKey={(f) => f.id} onRow={(f) => go('finding', { id: f.id })} empty={<Empty icon={Server} title="No related findings" action={<Button onClick={() => go('findings')}>Open Findings</Button>}>No findings are linked to this asset.</Empty>} cols={[{ key: 'i', header: 'ID', render: (f) => <Mono className="text-accent">{f.id}</Mono> }, { key: 't', header: 'Title', render: (f) => f.title }, { key: 'sv', header: 'Severity', render: (f) => <Status kind="sev" value={f.severity} /> }, { key: 's', header: 'Status', render: (f) => <Status kind="finding" value={f.status} /> }, { key: 'tec', header: 'Technique', hideBelow: 'md', render: (f) => f.technique ? <IdL onClick={() => go('technique', { id: f.technique })}>{f.technique}</IdL> : '—' }]} />
        <h3 className="mb-2 mt-5 text-[15px] font-semibold">Related evidence</h3>
        {ev.length ? <div className="flex flex-wrap gap-3">{ev.map((e) => <span key={e.id} className="inline-flex items-center gap-2"><IdL onClick={() => go('evidence', { id: e.id })}>{e.id}</IdL><span className={cx('text-xs', e.masked ? 'text-warn' : 'text-muted')}>{e.masked ? 'Redacted (sensitive)' : `${e.name} · ${e.kind}`}</span></span>)}</div> : <p className="text-sm text-muted">No evidence is linked to this asset.</p>}
        {!canViewSensitive && ev.some((e) => e.masked) && <p className="mt-2 text-xs text-muted">Sensitive evidence names are redacted for your role.</p>}
      </>}
      {tab === 'agents' && <Table rows={agents} rowKey={(g) => g.id} onRow={(g) => go('agent', { id: g.id })} empty={<Empty icon={Server} title="No agents linked">No agent has run an operation that targets this asset.</Empty>} cols={[{ key: 'i', header: 'Agent', render: (g) => <Id className="text-accent">{g.id}</Id> }, { key: 'h', header: 'Hostname', render: (g) => <Mono>{g.host}</Mono> }, { key: 's', header: 'Connection', render: (g) => <Status kind="agent" value={g.status} /> }, { key: 'o', header: 'Operation', render: (g) => g.op ? <IdL onClick={() => go('operation', { id: g.op })}>{g.op}</IdL> : '—' }]} />}
      {tab === 'approvals' && <>
        <Table rows={apprs} rowKey={(x) => x.id} onRow={(x) => go('approval', { id: x.id })} empty={<Empty icon={Server} title="No approval records for this asset">{a.scope === 'in' ? `Approved in scope under ${p.roeVersion}; the original ROE approval is on the project.` : 'Propose a scope change to start an approval. Pending never becomes In Scope without a reviewer.'}</Empty>} cols={[{ key: 'i', header: 'Request', render: (x) => <Id className="text-accent">{x.id}</Id> }, { key: 't', header: 'Type', render: (x) => <span className="whitespace-nowrap">{x.type}</span> }, { key: 'b', header: 'Requested by', render: (x) => x.by }, { key: 'r', header: 'Reviewer', render: (x) => x.reviewer }, { key: 'a', header: 'Date', render: (x) => <span className="whitespace-nowrap text-xs">{shortDate(x.at)}</span> }, { key: 's', header: 'Status', render: (x) => <span className="whitespace-nowrap capitalize">{x.status}</span> }]} />
        {a.scope === 'pending' && <p className="mt-3 text-xs text-warn">This asset stays Pending Approval until a reviewer approves the scope change; it is never promoted automatically.</p>}
      </>}
      {tab === 'history' && <Card><CardHeader title="Update history" /><Timeline items={hist} /></Card>}
    </>
  )
}

/** Real mode: the observed attack-chain graph (server-redacted), listed verbatim beside the managed inventory. */
function ObservedGraphCard() {
  const graph = useObservedGraph()
  return (
    <Card className="mt-4">
      <CardHeader title="Observed graph" sub="Server-redacted nodes and edges observed during runs, listed verbatim. No attack path is reconstructed." />
      {graph.isPending ? <Skeleton className="h-16" /> : graph.isError ? (
        <Banner tone="warn" title="Graph source unavailable">{graph.error instanceof Error ? graph.error.message : 'The graph projection is not available right now.'} No substitute graph is shown.</Banner>
      ) : graph.data.nodes.length === 0 ? (
        <p className="text-sm text-muted">The graph is empty - no relationships have been observed yet.</p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted">{graph.data.nodes.length} nodes, {graph.data.edges.length} edges observed{graph.data.truncated ? ' (truncated)' : ''}.</p>
          <ul className="space-y-1">{graph.data.edges.slice(0, 50).map((e) => <li key={e.id} className="font-mono text-xs text-muted">({e.source}) -[{e.type}]-&gt; ({e.target})</li>)}</ul>
        </div>
      )}
    </Card>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- assets screen module: helper co-exported with screens
export const assetRoutes = {
  assets: withLoading(function Assets() { const route = useRoute(); return route.tab === 'scope-map' ? <AssetScope /> : <>{<AssetList />}{isRealMode() && <ObservedGraphCard />}</> }),
  'asset-new': withLoading(AssetNew),
  'asset-scope': withLoading(AssetScope),
  asset: withLoading(AssetDetail),
}
