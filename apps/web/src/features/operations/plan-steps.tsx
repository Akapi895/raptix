/**
 * The engagement's OPPLAN objectives shown as the operation steps (P11, read-only mapping, decided with the
 * owner). Each step shows the status the plan carries; changing a step is not offered here until its write
 * semantics are decided, so this panel never implies a control the runtime does not yet honour.
 */
import type { ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchPlanning } from '../planning/api';
import { consoleKeys, useQueryScope } from '../../state/keys'
import { Banner, Card, CardHeader, Empty } from '../../ui/index'
import { runStatusTone, type StatusTone } from './runtime-status'

const TONE_TEXT: Record<StatusTone, string> = { ok: 'text-ok', bad: 'text-bad', warn: 'text-warn', neutral: 'text-muted' }

export function PlanSteps({ engagementId }: { engagementId: string }): ReactElement {
  const scope = useQueryScope()
  const planning = useQuery({
    queryKey: consoleKeys.view('plan-steps', scope, engagementId),
    queryFn: () => fetchPlanning(engagementId),
    enabled: engagementId !== '' && engagementId !== 'all',
  })

  return (
    <Card>
      <CardHeader title="Steps" sub="OPPLAN objectives as the operation steps, with the status the plan carries. Read-only." />
      <div className="p-4">
        {planning.isPending ? <p role="status" className="text-sm text-muted">Loading steps…</p>
          : planning.isError ? <Banner tone="warn" title="Steps unavailable">{planning.error instanceof Error ? planning.error.message : 'The plan could not be read.'} No substitute steps are shown.</Banner>
          : planning.data.documents.opplan.state !== 'ready' ? <Empty title="No OPPLAN yet">Steps appear once the business plan's objectives are ready.</Empty>
          : planning.data.documents.opplan.content.objectives === undefined || planning.data.documents.opplan.content.objectives.length === 0
            ? <Empty title="No objectives">The OPPLAN has no objectives to run as steps.</Empty>
            : (
              <ol className="divide-y divide-line text-sm">
                {planning.data.documents.opplan.content.objectives.map((objective) => {
                  const status = objective.status ?? 'pending'
                  const blockedBy = objective.blocked_by ?? []
                  return (
                    <li key={objective.id} className="flex flex-wrap items-center gap-2 py-2">
                      <span className="font-mono text-xs text-muted">{objective.id}</span>
                      <span className="font-medium">{objective.title}</span>
                      <span className="text-xs text-muted">{objective.phase}</span>
                      <span className={`font-mono text-xs ${TONE_TEXT[runStatusTone(status)]}`}>{status}</span>
                      {blockedBy.length > 0 && <span className="text-xs text-muted">blocked by {blockedBy.join(', ')}</span>}
                    </li>
                  )
                })}
              </ol>
            )}
      </div>
    </Card>
  )
}
