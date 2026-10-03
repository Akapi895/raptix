/**
 * W15 settings page state: loads the persisted view, saves through the
 * validated PATCH and always reloads the server view afterwards. A save is
 * only reported as saved after the server acknowledged and the reload returned
 * the persisted values.
 */
import { useCallback, useState, useEffect } from 'react'
import type { EngagementSettingsView, ProjectViewModel } from '@raptix/web-contracts'
import { ApiStatusError } from '../../shared/api/errors'
import { deleteEngagement, loadSettings, saveSettings, type SettingsPatch } from './real-settings-api'

export interface RealSettingsState {
  loading: boolean
  error: string | null
  settings: EngagementSettingsView | null
  saving: boolean
  saved: boolean
  saveError: string | null
  saveField: string | null
  deleting: boolean
  deleteError: string | null
  deleted: boolean
  save(patch: SettingsPatch): void
  destroy(): void
}

export function useRealSettings(project: ProjectViewModel): RealSettingsState {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [settings, setSettings] = useState<EngagementSettingsView | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveField, setSaveField] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleted, setDeleted] = useState(false)
  const [revision] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    loadSettings(project.id, controller.signal).then(
      view => {
        if (controller.signal.aborted) return
        setSettings(view)
        setLoading(false)
      },
      cause => {
        if (controller.signal.aborted) return
        setError(cause instanceof Error ? cause.message : 'Settings unavailable')
        setLoading(false)
      },
    )
    return () => controller.abort()
  }, [project.id, revision])

  const save = useCallback((patch: SettingsPatch): void => {
    const controller = new AbortController()
    setSaving(true)
    setSaved(false)
    setSaveError(null)
    setSaveField(null)
    saveSettings(project.id, patch, controller.signal).then(
      () => loadSettings(project.id, controller.signal),
    ).then(
      view => {
        setSettings(view)
        setSaving(false)
        setSaved(true)
      },
      cause => {
        setSaving(false)
        setSaved(false)
        if (cause instanceof ApiStatusError) {
          setSaveError(cause.message)
          setSaveField(cause.field ?? null)
          return
        }
        setSaveError(cause instanceof Error ? cause.message : 'Save failed')
      },
    )
  }, [project.id])

  const destroy = useCallback((): void => {
    const controller = new AbortController()
    setDeleting(true)
    setDeleteError(null)
    deleteEngagement(project.id, controller.signal).then(
      () => {
        setDeleting(false)
        setDeleted(true)
      },
      cause => {
        setDeleting(false)
        setDeleteError(cause instanceof Error ? cause.message : 'Delete failed')
      },
    )
  }, [project.id])

  return { loading, error, settings, saving, saved, saveError, saveField, deleting, deleteError, deleted, save, destroy }
}
