/**
 * Operation results + execution graph tabs (ticket 30, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Both tabs run on the typed results read (src/features/results/query):
 * nodes and edges derive from canonical execution events — step outcomes as
 * recorded (completed/failed/unknown/queued/not-run stay distinct) and
 * playbook-order connectors, with recorded sessions listed alongside. The
 * graph never infers an attack path: connectors show sequence, dashed lines
 * mean the step has not run, and the view states observed outcomes only.
 * Node buttons are keyboard-operable (focus reveals the same inspector as
 * pointer selection); links resolve to migrated routes; loading, empty and
 * error states are feature-local; the read is scope-keyed so a delayed
 * superseded response never restores old visibility.
 */
import { useRef, useState, type ReactNode } from 'react'
import { Download, FilePlus2, Maximize2, Network, Paperclip, Plus, Minus, ShieldAlert } from 'lucide-react'
import { Banner, Button, Card, CardHeader, Check, Empty, Field, IdLink, Input, Modal, Mono, SearchBox, Select, Skeleton, Status, STATUS, Table, useGuard, cx } from '../../../ui/index'
import { go } from '../../../router/navigate'
import { useCan, useMe } from '../../../state/console'
import { useToastStore } from '../../../state/stores'
import { useSessionStore } from '../../../state/session'
import { useOperationMockConsole } from '../query'
import type { Operation } from '../../../domain/entities'
import { MASK, STEP_BORDER } from './operation-common'
import { StepDrawer } from './operation-console'
import { ResultsReadError, useOperationResults } from '../../results/query'
import type { OperationResultsRead, ResultsEdge, ResultsStep } from '../../results/service'

const download = (name: string, text: string, mime = 'application/json') => {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: mime }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 500)
}

/** One typed read for both tabs: loading skeleton, refusal reason with retry, then the view. */
function ResultsGate({ opId, children }: { opId: string; children: (read: OperationResultsRead) => ReactNode }) {
  const read = useOperationResults(opId)
  if (read.isPending) return <div className="space-y-2" aria-busy="true"><Skeleton className="h-14" /><Skeleton className="h-24" /><Skeleton className="h-64" /></div>
  if (read.isError) {
    const failure = read.error instanceof ResultsReadError ? read.error.failure : undefined
    return <Empty icon={ShieldAlert} title="Results could not be loaded" action={<Button onClick={() => read.refetch()}>Retry</Button>}>{failure?.message || 'Something went wrong while loading operation results.'}</Empty>
  }
  return <>{children(read.data)}</>
}

export function GraphTab({ op }: { op: Operation }) {
  return <ResultsGate opId={op.id}>{(read) => <GraphView read={read} />}</ResultsGate>
}

/* ───────────── Execution graph ───────────── */
const COLS = 4, NW = 170, NH = 72, GX = 40, GY = 56, PAD = 20
const TONE_TXT: Record<string, string> = { ok: 'text-ok', bad: 'text-bad', accent: 'text-accent', neutral: 'text-neutral', warn: 'text-warn', cyan: 'text-cyan' }

