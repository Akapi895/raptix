import { useState, type ReactElement } from 'react'
import { CheckCircle2, ChevronDown, ChevronRight, CircleDashed, Loader2, MessagesSquare, XCircle } from 'lucide-react'
import { cx } from '../../../ui/index'
import { renderMarkdown } from '../../../ui/markdown'

/** Work done on this thread, read from persisted data: subagent attempts, tool calls, and the OPPLAN objectives. */
export interface ExecutionProgress {
  agents: { running: number; done: number; failed: number }
  /** Tool calls on the thread, subagents included; `truncated` when the source omitted older ones. */
  toolCalls: { count: number; truncated: boolean }
  /** The tool call still waiting for its result, if any. */
  runningTool: string | null
  /** The OPPLAN objectives in execution; null in planning, where the planning documents show instead. */
  objectives: { id: string; title: string; status: string }[] | null
}

const OBJECTIVE_DOT: Record<string, string> = {
  completed: 'bg-ok',
  'in-progress': 'bg-warn',
  blocked: 'bg-bad',
  pending: 'bg-neutral',
  cancelled: 'bg-neutral',
}

export function ProgressCard({ bundle, labels, progress }: { bundle: Record<string, string> | null; labels: Record<string, string>; progress: ExecutionProgress }): ReactElement {
  const docs = bundle ? Object.entries(bundle) : []
  const ready = docs.filter(([, state]) => state === 'ready').length
  const next = docs.find(([, state]) => state !== 'ready')?.[0]
  const { agents, toolCalls, runningTool, objectives } = progress
  const hasAgents = agents.running + agents.done + agents.failed > 0
  const hasObjectives = objectives !== null && objectives.length > 0
  const hasWork = docs.length > 0 || hasAgents || toolCalls.count > 0 || hasObjectives
  if (!hasWork) return <p className="text-xs text-muted">No work has started on this thread yet.</p>
  return (
    <section aria-label="Progress" className="space-y-3 rounded-xl border border-line bg-panel px-3 py-2.5 text-xs">
      {docs.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium text-fg">Planning documents</span>
            <span className="font-mono text-muted">{ready}/{docs.length} documents</span>
          </div>
          <div role="progressbar" aria-label="Planning documents ready" aria-valuemin={0} aria-valuemax={docs.length} aria-valuenow={ready} className="h-1.5 overflow-hidden rounded-full bg-subtle">
            <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${(ready / docs.length) * 100}%` }} />
          </div>
          <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
            {docs.map(([name, state]) => (
              <li key={name} className={cx('flex min-w-0 items-center gap-1.5', state === 'ready' ? 'text-fg' : 'text-muted')}>
                {state === 'ready'
                  ? <CheckCircle2 size={12} className="shrink-0 text-ok" aria-hidden />
                  : state === 'invalid'
                    ? <XCircle size={12} className="shrink-0 text-bad" aria-hidden />
                    : <CircleDashed size={12} className="shrink-0" aria-hidden />}
                <span className="min-w-0 truncate">{labels[name] ?? name}</span>
                {name === next && <span className="ml-auto shrink-0 text-[10px] uppercase text-accent">next</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {hasAgents && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-medium text-fg">Agents</span>
          {agents.running > 0 && <span className="flex items-center gap-1.5 text-warn"><span className="h-2 w-2 rounded-full bg-warn" aria-hidden />{agents.running} running</span>}
          {agents.done > 0 && <span className="flex items-center gap-1.5 text-ok"><span className="h-2 w-2 rounded-full bg-ok" aria-hidden />{agents.done} done</span>}
          {agents.failed > 0 && <span className="flex items-center gap-1.5 text-bad"><span className="h-2 w-2 rounded-full bg-bad" aria-hidden />{agents.failed} failed</span>}
        </div>
      )}
      {toolCalls.count > 0 && <p className="font-mono text-muted">{toolCalls.count}{toolCalls.truncated ? '+' : ''} tool call{toolCalls.count === 1 && !toolCalls.truncated ? '' : 's'}</p>}
      {runningTool && (
        <p className="flex min-w-0 items-center gap-1.5 text-muted">
          <Loader2 size={12} className="shrink-0 motion-safe:animate-spin" aria-hidden />
          <span className="truncate">Running {runningTool}</span>
        </p>
      )}
      {objectives !== null && (
        <div className="space-y-1.5">
          <span className="font-medium text-fg">Objectives</span>
          {objectives.length === 0 ? <p className="text-muted">OPPLAN not written yet.</p> : (
            <ul className="space-y-1">
              {objectives.map((objective) => (
                <li key={objective.id} className="flex min-w-0 items-center gap-2">
                  <span className={cx('h-2 w-2 shrink-0 rounded-full', OBJECTIVE_DOT[objective.status] ?? 'bg-neutral')} aria-hidden />
                  <span className="shrink-0 font-mono text-muted">{objective.id}</span>
                  <span className="min-w-0 flex-1 truncate text-fg">{objective.title}</span>
                  <span className="shrink-0 text-muted">{objective.status}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

/** Several progress lines in a row become one collapsed group; the newest line stays visible in its header. */
export function UpdatesGroup({ texts }: { texts: string[] }): ReactElement {
  const [open, setOpen] = useState(false)
  return (
    <li className="rounded-xl border border-line text-xs">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-muted hover:text-fg">
        {open ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
        <MessagesSquare size={12} aria-hidden />
        <span className="shrink-0">{texts.length} updates</span>
        <span className="min-w-0 flex-1 truncate text-fg">{texts[texts.length - 1]}</span>
      </button>
      {open && (
        <ul className="space-y-1 border-t border-line px-3 py-2 text-muted">
          {texts.map((text, i) => <li key={i} className="break-words">{renderMarkdown(text)}</li>)}
        </ul>
      )}
    </li>
  )
}
