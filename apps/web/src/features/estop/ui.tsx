/**
 * Emergency-stop machine UI (ticket 28, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * The machine's surfaces — request dialog, phase banner, progress strip —
 * live feature-side and every transition runs the typed handlers
 * (src/features/estop/service.ts) against the one authority: the request via
 * the demo runtime's orchestration entry (the engine the legacy store action
 * delegates to — one bridge for both entry points), the
 * acknowledge/finalize/resolve controls directly through `useServices`. Every
 * phase renders an actionable control (invariant 1: a stop is ALWAYS an action
 * with an immediate visible response, never a passive status), state-changing
 * controls are role-gated with a visible reason, and the demo outcome switch
 * stays the SIMULATED orchestration — the "(demo)" affordances run the same
 * typed handlers the delayed orchestration runs, so no surface can show a
 * success that did not happen through a committed transaction.
 */
import { useState } from 'react'
import { CheckCircle2, CircleDot, Clock, OctagonX, XCircle } from 'lucide-react'
import { Banner, Button, Check, DemoTag, Field, Gated, Modal, Select, Textarea, cx } from '../../ui/index'
import { useServices } from '../../state/services'
import { useCan, useMe } from '../../state/console'
import { useStopRead } from './projection'
import { useToastStore } from '../../state/stores'
import { useSessionStore } from '../../state/session'
import { go } from '../../router/navigate'
import { emergencyStop, retryStop } from '../demo/runtime'
import type { Operation } from '../../data'
import type { StopState } from '../../domain/entities'
import { acknowledgeEmergencyStopTransaction, finalizeEmergencyStopTransaction, resolveStopTransaction, type StopResolution } from './service'

type Phase = StopState['phase']

/** Machine derivation shared by the banner and the progress strip: the stop state applies only inside its scope. */
function useStopMachine(op: Operation) {
  const db = useStopRead(op.projectId)
  const ss = db.stopState
  const mine = !!ss && (ss.scope === 'workspace' || (ss.scope === 'project' && ss.id === op.projectId) || (ss.scope === 'operation' && ss.id === op.id))
  return { ss: mine ? ss : null, phase: (mine ? ss!.phase : 'stopped') as Phase }
}

const stepsOf = (op: Operation) => ({
  running: op.steps.filter((s) => s.status === 'running').length,
  queued: op.steps.filter((s) => s.status === 'pending' || s.status === 'review').length,
})

/* ───────────── Stop progress: requested → acknowledged → stopped ───────────── */
export function StopProgress({ op }: { op: Operation }) {
  const db = useStopRead(op.projectId)
  const { phase } = useStopMachine(op)
  const sessions = db.sessions.filter((s) => s.opId === op.id)
  const stage = (label: string, state: 'done' | 'active' | 'todo') => (
    <li className={cx('inline-flex items-center gap-1.5 text-xs font-medium', state === 'todo' ? 'text-neutral' : state === 'active' ? 'text-warn' : 'text-fg')}>
      {state === 'done' ? <CheckCircle2 size={14} className="text-ok" aria-hidden /> : state === 'active' ? <Clock size={14} aria-hidden /> : <CircleDot size={14} aria-hidden />}{label}
    </li>
  )
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
      <ol className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-label="Stop progress">
        {stage('Stop requested', 'done')}<span className="text-neutral" aria-hidden>→</span>
        {stage('Acknowledged — revoking', phase === 'acknowledged' ? 'active' : 'done')}<span className="text-neutral" aria-hidden>→</span>
        {stage('Stopped', phase === 'acknowledged' ? 'todo' : 'done')}
      </ol>
      {sessions.length > 0 && <span className="text-xs text-muted">Linked sessions: {sessions.map((s) => `${s.id} ${s.state === 'terminated' ? 'terminated' : s.state === 'revoking' ? 'revoking access' : s.state}`).join(', ')}</span>}
    </div>
  )
}

