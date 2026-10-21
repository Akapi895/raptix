/**
 * Project governance panel hooks (ticket 21, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * The detail screen's approval/scope actions live here, outside the screen
 * modules (which stay components-only). Submission runs the ticket-21
 * transaction handler directly — the same handler the legacy store action
 * delegates to — with the same request context, so a refused submission is
 * explained to the user from the handler's failure: the handler owns the
 * rule, the panel only renders it. Reopen runs through ticket 22's typed
 * closure handler (role gate and required reason are enforced there); the
 * panel surfaces its refusal.
 */
import { APR } from '../../domain/catalog';
import type { Db } from '../../demo/seed';
import { type Project } from '../../domain/entities'
import { useServices } from '../../state/services'
import { useMe } from '../../state/console'
import { useToastStore } from '../../state/stores'
import { useSessionStore } from '../../state/session'
import { useServiceProjection } from '../../state/projection'
import { projectView } from '../../domain/projection'
import type { RequestContext } from '../../domain/service'
import type { ConsoleServices } from '../../domain/service-factory'
import { submitApprovalTransaction } from './service'
import { reopenProjectTransaction } from '../closure/service'

/** The project's assets, for the submission readiness panel; the transaction re-derives the essentials itself. */
export function readApprovalAssets(services: ConsoleServices, ctx: RequestContext, projectId: string): Db['assets'] {
  return projectView(services, ctx, 'approval-assets.' + projectId, (db) => db.assets.filter((a) => a.projectId === projectId))
}

/** Submit/resubmit the project for approval; refusals surface as a bad toast with the handler's reason. */
export function useSubmitApproval(p: Project) {
  const services = useServices()
  const me = useMe()
  const toast = useToastStore((s) => s.toast)
  const assets = useServiceProjection((svcs, ctx) => readApprovalAssets(svcs, ctx, p.id))
  const issues: string[] = []
  if (!assets.some((a) => ['in', 'pending'].includes(a.scope))) issues.push('no in-scope assets')
  if (!p.emergency) issues.push('no emergency contact')
  if (!p.window) issues.push('no assessment window')
  return {
    issues, ready: issues.length === 0,
    submit: () => {
      const r = submitApprovalTransaction(services.authority, services.clock, { actor: { id: me.name, role: me.role }, projectId: p.id, corr: 'legacy' }, { projectId: p.id, type: APR.create, note: p.status === 'rejected' ? 'Resubmitted after addressing reviewer feedback.' : 'Requesting approval of the project and ROE.', diff: `${p.roeVersion}, ${assets.filter((a) => a.scope !== 'out').length} assets` })
      if (r.ok) toast(`Submitted ${p.id} to the reviewer`)
      else toast(r.failure.message || 'The submission was refused.', 'bad')
    },
  }
}

/** Reopen a closed project — ticket 22's closure handler owns the role gate and the required, audited reason. */
export function useReopen(p: Project) {
  const services = useServices()
  const me = useMe()
  const toast = useToastStore((s) => s.toast)
  const confirm = useSessionStore((s) => s.confirm)
  return () => confirm({
    title: `Reopen project ${p.id}?`, body: 'The project returns to Active and becomes editable again. This action is recorded in the audit log.', confirmLabel: 'Reopen Project', danger: true,
    reasonLabel: 'Reason for reopening', reasonRequired: true, onConfirm: (r) => { const res = reopenProjectTransaction(services.authority, services.clock, { actor: { id: me.name, role: me.role }, projectId: p.id, corr: 'legacy' }, p.id, r); if (res.ok) toast(`Reopened ${p.id}`); else toast(res.failure.message || 'The project could not be reopened.', 'bad') },
  })
}
