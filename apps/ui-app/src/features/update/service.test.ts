import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NotificationRuntime } from '../../platform/notification-browser';
import type { Request } from '../notifications';
import { createUpdateClient } from './client';
import { createUpdateService } from './service';
import type { UpdateDependencies, UpdateResponse } from './types';

const response = (body: UpdateResponse, status = 200) => new Response(JSON.stringify(body), { status });
function setup(initial: UpdateResponse = { status: { installed: true, commit: 'old', buildPending: true }, canRestart: true, supervised: true }) {
  vi.useFakeTimers(); vi.setSystemTime(100_000);
  let active = true;
  const timeouts = new Map<number, ReturnType<typeof setTimeout>>(), intervals = new Map<number, ReturnType<typeof setInterval>>(); let sequence = 0;
  const runtime: NotificationRuntime = {
    now: Date.now,
    after(callback, ms) { const id = ++sequence; timeouts.set(id, setTimeout(callback, ms)); return id; },
    cancel(id) { clearTimeout(timeouts.get(id)); timeouts.delete(id); },
    every(callback, ms) { const id = ++sequence; intervals.set(id, setInterval(callback, ms)); return id; },
    cancelEvery(id) { clearInterval(intervals.get(id)); intervals.delete(id); },
  };
  const request = vi.fn<Request>(async url => url.endsWith('/job') ? response({ job: { id: 'job', state: 'running' } }) : response(initial));
  const deps: UpdateDependencies = { request, runtime, translate: (key, opts) => key + (opts?.reason ? ': ' + opts.reason : ''), isActive: () => active,
    confirm: vi.fn(() => true), notify: vi.fn(), applyPermissions: vi.fn(), probe: vi.fn(async () => new Response('{}')), restarted: vi.fn(), reload: vi.fn() };
  const render = vi.fn(); const service = createUpdateService(createUpdateClient(request), deps, render);
  return { service, deps, request, render, setActive(value: boolean) { active = value; } };
}
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('update service', () => {
  it('paints local status first, auto-checks once, resets busy/checking on all outcomes', async () => {
    const h = setup(); await h.service.load(); expect(h.service.getModel().check.done).toBe(false);
    h.request.mockResolvedValueOnce(response({ status: { installed: true, checkError: 'remote offline' } }));
    await vi.advanceTimersByTimeAsync(1200);
    expect(h.request.mock.lastCall?.[0]).toBe('/api/system/update/check');
    expect(h.service.getModel()).toMatchObject({ busy: false, checking: false, check: { done: true, error: 'remote offline' } });
    expect(h.deps.notify).not.toHaveBeenCalledWith('update.upToDate', 'success');
    await h.service.load(); await vi.advanceTimersByTimeAsync(5000);
    expect(h.request.mock.calls.filter(([url]) => url.endsWith('/check'))).toHaveLength(1);
    h.request.mockRejectedValueOnce(new Error('transport down')); await h.service.check();
    expect(h.service.getModel()).toMatchObject({ busy: false, checking: false, check: { done: false, error: 'transport down' } });
    expect(h.service.getModel().actionError).toContain('transport down'); h.service.dispose();
  });
  it('accepts sparse demo status without inventing an install or auto-check', async () => {
    const h = setup({ status: 'idle' }); await h.service.load(); await vi.advanceTimersByTimeAsync(5000);
    expect(h.service.getModel().console?.status).toEqual({}); expect(h.request).toHaveBeenCalledTimes(1);
    await h.service.apply(); expect(h.deps.confirm).not.toHaveBeenCalled(); h.service.dispose();
  });
  it('explains product edits/divergence and allows a build-only apply with the chosen restart value', async () => {
    const h = setup({ status: { installed: true, updateAvailable: true, diverged: true, blockingChanges: [{ path: 'product.go', status: 'M', protected: false }] } });
    await h.service.load(); await h.service.apply(); expect(h.deps.confirm).not.toHaveBeenCalled();
    h.request.mockResolvedValueOnce(response({ status: { installed: true, buildPending: true, commit: 'same' }, supervised: true, canRestart: true }));
    await h.service.load(); h.service.restartChoiceChanged(false);
    h.request.mockResolvedValueOnce(response({ job_id: 'build' }, 202)); await h.service.apply();
    expect(h.deps.confirm).toHaveBeenCalledWith('update.confirmBuildPending update.confirmRestartNo');
    expect(h.request.mock.calls.find(([url]) => url.endsWith('/apply'))?.[1]?.body).toBe('{"restart":false}');
    expect(h.service.getModel().restartChoice).toBe(false); h.service.dispose();
  });
  it('attaches a conflicting running job and keeps polling despite the action error', async () => {
    const h = setup(); await h.service.load();
    h.request.mockResolvedValueOnce(response({ error: 'already running', job: { id: 'other', state: 'running' } }, 409));
    await h.service.apply(); expect(h.service.getModel().console?.job?.id).toBe('other');
    expect(h.service.getModel().actionError).toContain('already running');
    await vi.advanceTimersByTimeAsync(1500); expect(h.request.mock.lastCall?.[0]).toBe('/api/system/update/job');
    h.setActive(false); const count = h.request.mock.calls.length; await vi.advanceTimersByTimeAsync(5000); expect(h.request).toHaveBeenCalledTimes(count); h.service.dispose();
  });
  it('treats HTTP 202 with error/items as a failed partial rollback', async () => {
    const h = setup({ status: { hasRollback: true, rollbackTo: 'previous' } }); await h.service.load();
    h.request.mockResolvedValueOnce(response({ error: 'no toolchain', items: ['binary', 'settings.yaml'] }, 202));
    await h.service.rollback(); expect(h.service.getModel().actionError).toContain('binary, settings.yaml');
    expect(h.deps.notify).not.toHaveBeenCalledWith('update.rollbackDone', 'success'); expect(h.service.getModel().busy).toBe(false); h.service.dispose();
  });
  it('preserves source drafts across check/poll, trims saves and keeps source failures visible', async () => {
    const h = setup({ status: {}, source: { repo: 'saved', defaultRepo: 'official' } }); await h.service.load();
    h.service.sourceChanged('  https://example.test/fork.git  ');
    h.request.mockResolvedValueOnce(response({ status: { checkError: 'offline' } })); await h.service.check();
    expect(h.service.sourceRepo()).toBe('  https://example.test/fork.git  ');
    h.request.mockResolvedValueOnce(response({ error: 'invalid remote' }, 400)); await h.service.saveSource();
    expect(h.service.getModel().sourceError).toContain('invalid remote'); expect(h.service.getModel().busy).toBe(false);
    expect(h.request.mock.lastCall?.[1]?.body).toBe('{"repo":"https://example.test/fork.git"}');
    h.request.mockResolvedValueOnce(response({ source: { repo: 'fork' } })).mockResolvedValueOnce(response({ source: { repo: 'fork' } }));
    await h.service.saveSource(); expect(h.service.sourceRepo()).toBe('fork'); expect(h.service.getModel().sourceDraft).toBeNull(); h.service.dispose();
  });
  it('previews adoption without side effects, then submits the confirmed plan and reports real job results', async () => {
    const h = setup({ status: {}, canRestart: true }); await h.service.load();
    h.request.mockResolvedValueOnce(response({ plan: { incoming: 10, overwrittenTotal: 2, protectedTotal: 3, overwritten: ['source'], protected: ['config'] } }));
    await h.service.previewAdopt(); expect(h.request.mock.lastCall?.[1]?.body).toBe('{"confirm":false}');
    expect(h.service.getModel().adoptPlan?.protectedTotal).toBe(3);
    h.request.mockResolvedValueOnce(response({ job_id: 'adopt' }, 202)).mockResolvedValueOnce(response({ job: { state: 'succeeded', result: { fromCommit: 'same', toCommit: 'same', binaryBuilt: true, needsRestart: true } } }));
    await h.service.confirmAdopt();
    expect(h.request.mock.calls.find(([url, init]) => url.endsWith('/adopt') && init?.body !== '{"confirm":false}')?.[1]?.body).toBe('{"confirm":true,"restart":false}');
    expect(h.deps.notify).toHaveBeenCalledWith('update.buildDoneToast', 'success'); expect(h.deps.notify).toHaveBeenCalledWith('update.needsRestartToast', 'info');
    expect(h.service.getModel().adoptPlan).toBeNull(); h.service.dispose();
  });
  it('enters restart watchdog after job success, waits through old-process 200s and reloads only on 401', async () => {
    const h = setup(); await h.service.load();
    h.request.mockResolvedValueOnce(response({ job_id: 'job' }, 202)).mockResolvedValueOnce(response({ job: { state: 'succeeded', restartRequested: true, result: { fromCommit: 'a', toCommit: 'b' } } }));
    await h.service.apply(); expect(h.service.getModel().watchdog).toBe(true);
    await vi.advanceTimersByTimeAsync(92_000); expect(h.service.getModel().watchdogSlow).toBe('running'); expect(h.deps.restarted).not.toHaveBeenCalled();
    vi.mocked(h.deps.probe).mockResolvedValueOnce(new Response('{}', { status: 401 }));
    await vi.advanceTimersByTimeAsync(2000); expect(h.deps.restarted).toHaveBeenCalledOnce(); h.service.dispose(); expect(vi.getTimerCount()).toBe(0);
  });
  it('hands a restart transport gap to watchdog and supports leaving/re-entering while service is down', async () => {
    const h = setup(); await h.service.load();
    h.request.mockResolvedValueOnce(response({ job_id: 'job' }, 202)).mockRejectedValueOnce(new Error('connection refused'));
    await h.service.apply(); expect(h.service.getModel().watchdog).toBe(true);
    vi.mocked(h.deps.probe).mockRejectedValue(new Error('down')); await vi.advanceTimersByTimeAsync(92_000);
    expect(h.service.getModel().watchdogSlow).toBe('down');
    h.setActive(false); await vi.advanceTimersByTimeAsync(2000); expect(vi.getTimerCount()).toBe(0);
    h.setActive(true); await h.service.load(); expect(h.service.getModel().watchdogSlow).toBeNull();
    h.service.dispose(); expect(vi.getTimerCount()).toBe(0);
  });
  it('ignores a late poll after stop and late network completions after disposal', async () => {
    const h = setup({ status: {}, job: { state: 'running' } }); await h.service.load();
    let resolve!: (value: Response) => void; h.request.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const poll = h.service.poll(); h.service.stopPolling(); resolve(response({ job: { state: 'failed', failure: { message: 'late' } } })); await poll;
    expect(h.deps.notify).not.toHaveBeenCalled();
    h.request.mockReturnValueOnce(new Promise(done => { resolve = done; })); const check = h.service.check();
    const renders = h.render.mock.calls.length; h.service.dispose(); resolve(response({ status: { updateAvailable: true } })); await check;
    expect(h.render).toHaveBeenCalledTimes(renders); expect(h.deps.notify).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
});
