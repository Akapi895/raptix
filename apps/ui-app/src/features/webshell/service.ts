import { http } from '../../platform/http';
import { resolveAgentEndpoint } from '../../platform/agent-endpoint';
import { parseSse } from '../../platform/sse';
import { webshellEventMessage } from './ai';
import { buildWebshellDbCommand, columnsSQL, parseWebshellDbExecOutput, parseWebshellDbSchema, schemaSQL } from './database';
import { connectionRequest, inferPathFromWindowsDirOutput, joinWebshellPath, normalizeDbState, normalizeTerminalSessions, normalizeWebshellOS, normalizeWebshellPath, parseWebshellListItems, type ConnectionDraft, type DbProfile, type ExecResult, type FileRequest, type PersistState, type WebshellConnection } from './model';

export type Request = (path: string, init?: RequestInit) => Promise<Response>;
export interface ProcessDetail { eventType: string; message: string; data?: Record<string, unknown>; }
export interface AiMessage { role: string; content: string; reasoningContent?: string; processDetails?: ProcessDetail[]; finalized?: boolean; }
export interface AiConversation { id: string; title: string; updatedAt?: string; projectId?: string; project_id?: string; messages?: AiMessage[]; }
export interface AiEvent { type: string; message: string; data: Record<string, unknown>; }
export interface AiRun {
  connectionId: string; conversationId: string; sending: boolean; response: string;
  finalized: boolean; error: string; details: ProcessDetail[]; streams: Map<string, string>;
}
export interface WebshellServiceDependencies {
  request?: Request;
  role?(): string;
  reasoning?(): unknown;
}
export class WebshellError extends Error {}
const connectionPath = (id: string) => '/api/webshell/connections/' + encodeURIComponent(id);
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown): string { return value == null ? '' : String(value); }
export function mergeStreamBuffer(current: string, delta: string, data: Record<string, unknown>): string {
  if (typeof data.accumulated === 'string') return data.accumulated;
  if (!delta) return current;
  if (current && delta.length > current.length && delta.startsWith(current)) return delta;
  return current + delta;
}
export function finalizationNotice(data: Record<string, unknown>, hasContract: boolean): string {
  const labels: Record<string, string> = { pending_tool_executions: 'Waiting for tool executions to finish', missing_execution_evidence: 'Completion evidence missing', awaiting_hitl: 'Waiting for human confirmation', empty_response: 'No valid response captured', missing_finalization_contract: 'Finalization proof missing', in_progress: 'Still verifying', blocked: 'Checks not passed', failed: 'Task failed', cancelled: 'Task cancelled', verified: 'Verified' };
  const reason = hasContract ? text(data.completionReason || data.status) : 'missing_finalization_contract';
  const lines = ['Still verifying; no final conclusion yet', 'Status: ' + (labels[reason] || reason || 'Checks not passed')];
  const pending = Array.isArray(data.pendingExecutionIds) ? data.pendingExecutionIds.filter(Boolean).map(String) : [];
  if (pending.length) lines.push('Pending tools: ' + pending.slice(0, 3).join(', ') + (pending.length > 3 ? ', …' : ''));
  const missing = Array.isArray(data.missingChecks) ? data.missingChecks.filter(Boolean).map(String) : [];
  if (missing.length) lines.push('Pending checks: ' + missing.slice(0, 2).join('; ') + (missing.length > 2 ? ', …' : ''));
  return lines.join('\n');
}

