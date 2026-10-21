import { useEffect, useMemo, useRef, useState, isValidElement } from 'react'
import { Eye, GitBranch, MessageSquare, Activity, AlertTriangle, CheckCircle2, Clock, Download, FlaskConical, Flag, Gauge, HelpCircle, Lightbulb, OctagonX, Pause, Play, Radio, ShieldAlert, Sparkles, Square, Users, Video, WifiOff, XCircle } from 'lucide-react'
import { Banner, Button, Card, CardHeader, DemoTag, Field, Tabs, Textarea, DescList, Drawer, Empty, Gated, IdLink, Kpi, ApprovalBanner, Mono, Person, Progress, ConsolePane, Select, Status, Table, Timeline, useGuard, cx } from '../ui/index'
import { useServices } from '../state/services'
import { go } from '../router/navigate'
import { useCan, useMe } from '../state/console'
import { useToastStore, useUiStore } from '../state/stores'
import { useSessionStore, type LogLine } from '../state/session'
import { hhmm, stamp } from '../domain/demo-clock'
import { recordAudit } from '../features/audit/service'
import { preflightPass } from '../features/operations/preflight'
import { readOperationMeta, useOperationView } from '../features/operations/views'
import { fastForward, loseAgent, restoreAgent } from '../features/demo/runtime'
import { useSessionPerm } from '../features/c2/projection'
import { useStopRead } from '../features/estop/projection'
import { BRANCH_LABEL, planVer, toolFacets } from '../domain/catalog';
import type { Db } from '../demo/seed';
import type { Operation, Step } from '../domain/entities'
import { MASK, RuntimeStatus, failedBranches, hasReview, parseStamp, stepBranches, windowIssue, elapsed, planApprovalState, progressOf, stepCounts, useFrozen } from './c-common'
import { useReviewStep } from '../features/operations/query'
import { FanOutCard } from '../features/branches'
/* Ticket 28: the emergency-stop machine UI (request dialog, phase banner,
   progress strip) is feature-local (src/features/estop/ui.tsx) and runs the
   typed estop handlers; the console composes it. */
import { EmergencyStopDialog, StopProgress, StopStatePanel } from '../features/estop/ui'

/* ───────────── ONE banner per operation (V3.1): highest-priority condition wins, the rest become notes ───────────── */
const pad = (n: number) => String(n).padStart(2, '0')

export function OpBanner({ op }: { op: Operation }) {
  const view = useOperationView(op.id)
  const ss = useStopRead(op.projectId).stopState
  const staleOps = useSessionStore((s) => s.staleOps)
  const setStale = useSessionStore((s) => s.setStale)
  const persistFilters = useSessionStore((s) => s.persistFilters)
  const toast = useToastStore((s) => s.toast)
  const { ro, reason } = useGuard(op.projectId)
  if (!view) return null
  const p = view.project
  const pl = view.plan
  const active = op.status === 'running' || op.status === 'paused'
  const lostAg = view.agents.filter((a) => a.status !== 'online' && a.status !== 'idle')
  const polBlock = !!persistFilters['polblock.' + op.id]
  const planOk = !pl || ['approved', 'executed'].includes(pl.status)
  const blocked = polBlock || p.roeStatus !== 'approved' || !planOk
  const review = op.steps.find((s) => s.status === 'review')
  const fb = failedBranches(view, op.id)
  const stale = !!staleOps[op.id]
  const mine = !!ss && (ss.scope === 'workspace' || (ss.scope === 'project' && ss.id === op.projectId) || (ss.scope === 'operation' && ss.id === op.id))
  const notes: React.ReactNode[] = []
  if (stale) notes.push(<span key="stale">Data delayed, showing a snapshot. <button className="text-accent underline" onClick={() => { setStale(op.id, false); toast('Real-time data resynced.') }}>Reload data</button></span>)
  if (fb.length) notes.push(<span key="fb">Failed branch{fb.length > 1 ? 'es' : ''}: {fb.map((b, i) => <span key={b.id}>{i > 0 && ', '}<IdLink onClick={() => go('ai-branch', { id: b.id })}>{b.id}</IdLink></span>)} (step {[...new Set(fb.map((b) => b.stepId))].join(', ')}). The operation is not reported as successful.</span>)
  if (ro) notes.push(<span key="ro">Read-only: {reason} You can monitor but not control this operation.</span>)
  const tail = notes.length ? <ul className="mt-2 space-y-0.5 border-t border-current/10 pt-2 text-xs">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul> : null
  const live = () => go('operation', { id: op.id, tab: 'live' })
  let main: React.ReactNode = null
  if (mine && ss && !(ss.phase === 'stopped' && op.status === 'estop')) return <div><StopStatePanel op={op} />{tail && <div className="mb-4 -mt-2 rounded-lg border border-line bg-panel px-3 py-2 text-muted">{tail}</div>}</div>
  if (op.status === 'estop') main = <Banner tone="bad" icon={OctagonX} title="Emergency stopped — acknowledged by agents. No automatic restart.">{op.stopBy} at {op.stopAt}. Reason: {op.stopReason || '—'}. Running steps are Unknown until verified. Results so far are partial.<StopProgress op={op} />{tail}</Banner>
  else if (active && lostAg.length) main = <Banner tone="bad" icon={WifiOff} title={`Agent Lost: ${lostAg.map((a) => a.id).join(', ')}`} action={<Button size="sm" onClick={() => go('agent', { id: lostAg[0].id })}>Open agent</Button>}>Last seen {lostAg[0].lastSeen}. Steps and branches running on it are Unknown or paused. Pause or stop the operation, or restore the agent.{tail}</Banner>
  else if (active && blocked) main = <Banner tone="warn" icon={ShieldAlert} title="Blocked by Policy" action={<Button size="sm" onClick={() => go('settings', { tab: 'audit' })}>Open Audit Log</Button>}>{polBlock ? 'A simulated policy rule denied the next proposed step.' : p.roeStatus !== 'approved' ? `ROE ${p.roeVersion} is ${p.roeStatus}.` : `Plan ${pl?.id} is not approved.`} The step will not run until policy allows it. Policy decision is separate from AI mode and execution result.{tail}</Banner>
  else if (hasReview(op) && review) main = <Banner tone="warn" icon={Eye} title={`${op.id} · Paused — Awaiting Review`} action={<Button size="sm" variant="primary" onClick={live}>Decide in Live Workspace</Button>}>Step {review.id} ({review.name}) needs a human decision. No new steps start until a reviewer approves, skips or rejects it. The AI does not decide.{tail}</Banner>
  else if (op.status === 'paused') main = <Banner tone="warn" title="Operation paused — progress is not advancing">By {op.stopBy} at {op.stopAt}. Reason: {op.stopReason || '—'}. Resume rechecks ROE, permissions, window and agent readiness.{tail}</Banner>
  else if (op.status === 'cancelled') main = <Banner tone="info" title="Operation stopped" action={<Button size="sm" onClick={() => go('operation', { id: op.id, tab: 'results' })}>View partial results</Button>}>Stopped by {op.stopBy} at {op.stopAt}. Reason: {op.stopReason || '—'}. Results are partial.{tail}</Banner>
  else if (op.status === 'done') main = fb.length
    ? <Banner tone="warn" icon={GitBranch} title="Operation ended with failed branches — not a success" action={<Button size="sm" onClick={() => go('operation', { id: op.id, tab: 'results' })}>Review Results</Button>}>{fb.length} branch{fb.length === 1 ? '' : 'es'} failed, so the outcome is Partially Completed. Review evidence and failures before analysis.{tail}</Banner>
    : <Banner tone="ok" icon={CheckCircle2} title="Operation completed" action={<Button size="sm" onClick={() => go('operation', { id: op.id, tab: 'results' })}>Review Results</Button>}>All steps finished. The workspace is read-only. Next: review evidence, analyze, then findings.{tail}</Banner>
  else if (fb.length && active) main = <Banner tone="bad" icon={GitBranch} title={`${fb.length} branch${fb.length === 1 ? '' : 'es'} failed`} action={<Button size="sm" onClick={() => go('ai-branch', { id: fb[0].id })}>Open {fb[0].id}</Button>}>{fb[0].error || 'A branch ended in failure.'} The operation will not be shown as successful.{notes.filter((n) => !isValidElement(n) || n.key !== 'fb').length ? <ul className="mt-2 space-y-0.5 text-xs">{notes.filter((n) => !isValidElement(n) || n.key !== 'fb').map((n, i) => <li key={i}>{n}</li>)}</ul> : null}</Banner>
  else if (notes.length) main = <Banner tone={stale ? 'warn' : 'info'} title={stale ? 'Data delayed — showing a snapshot' : 'Notice'}>{tail}</Banner>
  return main
}

