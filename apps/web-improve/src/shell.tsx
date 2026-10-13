import { useEffect, useState, type ReactNode } from 'react'
import {
  AlertTriangle, Clock, FolderKanban, Info, Layers, Loader2, Lock, MoreHorizontal, OctagonX, Phone, RotateCcw, Settings, ShieldAlert, Activity, type LucideIcon,
} from 'lucide-react'
import { ROLE_LABEL, useStore, eligibility, type Route } from './store'
import { Banner, Button, Modal, Field, Textarea, Status, Tabs, Segmented, Check, cx } from './ui'
import { CopilotDrawer } from './screens/ai-copilot'
import { DemoGuide } from './screens/demo-guide'
import { isWide } from './shell/nav'
import { Sidebar } from './shell/sidebar'
import { Topbar } from './shell/header'
import { Pop } from './shell/pop'

const useS = () => useStore()

/* ───────────── Navigation + sidebar: extracted in src/shell/nav.ts + sidebar.tsx (ticket 08a) ───────────── */

/* ───────────── Project switcher + global search: extracted in src/shell/project-switcher.tsx + search.tsx (ticket 08b) ───────────── */
/* ───────────── Header (AI mode, workspace, notices, profile): extracted in src/shell/pop.tsx + header.tsx with ticket 59/60 slots (ticket 08c) ───────────── */
/* ───────────── Project context ribbon + emergency stop ───────────── */
function EmergencyStop({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { db, project, me, A, go } = useS()
  const [scope, setScope] = useState<'project' | 'workspace'>('project')
  const [reason, setReason] = useState('')
  const [ack, setAck] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { if (open) { setScope('project'); setReason(''); setAck(false); setErr('') } }, [open])
  if (!project) return null
  const d = db as any
  const running = db.operations.filter((o) => (scope === 'workspace' || o.projectId === project.id) && ['running', 'paused'].includes(o.status))
  const live = ((d.sessions || []) as any[]).filter((x) => (scope === 'workspace' || x.projectId === project.id) && ['connected', 'awaiting'].includes(x.state))
  const submit = () => {
    if (reason.trim().length < 5) { setErr('A reason is required (at least 5 characters). It is recorded in the audit log.'); return }
    if (!ack) { setErr('Confirm that you understand the impact.'); return }
    ;(A as any).emergencyStop(scope, scope === 'workspace' ? 'workspace' : project.id, reason.trim())
    onClose()
    void go
  }
  return (
    <Modal open={open} onClose={onClose} danger title="Emergency Stop" width={560}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="destructive" icon={OctagonX} onClick={submit}>Stop now</Button></>}>
      <div className="space-y-4">
        <fieldset>
          <legend className="mb-1.5 text-xs font-medium text-muted">Scope</legend>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-[10px] border border-line px-3 text-sm"><input type="radio" name="es-scope" checked={scope === 'project'} onChange={() => setScope('project')} className="accent-[var(--c-accent)]" />This project — {project.id}</label>
          <label className={cx('mt-2 flex min-h-11 items-center gap-2 rounded-[10px] border border-line px-3 text-sm', me.role === 'admin' ? 'cursor-pointer' : 'cursor-not-allowed opacity-50')} title={me.role === 'admin' ? undefined : 'Only workspace admins can stop the entire workspace'}>
            <input type="radio" name="es-scope" disabled={me.role !== 'admin'} checked={scope === 'workspace'} onChange={() => setScope('workspace')} className="accent-[var(--c-accent)]" />Entire workspace{me.role !== 'admin' && <span className="text-xs text-muted"> (admin only)</span>}
          </label>
        </fieldset>
        <div className="rounded-xl border border-bad/30 bg-bad-soft p-3 text-sm">
          <div className="mb-1 font-semibold text-bad">Impact</div>
          <p>{running.length} running or paused operation{running.length === 1 ? '' : 's'}{running.length ? `: ${running.map((o) => o.id).join(', ')}` : ''}.</p>
          <p>{live.length} live session{live.length === 1 ? '' : 's'} will be revoked{live.length ? `: ${live.map((x) => x.id).join(', ')}` : ''}.</p>
          <p className="mt-1 text-muted">Agents stop taking new steps. In-flight steps are marked Unknown.</p>
        </div>
        <Field label="Reason" required error={err}><Textarea value={reason} onChange={(e) => { setReason(e.target.value); setErr('') }} placeholder="Why is this stop needed?" /></Field>
        <Check checked={ack} onChange={(v) => { setAck(v); setErr('') }} label="I understand this halts all activity in the selected scope immediately." />
      </div>
    </Modal>
  )
}

