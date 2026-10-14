/**
 * Fanout surfaces (ticket 43, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * The execution graph, branch inspector and branch actions run on the typed
 * branch service (src/features/branches): group/branch reads go through the
 * scope-keyed Query binding (ChangeSet invalidation and cancel-on-switch come
 * from the shared bridges), and retry/reassign/cancel are typed mutations that
 * publish a ChangeSet both the legacy store and Query consumers observe.
 * Retry/reassign are requests — the UI never presents them as execution, and
 * the handlers preserve the source branch's approval/preflight waiting states.
 * Navigation goes through the router (`go`) — there are no raw hash writers
 * left on this surface. FanOutCard/AllocationView keep their legacy seams for
 * their consumers (tickets 39–44 own the shared workspace); the AI-team view
 * itself lives in src/screens/g-workers.tsx (ticket 44), imported directly
 * by the workspace Inspector.
 */
import { useState } from 'react'
import type { ComponentType, ReactNode } from 'react'
import { Ban, CheckCircle2, CircleDashed, Clock, HelpCircle, Layers, Loader2, PauseCircle, RotateCcw, ShieldQuestion, Users, XCircle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { BRANCH_LABEL, BRANCH_TERMINAL } from '../data'
import type { Agent, Branch, BranchState, Db } from '../data'
import { BranchReadError, useBranch, useBranchGroup, useBranchGroups, useCancelBranch, useReassignBranch, useRetryBranch } from '../features/branches/query'
import type { BranchCounts, BranchRow } from '../features/branches/service'
import type { BranchGroup } from '../domain/entities'
import { go, useRoute } from '../router/navigate'
import { useCan, useDb } from '../state/console'
import { useToastStore } from '../state/stores'
import { Banner, Button, Card, CardHeader, DescList, Drawer, Empty, Field, Gated, IdLink, Kpi, Modal, Mono, PageHeader, SearchBox, Segmented, Select, Table, Textarea, Timeline, cx } from '../ui'
import { tz } from './g-common'

/* ───────── shared helpers ───────── */
/* Ticket 67: the fanout derivations moved here from the legacy store — this
   surface is their only consumer, so the store no longer exports them. */
function allocation(db: Db, projectId: string) {
  const mine = db.agents.filter((a) => a.projectId === projectId)
  const pool = db.agents.filter((a) => !a.projectId && (a.status === 'online' || a.status === 'idle'))
  const all = [...mine, ...pool]
  const conn = (a: Agent) => a.status === 'online' || a.status === 'idle'
  const busy = all.filter((a) => conn(a) && a.op)
  const avail = all.filter((a) => conn(a) && !a.op)
  const disc = all.filter((a) => !conn(a))
  return { all, mine, pool, busy, avail, disc, total: all.length, connected: all.filter(conn).length, capacity: avail.length }
}
function groupSummary(db: Db, groupId: string) {
  const bs = db.branches.filter((b) => b.groupId === groupId)
  const n = (st: BranchState) => bs.filter((b) => b.state === st).length
  const done = n('completed'), failed = n('failed')
  const open = bs.filter((b) => !BRANCH_TERMINAL.includes(b.state)).length
  const missing = bs.length - done - failed - n('cancelled') - n('blocked')
  const overall = open > 0 ? (n('unknown') + n('paused') > 0 ? 'Degraded — branches paused or unknown' : 'In progress') : failed + n('blocked') > 0 ? 'Partially Completed' : 'Completed'
  return { bs, total: bs.length, running: n('running'), done, failed, waiting: n('waiting_approval'), queued: n('queued'), paused: n('paused'), unknown: n('unknown'), missing, open, overall, evidence: bs.reduce((a, b) => a + b.evidence.length, 0) }
}
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

function useLinks() {
  const db = useDb()
  return {
    agent: (id: string) => <IdLink onClick={() => go('agent', { id })}>{id}</IdLink>,
    op: (id: string) => <IdLink onClick={() => go('operation', { id })}>{id}</IdLink>,
    ev: (id: string) => <IdLink onClick={() => go('evidence', { id })}>{id}</IdLink>,
    tl: (id: string) => <IdLink onClick={() => go('ai-trace', { id })}>{id}</IdLink>,
    branch: (id: string) => <IdLink onClick={() => go('ai-branch', { id })}>{id}</IdLink>,
    plan: (id: string) => <IdLink onClick={() => go('ai-plan', { id })}>{id}</IdLink>,
    target: (name: string) => {
      const a = db.assets.find((x) => x.name === name || x.ident === name)
      return a ? <IdLink onClick={() => go('asset', { id: a.id })}>{name}</IdLink> : <Mono>{name}</Mono>
    },
  }
}

/* ───────── Compact card ───────── */
export function FanOutCard({ groupId }: { groupId: string }) {
  const db = useDb()
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
        <Button size="sm" onClick={() => go('ai-trace')}>View Trace</Button>
      </div>
      <p className="mt-2 text-xs text-muted">Demo Data — simulated branch states; progress is shown only when measured.</p>
    </Card>
  )
}

