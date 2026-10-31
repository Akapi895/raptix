import { allowedActions, type ImportRecord, type Inspection } from './package-client';
import { escapeHtml as esc, type Dom } from './dom';
import type { Translate } from './model';

export interface PackageState { file: File | null; inspection: Inspection | null; importRecord: ImportRecord | null; action: string; newId: string; riskChoices: boolean; dragDepth: number }
const errorKeys: Record<string, string> = {
  WFPKG_FILE_REQUIRED: 'fileRequired', WFPKG_FILE_TOO_LARGE: 'fileTooLarge', WFPKG_INVALID_ARCHIVE: 'invalidArchive', WFPKG_UNSUPPORTED_FORMAT: 'unsupportedFormat', WFPKG_INVALID_MANIFEST: 'invalidManifest', WFPKG_CHECKSUM_MISMATCH: 'checksumMismatch', WFPKG_MULTIPLE_WORKFLOWS: 'multipleWorkflows', WFPKG_WORKFLOW_INVALID: 'workflowInvalid', WFPKG_INSPECTION_NOT_FOUND: 'inspectionNotFound', WFPKG_INSPECTION_EXPIRED: 'inspectionExpired', WFPKG_INSPECTION_CONSUMED: 'inspectionConsumed', WFPKG_CONFLICT_CHANGED: 'conflictChanged', WFPKG_ID_CONFLICT: 'idConflict', WFPKG_INVALID_ACTION: 'invalidAction', WFPKG_INVALID_RENAME_ID: 'invalidRenameId', WFPKG_OVERWRITE_CONFIRMATION_REQUIRED: 'overwriteConfirmationRequired', WFPKG_IDEMPOTENCY_KEY_REQUIRED: 'idempotencyKeyRequired', WFPKG_IDEMPOTENCY_KEY_REUSED: 'idempotencyKeyReused', WFPKG_IMPORT_FAILED: 'importFailed', WFPKG_EXPORT_FAILED: 'exportFailed', WFPKG_WORKFLOW_NOT_FOUND: 'workflowNotFound',
};
export function createPackageView(dom: Dom, t: Translate) {
  const tr = (key: string, fallback: string, params?: Record<string, string | number>) => { const value = t(key, params); return value === key ? fallback : value; };
  const status = (message: string, type: string) => `<div class="workflow-package-status${type ? ' is-' + esc(type) : ''}"><span class="workflow-package-status-icon" aria-hidden="true"></span><span>${esc(message)}</span></div>`;
  const errorMessage = (code: string, message: string) => errorKeys[code] ? tr('workflows.package.errors.' + errorKeys[code], 'The operation was not completed. Try again later.') : message || tr('workflows.package.errors.generic', 'The operation was not completed. Try again later.');
  function step(importReady: boolean): void {
    dom.el('workflow-package-step-inspection')?.classList.toggle('is-active', !importReady); dom.el('workflow-package-step-inspection')?.classList.toggle('is-complete', importReady); dom.el('workflow-package-step-import')?.classList.toggle('is-active', importReady);
    const status = dom.el('workflow-package-import-modal')?.querySelector('.workflow-package-decision-status'); if (status) { status.classList.toggle('is-ready', importReady); status.textContent = tr('workflows.package.' + (importReady ? 'ready' : 'pending'), importReady ? 'Ready' : 'Pending inspection'); }
  }
  function file(state: PackageState): void {
    const selected = dom.el('workflow-package-selected-file'); if (selected) selected.hidden = !state.file;
    dom.text('workflow-package-file-name', state.file?.name ?? ''); const size = state.file?.size ?? 0;
    dom.text('workflow-package-file-size', !state.file ? '' : size < 1024 ? `${size} B` : size < 1048576 ? `${(size / 1024).toFixed(size < 10240 ? 1 : 0)} KiB` : `${(size / 1048576).toFixed(1)} MiB`);
    dom.disable('workflow-package-inspect-btn', !state.file);
  }
  function inspection(state: PackageState): void {
    const value = state.inspection; if (!value) { dom.html('workflow-package-inspection', ''); return; }
    const wf = value.workflow, conflict = value.conflict.state;
    const copy = conflict === 'identical' ? tr('workflows.package.conflict.identical', 'A local workflow with the same ID and content was found; import will be skipped.') : conflict === 'id_conflict' ? tr('workflows.package.conflict.idConflict', 'A local workflow with the same ID but different content was found. The local version will be kept by default.') : tr('workflows.package.conflict.none', 'No local workflow with the same ID was found. A new workflow can be created.');
    const rows: [string, string | number][] = [['workflowName', wf.name || tr('workflows.package.summary.unnamedWorkflow', 'Untitled workflow')], ['sourceId', wf.source_id || '—'], ['sourceRevision', wf.source_revision || '—'], ['graphSize', tr('workflows.package.summary.graphSizeValue', `${wf.node_count} nodes · ${wf.edge_count} edges`, { nodes: wf.node_count, edges: wf.edge_count })], ['contentHash', wf.content_hash || '—'], ['expiresAt', value.expires_at || '—']];
    dom.html('workflow-package-inspection', `<div class="workflow-package-summary-heading"><span>${esc(tr('workflows.package.summary.title', 'Preflight result'))}</span><b>${esc(tr('workflows.package.summary.passed', 'Checks passed'))}</b></div>${status(copy, conflict === 'id_conflict' ? 'warning' : 'success')}<div class="workflow-package-summary-grid">${rows.map(([key, value]) => `<div class="workflow-package-summary-row"><span>${esc(t('workflows.package.summary.' + key))}</span><code title="${esc(value)}">${esc(value)}</code></div>`).join('')}</div>${value.warnings.length ? `<ul>${value.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}`);
  }
  function resolution(state: PackageState, message = '', type = ''): void {
    const inspection = state.inspection;
    if (!inspection) { dom.html('workflow-package-resolution', status(message || tr('workflows.package.resolution.needInspection', 'Choose a local package and complete preflight first.'), type)); dom.disable('workflow-package-submit-btn', true); step(false); return; }
    const conflict = inspection.conflict.state;
    const choice = (action: string, key: string, hint: string) => `<label class="workflow-package-choice${state.action === action ? ' is-selected' : ''}"><input type="radio" name="workflow-package-resolution-action" value="${action}" ${state.action === action ? 'checked' : ''} ${dom.attr('packageResolution', 'change')}><span><strong>${esc(t('workflows.package.resolution.' + key))}</strong><small>${esc(t('workflows.package.resolution.' + hint))}</small></span></label>`;
    let html = message ? status(message, type) : '';
    if (conflict !== 'id_conflict') html += `<div class="workflow-package-resolution-hero is-success"><span class="workflow-package-resolution-icon" aria-hidden="true">✓</span><div><strong>${esc(t('workflows.package.resolution.' + (conflict === 'none' ? 'createTitle' : 'identicalTitle')))}</strong><small>${esc(t('workflows.package.resolution.' + (conflict === 'none' ? 'createHint' : 'identicalHint')))}</small></div></div>`;
    else {
      html += choice('keep_existing', 'keepExisting', 'keepExistingHint');
      if (!state.riskChoices) html += `<button type="button" class="workflow-package-reveal" ${dom.attr('packageRisk')}>${esc(t('workflows.package.resolution.revealRiskChoices'))}</button>`;
      else { html += choice('overwrite', 'overwrite', 'overwriteHint') + choice('rename', 'rename', 'renameHint'); if (state.action === 'rename') html += `<label class="workflow-package-rename-field">${esc(t('workflows.package.resolution.newWorkflowId'))}<input id="workflow-package-new-id" class="form-input" value="${esc(state.newId)}" placeholder="${esc(t('workflows.package.resolution.newWorkflowIdPlaceholder'))}" autocomplete="off" ${dom.attr('packageRename', 'input')}></label>`; }
    }
    dom.html('workflow-package-resolution', html);
    dom.disable('workflow-package-submit-btn', !allowedActions(conflict).some(action => action === state.action) || state.action === 'rename' && !state.newId.trim());
    dom.text('workflow-package-submit-btn', t('workflows.package.resolution.' + ({ overwrite: 'continueOverwrite', rename: 'confirmRename', create: 'confirmCreate' }[state.action] ?? (conflict === 'identical' ? 'confirmSkip' : 'confirmKeep'))));
    step(true);
  }
  function result(state: PackageState, record: ImportRecord): void {
    const resultKeys: Record<string, string> = { created: 'created', overwritten: 'overwritten', renamed: 'renamed', kept_existing: 'keptExisting', skipped_identical: 'skippedIdentical' };
    const message = tr('workflows.package.result.' + (resultKeys[record.result] ?? 'complete'), 'Import completed.');
    // Completed records can be restored without an inspection; keep the completion state visible.
    dom.html('workflow-package-resolution', status(message, ['kept_existing', 'skipped_identical'].includes(record.result) ? '' : 'success')); step(true);
    dom.disable('workflow-package-submit-btn', true); dom.text('workflow-package-submit-btn', t('workflows.package.result.' + (record.result === 'skipped_identical' ? 'skippedAction' : record.result === 'kept_existing' ? 'keptAction' : 'completedAction')));
    file(state);
  }
  return { tr, errorMessage, step, file, inspection, resolution, result };
}
