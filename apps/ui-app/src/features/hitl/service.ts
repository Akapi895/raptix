import { decodeItem, decodeStrategy, decodeWorkflow, effectiveEnabled, normalizeBackend, normalizeConfig, normalizeMode, normalizeReviewer, normalizeTimeout, object, parsePayload, stripGlobalTools, tools, workflowLabel } from './model';
import type { HitlConfig, HitlDefaults, HitlDependencies, HitlDecision, HitlFilters, HitlItem, HitlList, HitlState, HitlStrategy, JsonObject, WorkflowRun } from './types';

export const HITL_PAGE_SIZES = [10, 20, 50, 100] as const;
const pageSizeKey = (list: HitlList) => `raptix_hitl_${list}_page_size`;

export class HitlApiError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
export function createHitlService(deps: HitlDependencies) {
  let defaults: HitlDefaults = { mode: 'off', reviewer: 'human', timeoutSeconds: 300 };
  let whitelist: string[] | null = null;
  const saveQueues = new Map<string, Promise<boolean>>();
  const listeners = new Set<() => void>();
  let followSequence = 0;
  let disposed = false;
  const savedSize = (list: HitlList) => { const n = Number(deps.storage.get(pageSizeKey(list))); return HITL_PAGE_SIZES.some(size => size === n) ? n : 20; };
  const state: HitlState = {
    tab: 'pending', strategyMode: 'approval', strategy: {},
    pending: { page: 1, pageSize: savedSize('pending'), total: 0, items: [], runs: [], q: '', loaded: false },
    logs: { page: 1, pageSize: savedSize('logs'), total: 0, items: [], filters: {}, retentionDays: 0, loaded: false },
    selectedLogs: new Set<string>(),
  };
  const selectedLogs = new Set<string>();
  const generations = { pending: 0, logs: 0, strategy: 0 };
  const changed = () => { if (!disposed) for (const fn of listeners) fn(); };
  function publish(): void { if (!disposed) deps.defaultsChanged?.({ ...defaults }, whitelist && [...whitelist]); }
  async function request(path: string, method = 'GET', body?: unknown): Promise<JsonObject> {
    const response = await deps.request(path, { method, credentials: 'same-origin',
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    const data = object(await response.json().catch(() => ({})));
    if (!response.ok) throw new HitlApiError(response.status, typeof data.error === 'string' && data.error.trim() ? data.error.trim() : `HTTP ${response.status}`);
    return data;
  }
  function applyDefaults(value: unknown): HitlDefaults {
    const v = object(value);
    const backend = normalizeBackend(v.auditBackend || v.audit_backend);
    const model = String(v.auditModel || v.audit_model || '').trim();
    defaults = { mode: normalizeMode(v.defaultMode || v.mode), reviewer: normalizeReviewer(v.defaultReviewer || v.reviewer),
      timeoutSeconds: normalizeTimeout(v.defaultTimeoutSeconds ?? v.timeoutSeconds, 300),
      ...(backend ? { auditBackend: backend } : {}), ...(model ? { auditModel: model } : {}) };
    if (Array.isArray(v.hitlGlobalToolWhitelist)) whitelist = tools(v.hitlGlobalToolWhitelist);
    publish(); return { ...defaults };
  }
  async function fetchDefaultConfig(): Promise<HitlDefaults> {
    try { return applyDefaults(await request('/api/hitl/default-config')); }
    catch (error) { if (error instanceof HitlApiError) return applyDefaults({ defaultTimeoutSeconds: 300 }); throw error; }
  }
  async function putDefaultConfig(config: Partial<HitlConfig>): Promise<HitlDefaults> {
    return applyDefaults(await request('/api/hitl/default-config', 'PUT', {
      mode: normalizeMode(config.mode ?? defaults.mode), reviewer: normalizeReviewer(config.reviewer ?? defaults.reviewer),
      timeoutSeconds: normalizeTimeout(config.timeoutSeconds ?? defaults.timeoutSeconds, 300),
    }));
  }
  async function fetchConversationConfig(id: string) {
    if (!id) return null;
    try {
      const data = await request('/api/hitl/config/' + encodeURIComponent(id));
      if (!data.hitl) return null;
      return { hitl: normalizeConfig(data.hitl), defaultMode: normalizeMode(data.defaultMode),
        defaultReviewer: normalizeReviewer(data.defaultReviewer), defaultTimeoutSeconds: normalizeTimeout(data.defaultTimeoutSeconds, 300),
        hitlGlobalToolWhitelist: tools(data.hitlGlobalToolWhitelist) };
    } catch (error) { if (error instanceof HitlApiError) return null; throw error; }
  }
  function saveConversationConfig(id: string, config: HitlConfig): Promise<boolean> {
    const cid = id.trim();
    if (!cid) return Promise.resolve(false);
    // Capture the draft now; later mutations must not change an already queued save.
    const mode = normalizeMode(config.mode);
    const payload = { conversationId: cid, enabled: config.enabled ?? mode !== 'off', mode,
      reviewer: normalizeReviewer(config.reviewer), sensitiveTools: tools(config.sensitiveTools), timeoutSeconds: normalizeTimeout(config.timeoutSeconds) };
    const queued = (saveQueues.get(cid) ?? Promise.resolve()).catch(() => false).then(async () => {
      await request('/api/hitl/config', 'PUT', payload); return true;
    });
    saveQueues.set(cid, queued);
    return queued.finally(() => { if (saveQueues.get(cid) === queued) saveQueues.delete(cid); });
  }
  async function syncConfigFromServer(id: string): Promise<void> {
    const pack = await fetchConversationConfig(id);
    if (!pack || disposed) return;
    applyDefaults(pack);
    let merged = pack.hitl;
    if (!effectiveEnabled(merged)) {
      const local = parsePayload(deps.storage.get('raptix-chat-hitl:' + id));
      if (normalizeMode(local.mode) !== 'off') {
        merged = { ...normalizeConfig(local), enabled: true, sensitiveTools: stripGlobalTools(whitelist, local.sensitiveTools),
          timeoutSeconds: normalizeTimeout(local.timeoutSeconds, merged.timeoutSeconds) };
        void saveConversationConfig(id, merged).catch(error => console.warn('HITL local config sync', error));
      }
    }
    const migrationKey = 'raptix-hitl-timeout-default-v1:' + id;
    if (normalizeTimeout(merged.timeoutSeconds) <= 0 && deps.storage.get(migrationKey) !== '1') {
      merged = { ...merged, timeoutSeconds: 300 };
      try { await saveConversationConfig(id, merged); deps.storage.set(migrationKey, '1'); }
      catch (error) { console.warn('HITL timeout migration', error); }
    } else if (merged.timeoutSeconds > 0) deps.storage.set(migrationKey, '1');
    if (disposed) return;
    const config: HitlConfig = { ...merged, mode: effectiveEnabled(merged) ? normalizeMode(merged.mode) : 'off',
      sensitiveTools: stripGlobalTools(whitelist, merged.sensitiveTools) };
    if (deps.saveConversationConfigLocally) deps.saveConversationConfigLocally(id, config);
    else deps.storage.set('chat_hitl_config_' + id, JSON.stringify(config));
    if (deps.getCurrentConversationId() === id) deps.applyConfigToUI?.(config);
    reconcileUI();
  }
  function reconcileUI(): void {
    if (disposed) return;
    const config = deps.readConfigFromForm?.();
    if (config) deps.updateStatusUI?.(config);
  }
  async function syncCurrentConfig(): Promise<void> {
    const id = deps.getCurrentConversationId(); const config = deps.readConfigFromForm?.();
    if (id && config) await saveConversationConfig(id, config);
  }
  async function fetchWhitelist(): Promise<string[]> {
    const data = await request('/api/hitl/tool-whitelist');
    whitelist = tools(data.toolWhitelist ?? data.hitlGlobalToolWhitelist); publish(); return [...whitelist];
  }
  async function resolveWhitelist(): Promise<string[]> {
    try { return await fetchWhitelist(); } catch (error) {
      const cached = deps.getExternalState?.().whitelist ?? whitelist;
      if (cached) return [...cached];
      try {
        const cfg = await request('/api/config');
        const list = object(cfg.hitl).tool_whitelist;
        if (Array.isArray(list)) { whitelist = tools(list); publish(); return [...whitelist]; }
      } catch { /* preserve the original endpoint error */ }
      throw error;
    }
  }
  async function putWhitelist(list: string[]): Promise<string[]> {
    const data = await request('/api/hitl/tool-whitelist', 'PUT', { toolWhitelist: list });
    whitelist = tools(data.toolWhitelist ?? data.hitlGlobalToolWhitelist ?? list); publish(); return [...whitelist];
  }
  async function mergeWhitelist(list: string[]): Promise<string[]> {
    const data = await request('/api/hitl/tool-whitelist', 'POST', { sensitiveTools: list });
    whitelist = tools(data.hitlGlobalToolWhitelist); publish(); return [...whitelist];
  }
  async function savePageWhitelist(list: string[]): Promise<string[]> {
    const result = await putWhitelist(list);
    const cid = deps.getCurrentConversationId();
    if (cid) {
      const cfg = deps.getConversationConfig?.(cid) ?? { mode: 'off', reviewer: 'human', sensitiveTools: '', timeoutSeconds: 0 };
      const next = { ...cfg, sensitiveTools: '' };
      deps.saveConversationConfigLocally?.(cid, next);
      await saveConversationConfig(cid, next);
    }
    return result;
  }
  async function toolCatalog(): Promise<string[]> {
    const names = new Set<string>();
    let pages = 1;
    for (let page = 1; page <= pages; page++) {
      const data = await request(`/api/config/tools?page=${page}&page_size=100`);
      if (disposed) return [];
      pages = typeof data.total_pages === 'number' ? Math.max(1, data.total_pages) : 1;
      for (const raw of Array.isArray(data.tools) ? data.tools : []) {
        const tool = object(raw);
        if (typeof tool.name !== 'string' || !tool.name.trim()) continue;
        names.add(tool.is_external && tool.external_mcp ? `${String(tool.external_mcp)}::${tool.name}` : tool.name);
      }
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }
  async function pending(page: number, pageSize: number, q = '') {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (q.trim()) params.set('q', q.trim());
    const data = await request('/api/hitl/pending?' + params);
    const raw = Array.isArray(data.items) ? data.items.map(decodeItem) : [];
    const items = raw.filter(item => normalizeReviewer(item.reviewer || item.decidedBy || item.decided_by) !== 'audit_agent' && (item.status || '').trim().toLowerCase() !== 'audit_running');
    let runs: WorkflowRun[] = [];
    try { const wf = await request('/api/workflows/runs/pending'); runs = Array.isArray(wf.runs) ? wf.runs.map(decodeWorkflow) : []; }
    catch (error) { console.warn('HITL workflow pending', error); }
    const search = q.trim().toLowerCase();
    if (search) runs = runs.filter(run => [run.conversation_id || run.conversationId, run.workflow_id || run.workflowId, run.id, workflowLabel(run)].some(v => String(v ?? '').toLowerCase().includes(search)));
    return { items, runs, total: Math.max(0, (typeof data.total === 'number' ? data.total : raw.length) - (raw.length - items.length)) + runs.length };
  }
  async function logs(page: number, pageSize: number, filters: HitlFilters = {}) {
    const params = filterParams(filters); params.set('page', String(page)); params.set('pageSize', String(pageSize));
    const data = await request('/api/hitl/logs?' + params);
    const items = Array.isArray(data.items) ? data.items.map(decodeItem) : [];
    return { items, total: typeof data.total === 'number' ? data.total : items.length, retentionDays: typeof data.retentionDays === 'number' ? data.retentionDays : 0 };
  }
  function filterParams(filters: HitlFilters): URLSearchParams {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value?.trim() && value !== 'all') params.set(key, value.trim());
    return params;
  }
  async function deleteLogs(ids: string[] | 'all', filters: HitlFilters = {}, fallbackCount = state.logs.total): Promise<number> {
    const params = ids === 'all' ? filterParams(filters).toString() : '';
    const result = await request('/api/hitl/logs' + (params ? '?' + params : ''), 'DELETE', ids === 'all' ? { all: true } : { ids });
    return typeof result.deleted === 'number' ? result.deleted : ids === 'all' ? fallbackCount : ids.length;
  }
  async function dismiss(id: string, silent = false): Promise<void> {
    try { await request('/api/hitl/dismiss', 'POST', { interruptId: id }); }
    catch (error) { if (!silent) console.warn('dismissHitlItem', error); }
    changed();
  }
  async function followRun(id: string): Promise<void> {
    if (!id || disposed) return;
    const sequence = ++followSequence;
    try { if (await deps.attachRunningTaskEventStream?.(id)) return; }
    catch (error) { console.warn('HITL stream attach', error); }
    if (sequence !== followSequence || disposed) return;
    const deadline = deps.now() + 30 * 60_000;
    await deps.sleep(500);
    while (!disposed && sequence === followSequence) {
      let active = false;
      try {
        const data = await request('/api/agent-loop/tasks');
        active = Array.isArray(data.tasks) && data.tasks.some(t => { const task = object(t); return task.conversationId === id && (task.status === 'running' || task.status === 'cancelling'); });
      } catch { /* legacy treats unavailable tasks as terminal */ }
      if (disposed || sequence !== followSequence) return;
      try {
        if (deps.getCurrentConversationId() === id) await deps.refreshLastAssistantProcessDetails?.(id);
        if (!active || deps.now() > deadline) {
          if (!active) await deps.sleep(450);
          if (disposed || sequence !== followSequence) return;
          if (deps.getCurrentConversationId() === id) await deps.loadConversation?.(id);
          await deps.loadActiveTasks?.(); return;
        }
      } catch (error) { console.warn('HITL run follow', error); }
      await deps.sleep(2000);
    }
  }
  async function decide(id: string, decision: HitlDecision, comment = '', editedArguments: JsonObject | null = null, conversationId = ''): Promise<boolean> {
    if (editedArguments !== null && (typeof editedArguments !== 'object' || Array.isArray(editedArguments))) throw new Error('Invalid JSON arguments');
    try { await request('/api/hitl/decision', 'POST', { interruptId: id, decision, comment, editedArguments }); }
    catch (error) {
      if (error instanceof HitlApiError && error.status === 409 && /already resolved|not found/.test(error.message)) { await dismiss(id, true); return true; }
      throw error;
    }
    changed();
    const cid = conversationId || deps.getCurrentConversationId();
    if (cid) void followRun(cid).catch(error => console.warn('HITL run follow', error));
    return true;
  }
  async function decideWorkflow(id: string, approved: boolean, comment = '', conversationId = ''): Promise<void> {
    if (!id.trim()) return;
    if (deps.submitWorkflowDecision) await deps.submitWorkflowDecision(id, approved, comment);
    else await resumeWorkflow(id, approved, comment);
    if (conversationId) void followRun(conversationId).catch(error => console.warn('HITL workflow follow', error));
    changed();
  }
  async function resumeWorkflow(id: string, approved: boolean, comment: string): Promise<void> {
    await request('/api/workflows/runs/' + encodeURIComponent(id) + '/resume', 'POST', { approved, comment });
  }
  function getState(): HitlState {
    return { ...state, strategy: { ...state.strategy },
      pending: { ...state.pending, items: state.pending.items.map(item => ({ ...item })), runs: state.pending.runs.map(run => ({ ...run })) },
      logs: { ...state.logs, items: state.logs.items.map(item => ({ ...item })), filters: { ...state.logs.filters } },
      selectedLogs: new Set(selectedLogs) };
  }
  async function loadPending(): Promise<boolean> {
    const generation = ++generations.pending;
    try {
      const page = state.pending;
      const result = await pending(page.page, page.pageSize, page.q);
      if (disposed || generation !== generations.pending) return false;
      const max = Math.max(1, Math.ceil(result.total / page.pageSize));
      if (page.page > max) { page.page = max; return loadPending(); }
      Object.assign(page, result, { loaded: true }); return true;
    } catch (error) { if (generation === generations.pending) state.pending.loaded = false; throw error; }
  }
  async function loadLogs(): Promise<boolean> {
    const generation = ++generations.logs;
    try {
      const page = state.logs;
      const result = await logs(page.page, page.pageSize, page.filters);
      if (disposed || generation !== generations.logs) return false;
      const max = Math.max(1, Math.ceil(result.total / page.pageSize));
      if (page.page > max) { page.page = max; return loadLogs(); }
      Object.assign(page, result, { loaded: true }); return true;
    } catch (error) { if (generation === generations.logs) state.logs.loaded = false; throw error; }
  }
  function setPage(list: HitlList, page: number): boolean {
    const value = state[list];
    if (!Number.isInteger(page) || page < 1 || page > Math.max(1, Math.ceil(value.total / value.pageSize))) return false;
    value.page = page; return true;
  }
  function setPageSize(list: HitlList, size: number): boolean {
    if (!HITL_PAGE_SIZES.some(n => n === size)) return false;
    state[list].pageSize = size; state[list].page = 1;
    deps.storage.set(pageSizeKey(list), String(size)); return true;
  }
  function selectLog(id: string, checked: boolean): void { if (id) { if (checked) selectedLogs.add(id); else selectedLogs.delete(id); } }
  async function deleteSelectedLogs(): Promise<number> {
    const ids = [...selectedLogs];
    if (!ids.length) return 0;
    const count = await deleteLogs(ids);
    ids.forEach(id => selectedLogs.delete(id)); return count;
  }
  async function clearLogs(): Promise<number> {
    const count = await deleteLogs('all', state.logs.filters);
    selectedLogs.clear(); state.logs.page = 1; return count;
  }
  async function loadStrategy(): Promise<boolean> {
    const generation = ++generations.strategy;
    const value = decodeStrategy(await request('/api/hitl/audit-strategy'));
    if (disposed || generation !== generations.strategy) return false;
    state.strategy = { ...value }; return true;
  }
  async function saveStrategy(auditAgentPrompt: string, auditAgentPromptReviewEdit: string): Promise<HitlStrategy> {
    const value = decodeStrategy(await request('/api/hitl/audit-strategy', 'PUT', { auditAgentPrompt, auditAgentPromptReviewEdit }));
    state.strategy = { ...state.strategy, ...value }; return value;
  }
  function getAuditEngine() {
    const external = deps.getExternalState?.();
    const backend = normalizeBackend(defaults.auditBackend || external?.auditBackend) || 'openai';
    const model = String(defaults.auditModel || external?.auditModel || '').trim();
    return { backend, model: model || (backend === 'typesafe' ? 'jev-latest' : '') };
  }
  return {
    applyDefaults, fetchDefaultConfig, putDefaultConfig, fetchConversationConfig, saveConversationConfig,
    syncConfigFromServer, syncCurrentConfig, reconcileUI, fetchWhitelist, resolveWhitelist, putWhitelist, mergeWhitelist, savePageWhitelist, toolCatalog,
    pending, logs, deleteLogs, dismiss, followRun, decide, decideWorkflow, resumeWorkflow,
    getDefaults: () => ({ ...defaults }), getWhitelist: () => [...(deps.getExternalState?.().whitelist ?? whitelist ?? [])], getAuditEngine,
    getState, loadPending, loadLogs, setPage, setPageSize, selectLog, deleteSelectedLogs, clearLogs, loadStrategy,
    setTab(tab: string): void { state.tab = tab === 'logs' ? 'logs' : ['policy', 'strategy', 'whitelist'].includes(tab) ? 'policy' : 'pending'; },
    setStrategyMode(mode: string): void { state.strategyMode = mode === 'review_edit' ? 'review_edit' : 'approval'; },
    filterPending(q: string): void { state.pending.q = q.trim(); state.pending.page = 1; },
    filterLogs(filters: HitlFilters): void { state.logs.filters = { ...filters }; state.logs.page = 1; },
    selectPage(checked: boolean): void { state.logs.items.forEach(item => selectLog(item.id, checked)); },
    deselectLogs(): void { selectedLogs.clear(); },
    getLog: async (id: string): Promise<HitlItem> => decodeItem(await request('/api/hitl/logs/' + encodeURIComponent(id))),
    getStrategy: async (): Promise<HitlStrategy> => decodeStrategy(await request('/api/hitl/audit-strategy')),
    saveStrategy,
    subscribe(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; },
    dispose(): void { disposed = true; followSequence++; listeners.clear(); },
  };
}
export type HitlService = ReturnType<typeof createHitlService>;
