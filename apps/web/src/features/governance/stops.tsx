/**
 * Emergency stops card (plan P09, Governance slice). A stop latches work until an
 * explicit resolution with a recorded reason, and a resolution never auto-resumes
 * anything. A workspace stop latches every owned engagement with active work
 * (ADR-0074); its sibling latches are listed so each one is resolved from its own
 * engagement's stop list.
 */
import { useState, type ReactElement } from 'react'
import { useMutation } from '@tanstack/react-query'
import { OctagonX } from 'lucide-react'
import { utcMinuteOr } from '../../platform/format'
import { Button, Card, CardHeader, Input, Select, Skeleton, Status } from '../../ui/index'
import { messageOf, useGovernanceStops, useGovernanceWrites } from './query'
import { ACTIVE_STOP_OUTCOMES, type EmergencyStop } from './service'

export function StopsCard({ engagementId }: { engagementId: string }): ReactElement {
  const stops = useGovernanceStops(engagementId)
  const writes = useGovernanceWrites(engagementId)
  const [stopScope, setStopScope] = useState<'project' | 'workspace'>('project')
  const [stopReason, setStopReason] = useState('')
  /** Sibling latches a workspace stop recorded in other owned engagements; null outside a workspace stop. */
  const [siblings, setSiblings] = useState<EmergencyStop[] | null>(null)
  const [resolveDraft, setResolveDraft] = useState<{ stopId: string; reason: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const request = useMutation({
    mutationFn: () => writes.requestStop({ scope: stopScope, reason: stopReason }),
    onSuccess: (view) => {
      setStopReason('')
      setSiblings(view.scope === 'workspace' ? view.related : null)
      setError(null)
    },
    onError: (err) => setError(messageOf(err, 'The emergency stop was refused.')),
  })
  // Explicit resolution with a stale-view guard: the version is the one the row carried.
  const resolve = useMutation({
    mutationFn: (input: { stopId: string; reason: string; concurrencyVersion: number }) => writes.resolveStop(input.stopId, input.reason, input.concurrencyVersion),
    onSuccess: () => { setResolveDraft(null); setError(null) },
    onError: (err) => setError(messageOf(err, 'The resolution was refused.')),
  })

  return (
    <Card>
      <CardHeader title="Emergency stop" sub="Outcomes are truthful; work stays blocked until an explicit resolution with a reason — resolution never auto-resumes anything. A workspace stop latches every owned engagement that is actually running work (ADR-0074)" />
      <form className="grid gap-3 p-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); request.mutate() }}>
        <label className="text-sm text-muted" htmlFor="estop-scope">Scope</label>
        <Select id="estop-scope" aria-label="Stop scope" value={stopScope} onChange={(e) => { setStopScope(e.target.value as 'project' | 'workspace'); setSiblings(null) }}>
          <option value="project">project — this engagement</option>
          <option value="workspace">workspace — every owned engagement with active work</option>
        </Select>
        <label className="text-sm text-muted" htmlFor="estop-reason">Reason</label>
        <Input id="estop-reason" required value={stopReason} onChange={(e) => setStopReason(e.target.value)} />
        <div className="sm:col-span-2">
          <Button type="submit" variant="danger" icon={OctagonX} disabled={request.isPending}>Emergency stop ({stopScope})</Button>
        </div>
        {siblings !== null && (
          <div className="sm:col-span-2 rounded border border-line p-3 text-xs" role="status">
            <p className="font-medium">Workspace stop recorded sibling latches:</p>
            <ul className="mt-1 space-y-1">
              {siblings.map((s) => (
                <li key={s.id}><span className="font-mono">{s.engagementId}</span> — {s.outcome} <span className="text-muted">({s.reason})</span></li>
              ))}
            </ul>
            <p className="mt-1 text-muted">Each engagement must be resolved separately from its own stop list.</p>
          </div>
        )}
        {error !== null && <p className="sm:col-span-2 text-sm text-bad" role="alert">{error}</p>}
      </form>
      <div className="border-t border-line p-4">
        {stops.isError && <p className="text-sm text-bad" role="alert">{messageOf(stops.error, 'The stop list could not be loaded.')}</p>}
        {stops.data === undefined ? (
          <Skeleton className="h-12" />
        ) : stops.data.length === 0 ? (
          <p className="text-sm text-muted">No emergency stops recorded.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="pb-2">Outcome</th>
                <th className="pb-2">Scope</th>
                <th className="pb-2">Reason</th>
                <th className="pb-2">Updated</th>
                <th className="pb-2">Resolution</th>
              </tr>
            </thead>
            <tbody>
              {stops.data.map((s) => {
                const active = ACTIVE_STOP_OUTCOMES.includes(s.outcome)
                return (
                  <tr key={s.id} className="border-t border-line">
                    <td className="py-2 pr-3"><Status kind="gate" value={s.outcome === 'resolved' ? 'passed' : active ? 'failed' : 'pending'} size="sm" label={s.outcome} /></td>
                    <td className="py-2 pr-3 text-xs">{s.scope}</td>
                    <td className="py-2 pr-3 text-xs text-muted">{s.reason}</td>
                    <td className="py-2 pr-3 font-mono text-xs text-muted">{utcMinuteOr(s.updatedAt)}</td>
                    <td className="py-2 text-xs">
                      {active ? (
                        <span className="flex items-center gap-2">
                          <Input
                            aria-label={`Resolution reason for stop ${s.id}`}
                            placeholder="why work may restart"
                            value={resolveDraft?.stopId === s.id ? resolveDraft.reason : ''}
                            onChange={(e) => setResolveDraft({ stopId: s.id, reason: e.target.value })}
                            className="max-w-56"
                          />
                          <Button variant="secondary" disabled={(resolveDraft?.stopId !== s.id || resolveDraft.reason.trim() === '') || resolve.isPending} onClick={() => resolve.mutate({ stopId: s.id, reason: resolveDraft!.reason.trim(), concurrencyVersion: s.concurrencyVersion })}>Resolve</Button>
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  )
}
