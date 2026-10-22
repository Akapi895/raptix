import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Activity, AlertTriangle, ExternalLink, FolderPlus, Layers, Pencil, Plus, Power, RefreshCw, ShieldAlert, Trash2, UserPlus, Wifi, WifiOff, X, Zap } from 'lucide-react'
import { useServices } from '../../../state/services'
import { USERS } from '../../../domain/catalog';
import { type Agent, type Group } from '../../../domain/entities'
import { replaceOperationAgent } from '../../operations/service'
import { Banner, Button, Card, CardHeader, Check, DescList, Drawer, Empty, Field, FilterBar, IdLink, Input, Kpi, LineChart, Locked, Modal, PageHeader, Pager, SearchBox, Select, Skeleton, Status, Table, Tabs, Textarea, Timeline, useGuard, Mono, cx, PageSkeleton } from '../../../ui/index'
import { Blocked, DTable, hashNum, Id, IdL, MoreFilters, POOL_LABEL, shortDate, Trunc, withLoading } from '../../../ui/d-shared'
import { AgentReadError, useAgentDetail, useAgentList, useAssignAgent, useRemoveFromGroup, useSaveGroup, useUnassignAgent } from '../query'
import type { AgentKpi } from '../service'
import { BRANCH_LABEL } from '../../../domain/catalog';
import { go, selectProject, useRoute } from '../../../router/navigate'
import { useAccessible, useCan, useMe, useScoped } from '../../../state/console'
import { useGroupOptions, useAssignmentOptions, useAgentRecovery } from '../projection'
import { useProjectStore, useToastStore, useUiStore } from '../../../state/stores'
import { useSessionStore } from '../../../state/session'
import { stamp } from '../../../demo/display-clock'
import { recordAudit } from '../../audit/service'
import { loseAgent, restoreAgent } from '../../../demo/runtime'
import { submitApprovalTransaction } from '../../approvals/service'
import { setAgentStatusTransaction } from '../writes'

const POLICIES = ['Project use only', 'Shared with approval', 'Observe only (no execution)']
const STATUS_LABEL: Record<string, string> = { online: 'Connected', idle: 'Idle', lost: 'Disconnected', disabled: 'Disabled', unknown: 'Unknown', unhealthy: 'Unhealthy' }
const ACTIVE_PROJECT = ['active', 'approved']

/* ───────────── Heartbeat bars (simulated) ───────────── */

function Heartbeat({ a }: { a: Agent }) {
  const h = hashNum(a.id)
  const n = 24
  const label = a.status === 'lost' ? 'Heartbeat missing for the most recent samples' : a.status === 'unhealthy' ? 'Heartbeat delayed (degraded)' : 'Heartbeat, last 24 samples'
  return (
    <svg width={n * 6} height={24} role="img" aria-label={label} className="shrink-0">
      {Array.from({ length: n }).map((_, i) => {
        const missing = a.status === 'lost' && i >= 14
        const delayed = a.status === 'unhealthy' && i % 3 === 0
        const hh = missing ? 3 : delayed ? 6 : 8 + ((h * (i + 3)) % 14)
        return <rect key={i} x={i * 6} y={24 - hh} width={4} height={hh} rx={1} fill={missing ? 'var(--c-bad)' : delayed ? 'var(--c-warn)' : 'var(--c-ok)'} opacity={missing || delayed ? 0.8 : 0.85} />
      })}
    </svg>
  )
}

/* ───────────── Group modal (AG-03, ticket 49: typed write handler) ───────────── */

function GroupModal({ group, onClose }: { group: Group | null; onClose: () => void }) {
  const db = useGroupOptions('all')
  const pid = useProjectStore((s) => s.pid)
  const accessible = useAccessible()
  const me = useMe()
  const toast = useToastStore((s) => s.toast)
  const confirm = useSessionStore((s) => s.confirm)
  const saveGroup = useSaveGroup()
  const projs = accessible.filter((p) => !['closed', 'cancelled'].includes(p.status))
  const [f, setF] = useState({
    name: group?.name || '', projectId: group?.projectId || (pid !== 'all' ? pid : ''), desc: group?.desc || '', agents: group?.agents || [] as string[],
    policy: group?.policy || POLICIES[0], owner: group?.owner || (['manager', 'admin'].includes(me.role) ? me.name : 'Alex Morgan'),
  })
  const [tried, setTried] = useState(false)
  const cand = db.agents.filter((a) => f.projectId && (a.projectId === f.projectId || a.projectId === '') && (!a.group || (group && a.group === group.name)))
  const err = { name: !f.name.trim() ? 'Enter a group name.' : db.groups.some((g) => g.id !== group?.id && g.projectId === f.projectId && g.name.toLowerCase() === f.name.trim().toLowerCase()) ? 'A group with this name already exists in this project.' : '', projectId: !f.projectId ? 'Select the project allowed to use this group.' : '' }
  const toggle = (id: string, on: boolean) => setF((s) => ({ ...s, agents: on ? [...s.agents, id] : s.agents.filter((x) => x !== id) }))
  const removed = group ? group.agents.filter((x) => !f.agents.includes(x)) : []
  const removedInUse = removed.map((id) => db.agents.find((a) => a.id === id)).filter((a): a is Agent => !!a && !!a.op)

  /* One typed commit: create/update (rename + membership, pool members
     auto-assigned) with the confirm reason audited; the handler owns the
     eligibility rules — refusal reasons surface as a toast. */
  const commit = (r: string) => {
    saveGroup.mutate({ id: group?.id, name: f.name.trim(), projectId: f.projectId, desc: f.desc, agents: f.agents, owner: f.owner, policy: f.policy, reason: r }, {
      onSuccess: (res) => {
        if (!res.ok) { toast(res.failure.message, 'warn'); return }
        toast(group ? `Group ${f.name} updated.` : `Group ${f.name} created (${res.data.id}).`)
        onClose()
      },
    })
  }
  const save = () => {
    setTried(true)
    if (err.name || err.projectId) return
    if (removedInUse.length)
      confirm({
        title: 'Remove agents that are in use?', danger: true, confirmLabel: 'Remove from group anyway', reasonLabel: 'Reason', reasonRequired: true,
        body: <>{removedInUse.map((a) => `${a.id} (running ${a.op})`).join(', ')} {removedInUse.length === 1 ? 'is' : 'are'} currently used by an operation. Removing from the group does <b>not</b> stop the operation and the target is not changed silently, but it changes the group usage policy. Confirm the impact.</>,
        onConfirm: (r) => commit(r),
      })
    else commit('')
  }
  return (
    <Modal open onClose={onClose} title={group ? `Edit group ${group.name}` : 'Create agent group'} width={640}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>{group ? 'Save changes' : 'Create group'}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Group name" required error={tried && err.name}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Windows Lab B" /></Field>
        <Field label="Allowed project" required error={tried && err.projectId} hint={pid !== 'all' || group ? 'Locked to the current project.' : undefined}>
          <Select value={f.projectId} disabled={pid !== 'all' || !!group} onChange={(e) => setF({ ...f, projectId: e.target.value, agents: [] })}>
            <option value="">Select a project</option>
            {projs.map((p) => <option key={p.id} value={p.id}>{p.id} — {p.name}</option>)}
          </Select>
        </Field>
        <Field label="Description" className="sm:col-span-2"><Textarea className="min-h-16" value={f.desc} onChange={(e) => setF({ ...f, desc: e.target.value })} /></Field>
        <Field label="Usage policy"><Select value={f.policy} onChange={(e) => setF({ ...f, policy: e.target.value })}>{POLICIES.map((p) => <option key={p}>{p}</option>)}</Select></Field>
        <Field label="Group manager"><Select value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })}>{USERS.filter((u) => u.role !== 'viewer').map((u) => <option key={u.name}>{u.name}</option>)}</Select></Field>
      </div>
      <div className="mt-4">
        <div className="mb-1.5 text-xs font-medium text-muted">Select agents ({f.agents.length} selected)</div>
        {!f.projectId ? <p className="text-xs text-muted">Select a project first to see the available agents.</p> : !cand.length && !f.agents.length ? <p className="text-xs text-muted">No available agents (not already in another group) for this project. Assign a pool agent to the project first.</p> : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {[...cand, ...group?.agents.map((id) => db.agents.find((a) => a.id === id)).filter((a): a is Agent => !!a && !cand.includes(a)) ?? []].map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <Check checked={f.agents.includes(a.id)} onChange={(v) => toggle(a.id, v)} label={<span><Mono>{a.id}</Mono> · {a.host}</span>} />
                <span className="ml-auto flex items-center gap-2"><Status kind="agent" value={a.status} size="sm" />{!a.projectId && <span className="text-[11px] text-warn">Will be assigned to project</span>}{a.op && <span className="text-[11px] text-muted">running {a.op}</span>}</span>
              </li>
            ))}
          </ul>
        )}
        {removedInUse.length > 0 && <p className="mt-2 flex items-center gap-1.5 text-xs text-warn"><AlertTriangle size={13} />You are removing agents used by an operation ({removedInUse.map((a) => a.id).join(', ')}). You will be asked to confirm the impact when saving.</p>}
      </div>
    </Modal>
  )
}

/* ───────────── Request assignment drawer (AG-V3-03, ticket 49: typed immediate assign) ───────────── */
const isAssignReq = (t: string) => t.startsWith('Agent assignment')

