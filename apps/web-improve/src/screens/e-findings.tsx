import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { AlertTriangle, Bug, Download, ExternalLink, FileImage, FilePlus2, FileText, Link2, Lock, Sparkles, Eye, EyeOff, Fingerprint, X, Search, Paperclip, Pencil, Plus, RotateCcw, Send, ShieldCheck, Upload } from 'lucide-react'
import { canAccessProject } from '../store'
import { useDirty } from '../state/session'
import { useServices } from '../state/services'
import { ROLE_LABEL } from '../auth/policy'
import { sevLabel, addFindingCommentTransaction } from '../features/findings/service'
import { setReportFindingsLegacyTransaction } from '../features/reports/service'
import { TECHNIQUES, type Finding, type FindingStatus, type Severity } from '../data'
import { EvidenceReadError, FindingReadError, useEvidenceDetail, useEvidenceList, useFindingDetail, useFindingList, useFindingWrites } from '../features/findings/query'
import type { EvidenceView, FindingSort, FindingTransitionTarget } from '../features/findings/service'
import {
  Banner, Button, Card, CardHeader, Check, DescList, Drawer, Empty, Field, FilterBar, Input, Kpi, Locked, Modal, Mono, PageHeader, Pager, Person, PersonaHint, SearchBox, Segmented, Select, Sev, Skeleton, Status, Table, Tabs, Textarea, Timeline, cx, useGuard,
} from '../ui'
import { go, useRoute } from '../router/navigate'
import { useAccessible, useActiveProject, useCan, useDb, useMe, useReadOnly } from '../state/console'
import { useProjectStore, useToastStore, useUiStore } from '../state/stores'
import { useSessionStore } from '../state/session'
import { stamp } from '../domain/demo-clock'

const SEVS: Severity[] = ['critical', 'high', 'medium', 'low', 'info']
const STATUSES: FindingStatus[] = ['draft', 'review', 'returned', 'confirmed', 'remediation', 'retest', 'resolved']
const STATUS_LABEL: Record<string, string> = { ai_suggested: 'AI Suggested — unverified', draft: 'Draft', review: 'In Review', returned: 'Returned', confirmed: 'Confirmed', remediation: 'In Remediation', retest: 'Retest', resolved: 'Resolved' }
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
  useEffect(() => () => { alive.current = false }, [])
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
  const services = useServices()
  const me = useMe()
  const confirm = useSessionStore((s) => s.confirm)
  const toast = useToastStore((s) => s.toast)
  const can = useCan()
  const readOnly = useReadOnly()
  const persistFilters = useSessionStore((s) => s.persistFilters)
  const setFilter = useSessionStore((s) => s.setFilter)
  const writes = useFindingWrites()
  /* The legacy raw `A.audit` entry, mirrored exactly: one 'legacy' commit
     through the one authority (the typed dismiss path has no audit row). */
  const audit = (action: string, obj: string, projectId: string, result = 'Success', reason = '') =>
    services.authority.commit('legacy', (d) => { d.audit.unshift({ corr: projectId === 'RT-2026-014' && /^(SS|AR)-/.test(obj) ? 'COR-014-01' : undefined, id: 'AU-' + ++d.counters.audit, at: stamp(), actor: me.name, role: ROLE_LABEL[me.role], action, obj, projectId, result, reason }) })
  const dismissed: Record<string, string> = (persistFilters['fd-dismissed'] as Record<string, string> | undefined) || {}
  const why = (f: Finding) => (readOnly(f.projectId) ? 'Project is read-only.' : !can('createFinding', f.projectId) ? `The ${ROLE_LABEL[me.role]} role cannot verify or dismiss AI suggestions. An Analyst or Operator can.` : '')
  const verify = (f: Finding) => confirm({
    title: `Verify & import ${f.id} as a draft?`, confirmLabel: 'Verify & create finding',
    body: 'You confirm you reviewed the source step and evidence. The suggestion becomes a draft finding for you to curate — it enters review only after you submit it, and a Reviewer must still confirm it before it counts in reports.',
    onConfirm: async () => {
      const res = await writes.importSuggestion(f.id)
      if (res.ok) { toast(`${f.id} imported as a draft finding.`); go('finding', { id: f.id }) }
      else toast(res.failure.message, 'warn')
    },
  })
  const dismiss = (f: Finding) => confirm({
    title: `Dismiss ${f.id}?`, confirmLabel: 'Dismiss suggestion', danger: true, reasonLabel: 'Reason for dismissing', reasonRequired: true,
    body: 'The suggestion is removed from the active AI Suggestions list. It is never added to confirmed counts or reports. The reason is recorded.',
    onConfirm: (r) => { setFilter('fd-dismissed', { ...dismissed, [f.id]: r }); addFindingCommentTransaction(services.authority, { actor: { id: me.name, role: me.role }, projectId: f.projectId, corr: 'legacy' }, f.id, `AI suggestion dismissed: ${r}`); audit('Dismissed AI suggestion', f.id, f.projectId, 'Success', r); toast(`${f.id} dismissed.`, 'warn') },
  })
  return { dismissed, why, verify, dismiss, restore: (f: Finding) => { const d = { ...dismissed }; delete d[f.id]; setFilter('fd-dismissed', d) } }
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
 * dismissal is a session-local overlay passed into the read. Creation and
 * the detail form still use the bridged legacy routes (owner: ticket 32).
 */
