import { useState, type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bot, Eye, ShieldCheck } from 'lucide-react'
import { fetchRuntimeInstances, type FleetBranchView, type RuntimeInstanceView } from '../api'
import { InstanceMessenger } from './instance-messenger'
import { go } from '../../router/navigate'
import { Banner, Button, DescList, Segmented, Textarea, cx } from '../../ui'
import { utcMinuteOr } from '../format'

export function RealExecutionAgents({ engagementId, assistantId, threadId, branches, selectedKey, onSelect, sourceError }: {
  engagementId: string; assistantId: string | null; threadId: string | null; branches: FleetBranchView[]; selectedKey: string | null
  onSelect: (key: string | null) => void; sourceError: string | null
}): ReactElement {
  const [tab, setTab] = useState<'agents' | 'context'>('agents')
  return <div className="space-y-4 p-4" aria-label="Real execution agents">
    <Segmented value={tab} onChange={setTab} options={[{ id: 'agents', label: 'Agents' }, { id: 'context', label: 'Context' }]} />
    {tab === 'context' ? <div className="space-y-3 text-sm"><h3 className="flex items-center gap-2 font-semibold"><ShieldCheck size={16} />Execution context</h3><p className="text-xs text-muted">Scope, plans and evidence remain in their API-backed project surfaces.</p>{[{ tab: 'scope', label: 'Scope & ROE' }, { tab: 'planning', label: 'Planning documents' }, { tab: 'findings', label: 'Findings & evidence' }].map((entry) => <Button key={entry.tab} size="sm" onClick={() => go('project', { id: engagementId, tab: entry.tab })}>{entry.label}</Button>)}</div> : <>
      <button className={cx('w-full rounded-xl border p-3 text-left', selectedKey === null ? 'border-accent-line bg-accent-soft/40' : 'border-line')} onClick={() => onSelect(null)} aria-pressed={selectedKey === null}><span className="flex items-center gap-2 text-sm font-semibold"><Bot size={17} />{assistantId ?? 'No assistant binding'}</span><p className="mt-2 text-xs text-muted">Owned thread assistant · communication uses this thread's verified runtime context.</p></button>
      {sourceError && <Banner tone="warn" title="Agent observation unavailable">{sourceError}</Banner>}
      <section><h3 className="mb-2 text-xs font-semibold">Checkpoint invocations · run attribution unavailable</h3><p className="mb-3 text-xs leading-relaxed text-muted">These are recorded invocations within the selected thread, not a proven live spawn tree. Parent identity and per-instance channels are not supplied.</p>
        <ul className="space-y-2">{branches.map((branch) => <li key={`${branch.threadId}/${branch.key}`}><button aria-label={`Observe ${branch.agent} ${branch.key}`} aria-pressed={selectedKey === branch.key} onClick={() => onSelect(branch.key)} className={cx('w-full rounded-xl border p-3 text-left', selectedKey === branch.key ? 'border-accent-line bg-accent-soft/40' : 'border-line hover:bg-hover')}><span className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium"><span>{branch.agent} · <span className="font-mono text-xs">{branch.key.slice(-8)}</span></span><Eye size={14} /></span><p className="mt-1 text-xs text-muted">Recorded state: {branch.state} · outcome {branch.outcome ?? 'unknown'}</p><p className="mt-1 text-[11px] text-muted">{utcMinuteOr(branch.endedAt ?? branch.startedAt)}</p></button></li>)}</ul>
        {!branches.length && <p className="text-xs text-muted">No checkpoint invocations are recorded for this thread.</p>}
      </section>
      <RuntimeRoster engagementId={engagementId} threadId={threadId} />
      <details className="text-xs"><summary className="cursor-pointer text-muted">Communication & control capabilities</summary><p className="mt-2 leading-relaxed">Per running instance: messages, forward to another running instance, cancel (cooperative), and retry or reassign once the attempt has ended. Pause for an instance stays unavailable until the runtime has a pause safe point (P11). Questions resume their recorded thread. Cancel run remains run-scoped.</p><p className="mt-2 break-all font-mono">Thread: {threadId ?? 'not selected'}</p></details>
    </>}
  </div>
}

/** P10b roster: the dispatches the runtime ledger records for the engagement. A thread the runtime cannot read is named, never shown as empty. */
function RuntimeRoster({ engagementId, threadId }: { engagementId: string; threadId: string | null }): ReactElement {
  const roster = useQuery({ queryKey: ['real', 'runtime-instances', engagementId], queryFn: () => fetchRuntimeInstances(engagementId) })
  if (roster.isPending) return <p className="text-xs text-muted">Reading the runtime roster…</p>
  if (roster.isError) return <Banner tone="warn" title="Runtime roster unavailable">{roster.error instanceof Error ? roster.error.message : 'The roster read failed.'}</Banner>
  const instances = roster.data.instances.filter((instance) => threadId === null || instance.threadId === threadId)
  const unread = roster.data.threads.filter((thread) => thread.read === 'unavailable' && (threadId === null || thread.threadId === threadId))
  return <section aria-label="Runtime dispatch roster" className="space-y-2">
    <h3 className="text-xs font-semibold">Dispatch instances · runtime ledger</h3>
    <p className="text-xs leading-relaxed text-muted">Each row is a dispatch the runtime recorded: thread, dispatch and attempt. Dispatches recorded before the runtime named roles show the role as not recorded.</p>
    {unread.length > 0 && <Banner tone="warn" title="Some threads could not be read">{unread.map((thread) => `${thread.threadId.slice(0, 8)}: ${thread.reason ?? 'unavailable'}`).join(' · ')}</Banner>}
    {instances.length === 0 ? <p className="text-xs text-muted">No dispatch instances are recorded{threadId ? ' on this thread' : ''}.</p> : (
      <ul className="space-y-2">
        {instances.map((instance) => <RosterRow key={instance.instanceId} engagementId={engagementId} instance={instance} peers={roster.data.instances} />)}
      </ul>
    )}
  </section>
}

function RosterRow({ engagementId, instance, peers }: { engagementId: string; instance: RuntimeInstanceView; peers: RuntimeInstanceView[] }): ReactElement {
  const [open, setOpen] = useState(false)
  return <li className="rounded-xl border border-line p-3 text-xs">
    <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{instance.role ?? 'role not recorded'} · attempt {instance.attempt}</span><span className="font-mono">{instance.outcome}{instance.terminal ? ' · terminal' : ''}</span></div>
    <p className="mt-1 break-all font-mono text-muted">{instance.dispatchId.slice(0, 12)} · objective {instance.objectiveId ?? '—'} · thread {instance.threadId.slice(0, 8)}</p>
    <Button size="sm" variant="secondary" className="mt-2" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide messages' : 'Messages'}</Button>
    {open && <InstanceMessenger engagementId={engagementId} threadId={instance.threadId} dispatchId={instance.dispatchId} attempt={instance.attempt} peers={peers} />}
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
