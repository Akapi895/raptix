import { closeAppModal, isAppModalOpen, openAppModal } from '../../ui/modal';
import { errorMessage, escapeHtml as e, type AssetsDependencies } from './contracts';
import { action, bindActions, createDOM, toast, type ActionHandler } from './dom';
import { editorTarget, FILTER_IDS, IMPORT_MAX_BYTES, isIPv4, isIPv6, normalizeDomain, parseTarget, targetLabel, type Asset, type AssetInput } from './model';
import type { AssetsService } from './service';
import { createAssetWorkspace } from './workspace';
import { createAssetEvidence } from './detail';
import { downloadTemplate, exportAssets, readImportFile } from './spreadsheet';

export function createAssetsView(doc: Document, service: AssetsService, deps: AssetsDependencies) {
  const abort = new AbortController(), dom = createDOM(doc, abort.signal), s = service.state, t = deps.t;
  const workspace = createAssetWorkspace(doc, service, deps, abort.signal, detailRecord, async (id, value) => { dom.set(id, value); syncSelect(id); await load(1); });
  const evidence = createAssetEvidence(doc, service, deps, abort.signal);
  let activeProject = deps.activeProject(), projectOff: (() => void) | undefined, loadSequence = 0;
  let activated = false, disposed = false, editorFocus: Element | null = null, importFocus: Element | null = null, importSequence = 0;
  const selectIds = ['asset-status-filter', 'asset-project-filter', 'asset-risk-filter', 'asset-scan-filter', 'asset-environment-filter', 'asset-criticality-filter', 'asset-sort-filter', 'asset-saved-view-select', 'asset-batch-project', 'asset-edit-project', 'asset-edit-status', 'asset-edit-environment', 'asset-edit-criticality', 'asset-bulk-status', 'asset-bulk-environment', 'asset-bulk-criticality', 'asset-page-size-pagination'];
  function syncSelect(id: string) {
    const el = dom.get(id); if (!(el instanceof HTMLSelectElement)) return; deps.enhanceSelect(el); deps.syncSelect(el);
    const wrapper = el.closest('.settings-custom-select'); wrapper?.classList.add('asset-custom-select');
    wrapper?.classList.toggle('asset-custom-select--filter', !!el.closest('.asset-toolbar')); wrapper?.classList.toggle('asset-custom-select--saved-view', id === 'asset-saved-view-select'); wrapper?.classList.toggle('asset-custom-select--pagination', id === 'asset-page-size-pagination');
  }
  function filters() { const project = deps.activeProject(); s.filters = Object.fromEntries(FILTER_IDS.map(id => [id, dom.value(id)])); if (project) { s.filters['asset-project-filter'] = project; dom.set('asset-project-filter', project); syncSelect('asset-project-filter'); } }
  const report = (error: unknown) => { if (!disposed) deps.alert(errorMessage(error)); };
  function risk(level: string | undefined) { const normalized = ['critical', 'high', 'medium', 'low', 'info', 'normal'].includes(level || '') ? level || '' : 'unassessed'; return { level: normalized, label: t('assets.risk' + normalized.charAt(0).toUpperCase() + normalized.slice(1)) }; }
  function closeBatchMenu() { const el = dom.get('asset-batch-more'); if (el instanceof HTMLDetailsElement) el.open = false; }
  function updateSelection() {
    const count = s.selected.size; dom.hidden('asset-batch-actions', !count || !!dom.get('asset-inventory-panel')?.hidden); dom.text('asset-selected-count', t('assets.selectedCount', { count }));
    dom.hidden('asset-select-all-results', count === 0 || count >= s.total || s.allMatchingSelected); dom.text('asset-select-all-results', t('assets.selectAllResults', { count: s.total }));
    dom.hidden('asset-all-results-selected', !s.allMatchingSelected); dom.text('asset-all-results-selected', t('assets.allResultsSelected', { count }));
    dom.busy('asset-merge-selected', count < 2); const merge = dom.get('asset-merge-selected'); if (merge) merge.title = count < 2 ? t('assets.mergeRequiresMultiple') : '';
    const all = dom.get('asset-select-page'); if (all instanceof HTMLInputElement) { const selected = s.items.filter(a => s.selected.has(a.id)).length; all.checked = s.items.length > 0 && selected === s.items.length; all.indeterminate = selected > 0 && selected < s.items.length; }
  }
  function ownership(asset: Asset) {
    const owner = asset.responsible_person?.trim(), department = asset.department?.trim();
    if (!owner && !department) return `<span class="asset-ownership-empty">${e(t('assets.unassigned'))}</span>`;
    return `<div class="asset-ownership" title="${e([owner ? t('assets.responsiblePerson') + ': ' + owner : '', department ? t('assets.department') + ': ' + department : ''].filter(Boolean).join(' · '))}"><span class="asset-ownership__primary">${e(owner || department)}</span>${owner && department ? `<span class="asset-ownership__secondary">${e(department)}</span>` : ''}</div>`;
  }
  function renderRows() {
    dom.html('asset-table-body', s.items.length ? s.items.map((asset, index) => {
      const level = risk(asset.risk_level), count = Number(asset.vulnerability_count || 0), svc = [asset.protocol, asset.port ? ':' + asset.port : ''].join('') || '-';
      const args = { index };
      return `<tr><td class="asset-check-cell"><input type="checkbox" class="theme-checkbox" ${s.selected.has(asset.id) ? 'checked' : ''} ${action('asset.select', args, 'change')} aria-label="${e(t('assets.selectAsset'))}"></td>
        <td><button class="asset-target-link" title="${e([...new Set([asset.host, asset.ip, asset.domain].filter(Boolean))].join(' · '))}" ${action('asset.detail', args)}>${e(targetLabel(asset))}</button></td><td><span class="asset-service" title="${e(svc)}">${e(svc)}</span></td>
        <td>${asset.project_name ? `<span class="asset-project-badge" title="${e(asset.project_name)}">${e(asset.project_name)}</span>` : '<span class="muted">-</span>'}</td><td>${ownership(asset)}</td><td>${e(asset.last_scan_at ? new Date(asset.last_scan_at).toLocaleString() : '-')}</td>
        <td>${count ? `<button class="asset-vulnerability-link" ${action('asset.vulnerabilities', args)}>${count}</button>` : '<span class="muted">0</span>'}</td><td><span class="asset-risk asset-risk--${level.level}">${e(level.label)}</span></td><td><span class="asset-status asset-status--${e(asset.status || 'active')}">${e(t(asset.status === 'inactive' ? 'assets.statusInactive' : 'assets.statusActive'))}</span></td>
        <td class="asset-row-actions"><button class="btn-link" ${action('asset.scan-chat', args)}>${e(t('assets.sendToChatShort'))}</button><button class="btn-link" data-require-permission="asset:write" ${action('asset.edit', args)}>${e(t('common.edit'))}</button><button class="btn-link asset-delete" data-require-permission="asset:delete" ${action('asset.delete', args)}>${e(t('common.delete'))}</button></td></tr>`;
    }).join('') : `<tr><td colspan="10"><div class="asm-empty"><h3>No assets found</h3><p>Adjust your filters or discover assets for this project.</p><button class="btn-secondary" type="button" ${action('asset.reset')}>Reset filters</button> <button class="btn-primary" type="button" data-require-permission="fofa:execute" ${action('asset.discover')}>Discover Assets</button></div></td></tr>`);
    const body = dom.get('asset-table-body'); if (body) deps.applyPermissions(body); updateSelection();
  }
  function renderPagination() {
    const { page, totalPages, total, pageSize } = s, first = page <= 1 || !total, last = page >= totalPages || !total;
    const button = (page: number, key: string, disabled: boolean) => `<button class="btn-secondary" ${action('asset.page', { page })} ${disabled ? 'disabled' : ''}>${e(t('skillsPage.' + key))}</button>`;
    dom.html('asset-pagination', `<div class="pagination"><div class="pagination-info"><span>${e(t('skillsPage.paginationShow', { start: total ? (page - 1) * pageSize + 1 : 0, end: Math.min(page * pageSize, total), total }))}</span><label class="pagination-page-size">${e(t('skillsPage.perPageLabel'))}<select id="asset-page-size-pagination" ${action('asset.page-size', {}, 'change')}>${[10, 20, 50, 100].map(size => `<option value="${size}" ${size === pageSize ? 'selected' : ''}>${size}</option>`).join('')}</select></label></div><div class="pagination-controls">${button(1, 'firstPage', first)}${button(Math.max(1, page - 1), 'prevPage', first)}<span class="pagination-page">${e(t('skillsPage.pageOf', { current: page, total: totalPages }))}</span>${button(Math.min(totalPages, page + 1), 'nextPage', last)}${button(totalPages, 'lastPage', last)}</div></div>`);
    syncSelect('asset-page-size-pagination');
  }
  function populateProjects() {
    for (const [id, key] of [['asset-project-filter', 'assets.allProjects'], ['asset-edit-project', 'assets.unboundProject'], ['asset-batch-project', 'assets.chooseProject']] as const) {
      const current = dom.value(id), active = deps.activeProject();
      const projects = active && !s.projects.some(p => p.id === active) ? [...s.projects, { id: active, name: deps.projectName?.(active) || active }] : s.projects;
      dom.html(id, `<option value="" ${id === 'asset-batch-project' ? 'disabled hidden' : id === 'asset-project-filter' && active ? 'disabled' : ''}>${e(t(key))}</option>` + projects.map(p => `<option value="${e(p.id)}">${e(p.name)}${p.status === 'archived' ? ' · ' + e(t('assets.archived')) : ''}</option>`).join('')); dom.set(id, current); syncSelect(id);
    }
  }
  async function ensureProjects(force = false) { try { await service.projects(force); if (!disposed) populateProjects(); } catch (error) { console.warn('Failed to load asset project options:', error); } }
  async function load(page?: number) {
    if (disposed) return; const sequence = ++loadSequence; workspace.mount(); await ensureProjects(page == null); if (sequence !== loadSequence || disposed) return;
    const project = deps.activeProject();
    if (activeProject !== project || page == null) { activeProject = project; dom.set('asset-project-filter', project); syncSelect('asset-project-filter'); }
    filters();
    dom.html('asset-table-body', `<tr><td colspan="10" class="muted">${e(t('common.loading'))}</td></tr>`);
    const summary = workspace.refresh(page == null);
    try { await service.load(page); if (disposed || sequence !== loadSequence) return; renderRows(); renderPagination(); dom.text('asset-list-meta', t('assets.totalMeta', { count: s.total })); }
    catch (error) { if (disposed || sequence !== loadSequence) return; console.warn(error); s.items = []; s.total = 0; s.totalPages = 1; dom.text('asset-list-meta', ''); dom.html('asset-table-body', `<tr><td colspan="10" class="muted">${e(t('assets.loadFailed'))}. <button class="btn-link" type="button" ${action('asset.load')}>Retry</button></td></tr>`); renderPagination(); }
    await summary;
  }
  async function overview() { deps.switchPage('asset-library'); await load(1); }
  function period(days: number) { const value = [7, 30, 90].includes(days) ? days : 30; if (s.overviewDays === value) return; s.overviewDays = value; doc.querySelectorAll<HTMLElement>('.asset-period-switch button').forEach(el => { const active = Number(el.dataset.days) === value; el.classList.toggle('active', active); el.setAttribute('aria-pressed', String(active)); }); void overview(); }
  function clearSelection() { service.clearSelection(); closeBatchMenu(); renderRows(); }
  function toggleAdvanced() { const panel = dom.get('asset-advanced-filters'); if (panel) { panel.hidden = !panel.hidden; dom.get('asset-advanced-toggle')?.setAttribute('aria-expanded', String(!panel.hidden)); } }
  function resetFilters() { FILTER_IDS.forEach(id => { dom.set(id, id === 'asset-sort-filter' ? 'last_seen_at:desc' : id === 'asset-project-filter' ? deps.activeProject() : ''); syncSelect(id); }); dom.set('asset-saved-view-select', ''); clearSelection(); return load(1); }
  function renderSavedViews(name = '') { dom.html('asset-saved-view-select', `<option value="">${e(t('assets.savedViews'))}</option>` + service.savedViews().map(view => `<option value="${e(view.name)}">${e(view.name)}</option>`).join('')); dom.set('asset-saved-view-select', name); syncSelect('asset-saved-view-select'); }
  function saveView() { const name = deps.prompt('Enter a name for the saved view')?.trim().slice(0, 60); if (!name) return; filters(); if (!service.saveViews([...service.savedViews().filter(view => view.name !== name), { name, values: { ...s.filters } }])) return deps.alert('Failed to save the saved view'); renderSavedViews(name); toast(doc, 'Saved view stored'); }
  function applyView(name: string) { const view = service.savedViews().find(v => v.name === name); if (!view) return; for (const id of FILTER_IDS) if (id in view.values) { dom.set(id, view.values[id] || ''); syncSelect(id); } dom.hidden('asset-advanced-filters', false); dom.get('asset-advanced-toggle')?.setAttribute('aria-expanded', 'true'); clearSelection(); return load(1); }
  function deleteView() { const name = dom.value('asset-saved-view-select'); if (!name || !deps.confirm(`Delete saved view "${name}"?`)) return; if (service.saveViews(service.savedViews().filter(v => v.name !== name))) renderSavedViews(); }
  function closeModal(id: string) { deps.closeSelects(); closeAppModal(id); }
  async function openProjectModal() { if (!s.selected.size) return deps.alert(t('assets.selectAssetsFirst')); await ensureProjects(true); const ids = [...new Set([...s.selected.values()].map(a => a.project_id || ''))]; dom.set('asset-batch-project', ids.length === 1 ? ids[0] || '' : ''); syncSelect('asset-batch-project'); dom.text('asset-project-subtitle', t('assets.bindProjectCount', { count: s.selected.size })); openAppModal('asset-project-modal', { display: 'flex' }); }
  async function projectBinding() { if (!deps.can('asset:write') || !s.selected.size) return; const id = dom.value('asset-batch-project'); if (!id) return deps.alert(t('assets.selectProjectRequired')); dom.busy('asset-project-submit', true); try { const count = s.selected.size; await service.bindProject(id); closeModal('asset-project-modal'); clearSelection(); await load(s.page); toast(doc, t('assets.bindProjectDone', { count })); } catch (error) { deps.alert(t('assets.bindProjectFailed') + ': ' + errorMessage(error)); } finally { dom.busy('asset-project-submit', false); } }
  const bulkFields = { status: 'asset-bulk-status', responsible_person: 'asset-bulk-responsible', department: 'asset-bulk-department', business_system: 'asset-bulk-business', environment: 'asset-bulk-environment', criticality: 'asset-bulk-criticality' };
  function openBulk() { if (!deps.can('asset:write')) return; if (!s.selected.size) return deps.alert('Select assets first'); for (const id of [...Object.values(bulkFields), 'asset-bulk-add-tags', 'asset-bulk-remove-tags']) { dom.set(id, ''); syncSelect(id); } dom.text('asset-bulk-edit-subtitle', `${s.selected.size} assets will be updated; blank fields keep their current value`); openAppModal('asset-bulk-edit-modal'); }
  async function submitBulk() {
    if (!deps.can('asset:write') || !s.selected.size) return;
    const comma = (id: string) => dom.value(id).split(/[,\uff0c]/).map(v => v.trim()).filter(Boolean), add = comma('asset-bulk-add-tags'), remove = comma('asset-bulk-remove-tags');
    const body: Record<string, string | string[]> = { add_tags: add, remove_tags: remove }; for (const [key, id] of Object.entries(bulkFields)) { const value = dom.value(id).trim(); if (value) body[key] = value; }
    if (Object.keys(body).length === 2 && !add.length && !remove.length) return deps.alert('Fill in at least one change');
    dom.busy('asset-bulk-edit-submit', true); try { const count = s.selected.size; await service.bulk(body); closeModal('asset-bulk-edit-modal'); clearSelection(); await load(s.page); toast(doc, `${count} assets updated`); } catch (error) { deps.alert('Bulk edit failed: ' + errorMessage(error)); } finally { dom.busy('asset-bulk-edit-submit', false); }
  }
  async function removeSelected(merge = false) {
    if (!deps.can('asset:delete') || (merge && !deps.can('asset:write'))) return;
    const assets = [...s.selected.values()], primary = assets[0]; if (!primary) return;
    if (merge && assets.length < 2) return deps.alert('Select at least two duplicate assets');
    if (!deps.confirm(merge ? `"${targetLabel(primary)}" will be kept as the primary asset and the other ${assets.length - 1} assets merged into it. Continue?` : `Permanently delete the ${assets.length} selected assets?`)) return;
    try { if (merge) await service.merge(); else await service.deleteSelected(); clearSelection(); await load(1); toast(doc, merge ? `${assets.length} duplicate assets merged` : `${assets.length} assets deleted`); } catch (error) { deps.alert((merge ? 'Merge failed: ' : 'Bulk delete failed: ') + errorMessage(error)); }
  }
  function exportSelected(format: string) { if (!s.selected.size) return deps.alert('Select assets first'); exportAssets(doc, [...s.selected.values()], format, service, t); }
  function openScan(mode: string, index?: number) { const asset = index == null ? undefined : s.items[index], assets = asset ? [asset] : [...s.selected.values()]; if (!assets.length) return deps.alert(t('assets.selectAssetsFirst')); s.scanMode = mode === 'task' ? 'task' : 'chat'; s.scanAssets = assets; const task = s.scanMode === 'task';
    dom.text('asset-scan-title', t(task ? 'assets.createScanTask' : 'assets.sendToChat')); dom.text('asset-scan-subtitle', t('assets.scanAssetCount', { count: assets.length }));
    dom.html('asset-scan-targets', assets.slice(0, 12).map(a => `<span class="asset-scan-target-chip">${e(targetLabel(a))}</span>`).join('') + (assets.length > 12 ? `<span class="muted">+${assets.length - 12}</span>` : ''));
    const placeholders = { asset_id: '{{asset_id}}', target: '{{target}}', host: '{{host}}', ip: '{{ip}}', domain: '{{domain}}', port: '{{port}}' };
    dom.set('asset-scan-prompt', t('assets.defaultScanPrompt', placeholders)); dom.text('asset-scan-hint', t('assets.promptHint', placeholders)); dom.hidden('asset-scan-execute-wrap', !task); dom.text('asset-scan-submit', t(task ? 'assets.confirmCreate' : 'assets.confirmSend')); openAppModal('asset-scan-modal');
  }
  async function submitScan() {
    const assets = s.scanAssets.slice(), template = dom.value('asset-scan-prompt').trim(); if (!assets.length || !template) return deps.alert(t('assets.promptRequired')); dom.busy('asset-scan-submit', true);
    try { if (s.scanMode === 'task') { const execute = dom.get('asset-scan-execute-now'); const queue = await service.createScanTasks(assets, template, execute instanceof HTMLInputElement && execute.checked); deps.switchPage('tasks'); deps.showQueue(queue); }
      else { const id = await service.createScanConversation(assets); deps.switchPage('chat'); await deps.loadConversation(id); const input = doc.querySelector<HTMLTextAreaElement>('#chat-input'); if (input) { input.value = assets.map(a => service.scanPrompt(template, a)).join('\n\n---\n\n'); input.dispatchEvent(new Event('input', { bubbles: true })); } deps.requireExecutionEvidence(); void deps.sendMessage().catch(report); }
      closeModal('asset-scan-modal'); clearSelection(); await load(s.page);
    } catch (error) { deps.alert(t('assets.scanSubmitFailed') + ': ' + errorMessage(error)); } finally { dom.busy('asset-scan-submit', false); }
  }
  function vulnerabilities(index: number) { const asset = s.items[index]; if (asset) deps.setHash(asset.last_scan_task_id ? 'vulnerabilities?task_id=' + encodeURIComponent(asset.last_scan_task_id) : asset.last_scan_conversation_id ? 'vulnerabilities?conversation_id=' + encodeURIComponent(asset.last_scan_conversation_id) : 'vulnerabilities'); }
  const editorFields = { host: 'host', ip: 'ip', domain: 'domain', port: 'port', protocol: 'protocol', server: 'server', project_id: 'project', country: 'country', province: 'province', city: 'city', responsible_person: 'responsible', department: 'department', business_system: 'business', environment: 'environment', criticality: 'criticality', title: 'title-value', status: 'status' } as const;
  function fieldError(id: string, message: string) { dom.get(id)?.setAttribute('aria-invalid', String(!!message)); dom.text(id + '-error', message); dom.hidden(id + '-error', !message); }
  function formError(message: string) { dom.text('asset-editor-form-error', message); dom.hidden('asset-editor-form-error', !message); }
  function clearErrors() { for (const id of ['target', 'host', 'ip', 'domain', 'port', 'protocol']) fieldError('asset-edit-' + id, ''); formError(''); }
  function renderTags() { dom.html('asset-tag-chips', s.editorTags.map((tag, index) => `<span class="asset-tag-chip"><span>${e(tag)}</span><button type="button" ${action('asset.remove-tag', { index })} aria-label="${e(t('assets.removeTag', { tag }))}">×</button></span>`).join('')); }
  function addTags(raw: string) { raw.split(/[,\uff0c]/).map(v => v.trim()).filter(Boolean).forEach(tag => { if (!s.editorTags.includes(tag) && s.editorTags.length < 30) s.editorTags.push(tag); }); dom.set('asset-edit-tags', ''); s.editorDirty = true; renderTags(); }
  function applyTarget(showError = true) { try { const parsed = parseTarget(dom.value('asset-edit-target'), t); for (const [key, value] of Object.entries(parsed)) dom.set('asset-edit-' + key, value || ''); s.editorParsedTarget = dom.value('asset-edit-target').trim(); fieldError('asset-edit-target', ''); return parsed; } catch (error) { if (showError) fieldError('asset-edit-target', errorMessage(error)); return null; } }
  async function openEditor(indexOrAsset?: number | Asset) { if (!deps.can('asset:write')) return; await ensureProjects(true); const asset = typeof indexOrAsset === 'number' ? s.items[indexOrAsset] ?? null : indexOrAsset ?? null; s.editAsset = asset; editorFocus = doc.activeElement; dom.set('asset-edit-id', asset?.id || '');
    for (const [key, suffix] of Object.entries(editorFields) as [keyof typeof editorFields, string][]) dom.set('asset-edit-' + suffix, asset?.[key] || (key === 'status' ? 'active' : key === 'project_id' ? deps.activeProject() : ''));
    dom.set('asset-edit-tags', ''); s.editorTags = [...new Set((asset?.tags || []).map(v => v.trim()).filter(Boolean))]; renderTags();
    ['project', 'status', 'environment', 'criticality'].forEach(suffix => syncSelect('asset-edit-' + suffix)); dom.set('asset-edit-target', editorTarget(asset)); s.editorParsedTarget = dom.value('asset-edit-target').trim(); clearErrors();
    dom.text('asset-editor-title', t(asset ? 'assets.editAssetTitle' : 'assets.addAssetTitle')); dom.text('asset-editor-submit', t(asset ? 'common.save' : 'assets.addAssetAction')); s.editorDirty = false; s.editorBusy = false; editorBusy(false); openAppModal('asset-editor-modal', { focusEl: dom.get('asset-edit-target') });
  }
  function closeEditor(force = false) { if (!force && s.editorDirty && !deps.confirm(t('assets.discardChanges'))) return; closeModal('asset-editor-modal'); s.editorDirty = false; if (editorFocus instanceof HTMLElement) editorFocus.focus(); }
  function editorBusy(busy: boolean) { s.editorBusy = busy; dom.busy('asset-editor-submit', busy); dom.get('asset-editor-submit')?.classList.toggle('asset-editor-submit-busy', busy); }
  function collectEditor(): AssetInput {
    const value = (suffix: string) => dom.value('asset-edit-' + suffix).trim();
    return { host: value('host'), ip: value('ip'), domain: value('domain'), port: Number(value('port') || 0), protocol: value('protocol'), server: value('server'), title: value('title-value'), status: value('status'), source: s.editAsset?.source || 'manual', source_query: s.editAsset?.source_query || '', country: value('country'), province: value('province'), city: value('city'), responsible_person: value('responsible'), department: value('department'), business_system: value('business'), environment: value('environment'), criticality: value('criticality'), project_id: value('project'), tags: s.editorTags.slice() };
  }
  function validateEditor() {
    clearErrors(); const target = dom.value('asset-edit-target').trim();
    try { if (target !== s.editorParsedTarget) { if (!applyTarget()) return false; } else parseTarget(target, t); } catch (error) { fieldError('asset-edit-target', errorMessage(error)); dom.get('asset-edit-target')?.focus(); return false; }
    const fail = (suffix: string, key: string) => { fieldError('asset-edit-' + suffix, t(key)); dom.get('asset-edit-' + suffix)?.focus(); return false; };
    const ip = dom.value('asset-edit-ip').trim(); if (ip && !isIPv4(ip) && !isIPv6(ip)) return fail('ip', 'assets.ipInvalid');
    const domain = dom.value('asset-edit-domain').trim(); if (domain) { const normalized = normalizeDomain(domain); if (!normalized) return fail('domain', 'assets.domainInvalid'); dom.set('asset-edit-domain', normalized); }
    const port = dom.value('asset-edit-port'); if (port && (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)) return fail('port', 'assets.portInvalid');
    const protocol = dom.value('asset-edit-protocol').trim().toLowerCase(); if (protocol && !/^[a-z][a-z0-9+.-]{0,31}$/.test(protocol)) return fail('protocol', 'assets.protocolInvalid'); dom.set('asset-edit-protocol', protocol); return true;
  }
  async function save() { if (!deps.can('asset:write') || s.editorBusy || !validateEditor()) return; if (dom.value('asset-edit-tags').trim()) addTags(dom.value('asset-edit-tags')); const id = dom.value('asset-edit-id'); editorBusy(true);
    try { const result = await service.save(id, collectEditor()); if (disposed) return; closeEditor(true); await load(id ? s.page : 1); const panel = dom.get('project-panel-assets'); if (panel && !panel.hidden) await deps.refreshProjectAssets(); toast(doc, t(id ? 'assets.updatedSuccessfully' : result?.updated ? 'assets.duplicateMerged' : 'assets.createdSuccessfully')); } catch (error) { formError(t('assets.saveFailed') + ': ' + errorMessage(error)); } finally { editorBusy(false); }
  }
  async function remove(index: number) { if (!deps.can('asset:delete')) return; const asset = s.items[index]; if (!asset || !deps.confirm(t('assets.deleteConfirm'))) return; try { await service.delete(asset.id); await load(s.page); } catch (error) { deps.alert(t('assets.deleteFailed') + ': ' + errorMessage(error)); } }
  function detailRecord(asset: Asset) { s.detailAsset = asset; dom.text('asset-detail-subtitle', targetLabel(asset)); const level = risk(asset.risk_level), status = t(asset.status === 'inactive' ? 'assets.statusInactive' : 'assets.statusActive'), location = [asset.country, asset.province, asset.city].filter(Boolean).join(' / '), svc = [asset.protocol, asset.port ? ':' + asset.port : ''].join('');
    const badge = (label: string, value: string, modifier: string) => value ? `<span class="asset-detail-overview-badge asset-detail-overview-badge--${e(modifier)}"><span>${e(label)}</span>${e(value)}</span>` : '';
    const overview = `<section class="asset-detail-overview"><div class="asset-detail-overview-main"><div class="asset-detail-target">${e(targetLabel(asset))}</div><div class="asset-detail-meta-line">${e([asset.ip, asset.domain, svc].filter(Boolean).join(' · ') || '-')}</div></div><div class="asset-detail-overview-badges">${badge(t('assets.status'), status, asset.status === 'inactive' ? 'neutral' : 'success')}${badge(t('assets.riskLevel'), level.label, level.level)}${badge(t('assets.source'), asset.source, 'source')}${badge(t('assets.location'), location, 'location')}</div></section>`;
    const item = (label: string, value: string, wide = false, code = false) => `<div class="asset-detail-item${wide ? ' asset-detail-item--wide' : ''}${code ? ' asset-detail-item--code' : ''}"><span>${e(label)}</span><div>${value || '<span class="muted">-</span>'}</div></div>`;
    const fields: [string, string][] = [['project', asset.project_name || ''], ['status', status], ['host', asset.host], ['ip', asset.ip], ['domain', asset.domain], ['service', svc], ['title', asset.title], ['server', asset.server], ['location', location], ['responsiblePerson', asset.responsible_person], ['department', asset.department], ['businessSystem', asset.business_system], ['environment', asset.environment], ['criticality', asset.criticality], ['source', asset.source]];
    const values = fields.map(([label, value]) => item(label === 'host' ? 'Host' : label === 'ip' ? 'IP' : t('assets.' + label), e(value), label === 'title'));
    values.push(item(t('assets.sourceQuery'), asset.source_query ? `<code>${e(asset.source_query)}</code>` : '', true, true), item(t('assets.tagsLabel'), (asset.tags || []).map(tag => `<span class="asset-tag">${e(tag)}</span>`).join(''), true));
    for (const [key, value] of [['firstSeen', asset.first_seen_at], ['lastSeen', asset.last_seen_at], ['lastScan', asset.last_scan_at]] as const) values.push(item(t('assets.' + key), e(value ? new Date(value).toLocaleString() : '')));
    values.push(item(t('assets.relatedVulnerabilities'), String(Number(asset.vulnerability_count || 0)))); dom.html('asset-detail-grid', overview + `<div class="asset-detail-fields">${values.join('')}</div>`); evidence.mount(asset); const modal = dom.get('asset-detail-modal'); if (modal) deps.applyPermissions(modal); openAppModal('asset-detail-modal', { focusEl: dom.get('asset-evidence-tab-overview') });
  }
  function detail(index: number) { const asset = s.items[index]; if (asset) detailRecord(asset); }
  function editDetail() { const asset = s.detailAsset; closeModal('asset-detail-modal'); if (asset) return openEditor(asset); }
  function importError(message: string) { dom.text('asset-import-error', message); dom.hidden('asset-import-error', !message); }
  function importBusy(busy: boolean) { s.importBusy = busy; dom.busy('asset-import-submit', busy || !s.importRows.some(row => !row.error)); dom.busy('asset-import-dropzone', busy); }
  function resetImport() { ++importSequence; s.importRows = []; s.importFileName = ''; dom.set('asset-import-file', ''); dom.text('asset-import-file-name', t('assets.fileNotSelected')); dom.hidden('asset-import-preview-section', true); dom.html('asset-import-preview-body', ''); importError(''); importBusy(false); }
  async function openImport() { if (!deps.can('asset:write')) return; importFocus = doc.activeElement; await ensureProjects(true); resetImport(); openAppModal('asset-import-modal', { focusEl: dom.get('asset-import-dropzone') }); }
  function closeImport(force = false) { if (s.importBusy && !force) return; ++importSequence; closeAppModal('asset-import-modal'); if (importFocus instanceof HTMLElement) importFocus.focus(); }
  function renderImportPreview() { const rows = s.importRows, valid = rows.filter(row => !row.error).length; dom.hidden('asset-import-preview-section', false); dom.text('asset-import-summary', t('assets.importPreviewSummary', { total: rows.length, valid, invalid: rows.length - valid }));
    dom.html('asset-import-preview-body', rows.slice(0, 100).map(row => { const target = row.values.target || row.values.host || row.values.domain || row.values.ip || '-'; return `<tr class="${row.error ? 'has-error' : ''}"><td>${row.rowNumber}</td><td title="${e(target)}">${e(target)}</td><td>${e(row.projectName || row.values.project || '-')}</td><td>${e(row.asset?.status || row.values.status || '-')}</td><td><span class="asset-import-result asset-import-result--${row.error ? 'error' : 'ok'}">${e(row.error || t('assets.validationPassed'))}</span></td></tr>`; }).join(''));
    dom.text('asset-import-preview-note', rows.length > 100 ? t('assets.previewLimited', { count: rows.length }) : ''); dom.text('asset-import-submit', t('assets.importValidRowsCount', { count: valid })); dom.busy('asset-import-submit', !valid || s.importBusy);
  }
  async function handleImportFile(file?: File) { if (!file || s.importBusy) return; const sequence = ++importSequence; importError(''); s.importRows = []; s.importFileName = ''; dom.hidden('asset-import-preview-section', true); dom.text('asset-import-file-name', file.name); importBusy(false);
    if (!/\.(xlsx|csv)$/i.test(file.name)) return importError(t('assets.fileTypeInvalid')); if (file.size > IMPORT_MAX_BYTES) return importError(t('assets.fileTooLarge')); importBusy(true);
    try { const matrix = await readImportFile(file); if (sequence !== importSequence || disposed) return; service.parseImport(matrix, file.name); renderImportPreview(); } catch (error) { if (sequence === importSequence) importError(errorMessage(error) || t('assets.fileParseFailed')); } finally { if (sequence === importSequence) importBusy(false); }
  }
  async function submitImport() { if (!deps.can('asset:write') || s.importBusy || !s.importRows.some(row => !row.error)) return; importError(''); importBusy(true); try { const result = await service.submitImport(), invalid = s.importRows.filter(row => row.error).length; closeImport(true); await load(1); toast(doc, t('assets.bulkImportDone', { created: result.created, updated: result.updated, skipped: result.skipped + invalid })); } catch (error) { importError(t('assets.importFailed') + ': ' + errorMessage(error)); } finally { importBusy(false); } }
  const index = (el: HTMLElement) => el.dataset.index == null ? undefined : Number(el.dataset.index);
  const checked = (el: HTMLElement) => el instanceof HTMLInputElement && el.checked;
  const handlers: Record<string, ActionHandler> = {
    ...workspace.handlers, ...evidence.handlers,
    'asset.discover': () => deps.switchPage('info-collect'),
    'asset.project-context': () => { const project = dom.value('asset-project-filter'); if (deps.setActiveProject && project !== deps.activeProject()) deps.setActiveProject(project); else return load(1); },
    'asset.library': () => deps.switchPage('asset-library'), 'asset.overview': () => overview(), 'asset.period': el => period(Number(el.dataset.days)), 'asset.load': () => load(), 'asset.search': () => load(1), 'asset.search-key': (_el, event) => { if (event instanceof KeyboardEvent && event.key === 'Enter') return load(1); },
    'asset.page': el => load(Number(el.dataset.page)), 'asset.page-size': () => { service.setPageSize(Number(dom.value('asset-page-size-pagination'))); return load(1); }, 'asset.advanced': toggleAdvanced, 'asset.reset': resetFilters,
    'asset.save-view': saveView, 'asset.apply-view': el => applyView(el instanceof HTMLSelectElement ? el.value : ''), 'asset.delete-view': deleteView,
    'asset.select': el => { service.select(Number(el.dataset.index), checked(el)); updateSelection(); }, 'asset.select-page': el => { service.selectPage(checked(el)); renderRows(); }, 'asset.clear': clearSelection,
    'asset.select-all': async () => { filters(); dom.busy('asset-select-all-results', true); try { await service.selectAll(); renderRows(); } finally { dom.busy('asset-select-all-results', false); } },
    'asset.project': openProjectModal, 'asset.bind-project': projectBinding, 'asset.close-project': () => closeModal('asset-project-modal'), 'asset.bulk': openBulk, 'asset.submit-bulk': submitBulk, 'asset.close-bulk': () => closeModal('asset-bulk-edit-modal'),
    'asset.export-csv': () => { closeBatchMenu(); exportSelected('csv'); }, 'asset.export-xlsx': () => { closeBatchMenu(); exportSelected('xlsx'); }, 'asset.delete-selected': () => { closeBatchMenu(); return removeSelected(); }, 'asset.merge': () => { closeBatchMenu(); return removeSelected(true); },
    'asset.scan-chat': el => { closeBatchMenu(); openScan('chat', index(el)); }, 'asset.scan-task': () => openScan('task'), 'asset.submit-scan': submitScan, 'asset.close-scan': () => closeModal('asset-scan-modal'), 'asset.vulnerabilities': el => vulnerabilities(Number(el.dataset.index)),
    'asset.edit': el => openEditor(index(el)), 'asset.close-editor': () => closeEditor(), 'asset.save': save, 'asset.delete': el => remove(Number(el.dataset.index)), 'asset.remove-tag': el => { s.editorTags.splice(Number(el.dataset.index), 1); s.editorDirty = true; renderTags(); },
    'asset.detail': el => detail(Number(el.dataset.index)), 'asset.close-detail': () => { evidence.cancel(); closeModal('asset-detail-modal'); }, 'asset.edit-detail': editDetail,
    'asset.import': openImport, 'asset.close-import': () => closeImport(), 'asset.template-csv': () => downloadTemplate(doc, 'csv', t), 'asset.template-xlsx': () => downloadTemplate(doc, 'xlsx', t), 'asset.choose-file': () => dom.get('asset-import-file')?.click(), 'asset.file': el => handleImportFile(el instanceof HTMLInputElement ? el.files?.[0] : undefined), 'asset.submit-import': submitImport,
  };
  function activate() {
    if (activated || disposed) return; activated = true;
    workspace.mount();
    projectOff = deps.onProjectChange?.(() => { const project = deps.activeProject(); if (project === activeProject) return; activeProject = project; dom.set('asset-project-filter', project); syncSelect('asset-project-filter'); clearSelection(); evidence.cancel(); closeModal('asset-detail-modal'); if (dom.get('page-asset-library')?.classList.contains('active')) void load(1); });
    const modals: [string, () => void][] = [['asset-import-modal', () => closeImport()], ['asset-project-modal', () => closeModal('asset-project-modal')], ['asset-bulk-edit-modal', () => closeModal('asset-bulk-edit-modal')], ['asset-scan-modal', () => closeModal('asset-scan-modal')], ['asset-editor-modal', () => closeEditor()], ['asset-detail-modal', () => closeModal('asset-detail-modal')]];
    for (const [id, close] of modals) { const modal = dom.get(id); modal?.addEventListener('click', event => { if (event.target === modal) close(); }, { signal: abort.signal }); }
    bindActions(doc, abort.signal, handlers, report); selectIds.forEach(syncSelect); renderSavedViews();
    dom.on('click', event => { const menu = dom.get('asset-batch-more'); if (menu instanceof HTMLDetailsElement && menu.open && event.target instanceof Node && !menu.contains(event.target)) closeBatchMenu(); });
    dom.on('languagechange', () => { selectIds.forEach(syncSelect); renderSavedViews(dom.value('asset-saved-view-select')); if (dom.get('page-asset-library')?.classList.contains('active')) { renderRows(); renderPagination(); } });
    const form = dom.get('asset-editor-form'), target = dom.field('asset-edit-target'), tags = dom.field('asset-edit-tags');
    form?.addEventListener('input', event => { if (event.target !== tags) s.editorDirty = true; if (event.target === target) fieldError('asset-edit-target', ''); formError(''); }, { signal: abort.signal });
    target?.addEventListener('blur', () => { if (target.value.trim()) applyTarget(); }, { signal: abort.signal });
    tags?.addEventListener('keydown', event => { if (!(event instanceof KeyboardEvent)) return; if ((event.key === 'Enter' || event.key === ',') && tags.value.trim()) { event.preventDefault(); addTags(tags.value); } else if (event.key === 'Backspace' && !tags.value && s.editorTags.length) { s.editorTags.pop(); s.editorDirty = true; renderTags(); } }, { signal: abort.signal });
    tags?.addEventListener('blur', () => { if (tags.value.trim()) addTags(tags.value); }, { signal: abort.signal });
    dom.on('keydown', event => { if (event.key === 'Escape') closeBatchMenu(); if (!isAppModalOpen('asset-editor-modal')) return; if (event.key === 'Escape') { event.preventDefault(); closeEditor(); } if (event.key !== 'Tab' || !form) return; const focusable = [...form.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')].filter(el => !el.hidden && el.offsetParent !== null), first = focusable[0], last = focusable[focusable.length - 1]; if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first?.focus(); } });
    dom.on('keydown', event => {
      if (!isAppModalOpen('asset-detail-modal')) return;
      if (event.key === 'Escape') { event.preventDefault(); evidence.cancel(); closeModal('asset-detail-modal'); return; }
      if (event.key !== 'Tab') return;
      const focusable = [...(dom.get('asset-detail-modal')?.querySelectorAll<HTMLElement>('button:not([disabled]):not([tabindex="-1"]), a[href]') || [])].filter(el => el.offsetParent !== null);
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first?.focus(); }
    });
    const drop = dom.get('asset-import-dropzone'); for (const type of ['dragenter', 'dragover', 'dragleave', 'drop']) drop?.addEventListener(type, event => { event.preventDefault(); drop.classList.toggle('is-dragging', type === 'dragenter' || type === 'dragover'); if (type === 'drop' && event instanceof DragEvent) void handleImportFile(event.dataTransfer?.files[0]); }, { signal: abort.signal });
  }
  return { activate, load, overview, period, renderRows, clearSelection, closeBatchMenu, toggleAdvanced, resetFilters, saveView, applyView, deleteView, openProjectModal, projectBinding, openBulk, submitBulk, removeSelected, exportSelected, openScan, submitScan, vulnerabilities, openEditor, closeEditor, save, remove, detail, detailRecord, editDetail, openImport, closeImport, handleImportFile, submitImport, closeModal, handlers,
    dispose() { disposed = true; ++importSequence; ++loadSequence; projectOff?.(); workspace.dispose(); abort.abort(); for (const id of ['asset-import-modal', 'asset-project-modal', 'asset-bulk-edit-modal', 'asset-scan-modal', 'asset-editor-modal', 'asset-detail-modal']) closeAppModal(id); },
  };
}
export type AssetsView = ReturnType<typeof createAssetsView>;
