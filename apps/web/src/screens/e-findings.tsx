import { useContext, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Bug, Download, ExternalLink, FileImage, FilePlus2, FileText, Link2, Lock, Sparkles, Eye, EyeOff, Fingerprint, Paperclip, Pencil, Plus, RotateCcw, Send, ShieldCheck, Upload } from 'lucide-react'
import { useDirty } from '../state/session'
import { useServicesOrNull } from '../state/services'
import { isRealMode } from '../real/mode'
import { captureRequestId, clearCaptureRequest } from '../real/capture-session'
import { clearFindingRequest, findingRequestId, type FindingRequestScope } from '../real/finding-session'
import { SessionContext, useSession } from '../real/session'
import { ROLE_LABEL } from '../auth/policy'
import { recordAudit } from '../features/audit/service'
import { sevLabel, addFindingCommentTransaction } from '../features/findings/service'
import { setReportFindingsLegacyTransaction } from '../features/reports/service'
import { useReportWrites } from '../features/reports/query'
import { TECHNIQUES, type Finding, type Severity } from '../data'
import { EvidenceReadError, FindingReadError, useEvidenceDetail, useEvidenceList, useFindingDetail, useFindingList, useFindingReferenceOptions, useFindingWrites } from '../features/findings/query'
import type { EvidenceDownload, EvidenceView, FindingActivityKind, FindingSort, FindingTransitionTarget } from '../features/findings/service'
import {
  Banner, Button, Card, CardHeader, Check, DescList, Drawer, Empty, Field, FilterBar, Input, Kpi, Locked, Modal, Mono, PageHeader, Pager, Person, PersonaHint, SearchBox, Segmented, Select, Sev, Skeleton, Status, Table, Tabs, Textarea, Timeline, cx, useGuard,
} from '../ui'
import { go, useRoute } from '../router/navigate'
import { realControlGap, useActiveProject, useCan, useMe, useReadOnly } from '../state/console'
import { useFindingFormRead, useFindingReportChoices, type FindingFormRead } from '../features/findings/projection'
import { useResourceScope } from './resource-scope'
import { useProjectStore, useToastStore, useUiStore } from '../state/stores'
import { useSessionStore } from '../state/session'

const SEVS: Severity[] = ['critical', 'high', 'medium', 'low', 'info']
const STATUS_LABEL: Record<string, string> = { ai_suggested: 'AI Suggested — unverified', draft: 'Draft', review: 'In Review', returned: 'Returned', confirmed: 'Confirmed', remediation: 'In Remediation', retest: 'Retest', resolved: 'Resolved' }
const activityTime = (value: string) => new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
/** Status tabs; the scoped counts come from the findings read model (ticket 31). */
const TABS: { id: string; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'confirmed', label: 'Confirmed' },
  { id: 'review', label: 'In Review' },
  { id: 'ai', label: 'AI Suggestions' },
  { id: 'drafts', label: 'Drafts' },
  { id: 'remediation', label: 'Remediation' },
]

/**
 * Delayed navigation scoped to the component's mount: a captured redirect
 * that outlives the provider must not move a later mount's projected route —
 * sequential provider mounts (the test suites) rely on that isolation, which
 * the store's epoch-scoped `go` used to give (router enabler B). A screen
 * taking the module `go` recovers it with this liveness guard.
 */
function useDelayedNav() {
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  return (fn: () => void, ms: number) => window.setTimeout(() => { if (alive.current) fn() }, ms)
}

/** Reason creation is not allowed (empty = allowed) */
function useCreateReason(projectId?: string) {
  const pid = useProjectStore((s) => s.pid)
  const can = useCan()
  const readOnly = useReadOnly()
  const me = useMe()
  const p = projectId || pid
  if (p === 'all') return 'Select a specific project before creating a finding.'
  if (readOnly(p)) return me.role === 'viewer' ? 'The Client / Viewer role is read-only.' : 'Project is closed — read-only.'
  if (!can('createFinding', p)) return `The ${ROLE_LABEL[me.role]} role cannot create findings.`
  return ''
}

/* ───────────── FI-01: list ───────────── */
/**
 * Verify / dismiss actions for an AI-suggested finding (never counted as
 * verified until verified). Ticket 32: verification imports the suggestion
 * through the typed write, which can only land it as a DRAFT (invariant 5
 * at the handler) — curation and the submit to review stay human-driven.
 */
function useAiActions() {
  const services = useServicesOrNull()
  const me = useMe()
  const confirm = useSessionStore((s) => s.confirm)
  const toast = useToastStore((s) => s.toast)
  const can = useCan()
  const readOnly = useReadOnly()
  const persistFilters = useSessionStore((s) => s.persistFilters)
  const setFilter = useSessionStore((s) => s.setFilter)
  const writes = useFindingWrites()
  const queryClient = useQueryClient()
  /* The legacy raw `A.audit` entry, mirrored exactly: one 'legacy' commit
     through the one authority (the typed dismiss path has no audit row). */
  const audit = (action: string, obj: string, projectId: string, result = 'Success', reason = '') =>
    services && recordAudit(services, { actor: { id: me.name, role: me.role }, projectId, corr: 'legacy' }, { action, obj, result, reason })
  const dismissed: Record<string, string> = (persistFilters['fd-dismissed'] as Record<string, string> | undefined) || {}
  const why = (f: Finding) => (readOnly(f.projectId) ? 'Project is read-only.' : !can('createFinding', f.projectId) ? `The ${ROLE_LABEL[me.role]} role cannot verify or dismiss AI suggestions. An Analyst or Operator can.` : '')
  const verify = (f: Finding) => confirm({
    title: `Verify & import ${f.id} as a draft?`, confirmLabel: 'Verify & create finding',
    body: <div className="space-y-2">
      <p>You confirm you reviewed the source claim. It becomes a draft for curation, enters review only after you submit it, and needs an independent Reviewer before it can count in reports.</p>
      {f.producer && <p>Producer source: <Mono>{f.producer.path}</Mono>. The source evidence text is a claim, not an evidence reference.</p>}
      {f.producer?.quality?.defaultSeverity && <p className="text-warn">The parser supplied the severity default; verify the source before keeping it.</p>}
      {f.producer?.quality?.placeholderDescription && <p className="text-warn">The source has no description beyond a placeholder.</p>}
      {f.producer?.quality?.placeholderEvidence && <p className="text-warn">The source has no evidence reference beyond a placeholder.</p>}
      {f.producer?.quality?.unreadable && <p className="text-warn">The producer source has parser-quality problems.</p>}
    </div>,
    onConfirm: async () => {
      const res = await writes.importSuggestion(f.id)
      if (res.ok) { toast(`${f.id} imported as draft ${res.data.id}.`); go('finding', { id: res.data.id }) }
      else toast(res.failure.message, 'warn')
    },
  })
  const dismiss = (f: Finding) => confirm({
    title: `Dismiss ${f.id}?`, confirmLabel: 'Dismiss suggestion', danger: true, reasonLabel: 'Reason for dismissing', reasonRequired: true,
    body: 'The suggestion is removed from the active AI Suggestions list. It is never added to confirmed counts or reports. The reason is recorded.',
    onConfirm: async (r) => {
      if (isRealMode()) {
        const result = await writes.setSuggestionDisposition(f.id, { producerRef: f.producer?.path ?? '', dismissed: true, reason: r, expectedVersion: f.suggestionDisposition?.version ?? 0 })
        if (!result.ok) { toast(result.failure.message, 'warn'); return }
        void queryClient.invalidateQueries({ queryKey: ['finding'] })
      } else {
        setFilter('fd-dismissed', { ...dismissed, [f.id]: r })
        if (services) addFindingCommentTransaction(services.authority, { actor: { id: me.name, role: me.role }, projectId: f.projectId, corr: 'legacy' }, f.id, `AI suggestion dismissed: ${r}`)
        audit('Dismissed AI suggestion', f.id, f.projectId, 'Success', r)
      }
      toast(`${f.id} dismissed.`, 'warn')
    },
  })
  return {
    dismissed,
    why,
    dismissWhy: (f: Finding) => why(f),
    verify,
    dismiss,
    restore: async (f: Finding) => {
      if (isRealMode()) {
        const result = await writes.setSuggestionDisposition(f.id, { producerRef: f.producer?.path ?? '', dismissed: false, reason: '', expectedVersion: f.suggestionDisposition?.version ?? 0 })
        if (!result.ok) { toast(result.failure.message, 'warn'); return }
        void queryClient.invalidateQueries({ queryKey: ['finding'] })
      } else {
        const restored = { ...dismissed }; delete restored[f.id]; setFilter('fd-dismissed', restored)
      }
    },
  }
}

function MoreFilters({ children, active }: { children: ReactNode; active: number }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <Button size="sm" variant={active ? 'primary' : 'secondary'} aria-expanded={open} onClick={() => setOpen(!open)}>More filters{active ? ` (${active})` : ''}</Button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-72 space-y-3 rounded-xl border border-line bg-panel p-4 shadow-lg">
          {children}
          <div className="flex justify-end"><Button size="sm" onClick={() => setOpen(false)}>Done</Button></div>
        </div>
      )}
    </div>
  )
}

/**
 * Findings list (ticket 31): search/severity/status filters, pagination and
 * the severity/tab counts run on the typed findings service through Query —
 * scope-keyed cache entries, ChangeSet invalidation (a legacy status change
 * updates these views without a reload) and cancel-on-switch come from the
 * shared bridges. AI suggestions are presented as proposals: they are
 * excluded from the severity KPIs until a human verifies them, and
  * dismissal is persisted per actor in real mode. Creation and
 * the detail form still use the bridged legacy routes (owner: ticket 32).
 */
