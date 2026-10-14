import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Columns3, Download, ExternalLink, Filter, X } from 'lucide-react'
import { useServices } from '../store'
import { actorRef } from '../auth/persona'
import { planVer } from '../data'
import type { Audit, Conversation, Facets, ToolEvent } from '../data'
import { useQueryScope } from '../state/keys'
import { createChatHandlers } from '../features/aichat/handlers'
import { AiHistoryReadError, useAiAudit, useAiHistory } from '../features/aichat/query'
import type { ActorType, HistoryConversation } from '../features/aichat/history'
import { modeLabel } from '../features/aichat/history'
import { TraceReadError, useTraceEvents, useTraceWrites } from '../features/trace/query'
import type { TraceRow } from '../features/trace/service'
import type { ToolDecisionOutcome } from '../features/trace/writes'
import type { ServiceResult } from '../domain/service'
import { go, useRoute } from '../router/navigate'
import { useCan } from '../state/console'
import { useProjectStore, useToastStore } from '../state/stores'
import { Banner, Button, Card, CardHeader, DemoTag, DescList, Drawer, Empty, Field, Gated, IdLink, Mono, PageHeader, SearchBox, Segmented, Select, Status, Table, Tabs, Textarea, cx } from '../ui'
import { AiSubNav, NoProject, Pill, ReplanPanel, Thread, tz } from './g-common'

/* ───────────── helpers ───────────── */
type Bucket = 'proposed' | 'pending' | 'blocked' | 'executed' | 'failed'
/** Exclusive status bucket: every event falls in exactly one, so chip counts always sum to "All". */
const bucket = (e: ToolEvent): Bucket => (e.state === 'awaiting' ? 'pending' : e.state === 'denied' ? 'blocked' : e.state === 'completed' || e.state === 'running' ? 'executed' : e.state === 'failed' || e.state === 'stopped' ? 'failed' : 'proposed')
const BUCKETS: { id: 'all' | Bucket; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'proposed', label: 'Proposed' }, { id: 'pending', label: 'Pending Approval' },
  { id: 'blocked', label: 'Blocked' }, { id: 'executed', label: 'Executed' }, { id: 'failed', label: 'Failed' },
]
type View = 'table' | 'timeline' | 'agent' | 'branch' | 'step'
const VIEWS: { id: View; label: string }[] = [{ id: 'table', label: 'Table' }, { id: 'timeline', label: 'Timeline' }, { id: 'agent', label: 'By Agent' }, { id: 'branch', label: 'By Branch' }, { id: 'step', label: 'By Plan Step' }]
const polTone = (p: Facets['policy']) => (p === 'Allowed' ? 'ok' : p === 'Blocked' ? 'bad' : 'neutral') as 'ok' | 'bad' | 'neutral'
const apprTone = (a: Facets['approval']) => (a === 'Approved' ? 'ok' : a === 'Pending' ? 'warn' : a === 'Denied' ? 'bad' : 'neutral') as 'ok' | 'warn' | 'bad' | 'neutral'
const exTone = (x: Facets['exec']) => (x === 'Executed' ? 'ok' : x === 'Failed' ? 'bad' : x === 'Running' ? 'cyan' : 'neutral') as 'ok' | 'bad' | 'cyan' | 'neutral'
const dur = (ms?: number) => (ms == null ? '—' : ms >= 60000 ? `${(ms / 60000).toFixed(1)} min` : `${Math.round(ms / 1000)} s`)

/** Lightweight click-away popover. */
function Pop({ label, icon: I, badge, children, width = 260 }: { label: string; icon: typeof Filter; badge?: number; children: ReactNode; width?: number }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k)
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k) }
  }, [open])
  return (
    <div ref={ref} className="relative">
      <Button icon={I} onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="dialog">{label}{!!badge && <span className="ml-1 rounded-full bg-accent px-1.5 text-xs text-white">{badge}</span>}</Button>
      {open && <div role="dialog" aria-label={label} style={{ width }} className="absolute right-0 top-full z-40 mt-1.5 rounded-xl border border-line bg-panel p-3 shadow-xl">{children}</div>}
    </div>
  )
}

/* ───────────── Tool Trace ───────────── */
const COLS = [
  { id: 'id', label: 'Event ID', w: 96 }, { id: 'at', label: 'Time', w: 150 }, { id: 'op', label: 'Operation', w: 96 }, { id: 'step', label: 'Plan Step', w: 130 },
  { id: 'branch', label: 'Branch', w: 112 }, { id: 'agent', label: 'Agent', w: 92 }, { id: 'target', label: 'Target', w: 140 }, { id: 'tool', label: 'Tool', w: 160 },
  { id: 'policy', label: 'Policy', w: 120 }, { id: 'appr', label: 'Human Approval', w: 140 }, { id: 'exec', label: 'Execution State', w: 140 }, { id: 'dur', label: 'Duration', w: 88 }, { id: 'ev', label: 'Evidence', w: 120 },
] as const
type ColId = (typeof COLS)[number]['id']

