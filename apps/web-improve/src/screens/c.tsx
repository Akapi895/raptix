import { useEffect, useMemo, useState, type ComponentType } from 'react'
import { AlertTriangle, ArrowRight, GitBranch, MessageSquare, CalendarClock, CheckCircle2, ClipboardCheck, Lock, Play, Plus, Radio, RefreshCw, ShieldAlert, SlidersHorizontal, ShieldCheck, ShieldX, Wrench, X, Save } from 'lucide-react'
import { ApprovalBanner, Banner, Button, Card, CardHeader, Check, DescList, Empty, Field, FilterBar, IdLink, Input, Mono, Pager, PageHeader, Person, PersonaHint, Progress, SearchBox, Segmented, Select, Skeleton, Status, Stepper, Table, Tabs, Textarea, Toggle, usePaged, useGuard, cx } from '../ui'
import { computePreflight, eligibility, preflightPass, useDirty, useStore } from '../store'
import { planVer } from '../data'
import type { Operation } from '../data'
import type { PfCheck, PfSnap, PfState } from './c-common'
import { runtimeLabel as runtimeText, PF_LABEL, PF_TONE, OpGate, OpStatus, RuntimeStatus, opConversation, opGroups, elapsed, pfOverall, specChecks, findConflicts, fmtMs, fmtSched, parseStamp, planApprovalState, progressOf, schedMs, stepCounts, stepMinutes, windowIssue } from './c-common'
import { AgentsTab, ConsoleTab, OpBanner, OpControls, OverviewTab, TimelineTab } from './c-console'
import { GraphTab, ResultsTab } from './c-results'

const SELECT_PROJECT = 'Select a project to continue'
const STATUS_OPTS: [string, string][] = [['draft', 'Draft'], ['ready', 'Ready'], ['running', 'Running'], ['paused', 'Paused'], ['done', 'Completed'], ['cancelled', 'Stopped'], ['estop', 'Emergency stopped'], ['error', 'Error']]

/* ═════════════ OP-01 — Operations list ═════════════ */
function Operations() {
  const { db, scoped, pid, project, go, persistFilters, setFilter, setSwitcherOpen, can, loading, A, toast } = useStore()
  const f = { q: '', status: '', project: '', owner: '', ...(persistFilters.ops || {}) }
  const set = (patch: Partial<typeof f>) => setFilter('ops', { ...f, ...patch })
  const statusF: string = (persistFilters['operations.status'] as string) || f.status
  const techF: string = (persistFilters['operations.technique'] as string) || ''
  const [more, setMore] = useState(false)
  const all = scoped(db.operations)
  const owners = [...new Set(all.map((o) => o.owner))]
  const CATS: [string, string, string[]][] = [['', 'All', []], ['draft', 'Draft', ['draft']], ['needs', 'Needs approval', ['pending']], ['running', 'Running', ['running', 'paused']], ['done', 'Completed', ['done']]]
  const cat = CATS.find((c) => c[0] === statusF)
  const rows = useMemo(() => all.filter((o) =>
    (!statusF || (cat ? cat[2].includes(o.status) || (statusF === 'needs' && o.status === 'draft' && !!o.planId && db.plans.find((p) => p.id === o.planId)?.status === 'in_review') : o.status === statusF)) && (!techF || o.steps.some((s) => s.technique === techF)) && (!f.project || o.projectId === f.project) && (!f.owner || o.owner === f.owner) && (!f.q || (o.id + o.name).toLowerCase().includes(f.q.toLowerCase()))),
  [all, f.q, statusF, techF, f.project, f.owner, cat, db.plans])
  const pg = usePaged(rows, 10)
  const { ro, reason } = useGuard(project?.id)
  const allProjects = pid === 'all'
  const canCreate = !allProjects && can('run') && !ro
  const createWhy = allProjects ? SELECT_PROJECT : ro ? reason : 'Only a Manager or Operator can create operations.'
  const elig = project ? eligibility(db, project.id) : null
  const filtered = !!(f.q || statusF || techF || f.project || f.owner)
  const nMore = (f.owner ? 1 : 0) + (f.project ? 1 : 0)
  const clear = () => { set({ q: '', status: '', project: '', owner: '' }); setFilter('operations.status', ''); setFilter('operations.technique', '') }
  const setStatus = (v: string) => { setFilter('operations.status', v); set({ status: v }) }
  const noRunning = (o: Operation) => o.status === 'draft' || o.status === 'ready' || o.status === 'pending'
  return (
    <div>
      <PageHeader title="Operations" sub="Operations by project, status and owner. Drafts can always be saved; only preflight and start are gated."
        actions={<Button variant="primary" icon={Plus} disabled={!canCreate} title={canCreate ? undefined : createWhy} onClick={() => go('operation-new')}>Create Operation</Button>} />
      {allProjects && <Banner tone="info" title="Viewing all projects (read-only)" action={<Button size="sm" onClick={() => setSwitcherOpen(true)}>Select a project</Button>}>Select a project to create or start an operation.</Banner>}
      {project && ro && <Banner tone="info" icon={Lock}>{reason} You can view operations and results only.</Banner>}
      {elig && elig.kind === 'locked' && <Banner tone="warn" icon={Lock} title={`${elig.label} — operations can be drafted but not run`}>
        <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">{elig.reasons.map((r) => <li key={r.text} className="text-sm">{r.text}{r.to && <> · <button className="text-accent underline" onClick={() => go(r.to!.page, { id: r.to!.id, tab: r.to!.tab })}>Fix</button></>}</li>)}</ul>
      </Banner>}
      {(() => {
        const ready = !allProjects ? scoped(db.plans).filter((pl) => pl.status === 'approved' && !(pl.opId && db.operations.some((o) => o.id === pl.opId))) : []
        return ready.length > 0 && <Banner tone="info" icon={ClipboardCheck} title={`${ready.length} approved plan${ready.length === 1 ? '' : 's'} ready for an operation`}>
          <ul className="mt-1 space-y-1.5">{ready.map((pl) => <li key={pl.id} className="flex flex-wrap items-center gap-2 text-sm"><IdLink onClick={() => go('ai-plan-review', { id: pl.id })}>{pl.id} {planVer(pl)}</IdLink><span className="min-w-0 truncate">{pl.title}</span>
            <Button size="sm" variant="primary" disabled={!canCreate} title={canCreate ? 'Creates a draft operation from this approved plan. Preflight still has to pass before it can start.' : createWhy} onClick={() => { const r = A.executePlan(pl.id); if (r.ok && r.opId) { toast(`Draft ${r.opId} created from ${pl.id}. Run preflight before starting.`); go('operation', { id: r.opId, tab: 'overview' }) } else toast(r.error || 'Cannot create the operation.', 'bad') }}>Create Operation from plan</Button></li>)}</ul>
        </Banner>
      })()}
      {techF && <Banner tone="info" title={`Showing operations that test technique ${techF}`} action={<Button size="sm" onClick={() => setFilter('operations.technique', '')}>Clear technique filter</Button>}>Only operations with at least one step using this technique are listed.</Banner>}
      <FilterBar>
        <SearchBox value={f.q} onChange={(v) => set({ q: v })} placeholder="Search by ID or name…" className="w-60 max-w-full" />
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Operation category">
          {CATS.map(([v, l]) => <button key={v} onClick={() => setStatus(v)} aria-pressed={statusF === v} className={cx('h-9 whitespace-nowrap rounded-full border px-3 text-xs font-medium transition', statusF === v ? 'border-accent bg-accent-soft text-accent' : 'border-line text-muted hover:bg-hover')}>{l}</button>)}
        </div>
        <div className="relative">
          <Button icon={SlidersHorizontal} onClick={() => setMore(!more)} aria-expanded={more}>More filters{nMore ? ` (${nMore})` : ''}</Button>
          {more && (
            <div className="absolute left-0 top-full z-30 mt-1.5 w-72 space-y-3 rounded-xl border border-line bg-panel p-4 shadow-xl">
              <Field label="Owner"><Select aria-label="Filter by owner" value={f.owner} onChange={(e) => set({ owner: e.target.value })}><option value="">All owners</option>{owners.map((o) => <option key={o}>{o}</option>)}</Select></Field>
              {allProjects && <Field label="Project"><Select aria-label="Filter by project" value={f.project} onChange={(e) => set({ project: e.target.value })}><option value="">All projects</option>{[...new Set(all.map((o) => o.projectId))].map((p) => <option key={p}>{p}</option>)}</Select></Field>}
              <Field label="Detailed status"><Select aria-label="Filter by status" value={STATUS_OPTS.some((s) => s[0] === statusF) ? statusF : ''} onChange={(e) => setStatus(e.target.value)}><option value="">Any</option>{STATUS_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
              <div className="flex justify-between"><Button size="sm" variant="ghost" onClick={clear}>Clear all</Button><Button size="sm" onClick={() => setMore(false)}>Done</Button></div>
            </div>
          )}
        </div>
        {filtered && <Button variant="ghost" icon={X} onClick={clear}>Clear filters</Button>}
      </FilterBar>
      {loading ? <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}</div> : (
        <>
          <Table rows={pg.rows} rowKey={(o) => o.id} onRow={(o) => go('operation', { id: o.id, tab: 'overview' })}
            empty={<Empty icon={Radio} title={filtered ? 'No operations match the filters' : 'No operations in this project'} action={filtered ? <Button onClick={clear}>Clear filters</Button> : canCreate ? <Button variant="primary" icon={Plus} onClick={() => go('operation-new')}>Create Draft Operation</Button> : undefined}>{filtered ? 'Try relaxing the filters.' : allProjects ? SELECT_PROJECT + ' to draft an operation.' : 'You can draft an operation now. It cannot run until the ROE is approved, assets are in scope and agents are connected.'}</Empty>}
            cols={[
              { key: 'id', header: 'ID', className: 'whitespace-nowrap', render: (o) => <span className="whitespace-nowrap"><IdLink onClick={() => go('operation', { id: o.id, tab: 'overview' })}>{o.id}</IdLink></span> },
              { key: 'n', header: 'Operation', render: (o) => { const pl = o.planId ? db.plans.find((x) => x.id === o.planId) : undefined; const pr = db.projects.find((x) => x.id === o.projectId); return <div className="min-w-56"><div className="font-medium">{o.name}</div><div className="text-xs text-muted">{pl ? <span className="whitespace-nowrap">Plan {pl.id} {planVer(pl)}</span> : db.playbooks.find((p) => p.id === o.playbookId)?.name || 'No plan or playbook yet'}{pr ? <span className="whitespace-nowrap"> · {pr.roeVersion}</span> : ''}{allProjects && <span className="whitespace-nowrap"> · {o.projectId}</span>}</div></div> } },
              { key: 's', header: 'Status', className: 'whitespace-nowrap', render: (o) => <RuntimeStatus op={o} size="sm" /> },
              { key: 'o', header: 'Owner', hideBelow: 'lg', className: 'whitespace-nowrap', render: (o) => o.owner },
              { key: 'pr', header: 'Progress', width: '190px', render: (o) => {
                const c = stepCounts(o.steps); const v = progressOf(o.steps)
                if (noRunning(o)) { const e = eligibility(db, o.projectId); return <div className="text-xs"><div className="whitespace-nowrap text-muted">Not started{o.steps.length ? ` · ${o.steps.length} steps planned` : ' · no steps yet'}</div><div className={cx('whitespace-nowrap', e.kind === 'locked' ? 'text-bad' : 'text-muted')}>{e.label}</div></div> }
                return v == null ? <span className="text-xs text-muted">No data yet</span> : <div><div className="mb-1 whitespace-nowrap text-xs font-medium">{c.ok + c.fail}/{c.total} steps{c.review ? <span className="ml-1 font-normal text-warn">· {c.review} needs review</span> : ''}</div><Progress value={v} tone={c.fail || c.review ? 'warn' : 'accent'} label={`Progress ${o.id}`} /></div> } },
              { key: 'a', header: 'Agents', hideBelow: 'md', render: (o) => o.agents.length },
              { key: 'st', header: 'Started', hideBelow: 'lg', className: 'whitespace-nowrap', render: (o) => <Mono className="whitespace-nowrap text-muted">{o.startedAt}</Mono> },
              { key: 'ac', header: '', className: 'whitespace-nowrap', render: (o) => (o.status === 'running' || o.status === 'paused') ? <Button size="sm" icon={Radio} onClick={(e) => { e.stopPropagation(); go('operation', { id: o.id, tab: 'live' }) }}>Open Live Workspace</Button> : noRunning(o) ? <Button size="sm" onClick={(e) => { e.stopPropagation(); go('operation-new', { id: o.id }) }}>Edit Draft</Button> : <ArrowRight size={16} className="text-neutral" aria-hidden /> },
            ]} />
          <Pager {...pg} />
        </>
      )}
    </div>
  )
}

