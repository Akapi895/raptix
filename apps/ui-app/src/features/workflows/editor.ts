import cytoscape, { type CollectionArgument, type CollectionReturnValue, type Core, type EdgeSingular, type NodeSingular, type Position } from 'cytoscape';
import ELK from 'elkjs/lib/elk.bundled.js';
import { binding, configSchema, defaultConfig, emptyGraph, nodeTypes, text, type Config, type Graph, type Translate } from './model';
import { escapeHtml as esc, type Dom } from './dom';
import { nodeBackground, nodePresentation } from './node-presentation';

const knownLabels: Record<string, string[]> = { start: ['\u5f00\u59cb', 'Start'], tool: ['\u5de5\u5177', 'Tool'], agent: ['Agent'], condition: ['\u6761\u4ef6', 'Condition'], hitl: ['\u5ba1\u6279', 'Approval'], output: ['\u8f93\u51fa', 'Output'], end: ['\u7ed3\u675f', 'End'] };
export function createWorkflowEditor(dom: Dom, t: Translate, notify: (message: string, type: 'warning' | 'info') => void, changed: (edited?: boolean) => void, getTools: () => { key: string; enabled: boolean }[], can: (permission: string) => boolean) {
  let cy: Core | null = null, selected: CollectionReturnValue | null = null, connectMode = false, sourceId = '', nodeSeq = 1, edgeSeq = 1;
  let graphConfig: Config = {}, observer: ResizeObserver | undefined, layoutGeneration = 0, loading = false, fitOnResize = true;
  const timeouts = new Set<ReturnType<typeof setTimeout>>();
  const objectArguments = new Set<string>();
  const deletions: { elements: CollectionReturnValue; selectionIds: string[] }[] = [];
  let pendingDeletion: CollectionReturnValue | null = null, deleteReturnFocus: HTMLElement | null = null, mutating = false;
  const deleteDialog = () => dom.el('workflow-delete-dialog') as HTMLDialogElement | null;
  const contextMenu = () => dom.el('workflow-node-context-menu');
  function closeContextMenu(): void { const menu = contextMenu(); if (menu?.matches(':popover-open')) menu.hidePopover(); }
  function feedback(message: string): void {
    const panel = dom.el('workflow-deletion-feedback'); if (panel) panel.hidden = false;
    dom.text('workflow-deletion-message', message);
    const undo = dom.el('workflow-undo-delete-btn'); if (undo) { undo.hidden = !deletions.length; undo.title = t('workflows.deletion.undoShortcut'); }
  }
  function showContextMenu(node: NodeSingular, point: Position): void {
    if (!can('workflow:delete') || deleteDialog()?.open) return;
    closeContextMenu(); select(node);
    const menu = contextMenu(); if (!menu) return;
    menu.showPopover();
    const bounds = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(point.x, dom.doc.documentElement.clientWidth - bounds.width - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(point.y, dom.doc.documentElement.clientHeight - bounds.height - 8)) + 'px';
    menu.querySelector<HTMLButtonElement>('button')?.focus();
  }
  const canonicalType = (type: string) => type === 'approval' ? 'hitl' : type;
  const label = (type: string) => t('workflows.nodes.' + (nodeTypes.some(node => node === canonicalType(type)) ? canonicalType(type) : 'default'));
  const config = (element: { data(key: string): unknown }): Config => { const raw: unknown = element.data('config'); const parsed = configSchema.safeParse(raw); return parsed.success ? parsed.data : {}; };
  const dataText = (element: { data(key: string): unknown }, key: string) => text(element.data(key));
  const later = (fn: () => void, delay: number) => { const id = setTimeout(() => { timeouts.delete(id); if (!dom.disposed) fn(); }, delay); timeouts.add(id); };
  function updateEmpty(): void { dom.show('workflow-canvas-empty', !cy?.nodes().length, 'flex'); }
  function connectionHint(): void { const hint = dom.el('workflow-connect-hint'); if (hint) { hint.hidden = !connectMode; hint.textContent = sourceId ? 'Now select a destination node. Press Esc to cancel.' : 'Select a source node, then a destination. Press Esc to exit.'; } }
  function clearSource(): void { cy?.nodes().removeClass('connect-source'); sourceId = ''; connectionHint(); }
  function inspector(): void { const trace = !dom.el('workflow-dry-run-panel')?.hidden, visible = !!selected || trace; const panel = dom.el('workflow-properties'); if (panel) panel.hidden = !visible; dom.el('page-workflows')?.classList.toggle('has-inspector', visible); if (!selected && trace) { dom.text('workflow-property-title', 'Execution preview'); const empty = dom.el('workflow-property-empty'); if (empty) empty.hidden = true; } }
  function fit(): void { fitOnResize = true; if (cy?.elements().length) { cy.resize(); const width = cy.width(), height = cy.height(); const bb = cy.elements().boundingBox(); const zoom = Math.max(.15, Math.min(1, (width - 100) / bb.w, (height - 180) / bb.h)); cy.zoom(zoom); cy.pan({ x: width / 2 - (bb.x1 + bb.w / 2) * zoom, y: height / 2 - (bb.y1 + bb.h / 2) * zoom + 12 }); } }
  function init(): Core | null {
    const container = dom.el('workflow-canvas'); if (!container || dom.disposed) return null;
    if (cy) { cy.resize(); return cy; }
    cy = cytoscape({ container, elements: [], minZoom: .15, maxZoom: 2, wheelSensitivity: 0.18, autoungrabify: !can('workflow:write'), layout: { name: 'preset' }, style: [
      { selector: 'node', style: { shape: 'round-rectangle', width: 204, height: 80, padding: '0px', 'background-color': '#ffffff', 'background-image': node => nodeBackground(canonicalType(dataText(node, 'type')), label(dataText(node, 'type'))), 'background-width': '100%', 'background-height': '100%', 'border-width': 1.2, 'border-color': node => (nodePresentation[canonicalType(dataText(node, 'type'))] ?? nodePresentation.tool!).color, label: 'data(label)', color: '#253248', 'font-family': 'Inter, Segoe UI, sans-serif', 'font-size': 13, 'font-weight': 600, 'text-valign': 'center', 'text-halign': 'center', 'text-margin-y': 12, 'text-wrap': 'ellipsis', 'text-max-width': '176px', 'overlay-opacity': 0 } },
      { selector: 'node[type="start"], node[type="end"]', style: { shape: 'round-rectangle', width: 152, height: 64, 'corner-radius': '28px', 'text-max-width': '128px', 'background-color': '#f5faf7' } },
      { selector: 'node[type="end"]', style: { 'background-color': '#f3f5f7' } },
      { selector: 'node[type="condition"]', style: { shape: 'diamond', width: 220, height: 120, 'text-max-width': '130px', 'text-margin-y': 10, 'background-color': '#fffcf5' } },
      { selector: 'node.high-risk', style: { 'border-width': 2, 'border-style': 'dashed' } },
      { selector: 'edge', style: { width: 1.6, 'line-color': '#99a4b3', 'target-arrow-color': '#99a4b3', 'target-arrow-shape': 'triangle', 'arrow-scale': .8, 'curve-style': 'taxi', 'taxi-direction': 'rightward', 'taxi-turn': '50%', 'source-distance-from-node': 4, 'target-distance-from-node': 5, label: 'data(label)', 'font-family': 'Inter, Segoe UI, sans-serif', 'font-size': 11, color: '#516074', 'text-background-color': '#f7f9fb', 'text-background-opacity': 1, 'text-background-padding': '4px', 'text-margin-y': -9, 'overlay-opacity': 0 } },
      { selector: 'node:selected', style: { 'border-width': 2.5, 'border-color': '#c62828', 'background-color': '#fffafa' } },
      { selector: 'edge:selected', style: { width: 2.5, 'line-color': '#c62828', 'target-arrow-color': '#c62828' } },
      { selector: '.connect-source', style: { 'border-width': 2.5, 'border-color': '#c62828' } },
      { selector: 'node.just-added', style: { 'border-width': 2.5, 'border-color': '#c62828', 'z-index': 999 } },
    ] });
    cy.on('tap', 'node', event => { closeContextMenu(); container.focus({ preventScroll: true }); const node = event.target as NodeSingular; if (connectMode) connect(node); else select(node); });
    cy.on('tap', 'edge', event => { closeContextMenu(); container.focus({ preventScroll: true }); select(event.target as CollectionReturnValue); });
    cy.on('cxttap', 'node', event => {
      const original = event.originalEvent; original?.preventDefault();
      const rect = container.getBoundingClientRect();
      showContextMenu(event.target as NodeSingular, { x: rect.left + event.renderedPosition.x, y: rect.top + event.renderedPosition.y });
    });
    cy.on('dragpan scrollzoom pinchzoom', closeContextMenu);
    cy.on('tap', event => { if (event.target === cy) { if (connectMode) clearSource(); select(null); } });
    cy.on('add remove', updateEmpty); cy.on('add remove data', () => { if (!mutating) changed(!loading); });
    cy.on('dragfree', () => changed(true));
    cy.on('zoom', () => dom.text('workflow-zoom', Math.round((cy?.zoom() ?? 1) * 100) + '%'));
    cy.on('dragpan scrollzoom pinchzoom', () => { fitOnResize = false; });
    dom.on(dom.doc, 'keydown', event => {
      if (!(event instanceof KeyboardEvent) || !dom.el('page-workflows')?.classList.contains('active') || dom.el('workflow-builder')?.hidden) return;
      const active = dom.doc.activeElement;
      if (event.defaultPrevented || event.isComposing || active?.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],.monaco-editor,.cm-editor,.CodeMirror') || dom.doc.body.classList.contains('app-modal-open') || dom.doc.querySelector('dialog[open]')) return;
      if (contextMenu()?.matches(':popover-open')) {
        if (event.key === 'Escape' || event.key === 'Tab') { if (event.key === 'Escape') event.preventDefault(); closeContextMenu(); container.focus({ preventScroll: true }); }
        else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); contextMenu()?.querySelector<HTMLButtonElement>('button')?.focus(); }
        return;
      }
      if (active !== dom.doc.body && !active?.closest('#workflow-builder')) return;
      if (active?.closest('[popover]:popover-open,[role="listbox"],.workflow-tool-select.open,.workflow-form-select-ui.open') || dom.doc.querySelector('#page-workflows [popover]:popover-open')) return;
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'z' && deletions.length && can('workflow:delete')) { event.preventDefault(); if (!event.repeat) undoDeletion(); return; }
      if ((event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) && selected?.isNode()) { event.preventDefault(); const rect = container.getBoundingClientRect(), p = selected.renderedPosition(); showContextMenu(selected.first() as NodeSingular, { x: rect.left + p.x, y: rect.top + p.y }); return; }
      if (event.key === 'Escape') { if (connectMode) toggleConnect(); else select(null); }
      if ((event.ctrlKey || event.metaKey) && event.key === '0') { event.preventDefault(); fit(); }
      if ((event.key === 'Delete' || event.key === 'Backspace') && !event.ctrlKey && !event.metaKey && !event.altKey && selected?.length && can('workflow:delete')) { event.preventDefault(); if (!event.repeat) removeSelection(); }
    });
    dom.on(container, 'contextmenu', event => { if (contextMenu()?.matches(':popover-open')) event.preventDefault(); });
    const dialog = deleteDialog(); if (dialog) dom.on(dialog, 'close', () => { pendingDeletion = null; const target = deleteReturnFocus; deleteReturnFocus = null; if (target?.isConnected && target.getClientRects().length) target.focus({ preventScroll: true }); });
    if (typeof ResizeObserver !== 'undefined') { observer = new ResizeObserver(() => { cy?.resize(); if (fitOnResize) fit(); const bar = dom.el('page-workflows')?.querySelector('.workflow-meta-bar'); if (bar) dom.el('page-workflows')?.style.setProperty('--workflow-toolbar-height', `${bar.getBoundingClientRect().height}px`); }); for (const selector of ['.workflow-canvas-wrap', '.workflow-page-content']) { const wrap = container.closest(selector); if (wrap) observer.observe(wrap); } const bar = dom.el('page-workflows')?.querySelector('.workflow-meta-bar'); if (bar) observer.observe(bar); }
    return cy;
  }
  function graph(): Graph {
    if (!cy) return emptyGraph();
    return { nodes: cy.nodes().map(node => ({ id: node.id(), type: dataText(node, 'type') || 'tool', label: dataText(node, 'label'), position: node.position(), config: config(node) })), edges: cy.edges().map(edge => ({ id: edge.id(), source: edge.source().id(), target: edge.target().id(), label: dataText(edge, 'label'), config: config(edge) })), config: { ...graphConfig, schema_version: 1 } };
  }
  function load(value: Graph, autoLayout = true): void {
    const core = init(); if (!core) return;
    closeContextMenu(); deleteReturnFocus = null; deleteDialog()?.close(); pendingDeletion = null; deletions.length = 0;
    const feedbackPanel = dom.el('workflow-deletion-feedback'); if (feedbackPanel) feedbackPanel.hidden = true;
    layoutGeneration++; fitOnResize = true; objectArguments.clear(); graphConfig = { ...value.config }; nodeSeq = edgeSeq = 1; selected = null; clearSource();
    loading = true;
    core.batch(() => {
      core.elements().remove();
      value.nodes.forEach((node, index) => {
        if (typeof node.config.arguments === 'object' && node.config.arguments !== null) objectArguments.add(node.id);
        const match = node.id.match(/^node-(\d+)$/); if (match?.[1]) nodeSeq = Math.max(nodeSeq, Number(match[1]) + 1);
        core.add({ group: 'nodes', data: { id: node.id || `node-${index + 1}`, type: node.type || 'tool', label: node.label || label(node.type), config: { ...defaultConfig(node.type, t), ...node.config } }, position: node.position ?? { x: 120 + index * 80, y: 120 + index * 40 }, classes: [node.config.generated_by === 'natural_language' ? 'ai-generated' : '', node.config.risk_level === 'high' || node.config.requires_human_confirmation === 'true' ? 'high-risk' : ''].join(' ') });
      });
      value.edges.forEach((edge, index) => { const match = edge.id.match(/^edge-(\d+)$/); if (match?.[1]) edgeSeq = Math.max(edgeSeq, Number(match[1]) + 1); if (core.getElementById(edge.source).length && core.getElementById(edge.target).length) core.add({ group: 'edges', data: { ...edge, id: edge.id || `edge-${index + 1}` } }); });
    });
    loading = false;
    if (autoLayout && core.nodes().length) void layout(false);
    select(null); updateEmpty(); later(() => { core.resize(); if (!autoLayout) fit(); }, 0);
  }
  function customConfig(element: CollectionReturnValue): Config {
    const cfg = { ...config(element) }; const keys = element.isNode() ? [...Object.keys(defaultConfig(canonicalType(dataText(element, 'type')), t)), 'agent_mode'] : ['condition', 'branch'];
    for (const key of keys) delete cfg[key]; return cfg;
  }
  function renderCustom(cfg: Config): void {
    const entries = Object.entries(cfg);
    dom.html('workflow-custom-fields', entries.length ? entries.map(([key, value], index) => `<div class="workflow-custom-field" data-index="${index}"><input type="text" data-field-key value="${esc(key)}" ${dom.attr('customConfig', 'input')}><input type="text" data-field-value value="${esc(typeof value === 'object' && value !== null ? JSON.stringify(value) : value)}" ${dom.attr('customConfig', 'input')}><button type="button" ${dom.attr('removeCustom')} data-index="${index}">×</button></div>`).join('') : `<div class="workflow-property-empty workflow-property-empty--compact">${esc(t('workflows.noCustomFields'))}</div>`);
  }
  function field(id: string, key: string, value: unknown, placeholder = '', textarea = false): string {
    const json = id === 'workflow-tool-arguments';
    const content = json && typeof value === 'object' && value !== null ? JSON.stringify(value, null, 2) : value;
    return `<div class="form-group"><label for="${id}">${esc(t(key))}</label>${textarea ? `<textarea id="${id}" class="form-input ${json ? 'workflow-json-editor' : ''}" rows="4" spellcheck="${!json}" placeholder="${esc(placeholder)}" ${json ? 'aria-describedby="workflow-json-error"' : ''} ${dom.attr('typedConfig', 'input')}>${esc(content)}</textarea>` : `<input type="text" id="${id}" class="form-input" value="${esc(value)}" placeholder="${esc(placeholder)}" ${dom.attr('typedConfig', 'input')}>`}${json ? '<div class="workflow-json-tools"><span>JSON arguments</span><button type="button" data-wf-click="formatJson">Format JSON</button></div><p id="workflow-json-error" class="workflow-field-error" aria-live="polite" hidden></p>' : ''}</div>`;
  }
  function selectField(id: string, key: string, value: unknown, choices: string[], labels?: string[]): string {
    return `<div class="form-group"><label for="${id}">${esc(t(key))}</label><select id="${id}" class="workflow-form-select-native" ${dom.attr('typedConfig', 'change')}>${choices.map((option, i) => `<option value="${esc(option)}" ${option === value ? 'selected' : ''}>${esc(labels?.[i] ?? option)}</option>`).join('')}</select></div>`;
  }
  function bindingField(prefix: string, key: string, value: unknown, from = 'previous', property = 'output'): string {
    const b = binding(value, from, property);
    return `<div class="form-group"><label>${esc(t(key))}</label><div class="workflow-binding-row" style="display:flex;gap:8px"><select id="${prefix}-from" class="workflow-form-select-native" ${dom.attr('typedConfig', 'change')}>${['previous', 'inputs', 'outputs'].map(option => `<option ${option === b.from ? 'selected' : ''}>${option}</option>`).join('')}</select><input id="${prefix}-field" value="${esc(b.field)}" placeholder="output" ${dom.attr('typedConfig', 'input')}></div><p class="workflow-config-hint">${esc(t(key + 'Hint'))}</p></div>`;
  }
  function renderTyped(element: CollectionReturnValue): void {
    const type = element.isNode() ? canonicalType(dataText(element, 'type')) : 'edge', cfg = { ...defaultConfig(type, t), ...config(element) };
    if (type === 'tool' && typeof cfg.arguments === 'object' && cfg.arguments !== null) objectArguments.add(element.id());
    const join = selectField('workflow-join-strategy', 'workflows.config.joinStrategy', cfg.join_strategy || 'all_merge', ['all_merge', 'last_by_canvas', 'first_non_empty', 'fail_fast']) + `<p class="workflow-config-hint">${esc(t('workflows.config.joinStrategyHint'))}</p>`;
    let html = '';
    switch (type) {
      case 'start': html = field('workflow-start-input-keys', 'workflows.config.inputKeys', cfg.input_keys, 'message, projectId'); break;
      case 'tool': {
        const tools = getTools(); const current = text(cfg.tool_name); const choices = ['', ...tools.map(tool => tool.key)];
        if (current && !choices.includes(current)) choices.push(current);
        html = selectField('workflow-tool-name', 'workflows.config.mcpTool', current, choices, choices.map(key => key ? key + (tools.find(tool => tool.key === key)?.enabled === false ? t('workflows.config.toolDisabled') : '') : t('workflows.config.selectTool'))) + field('workflow-tool-arguments', 'workflows.config.argumentsStatic', cfg.arguments, '{"target":"example.com"}', true) + `<details class="workflow-advanced"><summary>Advanced settings</summary>${join}${field('workflow-tool-timeout', 'workflows.config.timeoutSeconds', cfg.timeout_seconds, t('workflows.config.optional'))}</details>`; break;
      }
      case 'agent': html = join + bindingField('workflow-agent-input', 'workflows.config.inputBinding', cfg.input_binding) + field('workflow-agent-instruction', 'workflows.config.nodeInstruction', cfg.instruction, t('workflows.config.instructionPlaceholder'), true) + field('workflow-agent-output-key', 'workflows.config.outputKey', cfg.output_key, 'agent_result'); break;
      case 'condition': {
        const examples = ['{{previous.output}} != ""', '{{outputs.risk_score}} >= 8', '{{previous.output}} contains "success"', '{{previous.output}} matches "^ok"', 'jsonpath({{previous.output}}, "$.status") == "ok"', 'jq({{outputs.scan}}, ".severity") == "high"'];
        html = join + field('workflow-condition-expression', 'workflows.config.conditionExpression', cfg.expression, examples[0]) + `<p class="workflow-config-hint">${esc(t('workflows.config.conditionHint'))}</p><details class="workflow-advanced"><summary>Expression reference</summary><div class="workflow-config-hint workflow-condition-guide">${['conditionGuideTitle', 'conditionGuideVars', 'conditionGuideOps', 'conditionGuideJson'].map(key => `<div>${esc(t('workflows.config.' + key))}</div>`).join('')}<div class="workflow-example-chips">${examples.map(expr => `<button type="button" class="btn-secondary btn-small" ${dom.attr('conditionExample')} data-expression="${esc(expr)}">${esc(expr)}</button>`).join('')}</div></div></details>`; break;
      }
      case 'hitl': html = join + field('workflow-hitl-prompt', 'workflows.config.hitlPrompt', cfg.prompt, t('workflows.config.hitlPromptPlaceholder'), true) + bindingField('workflow-hitl-prompt-binding', 'workflows.config.promptBinding', cfg.prompt_binding) + `<p class="workflow-config-hint">${esc(t('workflows.config.hitlInteractiveHint'))}</p>` + selectField('workflow-hitl-reviewer', 'workflows.config.hitlReviewer', cfg.reviewer, ['human', 'audit_agent']); break;
      case 'output': html = join + field('workflow-output-key', 'workflows.config.outputKey', cfg.output_key, 'result') + bindingField('workflow-output-source', 'workflows.config.sourceBinding', cfg.source_binding) + field('workflow-output-static', 'workflows.config.staticValue', cfg.static_value || '', t('workflows.config.optional')); break;
      case 'end': html = join + bindingField('workflow-end-result', 'workflows.config.resultBinding', cfg.result_binding, 'outputs', 'result'); break;
      default: {
        const isCondition = dataText(element.source(), 'type') === 'condition';
        html = field('workflow-edge-condition', 'workflows.config.edgeCondition', cfg.condition || '', t('workflows.config.' + (isCondition ? 'edgeConditionHintCondition' : 'edgeConditionHintExample')));
        if (isCondition) html += selectField('workflow-edge-branch', 'workflows.config.edgeBranch', cfg.branch || '', ['', 'true', 'false'], [t('workflows.config.selectBranch'), 'true / yes', 'false / no']) + `<p class="workflow-config-hint">${esc(t('workflows.config.edgeBranchHint'))}</p>`;
      }
    }
    if (type !== 'tool') html = html.replace(join, '') + (type !== 'start' && type !== 'edge' ? `<details class="workflow-advanced"><summary>Advanced settings</summary>${join}</details>` : '');
    dom.html('workflow-typed-config', html);
    const toolSelect = dom.field('workflow-tool-name'); if (toolSelect instanceof HTMLSelectElement) dom.enhanceSelect(toolSelect, 'workflow-tool-select', true, t);
    validateJson();
  }
  function select(element: CollectionArgument | null): void {
    closeContextMenu();
    selected = element?.length && cy ? cy.collection(element) : null;
    const empty = dom.el('workflow-property-empty'), form = dom.el('workflow-property-form'), remove = dom.el('workflow-property-delete-btn');
    if (empty) empty.hidden = !!selected; if (form) form.hidden = !selected; if (remove) remove.hidden = !selected;
    const controls = dom.el('workflow-delete-controls'); if (controls) controls.hidden = !selected;
    dom.text('workflow-property-title', t(!selected ? 'workflows.properties' : selected.isNode() ? 'workflows.nodeProperties' : 'workflows.edgeProperties'));
    if (!selected) cy?.elements().unselect();
    inspector();
    if (!selected) return;
    cy?.elements().unselect(); selected.select(); dom.text('workflow-property-delete-label', t(selected.isNode() ? 'workflows.deleteNode' : 'workflows.deleteEdge'));
    dom.setValue('workflow-prop-label', dataText(selected, 'label')); dom.show('workflow-prop-type-wrap', selected.isNode());
    const typeField = dom.field('workflow-prop-type'); const type = dataText(selected, 'type') || 'tool';
    if (typeField instanceof HTMLSelectElement && !Array.from(typeField.options).some(option => option.value === type)) { const option = dom.doc.createElement('option'); option.value = type; option.textContent = label(type); typeField.append(option); }
    dom.setValue('workflow-prop-type', type);
    renderTyped(selected); renderCustom(customConfig(selected));
  }
  function typedConfig(element: CollectionReturnValue): Config {
    const v = dom.value, b = (id: string) => ({ from: v(id + '-from') || 'previous', field: v(id + '-field') || 'output' });
    if (!element.isNode()) return { condition: v('workflow-edge-condition'), ...(dom.el('workflow-edge-branch') ? { branch: v('workflow-edge-branch') } : {}) };
    const join_strategy = v('workflow-join-strategy') || 'all_merge';
    switch (canonicalType(dataText(element, 'type'))) {
      case 'start': return { input_keys: v('workflow-start-input-keys') };
      case 'tool': { const raw = v('workflow-tool-arguments') || '{}'; let args: unknown = raw; if (objectArguments.has(element.id())) { try { args = JSON.parse(raw) as unknown; } catch { /* Keep invalid input visible for correction. */ } } return { tool_name: v('workflow-tool-name'), arguments: args, timeout_seconds: v('workflow-tool-timeout'), join_strategy }; }
      case 'agent': return { input_binding: b('workflow-agent-input'), instruction: v('workflow-agent-instruction'), output_key: v('workflow-agent-output-key') || 'agent_result', join_strategy };
      case 'condition': return { expression: v('workflow-condition-expression'), join_strategy };
      case 'hitl': return { prompt: v('workflow-hitl-prompt'), prompt_binding: b('workflow-hitl-prompt-binding'), reviewer: v('workflow-hitl-reviewer') || 'human', join_strategy };
      case 'output': return { output_key: v('workflow-output-key') || 'result', source_binding: b('workflow-output-source'), static_value: v('workflow-output-static'), join_strategy };
      case 'end': return { result_binding: b('workflow-end-result'), join_strategy };
      default: return {};
    }
  }
  function updateConfig(): void {
    if (!selected) return;
    const custom: Config = {}, previous = customConfig(selected);
    dom.el('workflow-custom-fields')?.querySelectorAll('.workflow-custom-field').forEach(row => {
      const key = row.querySelector<HTMLInputElement>('[data-field-key]')?.value.trim(), value = row.querySelector<HTMLInputElement>('[data-field-value]')?.value ?? '';
      if (!key) return;
      // Keep opaque nested config values intact until the user edits their serialized value.
      custom[key] = typeof previous[key] === 'object' && previous[key] !== null && JSON.stringify(previous[key]) === value ? previous[key] : value;
    });
    selected.data('config', { ...custom, ...typedConfig(selected) });
    validateJson();
  }
  function updateProperty(): void {
    if (!selected) return;
    const value = dom.value('workflow-prop-label').trim(), type = dom.value('workflow-prop-type') || 'tool', prev = dataText(selected, 'type'); selected.data('label', value);
    if (selected.isNode()) { selected.data('type', type); if (prev !== type) { objectArguments.delete(selected.id()); selected.data('config', defaultConfig(type, t)); selected.data('label', value || label(type)); dom.setValue('workflow-prop-label', dataText(selected, 'label')); renderTyped(selected); renderCustom({}); } }
  }
  function connect(node: NodeSingular): void {
    if (!cy) return;
    if (!sourceId) { sourceId = node.id(); node.addClass('connect-source'); connectionHint(); return; }
    if (sourceId === node.id()) { clearSource(); return; }
    if (cy.edges().toArray().some(edge => edge.source().id() === sourceId && edge.target().id() === node.id())) { notify(t('workflows.duplicateEdge'), 'warning'); clearSource(); return; }
    const source = cy.getElementById(sourceId), count = cy.edges().filter(edge => edge.source().id() === sourceId).length;
    const branch = dataText(source, 'type') === 'condition' && count < 2 ? (count === 0 ? 'true' : 'false') : '';
    while (cy.getElementById(`edge-${edgeSeq}`).length) edgeSeq++;
    cy.add({ group: 'edges', data: { id: `edge-${edgeSeq++}`, source: sourceId, target: node.id(), label: branch ? t('workflows.edges.' + (branch === 'true' ? 'yes' : 'no')) : '', config: branch ? { condition: `{{previous.matched}} == "${branch}"`, branch } : {} } }); clearSource();
  }
  function position(type: string): Position {
    if (!cy) return { x: 120, y: 120 };
    const size = type === 'condition' ? { w: 220, h: 120 } : { w: 204, h: 80 }, pan = cy.pan(), zoom = cy.zoom(), container = cy.container();
    const anchor = selected?.isNode() ? selected.position() : { x: ((container?.clientWidth ?? 240) / 2 - pan.x) / zoom, y: ((container?.clientHeight ?? 240) / 2 - pan.y) / zoom };
    const overlap = (p: Position) => cy?.nodes().toArray().some(node => { const bb = node.boundingBox(), pos = node.position(); return Math.abs(pos.x - p.x) < size.w / 2 + 20 + bb.w / 2 && Math.abs(pos.y - p.y) < size.h / 2 + 20 + bb.h / 2; });
    if (selected?.isNode()) {
      const bb = selected.boundingBox(), dx = bb.w / 2 + 48 + size.w / 2, dy = bb.h / 2 + 48 + size.h / 2;
      for (const p of [{ x: anchor.x + dx, y: anchor.y }, { x: anchor.x, y: anchor.y + dy }, { x: anchor.x - dx, y: anchor.y }, { x: anchor.x, y: anchor.y - dy }]) if (!overlap(p)) return p;
      anchor.x += dx;
    }
    for (let i = 0; i < 20; i++) { const p = { x: anchor.x + i % 5 * 36, y: anchor.y + Math.floor(i / 5) * 36 }; if (!overlap(p)) return p; }
    return anchor;
  }
  function add(type: string, at?: Position): void {
    const core = init(); if (!core) return;
    if (!nodeTypes.some(node => node === type)) type = 'tool';
    while (core.getElementById(`node-${nodeSeq}`).length) nodeSeq++;
    const node = core.add({ group: 'nodes', data: { id: `node-${nodeSeq++}`, type, label: label(type), config: defaultConfig(type, t) }, position: at ?? position(type) });
    fitOnResize = false; select(node); updateEmpty(); node.addClass('just-added'); later(() => node.removeClass('just-added'), 650);
    if (!at) { const p = node.position(), extent = core.extent(); if (p.x < extent.x1 + 40 || p.x > extent.x2 - 40 || p.y < extent.y1 + 40 || p.y > extent.y2 - 40) core.animate({ center: { eles: node }, duration: 200 }); }
  }
  async function layout(animate = true): Promise<void> {
    const core = cy; if (!core?.nodes().length) return;
    const version = ++layoutGeneration;
    try {
      const result = await new ELK().layout({ id: 'root', layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.spacing.nodeNode': '64', 'elk.layered.spacing.nodeNodeBetweenLayers': '84', 'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF', 'elk.edgeRouting': 'ORTHOGONAL' }, children: core.nodes().map(node => ({ id: node.id(), width: node.width(), height: node.height() })), edges: core.edges().map(edge => ({ id: edge.id(), sources: [edge.source().id()], targets: [edge.target().id()] })) });
      if (core.destroyed() || version !== layoutGeneration) return;
      core.batch(() => { for (const node of result.children ?? []) { const element = core.getElementById(node.id); const position = { x: (node.x ?? 0) + (node.width ?? 0) / 2, y: (node.y ?? 0) + (node.height ?? 0) / 2 }; if (animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) element.animate({ position, duration: 200 }); else element.position(position); } });
      if (animate) later(() => { if (version === layoutGeneration) { fit(); changed(true); } }, 220); else { fit(); changed(false); }
    } catch { if (!core.destroyed() && version === layoutGeneration) { core.layout({ name: 'breadthfirst', directed: true, spacingFactor: 1.5, padding: 80 }).run(); fit(); changed(animate); } }
  }
  function validateJson(): boolean { const field = dom.field('workflow-tool-arguments'), error = dom.el('workflow-json-error'); if (!field || !error) return true; let message = ''; try { JSON.parse(field.value || '{}'); } catch (cause) { message = cause instanceof Error ? cause.message : 'Enter valid JSON.'; } field.setAttribute('aria-invalid', String(!!message)); error.hidden = !message; error.textContent = message; return !message; }
  function toggleConnect(): void { connectMode = !connectMode; clearSource(); const button = dom.el('workflow-connect-btn'); button?.classList.toggle('active', connectMode); button?.setAttribute('aria-pressed', String(connectMode)); const title = button?.querySelector('.workflow-toolbar-label'); if (title) title.textContent = t(connectMode ? 'workflows.connecting' : 'workflows.connect'); }
  function removeSelection(): void {
    if (!cy || !can('workflow:delete') || deleteDialog()?.open) return;
    const elements = selected?.length ? selected : cy.$(':selected'); if (!elements.length) return;
    pendingDeletion = elements;
    deleteReturnFocus = dom.doc.activeElement instanceof HTMLElement && !contextMenu()?.contains(dom.doc.activeElement) ? dom.doc.activeElement : dom.el('workflow-canvas');
    closeContextMenu();
    const name = dataText(elements.first(), 'label') || elements.first().id(), node = !!elements.nodes().length;
    dom.text('workflow-delete-title', t(elements.length > 1 ? 'workflows.deletion.confirmMultiple' : node ? 'workflows.deletion.confirmNode' : 'workflows.deletion.confirmEdge', { name }));
    const count = elements.nodes().connectedEdges().length;
    dom.text('workflow-delete-consequence', t(node ? count ? 'workflows.deletion.connections' : 'workflows.deletion.noConnections' : 'workflows.deletion.edgeConsequence', { count }));
    dom.text('workflow-delete-confirm', t(node ? 'workflows.deleteNode' : 'workflows.deleteEdge'));
    deleteDialog()?.showModal(); dom.el('workflow-delete-cancel')?.focus();
  }
  function confirmDeletion(): void {
    const core = cy, elements = pendingDeletion;
    if (!core || !elements?.length || !can('workflow:delete')) { cancelDeletion(); return; }
    const name = dataText(elements.first(), 'label') || elements.first().id(), node = !!elements.nodes().length;
    const count = elements.nodes().connectedEdges().length;
    layoutGeneration++; fitOnResize = false; clearSource();
    const selectionIds = elements.map(element => element.id());
    mutating = true;
    try { const removed = elements.union(elements.nodes().connectedEdges()).remove(); deletions.push({ elements: removed, selectionIds }); if (deletions.length > 50) deletions.shift(); }
    finally { mutating = false; }
    deleteReturnFocus = dom.el('workflow-canvas'); deleteDialog()?.close(); pendingDeletion = null;
    select(null); updateEmpty(); changed(true);
    const message = t(elements.length > 1 ? 'workflows.deletion.deletedMultiple' : node ? 'workflows.deletion.deletedNode' : 'workflows.deletion.deletedEdge', { name });
    feedback(message + (count ? ' ' + t('workflows.deletion.removedConnections', { count }) : ''));
    dom.el('workflow-canvas')?.focus({ preventScroll: true });
  }
  function cancelDeletion(): void { pendingDeletion = null; deleteDialog()?.close(); }
  function undoDeletion(): void {
    if (!cy || !can('workflow:delete') || deleteDialog()?.open) return;
    const entry = deletions.pop(); if (!entry) return;
    layoutGeneration++; fitOnResize = false;
    mutating = true; try { entry.elements.restore(); } finally { mutating = false; }
    select(cy.getElementById(entry.selectionIds[0] ?? '')); updateEmpty(); changed(true);
    feedback(t('workflows.deletion.restored')); dom.el('workflow-canvas')?.focus({ preventScroll: true });
  }
  return { init, graph, load, add, layout, select, updateConfig, updateProperty, removeSelection, confirmDeletion, cancelDeletion, undoDeletion, fit, inspector,
    focus(id: string, fieldId?: string): void { const element = cy?.getElementById(id); if (!element?.length || !cy) return; fitOnResize = false; select(element); later(() => { if (!cy) return; cy.resize(); const zoom = Math.max(.65, cy.zoom()); cy.zoom(zoom); const p = element.isNode() ? element.position() : (element as unknown as EdgeSingular).midpoint(); cy.pan({ x: cy.width() / 2 - p.x * zoom, y: cy.height() / 2 - p.y * zoom }); if (fieldId) dom.field(fieldId)?.focus(); else dom.field('workflow-prop-label')?.focus(); }, 30); },
    zoomBy(factor: number): void { fitOnResize = false; if (cy) cy.zoom({ level: Math.max(.15, Math.min(2, cy.zoom() * factor)), renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } }); },
    formatJson(): void { if (!validateJson()) return; const field = dom.field('workflow-tool-arguments'); if (field) { field.value = JSON.stringify(JSON.parse(field.value || '{}'), null, 2); updateConfig(); } },
    refreshTools(): void { if (selected?.isNode() && dataText(selected, 'type') === 'tool') renderTyped(selected); },
    toggleConnect,
    addCustom(): void { if (!selected) return; const cfg = customConfig(selected); let n = 1; while (Object.hasOwn(cfg, 'field_' + n)) n++; cfg['field_' + n] = ''; selected.data('config', { ...config(selected), ...cfg }); renderCustom(cfg); },
    removeCustom(index: number): void { if (!selected) return; const entries = Object.entries(customConfig(selected)); entries.splice(index, 1); const cfg = Object.fromEntries(entries); selected.data('config', { ...cfg, ...typedConfig(selected) }); renderCustom(cfg); },
    conditionExample(expr: string): void { dom.setValue('workflow-condition-expression', expr); updateConfig(); dom.field('workflow-condition-expression')?.focus(); },
    dragStart(event: DragEvent): void { const type = event.currentTarget instanceof HTMLElement ? event.currentTarget.dataset.nodeType : event.target instanceof HTMLElement ? event.target.dataset.nodeType : 'tool'; event.dataTransfer?.setData('application/x-workflow-node', type || 'tool'); event.dataTransfer?.setData('text/plain', type || 'tool'); if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy'; },
    dragOver(event: DragEvent): void { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'; },
    drop(event: DragEvent): void { event.preventDefault(); const core = init(), container = dom.el('workflow-canvas'); if (!core || !container) return; const rect = container.getBoundingClientRect(), pan = core.pan(), zoom = core.zoom(); add(event.dataTransfer?.getData('application/x-workflow-node') || event.dataTransfer?.getData('text/plain') || 'tool', { x: (event.clientX - rect.left - pan.x) / zoom, y: (event.clientY - rect.top - pan.y) / zoom }); },
    i18n(): void {
      cy?.nodes().forEach(node => { const type = dataText(node, 'type'), value = dataText(node, 'label'); if (knownLabels[type]?.includes(value)) node.data('label', label(type)); });
      cy?.edges().forEach(edge => { const value = dataText(edge, 'label'); if (['\u662f', 'Yes'].includes(value)) edge.data('label', t('workflows.edges.yes')); if (['\u5426', 'No'].includes(value)) edge.data('label', t('workflows.edges.no')); });
      if (selected) select(selected); const title = dom.el('workflow-connect-btn')?.querySelector('.workflow-toolbar-label'); if (title) title.textContent = t(connectMode ? 'workflows.connecting' : 'workflows.connect');
    },
    async animate(value: Graph): Promise<void> {
      load({ ...value, nodes: [], edges: [] }, false); const core = cy; if (!core) return;
      const sorted = [...value.nodes].sort((a, b) => (a.position?.x ?? 0) - (b.position?.x ?? 0) || (a.position?.y ?? 0) - (b.position?.y ?? 0));
      for (const node of sorted) {
        if (dom.disposed || core.destroyed()) return;
        const added = core.add({ group: 'nodes', data: node, position: node.position, classes: 'ai-generated' + (node.config.risk_level === 'high' || node.config.requires_human_confirmation === 'true' ? ' high-risk' : '') });
        select(added); added.addClass('just-added'); core.animate({ center: { eles: added }, duration: 180 }); await new Promise<void>(resolve => setTimeout(resolve, 120)); added.removeClass('just-added');
      }
      for (const edge of value.edges) { if (dom.disposed || core.destroyed()) return; if (core.getElementById(edge.source).length && core.getElementById(edge.target).length) core.add({ group: 'edges', data: edge }); await new Promise<void>(resolve => setTimeout(resolve, 80)); }
      if (!dom.disposed) { layout(true); const risky = core.nodes('.high-risk'); select(risky.length ? risky.first() : null); updateEmpty(); }
    },
    dispose(): void { layoutGeneration++; closeContextMenu(); deleteReturnFocus = null; deleteDialog()?.close(); pendingDeletion = null; deletions.length = 0; observer?.disconnect(); timeouts.forEach(clearTimeout); timeouts.clear(); cy?.destroy(); cy = null; selected = null; },
  };
}
export type WorkflowEditor = ReturnType<typeof createWorkflowEditor>;
