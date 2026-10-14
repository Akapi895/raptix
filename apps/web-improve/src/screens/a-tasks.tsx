import { useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useServices } from '../state/services'
import { readActor } from '../auth/identity'
import { useAuthStore, useProjectStore, useToastStore } from '../state/stores'
import { useSessionStore } from '../state/session'
import { decideApprovalTransaction } from '../features/approvals/service'
import { decidePlanTransaction } from '../features/plans/service'
import { readPlanProject } from '../features/plans/bridge'
import { decideSessionRequestTransaction } from '../features/c2/grants'
import { readSessionRequestMeta } from '../features/c2/projection'
import { Button, Card, Empty, Gated, Mono, PageHeader, PageSkeleton, Segmented, Status, cx } from '../ui'
import { ErrorNotice } from './a-dashboard'
import { useConsoleGo } from './dashboard/use-dashboard'
import { formatCountdown } from './dashboard/domain'
import { useTasks } from './tasks/use-tasks'
import { minutesLeft, TASK_KINDS } from './tasks/domain'
import type { TaskItem, TaskKind } from './tasks/domain'

const KIND_LABEL: Record<TaskKind, string> = { project: 'Projects', scope: 'Scope', closure: 'Closure', plan: 'Plans', access: 'Access', report: 'Reports', finding: 'Findings' }

