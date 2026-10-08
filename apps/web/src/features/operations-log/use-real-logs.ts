/**
 * W14 real Operations Log page state: loads the merged, server-bounded
 * timeline from the new API only. No synthetic telemetry is generated in the
 * browser; a bounded response is shown as bounded.
 */
import { useCallback, useState, useEffect } from 'react'
import type { ProjectViewModel, TimelineView } from '@raptix/web-contracts'
import { loadTimeline } from './real-logs-api'

export interface RealLogsState {
  loading: boolean
  error: string | null
  timeline: TimelineView | null
  refresh(): void
}

export function useRealLogs(project: ProjectViewModel): RealLogsState {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [timeline, setTimeline] = useState<TimelineView | null>(null)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    loadTimeline(project.id, controller.signal).then(
      view => {
        if (controller.signal.aborted) return
        setTimeline(view)
        setLoading(false)
      },
      cause => {
        if (controller.signal.aborted) return
        setError(cause instanceof Error ? cause.message : 'Operations log unavailable')
        setLoading(false)
      },
    )
    return () => controller.abort()
  }, [project.id, revision])

  const refresh = useCallback((): void => { setRevision(value => value + 1) }, [])

  return { loading, error, timeline, refresh }
}
