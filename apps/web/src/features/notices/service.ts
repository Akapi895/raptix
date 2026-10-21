/**
 * Notice handlers (ticket 59, ADR-0067 —
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Feature-local handlers for the notification center: a persona-scoped list
 * read plus read/unread and dismiss writes over the one database authority.
 * The legacy seam's visibility rule is preserved — system notices (empty
 * projectId) reach every signed-in persona, project notices only the actor's
 * accessible projects — and the legacy `markNoticesRead` scope leak is fixed
 * at the handler: mark-all-read touches in-scope notices only, never another
 * persona's out-of-scope rows. Every write captures actor/project at call
 * time, commits once through the shared transaction bridge, publishes the
 * ChangeSet both the legacy store and Query views observe, and refuses with
 * an explicit failure whose message is safe to render. Dismissal is
 * destructive (it removes the notice for everyone) so it is role-gated to
 * data-mutating roles and appended to the audit log; viewer personas read
 * their notices but cannot dismiss.
 */
import type { Db, Notice } from '../../data'
import { formatDemoInstant } from '../../domain/clock'
import type { DbAuthority } from '../../domain/database'
import { projectAccessible } from '../../domain/policy'
import type { Clock, RequestContext, ServiceFailure, ServiceResult } from '../../domain/service'
import type { Role } from '../../domain/entities'
import type { ConsoleServices } from '../../domain/service-factory'
import { stamp } from '../../domain/demo-clock'
import { projectView } from '../../domain/projection'

/** Display chips in the header popover, in the legacy order. */
export const NOTICE_CHIPS = ['Approvals', 'Agents', 'Sessions', 'AI plans', 'Reports', 'System'] as const
export type NoticeChip = (typeof NOTICE_CHIPS)[number]

const CHIP_OF_CATEGORY: Record<NonNullable<Notice['category']>, NoticeChip> = {
  approvals: 'Approvals', agents: 'Agents', sessions: 'Sessions', plans: 'AI plans', reports: 'Reports', system: 'System',
}

/** Legacy category fallback: seeders and some callers omit `category` or pass an unknown one. */
function categoryOf(n: Notice): NoticeChip {
  const mapped = n.category ? CHIP_OF_CATEGORY[n.category] : undefined
  if (mapped) return mapped
  const t = String(n.to?.name || '')
  if (t === 'project' || t === 'approval' || t === 'projects') return 'Approvals'
  if (t.startsWith('agent')) return 'Agents'
  if (t.startsWith('c2') || t.startsWith('session')) return 'Sessions'
  if (t.startsWith('ai')) return 'AI plans'
  if (t.startsWith('report')) return 'Reports'
  return 'System'
}

/** One notice row as the popover renders it: the committed row plus its resolved chip. */
export type NoticeView = Notice & { chip: NoticeChip }

/** The persona-scoped notification list: in-scope rows plus the unread badge count. */
export interface NoticeListRead {
  items: NoticeView[]
  unread: number
  total: number
  /** False for read-only viewer personas: mutating writes refuse at the handler. */
  canMutate: boolean
}

export function readHeaderNotices(services: ConsoleServices, ctx: RequestContext): NoticeListRead {
  return projectView(services, ctx, 'header-notices', (db) => {
    const read = listNotices(db, ctx)
    if (!read.ok) throw new Error(read.failure.message)
    return read.data
  })
}

export interface NoticeInput { text: string; to: Notice['to']; group: Notice['group']; category?: Notice['category'] }

export function publishNotice(services: ConsoleServices, ctx: RequestContext, input: NoticeInput): void {
  services.authority.commit(ctx.corr, (db) => {
    db.notices.unshift({ id: 'N' + (db.notices.length + 1) + '-' + Date.now() % 10000, ...input, projectId: ctx.projectId, at: stamp(), read: false })
  })
}

/** Workspace-level identity for audit rows (the notices collection has no owner project of its own). */
const ROLE_TEXT: Record<Role, string> = { admin: 'Organization Admin', manager: 'Red Team Manager', operator: 'Operator', reviewer: 'Reviewer', analyst: 'Analyst', viewer: 'Client / Viewer' }

/** Pure scoped read: system notices reach every persona, project notices only accessible ones. */
export function listNotices(db: Db, ctx: RequestContext): ServiceResult<NoticeListRead> {
  const accessible = new Set(db.projects.filter((p) => projectAccessible(p, ctx.actor)).map((p) => p.id))
  const items: NoticeView[] = db.notices
    .filter((n) => n.projectId === '' || accessible.has(n.projectId))
    .map((n) => ({ ...n, chip: categoryOf(n) }))
  return {
    ok: true,
    data: {
      items,
      unread: items.filter((n) => !n.read).length,
      total: items.length,
      canMutate: ctx.actor.role !== 'viewer',
    },
  }
}

