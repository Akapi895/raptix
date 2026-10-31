import type { KeyValueStorage } from '../../platform/storage';
import type { AuditClient } from './client';
import type { AuditFilters, AuditLog, AuditPreset, AuditSummary } from './types';

export const AUDIT_PAGE_SIZE_KEY = 'raptix_audit_page_size';
export const auditPageSizes = [10, 20, 50, 100];
export const emptyAuditFilters = (): AuditFilters => ({ category: '', action: '', result: '', q: '', since: '', until: '' });
export function auditDatetimeLocalToRFC3339(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value.trim());
  if (!m) return '';
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0, 0);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}
export function buildAuditQuery(filters: AuditFilters, pagination?: { page: number; pageSize: number }): string {
  const params = new URLSearchParams();
  if (pagination) { params.set('page', String(pagination.page)); params.set('page_size', String(pagination.pageSize)); }
  for (const key of ['category', 'action', 'result', 'q'] as const) {
    const value = key === 'q' ? filters[key].trim() : filters[key];
    if (value) params.set(key, value);
  }
  for (const key of ['since', 'until'] as const) {
    const value = auditDatetimeLocalToRFC3339(filters[key]);
    if (value) params.set(key, value);
  }
  return params.toString();
}
export function auditPresetRange(preset: string, now = new Date()): { since: Date; until: Date } | null {
  const durations: Record<Exclude<AuditPreset, 'today'>, number> = { '15m': 900000, '1h': 3600000, '24h': 86400000, '7d': 604800000 };
  const duration = durations[preset as keyof typeof durations];
  const since = preset === 'today' ? new Date(now.getFullYear(), now.getMonth(), now.getDate()) : duration ? new Date(now.getTime() - duration) : null;
  return since ? { since, until: new Date(now) } : null;
}
const removedActions = new Set(['delete', 'item_delete', 'connection_delete', 'listener_delete', 'session_delete', 'task_delete', 'execution_delete', 'execution_delete_batch', 'delete_queue', 'delete_batch_task', 'markdown_delete']);
export const auditResourceUnavailable = (log: AuditLog): boolean => removedActions.has(log.action) || log.resourceAvailable === false;
export function auditResourceDestination(log: AuditLog): { page: string; section?: string; conversationId?: string } | null {
  const id = log.resourceId;
  if (!id || auditResourceUnavailable(log)) return null;
  const type = log.resourceType || '';
  if (type === 'conversation' || (!type && id.length > 8 && !id.startsWith('c2_'))) return { page: 'chat', conversationId: id };
  const pages: Record<string, string> = { vulnerability: 'vulnerabilities', batch_queue: 'tasks', c2_listener: 'c2-listeners', c2_session: 'c2-sessions', c2_task: 'c2-tasks', webshell_connection: 'webshell', knowledge_item: 'knowledge-management', chat_upload: 'chat-files', tool_execution: 'mcp-monitor' };
  if (['role', 'skill', 'markdown_agent'].includes(type)) return { page: 'settings', section: 'roles' };
  return pages[type] ? { page: pages[type] } : null;
}
export interface AuditState { page: number; pageSize: number; total: number; logs: AuditLog[]; filters: AuditFilters }
export interface AuditObserver {
  loading(): void; loaded(state: Readonly<AuditState>): void; summary(value: AuditSummary): void; error(error: unknown): void;
}
export function createAuditService(client: AuditClient, storage: KeyValueStorage, observer: AuditObserver) {
  const saved = Number(storage.get(AUDIT_PAGE_SIZE_KEY));
  const state: AuditState = { page: 1, pageSize: auditPageSizes.includes(saved) ? saved : 20, total: 0, logs: [], filters: emptyAuditFilters() };
  let sequence = 0;
  let controller: AbortController | null = null;
  let disposed = false;
  const snapshot = (): AuditState => ({ ...state, filters: { ...state.filters }, logs: [...state.logs] });
  async function load(page = state.page): Promise<void> {
    if (disposed) return;
    controller?.abort(); controller = new AbortController();
    const signal = controller.signal;
    const request = ++sequence;
    state.page = page;
    observer.loading();
    try {
      const data = await client.list(buildAuditQuery(state.filters, state), signal);
      if (disposed || request !== sequence) return;
      state.total = typeof data.total === 'number' ? data.total : 0;
      state.logs = data.logs || [];
      const maxPage = Math.max(1, Math.ceil(state.total / state.pageSize));
      if (state.page > maxPage) { await load(maxPage); return; }
      observer.loaded(snapshot());
      try {
        const summary = await client.summary(buildAuditQuery(state.filters), signal);
        if (!disposed && request === sequence) observer.summary(summary);
      } catch { /* Summary is best-effort, as in the original UI. */ }
    } catch (error) { if (!disposed && request === sequence) observer.error(error); }
  }
  return {
    snapshot, load,
    refresh(filters = state.filters, page = state.page): Promise<void> { state.filters = { ...filters }; return load(page); },
    filter(filters: AuditFilters): Promise<void> { state.filters = { ...filters }; return load(1); },
    pageSize(size: number, filters = state.filters): Promise<void> { if (!auditPageSizes.includes(size)) return Promise.resolve(); state.pageSize = size; state.filters = { ...filters }; storage.set(AUDIT_PAGE_SIZE_KEY, String(size)); return load(1); },
    goPage(page: number): Promise<void> { return page >= 1 && page <= Math.max(1, Math.ceil(state.total / state.pageSize)) ? load(page) : Promise.resolve(); },
    detail: client.detail,
    conversationExists: client.conversationExists,
    export: (format: 'json' | 'csv', filters = state.filters) => client.export(buildAuditQuery(filters), format),
    dispose(): void { disposed = true; ++sequence; controller?.abort(); controller = null; },
  };
}
export type AuditService = ReturnType<typeof createAuditService>;