export function FindingList() {
  const route = useRoute()
  const pid = useProjectStore((s) => s.pid)
  const project = useActiveProject()
  const ai = useAiActions()
  const [q, setQ] = useState('')
  const [sev, setSev] = useState('')
  const [tab, setTab] = useState(route.tab && TABS.some((t) => t.id === route.tab) ? route.tab : 'all')
  const listTabs = TABS
  const [prj, setPrj] = useState('')
  const [owner, setOwner] = useState('')
  const [asset, setAsset] = useState('')
  const [opf, setOpf] = useState('')
  const [showDis, setShowDis] = useState(false)
  const [sort, setSort] = useState('updated')
  const [page, setPage] = useState(1)
  const reason = useCreateReason()
  const dismissed = Object.keys(ai.dismissed)
  const list = useFindingList({
    q: q || undefined, severity: sev || undefined, status: tab !== 'all' ? tab : undefined,
    project: prj || undefined, owner: owner || undefined, asset: asset || undefined, op: opf || undefined,
    sort: sort !== 'updated' ? (sort as FindingSort) : undefined,
    dismissed: !showDis && dismissed.length ? dismissed : undefined,
    showDismissed: showDis,
    page: page > 1 ? page : undefined,
  })
  useEffect(() => { setPage(1) }, [q, sev, tab, prj, owner, asset, opf, sort, showDis])
  const data = list.data
  const rows = data?.items ?? []
  const moreActive = [prj, owner, asset, sort !== 'updated' ? sort : ''].filter(Boolean).length
  const filtered = !!(q || sev || prj || owner || asset || opf || tab !== 'all')
  const reset = () => { setQ(''); setSev(''); setTab('all'); setPrj(''); setOwner(''); setAsset(''); setOpf(''); setSort('updated') }
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <div>
      {data?.truncated && <Banner tone="warn" title="List truncated">The producer projection is incomplete; finding sources may have been skipped.</Banner>}
      <PageHeader
        title="Findings"
        sub={pid === 'all' ? 'All findings across the projects you can access (read-only aggregate). Creating one requires a specific project.' : `Findings for ${project?.id} — ${project?.name}. KPIs count verified findings only.`}
        actions={pid !== 'all' && <Button variant="primary" icon={Plus} disabled={!!reason} title={reason || 'Create a new finding'} onClick={() => go('finding-new')}>Create Finding</Button>}
      />
      {pid !== 'all' && reason && <div className="-mt-3 mb-4 flex justify-end"><Locked reason={reason} /></div>}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        {SEVS.map((s) => <Kpi key={s} label={sevLabel[s]} value={data?.severity[s] ?? 0} tone={s === 'critical' || s === 'high' ? 'bad' : s === 'medium' ? 'warn' : s === 'low' ? 'cyan' : 'neutral'} onClick={() => setSev(sev === s ? '' : s)} />)}
        <Kpi label="Awaiting Review" value={data?.awaitingReview ?? 0} tone="warn" onClick={() => setTab('review')} />
        <Kpi label="Resolved" value={data?.resolved ?? 0} tone="ok" onClick={() => setTab('remediation')} />
        <Kpi label="AI Suggestions" value={data?.counts.ai ?? 0} sub="unverified — not in counts" tone="warn" onClick={() => setTab('ai')} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={listTabs.map((t) => ({ id: t.id, label: t.label, count: data?.counts[t.id as keyof typeof data.counts] ?? 0 }))} />
      <FilterBar right={filtered ? <Button size="sm" variant="ghost" icon={RotateCcw} onClick={reset}>Reset</Button> : undefined}>
        <SearchBox value={q} onChange={setQ} placeholder="Search by ID or title…" className="w-full sm:w-64" />
        <Select aria-label="Severity" value={sev} onChange={(e) => setSev(e.target.value)} className="!w-auto"><option value="">All severities</option>{SEVS.map((s) => <option key={s} value={s}>{sevLabel[s]}</option>)}</Select>
        <Select aria-label="Operation" value={opf} onChange={(e) => setOpf(e.target.value)} className="!w-auto"><option value="">All operations</option>{(data?.ops ?? []).map((o) => <option key={o}>{o}</option>)}</Select>
        <MoreFilters active={moreActive}>
          {pid === 'all' && <Field label="Project"><Select value={prj} onChange={(e) => setPrj(e.target.value)}><option value="">All projects</option>{(data?.projects ?? []).map((p) => <option key={p} value={p}>{p}</option>)}</Select></Field>}
          <Field label="Owner"><Select value={owner} onChange={(e) => setOwner(e.target.value)}><option value="">All owners</option>{(data?.owners ?? []).map((o) => <option key={o}>{o}</option>)}</Select></Field>
          <Field label="Asset"><Select value={asset} onChange={(e) => setAsset(e.target.value)}><option value="">All assets</option>{(data?.assets ?? []).map((o) => <option key={o}>{o}</option>)}</Select></Field>
          <Field label="Sort"><Select value={sort} onChange={(e) => setSort(e.target.value)}><option value="updated">Recently updated</option><option value="created">Newest recorded</option><option value="severity">Severity</option><option value="id">ID</option></Select></Field>
        </MoreFilters>
      </FilterBar>
      {tab === 'ai' && (
        <div className="mb-3 space-y-2">
          <Banner tone="warn" icon={Sparkles} title="AI suggestions are not verified findings">They are excluded from confirmed counts, severity charts and reports until a human verifies them.</Banner>
          {(data?.dismissedCount ?? dismissed.length) > 0 && <label className="flex cursor-pointer items-center gap-2 text-xs text-muted"><input type="checkbox" className="accent-[var(--c-accent)]" checked={showDis} onChange={(e) => setShowDis(e.target.checked)} />Show dismissed suggestions ({data?.dismissedCount ?? dismissed.length})</label>}
        </div>
      )}
      {list.isPending ? (
        <div aria-busy="true" aria-label="Loading findings"><Skeleton className="h-72" /></div>
      ) : list.isError ? (
        <Empty icon={AlertTriangle} title="Could not load findings" action={<Button onClick={() => list.refetch()}>Retry</Button>}>
          {(list.error as FindingReadError).failure.message}
        </Empty>
      ) : (
        <>
          <Table
            rows={rows} rowKey={(it) => it.finding.id} onRow={(it) => go('finding', { id: it.finding.id })}
            empty={
              <Empty icon={tab === 'ai' ? Sparkles : Bug} title={tab === 'ai' ? 'No AI suggestions to review' : filtered ? 'No findings match the filters' : 'No findings yet'} action={filtered ? <Button onClick={reset}>Reset filters</Button> : <Button variant="primary" icon={Plus} disabled={!!reason} title={reason} onClick={() => go('finding-new')}>Create Finding</Button>}>
                {tab === 'ai' ? 'AI suggestions appear here when the AI Operator spots a possible gap in an operation.' : filtered ? 'Try removing some filters or the search term.' : 'No verified findings is a valid result. Findings are created from operation results, evidence or attack analysis — never invented to complete a report.'}
              </Empty>
            }
            cols={[
              { key: 'id', header: 'Finding ID', render: (it) => <span className="whitespace-nowrap"><Mono className="text-accent">{it.finding.id}</Mono></span> },
              { key: 't', header: 'Title', render: (it) => <div className="max-w-[300px]" title={it.finding.title}><div className="truncate font-medium">{it.finding.title}</div>{it.finding.producer && Object.values(it.finding.producer.quality ?? {}).some(Boolean) && <div className="mt-1 text-[11px] text-warn">Producer source needs review</div>}</div> },
              { key: 'p', header: 'Project', hideBelow: 'md', render: (it) => <div className="whitespace-nowrap"><Mono>{it.finding.projectId}</Mono><div className="text-xs text-muted">{it.projectClient}</div></div> },
              { key: 'sev', header: 'Severity', render: (it) => <span className="whitespace-nowrap"><Sev v={it.finding.severity} /></span> },
              { key: 'a', header: 'Affected asset', hideBelow: 'lg', render: (it) => <span className="whitespace-nowrap"><Mono>{it.finding.asset}</Mono></span> },
              { key: 'op', header: 'Operation', hideBelow: 'lg', render: (it) => <span className="whitespace-nowrap"><Mono>{it.finding.op}</Mono></span> },
              { key: 'o', header: 'Owner', hideBelow: 'md', render: (it) => <span className="whitespace-nowrap">{it.finding.owner}</span> },
              { key: 's', header: 'Status', render: (it) => <span className="whitespace-nowrap"><Status kind="finding" value={it.finding.status} />{(ai.dismissed[it.finding.id] || it.finding.suggestionDisposition?.dismissed) && <span className="ml-1.5 text-xs text-muted">dismissed</span>}</span> },
              { key: 'u', header: 'Updated', hideBelow: 'lg', render: (it) => <span className="whitespace-nowrap text-xs text-muted">{it.finding.updated}</span> },
              ...(tab === 'ai' ? [{ key: 'act', header: 'Actions', render: (it: { finding: Finding }) => {
                const f = it.finding
                const w = ai.why(f)
                const dismissWhy = ai.dismissWhy(f)
                return ai.dismissed[f.id] || f.suggestionDisposition?.dismissed ? <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); void ai.restore(f) }}>Restore</Button> : (
                  <div className="flex gap-1.5 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="primary" disabled={!!w} title={w || 'Verify the suggestion and create a finding in review'} onClick={() => ai.verify(f)}>Verify & create finding</Button>
                    <Button size="sm" disabled={!!dismissWhy} title={dismissWhy || 'Dismiss with a reason'} onClick={() => ai.dismiss(f)}>Dismiss</Button>
                  </div>
                )
              } }] : []),
            ]}
          />
          <Pager page={data?.page ?? 1} pages={pages} total={data?.total ?? 0} setPage={setPage} />
        </>
      )}
    </div>
  )
}

/* ───────────── Access handling for the finding page (ticket 31) ───────────── */
/**
 * The detail read carries the authorization decisions: a finding outside the
 * actor's access is `not-found` (indistinguishable from a missing one), and
 * a finding in an accessible project outside the active project context is
 * `forbidden` with the owning project on the entity ref — refused without
 * content, with an explicit switch offered here.
 */
function FindingDenied({ id, error }: { id?: string; error: FindingReadError }) {
  const pid = useProjectStore((s) => s.pid)
  const setPid = useProjectStore((s) => s.setPid)
  const setSwitcherOpen = useUiStore((s) => s.setSwitcherOpen)
  const nav = useDelayedNav()
  const other = error.failure.kind === 'forbidden' ? error.failure.entity?.projectId : undefined
  if (other) {
    return (
      <Empty icon={Lock} title={`Finding ${id} belongs to another project`} action={<div className="flex gap-2"><Button variant="primary" onClick={() => { setPid(other); nav(() => go('finding', { id }), 80) }}>Switch to {other}</Button><Button onClick={() => setSwitcherOpen(true)}>Select another project</Button></div>}>
        The selected project is {pid}. To avoid mixing data, content from {other} is not shown in this context.
      </Empty>
    )
  }
  return <Empty icon={AlertTriangle} title="Finding not found" action={<Button onClick={() => go('findings')}>Back to findings</Button>}>ID {id || '—'} does not exist or is not available for your account.</Empty>
}

const MaskedName = ({ ev }: { ev: EvidenceView }) =>
  ev.masked ? <span className="inline-flex items-center gap-1.5 text-warn"><Lock size={13} aria-hidden />Sensitive file — redacted</span> : <span>{ev.name ?? ev.ref}</span>

/* ───────────── FI-03: create / edit ───────────── */
interface Draft { title: string; severity: Severity; severityReason: string; asset: string; op: string; technique: string; desc: string; scopeNote: string; impact: string; rec: string; evidence: string[]; owner: string; kind: string; references: NonNullable<Finding['references']>; stepId?: string }

/**
 * Finding create/edit form (ticket 32): validation, dirty tracking and the
 * save/submit write run on the typed findings service — one atomic commit
 * per user-visible save (content, evidence links, severity rationale and
 * the optional submit). A refused save commits nothing and leaves the draft
 * in the form with the failure message rendered above it.
 */
function FindingForm() {
  const route = useRoute()
  const real = isRealMode()
  const db = useFindingFormRead(route.id)
  const detail = useFindingDetail(real ? route.id : undefined)
  if (!real) return <FindingFormBody key={route.id ?? 'new'} editing={route.id ? db.findings.find((f) => f.id === route.id) : undefined} db={db} />
  if (route.id && detail.isPending) return <div aria-busy="true" aria-label="Loading finding"><Skeleton className="h-72" /></div>
  if (route.id && detail.isError) return <FindingDenied id={route.id} error={detail.error as FindingReadError} />
  return <FindingFormBody key={route.id ?? 'new'} editing={detail.data?.finding} db={db} />
}

