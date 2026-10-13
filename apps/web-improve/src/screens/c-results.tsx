import { useRef, useState } from 'react'
import { Download, FilePlus2, Maximize2, Network, Paperclip, Plus, Minus, ShieldAlert } from 'lucide-react'
import { Banner, Button, Card, CardHeader, Check, DemoTag, DescList, Drawer, Empty, Field, IdLink, Input, Modal, Mono, SearchBox, Select, Status, STATUS, Table, useGuard, cx } from '../ui'
import { useStore } from '../store'
import { TECHNIQUES, type Operation, type Step } from '../data'
import { MASK, STEP_BORDER, failedBranches, stepBranches, stepCounts } from './c-common'
import { StepDrawer } from './c-console'

const download = (name: string, text: string, mime = 'application/json') => {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: mime }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 500)
}

/* ───────────── Execution graph ───────────── */
const COLS = 4, NW = 170, NH = 72, GX = 40, GY = 56, PAD = 20
const TONE_TXT: Record<string, string> = { ok: 'text-ok', bad: 'text-bad', accent: 'text-accent', neutral: 'text-neutral', warn: 'text-warn', cyan: 'text-cyan' }

export function GraphTab({ op }: { op: Operation }) {
  const { db, go, A, toast, can, logs } = useStore()
  const [sel, setSel] = useState<string | null>(null)
  const [fa, setFa] = useState('')
  const [fs, setFs] = useState<Record<string, boolean>>({})
  const [zoom, setZoom] = useState(1)
  const box = useRef<HTMLDivElement>(null)
  const executed = op.steps.filter((s) => ['ok', 'fail', 'running', 'unknown'].includes(s.status)).length
  if (op.steps.length < 2 || executed < 2) {
    return <Empty icon={Network} title="Not enough events to draw the graph" action={<Button onClick={() => go('operation', { id: op.id, tab: 'overview' })}>Back to overview</Button>}>The graph is built only from steps that have execution data (at least 2 steps must have run). The system never infers an attack path when data is missing.</Empty>
  }
  const pos = op.steps.map((_, i) => { const r = Math.floor(i / COLS); const c0 = i % COLS; const c = r % 2 ? COLS - 1 - c0 : c0; return { x: PAD + c * (NW + GX), y: PAD + r * (NH + GY) } })
  const W = PAD * 2 + COLS * NW + (COLS - 1) * GX
  const H = PAD * 2 + (Math.floor((op.steps.length - 1) / COLS) + 1) * NH + Math.floor((op.steps.length - 1) / COLS) * GY
  const edges = op.steps.slice(1).map((s, i) => {
    const a = pos[i], b = pos[i + 1]
    let d: string
    if (a.y === b.y) { const right = b.x > a.x; d = `M${a.x + (right ? NW : 0)},${a.y + NH / 2} L${b.x + (right ? 0 : NW)},${b.y + NH / 2}` }
    else d = `M${a.x + NW / 2},${a.y + NH} L${b.x + NW / 2},${b.y}`
    return { d, dashed: s.status === 'notrun' || s.status === 'pending', key: s.id }
  })
  const visible = (s: Step) => (!fa || s.agent === fa) && (Object.values(fs).every((v) => !v) || fs[s.status])
  const step = op.steps.find((s) => s.id === sel) || null
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
          <Button size="sm" icon={Download} className="ml-auto" disabled={!can('viewSensitive')} title={can('viewSensitive') ? undefined : 'Your role cannot export the graph.'}
            onClick={() => { download(`${op.id}-graph.json`, JSON.stringify({ op: op.id, nodes: op.steps.map((s) => ({ id: s.id, status: s.status, technique: s.technique, agent: s.agent })), edges: op.steps.slice(1).map((s, i) => [op.steps[i].id, s.id]) }, null, 2)); A.audit('Exported execution graph', op.id, op.projectId); toast('Graph exported (JSON).') }}>Export graph</Button>
        </div>
        <div ref={box} className="overflow-auto rounded-xl border border-line bg-bg" style={{ maxHeight: 640 }}>
          <div style={{ width: W * zoom, height: H * zoom }}>
            <div className="relative origin-top-left" style={{ width: W, height: H, transform: `scale(${zoom})` }}>
              <svg width={W} height={H} className="absolute inset-0" aria-hidden>
                <defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--c-neutral)" /></marker></defs>
                {edges.map((e) => <path key={e.key} d={e.d} stroke="var(--c-neutral)" strokeWidth={1.5} strokeDasharray={e.dashed ? '5 4' : undefined} fill="none" markerEnd="url(#arr)" />)}
              </svg>
              {op.steps.map((s, i) => {
                const m = STATUS.step[s.status]; const I = m.icon
                return (
                  <button key={s.id} onClick={() => setSel(s.id)} style={{ left: pos[i].x, top: pos[i].y, width: NW, height: NH }}
                    className={cx('absolute rounded-xl border-2 bg-panel p-2 text-left transition hover:bg-hover', STEP_BORDER[s.status], !visible(s) && 'opacity-25', sel === s.id && 'ring-2 ring-accent')}>
                    <div className="flex items-center justify-between"><Mono className="text-muted">{s.id}</Mono><span className={cx('inline-flex items-center gap-1 text-[11px] font-medium', TONE_TXT[m.tone])}><I size={12} className={s.status === 'running' ? 'animate-spin' : ''} aria-hidden />{m.label}</span></div>
                    <div className="mt-1 line-clamp-2 text-xs leading-4">{s.name}</div>{stepBranches(db, op.id, s.id).length > 0 && <span className="absolute bottom-1 right-2 text-[10px] text-muted">{stepBranches(db, op.id, s.id).length} branch{stepBranches(db, op.id, s.id).length === 1 ? '' : 'es'}{stepBranches(db, op.id, s.id).some((b) => b.state === 'failed') ? ' · failed' : ''}</span>}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>
      <StepDrawer op={op} step={step} onClose={() => setSel(null)} logs={logs[op.id] || []} />
    </div>
  )
}

/* ───────────── Results and evidence ───────────── */
export function ResultsTab({ op }: { op: Operation }) {
  const { db, go, can, A, toast, setFilter, persistFilters, me, logs } = useStore()
  const [stepSel, setStepSel] = useState<string | null>(null)
  const { ro, reason } = useGuard(op.projectId)
  const signoff = persistFilters['signoff.' + op.id] as { by: string; at: string } | undefined
  const [attach, setAttach] = useState(false)
  const [q, setQ] = useState('')
  const [nm, setNm] = useState('')
  const [kind, setKind] = useState('Text')
  const [sens, setSens] = useState(false)
  const [src, setSrc] = useState('')
  const c = stepCounts(op.steps)
  const evs = db.evidence.filter((e) => e.opId === op.id)
  const finals = ['done', 'cancelled', 'estop', 'error'].includes(op.status)
  const partial = op.status === 'cancelled' || op.status === 'estop'
  const canFind = can('createFinding', op.projectId) && !ro
  const canAttach = can('run', op.projectId) && !ro
  const stamp = () => { const d = new Date(Date.now() + 7 * 3600e3); return d.toISOString().slice(0, 16).replace('T', ' ') }
  const fbr = failedBranches(db, op.id)
  const outcome = op.steps.length === 0 || c.ok + c.fail === 0 ? { v: 'neutral', t: 'Not determined', d: 'No step has a result yet.' }
    : !finals ? { v: fbr.length ? 'bad' : 'warn', t: 'Provisional', d: fbr.length ? `The operation has not ended and ${fbr.length} branch(es) already failed (${fbr.map((b) => b.id).join(', ')}). It cannot be reported as succeeded.` : 'The operation has not ended. Current results are provisional.' }
    : fbr.length ? { v: 'bad', t: 'Partially Completed — failed branches', d: `${fbr.length} branch(es) failed (${fbr.map((b) => b.id).join(', ')}). The operation is never reported as succeeded while a branch has failed.` }
    : c.unknown ? { v: 'warn', t: 'Partially determined', d: `${c.unknown} step(s) with an Unknown outcome need re-verification.` }
    : c.fail ? { v: 'bad', t: 'Some steps failed', d: `${c.fail} step(s) failed. An analyst must confirm the impact.` }
    : { v: 'ok', t: 'Succeeded', d: 'All executed steps succeeded.' }
  const rows = op.steps.filter((s) => !q || (s.id + s.name + s.technique + s.agent).toLowerCase().includes(q.toLowerCase()))
  const maskedStep = (s: Step) => !can('viewSensitive') && !!s.evidence && !!db.evidence.find((e) => e.id === s.evidence)?.sensitive
  const prefill = (s?: Step) => { setFilter('finding-prefill', { op: op.id, projectId: op.projectId, stepId: s?.id, technique: s?.technique, asset: s?.asset, evidence: s?.evidence ? [s.evidence] : [] }); go('finding-new') }
  const exportAllowed = finals && can('viewSensitive')
  return (
    <div className="space-y-5">
      {fbr.length > 0 && <Banner tone="bad" title={`${fbr.length} failed branch${fbr.length === 1 ? '' : 'es'} — outcome is not success`}>{fbr.map((b, i) => <span key={b.id}>{i > 0 && ', '}<IdLink onClick={() => go('ai-branch', { id: b.id })}>{b.id}</IdLink> (step <button className="text-accent underline" onClick={() => setStepSel(b.stepId)}>{b.stepId}</button>)</span>)}. {fbr[0].error || ''} Failed branches have no usable result or evidence.</Banner>}
      {partial && <Banner tone="warn" title={op.status === 'estop' ? 'Emergency stopped — results are partial' : 'Operation stopped — results are partial'}>{c.unknown} step(s) are Unknown and {c.notrun + c.pending} were not run. Do not treat missing results as success.</Banner>}
      <Banner tone="info" icon={ShieldAlert} title="A failed step is not automatically a finding">An analyst must confirm the impact before creating a finding from a failed or unknown step.</Banner>
      <Card>
        <CardHeader title="Results summary" actions={<>
          <Button size="sm" onClick={() => go('analysis', { id: op.id, tab: 'overview' })}>Analyze results</Button>
          <Button size="sm" icon={FilePlus2} disabled={!canFind} title={canFind ? undefined : ro ? reason : 'Only a Manager or Operator can create findings.'} onClick={() => prefill()}>Create Finding</Button>
          <Button size="sm" icon={Paperclip} disabled={!canAttach} title={canAttach ? undefined : ro ? reason : 'Only a Manager or Operator can attach evidence.'} onClick={() => { setSrc(op.steps[0]?.id || ''); setAttach(true) }}>Attach evidence</Button>
          <Button size="sm" icon={Download} disabled={!exportAllowed} title={exportAllowed ? undefined : !finals ? 'Results can be exported only after the operation ends.' : 'Your role cannot export results.'}
            onClick={() => { download(`${op.id}-results.json`, JSON.stringify({ op: op.id, outcome: outcome.t, steps: op.steps.map((s) => ({ id: s.id, name: s.name, status: s.status, technique: s.technique, dur: s.dur, output: maskedStep(s) ? 'masked' : s.output })) }, null, 2)); A.audit('Exported operation results', op.id, op.projectId); toast('Results exported per policy (sensitive data masked).') }}>Export redacted</Button>
        </>} />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div><div className="mb-1 text-xs text-muted">Current conclusion</div><Status kind="generic" value={outcome.v} label={outcome.t} /><p className="mt-2 text-xs text-muted">{outcome.d}</p></div>
          <div><div className="mb-1 text-xs text-muted">Playbook objective</div><div className="text-sm">{db.playbooks.find((p) => p.id === op.playbookId)?.goal || '—'}</div></div>
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
      {(() => {
        const mine = db.findings.filter((f) => f.op === op.id && f.status !== 'ai_suggested')
        const reps = db.reports.filter((r) => r.projectId === op.projectId && r.findings.some((id) => mine.some((f) => f.id === id)))
        return <Card>
          <CardHeader title="Findings and reports from this operation" sub="Operation, then findings, then report. AI-suggested findings are listed separately and excluded here." />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div><div className="mb-1 text-xs font-medium text-muted">Findings ({mine.length})</div>{mine.length ? <ul className="space-y-1.5 text-sm">{mine.map((f) => <li key={f.id} className="flex flex-wrap items-center gap-2"><IdLink onClick={() => go('finding', { id: f.id })}>{f.id}</IdLink><Status kind="finding" value={f.status} size="sm" /><span className="min-w-0 truncate">{f.title}</span></li>)}</ul> : <p className="text-sm text-muted">No findings yet. Use Create Finding on a step or evidence item.</p>}</div>
            <div><div className="mb-1 text-xs font-medium text-muted">Reports ({reps.length})</div>{reps.length ? <ul className="space-y-1.5 text-sm">{reps.map((r) => <li key={r.id} className="flex flex-wrap items-center gap-2"><IdLink onClick={() => go('report', { id: r.id })}>{r.id}</IdLink><Status kind="report" value={r.status} size="sm" /><span className="min-w-0 truncate">{r.title}</span></li>)}</ul> : <p className="text-sm text-muted">No report includes findings from this operation yet.</p>}</div>
          </div>
        </Card>
      })()}
      {(() => {
        const prop = db.findings.filter((f) => f.op === op.id && f.status === 'ai_suggested')
        return prop.length > 0 && <Card>
          <CardHeader title="Proposed findings (AI suggested)" sub="Not verified. A person must confirm before they count as findings." />
          <ul className="space-y-2">{prop.map((f) => <li key={f.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-warn/50 bg-warn-soft p-3 text-sm"><IdLink onClick={() => go('finding', { id: f.id })}>{f.id}</IdLink><Status kind="finding" value={f.status} size="sm" /><span className="min-w-0 flex-1">{f.title}</span><Button size="sm" onClick={() => go('finding', { id: f.id })}>Review</Button></li>)}</ul>
        </Card>
      })()}
      <Card>
        <CardHeader title="Reviewer sign-off" />
        {signoff ? <p className="text-sm text-ok">Signed off by {signoff.by} at {signoff.at} (UTC+7).</p> : (() => {
          const ok = finals && c.review === 0 && canAttach
          const why = !finals ? 'The operation has not ended.' : c.review > 0 ? 'A step still needs review.' : !canAttach ? (ro ? reason : 'Only a Manager or Operator can sign off.') : ''
          return <div className="flex flex-wrap items-center gap-3"><Button disabled={!ok} title={ok ? undefined : why} onClick={() => { setFilter('signoff.' + op.id, { by: me.name, at: stamp() }); A.audit('Results signed off', op.id, op.projectId); toast('Results signed off.') }}>Sign off results</Button>{!ok && <span className="text-xs text-muted">{why}</span>}{partial && <span className="text-xs text-warn">Sign-off applies to partial results only.</span>}</div>
        })()}
      </Card>
      <div>
        <div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-[15px] font-semibold">Step results</h3>
          <SearchBox value={q} onChange={setQ} placeholder="Search steps…" className="w-64 max-w-full" /></div>
        <Table rows={rows} rowKey={(s) => s.id} onRow={(s) => setStepSel(s.id)} empty={<Empty icon={Network} title="No steps yet">The operation has no step data to display.</Empty>} cols={[
          { key: 'id', header: 'Step', render: (s) => <div><IdLink onClick={() => setStepSel(s.id)}>{s.id}</IdLink><div className="min-w-44 text-sm">{s.name}</div></div> },
          { key: 'br', header: 'Branch', hideBelow: 'md', className: 'whitespace-nowrap', render: (s) => { const bs = stepBranches(db, op.id, s.id); return bs.length ? <span className="inline-flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>{bs.map((b) => <IdLink key={b.id} onClick={() => go('ai-branch', { id: b.id })}>{b.id}</IdLink>)}</span> : <span className="text-neutral">—</span> } },
          { key: 'st', header: 'Outcome', render: (s) => <Status kind="step" value={s.status} size="sm" /> },
          { key: 'ag', header: 'Agent', hideBelow: 'md', render: (s) => <Mono>{s.agent}</Mono> },
          { key: 'as', header: 'Asset', hideBelow: 'lg', render: (s) => s.asset },
          { key: 'te', header: 'ATT&CK', render: (s) => <IdLink onClick={() => go('technique', { id: s.technique })}>{s.technique}</IdLink> },
          { key: 'du', header: 'Duration', hideBelow: 'md', render: (s) => <Mono className="text-muted">{s.dur}</Mono> },
          { key: 'ou', header: 'Output / error', render: (s) => <span className={cx('line-clamp-2 min-w-48 text-xs', s.status === 'fail' ? 'text-bad' : 'text-muted')}>{maskedStep(s) ? MASK : s.output}</span> },
          { key: 'ev', header: 'Evidence', render: (s) => s.evidence ? <Mono>{s.evidence}</Mono> : <span className="text-neutral">—</span> },
          { key: 'rv', header: 'Reviewer note', hideBelow: 'lg', render: (s) => { const f = db.findings.find((x) => x.op === op.id && x.technique === s.technique); return f ? <IdLink onClick={() => go('finding', { id: f.id })}>{f.id}</IdLink> : <span className="text-neutral">None</span> } },
          { key: 'ac', header: '', render: (s) => (s.status === 'fail' || s.status === 'ok') ? <Button size="sm" variant="ghost" disabled={!canFind} title={canFind ? 'Create a finding from this step' : 'You cannot create findings.'} onClick={(e) => { e.stopPropagation(); prefill(s) }}>Create Finding</Button> : null },
        ]} />
      </div>
      <div>
        <h3 id="op-evidence" className="mb-3 text-[15px] font-semibold">Operation evidence <span className="text-xs font-normal text-muted">({evs.length})</span></h3>
        <Table rows={evs} rowKey={(e) => e.id} empty={<Empty icon={Paperclip} title="No evidence yet">No evidence file is linked to this operation.</Empty>} cols={[
          { key: 'id', header: 'ID', render: (e) => <Mono>{e.id}</Mono> },
          { key: 'n', header: 'File name', render: (e) => (e.sensitive && !can('viewSensitive') ? <span className="text-muted">•••••••• (sensitive — masked)</span> : e.name) },
          { key: 'k', header: 'Type', hideBelow: 'md', render: (e) => e.kind },
          { key: 's', header: 'Source', render: (e) => <Mono className="text-muted">{e.source}</Mono> },
          { key: 'a', header: 'Captured', hideBelow: 'lg', render: (e) => <Mono className="text-muted">{e.at}</Mono> },
          { key: 'sn', header: 'Sensitive', render: (e) => (e.sensitive ? <span className="text-warn">Yes</span> : 'No') },
          { key: 'f', header: 'Finding', render: (e) => (e.findingId ? <IdLink onClick={() => go('finding', { id: e.findingId! })}>{e.findingId}</IdLink> : <span className="text-neutral">Not linked</span>) },
          { key: 'ac', header: '', render: (e) => <div className="flex gap-1"><Button size="sm" variant="ghost" disabled={!canFind} title={canFind ? undefined : 'You cannot create findings.'} onClick={() => { setFilter('finding-prefill', { op: op.id, projectId: op.projectId, evidence: [e.id] }); go('finding-new') }}>Create finding</Button><Button size="sm" variant="ghost" onClick={() => go('analysis', { id: op.id, tab: 'overview' })}>Analyze</Button></div> },
        ]} />
      </div>
      <StepDrawer op={op} step={op.steps.find((x) => x.id === stepSel) || null} onClose={() => setStepSel(null)} logs={logs[op.id] || []} />
      <Modal open={attach} onClose={() => setAttach(false)} title="Attach evidence" footer={<>
        <Button onClick={() => setAttach(false)}>Cancel</Button>
        <Button variant="primary" disabled={!nm.trim()} title={nm.trim() ? undefined : 'Enter an evidence file name.'} onClick={() => { const id = A.addEvidence({ name: nm.trim(), kind, source: `${op.id} / ${src}`, projectId: op.projectId, opId: op.id, sensitive: sens }); toast(`Evidence ${id} attached.`); setAttach(false); setNm(''); setSens(false) }}>Attach</Button>
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
