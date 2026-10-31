import { z } from 'zod';
import type { KeyValueStorage } from '../../platform/storage';
import type { RequestFn } from '../workflows';
import { activeTaskSchema, queueSchema, clampConcurrency, validateSchedule, type ActiveTask, type BatchQueue, type QueueInput, type QueueMetadata } from './model';
import { batchRunSchema } from './model';

export function createTasksService(options: { request: RequestFn; storage: KeyValueStorage; now?: () => number; projects?: () => Promise<{ id: string; name: string }[] | undefined> }) {
  const { request, storage } = options, now = options.now ?? Date.now;
  let queues: BatchQueue[] = [], active: ActiveTask[] = [], history: ActiveTask[] = [];
  let currentQueue: BatchQueue | null = null;
  let page = 1, pageSize = 10, status = 'all', keyword = '', total = 0, totalPages = 1;
  let listGeneration = 0;
  let unwrappedQueueApi = false;
  const selected = new Set<string>();
  let showHistory = storage.get('tasks-show-history') !== 'false';
  function persistHistory(): void { storage.set('tasks-completed-history', JSON.stringify(history)); }
  try {
    const raw: unknown = JSON.parse(storage.get('tasks-completed-history') ?? '[]');
    history = z.array(activeTaskSchema).parse(raw).filter(task => new Date(task.completedAt || task.startedAt || '').getTime() > now() - 86400000).slice(0, 50);
    persistHistory();
  } catch { history = []; }
  async function json(path: string, init?: RequestInit): Promise<unknown> {
    const response = await request(path, init);
    const raw: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const e = z.object({ error: z.string().optional() }).safeParse(raw);
      throw new Error(e.success && e.data.error ? e.data.error : `HTTP ${response.status}`);
    }
    return raw;
  }
  const body = (method: string, payload: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const path = (id: string) => '/api/batch-tasks/' + encodeURIComponent(id);
  const service = {
    get queues(): readonly BatchQueue[] { return queues; }, get active(): readonly ActiveTask[] { return active; }, get history(): readonly ActiveTask[] { return history; },
    get currentQueue(): BatchQueue | null { return currentQueue; }, get selected(): ReadonlySet<string> { return selected; },
    get pagination() { return { page, pageSize, total, totalPages, status, keyword }; },
    get showHistory(): boolean { return showHistory; },
    get autoRefresh(): boolean { return storage.get('tasks-auto-refresh') !== 'false'; },
    setAutoRefresh(enabled: boolean): void { storage.set('tasks-auto-refresh', String(enabled)); },
    setShowHistory(show: boolean): void { showHistory = show; storage.set('tasks-show-history', String(show)); },
    select(id: string, checked: boolean): void { if (checked) selected.add(id); else selected.delete(id); },
    clearSelection(): void { selected.clear(); }, clearHistory(): void { history = []; persistHistory(); },
    closeQueue(): void { currentQueue = null; },
    setFilters(nextStatus: string, search: string): void { status = nextStatus; keyword = search.trim(); page = 1; },
    setPageSize(size: number): void { if (size > 0 && Number.isInteger(size)) { pageSize = size; page = 1; } },
    async list(nextPage = page): Promise<void> {
      page = Math.max(1, nextPage); const generation = ++listGeneration;
      const query = new URLSearchParams({ page: String(page), limit: String(pageSize) });
      if (status !== 'all') query.set('status', status); if (keyword) query.set('keyword', keyword);
      const result = z.object({ queues: z.array(queueSchema).nullish(), total: z.number().optional(), total_pages: z.number().optional() }).parse(await json('/api/batch-tasks?' + query));
      if (generation !== listGeneration) return;
      queues = result.queues ?? []; total = result.total ?? 0; totalPages = result.total_pages || 1;
    },
    async detail(id: string): Promise<BatchQueue> {
      const raw = z.object({ queue: queueSchema.optional() }).passthrough().parse(await json(path(id)));
      if (raw.queue) return raw.queue;
      const queue = queueSchema.parse(raw); unwrappedQueueApi = true; return queue;
    },
    async runs(offset = 0) { return z.object({ runs: z.array(batchRunSchema).nullish().transform(r => r ?? []), hasMore: z.boolean().default(false) }).parse(await json('/api/batch-tasks/runs?limit=50&offset=' + offset)); },
    setCurrentQueue(queue: BatchQueue): void { currentQueue = queue; },
    async create(input: QueueInput): Promise<string> {
      const tasks = input.tasks.map(s => s.trim()).filter(Boolean); if (!tasks.length) throw new Error('tasks.enterTaskPrompt');
      const scheduleError = validateSchedule(input.scheduleMode, input.cronExpr); if (scheduleError) throw new Error(scheduleError);
      const payload = { ...input, title: input.title.trim(), tasks, cronExpr: input.cronExpr.trim(), concurrency: clampConcurrency(input.concurrency) };
      const raw = z.object({ queueId: z.string().optional(), id: z.string().optional(), queue: queueSchema.optional() }).parse(await json('/api/batch-tasks', body('POST', payload)));
      const id = raw.queueId || raw.queue?.id || raw.id; if (!id) throw new Error('tasks.createBatchQueueFailed'); return id;
    },
    async command(id: string, action: 'start' | 'pause' | 'rerun'): Promise<void> { await json(path(id) + '/' + action, { method: 'POST' }); },
    async remove(id: string): Promise<void> { await json(path(id), { method: 'DELETE' }); },
    async metadata(id: string, patch: Partial<QueueMetadata>): Promise<void> {
      if (patch.concurrency !== undefined && (!Number.isInteger(patch.concurrency) || patch.concurrency < 1 || patch.concurrency > 8)) throw new Error('tasks.concurrencyInvalid');
      const queue = await service.detail(id);
      await json(path(id) + '/metadata', body('PUT', { title: queue.title, role: queue.role, ...patch }));
    },
    async schedule(id: string, scheduleMode: string, cronExpr: string): Promise<void> {
      const error = validateSchedule(scheduleMode, cronExpr); if (error) throw new Error(error);
      await json(path(id) + '/schedule', body('PUT', { scheduleMode, cronExpr: cronExpr.trim() }));
    },
    async scheduleEnabled(id: string, enabled: boolean): Promise<void> {
      // The current demo's unwrapped queue API reads `enabled`; Go reads `scheduleEnabled`.
      await json(path(id) + '/schedule-enabled', body('PUT', { scheduleEnabled: enabled, ...(unwrappedQueueApi ? { enabled } : {}) }));
    },
    async saveTask(id: string, message: string, taskId?: string): Promise<void> {
      if (!message.trim()) throw new Error('tasks.taskMessageRequired');
      await json(path(id) + '/tasks' + (taskId ? '/' + encodeURIComponent(taskId) : ''), body(taskId ? 'PUT' : 'POST', { message: message.trim() }));
    },
    async deleteTask(id: string, taskId: string): Promise<void> { await json(path(id) + '/tasks/' + encodeURIComponent(taskId), { method: 'DELETE' }); },
    async runTask(id: string, taskId: string): Promise<{ autoStarted?: boolean; message?: string }> {
      return z.object({ autoStarted: z.boolean().optional(), message: z.string().optional() }).parse(await json(path(id) + '/tasks/' + encodeURIComponent(taskId) + '/run', { method: 'POST' }));
    },
    async loadActive(): Promise<void> {
      const [current, completed] = await Promise.allSettled([json('/api/agent-loop/tasks'), json('/api/agent-loop/tasks/completed')]);
      if (current.status === 'rejected') throw current.reason;
      const next = z.object({ tasks: z.array(activeTaskSchema).nullish() }).parse(current.value).tasks ?? [];
      const completedResult = completed.status === 'fulfilled' ? z.object({ tasks: z.array(activeTaskSchema).nullish() }).safeParse(completed.value) : null;
      const backend = completedResult?.success ? completedResult.data.tasks ?? [] : [];
      if (backend.length) {
        const ids = new Set(backend.map(task => task.conversationId)); history = [...backend, ...history.filter(task => !ids.has(task.conversationId))];
      } else {
        const ids = new Set(next.map(task => task.conversationId));
        for (const task of active) if (!ids.has(task.conversationId) && !history.some(old => old.conversationId === task.conversationId)) {
          history.push({ ...task, message: task.title || task.message, status: ['completed', 'failed', 'timeout', 'cancelled', 'cleanup_unconfirmed'].includes(task.status) ? task.status : 'completed', completedAt: new Date(now()).toISOString() });
        }
      }
      history.sort((a, b) => new Date(b.completedAt || b.startedAt || '').getTime() - new Date(a.completedAt || a.startedAt || '').getTime()); history = history.slice(0, 50);
      active = next; persistHistory();
      const cancellable = new Set(next.filter(task => !['completed', 'failed', 'timeout', 'cancelled', 'cleanup_unconfirmed', 'cancelling', 'cleaning'].includes(task.status)).map(task => task.conversationId));
      for (const id of selected) if (!cancellable.has(id)) selected.delete(id);
    },
    filtered(statusFilter: string, sort: string): ActiveTask[] {
      const all: ActiveTask[] = [...active, ...(showHistory ? history.filter(task => !active.some(a => a.conversationId === task.conversationId)).map(task => ({ ...task, isHistory: true })) : [])];
      const filtered = all.filter(task => statusFilter === 'all' || (statusFilter === 'history' ? task.isHistory : statusFilter === 'active' ? !task.isHistory && ['running', 'cancelling', 'cleaning', 'cleanup_failed'].includes(task.status) : task.status === statusFilter));
      return filtered.sort((a, b) => sort === 'message' ? a.message.localeCompare(b.message) : sort === 'status' ? a.status.localeCompare(b.status) : (sort === 'time-asc' ? 1 : -1) * (new Date(a.completedAt || a.startedAt || '').getTime() - new Date(b.completedAt || b.startedAt || '').getTime()));
    },
    async cancel(id: string): Promise<void> { await json('/api/agent-loop/cancel', body('POST', { conversationId: id })); selected.delete(id); },
    async batchCancel(): Promise<{ success: number; fail: number }> {
      let success = 0, fail = 0; for (const id of [...selected]) { try { await service.cancel(id); success++; } catch { fail++; } }
      selected.clear(); return { success, fail };
    },
    async roles(): Promise<{ name: string; icon?: string; enabled?: boolean }[]> {
      return z.object({ roles: z.array(z.object({ name: z.string(), icon: z.string().optional(), enabled: z.boolean().optional() })).nullish() }).parse(await json('/api/roles')).roles ?? [];
    },
    async projects(): Promise<{ id: string; name: string }[]> {
      const all = await options.projects?.(); if (all) return all;
      const raw = await json('/api/projects?status=active&limit=500');
      const schema = z.array(z.object({ id: z.string(), name: z.string().default('') }));
      return Array.isArray(raw) ? schema.parse(raw) : z.object({ projects: schema.nullish() }).parse(raw).projects ?? [];
    },
  };
  return service;
}
export type TasksService = ReturnType<typeof createTasksService>;
