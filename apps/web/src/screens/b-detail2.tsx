import { useState } from 'react'
import { Download, FileText, Lock, Pencil, Plus, Trash2, ChevronDown, ChevronRight, CheckCircle2, XCircle } from 'lucide-react'
import { useServices } from '../state/services'
import { ROLE_LABEL } from '../auth/policy'
import { setProjectMembers } from '../features/projects/team-service'
import { useReopen } from '../features/approvals/hooks'
import { DocumentWorkspace } from '../features/documents/workspace'
import { AssetPreviewModal } from '../features/assets/preview-modal'
import { APR, USERS, type Project, type Role, type Approval } from '../data'
import { decideApprovalTransaction, reviseScopeTransaction, submitApprovalTransaction, type ScopeFieldPatch } from '../features/approvals/service'
import { confirmCloseTransaction, requestCloseTransaction } from '../features/closure/service'
import { useCan, useMe } from '../state/console'
import { useSessionStore } from '../state/session'
import { useProjectStore, useToastStore } from '../state/stores'
import { go, selectProject } from '../router/navigate'
import type { DashboardAggregate } from './dashboard/domain'
import type { ProjectDetail } from './project-detail/service'
import { Banner, Button, Check, Card, CardHeader, DescList, Drawer, Empty, Field, FilterBar, IconButton, IdLink, Input, Kpi, Locked, Modal, PersonaHint, Person, Progress, SearchBox, Segmented, Select, Status, Table, Textarea, useGuard, type Col } from '../ui'

/* Ticket 21: ScopeTab/TeamTab mutations run through the ticket-21 approval
 * and scope-revision transaction handlers (via the delegating store actions),
 * so refusals render the handler's reason. Reads come from the detail
 * service's typed slices (the `ds` aggregate prop b-detail passes down).
 * Ticket 23: the close console renders the service-derived checklist too —
 * ticket 22's policy derivation over the same snapshot (base + waiver
 * variants plus the waiver precondition) — and its counts come from the
 * typed slices; the panel never reads the legacy store database and never
 * duplicates the request/confirm handlers' enforcement. */

