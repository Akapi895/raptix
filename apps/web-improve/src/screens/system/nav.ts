/**
 * System-page navigation seam (ticket 61a).
 *
 * The system screens navigate through the active data router (ticket 07 —
 * the single location writer) with the same `useNavigate` + `toHref`
 * composition as ticket 14's `useConsoleGo`, so no surface here needs the
 * legacy store context. `useSystemRoute` projects the router location into
 * the legacy Route shape for pages that display the requested path.
 */
import { useLocation, useNavigate } from 'react-router'
import { parseLocation, toHref } from '../../router/history'
import type { Route } from '../../router/history'

export type SystemGo = (page: string, opts?: { id?: string; tab?: string }) => void

/** Navigates through the router and scrolls the shell pane back to the top. */
export function useSystemGo(): SystemGo {
  const navigate = useNavigate()
  return (page, opts) => {
    navigate(toHref({ page, id: opts?.id, tab: opts?.tab }))
    document.querySelector('main')?.scrollTo?.(0, 0)
  }
}

/** The current route as projected from the router location (never written here). */
export function useSystemRoute(): Route {
  const location = useLocation()
  return parseLocation({ pathname: location.pathname, search: location.search })
}
