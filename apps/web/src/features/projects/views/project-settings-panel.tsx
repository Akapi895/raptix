/**
 * W22: the project detail Settings tab edits the display name and primary
 * target through the real PATCH contract. Target changes are lifecycle-gated
 * by the server; a refusal keeps the form and surfaces the reason instead of
 * silently claiming success. The operator brief is not PATCH-editable by the
 * engagement contract, so it is not offered here.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactElement } from 'react'
import { patchEngagement } from '../remote';
import { targetTypeOf } from '../target';
import type { ProjectViewModel } from '@raptix/web-contracts';
import { useDirty } from '../../../state/session'
import { Banner, Button, Card, CardHeader, Input } from '../../../ui/index'

export function ProjectSettingsPanel({ project }: { project: ProjectViewModel }): ReactElement {
  const client = useQueryClient()
  const [displayName, setDisplayName] = useState(project.displayName)
  const [targetValue, setTargetValue] = useState(project.targetValue)
  const [error, setError] = useState<string | null>(null)
  const dirty = displayName !== project.displayName || targetValue !== project.targetValue
  const save = useMutation({
    mutationFn: () => {
      const targetType = targetTypeOf(targetValue)
      if (targetType === null) throw new Error('Enter a web URL (https://…), an IP address or a CIDR range.')
      return patchEngagement(project.id, {
        displayName: displayName.trim(),
        targetType,
        targetValue: targetValue.trim(),
      })
    },
    onSuccess: () => {
      setError(null)
      void client.invalidateQueries({ queryKey: ['real', 'project', project.id] })
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'The save was refused.'),
  })
  const saveDraft = async (): Promise<void> => { await save.mutateAsync() }
  useDirty(dirty, dirty ? saveDraft : undefined)
  return (
    <Card>
      <CardHeader title="Project settings" sub="The primary target is lifecycle-gated: the server refuses changes after the runtime context is frozen" />
      <div className="grid gap-3 p-4 sm:grid-cols-2">
        <label className="text-sm text-muted" htmlFor="settings-display-name">Display name</label>
        <Input id="settings-display-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        <label className="text-sm text-muted" htmlFor="settings-target">Primary target</label>
        <Input id="settings-target" value={targetValue} onChange={(e) => setTargetValue(e.target.value)} />
        <div className="sm:col-span-2">
          <Button type="button" variant="primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>Save settings</Button>
        </div>
        {error !== null && <div className="sm:col-span-2"><Banner tone="warn" title="The settings save was refused">{error}</Banner></div>}
      </div>
    </Card>
  )
}