export function createWebshellService(deps: WebshellServiceDependencies = {}) {
  const request = deps.request ?? ((path, init) => http.raw(path, init));
  const listeners = new Set<() => void>();
  const persist = new Map<string, PersistState>();
  const loaded = new Set<string>();
  const loading = new Map<string, Promise<void>>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const persistStatus = new Map<string, 'saving' | 'saved' | 'error'>();
  const logs = new Map<string, string>();
  const histories = new Map<string, string[]>();
  const probes = new Map<string, { state: 'probing' | 'ok' | 'fail'; message: string }>();
  const selectedFiles = new Map<string, string>();
  const trees = new Map<string, { directories: Map<string, ReturnType<typeof parseWebshellListItems>>; expanded: Set<string>; loaded: Set<string> }>();
  const aiConversations = new Map<string, string>();
  const aiProjects = new Map<string, string>();
  const aiDrafts = new Map<string, string>();
  let connections: WebshellConnection[] = [];
  let currentId: string | null = null;
  let batchRunning = false;
  let batchProgress = { done: 0, total: 0, ok: 0 };
  let disposed = false;
  let commandBusy = false;
  let aiController: AbortController | undefined;
  let aiRun: AiRun | undefined;
  let selection = 0;
  const lifetime = new AbortController();
  const emit = () => { if (!disposed) listeners.forEach(listener => listener()); };
  async function json<T>(path: string, init?: RequestInit): Promise<T> {
    if (disposed) throw new WebshellError('WebShell disposed');
    const response = await request(path, { ...init, signal: init?.signal ?? lifetime.signal });
    const value: unknown = await response.json();
    const error = object(value).error;
    if (!response.ok || error) throw new WebshellError(typeof error === 'string' ? error : `HTTP ${response.status}`);
    return value as T;
  }
  const post = <T>(path: string, body: unknown, method = 'POST', signal?: AbortSignal) => json<T>(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  function state(id: string): PersistState {
    let value = persist.get(id);
    if (!value) { value = { dbState: normalizeDbState(), terminalSessions: normalizeTerminalSessions() }; persist.set(id, value); }
    return value;
  }
  async function saveState(id: string): Promise<void> {
    await post(connectionPath(id) + '/state', { state: state(id) }, 'PUT');
  }
  function queueSave(id: string): void {
    if (disposed) return;
    clearTimeout(timers.get(id));
    persistStatus.set(id, 'saving'); emit();
    timers.set(id, setTimeout(() => { timers.delete(id); void saveState(id).then(() => persistStatus.set(id, 'saved')).catch(() => persistStatus.set(id, 'error')).finally(emit); }, 500));
  }
  async function ensureState(connection: WebshellConnection): Promise<void> {
    if (loaded.has(connection.id)) return;
    const pending = loading.get(connection.id);
    if (pending) return pending;
    const operation = json<{ state?: Partial<PersistState> }>(connectionPath(connection.id) + '/state').then(data => {
      if (!disposed) persist.set(connection.id, { dbState: normalizeDbState(data.state?.dbState), terminalSessions: normalizeTerminalSessions(data.state?.terminalSessions) });
    }).catch(() => undefined).finally(() => { loaded.add(connection.id); loading.delete(connection.id); });
    loading.set(connection.id, operation);
    return operation;
  }
  async function refresh(): Promise<WebshellConnection[]> {
    const list = await json<WebshellConnection[] | null>('/api/webshell/connections');
    if (!disposed) { connections = Array.isArray(list) ? list : []; emit(); }
    return connections;
  }
  async function select(id: string): Promise<WebshellConnection | undefined> {
    const version = ++selection;
    const connection = connections.find(item => item.id === id);
    if (!connection) return;
    await ensureState(connection);
    if (disposed || version !== selection) return;
    currentId = id; emit();
    return connection;
  }
  async function saveConnection(draft: ConnectionDraft, id?: string): Promise<void> {
    if (!/^https?:\/\//i.test(draft.url.trim())) throw new WebshellError('Enter a valid HTTP/HTTPS URL');
    await post(id ? connectionPath(id) : '/api/webshell/connections', { ...draft, cmd_param: draft.cmdParam, encoding: draft.encoding, os: draft.os }, id ? 'PUT' : 'POST');
    await refresh();
  }
  async function remove(id: string): Promise<void> {
    await json(connectionPath(id), { method: 'DELETE' });
    clearTimeout(timers.get(id)); timers.delete(id); persist.delete(id); loaded.delete(id); trees.delete(id); selectedFiles.delete(id);
    const prefix = id + '::';
    for (const key of logs.keys()) if (key.startsWith(prefix)) logs.delete(key);
    for (const key of histories.keys()) if (key.startsWith(prefix)) histories.delete(key);
    if (currentId === id) { currentId = null; selection++; }
    aiConversations.delete(id); aiDrafts.delete(id);
    await refresh();
  }
  async function execute(connection: WebshellConnection, command: string): Promise<ExecResult> {
    const result = await post<ExecResult>('/api/webshell/exec', { ...connectionRequest(connection), command });
    if (!result.ok) throw new WebshellError(result.error || result.output || 'Execution failed');
    return result;
  }
  function terminalKey(id: string): string { return id + '::' + state(id).terminalSessions.activeId; }
  async function runCommand(connection: WebshellConnection, command: string): Promise<ExecResult> {
    if (commandBusy) throw new WebshellError('A command is already running; try again shortly');
    const key = terminalKey(connection.id);
    const history = histories.get(key) ?? [];
    if (command.trim() && history[history.length - 1] !== command) { history.push(command); histories.set(key, history.slice(-100)); }
    commandBusy = true; emit();
    try { return await execute(connection, command); }
    finally { commandBusy = false; emit(); }
  }
  async function file(connection: WebshellConnection, extra: FileRequest): Promise<ExecResult> {
    const result = await post<ExecResult>('/api/webshell/file', { ...connectionRequest(connection), ...extra });
    if (!result.ok) throw new WebshellError(result.error || result.output || 'File operation failed');
    const detected = normalizeWebshellOS(result.detected_os);
    if (normalizeWebshellOS(connection.os) === 'auto' && detected !== 'auto') {
      connection.os = detected;
      emit();
      void post(connectionPath(connection.id), { ...connection, cmd_param: connection.cmdParam, os: detected }, 'PUT').catch(() => undefined);
    }
    return result;
  }
  async function listDirectory(connection: WebshellConnection, path: string) {
    const result = await file(connection, { action: 'list', path });
    const output = result.output || '';
    const resolvedPath = inferPathFromWindowsDirOutput(output) || normalizeWebshellPath(path);
    const items = parseWebshellListItems(output);
    const tree = getTree(connection.id); tree.directories.set(resolvedPath, items); tree.loaded.add(resolvedPath); tree.expanded.add(resolvedPath);
    return { path: resolvedPath, items, output };
  }
  function getTree(id: string) {
    let tree = trees.get(id);
    if (!tree) { tree = { directories: new Map(), expanded: new Set(['.']), loaded: new Set() }; trees.set(id, tree); }
    return tree;
  }
  async function upload(connection: WebshellConnection, base: string, fileData: { name: string; arrayBuffer(): Promise<ArrayBuffer> }, progress?: (done: number, total: number) => void): Promise<void> {
    const bytes = new Uint8Array(await fileData.arrayBuffer());
    const total = Math.max(1, Math.ceil(bytes.length / 32000));
    for (let index = 0; index < total; index++) {
      const chunk = bytes.subarray(index * 32000, (index + 1) * 32000);
      const content = btoa(Array.from(chunk, byte => String.fromCharCode(byte)).join(''));
      await file(connection, { action: 'upload_chunk', path: joinWebshellPath(base, fileData.name), content, chunk_index: index });
      progress?.(index + 1, total);
    }
  }
  async function probe(connection: WebshellConnection): Promise<{ ok: boolean; message: string }> {
    const token = '__CSAI_PROBE_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36) + '__';
    try {
      const result = await execute(connection, 'echo ' + token);
      return { ok: Boolean(result.ok && result.output?.includes(token)), message: result.output?.includes(token) ? 'Connectivity OK; shell is reachable' : result.error || 'Connectivity test failed' };
    } catch (error) { return { ok: false, message: error instanceof Error ? error.message : String(error) }; }
  }
  async function batchProbe(): Promise<void> {
    if (batchRunning || disposed) return;
    batchRunning = true;
    const list = connections.slice(); let next = 0;
    batchProgress = { done: 0, total: list.length, ok: 0 };
    list.forEach(connection => probes.set(connection.id, { state: 'probing', message: '' })); emit();
    try {
      await Promise.all(Array.from({ length: Math.min(4, list.length) }, async () => {
        while (!disposed) {
          const connection = list[next++]; if (!connection) return;
          const result = await probe(connection);
          probes.set(connection.id, { state: result.ok ? 'ok' : 'fail', message: result.message });
          batchProgress.done++; if (result.ok) batchProgress.ok++; emit();
        }
      }));
    } finally { batchRunning = false; emit(); }
  }
  function activeDb(id: string): DbProfile { const db = state(id).dbState; return db.profiles.find(profile => profile.id === db.activeProfileId) || db.profiles[0]!; }
  async function runSql(connection: WebshellConnection, testOnly = false, sql?: string) {
    const profile = activeDb(connection.id);
    const result = await execute(connection, buildWebshellDbCommand(profile, testOnly, sql));
    const parsed = parseWebshellDbExecOutput(result.output || '');
    profile.output = parsed.output; profile.outputIsError = parsed.rc !== null && parsed.rc !== 0;
    queueSave(connection.id); emit(); return parsed;
  }
  async function loadSchema(connection: WebshellConnection) {
    const profile = activeDb(connection.id);
    const result = await execute(connection, buildWebshellDbCommand(profile, false, schemaSQL(profile.type)));
    const parsed = parseWebshellDbExecOutput(result.output || '');
    if (parsed.rc !== null && parsed.rc !== 0) throw new WebshellError(parsed.output);
    profile.schema = parseWebshellDbSchema(parsed.output); queueSave(connection.id); emit(); return profile.schema;
  }
  function conversationId(id: string): string { return aiConversations.get(id) || ''; }
  function projectId(id: string): string { const conv = conversationId(id); return (conv ? aiProjects.get(conv) : aiDrafts.get(id)) || ''; }
  async function setProject(id: string, project: string): Promise<void> {
    const conv = conversationId(id);
    if (conv) { await post('/api/conversations/' + encodeURIComponent(conv) + '/project', { projectId: project }, 'PUT'); aiProjects.set(conv, project); }
    else aiDrafts.set(id, project);
    emit();
  }
  async function aiHistory(id: string): Promise<{ conversationId?: string; messages: AiMessage[] }> {
    const data = await json<{ conversationId?: string; messages: AiMessage[] }>(connectionPath(id) + '/ai-history');
    if (data.conversationId) {
      aiConversations.set(id, data.conversationId);
      const conv = await json<AiConversation>('/api/conversations/' + encodeURIComponent(data.conversationId)).catch(() => undefined);
      if (conv) aiProjects.set(data.conversationId, conv.projectId || conv.project_id || '');
    }
    emit(); return data;
  }
  async function selectConversation(id: string, convId: string): Promise<AiConversation> {
    const conv = await json<AiConversation>('/api/conversations/' + encodeURIComponent(convId) + '?include_process_details=1');
    aiConversations.set(id, convId); aiProjects.set(convId, conv.projectId || conv.project_id || ''); emit(); return conv;
  }
  async function stopAi(): Promise<void> {
    const conv = aiRun?.conversationId;
    aiController?.abort();
    if (conv && !disposed) await post('/api/agent-loop/cancel', { conversationId: conv }).catch(() => undefined);
  }
  async function sendAi(connection: WebshellConnection, message: string, onEvent?: (event: AiEvent, run: AiRun) => void): Promise<AiRun> {
    if (aiRun?.sending) throw new WebshellError('An AI request is already running');
    const controller = new AbortController(); aiController = controller;
    const run: AiRun = { connectionId: connection.id, conversationId: conversationId(connection.id), sending: true, response: '', finalized: false, error: '', details: [], streams: new Map() };
    aiRun = run; emit();
    try {
      const endpoint = await resolveAgentEndpoint(request, controller.signal);
      const body = { message, webshellConnectionId: connection.id, conversationId: run.conversationId, role: deps.role?.() || '', finalization: { requireExecutionEvidence: true }, ...(!run.conversationId && projectId(connection.id) ? { projectId: projectId(connection.id) } : {}), ...(deps.reasoning?.() ? { reasoning: deps.reasoning() } : {}) };
      controller.signal.throwIfAborted();
      const response = await request(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      if (!response.ok || !response.body) throw new WebshellError('Request failed: HTTP ' + response.status);
      for await (const raw of parseSse(response.body.getReader(), { signal: controller.signal })) {
        const value = object(raw);
        const event: AiEvent = { type: text(value.type), message: text(value.message), data: object(value.data) };
        const data = event.data;
        switch (event.type) {
          case 'conversation': {
            const conv = text(data.conversationId); if (!conv) break;
            run.conversationId = conv; aiConversations.set(connection.id, conv);
            if (aiDrafts.has(connection.id)) { aiProjects.set(conv, aiDrafts.get(connection.id)!); aiDrafts.delete(connection.id); }
            break;
          }
          case 'response_start': run.response = ''; run.finalized = false; break;
          case 'response_delta': run.response = mergeStreamBuffer(run.response, event.message, data); break;
          case 'response': {
            const hasContract = ['finalized', 'finalizable', 'completionReason', 'evidenceVerified', 'missingChecks'].some(key => Object.hasOwn(data, key));
            run.finalized = data.finalized === true;
            if (!run.finalized && !hasContract && event.message) run.details.push({ eventType: 'finalization_check', message: event.message, data: { missingFinalizationContract: true } });
            run.response = run.finalized ? event.message || (typeof value.data === 'string' ? value.data : '') : finalizationNotice(data, hasContract);
            break;
          }
          case 'error': run.error = event.message; run.details.push({ eventType: 'error', message: event.message, data }); break;
          case 'cancelled': if (!run.response) run.response = event.message || 'Task cancelled'; run.details.push({ eventType: 'cancelled', message: event.message, data }); break;
          default: {
            const streamId = text(data.streamId || data.toolCallId);
            if (event.type.endsWith('_stream_start') && streamId) run.streams.set(streamId, '');
            else if (event.type.endsWith('_stream_delta') && streamId) run.streams.set(streamId, mergeStreamBuffer(run.streams.get(streamId) || '', event.message, data));
            else if (event.type.endsWith('_stream_end') && streamId) { event.message ||= run.streams.get(streamId) || ''; run.streams.delete(streamId); }
            run.details.push({ eventType: event.type, message: webshellEventMessage(event), data });
          }
        }
        onEvent?.(event, run); emit();
      }
    } catch (error) {
      if (!controller.signal.aborted) run.error = error instanceof Error ? error.message : String(error);
    } finally {
      run.sending = false;
      if (aiController === controller) aiController = undefined;
      emit();
    }
    return run;
  }
  return {
    get connections() { return connections; }, get currentId() { return currentId; },
    get currentConnection() { return connections.find(connection => connection.id === currentId); },
    get commandBusy() { return commandBusy; }, get batchRunning() { return batchRunning; },
    get batchProgress() { return batchProgress; }, get probes() { return probes; }, get aiRun() { return aiRun; },
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
    refresh, select, saveConnection, remove, execute, runCommand, file, listDirectory, upload, probe, batchProbe,
    state, ensureState, queueSave, saveState, activeDb, runSql, loadSchema, getTree,
    async loadColumns(connection: WebshellConnection, database: string, table?: string) { const profile = activeDb(connection.id); return execute(connection, buildWebshellDbCommand(profile, false, columnsSQL(profile.type, database, table))); },
    terminalKey,
    terminalLog(id: string) { return logs.get(terminalKey(id)) || ''; },
    appendTerminalLog(id: string, chunk: string) { const key = terminalKey(id); logs.set(key, ((logs.get(key) || '') + chunk).slice(-50000)); },
    clearTerminalLog(id: string) { logs.delete(terminalKey(id)); },
    history(id: string) { return histories.get(terminalKey(id)) || []; },
    selectedFile(id: string) { return selectedFiles.get(id) || ''; },
    selectFile(id: string, path: string) { selectedFiles.set(id, normalizeWebshellPath(path)); },
    conversationId, projectId, setProject, aiHistory, selectConversation, sendAi, stopAi,
    conversations(id: string) { return json<AiConversation[] | null>(connectionPath(id) + '/ai-conversations').then(list => list || []); },
    async deleteConversation(convId: string) { await json('/api/conversations/' + encodeURIComponent(convId), { method: 'DELETE' }); for (const [id, conv] of aiConversations) if (conv === convId) aiConversations.delete(id); aiProjects.delete(convId); emit(); },
    newConversation(id: string) { aiConversations.delete(id); emit(); },
    forgetConversation(convId: string) { for (const [id, conv] of aiConversations) if (conv === convId) aiConversations.delete(id); aiProjects.delete(convId); emit(); },
    stateSaveStatus(id: string) { return persistStatus.get(id) || 'saved'; },
    roles() { return json<{ roles: { name: string; icon?: string; description?: string; enabled: boolean }[] }>('/api/roles').then(data => data.roles || []); },
    config() { return json<{ multi_agent?: { enabled?: boolean } }>('/api/config'); },
    async dispose(): Promise<void> {
      if (disposed) return;
      const pending = [...timers.keys()]; timers.forEach(clearTimeout); timers.clear();
      await stopAi();
      await Promise.all(pending.map(id => saveState(id).catch(() => undefined)));
      disposed = true; lifetime.abort(); listeners.clear(); selection++;
    },
  };
}
export type WebshellService = ReturnType<typeof createWebshellService>;