function AssignDrawer({ agent: fixed, onClose }: { agent: Agent | null; onClose: () => void }) {
  const db = useAssignmentOptions()
  const pid = useProjectStore((s) => s.pid)
  const accessible = useAccessible()
  const me = useMe()
  const services = useServices()
  const toast = useToastStore((s) => s.toast)
  const can = useCan()
  const assign = useAssignAgent()
  const pool = db.agents.filter((a) => a.projectId === '')
  const [agentId, setAgentId] = useState(fixed?.id || pool.find((a) => (a.status === 'online' || a.status === 'idle') && !a.op)?.id || '')
  const agent = db.agents.find((a) => a.id === agentId) || null
  const projs = accessible.filter((p) => !['closed', 'cancelled', 'rejected'].includes(p.status))
  const [projectId, setProjectId] = useState(pid !== 'all' && projs.some((p) => p.id === pid) ? pid : '')
  const [duration, setDuration] = useState('Until project closes')
  const [opId, setOpId] = useState('')
  const [reviewer, setReviewer] = useState('Pat Kim')
  const [note, setNote] = useState('')
  const [tried, setTried] = useState(false)
  const [sent, setSent] = useState<{ agentId: string; projectId: string; reviewer: string; duration: string } | null>(null)
  const ops = db.operations.filter((o) => o.projectId === projectId && !['done', 'cancelled', 'estop'].includes(o.status))
  const proj = projs.find((p) => p.id === projectId)
  const conflict = agent?.op ? db.operations.find((o) => o.id === agent.op) : undefined
  const pending = agent ? db.approvals.find((x) => isAssignReq(x.type) && x.status === 'pending' && (x.diff || '').includes(agent.id)) : undefined
  const projOk = !!proj && ACTIVE_PROJECT.includes(proj.status)
  const reachable = !!agent && (agent.status === 'online' || agent.status === 'idle')
  const checks = [
    { label: 'Agent is connected', ok: reachable, why: agent ? `Status is ${STATUS_LABEL[agent.status]} (last seen ${agent.lastSeen}).` : 'Select an agent.' },
    { label: 'No conflicting reservation', ok: !!agent && !agent.op, why: conflict ? `Reserved by ${conflict.id} (${conflict.name}) in ${conflict.projectId}.` : '' },
    { label: 'Agent is in the shared pool', ok: !!agent && !agent.projectId, why: agent ? `Already assigned to ${agent.projectId}.` : '' },
    { label: 'Target project selected', ok: !!proj, why: 'Select a target project.' },
    { label: 'Project is approved or active (needed for immediate assignment)', ok: projOk, why: proj ? `Project is ${proj.status}; immediate assignment is not permitted until the ROE is approved. A request can still be submitted for review.` : 'Select a target project.' },
  ]
  const reqBlockers = checks.slice(0, 4).filter((c) => !c.ok)
  const immWhy = !can('editScope') ? 'Only Red Team Managers and Admins can assign immediately.' : !projOk ? (proj ? `Project ${proj.id} is ${proj.status}: immediate assignment is not permitted by policy. Submit a request instead.` : 'Select a target project.') : reqBlockers[0]?.why || ''
  const reqWhy = pending ? `Request ${pending.id} is already pending review.` : reqBlockers[0]?.why || ''
  const diff = agent ? `${agent.id} → ${projectId}; ${duration}${opId ? `; intended ${opId}` : ''}` : ''
  const request = () => {
    setTried(true)
    if (reqWhy || !agent) return
    /* The legacy `A.submitApproval` entry's exact transaction + request context. */
    submitApprovalTransaction(services.authority, services.clock, { actor: { id: me.name, role: me.role }, projectId, corr: 'legacy' }, { projectId, type: 'Agent assignment', note: note || `Request to assign ${agent.id} for ${duration}`, diff })
    toast(`Assignment of ${agent.id} requested. It takes effect only after ${reviewer} approves.`, 'info')
    setSent({ agentId: agent.id, projectId, reviewer, duration })
  }
  /* The immediate path is the typed handler (eligibility enforced there —
     the checks above stay presentation); the request path is ticket 21's
     approval transaction, so pending review never silently allocates. */
  const immediate = () => {
    setTried(true)
    if (immWhy || !agent) return
    assign.mutate({ agentId: agent.id, projectId, note: `Assigned immediately. Duration: ${duration}${opId ? `; intended operation ${opId}` : ''}; reviewer ${reviewer}` }, {
      onSuccess: (res) => {
        if (!res.ok) { toast(res.failure.message, 'warn'); return }
        toast(`${res.data.id} assigned to ${projectId}.`)
        onClose()
      },
    })
  }
  const alt = pool.filter((a) => a.id !== agent?.id && !a.op && (a.status === 'online' || a.status === 'idle') && a.os === agent?.os)
  if (sent) {
    const req = db.approvals.find((x) => isAssignReq(x.type) && x.status === 'pending' && (x.diff || '').includes(sent.agentId))
    return (
      <Drawer open onClose={onClose} title="Assignment requested" width={540} footer={<><Button onClick={onClose}>Close</Button>{req && <Button variant="primary" onClick={() => { onClose(); go('approval', { id: req.id }) }}>Open {req.id}</Button>}</>}>
        <div className="space-y-4">
          <Banner tone="warn" title="Pending Assignment">{sent.agentId} stays in the shared pool as <b>Pending Assignment</b> until {sent.reviewer} approves. It cannot join an operation in {sent.projectId} before that, and nothing is auto-assigned.</Banner>
          <DescList cols={2} items={[{ k: 'Request', v: req ? <IdL onClick={() => { onClose(); go('approval', { id: req.id }) }}>{req.id}</IdL> : 'Submitted' }, { k: 'Agent', v: <IdL onClick={() => { onClose(); go('agent', { id: sent.agentId }) }}>{sent.agentId}</IdL> }, { k: 'Target project', v: sent.projectId }, { k: 'Duration', v: sent.duration }, { k: 'Reviewer', v: sent.reviewer }, { k: 'Status', v: req ? 'Pending review' : 'Submitted' }]} />
          <p className="text-xs text-muted">Simulated workflow: approval is recorded in this prototype only. Availability is re-checked when the reviewer decides.</p>
        </div>
      </Drawer>
    )
  }
  return (
    <Drawer open onClose={onClose} title={fixed ? `Request assignment: ${fixed.id}` : 'Request agent assignment'} width={540}
      footer={<><Button onClick={onClose}>Cancel</Button>
        <Button icon={Zap} disabled={!!immWhy} title={immWhy || 'Assign without review (permitted for this project)'} onClick={immediate}>Assign immediately</Button>
        <Button variant="primary" icon={UserPlus} disabled={!!reqWhy && tried} title={reqWhy || 'Send for reviewer approval'} onClick={request}>Request assignment</Button></>}>
      <div className="space-y-4">
        <Banner tone="info">“Request assignment” sends the request to a reviewer; the agent stays in the shared pool until approved. “Assign immediately” skips review and is only available for approved or active projects.</Banner>
        {fixed ? <DescList cols={2} items={[{ k: 'Agent', v: <Id>{fixed.id}</Id> }, { k: 'Hostname', v: <Mono>{fixed.host}</Mono> }]} /> : (
          <Field label="Agent (shared pool)" required error={tried && !agentId && 'Select an agent.'}>
            <Select value={agentId} onChange={(e) => setAgentId(e.target.value)}><option value="">Select an agent</option>{pool.map((a) => <option key={a.id} value={a.id}>{a.id} · {a.host} · {STATUS_LABEL[a.status]}</option>)}</Select>
          </Field>
        )}
        {agent && <DescList cols={2} items={[{ k: 'Capability', v: `${agent.os} · agent ${agent.version}` }, { k: 'Health', v: <span className="flex items-center gap-2"><Status kind="agent" value={agent.status} size="sm" /><span className="text-xs text-muted">last seen {agent.lastSeen}</span></span> }]} />}
        <Field label="Target project" required error={tried && !projectId && 'Select a project.'} hint="Draft and pending projects can receive a request, but not an immediate assignment.">
          <Select value={projectId} onChange={(e) => { setProjectId(e.target.value); setOpId('') }}>
            <option value="">Select a project</option>
            {projs.map((p) => <option key={p.id} value={p.id}>{p.id} — {p.name} ({p.status}{ACTIVE_PROJECT.includes(p.status) ? '' : ', request only'})</option>)}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Assignment duration"><Select value={duration} onChange={(e) => setDuration(e.target.value)}><option>Until project closes</option><option>7 days</option><option>24 hours</option></Select></Field>
          <Field label="Reviewer"><Select value={reviewer} onChange={(e) => setReviewer(e.target.value)}>{USERS.filter((u) => ['reviewer', 'manager', 'admin'].includes(u.role)).map((u) => <option key={u.name}>{u.name}</option>)}</Select></Field>
        </div>
        <Field label="Intended operation (optional)" hint={projectId && !ops.length ? 'This project has no open operations.' : undefined}>
          <Select value={opId} disabled={!projectId} onChange={(e) => setOpId(e.target.value)}><option value="">None yet</option>{ops.map((o) => <option key={o.id} value={o.id}>{o.id} — {o.name}</option>)}</Select>
        </Field>
        <Field label="Justification (optional)"><Textarea className="min-h-16" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this agent is needed for the project." /></Field>
        <div>
          <div className="mb-1.5 text-xs font-medium text-muted">Eligibility checks</div>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {checks.map((c) => (
              <li key={c.label} className="flex items-start gap-2 px-3 py-2 text-sm">
                <Status kind="check" value={c.ok ? 'pass' : 'fail'} size="sm" />
                <span className="min-w-0"><span className="block">{c.label}</span>{!c.ok && <span className="block text-xs text-muted">{c.why}</span>}</span>
              </li>
            ))}
          </ul>
        </div>
        {pending && <Banner tone="warn" title="Request already pending">{pending.id} was submitted by {pending.by} on {pending.at}. Waiting for {pending.reviewer}.</Banner>}
        {conflict && (
          <Banner tone="bad" title="Conflicting reservation">
            {agent!.id} is reserved by <b>{conflict.id}</b> until the operation finishes or is stopped.
            <div className="mt-2"><Button size="sm" onClick={() => { onClose(); go('operation', { id: conflict.id }) }}>View {conflict.id}</Button></div>
          </Banner>
        )}
        {agent && reqBlockers.length > 0 && !agent.projectId && (
          <div className="rounded-lg border border-line p-3 text-sm">
            <div className="mb-1 font-medium">Permitted alternatives ({agent.os}, connected, unreserved)</div>
            {alt.length ? <ul className="space-y-1">{alt.map((a) => <li key={a.id} className="flex items-center gap-2"><button className="whitespace-nowrap font-mono text-[13px] text-accent hover:underline" onClick={() => setAgentId(a.id)}>{a.id}</button><span className="text-muted">{a.host} · {a.ip}</span></li>)}</ul> : <p className="text-xs text-muted">No other {agent.os} agents are available in the shared pool.</p>}
          </div>
        )}
        {!can('editScope') && <Locked reason="Only Red Team Managers and Admins can assign immediately. Anyone with access can submit a request." />}
      </div>
    </Drawer>
  )
}

