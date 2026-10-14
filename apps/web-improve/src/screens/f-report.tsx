import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, ArrowLeft, CheckCircle2, Download, Eye, FileText, History, Lock, RotateCcw, Save, Send, ShieldCheck, Wand2, XCircle, ListChecks, Plus, Table2 } from 'lucide-react'
import { useDirty } from '../store'
import { sevLabel } from '../features/findings/service'
import type { Finding, Report } from '../data'
import { Banner, Button, Card, CardHeader, Check, Drawer, Empty, Field, Input, Mono, PageHeader, PersonaHint, Segmented, Select, Sev, Skeleton, Status, Stepper, Table, Textarea, Timeline, cx, useGuard } from '../ui'
import { closureEvidence, reportChecks, type NoFind, type RCheck, type ReportEditorRead, type ReportReviewRead } from '../features/reports/service'
import { ReportReadError, useDraftOptions, useReportEditor, useReportReview, useReportWrites } from '../features/reports/query'
import type { ServiceResult } from '../domain/service'
import { go, useRoute } from '../router/navigate'
import { useActiveProject, useCan, useDb, useMe, useScoped } from '../state/console'
import { useProjectStore, useToastStore, useUiStore } from '../state/stores'
import { useSessionStore } from '../state/session'

/* ───────── shared helpers ───────── */

/** Persisted no-findings variant for a report */
function useNoFind(id: string): [NoFind | undefined, (v: NoFind) => void] {
  const persistFilters = useSessionStore((s) => s.persistFilters)
  const setFilter = useSessionStore((s) => s.setFilter)
  const all = (persistFilters.repNoFind as Record<string, NoFind> | undefined) || {}
  return [all[id], (v) => setFilter('repNoFind', { ...all, [id]: v })]
}

/** AI-suggested findings are never part of a formal report */
export function AiExclusion({ projectId }: { projectId?: string }) {
  const db = useDb()
  const scoped = useScoped<Finding>()
  const ai = (projectId ? db.findings.filter((f) => f.projectId === projectId) : scoped(db.findings)).filter((f) => f.status === 'ai_suggested')
  if (!ai.length) return null
  return (
    <Banner tone="info" title={`Excluded from the formal report: ${ai.map((f) => f.id).join(', ')}`} action={<Button size="sm" onClick={() => go('finding', { id: ai[0].id })}>Open {ai[0].id}</Button>}>
      {ai.map((f) => f.id).join(', ')} {ai.length > 1 ? 'are' : 'is'} AI-suggested and not a verified finding. Only confirmed findings can be included, so a reviewer must confirm it in Findings before it can appear in a report.
    </Banner>
  )
}

/* ───────── version snapshots (ticket 36: canonical db state, service-owned) ───────── */

function DiffView({ sections, a, b, aLabel, bLabel, af, bf }: { sections: { id: string; title: string }[]; a: Record<string, string>; b: Record<string, string>; aLabel: string; bLabel: string; af: string[]; bf: string[] }) {
  const lines = (t = '') => t.split('\n').map((l) => l.trim()).filter(Boolean)
  const rows = sections.map((s) => { const x = lines(a[s.id]); const y = lines(b[s.id]); return { s, rem: x.filter((l) => !y.includes(l)), add: y.filter((l) => !x.includes(l)) } }).filter((x) => x.rem.length || x.add.length)
  const fAdd = bf.filter((i) => !af.includes(i)); const fRem = af.filter((i) => !bf.includes(i))
  if (!rows.length && !fAdd.length && !fRem.length) return <p className="text-sm text-muted">No differences between {aLabel} and {bLabel}.</p>
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">Comparing <Mono className="whitespace-nowrap">{aLabel}</Mono> (before) with <Mono className="whitespace-nowrap">{bLabel}</Mono> (after). {rows.length} section(s) changed.</p>
      {(fAdd.length > 0 || fRem.length > 0) && <div className="rounded-lg border border-line p-3 text-sm"><div className="mb-1 text-xs font-medium text-muted">Linked findings</div>{fAdd.map((i) => <div key={i} className="text-ok">+ {i}</div>)}{fRem.map((i) => <div key={i} className="text-bad">− {i}</div>)}</div>}
      {rows.map(({ s, rem, add }) => (
        <div key={s.id} className="rounded-lg border border-line p-3 text-sm">
          <div className="mb-1 text-xs font-medium text-muted">{s.title}</div>
          {rem.map((l, i) => <div key={'r' + i} className="whitespace-pre-wrap rounded bg-bad/10 px-2 py-0.5 text-bad">− {l}</div>)}
          {add.map((l, i) => <div key={'a' + i} className="mt-0.5 whitespace-pre-wrap rounded bg-ok/10 px-2 py-0.5 text-ok">+ {l}</div>)}
        </div>
      ))}
    </div>
  )
}

