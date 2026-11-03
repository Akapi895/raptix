import { createSettingsClient } from './client';
import type { ApiFetch, Translate } from './contracts';
import { errorMessage } from './contracts';
import { canonicalToolKey, ensureAIConfigShape, getPath, getToolKey, normalizeAIChannelId, normalizeAIChannelProviderProfile, object, parseMCPConfig, resolveSavedAIChannelId, strings, text, validateSelectedAIChannelPayload, type AIChannel, type AIConfig, type ConfigObject, type MCPData, type Probe, type RobotAuth, type SettingsConfig, type Tool, type ToolPage } from './model';

export interface SettingsServiceDependencies {
  request: ApiFetch; storage: { get(key: string): string | null; set(key: string, value: string): void };
  can(permission: string): boolean; t: Translate;
}
export function createSettingsService(deps: SettingsServiceDependencies) {
  const client = createSettingsClient(deps.request);
  const getToolsPageSize = () => { const savedSize = Number(deps.storage.get('toolsPageSize')); return savedSize > 0 && Number.isSafeInteger(savedSize) ? savedSize : 20; };
  const state = {
    config: null as SettingsConfig | null, selectedChannel: '', selectedChannels: new Set<string>(), probes: new Map<string, Probe>(),
    tools: [] as Tool[], toolStates: new Map<string, Tool>(), toolBaselines: new Map<string, boolean>(),
    alwaysVisible: new Set<string>(), builtinVisible: new Set<string>(),
    pagination: { page: 1, page_size: getToolsPageSize(), total: 0, total_enabled: 0, total_pages: 1 } as Omit<ToolPage, 'tools'>,
    search: '', status: '', externalFilter: '', activeRobot: '', robotDrafts: new Map<string, RobotAuth>(),
    editingMCP: null as string | null, mcps: { servers: {}, stats: {} } as MCPData,
  };
  let disposed = false, toolsSequence = 0, configSequence = 0, c2Synced = false;
  let toolsController: AbortController | undefined;
  let configController: AbortController | undefined;
  const delays = new Map<ReturnType<typeof setTimeout>, () => void>();
  function assertLive() { if (disposed) throw new DOMException('Settings disposed', 'AbortError'); }
  function permission(name: string) { assertLive(); if (!deps.can(name)) throw new Error(deps.t('common.noPermission')); }
  function config(): SettingsConfig { if (!state.config) state.config = { ai: ensureAIConfigShape({}) }; return state.config; }
  function acceptConfig(raw: ConfigObject, preferredId?: string, payload?: AIChannel) {
    state.config = { ...raw, ai: ensureAIConfigShape(raw) };
    state.selectedChannel = preferredId ? resolveSavedAIChannelId(state.config.ai, preferredId, payload) : state.config.ai.default_channel;
    state.alwaysVisible = new Set(strings(getPath(raw, 'multi_agent.tool_search_always_visible_tools')).map(canonicalToolKey));
    state.builtinVisible = new Set(strings(getPath(raw, 'multi_agent.tool_search_always_visible_effective_tools')).map(canonicalToolKey).filter(name => !state.alwaysVisible.has(name)));
    for (const id of state.selectedChannels) if (!state.config.ai.channels[id]) state.selectedChannels.delete(id);
  }
  async function loadConfig() {
    assertLive(); const seq = ++configSequence; configController?.abort(); const controller = new AbortController(); configController = controller;
    try {
      const raw = await client.config(controller.signal); if (disposed || seq !== configSequence) return false;
      acceptConfig(raw); state.robotDrafts.clear(); return true;
    } catch (error) { if (disposed || seq !== configSequence) return false; throw error; }
    finally { if (configController === controller) configController = undefined; }
  }
  function editChannel(id: string, channel: AIChannel) {
    const cfg = config(); const previous = cfg.ai.channels[id]; const next = normalizeAIChannelProviderProfile(channel);
    if (['provider', 'base_url', 'api_key', 'model'].some(key => text(previous?.[key]) !== text(next[key]))) state.probes.delete(id);
    cfg.ai.channels[id] = next; return next;
  }
  function uniqueChannelId(base: string) { const channels = config().ai.channels; const root = normalizeAIChannelId(base); let id = root, i = 2; while (channels[id]) id = `${root}-${i++}`; return id; }
  function newChannel(name: string, source?: AIChannel) {
    const id = uniqueChannelId(source ? `${source.name || state.selectedChannel || 'channel'}-copy` : name);
    editChannel(id, source ? { ...structuredClone(source), name: `${source.name || id} Copy` } : { name, provider: 'openai_compatible', api_key: '', base_url: '', model: '', max_total_tokens: 120000, max_completion_tokens: 32768, reasoning: { mode: 'auto', effort: '', profile: 'auto', allow_client_reasoning: true } });
    state.selectedChannel = id; return id;
  }
  async function persistAI(mergeLatest: boolean, validate: boolean) {
    permission('config:write'); const cfg = config(), selected = state.selectedChannel || cfg.ai.default_channel;
    const payload = cfg.ai.channels[selected] || {};
    const missing = validate ? validateSelectedAIChannelPayload(payload) : ''; if (missing) throw new Error(`Please fill in: ${missing}`);
    let ai: AIConfig = structuredClone(cfg.ai);
    if (mergeLatest) {
      const latest = await client.config(); assertLive();
      ai = { ...ai, channels: { ...ensureAIConfigShape(latest).channels, ...ai.channels } };
    }
    for (const [id, value] of Object.entries(ai.channels)) ai.channels[id] = normalizeAIChannelProviderProfile(value);
    await client.write({ ai }); assertLive(); await client.apply(); assertLive();
    const fresh = await client.config(); assertLive(); acceptConfig(fresh, selected, payload); return state.config!;
  }
  function removeChannels(ids: string[], bulk: boolean) {
    permission('config:write'); const ai = config().ai;
    const remove = [...new Set(ids)].filter(id => ai.channels[id] && (!bulk || id !== ai.default_channel));
    if (!remove.length) throw new Error(bulk ? 'The default channel cannot be bulk-deleted. Switch the default channel first.' : 'Select a channel first');
    if (Object.keys(ai.channels).length - remove.length < 1) throw new Error('At least one AI channel must remain');
    for (const id of remove) { delete ai.channels[id]; state.probes.delete(id); state.selectedChannels.delete(id); }
    if (!ai.channels[ai.default_channel]) ai.default_channel = Object.keys(ai.channels).sort()[0]!;
    if (!ai.channels[state.selectedChannel]) state.selectedChannel = ai.default_channel;
    return remove.length;
  }
  async function probeChannels(ids: string[], changed: () => void) {
    permission('config:write'); let next = 0, ok = 0;
    for (const id of ids) state.probes.set(id, { status: 'testing', message: deps.t('settingsBasic.testing') }); changed();
    await Promise.all(Array.from({ length: Math.min(2, ids.length) }, async () => {
      while (next < ids.length && !disposed) {
        const id = ids[next++]!; const channel = config().ai.channels[id]; if (!channel) continue;
        const fingerprint = JSON.stringify(channel);
        let probe: Probe;
        try {
          const result = await client.test('openai', { provider: channel.provider || 'openai_compatible', channel_id: id, base_url: channel.base_url || '', api_key: channel.api_key || '', model: channel.model || '' });
          if (result.success) { ok++; probe = { status: 'ready', message: deps.t('settingsBasic.aiChannelReadyWithLatency').replace('{latency}', result.latency_ms ? ` ${result.latency_ms}ms` : '') }; }
          else probe = { status: 'failed', message: result.error || deps.t('settingsBasic.testFailed') };
        } catch (error) { probe = { status: 'failed', message: errorMessage(error) }; }
        if (!disposed && JSON.stringify(config().ai.channels[id]) === fingerprint) { state.probes.set(id, probe); changed(); }
      }
    })); return ok;
  }
  async function loadTools(page = 1, search = state.search, refreshExternal = false) {
    assertLive(); state.search = search; const seq = ++toolsSequence; toolsController?.abort(); const controller = new AbortController(); toolsController = controller;
    state.pagination.page_size = getToolsPageSize();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const result = await client.tools(page, state.pagination.page_size, { search, enabled: state.status, external_mcp: state.externalFilter, refresh_external: refreshExternal }, controller.signal);
      if (disposed || seq !== toolsSequence) return false;
      state.tools = result.tools; state.pagination = { page: result.page, page_size: result.page_size, total: result.total, total_enabled: result.total_enabled, total_pages: result.total_pages };
      for (const tool of result.tools) { const key = getToolKey(tool); state.toolBaselines.set(key, tool.enabled); if (!state.toolStates.has(key)) state.toolStates.set(key, { ...tool }); }
      return true;
    } catch (error) { if (disposed || seq !== toolsSequence) return false; throw error; }
    finally { clearTimeout(timeout); if (toolsController === controller) toolsController = undefined; }
  }
  function setTool(key: string, enabled: boolean, fallback?: Tool) { const tool = state.toolStates.get(key) || fallback; if (tool) state.toolStates.set(key, { ...tool, enabled }); }
  function isBuiltin(tool: Tool) { return state.builtinVisible.has(tool.name) || state.builtinVisible.has(canonicalToolKey(getToolKey(tool))); }
  function isAlwaysVisible(tool: Tool) { return state.alwaysVisible.has(tool.name) || state.alwaysVisible.has(canonicalToolKey(getToolKey(tool))) || isBuiltin(tool); }
  function alwaysVisibleForSave() { return [...state.alwaysVisible].filter(name => !state.builtinVisible.has(name)); }
  async function collectTools() {
    const all = new Map<string, Tool>();
    try {
      for (let page = 1; ; page++) {
        assertLive(); const result = await client.tools(page, 100);
        for (const tool of result.tools) { const key = getToolKey(tool); all.set(key, state.toolStates.get(key) || tool); }
        if (page >= result.total_pages) break;
      }
    } catch (error) { assertLive(); if (!state.toolStates.size) throw error; }
    // Edits survive page/filter changes and temporary failures while enumerating all pages.
    for (const [key, value] of state.toolStates) all.set(key, value);
    return [...all.values()].map(({ name, enabled, is_external, external_mcp }) => ({ name, enabled, is_external: !!is_external, external_mcp: external_mcp || '' }));
  }
  async function applySettings(patch: ConfigObject) {
    permission('config:write'); const tools = await collectTools(); assertLive();
    await client.write({ ...patch, tools }); assertLive(); await client.apply(); assertLive();
    const raw = await client.config(); assertLive(); acceptConfig(raw, state.selectedChannel); return state.config!;
  }
  async function saveTools() {
    permission('config:write'); const latest = await client.config(); assertLive(); const tools = await collectTools();
    await client.write({ ai: ensureAIConfigShape(latest), agent: object(latest.agent), multi_agent: { ...object(latest.multi_agent), tool_search_always_visible_tools: alwaysVisibleForSave() }, tools });
    assertLive(); await client.apply(); assertLive(); state.toolStates.clear(); state.toolBaselines.clear();
  }
  async function loadMCPs() { const data = await client.mcps(); if (!disposed) state.mcps = data; return data; }
  async function saveMCP(json: string) {
    permission('mcp:write'); const configs = parseMCPConfig(json, deps.t); const editing = state.editingMCP;
    if (editing && !Object.hasOwn(configs, editing)) throw new Error(deps.t('mcp.configEditMustContainName', { name: editing }));
    for (const name of editing ? [editing] : Object.keys(configs)) { assertLive(); await client.saveMCP(name, configs[name]!); }
  }
  function delay(ms: number): Promise<void> {
    return new Promise(resolve => { if (disposed) return resolve(); const timer = setTimeout(() => { delays.delete(timer); resolve(); }, ms); delays.set(timer, resolve); });
  }
  async function pollMCP(name: string | null, attempts: number, changed: () => void, waitForTools: boolean) {
    for (let i = 0; i < attempts && !disposed; i++) {
      await delay(1000); if (disposed) return;
      try {
        if (waitForTools) { await loadMCPs(); if (!disposed) changed(); if (name && (state.mcps.servers[name]?.tool_count || 0) > 0) return; }
        else if (name) { const server = await client.mcp(name); if (disposed) return; if (server.status !== 'connecting') { await loadMCPs(); if (!disposed) changed(); return; } }
      } catch { /* transient connection/list failures are retried within this bounded poll */ }
    }
  }
  return {
    state, client, get disposed() { return disposed; }, getToolsPageSize, loadConfig, config, acceptConfig, editChannel, newChannel, persistAI, removeChannels, probeChannels,
    loadTools, setTool, isBuiltin, isAlwaysVisible, alwaysVisibleForSave, collectTools, applySettings, saveTools, loadMCPs, saveMCP, pollMCP,
    setAlwaysVisible(key: string, enabled: boolean) { const name = canonicalToolKey(key); if (state.builtinVisible.has(name)) return; if (enabled) state.alwaysVisible.add(name); else state.alwaysVisible.delete(name); },
    setPageSize(size: number) { if (!Number.isSafeInteger(size) || size < 1) return false; state.pagination.page_size = size; deps.storage.set('toolsPageSize', String(size)); return true; },
    resetTools() { state.toolStates.clear(); state.toolBaselines.clear(); },
    async syncC2Once() { if (c2Synced || disposed) return null; c2Synced = true; try { return await client.config(); } catch { c2Synced = false; return null; } },
    async deleteMCP(name: string) { permission('mcp:write'); await client.deleteMCP(name); if (state.externalFilter === name) state.externalFilter = ''; },
    async toggleMCP(name: string, status: string) { permission('mcp:write'); await client.toggleMCP(name, status === 'connected' ? 'stop' : 'start'); },
    async changePassword(oldPassword: string, newPassword: string) { permission('auth:self'); await client.changePassword(oldPassword, newPassword); },
    totalEnabled() { let delta = 0; for (const [key, tool] of state.toolStates) { const baseline = state.toolBaselines.get(key); if (baseline !== undefined && baseline !== tool.enabled) delta += tool.enabled ? 1 : -1; } return Math.max(0, state.pagination.total_enabled + delta); },
    dispose() { if (disposed) return; disposed = true; ++toolsSequence; ++configSequence; toolsController?.abort(); configController?.abort(); for (const [timer, resolve] of delays) { clearTimeout(timer); resolve(); } delays.clear(); },
  };
}
export type SettingsService = ReturnType<typeof createSettingsService>;