/* ───────────── Emergency Stop request dialog (OP-V3-07) ───────────── */
export function EmergencyStopDialog({ op, open, onClose }: { op: Operation; open: boolean; onClose: () => void }) {
  const db = useStopRead(op.projectId)
  const can = useCan()
  const toast = useToastStore((s) => s.toast)
  const allowed = can('estop', op.projectId)
  const [scope, setScope] = useState<'operation' | 'project'>('operation')
  const [reason, setReason] = useState('')
  const [ack, setAck] = useState(false)
  const [err, setErr] = useState('')
  const sessions = db.sessions.filter((s) => (scope === 'project' ? s.projectId === op.projectId : s.opId === op.id) && ['connected', 'available', 'awaiting', 'suspended'].includes(s.state))
  const ops = db.operations.filter((o) => o.projectId === op.projectId && ['running', 'paused'].includes(o.status))
  const affected = scope === 'project' ? ops : [op]
  const c = stepsOf(op)
  const ready = allowed && reason.trim().length > 0 && ack
  const why = !allowed ? 'Your role cannot trigger an Emergency Stop. Ask a Manager or Admin.' : !reason.trim() ? 'Enter a reason.' : !ack ? 'Acknowledge the impact first.' : ''
  const close = () => { setReason(''); setAck(false); setErr(''); onClose() }
  const submit = () => {
    if (!ready) { setErr(why); return }
    /* The typed request handler runs inside the demo runtime's orchestration
       entry (the one the store action delegates to), so the gates hold there
       and a refusal commits nothing — same handler the shell ribbon's stop
       uses. */
    emergencyStop(scope, scope === 'project' ? op.projectId : op.id, reason.trim())
    toast('Emergency stop requested. Waiting for agents to acknowledge — the operation is not stopped yet.', 'warn')
    close()
  }
  return (
    <Modal open={open} onClose={close} danger title="Emergency Stop" footer={<>
      <Button onClick={close}>Cancel</Button>
      <Button variant="dangerSolid" icon={OctagonX} disabled={!ready} title={ready ? undefined : why} onClick={submit}>Request Emergency Stop</Button>
    </>}>
      <div className="space-y-4 text-sm">
        <fieldset>
          <legend className="mb-1.5 text-xs font-medium text-muted">Scope</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {([['operation', `This operation only (${op.id})`], ['project', `Whole project (${op.projectId})`]] as const).map(([v, l]) => (
              <label key={v} className={cx('flex cursor-pointer items-start gap-2 rounded-lg border p-3', scope === v ? 'border-accent bg-accent-soft' : 'border-line')}>
                <input type="radio" name="estop-scope" checked={scope === v} onChange={() => setScope(v)} className="mt-0.5 accent-[var(--c-accent)]" /><span>{l}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="rounded-lg border border-bad/30 bg-bad-soft p-3">
          <div className="mb-1 font-medium text-bad">Impact</div>
          <ul className="list-disc space-y-0.5 pl-5 text-fg">
            <li>{affected.length} active operation(s): {affected.map((o) => o.id).join(', ') || '—'}</li>
            <li>{c.running} running and {c.queued} queued step(s) here; running steps become Unknown</li>
            <li>{sessions.length} linked session(s) are revoked and terminated</li>
            <li>The operation does not restart automatically</li>
          </ul>
        </div>
        <Field label="Reason" required error={err || undefined}><Textarea value={reason} onChange={(e) => { setReason(e.target.value); setErr('') }} rows={3} placeholder="Why is an emergency stop needed?" /></Field>
        <Check checked={ack} onChange={(v) => { setAck(v); setErr('') }} label="I understand the impact. Status stays “Requested” until agents acknowledge." />
        {!ready && <p className="text-xs text-warn">Request is disabled: {why}</p>}
        <p className="flex items-center gap-2 text-xs text-muted"><DemoTag />Prototype only. This simulates a stop request; no real system is affected.</p>
      </div>
    </Modal>
  )
}

/* ───────────── Stop state banner: every phase renders an actionable control ───────────── */
export function StopStatePanel({ op }: { op: Operation }) {
  const me = useMe()
  const can = useCan()
  const toast = useToastStore((s) => s.toast)
  const stopOutcome = useSessionStore((s) => s.stopOutcome)
  const setStopOutcome = useSessionStore((s) => s.setStopOutcome)
  const svc = useServices()
  const { ss } = useStopMachine(op)
  if (!ss) return null
  const ph = ss.phase as Phase
  const allowed = can('estop', op.projectId)
  const stopWhy = 'Only a Red Team Manager or Admin can drive an Emergency Stop.'
  /* User-driven transitions run the typed handlers directly through the one
     authority (the same ones the store's simulated orchestration schedules);
     a handler refusal is surfaced, never papered over. */
  const ctx = { actor: { id: me.name, role: me.role }, projectId: op.projectId, corr: 'estop-ui' }
  const acknowledgeNow = () => {
    setStopOutcome('ack')
    const res = acknowledgeEmergencyStopTransaction(svc.authority, svc.clock, ctx, { scope: ss.scope, id: ss.id, reason: ss.reason })
    if (res.ok) toast('Agents acknowledged (demo) — linked sessions are revoking.', 'warn')
  }
  const finalizeNow = () => {
    const res = finalizeEmergencyStopTransaction(svc.authority, svc.clock, ctx, { scope: ss.scope, id: ss.id })
    if (res.ok) toast('Stop finalized (demo) — sessions terminated, agents released.')
  }
  const resolve = (outcome: StopResolution) => {
    const res = resolveStopTransaction(svc.authority, svc.clock, { ...ctx, projectId: '' }, outcome)
    if (res.ok && outcome === 'confirmed-stopped') toast('Marked as manually confirmed stopped.')
  }
  const steps: [string, string][] = [['requested', 'Requested'], ['acknowledged', 'Acknowledged'], ['stopped', 'Stopped']]
  const idx = ph === 'stopped' ? 2 : ph === 'acknowledged' ? 1 : 0
  const bad = ph === 'failed' || ph === 'unknown'
  const msg = ph === 'requested' ? 'Waiting for agents to acknowledge. The operation is still shown as active until they do.'
    : ph === 'acknowledged' ? 'Agents acknowledged the stop and are halting. Final confirmation is pending.'
    : ph === 'stopped' ? 'Stop confirmed. Running steps are marked Unknown until verified.'
    : ph === 'failed' ? 'No acknowledgement was received. The operation may still be running. Retry the stop or contact the emergency contact.'
    : 'Acknowledgement timed out and the real state is unknown. Verify manually before treating the operation as stopped.'
  return (
    <Banner tone={bad ? 'bad' : ph === 'stopped' ? 'info' : 'warn'} icon={OctagonX} title={`Emergency stop (${ss.scope}) — ${ph === 'failed' ? 'Failed' : ph === 'unknown' ? 'Unknown' : steps[idx][1]}`}>
      <div>By {ss.by} at {ss.at}. Reason: {ss.reason}</div>
      <ol className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium" aria-label="Emergency stop status">
        {steps.map(([k, l], i) => <li key={k} className={cx('inline-flex items-center gap-1.5', i <= idx && !bad ? 'text-fg' : 'text-neutral')}>{i < idx || (i === idx && ph === 'stopped') ? <CheckCircle2 size={14} className="text-ok" aria-hidden /> : <CircleDot size={14} aria-hidden />}{l}{i < 2 && <span aria-hidden className="ml-2 text-neutral">→</span>}</li>)}
        {bad && <li className="inline-flex items-center gap-1.5 text-bad"><XCircle size={14} aria-hidden />{ph === 'failed' ? 'Failed' : 'Unknown'}</li>}
      </ol>
      <p className="mt-2">{msg}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {ph === 'requested' && <Gated allowed={allowed} reason={stopWhy}><Button size="sm" variant="danger" onClick={acknowledgeNow}>Acknowledge now (demo)</Button></Gated>}
        {ph === 'acknowledged' && <Gated allowed={allowed} reason={stopWhy}><Button size="sm" onClick={finalizeNow}>Finalize now (demo)</Button></Gated>}
        {ph === 'failed' && <Gated allowed={allowed} reason={stopWhy}><Button size="sm" variant="danger" onClick={() => { retryStop(); toast('Retrying emergency stop…', 'warn') }}>Retry Stop</Button></Gated>}
        {ph === 'unknown' && <Gated allowed={allowed} reason={stopWhy}><Button size="sm" onClick={() => resolve('confirmed-stopped')}>Confirm Manually Stopped</Button></Gated>}
        {(bad || ph === 'stopped') && <Button size="sm" variant="ghost" onClick={() => resolve('dismiss')}>Dismiss</Button>}
        <Button size="sm" variant="ghost" onClick={() => go('settings', { tab: 'audit' })}>Open Audit Log</Button>
        <label className="ml-auto flex items-center gap-2 text-xs text-muted"><DemoTag />Demo outcome of next stop<Select value={stopOutcome} onChange={(e) => setStopOutcome(e.target.value as 'ack' | 'fail' | 'unknown')} aria-label="Demo outcome of the next emergency stop" className="!h-8 w-36"><option value="ack">Acknowledged</option><option value="fail">Failed</option><option value="unknown">Unknown</option></Select></label>
      </div>
    </Banner>
  )
}