function FindingFormBody({ editing, db }: { editing: Finding | undefined; db: FindingFormRead }) {
  const route = useRoute()
  const real = isRealMode()
  const me = useMe()
  const pid = useProjectStore((s) => s.pid)
  const toast = useToastStore((s) => s.toast)
  const persistFilters = useSessionStore((s) => s.persistFilters)
  const setFilter = useSessionStore((s) => s.setFilter)
  const setSwitcherOpen = useUiStore((s) => s.setSwitcherOpen)
  const can = useCan()
  const nav = useDelayedNav()
  const writes = useFindingWrites()
  const referencesQuery = useFindingReferenceOptions()
  const projectId = editing?.projectId || (pid !== 'all' ? pid : '')
  const createReason = useCreateReason(projectId || undefined)
  const guard = useGuard(projectId || undefined)
  const prefill = useMemo(() => persistFilters['finding-prefill'] as { projectId: string; op?: string; technique?: string; asset?: string; title?: string; severity?: string; desc?: string; stepId?: string; evidence?: string[] } | undefined, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (persistFilters['finding-prefill']) setFilter('finding-prefill', null) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const pf = !editing && prefill && prefill.projectId === projectId ? prefill : undefined
  const project = db.projects.find((p) => p.id === projectId)
  const members = project?.members.filter((m) => m.role !== 'viewer').map((m) => m.user) || []

  const init: Draft = useMemo(() => editing
    ? { title: editing.title, severity: editing.severity, severityReason: editing.severityRationale ?? '', asset: editing.asset, op: editing.op, technique: editing.technique, desc: editing.desc, scopeNote: editing.scopeNote ?? '', impact: editing.impact, rec: editing.rec, evidence: [...editing.evidence], owner: editing.owner, kind: 'Configuration / access control', references: editing.references ?? { assetId: null, bindingId: null, threadId: null, runId: null, techniqueId: null } }
    : { title: pf?.title || '', severity: (pf?.severity as Severity) || 'medium', severityReason: '', asset: pf?.asset || '', op: pf?.op || '', technique: pf?.technique || '', desc: pf?.desc || '', scopeNote: '', impact: '', rec: '', evidence: (pf?.evidence || []).filter((id) => db.evidence.some((e) => e.id === id && e.projectId === projectId)), owner: members.includes(me.name) ? me.name : members[0] || me.name, kind: 'Configuration / access control', references: { assetId: null, bindingId: null, threadId: null, runId: null, techniqueId: null }, stepId: pf?.stepId }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  , [])
  const [d, setD] = useState<Draft>(init)
  const [baseVersion, setBaseVersion] = useState(editing?.version)
  const queryClient = useQueryClient()
  const [tried, setTried] = useState(false)
  const [saved, setSaved] = useState(false)
  const [preview, setPreview] = useState(false)
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }))
  const dirty = !saved && JSON.stringify(d) !== JSON.stringify(init)

  const assets = db.assets.filter((a) => a.projectId === projectId)
  const managedAssets = real ? referencesQuery.data?.assets ?? [] : assets.map((asset) => ({ id: asset.id, label: asset.name }))
  const executions = referencesQuery.data?.executions ?? []
  const ops = db.operations.filter((o) => o.projectId === projectId)
  const evs = db.evidence.filter((e) => e.projectId === projectId)
  const assetGap = undefined
  const techniqueGap = referencesQuery.data?.techniqueAvailable === false ? 'Canonical technique references are unavailable.' : undefined
  const impactGap = realControlGap('finding.impact')
  const recGap = realControlGap('finding.recommendation')
  const scopeGap = realControlGap('finding.scopeNote')
  const severityGap = realControlGap('finding.severityRationale')
  const evidenceGap = realControlGap('finding.evidenceLink')
  const editableStatuses = real ? ['draft', 'returned', 'review', 'confirmed', 'remediation', 'retest'] : ['draft', 'returned']
  const locked = !!createReason || (!!editing && !editableStatuses.includes(editing.status))
  const err: Record<string, string> = {}
  if (d.title.trim().length < 5) err.title = 'Enter a finding title (at least 5 characters).'
  if (!assetGap && !d.asset) err.asset = 'Select the affected asset.'
  if (!d.desc.trim()) err.desc = 'Enter a description.'
  if (!impactGap && !d.impact.trim()) err.impact = 'Enter the impact.'
  if (!recGap && !d.rec.trim()) err.rec = 'Enter a recommendation.'
  if (!severityGap && d.severity === 'critical' && !d.severityReason.trim()) err.severityReason = 'Critical severity requires a rationale.'
  const noEvidence = d.evidence.length === 0
  const submitReason = noEvidence ? 'At least 1 piece of evidence is required to submit for review (you can save a draft first).' : ''
  const maySubmit = !editing || ['draft', 'returned'].includes(editing.status)

  const draftPayload = () => ({ title: d.title.trim(), severity: d.severity, severityReason: d.severityReason.trim() || undefined, owner: d.owner, kind: d.kind, desc: d.desc, scopeNote: d.scopeNote, asset: d.asset, impact: d.impact, rec: d.rec, technique: d.technique, op: d.op, stepId: d.stepId, evidence: d.evidence, references: d.references })
  const finish = (id: string, msg: string) => {
    setSaved(true)
    toast(msg)
    nav(() => go('finding', { id }), 80)
  }
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  /** Save through the typed service. A refusal returns without navigating —
   *  the draft stays in the form and the failure message is rendered. */
  const persist = async (submit: boolean, navigate: boolean): Promise<string | null> => {
    if (!projectId || saving) return null
    setSaving(true)
    setSaveErr(null)
    const res = await writes.save(editing?.id ?? null, { ...draftPayload(), submit, expectedVersion: baseVersion })
    setSaving(false)
    if (!res.ok) { setSaveErr(res.failure.message); return null }
    setBaseVersion(res.data.version)
    await queryClient.invalidateQueries({ queryKey: ['finding'] })
    const id = res.data.id
    if (navigate) finish(id, submit ? `${id} submitted for review.` : `Draft ${id} saved.`)
    return id
  }
  const saveDraft = async () => {
    setTried(true)
    if (d.title.trim().length < 5) { toast('Enter a finding title (at least 5 characters) before saving a draft.', 'warn'); return }
    await persist(false, true)
  }
  const submit = async () => {
    setTried(true)
    if (Object.keys(err).length) { toast('Please complete the required fields.', 'warn'); return }
    if (submitReason) { toast(submitReason, 'warn'); return }
    await persist(true, true)
  }
  useDirty(dirty, () => {
    if (d.title.trim().length >= 5 && projectId && !locked && !saving) {
      void persist(false, false).then((id) => { if (id) { setSaved(true); toast('Draft saved.') } else setSaved(false) })
    }
  })

  if (editing && pid !== 'all' && editing.projectId !== pid) return <Empty icon={Lock} title={`${editing.id} belongs to project ${editing.projectId}`} action={<Button onClick={() => setSwitcherOpen(true)}>Select project</Button>}>Select the correct project to edit this finding.</Empty>
  if (route.id && !editing) return <Empty icon={AlertTriangle} title="Finding to edit not found" action={<Button onClick={() => go('findings')}>Back to list</Button>} />
  if (!projectId) {
    return (
      <div>
        <PageHeader title="Create Finding" back={{ label: 'Findings', to: () => go('findings') }} />
        <Banner tone="warn" title="Select a project before creating a finding" action={<Button variant="primary" onClick={() => setSwitcherOpen(true)}>Select project</Button>}>
          "All Projects" is for aggregate viewing only. Every finding must belong to exactly one project.
        </Banner>
      </div>
    )
  }
  const returnedNote = editing?.status === 'returned' ? [...editing.comments].reverse()[0] : undefined
  const E = (k: string) => (tried ? err[k] : undefined)

  return (
    <div>
      <PageHeader
        title={editing ? `Edit ${editing.id}` : 'Create Finding'}
        sub={`Project ${project?.id} — ${project?.name}. The finding ID is generated on save.`}
        back={{ label: editing ? editing.id : 'Findings', to: () => (editing ? go('finding', { id: editing.id }) : go('findings')) }}
        meta={editing ? <Status kind="finding" value={editing.status} /> : undefined}
      />
      {returnedNote && (
        <Banner tone="bad" title={`Returned by reviewer — ${returnedNote.by}, ${returnedNote.at}`} icon={RotateCcw}>
          <span className="whitespace-pre-wrap">{returnedNote.text}</span>
          <div className="mt-1 text-xs text-muted">Make the requested changes, then click "Submit for Review" to resubmit.</div>
        </Banner>
      )}
      {createReason ? <Banner tone="warn" title="Cannot create / edit finding">{createReason}</Banner>
         : locked ? <Banner tone="warn" title="Finding is no longer editable">This lifecycle stage is immutable. Current status: {STATUS_LABEL[editing!.status]}.</Banner>
          : guard.ro ? <Banner tone="warn" title="Read-only">{guard.reason}</Banner> : null}
      {saveErr && (
        <Banner tone="bad" title="The finding was not saved">
          {saveErr} Your draft is still in the form below — fix the problem and save again.
        </Banner>
      )}
      <fieldset disabled={locked} className="min-w-0 space-y-5">
        <Card>
          <CardHeader title="General information" />
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Project" hint="A finding's project cannot be changed."><Input value={`${project?.id} — ${project?.name}`} disabled readOnly /></Field>
            <Field label="Finding ID" hint="Auto-generated"><Input value={editing?.id || 'Generated on save'} disabled readOnly className="font-mono" /></Field>
            <Field label="Finding title" required error={E('title')} className="md:col-span-2"><Input value={d.title} onChange={(e) => set('title', e.target.value)} placeholder="Example: Access control gap" /></Field>
            <Field label="Severity" required>
              <Select value={d.severity} onChange={(e) => set('severity', e.target.value as Severity)}>{SEVS.map((s) => <option key={s} value={s}>{sevLabel[s]}</option>)}</Select>
            </Field>
            <Field label="Owner">
              <Select value={d.owner} onChange={(e) => set('owner', e.target.value)}>{[...new Set([...members, d.owner])].map((m) => <option key={m}>{m}</option>)}</Select>
            </Field>
            <Field label={d.severity === 'critical' ? 'Rationale for Critical severity' : 'Severity rationale (optional)'} required={d.severity === 'critical' && !severityGap} error={E('severityReason')} className="md:col-span-2" hint={severityGap ?? 'The rationale is saved as a comment in the finding history.'}>
              <Textarea disabled={!!severityGap} value={d.severityReason} onChange={(e) => set('severityReason', e.target.value)} className="min-h-16" placeholder="Explain the basis for the severity rating" />
            </Field>
          </div>
        </Card>
        <Card>
          <CardHeader title="Analysis" />
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Affected asset" required error={E('asset')} hint={referencesQuery.isPending ? 'Loading managed assets…' : `${managedAssets.length} managed assets in ${projectId}`}>
              <Select value={real ? d.references.assetId ?? '' : d.asset} onChange={(e) => { const asset = managedAssets.find((item) => real ? item.id === e.target.value : item.label === e.target.value); set('references', { ...d.references, assetId: real ? e.target.value || null : null }); set('asset', asset?.label ?? '') }}><option value="">— Select an asset —</option>{managedAssets.map((asset) => <option key={asset.id} value={real ? asset.id : asset.label}>{asset.label} ({asset.id})</option>)}</Select>
            </Field>
            <Field label="Related execution" hint={referencesQuery.data?.truncated ? 'Execution options are bounded. Refine before linking.' : 'Links only owned execution threads and runs in this engagement.'}>
              {real ? <Select value={JSON.stringify(d.references)} onChange={(e) => { const selected = executions.find((item) => JSON.stringify({ ...d.references, threadId: item.threadId, runId: item.runId, bindingId: item.bindingId }) === e.target.value); const refs = selected ? { ...d.references, threadId: selected.threadId, runId: selected.runId, bindingId: selected.bindingId } : { ...d.references, threadId: null, runId: null, bindingId: null }; set('references', refs); set('op', refs.runId ?? refs.bindingId ?? refs.threadId ?? '') }}><option value={JSON.stringify({ ...d.references, threadId: null, runId: null, bindingId: null })}>— No linked execution —</option>{executions.map((execution) => { const refs = { ...d.references, threadId: execution.threadId, runId: execution.runId, bindingId: execution.bindingId }; return <option key={JSON.stringify(refs)} value={JSON.stringify(refs)}>{execution.runId ?? execution.bindingId ?? execution.threadId}</option> })}</Select>
                : <Select value={d.op} onChange={(e) => set('op', e.target.value)}><option value="">— No linked operation —</option>{ops.map((operation) => <option key={operation.id} value={operation.id}>{operation.id} — {operation.name}</option>)}</Select>}
            </Field>
            <Field label="ATT&CK technique (if applicable)" hint={techniqueGap ?? (referencesQuery.data?.techniqueAvailable ? 'Validated against the canonical technique corpus on save.' : 'Select a project to check the canonical corpus.')}>
              {real ? <Input value={d.references.techniqueId ?? ''} onChange={(e) => { set('references', { ...d.references, techniqueId: e.target.value.trim() || null }); set('technique', e.target.value.trim()) }} placeholder="T1059.001" disabled={!!techniqueGap} />
                : <Select value={d.technique} onChange={(e) => set('technique', e.target.value)}><option value="">— Not applicable —</option>{TECHNIQUES.map((technique) => <option key={technique.id} value={technique.id}>{technique.id} — {technique.name}</option>)}</Select>}
            </Field>
            <Field label="Conditions / scope of impact" hint={scopeGap ?? undefined}><Input disabled={!!scopeGap} value={d.scopeNote} onChange={(e) => set('scopeNote', e.target.value)} placeholder="Example: applies only to demo accounts in the lab" /></Field>
            <Field label="Description" required error={E('desc')} className="md:col-span-2"><Textarea value={d.desc} onChange={(e) => set('desc', e.target.value)} /></Field>
            <Field label="Impact" required={!impactGap} error={E('impact')} hint={impactGap ?? undefined}><Textarea disabled={!!impactGap} value={d.impact} onChange={(e) => set('impact', e.target.value)} /></Field>
            <Field label="Recommendation" required={!recGap} error={E('rec')} hint={recGap ?? undefined}><Textarea disabled={!!recGap} value={d.rec} onChange={(e) => set('rec', e.target.value)} /></Field>
          </div>
        </Card>
        <Card>
          <CardHeader title="Evidence" sub={`Only evidence from ${projectId} is listed. You can upload more files in the Evidence tab after saving.`} />
          {evidenceGap ? <div className="text-sm text-muted">{evidenceGap}</div> : evs.length === 0 ? <div className="text-sm text-muted">This project has no evidence yet. Save a draft, then upload from the detail page.</div> : (
            <ul className="space-y-2">
              {evs.map((e) => {
                const other = !!e.findingId && e.findingId !== editing?.id
                const hide = e.sensitive && !can('viewSensitive')
                return (
                  <li key={e.id} className={cx('flex flex-wrap items-center gap-3 rounded-lg border border-line px-3 py-2.5', (other || hide) && 'opacity-60')}>
                    <Check checked={d.evidence.includes(e.id)} disabled={other || hide} onChange={(v) => set('evidence', v ? [...d.evidence, e.id] : d.evidence.filter((x) => x !== e.id))} label={<span className="flex items-center gap-2"><Mono className="text-accent">{e.id}</Mono>{hide ? 'Sensitive file' : e.name}</span>} />
                    <span className="text-xs text-muted">{e.kind} · {e.source}</span>
                    {e.sensitive && <span className="inline-flex items-center gap-1 text-xs text-warn"><Lock size={12} aria-hidden />Sensitive</span>}
                    {other && <span className="text-xs text-muted">Already linked to {e.findingId}</span>}
                    {hide && <span className="text-xs text-muted">Outside your permission scope</span>}
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </fieldset>
      <div className="sticky bottom-0 -mx-1 mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-bg/95 px-1 py-3 backdrop-blur">
        {dirty && <span className="mr-auto text-xs text-warn">Unsaved changes</span>}
        {!locked && submitReason && <span className="mr-auto flex items-center gap-1.5 text-xs text-muted"><Lock size={12} aria-hidden />{submitReason}</span>}
        <Button variant="ghost" onClick={() => (editing ? go('finding', { id: editing.id }) : go('findings'))}>Cancel</Button>
        <Button onClick={() => setPreview(true)} icon={FileText}>Preview</Button>
        <Button onClick={saveDraft} disabled={locked || saving} title={locked ? createReason || 'Cannot edit in the current status.' : !maySubmit ? 'Content changes invalidate confirmation and return the finding to review.' : ''}>{maySubmit ? 'Save Draft' : 'Save for Re-review'}</Button>
        <Button variant="primary" icon={Send} onClick={submit} disabled={locked || saving || !!submitReason || !maySubmit} title={locked ? createReason || 'Cannot edit in the current status.' : !maySubmit ? 'Use Save for Re-review to save content and invalidate its previous confirmation.' : submitReason}>Submit for Review</Button>
      </div>
      <Modal open={preview} onClose={() => setPreview(false)} title="Finding preview" width={640} footer={<Button onClick={() => setPreview(false)}>Close</Button>}>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2"><Sev v={d.severity} /><span className="font-semibold">{d.title || '(untitled)'}</span></div>
          <DescList items={[{ k: 'Project', v: projectId }, { k: 'Asset', v: d.asset }, { k: 'Operation', v: d.op }, { k: 'Technique', v: d.technique }, { k: 'Owner', v: d.owner }, { k: 'Evidence', v: d.evidence.join(', ') }]} />
          <div><div className="text-xs text-muted">Description</div><p>{d.desc || '—'}</p></div>
          <div><div className="text-xs text-muted">Impact</div><p>{d.impact || '—'}</p></div>
          <div><div className="text-xs text-muted">Recommendation</div><p>{d.rec || '—'}</p></div>
        </div>
      </Modal>
    </div>
  )
}

/* ───────────── FI-02/FI-04/FI-05: detail ───────────── */
const FLOW = ['Draft', 'In Review', 'Confirmed', 'Remediation', 'Retest', 'Resolved']
const FLOW_IDX: Record<string, number> = { ai_suggested: -1, draft: 0, returned: 0, review: 1, confirmed: 2, remediation: 3, retest: 4, resolved: 5 }

/**
 * Finding detail (ticket 31/32): the record, history/metadata and linked
 * evidence come from the typed detail read through Query — role-sensitive
 * masking (`viewSensitive`) is applied by the service, not by the screen.
 * Lifecycle actions run through the typed write handlers (ticket 32): each
 * transition is role/state gated at the handler and publishes a ChangeSet
 * both this view and legacy consumers observe. Report attachment stays with
 * the bridged legacy actions until ticket 36 migrates reports.
 */
function FindingDetail() {
  const route = useRoute()
  const session = useContext(SessionContext)
  const me = useMe()
  const pid = useProjectStore((state) => state.pid)
  return <FindingDetailBody key={`${session?.session?.actor?.id ?? me.email}:${pid}:${route.id}`} />
}

function FindingDetailBody() {
  const route = useRoute()
  const session = useContext(SessionContext)
  const can = useCan()
  const readOnly = useReadOnly()
  const me = useMe()
  const confirm = useSessionStore((s) => s.confirm)
  const toast = useToastStore((s) => s.toast)
  const db = useFindingReportChoices()
  const writes = useFindingWrites()
  const queryClient = useQueryClient()
  const detail = useFindingDetail(route.id)
  useResourceScope(detail.data?.finding.projectId)
  const [note, setNote] = useState('')
  const [commentSaving, setCommentSaving] = useState(false)
  const [olderComments, setOlderComments] = useState<Finding['comments']>([])
  const [olderHistory, setOlderHistory] = useState<Finding['history']>([])
  const [activityCursors, setActivityCursors] = useState<Partial<Record<FindingActivityKind, string | null>>>({})
  const [activityLoading, setActivityLoading] = useState<FindingActivityKind | null>(null)
  const activityVersion = useRef<number | undefined>(undefined)
  useEffect(() => {
    activityVersion.current = detail.data?.finding.version
    setOlderComments([]); setOlderHistory([]); setActivityCursors({}); setActivityLoading(null)
  }, [detail.data?.finding.version])
  const [rep, setRep] = useState(false)
  const ai = useAiActions()
  if (!route.id || detail.isError) {
    return <FindingDenied id={route.id} error={detail.isError ? (detail.error as FindingReadError) : new FindingReadError({ kind: 'not-found', message: 'Finding not found.' })} />
  }
  if (detail.isPending || !detail.data) {
    return <div aria-busy="true" aria-label="Loading finding"><Skeleton className="h-72" /></div>
  }
  const data = detail.data
  const f = data.finding
  const tab = route.tab || 'overview'
  const ro = readOnly(f.projectId)
  const reviewer = can('reviewFinding', f.projectId)
  const author = can('createFinding', f.projectId)
  // Four-eyes: the author cannot decide its own review. The server enforces it; the control says so before the click.
  const selfReview = isRealMode() && !!session?.session?.actor?.id && f.owner === session.session.actor.id
  const proj = data.project
  const op = data.operation
  const step = data.step
  const real = isRealMode()
  const noEv = f.evidence.length === 0
  const roReason = me.role === 'viewer' ? 'The Client / Viewer role is read-only.' : 'Project is closed — read-only.'
  const reviewDecision = f.lastReviewDecision
  const returnedNote = f.status === 'returned' ? reviewDecision?.action === 'returned' ? { by: reviewDecision.actorId, at: activityTime(reviewDecision.createdAt), text: reviewDecision.reason ?? '' } : [...olderHistory, ...f.history].reverse().find((event) => event.text.startsWith('Returned for changes')) : undefined
  const reports = db.reports.filter((r) => r.projectId === f.projectId && ['draft', 'returned'].includes(r.status))
  const inReport = real ? db.reports.filter((r) => r.findings.includes(f.id)).map((r) => ({ id: r.id, title: r.title })) : data.inReports
  const reportReason = realControlGap('finding.reportLink') ?? (f.status === 'ai_suggested' ? 'AI suggestions are unverified and cannot be included in a report. Verify the finding first.' : ro ? roReason : !can('editReport', f.projectId) ? `The ${ROLE_LABEL[me.role]} role cannot edit reports.` : ['draft', 'review', 'returned'].includes(f.status) ? 'Only confirmed findings can be added to a report.' : '')

  const lastDecision = reviewDecision ? { text: `${reviewDecision.action === 'confirmed' ? 'Confirmed' : 'Returned for changes'} @ v${reviewDecision.version}`, by: reviewDecision.actorId } : [...olderHistory, ...f.history].reverse().find((h) => /Confirmed|Returned/.test(h.text))
  /** One lifecycle move through the typed handler; the handler is the
   *  enforcer — a refusal (role, state, read-only) surfaces its reason. */
  const runTransition = async (to: FindingTransitionTarget, msg: string, opts?: { note?: string; warn?: boolean }) => {
    const res = await writes.transition(f.id, to, opts?.note, f.version)
    if (res.ok) {
      toast(msg, opts?.warn ? 'warn' : 'ok')
      await queryClient.invalidateQueries({ queryKey: ['finding'] })
    }
    else toast(res.failure.message, 'warn')
  }
  const doSubmit = () => { void runTransition('review', `${f.id} submitted for review.`) }
  const approve = () => confirm({ title: `Confirm ${f.id}?`, body: 'The finding will move to "Confirmed" and can be added to reports.', confirmLabel: 'Confirm Finding', onConfirm: () => { void runTransition('confirmed', `${f.id} was confirmed.`) } })
  const sendBack = () => confirm({ title: `Return ${f.id} for changes`, body: 'The author will be notified with your reason so they can make changes.', confirmLabel: 'Return for Changes', danger: true, reasonLabel: 'Reason for returning', reasonRequired: true, onConfirm: (r) => { void runTransition('returned', `${f.id} returned to the author.`, { note: r, warn: true }) } })

  const actions: ReactNode[] = []
  if (real && ['review', 'confirmed', 'remediation', 'retest'].includes(f.status)) actions.push(<Button key="edit-content" icon={Pencil} disabled={ro || !author} title="Editing confirmed content returns the finding to review." onClick={() => go('finding-new', { id: f.id })}>Edit Finding</Button>)
  if (['draft', 'returned'].includes(f.status)) {
    actions.push(
      <Button key="e" icon={Pencil} disabled={ro || !author} title={ro ? roReason : !author ? `The ${ROLE_LABEL[me.role]} role cannot edit.` : ''} onClick={() => go('finding-new', { id: f.id })}>Edit Draft</Button>,
      <Button key="s" variant="primary" icon={Send} disabled={ro || !author || noEv} title={ro ? roReason : !author ? 'You do not have permission to submit for review.' : noEv ? 'At least 1 piece of evidence is required to submit for review — add it in the Evidence tab.' : ''} onClick={doSubmit}>Submit for Review</Button>,
    )
  }
  if (f.status === 'ai_suggested') {
    const w = ai.why(f)
    const dismissWhy = ai.dismissWhy(f)
    actions.push(
      <Button key="d" disabled={!!dismissWhy || !!ai.dismissed[f.id]} title={dismissWhy || 'Dismiss with a reason'} onClick={() => ai.dismiss(f)}>Dismiss</Button>,
      <Button key="v" variant="primary" icon={ShieldCheck} disabled={!!w} title={w || 'Verify the suggestion and create a finding in review'} onClick={() => ai.verify(f)}>Verify & create finding</Button>,
    )
  }
  if (f.status === 'review') {
    actions.push(
      <Button key="r" variant="danger" icon={RotateCcw} disabled={ro || !reviewer || selfReview} title={ro ? roReason : !reviewer ? 'Only a Reviewer or Manager can return findings.' : selfReview ? 'The author of this finding cannot return its own review.' : ''} onClick={sendBack}>Return for Changes</Button>,
      <Button key="c" variant="primary" icon={ShieldCheck} disabled={ro || !reviewer || selfReview} title={ro ? roReason : !reviewer ? 'Only a Reviewer or Manager can confirm findings.' : selfReview ? 'The author of this finding cannot confirm its own review.' : ''} onClick={approve}>Confirm Finding</Button>,
    )
  }
  if (f.status === 'confirmed') actions.push(<Button key="rm" variant="primary" disabled={ro || !(reviewer || author)} title={ro ? roReason : ''} onClick={() => confirm({ title: 'Move to remediation?', body: 'Marks the finding as being remediated by the asset owner.', confirmLabel: 'Move to Remediation', onConfirm: () => { void runTransition('remediation', `${f.id} moved to In Remediation.`) } })}>Send to Remediation</Button>)
  if (f.status === 'remediation') actions.push(<Button key="rt" variant="primary" icon={RotateCcw} disabled={ro || !(reviewer || author)} title={ro ? roReason : ''} onClick={() => { void runTransition('retest', `${f.id} is awaiting retest.`) }}>Request Retest</Button>)
  if (f.status === 'retest') actions.push(<Button key="gt" variant="primary" icon={RotateCcw} onClick={() => go('finding', { id: f.id, tab: 'retest' })}>Record Retest</Button>)
  actions.push(
    <Button key="rep" icon={FilePlus2} disabled={!!reportReason} title={reportReason || 'Add this finding to a report in the same project'} onClick={() => setRep(true)}>Add to Report</Button>,
  )

  const postComment = async () => {
    if (!note.trim() || commentSaving) return
    setCommentSaving(true)
    const requestScope: FindingRequestScope = { deploymentId: session?.deploymentId ?? window.location.origin, actorId: session?.session?.actor?.id ?? me.email, engagementId: f.projectId, findingId: f.id, action: 'comment', payload: { text: note.trim() } }
    try {
      const requestId = await findingRequestId(requestScope)
      const result = await writes.addComment(f.id, note.trim(), f.version ?? 1, requestId)
      if (!result.ok) { toast(result.failure.message, 'warn'); return }
      await clearFindingRequest(requestScope)
      setNote('')
      setOlderComments([]); setOlderHistory([]); setActivityCursors({})
      await queryClient.invalidateQueries({ queryKey: ['finding'] })
      toast('Comment posted.')
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The comment could not be saved.', 'warn')
    } finally {
      setCommentSaving(false)
    }
  }
  const activityCursor = (kind: FindingActivityKind) => activityCursors[kind] === undefined ? f.activityCursors?.[kind] ?? null : activityCursors[kind] ?? null
  const loadOlderActivity = async (kind: 'comments' | 'history') => {
    const cursor = activityCursor(kind)
    if (!cursor || activityLoading) return
    setActivityLoading(kind)
    const page = await writes.loadActivity(f.id, kind, cursor, f.version ?? 1)
    if (activityVersion.current !== f.version) return
    setActivityLoading(null)
    if (!page.ok) { toast(page.failure.message, 'warn'); return }
    const events = [...page.data.items].reverse()
    if (kind === 'comments') setOlderComments((previous) => [...events.map((item) => ({ by: item.actorId, at: activityTime(item.createdAt), text: item.text })), ...previous])
    else setOlderHistory((previous) => [...events.map((item) => ({ at: activityTime(item.createdAt), by: item.actorId, text: item.text })), ...previous])
    setActivityCursors((previous) => ({ ...previous, [kind]: page.data.nextCursor }))
  }

  return (
    <div>
      <PageHeader
        back={{ label: 'Findings', to: () => go('findings') }}
        title={f.title}
        meta={<><Sev v={f.severity} /><Status kind="finding" value={f.status} /></>}
        sub={<span className="flex flex-wrap items-center gap-x-4 gap-y-1"><Mono className="text-accent">{f.id}</Mono><span>Project <Mono>{f.projectId}</Mono></span><span>Owner: {f.owner}</span><span>Updated {f.updated}</span></span>}
        actions={actions}
      />
      {ro && <Banner tone="warn" icon={Lock} title="Read-only mode">{roReason} Actions that change data are disabled, each with an explanation.</Banner>}
      {returnedNote && (
        <Banner tone="bad" icon={RotateCcw} title={`Returned by ${returnedNote.by} — ${returnedNote.at}`} action={!ro && author ? <Button size="sm" variant="secondary" icon={Pencil} onClick={() => go('finding-new', { id: f.id })}>Edit now</Button> : undefined}>
          <span className="whitespace-pre-wrap">{returnedNote.text.replace(/^Returned for changes(?::\s*)?/, '')}</span>
        </Banner>
      )}
      {f.status === 'ai_suggested' && (
        <Banner tone="warn" icon={Sparkles} title="AI Suggested — unverified">
          {data.producer ? `Produced from ${data.producer.path}. ` : 'Proposed by the AI Operator. '}Not a finding yet: excluded from confirmed counts, severity charts and reports. {ai.dismissed[f.id] ? `Dismissed: ${ai.dismissed[f.id]}` : 'Verify it against the source output before importing it as a draft.'}
        </Banner>
      )}
      {f.status === 'review' && !reviewer && !ro && <PersonaHint need="Reviewer" persona={real ? undefined : 'Pat Kim'}>{real ? 'This finding is awaiting review by a Reviewer or Manager.' : 'This finding is awaiting review. Switch to the Reviewer role to Confirm or Return it.'}</PersonaHint>}
      {['draft', 'returned'].includes(f.status) && !author && !ro && me.role !== 'viewer' && <PersonaHint need="Operator" persona={real ? undefined : 'Taylor Chen'}>Editing and submitting for review require the Operator or Manager role.</PersonaHint>}
      <Tabs
        value={tab} onChange={(t) => go('finding', { id: f.id, tab: t })}
        tabs={[{ id: 'overview', label: 'Summary & workflow' }, { id: 'evidence', label: 'Evidence', count: f.evidence.length }, { id: 'retest', label: 'Retest', count: f.retests.length }]}
      />
      {tab === 'evidence' ? <EvidenceTab f={f} evs={data.evidence} ro={ro} /> : tab === 'retest' ? <RetestTab key={`${f.id}:${f.version}`} f={f} ro={ro} roReason={roReason} /> : (
        <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
          <div className="space-y-6">
            {data.producer && <Card>
              <CardHeader title={data.producer.evidence ? 'Runtime producer output' : 'Imported producer lineage'} sub={`${data.producer.path}${data.producer.sizeBytes === undefined ? '' : ` · ${data.producer.sizeBytes} bytes`}`} />
              <div className="space-y-3 text-sm">
                {data.producer.resolved === false && <Banner tone="warn" title="Producer source is not retained">The imported claim keeps its source reference, but the server could not resolve it to retained artifact bytes.</Banner>}
                {data.producer.digest && <p className="break-all text-xs text-muted">Producer source SHA-256: <span className="font-mono">{data.producer.digest}</span></p>}
                {data.producer.quality?.defaultSeverity && <Banner tone="warn" title="Severity is a parser default">The source did not include a recognized severity. Review the value before curation.</Banner>}
                {data.producer.quality?.placeholderDescription && <Banner tone="warn" title="Description is a placeholder">The source did not provide a description.</Banner>}
                {data.producer.quality?.placeholderEvidence && <Banner tone="warn" title="Evidence is a placeholder">The source did not provide an evidence reference.</Banner>}
                {data.producer.quality?.unreadable && <Banner tone="warn" title="Producer source is unreadable">The retained source could not be parsed completely.</Banner>}
                {data.producer.evidence && <div><div className="mb-1 text-xs text-muted">Producer evidence text — not an evidence reference</div><p className="whitespace-pre-wrap leading-relaxed">{data.producer.evidence}</p></div>}
                {data.producer.attackVector && <div><div className="mb-1 text-xs text-muted">Attack vector</div><p className="whitespace-pre-wrap leading-relaxed">{data.producer.attackVector}</p></div>}
              </div>
            </Card>}
            <Card>
              <CardHeader title="Analysis & impact" />
              <div className="space-y-4 text-sm">
                <div><div className="mb-1 text-xs text-muted">Description</div><p className="leading-relaxed">{f.desc}</p></div>
                <div><div className="mb-1 text-xs text-muted">Technical observations</div><p className="leading-relaxed">{step ? `${step.id} (${step.technique}) on ${step.asset}: ${step.output}` : 'No linked step observation.'}</p></div>
                <div><div className="mb-1 text-xs text-muted">Impact</div><p className="leading-relaxed">{f.impact || 'Not recorded.'}</p></div>
                <div><div className="mb-1 text-xs text-muted">Recommendations</div><p className="leading-relaxed">{f.rec || 'Not recorded.'}</p></div>
                <div><div className="mb-1 text-xs text-muted">Severity rationale</div><p className="leading-relaxed">{f.severityRationale || 'Not recorded.'}</p></div>
                <div><div className="mb-1 text-xs text-muted">Scope note</div><p className="leading-relaxed">{f.scopeNote || 'Not recorded.'}</p></div>
              </div>
            </Card>
            <Card>
              <CardHeader title="Links" />
              <DescList cols={2} items={[
                { k: 'Affected asset', v: real ? <Mono>{f.references?.assetId ?? 'Not linked'}</Mono> : data.assetId ? <button className="font-mono text-[13px] text-accent hover:underline" onClick={() => go('asset', { id: data.assetId })}>{f.asset} <ExternalLink size={11} className="inline" /></button> : <Mono>{f.asset}</Mono> },
                { k: 'Evidence', v: f.evidence.length ? f.evidence.map((id) => <button key={id} className="mr-2 whitespace-nowrap font-mono text-[13px] text-accent hover:underline" onClick={() => go('evidence', { id })}>{id}</button>) : <span className="text-muted">None linked</span> },
                { k: 'Operation step', v: op && step ? <button className="whitespace-nowrap font-mono text-[13px] text-accent hover:underline" onClick={() => go('operation', { id: op.id, tab: 'console' })}>{op.id} / {step.id} — {step.name}</button> : '—' },
                { k: 'Confidence', v: f.status === 'ai_suggested' ? 'Low — AI inference, needs verification' : f.evidence.length ? 'Supported by linked evidence — a recorded claim, not proven exploitability' : 'Low — no evidence linked' },
                { k: 'Reviewer decision', v: f.status === 'ai_suggested' ? 'Not submitted' : lastDecision ? `${lastDecision.text} by ${lastDecision.by}` : 'Pending' },
                { k: 'Execution', v: real ? <span className="break-all text-xs">Thread: {f.references?.threadId ?? '—'}<br />Run: {f.references?.runId ?? '—'}<br />Binding: {f.references?.bindingId ?? '—'}</span> : op ? <button className="font-mono text-[13px] text-accent hover:underline" onClick={() => go('operation', { id: op.id })}>{op.id} — {op.name}</button> : f.op || '—' },
                { k: 'ATT&CK technique', v: f.technique ? <button className="text-left text-accent hover:underline" onClick={() => go('technique', { id: f.technique })}><Mono>{f.technique}</Mono>{data.techniqueName ? ` — ${data.techniqueName}` : ''}</button> : 'Not linked' },
                { k: 'Client', v: proj?.client },
                { k: 'Recorded', v: f.date },
                { k: 'Included in reports', v: inReport.length ? inReport.map((r) => <button key={r.id} className="mr-2 font-mono text-[13px] text-accent hover:underline" onClick={() => go('report', { id: r.id })}>{r.id}</button>) : 'Not yet' },
              ]} />
            </Card>
            <Card>
              <CardHeader title="Execution timeline" sub="From the source step through evidence to this finding." />
              <Timeline items={[
                ...(step && step.ts !== '—' ? [{ at: `${step.ts} (UTC+7)`, title: `Step ${step.id} executed — ${step.name}`, sub: `${step.agent} on ${step.asset} · ${step.technique}`, tone: 'cyan' as const }] : []),
                ...data.evidence.map((e) => ({ at: e.at, title: `Evidence ${e.ref} captured`, sub: `${e.kind} · ${e.by}`, tone: 'accent' as const })),
                { at: f.date, title: `${f.id} recorded`, sub: f.status === 'ai_suggested' ? 'Suggested by AI Operator' : f.owner, tone: 'accent' as const },
              ]} />
            </Card>
            <Card>
              <CardHeader title="Reviewer comments" sub={`${olderComments.length + f.comments.length} loaded${activityCursor('comments') ? ' · older comments available' : ''}`} />
              {f.comments.length === 0 ? <div className="mb-4 text-sm text-muted">No comments yet.</div> : (
                <ul className="mb-4 space-y-3">
                  {[...olderComments, ...f.comments].map((c, i) => (
                    <li key={c.id ?? `${c.at}:${c.by}:${i}`} className={cx('rounded-lg border p-3', f.status === 'returned' && i === olderComments.length + f.comments.length - 1 ? 'border-bad/40 bg-bad/5' : 'border-line')}>
                      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted"><Person name={c.by} /><span className="font-mono">{c.at}</span></div>
                      <div className="whitespace-pre-wrap text-sm">{c.text}</div>
                    </li>
                  ))}
                </ul>
              )}
              {activityCursor('comments') && <Button size="sm" variant="ghost" disabled={activityLoading !== null} onClick={() => { void loadOlderActivity('comments') }}>{activityLoading === 'comments' ? 'Loading…' : 'Load older comments'}</Button>}
              <Textarea aria-label="Comment" value={note} onChange={(e) => setNote(e.target.value)} disabled={ro} placeholder={ro ? roReason : 'Write a comment for the reviewer / owner…'} className="min-h-20" />
              <div className="mt-2 flex justify-end"><Button onClick={() => { void postComment() }} disabled={ro || commentSaving || !note.trim()} title={ro ? roReason : !note.trim() ? 'Enter a comment.' : ''}>Post comment</Button></div>
            </Card>
          </div>
          <div className="space-y-6">
            <Card>
              <CardHeader title="Workflow" />
              {f.status === 'ai_suggested' && <div className="mb-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">Step 0 — AI Suggested (unverified). Verify to enter the workflow.</div>}
              <ol className="mb-4 space-y-1.5">
                {FLOW.map((s, i) => {
                  const cur = FLOW_IDX[f.status]
                  return (
                    <li key={s} className={cx('flex items-center gap-2 rounded-lg border px-3 py-2 text-xs', i === cur ? 'border-accent bg-accent/10 text-fg' : i < cur ? 'border-ok/40 text-fg' : 'border-line text-muted')}>
                      <span className={cx('flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold', i < cur ? 'bg-ok text-white' : i === cur ? 'bg-accent text-white' : 'bg-hover')}>{i < cur ? '✓' : i + 1}</span>
                      {s}{i === cur && f.status === 'returned' && <span className="ml-auto text-bad">Returned for changes</span>}{i === cur && f.status !== 'returned' && <span className="ml-auto text-accent">Current</span>}
                    </li>
                  )
                })}
              </ol>
              <div className="mb-3 text-xs font-medium text-muted">Change history</div>
              {[...olderHistory, ...f.history].length === 0 ? <div className="text-sm text-muted">No history recorded.</div> : (
                <Timeline items={[...olderHistory, ...f.history].reverse().map((h) => ({ at: h.at, title: h.text, sub: h.by, tone: /Returned/.test(h.text) ? 'bad' : /Confirmed|Resolved|resolved/.test(h.text) ? 'ok' : /review/i.test(h.text) ? 'warn' : 'accent' }))} />
              )}
              {activityCursor('history') && <Button size="sm" variant="ghost" disabled={activityLoading !== null} onClick={() => { void loadOlderActivity('history') }}>{activityLoading === 'history' ? 'Loading…' : 'Load older history'}</Button>}
            </Card>
          </div>
        </div>
      )}
      <AddToReport open={rep} onClose={() => setRep(false)} f={f} reports={reports} />
    </div>
  )
}

function AddToReport({ open, onClose, f, reports }: { open: boolean; onClose: () => void; f: Finding; reports: { id: string; title: string; version: string; status: string; findings: string[] }[] }) {
  const services = useServicesOrNull()
  const me = useMe()
  const toast = useToastStore((s) => s.toast)
  const setFilter = useSessionStore((s) => s.setFilter)
  const real = isRealMode()
  const reportWrites = useReportWrites()
  const queryClient = useQueryClient()
  // Real mode adds the finding through the report's findings write, sending the version the choice was read at.
  const addTo = async (r: { id: string; version: string; findings: string[] }, has: boolean) => {
    if (!has && real) {
      const res = await reportWrites.setFindings(r.id, [...r.findings, f.id], Number(r.version.replace(/^v/, '')))
      if (!res.ok) { toast(res.failure.message, 'warn'); return }
      void queryClient.invalidateQueries({ queryKey: ['report'] })
    } else if (!has && services) setReportFindingsLegacyTransaction(services.authority, { actor: { id: me.name, role: me.role }, projectId: f.projectId, corr: 'legacy' }, r.id, [...r.findings, f.id])
    toast(has ? `${f.id} is already in ${r.id}.` : `Added ${f.id} to ${r.id}.`)
    onClose()
    go('report', { id: r.id })
  }
  return (
    <Modal open={open} onClose={onClose} title="Add finding to report" footer={<Button onClick={onClose}>Close</Button>}>
      <p className="mb-3 text-muted">Only editable reports in the same project <Mono>{f.projectId}</Mono> are shown.</p>
      {reports.length === 0 ? <div className="mb-4 rounded-lg border border-dashed border-line p-4 text-sm text-muted">There are no draft reports in this project yet.</div> : (
        <ul className="mb-4 space-y-2">
          {reports.map((r) => {
            const has = r.findings.includes(f.id)
            return (
              <li key={r.id} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5">
                <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{r.title}</div><div className="text-xs text-muted"><Mono>{r.id}</Mono> · {r.version} · {r.findings.length} finding(s)</div></div>
                <Button size="sm" variant="primary" onClick={() => { void addTo(r, has) }}>{has ? 'Open report' : 'Add'}</Button>
              </li>
            )
          })}
        </ul>
      )}
      <Button icon={Plus} onClick={() => { setFilter('report-prefill', { projectId: f.projectId, findings: [f.id] }); onClose(); go('report-new') }}>Create a new report with this finding</Button>
    </Modal>
  )
}

/* ───────────── Evidence tab (ticket 31: masked read; ticket 32: typed link/upload) ───────────── */
const OK_EXT = ['png', 'jpg', 'jpeg', 'txt', 'log', 'json', 'csv', 'pdf']
function saveEvidenceFile(file: EvidenceDownload): void {
  const blob = new Blob([file.bytes.slice().buffer], { type: file.mediaType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = file.filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function EvidenceTab({ f, evs, ro }: { f: Finding; evs: EvidenceView[]; ro: boolean }) {
  const can = useCan()
  const toast = useToastStore((s) => s.toast)
  const me = useMe()
  const writes = useFindingWrites()
  const client = useQueryClient()
  const evidenceList = useEvidenceList({})
  const [view, setView] = useState<EvidenceView | null>(null)
  const [classifying, setClassifying] = useState<EvidenceView | null>(null)
  const [attach, setAttach] = useState(false)
  const [up, setUp] = useState(false)
  const canAdd = !ro && can('createFinding', f.projectId)
  const why = ro ? (me.role === 'viewer' ? 'The Client / Viewer role is read-only.' : 'Project is closed — read-only.') : !canAdd ? `The ${ROLE_LABEL[me.role]} role cannot add evidence.` : ''
  const candidates = (evidenceList.data?.items ?? []).filter((e) => e.projectId === f.projectId && !e.findingId && !f.evidence.includes(e.ref))
  const canClassifyAny = candidates.some((e) => e.classification === 'unclassified' && e.canClassify)
  // A linked capture is not a candidate, but its owner or reviewer still classifies it from the finding.
  const classifyTarget = (ev: EvidenceView): EvidenceView | null => {
    const match = (evidenceList.data?.items ?? []).find((e) => e.ref === ev.ref)
    return match && match.classification === 'unclassified' && match.canClassify ? match : null
  }
  const refreshEvidence = (): void => {
    void client.invalidateQueries({ queryKey: ['evidence'] })
    void client.invalidateQueries({ queryKey: ['finding'] })
  }
  const link = async (evidenceId: string) => {
    const res = await writes.attachEvidence(f.id, evidenceId)
    if (res.ok) { toast(`Linked ${evidenceId} to ${f.id}.`); refreshEvidence() }
    else toast(res.failure.message, 'warn')
  }
  const download = async (evidence: EvidenceView) => {
    if (!isRealMode()) { toast(`Download of ${evidence.name} started (simulated).`, 'info'); return }
    const result = await writes.downloadEvidence(evidence.captureId ?? evidence.ref)
    if (!result.ok) { toast(result.failure.message, 'warn'); return }
    saveEvidenceFile(result.data)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto text-sm text-muted">{evs.length} evidence item(s) — links are opaque references to retained captures; a linked claim still needs reviewer verification and is never proof of exploitability by itself. Evidence cannot be removed from history; every link is logged.</span>
        <Button icon={Link2} disabled={!canAdd && !canClassifyAny} title={!canAdd && !canClassifyAny ? why || 'No capture is awaiting your classification.' : undefined} onClick={() => setAttach(true)}>{canAdd ? 'Link Evidence' : 'Classify captures'}</Button>
        <Button variant="primary" icon={Upload} disabled={!canAdd} title={why} onClick={() => setUp(true)}>Upload evidence</Button>
      </div>
      <Table
        rows={evs} rowKey={(e) => e.ref} onRow={setView}
        empty={<Empty icon={Paperclip} title="No evidence yet" action={<Button variant="primary" icon={Upload} disabled={!canAdd} title={why} onClick={() => setUp(true)}>Upload evidence</Button>}>A finding needs at least one piece of evidence before it can be submitted for review.</Empty>}
        cols={[
          { key: 'n', header: 'Name', render: (e) => <div className="flex items-center gap-2"><Mono className="text-accent">{e.ref}</Mono><MaskedName ev={e} /></div> },
          { key: 'k', header: 'Type', render: (e) => e.kind },
          { key: 's', header: 'Source', hideBelow: 'md', render: (e) => <Mono>{e.source}</Mono> },
          { key: 'a', header: 'Captured at', hideBelow: 'lg', render: (e) => <span className="text-xs text-muted">{e.at}</span> },
          { key: 'b', header: 'Uploaded by', hideBelow: 'md', render: (e) => e.by },
          { key: 'l', header: 'Label', render: (e) => e.classification === 'unclassified' ? <span className="text-xs text-warn">Awaiting classification</span> : e.sensitive ? <span className="inline-flex items-center gap-1 text-xs text-warn"><Lock size={12} aria-hidden />Sensitive</span> : <span className="text-xs text-muted">Standard</span> },
        ]}
      />
      <Drawer open={!!view} onClose={() => setView(null)} title={view ? <span><Mono className="text-accent">{view.ref}</Mono> · <MaskedName ev={view} /></span> : ''}
        footer={view && <><Button icon={Eye} onClick={() => go('evidence', { id: view.captureId ?? view.ref })}>Open in Evidence Inspector</Button>{classifyTarget(view) && <Button icon={ShieldCheck} onClick={() => { setClassifying(classifyTarget(view)); setView(null) }}>Classify capture</Button>}<Button icon={Download} disabled={view.masked || isRealMode() && !view.canViewOriginal} title={view.masked ? 'Classification has not made this filename visible to your role.' : isRealMode() && !view.canViewOriginal ? 'The current classification does not permit reading the original bytes.' : undefined} onClick={() => void download(view)}>Download original</Button></>}>
        {view && <EvidencePreview ev={view} f={f} onOp={() => view.opId && go('operation', { id: view.opId })} />}
      </Drawer>
      <Modal open={attach} onClose={() => setAttach(false)} title="Link existing evidence" footer={<Button onClick={() => setAttach(false)}>Done</Button>}>
        {evidenceList.isError && <Banner tone="bad" title="Could not load retained captures">{evidenceList.error instanceof Error ? evidenceList.error.message : 'Capture inventory is unavailable.'}</Banner>}
        {evidenceList.isPending ? <Skeleton className="h-16" /> : candidates.length === 0 ? <div className="text-sm text-muted">No unlinked, classified evidence from {f.projectId} is available. Uploads appear here after an owner or reviewer classifies them.</div> : (
          <ul className="space-y-2">
            {candidates.map((e) => {
              const other = !!e.findingId && e.findingId !== f.id
              const unclassified = e.classification === 'unclassified'
              const inaccessible = e.sensitive && !e.canViewOriginal
              return (
                <li key={e.ref} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5">
                  <div className="min-w-0 flex-1"><div className="truncate text-sm"><Mono className="text-accent">{e.ref}</Mono> {e.masked ? 'Capture name restricted' : e.name}</div><div className="text-xs text-muted">{e.kind} · {e.source}{e.classification ? ` · ${e.classification}` : ''}{other ? ` · linked to ${e.findingId}` : ''}</div></div>
                  {unclassified && e.canClassify ? <Button size="sm" onClick={() => { setClassifying(e); setAttach(false) }}>Classify</Button> : null}
                  <Button size="sm" disabled={other || inaccessible || !canAdd} title={other ? `Already linked to ${e.findingId}` : inaccessible ? 'Classification restricts original access to owner/reviewer.' : !canAdd ? why : unclassified ? 'Linked now; original bytes stay locked until an owner or reviewer classifies the capture.' : undefined} onClick={() => { void link(e.captureId ?? e.ref) }}>Link</Button>
                </li>
              )
            })}
          </ul>
        )}
      </Modal>
      <CaptureClassificationModal evidence={classifying} onClose={() => setClassifying(null)} onClassified={refreshEvidence} />
      <UploadModal open={up} onClose={() => setUp(false)} f={f} onUploaded={refreshEvidence} />
    </div>
  )
}

function UploadModal({ open, onClose, f, onUploaded }: { open: boolean; onClose: () => void; f: Finding; onUploaded: () => void }) {
  return isRealMode()
    ? <RealCaptureUploadModal open={open} onClose={onClose} f={f} onUploaded={onUploaded} />
    : <MockEvidenceUploadModal open={open} onClose={onClose} f={f} onUploaded={onUploaded} />
}

function MockEvidenceUploadModal({ open, onClose, f, onUploaded }: { open: boolean; onClose: () => void; f: Finding; onUploaded: () => void }) {
  const toast = useToastStore((s) => s.toast)
  const writes = useFindingWrites()
  const [name, setName] = useState('')
  const [kind, setKind] = useState('Image')
  const [sens, setSens] = useState(false)
  const [source, setSource] = useState(f.op ? `${f.op} / manual` : 'Manual upload')
  const [tried, setTried] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const ext = name.split('.').pop()?.toLowerCase() || ''
  const e = !name.trim() ? 'Enter a file name.' : !name.includes('.') || !OK_EXT.includes(ext) ? `Unsupported file type. Accepted: ${OK_EXT.join(', ')}.` : ''
  const save = async () => {
    setTried(true)
    if (e) return
    const res = await writes.uploadEvidence({ findingId: f.id, name: name.trim(), kind, source, sensitive: sens, opId: f.op || undefined })
    if (!res.ok) { setErr(res.failure.message); return }
    toast(`Uploaded ${name.trim()} and linked it to ${f.id}.`)
    setName(''); setTried(false); setSens(false); setErr(null); onUploaded(); onClose()
  }
  return (
    <Modal open={open} onClose={onClose} title="Upload evidence (simulated)" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon={Upload} onClick={() => void save()}>Upload & link</Button></>}>
      <div className="space-y-4">
        {err && <Banner tone="bad" title="The evidence was not uploaded">{err}</Banner>}
        <Field label="File name" required error={tried ? e : undefined} hint="No real file is uploaded — only a simulated record is created."><Input value={name} onChange={(x) => setName(x.target.value)} placeholder="e.g. evidence-028.png" /></Field>
        <Field label="Type"><Select value={kind} onChange={(x) => setKind(x.target.value)}>{['Image', 'Image (redacted)', 'Text', 'JSON', 'Log'].map((k) => <option key={k}>{k}</option>)}</Select></Field>
        <Field label="Source"><Input value={source} onChange={(x) => setSource(x.target.value)} /></Field>
        <Check checked={sens} onChange={setSens} label="Mark as sensitive (redacted for users without permission)" />
        <div className="text-xs text-muted">This evidence will belong to project <Mono>{f.projectId}</Mono>.</div>
      </div>
    </Modal>
  )
}

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  bin: 'application/octet-stream', csv: 'text/plain', gif: 'image/gif', jpeg: 'image/jpeg', jpg: 'image/jpeg',
  json: 'application/json', log: 'text/plain', pdf: 'application/pdf', png: 'image/png', txt: 'text/plain',
}

function RealCaptureUploadModal({ open, onClose, f, onUploaded }: { open: boolean; onClose: () => void; f: Finding; onUploaded: () => void }): ReactNode {
  const session = useSession()
  const writes = useFindingWrites()
  const toast = useToastStore((s) => s.toast)
  const fileInput = useRef<HTMLInputElement>(null)
  const pending = useRef<{ fingerprint: string; requestId: string } | null>(null)
  const [source, setSource] = useState(f.op ? `${f.op} / manual` : 'Operator upload')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const save = async (): Promise<void> => {
    const file = fileInput.current?.files?.[0]
    if (!file) { setError('Select a capture file.'); return }
    if (file.size < 1 || file.size > 262144) { setError('Select a capture of 1–262144 bytes.'); return }
    const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
    const mediaType = file.type && Object.values(MIME_BY_EXTENSION).includes(file.type) ? file.type : MIME_BY_EXTENSION[extension]
    if (!mediaType || !Object.values(MIME_BY_EXTENSION).includes(mediaType)) { setError('Unsupported media type.'); return }
    setBusy(true); setError(null)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer)), (value) => value.toString(16).padStart(2, '0')).join('')
      const fingerprint = `${file.name}\u0000${mediaType}\u0000${digest}`
      const actorId = session.session?.actor?.id ?? 'local'
      const deploymentId = session.deploymentId ?? 'local'
      const requestId = pending.current?.fingerprint === fingerprint
        ? pending.current.requestId
        : captureRequestId(deploymentId, actorId, f.projectId, fingerprint)
      pending.current = { fingerprint, requestId }
      const result = await writes.uploadEvidence({ findingId: f.id, name: file.name, kind: mediaType, source, sensitive: false, bytes, mediaType, requestId })
      if (!result.ok) { setError(result.failure.message); return }
      pending.current = null
      clearCaptureRequest(deploymentId, actorId, f.projectId, fingerprint)
      if (fileInput.current) fileInput.current.value = ''
      toast(`Capture ${result.data.id} retained as unclassified. You can link it now; original bytes stay locked until an owner or reviewer classifies it.`)
      onUploaded()
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Capture upload failed. Re-select the same file to reconcile this request.')
    } finally { setBusy(false) }
  }
  return <Modal open={open} onClose={onClose} title="Retain evidence capture" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon={Upload} disabled={busy} onClick={() => void save()}>{busy ? 'Retaining…' : 'Retain unclassified capture'}</Button></>}>
    <div className="space-y-4">
      {error && <Banner tone="bad" title="Capture was not acknowledged">{error} If the server may have saved it, re-select the same file to retry with the same request identity.</Banner>}
      <Field label="Capture file" required hint="Maximum 256 KiB. Captures start unclassified; original bytes stay locked until an owner or reviewer classifies them."><input ref={fileInput} type="file" accept=".png,.jpg,.jpeg,.gif,.txt,.log,.json,.pdf,.bin" className="block w-full text-sm" onChange={() => setError(null)} /></Field>
      <Field label="Source context"><Input value={source} onChange={(event) => setSource(event.target.value)} /></Field>
      <p className="text-xs text-muted">This file will be retained in engagement <Mono>{f.projectId}</Mono>. The selected context is display-only; producer attribution comes from the authenticated server session.</p>
    </div>
  </Modal>
}

function CaptureClassificationModal({ evidence, onClose, onClassified }: { evidence: EvidenceView | null; onClose: () => void; onClassified: () => void }) {
  const writes = useFindingWrites()
  const toast = useToastStore((s) => s.toast)
  const [classification, setClassification] = useState<'standard' | 'sensitive'>('standard')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const classify = async () => {
    if (!evidence?.captureId || !reason.trim()) return
    const res = await writes.classifyCapture(evidence.captureId, classification, evidence.classificationVersion ?? 1, reason.trim())
    if (!res.ok) { setError(res.failure.message); return }
    toast(`Capture ${evidence.captureId} classified ${classification}.`)
    setError(null); setReason(''); onClassified(); onClose()
  }
  return <Modal open={evidence !== null} onClose={onClose} title="Classify retained capture" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!reason.trim()} onClick={() => void classify()}>Save classification</Button></>}>
    {evidence && <div className="space-y-3">
      <p className="text-sm text-muted">Original bytes remain locked until this decision. Standard captures are readable by engagement members; sensitive captures are readable only by owner/reviewer.</p>
      {error && <Banner tone="bad" title="Classification was not saved">{error}</Banner>}
      <Field label="Capture"><Mono>{evidence.captureId}</Mono></Field>
      <Field label="Classification"><Select value={classification} onChange={(event) => setClassification(event.target.value as 'standard' | 'sensitive')}><option value="standard">Standard — readable by engagement members</option><option value="sensitive">Sensitive — owner/reviewer only</option></Select></Field>
      <Field label="Reason" required><Textarea aria-label="Classification reason" value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
    </div>}
  </Modal>
}

