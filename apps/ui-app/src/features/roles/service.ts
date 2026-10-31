import type { KeyValueStorage } from '../../platform/storage';
import { DEFAULT_ROLE, type Role, type RoleTool } from './model';

export type RequestFn = (path: string, init?: RequestInit) => Promise<Response>;

export interface RolePayload {
  name: string;
  description: string;
  icon?: string;
  user_prompt: string;
  tools: string[];
  enabled: boolean;
  workflow_id?: string;
  workflow_version?: string;
  workflow_policy?: string;
}

export interface ToolPage {
  tools: (RoleTool & { description?: string })[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  totalEnabled?: number;
}

export class RoleError extends Error {}

const CURRENT_ROLE_KEY = 'currentRole';

export function createRolesService(options: { request: RequestFn; storage: KeyValueStorage }) {
  const { request, storage } = options;
  let roles: Role[] = [];
  let currentRole = storage.get(CURRENT_ROLE_KEY) ?? '';

  /** Reads the response body, or the server's `error` field. Non-JSON bodies fall back to the message. */
  async function failure(response: Response, fallback: string): Promise<RoleError> {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    return new RoleError(body?.error || fallback);
  }

  return {
    get roles(): readonly Role[] { return roles; },
    get currentRole(): string { return currentRole; },

    /** Stores the chosen role; the default role is stored as the empty string, as before. */
    setCurrentRole(name: string): boolean {
      const next = name === DEFAULT_ROLE ? '' : name;
      if (next === currentRole) return false;
      currentRole = next;
      storage.set(CURRENT_ROLE_KEY, currentRole);
      return true;
    },

    async loadRoles(): Promise<Role[]> {
      const response = await request('/api/roles');
      if (!response.ok) throw new RoleError('Failed to load agents');
      const data = await response.json() as { roles?: Role[] };
      roles = data.roles ?? [];
      return roles;
    },

    hasRole(name: string): boolean {
      return roles.some(role => role.name === name);
    },

    async saveRole(payload: RolePayload, isEdit: boolean): Promise<void> {
      const url = isEdit ? `/api/roles/${encodeURIComponent(payload.name)}` : '/api/roles';
      const response = await request(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw await failure(response, 'Failed to save the agent');
    },

    async deleteRole(name: string): Promise<void> {
      const response = await request(`/api/roles/${encodeURIComponent(name)}`, { method: 'DELETE' });
      if (!response.ok) throw await failure(response, 'Failed to delete the agent');
    },

    async listTools(page: number, pageSize: number, search: string): Promise<ToolPage> {
      const query = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
      if (search) query.set('search', search);
      const response = await request(`/api/config/tools?${query.toString()}`);
      if (!response.ok) throw new RoleError('Failed to load the tool list');
      const result = await response.json() as {
        tools?: ToolPage['tools']; page?: number; page_size?: number; total?: number; total_pages?: number; total_enabled?: number;
      };
      return {
        tools: result.tools ?? [],
        page: result.page ?? page,
        pageSize: result.page_size ?? pageSize,
        total: result.total ?? 0,
        totalPages: result.total_pages ?? 1,
        totalEnabled: result.total_enabled,
      };
    },

    /** Every page of the tool catalogue, optionally filtered by a search term. */
    async listAllTools(search: string, pageSize: number): Promise<ToolPage['tools']> {
      const all: ToolPage['tools'] = [];
      let page = 1;
      let totalPages = 1;
      do {
        const result = await this.listTools(page, pageSize, search);
        all.push(...result.tools);
        totalPages = Math.max(1, result.totalPages);
        page++;
      } while (page <= totalPages);
      return all;
    },
  };
}

export type RolesService = ReturnType<typeof createRolesService>;
