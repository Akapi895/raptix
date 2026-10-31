import type { Request } from '../notifications';
import type { UpdateResponse } from './types';

export function createUpdateClient(request: Request) {
  return {
    async run(method: 'GET' | 'POST', path = '', body?: unknown) {
      const response = await request('/api/system/update' + path, {
        method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
      });
      const value: unknown = await response.json().catch(() => ({}));
      const data = value && typeof value === 'object' ? value as UpdateResponse : {};
      const refused = typeof data.error === 'string' && !!data.error;
      return { ok: response.ok && !refused, status: response.status, data, error: refused ? data.error || '' : 'HTTP ' + response.status };
    },
  };
}
export type UpdateClient = ReturnType<typeof createUpdateClient>;
