import { describe, expect, it, vi } from 'vitest';
import { createHitlService, HitlApiError } from './index';
import type { HitlConfig, HitlDependencies, JsonObject } from './types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const config: HitlConfig = { mode: 'approval', reviewer: 'human', sensitiveTools: '', timeoutSeconds: 300 };
function setup(overrides: Partial<HitlDependencies> = {}) {
  const data = new Map<string, string>();
  const request = vi.fn<HitlDependencies['request']>(async () => response({}));
  const deps: HitlDependencies = {
    request, storage: { get: key => data.get(key) ?? null, set: (key, value) => { data.set(key, value); return true; }, remove: key => data.delete(key) },
    translate: key => key, getLocale: () => 'en-US', getCurrentConversationId: () => 'conv-1',
    alert: vi.fn(), confirm: () => true, now: () => 0, sleep: async () => {},
    saveConversationConfigLocally: vi.fn(), applyConfigToUI: vi.fn(), updateStatusUI: vi.fn(),
    ...overrides,
  };
  return { service: createHitlService(deps), deps, request, data };
}
function sent(request: ReturnType<typeof setup>['request'], index = 0): unknown {
  return JSON.parse(String(request.mock.calls[index]?.[1]?.body));
}

describe('HITL public configuration service', () => {
  it('normalizes Go defaults and preserves explicit unlimited timeout when updating a single field', async () => {
    const h = setup();
    h.request.mockResolvedValueOnce(response({ defaultMode: 'review-edit', defaultReviewer: 'AI', defaultTimeoutSeconds: 0, audit_backend: 'jev', audit_model: '', hitlGlobalToolWhitelist: ['read'] }))
      .mockResolvedValueOnce(response({ defaultMode: 'review_edit', defaultReviewer: 'human', defaultTimeoutSeconds: 0 }));
    expect(await h.service.fetchDefaultConfig()).toEqual({ mode: 'review_edit', reviewer: 'audit_agent', timeoutSeconds: 0, auditBackend: 'typesafe' });
    expect(h.service.getAuditEngine()).toEqual({ backend: 'typesafe', model: 'jev-latest' });
    await h.service.putDefaultConfig({ reviewer: 'human' });
    expect(sent(h.request, 1)).toEqual({ mode: 'review_edit', reviewer: 'human', timeoutSeconds: 0 });
    expect(h.service.getWhitelist()).toEqual(['read']);
  });
  it('uses safe defaults for HTTP default failures, but propagates transport errors', async () => {
    const h = setup(); h.request.mockResolvedValueOnce(response({ error: 'forbidden' }, 403));
    expect(await h.service.fetchDefaultConfig()).toEqual({ mode: 'off', reviewer: 'human', timeoutSeconds: 300 });
    h.request.mockRejectedValueOnce(new Error('offline'));
    await expect(h.service.fetchDefaultConfig()).rejects.toThrow('offline');
  });
  it('serializes saves per normalized conversation, captures drafts, recovers after failure and allows other conversations to proceed', async () => {
    const h = setup(); const gate = deferred<Response>();
    h.request.mockImplementationOnce(() => gate.promise);
    const draft = { ...config, sensitiveTools: ['read'], timeoutSeconds: 17.9 };
    const first = h.service.saveConversationConfig(' conv-1 ', draft);
    const failure = expect(first).rejects.toThrow('conflict');
    draft.sensitiveTools.push('later');
    const second = h.service.saveConversationConfig('conv-1', { ...config, mode: 'review-edit', reviewer: 'ai', timeoutSeconds: -4 });
    const other = h.service.saveConversationConfig('conv-2', config);
    await other;
    expect(h.request).toHaveBeenCalledTimes(2);
    expect(sent(h.request)).toEqual({ conversationId: 'conv-1', enabled: true, mode: 'approval', reviewer: 'human', sensitiveTools: ['read'], timeoutSeconds: 17 });
    gate.resolve(response({ error: 'conflict' }, 409)); await failure; await second;
    expect(sent(h.request, 2)).toEqual({ conversationId: 'conv-1', enabled: true, mode: 'review_edit', reviewer: 'audit_agent', sensitiveTools: [], timeoutSeconds: 0 });
    expect(await h.service.saveConversationConfig(' ', config)).toBe(false);
  });
  it('restores enabled local config, strips global tools, migrates timeout once and applies only to the selected conversation', async () => {
    const h = setup({ readConfigFromForm: () => config });
    h.data.set('raptix-chat-hitl:conv-1', JSON.stringify({ mode: 'feedback', reviewer: 'agent', sensitiveTools: 'READ, write', timeoutSeconds: 0 }));
    h.request.mockResolvedValueOnce(response({ hitl: { mode: 'off', enabled: false, timeoutSeconds: 0 }, defaultTimeoutSeconds: 600, hitlGlobalToolWhitelist: ['read'] }));
    await h.service.syncConfigFromServer('conv-1');
    expect(h.request.mock.calls[0]?.[0]).toBe('/api/hitl/config/conv-1');
    expect(sent(h.request, 1)).toMatchObject({ mode: 'approval', reviewer: 'audit_agent', enabled: true, sensitiveTools: ['write'], timeoutSeconds: 0 });
    expect(sent(h.request, 2)).toMatchObject({ timeoutSeconds: 300, sensitiveTools: ['write'] });
    expect(h.data.get('raptix-hitl-timeout-default-v1:conv-1')).toBe('1');
    expect(h.deps.applyConfigToUI).toHaveBeenCalledWith({ mode: 'approval', enabled: true, reviewer: 'audit_agent', sensitiveTools: 'write', timeoutSeconds: 300 });
    h.request.mockResolvedValueOnce(response({ hitl: { ...config, timeoutSeconds: 0 }, hitlGlobalToolWhitelist: [] }));
    await h.service.syncConfigFromServer('conv-1');
    expect(h.request).toHaveBeenCalledTimes(4); // marker preserves a later explicit unlimited setting
    expect(h.deps.updateStatusUI).toHaveBeenCalledWith(config);
  });
  it('does not mark a failed timeout migration and retries on the next load', async () => {
    const h = setup(); const pack = { hitl: { ...config, timeoutSeconds: 0 } };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.request.mockResolvedValueOnce(response(pack)).mockResolvedValueOnce(response({ error: 'unavailable' }, 503));
    await h.service.syncConfigFromServer('conv-1');
    expect(h.data.has('raptix-hitl-timeout-default-v1:conv-1')).toBe(false);
    h.request.mockResolvedValueOnce(response(pack)); await h.service.syncConfigFromServer('conv-1');
    expect(h.data.get('raptix-hitl-timeout-default-v1:conv-1')).toBe('1');
  });
  it('does not apply a late conversation response to the newly selected chat or after disposal', async () => {
    let current = 'conv-1'; const h = setup({ getCurrentConversationId: () => current }); const gate = deferred<Response>();
    h.request.mockReturnValueOnce(gate.promise); const sync = h.service.syncConfigFromServer('conv/old'); current = 'conv-2';
    gate.resolve(response({ hitl: config })); await sync;
    expect(h.request.mock.calls[0]?.[0]).toBe('/api/hitl/config/conv%2Fold');
    expect(h.deps.saveConversationConfigLocally).toHaveBeenCalledOnce(); expect(h.deps.applyConfigToUI).not.toHaveBeenCalled();
    const next = deferred<Response>(); h.request.mockReturnValueOnce(next.promise); const late = h.service.syncConfigFromServer('conv-2'); h.service.dispose(); next.resolve(response({ hitl: config })); await late;
    expect(h.deps.saveConversationConfigLocally).toHaveBeenCalledOnce();
  });
  it('resolves whitelist via cache then config.yaml fallback and propagates the original failure when neither works', async () => {
    const cached = setup({ getExternalState: () => ({ whitelist: ['cached'] }) });
    cached.request.mockResolvedValue(response({ error: 'missing' }, 404)); expect(await cached.service.resolveWhitelist()).toEqual(['cached']); expect(cached.request).toHaveBeenCalledOnce();
    const h = setup(); h.request.mockResolvedValueOnce(response({}, 404)).mockResolvedValueOnce(response({ hitl: { tool_whitelist: ['yaml'] } }));
    expect(await h.service.resolveWhitelist()).toEqual(['yaml']);
    const fail = setup(); fail.request.mockResolvedValueOnce(response({ error: 'primary' }, 500)).mockResolvedValueOnce(response({}));
    await expect(fail.service.resolveWhitelist()).rejects.toThrow('primary');
  });
  it('saves the global whitelist before clearing only the current conversation tools and retains its mode/reviewer/timeout', async () => {
    const h = setup({ getConversationConfig: () => ({ ...config, reviewer: 'audit_agent', sensitiveTools: 'session' }) });
    h.request.mockResolvedValueOnce(response({ toolWhitelist: ['read', 'write'] }));
    expect(await h.service.savePageWhitelist(['read', 'write'])).toEqual(['read', 'write']);
    expect(sent(h.request)).toEqual({ toolWhitelist: ['read', 'write'] });
    expect(sent(h.request, 1)).toMatchObject({ reviewer: 'audit_agent', sensitiveTools: [], timeoutSeconds: 300 });
    expect(h.deps.saveConversationConfigLocally).toHaveBeenCalledWith('conv-1', { ...config, reviewer: 'audit_agent', sensitiveTools: '' });
    await h.service.mergeWhitelist(['extra']); expect(sent(h.request, 2)).toEqual({ sensitiveTools: ['extra'] });
  });
});

