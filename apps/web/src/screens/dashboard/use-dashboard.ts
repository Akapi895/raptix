/**
 * Console navigation for the legacy screens (ticket 14). The overview reads moved to features/overview; this module keeps the
 * router-backed navigation the tasks inbox still uses. Navigation goes through the active data router (ticket 07), the single
 * location writer.
 */
import { useNavigate } from 'react-router'
import { toHref } from '../../router/history'

export type ConsoleGo = (page: string, opts?: { id?: string; tab?: string }) => void

/** Navigates through the active data router and scrolls the shell pane to the top. */
export function useConsoleGo(): ConsoleGo {
  const navigate = useNavigate()
  return (page, opts) => {
    navigate(toHref({ page, id: opts?.id, tab: opts?.tab }))
    document.querySelector('main')?.scrollTo?.(0, 0)
  }
}
