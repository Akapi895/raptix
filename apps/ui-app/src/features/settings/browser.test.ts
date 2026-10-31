import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, expect as browserExpect, type Browser, type Page } from '@playwright/test';
import { build } from 'vite';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { object, type ConfigObject, type MCPServer, type Tool } from './model';
import type { SettingsFeature } from './index';

interface Harness { feature: SettingsFeature; mount(): void; allowed: boolean; translated: boolean; c2Enabled: boolean; hubs: string[] }

// Builds only the feature in memory, with explicit test-owned dependency state.
let browser: Browser, bundle = '', html = '';
beforeAll(async () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const result = await build({ root, configFile: false, logLevel: 'silent', resolve: { alias: { '@': fileURLToPath(new URL('../../', import.meta.url)) } }, define: { 'import.meta.env.VITE_API_BASE': '""' }, build: { write: false, minify: false, lib: { entry: fileURLToPath(new URL('./index.ts', import.meta.url)), formats: ['es'] }, rollupOptions: { output: { codeSplitting: false } } } });
  const outputs = Array.isArray(result) ? result : 'output' in result ? [result] : [];
  bundle = outputs.flatMap(output => output.output).filter(chunk => chunk.type === 'chunk').map(chunk => chunk.code).join('\n');
  const shell = await readFile(new URL('../../../index.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../../styles/style.css', import.meta.url), 'utf8');
  html = shell.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, '').replace('</head>', `<style>${css}\n.page{display:none!important}.page.active{display:block!important}body{overflow:auto}.modal{z-index:10000}</style></head>`);
  browser = await chromium.launch({ headless: true });
}, 60000);
afterAll(async () => { await browser?.close(); });
interface WireCall { path: string; method: string; body: ConfigObject }
async function call(page: Page, name: keyof SettingsFeature['controller'], args: unknown[] = []): Promise<void> { await page.evaluate(async ({ name, args }) => { const h = (globalThis as typeof globalThis & { settingsHarness: Harness }).settingsHarness; const fn: unknown = h.feature.controller[name]; if (typeof fn !== 'function') throw new Error('Missing settings controller method: ' + name); await Reflect.apply(fn, h.feature.controller, args); }, { name, args }); }
async function show(page: Page, id: string) { await page.evaluate(id => { document.querySelectorAll('.page.active').forEach(node => node.classList.remove('active')); document.getElementById(`page-${id}`)?.classList.add('active'); }, id); }
async function section(page: Page, id: string) { await call(page, 'switchSettingsSection', [id]); }
const specialMCP = 'lab / <&" \\ name';
async function setup(options: { demoModels?: boolean; failApply?: boolean } = {}) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } }), calls: WireCall[] = [], errors: string[] = [], alerts: string[] = [];
  page.setDefaultTimeout(5000);
  page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => { alerts.push(dialog.message()); void dialog.accept(); });
  let config: ConfigObject = {
    ai: { default_channel: 'main', channels: { main: { name: 'Main', provider: 'openai_compatible', api_key: '********', base_url: 'https://llm.example/v1', model: 'large', max_total_tokens: 120000, max_completion_tokens: 32768, reasoning: { mode: 'auto', effort: 'medium', profile: 'openai_compat', allow_client_reasoning: true, opaque: 'kept' } }, extra: { name: 'Extra', provider: 'openai_compatible', api_key: '********', base_url: 'https://extra.example/v1', model: 'small' } } },
    agent: { max_iterations: 30, tool_timeout_minutes: 600 }, multi_agent: { enabled: true, robot_default_agent_mode: 'deep', batch_use_multi_agent: true, orchestration: 'supervisor', tool_search_always_visible_tools: [`${specialMCP}::lookup`], tool_search_always_visible_effective_tools: [`${specialMCP}::lookup`, 'builtin'], model_retry_max_retries: 3 },
    knowledge: { enabled: true, embedding: { provider: 'openai', model: 'embed' }, indexing: { chunk_overlap: 0 }, retrieval: { similarity_threshold: 0, rerank: { provider: '' } } },
    c2: { enabled: true, opaque: 'keep' }, vision: { enabled: false, model: '', detail: 'low' }, hitl: { audit_backend: 'openai', default_reviewer: 'human', audit_model: {}, opaque: 'keep' },
    robots: { session: { opaque: 'keep' }, wechat: { enabled: false, bot_token: '********', ilink_bot_id: 'bot-id', ilink_user_id: 'user-id', get_updates_buf: 'cursor' }, telegram: { enabled: false, update_offset: 42 }, wecom: { auth: { mode: 'service_account', service_user_id: 'existing', allowed_external_users: ['original'] } } },
  };
  let tools: Tool[] = Array.from({ length: 25 }, (_, index) => ({ name: index === 0 ? 'builtin' : index === 1 || index === 21 ? 'lookup' : `tool-${index}`, description: `Description <safe> ${index}`, enabled: index % 3 !== 0, is_external: index === 1 || index === 21, external_mcp: index === 1 ? specialMCP : index === 21 ? 'second' : '' }));
  let servers: Record<string, MCPServer> = { [specialMCP]: { status: 'connected', tool_count: 1, config: { type: 'sse', url: 'https://mcp.example/sse', description: '<safe> SSE MCP' } }, second: { status: 'disabled', tool_count: 1, config: { command: 'python3', args: ['${HOME}/tool.py'] } } };
  await page.route('https://step10.test/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    if (path === '/') { await route.fulfill({ contentType: 'text/html', body: html }); return; }
    if (path === '/step10.js') { await route.fulfill({ contentType: 'application/javascript', body: bundle }); return; }
    const body = request.postData() ? object(JSON.parse(request.postData()!)) : {}; calls.push({ path: path + url.search, method, body });
    let data: unknown = {}, status = 200;
    if (path === '/api/config') { if (method === 'PUT') { config = { ...config, ...body }; if (Array.isArray(body.tools)) tools = tools.map(tool => { const saved = body.tools as Tool[]; return { ...tool, enabled: saved.find(item => item.name === tool.name && !!item.is_external === !!tool.is_external && (item.external_mcp || '') === (tool.external_mcp || ''))?.enabled ?? tool.enabled }; }); } data = config; }
    else if (path === '/api/config/apply') { if (options.failApply) { status = 500; data = { error: 'apply rejected' }; } }
    else if (path === '/api/config/tools') {
      const query = url.searchParams, pageNumber = Number(query.get('page')) || 1, size = Number(query.get('page_size')) || 20;
      const search = query.get('search') || '', enabled = query.get('enabled'), external = query.get('external_mcp');
      const list = tools.filter(tool => (!search || tool.name.includes(search)) && (enabled === null || String(tool.enabled) === enabled) && (!external || tool.external_mcp === external));
      data = { tools: list.slice((pageNumber - 1) * size, pageNumber * size), page: pageNumber, page_size: size, total: list.length, total_enabled: list.filter(tool => tool.enabled).length, total_pages: Math.max(1, Math.ceil(list.length / size)) };
    } else if (path.endsWith('/schema')) data = { input_schema: { properties: { target: { type: 'string', description: '<safe> target' } }, required: ['target'] } };
    else if (path === '/api/config/list-models') data = { models: ['large', 'small', 'embed'], ...(options.demoModels ? {} : { success: true, supported: true, count: 3 }) };
    else if (path.startsWith('/api/config/test-')) data = { success: true, model: 'large', latency_ms: 42 };
    else if (path === '/api/auth/change-password') data = { success: true };
    else if (path === '/api/external-mcp') data = { servers, stats: { total: Object.keys(servers).length, enabled: 1, disabled: 1, connected: 1 } };
    else if (path.startsWith('/api/external-mcp/')) {
      const segments = path.split('/'), name = decodeURIComponent(segments[3] || ''), operation = segments[4];
      if (method === 'DELETE') delete servers[name];
      else if (method === 'PUT') { servers[name] = { ...servers[name], config: object(body.config), status: servers[name]?.status || 'disabled', tool_count: 1 }; }
      else if (method === 'POST' && servers[name]) servers[name]!.status = operation === 'start' ? 'connected' : 'disabled';
      else data = servers[name] || { config: {} };
    } else { status = 404; data = { error: 'Unhandled settings fixture: ' + path }; }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.goto('https://step10.test/');
  await page.addScriptTag({ type: 'module', content: `
    import { initSettings } from '/step10.js';
    const h = globalThis.settingsHarness = { hubs: [], allowed: true, translated: false, c2Enabled: true, mount() {
      const record = name => () => { h.hubs.push(name); };
      h.feature = initSettings({ doc: document, request: (path, init) => fetch(path, init),
        storage: { get: key => localStorage.getItem(key), set: (key, value) => localStorage.setItem(key, value) },
        t: key => (h.translated ? 'translated:' : '') + key, can: () => h.allowed, alert: message => alert(message), confirm: message => confirm(message),
        browser: { events: globalThis, viewport: () => ({ width: innerWidth, height: innerHeight }), settingsHash() {}, c2Enabled: enabled => { h.c2Enabled = enabled; } },
        navigate: page => { h.hubs.push(page); document.querySelectorAll('.page.active').forEach(node => node.classList.remove('active')); document.getElementById('page-' + page)?.classList.add('active'); },
        navigateSection: section => h.feature.controller.switchSettingsSection(section), notifyError: message => h.hubs.push(message),
        section: name => h.hubs.push(({ 'token-usage': 'refreshTokenUsage', robots: 'loadVulnerabilityAlertSubscription', terminal: 'initTerminal', audit: 'initAuditLogsSection', storage: 'initStorageSection', update: 'loadUpdateConsole' })[name]),
        stopTokenUsage: record('stopTokenUsageRequests'), stopUpdate: record('stopUpdatePolling'), syncDashboardAccessTabs: record('syncDashboardAccessTabs'),
        refreshChatConfig: async () => { h.hubs.push('refreshChatConfig'); }, populateChatChannels: record('populateChatAIChannelSelect'),
        refreshMentionTools: record('refreshMentionTools'), refreshWechatRobot: record('refreshWechatRobotBoundUI'), unauthorized: record('handleUnauthorized'), closeMCPDetail: record('closeMCPDetail') });
      h.feature.activate(); h.feature.activate();
    } };
    h.mount();
  ` });
  await page.waitForFunction(() => Reflect.has(globalThis, 'settingsHarness'));
  return { page, calls, errors, alerts, config: () => config, tools: () => tools, servers: () => servers, replaceServers: (value: Record<string, MCPServer>) => servers = value };
}

