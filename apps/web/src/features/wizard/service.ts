/**
 * Project-creation transaction (ticket 19, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * The one real handler behind the wizard's create/submit outcomes:
 * authorization and draft validation run before a single atomic commit that
 * publishes the project, its assets and members, the creation approval, the
 * reviewer notice and the audit row together — one ChangeSet the portfolio
 * and the legacy inbox both observe. The legacy `A.createProject` action
 * delegates here (execution contract: a legacy action delegates to the
 * handler that owns its behavior), so the wizard keeps its single canonical
 * creation path and no second creation implementation exists.
 *
 * Refusals commit nothing: an unauthorized actor or an invalid draft leaves
 * every entity unchanged, so a failed submission keeps the caller's draft
 * and permits a clean retry without duplicate entities.
 */
import { APR } from '../../domain/catalog';
import { formatDemoInstant } from '../../domain/clock'
import type { DbAuthority } from '../../domain/database'
import type { Clock, RequestContext, ServiceResult } from '../../domain/service'
import type { ProjectDraft } from './draft'
import { nextId } from './draft'

const ROLE_LABEL: Record<string, string> = { admin: 'Organization Admin', manager: 'Red Team Manager', operator: 'Operator', reviewer: 'Reviewer', analyst: 'Analyst', viewer: 'Client / Viewer' }
const CODE_RE = /^[A-Z]{2}-\d{4}-\d{3}$/

export interface CreatedProject { id: string; status: 'draft' | 'pending' }

/**
 * Creates the project in one atomic commit. Refusal order: role gate →
 * required name/client → code format → duplicate code. The submission
 * essentials (in-scope asset, emergency contact, window) stay the review
 * panel's fail-row gate as today: a submit without them still lands as a
 * draft (baseline parity for direct legacy callers), never as a pending
 * project waiting on an impossible approval.
 */
export function createProjectTransaction(
  authority: DbAuthority,
  clock: Clock,
  ctx: RequestContext,
  dr: ProjectDraft,
  submit: boolean,
): ServiceResult<CreatedProject> {
  if (ctx.actor.role !== 'admin' && ctx.actor.role !== 'manager') {
    return { ok: false, failure: { kind: 'forbidden', message: 'Only a Red Team Manager or Organization Admin can create projects.', entity: { kind: 'project', id: dr.id } } }
  }
  if (!dr.name.trim()) return { ok: false, failure: { kind: 'validation', message: 'Enter a project name.', entity: { kind: 'project', id: dr.id } } }
  if (!dr.client.trim()) return { ok: false, failure: { kind: 'validation', message: 'Select or enter a client / organization.', entity: { kind: 'project', id: dr.id } } }
  if (!CODE_RE.test(dr.id)) return { ok: false, failure: { kind: 'validation', message: 'Code must look like RT-2026-016.', entity: { kind: 'project', id: dr.id } } }
  if (authority.snapshot().projects.some((p) => p.id === dr.id)) {
    return { ok: false, failure: { kind: 'conflict', message: `Code ${dr.id} already exists. Use another code (suggested: ${nextId(authority.snapshot().projects.map((p) => p.id), dr.type)}).`, entity: { kind: 'project', id: dr.id } } }
  }
  const hasScope = dr.assets.some((a) => a.scope === 'in') && !!dr.emergency && !!dr.window
  const status: CreatedProject['status'] = submit && hasScope ? 'pending' : 'draft'
  const id = dr.id
  const at = formatDemoInstant(clock.now())
  const day = at.split(',')[0]
  authority.commit(ctx.corr, (d) => {
    d.projects.unshift({
      id, name: dr.name, client: dr.client, owner: dr.owner, type: dr.type, status, start: dr.start, end: dr.end, tz: dr.tz, desc: dr.desc, pinned: false,
      roeStatus: status === 'pending' ? 'pending' : 'draft', roeVersion: `ROE-${id.slice(-3)}-v1`, window: dr.window, emergency: dr.emergency,
      methods: ['Service discovery', 'Approved TTP simulation'], restrictions: dr.limits,
      objectives: dr.objectives.filter((o) => o.text).map((o, i) => ({ id: 'o' + (i + 1), text: o.text, criteria: o.criteria, owner: dr.owner, progress: 0 })),
      members: [{ user: dr.owner, role: 'manager', since: day }, ...dr.members.filter((m) => m.user !== dr.owner).map((m) => ({ ...m, since: day }))],
      updated: at,
    })
    dr.assets.forEach((a, i) => d.assets.push({ id: `AS-${id.slice(-3)}${i + 1}`, name: a.name, ident: a.ident, ip: '203.0.113.' + (100 + i), type: a.type, os: '—', owner: dr.client, projectId: id, scope: a.scope === 'out' ? 'out' : 'pending', source: 'Manual', updated: at }))
    if (status === 'pending') {
      d.approvals.unshift({ id: 'APR-' + ++d.counters.approval, projectId: id, type: APR.create, by: dr.owner, reviewer: dr.approver, at, status: 'pending', note: 'Requesting approval of ROE v1.', diff: `New ROE: ${dr.window}; ${dr.assets.filter((a) => a.scope === 'in').length} assets in scope.` })
      d.notices.unshift({ id: 'N' + (d.notices.length + 1) + '-' + Date.now() % 10000, group: 'todo', text: `${id} is waiting for your ROE approval`, projectId: id, at, read: false, to: { name: 'project', id }, category: 'approvals' })
    }
    d.audit.unshift({ corr: ctx.corr, id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_LABEL[ctx.actor.role], action: status === 'pending' ? 'Created project and submitted for approval' : 'Created draft project', obj: id, projectId: id, result: 'Success', reason: '' })
  })
  return { ok: true, data: { id, status } }
}
