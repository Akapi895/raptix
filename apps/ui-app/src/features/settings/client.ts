import type { ApiFetch } from './contracts';
import { readError } from './contracts';
import { decodeMCPData, decodeMCPServer, decodeToolPage, object, type ConfigObject, type ConnectionResult, type Credentials, type MCPConfig, type ToolSchema } from './model';

/** The only settings transport boundary. Both Go and demo responses are decoded here. */
export function createSettingsClient(request: ApiFetch) {
  async function json(path: string, init?: RequestInit): Promise<unknown> {
    const response = await request(path, init);
    if (!response.ok) throw new Error(await readError(response, `HTTP ${response.status}`));
    const body = await response.text(); return body ? JSON.parse(body) as unknown : {};
  }
  const send = (path: string, method: string, body?: unknown) => json(path, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  return {
    config: async (signal?: AbortSignal) => object(await json('/api/config', { signal })),
    write: (config: ConfigObject) => send('/api/config', 'PUT', config),
    apply: () => send('/api/config/apply', 'POST'),
    tools: async (page: number, size: number, filters: { search?: string; enabled?: string; external_mcp?: string; refresh_external?: boolean } = {}, signal?: AbortSignal) => {
      const query = new URLSearchParams({ page: String(page), page_size: String(size) });
      for (const [key, value] of Object.entries(filters)) if (value !== '' && value !== undefined && value !== false) query.set(key, String(value));
      return decodeToolPage(await json(`/api/config/tools?${query}`, { signal }), page, size);
    },
    schema: async (name: string, mcp = ''): Promise<ToolSchema> => {
      const result = object(await json(`/api/config/tools/${encodeURIComponent(name)}/schema${mcp ? `?external_mcp=${encodeURIComponent(mcp)}` : ''}`));
      return object(result.input_schema) as ToolSchema;
    },
    test: async (kind: 'openai' | 'vision' | 'typesafe', body: ConfigObject): Promise<ConnectionResult> => object(await send(`/api/config/test-${kind}`, 'POST', body)) as ConnectionResult,
    models: async (credentials: Credentials): Promise<ConnectionResult> => {
      const result = object(await send('/api/config/list-models', 'POST', credentials));
      // The demo returns {models}; Go additionally supplies success/supported/count.
      return { ...result, success: result.success === true || (result.success === undefined && Array.isArray(result.models)), models: Array.isArray(result.models) ? result.models.filter((v): v is string => typeof v === 'string') : [] } as ConnectionResult;
    },
    changePassword: (oldPassword: string, newPassword: string) => send('/api/auth/change-password', 'POST', { oldPassword, newPassword }),
    mcps: async () => decodeMCPData(await json('/api/external-mcp')),
    mcp: async (name: string) => decodeMCPServer(await json(`/api/external-mcp/${encodeURIComponent(name)}`)),
    saveMCP: (name: string, config: MCPConfig) => send(`/api/external-mcp/${encodeURIComponent(name)}`, 'PUT', { config }),
    deleteMCP: (name: string) => send(`/api/external-mcp/${encodeURIComponent(name)}`, 'DELETE'),
    toggleMCP: (name: string, action: 'start' | 'stop') => send(`/api/external-mcp/${encodeURIComponent(name)}/${action}`, 'POST'),
  };
}
export type SettingsClient = ReturnType<typeof createSettingsClient>;
