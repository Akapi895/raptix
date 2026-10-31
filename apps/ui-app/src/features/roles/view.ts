import type { Actions } from '../../ui/actions';
import { capabilityState, capabilityTable, openCapabilityModal } from '../../ui/capabilities';
import { escapeAttr, escapeHtml } from '../../ui/format';
import { closeAppModal } from '../../ui/modal';
import { DEFAULT_ROLE, decodeRoleIcon, encodeRoleIcon, plainDescription, sortRoles, toolKey, type Role, type RoleLinkFilter, type RoleTool } from './model';
import type { RoleToolsEditor } from './editor';
import type { RolePayload, RolesService } from './service';

export interface RolesViewDeps {
  doc: Document;
  service: RolesService;
  editor: RoleToolsEditor;
  actions: Actions;
  /** Translation with a fallback for keys the resources do not have. */
  t(key: string, fallback: string, params?: Record<string, string | number>): string;
  can(permission: string): boolean;
  notify(text: string, type: 'success' | 'error' | 'info' | 'warning'): void;
  confirm(text: string): boolean;
  /** Fills the workflow picker of the role editor (still owned by the workflows page). */
  loadWorkflowOptions(selectedId: string): Promise<void> | void;
  /** Closes the other chat panels before the role panel opens. */
  closeOtherChatPanels(): void;
  /** Tells the chat tool-mention cache that the role changed. */
  onRoleChanged(): void;
  /** Gives the paginated selects in a freshly rendered block their custom skin. */
  initPaginationSelects?(root: HTMLElement): void;
  isRolesPageOpen(): boolean;
}

const DEFAULT_CHAT_ICON = '🔵';
const DEFAULT_CARD_ICON = '👤';
const SEARCH_DEBOUNCE_MS = 300;
const WORKFLOW_SELECTS = ['role-workflow-id', 'role-workflow-policy'] as const;
const SELECT_CARET = '<svg class="role-form-select-caret" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

interface SkinnedSelect { wrapper: HTMLElement; trigger: HTMLButtonElement; dropdown: HTMLElement; select: HTMLSelectElement }