/* ───────── Allocation view ───────── */
type AllocFilter = 'all' | 'connected' | 'busy' | 'available' | 'disc'
export function AllocationView({ projectId }: { projectId: string }) {
  const db = useDb()
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
function BranchBody({ id }: { id: string }) {
  const can = useCan()
  const L = useLinks()
  const q = useBranch(id)
  const retry = useRetryBranch()
  const reassign = useReassignBranch()
  const cancel = useCancelBranch()
  const [modal, setModal] = useState<'retry' | 'reassign' | 'cancel' | null>(null)
  if (q.isPending) return <p className="py-6 text-sm text-muted">Loading branch…</p>
  if (q.isError) {
    const f = (q.error as BranchReadError).failure
    return <Empty icon={f.kind === 'forbidden' ? ShieldQuestion : undefined} title={f.kind === 'forbidden' ? 'Branch belongs to another project' : 'Branch not found'} action={f.kind === 'forbidden' ? <Button onClick={() => go('ai-operator')}>Back to AI Operator</Button> : undefined}>{f.message}</Empty>
  }
  const d = q.data
  const b = d.branch
  const lost = !d.agentConnected
  const repl = d.replacement
  const allowed = can('run', b.projectId)
  const why = 'Your role cannot run or modify operations in this project.'
  const terminal = BRANCH_TERMINAL.includes(b.state)
  const retryOk = ['failed', 'cancelled', 'unknown', 'paused'].includes(b.state) && !b.pendingRequest
  const retryWhy = b.pendingRequest ? `A ${b.pendingRequest} request is already pending approval.` : 'Only failed, cancelled, paused or unknown branches can be retried.'
  const reOk = !['completed', 'cancelled'].includes(b.state) && !b.pendingRequest
  const reWhy = b.pendingRequest ? `A ${b.pendingRequest} request is already pending approval.` : `A ${BRANCH_LABEL[b.state]} branch cannot be reassigned.`
  const cancelOk = !terminal
  const timeline = b.timeline.map((t) => ({ at: tz(t.at), title: t.text }))
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
        {d.toolEvent ? <div className="flex flex-wrap items-center gap-2 text-sm">{L.tl(d.toolEvent.id)}<Mono>{d.toolEvent.tool}</Mono></div> : <p className="text-sm text-muted">No tool event recorded yet.</p>}</section>
      <section><h4 className="mb-1 text-sm font-semibold">Policy decision</h4>
        <p className="text-sm">{b.policy}</p>
        {d.facets ? <div className="mt-1 flex flex-wrap gap-2 text-xs"><span>Policy: <b>{d.facets.policy}</b></span><span>Approval: <b>{d.facets.approval}</b></span><span>Execution: <b>{d.facets.exec}</b></span></div> : <p className="text-xs text-muted">Not evaluated.</p>}
        <p className="mt-1 text-xs text-muted">Policy Allowed is not the same as Executed.</p></section>
      <section><h4 className="mb-1 text-sm font-semibold">Approval history</h4>
        <div className="text-sm">Current approval: <b>{APPROVAL_LABEL[b.approval]}</b></div>
        {d.audits.length ? <ul className="mt-1 space-y-1 text-xs text-muted">{d.audits.map((a) => <li key={a.id}><Mono>{a.id}</Mono> · {a.action} · {a.actor} · {a.result}{a.reason ? ` — ${a.reason}` : ''}</li>)}</ul> : <p className="text-xs text-muted">No approval decisions recorded for this branch.</p>}</section>
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
        <Button size="sm" onClick={() => go('agent', { id: b.agent })}>View Agent</Button>
        <Button size="sm" onClick={() => go(d.assetId ? 'asset' : 'assets', d.assetId ? { id: d.assetId } : undefined)}>View Target</Button>
        <Button size="sm" onClick={() => go('ai-trace', b.toolEventId ? { id: b.toolEventId } : undefined)}>View Trace</Button>
        <Button size="sm" disabled={!b.evidence.length} title={b.evidence.length ? undefined : 'This branch has no evidence.'} onClick={() => go('evidence', { id: b.evidence[0] })}>View Evidence</Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {act(retryOk, retryWhy, <Button size="sm" icon={RotateCcw} onClick={() => setModal('retry')}>Request Retry</Button>)}
        {act(reOk, reWhy, <Button size="sm" onClick={() => setModal('reassign')}>Request Reassignment</Button>)}
        {act(cancelOk, `A ${BRANCH_LABEL[b.state]} branch is already finished and cannot be cancelled.`, <Button size="sm" variant="danger" onClick={() => setModal('cancel')}>Cancel Branch</Button>)}
      </div>
      <p className="text-xs text-muted">Retry and reassignment never bypass approval or preflight. No real commands are executed.</p>
      <RetryModal id={b.id} open={modal === 'retry'} onClose={() => setModal(null)} run={retry} />
      <ReassignModal id={b.id} current={b.agent} candidates={d.reassignCandidates} open={modal === 'reassign'} onClose={() => setModal(null)} run={reassign} />
      <CancelModal id={b.id} groupSize={d.groupSize} stepId={b.stepId} open={modal === 'cancel'} onClose={() => setModal(null)} run={cancel} />
    </div>
  )
}
function IdLinkGroup({ id }: { id: string }) {
  return <IdLink onClick={() => go('ai-fanout', { id })}>{id}</IdLink>
}

