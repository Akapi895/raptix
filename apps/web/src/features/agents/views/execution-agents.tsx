import { useState, type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bot, ChevronDown, ChevronRight } from 'lucide-react'
import { fetchRuntimeInstances } from '../remote';
import type { RuntimeInstanceView } from '@raptix/web-contracts'
import { Banner, cx } from '../../../ui/index'
import { agentStatus, type AgentTone } from '../status'

const TONE_DOT: Record<AgentTone, string> = {
  running: 'bg-warn',
  done: 'bg-ok',
  failed: 'bg-bad',
  stopped: 'bg-neutral',
}

/** The thread's agents: the orchestrator, then the runtime's dispatch tree. Selecting an agent opens its conversation. */
export function RealExecutionAgents({ engagementId, assistantId, openedDispatchId, onOpen }: {
  engagementId: string; assistantId: string | null
  openedDispatchId: string | null; onOpen: (instance: RuntimeInstanceView | null) => void
}): ReactElement {
  return <div className="space-y-4 p-4" aria-label="Real execution agents">
    <button className={cx('w-full rounded-xl border p-3 text-left', openedDispatchId === null ? 'border-accent-line bg-accent-soft/40' : 'border-line hover:bg-hover')} onClick={() => onOpen(null)} aria-pressed={openedDispatchId === null}>
      <span className="flex items-center gap-2 text-sm font-semibold"><Bot size={17} aria-hidden />{assistantId ?? 'No assistant binding'}</span>
      <span className="mt-1 block text-xs text-muted">Orchestrator of this thread</span>
    </button>
    <RuntimeTree engagementId={engagementId} openedDispatchId={openedDispatchId} onOpen={onOpen} />
  </div>
}

/**
 * Agent tree: a dispatch sits under the dispatch that started it when the runtime recorded that parent. Dispatches with
 * no recorded parent (the orchestrator's own) are the top level, grouped by the objective they served. Agents with no
 * recorded objective sit under their own group, never guessed.
 */
function RuntimeTree({ engagementId, openedDispatchId, onOpen }: {
  engagementId: string; openedDispatchId: string | null; onOpen: (instance: RuntimeInstanceView) => void
}): ReactElement {
  const roster = useQuery({ queryKey: ['real', 'runtime-instances', engagementId], queryFn: () => fetchRuntimeInstances(engagementId) })
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  if (roster.isPending) return <p className="text-xs text-muted">Reading the runtime roster…</p>
  if (roster.isError) return <Banner tone="warn" title="Runtime roster unavailable">{roster.error instanceof Error ? roster.error.message : 'The roster read failed.'}</Banner>
  const instances = roster.data.instances
  const unread = roster.data.threads.filter((thread) => thread.read === 'unavailable')
  const { roots, childrenOf, latest } = nestRoster(instances)
  const groups = new Map<string, RuntimeInstanceView[]>()
  for (const root of roots) {
    const key = root.objectiveId ?? 'no-objective'
    groups.set(key, [...(groups.get(key) ?? []), root])
  }
  const toggle = (key: string): void => setCollapsed((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next })
  return <section aria-label="Agent tree" className="space-y-2">
    <h3 className="text-xs font-semibold">Objectives and agents</h3>
    {unread.length > 0 && <Banner tone="warn" title="Some threads could not be read">{unread.map((thread) => `${thread.threadId.slice(0, 8)}: ${thread.reason ?? 'unavailable'}`).join(' · ')}</Banner>}
    {instances.length === 0 ? <p className="text-xs text-muted">No dispatch instances are recorded for this engagement.</p> : (
      <ul className="space-y-1">
        {[...groups.entries()].map(([key, members]) => {
          const isOpen = !collapsed.has(key)
          const subtree = new Set(members.flatMap((root) => [...reachable(root, childrenOf)]))
          const running = [...subtree].filter((c) => agentStatus(c).tone === 'running').length
          return <li key={key}>
            <button type="button" aria-expanded={isOpen} onClick={() => toggle(key)} className="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left text-xs hover:bg-hover">
              {isOpen ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
              <span className="min-w-0 flex-1 truncate font-medium text-fg">{key === 'no-objective' ? 'No objective recorded' : key}</span>
              <span className="shrink-0 text-muted">{subtree.size} agent{subtree.size === 1 ? '' : 's'}{running > 0 && <span className="text-warn">{` · ${running} running`}</span>}</span>
            </button>
            {isOpen && <ul className="ml-4 mt-1 space-y-1 border-l border-line pl-3">
              {members.map((instance) => <AgentNode key={instance.instanceId} instance={instance}
                childrenOf={childrenOf} latest={latest} ancestors={NO_ANCESTORS} openedDispatchId={openedDispatchId} onOpen={onOpen} />)}
            </ul>}
          </li>
        })}
      </ul>
    )}
  </section>
}

const NO_ANCESTORS: ReadonlySet<string> = new Set()

/** Parent dispatch id → the instances it started. A dispatch whose parent is not in the roster stays at the top. */
function nestRoster(instances: RuntimeInstanceView[]): { roots: RuntimeInstanceView[]; childrenOf: Map<string, RuntimeInstanceView[]>; latest: Map<string, number> } {
  const latest = new Map<string, number>()
  for (const instance of instances) latest.set(instance.dispatchId, Math.max(latest.get(instance.dispatchId) ?? 0, instance.attempt))
  const childrenOf = new Map<string, RuntimeInstanceView[]>()
  const roots: RuntimeInstanceView[] = []
  for (const instance of instances) {
    const parent = instance.parentDispatchId
    if (parent !== null && parent !== instance.dispatchId && latest.has(parent)) childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), instance])
    else roots.push(instance)
  }
  // Parents recorded in a loop would hide every member; each loop surfaces one member at the top so nothing disappears.
  const seen = new Set<RuntimeInstanceView>()
  for (const root of roots) reachable(root, childrenOf, seen)
  for (const instance of instances) {
    if (seen.has(instance)) continue
    roots.push(instance)
    reachable(instance, childrenOf, seen)
  }
  return { roots, childrenOf, latest }
}

