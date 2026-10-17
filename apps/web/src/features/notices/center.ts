/**
 * Notice center port (plan P09, Notices slice). The header bell shows the persona's
 * notifications in both modes through this port. A row carries only what either
 * source can state: its text, its read state, the project it concerns, when it was
 * raised, and a route to open when the source names one. A real notice has no
 * route, chip or review flag of its own, so those stay null or false and are shown
 * as absent, never invented.
 */
import type { RequestContext, ServiceResult } from '../../domain/service'

export interface NoticeCenterItem {
  id: string
  text: string
  read: boolean
  /** The project the notice concerns; null for a system notice. */
  projectId: string | null
  /** When the notice was raised, as an ISO instant. */
  at: string
  /** The category label, when the source categorizes the notice; null otherwise. */
  chip: string | null
  /** A notice that asks for a decision; the console highlights it and offers its route. */
  needsReview: boolean
  /** The route the notice opens, when the source names one; null otherwise. */
  target: { page: string; id?: string } | null
}

export interface NoticeCenterRead {
  items: NoticeCenterItem[]
  unread: number
  /** False for an account the server marks read-only; the dismiss control then explains why. */
  canMutate: boolean
}

export interface NoticeCenterService {
  list(ctx: RequestContext): Promise<ServiceResult<NoticeCenterRead>>
  setRead(ctx: RequestContext, id: string, read: boolean): Promise<ServiceResult<NoticeCenterItem>>
  dismiss(ctx: RequestContext, id: string): Promise<ServiceResult<{ id: string }>>
  markAllRead(ctx: RequestContext): Promise<ServiceResult<{ unread: number }>>
}

/** Every call resolves to an explicit unavailable outcome when the backend does not advertise notices. */
export function unavailableNoticeCenterService(): NoticeCenterService {
  const failure = { kind: 'unavailable' as const, message: 'Notifications are not available on this server.' }
  const unavailable = () => Promise.resolve({ ok: false as const, failure })
  return {
    list: unavailable,
    setRead: unavailable,
    dismiss: unavailable,
    markAllRead: unavailable,
  }
}
