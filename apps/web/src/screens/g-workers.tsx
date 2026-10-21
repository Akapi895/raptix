/**
 * AI worker team + dependency graph (ticket 44, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * The workspace Inspector's AI-team view migrated off the raw database read
 * onto the typed worker service (src/features/workers): graph and table run
 * on the same scope-keyed Query read. The graph is a read-only layered DAG —
 * columns are dependency levels, edges are resolved worker dependencies —
 * where keyboard focus reveals the same node detail as pointer selection,
 * and missing dependency records are rendered explicitly, never treated as
 * satisfied. Graph state grants nothing: it is recorded runtime state, not
 * an execution permission.
 */
import { useState } from 'react'
import { Bot } from 'lucide-react'
import { go } from '../router/navigate'
import { BRANCH_LABEL } from '../data'
import type { BranchState, WorkerState } from '../domain/entities'
import { WorkerReadError, useWorkers } from '../features/workers/query'
import type { WorkerRow } from '../features/workers/service'
import { Banner, Button, DescList, Empty, IdLink, Mono, Segmented, Table, cx } from '../ui/index'

const TONE: Record<string, string> = {
  ok: 'text-ok bg-ok-soft border-ok/30', warn: 'text-warn bg-warn-soft border-warn/30', bad: 'text-bad bg-bad-soft border-bad/30',
  cyan: 'text-cyan bg-info-soft border-cyan/30', neutral: 'text-muted bg-subtle border-line',
}
const WK_TONE: Record<WorkerState, string> = { idle: 'neutral', working: 'cyan', waiting: 'warn', done: 'ok', failed: 'bad' }
const WK_BORDER: Record<WorkerState, string> = { idle: 'border-line', working: 'border-cyan/30', waiting: 'border-warn', done: 'border-ok', failed: 'border-bad' }
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)
const pill = (cls: string, children: React.ReactNode) => (
  <span className={cx('inline-flex h-6 items-center whitespace-nowrap rounded-full border px-2.5 text-xs font-medium capitalize', cls)}>{children}</span>
)
/** Dependency state of one referenced worker id (deps ∪ parent). */
const depState = (r: WorkerRow, id: string) => r.deps.find((x) => x.id === id)?.state ?? (r.parent?.id === id ? r.parent.state : undefined)
/** Every referenced worker id (deps ∪ parent), for labels and the missing banner. */
const depIds = (r: WorkerRow) => [...new Set([...r.worker.deps, ...(r.parent ? [r.parent.id] : [])])]

/* ───────── Dependency graph (read-only layered DAG) ───────── */
const NW = 208, NH = 84, RH = 104, CW = 248, PAD = 16

function nodeLabel(r: WorkerRow) {
  const ids = depIds(r)
  const deps = ids.length ? `, depends on ${ids.map((d) => (depState(r, d) === 'missing' ? `${d} (missing)` : d)).join(', ')}` : ', no dependencies'
  return `Worker ${r.worker.id}, ${cap(r.worker.state)}${deps}`
}

