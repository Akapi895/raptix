import { useRef, useState, type ComponentType, type ReactNode } from 'react'
import { AlertTriangle, Bug, Clock, Sparkles, CheckCircle2, CircleDashed, Crosshair, Download, ExternalLink, Eye, Grid3x3, Lock, Maximize2, MinusCircle, Network, Plug, Radar, RotateCcw, ShieldAlert, X, XCircle, ZoomIn, ZoomOut, type LucideProps } from 'lucide-react'
import { ROLE_LABEL } from '../auth/policy'
import { eligibility } from '../features/operations/preflight'
import { TACTICS, TECHNIQUES, type DetectState, type Operation, type Step, type StepStatus, type Technique } from '../data'
import { Banner, Button, SearchBox, Card, CardHeader, Drawer, Empty, Kpi, Mono, PageHeader, Segmented, Select, Status, Table, Tabs, cx } from '../ui'
import { AnalysisReadError, useAnalysisCoverage, useAttackPath } from '../features/analysis/query'
import type { AnalysisCoverageRead, CoverageCell, CoverageCellState, CoveragePair } from '../features/analysis/service'
import { go, useRoute } from '../router/navigate'
import { useAccessible, useActiveProject, useCan, useDb, useMe, useReadOnly } from '../state/console'
import { useProjectStore, useToastStore } from '../state/stores'
import { useSessionStore } from '../state/session'

/* ───────────── Shared types (feature read model) ───────────── */
type Ana = AnalysisCoverageRead
type Cell = CoverageCell
type CellState = CoverageCellState
type Pair = CoveragePair
export interface Prefill { projectId: string; op?: string; technique?: string; asset?: string; title?: string; severity?: string; desc?: string; stepId?: string }

const CELL_META: Record<CellState, { label: string; long: string; cls: string; icon: typeof CheckCircle2 }> = {
  detected: { label: 'Executed & Detected', long: 'Executed & Detected', cls: 'border-ok/50 bg-ok/12 text-ok', icon: CheckCircle2 },
  undetected: { label: 'Executed & Not Detected', long: 'Executed & Not Detected (verified)', cls: 'border-bad/50 bg-bad/12 text-bad', icon: XCircle },
  nodata: { label: 'Executed & No Data', long: 'Executed & No Data (unverified — not the same as Not Detected)', cls: 'border-warn/50 bg-warn/10 text-warn', icon: MinusCircle },
  planned: { label: 'Planned Only', long: 'Planned Only (not executed yet)', cls: 'border-dashed border-cyan/60 bg-cyan/5 text-cyan', icon: Clock },
  untested: { label: 'Not Tested', long: 'Not Tested', cls: 'border-dashed border-line text-neutral', icon: CircleDashed },
}

const RECS: Record<string, string> = {
  T1078: 'Add alert rules for unusual privileged-account sign-ins and review privileged groups on a regular schedule.',
  T1110: 'Set an alert threshold for consecutive failed authentications on the authentication log source.',
}
const recFor = (t: Technique, st: DetectState) =>
  st === 'undetected' ? RECS[t.id] || `Add or tune detection rules for ${t.id} (${t.name}) and retest after the update.` : `Unverified: reconcile ${t.id} logs with the Blue Team before concluding whether a signal exists.`

function useCreateFinding() {
  const can = useCan()
  const readOnly = useReadOnly()
  const me = useMe()
  const pid = useProjectStore((s) => s.pid)
  const setPid = useProjectStore((s) => s.setPid)
  const setFilter = useSessionStore((s) => s.setFilter)
  const reason = (projectId: string) => {
    if (readOnly(projectId)) return me.role === 'viewer' ? 'The Client / Viewer role is read-only.' : 'Project is closed — read-only.'
    if (!can('createFinding', projectId)) return `The ${ROLE_LABEL[me.role]} role cannot create findings.`
    return ''
  }
  const start = (p: Prefill) => {
    setFilter('finding-prefill', p)
    if (pid !== p.projectId) setPid(p.projectId)
    go('finding-new')
  }
  return { reason, start }
}

function CreateFindingBtn({ prefill, label = 'Create Finding', size = 'md', variant = 'secondary' }: { prefill: Prefill; label?: string; size?: 'sm' | 'md'; variant?: 'primary' | 'secondary' }) {
  const { reason, start } = useCreateFinding()
  const r = reason(prefill.projectId)
  return <Button size={size} variant={variant} icon={Bug} disabled={!!r} title={r || 'Open the finding form prefilled with the project, operation, and technique'} onClick={() => start(prefill)}>{label}</Button>
}