/* ───────────── Conflict panel (shared by wizard and schedule page) ───────────── */
function ConflictPanel({ db, id, agents, assets, at, mins, windowText }: { db: ReturnType<typeof useStore>['db']; id?: string; agents: string[]; assets: string[]; at: string; mins: number; windowText?: string }) {
  const { now, go } = useStore()
  const ms = schedMs(at)
  if (ms == null) return null
  const nowMs = parseStamp(now()) ?? ms
  const proj = db.projects.find((p) => p.id === (db.operations.find((o) => o.id === id)?.projectId))
  const cs = findConflicts(db, { id, agents, assets, start: ms, mins }, nowMs)
  const win = windowIssue(proj, ms)
  const past = ms < nowMs
  return (
    <div className="space-y-2" aria-live="polite">
      <div className="text-xs text-muted">Estimated duration {mins} min · {fmtMs(ms)} to {fmtMs(ms + mins * 60000)}</div>
      {past && <Banner tone="warn" title="Start time is in the past">Choose a future time or start the operation manually after preflight.</Banner>}
      {win && <Banner tone="warn" icon={AlertTriangle} title="Outside the allowed window">{win} {windowText ? '' : ''}Pick a time inside the window or request an ROE window change.</Banner>}
      {cs.length > 0 && (
        <Banner tone="bad" icon={ShieldX} title={`${cs.length} scheduling conflict${cs.length === 1 ? '' : 's'}`}>
          <ul className="mt-1 space-y-1">
            {cs.map((c, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-2 text-sm">
                <span className="font-semibold">{c.kind === 'agent' ? 'Blocking' : 'Warning'}:</span>{c.label}
                <IdLink onClick={() => go('operation', { id: c.other.id, tab: 'overview' })}>{c.other.id}</IdLink>
                <span className="text-xs text-muted">overlap {fmtMs(c.from)} – {fmtMs(c.to)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs">One agent serves one operation at a time. Choose a later time, other agents or other assets.</p>
        </Banner>
      )}
      {!past && !win && cs.length === 0 && <div className="flex items-center gap-2 text-sm text-ok"><CheckCircle2 size={16} aria-hidden />No conflicts and inside the allowed window.</div>}
    </div>
  )
}
const blockingConflicts = (db: ReturnType<typeof useStore>['db'], id: string | undefined, agents: string[], assets: string[], at: string, mins: number, nowMs: number) => {
  const ms = schedMs(at)
  return ms == null ? 0 : findConflicts(db, { id, agents, assets, start: ms, mins }, nowMs).filter((c) => c.kind === 'agent').length
}

/* ═════════════ OP-02 — Create / edit wizard ═════════════ */
const STEPS = ['Basics', 'Playbook', 'Targets and agents', 'Schedule and mode', 'Review']
function OperationNew() {
  const { db, route, pid, project, me, go, can, A, toast, setSwitcherOpen, setPid, setDirty, persistFilters: pfx, setFilter: setFx, now } = useStore()
  const edit = route.id ? db.operations.find((o) => o.id === route.id) : undefined
  const projectId = edit?.projectId || (pid !== 'all' ? pid : '')
  const p = db.projects.find((x) => x.id === projectId) || project
  const { ro, reason } = useGuard(projectId || undefined)
  const members = p ? [...new Set([p.owner, ...p.members.filter((m) => m.role === 'manager' || m.role === 'operator').map((m) => m.user)])] : []
  const init = {
    name: edit?.name || '', owner: edit?.owner || (p && members.includes(me.name) ? me.name : p?.owner || ''), desc: '', objective: p?.objectives[0]?.id || '', newObj: '',
    playbookId: edit?.playbookId || (pfx['operation-new.playbook'] as string) || '', agents: edit?.agents || [], assets: edit?.assets || (pfx['operation-new.assets'] as string[]) || [],
    mode: edit?.mode || 'Manual with confirmation', when: edit?.schedule && edit.schedule !== 'now' ? 'later' : 'now', at: edit?.schedule && edit.schedule !== 'now' ? edit.schedule : '', needConfirm: true, note: '',
  }
  const [d, setD] = useState(init)
  const [step, setStep] = useState(0)
  useEffect(() => { if (pfx['operation-new.playbook']) setFx('operation-new.playbook', undefined); if (pfx['operation-new.assets']) setFx('operation-new.assets', undefined) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const isDirty = JSON.stringify(d) !== JSON.stringify(init)
  const pb = db.playbooks.find((x) => x.id === d.playbookId)
  const upd = (patch: Partial<typeof d>) => setD((s) => ({ ...s, ...patch }))
  const toggle = (k: 'agents' | 'assets', id: string) => upd({ [k]: d[k].includes(id) ? d[k].filter((x) => x !== id) : [...d[k], id] } as Partial<typeof d>)

  const agents = db.agents.filter((a) => a.projectId === projectId || a.projectId === '')
  const agentIssue = (a: (typeof agents)[number]) => {
    if (a.status === 'lost') return ''
    if (a.status !== 'online' && a.status !== 'idle') return a.status === 'disabled' ? 'Agent is disabled.' : 'Agent status is unknown.'
    if (a.op && a.op !== edit?.id) return `Busy with ${a.op} (policy: one agent, one operation).`
    if (pb && !pb.os.includes(a.os)) return `Incompatible: playbook supports ${pb.os.join(', ')}, agent runs ${a.os}.`
    return ''
  }
  const assetList = db.assets.filter((a) => a.projectId === projectId)
  const assetIssue = (a: (typeof assetList)[number]) => a.scope === 'in' ? '' : a.scope === 'out' ? 'Out of scope per ROE — cannot be selected.' : a.scope === 'pending' ? 'Scope approval pending — cannot be selected yet.' : 'Scope not classified — cannot be selected.'
  const mins = edit ? stepMinutes(edit) : Math.max(20, (pb?.steps.length || 8) * 7)
  const nowMs = parseStamp(now()) ?? 0

  const roeLocked = !!p && (p.roeStatus !== 'approved' || !['approved', 'active'].includes(p.status))
  const allowed = !!p && can('run', projectId) && !ro
  /* Non-blocking hints: everything here is needed to RUN, never to SAVE a draft */
  const errs: Record<number, Record<string, string>> = {
    0: { name: !d.name.trim() ? 'No name yet. A draft is saved as "Untitled draft operation" until you name it.' : '' },
    1: { pb: !pb && !edit?.planId ? 'Needed before preflight: choose an approved playbook or link an approved AI plan.' : '' },
    2: {
      assets: d.assets.length === 0 ? 'Needed before preflight: select at least one approved in-scope asset. You can still save this draft.' : '',
      agents: d.agents.length === 0 ? 'Needed before preflight: assign at least one agent. You can still save this draft.' : d.agents.some((a) => agentIssue(db.agents.find((x) => x.id === a)!)) ? 'Some selected agents are not valid. Deselect them or choose others.' : '',
    },
    3: {
      at: d.when === 'later' ? (!d.at ? 'Choose a start time, or switch to manual start.' : windowIssue(p ?? undefined, schedMs(d.at)) || (blockingConflicts(db, edit?.id, d.agents, d.assets, d.at, mins, nowMs) ? 'An agent is already reserved at this time.' : '')) : '',
    },
  }
  const show = (i: number, k: string) => errs[i][k]
  const next = () => setStep(step + 1)
  const jump = (i: number) => setStep(i)
  /** Why Run Preflight is not available (explicit reason + fix link) */
  const blockers: { text: string; to?: { page: string; id?: string; tab?: string } }[] = []
  if (p) {
    if (!['approved', 'active'].includes(p.status)) blockers.push({ text: `Project ${p.id} is ${p.status === 'draft' ? 'still a draft' : 'not approved'}.`, to: { page: 'project', id: p.id, tab: 'overview' } })
    if (p.roeStatus !== 'approved') blockers.push({ text: `Cannot run: ROE is not approved (${p.roeVersion} is ${p.roeStatus === 'none' ? 'missing' : p.roeStatus}).`, to: { page: 'project', id: p.id, tab: 'scope' } })
    if (!p.emergency) blockers.push({ text: 'No emergency contact on the ROE.', to: { page: 'project', id: p.id, tab: 'scope' } })
    if (d.assets.length === 0) blockers.push({ text: assetList.some((a) => a.scope === 'in') ? 'No target assets selected.' : 'This project has 0 approved assets in scope.', to: assetList.some((a) => a.scope === 'in') ? undefined : { page: 'assets' } })
    if (d.agents.length === 0) blockers.push({ text: 'No agents assigned.', to: { page: 'agents' } })
    if (!pb && !edit?.planId) blockers.push({ text: 'No approved playbook or AI plan chosen.', to: { page: 'playbooks' } })
  }
  const preflightWhy = !allowed ? (ro ? reason : 'Only a Manager or Operator can run preflight.') : blockers.length ? `Run Preflight is unavailable: ${blockers[0].text}${blockers.length > 1 ? ` (+${blockers.length - 1} more)` : ''}` : ''

  const submit = (to: 'preflight' | 'detail') => {
    if (!p) return
    if (to === 'preflight' && preflightWhy) { toast(preflightWhy, 'bad'); return }
    d.agents.filter((a) => db.agents.find((x) => x.id === a)?.projectId === '').forEach((a) => A.assignAgent(a, p.id))
    const obj = d.objective === '__new' ? d.newObj : p.objectives.find((o) => o.id === d.objective)?.text || ''
    let id: string
    const schedule = d.when === 'now' ? 'now' : d.at
    const name = d.name.trim() || 'Untitled draft operation'
    if (edit) { A.updateOperation(edit.id, { name, owner: d.owner, playbookId: d.playbookId, agents: d.agents, assets: d.assets, mode: d.mode, schedule }); id = edit.id; toast('Draft saved. Preflight must be run again before starting.', 'warn') }
    else { id = A.createOperation({ name, projectId: p.id, owner: d.owner, desc: d.desc, objective: obj, playbookId: d.playbookId, agents: d.agents, assets: d.assets, mode: d.mode, schedule, needConfirm: d.needConfirm, note: d.note }); toast(`Draft ${id} saved. No commands were issued and nothing is reserved.`) }
    setDirty(false)
    setTimeout(() => go(to === 'preflight' ? 'preflight' : 'operation', { id, tab: to === 'preflight' ? 'run' : 'overview' }), 60)
  }
  useDirty(isDirty, () => submit('detail'))

  if (edit && ['running', 'paused', 'done', 'cancelled', 'estop'].includes(edit.status)) return <Empty icon={Lock} title="This operation cannot be edited" action={<Button onClick={() => go('operation', { id: edit.id })}>Back to operation</Button>}>Only operations in Draft or Ready status can be edited.</Empty>
  if (edit && pid !== 'all' && pid !== edit.projectId) return <Empty icon={Lock} title="Operation belongs to a different project" action={<Button variant="primary" onClick={() => setPid(edit.projectId)}>Switch to {edit.projectId}</Button>}>Switch to the right project before editing.</Empty>
  if (!p) {
    return (
      <div>
        <PageHeader title="Create Operation" back={{ label: 'Operations', to: () => go('operations') }} />
        <Empty icon={ShieldAlert} title="No project selected" action={<Button variant="primary" onClick={() => setSwitcherOpen(true)}>Select a project</Button>}>An operation always belongs to exactly one project (ROE, scope and agents are per project). {SELECT_PROJECT}. Operations cannot be created in All Projects mode.</Empty>
      </div>
    )
  }
  const pl = edit?.planId ? db.plans.find((x) => x.id === edit.planId) : undefined
  const sec = (children: React.ReactNode) => <Card className="mb-4">{children}</Card>
  const stepErr = (m: string) => m ? <p className="mt-2 flex items-center gap-1 text-xs text-warn"><AlertTriangle size={12} aria-hidden />{m}</p> : null
  const back = () => go(edit ? 'preflight' : 'operations', edit ? { id: edit.id } : undefined)
  return (
    <div>
      <PageHeader title={edit ? `Edit ${edit.id}` : 'Create Operation'} sub={`Project ${p.id} — ${p.name}`} back={{ label: 'Operations', to: back }} />
      {ro && <Banner tone="bad" icon={Lock} title="Project is read-only">{reason} Operations cannot be created or edited.</Banner>}
      {!ro && roeLocked && <Banner tone="warn" icon={Lock} title="Cannot run: ROE is not approved" action={<Button size="sm" onClick={() => go('project', { id: p.id, tab: 'scope' })}>Open Scope &amp; ROE</Button>}>ROE {p.roeVersion} is {p.roeStatus}. You can still fill in this form and <b>Save Draft</b> at any step. No commands or reservations are created. Run Preflight and Start stay unavailable until the ROE is approved.</Banner>}
      {!ro && !can('run', projectId) && <PersonaHint need="Manager or Operator" persona="Taylor Chen">Your current role cannot create operations.</PersonaHint>}
      {pl && <div className="mb-4"><ApprovalBanner state={planApprovalState(pl)} title={`Created from AI plan ${pl.id} ${planVer(pl)}`} action={<Button size="sm" onClick={() => go('ai-plan-review', { id: pl.id })}>View plan</Button>}>Plan steps are fixed. Changing the playbook or targets here does not rewrite them; a revised plan needs re-approval.</ApprovalBanner></div>}
      <div className="mb-5"><Stepper steps={STEPS} current={step} onJump={jump} /></div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <fieldset disabled={!allowed} className="min-w-0 xl:col-span-2">
          {step === 0 && sec(<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Operation name" hint={show(0, 'name') || undefined}><Input value={d.name} onChange={(e) => upd({ name: e.target.value })} placeholder="e.g. Environment discovery simulation" /></Field>
            <Field label="Operation ID" hint="Generated on creation"><Input disabled value={edit?.id || 'Automatic'} /></Field>
            <Field label="Project" required hint="Fixed to the selected project"><Input disabled value={`${p.id} — ${p.name}`} /></Field>
            <Field label="Owner" required><Select value={d.owner} onChange={(e) => upd({ owner: e.target.value })}>{members.map((m) => <option key={m}>{m}</option>)}</Select></Field>
            <Field label="Objective" className="md:col-span-2"><Select value={d.objective} onChange={(e) => upd({ objective: e.target.value })}>{p.objectives.map((o) => <option key={o.id} value={o.id}>{o.text}</option>)}<option value="__new">+ Add a new objective…</option></Select></Field>
            {d.objective === '__new' && <Field label="New objective" className="md:col-span-2"><Input value={d.newObj} onChange={(e) => upd({ newObj: e.target.value })} /></Field>}
            <Field label="Description" className="md:col-span-2"><Textarea value={d.desc} onChange={(e) => upd({ desc: e.target.value })} placeholder="Scope and notes for this operation…" /></Field>
          </div>)}
          {step === 1 && sec(<>
            <Field label="Playbook" hint={show(1, 'pb') || 'Only approved playbooks can be selected. A draft without a plan or playbook is valid.'}>
              <Select value={d.playbookId} onChange={(e) => upd({ playbookId: e.target.value, agents: d.agents.filter((a) => { const ag = db.agents.find((x) => x.id === a)!; const np = db.playbooks.find((x) => x.id === e.target.value); return !np || np.os.includes(ag.os) }) })}>
                <option value="">— Choose a playbook —</option>
                {db.playbooks.filter((x) => x.kind === 'playbook').map((x) => <option key={x.id} value={x.id} disabled={x.status !== 'approved'}>{x.name} v{x.version}{x.status !== 'approved' ? ' — not approved, cannot be selected' : ''}</option>)}
              </Select>
            </Field>
            {pb && <div className="mt-3 rounded-lg border border-line bg-bg p-4"><DescList cols={3} items={[{ k: 'Version', v: <Mono>v{pb.version}</Mono> }, { k: 'Steps', v: pb.steps.length }, { k: 'Compatible platforms', v: pb.os.join(', ') }, { k: 'ATT&CK techniques', v: <span className="font-mono text-xs">{pb.techniques.join(', ')}</span> }, { k: 'Objective', v: pb.goal }, { k: 'Preflight', v: 'PRE-01 to PRE-08 must pass' }]} /></div>}
          </>)}
          {step === 2 && sec(<>
            <div className="mb-2 text-xs font-medium text-muted">In-scope assets <span className="text-bad">*</span></div>
            <ul className="mb-1 divide-y divide-line/60 rounded-lg border border-line">
              {assetList.length === 0 && <li className="p-4 text-sm text-muted">This project has no assets. Add assets in the Assets section.</li>}
              {assetList.map((a) => { const iss = assetIssue(a); return (
                <li key={a.id} className={cx('flex min-h-12 flex-wrap items-center gap-3 px-4 py-2', iss && 'opacity-70')}>
                  <Check checked={d.assets.includes(a.id)} disabled={!!iss} onChange={() => toggle('assets', a.id)} label={<span><span className="font-medium">{a.name}</span> <Mono className="text-muted">{a.ident}</Mono></span>} />
                  <span className="ml-auto flex items-center gap-2">{iss && <span className="text-xs text-bad max-sm:basis-full">{iss}</span>}<Status kind="scope" value={a.scope} size="sm" /></span>
                </li>) })}
            </ul>
            {stepErr(show(2, 'assets'))}
            <div className="mb-2 mt-5 text-xs font-medium text-muted">Agents <span className="text-bad">*</span> <span className="font-normal">(project agents and unassigned pool agents)</span></div>
            <ul className="mb-1 divide-y divide-line/60 rounded-lg border border-line">
              {agents.map((a) => { const iss = agentIssue(a); return (
                <li key={a.id} className={cx('flex min-h-12 flex-wrap items-center gap-3 px-4 py-2', iss && 'opacity-70')}>
                  <Check checked={d.agents.includes(a.id)} disabled={!!iss} onChange={() => toggle('agents', a.id)} label={<span><span className="font-mono text-[13px]">{a.id}</span> <span className="text-muted">{a.host} · {a.os}</span></span>} />
                  <span className="ml-auto flex flex-wrap items-center gap-2">{iss && <span className="text-xs text-warn max-sm:basis-full">{iss}</span>}{a.status === 'lost' && <span className="text-xs text-warn max-sm:basis-full">Disconnected — preflight will fail until restored.</span>}{a.projectId === '' && <span className="text-xs text-muted">Pool — will be assigned to this project</span>}<Status kind="agent" value={a.status} size="sm" /></span>
                </li>) })}
            </ul>
            {stepErr(show(2, 'agents'))}
          </>)}
          {step === 3 && sec(<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Start"><Segmented value={d.when as 'now' | 'later'} onChange={(v) => upd({ when: v })} options={[{ id: 'now', label: 'Start manually after preflight' }, { id: 'later', label: 'Schedule' }]} /></Field>
            {d.when === 'later' ? <Field label="Scheduled start" error={show(3, 'at')} hint={`ROE window: ${p.window}. Times are UTC+7.`}><Input type="datetime-local" value={d.at} onChange={(e) => upd({ at: e.target.value })} /></Field> : <div />}
            {d.when === 'later' && d.at && <div className="md:col-span-2"><ConflictPanel db={db} id={edit?.id} agents={d.agents} assets={d.assets} at={d.at} mins={mins} /></div>}
            <Field label="Execution mode" hint="Per organization policy"><Select value={d.mode} onChange={(e) => upd({ mode: e.target.value })}><option>Manual with confirmation</option><option>Automatic per policy</option></Select></Field>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-line p-3"><span className="text-sm">Require manager confirmation before start</span><Toggle on={d.needConfirm} onChange={(v) => upd({ needConfirm: v })} label="Require manager confirmation" /></div>
            <Field label="Operator notes" className="md:col-span-2"><Textarea value={d.note} onChange={(e) => upd({ note: e.target.value })} /></Field>
          </div>)}
          {step === 4 && sec(<>
            <h3 className="mb-3 text-[15px] font-semibold">Review configuration</h3>
            <DescList items={[
              { k: 'Operation', v: d.name || '—' }, { k: 'Owner', v: d.owner }, { k: 'Project', v: <Mono>{p.id}</Mono> },
              { k: 'ROE version', v: <span className="inline-flex items-center gap-2"><Mono>{p.roeVersion}</Mono><Status kind="roe" value={p.roeStatus} size="sm" /></span> },
              { k: 'Playbook', v: pb ? `${pb.name} v${pb.version} · ${pb.steps.length} steps` : '—' },
              { k: 'Assets', v: d.assets.map((a) => db.assets.find((x) => x.id === a)?.name).join(', ') || '—' },
              { k: 'Agents', v: d.agents.join(', ') || '—' },
              { k: 'Start', v: d.when === 'now' ? 'Manual, after preflight' : fmtSched(d.at) || '—' },
              { k: 'Mode', v: d.mode },
            ]} />
            <p className="mt-4 text-sm text-muted">Save Draft is always available. It creates no commands, sessions or reservations. A session exists only after the operation is started once preflight passes.</p>
            <div className="mt-4 rounded-lg border border-line bg-bg p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold">{blockers.length ? <ShieldX size={16} className="text-bad" aria-hidden /> : <ShieldCheck size={16} className="text-ok" aria-hidden />}{blockers.length ? `${blockers.length} blocker${blockers.length === 1 ? '' : 's'} before Run Preflight` : 'No blockers — ready to run preflight'}</div>
              {blockers.length > 0 && <ul className="space-y-1.5 text-sm">{blockers.map((b) => <li key={b.text} className="flex flex-wrap items-center gap-2"><span>{b.text}</span>{b.to && <Button size="sm" onClick={() => go(b.to!.page, { id: b.to!.id, tab: b.to!.tab })}>{b.to.page === 'project' ? 'Open Scope & ROE' : 'Fix'}</Button>}</li>)}</ul>}
              <p className="mt-2 text-xs text-muted">Start Operation is only offered on the preflight screen, after every required check passes.</p>
            </div>
          </>)}
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={step === 0} onClick={() => setStep(step - 1)} title={step === 0 ? 'This is the first step.' : undefined}>Back</Button>
            {step < 4 && <Button variant="primary" disabled={!allowed} title={allowed ? undefined : 'The form is locked.'} onClick={next}>Next</Button>}
            <Button icon={Save} disabled={!allowed} title={allowed ? 'Saves your entries as a draft. Always allowed, even with missing data.' : ro ? reason : 'Only a Manager or Operator can save operation drafts.'} onClick={() => submit('detail')}>Save Draft</Button>
            <Button variant="ghost" className="ml-auto" onClick={back}>Cancel</Button>
          </div>
        </fieldset>
        <div className="xl:sticky xl:top-4 xl:self-start">
          <Card>
            <CardHeader title="Configuration summary" />
            <DescList cols={1} items={[
              { k: 'Operation', v: d.name || <span className="text-muted">Not named</span> },
              { k: 'Playbook', v: pb ? `${pb.name} v${pb.version}` : <span className="text-muted">Not chosen</span> },
              { k: 'Assets', v: d.assets.length ? `${d.assets.length} selected` : <span className="text-muted">None selected</span> },
              { k: 'Agents', v: d.agents.length ? d.agents.join(', ') : <span className="text-muted">None selected</span> },
              { k: 'Start', v: d.when === 'now' ? 'After preflight' : d.at ? fmtSched(d.at) : 'Not chosen' },
            ]} />
            {!allowed && <p className="mt-4 text-xs text-muted">Form locked: {ro ? reason : 'you cannot create operations.'}</p>}
            <div className="mt-5 flex flex-col gap-2">
              <Button icon={Save} variant={preflightWhy ? 'primary' : 'secondary'} disabled={!allowed} title={allowed ? 'Always allowed. Creates a draft only.' : 'The form is locked.'} onClick={() => submit('detail')}>Save Draft</Button>
              <Button variant={preflightWhy ? 'secondary' : 'primary'} icon={ClipboardCheck} disabled={!!preflightWhy} title={preflightWhy || undefined} onClick={() => submit('preflight')}>{edit ? 'Save and Run Preflight' : 'Save and Run Preflight'}</Button>
              {preflightWhy && allowed && <div className="space-y-1 text-xs"><div className="font-medium text-warn">Run Preflight and Start are unavailable:</div>{blockers.slice(0, 3).map((b) => <div key={b.text} className="text-muted">{b.text}{b.to && <> <button className="text-accent underline" onClick={() => go(b.to!.page, { id: b.to!.id, tab: b.to!.tab })}>Fix</button></>}</div>)}{blockers.length > 3 && <div className="text-muted">+{blockers.length - 3} more on the Review step</div>}</div>}
              {!preflightWhy && <p className="text-xs text-muted">Start Operation appears after preflight passes.</p>}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

/* ═════════════ OP-03 — Preflight ═════════════ */
function PreflightPage({ op }: { op: Operation }) {
  const { db, go, A, toast, can, pid, route, persistFilters, setFilter, now } = useStore()
  const { ro, reason } = useGuard(op.projectId)
  const [checking, setChecking] = useState(false)
  const p = db.projects.find((x) => x.id === op.projectId)!
  const pb = db.playbooks.find((x) => x.id === op.playbookId)
  const pl = op.planId ? db.plans.find((x) => x.id === op.planId) : undefined
  const live = specChecks(db, op)
  const engine = computePreflight(db, op)
  const enginePass = preflightPass(engine)
  const snap = persistFilters['preflight.' + op.id] as PfSnap | undefined
  const planV = pl ? planVer(pl) : '—'
  const invalid = !!snap && (snap.roe !== p.roeVersion || snap.plan !== planV)
  const shown: PfCheck[] = snap && !invalid ? snap.checks : live.map((c) => ({ ...c, state: 'nc' as PfState, detail: 'Not checked yet. Run Preflight to create a checklist snapshot.' }))
  const overall = snap && !invalid ? pfOverall(snap.checks) : 'nc'
  const nf = shown.filter((c) => c.state === 'fail').length
  const allowed = can('run', op.projectId) && !ro
  const started = ['running', 'paused', 'done', 'cancelled', 'estop', 'error'].includes(op.status)
  const allProjects = pid === 'all'
  const firstBad = shown.find((c) => c.state === 'fail')
  const ok = !!snap && !invalid && overall !== 'fail' && overall !== 'nc' && enginePass && allowed && !started && !allProjects
  const startWhy = allProjects ? SELECT_PROJECT : !allowed ? (ro ? reason : 'Only a Manager or Operator can start operations.') : started ? 'The operation has already started.'
    : !snap ? 'Run Preflight first. Start needs a PASS snapshot of all required checks.' : invalid ? `The snapshot is invalid: ${snap.roe !== p.roeVersion ? `ROE changed from ${snap.roe} to ${p.roeVersion}` : 'the plan version changed'}. Run Preflight again.`
    : firstBad ? `${firstBad.code} failed: ${firstBad.detail}` : overall === 'nc' ? 'Some required checks were not checked.' : !enginePass ? 'The current state no longer passes. Run Preflight again.' : ''
  const run = () => {
    setChecking(true)
    setTimeout(() => {
      const cs = specChecks(db, op)
      setFilter('preflight.' + op.id, { at: now(), roe: p.roeVersion, plan: planV, checks: cs } as PfSnap)
      A.confirmPreflight(op.id); setChecking(false)
      toast(pfOverall(cs) === 'fail' ? 'Preflight finished with failures. Start is unavailable.' : 'Preflight snapshot recorded.', pfOverall(cs) === 'fail' ? 'bad' : 'info')
    }, 700)
  }
  useEffect(() => { if (route.tab === 'run' && !snap && allowed && !started) run() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const approver = db.approvals.find((a) => a.projectId === p.id && a.status === 'approved')
  const disabledEdit = !allowed || started
  const runWhy = !allowed ? (ro ? reason : 'You cannot run checks.') : started ? 'The operation has already started.' : undefined
  return (
    <div>
      <PageHeader title={`Preflight — ${op.id}`} sub={op.name} crumbs={[{ label: 'Operations', to: () => go('operations') }, { label: op.id, to: () => go('operation', { id: op.id }) }, { label: 'Preflight' }]}
        meta={<OpStatus value={op.status} />}
        actions={<>
          <Button icon={RefreshCw} variant={snap && !invalid ? 'secondary' : 'primary'} disabled={!allowed || checking || started} title={runWhy} onClick={run}>{checking ? 'Checking…' : snap ? 'Run Preflight again' : 'Run Preflight'}</Button>
          <Button icon={CalendarClock} disabled={disabledEdit} title={started ? 'The operation has started and cannot be rescheduled.' : !allowed ? (ro ? reason : 'You cannot edit operations.') : undefined} onClick={() => go('operation-schedule', { id: op.id })}>Schedule</Button>
          <Button icon={Wrench} disabled={disabledEdit} title={started ? 'The operation has started and cannot be edited.' : !allowed ? (ro ? reason : 'You cannot edit operations.') : undefined} onClick={() => go('operation-new', { id: op.id })}>Edit Draft</Button>
          <Button variant={ok ? 'primary' : 'secondary'} icon={Play} disabled={!ok} title={ok ? undefined : startWhy} onClick={() => { A.startOp(op.id); toast(`Operation ${op.id} started.`); go('operation', { id: op.id, tab: 'live' }) }}>Start Operation</Button>
        </>} />
      {ro && <Banner tone="info" icon={Lock}>{reason}</Banner>}
      {started && <Banner tone="info" title="Operation already started" action={<Button size="sm" onClick={() => go('operation', { id: op.id, tab: 'live' })}>Open Live Workspace</Button>}>The preflight result below is for reference only.</Banner>}
      {invalid && <Banner tone="warn" icon={AlertTriangle} title="Snapshot invalidated">{snap!.roe !== p.roeVersion ? `The ROE changed from ${snap!.roe} to ${p.roeVersion} after this snapshot.` : `The plan version changed from ${snap!.plan} to ${planV}.`} Run Preflight again before starting.</Banner>}
      {checking ? <Banner tone="info" title="Checking 8 required conditions…">Please wait a moment.</Banner>
        : !snap || invalid ? <Banner tone="info" icon={ClipboardCheck} title="Preflight has not been run">All 8 checks show NOT CHECKED until you run preflight. Running it creates a time-stamped snapshot; Start Operation needs every required check to PASS.</Banner>
        : overall === 'fail' ? <Banner tone="bad" icon={ShieldX} title={`Blocked — ${nf} check${nf === 1 ? '' : 's'} failed`}>Start Operation is disabled. Use the fix link on each failed row, then run preflight again. There is no way to skip a check.</Banner>
        : overall === 'warn' ? <Banner tone="warn" title="Passed with warnings">Warnings do not block start under the current policy, but review them first.</Banner>
        : <Banner tone="ok" icon={ShieldCheck} title="Eligible to start — all 8 checks passed">Snapshot recorded {snap.at}. Start Operation is enabled.</Banner>}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className={cx('min-w-0 xl:col-span-2', checking && 'opacity-60')}>
          <div className="no-scrollbar overflow-x-auto rounded-xl border border-line bg-panel">
            <table className="w-full min-w-[680px] border-collapse text-sm">
              <caption className="sr-only">Preflight checks</caption>
              <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted"><th className="h-11 px-4 font-medium">#</th><th className="px-4 font-medium">Check</th><th className="px-4 font-medium">Result</th><th className="px-4 font-medium">Reason</th><th className="px-4 font-medium"><span className="sr-only">Action</span></th></tr></thead>
              <tbody>
                {shown.map((c) => (
                  <tr key={c.code} className="border-b border-line/60 align-top last:border-0">
                    <td className="whitespace-nowrap px-4 py-3"><Mono className="text-muted">{c.code}</Mono></td>
                    <td className="px-4 py-3 font-medium">{c.label}</td>
                    <td className="px-4 py-3"><span className={cx('inline-flex h-6 items-center whitespace-nowrap rounded-full border px-2.5 text-xs font-semibold', PF_TONE[c.state])}>{PF_LABEL[c.state]}</span></td>
                    <td className="px-4 py-3 text-muted">{c.detail}</td>
                    <td className="px-4 py-3 text-right">{(c.state === 'fail' || c.state === 'warn') && c.to && snap && !invalid && <Button size="sm" onClick={() => go(c.to!.page, { id: c.to!.id, tab: c.to!.tab })}>{c.fix || 'Resolve'}</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!ok && startWhy && !started && <p className="mt-3 flex items-start gap-2 text-sm text-warn"><AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />Start Operation is disabled: {startWhy}</p>}
          {firstBad && !started && !invalid && <div className="mt-2 flex flex-wrap gap-2">{shown.filter((c) => c.state === 'fail' && c.to).slice(0, 3).map((c) => <Button key={c.code} size="sm" onClick={() => go(c.to!.page, { id: c.to!.id, tab: c.to!.tab })}>{c.to!.page === 'project' && c.to!.tab === 'scope' ? 'Open Scope & ROE' : c.fix || 'Fix'} ({c.code})</Button>)}</div>}
          {ok && <p className="mt-3 flex items-center gap-2 text-sm text-ok"><CheckCircle2 size={16} aria-hidden />Ready to start.</p>}
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Decision snapshot" />
            <DescList cols={1} items={[
              { k: 'Snapshot', v: snap && !invalid ? <span className="whitespace-nowrap">{snap.at}</span> : <span className="text-muted">None — not run</span> },
              { k: 'Result', v: <span className={cx('inline-flex h-6 items-center whitespace-nowrap rounded-full border px-2.5 text-xs font-semibold', PF_TONE[overall])}>{snap && !invalid ? PF_LABEL[overall] : 'NOT CHECKED'}</span> },
              { k: 'ROE version', v: <span className="inline-flex items-center gap-2"><Mono>{p.roeVersion}</Mono><Status kind="roe" value={p.roeStatus} size="sm" /></span> },
              { k: 'Plan / playbook', v: pl ? <IdLink onClick={() => go('ai-plan-review', { id: pl.id })}>{pl.id} {planVer(pl)}</IdLink> : pb ? `${pb.name} v${pb.version}` : <span className="text-muted">None chosen</span> },
              { k: 'Validity', v: invalid ? <span className="text-bad">Invalidated by a change</span> : snap ? 'Valid until the ROE, plan or targets change' : '—' },
            ]} />
          </Card>
          {op.planId && <Card>
            <CardHeader title="AI plan approval" />
            {pl ? <ApprovalBanner state={planApprovalState(pl)} title={`${pl.id} ${planVer(pl)} — ${pl.status.replace('_', ' ')}`} action={<Button size="sm" onClick={() => go('ai-plan-review', { id: pl.id })}>Open plan</Button>}>{planApprovalState(pl) === 'approved' ? 'The plan is approved, so check 4 can pass.' : 'The operation cannot start until the plan is approved.'}</ApprovalBanner> : <p className="text-sm text-muted">Linked plan {op.planId} is not available.</p>}
          </Card>}
          <Card>
            <CardHeader title="Operation summary" />
            <DescList cols={1} items={[
              { k: 'Project', v: <IdLink onClick={() => go('project', { id: p.id, tab: 'overview' })}>{p.id}</IdLink> },
              { k: 'Assets / agents', v: `${op.assets.length} assets · ${op.agents.length} agents` },
              { k: 'Mode', v: op.mode },
              { k: 'Schedule', v: op.schedule && op.schedule !== 'now' ? <IdLink onClick={() => go('operation-schedule', { id: op.id })}>{fmtSched(op.schedule)}</IdLink> : 'Manual start' },
              { k: 'Requested by', v: <Person name={op.owner} /> },
              { k: 'Approved by', v: approver ? approver.reviewer : '—' },
            ]} />
          </Card>
        </div>
      </div>
    </div>
  )
}

/* ═════════════ Scheduling with conflict detection ═════════════ */
function SchedulePage({ op }: { op: Operation }) {
  const { db, go, A, toast, can, now } = useStore()
  const { ro, reason } = useGuard(op.projectId)
  const p = db.projects.find((x) => x.id === op.projectId)!
  const [mode, setMode] = useState<'now' | 'later'>(op.schedule && op.schedule !== 'now' ? 'later' : 'now')
  const [at, setAt] = useState(op.schedule && op.schedule !== 'now' ? op.schedule : '')
  const mins = stepMinutes(op)
  const nowMs = parseStamp(now()) ?? 0
  const locked = ['running', 'paused', 'done', 'cancelled', 'estop', 'error'].includes(op.status)
  const allowed = can('run', op.projectId) && !ro && !locked
  const ms = schedMs(at)
  const conflicts = mode === 'later' && ms != null ? findConflicts(db, { id: op.id, agents: op.agents, assets: op.assets, start: ms, mins }, nowMs) : []
  const blocking = conflicts.filter((c) => c.kind === 'agent').length
  const win = mode === 'later' ? windowIssue(p, ms) : ''
  const why = locked ? 'The operation has already started and cannot be rescheduled.' : ro ? reason : !can('run', op.projectId) ? 'Only a Manager or Operator can schedule operations.'
    : mode === 'later' && !at ? 'Choose a start time.' : win ? win : mode === 'later' && ms != null && ms < nowMs ? 'Start time is in the past.' : blocking ? 'An agent is already reserved at this time. Choose a different time.' : ''
  const save = () => { A.updateOperation(op.id, { schedule: mode === 'now' ? 'now' : at }); toast(mode === 'now' ? 'Schedule cleared. Start manually after preflight.' : `Scheduled for ${fmtSched(at)}. Preflight must be re-run.`, 'info'); go('preflight', { id: op.id }) }
  const others = db.operations.filter((o) => o.id !== op.id && o.projectId === op.projectId && (o.status === 'running' || o.status === 'paused' || (o.schedule && o.schedule !== 'now' && ['draft', 'ready'].includes(o.status))))
  return (
    <div>
      <PageHeader title={`Schedule — ${op.id}`} sub={op.name} crumbs={[{ label: 'Operations', to: () => go('operations') }, { label: op.id, to: () => go('operation', { id: op.id }) }, { label: 'Schedule' }]} meta={<OpStatus value={op.status} />} />
      {locked && <Banner tone="info" title="Scheduling is closed">This operation is {op.status === 'estop' ? 'emergency stopped' : op.status}. Only draft or ready operations can be scheduled.</Banner>}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card>
            <CardHeader title="Start time" sub={`ROE window: ${p.window}. All times are UTC+7.`} />
            <fieldset disabled={!allowed} className="space-y-4">
              <Segmented value={mode} onChange={setMode} options={[{ id: 'now', label: 'Start manually after preflight' }, { id: 'later', label: 'Schedule' }]} />
              {mode === 'later' && <Field label="Scheduled start" required><Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></Field>}
              {mode === 'later' && at && <ConflictPanel db={db} id={op.id} agents={op.agents} assets={op.assets} at={at} mins={mins} />}
            </fieldset>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <Button variant="primary" icon={CalendarClock} disabled={!allowed || !!why} title={!allowed ? (locked ? why : ro ? reason : 'You cannot schedule operations.') : why || undefined} onClick={save}>Save schedule</Button>
              <Button onClick={() => go('preflight', { id: op.id })}>Back to preflight</Button>
              {why && allowed && <span className="text-xs text-warn">{why}</span>}
            </div>
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Reserved resources" />
            <DescList cols={1} items={[{ k: 'Agents', v: op.agents.join(', ') || '—' }, { k: 'Assets', v: op.assets.map((a) => db.assets.find((x) => x.id === a)?.name || a).join(', ') || '—' }, { k: 'Estimated duration', v: `${mins} min (${op.steps.length || 8} steps)` }, { k: 'Current schedule', v: op.schedule && op.schedule !== 'now' ? fmtSched(op.schedule) : 'Manual start' }]} />
          </Card>
          <Card>
            <CardHeader title="Other operations in this project" />
            {others.length === 0 ? <p className="text-sm text-muted">No running or scheduled operations.</p> : (
              <ul className="space-y-2 text-sm">{others.map((o) => <li key={o.id} className="flex flex-wrap items-center justify-between gap-2"><span><IdLink onClick={() => go('operation', { id: o.id, tab: 'overview' })}>{o.id}</IdLink> <span className="text-muted">{o.agents.join(', ')}</span></span><span className="flex items-center gap-2"><OpStatus value={o.status} size="sm" />{o.status !== 'running' && o.status !== 'paused' && <span className="text-xs text-muted">{fmtSched(o.schedule)}</span>}</span></li>)}</ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

/* ═════════════ OP-04..08 — Detail ═════════════ */
const TABS = [
  { id: 'overview', label: 'Overview' }, { id: 'live', label: 'Live Workspace' }, { id: 'agents', label: 'Agents & Sessions' },
  { id: 'timeline', label: 'Timeline' }, { id: 'graph', label: 'Execution Graph' }, { id: 'results', label: 'Results & Evidence' },
]
const TAB_ALIAS: Record<string, string> = { console: 'live', evidence: 'results' }
function OperationDetail({ op }: { op: Operation }) {
  const { db, route, go, can, staleOps, pid } = useStore()
  const rt = route.tab ? TAB_ALIAS[route.tab] || route.tab : 'overview'
  const tab = TABS.some((t) => t.id === rt) ? rt : 'overview'
  const p = db.projects.find((x) => x.id === op.projectId)!
  const { ro, reason } = useGuard(op.projectId)
  const pre = op.status === 'draft' || op.status === 'ready' || op.status === 'pending'
  const active = op.status === 'running' || op.status === 'paused'
  const [err, setErr] = useState('')
  const pl = op.planId ? db.plans.find((x) => x.id === op.planId) : undefined
  const startWhy = pid === 'all' ? SELECT_PROJECT : !can('run', op.projectId) ? 'Only a Manager or Operator can run preflight and start operations.' : ro ? reason : ''
  return (
    <div>
      <PageHeader title={<><Mono className="mr-2 text-muted">{op.id}</Mono>{op.name}</>}
        crumbs={[{ label: 'Operations', to: () => go('operations') }, { label: p.id, to: () => go('project', { id: p.id, tab: 'overview' }) }, { label: op.id }]}
        meta={<><RuntimeStatus op={op} />{staleOps[op.id] && <Status kind="generic" value="warn" label="Data may be stale" />}</>}
        sub={`Owner: ${op.owner} · Started: ${op.startedAt} · Updated: ${op.updated} (UTC+7) · ROE ${p.roeVersion}${ro ? ' · Read-only' : ''}${pl ? ` · Plan ${pl.id} ${planVer(pl)}` : ' · No plan'}`}
        actions={<>
          {pre && <Button icon={CalendarClock} onClick={() => go('operation-schedule', { id: op.id })}>Schedule</Button>}
          {pre && <Button icon={Wrench} disabled={!can('run', op.projectId) || ro} title={ro ? reason : !can('run', op.projectId) ? 'Only a Manager or Operator can edit operations.' : undefined} onClick={() => go('operation-new', { id: op.id })}>Edit Draft</Button>}
          {pre && <Button variant="primary" icon={ClipboardCheck} disabled={!!startWhy} title={startWhy || undefined} onClick={() => go('preflight', { id: op.id, tab: 'run' })}>Run Preflight</Button>}
          {active && tab !== 'live' && <Button variant="primary" icon={Radio} onClick={() => go('operation', { id: op.id, tab: 'live' })}>Open Live Workspace</Button>}
          {active && tab === 'overview' && <OpControls op={op} onError={setErr} />}
        </>} />
      {err && tab === 'overview' && <Banner tone="bad" title="Action could not be completed">{err}</Banner>}
      <OpLinks op={op} />
      <OpBanner op={op} />
      <Tabs tabs={TABS} value={tab} onChange={(t) => go('operation', { id: op.id, tab: t })} />
      {tab === 'overview' && <OverviewTab op={op} />}
      {tab === 'live' && <ConsoleTab op={op} />}
      {tab === 'agents' && <AgentsTab op={op} />}
      {tab === 'timeline' && <TimelineTab op={op} />}
      {tab === 'graph' && <GraphTab op={op} />}
      {tab === 'results' && <ResultsTab op={op} />}
    </div>
  )
}

/** Linked context: plan, conversation, branch group, runtime state, Open in AI Operator */
function OpLinks({ op }: { op: Operation }) {
  const { db, go } = useStore()
  const pl = op.planId ? db.plans.find((x) => x.id === op.planId) : undefined
  const conv = opConversation(db, op)
  const groups = opGroups(db, op.id)
  const none = <span className="text-neutral">None</span>
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-line bg-panel px-4 py-2.5 text-sm" aria-label="Linked context">
      <span className="text-xs text-muted">Runtime state <b className="text-fg">{op.id} · {runtimeText(op)}</b></span>
      <span className="whitespace-nowrap text-xs text-muted">Plan {pl ? <IdLink onClick={() => go('ai-plan-review', { id: pl.id })}>{pl.id} {planVer(pl)}</IdLink> : none}</span>
      <span className="whitespace-nowrap text-xs text-muted">Conversation {conv ? <IdLink onClick={() => go('ai-operator', { id: conv.id })}>{conv.id}</IdLink> : none}</span>
      <span className="whitespace-nowrap text-xs text-muted">Branch group {groups.length ? groups.map((g) => <IdLink key={g.id} onClick={() => go('ai-fanout', { id: g.id })}>{g.id}</IdLink>) : none}</span>
      <Button size="sm" className="ml-auto" icon={MessageSquare} disabled={!conv} title={conv ? undefined : 'This operation has no linked AI conversation.'} onClick={() => go('ai-operator', { id: conv!.id })}>Open in AI Operator</Button>
    </div>
  )
}

const Detail = () => <OpGate C={OperationDetail} />
const Preflight = () => <OpGate C={PreflightPage} />
const Schedule = () => <OpGate C={SchedulePage} />

export const routes: Record<string, ComponentType> = {
  operations: Operations,
  'operation-new': OperationNew,
  preflight: Preflight,
  'operation-schedule': Schedule,
  operation: Detail,
}

export { elapsed }