/* ───────────── Operation controls (pause / resume / stop) ───────────── */
export function OpControls({ op, onError, size = 'md' }: { op: Operation; onError: (e: string) => void; size?: 'sm' | 'md' }) {
  const view = useOperationView(op.id)
  const me = useMe()
  const services = useServices()
  const ss = useStopRead(op.projectId).stopState
  const confirm = useSessionStore((s) => s.confirm)
  const toast = useToastStore((s) => s.toast)
  const can = useCan()
  const { ro, reason } = useGuard(op.projectId)
  const [stopping, setStopping] = useState(false)
  const [es, setEs] = useState(false)
  if (!view) return null
  const allowed = can('run', op.projectId) && !ro
  const why = ro ? reason : 'Only a Red Team Manager or Operator can control operations.'
  const live = op.status === 'running'
  const paused = op.status === 'paused'
  const mine = !!ss && (ss.scope === 'workspace' || (ss.scope === 'project' && ss.id === op.projectId) || (ss.scope === 'operation' && ss.id === op.id))
  const busy = stopping || (mine && ['requested', 'acknowledged'].includes(ss!.phase as string))
  const busyWhy = 'A stop is already in progress.'
  if (!live && !paused) return null
  const sessions = view.sessions.filter((s) => s.opId === op.id && ['connected', 'available', 'awaiting', 'suspended'].includes(s.state))
  const c = stepCounts(op.steps)
  const p = view.project
  const lost = view.agents.filter((a) => a.status !== 'online' && a.status !== 'idle')

  /* Ticket 67 wave 4: the store's delegating pause/resume/stop/complete entries,
     mirrored at the call site — the typed lifecycle handlers run with the
     store's exact request context ('legacy' corr, persona + the operation's
     project at call time) and the demo log mirrors keep the store's pushLog
     ts format (hhmm + seconds). */
  const entryCtx = (projectId: string) => ({ actor: { id: me.name, role: me.role }, projectId, corr: 'legacy' })
  const pushLog = (opId: string, line: Omit<LogLine, 'id' | 'ts'>) =>
    useSessionStore.getState().pushLog(opId, line, hhmm() + ':' + pad(new Date().getSeconds()))
  const opsFor = (projectId: string) => services.operations({ id: me.name, role: me.role }, projectId)
  const pauseOp = async (opId: string, reason: string) => {
    const meta = readOperationMeta(services, opId)
    if (!meta) return
    const res = await opsFor(meta.projectId).pause(entryCtx(meta.projectId), opId, reason)
    if (res.ok) pushLog(opId, { level: 'WARN', agent: '—', stepId: '—', text: `Operation paused by ${me.name}` })
  }
  const resumeOp = async (opId: string) => {
    const meta = readOperationMeta(services, opId)
    if (!meta) return { ok: false, error: 'Operation not found.' }
    const res = await opsFor(meta.projectId).resume(entryCtx(meta.projectId), opId)
    if (!res.ok) return { ok: false, error: res.failure.message }
    pushLog(opId, { level: 'INFO', agent: '—', stepId: '—', text: `Operation resumed by ${me.name}` })
    return { ok: true }
  }
  const stopOp = async (opId: string, reason: string) => {
    const meta = readOperationMeta(services, opId)
    if (!meta) return
    await opsFor(meta.projectId).stop(entryCtx(meta.projectId), opId, reason)
  }
  const completeOp = async (opId: string) => {
    const meta = readOperationMeta(services, opId)
    if (!meta) return { ok: false, error: 'Operation not found.' }
    const res = await opsFor(meta.projectId).complete(entryCtx(meta.projectId), opId)
    if (!res.ok) return { ok: false, error: res.failure.message }
    pushLog(opId, { level: 'INFO', agent: '—', stepId: '—', text: 'Operation completed' })
    return { ok: true }
  }

  const pause = () => confirm({
    title: `Pause ${op.id}?`,
    body: <div className="space-y-2"><p>No new steps are dispatched until you resume. Steps already running finish or time out; progress does not advance while paused.</p><ul className="list-disc space-y-0.5 pl-5 text-muted"><li>{c.running} running step(s) finish first</li><li>{c.pending + c.review} queued or review step(s) wait</li><li>{sessions.length} linked session(s) stay connected, read-only</li></ul><p className="text-muted">The action is audited.</p></div>,
    confirmLabel: 'Pause operation', reasonLabel: 'Reason for pausing', reasonRequired: true,
    onConfirm: async (r) => { await pauseOp(op.id, r); toast('Operation paused.', 'warn') },
  })
  const resume = async () => {
    const read = await opsFor(op.projectId).preflightChecks(entryCtx(op.projectId), op.id)
    if (!read.ok) { onError(read.failure.message); return }
    const checks = read.data
    const rows: [string, boolean, string][] = [
      ['ROE', p.roeStatus === 'approved', `ROE ${p.roeVersion} is ${p.roeStatus}`],
      ['Permissions', allowed, allowed ? 'You may run operations' : 'Your role cannot run operations'],
      ['Window', !windowIssue(p, parseStamp(op.updated)), 'Inside the authorized time window'],
      ['Agent readiness', lost.length === 0, lost.length ? `${lost.map((a) => a!.id).join(', ')} not ready` : 'All agents are online'],
    ]
    const okAll = rows.every((r) => r[1]) && preflightPass(checks)
    confirm({
      title: `Resume ${op.id}?`,
      body: <div className="space-y-2"><p>Before resuming, the system rechecks:</p><ul className="space-y-1">{rows.map(([k, ok, d]) => <li key={k} className="flex items-start gap-2">{ok ? <CheckCircle2 size={14} className="mt-0.5 text-ok" aria-hidden /> : <XCircle size={14} className="mt-0.5 text-bad" aria-hidden />}<span><b>{k}</b> — {d}</span></li>)}</ul>{!okAll && <p className="text-bad">Resume is blocked until every check passes.</p>}</div>,
      confirmLabel: okAll ? 'Resume operation' : 'Recheck blocked — close',
      onConfirm: async () => {
        if (!okAll) { const msg = `Cannot resume: ${rows.filter((r) => !r[1]).map((r) => r[0]).concat(checks.filter((x) => x.state !== 'pass').map((x) => x.label)).join('; ') || 'preflight re-evaluation failed'}.`; onError(msg); toast('Resume blocked by recheck.', 'bad'); return }
        const r = await resumeOp(op.id)
        if (r.ok) { onError(''); toast('Rechecks passed. Operation resumed.') } else { onError(r.error || 'Cannot resume.'); toast(r.error || 'Cannot resume.', 'bad') }
      },
    })
  }
  const stop = () => confirm({
    title: `Stop ${op.id}?`,
    body: <div className="space-y-2"><p>A graceful stop. The operation moves to <b>Stopping</b>, then <b>Stopped</b>, and cannot be resumed.</p>
      <ul className="list-disc space-y-0.5 pl-5 text-muted"><li>{c.running} running step(s) become “Unknown”</li><li>{c.pending + c.review} queued step(s) become “Not run”</li><li>{sessions.length} linked session(s) are terminated</li></ul><p className="text-muted">Results so far are kept as partial results. Audited.</p></div>,
    confirmLabel: 'Stop operation', danger: true, reasonLabel: 'Reason for stopping', reasonRequired: true,
    onConfirm: (r) => { setStopping(true); onError(''); toast('Stop requested. Stopping…', 'warn'); setTimeout(async () => { await stopOp(op.id, r); setStopping(false); toast('Operation stopped.', 'warn') }, 1400) },
  })
  const complete = async () => { const r = await completeOp(op.id); if (r.ok) { onError(''); toast('Operation completed.'); go('operation', { id: op.id, tab: 'results' }) } else { onError(r.error || ''); toast(r.error || 'Cannot complete.', 'bad') } }
  const G = ({ ok, w, children }: { ok: boolean; w: string; children: React.ReactNode }) => <Gated allowed={allowed && ok} reason={!allowed ? why : w}>{children}</Gated>
  return (
    <div className="flex flex-wrap items-center gap-2">
      {live && <G ok={!busy} w={busyWhy}><Button size={size} icon={Pause} onClick={pause}>Pause</Button></G>}
      {paused && <G ok={!busy} w={busyWhy}><Button size={size} icon={Play} variant="primary" onClick={resume}>Resume</Button></G>}
      <G ok={!busy} w={busyWhy}><Button size={size} icon={Square} variant="danger" onClick={stop}>{stopping ? 'Stopping…' : 'Stop'}</Button></G>
      <Gated allowed={can('estop', op.projectId) && !ro && !busy} reason={ro ? reason : !can('estop', op.projectId) ? 'Your role cannot trigger an emergency stop.' : busyWhy}>
        <Button size={size} icon={OctagonX} variant="dangerSolid" onClick={() => setEs(true)}>Emergency Stop</Button>
      </Gated>
      {live && <G ok={!busy} w={busyWhy}><Button size={size} icon={Flag} onClick={complete}>Complete</Button></G>}
      <EmergencyStopDialog op={op} open={es} onClose={() => setEs(false)} />
    </div>
  )
}

/* ───────────── Shared bits ───────────── */
const LVL: Record<string, string> = { INFO: 'text-console-info', WARN: 'text-console-warn', ERROR: 'text-console-bad' }
const LVL_ICON = { INFO: '●', WARN: '▲', ERROR: '✕' } as Record<string, string>

