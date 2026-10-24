/**
 * The C2 workspace's view for one address (WS-3). The four real addresses that reach the C2 surface resolve here, so the
 * provider tab reads one rule. Legacy addresses keep working: `c2` opens the sessions and infrastructure view, and a
 * detail address without its id falls back to that view, as before.
 *
 * `console` is the address of the interactive session console. This build has no interactive console: the view says so
 * and keeps the session list, so the address never reads as a working terminal (ADR-0095 is still Proposed).
 */

export type C2WorkspaceView =
  | { kind: 'sessions' }
  | { kind: 'session'; sessionId: string }
  | { kind: 'channel'; transport: string }
  | { kind: 'console'; sessionId: string | null }

export function c2WorkspaceView(route: { page: string; id?: string }): C2WorkspaceView {
  if (route.page === 'c2-session' && route.id) return { kind: 'session', sessionId: route.id }
  if (route.page === 'c2-channel' && route.id) return { kind: 'channel', transport: route.id }
  if (route.page === 'c2-console') return { kind: 'console', sessionId: route.id ?? null }
  return { kind: 'sessions' }
}
