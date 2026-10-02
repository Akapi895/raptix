/**
 * Real-mode providers (W03): retains the shared projects list store for the
 * whole real-app lifetime, so route switches never release/abort the active
 * read between the home and workspace views. Mock mode never mounts this.
 * Planning/runtime providers (W04+) will mount here as they land.
 */
import { useEffect, type ReactNode } from 'react'
import { projectsStore } from '../features/projects/hooks/use-real-projects'

export function RealProviders({ children }: { children: ReactNode }) {
  useEffect(() => {
    projectsStore.retainList()
    return () => projectsStore.releaseList()
  }, [])
  return <>{children}</>
}