/* ───────────── Health failure & replacement (AG-V3-04, E2E-05) ───────────── */
const STEP_IMPACT: Record<string, { label: string; tone: string }> = {
  ok: { label: 'Completed before disconnect (kept)', tone: 'text-ok' },
  fail: { label: 'Failed (unchanged)', tone: 'text-bad' },
  running: { label: 'Interrupted / Unknown: result not confirmed', tone: 'text-bad' },
  unknown: { label: 'Unknown: result not confirmed', tone: 'text-bad' },
  review: { label: 'Waiting for review; cannot continue on this agent', tone: 'text-warn' },
  pending: { label: 'Waiting; cannot start on this agent', tone: 'text-warn' },
  notrun: { label: 'Not run; needs another agent', tone: 'text-muted' },
}

function FailurePanel({ a }: { a: Agent }) {
  const db = useAgentRecovery(a)
  const accessible = useAccessible()
  const me = useMe()
  const services = useServices()
  const toast = useToastStore((s) => s.toast)
  const confirm = useSessionStore((s) => s.confirm)
  const can = useCan()
  const guard = useGuard(a.projectId || undefined)
  const ops = db.operations.filter((o) => o.agents.includes(a.id) && !['done', 'cancelled'].includes(o.status) && accessible.some((p) => p.id === o.projectId))
  const plans = db.plans.filter((p) => p.agents.includes(a.id) && accessible.some((x) => x.id === p.projectId))
  const isConn = (x: Agent) => x.status === 'online' || x.status === 'idle'
  const cands = db.agents.filter((c) => c.id !== a.id && c.os === a.os).map((c) => {
    const why = !isConn(c) ? `${c.id} is ${STATUS_LABEL[c.status]}, not connected.` : c.projectId && c.projectId !== a.projectId ? `Assigned to ${c.projectId}: different scope and approval, cannot be used in ${a.projectId || 'this project'}.` : c.op ? `Reserved by ${c.op}.` : ''
    return { c, why, kind: why ? 'no' as const : c.projectId === a.projectId && a.projectId ? 'same' as const : 'pool' as const }
  }).filter((x) => x.kind !== 'no' || x.c.projectId === a.projectId || !x.c.projectId)
  const otherOs = db.agents.filter((c) => c.id !== a.id && c.os !== a.os && isConn(c) && (c.projectId === a.projectId || !c.projectId)).length
  const editWhy = guard.ro ? guard.reason : !can('run') ? 'Only Managers and Operators can change operation agents.' : ''
  const swap = (o: typeof ops[number], c: Agent) => confirm({
    title: `Replace ${a.id} with ${c.id} in ${o.id}?`, confirmLabel: 'Replace agent', reasonLabel: 'Reason', reasonRequired: true,
    body: <>{o.id} is {o.status}. {a.id} ({a.host}) is replaced by {c.id} ({c.host}), same project and scope. Preflight must be re-run before the operation starts; nothing is marked complete.</>,
    onConfirm: (r) => { const res = replaceOperationAgent(services.authority, services.clock, { actor: { id: me.name, role: me.role }, projectId: o.projectId, corr: 'legacy' }, o.id, a.id, c.id, r); if (!res.ok) { toast(res.failure.message, 'bad'); return }; toast(`${c.id} now replaces ${a.id} in ${o.id}. Re-run preflight.`) },
  })
  const requestRepl = (o: typeof ops[number] | null, c: Agent) => confirm({
    title: `Request ${c.id} as replacement for ${a.id}?`, confirmLabel: 'Submit request', reasonLabel: 'Reason', reasonRequired: true,
    body: <>{o ? `${o.id} keeps running; ` : ''}the replacement is only reserved after a reviewer approves{!c.projectId ? ` and ${c.id} is assigned from the shared pool to ${a.projectId}` : ''}. The operation is not marked successful and the interrupted steps stay Unknown until re-run.</>,
    onConfirm: (r) => { submitApprovalTransaction(services.authority, services.clock, { actor: { id: me.name, role: me.role }, projectId: a.projectId, corr: 'legacy' }, { projectId: a.projectId, type: 'Agent assignment (replacement)', note: r, diff: `${c.id} → ${a.projectId}; replaces ${a.id}${o ? ` in ${o.id}` : ''}` }); toast('Replacement request sent for review.', 'info') },
  })
  return (
    <div className="mb-4 space-y-4">
      <Banner tone="bad" title={`Health failure: ${a.id} (${a.host}) is disconnected`} action={<Button size="sm" icon={RefreshCw} disabled={!!editWhy} title={editWhy || 'Restore connection (simulated)'} onClick={() => { restoreAgent(a.id); toast(`${a.id} connection restored (simulated).`) }}>Restore connection</Button>}>
        Last heartbeat: <b>{a.lastSeen}</b>. Status reflects the last observation and may be stale. Disconnection never marks an operation as completed or successful.
      </Banner>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card><CardHeader title="Impact on operations" sub="Steps assigned to this agent" />
          {!ops.length ? (
            <div className="text-sm text-muted">
              <p>No open operation currently reserves {a.id}.</p>
              {plans.length > 0 && <p className="mt-2">Plans referencing it: {plans.map((p) => <span key={p.id} className="mr-2 whitespace-nowrap"><IdL onClick={() => go('ai-plan', { id: p.id })}>{p.id}</IdL> <span className="text-xs">({p.ver || `v${p.version}`}, {p.status})</span></span>)}. Running operations continue on their other connected agents.</p>}
            </div>
          ) : ops.map((o) => {
            const st = o.steps.filter((s) => s.agent === a.id)
            return (
              <div key={o.id} className="mb-3 last:mb-0">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-sm"><IdL onClick={() => go('operation', { id: o.id })}>{o.id}</IdL><Status kind="op" value={o.status} size="sm" /><span className="text-xs text-muted">stays {o.status}; not marked complete</span></div>
                {st.length ? <ul className="divide-y divide-line rounded-lg border border-line text-xs">{st.slice(0, 6).map((s) => <li key={s.id} className="flex flex-wrap gap-2 px-3 py-1.5"><Mono className="whitespace-nowrap">{s.id}</Mono><span className="min-w-0 flex-1">{s.name}</span><span className={STEP_IMPACT[s.status]?.tone}>{STEP_IMPACT[s.status]?.label}</span></li>)}{st.length > 6 && <li className="px-3 py-1.5 text-muted">+{st.length - 6} more steps</li>}</ul> : <p className="text-xs text-muted">No steps are assigned to {a.id} in this operation.</p>}
              </div>
            )
          })}
        </Card>
        <Card><CardHeader title="Replace or restore" sub="Offered only when scope and approval match" />
          {editWhy && <div className="mb-2"><Locked reason={editWhy} /></div>}
          <ul className="divide-y divide-line rounded-lg border border-line text-sm">
            <li className="flex flex-wrap items-center gap-2 px-3 py-2"><span className="min-w-0 flex-1"><b>Restore {a.id}</b><span className="block text-xs text-muted">Reconnect the same agent; keeps the original scope and approvals. Simulated.</span></span><Button size="sm" icon={RefreshCw} disabled={!!editWhy} title={editWhy} onClick={() => { restoreAgent(a.id); toast(`${a.id} connection restored (simulated).`) }}>Restore</Button></li>
            {cands.map(({ c, why, kind }) => (
              <li key={c.id} className="px-3 py-2">
                <div className="flex flex-wrap items-center gap-2"><IdL onClick={() => go('agent', { id: c.id })}>{c.id}</IdL><span className="text-xs text-muted">{c.host} · {c.os}</span><Status kind="agent" value={c.status} size="sm" /></div>
                {why ? <p className="mt-1 text-xs text-muted">Not eligible: {why}</p> : kind === 'same' ? (
                  <div className="mt-1 space-y-1 text-xs"><span className="text-ok">Eligible: same project ({a.projectId}), same scope, connected, unreserved.</span>
                    <div className="flex flex-wrap gap-2">{ops.filter((o) => ['draft', 'ready'].includes(o.status)).map((o) => <Button key={o.id} size="sm" disabled={!!editWhy} title={editWhy || `Swap ${a.id} for ${c.id} in ${o.id}`} onClick={() => swap(o, c)}>Replace in {o.id}</Button>)}
                      {ops.filter((o) => ['running', 'paused'].includes(o.status)).map((o) => <Button key={o.id} size="sm" disabled={!!editWhy} title={editWhy || 'Running operations change only after approval'} onClick={() => requestRepl(o, c)}>Request replacement for {o.id}</Button>)}
                      {!ops.length && <Button size="sm" disabled={!!editWhy} title={editWhy} onClick={() => requestRepl(null, c)}>Request as reserve</Button>}</div></div>
                ) : (
                  <div className="mt-1 space-y-1 text-xs"><span className="text-warn">Shared pool: needs assignment approval for {a.projectId} before it can replace {a.id}.</span>
                    <div><Button size="sm" disabled={!!editWhy} title={editWhy || 'Request replacement and assignment'} onClick={() => requestRepl(ops[0] || null, c)}>Request assignment as replacement</Button></div></div>
                )}
              </li>
            ))}
            {!cands.length && <li className="px-3 py-2 text-xs text-muted">No compatible {a.os} agent is available in this project or the shared pool.</li>}
          </ul>
          {otherOs > 0 && <p className="mt-2 text-xs text-muted">{otherOs} connected agent(s) with a different OS are not compatible and are not offered.</p>}
        </Card>
      </div>
    </div>
  )
}