function WorkerGraph({ rows, selected, onSelect }: { rows: WorkerRow[]; selected: string | null; onSelect: (id: string) => void }) {
  const levels = [...new Set(rows.map((r) => r.level))].sort((a, b) => a - b)
  const pos = new Map<string, { x: number; y: number }>()
  levels.forEach((lv) => rows.filter((r) => r.level === lv).forEach((r, i) => pos.set(r.worker.id, { x: PAD + (lv - 1) * CW, y: PAD + i * RH })))
  const stacks = Math.max(...levels.map((lv) => rows.filter((r) => r.level === lv).length))
  const W = PAD * 2 + (levels.length - 1) * CW + NW
  const H = PAD * 2 + (stacks - 1) * RH + NH
  const edges: React.ReactNode[] = []
  for (const r of rows) {
    const b = pos.get(r.worker.id)!
    for (const d of depIds(r)) {
      const a = pos.get(d)
      if (a) edges.push(<path key={`${d}-${r.worker.id}`} d={`M${a.x + NW},${a.y + NH / 2} C${a.x + NW + 28},${a.y + NH / 2} ${b.x - 28},${b.y + NH / 2} ${b.x},${b.y + NH / 2}`} fill="none" className="stroke-muted" strokeWidth={1.5} />)
    }
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-subtle">
      <div className="relative" style={{ width: W, height: H }}>
        <svg className="absolute inset-0" width={W} height={H} aria-hidden>{edges}</svg>
        {rows.map((r) => {
          const p = pos.get(r.worker.id)!
          const ids = depIds(r)
          return (
            <button key={r.worker.id} onClick={() => onSelect(r.worker.id)} onFocus={() => onSelect(r.worker.id)}
              aria-label={nodeLabel(r)} aria-current={selected === r.worker.id || undefined}
              className={cx('absolute rounded-lg border bg-panel p-2 text-left text-xs shadow-sm transition hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent', WK_BORDER[r.worker.state])}
              style={{ left: p.x, top: p.y, width: NW, height: NH }}>
              <div className="flex items-center justify-between gap-1"><Mono className="!text-xs">{r.worker.id}</Mono>{pill(TONE[WK_TONE[r.worker.state]], cap(r.worker.state))}</div>
              <div className="truncate text-muted" title={`${r.worker.role} — ${r.worker.task}`}>{r.worker.role} — {r.worker.task}</div>
              <div className="truncate text-[11px] text-muted">
                {ids.length ? <>deps: {ids.map((d, i) => <span key={d}>{i > 0 && ', '}<span className={depState(r, d) === 'missing' ? 'text-warn' : ''}>{depState(r, d) === 'missing' ? `${d} (missing)` : d}</span></span>)}</> : 'no dependencies'}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ───────── Node detail (pointer selection and keyboard focus render the same panel) ───────── */
function WorkerDetail({ row, onSelect, onClose }: { row: WorkerRow; onSelect: (id: string) => void; onClose: () => void }) {
  const w = row.worker
  return (
    <div role="region" aria-label={`Worker ${w.id} detail`} className="rounded-xl border border-line bg-panel p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2"><Mono>{w.id}</Mono>{pill(TONE[WK_TONE[w.state]], cap(w.state))}<span className="truncate text-sm font-medium">{w.role}</span></div>
        <Button size="sm" onClick={onClose} aria-label={`Close worker ${w.id} detail`}>Close</Button>
      </div>
      <DescList cols={2} items={[
        { k: 'Task', v: w.task }, { k: 'Model', v: w.model },
        { k: 'Parent', v: w.parent ? (row.parent!.state === 'missing' ? <span className="text-warn">{w.parent} — no recorded worker</span> : <IdLink onClick={() => onSelect(w.parent!)}>{w.parent}</IdLink>) : '—' },
        { k: 'Inputs', v: w.inputs.join(', ') || '—' }, { k: 'Output artifact', v: w.output },
      ]} />
      <section className="mt-2"><h4 className="mb-1 text-sm font-semibold">Dependencies</h4>
        {depIds(row).length ? (
          <div className="flex flex-wrap gap-2 text-sm">
            {depIds(row).map((d) => depState(row, d) === 'missing'
              ? <span key={d} className="text-warn">{d} — no recorded worker</span>
              : <IdLink key={d} onClick={() => onSelect(d)}>{d}</IdLink>)}
          </div>
        ) : <p className="text-sm text-muted">No dependencies.</p>}
        <p className="mt-1 text-xs text-muted">States are recorded runtime state — they never grant execution permissions.</p>
      </section>
      <section className="mt-2"><h4 className="mb-1 text-sm font-semibold">Branch dependencies</h4>
        {row.branchDeps.length ? (
          <div className="flex flex-wrap gap-2 text-sm">
            {row.branchDeps.map((b) => b.state === 'missing'
              ? <span key={b.id} className="text-warn">{b.id} — no recorded branch</span>
              : <span key={b.id} className="flex items-center gap-1"><IdLink onClick={() => go('ai-branch', { id: b.id })}>{b.id}</IdLink><span className="text-muted">{BRANCH_LABEL[b.state as BranchState] || b.state}</span></span>)}
          </div>
        ) : <p className="text-sm text-muted">No branch inputs recorded.</p>}
      </section>
    </div>
  )
}

/* ───────── Table view (the legacy team table, now on the typed read) ───────── */
function WorkerTable({ rows }: { rows: WorkerRow[] }) {
  return (
    <Table rows={rows} rowKey={(r) => r.worker.id}
      cols={[
        { key: 'id', header: 'Worker', render: (r) => <Mono className="whitespace-nowrap">{r.worker.id}</Mono> },
        { key: 'role', header: 'Role', render: (r) => <span className="whitespace-nowrap font-medium">{r.worker.role}</span> },
        { key: 'task', header: 'Task', render: (r) => r.worker.task },
        { key: 'st', header: 'State', render: (r) => pill(TONE[WK_TONE[r.worker.state]], cap(r.worker.state)) },
        { key: 'in', header: 'Inputs', render: (r) => <span className="text-sm">{r.worker.inputs.join(', ')}</span> },
        { key: 'out', header: 'Output artifact', render: (r) => r.worker.output },
        { key: 'par', header: 'Parent', render: (r) => r.worker.parent ? <Mono>{r.worker.parent}</Mono> : '—' },
        { key: 'dep', header: 'Dependencies', render: (r) => r.worker.deps.length ? <Mono>{r.worker.deps.join(', ')}</Mono> : '—' },
      ]} />
  )
}

/* ───────── Workspace AI-team view (Inspector entry point) ───────── */
export function WorkerTeamView({ projectId }: { projectId: string }) {
  const [view, setView] = useState<'graph' | 'table'>('graph')
  const [sel, setSel] = useState<string | null>(null)
  const q = useWorkers(projectId)
  if (q.isPending) return <p className="py-3 text-sm text-muted">Loading AI workers…</p>
  if (q.isError) {
    const f = (q.error as WorkerReadError).failure
    return <Empty icon={Bot} title="Could not load AI workers" action={<Button size="sm" onClick={() => q.refetch()}>Retry</Button>}>{f.message}</Empty>
  }
  const rows = q.data.workers
  if (!rows.length) {
    return <Empty icon={Bot} title="No AI workers in this project" action={<Button size="sm" onClick={() => go('ai-operator')}>Open AI Operator</Button>}>Workers appear when the AI Operator starts a multi-step task.</Empty>
  }
  const missing = rows.filter((r) => depIds(r).some((d) => depState(r, d) === 'missing') || r.missingBranches.length)
  const selRow = rows.find((r) => r.worker.id === sel)
  return (
    <div className="space-y-3">
      <Banner tone="info" title="AI workers — separate from execution agents">AI workers draft, review and summarize inside the AI Operator. They are not AG-xxx execution agents and never run commands on targets. Demo Data — simulated.</Banner>
      {missing.length > 0 && (
        <Banner tone="warn" title="Missing dependency records">
          These references have no recorded worker or branch: {missing.map((r) => {
            const ids = [...depIds(r).filter((d) => depState(r, d) === 'missing'), ...r.missingBranches]
            return <span key={r.worker.id} className="whitespace-nowrap">{r.worker.id}: {ids.join(', ')}. </span>
          })}
          A missing dependency is shown as missing — it is never treated as satisfied or executed.
        </Banner>
      )}
      <div className="flex items-center justify-between gap-2">
        <Segmented options={[{ id: 'graph' as const, label: 'Graph' }, { id: 'table' as const, label: 'Table' }]} value={view} onChange={setView} />
        <span className="text-xs text-muted">{rows.length} worker{rows.length === 1 ? '' : 's'} · dependency levels {Math.max(...rows.map((r) => r.level))}</span>
      </div>
      {view === 'graph' ? <WorkerGraph rows={rows} selected={sel} onSelect={setSel} /> : <WorkerTable rows={rows} />}
      {selRow && <WorkerDetail row={selRow} onSelect={setSel} onClose={() => setSel(null)} />}
      <p className="text-xs text-muted">Graph state is informational — it never grants execution permissions. Model: {rows[0]!.worker.model} — no real AI backend.</p>
    </div>
  )
}
