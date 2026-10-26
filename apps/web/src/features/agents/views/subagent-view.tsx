import type { ReactElement } from 'react'
import type { RuntimeInstanceView, ThreadHistoryEvent } from '@raptix/web-contracts'
import { Banner, Button } from '../../../ui/index'
import { renderMarkdown } from '../../../ui/markdown'
import { agentStatus } from '../status'
import { InstanceMessenger } from './instance-messenger'

/** The transcript events one dispatch produced: every session whose start carries its dispatch id, in recorded order. */
function attemptEvents(instance: RuntimeInstanceView, transcripts: ThreadHistoryEvent[]): ThreadHistoryEvent[] {
  const sessions = new Set<string>()
  for (const event of transcripts) {
    const payload = event.payload
    if (payload.type === 'subagent_start' && payload.dispatchId === instance.dispatchId && payload.sessionId) sessions.add(payload.sessionId)
  }
  return transcripts.filter((event) => 'sessionId' in event.payload && event.payload.sessionId !== undefined && sessions.has(event.payload.sessionId))
}

function EventRow({ event }: { event: ThreadHistoryEvent }): ReactElement | null {
  const payload = event.payload
  if (!('sessionId' in payload)) return null
  switch (payload.type) {
    case 'subagent_start':
      return <div className="rounded-xl border border-line bg-subtle p-3 text-xs">
        <p className="mb-1 font-semibold text-muted">Task from the orchestrator</p>
        <div className="text-fg">{renderMarkdown(payload.prompt ?? '')}</div>
      </div>
    case 'subagent_message':
      return <div className="rounded-xl border border-line bg-panel p-3 text-sm">{renderMarkdown(payload.text ?? '')}</div>
    case 'subagent_tool_call':
      return <p className="break-all font-mono text-xs text-muted">▸ {payload.tool ?? 'tool'}{payload.argsPreview ? ` ${payload.argsPreview}` : ''}</p>
    case 'subagent_tool_result':
      return <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-subtle p-2 font-mono text-[11px] text-fg">{payload.content ?? ''}</pre>
    case 'subagent_end': {
      const outcome = payload.error === true ? 'failed' : payload.cancelled === true ? 'cancelled' : payload.status ?? 'completed'
      const elapsed = payload.elapsedSeconds === undefined ? '' : ` · ${payload.elapsedSeconds.toFixed(1)}s`
      return <p className="text-xs font-medium text-muted">Finished · {outcome}{elapsed}</p>
    }
    default:
      return null
  }
}

/** The conversation of one subagent attempt, read from the thread's transcript. Selecting it does not stop the thread. */
export function SubagentView({ engagementId, instance, transcripts, truncated, peers, onBack }: {
  engagementId: string; instance: RuntimeInstanceView; transcripts: ThreadHistoryEvent[]; truncated: boolean
  peers: RuntimeInstanceView[]; onBack: () => void
}): ReactElement {
  const status = agentStatus(instance)
  const events = attemptEvents(instance, transcripts)
  return <section className="flex min-h-0 flex-1 flex-col gap-3" aria-label="Subagent conversation">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Button size="sm" onClick={onBack}>← Back to orchestrator conversation</Button>
      <span className="text-xs text-muted">{status.label}</span>
    </div>
    <h2 className="text-base font-semibold">{`${instance.role ?? 'role not recorded'} · attempt ${instance.attempt}`}</h2>
    {truncated && <Banner tone="warn" title="Older events are omitted">The source keeps only the recent transcript.</Banner>}
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1" aria-live="polite">
      {events.length === 0
        ? <p className="text-sm text-muted">No events are recorded for this attempt yet.</p>
        : events.map((event, index) => <EventRow key={`${event.key ?? 'event'}-${index}`} event={event} />)}
    </div>
    <details className="text-xs">
      <summary className="cursor-pointer text-muted">Operator controls</summary>
      <div className="mt-2">
        <InstanceMessenger engagementId={engagementId} threadId={instance.threadId} dispatchId={instance.dispatchId} attempt={instance.attempt} peers={peers} />
      </div>
    </details>
  </section>
}