type RetryRun = ReturnType<typeof useRetryBranch>
type ReassignRun = ReturnType<typeof useReassignBranch>
type CancelRun = ReturnType<typeof useCancelBranch>

function RetryModal({ id, open, onClose, run }: { id: string; open: boolean; onClose: () => void; run: RetryRun }) {
  const toast = useToastStore((s) => s.toast)
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')
  const submit = () => {
    if (!reason.trim()) return setErr('A reason is required.')
    run.mutate({ id, reason: reason.trim() }, {
      onSuccess: (res) => {
        if (!res.ok) return setErr(res.failure.message)
        toast(`Retry requested for ${id}. Pending approval — nothing has run.`)
        setReason(''); setErr(''); onClose()
      },
    })
  }
  return (
    <Modal open={open} onClose={onClose} title={`Request retry — ${id}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit}>Submit request</Button></>}>
      <p className="mb-3 text-sm text-muted">The retry is queued as <b>pending approval</b>. It must pass approval and preflight again before anything can run.</p>
      <Field label="Reason" required error={err}><Textarea value={reason} onChange={(e) => { setReason(e.target.value); setErr('') }} placeholder="Why should this branch be retried?" /></Field>
    </Modal>
  )
}
function ReassignModal({ id, current, candidates, open, onClose, run }: { id: string; current: string; candidates: { id: string; host: string; connected: boolean }[]; open: boolean; onClose: () => void; run: ReassignRun }) {
  const toast = useToastStore((s) => s.toast)
  const [agent, setAgent] = useState('')
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')
  const submit = () => {
    if (!agent) return setErr('Choose an agent.')
    if (!reason.trim()) return setErr('A reason is required.')
    run.mutate({ id, agentId: agent, reason: reason.trim() }, {
      onSuccess: (res) => {
        if (!res.ok) return setErr(res.failure.message)
        toast(`Reassignment of ${id} to ${agent} requested. Pending approval.`)
        setAgent(''); setReason(''); setErr(''); onClose()
      },
    })
  }
  return (
    <Modal open={open} onClose={onClose} title={`Request reassignment — ${id}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit}>Submit request</Button></>}>
      <p className="mb-3 text-sm text-muted">Currently assigned to <Mono>{current}</Mono>. The old assignment stays in the assignment log. Only connected agents assigned to this project are eligible.</p>
      <div className="space-y-3">
        <Field label="New agent" required>
          <Select value={agent} onChange={(e) => { setAgent(e.target.value); setErr('') }}>
            <option value="">Select an agent…</option>
            {candidates.map((a) => <option key={a.id} value={a.id}>{a.id} · {a.host}{a.connected ? '' : ' (disconnected)'}</option>)}
          </Select>
        </Field>
        <Field label="Reason" required><Textarea value={reason} onChange={(e) => { setReason(e.target.value); setErr('') }} placeholder="Why reassign this branch?" /></Field>
        {err && <div role="alert" className="text-sm text-bad">{err}</div>}
      </div>
    </Modal>
  )
}
function CancelModal({ id, groupSize, stepId, open, onClose, run }: { id: string; groupSize: number; stepId: string; open: boolean; onClose: () => void; run: CancelRun }) {
  const toast = useToastStore((s) => s.toast)
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')
  const submit = () => {
    if (!reason.trim()) return setErr('A reason is required.')
    run.mutate({ id, reason: reason.trim() }, {
      onSuccess: (res) => {
        if (!res.ok) return setErr(res.failure.message)
        toast(`${id} cancelled.`)
        setReason(''); setErr(''); onClose()
      },
    })
  }
  return (
    <Modal danger open={open} onClose={onClose} title={`Cancel branch — ${id}`} footer={<><Button onClick={onClose}>Keep branch</Button><Button variant="danger" onClick={submit}>Cancel branch</Button></>}>
      <Banner tone="warn" title="Impact">Cancelling stops this branch only; the other {groupSize - 1} branches continue. The fan-in step {stepId === 'S12' ? '' : 'S12 '}will be missing this branch's result, so the group can end as Partially Completed, not Completed.</Banner>
      <div className="mt-3"><Field label="Reason" required error={err}><Textarea value={reason} onChange={(e) => { setReason(e.target.value); setErr('') }} placeholder="Why cancel this branch?" /></Field></div>
    </Modal>
  )
}

