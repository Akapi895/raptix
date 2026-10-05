/**
 * W12 real Findings & Evidence page state: loads parsed workspace findings and
 * the allowlisted artifact browser from the new API only. No demo findings, no
 * fabricated workflow states (status/report/assign), no local PoC execution.
 */
import { useCallback, useEffect, useState } from 'react'
import type { ArtifactContentView, ArtifactsView, FindingsView, ProjectViewModel } from '@raptix/web-contracts'
import { loadArtifactContent, loadArtifacts, loadFindings } from './real-findings-api'

export interface RealFindingsState {
  loading: boolean
  error: string | null
  findings: FindingsView | null
  artifacts: ArtifactsView | null
  content: ArtifactContentView | null
  contentLoading: boolean
  contentError: string | null
  openArtifact(path: string): void
  closeArtifact(): void
  refresh(): void
}

export function useRealFindings(project: ProjectViewModel): RealFindingsState {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [findings, setFindings] = useState<FindingsView | null>(null)
  const [artifacts, setArtifacts] = useState<ArtifactsView | null>(null)
  const [content, setContent] = useState<ArtifactContentView | null>(null)
  const [contentLoading, setContentLoading] = useState(false)
  const [contentError, setContentError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    Promise.all([loadFindings(project.id, controller.signal), loadArtifacts(project.id, controller.signal)]).then(
      ([nextFindings, nextArtifacts]) => {
        if (controller.signal.aborted) return
        setFindings(nextFindings)
        setArtifacts(nextArtifacts)
        setLoading(false)
      },
      cause => {
        if (controller.signal.aborted) return
        setError(cause instanceof Error ? cause.message : 'Findings unavailable')
        setLoading(false)
      },
    )
    return () => controller.abort()
  }, [project.id, revision])

  const openArtifact = useCallback((path: string): void => {
    const controller = new AbortController()
    setContentLoading(true)
    setContentError(null)
    loadArtifactContent(project.id, path, controller.signal).then(
      view => { setContentLoading(false); setContent(view) },
      cause => { setContentLoading(false); setContentError(cause instanceof Error ? cause.message : 'Artifact preview unavailable') },
    )
  }, [project.id])

  const closeArtifact = useCallback((): void => { setContent(null); setContentError(null) }, [])
  const refresh = useCallback((): void => { setRevision(value => value + 1) }, [])

  return { loading, error, findings, artifacts, content, contentLoading, contentError, openArtifact, closeArtifact, refresh }
}
