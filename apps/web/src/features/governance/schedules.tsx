/**
 * Scheduled starts card (plan P09, Governance slice, ADR-0073). A schedule is a
 * durable execution intent: the server dispatches it at its due time through the
 * same gates as a manual start, so no browser timer is involved. The due-time
 * recheck can still refuse it (expired approval, stale scope pin, active stop,
 * closed engagement), and the refusal is shown as the schedule's outcome.
 */
import { useState, type ReactElement } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { zonedToIso } from '../../platform/format'
import { Button, Card, CardHeader, Input, Select, Skeleton, Status } from '../../ui/index'
import { messageOf, useGovernanceSchedules, useGovernanceWrites } from './query'
import type { ExecutionThread, GovernancePlan } from './service'

const TIME_ZONES = ['UTC', 'Asia/Ho_Chi_Minh', 'Asia/Singapore', 'Asia/Tokyo', 'Europe/London', 'Europe/Berlin', 'America/New_York']

export function SchedulesCard({ engagementId, approved, threads }: { engagementId: string; approved: GovernancePlan[]; threads: ExecutionThread[] }): ReactElement {
  const schedules = useGovernanceSchedules(engagementId)
  const writes = useGovernanceWrites(engagementId)
  const [planId, setPlanId] = useState('')
  const [threadId, setThreadId] = useState('')
  const [date, setDate] = useState('')
  const [tz, setTz] = useState('UTC')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const schedule = useMutation({
    mutationFn: () => writes.createSchedule({ planId, threadId, executeAt: zonedToIso(date, tz), timezone: tz, reason, requestId: crypto.randomUUID() }),
    onSuccess: () => { setPlanId(''); setThreadId(''); setDate(''); setReason(''); setError(null) },
    onError: (err) => setError(messageOf(err, 'The schedule was refused.')),
  })
  const cancel = useMutation({
    mutationFn: (input: { scheduleId: string; expectedVersion: number }) => writes.cancelSchedule(input.scheduleId, input.expectedVersion),
    onSuccess: () => setError(null),
    onError: (err) => setError(messageOf(err, 'The cancellation was refused.')),
  })
  const move = useMutation({
    mutationFn: (input: { scheduleId: string; expectedVersion: number }) => writes.rescheduleSchedule(input.scheduleId, { executeAt: zonedToIso(date, tz), timezone: tz, expectedVersion: input.expectedVersion }),
    onSuccess: () => { setDate(''); setError(null) },
    onError: (err) => setError(messageOf(err, 'The reschedule was refused.')),
  })

  return (
    <Card>
      <CardHeader title="Schedule a start" sub="A durable execution intent (ADR-0073): the server worker dispatches it at due time through the same gates as a manual start — no browser timer involved" />
      <form
        className="grid gap-3 p-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (date === '') { setError('Pick a start time.'); return }
          schedule.mutate()
        }}
      >
        <label className="text-sm text-muted" htmlFor="schedule-plan">Approved plan
          <Select id="schedule-plan" aria-label="Approved plan to schedule" value={planId} onChange={(e) => setPlanId(e.target.value)}>
            <option value="">Select…</option>
            {approved.map((p) => <option key={p.id} value={p.id}>v{p.version} — {p.objective.slice(0, 60)}</option>)}
          </Select>
        </label>
        <label className="text-sm text-muted" htmlFor="schedule-thread">Execution thread
          <Select id="schedule-thread" aria-label="Execution thread to schedule" value={threadId} onChange={(e) => setThreadId(e.target.value)}>
            <option value="">Select…</option>
            {threads.map((t) => <option key={t.threadId} value={t.threadId}>{t.threadId}</option>)}
          </Select>
        </label>
        <label className="text-sm text-muted" htmlFor="schedule-date">Start at (entered in the selected timezone)
          <Input id="schedule-date" type="datetime-local" required value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="text-sm text-muted" htmlFor="schedule-tz">Timezone (submitted as an absolute ISO instant)
          <Select id="schedule-tz" aria-label="Schedule timezone" value={tz} onChange={(e) => setTz(e.target.value)}>
            {TIME_ZONES.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
          </Select>
        </label>
        <label className="text-sm text-muted" htmlFor="schedule-reason">Reason</label>
        <Input id="schedule-reason" required value={reason} onChange={(e) => setReason(e.target.value)} />
        <p className="sm:col-span-2 text-xs text-muted" role="status">
          Preview: {date === '' ? '—' : <span className="font-mono">{zonedToIso(date, tz)}</span>} ({tz}) — the due-time recheck can still refuse it (expired approval, stale scope pin, active stop, closed engagement).
        </p>
        <div className="sm:col-span-2">
          <Button type="submit" variant="primary" disabled={schedule.isPending || planId === '' || threadId === ''}>
            {schedule.isPending ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
            Schedule start
          </Button>
        </div>
        {error !== null && <p className="sm:col-span-2 text-sm text-bad" role="alert">{error}</p>}
      </form>
      <div className="border-t border-line p-4">
        {schedules.isError && <p className="text-sm text-bad" role="alert">{messageOf(schedules.error, 'The schedule list could not be loaded.')}</p>}
        {schedules.data === undefined ? (
          <Skeleton className="h-12" />
        ) : schedules.data.length === 0 ? (
          <p className="text-sm text-muted">No scheduled starts.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="pb-2">Status</th>
                <th className="pb-2">Due</th>
                <th className="pb-2">Plan / thread</th>
                <th className="pb-2">Reason</th>
                <th className="pb-2">Outcome</th>
                <th className="pb-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {schedules.data.map((s) => (
                <tr key={s.id} className="border-t border-line">
                  <td className="py-2 pr-3"><Status kind="gate" value={s.status === 'dispatched' ? 'passed' : s.status === 'scheduled' ? 'pending' : 'failed'} size="sm" label={s.status} /></td>
                  <td className="py-2 pr-3 font-mono text-xs">{s.executeAt} ({s.timezone})</td>
                  <td className="py-2 pr-3 font-mono text-xs">v{s.planId.slice(-6)} / {s.threadId}</td>
                  <td className="py-2 pr-3 text-xs text-muted">{s.reason}</td>
                  <td className="py-2 pr-3 text-xs text-muted">{s.runId !== null ? <span className="font-mono">{s.runId}</span> : s.outcomeDetail ?? '—'}</td>
                  <td className="py-2 text-xs">
                    {s.status === 'scheduled' ? (
                      <span className="flex gap-2">
                        <Button variant="secondary" disabled={cancel.isPending} onClick={() => cancel.mutate({ scheduleId: s.id, expectedVersion: s.version })}>Cancel</Button>
                        <Button variant="secondary" disabled={date === '' || move.isPending} onClick={() => move.mutate({ scheduleId: s.id, expectedVersion: s.version })}>Move to picked time</Button>
                      </span>
                    ) : <span className="text-muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  )
}