/** Resolves one notice for a write, refusing out-of-scope ids as not-found (no leaked existence signal). */
function resolveNotice(db: Db, ctx: RequestContext, id: string): { ok: true; notice: Notice } | { ok: false; failure: ServiceFailure } {
  const notice = db.notices.find((n) => n.id === id)
  if (!notice) return { ok: false, failure: { kind: 'not-found', message: `Notification ${id} no longer exists.`, entity: { kind: 'notice', id } } }
  if (notice.projectId) {
    const project = db.projects.find((p) => p.id === notice.projectId)
    if (!project || !projectAccessible(project, ctx.actor)) {
      return { ok: false, failure: { kind: 'not-found', message: `Notification ${id} does not exist or is out of scope.`, entity: { kind: 'notice', id } } }
    }
  }
  return { ok: true, notice }
}

/** Marks one notice read or unread. Any persona who can see the notice may —
 *  read state is the reader's own tracking, not a data mutation. */
export function setNoticeRead(authority: DbAuthority, clock: Clock, ctx: RequestContext, id: string, read: boolean): ServiceResult<NoticeView> {
  const resolved = resolveNotice(authority.snapshot(), ctx, id)
  if (!resolved.ok) return resolved
  authority.commit(ctx.corr, (d) => {
    const n = d.notices.find((x) => x.id === id)!
    n.read = read
  })
  const fresh = authority.snapshot().notices.find((x) => x.id === id)!
  return { ok: true, data: { ...fresh, chip: categoryOf(fresh) } }
}

/** Marks every in-scope notice read in one atomic commit. Out-of-scope rows —
 *  other personas' project notices — are never touched (the legacy seam read
 *  the collection unscoped; this is the handler-enforced fix). */
export function markAllNoticesRead(authority: DbAuthority, clock: Clock, ctx: RequestContext): ServiceResult<{ unread: number }> {
  const db = authority.snapshot()
  const accessible = new Set(db.projects.filter((p) => projectAccessible(p, ctx.actor)).map((p) => p.id))
  const ids = db.notices.filter((n) => n.projectId === '' || accessible.has(n.projectId)).map((n) => n.id)
  authority.commit(ctx.corr, (d) => {
    for (const id of ids) {
      const n = d.notices.find((x) => x.id === id)
      if (n) n.read = true
    }
  })
  const after = authority.snapshot()
  const unread = after.notices.filter((n) => !n.read && (n.projectId === '' || accessible.has(n.projectId))).length
  return { ok: true, data: { unread } }
}

/** Removes one notice for everyone (destructive). Role-gated: read-only
 *  viewer personas are refused with the reason; the dismissal is audited. */
export function dismissNotice(authority: DbAuthority, clock: Clock, ctx: RequestContext, id: string): ServiceResult<{ id: string }> {
  if (ctx.actor.role === 'viewer') {
    return { ok: false, failure: { kind: 'forbidden', message: 'Viewers have read-only access and cannot dismiss notifications. Ask your project team to clean it up.' } }
  }
  const resolved = resolveNotice(authority.snapshot(), ctx, id)
  if (!resolved.ok) return resolved
  const at = formatDemoInstant(clock.now())
  authority.commit(ctx.corr, (d) => {
    d.notices = d.notices.filter((n) => n.id !== id)
    d.audit.unshift({ id: 'AU-' + ++d.counters.audit, at, actor: ctx.actor.id, role: ROLE_TEXT[ctx.actor.role], action: 'Dismissed notification', obj: id, projectId: resolved.notice.projectId, result: 'Success', reason: resolved.notice.text })
  })
  return { ok: true, data: { id } }
}

/** Builds the typed notice service; `guard` is the factory's superseded-scope
 *  read guard, so a persona/project switch resolves in-flight reads as
 *  unavailable and a late response cannot restore previous-scope notices. */
export interface NoticeService {
  list(ctx: RequestContext): Promise<ServiceResult<NoticeListRead>>
  setRead(ctx: RequestContext, id: string, read: boolean): Promise<ServiceResult<NoticeView>>
  dismiss(ctx: RequestContext, id: string): Promise<ServiceResult<{ id: string }>>
  markAllRead(ctx: RequestContext): Promise<ServiceResult<{ unread: number }>>
}

export function createNoticeService(
  authority: DbAuthority,
  clock: Clock,
  guard: <T>(produce: () => ServiceResult<T>) => Promise<ServiceResult<T>>,
): NoticeService {
  return {
    list: (ctx) => guard(() => listNotices(authority.snapshot(), ctx)),
    setRead: (ctx, id, read) => guard(() => setNoticeRead(authority, clock, ctx, id, read)),
    dismiss: (ctx, id) => guard(() => dismissNotice(authority, clock, ctx, id)),
    markAllRead: (ctx) => guard(() => markAllNoticesRead(authority, clock, ctx)),
  }
}
