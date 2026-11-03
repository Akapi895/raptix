import { escapeHtml as e, type Translate } from './contracts';
import { BACKEND_NEW_CHANNEL } from '@/platform/backend-legacy-strings';
import { channelHostLabel, getToolKey, text, validateSelectedAIChannelPayload, type AIChannel, type MCPData, type MCPServer, type ToolSchema } from './model';
import type { SettingsService } from './service';
import type { SettingsSelects } from './selects';

export const action = (name: string, id = '', event = 'click', extra = '') => `data-settings-action="${e(name)}" data-settings-id="${e(id)}" data-settings-event="${e(event)}" ${extra}`;
export function createSettingsView(doc: Document, service: SettingsService, selects: SettingsSelects, t: Translate) {
  const { state } = service;
  const el = (id: string) => doc.getElementById(id);
  const html = (id: string, content: string) => { const node = el(id); if (node) node.innerHTML = content; };
  const setText = (id: string, value: string) => { const node = el(id); if (node) node.textContent = value; };
  function channelName(id: string, channel: AIChannel) {
    const name = text(channel.name).trim(); return (name === BACKEND_NEW_CHANNEL || name === 'New Channel') && !text(channel.model).trim() ? t('settingsBasic.aiChannelUntitled') : name || id;
  }
  function saveHint(message: string, ok = true) { const node = el('ai-channel-save-hint'); if (node) { node.textContent = message; node.classList.toggle('is-error', !ok); node.classList.toggle('is-success', ok); } }
  function connectionResult(node: HTMLElement | null, status = '', message = '', title = '') { if (!node) return; node.classList.remove('is-error', 'is-success', 'is-muted', 'is-visible'); node.style.color = ''; node.textContent = message; node.title = title; if (message) node.classList.add('is-visible', status || 'is-muted'); }
  function connection() {
    const probe = state.probes.get(state.selectedChannel); let message = probe?.message || '';
    const prefix = t('settingsBasic.testFailed') + ': ';
    if (probe?.status === 'failed' && message && message !== t('settingsBasic.testFillRequired') && !message.startsWith(prefix)) message = prefix + message;
    connectionResult(el('test-openai-result'), probe?.status === 'ready' ? 'is-success' : probe?.status === 'failed' ? 'is-error' : 'is-muted', message);
  }
  function channelChrome() {
    const ai = state.config?.ai; if (!ai) return; const channel = ai.channels[state.selectedChannel] || {}; const complete = !validateSelectedAIChannelPayload(channel); const probe = state.probes.get(state.selectedChannel); const isDefault = state.selectedChannel === ai.default_channel;
    setText('ai-channel-editor-title', t('settingsBasic.aiChannelFormContextHint'));
    const status = probe?.status || (complete ? 'complete' : 'draft');
    const chips = [
      { label: t(isDefault ? 'settingsBasic.aiChannelDefaultMeta' : 'settingsBasic.aiChannelCustomMeta'), className: isDefault ? 'default' : '' },
      { label: channel.provider === 'claude' ? 'Claude' : t('settingsBasic.aiChannelOpenAICompat'), className: '' },
      { label: channel.model || t('settingsBasic.aiChannelModelMissing'), className: '' }, { label: channelHostLabel(channel.base_url), className: '' },
      { label: probe?.message || t(complete ? 'settingsBasic.aiChannelComplete' : 'settingsBasic.aiChannelDraft'), className: status },
    ];
    html('ai-channel-editor-meta', chips.map(chip => `<span class="ai-channel-editor-chip ${e(chip.className)}" title="${e(chip.label)}">${e(chip.label)}</span>`).join(''));
  }
  function channelList(ids?: string[]) {
    const ai = state.config?.ai; if (!ai) return;
    html('ai-channel-list', (ids || Object.keys(ai.channels).sort()).map(id => {
      const channel = ai.channels[id] || {}, name = channelName(id, channel), probe = state.probes.get(id), complete = !validateSelectedAIChannelPayload(channel);
      const status = probe?.status || (complete ? 'complete' : 'draft'), statusText = probe?.message || t(complete ? 'settingsBasic.aiChannelComplete' : 'settingsBasic.aiChannelDraft');
      return `<div class="ai-channel-list-item${id === state.selectedChannel ? ' active' : ''}${state.selectedChannels.has(id) ? ' checked' : ''}" role="button" tabindex="0" aria-current="${id === state.selectedChannel}" ${action('channel-select', id)}>
        <input type="checkbox" class="ai-channel-bulk-check" ${state.selectedChannels.has(id) ? 'checked' : ''} aria-label="${e(t('settingsBasic.aiChannelSelectAria').replace('{name}', name))}" ${action('channel-check', id, 'change')}>
        <div class="ai-channel-card-body"><div class="ai-channel-list-main"><span class="ai-channel-status-dot ${e(status)}" aria-hidden="true"></span><strong title="${e(name)}">${e(name)}</strong>${id === ai.default_channel ? `<span class="ai-channel-badge">${e(t('settingsBasic.aiChannelDefaultBadge'))}</span>` : ''}</div>
        <div class="ai-channel-list-meta" title="${e(channel.model || '-')} · ${e(channelHostLabel(channel.base_url))}">${e(channel.model || '-')} · ${e(channelHostLabel(channel.base_url))}</div>
        <div class="ai-channel-list-foot"><span class="ai-channel-status-label ${e(status)}" title="${e(statusText)}">${e(statusText)}</span><span title="${e(id)}">${e(id)}</span></div></div></div>`;
    }).join(''));
  }
  function channels(showCount = false) {
    const ai = state.config?.ai, select = el('ai-channel-select'); if (!ai) return;
    const ids = Object.keys(ai.channels).sort();
    if (select instanceof HTMLSelectElement) {
      select.replaceChildren();
      for (const id of ids) {
        const channel = ai.channels[id] || {}, option = doc.createElement('option'), probe = state.probes.get(id); option.value = id;
        option.textContent = `${channelName(id, channel)}${id === ai.default_channel ? ' *' : ''} · ${channel.model || '-'}`;
        if (probe) { option.dataset.probeStatus = probe.status; option.dataset.probeMessage = probe.message; } select.append(option);
      }
      select.value = state.selectedChannel; selects.sync(select);
    }
    channelChrome(); channelList(ids); connection();
    if (showCount) saveHint(t('settingsBasic.aiChannelCount').replace('{count}', String(ids.length)));
  }
  function toolStats() {
    const enabled = state.tools.filter(tool => (state.toolStates.get(getToolKey(tool)) || tool).enabled).length;
    const total = state.search ? state.tools.length : state.pagination.total, totalEnabled = state.search ? enabled : service.totalEnabled();
    html('tools-stats', `<span>${e(t('mcp.currentPageEnabled'))}: <strong>${enabled}</strong> / ${state.tools.length}</span><span>${e(t('mcp.totalEnabled'))}: <strong>${totalEnabled}</strong> / ${total}</span><span title="${e(t('mcp.alwaysVisibleHint'))}">${e(t('mcp.alwaysVisibleLabel'))}: <strong>${service.alwaysVisibleForSave().length}</strong></span>`);
  }
  function toolList() {
    const list = el('tools-list'); if (!list) return;
    let container = list.querySelector<HTMLElement>('.tools-list-items'); if (!container) { container = doc.createElement('div'); container.className = 'tools-list-items'; list.append(container); }
    container.innerHTML = state.tools.length ? state.tools.map(tool => {
      const key = getToolKey(tool), saved = state.toolStates.get(key) || tool, external = saved.is_external || tool.is_external, mcp = saved.external_mcp || tool.external_mcp || '';
      const badgeText = mcp ? t('mcp.externalFrom', { name: mcp }) : t('mcp.externalBadge');
      const badge = external ? `<button type="button" class="external-tool-badge" ${mcp ? action('mcp-scroll', mcp) : 'disabled'} title="${e(mcp ? t('mcp.externalToolFrom', { name: mcp }) : t('mcp.externalBadge'))}">${e(badgeText)}</button>` : '<span class="cap-source-label">Built-in</span>';
      return `<div class="tool-item" data-tool-key="${e(key)}" data-tool-name="${e(tool.name)}" data-is-external="${!!external}" data-external-mcp="${e(mcp)}" ${action('tool-detail', key)}>
        <input type="checkbox" class="theme-checkbox" aria-label="Enable ${e(tool.name)}" id="${e(`tool-${key.replace(/::/g, '--')}`)}" ${saved.enabled ? 'checked' : ''} ${external ? 'data-external="true"' : ''} ${action('tool-enable', key, 'change')}>
        <div class="tool-item-info"><div class="tool-item-name">${e(tool.name)}${badge}
        <label class="tool-resident-toggle" title="${e(t('mcp.alwaysVisibleHint'))}"><input type="checkbox" class="theme-checkbox" ${service.isAlwaysVisible(tool) ? 'checked' : ''} ${service.isBuiltin(tool) ? 'disabled data-state-disabled="true" aria-disabled="true"' : ''} ${action('tool-pin', key, 'change')}><span>${e(t('mcp.alwaysVisibleLabel'))}</span></label>
        ${service.isBuiltin(tool) ? `<span class="external-tool-badge" title="${e(t('mcp.alwaysVisibleBuiltinHint'))}">${e(t('mcp.alwaysVisibleBuiltinLabel'))}</span>` : ''}<button type="button" class="cap-schema-toggle" aria-expanded="false" aria-label="Parameters for ${e(tool.name)}" ${action('tool-detail', key)}>Parameters</button></div>
        <div class="tool-item-desc">${e(tool.description || t('mcp.noDescription'))}</div><div class="tool-item-detail" style="display:none"></div></div></div>`;
    }).join('') : `<div class="empty">${e(t('mcp.noTools'))}</div>`;
    toolStats();
  }
  function pagination() {
    const root = el('tools-list'); if (!root) return; root.querySelector('.tools-pagination')?.remove();
    const { page, page_size: size, total, total_pages: pages } = state.pagination; if (pages <= 1) { selects.pagination(root); return; }
    const node = doc.createElement('div'); node.className = 'tools-pagination';
    const button = (target: number, label: string, disabled: boolean) => `<button class="btn-secondary" ${action('tools-page', String(target))} ${disabled ? 'disabled' : ''}>${e(t(`mcp.${label}`))}</button>`;
    node.innerHTML = `<div class="pagination-info">${e(t('mcp.paginationInfo', { start: (page - 1) * size + 1, end: Math.min(page * size, total), total }))}${state.search ? ` (${e(t('common.search'))}: &quot;${e(state.search)}&quot;)` : ''}</div>
      <div class="pagination-page-size"><label for="tools-page-size-pagination">${e(t('mcp.perPage'))}</label><select id="tools-page-size-pagination" ${action('tools-size', '', 'change')}>${[10, 20, 50, 100].map(value => `<option value="${value}" ${size === value ? 'selected' : ''}>${value}</option>`).join('')}</select></div>
      <div class="pagination-controls">${button(1, 'firstPage', page === 1)}${button(page - 1, 'prevPage', page === 1)}<span class="pagination-page">${e(t('mcp.pageInfo', { page, total: pages }))}</span>${button(page + 1, 'nextPage', page === pages)}${button(pages, 'lastPage', page === pages)}</div>`;
    root.append(node); selects.pagination(node);
  }
  function filterChip() {
    const actions = doc.querySelector('.mcp-tools-panel .tools-actions'); if (!actions) return;
    let chip = el('tools-source-filter-chip'); if (!chip) { chip = doc.createElement('div'); chip.id = 'tools-source-filter-chip'; chip.className = 'tools-source-filter-chip'; actions.append(chip); }
    chip.style.display = state.externalFilter ? 'inline-flex' : 'none'; chip.innerHTML = state.externalFilter ? `<span>${e(t('mcp.filterBySource', { name: state.externalFilter }))}</span><button type="button" class="tools-source-filter-clear" ${action('tools-source-clear')} title="${e(t('mcp.clearSourceFilter'))}">×</button>` : '';
    doc.querySelectorAll<HTMLElement>('.external-mcp-item').forEach(node => node.classList.toggle('selected', node.dataset.mcpName === state.externalFilter));
  }
  function schema(detail: HTMLElement, description: string, value?: ToolSchema, failed = false) {
    const properties = value?.properties || {}, required = value?.required || [];
    const rows = Object.entries(properties).map(([key, property]) => `<tr><td><code>${e(key)}</code></td><td>${e(text(property.type || (property.enum ? 'enum' : '—')))}</td><td>${required.includes(key) ? '<span style="color:#28a745">✔</span>' : ''}</td><td>${e(property.description)}</td></tr>`).join('');
    detail.innerHTML = `<div class="tool-detail-desc">${e(description)}</div><div class="tool-detail-section-title">Parameter schema</div>${value && rows ? `<table class="tool-schema-table"><thead><tr><th>Parameter</th><th>Type</th><th>Required</th><th>Description</th></tr></thead><tbody>${rows}</tbody></table>` : `<div style="color:var(--text-tertiary);font-size:0.8125rem;padding:4px 0;">${failed ? 'Load failed' : value ? 'No parameter schema' : 'Loading...'}</div>`}`;
  }
  let mcpSignature = '';
  function mcpCard(name: string, server: MCPServer) {
    const rawStatus = server.status || 'disconnected', status = rawStatus === 'stopped' ? 'disabled' : rawStatus;
    const known = ['connected', 'connecting', 'error', 'disabled'].includes(status) ? status : 'disconnected';
    const statusLabel = t(`mcp.${known === 'error' ? 'connectionFailed' : known}`), transport = server.config.type || server.config.transport || (server.config.command ? 'stdio' : 'http');
    const hasTools = (server.tool_count || 0) > 0;
    const toggle = status === 'connecting' ? `<button class="btn-secondary" disabled data-state-disabled="true" aria-disabled="true">${e(t('mcp.connecting'))}</button>` : `<button class="btn-secondary" id="${e(`btn-toggle-${name}`)}" ${action('mcp-toggle', name, 'click', `data-settings-status="${e(rawStatus)}"`)} data-require-permission="mcp:write" title="${e(t(status === 'connected' ? 'mcp.stopConnection' : 'mcp.startConnection'))}">${e(t(status === 'connected' ? 'mcp.stop' : 'mcp.start'))}</button>`;
    const field = (label: string, content: string) => `<div><strong>${e(t(`mcp.${label}`))}</strong><span>${content}</span></div>`;
    return `<article class="external-mcp-item${state.externalFilter === name ? ' selected' : ''}" data-mcp-name="${e(name)}">
      <div class="external-mcp-item-header"><div class="external-mcp-item-info"><h4>${e(name)}</h4><span class="external-mcp-status status-${known}">${e(statusLabel)}</span></div></div>
      <p class="cap-server-summary">${e(transport.toUpperCase())} · ${server.tool_count !== undefined ? `${server.tool_count} tools` : 'Tool count not reported'}</p>
      ${server.config.description ? `<p class="cap-row-description">${e(server.config.description)}</p>` : ''}
      ${server.error ? `<div class="external-mcp-error" role="status"><strong>${e(t('mcp.connectionErrorLabel'))}</strong><p>${e(server.error)}</p><span>Review the connection settings, then start the server again.</span></div>` : ''}
      <div class="external-mcp-item-actions">${hasTools ? `<button type="button" class="btn-secondary" ${action('tools-source', name)} aria-pressed="${state.externalFilter === name}">View tools</button>` : ''}${toggle}<button class="btn-secondary" ${action('mcp-edit', name)} data-require-permission="mcp:write" ${status === 'connecting' ? 'disabled' : ''}>${e(t('common.edit'))}</button><button class="btn-secondary btn-danger" ${action('mcp-delete', name)} data-require-permission="mcp:write" ${status === 'connecting' ? 'disabled' : ''}>${e(t('common.delete'))}</button></div>
      <details class="cap-server-details"><summary>Connection details</summary><div class="external-mcp-item-details">${server.config.timeout ? field('timeout', `${server.config.timeout} ${e(t('mcp.secondsUnit'))}`) : ''}${server.config.command ? field('command', `<code>${e(server.config.command)}</code>`) : ''}${server.config.url ? field('urlLabel', `<code>${e(server.config.url)}</code>`) : ''}</div></details></article>`;
  }
  function mcps(data: MCPData = state.mcps, force = false) {
    const signature = JSON.stringify(data); if (!force && mcpSignature === signature) { filterChip(); return false; } mcpSignature = signature;
    const empty = !Object.keys(data.servers).length; doc.querySelector('.mcp-management-layout')?.classList.toggle('external-empty', empty);
    html('external-mcp-list', empty ? `<div class="cap-state"><strong>${e(t('mcp.noExternalMCP'))}</strong><p>${e(t('mcp.clickToAddExternal'))}</p></div>` : `<div class="external-mcp-items">${Object.entries(data.servers).map(([name, server]) => mcpCard(name, server)).join('')}</div>`);
    html('external-mcp-stats', [['total', 'totalCount'], ['connected', 'connectedCount'], ['enabled', 'enabledCount'], ['disabled', 'disabledCount']].map(([key, label]) => `<span>${e(t(`mcp.${label}`))}: <strong>${data.stats[key!] || 0}</strong></span>`).join(''));
    filterChip(); return true;
  }
  function busy(node: HTMLElement | null, disabled: boolean) {
    if (!node) return; node.dataset.stateDisabled = String(disabled); node.setAttribute('aria-disabled', String(disabled)); if (node instanceof HTMLButtonElement) node.disabled = disabled; node.style.pointerEvents = disabled ? 'none' : ''; node.style.opacity = disabled ? '0.5' : '';
  }
  return { el, html, setText, channels, channelList, channelChrome, channelName, saveHint, connection, connectionResult, toolList, toolStats, pagination, filterChip, schema, mcps, busy,
    toolLoading() { const node = el('tools-list'); if (!node) return; node.setAttribute('aria-busy', 'true'); if (!node.querySelector('.tool-item')) node.innerHTML = `<div class="tools-list-items"><div class="loading" style="padding:20px;text-align:center;color:var(--text-muted)">⏳ ${e(t('mcp.loadingTools'))}</div></div>`; },
    toolError(message: string) { html('tools-list', `<div class="error" style="padding:20px;text-align:center">${e(message)}</div>`); },
    mcpError(message: string) { html('external-mcp-list', `<div class="error">${e(t('mcp.loadExternalMCPFailed'))}: ${e(message)}</div>`); mcpSignature = ''; },
    jsonError(message: string) { const node = el('external-mcp-json-error'); if (node) { node.textContent = message; node.style.display = message ? 'block' : 'none'; } el('external-mcp-json')?.classList.toggle('error', !!message); },
    passwordError(input: HTMLElement | null, message: string) { if (!input) return; input.classList.toggle('error', !!message); input.setAttribute('aria-invalid', String(!!message)); const node = el(`${input.id}-error`); if (node) { node.textContent = message; node.hidden = !message; input.setAttribute('aria-describedby', node.id); } },
  };
}
export type SettingsView = ReturnType<typeof createSettingsView>;
