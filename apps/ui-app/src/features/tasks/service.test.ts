import { describe, expect, it, vi } from 'vitest';
import type { KeyValueStorage } from '../../platform/storage';
import { createTasksService } from './service';
import { canMutate, canRunSingle, queuePresentation, queueSchema, type QueueInput } from './model';

function memory(initial: Record<string, string> = {}): KeyValueStorage {
  const values = new Map(Object.entries(initial)); return { get: key => values.get(key) ?? null, set: (key, value) => { values.set(key, value); return true; }, remove: key => values.delete(key) };
}
const queue = (patch: Record<string, unknown> = {}) => queueSchema.parse({ id: 'queue/one', title: 'Queue', role: 'operator', status: 'pending', createdAt: '2026-10-29T00:00:00Z', tasks: [{ id: 'task/one', message: 'Recon', status: 'pending' }], ...patch });
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const input: QueueInput = { title: ' Queue ', tasks: [' First ', '', 'Second'], role: 'operator', hitlPolicy: 'review_edit', projectId: 'project', concurrency: 12, scheduleMode: 'cron', cronExpr: ' 0 2 * * * ', executeNow: false };

describe('task queues service', () => {
  it('uses Go pagination names, filters and encoded queue/task IDs', async () => {
    const request = vi.fn(async () => json({ queues: [queue()], total: 21, total_pages: 3 }));
    const service = createTasksService({ request, storage: memory() }); service.setFilters('paused', ' network '); await service.list(2);
    expect(request).toHaveBeenCalledWith('/api/batch-tasks?page=2&limit=10&status=paused&keyword=network', undefined);
    expect(service.pagination).toMatchObject({ page: 2, total: 21, totalPages: 3 });
    request.mockImplementation(async () => json({})); await service.saveTask('queue/one', ' Changed ', 'task/one');
    expect(request).toHaveBeenLastCalledWith('/api/batch-tasks/queue%2Fone/tasks/task%2Fone', expect.objectContaining({ method: 'PUT', body: '{"message":"Changed"}' }));
  });
  it('accepts Go and demo create/detail response shapes with one payload contract', async () => {
    const request = vi.fn(async (_path: string, _init?: RequestInit) => json({ queueId: 'created' })); const service = createTasksService({ request, storage: memory() });
    expect(await service.create(input)).toBe('created');
    expect(request).toHaveBeenLastCalledWith('/api/batch-tasks', expect.objectContaining({ method: 'POST', body: JSON.stringify({ ...input, title: 'Queue', tasks: ['First', 'Second'], cronExpr: '0 2 * * *', concurrency: 8 }) }));
    expect(JSON.parse(String(request.mock.calls.at(-1)?.[1]?.body))).not.toHaveProperty('agentMode');
    request.mockImplementation(async () => json(queue())); expect(await service.create(input)).toBe('queue/one');
    expect((await service.detail('queue/one')).tasks[0]?.message).toBe('Recon');
    request.mockImplementation(async () => json({ queue: queue({ hitlPolicy: 'human' }) })); expect((await service.detail('queue/one')).hitlPolicy).toBe('human');
  });
  it('validates tasks, cron and inline concurrency before mutation requests', async () => {
    const request = vi.fn(async () => json({})); const service = createTasksService({ request, storage: memory() });
    await expect(service.create({ ...input, tasks: [' '] })).rejects.toThrow('tasks.enterTaskPrompt');
    await expect(service.create({ ...input, cronExpr: '' })).rejects.toThrow('batchImportModal.cronExprRequired');
    await expect(service.create({ ...input, cronExpr: '* *' })).rejects.toThrow('batchImportModal.cronExprInvalid');
    await expect(service.saveTask('q', ' ')).rejects.toThrow('tasks.taskMessageRequired');
    await expect(service.metadata('q', { concurrency: 1.5 })).rejects.toThrow('tasks.concurrencyInvalid'); expect(request).not.toHaveBeenCalled();
  });
  it('preserves title/role during metadata edits and propagates server failures', async () => {
    const request = vi.fn(async (_path: string, init?: RequestInit) => init?.method ? json({ error: 'queue is running' }, 409) : json({ queue: queue() }));
    const service = createTasksService({ request, storage: memory() });
    await expect(service.metadata('queue/one', { hitlPolicy: 'audit_agent' })).rejects.toThrow('queue is running');
    expect(request).toHaveBeenLastCalledWith('/api/batch-tasks/queue%2Fone/metadata', expect.objectContaining({ body: '{"title":"Queue","role":"operator","hitlPolicy":"audit_agent"}' }));
  });
  it('retains history from disappeared tasks when completed endpoint is unavailable', async () => {
    let tasks = [{ conversationId: 'c1', title: 'Investigation', message: '', status: 'running', startedAt: '2026-10-29T00:00:00Z' }];
    const storage = memory(), request = vi.fn(async (path: string) => path.endsWith('/completed') ? json({}, 404) : json({ tasks }));
    const service = createTasksService({ request, storage, now: () => Date.parse('2026-10-29T01:00:00Z') });
    await service.loadActive(); tasks = []; await service.loadActive();
    expect(service.history).toEqual([expect.objectContaining({ conversationId: 'c1', message: 'Investigation', status: 'completed', completedAt: '2026-10-29T01:00:00.000Z' })]);
    expect(storage.get('tasks-completed-history')).toContain('Investigation'); expect(service.filtered('history', 'time-desc')[0]?.isHistory).toBe(true);
  });
  it('backend history wins duplicate IDs, expires local history and bounds batch cancellation failures', async () => {
    const storage = memory({ 'tasks-completed-history': JSON.stringify([{ conversationId: 'old', status: 'completed', startedAt: '2025-01-01' }]) });
    const request = vi.fn(async (path: string, init?: RequestInit) => path.endsWith('/cancel') ? json({}, String(init?.body).includes('bad') ? 500 : 200) : json({ tasks: path.endsWith('/completed') ? [{ conversationId: 'done', message: 'Backend', status: 'failed' }] : [] }));
    const service = createTasksService({ request, storage }); expect(service.history).toEqual([]); await service.loadActive(); expect(service.history[0]?.status).toBe('failed');
    service.select('ok', true); service.select('bad', true); expect(await service.batchCancel()).toEqual({ success: 1, fail: 1 }); expect(service.selected.size).toBe(0);
  });
  it('exposes run/start/pause/rerun/delete and schedule endpoints without losing failure feedback', async () => {
    const request = vi.fn(async (_path: string, _init?: RequestInit) => json({ autoStarted: false, message: 'requires manual start' })); const service = createTasksService({ request, storage: memory() });
    for (const action of ['start', 'pause', 'rerun'] as const) await service.command('q', action);
    expect(request.mock.calls.map(call => call[0])).toEqual(['/api/batch-tasks/q/start', '/api/batch-tasks/q/pause', '/api/batch-tasks/q/rerun']);
    expect(await service.runTask('q', 't')).toMatchObject({ autoStarted: false, message: 'requires manual start' });
    await service.schedule('q', 'cron', '0 1 * * *'); await service.scheduleEnabled('q', false); expect(request).toHaveBeenLastCalledWith('/api/batch-tasks/q/schedule-enabled', expect.objectContaining({ body: '{"scheduleEnabled":false}' }));
    await service.deleteTask('q', 't'); await service.remove('q'); expect(request).toHaveBeenLastCalledWith('/api/batch-tasks/q', { method: 'DELETE' });
  });
  it('does not allow late list requests to replace a newer filter result', async () => {
    let resolve: (response: Response) => void = () => {};
    const old = new Promise<Response>(done => { resolve = done; });
    const request = vi.fn().mockReturnValueOnce(old).mockResolvedValueOnce(json({ queues: [queue({ id: 'new' })], total: 1 }));
    const service = createTasksService({ request, storage: memory() }); const first = service.list(); service.setFilters('running', 'new'); await service.list(); resolve(json({ queues: [queue()], total: 1 })); await first; expect(service.queues[0]?.id).toBe('new');
  });
});

describe('queue state rules', () => {
  it('blocks editing/running while active, and labels cron rounds with failures accurately', () => {
    const running = queue({ status: 'paused', tasks: [{ id: 't', message: 'x', status: 'running' }] }); expect(canMutate(running)).toBe(false); expect(canRunSingle(running, running.tasks[0]!)).toBe(false);
    const failed = queue({ status: 'completed', scheduleMode: 'cron', nextRunAt: '2026-10-30', tasks: [{ id: 't', message: 'x', status: 'failed' }] });
    expect(queuePresentation(failed, key => key)).toMatchObject({ text: 'tasks.statusFailed', class: 'batch-queue-status-failed', callout: 'tasks.cronRecurringCallout' });
    expect(canMutate(failed)).toBe(true); expect(canRunSingle(failed, failed.tasks[0]!)).toBe(true);
  });
});