/* ───────────── Fleet (AG-V3-01, ticket 48: typed service read + Query) ───────────── */
/** One row: the canonical agent plus the service-derived decorations. */
type FleetRow = Agent & { sessions: number; pending?: { id: string; by: string; at: string; reviewer: string } }


function FleetList({ mode, onNewGroup, newGroupWhy, onAssign }: { mode: 'project' | 'pool'; onNewGroup: () => void; newGroupWhy: string; onAssign: (a: Agent | null) => void }) {
  const pid = useProjectStore((s) => s.pid)
  const can = useCan()
  const confirm = useSessionStore((s) => s.confirm)
  const toast = useToastStore((s) => s.toast)
  const release = useUnassignAgent()
  const [q, setQ] = useState(''), [st, setSt] = useState(''), [os, setOs] = useState(''), [pj, setPj] = useState(''), [gr, setGr] = useState(''), [kpi, setKpi] = useState<'' | AgentKpi>('')
  const [page, setPage] = useState(1)
  /* The one fleet read: scope-checked typed service; rows, KPI pills, filter
     options and banner data all derive from accessible canonical agents. */
  const list = useAgentList({
    mode, q: q || undefined, status: st || undefined, os: os || undefined,
    project: pj || undefined, group: gr || undefined, kpi: kpi || undefined,
    page: page > 1 ? page : undefined,
  })
  useEffect(() => { setPage(1) }, [q, st, os, pj, gr, kpi, mode])
  const read = list.data
  const k = read?.kpis
  const rows = useMemo<FleetRow[]>(() => (read?.items ?? []).map((it) => ({ ...it.agent, sessions: it.sessions, pending: it.pendingAssignment })), [read])
  const isConn = (a: Agent) => a.status === 'online' || a.status === 'idle'
  const groups = read?.groups ?? []
  const projIds = read?.projects ?? []
  const osList = read?.osList ?? []
  const pages = read ? Math.max(1, Math.ceil(read.total / read.pageSize)) : 1
  const moreActive = [os, pj, gr].filter(Boolean).length
  const filtered = !!(q || st || os || pj || gr || kpi)
  const clear = () => { setQ(''); setSt(''); setOs(''); setPj(''); setGr(''); setKpi('') }
  const tk = (k: AgentKpi) => () => setKpi(kpi === k ? '' : k)
  const ks = (v: AgentKpi, d: string) => kpi === v ? 'Filter active, click to clear' : d
  const assignWhy = (a: FleetRow) => a.projectId ? 'Already assigned to a project.' : a.op ? `Reserved by ${a.op}.` : !isConn(a) ? `${STATUS_LABEL[a.status]}: a non-connected agent is never available or auto-assigned.` : a.pending ? `${a.pending.id} is already pending review.` : ''
  /* Ticket 49: return-to-pool is the typed unassign (reason required at the
     handler; reserved agents are refused until their operation ends). */
  const releaseWhy = (a: FleetRow) => !can('editScope') ? 'Only Red Team Managers and Admins can change allocation.' : a.op ? `Reserved by ${a.op} — the reservation must end first.` : ''
  const doRelease = (a: FleetRow) => confirm({
    title: `Return ${a.id} to the shared pool?`, confirmLabel: 'Return to pool', danger: true, reasonLabel: 'Reason', reasonRequired: true,
    body: <>{a.id} ({a.host}) is assigned to <b>{a.projectId}</b>. Returning it to the shared pool makes it available to every project's assignment flow again; its group membership is kept. Committed reservations of running operations are never affected by this screen.</>,
    onConfirm: (r) => release.mutate({ agentId: a.id, reason: r }, {
      onSuccess: (res) => { if (res.ok) toast(`${a.id} returned to the shared pool.`); else toast(res.failure.message, 'warn') },
    }),
  })
  const scopeName = pid === 'all' ? 'the projects you can access' : pid
  const poolAvail = k?.poolAvailable ?? 0
  return (
    <>
      {list.isPending ? (
        <div aria-busy="true" aria-label="Loading agents"><Skeleton className="h-96" /></div>
      ) : list.isError ? (
        <Empty icon={AlertTriangle} title="Agents could not be loaded" action={<Button onClick={() => list.refetch()}>Retry</Button>}>
          {(list.error as AgentReadError).failure.message}
        </Empty>
      ) : k && (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Kpi label="Connected" value={k.connected} tone="ok" icon={Wifi} sub={ks('conn', `${k.connectedAssigned} assigned · ${k.connectedPool} pool`)} onClick={tk('conn')} />
            <Kpi label="Disconnected" value={k.disconnected} tone={k.disconnected ? 'bad' : undefined} icon={WifiOff} sub={ks('lost', k.disconnected ? 'Needs action' : 'No alerts')} onClick={tk('lost')} />
            <Kpi label="Assigned to Project" value={k.assigned} icon={Layers} sub={ks('assigned', pid === 'all' ? 'Across accessible projects' : `Assigned to ${pid}`)} onClick={tk('assigned')} />
            <Kpi label="Available in Shared Pool" value={k.poolAvailable} tone={k.poolAvailable ? 'cyan' : undefined} icon={Layers} sub={ks('avail', 'Connected, unassigned, unreserved')} onClick={tk('avail')} />
            <Kpi label="Busy" value={k.busy} tone="cyan" icon={Zap} sub={ks('busy', 'Reserved by an operation')} onClick={tk('busy')} />
            <Kpi label="Need Attention" value={k.attention} tone={k.attention ? 'warn' : undefined} icon={ShieldAlert} sub={ks('attn', 'Disconnected, unhealthy, unknown, disabled')} onClick={tk('attn')} />
          </div>
          <p className="-mt-2 mb-4 text-xs text-muted">Pool agents are not counted as assigned to a project. “Busy” counts only agents reserved by an operation; an agent that is connected but not reserved is available, not busy.</p>
          <FilterBar right={pid !== 'all' && <Button icon={FolderPlus} onClick={onNewGroup} disabled={!!newGroupWhy} title={newGroupWhy || 'Create an agent group'}>Create Group</Button>}>
            <SearchBox className="w-64" value={q} onChange={setQ} placeholder="Search by ID, hostname or IP" />
            <Select className="!w-40" aria-label="Status" value={st} onChange={(e) => setSt(e.target.value)}><option value="">All statuses</option>{Object.entries(STATUS_LABEL).map(([kk, v]) => <option key={kk} value={kk}>{v}</option>)}</Select>
            <MoreFilters active={moreActive}>
              <Select aria-label="OS" value={os} onChange={(e) => setOs(e.target.value)}><option value="">All OS</option>{osList.map((v) => <option key={v}>{v}</option>)}</Select>
              {mode === 'project' && pid === 'all' && <Select aria-label="Project" value={pj} onChange={(e) => setPj(e.target.value)}><option value="">All projects</option>{projIds.map((id) => <option key={id} value={id}>{id}</option>)}</Select>}
              <Select aria-label="Group" value={gr} onChange={(e) => setGr(e.target.value)}><option value="">All groups</option>{groups.map((g) => <option key={g}>{g}</option>)}</Select>
            </MoreFilters>
            {filtered && <Button variant="ghost" size="sm" icon={X} onClick={clear}>Clear filters</Button>}
          </FilterBar>
          {pid !== 'all' && newGroupWhy && <div className="-mt-2 mb-3"><Locked reason={`Create Group: ${newGroupWhy}`} /></div>}
          {read.lostAssigned.length > 0 && mode === 'project' && <Banner tone="bad" title="Some assigned agents are disconnected" action={<Button size="sm" onClick={() => go('agent', { id: read.lostAssigned[0].id, tab: 'conn' })}>View health failure</Button>}>{read.lostAssigned.map((a) => `${a.id} ${a.host} (last seen ${a.lastSeen})`).join('; ')}. Last-seen data may be stale; no operation is marked complete because of it.</Banner>}
          {mode === 'pool' && <Banner tone="info" title="Shared Pool">Connected agents that are not assigned to any project. They cannot join an operation until an assignment is approved. These rows are never counted as agents of the current project.</Banner>}
          <DTable
            rows={rows} rowKey={(a) => a.id} onRow={(a) => go('agent', { id: a.id })}
            empty={filtered ? <Empty icon={Layers} title="No agents match the filters" action={<Button onClick={clear}>Clear filters</Button>}>Try relaxing the filters.</Empty>
              : mode === 'project'
                ? <Empty icon={Layers} title={pid === 'all' ? 'No assigned agents' : `0 agents assigned to ${pid}`} action={<Button variant="primary" icon={UserPlus} onClick={() => onAssign(null)}>Request assignment</Button>}>No agent is assigned to {scopeName}. {poolAvail} connected {poolAvail === 1 ? 'agent is' : 'agents are'} in the Shared Pool and {poolAvail === 1 ? 'is' : 'are'} not counted as assigned. Assignment needs reviewer approval.</Empty>
                : <Empty icon={Layers} title="The shared pool is empty">Every registered agent is assigned to a project. Register agents from Settings → Integrations.</Empty>}
            cols={[
              { key: 'id', header: 'Agent ID', width: '110px', render: (a) => <Id className="text-accent">{a.id}</Id> },
              { key: 'host', header: 'Hostname', render: (a) => <div><span className="block max-w-[160px] truncate" title={a.host}><Mono>{a.host}</Mono></span><div className="text-xs text-muted"><Mono className="text-xs">{a.ip}</Mono></div></div> },
              { key: 'os', header: 'OS', hideBelow: 'md', render: (a) => a.os },
              { key: 'cap', header: 'Capability', hideBelow: 'lg', render: (a) => <span className="whitespace-nowrap text-xs">{a.os} · v{a.version}</span> },
              { key: 'st', header: 'Connection', render: (a) => <Status kind="agent" value={a.status} /> },
              { key: 'ls', header: 'Last seen (UTC+7)', render: (a) => <span className={cx('whitespace-nowrap text-xs', a.status === 'lost' && 'text-bad')}>{shortDate(a.lastSeen)}{a.status === 'lost' && <span className="ml-1">(stale)</span>}</span> },
              { key: 'pj', header: 'Assignment', render: (a) => a.projectId ? <span className="whitespace-nowrap text-xs">{a.projectId}</span> : a.pending ? <span title={`${a.pending.id}: waiting for reviewer approval`} className="whitespace-nowrap rounded-full border border-warn/30 bg-warn/10 px-2 py-0.5 text-[11px] text-warn">Pending Assignment</span> : <span className="whitespace-nowrap rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">Unassigned</span> },
              { key: 'grp', header: 'Group', hideBelow: 'lg', render: (a) => a.group ? <Trunc max="max-w-[130px]">{a.group}</Trunc> : <span className="text-muted">—</span> },
              { key: 'op', header: 'Operation', hideBelow: 'md', render: (a) => a.op ? <IdL onClick={() => go('operation', { id: a.op! })}>{a.op}</IdL> : <span className="text-muted">—</span> },
              { key: 'ss', header: 'Sessions', hideBelow: 'lg', render: (a) => <span className="text-xs">{a.sessions}</span> },
              { key: 'act', header: 'Actions', render: (a) => (
                <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" variant="ghost" onClick={() => go('agent', { id: a.id })}>View</Button>
                  {!a.projectId
                    ? <Button size="sm" className="whitespace-nowrap" disabled={!!assignWhy(a)} title={assignWhy(a) || 'Request assignment to a project (approval-gated)'} onClick={() => onAssign(a)}>Request assignment</Button>
                    : <Button size="sm" variant="ghost" className="whitespace-nowrap" disabled={!!releaseWhy(a)} title={releaseWhy(a) || 'Return to the shared pool (reason required)'} onClick={() => doRelease(a)}>Return to pool</Button>}
                </span>
              ) },
            ]}
          />
          <Pager page={read.page} pages={pages} setPage={setPage} total={read.total} />
          <p className="mt-3 text-xs text-muted">An agent can only be used in the project it is assigned to. Agents in the Shared Pool must be assigned through the approval process before they can join an operation. {can('editScope') ? '' : 'Your role can request assignment but cannot assign immediately.'}</p>
        </>
      )}
    </>
  )
}