export function BranchDrawer({ branchId, onClose }: { branchId: string; onClose: () => void }) {
  return (
    <Drawer open onClose={onClose} width={560} title={<span className="flex items-center gap-2">Branch Inspector <Mono>{branchId}</Mono></span>}
      footer={<Button onClick={() => go('ai-branch', { id: branchId })}>Open full page</Button>}>
      <BranchBody id={branchId} />
    </Drawer>
  )
}

export function BranchPage() {
  const route = useRoute()
  const crumbs = [{ label: 'AI Operator', to: () => go('ai-operator') }, { label: 'Execution Graph', to: () => go('ai-fanout', { id: 'BG-014-01' }) }, { label: route.id || 'Branch' }]
  const q = useBranch(route.id || '')
  if (q.isPending) return <><PageHeader title="Branch Inspector" crumbs={crumbs} /><p className="text-sm text-muted">Loading branch…</p></>
  if (q.isError) {
    const f = (q.error as BranchReadError).failure
    return (
      <>
        <PageHeader title="Branch Inspector" crumbs={crumbs} />
        <Empty icon={f.kind === 'forbidden' ? ShieldQuestion : undefined} title={f.kind === 'forbidden' ? 'Branch belongs to another project' : 'Branch not found'}
          action={f.kind === 'forbidden' ? <Button onClick={() => go('ai-operator')}>Back to AI Operator</Button> : <Button onClick={() => go('ai-fanout', { id: 'BG-014-01' })}>Back to Execution Graph</Button>}>
          {f.message}
        </Empty>
      </>
    )
  }
  const b = q.data.branch
  return (
    <>
      <PageHeader title={<span className="flex items-center gap-2">Branch <Mono>{b.id}</Mono></span>} crumbs={crumbs} back={{ label: 'Execution Graph', to: () => go('ai-fanout', { id: b.groupId }) }} />
      <Card><BranchBody id={b.id} /></Card>
    </>
  )
}

