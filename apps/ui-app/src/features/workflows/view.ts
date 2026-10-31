import { createDom, escapeHtml as esc } from './dom';
import { validateGraph, validateGraphIssues, type AiResult, type DryRunResult, type Graph, type Translate, type Workflow, type WorkflowMeta } from './model';

export function createWorkflowsView(doc: Document, t: Translate, report: (error: unknown) => void, applyPermissions?: (root: HTMLElement) => void) {
  const dom = createDom(doc, 'wf', report, { applyPermissions, permissions: { toggleEnabled: 'workflow:write', editMeta: 'workflow:write', removeCustom: 'workflow:write', conditionExample: 'workflow:write', packageResolution: 'workflow:write', packageRisk: 'workflow:write', packageRename: 'workflow:write' } });
  function readMeta(): WorkflowMeta { return { id: dom.value('workflow-id').trim(), name: dom.value('workflow-name').trim(), description: dom.value('workflow-description').trim(), enabled: dom.checked('workflow-enabled') }; }
  function lockId(locked: boolean, id: string): void {
    dom.setValue('workflow-id', id); const input = dom.field('workflow-id'); if (input) { input.hidden = locked; input.disabled = locked; }
    const display = dom.el('workflow-id-locked'); if (display) display.hidden = !locked;
    dom.text('workflow-id-display', locked ? id : ''); const hint = doc.querySelector<HTMLElement>('.workflow-meta-id-hint'); if (hint) hint.hidden = locked;
    dom.el('workflow-meta-id-group')?.classList.toggle('is-locked', locked);
  }
  function setMeta(meta: WorkflowMeta, locked = !!meta.id): void { lockId(locked, meta.id); dom.setValue('workflow-name', meta.name); dom.setValue('workflow-description', meta.description); dom.setChecked('workflow-enabled', meta.enabled); }
  function status(wf: Workflow, currentId: string, graph: Graph): string { return wf.id === currentId ? validateGraph(graph, t).join('; ') : wf.validation_error; }
  function title(workflows: readonly Workflow[], currentId: string, graph: Graph): void {
    const meta = readMeta(), wf = workflows.find(item => item.id === currentId);
    dom.text('workflow-canvas-title', meta.name || meta.id || t('workflows.untitled'));
    const title = dom.el('workflow-canvas-title'); title?.classList.toggle('is-disabled', !meta.enabled); if (title) title.title = meta.description;
    const parts = [wf ? 'v' + wf.version : 'Draft', t(meta.enabled ? 'workflows.statusEnabled' : 'workflows.statusDisabled')].filter(Boolean);
    dom.text('workflow-canvas-subtitle', parts.join(' · ')); const subtitle = dom.el('workflow-canvas-subtitle'); if (subtitle) subtitle.hidden = !parts.length;
    const issues = validateGraphIssues(graph, t);
    dom.text('workflow-validation-button', issues.length ? `Definition: ${issues.length} ${issues.length === 1 ? 'issue' : 'issues'}` : 'Definition valid');
    dom.el('workflow-validation-button')?.classList.toggle('has-errors', issues.length > 0);
    dom.text('workflow-graph-count', `${graph.nodes.length} nodes · ${graph.edges.length} connections`);
    dom.html('workflow-validation-errors', issues.length ? issues.map((issue, index) => `<button type="button" class="workflow-issue" ${dom.attr('focusIssue')} data-index="${index}"><span>${esc(issue.message)}</span><small>${issue.addType ? `Add ${esc(issue.addType)} node` : 'Locate on canvas and edit'} →</small></button>`).join('') : '<p class="workflow-menu-empty">All definition checks passed. Dry run this workflow to inspect its execution path.</p>');
    navigator(graph);
  }
  function list(workflows: readonly Workflow[], currentId: string, graph: Graph): void {
    const query = dom.value('workflow-search').trim().toLowerCase();
    const filtered = workflows.filter(wf => `${wf.name} ${wf.id} ${wf.description}`.toLowerCase().includes(query));
    dom.html('workflow-list', filtered.length ? filtered.map(wf => {
      const invalid = status(wf, currentId, graph), enabled = wf.enabled, toggleTitle = invalid || t('workflows.toggleEnabled');
      return `<div class="workflow-list-item ${wf.id === currentId ? 'is-active' : ''}"><button type="button" class="workflow-list-main" ${dom.attr('select')} data-id="${esc(wf.id)}" ${wf.id === currentId ? 'aria-current="true"' : ''} title="${esc(wf.description)}"><span class="workflow-list-title">${esc(wf.name || wf.id)}</span><span class="workflow-list-meta">${esc(wf.id)} · v${wf.version}${invalid ? ' · Needs attention' : ''}</span></button><div class="workflow-list-actions"><button type="button" class="workflow-status-toggle ${enabled ? 'is-enabled' : 'is-disabled'}" title="${esc(toggleTitle)}" aria-label="${esc(t('workflows.toggleEnabled'))}: ${esc(wf.name)}" aria-pressed="${enabled}" ${dom.attr('toggleEnabled')} data-id="${esc(wf.id)}" data-enabled="${!enabled}"><span class="workflow-status-dot" aria-hidden="true"></span><span>${esc(t(enabled ? 'workflows.statusEnabled' : 'workflows.statusDisabled'))}</span></button><button type="button" class="btn-icon workflow-list-edit" title="${esc(t('workflows.editMeta'))}" aria-label="${esc(t('workflows.editMeta'))}" ${dom.attr('editMeta')} data-id="${esc(wf.id)}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button></div></div>`;
    }).join('') : `<div class="workflow-menu-empty">${esc(query ? 'No matching workflows. Try another search.' : t('workflows.emptyList'))}</div>`);
  }
  function navigator(graph: Graph): void {
    const query = dom.value('workflow-navigator-search').trim().toLowerCase();
    const nodes = graph.nodes.filter(node => `${node.label} ${node.id} ${node.type}`.toLowerCase().includes(query));
    dom.html('workflow-navigator-list', nodes.length ? nodes.map(node => `<button type="button" class="workflow-navigator-item" ${dom.attr('focusNode')} data-id="${esc(node.id)}"><span>${esc(node.label || node.id)}</span><small>${esc(t('workflows.nodes.' + (node.type === 'approval' ? 'hitl' : node.type)))} · ${esc(node.id)}</small></button>`).join('') : '<p class="workflow-menu-empty">No matching nodes.</p>');
  }
  function roleOptions(workflows: readonly Workflow[], selectedId?: string): void {
    const select = dom.field('role-workflow-id'); if (!(select instanceof HTMLSelectElement)) return;
    const current = selectedId ?? select.value;
    select.innerHTML = `<option value="">${esc(t('roleModal.noWorkflowBind'))}</option>` + workflows.map(wf => `<option value="${esc(wf.id)}">${esc(wf.name || wf.id)}${wf.enabled ? '' : esc(t('roleModal.workflowDisabledSuffix'))}</option>`).join('');
    if (current && !workflows.some(wf => wf.id === current)) { const option = doc.createElement('option'); option.value = current; option.textContent = `${current} (${t('roleModal.workflowMissing')})`; select.append(option); }
    select.value = current;
  }
  function closeTrace(): void { const panel = dom.el('workflow-dry-run-panel'); if (panel) panel.hidden = true; dom.html('workflow-dry-run-output', ''); }
  function trace(result: DryRunResult): void {
    const panel = dom.el('workflow-dry-run-panel'); if (panel) panel.hidden = false;
    dom.html('workflow-dry-run-output', '<p class="workflow-config-hint">Execution preview · Dry run completed</p>' + (result.trace.length ? result.trace.map((item, i) => `<div class="workflow-dry-run-step"><strong>${i + 1}. ${esc(item.label || item.nodeId || '#' + (i + 1))}</strong><span>${esc(item.type)} · ${esc(item.status)}</span></div>`).join('') : esc(t('workflows.dryRunNoTrace'))));
  }
  function progress(step = '', done = false): void {
    const wrap = dom.el('workflow-ai-progress'); if (wrap) wrap.hidden = !step && !done;
    const steps = ['understand', 'match', 'draft', 'audit'], active = steps.indexOf(step);
    dom.html('workflow-ai-progress', step || done ? steps.map((key, i) => { const complete = done || active > i; return `<span class="${complete ? 'is-complete' : ''} ${step === key ? 'is-active' : ''}"><b>${complete ? '✓' : i + 1}</b><small>${esc(t('workflows.ai.steps.' + key))}</small></span>`; }).join('') : '');
  }
  function aiResult(result: AiResult | null): void {
    if (!result) { dom.html('workflow-ai-result', ''); dom.disable('workflow-ai-apply-btn', true); return; }
    const graph = result.graph, errors = validateGraph(graph, t), risks = result.audit.risk_warnings.length ? result.audit.risk_warnings : result.riskWarnings, assumptions = result.audit.assumptions.length ? result.audit.assumptions : result.assumptions;
    const generatorKey = result.generator === 'llm' ? 'generatorLLM' : result.generator === 'deterministic' ? 'generatorServer' : result.generator.includes('fallback') ? 'generatorFallback' : 'generatorUnknown';
    const nodes = [...graph.nodes].sort((a, b) => (a.position?.x ?? 0) - (b.position?.x ?? 0) || (a.position?.y ?? 0) - (b.position?.y ?? 0)).slice(0, 9);
    const section = (key: string, values: string[], classes = '') => values.length ? `<div class="workflow-ai-result-section ${classes}"><strong>${esc(t(key))}</strong><ul>${values.map(value => `<li>${esc(value)}</li>`).join('')}</ul></div>` : '';
    dom.html('workflow-ai-result', `<div class="workflow-ai-preview" aria-label="${esc(t('workflows.ai.preview'))}"><div class="workflow-ai-preview-title">${esc(t('workflows.ai.preview'))}</div><div class="workflow-ai-preview-flow">${nodes.map((node, i) => `<span class="workflow-ai-preview-node is-${esc(node.type)} ${node.config.risk_level === 'high' || node.config.requires_human_confirmation === 'true' ? 'is-risky' : ''}"><small>${esc(t('workflows.nodes.' + node.type))}</small><strong>${esc(node.label || t('workflows.nodes.' + node.type))}</strong></span>${i < nodes.length - 1 ? '<i aria-hidden="true">→</i>' : ''}`).join('')}</div></div><div class="workflow-ai-result-grid">${[['resultNodes', result.stats.nodes ?? graph.nodes.length], ['resultEdges', result.stats.edges ?? graph.edges.length], ['resultRisk', t(risks.length ? 'workflows.ai.riskHigh' : 'workflows.ai.riskLow')], ['resultSaveState', t(errors.length ? 'workflows.ai.no' : 'workflows.ai.yes')]].map(([key, value]) => `<span>${esc(t('workflows.ai.' + key))}<strong>${esc(value)}</strong></span>`).join('')}</div><div class="workflow-ai-result-section"><strong>${esc(t('workflows.ai.' + generatorKey))}</strong><p>${esc(t('workflows.ai.' + (result.generator === 'llm' ? 'llmTitle' : result.generator === 'deterministic' ? 'serverTitle' : 'fallbackTitle')))}</p></div>${section('workflows.ai.capabilityTrace', result.capabilities.map(cap => cap.label + (cap.tool_name || cap.toolName ? ' -> ' + (cap.tool_name || cap.toolName) : '')))}${section('workflows.ai.missingFields', result.audit.missing_fields, 'is-attention')}${section('workflows.ai.assumptions', assumptions)}${section('workflows.ai.riskWarnings', risks, 'is-warning')}${section('workflows.audit.validationIssues', errors, 'is-warning')}`);
    dom.disable('workflow-ai-apply-btn', errors.length > 0);
  }
  return { dom, readMeta, setMeta, lockId, title, list, navigator, roleOptions, closeTrace, trace, progress, aiResult };
}
export type WorkflowsView = ReturnType<typeof createWorkflowsView>;