describe('HITL public list, audit and strategy state', () => {
  it('excludes agent-reviewed/running rows, searches workflow aliases and preserves Go totals', async () => {
    const h = setup();
    h.request.mockResolvedValueOnce(response({ total: 24, items: [{ id: 'human' }, { id: 'ai', decided_by: 'AI' }, { id: 'busy', status: 'audit_running' }] }))
      .mockResolvedValueOnce(response({ runs: [{ id: 'wf-1', conversation_id: 'c', pending_hitl_json: '{"pendingHitl":{"label":"Release Gate"}}' }, { id: 'wf-2', pendingHitlJson: '{"label":"other"}' }] }));
    const result = await h.service.pending(2, 10, ' Release ');
    expect(result.items.map(item => item.id)).toEqual(['human']); expect(result.runs.map(run => run.id)).toEqual(['wf-1']); expect(result.total).toBe(23);
    expect(h.request.mock.calls[0]?.[0]).toBe('/api/hitl/pending?page=2&pageSize=10&q=Release');
  });
  it('keeps tool approvals available when the workflow endpoint fails', async () => {
    const h = setup(); vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.request.mockResolvedValueOnce(response({ items: [{ id: 'human' }] })).mockResolvedValueOnce(response({}, 503));
    expect(await h.service.pending(1, 20)).toMatchObject({ total: 1, runs: [], items: [{ id: 'human' }] });
  });
  it('persists allowed page sizes, clamps pages after deletion and ignores stale list responses', async () => {
    const h = setup(); expect(h.service.setPageSize('logs', 7)).toBe(false); expect(h.service.setPageSize('logs', 10)).toBe(true);
    expect(h.data.get('raptix_hitl_logs_page_size')).toBe('10');
    h.request.mockResolvedValueOnce(response({ total: 21, items: [{ id: 'first' }] })); await h.service.loadLogs();
    expect(h.service.setPage('logs', 3)).toBe(true);
    h.request.mockResolvedValueOnce(response({ total: 9, items: [] })).mockResolvedValueOnce(response({ total: 9, retentionDays: 30, items: [{ id: 'clamped' }] }));
    await h.service.loadLogs(); expect(h.service.getState().logs).toMatchObject({ page: 1, total: 9, retentionDays: 30, loaded: true });
    const old = deferred<Response>(); h.request.mockReturnValueOnce(old.promise); const first = h.service.loadLogs();
    h.request.mockResolvedValueOnce(response({ total: 1, items: [{ id: 'latest' }] })); await h.service.loadLogs();
    old.resolve(response({ total: 1, items: [{ id: 'stale' }] })); expect(await first).toBe(false);
    expect(h.service.getState().logs.items[0]?.id).toBe('latest');
  });
  it('retains cross-page selection and deletes exactly the selected IDs, including quote-containing IDs', async () => {
    const h = setup();
    h.request.mockResolvedValueOnce(response({ total: 30, items: [{ id: "row'\"<&" }, { id: 'row-2' }] })); await h.service.loadLogs(); h.service.selectPage(true);
    h.request.mockResolvedValueOnce(response({ total: 30, items: [{ id: 'row-3' }] })); h.service.setPage('logs', 2); await h.service.loadLogs(); h.service.selectPage(true); h.service.selectLog('row-2', false);
    expect([...h.service.getState().selectedLogs]).toEqual(["row'\"<&", 'row-3']);
    h.request.mockResolvedValueOnce(response({ deleted: 2 })); expect(await h.service.deleteSelectedLogs()).toBe(2);
    expect(sent(h.request, 2)).toEqual({ ids: ["row'\"<&", 'row-3'] }); expect(h.service.getState().selectedLogs.size).toBe(0);
  });
  it('retains selection on deletion errors and sends filtered clear without pagination', async () => {
    const h = setup(); h.service.selectLog('keep', true); h.request.mockResolvedValueOnce(response({ error: 'denied' }, 403));
    await expect(h.service.deleteSelectedLogs()).rejects.toBeInstanceOf(HitlApiError); expect(h.service.getState().selectedLogs.has('keep')).toBe(true);
    h.service.filterLogs({ q: ' endpoint ', decision: 'reject', decidedBy: 'all' });
    h.request.mockResolvedValueOnce(response({ deleted: 7 })); expect(await h.service.clearLogs()).toBe(7);
    expect(h.request.mock.calls[1]?.[0]).toBe('/api/hitl/logs?q=endpoint&decision=reject'); expect(sent(h.request, 1)).toEqual({ all: true });
    expect(h.service.getState().logs.page).toBe(1); expect(h.service.getState().selectedLogs.size).toBe(0);
  });
  it('round-trips both strategy prompts and default resets data, and loads details using encoded IDs', async () => {
    const h = setup(); h.request.mockResolvedValueOnce(response({ auditAgentPrompt: 'custom', auditAgentPromptReviewEdit: 'edit', defaultAuditAgentPrompt: 'base', defaultAuditAgentPromptReviewEdit: 'edit-base' }));
    await h.service.loadStrategy(); h.service.setStrategyMode('review_edit');
    h.request.mockResolvedValueOnce(response({ auditAgentPrompt: 'new', auditAgentPromptReviewEdit: '' })); await h.service.saveStrategy('new', '');
    expect(sent(h.request, 1)).toEqual({ auditAgentPrompt: 'new', auditAgentPromptReviewEdit: '' });
    expect(h.service.getState()).toMatchObject({ strategyMode: 'review_edit', strategy: { auditAgentPrompt: 'new', auditAgentPromptReviewEdit: '', defaultAuditAgentPrompt: 'base' } });
    h.request.mockResolvedValueOnce(response({ id: 'log/id', auditBackend: 'typesafe', comment: 'detail' })); expect(await h.service.getLog('log/id')).toMatchObject({ id: 'log/id', auditBackend: 'typesafe' });
    expect(h.request.mock.calls[2]?.[0]).toBe('/api/hitl/logs/log%2Fid');
  });
});

