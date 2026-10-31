import { closeAppModal, openAppModal } from '../../ui/modal';
import type { KeyValueStorage } from '../../platform/storage';
import { errorMessage, type Dom } from './dom';
import { allowedActions, buildImportRequest, validatePackageFile, WorkflowPackageError, type ImportRequest } from './package-client';
import { createPackageView, type PackageState } from './package-view';
import type { WorkflowsService } from './service';
import type { Translate } from './model';

const inspectionKey = 'csai.workflow-package.inspection-id', importKey = 'csai.workflow-package.import-id';
export interface PackageDependencies {
  storage: KeyValueStorage; t: Translate; can(permission: string): boolean;
  notify(message: string, type: 'error' | 'warning' | 'success' | 'info'): void;
  download(blob: Blob, filename: string): void; translate(root: HTMLElement): void;
}
export function createPackageController(dom: Dom, service: WorkflowsService, deps: PackageDependencies, refresh: () => Promise<void>, getId: () => string) {
  const view = createPackageView(dom, deps.t), state: PackageState = { file: null, inspection: null, importRecord: null, action: '', newId: '', riskChoices: false, dragDepth: 0 };
  let generation = 0, importing = false, inspecting = false;
  const store = (key: string, value: string) => value ? deps.storage.set(key, value) : deps.storage.remove(key);
  function resolution(): void {
    if (state.inspection && !allowedActions(state.inspection.conflict.state).some(action => action === state.action)) state.action = state.inspection.conflict.state === 'none' ? 'create' : 'keep_existing';
    if (state.importRecord) view.result(state, state.importRecord); else view.resolution(state);
  }
  function dragging(): void { dom.el('workflow-package-dropzone')?.classList.toggle('is-dragging', state.dragDepth > 0); }
  function reset(clearStored = true): void {
    generation++; Object.assign(state, { file: null, inspection: null, importRecord: null, action: '', newId: '', riskChoices: false, dragDepth: 0 });
    inspecting = false;
    service.resetImport(); if (clearStored) { store(inspectionKey, ''); store(importKey, ''); }
    const button = dom.el('workflow-package-inspect-btn'); button?.classList.remove('is-loading'); button?.removeAttribute('aria-busy'); dom.text('workflow-package-inspect-btn', view.tr('workflows.package.inspect', 'Upload and preflight'));
    dom.setValue('workflow-package-file-input', ''); dragging(); view.file(state); view.inspection(state); resolution();
  }
  function failure(error: unknown): void {
    const code = error instanceof WorkflowPackageError ? error.code : '', message = view.errorMessage(code, errorMessage(error));
    if (['WFPKG_INSPECTION_EXPIRED', 'WFPKG_CONFLICT_CHANGED', 'WFPKG_INSPECTION_CONSUMED'].includes(code)) { state.inspection = null; state.action = ''; store(inspectionKey, ''); view.inspection(state); view.step(false); }
    view.resolution(state, message, 'warning'); deps.notify(message, 'error');
  }
  function selectFile(file: File | null): void {
    reset(); if (!file) return;
    try { validatePackageFile(file); state.file = file; view.file(state); } catch (error) { failure(error); }
  }
  async function restore(): Promise<void> {
    const token = generation, id = deps.storage.get(importKey);
    if (id) {
      try { const record = await service.importRecord(id); if (token !== generation || dom.disposed) return; state.importRecord = record; view.result(state, record); return; }
      catch { if (token === generation) store(importKey, ''); }
    }
    const inspectionId = deps.storage.get(inspectionKey); if (!inspectionId) return;
    try { const value = await service.inspection(inspectionId); if (token !== generation || dom.disposed) return; state.inspection = value; view.inspection(state); resolution(); }
    catch (error) { if (token === generation && !dom.disposed) { store(inspectionKey, ''); failure(error); } }
  }
  async function open(): Promise<void> {
    if (!deps.can('workflow:write') || dom.disposed) return;
    if (!importing && !inspecting) reset(false);
    openAppModal('workflow-package-import-modal', { focusEl: dom.el('workflow-package-dropzone') }); const modal = dom.el('workflow-package-import-modal'); if (modal) deps.translate(modal);
    if (importing) dom.disable('workflow-package-submit-btn', true);
    else if (!inspecting) await restore();
  }
  // Closing a modal is not cancellation of a server import. Let its response persist
  // the resumable record; a fresh file selection explicitly starts a new generation.
  function close(): void { closeAppModal('workflow-package-import-modal'); closeAppModal('workflow-package-overwrite-modal'); }
  async function inspect(): Promise<void> {
    if (!deps.can('workflow:write') || inspecting || dom.disposed) return;
    inspecting = true; const token = generation;
    dom.disable('workflow-package-inspect-btn', true); const button = dom.el('workflow-package-inspect-btn'); button?.classList.add('is-loading'); button?.setAttribute('aria-busy', 'true'); dom.text('workflow-package-inspect-btn', view.tr('workflows.package.inspecting', 'Running safe preflight…'));
    try {
      const inspection = await service.inspect(state.file); if (token !== generation || dom.disposed) return;
      state.inspection = inspection; state.importRecord = null; state.riskChoices = false; state.newId = state.action = ''; store(inspectionKey, inspection.id); store(importKey, '');
      view.inspection(state); resolution();
    } catch (error) { if (token === generation && !dom.disposed) failure(error); }
    finally { if (token === generation) { inspecting = false; if (!dom.disposed) { view.file(state); button?.classList.remove('is-loading'); button?.removeAttribute('aria-busy'); dom.text('workflow-package-inspect-btn', view.tr('workflows.package.inspect', 'Upload and preflight')); } } }
  }
  async function perform(payload: ImportRequest): Promise<void> {
    if (importing || dom.disposed || !deps.can('workflow:write')) return;
    importing = true; const token = generation; dom.disable('workflow-package-submit-btn', true);
    try {
      const record = await service.importPackage(payload); if (token !== generation || dom.disposed) return;
      state.importRecord = record; state.inspection = null; store(importKey, record.id); store(inspectionKey, ''); view.result(state, record); await refresh();
    } catch (error) { if (token === generation && !dom.disposed) failure(error); }
    finally {
      importing = false;
      if (token === generation && !dom.disposed && !state.importRecord) dom.disable('workflow-package-submit-btn', !state.inspection || !allowedActions(state.inspection.conflict.state).some(action => action === state.action) || state.action === 'rename' && !state.newId.trim());
    }
  }
  async function submit(): Promise<void> {
    if (!state.inspection || !deps.can('workflow:write')) return;
    if (!allowedActions(state.inspection.conflict.state).some(action => action === state.action)) return;
    if (state.action === 'overwrite') { dom.setChecked('workflow-package-overwrite-confirm', false); dom.disable('workflow-package-overwrite-submit-btn', true); openAppModal('workflow-package-overwrite-modal', { focusEl: dom.el('workflow-package-overwrite-confirm') }); return; }
    try { await perform(buildImportRequest({ inspectionId: state.inspection.id, action: state.action, newWorkflowId: state.newId, confirmOverwrite: false })); } catch (error) { failure(error); }
  }
  async function overwrite(): Promise<void> {
    if (!state.inspection || !dom.checked('workflow-package-overwrite-confirm') || state.action !== 'overwrite' || !deps.can('workflow:write')) return;
    try { const request = buildImportRequest({ inspectionId: state.inspection.id, action: 'overwrite', confirmOverwrite: true }); closeAppModal('workflow-package-overwrite-modal'); await perform(request); } catch (error) { failure(error); }
  }
  async function exportPackage(): Promise<void> {
    if (dom.disposed || !deps.can('workflow:read')) return;
    const id = getId(); if (!id) { deps.notify(view.tr('workflows.package.exportSelectSaved', 'Choose a saved workflow before exporting.'), 'warning'); return; }
    try { const value = await service.exportPackage(id); if (!dom.disposed) deps.download(value.blob, value.filename); }
    catch (error) { deps.notify(view.errorMessage(error instanceof WorkflowPackageError ? error.code : '', errorMessage(error)), 'error'); }
  }
  function filePicker(): void { dom.el('workflow-package-file-input')?.click(); }
  function resolutionAction(action: string): void { if (!state.inspection || state.importRecord || !allowedActions(state.inspection.conflict.state).some(value => value === action)) return; state.action = action; if (action !== 'rename') state.newId = ''; resolution(); }
  function rename(): void { state.newId = dom.value('workflow-package-new-id'); dom.disable('workflow-package-submit-btn', !state.newId.trim()); }
  const hooks = {
    openWorkflowPackageImportModal: open, closeWorkflowPackageImportModal: close,
    onWorkflowPackageFileSelected: () => { const input = dom.field('workflow-package-file-input'); selectFile(input instanceof HTMLInputElement ? input.files?.[0] ?? null : null); },
    openWorkflowPackageFilePicker: filePicker,
    onWorkflowPackageDropzoneKeydown: (event: KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); filePicker(); } },
    onWorkflowPackageDragEnter: (event: DragEvent) => { event.preventDefault(); state.dragDepth++; dragging(); },
    onWorkflowPackageDragOver: (event: DragEvent) => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'; },
    onWorkflowPackageDragLeave: (event: DragEvent) => { event.preventDefault(); state.dragDepth = Math.max(0, state.dragDepth - 1); dragging(); },
    onWorkflowPackageDrop: (event: DragEvent) => { event.preventDefault(); state.dragDepth = 0; dragging(); selectFile(event.dataTransfer?.files[0] ?? null); },
    clearWorkflowPackageFile: (event?: Event) => { event?.preventDefault(); event?.stopPropagation(); selectFile(null); },
    inspectWorkflowPackage: inspect, revealWorkflowPackageRiskChoices: () => { state.riskChoices = true; resolution(); },
    selectWorkflowPackageResolution: resolutionAction, updateWorkflowPackageRenameId: rename, submitWorkflowPackageImport: submit,
    closeWorkflowPackageOverwriteModal: () => closeAppModal('workflow-package-overwrite-modal'),
    updateWorkflowPackageOverwriteConfirmation: () => dom.disable('workflow-package-overwrite-submit-btn', !dom.checked('workflow-package-overwrite-confirm')),
    confirmWorkflowPackageOverwrite: overwrite, exportCurrentWorkflowPackage: exportPackage,
  };
  function bind(): void {
    dom.action('packageResolution', node => { if (node instanceof HTMLInputElement) resolutionAction(node.value); }); dom.action('packageRisk', hooks.revealWorkflowPackageRiskChoices); dom.action('packageRename', rename);
  }
  return { hooks, bind, state, refresh(): void { view.file(state); view.inspection(state); resolution(); }, dispose(): void { generation++; closeAppModal('workflow-package-import-modal'); closeAppModal('workflow-package-overwrite-modal'); } };
}
