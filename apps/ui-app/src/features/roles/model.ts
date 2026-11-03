// internal/config/config.go RoleConfig and internal/handler/config.go tool list DTOs.
import { BACKEND_DEFAULT_ROLE } from '@/platform/backend-legacy-strings';

export const DEFAULT_ROLE = BACKEND_DEFAULT_ROLE;

export interface Role {
  name: string;
  description?: string;
  icon?: string;
  user_prompt?: string;
  tools?: string[] | null;
  mcps?: string[] | null;
  enabled?: boolean;
  workflow_id?: string;
  workflow_policy?: string;
}

export interface RoleTool {
  name: string;
  description?: string;
  enabled?: boolean;
  is_external?: boolean;
  external_mcp?: string;
}

/** One tool's link state for the role being edited. mcpEnabled is the MCP page's own switch. */
export interface ToolState {
  enabled: boolean;
  is_external: boolean;
  external_mcp: string;
  name: string;
  mcpEnabled?: boolean;
}

export type RoleLinkFilter = '' | 'role_on' | 'role_off';

const UNICODE_ESCAPE = /^"?\\U([0-9A-F]{8})"?$/i;

/** Turns a stored `\U0001F3C6` escape (optionally quoted) into the emoji. Other values pass through. */
export function decodeRoleIcon(icon: string): string {
  const match = icon.match(UNICODE_ESCAPE);
  if (!match) return icon;
  try {
    return String.fromCodePoint(parseInt(match[1]!, 16));
  } catch {
    return icon;
  }
}

/** Stores an emoji as the `\UXXXXXXXX` escape the server's YAML expects. Plain ASCII stays as typed. */
export function encodeRoleIcon(icon: string): string {
  const trimmed = icon.trim();
  if (!trimmed) return '';
  const codePoint = trimmed.codePointAt(0);
  if (codePoint && codePoint > 0x7f) return '\\U' + codePoint.toString(16).toUpperCase().padStart(8, '0');
  return trimmed;
}

export function sortRoles(roles: readonly Role[]): Role[] {
  const defaultRole = roles.find(role => role.name === DEFAULT_ROLE);
  const others = roles.filter(role => role.name !== DEFAULT_ROLE)
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'en-US'));
  return defaultRole ? [defaultRole, ...others] : others;
}

/** A description that is a stray i18n key counts as empty. */
export function plainDescription(role: Role): string {
  const raw = typeof role.description === 'string' ? role.description.trim() : '';
  if (raw === 'roles.noDescription' || raw === 'roles.noDescriptionShort') return '';
  return raw;
}

/** Unique tool identity: external tools are namespaced by their MCP server. */
export function toolKey(tool: RoleTool): string {
  return tool.is_external && tool.external_mcp ? `${tool.external_mcp}::${tool.name}` : tool.name;
}

export function keyFallbackName(key: string): string {
  return key.split('::').pop() || key;
}

/**
 * Selection state for a role's tool list across pages. Keys are tool keys; the server's
 * page of tools is merged in, and the role's own configuration decides the initial checks.
 */
export class RoleToolSelection {
  readonly states = new Map<string, ToolState>();
  readonly configured = new Set<string>();
  /** True when the role has no explicit tool list: every MCP-enabled tool is linked by default. */
  usesAllTools = false;

  reset(): void {
    this.states.clear();
    this.configured.clear();
    this.usesAllTools = false;
  }

  /** Merges one server tool into the state map, keeping any choice already made. */
  merge(tool: RoleTool): void {
    const key = toolKey(tool);
    const existing = this.states.get(key);
    if (!existing) {
      const enabled = this.usesAllTools ? !!tool.enabled : this.configured.has(key);
      this.states.set(key, {
        enabled, is_external: tool.is_external || false, external_mcp: tool.external_mcp || '',
        name: tool.name, mcpEnabled: tool.enabled,
      });
      return;
    }
    if (this.usesAllTools && tool.enabled) existing.enabled = true;
    existing.is_external = tool.is_external || false;
    existing.external_mcp = tool.external_mcp || '';
    existing.mcpEnabled = tool.enabled;
    if (!existing.name || existing.name === keyFallbackName(key)) existing.name = tool.name;
  }

