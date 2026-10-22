import { useState, type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bot, ChevronDown, ChevronRight, Eye } from 'lucide-react'
import { fetchRuntimeInstances } from '../remote';
import type { FleetBranchView } from '../../operations/api';
import type { RuntimeInstanceView } from '@raptix/web-contracts';
import { InstanceMessenger } from './instance-messenger'
import { Banner, Button, DescList, Textarea, cx } from '../../../ui/index'
import { utcMinuteOr } from '../../../platform/format'

type AgentTone = 'running' | 'done' | 'failed' | 'stopped'

/** The runtime's own outcome words mapped to the four states the operator reads: Running, Completed, Failed, Stopped. */
function agentStatus(instance: RuntimeInstanceView): { label: string; tone: AgentTone } {
  if (instance.outcome === 'running') return { label: 'Running', tone: 'running' }
  if (instance.outcome === 'cancel_requested') return { label: 'Stopping', tone: 'running' }
  if (instance.outcome === 'success' || instance.outcome === 'finished') return { label: 'Completed', tone: 'done' }
  if (instance.outcome === 'failed' || instance.outcome === 'error' || instance.outcome === 'timeout') return { label: 'Failed', tone: 'failed' }
  return { label: 'Stopped', tone: 'stopped' }
}

const TONE_DOT: Record<AgentTone, string> = {
  running: 'bg-cyan',
  done: 'bg-ok',
  failed: 'bg-bad',
  stopped: 'bg-neutral',
}

export function RealExecutionAgents({ engagementId, assistantId, threadId, branches, selectedKey, onSelect, sourceError }: {
  engagementId: string; assistantId: string | null; threadId: string | null; branches: FleetBranchView[]; selectedKey: string | null
  onSelect: (key: string | null) => void; sourceError: string | null
}): ReactElement {
  return <div className="space-y-4 p-4" aria-label="Real execution agents">
    <button className={cx('w-full rounded-xl border p-3 text-left', selectedKey === null ? 'border-accent-line bg-accent-soft/40' : 'border-line hover:bg-hover')} onClick={() => onSelect(null)} aria-pressed={selectedKey === null}>
      <span className="flex items-center gap-2 text-sm font-semibold"><Bot size={17} aria-hidden />{assistantId ?? 'No assistant binding'}</span>
      <span className="mt-1 block text-xs text-muted">Orchestrator of this thread</span>
    </button>
    {sourceError && <Banner tone="warn" title="Agent observation unavailable">{sourceError}</Banner>}
    <RuntimeTree engagementId={engagementId} threadId={threadId} />
    {branches.length > 0 && (
      <details className="text-xs" open={branches.some((b) => b.key === selectedKey)}>
        <summary className="cursor-pointer text-muted">Checkpoint invocations ({branches.length}) · recorded, not live</summary>
        <p className="mb-2 mt-2 leading-relaxed text-muted">Recorded invocations within the selected thread. Parent identity and per-instance channels are not supplied by this projection.</p>
        <ul className="space-y-2">{branches.map((branch) => <li key={`${branch.threadId}/${branch.key}`}>
          <button aria-label={`Observe ${branch.agent} ${branch.key}`} aria-pressed={selectedKey === branch.key} onClick={() => onSelect(branch.key)}
            className={cx('w-full rounded-xl border p-3 text-left', selectedKey === branch.key ? 'border-accent-line bg-accent-soft/40' : 'border-line hover:bg-hover')}>
            <span className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium"><span>{branch.agent} · <span className="font-mono text-xs">{branch.key.slice(-8)}</span></span><Eye size={14} aria-hidden /></span>
            <span className="mt-1 block text-xs text-muted">Recorded state: {branch.state} · outcome {branch.outcome ?? 'unknown'}</span>
          </button>
        </li>)}</ul>
      </details>
    )}
    <details className="text-xs"><summary className="cursor-pointer text-muted">Communication & control capabilities</summary><p className="mt-2 leading-relaxed">Per running instance: messages, forward to another running instance, cancel (cooperative), and retry or reassign once the attempt has ended. Pause for an instance stays unavailable until the runtime has a pause safe point (P11). Questions resume their recorded thread. Cancel run remains run-scoped.</p><p className="mt-2 break-all font-mono">Thread: {threadId ?? 'not selected'}</p></details>
  </div>
}

/**
 * Agent tree: a dispatch sits under the dispatch that started it when the runtime recorded that parent. Dispatches with
 * no recorded parent (the orchestrator's own) are the top level, grouped by the objective they served. Agents with no
 * recorded objective sit under their own group, never guessed.
 */