function useEvidenceBytes(evidenceId: string, enabled: boolean) {
  const writes = useFindingWrites()
  const [data, setData] = useState<EvidenceDownload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  useEffect(() => {
    if (!enabled || !evidenceId) { setData(null); setError(null); return }
    let current = true
    setPending(true); setError(null)
    void writes.downloadEvidence(evidenceId).then((result) => {
      if (!current) return
      if (result.ok) setData(result.data)
      else setError(result.failure.message)
    }).catch((reason: unknown) => { if (current) setError(reason instanceof Error ? reason.message : 'Capture download failed.') })
      .finally(() => { if (current) setPending(false) })
    return () => { current = false }
  }, [enabled, evidenceId, writes])
  const imageUrl = useMemo(() => {
    if (!data || !data.mediaType.startsWith('image/') || typeof URL.createObjectURL !== 'function') return null
    return URL.createObjectURL(new Blob([data.bytes.slice().buffer], { type: data.mediaType }))
  }, [data])
  useEffect(() => () => { if (imageUrl) URL.revokeObjectURL(imageUrl) }, [imageUrl])
  return { data, error, imageUrl, pending }
}

type OriginalReadState = ReturnType<typeof useEvidenceBytes>

function CaptureOriginalContent({ evidence, open, original }: { evidence: EvidenceView; open: boolean; original: OriginalReadState }): ReactNode {
  if (!evidence.captureId) return <p className="text-sm text-muted">{realControlGap('evidence.original')}</p>
  if (!evidence.canViewOriginal) return <Banner tone="warn" title="Original bytes are locked">This capture is unclassified or its sensitivity classification does not permit your role to read it.</Banner>
  if (!open) return <p className="text-sm text-muted">Choose Preview original to retrieve and verify the retained bytes.</p>
  if (original.pending) return <p role="status" className="text-sm text-muted">Loading and verifying capture bytes…</p>
  if (original.error) return <Banner tone="bad" title="Original capture could not be verified">{original.error}</Banner>
  if (!original.data) return <p className="text-sm text-muted">No original bytes were returned.</p>
  const { data } = original
  const isText = data.mediaType === 'text/plain' || data.mediaType === 'application/json'
  let text: string | null = null
  if (isText) {
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(data.bytes) }
    catch { text = null }
  }
  return <div className="space-y-2">
    <p role="status" className="break-all text-xs text-ok">Capture integrity verified · SHA-256 <Mono>{data.digest}</Mono></p>
    {text !== null ? <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-bg p-3 font-mono text-xs">{text}</pre>
      : original.imageUrl ? <img src={original.imageUrl} alt={data.filename} className="max-h-96 max-w-full rounded-lg border border-line object-contain" />
        : <p className="text-sm text-muted">Inline preview is unavailable for this media type. The verified original can be downloaded.</p>}
  </div>
}