const CHK_TONE = { pass: 'text-ok', fail: 'text-bad', warn: 'text-warn' }
function CheckList({ checks }: { checks: RCheck[] }) {
  return (
    <ul className="space-y-3">
      {checks.map((c) => {
        const I = c.state === 'pass' ? CheckCircle2 : c.state === 'fail' ? XCircle : AlertTriangle
        return (
          <li key={c.id} className="flex items-start gap-2.5 text-sm">
            <I size={16} className={cx('mt-0.5 shrink-0', CHK_TONE[c.state])} aria-hidden />
            <div className="min-w-0">
              <div className="font-medium">{c.label} <span className={cx('text-xs font-normal', CHK_TONE[c.state])}>({c.state === 'pass' ? 'Pass' : c.state === 'fail' ? 'Blocks submit' : 'Warning'})</span></div>
              <div className="text-xs text-muted">{c.detail}</div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function ReportHead({ r, sub, actions, tab }: { r: Report; sub?: ReactNode; actions?: ReactNode; tab: 'edit' | 'preview' | 'review' }) {
  return (
    <PageHeader
      crumbs={[{ label: 'Reports', to: () => go('reports') }, { label: r.id }]}
      title={r.title}
      meta={<><Status kind="report" value={r.status} /><span className="rounded-md border border-line px-2 py-0.5 font-mono text-xs text-muted">{r.version}</span></>}
      sub={sub}
      actions={<>
        <Segmented value={tab} onChange={(v) => go(v === 'edit' ? 'report' : v === 'preview' ? 'report-preview' : 'report-review', { id: r.id })} options={[{ id: 'edit', label: 'Editor' }, { id: 'preview', label: 'Preview' }, { id: 'review', label: 'Review' }]} />
        {actions}
      </>}
    />
  )
}

/* ═════════════ RP-02 — Create report (ticket 34) ═════════════ */
/**
 * Draft creation on the typed report service. The options read carries the
 * project's findings with their reportability and the handler-computed
 * `editReport`/read-only gate (defense in depth: the create re-checks it).
 * A refused creation renders the failure and commits nothing; a successful
 * one navigates to the bridged editor through the store's router-backed
 * `go` (dirty cleared first — the unsaved guard must not hold the redirect).
 */
export function ReportNew() {
  const db = useDb()
  const pid = useProjectStore((s) => s.pid)
  const project = useActiveProject()
  const me = useMe()
  const toast = useToastStore((s) => s.toast)
  const setSwitcherOpen = useUiStore((s) => s.setSwitcherOpen)
  const persistFilters = useSessionStore((s) => s.persistFilters)
  const setFilter = useSessionStore((s) => s.setFilter)
  const setDirty = useSessionStore((s) => s.setDirty)
  const writes = useReportWrites()
  const opts = useDraftOptions(pid !== 'all')
  const preset = persistFilters.reportNewTemplate as string | undefined
  const [kind, setKind] = useState(project?.type || 'Red Team')
  const [tplName, setTplName] = useState(preset || '')
  const [title, setTitle] = useState('')
  const [reviewer, setReviewer] = useState('')
  const [from, setFrom] = useState(project?.start || '')
  const [to, setTo] = useState(project?.end || '')
  const rp = persistFilters['report-prefill'] as { projectId: string; findings: string[] } | undefined
  const [picked, setPicked] = useState<string[]>(rp && rp.projectId === project?.id ? rp.findings : [])
  const [src, setSrc] = useState({ obj: true, scope: true, ops: true, find: true, ev: true, cov: true })
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [nfc, setNfc] = useState(false)
  useEffect(() => { if (preset) setFilter('reportNewTemplate', undefined); if (rp) setFilter('report-prefill', undefined) }, [])// eslint-disable-line react-hooks/exhaustive-deps

  const o = opts.data
  const defTitle = project ? `${project.type} Report — ${project.client}` : ''
  const effTitle = title || defTitle
  const effTpl = tplName || o?.templates.find((t) => t.kind === (project?.type || 'Red Team') && t.status === 'published')?.name || o?.templates[0]?.name || ''
  const effReviewer = reviewer || project?.members.find((m) => m.role === 'reviewer')?.user || o?.reviewers[0] || ''
  const isDirty = !busy && (picked.length > 0 || (!!title && title !== defTitle))
  const draftNote = () => toast('This report has not been saved as a draft yet. Select "Create draft" to save it.', 'warn')
  useDirty(isDirty, draftNote)

  if (pid === 'all' || !project) {
    return (
      <>
        <PageHeader title="Create Report" back={{ label: 'Reports', to: () => go('reports') }} />
        <Banner tone="warn" title="Select a specific project" action={<Button size="sm" variant="primary" onClick={() => setSwitcherOpen(true)}>Select project</Button>}>
          "All projects" is an overview mode. A report always belongs to exactly one project, so it cannot be created here.
        </Banner>
      </>
    )
  }
  if (opts.isPending) {
    return (
      <>
        <PageHeader title="Create Report" back={{ label: 'Reports', to: () => go('reports') }} />
        <div aria-busy="true" aria-label="Loading report options"><Skeleton className="h-72" /></div>
      </>
    )
  }
  if (opts.isError || !o) {
    const failure = opts.error instanceof ReportReadError ? opts.error.failure : undefined
    return (
      <>
        <PageHeader title="Create Report" back={{ label: 'Reports', to: () => go('reports') }} />
        <Empty icon={FileText} title="Cannot load the draft form" action={<Button onClick={() => opts.refetch()}>Retry</Button>}>
          {failure?.message || 'The draft options are temporarily unavailable.'}
        </Empty>
      </>
    )
  }
  const locked = !o.canCreate
  const lockReason = o.createReason
  const fs = o.findings
  const tpl = o.templates.find((t) => t.name === effTpl)
  const errs = { title: !effTitle.trim() ? 'Enter a report title.' : '', tpl: !tpl ? 'Choose a template.' : '', reviewer: !effReviewer ? 'Choose a reviewer.' : effReviewer === me.name ? 'The reviewer cannot be the author.' : '' }
  const bad = !!(errs.title || errs.tpl || errs.reviewer)
  const unapproved = fs.filter((f) => picked.includes(f.id) && !f.reportable)
  const create = async () => {
    setTouched(true)
    setSaveErr(null)
    if (bad || locked || busy) return
    setBusy(true)
    const res = await writes.createDraft({ title: effTitle, template: effTpl, kind, reviewer: effReviewer, findings: picked, period: `${from} – ${to}` })
    setBusy(false)
    if (!res.ok) { setSaveErr(res.failure.message); return }
    const id = res.data.id
    if (nfc) setFilter('repNoFind', { ...((persistFilters.repNoFind || {}) as Record<string, NoFind>), [id]: { on: true, note: '' } })
    setDirty(false)
    toast(`Created draft report ${id}`)
    go('report', { id })
  }
  return (
    <>
      <PageHeader title="Create Report" sub="Step 1 of 2. Choose project, template, report type, title and author, then open the editor." back={{ label: 'Reports', to: () => go('reports') }} />
      {locked && <Banner tone="warn" title="Cannot create report">{lockReason}</Banner>}
      <AiExclusion projectId={project.id} />
      {!locked && fs.filter((f) => f.reportable).length === 0 && <Banner tone="info" title="No confirmed findings yet. You can still create a draft.">Saving a draft is always allowed. Submit for Review will need either a confirmed finding or a no-findings closure with a justification and completion evidence.</Banner>}
      {tpl && tpl.status !== 'published' && <Banner tone="warn" title="Template not approved">{tpl.name} is a draft template: you can try it, but formal delivery is blocked.</Banner>}
      {saveErr && <Banner tone="bad" title="Could not create the draft">{saveErr} Nothing was saved; the form keeps everything you entered.</Banner>}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Report details" />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Project" required hint="Fixed to the selected project."><Input value={`${project.id} — ${project.name}`} disabled readOnly /></Field>
              <Field label="Report type" required>
                <Select value={kind} onChange={(e) => setKind(e.target.value)} disabled={locked}>{['Red Team', 'Purple Team', 'Assessment'].map((k) => <option key={k}>{k}</option>)}</Select>
              </Field>
              <Field label="Title" required error={touched ? errs.title : ''} className="md:col-span-2"><Input value={effTitle} onChange={(e) => setTitle(e.target.value)} disabled={locked} placeholder="Example: Red Team Q4 Report — Northwind Bank (Demo)" /></Field>
              <Field label="Template" required error={touched ? errs.tpl : ''}>
                <Select value={effTpl} onChange={(e) => setTplName(e.target.value)} disabled={locked}>
                  {o.templates.map((t) => <option key={t.id} value={t.name}>{t.name}{t.status !== 'published' ? ' (draft)' : ''}</option>)}
                </Select>
              </Field>
              <Field label="Initial version"><Input value="v0.1" disabled readOnly /></Field>
              <Field label="Author"><Input value={me.name} disabled readOnly /></Field>
              <Field label="Reviewer" required error={touched ? errs.reviewer : ''}>
                <Select value={effReviewer} onChange={(e) => setReviewer(e.target.value)} disabled={locked}>{o.reviewers.map((u) => <option key={u}>{u}</option>)}</Select>
              </Field>
              <Field label="Reporting period — from"><Input value={from} onChange={(e) => setFrom(e.target.value)} disabled={locked} placeholder="Oct 1, 2026" /></Field>
              <Field label="Reporting period — to"><Input value={to} onChange={(e) => setTo(e.target.value)} disabled={locked} placeholder="Oct 1, 2026" /></Field>
            </div>
          </Card>
          <Card>
            <CardHeader title="Findings to include" sub={`Only findings from ${project.id} are listed. Unverified findings are locked.`} />
            {fs.length === 0 ? <Empty icon={FileText} title="No findings in this project">You can still create a draft and link findings later, but the report needs at least one verified finding before it can be submitted for review.</Empty> : (
              <ul className="divide-y divide-line/60 rounded-xl border border-line">
                {fs.map((f) => {
                  const ok = f.reportable
                  return (
                    <li key={f.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <Check checked={picked.includes(f.id)} disabled={!ok || locked} onChange={(v) => setPicked(v ? [...picked, f.id] : picked.filter((x) => x !== f.id))} label={<span className="font-mono text-[13px] text-accent">{f.id}</span>} />
                      <span className="min-w-0 flex-1 text-sm">{f.title}</span>
                      <Sev v={f.severity} /><Status kind="finding" value={f.status} size="sm" />
                      {!ok && <span className="basis-full pl-6 text-xs text-warn">{f.status === 'ai_suggested' ? 'AI-suggested, not a verified finding. Excluded from the formal report.' : `Not confirmed (${f.status === 'draft' ? 'draft' : f.status === 'review' ? 'in review' : 'returned'}). Only confirmed findings can be included in a report.`}</span>}
                    </li>
                  )
                })}
              </ul>
            )}
            {unapproved.length > 0 && <p className="mt-2 text-xs text-warn">The selection contains unverified content.</p>}
          </Card>
        </div>
        <div className="space-y-5">
          <Card>
            <CardHeader title="Source data" sub="Preview of the data that will be pulled into the draft." />
            <div className="space-y-3">
              {([
                ['obj', `Objectives (${project.objectives.length})`], ['scope', `Scope & ROE ${project.roeVersion}`], ['ops', `Operations (${db.operations.filter((x) => x.projectId === project.id).length})`],
                ['find', `Verified findings (${fs.filter((f) => f.reportable).length})`], ['ev', `Redacted evidence (${db.evidence.filter((x) => x.projectId === project.id).length})`], ['cov', 'Coverage charts'],
              ] as [keyof typeof src, string][]).map(([k, l]) => <div key={k}><Check checked={src[k]} onChange={(v) => setSrc({ ...src, [k]: v })} label={l} disabled={locked} /></div>)}
            </div>
            {fs.some((f) => !f.reportable) && <p className="mt-3 flex items-start gap-1.5 text-xs text-warn"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{fs.filter((f) => !f.reportable).length} finding(s) are not verified and will not be imported automatically.</p>}
          </Card>
          <Card>
            <div className="flex flex-col gap-2">
              <Check checked={nfc} onChange={setNfc} disabled={locked} label="Start as No-findings closure report" />
              <p className="-mt-1 text-xs text-muted">For assessments that found nothing confirmed. Needs a justification and completion evidence before review; no finding is ever invented.</p>
              <Button variant="primary" size="lg" icon={Plus} onClick={create} disabled={locked || busy} title={locked ? lockReason : undefined}>{busy ? 'Creating…' : 'Create Draft'}</Button>
              <Button variant="ghost" onClick={() => go('reports')}>Cancel</Button>
              {locked && <p className="text-xs text-muted">{lockReason}</p>}
            </div>
          </Card>
        </div>
      </div>
    </>
  )
}

/* ═════════════ RP-02 — Editor (ticket 35) ═════════════ */
/**
 * Shared read states for the migrated editor/preview/review screens: a
 * pending skeleton, a refused scope (a non-member's not-found without an
 * existence leak; a member scoped to another project gets a switch
 * affordance from the failure's entity ref), then the typed read model.
 */
function ReportReadGate<T>({ q, children }: { q: { isPending: boolean; isError: boolean; error: Error | null; data: T | undefined; refetch: () => void }; children: (d: T) => ReactNode }) {
  const setPid = useProjectStore((s) => s.setPid)
  if (q.isPending) return <div aria-busy="true" aria-label="Loading report"><Skeleton className="h-72" /></div>
  if (q.isError) {
    const failure = q.error instanceof ReportReadError ? q.error.failure : undefined
    const switchTo = failure?.entity?.projectId
    return (
      <Empty icon={FileText}
        title={failure?.kind === 'not-found' ? 'Report not found' : switchTo ? 'This report belongs to another project' : 'Cannot load the report'}
        action={switchTo
          ? <Button variant="primary" onClick={() => setPid(switchTo)}>Switch to project {switchTo}</Button>
          : failure?.kind === 'not-found'
            ? <Button onClick={() => go('reports')}>Back to reports</Button>
            : <Button onClick={() => q.refetch()}>Retry</Button>}>
        {failure?.message || 'The report is temporarily unavailable.'}
      </Empty>
    )
  }
  return <>{children(q.data!)}</>
}

export function ReportEditor() {
  const route = useRoute()
  const q = useReportEditor(route.id || '')
  return <ReportReadGate q={q}>{(d) => <EditorInner key={d.report.id} d={d} />}</ReportReadGate>
}

const SUGGEST = (title: string, client: string, roe: string) => `AI draft suggestion for "${title}": summarize the verified results for ${client} under ${roe}, state scope limits, and list recommended remediation. Edit and link a source before relying on it.`

/**
 * Editor on the typed read + writes (ticket 35). The report/project/gate come
 * from the service read; every section mutation (text autosave, add, remove,
 * reorder, linked findings) commits through the validated handlers and the
 * ChangeSet bridge refetches this read — a legacy action's report change
 * reaches the editor the same way. A refused write keeps the local draft and
 * renders the failure; navigation while dirty goes through the shared
 * unsaved-changes guard.
 */
function EditorInner({ d }: { d: ReportEditorRead }) {
  const db = useDb()
  const can = useCan()
  const toast = useToastStore((s) => s.toast)
  const confirm = useSessionStore((s) => s.confirm)
  const setDirty = useSessionStore((s) => s.setDirty)
  const writes = useReportWrites()
  const r = d.report
  const project = d.project
  const [nf, setNf] = useNoFind(r.id)
  const snaps = r.snapshots ?? []
  const [active, setActive] = useState(r.sections[0]?.id)
  /* Sparse draft store: only sections the user edited diverge from the server
     body, so a refetch (own write or a legacy report change) flows through to
     clean sections instead of being shadowed by mount-time copies. */
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [state, setState] = useState<'saved' | 'saving' | 'error'>('saved')
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [histOpen, setHistOpen] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [writing, setWriting] = useState(false)
  const editable = d.canEdit
  const lockMsg = d.editReason
  const dirtyIds = r.sections.filter((s) => (drafts[s.id] ?? s.body) !== s.body).map((s) => s.id)
  const dirty = dirtyIds.length > 0
  const saveAll = (onDone?: () => void) => {
    if (!editable || !dirtyIds.length) return
    setState('saving')
    setSaveErr(null)
    Promise.all(dirtyIds.map((id) => writes.saveSection(r.id, id, drafts[id] ?? ''))).then((results) => {
      const bad = results.find((x): x is Extract<ServiceResult<Report>, { ok: false }> => !x.ok)
      setState(bad ? 'error' : 'saved')
      setSaveErr(bad?.failure.message ?? null)
      if (!bad) onDone?.()
    })
  }
  useDirty(dirty && editable, () => saveAll())
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (!dirty || !editable) return
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => { saveAll() }, 1500)
    return () => window.clearTimeout(timer.current)
  }, [drafts]) // eslint-disable-line react-hooks/exhaustive-deps

  /** One structural write at a time; a refusal toasts the handler's reason. */
  const runWrite = (fn: () => Promise<ServiceResult<Report>>, onOk?: (rep: Report) => void) => {
    if (writing || !editable) return
    setWriting(true)
    fn().then((res) => {
      setWriting(false)
      if (!res.ok) toast(res.failure.message, 'bad')
      else onOk?.(res.data)
    })
  }
  const sections = r.sections
  const sec = sections.find((s) => s.id === active) || sections[0]
  const move = (id: string, dir: -1 | 1) => {
    const ids = sections.map((s) => s.id)
    const i = ids.indexOf(id); const j = i + dir
    if (j < 0 || j >= ids.length) return
    const n = [...ids]; [n[i], n[j]] = [n[j], n[i]]
    runWrite(() => writes.reorderSections(r.id, n))
  }
  const addSection = () => {
    if (!newTitle.trim()) return
    runWrite(() => writes.addSection(r.id, newTitle), (rep) => { setNewTitle(''); setActive(rep.sections[rep.sections.length - 1]?.id) })
  }
  const removeSection = (s: { id: string; title: string }) =>
    confirm({ title: `Remove section "${s.title}"?`, body: 'The section and its text are removed from this report. This cannot be undone.', confirmLabel: 'Remove section', danger: true, onConfirm: () => runWrite(() => writes.removeSection(r.id, s.id)) })
  const merged: Report = { ...r, sections: r.sections.map((s) => ({ ...s, body: drafts[s.id] ?? s.body })) }
  const checks = reportChecks(db, merged, nf)
  const blocking = checks.filter((c) => c.state === 'fail')
  const lastReturn = [...r.reviews].reverse().find((x) => x.action === 'Changes requested')
  const submitBlock = !editable ? (lockMsg || 'Cannot submit.') : blocking.length ? `Cannot submit yet: ${blocking.map((c) => c.label).join('; ')}.` : ''
  const fill = () => {
    const next = { ...drafts }
    r.sections.forEach((s) => { if (!(next[s.id] ?? s.body).trim()) next[s.id] = `${s.title}: simulated content for ${project.client} under ROE ${project.roeVersion}. Detailed figures and conclusions will be updated from the completed operations.` })
    setDrafts(next); toast('Filled empty sections with simulated content. Review it before submitting.', 'info')
  }
  const submit = () => {
    if (submitBlock) return
    if (dirty) saveAll()
    writes.submit(r.id, { bodies: Object.fromEntries(merged.sections.map((x) => [x.id, x.body])) }).then((res) => {
      if (!res.ok) { toast(res.failure.message, 'bad'); return }
      toast(r.status === 'returned' ? `Resubmitted ${r.id} as a new version for ${r.reviewer}` : `Submitted ${r.id} to ${r.reviewer} for review`)
      /* The submit committed the merged bodies, so the draft store realigns
         with the read and the dirty state is cleared before navigating —
         the unsaved-changes guard must not hold the post-submit redirect. */
      setDrafts({})
      setDirty(false)
      go('report-review', { id: r.id })
    })
  }
  const confirmedLinked = d.findings.filter((f) => f.reportable && f.linked)
  const insertFindings = () => insert('\n' + confirmedLinked.map((f) => `• ${f.id} (${sevLabel[f.severity]}) — ${f.title}. Asset ${f.asset}.`).join('\n'))
  const lastSnap = snaps[snaps.length - 1]
  const insert = (t: string) => { if (editable && sec) setDrafts({ ...drafts, [sec.id]: (drafts[sec.id] ?? sec.body ?? '') + t }) }
  const toggleF = (id: string, on: boolean) => {
    const next = on ? [...r.findings, id] : r.findings.filter((x) => x !== id)
    runWrite(() => writes.setFindings(r.id, next))
  }
  const empty = (b: string) => !b.trim()
  const returned = r.status === 'returned'
  const perm = can('editReport', r.projectId)

  return (
    <>
      <ReportHead r={r} tab="edit" sub={<>{project.id} · {r.template} · Author {r.author} · Reviewer {r.reviewer}</>}
        actions={<>
          <Button icon={History} onClick={() => setHistOpen(true)}>Version history</Button>
          <Button icon={Save} onClick={() => saveAll(() => toast('Draft saved'))} disabled={!editable || !dirty} title={!editable ? lockMsg : !dirty ? 'There are no unsaved changes' : undefined}>Save Draft</Button>
          <Button icon={Eye} onClick={() => go('report-preview', { id: r.id })}>Preview</Button>
          <Button variant="primary" icon={Send} onClick={submit} disabled={!!submitBlock} title={submitBlock || undefined}>{returned ? 'Resubmit for Review' : 'Submit for Review'}</Button>
        </>} />
      {submitBlock && editable && <p className="-mt-3 mb-4 flex items-center gap-1.5 text-xs text-muted"><Lock size={12} />{submitBlock} Fix the items marked "Blocks submit" in the checklist on the right.</p>}
      {!editable && lockMsg && <Banner tone="info" icon={Lock} title="Read-only" action={r.status === 'review' ? <Button size="sm" onClick={() => go('report-review', { id: r.id })}>Open review page</Button> : undefined}>{lockMsg}</Banner>}
      {returned && lastReturn && (
        <Banner tone="warn" title={`${lastReturn.by} returned this report with comments (${lastReturn.version}, ${lastReturn.at})`}>
          {lastReturn.note || 'No comment was left.'} Address the comments, then use Resubmit for Review to create the next version.
        </Banner>
      )}
      {returned && !perm && <PersonaHint need="Author" persona={r.author}>This report was returned. The author ({r.author}) must revise it and resubmit for review.</PersonaHint>}
      {state === 'error' && <Banner tone="bad" title="Could not save" action={<Button size="sm" onClick={() => saveAll()}>Retry</Button>}>{saveErr || 'The connection was lost during autosave. Your text is still on screen and has not been lost.'}</Banner>}
      <AiExclusion projectId={r.projectId} />
      {r.findings.length === 0 && !nf?.on && <Banner tone="warn" title="No confirmed findings linked. Saving drafts is still allowed.">Link confirmed findings in the right-hand panel, or switch the Report variant to No-findings closure if the assessment found nothing.</Banner>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr] xl:grid-cols-[240px_1fr_340px]">
        <Card pad={false} className="h-fit overflow-hidden">
          <div className="border-b border-line px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted">Outline</div>
          <ol className="max-h-[60vh] overflow-y-auto p-1.5">
            {sections.map((s, i) => (
              <li key={s.id} className="group flex items-center">
                <button onClick={() => setActive(s.id)} aria-current={sec?.id === s.id} className={cx('flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-lg px-3 text-left text-sm transition hover:bg-hover', sec?.id === s.id && 'bg-accent-soft font-medium text-fg')}>
                  <span className="w-5 shrink-0 text-xs text-neutral">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{s.title}</span>
                  {empty(drafts[s.id] ?? s.body) ? <span title="Empty section" className="inline-flex shrink-0 items-center gap-1 text-[11px] text-warn"><span className="h-2 w-2 rounded-full bg-warn" />Empty</span> : <CheckCircle2 size={13} className="shrink-0 text-ok" aria-label="Has content" />}
                </button>
                {editable && <span className="flex flex-col opacity-0 focus-within:opacity-100 group-hover:opacity-100">
                  <button aria-label={`Move ${s.title} up`} disabled={i === 0 || writing} onClick={() => move(s.id, -1)} className="px-1 text-[10px] leading-none text-muted hover:text-fg disabled:opacity-30">▲</button>
                  <button aria-label={`Move ${s.title} down`} disabled={i === sections.length - 1 || writing} onClick={() => move(s.id, 1)} className="px-1 text-[10px] leading-none text-muted hover:text-fg disabled:opacity-30">▼</button>
                </span>}
                {editable && sections.length > 1 && <button aria-label={`Remove ${s.title}`} disabled={writing} onClick={() => removeSection(s)} className="ml-1 shrink-0 rounded px-1 text-sm text-muted opacity-0 transition hover:text-bad focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-30" title={`Remove ${s.title}`}>×</button>}
              </li>
            ))}
          </ol>
          {editable && (
            <div className="flex gap-1.5 border-t border-line p-2">
              <Input aria-label="New section title" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addSection() }} placeholder="New section title" className="h-8 min-w-0 flex-1 text-xs" />
              <Button size="sm" icon={Plus} onClick={addSection} disabled={!newTitle.trim() || writing}>Add</Button>
            </div>
          )}
        </Card>

        <div className="min-w-0 xl:col-start-2">
          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[15px] font-semibold">{sec?.title}</h3>
              <span className={cx('inline-flex items-center gap-1.5 text-xs', state === 'error' ? 'text-bad' : dirty ? 'text-warn' : 'text-ok')} aria-live="polite">
                {state === 'error' ? <XCircle size={13} /> : dirty || state === 'saving' ? <RotateCcw size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                {state === 'error' ? 'Save failed' : dirty || state === 'saving' ? 'Autosaving…' : 'Autosaved'}
              </span>
            </div>
            {editable && (
              <div className="mb-3 flex flex-wrap gap-2">
                <Button size="sm" icon={ListChecks} onClick={() => insert('\n• Item 1\n• Item 2\n• Item 3')}>List</Button>
                <Button size="sm" icon={Table2} onClick={() => insert('\n| Column A | Column B |\n|----------|----------|\n| …        | …        |')}>Table</Button>
                <Button size="sm" icon={Wand2} onClick={() => insert(`\nScope: ${project.window}. ROE ${project.roeVersion}.`)}>Insert project info</Button>
                <Button size="sm" icon={Wand2} onClick={fill}>Fill empty sections with simulated text</Button>
                {/Findings/i.test(sec?.title || '') && <Button size="sm" icon={Plus} disabled={!confirmedLinked.length} title={confirmedLinked.length ? undefined : 'Link at least one confirmed finding first. AI-suggested and unconfirmed findings cannot be inserted.'} onClick={insertFindings}>Insert confirmed findings</Button>}
              </div>
            )}
            <Textarea
              aria-label={`Content of section ${sec?.title}`} value={drafts[sec?.id] ?? sec?.body ?? ''} readOnly={!editable} onChange={(e) => { setDrafts({ ...drafts, [sec.id]: e.target.value }); if (state === 'error') setState('saved') }}
              className="min-h-[340px] font-sans text-[15px] leading-7" placeholder={editable ? 'Write the section. Autosaves 1.5 seconds after you stop typing.' : 'This section has no content yet.'}
            />
            {(drafts[sec?.id] ?? '').includes('[AI draft') && <p className="mt-2 flex items-start gap-1.5 text-xs text-warn"><AlertTriangle size={13} className="mt-0.5 shrink-0" />AI draft — verify before approval. Lines marked [AI draft] are unverified until you edit them and cite a finding, event or evidence item.</p>}
            {/Findings|Results/i.test(sec?.title || '') && (
              <div className="mt-4 rounded-xl border border-line bg-bg p-4">
                <div className="mb-2 text-xs font-medium text-muted">Linked data (inserted automatically on export)</div>
                {r.findings.length === 0 ? <p className="text-sm text-muted">No linked findings yet.</p> : (
                  <ul className="space-y-2">{r.findings.map((id) => { const f = d.findings.find((x) => x.id === id); return f && <li key={id} className="flex flex-wrap items-center gap-2 text-sm"><Mono className="whitespace-nowrap text-accent">{f.id}</Mono><span className="flex-1">{f.title}</span><Sev v={f.severity} /></li> })}</ul>
                )}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4 lg:col-span-2 xl:col-span-1 xl:col-start-3 xl:row-start-1">
          <Card>
            <CardHeader title="Report info" />
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-muted">Project</dt><dd className="text-right">{project.id}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Client</dt><dd className="text-right">{project.client}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">ROE</dt><dd className="text-right font-mono text-[13px]">{project.roeVersion}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Template</dt><dd className="text-right">{r.template}</dd></div>
            </dl>
          </Card>
          <Card>
            <CardHeader title="Report variant" sub="Standard reports list confirmed findings." />
            <Segmented value={nf?.on ? 'nf' : 'std'} onChange={(v) => editable && setNf({ on: v === 'nf', note: nf?.note || '' })} options={[{ id: 'std', label: 'Standard' }, { id: 'nf', label: 'No-findings closure' }]} />
            {!editable && <p className="mt-2 text-xs text-muted">The variant can only change while the report is a draft or returned.</p>}
            {nf?.on && (() => { const ce = closureEvidence(db, r.projectId); return (
              <div className="mt-3 space-y-2 text-sm">
                <Field label="Closure justification" hint="Why nothing was confirmed. Required (20+ characters)."><Textarea className="min-h-20" value={nf.note} readOnly={!editable} onChange={(e) => setNf({ on: true, note: e.target.value })} /></Field>
                <ul className="space-y-1 text-xs">
                  <li className={ce.run.length ? 'text-ok' : 'text-bad'}>{ce.run.length ? '✓' : '✗'} {ce.run.length} operation(s) with recorded execution results</li>
                  <li className={ce.ev.length ? 'text-ok' : 'text-bad'}>{ce.ev.length ? '✓' : '✗'} {ce.ev.length} evidence item(s) or coverage observations</li>
                </ul>
                <p className="text-xs text-muted">Policy: a no-findings closure replaces findings with completion evidence and must be approved by the reviewer. No finding is created for it.</p>
              </div>) })()}
          </Card>
          {lastSnap && (
            <Card>
              <CardHeader title="Changes since last submitted version" sub={`Compared with ${lastSnap.version} (${lastSnap.at}).`} />
              <DiffView sections={sections} a={lastSnap.bodies} b={Object.fromEntries(sections.map((x) => [x.id, drafts[x.id] ?? x.body]))} aLabel={lastSnap.version} bLabel={r.status === 'returned' ? 'working draft' : r.version} af={lastSnap.findings} bf={r.findings} />
            </Card>
          )}
          <Card>
            <CardHeader title="Validation warnings" sub={blocking.length ? 'Resolve the "Blocks submit" items before submitting.' : 'Ready to submit for review.'} />
            <CheckList checks={checks} />
          </Card>
          <Card>
            <CardHeader title="Sources: linked findings" sub={`${r.findings.length}/${d.findings.length} findings from ${r.projectId}`} />
            {d.findings.length === 0 ? <p className="text-sm text-muted">This project has no findings.</p> : (
              <ul className="space-y-3">
                {d.findings.map((f) => {
                  const ok = f.reportable
                  return (
                    <li key={f.id} className="text-sm">
                      <Check checked={f.linked} disabled={!editable || (!ok && !f.linked)} onChange={(v) => toggleF(f.id, v)} label={<span><Mono className="whitespace-nowrap text-accent">{f.id}</Mono> <span className="text-muted">{sevLabel[f.severity]}</span></span>} />
                      <div className="ml-6 text-xs text-muted">{f.title}</div>
                      {!ok && <div className="ml-6 text-xs text-warn">{f.status === 'ai_suggested' ? 'AI-suggested, not a verified finding. Excluded from the formal report.' : 'Not confirmed. It cannot be included in a report.'}</div>}
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="AI writing suggestion" sub="AI draft — verify before approval" />
            <p className="rounded-lg border border-dashed border-line bg-bg p-3 text-sm text-muted">{SUGGEST(sec?.title || 'section', project.client, project.roeVersion)}</p>
            <p className="mt-2 flex items-start gap-1.5 text-xs text-muted"><AlertTriangle size={13} className="mt-0.5 shrink-0 text-warn" />AI-written claims are not verified results unless they link to a source finding, event or evidence item.</p>
            <Button className="mt-2" size="sm" icon={Wand2} disabled={!editable} title={editable ? undefined : lockMsg} onClick={() => insert(`\n[AI draft — verify before approval] ${sec?.title}: summary pending source linkage. Source: cite a finding or evidence ID.`)}>Insert as marked draft</Button>
          </Card>
          <Card>
            <CardHeader title="Reviewer comments" />
            {r.reviews.filter((x) => x.note).length === 0 ? <p className="text-sm text-muted">No comments yet.</p> : (
              <ul className="space-y-3 text-sm">{r.reviews.filter((x) => x.note).map((x, i) => <li key={i} className="rounded-lg border border-line bg-bg p-3"><div className="text-xs text-muted">{x.by} · {x.version} · {x.at}</div><div className="mt-1">{x.note}</div></li>)}</ul>
            )}
          </Card>
        </div>
      </div>

      <Drawer open={histOpen} onClose={() => setHistOpen(false)} title="Version history">
        <p className="mb-4 text-xs text-muted">Current version <Mono className="whitespace-nowrap">{r.version}</Mono>. Returned rounds are kept and never deleted.</p>
        {r.reviews.length === 0 ? <Empty title="No history yet">This report has not been submitted for review.</Empty> : (
          <Timeline items={[...r.reviews].reverse().map((x) => ({ at: `${x.at} · ${x.version}`, title: `${x.action} — ${x.by}`, sub: x.note || undefined, tone: x.action === 'Approved' ? 'ok' : x.action === 'Changes requested' ? 'bad' : 'accent' }))} />
        )}
      </Drawer>
    </>
  )
}

/* ═════════════ RP-03 — Preview (ticket 35) ═════════════ */
/**
 * Read-only preview on the typed editor/preview read: it renders the
 * composed report exactly as committed (sections in stored order, linked
 * findings with redaction markers). No editing, no preview checksum feature;
 * submit/export stay with the review/delivery owner.
 */
export function ReportPreview() {
  const route = useRoute()
  const q = useReportEditor(route.id || '')
  return <ReportReadGate q={q}>{(d) => <PreviewInner key={d.report.id} d={d} />}</ReportReadGate>
}

function PreviewInner({ d }: { d: ReportEditorRead }) {
  const db = useDb()
  const me = useMe()
  const can = useCan()
  const toast = useToastStore((s) => s.toast)
  const writes = useReportWrites()
  const g = useGuard(d.report.projectId)
  const r = d.report
  const project = d.project
  const [zoom, setZoom] = useState<'80' | '100' | '120'>('100')
  const [mode, setMode] = useState<'desktop' | 'pdf'>('desktop')
  const [pg, setPg] = useState(1)
  const [nf] = useNoFind(r.id)
  const checks = reportChecks(db, r, nf)
  const blocking = checks.filter((c) => c.state === 'fail')
  const finalOk = ['approved', 'exported', 'delivered'].includes(r.status)
  const canExport = finalOk && r.status !== 'delivered' && me.role !== 'viewer' && me.role !== 'operator' && !g.ro
  const exportWhy = !finalOk ? 'Export is available only after the report is approved. Submit it for review first.' : r.status === 'delivered' ? 'This report is already delivered. Create a new version to export changes.' : me.role === 'viewer' || me.role === 'operator' ? 'Your role cannot export reports. Ask a Manager or Reviewer.' : g.reason
  const linked = d.linked
  const canSubmit = (r.status === 'draft' || r.status === 'returned') && can('editReport', r.projectId) && !g.ro
  const submitWhy = !canSubmit ? 'Only the author can submit, and only while the report is a draft or returned.' : blocking.length ? `Not ready: ${blocking.map((c) => c.label).join('; ')}.` : ''
  const pages: { key: string; title: string; node: ReactNode }[] = [
    { key: 'cover', title: 'Cover page', node: (
      <div className="flex min-h-[560px] flex-col justify-between">
        <div><div className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">Raptix · {project.type}</div><h1 className="mt-10 text-3xl font-bold leading-tight text-slate-900">{r.title}</h1><p className="mt-3 text-slate-600">{r.sections[0]?.body || <Missing>The cover page has no content</Missing>}</p></div>
        <dl className="grid grid-cols-2 gap-y-2 text-sm text-slate-700"><dt className="text-slate-500">Client</dt><dd>{project.client}</dd><dt className="text-slate-500">Project</dt><dd>{project.id}</dd><dt className="text-slate-500">Version</dt><dd>{r.version}</dd><dt className="text-slate-500">Author</dt><dd>{r.author}</dd><dt className="text-slate-500">Last updated</dt><dd>{r.updated}</dd><dt className="text-slate-500">Classification</dt><dd>Confidential (synthetic data)</dd></dl>
      </div>) },
    { key: 'toc', title: 'Table of contents', node: (
      <div><h2 className="mb-4 text-xl font-bold text-slate-900">Table of contents</h2><ol className="space-y-2 text-sm text-slate-700">{r.sections.slice(1).map((s, i) => <li key={s.id} className="flex items-baseline gap-2"><span>{i + 1}. {s.title}</span><span className="flex-1 border-b border-dotted border-slate-300" /><span>{i + 3}</span></li>)}</ol></div>) },
    ...r.sections.slice(1).map((s) => ({ key: s.id, title: s.title, node: (
      <div>
        <h2 className="mb-3 text-xl font-bold text-slate-900">{s.title}</h2>
        {s.body.trim() ? <p className="whitespace-pre-wrap text-sm leading-7 text-slate-800">{s.body}</p> : <Missing>Missing field: this section has no content. Add it in the editor.</Missing>}
        {/Findings|Results/i.test(s.title) && (
          <div className="mt-5">
            {linked.length === 0 ? <Missing>Missing data: no linked findings.</Missing> : (
              <div className="overflow-x-auto"><table className="w-full min-w-[480px] border-collapse text-xs text-slate-800">
                <thead><tr className="bg-slate-100 text-left"><th className="border border-slate-300 p-2">ID</th><th className="border border-slate-300 p-2">Finding</th><th className="border border-slate-300 p-2">Severity</th><th className="border border-slate-300 p-2">Asset</th><th className="border border-slate-300 p-2">Evidence</th></tr></thead>
                <tbody>{linked.map((f) => <tr key={f.id}><td className="border border-slate-300 p-2 font-mono">{f.id}</td><td className="border border-slate-300 p-2">{f.title}</td><td className="border border-slate-300 p-2">{sevLabel[f.severity]}</td><td className="border border-slate-300 p-2">{f.asset}</td><td className="border border-slate-300 p-2">{f.evidence.length ? f.evidence.map((e) => `${e.ref}${e.sensitive ? ' [redacted]' : ''}`).join(', ') : 'None'}</td></tr>)}</tbody>
              </table></div>
            )}
          </div>
        )}
      </div>) })),
  ]
  const N = pages.length
  const missing = r.sections.filter((s) => !s.body.trim()).length
  const jump = (n: number) => { const k = Math.min(N, Math.max(1, n)); setPg(k); document.getElementById('pg-' + k)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
  const watermark = finalOk ? '' : r.status === 'review' ? 'IN REVIEW' : 'DRAFT'
  return (
    <>
      <ReportHead r={r} tab="preview" sub="Print-style preview. Export and delivery are separate steps after approval."
        actions={<>
          <Button icon={ArrowLeft} onClick={() => go('report', { id: r.id })}>Back to editor</Button>
          {(r.status === 'draft' || r.status === 'returned') && <Button icon={Send} variant="primary" disabled={!!submitWhy} title={submitWhy || undefined} onClick={() => { writes.submit(r.id, { bodies: Object.fromEntries(r.sections.map((x) => [x.id, x.body])) }).then((res) => { if (!res.ok) toast(res.failure.message, 'bad'); else { toast(`Submitted ${r.id} for review`); go('report-review', { id: r.id }) } }) }}>{r.status === 'returned' ? 'Resubmit for Review' : 'Submit for Review'}</Button>}
        </>} />
      <AiExclusion projectId={r.projectId} />
      {missing > 0 && <Banner tone="warn" title={`${missing} section(s) are missing content`}>Missing fields are highlighted in the pages below.</Banner>}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Segmented value={mode} onChange={setMode} options={[{ id: 'desktop', label: 'Desktop preview' }, { id: 'pdf', label: 'PDF preview' }]} />
            <Segmented value={zoom} onChange={setZoom} options={[{ id: '80', label: '80%' }, { id: '100', label: '100%' }, { id: '120', label: '120%' }]} />
            <Button size="sm" onClick={() => jump(pg - 1)} disabled={pg <= 1}>Previous page</Button>
            <span className="text-xs text-muted">Page {pg} of {N}</span>
            <Button size="sm" onClick={() => jump(pg + 1)} disabled={pg >= N}>Next page</Button>
            <Select aria-label="Jump to section" className="w-48" value="" onChange={(e) => { if (e.target.value) jump(Number(e.target.value)) }}><option value="">Jump to section…</option>{pages.map((p, i) => <option key={p.key} value={i + 1}>{i + 1}. {p.title}</option>)}</Select>
          </div>
          {/* Print simulation: the paper and its desk stay light in both
              themes (data-paper marks the intentional fixed-light surface). */}
          <div data-paper className={cx('max-h-[78vh] overflow-auto rounded-xl border border-line p-4 sm:p-6', mode === 'pdf' ? 'bg-slate-300/60' : 'bg-hover/40')}>
            <div className="mx-auto space-y-6" style={{ width: 'min(100%, 760px)', zoom: Number(zoom) / 100 }}>
              {pages.map((p, i) => (
                <section key={p.key} id={'pg-' + (i + 1)} aria-label={`Page ${i + 1}: ${p.title}`} onMouseEnter={() => setPg(i + 1)} className="relative overflow-hidden rounded-sm bg-white p-8 text-slate-900 shadow-lg sm:p-12" style={{ minHeight: 620 }}>
                  {watermark && <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center"><span className="-rotate-30 select-none text-6xl font-black tracking-widest text-slate-300/50">{watermark}</span></div>}
                  <div className="relative">{p.node}</div>
                  <div className="absolute inset-x-8 bottom-4 flex justify-between border-t border-slate-200 pt-2 text-[10px] text-slate-500 sm:inset-x-12"><span>Raptix · {r.id} · {r.version} · {finalOk ? 'Approved' : 'Not approved'}</span><span>Page {i + 1} of {N}</span></div>
                </section>
              ))}
            </div>
          </div>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Export" sub="Exporting PDF or DOCX only creates a file. It does not deliver the report to the client." />
            <div className="flex flex-wrap gap-2">
              <Button icon={Download} variant="primary" disabled={!canExport} title={canExport ? undefined : exportWhy} onClick={() => { writes.exportVersion(r.id, 'PDF').then((res) => { if (!res.ok) toast(res.failure.message, 'bad'); else toast('PDF exported. Not delivered yet; go to the review page to mark delivery.') }) }}>Export PDF</Button>
              <Button icon={Download} disabled={!canExport} title={canExport ? undefined : exportWhy} onClick={() => { writes.exportVersion(r.id, 'DOCX').then((res) => { if (!res.ok) toast(res.failure.message, 'bad'); else toast('DOCX exported. Not delivered yet.') }) }}>Export DOCX</Button>
              <Button icon={Eye} disabled={me.role === 'viewer'} title={me.role === 'viewer' ? 'The Client / Viewer role cannot create trial exports' : 'Trial copy with watermark; not recorded in export history'} onClick={() => toast('Created a watermarked "DRAFT" trial copy (not saved to export history).', 'info')}>Trial export</Button>
            </div>
            {!canExport && <p className="mt-3 flex items-start gap-1.5 text-xs text-muted"><Lock size={13} className="mt-0.5 shrink-0" />{exportWhy}</p>}
            {r.status === 'approved' || r.status === 'exported' ? <Button className="mt-3" size="sm" icon={ShieldCheck} onClick={() => go('report-review', { id: r.id })}>Go to delivery step</Button> : null}
            {!finalOk && <Button className="mt-3" size="sm" onClick={() => go(r.status === 'review' ? 'report-review' : 'report', { id: r.id })}>{r.status === 'review' ? 'Open review page' : 'Go to editor'}</Button>}
          </Card>
          <Card>
            <CardHeader title="Content checks" />
            <CheckList checks={checks} />
          </Card>
        </div>
      </div>
    </>
  )
}
const Missing = ({ children }: { children: ReactNode }) => <div className="rounded border border-dashed border-amber-500 bg-amber-50 px-3 py-2 text-xs text-amber-800">{children}</div>

/* ═════════════ RP-04..06 — Review / approval / export / delivery (ticket 36) ═════════════ */
/**
 * Review on the typed read + writes. The handler owns the four-eyes policy
 * (the author can never decide their own report), the reviewer-role gate and
 * the mandatory decision comments; export and delivery are separate gated
 * steps whose records land in the canonical export/delivery history. A
 * refused write renders the handler's reason and commits nothing.
 */
export function ReportReview() {
  const route = useRoute()
  const [nf] = useNoFind(route.id || '')
  const q = useReportReview(route.id || '', nf)
  return <ReportReadGate q={q}>{(d) => <ReviewInner key={d.report.id} d={d} />}</ReportReadGate>
}

function ReviewInner({ d }: { d: ReportReviewRead }) {
  const toast = useToastStore((s) => s.toast)
  const confirm = useSessionStore((s) => s.confirm)
  const writes = useReportWrites()
  const r = d.report
  const project = d.project
  const [nf] = useNoFind(r.id)
  const snaps = r.snapshots ?? []
  const [cmpVer, setCmpVer] = useState('')
  const checks = d.checks
  const blocking = checks.filter((c) => c.state === 'fail')
  const exps = d.exports
  const [recipient, setRecipient] = useState(project.client)
  const [channel, setChannel] = useState('Secure portal')
  const [notes, setNotes] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const linked = d.linked
  const evs = linked.flatMap((f) => f.evidence)
  const sensitive = evs.filter((e) => e.sensitive).length

  const approveWhy = d.gates.decide.reason || (blocking.length ? `Cannot approve: ${blocking.map((c) => c.label).join('; ')}.` : '')
  const returnWhy = d.gates.decide.reason
  const exportWhy = d.gates.export.reason
  const deliverWhy = d.gates.deliver.reason || (!recipient.trim() ? 'Enter the recipient.' : !confirmed ? 'Confirm that the handover happened before marking delivery.' : '')

  const reqs = r.reviews.map((x, i) => ({ x, i })).filter((o) => o.x.action === 'Submitted for review').map(({ x, i }) => {
    const dec = r.reviews.slice(i + 1).find((y) => y.action !== 'Submitted for review')
    return { ver: x.version, by: x.by, at: x.at, decision: dec, status: dec ? (dec.action === 'Approved' ? 'approved' : 'returned') : 'pending', open: dec?.action === 'Changes requested' ? 1 : 0 }
  })

  /** One review write at a time; a refusal renders the handler's reason. */
  const runWrite = (fn: () => Promise<ServiceResult<Report>>, onOk: () => void) =>
    fn().then((res) => {
      if (!res.ok) { setErr(res.failure.message); return }
      setErr('')
      onOk()
    })
  const approve = () => confirm({ title: `Approve ${r.id} (${r.version})?`, body: 'Approval only unlocks export. Exporting PDF/DOCX and marking delivery are separate steps that follow.', confirmLabel: 'Approve Report', reasonLabel: 'Approval reasoning (recorded with the pinned version)', reasonRequired: true, onConfirm: (note) => runWrite(() => writes.decide(r.id, 'approve', note), () => toast(`Approved ${r.id} ${r.version}. Not exported or delivered yet.`)) })
  const ret = () => confirm({ title: `Return ${r.id} with comments`, body: 'The report goes back to its author. Your comment is saved in the review history and is never deleted.', confirmLabel: 'Return with Comments', danger: true, reasonLabel: 'Comments for the author', reasonRequired: true, onConfirm: (note) => runWrite(() => writes.decide(r.id, 'return', note), () => { toast(`Returned ${r.id} to ${r.author}`, 'warn'); go('report', { id: r.id }) }) })
  const doExport = (f: 'PDF' | 'DOCX') => runWrite(() => writes.exportVersion(r.id, f).then((res) => (res.ok ? { ok: true as const, data: res.data.report } : res)), () => toast(`Exported ${f} for ${r.version}. Not delivered yet.`))
  const deliver = () => runWrite(() => writes.deliver(r.id, { recipient: recipient.trim(), channel, notes, confirm: confirmed }), () => toast(`Marked ${r.id} as delivered to ${recipient.trim()}`))

  return (
    <>
      <ReportHead r={r} tab="review" sub={<>{project.id} · Author {r.author} · Reviewer {r.reviewer} · ROE {project.roeVersion}</>} />
      <div className="mb-4">
        <Stepper steps={['In Review', 'Approved', 'Exported', 'Delivered']} current={({ review: 0, approved: 1, exported: 2, delivered: 4 } as Record<string, number>)[r.status] ?? -1} />
        <p className="-mt-3 text-xs text-muted">{['draft', 'returned'].includes(r.status) ? `Not in the review chain yet: this report is ${r.status === 'draft' ? 'a draft' : 'returned to its author'}.` : 'Four separate stages: a decision on content, a file export, a delivery record, then recipient acknowledgement. Each step is audited.'}</p>
      </div>
      <AiExclusion projectId={r.projectId} />
      {nf?.on && <Banner tone="info" title="No-findings closure variant">This report closes the assessment without findings. Justification: {nf.note || 'not provided'}. The reviewer approves the closure based on the completion evidence.</Banner>}
      {r.status === 'draft' && <Banner tone="info" title="This report has not been submitted for review" action={<Button size="sm" onClick={() => go('report', { id: r.id })}>Open editor</Button>}>The author must finish the draft and select Submit for Review.</Banner>}
      {r.status === 'returned' && <Banner tone="warn" title="Returned with comments" action={<Button size="sm" variant="primary" onClick={() => go('report', { id: r.id })}>Revise and resubmit</Button>}>{[...r.reviews].reverse().find((x) => x.action === 'Changes requested')?.note || ''} The author ({r.author}) revises and resubmits as a new version. This round stays in the history.</Banner>}
      {r.status === 'review' && !d.gates.decide.allowed && <PersonaHint need="Reviewer" persona={r.reviewer}>{d.gates.decide.reason}</PersonaHint>}
      {r.status === 'delivered' && <Banner tone="ok" title="Report delivered">Delivered on {r.deliveredAt}. Version {r.version} is locked and read-only; edits create a new version and earlier exports are kept.</Banner>}
      {['approved', 'exported'].includes(r.status) && <Banner tone="info" title={`Version ${r.version} is locked`}>Approved content cannot be edited. {r.reviews.some((x) => x.action === 'Changes requested') ? 'Earlier returned rounds remain in the history.' : ''}</Banner>}
      {err && <Banner tone="bad" title="The action was refused" action={<Button size="sm" onClick={() => setErr('')}>Dismiss</Button>}>{err}</Banner>}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader title="Review requests" sub="Each submission is one row. Returned rounds are kept." />
            <Table dense rowKey={(x) => x.ver + x.at} rows={reqs} empty={<p className="text-sm text-muted">No review requests yet.</p>} cols={[
              { key: 'v', header: 'Version', render: (x) => <Mono className="whitespace-nowrap">{x.ver}</Mono> },
              { key: 'by', header: 'Requested by', render: (x) => x.by },
              { key: 'rv', header: 'Reviewer', render: () => r.reviewer },
              { key: 'due', header: 'Due', render: () => 'Oct 16, 2026' },
              { key: 'st', header: 'Status', render: (x) => <Status kind="approval" value={x.status} /> },
              { key: 'cm', header: 'Open comments', render: (x) => x.open },
            ]} />
          </Card>
          <Card>
            <CardHeader title="Report content" sub="The reviewer reads each section before deciding." actions={<Button size="sm" icon={Eye} onClick={() => go('report-preview', { id: r.id })}>Page preview</Button>} />
            <ul className="divide-y divide-line/60 rounded-xl border border-line">
              {r.sections.map((s) => (
                <li key={s.id}>
                  <button className="flex min-h-12 w-full items-center gap-3 px-4 text-left text-sm hover:bg-hover" aria-expanded={open === s.id} onClick={() => setOpen(open === s.id ? null : s.id)}>
                    <span className="flex-1 font-medium">{s.title}</span>
                    {s.body.trim() ? <span className="inline-flex items-center gap-1 text-xs text-ok"><CheckCircle2 size={12} />Has content</span> : <span className="inline-flex items-center gap-1 text-xs text-warn"><AlertTriangle size={12} />Empty</span>}
                  </button>
                  {open === s.id && <div className="border-t border-line/60 bg-bg px-4 py-3 text-sm leading-6">{s.body.trim() ? <p className="whitespace-pre-wrap">{s.body}</p> : <p className="text-muted">This section has no content.</p>}</div>}
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Findings in this report" />
            <Table dense rowKey={(f) => f.id} rows={linked} onRow={(f) => go('finding', { id: f.id })} empty={<Empty icon={FileText} title="No findings">This report links no findings, so it cannot be approved.</Empty>} cols={[
              { key: 'id', header: 'ID', render: (f) => <Mono className="whitespace-nowrap text-accent">{f.id}</Mono> },
              { key: 't', header: 'Finding', render: (f) => f.title },
              { key: 's', header: 'Severity', render: (f) => <Sev v={f.severity} /> },
              { key: 'st', header: 'Status', render: (f) => <Status kind="finding" value={f.status} /> },
              { key: 'ev', header: 'Evidence', render: (f) => f.evidence.length || 'None' },
            ]} />
          </Card>
          <Card>
            <CardHeader title="Version diff" sub="What changed between submitted versions." />
            {snaps.length < 2 ? <p className="text-sm text-muted">{snaps.length === 0 ? 'No version snapshot is available for this report yet.' : `Only ${snaps[0].version} has been submitted, so there is nothing to compare yet.`} After a return and resubmission, the changes appear here.</p> : (() => {
              const base = snaps.find((x) => x.version === cmpVer) || snaps[snaps.length - 2]; const cur = snaps[snaps.length - 1]
              return <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs"><span className="text-muted">Compare against</span><Select aria-label="Compare against version" className="w-32" value={base.version} onChange={(e) => setCmpVer(e.target.value)}>{snaps.slice(0, -1).map((x) => <option key={x.version}>{x.version}</option>)}</Select><span className="text-muted">with <Mono className="whitespace-nowrap">{cur.version}</Mono></span></div>
                <DiffView sections={r.sections} a={base.bodies} b={cur.bodies} aLabel={base.version} bLabel={cur.version} af={base.findings} bf={cur.findings} />
                {[...r.reviews].reverse().find((x) => x.action === 'Changes requested') && <p className="rounded-lg border border-line bg-bg p-3 text-xs"><span className="font-medium">Reviewer comment that triggered this revision:</span> {[...r.reviews].reverse().find((x) => x.action === 'Changes requested')?.note}</p>}
              </div>
            })()}
          </Card>
          <Card>
            <CardHeader title="Review history" sub="Sign-off trail across versions." />
            {r.reviews.length === 0 ? <p className="text-sm text-muted">No history yet.</p> : <Timeline items={[...r.reviews].reverse().map((x) => ({ at: `${x.at} · ${x.version}`, title: `${x.action} — ${x.by}`, sub: x.note || undefined, tone: x.action === 'Approved' ? 'ok' : x.action === 'Changes requested' ? 'bad' : 'accent' }))} />}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Reviewer checklist" />
            <CheckList checks={[
              ...checks.filter((c) => c.id !== 'tpl'),
              { id: 'sens', label: 'Sensitive evidence is redacted', state: 'pass', detail: evs.length ? `${evs.length} evidence item(s), ${sensitive} redacted.` : 'No evidence attached.' },
              { id: 'roe', label: 'Referenced ROE version', state: project.roeStatus === 'approved' ? 'pass' : 'warn', detail: `${project.roeVersion} (${project.roeStatus === 'approved' ? 'approved' : 'not approved'})` },
              { id: 'brand', label: 'Client and branding', state: 'pass', detail: `${project.client} · ${r.template}` },
              checks.find((c) => c.id === 'tpl')!,
            ]} />
          </Card>

          <Card>
            <CardHeader title="1. Review decision" sub="Decides the content. Does not export or deliver automatically." />
            <div className="flex flex-col gap-2">
              <Button variant="primary" icon={ShieldCheck} disabled={!!approveWhy} title={approveWhy || undefined} onClick={approve}>Approve Report</Button>
              <Button variant="danger" icon={RotateCcw} disabled={!!returnWhy} title={returnWhy || undefined} onClick={ret}>Return with Comments</Button>
              <Button variant="ghost" size="sm" icon={History} onClick={() => go('report-preview', { id: r.id })}>View Changes in preview</Button>
              {(approveWhy || returnWhy) && <p className="flex items-start gap-1.5 text-xs text-muted"><Lock size={13} className="mt-0.5 shrink-0" />{approveWhy || returnWhy}</p>}
              {['approved', 'exported', 'delivered'].includes(r.status) && <p className="flex items-center gap-1.5 text-xs text-ok"><CheckCircle2 size={13} />Version {r.version} approved.</p>}
            </div>
          </Card>

          <Card>
            <CardHeader title="2. Export" sub="Creates a PDF or DOCX with a checksum. Export is not delivery." />
            <div className="flex flex-wrap gap-2">
              <Button icon={Download} disabled={!!exportWhy} title={exportWhy || undefined} onClick={() => doExport('PDF')}>Export PDF</Button>
              <Button icon={Download} disabled={!!exportWhy} title={exportWhy || undefined} onClick={() => doExport('DOCX')}>Export DOCX</Button>
            </div>
            {exportWhy && <p className="mt-2 flex items-start gap-1.5 text-xs text-muted"><Lock size={13} className="mt-0.5 shrink-0" />{exportWhy}</p>}
            {exps.length > 0 && (
              <ul className="mt-3 space-y-2">{exps.map((e) => <li key={e.id} className="rounded-lg border border-line bg-bg p-2.5 text-xs"><div className="flex justify-between"><Mono className="whitespace-nowrap">{e.id} · {e.version} · {e.format}{e.version === r.version && ['approved', 'exported', 'delivered'].includes(r.status) ? ' · approved version' : ''}</Mono><span className={e.status === 'Delivered' ? 'font-medium text-ok' : 'text-muted'}>{e.status}</span></div><div className="mt-1 break-all font-mono text-neutral">{e.checksum}</div><div className="text-muted">{e.by} · {e.at}</div></li>)}</ul>
            )}
          </Card>

          <Card>
            <CardHeader title="3. Delivery / handover" sub="Record who received this locked version." />
            <div className="space-y-3">
              <Field label="Recipient" required><Input value={recipient} onChange={(e) => setRecipient(e.target.value)} disabled={r.status === 'delivered'} /></Field>
              <Field label="Delivery channel" hint="Abstracted; no real transfer happens."><Select value={channel} onChange={(e) => setChannel(e.target.value)} disabled={r.status === 'delivered'}><option>Secure portal</option><option>Encrypted email</option><option>In-person handover</option></Select></Field>
              <Field label="Message / notes"><Textarea className="min-h-16" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={r.status === 'delivered'} /></Field>
              <Check checked={confirmed || r.status === 'delivered'} onChange={setConfirmed} disabled={r.status === 'delivered' || !['approved', 'exported'].includes(r.status)} label="Handover to the recipient is confirmed" />
            </div>
            <Button className="mt-3 w-full" icon={Send} variant="primary" disabled={!!deliverWhy} title={deliverWhy || undefined} onClick={deliver}>Mark as Delivered</Button>
            {deliverWhy && r.status !== 'delivered' && <p className="mt-2 flex items-start gap-1.5 text-xs text-muted"><Lock size={13} className="mt-0.5 shrink-0" />{deliverWhy}</p>}
            {r.status === 'delivered' && (() => {
              const ex = exps.find((e) => e.status === 'Delivered')
              return (
                <div className="mt-3 space-y-1.5 rounded-lg border border-ok/30 bg-ok/5 p-3 text-xs">
                  <div className="font-medium text-ok">Delivery record</div>
                  <div className="flex justify-between gap-3"><span className="text-muted">Recipient</span><span>{ex?.recipient || '—'}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-muted">Method</span><span>{ex?.channel || 'Secure portal'}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-muted">Delivered</span><span className="whitespace-nowrap">{ex?.deliveredAt || r.deliveredAt}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-muted">Delivered by</span><span>{ex?.deliveredBy || '—'}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-muted">Version</span><Mono className="whitespace-nowrap">{ex?.version || r.version}</Mono></div>
                  <div className="flex justify-between gap-3"><span className="text-muted">Acknowledgement</span><span className={ex?.ackAt ? 'text-ok' : 'text-warn'}>{ex?.ackAt ? `Receipt acknowledged ${ex.ackAt}` : 'Awaiting recipient acknowledgement'}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-muted">Audit event</span><Mono className="whitespace-nowrap">{d.deliveryAuditId || 'AU-archived'} (immutable)</Mono></div>
                  {ex && !ex.ackAt && <Button size="sm" icon={CheckCircle2} disabled={!d.gates.ack.allowed} title={d.gates.ack.reason || undefined} onClick={() => writes.acknowledge(r.id).then((res) => { if (res.ok) toast('Recipient acknowledgement recorded'); else toast(res.failure.message, 'bad') })}>Record recipient acknowledgement</Button>}
                </div>
              )
            })()}
            <Button className="mt-2 w-full" variant="ghost" size="sm" icon={FileText} onClick={() => { go('reports', { tab: 'exports' }) }}>View delivery history</Button>
          </Card>
        </div>
      </div>
    </>
  )
}