function EvidenceList({ ids }: { ids: string[] }) {
  const db = useDb()
  const can = useCan()
  if (!ids.length) return <div className="text-xs text-muted">No evidence attached.</div>
  return (
    <ul className="space-y-2">
      {ids.map((id) => {
        const ev = db.evidence.find((e) => e.id === id)
        if (!ev) return null
        const hide = ev.sensitive && !can('viewSensitive')
        return (
          <li key={id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-line px-3 py-2 hover:bg-hover" onClick={() => go('evidence', { id })} title="Open in Evidence Inspector">
            {hide ? <Lock size={15} className="text-warn" aria-hidden /> : <Network size={15} className="text-muted" aria-hidden />}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">{hide ? 'Sensitive file — redacted' : ev.name}</div>
              <div className="whitespace-nowrap text-xs text-muted"><Mono className="text-accent">{ev.id}</Mono> · {ev.kind}{ev.sensitive && !hide ? ' · sensitive label' : ''}</div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function Chip({ children, onRemove }: { children: ReactNode; onRemove?: () => void }) {
  return (
    <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 pl-3 pr-1.5 text-xs text-fg">
      {children}
      {onRemove && <button onClick={onRemove} aria-label="Remove filter" className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-hover"><X size={12} /></button>}
    </span>
  )
}

function DetectBadge({ state }: { state: DetectState }) {
  return <Status kind="detect" value={state} size="sm" label={state === 'nodata' ? 'No Data' : undefined} />
}

/* ───────────── Main page ───────────── */
function Analysis() {
  const route = useRoute()
  const pid = useProjectStore((s) => s.pid)
  const project = useActiveProject()
  const persistFilters = useSessionStore((s) => s.persistFilters)
  const setFilter = useSessionStore((s) => s.setFilter)
  const can = useCan()
  const accessible = useAccessible()
  const tab = route.tab || 'overview'
  const agent: string = (persistFilters['ana-agent'] as string | undefined) ?? 'all'
  const os: string = (persistFilters['ana-os'] as string | undefined) ?? 'all'
  const cov = useAnalysisCoverage({ opId: route.id || undefined, agent, os })
  const setOp = (id?: string) => go('analysis', { id, tab })
  const reset = () => { setFilter('ana-agent', 'all'); setFilter('ana-os', 'all'); if (route.id) setOp(undefined) }
  const filtered = !!route.id || agent !== 'all' || os !== 'all'
  const head = (
    <PageHeader
      title="Attack Analysis"
      sub="Attack paths, MITRE ATT&CK matrix, and detection coverage — built only from recorded operation results and real detection data."
      meta={<span className="inline-flex h-6 items-center rounded-full border border-line px-2.5 text-xs text-muted">{pid === 'all' ? `All accessible projects (${accessible.length})` : `${project?.id} — ${project?.name}`}</span>}
    />
  )
  if (cov.isError) {
    const failure = cov.error instanceof AnalysisReadError ? cov.error.failure : undefined
    return (
      <div>
        {head}
        <Banner tone="bad" title="Attack analysis could not be loaded" action={<Button size="sm" onClick={() => cov.refetch()}>Retry</Button>}>
          {failure?.message || 'The coverage data could not be loaded. Try again.'}
        </Banner>
      </div>
    )
  }
  if (!cov.data) {
    return (
      <div>
        {head}
        <div aria-busy="true" className="rounded-xl border border-line bg-panel p-10 text-center text-sm text-muted">Loading attack coverage…</div>
      </div>
    )
  }
  const ana = cov.data
  const opMissing = !!route.id && !ana.allOps.some((o) => o.id === route.id)
  const hasAnyData = ana.allOps.some((o) => o.steps.some((st) => st.status === 'ok' || st.status === 'fail'))

  return (
    <div>
      {head}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select aria-label="Filter operation" value={route.id && !opMissing ? route.id : ''} onChange={(e) => setOp(e.target.value || undefined)} className="!w-auto min-w-52">
          <option value="">All operations ({ana.allOps.length})</option>
          {ana.allOps.map((o) => <option key={o.id} value={o.id}>{o.id} — {o.name}</option>)}
        </Select>
        <Select aria-label="Filter agent" value={agent} onChange={(e) => setFilter('ana-agent', e.target.value)} className="!w-auto min-w-40">
          <option value="all">All agents</option>
          {ana.agentOptions.map((a) => <option key={a.id} value={a.id}>{a.id} · {a.host}</option>)}
        </Select>
        <Select aria-label="Filter operating system" value={os} onChange={(e) => setFilter('ana-os', e.target.value)} className="!w-auto min-w-36">
          <option value="all">All operating systems</option><option>Windows</option><option>Linux</option>
        </Select>
        {route.id && <Chip onRemove={() => setOp(undefined)}>Operation: <Mono>{route.id}</Mono></Chip>}
        {agent !== 'all' && <Chip onRemove={() => setFilter('ana-agent', 'all')}>Agent: {agent}</Chip>}
        {os !== 'all' && <Chip onRemove={() => setFilter('ana-os', 'all')}>OS: {os}</Chip>}
        {filtered && <Button size="sm" variant="ghost" icon={RotateCcw} onClick={reset}>Reset filters</Button>}
      </div>
      {opMissing && (
        <Banner tone="warn" title={`Operation ${route.id} is outside the current data scope`} action={<Button size="sm" onClick={() => setOp(undefined)}>Clear operation filter</Button>}>
          This operation belongs to another project or you do not have access. Data from other projects is not shown.
        </Banner>
      )}
      {!hasAnyData && pid !== 'all' ? <NoProjectData ops={ana.allOps} /> : <>
      <Tabs
        value={tab} onChange={(t) => go('analysis', { id: route.id, tab: t })}
        tabs={[{ id: 'overview', label: 'Overview', icon: Radar }, { id: 'chain', label: 'Attack Paths', icon: Network }, { id: 'matrix', label: 'MITRE ATT&CK', icon: Grid3x3 }, { id: 'detection', label: 'Detection Coverage', icon: ShieldAlert }]}
      />
      {tab === 'chain' ? <Chain opId={opMissing ? undefined : route.id} /> : tab === 'matrix' ? <Matrix ana={ana} /> : tab === 'detection' ? <Detection ana={ana} canAdmin={can('admin')} /> : <Overview ana={ana} />}
      </>}
    </div>
  )
}

/** Empty state for projects with no executed steps (e.g. RT-2026-017): reason + next action. */
function NoProjectData({ ops }: { ops: Operation[] }) {
  const db = useDb()
  const pid = useProjectStore((s) => s.pid)
  const el = eligibility(db, pid)
  return (
    <div className="space-y-4">
      <Empty icon={Radar} title={`No execution data in ${pid} yet`}
        action={<div className="flex flex-wrap justify-center gap-2"><Button variant="primary" onClick={() => go('operations')}>Open Operations</Button><Button onClick={() => go('project', { id: pid })}>Complete project readiness</Button></div>}>
        Attack paths, the ATT&CK matrix and detection coverage are built from executed steps and SIEM-Lab telemetry. {ops.length ? `${ops.map((o) => o.id).join(', ')} ${ops.length > 1 ? 'have' : 'has'} not executed any step` : 'This project has no operation yet'}. Next: resolve the items below, run preflight, then start the operation.
      </Empty>
      {el.reasons.length > 0 && (
        <Card>
          <CardHeader title="Why execution cannot start yet" sub={el.label} />
          <ul className="space-y-2">
            {el.reasons.map((r, i) => (
              <li key={i} className="flex flex-wrap items-center gap-3 rounded-lg border border-line px-3 py-2 text-sm">
                <AlertTriangle size={14} className="text-warn" aria-hidden /><span className="flex-1">{r.text}</span>
                {r.to && <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => go(r.to!.page, { id: r.to!.id, tab: r.to!.tab })}>Open</Button>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

function NoOps() {
  const pid = useProjectStore((s) => s.pid)
  return (
    <Empty icon={Radar} title="No execution evidence available yet" action={<Button onClick={() => go('operations')}>View Operations</Button>}>
      Analysis needs at least one operation with executed-step results and/or a connected detection data source. Charts are not drawn without real data{pid === 'all' ? '.' : ' in this project.'}
    </Empty>
  )
}

/* ───────────── ANL-01 ───────────── */
function MiniChain({ op }: { op: Operation }) {
  const n = op.steps.length
  if (!n) return <span className="text-xs text-neutral">No steps</span>
  const w = Math.min(n, 12) * 16
  const col = (s: Step) => ({ ok: 'var(--c-ok)', fail: 'var(--c-bad)', running: 'var(--c-accent)', unknown: 'var(--c-warn)', pending: 'var(--c-neutral)', notrun: 'var(--c-line)', review: 'var(--c-warn)' })[s.status]
  return (
    <svg width={w + 8} height={20} role="img" aria-label={`${op.steps.filter((s) => s.status === 'ok').length}/${n} steps succeeded`}>
      <line x1={8} x2={w - 8} y1={10} y2={10} stroke="var(--c-line)" strokeWidth={1.5} />
      {op.steps.slice(0, 12).map((s, i) => <circle key={s.id} cx={8 + i * 16} cy={10} r={5} fill={s.status === 'notrun' || s.status === 'pending' ? 'var(--c-panel)' : col(s)} stroke={col(s)} strokeWidth={1.5}><title>{s.id} — {s.name}</title></circle>)}
    </svg>
  )
}

function TacticBars({ ana }: { ana: Ana }) {
  const rows = TACTICS.map((t) => {
    const all = TECHNIQUES.filter((x) => x.tactic === t)
    const done = all.filter((x) => ['detected', 'undetected', 'nodata'].includes(ana.cells.find((c) => c.tech.id === x.id)!.state)).length
    return { t, total: all.length, done }
  })
  return (
    <ul className="space-y-2.5" aria-label="Tested techniques by tactic">
      {rows.map((r) => (
        <li key={r.t} className="grid grid-cols-[minmax(0,150px)_1fr_44px] items-center gap-3 text-xs">
          <span className="truncate text-muted" title={r.t}>{r.t}</span>
          <svg viewBox="0 0 100 8" preserveAspectRatio="none" className="h-2 w-full" aria-hidden>
            <rect width="100" height="8" rx="4" fill="var(--c-hover)" />
            {r.done > 0 && <rect width={(r.done / r.total) * 100} height="8" rx="4" fill="var(--c-accent)" />}
          </svg>
          <span className="text-right tabular-nums">{r.done}/{r.total}</span>
        </li>
      ))}
    </ul>
  )
}

function CoverageBar({ ana }: { ana: Ana }) {
  const parts = [
    { k: 'Executed & Detected', v: ana.nDetected, c: 'var(--c-ok)' }, { k: 'Executed & Not Detected', v: ana.nUndetected, c: 'var(--c-bad)' },
    { k: 'Executed & No Data', v: ana.nNoData, c: 'var(--c-warn)' }, { k: 'Planned Only', v: ana.nPlanned, c: 'var(--c-cyan)' },
  ]
  const tot = parts.reduce((a, p) => a + p.v, 0) || 1
  const withData = ana.nDetected + ana.nUndetected
  let x = 0
  return (
    <Card>
      <CardHeader title="Coverage summary" sub={`Source: ${ana.siemName} telemetry for executed steps. ${withData ? `Detection rate ${Math.round((ana.nDetected / withData) * 100)}% (${ana.nDetected}/${withData} techniques with data); No Data excluded.` : 'No technique has detection data yet.'}`} />
      <svg viewBox="0 0 100 9" preserveAspectRatio="none" className="h-3 w-full" role="img" aria-label={parts.map((p) => `${p.v} ${p.k}`).join(', ')}>
        <rect width="100" height="9" rx="4" fill="var(--c-hover)" />
        {parts.map((p) => { const w = (p.v / tot) * 100; const r = <rect key={p.k} x={x} width={w} height="9" fill={p.c} opacity={p.k === 'Planned Only' ? 0.5 : 1} />; x += w; return r })}
      </svg>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
        {parts.map((p) => <li key={p.k} className="flex items-center gap-1.5 whitespace-nowrap"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: p.c }} />{p.k} <b className="tabular-nums text-fg">{p.v}</b></li>)}
      </ul>
    </Card>
  )
}

function OpTimeline({ ana }: { ana: Ana }) {
  const op = ana.ops.find((o) => o.steps.length && ana.entries.some((e) => e.op.id === o.id && e.tested))
  if (!op) return null
  const rows = ana.entries.filter((e) => e.op.id === op.id && e.step.status !== 'notrun')
  return (
    <Card pad={false}>
      <div className="p-5 pb-3"><CardHeader title={`Execution timeline — ${op.id}`} sub="Observed step events in order. Pending and in-review steps are labeled and not counted as executed." actions={<Button size="sm" variant="ghost" icon={Network} onClick={() => go('analysis', { id: op.id, tab: 'chain' })}>Attack Path graph</Button>} /></div>
      <Table
        dense rows={rows} rowKey={(e) => e.step.id} onRow={(e) => go('operation', { id: e.op.id, tab: 'console' })}
        cols={[
          { key: 's', header: 'Step', render: (e) => <span className="whitespace-nowrap"><Mono className="text-accent">{e.step.id}</Mono></span> },
          { key: 'n', header: 'Name', render: (e) => <span className="block max-w-[260px] truncate" title={e.step.name}>{e.step.name}</span> },
          { key: 't', header: 'Technique', render: (e) => <Mono>{e.step.technique}</Mono> },
          { key: 'a', header: 'Agent', hideBelow: 'md', render: (e) => <Mono>{e.step.agent}</Mono> },
          { key: 'ts', header: 'Time', hideBelow: 'md', render: (e) => <span className="whitespace-nowrap text-xs text-muted">{e.step.ts === '—' ? '—' : `${e.step.ts} (UTC+7)`}</span> },
          { key: 'st', header: 'Status', render: (e) => <Status kind="step" value={e.step.status} size="sm" /> },
          { key: 'ev', header: 'Evidence', hideBelow: 'lg', render: (e) => e.step.evidence?.startsWith('EV-') ? <button className="whitespace-nowrap font-mono text-[13px] text-accent hover:underline" onClick={(ev) => { ev.stopPropagation(); go('evidence', { id: e.step.evidence }) }}>{e.step.evidence}</button> : '—' },
        ]}
      />
    </Card>
  )
}

function Overview({ ana }: { ana: Ana }) {
  const route = useRoute()
  const hasData = ana.entries.some((e) => e.tested)
  if (!ana.allOps.length) return <NoOps />
  const idArg = route.id
  const flagged = ana.entries.filter((e) => e.step.status === 'fail' || e.step.status === 'unknown' || (e.tested && !/^(Sanitized output|Not run|Waiting|No output)/.test(e.step.output)))
  const review = ana.pairs.filter((p) => p.state !== 'detected')
  return (
    <div className="space-y-6">
      {!ana.siemOn && (
        <Banner tone="warn" title="No detection data" action={<Button size="sm" variant="secondary" onClick={() => go('settings', { tab: 'integrations' })}>View integrations</Button>}>
          The {ana.siemName} integration is not connected — every executed technique is treated as "Unverified", not as "not detected".
        </Banner>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Tested Techniques" value={ana.nRun} sub={`of ${TECHNIQUES.length} in catalog · ${ana.nPlanned} planned only`} icon={Crosshair} onClick={() => go('analysis', { id: idArg, tab: 'matrix' })} />
        <Kpi label="Detected" value={ana.nDetected} tone={ana.nDetected ? 'ok' : undefined} icon={CheckCircle2} sub="executed, signal observed" />
        <Kpi label="Not Detected" value={ana.nUndetected} tone={ana.nUndetected ? 'bad' : undefined} icon={XCircle} sub="verified absence only" />
        <Kpi label="No Data" value={ana.nNoData} tone={ana.nNoData ? 'warn' : undefined} icon={MinusCircle} sub="not counted as Not Detected" />
        <Kpi label="Execution Evidence" value={ana.nEvidence} icon={Network} sub="evidence items linked to steps" onClick={() => go('evidence')} />
        <Kpi label="Detection Gaps" value={ana.nUndetected} tone={ana.nUndetected ? 'bad' : undefined} icon={ShieldAlert} sub="to review via findings" onClick={() => go('analysis', { id: idArg, tab: 'detection' })} />
      </div>
      {!hasData ? (
        <Empty icon={Radar} title="No execution evidence available yet" action={<Button onClick={() => go('operations')}>View Operations</Button>}>
          Charts appear once an operation has executed at least one step. Remove some filters or wait for results.
        </Empty>
      ) : (
        <>
          <CoverageBar ana={ana} />
          <Card>
            <CardHeader title="Executive summary" sub="Plain-language readout for non-technical stakeholders. Derived from the counts above; no AI-generated claims." />
            <p className="text-sm leading-relaxed text-fg">
              {ana.nRun} technique{ana.nRun === 1 ? '' : 's'} {ana.nRun === 1 ? 'was' : 'were'} executed across {ana.ops.length} operation{ana.ops.length === 1 ? '' : 's'}.{' '}
              {ana.siemOn ? `${ana.nDetected} produced a detection signal and ${ana.nUndetected} were verified as not detected${ana.nNoData ? `; ${ana.nNoData} have no data yet (not counted as not detected)` : ''}.` : 'Detection data is unavailable, so none of them can be called detected or undetected yet.'}{' '}
              {ana.nUndetected > 0 ? 'Recommended next step: record the verified gaps as findings and retest after detection rules are tuned.' : 'Recommended next step: verify the remaining techniques with the Blue Team.'}
            </p>
          </Card>
          <OpTimeline ana={ana} />
          <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
            <Card>
              <CardHeader title="Attack chain by operation" sub="Each dot is a step: solid = executed, hollow = not run / pending." />
              <div className="space-y-2">
                {ana.ops.filter((o) => o.steps.length).map((o) => (
                  <div key={o.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line px-3 py-2.5">
                    <Mono className="text-accent">{o.id}</Mono>
                    <span className="min-w-0 flex-1 truncate text-sm">{o.name}</span>
                    <MiniChain op={o} />
                    <Button size="sm" variant="ghost" icon={Network} onClick={() => go('analysis', { id: o.id, tab: 'chain' })}>View graph</Button>
                  </div>
                ))}
              </div>
            </Card>
            <Card>
              <CardHeader title="Coverage by tactic" sub="Tested techniques / techniques in the catalog. Source: operation step results." />
              <TacticBars ana={ana} />
            </Card>
          </div>
          <Card pad={false}>
            <div className="p-5 pb-3"><CardHeader title="Summary by operation" sub="Quick links to the graph, matrix, and detection coverage" /></div>
            <Table
              rows={ana.ops} rowKey={(o) => o.id}
              cols={[
                { key: 'op', header: 'Operation', render: (o) => <div><Mono className="text-accent">{o.id}</Mono><div className="text-xs text-muted">{o.name}</div></div> },
                { key: 'pr', header: 'Project', hideBelow: 'md', render: (o) => <Mono>{o.projectId}</Mono> },
                { key: 'st', header: 'Status', render: (o) => <Status kind="op" value={o.status} size="sm" /> },
                { key: 'steps', header: 'Executed steps', render: (o) => `${o.steps.filter((s) => s.status === 'ok' || s.status === 'fail').length}/${o.steps.length}` },
                { key: 'tech', header: 'Technique', hideBelow: 'md', render: (o) => new Set(o.steps.filter((s) => s.status === 'ok' || s.status === 'fail').map((s) => s.technique)).size },
                { key: 'act', header: 'Actions', render: (o) => (
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => go('analysis', { id: o.id, tab: 'chain' })}>Graph</Button>
                    <Button size="sm" variant="ghost" onClick={() => go('analysis', { id: o.id, tab: 'matrix' })}>MITRE</Button>
                    <Button size="sm" variant="ghost" onClick={() => go('analysis', { id: o.id, tab: 'detection' })}>Detection</Button>
                    <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => go('operation', { id: o.id })}>Open</Button>
                  </div>
                ) },
              ]}
            />
          </Card>
          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader title="Items to review" sub="Executed techniques with no detection signal or not yet verified" actions={<Button size="sm" variant="ghost" onClick={() => go('analysis', { id: idArg, tab: 'detection' })}>Detection Coverage</Button>} />
              {review.length === 0 ? <div className="text-sm text-muted">Nothing needs review.</div> : (
                <ul className="space-y-2">
                  {review.map((p) => (
                    <li key={p.projectId + p.tech.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line px-3 py-2.5">
                      <Mono className="text-accent">{p.tech.id}</Mono>
                      <span className="min-w-0 flex-1 truncate text-sm">{p.tech.name}</span>
                      <Mono className="text-muted">{p.projectId}</Mono>
                      <DetectBadge state={p.state} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <CardHeader title="Flagged events" sub="Failed steps, unknown outcomes, or steps with output notes" />
              {flagged.length === 0 ? <div className="text-sm text-muted">No events flagged.</div> : (
                <ul className="space-y-2">
                  {flagged.map((e) => (
                    <li key={e.op.id + e.step.id} className="rounded-lg border border-line px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <Mono className="text-accent">{e.op.id}/{e.step.id}</Mono>
                        <span className="min-w-0 flex-1 truncate text-sm">{e.step.name}</span>
                        <Status kind="step" value={e.step.status} size="sm" />
                      </div>
                      <div className="mt-1 text-xs text-muted">{e.step.output}</div>
                      <div className="mt-2"><CreateFindingBtn size="sm" prefill={{ projectId: e.op.projectId, op: e.op.id, technique: e.step.technique, asset: e.step.asset, stepId: e.step.id, title: e.step.name }} /></div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
          <div className="text-xs text-muted">Source: step results from {ana.allOps.length} operations in the current scope. Last updated: Oct 13, 2026 (UTC+7).</div>
        </>
      )}
    </div>
  )
}

/* ───────────── Attack Paths graph (ticket 55 — typed path read) ───────────── */
type Sel = { kind: 'step' | 'asset' | 'tech'; id: string } | null
const STEP_COL: Record<StepStatus, string> = { ok: 'var(--c-ok)', fail: 'var(--c-bad)', running: 'var(--c-accent)', unknown: 'var(--c-warn)', pending: 'var(--c-neutral)', notrun: 'var(--c-neutral)', review: 'var(--c-warn)' }
const STEP_GLYPH: Record<StepStatus, ComponentType<LucideProps>> = { ok: CheckCircle2, fail: XCircle, running: CircleDashed, unknown: AlertTriangle, pending: CircleDashed, notrun: MinusCircle, review: Eye }
const STEP_TXT: Record<StepStatus, string> = { ok: 'Succeeded', fail: 'Failed', running: 'Running', unknown: 'Unknown', pending: 'Pending', notrun: 'Not run', review: 'In review' }

function Chain({ opId }: { opId?: string }) {
  const db = useDb()
  const can = useCan()
  const me = useMe()
  const toast = useToastStore((s) => s.toast)
  const persistFilters = useSessionStore((s) => s.persistFilters)
  const agent: string = (persistFilters['ana-agent'] as string | undefined) ?? 'all'
  const os: string = (persistFilters['ana-os'] as string | undefined) ?? 'all'
  const [pick, setPick] = useState('')
  const [sel, setSel] = useState<Sel>(null)
  const [zoom, setZoom] = useState(1)
  const [hl, setHl] = useState<string | null>(null)
  const [hide, setHide] = useState<Record<string, boolean>>({})
  const wrap = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const graph = useAttackPath({ opId: opId || pick || undefined, agent, os })
  if (graph.isError) {
    const failure = graph.error instanceof AnalysisReadError ? graph.error.failure : undefined
    return <Banner tone="bad" title="The attack path could not be loaded" action={<Button size="sm" onClick={() => graph.refetch()}>Retry</Button>}>{failure?.message || 'The attack-path data could not be loaded. Try again.'}</Banner>
  }
  if (!graph.data) return <div aria-busy="true" className="rounded-xl border border-line bg-panel p-10 text-center text-sm text-muted">Loading attack path…</div>
  const path = graph.data.selected
  if (!path) return <NoOps />

  const steps = path.steps.map((ps) => ps.step)
  /* A step reached a recorded outcome (ok/fail) — the read model decides; the
   * view never re-derives observed state, so the graph cannot claim success
   * for planned/running/review hops. */
  const executed = (id: string) => path.steps.find((ps) => ps.step.id === id)?.executed ?? false
  const X0 = 70, GAP = 124
  const sx = (i: number) => X0 + i * GAP
  const W = X0 * 2 + Math.max(0, steps.length - 1) * GAP, H = 350
  const Y = { a: 52, s: 180, t: 300 }
  const assetNames = path.assets.map((a) => a.name)
  const assetX = assetNames.map((n) => { const xs = steps.map((s, i) => (s.asset === n ? sx(i) : -1)).filter((x) => x >= 0); return { n, x: xs.reduce((a, b) => a + b, 0) / xs.length } }).sort((a, b) => a.x - b.x)
  for (let i = 1; i < assetX.length; i++) if (assetX[i].x - assetX[i - 1].x < 130) assetX[i].x = assetX[i - 1].x + 130
  const ax = (n: string) => assetX.find((a) => a.n === n)?.x ?? 0
  const W2 = Math.max(W, (assetX.at(-1)?.x ?? 0) + X0)
  const dim = (s: Step) => hide[s.status] || (hl !== null && s.technique !== hl)
  const fit = () => { const w = wrap.current?.clientWidth || W2; setZoom(Math.max(0.4, Math.min(1, (w - 8) / W2))) }
  const few = path.nObserved < 2

  const download = () => {
    const el = svgRef.current
    if (!el) return
    const cs = getComputedStyle(document.documentElement)
    let src = new XMLSerializer().serializeToString(el).replace(/var\((--c-[a-z]+)\)/g, (_, v) => cs.getPropertyValue(v).trim())
    src = src.replace('>', `><rect width="100%" height="100%" fill="${cs.getPropertyValue('--c-panel').trim()}"/>`)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([src], { type: 'image/svg+xml' }))
    a.download = `attack-path-${path.op.id}.svg`
    a.click()
    toast('Graph image downloaded (SVG).')
  }

  const selStep = sel?.kind === 'step' ? steps.find((s) => s.id === sel.id) : undefined
  const selAsset = sel?.kind === 'asset' ? db.assets.find((a) => a.name === sel.id && a.projectId === path.projectId) : undefined
  const selTech = sel?.kind === 'tech' ? path.techniques.find((t) => t.id === sel.id) : undefined
  const close = () => setSel(null)

  return (
    <div className="grid gap-4 xl:grid-cols-[240px_1fr]">
      <div className="space-y-4">
        <Card>
          <div className="mb-3 text-sm font-semibold">Graph filters</div>
          <label className="mb-1.5 block text-xs text-muted">Operation shown</label>
          <Select value={path.op.id} disabled={!!opId} onChange={(e) => { setPick(e.target.value); setSel(null) }} aria-label="Operation shown">
            {graph.data.ops.map((o) => <option key={o.id} value={o.id}>{o.id}</option>)}
          </Select>
          {opId && <div className="mt-1 text-xs text-neutral">Locked by the operation filter above.</div>}
          <div className="mb-1.5 mt-4 text-xs text-muted">Show by step result</div>
          <div className="space-y-1.5">
            {(['ok', 'fail', 'review', 'running', 'unknown', 'pending', 'notrun'] as const).map((k) => (
              <label key={k} className="flex cursor-pointer items-center gap-2 text-xs">
                <input type="checkbox" className="accent-[var(--c-accent)]" checked={!hide[k]} onChange={(e) => setHide({ ...hide, [k]: !e.target.checked })} />
                <Status kind="step" value={k} size="sm" />
              </label>
            ))}
          </div>
          {hl && <div className="mt-3"><Chip onRemove={() => setHl(null)}>Highlighted: <Mono>{hl}</Mono></Chip></div>}
        </Card>
        <Card>
          <div className="mb-3 text-sm font-semibold">Legend</div>
          <ul className="space-y-2 text-xs text-muted">
            <li className="flex items-center gap-2"><svg width="30" height="16"><rect x="1" y="2" width="28" height="12" rx="4" fill="none" stroke="var(--c-accent)" strokeWidth="1.5" /></svg>Asset</li>
            <li className="flex items-center gap-2"><svg width="30" height="16"><circle cx="15" cy="8" r="7" fill="none" stroke="var(--c-ok)" strokeWidth="1.5" /></svg>Execution step (icon = result)</li>
            <li className="flex items-center gap-2"><svg width="30" height="16"><polygon points="7,1 23,1 29,8 23,15 7,15 1,8" fill="none" stroke="var(--c-cyan)" strokeWidth="1.5" /></svg>ATT&CK technique</li>
            <li className="flex items-center gap-2"><svg width="30" height="8"><line x1="0" x2="30" y1="4" y2="4" stroke="var(--c-muted)" strokeWidth="2" /></svg>Observed (recorded)</li>
            <li className="flex items-center gap-2"><svg width="30" height="8"><line x1="0" x2="30" y1="4" y2="4" stroke="var(--c-neutral)" strokeWidth="2" strokeDasharray="4 3" /></svg>Planned — not executed, not an event that happened</li>
          </ul>
        </Card>
      </div>
      <Card pad={false} className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <div className="mr-auto"><div className="text-sm font-semibold">{path.op.id} — {path.op.name}</div><div className="text-xs text-muted">{steps.length} steps · {path.nObserved} executed</div></div>
          <Button size="sm" variant="ghost" icon={ZoomOut} onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.15).toFixed(2)))} aria-label="Zoom out" title="Zoom out" />
          <span className="w-10 text-center text-xs tabular-nums text-muted">{Math.round(zoom * 100)}%</span>
          <Button size="sm" variant="ghost" icon={ZoomIn} onClick={() => setZoom((z) => Math.min(1.6, +(z + 0.15).toFixed(2)))} aria-label="Zoom in" title="Zoom in" />
          <Button size="sm" variant="ghost" icon={Maximize2} onClick={fit}>Fit</Button>
          <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => { setZoom(1); setHl(null); setHide({}); setSel(null) }}>Reset view</Button>
          <Button size="sm" variant="secondary" icon={Download} disabled={!can('viewSensitive')} title={can('viewSensitive') ? 'Download the graph as SVG' : `The ${ROLE_LABEL[me.role]} role cannot download graph images.`} onClick={download}>Download image</Button>
        </div>
        {few && <div className="border-b border-line p-3"><Banner tone="info" title="Not enough data to draw the full chain">Only {path.nObserved} step(s) have executed. Remaining steps are shown as planned (dashed) and are never presented as verified paths.</Banner></div>}
        <div ref={wrap} className="overflow-auto p-2" style={{ maxHeight: 560 }}>
          <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${W2} ${H}`} width={W2 * zoom} height={H * zoom} role="img" aria-label={`Attack path graph for operation ${path.op.id}`} fontFamily="Inter, Arial, sans-serif">
            <defs><marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--c-muted)" /></marker></defs>
            {[['Assets', Y.a], ['Execution steps', Y.s], ['Techniques', Y.t]].map(([l, y]) => <text key={l as string} x={6} y={(y as number) - 34} fontSize="10" fill="var(--c-neutral)" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>{l}</text>)}
            {/* provenance edges from the path read model: observed only between recorded execution events */}
            {path.edges.map((e) => {
              if (e.kind === 'asset-step') {
                const i = steps.findIndex((s) => s.id === e.to)
                return (
                  <path key={e.id} d={`M${ax(e.from)},${Y.a + 22} C${ax(e.from)},${Y.a + 70} ${sx(i)},${Y.s - 70} ${sx(i)},${Y.s - 24}`} fill="none" stroke={e.observed ? 'var(--c-muted)' : 'var(--c-neutral)'} strokeWidth={1.3} strokeDasharray={e.observed ? undefined : '4 3'} opacity={dim(steps[i]) ? 0.2 : 0.8}>
                    <title>{e.observed ? 'Observed' : 'Planned — not executed'}: {e.from} → {e.to}</title>
                  </path>
                )
              }
              const i = steps.findIndex((s) => s.id === e.from)
              return (
                <line key={e.id} x1={sx(i) + 25} x2={sx(i + 1) - 26} y1={Y.s} y2={Y.s} stroke={e.observed ? 'var(--c-muted)' : 'var(--c-neutral)'} strokeWidth={1.8} strokeDasharray={e.observed ? undefined : '5 4'} markerEnd="url(#arr)" opacity={dim(steps[i]) && dim(steps[i + 1]) ? 0.2 : 0.9}>
                  <title>{e.observed ? 'Observed' : 'Planned — not executed'}: {e.from} → {e.to}</title>
                </line>
              )
            })}
            {/* step→technique taxonomy connectors (view-level, not path edges) */}
            {steps.map((s, i) => <line key={'et' + s.id} x1={sx(i)} x2={sx(i)} y1={Y.s + 24} y2={Y.t - 20} stroke="var(--c-line)" strokeWidth={1.3} opacity={dim(s) ? 0.2 : 1} />)}
            {/* asset nodes */}
            {assetX.map((a) => {
              const on = sel?.kind === 'asset' && sel.id === a.n
              return (
                <g key={a.n} tabIndex={0} role="button" aria-label={`Asset ${a.n}`} className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" onClick={() => setSel({ kind: 'asset', id: a.n })} onKeyDown={(e) => e.key === 'Enter' && setSel({ kind: 'asset', id: a.n })}>
                  <rect x={a.x - 56} y={Y.a - 20} width={112} height={40} rx={10} fill="var(--c-panel)" stroke="var(--c-accent)" strokeWidth={on ? 3 : 1.5} />
                  <text x={a.x} y={Y.a + 4} textAnchor="middle" fontSize="12" fill="var(--c-fg)" fontFamily="JetBrains Mono, monospace">{a.n.length > 14 ? a.n.slice(0, 13) + '…' : a.n}</text>
                </g>
              )
            })}
            {/* step nodes */}
            {steps.map((s, i) => {
              const G = STEP_GLYPH[s.status]
              const on = sel?.kind === 'step' && sel.id === s.id
              return (
                <g key={s.id} tabIndex={0} role="button" aria-label={`Step ${s.id} ${s.name}`} className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" opacity={dim(s) ? 0.25 : 1} onClick={() => setSel({ kind: 'step', id: s.id })} onKeyDown={(e) => e.key === 'Enter' && setSel({ kind: 'step', id: s.id })}>
                  <circle cx={sx(i)} cy={Y.s} r={23} fill="var(--c-panel)" stroke={STEP_COL[s.status]} strokeWidth={on ? 4 : 2} strokeDasharray={executed(s.id) ? undefined : '4 3'} />
                  <G x={sx(i) - 10} y={Y.s - 10} width={20} height={20} color={STEP_COL[s.status]} />
                  <text x={sx(i)} y={Y.s + 42} textAnchor="middle" fontSize="11" fill="var(--c-fg)" fontFamily="JetBrains Mono, monospace">{s.id}</text>
                  <text x={sx(i)} y={Y.s + 55} textAnchor="middle" fontSize="10" fill="var(--c-muted)">{STEP_TXT[s.status]}</text>
                  <title>{s.name}</title>
                </g>
              )
            })}
            {/* technique nodes */}
            {steps.map((s, i) => {
              const x = sx(i), y = Y.t
              const on = (sel?.kind === 'tech' && sel.id === s.technique) || hl === s.technique
              return (
                <g key={'t' + s.id} tabIndex={0} role="button" aria-label={`Technique ${s.technique}`} className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" opacity={dim(s) ? 0.25 : 1} onClick={() => setSel({ kind: 'tech', id: s.technique })} onKeyDown={(e) => e.key === 'Enter' && setSel({ kind: 'tech', id: s.technique })}>
                  <polygon points={`${x - 40},${y} ${x - 28},${y - 18} ${x + 28},${y - 18} ${x + 40},${y} ${x + 28},${y + 18} ${x - 28},${y + 18}`} fill="var(--c-panel)" stroke="var(--c-cyan)" strokeWidth={on ? 3 : 1.5} />
                  <text x={x} y={y + 4} textAnchor="middle" fontSize="11.5" fill="var(--c-fg)" fontFamily="JetBrains Mono, monospace">{s.technique}</text>
                </g>
              )
            })}
          </svg>
        </div>
      </Card>

      <Drawer
        open={!!sel} onClose={close}
        title={selStep ? <span><Mono className="text-accent">{selStep.id}</Mono> · {selStep.name}</span> : selAsset || sel?.kind === 'asset' ? `Asset ${sel?.id}` : selTech ? <span><Mono className="text-accent">{selTech.id}</Mono> · {selTech.name}</span> : ''}
        footer={selStep ? (
          <>
            <Button variant="ghost" icon={Crosshair} onClick={() => { setHl(selStep.technique); close() }}>Filter by technique</Button>
            <Button icon={ExternalLink} onClick={() => go('operation', { id: path.op.id, tab: 'console' })}>Open execution step</Button>
            <CreateFindingBtn variant="primary" label="Create Finding from this node" prefill={{ projectId: path.projectId, op: path.op.id, technique: selStep.technique, asset: selStep.asset, stepId: selStep.id, title: selStep.name }} />
          </>
        ) : selTech ? (
          <>
            <Button variant="ghost" icon={Crosshair} onClick={() => { setHl(selTech.id); close() }}>Highlight on graph</Button>
            <Button icon={ExternalLink} onClick={() => go('technique', { id: selTech.id })}>Technique page</Button>
          </>
        ) : selAsset ? <Button icon={ExternalLink} onClick={() => go('asset', { id: selAsset.id })}>Open asset</Button> : undefined}
      >
        {selStep && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2"><Status kind="step" value={selStep.status} /><Banner tone="info" icon={CheckCircle2}>{executed(selStep.id) ? 'Observed — recorded in operation data.' : selStep.status === 'review' ? 'Output received — awaiting operator review; not counted as executed in coverage until approved.' : 'Not executed — shown from the operation plan only.'}</Banner></div>
            <dl className="grid grid-cols-2 gap-4 text-sm">
              {[['Operation', path.op.id], ['Project', path.projectId], ['Session', path.op.sessionId ?? '—'], ['Asset', selStep.asset], ['Agent', selStep.agent], ['Timestamp', selStep.ts], ['Duration', selStep.dur], ['Technique', selStep.technique]].map(([k, v]) => <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="font-mono text-[13px]">{v}</dd></div>)}
            </dl>
            <div><div className="mb-1 text-xs text-muted">Description / output</div><div className="rounded-lg bg-bg p-3 text-sm">{selStep.output}</div></div>
            <div><div className="mb-2 text-xs text-muted">Evidence</div><EvidenceList ids={selStep.evidence && selStep.evidence.startsWith('EV-') ? [selStep.evidence] : []} /></div>
          </div>
        )}
        {sel?.kind === 'asset' && (
          <div className="space-y-3">
            {selAsset ? <><dl className="grid grid-cols-2 gap-4 text-sm">{[['ID', selAsset.id], ['Identifier', selAsset.ident], ['Type', selAsset.type], ['Operating system', selAsset.os]].map(([k, v]) => <div key={k}><dt className="text-xs text-muted">{k}</dt><dd>{v}</dd></div>)}</dl><Status kind="scope" value={selAsset.scope} /></> : <div className="text-sm text-muted">Asset record not found.</div>}
            <div className="text-xs text-muted">Steps targeting this asset: {steps.filter((s) => s.asset === sel.id).map((s) => s.id).join(', ')}</div>
          </div>
        )}
        {selTech && (
          <div className="space-y-3 text-sm">
            <p className="text-muted">{selTech.desc}</p>
            <div className="text-xs text-muted">Tactic: <span className="text-fg">{selTech.tactic}</span></div>
            <div className="text-xs text-muted">Steps using this technique: <span className="font-mono text-fg">{selTech.stepIds.join(', ')}</span></div>
            <div>
              <div className="mb-1 text-xs text-muted">Related findings</div>
              {selTech.findings.length ? <ul className="space-y-1">{selTech.findings.map((f) => <li key={f.id}><button className="font-mono text-[13px] text-accent hover:underline" onClick={() => go('finding', { id: f.id })}>{f.id}</button> — {f.title}</li>)}</ul> : <div className="text-sm text-neutral">No related findings.</div>}
            </div>
            <Button size="sm" variant="ghost" icon={Grid3x3} onClick={() => go('analysis', { id: opId, tab: 'matrix' })}>View in MITRE ATT&CK matrix</Button>
          </div>
        )}
      </Drawer>
    </div>
  )
}

/* ───────────── MITRE ATT&CK matrix ───────────── */
function Matrix({ ana }: { ana: Ana }) {
  const route = useRoute()
  const setFilter = useSessionStore((s) => s.setFilter)
  const [view, setView] = useState<'heat' | 'table'>('heat')
  const [sel, setSel] = useState<Cell | null>(null)
  const [tac, setTac] = useState('')
  const [tq, setTq] = useState('')
  const tested = ana.cells.filter((c) => c.state !== 'untested' && c.state !== 'planned')
  if (!ana.allOps.length) return <NoOps />
  const cur = sel && ana.cells.find((c) => c.tech.id === sel.tech.id)
  const match = (c: Cell) => (!tac || c.tech.tactic === tac) && (!tq || (c.tech.id + ' ' + c.tech.name).toLowerCase().includes(tq.toLowerCase()))
  const tip = (c: Cell) => { const r = c.runs[0] || c.planned[0]; return `${c.tech.id} — ${c.tech.name}: ${CELL_META[c.state].long}${r ? `\nOperation ${r.op.id} · step ${r.step.id} · ${r.step.ts === '—' ? 'not executed' : r.step.ts + ' (UTC+7)'}${r.step.evidence ? ' · evidence ' + r.step.evidence : ''}` : ''}` }

  return (
    <div className="space-y-4">
      {!ana.siemOn && <Banner tone="warn" title="Detection integration unavailable">The {ana.siemName} integration is not connected — tested techniques show "No data" (unverified).</Banner>}
      {tested.length === 0 && <Banner tone="info" title="No technique has been tested in the current filter">The matrix below is a reference catalog; all cells are "Not tested". Observed evidence and library coverage are different kinds of data.</Banner>}
      <div className="flex flex-wrap items-center gap-3">
        <Segmented value={view} onChange={setView} options={[{ id: 'heat', label: 'Heatmap' }, { id: 'table', label: 'Table' }]} />
        <Select aria-label="Filter tactic" value={tac} onChange={(e) => setTac(e.target.value)} className="!w-auto min-w-40"><option value="">All tactics</option>{TACTICS.map((t) => <option key={t}>{t}</option>)}</Select>
        <SearchBox value={tq} onChange={setTq} placeholder="Technique ID or name…" className="w-52" />
        <span className="text-xs text-muted">{ana.nRun}/{TECHNIQUES.length} techniques tested · {ana.ops.length} operations</span>
        <ul className="ml-auto flex flex-wrap gap-2" aria-label="Legend">
          {(['detected', 'undetected', 'nodata', 'planned', 'untested'] as CellState[]).map((k) => {
            const m = CELL_META[k]; const I = m.icon
            return <li key={k} className={cx('inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11px]', m.cls)}><I size={12} aria-hidden />{m.long}</li>
          })}
        </ul>
      </div>
      {view === 'heat' ? (
        <div className="space-y-2">
          {TACTICS.filter((t) => !tac || t === tac).map((t) => (
            <div key={t} className="flex flex-col gap-2 rounded-xl border border-line bg-panel p-3 md:flex-row md:items-stretch">
              <div className="w-full shrink-0 text-xs font-semibold text-muted md:w-36 md:pt-2">{t}</div>
              <div className="flex flex-wrap gap-2">
                {ana.cells.filter((c) => c.tech.tactic === t && match(c)).map((c) => {
                  const m = CELL_META[c.state]; const I = m.icon
                  return (
                    <button key={c.tech.id} onClick={() => setSel(c)} title={tip(c)} className={cx('flex h-[60px] w-[158px] flex-col justify-between rounded-lg border px-2.5 py-1.5 text-left transition hover:brightness-125', m.cls)}>
                      <span className="flex items-center justify-between"><Mono className="!text-xs font-semibold">{c.tech.id}</Mono><I size={13} aria-hidden /></span>
                      <span className="truncate text-[11px] text-fg/90">{c.tech.name}</span>
                      <span className="truncate text-[10px] opacity-90">{m.label}{c.runs.length ? ` · ${c.runs.length}×` : ''}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Table
          rows={ana.cells.filter(match)} rowKey={(c) => c.tech.id} dense onRow={setSel}
          cols={[
            { key: 'id', header: 'ID', render: (c) => <Mono className="text-accent">{c.tech.id}</Mono> },
            { key: 'n', header: 'Technique', render: (c) => c.tech.name },
            { key: 't', header: 'Tactic', hideBelow: 'md', render: (c) => c.tech.tactic },
            { key: 'r', header: 'Test runs', render: (c) => c.runs.length || '—' },
            { key: 's', header: 'Status', render: (c) => { const m = CELL_META[c.state]; const I = m.icon; return <span className={cx('inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-xs', m.cls)}><I size={12} aria-hidden />{m.label}</span> } },
          ]}
        />
      )}
      <Drawer
        open={!!cur} onClose={() => setSel(null)}
        title={cur ? <span><Mono className="text-accent">{cur.tech.id}</Mono> · {cur.tech.name}</span> : ''}
        footer={cur && (
          <>
            {cur.runs.length ? [...new Set(cur.runs.map((r) => r.op.id))].map((id) => <Button key={id} variant="secondary" icon={ExternalLink} onClick={() => go('operation', { id })}>View operation {id}</Button>) : <Button variant="secondary" disabled title="This technique has not been tested in any operation.">View operation</Button>}
            {cur.runs.length ? <CreateFindingBtn variant="primary" prefill={{ projectId: cur.runs[0].op.projectId, op: cur.runs[0].op.id, technique: cur.tech.id, asset: cur.runs[0].step.asset, stepId: cur.runs[0].step.id, title: cur.state === 'undetected' ? `Technique ${cur.tech.id} not detected` : undefined }} /> : <Button disabled title="A test result is required before creating a finding." icon={Bug}>Create Finding</Button>}
          </>
        )}
      >
        {cur && (
          <div className="space-y-4">
            <p className="text-muted">{cur.tech.desc}</p>
            <dl className="grid grid-cols-2 gap-4">
              <div><dt className="text-xs text-muted">Tactic</dt><dd>{cur.tech.tactic}</dd></div>
              <div><dt className="text-xs text-muted">Platforms</dt><dd>{cur.tech.platforms.join(', ')}</dd></div>
              <div><dt className="text-xs text-muted">Executed runs / planned</dt><dd>{cur.runs.length} / {cur.planned.length}</dd></div>
              <div><dt className="text-xs text-muted">Detection status</dt><dd>{cur.state === 'untested' || cur.state === 'planned' ? CELL_META[cur.state].label : <DetectBadge state={cur.state} />}</dd></div>
            </dl>
            {cur.state === 'nodata' && <Banner tone="warn" title="Executed & No Data">No telemetry was received for this technique. This is not the same as Not Detected — verify with the Blue Team.</Banner>}
            {cur.state === 'planned' && <Banner tone="info" title="Planned Only">Steps exist in the plan but have not executed (or await operator review). No detection result is shown.</Banner>}
            <div>
              <div className="mb-2 text-xs text-muted">Steps that used this technique</div>
              {cur.runs.length + cur.planned.length === 0 ? <div className="text-sm text-neutral">No steps in the current filter.</div> : (
                <ul className="space-y-2">
                  {[...cur.runs, ...cur.planned].map((r) => (
                    <li key={r.op.id + r.step.id} className="rounded-lg border border-line p-3">
                      <div className="flex flex-wrap items-center gap-2"><Mono className="text-accent">{r.op.id}/{r.step.id}</Mono><span className="flex-1 truncate">{r.step.name}</span><Status kind="step" value={r.step.status} size="sm" /></div>
                      <div className="mt-1 text-xs text-muted">{r.step.asset} · {r.step.agent} · {r.step.ts}</div>
                      {r.step.evidence?.startsWith('EV-') && <div className="mt-2"><EvidenceList ids={[r.step.evidence]} /></div>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" icon={ExternalLink} onClick={() => go('technique', { id: cur.tech.id })}>Open technique in Playbooks</Button><Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => { setFilter('operations.technique', cur.tech.id); go('operations') }}>View operations testing this technique</Button></div>
            {route.id && <div className="text-xs text-neutral">Data is filtered to operation {route.id}.</div>}
          </div>
        )}
      </Drawer>
    </div>
  )
}

/* ───────────── Detection Coverage ───────────── */
function Detection({ ana, canAdmin }: { ana: Ana; canAdmin: boolean }) {
  const can = useCan()
  const me = useMe()
  const [tactic, setTactic] = useState('')
  const [sel, setSel] = useState<Pair | null>(null)
  if (!can('viewSensitive')) {
    return <Empty icon={Lock} title="No permission to view Blue Team data">The {ROLE_LABEL[me.role]} role cannot view detailed detection signals. Contact the project manager if you need an aggregate report.</Empty>
  }
  if (!ana.allOps.length) return <NoOps />
  const pairs = ana.pairs.filter((p) => !tactic || p.tech.tactic === tactic)
  const nd = pairs.filter((p) => p.state === 'detected').length
  const nu = pairs.filter((p) => p.state === 'undetected').length
  const nn = pairs.filter((p) => p.state === 'nodata').length
  const withData = nd + nu
  const gaps = pairs.filter((p) => p.state !== 'detected')
  const telemetry = pairs.filter((p) => p.runs.length)
  const findingsOf = (p: Pair) => p.findings
  const byTactic = TACTICS.map((t) => { const ps = pairs.filter((p) => p.tech.tactic === t); return { t, d: ps.filter((p) => p.state === 'detected').length, u: ps.filter((p) => p.state === 'undetected').length, n: ps.filter((p) => p.state === 'nodata').length } }).filter((r) => r.d + r.u + r.n > 0)
  const gapPrefill = (p: Pair): Prefill => ({ projectId: p.projectId, op: p.runs[0].op.id, technique: p.tech.id, asset: p.runs[0].step.asset, stepId: p.runs[0].step.id, title: p.state === 'undetected' ? `Technique ${p.tech.id} (${p.tech.name}) not detected` : `No detection signal recorded for ${p.tech.id} (unverified)`, severity: 'medium', desc: p.state === 'undetected' ? `Technique ${p.tech.id} was tested and ${ana.siemName} confirmed no detection signal.` : `No signal observed from ${ana.siemName} for ${p.tech.id}; verify with the Blue Team.` })

  return (
    <div className="space-y-6">
      {!ana.siemOn ? (
        <Banner tone="warn" title="Detection integration missing" action={<Button size="sm" disabled={!canAdmin} title={canAdmin ? '' : 'Only Organization Admins can view integration settings.'} icon={Plug} onClick={() => go('settings', { tab: 'integrations' })}>View integration settings</Button>}>
          The {ana.siemName} integration is not connected. Every technique is treated as "Unverified" — this must not be read as "not detected".
        </Banner>
      ) : (
        <Banner tone="ok" title={`${ana.siemName} integration is active`} action={<Button size="sm" variant="secondary" icon={Plug} disabled={!canAdmin} title={canAdmin ? '' : 'Only Organization Admins can view integration settings.'} onClick={() => go('settings', { tab: 'integrations' })}>View integration settings</Button>}>
          Partial data: only techniques with records from this source count toward the detection rate.
        </Banner>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Filter tactic" value={tactic} onChange={(e) => setTactic(e.target.value)} className="!w-auto min-w-52"><option value="">All tactics</option>{TACTICS.map((t) => <option key={t}>{t}</option>)}</Select>
        {tactic && <Chip onRemove={() => setTactic('')}>{tactic}</Chip>}
      </div>
      {pairs.length === 0 ? (
        <Empty icon={ShieldAlert} title="No tested techniques to evaluate">An operation with completed steps is required. Charts are not drawn without data.</Empty>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <Kpi
              label="Detection rate (with data)"
              value={withData ? `${Math.round((nd / withData) * 100)}%` : <span className="text-base text-muted">No data</span>}
              tone={withData ? (nd / withData >= 0.8 ? 'ok' : 'warn') : undefined}
              sub={withData ? `Denominator: ${withData} techniques with data (${nd} detected / ${nu} not)` : 'No detection data for any technique'}
              icon={ShieldAlert}
            />
            <Kpi label="Detected" value={nd} tone={nd ? 'ok' : undefined} icon={CheckCircle2} sub="tested and signal observed" />
            <Kpi label="Not detected (verified)" value={nu} tone={nu ? 'bad' : undefined} icon={XCircle} sub="detection gaps" />
            <Kpi label="No Data" value={nn} tone={nn ? 'warn' : undefined} icon={MinusCircle} sub="no data — excluded from the denominator" />
          </div>
          <Card>
            <CardHeader title="Detection by tactic" sub="Green = detected, red = not detected (verified), amber = no data. Each bar is labeled with counts. Source: detection integration." />
            <ul className="space-y-3">
              {byTactic.map((r) => {
                const tot = r.d + r.u + r.n, dn = r.d + r.u
                return (
                  <li key={r.t} className="grid grid-cols-1 items-center gap-2 text-xs md:grid-cols-[170px_1fr_190px] md:gap-3">
                    <span className="text-muted">{r.t}</span>
                    <svg viewBox="0 0 100 10" preserveAspectRatio="none" className="h-2.5 w-full" role="img" aria-label={`${r.d} detected, ${r.u} not detected, ${r.n} no data`}>
                      <rect width="100" height="10" rx="5" fill="var(--c-hover)" />
                      <rect x="0" width={(r.d / tot) * 100} height="10" fill="var(--c-ok)" />
                      <rect x={(r.d / tot) * 100} width={(r.u / tot) * 100} height="10" fill="var(--c-bad)" />
                      <rect x={((r.d + r.u) / tot) * 100} width={(r.n / tot) * 100} height="10" fill="var(--c-warn)" opacity=".6" />
                    </svg>
                    <span className="tabular-nums">{dn ? `${r.d}/${dn} detected` : 'No detection data'}{r.n ? ` · ${r.n} unverified` : ''}</span>
                  </li>
                )
              })}
            </ul>
          </Card>
          <Card pad={false}>
            <div className="p-5 pb-3"><CardHeader title="Executed events vs telemetry collected" sub={`Executed steps compared with ${ana.siemName} telemetry (Simulated). Window = operation start to last update.`} /></div>
            <Table
              dense rows={telemetry} rowKey={(r) => r.tech.id}
              cols={[
                { key: 't', header: 'Technique', render: (r) => <span className="whitespace-nowrap"><Mono className="text-accent">{r.tech.id}</Mono> <span className="text-xs text-muted">{r.tech.name}</span></span> },
                { key: 'x', header: 'Executed', render: (r) => <span className="tabular-nums">{r.runs.length}</span> },
                { key: 'c', header: 'Telemetry', render: (r) => <span className="tabular-nums">{r.state === 'nodata' ? 0 : r.runs.length} <span className="text-xs text-muted">collected</span></span> },
                { key: 'src', header: 'Detection source', hideBelow: 'md', render: (r) => (r.state === 'nodata' ? <span className="text-muted">No source data</span> : ana.siemName) },
                { key: 'cf', header: 'Confidence', hideBelow: 'md', render: (r) => (r.state === 'detected' ? 'High' : r.state === 'undetected' ? 'Medium (absence verified)' : '—') },
                { key: 'w', header: 'Window', hideBelow: 'lg', render: (r) => <span className="whitespace-nowrap text-xs text-muted">{r.runs[0].op.startedAt.replace(/, 2026/, '')}</span> },
                { key: 'e', header: 'Event IDs', hideBelow: 'lg', render: (r) => (r.state === 'detected' ? <span className="whitespace-nowrap font-mono text-[12px]">{`EVT-${r.tech.id}-${r.runs[0].op.id.slice(3)}`}</span> : '—') },
                { key: 's', header: 'Result', render: (r) => <DetectBadge state={r.state} /> },
              ]}
            />
          </Card>
          <Card>
            <CardHeader title="AI Interpretation" sub="AI-generated reading of the table above. Not a verified finding." actions={<span className="inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full border border-warn/40 bg-warn/10 px-2.5 text-xs text-warn"><Sparkles size={12} aria-hidden />Needs Verification</span>} />
            <p className="text-sm leading-relaxed">
              {nd} of {withData} techniques with telemetry produced a signal; {nu} {nu === 1 ? 'was' : 'were'} executed without one and {nn} have no data, so they cannot be called missed detections.
              {gaps.length ? ' Review the gaps below with the Blue Team before recording a finding.' : ''}
            </p>
            <div className="mt-2 text-xs text-muted">Sources: {pairs.slice(0, 4).map((p) => `${p.runs[0].op.id}/${p.runs[0].step.id}`).join(', ')} · {ana.siemName} (Simulated)</div>
          </Card>
          <Table
            rows={pairs} rowKey={(p) => p.projectId + p.tech.id} onRow={setSel} dense
            cols={[
              { key: 'id', header: 'Technique', render: (p) => <div><Mono className="text-accent">{p.tech.id}</Mono><div className="text-xs text-muted">{p.tech.name}</div></div> },
              { key: 'pr', header: 'Project', hideBelow: 'md', render: (p) => <Mono>{p.projectId}</Mono> },
              { key: 'n', header: 'Test runs', render: (p) => p.runs.length },
              { key: 'sig', header: 'Signal', render: (p) => <DetectBadge state={p.state} /> },
              { key: 'ver', header: 'Verification', hideBelow: 'md', render: (p) => (p.state === 'nodata' ? <span className="text-warn">Unverified</span> : <span className="text-ok">Verified</span>) },
              { key: 'src', header: 'Log source', hideBelow: 'lg', render: (p) => (p.state === 'nodata' ? '—' : ana.siemName) },
              { key: 'f', header: 'Related findings', hideBelow: 'lg', render: (p) => { const f = findingsOf(p); return f.length ? <span className="font-mono text-[13px]">{f.map((x) => x.id).join(', ')}</span> : '—' } },
            ]}
          />
          <Card>
            <CardHeader title="Gaps to address" sub="'No signal observed' is not the same as 'definitely not detected'." />
            {gaps.length === 0 ? <div className="text-sm text-muted">No gaps in the current filter.</div> : (
              <ul className="space-y-2">
                {gaps.map((p) => (
                  <li key={p.projectId + p.tech.id} className="flex flex-wrap items-start gap-3 rounded-lg border border-line p-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2"><Mono className="text-accent">{p.tech.id}</Mono><span className="text-sm">{p.tech.name}</span><DetectBadge state={p.state} /></div>
                      <div className="mt-1 text-xs text-muted">Recommendation: {recFor(p.tech, p.state)}</div>
                    </div>
                    <CreateFindingBtn size="sm" label="Create Finding Draft" prefill={gapPrefill(p)} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
      <Drawer
        open={!!sel} onClose={() => setSel(null)} title={sel ? <span><Mono className="text-accent">{sel.tech.id}</Mono> · {sel.tech.name}</span> : ''}
        footer={sel && sel.state !== 'detected' ? <CreateFindingBtn variant="primary" label="Create Finding Draft" prefill={gapPrefill(sel)} /> : undefined}
      >
        {sel && (
          <div className="space-y-4">
            <div className="flex items-center gap-2"><DetectBadge state={sel.state} /><span className="text-xs text-muted">{sel.projectId} · {sel.runs.length} test run(s)</span></div>
            {sel.state === 'nodata' && <Banner tone="warn" title="Unverified">No data from {ana.siemName} for this technique yet.</Banner>}
            <div><div className="mb-2 text-xs text-muted">Evidence from steps</div>
              <EvidenceList ids={sel.runs.map((r) => r.step.evidence).filter((x): x is string => !!x && x.startsWith('EV-'))} />
            </div>
            <div><div className="mb-2 text-xs text-muted">Related findings</div>
              {findingsOf(sel).length ? <ul className="space-y-1">{findingsOf(sel).map((f) => <li key={f.id}><button className="font-mono text-[13px] text-accent hover:underline" onClick={() => go('finding', { id: f.id })}>{f.id}</button> — {f.title}</li>)}</ul> : <div className="text-sm text-neutral">No related findings.</div>}
            </div>
            <div className="rounded-lg bg-bg p-3 text-xs text-muted">{recFor(sel.tech, sel.state)}</div>
          </div>
        )}
      </Drawer>
    </div>
  )
}

export const analysisRoutes: Record<string, ComponentType> = { analysis: Analysis }
