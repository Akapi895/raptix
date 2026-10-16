/**
 * One-time project-scope adoption for resource deep links (plan 2026-10-16
 * §4.2). Opening an operation, finding, report or session while the console
 * is in All Projects adopts that resource's owning project, so scoped
 * controls, the ribbon and the shell tell the truth instead of asking the
 * operator to re-select the project they just opened.
 *
 * Only `all` is adopted: an explicit project scope is never silently
 * retargeted (a foreign resource keeps its own blocked state), and a resource
 * without an owning project stays in the aggregate scope.
 */
import { useEffect } from 'react'
import { useProjectStore } from '../state/stores'

export function useResourceScope(projectId: string | undefined): void {
  useEffect(() => {
    if (!projectId) return
    const project = useProjectStore.getState()
    if (project.pid === 'all') project.setPid(projectId)
  }, [projectId])
}
