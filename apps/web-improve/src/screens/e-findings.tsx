import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import { AlertTriangle, Bug, Download, ExternalLink, FileImage, FilePlus2, FileText, Link2, Lock, Sparkles, Eye, EyeOff, Fingerprint, X, Search, Paperclip, Pencil, Plus, RotateCcw, Send, ShieldCheck, Upload } from 'lucide-react'
import { ROLE_LABEL, canAccessProject, sevLabel, useDirty, useStore } from '../store'
import { TECHNIQUES, type Evidence, type Finding, type FindingStatus, type Severity } from '../data'
import {
  Banner, Button, Card, CardHeader, Check, DescList, Drawer, Empty, Field, FilterBar, Input, Kpi, Locked, Modal, Mono, PageHeader, Pager, Person, PersonaHint, SearchBox, Segmented, Select, Sev, Status, Table, Tabs, Textarea, Timeline, cx, usePaged, useGuard,
} from '../ui'

const SEVS: Severity[] = ['critical', 'high', 'medium', 'low', 'info']
const STATUSES: FindingStatus[] = ['draft', 'review', 'returned', 'confirmed', 'remediation', 'retest', 'resolved']
const STATUS_LABEL: Record<string, string> = { ai_suggested: 'AI Suggested — unverified', draft: 'Draft', review: 'In Review', returned: 'Returned', confirmed: 'Confirmed', remediation: 'In Remediation', retest: 'Retest', resolved: 'Resolved' }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const ts = (s: string) => {
  const m = s.match(/([A-Za-z]{3}) (\d+), (\d{4}), (\d+):(\d+) ([AP])M/)
  if (!m) return 0
  const h = (+m[4] % 12) + (m[6] === 'P' ? 12 : 0)
  return Date.UTC(+m[3], MONTHS.indexOf(m[1]), +m[2], h, +m[5])
}
const isVerified = (f: Finding) => f.status !== 'ai_suggested'
const TABS: { id: string; label: string; test: (f: Finding) => boolean }[] = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'confirmed', label: 'Confirmed', test: (f) => f.status === 'confirmed' },
  { id: 'review', label: 'In Review', test: (f) => f.status === 'review' },
  { id: 'ai', label: 'AI Suggestions', test: (f) => f.status === 'ai_suggested' },
  { id: 'drafts', label: 'Drafts', test: (f) => f.status === 'draft' || f.status === 'returned' },
  { id: 'remediation', label: 'Remediation', test: (f) => ['remediation', 'retest', 'resolved'].includes(f.status) },
]
const SEV_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }

/** Reason creation is not allowed (empty = allowed) */
function useCreateReason(projectId?: string) {
  const { pid, can, readOnly, me } = useStore()
  const p = projectId || pid
  if (p === 'all') return 'Select a specific project before creating a finding.'
  if (readOnly(p)) return me.role === 'viewer' ? 'The Client / Viewer role is read-only.' : 'Project is closed — read-only.'
  if (!can('createFinding', p)) return `The ${ROLE_LABEL[me.role]} role cannot create findings.`
  return ''
}