function reachable(node: RuntimeInstanceView, childrenOf: Map<string, RuntimeInstanceView[]>, out = new Set<RuntimeInstanceView>()): Set<RuntimeInstanceView> {
  if (out.has(node)) return out
  out.add(node)
  for (const child of childrenOf.get(node.dispatchId) ?? []) reachable(child, childrenOf, out)
  return out
}

function AgentNode({ instance, childrenOf, latest, ancestors, openedDispatchId, onOpen }: {
  instance: RuntimeInstanceView; childrenOf: Map<string, RuntimeInstanceView[]>; latest: Map<string, number>
  ancestors: ReadonlySet<string>; openedDispatchId: string | null; onOpen: (instance: RuntimeInstanceView) => void
}): ReactElement {
  const status = agentStatus(instance)
  const below = new Set([...ancestors, instance.dispatchId])
  // Children hang under the newest attempt only, so a retried parent does not repeat its children.
  const children = latest.get(instance.dispatchId) === instance.attempt
    ? (childrenOf.get(instance.dispatchId) ?? []).filter((child) => !below.has(child.dispatchId))
    : []
  const label = `${instance.role ?? 'role not recorded'} · attempt ${instance.attempt}`
  const selected = openedDispatchId === instance.dispatchId
  return <li className="text-xs">
    <button type="button" aria-pressed={selected} aria-label={`${label}, ${status.label}`} onClick={() => onOpen(instance)}
      title={`dispatch ${instance.dispatchId} · thread ${instance.threadId.slice(0, 8)} · runtime outcome: ${instance.outcome}${instance.terminal ? ' · terminal' : ''}`}
      className={cx('flex w-full min-w-0 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left hover:bg-hover', selected ? 'border-accent-line bg-accent-soft/40' : 'border-line')}>
      <span className={cx('h-2 w-2 shrink-0 rounded-full', TONE_DOT[status.tone])} aria-hidden />
      <span className="min-w-0 flex-1 truncate font-medium text-fg">{label}</span>
      <span className="shrink-0 font-mono text-[10px] text-muted">{instance.threadId.slice(0, 8)}</span>
      <span className="shrink-0 text-muted">{status.label}</span>
    </button>
    {children.length > 0 && <ul className="mt-2 space-y-1 border-l border-line pl-3">
      {children.map((child) => <AgentNode key={child.instanceId} instance={child}
        childrenOf={childrenOf} latest={latest} ancestors={below} openedDispatchId={openedDispatchId} onOpen={onOpen} />)}
    </ul>}
  </li>
}