function SessionCard({ s }: { s: Db['sessions'][number] }) {
  /* Ticket 67: the semantic C2 access derivation is a typed c2 read; the
     permission label re-derives from recorded grants per publication. */
  const perm = useSessionPerm(s)
  return (
    <li className="rounded-xl border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><IdLink onClick={() => go('c2-session', { id: s.id })}>{s.id}</IdLink><Status kind="session" value={s.state} size="sm" /></div>
      <div className="mt-1 text-xs text-muted">{s.kind === 'reverse' ? 'Reverse shell' : 'Web shell'} · {s.asset} · {s.agentId}</div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <Status kind="perm" value={perm} size="sm" />
        {s.state === 'connected' && <span className="inline-flex items-center gap-1 text-muted"><Video size={12} aria-hidden />Recording on</span>}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => go('c2-session', { id: s.id })}>Open Session</Button>
      </div>
    </li>
  )
}

function SessionCards({ op }: { op: Operation }) {
  const view = useOperationView(op.id)
  const list = view ? view.sessions : []
  if (list.length === 0) {
    return <p className="text-sm text-muted">{op.status === 'running' || op.status === 'paused' ? 'No session is linked to this operation.' : 'No session yet. A session appears only after the operation starts.'}</p>
  }
  return (
    <ul className="space-y-2">
      {list.map((s) => <SessionCard key={s.id} s={s} />)}
    </ul>
  )
}

function PlanCard({ op }: { op: Operation }) {
  const view = useOperationView(op.id)
  if (!view) return null
  const pl = view.plan
  const conv = view.conversation
  if (!op.planId) return <p className="text-sm text-muted">This operation was created manually from a playbook. No AI plan is linked.</p>
  if (!pl) return <p className="text-sm text-muted">Linked plan {op.planId} is not available.</p>
  return (
    <div className="space-y-3">
      <ApprovalBanner state={planApprovalState(pl)} title={`${pl.id} ${planVer(pl)} — ${pl.status.replace('_', ' ')}`}>
        {pl.decision ? `${pl.decision.by}, ${pl.decision.at}. ${pl.decision.note}` : 'No decision recorded yet.'}
      </ApprovalBanner>
      <DescList cols={1} items={[{ k: 'Plan', v: <IdLink onClick={() => go('ai-plan-review', { id: pl.id })}>{pl.id} — {pl.title}</IdLink> }, { k: 'Steps', v: `${pl.steps.length} (${pl.steps.filter((s) => s.needsApproval).length} need explicit approval)` }, { k: 'Conversation', v: conv ? <IdLink onClick={() => go('ai-operator', { id: conv.id })}>{conv.id}</IdLink> : '—' }, { k: 'Reviewer', v: pl.reviewer }, { k: 'ROE version', v: <Mono>{pl.roeVersion}</Mono> }]} />
      <div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => go('ai-plan-review', { id: pl.id })}>View Approved Plan</Button><Button size="sm" icon={MessageSquare} disabled={!conv} onClick={() => go('ai-operator', { id: conv!.id })}>Open in AI Operator</Button></div>
    </div>
  )
}

