import { http } from '../../platform/http';
import { BACKEND_QUEUED_FRAGMENT } from '@/platform/backend-legacy-strings';
import { downloadContent, isDownloadShellError, joinFilePath, listenerCallbackHost, listenerConfig, normalizeFilePath, resolvePathAgainstPwd, sessionIsWindows, sessionState, sessionSupportsUpload, validateListener, type C2Event, type C2FileEntry, type C2Listener, type C2Profile, type C2Session, type C2Task, type EventCounts, type EventFilter, type EventsResponse, type JsonValue, type ListenerDraft, type PayloadBuild, type ProfileDraft, type SessionFilter, type TaskCounts, type TaskCreated, type TaskFilter, type TasksResponse } from './model';

export type Request = (path: string, init?: RequestInit) => Promise<Response>;
export interface EventStream { close(): void; }
export interface C2Dependencies {
  request?: Request;
  upload?(path: string, form: FormData, progress: (percent: number) => void, signal: AbortSignal): Promise<Response>;
  eventStream?(receive: (event: C2Event) => void): EventStream;
  delay?(ms: number, signal: AbortSignal): Promise<void>;
  allow?(permission: string): boolean;
  notify?(message: string, type: 'success' | 'error' | 'info' | 'warning'): void;
  refreshDashboard?(): void;
  sessionTasksChanged?(sessionId: string): void;
}
export class C2Error extends Error {}
const base = '/api/c2';
const resourcePath = (kind: string, id: string) => `${base}/${kind}/${encodeURIComponent(id)}`;
function filterQuery(values: Record<string, string | boolean | number>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== '' && value !== false && key !== 'timePreset') params.set(key, value === true ? '1' : String(value));
  return params.toString();
}
function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, milliseconds);
    signal.addEventListener('abort', abort, { once: true });
  });
}

