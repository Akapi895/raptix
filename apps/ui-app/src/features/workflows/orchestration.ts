import cytoscape, { type Core } from 'cytoscape';
import ELK from 'elkjs/lib/elk.bundled.js';
import type { initTasks } from '../tasks';
import { createDom, errorMessage, escapeHtml as esc } from './dom';
import { parseGraph, type Graph, type NodeRun, type WorkflowRun } from './model';
import type { WorkflowsService } from './service';
import { nodeBackground, nodePresentation } from './node-presentation';

type Tasks = ReturnType<typeof initTasks>;
type Tab = 'builder' | 'runs' | 'schedule';
const terminal = (status: string) => ['completed', 'failed', 'cancelled', 'rejected', 'skipped', 'success'].includes(status);
const state = (status: string) => `<span class="workflow-run-state" data-status="${esc(status)}">${esc(status === 'awaiting_hitl' ? 'Awaiting approval' : status.replaceAll('_', ' '))}</span>`;
const date = (value?: string | null) => value ? new Date(value).toLocaleString() : '—';
export function runDuration(start: string, end?: string | null): string {
  const seconds = Math.max(0, Math.floor(((end ? Date.parse(end) : Date.now()) - Date.parse(start)) / 1000));
  return Number.isFinite(seconds) ? seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s` : '—';
}
function pretty(value: string): string { try { return JSON.stringify(JSON.parse(value) as unknown, null, 2); } catch { return value || 'No data recorded.'; } }

/** Workspace composition: definitions stay in the editor; queue state remains owned by Tasks. */
export function createWorkflowOrchestration(deps: {
  doc: Document; service: WorkflowsService; tasks: Tasks; can(permission: string): boolean;
  notify(message: string, type: 'error' | 'success'): void; selectedId(): string; dirty(): boolean;
}) {
  const { doc, service, tasks, can } = deps;
  const dom = createDom(doc, 'orch', error => deps.notify(errorMessage(error), 'error'));
  let tab: Tab = 'builder', selected: WorkflowRun | null = null, nodeRuns: NodeRun[] = [], graph: Graph = parseGraph(null);
  let cy: Core | undefined, timer: ReturnType<typeof setInterval> | undefined, observer: ResizeObserver | undefined;
  let listGeneration = 0, detailGeneration = 0, offset = 0, busy = false, listBusy = false, detailBusy = false, mounted = false, selectedNodeId = '';
  const button = (action: string, label: string, attrs = '') => `<button type="button" class="btn-secondary btn-small" data-orch-click="${action}" ${attrs}>${esc(label)}</button>`;
  const link = (id: string, label = 'Conversation & agent activity') => `<a href="#chat?conversation=${encodeURIComponent(id)}">${esc(label)}</a>`;
  function navigate(next: Tab, extra: Record<string, string> = {}): void {
    const query = new URLSearchParams({ tab: next, ...extra }); doc.defaultView!.location.hash = 'workflows?' + query;
  }
  function embed(id: string, parent: HTMLElement): void {
    const element = dom.el(id); if (!element) return;
    element.classList.remove('modal'); element.classList.add('workflow-inline-panel'); element.dataset.workflowInline = 'true'; element.hidden = true;
    element.removeAttribute('role'); element.removeAttribute('aria-modal'); parent.append(element);
    element.querySelectorAll<HTMLElement>('.modal-close').forEach(close => {
      const replacement = doc.createElement('button'); replacement.type = 'button'; replacement.className = 'btn-secondary btn-small'; replacement.textContent = 'Close';
      for (const attr of close.attributes) if (attr.name.startsWith('data-')) replacement.setAttribute(attr.name, attr.value);
      close.replaceWith(replacement);
    });
  }
  function init(): void {
    if (mounted || dom.disposed || !dom.el('workflow-runs') || !dom.el('workflow-schedule')) return; mounted = true;
    dom.html('workflow-runs', `<div class="workflow-operation-toolbar"><div><h3>Execution history</h3><p>Persisted graph runs, including runs started from Chat and scheduled queues.</p></div><div class="workflow-operation-actions">${button('refreshRuns', 'Refresh')}${can('tasks:write') && can('workflow:execute') ? button('newRun', 'Run workflow') : ''}</div></div><div class="workflow-run-filters"><label>Workflow<select id="workflow-runs-definition" data-orch-change="filterRuns"><option value="">All workflows</option></select></label><label>State<select id="workflow-runs-status" data-orch-change="filterRuns"><option value="">All states</option>${['running', 'awaiting_hitl', 'completed', 'failed', 'cancelled', 'rejected'].map(s => `<option value="${s}">${s.replaceAll('_', ' ')}</option>`).join('')}</select></label></div><div id="workflow-runs-list" aria-live="polite"></div><div class="workflow-run-pagination">${button('previousRuns', 'Previous', 'id="workflow-runs-prev" disabled')}<span id="workflow-runs-page"></span>${button('nextRuns', 'Next', 'id="workflow-runs-next" disabled')}</div><section id="workflow-run-detail" hidden aria-label="Selected execution"><div id="workflow-run-summary"></div><div id="workflow-run-approval"></div><div class="workflow-run-workspace"><div class="workflow-run-graph-region"><div class="workflow-run-graph-tools"><span>Execution graph · read only</span>${button('fitRun', 'Fit graph')}</div><div id="workflow-run-graph" role="img" aria-label="Execution graph. Inspect nodes using the node list."></div><p id="workflow-run-graph-note"></p></div><aside class="workflow-run-inspector"><h4>Node execution</h4><div id="workflow-run-nodes"></div><div id="workflow-run-node-detail"></div></aside></div><details class="workflow-run-data"><summary>Run inputs and outputs</summary><h4>Inputs</h4><pre id="workflow-run-input"></pre><h4>Outputs</h4><pre id="workflow-run-output"></pre></details><div class="workflow-run-activity"><h4>Execution log</h4><p>Node events below are retained with this run. Conversation activity includes tool calls and agent messages.</p><div id="workflow-run-events"></div>${button('loadActivity', 'Load conversation activity')}<pre id="workflow-run-activity-output" hidden></pre></div></section>`);
    const schedule = dom.el('workflow-schedule')!;
    const source = doc.createElement('label'); source.className = 'workflow-run-source'; source.innerHTML = `Execution history <select id="workflow-runs-source" data-orch-change="sourceRuns">${can('workflow:read') ? '<option value="graph">Graph runs</option>' : ''}${can('tasks:read') ? '<option value="batch">Batch task executions</option>' : ''}</select>`;
    dom.el('workflow-runs')!.prepend(source);
    const batchDetail = doc.createElement('section'); batchDetail.id = 'workflow-batch-run-detail'; batchDetail.hidden = true; dom.el('workflow-runs')!.append(batchDetail);
    const header = doc.createElement('div'); header.className = 'workflow-operation-toolbar'; header.innerHTML = `<div><h3>Schedules & queues</h3><p>All workflow schedules and independent batch queues. Cron uses the server timezone; paused queues are not triggered.</p></div>`; schedule.append(header);
    const oldPage = dom.el('page-tasks'); const actions = oldPage?.querySelector('.page-header-actions'); if (actions) header.append(actions);
    const content = oldPage?.querySelector('.page-content'); if (content) schedule.append(content);
    embed('batch-import-modal', schedule); embed('batch-queue-detail-modal', schedule); embed('add-batch-task-modal', schedule);
    dom.action('tab', node => navigate(node.dataset.tab as Tab));
    dom.action('refreshRuns', () => refreshRuns()); dom.action('filterRuns', () => { offset = 0; return refreshRuns(); });
    dom.action('sourceRuns', () => { offset = 0; selected = null; detailGeneration++; dom.el('workflow-run-detail')!.hidden = true; dom.el('workflow-batch-run-detail')!.hidden = true; return refreshRuns(); });
    dom.action('batchRun', async node => {
      const result = await tasks.service.runs(offset), run = result.runs.find(r => r.conversationId === node.dataset.id); if (!run) return;
      dom.el('workflow-batch-run-detail')!.hidden = false;
      dom.html('workflow-batch-run-detail', `<div class="workflow-operation-toolbar"><div><h3>${esc(run.title || run.queueId)}</h3><p>${state(run.status)} · ${esc(date(run.startedAt))} · ${run.startedAt ? runDuration(run.startedAt, run.completedAt) : '—'}</p>${can('chat:read') ? link(run.conversationId) : ''}</div>${button('openQueue', 'Open queue & rerun', `data-id="${esc(run.queueId)}"`)}</div><h4>Input</h4><pre>${esc(run.message)}</pre>${run.error ? `<p class="workflow-operation-error">${esc(run.error)}</p>` : ''}<h4>Output</h4><pre>${esc(run.result || 'No output recorded yet.')}</pre>`);
      dom.el('workflow-batch-run-detail')!.scrollIntoView({ block: 'start' });
    });
    dom.action('openQueue', node => navigate('schedule', { queue: node.dataset.id ?? '' }));
    dom.action('previousRuns', () => { offset = Math.max(0, offset - 50); return refreshRuns(); });
    dom.action('nextRuns', () => { offset += 50; return refreshRuns(); });
    dom.action('selectRun', node => navigate('runs', { run: node.dataset.id ?? '' }));
    dom.action('closeRun', () => { selected = null; detailGeneration++; cy?.destroy(); cy = undefined; dom.el('workflow-run-detail')!.hidden = true; navigate('runs'); });
    dom.action('inspectNode', node => inspectNode(node.dataset.id ?? ''));
    dom.action('fitRun', () => cy?.fit(undefined, 32));
    dom.action('newRun', () => newRun()); dom.action('rerun', () => rerun());
    dom.action('approveRun', () => decide(true)); dom.action('rejectRun', () => decide(false));
    dom.action('loadActivity', async () => {
      const run = selected; if (!run?.conversation_id || !can('chat:read')) return;
      const output = dom.el('workflow-run-activity-output')!; output.hidden = false; output.textContent = 'Loading conversation activity…';
      try { const activity = await service.activity(run.conversation_id); if (selected?.id === run.id) output.textContent = activity.length ? JSON.stringify(activity, null, 2) : 'No conversation activity recorded.'; }
      catch (error) { if (selected?.id === run.id) output.textContent = `Could not load activity: ${errorMessage(error)}. Try Load conversation activity again.`; }
    });
    dom.mount(); const win = doc.defaultView; if (win) dom.on(win, 'hashchange', () => { void sync().catch(error => deps.notify(errorMessage(error), 'error')); });
    observer = new ResizeObserver(() => { cy?.resize(); }); observer.observe(dom.el('workflow-run-graph')!);
    timer = setInterval(() => {
      if (!dom.el('page-workflows')?.classList.contains('active') || doc.hidden || tab !== 'runs' || busy) return;
      if (!listBusy) void refreshRuns();
      if (selected && !terminal(selected.status) && !detailBusy) void loadRun(selected.id, true).catch(() => { /* Keep last known state; explicit Refresh retries. */ });
    }, 4000);
  }
  async function newRun(): Promise<void> {
    if (!can('tasks:write') || !can('workflow:execute')) return;
    if (deps.dirty()) { deps.notify('Save the workflow in Builder before executing it.', 'error'); return; }
    const id = deps.selectedId(); if (!id) { deps.notify('Choose and save a workflow in Builder first.', 'error'); return; }
    navigate('schedule'); await tasks.hooks.showBatchImportModal();
    tasks.view.dom.setValue('batch-queue-workflow', id); tasks.view.dom.setChecked('batch-queue-execute-now', true);
    tasks.view.dom.setValue('batch-queue-title', service.workflows.find(w => w.id === id)?.name ?? id);
    const field = tasks.view.dom.field('batch-queue-workflow'); if (field) { tasks.view.dom.syncSelect(field as HTMLSelectElement); }
  }
  async function rerun(): Promise<void> {
    const run = selected; if (!run || busy || !can('tasks:write') || !can('workflow:execute')) return;
    busy = true;
    try {
      const input = JSON.parse(run.input_json) as { message?: unknown; hitlPolicy?: string };
      if (typeof input.message !== 'string' || !input.message.trim()) throw new Error('This run has no reusable message input. Create a new queue with explicit inputs.');
      const id = await tasks.service.create({ workflowId: run.workflow_id, title: `Rerun · ${run.workflow_id}`, role: run.role_id, projectId: run.project_id, hitlPolicy: input.hitlPolicy ?? '', concurrency: 1, scheduleMode: 'manual', cronExpr: '', executeNow: true, tasks: [input.message] });
      navigate('schedule', { queue: id }); await tasks.hooks.showBatchQueueDetail(id);
      deps.notify('Rerun queued using the current saved workflow and the original approval policy.', 'success');
    } finally { busy = false; }
  }
  async function decide(approved: boolean): Promise<void> {
    if (!selected || busy || !can('workflow:execute') || selected.status !== 'awaiting_hitl') return;
    busy = true; dom.el('workflow-run-approval')?.setAttribute('aria-busy', 'true');
    try { const id = selected.id; await service.resumeRun(id, approved, dom.value('workflow-run-comment')); await loadRun(id); await refreshRuns(); }
    finally { busy = false; dom.el('workflow-run-approval')?.removeAttribute('aria-busy'); }
  }
  async function refreshRuns(): Promise<void> {
    if (tab !== 'runs' || dom.disposed) return;
    const generation = ++listGeneration; listBusy = true;
    try {
      const batch = dom.value('workflow-runs-source') === 'batch';
      const filters = dom.el('workflow-runs')?.querySelector<HTMLElement>('.workflow-run-filters'); if (filters) filters.hidden = batch;
      if (batch) {
        if (!can('tasks:read')) return;
        const result = await tasks.service.runs(offset); if (generation !== listGeneration || dom.disposed) return;
        dom.html('workflow-runs-list', result.runs.length ? `<div class="workflow-table-scroll"><table class="workflow-table"><thead><tr><th scope="col">Task / queue</th><th scope="col">State</th><th scope="col">Started</th><th scope="col">Duration</th></tr></thead><tbody>${result.runs.map(r => `<tr><td><button type="button" class="workflow-text-button" data-orch-click="batchRun" data-id="${esc(r.conversationId)}">${esc(r.message)}</button><small>${esc(r.title || r.queueId)} · ${esc(r.workflowId ? 'Workflow · ' + r.workflowId : 'Independent batch')}</small></td><td>${state(r.status)}</td><td>${esc(date(r.startedAt))}</td><td>${r.startedAt ? runDuration(r.startedAt, r.completedAt) : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="workflow-operation-empty"><h3>No batch executions yet</h3><p>Start a queue in Schedule. Each input gets an independent execution record; reruns retain previous results.</p></div>');
        dom.disable('workflow-runs-prev', offset === 0); dom.disable('workflow-runs-next', !result.hasMore); dom.text('workflow-runs-page', `Page ${offset / 50 + 1}`); return;
      }
      if (!can('workflow:read')) return;
      const result = await service.listRuns(dom.value('workflow-runs-definition'), dom.value('workflow-runs-status'), offset);
      if (generation !== listGeneration || dom.disposed) return;
      dom.html('workflow-runs-list', result.runs.length ? `<div class="workflow-table-scroll"><table class="workflow-table"><thead><tr><th scope="col">Run / workflow</th><th scope="col">State</th><th scope="col">Started</th><th scope="col">Duration</th><th scope="col">Version</th></tr></thead><tbody>${result.runs.map(run => `<tr ${selected?.id === run.id ? 'aria-selected="true"' : ''}><td><button type="button" class="workflow-text-button" data-orch-click="selectRun" data-id="${esc(run.id)}">${esc(run.id)}</button><small>${esc(service.workflows.find(w => w.id === run.workflow_id)?.name ?? run.workflow_id)}</small></td><td>${state(run.status)}${run.error ? `<small class="workflow-operation-error">${esc(run.error)}</small>` : ''}</td><td>${esc(date(run.started_at))}</td><td>${runDuration(run.started_at, run.finished_at)}</td><td>v${run.workflow_version}</td></tr>`).join('')}</tbody></table></div>` : '<div class="workflow-operation-empty"><h3>No runs found</h3><p>Execute a saved workflow or start a workflow-bound queue in Schedule. Change the filters to see other executions.</p></div>');
      dom.disable('workflow-runs-prev', offset === 0); dom.disable('workflow-runs-next', !result.hasMore); dom.text('workflow-runs-page', `Page ${offset / 50 + 1}`);
    } catch (error) {
      if (generation === listGeneration) dom.html('workflow-runs-list', `<div class="workflow-operation-empty" role="alert"><h3>Execution history could not load</h3><p>${esc(errorMessage(error))}</p>${button('refreshRuns', 'Retry')}</div>`);
    } finally { if (generation === listGeneration) listBusy = false; }
  }
  async function loadRun(id: string, polling = false): Promise<void> {
    if (!can('workflow:read') || !id) return;
    const generation = ++detailGeneration; detailBusy = true;
    try {
      const result = await service.getRun(id); if (generation !== detailGeneration || dom.disposed || tab !== 'runs') return;
      const same = selected?.id === id, previousStatus = selected?.status; selected = result.run; nodeRuns = result.nodeRuns;
      const definition = service.workflows.find(w => w.id === selected!.workflow_id);
      graph = parseGraph(selected.graph_json || (definition?.version === selected.workflow_version ? definition.graph_json ?? definition.graph : null));
      dom.el('workflow-run-detail')!.hidden = false;
      dom.html('workflow-run-summary', `<div><h3>${esc(definition?.name ?? selected.workflow_id)}</h3><p><code>${esc(id)}</code> · v${selected.workflow_version} · ${runDuration(selected.started_at, selected.finished_at)} · ${state(selected.status)}</p><p>${nodeRuns.filter(n => terminal(n.status)).length} / ${graph.nodes.length || '?'} node attempts finished${selected.conversation_id && can('chat:read') ? ' · ' + link(selected.conversation_id) : ''}</p>${selected.error ? `<p class="workflow-operation-error" role="alert">${esc(selected.error)} · Inspect the failed node and conversation before rerunning.</p>` : ''}</div><div class="workflow-operation-actions">${can('tasks:write') && can('workflow:execute') && terminal(selected.status) ? button('rerun', 'Rerun current definition') : ''}${button('closeRun', 'Close run')}</div>`);
      // Preserve in-progress review text across polling.
      const comment = same ? dom.value('workflow-run-comment') : '';
      if (!same || previousStatus !== selected.status) dom.html('workflow-run-approval', selected.status === 'await_hitl' || selected.status === 'awaiting_hitl' ? `<div class="workflow-approval-inline"><h4>Approval required · ${esc(selected.pending_hitl_node_id)}</h4><pre>${esc(pretty(selected.pending_hitl_json))}</pre>${can('workflow:execute') ? `<label for="workflow-run-comment">Review comment</label><textarea id="workflow-run-comment" rows="2">${esc(comment)}</textarea><div class="workflow-operation-actions">${button('approveRun', 'Approve & continue')}${button('rejectRun', 'Reject run')}</div>` : '<p>A workflow executor must approve or reject this run.</p>'}</div>` : '');
      dom.text('workflow-run-input', pretty(selected.input_json)); dom.text('workflow-run-output', pretty(selected.output_json));
      dom.html('workflow-run-nodes', graph.nodes.length ? graph.nodes.map(node => { const run = [...nodeRuns].reverse().find(n => n.node_id === node.id); const status = selected?.pending_hitl_node_id === node.id && selected.status === 'awaiting_hitl' ? 'awaiting_hitl' : run?.status ?? 'not_executed'; return `<button type="button" data-orch-click="inspectNode" data-id="${esc(node.id)}"><span>${esc(node.label || node.id)}</span>${state(status)}</button>`; }).join('') : nodeRuns.map(n => `<button type="button" data-orch-click="inspectNode" data-id="${esc(n.node_id)}">${esc(n.node_id)} ${state(n.status)}</button>`).join(''));
      dom.html('workflow-run-events', nodeRuns.map(n => `<div class="workflow-run-event"><time>${esc(date(n.started_at))}</time><button type="button" class="workflow-text-button" data-orch-click="inspectNode" data-id="${esc(n.node_id)}">${esc(n.node_id)}</button>${state(n.status)}<span>${runDuration(n.started_at, n.finished_at)}</span>${n.error ? `<p class="workflow-operation-error">${esc(n.error)}</p>` : ''}</div>`).join('') || '<p>No node events recorded yet.</p>');
      if (!same) { selectedNodeId = ''; dom.html('workflow-run-node-detail', '<p>Select a node to inspect its inputs, outputs, errors, and attempts.</p>'); dom.el('workflow-run-activity-output')!.hidden = true; }
      else if (selectedNodeId) inspectNode(selectedNodeId);
      if (!same || !cy) await renderGraph(); else updateGraph();
      if (!polling && !same) dom.el('workflow-run-detail')?.scrollIntoView({ block: 'start' });
    } finally { if (generation === detailGeneration) detailBusy = false; }
  }
  function updateGraph(): void {
    cy?.nodes().forEach(node => {
      const run = [...nodeRuns].reverse().find(n => n.node_id === node.id());
      const status = selected?.status === 'awaiting_hitl' && selected.pending_hitl_node_id === node.id() ? 'awaiting_hitl' : run?.status ?? 'not_executed';
      node.data('executionStatus', status); node.data('displayLabel', `${String(node.data('name'))}\n${status.replaceAll('_', ' ')}`);
    });
  }
  async function renderGraph(): Promise<void> {
    cy?.destroy(); cy = undefined;
    dom.text('workflow-run-graph-note', graph.nodes.length ? 'Node state is shown by label and color. Pan or zoom to explore.' : 'The historical graph is unavailable for this older run. Node records remain inspectable.');
    if (!graph.nodes.length) return;
    const id = selected?.id;
    const layout = await new ELK().layout({ id: 'run', layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.spacing.nodeNode': '32', 'elk.layered.spacing.nodeNodeBetweenLayers': '64' }, children: graph.nodes.map(n => ({ id: n.id, width: 204, height: 80 })), edges: graph.edges.map((e, i) => ({ id: e.id || `edge-${i}`, sources: [e.source], targets: [e.target] })) });
    if (selected?.id !== id || dom.disposed || tab !== 'runs') return;
    cy = cytoscape({ container: dom.el('workflow-run-graph')!, autoungrabify: true, minZoom: .15, maxZoom: 2, layout: { name: 'preset' }, elements: [
      ...graph.nodes.map(n => { const position = layout.children?.find(c => c.id === n.id); return { data: { id: n.id, name: n.label || n.id, type: n.type }, position: { x: position?.x ?? 0, y: position?.y ?? 0 } }; }),
      ...graph.edges.map((e, i) => ({ data: { id: e.id || `edge-${i}`, source: e.source, target: e.target, label: e.label } })),
    ], style: [
      { selector: 'node', style: { shape: 'round-rectangle', width: 204, height: 80, 'background-color': '#fff', 'background-image': node => nodeBackground(String(node.data('type')), String(node.data('type'))), 'background-width': '100%', 'background-height': '100%', 'border-width': 2, 'border-color': node => nodePresentation[String(node.data('type'))]?.color ?? '#6b7280', label: 'data(displayLabel)', 'text-wrap': 'wrap', 'text-max-width': '180px', 'text-valign': 'center', 'text-margin-y': 14, 'font-size': 12, color: '#253248' } },
      { selector: 'edge', style: { 'curve-style': 'taxi', 'taxi-direction': 'rightward', 'target-arrow-shape': 'triangle', 'line-color': '#99a4b3', 'target-arrow-color': '#99a4b3', width: 1.6, label: 'data(label)', 'font-size': 11 } },
      { selector: 'node[executionStatus="completed"], node[executionStatus="success"]', style: { 'border-color': '#23704d' } },
      { selector: 'node[executionStatus="failed"], node[executionStatus="rejected"]', style: { 'border-color': '#b33131', 'border-style': 'double', 'border-width': 4 } },
      { selector: 'node[executionStatus="running"]', style: { 'border-color': '#265eb6', 'border-width': 3 } },
      { selector: 'node[executionStatus="awaiting_hitl"]', style: { 'border-color': '#946100', 'border-style': 'dashed', 'border-width': 3 } },
      { selector: 'node[executionStatus="not_executed"], node[executionStatus="skipped"]', style: { opacity: .6 } },
    ] }); updateGraph(); cy.fit(undefined, 32);
    cy.on('tap', 'node', event => inspectNode((event.target as { id(): string }).id()));
  }
  function inspectNode(id: string): void {
    selectedNodeId = id;
    const attempts = nodeRuns.filter(n => n.node_id === id), node = graph.nodes.find(n => n.id === id);
    dom.html('workflow-run-node-detail', `<h4>${esc(node?.label || id)}</h4>${attempts.length ? attempts.map((run, i) => `<section><h5>Attempt ${i + 1} · ${state(run.status)}</h5><p>${esc(date(run.started_at))} · ${runDuration(run.started_at, run.finished_at)}</p>${run.error ? `<p class="workflow-operation-error">${esc(run.error)}</p>` : ''}<h5>Inputs</h5><pre>${esc(pretty(run.input_json))}</pre><h5>Outputs</h5><pre>${esc(pretty(run.output_json))}</pre></section>`).join('') : '<p>This node has not executed. It may be waiting on an upstream node or belong to an unselected branch.</p>'}`);
    cy?.nodes().unselect(); cy?.getElementById(id).select();
  }
  async function sync(): Promise<void> {
    init(); if (!mounted) return;
    const hash = doc.defaultView?.location.hash ?? ''; const query = new URLSearchParams(hash.split('?')[1] ?? '');
    if (!/^#\/?workflows(?:\?|$)/.test(hash)) { tasks.hooks.cleanupTasksPage(); return; }
    const requested = query.get('tab'); const next: Tab = requested === 'schedule' || requested === 'runs' ? requested : can('workflow:read') ? 'builder' : 'schedule';
    if (next === 'schedule' && !can('tasks:read') || next === 'builder' && !can('workflow:read') || next === 'runs' && !can('workflow:read') && !can('tasks:read')) return;
    const changed = next !== tab; tab = next;
    for (const name of ['builder', 'runs', 'schedule']) { const panel = dom.el('workflow-' + name); if (panel) panel.hidden = name !== tab; }
    dom.el('page-workflows')!.dataset.workflowTab = tab;
    doc.querySelectorAll<HTMLElement>('[data-orch-click="tab"]').forEach(button => { if (button.dataset.tab === tab) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
    if (changed) tasks.hooks.cleanupTasksPage();
    if (tab === 'schedule') { if (changed || !tasks.service.queues.length) tasks.hooks.initTasksPage(); const queue = query.get('queue'); if (queue && tasks.service.currentQueue?.id !== queue) await tasks.hooks.showBatchQueueDetail(queue); }
    if (tab === 'runs') {
      const filter = dom.field('workflow-runs-definition'); if (filter instanceof HTMLSelectElement) { const value = filter.value; filter.innerHTML = '<option value="">All workflows</option>' + service.workflows.map(w => `<option value="${esc(w.id)}">${esc(w.name)}</option>`).join(''); filter.value = value; }
      await refreshRuns(); const id = query.get('run'); if (id) await loadRun(id);
      else if (selected) { selected = null; detailGeneration++; dom.el('workflow-run-detail')!.hidden = true; }
    }
  }
  return { sync, navigate, mount: init, dispose(): void { clearInterval(timer); observer?.disconnect(); cy?.destroy(); listGeneration++; detailGeneration++; tasks.hooks.cleanupTasksPage(); dom.dispose(); } };
}