/* ───────────── Overview (OP-04) ───────────── */
export function OverviewTab({ op }: { op: Operation }) {
  const view = useOperationView(op.id)
  const logs = useSessionStore((s) => s.logs)
  const setCopilotOpen = useUiStore((s) => s.setCopilotOpen)
  const [sel, setSel] = useState<string | null>(null)
  if (!view) return null
  const p = view.project
  const pb = view.playbook
  const c = stepCounts(op.steps)
  const pr = progressOf(op.steps)
  const ags = view.agents
  const assets = view.assets
  const sessions = view.sessions.filter((s) => s.opId === op.id)
  const recent = (logs[op.id] || []).slice(-6).reverse()
  const pl = view.plan
  const active = op.status === 'running' || op.status === 'paused'
  const groups = view.branchGroups
  const conv = view.conversation
  const fb = failedBranches(view, op.id)
  const ai = op.steps.length === 0 ? 'No execution data yet, so there is nothing to summarize.' : `${c.ok} of ${c.total} steps completed${c.fail ? `, ${c.fail} failed` : ''}${c.unknown ? `, ${c.unknown} with an unknown outcome` : ''}. ${fb.length ? `${fb.length} branch${fb.length === 1 ? '' : 'es'} failed (${fb.map((b) => b.id).join(', ')}), so this operation is not summarized as successful. ` : ''}${c.review ? `${c.review} step(s) await a human review decision. ` : ''}${c.unknown ? 'Outcomes marked Unknown are not treated as success or failure until verified.' : 'No steps are in an ambiguous state.'}`
  return (
    <div>
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Kpi label="Steps" value={c.total} sub={pr == null ? 'No data yet' : `${pr}% progress`} icon={Gauge} />
        <Kpi label="Completed" value={c.ok} tone="ok" icon={CheckCircle2} />
        <Kpi label="Requires review" value={c.review} tone={c.review ? 'warn' : undefined} icon={Eye} />
        <Kpi label="Pending" value={c.pending} icon={Clock} />
        <Kpi label="Failed" value={c.fail} tone={c.fail ? 'bad' : undefined} icon={XCircle} sub={c.unknown ? `${c.unknown} unknown` : undefined} />
        <Kpi label="Agents" value={`${ags.filter((a) => a.status === 'online').length}/${ags.length}`} sub="online" icon={Users} />
        <Kpi label="Sessions" value={sessions.length} sub={sessions.length ? `${sessions.filter((s) => s.state === 'connected').length} connected` : 'Appear after start'} icon={Radio} />
      </div>
      <div className="mb-5 flex flex-wrap gap-2" aria-label="Related links">
        <Button size="sm" disabled={!pl} title={pl ? undefined : 'No AI plan is linked.'} onClick={() => go('ai-plan-review', { id: pl!.id })}>AI Plan{pl ? ` ${pl.id} ${planVer(pl)}` : ''}</Button>
        <Button size="sm" disabled={!conv} title={conv ? undefined : 'No AI conversation is linked.'} onClick={() => go('ai-operator', { id: conv!.id })}>Open in AI Operator{conv ? ` ${conv.id}` : ''}</Button>
        {groups.map((g) => <Button key={g.id} size="sm" icon={GitBranch} onClick={() => go('ai-fanout', { id: g.id })}>Fan-out {g.id}</Button>)}
        <Button size="sm" onClick={() => go('operation', { id: op.id, tab: 'agents' })}>Agents</Button>
        <Button size="sm" onClick={() => go('operation', { id: op.id, tab: 'live' })}>Live Workspace</Button>
        <Button size="sm" onClick={() => go('operation', { id: op.id, tab: 'results' })}>Results</Button>
        <Button size="sm" onClick={() => go('settings', { tab: 'audit' })}>Audit</Button>
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          {groups.map((g) => <FanOutCard key={g.id} groupId={g.id} />)}
          <Card>
            <CardHeader title="Operation details" actions={<>
              {active && <Button size="sm" variant="primary" icon={Radio} onClick={() => go('operation', { id: op.id, tab: 'live' })}>Open Live Workspace</Button>}
              <Button size="sm" onClick={() => go('operation', { id: op.id, tab: 'results' })}>View results</Button>
            </>} />
            <DescList items={[
              { k: 'Objective', v: pb?.goal || '—' },
              { k: 'Description', v: pb?.desc || '—' },
              { k: 'Project', v: <IdLink onClick={() => go('project', { id: p.id, tab: 'overview' })}>{p.id}</IdLink> },
              { k: 'Operator', v: <Person name={op.owner} /> },
              { k: 'Playbook', v: pb ? <span className="inline-flex items-center gap-2"><IdLink onClick={() => go('playbook', { id: pb.id })}>{pb.id}</IdLink>{pb.name} v{pb.version}</span> : '—' },
              { k: 'ROE version', v: <span className="inline-flex items-center gap-2"><Mono>{p.roeVersion}</Mono><Status kind="roe" value={p.roeStatus} size="sm" /></span> },
              { k: 'Execution mode', v: op.mode },
              { k: 'Started / updated', v: <>{op.startedAt} · {op.updated}</> },
              { k: 'Preflight', v: op.preflightAt ? `Confirmed at ${op.preflightAt}` : 'Not confirmed' },
              { k: 'Schedule', v: op.schedule && op.schedule !== 'now' ? <IdLink onClick={() => go('operation-schedule', { id: op.id })}>{op.schedule.replace('T', ' ')} (UTC+7)</IdLink> : 'Manual start' },
            ]} />
          </Card>
          <Card>
            <CardHeader title="Safety controls" sub="Limits applied to this operation" />
            <DescList items={[
              { k: 'Allowed window', v: p.window },
              { k: 'Emergency contact', v: p.emergency || <span className="text-bad">Not defined</span> },
              { k: 'Stop conditions', v: p.restrictions.join('; ') || '—' },
              { k: 'Agent policy', v: 'One agent serves one operation at a time' },
              { k: 'Allowed methods', v: p.methods.join(', ') },
              { k: 'Approval', v: pl ? `${pl.id} ${planVer(pl)} — ${pl.status.replace('_', ' ')}` : 'Manual operation — no plan approval required' },
            ]} />
          </Card>
          <Card pad={false}>
            <div className="px-5 pt-5"><CardHeader title="Steps" sub="Select a step to open Step Detail" /></div>
            {op.steps.length === 0 ? <div className="px-5 pb-5 text-sm text-muted">No steps yet. Steps appear once a plan or playbook is attached.</div> : (
              <div className="max-h-80 overflow-auto"><table className="w-full border-collapse text-sm"><caption className="sr-only">Operation steps</caption>
                <thead className="sticky top-0 bg-panel"><tr className="border-y border-line text-left text-xs uppercase tracking-wide text-muted"><th className="h-9 whitespace-nowrap px-5 font-medium">Step</th><th className="px-3 font-medium">Name</th><th className="px-3 font-medium">Status</th><th className="px-3 font-medium">Branches</th></tr></thead>
                <tbody>{op.steps.map((s) => { const bs = stepBranches(view, op.id, s.id); return (
                  <tr key={s.id} tabIndex={0} onClick={() => setSel(s.id)} onKeyDown={(e) => { if (e.key === 'Enter') setSel(s.id) }} className="cursor-pointer border-b border-line/60 hover:bg-hover focus-visible:bg-hover">
                    <td className="whitespace-nowrap px-5 py-2"><Mono className="text-accent">{s.id}</Mono></td><td className="px-3 py-2">{s.name}</td>
                    <td className="whitespace-nowrap px-3 py-2"><Status kind="step" value={s.status} size="sm" /></td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs" onClick={(e) => e.stopPropagation()}>{bs.length ? bs.map((b) => <span key={b.id} className="mr-1.5"><IdLink onClick={() => go('ai-branch', { id: b.id })}>{b.id}</IdLink></span>) : <span className="text-neutral">—</span>}</td>
                  </tr>) })}</tbody></table></div>
            )}
          </Card>
          <Card pad={false}>
            <div className="px-5 pt-5"><CardHeader title="Target scope" sub={`${assets.length} assets assigned`} /></div>
            {assets.length === 0 ? <div className="px-5 pb-5 text-sm text-muted">No target assets selected.</div> : (
              <ul>{assets.map((a) => (
                <li key={a.id} className="flex min-h-12 items-center gap-3 border-t border-line/60 px-5 text-sm">
                  <IdLink onClick={() => go('asset', { id: a.id })}>{a.id}</IdLink><span>{a.name}</span><Mono className="text-muted max-sm:hidden">{a.ident}</Mono><span className="ml-auto"><Status kind="scope" value={a.scope} size="sm" /></span>
                </li>))}</ul>
            )}
          </Card>
        </div>
        <div className="space-y-5">
          <Card><CardHeader title="Plan snapshot" /><PlanCard op={op} /></Card>
          <Card>
            <CardHeader title="Assigned agents" />
            {ags.length === 0 ? <p className="text-sm text-muted">No agents assigned.</p> : (
              <ul className="space-y-2">{ags.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 text-sm"><span><IdLink onClick={() => go('agent', { id: a.id })}>{a.id}</IdLink> <span className="text-muted">{a.host}</span></span><Status kind="agent" value={a.status} size="sm" /></li>))}</ul>
            )}
          </Card>
          <Card><CardHeader title="Linked sessions" /><SessionCards op={op} /></Card>
          <Card>
            <CardHeader title="Latest events" actions={<Button size="sm" variant="ghost" onClick={() => go('operation', { id: op.id, tab: 'timeline' })}>Timeline</Button>} />
            {recent.length === 0 ? <p className="text-sm text-muted">No events yet.</p> : (
              <Timeline items={recent.map((l) => ({ at: l.ts, title: l.text, sub: l.agent !== '—' ? l.agent : undefined, tone: l.level === 'ERROR' ? 'bad' : l.level === 'WARN' ? 'warn' : 'accent' }))} />
            )}
          </Card>
          <Card>
            <CardHeader title="AI interpretation" sub="AI-generated summary — verify before use" actions={<DemoTag />} />
            <p className="text-sm text-muted">{ai}</p>
            <Button size="sm" className="mt-3" icon={Sparkles} onClick={() => setCopilotOpen(true, { kind: 'operation', id: op.id, label: `${op.id} — ${op.name}` })}>Ask AI to explain</Button>
          </Card>
        </div>
      </div>
      <StepDrawer op={op} step={op.steps.find((x) => x.id === sel) || null} onClose={() => setSel(null)} logs={logs[op.id] || []} />
    </div>
  )
}

/* ───────────── Step inspector (OP-V3-06) ───────────── */
export function StepDrawer({ op, step, onClose, logs }: { op: Operation; step: Step | null; onClose: () => void; logs: { id: string; ts: string; level: string; text: string; stepId: string }[] }) {
  const view = useOperationView(op.id)
  const setFilter = useSessionStore((s) => s.setFilter)
  const setCopilotOpen = useUiStore((s) => s.setCopilotOpen)
  const can = useCan()
  const { ro } = useGuard(op.projectId)
  const [tab, setTab] = useState('summary')
  useEffect(() => { setTab('summary') }, [step?.id])
  const idx = step ? op.steps.findIndex((s) => s.id === step.id) : -1
  const pl = view?.plan
  const ps = pl && idx >= 0 ? pl.steps[idx] : undefined
  const pb = view?.playbook
  const asset = view && step ? view.projectAssets.find((a) => a.name === step.asset && a.projectId === op.projectId) : undefined
  const ev = view && step?.evidence ? view.evidence.find((e) => e.id === step.evidence) : null
  const masked = !!ev?.sensitive && !can('viewSensitive')
  const hist = step ? logs.filter((l) => l.stepId === step.id) : []
  const canFind = can('createFinding', op.projectId) && !ro
  const related = view && step ? view.findings.filter((f) => f.op === op.id && ((step.evidence && f.evidence.includes(step.evidence)) || f.technique === step.technique)) : []
  const create = () => { if (!step) return; setFilter('finding-prefill', { op: op.id, projectId: op.projectId, stepId: step.id, technique: step.technique, asset: step.asset, evidence: step.evidence ? [step.evidence] : [] }); go('finding-new') }
  const needsAp = !!ps?.needsApproval || step?.status === 'review'
  const brs = view && step ? stepBranches(view, op.id, step.id) : []
  const grp = view && step ? view.branchGroups.find((g) => g.opId === op.id && (g.parentStep === step.id || g.aggStep === step.id)) : undefined
  const tools = view && step ? view.toolEvents.filter((t) => t.opId === op.id && t.stepId === step.id) : []
  const conv = view?.conversation
  const failedBr = brs.filter((b) => b.state === 'failed')
  return (
    <Drawer open={!!step} onClose={onClose} width={540} title={step ? <span><Mono className="mr-2 text-muted">{step.id}</Mono>{step.name}</span> : ''} footer={step && <>
      <Button disabled={!canFind} title={canFind ? undefined : ro ? 'Project is read-only.' : 'Only a Manager or Operator can create findings.'} onClick={create}>Create Finding Draft</Button>
      <Button icon={Sparkles} onClick={() => setCopilotOpen(true, { kind: 'step', id: step.id, label: `${op.id} ${step.id} — ${step.name}` })}>Ask AI to Analyze</Button>
    </>}>
      {step && (
        <div className="text-sm">
          <Tabs tabs={[{ id: 'summary', label: 'Summary' }, { id: 'output', label: 'Output' }, { id: 'evidence', label: 'Evidence' }, { id: 'policy', label: 'Policy & Approvals' }, { id: 'finding', label: 'Related Finding' }]} value={tab} onChange={setTab} />
          <div className="space-y-4">
            {tab === 'summary' && <>
              <div className="flex flex-wrap items-center gap-2"><Status kind="step" value={step.status} />{needsAp && ['pending', 'running', 'review'].includes(step.status) && <Status kind="generic" value="warn" label="Needs approval" />}</div>
              {failedBr.length > 0 && <Banner tone="bad" icon={GitBranch} title="A branch of this step failed">Branch {failedBr.map((b) => b.id).join(', ')} failed{failedBr[0].error ? `: ${failedBr[0].error}` : '.'} This step is never treated as a success.</Banner>}
              {step.status === 'unknown' && <Banner tone="warn" title="Outcome unknown">The agent lost connection or the operation was stopped while this step was running. Verify it before treating it as a success or failure.</Banner>}
              {step.status === 'review' && <Banner tone="warn" icon={Lightbulb} title="Waiting for a human decision">Approve, Skip or Reject this step from the Live Workspace. The AI never makes this decision.</Banner>}
              <DescList cols={1} items={[
                { k: 'Planned objective', v: ps?.rationale || pb?.goal || '—' },
                { k: 'Technique', v: <IdLink onClick={() => go('technique', { id: step.technique })}>{step.technique}</IdLink> },
                { k: 'Target asset', v: asset ? <IdLink onClick={() => go('asset', { id: asset.id })}>{asset.name}</IdLink> : step.asset },
                { k: 'Agent', v: step.agent === '—' ? '—' : <IdLink onClick={() => go('agent', { id: step.agent })}>{step.agent}</IdLink> },
                { k: 'Approved plan', v: pl ? <IdLink onClick={() => go('ai-plan-review', { id: pl.id })}>{pl.id} {planVer(pl)}</IdLink> : 'No plan linked' },
                { k: 'Started / duration', v: <Mono>{step.ts} · {step.dur}</Mono> },
                { k: 'Branches', v: brs.length ? <ul className="space-y-1">{brs.map((b) => <li key={b.id} className="flex flex-wrap items-center gap-2"><IdLink onClick={() => go('ai-branch', { id: b.id })}>{b.id}</IdLink><span className="text-xs text-muted">{BRANCH_LABEL[b.state]} · {b.agent} · {b.tool}</span></li>)}</ul> : grp ? <span>{grp.parentStep === step.id ? 'Fan-out parent' : 'Fan-in (aggregation)'} of <IdLink onClick={() => go('ai-fanout', { id: grp.id })}>{grp.id}</IdLink></span> : <span className="text-muted">No branches</span> },
                { k: 'Tool events', v: tools.length ? <span className="inline-flex flex-wrap gap-2">{tools.map((t) => <IdLink key={t.id} onClick={() => go('ai-trace', { id: t.id })}>{t.id}</IdLink>)}</span> : <span className="text-muted">None</span> },
                { k: 'Input metadata', v: <span className="text-muted">{ps ? `Tool: ${ps.tool} · ` : ''}parameters redacted</span> },
              ]} />
              <div><div className="mb-1 text-xs font-medium text-muted">Event timeline</div>
                {hist.length === 0 ? <div className="text-xs text-neutral">No events yet.</div> : <ul className="space-y-1 font-mono text-xs text-muted">{hist.map((l) => <li key={l.id}>{l.ts} — {l.text}</li>)}</ul>}</div>
            </>}
            {tab === 'output' && <>
              {step.status === 'fail' && <div className="rounded-lg border border-bad/30 bg-bad-soft p-3 text-bad">{step.output}</div>}
              <div className="mb-1 flex items-center justify-between text-xs font-medium text-muted"><span>Sanitized output</span><DemoTag /></div>
              <ConsolePane className="whitespace-pre-wrap p-3">{masked ? MASK : step.output}</ConsolePane>
              <p className="text-xs text-muted">Synthetic, sanitized output. Raw output, payloads and credentials are never shown.</p>
            </>}
            {tab === 'evidence' && (ev ? <DescList cols={1} items={[
              { k: 'Evidence', v: <IdLink onClick={() => go('operation', { id: op.id, tab: 'results' })}>{ev.id}</IdLink> },
              { k: 'Name', v: masked ? <span className="text-muted">Sensitive (masked)</span> : ev.name }, { k: 'Kind', v: ev.kind }, { k: 'Collected', v: <Mono>{ev.at} by {ev.by}</Mono> },
              { k: 'Sensitivity', v: ev.sensitive ? 'Sensitive — masked for some roles' : 'Not sensitive' },
            ]} /> : <Empty icon={Activity} title="No evidence for this step">Evidence appears here when the step produces an artifact.</Empty>)}
            {tab === 'policy' && <>
              <DescList cols={1} items={[
                { k: 'AI proposal', v: ps ? `${ps.tool} · risk ${ps.risk}` : 'Not from an AI plan' },
                { k: 'Requires approval', v: needsAp ? 'Yes — explicit human approval' : 'No' },
                { k: 'Plan approval', v: pl ? <IdLink onClick={() => go('ai-plan-review', { id: pl.id })}>{pl.id} — {pl.status.replace('_', ' ')}</IdLink> : '—' },
                { k: 'Policy decision', v: failedBr.length ? 'Allowed, but a branch failed during execution' : step.status === 'review' ? 'Allowed, pending reviewer decision' : step.status === 'fail' ? 'Failed during execution' : step.status === 'pending' ? 'Allowed, queued' : 'Allowed' },
              ]} />
              {tools.length > 0 && <div><div className="mb-1 text-xs font-medium text-muted">Tool events — three independent facets</div><ul className="space-y-2">{tools.map((t) => { const f = toolFacets(t); return <li key={t.id} className="rounded-lg border border-line p-3"><div className="flex flex-wrap items-center justify-between gap-2"><IdLink onClick={() => go('ai-trace', { id: t.id })}>{t.id}</IdLink><span className="text-xs text-muted">{t.tool}</span></div><dl className="mt-1 grid grid-cols-3 gap-2 text-xs"><div><dt className="text-muted">Policy</dt><dd className="font-medium">{f.policy}</dd></div><div><dt className="text-muted">Approval</dt><dd className="font-medium">{f.approval}</dd></div><div><dt className="text-muted">Execution</dt><dd className="font-medium">{f.exec}</dd></div></dl></li> })}</ul><p className="mt-1 text-xs text-muted">Policy Allowed does not mean Executed.</p></div>}
              <div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => go('settings', { tab: 'audit' })}>Open Audit Log</Button><Button size="sm" icon={MessageSquare} disabled={!conv} title={conv ? undefined : 'No AI conversation is linked.'} onClick={() => go('ai-operator', { id: conv!.id })}>Open in AI Operator</Button></div>
            </>}
            {tab === 'finding' && (related.length ? <ul className="space-y-2">{related.map((f) => <li key={f.id} className="rounded-lg border border-line p-3"><div className="flex items-center justify-between gap-2"><IdLink onClick={() => go('finding', { id: f.id })}>{f.id}</IdLink><Status kind="finding" value={f.status} size="sm" /></div><div className="mt-1">{f.title}</div>{f.status === 'ai_suggested' && <div className="mt-1 text-xs text-warn">AI suggested — not a verified finding.</div>}</li>)}</ul>
              : <Empty icon={Flag} title="No related finding">Create a finding draft from this step when it shows something worth reporting.</Empty>)}
          </div>
        </div>
      )}
    </Drawer>
  )
}

