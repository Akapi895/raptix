import type { ComponentType } from 'react'
/* Ticket 61a: the auth/system slice's semantic module (src/shell/system) owns the error pages; route keys are unchanged. */
import { Forbidden, NotFound, Offline, ServerError, SessionExpired } from '../shell/system/pages'

/** The system pages that render themselves in real mode; they stay in the main bundle so a crash page renders without a chunk. */
export const routes: Record<string, ComponentType> = {
  forbidden: Forbidden,
  notfound: NotFound,
  error: ServerError,
  offline: Offline,
  'session-expired': SessionExpired,
}