describe('isolated settings feature/browser', () => {
  it('binds static actions once, routes sections and cleans up selects across remounts', async () => {
    const f = await setup(); const { page } = f;
    try {
      await show(page, 'settings'); await call(page, 'loadConfig', [false]);
      const inline = await page.evaluate(() => [...document.querySelectorAll('#page-settings [onclick],#page-settings [onchange],#page-settings [oninput],#external-mcp-modal [onclick],#page-mcp-management [onclick]')].map(node => node.getAttribute('onclick') || node.getAttribute('onchange') || node.getAttribute('oninput')).filter(value => /(?:AIChannel|applySettings|fetchModelList|testOpenAI|testVision|RobotEditor|RobotType|Password|ExternalMCP|Tools|Search)/.test(value || '')));
      expect(inline).toEqual([]);
      await page.locator('.settings-nav-item[data-section="token-usage"]').click(); expect(await page.evaluate(() => (globalThis as typeof globalThis & { settingsHarness: Harness }).settingsHarness.hubs)).toContain('refreshTokenUsage');
      for (const name of ['token-usage', 'robots', 'terminal', 'audit', 'storage', 'update', 'basic']) await section(page, name);
      await browserExpect.poll(() => page.evaluate(() => (globalThis as typeof globalThis & { settingsHarness: Harness }).settingsHarness.hubs)).toEqual(expect.arrayContaining(['refreshTokenUsage', 'loadVulnerabilityAlertSubscription', 'initTerminal', 'initAuditLogsSection', 'initStorageSection', 'loadUpdateConsole', 'stopUpdatePolling']));
      await section(page, 'unknown'); await browserExpect(page.locator('#settings-section-basic')).toHaveClass(/active/);
      await page.evaluate(() => { document.body.insertAdjacentHTML('beforeend', '<div id="shared-picker" class="pagination-page-size"><label for="shared-size">Rows</label><select id="shared-size"><option>10</option><option>20</option></select></div>'); });
      await page.evaluate(() => { const fn = (globalThis as typeof globalThis & { settingsHarness: Harness }).settingsHarness.feature.selects.pagination; fn(document.getElementById('shared-picker')!); fn(document.getElementById('shared-picker')!); });
      await browserExpect(page.locator('#shared-picker .pagination-custom-select')).toHaveCount(1);
      await page.locator('#shared-picker button.settings-custom-select-trigger').press('End'); await browserExpect(page.locator('#shared-size')).toHaveValue('20');
      await page.locator('#shared-picker button.settings-custom-select-trigger').click(); await browserExpect(page.locator('body > .settings-custom-select-menu--floating')).toBeVisible();
      await page.evaluate(() => { const feature = (globalThis as typeof globalThis & { settingsHarness: Harness }).settingsHarness.feature; feature.dispose(); feature.dispose(); });
      await browserExpect(page.locator('#shared-picker .settings-custom-select')).toHaveCount(0); await browserExpect(page.locator('body > .settings-custom-select-menu--floating')).toHaveCount(0); expect(await page.locator('#shared-size').getAttribute('aria-hidden')).toBeNull();
      const count = f.calls.length; await page.locator('[data-settings-action="channel-new"]').click(); expect(f.calls).toHaveLength(count); expect(f.errors).toEqual([]);
      await page.evaluate(() => { const h = (globalThis as typeof globalThis & { settingsHarness: Harness }).settingsHarness; h.mount(); h.hubs.length = 0; });
      await page.locator('.settings-nav-item[data-section="token-usage"]').click();
      expect(await page.evaluate(() => (globalThis as typeof globalThis & { settingsHarness: Harness }).settingsHarness.hubs.filter(name => name === 'refreshTokenUsage'))).toHaveLength(1);
    } finally { await page.close(); }
  }, 30000);

  it('validates required fields, preserves backend routing configuration and applies other form families and robot auth drafts', async () => {
    const f = await setup(); const { page } = f;
    try {
      await show(page, 'settings'); await call(page, 'loadConfig', [false]); await page.locator('#openai-api-key').fill(''); await call(page, 'applySettings'); expect(f.calls.some(call => call.method === 'PUT')).toBe(false); await browserExpect(page.locator('#openai-api-key')).toHaveClass(/error/);
      await page.locator('#openai-api-key').fill('********'); await page.locator('#agent-max-iterations').fill('55'); await page.locator('#agent-tool-wait-timeout-seconds').fill('0'); await page.locator('#agent-external-mcp-concurrency-server').fill('-1');
      await browserExpect(page.locator('#multi-agent-enabled,#multi-agent-robot-mode')).toHaveCount(0);
      await section(page, 'knowledge'); await page.locator('#knowledge-indexing-chunk-overlap').fill('0'); await page.locator('#knowledge-indexing-max-retries').fill('0'); await page.locator('#knowledge-multi-query-max-queries').fill('99'); await page.locator('#knowledge-retrieval-similarity-threshold').fill('0'); await page.locator('#knowledge-indexing-sub-indexes').fill('one\uFF0Ctwo, one');
      await section(page, 'robots'); await call(page, 'openRobotEditor', ['wecom']); await page.locator('#robot-service-user-id').fill('admin'); await page.locator('#robot-allowed-external-users').fill('a\na\uFF0Cb'); await browserExpect(page.locator('#robot-service-admin-warning')).toBeVisible();
      await call(page, 'openRobotEditor', ['telegram']); await page.locator('#robot-telegram-bot-token').fill('telegram-token'); await page.locator('label').filter({ has: page.locator('#robot-telegram-enabled') }).click();
      await call(page, 'openRobotEditor', ['wecom']); await browserExpect(page.locator('#robot-service-user-id')).toHaveValue('admin');
      await call(page, 'applySettings'); const write = f.calls.find(call => call.method === 'PUT')?.body;
      expect(write).toMatchObject({ agent: { max_iterations: 55, tool_wait_timeout_seconds: 0, tool_timeout_minutes: 600, external_mcp_max_concurrent_per_server: -1 }, multi_agent: { enabled: true, robot_default_agent_mode: 'deep', batch_use_multi_agent: true, orchestration: 'supervisor' }, knowledge: { indexing: { chunk_overlap: 0, max_retries: 0, sub_indexes: ['one', 'two'] }, retrieval: { similarity_threshold: 0, multi_query: { max_queries: 8 } } }, robots: { session: { opaque: 'keep' }, wecom: { auth: { mode: 'service_account', service_user_id: 'admin', allowed_external_users: ['a', 'b'] } }, telegram: { enabled: true, bot_token: 'telegram-token', update_offset: 42 }, wechat: { bot_token: '********', ilink_user_id: 'user-id', get_updates_buf: 'cursor' } }, hitl: { opaque: 'keep' }, c2: { opaque: 'keep' } });
      expect(f.calls.some(call => call.path === '/api/config/apply')).toBe(true); expect(f.errors).toEqual([]);
    } finally { await page.close(); }
  }, 30000);

  it('edits, copies, saves, defaults and deletes AI channels; model lists support both demo and Go response shapes', async () => {
    const f = await setup({ demoModels: true }); const { page } = f;
    try {
      await show(page, 'settings'); await call(page, 'loadConfig', [false]); await page.locator('[data-settings-action="channel-new"]').click(); await page.locator('#ai-channel-name').fill('New <safe> channel'); await page.locator('#openai-base-url').fill('https://api.deepseek.com/v1'); await page.locator('#openai-api-key').fill('new-key'); await page.locator('#openai-model').fill('deepseek-chat');
      await page.locator('[data-settings-action="channel-save"]').click(); await browserExpect.poll(() => f.calls.filter(call => call.method === 'PUT').length).toBe(1); await browserExpect(page.locator('#ai-channel-save-hint')).toHaveClass(/is-success/);
      const id = await page.locator('#ai-channel-select').inputValue(); expect(object(object(f.config().ai).channels)[id]).toMatchObject({ name: 'New <safe> channel', reasoning: { profile: 'deepseek' } });
      await page.locator('[data-settings-action="channel-default"]').click(); await browserExpect.poll(() => object(f.config().ai).default_channel).toBe(id);
      await page.locator('[data-settings-action="channel-copy"]').click(); await page.locator('[data-settings-action="channel-save"]').click(); await browserExpect.poll(() => Object.keys(object(object(f.config().ai).channels)).length).toBe(4);
      await page.locator('[data-settings-action="channel-delete"]').click(); await browserExpect.poll(() => Object.keys(object(object(f.config().ai).channels)).length).toBe(3);
      await page.locator('[data-settings-action="models-fetch"][data-settings-id="openai"]').click(); await browserExpect(page.locator('#fetch-openai-models-result')).toContainText('settingsBasic.modelsListSuccess');
      await browserExpect(page.locator('#openai-model-select option')).toHaveCount(4); await page.locator('#openai-model-select').selectOption('small', { force: true }); await browserExpect(page.locator('#openai-model')).toHaveValue('small');
      await call(page, 'testOpenAIConnection'); await browserExpect(page.locator('#test-openai-result')).toContainText('42ms'); expect(f.errors).toEqual([]);
    } finally { await page.close(); }
  }, 30000);

  it('retains cross-page tool edits, separates resident and enable checkboxes, filters by status/source and reads schemas', async () => {
    const f = await setup(); const { page } = f;
    try {
      await show(page, 'mcp-management'); await call(page, 'loadConfig', [false]); await call(page, 'loadExternalMCPs'); await call(page, 'loadToolsList', [1, '']);
      const local = page.locator('#tools-list .tool-item[data-tool-name="tool-2"]'); await local.locator(':scope > input').uncheck();
      const external = page.locator('#tools-list .tool-item[data-tool-name="lookup"]'); await external.locator('.tool-resident-toggle input').uncheck(); await browserExpect(external.locator(':scope > input')).toBeChecked();
      await page.locator('[data-settings-action="tools-page"][data-settings-id="2"]').first().click(); await browserExpect(page.locator('.tool-item[data-tool-name="tool-23"]')).toBeVisible(); await page.locator('.tool-item[data-tool-name="tool-23"] > input').uncheck();
      await page.locator('[data-settings-action="tools-page"][data-settings-id="1"]').first().click(); await browserExpect(page.locator('.tool-item[data-tool-name="tool-2"] > input')).not.toBeChecked();
      await page.locator('.tool-item[data-tool-name="tool-2"] .tool-item-info').click(); await browserExpect(page.locator('.tool-item[data-tool-name="tool-2"] .tool-schema-table')).toContainText('<safe> target');
      await page.locator('[data-settings-action="tools-save"]').click(); await browserExpect.poll(() => f.calls.some(call => call.path === '/api/config/apply')).toBe(true); expect(f.tools().find(tool => tool.name === 'tool-23')?.enabled).toBe(false); expect(f.tools().find(tool => tool.name === 'tool-2')?.enabled).toBe(false);
      await page.locator('#tools-search').fill('lookup'); await page.locator('#tools-search').press('Enter'); await browserExpect(page.locator('#tools-list .tool-item')).toHaveCount(2);
      await page.locator('[data-settings-action="tools-status"][data-settings-id="true"]').click(); await browserExpect.poll(() => f.calls.some(call => call.path.includes('enabled=true'))).toBe(true);
      await call(page, 'scrollToExternalMCPTools', [specialMCP]); await browserExpect(page.locator('#tools-source-filter-chip')).toContainText('mcp.filterBySource'); expect(f.calls.some(call => call.path.includes('external_mcp=' + encodeURIComponent(specialMCP).replace(/%20/g, '+')))).toBe(true);
      await page.locator('[data-settings-action="tools-source-clear"]').click(); await browserExpect(page.locator('#tools-source-filter-chip')).toBeHidden(); expect(f.errors).toEqual([]);
    } finally { await page.close(); }
  }, 30000);

  it('validates and saves stdio/http/SSE MCP JSON, handles hostile names, edits, starts/stops and deletes', async () => {
    const f = await setup(); const { page } = f;
    try {
      await show(page, 'mcp-management'); await call(page, 'loadConfig', [false]); await call(page, 'loadExternalMCPs'); await browserExpect(page.locator('#external-mcp-list')).toContainText(specialMCP); await browserExpect(page.locator('#external-mcp-list')).toContainText('SSE');
      await page.locator('[data-settings-action="mcp-add"]').click(); await page.locator('#external-mcp-json').fill('{"sse":{"type":"sse"}}'); await page.locator('[data-settings-action="mcp-save"]').click(); await browserExpect(page.locator('#external-mcp-json-error')).toContainText('mcp.configSseNeedUrl');
      await page.locator('#external-mcp-json').fill('{"added":{"type":"sse","url":"https://new/sse","external_mcp_enable":true},"stdio":{"command":"python3","args":["${HOME}/tool.py"]}}'); await page.locator('[data-settings-action="mcp-save"]').click(); await browserExpect(page.locator('#external-mcp-modal')).toBeHidden(); expect(f.servers().added?.config).not.toHaveProperty('external_mcp_enable');
      const card = page.locator('.external-mcp-item').filter({ hasText: specialMCP }); await card.locator('[data-settings-action="mcp-edit"]').click(); await browserExpect(page.locator('#external-mcp-json')).toHaveValue(new RegExp('https://mcp.example/sse')); await page.locator('[data-settings-action="mcp-format"]').click(); await page.locator('[data-settings-action="mcp-save"]').click(); await browserExpect(page.locator('#external-mcp-modal')).toBeHidden();
      await page.locator('.external-mcp-item').filter({ hasText: 'second' }).locator('[data-settings-action="mcp-toggle"]').click(); await browserExpect.poll(() => f.servers().second?.status).toBe('connected');
      await call(page, 'toggleExternalMCP', ['second', 'connected']); expect(f.servers().second?.status).toBe('disabled');
      await call(page, 'deleteExternalMCP', [specialMCP]); expect(f.servers()[specialMCP]).toBeUndefined(); expect(f.calls.some(call => call.path === '/api/external-mcp/' + encodeURIComponent(specialMCP) && call.method === 'DELETE')).toBe(true); expect(f.errors).toEqual([]);
    } finally { await page.close(); }
  }, 30000);

  it('keeps TypeSafe credentials independent, tests vision/audit, validates passwords and invokes lazy auth/chat hooks', async () => {
    const f = await setup(); const { page } = f;
    try {
      await show(page, 'settings'); await call(page, 'loadConfig', [false]); await section(page, 'hitl'); await call(page, 'fetchModelList', ['hitlAudit']); expect(f.calls.find(call => call.path === '/api/config/list-models')?.body).toMatchObject({ credential_scope: 'hitlAudit', channel_id: 'main', api_key: '********' });
      await page.locator('#hitl-audit-backend').selectOption('typesafe', { force: true }); await call(page, 'testHitlAuditModelConnection'); expect(f.calls.some(call => call.path === '/api/config/test-typesafe')).toBe(false);
      await page.locator('#hitl-audit-model-api-key').fill('typesafe-key'); await call(page, 'testHitlAuditModelConnection'); expect(f.calls.find(call => call.path === '/api/config/test-typesafe')?.body).toMatchObject({ api_key: 'typesafe-key', model: 'jev-latest', base_url: '' });
      await section(page, 'basic'); await page.locator('label').filter({ has: page.locator('#vision-enabled') }).click(); await page.locator('#vision-model').fill('vision-model'); await call(page, 'testVisionConnection'); expect(f.calls.find(call => call.path === '/api/config/test-vision')?.body).toMatchObject({ channel_id: 'main', vision: { model: 'vision-model' }, openai: { api_key: '********' } });
      await call(page, 'fetchModelList', ['vision']); await section(page, 'knowledge'); await call(page, 'fetchModelList', ['knowledgeEmbedding']);
      expect(f.calls.filter(call => call.path === '/api/config/list-models').map(call => call.body.credential_scope)).toEqual(['hitlAudit', 'vision', 'knowledgeEmbedding']);
      await section(page, 'security'); await page.locator('[data-settings-action="password-change"]').click(); await browserExpect(page.locator('#auth-current-password')).toHaveAttribute('aria-invalid', 'true'); expect(f.calls.some(call => call.path === '/api/auth/change-password')).toBe(false);
      await page.locator('#auth-current-password').fill('old-pass'); await page.locator('#auth-new-password').fill('new-pass-123'); await page.locator('#auth-confirm-password').fill('new-pass-123'); await page.locator('[data-settings-action="password-change"]').click();
      await browserExpect.poll(() => f.calls.some(call => call.path === '/api/auth/change-password')).toBe(true); expect(f.calls.find(call => call.path === '/api/auth/change-password')?.body).toEqual({ oldPassword: 'old-pass', newPassword: 'new-pass-123' }); await browserExpect(page.locator('#auth-current-password')).toHaveValue('');
      expect(await page.evaluate(() => (globalThis as typeof globalThis & { settingsHarness: Harness }).settingsHarness.hubs)).toEqual(expect.arrayContaining(['handleUnauthorized', 'chat'])); expect(f.errors).toEqual([]);
    } finally { await page.close(); }
  }, 30000);

  it('honors write permissions and keeps apply failures visible without navigating away', async () => {
    const f = await setup({ failApply: true }); const { page } = f;
    try {
      await show(page, 'settings'); await call(page, 'loadConfig', [false]); await page.evaluate(() => { (globalThis as typeof globalThis & { settingsHarness: Harness }).settingsHarness.allowed = false; }); await call(page, 'saveSelectedAIChannel'); await call(page, 'applySettings'); expect(f.calls.some(call => call.method === 'PUT')).toBe(false);
      await page.evaluate(() => { (globalThis as typeof globalThis & { settingsHarness: Harness }).settingsHarness.allowed = true; }); await call(page, 'applySettings'); expect(f.alerts).toContain('settings.apply.applyFailed: apply rejected'); await browserExpect(page.locator('#page-settings')).toHaveClass(/active/); expect(f.errors).toEqual([]);
    } finally { await page.close(); }
  }, 30000);

  it('probes selected channels, protects bulk default deletion and refreshes language/C2 without losing edits', async () => {
    const f = await setup(); const { page } = f;
    try {
      await show(page, 'settings'); await call(page, 'loadConfig', [false]);
      // The shipped stylesheet hides the retained card/bulk list in favor of the
      // channel dropdown. Reveal it only in this fixture to exercise its handlers.
      await page.locator('#ai-channel-list').evaluate(node => { (node as HTMLElement).style.display = 'block'; });
      await page.locator('[data-settings-action="channel-check"][data-settings-id="extra"]').check(); await page.locator('[data-settings-action="channel-probe"]').click();
      await browserExpect(page.locator('.ai-channel-list-item[data-settings-id="extra"]')).toContainText('settingsBasic.aiChannelReadyWithLatency');
      expect(f.calls.filter(call => call.path === '/api/config/test-openai').map(call => call.body.channel_id)).toEqual(['extra']);
      await page.locator('[data-settings-action="channel-check"][data-settings-id="main"]').check(); await call(page, 'deleteCheckedAIChannels');
      expect(Object.keys(object(object(f.config().ai).channels))).toEqual(['main']);
      await section(page, 'c2'); await page.locator('label').filter({ has: page.locator('#c2-enabled') }).click(); await call(page, 'applySettings'); await browserExpect(page.locator('#nav-c2')).toBeHidden(); expect(await page.evaluate(() => (globalThis as typeof globalThis & { settingsHarness: Harness }).settingsHarness.c2Enabled)).toBe(false);
      await show(page, 'mcp-management'); await call(page, 'loadToolsList', [1, '']); await page.locator('.tool-item[data-tool-name="tool-2"] > input').uncheck();
      await page.evaluate(() => { (globalThis as typeof globalThis & { settingsHarness: Harness }).settingsHarness.translated = true; document.dispatchEvent(new Event('languagechange')); });
      await browserExpect(page.locator('#tools-stats')).toContainText('translated:mcp.currentPageEnabled'); await browserExpect(page.locator('.tool-item[data-tool-name="tool-2"] > input')).not.toBeChecked(); expect(f.errors).toEqual([]);
    } finally { await page.close(); }
  }, 30000);

  it('starts one MCP interval, stops on page exit and cancels all subsequent work on disposal', async () => {
    const f = await setup(); const { page } = f;
    try {
      await page.clock.install(); await show(page, 'mcp-management'); await call(page, 'startExternalMcpPoll'); await call(page, 'startExternalMcpPoll');
      await page.clock.fastForward(8000); await browserExpect.poll(() => f.calls.filter(call => call.path === '/api/external-mcp').length).toBe(1);
      await show(page, 'settings'); await page.clock.fastForward(16000); expect(f.calls.filter(call => call.path === '/api/external-mcp')).toHaveLength(1);
      await show(page, 'mcp-management'); await call(page, 'startExternalMcpPoll'); await page.evaluate(() => { (globalThis as typeof globalThis & { settingsHarness: Harness }).settingsHarness.feature.dispose(); });
      await page.clock.fastForward(60000); expect(f.calls.filter(call => call.path === '/api/external-mcp')).toHaveLength(1); expect(f.errors).toEqual([]);
    } finally { await page.close(); }
  }, 30000);
});
