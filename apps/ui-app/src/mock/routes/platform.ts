/*
 * Platform areas: configuration, tools, skills, AI roles, knowledge base,
 * external MCP, workflows, C2, WebShell, terminal, storage, updates, chat
 * uploads, notifications bridges (robot/FOFA), tool guard, OpenAPI.
 */
import type { MockRuntime } from '../runtime';
import type { Context } from '../router';
import type { Config, ExternalMCP, Skill, Workflow } from '../types';
import { bodies } from '../bodies';
import { z } from 'zod';

interface OpenApiOperation {
  tags: string[]; summary: string; operationId: string;
  parameters: { name: string; in: string; required: boolean; schema: { type: string } }[];
  responses: { '200': { description: string } }; security: { bearerAuth: never[] }[];
}

export function registerPlatform(M: MockRuntime): void {

  /* ---------- configuration ---------- */

  // Snake_case shape mirroring config.example.yaml. Keys used by settings.js.
  M.configSeed = function (): Config {
    return {
      version: 'v1.7.24',
      server: { host: '127.0.0.1', port: 8080 },
      auth: { session_duration_hours: 12 },
      log: { level: 'info' },
      audit: { enabled: true, retention_days: 90 },
      monitor: { retention_days: 30 },
      storage: { retention_days: 30, auto_cleanup: false },
      ai: {
        default_channel: 'demo-large',
        channels: {
          'demo-large': { name: 'Demo Large', provider: 'openai_compatible', base_url: 'https://llm.example.com/v1', api_key: 'sk-demo-xxxxxxxx', model: 'demo-large', max_total_tokens: 120000, max_completion_tokens: 32768, reasoning: { mode: 'auto', effort: 'medium', allow_client_reasoning: true, profile: 'openai_compat' } },
          'demo-small': { name: 'Demo Small', provider: 'openai_compatible', base_url: 'https://llm.example.com/v1', api_key: 'sk-demo-xxxxxxxx', model: 'demo-small', max_total_tokens: 32000, max_completion_tokens: 4096, reasoning: { mode: 'off', effort: '', allow_client_reasoning: false, profile: 'openai_compat' } },
        },
      },
      vision: { enabled: false, base_url: '', api_key: '', model: '' },
      fofa: { api_key: '', base_url: 'https://fofa.info/api/v1/search/all' },
      zoomeye: { api_key: '', base_url: 'https://api.zoomeye.ai/v2/search' },
      quake: { api_key: '', base_url: 'https://quake.360.net/api/v3/search/quake_service' },
      shodan: { api_key: '', base_url: 'https://api.shodan.io' },
      agent: { max_iterations: 30, timeout_seconds: 600, parallel_tools: 2 },
      tool_guard: { enabled: true, mode: 'block', rules: [] },
      hitl: { enabled: false, timeout_seconds: 300, tool_whitelist: ['search_knowledge'] },
      multi_agent: {
        enabled: true, orchestration: 'deep', batch_use_multi_agent: false,
        plan_execute_loop_max_iterations: 6, sub_agents: [],
        eino_middleware: { model_retry_max_retries: 3, model_retry_max_backoff_sec: 20, model_failover_channels: [], model_failover_max_retries: 1 },
        tool_search_always_visible_tools: [], tool_search_always_visible_effective_tools: [],
      },
      database: { path: 'data/demo.db' },
      security: { tools: [] },
      mcp: { enabled: true, port: 8081, auth_header: 'X-MCP-Token', auth_header_value: '' },
      external_mcp: { enabled: true, servers: {} },
      knowledge: { enabled: true, top_k: 5, chunk_size: 800, embedding_model: 'demo-embed' },
      c2: { enabled: true },
      robots: { wechat: { enabled: false }, dingtalk: { enabled: false }, lark: { enabled: false }, wecom: { enabled: false } },
      skills_dir: 'skills',
      agents_dir: 'agents',
      roles_dir: 'roles',
      project: { default_scope: 'lab' },
    };
  };

  function cfg() {
    if (!M.state.config) {
      M.state.config = M.configSeed();
      M.save();
    }
    return M.state.config;
  }

  const DEMO_TOOLS = [
    { name: 'nmap_scan', description: 'Port and service scan (demo)', enabled: true, is_external: false, category: 'recon' },
    { name: 'http_probe', description: 'Single HTTP request with headers and body (demo)', enabled: true, is_external: false, category: 'web' },
    { name: 'search_knowledge', description: 'Search the knowledge base', enabled: true, is_external: false, category: 'knowledge' },
    { name: 'token_replay', description: 'Replay an authenticated request sequence (demo)', enabled: true, is_external: false, category: 'auth' },
    { name: 'terminal_run', description: 'Run a command in the terminal', enabled: false, is_external: false, category: 'shell' },
    { name: 'lab_notes_lookup', description: 'External MCP: lookup lab notes', enabled: true, is_external: true, category: 'external' },
  ];

  M.route('GET', '/api/config', function () { return M.ok(cfg()); });

  M.route('PUT', '/api/config', bodies.config, function (ctx) {
    const c = cfg();
    const body = ctx.body || {};
    M.mergeInto(c, body);
    M.save();
    return M.ok({ message: 'Configuration updated' });
  });

  M.route('POST', '/api/config/apply', function () {
    return M.ok({ message: 'Configuration applied (demo)', restarted: false });
  });

  M.route('GET', '/api/config/tools', function (ctx) {
    const list = M.filterList(DEMO_TOOLS, ctx, { searchFields: ['name', 'description'] });
    const enabled = list.filter(function (t) { return t.enabled; }).length;
    const page = M.pagePaged(list, ctx, 50);
    return M.ok({ tools: page.items, total: page.total, total_enabled: enabled, page: page.page, page_size: page.pageSize, total_pages: page.totalPages });
  });

  M.route('GET', '/api/config/tools/:name/schema', function () {
    return M.ok({ input_schema: { type: 'object', properties: { target: { type: 'string', description: 'Target host or URL' } }, required: ['target'] } });
  });

  M.route('POST', '/api/config/list-models', function () {
    return M.ok({ success: true, models: ['demo-large', 'demo-small', 'demo-embed'] });
  });

  M.route('POST', '/api/config/test-openai', function () { return M.ok({ success: true, message: 'Connection successful (demo)', latency_ms: 210 }); });
  M.route('POST', '/api/config/test-typesafe', function () { return M.ok({ success: true, message: 'Connection successful (demo)' }); });
  M.route('POST', '/api/config/test-vision', function () { return M.ok({ success: true, message: 'Vision model available (demo)' }); });

  M.route('PUT', '/api/config/tools', function () { return M.ok({ success: true }); });

  M.route('GET', '/api/tool-guard', function () {
    return M.ok(cfg().tool_guard || { enabled: true, mode: 'block', rules: [] });
  });
  M.route('PUT', '/api/tool-guard', bodies.toolGuard, function (ctx) {
    cfg().tool_guard = Object.assign(cfg().tool_guard || {}, ctx.body || {});
    M.save();
    return M.ok(cfg().tool_guard);
  });
  M.route('POST', '/api/tool-guard/test', bodies.command, function (ctx) {
    const cmd = String((ctx.body && ctx.body.command) || '');
    const blocked = /rm\s+-rf|mkfs|shutdown/.test(cmd);
    return M.ok({ blocked: blocked, reason: blocked ? 'Matches a destructive pattern (demo rule)' : 'Allowed by demo rules' });
  });

  // Built from the mock's own route table, so every mocked endpoint is listed and
  // can be tried from the API Docs page. Tag = first path segment after /api/.
  M.route('GET', '/api/openapi/spec', function () {
    const paths: Record<string, Record<string, OpenApiOperation>> = {};
    M.routes.forEach(function (r) {
      const openPath = r.pattern.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
      const method = r.method.toLowerCase();
      const tag = (r.pattern.split('/')[2] || 'misc');
      const operations = paths[openPath] ??= {};
      const params = (r.pattern.match(/:[A-Za-z0-9_]+/g) || []).map(function (p) {
        return { name: p.slice(1), in: 'path', required: true, schema: { type: 'string' } };
      });
      operations[method] = {
        tags: [tag],
        summary: r.method + ' ' + r.pattern,
        operationId: (r.method + '_' + r.pattern).replace(/[^A-Za-z0-9]+/g, '_'),
        parameters: params,
        responses: { '200': { description: 'OK (demo response)' } },
        security: r.pattern === '/api/auth/login' ? [] : [{ bearerAuth: [] }],
      };
    });
    return M.ok({
      openapi: '3.0.3',
      info: { title: 'Raptix UI mock', version: 'v1.7.24', description: 'Endpoints answered by the standalone demo runtime. Data is fictional.' },
      servers: [{ url: '/' }],
      paths: paths,
      components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
    });
  });

  M.route('GET', '/api/v1/status', function () { return M.ok({ status: 'ok', version: 'v1.7.24', mode: 'demo' }); });

  /* ---------- skills ---------- */

  function skillView(s: Skill) {
    return { name: s.name, description: s.description, category: s.category, enabled: s.enabled, version: s.version, tags: s.tags, files: s.files, updated_at: s.updated_at };
  }

  M.route('GET', '/api/skills', function (ctx) {
    const list = M.filterList(M.state.skills, ctx, { searchFields: ['name', 'description', 'category'], filters: { category: 'category' } });
    const page = M.limitOffset(list, ctx, 100);
    return M.ok({ skills: page.items.map(skillView), total: page.total, limit: page.limit, offset: page.offset });
  });

  M.route('GET', '/api/skills/stats', function () {
    return M.ok({ total: M.state.skills.length, enabled: M.state.skills.filter(function (s) { return s.enabled; }).length, invocations: 128, by_skill: M.state.skills.map(function (s) { return { name: s.name, invocations: s.name.length * 7 }; }) });
  });

  M.route('DELETE', '/api/skills/stats', function () { return M.ok({ success: true }); });
  M.route('DELETE', '/api/skills/:name/stats', function () { return M.ok({ success: true }); });

  M.route('POST', '/api/skills', bodies.skill, function (ctx) {
    const b = ctx.body || {};
    if (!b.name) return M.fail(400, 'Skill name is required');
    const s = { name: b.name, description: b.description || '', category: b.category || 'custom', enabled: true, version: '0.1.0', files: ['SKILL.md'], tags: [], updated_at: M.nowISO() };
    M.state.skills.push(s);
    M.save();
    return M.ok(skillView(s));
  });

  M.route('GET', '/api/skills/:name', function (ctx) {
    const found = M.state.skills.filter(function (s) { return s.name === ctx.params.name; })[0];
    if (!found) return M.fail(404, 'Skill not found');
    return M.ok(Object.assign(skillView(found), { content: '# ' + found.name + '\n\n' + found.description + '\n' }));
  });

  M.route('PUT', '/api/skills/:name', bodies.skill, function (ctx) {
    const s = M.state.skills.filter(function (x) { return x.name === ctx.params.name; })[0];
    if (!s) return M.fail(404, 'Skill not found');
    M.mergeInto(s, ctx.body, ['description', 'category', 'enabled', 'version', 'tags']);
    s.updated_at = M.nowISO();
    M.save();
    return M.ok(skillView(s));
  });

  M.route('DELETE', '/api/skills/:name', function (ctx) {
    M.state.skills = M.state.skills.filter(function (s) { return s.name !== ctx.params.name; });
    M.save();
    return M.ok({ success: true });
  });

  M.route('GET', '/api/skills/:name/files', function (ctx) {
    const s = M.state.skills.filter(function (x) { return x.name === ctx.params.name; })[0];
    return M.ok({ files: s ? s.files : [] });
  });

  M.route('GET', '/api/skills/:name/file', function (ctx) {
    const path = M.q(ctx, 'path', 'SKILL.md');
    return M.ok({ path: path, content: '# ' + ctx.params.name + '\n\nDemo content for ' + path + '.\n' });
  });

  M.route('PUT', '/api/skills/:name/file', function () { return M.ok({ success: true }); });

  M.route('GET', '/api/skills/:name/bound-roles', function (ctx) {
    const bound = M.state.aiRoles.filter(function (r) { return (r.skills || []).indexOf(ctx.params.name) !== -1; })
      .map(function (r) { return r.name; });
    return M.ok({ roles: bound });
  });

  /* ---------- AI testing roles ---------- */

  M.route('GET', '/api/roles', function (ctx) {
    const list = M.filterList(M.state.aiRoles, ctx, { searchFields: ['name', 'description'] });
    return M.ok({ roles: list, total: list.length });
  });

  M.route('POST', '/api/roles', bodies.aiRole, function (ctx) {
    const b = ctx.body || {};
    if (!b.name) return M.fail(400, 'Role name is required');
    const r = { name: b.name, description: b.description || '', enabled: true, skills: b.skills || [], tools: b.tools || [], prompt: b.prompt || '', is_builtin: false, updated_at: M.nowISO() };
    M.state.aiRoles.push(r);
    M.save();
    return M.ok(r);
  });

  M.route('GET', '/api/roles/:name', function (ctx) {
    const r = M.state.aiRoles.filter(function (x) { return x.name === ctx.params.name; })[0];
    if (!r) return M.fail(404, 'Role not found');
    return M.ok(r);
  });

  M.route('PUT', '/api/roles/:name', bodies.aiRole, function (ctx) {
    const r = M.state.aiRoles.filter(function (x) { return x.name === ctx.params.name; })[0];
    if (!r) return M.fail(404, 'Role not found');
    M.mergeInto(r, ctx.body, ['description', 'enabled', 'skills', 'tools', 'prompt']);
    r.updated_at = M.nowISO();
    M.save();
    return M.ok(r);
  });

  M.route('DELETE', '/api/roles/:name', function (ctx) {
    const r = M.state.aiRoles.filter(function (x) { return x.name === ctx.params.name; })[0];
    if (r && r.is_builtin) return M.fail(400, 'Built-in roles cannot be deleted');
    M.state.aiRoles = M.state.aiRoles.filter(function (x) { return x.name !== ctx.params.name; });
    M.save();
    return M.ok({ success: true });
  });

  // Item shape follows internal/handler/markdown_agents.go (is_orchestrator, bind_role, tools...).
  M.route('GET', '/api/multi-agent/markdown-agents', function () {
    return M.ok({
      agents: [
        { id: 'recon-lead', filename: 'recon-lead.md', name: 'Recon Lead', kind: 'markdown', is_orchestrator: true, description: 'Coordinates recon sub-agents (demo)', bind_role: 'Recon Analyst', max_iterations: 12, tools: ['nmap_scan', 'http_probe'], instruction: '' },
        { id: 'web-tester', filename: 'web-tester.md', name: 'Web Tester', kind: 'markdown', is_orchestrator: false, description: 'Reviews web apps for misconfigurations (demo)', bind_role: 'Web Tester', max_iterations: 8, tools: ['http_probe', 'search_knowledge'], instruction: '' },
        { id: 'report-writer', filename: 'report-writer.md', name: 'Report Writer', kind: 'markdown', is_orchestrator: false, description: 'Drafts findings reports (demo)', bind_role: 'Report Writer', max_iterations: 6, tools: ['search_knowledge'], instruction: '' },
      ],
      dir: 'agents',
    });
  });
  M.route('GET', '/api/multi-agent/markdown-agents/:filename', function (ctx) {
    return M.ok({ filename: ctx.params.filename, content: '---\nname: Recon Lead\n---\n\nCoordinates recon sub-agents. Demo content.\n' });
  });
  M.route('POST', '/api/multi-agent/markdown-agents', bodies.filename, function (ctx) { return M.ok({ success: true, filename: (ctx.body && ctx.body.filename) || 'new-agent.md' }); });
  M.route('PUT', '/api/multi-agent/markdown-agents/:filename', function () { return M.ok({ success: true }); });
  M.route('DELETE', '/api/multi-agent/markdown-agents/:filename', function () { return M.ok({ success: true }); });

  /* ---------- knowledge base ---------- */

  M.route('GET', '/api/knowledge/categories', function () {
    return M.ok({ categories: M.state.knowledgeCategories });
  });

  M.route('GET', '/api/knowledge/items', function (ctx) {
    const category = M.q(ctx, 'category', '');
    const list = M.filterList(M.state.knowledgeItems, ctx, { searchFields: ['title', 'content'] }).filter(function (k) {
      return !category || k.category === category;
    });
    const page = M.pagePaged(list, ctx, 50);
    return M.ok({ items: page.items, total: page.total, page: page.page, page_size: page.pageSize });
  });

  M.route('POST', '/api/knowledge/items', bodies.knowledge, function (ctx) {
    const b = ctx.body || {};
    const item = { id: M.id('kb'), category: b.category || 'general', title: b.title || 'Untitled', content: b.content || '', indexed: false, updated_at: M.nowISO() };
    M.state.knowledgeItems.unshift(item);
    M.recountKnowledge();
    M.save();
    return M.ok(item);
  });

  M.recountKnowledge = function () {
    const counts: Record<string, number> = {};
    M.state.knowledgeItems.forEach(function (k) { counts[k.category] = (counts[k.category] || 0) + 1; });
    M.state.knowledgeCategories = Object.entries(counts).map(function ([name, count]) { return { name, count }; });
  };

  M.route('GET', '/api/knowledge/items/:id', function (ctx) {
    const found = M.findById(M.state.knowledgeItems, ctx.params.id);
    if (!found) return M.fail(404, 'Entry not found');
    return M.ok(found.item);
  });

  M.route('PUT', '/api/knowledge/items/:id', bodies.knowledge, function (ctx) {
    const found = M.findById(M.state.knowledgeItems, ctx.params.id);
    if (!found) return M.fail(404, 'Entry not found');
    M.mergeInto(found.item, ctx.body, ['title', 'content', 'category']);
    found.item.indexed = false;
    found.item.updated_at = M.nowISO();
    M.recountKnowledge();
    M.save();
    return M.ok(found.item);
  });

  M.route('DELETE', '/api/knowledge/items/:id', function (ctx) {
    const found = M.findById(M.state.knowledgeItems, ctx.params.id);
    if (!found) return M.fail(404, 'Entry not found');
    M.removeAt(M.state.knowledgeItems, found.index);
    M.recountKnowledge();
    M.save();
    return M.ok({ success: true });
  });

  M.route('GET', '/api/knowledge/stats', function () {
    return M.ok({ total_items: M.state.knowledgeItems.length, indexed: M.state.knowledgeItems.filter(function (k) { return k.indexed; }).length, categories: M.state.knowledgeCategories.length });
  });

  M.route('GET', '/api/knowledge/index-status', function () {
    const pending = M.state.knowledgeItems.filter(function (k) { return !k.indexed; }).length;
    return M.ok({ status: pending ? 'pending' : 'ready', pending: pending, total: M.state.knowledgeItems.length, last_indexed_at: M.nowISO() });
  });

  M.route('POST', '/api/knowledge/index', function () {
    M.state.knowledgeItems.forEach(function (k) { k.indexed = true; });
    M.save();
    return M.ok({ status: 'ready', indexed: M.state.knowledgeItems.length });
  });

  M.route('POST', '/api/knowledge/scan', function () {
    return M.ok({ scanned: M.state.knowledgeItems.length, added: 0, message: 'Scan completed (demo)' });
  });

  M.route('GET', '/api/knowledge/retrieval-logs', function (ctx) {
    const logs = M.state.retrievalLogs || [
      { id: 'rl-1', query: 'refresh token rotation', hits: 2, top_item: 'Refresh token rotation', created_at: M.isoAgo(30) },
      { id: 'rl-2', query: 'sql injection checklist', hits: 1, top_item: 'SQL injection testing checklist', created_at: M.isoAgo(240) },
    ];
    const page = M.pagePaged(logs, ctx, 20);
    return M.ok({ logs: page.items, total: page.total, page: page.page, page_size: page.pageSize });
  });

  M.route('DELETE', '/api/knowledge/retrieval-logs/:id', function (ctx) {
    M.state.retrievalLogs = (M.state.retrievalLogs || []).filter(function (l) { return l.id !== ctx.params.id; });
    M.save();
    return M.ok({ success: true });
  });

  /* ---------- external MCP ---------- */

  // Shape matches settings.js: servers is a map name -> { status, tool_count, config }.
  function mcpEntry(s: ExternalMCP) {
    return {
      status: s.status, tool_count: s.tools_count, last_error: s.last_error,
      config: { type: s.transport, transport: s.transport, command: s.command, args: s.args, url: s.url, enabled: s.enabled, description: s.description || '', timeout: 30 },
    };
  }

  function mcpServersMap() {
    const out: Record<string, ReturnType<typeof mcpEntry>> = {};
    M.state.externalMCP.forEach(function (s) { out[s.name] = mcpEntry(s); });
    return out;
  }

  M.route('GET', '/api/external-mcp', function () {
    const list = M.state.externalMCP;
    const stats = {
      total: list.length,
      enabled: list.filter(function (s) { return s.enabled; }).length,
      connected: list.filter(function (s) { return s.status === 'connected'; }).length,
      disabled: list.filter(function (s) { return !s.enabled; }).length,
    };
    return M.ok({ servers: mcpServersMap(), stats: stats });
  });

  M.route('GET', '/api/external-mcp/stats', function () {
    const list = M.state.externalMCP;
    return M.ok({ total: list.length, enabled: list.filter(function (s) { return s.enabled; }).length, connected: list.filter(function (s) { return s.status === 'connected'; }).length, disabled: list.filter(function (s) { return !s.enabled; }).length });
  });

  M.route('GET', '/api/external-mcp/:name', function (ctx) {
    const s = M.state.externalMCP.filter(function (x) { return x.name === ctx.params.name; })[0];
    if (!s) return M.fail(404, 'MCP server not found');
    return M.ok(mcpEntry(s));
  });

  M.route('POST', '/api/external-mcp', bodies.mcp, function (ctx) {
    const b = ctx.body || {};
    if (!b.name) return M.fail(400, 'Name is required');
    const s = Object.assign({ name: b.name, enabled: true, status: 'stopped', tools_count: 0, last_error: '', args: [], url: '', command: '', transport: 'stdio' }, b);
    M.state.externalMCP.push(s);
    M.save();
    return M.ok(s);
  });

  M.route('PUT', '/api/external-mcp/:name', bodies.mcp, function (ctx) {
    const s = M.state.externalMCP.filter(function (x) { return x.name === ctx.params.name; })[0];
    if (!s) return M.fail(404, 'MCP server not found');
    M.mergeInto(s, ctx.body, ['transport', 'command', 'args', 'url', 'enabled']);
    M.save();
    return M.ok(s);
  });

  M.route('DELETE', '/api/external-mcp/:name', function (ctx) {
    M.state.externalMCP = M.state.externalMCP.filter(function (x) { return x.name !== ctx.params.name; });
    M.save();
    return M.ok({ success: true });
  });

  function setMcpStatus(ctx: Context, status: string) {
    const s = M.state.externalMCP.filter(function (x) { return x.name === ctx.params.name; })[0];
    if (!s) return M.fail(404, 'MCP server not found');
    s.status = status;
    s.last_error = status === 'stopped' ? '' : s.last_error;
    if (status === 'connected') s.tools_count = s.tools_count || 3;
    M.save();
    return M.ok(s);
  }
  M.route('POST', '/api/external-mcp/:name/start', function (ctx) { return setMcpStatus(ctx, 'connected'); });
  M.route('POST', '/api/external-mcp/:name/stop', function (ctx) { return setMcpStatus(ctx, 'stopped'); });

  /* ---------- workflows ---------- */

  // Workflow records: graph_json holds { nodes, edges } as the editor expects.
  function wfView(w: Workflow) {
    const g = w.graph_json || { nodes: [], edges: [] };
    return {
      id: w.id, name: w.name, description: w.description || '', version: w.version || 1, enabled: !!w.enabled,
      validation_error: w.validation_error || '', graph_json: g,
      node_count: (g.nodes || []).length, edge_count: (g.edges || []).length, updated_at: w.updated_at,
    };
  }

  M.route('GET', '/api/workflows', function (ctx) {
    const list = M.filterList(M.state.workflows, ctx, { searchFields: ['name', 'description'] });
    return M.ok({ workflows: list.map(wfView), total: list.length });
  });

  M.route('POST', '/api/workflows', bodies.workflow, function (ctx) {
    const b = ctx.body || {};
    const w = { id: M.id('wf'), name: b.name || 'Untitled workflow', description: b.description || '', version: 1, enabled: false, validation_error: '', graph_json: b.graph_json || b.graph || { nodes: [], edges: [] }, updated_at: M.nowISO() };
    M.state.workflows.unshift(w);
    M.save();
    return M.ok(wfView(w));
  });


  M.route('PUT', '/api/workflows/:id', bodies.workflow, function (ctx) {
    const w = M.state.workflows.filter(function (x) { return x.id === ctx.params.id; })[0];
    if (!w) return M.fail(404, 'Workflow not found');
    const b = ctx.body || {};
    M.mergeInto(w, b, ['name', 'description', 'enabled']);
    const graph = b.graph_json || b.graph;
    if (graph) w.graph_json = graph;
    w.version = (w.version || 1) + 1;
    w.updated_at = M.nowISO();
    M.save();
    return M.ok(wfView(w));
  });

  M.route('DELETE', '/api/workflows/:id', function (ctx) {
    M.state.workflows = M.state.workflows.filter(function (x) { return x.id !== ctx.params.id; });
    M.save();
    return M.ok({ success: true });
  });

  M.route('POST', '/api/workflows/validate', function () { return M.ok({ valid: true, errors: [], warnings: [] }); });
  M.route('POST', '/api/workflows/dry-run', function () { return M.ok({ status: 'ok', steps: [{ node: 'start', result: 'would run (demo)' }] }); });
  M.route('POST', '/api/workflows/generate-draft', bodies.prompt, function (ctx) {
    return M.ok({ name: 'Draft from prompt', description: String((ctx.body && ctx.body.prompt) || '').slice(0, 120), nodes: [{ id: 'n1', type: 'tool', tool: 'nmap_scan' }] });
  });
  M.route('GET', '/api/workflows/runs', function (ctx) {
    const workflow = ctx.query.get('workflowId'), status = ctx.query.get('status');
    const all = (M.state.workflowRuns ?? []).map(r => r.run).filter(r => (!workflow || r.workflow_id === workflow) && (!status || r.status === status)).sort((a, b) => b.started_at.localeCompare(a.started_at));
    const offset = Number(ctx.query.get('offset')) || 0, limit = Number(ctx.query.get('limit')) || 50;
    return M.ok({ runs: all.slice(offset, offset + limit), hasMore: all.length > offset + limit });
  });
  M.route('GET', '/api/workflows/runs/pending', function () { return M.ok({ runs: (M.state.workflowRuns ?? []).map(r => r.run).filter(r => r.status === 'awaiting_hitl') }); });
  M.route('GET', '/api/workflows/runs/:runId', function (ctx) { const found = M.state.workflowRuns?.find(r => r.run.id === ctx.params.runId); return found ? M.ok(found) : M.fail(404, 'Run not found'); });
  M.route('GET', '/api/workflows/runs/:runId/replay', function (ctx) { return M.ok({ id: ctx.params.runId, events: [] }); });
  M.route('POST', '/api/workflows/runs/:runId/resume', z.object({ approved: z.boolean(), comment: z.string().optional() }), function (ctx) {
    const found = M.state.workflowRuns?.find(r => r.run.id === ctx.params.runId); if (!found) return M.fail(404, 'Run not found');
    if (found.run.status !== 'awaiting_hitl') return M.fail(400, 'Run is not awaiting approval');
    found.run.status = ctx.body.approved ? 'completed' : 'rejected'; found.run.finished_at = M.nowISO(); found.run.output_json = JSON.stringify({ result: 'Demo workflow execution' });
    found.nodeRuns.forEach(n => { n.status = ctx.body.approved ? 'completed' : 'rejected'; n.finished_at = M.nowISO(); }); M.save();
    const input = z.object({ queueId: z.string().optional(), taskId: z.string().optional() }).parse(JSON.parse(found.run.input_json) as unknown);
    const queue = M.state.batchQueues.find(q => q.id === input.queueId), task = queue?.tasks.find(t => t.id === input.taskId);
    if (task && queue) { task.status = ctx.body.approved ? 'completed' : 'cancelled'; task.completedAt = M.nowISO(); task.result = 'Demo workflow execution'; if (!queue.tasks.some(t => t.status === 'running' || t.status === 'pending')) { queue.status = 'completed'; queue.completedAt = M.nowISO(); } }
    M.save();
    return M.ok({ workflowRunId: found.run.id, status: found.run.status });
  });
  M.route('GET', '/api/workflows/:id/package', function () { return M.blob('{"demo":true}', 'application/json', 'workflow-demo.json'); });
  M.route('GET', '/api/workflows/:id', function (ctx) {
    const w = M.state.workflows.find(x => x.id === ctx.params.id);
    return w ? M.ok(wfView(w)) : M.fail(404, 'Workflow not found');
  });
  M.route('POST', '/api/workflow-package-inspections', function () { return M.ok({ inspectionId: M.id('insp'), status: 'ok', issues: [] }); });
  M.route('GET', '/api/workflow-package-inspections/:inspectionId', function (ctx) { return M.ok({ inspectionId: ctx.params.inspectionId, status: 'ok', issues: [] }); });
  M.route('POST', '/api/workflow-package-imports', function () { return M.ok({ importId: M.id('imp'), status: 'imported' }); });
  M.route('GET', '/api/workflow-package-imports/:importId', function (ctx) { return M.ok({ importId: ctx.params.importId, status: 'imported' }); });

  /* ---------- C2 (demo listeners/sessions/tasks, live events) ---------- */

  // Session and task shapes follow c2.js (camelCase fields).
  function c2Store() {
    M.state.c2 = M.state.c2 || {
      sessions: [{
        id: 'sess-1', implantUuid: '9f2c-demo-0001', hostname: 'lab-host-01', username: 'labuser', os: 'linux', arch: 'amd64',
        pid: 4120, processName: 'agent', isAdmin: false, internalIp: '192.0.2.44', externalIp: '198.51.100.44',
        status: 'sleeping', lastCheckIn: M.isoAgo(3), sleepSeconds: 30, jitterPercent: 10, note: 'Demo session on the lab host',
        listenerId: 'lst-1', listenerName: 'lab-https', metadata: {},
      }],
      tasks: [{ id: 'task-c2-1', sessionId: 'sess-1', taskType: 'shell', payload: { command: 'whoami' }, command: 'whoami', status: 'success', resultText: 'labuser (demo)', output: 'labuser (demo)', source: 'manual', createdAt: M.isoAgo(20), completedAt: M.isoAgo(19) }],
      events: [{ id: 'ev-1', type: 'session', level: 'info', category: 'session', sessionId: 'sess-1', message: 'Session sess-1 checked in (demo)', createdAt: M.isoAgo(3) }],
      profiles: [{ id: 'prof-1', name: 'default', userAgent: 'Mozilla/5.0 (demo)', uris: ['/api/v1/status'], jitterMinMs: 100, jitterMaxMs: 500, responseHeaders: { Server: 'nginx' }, bodyTemplate: '' }],
    };
    return M.state.c2;
  }

  M.route('GET', '/api/c2/listeners', function () { return M.ok({ listeners: M.state.c2Listeners, total: M.state.c2Listeners.length }); });
  M.route('POST', '/api/c2/listeners', bodies.listener, function (ctx) {
    const b = ctx.body || {};
    const l = Object.assign({ id: M.id('lst'), status: 'stopped', created_at: M.nowISO(), createdAt: M.nowISO(), profile: 'default' }, b, { bindHost: b.bind_host, bindPort: b.bind_port, profileId: b.profile_id, project_id: b.project_id, configJson: JSON.stringify({ ...(b.config || {}), callback_host: b.callback_host || '' }) });
    M.state.c2Listeners.push(l);
    M.save();
    return M.ok(l);
  });
  M.route('GET', '/api/c2/listeners/:id', function (ctx) {
    const f = M.findById(M.state.c2Listeners, ctx.params.id);
    return f ? M.ok(f.item) : M.fail(404, 'Listener not found');
  });
  M.route('PUT', '/api/c2/listeners/:id', bodies.listener, function (ctx) {
    const f = M.findById(M.state.c2Listeners, ctx.params.id);
    if (!f) return M.fail(404, 'Listener not found');
    const b = ctx.body || {};
    M.mergeInto(f.item, { ...b, bindHost: b.bind_host, bindPort: b.bind_port, profileId: b.profile_id, project_id: b.project_id, configJson: JSON.stringify({ ...(b.config || {}), callback_host: b.callback_host || '' }) }, ['name', 'remark', 'bindHost', 'bindPort', 'profileId', 'project_id', 'configJson']);
    M.save();
    return M.ok(f.item);
  });
  M.route('DELETE', '/api/c2/listeners/:id', function (ctx) {
    M.state.c2Listeners = M.state.c2Listeners.filter(function (l) { return l.id !== ctx.params.id; });
    M.save();
    return M.ok({ success: true });
  });
  M.route('POST', '/api/c2/listeners/:id/start', function (ctx) {
    const f = M.findById(M.state.c2Listeners, ctx.params.id);
    if (f) { f.item.status = 'running'; M.save(); }
    return M.ok({ success: true, status: 'running' });
  });
  M.route('POST', '/api/c2/listeners/:id/stop', function (ctx) {
    const f = M.findById(M.state.c2Listeners, ctx.params.id);
    if (f) { f.item.status = 'stopped'; M.save(); }
    return M.ok({ success: true, status: 'stopped' });
  });

  M.route('GET', '/api/c2/sessions', function (ctx) { const q = ctx.query; const search = (q.get('search') || '').toLowerCase(); const sessions = c2Store().sessions.filter(s => (!q.get('listener_id') || s.listenerId === q.get('listener_id')) && (!q.get('status') || s.status === q.get('status')) && [s.hostname, s.username, s.internalIp].join(' ').toLowerCase().includes(search)); return M.ok({ sessions, total: sessions.length }); });
  M.route('GET', '/api/c2/sessions/:id', function (ctx) {
    const s = c2Store().sessions.filter(function (x) { return x.id === ctx.params.id; })[0];
    return s ? M.ok({ session: s }) : M.fail(404, 'Session not found');
  });
  M.route('DELETE', '/api/c2/sessions', bodies.ids, function (ctx) {
    const ids = (ctx.body && ctx.body.ids) || [];
    c2Store().sessions = c2Store().sessions.filter(function (x) { return ids.indexOf(x.id) === -1; });
    M.save();
    return M.ok({ success: true, deleted: ids.length });
  });
  M.route('DELETE', '/api/c2/sessions/:id', function (ctx) {
    c2Store().sessions = c2Store().sessions.filter(function (x) { return x.id !== ctx.params.id; });
    M.save();
    return M.ok({ success: true });
  });
  M.route('PUT', '/api/c2/sessions/:id/note', bodies.note, function (ctx) {
    const s = c2Store().sessions.filter(function (x) { return x.id === ctx.params.id; })[0];
    if (s) s.note = (ctx.body && ctx.body.note) || '';
    M.save();
    return M.ok({ success: true });
  });
  M.route('PUT', '/api/c2/sessions/:id/sleep', bodies.sleep, function (ctx) { const s = c2Store().sessions.find(s => s.id === ctx.params.id); if (s) { s.sleepSeconds = ctx.body.sleep_seconds ?? s.sleepSeconds; s.jitterPercent = ctx.body.jitter_percent ?? s.jitterPercent; M.save(); } return M.ok({ success: true }); });
  M.route('POST', '/api/c2/sessions/:id/tasks', bodies.c2Task, function (ctx) {
    const t = { id: M.id('task'), session: ctx.params.id, command: (ctx.body && ctx.body.command) || '', status: 'queued', output: '', created_at: M.nowISO() };
    c2Store().tasks.unshift(t);
    M.save();
    return M.ok(t);
  });
  M.route('GET', '/api/c2/tasks', function (ctx) {
    const q = ctx.query; const tasks = c2Store().tasks.filter(t => (!q.get('session_id') || t.sessionId === q.get('session_id')) && (!q.get('status') || t.status === q.get('status')) && (!q.get('task_type') || t.taskType === q.get('task_type')) && (!q.get('since') || Date.parse(t.createdAt || '') >= Date.parse(q.get('since')!)));
    const counts = { success: 0, failed: 0, pending: 0, cancelled: 0 }; for (const t of tasks) { if (t.status === 'success') counts.success++; else if (t.status === 'failed') counts.failed++; else if (t.status === 'cancelled') counts.cancelled++; else counts.pending++; }
    const size = Number(q.get('page_size')) || tasks.length; const offset = ((Number(q.get('page')) || 1) - 1) * size;
    return M.ok({ tasks: tasks.slice(offset, offset + size), total: tasks.length, status_counts: counts, pending_queued_count: c2Store().tasks.filter(t => t.status === 'queued').length });
  });
  M.route('POST', '/api/c2/tasks', bodies.c2Task, function (ctx) {
    const b = ctx.body || {};
    const result = b.task_type === 'ls' ? 'd\tdrwxr-xr-x\t0\tdemo-folder\n-\t-rw-r--r--\t24\tdemo.txt' : b.task_type === 'pwd' ? '/home/labuser' : 'Demo response only; no remote command was executed.';
    const t = { id: M.id('task'), sessionId: b.session_id || '', taskType: b.task_type || '', payload: b.payload || {}, command: String(b.payload?.command || ''), status: 'success', resultText: result, output: result, source: 'manual', createdAt: M.nowISO(), completedAt: M.nowISO() };
    c2Store().tasks.unshift(t);
    M.save();
    return M.ok({ task: t });
  });
  M.route('GET', '/api/c2/tasks/:id', function (ctx) {
    const t = c2Store().tasks.filter(function (x) { return x.id === ctx.params.id; })[0];
    return t ? M.ok({ task: t }) : M.fail(404, 'Task not found');
  });
  M.route('POST', '/api/c2/tasks/:id/cancel', function (ctx) {
    const t = c2Store().tasks.filter(function (x) { return x.id === ctx.params.id; })[0];
    if (t) t.status = 'cancelled';
    M.save();
    return M.ok({ success: true });
  });
  M.route('DELETE', '/api/c2/tasks', bodies.ids, function (ctx) { const ids = ctx.body.ids || []; c2Store().tasks = c2Store().tasks.filter(t => !ids.includes(t.id)); M.save(); return M.ok({ deleted: ids.length }); });
  M.route('GET', '/api/c2/events', function (ctx) {
    const q = ctx.query; const events = c2Store().events.filter(e => (!q.get('level') || e.level === q.get('level')) && (!q.get('category') || e.category === q.get('category')) && (!q.get('session_id') || e.sessionId === q.get('session_id')) && (!q.get('since') || Date.parse(e.createdAt) >= Date.parse(q.get('since')!)));
    const counts = { info: 0, warn: 0, critical: 0 }; for (const e of events) if (e.level === 'info' || e.level === 'warn' || e.level === 'critical') counts[e.level]++;
    const size = Number(q.get('page_size')) || events.length; const offset = ((Number(q.get('page')) || 1) - 1) * size;
    return M.ok({ events: events.slice(offset, offset + size), total: events.length, level_counts: counts });
  });
  M.route('DELETE', '/api/c2/events', bodies.ids, function (ctx) { const ids = ctx.body.ids || []; c2Store().events = c2Store().events.filter(e => !ids.includes(e.id)); M.save(); return M.ok({ deleted: ids.length }); });
  M.route('GET', '/api/c2/profiles', function () { return M.ok({ profiles: c2Store().profiles }); });
  M.route('POST', '/api/c2/profiles', bodies.profile, function (ctx) {
    const p = Object.assign({ id: M.id('prof'), sleep_seconds: 30, jitter: 10 }, ctx.body || {});
    c2Store().profiles.push(p);
    M.save();
    return M.ok(p);
  });
  M.route('PUT', '/api/c2/profiles/:id', bodies.profile, function (ctx) {
    const p = c2Store().profiles.filter(function (x) { return x.id === ctx.params.id; })[0];
    if (p) M.mergeInto(p, ctx.body, ['name', 'userAgent', 'uris', 'requestHeaders', 'responseHeaders', 'bodyTemplate', 'jitterMinMs', 'jitterMaxMs', 'extra']);
    M.save();
    return M.ok(p || {});
  });
  M.route('DELETE', '/api/c2/profiles/:id', function (ctx) {
    c2Store().profiles = c2Store().profiles.filter(function (x) { return x.id !== ctx.params.id; });
    M.save();
    return M.ok({ success: true });
  });
  M.route('POST', '/api/c2/payloads/build', function () { return M.ok({ error: 'Beacon compilation is unavailable in demo mode. No binary was produced.' }); });
  M.route('POST', '/api/c2/payloads/oneliner', function () { return M.ok({ oneliner: '# Demo placeholder only; no runnable payload is produced.' }); });
  M.route('GET', '/api/c2/payloads/:id/download', function () { return M.blob('demo payload placeholder', 'application/octet-stream', 'demo-payload.bin'); });

  /* ---------- terminal (WebSocket transport is composed in the entry) ---------- */

  M.route('POST', '/api/terminal/run', bodies.command, function (ctx) {
    const cmd = String((ctx.body && ctx.body.command) || '');
    return M.ok({ command: cmd, exitCode: 0, output: 'demo output for: ' + cmd });
  });

  M.route('POST', '/api/terminal/run/stream', bodies.command, function (ctx) {
    const cmd = String((ctx.body && ctx.body.command) || '');
    return M.sse([
      { type: 'output', message: 'demo output for: ' + cmd, data: {} },
      { type: 'done', message: '', data: { exitCode: 0 } },
    ], { signal: ctx.signal, delayMs: 200 });
  });

  /* ---------- webshell ---------- */

  // The UI expects a plain array here.
  M.route('GET', '/api/webshell/connections', function () {
    return M.ok(M.state.webshells);
  });

  M.route('POST', '/api/webshell/connections', bodies.webshell, function (ctx) {
    const b = ctx.body || {};
    const c = Object.assign({ id: M.id('ws'), type: 'php', status: 'offline', created_at: M.nowISO(), password_set: !!b.password }, b);
    delete c.password;
    M.state.webshells.push(c);
    M.save();
    return M.ok(c);
  });

  M.route('PUT', '/api/webshell/connections/:id', bodies.webshell, function (ctx) {
    const f = M.findById(M.state.webshells, ctx.params.id);
    if (!f) return M.fail(404, 'Connection not found');
    M.mergeInto(f.item, ctx.body, ['name', 'url', 'type']);
    M.save();
    return M.ok(f.item);
  });

  M.route('DELETE', '/api/webshell/connections/:id', function (ctx) {
    M.state.webshells = M.state.webshells.filter(function (c) { return c.id !== ctx.params.id; });
    M.save();
    return M.ok({ success: true });
  });

  M.route('PUT', '/api/webshell/connections/:id/state', function () { return M.ok({ success: true }); });
  M.route('GET', '/api/webshell/connections/:id/state', function () { return M.ok({ state: {} }); });
  M.route('GET', '/api/webshell/connections/:id/ai-history', function () { return M.ok({ messages: [] }); });
  M.route('GET', '/api/webshell/connections/:id/ai-conversations', function () { return M.ok({ conversations: [] }); });

  M.route('POST', '/api/webshell/exec', bodies.command, function (ctx) {
    const cmd = String((ctx.body && ctx.body.command) || '');
    return M.ok({ success: true, output: 'demo: ' + cmd + '\n(no remote host contacted)' });
  });

  M.route('POST', '/api/webshell/file', bodies.path, function (ctx) {
    return M.ok({ success: true, path: (ctx.body && ctx.body.path) || '/', entries: [{ name: 'README.txt', size: 42, isDir: false }] });
  });

  /* ---------- storage / update / runtime ---------- */

  M.route('GET', '/api/storage/status', function () {
    return M.ok({ total_bytes: 2147483648, used_bytes: 734003200, reclaimable_bytes: 157286400, retention_days: 30, sections: [
      { name: 'conversations', bytes: 214000000, reclaimable_bytes: 0 },
      { name: 'monitor', bytes: 80000000, reclaimable_bytes: 40000000 },
      { name: 'logs', bytes: 120000000, reclaimable_bytes: 117286400 },
    ] });
  });
  M.route('GET', '/api/storage/meta', function () { return M.ok({ retention_days: 30, auto_cleanup: false, location: 'data/' }); });
  M.route('POST', '/api/storage/cleanup', function () { return M.ok({ freed_bytes: 157286400, message: 'Cleanup completed (demo)' }); });

  M.route('GET', '/api/system/update', function () {
    return M.ok({ current_version: 'v1.7.24', latest_version: 'v1.7.24', up_to_date: true, source: 'demo', last_checked_at: M.nowISO() });
  });
  M.route('GET', '/api/system/update/job', function () { return M.ok({ status: 'idle', progress: 0, logs: [] }); });
  M.route('POST', '/api/system/update/check', function () { return M.ok({ up_to_date: true, latest_version: 'v1.7.24' }); });
  M.route('POST', '/api/system/update/apply', function () { return M.ok({ job_id: M.id('job'), status: 'skipped (demo)' }); });
  M.route('POST', '/api/system/update/restart', function () { return M.ok({ success: true, message: 'Demo mode does not restart' }); });
  M.route('POST', '/api/system/update/rollback', function () { return M.ok({ success: true }); });
  M.route('POST', '/api/system/update/adopt', function () { return M.ok({ success: true }); });
  M.route('POST', '/api/system/update/source', function () { return M.ok({ success: true }); });

  /* ---------- FOFA / robot bridges (demo only, no outbound calls) ---------- */

  M.route('POST', '/api/fofa/parse', bodies.query, function (ctx) {
    const q = String((ctx.body && ctx.body.query) || '');
    return M.ok({ query: q, base64: btoa(unescape(encodeURIComponent(q))), fields: ['host', 'ip', 'port', 'title'] });
  });
  M.route('POST', '/api/fofa/search', bodies.query, function (ctx) {
    const rows = [
      { host: 'app.example.com', ip: '198.51.100.10', port: 443, title: 'Lab Portal' },
      { host: '198.51.100.22', ip: '198.51.100.22', port: 80, title: 'Legacy CMS' },
    ];
    return M.ok({ query: (ctx.body && ctx.body.query) || '', size: rows.length, total: rows.length, page: 1, fields: Object.keys(rows[0] || {}), results: rows });
  });

  M.route('GET', '/api/robot/wechat/status', function () { return M.ok({ enabled: false, bound: false }); });
  M.route('POST', '/api/robot/wechat/qrcode', function () { return M.ok({ qrcode: '', status: 'demo', message: 'Demo mode: no real bot connected' }); });
  M.route('GET', '/api/robot/wechat/qrcode/status', function () { return M.ok({ status: 'idle' }); });
  M.route('POST', '/api/robot/wechat/qrcode/verify', function () { return M.ok({ success: false, message: 'Demo mode' }); });
  M.route('POST', '/api/robot/test', function () { return M.ok({ success: true, message: 'Demo mode: no real message sent' }); });
  M.route('POST', '/api/robot/dingtalk', function () { return M.ok({ success: true }); });
  M.route('POST', '/api/robot/lark', function () { return M.ok({ success: true }); });
  M.route('POST', '/api/robot/wecom', function () { return M.ok({ success: true }); });
  M.route('GET', '/api/robot-bindings', function () { return M.ok({ bindings: M.state.robotBindings || [] }); });
  M.route('DELETE', '/api/robot-bindings/:id', function (ctx) {
    M.state.robotBindings = (M.state.robotBindings || []).filter(function (b) { return b.id !== ctx.params.id; });
    M.save();
    return M.ok({ success: true });
  });

  /* ---------- chat uploads (files tab) ---------- */

  // Upload records mirror collectFiles() in internal/handler/chat_uploads.go.
  function uploadRecord(name: string, relPath: string, size: number, convId: string, convTitle: string, projectId: string, projectName: string) {
    const now = Date.now();
    return {
      name: name, relativePath: relPath, subPath: relPath.indexOf('/') === -1 ? '' : relPath.slice(0, relPath.lastIndexOf('/')),
      absolutePath: '/demo/workspace/chat_uploads/' + relPath, size: size, modifiedUnix: Math.floor(now / 1000),
      date: new Date(now).toISOString().slice(0, 10), source: 'upload',
      conversationId: convId, conversationTitle: convTitle, projectId: projectId, projectName: projectName,
    };
  }

  function uploadStore() {
    M.state.chatFiles = M.state.chatFiles || {
      files: [
        uploadRecord('scan-results.txt', '2026-10-31/conv-recon-01/demo-scan/scan-results.txt', 1480, 'conv-recon-01', 'Recon of 198.51.100.0/24', 'proj-lab-web', 'Lab Web Perimeter'),
        { ...uploadRecord('assessment.md', '__conversation_artifact__/conv-recon-01/assessment.md', 2496, 'conv-recon-01', 'Recon of 198.51.100.0/24', 'proj-lab-web', 'Lab Web Perimeter'), source: 'conversation_artifact', subPath: '', absolutePath: '/demo/data/conversation_artifacts/conv-recon-01/assessment.md' },
        { ...uploadRecord('hosts.json', '__workspace__/projects/proj-lab-web/results/hosts.json', 3200, '', '', 'proj-lab-web', 'Lab Web Perimeter'), source: 'workspace', subPath: 'results', absolutePath: '/demo/tmp/workspace/projects/proj-lab-web/results/hosts.json' },
        { ...uploadRecord('recon.log', '__reduction__/projects/proj-lab-web/recon.log', 8640, '', '', 'proj-lab-web', 'Lab Web Perimeter'), source: 'reduction', subPath: '', absolutePath: '/demo/tmp/tool_outputs/projects/proj-lab-web/recon.log' },
        uploadRecord('notes.md', 'notes.md', 612, 'conv-api-03', 'API auth logic review', 'proj-internal-api', 'Internal API Review'),
      ],
      folders: [{ name: 'demo-scan', relativePath: '2026-10-31/conv-recon-01/demo-scan', subPath: '', conversationId: 'conv-recon-01', projectId: 'proj-lab-web' }, { name: 'evidence', relativePath: '2026-10-31/conv-recon-01/evidence', subPath: '', conversationId: 'conv-recon-01', projectId: 'proj-lab-web' }],
    };
    return M.state.chatFiles;
  }

  M.route('GET', '/api/chat-uploads', function (ctx) {
    const store = uploadStore();
    // Backend filters by `conversation` (internal/handler/chat_uploads.go).
    const convFilter = M.q(ctx, 'conversation', M.q(ctx, 'conversation_id', ''));
    const projFilter = M.q(ctx, 'project', M.q(ctx, 'project_id', ''));
    const nameFilter = M.q(ctx, 'name', M.q(ctx, 'search', '')).toLowerCase();
    const files = store.files.filter(function (f) {
      return (!convFilter || f.conversationId === convFilter) && (!projFilter || f.projectId === projFilter) &&
        (!nameFilter || f.name.toLowerCase().indexOf(nameFilter) !== -1);
    });
    const page = M.pagePaged(files, ctx, 20);
    return M.ok({ files: M.q(ctx, 'pageSize', '') === 'all' ? files : page.items, folders: store.folders.filter(folder => (!projFilter || folder.projectId === projFilter) && (!convFilter || folder.conversationId === convFilter)).map(folder => folder.relativePath), total: page.total, page: page.page, pageSize: page.pageSize });
  });

  M.route('GET', '/api/chat-uploads/content', function (ctx) {
    const rel = M.q(ctx, 'path', '');
    const f = uploadStore().files.filter(function (x) { return x.relativePath === rel; })[0];
    return M.ok({ content: f ? 'Demo content of ' + f.name + '\n' : '' });
  });

  M.route('PUT', '/api/chat-uploads/content', function () { return M.ok({ ok: true }); });

  M.route('GET', '/api/chat-uploads/download', function (ctx) {
    return M.blob('demo file', 'text/plain', M.q(ctx, 'path', 'download.txt').split('/').pop());
  });

  M.route('GET', '/api/chat-uploads/export', function () { return M.blob('demo export', 'application/zip', 'chat-uploads-demo.zip'); });

  M.route('GET', '/api/chat-uploads/path', function (ctx) {
    return M.ok({ absolutePath: '/demo/workspace/chat_uploads/' + M.q(ctx, 'path', ''), isDir: false });
  });

  M.route('POST', '/api/chat-uploads', bodies.upload, function (ctx) {
    const names: string[] = [];
    ctx.body.getAll('file').forEach(function (f) { if (f instanceof File) names.push(f.name); });
    const convId = String(ctx.body.get('conversationId') || '');
    const dir = String(ctx.body.get('relativeDir') || '');
    const folder = uploadStore().folders.find(folder => folder.relativePath === dir);
    const conversation = M.state.conversations.find(item => item.id === (convId || folder?.conversationId || dir.split('/')[1]));
    const project = M.state.projects.find(item => item.id === conversation?.projectId);
    names.forEach(function (n) {
      const target = dir || new Date().toISOString().slice(0, 10) + '/' + convId;
      uploadStore().files.unshift(uploadRecord(n, target + '/' + n, 256, conversation?.id || '', conversation?.title || '', project?.id || '', project?.name || ''));
    });
    M.save();
    return M.ok({ ok: true, uploaded: names.length });
  });

  M.route('POST', '/api/chat-uploads/mkdir', bodies.filesMkdir, function (ctx) {
    const rel = [ctx.body.parent, ctx.body.name].filter(Boolean).join('/');
    const conversation = M.state.conversations.find(item => item.id === rel.split('/')[1]);
    uploadStore().folders.push({ name: ctx.body.name, relativePath: rel, subPath: '', conversationId: conversation?.id || '', projectId: conversation?.projectId || '' });
    M.save();
    return M.ok({ ok: true, relativePath: rel });
  });

  M.route('PUT', '/api/chat-uploads/rename', bodies.filesRename, function (ctx) {
    const b = ctx.body || {};
    const f = uploadStore().files.filter(function (x) { return x.relativePath === b.path; })[0];
    if (f) { f.relativePath = f.relativePath.split('/').slice(0, -1).concat(b.newName).join('/'); f.name = b.newName; }
    M.save();
    return M.ok({ ok: true, relativePath: f ? f.relativePath : '' });
  });

  M.route('DELETE', '/api/chat-uploads', bodies.filesDelete, function (ctx) {
    const rel = ctx.body.path;
    const store = uploadStore();
    store.files = store.files.filter(function (f) { return f.relativePath !== rel && !f.relativePath.startsWith(rel + '/'); });
    store.folders = store.folders.filter(folder => folder.relativePath !== rel && !folder.relativePath.startsWith(rel + '/'));
    M.save();
    return M.ok({ ok: true });
  });

  M.route('GET', '/api/files', function () { return M.ok({ files: uploadStore().files }); });
  M.route('POST', '/api/files/upload', function () { return M.ok({ ok: true }); });

  M.route('GET', '/api/info-collect', function () { return M.ok({ items: [] }); });

  M.route('GET', '/api/conversations/:id/attack-chain', function () { return M.ok({ nodes: [], edges: [] }); });

  M.route('GET', '/api/events', function () { return M.ok({ events: [] }); });
}
