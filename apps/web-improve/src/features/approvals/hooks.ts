/**
 * Project governance panel hooks (ticket 21, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * The detail screen's approval/scope actions live here, outside the screen
 * modules (which stay components-only). Submission goes through the store
 * action that delegates to the ticket-21 transaction handler, so a refused
 * submission is explained to the user from the handler's failure — the
 * handler owns the rule, the panel only renders it. Reopen stays on the
 * bridged legacy action until ticket 22 owns closure governance.
 */
import { APR, type Project } from '../../data'
import { useStore } from '../../store'

/** Submit/resubmit the project for approval; refusals surface as a bad toast with the handler's reason. */
export function useSubmitApproval(p: Project) {
  const { db, A, toast } = useStore()
  const assets = db.assets.filter((a) => a.projectId === p.id)
  const issues: string[] = []
  if (!assets.some((a) => ['in', 'pending'].includes(a.scope))) issues.push('no in-scope assets')
  if (!p.emergency) issues.push('no emergency contact')
  if (!p.window) issues.push('no assessment window')
  return {
    issues, ready: issues.length === 0,
    submit: () => {
      const r = A.submitApproval(p.id, APR.create, p.status === 'rejected' ? 'Resubmitted after addressing reviewer feedback.' : 'Requesting approval of the project and ROE.', `${p.roeVersion}, ${assets.filter((a) => a.scope !== 'out').length} assets`)
      if (r.ok) toast(`Submitted ${p.id} to the reviewer`)
      else toast(r.error || 'The submission was refused.', 'bad')
    },
  }
}

/** Reopen a closed project — closure governance is ticket 22; the reason is required and audited. */
export function useReopen(p: Project) {
  const { A, confirm, toast } = useStore()
  return () => confirm({
    title: `Reopen project ${p.id}?`, body: 'The project returns to Active and becomes editable again. This action is recorded in the audit log.', confirmLabel: 'Reopen Project', danger: true,
    reasonLabel: 'Reason for reopening', reasonRequired: true, onConfirm: (r) => { A.reopen(p.id, r); toast(`Reopened ${p.id}`) },
  })
}
