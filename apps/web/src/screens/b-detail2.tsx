import { useState } from 'react'
import { Download, FileText, Lock, Pencil, Plus, Trash2, ChevronDown, ChevronRight, CheckCircle2, XCircle } from 'lucide-react'
import { useServices } from '../state/services'
import { ROLE_LABEL } from '../auth/policy'
import { TeamMembers } from '../features/team/members'
import { ClosureTab } from '../features/closure/tab'
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
  const decide = (a: Approval, d: 'approved' | 'returned', note: string) => {
    const r = decideApproval(a.id, d, note)
    if (!r.ok) { setErr(r.error || 'Could not complete the decision'); return }
    setErr(''); toast(d === 'approved' ? `Approved: ${a.type}` : `Returned: ${a.type}`)
  }
  const approve = (a: Approval) => confirm({ title: `Approve “${a.type}”?`, body: `Project ${p.id} moves to its next state based on this decision.`, confirmLabel: 'Approve', reasonLabel: 'Comment (optional)', onConfirm: (r) => { if (a.type !== APR.close) { decide(a, 'approved', r); return } /* Ticket 22: closure resolution is gated by the handler (four-eyes + re-derived checklist); the refusal renders here. */ const c = confirmClose(a.id); if (c.ok) toast('Project closure confirmed'); else setErr(c.error || 'Could not confirm closure') } })
  const ret = (a: Approval) => confirm({ title: `Request changes to “${a.type}”`, body: 'The submitter is notified with your reason so they can revise and resubmit.', confirmLabel: 'Request Changes', danger: true, reasonLabel: 'Reason for changes', reasonRequired: true, onConfirm: (r) => decide(a, 'returned', r) })
  const more = (a: Approval) => confirm({ title: 'Request more information', body: 'The request is returned to the submitter with what is needed.', confirmLabel: 'Send request', reasonLabel: 'Information needed', reasonRequired: true, onConfirm: (r) => decide(a, 'returned', 'More information requested: ' + r) })

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

      <TeamMembers engagementId={p.id} />
    </div>
  )
}

/* ───────────── PR-09 Closure ───────────── */
export function CloseTab({ p, d, setTab }: { p: Project; d: ProjectDetail; setTab: (t: string) => void }) {
  const can = useCan()
  const reopen = useReopen(p)
  const ds = d.aggregate
  const ops = ds.operations.filter((o) => o.projectId === p.id)
  const fs = ds.findings.filter((f) => f.projectId === p.id)
  const reps = ds.reports.filter((r) => r.projectId === p.id)
  const evs = d.evidence
  const objDone = p.objectives.filter((o) => o.progress >= 100).length
  const final = reps.find((r) => r.status === 'delivered') || reps[0]
  const closed = p.status === 'closed'
  const summary = (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Objectives complete" value={`${objDone}/${p.objectives.length}`} sub={p.objectives.length ? undefined : 'No objectives yet'} onClick={() => setTab('objectives')} />
        <Kpi label="Active operations" value={ops.filter((o) => ['running', 'paused'].includes(o.status)).length} tone={ops.some((o) => ['running', 'paused'].includes(o.status)) ? 'warn' : 'ok'} onClick={() => setTab('operations')} />
        <Kpi label="Unreviewed findings" value={fs.filter((f) => ['draft', 'review', 'returned'].includes(f.status)).length} tone={fs.some((f) => ['draft', 'review', 'returned'].includes(f.status)) ? 'warn' : 'ok'} onClick={() => setTab('findings')} />
        <Kpi label="Final report" value={final ? <Status kind="report" value={final.status} size="sm" /> : 'None'} onClick={() => setTab('reports')} />
        <Kpi label="Evidence" value={evs.length} sub={`${evs.filter((e) => e.sensitive).length} sensitive, retained per policy`} onClick={() => setTab('evidence')} />
      </div>
      <Card>
        <CardHeader title="Other closeout conditions" sub="Informational; the checklist below is the source's own read" />
        <ul className="divide-y divide-line/60">
          <li className="flex flex-wrap items-center gap-3 py-3">
            <Status kind="check" value={evs.length ? 'pass' : 'review'} />
            <div className="min-w-0 flex-1"><div className="text-sm font-medium">Evidence stored</div><div className="text-xs text-muted">{evs.length ? `${evs.length} items retained per policy` : 'No evidence in this project'}</div></div>
          </li>
          <li className="flex flex-wrap items-center gap-3 py-3">
            <Status kind="check" value="pass" />
            <div className="min-w-0 flex-1"><div className="text-sm font-medium">Audit trail retained</div><div className="text-xs text-muted">Closing never deletes logs. <button className="text-accent underline" onClick={() => setTab('audit')}>Open Activity &amp; Audit</button></div></div>
          </li>
        </ul>
      </Card>
    </>
  )
  const reopenAction = closed && can('reopen', p.id) ? (
    <div className="flex flex-wrap items-center gap-3"><Button variant="danger" onClick={reopen}>Reopen Project</Button><span className="text-xs text-muted">A reason is required and recorded in the audit log.</span></div>
  ) : null
  return <ClosureTab engagementId={p.id} summary={summary} extraActions={reopenAction} />
}