describe('HITL embedded decision and run recovery contract', () => {
  it.each(['approve', 'reject'] as const)('sends the %s decision with comment/edited arguments, refreshes subscribers and reattaches SSE', async decision => {
    const attach = vi.fn(async () => true); const h = setup({ attachRunningTaskEventStream: attach }); const changed = vi.fn(); h.service.subscribe(changed);
    expect(await h.service.decide('interrupt', decision, 'reason', { command: 'ls' }, 'conv-x')).toBe(true);
    expect(sent(h.request)).toEqual({ interruptId: 'interrupt', decision, comment: 'reason', editedArguments: { command: 'ls' } });
    expect(changed).toHaveBeenCalledOnce(); expect(attach).toHaveBeenCalledWith('conv-x');
  });
  it.each(['already resolved', 'interrupt not found'])('silently dismisses 409 %s and does not resume the run', async message => {
    const attach = vi.fn(async () => true); const h = setup({ attachRunningTaskEventStream: attach }); const changed = vi.fn(); h.service.subscribe(changed);
    h.request.mockResolvedValueOnce(response({ error: message }, 409)); expect(await h.service.decide('old', 'approve')).toBe(true);
    expect(h.request.mock.calls[1]?.[0]).toBe('/api/hitl/dismiss'); expect(sent(h.request, 1)).toEqual({ interruptId: 'old' });
    expect(changed).toHaveBeenCalledOnce(); expect(attach).not.toHaveBeenCalled();
  });
  it('rejects invalid edit objects before sending and preserves ordinary API errors', async () => {
    const h = setup(); await expect(h.service.decide('id', 'approve', '', [] as unknown as JsonObject)).rejects.toThrow('Invalid JSON arguments'); expect(h.request).not.toHaveBeenCalled();
    h.request.mockResolvedValueOnce(response({ error: 'busy' }, 409)); await expect(h.service.decide('id', 'reject')).rejects.toThrow('busy'); expect(h.request).toHaveBeenCalledOnce();
  });
  it('polls running/cancelling tasks, refreshes process details and reloads the final conversation', async () => {
    const waits: number[] = []; const load = vi.fn(); const details = vi.fn(async () => {}); const tasks = vi.fn();
    const h = setup({ sleep: async ms => { waits.push(ms); }, attachRunningTaskEventStream: async () => false, loadConversation: load, refreshLastAssistantProcessDetails: details, loadActiveTasks: tasks });
    h.request.mockResolvedValueOnce(response({ tasks: [{ conversationId: 'conv-1', status: 'cancelling' }] })).mockResolvedValueOnce(response({ tasks: [] }));
    await h.service.followRun('conv-1'); expect(waits).toEqual([500, 2000, 450]); expect(details).toHaveBeenCalledTimes(2); expect(load).toHaveBeenCalledWith('conv-1'); expect(tasks).toHaveBeenCalledOnce();
  });
  it('stops pending follow work on dispose and prevents old runs from reloading a new conversation', async () => {
    const gate = deferred<void>(); const load = vi.fn(); const h = setup({ sleep: () => gate.promise, loadConversation: load });
    const follow = h.service.followRun('conv-1'); await Promise.resolve(); h.service.dispose(); gate.resolve(); await follow;
    expect(h.request).not.toHaveBeenCalled(); expect(load).not.toHaveBeenCalled();
    const other = setup({ getCurrentConversationId: () => 'conv-2', loadConversation: load }); await other.service.followRun('conv-1'); expect(load).not.toHaveBeenCalled();
  });
  it('reaches the 30-minute recovery deadline and abandons a superseded follower', async () => {
    let clock = 0; const load = vi.fn(); const tasks = vi.fn();
    const h = setup({ now: () => clock, sleep: async ms => { clock += ms === 2000 ? 31 * 60_000 : ms; }, loadConversation: load, loadActiveTasks: tasks });
    h.request.mockResolvedValue(response({ tasks: [{ conversationId: 'conv-1', status: 'running' }] }));
    await h.service.followRun('conv-1'); expect(load).toHaveBeenCalledWith('conv-1'); expect(tasks).toHaveBeenCalledOnce();
    const attach = deferred<boolean>(); const newer = setup({ attachRunningTaskEventStream: vi.fn().mockReturnValueOnce(attach.promise).mockResolvedValue(true) });
    const old = newer.service.followRun('old'); await newer.service.followRun('new'); attach.resolve(false); await old;
    expect(newer.request).not.toHaveBeenCalled();
  });
  it('uses the workflow callback when present and Go resume endpoint otherwise', async () => {
    const submit = vi.fn(async () => {}); const h = setup({ submitWorkflowDecision: submit }); await h.service.decideWorkflow('run-1', false, 'stop');
    expect(submit).toHaveBeenCalledWith('run-1', false, 'stop'); expect(h.request).not.toHaveBeenCalled();
    const fallback = setup(); await fallback.service.decideWorkflow('run/id', true, 'go');
    expect(fallback.request.mock.calls[0]?.[0]).toBe('/api/workflows/runs/run%2Fid/resume'); expect(sent(fallback.request)).toEqual({ approved: true, comment: 'go' });
  });
});
