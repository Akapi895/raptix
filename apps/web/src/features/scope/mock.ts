/**
 * Mock adapter for the scope port (plan P09, Scope slice). The mock keeps scope
 * as approval records and the project's ROE fields. This adapter presents the
 * approval records as scope revisions and writes through the approval
 * transactions, so the shared Scope tab reads the same model in both modes.
 * The mock keeps no per-revision ROE fields, so `supports.roeFields` is false
 * and the tab does not offer them in mock mode.
 */
import { APR } from '../../domain/catalog';
import type { Db } from '../../demo/seed';
import type { DbAuthority } from '../../domain/database'
import type { Approval, Operation, Project } from '../../domain/entities'
import type { Clock, RequestContext, ServiceResult } from '../../domain/service'
import { decideApprovalTransaction, submitApprovalTransaction } from '../approvals/service'
import type { ScopeImpact, ScopeRead, ScopeRevision, ScopeRevisionStatus, ScopeService } from './service'

const STATUS: Readonly<Record<Approval['status'], ScopeRevisionStatus>> = { pending: 'pending', approved: 'approved', returned: 'rejected', withdrawn: 'superseded' }

/** `ROE v3` → 3; anything without a trailing number has no version. */
const versionNumber = (label: string): number | null => {
  const match = /(\d+)$/.exec(label.trim())
  return match ? Number(match[1]) : null
}

const idNumber = (id: string): number => Number(id.replace(/\D/g, '')) || 0

function revisionsOf(db: Db, projectId: string): ScopeRevision[] {
  const approvals = db.approvals.filter((a) => a.projectId === projectId && a.type === APR.scope).sort((a, b) => idNumber(a.id) - idNumber(b.id))
  return approvals.map((a, index) => ({
    id: a.id,
    version: index + 1,
    status: STATUS[a.status],
    diff: { added: a.diff ? [a.diff] : [], removed: [], rationale: a.note },
    roe: { windows: [], emergencyContacts: [], restrictions: [] },
    requestedBy: a.by,
    decidedBy: a.status === 'pending' ? null : a.reviewer,
    decisionComment: null,
  })).sort((a, b) => b.version - a.version)
}

function impactOf(db: Db, project: Project, operations: Operation[]): ScopeImpact | null {
  const prev = versionNumber(project.roeVersion)
  const prevVersion = prev !== null && prev > 1 ? prev - 1 : null
  const affected = project.roeStatus !== 'approved' && prevVersion !== null && ['approved', 'active', 'paused', 'review'].includes(project.status)
  if (!affected) return null
  return {
    prevVersion,
    plans: db.plans.filter((p) => p.projectId === project.id && p.status === 'expired' && p.risks.some((r) => r.startsWith('Re-validation'))).map((p) => p.id),
    draftOps: operations.filter((o) => ['draft', 'pending', 'ready'].includes(o.status)).map((o) => o.id),
    running: operations.filter((o) => o.status === 'running').map((o) => o.id),
  }
}

function readScope(db: Db, ctx: RequestContext): ServiceResult<ScopeRead> {
  const project = db.projects.find((p) => p.id === ctx.projectId)
  if (!project) return { ok: false, failure: { kind: 'not-found', message: `Project ${ctx.projectId} was not found.` } }
  const revisions = revisionsOf(db, project.id)
  const latest = revisions.find((r) => r.status === 'approved') ?? null
  const operations = db.operations.filter((o) => o.projectId === project.id)
  const inScope = db.assets.filter((a) => a.projectId === project.id && a.scope === 'in').map((a) => a.ident)
  const fallbackVersion = project.roeStatus === 'approved' ? versionNumber(project.roeVersion) : null
  return {
    ok: true,
    data: {
      revisions,
      latestApprovedVersion: latest?.version ?? null,
      effective: {
        version: latest?.version ?? fallbackVersion,
        versionLabel: project.roeStatus === 'approved' ? project.roeVersion : latest ? `v${latest.version}` : null,
        rootTarget: null,
        inScope,
        roe: { windows: [], emergencyContacts: project.emergency ? [project.emergency] : [], restrictions: project.restrictions },
        windowText: project.window || null,
      },
      impact: impactOf(db, project, operations),
      unmodelled: [],
      supports: { roeFields: false },
    },
  }
}

export function createMockScopeService(authority: DbAuthority, clock: Clock, guard: <T>(produce: () => ServiceResult<T>) => Promise<ServiceResult<T>>): ScopeService {
  const revisionById = (db: Db, projectId: string, id: string): ServiceResult<ScopeRevision> => {
    const found = revisionsOf(db, projectId).find((r) => r.id === id)
    return found ? { ok: true, data: found } : { ok: false, failure: { kind: 'not-found', message: `Scope revision ${id} was not found.` } }
  }
  return {
    read: (ctx) => guard(() => readScope(authority.snapshot(), ctx)),
    submit: async (ctx, input) => {
      const diff = [...input.diff.added.map((x) => `+${x}`), ...input.diff.removed.map((x) => `-${x}`)].join(', ')
      const submitted = submitApprovalTransaction(authority, clock, ctx, { projectId: ctx.projectId, type: APR.scope, note: input.diff.rationale, diff: diff || undefined })
      if (!submitted.ok) return submitted
      return revisionById(authority.snapshot(), ctx.projectId, submitted.data.id)
    },
    decide: async (ctx, revisionId, decision, comment) => {
      const decided = decideApprovalTransaction(authority, clock, ctx, revisionId, decision === 'approved' ? 'approved' : 'returned', comment ?? '')
      if (!decided.ok) return decided
      return revisionById(authority.snapshot(), ctx.projectId, revisionId)
    },
  }
}
