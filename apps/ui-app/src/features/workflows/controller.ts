import { closeAppModal, openAppModal } from '../../ui/modal';
import type { KeyValueStorage } from '../../platform/storage';
import { createWorkflowEditor } from './editor';
import { errorMessage, escapeHtml as esc } from './dom';
import { emptyGraph, parseGraph, validateGraph, validateGraphIssues, type AiResult, type ToolOption, type Translate, type WorkflowMeta } from './model';
import { nodeIcon, nodePresentation } from './node-presentation';
import { createPackageController } from './package-controller';
import type { WorkflowsService } from './service';
import type { WorkflowsView } from './view';

export interface WorkflowsDependencies {
  doc: Document; t: Translate; sessionStorage: KeyValueStorage;
  can(permission: string): boolean; confirm(message: string): boolean;
  notify(message: string, type: 'error' | 'warning' | 'success' | 'info'): void;
  download(blob: Blob, filename: string): void; translate(root: HTMLElement): void; refreshRoleSelects(): void;
  applyPermissions?(root: HTMLElement): void;
}
export function createWorkflowsController(service: WorkflowsService, view: WorkflowsView, deps: WorkflowsDependencies) {
  const { dom } = view, { t } = deps;
  let currentId = '', saveOnApply = false, saving = false, mounted = false, generating = false, animating = false, aiResult: AiResult | null = null;
  let toolOptions: ToolOption[] = [], generation = 0, dirty = false;
  const permitted = (permission = 'workflow:write') => !dom.disposed && deps.can(permission);
  const notifyError = (error: unknown) => { if (!dom.disposed) deps.notify(t(errorMessage(error)), 'error'); };
  const closePopover = (id: string) => { const menu = dom.el(id); if (menu?.matches(':popover-open')) menu.hidePopover(); };
  const showIssues = () => { const menu = dom.el('workflow-validation-menu'); if (menu && !menu.matches(':popover-open')) menu.showPopover(); };
  function render(): void { if (dom.disposed) return; const graph = editor.graph(); view.title(service.workflows, currentId, graph); view.list(service.workflows, currentId, graph); dom.text('workflow-save-state', dirty ? 'Unsaved changes' : currentId ? 'Saved' : ''); }
  const editor = createWorkflowEditor(dom, t, deps.notify, edited => { if (edited) dirty = true; render(); }, () => toolOptions, deps.can);
  const packages = createPackageController(dom, service, { storage: deps.sessionStorage, t, can: deps.can, notify: deps.notify, download: deps.download, translate: deps.translate }, refresh, () => currentId || view.readMeta().id);
  function fill(meta: WorkflowMeta, graph = emptyGraph()): void { currentId = meta.id; dirty = false; view.setMeta(meta); view.closeTrace(); editor.load(graph); render(); }
  function newDraft(options?: { openMeta?: boolean }): void { if (!permitted()) return; closePopover('workflow-switcher'); fill({ id: '', name: '', description: '', enabled: true }); if (options?.openMeta !== false) openMeta(); }
  function select(id: string): void { const wf = service.workflows.find(item => item.id === id); if (wf) { closePopover('workflow-switcher'); fill(wf, parseGraph(wf.graph_json ?? wf.graph)); } }
  async function refresh(): Promise<void> {
    if (dom.disposed) return; editor.init(); dom.html('workflow-list', `<div class="loading-spinner">${esc(t('common.loading'))}</div>`);
    try {
      await service.list(true); if (dom.disposed) return;
      if (currentId) { const wf = service.workflows.find(item => item.id === currentId); if (wf) view.setMeta(wf); }
      else if (service.workflows[0]) select(service.workflows[0].id);
      else { fill({ id: '', name: '', description: '', enabled: true }); }
      render();
      void service.tools().then(tools => { if (!dom.disposed) { toolOptions = tools; editor.refreshTools(); } }).catch(notifyError);
    } catch (error) { if (!dom.disposed) { dom.html('workflow-list', `<div class="empty-state">${esc(errorMessage(error))}</div>`); notifyError(error); } }
  }
  function openMeta(options?: { saveOnApply?: boolean }): void {
    if (!permitted()) return; closePopover('workflow-switcher'); saveOnApply = !!options?.saveOnApply; view.lockId(!!currentId, currentId || view.readMeta().id); openAppModal('workflow-meta-modal', { focusEl: dom.el(currentId ? 'workflow-name' : 'workflow-id') });
  }
  function closeMeta(): void { saveOnApply = false; closeAppModal('workflow-meta-modal'); }
  async function applyMeta(): Promise<void> {
    if (!permitted()) return;
    const meta = view.readMeta(); if (!meta.id || !meta.name) { deps.notify(t('workflows.idNameRequired'), 'error'); return; }
    const shouldSave = saveOnApply; closeMeta(); dirty = true; render(); if (shouldSave) await save();
  }
  async function roleOptions(selectedId?: string): Promise<void> {
    try { await service.list(true); if (!dom.disposed) view.roleOptions(service.workflows, selectedId); }
    catch { if (!dom.disposed) view.roleOptions([], selectedId); }
    if (!dom.disposed) deps.refreshRoleSelects();
  }
  async function save(): Promise<void> {
    if (!permitted() || saving) return; editor.init(); const meta = view.readMeta();
    if (!meta.id || !meta.name) { deps.notify(t('workflows.idNameRequired'), 'error'); openMeta({ saveOnApply: true }); return; }
    const graph = editor.graph(), errors = validateGraph(graph, t); if (errors.length) { showIssues(); return; }
    saving = true;
    dom.disable('workflow-save-btn', true); dom.text('workflow-save-label', 'Saving…');
    try {
      await service.validate(graph); const wf = await service.save(meta, graph, currentId); if (dom.disposed) return;
      currentId = wf.id; dirty = false; view.lockId(true, currentId); closeMeta(); deps.notify(t('workflows.saved'), 'success'); await refresh(); await roleOptions();
    } catch (error) { if (!dom.disposed) notifyError(error); } finally { saving = false; dom.disable('workflow-save-btn', false); dom.text('workflow-save-label', t('common.save')); }
  }
  async function toggleEnabled(id: string, enabled: boolean): Promise<void> {
    if (!permitted()) return;
    const wf = service.workflows.find(item => item.id === id); if (!wf) return;
    const previous = wf.enabled; wf.enabled = enabled; if (id === currentId) dom.setChecked('workflow-enabled', enabled); render();
    try { await service.save({ id: wf.id, name: wf.name, description: wf.description, enabled }, id === currentId ? editor.graph() : parseGraph(wf.graph_json ?? wf.graph), id); if (dom.disposed) return; deps.notify(t('workflows.enabledUpdated'), 'success'); await roleOptions(); }
    catch (error) { wf.enabled = previous; if (id === currentId) dom.setChecked('workflow-enabled', previous); render(); notifyError(error); }
  }
  function dryRun(): void {
    if (!permitted('workflow:execute')) return; editor.init(); const errors = validateGraph(editor.graph(), t); if (errors.length) { showIssues(); return; }
    dom.setValue('workflow-dry-run-message', 'ping'); openAppModal('workflow-dry-run-modal', { focusEl: dom.el('workflow-dry-run-message') });
    const input = dom.field('workflow-dry-run-message'); if (input instanceof HTMLInputElement) input.select();
  }
  async function submitDryRun(): Promise<void> {
    if (!permitted('workflow:execute')) return;
    const graph = editor.graph(), errors = validateGraph(graph, t); if (errors.length) { closeAppModal('workflow-dry-run-modal'); showIssues(); return; }
    closeAppModal('workflow-dry-run-modal');
    try { const result = await service.dryRun(graph, dom.value('workflow-dry-run-message').trim() || 'ping'); if (!dom.disposed) { view.trace(result); editor.inspector(); deps.notify(t('workflows.dryRunDone'), 'success'); } } catch (error) { notifyError(error); }
  }
  async function remove(): Promise<void> {
    if (!permitted('workflow:delete')) return; const id = currentId || view.readMeta().id;
    if (!id) { deps.notify(t('workflows.selectToDelete'), 'warning'); return; } if (!deps.confirm(t('workflows.confirmDelete', { id }))) return;
    try { await service.remove(id); if (dom.disposed) return; currentId = ''; deps.notify(t('workflows.deleted'), 'success'); fill({ id: '', name: '', description: '', enabled: true }); await refresh(); await roleOptions(); } catch (error) { notifyError(error); }
  }
  function openAi(): void {
    if (!permitted()) return; generation++; aiResult = null; view.progress(); view.aiResult(null); dom.disable('workflow-ai-generate-btn', false); openAppModal('workflow-ai-modal', { focusEl: dom.el('workflow-ai-prompt') });
  }
  async function generateAi(): Promise<void> {
    if (!permitted() || generating) return; const prompt = dom.value('workflow-ai-prompt').trim();
    if (!prompt) { deps.notify(t('workflows.ai.promptRequired'), 'warning'); return; }
    generating = true; const token = ++generation; dom.disable('workflow-ai-generate-btn', true); dom.text('workflow-ai-generate-btn', t('workflows.ai.generating')); view.aiResult(null); view.progress('understand');
    try {
      toolOptions = await service.tools(); if (dom.disposed || token !== generation) return; view.progress('match');
      const options = { includeObjective: dom.checked('workflow-ai-include-objective'), allowSchedule: dom.checked('workflow-ai-allow-schedule'), allowHighRisk: dom.checked('workflow-ai-allow-high-risk') };
      view.progress('draft'); const result = await service.generate(prompt, options, toolOptions); if (dom.disposed || token !== generation) return;
      view.progress('audit'); aiResult = result; view.aiResult(result); view.progress('', true); if (validateGraph(result.graph, t).length) deps.notify(t('workflows.ai.generatedWithIssues'), 'warning');
    } catch (error) { if (!dom.disposed && token === generation) { aiResult = null; view.progress(); view.aiResult(null); notifyError(error); } }
    finally { generating = false; if (!dom.disposed && token === generation) { dom.disable('workflow-ai-generate-btn', false); dom.text('workflow-ai-generate-btn', t('workflows.ai.generate')); } }
  }
  async function applyAi(): Promise<void> {
    if (!aiResult || animating || !permitted() || validateGraph(aiResult.graph, t).length) return;
    animating = true; dom.disable('workflow-ai-apply-btn', true); dom.text('workflow-ai-apply-btn', t('workflows.ai.rendering')); closeAppModal('workflow-ai-modal'); const status = dom.el('workflow-ai-canvas-status'); if (status) status.hidden = false;
    try { currentId = ''; view.setMeta({ ...aiResult.meta, enabled: true }, false); view.closeTrace(); await editor.animate(aiResult.graph); if (!dom.disposed) { render(); deps.notify(t('workflows.ai.applied'), 'success'); } }
    finally { animating = false; if (status) status.hidden = true; if (!dom.disposed) { dom.disable('workflow-ai-apply-btn', false); dom.text('workflow-ai-apply-btn', t('workflows.ai.apply')); } }
  }
  const closeMore = () => dom.el('workflow-more-actions')?.removeAttribute('open');
  const hooks = {
    refreshWorkflows: refresh, newWorkflowDraft: newDraft, selectWorkflow: select, openWorkflowMetaModal: openMeta, closeWorkflowMetaModal: closeMeta, applyWorkflowMetaModal: applyMeta,
    editWorkflowFromList: (id: string) => { if (id !== currentId) select(id); openMeta(); }, toggleWorkflowEnabled: toggleEnabled,
    saveWorkflowDraft: save, dryRunWorkflowDraft: dryRun, closeWorkflowDryRunModal: () => closeAppModal('workflow-dry-run-modal'), submitWorkflowDryRun: submitDryRun, closeWorkflowDryRunPanel: view.closeTrace, deleteCurrentWorkflow: remove,
    workflowPaletteDragStart: (event: DragEvent) => { if (permitted()) editor.dragStart(event); }, workflowCanvasDragOver: editor.dragOver, workflowCanvasDrop: (event: DragEvent) => { if (permitted()) editor.drop(event); },
    addWorkflowNodeFromPalette: (type: string) => { if (permitted()) { closePopover('workflow-add-menu'); editor.add(type || 'tool'); } }, toggleWorkflowConnectMode: () => { if (permitted()) editor.toggleConnect(); }, closeWorkflowMoreActions: closeMore,
    deleteWorkflowSelection: () => { if (permitted('workflow:delete')) editor.removeSelection(); }, layoutWorkflowGraph: editor.layout,
    updateWorkflowSelectedProperty: () => { if (permitted()) editor.updateProperty(); }, addWorkflowCustomField: () => { if (permitted()) editor.addCustom(); },
    updateWorkflowCustomFields: () => { if (permitted()) editor.updateConfig(); }, updateWorkflowTypedConfig: () => { if (permitted()) editor.updateConfig(); },
    useWorkflowConditionExample: (expr: string) => { if (permitted()) editor.conditionExample(expr); }, removeWorkflowCustomField: (index: number) => { if (permitted()) editor.removeCustom(index); },
    loadWorkflowOptionsForRoleModal: roleOptions, openWorkflowAiModal: openAi, closeWorkflowAiModal: () => closeAppModal('workflow-ai-modal'),
    useWorkflowAiExample: (key: string) => { dom.setValue('workflow-ai-prompt', t('workflows.ai.examples.' + key)); dom.field('workflow-ai-prompt')?.focus(); },
    generateWorkflowFromNaturalLanguage: generateAi, applyWorkflowAiDraft: applyAi,
    ...packages.hooks,
  };
  return { hooks, editor, packages, selectedId: () => currentId, isDirty: () => dirty,
    activate(): void {
      if (mounted || dom.disposed) return; mounted = true;
      const simple = {
        refreshWorkflows: refresh, newWorkflowDraft: () => newDraft(), openWorkflowMetaModal: () => openMeta(), closeWorkflowMetaModal: closeMeta, applyWorkflowMetaModal: applyMeta,
        saveWorkflowDraft: save, dryRunWorkflowDraft: dryRun, closeWorkflowDryRunModal: hooks.closeWorkflowDryRunModal, closeWorkflowDryRunPanel: view.closeTrace,
        submitWorkflowDryRun: submitDryRun, deleteCurrentWorkflow: remove, toggleWorkflowConnectMode: hooks.toggleWorkflowConnectMode, layoutWorkflowGraph: () => editor.layout(),
        deleteWorkflowSelection: hooks.deleteWorkflowSelection, updateWorkflowSelectedProperty: hooks.updateWorkflowSelectedProperty, addWorkflowCustomField: hooks.addWorkflowCustomField,
        openWorkflowAiModal: openAi, closeWorkflowAiModal: hooks.closeWorkflowAiModal, generateWorkflowFromNaturalLanguage: generateAi, applyWorkflowAiDraft: applyAi,
        openWorkflowPackageImportModal: packages.hooks.openWorkflowPackageImportModal, closeWorkflowPackageImportModal: packages.hooks.closeWorkflowPackageImportModal,
        onWorkflowPackageFileSelected: packages.hooks.onWorkflowPackageFileSelected, openWorkflowPackageFilePicker: packages.hooks.openWorkflowPackageFilePicker,
        inspectWorkflowPackage: packages.hooks.inspectWorkflowPackage, submitWorkflowPackageImport: packages.hooks.submitWorkflowPackageImport,
        closeWorkflowPackageOverwriteModal: packages.hooks.closeWorkflowPackageOverwriteModal, updateWorkflowPackageOverwriteConfirmation: packages.hooks.updateWorkflowPackageOverwriteConfirmation, confirmWorkflowPackageOverwrite: packages.hooks.confirmWorkflowPackageOverwrite,
      };
      for (const [name, fn] of Object.entries(simple)) dom.action(name, () => fn());
      dom.action('closeProperties', () => { view.closeTrace(); editor.select(null); dom.el('workflow-canvas')?.focus(); });
      dom.action('closeWorkflowDryRunPanel', () => { view.closeTrace(); editor.inspector(); });
      dom.action('zoomIn', () => editor.zoomBy(1.2)); dom.action('zoomOut', () => editor.zoomBy(1 / 1.2)); dom.action('fitView', editor.fit);
      dom.action('formatJson', () => { if (permitted()) editor.formatJson(); });
      dom.action('confirmWorkflowDeletion', editor.confirmDeletion);
      dom.action('cancelWorkflowDeletion', editor.cancelDeletion);
      dom.action('undoWorkflowDeletion', editor.undoDeletion);
      dom.action('searchWorkflows', () => view.list(service.workflows, currentId, editor.graph()));
      dom.action('searchCanvasNodes', () => view.navigator(editor.graph()));
      dom.action('focusNode', node => { closePopover('workflow-navigator'); editor.focus(node.dataset.id ?? ''); });
      dom.action('focusIssue', node => { const issue = validateGraphIssues(editor.graph(), t)[Number(node.dataset.index)]; closePopover('workflow-validation-menu'); if (issue?.elementId) editor.focus(issue.elementId, issue.fieldId); else if (issue?.addType && permitted()) editor.add(issue.addType); });
      const searchNodes = () => { const query = dom.value('workflow-node-search').trim().toLowerCase(); let count = 0; dom.el('workflow-add-menu')?.querySelectorAll<HTMLElement>('[data-node-type]').forEach(node => { node.hidden = !node.textContent?.toLowerCase().includes(query); if (!node.hidden) count++; }); const empty = dom.el('workflow-node-no-results'); if (empty) empty.hidden = count > 0; };
      dom.action('searchNodes', searchNodes);
      dom.el('workflow-add-menu')?.querySelectorAll<HTMLElement>('[data-node-type]').forEach(node => { const type = node.dataset.nodeType ?? 'tool', presentation = nodePresentation[type]; node.removeAttribute('data-i18n'); node.innerHTML = `${nodeIcon(type)}<strong>${esc(t('workflows.nodes.' + type))}</strong><small>${esc(presentation?.description ?? '')}</small>`; });
      for (const id of ['workflow-switcher', 'workflow-add-menu', 'workflow-validation-menu', 'workflow-navigator']) {
        const menu = dom.el(id); if (!menu) continue;
        const position = () => { const trigger = deps.doc.querySelector<HTMLElement>(`#page-workflows [popovertarget="${id}"]`); if (!trigger) return; const rect = trigger.getBoundingClientRect(), width = Math.min(id === 'workflow-add-menu' ? 320 : 380, innerWidth - 24), bottom = Math.min(innerHeight, dom.el('page-workflows')?.getBoundingClientRect().bottom ?? innerHeight); const above = id === 'workflow-validation-menu' || id === 'workflow-navigator'; menu.style.width = width + 'px'; menu.style.left = Math.max(12, Math.min(rect.left, innerWidth - width - 12)) + 'px'; menu.style.top = above ? 'auto' : Math.min(rect.bottom + 8, bottom - 180) + 'px'; menu.style.bottom = above ? Math.max(12, innerHeight - rect.top + 8) + 'px' : 'auto'; menu.style.maxHeight = Math.max(120, Math.min(560, above ? rect.top - 24 : bottom - rect.bottom - 20)) + 'px'; };
        dom.on(menu, 'beforetoggle', position);
        dom.on(menu, 'toggle', () => { if (menu.matches(':popover-open')) { if (id === 'workflow-add-menu') { dom.setValue('workflow-node-search', ''); searchNodes(); } menu.querySelector<HTMLInputElement>('input')?.focus(); } });
        const viewport = deps.doc.defaultView; if (viewport) dom.on(viewport, 'resize', () => { if (menu.matches(':popover-open')) position(); });
      }
      dom.action('exportPackage', () => { closeMore(); return packages.hooks.exportCurrentWorkflowPackage(); });
      dom.action('deleteCurrent', () => { closeMore(); return remove(); });
      for (const type of ['start', 'tool', 'agent', 'condition', 'hitl', 'output', 'end']) dom.action('add-' + type, () => hooks.addWorkflowNodeFromPalette(type));
      for (const key of ['domainMonitor', 'reportReview', 'assetTriage']) dom.action('example-' + key, () => hooks.useWorkflowAiExample(key));
      for (const [id, close] of [['workflow-dry-run-modal', hooks.closeWorkflowDryRunModal], ['workflow-ai-modal', hooks.closeWorkflowAiModal]] as const) {
        const outside = 'outside-' + id, escape = 'escape-' + id;
        dom.action(outside, (node, event) => { if (event.target === node) close(); }); dom.action(escape, (_node, event) => { if (event instanceof KeyboardEvent && event.key === 'Escape') close(); });
      }
      dom.action('stop', (_node, event) => event.stopPropagation());
      dom.action('submitDryRun', (_node, event) => { event.preventDefault(); return submitDryRun(); }); dom.action('submitAi', (_node, event) => { event.preventDefault(); return generateAi(); });
      dom.action('select', node => select(node.dataset.id ?? '')); dom.action('toggleEnabled', node => toggleEnabled(node.dataset.id ?? '', node.dataset.enabled === 'true')); dom.action('editMeta', node => hooks.editWorkflowFromList(node.dataset.id ?? ''));
      dom.action('typedConfig', hooks.updateWorkflowTypedConfig); dom.action('customConfig', hooks.updateWorkflowCustomFields); dom.action('removeCustom', node => hooks.removeWorkflowCustomField(Number(node.dataset.index))); dom.action('conditionExample', node => hooks.useWorkflowConditionExample(node.dataset.expression ?? ''));
      const drag = (name: string, handler: (event: DragEvent) => void) => dom.action(name, (_node, event) => { if (event instanceof DragEvent) handler(event); });
      drag('paletteDrag', hooks.workflowPaletteDragStart); drag('canvasOver', hooks.workflowCanvasDragOver); drag('canvasDrop', hooks.workflowCanvasDrop);
      drag('packageEnter', packages.hooks.onWorkflowPackageDragEnter); drag('packageOver', packages.hooks.onWorkflowPackageDragOver); drag('packageLeave', packages.hooks.onWorkflowPackageDragLeave); drag('packageDrop', packages.hooks.onWorkflowPackageDrop);
      dom.action('packageKeyboard', (_node, event) => { if (event instanceof KeyboardEvent) packages.hooks.onWorkflowPackageDropzoneKeydown(event); });
      dom.action('clearPackageFile', (_node, event) => packages.hooks.clearWorkflowPackageFile(event));
      packages.bind();
      dom.mount();
      dom.on(deps.doc, 'click', event => { const menu = dom.el('workflow-more-actions'); if (menu instanceof HTMLDetailsElement && menu.open && event.target instanceof Node && (!menu.contains(event.target) || (event.target instanceof Element && !!event.target.closest('[role="menuitem"]')))) closeMore(); });
      dom.on(deps.doc, 'keydown', event => { if (event instanceof KeyboardEvent && event.key === 'Escape') closeMore(); });
      dom.on(deps.doc, 'languagechange', () => { for (const id of ['page-workflows', 'workflow-meta-modal', 'workflow-dry-run-modal', 'workflow-ai-modal', 'workflow-package-import-modal', 'workflow-package-overwrite-modal']) { const root = dom.el(id); if (root) deps.translate(root); } editor.i18n(); render(); void roleOptions(); packages.refresh(); if (aiResult) view.aiResult(aiResult); });
    },
    dispose(): void { generation++; packages.dispose(); editor.dispose(); for (const id of ['workflow-meta-modal', 'workflow-dry-run-modal', 'workflow-ai-modal']) closeAppModal(id); dom.dispose(); },
  };
}
