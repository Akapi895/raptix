import { useMemo, useState } from 'react'
import type { ComponentType, ReactNode } from 'react'
import { AlertTriangle, Ban, CheckCircle2, CircleDashed, Clock, HelpCircle, Layers, Loader2, PauseCircle, RotateCcw, ShieldQuestion, Users, XCircle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { allocation, groupSummary, useStore } from '../store'
import { BRANCH_LABEL, BRANCH_TERMINAL, toolFacets } from '../data'
import type { Agent, Branch, BranchState, WorkerState } from '../data'
import { Banner, Button, Card, CardHeader, DescList, Drawer, Empty, Field, Gated, IdLink, Kpi, Modal, Mono, PageHeader, SearchBox, Segmented, Select, Status, Table, Textarea, Timeline, cx } from '../ui'
import { NoProject, tz } from './g-common'

/* ───────── shared helpers ───────── */
const TONE: Record<string, string> = {
  ok: 'text-ok bg-ok-soft border-ok/30', warn: 'text-warn bg-warn-soft border-warn/30', bad: 'text-bad bg-bad-soft border-bad/30',
  cyan: 'text-cyan bg-info-soft border-cyan/30', neutral: 'text-muted bg-subtle border-line',
}
const BR_META: Record<BranchState, [string, LucideIcon]> = {
  pending: ['neutral', CircleDashed], queued: ['neutral', Clock], waiting_approval: ['warn', Clock], running: ['cyan', Loader2], completed: ['ok', CheckCircle2],
  failed: ['bad', XCircle], blocked: ['bad', Ban], paused: ['warn', PauseCircle], cancelled: ['neutral', Ban], unknown: ['warn', HelpCircle],
}
export function BranchStatus({ state }: { state: string }) {
  const m = BR_META[state as BranchState]
  const [tone, I] = m || ['neutral', CircleDashed]
  return (
    <span className={cx('inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-xs font-medium', TONE[tone])}>
      <I size={13} className={state === 'running' ? 'motion-safe:animate-spin' : ''} aria-hidden />{BRANCH_LABEL[state as BranchState] || state}
    </span>
  )
}
const isConn = (a?: Agent) => !!a && (a.status === 'online' || a.status === 'idle')
const APPROVAL_LABEL: Record<Branch['approval'], string> = { none: 'Not required', pending: 'Pending', approved: 'Approved', denied: 'Denied' }
const goTrace = (ev?: string) => { window.location.hash = ev ? `#/ai-trace?event=${encodeURIComponent(ev)}` : '#/ai-trace' }

function useLinks() {
  const { go, db } = useStore()
  return {
    agent: (id: string) => <IdLink onClick={() => go('agent', { id })}>{id}</IdLink>,
    op: (id: string) => <IdLink onClick={() => go('operation', { id })}>{id}</IdLink>,
    ev: (id: string) => <IdLink onClick={() => go('evidence', { id })}>{id}</IdLink>,
    tl: (id: string) => <IdLink onClick={() => goTrace(id)}>{id}</IdLink>,
    branch: (id: string) => <IdLink onClick={() => go('ai-branch', { id })}>{id}</IdLink>,
    plan: (id: string) => <IdLink onClick={() => go('ai-plan', { id })}>{id}</IdLink>,
    target: (name: string) => {
      const a = db.assets.find((x) => x.name === name || x.ident === name)
      return a ? <IdLink onClick={() => go('asset', { id: a.id })}>{name}</IdLink> : <Mono>{name}</Mono>
    },
  }
}

/** Proposed valid replacement for a branch whose agent is disconnected. */
function replacementFor(db: ReturnType<typeof useStore>['db'], b: Branch) {
  const cands = db.agents.filter((a) => a.projectId === b.projectId && isConn(a) && a.id !== b.agent)
  const load = (id: string) => db.branches.filter((x) => x.agent === id && !BRANCH_TERMINAL.includes(x.state)).length
  return cands.sort((x, y) => load(x.id) - load(y.id))[0]
}

/* ───────── Compact card ───────── */
export function FanOutCard({ groupId }: { groupId: string }) {
  const { db, go } = useStore()
  const g = db.branchGroups.find((x) => x.id === groupId)
  if (!g) return <Card><div className="text-sm text-muted">Branch group {groupId} was not found.</div></Card>
  const s = groupSummary(db, groupId)
  const degraded = s.paused + s.unknown > 0
  return (
    <Card>
      <CardHeader title={<span className="flex flex-wrap items-center gap-2"><Layers size={16} aria-hidden />Multi-agent fan-out <Mono>{g.id}</Mono></span>}
        sub={<>Plan {g.planId} {g.planVer} · {g.opId} · parent step {g.parentStep}</>}
        actions={<span className={cx('inline-flex h-6 items-center whitespace-nowrap rounded-full border px-2.5 text-xs font-medium', TONE[degraded ? 'warn' : s.overall === 'Completed' ? 'ok' : s.overall === 'Partially Completed' ? 'bad' : 'cyan'])}>{s.overall}</span>} />
      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <span><b>{s.total}</b> branches</span><span><b>{s.running}</b> running</span><span><b>{s.done}</b> completed</span>
        <span className={s.failed ? 'text-bad' : ''}><b>{s.failed}</b> failed</span><span><b>{s.waiting}</b> waiting approval</span>
        {degraded && <span className="text-warn"><b>{s.paused + s.unknown}</b> paused / unknown</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => go('ai-fanout', { id: g.id, tab: 'table' })}>View Branches</Button>
        <Button size="sm" variant="primary" onClick={() => go('ai-fanout', { id: g.id, tab: 'graph' })}>Open Execution Graph</Button>
        <Button size="sm" onClick={() => goTrace()}>View Trace</Button>
      </div>
      <p className="mt-2 text-xs text-muted">Demo Data — simulated branch states; progress is shown only when measured.</p>
    </Card>
  )
}

/* ───────── Allocation view ───────── */
type AllocFilter = 'all' | 'connected' | 'busy' | 'available' | 'disc'
export function AllocationView({ projectId }: { projectId: string }) {
  const { db, go } = useStore()
  const L = useLinks()
  const [f, setF] = useState<AllocFilter>('all')
  const al = allocation(db, projectId)
  const conn = al.all.filter(isConn)
  const lists: Record<AllocFilter, Agent[]> = { all: al.all, connected: conn, busy: al.busy, available: al.avail, disc: al.disc }
  const maxC = Math.max(2, ...db.branchGroups.filter((g) => g.projectId === projectId).map((g) => g.maxConcurrency))
  const parallel = Math.min(al.capacity, maxC)
  const pick = (k: AllocFilter) => setF(f === k ? 'all' : k)
  const list = lists[f]
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="Total agents" value={al.total} onClick={() => pick('all')} sub={f === 'all' ? 'Showing all' : 'Show all'} />
        <Kpi label="Connected" value={al.connected} tone="ok" onClick={() => pick('connected')} sub="Heartbeat present" />
        <Kpi label="Busy" value={al.busy.length} tone="cyan" onClick={() => pick('busy')} sub="Reserved / running" />
        <Kpi label="Available" value={al.avail.length} tone="ok" onClick={() => pick('available')} sub="Connected and free" />
        <Kpi label="Disconnected" value={al.disc.length} tone={al.disc.length ? 'bad' : undefined} onClick={() => pick('disc')} sub="Not assignable" />
      </div>
      <Card>
        <CardHeader title="Fan-out capacity" sub="Simulated allocation context — no real scheduling occurs" />
        <div className="text-sm"><b>{parallel}</b> parallel branch{parallel === 1 ? '' : 'es'} can start now (min of {al.capacity} available agents and concurrency policy max {maxC}).</div>
        <p className="mt-1 text-xs text-muted">Capacity depends on agent capability (OS / tool support), reservations, concurrency policy (max {maxC}), target restrictions and task type. Connected is not the same as Available: a connected agent that is busy or reserved cannot take a new branch. Disconnected agents are never counted or auto-assigned.</p>
      </Card>
      {f !== 'all' && <div className="flex items-center gap-2 text-sm text-muted">Filter: <b className="text-fg">{f === 'disc' ? 'Disconnected' : f[0].toUpperCase() + f.slice(1)}</b> ({list.length})<Button size="sm" onClick={() => setF('all')}>Reset</Button></div>}
      {list.length === 0 ? (
        <Empty icon={Users} title="No agents match this filter" action={<Button onClick={() => setF('all')}>Show all agents</Button>}>Try another KPI card, or request an agent assignment from Agents.</Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((a) => {
            const c = isConn(a)
            const shared = !a.projectId
            const brs = db.branches.filter((b) => b.agent === a.id && !BRANCH_TERMINAL.includes(b.state))
            const state = !c ? 'Disconnected' : a.op ? 'Busy' : shared ? 'Available · Shared pool' : 'Available'
            const tone = !c ? 'bad' : a.op ? 'cyan' : 'ok'
            return (
              <Card key={a.id}>
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0"><div className="flex items-center gap-2">{L.agent(a.id)}</div><div className="truncate text-sm font-medium">{a.host}</div></div>
                  <span className={cx('inline-flex h-6 items-center whitespace-nowrap rounded-full border px-2.5 text-xs font-medium', TONE[tone])}>{state}</span>
                </div>
                <DescList cols={1} items={[
                  { k: 'Capability', v: `${a.os} · agent ${a.version}` },
                  { k: 'Reservation', v: a.op ? L.op(a.op) : 'None' },
                  { k: 'Branch', v: brs.length ? <span className="flex flex-wrap gap-2">{brs.map((b) => <span key={b.id}>{L.branch(b.id)}</span>)}</span> : 'None' },
                  { k: 'Heartbeat', v: tz(a.lastSeen) },
                  { k: 'Project', v: shared ? 'Shared pool' : a.projectId },
                ]} />
                {!c && <Banner tone="warn" title="Stale data">Last heartbeat {tz(a.lastSeen)}. Status may be out of date. This agent is not Available and will not be auto-assigned.</Banner>}
                {c && shared && <p className="mt-2 text-xs text-muted">Available in this project's allocation context. Requires an assignment request before it can take project work.</p>}
                <div className="mt-3"><Button size="sm" onClick={() => go('agent', { id: a.id })}>View Agent</Button></div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ───────── Branch detail (drawer + page share) ───────── */
function BranchBody({ b }: { b: Branch }) {
  const { db, can } = useStore()
  const L = useLinks()
  const [modal, setModal] = useState<'retry' | 'reassign' | 'cancel' | null>(null)
  const tool = db.toolEvents.find((t) => t.id === b.toolEventId)
  const f = tool ? toolFacets(tool) : null
  const agent = db.agents.find((a) => a.id === b.agent)
  const lost = !!agent && !isConn(agent)
  const repl = lost ? replacementFor(db, b) : undefined
  const allowed = can('run', b.projectId)
  const why = 'Your role cannot run or modify operations in this project.'
  const terminal = BRANCH_TERMINAL.includes(b.state)
  const retryOk = ['failed', 'cancelled', 'unknown', 'paused'].includes(b.state) && !b.pendingRequest
  const retryWhy = b.pendingRequest ? `A ${b.pendingRequest} request is already pending approval.` : 'Only failed, cancelled, paused or unknown branches can be retried.'
  const reOk = !['completed', 'cancelled'].includes(b.state) && !b.pendingRequest
  const reWhy = b.pendingRequest ? `A ${b.pendingRequest} request is already pending approval.` : `A ${BRANCH_LABEL[b.state]} branch cannot be reassigned.`
  const cancelOk = !terminal
  const audits = db.audit.filter((a) => a.obj === b.id || a.corr === b.corr)
  const timeline = [...b.timeline.map((t) => ({ at: tz(t.at), title: t.text })), ...[]]
  const act = (ok: boolean, whyNot: string, el: ReactNode) => <Gated allowed={allowed && ok} reason={!allowed ? why : whyNot}>{el}</Gated>
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2"><BranchStatus state={b.state} />
        {b.pendingRequest && <span className={cx('inline-flex h-6 items-center whitespace-nowrap rounded-full border px-2.5 text-xs font-medium', TONE.warn)}>{b.pendingRequest === 'retry' ? 'Retry' : 'Reassignment'} pending approval</span>}
        <span className="text-xs text-muted">Demo Data — simulated</span></div>
      {lost && (b.state === 'paused' || b.state === 'unknown') && (
        <Banner tone="bad" title={`Agent ${b.agent} disconnected — branch ${BRANCH_LABEL[b.state]}`}>
          {b.state === 'unknown' ? 'The branch result is unknown because the agent lost its heartbeat. Do not assume it completed.' : 'The branch is paused until an agent is available.'}{' '}
          {repl ? <>Proposed valid replacement: {L.agent(repl.id)} ({repl.host}), connected and assigned to this project. Replacement still requires approval.</> : 'No eligible connected project agent is available as a replacement.'}
        </Banner>
      )}
      <DescList items={[
        { k: 'Branch', v: <Mono>{b.id}</Mono> }, { k: 'Group', v: <IdLinkGroup id={b.groupId} /> },
        { k: 'Agent', v: <span className="flex items-center gap-2">{L.agent(b.agent)}{lost && <span className="text-xs text-bad">Disconnected</span>}</span> }, { k: 'Target', v: L.target(b.target) },
        { k: 'Operation', v: L.op(b.opId) }, { k: 'Plan step', v: `${b.stepId}` },
        { k: 'Task / tool', v: <Mono>{b.tool}</Mono> }, { k: 'Started', v: b.start ? tz(b.start) : 'Not started' },
        { k: 'Duration', v: b.dur || 'Unknown' }, { k: 'Progress', v: b.progress != null ? `${b.progress}% (measured)` : 'Unknown' },
      ]} />
      <section><h4 className="mb-1 text-sm font-semibold">Tool events</h4>
        {tool ? <div className="flex flex-wrap items-center gap-2 text-sm">{L.tl(tool.id)}<Mono>{tool.tool}</Mono></div> : <p className="text-sm text-muted">No tool event recorded yet.</p>}</section>
      <section><h4 className="mb-1 text-sm font-semibold">Policy decision</h4>
        <p className="text-sm">{b.policy}</p>
        {f ? <div className="mt-1 flex flex-wrap gap-2 text-xs"><span>Policy: <b>{f.policy}</b></span><span>Approval: <b>{f.approval}</b></span><span>Execution: <b>{f.exec}</b></span></div> : <p className="text-xs text-muted">Not evaluated.</p>}
        <p className="mt-1 text-xs text-muted">Policy Allowed is not the same as Executed.</p></section>
      <section><h4 className="mb-1 text-sm font-semibold">Approval history</h4>
        <div className="text-sm">Current approval: <b>{APPROVAL_LABEL[b.approval]}</b></div>
        {audits.length ? <ul className="mt-1 space-y-1 text-xs text-muted">{audits.map((a) => <li key={a.id}><Mono>{a.id}</Mono> · {a.action} · {a.actor} · {a.result}{a.reason ? ` — ${a.reason}` : ''}</li>)}</ul> : <p className="text-xs text-muted">No approval decisions recorded for this branch.</p>}</section>
      <section><h4 className="mb-1 text-sm font-semibold">Output summary</h4>
        <p className="text-sm">{b.output || (terminal ? 'No output.' : 'No output yet.')}</p></section>
      <section><h4 className="mb-1 text-sm font-semibold">Evidence</h4>
        {b.evidence.length ? <div className="flex flex-wrap gap-3">{b.evidence.map((e) => <span key={e}>{L.ev(e)}</span>)}</div> : <p className="text-sm text-muted">No evidence captured.</p>}</section>
      {b.error && <Banner tone="bad" title="Error">{b.error} A failed branch does not make the operation a success.</Banner>}
      <section><h4 className="mb-1 text-sm font-semibold">Timeline</h4>
        {timeline.length ? <Timeline items={timeline} /> : <p className="text-sm text-muted">No events yet.</p>}</section>
      <section><h4 className="mb-1 text-sm font-semibold">Assignment log</h4>
        <Timeline items={b.assignLog.map((t) => ({ at: tz(t.at), title: t.text }))} /></section>
      <div className="flex flex-wrap gap-2 border-t border-line pt-3">
        <Button size="sm" onClick={() => L && window.location.assign(`#/agent/${b.agent}`)}>View Agent</Button>
        <Button size="sm" onClick={() => { const a = db.assets.find((x) => x.name === b.target || x.ident === b.target); window.location.assign(a ? `#/asset/${a.id}` : '#/assets') }}>View Target</Button>
        <Button size="sm" onClick={() => goTrace(b.toolEventId)}>View Trace</Button>
        <Button size="sm" disabled={!b.evidence.length} title={b.evidence.length ? undefined : 'This branch has no evidence.'} onClick={() => window.location.assign(`#/evidence/${b.evidence[0]}`)}>View Evidence</Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {act(retryOk, retryWhy, <Button size="sm" icon={RotateCcw} onClick={() => setModal('retry')}>Request Retry</Button>)}
        {act(reOk, reWhy, <Button size="sm" onClick={() => setModal('reassign')}>Request Reassignment</Button>)}
        {act(cancelOk, `A ${BRANCH_LABEL[b.state]} branch is already finished and cannot be cancelled.`, <Button size="sm" variant="danger" onClick={() => setModal('cancel')}>Cancel Branch</Button>)}
      </div>
      <p className="text-xs text-muted">Retry and reassignment never bypass approval or preflight. No real commands are executed.</p>
      <RetryModal b={b} open={modal === 'retry'} onClose={() => setModal(null)} />
      <ReassignModal b={b} open={modal === 'reassign'} onClose={() => setModal(null)} />
      <CancelModal b={b} open={modal === 'cancel'} onClose={() => setModal(null)} />
    </div>
  )
}
function IdLinkGroup({ id }: { id: string }) {
  const { go } = useStore()
  return <IdLink onClick={() => go('ai-fanout', { id })}>{id}</IdLink>
}

function RetryModal({ b, open, onClose }: { b: Branch; open: boolean; onClose: () => void }) {
  const { A, toast } = useStore()
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')
  const submit = () => {
    if (!reason.trim()) return setErr('A reason is required.')
    A.requestBranchRetry(b.id, reason.trim()); toast(`Retry requested for ${b.id}. Pending approval — nothing has run.`); setReason(''); setErr(''); onClose()
  }
  return (
    <Modal open={open} onClose={onClose} title={`Request retry — ${b.id}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit}>Submit request</Button></>}>
      <p className="mb-3 text-sm text-muted">The retry is queued as <b>pending approval</b>. It must pass approval and preflight again before anything can run.</p>
      <Field label="Reason" required error={err}><Textarea value={reason} onChange={(e) => { setReason(e.target.value); setErr('') }} placeholder="Why should this branch be retried?" /></Field>
    </Modal>
  )
}
function ReassignModal({ b, open, onClose }: { b: Branch; open: boolean; onClose: () => void }) {
  const { db, A, toast } = useStore()
  const [agent, setAgent] = useState('')
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')
  const cands = db.agents.filter((a) => a.projectId === b.projectId && a.id !== b.agent)
  const submit = () => {
    if (!agent) return setErr('Choose an agent.')
    if (!reason.trim()) return setErr('A reason is required.')
    const r = A.reassignBranch(b.id, agent, reason.trim())
    if (!r.ok) return setErr(r.error || 'Reassignment is not allowed.')
    toast(`Reassignment of ${b.id} to ${agent} requested. Pending approval.`); setAgent(''); setReason(''); setErr(''); onClose()
  }
  return (
    <Modal open={open} onClose={onClose} title={`Request reassignment — ${b.id}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit}>Submit request</Button></>}>
      <p className="mb-3 text-sm text-muted">Currently assigned to <Mono>{b.agent}</Mono>. The old assignment stays in the assignment log. Only connected agents assigned to this project are eligible.</p>
      <div className="space-y-3">
        <Field label="New agent" required>
          <Select value={agent} onChange={(e) => { setAgent(e.target.value); setErr('') }}>
            <option value="">Select an agent…</option>
            {cands.map((a) => <option key={a.id} value={a.id}>{a.id} · {a.host}{isConn(a) ? '' : ' (disconnected)'}</option>)}
          </Select>
        </Field>
        <Field label="Reason" required><Textarea value={reason} onChange={(e) => { setReason(e.target.value); setErr('') }} placeholder="Why reassign this branch?" /></Field>
        {err && <div role="alert" className="text-sm text-bad">{err}</div>}
      </div>
    </Modal>
  )
}
function CancelModal({ b, open, onClose }: { b: Branch; open: boolean; onClose: () => void }) {
  const { A, toast, db } = useStore()
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')
  const g = groupSummary(db, b.groupId)
  const submit = () => {
    if (!reason.trim()) return setErr('A reason is required.')
    A.cancelBranch(b.id, reason.trim()); toast(`${b.id} cancelled.`); setReason(''); setErr(''); onClose()
  }
  return (
    <Modal danger open={open} onClose={onClose} title={`Cancel branch — ${b.id}`} footer={<><Button onClick={onClose}>Keep branch</Button><Button variant="danger" onClick={submit}>Cancel branch</Button></>}>
      <Banner tone="warn" title="Impact">Cancelling stops this branch only; the other {g.total - 1} branches continue. The fan-in step {b.stepId === 'S12' ? '' : 'S12 '}will be missing this branch's result, so the group can end as Partially Completed, not Completed.</Banner>
      <div className="mt-3"><Field label="Reason" required error={err}><Textarea value={reason} onChange={(e) => { setReason(e.target.value); setErr('') }} placeholder="Why cancel this branch?" /></Field></div>
    </Modal>
  )
}

export function BranchDrawer({ branchId, onClose }: { branchId: string; onClose: () => void }) {
  const { db, go } = useStore()
  const b = db.branches.find((x) => x.id === branchId)
  return (
    <Drawer open onClose={onClose} width={560} title={<span className="flex items-center gap-2">Branch Inspector <Mono>{branchId}</Mono></span>}
      footer={<Button onClick={() => go('ai-branch', { id: branchId })}>Open full page</Button>}>
      {b ? <BranchBody b={b} /> : <Empty title="Branch not found">{branchId} does not exist.</Empty>}
    </Drawer>
  )
}

export function BranchPage() {
  const { db, route, go, pid } = useStore()
  const b = db.branches.find((x) => x.id === route.id)
  const crumbs = [{ label: 'AI Operator', to: () => go('ai-operator') }, { label: 'Execution Graph', to: () => go('ai-fanout', { id: b?.groupId || 'BG-014-01' }) }, { label: route.id || 'Branch' }]
  if (!b) return <><PageHeader title="Branch Inspector" crumbs={crumbs} /><Empty title="Branch not found" action={<Button onClick={() => go('ai-fanout', { id: 'BG-014-01' })}>Back to Execution Graph</Button>}>{route.id || 'No branch'} does not exist or was removed.</Empty></>
  if (pid !== 'all' && b.projectId !== pid) return <><PageHeader title="Branch Inspector" crumbs={crumbs} /><Empty icon={ShieldQuestion} title="Branch belongs to another project" action={<Button onClick={() => go('ai-operator')}>Back to AI Operator</Button>}>Switch project to view {b.id}.</Empty></>
  return (
    <>
      <PageHeader title={<span className="flex items-center gap-2">Branch <Mono>{b.id}</Mono></span>} crumbs={crumbs} back={{ label: 'Execution Graph', to: () => go('ai-fanout', { id: b.groupId }) }} />
      <Card><BranchBody b={b} /></Card>
    </>
  )
}

/* ───────── Execution graph ───────── */
const NW = 176, NH = 64, LH = 92, COLW = 200
function Graph({ groupId, onSelect }: { groupId: string; onSelect: (id: string) => void }) {
  const { db } = useStore()
  const g = db.branchGroups.find((x) => x.id === groupId)!
  const bs = db.branches.filter((b) => b.groupId === groupId)
  const lanes = [...new Set(bs.map((b) => b.agent))]
  const idx: Record<string, number> = {}
  const pos = bs.map((b) => { const l = lanes.indexOf(b.agent); const i = (idx[b.agent] = (idx[b.agent] ?? -1) + 1); return { b, x: 220 + i * COLW, y: 28 + l * LH } })
  const maxX = Math.max(...pos.map((p) => p.x)) + NW
  const aggX = maxX + 60
  const W = aggX + NW + 20, H = Math.max(1, lanes.length) * LH + 40
  const midY = H / 2 - NH / 2
  const edge = (x1: number, y1: number, x2: number, y2: number, dashed?: boolean, key?: string) => (
    <path key={key} d={`M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`} fill="none" className={dashed ? 'stroke-line' : 'stroke-muted'} strokeWidth={1.5} strokeDasharray={dashed ? '5 4' : undefined} />
  )
  const nodeCls = (s: BranchState) => cx('absolute rounded-lg border bg-panel p-2 text-left text-xs shadow-sm transition hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent',
    s === 'failed' || s === 'blocked' ? 'border-bad' : s === 'paused' || s === 'unknown' || s === 'waiting_approval' ? 'border-warn' : s === 'completed' ? 'border-ok' : 'border-line')
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-subtle">
      <div className="relative" style={{ width: W, height: H }}>
        {lanes.map((l, i) => <div key={l} className="absolute left-0 right-0 border-b border-dashed border-line" style={{ top: 20 + i * LH, height: LH }}><span className="absolute left-2 top-1 text-[11px] font-medium text-muted">Lane {l}</span></div>)}
        <svg className="absolute inset-0" width={W} height={H} aria-hidden>
          {pos.map((p) => edge(20 + NW, midY + NH / 2, p.x, p.y + NH / 2, false, 'a' + p.b.id))}
          {pos.map((p) => edge(p.x + NW, p.y + NH / 2, aggX, midY + NH / 2, p.b.state !== 'completed', 'b' + p.b.id))}
        </svg>
        <div className="absolute rounded-lg border border-line bg-panel p-2 text-xs" style={{ left: 20, top: midY, width: NW, height: NH }}>
          <div className="font-semibold">Parent step {g.parentStep}</div><div className="text-muted">Fan-out · max {g.maxConcurrency} concurrent</div></div>
        {pos.map(({ b, x, y }) => (
          <button key={b.id} onClick={() => onSelect(b.id)} aria-label={`Open branch ${b.id}, ${BRANCH_LABEL[b.state]}`} className={nodeCls(b.state)} style={{ left: x, top: y, width: NW, height: NH }}>
            <div className="flex items-center justify-between gap-1"><Mono className="!text-xs">{b.id}</Mono><span className="whitespace-nowrap font-medium">{BRANCH_LABEL[b.state]}</span></div>
            <div className="truncate text-muted">{b.tool}</div><div className="truncate text-muted">{b.target}</div>
          </button>
        ))}
        <div className="absolute rounded-lg border border-line bg-panel p-2 text-xs" style={{ left: aggX, top: midY, width: NW, height: NH }}>
          <div className="font-semibold">Fan-in step {g.aggStep}</div><div className="text-muted">Aggregation — waits for all branches</div></div>
      </div>
    </div>
  )
}

/* ───────── Fan-in panel + results inspector ───────── */
function FanIn({ groupId }: { groupId: string }) {
  const { db } = useStore()
  const L = useLinks()
  const s = groupSummary(db, groupId)
  const [open, setOpen] = useState(false)
  const complete = s.open === 0 && s.failed === 0 && s.missing === 0
  const evidence = s.bs.flatMap((b) => b.evidence)
  const status = complete ? 'Completed' : s.open > 0 ? 'Waiting for branches' : 'Partially Completed'
  return (
    <Card>
      <CardHeader title="Fan-in" sub={`Aggregation step — ${s.done} of ${s.total} branches returned results`} actions={<Button size="sm" variant="primary" onClick={() => setOpen(true)}>View Aggregated Results</Button>} />
      <DescList cols={3} items={[
        { k: 'Completed', v: s.done }, { k: 'Failed', v: <span className={s.failed ? 'text-bad' : ''}>{s.failed}</span> }, { k: 'Missing results', v: s.missing },
        { k: 'Evidence items', v: evidence.length }, { k: 'Conflicts', v: complete ? 'None reported' : 'Not assessed' }, { k: 'Confidence', v: 'Not assessed' },
        { k: 'Fan-in status', v: <b>{status}</b> },
      ]} />
      {!complete && <p className="mt-2 text-xs text-muted">Partially Completed is not Completed. A failed or missing branch never makes the operation a success.</p>}
      <Drawer open={open} onClose={() => setOpen(false)} width={520} title="Aggregated Results Inspector">
        <div className="space-y-4">
          <Banner tone={complete ? 'ok' : 'warn'} title={status}>{complete ? 'All branches returned results.' : `${s.missing} branch(es) have no final result. Aggregated data below is incomplete. Confidence not assessed.`}</Banner>
          <section><h4 className="mb-1 text-sm font-semibold">Completed branches</h4>
            {s.bs.filter((b) => b.state === 'completed').map((b) => <div key={b.id} className="mb-2 text-sm"><div className="flex items-center gap-2">{L.branch(b.id)}<span className="text-muted">{b.tool} → {b.target}</span></div><div className="text-muted">{b.output}</div></div>)}
            {!s.done && <p className="text-sm text-muted">None yet.</p>}</section>
          <section><h4 className="mb-1 text-sm font-semibold">Failed branches</h4>
            {s.bs.filter((b) => b.state === 'failed').map((b) => <div key={b.id} className="mb-2 text-sm"><div className="flex items-center gap-2">{L.branch(b.id)}<BranchStatus state={b.state} /></div><div className="text-bad">{b.error}</div></div>)}
            {!s.failed && <p className="text-sm text-muted">None.</p>}</section>
          <section><h4 className="mb-1 text-sm font-semibold">Missing / pending</h4>
            {s.bs.filter((b) => !['completed', 'failed'].includes(b.state)).map((b) => <div key={b.id} className="mb-1 flex items-center gap-2 text-sm">{L.branch(b.id)}<BranchStatus state={b.state} /></div>)}
          </section>
          <section><h4 className="mb-1 text-sm font-semibold">Evidence</h4>
            {evidence.length ? <div className="flex flex-wrap gap-3">{evidence.map((e) => <span key={e}>{L.ev(e)}</span>)}</div> : <p className="text-sm text-muted">No evidence.</p>}</section>
        </div>
      </Drawer>
    </Card>
  )
}

/* ───────── Fan-out page ───────── */
const ALL = 'all'
export function FanOutPage() {
  const { db, route, go, pid, can } = useStore()
  const L = useLinks()
  const initial = route.tab === 'table' || /view=table/.test(window.location.hash) ? 'table' : 'graph'
  const [view, setView] = useState<'graph' | 'table'>(initial)
  const [sel, setSel] = useState<string | null>(null)
  const [q, setQ] = useState(''); const [st, setSt] = useState(ALL); const [ag, setAg] = useState(ALL); const [tg, setTg] = useState(ALL); const [tl, setTl] = useState(ALL); const [ap, setAp] = useState(ALL)
  const gid = route.id || db.branchGroups.find((g) => pid === 'all' || g.projectId === pid)?.id
  const g = db.branchGroups.find((x) => x.id === gid)
  const crumbs = [{ label: 'AI Operator', to: () => go('ai-operator') }, { label: 'Execution Graph' }]
  const bs = useMemo(() => db.branches.filter((b) => b.groupId === gid), [db.branches, gid])
  if (!g) return <><PageHeader title="Execution Graph" crumbs={crumbs} />{pid === 'all' ? <NoProject /> : <Empty icon={Layers} title="No branch group in this project" action={<Button onClick={() => go('ai-operator')}>Back to AI Operator</Button>}>Fan-out appears when an approved plan has parallel branches.</Empty>}</>
  if (pid !== 'all' && g.projectId !== pid) return <><PageHeader title="Execution Graph" crumbs={crumbs} /><Empty icon={ShieldQuestion} title="Branch group belongs to another project" action={<Button onClick={() => go('ai-operator')}>Back to AI Operator</Button>}>Switch project to view {g.id}.</Empty></>
  const s = groupSummary(db, g.id)
  const agents = [...new Set(bs.map((b) => b.agent))], targets = [...new Set(bs.map((b) => b.target))], tools = [...new Set(bs.map((b) => b.tool))]
  const rows = bs.filter((b) => (st === ALL || b.state === st) && (ag === ALL || b.agent === ag) && (tg === ALL || b.target === tg) && (tl === ALL || b.tool === tl) && (ap === ALL || b.approval === ap) && (!q.trim() || `${b.id} ${b.tool} ${b.target} ${b.agent}`.toLowerCase().includes(q.trim().toLowerCase())))
  const filtered = st !== ALL || ag !== ALL || tg !== ALL || tl !== ALL || ap !== ALL || !!q
  const reset = () => { setQ(''); setSt(ALL); setAg(ALL); setTg(ALL); setTl(ALL); setAp(ALL) }
  const lostBr = bs.filter((b) => { const a = db.agents.find((x) => x.id === b.agent); return !!a && !isConn(a) && ['paused', 'unknown'].includes(b.state) })
  const lostAgents = [...new Set(lostBr.map((b) => b.agent))]
  const pending = bs.filter((b) => b.approval === 'pending').length
  const sel_ = <T extends string>(v: string, set: (x: string) => void, label: string, opts: T[], fmt: (x: T) => string = (x) => x) => (
    <Select aria-label={label} value={v} onChange={(e) => set(e.target.value)} className="!w-40"><option value={ALL}>{label}: all</option>{opts.map((o) => <option key={o} value={o}>{fmt(o)}</option>)}</Select>
  )
  const opState = s.open > 0 ? 'In progress' : s.failed ? 'Partially Completed' : 'Completed'
  void can
  return (
    <>
      <PageHeader title={<span className="flex items-center gap-2">Execution Graph <Mono>{g.id}</Mono></span>} crumbs={crumbs} back={{ label: 'AI Operator', to: () => go('ai-operator') }} meta={<span className="text-xs text-muted">Demo Data — simulated</span>} />
      {lostAgents.length > 0 && (
        <div className="mb-4"><Banner tone="bad" title={`Group impact — agent ${lostAgents.join(', ')} disconnected`}>
          {lostBr.length} branch(es) are Paused or Unknown and will not auto-complete. {lostBr.map((b) => { const r = replacementFor(db, b); return <span key={b.id}>{L.branch(b.id)}: {r ? <>proposed replacement {L.agent(r.id)}</> : 'no eligible replacement'}. </span> })}
          Open a branch to request reassignment (approval required).</Banner></div>
      )}
      <div className="space-y-4">
        <Card>
          <DescList cols={3} items={[
            { k: 'Group ID', v: <Mono>{g.id}</Mono> }, { k: 'Plan', v: <span className="flex items-center gap-2">{L.plan(g.planId)} {g.planVer}</span> }, { k: 'Operation', v: L.op(g.opId) },
            { k: 'Parent step', v: g.parentStep }, { k: 'Fan-in step', v: g.aggStep }, { k: 'Overall state', v: <b>{s.overall}</b> },
            { k: 'Objective', v: g.objective }, { k: 'Branches', v: s.total }, { k: 'Allocated agents', v: <span className="flex flex-wrap gap-2">{agents.map((a) => <span key={a}>{L.agent(a)}</span>)}</span> },
            { k: 'Running / completed / failed', v: `${s.running} / ${s.done} / ${s.failed}` }, { k: 'Approvals', v: `${pending} pending of ${s.total}` }, { k: 'Operation outcome', v: opState },
            { k: 'Policy constraints', v: <ul className="list-disc pl-4">{g.policy.map((p) => <li key={p}>{p}</li>)}</ul> },
          ]} />
          {s.failed > 0 && <p className="mt-2 text-xs text-bad">A failed branch never makes the operation a success.</p>}
        </Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented options={[{ id: 'graph', label: 'Graph' }, { id: 'table', label: 'Table' }]} value={view} onChange={setView} />
          <div className="flex gap-2"><Button size="sm" onClick={() => goTrace()}>View Trace</Button><Button size="sm" onClick={() => go('operation', { id: g.opId })}>Open Operation</Button></div>
        </div>
        {view === 'graph' ? <Graph groupId={g.id} onSelect={setSel} /> : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <SearchBox value={q} onChange={setQ} placeholder="Search branch ID, tool, target" className="w-64" />
              {sel_(st, setSt, 'Status', ['pending', 'queued', 'waiting_approval', 'running', 'completed', 'failed', 'blocked', 'paused', 'cancelled', 'unknown'] as BranchState[], (x) => BRANCH_LABEL[x])}
              {sel_(ag, setAg, 'Agent', agents)}{sel_(tg, setTg, 'Target', targets)}{sel_(tl, setTl, 'Tool', tools)}
              {sel_(ap, setAp, 'Approval', ['none', 'pending', 'approved', 'denied'] as Branch['approval'][], (x) => APPROVAL_LABEL[x])}
              <Button size="sm" disabled={!filtered} title={filtered ? undefined : 'No filters applied.'} onClick={reset}>Reset</Button>
            </div>
            <Table dense rows={rows} rowKey={(b) => b.id} onRow={(b) => setSel(b.id)}
              empty={<Empty title="No branches match the filters" action={<Button onClick={reset}>Reset filters</Button>}>Try relaxing the filters.</Empty>}
              cols={[
                { key: 'id', header: 'Branch', render: (b) => <IdLink onClick={() => go('ai-branch', { id: b.id })}>{b.id}</IdLink> },
                { key: 'ag', header: 'Agent', render: (b) => L.agent(b.agent) },
                { key: 'tg', header: 'Target', render: (b) => <span className="whitespace-nowrap">{b.target}</span> },
                { key: 'tool', header: 'Task / tool', render: (b) => <span className="whitespace-nowrap">{b.tool}</span> },
                { key: 'st', header: 'State', render: (b) => <BranchStatus state={b.state} /> },
                { key: 'start', header: 'Start', render: (b) => <span className="whitespace-nowrap">{b.start ? tz(b.start) : '—'}</span> },
                { key: 'dur', header: 'Duration', render: (b) => <span className="whitespace-nowrap">{b.dur || '—'}</span> },
                { key: 'pr', header: 'Progress', render: (b) => <span className="whitespace-nowrap">{b.progress != null ? `${b.progress}%` : 'Unknown'}</span> },
                { key: 'ev', header: 'Evidence', render: (b) => b.evidence.length },
                { key: 'le', header: 'Last event', render: (b) => <span className="block max-w-64 truncate" title={b.lastEvent}>{b.lastEvent || '—'}</span> },
                { key: 'ap', header: 'Approval', render: (b) => <span className="whitespace-nowrap">{APPROVAL_LABEL[b.approval]}</span> },
              ]} />
          </>
        )}
        <FanIn groupId={g.id} />
      </div>
      {sel && <BranchDrawer branchId={sel} onClose={() => setSel(null)} />}
    </>
  )
}

/* ───────── AI team ───────── */
const WK_TONE: Record<WorkerState, string> = { idle: 'neutral', working: 'cyan', waiting: 'warn', done: 'ok', failed: 'bad' }
export function AiTeamView({ projectId }: { projectId: string }) {
  const { db, go } = useStore()
  const rows = db.aiWorkers.filter((w) => w.projectId === projectId)
  return (
    <div className="space-y-3">
      <Banner tone="info" title="AI workers — separate from execution agents">AI workers draft, review and summarize inside the AI Operator. They are not AG-xxx execution agents and never run commands on targets. Demo Data — simulated.</Banner>
      <Table rows={rows} rowKey={(w) => w.id}
        empty={<Empty icon={Users} title="No AI workers in this project" action={<Button onClick={() => go('ai-operator')}>Open AI Operator</Button>}>Workers appear when the AI Operator starts a multi-step task.</Empty>}
        cols={[
          { key: 'id', header: 'Worker', render: (w) => <Mono className="whitespace-nowrap">{w.id}</Mono> },
          { key: 'role', header: 'Role', render: (w) => <span className="whitespace-nowrap font-medium">{w.role}</span> },
          { key: 'task', header: 'Task', render: (w) => w.task },
          { key: 'st', header: 'State', render: (w) => <span className={cx('inline-flex h-6 items-center whitespace-nowrap rounded-full border px-2.5 text-xs font-medium capitalize', TONE[WK_TONE[w.state]])}>{w.state}</span> },
          { key: 'in', header: 'Inputs', render: (w) => <span className="text-sm">{w.inputs.join(', ')}</span> },
          { key: 'out', header: 'Output artifact', render: (w) => w.output },
          { key: 'par', header: 'Parent', render: (w) => w.parent ? <Mono>{w.parent}</Mono> : '—' },
          { key: 'dep', header: 'Dependencies', render: (w) => w.deps.length ? <Mono>{w.deps.join(', ')}</Mono> : '—' },
        ]} />
      <p className="text-xs text-muted">Model: {rows[0]?.model || 'Demo model (simulated)'} — no real AI backend.</p>
    </div>
  )
}

export const routes: Record<string, ComponentType> = { 'ai-fanout': FanOutPage, 'ai-branch': BranchPage }
void AlertTriangle; void Status