function StopBanner() {
  const { db, pid, A } = useS()
  const st = (db as any).stopState as null | { scope: string; id: string; phase: 'requested' | 'acknowledged' | 'failed' | 'unknown' | 'stopping' | 'stopped'; reason: string; at: string; by?: string }
  const { go } = useS()
  if (!st) return null
  const opProj = st.scope === 'operation' ? db.operations.find((o) => o.id === st.id)?.projectId : ''
  const relevant = pid === 'all' || st.scope === 'workspace' || (st.scope === 'project' && st.id === pid) || opProj === pid
  if (!relevant) return null
  const target = st.scope === 'workspace' ? 'the entire workspace' : `${st.scope} ${st.id}`
  const audit = <Button size="sm" onClick={() => go('settings', { tab: 'audit' })}>View audit log</Button>
  const dismiss = <Button size="sm" variant="ghost" onClick={() => A.resolveStop('dismiss')}>Dismiss</Button>
  const m = {
    requested: { tone: 'warn', icon: Loader2, title: 'Emergency Stop requested — waiting for agent acknowledgement', body: `Nothing has stopped yet. Waiting for agents to confirm halt for ${target}. Do not treat activity as stopped until acknowledged.`, action: audit },
    acknowledged: { tone: 'info', icon: Loader2, title: 'Emergency Stop acknowledged — revoking sessions', body: `Agents confirmed halt for ${target}. Live sessions are being revoked.`, action: audit },
    stopping: { tone: 'info', icon: Loader2, title: 'Emergency Stop acknowledged — revoking sessions', body: `Agents confirmed halt for ${target}. Live sessions are being revoked.`, action: audit },
    stopped: { tone: 'ok', icon: OctagonX, title: 'Stopped — acknowledged by agents', body: `Activity for ${target} has stopped and sessions are revoked.`, action: <div className="flex gap-2">{audit}{dismiss}</div> },
    failed: { tone: 'bad', icon: AlertTriangle, title: 'Emergency Stop failed — no acknowledgement received', body: `Activity for ${target} may still be running. Retry the stop or contact the emergency contact now.`, action: <div className="flex gap-2"><Button size="sm" variant="destructive" icon={RotateCcw} onClick={() => A.retryStop()}>Retry</Button>{audit}{dismiss}</div> },
    unknown: { tone: 'warn', icon: AlertTriangle, title: 'Emergency Stop status unknown — acknowledgement timed out', body: `Cannot confirm that ${target} has halted. Verify out-of-band before confirming.`, action: <div className="flex flex-wrap gap-2"><Button size="sm" variant="primary" onClick={() => A.resolveStop('confirmed-stopped')}>Confirm stopped manually</Button><Button size="sm" variant="destructive" icon={RotateCcw} onClick={() => A.retryStop()}>Retry</Button>{dismiss}</div> },
  }[st.phase] as { tone: 'warn' | 'info' | 'ok' | 'bad'; icon: LucideIcon; title: string; body: string; action: ReactNode }
  return (
    <div className="px-4 pt-4 lg:px-8">
      <Banner tone={m.tone} icon={m.icon} title={m.title} action={m.action}>{m.body} Requested by {st.by || 'unknown'} at {st.at}. Reason: {st.reason}</Banner>
    </div>
  )
}