export function MyTasks() {
  const go = useConsoleGo()
  const pid = useProjectStore((s) => s.pid)
  const { data, isError, error, refetch, now } = useTasks()
  const services = useServices()
  const confirm = useSessionStore((s) => s.confirm)
  const toast = useToastStore((s) => s.toast)
  const [kind, setKind] = useState<'all' | TaskKind>('all')
  const [mineOnly, setMineOnly] = useState(false)
  const all = pid === 'all'

  if (!data) {
    return (
      <div>
        <PageHeader title="Tasks & Approval Inbox" sub="Approvals and reviews waiting for a decision." />
        {isError ? <ErrorNotice message={error?.message} retry={refetch} /> : <PageSkeleton />}
      </div>
    )
  }
  const { tasks, counts, mine } = data.summary

  /* Ticket 67 wave 3: the legacy A.decide* entries, mirrored — the plan and
     access-request project lookups resolve through the typed plans/c2
     bridge reads at call time, the request context captures the current
     persona (the override-aware `me`, resolved through the identity service
     so a failing authority read never reaches this render) with corr
     'legacy', and the typed result bridges back to the legacy Res shape. */
  const actorCtx = (projectId: string) => ({ actor: readActor(services, useAuthStore.getState().meName), projectId, corr: 'legacy' })
  const decidePlan = (planId: string, decision: 'approved' | 'rejected' | 'returned', note: string) => {
    const projectId = readPlanProject(services.authority, planId)
    if (!projectId) return { ok: false as const, error: `Plan ${planId} does not exist.` }
    const res = decidePlanTransaction(services.authority, services.clock, actorCtx(projectId), planId, decision, note)
    return res.ok ? { ok: true as const } : { ok: false as const, error: res.failure.message }
  }
  const decideApproval = (id: string, decision: 'approved' | 'returned', note: string) => {
    const res = decideApprovalTransaction(services.authority, services.clock, actorCtx(''), id, decision, note)
    return res.ok ? { ok: true as const } : { ok: false as const, error: res.failure.message }
  }
  const decideSessionRequest = (id: string, decision: 'approved' | 'rejected' | 'changes', note: string, minutes?: number) => {
    const r = readSessionRequestMeta(services, id)
    if (!r) return { ok: false as const, error: `Access request ${id} does not exist.` }
    const res = decideSessionRequestTransaction(services.authority, services.clock, actorCtx(r.projectId), { requestId: id, decision, note, minutes })
    return res.ok ? { ok: true as const } : { ok: false as const, error: res.failure.message }
  }

  const decide = (title: string, confirmLabel: string, danger: boolean, fn: (reason: string) => { ok: boolean; error?: string } | void, okMsg: string, reasonRequired: boolean) =>
    confirm({ title, body: 'Your decision and reason are recorded in the audit log.', confirmLabel, danger, reasonLabel: reasonRequired ? 'Reason (required)' : 'Reason (optional)', reasonRequired, onConfirm: (reason) => { const r = fn(reason); if (r && !r.ok) toast(r.error || 'Could not complete the decision.', 'bad'); else toast(okMsg, 'ok') } })


  const open = (t: TaskItem) => () => go(t.to.page, { id: t.to.id, tab: t.to.tab })

  const actions = (t: TaskItem): ReactNode => {
    if (t.kind === 'plan') return <>
      <Gated allowed={t.allowed} reason={t.why}><Button size="sm" variant="primary" onClick={() => decide(`Approve plan ${t.id}`, 'Approve plan', false, (r) => decidePlan(t.id, 'approved', r), `Plan ${t.id} approved.`, false)}>Approve</Button></Gated>
      <Gated allowed={t.allowed} reason={t.why}><Button size="sm" onClick={() => decide(`Reject plan ${t.id}`, 'Reject plan', true, (r) => decidePlan(t.id, 'rejected', r), `Plan ${t.id} rejected.`, true)}>Reject</Button></Gated>
    </>
    if (t.kind === 'access') return <>
      <Gated allowed={t.allowed} reason={t.why}><Button size="sm" variant="primary" onClick={() => decide(`Approve session access ${t.id}`, 'Approve access', false, (n) => decideSessionRequest(t.id, 'approved', n), `Access ${t.id} approved.`, false)}>Approve</Button></Gated>
      <Gated allowed={t.allowed} reason={t.why}><Button size="sm" onClick={() => decide('Request changes', 'Request changes', false, (n) => decideSessionRequest(t.id, 'changes', n), `Changes requested on ${t.id}.`, true)}>Request changes</Button></Gated>
      <Gated allowed={t.allowed} reason={t.why}><Button size="sm" onClick={() => decide('Reject access request', 'Reject', true, (n) => decideSessionRequest(t.id, 'rejected', n), `Access ${t.id} rejected.`, true)}>Reject</Button></Gated>
    </>
    if (t.kind === 'report') return <Gated allowed={t.allowed} reason={t.why}><Button size="sm" variant="primary" onClick={open(t)}>Review report</Button></Gated>
    if (t.kind === 'finding') return <Gated allowed={t.allowed} reason={t.why}><Button size="sm" variant="primary" onClick={open(t)}>Review finding</Button></Gated>
    return <>
      <Gated allowed={t.allowed} reason={t.why}>
        <Button size="sm" variant="primary" onClick={() => decide(`Approve ${t.label.toLowerCase()}`, 'Approve', false, (r) => decideApproval(t.id, 'approved', r), `${t.id} approved.`, false)}>Approve</Button>
      </Gated>
      <Gated allowed={t.allowed} reason="Return requires the same approver role.">
        <Button size="sm" onClick={() => decide(`Return ${t.label.toLowerCase()} for changes`, 'Return', true, (r) => decideApproval(t.id, 'returned', r), `${t.id} returned for changes.`, true)}>Return</Button>
      </Gated>
    </>
  }

  const rows = tasks.filter((t) => (kind === 'all' || t.kind === kind) && (!mineOnly || t.allowed))

  return (
    <div>
      <PageHeader title="Tasks & Approval Inbox" sub="Approvals and reviews waiting for a decision. Approve or return happens with scope and reason; items your role cannot decide explain why." meta={<span className="rounded-full border border-line bg-subtle px-2 py-0.5 text-xs text-muted">{mine} actionable by you</span>} />
      {isError && <ErrorNotice message={error?.message} retry={refetch} />}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented value={kind} onChange={setKind} options={[
          { id: 'all', label: `All (${tasks.length})` }, ...TASK_KINDS.map((k) => ({ id: k, label: `${KIND_LABEL[k]} (${counts[k]})` })),
        ]} />
        <Segmented value={mineOnly ? 'mine' : 'all'} onChange={(v) => setMineOnly(v === 'mine')} options={[{ id: 'all', label: 'All tasks' }, { id: 'mine', label: `Assigned to me (${mine})` }]} />
        {all && <span className="text-xs text-muted">Showing tasks across all accessible projects.</span>}
      </div>
      {rows.length === 0 ? (
        <Card><Empty icon={CheckCircle2} title="You're all caught up" action={<Button size="sm" onClick={() => go('command-center')}>Back to Command Center</Button>}>{kind === 'all' ? mineOnly ? 'Nothing is assigned to your role. Switch to All tasks to see read-only items.' : 'No approvals or reviews are waiting.' : 'No tasks of this type. Choose “All” to see other types.'}</Empty></Card>
      ) : (
        <ul className="space-y-3">
          {rows.map((t) => (
            <li key={t.kind + t.id}>
              <Card>
                <div className="flex flex-wrap items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-line bg-subtle px-2 py-0.5 text-xs font-medium text-muted">{t.label}</span>
                      <Status kind="approval" value="pending" size="sm" />
                      {!t.allowed && <span className="text-xs text-muted">Read-only for your role</span>}
                      {t.expiresAt !== undefined && (() => {
                        const mins = minutesLeft(t.expiresAt, now)
                        return <span className={cx('text-xs tabular-nums', mins !== undefined && mins <= 0 ? 'font-medium text-warn' : 'text-muted')}>{formatCountdown(mins)}</span>
                      })()}
                    </div>
                    <button onClick={open(t)} className="text-left text-sm font-semibold hover:underline">{t.title}</button>
                    <p className="mt-0.5 text-sm text-muted">{t.sub}</p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted"><span>Project <Mono>{t.project}</Mono></span><span>From {t.by}</span><span>{t.at}</span></div>
                    {!t.allowed && <p className="mt-2 text-xs text-muted"><AlertTriangle size={12} className="mr-1 inline text-warn" aria-hidden />{t.why} <button onClick={open(t)} className="text-accent hover:underline">View details</button></p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">{actions(t)}<Button size="sm" variant="ghost" onClick={open(t)}>Details</Button></div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
