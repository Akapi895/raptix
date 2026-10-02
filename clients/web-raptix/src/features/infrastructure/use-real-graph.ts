/**
 * W13 real Infrastructure & Assets page state: loads the scoped public graph
 * projection and its derived asset summaries from the new API only. Graph-store
 * failure stays distinguishable from emptiness via the server's 503 reason.
 */
import { useCallback, useState, useEffect } from 'react'
import type { AssetsView, GraphView, ProjectViewModel } from '@raptix/web-contracts'
import { ApiStatusError } from '../../shared/api/errors'
import { loadAssets, loadGraph } from './real-graph-api'

export interface RealGraphState {
  loading: boolean
  error: string | null
  unavailable: boolean
  graph: GraphView | null
  assets: AssetsView | null
  refresh(): void
}

export function useRealGraph(project: ProjectViewModel): RealGraphState {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [graph, setGraph] = useState<GraphView | null>(null)
  const [assets, setAssets] = useState<AssetsView | null>(null)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    setUnavailable(false)
    Promise.all([loadGraph(project.id, controller.signal), loadAssets(project.id, controller.signal)]).then(
      ([nextGraph, nextAssets]) => {
        if (controller.signal.aborted) return
        setGraph(nextGraph)
        setAssets(nextAssets)
        setLoading(false)
      },
      cause => {
        if (controller.signal.aborted) return
        setUnavailable(cause instanceof ApiStatusError && cause.statusCode === 503)
        setError(cause instanceof Error ? cause.message : 'Graph unavailable')
        setLoading(false)
      },
    )
    return () => controller.abort()
  }, [project.id, revision])

  const refresh = useCallback((): void => { setRevision(value => value + 1) }, [])

  return { loading, error, unavailable, graph, assets, refresh }
}