/* ───────────── Groups (AG-03, ticket 49: typed membership writes) ───────────── */

function GroupsTab({ onNew, onEdit, newWhy }: { onNew: () => void; onEdit: (g: Group) => void; newWhy: string }) {
  const db = useGroupOptions()
  const pid = useProjectStore((s) => s.pid)
  const scoped = useScoped<Group>()
  const can = useCan()
  const confirm = useSessionStore((s) => s.confirm)
  const toast = useToastStore((s) => s.toast)
  const setFilter = useSessionStore((s) => s.setFilter)
  const removeMember = useRemoveFromGroup()
  const groups = scoped(db.groups)
  const guard = useGuard(pid === 'all' ? undefined : pid)
  const canEdit = can('editScope') && !guard.ro && pid !== 'all'
  const why = pid === 'all' ? 'Select a specific project to edit groups.' : guard.ro ? guard.reason : !can('editScope') ? 'Only Red Team Managers and Admins can edit groups.' : ''
  const unlink = (g: Group, aid: string) => {
    const a = db.agents.find((x) => x.id === aid)
    confirm({
      title: `Remove ${aid} from ${g.name}?`, confirmLabel: 'Remove from group', danger: !!a?.op, reasonLabel: 'Reason', reasonRequired: !!a?.op,
      body: a?.op ? <>This agent is used by operation <b>{a.op}</b>. Removing it from the group does not stop the operation and does not change its target silently, but it affects the group usage policy. Confirm the impact before continuing.</> : <>The agent will no longer belong to this group. No operation is using it.</>,
      onConfirm: (r) => removeMember.mutate({ groupId: g.id, agentId: aid, reason: r }, {
        onSuccess: (res) => { if (res.ok) toast(`${aid} removed from ${g.name}.`); else toast(res.failure.message, 'warn') },
      }),
    })
  }
  return (
    <>
      <FilterBar right={<Button variant="primary" icon={Plus} onClick={onNew} disabled={!!newWhy} title={newWhy || 'Create a group'}>Create Group</Button>}>
        <span className="text-sm text-muted">{groups.length} {groups.length === 1 ? 'group' : 'groups'}</span>
      </FilterBar>
      {newWhy && <div className="-mt-2 mb-3"><Locked reason={`Create Group: ${newWhy}`} /></div>}
      {!groups.length ? <Empty icon={Layers} title="No agent groups yet" action={<Button variant="primary" icon={Plus} onClick={onNew} disabled={!!newWhy} title={newWhy}>Create Group</Button>}>Groups make it faster to pick several agents for an operation and apply a usage policy.</Empty> : (
        <div className="grid gap-4 xl:grid-cols-2">
          {groups.map((g) => {
            const ags = g.agents.map((id) => db.agents.find((a) => a.id === id)).filter((a): a is Agent => !!a)
            const ops = [...new Set(ags.map((a) => a.op).filter(Boolean))] as string[]
            const avail = ags.filter((a) => (a.status === 'online' || a.status === 'idle') && !a.op).length
            const oss = [...new Set(ags.map((a) => a.os))]
            return (
              <Card key={g.id}>
                <CardHeader title={<span className="flex items-center gap-2">{g.name}<Mono className="text-xs text-muted">{g.id}</Mono></span>} sub={g.desc}
                  actions={<Button size="sm" icon={Pencil} onClick={() => onEdit(g)} disabled={!canEdit} title={why || 'Edit group'}>Edit Group</Button>} />
                <DescList cols={2} items={[
                  { k: 'Project', v: <IdLink onClick={() => go('project', { id: g.projectId })}>{g.projectId}</IdLink> },
                  { k: 'Owner', v: g.owner },
                  { k: 'Usage policy', v: g.policy },
                  { k: 'Usage', v: ops.length ? <span className="text-accent">In use by {ops.join(', ')}</span> : 'Not in use' },
                  { k: 'Members', v: ags.length },
                  { k: 'Availability', v: `${avail} of ${ags.length} available` },
                  { k: 'Compatibility', v: oss.join(' / ') || '—' },
                  { k: 'Last updated', v: g.updated },
                ]} />
                <ul className="mt-4 divide-y divide-line rounded-lg border border-line">
                  {ags.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                      <IdLink onClick={() => go('agent', { id: a.id })}>{a.id}</IdLink><span className="text-muted">{a.host}</span>
                      <span className="ml-auto flex items-center gap-2"><Status kind="agent" value={a.status} size="sm" />
                        <button disabled={!canEdit} title={why || `Remove ${a.id} from group`} aria-label={`Remove ${a.id} from group`} onClick={() => unlink(g, a.id)} className="rounded p-1 text-muted hover:bg-hover hover:text-bad disabled:opacity-40"><Trash2 size={14} /></button></span>
                    </li>
                  ))}
                  {!ags.length && <li className="px-3 py-3 text-xs text-muted">This group has no agents. Use “Edit Group” to add agents.</li>}
                </ul>
                {why && <div className="mt-2"><Locked reason={why} /></div>}
                {ops.length > 0 && <p className="mt-3 text-xs text-muted">Changing the group of a running operation follows the group usage policy and never changes its targets silently.</p>}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => { setFilter('operations.group', g.name); go('operations') }}>View Related Operations</Button>
                  <Button size="sm" variant="primary" disabled={pid === 'all' || !can('run')} title={pid === 'all' ? 'Select a specific project to create an operation.' : !can('run') ? 'Your role cannot create operations.' : ''} onClick={() => { setFilter('operation-new.group', g.id); go('operation-new') }}>Use group in operation</Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </>
  )
}

/* ───────────── Connectivity & health (AG-04, ticket 48: typed service read) ───────────── */

function HealthTab() {
  const pid = useProjectStore((s) => s.pid)
  const can = useCan()
  const toast = useToastStore((s) => s.toast)
  const guard = useGuard(pid === 'all' ? undefined : pid)
  const [gr, setGr] = useState('')
  const [obs, setObs] = useState(stamp())
  const [busy, setBusy] = useState(false)
  /* The whole scoped base (assigned + pool): the connectivity tab reads every
     row the actor may see, filtered by group server-side. */
  const list = useAgentList({ mode: 'all', group: gr || undefined, pageSize: 100 })
  const rows = useMemo(() => (list.data?.items ?? []).map((it) => it.agent), [list.data])
  const groups = list.data?.groups ?? []
  const on = rows.filter((a) => a.status === 'online' || a.status === 'idle').length
  const lost = rows.filter((a) => a.status === 'lost')
  const delayed = rows.filter((a) => a.status === 'unhealthy')
  const labels = ['6 AM', '7 AM', '8 AM', '9 AM', '10 AM', '10:42 AM']
  const vals = [Math.max(0, on - 1), on, Math.max(0, on - (on > 3 ? 1 : 0)), on, on, on]
  const score = rows.length ? Math.round((on / rows.length) * 100) : 0
  const errs = useMemo(() => rows.flatMap((a) => [
    ...(a.status === 'lost' ? [{ a, kind: 'Heartbeat lost', note: `No heartbeat since ${a.lastSeen} (over the 15-minute threshold).`, fix: 'Check the agent host and network path, then restore the connection.', tone: 'bad' as const }] : []),
    ...(a.status === 'unhealthy' ? [{ a, kind: 'Degraded health', note: 'Heartbeats are delayed or failing intermittently.', fix: 'Review the agent log and restart the service if allowed.', tone: 'warn' as const }] : []),
    ...(a.status === 'unknown' ? [{ a, kind: 'Unknown state', note: 'Not enough data to conclude the agent state.', fix: 'Refresh and wait for the next heartbeat.', tone: 'warn' as const }] : []),
    ...(a.version < '5.2.0' ? [{ a, kind: 'Outdated version', note: `Agent ${a.version} is behind 5.2.1 and may cause connection errors.`, fix: 'Schedule an agent update.', tone: 'warn' as const }] : []),
  ]), [rows])
  const refresh = () => { setBusy(true); setTimeout(() => { setBusy(false); setObs(stamp()); toast('Connectivity refreshed.', 'info') }, 600) }
  const restoreWhy = guard.ro ? guard.reason : !can('run') ? 'Only Managers and Operators can restore connections.' : ''
  return (
    <>
      <Banner tone="info" title="About connection status">Connection status reflects the most recent observation. It does not guarantee the agent can perform tasks right now.</Banner>
      <FilterBar right={<><span className="hidden text-xs text-muted sm:inline">Last observed: <Mono>{obs}</Mono></span><Button icon={RefreshCw} onClick={refresh} disabled={busy}>{busy ? 'Refreshing…' : 'Refresh'}</Button></>}>
        <Select className="!w-44" aria-label="Group" value={gr} onChange={(e) => setGr(e.target.value)}><option value="">All groups</option>{groups.map((g) => <option key={g}>{g}</option>)}</Select>
      </FilterBar>
      {list.isPending ? (
        <div aria-busy="true" aria-label="Loading connectivity"><Skeleton className="h-72" /></div>
      ) : list.isError ? (
        <Empty icon={AlertTriangle} title="Connectivity could not be loaded" action={<Button onClick={() => list.refetch()}>Retry</Button>}>
          {(list.error as AgentReadError).failure.message}
        </Empty>
      ) : (
        <>
          <div className="mb-5 grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader title="Connected agents, last 24 hours" sub="Simulated data. Times in UTC+7." />
              {rows.length ? <LineChart labels={labels} series={[{ name: 'Connected agents', values: vals, color: 'var(--c-ok)' }]} /> : <Empty title="No connectivity data" />}
            </Card>
            <Card>
              <CardHeader title="Health score" sub="Share of agents connected" />
              <div className="flex items-baseline gap-2"><span className="text-3xl font-semibold">{score}%</span><span className="text-sm text-muted">{on} of {rows.length} connected</span></div>
              <p className="mt-2 text-xs text-muted">Calculated as connected or idle agents divided by all agents in the filter. Disconnected, unhealthy, disabled and unknown agents lower the score. A high score is not a guarantee of readiness.</p>
              {lost.length === 0 && delayed.length === 0 && <p className="mt-3 flex items-center gap-2 text-sm text-ok"><Wifi size={16} />No agents over the last-seen threshold (15 minutes).</p>}
            </Card>
          </div>
          <h3 className="mb-3 text-[15px] font-semibold">Lost and delayed agents</h3>
          <Table
            rows={[...lost, ...delayed]} rowKey={(a) => a.id} onRow={(a) => go('agent', { id: a.id })}
            empty={<Empty icon={Activity} title="No lost or delayed agents">All agents in this filter reported within the threshold.</Empty>}
            cols={[
              { key: 'id', header: 'Agent', render: (a) => <div className="flex items-center gap-2">{a.status === 'lost' ? <WifiOff size={15} className="text-bad" aria-hidden /> : <AlertTriangle size={15} className="text-warn" aria-hidden />}<div><Mono className="text-accent">{a.id}</Mono><div className="text-xs text-muted">{a.host} · {a.ip}</div></div></div> },
              { key: 'st', header: 'Status', render: (a) => <Status kind="agent" value={a.status} /> },
              { key: 'hb', header: 'Heartbeat (24 samples)', hideBelow: 'md', render: (a) => <Heartbeat a={a} /> },
              { key: 'lat', header: 'Latency', render: (a) => a.status === 'lost' || a.status === 'disabled' ? <span className="text-muted">—</span> : <Mono>{18 + (hashNum(a.id) % 60)} ms</Mono> },
              { key: 'ls', header: 'Last seen', render: (a) => <span className={cx('text-xs', a.status === 'lost' && 'font-medium text-bad')}>{a.lastSeen}</span> },
              { key: 'op', header: 'Affected operations', hideBelow: 'lg', render: (a) => a.op ? <IdLink onClick={() => go('operation', { id: a.op! })}>{a.op}</IdLink> : <span className="text-muted">None</span> },
              { key: 'act', header: '', render: (a) => (
                <span className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" variant="ghost" onClick={() => go('agent', { id: a.id })}>Open Details</Button>
                  {a.status === 'lost' && <Button size="sm" disabled={!!restoreWhy} title={restoreWhy || 'Restore connection (simulated)'} onClick={() => { restoreAgent(a.id); toast(`${a.id} connection restored (simulated).`) }}>Restore</Button>}
                </span>
              ) },
            ]}
          />
          {restoreWhy && lost.length > 0 && <div className="mt-2"><Locked reason={`Restore: ${restoreWhy}`} /></div>}
          <h3 className="mb-3 mt-6 text-[15px] font-semibold">Agent error events and recommended remediation</h3>
          <Table
            rows={errs} rowKey={(e) => e.a.id + e.kind} dense
            empty={<Empty icon={Activity} title="No agent errors recorded" />}
            cols={[
              { key: 'a', header: 'Agent', render: (e) => <IdLink onClick={() => go('agent', { id: e.a.id })}>{e.a.id}</IdLink> },
              { key: 'k', header: 'Event', render: (e) => <span className={cx('inline-flex items-center gap-1.5 text-xs font-medium', e.tone === 'bad' ? 'text-bad' : 'text-warn')}><AlertTriangle size={13} aria-hidden />{e.kind}</span> },
              { key: 'n', header: 'Details', render: (e) => <span className="text-xs text-muted">{e.note}</span> },
              { key: 'f', header: 'Recommended remediation', hideBelow: 'md', render: (e) => <span className="text-xs">{e.fix}</span> },
              { key: 'op', header: 'Affected operation', render: (e) => e.a.op ? <IdLink onClick={() => go('operation', { id: e.a.op! })}>{e.a.op}</IdLink> : <span className="text-muted">—</span> },
            ]}
          />
          <p className="mt-3 text-xs text-muted">Showing agents for the selected project and your access. Data freshness depends on the last heartbeat shown for each agent.</p>
        </>
      )}
    </>
  )
}

/* ───────────── Main page ───────────── */
/**
 * The agents surface body (fleet/pool/groups/connectivity + its modals),
 * extracted so the global Infrastructure page can compose it without nesting
 * a whole page (plan 2026-10-16 S2). `header` is the optional page header the
 * route component renders above the tabs; it receives the assignment-drawer
 * opener so the page-level CTA and the row actions share one drawer.
 */

export function AgentsContent({ initialTab, header }: { initialTab?: string; header?: (openAssign: (a: Agent | null) => void) => ReactNode }) {
  const pid = useProjectStore((s) => s.pid)
  const can = useCan()
  const guard = useGuard(pid === 'all' ? undefined : pid)
  const legacy = initialTab === 'pool' || initialTab === 'groups' || initialTab === 'health' ? initialTab : undefined
  const [tab, setTab] = useState<'list' | 'pool' | 'groups' | 'health'>(legacy ?? 'list')
  const [modal, setModal] = useState<{ g: Group | null } | null>(null)
  const [assign, setAssign] = useState<{ a: Agent | null } | null>(null)
  /* Tab badges come from the fleet read's whole-base counts. */
  const fleet = useAgentList({})
  const k = fleet.data?.kpis
  const newWhy = pid === 'all' ? 'Select a specific project to create a group.' : guard.ro ? guard.reason : !can('editScope') ? 'Only Red Team Managers and Admins can create groups.' : ''
  return (
    <>
      {header?.((a) => setAssign({ a }))}
      <Tabs value={tab} onChange={(next) => { if (next === 'list' || next === 'pool' || next === 'groups' || next === 'health') setTab(next) }} tabs={[{ id: 'list', label: 'Project Agents', count: k?.assigned ?? 0 }, { id: 'pool', label: 'Shared Pool', count: k?.pool ?? 0 }, { id: 'groups', label: 'Groups' }, { id: 'health', label: 'Connectivity' }]} />
      {tab === 'groups' ? <GroupsTab onNew={() => setModal({ g: null })} onEdit={(g) => setModal({ g })} newWhy={newWhy} /> : tab === 'health' ? <HealthTab /> : <FleetList key={tab} mode={tab === 'pool' ? 'pool' : 'project'} onNewGroup={() => setModal({ g: null })} newGroupWhy={newWhy} onAssign={(a) => setAssign({ a })} />}
      {modal && <GroupModal group={modal.g} onClose={() => setModal(null)} />}
      {assign && <AssignDrawer agent={assign.a} onClose={() => setAssign(null)} />}
    </>
  )
}


function Agents() {
  const route = useRoute()
  return (
    <>
      <AgentsContent
        initialTab={route.tab}
        header={(openAssign) => (
          <PageHeader title="Agents" sub="Connectivity and allocation are separate: an agent can be connected yet unassigned (Shared Pool). Each agent is used only in the project it is assigned to."
            actions={<Button variant="primary" icon={UserPlus} onClick={() => openAssign(null)}>Request assignment</Button>} />
        )}
      />
    </>
  )
}

/* ───────────── Detail (AG-02, ticket 48: typed service read + Query) ───────────── */

function AgentDetail() {
  const route = useRoute()
  const pid = useProjectStore((s) => s.pid)
  const me = useMe()
  const can = useCan()
  const services = useServices()
  const toast = useToastStore((s) => s.toast)
  const confirm = useSessionStore((s) => s.confirm)
  const setSwitcherOpen = useUiStore((s) => s.setSwitcherOpen)
  /* The legacy `A.audit` entry, mirrored exactly: one 'legacy' commit with the store helper's exact row shape. */
  const audit = (action: string, obj: string, projectId: string, result = 'Success', reason = '') =>
    recordAudit(services, { actor: { id: me.name, role: me.role }, projectId, corr: 'legacy' }, { action, obj, result, reason })
  const detail = useAgentDetail(route.id)
  const read = detail.data
  const tab = route.tab || 'overview'
  const guard = useGuard(read?.agent.projectId || (pid === 'all' ? undefined : pid))
  const [reveal, setReveal] = useState(false)
  const [assign, setAssign] = useState(false)
  const back = { label: 'Agents', to: () => go('agents') }
  if (detail.isPending) return <div aria-busy="true" aria-label="Loading agent"><PageSkeleton /></div>
  if (detail.isError) {
    const failure = (detail.error as AgentReadError).failure
    if (failure.kind === 'forbidden' && failure.entity?.projectId)
      return <><PageHeader title={`Agent ${route.id}`} back={back} /><Blocked title="Agent belongs to a different project" actions={<><Button onClick={() => go('agents')}>Back to agents</Button><Button onClick={() => selectProject('all')}>View all projects</Button></>}>{failure.message} Data is isolated between projects to prevent using the wrong resources.</Blocked></>
    return <><PageHeader title="Agent not found" back={back} /><Empty icon={Layers} title={`No agent “${route.id}”`} action={<Button onClick={() => go('agents')}>Back to agents</Button>}>The agent may have been removed, or your account has not been granted access to its project.</Empty></>
  }
  if (!read) return null
  const a = read.agent
  const isPool = !read.project
  const projectLabel = read.project ? `${read.project.id} — ${read.project.name}` : POOL_LABEL
  const projRO = read.project ? guard.ro : false
  const canManage = can('admin', a.projectId || undefined)
  const manageWhy = projRO ? guard.reason : !canManage ? 'Only Admins can disable or enable agents.' : ''
  const assignWhy = !isPool ? 'This agent is already assigned to a project.' : ''
  const activeSess = read.activeSessions
  const doDisable = () => confirm({
    title: `Disable ${a.id}?`, danger: true, confirmLabel: 'Disable agent', reasonLabel: 'Reason for disabling', reasonRequired: true,
    body: a.op ? <>This agent is used by operation <b>{a.op}</b>. Disabling it may move running steps on this agent to “Unknown”. The operation is not stopped automatically, so check it afterwards.</> : <>The agent cannot be selected for new operations until it is enabled again.</>,
    onConfirm: (r) => { setAgentStatusTransaction(services.authority, { actor: { id: me.name, role: me.role }, projectId: a.projectId, corr: 'legacy' }, a.id, 'disabled'); audit('Reason for disabling agent', a.id, a.projectId, 'Success', r); toast(`${a.id} disabled.`, 'warn') },
  })
  const doEnable = () => confirm({
    title: `Enable ${a.id}?`, confirmLabel: 'Enable agent', body: 'The agent can be selected for operations in its assigned project again.',
    onConfirm: () => { setAgentStatusTransaction(services.authority, { actor: { id: me.name, role: me.role }, projectId: a.projectId, corr: 'legacy' }, a.id, 'online'); toast(`${a.id} enabled.`) },
  })
  const hist = read.history
  const eligible = read.eligibleProjects
  const confidence = a.status === 'online' || a.status === 'idle' ? 'High: recent heartbeat (simulated)' : a.status === 'lost' ? 'Low: stale, heartbeat missing' : a.status === 'unhealthy' ? 'Medium: delayed heartbeats' : 'Unknown: not enough data'
  const lat = Array.from({ length: 6 }, (_, i) => 20 + ((hashNum(a.id) * (i + 2)) % 55))
  return (
    <>
      <PageHeader back={back}
        title={<span className="flex flex-wrap items-center gap-3"><Mono className="text-xl">{a.id}</Mono><span className="text-muted">{a.host}</span></span>}
        meta={<Status kind="agent" value={a.status} />}
        sub={`${a.os} · version ${a.version} · ${a.ip} · ${projectLabel}`}
        actions={<>
          <Button onClick={() => go('agent', { id: a.id, tab: 'log' })}>View Activity</Button>
          {a.op && <Button icon={ExternalLink} onClick={() => go('operation', { id: a.op! })}>View {a.op}</Button>}
          {(a.status === 'online' || a.status === 'idle') && !!a.projectId && <Button icon={WifiOff} disabled={!can('run') || projRO} title={projRO ? guard.reason : !can('run') ? 'Only Managers and Operators can simulate this.' : 'Demo: simulate a heartbeat loss (E2E-05)'} onClick={() => confirm({ title: `Simulate disconnect of ${a.id}?`, confirmLabel: 'Simulate disconnect', body: 'Demo only: marks the agent Disconnected so you can review the health-failure and replacement flow. Nothing real is disconnected.', onConfirm: () => { loseAgent(a.id); toast(`${a.id} marked disconnected (simulated).`, 'warn') } })}>Simulate disconnect</Button>}
          {isPool && <Button variant="primary" icon={UserPlus} disabled={!!assignWhy} title={assignWhy || 'Request assignment to a project (approval-gated)'} onClick={() => setAssign(true)}>Request Assignment</Button>}
          {a.status === 'disabled' ? <Button icon={Power} disabled={!!manageWhy} title={manageWhy || 'Enable agent'} onClick={doEnable}>Enable Agent</Button> : <Button variant="danger" icon={Power} disabled={!!manageWhy} title={manageWhy || 'Disable agent'} onClick={doDisable}>Disable Agent</Button>}
        </>} />
      {isPool && <Banner tone="warn" title="Agent is not assigned to a project">This agent is in the shared pool and cannot join operations yet. {pid === 'all' ? <>Select a project, then request assignment. <button className="underline" onClick={() => setSwitcherOpen(true)}>Select project</button></> : 'Use “Request Assignment” to assign it through the review process.'}</Banner>}
      {a.status === 'lost' && <FailurePanel a={a} />}
      {a.status === 'unhealthy' && <Banner tone="warn" title="Agent is unhealthy">Heartbeats are delayed or intermittent. Last verified: {a.lastSeen}. Check the connectivity tab before relying on this agent.</Banner>}
      {a.status === 'disabled' && <Banner tone="warn" title="Agent is disabled">This agent cannot be selected for new operations. Use “Enable Agent” to turn it back on.</Banner>}
      {((isPool && assignWhy) || manageWhy) ? <div className="-mt-2 mb-4 flex flex-col gap-1">{isPool && assignWhy && <Locked reason={`Request Assignment: ${assignWhy}`} />}{manageWhy && <Locked reason={`Disable / enable: ${manageWhy}`} />}</div> : null}
      <Tabs value={tab} onChange={(t) => go('agent', { id: a.id, tab: t })} tabs={[{ id: 'overview', label: 'Overview' }, { id: 'conn', label: 'Connectivity' }, { id: 'ops', label: 'Operations & Sessions', count: read.operations.length + activeSess.length }, { id: 'log', label: 'Event History' }, { id: 'perm', label: 'Policy' }]} />
      {tab === 'overview' && (
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="space-y-4 xl:col-span-2"><Card><CardHeader title="Connection vs assignment" sub="Connectivity and allocation are independent states." />
            <DescList cols={3} items={[
              { k: 'Connection status', v: <Status kind="agent" value={a.status} /> },
              { k: 'Assignment status', v: isPool ? <span className="text-warn">Unassigned (shared pool)</span> : <span>Assigned to <Id>{a.projectId}</Id></span> },
              { k: 'Current reservation', v: a.op ? <span>Reserved by <IdL onClick={() => go('operation', { id: a.op! })}>{a.op}</IdL></span> : 'None' },
              { k: 'Eligible projects', v: isPool ? (eligible.length ? eligible.join(', ') : 'None approved or active') : a.projectId },
              { k: 'Last verified', v: <span className={a.status === 'lost' ? 'text-bad' : ''}>{a.lastSeen}</span> },
              { k: 'Health confidence', v: confidence },
            ]} />
            <div className="mt-3 flex flex-wrap gap-3 text-xs">{a.op && <IdL onClick={() => go('operation', { id: a.op! })}>{a.op}</IdL>}{activeSess[0] && <IdL onClick={() => go('c2-session', { id: activeSess[0].id })}>{activeSess[0].id}</IdL>}<button className="text-accent hover:underline" onClick={() => go('agent', { id: a.id, tab: 'log' })}>Event history</button></div>
          </Card>
          <Card><CardHeader title="Identity & platform" />
            <DescList cols={3} items={[
              { k: 'Hostname', v: <Mono>{a.host}</Mono> }, { k: 'IP address', v: <Mono>{a.ip}</Mono> }, { k: 'OS / platform', v: a.os },
              { k: 'Version', v: <Mono>{a.version}</Mono> }, { k: 'Connection type', v: a.conn }, { k: 'Status', v: <Status kind="agent" value={a.status} /> },
              { k: 'Last verified', v: <span className={a.status === 'lost' ? 'text-bad' : ''}>{a.lastSeen}</span> },
              { k: 'Assigned project', v: isPool ? <span className="text-warn">{POOL_LABEL}</span> : <IdLink onClick={() => go('project', { id: a.projectId })}>{a.projectId}</IdLink> },
              { k: 'Group', v: a.group || 'Not in a group' },
              { k: 'Current operation', v: a.op ? <IdLink onClick={() => go('operation', { id: a.op! })}>{a.op}</IdLink> : 'None' },
              { k: 'C2 channel', v: activeSess[0]?.channelId && activeSess[0].channelId !== '—' ? <IdLink onClick={() => go('c2-channel', { id: activeSess[0].channelId })}>{activeSess[0].channelId}</IdLink> : 'None referenced' },
              { k: 'Active sessions', v: activeSess.length },
            ]} />
          </Card></div>
          <Card><CardHeader title="Recent connectivity" sub="Latency in ms, simulated" />
            <LineChart labels={['-50m', '-40m', '-30m', '-20m', '-10m', 'Now']} series={[{ name: 'Latency', values: a.status === 'lost' ? [lat[0], lat[1], lat[2], 0, 0, 0] : lat, color: 'var(--c-cyan)' }]} height={140} />
            <p className="mt-2 text-xs text-muted">Status reflects the most recent observation. It does not guarantee the agent can perform tasks.</p>
          </Card>
          <Card className="xl:col-span-3"><CardHeader title="Recent activity" /><Timeline items={hist.slice(0, 6)} /></Card>
        </div>
      )}
      {tab === 'conn' && (
        <Card><CardHeader title="Connection health & heartbeat" sub="Simulated data, not live measurements." />
          <div className="mb-4"><Heartbeat a={a} /></div>
          <DescList cols={3} items={[{ k: 'Channel', v: a.conn }, { k: 'Average latency', v: a.status === 'lost' ? '—' : <Mono>{Math.round(lat.reduce((x, y) => x + y, 0) / lat.length)} ms</Mono> }, { k: 'Last verified', v: a.lastSeen }, { k: 'Alert threshold', v: '15 minutes' }, { k: 'Heartbeat', v: a.status === 'lost' ? <span className="text-bad">Signal lost</span> : a.status === 'unhealthy' ? <span className="text-warn">Delayed</span> : 'Every 30 seconds' }, { k: 'Version', v: a.version }]} />
          {a.status === 'lost' && <div className="mt-4 flex flex-wrap items-center gap-3"><Button disabled={guard.ro || !can('run')} onClick={() => { restoreAgent(a.id); toast(`${a.id} connection restored (simulated).`) }} title={guard.ro ? guard.reason : !can('run') ? 'Only Managers and Operators can restore connections.' : ''}>Restore connection (simulated)</Button>{(guard.ro || !can('run')) && <Locked reason={guard.ro ? guard.reason : 'Only Managers and Operators can restore connections.'} />}</div>}
        </Card>
      )}
      {tab === 'ops' && (
        <div className="space-y-4">
          <Card pad={false} className="p-0"><div className="p-4 pb-0"><CardHeader title="Active sessions" sub={activeSess.length ? undefined : 'No active sessions on this agent.'} actions={<Button size="sm" onClick={() => go('c2', { tab: 'sessions' })}>View Active Sessions</Button>} /></div>
            {activeSess.length > 0 && <ul className="divide-y divide-line">{activeSess.map((s) => <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm"><IdLink onClick={() => go('c2-session', { id: s.id })}>{s.id}</IdLink><span className="text-muted">{s.asset}</span><span className="ml-auto text-xs capitalize text-muted">{s.state}</span></li>)}</ul>}
          </Card>
          {a.status === 'lost' && <Banner tone="warn" title="Stale data">Branch and session states below reflect the last observation before disconnect ({a.lastSeen}). Paused or Unknown branches are not completed and need re-run or reassignment.</Banner>}
          <Card pad={false} className="p-0"><div className="p-4 pb-0"><CardHeader title={`Branches handled by ${a.id}`} sub="Fan-out branches (Demo Data). Agents AG-xxx are separate from AI workers." /></div>
            {!read.branches.length ? <p className="px-4 pb-4 text-sm text-muted">No fan-out branches are assigned to this agent.</p> : <ul className="divide-y divide-line">{read.branches.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm"><IdL onClick={() => go('ai-branch', { id: b.id })}>{b.id}</IdL><span className="whitespace-nowrap rounded-full border border-line px-2 py-0.5 text-xs">{BRANCH_LABEL[b.state]}</span><span className="min-w-0 truncate text-muted" title={b.target}>{b.target}</span><span className="text-xs text-muted">{b.tool}</span><span className="ml-auto flex items-center gap-3 text-xs"><IdL onClick={() => go('operation', { id: b.opId })}>{b.opId}</IdL><IdL onClick={() => go('ai-fanout', { id: b.groupId })}>{b.groupId}</IdL></span></li>
            ))}</ul>}
          </Card>
          <Table rows={read.operations} rowKey={(o) => o.id} onRow={(o) => go('operation', { id: o.id })} empty={<Empty icon={Layers} title="This agent has not joined any operation">Operations appear here once the agent is selected for a test run.</Empty>}
            cols={[{ key: 'id', header: 'Operation', render: (o) => <Mono className="text-accent">{o.id}</Mono> }, { key: 'n', header: 'Name', render: (o) => o.name }, { key: 'p', header: 'Project', hideBelow: 'md', render: (o) => o.projectId }, { key: 's', header: 'Status', render: (o) => <Status kind="op" value={o.status} /> }, { key: 'st', header: 'Started', hideBelow: 'md', render: (o) => o.startedAt }]} />
        </div>
      )}
      {tab === 'log' && <Card><CardHeader title="Event history" sub="Sanitized content; no secrets or tokens." /><Timeline items={hist} /></Card>}
      {tab === 'perm' && (
        <Card><CardHeader title="Policy & permissions" />
          <DescList cols={2} items={[
            { k: 'Allowed project', v: isPool ? POOL_LABEL : projectLabel }, { k: 'Group', v: a.group || '—' },
            { k: 'Group policy', v: read.group?.policy || 'No group policy applied' },
            { k: 'Concurrent use', v: 'One operation at a time' },
            { k: 'Agent identifier (masked)', v: <span className="flex items-center gap-2"><Mono>{read.canViewSensitive && reveal ? `agt_${hashNum(a.id)}x9f${a.id.slice(-3)}` : '••••••••••••••'}</Mono>{read.canViewSensitive ? <button className="text-xs text-accent hover:underline" onClick={() => setReveal(!reveal)}>{reveal ? 'Hide' : 'Show'}</button> : <Locked reason={`The ${me.role} role cannot view this value`} />}</span> },
          ]} />
        </Card>
      )}
      {assign && <AssignDrawer agent={a} onClose={() => setAssign(false)} />}
    </>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- registry record co-located with its screen components
export const agentRoutes = { agents: withLoading(Agents), agent: withLoading(AgentDetail) }