/* ───────── Execution graph ───────── */
const NW = 176, NH = 64, LH = 92, COLW = 200
function Graph({ group, rows, onSelect }: { group: BranchGroup; rows: BranchRow[]; onSelect: (id: string) => void }) {
  const bs = rows.map((r) => r.branch)
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
          <div className="font-semibold">Parent step {group.parentStep}</div><div className="text-muted">Fan-out · max {group.maxConcurrency} concurrent</div></div>
        {pos.map(({ b, x, y }) => (
          <button key={b.id} onClick={() => onSelect(b.id)} aria-label={`Open branch ${b.id}, ${BRANCH_LABEL[b.state]}`} className={nodeCls(b.state)} style={{ left: x, top: y, width: NW, height: NH }}>
            <div className="flex items-center justify-between gap-1"><Mono className="!text-xs">{b.id}</Mono><span className="whitespace-nowrap font-medium">{BRANCH_LABEL[b.state]}</span></div>
            <div className="truncate text-muted">{b.tool}</div><div className="truncate text-muted">{b.target}</div>
          </button>
        ))}
        <div className="absolute rounded-lg border border-line bg-panel p-2 text-xs" style={{ left: aggX, top: midY, width: NW, height: NH }}>
          <div className="font-semibold">Fan-in step {group.aggStep}</div><div className="text-muted">Aggregation — waits for all branches</div></div>
      </div>
    </div>
  )
}

