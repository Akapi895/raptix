/** Caches feature service projections between atomic authority publications. */
import type { Db } from '../data'
import { projectAccessible } from '../auth/policy'
import type { ConsoleServices } from './service-factory'
import type { RequestContext } from './service'

const caches = new WeakMap<ConsoleServices, { source: Db; views: Map<string, unknown> }>()

export function projectView<T>(services: ConsoleServices, ctx: RequestContext, view: string, produce: (db: Db) => T): T {
  const source = services.authority.snapshot()
  let cache = caches.get(services)
  if (!cache || cache.source !== source) {
    cache = { source, views: new Map() }
    caches.set(services, cache)
  }
  const key = JSON.stringify([ctx.actor.id, ctx.actor.role, ctx.projectId, view])
  if (!cache.views.has(key)) cache.views.set(key, produce(source))
  return cache.views.get(key) as T
}

export function scopedRows<T extends { projectId: string }>(db: Db, ctx: RequestContext, rows: T[], pool = false): T[] {
  const ids = new Set(db.projects.filter((p) => projectAccessible(p, ctx.actor)).map((p) => p.id))
  const all = !ctx.projectId || ctx.projectId === 'all'
  if (!all && !ids.has(ctx.projectId)) return []
  return rows.filter((row) => (pool && row.projectId === '') || (all ? ids.has(row.projectId) : row.projectId === ctx.projectId))
}
