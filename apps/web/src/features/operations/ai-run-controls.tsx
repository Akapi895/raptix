/**
 * Run controls on the AI workspace (plan phase 6). The panel reuses the Execution tab's runtime calls and
 * its run rows, so pause, resume and cancel act on the run they name and show the runtime's own status and
 * tool activity. It keeps no lifecycle of its own. The Execution tab keeps the same controls until the
 * switch is verified, and the panel is shown only while the asset map flag is on.
 */
import type { ReactElement } from 'react'
import { Banner, Card, CardHeader, Skeleton } from '../../ui'
import { messageOf, useRuntimeThreads } from './runtime-query'
import { ThreadRuns } from './runtime-runs'

export function AiRunControls({ engagementId }: { engagementId: string }): ReactElement {
  const threads = useRuntimeThreads(engagementId)
  const list = threads.data ?? []
  return (
    <Card>
      <CardHeader title="Run controls" sub="Pause, resume and cancel act on the runtime's own runs. Execution keeps the same controls." />
      <div className="space-y-4 p-4">
        {threads.isPending ? (
          <div aria-busy="true" role="status"><Skeleton className="h-10" /></div>
        ) : threads.isError ? (
          <Banner tone="warn" title="Threads source unavailable">{messageOf(threads.error, 'Threads could not be loaded.')}</Banner>
        ) : list.length === 0 ? (
          <p className="text-sm text-muted">No execution thread for this engagement yet.</p>
        ) : (
          list.map((thread) => (
            <div key={thread.threadId} className="space-y-2">
              <p className="font-mono text-xs text-muted">{thread.threadId}</p>
              <ul>
                <ThreadRuns engagementId={engagementId} thread={thread} />
              </ul>
            </div>
          ))
        )}
      </div>
    </Card>
  )
}
