import { useState, type ReactElement } from 'react'
import { CheckCircle2, ChevronDown, ChevronRight, CircleDashed, Loader2, MessagesSquare, XCircle } from 'lucide-react'
import { cx } from '../../../ui/index'

export interface ToolProgress {
  /** Tool calls made in the current thread's trace. */
  calls: number
  failed: number
  /** The tool call still waiting for its result, if any. */
  running: string | null
}

/** Work in flight: planning documents ready out of all, and the tool calls of the current run. */
export function ProgressCard({ bundle, labels, tools }: { bundle: Record<string, string> | null; labels: Record<string, string>; tools: ToolProgress }): ReactElement | null {
  const docs = bundle ? Object.entries(bundle) : []
  if (docs.length === 0 && tools.calls === 0) return <p className="text-xs text-muted">Nothing in progress yet. Planning documents and tool calls appear here as the assistant works.</p>
  const ready = docs.filter(([, state]) => state === 'ready').length
  const next = docs.find(([, state]) => state !== 'ready')?.[0]
  return (
    <section aria-label="Progress" className="rounded-xl border border-line bg-panel px-3 py-2.5 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-fg">Progress</span>
        <span className="font-mono text-muted">
          {docs.length > 0 && <span>{ready}/{docs.length} documents</span>}
          {docs.length > 0 && tools.calls > 0 && ' · '}
          {tools.calls > 0 && <span>{tools.calls} tool call{tools.calls === 1 ? '' : 's'}</span>}
          {tools.failed > 0 && <span className="text-bad"> · {tools.failed} failed</span>}
        </span>
      </div>
      {docs.length > 0 && (
        <div role="progressbar" aria-label="Planning documents ready" aria-valuemin={0} aria-valuemax={docs.length} aria-valuenow={ready} className="mt-2 h-1.5 overflow-hidden rounded-full bg-subtle">
          <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${(ready / docs.length) * 100}%` }} />
        </div>
      )}
      {docs.length > 0 && (
        <ul className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-3">
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
      )}
      {tools.running && (
        <p className="mt-2 flex min-w-0 items-center gap-1.5 text-muted">
          <Loader2 size={12} className="shrink-0 motion-safe:animate-spin" aria-hidden />
          <span className="truncate">Running {tools.running}</span>
        </p>
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
          {texts.map((text, i) => <li key={i} className="break-words">{text}</li>)}
        </ul>
      )}
    </li>
  )
}