/* ───────────── Live Operation Workspace (OP-V3-04/05) ───────────── */
const EV_FILTERS = [['all', 'All events'], ['exec', 'Execution'], ['ai', 'AI proposals'], ['approval', 'Approval'], ['error', 'Errors'], ['session', 'Session activity']] as const
const evCat = (l: { level: string; text: string }) => (l.level === 'ERROR' ? 'error' : /approv|review|reject|skipp/i.test(l.text) ? 'approval' : /session/i.test(l.text) ? 'session' : /\bAI\b|propos|plan/i.test(l.text) ? 'ai' : 'exec')
const NODE_TONE: Record<string, string> = { ok: 'border-ok/40 bg-ok-soft', running: 'border-cyan bg-info-soft', fail: 'border-bad/50 bg-bad-soft', unknown: 'border-warn/60 bg-warn-soft', review: 'border-warn bg-warn-soft ring-1 ring-warn', pending: 'border-line bg-panel', notrun: 'border-line bg-subtle' }
const NO_LOGS: LogLine[] = []

export function ConsoleTab({ op: liveOp }: { op: Operation }) {
  const view = useOperationView(liveOp.id)
  const liveLogs = useSessionStore((s) => s.logs)
  const staleOps = useSessionStore((s) => s.staleOps)
  const setStale = useSessionStore((s) => s.setStale)
  const persistFilters = useSessionStore((s) => s.persistFilters)
  const setFilter = useSessionStore((s) => s.setFilter)
  const setCopilotOpen = useUiStore((s) => s.setCopilotOpen)
  const aiMode = useUiStore((s) => s.aiMode)
  const can = useCan()
  const toast = useToastStore((s) => s.toast)
  const review = useReviewStep()
  const stale = !!staleOps[liveOp.id]
  const polBlock = !!persistFilters['polblock.' + liveOp.id]
  const setPolBlock = (v: boolean) => setFilter('polblock.' + liveOp.id, v ? true : undefined)
  const op = useFrozen(liveOp, stale)
  const logs = useFrozen(liveLogs[liveOp.id], stale) || NO_LOGS
  const [err, setErr] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const [dock, setDock] = useState('output')
  const [evf, setEvf] = useState<(typeof EV_FILTERS)[number][0]>('all')
  const [note, setNote] = useState('')
  const [dockOpen, setDockOpen] = useState(true)
  const term = useRef<HTMLDivElement>(null)
  const { ro, reason: roReason } = useGuard(op.projectId)

  const p = view?.project
  const pl = view?.plan
  const pb = view?.playbook
  const agents = view?.agents ?? []
  const sessions = view ? view.sessions.filter((s) => s.opId === op.id) : []
  const c = stepCounts(op.steps)
  const pr = progressOf(op.steps)
  const lostAg = agents.filter((a) => a.status !== 'online' && a.status !== 'idle')
  const lines = useMemo(() => logs.filter((l) => evf === 'all' || evCat(l) === evf).slice(-300), [logs, evf])
  const step = op.steps.find((s) => s.id === sel) || null
  const reviewStep = op.steps.find((s) => s.status === 'review')
  /* Channel records carry no agentId in the demo model; the agent-link probe
     stays for forward compatibility and falls through to the node match. */
  const chan = view ? view.channels.find((ch) => agents.some((a) => a.id === (ch as { agentId?: string }).agentId)) || view.channels.find((ch) => ch.nodeId) : undefined
  const node = view ? view.c2Nodes.find((n) => n.projectIds.includes(op.projectId)) || view.c2Nodes[0] : undefined
  const auditRows = view?.audit ?? []
  const evs = view?.evidence ?? []
  const groups = view?.branchGroups ?? []
  const conv = view?.conversation
  useEffect(() => { if (term.current) term.current.scrollTop = term.current.scrollHeight }, [lines.length, dock])

  if (!view || !p) return null
  const pending = c.review + (pl && !['approved', 'executed'].includes(pl.status) ? 1 : 0)
  const active = op.status === 'running' || op.status === 'paused'
  const planOk = !pl || ['approved', 'executed'].includes(pl.status)
  const blocked = polBlock || p.roeStatus !== 'approved' || !planOk

  if (op.status === 'draft' || op.status === 'ready' || op.status === 'pending') {
    return (
      <Empty icon={Play} title="Operation has not started" action={<Button variant="primary" onClick={() => go('preflight', { id: op.id })}>Run Preflight</Button>}>
        {op.status === 'ready' ? 'Preflight passed. Start the operation from the preflight screen to open the Live Workspace.' : 'Complete preflight and start the operation before monitoring it live. No events or sessions exist yet.'}
      </Empty>
    )
  }
  const decide = (d: 'approve' | 'skip' | 'fail') => {
    if (!reviewStep) return
    /* Ticket 29: the decision is the typed mutation — the handler re-derives
       the role/context/run-state gates at click time; a refusal surfaces its
       reason instead of recording an unauthorized decision. */
    review.mutate({ id: op.id, stepId: reviewStep.id, decision: d, note: note.trim() }, {
      onSuccess: (r) => {
        if (!r.ok) { toast(r.failure.message, 'bad'); return }
        setNote('')
        toast(d === 'approve' ? `${reviewStep.id} approved.` : d === 'skip' ? `${reviewStep.id} skipped.` : `${reviewStep.id} rejected.`, d === 'approve' ? 'info' : 'warn')
      },
    })
  }
  const canDecide = can('run', op.projectId) && !ro && op.status === 'running' && !stale
  const decideWhy = ro ? roReason : !can('run', op.projectId) ? 'Only a Manager or Operator can decide on review steps.' : op.status !== 'running' ? 'Resume the operation to decide.' : stale ? 'Data is delayed. Reload before deciding.' : ''
  const needNote = !note.trim()
  const chip = (text: string, cls = 'border-line bg-subtle text-muted') => <span className={cx('inline-flex h-6 items-center whitespace-nowrap rounded-full border px-2.5 text-xs font-medium', cls)}>{text}</span>
  const stateLabel = op.status === 'estop' ? 'Emergency stopped' : op.status === 'cancelled' ? 'Stopped' : op.status === 'done' ? 'Completed' : op.status === 'paused' ? 'Paused' : lostAg.length ? 'Agent Lost' : blocked ? 'Blocked by Policy' : 'Running'
  const hBtn = 'inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-xs hover:bg-hover'
  return (
    <div>
      {err && <Banner tone="bad" title="Action could not be completed">{err}</Banner>}

      <div className="sticky top-0 z-20 mb-3 rounded-xl border border-line bg-panel/95 p-3 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <IdLink onClick={() => go('project', { id: p.id, tab: 'overview' })}>{p.id}</IdLink><span className="text-neutral">/</span><Mono className="font-semibold">{op.id}</Mono>
              <RuntimeStatus op={op} />{(lostAg.length > 0 || blocked) && chip(stateLabel, 'border-warn/30 bg-warn-soft text-warn')}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
              <span>Plan <b className="text-fg">{pl ? <IdLink onClick={() => go('ai-plan-review', { id: pl.id })}>{pl.id} {planVer(pl)}</IdLink> : 'None'}</b></span>
              <span>ROE <b className="text-fg">{p.roeVersion}</b></span><span className="whitespace-nowrap">Window <b className="text-fg">{p.window}</b></span>
              <span>Elapsed <b className="text-fg">{elapsed(op, stamp())}</b></span><span>AI mode <b className="capitalize text-fg">{aiMode}</b></span>
              <span className="whitespace-nowrap">Steps <b className="text-fg">{c.ok + c.fail}/{c.total}</b></span>
            </div>
          </div>
          <div className="w-40"><Progress value={pr || 0} tone={c.fail || c.unknown ? 'warn' : 'accent'} label="Operation progress" /></div>
          <OpControls op={op} onError={setErr} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2 text-xs" aria-label="Health strip">
          <button className={hBtn} onClick={() => agents[0] && go('agent', { id: lostAg[0]?.id || agents[0].id })}>{lostAg.length ? <WifiOff size={13} className="text-bad" aria-hidden /> : <CheckCircle2 size={13} className="text-ok" aria-hidden />}Agents {agents.length - lostAg.length} online · {lostAg.length} offline</button>
          <button className={hBtn} onClick={() => go('c2')}><Radio size={13} aria-hidden />C2 node {node ? `${node.name} · ${node.status}` : '—'}{chan && chan.status !== 'connected' ? ` · channel ${chan.status}` : ''}</button>
          <button className={hBtn} disabled={!sessions.length} title={sessions.length ? undefined : 'No sessions linked to this operation.'} onClick={() => sessions[0] && go('c2-session', { id: sessions[0].id })}><Video size={13} aria-hidden />Sessions {sessions.filter((s) => s.state === 'connected').length}/{sessions.length} connected</button>
          <button className={hBtn} onClick={() => reviewStep ? setSel(reviewStep.id) : go('ai-plan-review', { id: pl?.id })}><Clock size={13} aria-hidden />Pending approvals {pending}</button>
          <button className={hBtn} onClick={() => go('settings', { tab: 'audit' })}>{blocked ? <ShieldAlert size={13} className="text-warn" aria-hidden /> : <CheckCircle2 size={13} className="text-ok" aria-hidden />}Policy {blocked ? 'blocked' : 'allowed'}</button>
          <span className="ml-auto whitespace-nowrap text-muted">Last refresh <b className="font-mono text-fg">{op.updated}</b> (UTC+7){stale && <span className="ml-1 text-warn">(delayed)</span>}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader title="Pipeline" sub={`${c.ok} done · ${c.review} needs review · ${c.pending} pending${c.fail ? ` · ${c.fail} failed` : ''}${c.unknown ? ` · ${c.unknown} unknown` : ''}`} actions={<DemoTag />} />
            <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6" aria-label="Operation steps">
              {op.steps.map((s) => (
                <li key={s.id}>
                  <button onClick={() => setSel(s.id)} className={cx('h-full w-full rounded-lg border p-2.5 text-left transition hover:shadow-sm focus-visible:ring-2 focus-visible:ring-accent', NODE_TONE[s.status] || 'border-line', sel === s.id && 'ring-2 ring-accent')} aria-label={`${s.id} ${s.name} — ${s.status}`}>
                    <div className="flex items-center justify-between gap-1"><Mono className="text-muted">{s.id}</Mono><Status kind="step" value={s.status} size="sm" /></div>
                    <div className="mt-1 line-clamp-2 text-[12.5px] leading-snug">{s.name}</div>
                    <div className="mt-1 truncate font-mono text-[11px] text-muted">{s.agent} · {s.technique}</div>{(() => { const bs = stepBranches(view, op.id, s.id); const g = groups.find((x) => x.parentStep === s.id || x.aggStep === s.id); return (bs.length > 0 || g) ? <div className="mt-1 flex items-center gap-1 text-[11px] text-muted"><GitBranch size={11} aria-hidden />{bs.length ? `${bs.length} branch${bs.length === 1 ? '' : 'es'}${bs.some((b) => b.state === 'failed') ? ' · failed' : ''}` : g!.parentStep === s.id ? 'Fan-out parent' : 'Fan-in'}</div> : null })()}
                  </button>
                </li>
              ))}
            </ol>
          </Card>
          {groups.map((g) => <FanOutCard key={g.id} groupId={g.id} />)}
          {reviewStep && (
            <Card className="border-warn">
              <CardHeader title={`Review required — ${reviewStep.id} ${reviewStep.name}`} sub="A human reviewer decides. The AI cannot approve, skip or reject." />
              <Field label="Reviewer note" hint={needNote ? 'Required for Skip and Reject.' : undefined}><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Why this decision?" /></Field>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Gated allowed={canDecide} reason={decideWhy}><Button variant="primary" icon={CheckCircle2} onClick={() => decide('approve')}>Approve</Button></Gated>
                <Gated allowed={canDecide && !needNote} reason={decideWhy || 'Enter a reviewer note.'}><Button onClick={() => decide('skip')}>Skip</Button></Gated>
                <Gated allowed={canDecide && !needNote} reason={decideWhy || 'Enter a reviewer note.'}><Button variant="danger" icon={XCircle} onClick={() => decide('fail')}>Reject</Button></Gated>
                <Button variant="ghost" onClick={() => setSel(reviewStep.id)}>Open Step Inspector</Button>
              </div>
            </Card>
          )}
        </div>

        <aside className="space-y-4" aria-label="AI Copilot">
          <Card>
            <CardHeader title="AI Copilot" sub={`Mode: ${aiMode}`} actions={<DemoTag />} />
            <div className="space-y-3 text-sm">
              <div><div className="text-xs font-medium text-muted">Current goal</div><div>{pl?.title || pb?.goal || 'Manual operation — no AI goal.'}</div></div>
              <div><div className="text-xs font-medium text-muted">Observation</div><div className="text-muted">{lostAg.length ? `${lostAg[0].id} is offline; ${c.unknown} step(s) have an unknown outcome.` : c.review ? `${c.ok} of ${c.total} steps completed. ${reviewStep!.id} produced a result that needs reviewer judgment.` : c.pending ? `${c.ok} of ${c.total} steps completed. Next step is queued.` : 'All steps are finished. No anomalies noticed (simulated).'}</div></div>
              <div><div className="text-xs font-medium text-muted">Proposed step</div><div>{reviewStep ? `${reviewStep.id} — ${reviewStep.name}` : op.steps.find((s) => s.status === 'pending')?.name || 'No proposal pending.'}</div></div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="primary" disabled={!pl} title={pl ? undefined : 'No AI plan is linked to this operation.'} onClick={() => go('ai-plan-review', { id: pl!.id })}>Review Proposal</Button>
                <Button size="sm" icon={Sparkles} onClick={() => setCopilotOpen(true, { kind: 'operation', id: op.id, label: `${op.id} — ${op.name}` })}>Ask AI</Button>
                <Button size="sm" icon={MessageSquare} disabled={!conv} title={conv ? undefined : 'No AI conversation is linked to this operation.'} onClick={() => go('ai-operator', { id: conv!.id })}>Open in AI Operator</Button>
              </div>
              <p className="rounded-lg bg-subtle p-2 text-xs text-muted">The AI proposes only. Reviewer decisions (Approve / Skip / Reject) are always made by a person.</p>
              <dl className="space-y-1 border-t border-line pt-2 text-xs">
                {([['AI mode', aiMode], ['Execution eligibility', p.roeStatus === 'approved' && planOk ? 'Eligible' : 'Not eligible'], ['Policy decision', blocked ? 'Blocked' : 'Allowed'], ['Execution result', `${c.ok} ok · ${c.fail} failed · ${c.unknown} unknown`]] as const).map(([k, v]) => <div key={k} className="flex justify-between gap-2"><dt className="text-muted">{k}</dt><dd className="font-medium capitalize">{v}</dd></div>)}
              </dl>
            </div>
          </Card>
          <Card className="border-dashed">
            <CardHeader title="Demo controls" sub="Simulation only — nothing here affects real systems." actions={<DemoTag />} />
            <div className="space-y-2">
              {op.agents.map((id) => {
                const a = view.agents.find((x) => x.id === id); const online = a?.status === 'online'
                return (
                  <div key={id} className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs text-muted">{id}</span>
                    <Button size="sm" icon={WifiOff} disabled={op.status !== 'running' || !online} title={op.status !== 'running' ? 'Available while the operation is running.' : !online ? `${id} is already disconnected.` : undefined} onClick={() => { loseAgent(id); toast(`Simulated agent offline: ${id}.`, 'warn') }}>Offline</Button>
                    <Button size="sm" icon={Radio} disabled={online} title={online ? `${id} is already connected.` : undefined} onClick={() => { restoreAgent(id); toast(`${id} restored.`) }}>Restore</Button></div>
                )
              })}
              <Button size="sm" icon={ShieldAlert} disabled={!active} title={active ? undefined : 'Available while the operation is active.'} onClick={() => setPolBlock(!polBlock)}>{polBlock ? 'Clear policy block' : 'Simulate policy block'}</Button>
              {stale ? <Button size="sm" icon={Radio} onClick={() => setStale(op.id, false)}>Restore live data</Button> : <Button size="sm" icon={AlertTriangle} disabled={!active} title={active ? undefined : 'Available while the operation is active.'} onClick={() => setStale(op.id, true)}>Simulate delayed data</Button>}
              <Button size="sm" icon={FlaskConical} disabled={!active || !!reviewStep} title={!active ? 'Available while the operation is active.' : reviewStep ? 'A step is waiting for review. Decide first.' : 'Finish remaining steps with demo output.'} onClick={() => { fastForward(op.id); toast('Demo fast-forward applied.') }}>Fast-forward steps</Button>
            </div>
          </Card>
        </aside>
      </div>

      <section className="mt-4 overflow-hidden rounded-xl border border-line bg-console text-console-fg" aria-label="Operation dock">
        <div className="flex flex-wrap items-center gap-1 border-b border-white/10 px-3 pt-2">
          <div role="tablist" className="flex gap-1">
            {['output', 'session', 'evidence', 'policy', 'audit'].map((t) => <button key={t} role="tab" aria-selected={dock === t} onClick={() => { setDock(t); setDockOpen(true) }} className={cx('h-9 rounded-t-md px-3 text-sm font-medium capitalize', dock === t ? 'bg-white/10 text-white' : 'text-console-muted hover:text-white')}>{t}</button>)}
          </div>
          <span className="ml-auto inline-flex items-center gap-2 pb-1 text-xs text-console-muted"><FlaskConical size={13} aria-hidden />Simulated Console — no real commands are executed. Synthetic output.</span>
          <button onClick={() => setDockOpen(!dockOpen)} aria-expanded={dockOpen} className="mb-1 rounded px-2 py-1 text-xs text-console-muted hover:text-white">{dockOpen ? 'Collapse' : 'Expand'}</button>
        </div>
        {dockOpen && <div>
          {dock === 'output' && <>
            <div className="flex flex-wrap gap-1.5 border-b border-white/10 px-3 py-2" role="group" aria-label="Event filters">
              {EV_FILTERS.map(([v, l]) => <button key={v} aria-pressed={evf === v} onClick={() => setEvf(v)} className={cx('h-7 rounded-full border px-2.5 text-xs', evf === v ? 'border-white/60 bg-white/15 text-white' : 'border-white/15 text-console-muted hover:text-white')}>{l}</button>)}
            </div>
            <div ref={term} role="log" aria-live="off" aria-label="Simulated operation event stream" className="no-scrollbar h-[260px] overflow-auto px-4 py-3 font-mono text-xs leading-6">
              {lines.length === 0 ? <div className="text-console-muted">No events match this filter.</div> : lines.map((l) => (
                <div key={l.id} className="flex gap-3 whitespace-nowrap"><span className="text-console-muted">{l.ts}</span><span className={cx('w-14 shrink-0 font-semibold', LVL[l.level])}><span aria-hidden>{LVL_ICON[l.level]} </span>{l.level}</span><span className="w-16 shrink-0 text-console-muted">{l.agent}</span><span>{l.text}</span>
                  {l.stepId !== '—' && op.steps.some((s) => s.id === l.stepId) && <button onClick={() => setSel(l.stepId)} className="text-console-info hover:underline">[{l.stepId}]</button>}</div>
              ))}
            </div>
          </>}
          {dock !== 'output' && <div className="h-[260px] overflow-auto px-4 py-3 text-sm">
            {dock === 'session' && (sessions.length ? <ul className="space-y-2">{sessions.map((s) => <li key={s.id} className="flex flex-wrap items-center gap-3"><button className="font-mono text-console-info hover:underline" onClick={() => go('c2-session', { id: s.id })}>{s.id}</button><span>{s.kind === 'reverse' ? 'Reverse session' : 'Web session'} · {s.asset} · {s.agentId}</span><Status kind="session" value={s.state} size="sm" /></li>)}</ul> : <p className="text-console-muted">No session is linked to this operation.</p>)}
            {dock === 'evidence' && (evs.length ? <ul className="space-y-2">{evs.map((e) => <li key={e.id} className="flex flex-wrap items-center gap-3"><button className="font-mono text-console-info hover:underline" onClick={() => go('operation', { id: op.id, tab: 'results' })}>{e.id}</button><span>{e.sensitive && !can('viewSensitive') ? 'Sensitive (masked)' : e.name}</span><span className="text-console-muted">{e.at}</span></li>)}</ul> : <p className="text-console-muted">No evidence collected yet.</p>)}
            {dock === 'policy' && <ul className="space-y-2">
              <li className="flex flex-wrap gap-3"><button className="text-console-info hover:underline" onClick={() => go('settings', { tab: 'audit' })}>{blocked ? 'Policy denied the next step' : 'Policy allowed all dispatched steps'}</button><span className="text-console-muted">ROE {p.roeVersion} · {p.roeStatus}</span></li>
              {pl && <li className="flex flex-wrap gap-3"><button className="text-console-info hover:underline" onClick={() => go('ai-plan-review', { id: pl.id })}>Plan {pl.id} {planVer(pl)}</button><span className="text-console-muted">{pl.status.replace('_', ' ')}</span></li>}
              {reviewStep && <li><button className="text-console-info hover:underline" onClick={() => setSel(reviewStep.id)}>{reviewStep.id} requires reviewer approval</button></li>}
              {lostAg.length > 0 && <li className="text-console-warn">{lostAg[0].id} offline — dispatch to it is stopped.</li>}
            </ul>}
            {dock === 'audit' && (auditRows.length ? <ul className="space-y-1.5">{auditRows.map((a) => <li key={a.id} className="flex flex-wrap gap-3"><span className="font-mono text-console-muted">{a.at}</span><button className="text-console-info hover:underline" onClick={() => go('settings', { tab: 'audit' })}>{a.action}</button><span className="text-console-muted">{a.actor} · {a.result}</span></li>)}</ul> : <p className="text-console-muted">No audit entries for this operation yet. <button className="text-console-info hover:underline" onClick={() => go('settings', { tab: 'audit' })}>Open Audit Log</button></p>)}
          </div>}
        </div>}
      </section>
      <StepDrawer op={op} step={step} onClose={() => setSel(null)} logs={logs} />
    </div>
  )
}