function RuntimeTree({ engagementId, threadId }: { engagementId: string; threadId: string | null }): ReactElement {
  const roster = useQuery({ queryKey: ['real', 'runtime-instances', engagementId], queryFn: () => fetchRuntimeInstances(engagementId) })
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  if (roster.isPending) return <p className="text-xs text-muted">Reading the runtime roster…</p>
  if (roster.isError) return <Banner tone="warn" title="Runtime roster unavailable">{roster.error instanceof Error ? roster.error.message : 'The roster read failed.'}</Banner>
  const instances = roster.data.instances.filter((instance) => threadId === null || instance.threadId === threadId)
  const unread = roster.data.threads.filter((thread) => thread.read === 'unavailable' && (threadId === null || thread.threadId === threadId))
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
    {instances.length === 0 ? <p className="text-xs text-muted">No dispatch instances are recorded{threadId ? ' on this thread' : ''}.</p> : (
      <ul className="space-y-1">
        {[...groups.entries()].map(([key, members]) => {
          const isOpen = !collapsed.has(key)
          const subtree = new Set(members.flatMap((root) => [...reachable(root, childrenOf)]))
          const running = [...subtree].filter((c) => agentStatus(c).tone === 'running').length
          return <li key={key}>
            <button type="button" aria-expanded={isOpen} onClick={() => toggle(key)} className="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left text-xs hover:bg-hover">
              {isOpen ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
              <span className="min-w-0 flex-1 truncate font-medium text-fg">{key === 'no-objective' ? 'No objective recorded' : key}</span>
              <span className="shrink-0 text-muted">{subtree.size} agent{subtree.size === 1 ? '' : 's'}{running > 0 ? ` · ${running} running` : ''}</span>
            </button>
            {isOpen && <ul className="ml-4 mt-1 space-y-1 border-l border-line pl-3">
              {members.map((instance) => <AgentNode key={instance.instanceId} engagementId={engagementId} instance={instance} peers={instances}
                childrenOf={childrenOf} latest={latest} ancestors={NO_ANCESTORS} />)}
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

function AgentNode({ engagementId, instance, peers, childrenOf, latest, ancestors }: {
  engagementId: string; instance: RuntimeInstanceView; peers: RuntimeInstanceView[]
  childrenOf: Map<string, RuntimeInstanceView[]>; latest: Map<string, number>; ancestors: ReadonlySet<string>
}): ReactElement {
  const [open, setOpen] = useState(false)
  const status = agentStatus(instance)
  const below = new Set([...ancestors, instance.dispatchId])
  // Children hang under the newest attempt only, so a retried parent does not repeat its children.
  const children = latest.get(instance.dispatchId) === instance.attempt
    ? (childrenOf.get(instance.dispatchId) ?? []).filter((child) => !below.has(child.dispatchId))
    : []
  const label = `${instance.role ?? 'role not recorded'} · attempt ${instance.attempt}`
  return <li className="text-xs">
    <button type="button" aria-expanded={open} aria-label={`${label}, ${status.label}`} onClick={() => setOpen(!open)}
      title={`dispatch ${instance.dispatchId} · thread ${instance.threadId.slice(0, 8)} · runtime outcome: ${instance.outcome}${instance.terminal ? ' · terminal' : ''}`}
      className={cx('flex w-full min-w-0 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left hover:bg-hover', open ? 'border-accent-line bg-accent-soft/40' : 'border-line')}>
      <span className={cx('h-2 w-2 shrink-0 rounded-full', TONE_DOT[status.tone])} aria-hidden />
      <span className="min-w-0 flex-1 truncate font-medium text-fg">{label}</span>
      <span className="shrink-0 text-muted">{status.label}</span>
    </button>
    {open && <div className="mt-2 space-y-2 rounded-lg border border-line p-2.5">
      <p className="font-mono text-[11px] text-neutral">{instance.dispatchId.slice(0, 12)} · thread {instance.threadId.slice(0, 8)} · <span className="text-muted">{instance.outcome}{instance.terminal ? ' · terminal' : ''}</span></p>
      <InstanceMessenger engagementId={engagementId} threadId={instance.threadId} dispatchId={instance.dispatchId} attempt={instance.attempt} peers={peers} />
    </div>}
    {children.length > 0 && <ul className="mt-2 space-y-1 border-l border-line pl-3">
      {children.map((child) => <AgentNode key={child.instanceId} engagementId={engagementId} instance={child} peers={peers}
        childrenOf={childrenOf} latest={latest} ancestors={below} />)}
    </ul>}
  </li>
}

export function ObservedInvocation({ branch, onRoot }: { branch?: FleetBranchView; onRoot: () => void }): ReactElement {
  return <section className="space-y-4 rounded-xl border border-line bg-panel p-5" aria-label="Observed agent invocation">
    <Button size="sm" onClick={onRoot}>← Back to orchestrator conversation</Button>
    <h2 className="text-lg font-semibold">{branch?.agent ?? 'Invocation source unavailable'}</h2>
    <Banner tone="info" title="Observe-only invocation">No independently addressable conversation or per-instance control contract is supplied. Checkpoint logs cannot prove a live message recipient, spawn parent or current-run identity.</Banner>
    {branch && <DescList cols={2} items={[{ k: 'Recorded state', v: branch.state }, { k: 'Recorded outcome', v: branch.outcome ?? 'Unknown' }, { k: 'Started', v: utcMinuteOr(branch.startedAt) }, { k: 'Ended', v: utcMinuteOr(branch.endedAt) }, { k: 'Parent / run', v: 'Unknown / not attributed by source' }, { k: 'Objective / target', v: 'Not supplied by this projection' }]} />}
    <p className="text-sm text-muted">No instance-scoped transcript is available. Unattributed tool events stay in thread history.</p>
    <Textarea aria-label="Observed invocation — read-only" disabled placeholder="Messaging unavailable for this invocation" />
    <details className="text-xs"><summary className="cursor-pointer text-muted">Source identity</summary><p className="mt-2 break-all font-mono">{branch ? `${branch.threadId} / ${branch.key} · ${branch.provenance}` : 'Source missing; no outcome inferred.'}</p></details>
  </section>
}