function EvidencePreview({ ev, f, onOp }: { ev: EvidenceView; f: Finding; onOp: () => void }) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const original = useEvidenceBytes(ev.captureId ?? '', previewOpen && ev.canViewOriginal === true)
  if (isRealMode()) return <div className="space-y-4">
    <p className="text-sm text-muted">Capture integrity is checked against the original bytes before display. A matching digest does not validate the recorded claim.</p>
    <Button variant="secondary" disabled={!ev.canViewOriginal} title={!ev.canViewOriginal ? 'Classification or role does not permit original-byte access.' : undefined} onClick={() => setPreviewOpen(true)}>Preview original</Button>
    <CaptureOriginalContent evidence={ev} open={previewOpen} original={original} />
    <DescList cols={2} items={[{ k: 'Classification', v: ev.classification ?? 'Legacy / unclassified' }, { k: 'Digest', v: ev.digest ?? 'Not recorded' }, { k: 'Size', v: ev.sizeBytes === undefined ? 'Unknown' : `${ev.sizeBytes} bytes` }]} />
  </div>
  const hide = ev.masked
  const isImg = ev.kind.startsWith('Image')
  const sample = ev.kind === 'JSON' ? '{\n  "role": "service-demo",\n  "permissions": ["read", "list", "write (exceeds policy)"]\n}' : 'user=demo_account\ngroups=Users, Backup (simulated)\n[sanitized — contains no sensitive data]'
  return (
    <div className="space-y-4">
      {hide ? (
        <Banner tone="warn" icon={Lock} title="Sensitive content redacted">Your role is not permitted to view files with a sensitive label.</Banner>
      ) : isImg ? (
        <div className="flex h-48 items-center justify-center rounded-lg border border-line bg-bg text-muted" role="img" aria-label="Image preview (simulated)"><div className="text-center"><FileImage size={32} className="mx-auto mb-2" aria-hidden /><div className="text-xs">Image with data redacted — {ev.name}</div></div></div>
      ) : (
        <pre className="max-h-56 overflow-auto rounded-lg border border-line bg-bg p-3 font-mono text-xs leading-relaxed">{sample}</pre>
      )}
      <DescList cols={2} items={[
        { k: 'Type', v: ev.kind }, { k: 'Source', v: <Mono>{ev.source}</Mono> }, { k: 'Captured at', v: ev.at }, { k: 'Uploaded by', v: ev.by },
        { k: 'Project', v: <Mono>{ev.projectId}</Mono> }, { k: 'Sensitive label', v: ev.sensitive ? 'Yes' : 'No' },
        { k: 'Related finding', v: <Mono>{ev.findingId || f.id}</Mono> },
        { k: 'Operation', v: ev.opId ? <button className="font-mono text-[13px] text-accent hover:underline" onClick={onOp}>{ev.opId}</button> : '—' },
      ]} />
      <div>
        <div className="mb-2 text-xs text-muted">Link / change history</div>
        <Timeline items={[{ at: ev.at, title: `Uploaded by ${ev.by}`, sub: ev.source }, { at: ev.at, title: `Linked to ${ev.findingId || f.id}`, sub: 'Cannot be removed from history', tone: 'cyan' }]} />
      </div>
    </div>
  )
}