const TONE_CLS: Record<string, string> = { ok: 'border-ok/30 bg-ok-soft text-ok', warn: 'border-warn/30 bg-warn-soft text-warn', bad: 'border-bad/30 bg-bad-soft text-bad', neutral: 'border-line bg-subtle text-muted', cyan: 'border-cyan/30 bg-info-soft text-cyan' }
const eligLabel = (e: ReturnType<typeof eligibility>) => e.kind === 'closed' ? 'Read-only (closed)' : e.kind === 'locked' ? 'Execution Locked' : 'Execution Eligible'
function EligBadge({ pid }: { pid: string }) {
  const { db, go } = useS()
  const [open, setOpen] = useState(false)
  const e = eligibility(db, pid)
  const label = eligLabel(e)
  const tone = e.kind === 'locked' ? 'bad' : e.kind === 'closed' ? 'neutral' : e.reasons.length ? 'warn' : 'ok'
  return (
    <span className="relative inline-flex">
      <button onClick={() => setOpen(!open)} aria-haspopup="dialog" aria-expanded={open} aria-label={`Execution Eligibility: ${label}. Show conditions`} className={cx('inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-xs font-medium', TONE_CLS[tone])}>
        {e.kind === 'locked' ? <Lock size={12} aria-hidden /> : <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
        {label}<Info size={12} aria-hidden />
      </button>
      <Pop open={open} onClose={() => setOpen(false)} label="Execution eligibility details" width={360}>
        <div className="mb-1 text-sm font-semibold text-fg">{label}</div>
        <p className="mb-1 text-xs text-fg">{e.label}</p>
        <p className="mb-2 text-xs text-muted">Execution Eligibility is project-level and separate from AI mode and operation runtime state. Drafts can always be saved; only Preflight, Run and Submit are gated.</p>
        {e.reasons.length === 0 ? <p className="text-xs text-muted">{e.kind === 'closed' ? 'This project is closed. Reopen it to run operations.' : 'All preflight conditions are met. Preflight must still pass before each run.'}</p> : (
          <ul className="space-y-1.5">
            {e.reasons.map((r) => (
              <li key={r.text} className="flex items-start gap-2 text-xs text-fg"><AlertTriangle size={13} className="mt-0.5 shrink-0 text-warn" aria-hidden /><span className="min-w-0 flex-1">{r.text}</span>{r.to && <button className="shrink-0 font-medium text-accent hover:underline" onClick={() => { setOpen(false); go(r.to!.page, { id: r.to!.id, tab: r.to!.tab }) }}>Fix</button>}</li>
            ))}
          </ul>
        )}
      </Pop>
    </span>
  )
}

function ContextRibbon({ openSwitcher }: { openSwitcher: () => void }) {
  const { project, go, route, pid } = useS()
  const ribbon = 'sticky top-16 z-20 flex min-h-11 shrink-0 items-center gap-3 border-b border-line px-4 py-1.5 text-xs text-muted lg:px-8'
  if (route.page === 'project-new') {
    return (
      <div className={cx(ribbon, 'bg-subtle')}>
        <FolderKanban size={14} className="shrink-0 text-neutral" aria-hidden />
        <span className="min-w-0 flex-1"><span className="font-semibold text-fg">New project — draft not yet saved</span> · no project context applies until it is saved</span>
      </div>
    )
  }
  if (route.page === 'settings') {
    return (
      <div className={cx(ribbon, 'bg-subtle')}>
        <Settings size={14} className="shrink-0 text-neutral" aria-hidden />
        <span className="min-w-0 flex-1"><span className="font-semibold text-fg">Organization-wide settings</span> · Acme Security (Demo) · changes affect every project in the workspace</span>
        {project && <button className="shrink-0 whitespace-nowrap text-accent hover:underline max-md:hidden" onClick={() => go('project', { id: project.id })}>Back to {project.id}</button>}
      </div>
    )
  }
  if (!project || pid === 'all') {
    return (
      <div className={cx(ribbon, 'bg-subtle')}>
        <Layers size={14} className="shrink-0 text-neutral" aria-hidden />
        <span className="min-w-0 flex-1"><span className="font-semibold text-fg">All Projects</span> · aggregate view, read-only. Select a project to run operations or open sessions.</span>
        <Button size="sm" variant="secondary" onClick={openSwitcher}>Select Project</Button>
      </div>
    )
  }
  return <ProjectHeader project={project} />
}

function opRuntime(db: any, pid: string) {
  const ops = (db.operations as any[]).filter((o) => o.projectId === pid)
  const o = ops.find((x) => ['running', 'paused', 'estop'].includes(x.status))
  if (!o) return null
  const review = o.steps.some((x: any) => x.status === 'review')
  const done = o.steps.filter((x: any) => ['ok', 'done'].includes(x.status)).length
  const text = o.status === 'estop' ? 'Emergency stopped' : o.status === 'paused' ? 'Paused' : review ? 'Paused — Awaiting Review' : `Running ${done}/${o.steps.length} steps`
  const tone = o.status === 'estop' ? 'bad' : o.status === 'paused' || review ? 'warn' : 'cyan'
  return { id: o.id as string, text, tone }
}

function ProjectHeader({ project }: { project: NonNullable<ReturnType<typeof useS>['project']> }) {
  const { db, go, can, setFilter, me } = useS()
  const [esOpen, setEsOpen] = useState(false)
  const [det, setDet] = useState(false)
  const [ct, setCt] = useState(false)
  const running = db.operations.filter((o) => o.projectId === project.id && o.status === 'running').length
  const stoppable = db.operations.filter((o) => o.projectId === project.id && ['running', 'paused'].includes(o.status)).length
  const inScope = db.assets.filter((a) => a.projectId === project.id && a.scope === 'in').length
  const rt = opRuntime(db, project.id)
  const stopBusy = !!(db as any).stopState && ['requested', 'acknowledged', 'stopping', 'unknown', 'failed'].includes((db as any).stopState.phase)
  const allowed = (can as any)('estop')
  const stopWhy = !allowed ? 'Your role cannot trigger an Emergency Stop. Ask a Manager or Admin.' : stopBusy ? 'An Emergency Stop is already in progress. See the banner below.' : stoppable === 0 ? 'No running operations to stop in this project.' : ''
  const roe = project.roeStatus === 'approved' ? 'Approved' : project.roeStatus === 'none' ? 'Missing' : project.roeStatus.charAt(0).toUpperCase() + project.roeStatus.slice(1)
  const chip = 'inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs hover:bg-hover'
  const goRunning = () => { setFilter('operations.status', 'running'); setDet(false); go('operations') }
  const goInScope = () => { setFilter('assets.scope', 'in'); setDet(false); go('assets') }
  const goRt = () => { setDet(false); if (rt) go('operation', { id: rt.id }) }
  const canContact = (can as any)('viewSensitive')
  const rtChip = rt && <button className={cx(chip, 'border font-medium', TONE_CLS[rt.tone])} onClick={goRt} title={`Operation runtime state: ${rt.id} · ${rt.text}`}><Clock size={12} aria-hidden /><span className="font-mono">{rt.id}</span> · {rt.text}</button>
  return (
    <>
      <div className="sticky top-16 z-20 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-line bg-panel px-4 py-1.5 text-xs text-muted lg:px-8">
        {/* Main */}
        <div className="flex min-w-0 flex-wrap items-center gap-2" role="group" aria-label="Project">
          <button onClick={() => go('project', { id: project.id, tab: 'overview' })} title={`${project.id} — ${project.name}. Open project overview`} className="max-w-[min(420px,50vw)] truncate rounded-md text-left text-[13px] font-semibold text-fg hover:text-accent hover:underline"><span className="font-mono">{project.id}</span> — {project.name}</button>
          <Status kind="project" value={project.status} size="sm" />
          <button className={cx(chip, 'border border-line text-fg')} onClick={() => go('project', { id: project.id, tab: 'scope' })} title="Open Scope & ROE"><span className="text-muted">ROE</span> <span className="font-mono">{project.roeVersion.replace(/^.*-(v\d+)$/, '$1')}</span> · {roe}</button>
          <EligBadge pid={project.id} />
        </div>
        {/* Activity (wide screens only; otherwise inside Project details) */}
        <div className="hidden items-center gap-1 min-[1500px]:flex" role="group" aria-label="Activity">
          <button className={cx(chip, running ? 'text-cyan' : '')} onClick={goRunning} title="Open Operations filtered to running"><span className="font-semibold tnum">{running}</span> Running Op{running === 1 ? '' : 's'}</button>
          <button className={chip} onClick={goInScope} title="Open Assets filtered to Approved In Scope"><span className="font-semibold tnum">{inScope}</span> In-Scope Assets</button>
          {rtChip}
        </div>
        {/* Details + Safety */}
        <div className="ml-auto flex shrink-0 items-center gap-2" role="group" aria-label="Safety">
          <span className="relative">
            <button onClick={() => setDet(!det)} aria-haspopup="dialog" aria-expanded={det} className={cx(chip, 'border border-line text-fg')}><MoreHorizontal size={14} aria-hidden />Project details</button>
            <Pop open={det} onClose={() => setDet(false)} label="Project details" align="right" width={380}>
              <div className="mb-2 text-sm font-semibold">{project.id} — {project.name}</div>
              <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-1.5 text-xs">
                <dt className="text-muted">Client</dt><dd>{project.client}</dd>
                <dt className="text-muted">Owner</dt><dd>{project.owner}</dd>
                <dt className="text-muted">Type</dt><dd>{project.type}</dd>
                <dt className="text-muted">Period</dt><dd>{project.start} – {project.end} (UTC+7)</dd>
                <dt className="text-muted">ROE</dt><dd>{project.roeVersion} · {roe}</dd>
              </dl>
              <div className="mt-3 flex flex-col gap-1 border-t border-line pt-2 min-[1500px]:hidden">
                <div className="text-xs font-semibold uppercase tracking-wider text-neutral">Activity</div>
                <button className="flex h-9 items-center justify-between rounded-lg px-2 text-left text-sm hover:bg-hover" onClick={goRunning}>Running Operations<span className="font-semibold tnum">{running}</span></button>
                <button className="flex h-9 items-center justify-between rounded-lg px-2 text-left text-sm hover:bg-hover" onClick={goInScope}>In-Scope Assets<span className="font-semibold tnum">{inScope}</span></button>
                {rt ? <button className="flex h-9 items-center justify-between gap-2 rounded-lg px-2 text-left text-sm hover:bg-hover" onClick={goRt}>Operation runtime<span className="truncate text-xs"><span className="font-mono">{rt.id}</span> · {rt.text}</span></button> : <div className="px-2 text-xs text-muted">No operation is running.</div>}
              </div>
              <div className="mt-3 flex gap-2 border-t border-line pt-3"><Button size="sm" variant="secondary" onClick={() => { setDet(false); go('project', { id: project.id, tab: 'overview' }) }}>Project overview</Button><Button size="sm" variant="secondary" onClick={() => { setDet(false); go('project', { id: project.id, tab: 'scope' }) }}>Scope &amp; ROE</Button></div>
            </Pop>
          </span>
          <span className="relative">
            <button onClick={() => setCt(!ct)} aria-haspopup="dialog" aria-expanded={ct} aria-label={`Emergency contact: ${project.emergency ? 'set' : 'not set'}`} className={cx(chip, 'border text-fg', project.emergency ? 'border-line' : 'border-warn/30 bg-warn-soft text-warn')}>
              <Phone size={13} aria-hidden /><span className="max-2xl:hidden">Emergency contact{project.emergency ? '' : ': not set'}</span><span className="2xl:hidden">Contact</span>
            </button>
            <Pop open={ct} onClose={() => setCt(false)} label="Emergency contact" align="right" width={320}>
              <div className="mb-1 text-sm font-semibold">Emergency contact · {project.id}</div>
              {!canContact ? <p className="text-xs text-muted">Contact details are restricted for your role ({ROLE_LABEL[me.role]}). Ask a project manager.</p>
                : project.emergency ? <><p className="font-medium">{project.emergency}</p><p className="mt-1 text-xs text-muted">Use this contact if an Emergency Stop is not acknowledged. Demo data, not a real number.</p></>
                : <><p className="text-xs text-muted">No emergency contact is set. Execution stays locked until one is added.</p><Button size="sm" className="mt-2" onClick={() => { setCt(false); go('project', { id: project.id, tab: 'scope' }) }}>Set in Scope &amp; ROE</Button></>}
            </Pop>
          </span>
          <Button size="sm" variant="destructive" icon={OctagonX} disabled={!!stopWhy} title={stopWhy || 'Open Emergency Stop confirmation'} onClick={() => setEsOpen(true)}>Emergency Stop</Button>
        </div>
      </div>
      <EmergencyStop open={esOpen} onClose={() => setEsOpen(false)} />
    </>
  )
}

/* ───────────── Global modals ───────────── */
function GlobalModals() {
  const { confirmState, closeConfirm, unsaved, closeUnsaved, toast } = useS()
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => { setReason(''); setErr('') }, [confirmState])
  return (
    <>
      <Modal
        open={!!confirmState} onClose={closeConfirm} title={confirmState?.title} danger={confirmState?.danger}
        footer={confirmState && (
          <>
            <Button variant="ghost" onClick={closeConfirm}>{confirmState.cancelLabel || 'Cancel'}</Button>
            <Button variant={confirmState.danger ? 'destructive' : 'primary'} onClick={() => {
              if (confirmState.reasonRequired && reason.trim().length < 5) { setErr('Please enter a reason (at least 5 characters). It will be recorded in the audit log.'); return }
              const f = confirmState.onConfirm; closeConfirm(); f(reason.trim())
            }}>{confirmState.confirmLabel}</Button>
          </>
        )}
      >
        {confirmState && (
          <div className="space-y-4">
            <div className="text-muted">{confirmState.body}</div>
            {confirmState.reasonLabel && <Field label={confirmState.reasonLabel} required={confirmState.reasonRequired} error={err}><Textarea value={reason} onChange={(e) => { setReason(e.target.value); setErr('') }} autoFocus placeholder="Enter a reason…" /></Field>}
            <p className="text-xs text-neutral">This action is recorded in the audit log.</p>
          </div>
        )}
      </Modal>
      <Modal
        open={!!unsaved} onClose={closeUnsaved} title="Unsaved changes"
        footer={unsaved && (
          <>
            <Button variant="ghost" onClick={closeUnsaved}>Stay</Button>
            <Button variant="danger" onClick={() => { const n = unsaved.next; closeUnsaved(); n() }}>Discard &amp; Leave</Button>
            <Button variant="primary" onClick={() => { const u = unsaved; closeUnsaved(); u.save?.(); toast('Draft saved.'); u.next() }}>Save Draft</Button>
          </>
        )}
      >
        <p className="text-muted">You have unsaved changes in this form. If you leave now, they will be lost.</p>
      </Modal>
    </>
  )
}
function Toasts() {
  const { toasts } = useS()
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={cx('pointer-events-auto flex items-start gap-2 rounded-xl border bg-panel px-4 py-3 text-sm shadow-xl', { ok: 'border-ok/50', warn: 'border-warn/50', bad: 'border-bad/50', info: 'border-cyan/50' }[t.kind])}>
          <span className={cx('mt-0.5 font-semibold', { ok: 'text-ok', warn: 'text-warn', bad: 'text-bad', info: 'text-cyan' }[t.kind])} aria-hidden>{t.kind === 'ok' ? '✓' : t.kind === 'info' ? 'ℹ' : '!'}</span>{t.text}
        </div>
      ))}
    </div>
  )
}