function GraphView({ read }: { read: OperationResultsRead }) {
  const mock = useOperationMockConsole()
  const logs = useSessionStore((s) => s.logs)
  const toast = useToastStore((s) => s.toast)
  /* The legacy `A.audit` entry, mirrored exactly: one 'legacy' commit with the
     store helper's exact row shape (the RT-2026-014 SS/AR corr rule, the demo
     stamp, the override-aware persona). */
  const audit = (action: string, obj: string, projectId: string, result = 'Success', reason = '') =>
    mock.audit(projectId, { action, obj, result, reason })
  const op = read.op
  const [sel, setSel] = useState<string | null>(null)
  const [fa, setFa] = useState('')
  const [fs, setFs] = useState<Record<string, boolean>>({})
  const [zoom, setZoom] = useState(1)
  const box = useRef<HTMLDivElement>(null)
  if (op.steps.length < 2 || read.executed < 2) {
    return <Empty icon={Network} title="Not enough events to draw the graph" action={<Button onClick={() => go('operation', { id: op.id, tab: 'overview' })}>Back to overview</Button>}>The graph is built only from steps that have execution data (at least 2 steps must have run). The system never infers an attack path when data is missing.</Empty>
  }
  const pos = read.steps.map((_, i) => { const r = Math.floor(i / COLS); const c0 = i % COLS; const c = r % 2 ? COLS - 1 - c0 : c0; return { x: PAD + c * (NW + GX), y: PAD + r * (NH + GY) } })
  const W = PAD * 2 + COLS * NW + (COLS - 1) * GX
  const H = PAD * 2 + (Math.floor((op.steps.length - 1) / COLS) + 1) * NH + Math.floor((op.steps.length - 1) / COLS) * GY
  const at = (id: string) => { const i = read.steps.findIndex((s) => s.step.id === id); return i >= 0 ? pos[i] : undefined }
  const edgePath = (e: ResultsEdge) => {
    const a = at(e.from), b = at(e.to)
    if (!a || !b) return null
    if (a.y === b.y) { const right = b.x > a.x; return `M${a.x + (right ? NW : 0)},${a.y + NH / 2} L${b.x + (right ? 0 : NW)},${b.y + NH / 2}` }
    return `M${a.x + NW / 2},${a.y + NH} L${b.x + NW / 2},${b.y}`
  }
  const visible = (s: ResultsStep) => (!fa || s.step.agent === fa) && (Object.values(fs).every((v) => !v) || fs[s.step.status])
  const step = read.steps.find((s) => s.step.id === sel)?.step ?? null
  const fit = () => setZoom(Math.min(1, ((box.current?.clientWidth || W) - 8) / W))
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr]">
      <Card className="h-fit">
        <h4 className="mb-3 text-sm font-semibold">Filters</h4>
        <Field label="Agent"><Select value={fa} onChange={(e) => setFa(e.target.value)}><option value="">All agents</option>{op.agents.map((a) => <option key={a}>{a}</option>)}</Select></Field>
        <div className="mt-4 space-y-2">
          <div className="text-xs font-medium text-muted">Status legend</div>
          {(['ok', 'fail', 'running', 'pending', 'notrun', 'unknown'] as const).map((k) => {
            const m = STATUS.step[k]; const I = m.icon
            return <div key={k} className="flex items-center gap-2 text-xs"><Check checked={!!fs[k]} onChange={(v) => setFs({ ...fs, [k]: v })} /><I size={14} className={TONE_TXT[m.tone]} aria-hidden /><span>{m.label}</span></div>
          })}
          <p className="pt-1 text-[11px] text-neutral">Connectors show playbook order; dashed lines mean the step has not run. No attack path is inferred.</p>
        </div>
      </Card>
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Button size="sm" icon={Minus} aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(1)))} />
          <span className="w-12 text-center text-xs tabular-nums text-muted">{Math.round(zoom * 100)}%</span>
          <Button size="sm" icon={Plus} aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(1.5, +(z + 0.1).toFixed(1)))} />
          <Button size="sm" icon={Maximize2} onClick={fit}>Fit to view</Button>
          <Button size="sm" icon={Download} className="ml-auto" disabled={!read.viewSensitive} title={read.viewSensitive ? undefined : 'Your role cannot export the graph.'}
            onClick={() => { download(`${op.id}-graph.json`, JSON.stringify({ op: op.id, nodes: read.steps.map((s) => ({ id: s.step.id, status: s.step.status, technique: s.step.technique, agent: s.step.agent })), edges: read.edges.map((e) => [e.from, e.to]) }, null, 2)); audit('Exported execution graph', op.id, op.projectId); toast('Graph exported (JSON).') }}>Export graph</Button>
        </div>
        <div ref={box} className="overflow-auto rounded-xl border border-line bg-bg" style={{ maxHeight: 640 }}>
          <div style={{ width: W * zoom, height: H * zoom }}>
            <div className="relative origin-top-left" style={{ width: W, height: H, transform: `scale(${zoom})` }}>
              <svg width={W} height={H} className="absolute inset-0" aria-hidden>
                <defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--c-neutral)" /></marker></defs>
                {read.edges.map((e) => { const d = edgePath(e); return d ? <path key={`${e.from}-${e.to}`} d={d} stroke="var(--c-neutral)" strokeWidth={1.5} strokeDasharray={e.dashed ? '5 4' : undefined} fill="none" markerEnd="url(#arr)" /> : null })}
              </svg>
              {read.steps.map((s, i) => {
                const m = STATUS.step[s.step.status]; const I = m.icon
                return (
                  <button key={s.step.id} onClick={() => setSel(s.step.id)} onFocus={() => setSel(s.step.id)}
                    aria-label={`Step ${s.step.id}, ${m.label} — ${s.step.name}`}
                    style={{ left: pos[i].x, top: pos[i].y, width: NW, height: NH }}
                    className={cx('absolute rounded-xl border-2 bg-panel p-2 text-left transition hover:bg-hover', STEP_BORDER[s.step.status], !visible(s) && 'opacity-25', sel === s.step.id && 'ring-2 ring-accent')}>
                    <div className="flex items-center justify-between"><Mono className="text-muted">{s.step.id}</Mono><span className={cx('inline-flex items-center gap-1 text-[11px] font-medium', TONE_TXT[m.tone])}><I size={12} className={s.step.status === 'running' ? 'animate-spin' : ''} aria-hidden />{m.label}</span></div>
                    <div className="mt-1 line-clamp-2 text-xs leading-4">{s.step.name}</div>
                    {s.branches.length > 0 && <span className="absolute bottom-1 right-2 text-[10px] text-muted">{s.branches.length} branch{s.branches.length === 1 ? '' : 'es'}{s.branches.some((b) => b.failed) ? ' · failed' : ''}</span>}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
        {read.sessions.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted" aria-label="Recorded sessions">
            <span className="font-medium text-fg">Recorded sessions</span>
            {read.sessions.map((s) => (
              <span key={s.id} className="inline-flex items-center gap-1.5"><IdLink onClick={() => go('c2-session', { id: s.id })}>{s.id}</IdLink><Status kind="session" value={s.state} size="sm" /><span className="max-sm:hidden">{s.agentId} · {s.asset}</span></span>
            ))}
          </div>
        )}
      </div>
      <StepDrawer op={op} step={step} onClose={() => setSel(null)} logs={logs[op.id] || []} />
    </div>
  )
}

/* ───────────── Results and evidence ───────────── */
export function ResultsTab({ op }: { op: Operation }) {
  return <ResultsGate opId={op.id}>{(read) => <ResultsView read={read} />}</ResultsGate>
}

function ResultsView({ read }: { read: OperationResultsRead }) {
  const me = useMe()
  const mock = useOperationMockConsole()
  const persistFilters = useSessionStore((s) => s.persistFilters)
  const setFilter = useSessionStore((s) => s.setFilter)
  const logs = useSessionStore((s) => s.logs)
  const can = useCan()
  const toast = useToastStore((s) => s.toast)
  const op = read.op
  const [stepSel, setStepSel] = useState<string | null>(null)
  const { ro, reason } = useGuard(op.projectId)
  const signoff = persistFilters['signoff.' + op.id] as { by: string; at: string } | undefined
  const [attach, setAttach] = useState(false)
  const [q, setQ] = useState('')
  const [nm, setNm] = useState('')
  const [kind, setKind] = useState('Text')
  const [sens, setSens] = useState(false)
  const [src, setSrc] = useState('')
  const c = read.counts
  const finals = ['done', 'cancelled', 'estop', 'error'].includes(op.status)
  const partial = op.status === 'cancelled' || op.status === 'estop'
  const canFind = can('createFinding', op.projectId) && !ro
  const canAttach = can('run', op.projectId) && !ro
  const stamp = () => { const d = new Date(Date.now() + 7 * 3600e3); return d.toISOString().slice(0, 16).replace('T', ' ') }
  /* The legacy `A.audit`/`A.addEvidence` entries, mirrored exactly: one
     'legacy' commit each through the one authority (the store helper's exact
     audit/evidence row shapes and the live-count evidence id derivation). */
  const audit = (action: string, obj: string, projectId: string, result = 'Success', reason = '') =>
    mock.audit(projectId, { action, obj, result, reason })
  const addEvidence = (e: { name: string; kind: string; source: string; projectId: string; opId?: string; findingId?: string; sensitive: boolean }) => {
    const res = mock.addEvidence(e.projectId, e)
    if (!res.ok) { toast(res.failure.message, 'bad'); return '' }
    return res.data.id
  }
  const fbr = read.failedBranches
  const outcome = op.steps.length === 0 || c.ok + c.fail === 0 ? { v: 'neutral', t: 'Not determined', d: 'No step has a result yet.' }
    : !finals ? { v: fbr.length ? 'bad' : 'warn', t: 'Provisional', d: fbr.length ? `The operation has not ended and ${fbr.length} branch(es) already failed (${fbr.map((b) => b.id).join(', ')}). It cannot be reported as succeeded.` : 'The operation has not ended. Current results are provisional.' }
    : fbr.length ? { v: 'bad', t: 'Partially Completed — failed branches', d: `${fbr.length} branch(es) failed (${fbr.map((b) => b.id).join(', ')}). The operation is never reported as succeeded while a branch has failed.` }
    : c.unknown ? { v: 'warn', t: 'Partially determined', d: `${c.unknown} step(s) with an Unknown outcome need re-verification.` }
    : c.fail ? { v: 'bad', t: 'Some steps failed', d: `${c.fail} step(s) failed. An analyst must confirm the impact.` }
    : { v: 'ok', t: 'Succeeded', d: 'All executed steps succeeded.' }
  const rows = read.steps.filter(({ step: s }) => !q || (s.id + s.name + s.technique + s.agent).toLowerCase().includes(q.toLowerCase()))
  const prefill = (s?: ResultsStep) => { setFilter('finding-prefill', { op: op.id, projectId: op.projectId, stepId: s?.step.id, technique: s?.step.technique, asset: s?.step.asset, evidence: s?.step.evidence ? [s.step.evidence] : [] }); go('finding-new') }
  const exportAllowed = finals && read.viewSensitive
  return (
    <div className="space-y-5">
      {fbr.length > 0 && <Banner tone="bad" title={`${fbr.length} failed branch${fbr.length === 1 ? '' : 'es'} — outcome is not success`}>{fbr.map((b, i) => <span key={b.id}>{i > 0 && ', '}<IdLink onClick={() => go('ai-branch', { id: b.id })}>{b.id}</IdLink> (step <button className="text-accent underline" onClick={() => setStepSel(b.stepId)}>{b.stepId}</button>)</span>)}. {fbr[0].error || ''} Failed branches have no usable result or evidence.</Banner>}
      {partial && <Banner tone="warn" title={op.status === 'estop' ? 'Emergency stopped — results are partial' : 'Operation stopped — results are partial'}>{c.unknown} step(s) are Unknown and {c.notrun + c.pending} were not run. Do not treat missing results as success.</Banner>}
      <Banner tone="info" icon={ShieldAlert} title="A failed step is not automatically a finding">An analyst must confirm the impact before creating a finding from a failed or unknown step.</Banner>
      <Card>
        <CardHeader title="Results summary" actions={<>
          <Button size="sm" onClick={() => go('analysis', { id: op.id, tab: 'overview' })}>Analyze results</Button>
          <Button size="sm" icon={FilePlus2} disabled={!canFind} title={canFind ? undefined : ro ? reason : 'Only a Manager or Operator can create findings.'} onClick={() => prefill()}>Create Finding</Button>
          <Button size="sm" icon={Paperclip} disabled={!canAttach} title={canAttach ? undefined : ro ? reason : 'Only a Manager or Operator can attach evidence.'} onClick={() => { setSrc(read.steps[0]?.step.id || ''); setAttach(true) }}>Attach evidence</Button>
          <Button size="sm" icon={Download} disabled={!exportAllowed} title={exportAllowed ? undefined : !finals ? 'Results can be exported only after the operation ends.' : 'Your role cannot export results.'}
            onClick={() => { download(`${op.id}-results.json`, JSON.stringify({ op: op.id, outcome: outcome.t, steps: read.steps.map((s) => ({ id: s.step.id, name: s.step.name, status: s.step.status, technique: s.step.technique, dur: s.step.dur, output: s.maskOutput ? 'masked' : s.step.output })) }, null, 2)); audit('Exported operation results', op.id, op.projectId); toast('Results exported per policy (sensitive data masked).') }}>Export redacted</Button>
        </>} />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div><div className="mb-1 text-xs text-muted">Current conclusion</div><Status kind="generic" value={outcome.v} label={outcome.t} /><p className="mt-2 text-xs text-muted">{outcome.d}</p></div>
          <div><div className="mb-1 text-xs text-muted">Playbook objective</div><div className="text-sm">{read.playbookGoal || '—'}</div></div>
          <div><div className="mb-1 text-xs text-muted">Counts</div><div className="text-sm">{c.ok} succeeded · {c.fail} failed · {c.unknown} unknown · {c.pending + c.running + c.notrun + c.review} without result{fbr.length > 0 && <span className="text-bad"> · {fbr.length} failed branch{fbr.length === 1 ? '' : 'es'}</span>}</div></div>
        </div>
        {!canFind && <p className="mt-3 text-xs text-muted">Creating findings is locked: {ro ? reason : 'only a Manager or Operator can do this.'}</p>}
      </Card>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" aria-label="Outcome summary">
        {([['Completed', c.ok, 'text-ok'], ['Failed', c.fail, c.fail ? 'text-bad' : ''], ['Unknown', c.unknown, c.unknown ? 'text-warn' : ''], ['Not executed', c.notrun + c.pending, ''], ['Blocked', 0, ''], ['Needs review', c.review, c.review ? 'text-warn' : '']] as const).map(([l, n, t]) => (
          <div key={l} className="rounded-xl border border-line bg-panel p-3"><div className="text-xs text-muted">{l}</div><div className={cx('text-2xl font-semibold', t)}>{n}</div></div>
        ))}
      </div>
      {c.review > 0 && <Banner tone="warn" title="Results are provisional">{c.review} step(s) still need a reviewer decision. Go to the Live Workspace to decide.</Banner>}
      <Card>
        <CardHeader title="Next steps" sub="Review Evidence, then Attack Analysis, then Findings" />
        <ol className="flex flex-wrap items-center gap-2 text-sm">
          <li><Button size="sm" onClick={() => document.getElementById('op-evidence')?.scrollIntoView({ behavior: 'smooth' })}>1. Review Evidence</Button></li><span aria-hidden className="text-neutral">→</span>
          <li><Button size="sm" onClick={() => go('analysis', { id: op.id, tab: 'overview' })}>2. Attack Analysis</Button></li><span aria-hidden className="text-neutral">→</span>
          <li><Button size="sm" onClick={() => go('analysis', { id: op.id, tab: 'findings' })}>3. Findings</Button></li>
          <li className="ml-auto"><Button size="sm" variant="primary" disabled={!canFind} title={canFind ? undefined : ro ? reason : 'Only a Manager or Operator can create reports.'} onClick={() => go('report-new')}>Create Report Draft</Button></li>
        </ol>
      </Card>
      <Card>
        <CardHeader title="Findings and reports from this operation" sub="Operation, then findings, then report. AI-suggested findings are listed separately and excluded here." />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div><div className="mb-1 text-xs font-medium text-muted">Findings ({read.findings.length})</div>{read.findings.length ? <ul className="space-y-1.5 text-sm">{read.findings.map((f) => <li key={f.id} className="flex flex-wrap items-center gap-2"><IdLink onClick={() => go('finding', { id: f.id })}>{f.id}</IdLink><Status kind="finding" value={f.status} size="sm" /><span className="min-w-0 truncate">{f.title}</span></li>)}</ul> : <p className="text-sm text-muted">No findings yet. Use Create Finding on a step or evidence item.</p>}</div>
          <div><div className="mb-1 text-xs font-medium text-muted">Reports ({read.reports.length})</div>{read.reports.length ? <ul className="space-y-1.5 text-sm">{read.reports.map((r) => <li key={r.id} className="flex flex-wrap items-center gap-2"><IdLink onClick={() => go('report', { id: r.id })}>{r.id}</IdLink><Status kind="report" value={r.status} size="sm" /><span className="min-w-0 truncate">{r.title}</span></li>)}</ul> : <p className="text-sm text-muted">No report includes findings from this operation yet.</p>}</div>
        </div>
      </Card>
      {read.proposed.length > 0 && <Card>
        <CardHeader title="Proposed findings (AI suggested)" sub="Not verified. A person must confirm before they count as findings." />
        <ul className="space-y-2">{read.proposed.map((f) => <li key={f.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-warn/50 bg-warn-soft p-3 text-sm"><IdLink onClick={() => go('finding', { id: f.id })}>{f.id}</IdLink><Status kind="finding" value={f.status} size="sm" /><span className="min-w-0 flex-1">{f.title}</span><Button size="sm" onClick={() => go('finding', { id: f.id })}>Review</Button></li>)}</ul>
      </Card>}
      <Card>
        <CardHeader title="Reviewer sign-off" />
        {signoff ? <p className="text-sm text-ok">Signed off by {signoff.by} at {signoff.at} (UTC+7).</p> : (() => {
          const ok = finals && c.review === 0 && canAttach
          const why = !finals ? 'The operation has not ended.' : c.review > 0 ? 'A step still needs review.' : !canAttach ? (ro ? reason : 'Only a Manager or Operator can sign off.') : ''
          return <div className="flex flex-wrap items-center gap-3"><Button disabled={!ok} title={ok ? undefined : why} onClick={() => { setFilter('signoff.' + op.id, { by: me.name, at: stamp() }); audit('Results signed off', op.id, op.projectId); toast('Results signed off.') }}>Sign off results</Button>{!ok && <span className="text-xs text-muted">{why}</span>}{partial && <span className="text-xs text-warn">Sign-off applies to partial results only.</span>}</div>
        })()}
      </Card>
      <div>
        <div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-[15px] font-semibold">Step results</h3>
          <SearchBox value={q} onChange={setQ} placeholder="Search steps…" className="w-64 max-w-full" /></div>
        <Table rows={rows} rowKey={(s) => s.step.id} onRow={(s) => setStepSel(s.step.id)} empty={<Empty icon={Network} title="No steps yet">The operation has no step data to display.</Empty>} cols={[
          { key: 'id', header: 'Step', render: (s) => <div><IdLink onClick={() => setStepSel(s.step.id)}>{s.step.id}</IdLink><div className="min-w-44 text-sm">{s.step.name}</div></div> },
          { key: 'br', header: 'Branch', hideBelow: 'md', className: 'whitespace-nowrap', render: (s) => { const bs = s.branches; return bs.length ? <span className="inline-flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>{bs.map((b) => <IdLink key={b.id} onClick={() => go('ai-branch', { id: b.id })}>{b.id}</IdLink>)}</span> : <span className="text-neutral">—</span> } },
          { key: 'st', header: 'Outcome', render: (s) => <Status kind="step" value={s.step.status} size="sm" /> },
          { key: 'ag', header: 'Agent', hideBelow: 'md', render: (s) => <Mono>{s.step.agent}</Mono> },
          { key: 'as', header: 'Asset', hideBelow: 'lg', render: (s) => s.step.asset },
          { key: 'te', header: 'ATT&CK', render: (s) => <IdLink onClick={() => go('technique', { id: s.step.technique })}>{s.step.technique}</IdLink> },
          { key: 'du', header: 'Duration', hideBelow: 'md', render: (s) => <Mono className="text-muted">{s.step.dur}</Mono> },
          { key: 'ou', header: 'Output / error', render: (s) => <span className={cx('line-clamp-2 min-w-48 text-xs', s.step.status === 'fail' ? 'text-bad' : 'text-muted')}>{s.maskOutput ? MASK : s.step.output}</span> },
          { key: 'ev', header: 'Evidence', render: (s) => s.step.evidence ? <Mono>{s.step.evidence}</Mono> : <span className="text-neutral">—</span> },
          { key: 'rv', header: 'Reviewer note', hideBelow: 'lg', render: (s) => { const f = read.findings.find((x) => x.technique === s.step.technique); return f ? <IdLink onClick={() => go('finding', { id: f.id })}>{f.id}</IdLink> : <span className="text-neutral">None</span> } },
          { key: 'ac', header: '', render: (s) => (s.step.status === 'fail' || s.step.status === 'ok') ? <Button size="sm" variant="ghost" disabled={!canFind} title={canFind ? 'Create a finding from this step' : 'You cannot create findings.'} onClick={(e) => { e.stopPropagation(); prefill(s) }}>Create Finding</Button> : null },
        ]} />
      </div>
      <div>
        <h3 id="op-evidence" className="mb-3 text-[15px] font-semibold">Operation evidence <span className="text-xs font-normal text-muted">({read.evidence.length})</span></h3>
        <Table rows={read.evidence} rowKey={(e) => e.id} empty={<Empty icon={Paperclip} title="No evidence yet">No evidence file is linked to this operation.</Empty>} cols={[
          { key: 'id', header: 'ID', render: (e) => <Mono>{e.id}</Mono> },
          { key: 'n', header: 'File name', render: (e) => (e.sensitive && !read.viewSensitive ? <span className="text-muted">•••••••• (sensitive — masked)</span> : e.name) },
          { key: 'k', header: 'Type', hideBelow: 'md', render: (e) => e.kind },
          { key: 's', header: 'Source', render: (e) => <Mono className="text-muted">{e.source}</Mono> },
          { key: 'a', header: 'Captured', hideBelow: 'lg', render: (e) => <Mono className="text-muted">{e.at}</Mono> },
          { key: 'sn', header: 'Sensitive', render: (e) => (e.sensitive ? <span className="text-warn">Yes</span> : 'No') },
          { key: 'f', header: 'Finding', render: (e) => (e.findingId ? <IdLink onClick={() => go('finding', { id: e.findingId! })}>{e.findingId}</IdLink> : <span className="text-neutral">Not linked</span>) },
          { key: 'ac', header: '', render: (e) => <div className="flex gap-1"><Button size="sm" variant="ghost" disabled={!canFind} title={canFind ? undefined : 'You cannot create findings.'} onClick={() => { setFilter('finding-prefill', { op: op.id, projectId: op.projectId, evidence: [e.id] }); go('finding-new') }}>Create finding</Button><Button size="sm" variant="ghost" onClick={() => go('analysis', { id: op.id, tab: 'overview' })}>Analyze</Button></div> },
        ]} />
      </div>
      <StepDrawer op={op} step={read.steps.find((x) => x.step.id === stepSel)?.step ?? null} onClose={() => setStepSel(null)} logs={logs[op.id] || []} />
      <Modal open={attach} onClose={() => setAttach(false)} title="Attach evidence" footer={<>
        <Button onClick={() => setAttach(false)}>Cancel</Button>
        <Button variant="primary" disabled={!nm.trim()} title={nm.trim() ? undefined : 'Enter an evidence file name.'} onClick={() => { const id = addEvidence({ name: nm.trim(), kind, source: `${op.id} / ${src}`, projectId: op.projectId, opId: op.id, sensitive: sens }); if (!id) return; toast(`Evidence ${id} attached.`); setAttach(false); setNm(''); setSens(false) }}>Attach</Button>
      </>}>
        <div className="space-y-4">
          <Field label="File name (simulated)" required><Input value={nm} onChange={(e) => setNm(e.target.value)} placeholder="e.g. screenshot-step-08.png" /></Field>
          <Field label="Type"><Select value={kind} onChange={(e) => setKind(e.target.value)}>{['Text', 'JSON', 'Image (blurred)', 'Log'].map((k) => <option key={k}>{k}</option>)}</Select></Field>
          <Field label="Related step"><Select value={src} onChange={(e) => setSrc(e.target.value)}>{op.steps.map((s) => <option key={s.id} value={s.id}>{s.id} — {s.name}</option>)}</Select></Field>
          <Check checked={sens} onChange={setSens} label="Mark as sensitive data (masked for roles without permission)" />
        </div>
      </Modal>
    </div>
  )
}