function FindingList() {
  const route = useRoute()
  const pid = useProjectStore((s) => s.pid)
  const project = useActiveProject()
  const setSwitcherOpen = useUiStore((s) => s.setSwitcherOpen)
  const accessible = useAccessible()
  const ai = useAiActions()
  const [q, setQ] = useState('')
  const [sev, setSev] = useState('')
  const [tab, setTab] = useState(route.tab && TABS.some((t) => t.id === route.tab) ? route.tab : 'all')
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
      <PageHeader
        title="Findings"
        sub={pid === 'all' ? 'All findings across the projects you can access (read-only aggregate). Creating one requires a specific project.' : `Findings for ${project?.id} — ${project?.name}. KPIs count verified findings only.`}
        actions={<Button variant="primary" icon={Plus} disabled={!!reason} title={reason || 'Create a new finding'} onClick={() => go('finding-new')}>Create Finding</Button>}
      />
      {pid === 'all' && (
        <Banner tone="info" title="Viewing an aggregate of multiple projects" action={<Button size="sm" onClick={() => setSwitcherOpen(true)}>Select project</Button>}>
          Findings are never silently moved to another project. Select a project to create a new one. ({accessible.length} accessible projects)
        </Banner>
      )}
      {pid !== 'all' && reason && <div className="-mt-3 mb-4 flex justify-end"><Locked reason={reason} /></div>}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        {SEVS.map((s) => <Kpi key={s} label={sevLabel[s]} value={data?.severity[s] ?? 0} tone={s === 'critical' || s === 'high' ? 'bad' : s === 'medium' ? 'warn' : s === 'low' ? 'cyan' : 'neutral'} onClick={() => setSev(sev === s ? '' : s)} />)}
        <Kpi label="Awaiting Review" value={data?.awaitingReview ?? 0} tone="warn" onClick={() => setTab('review')} />
        <Kpi label="Resolved" value={data?.resolved ?? 0} tone="ok" onClick={() => setTab('remediation')} />
        <Kpi label="AI Suggestions" value={data?.counts.ai ?? 0} sub="unverified — not in counts" tone="warn" onClick={() => setTab('ai')} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={TABS.map((t) => ({ id: t.id, label: t.label, count: data?.counts[t.id as keyof typeof data.counts] ?? 0 }))} />
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
          {dismissed.length > 0 && <label className="flex cursor-pointer items-center gap-2 text-xs text-muted"><input type="checkbox" className="accent-[var(--c-accent)]" checked={showDis} onChange={(e) => setShowDis(e.target.checked)} />Show dismissed suggestions ({dismissed.length})</label>}
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
              { key: 't', header: 'Title', render: (it) => <div className="max-w-[300px] truncate font-medium" title={it.finding.title}>{it.finding.title}</div> },
              { key: 'p', header: 'Project', hideBelow: 'md', render: (it) => <div className="whitespace-nowrap"><Mono>{it.finding.projectId}</Mono><div className="text-xs text-muted">{it.projectClient}</div></div> },
              { key: 'sev', header: 'Severity', render: (it) => <span className="whitespace-nowrap"><Sev v={it.finding.severity} /></span> },
              { key: 'a', header: 'Affected asset', hideBelow: 'lg', render: (it) => <span className="whitespace-nowrap"><Mono>{it.finding.asset}</Mono></span> },
              { key: 'op', header: 'Operation', hideBelow: 'lg', render: (it) => <span className="whitespace-nowrap"><Mono>{it.finding.op}</Mono></span> },
              { key: 'o', header: 'Owner', hideBelow: 'md', render: (it) => <span className="whitespace-nowrap">{it.finding.owner}</span> },
              { key: 's', header: 'Status', render: (it) => <span className="whitespace-nowrap"><Status kind="finding" value={it.finding.status} />{ai.dismissed[it.finding.id] && <span className="ml-1.5 text-xs text-muted">dismissed</span>}</span> },
              { key: 'u', header: 'Updated', hideBelow: 'lg', render: (it) => <span className="whitespace-nowrap text-xs text-muted">{it.finding.updated}</span> },
              ...(tab === 'ai' ? [{ key: 'act', header: 'Actions', render: (it: { finding: Finding }) => {
                const f = it.finding
                const w = ai.why(f)
                return ai.dismissed[f.id] ? <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); ai.restore(f) }}>Restore</Button> : (
                  <div className="flex gap-1.5 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="primary" disabled={!!w} title={w || 'Verify the suggestion and create a finding in review'} onClick={() => ai.verify(f)}>Verify & create finding</Button>
                    <Button size="sm" disabled={!!w} title={w || 'Dismiss with a reason'} onClick={() => ai.dismiss(f)}>Dismiss</Button>
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
interface Draft { title: string; severity: Severity; severityReason: string; asset: string; op: string; technique: string; desc: string; scopeNote: string; impact: string; rec: string; evidence: string[]; owner: string; kind: string; stepId?: string }

/**
 * Finding create/edit form (ticket 32): validation, dirty tracking and the
 * save/submit write run on the typed findings service — one atomic commit
 * per user-visible save (content, evidence links, severity rationale and
 * the optional submit). A refused save commits nothing and leaves the draft
 * in the form with the failure message rendered above it.
 */
function FindingForm() {
  const route = useRoute()
  const db = useDb()
  const me = useMe()
  const pid = useProjectStore((s) => s.pid)
  const toast = useToastStore((s) => s.toast)
  const persistFilters = useSessionStore((s) => s.persistFilters)
  const setFilter = useSessionStore((s) => s.setFilter)
  const setSwitcherOpen = useUiStore((s) => s.setSwitcherOpen)
  const can = useCan()
  const nav = useDelayedNav()
  const writes = useFindingWrites()
  const editing = route.id ? db.findings.find((f) => f.id === route.id) : undefined
  const projectId = editing?.projectId || (pid !== 'all' ? pid : '')
  const createReason = useCreateReason(projectId || undefined)
  const guard = useGuard(projectId || undefined)
  const prefill = useMemo(() => persistFilters['finding-prefill'] as { projectId: string; op?: string; technique?: string; asset?: string; title?: string; severity?: string; desc?: string; stepId?: string; evidence?: string[] } | undefined, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (persistFilters['finding-prefill']) setFilter('finding-prefill', null) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const pf = !editing && prefill && prefill.projectId === projectId ? prefill : undefined
  const project = db.projects.find((p) => p.id === projectId)
  const members = project?.members.filter((m) => m.role !== 'viewer').map((m) => m.user) || []

  const init: Draft = useMemo(() => editing
    ? { title: editing.title, severity: editing.severity, severityReason: '', asset: editing.asset, op: editing.op, technique: editing.technique, desc: editing.desc, scopeNote: '', impact: editing.impact, rec: editing.rec, evidence: [...editing.evidence], owner: editing.owner, kind: 'Configuration / access control' }
    : { title: pf?.title || '', severity: (pf?.severity as Severity) || 'medium', severityReason: '', asset: pf?.asset || '', op: pf?.op || '', technique: pf?.technique || '', desc: pf?.desc || '', scopeNote: '', impact: '', rec: '', evidence: (pf?.evidence || []).filter((id) => db.evidence.some((e) => e.id === id && e.projectId === projectId)), owner: members.includes(me.name) ? me.name : members[0] || me.name, kind: 'Configuration / access control', stepId: pf?.stepId }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  , [])
  const [d, setD] = useState<Draft>(init)
  const [tried, setTried] = useState(false)
  const [saved, setSaved] = useState(false)
  const [preview, setPreview] = useState(false)
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }))
  const dirty = !saved && JSON.stringify(d) !== JSON.stringify(init)

  const assets = db.assets.filter((a) => a.projectId === projectId)
  const ops = db.operations.filter((o) => o.projectId === projectId)
  const evs = db.evidence.filter((e) => e.projectId === projectId)
  const locked = !!createReason || (!!editing && !['draft', 'returned'].includes(editing.status))
  const err: Record<string, string> = {}
  if (d.title.trim().length < 5) err.title = 'Enter a finding title (at least 5 characters).'
  if (!d.asset) err.asset = 'Select the affected asset.'
  if (!d.desc.trim()) err.desc = 'Enter a description.'
  if (!d.impact.trim()) err.impact = 'Enter the impact.'
  if (!d.rec.trim()) err.rec = 'Enter a recommendation.'
  if (d.severity === 'critical' && !d.severityReason.trim()) err.severityReason = 'Critical severity requires a rationale.'
  const noEvidence = d.evidence.length === 0
  const submitReason = noEvidence ? 'At least 1 piece of evidence is required to submit for review (you can save a draft first).' : ''

  const draftPayload = () => ({ title: d.title.trim(), severity: d.severity, severityReason: d.severityReason.trim() || undefined, owner: d.owner, kind: d.kind, desc: d.desc, scopeNote: d.scopeNote, asset: d.asset, impact: d.impact, rec: d.rec, technique: d.technique, op: d.op, stepId: d.stepId, evidence: d.evidence })
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
    const res = await writes.save(editing?.id ?? null, { ...draftPayload(), submit })
    setSaving(false)
    if (!res.ok) { setSaveErr(res.failure.message); return null }
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

  if (editing && !canAccessProject(db, me, editing.projectId)) return <Empty icon={Lock} title="You do not have permission to edit this finding" action={<Button onClick={() => go('findings')}>Back to list</Button>} />
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
        : locked ? <Banner tone="warn" title="Finding is no longer editable">Only drafts or returned findings can be edited. Current status: {STATUS_LABEL[editing!.status]}.</Banner>
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
            <Field label={d.severity === 'critical' ? 'Rationale for Critical severity' : 'Severity rationale (optional)'} required={d.severity === 'critical'} error={E('severityReason')} className="md:col-span-2" hint="The rationale is saved as a comment in the finding history.">
              <Textarea value={d.severityReason} onChange={(e) => set('severityReason', e.target.value)} className="min-h-16" placeholder="Explain the basis for the severity rating" />
            </Field>
          </div>
        </Card>
        <Card>
          <CardHeader title="Analysis" />
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Affected asset" required error={E('asset')} hint={`${assets.length} assets in ${projectId}`}>
              <Select value={d.asset} onChange={(e) => set('asset', e.target.value)}><option value="">— Select an asset —</option>{assets.map((a) => <option key={a.id} value={a.name}>{a.name} ({a.id})</option>)}</Select>
            </Field>
            <Field label="Related operation" hint="Only operations in this project.">
              <Select value={d.op} onChange={(e) => set('op', e.target.value)}><option value="">— No linked operation —</option>{ops.map((o) => <option key={o.id} value={o.id}>{o.id} — {o.name}</option>)}</Select>
            </Field>
            <Field label="ATT&CK technique (if applicable)">
              <Select value={d.technique} onChange={(e) => set('technique', e.target.value)}><option value="">— Not applicable —</option>{TECHNIQUES.map((t) => <option key={t.id} value={t.id}>{t.id} — {t.name}</option>)}</Select>
            </Field>
            <Field label="Conditions / scope of impact"><Input value={d.scopeNote} onChange={(e) => set('scopeNote', e.target.value)} placeholder="Example: applies only to demo accounts in the lab" /></Field>
            <Field label="Description" required error={E('desc')} className="md:col-span-2"><Textarea value={d.desc} onChange={(e) => set('desc', e.target.value)} /></Field>
            <Field label="Impact" required error={E('impact')}><Textarea value={d.impact} onChange={(e) => set('impact', e.target.value)} /></Field>
            <Field label="Recommendation" required error={E('rec')}><Textarea value={d.rec} onChange={(e) => set('rec', e.target.value)} /></Field>
          </div>
        </Card>
        <Card>
          <CardHeader title="Evidence" sub={`Only evidence from ${projectId} is listed. You can upload more files in the Evidence tab after saving.`} />
          {evs.length === 0 ? <div className="text-sm text-muted">This project has no evidence yet. Save a draft, then upload from the detail page.</div> : (
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
        <Button onClick={saveDraft} disabled={locked || saving} title={locked ? createReason || 'Cannot edit in the current status.' : ''}>Save Draft</Button>
        <Button variant="primary" icon={Send} onClick={submit} disabled={locked || saving || !!submitReason} title={locked ? createReason || 'Cannot edit in the current status.' : submitReason}>Submit for Review</Button>
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
  const can = useCan()
  const readOnly = useReadOnly()
  const me = useMe()
  const services = useServices()
  const confirm = useSessionStore((s) => s.confirm)
  const toast = useToastStore((s) => s.toast)
  const db = useDb()
  const writes = useFindingWrites()
  const detail = useFindingDetail(route.id)
  const [note, setNote] = useState('')
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
  const proj = data.project
  const op = data.operation
  const step = data.step
  const noEv = f.evidence.length === 0
  const roReason = me.role === 'viewer' ? 'The Client / Viewer role is read-only.' : 'Project is closed — read-only.'
  const returnedNote = f.status === 'returned' ? [...f.comments].reverse()[0] : undefined
  const reports = db.reports.filter((r) => r.projectId === f.projectId && ['draft', 'returned'].includes(r.status))
  const inReport = data.inReports
  const reportReason = f.status === 'ai_suggested' ? 'AI suggestions are unverified and cannot be included in a report. Verify the finding first.' : ro ? roReason : !can('editReport', f.projectId) ? `The ${ROLE_LABEL[me.role]} role cannot edit reports.` : ['draft', 'review', 'returned'].includes(f.status) ? 'Only confirmed findings can be added to a report.' : ''

  const lastDecision = [...f.history].reverse().find((h) => /Confirmed|Returned/.test(h.text))
  /** One lifecycle move through the typed handler; the handler is the
   *  enforcer — a refusal (role, state, read-only) surfaces its reason. */
  const runTransition = async (to: FindingTransitionTarget, msg: string, opts?: { note?: string; warn?: boolean }) => {
    const res = await writes.transition(f.id, to, opts?.note)
    if (res.ok) toast(msg, opts?.warn ? 'warn' : 'ok')
    else toast(res.failure.message, 'warn')
  }
  const doSubmit = () => { void runTransition('review', `${f.id} submitted for review.`) }
  const approve = () => confirm({ title: `Confirm ${f.id}?`, body: 'The finding will move to "Confirmed" and can be added to reports. This action is written to the audit log.', confirmLabel: 'Confirm Finding', onConfirm: () => { void runTransition('confirmed', `${f.id} was confirmed.`) } })
  const sendBack = () => confirm({ title: `Return ${f.id} for changes`, body: 'The author will be notified with your reason so they can make changes.', confirmLabel: 'Return for Changes', danger: true, reasonLabel: 'Reason for returning', reasonRequired: true, onConfirm: (r) => { void runTransition('returned', `${f.id} returned to the author.`, { note: r, warn: true }) } })

  const actions: ReactNode[] = []
  if (['draft', 'returned'].includes(f.status)) {
    actions.push(
      <Button key="e" icon={Pencil} disabled={ro || !author} title={ro ? roReason : !author ? `The ${ROLE_LABEL[me.role]} role cannot edit.` : ''} onClick={() => go('finding-new', { id: f.id })}>Edit Draft</Button>,
      <Button key="s" variant="primary" icon={Send} disabled={ro || !author || noEv} title={ro ? roReason : !author ? 'You do not have permission to submit for review.' : noEv ? 'At least 1 piece of evidence is required to submit for review — add it in the Evidence tab.' : ''} onClick={doSubmit}>Submit for Review</Button>,
    )
  }
  if (f.status === 'ai_suggested') {
    const w = ai.why(f)
    actions.push(
      <Button key="d" disabled={!!w || !!ai.dismissed[f.id]} title={w || 'Dismiss with a reason'} onClick={() => ai.dismiss(f)}>Dismiss</Button>,
      <Button key="v" variant="primary" icon={ShieldCheck} disabled={!!w} title={w || 'Verify the suggestion and create a finding in review'} onClick={() => ai.verify(f)}>Verify & create finding</Button>,
    )
  }
  if (f.status === 'review') {
    actions.push(
      <Button key="r" variant="danger" icon={RotateCcw} disabled={ro || !reviewer} title={ro ? roReason : !reviewer ? 'Only a Reviewer or Manager can return findings.' : ''} onClick={sendBack}>Return for Changes</Button>,
      <Button key="c" variant="primary" icon={ShieldCheck} disabled={ro || !reviewer} title={ro ? roReason : !reviewer ? 'Only a Reviewer or Manager can confirm findings.' : ''} onClick={approve}>Confirm Finding</Button>,
    )
  }
  if (f.status === 'confirmed') actions.push(<Button key="rm" variant="primary" disabled={ro || !(reviewer || author)} title={ro ? roReason : ''} onClick={() => confirm({ title: 'Move to remediation?', body: 'Marks the finding as being remediated by the asset owner.', confirmLabel: 'Move to Remediation', onConfirm: () => { void runTransition('remediation', `${f.id} moved to In Remediation.`) } })}>Send to Remediation</Button>)
  if (f.status === 'remediation') actions.push(<Button key="rt" variant="primary" icon={RotateCcw} disabled={ro || !(reviewer || author)} title={ro ? roReason : ''} onClick={() => { void runTransition('retest', `${f.id} is awaiting retest.`) }}>Request Retest</Button>)
  if (f.status === 'retest') actions.push(<Button key="gt" variant="primary" icon={RotateCcw} onClick={() => go('finding', { id: f.id, tab: 'retest' })}>Record Retest</Button>)
  actions.push(
    <Button key="rep" icon={FilePlus2} disabled={!!reportReason} title={reportReason || 'Add this finding to a report in the same project'} onClick={() => setRep(true)}>Add to Report</Button>,
  )

  const postComment = () => { if (!note.trim()) return; addFindingCommentTransaction(services.authority, { actor: { id: me.name, role: me.role }, projectId: f.projectId, corr: 'legacy' }, f.id, note.trim()); setNote(''); toast('Comment posted.') }

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
          <span className="whitespace-pre-wrap">{returnedNote.text}</span>
        </Banner>
      )}
      {f.status === 'ai_suggested' && (
        <Banner tone="warn" icon={Sparkles} title="AI Suggested — unverified">
          Proposed by the AI Operator. Not a finding yet: excluded from confirmed counts, severity charts and reports. {ai.dismissed[f.id] ? `Dismissed: ${ai.dismissed[f.id]}` : 'Verify it against the source step and evidence, or dismiss it with a reason.'}
        </Banner>
      )}
      {f.status === 'review' && !reviewer && !ro && <PersonaHint need="Reviewer" persona="Pat Kim">This finding is awaiting review. Switch to the Reviewer role to Confirm or Return it.</PersonaHint>}
      {['draft', 'returned'].includes(f.status) && !author && !ro && me.role !== 'viewer' && <PersonaHint need="Operator" persona="Taylor Chen">Editing and submitting for review require the Operator or Manager role.</PersonaHint>}
      <Tabs
        value={tab} onChange={(t) => go('finding', { id: f.id, tab: t })}
        tabs={[{ id: 'overview', label: 'Summary & workflow' }, { id: 'evidence', label: 'Evidence', count: f.evidence.length }, { id: 'retest', label: 'Retest', count: f.retests.length }]}
      />
      {tab === 'evidence' ? <EvidenceTab f={f} evs={data.evidence} ro={ro} /> : tab === 'retest' ? <RetestTab f={f} ro={ro} roReason={roReason} /> : (
        <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
          <div className="space-y-6">
            <Card>
              <CardHeader title="Analysis & impact" />
              <div className="space-y-4 text-sm">
                <div><div className="mb-1 text-xs text-muted">Description</div><p className="leading-relaxed">{f.desc}</p></div>
                <div><div className="mb-1 text-xs text-muted">Technical observations</div><p className="leading-relaxed">{step ? `${step.id} (${step.technique}) on ${step.asset}: ${step.output}` : 'No linked step observation.'}</p></div>
                <div><div className="mb-1 text-xs text-muted">Impact</div><p className="leading-relaxed">{f.impact}</p></div>
                <div><div className="mb-1 text-xs text-muted">Recommendations</div><p className="leading-relaxed">{f.rec}</p></div>
              </div>
            </Card>
            <Card>
              <CardHeader title="Links" />
              <DescList cols={2} items={[
                { k: 'Affected asset', v: data.assetId ? <button className="font-mono text-[13px] text-accent hover:underline" onClick={() => go('asset', { id: data.assetId })}>{f.asset} <ExternalLink size={11} className="inline" /></button> : <Mono>{f.asset}</Mono> },
                { k: 'Evidence', v: f.evidence.length ? f.evidence.map((id) => <button key={id} className="mr-2 whitespace-nowrap font-mono text-[13px] text-accent hover:underline" onClick={() => go('evidence', { id })}>{id}</button>) : <span className="text-muted">None linked</span> },
                { k: 'Operation step', v: op && step ? <button className="whitespace-nowrap font-mono text-[13px] text-accent hover:underline" onClick={() => go('operation', { id: op.id, tab: 'console' })}>{op.id} / {step.id} — {step.name}</button> : '—' },
                { k: 'Confidence', v: f.status === 'ai_suggested' ? 'Low — AI inference, needs verification' : f.evidence.length ? 'Supported by linked evidence — a recorded claim, not proven exploitability' : 'Low — no evidence linked' },
                { k: 'Reviewer decision', v: f.status === 'ai_suggested' ? 'Not submitted' : lastDecision ? `${lastDecision.text} by ${lastDecision.by}` : 'Pending' },
                { k: 'Operation', v: op ? <button className="font-mono text-[13px] text-accent hover:underline" onClick={() => go('operation', { id: op.id })}>{op.id} — {op.name}</button> : f.op || '—' },
                { k: 'ATT&CK technique', v: data.techniqueName ? <button className="text-left text-accent hover:underline" onClick={() => go('technique', { id: f.technique })}><Mono>{f.technique}</Mono> — {data.techniqueName}</button> : f.technique || 'Not applicable' },
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
              <CardHeader title="Reviewer comments" sub={`${f.comments.length} comment(s)`} />
              {f.comments.length === 0 ? <div className="mb-4 text-sm text-muted">No comments yet.</div> : (
                <ul className="mb-4 space-y-3">
                  {f.comments.map((c, i) => (
                    <li key={i} className={cx('rounded-lg border p-3', f.status === 'returned' && i === f.comments.length - 1 ? 'border-bad/40 bg-bad/5' : 'border-line')}>
                      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted"><Person name={c.by} /><span className="font-mono">{c.at}</span></div>
                      <div className="whitespace-pre-wrap text-sm">{c.text}</div>
                    </li>
                  ))}
                </ul>
              )}
              <Textarea aria-label="Comment" value={note} onChange={(e) => setNote(e.target.value)} disabled={ro} placeholder={ro ? roReason : 'Write a comment for the reviewer / owner…'} className="min-h-20" />
              <div className="mt-2 flex justify-end"><Button onClick={postComment} disabled={ro || !note.trim()} title={ro ? roReason : !note.trim() ? 'Enter a comment.' : ''}>Post comment</Button></div>
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
              {f.history.length === 0 ? <div className="text-sm text-muted">No history recorded.</div> : (
                <Timeline items={[...f.history].reverse().map((h) => ({ at: h.at, title: h.text, sub: h.by, tone: /Returned/.test(h.text) ? 'bad' : /Confirmed|Resolved|resolved/.test(h.text) ? 'ok' : /review/i.test(h.text) ? 'warn' : 'accent' }))} />
              )}
            </Card>
          </div>
        </div>
      )}
      <AddToReport open={rep} onClose={() => setRep(false)} f={f} reports={reports} />
    </div>
  )
}

function AddToReport({ open, onClose, f, reports }: { open: boolean; onClose: () => void; f: Finding; reports: { id: string; title: string; version: string; status: string; findings: string[] }[] }) {
  const services = useServices()
  const me = useMe()
  const toast = useToastStore((s) => s.toast)
  const setFilter = useSessionStore((s) => s.setFilter)
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
                <Button size="sm" variant="primary" onClick={() => { if (!has) setReportFindingsLegacyTransaction(services.authority, { actor: { id: me.name, role: me.role }, projectId: f.projectId, corr: 'legacy' }, r.id, [...r.findings, f.id]); toast(has ? `${f.id} is already in ${r.id}.` : `Added ${f.id} to ${r.id}.`); onClose(); go('report', { id: r.id }) }}>{has ? 'Open report' : 'Add'}</Button>
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
function EvidenceTab({ f, evs, ro }: { f: Finding; evs: EvidenceView[]; ro: boolean }) {
  const db = useDb()
  const can = useCan()
  const toast = useToastStore((s) => s.toast)
  const me = useMe()
  const writes = useFindingWrites()
  const [view, setView] = useState<EvidenceView | null>(null)
  const [attach, setAttach] = useState(false)
  const [up, setUp] = useState(false)
  const canAdd = !ro && can('createFinding', f.projectId)
  const why = ro ? (me.role === 'viewer' ? 'The Client / Viewer role is read-only.' : 'Project is closed — read-only.') : !canAdd ? `The ${ROLE_LABEL[me.role]} role cannot add evidence.` : ''
  const candidates = db.evidence.filter((e) => e.projectId === f.projectId && !f.evidence.includes(e.id))
  const link = async (evidenceId: string) => {
    const res = await writes.attachEvidence(f.id, evidenceId)
    if (res.ok) toast(`Linked ${evidenceId} to ${f.id}.`)
    else toast(res.failure.message, 'warn')
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto text-sm text-muted">{evs.length} evidence item(s) — links are opaque references to retained captures; a linked claim still needs reviewer verification and is never proof of exploitability by itself. Evidence cannot be removed from history; every link is logged.</span>
        <Button icon={Link2} disabled={!canAdd} title={why} onClick={() => setAttach(true)}>Link Evidence</Button>
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
          { key: 'l', header: 'Label', render: (e) => (e.sensitive ? <span className="inline-flex items-center gap-1 text-xs text-warn"><Lock size={12} aria-hidden />Sensitive</span> : <span className="text-xs text-muted">Standard</span>) },
        ]}
      />
      <Drawer open={!!view} onClose={() => setView(null)} title={view ? <span><Mono className="text-accent">{view.ref}</Mono> · <MaskedName ev={view} /></span> : ''}
        footer={view && <><Button icon={Eye} onClick={() => go('evidence', { id: view.ref })}>Open in Evidence Inspector</Button><Button icon={Download} disabled={view.masked} title={view.masked ? 'Sensitive file — your role cannot download it.' : ''} onClick={() => toast(`Download of ${view.name} started (simulated).`, 'info')}>Download</Button></>}>
        {view && <EvidencePreview ev={view} f={f} onOp={() => view.opId && go('operation', { id: view.opId })} />}
      </Drawer>
      <Modal open={attach} onClose={() => setAttach(false)} title="Link existing evidence" footer={<Button onClick={() => setAttach(false)}>Done</Button>}>
        {candidates.length === 0 ? <div className="text-sm text-muted">No more evidence from {f.projectId} is available to link. Upload a new file.</div> : (
          <ul className="space-y-2">
            {candidates.map((e) => {
              const other = !!e.findingId && e.findingId !== f.id
              const hide = e.sensitive && !can('viewSensitive')
              return (
                <li key={e.id} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5">
                  <div className="min-w-0 flex-1"><div className="truncate text-sm"><Mono className="text-accent">{e.id}</Mono> {hide ? 'Sensitive file' : e.name}</div><div className="text-xs text-muted">{e.kind} · {e.source}{other ? ` · linked to ${e.findingId}` : ''}</div></div>
                  <Button size="sm" disabled={other || hide} title={other ? `Already linked to ${e.findingId}` : hide ? 'Outside your permission scope' : ''} onClick={() => { void link(e.id) }}>Link</Button>
                </li>
              )
            })}
          </ul>
        )}
      </Modal>
      <UploadModal open={up} onClose={() => setUp(false)} f={f} />
    </div>
  )
}

function UploadModal({ open, onClose, f }: { open: boolean; onClose: () => void; f: Finding }) {
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
    setName(''); setTried(false); setSens(false); setErr(null); onClose()
  }
  return (
    <Modal open={open} onClose={onClose} title="Upload evidence (simulated)" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon={Upload} onClick={save}>Upload & link</Button></>}>
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

function EvidencePreview({ ev, f, onOp }: { ev: EvidenceView; f: Finding; onOp: () => void }) {
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
  const toast = useToastStore((s) => s.toast)
  const can = useCan()
  const me = useMe()
  const writes = useFindingWrites()
  const [result, setResult] = useState('Resolved')
  const [note, setNote] = useState('')
  const [tried, setTried] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const stageOk = ['confirmed', 'remediation', 'retest', 'resolved'].includes(f.status)
  const roleOk = can('createFinding', f.projectId) || can('reviewFinding', f.projectId)
  const reason = ro ? roReason : !roleOk ? `The ${ROLE_LABEL[me.role]} role cannot record retests.` : !stageOk ? 'Retest is only available after the finding has been confirmed.' : ''
  const save = async () => {
    setTried(true)
    if (!note.trim()) return
    const res = await writes.recordRetest(f.id, { result, note: note.trim() })
    if (!res.ok) { setErr(res.failure.message); return }
    toast(result === 'Resolved' ? `${f.id} was marked Resolved.` : 'Retest result recorded.', result === 'Resolved' ? 'ok' : 'warn')
    setNote(''); setTried(false); setErr(null)
  }
  return (
    <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
      <div>
        <div className="mb-3 text-sm font-semibold">Retest history</div>
        <Table
          rows={[...f.retests].reverse()} rowKey={(r) => r.at + r.by + r.note}
          empty={<Empty icon={RotateCcw} title="No retests yet">Current state: <b>Undetermined</b>. Record a result after the owner remediates.</Empty>}
          cols={[
            { key: 'at', header: 'Date', render: (r) => <span className="text-xs">{r.at}</span> },
            { key: 'by', header: 'Tester', render: (r) => r.by },
            { key: 'op', header: 'Source operation', hideBelow: 'md', render: () => <Mono>{f.op || '—'}</Mono> },
            { key: 'res', header: 'Result', render: (r) => { const m = RETEST_STATE[r.result] || { label: r.result, tone: 'neutral' as const }; return <Status kind="generic" value={m.tone} label={m.label} size="sm" /> } },
            { key: 'note', header: 'Notes', render: (r) => <span className="text-sm">{r.note}</span> },
          ]}
        />
      </div>
      <Card>
        <CardHeader title="Record retest" sub="A “Resolved” result closes the finding." />
        {reason && <div className="mb-3"><Locked reason={reason} /></div>}
        {err && <Banner tone="bad" title="The retest was not recorded">{err}</Banner>}
        <div className="space-y-4">
          <Field label="Result" required><Select value={result} onChange={(e) => setResult(e.target.value)} disabled={!!reason}><option value="Resolved">Resolved</option><option value="Persists">Still present</option><option value="Partial">Partially resolved</option></Select></Field>
          <Field label="Notes" required error={tried && !note.trim() ? 'Enter notes about the retest.' : undefined}><Textarea value={note} onChange={(e) => setNote(e.target.value)} disabled={!!reason} placeholder="Describe how you tested and what you observed" /></Field>
          <div className="text-xs text-muted">Related operation: <Mono>{f.op || '—'}</Mono> · New evidence can be linked in the Evidence tab.</div>
          <Button variant="primary" icon={RotateCcw} onClick={save} disabled={!!reason} title={reason}>Record result</Button>
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
  const services = useServices()
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
  const origWhy = !ev.sensitive ? 'This item has no sensitive content — nothing is masked.' : !data.canViewSensitive ? `The ${ROLE_LABEL[me.role]} role cannot view sensitive content.` : !data.canViewOriginal ? `The ${ROLE_LABEL[me.role]} role can only view masked content. Ask a Reviewer, Operator or Manager.` : ''
  const masked = ev.sensitive && !orig
  const isImg = ev.kind.startsWith('Image')
  const ro = readOnly(ev.projectId)
  const createWhy = ro ? 'Project is read-only.' : !can('createFinding', ev.projectId) ? `The ${ROLE_LABEL[me.role]} role cannot create findings.` : ''
  const sample = ev.kind === 'JSON' ? '{\n  "role": "service-demo",\n  "permissions": ["read", "list"]\n}' : 'user=demo_account\ngroups=Users, Backup (simulated)\n[synthetic content — no real data]'
  /* The legacy raw `A.audit` entry, mirrored exactly: one 'legacy' commit
     through the one authority. */
  const audit = (action: string, obj: string, projectId: string, result = 'Success', reason = '') =>
    services.authority.commit('legacy', (d) => { d.audit.unshift({ corr: projectId === 'RT-2026-014' && /^(SS|AR)-/.test(obj) ? 'COR-014-01' : undefined, id: 'AU-' + ++d.counters.audit, at: stamp(), actor: me.name, role: ROLE_LABEL[me.role], action, obj, projectId, result, reason }) })
  const toggle = () => {
    if (!orig) {
      confirm({ title: 'View original content?', confirmLabel: 'View original', body: 'Original (unmasked) content will be shown on screen. This access is recorded in the review log (simulated).', onConfirm: () => { setOrig(true); setLog((l) => [{ at: 'Just now (UTC+7)', text: `${me.name} viewed original content` }, ...l]); audit('Viewed original evidence', ev.ref, ev.projectId) } })
    } else { setOrig(false); toast('Masked view restored.', 'info') }
  }
  const createFinding = () => {
    setFilter('finding-prefill', { projectId: ev.projectId, op: producer?.operation?.id, technique: producer?.step?.technique, asset: producer?.step?.asset, stepId: producer?.step?.id, evidence: [ev.ref], title: producer?.step ? `Finding from ${ev.ref}: ${producer.step.name}` : `Finding from ${ev.ref}`, desc: `Observed in ${ev.source}. Evidence ${ev.ref} (${ev.kind}) captured ${ev.at}.` })
    go('finding-new')
  }
  const chain = [
    { at: ev.at, title: `Captured by agent ${producer?.step?.agent || producer?.invocation?.producer || '—'}`, sub: `${ev.source} · collector ${producer?.agent ? producer.agent.host : 'operator upload'}`, tone: 'cyan' as const },
    { at: ev.at, title: 'Hash computed and stored (simulated SHA-256)', sub: 'Integrity baseline — describes the retained capture, not the truth of any finding', tone: 'accent' as const },
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
            <CardHeader title="Content" sub="Simulated preview — no real files or payloads." actions={
              <Button size="sm" icon={orig ? EyeOff : Eye} disabled={!!origWhy} title={origWhy || (orig ? 'Return to masked view' : 'Show original content (logged)')} onClick={toggle}>{orig ? 'Mask content' : 'View Original'}</Button>
            } />
            {origWhy && ev.sensitive && <div className="mb-3"><Locked reason={origWhy} /></div>}
            {masked ? (
              <div className="flex h-44 items-center justify-center rounded-lg border border-line bg-bg text-center text-muted" role="img" aria-label="Masked content"><div><Lock size={28} className="mx-auto mb-2 text-warn" aria-hidden /><div className="text-sm">Content masked by default</div><div className="text-xs">Redaction status: Redacted</div></div></div>
            ) : isImg ? (
              <div className="flex h-44 items-center justify-center rounded-lg border border-line bg-bg text-muted" role="img" aria-label="Image preview (simulated)"><div className="text-center"><FileImage size={30} className="mx-auto mb-2" aria-hidden /><div className="text-xs">Synthetic image — {ev.name}</div></div></div>
            ) : (
              <pre className="max-h-56 overflow-auto rounded-lg border border-line bg-bg p-3 font-mono text-xs leading-relaxed">{sample}</pre>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" icon={Download} disabled={!data.canViewSensitive || masked} title={!data.canViewSensitive ? 'Your role cannot download evidence.' : masked ? 'Download is available only for content you are permitted to view unmasked.' : ''} onClick={() => toast(`Download of ${ev.name} started (simulated).`, 'info')}>Download</Button>
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
              { k: 'Hash / integrity', v: <span><Mono className="break-all text-xs">sha256:{data.integrity.digest?.slice(0, 24)}…</Mono><div className="mt-1 inline-flex items-center gap-1 text-xs text-ok"><Fingerprint size={12} aria-hidden />Integrity verified (simulated)</div><div className="mt-1 text-xs text-muted">Describes the retained capture — not proof that any finding is true.</div></span> },
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

export const findingRoutes: Record<string, ComponentType> = { findings: FindingList, 'finding-new': FindingForm, finding: FindingDetail, evidence: EvidenceInspector, 'evidence-inspector': EvidenceInspector }
export { Segmented }