/* ───────────── Retest tab (ticket 32: record + outcome in one typed commit) ───────────── */
const RETEST_STATE: Record<string, { label: string; tone: 'ok' | 'bad' | 'warn' | 'neutral' }> = {
  'Resolved': { label: 'Resolved', tone: 'ok' }, 'Persists': { label: 'Still present', tone: 'bad' }, 'Partial': { label: 'Partially resolved', tone: 'warn' },
}
function RetestTab({ f, ro, roReason }: { f: Finding; ro: boolean; roReason: string }) {
  const session = useContext(SessionContext)
  const toast = useToastStore((s) => s.toast)
  const can = useCan()
  const me = useMe()
  const writes = useFindingWrites()
  const queryClient = useQueryClient()
  const evidence = useEvidenceList({})
  const [result, setResult] = useState('Resolved')
  const [note, setNote] = useState('')
  const [captureIds, setCaptureIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [tried, setTried] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [olderRetests, setOlderRetests] = useState<Finding['retests']>([])
  const [cursor, setCursor] = useState<string | null | undefined>(undefined)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const stageOk = ['confirmed', 'remediation', 'retest'].includes(f.status)
  const resolutionEvidence = [...new Map((evidence.data?.items ?? []).filter((item) => item.projectId === f.projectId && item.captureId && ['standard', 'sensitive'].includes(item.classification ?? '') && item.canViewOriginal).map((item) => [item.captureId, item])).values()]
  const roleOk = can('createFinding', f.projectId) || can('reviewFinding', f.projectId)
  const inputReason = ro ? roReason : !roleOk ? `The ${ROLE_LABEL[me.role]} role cannot record retests.` : !stageOk ? 'Retest is only available after the finding has been confirmed.' : ''
  const reason = inputReason || (result === 'Resolved' && f.status !== 'retest' ? 'Move the finding to retest before resolving it.' : result === 'Resolved' && captureIds.length === 0 ? 'Select at least one classified retained capture to resolve this finding.' : '')
  const save = async () => {
    setTried(true)
    if (!note.trim() || saving || reason) return
    setSaving(true)
    const requestScope: FindingRequestScope = { deploymentId: session?.deploymentId ?? window.location.origin, actorId: session?.session?.actor?.id ?? me.email, engagementId: f.projectId, findingId: f.id, action: 'retest', payload: { result, note: note.trim(), captureIds: [...captureIds].sort() } }
    try {
      const requestId = await findingRequestId(requestScope)
      const res = await writes.recordRetest(f.id, { result, note: note.trim(), requestId, expectedVersion: f.version ?? 1, captureIds })
      if (!res.ok) { setErr(res.failure.message); return }
      await clearFindingRequest(requestScope)
      toast(result === 'Resolved' ? `${f.id} was marked Resolved.` : 'Retest result recorded.', result === 'Resolved' ? 'ok' : 'warn')
      setNote(''); setTried(false); setErr(null); setCaptureIds([])
      await queryClient.invalidateQueries({ queryKey: ['finding'] })
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'The retest could not be saved.')
    } finally {
      setSaving(false)
    }
  }
  const retestCursor = cursor === undefined ? f.activityCursors?.retests ?? null : cursor
  const loadOlder = async () => {
    if (!retestCursor || loadingHistory) return
    setLoadingHistory(true)
    const page = await writes.loadActivity(f.id, 'retests', retestCursor, f.version ?? 1)
    setLoadingHistory(false)
    if (!page.ok) { setErr(page.failure.message); return }
    setOlderRetests((previous) => [...[...page.data.items].reverse().map((item) => ({ at: activityTime(item.createdAt), by: item.actorId, result: item.result ?? '', note: item.note ?? '' })), ...previous])
    setCursor(page.data.nextCursor)
  }
  return (
    <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
      <div>
        <div className="mb-3 text-sm font-semibold">Retest history</div>
        <Table
          rows={[...olderRetests, ...f.retests].reverse()} rowKey={(r) => r.at + r.by + r.note}
          empty={<Empty icon={RotateCcw} title="No retests yet">Current state: <b>Undetermined</b>. Record a result after the owner remediates.</Empty>}
          cols={[
            { key: 'at', header: 'Date', render: (r) => <span className="text-xs">{r.at}</span> },
            { key: 'by', header: 'Tester', render: (r) => r.by },
            { key: 'op', header: 'Source operation', hideBelow: 'md', render: () => <Mono>{f.op || '—'}</Mono> },
            { key: 'res', header: 'Result', render: (r) => { const m = RETEST_STATE[r.result] || { label: r.result, tone: 'neutral' as const }; return <Status kind="generic" value={m.tone} label={m.label} size="sm" /> } },
            { key: 'note', header: 'Notes', render: (r) => <span className="text-sm">{r.note}</span> },
          ]}
        />
        {retestCursor && <Button size="sm" variant="ghost" disabled={loadingHistory} onClick={() => { void loadOlder() }}>{loadingHistory ? 'Loading…' : 'Load older retests'}</Button>}
      </div>
      <Card>
        <CardHeader title="Record retest" sub="A “Resolved” result closes the finding." />
        {reason && <div className="mb-3"><Locked reason={reason} /></div>}
        {err && <Banner tone="bad" title="The retest was not recorded">{err}</Banner>}
        <div className="space-y-4">
          <Field label="Result" required><Select value={result} onChange={(e) => setResult(e.target.value)} disabled={!!inputReason || saving}><option value="Resolved">Resolved</option><option value="Persists">Still present</option><option value="Partial">Partially resolved</option></Select></Field>
          <Field label="Notes" required error={tried && !note.trim() ? 'Enter notes about the retest.' : undefined}><Textarea value={note} onChange={(e) => setNote(e.target.value)} disabled={!!inputReason || saving} placeholder="Describe how you tested and what you observed" /></Field>
          {result === 'Resolved' && <fieldset disabled={!!inputReason || saving} className="space-y-2 rounded-lg border border-line p-3"><legend className="px-1 text-xs font-medium">Classified retained evidence (required to resolve)</legend>{resolutionEvidence.length === 0 ? <p className="text-xs text-muted">No readable classified captures are available. Upload and classify a capture in the Evidence tab; attaching it to the finding is not required for retest.</p> : resolutionEvidence.map((item) => <Check key={item.captureId} checked={captureIds.includes(item.captureId!)} onChange={(checked) => setCaptureIds((current) => checked ? [...new Set([...current, item.captureId!])] : current.filter((id) => id !== item.captureId))} label={`${item.name ?? item.ref} · ${item.classification}`} />)}</fieldset>}
          {evidence.isError && <p role="alert" className="text-xs text-bad">Retest capture inventory is unavailable. Reload before resolving.</p>}
          <div className="text-xs text-muted">Related operation: <Mono>{f.op || '—'}</Mono> · The server verifies evidence access and integrity before resolution.</div>
          <Button variant="primary" icon={RotateCcw} onClick={save} disabled={!!reason || saving} title={reason}>Record result</Button>
        </div>
      </Card>
    </div>
  )
}

