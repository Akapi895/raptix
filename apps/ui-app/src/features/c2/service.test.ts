import { describe, expect, it, vi } from 'vitest';
import { createC2Service, type Request } from './service';
import { downloadContent, eventReference, formatTaskCommand, onelinerKinds, parseLsLine, sessionState, sessionSupportsUpload, type C2Session, type C2Task, type ListenerDraft } from './model';

const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const session: C2Session = { id: 's_1', listenerId: 'l_1', implantUuid: 'beacon_1', hostname: 'host', username: 'root', os: 'linux', arch: 'amd64', pid: 42, processName: 'beacon', isAdmin: true, internalIp: '10.0.0.1', externalIp: '', userAgent: '', sleepSeconds: 5, jitterPercent: 20, status: 'active', firstSeenAt: '', lastCheckIn: '', note: '', metadata: { transport: 'http_beacon' } };
const task: C2Task = { id: 't_1', sessionId: 's_1', taskType: 'shell', status: 'success', resultText: 'ok', source: 'manual', createdAt: '' };
const draft: ListenerDraft = { name: 'HTTP', type: 'http_beacon', bind_host: '127.0.0.1', bind_port: 8080, callback_host: 'callback.test', project_id: 'p1', profile_id: 'profile1', remark: '' };
describe('C2 public service wire behavior', () => {
  it('renders sparse wire task fields without throwing and preserves unknown status', () => {
    const sparse = JSON.parse('{"id":"t_sparse","status":"unrecognized"}') as C2Task;
    expect(formatTaskCommand(sparse)).toBe(''); expect(sparse.status).toBe('unrecognized');
    expect(onelinerKinds('https_beacon')).toEqual(['curl_beacon']); expect(onelinerKinds('dns')).toEqual([]);
  });
  it('distinguishes backend disconnection, sleep, overdue check-ins and unknown states without mutations', () => {
    const now = Date.parse('2026-10-31T12:00:00Z'); const recent = { ...session, lastCheckIn: '2026-10-31T11:59:59Z' };
    expect(sessionState(recent, now)).toBe('active'); expect(sessionState({ ...recent, status: 'sleeping' }, now)).toBe('sleeping');
    expect(sessionState({ ...recent, lastCheckIn: '2026-10-31T11:58:00Z' }, now)).toBe('stale');
    expect(sessionState({ ...recent, status: 'dead' }, now)).toBe('disconnected'); expect(sessionState({ ...recent, status: 'killed' }, now)).toBe('disconnected');
    expect(sessionState({ ...recent, status: 'new-state' }, now)).toBe('unknown'); expect(recent.status).toBe('active');
    expect(sessionState({ ...recent, status: 'sleeping', sleepSeconds: 300, jitterPercent: 100, lastCheckIn: '2026-10-31T11:50:00Z' }, now)).toBe('sleeping');
    expect(eventReference({ id: 'e1', level: 'warn', category: 'task', message: '', createdAt: '', data: { session_id: 's_1', task_id: 't_1' } }, 'task')).toBe('t_1');
  });
  it('treats failed directory listings as errors rather than empty directories', async () => {
    const service = createC2Service({ request: async path => response(path.endsWith('/tasks') ? { task_id: 't_1' } : { task: { ...task, resultText: 'ls: cannot access /private: Permission denied' } }) });
    service.state.sessions = [session]; service.selectSession(session.id);
    await expect(service.loadFileList(session.id, '/private')).rejects.toThrow('Permission denied'); expect(service.state.currentPath).toBe('.'); service.dispose();
  });
  it('keeps pagination/filter names and clamps a page after deleting its last row', async () => {
    const urls: string[] = [];
    const service = createC2Service({ request: async path => { urls.push(path); return response({ tasks: [task], total: 1, status_counts: { success: 1, failed: 0, pending: 0, cancelled: 0 }, pending_queued_count: 2 }); } });
    service.state.tasksFilter = { status: 'success', task_type: 'shell', session_id: 's_1', since: '2026-10-29T00:00:00Z', timePreset: '24h' };
    await service.loadTasks(9);
    expect(new URL(urls[0]!, 'http://test').searchParams.get('page_size')).toBe('10');
    expect(new URL(urls[1]!, 'http://test').searchParams.get('page')).toBe('1');
    expect(urls[0]).toContain('session_id=s_1'); expect(urls[0]).toContain('task_type=shell'); expect(urls[0]).not.toContain('timePreset');
    expect(service.state.tasksPendingQueuedCount).toBe(2); expect(service.state.tasksPage).toBe(1); service.dispose();
  });
  it('rejects stale filter responses that arrive after newer ones', async () => {
    let release!: (response: Response) => void;
    const service = createC2Service({ request: async path => path.includes('search=old') ? new Promise<Response>(resolve => { release = resolve; }) : response({ sessions: [session] }) });
    service.state.sessionFilter.search = 'old'; const old = service.loadSessions(); service.state.sessionFilter.search = 'new'; await service.loadSessions(); release(response({ sessions: [] })); await old;
    expect(service.state.sessions).toEqual([session]); service.dispose();
  });
  it('validates listener input before sending and preserves snake_case mutation fields', async () => {
    const calls: { path: string; init?: RequestInit }[] = [];
    const request: Request = async (path, init) => { calls.push({ path, init }); return response(path.endsWith('/profiles') ? { profiles: [] } : { listeners: [] }); };
    const service = createC2Service({ request });
    await expect(service.saveListener({ ...draft, bind_port: 0 })).rejects.toThrow('portInvalid'); expect(calls).toHaveLength(0);
    await service.saveListener(draft);
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({ bind_host: '127.0.0.1', bind_port: 8080, callback_host: 'callback.test', project_id: 'p1', profile_id: 'profile1' }); service.dispose();
  });
  it('uses the dedicated sleep/note routes and the server-normalized note', async () => {
    const calls: { path: string; method?: string; body: unknown }[] = [];
    const service = createC2Service({ request: async (path, init) => { calls.push({ path, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) as unknown : undefined }); return response(path.endsWith('/note') ? { note: 'server note' } : path.includes('/sessions?') ? { sessions: [session] } : {}); } });
    service.state.sessions = [{ ...session }]; await service.setSessionSleep('s_1', 60, 200); await service.saveSessionNote('s_1', '  note  ');
    expect(calls[0]).toEqual({ path: '/api/c2/sessions/s_1/sleep', method: 'PUT', body: { sleep_seconds: 60, jitter_percent: 100 } });
    expect(calls[2]).toEqual({ path: '/api/c2/sessions/s_1/note', method: 'PUT', body: { note: 'note' } }); expect(service.state.sessions[0]?.note).toBe('server note'); service.dispose();
  });
  it('creates profiles with camelCase Go JSON names', async () => {
    const bodies: unknown[] = [];
    const service = createC2Service({ request: async (_path, init) => { if (init?.body) bodies.push(JSON.parse(String(init.body)) as unknown); return response({ profiles: [] }); } });
    await service.createProfile({ name: 'profile', userAgent: 'Mozilla', uris: ['/api/status'], jitterMinMs: 100, jitterMaxMs: 500, responseHeaders: { Server: 'nginx' } });
    expect(bodies[0]).toEqual({ name: 'profile', userAgent: 'Mozilla', uris: ['/api/status'], jitterMinMs: 100, jitterMaxMs: 500, responseHeaders: { Server: 'nginx' } });
    await expect(service.createProfile({ name: 'bad', userAgent: '', uris: [], jitterMinMs: 500, jitterMaxMs: 100, responseHeaders: {} })).rejects.toThrow('InvalidJitter'); service.dispose();
  });
  it('polls through approval and running states then returns a completed task', async () => {
    const delays: number[] = []; let attempt = 0;
    const service = createC2Service({ request: async () => response({ task: ++attempt === 1 ? { ...task, status: 'queued', approvalStatus: 'pending' } : attempt === 2 ? { ...task, status: 'running' } : task }), delay: async ms => { delays.push(ms); } });
    expect(await service.waitForTask('t_1')).toEqual(task); expect(delays).toEqual([1000, 500]); service.dispose();
  });
  it('cancels an outstanding polling timer when disposed', async () => {
    let ready!: () => void; const entered = new Promise<void>(resolve => { ready = resolve; });
    const service = createC2Service({ request: async () => response({ task: { ...task, status: 'running' } }), delay: (_ms, signal) => new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }); ready(); }) });
    const result = service.waitForTask('t_1'); const rejection = expect(result).rejects.toThrow('Aborted'); await entered; service.dispose(); await rejection;
  });
  it('uploads multipart data, dispatches an upload task and waits for completion', async () => {
    const calls: { path: string; body: unknown }[] = []; const progress: number[] = [];
    const service = createC2Service({ request: async (path, init) => { calls.push({ path, body: typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : init?.body }); if (path.endsWith('/tasks')) return response({ task_id: 't_1' }); return response({ task }); }, upload: async (path, form, onProgress) => { expect(path).toBe('/api/c2/files/upload'); expect(form.get('session_id')).toBe('s_1'); expect(form.get('remote_path')).toBe('/home/test/binary.dat'); onProgress(80); return response({ file_id: 'f_1' }); } });
    service.state.sessions = [session]; service.selectSession('s_1'); service.state.implantPwd = '/home/test';
    await service.uploadFile(new File([Uint8Array.of(0, 255)], 'binary.dat'), percent => progress.push(percent));
    expect(calls[0]?.body).toEqual({ session_id: 's_1', task_type: 'upload', payload: { remote_path: '/home/test/binary.dat', file_id: 'f_1' } }); expect(progress).toContain(50); expect(progress).toContain(100); expect(service.state.fileUploadBusy).toBe(false); service.dispose();
  });
  it('downloads binary task files and decodes inline base64 fallbacks', async () => {
    const service = createC2Service({ request: async (path, init) => {
      if (path.endsWith('/tasks') && init?.method === 'POST') return response({ task_id: 't_1' });
      if (path.endsWith('/result-file')) return new Response(Uint8Array.of(0, 255));
      return response({ task: { ...task, resultBlobPath: '/private/result' } });
    } });
    service.state.sessions = [session]; service.selectSession(session.id); const blob = await service.downloadFile('file.bin');
    expect(new Uint8Array(await blob!.arrayBuffer())).toEqual(Uint8Array.of(0, 255)); expect(downloadContent('AP8=')).toEqual(Uint8Array.of(0, 255)); expect(() => downloadContent('C2_DOWNLOAD_ERR: permission denied')).toThrow(); service.dispose();
  });
  it('owns the event stream lifecycle and never opens a duplicate stream', async () => {
    const close = vi.fn(); const eventStream = vi.fn(() => ({ close }));
    const service = createC2Service({ request: async () => response({ events: [], tasks: [] }), eventStream });
    await service.pageChanged('c2-events'); await service.pageChanged('c2-tasks'); expect(eventStream).toHaveBeenCalledTimes(1);
    await service.pageChanged('chat'); expect(close).toHaveBeenCalledTimes(1); service.dispose(); expect(close).toHaveBeenCalledTimes(1);
  });
  it('enforces mutation permissions at the service seam', async () => {
    const request = vi.fn<Request>(); const service = createC2Service({ request, allow: () => false });
    await expect(service.createTask('s_1', 'shell', { command: 'id' })).rejects.toThrow('Permission denied'); await expect(service.deleteResources('sessions', ['s_1'])).rejects.toThrow('Permission denied'); expect(request).not.toHaveBeenCalled(); service.dispose();
  });
  it('parses beacon and Unix explorer entries and excludes curl/raw-shell uploads', () => {
    expect(parseLsLine('d\tdrwxr-xr-x\t0\tmy folder')).toMatchObject({ name: 'my folder', isDir: true }); expect(parseLsLine('-rw-r--r-- 1 root root 42 Oct 29 12:00 file name')).toMatchObject({ name: 'file name', size: '42' });
    expect(sessionSupportsUpload(session)).toBe(true); expect(sessionSupportsUpload({ ...session, implantUuid: 'curl_123' })).toBe(false); expect(sessionSupportsUpload({ ...session, metadata: { transport: 'tcp_reverse' } })).toBe(false); expect(sessionSupportsUpload({ ...session, metadata: { transport: 'tcp_beacon' } })).toBe(true);
  });
});
