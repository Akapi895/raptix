import { bindSettingsStaticActions } from './actions';
import { errorMessage } from './contracts';
import { createSettingsForms, MODEL_IDS } from './forms';
import { getPath, getToolKey, normalizeAIChannelId, object, ROBOTS, setPath, text, validateSelectedAIChannelPayload, type AIChannel, type ConfigObject, type Credentials, type MCPData, type ModelScope, type RobotAuth } from './model';
import { openAppModal, closeAppModal } from '../../ui/modal';
import { openCapabilityModal } from '../../ui/capabilities';
import type { SettingsService } from './service';
import type { SettingsSelects } from './selects';
import type { SettingsDependencies } from './types';
import type { SettingsView } from './view';

export function createSettingsController(deps: SettingsDependencies, service: SettingsService, view: SettingsView, selects: SettingsSelects) {
  const { doc, t } = deps, { state } = service, forms = createSettingsForms(doc);
  const cleanup: (() => void)[] = [], timers = new Set<ReturnType<typeof setTimeout>>();
  let activated = false, disposed = false, pollTimer: ReturnType<typeof setInterval> | undefined, toolSequence = 0, mcpEditSequence = 0;
  const live = () => !disposed && !service.disposed;
  function later(callback: () => void, ms = 0) { const timer = setTimeout(() => { timers.delete(timer); if (live()) callback(); }, ms); timers.add(timer); }
  function on(target: EventTarget, name: string, handler: EventListener) { target.addEventListener(name, handler); cleanup.push(() => target.removeEventListener(name, handler)); }
  const report = (error: unknown) => { if (live()) deps.alert(errorMessage(error)); };
  const run = (task: Promise<unknown> | void) => { if (task) void task.catch(report); };
  function syncC2NavFromConfig(config: ConfigObject) {
    if (!live()) return; const enabled = !!config.c2 && object(config.c2).enabled !== false;
    const nav = view.el('nav-c2'), tab = view.el('dashboard-access-tab-c2'); if (nav) nav.style.display = enabled ? '' : 'none'; if (tab) tab.hidden = !enabled;
    deps.browser.c2Enabled(enabled); deps.syncDashboardAccessTabs();
  }
  async function syncC2NavOnceFromServer() { const config = await service.syncC2Once(); if (config && live()) syncC2NavFromConfig(config); }
  function switchSettingsSection(section: string) {
    if (!live()) return; if (section === 'rbac') { deps.navigate('dashboard'); return; }
    const panel = view.el(`settings-section-${section}`); if (!panel) return;
    deps.browser.settingsHash(section);
    doc.querySelectorAll<HTMLElement>('.settings-nav-item').forEach(node => {
      const active = node.dataset.section === section;
      node.classList.toggle('active', active);
      if (active) node.setAttribute('aria-current', 'page'); else node.removeAttribute('aria-current');
    });
    doc.querySelectorAll<HTMLElement>('.settings-section-content').forEach(node => node.classList.toggle('active', node === panel)); selects.init(panel);
    if (section === 'token-usage') deps.section('token-usage'); else deps.stopTokenUsage();
    if (section === 'robots') deps.section('robots');
    if (section === 'terminal' || section === 'audit' || section === 'storage') later(() => deps.section(section));
  }
  function initModelListControls() { for (const ids of Object.values(MODEL_IDS)) selects.enhanceModel(ids.selectId); syncModelListFetchButtons(); }
  function writeAIChannelToMainForm(id: string) {
    const ai = service.config().ai; state.selectedChannel = ai.channels[id] ? id : ai.default_channel; forms.fillChannel(ai.channels[state.selectedChannel] || {}, state.selectedChannel);
    initModelListControls(); selects.refresh(); view.channels();
  }
  function readAIChannelFromMainForm(id: string): AIChannel { return forms.readChannel(service.config().ai.channels[id] || {}, id); }
  function syncAIChannelEditorPreview() {
    if (!state.config?.ai.channels[state.selectedChannel]) return; service.editChannel(state.selectedChannel, readAIChannelFromMainForm(state.selectedChannel)); view.channels();
  }
  function selectAIChannelForEditing(id: string) { if (!state.config) return; syncAIChannelEditorPreview(); writeAIChannelToMainForm(normalizeAIChannelId(id)); }
  async function loadConfig(loadTools = true, options: { silent?: boolean } = {}) {
    try {
      if (!await service.loadConfig() || !live()) return; const config = service.config();
      forms.fill(config); writeAIChannelToMainForm(state.selectedChannel); syncVisionFormEnabled(); syncHitlAuditBackendUI();
      syncC2NavFromConfig(config);
      refreshRobotManager(); if (state.activeRobot) loadRobotAuthPolicyEditor(state.activeRobot); selects.init(); selects.refresh(); view.channels(true);
      if (loadTools) { state.search = ''; await loadToolsList(1, ''); }
    } catch (error) { if (live()) { if (!options.silent) deps.notifyError(t('settings.apply.loadFailed') + ': ' + errorMessage(error)); throw error; } }
  }
  async function openSettings() { deps.navigate('settings'); service.resetTools(); await loadConfig(false); if (!live()) return; doc.querySelectorAll('.form-group input').forEach(node => node.classList.remove('error')); deps.navigateSection('basic'); await loadExternalMCPs(); }
  function closeSettings() { if (live()) deps.navigate('chat'); }
  function saveCurrentPageToolStates() {
    doc.querySelectorAll<HTMLElement>('#tools-list .tool-item').forEach(item => { const checkbox = item.querySelector<HTMLInputElement>(':scope > input[type="checkbox"]'); const key = item.dataset.toolKey; if (key && checkbox) service.setTool(key, checkbox.checked, { name: item.dataset.toolName || key.split('::').pop() || key, enabled: checkbox.checked, is_external: item.dataset.isExternal === 'true', external_mcp: item.dataset.externalMcp || '' }); });
  }
  async function loadToolsList(page = 1, keyword = '', options: { refreshExternal?: boolean } = {}) {
    if (!live()) return; const seq = ++toolSequence; saveCurrentPageToolStates(); view.toolLoading();
    try { if (!await service.loadTools(page, keyword, options.refreshExternal) || !live()) return; view.toolList(); view.pagination(); view.filterChip(); }
    catch (error) { if (live() && seq === toolSequence) view.toolError(t(error instanceof Error && error.name === 'AbortError' ? 'mcp.loadToolsTimeout' : 'mcp.loadToolsFailed') + ': ' + errorMessage(error)); }
    finally { if (live() && seq === toolSequence) view.el('tools-list')?.removeAttribute('aria-busy'); }
  }
  function searchTools() { return loadToolsList(1, forms.value('tools-search')); }
  function clearSearch() { forms.writeValue('tools-search', ''); return loadToolsList(1, ''); }
  function filterToolsByStatus(status: string) { state.status = status; doc.querySelectorAll<HTMLElement>('.tools-status-filter .btn-filter').forEach(node => node.classList.toggle('active', node.dataset.filter === status)); return loadToolsList(1, state.search); }
  async function changeToolsPageSize(value?: number) {
    const size = value ?? Number(forms.value('tools-page-size') || forms.value('tools-page-size-pagination')); if (!service.setPageSize(size)) return;
    forms.writeValue('tools-page-size', size); forms.writeValue('tools-page-size-pagination', size); await loadToolsList(1, state.search);
  }
  function selectTools(enabled: boolean) { for (const tool of state.tools) service.setTool(getToolKey(tool), enabled, tool); doc.querySelectorAll<HTMLInputElement>('#tools-list .tool-item > input[type="checkbox"]').forEach(node => node.checked = enabled); view.toolStats(); }
  function handleToolCheckboxChange(key: string, enabled: boolean) { service.setTool(key, enabled); view.toolStats(); }
  function handleToolAlwaysVisibleChange(key: string, enabled: boolean) { service.setAlwaysVisible(key, enabled); view.toolStats(); }
  async function toggleToolDetail(info: HTMLElement, key: string, external: boolean, mcp: string, event?: Event) {
    if (event?.target instanceof Element && event.target.closest('input,label,.external-tool-badge,button,a') && !event.target.closest('.cap-schema-toggle')) return;
    const detail = info.querySelector<HTMLElement>('.tool-item-detail'), icon = info.querySelector('.tool-expand-icon'); if (!detail) return;
    const opened = detail.dataset.open === '1'; detail.style.display = opened ? 'none' : 'block'; detail.dataset.open = opened ? '0' : '1'; if (icon) icon.textContent = opened ? '▶' : '▼';
    info.querySelector('.cap-schema-toggle')?.setAttribute('aria-expanded', String(!opened));
    if (opened || detail.dataset.rendered) return; detail.dataset.rendered = '1'; const description = info.querySelector('.tool-item-desc')?.textContent || ''; view.schema(detail, description);
    try { const schema = await service.client.schema(external && mcp ? key.slice(key.indexOf('::') + 2) : key, external ? mcp : ''); if (live() && detail.isConnected) view.schema(detail, description, schema); }
    catch { if (live() && detail.isConnected) { delete detail.dataset.rendered; view.schema(detail, description, undefined, true); } }
  }
  function scrollToExternalMCP(name: string, event?: Event) {
    event?.stopPropagation(); const card = [...doc.querySelectorAll<HTMLElement>('.external-mcp-item')].find(node => node.dataset.mcpName === name); if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' }); card.classList.add('highlight'); later(() => card.classList.remove('highlight'), 2000);
  }
  function highlightExternalMcpTools(name: string) {
    const list = doc.querySelector('.mcp-tools-panel .tools-list'); if (list) list.scrollTop = 0;
    doc.querySelectorAll<HTMLElement>('#tools-list .tool-item').forEach(node => { const matches = node.dataset.externalMcp === name; node.classList.toggle('highlight', matches); if (matches) later(() => node.classList.remove('highlight'), 2000); });
    [...doc.querySelectorAll<HTMLElement>('#tools-list .tool-item')].find(node => node.dataset.externalMcp === name)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  async function scrollToExternalMCPTools(name: string, event?: Event) {
    if (event?.target instanceof Element && event.target.closest('.external-mcp-item-actions,button,a,input,label') && !event.target.closest('[data-settings-action="tools-source"]')) return;
    event?.stopPropagation(); state.externalFilter = state.externalFilter === name ? '' : name; view.filterChip(); await loadToolsList(1, state.search); if (live() && state.externalFilter) highlightExternalMcpTools(name);
  }
  async function clearExternalMcpFilter() { state.externalFilter = ''; view.filterChip(); await loadToolsList(1, state.search); }
  async function saveToolsConfig() { if (!deps.can('config:write')) return; saveCurrentPageToolStates(); try { await service.saveTools(); if (!live()) return; deps.alert(t('mcp.toolsConfigSaved')); await loadToolsList(state.pagination.page, state.search); } catch (error) { if (live()) deps.alert(t('mcp.saveToolsConfigFailed') + ': ' + errorMessage(error)); } }
  async function applySettings() {
    if (!deps.can('config:write')) return; doc.querySelectorAll('.form-group input').forEach(node => node.classList.remove('error'));
    const missing = ['openai-api-key', 'openai-base-url', 'openai-model'].filter(id => !forms.value(id));
    for (const id of missing) view.el(id)?.classList.add('error'); if (missing.length) { deps.alert(t('settings.apply.fillRequired')); return; }
    const vision = forms.readVision(); if (vision.enabled && !vision.model) { view.el('vision-model')?.classList.add('error'); deps.alert(t('settingsBasic.visionModelRequired')); return; }
    syncAIChannelEditorPreview(); const config = service.config(); const id = state.selectedChannel; config.ai.default_channel = id;
    const patch = forms.collect(config); patch.ai = config.ai;
    if (state.activeRobot) state.robotDrafts.set(state.activeRobot, forms.readAuth());
    for (const robot of ROBOTS) setPath(patch, `robots.${robot}.auth`, state.robotDrafts.get(robot) || getPath(config, `robots.${robot}.auth`) || { mode: 'user_binding' });
    setPath(patch, 'multi_agent.tool_search_always_visible_tools', service.alwaysVisibleForSave()); saveCurrentPageToolStates();
    try { const fresh = await service.applySettings(patch); if (!live()) return; syncC2NavFromConfig(fresh); deps.alert(t('settings.apply.applySuccess')); try { await deps.refreshChatConfig(); } catch (error) { console.warn('refresh chat configuration after settings', error); } if (live()) { deps.populateChatChannels(fresh.ai); closeSettings(); } }
    catch (error) { if (live()) deps.alert(t('settings.apply.applyFailed') + ': ' + errorMessage(error)); }
  }
  async function persistAIChannelsToServer(message: string, options: { mergeLatest?: boolean } = {}) {
    if (!deps.can('config:write')) return false; syncAIChannelEditorPreview(); view.saveHint(t('settingsBasic.aiChannelSaving'));
    try { const config = await service.persistAI(options.mergeLatest !== false, true); if (!live()) return false; writeAIChannelToMainForm(state.selectedChannel); deps.populateChatChannels(config.ai); view.saveHint(message || 'Channel saved'); return true; }
    catch (error) { if (live()) { view.saveHint(errorMessage(error), false); deps.alert(errorMessage(error)); } return false; }
  }
  async function persistAIConfigOnlyToServer(message: string) {
    if (!deps.can('config:write')) return false; view.saveHint(t('settingsBasic.aiChannelSaving'));
    try { const config = await service.persistAI(false, false); if (!live()) return false; writeAIChannelToMainForm(state.selectedChannel); deps.populateChatChannels(config.ai); view.saveHint(message || 'Channel saved'); return true; }
    catch (error) { if (live()) { view.saveHint(errorMessage(error), false); deps.alert(errorMessage(error)); } return false; }
  }
  function createAIChannelFromForm() { syncAIChannelEditorPreview(); const id = service.newChannel(t('settingsBasic.aiChannelUntitled')); writeAIChannelToMainForm(id); view.saveHint(t('settingsBasic.aiChannelNewUnsaved')); }
  function copyAIChannelFromForm() { if (!state.config) return; const source = readAIChannelFromMainForm(state.selectedChannel); const id = service.newChannel('', source); writeAIChannelToMainForm(id); view.saveHint(t('settingsBasic.aiChannelCopyUnsaved')); }
  async function setSelectedAIChannelDefault() { syncAIChannelEditorPreview(); service.config().ai.default_channel = state.selectedChannel; return persistAIChannelsToServer(t('settingsBasic.aiChannelDefaultSaved')); }
  async function deleteSelectedAIChannel() {
    if (!state.config || !deps.can('config:write')) return; const id = state.selectedChannel, channel = state.config.ai.channels[id] || {};
    if (Object.keys(state.config.ai.channels).length <= 1) { deps.alert('At least one AI channel must remain'); return; }
    if (!deps.confirm(t('settingsBasic.aiChannelDeleteConfirm').replace('{name}', channel.name || id))) return;
    service.removeChannels([id], false); writeAIChannelToMainForm(state.selectedChannel); await persistAIConfigOnlyToServer(t('settingsBasic.aiChannelDeleted'));
  }
  async function deleteCheckedAIChannels() {
    if (!state.config || !deps.can('config:write')) return; const ai = state.config.ai;
    const ids = [...state.selectedChannels].filter(id => ai.channels[id]); if (!ids.length) { deps.alert('Select the channels to delete first'); return; }
    const deletable = ids.filter(id => id !== ai.default_channel); if (!deletable.length) { deps.alert('The default channel cannot be bulk-deleted. Switch the default channel first.'); return; }
    if (!deps.confirm(`Delete ${deletable.length} AI channels?\n${deletable.map(id => ai.channels[id]?.name || id).join(', ')}`)) return;
    service.removeChannels(deletable, true); writeAIChannelToMainForm(state.selectedChannel); await persistAIConfigOnlyToServer(`Deleted ${deletable.length} channels`);
  }
  function selectedOrAllAIChannelIdsForProbe() { syncAIChannelEditorPreview(); const ai = service.config().ai; const checked = [...state.selectedChannels].filter(id => ai.channels[id]); return (checked.length ? checked : Object.keys(ai.channels).sort()).filter(id => !validateSelectedAIChannelPayload(ai.channels[id] || {})); }
  async function probeSelectedAIChannels() {
    if (!deps.can('config:write')) return; const ids = selectedOrAllAIChannelIdsForProbe(); if (!ids.length) { deps.alert(t('settingsBasic.aiChannelProbeNoComplete')); return; }
    view.saveHint(t('settingsBasic.aiChannelProbing').replace('{count}', String(ids.length))); const count = await service.probeChannels(ids, () => { if (live()) view.channels(); });
    if (live()) view.saveHint(t('settingsBasic.aiChannelProbeDone').replace('{ok}', String(count)).replace('{total}', String(ids.length)), count === ids.length);
  }
  function syncVisionFormEnabled() {
    const enabled = forms.checked('vision-enabled'), panel = view.el('vision-fields-panel'); if (!panel) return; panel.style.opacity = enabled ? '1' : '0.55';
    panel.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input,select,textarea').forEach(node => { if (node.id !== 'vision-model-select') node.disabled = !enabled; }); syncModelListFetchButtons(); selects.refresh();
  }
  function isHitlAuditTypeSafe() { return ['typesafe', 'jev'].includes(forms.value('hitl-audit-backend').toLowerCase()); }
  function syncHitlAuditBackendUI() {
    const typeSafe = isHitlAuditTypeSafe(); const provider = view.el('hitl-audit-openai-provider-group'); if (provider) provider.style.display = typeSafe ? 'none' : '';
    for (const id of ['hitl-audit-model-typesafe-hint', 'hitl-audit-prompt-typesafe-hint']) { const node = view.el(id); if (node) node.hidden = !typeSafe; }
    const openaiHint = view.el('hitl-audit-model-openai-hint'); if (openaiHint) openaiHint.hidden = typeSafe;
    for (const [id, key] of [['hitl-audit-model-base-url', 'BaseUrl'], ['hitl-audit-model-api-key', 'ApiKey'], ['hitl-audit-model-name', 'Name']]) { const node = forms.control(id!); if (node && !(node instanceof HTMLSelectElement)) node.placeholder = t(`settings.hitl.auditModel${typeSafe ? 'TypeSafe' : ''}${key}Placeholder`); }
    syncModelListFetchButtons();
  }
  function syncModelListFetchButtons() {
    for (const [scope, ids] of Object.entries(MODEL_IDS) as [ModelScope, typeof MODEL_IDS[ModelScope]][]) {
      const claude = forms.credentials(scope).provider === 'claude', hidden = claude || (scope === 'hitlAudit' && isHitlAuditTypeSafe()); const button = view.el(ids.buttonId), hint = view.el(ids.hintId);
      if (button) button.style.display = hidden ? 'none' : ''; selects.modelVisible(ids.selectId, !hidden);
      if (hint) { hint.textContent = claude ? t('settingsBasic.modelsListClaudeHint') : ''; hint.style.display = claude ? '' : 'none'; }
    }
  }
  function populateModelSelect(scope: ModelScope, models: string[], currentValue?: string) {
    const ids = MODEL_IDS[scope], select = forms.control(ids.selectId); if (!(select instanceof HTMLSelectElement)) return;
    const current = currentValue || forms.value(ids.inputId); select.replaceChildren(); const placeholder = doc.createElement('option'); placeholder.value = ''; placeholder.disabled = true; placeholder.textContent = t('settingsBasic.modelsListSelectPlaceholder'); select.append(placeholder);
    const unique = [...new Set(models.map(value => value.trim()).filter(Boolean))]; for (const model of unique) { const option = doc.createElement('option'); option.value = model; option.textContent = model; select.append(option); }
    select.value = unique.includes(current) ? current : ''; selects.enhanceModel(ids.selectId); selects.syncModel(ids.selectId);
  }
  function resultMessage(id: string, message: string, success?: boolean) { const node = view.el(id); if (!node) return; node.textContent = message; node.style.color = success === undefined ? 'var(--text-muted, #718096)' : success ? 'var(--success-color, #38a169)' : 'var(--error-color, #e53e3e)'; }
  async function fetchModelList(scope: ModelScope = 'openai') {
    if (!Object.hasOwn(MODEL_IDS, scope)) scope = 'openai'; const ids = MODEL_IDS[scope]; const credentials: Credentials = { ...forms.credentials(scope), credential_scope: scope };
    if (scope === 'openai' || !forms.value(ids.keyId)) credentials.channel_id = state.selectedChannel;
    if (credentials.provider === 'claude') { resultMessage(ids.resultId, t('settingsBasic.modelsListClaudeHint')); return; }
    if (!credentials.api_key) { resultMessage(ids.resultId, t('settingsBasic.modelsListNeedApiKey'), false); return; }
    const button = view.el(ids.buttonId); view.busy(button, true); resultMessage(ids.resultId, t('settingsBasic.modelsListFetching'));
    try { const result = await service.client.models(credentials); if (!live()) return; if (!result.success) { resultMessage(ids.resultId, t(result.supported === false ? 'settingsBasic.modelsListClaudeHint' : 'settingsBasic.modelsListFailed') + ': ' + (result.error || ''), false); return; } populateModelSelect(scope, result.models || []); resultMessage(ids.resultId, t('settingsBasic.modelsListSuccess').replace('{count}', String(result.count ?? result.models?.length ?? 0)), true); }
    catch (error) { if (live()) resultMessage(ids.resultId, t('settingsBasic.modelsListFailed') + ': ' + errorMessage(error), false); }
    finally { if (live()) view.busy(button, false); }
  }
  async function testOpenAIConnection() {
    const id = state.selectedChannel || service.config().ai.default_channel, channel = readAIChannelFromMainForm(id); service.editChannel(id, channel);
    if (validateSelectedAIChannelPayload(channel)) { state.probes.set(id, { status: 'failed', message: t('settingsBasic.testFillRequired') }); view.channels(); return; }
    const fingerprint = JSON.stringify(channel); const button = view.el('test-openai-btn'); view.busy(button, true); state.probes.set(id, { status: 'testing', message: t('settingsBasic.testing') }); view.channels();
    try { const result = await service.client.test('openai', { provider: channel.provider, channel_id: id, base_url: channel.base_url, api_key: channel.api_key, model: channel.model }); if (!live() || JSON.stringify(state.config?.ai.channels[id]) !== fingerprint) return; state.probes.set(id, { status: result.success ? 'ready' : 'failed', message: result.success ? t('settingsBasic.testSuccess') + (result.model ? ` [${result.model}]` : '') + (result.latency_ms ? ` (${result.latency_ms}ms)` : '') : result.error || 'Unknown error' }); }
    catch (error) { if (live() && JSON.stringify(state.config?.ai.channels[id]) === fingerprint) state.probes.set(id, { status: 'failed', message: errorMessage(error) }); }
    finally { if (live()) { view.channels(); view.busy(button, false); } }
  }
  function collectHitlAuditModelEffectiveConfig() { return { ...forms.credentials('hitlAudit'), model: forms.value('hitl-audit-model-name') || forms.value('openai-model') }; }
  async function testSecondary(kind: 'vision' | 'hitlAudit') {
    const vision = forms.readVision(), typeSafe = kind === 'hitlAudit' && isHitlAuditTypeSafe(); const cfg: Credentials = collectHitlAuditModelEffectiveConfig();
    const resultId = kind === 'vision' ? 'test-vision-result' : 'test-hitl-audit-model-result', button = view.el(kind === 'vision' ? 'test-vision-btn' : 'test-hitl-audit-model-btn');
    if (kind === 'vision' && (!text(vision.api_key || forms.value('openai-api-key')) || !vision.model)) { resultMessage(resultId, t('settingsBasic.visionTestFillRequired'), false); return; }
    if (kind === 'hitlAudit' && (typeSafe ? !forms.value('hitl-audit-model-api-key') : !cfg.base_url || !cfg.api_key || !cfg.model)) { resultMessage(resultId, t(typeSafe ? 'settings.hitl.testTypeSafeFillRequired' : 'settingsBasic.testFillRequired'), false); return; }
    const payload: ConfigObject = kind === 'vision' ? { vision, openai: { ...forms.credentials('openai'), model: forms.value('openai-model') }, channel_id: state.selectedChannel } : typeSafe ? { base_url: forms.value('hitl-audit-model-base-url'), api_key: forms.value('hitl-audit-model-api-key'), model: forms.value('hitl-audit-model-name') || 'jev-latest', credential_scope: 'hitlAudit' } : { ...cfg, credential_scope: 'hitlAudit', ...(!forms.value('hitl-audit-model-api-key') ? { channel_id: state.selectedChannel } : {}) };
    view.busy(button, true); resultMessage(resultId, t('settingsBasic.testing'));
    try { const result = await service.client.test(kind === 'vision' ? 'vision' : typeSafe ? 'typesafe' : 'openai', payload); if (live()) resultMessage(resultId, t(result.success ? 'settingsBasic.testSuccess' : 'settingsBasic.testFailed') + (result.success ? (result.model ? ` [${result.model}]` : '') + (result.latency_ms ? ` (${result.latency_ms}ms)` : '') : ': ' + (result.error || 'Unknown error')), !!result.success); }
    catch (error) { if (live()) resultMessage(resultId, t('settingsBasic.testError') + ': ' + errorMessage(error), false); }
    finally { if (live()) view.busy(button, false); }
  }
  function getRobotStatus(type: string) {
    const value = (suffix: string) => forms.value(`robot-${type}-${suffix}`); let configured = false;
    if (type === 'wechat') configured = !!value('ilink-bot-id');
    else if (type === 'wecom') configured = !!(value('token') && value('corp-id') && value('secret') && Number(value('agent-id')) > 0);
    else if (type === 'dingtalk') configured = !!(value('client-id') && value('client-secret'));
    else if (type === 'lark') configured = !!(value('app-id') && value('app-secret'));
    else if (type === 'telegram' || type === 'discord') configured = !!value('bot-token');
    else if (type === 'slack') configured = !!(value('bot-token') && value('app-token'));
    else if (type === 'qq') configured = !!(value('app-id') && value('client-secret'));
    return forms.checked(`robot-${type}-enabled`) ? { state: 'enabled', text: t('settings.robots.statusEnabled') } : configured ? { state: 'ready', text: t('settings.robots.statusConfigured') } : { state: 'idle', text: t('settings.robots.statusNotConfigured') };
  }
  function refreshRobotManager() {
    for (const type of ROBOTS) { const status = getRobotStatus(type), pill = view.el(`robot-card-${type}-status`); if (pill) { pill.className = `robot-status-pill robot-status-pill--${status.state}`; pill.textContent = status.text; } doc.querySelector(`[data-robot-card="${type}"]`)?.classList.toggle('is-active', state.activeRobot === type); }
  }
  function updateRobotServiceAccountWarning() { const node = view.el('robot-service-admin-warning'); if (node) node.hidden = !(forms.value('robot-auth-mode') === 'service_account' && forms.value('robot-service-user-id').toLowerCase() === 'admin'); }
  function onRobotAuthModeChange() { const node = view.el('robot-service-account-fields'); if (node) node.hidden = forms.value('robot-auth-mode') !== 'service_account'; updateRobotServiceAccountWarning(); }
  function loadRobotAuthPolicyEditor(type: string) { const panel = view.el('robot-auth-policy-panel'); if (!panel) return; panel.hidden = !type; forms.fillAuth(state.robotDrafts.get(type) || object(getPath(state.config, `robots.${type}.auth`))); onRobotAuthModeChange(); }
  function openRobotEditor(type: string) {
    if (!(ROBOTS as readonly string[]).includes(type)) return;
    if (state.activeRobot && state.activeRobot !== type) state.robotDrafts.set(state.activeRobot, forms.readAuth()); state.activeRobot = type;
    const empty = view.el('robot-editor-empty'); if (empty) empty.hidden = true;
    doc.querySelectorAll<HTMLElement>('[data-robot-editor]').forEach(panel => panel.hidden = panel.dataset.robotEditor !== type);
    refreshRobotManager(); doc.querySelector<HTMLElement>(`[data-robot-editor="${type}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); loadRobotAuthPolicyEditor(type); selects.refresh();
  }
  function modal(id: string, opened: boolean) { const node = view.el(id); if (opened) { if (id === 'external-mcp-modal') openCapabilityModal(node); else openAppModal(node); } else closeAppModal(node); }
  function openRobotCreateModal() { modal('robot-create-modal', true); }
  function closeRobotCreateModal() { modal('robot-create-modal', false); }
  function openRobotCommandsModal() { modal('robot-commands-modal', true); }
  function closeRobotCommandsModal() { modal('robot-commands-modal', false); }
  function selectRobotType(type: string) { closeRobotCreateModal(); openRobotEditor(type); }
  function clearPasswordFieldError(input: HTMLElement | null) { view.passwordError(input, ''); const error = view.el('password-form-error'); if (error) { error.textContent = ''; error.hidden = true; } }
  function resetPasswordForm() { for (const id of ['auth-current-password', 'auth-new-password', 'auth-confirm-password']) { forms.writeValue(id, ''); clearPasswordFieldError(view.el(id)); } }
  async function changePassword() {
    const current = view.el('auth-current-password'), next = view.el('auth-new-password'), confirmation = view.el('auth-confirm-password'); for (const node of [current, next, confirmation]) clearPasswordFieldError(node);
    const oldPassword = forms.value('auth-current-password'), newPassword = forms.value('auth-new-password'), confirmPassword = forms.value('auth-confirm-password');
    if (!oldPassword) view.passwordError(current, t('settingsSecurity.currentRequired'));
    if (newPassword.length < 8) view.passwordError(next, t('settingsSecurity.newTooShort'));
    if (newPassword !== confirmPassword) view.passwordError(confirmation, t('settingsSecurity.confirmMismatch'));
    const invalid = [current, next, confirmation].find(node => node?.getAttribute('aria-invalid') === 'true'); if (invalid) { invalid.focus(); return; }
    const button = doc.querySelector<HTMLElement>('.change-password-submit'); view.busy(button, true);
    try { await service.changePassword(oldPassword, newPassword); if (!live()) return; const message = t('settings.security.passwordUpdated'); deps.alert(message); resetPasswordForm(); deps.unauthorized(message); closeSettings(); }
    catch (error) { if (live()) { const node = view.el('password-form-error'); if (node) { node.textContent = errorMessage(error); node.hidden = false; } deps.alert(t('settings.security.changePasswordFailed') + ': ' + errorMessage(error)); } }
    finally { if (live()) view.busy(button, false); }
  }
  async function fetchExternalMCPs() { return service.loadMCPs(); }
  function renderExternalMCPData(data: MCPData, forceRender = false) { if (!live()) return false; state.mcps = data; return view.mcps(data, forceRender); }
  async function loadExternalMCPs(options: { forceRender?: boolean } = {}) {
    try { const data = await fetchExternalMCPs(); if (live()) renderExternalMCPData(data, options.forceRender); }
    catch (error) { if (live()) view.mcpError(errorMessage(error)); }
  }
  function stopExternalMcpPoll() { if (pollTimer !== undefined) clearInterval(pollTimer); pollTimer = undefined; }
  function startExternalMcpPoll() {
    stopExternalMcpPoll(); if (!live()) return; let pending = false;
    pollTimer = setInterval(() => { if (!doc.getElementById('page-mcp-management')?.classList.contains('active')) { stopExternalMcpPoll(); return; } if (doc.hidden || pending) return; pending = true; void loadExternalMCPs().finally(() => pending = false); }, 8000);
  }
  async function reloadMcpToolsAfterExternalChange(refreshExternal = false) { if (live()) await loadToolsList(state.pagination.page || 1, state.search, { refreshExternal }); }
  async function pollExternalMCPToolCount(name: string | null, maxAttempts = 10) { await service.pollMCP(name, maxAttempts, () => { if (live()) view.mcps(); }, true); if (live()) { await reloadMcpToolsAfterExternalChange(true); deps.refreshMentionTools(); } }
  async function pollExternalMCPStatus(name: string, maxAttempts = 30) {
    await service.pollMCP(name, maxAttempts, () => { if (live()) view.mcps(); }, false); if (!live()) return;
    await loadExternalMCPs(); const status = state.mcps.servers[name]?.status;
    deps.refreshMentionTools(); if (status === 'connected') { run(pollExternalMCPToolCount(name, 10)); await reloadMcpToolsAfterExternalChange(true); }
    else if (status === 'error') deps.alert(t('mcp.connectionFailedCheck')); else if (status === 'connecting') deps.alert(t('mcp.connectionTimeout'));
  }
  function showAddExternalMCPModal() { if (!deps.can('mcp:write')) return; ++mcpEditSequence; state.editingMCP = null; view.setText('external-mcp-modal-title', t('mcp.addExternalMCP')); forms.writeValue('external-mcp-json', ''); view.jsonError(''); modal('external-mcp-modal', true); }
  function closeExternalMCPModal() { ++mcpEditSequence; modal('external-mcp-modal', false); state.editingMCP = null; }
  async function editExternalMCP(name: string) {
    if (!deps.can('mcp:write')) return; const seq = ++mcpEditSequence; state.editingMCP = name; view.setText('external-mcp-modal-title', t('mcp.editExternalMCP')); forms.writeValue('external-mcp-json', ''); view.jsonError(''); modal('external-mcp-modal', true);
    try { const server = await service.client.mcp(name); if (!live() || seq !== mcpEditSequence) return; const config = { ...server.config }; delete config.tool_count; delete config.external_mcp_enable; forms.writeValue('external-mcp-json', JSON.stringify({ [name]: config }, null, 2)); forms.control('external-mcp-json')?.focus(); }
    catch (error) { if (live() && seq === mcpEditSequence) { closeExternalMCPModal(); deps.alert(t('mcp.operationFailed') + ': ' + errorMessage(error)); } }
  }
  function formatExternalMCPJSON() {
    const json = forms.value('external-mcp-json'); if (!json) { view.jsonError(t('mcp.jsonEmpty')); return; }
    try { const parsed: unknown = JSON.parse(json); forms.writeValue('external-mcp-json', JSON.stringify(parsed, null, 2)); view.jsonError(''); }
    catch (error) { view.jsonError(t('mcp.jsonError') + ': ' + errorMessage(error)); }
  }
  function loadExternalMCPExample() {
    forms.writeValue('external-mcp-json', JSON.stringify({ 'my-stdio-server': { command: 'python3', args: ['${HOME}/mcp-servers/main.py', '--port', '${MCP_PORT:-3000}'], env: { API_KEY: '${API_KEY}', LOG_LEVEL: '${LOG_LEVEL:-INFO}' }, timeout: 300 }, 'my-http-server': { type: 'http', url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer ${MCP_TOKEN}' } }, 'my-sse-server': { type: 'sse', url: 'http://127.0.0.1:8081/mcp/sse' } }, null, 2)); view.jsonError('');
  }
  async function saveExternalMCP() {
    if (!deps.can('mcp:write')) return; const json = forms.value('external-mcp-json'); if (!json) { view.jsonError(t('mcp.jsonEmpty')); forms.control('external-mcp-json')?.focus(); return; }
    try { await service.saveMCP(json); if (!live()) return; view.jsonError(''); closeExternalMCPModal(); await loadExternalMCPs(); deps.refreshMentionTools(); run(pollExternalMCPToolCount(null, 5)); deps.alert(t('mcp.saveSuccess')); }
    catch (error) { if (live()) { view.jsonError(errorMessage(error)); forms.control('external-mcp-json')?.focus(); } }
  }
  async function deleteExternalMCP(name: string) {
    if (!deps.can('mcp:write') || !deps.confirm(t('mcp.deleteExternalConfirm', { name }))) return;
    try { await service.deleteMCP(name); if (!live()) return; await loadExternalMCPs(); await reloadMcpToolsAfterExternalChange(false); if (live()) { deps.refreshMentionTools(); deps.alert(t('mcp.deleteSuccess')); } }
    catch (error) { if (live()) deps.alert(t('mcp.operationFailed') + ': ' + errorMessage(error)); }
  }
  async function toggleExternalMCP(name: string, status: string) {
    if (!deps.can('mcp:write')) return; const button = view.el(`btn-toggle-${name}`); view.busy(button, true);
    try {
      await service.toggleMCP(name, status); if (!live()) return;
      if (status === 'connected') { await loadExternalMCPs(); await reloadMcpToolsAfterExternalChange(false); if (live()) deps.refreshMentionTools(); }
      else { const server = await service.client.mcp(name); if (!live()) return; if (server.status === 'connected') { await loadExternalMCPs(); deps.refreshMentionTools(); run(pollExternalMCPToolCount(name, 10)); await reloadMcpToolsAfterExternalChange(true); } else await pollExternalMCPStatus(name, 30); }
    } catch (error) { if (live()) { deps.alert(t('mcp.operationFailed') + ': ' + errorMessage(error)); await loadExternalMCPs({ forceRender: true }); deps.refreshMentionTools(); } }
    finally { if (live()) view.busy(button, false); }
  }
  type Handler = (element: HTMLElement, event: Event) => void | Promise<unknown>;
  const handlers: Record<string, Handler> = {
    'settings-open': () => openSettings(), 'settings-close': closeSettings, 'settings-apply': applySettings,
    section: node => deps.navigateSection(node.dataset.settingsId || ''),
    'tools-search': searchTools, 'tools-search-clear': clearSearch, 'tools-status': node => filterToolsByStatus(node.dataset.settingsId || ''),
    'tools-page': node => loadToolsList(Number(node.dataset.settingsId) || 1, state.search), 'tools-size': node => changeToolsPageSize(Number((node as HTMLSelectElement).value)),
    'tools-save': saveToolsConfig, 'tools-all': () => selectTools(true), 'tools-none': () => selectTools(false), 'tools-source-clear': clearExternalMcpFilter,
    'tool-enable': node => handleToolCheckboxChange(node.dataset.settingsId || '', (node as HTMLInputElement).checked), 'tool-pin': node => handleToolAlwaysVisibleChange(node.dataset.settingsId || '', (node as HTMLInputElement).checked),
    'tool-detail': (node, event) => { const row = node.closest<HTMLElement>('.tool-item') ?? node; const info = row.querySelector<HTMLElement>('.tool-item-info'); if (info) return toggleToolDetail(info, row.dataset.toolKey || '', row.dataset.isExternal === 'true', row.dataset.externalMcp || '', event); },
    'mcp-scroll': (node, event) => scrollToExternalMCP(node.dataset.settingsId || '', event), 'tools-source': (node, event) => scrollToExternalMCPTools(node.dataset.settingsId || '', event),
    'channel-select': node => selectAIChannelForEditing(node.dataset.settingsId || ''), 'channel-select-value': node => selectAIChannelForEditing((node as HTMLSelectElement).value),
    'channel-check': node => { const id = node.dataset.settingsId || ''; if ((node as HTMLInputElement).checked) state.selectedChannels.add(id); else state.selectedChannels.delete(id); node.closest('.ai-channel-list-item')?.classList.toggle('checked', (node as HTMLInputElement).checked); },
    'channel-new': createAIChannelFromForm, 'channel-copy': copyAIChannelFromForm, 'channel-save': () => persistAIChannelsToServer(t('settingsBasic.aiChannelSaved')), 'channel-default': setSelectedAIChannelDefault,
    'channel-delete': deleteSelectedAIChannel, 'channel-delete-checked': deleteCheckedAIChannels, 'channel-probe': probeSelectedAIChannels, 'channel-test': testOpenAIConnection,
    'models-fetch': node => fetchModelList((node.dataset.settingsId || 'openai') as ModelScope), 'vision-sync': syncVisionFormEnabled, 'vision-test': () => testSecondary('vision'), 'audit-test': () => testSecondary('hitlAudit'), 'audit-sync': syncHitlAuditBackendUI,
    'robot-create-open': openRobotCreateModal, 'robot-create-close': closeRobotCreateModal, 'robot-commands-open': openRobotCommandsModal, 'robot-commands-close': closeRobotCommandsModal,
    'robot-open': node => openRobotEditor(node.dataset.settingsId || ''), 'robot-type': node => selectRobotType(node.dataset.settingsId || ''), 'robot-auth-mode': onRobotAuthModeChange, 'robot-warning': updateRobotServiceAccountWarning,
    'password-reset': resetPasswordForm, 'password-change': changePassword, 'password-clear-error': clearPasswordFieldError,
    'mcps-load': () => Promise.all([loadExternalMCPs(), loadToolsList(state.pagination.page, state.search)]), 'mcp-add': showAddExternalMCPModal, 'mcp-close': closeExternalMCPModal, 'mcp-format': formatExternalMCPJSON, 'mcp-example': loadExternalMCPExample, 'mcp-save': saveExternalMCP,
    'mcp-edit': node => editExternalMCP(node.dataset.settingsId || ''), 'mcp-delete': node => deleteExternalMCP(node.dataset.settingsId || ''), 'mcp-toggle': node => toggleExternalMCP(node.dataset.settingsId || '', node.dataset.settingsStatus || ''), 'mcp-detail-close': () => deps.closeMCPDetail(),
  };
  function dispatch(event: Event) {
    if (!live() || !(event.target instanceof Element)) return; const target = event.target;
    if (event.type === 'click' && target instanceof HTMLElement && ['robot-create-modal', 'robot-commands-modal', 'mcp-detail-modal'].includes(target.id)) { if (target.id === 'mcp-detail-modal') deps.closeMCPDetail(); else modal(target.id, false); }
    const node = target.closest<HTMLElement>('[data-settings-action]'); if (!node) return;
    // A nested checkbox owns its change; its click must not activate the enclosing card.
    if ((node.dataset.settingsEvent || 'click') !== event.type) return;
    if (node.matches(':disabled,[aria-disabled="true"],[data-state-disabled="true"]') || node.closest('[inert]')) return;
    const permission = node.dataset.requirePermission; if (permission && !deps.can(permission)) return;
    const handler = handlers[node.dataset.settingsAction || '']; if (!handler) return; if (!(target instanceof HTMLInputElement && target.type === 'checkbox')) event.preventDefault();
    event.stopPropagation(); run(handler(node, event));
  }
  function formEvent(event: Event) {
    if (!live() || !(event.target instanceof HTMLElement)) return; const node = event.target, id = node.id;
    if (id === 'tools-search' && event.type === 'input' && !forms.value(id)) run(clearSearch());
    if (id.startsWith('robot-')) refreshRobotManager();
    if (['ai-channel-name', 'openai-provider', 'openai-api-key', 'openai-base-url', 'openai-model'].includes(id)) syncAIChannelEditorPreview();
    if (['openai-provider', 'vision-provider', 'hitl-audit-model-provider', 'knowledge-embedding-provider'].includes(id)) syncModelListFetchButtons();
    if (id === 'hitl-audit-backend') syncHitlAuditBackendUI();
    for (const [scope, ids] of Object.entries(MODEL_IDS)) if (id === ids.selectId && event.type === 'change' && forms.value(id)) { forms.writeValue(ids.inputId, forms.value(id)); if (scope === 'openai') syncAIChannelEditorPreview(); }
  }
  function languageChanged() { if (!live()) return; initModelListControls(); selects.init(); selects.refresh(); if (state.config) view.channels(); refreshRobotManager(); syncHitlAuditBackendUI(); if (doc.getElementById('page-mcp-management')?.classList.contains('active')) { run(loadExternalMCPs({ forceRender: true })); view.toolList(); view.pagination(); view.filterChip(); } }
  function activate() {
    if (activated || disposed) return; activated = true; bindSettingsStaticActions(doc);
    for (const name of ['click', 'change', 'input']) on(doc, name, dispatch);
    for (const name of ['change', 'input']) on(doc, name, formEvent);
    on(doc, 'keydown', event => {
      if (!(event instanceof KeyboardEvent) || !(event.target instanceof HTMLElement)) return;
      if (event.target.id === 'tools-search' && event.key === 'Enter') { event.preventDefault(); run(searchTools()); return; }
      const node = event.target.closest<HTMLElement>('[data-settings-action]'); if (!node || node !== event.target || node.matches('input,textarea,select,button,a,:disabled,[aria-disabled="true"]') || !['Enter', ' '].includes(event.key)) return;
      if (node.dataset.settingsAction === 'section' || node.dataset.settingsAction === 'channel-select') { event.preventDefault(); run(handlers[node.dataset.settingsAction]!(node, event)); }
    });
    on(doc, 'languagechange', languageChanged); initModelListControls(); selects.init();
  }
  return {
    forms, handlers, activate, loadConfig, openSettings, closeSettings, switchSettingsSection, syncC2NavFromConfig, syncC2NavOnceFromServer,
    loadToolsList, saveCurrentPageToolStates, searchTools, clearSearch, filterToolsByStatus, changeToolsPageSize, handleToolCheckboxChange, handleToolAlwaysVisibleChange,
    selectAllTools: () => selectTools(true), deselectAllTools: () => selectTools(false), updateToolsStats: async () => { saveCurrentPageToolStates(); view.toolStats(); },
    toggleToolDetail, scrollToExternalMCP, scrollToExternalMCPTools, highlightExternalMcpTools, clearExternalMcpFilter, saveToolsConfig, applySettings,
    readAIChannelFromMainForm, writeAIChannelToMainForm, syncAIChannelEditorPreview, selectAIChannelForEditing, createAIChannelFromForm, copyAIChannelFromForm,
    saveSelectedAIChannel: () => persistAIChannelsToServer(t('settingsBasic.aiChannelSaved')), setSelectedAIChannelDefault, deleteSelectedAIChannel, deleteCheckedAIChannels, selectedOrAllAIChannelIdsForProbe, probeSelectedAIChannels, persistAIChannelsToServer, persistAIConfigOnlyToServer,
    async refreshAIChannelsFromServer(preferredId: string, payload?: AIChannel) { const raw = await service.client.config(); if (!live()) return false; service.acceptConfig(raw, preferredId, payload); writeAIChannelToMainForm(state.selectedChannel); deps.populateChatChannels(service.config().ai); return true; },
    syncVisionFormEnabled, initModelListControls, syncModelListFetchButtons, populateModelSelect, fetchModelList, testOpenAIConnection, testVisionConnection: () => testSecondary('vision'), testHitlAuditModelConnection: () => testSecondary('hitlAudit'), isHitlAuditTypeSafe, syncHitlAuditBackendUI, collectHitlAuditModelEffectiveConfig,
    getRobotStatus, refreshRobotManager, openRobotEditor, loadRobotAuthPolicyEditor, onRobotAuthModeChange, updateRobotServiceAccountWarning, openRobotCreateModal, closeRobotCreateModal, openRobotCommandsModal, closeRobotCommandsModal, selectRobotType,
    readRobotAuthPolicyEditor: forms.readAuth, robotAuthPayload: (type: string, previous: ConfigObject): RobotAuth | ConfigObject => type === state.activeRobot ? forms.readAuth() : state.robotDrafts.get(type) || object(object(previous[type]).auth),
    clearPasswordFieldError, resetPasswordForm, changePassword, fetchExternalMCPs, renderExternalMCPData, loadExternalMCPs, startExternalMcpPoll, stopExternalMcpPoll, reloadMcpToolsAfterExternalChange, pollExternalMCPToolCount, pollExternalMCPStatus,
    showAddExternalMCPModal, closeExternalMCPModal, editExternalMCP, formatExternalMCPJSON, loadExternalMCPExample, saveExternalMCP, deleteExternalMCP, toggleExternalMCP,
    dispose() { if (disposed) return; disposed = true; ++toolSequence; ++mcpEditSequence; stopExternalMcpPoll(); for (const timer of timers) clearTimeout(timer); timers.clear(); cleanup.splice(0).forEach(fn => fn()); for (const id of ['external-mcp-modal', 'robot-create-modal', 'robot-commands-modal']) closeAppModal(view.el(id)); },
  };
}
export type SettingsController = ReturnType<typeof createSettingsController>;
