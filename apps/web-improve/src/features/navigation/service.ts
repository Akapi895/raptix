/** Scoped navigation badges and search result labels, without entity database access. */
import { can, projectAccessible } from '../../auth/policy'
import type { ConsoleServices } from '../../domain/service-factory'
import type { RequestContext } from '../../domain/service'
import { projectView, scopedRows } from '../../domain/projection'
import { sessionPermOf } from '../c2/service'

export interface SearchResult { group: string; id: string; label: string; meta: string; page: string }

export function readNavigationBadges(services: ConsoleServices, ctx: RequestContext): Record<string, number> {
  return projectView(services, ctx, 'navigation-badges', (db) => ({
    projects: can(ctx.actor, 'approve') ? scopedRows(db, ctx, db.approvals).filter((a) => a.status === 'pending').length : 0,
    'ai-operator': scopedRows(db, ctx, db.plans).filter((p) => ['in_review', 'proposed'].includes(p.status)).length,
    c2: scopedRows(db, ctx, db.sessionRequests).filter((r) => r.status === 'pending').length,
    operations: scopedRows(db, ctx, db.operations).filter((o) => o.status === 'running').length,
  }))
}

export function readSearchResults(services: ConsoleServices, ctx: RequestContext, query: string): SearchResult[] {
  return projectView(services, ctx, `navigation-search:${query}`, (db) => {
    const k = query.trim().toLowerCase()
    if (!k) return []
    const matches = (...text: string[]): boolean => text.join(' ').toLowerCase().includes(k)
    return [
      ...db.projects.filter((p) => projectAccessible(p, ctx.actor) && matches(p.id, p.name, p.client)).slice(0, 4).map((p) => ({ group: 'Projects', id: p.id, label: p.name, meta: `${p.status} · ${p.client}`, page: 'project' })),
      ...scopedRows(db, ctx, db.operations).filter((o) => matches(o.id, o.name)).slice(0, 4).map((o) => ({ group: 'Operations', id: o.id, label: o.name, meta: `${o.status} · ${o.projectId}`, page: 'operation' })),
      ...scopedRows(db, ctx, db.plans).filter((p) => matches(p.id, p.title)).slice(0, 4).map((p) => ({ group: 'Plans', id: p.id, label: p.title, meta: `${p.ver ?? 'v' + p.version} · ${p.status.replace('_', ' ')} · ${p.projectId}`, page: 'ai-plan' })),
      ...scopedRows(db, ctx, db.findings).filter((f) => matches(f.id, f.title)).slice(0, 4).map((f) => ({ group: 'Findings', id: f.id, label: f.title, meta: `${f.status === 'ai_suggested' ? 'AI suggestion' : f.status} · ${f.projectId}`, page: 'finding' })),
      ...scopedRows(db, ctx, db.sessions).filter((s) => sessionPermOf(db, ctx, s) !== 'none' && matches(s.id, s.asset, s.account)).slice(0, 4).map((s) => ({ group: 'Sessions', id: s.id, label: s.asset, meta: `${s.state} · ${s.projectId}`, page: 'c2-session' })),
      ...scopedRows(db, ctx, db.agents, !ctx.projectId || ctx.projectId === 'all').filter((a) => matches(a.id, a.host)).slice(0, 4).map((a) => ({ group: 'Agents', id: a.id, label: a.host, meta: `${a.status} · ${a.projectId}`, page: 'agent' })),
    ]
  })
}