export function createRolesView(deps: RolesViewDeps) {
  const { doc, service, editor, actions, t } = deps;
  const byId = <T extends HTMLElement = HTMLElement>(id: string) => doc.getElementById(id) as T | null;
  const skinned = new Map<string, SkinnedSelect>();
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  /** The role being edited, or null while creating. */
  let editing: string | null = null;
  let saving = false;

  const iconOf = (role: Role, fallback: string): string => (role.icon ? decodeRoleIcon(role.icon) : fallback);

  // ---- chat role selector ----

  function renderSelector(): void {
    const icon = byId('role-selector-icon');
    const text = byId('role-selector-text');
    if (!icon || !text) return;
    const current = service.currentRole;
    const selected = service.roles.find(role => role.name === (current && current !== DEFAULT_ROLE ? current : DEFAULT_ROLE));
    if (!selected) {
      text.setAttribute('data-i18n-skip-text', 'false');
      icon.textContent = DEFAULT_CHAT_ICON;
      text.textContent = t('chat.defaultRole', 'Default');
      return;
    }
    const isDefault = selected.name === DEFAULT_ROLE || !selected.name;
    icon.textContent = iconOf(selected, DEFAULT_CHAT_ICON);
    text.setAttribute('data-i18n-skip-text', isDefault ? 'false' : 'true');
    text.textContent = isDefault ? t('chat.defaultRole', 'Default') : selected.name;
  }

  function renderSidebar(): void {
    const list = byId('role-selection-list');
    if (!list) return;
    const current = service.currentRole;
    list.innerHTML = sortRoles(service.roles).filter(role => role.enabled !== false).map(role => {
      const isDefault = role.name === DEFAULT_ROLE;
      const selected = isDefault ? current === '' || current === DEFAULT_ROLE : current === role.name;
      const plain = plainDescription(role);
      const description = plain || (isDefault
        ? t('roles.defaultRoleDescription', 'Default agent, no extra user prompt, uses default MCP')
        : t('roles.noDescription', 'No description'));
      return `<div class="role-selection-item-main${selected ? ' selected' : ''}" role="option" tabindex="0"
        data-selection-detail="${escapeAttr(description)}" data-action="roles.select" data-keydown="roles.selectKey" data-role-name="${escapeAttr(role.name)}">
        <div class="role-selection-item-icon-main">${escapeHtml(role.icon ? decodeRoleIcon(role.icon) : DEFAULT_CARD_ICON)}</div>
        <div class="role-selection-item-content-main">
          <div class="role-selection-item-name-main">${escapeHtml(role.name)}</div>
          <div class="role-selection-item-description-main">${escapeHtml(description)}</div>
        </div>
        ${selected ? '<div class="role-selection-checkmark-main">✓</div>' : ''}
      </div>`;
    }).join('');
  }

  function renderChatSelector(): void {
    renderSelector();
    renderSidebar();
  }

  function chatWrapper(): HTMLElement | null {
    return byId('role-selector-wrapper')
      ?? byId('role-selector-btn')?.closest<HTMLElement>('.role-selector-wrapper:not(.project-selector-wrapper)')
      ?? null;
  }

  function isPanelOpen(): boolean {
    const panel = byId('role-selection-panel');
    return !!panel && panel.style.display !== 'none' && panel.style.display !== '';
  }

  function closePanel(): void {
    const panel = byId('role-selection-panel');
    const button = byId('role-selector-btn');
    if (panel) panel.style.display = 'none';
    button?.classList.remove('active');
    button?.setAttribute('aria-expanded', 'false');
  }

  function togglePanel(): void {
    const panel = byId('role-selection-panel');
    if (!panel) return;
    if (isPanelOpen()) {
      closePanel();
      return;
    }
    deps.closeOtherChatPanels();
    renderSidebar();
    panel.style.display = 'flex';
    const button = byId('role-selector-btn');
    button?.classList.add('active');
    button?.setAttribute('aria-expanded', 'true');
    // Scroll the panel into view when its top would leave the viewport.
    setTimeout(() => {
      const wrapper = chatWrapper();
      if (!wrapper) return;
      const rect = wrapper.getBoundingClientRect();
      const height = panel.offsetHeight || 400;
      if (rect.top - height < 0) {
        browser.scrollTo({ top: Math.max(0, browser.scrollY + rect.top - height - 20), behavior: 'smooth' });
      }
    }, 10);
  }

  function selectRole(name: string): void {
    if (service.setCurrentRole(name)) deps.onRoleChanged();
    renderChatSelector();
  }

  // ---- roles page list ----

  function toolsSummary(role: Role): string {
    if (role.name === DEFAULT_ROLE) return t('roleModal.usingAllTools', 'Use all tools');
    const tools = role.tools ?? [];
    if (tools.length > 0) {
      const names = tools.slice(0, 5).map(tool => escapeHtml(tool.includes('::') ? tool.split('::')[1] : tool));
      return tools.length <= 5
        ? names.join(', ')
        : names.join(', ') + t('roleModal.andNMore', ` and ${tools.length - 5} more`, { count: tools.length - 5 });
    }
    const mcps = role.mcps ?? [];
    if (mcps.length > 0) return t('roleModal.andNMore', `${mcps.length} more`, { count: mcps.length });
    return t('roleModal.usingAllTools', 'Use all tools');
  }

  function renderList(): void {
    const list = byId('roles-list');
    if (!list) return;
    const keyword = (byId<HTMLInputElement>('roles-search')?.value ?? '').trim();
    const needle = keyword.toLowerCase();
    const availability = byId<HTMLSelectElement>('roles-availability')?.value ?? '';
    const matching = service.roles.filter(role => (!keyword || role.name.toLowerCase().includes(needle) || (role.description ?? '').toLowerCase().includes(needle)) && (!availability || (role.enabled !== false) === (availability === 'enabled')));
    const count = byId('roles-result-count'); if (count) count.textContent = `${matching.length} of ${service.roles.length} agents`;
    if (matching.length === 0) {
      list.innerHTML = capabilityState(keyword || availability ? t('roles.noMatchingRoles', 'No matching agents') : t('roles.noRoles', 'No agents'));
      return;
    }
    list.innerHTML = capabilityTable('Agent definitions', ['Agent', 'Availability', 'Tool access', 'Workflow', 'Actions'], sortRoles(matching).map(role => {
      const enabled = role.enabled !== false;
      const name = escapeAttr(role.name);
      const plain = plainDescription(role);
      return `<tr class="role-card"><td class="cap-primary-cell"><strong>${role.icon ? `<span class="cap-agent-icon" aria-hidden="true">${escapeHtml(iconOf(role, ''))}</span>` : ''}${escapeHtml(role.name)}</strong><p class="cap-row-description">${escapeHtml(plain || t('roles.noDescriptionShort', 'No description'))}</p></td>
        <td><span class="role-card-badge cap-status ${enabled ? 'enabled is-success' : 'disabled'}">${escapeHtml(enabled ? t('roles.enabled', 'Enabled') : t('roles.disabled', 'Disabled'))}</span></td>
        <td class="cap-tools-summary">${toolsSummary(role)}</td><td>${role.workflow_id ? `<strong>${escapeHtml(role.workflow_id)}</strong><p class="cap-row-description">${role.workflow_policy === 'off' ? 'Trigger off' : 'Auto trigger'}</p>` : '<span class="cap-muted">None</span>'}</td>
        <td><div class="cap-row-actions"><button class="btn-secondary btn-small" type="button" data-require-permission="roles:write" data-action="roles.edit" data-role-name="${name}">${escapeHtml(t('common.edit', 'Edit'))}</button>
          ${role.name !== DEFAULT_ROLE ? `<button class="btn-secondary btn-small btn-danger" type="button" data-require-permission="roles:delete" data-action="roles.delete" data-role-name="${name}">${escapeHtml(t('common.delete', 'Delete'))}</button>` : ''}</div></td></tr>`;
    }).join(''));
  }

  function syncSearchClear(keyword: string): void {
    const clear = byId('roles-search-clear');
    if (clear) clear.style.display = keyword ? 'block' : 'none';
  }

  function clearRolesSearch(): void {
    const input = byId<HTMLInputElement>('roles-search');
    if (input) input.value = '';
    syncSearchClear('');
    renderList();
  }

  // ---- role editor modal ----

  function setToolsSectionVisible(visible: boolean): void {
    const hint = byId('role-tools-default-hint');
    const controls = doc.querySelector<HTMLElement>('.role-tools-controls');
    const list = byId('role-tools-list');
    const formHint = byId('role-tools-section')?.querySelector<HTMLElement>('.form-hint') ?? null;
    for (const element of [controls, list, formHint]) if (element) element.style.display = visible ? 'block' : 'none';
    if (hint) hint.style.display = visible ? 'none' : 'block';
  }

  function setFormValues(values: { title: string; name: string; nameDisabled: boolean; description: string; icon: string; prompt: string; enabled: boolean }): void {
    const set = (id: string, apply: (element: HTMLElement) => void) => { const el = byId(id); if (el) apply(el); };
    set('role-modal-title', el => { el.textContent = values.title; });
    set('role-name', el => { const input = el as HTMLInputElement; input.value = values.name; input.disabled = values.nameDisabled; });
    set('role-description', el => { (el as HTMLInputElement).value = values.description; });
    set('role-icon', el => { (el as HTMLInputElement).value = values.icon; });
    set('role-user-prompt', el => { (el as HTMLTextAreaElement).value = values.prompt; });
    set('role-enabled', el => { (el as HTMLInputElement).checked = values.enabled; });
  }

  function resetToolSearch(): void {
    const input = byId<HTMLInputElement>('role-tools-search');
    if (input) input.value = '';
    const clear = byId('role-tools-search-clear');
    if (clear) clear.style.display = 'none';
  }

  async function openCreate(): Promise<void> {
    if (!deps.can('roles:write') || !byId('role-modal')) return;
    editing = null;
    const workflow = byId<HTMLDetailsElement>('role-workflow-options'); if (workflow) workflow.open = false;
    setFormValues({ title: t('roleModal.addRole', 'Add agent'), name: '', nameDisabled: false, description: '', icon: '', prompt: '', enabled: true });
    await deps.loadWorkflowOptions('');
    const policy = byId<HTMLSelectElement>('role-workflow-policy');
    if (policy) policy.value = 'auto';
    setToolsSectionVisible(true);
    resetToolSearch();
    renderFilterButtons();
    await editor.beginCreate();
    renderTools();
    refreshSkins();
    openCapabilityModal(byId('role-modal'));
  }

  async function openEdit(name: string): Promise<void> {
    const role = service.roles.find(item => item.name === name);
    if (!role) {
      deps.notify(t('roleModal.roleNotFound', 'Agent not found'), 'error');
      return;
    }
    if (!byId('role-modal')) return;
    editing = name;
    const workflow = byId<HTMLDetailsElement>('role-workflow-options'); if (workflow) workflow.open = !!role.workflow_id;
    setFormValues({
      title: t('roleModal.editRole', 'Edit agent'), name: role.name, nameDisabled: true, description: role.description || '',
      icon: role.icon ? decodeRoleIcon(role.icon) : '', prompt: role.user_prompt || '', enabled: role.enabled !== false,
    });
    await deps.loadWorkflowOptions(role.workflow_id || '');
    const policy = byId<HTMLSelectElement>('role-workflow-policy');
    if (policy) policy.value = role.workflow_policy || 'auto';
    const isDefault = name === DEFAULT_ROLE;
    setToolsSectionVisible(!isDefault);
    if (!isDefault) {
      resetToolSearch();
      renderFilterButtons();
      await editor.beginEdit(role);
      renderTools();
    }
    refreshSkins();
    openCapabilityModal(byId('role-modal'));
  }

  function closeModal(): void {
    closeSkinnedSelects();
    closeAppModal('role-modal');
  }

  function payloadFromForm(isDefault: boolean, tools: string[]): RolePayload {
    const value = (id: string) => (byId<HTMLInputElement>(id)?.value ?? '').trim();
    const workflowId = value('role-workflow-id');
    return {
      name: value('role-name'),
      description: value('role-description'),
      icon: encodeRoleIcon(value('role-icon')) || undefined,
      user_prompt: value('role-user-prompt'),
      tools: isDefault ? [] : tools,
      enabled: byId<HTMLInputElement>('role-enabled')?.checked ?? true,
      workflow_id: workflowId || undefined,
      workflow_version: workflowId ? 'latest' : undefined,
      workflow_policy: workflowId ? (value('role-workflow-policy') || 'auto') : undefined,
    };
  }

  async function save(): Promise<void> {
    if (saving || !deps.can('roles:write')) return;
    const name = (byId<HTMLInputElement>('role-name')?.value ?? '').trim();
    if (!name) {
      deps.notify(t('roleModal.roleNameRequired', 'Agent name is required'), 'error');
      return;
    }
    const isEdit = editing !== null;
    const isDefault = name === DEFAULT_ROLE;
    const isFirstUserRole = !isEdit && !isDefault && service.roles.every(role => role.name === DEFAULT_ROLE);
    const plan = await editor.planSave(isDefault, isFirstUserRole);
    if (plan.firstRoleDefault) deps.notify(t('roleModal.firstRoleNoToolsHint', 'The first agent with no tools selected will use all tools by default.'), 'info');
    if (plan.disabledNames.length > 0) {
      const message = `The following ${plan.disabledNames.length} tools are not enabled in MCP Management and cannot be configured for the agent:\n\n${plan.disabledNames.join(', ')}\n\nEnable them in "MCP Management" first, then configure them for the agent.\n\nSave anyway? (Only enabled tools will be saved)`;
      if (!deps.confirm(message)) return;
    }
    saving = true;
    const saveButton = byId('role-modal')?.querySelector<HTMLButtonElement>('[data-action="roles.save"]');
    if (saveButton) { saveButton.disabled = true; saveButton.textContent = 'Saving…'; }
    try {
      await service.saveRole(payloadFromForm(isDefault, plan.tools), isEdit);
      if (plan.disabledNames.length > 0) {
        let names = plan.disabledNames.join(', ');
        if (names.length > 100) names = names.substring(0, 100) + '...';
        deps.notify(`${isEdit ? 'Agent updated' : 'Agent created'}, but ${plan.disabledNames.length} tools not enabled in MCP Management were filtered out: ${names}. Enable them in "MCP Management" first, then configure them for the agent.`, 'warning');
      } else {
        deps.notify(isEdit ? 'Agent updated' : 'Agent created', 'success');
      }
      closeModal();
      await reload();
    } catch (error) {
      console.error('Failed to save role:', error);
      deps.notify('Failed to save agent: ' + (error as Error).message, 'error');
    } finally { saving = false; if (saveButton) { saveButton.disabled = false; saveButton.textContent = t('common.save', 'Save'); } }
  }

  async function remove(name: string): Promise<void> {
    if (name === DEFAULT_ROLE) {
      deps.notify(t('roleModal.cannotDeleteDefaultRole', 'Cannot delete the default agent'), 'error');
      return;
    }
    if (!deps.confirm(`Delete agent "${name}"? This cannot be undone.`)) return;
    try {
      await service.deleteRole(name);
      deps.notify('Agent deleted', 'success');
      // Deleting the active role falls back to the default one.
      if (service.currentRole === name && service.setCurrentRole('')) deps.onRoleChanged();
      await reload();
    } catch (error) {
      console.error('Failed to delete role:', error);
      deps.notify('Failed to delete agent: ' + (error as Error).message, 'error');
    }
  }

  // ---- tools panel ----

  function renderFilterButtons(): void {
    byId('role-tools-status-filter')?.querySelectorAll<HTMLElement>('.btn-filter').forEach(button => {
      button.classList.toggle('active', (button.getAttribute('data-filter') ?? '') === editor.statusFilter);
    });
  }

  function scopeLine(): string {
    const n = editor.pagination.total || 0;
    if (editor.statusFilter === 'role_on') return t('roleModal.statsListScopeRoleOn', `Current list: linked to this agent (${n} items)`, { n });
    if (editor.statusFilter === 'role_off') return t('roleModal.statsListScopeRoleOff', `Current list: not linked to this agent (${n} items)`, { n });
    return t('roleModal.statsListScopeAll', `Current list: all (${n} items)`, { n });
  }

  function renderStats(): void {
    const statsEl = byId('role-tools-stats');
    if (!statsEl) return;
    const stats = editor.stats();
    const pageRow = `<div class="role-tools-stats-row"><span title="${escapeAttr(t('roleModal.statsPageLinkedTitle', 'Checked = link tool to this agent; unrelated to MCP on/off'))}">${escapeHtml(t('roleModal.statsPageLinked', `Checked on this page ${stats.pageChecked} / ${stats.pageTotal}`, { current: stats.pageChecked, total: stats.pageTotal }))}</span></div>`;
    const hint = `<div class="role-tools-stats-hint">${escapeHtml(scopeLine())}</div>`;
    if (stats.usesAllTools) {
      statsEl.innerHTML = `${pageRow}<div class="role-tools-stats-row"><span title="${escapeAttr(t('roleModal.statsRoleUsesAllTitle', 'Matches MCP Management “enabled” count; no explicit tool list'))}">${escapeHtml(t('roleModal.statsRoleUsesAll', `Uses all tools (MCP on ${stats.mcpOnMax} / ${stats.grandAll} total)`, { mcpOn: stats.mcpOnMax, all: stats.grandAll }))}</span></div>${hint}`;
      return;
    }
    const roleRow = stats.mcpOnMax > 0
      ? `<span title="${escapeAttr(t('roleModal.statsRoleLinkedTitle', 'Numerator: checked tools (MCP on only). Denominator: MCP-on tool count (same as MCP Management filter)'))}">${escapeHtml(t('roleModal.statsRoleLinked', `Linked to this agent ${stats.roleLinked} / ${stats.mcpOnMax}`, { current: stats.roleLinked, max: stats.mcpOnMax }))}</span>`
      : `<span title="${escapeAttr(t('roleModal.statsRoleLinkedNoMaxTitle', 'MCP-on total not cached yet'))}">${escapeHtml(t('roleModal.statsRoleLinkedNoMax', `Linked to this agent ${stats.roleLinked}`, { current: stats.roleLinked }))}</span>`;
    statsEl.innerHTML = `${pageRow}<div class="role-tools-stats-row">${roleRow}</div>${hint}`;
  }

  function toolItemHtml(tool: RoleTool): string {
    const key = toolKey(tool);
    const state = editor.selection.states.get(key);
    const isExternal = state ? state.is_external : !!tool.is_external;
    const externalMcp = state?.external_mcp || tool.external_mcp || '';
    const title = escapeAttr(`${tool.name}: ${t('roleModal.checkboxLinkTitle', 'Check to link this tool to this agent')}`);
    const externalBadge = isExternal
      ? `<span class="external-tool-badge" title="${escapeAttr(externalMcp ? `External MCP tool - source: ${externalMcp}` : 'External MCP tool')}">${escapeHtml(externalMcp ? `External (${externalMcp})` : 'External')}</span>`
      : '';
    const disabledBadge = tool.enabled === false
      ? `<span class="role-tool-mcp-disabled-badge" title="${escapeAttr(t('roleModal.mcpDisabledBadgeTitle', 'Off in MCP Management; check only expresses agent linkage—turn on in MCP to run'))}">${escapeHtml(t('roleModal.mcpDisabledBadge', 'MCP off'))}</span>`
      : '';
    return `<div class="role-tool-item" data-tool-key="${escapeAttr(key)}" data-tool-name="${escapeAttr(tool.name)}" data-is-external="${isExternal ? 'true' : 'false'}" data-external-mcp="${escapeAttr(externalMcp)}">
      <input type="checkbox" id="role-tool-${escapeAttr(key).replace(/::/g, '--')}" ${state?.enabled ? 'checked' : ''} title="${title}" aria-label="${title}"
        data-change="roles.tools.toggle" data-tool-key="${escapeAttr(key)}" />
      <div class="role-tool-item-info">
        <div class="role-tool-item-name">${escapeHtml(tool.name)} ${externalBadge} ${disabledBadge}</div>
        <div class="role-tool-item-desc">${escapeHtml(tool.description || 'No description')}</div>
      </div>
    </div>`;
  }

  function paginationHtml(): string {
    const { page, totalPages, total, pageSize } = editor.pagination;
    const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
    const end = total === 0 ? 0 : Math.min(page * pageSize, total);
    const keyword = editor.search;
    const idle = total === 0 || totalPages <= 1;
    const keywordAttr = escapeAttr(keyword);
    const pageButton = (target: number, label: string, off: boolean) => `<button class="btn-secondary" type="button" data-action="roles.tools.page" data-page="${target}" data-keyword="${keywordAttr}" ${off ? 'disabled' : ''}>${escapeHtml(label)}</button>`;
    const sizes = [10, 20, 50, 100].map(size => `<option value="${size}" ${size === pageSize ? 'selected' : ''}>${size}</option>`).join('');
    const info = t('roleModal.paginationShow', `Showing ${start}-${end} / ${total}`, { start, end, total }) + (keyword ? t('roleModal.paginationSearch', `, search: ${keyword}`, { keyword }) : '');
    return `<div class="role-tools-pagination">
      <div class="pagination-info">${escapeHtml(info)}</div>
      <div class="pagination-page-size">
        <label for="role-tools-page-size-pagination">${escapeHtml(t('mcp.perPage', 'Per page:'))}</label>
        <select id="role-tools-page-size-pagination" data-change="roles.tools.pageSize">${sizes}</select>
      </div>
      <div class="pagination-controls">
        ${pageButton(1, t('roleModal.firstPage', 'First'), page === 1 || idle)}
        ${pageButton(page - 1, t('roleModal.prevPage', 'Previous'), page === 1 || idle)}
        <span class="pagination-page">${escapeHtml(t('roleModal.pageOf', `Page ${page} / ${totalPages}`, { page, total: totalPages }))}</span>
        ${pageButton(page + 1, t('roleModal.nextPage', 'Next'), page === totalPages || idle)}
        ${pageButton(totalPages, t('roleModal.lastPage', 'Last'), page === totalPages || idle)}
      </div>
    </div>`;
  }

  function renderTools(): void {
    const list = byId('role-tools-list');
    if (!list) return;
    const banner = editor.statusFilter === 'role_on'
      ? `<div class="role-tools-filter-banner role-tools-filter-banner-on" role="status">${escapeHtml(t('roleModal.roleFilterOnBanner', 'These tools are checked and linked to this agent (independent of MCP-wide enable).'))}</div>`
      : editor.statusFilter === 'role_off'
        ? `<div class="role-tools-filter-banner role-tools-filter-banner-off" role="status">${escapeHtml(t('roleModal.roleFilterOffBanner', 'These tools are unchecked and not linked to this agent.'))}</div>`
        : '';
    const rows = editor.visible.length === 0
      ? `<div class="tools-empty">${escapeHtml(t('roleModal.noTools', 'No tools'))}</div>`
      : `<div class="role-tools-list-items">${editor.visible.map(toolItemHtml).join('')}</div>`;
    list.innerHTML = `${banner}${rows}${paginationHtml()}`;
    deps.initPaginationSelects?.(list);
    renderStats();
  }

  /** Re-lists the tools after a load, search, page or filter change. */
  async function reloadTools(run: () => Promise<void>): Promise<void> {
    try {
      await run();
      renderFilterButtons();
      renderTools();
    } catch (error) {
      console.error('Failed to load tool list:', error);
      const list = byId('role-tools-list');
      if (list) list.innerHTML = `<div class="tools-error">${escapeHtml(t('roleModal.loadToolsFailed', 'Failed to load tools'))}: ${escapeHtml((error as Error).message)}</div>`;
    }
  }

  /** After a checkbox or bulk change: a client filter may need the page re-listed, otherwise only the stats move. */
  async function afterWrite(reload: boolean): Promise<void> {
    if (reload) await reloadTools(() => editor.load(editor.pagination.page, editor.search));
    else renderStats();
  }

  // ---- skinned selects for the workflow fields ----

  function syncSkinned(id: string): void {
    const reg = skinned.get(id);
    if (!reg) return;
    const { select, dropdown, trigger, wrapper } = reg;
    dropdown.innerHTML = Array.from(select.options).map(option => {
      const chosen = option.value === select.value;
      return `<button type="button" class="role-form-select-option${chosen ? ' is-selected' : ''}" role="option" aria-selected="${chosen}"
        data-value="${escapeAttr(option.value)}" data-action="roles.skin.pick" data-select-id="${escapeAttr(id)}">
        <span class="role-form-select-check" aria-hidden="true">✓</span><span class="role-form-select-label">${escapeHtml(option.textContent)}</span>
      </button>`;
    }).join('');
    const value = trigger.querySelector('.role-form-select-value');
    if (value) value.textContent = select.options[select.selectedIndex]?.textContent ?? '';
    trigger.disabled = select.disabled;
    wrapper.classList.toggle('is-disabled', select.disabled);
  }

  function skinSelect(id: string): void {
    const select = byId<HTMLSelectElement>(id);
    if (!select) return;
    const existing = skinned.get(id);
    if (existing && existing.select !== select) skinned.delete(id);
    if (select.dataset.roleFormCustom === '1') {
      syncSkinned(id);
      return;
    }
    select.dataset.roleFormCustom = '1';
    select.classList.add('role-form-native-select');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');

    const wrapper = doc.createElement('div');
    wrapper.className = 'role-form-select-ui';
    const trigger = doc.createElement('button');
    trigger.type = 'button';
    trigger.className = 'role-form-select-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', doc.querySelector(`label[for="${id}"]`)?.textContent ?? id);
    trigger.setAttribute('data-action', 'roles.skin.toggle');
    trigger.setAttribute('data-select-id', id);
    trigger.innerHTML = `<span class="role-form-select-value"></span>${SELECT_CARET}`;
    const dropdown = doc.createElement('div');
    dropdown.className = 'role-form-select-dropdown';
    dropdown.setAttribute('role', 'listbox');
    select.parentNode?.insertBefore(wrapper, select);
    wrapper.append(trigger, dropdown, select);
    skinned.set(id, { wrapper, trigger, dropdown, select });
    select.addEventListener('change', () => syncSkinned(id));
    syncSkinned(id);
  }

  function refreshSkins(): void {
    if (!byId('role-modal')) return;
    for (const id of [...skinned.keys()]) if (!byId(id)) skinned.delete(id);
    WORKFLOW_SELECTS.forEach(skinSelect);
  }

  function closeSkinnedSelects(): void {
    skinned.forEach(reg => {
      reg.wrapper.classList.remove('open');
      reg.trigger.setAttribute('aria-expanded', 'false');
    });
  }

  // ---- bindings ----

  function bind(): () => void {
    const unregister = [
      actions.register('roles.select', element => { selectRole(element.dataset.roleName ?? ''); closePanel(); }),
      actions.register('roles.selectKey', (element, event) => {
        const key = (event as KeyboardEvent).key;
        if (key !== 'Enter' && key !== ' ') return;
        event.preventDefault();
        selectRole(element.dataset.roleName ?? '');
        closePanel();
      }),
      actions.register('roles.panel.toggle', () => togglePanel()),
      actions.register('roles.panel.close', () => closePanel()),
      actions.register('roles.refresh', () => { void refresh(); }),
      actions.register('roles.create', () => { void openCreate(); }),
      actions.register('roles.edit', element => { void openEdit(element.dataset.roleName ?? ''); }),
      actions.register('roles.delete', element => { void remove(element.dataset.roleName ?? ''); }),
      actions.register('roles.search', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          syncSearchClear((byId<HTMLInputElement>('roles-search')?.value ?? '').trim());
          renderList();
        }, SEARCH_DEBOUNCE_MS);
      }),
      actions.register('roles.searchKey', (_element, event) => {
        if ((event as KeyboardEvent).key !== 'Enter') return;
        syncSearchClear((byId<HTMLInputElement>('roles-search')?.value ?? '').trim());
        renderList();
      }),
      actions.register('roles.searchClear', () => clearRolesSearch()),
      actions.register('roles.availability', () => renderList()),
      actions.register('roles.modal.close', () => closeModal()),
      actions.register('roles.save', () => { void save(); }),
      actions.register('roles.tools.toggle', (element) => {
        const key = element.dataset.toolKey ?? '';
        const item = element.closest<HTMLElement>('.role-tool-item');
        const tool = editor.visible.find(candidate => toolKey(candidate) === key) ?? {
          name: item?.dataset.toolName ?? key,
          is_external: item?.dataset.isExternal === 'true',
          external_mcp: item?.dataset.externalMcp ?? '',
        };
        void afterWrite(editor.write(key, tool, (element as HTMLInputElement).checked));
      }),
      actions.register('roles.tools.selectAll', () => { void afterWrite(editor.setVisible(true)); }),
      actions.register('roles.tools.deselectAll', () => { void afterWrite(editor.setVisible(false)); }),
      actions.register('roles.tools.filter', element => {
        void reloadTools(() => editor.setFilter((element.dataset.filter ?? '') as RoleLinkFilter));
      }),
      actions.register('roles.tools.search', (element) => {
        const keyword = (element as HTMLInputElement).value;
        byId('role-tools-search-clear')!.style.display = keyword ? 'block' : 'none';
        void reloadTools(() => editor.setSearch(keyword));
      }),
      actions.register('roles.tools.searchKey', (element, event) => {
        if ((event as KeyboardEvent).key !== 'Enter') return;
        void reloadTools(() => editor.setSearch((element as HTMLInputElement).value));
      }),
      actions.register('roles.tools.searchClear', () => {
        const input = byId<HTMLInputElement>('role-tools-search');
        if (input) input.value = '';
        byId('role-tools-search-clear')!.style.display = 'none';
        void reloadTools(() => editor.setSearch(''));
      }),
      actions.register('roles.tools.page', element => {
        const page = Number(element.dataset.page);
        void reloadTools(() => editor.load(page, element.dataset.keyword ?? ''));
      }),
      actions.register('roles.tools.pageSize', element => {
        const size = parseInt((element as HTMLSelectElement).value, 10);
        if (Number.isNaN(size) || size < 1) return;
        void reloadTools(() => editor.setPageSize(size));
      }),
      actions.register('roles.skin.toggle', element => {
        const reg = skinned.get(element.dataset.selectId ?? '');
        if (!reg || reg.select.disabled) return;
        const open = reg.wrapper.classList.contains('open');
        closeSkinnedSelects();
        if (!open) {
          reg.wrapper.classList.add('open');
          reg.trigger.setAttribute('aria-expanded', 'true');
        }
      }),
      actions.register('roles.skin.pick', element => {
        const reg = skinned.get(element.dataset.selectId ?? '');
        if (!reg) return;
        const value = element.dataset.value ?? '';
        if (reg.select.value !== value) {
          reg.select.value = value;
          reg.select.dispatchEvent(new Event('change', { bubbles: true }));
        }
        reg.wrapper.classList.remove('open');
        reg.trigger.setAttribute('aria-expanded', 'false');
        syncSkinned(element.dataset.selectId ?? '');
      }),
    ];
    // Clicking outside closes the open panels and the skinned selects; a click on the modal backdrop closes the editor.
    const onDocumentClick = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.id === 'role-modal') closeModal();
      const wrapper = chatWrapper();
      if (isPanelOpen() && !(wrapper && target instanceof Node && wrapper.contains(target))) closePanel();
      closeSkinnedSelects();
    };
    const onEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') closeSkinnedSelects(); };
    doc.addEventListener('click', onDocumentClick);
    doc.addEventListener('keydown', onEscape);
    return () => {
      unregister.forEach(dispose => dispose());
      doc.removeEventListener('click', onDocumentClick);
      doc.removeEventListener('keydown', onEscape);
      clearTimeout(searchTimer);
    };
  }

  /** Silent reload used after a save or delete. */
  async function reload(): Promise<void> {
    await service.loadRoles();
    if (deps.isRolesPageOpen()) renderList();
    renderChatSelector();
  }

  /** The refresh button: reloads and confirms with a message. */
  async function refresh(): Promise<void> {
    try {
      await reload();
      deps.notify('Refreshed', 'success');
    } catch (error) {
      deps.notify(t('roles.loadFailed', 'Failed to load agents') + ': ' + (error as Error).message, 'error');
    }
  }

  /** Loads roles when the app starts or the roles page opens. Errors are shown, not thrown. */
  async function loadForPage(): Promise<void> {
    try {
      await reload();
    } catch (error) {
      const list = byId('roles-list'); if (list) list.innerHTML = capabilityState('Could not load agents', 'Check your connection and refresh to try again.', '', true);
      deps.notify(t('roles.loadFailed', 'Failed to load agents') + ': ' + (error as Error).message, 'error');
    }
  }

  return {
    bind,
    renderChatSelector,
    renderList,
    loadForPage,
    refresh,
    selectRole,
    togglePanel,
    closePanel,
    openCreate,
    openEdit,
    save,
    remove,
    /** Re-renders the workflow selects after the options were replaced. */
    refreshSkins,
  };
}

export type RolesView = ReturnType<typeof createRolesView>;
import { browser } from '@/platform/browser';