/* ───────── Fan-in panel + results inspector ───────── */
function FanIn({ counts, rows }: { counts: BranchCounts; rows: BranchRow[] }) {
  const L = useLinks()
  const [open, setOpen] = useState(false)
  const complete = counts.open === 0 && counts.failed === 0 && counts.missing === 0
  const evidence = rows.flatMap((r) => r.branch.evidence)
  const status = complete ? 'Completed' : counts.open > 0 ? 'Waiting for branches' : 'Partially Completed'
  return (
    <Card>
      <CardHeader title="Fan-in" sub={`Aggregation step — ${counts.done} of ${counts.total} branches returned results`} actions={<Button size="sm" variant="primary" onClick={() => setOpen(true)}>View Aggregated Results</Button>} />
      <DescList cols={3} items={[
        { k: 'Completed', v: counts.done }, { k: 'Failed', v: <span className={counts.failed ? 'text-bad' : ''}>{counts.failed}</span> }, { k: 'Missing results', v: counts.missing },
        { k: 'Evidence items', v: evidence.length }, { k: 'Conflicts', v: complete ? 'None reported' : 'Not assessed' }, { k: 'Confidence', v: 'Not assessed' },
        { k: 'Fan-in status', v: <b>{status}</b> },
      ]} />
      {!complete && <p className="mt-2 text-xs text-muted">Partially Completed is not Completed. A failed or missing branch never makes the operation a success.</p>}
      <Drawer open={open} onClose={() => setOpen(false)} width={520} title="Aggregated Results Inspector">
        <div className="space-y-4">
          <Banner tone={complete ? 'ok' : 'warn'} title={status}>{complete ? 'All branches returned results.' : `${counts.missing} branch(es) have no final result. Aggregated data below is incomplete. Confidence not assessed.`}</Banner>
          <section><h4 className="mb-1 text-sm font-semibold">Completed branches</h4>
            {rows.filter((r) => r.branch.state === 'completed').map((r) => <div key={r.branch.id} className="mb-2 text-sm"><div className="flex items-center gap-2">{L.branch(r.branch.id)}<span className="text-muted">{r.branch.tool} → {r.branch.target}</span></div><div className="text-muted">{r.branch.output}</div></div>)}
            {!counts.done && <p className="text-sm text-muted">None yet.</p>}</section>
          <section><h4 className="mb-1 text-sm font-semibold">Failed branches</h4>
            {rows.filter((r) => r.branch.state === 'failed').map((r) => <div key={r.branch.id} className="mb-2 text-sm"><div className="flex items-center gap-2">{L.branch(r.branch.id)}<BranchStatus state={r.branch.state} /></div><div className="text-bad">{r.branch.error}</div></div>)}
            {!counts.failed && <p className="text-sm text-muted">None.</p>}</section>
          <section><h4 className="mb-1 text-sm font-semibold">Missing / pending</h4>
            {rows.filter((r) => !['completed', 'failed'].includes(r.branch.state)).map((r) => <div key={r.branch.id} className="mb-1 flex items-center gap-2 text-sm">{L.branch(r.branch.id)}<BranchStatus state={r.branch.state} /></div>)}
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
  const route = useRoute()
  const L = useLinks()
  const groupsQ = useBranchGroups()
  const gid = route.id || groupsQ.data?.groups[0]?.group.id
  const q = useBranchGroup(gid)
  const [view, setView] = useState<'graph' | 'table'>(route.tab === 'table' ? 'table' : 'graph')
  const [sel, setSel] = useState<string | null>(null)
  const [qf, setQf] = useState(''); const [st, setSt] = useState(ALL); const [ag, setAg] = useState(ALL); const [tg, setTg] = useState(ALL); const [tl, setTl] = useState(ALL); const [ap, setAp] = useState(ALL)
  const crumbs = [{ label: 'AI Operator', to: () => go('ai-operator') }, { label: 'Execution Graph' }]
  if (groupsQ.isError || q.isError) {
    const f = ((groupsQ.error || q.error) as BranchReadError | undefined)?.failure
    return (
      <>
        <PageHeader title="Execution Graph" crumbs={crumbs} />
        {f?.kind === 'not-found' && !route.id
          ? <Empty icon={Layers} title="No branch group in this project" action={<Button onClick={() => go('ai-operator')}>Back to AI Operator</Button>}>Fan-out appears when an approved plan has parallel branches.</Empty>
          : <Empty icon={f?.kind === 'forbidden' ? ShieldQuestion : Layers} title={f?.kind === 'forbidden' ? 'Branch group belongs to another project' : 'Could not load the execution graph'} action={<Button onClick={() => (q.isError ? q.refetch() : groupsQ.refetch())}>Retry</Button>}>{f?.message}</Empty>}
      </>
    )
  }
  if (!gid) {
    return (
      <>
        <PageHeader title="Execution Graph" crumbs={crumbs} />
        <Empty icon={Layers} title="No branch group in this project" action={<Button onClick={() => go('ai-operator')}>Back to AI Operator</Button>}>Fan-out appears when an approved plan has parallel branches.</Empty>
      </>
    )
  }
  if (!q.data) return <><PageHeader title="Execution Graph" crumbs={crumbs} /><p className="text-sm text-muted">Loading branch groups…</p></>
  const { group: g, rows: bs, counts: s, overall } = q.data
  const agents = [...new Set(bs.map((r) => r.branch.agent))], targets = [...new Set(bs.map((r) => r.branch.target))], tools = [...new Set(bs.map((r) => r.branch.tool))]
  const rows = bs.map((r) => r.branch).filter((b) => (st === ALL || b.state === st) && (ag === ALL || b.agent === ag) && (tg === ALL || b.target === tg) && (tl === ALL || b.tool === tl) && (ap === ALL || b.approval === ap) && (!qf.trim() || `${b.id} ${b.tool} ${b.target} ${b.agent}`.toLowerCase().includes(qf.trim().toLowerCase())))
  const filtered = st !== ALL || ag !== ALL || tg !== ALL || tl !== ALL || ap !== ALL || !!qf
  const reset = () => { setQf(''); setSt(ALL); setAg(ALL); setTg(ALL); setTl(ALL); setAp(ALL) }
  const lostBr = bs.filter((r) => !r.agentConnected && ['paused', 'unknown'].includes(r.branch.state))
  const lostAgents = [...new Set(lostBr.map((r) => r.branch.agent))]
  const pending = bs.filter((r) => r.branch.approval === 'pending').length
  const sel_ = <T extends string>(v: string, set: (x: string) => void, label: string, opts: T[], fmt: (x: T) => string = (x) => x) => (
    <Select aria-label={label} value={v} onChange={(e) => set(e.target.value)} className="!w-40"><option value={ALL}>{label}: all</option>{opts.map((o) => <option key={o} value={o}>{fmt(o)}</option>)}</Select>
  )
  const opState = s.open > 0 ? 'In progress' : s.failed ? 'Partially Completed' : 'Completed'
  return (
    <>
      <PageHeader title={<span className="flex items-center gap-2">Execution Graph <Mono>{g.id}</Mono></span>} crumbs={crumbs} back={{ label: 'AI Operator', to: () => go('ai-operator') }} meta={<span className="text-xs text-muted">Demo Data — simulated</span>} />
      {lostAgents.length > 0 && (
        <div className="mb-4"><Banner tone="bad" title={`Group impact — agent ${lostAgents.join(', ')} disconnected`}>
          {lostBr.length} branch(es) are Paused or Unknown and will not auto-complete. {lostBr.map((r) => <span key={r.branch.id}>{L.branch(r.branch.id)}: {r.replacement ? <>proposed replacement {L.agent(r.replacement.id)}</> : 'no eligible replacement'}. </span> )}
          Open a branch to request reassignment (approval required).</Banner></div>
      )}
      <div className="space-y-4">
        <Card>
          <DescList cols={3} items={[
            { k: 'Group ID', v: <Mono>{g.id}</Mono> }, { k: 'Plan', v: <span className="flex items-center gap-2">{L.plan(g.planId)} {g.planVer}</span> }, { k: 'Operation', v: L.op(g.opId) },
            { k: 'Parent step', v: g.parentStep }, { k: 'Fan-in step', v: g.aggStep }, { k: 'Overall state', v: <b>{overall}</b> },
            { k: 'Objective', v: g.objective }, { k: 'Branches', v: s.total }, { k: 'Allocated agents', v: <span className="flex flex-wrap gap-2">{agents.map((a) => <span key={a}>{L.agent(a)}</span>)}</span> },
            { k: 'Running / completed / failed', v: `${s.running} / ${s.done} / ${s.failed}` }, { k: 'Approvals', v: `${pending} pending of ${s.total}` }, { k: 'Operation outcome', v: opState },
            { k: 'Policy constraints', v: <ul className="list-disc pl-4">{g.policy.map((p) => <li key={p}>{p}</li>)}</ul> },
          ]} />
          {s.failed > 0 && <p className="mt-2 text-xs text-bad">A failed branch never makes the operation a success.</p>}
        </Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented options={[{ id: 'graph', label: 'Graph' }, { id: 'table', label: 'Table' }]} value={view} onChange={setView} />
          <div className="flex gap-2"><Button size="sm" onClick={() => go('ai-trace')}>View Trace</Button><Button size="sm" onClick={() => go('operation', { id: g.opId })}>Open Operation</Button></div>
        </div>
        {view === 'graph' ? <Graph group={g} rows={bs} onSelect={setSel} /> : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <SearchBox value={qf} onChange={setQf} placeholder="Search branch ID, tool, target" className="w-64" />
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
        <FanIn counts={s} rows={bs} />
      </div>
      {sel && <BranchDrawer branchId={sel} onClose={() => setSel(null)} />}
    </>
  )
}

export const routes: Record<string, ComponentType> = { 'ai-fanout': FanOutPage, 'ai-branch': BranchPage }