/* ───────────── Shell ───────────── */
export function Shell({ children }: { children: ReactNode }) {
  const s = useS()
  const { project, loading, me, go, route, copilotOpen, setNoticesOpen, setSwitcherOpen } = s
  const [collapsed, setCollapsed] = useState(false)
  const [mobile, setMobile] = useState(false)
  useEffect(() => { document.title = 'Raptix — AI Red Team Platform' }, [])
  useEffect(() => { if (copilotOpen) setNoticesOpen(false) }, [copilotOpen, setNoticesOpen])
  const wide = isWide(route)
  return (
    <div className="flex h-full bg-bg text-fg">
      <a href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus() }} className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[200] focus:rounded-[10px] focus:bg-accent focus:px-4 focus:py-2 focus:text-white">Skip to main content</a>
      <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} mobileOpen={mobile} closeMobile={() => setMobile(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar openMobile={() => setMobile(true)} />
        <ContextRibbon openSwitcher={() => setSwitcherOpen(true)} />
        <StopBanner />
        {project && (project.status === 'closed' || project.status === 'cancelled') && (
          <div className="px-4 pt-4 lg:px-8">
            <Banner tone="warn" icon={Lock} title={`Project ${project.id} is ${project.status === 'closed' ? 'closed' : 'cancelled'} — read-only`} action={me.role === 'admin' ? <Button size="sm" onClick={() => go('project', { id: project.id, tab: 'overview' })}>Reopen project</Button> : undefined}>
              Operations, scope edits and finding changes are disabled. Data and reports remain viewable.
            </Banner>
          </div>
        )}
        <main id="main" data-wide={wide ? '' : undefined} className={cx('no-scrollbar min-h-0 flex-1 overflow-y-auto', wide ? 'p-0' : 'px-5 py-6 lg:px-8')} tabIndex={-1}>
          <div className={wide ? 'h-full' : 'mx-auto max-w-[1360px]'}>{loading ? <LoadingState /> : children}</div>
        </main>
      </div>
      <CopilotDrawer />
      <GlobalModals />
      <Toasts />
      <DemoGuide />
    </div>
  )
}
function LoadingState() {
  return (
    <div aria-busy="true" role="status" className="animate-pulse">
      <div className="mb-3 h-7 w-64 rounded bg-hover" /><div className="mb-8 h-4 w-96 max-w-full rounded bg-hover" />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-24 rounded-xl bg-hover" />)}</div>
      <div className="h-72 rounded-xl bg-hover" />
      <span className="sr-only">Switching project context…</span>
    </div>
  )
}
export type { Route }
export { Tabs, Segmented, Activity, ShieldAlert }
