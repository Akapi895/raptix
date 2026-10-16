import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import { Hand, History, PanelRight, ShieldCheck } from 'lucide-react'
import type { Project } from '../../data'
import { can, readOnlyContext } from '../../auth/policy'
import { useServices } from '../../state/services'
import { useQueryScope } from '../../state/keys'
import { useServiceProjection } from '../../state/projection'
import { go } from '../../router/navigate'
import { Banner, Button, Drawer, Empty, Segmented, Select, Status } from '../../ui'
import { INSP, Separator, useResizable, useViewportW } from '../../ui/panel-sizing'
import { ToolProposalCard } from '../../screens/g-common'
import type { DashboardAggregate } from '../../screens/dashboard/domain'
import { AgentsPanel } from './agents-panel'
import { InstanceConversation } from './conversation'
import { observeInstanceRequest, readWorkspaces, saveInstanceDraft, submitInstanceRequest } from './service'
import { persistExecution, restoreExecution } from './recovery'
import type { Outcome } from './model'

export function ExecutionWorkspace(props: { project: Project; aggregate: DashboardAggregate; history: ReactNode }): ReactElement {
  const scope = useQueryScope()
  return <Workspace key={`${scope.actor}/${scope.role}/${props.project.id}`} {...props} />
}

function Workspace({ project, aggregate, history }: { project: Project; aggregate: DashboardAggregate; history: ReactNode }): ReactElement {
  const services = useServices()
  const scope = useQueryScope()
  const ctx = useMemo(() => ({ actor: { id: scope.actor, role: scope.role }, projectId: project.id, corr: 'mock-execution-workspace' }), [scope.actor, scope.role, project.id])
  const workspaces = useServiceProjection(readWorkspaces, project.id)
  const ops = aggregate.operations.filter((operation) => operation.projectId === project.id)
  const selectionKey = `raptix.mock.execution.selection.${encodeURIComponent(scope.actor)}.${project.id}`
  const [selection, setSelection] = useState<{ executionId: string; instanceId: string } | null>(() => {
    try { const parsed: unknown = JSON.parse(localStorage.getItem(selectionKey) ?? 'null'); return parsed && typeof parsed === 'object' && 'executionId' in parsed && typeof parsed.executionId === 'string' && 'instanceId' in parsed && typeof parsed.instanceId === 'string' ? { executionId: parsed.executionId, instanceId: parsed.instanceId } : null } catch { return null }
  })
  const workspace = workspaces.find((row) => row.executionId === selection?.executionId) ?? workspaces.find((row) => ops.some((operation) => operation.id === row.executionId && operation.status === 'running')) ?? workspaces[0]
  const root = workspace?.instances.find((instance) => instance.role === 'Orchestrator')
  const selected = workspace?.instances.find((instance) => instance.id === selection?.instanceId) ?? root
  const [panelTab, setPanelTab] = useState<'agents' | 'context'>('agents')
  const [panelOpen, setPanelOpen] = useState(true)
  const [sheet, setSheet] = useState<'panel' | 'history' | null>(null)
  const [outcome, setOutcome] = useState<Outcome>('delivered')
  const [error, setError] = useState('')
  const width = useViewportW()
  const wide = width >= 1280
  const sizing = useResizable('raptix.execution.agents.width', INSP)
  const writable = !readOnlyContext(project, ctx.actor)
  const attention = workspace?.questions.filter((question) => question.answer === undefined) ?? []
  useEffect(() => {
    try { restoreExecution(services, ctx) } catch (failure) { setError(failure instanceof Error ? failure.message : 'Demo recovery failed.') }
    return services.subscribe((change) => {
      if (!change.entities.some((entity) => entity.kind === 'agent-workspace' && entity.projectId === project.id)) return
      try { persistExecution(services, ctx) } catch (failure) { setError(failure instanceof Error ? failure.message : 'Demo recovery snapshot could not be saved.') }
    })
  }, [services, ctx, project.id])
  useEffect(() => { if (wide) setSheet((current) => current === 'panel' ? null : current) }, [wide])
  const select = (instanceId: string, executionId = workspace?.executionId): void => {
    if (!executionId) return
    const next = { executionId, instanceId }
    setSelection(next)
    try { localStorage.setItem(selectionKey, JSON.stringify(next)) } catch { setError('Selection recovery storage is unavailable.') }
  }
  const act = (mutation: () => void): void => { setError(''); try { mutation() } catch (failure) { setError(failure instanceof Error ? failure.message : 'The request was refused.') } }
  const panel = workspace && selected ? <>
    <div className="border-b border-line p-3"><Segmented value={panelTab} onChange={setPanelTab} options={[{ id: 'agents', label: 'Agents' }, { id: 'context', label: 'Context' }]} /></div>
    {panelTab === 'agents' ? <AgentsPanel workspace={workspace} selected={selected} writable={writable && (can(ctx.actor, 'run', project) || can(ctx.actor, 'estop', project))} onSelect={(id) => { select(id); if (!wide) setSheet(null) }} onControl={(action, reason) => act(() => { submitInstanceRequest(services, ctx, workspace.executionId, selected.id, action, reason, outcome) })} /> : <div className="space-y-5 p-4 text-sm">
      <section><h3 className="mb-2 flex items-center gap-2 font-semibold"><ShieldCheck size={16} />Scope & ROE</h3><p>{project.roeVersion}</p><div className="my-2"><Status kind="roe" value={project.roeStatus} /></div><p className="text-xs text-muted">{project.window} · {project.emergency || 'No emergency contact'}</p><Button className="mt-2" size="sm" onClick={() => go('project', { id: project.id, tab: 'scope' })}>Open Scope & ROE</Button></section>
      <section><h3 className="mb-2 font-semibold">Plan & documents</h3><p className="text-xs text-muted">{ops.find((operation) => operation.id === workspace.executionId)?.planId ?? 'No linked plan'}</p><Button className="mt-2" size="sm" onClick={() => go('project', { id: project.id, tab: 'plans' })}>Open planning documents</Button></section>
      <section><h3 className="mb-2 font-semibold">Selected agent outputs</h3>{selected.outputs.length ? selected.outputs.map((reference) => <p key={reference} className="break-all font-mono text-xs">{reference}</p>) : <p className="text-xs text-muted">No output references recorded.</p>}</section>
      <Button size="sm" onClick={() => go('operation', { id: workspace.executionId })}>Run timeline & results</Button>
      <p className="text-xs text-muted">Host executors and C2 sessions remain separate resources. This panel lists AI agent invocations.</p>
    </div>}
  </> : null
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex min-w-0 flex-wrap items-center gap-2"><Select aria-label="Execution selection" className="max-w-full sm:max-w-80" value={workspace?.executionId ?? ''} onChange={(event) => { const next = workspaces.find((row) => row.executionId === event.target.value); if (next) select(next.instances.find((instance) => instance.role === 'Orchestrator')!.id, next.executionId) }}>{workspaces.map((row) => <option key={row.executionId} value={row.executionId}>{ops.find((operation) => operation.id === row.executionId)?.name ?? 'Recorded execution'} · {ops.find((operation) => operation.id === row.executionId)?.status ?? 'unknown'}</option>)}</Select><span className="rounded-full border border-line px-2 py-1 text-[10px] uppercase text-muted">Mock · simulated</span></div><div className="flex gap-2"><Button size="sm" icon={History} onClick={() => setSheet('history')}>Execution history</Button><Button size="sm" icon={PanelRight} aria-pressed={wide ? panelOpen : sheet === 'panel'} onClick={() => wide ? setPanelOpen(!panelOpen) : setSheet(sheet === 'panel' ? null : 'panel')}>{wide && panelOpen ? 'Hide panel' : 'Agents / Context'}</Button></div></div>
    {attention.length > 0 && <button className="flex w-full items-center gap-2 rounded-lg border border-warn/40 bg-warn-soft/40 px-3 py-2 text-left text-xs font-medium text-warn" onClick={() => { select(attention[0].instanceId); setPanelTab('agents'); setPanelOpen(true) }}><Hand size={15} />{attention.length} {attention.length === 1 ? 'question needs' : 'questions need'} your input · open the waiting agent</button>}
    {error && <Banner tone="bad" title="Execution workspace notice">{error}</Banner>}
    {workspace && selected && root ? <div className="flex h-[calc(100dvh-340px)] min-h-[420px] min-w-0 overflow-hidden rounded-xl border border-line bg-panel sm:h-[calc(100dvh-300px)] sm:min-h-[560px]">
      <InstanceConversation workspace={workspace} instance={selected} writable={writable} outcome={outcome} onOutcome={setOutcome} onRoot={() => select(root.id)} onDraft={(text, questionId) => act(() => saveInstanceDraft(services, ctx, workspace.executionId, selected.id, text, questionId))} onSend={(text, questionId) => act(() => { submitInstanceRequest(services, ctx, workspace.executionId, selected.id, questionId ? 'answer' : 'message', text, outcome, questionId) })} onObserve={(request) => act(() => observeInstanceRequest(services, ctx, workspace.executionId, request.id, outcome === 'queued' ? 'delivered' : outcome))} decisions={selected.id === root.id && aggregate.toolEvents.some((tool) => tool.opId === workspace.executionId && tool.state === 'awaiting') ? <section aria-label="Project tool decisions"><h3 className="text-xs font-semibold">Project tool approval · instance not attributed</h3>{aggregate.toolEvents.filter((tool) => tool.opId === workspace.executionId && tool.state === 'awaiting').map((tool) => <ToolProposalCard key={tool.id} tool={tool} compact />)}</section> : undefined} />
      {wide && panelOpen && <><Separator label="Resize agents panel" side="right" r={sizing} cfg={INSP} /><aside style={{ width: sizing.w }} className="min-w-0 shrink-0 overflow-y-auto border-l border-line" aria-label="Execution agents and context">{panel}</aside></>}
    </div> : <Empty title="No execution workspace yet" action={<Button onClick={() => setSheet('history')}>Prepare an operation</Button>}>Use Planning to prepare the approach and the existing operation/preflight workflow to start. Opening this page never starts a run.</Empty>}
    <Drawer open={sheet === 'panel'} onClose={() => setSheet(null)} title="Agents / Context" width={420}>{panel}</Drawer>
    <Drawer open={sheet === 'history'} onClose={() => setSheet(null)} title="Execution history & operation controls" width={1000}>{history}</Drawer>
  </div>
}
