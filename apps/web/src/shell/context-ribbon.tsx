/**
 * Project context ribbon and emergency stop controls (ticket 08d, extracted
 * from the shell monolith; reworked by plan 2026-10-16 §3.1): the slim
 * ribbon variants for the draft/settings/aggregate contexts remain, while the
 * per-project identity bar is gone — project identity lives in the sidebar
 * header and the Emergency Stop control moved to the shared topbar
 * (`ProjectStopControl`). The Emergency Stop confirmation modal, the
 * stop-phase banner and their gating/validation are unchanged.
 */
import { useEffect, useState } from 'react'
import {
  AlertTriangle, FolderKanban, Layers, Loader2, OctagonX, RotateCcw, Settings, type LucideIcon,
} from 'lucide-react'
import { go, useRoute } from '../router/navigate'
import { useActiveProject, useCan, useMe } from '../state/console'
import { useStopRead } from '../features/estop/projection'
import { useProjectActivity } from '../features/projects/activity-read'
import { useProjectStore } from '../state/stores'
import { emergencyStop, resolveStop, retryStop } from '../features/demo/runtime'
import { Banner, Button, Check, Field, Modal, Textarea, cx } from '../ui/index'

function EmergencyStop({ open, onClose }: { open: boolean; onClose: () => void }) {
  const db = useStopRead('all')
  const project = useActiveProject()
  const me = useMe()
  const [scope, setScope] = useState<'project' | 'workspace'>('project')
  const [reason, setReason] = useState('')
  const [ack, setAck] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { if (open) { setScope('project'); setReason(''); setAck(false); setErr('') } }, [open])
  if (!project) return null
  const running = db.operations.filter((o) => (scope === 'workspace' || o.projectId === project.id) && ['running', 'paused'].includes(o.status))
  const live = db.sessions.filter((x) => (scope === 'workspace' || x.projectId === project.id) && ['connected', 'awaiting'].includes(x.state))
  const submit = () => {
    if (reason.trim().length < 5) { setErr('A reason is required (at least 5 characters). It is recorded in the audit log.'); return }
    if (!ack) { setErr('Confirm that you understand the impact.'); return }
    emergencyStop(scope, scope === 'workspace' ? 'workspace' : project.id, reason.trim())
    onClose()
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

export function StopBanner() {
  const db = useStopRead('all')
  const pid = useProjectStore((s) => s.pid)
  const st = db.stopState
  if (!st) return null
  const opProj = st.scope === 'operation' ? db.operations.find((o) => o.id === st.id)?.projectId : ''
  const relevant = pid === 'all' || st.scope === 'workspace' || (st.scope === 'project' && st.id === pid) || opProj === pid
  if (!relevant) return null
  const target = st.scope === 'workspace' ? 'the entire workspace' : `${st.scope} ${st.id}`
  const audit = <Button size="sm" onClick={() => go('settings', { tab: 'audit' })}>View audit log</Button>
  const dismiss = <Button size="sm" variant="ghost" onClick={() => resolveStop('dismiss')}>Dismiss</Button>
  const m = {
    requested: { tone: 'warn', icon: Loader2, title: 'Emergency Stop requested — waiting for agent acknowledgement', body: `Nothing has stopped yet. Waiting for agents to confirm halt for ${target}. Do not treat activity as stopped until acknowledged.`, action: audit },
    acknowledged: { tone: 'info', icon: Loader2, title: 'Emergency Stop acknowledged — revoking sessions', body: `Agents confirmed halt for ${target}. Live sessions are being revoked.`, action: audit },
    stopping: { tone: 'info', icon: Loader2, title: 'Emergency Stop acknowledged — revoking sessions', body: `Agents confirmed halt for ${target}. Live sessions are being revoked.`, action: audit },
    stopped: { tone: 'ok', icon: OctagonX, title: 'Stopped — acknowledged by agents', body: `Activity for ${target} has stopped and sessions are revoked.`, action: <div className="flex gap-2">{audit}{dismiss}</div> },
    failed: { tone: 'bad', icon: AlertTriangle, title: 'Emergency Stop failed — no acknowledgement received', body: `Activity for ${target} may still be running. Retry the stop or contact the emergency contact now.`, action: <div className="flex gap-2"><Button size="sm" variant="destructive" icon={RotateCcw} onClick={() => retryStop()}>Retry</Button>{audit}{dismiss}</div> },
    unknown: { tone: 'warn', icon: AlertTriangle, title: 'Emergency Stop status unknown — acknowledgement timed out', body: `Cannot confirm that ${target} has halted. Verify out-of-band before confirming.`, action: <div className="flex flex-wrap gap-2"><Button size="sm" variant="primary" onClick={() => resolveStop('confirmed-stopped')}>Confirm stopped manually</Button><Button size="sm" variant="destructive" icon={RotateCcw} onClick={() => retryStop()}>Retry</Button>{dismiss}</div> },
  }[st.phase] as { tone: 'warn' | 'info' | 'ok' | 'bad'; icon: LucideIcon; title: string; body: string; action: React.ReactNode }
  return (
    <div className="px-4 pt-4 lg:px-8">
      <Banner tone={m.tone} icon={m.icon} title={m.title} action={m.action}>{m.body} Requested by {st.by || 'unknown'} at {st.at}. Reason: {st.reason}</Banner>
    </div>
  )
}

/**
 * The header's Emergency Stop control for the active project (plan §3.1):
 * always easy to find, keeps the eligibility/permission gating, the reason
 * requirement and the requested/acknowledged states via the banner below.
 */
export function ProjectStopControl() {
  const project = useActiveProject()
  const can = useCan()
  const activity = useProjectActivity(project?.id ?? '')
  const [esOpen, setEsOpen] = useState(false)
  if (!project) return null
  const allowed = can('estop')
  const stopWhy = !allowed
    ? 'Your role cannot trigger an Emergency Stop. Ask a Manager or Admin.'
    : activity.stopBusy
      ? 'An Emergency Stop is already in progress. See the banner below.'
      : activity.stoppable === 0
        ? 'No running operations to stop in this project.'
        : ''
  return (
    <>
      <Button size="sm" variant="destructive" icon={OctagonX} disabled={!!stopWhy} title={stopWhy || 'Open Emergency Stop confirmation'} onClick={() => setEsOpen(true)}>Emergency Stop</Button>
      <EmergencyStop open={esOpen} onClose={() => setEsOpen(false)} />
    </>
  )
}

export function ContextRibbon({ openSwitcher }: { openSwitcher: () => void }) {
  const project = useActiveProject()
  const route = useRoute()
  const pid = useProjectStore((s) => s.pid)
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
  /* With a project selected there is no separate context bar: identity lives
     in the sidebar header, the stop control in the topbar, eligibility on the
     Overview page and the ROE state in Scope & ROE (plan §3.1). */
  return null
}