export function createC2Service(deps: C2Dependencies = {}) {
  const request = deps.request ?? ((path, init) => http.raw(path, init));
  const delay = deps.delay ?? abortableDelay;
  const lifetime = new AbortController();
  const listeners = new Set<() => void>();
  const terminalHistory = new Map<string, string[]>();
  const terminalLogs = new Map<string, string>();
  const state = {
    currentPage: '', activityTab: 'tasks', listeners: [] as C2Listener[], sessions: [] as C2Session[], tasks: [] as C2Task[], events: [] as C2Event[], profiles: [] as C2Profile[],
    tasksSearch: '', eventsSearch: '', terminalFeedback: '', terminalTaskId: '',
    tasksCountsKnown: false, eventsCountsKnown: false,
    listenerSessionCounts: null as Record<string, number> | null,
    resources: {} as Record<string, { loading: boolean; error: string }>,
    selectedSessionId: null as string | null, selectedListenerId: null as string | null,
    sessionFilter: { status: '', listener_id: '', search: '', suspicious: false } as SessionFilter,
    tasksFilter: { status: '', task_type: '', session_id: '', since: '', timePreset: 'all' } as TaskFilter,
    eventsFilter: { level: '', category: '', session_id: '', since: '', timePreset: 'all' } as EventFilter,
    tasksPage: 1, tasksPageSize: 10, tasksTotal: 0, tasksPendingQueuedCount: null as number | null,
    tasksStatusCounts: { success: 0, failed: 0, pending: 0, cancelled: 0 } as TaskCounts,
    eventsPage: 1, eventsPageSize: 10, eventsTotal: 0, eventsLevelCounts: { info: 0, warn: 0, critical: 0 } as EventCounts,
    currentPath: '.', implantPwd: null as string | null, fileList: [] as C2FileEntry[], fileUploadBusy: false,
    uploadProgress: { visible: false, percent: 0, filename: '' }, terminalBusy: false, terminalQueue: [] as string[],
  };
  let stream: EventStream | undefined;
  let disposed = false;
  let sessionsVersion = 0; let tasksVersion = 0; let eventsVersion = 0;
  let listenersLoading: Promise<void> | undefined; let profilesLoading: Promise<void> | undefined;
  const emit = () => { if (!disposed) listeners.forEach(listener => listener()); };
  const resourceVersions = new Map<string, number>();
  async function track<T>(kind: string, operation: () => Promise<T>): Promise<T> {
    const version = (resourceVersions.get(kind) || 0) + 1; resourceVersions.set(kind, version);
    state.resources[kind] = { loading: true, error: '' }; emit();
    try { return await operation(); }
    catch (error) { if (version === resourceVersions.get(kind)) state.resources[kind]!.error = error instanceof Error ? error.message : String(error); throw error; }
    finally { if (version === resourceVersions.get(kind)) state.resources[kind]!.loading = false; emit(); }
  }
  function allow(permission: string): void { if (deps.allow && !deps.allow(permission)) throw new C2Error('Permission denied: ' + permission); }
  async function json<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (disposed) throw new C2Error('C2 disposed');
    const response = await request(path, { method, signal: lifetime.signal, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    const value: unknown = await response.json();
    const error = value && typeof value === 'object' && 'error' in value ? value.error : undefined;
    if (!response.ok || error) throw new C2Error(typeof error === 'string' ? error : `HTTP ${response.status}`);
    return value as T;
  }
  async function loadListeners(): Promise<void> {
    return track('listeners', async () => {
    const [data, sessions] = await Promise.all([json<{ listeners?: C2Listener[] }>('GET', base + '/listeners'), json<{ sessions?: C2Session[] }>('GET', base + '/sessions').catch(() => null), loadProfiles()]);
    state.listenerSessionCounts = sessions ? (sessions.sessions || []).reduce<Record<string, number>>((counts, session) => { counts[session.listenerId] = (counts[session.listenerId] || 0) + 1; return counts; }, {}) : null;
    if (disposed) return; state.listeners = data.listeners || []; emit();
    });
  }
  async function ensureListeners(): Promise<void> {
    if (state.listeners.length) return;
    listenersLoading ??= loadListeners().finally(() => { listenersLoading = undefined; });
    return listenersLoading;
  }
  async function loadProfiles(): Promise<void> {
    if (profilesLoading) return profilesLoading;
    profilesLoading = track('profiles', () => json<{ profiles?: C2Profile[] }>('GET', base + '/profiles').then(data => { if (!disposed) { state.profiles = data.profiles || []; emit(); } })).finally(() => { profilesLoading = undefined; });
    return profilesLoading;
  }
  async function loadSessions(): Promise<void> {
    return track('sessions', async () => {
    const version = ++sessionsVersion;
    const data = await json<{ sessions?: C2Session[] }>('GET', base + '/sessions?' + filterQuery({ ...state.sessionFilter, status: '' }));
    if (disposed || version !== sessionsVersion) return;
    state.sessions = (data.sessions || []).filter(session => !state.sessionFilter.status || sessionState(session) === state.sessionFilter.status); emit();
    });
  }
  async function loadTasks(page = state.tasksPage): Promise<void> {
    return track('tasks', async () => {
    const version = ++tasksVersion;
    const data = await json<TasksResponse>('GET', base + '/tasks?' + filterQuery({ ...state.tasksFilter, page, page_size: state.tasksPageSize }));
    if (disposed || version !== tasksVersion) return;
    const tasks = data.tasks || []; const total = data.total ?? tasks.length;
    const maxPage = Math.max(1, Math.ceil(total / state.tasksPageSize));
    if (page > maxPage) return loadTasks(maxPage);
    state.tasksPage = Math.max(1, page); state.tasks = tasks; state.tasksTotal = total;
    state.tasksCountsKnown = Boolean(data.status_counts); state.tasksStatusCounts = data.status_counts || { success: 0, failed: 0, pending: 0, cancelled: 0 };
    state.tasksPendingQueuedCount = data.pending_queued_count ?? null; emit();
    });
  }
  async function loadEvents(page = state.eventsPage): Promise<void> {
    return track('events', async () => {
    const version = ++eventsVersion;
    const data = await json<EventsResponse>('GET', base + '/events?' + filterQuery({ ...state.eventsFilter, page, page_size: state.eventsPageSize }));
    if (disposed || version !== eventsVersion) return;
    const events = data.events || []; const total = data.total ?? events.length;
    const maxPage = Math.max(1, Math.ceil(total / state.eventsPageSize));
    if (page > maxPage) return loadEvents(maxPage);
    state.eventsPage = Math.max(1, page); state.events = events; state.eventsTotal = total;
    state.eventsCountsKnown = Boolean(data.level_counts); state.eventsLevelCounts = data.level_counts || { info: 0, warn: 0, critical: 0 }; emit();
    });
  }
  async function saveListener(draft: ListenerDraft, id?: string): Promise<void> {
    allow('c2:write'); const invalid = validateListener(draft, !id); if (invalid) throw new C2Error(invalid);
    await json(id ? 'PUT' : 'POST', id ? resourcePath('listeners', id) : base + '/listeners', draft); await loadListeners();
  }
  async function listenerAction(id: string, action: 'start' | 'stop' | 'delete'): Promise<void> {
    allow(action === 'delete' ? 'c2:delete' : 'c2:write');
    await json(action === 'delete' ? 'DELETE' : 'POST', resourcePath('listeners', id) + (action === 'delete' ? '' : '/' + action), {}); await loadListeners();
  }
  async function bindListenerProject(id: string, projectId: string): Promise<void> {
    const item = state.listeners.find(listener => listener.id === id); if (!item) return;
    await saveListener({ name: item.name, bind_host: item.bindHost || '127.0.0.1', bind_port: item.bindPort, remark: item.remark || '', callback_host: listenerCallbackHost(item), project_id: projectId.trim(), profile_id: item.profileId || item.profile_id || '', config: listenerConfig(item) }, id);
  }
  async function deleteResources(kind: 'sessions' | 'tasks' | 'events', ids: string[]): Promise<number> {
    allow('c2:delete'); if (!ids.length) return 0;
    const data = await json<{ deleted?: number }>('DELETE', base + '/' + kind, { ids });
    if (kind === 'sessions') { if (state.selectedSessionId && ids.includes(state.selectedSessionId)) selectSession(null); await loadSessions(); }
    else if (kind === 'tasks') await loadTasks(); else await loadEvents();
    return data.deleted ?? ids.length;
  }
  function selectSession(id: string | null): void {
    if (state.selectedSessionId !== id) { state.selectedSessionId = id; state.currentPath = '.'; state.implantPwd = null; state.fileList = []; }
    emit();
  }
  async function createTask(sessionId: string, type: string, payload: Record<string, JsonValue | undefined> = {}): Promise<TaskCreated> {
    allow('c2:write'); return json<TaskCreated>('POST', base + '/tasks', { session_id: sessionId, task_type: type, payload });
  }
  async function getTask(id: string): Promise<C2Task | undefined> { return (await json<{ task?: C2Task }>('GET', resourcePath('tasks', id))).task; }
  async function waitForTask(id: string, options: { attempts?: number; interval?: number | ((attempt: number) => number); progress?: (task: C2Task | undefined, attempt: number) => void } = {}): Promise<C2Task> {
    for (let attempt = 1; attempt <= (options.attempts ?? 120); attempt++) {
      lifetime.signal.throwIfAborted(); const task = await getTask(id); options.progress?.(task, attempt);
      if (task?.status === 'success') return task;
      if (task && ['failed', 'cancelled'].includes(task.status)) throw new C2Error(task.error || task.resultText || task.status);
      const interval = typeof options.interval === 'function' ? options.interval(attempt) : options.interval ?? 500;
      await delay(task?.approvalStatus === 'pending' ? 1000 : interval, lifetime.signal);
    }
    throw new C2Error('c2.tasks.timeout');
  }
  async function taskResult(created: TaskCreated): Promise<C2Task | undefined> {
    const id = created.task?.id || created.task_id; return id ? waitForTask(id) : created.task;
  }
  function selectedSession(): C2Session | undefined { return state.sessions.find(session => session.id === state.selectedSessionId); }
  function remotePath(browsePath: string, filename: string): string {
    let path = state.implantPwd ? resolvePathAgainstPwd(state.implantPwd, joinFilePath(browsePath, filename)) : joinFilePath(browsePath, filename);
    if (sessionIsWindows(selectedSession())) path = path.replace(/\//g, '\\');
    return path;
  }
  async function refreshPwd(sessionId: string): Promise<string | null> {
    const task = await taskResult(await createTask(sessionId, 'pwd'));
    const pwd = task?.resultText?.trim();
    if (pwd && state.selectedSessionId === sessionId) state.implantPwd = normalizeFilePath(pwd);
    return pwd || null;
  }
  async function loadFileList(sessionId: string, path: string): Promise<string> {
    const task = await taskResult(await createTask(sessionId, 'ls', { path }));
    const output = task?.resultText || '';
    if (isDownloadShellError(output)) throw new C2Error(output.trim());
    if (state.selectedSessionId === sessionId) { state.currentPath = normalizeFilePath(path); emit(); }
    return output;
  }
  async function uploadFile(file: File, progress?: (percent: number) => void): Promise<void> {
    const sessionId = state.selectedSessionId;
    if (!sessionId || state.fileUploadBusy) return;
    allow('c2:write'); if (!sessionSupportsUpload(selectedSession())) throw new C2Error('c2.files.uploadUnsupported');
    const path = remotePath(state.currentPath, file.name);
    const form = new FormData(); form.append('session_id', sessionId); form.append('remote_path', path); form.append('file', file);
    state.fileUploadBusy = true;
    const update = (percent: number) => { state.uploadProgress = { visible: true, percent, filename: file.name }; progress?.(percent); emit(); };
    update(0);
    try {
      const response = deps.upload ? await deps.upload(base + '/files/upload', form, percent => update(Math.min(percent, 50)), lifetime.signal) : await request(base + '/files/upload', { method: 'POST', body: form, signal: lifetime.signal });
      if (!response.ok) throw new C2Error(await response.text());
      const data = await response.json() as { file_id?: string; error?: string };
      if (!data.file_id) throw new C2Error(data.error || 'c2.files.failed'); update(55);
      const created = await createTask(sessionId, 'upload', { remote_path: path, file_id: data.file_id });
      const taskId = created.task?.id || created.task_id;
      if (taskId) await waitForTask(taskId, { progress: (task, attempt) => update(task?.approvalStatus === 'pending' ? 60 : 60 + Math.min(35, Math.floor(attempt / 3))) });
      update(100);
    } finally { state.fileUploadBusy = false; state.uploadProgress.visible = false; emit(); }
  }
  async function downloadFile(filename: string): Promise<Blob | undefined> {
    const sessionId = state.selectedSessionId; if (!sessionId) return;
    const task = await taskResult(await createTask(sessionId, 'download', { remote_path: remotePath(state.currentPath, filename) }));
    if (!task) return;
    if (task.resultBlobPath) return download(resourcePath('tasks', task.id) + '/result-file');
    return new Blob([downloadContent(task.resultText || '')], { type: 'application/octet-stream' });
  }
  async function download(path: string): Promise<Blob> { const response = await request(path, { signal: lifetime.signal }); if (!response.ok) throw new C2Error('download failed: ' + response.status); return response.blob(); }
  async function executeCommand(command: string, output: (text: string, error: boolean) => void): Promise<void> {
     state.terminalQueue.push(command);
    if (state.terminalBusy || !state.selectedSessionId) return;
    const sessionId = state.selectedSessionId; state.terminalBusy = true; emit();
    try {
      while (state.terminalQueue.length && !disposed && state.selectedSessionId === sessionId) {
        const next = state.terminalQueue.shift()!;
        const history = terminalHistory.get(sessionId) || [];
        if (history[history.length - 1] !== next) history.push(next);
        terminalHistory.set(sessionId, history.slice(-100));
        try {
          state.terminalTaskId = ''; state.terminalFeedback = 'c2.sessions.termSubmitting'; emit();
          const created = await createTask(sessionId, 'shell', { command: next, timeout_seconds: 60 });
          const taskId = created.task?.id || created.task_id;
          state.terminalTaskId = taskId || '';
          if (!taskId && !created.task) throw new C2Error('c2.tasks.missingResponse');
          const task = taskId ? await waitForTask(taskId, { attempts: 60, interval: attempt => Math.min(500 * Math.pow(1.5, attempt), 5000), progress: task => { state.terminalFeedback = task?.approvalStatus === 'pending' ? 'c2.sessions.termApproval' : 'c2.tasks.' + (task?.status || 'queued'); emit(); } }) : created.task;
          if (task) output(task.resultText || '', false);
          state.terminalFeedback = 'c2.sessions.termCompleted';
        }
        catch (error) { state.terminalFeedback = 'c2.sessions.termStatusErr'; output(error instanceof Error ? error.message : String(error), true); }
      }
    } finally { state.terminalBusy = false; state.terminalQueue.length = 0; emit(); }
  }
  function onEvent(event: C2Event): void {
    if (disposed) return;
    if ((state.currentPage === 'c2-events' || state.currentPage === 'c2-activity' && state.activityTab === 'events') && state.eventsPage === 1) void loadEvents().catch(() => undefined);
    const message = String(event.message || '');
    const sessionId = event.sessionId || String(event.data?.session_id || '');
    const online = event.category === 'session' && event.level === 'critical' && /\u4e0a\u7ebf|\u65b0\u4f1a\u8bdd|new session/i.test(message);
    const offline = event.category === 'session' && /\u79bb\u7ebf|offline/i.test(message);
    if (online || offline) {
      const hadSelection = Boolean(state.selectedSessionId);
      void loadSessions().then(() => { if (online && sessionId && !hadSelection && state.currentPage === 'c2-sessions') selectSession(sessionId); }).catch(() => undefined);
      deps.refreshDashboard?.();
      if (state.currentPage === 'c2-listeners') void loadListeners().catch(() => undefined);
    }
    if (online) deps.notify?.(`[${event.category}] ${message}`, 'info');
    else if (event.level === 'critical') deps.notify?.(`[${event.category}] ${message}`, 'error');
    if (event.category === 'task') {
      if (state.currentPage === 'c2-tasks' || state.currentPage === 'c2-activity' && state.activityTab === 'tasks') void loadTasks(message.includes(BACKEND_QUEUED_FRAGMENT) ? 1 : state.tasksPage).catch(() => undefined);
      if (sessionId && state.currentPage === 'c2-sessions' && state.selectedSessionId === sessionId) deps.sessionTasksChanged?.(sessionId);
      deps.refreshDashboard?.();
    }
    emit();
  }
  function connectEventStream(): void { if (!stream && !disposed) stream = deps.eventStream?.(onEvent); }
  function disconnectEventStream(): void { stream?.close(); stream = undefined; }
  async function pageChanged(page: string): Promise<void> {
    state.currentPage = page;
    if (!page.startsWith('c2')) { disconnectEventStream(); return; }
    connectEventStream();
    switch (page) {
      case 'c2-listeners': await loadListeners(); break;
      case 'c2-sessions': await ensureListeners(); await loadSessions(); break;
      case 'c2-tasks': await loadTasks(); break;
      case 'c2-activity': await (state.activityTab === 'events' ? loadEvents() : loadTasks()); break;
      case 'c2-payloads': await ensureListeners(); break;
      case 'c2-events': await loadEvents(); break;
      case 'c2-profiles': await loadProfiles(); break;
    }
    emit();
  }
  return {
    state, allow, loadListeners, ensureListeners, loadProfiles, loadSessions, loadTasks, loadEvents,
    saveListener, listenerAction, bindListenerProject, deleteResources, selectSession, selectedSession,
    createTask, getTask, waitForTask, taskResult, remotePath, refreshPwd, loadFileList, uploadFile, downloadFile,
    executeCommand, connectEventStream, disconnectEventStream, onEvent, pageChanged,
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
    async setSessionSleep(id: string, seconds: number, jitter: number) {
      allow('c2:write');
      if (!Number.isInteger(seconds) || seconds < 1) throw new C2Error('c2.sessions.toastSleepInvalid');
      const jitterPercent = Number.isFinite(jitter) ? Math.max(0, Math.min(100, Math.trunc(jitter))) : 0;
      await json('PUT', resourcePath('sessions', id) + '/sleep', { sleep_seconds: seconds, jitter_percent: jitterPercent });
      await loadSessions();
    },
    async saveSessionNote(id: string, note: string) { allow('c2:write'); note = note.trim(); if (note.length > 2000) throw new C2Error('Note exceeds 2000 characters'); const data = await json<{ note?: string }>('PUT', resourcePath('sessions', id) + '/note', { note }); const session = state.sessions.find(item => item.id === id); if (session) session.note = data.note ?? note; emit(); },
    async killSession(id: string) { await createTask(id, 'exit'); await loadSessions(); },
    async sessionTasks(id: string, page = 1) { return json<TasksResponse>('GET', base + '/tasks?' + filterQuery({ session_id: id, page, page_size: 25 })); },
    async getSession(id: string) { return (await json<{ session?: C2Session }>('GET', resourcePath('sessions', id))).session; },
    downloadTaskResult(id: string) { return download(resourcePath('tasks', id) + '/result-file'); },
    async cancelTask(id: string) { allow('c2:write'); await json('POST', resourcePath('tasks', id) + '/cancel', {}); await loadTasks(); },
    event(id: string) { return json<{ event?: C2Event }>('GET', resourcePath('events', id)).then(data => data.event); },
    async createProfile(draft: ProfileDraft, id?: string) {
      allow('c2:write');
      if (!draft.name.trim()) throw new C2Error('c2.profiles.toastNameRequired');
      if (!Number.isSafeInteger(draft.jitterMinMs) || !Number.isSafeInteger(draft.jitterMaxMs) || draft.jitterMinMs < 0 || draft.jitterMaxMs < draft.jitterMinMs) throw new C2Error('c2.profiles.toastInvalidJitter');
      await json(id ? 'PUT' : 'POST', id ? resourcePath('profiles', id) : base + '/profiles', draft); await loadProfiles();
    },
    async deleteProfile(id: string) { allow('c2:delete'); await json('DELETE', resourcePath('profiles', id), {}); await loadProfiles(); },
    generateOneliner(listenerId: string, kind: string, host: string) { allow('c2:write'); if (!listenerId) throw new C2Error('c2.payloads.toastPickListener'); return json<{ oneliner: string }>('POST', base + '/payloads/oneliner', { listener_id: listenerId, kind, host }); },
    buildBeacon(listenerId: string, os: string, arch: string, host: string) { allow('c2:write'); if (!listenerId) throw new C2Error('c2.payloads.toastPickListener'); return json<PayloadBuild>('POST', base + '/payloads/build', { listener_id: listenerId, os, arch, host }); },
    downloadPayload(filename: string) { return download(resourcePath('payloads', filename) + '/download'); },
    terminalHistory(id: string) { return terminalHistory.get(id) || []; },
    terminalLog(id: string) { return terminalLogs.get(id) || ''; },
    appendTerminalLog(id: string, text: string) { terminalLogs.set(id, ((terminalLogs.get(id) || '') + text).slice(-50000)); },
    clearTerminalLog(id: string) { terminalLogs.delete(id); },
    dispose(): void { if (disposed) return; disposed = true; lifetime.abort(); disconnectEventStream(); listeners.clear(); state.terminalQueue.length = 0; sessionsVersion++; tasksVersion++; eventsVersion++; },
  };
}
export type C2Service = ReturnType<typeof createC2Service>;