/** Approval types the scope version history lists (typed, no `any`). */
export function TeamTab({ p, ds }: { p: Project; ds: DashboardAggregate }) {
  const services = useServices()
  const me = useMe()
  const can = useCan()
  const confirm = useSessionStore((s) => s.confirm)
  const toast = useToastStore((s) => s.toast)
  const guard = useGuard(p.id)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [add, setAdd] = useState(false)
  const [nu, setNu] = useState<{ user: string; role: Role }>({ user: '', role: 'operator' })
  /* Ticket 67 wave 3: the legacy A.decideApproval/A.confirmClose entries mirrored —
     the transactions run directly with the same request context and Res bridge. */
  const decideApproval = (id: string, decision: 'approved' | 'returned', note: string) => {
    const res = decideApprovalTransaction(services.authority, services.clock, { actor: { id: me.name, role: me.role }, projectId: '', corr: 'legacy' }, id, decision, note)
    return res.ok ? { ok: true as const } : { ok: false as const, error: res.failure.message }
  }
  const confirmClose = (apId: string) => {
    const res = confirmCloseTransaction(services.authority, services.clock, { actor: { id: me.name, role: me.role }, projectId: '', corr: 'legacy' }, apId)
    return res.ok ? { ok: true as const } : { ok: false as const, error: res.failure.message }
  }
  const canEdit = !guard.ro && can('editScope', p.id)
  const why = guard.ro ? guard.reason : 'Only a Red Team Manager or Organization Admin can manage members.'
  const appr = ds.approvals
  const pend = appr.filter((a) => a.status === 'pending')
  const mayApprove = can('approve', p.id)
  const names = Array.from(new Set(USERS.map((u) => u.name))).filter((n) => !p.members.some((m) => m.user === n) && n !== p.owner)

  // Membership and audit publish atomically through the project service.
  const setMembers = (members: Project['members'], act: string, obj: string) => {
    const res = setProjectMembers(services, { actor: { id: me.name, role: me.role }, projectId: p.id, corr: 'legacy' }, members, act, obj)
    if (!res.ok) { toast(res.failure.message, 'bad'); return }
    toast(act)
  }
  const changeRole = (user: string, role: Role) => setMembers(p.members.map((m) => (m.user === user ? { ...m, role } : m)), `Changed ${user}'s role to ${ROLE_LABEL[role]}`, user)
  const remove = (user: string) => confirm({ title: `Remove ${user} from the project?`, body: 'The member loses access to the project immediately.', confirmLabel: 'Remove member', danger: true, onConfirm: () => setMembers(p.members.filter((m) => m.user !== user), `Removed ${user} from the project`, user) })

  const decide = (a: Approval, d: 'approved' | 'returned', note: string) => {
    const r = decideApproval(a.id, d, note)
    if (!r.ok) { setErr(r.error || 'Could not complete the decision'); return }
    setErr(''); toast(d === 'approved' ? `Approved: ${a.type}` : `Returned: ${a.type}`)
  }
  const approve = (a: Approval) => confirm({ title: `Approve “${a.type}”?`, body: `Project ${p.id} moves to its next state based on this decision.`, confirmLabel: 'Approve', reasonLabel: 'Comment (optional)', onConfirm: (r) => { if (a.type !== APR.close) { decide(a, 'approved', r); return } /* Ticket 22: closure resolution is gated by the handler (four-eyes + re-derived checklist); the refusal renders here. */ const c = confirmClose(a.id); if (c.ok) toast('Project closure confirmed'); else setErr(c.error || 'Could not confirm closure') } })
  const ret = (a: Approval) => confirm({ title: `Request changes to “${a.type}”`, body: 'The submitter is notified with your reason so they can revise and resubmit.', confirmLabel: 'Request Changes', danger: true, reasonLabel: 'Reason for changes', reasonRequired: true, onConfirm: (r) => decide(a, 'returned', r) })
  const more = (a: Approval) => confirm({ title: 'Request more information', body: 'The request is returned to the submitter with what is needed.', confirmLabel: 'Send request', reasonLabel: 'Information needed', reasonRequired: true, onConfirm: (r) => decide(a, 'returned', 'More information requested: ' + r) })

  type M = Project['members'][number]
  const mcols: Col<M>[] = [
    { key: 'u', header: 'Member', render: (m) => <Person name={m.user} /> },
    { key: 'r', header: 'Project role', render: (m) => (canEdit ? <Select aria-label={`Role of ${m.user}`} className="w-52" value={m.role} onChange={(e) => changeRole(m.user, e.target.value as Role)}>{(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select> : ROLE_LABEL[m.role]) },
    { key: 'perm', header: 'Permissions', render: (m) => <span className="text-muted">{m.role === 'viewer' ? 'View only' : m.role === 'reviewer' ? 'View, approve' : m.role === 'operator' ? 'View, execute' : 'Manage'}</span>, hideBelow: 'md' },
    { key: 's', header: 'Joined', render: (m) => <span className="font-mono text-xs text-muted">{m.since}</span>, hideBelow: 'md' },
    { key: 'a', header: '', render: (m) => <IconButton icon={Trash2} label={`Remove ${m.user}`} disabled={!canEdit} title={canEdit ? `Remove ${m.user}` : why} onClick={() => remove(m.user)} /> },
  ]

  return (
    <div className="space-y-6">
      {pend.length > 0 && !mayApprove && (
        <PersonaHint need="a Reviewer or Admin" persona={pend[0].reviewer}>The “{pend[0].type}” request is waiting for {pend[0].reviewer}. The {ROLE_LABEL[me.role]} role cannot approve it.</PersonaHint>
      )}
      {err && <Banner tone="bad" title="Cannot approve">{err}</Banner>}

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Approval requests ({appr.length})</h3>
          <Button size="sm" onClick={() => go('tasks')}>Open in Tasks & Approvals</Button>
        </div>
        {appr.length === 0 ? <Empty title="No approval requests">Request approval to start the project and ROE review.</Empty> : (
          <div className="space-y-3">
            {appr.map((a) => (
              <Card key={a.id}>
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{a.type}</span><Status kind="approval" value={a.status} /><span className="font-mono text-xs text-muted">{a.id}</span></div>
                    <div className="mt-1 text-xs text-muted">Submitted by {a.by} · Reviewer {a.reviewer} · {a.at}</div>
                    {a.note && <p className="mt-2 text-sm">{a.note}</p>}
                    {a.diff && (
                      <button className="mt-2 inline-flex items-center gap-1 text-xs text-accent" aria-expanded={open === a.id} onClick={() => setOpen(open === a.id ? null : a.id)}>{open === a.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}Change details</button>
                    )}
                    {open === a.id && a.diff && <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-hover p-3 font-mono text-xs">{a.diff}</pre>}
                  </div>
                  {a.status === 'pending' && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="primary" disabled={!mayApprove || guard.ro} title={mayApprove ? undefined : 'Only a Reviewer or Admin can approve'} onClick={() => approve(a)}>{a.type === APR.close ? 'Approve Closure' : 'Approve'}</Button>
                      <Button variant="danger" disabled={!mayApprove || guard.ro} title={mayApprove ? undefined : 'Only a Reviewer or Admin can request changes'} onClick={() => ret(a)}>Request Changes</Button>
                      {a.type !== APR.close && <Button disabled={!mayApprove || guard.ro} title={mayApprove ? undefined : 'Only a Reviewer or Admin can request more information'} onClick={() => more(a)}>Request more info</Button>}
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Members ({p.members.length + 1})</h3>
          <div className="flex items-center gap-2">{!canEdit && <Locked reason={why} />}<Button icon={Plus} disabled={!canEdit} title={canEdit ? undefined : why} onClick={() => setAdd(true)}>Add Member</Button></div>
        </div>
        <div className="mb-2 flex items-center gap-3 rounded-lg border border-line bg-panel px-3 py-2 text-sm"><Person name={p.owner} /><span className="text-muted">Project owner</span></div>
        <Table cols={mcols} rows={p.members} rowKey={(m) => m.user} empty={<Empty title="No other members">Add operators, reviewers or client viewers to grant access.</Empty>} />
      </section>

      <Modal open={add} onClose={() => setAdd(false)} title="Add Member" footer={<><Button onClick={() => setAdd(false)}>Cancel</Button><Button variant="primary" disabled={!nu.user} title={nu.user ? undefined : 'Select a user'} onClick={() => { setMembers([...p.members, { user: nu.user, role: nu.role, since: 'Oct 13, 2026' }], `Added ${nu.user} to the project`, nu.user); setAdd(false); setNu({ user: '', role: 'operator' }) }}>Add</Button></>}>
        <div className="space-y-4">
          <Field label="User" required><Select value={nu.user} onChange={(e) => setNu({ ...nu, user: e.target.value })}><option value="">Select a user…</option>{names.map((n) => <option key={n}>{n}</option>)}</Select></Field>
          <Field label="Role"><Select value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value as Role })}>{(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select></Field>
        </div>
      </Modal>
    </div>
  )
}

/* ───────────── PR-09 Closure ───────────── */
export function CloseTab({ p, d, setTab }: { p: Project; d: ProjectDetail; setTab: (t: string) => void }) {
  const services = useServices()
  const me = useMe()
  const can = useCan()
  const confirm = useSessionStore((s) => s.confirm)
  const toast = useToastStore((s) => s.toast)
  const guard = useGuard(p.id)
  const reopen = useReopen(p)
  /* Ticket 67 wave 3: the legacy A.confirmClose/A.requestClose entries mirrored —
     the closure transactions run directly with the same request context and Res bridge. */
  const confirmClose = (apId: string) => {
    const res = confirmCloseTransaction(services.authority, services.clock, { actor: { id: me.name, role: me.role }, projectId: '', corr: 'legacy' }, apId)
    return res.ok ? { ok: true as const } : { ok: false as const, error: res.failure.message }
  }
  const requestClose = (pid_: string, input?: { reason?: string; waiverNoFindings?: boolean }) => {
    const res = requestCloseTransaction(services.authority, services.clock, { actor: { id: me.name, role: me.role }, projectId: pid_, corr: 'legacy' }, pid_, { reason: input?.reason ?? '', waiverNoFindings: input?.waiverNoFindings })
    return res.ok ? { ok: true as const } : { ok: false as const, error: res.failure.message }
  }
  const [modal, setModal] = useState(false)
  const [reason, setReason] = useState('')
  const [noFind, setNoFind] = useState(false)
  /* Ticket 22/23: the checklist is the closure service's canonical derivation
     over the service read's snapshot — base variant plus the waiver variant
     the request-time checkbox selects. The panel never re-derives policy. */
  const ds = d.aggregate
  const noFindingsOk = d.noFindingsWaiverOk
  const items = noFind && noFindingsOk ? d.closeWaived : d.close
  const ops = ds.operations.filter((o) => o.projectId === p.id)
  const fs = ds.findings.filter((f) => f.projectId === p.id)
  const reps = ds.reports.filter((r) => r.projectId === p.id)
  const evs = d.evidence
  const closePending = ds.approvals.find((a) => a.projectId === p.id && a.type === APR.close && a.status === 'pending')
  const objDone = p.objectives.filter((o) => o.progress >= 100).length
  const final = reps.find((r) => r.status === 'delivered') || reps[0]
  const closed = p.status === 'closed'
  const eligible = ['active', 'approved', 'paused'].includes(p.status) && !closePending
  const failing = items.filter((i) => !i.ok)
  const canReq = can('requestClose', p.id)
  const ownerOk = p.members.some((m) => m.role === 'manager') || !!p.owner

  return (
    <div className="space-y-5">
      {closed && <Banner tone="info" icon={Lock} title={`Closed on ${p.closedAt || '—'}. Read-only`}>This project is read-only. Reports, evidence and audit remain viewable; no operation, edit or session can start. Review its <button className="text-accent underline" onClick={() => setTab('activity')}>activity</button> and <button className="text-accent underline" onClick={() => setTab('audit')}>audit log</button> for reconciliation.</Banner>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Objectives complete" value={`${objDone}/${p.objectives.length}`} sub={p.objectives.length ? undefined : 'No objectives yet'} onClick={() => setTab('objectives')} />
        <Kpi label="Active operations" value={ops.filter((o) => ['running', 'paused'].includes(o.status)).length} tone={ops.some((o) => ['running', 'paused'].includes(o.status)) ? 'warn' : 'ok'} onClick={() => setTab('operations')} />
        <Kpi label="Unreviewed findings" value={fs.filter((f) => ['draft', 'review', 'returned'].includes(f.status)).length} tone={fs.some((f) => ['draft', 'review', 'returned'].includes(f.status)) ? 'warn' : 'ok'} onClick={() => setTab('findings')} />
        <Kpi label="Final report" value={final ? <Status kind="report" value={final.status} size="sm" /> : 'None'} onClick={() => setTab('reports')} />
        <Kpi label="Evidence" value={evs.length} sub={`${evs.filter((e) => e.sensitive).length} sensitive, retained per policy`} onClick={() => setTab('evidence')} />
      </div>

      <Card>
        <CardHeader title="Closeout checklist" sub={`${items.filter((i) => i.ok).length + (ownerOk ? 1 : 0)}/${items.length + 1} conditions met`} />
        <Progress value={Math.round(((items.filter((i) => i.ok).length + (ownerOk ? 1 : 0)) / (items.length + 1)) * 100)} tone={failing.length ? 'warn' : 'ok'} label="Closure conditions" />
        <ul className="mt-3 divide-y divide-line/60">
          {items.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 py-3">
              <Status kind="check" value={i.ok ? 'pass' : 'fail'} />
              <div className="min-w-0 flex-1"><div className="text-sm font-medium">{i.label}</div><div className="text-xs text-muted">{i.detail}</div></div>
              {!i.ok && <Button size="sm" onClick={() => go(i.fix.page, { id: i.fix.id, tab: i.fix.tab })}>Fix</Button>}
            </li>
          ))}
          <li className="flex flex-wrap items-center gap-3 py-3">
            <Status kind="check" value={evs.length ? 'pass' : 'review'} />
            <div className="min-w-0 flex-1"><div className="text-sm font-medium">Evidence stored</div><div className="text-xs text-muted">{evs.length ? `${evs.length} items retained per policy` : 'No evidence in this project'}</div></div>
          </li>
          <li className="flex flex-wrap items-center gap-3 py-3">
            <Status kind="check" value={closed ? 'pass' : 'review'} />
            <div className="min-w-0 flex-1"><div className="text-sm font-medium">Sign-off by Reviewer or Admin</div><div className="text-xs text-muted">{closed ? `Signed off ${p.closedAt || ''}` : closePending ? 'Awaiting sign-off' : 'Requested after the checks above pass'}</div></div>
          </li>
          <li className="flex flex-wrap items-center gap-3 py-3">
            <Status kind="check" value="pass" />
            <div className="min-w-0 flex-1"><div className="text-sm font-medium">Audit trail retained</div><div className="text-xs text-muted">Closing never deletes logs. <button className="text-accent underline" onClick={() => setTab('audit')}>Open audit</button></div></div>
          </li>
          <li className="flex flex-wrap items-center gap-3 py-3">
            <Status kind="check" value={ownerOk ? 'pass' : 'fail'} />
            <div className="min-w-0 flex-1"><div className="text-sm font-medium">Handover owner assigned</div><div className="text-xs text-muted">{ownerOk ? `Owner: ${p.owner}; closure is confirmed by a Reviewer or Admin` : 'No owner assigned'}</div></div>
          </li>
        </ul>
      </Card>

      <Card>
        <CardHeader title="Closure actions" />
        {closed ? (
          can('reopen', p.id) ? <div className="flex flex-wrap items-center gap-3"><Button variant="danger" onClick={reopen}>Reopen Project</Button><span className="text-xs text-muted">A reason is required and recorded in the audit log.</span></div> : <Locked reason="Only an Organization Admin can reopen a closed project." />
        ) : p.status === 'review' && closePending ? (
          can('confirmClose', p.id) ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" onClick={() => confirm({ title: `Approve closure of ${p.id}?`, body: 'The project becomes read-only; data is retained per policy.', confirmLabel: 'Approve Closure', danger: true, onConfirm: () => { const r = confirmClose(closePending.id); if (r.ok) toast(`Closed ${p.id}`); else toast(r.error || 'The closure could not be confirmed.', 'bad') } })}>Approve Closure</Button>
              <span className="text-xs text-muted">Requested by {closePending.by} on {closePending.at}</span>
            </div>
          ) : (
            <PersonaHint need="a Reviewer or Admin" persona="Pat Kim">The closure request is waiting for confirmation. The {ROLE_LABEL[me.role]} role cannot confirm it.</PersonaHint>
          )
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" disabled={!canReq || !eligible || guard.ro} title={!canReq ? 'Only a Red Team Manager can request project closure' : !eligible ? 'The current project status does not allow a closure request' : undefined} onClick={() => setModal(true)}>Close Project</Button>
            {!canReq ? <Locked reason="Only a Red Team Manager can request project closure." /> : !eligible ? <Locked reason={`The project is “${p.status}”, so closure cannot be requested yet.`} /> : failing.length > 0 ? <span className="text-xs text-warn">{failing.length} conditions are not met. Open Request Closure to see them.</span> : null}
          </div>
        )}
      </Card>

      <Modal open={modal} onClose={() => setModal(false)} title="Close Project" footer={<><Button onClick={() => setModal(false)}>Cancel</Button><Button variant="primary" disabled={failing.length > 0 || !reason.trim()} title={failing.length ? 'Resolve the blockers first' : !reason.trim() ? 'A reason is required' : undefined} onClick={() => { const r = requestClose(p.id, { reason: reason.trim(), waiverNoFindings: noFind && noFindingsOk }); if (!r.ok) { toast(r.error || 'The closure request was refused.', 'bad'); return } setModal(false); setReason(''); toast('Closure request submitted for sign-off') }}>Submit closure request</Button></>}>
        {failing.length === 0 ? (
          <p className="mb-3 flex items-center gap-2 text-sm"><CheckCircle2 size={16} className="text-ok" />All conditions are met. A Reviewer or Admin signs off. Closing makes the project read-only and keeps all logs.</p>
        ) : (
          <div className="mb-3">
            <p className="mb-3 text-sm font-medium text-bad">Closure is blocked. Resolve these first:</p>
            <ul className="space-y-2">{failing.map((i) => <li key={i.id} className="flex gap-2 text-sm"><XCircle size={16} className="mt-0.5 shrink-0 text-bad" /><span className="flex-1"><b className="font-medium">{i.label}</b><br /><span className="text-muted">{i.detail}</span></span><Button size="sm" onClick={() => { setModal(false); go(i.fix.page, { id: i.fix.id, tab: i.fix.tab }) }}>Resolve</Button></li>)}</ul>
          </div>
        )}
        {fs.length === 0 || noFindingsOk ? <div className="mb-3"><Check checked={noFind} onChange={setNoFind} label="Approved no-findings closure: no confirmed findings; documented in the reason below instead of a delivered report" /></div> : null}
        <Field label="Reason for closing" required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. All objectives assessed; final report delivered." /></Field>
      </Modal>
    </div>
  )
}