  /** Whether the role links this tool, as the checkbox should show it before any user change. */
  isLinked(key: string, tool: RoleTool): boolean {
    const state = this.states.get(key);
    if (state) return !!state.enabled;
    if (this.usesAllTools) return tool.enabled !== false;
    return this.configured.has(key);
  }

  /** Records a checkbox choice. Keeps the MCP switch the state already knows. */
  write(key: string, meta: { name: string; is_external: boolean; external_mcp: string }, enabled: boolean): void {
    const existing = this.states.get(key);
    this.states.set(key, {
      enabled, is_external: meta.is_external, external_mcp: meta.external_mcp, name: meta.name,
      mcpEnabled: existing ? existing.mcpEnabled : true,
    });
  }

  /** Pre-links a role's configured keys before the server's pages are merged in. */
  preselect(keys: readonly string[]): void {
    for (const key of keys) {
      const state = this.states.get(key);
      if (state) state.enabled = true;
      else this.states.set(key, { enabled: true, is_external: false, external_mcp: '', name: keyFallbackName(key) });
    }
  }

  /** Links exactly the given keys, used when an existing role is opened. */
  setSelected(keys: readonly string[]): void {
    const selected = new Set(keys);
    this.states.forEach((state, key) => { state.enabled = selected.has(key); });
  }

  /** Linked and enabled on the MCP page: what gets saved as the role's tools. */
  selectedKeys(): string[] {
    return [...this.states].filter(([, state]) => state.enabled && state.mcpEnabled !== false).map(([key]) => key);
  }

  /** Every linked tool, including ones the MCP page has switched off (the save flow warns about those). */
  linkedEntries(): { key: string; name: string; mcpEnabled: boolean }[] {
    return [...this.states].filter(([, state]) => state.enabled).map(([key, state]) => ({
      key, name: state.name || keyFallbackName(key), mcpEnabled: state.mcpEnabled !== false,
    }));
  }

  disabledKeys(keys: readonly string[]): string[] {
    return keys.filter(key => this.states.get(key)?.mcpEnabled === false);
  }

  hasUnselectedEnabled(): boolean {
    return [...this.states.values()].some(state => state.mcpEnabled !== false && !state.enabled);
  }

  hasDisabledSelected(): boolean {
    return [...this.states.values()].some(state => state.enabled && state.mcpEnabled === false);
  }

  /** Marks every MCP-enabled tool as linked. Used when a role keeps "all tools". */
  linkAllEnabled(): void {
    this.states.forEach(state => { if (state.mcpEnabled !== false) state.enabled = true; });
  }

  /** Marks MCP-enabled tools as linked unless the user explicitly unlinked them. */
  linkEnabledExceptUnlinked(): void {
    this.states.forEach(state => { if (state.mcpEnabled !== false && state.enabled !== false) state.enabled = true; });
  }

  /** Number of linked tools that are also enabled on the MCP page. */
  linkedCount(): number {
    let count = 0;
    this.states.forEach(state => { if (state.enabled && state.mcpEnabled !== false) count++; });
    return count;
  }
}

/** Keeps the tools that match a "linked to this role" filter. Filter '' keeps everything. */
export function filterByRoleLink<T extends RoleTool>(
  tools: readonly T[], filter: RoleLinkFilter, linked: (key: string, tool: T) => boolean,
): T[] {
  if (filter === '') return [...tools];
  return tools.filter(tool => {
    const isLinked = linked(toolKey(tool), tool);
    return filter === 'role_on' ? isLinked : !isLinked;
  });
}

export function pageSizeFromStorage(saved: string | null): number {
  const n = saved ? parseInt(saved, 10) : 20;
  return Number.isNaN(n) || n < 1 ? 20 : n;
}
