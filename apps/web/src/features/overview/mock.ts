/**
 * Demo implementation of the global overview port (migration Mốc 2). Reads the authority snapshot for the actor's
 * accessible projects. Sections the demo data does not record answer `null` or are omitted: the shared view shows
 * them as not recorded instead of inventing counts. Approval types the real inbox does not track are left out, so
 * the demo task list is a subset of the real one.
 */
import type { DbAuthority } from '../../demo/authority'
import { projectAccessible } from '../../domain/policy'
import type { ActorRef, ServiceResult } from '../../domain/service'
import { APR } from '../../domain/catalog'
import type { OverviewC2, OverviewFindings, OverviewProject, OverviewService, OverviewTask, OverviewTaskKind } from './service'

const TASK_KIND_BY_APPROVAL: Partial<Record<string, OverviewTaskKind>> = { [APR.scope]: 'scope-revision', [APR.plan]: 'business-plan', [APR.access]: 'c2-grant' }

export function createOverviewService(authority: DbAuthority, actor: ActorRef): OverviewService {
  const accessible = () => {
    const db = authority.snapshot()
    const projects = db.projects.filter((p) => projectAccessible(p, actor))
    const ids = new Set(projects.map((p) => p.id))
    return { db, projects, ids }
  }
  const name = (projects: { id: string; name: string }[], id: string) => projects.find((p) => p.id === id)?.name ?? null

  return {
    async projects(): Promise<ServiceResult<OverviewProject[]>> {
      const { projects } = accessible()
      return { ok: true, data: projects.map((p) => ({ id: p.id, name: p.name, detail: p.client, status: p.status, updatedAt: p.updated })) }
    },
    async findings(): Promise<ServiceResult<OverviewFindings>> {
      const { db, projects, ids } = accessible()
      const verified = db.findings.filter((f) => ids.has(f.projectId) && f.status !== 'ai_suggested')
      const bySeverity: Record<string, number> = {}
      const byStatus: Record<string, number> = {}
      for (const f of verified) {
        bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1
        byStatus[f.status] = (byStatus[f.status] ?? 0) + 1
      }
      return {
        ok: true,
        data: {
          total: verified.length,
          engagements: projects.length,
          engagementsWithFindings: new Set(verified.map((f) => f.projectId)).size,
          bySeverity,
          byStatus,
          truncated: false,
        },
      }
    },
    async c2(): Promise<ServiceResult<OverviewC2>> {
      const { db, ids } = accessible()
      const pendingGrants = db.sessionRequests.filter((r) => ids.has(r.projectId) && r.status === 'pending').length
      return { ok: true, data: { pendingGrants, commandsByStatus: null, recentCommands: [] } }
    },
    async tasks(): Promise<ServiceResult<OverviewTask[]>> {
      const { db, projects, ids } = accessible()
      const approvals = db.approvals
        .filter((a) => ids.has(a.projectId) && a.status === 'pending' && TASK_KIND_BY_APPROVAL[a.type] !== undefined)
        .map((a): OverviewTask => {
          const kind = TASK_KIND_BY_APPROVAL[a.type]!
          const tab = kind === 'scope-revision' ? 'scope' : kind === 'business-plan' ? 'plans' : 'sessions'
          return {
            kind,
            refId: a.id,
            engagementId: a.projectId,
            engagementName: name(projects, a.projectId),
            title: `${a.type} requested by ${a.by}`,
            createdAt: a.at,
            href: `project/${a.projectId}?tab=${tab}`,
            awaitingActor: a.reviewer === actor.id,
          }
        })
      const requests = db.sessionRequests
        .filter((r) => ids.has(r.projectId) && r.status === 'pending')
        .map((r): OverviewTask => ({
          kind: 'c2-grant',
          refId: r.id,
          engagementId: r.projectId,
          engagementName: name(projects, r.projectId),
          title: `Session access (${r.mode}) requested by ${r.by}`,
          createdAt: r.at,
          href: `project/${r.projectId}?tab=sessions`,
          awaitingActor: true,
        }))
      const reviews = db.findings
        .filter((f) => ids.has(f.projectId) && f.status === 'review')
        .map((f): OverviewTask => ({
          kind: 'finding-review',
          refId: f.id,
          engagementId: f.projectId,
          engagementName: name(projects, f.projectId),
          title: f.title,
          createdAt: f.updated,
          href: `finding/${f.id}?engagement=${f.projectId}`,
          awaitingActor: true,
        }))
      return { ok: true, data: [...approvals, ...requests, ...reviews] }
    },
  }
}
