import type { KeyValueStorage } from '../../platform/storage';
import { filterByRoleLink, keyFallbackName, pageSizeFromStorage, RoleToolSelection, toolKey, type Role, type RoleLinkFilter, type RoleTool } from './model';
import type { RolesService, ToolPage } from './service';

const TOOL_PAGE_SIZE_KEY = 'toolsPageSize';
const CATALOG_PAGE_SIZE = 100;

export interface Pagination { page: number; pageSize: number; total: number; totalPages: number }

export interface SavePlan {
  /** Keys written to the role. Empty when the role uses every tool. */
  tools: string[];
  /** Names of linked tools the MCP page has switched off; saving drops them. */
  disabledNames: string[];
  usesAllTools: boolean;
  /** The first user-created role with nothing picked gets every tool, and the user is told so. */
  firstRoleDefault: boolean;
}

export interface ToolStats {
  pageChecked: number;
  pageTotal: number;
  usesAllTools: boolean;
  mcpOnMax: number;
  grandAll: number;
  roleLinked: number;
  total: number;
}

/**
 * Tool-linking state for the role editor: the paged catalogue, the selection across pages,
 * the "linked to this role" filter, and the save plan. It does not touch the DOM.
 */
export function createRoleToolsEditor(options: { service: RolesService; storage: KeyValueStorage }) {
  const { service, storage } = options;
  const selection = new RoleToolSelection();
  let pagination: Pagination = { page: 1, pageSize: pageSizeFromStorage(storage.get(TOOL_PAGE_SIZE_KEY)), total: 0, totalPages: 1 };
  let statusFilter: RoleLinkFilter = '';
  let search = '';
  let visible: RoleTool[] = [];
  let clientMode = false;
  let catalogue: RoleTool[] | null = null;
  let catalogueSearch = '';
  let grandTotal = 0;
  let mcpEnabledTotal = 0;

  function mergeAll(tools: readonly RoleTool[]): void {
    tools.forEach(tool => selection.merge(tool));
  }

  /** Pulls the whole catalogue for a search and, for the status filter, merges every tool into the state. */
  async function fetchCatalogue(keyword: string): Promise<void> {
    const all = await service.listAllTools(keyword, CATALOG_PAGE_SIZE);
    mergeAll(all);
    catalogue = all;
    catalogueSearch = keyword;
    grandTotal = all.length;
    mcpEnabledTotal = all.filter(tool => tool.enabled !== false).length;
  }

  function applyPage(result: ToolPage): void {
    visible = result.tools;
    pagination = { page: result.page, pageSize: result.pageSize, total: result.total, totalPages: result.totalPages };
    if (statusFilter === '' && !search) {
      grandTotal = result.total;
      if (result.totalEnabled !== undefined) mcpEnabledTotal = result.totalEnabled;
    }
    mergeAll(visible);
  }

  async function load(page = 1, keyword = search): Promise<void> {
    if (statusFilter !== '') {
      clientMode = true;
      if (keyword !== catalogueSearch || !catalogue || catalogue.length === 0) await fetchCatalogue(keyword);
      const filtered = filterByRoleLink(catalogue ?? [], statusFilter, (key, tool) => selection.isLinked(key, tool));
      const totalPages = Math.max(1, Math.ceil(filtered.length / pagination.pageSize) || 1);
      const current = Math.min(Math.max(1, page), totalPages);
      pagination = { page: current, pageSize: pagination.pageSize, total: filtered.length, totalPages };
      visible = filtered.slice((current - 1) * pagination.pageSize, current * pagination.pageSize);
      return;
    }
    clientMode = false;
    catalogue = null;
    catalogueSearch = '';
    applyPage(await service.listTools(page, pagination.pageSize, keyword));
  }

  function reset(): void {
    selection.reset();
    statusFilter = '';
    search = '';
    clientMode = false;
    catalogue = null;
    catalogueSearch = '';
    pagination = { ...pagination, page: 1, pageSize: pageSizeFromStorage(storage.get(TOOL_PAGE_SIZE_KEY)) };
  }

  /** Whether a write to one checkbox must re-run the client-side filter (the row may leave the list). */
  function needsReloadAfterWrite(): boolean {
    return clientMode && statusFilter !== '';
  }

  function stats(): ToolStats {
    return {
      pageChecked: visible.filter(tool => selection.states.get(toolKey(tool))?.enabled).length,
      pageTotal: visible.length,
      usesAllTools: selection.usesAllTools,
      mcpOnMax: mcpEnabledTotal,
      grandAll: grandTotal > 0 ? grandTotal : pagination.total,
      roleLinked: selection.linkedCount(),
      total: pagination.total,
    };
  }

  /** Marks the visible rows as linked (or not) the way the checkboxes read after the role opens. */
  function syncVisibleForAllTools(): void {
    for (const tool of visible) {
      const key = toolKey(tool);
      const state = selection.states.get(key);
      const shouldEnable = state ? state.mcpEnabled !== false : true;
      if (state) {
        state.enabled = shouldEnable;
      } else {
        selection.states.set(key, {
          enabled: shouldEnable, is_external: tool.is_external || false, external_mcp: tool.external_mcp || '',
          name: tool.name, mcpEnabled: true,
        });
      }
    }
  }

  /** Fetches the catalogue into the state so the save can tell MCP-disabled picks apart. */
  async function loadAllToSelection(): Promise<void> {
    const all = await service.listAllTools('', CATALOG_PAGE_SIZE);
    for (const tool of all) {
      const key = toolKey(tool);
      if (!selection.states.has(key)) {
        selection.states.set(key, {
          enabled: selection.usesAllTools ? !!tool.enabled : selection.configured.has(key),
          is_external: tool.is_external || false, external_mcp: tool.external_mcp || '',
          name: tool.name, mcpEnabled: tool.enabled,
        });
      } else {
        const state = selection.states.get(key)!;
        state.is_external = tool.is_external || false;
        state.external_mcp = tool.external_mcp || '';
        state.mcpEnabled = tool.enabled;
        if (!state.name || state.name === keyFallbackName(key)) state.name = tool.name;
      }
    }
  }

  return {
    get pagination(): Pagination { return pagination; },
    get visible(): readonly RoleTool[] { return visible; },
    get statusFilter(): RoleLinkFilter { return statusFilter; },
    get search(): string { return search; },
    get selection(): RoleToolSelection { return selection; },
    stats,
    load,
    reset,

    /** Opens the editor for a new role: nothing linked, the role uses only what the user picks. */
    async beginCreate(): Promise<void> {
      reset();
      await load(1, '');
    },

    /** Opens an existing role. The default role has no tool list to edit and is not loaded. */
    async beginEdit(role: Role): Promise<void> {
      reset();
      const configured = role.tools && role.tools.length > 0 ? role.tools : (role.mcps ?? []);
      selection.usesAllTools = !role.tools || role.tools.length === 0;
      configured.forEach(key => selection.configured.add(key));
      if (configured.length > 0) {
        selection.usesAllTools = false;
        selection.preselect(configured);
      }
      await load(1, '');
      if (selection.usesAllTools) {
        syncVisibleForAllTools();
      } else if (configured.length > 0) {
        selection.setSelected(configured);
      }
    },

    /** Records one checkbox. Returns true when the caller must reload the page (client filter mode). */
    write(key: string, meta: RoleTool, checked: boolean): boolean {
      selection.write(key, {
        name: meta.name, is_external: meta.is_external || false, external_mcp: meta.external_mcp || '',
      }, checked);
      return needsReloadAfterWrite();
    },

    /** Links every visible tool that the MCP page has enabled, or clears them all. */
    setVisible(checked: boolean): boolean {
      for (const tool of visible) {
        const key = toolKey(tool);
        const existing = selection.states.get(key);
        const enabled = checked && !!existing && existing.mcpEnabled !== false;
        selection.write(key, { name: tool.name, is_external: tool.is_external || false, external_mcp: tool.external_mcp || '' }, enabled);
      }
      return needsReloadAfterWrite();
    },

    async setFilter(status: RoleLinkFilter): Promise<void> {
      statusFilter = status;
      await load(1, search);
    },

    async setPageSize(pageSize: number): Promise<void> {
      storage.set(TOOL_PAGE_SIZE_KEY, String(pageSize));
      pagination = { ...pagination, pageSize };
      await load(1, search);
    },

    async setSearch(keyword: string): Promise<void> {
      search = keyword;
      await load(1, keyword);
    },

    /** Works out what the save sends. Loads the catalogue first when the role uses every tool. */
    async planSave(isDefaultRole: boolean, isFirstUserRole: boolean): Promise<SavePlan> {
      if (isDefaultRole) return { tools: [], disabledNames: [], usesAllTools: false, firstRoleDefault: false };
      let linked = selection.linkedEntries();
      let firstRoleDefault = false;
      if (isFirstUserRole && linked.length === 0) {
        selection.usesAllTools = true;
        firstRoleDefault = true;
      } else if (selection.usesAllTools) {
        if (selection.hasUnselectedEnabled()) {
          await loadAllToSelection();
          selection.linkEnabledExceptUnlinked();
          selection.usesAllTools = false;
        } else {
          await loadAllToSelection();
          if (!selection.hasDisabledSelected()) selection.linkAllEnabled();
          linked = selection.linkedEntries();
        }
      }
      const disabledKeys = selection.disabledKeys(linked.map(entry => entry.key));
      return {
        tools: selection.usesAllTools ? [] : selection.selectedKeys(),
        disabledNames: disabledKeys.map(key => selection.states.get(key)?.name || keyFallbackName(key)),
        usesAllTools: selection.usesAllTools,
        firstRoleDefault,
      };
    },
  };
}

export type RoleToolsEditor = ReturnType<typeof createRoleToolsEditor>;
