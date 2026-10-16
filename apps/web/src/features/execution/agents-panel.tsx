import { useState, type ReactElement } from 'react'
import { Bot, ChevronDown, ChevronRight, CircleHelp, GitBranch, Hand, Radio, ShieldAlert } from 'lucide-react'
import { Button, DescList, Textarea, cx } from '../../ui'
import type { AgentInstance, AgentWorkspace, InstanceAction, InstanceStatus } from './model'

const LABEL: Record<InstanceStatus, string> = { queued: 'Queued', running: 'Running', waiting: 'Waiting for you', blocked: 'Blocked', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled', paused: 'Paused', unknown: 'Unknown' }
const TONE: Record<InstanceStatus, string> = { queued: 'text-muted', running: 'text-cyan', waiting: 'text-warn', blocked: 'text-warn', completed: 'text-ok', failed: 'text-bad', cancelled: 'text-muted', paused: 'text-warn', unknown: 'text-muted' }

export function InstanceBadge({ instance, waiting }: { instance: AgentInstance; waiting: boolean }): ReactElement {
  const Icon = waiting ? Hand : instance.status === 'running' ? Radio : instance.status === 'blocked' ? ShieldAlert : CircleHelp
  return <span className={cx('inline-flex items-center gap-1 text-[11px] font-medium', TONE[instance.status])}><Icon size={12} />{instance.status === 'waiting' && !waiting ? 'Waiting · no pending question' : LABEL[instance.status]}</span>
}

export function AgentsPanel({ workspace, selected, onSelect, onControl, writable }: { workspace: AgentWorkspace; selected: AgentInstance; onSelect: (id: string) => void; onControl: (action: InstanceAction, reason: string) => void; writable: boolean }): ReactElement {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [attentionOnly, setAttentionOnly] = useState(false)
  const [pendingAction, setPendingAction] = useState<{ action: InstanceAction; instanceId: string } | null>(null)
  const action = pendingAction?.instanceId === selected.id ? pendingAction.action : null
  const setAction = (value: InstanceAction | null): void => { setPendingAction(value ? { action: value, instanceId: selected.id } : null); setReason('') }
  const [reason, setReason] = useState('')
  const waiting = (id: string): boolean => workspace.questions.some((question) => question.instanceId === id && question.answer === undefined)
  const attentionAncestors = new Set<string>()
  for (const question of workspace.questions.filter((question) => question.answer === undefined)) {
    let id: string | null = question.instanceId
    while (id && !attentionAncestors.has(id)) { attentionAncestors.add(id); id = workspace.instances.find((instance) => instance.id === id)?.parent ?? null }
  }
  const root = workspace.instances.find((instance) => instance.role === 'Orchestrator')
  const pending = workspace.requests.some((request) => request.instanceId === selected.id && ['pending', 'uncertain'].includes(request.state))
  const dependents = workspace.instances.filter((instance) => instance.parent === selected.id || instance.deps.includes(selected.id))
  const allowed = selected.controls.filter((control) => control === 'pause' ? selected.status === 'running' : control === 'resume' ? selected.status === 'paused' : control === 'cancel' ? ['running', 'waiting', 'queued', 'blocked', 'paused'].includes(selected.status) : ['failed', 'cancelled', 'completed'].includes(selected.status))
  const row = (instance: AgentInstance, depth: number, visited: Set<string>): ReactElement | null => {
    if (visited.has(instance.id)) return null
    const next = new Set(visited).add(instance.id)
    const children = workspace.instances.filter((child) => child.parent === instance.id)
    if (attentionOnly && !attentionAncestors.has(instance.id) && instance.id !== root?.id) return null
    return <li key={instance.id}>
      <div className="flex items-start gap-1" style={{ paddingLeft: Math.min(depth, 4) * 12 }}>
        {children.length > 0 && <button className="mt-3 rounded p-1 text-muted hover:bg-hover" aria-label={`${collapsed.has(instance.id) ? 'Expand' : 'Collapse'} ${instance.name}`} onClick={() => setCollapsed((previous) => { const nextSet = new Set(previous); if (!nextSet.delete(instance.id)) nextSet.add(instance.id); return nextSet })}>{collapsed.has(instance.id) ? <ChevronRight size={13} /> : <ChevronDown size={13} />}</button>}
        <button onClick={() => { setAction(null); setReason(''); onSelect(instance.id) }} aria-pressed={selected.id === instance.id} aria-label={`Select ${instance.name}`} className={cx('min-w-0 flex-1 rounded-xl border p-3 text-left transition hover:bg-hover', selected.id === instance.id ? 'border-accent-line bg-accent-soft/40' : waiting(instance.id) ? 'border-warn/40 bg-warn-soft/30' : 'border-transparent')}>
          <div className="flex flex-wrap items-center justify-between gap-1"><span className="flex items-center gap-1.5 text-sm font-semibold"><Bot size={15} />{instance.name}</span><InstanceBadge instance={instance} waiting={waiting(instance.id)} /></div>
          <p className="mt-1 line-clamp-2 text-xs text-muted">{instance.objective}</p><p className="mt-1 truncate text-[11px] text-muted">{instance.activity}</p><p className="mt-1 text-[10px] text-neutral">{instance.updated}</p>
        </button>
      </div>
      {!collapsed.has(instance.id) && children.length > 0 && <ul className="space-y-1">{children.map((child) => row(child, depth + 1, next))}</ul>}
    </li>
  }
  return <div className="space-y-4 p-3">
    <div className="flex items-center justify-between gap-2"><span className="text-xs font-medium">{workspace.instances.length} recorded instances</span><button onClick={() => { setAttentionOnly(!attentionOnly); setCollapsed(new Set()) }} aria-pressed={attentionOnly} className="rounded-md border border-warn/30 px-2 py-1 text-xs text-warn">Needs you ({workspace.questions.filter((question) => question.answer === undefined).length})</button></div>
    <ul aria-label="Agent instances" className="max-h-[40vh] space-y-1 overflow-y-auto pr-1">{workspace.instances.filter((instance) => !instance.parent || !workspace.instances.some((parent) => parent.id === instance.parent)).map((instance) => row(instance, 0, new Set()))}</ul>
    <section key={selected.id} className="space-y-3 rounded-xl border border-line p-3" aria-label={`Details for ${selected.name}`}>
      <h3 className="flex items-center gap-2 text-sm font-semibold"><GitBranch size={15} />{selected.name} · details</h3>
      {selected.stale && <p className="text-xs text-warn">Observation stale. No terminal outcome can be inferred.</p>}
      <DescList cols={1} items={[{ k: 'Objective', v: selected.objective }, { k: 'Target / scope', v: selected.target }, { k: 'Spawn parent', v: workspace.instances.find((instance) => instance.id === selected.parent)?.name ?? (selected.role === 'Orchestrator' ? 'Root orchestrator' : 'Unknown') }, { k: 'Dependencies', v: selected.deps.length ? selected.deps.map((id) => { const dependency = workspace.instances.find((instance) => instance.id === id); return dependency ? `${dependency.name} (${dependency.status})` : `${id} (missing)` }).join(', ') : 'None recorded' }, { k: 'Inputs', v: selected.inputs.join(', ') }, { k: 'Outputs', v: selected.outputs.join(', ') || 'None recorded' }]} />
      <details><summary className="cursor-pointer text-xs text-muted">Identity & raw status</summary><p className="mt-2 break-all font-mono text-[11px]">{selected.id} · {workspace.executionId} · {selected.status}{selected.previous && ` · Previous attempt ${selected.previous}`}</p></details>
      <div className="border-t border-line pt-3"><h4 className="mb-2 text-xs font-semibold">Instance controls · simulated</h4><p className="mb-2 text-xs text-muted">Separate from chat. Cancel affects this task only; child and dependency outcomes are not implied.</p>
        <div className="flex flex-wrap gap-2">{allowed.map((control) => <Button key={control} size="sm" disabled={!writable || pending} onClick={() => setAction(control)}>{control[0].toUpperCase() + control.slice(1)}</Button>)}</div>
        {!allowed.length && <p className="text-xs text-muted">No supported controls in this state.</p>}
        {action && <div className="mt-3 space-y-2 rounded-lg border border-warn/40 p-3"><p className="text-xs font-medium">{action} {selected.name}?</p><p className="text-xs text-muted">Known children/dependents: {dependents.map((instance) => instance.name).join(', ') || 'none recorded'}. {['retry', 'reassign'].includes(action) && 'Creates a new linked attempt; the old record is preserved.'}</p><Textarea aria-label="Control reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason for this action" /><div className="flex gap-2"><Button size="sm" disabled={!reason.trim() || !writable || pending} onClick={() => { onControl(action, reason); setAction(null); setReason('') }}>Confirm {action}</Button><Button size="sm" variant="ghost" onClick={() => setAction(null)}>Dismiss</Button></div></div>}
      </div>
    </section>
  </div>
}
