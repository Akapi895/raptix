import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowRight, MessageSquare, CalendarClock, CheckCircle2, ClipboardCheck, Lock, Play, Plus, Radio, RefreshCw, ShieldAlert, SlidersHorizontal, ShieldCheck, ShieldX, Wrench, X, Save } from 'lucide-react'
import { ApprovalBanner, Banner, Button, Card, CardHeader, Check, DescList, Empty, Field, FilterBar, IdLink, Input, Mono, Pager, PageHeader, Person, PersonaHint, Progress, SearchBox, Segmented, Select, Skeleton, Status, Stepper, Table, Tabs, Textarea, Toggle, useGuard, cx } from '../../../ui/index'
import { useDirty } from '../../../state/session'
import { go, selectProject, useRoute } from '../../../router/navigate'
import { useActiveProject, useCan, useMe } from '../../../state/console'
import { useProjectStore, useToastStore, useUiStore } from '../../../state/stores'
import { useSessionStore } from '../../../state/session'
import { preflightPass } from '../preflight'
import { useOperationView, useProjectEligibility, useScheduleConflicts } from '../views'
import { planVer } from '../../../domain/catalog';
import type { Operation } from '../../../domain/entities'
import type { PfCheck, PfSnap, PfState } from './operation-common'
import { runtimeLabel as runtimeText, PF_LABEL, PF_TONE, OpGate, OpStatus, RuntimeStatus, pfOverall, fmtMs, fmtSched, parseStamp, planApprovalState, progressOf, schedMs, stepCounts, stepMinutes, windowIssue } from './operation-common'
import { AgentsTab, ConsoleTab, OpBanner, OpControls, OverviewTab, TimelineTab } from './operation-console'
import { GraphTab, ResultsTab } from './operation-results'
import { useResourceScope } from '../../../state/resource-scope'
import { useCreateOperation, useOperationDetail, useOperationDraftOptions, useOperationList, useOperationMockConsole, useRunPreflight, useScheduleOperation, useStartOperation, useUpdateOperation, OperationReadError } from '../query'
import { PROJECT_TZ_OFFSET_MS, roeWindowIssue, scheduleInstantOf } from '../service'
import type { OperationCategory, OperationDetailRead, OperationWriteRead } from '../service'
import type { ServiceResult } from '../../../domain/service'

const SELECT_PROJECT = 'Select a project to continue'
const STATUS_OPTS: [string, string][] = [['draft', 'Draft'], ['ready', 'Ready'], ['running', 'Running'], ['paused', 'Paused'], ['done', 'Completed'], ['cancelled', 'Stopped'], ['estop', 'Emergency stopped'], ['error', 'Error']]