/* ───────────── FI-V3-03: Evidence list + Inspector (ticket 33: typed reads) ───────────── */

/**
 * Standalone evidence list (ticket 33): the scoped rows, type options and
 * role-sensitive masking come from the typed findings service through Query
 * — every row renders its opaque reference, and a masked capture withholds
 * only its name (the reference stays visible). Missing/cross-project reads
 * are handler refusals rendered as errors, never content.
 */
function EvidenceList() {
  const pid = useProjectStore((s) => s.pid)
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('')
  const list = useEvidenceList({ q: q || undefined, kind: kind || undefined })
  const rows = list.data?.items ?? []
  return (
    <div>
      <PageHeader title="Evidence" sub={pid === 'all' ? 'Evidence across accessible projects (read-only).' : `Evidence recorded for ${pid}. Open an item to inspect metadata and chain of custody.`} />
      <FilterBar>
        <SearchBox value={q} onChange={setQ} placeholder="Search by ID, name or source…" className="w-full sm:w-72" />
        <Select aria-label="Type" value={kind} onChange={(e) => setKind(e.target.value)} className="!w-auto"><option value="">All types</option>{(list.data?.kinds ?? []).map((k) => <option key={k}>{k}</option>)}</Select>
      </FilterBar>
      {list.isPending ? (
        <div aria-busy="true" aria-label="Loading evidence"><Skeleton className="h-72" /></div>
      ) : list.isError ? (
        <Empty icon={AlertTriangle} title="Could not load evidence" action={<Button onClick={() => list.refetch()}>Retry</Button>}>
          {(list.error as EvidenceReadError).failure.message}
        </Empty>
      ) : (
        <Table
          rows={rows} rowKey={(e) => e.ref} onRow={(e) => go('evidence', { id: e.ref })}
          empty={<Empty icon={Paperclip} title="No evidence in this project yet" action={<Button onClick={() => go('operations')}>Open Operations</Button>}>Evidence is captured when operation steps produce output. Next: run an operation, or upload from a finding.</Empty>}
          cols={[
            { key: 'id', header: 'Evidence ID', render: (e) => <span className="whitespace-nowrap"><Mono className="text-accent">{e.ref}</Mono></span> },
            { key: 'n', header: 'Name', render: (e) => (e.masked ? <span className="text-warn">Sensitive file — redacted</span> : <span>{e.name}</span>) },
            { key: 'k', header: 'Type', render: (e) => <span className="whitespace-nowrap">{e.kind}</span> },
            { key: 's', header: 'Source event', hideBelow: 'md', render: (e) => <span className="whitespace-nowrap"><Mono>{e.source}</Mono></span> },
            { key: 'f', header: 'Finding', hideBelow: 'md', render: (e) => (e.findingId ? <span className="whitespace-nowrap"><Mono>{e.findingId}</Mono></span> : '—') },
            { key: 'r', header: 'Redaction', render: (e) => <span className="whitespace-nowrap text-xs">{e.sensitive ? <span className="text-warn">Redacted by default</span> : 'None needed'}</span> },
            { key: 'a', header: 'Captured', hideBelow: 'lg', render: (e) => <span className="whitespace-nowrap text-xs text-muted">{e.at}</span> },
          ]}
        />
      )}
    </div>
  )
}