export function AiTrace() {
  const pid = useProjectStore((s) => s.pid)
  const route = useRoute()
  const can = useCan()
  const trace = useTraceEvents()
  const writes = useTraceWrites()
  const [sel, setSel] = useState<string | undefined>(route.id)
  const [view, setView] = useState<View>(VIEWS.some((v) => v.id === route.tab) ? (route.tab as View) : 'table')
  const [st, setSt] = useState<'all' | Bucket>('all')
  const [q, setQ] = useState('')
  const [fp, setFp] = useState(''); const [fa, setFa] = useState(''); const [fx, setFx] = useState(''); const [fg, setFg] = useState('')
  const [hidden, setHidden] = useState<ColId[]>([])
  const evParam = route.id
  useEffect(() => { setSel(evParam); setSt('all'); setQ(''); setFp(''); setFa(''); setFx(''); setFg('') }, [pid, evParam])
  useEffect(() => { if (sel) document.getElementById('trace-' + sel)?.scrollIntoView?.({ block: 'center' }) }, [sel, view])
  /* Selection and view are screen state; the router route (path id / ?tab=)
     seeds them on entry — this surface never writes location itself. */
  const open = (id?: string) => setSel(id)
  const changeView = (v: View) => setView(v)

  if (pid === 'all') return <><PageHeader title="Tool Proposal & Execution Trace" sub="Every tool the AI proposed, with its policy decision." /><AiSubNav current="ai-trace" /><NoProject /></>
  if (trace.isPending) return <><PageHeader title="Tool Proposal & Execution Trace" sub="Every tool the AI proposed, with its policy decision." /><AiSubNav current="ai-trace" /><p className="py-3 text-sm text-muted" role="status">Loading tool trace…</p></>
  if (trace.isError) {
    const f = (trace.error as TraceReadError).failure
    return <><PageHeader title="Tool Proposal & Execution Trace" sub="Every tool the AI proposed, with its policy decision." /><AiSubNav current="ai-trace" /><Empty title="Could not load tool trace" action={<Button onClick={() => trace.refetch()}>Retry</Button>}>{f.message}</Empty></>
  }
  const all = trace.data.events
  const nq = q.trim().toLowerCase()
  const base = all.filter((r) => {
    const e = r.event
    if (fp && r.facets.policy !== fp) return false
    if (fa && r.facets.approval !== fa) return false
    if (fx && r.facets.exec !== fx) return false
    if (fg && (e.agentId || '') !== fg) return false
    return !nq || `${e.id} ${e.tool} ${e.target} ${e.planId || ''} ${e.agentId || ''} ${e.branchId || ''} ${e.opId || ''} ${e.stepId || ''} ${e.corr || ''}`.toLowerCase().includes(nq)
  })
  const count = (b: 'all' | Bucket) => (b === 'all' ? base.length : base.filter((r) => bucket(r.event) === b).length)
  const events = base.filter((r) => st === 'all' || bucket(r.event) === st)
  const awaiting = all.filter((r) => r.event.state === 'awaiting').length
  const ev = all.find((r) => r.event.id === sel)
  const facetCount = [fp, fa, fx, fg].filter(Boolean).length
  const agentIds = [...new Set(all.map((r) => r.event.agentId).filter(Boolean))] as string[]
  const clear = () => { setSt('all'); setQ(''); setFp(''); setFa(''); setFx(''); setFg('') }
  const vis = (c: ColId) => !hidden.includes(c)
  const why = 'Your role cannot approve tool calls. Ask a reviewer.'
  const stepName = (r: TraceRow) => r.plan?.stepName

  const cell = (c: ColId, r: TraceRow): ReactNode => {
    const e = r.event
    const f = r.facets
    switch (c) {
      case 'id': return <Mono className="whitespace-nowrap font-semibold">{e.id}</Mono>
      case 'at': return <span className="whitespace-nowrap text-xs">{tz(e.at)}</span>
      case 'op': return e.opId ? <IdLink onClick={() => go('operation', { id: e.opId! })}>{e.opId}</IdLink> : <Dash />
      case 'step': return e.stepId ? <span className="whitespace-nowrap"><IdLink onClick={() => e.opId ? go('operation', { id: e.opId }) : undefined}>{e.stepId}</IdLink>{e.planId && <> <IdLink onClick={() => go('ai-plan', { id: e.planId! })}>{e.planId}</IdLink></>}</span> : <span className="whitespace-nowrap text-xs text-muted">Not in a plan</span>
      case 'branch': return e.branchId ? <IdLink onClick={() => go('ai-branch', { id: e.branchId! })}>{e.branchId}</IdLink> : <Dash />
      case 'agent': return e.agentId ? <IdLink onClick={() => go('agent', { id: e.agentId! })}>{e.agentId}</IdLink> : <Dash />
      case 'target': return <span className="whitespace-nowrap">{e.target}</span>
      case 'tool': return <Mono className="whitespace-nowrap">{e.tool}</Mono>
      case 'policy': return <Pill tone={polTone(f.policy)}>{f.policy}</Pill>
      case 'appr': return <Pill tone={apprTone(f.approval)}>{f.approval}</Pill>
      case 'exec': return <Pill tone={exTone(f.exec)}>{f.exec}</Pill>
      case 'dur': return <span className="whitespace-nowrap text-xs">{dur(e.ms)}</span>
      case 'ev': return e.evidence?.length ? <span className="inline-flex gap-1.5 whitespace-nowrap">{e.evidence.map((x) => <IdLink key={x} onClick={() => go('project', { id: e.projectId, tab: 'evidence' })}>{x}</IdLink>)}</span> : <Dash />
    }
  }
  const shown = COLS.filter((c) => vis(c.id))
  const minW = shown.reduce((n, c) => n + c.w, 0) + 120

  return (
    <>
      <PageHeader title="Tool Proposal & Execution Trace" crumbs={[{ label: 'AI Operator', to: () => go('ai-operator') }, { label: 'Tool trace' }]}
        sub={<>Every tool the AI proposed in {pid}: proposal, policy decision, human approval, execution. Policy Allowed is not Executed. Demo Data — no backend enforcement.</>} />
      <AiSubNav current="ai-trace" />
      <div className="mb-4 space-y-3">
        <ReplanPanel pid={pid} compact />
        {awaiting > 0 && <Banner tone="warn" title={`${awaiting} tool call${awaiting > 1 ? 's' : ''} pending approval`} action={<Button size="sm" onClick={() => { setView('table'); setSt('pending') }}>Show pending</Button>}>Nothing runs until a reviewer allows it.</Banner>}
        {sel && !ev && <Banner tone="bad" title={`Event ${sel} was not found in ${pid}`} action={<Button size="sm" onClick={() => open(undefined)}>Dismiss</Button>}>Tool events are project-scoped; events from other projects are never shown here.</Banner>}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Segmented options={VIEWS} value={view} onChange={changeView} />
        <SearchBox value={q} onChange={setQ} placeholder="Search event, tool, target, agent, branch" className="w-64" />
        <Pop label="More filters" icon={Filter} badge={facetCount}>
          <div className="space-y-3">
            <Field label="Policy"><Select aria-label="Policy facet" value={fp} onChange={(e) => setFp(e.target.value)}><option value="">Any</option><option>Allowed</option><option>Blocked</option><option>Not evaluated</option></Select></Field>
            <Field label="Human approval"><Select aria-label="Approval facet" value={fa} onChange={(e) => setFa(e.target.value)}><option value="">Any</option><option>Not required</option><option>Pending</option><option>Approved</option><option>Denied</option></Select></Field>
            <Field label="Execution"><Select aria-label="Execution facet" value={fx} onChange={(e) => setFx(e.target.value)}><option value="">Any</option><option>Not executed</option><option>Running</option><option>Executed</option><option>Failed</option><option>Stopped</option></Select></Field>
            <Field label="Agent"><Select aria-label="Agent filter" value={fg} onChange={(e) => setFg(e.target.value)}><option value="">Any</option>{agentIds.map((a) => <option key={a}>{a}</option>)}</Select></Field>
            <Button size="sm" disabled={!facetCount} title={facetCount ? undefined : 'No facet filters are active.'} onClick={() => { setFp(''); setFa(''); setFx(''); setFg('') }}>Reset facets</Button>
          </div>
        </Pop>
        {view === 'table' && (
          <Pop label="Columns" icon={Columns3} badge={hidden.length || undefined}>
            <p className="mb-2 text-xs text-muted">Event ID is always shown.</p>
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {COLS.map((c) => (
                <label key={c.id} className={cx('flex items-center gap-2 text-sm', c.id === 'id' && 'opacity-60')}>
                  <input type="checkbox" checked={vis(c.id)} disabled={c.id === 'id'} onChange={() => setHidden(vis(c.id) ? [...hidden, c.id] : hidden.filter((x) => x !== c.id))} />{c.label}
                </label>
              ))}
            </div>
            <Button size="sm" className="mt-2" disabled={!hidden.length} title={hidden.length ? undefined : 'All columns are already visible.'} onClick={() => setHidden([])}>Show all</Button>
          </Pop>
        )}
        <DemoTag />
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="Status filter">
        {BUCKETS.map((b) => (
          <button key={b.id} onClick={() => setSt(b.id)} aria-pressed={st === b.id}
            className={cx('inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-sm transition focus-visible:outline-2 focus-visible:outline-accent', st === b.id ? 'border-accent-line bg-accent-soft font-medium text-accent' : 'border-line bg-panel text-muted hover:bg-hover hover:text-fg')}>
            {b.label}<span className="font-mono text-xs">{count(b.id)}</span>
          </button>
        ))}
        <span className="ml-1 text-xs text-muted">Showing {events.length} of {all.length} event{all.length === 1 ? '' : 's'}</span>
        {(st !== 'all' || nq || facetCount > 0) && <button className="text-xs text-accent hover:underline" onClick={clear}>Clear filters</button>}
      </div>

      {!events.length ? (
        <Empty title={all.length ? 'No events match these filters' : 'No AI tool activity in this project yet'} action={all.length ? <Button onClick={clear}>Clear filters</Button> : <Button variant="primary" onClick={() => go('ai-operator')}>Open AI Operator</Button>}>
          {all.length ? 'Counts above reflect the current search and facet filters. Clear them to see every event.' : 'Tool proposals appear here once the AI proposes a plan step or tool call.'}
        </Empty>
      ) : view === 'table' ? (
        <div className="max-h-[560px] overflow-auto rounded-xl border border-line bg-panel">
          <table className="border-collapse text-sm" style={{ minWidth: minW }}>
            <thead className="sticky top-0 z-20 bg-panel">
              <tr className="border-b border-line text-left text-xs font-medium uppercase tracking-wide text-muted">
                {shown.map((c) => <th key={c.id} style={{ minWidth: c.w }} className={cx('h-11 whitespace-nowrap bg-panel px-4 font-medium', c.id === 'id' && 'sticky left-0 z-30 border-r border-line')}>{c.label}</th>)}
                <th className="h-11 whitespace-nowrap bg-panel px-4 font-medium" style={{ minWidth: 120 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {events.map((r) => (
                <tr key={r.event.id} id={'trace-' + r.event.id} tabIndex={0} onClick={() => open(r.event.id)} onKeyDown={(k) => k.key === 'Enter' && open(r.event.id)}
                  className={cx('h-12 cursor-pointer border-b border-line/60 transition last:border-0 hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent', sel === r.event.id && 'bg-accent-soft')}>
                  {shown.map((c) => <td key={c.id} className={cx('px-4 align-middle', c.id === 'id' && cx('sticky left-0 z-10 border-r border-line', sel === r.event.id ? 'bg-accent-soft' : 'bg-panel'))}>{cell(c.id, r)}</td>)}
                  <td className="px-4 align-middle"><button className="whitespace-nowrap text-xs text-accent hover:underline" onClick={(x) => { x.stopPropagation(); open(r.event.id) }}>{r.event.state === 'awaiting' ? 'Review' : 'Inspect'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Grouped rows={events} view={view} sel={sel} open={open} stepName={stepName} />
      )}
      <p className="mt-2 text-xs text-muted">Chat messages are never counted as execution. Status chips are exclusive and sum to All; Policy, Approval and Execution facets are independent and live under More filters. Policy “Allowed” does not mean “Executed”.</p>
      <Drawer open={!!ev} onClose={() => open(undefined)} width={580} title={ev ? `Tool Event Inspector — ${ev.event.id}` : ''}>
        {ev && <Inspector key={ev.event.id} row={ev} canDecide={can('approvePlan')} why={why} onAllow={(r) => writes.decide(ev.event.id, 'allowed', r)} onDeny={(r) => writes.decide(ev.event.id, 'denied', r)} />}
      </Drawer>
    </>
  )
}

const Dash = () => <span className="text-xs text-muted">—</span>

/** Timeline / By Agent / By Branch / By Plan Step. */
function Grouped({ rows, view, sel, open, stepName }: { rows: TraceRow[]; view: View; sel?: string; open: (id: string) => void; stepName: (r: TraceRow) => string | undefined }) {
  const keyOf = (r: TraceRow) => (view === 'timeline' ? r.event.corr || 'No correlation ID' : view === 'agent' ? r.event.agentId || 'No agent assigned' : view === 'branch' ? r.event.branchId || 'No branch' : r.event.stepId ? `${r.event.opId || ''} ${r.event.stepId}`.trim() : 'No plan step')
  const groups = new Map<string, TraceRow[]>()
  ;[...rows].sort((a, b) => a.event.at.localeCompare(b.event.at)).forEach((r) => groups.set(keyOf(r), [...(groups.get(keyOf(r)) || []), r]))
  const link = (k: string, first: TraceRow): ReactNode => {
    if (view === 'agent' && first.event.agentId) return <IdLink onClick={() => go('agent', { id: first.event.agentId! })}>{k}</IdLink>
    if (view === 'branch' && first.event.branchId) return <IdLink onClick={() => go('ai-branch', { id: first.event.branchId! })}>{k}</IdLink>
    if (view === 'step' && first.event.stepId) return <span className="inline-flex items-center gap-2"><Mono className="font-semibold">{k}</Mono>{stepName(first) && <span className="text-sm">{stepName(first)}</span>}{first.event.planId && <IdLink onClick={() => go('ai-plan', { id: first.event.planId! })}>{first.event.planId}</IdLink>}</span>
    return <Mono className="font-semibold">{k}</Mono>
  }
  return (
    <div className="space-y-3">
      {[...groups.entries()].map(([k, list]) => (
        <Card key={k} pad={false}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-2 text-sm">{link(k, list[0]!)}<span className="text-xs text-muted">{view === 'timeline' ? 'correlation ID' : view === 'agent' ? 'agent' : view === 'branch' ? 'branch' : 'step'} · {list.length} event{list.length > 1 ? 's' : ''}</span></div>
            {view === 'branch' && list[0]!.event.agentId && <span className="text-xs text-muted">Agent {list[0]!.event.agentId}</span>}
          </div>
          <ul>
            {list.map((r) => { const e = r.event; const f = r.facets; return (
              <li key={e.id} id={'trace-' + e.id}>
                <button onClick={() => open(e.id)} className={cx('flex w-full flex-wrap items-center gap-x-4 gap-y-1 border-b border-line/60 px-4 py-2.5 text-left text-sm last:border-0 hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent', sel === e.id && 'bg-accent-soft')}>
                  <Mono className="whitespace-nowrap font-semibold">{e.id}</Mono>
                  <span className="whitespace-nowrap text-xs text-muted">{tz(e.at)}</span>
                  <span className="min-w-[160px] flex-1"><Mono>{e.tool}</Mono> on {e.target}</span>
                  <Pill tone={polTone(f.policy)}>Policy: {f.policy}</Pill><Pill tone={apprTone(f.approval)}>Approval: {f.approval}</Pill><Pill tone={exTone(f.exec)}>{f.exec}</Pill>
                </button>
              </li>
            ) })}
          </ul>
        </Card>
      ))}
    </div>
  )
}

function Inspector({ row, canDecide, why, onAllow, onDeny }: { row: TraceRow; canDecide: boolean; why: string; onAllow: (r: string) => Promise<ServiceResult<ToolDecisionOutcome>>; onDeny: (r: string) => Promise<ServiceResult<ToolDecisionOutcome>> }) {
  const toast = useToastStore((s) => s.toast)
  const ev = row.event
  const [decision, setDecision] = useState<'allowed' | 'denied' | null>(null)
  const [reason, setReason] = useState('')
  const f = row.facets
  /* The typed handler owns the gates; the explicit ServiceResult is the
     refusal surface (a refusal commits nothing and renders its reason). */
  const submit = (kind: 'allowed' | 'denied', whyText: string) => {
    void (kind === 'allowed' ? onAllow(whyText) : onDeny(whyText)).then((res) => {
      if (res.ok) {
        toast(`${ev.id} ${kind === 'allowed' ? 'allowed — Policy Allowed, not executed' : 'denied'} (recorded).`, kind === 'allowed' ? 'ok' : 'warn')
        setDecision(null); setReason('')
      } else toast(res.failure.message, 'bad')
    })
  }
  const stages = [
    { n: 'Proposal', d: `AP-${ev.id.replace('TL-', '')} by AI Operator`, tone: 'ok' as const, t: ev.at },
    { n: 'Policy decision', d: f.policy === 'Not evaluated' ? 'Not evaluated yet' : f.policy, tone: polTone(f.policy), t: f.policy === 'Not evaluated' ? 'pending' : ev.at },
    { n: 'Human approval', d: f.approval, tone: apprTone(f.approval), t: f.approval === 'Pending' ? 'pending' : '' },
    { n: 'Execution state', d: f.exec, tone: exTone(f.exec), t: '' },
  ]
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2"><Status kind="tool" value={ev.state} /><DemoTag /><span className="text-xs text-muted">Simulated — no real commands run</span></div>
      {ev.state === 'awaiting' && (
        <Banner tone="warn" title="Waiting for a reviewer decision">Nothing runs until this is allowed.
          <div className="mt-2">
            {decision ? (
              <div className="space-y-2">
                <Field label={`Reason for ${decision === 'allowed' ? 'allowing' : 'denying'}`} required hint="Recorded in the audit trail.">
                  <Textarea aria-label="Decision reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={`Why should this tool call be ${decision === 'allowed' ? 'allowed' : 'denied'}?`} />
                </Field>
                <div className="flex gap-2">
                  <Button
                    variant={decision === 'allowed' ? 'primary' : 'danger'}
                    size="sm"
                    disabled={!reason.trim()}
                    title={reason.trim() ? undefined : 'A decision reason is required.'}
                    onClick={() => submit(decision, reason.trim())}
                  >
                    {decision === 'allowed' ? 'Confirm allow' : 'Confirm deny'}
                  </Button>
                  <Button size="sm" onClick={() => { setDecision(null); setReason('') }}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <Gated allowed={canDecide} reason={why}><Button size="sm" variant="primary" onClick={() => setDecision('allowed')}>Review & allow</Button></Gated>
                <Gated allowed={canDecide} reason={why}><Button size="sm" variant="danger" onClick={() => setDecision('denied')}>Review & deny</Button></Gated>
              </div>
            )}
          </div>
        </Banner>
      )}
      <Card>
        <CardHeader title="Proposal, policy, approval, execution" sub="Three independent facts — Policy Allowed is not Executed" />
        <ol className="space-y-3">
          {stages.map((s, i) => (
            <li key={s.n} className="flex gap-3">
              <span className="mt-1 flex flex-col items-center"><span className={`h-2.5 w-2.5 rounded-full ${s.t === 'pending' || s.d === 'Not required' ? 'bg-line' : 'bg-ok'}`} />{i < stages.length - 1 && <span className="mt-1 h-6 w-px bg-line" />}</span>
              <div className="text-sm"><div className="flex flex-wrap items-center gap-2 font-medium">{s.n}<Pill tone={s.tone}>{s.d}</Pill></div>{s.t && <div className="text-xs text-muted">{s.t === 'pending' ? 'Pending' : tz(s.t)}</div>}</div>
            </li>
          ))}
        </ol>
        {ev.reason && <div className="mt-3 rounded-lg border border-line bg-subtle px-3 py-2 text-xs"><span className="font-semibold">Policy reason: </span>{ev.reason}</div>}
        {ev.state === 'denied' && <p className="mt-2 text-xs text-muted">Blocked at policy: never executed. <button className="text-accent hover:underline" onClick={() => go('assets')}>Review approved assets</button></p>}
      </Card>
      <Card>
        <CardHeader title="Details" />
        <DescList cols={1} items={[
          { k: 'Tool / target', v: <><Mono>{ev.tool}</Mono> on {ev.target}</> },
          { k: 'Inputs (summary)', v: <span className="text-muted">[summarized, sensitive values redacted] {row.params}</span> },
          { k: 'Output (sanitized)', v: row.result || <span className="text-muted">No output — not executed or nothing returned</span> },
          { k: 'Agent', v: ev.agentId ? <IdLink onClick={() => go('agent', { id: ev.agentId! })}>{ev.agentId}</IdLink> : 'None assigned' },
          { k: 'Branch', v: ev.branchId ? <span className="inline-flex items-center gap-2"><IdLink onClick={() => go('ai-branch', { id: ev.branchId! })}>{ev.branchId}</IdLink>{row.branch && <span className="text-xs text-muted">{row.branch.state.replace('_', ' ')}</span>}</span> : 'No branch' },
          { k: 'Plan step', v: ev.stepId ? <span className="inline-flex flex-wrap items-center gap-1.5"><Mono>{ev.stepId}</Mono>{row.plan?.stepName && <span>{row.plan.stepName}</span>}{row.plan && <IdLink onClick={() => go('ai-plan', { id: row.plan!.id })}>{row.plan!.id}</IdLink>}{row.plan && <span className="text-xs text-muted">{row.plan.version}</span>}</span> : 'Not in a plan' },
          { k: 'Operation', v: ev.opId ? <IdLink onClick={() => go('operation', { id: ev.opId! })}>{ev.opId}</IdLink> : 'Not executed — no operation' },
          { k: 'Timing', v: <span className="text-xs">{tz(ev.at)} · duration {dur(ev.ms)}</span> },
          { k: 'Correlation ID', v: <Mono>{ev.corr || '—'}</Mono> },
          { k: 'Decision record', v: ev.decision ? <span className="whitespace-pre-wrap">{`${ev.decision.outcome} by ${ev.decision.by}, ${tz(ev.decision.at)} — ${ev.decision.note}`}</span> : <span className="text-muted">No human decision recorded{ev.state === 'awaiting' ? ' — pending a reviewer' : ''}</span> },
          { k: 'Evidence', v: ev.evidence?.length ? <span className="inline-flex gap-2">{ev.evidence.map((x) => <IdLink key={x} onClick={() => go('project', { id: ev.projectId, tab: 'evidence' })}>{x}</IdLink>)}</span> : 'None captured' },
          { k: 'Audit', v: <button className="text-accent hover:underline" onClick={() => go('ai-history')}>View in AI Audit →</button> },
        ]} />
      </Card>
      {ev.state === 'failed' && <ReplanPanel pid={ev.projectId} compact />}
      <div className="flex flex-wrap gap-2">
        <Button icon={ExternalLink} onClick={() => go('ai-operator', { id: ev.conversationId })}>View Conversation</Button>
        {ev.opId ? <Button icon={ExternalLink} onClick={() => go('operation', { id: ev.opId! })}>View Operation</Button> : <Button disabled title="This event was never linked to an operation (blocked or not yet executed).">View Operation</Button>}
        <Button onClick={() => { void navigator.clipboard?.writeText(ev.id); toast('ID copied.', 'ok') }}>Copy ID</Button>
      </div>
    </div>
  )
}

/* ───────────── AI History ───────────── */
/* Ticket 42: the history archive (plans/conversations/audit), its search and
   pagination, the actor-type derivation and the sensitive masking live in the
   aichat feature (src/features/aichat/history.ts) — this screen renders the
   typed read with zero db.* access on the route. */
const STORE_KEY = 'raptix.ai-history.return'
const AUDIT_PAGE = 10
const typeTone = (t: string) => (t === 'AI' ? 'cyan' : t === 'System' ? 'neutral' : 'ok') as 'cyan' | 'neutral' | 'ok'

export function AiHistory() {
  const pid = useProjectStore((s) => s.pid)
  const can = useCan()
  const toast = useToastStore((s) => s.toast)
  const services = useServices()
  const qscope = useQueryScope()
  /* Pin/unpin goes through the typed ChatService write; the read's key embeds
     the scope, so the committed pin's ChangeSet refetches the archive. */
  const chat = useMemo(
    () => createChatHandlers(services, actorRef(qscope.actor), qscope.project),
    [services, qscope.actor, qscope.project],
  )
  const [tab, setTab] = useState('plans')
  const [open, setOpen] = useState<string>()
  const [audId, setAudId] = useState<string>()
  const [scope, setScope] = useState<'ai' | 'all'>('ai')
  const [at, setAt] = useState('all')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const hist = useAiHistory({ q, actorType: at as ActorType | 'all', aiOnly: scope === 'ai', page: { page, pageSize: AUDIT_PAGE } })
  const audQ = useAiAudit(audId)
  useEffect(() => {
    setOpen(undefined); setAudId(undefined); setQ(''); setAt('all'); setPage(1)
    let saved: { pid: string; tab: string; y: number } | undefined
    try { saved = JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null') ?? undefined } catch { /* ignore */ }
    if (saved && saved.pid === pid) {
      sessionStorage.removeItem(STORE_KEY); setTab(saved.tab)
      window.setTimeout(() => document.querySelector('main')?.scrollTo?.(0, saved!.y), 60)
    } else setTab('plans')
  }, [pid])
  const header = <PageHeader title="Conversation History & Provenance" crumbs={[{ label: 'AI Operator', to: () => go('ai-operator') }, { label: 'History' }]} sub={`AI activity for ${pid} only. Conversations from other projects are never merged or cached here. Demo Data.`} />
  if (pid === 'all') return <>{header}<AiSubNav current="ai-history" /><NoProject /></>
  if (hist.isPending) return <>{header}<AiSubNav current="ai-history" /><p className="py-3 text-sm text-muted" role="status">Loading history…</p></>
  if (hist.isError) {
    const f = (hist.error as AiHistoryReadError).failure
    return <>{header}<AiSubNav current="ai-history" /><Empty title="Could not load history" action={<Button onClick={() => hist.refetch()}>Retry</Button>}>{f.message}</Empty></>
  }
  const { plans, conversations, counts, audit, context } = hist.data
  const convs = conversations.map((h) => h.conversation)
  const byId = new Map(conversations.map((h) => [h.conversation.id, h]))
  const hc = open ? byId.get(open) : undefined
  const pages = Math.max(1, Math.ceil(audit.total / audit.pageSize))
  const exp = can('viewSensitive')
  const openOriginal = (c: Conversation) => {
    sessionStorage.setItem(STORE_KEY, JSON.stringify({ pid, tab: 'conv', y: document.querySelector('main')?.scrollTop || 0 }))
    go('ai-operator', { id: c.id })
  }
  /* The archive's message texts are already masked at the service boundary. */
  const exportTranscript = (h: HistoryConversation) => {
    const c = h.conversation
    const body = [`# ${c.title} (${c.id}) — redacted transcript`, `Project ${pid} · Mode ${modeLabel(c.mode)} · Demo Data`, '', ...c.messages.map((m) => `[${m.at}] ${m.role.toUpperCase()}: ${m.text}`)].join('\n')
    const url = URL.createObjectURL(new Blob([body], { type: 'text/plain' }))
    const a = document.createElement('a'); a.href = url; a.download = `${c.id}-redacted.txt`; a.click(); URL.revokeObjectURL(url)
    toast('Redacted transcript downloaded (demo). Limited to your project access.', 'ok')
  }
  const pin = (c: Conversation) => {
    const res = chat.setPinned(c.id)
    if (res.ok) toast(c.pinned ? `${c.id} unpinned.` : `${c.id} pinned.`, 'info')
    else toast(res.failure.message, 'bad')
  }
  const hasCompare = (id: string) => plans.some((p) => p.id === id && p.prevPlanId) || plans.some((p) => p.prevPlanId === id)
  const related = (a: Audit): ReactNode => {
    const o = a.obj
    const to = /^PL-/.test(o) ? () => go('ai-plan', { id: o }) : /^OP-/.test(o) ? () => go('operation', { id: o }) : /^TL-/.test(o) ? () => go('ai-trace', { id: o }) : /^AG-/.test(o) ? () => go('agent', { id: o }) : /^(SS|CH)-/.test(o) ? () => go('project', { id: a.projectId, tab: 'sessions' }) : /^RT-|^PT-/.test(o) ? () => go('project', { id: o }) : /^[a-z0-9-]+$/.test(o) && !/^[A-Z]/.test(o) ? () => go('assets') : undefined
    return to ? <IdLink onClick={to}>{o}</IdLink> : <Mono className="whitespace-nowrap">{o}</Mono>
  }
  const au = audQ.data
  return (
    <>
      {header}
      <AiSubNav current="ai-history" />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'plans', label: 'Plans', count: plans.length }, { id: 'conv', label: 'Conversations', count: convs.length }, { id: 'audit', label: 'AI Audit', count: counts.ai }]} />
      <div className="mt-4">
        {tab === 'plans' && <Table rows={plans} rowKey={(p) => p.id} onRow={(p) => go('ai-plan', { id: p.id })} empty={<Empty title="No AI plans yet" action={<Button variant="primary" onClick={() => go('ai-operator')}>Open AI Operator</Button>}>Ask the AI to propose a plan in Propose mode.</Empty>} cols={[
          { key: 'id', header: 'Plan', render: (p) => <Mono className="whitespace-nowrap">{p.id}</Mono> }, { key: 't', header: 'Title', render: (p) => <span className="whitespace-nowrap">{p.title}</span> }, { key: 'v', header: 'Version', render: (p) => <span className="whitespace-nowrap">{planVer(p)}</span> },
          { key: 's', header: 'Status', render: (p) => <Status kind="plan" value={p.status} /> }, { key: 'pr', header: 'Revises', render: (p) => (p.prevPlanId ? <IdLink onClick={() => go('ai-plan', { id: p.prevPlanId! })}>{p.prevPlanId}</IdLink> : '—') },
          { key: 'c', header: 'Conversation', render: (p) => <IdLink onClick={() => go('ai-operator', { id: p.conversationId })}>{p.conversationId}</IdLink> }, { key: 'u', header: 'Updated', render: (p) => <span className="whitespace-nowrap text-xs">{tz(p.updated)}</span> },
          { key: 'a', header: 'Actions', render: (p) => <span className="flex gap-2 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
            <Button size="sm" onClick={() => go('ai-plan', { id: p.id })}>Open</Button>
            <Button size="sm" disabled={!hasCompare(p.id)} title={hasCompare(p.id) ? undefined : 'This plan has no other revision to compare.'} onClick={() => go('ai-plan-compare', { id: p.id })}>Compare</Button>
          </span> },
        ]} />}
        {tab === 'conv' && <Table rows={convs} rowKey={(c) => c.id} onRow={(c) => setOpen(c.id)} empty={<Empty title="No conversations yet for this project" action={<Button variant="primary" onClick={() => go('ai-operator')}>Open AI Operator</Button>}>Start one from the AI Operator workspace.</Empty>} cols={[
          { key: 'id', header: 'Conversation', render: (c) => <div className="min-w-[180px]"><div>{c.title}</div><Mono className="whitespace-nowrap text-muted">{c.id}</Mono></div> },
          { key: 'a', header: 'Actor', render: (c) => <span className="whitespace-nowrap">{c.owner}</span> }, { key: 'mo', header: 'Model', render: () => <span className="whitespace-nowrap text-xs">raptix-ai-demo-1</span> },
          { key: 'm', header: 'Mode', render: (c) => <span className="whitespace-nowrap">{modeLabel(c.mode)}</span> },
          { key: 'p', header: 'Plans', render: (c) => { const ann = byId.get(c.id)?.plans ?? []; return ann.length ? <span className="inline-flex gap-1.5">{ann.map((a) => <IdLink key={a.id} onClick={() => go('ai-plan', { id: a.id })}>{a.id}</IdLink>)}</span> : '—' } },
          { key: 'ta', header: 'Tool approvals', render: (c) => byId.get(c.id)?.toolApprovals.length ?? 0 },
          { key: 'r', header: 'Retention', render: () => <span className="whitespace-nowrap">90 days</span> }, { key: 'u', header: 'Last activity', render: (c) => <span className="whitespace-nowrap text-xs">{tz(c.updated)}</span> },
          { key: 'ac', header: 'Actions', render: (c) => <span className="flex gap-2 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
            <Button size="sm" onClick={() => openOriginal(c)}>Open</Button>
            <Button size="sm" onClick={() => setOpen(c.id)}>View Provenance</Button>
            <Button size="sm" aria-pressed={!!c.pinned} aria-label={c.pinned ? `Unpin ${c.title}` : `Pin ${c.title}`} onClick={() => pin(c)}>{c.pinned ? 'Unpin' : 'Pin'}</Button>
          </span> },
        ]} />}
        {tab === 'audit' && <>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <Segmented options={[{ id: 'ai' as const, label: `AI-related (${counts.ai})` }, { id: 'all' as const, label: `All project events (${counts.all})` }]} value={scope} onChange={setScope} />
            <SearchBox value={q} onChange={setQ} placeholder="Search event, actor, object, correlation" className="w-72" />
            <Select aria-label="Actor type" className="w-40" value={at} onChange={(e) => setAt(e.target.value)}><option value="all">All actor types</option><option>Human</option><option>AI</option><option>System</option></Select>
            <DemoTag />
          </div>
          <Table rows={audit.items} rowKey={(a) => a.audit.id} onRow={(a) => setAudId(a.audit.id)} empty={<Empty title="No audit events match" action={<Button onClick={() => { setQ(''); setAt('all'); setScope('all') }}>Show all project events</Button>}>AI proposals, blocks and plan decisions are recorded here. Adjust the filters to see more.</Empty>} cols={[
            { key: 'id', header: 'Event ID', render: (a) => <Mono className="whitespace-nowrap font-semibold">{a.audit.id}</Mono> },
            { key: 'ac', header: 'Actor', render: (a) => <span className="whitespace-nowrap">{a.audit.actor}</span> },
            { key: 'ty', header: 'Actor type', render: (a) => <Pill tone={typeTone(a.actorType)}>{a.actorType}</Pill> },
            { key: 'et', header: 'Event type', render: (a) => <span className="whitespace-nowrap">{a.eventType}</span> },
            { key: 'pr', header: 'Project', render: (a) => <IdLink onClick={() => go('project', { id: a.audit.projectId })}>{a.audit.projectId}</IdLink> },
            { key: 'o', header: 'Related object', render: (a) => related(a.audit) },
            { key: 'at', header: 'Timestamp', render: (a) => <span className="whitespace-nowrap text-xs">{tz(a.audit.at)}</span> },
            { key: 'r', header: 'Result', render: (a) => <span className="whitespace-nowrap">{a.audit.result}</span> },
            { key: 'co', header: 'Correlation ID', render: (a) => a.audit.corr ? <Mono className="whitespace-nowrap">{a.audit.corr}</Mono> : '—' },
          ]} />
          {audit.total > 0 && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>Showing {audit.items.length} of {audit.total} event{audit.total === 1 ? '' : 's'}</span>
            <Button size="sm" disabled={audit.page <= 1} title={audit.page <= 1 ? 'This is the first page.' : undefined} onClick={() => setPage(audit.page - 1)}>Previous</Button>
            <span>Page {audit.page} of {pages}</span>
            <Button size="sm" disabled={audit.page >= pages} title={audit.page >= pages ? 'This is the last page.' : undefined} onClick={() => setPage(audit.page + 1)}>Next</Button>
          </div>}
        </>}
      </div>

      <Drawer open={!!open} onClose={() => setOpen(undefined)} width={640} title={hc ? `Provenance — ${hc.conversation.title}` : ''}
        footer={<div className="flex flex-wrap gap-2">
          {hc && <Button onClick={() => openOriginal(hc.conversation)}>Open original conversation</Button>}
          <Gated allowed={exp} reason="Exporting transcripts needs sensitive-data permission (Manager, Reviewer or Admin)."><Button icon={Download} onClick={() => hc && exportTranscript(hc)}>Export Transcript (redacted)</Button></Gated>
        </div>}>
        {hc && <div className="space-y-4">
          <Card><CardHeader title="Provenance" sub="Export is redacted and limited to what your access allows" /><DescList cols={1} items={[
            { k: 'Conversation', v: <Mono>{hc.conversation.id}</Mono> }, { k: 'Actor', v: hc.conversation.owner }, { k: 'Model', v: 'raptix-ai-demo-1 (v1.0)' },
            { k: 'Conversation mode', v: <>{modeLabel(hc.conversation.mode)} <span className="text-xs text-muted">(per-conversation; does not mean execution is active)</span></> },
            { k: 'Context snapshot', v: `${pid} project record, ROE ${context.roeVersion ?? '—'}, ${context.inScopeAssets} approved assets, ${context.agents} project agents — as of ${tz(hc.conversation.updated)}` },
            { k: 'Sources', v: 'Project record, ROE, assets, agent health, operation results (this project only)' },
            { k: 'Artifacts', v: hc.plans.length ? <span className="inline-flex flex-wrap gap-2">{hc.plans.map((a) => <IdLink key={a.id} onClick={() => go('ai-plan', { id: a.id })}>{a.id} {a.version}</IdLink>)}</span> : 'None' },
            { k: 'Tool approvals', v: hc.toolApprovals.length ? <ul className="space-y-0.5 text-xs">{hc.toolApprovals.map((t) => <li key={t.id}><IdLink onClick={() => go('ai-trace', { id: t.id })}>{t.id}</IdLink> {t.tool} — policy {t.facets.policy}, approval {t.facets.approval}, {t.facets.exec}</li>)}</ul> : 'None' },
            { k: 'Retention', v: '90 days, then redacted archive' },
          ]} /></Card>
          <Thread conv={hc.conversation} compact />
        </div>}
      </Drawer>

      <Drawer open={!!audId} onClose={() => setAudId(undefined)} width={520} title={au ? `Audit Inspector — ${au.audit.id}` : audId ? 'Audit Inspector' : ''}>
        {audId && audQ.isPending && <p className="py-3 text-sm text-muted" role="status">Loading audit event…</p>}
        {audId && audQ.isError && <Empty title="Audit event unavailable" action={<Button onClick={() => setAudId(undefined)}>Close</Button>}>{(audQ.error as AiHistoryReadError).failure.message}</Empty>}
        {au && <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2"><Pill tone={typeTone(au.actorType)}>{au.actorType}</Pill><DemoTag /></div>
          <Card><DescList cols={1} items={[
            { k: 'Event ID', v: <Mono>{au.audit.id}</Mono> }, { k: 'Actor', v: `${au.audit.actor} (${au.audit.role})` }, { k: 'Event type', v: au.eventType }, { k: 'Action', v: au.audit.action },
            { k: 'Project', v: <IdLink onClick={() => go('project', { id: au.audit.projectId })}>{au.audit.projectId}</IdLink> }, { k: 'Related object', v: related(au.audit) },
            { k: 'Timestamp', v: tz(au.audit.at) }, { k: 'Result', v: au.audit.result }, { k: 'Reason', v: au.audit.reason || '—' }, { k: 'Correlation ID', v: au.audit.corr ? <Mono>{au.audit.corr}</Mono> : 'None' },
          ]} /></Card>
          {au.related && (au.related.audits.length > 0 || au.related.tools.length > 0) ? (
            <Card><CardHeader title="Related events" sub={`Same correlation ID ${au.audit.corr}`} /><ul className="space-y-1 text-sm">
              {au.related.audits.map((x) => <li key={x.id}><IdLink onClick={() => setAudId(x.id)}>{x.id}</IdLink> <span className="text-muted">{x.actor} — {x.action}</span></li>)}
              {au.related.tools.map((t) => <li key={t.id}><IdLink onClick={() => go('ai-trace', { id: t.id })}>{t.id}</IdLink> <span className="text-muted">tool event — {t.tool}</span></li>)}
            </ul></Card>
          ) : <p className="text-xs text-muted">This event has no correlation ID, so no related events are linked.</p>}
          <div className="flex gap-2"><Button onClick={() => { void navigator.clipboard?.writeText(au.audit.id); toast('ID copied.', 'ok') }}>Copy ID</Button><Button icon={X} onClick={() => setAudId(undefined)}>Close</Button></div>
        </div>}
      </Drawer>
    </>
  )
}