/* ═════════════ OP-01 — Operations list (ticket 24: typed service read + Query) ═════════════ */
function Operations() {
  const pid = useProjectStore((s) => s.pid)
  const project = useActiveProject()
  const mock = useOperationMockConsole()
  const persistFilters = useSessionStore((s) => s.persistFilters)
  const setFilter = useSessionStore((s) => s.setFilter)
  const can = useCan()
  const toast = useToastStore((s) => s.toast)
  const f = { q: '', status: '', project: '', owner: '', ...(persistFilters.ops || {}) }
  const set = (patch: Partial<typeof f>) => setFilter('ops', { ...f, ...patch })
  const statusF: string = (persistFilters['operations.status'] as string) || f.status
  const techF: string = (persistFilters['operations.technique'] as string) || ''
  const [more, setMore] = useState(false)
  const [page, setPage] = useState(1)
  /* The one list read: scope-checked typed service; rows, counts, options and
     ready plans all derive from accessible canonical operations only. */
  const list = useOperationList({ status: statusF, technique: techF, q: f.q, project: f.project, owner: f.owner, page })
  const read = list.data
  const rows = read?.items ?? []
  const pages = read ? Math.max(1, Math.ceil(read.total / read.pageSize)) : 1
  const cur = Math.min(page, pages)
  const count = (v: string) => read?.counts[(v || 'all') as OperationCategory]
  const owners = read?.owners ?? []
  const { ro, reason } = useGuard(project?.id)
  const allProjects = pid === 'all'
  const canCreate = !allProjects && can('run') && !ro
  const createWhy = allProjects ? SELECT_PROJECT : ro ? reason : 'Only a Manager or Operator can create operations.'
  const eligRead = useProjectEligibility(project?.id ?? '')
  const elig = project ? eligRead : null
  const filtered = !!(f.q || statusF || techF || f.project || f.owner)
  const nMore = (f.owner ? 1 : 0) + (f.project ? 1 : 0)
  const clear = () => { set({ q: '', status: '', project: '', owner: '' }); setFilter('operations.status', ''); setFilter('operations.technique', '') }
  const setStatus = (v: string) => { setFilter('operations.status', v); set({ status: v }) }
  const noRunning = (o: Operation) => o.status === 'draft' || o.status === 'ready' || o.status === 'pending'
  /* Ticket 67 wave 4: the legacy A.executePlan entry, mirrored — the plan's
     project binding resolves through the plans feature's narrow read at call
     time and the bridge transaction runs with the store's exact request context. */
  const executePlan = (planId: string) => {
    const projectId = mock.planProject(planId)
    if (!projectId) return { ok: false, error: `Plan ${planId} does not exist.` }
    const res = mock.createOperationFromPlan(projectId, planId)
    return res.ok ? { ok: true as const, opId: res.data.opId } : { ok: false as const, error: res.failure.message }
  }
  return (
    <div>
      <PageHeader title="Operations" sub="Operations by project, status and owner. Drafts can always be saved; only preflight and start are gated."
        actions={!allProjects && <Button variant="primary" icon={Plus} disabled={!canCreate} title={canCreate ? undefined : createWhy} onClick={() => go('operation-new')}>Create Operation</Button>} />
      {project && ro && <Banner tone="info" icon={Lock}>{reason} You can view operations and results only.</Banner>}
      {elig && elig.kind === 'locked' && <Banner tone="warn" icon={Lock} title={`${elig.label} — operations can be drafted but not run`}>
        <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">{elig.reasons.map((r) => <li key={r.text} className="text-sm">{r.text}{r.to && <> · <button className="text-accent underline" onClick={() => go(r.to!.page, { id: r.to!.id, tab: r.to!.tab })}>Fix</button></>}</li>)}</ul>
      </Banner>}
      {(() => {
        const ready = allProjects ? [] : read?.readyPlans ?? []
        return ready.length > 0 && <Banner tone="info" icon={ClipboardCheck} title={`${ready.length} approved plan${ready.length === 1 ? '' : 's'} ready for an operation`}>
          <ul className="mt-1 space-y-1.5">{ready.map((pl) => <li key={pl.id} className="flex flex-wrap items-center gap-2 text-sm"><IdLink onClick={() => go('ai-plan-review', { id: pl.id })}>{pl.id} {pl.ver}</IdLink><span className="min-w-0 truncate">{pl.title}</span>
            <Button size="sm" variant="primary" disabled={!canCreate} title={canCreate ? 'Creates a draft operation from this approved plan. Preflight still has to pass before it can start.' : createWhy} onClick={() => { const r = executePlan(pl.id); if (r.ok && r.opId) { toast(`Draft ${r.opId} created from ${pl.id}. Run preflight before starting.`); go('operation', { id: r.opId, tab: 'overview' }) } else toast(r.error || 'Cannot create the operation.', 'bad') }}>Create Operation from plan</Button></li>)}</ul>
        </Banner>
      })()}
      {techF && <Banner tone="info" title={`Showing operations that test technique ${techF}`} action={<Button size="sm" onClick={() => setFilter('operations.technique', '')}>Clear technique filter</Button>}>Only operations with at least one step using this technique are listed.</Banner>}
      <FilterBar>
        <SearchBox value={f.q} onChange={(v) => set({ q: v })} placeholder="Search by ID or name…" className="w-60 max-w-full" />
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Operation category">
          {[['', 'All'], ['draft', 'Draft'], ['needs', 'Needs approval'], ['running', 'Running'], ['done', 'Completed']].map(([v, l]) => {
            const n = count(v)
            return <button key={v} onClick={() => setStatus(v)} aria-pressed={statusF === v} className={cx('h-9 whitespace-nowrap rounded-full border px-3 text-xs font-medium transition', statusF === v ? 'border-accent bg-accent-soft text-accent' : 'border-line text-muted hover:bg-hover')}>{l}{n !== undefined ? ` ${n}` : ''}</button>
          })}
        </div>
        <div className="relative">
          <Button icon={SlidersHorizontal} onClick={() => setMore(!more)} aria-expanded={more}>More filters{nMore ? ` (${nMore})` : ''}</Button>
          {more && (
            <div className="absolute left-0 top-full z-30 mt-1.5 w-72 space-y-3 rounded-xl border border-line bg-panel p-4 shadow-xl">
              <Field label="Owner"><Select aria-label="Filter by owner" value={f.owner} onChange={(e) => set({ owner: e.target.value })}><option value="">All owners</option>{owners.map((o) => <option key={o}>{o}</option>)}</Select></Field>
              {allProjects && <Field label="Project"><Select aria-label="Filter by project" value={f.project} onChange={(e) => set({ project: e.target.value })}><option value="">All projects</option>{(read?.projects ?? []).map((p) => <option key={p}>{p}</option>)}</Select></Field>}
              <Field label="Detailed status"><Select aria-label="Filter by status" value={STATUS_OPTS.some((s) => s[0] === statusF) ? statusF : ''} onChange={(e) => setStatus(e.target.value)}><option value="">Any</option>{STATUS_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
              <div className="flex justify-between"><Button size="sm" variant="ghost" onClick={clear}>Clear all</Button><Button size="sm" onClick={() => setMore(false)}>Done</Button></div>
            </div>
          )}
        </div>
        {filtered && <Button variant="ghost" icon={X} onClick={clear}>Clear filters</Button>}
      </FilterBar>
      {list.isError ? (
        <Empty icon={ShieldAlert} title="Operations could not be loaded" action={<Button onClick={() => list.refetch()}>Retry</Button>}>
          {list.error instanceof OperationReadError ? list.error.failure.message : 'Something went wrong while loading operations.'}
        </Empty>
      ) : list.isPending ? (
        <div className="space-y-2" aria-busy="true">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : (
        <>
          <Table rows={rows} rowKey={(it) => it.op.id} onRow={(it) => go('operation', { id: it.op.id, tab: 'overview' })}
            empty={<Empty icon={Radio} title={filtered ? 'No operations match the filters' : 'No operations in this project'} action={filtered ? <Button onClick={clear}>Clear filters</Button> : canCreate ? <Button variant="primary" icon={Plus} onClick={() => go('operation-new')}>Create Draft Operation</Button> : undefined}>{filtered ? 'Try relaxing the filters.' : allProjects ? SELECT_PROJECT + ' to draft an operation.' : 'You can draft an operation now. It cannot run until the ROE is approved, assets are in scope and agents are connected.'}</Empty>}
            cols={[
              { key: 'id', header: 'ID', className: 'whitespace-nowrap', render: (it) => <span className="whitespace-nowrap"><IdLink onClick={() => go('operation', { id: it.op.id, tab: 'overview' })}>{it.op.id}</IdLink></span> },
              { key: 'n', header: 'Operation', render: (it) => <div className="min-w-56"><div className="font-medium">{it.op.name}</div><div className="text-xs text-muted">{it.planLabel ? <span className="whitespace-nowrap">Plan {it.planLabel}</span> : it.playbookName || 'No plan or playbook yet'}{it.roeVersion ? <span className="whitespace-nowrap"> · {it.roeVersion}</span> : ''}{allProjects && <span className="whitespace-nowrap"> · {it.op.projectId}</span>}</div></div> },
              { key: 's', header: 'Status', className: 'whitespace-nowrap', render: (it) => <RuntimeStatus op={it.op} size="sm" /> },
              { key: 'o', header: 'Owner', hideBelow: 'lg', className: 'whitespace-nowrap', render: (it) => it.op.owner },
              { key: 'pr', header: 'Progress', width: '190px', render: (it) => {
                const o = it.op
                const c = stepCounts(o.steps); const v = progressOf(o.steps)
                if (noRunning(o)) { const e = it.eligibility; return <div className="text-xs"><div className="whitespace-nowrap text-muted">Not started{o.steps.length ? ` · ${o.steps.length} steps planned` : ' · no steps yet'}</div><div className={cx('whitespace-nowrap', e.kind === 'locked' ? 'text-bad' : 'text-muted')}>{e.label}</div></div> }
                return v == null ? <span className="text-xs text-muted">No data yet</span> : <div><div className="mb-1 whitespace-nowrap text-xs font-medium">{c.ok + c.fail}/{c.total} steps{c.review ? <span className="ml-1 font-normal text-warn">· {c.review} needs review</span> : ''}</div><Progress value={v} tone={c.fail || c.review ? 'warn' : 'accent'} label={`Progress ${o.id}`} /></div> } },
              { key: 'a', header: 'Agents', hideBelow: 'md', render: (it) => it.op.agents.length },
              { key: 'st', header: 'Started', hideBelow: 'lg', className: 'whitespace-nowrap', render: (it) => <Mono className="whitespace-nowrap text-muted">{it.op.startedAt}</Mono> },
              { key: 'ac', header: '', className: 'whitespace-nowrap', render: (it) => (it.op.status === 'running' || it.op.status === 'paused') ? <Button size="sm" icon={Radio} onClick={(e) => { e.stopPropagation(); go('operation', { id: it.op.id, tab: 'live' }) }}>Open Live Workspace</Button> : noRunning(it.op) ? <Button size="sm" onClick={(e) => { e.stopPropagation(); go('operation-new', { id: it.op.id }) }}>Edit Draft</Button> : <ArrowRight size={16} className="text-neutral" aria-hidden /> },
            ]} />
          <Pager page={cur} pages={pages} setPage={setPage} total={read?.total ?? 0} />
        </>
      )}
    </div>
  )
}

/* ───────────── Conflict panel (shared by wizard and schedule page). Candidate
   and stored instants are absolute (service boundary); the display converts to
   the project timezone's wall clock. ───────────── */
function ConflictPanel({ id, agents, assets, at, mins }: { id?: string; agents: string[]; assets: string[]; at: string; mins: number }) {
  const view = useOperationView(id || '')
  const mock = useOperationMockConsole()
  const inst = scheduleInstantOf(at)
  const nowInst = (parseStamp(mock.display.stamp()) ?? (inst ?? 0) + PROJECT_TZ_OFFSET_MS) - PROJECT_TZ_OFFSET_MS
  const cs = useScheduleConflicts({ id, agents, assets, at, mins, nowInst })
  if (inst == null) return null
  const win = roeWindowIssue(view?.project, inst)
  const past = inst < nowInst
  const disp = (i: number) => fmtMs(i + PROJECT_TZ_OFFSET_MS)
  return (
    <div className="space-y-2" aria-live="polite">
      <div className="text-xs text-muted">Estimated duration {mins} min · {disp(inst)} to {disp(inst + mins * 60000)}</div>
      {past && <Banner tone="warn" title="Start time is in the past">Choose a future time or start the operation manually after preflight.</Banner>}
      {win && <Banner tone="warn" icon={AlertTriangle} title="Outside the allowed window">{win} Pick a time inside the window or request an ROE window change.</Banner>}
      {cs.length > 0 && (
        <Banner tone="bad" icon={ShieldX} title={`${cs.length} scheduling conflict${cs.length === 1 ? '' : 's'}`}>
          <ul className="mt-1 space-y-1">
            {cs.map((c, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-2 text-sm">
                <span className="font-semibold">{c.kind === 'agent' ? 'Blocking' : 'Warning'}:</span>{c.label}
                <IdLink onClick={() => go('operation', { id: c.other.id, tab: 'overview' })}>{c.other.id}</IdLink>
                <span className="text-xs text-muted">overlap {disp(c.from)} – {disp(c.to)}</span>
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

/* ═════════════ OP-02 — Create / edit wizard ═════════════ */
const STEPS = ['Basics', 'Playbook', 'Targets and agents', 'Schedule and mode', 'Review']
function OperationNew() {
  const mock = useOperationMockConsole()
  const route = useRoute()
  const pid = useProjectStore((s) => s.pid)
  const project = useActiveProject()
  const me = useMe()
  const pfx = useSessionStore((s) => s.persistFilters)
  const setFx = useSessionStore((s) => s.setFilter)
  const setDirty = useSessionStore((s) => s.setDirty)
  const setSwitcherOpen = useUiStore((s) => s.setSwitcherOpen)
  const can = useCan()
  const toast = useToastStore((s) => s.toast)
  /* The edited operation, its project and linked plan come from the typed
     operation view; an unknown or inaccessible id reads as the create flow. */
  const editV = useOperationView(route.id || '')
  const edit = editV?.op
  const projectId = edit?.projectId || (pid !== 'all' ? pid : '')
  const p = editV?.project || project
  const { ro, reason } = useGuard(projectId || undefined)
  /* Ticket 25: the selectable options are scoped by the typed service — only
     approved playbooks, eligible agents and approved in-scope assets reach the
     form; the write re-validates every selection at the boundary. */
  const draft = useOperationDraftOptions(edit?.id)
  const options = draft.data
  const createOp = useCreateOperation()
  const updateOp = useUpdateOperation()
  const members = p ? [...new Set([p.owner, ...p.members.filter((m) => m.role === 'manager' || m.role === 'operator').map((m) => m.user)])] : []
  const init = {
    name: edit?.name || '', owner: edit?.owner || (p && members.includes(me.name) ? me.name : p?.owner || ''), desc: '', objective: p?.objectives[0]?.id || '', newObj: '',
    playbookId: edit?.playbookId || (pfx['operation-new.playbook'] as string) || '', agents: edit?.agents || [], assets: edit?.assets || (pfx['operation-new.assets'] as string[]) || [],
    mode: edit?.mode || 'Manual with confirmation', when: edit?.schedule && edit.schedule !== 'now' ? 'later' : 'now', at: edit?.schedule && edit.schedule !== 'now' ? edit.schedule : '', needConfirm: true, note: '',
  }
  const [d, setD] = useState(init)
  const [step, setStep] = useState(0)
  const [submitErr, setSubmitErr] = useState('')
  useEffect(() => { if (pfx['operation-new.playbook']) setFx('operation-new.playbook', undefined); if (pfx['operation-new.assets']) setFx('operation-new.assets', undefined) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const isDirty = JSON.stringify(d) !== JSON.stringify(init)
  const pb = options?.playbooks.find((x) => x.id === d.playbookId)
  const upd = (patch: Partial<typeof d>) => setD((s) => ({ ...s, ...patch }))
  const toggle = (k: 'agents' | 'assets', id: string) => upd({ [k]: d[k].includes(id) ? d[k].filter((x) => x !== id) : [...d[k], id] } as Partial<typeof d>)

  const agentRows = options?.agents ?? []
  const agentIssue = (id: string) => {
    const row = agentRows.find((x) => x.agent.id === id)
    if (!row) return ''
    if (row.issue) return row.issue
    if (pb && !pb.os.includes(row.agent.os)) return `Incompatible: playbook supports ${pb.os.join(', ')}, agent runs ${row.agent.os}.`
    return ''
  }
  const assetRows = options?.assets ?? []
  const mins = edit ? stepMinutes(edit) : Math.max(20, (pb?.steps.length || 8) * 7)
  const nowMs = parseStamp(mock.display.stamp()) ?? 0
  const conflicts = useScheduleConflicts({ id: edit?.id, agents: d.agents, assets: d.assets, at: d.when === 'later' ? d.at : '', mins, nowInst: nowMs - PROJECT_TZ_OFFSET_MS })

  const roeLocked = !!p && (p.roeStatus !== 'approved' || !['approved', 'active'].includes(p.status))
  const allowed = !!p && can('run', projectId) && !ro
  /* Non-blocking hints: everything here is needed to RUN, never to SAVE a draft */
  const errs: Record<number, Record<string, string>> = {
    0: { name: !d.name.trim() ? 'No name yet. A draft is saved as "Untitled draft operation" until you name it.' : '' },
    1: { pb: !pb && !edit?.planId ? 'Needed before preflight: choose an approved playbook or link an approved AI plan.' : '' },
    2: {
      assets: d.assets.length === 0 ? 'Needed before preflight: select at least one approved in-scope asset. You can still save this draft.' : '',
      agents: d.agents.length === 0 ? 'Needed before preflight: assign at least one agent. You can still save this draft.' : d.agents.some((a) => agentIssue(a)) ? 'Some selected agents are not valid. Deselect them or choose others.' : '',
    },
    3: {
      at: d.when === 'later' ? (!d.at ? 'Choose a start time, or switch to manual start.' : windowIssue(p ?? undefined, schedMs(d.at)) || (conflicts.some((c) => c.kind === 'agent') ? 'An agent is already reserved at this time.' : '')) : '',
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
    if (d.assets.length === 0) blockers.push({ text: assetRows.some((r) => r.asset.scope === 'in') ? 'No target assets selected.' : 'This project has 0 approved assets in scope.', to: assetRows.some((r) => r.asset.scope === 'in') ? undefined : { page: 'assets' } })
    if (d.agents.length === 0) blockers.push({ text: 'No agents assigned.', to: { page: 'agents' } })
    if (!pb && !edit?.planId) blockers.push({ text: 'No approved playbook or AI plan chosen.', to: { page: 'playbooks' } })
  }
  const preflightWhy = !allowed ? (ro ? reason : 'Only a Manager or Operator can run preflight.') : blockers.length ? `Run Preflight is unavailable: ${blockers[0].text}${blockers.length > 1 ? ` (+${blockers.length - 1} more)` : ''}` : ''

  const submit = (to: 'preflight' | 'detail') => {
    if (!p) return
    if (to === 'preflight' && preflightWhy) { toast(preflightWhy, 'bad'); return }
    setSubmitErr('')
    const schedule = d.when === 'now' ? 'now' : d.at
    const name = d.name.trim() || 'Untitled draft operation'
    /* A typed failure renders its reason beside the form and keeps every entry —
       no navigation, no duplicate write. Success publishes a ChangeSet the list observes. */
    const saved = (r: ServiceResult<OperationWriteRead>, id: string) => {
      if (!r.ok) { setSubmitErr(r.failure.message); toast(r.failure.message, 'bad'); return }
      setDirty(false)
      toast(edit ? 'Draft saved. Preflight must be run again before starting.' : `Draft ${id} saved. No commands were issued and nothing is reserved.`, edit ? 'warn' : undefined)
      setTimeout(() => go(to === 'preflight' ? 'preflight' : 'operation', { id, tab: to === 'preflight' ? 'run' : 'overview' }), 60)
    }
    const obj = d.objective === '__new' ? d.newObj : p.objectives.find((o) => o.id === d.objective)?.text || ''
    if (edit) {
      updateOp.mutate(
        { id: edit.id, patch: { name, owner: d.owner, playbookId: d.playbookId, agents: d.agents, assets: d.assets, mode: d.mode, schedule } },
        { onSuccess: (r) => saved(r, edit.id) },
      )
    } else {
      createOp.mutate(
        { name, owner: d.owner, desc: d.desc, objective: obj, playbookId: d.playbookId, agents: d.agents, assets: d.assets, mode: d.mode, schedule, needConfirm: d.needConfirm, note: d.note },
        { onSuccess: (r) => saved(r, r.ok ? r.data.op.id : '') },
      )
    }
  }
  useDirty(isDirty, () => submit('detail'))

  if (edit && ['running', 'paused', 'done', 'cancelled', 'estop'].includes(edit.status)) return <Empty icon={Lock} title="This operation cannot be edited" action={<Button onClick={() => go('operation', { id: edit.id })}>Back to operation</Button>}>Only operations in Draft or Ready status can be edited.</Empty>
  if (edit && pid !== 'all' && pid !== edit.projectId) return <Empty icon={Lock} title="Operation belongs to a different project" action={<Button variant="primary" onClick={() => selectProject(edit.projectId)}>Switch to {edit.projectId}</Button>}>Switch to the right project before editing.</Empty>
  if (!p) {
    return (
      <div>
        <PageHeader title="Create Operation" back={{ label: 'Operations', to: () => go('operations') }} />
        <Empty icon={ShieldAlert} title="No project selected" action={<Button variant="primary" onClick={() => setSwitcherOpen(true)}>Select a project</Button>}>An operation always belongs to exactly one project (ROE, scope and agents are per project). {SELECT_PROJECT}. Operations cannot be created in All Projects mode.</Empty>
      </div>
    )
  }
  const pl = editV?.plan
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
              <Select value={d.playbookId} onChange={(e) => upd({ playbookId: e.target.value, agents: d.agents.filter((a) => { const row = agentRows.find((x) => x.agent.id === a); const np = options?.playbooks.find((x) => x.id === e.target.value); return !row || !np || np.os.includes(row.agent.os) }) })}>
                <option value="">— Choose a playbook —</option>
                {(options?.playbooks ?? []).map((x) => <option key={x.id} value={x.id}>{x.name} v{x.version}</option>)}
              </Select>
            </Field>
            {pb && <div className="mt-3 rounded-lg border border-line bg-bg p-4"><DescList cols={3} items={[{ k: 'Version', v: <Mono>v{pb.version}</Mono> }, { k: 'Steps', v: pb.steps.length }, { k: 'Compatible platforms', v: pb.os.join(', ') }, { k: 'ATT&CK techniques', v: <span className="font-mono text-xs">{pb.techniques.join(', ')}</span> }, { k: 'Objective', v: pb.goal }, { k: 'Preflight', v: 'PRE-01 to PRE-08 must pass' }]} /></div>}
          </>)}
          {step === 2 && sec(<>
            <div className="mb-2 text-xs font-medium text-muted">In-scope assets <span className="text-bad">*</span></div>
            <ul className="mb-1 divide-y divide-line/60 rounded-lg border border-line">
              {assetRows.length === 0 && <li className="p-4 text-sm text-muted">{options ? 'This project has no assets. Add assets in the Assets section.' : 'Loading assets…'}</li>}
              {assetRows.map(({ asset: a, issue }) => (
                <li key={a.id} className={cx('flex min-h-12 flex-wrap items-center gap-3 px-4 py-2', issue && 'opacity-70')}>
                  <Check checked={d.assets.includes(a.id)} disabled={!!issue} onChange={() => toggle('assets', a.id)} label={<span><span className="font-medium">{a.name}</span> <Mono className="text-muted">{a.ident}</Mono></span>} />
                  <span className="ml-auto flex items-center gap-2">{issue && <span className="text-xs text-bad max-sm:basis-full">{issue}</span>}<Status kind="scope" value={a.scope} size="sm" /></span>
                </li>))}
            </ul>
            {stepErr(show(2, 'assets'))}
            <div className="mb-2 mt-5 text-xs font-medium text-muted">Agents <span className="text-bad">*</span> <span className="font-normal">(project agents and unassigned pool agents)</span></div>
            <ul className="mb-1 divide-y divide-line/60 rounded-lg border border-line">
              {agentRows.map(({ agent: a }) => { const iss = agentIssue(a.id); return (
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
            {d.when === 'later' && d.at && <div className="md:col-span-2"><ConflictPanel id={edit?.id} agents={d.agents} assets={d.assets} at={d.at} mins={mins} /></div>}
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
              { k: 'Assets', v: d.assets.map((a) => assetRows.find((x) => x.asset.id === a)?.asset.name).join(', ') || '—' },
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
          {submitErr && <Banner tone="bad" icon={ShieldX} title="The draft could not be saved">{submitErr} Your entries are kept — fix the issue and save again.</Banner>}
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
  const view = useOperationView(op.id)
  const pid = useProjectStore((s) => s.pid)
  const route = useRoute()
  const persistFilters = useSessionStore((s) => s.persistFilters)
  const setFilter = useSessionStore((s) => s.setFilter)
  const can = useCan()
  const toast = useToastStore((s) => s.toast)
  const mock = useOperationMockConsole()
  const { ro, reason } = useGuard(op.projectId)
  const [checking, setChecking] = useState(false)
  /* Ticket 26: the run goes through the typed handler — the eight checks are
     re-derived from canonical state at the handler, so the recorded snapshot
     can never outlive the records it was derived from. */
  const runPf = useRunPreflight()
  /* Ticket 27: the start control is the typed lifecycle mutation — the gate
     is re-derived at click time, so a policy change between render and click
     is refused with its reason instead of starting. */
  const startOp = useStartOperation()
  /* rules-of-hooks: registered before the not-found early return; the guard
     keeps the pre-return render a no-op exactly like the missing call did. */
  useEffect(() => { if (!view) return; if (route.tab === 'run' && !snap && allowed && !started) run() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  if (!view) return null
  const p = view.project
  const pb = view.playbook
  const pl = view.plan
  const pfNow = mock.now()
  const { spec: live, engine } = mock.checks(op, pfNow)
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
    runPf.mutate({ id: op.id }, { onSuccess: (r) => {
      setChecking(false)
      /* A refusal (role, in-flight, superseded scope) surfaces its reason and
         records nothing; a run re-derives the checks and commits atomically. */
      if (!r.ok) { toast(r.failure.message, 'bad'); return }
      const cs = mock.checks(op, mock.now()).spec
      setFilter('preflight.' + op.id, { at: mock.display.stamp(), roe: p.roeVersion, plan: planV, checks: cs } as PfSnap)
      toast(pfOverall(cs) === 'fail' ? 'Preflight finished with failures. Start is unavailable.' : 'Preflight snapshot recorded.', pfOverall(cs) === 'fail' ? 'bad' : 'info')
    } })
  }
  const approver = view.approvals.find((a) => a.status === 'approved')
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
          <Button variant={ok ? 'primary' : 'secondary'} icon={Play} disabled={!ok || startOp.isPending} title={ok ? undefined : startWhy} onClick={() => startOp.mutate({ id: op.id }, { onSuccess: (r) => {
            /* The handler re-derived the gate at click time; a refusal renders
               its reason and the operation stays unstarted. A success binds
               the reservations atomically and navigates to the live console. */
            if (!r.ok) { toast(r.failure.message, 'bad'); return }
            toast(`Operation ${op.id} started.`)
            go('operation', { id: op.id, tab: 'live' })
          } })}>Start Operation</Button>
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
  const view = useOperationView(op.id)
  const mock = useOperationMockConsole()
  const can = useCan()
  const toast = useToastStore((s) => s.toast)
  const { ro, reason } = useGuard(op.projectId)
  /* Ticket 25: the schedule write is a typed service mutation — validated,
     atomic, and published as a ChangeSet; a refusal renders its reason and
     keeps the chosen input. */
  const scheduleOp = useScheduleOperation()
  const [saveErr, setSaveErr] = useState('')
  const [mode, setMode] = useState<'now' | 'later'>(op.schedule && op.schedule !== 'now' ? 'later' : 'now')
  const [at, setAt] = useState(op.schedule && op.schedule !== 'now' ? op.schedule : '')
  const mins = stepMinutes(op)
  const nowInst = (parseStamp(mock.display.stamp()) ?? 0) - PROJECT_TZ_OFFSET_MS
  const inst = scheduleInstantOf(at)
  const conflicts = useScheduleConflicts(mode === 'later' ? { id: op.id, agents: op.agents, assets: op.assets, at, mins, nowInst } : { agents: [], assets: [], at: '', mins, nowInst })
  if (!view) return null
  const p = view.project
  const locked = ['running', 'paused', 'done', 'cancelled', 'estop', 'error'].includes(op.status)
  const allowed = can('run', op.projectId) && !ro && !locked
  const blocking = conflicts.filter((c) => c.kind === 'agent').length
  const win = mode === 'later' && inst != null ? roeWindowIssue(p, inst) : ''
  const why = locked ? 'The operation has already started and cannot be rescheduled.' : ro ? reason : !can('run', op.projectId) ? 'Only a Manager or Operator can schedule operations.'
    : mode === 'later' && !at ? 'Choose a start time.' : win ? win : mode === 'later' && inst != null && inst < nowInst ? 'Start time is in the past.' : blocking ? 'An agent is already reserved at this time. Choose a different time.' : ''
  const save = () => {
    setSaveErr('')
    scheduleOp.mutate({ id: op.id, at: mode === 'now' ? 'now' : at }, {
      onSuccess: (r) => {
        if (!r.ok) { setSaveErr(r.failure.message); return }
        toast(mode === 'now' ? 'Schedule cleared. Start manually after preflight.' : `Scheduled for ${fmtSched(at)}. Preflight must be re-run.`, 'info')
        go('preflight', { id: op.id })
      },
    })
  }
  const others = view.siblings.filter((o) => o.id !== op.id && (o.status === 'running' || o.status === 'paused' || (o.schedule && o.schedule !== 'now' && ['draft', 'ready'].includes(o.status))))
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
              {mode === 'later' && at && <ConflictPanel id={op.id} agents={op.agents} assets={op.assets} at={at} mins={mins} />}
            </fieldset>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <Button variant="primary" icon={CalendarClock} disabled={!allowed || !!why} title={!allowed ? (locked ? why : ro ? reason : 'You cannot schedule operations.') : why || undefined} onClick={save}>Save schedule</Button>
              <Button onClick={() => go('preflight', { id: op.id })}>Back to preflight</Button>
              {why && allowed && <span className="text-xs text-warn">{why}</span>}
            </div>
            {saveErr && <Banner tone="bad" icon={ShieldX} title="Schedule could not be saved">{saveErr}</Banner>}
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Reserved resources" />
            <DescList cols={1} items={[{ k: 'Agents', v: op.agents.join(', ') || '—' }, { k: 'Assets', v: op.assets.map((a) => view.assets.find((x) => x.id === a)?.name || a).join(', ') || '—' }, { k: 'Estimated duration', v: `${mins} min (${op.steps.length || 8} steps)` }, { k: 'Current schedule', v: op.schedule && op.schedule !== 'now' ? fmtSched(op.schedule) : 'Manual start' }]} />
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
function OperationDetail({ d }: { d: OperationDetailRead }) {
  const route = useRoute()
  const staleOps = useSessionStore((s) => s.staleOps)
  const pid = useProjectStore((s) => s.pid)
  const can = useCan()
  const op = d.op
  const p = d.project
  const rt = route.tab ? TAB_ALIAS[route.tab] || route.tab : 'overview'
  const tab = TABS.some((t) => t.id === rt) ? rt : 'overview'
  const { ro, reason } = useGuard(op.projectId)
  const pre = op.status === 'draft' || op.status === 'ready' || op.status === 'pending'
  const active = op.status === 'running' || op.status === 'paused'
  const [err, setErr] = useState('')
  const pl = d.plan
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
      <OpLinks d={d} />
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

/** Linked context: plan, conversation, branch group, runtime state, Open in AI Operator.
 *  Ticket 26: plan, conversation and branch groups come from the canonical detail read. */
function OpLinks({ d }: { d: OperationDetailRead }) {
  const op = d.op
  const pl = d.plan
  const conv = d.conversation
  const groups = d.branchGroups
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

/** Detail route (ticket 26): one scope-checked canonical read replaces the
 *  direct store lookup. Loading shows a skeleton; a refusal renders the
 *  handler's reason — with the switch affordance only for members addressing
 *  the operation from another specific project (no existence leak). */
const Detail = () => {
  const route = useRoute()
  const pid = useProjectStore((s) => s.pid)
  const read = useOperationDetail(route.id || '')
  useResourceScope(read.data?.op.projectId)
  if (read.isPending) return <div className="space-y-2" aria-busy="true"><Skeleton className="h-14" /><Skeleton className="h-24" /><Skeleton className="h-64" /></div>
  if (read.isError || !read.data) {
    const failure = read.error instanceof OperationReadError ? read.error.failure : undefined
    const target = failure?.entity?.projectId
    if (target && pid !== 'all' && pid !== target) {
      return (
        <Empty icon={ShieldX} title="Operation belongs to a different project" action={<Button variant="primary" onClick={() => selectProject(target)}>Switch to {target}</Button>}>
          Operation {route.id ? <span className="font-mono">{route.id}</span> : ''} belongs to project {target}. To avoid mixing data between projects, switch to that project before viewing it.
        </Empty>
      )
    }
    return (
      <Empty icon={ShieldAlert} title="Operation not found" action={<Button onClick={() => go('operations')}>Back to operations</Button>}>
        {failure?.message || <>Operation {route.id ? <span className="font-mono">{route.id}</span> : ''} does not exist or has been removed.</>}
      </Empty>
    )
  }
  return <OperationDetail d={read.data} />
}
const Preflight = () => <OpGate C={PreflightPage} />
const Schedule = () => <OpGate C={SchedulePage} />

export { Operations, OperationNew, Preflight, Schedule, Detail }