/**
 * Standalone evidence inspector (ticket 33): both route aliases render this
 * typed read — metadata, producer links (resolved by the handler from real
 * record links, never parsed from the source string) and the simulated
 * capture integrity, which describes the retained capture and is never
 * proof of a finding. Masking and the display/download gates are handler
 * decisions, identical whichever screen linked the capture; a
 * missing/out-of-scope record reveals no content and a cross-project record
 * offers an explicit, access-checked switch.
 */
function EvidenceInspector() {
  const route = useRoute()
  const pid = useProjectStore((s) => s.pid)
  const setPid = useProjectStore((s) => s.setPid)
  const setSwitcherOpen = useUiStore((s) => s.setSwitcherOpen)
  const services = useServicesOrNull()
  const writes = useFindingWrites()
  const me = useMe()
  const toast = useToastStore((s) => s.toast)
  const confirm = useSessionStore((s) => s.confirm)
  const setFilter = useSessionStore((s) => s.setFilter)
  const can = useCan()
  const readOnly = useReadOnly()
  const nav = useDelayedNav()
  const [orig, setOrig] = useState(false)
  const [log, setLog] = useState<{ at: string; text: string }[]>([])
  const detail = useEvidenceDetail(route.id || undefined)
  const original = useEvidenceBytes(route.id ?? '', !!detail.data?.canViewOriginal && orig)
  useEffect(() => { setOrig(false); setLog([]) }, [route.id])
  if (!route.id) return <EvidenceList />
  if (detail.isError) {
    const err = (detail.error as EvidenceReadError).failure
    const other = err.kind === 'forbidden' ? err.entity?.projectId : undefined
    if (other) {
      return (
        <Empty icon={Lock} title={`Evidence ${route.id} belongs to another project`} action={<div className="flex gap-2"><Button variant="primary" onClick={() => { setPid(other); nav(() => go('evidence', { id: route.id }), 80) }}>Switch to {other}</Button><Button onClick={() => setSwitcherOpen(true)}>Select another project</Button></div>}>
          The selected project is {pid}. To avoid mixing data, content from {other} is not shown in this context.
        </Empty>
      )
    }
    return <Empty icon={AlertTriangle} title="Evidence not found" action={<Button onClick={() => go('evidence')}>Back to evidence</Button>}>ID {route.id} does not exist or is not available for your account.</Empty>
  }
  if (detail.isPending || !detail.data) {
    return <div aria-busy="true" aria-label="Loading evidence"><Skeleton className="h-72" /></div>
  }
  const data = detail.data
  const ev = data.evidence
  const producer = data.producer
  const real = isRealMode()
  const origWhy = real ? !ev.captureId ? (realControlGap('evidence.original') ?? 'Original bytes are unavailable for this legacy reference.') : !data.canViewOriginal ? (me.role === 'viewer' ? 'The viewer role cannot read original bytes.' : 'The capture is unclassified or its classification does not permit your role.') : '' : !ev.sensitive ? 'This item has no sensitive content — nothing is masked.' : !data.canViewSensitive ? `The ${ROLE_LABEL[me.role]} role cannot view sensitive content.` : !data.canViewOriginal ? `The ${ROLE_LABEL[me.role]} role can only view masked content. Ask a Reviewer, Operator or Manager.` : ''
  const masked = real ? !orig : ev.sensitive && !orig
  const isImg = real ? ev.mediaType?.startsWith('image/') === true : ev.kind.startsWith('Image')
  const ro = readOnly(ev.projectId)
  const createWhy = realControlGap('finding.evidenceLink') ?? (ro ? 'Project is read-only.' : !can('createFinding', ev.projectId) ? `The ${ROLE_LABEL[me.role]} role cannot create findings.` : '')
  const sample = ev.kind === 'JSON' ? '{\n  "role": "service-demo",\n  "permissions": ["read", "list"]\n}' : 'user=demo_account\ngroups=Users, Backup (simulated)\n[synthetic content — no real data]'
  /* The legacy raw `A.audit` entry, mirrored exactly: one 'legacy' commit
     through the one authority. */
  const audit = (action: string, obj: string, projectId: string, result = 'Success', reason = '') =>
    services && recordAudit(services, { actor: { id: me.name, role: me.role }, projectId, corr: 'legacy' }, { action, obj, result, reason })
  const toggle = () => {
    if (!orig) {
      confirm({ title: 'View original content?', confirmLabel: 'View original', body: real ? 'The server re-checks capture classification and role before returning original bytes. The browser verifies SHA-256 before display.' : 'Original (unmasked) content will be shown on screen. This access is recorded in the review log (simulated).', onConfirm: () => { setOrig(true); if (!real) { setLog((l) => [{ at: 'Just now (UTC+7)', text: `${me.name} viewed original content` }, ...l]); audit('Viewed original evidence', ev.ref, ev.projectId) } } })
    } else { setOrig(false); toast('Masked view restored.', 'info') }
  }
  const download = async () => {
    if (!real) { toast(`Download of ${ev.name} started (simulated).`, 'info'); return }
    const result = await writes.downloadEvidence(ev.captureId ?? ev.ref)
    if (!result.ok) { toast(result.failure.message, 'warn'); return }
    saveEvidenceFile(result.data)
  }
  const createFinding = () => {
    setFilter('finding-prefill', { projectId: ev.projectId, op: producer?.operation?.id, technique: producer?.step?.technique, asset: producer?.step?.asset, stepId: producer?.step?.id, evidence: [ev.ref], title: producer?.step ? `Finding from ${ev.ref}: ${producer.step.name}` : `Finding from ${ev.ref}`, desc: `Observed in ${ev.source}. Evidence ${ev.ref} (${ev.kind}) captured ${ev.at}.` })
    go('finding-new')
  }
  const chain = [
    { at: ev.at, title: `Captured by agent ${producer?.step?.agent || producer?.invocation?.producer || '—'}`, sub: `${ev.source} · collector ${producer?.agent ? producer.agent.host : (real ? '—' : 'operator upload')}`, tone: 'cyan' as const },
    ...(real ? [] : [{ at: ev.at, title: 'Hash computed and stored (simulated SHA-256)', sub: 'Integrity baseline — describes the retained capture, not the truth of any finding', tone: 'accent' as const }]),
    { at: ev.at, title: `Collected by ${ev.by}`, sub: 'Attached to the operation record', tone: 'accent' as const },
    ...data.findings.map((f) => ({ at: f.updated, title: `Linked to ${f.id}`, sub: 'Link cannot be removed from history', tone: 'ok' as const })),
  ]

  return (
    <div>
      <PageHeader
        back={{ label: 'Evidence', to: () => go('evidence') }}
        title={<span className="flex flex-wrap items-center gap-2"><Mono className="text-accent">{ev.ref}</Mono><span className="text-base font-medium">{ev.masked ? 'Sensitive file — redacted' : ev.name}</span></span>}
        meta={ev.sensitive ? <span className="inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full border border-warn/40 bg-warn/10 px-2.5 text-xs text-warn"><Lock size={12} aria-hidden />Sensitive</span> : undefined}
        sub={`Project ${ev.projectId} · captured ${ev.at}`}
        actions={<Button variant="primary" icon={Bug} disabled={!!createWhy} title={createWhy || 'Open the finding form prefilled from this evidence'} onClick={createFinding}>Create finding from evidence</Button>}
      />
      <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Content" sub={real ? undefined : 'Simulated preview — no real files or payloads.'} actions={
              <Button size="sm" icon={orig ? EyeOff : Eye} disabled={!!origWhy} title={origWhy || (orig ? 'Return to masked view' : 'Show original content')} onClick={toggle}>{orig ? 'Mask content' : 'View Original'}</Button>
            } />
            {origWhy && ev.sensitive && <div className="mb-3"><Locked reason={origWhy} /></div>}
            {masked ? (
              <div className="flex h-44 items-center justify-center rounded-lg border border-line bg-bg text-center text-muted" role="img" aria-label="Masked content"><div><Lock size={28} className="mx-auto mb-2 text-warn" aria-hidden /><div className="text-sm">Content masked by default</div><div className="text-xs">Redaction status: Redacted</div></div></div>
            ) : isImg && !real ? (
              <div className="flex h-44 items-center justify-center rounded-lg border border-line bg-bg text-muted" role="img" aria-label="Image preview (simulated)"><div className="text-center"><FileImage size={30} className="mx-auto mb-2" aria-hidden /><div className="text-xs">Synthetic image — {ev.name}</div></div></div>
            ) : (
              real ? <CaptureOriginalContent evidence={ev} open={orig} original={original} /> : <pre className="max-h-56 overflow-auto rounded-lg border border-line bg-bg p-3 font-mono text-xs leading-relaxed">{sample}</pre>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" icon={Download} disabled={real ? !data.canViewOriginal : !data.canViewSensitive || masked} title={real ? (origWhy || undefined) : !data.canViewSensitive ? 'Your role cannot download evidence.' : masked ? 'Download is available only for content you are permitted to view unmasked.' : undefined} onClick={() => void download()}>Download original</Button>
            </div>
          </Card>
          <Card>
            <CardHeader title="Chain of custody" />
            <Timeline items={chain} />
          </Card>
          <Card>
            <CardHeader title="Review log" />
            {log.length === 0 ? <div className="text-sm text-muted">No access to original content recorded in this session.</div> : <Timeline items={log.map((l) => ({ ...l, title: l.text, tone: 'warn' as const }))} />}
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Metadata" />
            <DescList cols={1} items={[
              { k: 'Evidence ID', v: <Mono>{ev.ref}</Mono> },
              { k: 'Source event', v: <Mono>{ev.source}</Mono> },
              { k: 'Operation', v: producer?.operation ? <button className="font-mono text-[13px] text-accent hover:underline" onClick={() => go('operation', { id: producer.operation!.id })}>{producer.operation.id}</button> : '—' },
              { k: 'Agent / Session', v: <span className="whitespace-nowrap">{producer?.agent ? <Mono>{producer.agent.id} · {producer.agent.host}</Mono> : '—'}{producer?.session && <> · <button className="font-mono text-[13px] text-accent hover:underline" onClick={() => go('c2-session', { id: producer.session!.id })}>{producer.session.id}</button></>}</span> },
              { k: 'Captured time', v: ev.at },
              { k: 'Collector', v: ev.by },
              { k: 'Content type', v: ev.kind },
              { k: 'Hash / integrity', v: real ? ev.captureId ? <span><Mono className="break-all text-xs">sha256:{original.data?.digest ?? ev.digest ?? '—'}</Mono><div className={`mt-1 text-xs ${original.data ? 'text-ok' : 'text-muted'}`}>{original.data ? 'Capture integrity verified' : 'Not checked until original bytes are read'}</div><div className="mt-1 text-xs text-muted">Integrity describes bytes, not the truth of a finding.</div></span> : <span className="text-muted">{realControlGap('evidence.integrity')}</span> : <span><Mono className="break-all text-xs">sha256:{data.integrity.digest?.slice(0, 24)}…</Mono><div className="mt-1 inline-flex items-center gap-1 text-xs text-ok"><Fingerprint size={12} aria-hidden />Integrity verified (simulated)</div><div className="mt-1 text-xs text-muted">Describes the retained capture — not proof that any finding is true.</div></span> },
              { k: 'Redaction status', v: !ev.sensitive ? 'None needed' : orig ? 'Redacted by default — original shown (logged)' : 'Redacted (masked)' },
            ]} />
          </Card>
          <Card>
            <CardHeader title="Linked records" />
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-2"><span className="text-muted">Operation step</span>{producer?.operation && producer?.step ? <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => go('operation', { id: producer.operation!.id, tab: 'console' })}>{producer.operation.id} / {producer.step.id}</Button> : '—'}</div>
              <div className="flex items-center justify-between gap-2"><span className="text-muted">Finding</span>{data.findings.length ? <span className="flex flex-wrap justify-end gap-1.5">{data.findings.map((f) => <Button key={f.id} size="sm" variant="ghost" icon={ExternalLink} onClick={() => go('finding', { id: f.id })}>{f.id}{f.status === 'ai_suggested' ? ' (AI, unverified)' : ''}</Button>)}</span> : <span className="text-muted">Not linked yet</span>}</div>
              <div className="flex items-center justify-between gap-2"><span className="text-muted">ATT&CK technique</span>{producer?.step ? <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => go('analysis', { id: producer.operation?.id, tab: 'matrix' })}>{producer.step.technique}</Button> : '—'}</div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- findings screen module: helper co-exported with screens
export const findingRoutes: Record<string, ComponentType> = { findings: FindingList, 'finding-new': FindingForm, finding: FindingDetail, evidence: EvidenceInspector, 'evidence-inspector': EvidenceInspector }
export { Segmented }