/* ───────────── Agents & Sessions ───────────── */
export function AgentsTab({ op }: { op: Operation }) {
  const view = useOperationView(op.id)
  if (!view) return null
  const rows = view.agents
  const per = rows.map((a) => ({ a, st: stepCounts(op.steps.filter((s) => s.agent === a.id)) }))
  return (
    <div className="space-y-5">
      {rows.length === 0 ? <Empty icon={Users} title="No agents assigned" action={<Button onClick={() => go('operation-new', { id: op.id })}>Edit operation</Button>}>This operation has no participating agents, so no steps are allocated.</Empty> : (
        <Table rows={per} rowKey={(r) => r.a.id} onRow={(r) => go('agent', { id: r.a.id })} cols={[
          { key: 'id', header: 'Agent', render: (r) => <div><IdLink onClick={() => go('agent', { id: r.a.id })}>{r.a.id}</IdLink><div className="text-xs text-muted">{r.a.host} · {r.a.os} {r.a.version}</div></div> },
          { key: 's', header: 'Connection', render: (r) => <Status kind="agent" value={r.a.status} size="sm" /> },
          { key: 'ls', header: 'Last seen', hideBelow: 'md', render: (r) => <Mono className="text-muted">{r.a.lastSeen}</Mono> },
          { key: 'g', header: 'Group', hideBelow: 'lg', render: (r) => r.a.group || '—' },
          { key: 'n', header: 'Steps', render: (r) => r.st.total },
          { key: 'e', header: 'Failures', render: (r) => <span className={r.st.fail ? 'text-bad' : ''}>{r.st.fail}{r.st.unknown ? <span className="ml-1 text-warn">(+{r.st.unknown} unknown)</span> : null}</span> },
          { key: 'u', header: 'Ownership', hideBelow: 'lg', render: (r) => (r.a.projectId === op.projectId ? 'Project agent' : r.a.projectId === '' ? 'Shared pool' : 'Other project — invalid') },
          { key: 'b', header: 'Availability', render: (r) => (r.a.op === op.id ? <span className="text-ok">Serving this operation</span> : r.a.op ? <span className="text-warn">Busy: {r.a.op}</span> : <span className="text-muted">Available</span>) },
        ]} />
      )}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Step allocation by agent" sub="Step counts by status; no conclusions are inferred without data." />
          {per.length === 0 ? <p className="text-sm text-muted">No allocation to show.</p> : (
            <div className="space-y-4">
              {per.map(({ a, st }) => (
                <div key={a.id}>
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-1 text-xs"><span className="font-mono">{a.id} · {a.host}</span><span className="text-muted">{st.ok} completed · {st.fail} failed · {st.running + st.pending} queued · {st.unknown} unknown · {st.notrun} not run</span></div>
                  <div className="flex h-3 overflow-hidden rounded-full bg-hover" role="img" aria-label={`${a.id}: ${st.total} steps`}>
                    {([['ok', 'bg-ok'], ['fail', 'bg-bad'], ['running', 'bg-cyan'], ['unknown', 'bg-warn'], ['pending', 'bg-neutral/60']] as const).map(([k, cl]) => st[k] > 0 && <div key={k} className={cl} style={{ width: `${(st[k] / Math.max(1, st.total)) * 100}%` }} title={`${k}: ${st[k]}`} />)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card><CardHeader title="Sessions" sub="Linked interactive sessions" /><SessionCards op={op} /></Card>
      </div>
    </div>
  )
}

/* ───────────── Timeline ───────────── */
export function TimelineTab({ op }: { op: Operation }) {
  const logs = useSessionStore((s) => s.logs)
  const can = useCan()
  const toast = useToastStore((s) => s.toast)
  const services = useServices()
  const me = useMe()
  /* The legacy `A.audit` entry, mirrored exactly: one 'legacy' commit with the
     store helper's exact row shape (the RT-2026-014 SS/AR corr rule, the demo
     stamp, the override-aware persona). */
  const audit = (action: string, obj: string, projectId: string, result = 'Success', reason = '') =>
    recordAudit(services, { actor: { id: me.name, role: me.role }, projectId, corr: 'legacy' }, { action, obj, result, reason })
  const [lvl, setLvl] = useState('')
  const [ag, setAg] = useState('')
  const [pick, setPick] = useState<string | null>(null)
  const all = logs[op.id] || []
  const list = all.filter((l) => (!lvl || l.level === lvl) && (!ag || l.agent === ag)).slice(-100).reverse()
  const cur = all.find((l) => l.id === pick)
  const allowExport = can('viewSensitive')
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select value={lvl} onChange={(e) => setLvl(e.target.value)} aria-label="Filter by event type" className="w-44"><option value="">All event types</option><option value="INFO">Information</option><option value="WARN">Warning</option><option value="ERROR">Error</option></Select>
        <Select value={ag} onChange={(e) => setAg(e.target.value)} aria-label="Filter by source" className="w-48"><option value="">All sources</option><option value="—">System / operator</option>{op.agents.map((a) => <option key={a}>{a}</option>)}</Select>
        <Button className="ml-auto" icon={Download} disabled={!allowExport} title={allowExport ? undefined : 'Your role cannot export logs.'}
          onClick={() => { audit('Exported operation log', op.id, op.projectId); toast('Log exported (sensitive data masked).') }}>Export log</Button>
      </div>
      {!allowExport && <p className="mb-3 text-xs text-muted">Log export is limited to roles allowed to view sensitive data.</p>}
      <Card>
        {list.length === 0 ? <Empty icon={Clock} title="No events yet">The operation has no events matching the filters.</Empty> : (
          <ol className="relative ml-2 border-l border-line">
            {list.map((l) => (
              <li key={l.id} className="relative pb-3 pl-6 last:pb-0">
                <span className={cx('absolute -left-[5px] top-3 h-2.5 w-2.5 rounded-full border-2 border-panel', l.level === 'ERROR' ? 'bg-bad' : l.level === 'WARN' ? 'bg-warn' : 'bg-accent')} />
                <button onClick={() => setPick(l.id)} className="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-hover">
                  <div className="text-sm">{l.text}</div>
                  <div className="font-mono text-[11px] text-muted"><span className={l.level === 'ERROR' ? 'text-bad' : l.level === 'WARN' ? 'text-warn' : 'text-accent'}>{l.level}</span> · {l.ts} · {l.agent}{l.stepId !== '—' ? ` · ${l.stepId}` : ''}</div>
                </button>
              </li>
            ))}
          </ol>
        )}
      </Card>
      <Drawer open={!!cur} onClose={() => setPick(null)} title="Event details" footer={<>
        <Button onClick={() => { setPick(null); go('operation', { id: op.id, tab: 'graph' }) }}>View on graph</Button>
        <Button variant="primary" onClick={() => { setPick(null); go('operation', { id: op.id, tab: 'live' }) }}>Open Live Workspace</Button>
      </>}>
        {cur && <DescList cols={1} items={[
          { k: 'Time', v: <Mono>{cur.ts}</Mono> }, { k: 'Level', v: cur.level }, { k: 'Step ID', v: cur.stepId }, { k: 'Source', v: cur.agent === '—' ? 'System / operator' : cur.agent },
          { k: 'Message', v: cur.text },
          { k: 'Evidence', v: (() => { const st = op.steps.find((s) => s.id === cur.stepId); return st?.evidence ? <IdLink onClick={() => go('operation', { id: op.id, tab: 'evidence' })}>{st.evidence}</IdLink> : 'None' })() },
        ]} />}
      </Drawer>
    </div>
  )
}

export { Activity, HelpCircle }
