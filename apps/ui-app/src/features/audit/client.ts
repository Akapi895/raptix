import { http, HttpError } from '../../platform/http';
import type { AuditLog, AuditPage, AuditSummary } from './types';

export function createAuditClient(transport: Pick<typeof http, 'get' | 'raw'> = http) {
  return {
    list: (query: string, signal?: AbortSignal) => transport.get<AuditPage>('/api/audit/logs?' + query, { signal }),
    summary: (query: string, signal?: AbortSignal) => transport.get<AuditSummary>('/api/audit/summary?' + query, { signal }),
    async detail(id: string, signal?: AbortSignal): Promise<AuditLog> {
      const data = await transport.get<{ log: AuditLog } | AuditLog>('/api/audit/logs/' + encodeURIComponent(id), { signal });
      // The demo returns the record directly; Go wraps it in {log}.
      return 'log' in data ? data.log : data;
    },
    async conversationExists(id: string): Promise<boolean | null> {
      try { await transport.get<unknown>('/api/conversations/' + encodeURIComponent(id)); return true; }
      catch (error) { return error instanceof HttpError ? false : null; }
    },
    async export(query: string, format: 'json' | 'csv'): Promise<Blob> {
      const params = new URLSearchParams(query);
      if (format === 'csv') params.set('format', 'csv');
      const response = await transport.raw('/api/audit/logs/export?' + params);
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        throw new HttpError(response.status, '/api/audit/logs/export', body);
      }
      return response.blob();
    },
  };
}
export type AuditClient = ReturnType<typeof createAuditClient>;