/* ───────────── FI-01: list ───────────── */
/** Verify / dismiss actions for an AI-suggested finding (never counted as verified until verified). */
function useAiActions() {
  const { A, confirm, toast, go, can, readOnly, me, persistFilters, setFilter } = useStore()
  const dismissed: Record<string, string> = persistFilters['fd-dismissed'] || {}
  const why = (f: Finding) => (readOnly(f.projectId) ? 'Project is read-only.' : !can('createFinding', f.projectId) ? `The ${ROLE_LABEL[me.role]} role cannot verify or dismiss AI suggestions. An Analyst or Operator can.` : '')
  const verify = (f: Finding) => confirm({
    title: `Verify & create finding from ${f.id}?`, confirmLabel: 'Verify & create finding',
    body: 'You confirm you reviewed the source step and evidence. The suggestion becomes a finding in "In Review" and a Reviewer must still confirm it before it counts in reports.',
    onConfirm: () => { A.setFindingStatus(f.id, 'review', 'Verified from AI suggestion by a human'); toast(`${f.id} is now a finding in review.`); go('finding', { id: f.id }) },
  })
  const dismiss = (f: Finding) => confirm({
    title: `Dismiss ${f.id}?`, confirmLabel: 'Dismiss suggestion', danger: true, reasonLabel: 'Reason for dismissing', reasonRequired: true,
    body: 'The suggestion is removed from the active AI Suggestions list. It is never added to confirmed counts or reports. The reason is recorded.',
    onConfirm: (r) => { setFilter('fd-dismissed', { ...dismissed, [f.id]: r }); A.addFindingComment(f.id, `AI suggestion dismissed: ${r}`); A.audit('Dismissed AI suggestion', f.id, f.projectId, 'Success', r); toast(`${f.id} dismissed.`, 'warn') },
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

function FindingList() {
  const { db, scoped, go, pid, project, setSwitcherOpen, accessible, route } = useStore()
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
  const reason = useCreateReason()
  const all = scoped(db.findings)
  const verified = all.filter(isVerified)
  const owners = [...new Set(all.map((f) => f.owner))]
  const assets = [...new Set(all.map((f) => f.asset))]
  const opsList = [...new Set(all.map((f) => f.op).filter(Boolean))]
  const curTab = TABS.find((t) => t.id === tab) || TABS[0]
  const rows = all
    .filter((f) => curTab.test(f) && (tab !== 'ai' || showDis || !ai.dismissed[f.id]) && (!q || (f.id + ' ' + f.title).toLowerCase().includes(q.toLowerCase())) && (!sev || f.severity === sev) && (!prj || f.projectId === prj) && (!owner || f.owner === owner) && (!asset || f.asset === asset) && (!opf || f.op === opf))
    .sort((a, b) => (sort === 'severity' ? SEV_RANK[a.severity] - SEV_RANK[b.severity] || ts(b.updated) - ts(a.updated) : sort === 'id' ? a.id.localeCompare(b.id) : sort === 'created' ? ts(b.date) - ts(a.date) : ts(b.updated) - ts(a.updated)))
  const pg = usePaged(rows, 10)
  const count = (t: (typeof TABS)[number]) => all.filter((f) => t.test(f) && (t.id !== 'ai' || !ai.dismissed[f.id])).length
  const vcount = (s: FindingStatus) => verified.filter((f) => f.status === s).length
  const moreActive = [prj, owner, asset, sort !== 'updated' ? sort : ''].filter(Boolean).length
  const filtered = !!(q || sev || prj || owner || asset || opf || tab !== 'all')
  const reset = () => { setQ(''); setSev(''); setTab('all'); setPrj(''); setOwner(''); setAsset(''); setOpf(''); setSort('updated') }
  const nSugg = count(TABS[3])

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
        {SEVS.map((s) => <Kpi key={s} label={sevLabel[s]} value={verified.filter((f) => f.severity === s).length} tone={s === 'critical' || s === 'high' ? 'bad' : s === 'medium' ? 'warn' : s === 'low' ? 'cyan' : 'neutral'} onClick={() => setSev(sev === s ? '' : s)} />)}
        <Kpi label="Awaiting Review" value={vcount('review')} tone="warn" onClick={() => setTab('review')} />
        <Kpi label="Resolved" value={vcount('resolved')} tone="ok" onClick={() => setTab('remediation')} />
        <Kpi label="AI Suggestions" value={nSugg} sub="unverified — not in counts" tone="warn" onClick={() => setTab('ai')} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={TABS.map((t) => ({ id: t.id, label: t.label, count: count(t) }))} />
      <FilterBar right={filtered ? <Button size="sm" variant="ghost" icon={RotateCcw} onClick={reset}>Reset</Button> : undefined}>
        <SearchBox value={q} onChange={setQ} placeholder="Search by ID or title…" className="w-full sm:w-64" />
        <Select aria-label="Severity" value={sev} onChange={(e) => setSev(e.target.value)} className="!w-auto"><option value="">All severities</option>{SEVS.map((s) => <option key={s} value={s}>{sevLabel[s]}</option>)}</Select>
        <Select aria-label="Operation" value={opf} onChange={(e) => setOpf(e.target.value)} className="!w-auto"><option value="">All operations</option>{opsList.map((o) => <option key={o}>{o}</option>)}</Select>
        <MoreFilters active={moreActive}>
          {pid === 'all' && <Field label="Project"><Select value={prj} onChange={(e) => setPrj(e.target.value)}><option value="">All projects</option>{accessible.map((p) => <option key={p.id} value={p.id}>{p.id}</option>)}</Select></Field>}
          <Field label="Owner"><Select value={owner} onChange={(e) => setOwner(e.target.value)}><option value="">All owners</option>{owners.map((o) => <option key={o}>{o}</option>)}</Select></Field>
          <Field label="Asset"><Select value={asset} onChange={(e) => setAsset(e.target.value)}><option value="">All assets</option>{assets.map((o) => <option key={o}>{o}</option>)}</Select></Field>
          <Field label="Sort"><Select value={sort} onChange={(e) => setSort(e.target.value)}><option value="updated">Recently updated</option><option value="created">Newest recorded</option><option value="severity">Severity</option><option value="id">ID</option></Select></Field>
        </MoreFilters>
      </FilterBar>
      {tab === 'ai' && (
        <div className="mb-3 space-y-2">
          <Banner tone="warn" icon={Sparkles} title="AI suggestions are not verified findings">They are excluded from confirmed counts, severity charts and reports until a human verifies them.</Banner>
          {Object.keys(ai.dismissed).length > 0 && <label className="flex cursor-pointer items-center gap-2 text-xs text-muted"><input type="checkbox" className="accent-[var(--c-accent)]" checked={showDis} onChange={(e) => setShowDis(e.target.checked)} />Show dismissed suggestions ({Object.keys(ai.dismissed).length})</label>}
        </div>
      )}
      <Table
        rows={pg.rows} rowKey={(f) => f.id} onRow={(f) => go('finding', { id: f.id })}
        empty={
          <Empty icon={tab === 'ai' ? Sparkles : Bug} title={tab === 'ai' ? 'No AI suggestions to review' : filtered ? 'No findings match the filters' : 'No findings yet'} action={filtered ? <Button onClick={reset}>Reset filters</Button> : <Button variant="primary" icon={Plus} disabled={!!reason} title={reason} onClick={() => go('finding-new')}>Create Finding</Button>}>
            {tab === 'ai' ? 'AI suggestions appear here when the AI Operator spots a possible gap in an operation.' : filtered ? 'Try removing some filters or the search term.' : 'No verified findings is a valid result. Findings are created from operation results, evidence or attack analysis — never invented to complete a report.'}
          </Empty>
        }
        cols={[
          { key: 'id', header: 'Finding ID', render: (f) => <span className="whitespace-nowrap"><Mono className="text-accent">{f.id}</Mono></span> },
          { key: 't', header: 'Title', render: (f) => <div className="max-w-[300px] truncate font-medium" title={f.title}>{f.title}</div> },
          { key: 'p', header: 'Project', hideBelow: 'md', render: (f) => <div className="whitespace-nowrap"><Mono>{f.projectId}</Mono><div className="text-xs text-muted">{db.projects.find((p) => p.id === f.projectId)?.client}</div></div> },
          { key: 'sev', header: 'Severity', render: (f) => <span className="whitespace-nowrap"><Sev v={f.severity} /></span> },
          { key: 'a', header: 'Affected asset', hideBelow: 'lg', render: (f) => <span className="whitespace-nowrap"><Mono>{f.asset}</Mono></span> },
          { key: 'op', header: 'Operation', hideBelow: 'lg', render: (f) => <span className="whitespace-nowrap"><Mono>{f.op}</Mono></span> },
          { key: 'o', header: 'Owner', hideBelow: 'md', render: (f) => <span className="whitespace-nowrap">{f.owner}</span> },
          { key: 's', header: 'Status', render: (f) => <span className="whitespace-nowrap"><Status kind="finding" value={f.status} />{ai.dismissed[f.id] && <span className="ml-1.5 text-xs text-muted">dismissed</span>}</span> },
          { key: 'u', header: 'Updated', hideBelow: 'lg', render: (f) => <span className="whitespace-nowrap text-xs text-muted">{f.updated}</span> },
          ...(tab === 'ai' ? [{ key: 'act', header: 'Actions', render: (f: Finding) => {
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
      <Pager {...pg} />
    </div>
  )
}

/* ───────────── Access guard for the finding page ───────────── */
function useFinding(id?: string): { f?: Finding; blocked?: ReactNode } {
  const { db, me, pid, go, setPid, setSwitcherOpen } = useStore()
  const f = db.findings.find((x) => x.id === id)
  if (!f) {
    return { blocked: <Empty icon={AlertTriangle} title="Finding not found" action={<Button onClick={() => go('findings')}>Back to findings</Button>}>ID {id || '—'} does not exist or was removed.</Empty> }
  }
  if (!canAccessProject(db, me, f.projectId)) {
    return { blocked: <Empty icon={Lock} title="You do not have permission to view this finding" action={<Button onClick={() => go('findings')}>Back to findings</Button>}>Finding {f.id} belongs to a project your current account cannot access.</Empty> }
  }
  if (pid !== 'all' && f.projectId !== pid) {
    return {
      blocked: (
        <Empty icon={Lock} title={`Finding ${f.id} belongs to another project`} action={<div className="flex gap-2"><Button variant="primary" onClick={() => { setPid(f.projectId); setTimeout(() => go('finding', { id: f.id }), 80) }}>Switch to {f.projectId}</Button><Button onClick={() => setSwitcherOpen(true)}>Select another project</Button></div>}>
          The selected project is {pid}. To avoid mixing data, content from {f.projectId} is not shown in this context.
        </Empty>
      ),
    }
  }
  return { f }
}

const MaskedName = ({ ev }: { ev: Evidence }) => {
  const { can } = useStore()
  return ev.sensitive && !can('viewSensitive') ? <span className="inline-flex items-center gap-1.5 text-warn"><Lock size={13} aria-hidden />Sensitive file — redacted</span> : <span>{ev.name}</span>
}

/* ───────────── FI-03: create / edit ───────────── */
interface Draft { title: string; severity: Severity; severityReason: string; asset: string; op: string; technique: string; desc: string; scopeNote: string; impact: string; rec: string; evidence: string[]; owner: string; kind: string; stepId?: string }

function FindingForm() {
  const { db, me, pid, route, go, A, toast, persistFilters, setFilter, setSwitcherOpen, can } = useStore()
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

  const draftPayload = () => ({ projectId, title: d.title.trim(), severity: d.severity, owner: d.owner, kind: d.kind, desc: d.desc, scopeNote: d.scopeNote, asset: d.asset, impact: d.impact, rec: d.rec, technique: d.technique, op: d.op, stepId: d.stepId, evidence: d.evidence, severityReason: d.severityReason })
  const finish = (id: string, msg: string) => {
    setSaved(true)
    toast(msg)
    setTimeout(() => go('finding', { id }), 80)
  }
  const persist = (submit: boolean, navigate: boolean): string | null => {
    if (!projectId) return null
    let id = editing?.id || ''
    if (editing) {
      A.updateFinding(editing.id, draftPayload())
      d.evidence.filter((e) => !editing.evidence.includes(e)).forEach((e) => A.attachEvidence(editing.id, e))
      if (d.severity !== editing.severity && d.severityReason.trim()) A.addFindingComment(editing.id, `Rationale for changing severity to ${sevLabel[d.severity]}: ${d.severityReason.trim()}`)
      if (submit) A.setFindingStatus(editing.id, 'review')
    } else {
      id = A.createFinding(draftPayload(), submit)
      if (d.severityReason.trim()) A.addFindingComment(id, `Severity rationale (${sevLabel[d.severity]}): ${d.severityReason.trim()}`)
    }
    if (navigate) finish(id, submit ? `${id} submitted for review.` : `Draft ${id} saved.`)
    return id
  }
  const saveDraft = () => {
    setTried(true)
    if (d.title.trim().length < 5) { toast('Enter a finding title (at least 5 characters) before saving a draft.', 'warn'); return }
    persist(false, true)
  }
  const submit = () => {
    setTried(true)
    if (Object.keys(err).length) { toast('Please complete the required fields.', 'warn'); return }
    if (submitReason) { toast(submitReason, 'warn'); return }
    persist(true, true)
  }
  useDirty(dirty, () => { if (d.title.trim().length >= 5 && projectId && !locked) { persist(false, false); setSaved(true); toast('Draft saved.') } })

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
        <Button onClick={saveDraft} disabled={locked} title={locked ? createReason || 'Cannot edit in the current status.' : ''}>Save Draft</Button>
        <Button variant="primary" icon={Send} onClick={submit} disabled={locked || !!submitReason} title={locked ? createReason || 'Cannot edit in the current status.' : submitReason}>Submit for Review</Button>
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

function FindingDetail() {
  const { route, go, can, readOnly, me, A, confirm, toast, db, scoped } = useStore()
  const { f, blocked } = useFinding(route.id)
  const [note, setNote] = useState('')
  const [rep, setRep] = useState(false)
  const ai = useAiActions()
  if (blocked || !f) return <div>{blocked}</div>
  const tab = route.tab || 'overview'
  const ro = readOnly(f.projectId)
  const reviewer = can('reviewFinding', f.projectId)
  const author = can('createFinding', f.projectId)
  const proj = db.projects.find((p) => p.id === f.projectId)
  const asset = db.assets.find((a) => a.name === f.asset && a.projectId === f.projectId)
  const op = db.operations.find((o) => o.id === f.op)
  const tech = TECHNIQUES.find((t) => t.id === f.technique)
  const noEv = f.evidence.length === 0
  const roReason = me.role === 'viewer' ? 'The Client / Viewer role is read-only.' : 'Project is closed — read-only.'
  const returnedNote = f.status === 'returned' ? [...f.comments].reverse()[0] : undefined
  const reports = db.reports.filter((r) => r.projectId === f.projectId && ['draft', 'returned'].includes(r.status))
  const inReport = db.reports.filter((r) => r.findings.includes(f.id))
  const reportReason = f.status === 'ai_suggested' ? 'AI suggestions are unverified and cannot be included in a report. Verify the finding first.' : ro ? roReason : !can('editReport', f.projectId) ? `The ${ROLE_LABEL[me.role]} role cannot edit reports.` : ['draft', 'review', 'returned'].includes(f.status) ? 'Only confirmed findings can be added to a report.' : ''

  const step = op?.steps.find((x) => x.evidence && f.evidence.includes(x.evidence)) || op?.steps.find((x) => x.technique === f.technique)
  const lastDecision = [...f.history].reverse().find((h) => /Confirmed|Returned/.test(h.text))
  const doSubmit = () => { A.setFindingStatus(f.id, 'review'); toast(`${f.id} submitted for review.`) }
  const approve = () => confirm({ title: `Confirm ${f.id}?`, body: 'The finding will move to "Confirmed" and can be added to reports. This action is written to the audit log.', confirmLabel: 'Confirm Finding', onConfirm: () => { A.setFindingStatus(f.id, 'confirmed'); toast(`${f.id} was confirmed.`) } })
  const sendBack = () => confirm({ title: `Return ${f.id} for changes`, body: 'The author will be notified with your reason so they can make changes.', confirmLabel: 'Return for Changes', danger: true, reasonLabel: 'Reason for returning', reasonRequired: true, onConfirm: (r) => { A.setFindingStatus(f.id, 'returned', r); toast(`${f.id} returned to the author.`, 'warn') } })

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
  if (f.status === 'confirmed') actions.push(<Button key="rm" variant="primary" disabled={ro || !(reviewer || author)} title={ro ? roReason : ''} onClick={() => confirm({ title: 'Move to remediation?', body: 'Marks the finding as being remediated by the asset owner.', confirmLabel: 'Move to Remediation', onConfirm: () => { A.setFindingStatus(f.id, 'remediation'); toast(`${f.id} moved to In Remediation.`) } })}>Send to Remediation</Button>)
  if (f.status === 'remediation') actions.push(<Button key="rt" variant="primary" icon={RotateCcw} disabled={ro || !(reviewer || author)} title={ro ? roReason : ''} onClick={() => { A.setFindingStatus(f.id, 'retest'); toast(`${f.id} is awaiting retest.`) }}>Request Retest</Button>)
  if (f.status === 'retest') actions.push(<Button key="gt" variant="primary" icon={RotateCcw} onClick={() => go('finding', { id: f.id, tab: 'retest' })}>Record Retest</Button>)
  actions.push(
    <Button key="rep" icon={FilePlus2} disabled={!!reportReason} title={reportReason || 'Add this finding to a report in the same project'} onClick={() => setRep(true)}>Add to Report</Button>,
  )

  const postComment = () => { if (!note.trim()) return; A.addFindingComment(f.id, note.trim()); setNote(''); toast('Comment posted.') }

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
      {tab === 'evidence' ? <EvidenceTab f={f} ro={ro} /> : tab === 'retest' ? <RetestTab f={f} ro={ro} roReason={roReason} /> : (
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
                { k: 'Affected asset', v: asset ? <button className="font-mono text-[13px] text-accent hover:underline" onClick={() => go('asset', { id: asset.id })}>{f.asset} <ExternalLink size={11} className="inline" /></button> : <Mono>{f.asset}</Mono> },
                { k: 'Evidence', v: f.evidence.length ? f.evidence.map((id) => <button key={id} className="mr-2 whitespace-nowrap font-mono text-[13px] text-accent hover:underline" onClick={() => go('evidence', { id })}>{id}</button>) : <span className="text-muted">None linked</span> },
                { k: 'Operation step', v: op && step ? <button className="whitespace-nowrap font-mono text-[13px] text-accent hover:underline" onClick={() => go('operation', { id: op.id, tab: 'console' })}>{op.id} / {step.id} — {step.name}</button> : '—' },
                { k: 'Confidence', v: f.status === 'ai_suggested' ? 'Low — AI inference, needs verification' : f.evidence.length ? 'High — backed by linked evidence' : 'Low — no evidence linked' },
                { k: 'Reviewer decision', v: f.status === 'ai_suggested' ? 'Not submitted' : lastDecision ? `${lastDecision.text} by ${lastDecision.by}` : 'Pending' },
                { k: 'Operation', v: op ? <button className="font-mono text-[13px] text-accent hover:underline" onClick={() => go('operation', { id: op.id })}>{op.id} — {op.name}</button> : f.op || '—' },
                { k: 'ATT&CK technique', v: tech ? <button className="text-left text-accent hover:underline" onClick={() => go('technique', { id: tech.id })}><Mono>{tech.id}</Mono> — {tech.name}</button> : f.technique || 'Not applicable' },
                { k: 'Client', v: proj?.client },
                { k: 'Recorded', v: f.date },
                { k: 'Included in reports', v: inReport.length ? inReport.map((r) => <button key={r.id} className="mr-2 font-mono text-[13px] text-accent hover:underline" onClick={() => go('report', { id: r.id })}>{r.id}</button>) : 'Not yet' },
              ]} />
            </Card>
            <Card>
              <CardHeader title="Execution timeline" sub="From the source step through evidence to this finding." />
              <Timeline items={[
                ...(step && step.ts !== '—' ? [{ at: `${step.ts} (UTC+7)`, title: `Step ${step.id} executed — ${step.name}`, sub: `${step.agent} on ${step.asset} · ${step.technique}`, tone: 'cyan' as const }] : []),
                ...f.evidence.map((id) => db.evidence.find((e) => e.id === id)).filter((e): e is Evidence => !!e).map((e) => ({ at: e.at, title: `Evidence ${e.id} captured`, sub: `${e.kind} · ${e.by}`, tone: 'accent' as const })),
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
  const { A, go, toast, setFilter } = useStore()
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
                <Button size="sm" variant="primary" onClick={() => { if (!has) A.setReportFindings(r.id, [...r.findings, f.id]); toast(has ? `${f.id} is already in ${r.id}.` : `Added ${f.id} to ${r.id}.`); onClose(); go('report', { id: r.id }) }}>{has ? 'Open report' : 'Add'}</Button>
              </li>
            )
          })}
        </ul>
      )}
      <Button icon={Plus} onClick={() => { setFilter('report-prefill', { projectId: f.projectId, findings: [f.id] }); onClose(); go('report-new') }}>Create a new report with this finding</Button>
    </Modal>
  )
}

/* ───────────── Evidence tab ───────────── */
const OK_EXT = ['png', 'jpg', 'jpeg', 'txt', 'log', 'json', 'csv', 'pdf']
function EvidenceTab({ f, ro }: { f: Finding; ro: boolean }) {
  const { db, can, A, toast, me, go } = useStore()
  const [view, setView] = useState<Evidence | null>(null)
  const [attach, setAttach] = useState(false)
  const [up, setUp] = useState(false)
  const items = f.evidence.map((id) => db.evidence.find((e) => e.id === id)).filter(Boolean) as Evidence[]
  const canAdd = !ro && can('createFinding', f.projectId)
  const why = ro ? (me.role === 'viewer' ? 'The Client / Viewer role is read-only.' : 'Project is closed — read-only.') : !canAdd ? `The ${ROLE_LABEL[me.role]} role cannot add evidence.` : ''
  const candidates = db.evidence.filter((e) => e.projectId === f.projectId && !f.evidence.includes(e.id))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto text-sm text-muted">{items.length} evidence item(s) — evidence cannot be removed from history; every link is logged.</span>
        <Button icon={Link2} disabled={!canAdd} title={why} onClick={() => setAttach(true)}>Link Evidence</Button>
        <Button variant="primary" icon={Upload} disabled={!canAdd} title={why} onClick={() => setUp(true)}>Upload evidence</Button>
      </div>
      <Table
        rows={items} rowKey={(e) => e.id} onRow={setView}
        empty={<Empty icon={Paperclip} title="No evidence yet" action={<Button variant="primary" icon={Upload} disabled={!canAdd} title={why} onClick={() => setUp(true)}>Upload evidence</Button>}>A finding needs at least one piece of evidence before it can be submitted for review.</Empty>}
        cols={[
          { key: 'n', header: 'Name', render: (e) => <div className="flex items-center gap-2"><Mono className="text-accent">{e.id}</Mono><MaskedName ev={e} /></div> },
          { key: 'k', header: 'Type', render: (e) => e.kind },
          { key: 's', header: 'Source', hideBelow: 'md', render: (e) => <Mono>{e.source}</Mono> },
          { key: 'a', header: 'Captured at', hideBelow: 'lg', render: (e) => <span className="text-xs text-muted">{e.at}</span> },
          { key: 'b', header: 'Uploaded by', hideBelow: 'md', render: (e) => e.by },
          { key: 'l', header: 'Label', render: (e) => (e.sensitive ? <span className="inline-flex items-center gap-1 text-xs text-warn"><Lock size={12} aria-hidden />Sensitive</span> : <span className="text-xs text-muted">Standard</span>) },
        ]}
      />
      <Drawer open={!!view} onClose={() => setView(null)} title={view ? <span><Mono className="text-accent">{view.id}</Mono> · <MaskedName ev={view} /></span> : ''}
        footer={view && <><Button icon={Eye} onClick={() => go('evidence', { id: view.id })}>Open in Evidence Inspector</Button><Button icon={Download} disabled={view.sensitive && !can('viewSensitive')} title={view.sensitive && !can('viewSensitive') ? 'Sensitive file — your role cannot download it.' : ''} onClick={() => toast(`Download of ${view.name} started (simulated).`, 'info')}>Download</Button></>}>
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
                  <Button size="sm" disabled={other || hide} title={other ? `Already linked to ${e.findingId}` : hide ? 'Outside your permission scope' : ''} onClick={() => { A.attachEvidence(f.id, e.id); toast(`Linked ${e.id} to ${f.id}.`) }}>Link</Button>
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
  const { A, toast } = useStore()
  const [name, setName] = useState('')
  const [kind, setKind] = useState('Image')
  const [sens, setSens] = useState(false)
  const [source, setSource] = useState(f.op ? `${f.op} / manual` : 'Manual upload')
  const [tried, setTried] = useState(false)
  const ext = name.split('.').pop()?.toLowerCase() || ''
  const e = !name.trim() ? 'Enter a file name.' : !name.includes('.') || !OK_EXT.includes(ext) ? `Unsupported file type. Accepted: ${OK_EXT.join(', ')}.` : ''
  const save = () => {
    setTried(true)
    if (e) return
    const id = A.addEvidence({ name: name.trim(), kind, source, projectId: f.projectId, opId: f.op || undefined, sensitive: sens, findingId: f.id })
    A.attachEvidence(f.id, id)
    toast(`Uploaded ${name.trim()} and linked it to ${f.id}.`)
    setName(''); setTried(false); setSens(false); onClose()
  }
  return (
    <Modal open={open} onClose={onClose} title="Upload evidence (simulated)" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon={Upload} onClick={save}>Upload & link</Button></>}>
      <div className="space-y-4">
        <Field label="File name" required error={tried ? e : undefined} hint="No real file is uploaded — only a simulated record is created."><Input value={name} onChange={(x) => setName(x.target.value)} placeholder="e.g. evidence-028.png" /></Field>
        <Field label="Type"><Select value={kind} onChange={(x) => setKind(x.target.value)}>{['Image', 'Image (redacted)', 'Text', 'JSON', 'Log'].map((k) => <option key={k}>{k}</option>)}</Select></Field>
        <Field label="Source"><Input value={source} onChange={(x) => setSource(x.target.value)} /></Field>
        <Check checked={sens} onChange={setSens} label="Mark as sensitive (redacted for users without permission)" />
        <div className="text-xs text-muted">This evidence will belong to project <Mono>{f.projectId}</Mono>.</div>
      </div>
    </Modal>
  )
}

function EvidencePreview({ ev, f, onOp }: { ev: Evidence; f: Finding; onOp: () => void }) {
  const { can } = useStore()
  const hide = ev.sensitive && !can('viewSensitive')
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

/* ───────────── Retest tab ───────────── */
const RETEST_STATE: Record<string, { label: string; tone: 'ok' | 'bad' | 'warn' | 'neutral' }> = {
  'Resolved': { label: 'Resolved', tone: 'ok' }, 'Persists': { label: 'Still present', tone: 'bad' }, 'Partial': { label: 'Partially resolved', tone: 'warn' },
}
function RetestTab({ f, ro, roReason }: { f: Finding; ro: boolean; roReason: string }) {
  const { A, toast, can, me } = useStore()
  const [result, setResult] = useState('Resolved')
  const [note, setNote] = useState('')
  const [tried, setTried] = useState(false)
  const stageOk = ['confirmed', 'remediation', 'retest', 'resolved'].includes(f.status)
  const roleOk = can('createFinding', f.projectId) || can('reviewFinding', f.projectId)
  const reason = ro ? roReason : !roleOk ? `The ${ROLE_LABEL[me.role]} role cannot record retests.` : !stageOk ? 'Retest is only available after the finding has been confirmed.' : ''
  const save = () => {
    setTried(true)
    if (!note.trim()) return
    A.addRetest(f.id, { result, note: note.trim() })
    if (result !== 'Resolved' && f.status === 'retest') A.setFindingStatus(f.id, 'remediation', `Retest not passed (${result}): ${note.trim()}`)
    toast(result === 'Resolved' ? `${f.id} was marked Resolved.` : 'Retest result recorded.', result === 'Resolved' ? 'ok' : 'warn')
    setNote(''); setTried(false)
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

/* ───────────── FI-V3-03: Evidence list + Inspector ───────────── */
const fakeHash = (id: string) => {
  let h = 2166136261
  const out: string[] = []
  for (let i = 0; i < 8; i++) { for (const c of id + i) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) } out.push((h >>> 0).toString(16).padStart(8, '0')) }
  return out.join('')
}

function EvidenceList() {
  const { db, scoped, go, pid, can } = useStore()
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('')
  const all = scoped(db.evidence)
  const rows = all.filter((e) => (!q || (e.id + ' ' + e.name + ' ' + e.source).toLowerCase().includes(q.toLowerCase())) && (!kind || e.kind === kind))
  return (
    <div>
      <PageHeader title="Evidence" sub={pid === 'all' ? 'Evidence across accessible projects (read-only).' : `Evidence recorded for ${pid}. Open an item to inspect metadata and chain of custody.`} />
      <FilterBar>
        <SearchBox value={q} onChange={setQ} placeholder="Search by ID, name or source…" className="w-full sm:w-72" />
        <Select aria-label="Type" value={kind} onChange={(e) => setKind(e.target.value)} className="!w-auto"><option value="">All types</option>{[...new Set(all.map((e) => e.kind))].map((k) => <option key={k}>{k}</option>)}</Select>
      </FilterBar>
      <Table
        rows={rows} rowKey={(e) => e.id} onRow={(e) => go('evidence', { id: e.id })}
        empty={<Empty icon={Paperclip} title="No evidence in this project yet" action={<Button onClick={() => go('operations')}>Open Operations</Button>}>Evidence is captured when operation steps produce output. Next: run an operation, or upload from a finding.</Empty>}
        cols={[
          { key: 'id', header: 'Evidence ID', render: (e) => <span className="whitespace-nowrap"><Mono className="text-accent">{e.id}</Mono></span> },
          { key: 'n', header: 'Name', render: (e) => (e.sensitive && !can('viewSensitive') ? <span className="text-warn">Sensitive file — redacted</span> : e.name) },
          { key: 'k', header: 'Type', render: (e) => <span className="whitespace-nowrap">{e.kind}</span> },
          { key: 's', header: 'Source event', hideBelow: 'md', render: (e) => <span className="whitespace-nowrap"><Mono>{e.source}</Mono></span> },
          { key: 'f', header: 'Finding', hideBelow: 'md', render: (e) => (e.findingId ? <span className="whitespace-nowrap"><Mono>{e.findingId}</Mono></span> : '—') },
          { key: 'r', header: 'Redaction', render: (e) => <span className="whitespace-nowrap text-xs">{e.sensitive ? <span className="text-warn">Redacted by default</span> : 'None needed'}</span> },
          { key: 'a', header: 'Captured', hideBelow: 'lg', render: (e) => <span className="whitespace-nowrap text-xs text-muted">{e.at}</span> },
        ]}
      />
    </div>
  )
}

function EvidenceInspector() {
  const { route, db, me, pid, go, can, A, toast, confirm, setFilter, setPid, readOnly } = useStore()
  const [orig, setOrig] = useState(false)
  const [log, setLog] = useState<{ at: string; text: string }[]>([])
  if (!route.id) return <EvidenceList />
  const ev = db.evidence.find((e) => e.id === route.id)
  if (!ev) return <Empty icon={AlertTriangle} title="Evidence not found" action={<Button onClick={() => go('evidence')}>Back to evidence</Button>}>ID {route.id} does not exist or was removed.</Empty>
  if (!canAccessProject(db, me, ev.projectId)) return <Empty icon={Lock} title="You do not have permission to view this evidence" action={<Button onClick={() => go('findings')}>Back</Button>}>Evidence {ev.id} belongs to a project your account cannot access.</Empty>
  if (pid !== 'all' && ev.projectId !== pid) {
    return <Empty icon={Lock} title={`Evidence ${ev.id} belongs to another project`} action={<Button variant="primary" onClick={() => { setPid(ev.projectId); setTimeout(() => go('evidence', { id: ev.id }), 80) }}>Switch to {ev.projectId}</Button>}>To avoid mixing data, content from {ev.projectId} is not shown in {pid}.</Empty>
  }
  const [opId, stepId] = ev.source.split(' / ')
  const op = db.operations.find((o) => o.id === (ev.opId || opId))
  const step = op?.steps.find((x) => x.id === stepId || x.evidence === ev.id)
  const finding = db.findings.find((f) => f.id === ev.findingId || f.evidence.includes(ev.id))
  const agent = db.agents.find((a) => a.id === step?.agent)
  const session = db.sessions.find((x) => x.opId === op?.id && x.agentId === step?.agent)
  const canOrig = can('viewSensitive') && me.role !== 'analyst'
  const origWhy = !ev.sensitive ? 'This item has no sensitive content — nothing is masked.' : !can('viewSensitive') ? `The ${ROLE_LABEL[me.role]} role cannot view sensitive content.` : !canOrig ? `The ${ROLE_LABEL[me.role]} role can only view masked content. Ask a Reviewer, Operator or Manager.` : ''
  const masked = ev.sensitive && !orig
  const isImg = ev.kind.startsWith('Image')
  const ro = readOnly(ev.projectId)
  const createWhy = ro ? 'Project is read-only.' : !can('createFinding', ev.projectId) ? `The ${ROLE_LABEL[me.role]} role cannot create findings.` : ''
  const hash = fakeHash(ev.id)
  const sample = ev.kind === 'JSON' ? '{\n  "role": "service-demo",\n  "permissions": ["read", "list"]\n}' : 'user=demo_account\ngroups=Users, Backup (simulated)\n[synthetic content — no real data]'
  const toggle = () => {
    if (!orig) {
      confirm({ title: 'View original content?', confirmLabel: 'View original', body: 'Original (unmasked) content will be shown on screen. This access is recorded in the review log (simulated).', onConfirm: () => { setOrig(true); setLog((l) => [{ at: 'Just now (UTC+7)', text: `${me.name} viewed original content` }, ...l]); A.audit('Viewed original evidence', ev.id, ev.projectId) } })
    } else { setOrig(false); toast('Masked view restored.', 'info') }
  }
  const createFinding = () => {
    setFilter('finding-prefill', { projectId: ev.projectId, op: op?.id, technique: step?.technique, asset: step?.asset, stepId: step?.id, evidence: [ev.id], title: step ? `Finding from ${ev.id}: ${step.name}` : `Finding from ${ev.id}`, desc: `Observed in ${ev.source}. Evidence ${ev.id} (${ev.kind}) captured ${ev.at}.` })
    go('finding-new')
  }
  const chain = [
    { at: ev.at, title: `Captured by agent ${step?.agent || '—'}`, sub: `${ev.source} · collector ${agent ? agent.host : 'operator upload'}`, tone: 'cyan' as const },
    { at: ev.at, title: 'Hash computed and stored (simulated SHA-256)', sub: 'Integrity baseline recorded', tone: 'accent' as const },
    { at: ev.at, title: `Collected by ${ev.by}`, sub: 'Attached to the operation record', tone: 'accent' as const },
    ...(finding ? [{ at: finding.updated, title: `Linked to ${finding.id}`, sub: 'Link cannot be removed from history', tone: 'ok' as const }] : []),
  ]

  return (
    <div>
      <PageHeader
        back={{ label: 'Evidence', to: () => go('evidence') }}
        title={<span className="flex flex-wrap items-center gap-2"><Mono className="text-accent">{ev.id}</Mono><span className="text-base font-medium">{ev.sensitive && !can('viewSensitive') ? 'Sensitive file — redacted' : ev.name}</span></span>}
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
              <Button size="sm" icon={Download} disabled={masked || !can('viewSensitive')} title={masked ? 'Download is available only for content you are permitted to view unmasked.' : !can('viewSensitive') ? 'Your role cannot download evidence.' : ''} onClick={() => toast(`Download of ${ev.name} started (simulated).`, 'info')}>Download</Button>
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
              { k: 'Evidence ID', v: <Mono>{ev.id}</Mono> },
              { k: 'Source event', v: <Mono>{ev.source}</Mono> },
              { k: 'Operation', v: op ? <button className="font-mono text-[13px] text-accent hover:underline" onClick={() => go('operation', { id: op.id })}>{op.id}</button> : '—' },
              { k: 'Agent / Session', v: <span className="whitespace-nowrap">{agent ? <Mono>{agent.id} · {agent.host}</Mono> : '—'}{session && <> · <button className="font-mono text-[13px] text-accent hover:underline" onClick={() => go('c2-session', { id: session.id })}>{session.id}</button></>}</span> },
              { k: 'Captured time', v: ev.at },
              { k: 'Collector', v: ev.by },
              { k: 'Content type', v: ev.kind },
              { k: 'Hash / integrity', v: <span><Mono className="break-all text-xs">sha256:{hash.slice(0, 24)}…</Mono><div className="mt-1 inline-flex items-center gap-1 text-xs text-ok"><Fingerprint size={12} aria-hidden />Integrity verified (simulated)</div></span> },
              { k: 'Redaction status', v: ev.sensitive ? (orig ? 'Redacted by default — original shown (logged)' : 'Redacted (masked)') : 'None needed' },
            ]} />
          </Card>
          <Card>
            <CardHeader title="Linked records" />
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-2"><span className="text-muted">Operation step</span>{op && step ? <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => go('operation', { id: op.id, tab: 'console' })}>{op.id} / {step.id}</Button> : '—'}</div>
              <div className="flex items-center justify-between gap-2"><span className="text-muted">Finding</span>{finding ? <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => go('finding', { id: finding.id })}>{finding.id}{finding.status === 'ai_suggested' ? ' (AI, unverified)' : ''}</Button> : <span className="text-muted">Not linked yet</span>}</div>
              <div className="flex items-center justify-between gap-2"><span className="text-muted">ATT&CK technique</span>{step ? <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => go('analysis', { id: op?.id, tab: 'matrix' })}>{step.technique}</Button> : '—'}</div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

export const findingRoutes: Record<string, ComponentType> = { findings: FindingList, 'finding-new': FindingForm, finding: FindingDetail, evidence: EvidenceInspector, 'evidence-inspector': EvidenceInspector }
export { Segmented }
