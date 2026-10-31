/*
 * Findings and engagement data: dashboard, projects, vulnerabilities, assets,
 * batch task queues, HITL, execution monitor, notifications, audit, token usage.
 */
import type { MockRuntime } from '../runtime';
import type { Context } from '../router';
import type { Execution, Project, Queue, Vulnerability } from '../types';
import { bodies } from '../bodies';
import type { z } from 'zod';
import { formatMarkdown } from '../../features/vulnerability/markdown';
import { translateRuntime } from '../../i18n';

export function registerSecurity(M: MockRuntime): void {

  /* ---------- dashboard / stats ---------- */

  function vulnStats(list: Vulnerability[]) {
    const bySeverity: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    list.forEach(function (v) {
      bySeverity[v.severity] = (bySeverity[v.severity] || 0) + 1;
      byStatus[v.status] = (byStatus[v.status] || 0) + 1;
    });
    return { total: list.length, by_severity: bySeverity, by_status: byStatus };
  }

  M.route('GET', '/api/vulnerabilities/stats', function (ctx) {
    return M.ok(vulnStats(filteredVulnerabilities(ctx)));
  });

  M.route('GET', '/api/vulnerabilities/filter-options', function () {
    return M.ok({
      severities: ['critical', 'high', 'medium', 'low', 'info'],
      statuses: ['open', 'confirmed', 'fixed', 'false_positive', 'retest'],
      types: unique(M.state.vulnerabilities.map(function (v) { return v.type; })),
      targets: unique(M.state.vulnerabilities.map(function (v) { return v.target; })),
      conversation_ids: unique(M.state.vulnerabilities.map(function (v) { return v.conversation_id; })),
      project_ids: unique(M.state.vulnerabilities.map(function (v) { return v.project_id; })),
      conversation_tags: [], task_tags: [], queue_ids: [], task_ids: [], vulnerability_ids: [],
    });
  });

  function unique(arr: string[]) {
    return arr.filter(function (v, i, a) { return v && a.indexOf(v) === i; });
  }

  // Shape matches token-usage.js: summary, byDay (key = YYYY-MM-DD), byModel, recent.
  M.route('GET', '/api/usage/tokens', function (ctx) {
    const days = Math.max(1, M.qInt(ctx, 'days', 7));
    const byDay = [];
    for (let i = days - 1; i >= 0; i--) {
      const key = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      const base = 9000 + ((i * 2741) % 7000);
      byDay.push({ key: key, events: 4 + (i % 5), modelCalls: 3 + (i % 4), promptTokens: Math.round(base * 0.75), completionTokens: Math.round(base * 0.25), cachedTokens: Math.round(base * 0.3), cacheWriteTokens: Math.round(base * 0.05), reasoningTokens: Math.round(base * 0.1), totalTokens: base });
    }
    const byModel = [
      { key: 'demo-large', label: 'demo-large', events: 260, modelCalls: 260, promptTokens: 140200, completionTokens: 48100, cachedTokens: 52000, cacheWriteTokens: 4100, reasoningTokens: 9800, totalTokens: 188300 },
      { key: 'demo-small', label: 'demo-small', events: 152, modelCalls: 152, promptTokens: 42200, completionTokens: 13130, cachedTokens: 12000, cacheWriteTokens: 900, reasoningTokens: 0, totalTokens: 55330 },
    ];
    const summary = byModel.reduce<Record<string, number>>(function (acc, r) {
      Object.entries(r).forEach(function ([k, value]) { if (typeof value === 'number') acc[k] = (acc[k] || 0) + value; });
      return acc;
    }, {});
    summary.modelCalls = summary.modelCalls || 0;
    return M.ok({
      summary: summary,
      byDay: byDay,
      byModel: byModel,
      recent: [
        { createdAt: M.isoAgo(12), model: 'demo-large', reason: 'final', totalTokens: 7420, modelCalls: 3 },
        { createdAt: M.isoAgo(64), model: 'demo-small', reason: 'final', totalTokens: 1180, modelCalls: 1 },
        { createdAt: M.isoAgo(180), model: 'demo-large', reason: 'partial', totalTokens: 3050, modelCalls: 2 },
      ],
      days: days,
    });
  });

  M.route('GET', '/api/projects/dashboard-summary', function (ctx) {
    const active = M.state.projects.filter(function (p) { return p.status === 'active'; });
    const facts = (M.state.facts || []).slice(0, M.qInt(ctx, 'fact_limit', 5));
    return M.ok({
      active_projects: active.length,
      total_facts: (M.state.facts || []).length,
      recent_facts: facts,
      totals: {
        projects: M.state.projects.length,
        conversations: M.state.conversations.length,
        vulnerabilities: M.state.vulnerabilities.length,
        assets: M.state.assets.length,
        open_vulnerabilities: M.state.vulnerabilities.filter(function (v) { return v.status === 'open'; }).length,
      },
    });
  });

  M.route('GET', '/api/notifications/summary', function () {
    const unread = M.state.notifications.filter(function (n) { return !n.read; });
    return M.ok({ unread: unread.length, total: M.state.notifications.length, items: M.state.notifications.slice(0, 5) });
  });

  M.route('GET', '/api/notifications', function () {
    return M.ok({ notifications: M.state.notifications, total: M.state.notifications.length });
  });

  M.route('POST', '/api/notifications/read', bodies.ids, function (ctx) {
    const ids = (ctx.body && ctx.body.ids) || [];
    M.state.notifications.forEach(function (n) { if (!ids.length || ids.indexOf(n.id) !== -1) n.read = true; });
    M.save();
    return M.ok({ success: true });
  });

  /* ---------- projects ---------- */

  function projectView(p: Project) {
    const convs = M.state.conversations.filter(function (c) { return c.projectId === p.id; }).length;
    const vulns = M.state.vulnerabilities.filter(function (v) { return v.project_id === p.id; }).length;
    const assets = M.state.assets.filter(function (a) { return a.project_id === p.id; }).length;
    return {
      id: p.id, name: p.name, description: p.description, scope_json: p.scope_json, status: p.status,
      pinned: !!p.pinned, created_at: p.created_at, updated_at: p.updated_at,
      conversation_count: convs, vulnerability_count: vulns, asset_count: assets,
    };
  }
  M.projectView = projectView;

  M.route('GET', '/api/projects', function (ctx) {
    const list = M.filterList(M.state.projects, ctx, { searchKey: 'search', searchFields: ['name', 'description'], filters: { status: 'status' } });
    list.sort(function (a, b) { return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (a.updated_at < b.updated_at ? 1 : -1); });
    const page = M.limitOffset(list, ctx, 20);
    return M.ok({ projects: page.items.map(projectView), total: page.total, limit: page.limit, offset: page.offset });
  });

  M.route('POST', '/api/projects', bodies.project, function (ctx) {
    const b = ctx.body || {};
    if (!b.name) return M.fail(400, 'Project name is required');
    const p = { id: M.id('proj'), name: b.name, description: b.description || '', scope_json: b.scope_json || '{}', status: 'active', pinned: false, created_at: M.nowISO(), updated_at: M.nowISO() };
    M.state.projects.unshift(p);
    M.save();
    return M.ok(projectView(p));
  });

  M.route('GET', '/api/projects/:id', function (ctx) {
    const found = M.findById(M.state.projects, ctx.params.id);
    if (!found) return M.fail(404, 'Project not found');
    return M.ok(projectView(found.item));
  });

  M.route('PUT', '/api/projects/:id', bodies.project, function (ctx) {
    const found = M.findById(M.state.projects, ctx.params.id);
    if (!found) return M.fail(404, 'Project not found');
    M.mergeInto(found.item, ctx.body, ['name', 'description', 'scope_json', 'status', 'pinned']);
    found.item.updated_at = M.nowISO();
    M.save();
    return M.ok(projectView(found.item));
  });

  M.route('DELETE', '/api/projects/:id', function (ctx) {
    const found = M.findById(M.state.projects, ctx.params.id);
    if (!found) return M.fail(404, 'Project not found');
    M.removeAt(M.state.projects, found.index);
    M.state.conversations.forEach(function (c) { if (c.projectId === ctx.params.id) c.projectId = ''; });
    M.save();
    return M.ok({ success: true });
  });

  M.route('GET', '/api/projects/:id/conversations', function (ctx) {
    const list = M.state.conversations.filter(function (c) { return c.projectId === ctx.params.id; });
    const page = M.limitOffset(list, ctx, 50);
    return M.ok({ conversations: page.items.map(M.convView ? function (c) { return M.convView(c, false); } : function (c) { return c; }), total: page.total, limit: page.limit, offset: page.offset });
  });

  // Project facts: the UI expects a plain array from /facts and {nodes, edges} from /fact-graph.
  function projectFacts(pid: string) {
    return (M.state.facts || []).filter(function (f) { return f.project_id === pid; });
  }

  function factEdges(pid: string) {
    return (M.state.factEdges || []).filter(function (e) { return e.project_id === pid; });
  }

  M.route('GET', '/api/projects/:id/stats', function (ctx) {
    const pid = ctx.params.id;
    const vulns = M.state.vulnerabilities.filter(function (v) { return v.project_id === pid; });
    return M.ok({
      fact_count: projectFacts(pid).filter(function (f) { return !f.deprecated; }).length,
      vuln_count: vulns.length,
      conversation_count: M.state.conversations.filter(function (c) { return c.projectId === pid; }).length,
      asset_count: M.state.assets.filter(function (a) { return a.project_id === pid; }).length,
      vulnerability_stats: vulnStats(vulns),
    });
  });

  M.route('GET', '/api/projects/:id/facts', function (ctx) {
    let list = projectFacts(ctx.params.id);
    const q = M.q(ctx, 'q', M.q(ctx, 'search', ''));
    if (q) list = list.filter(function (f) { return M.matchSearch(f, q, ['fact_key', 'summary', 'body', 'category']); });
    if (M.q(ctx, 'category', '')) list = list.filter(function (f) { return f.category === M.q(ctx, 'category', ''); });
    if (M.q(ctx, 'confidence', '')) list = list.filter(function (f) { return f.confidence === M.q(ctx, 'confidence', ''); });
    if (M.q(ctx, 'hide_deprecated', '') === 'true') list = list.filter(function (f) { return !f.deprecated; });
    if (M.q(ctx, 'exclude_deprecated', '') === 'true') list = list.filter(f => !f.deprecated);
    if (M.q(ctx, 'related_vulnerability_id', '')) list = list.filter(f => f.related_vulnerability_id === M.q(ctx, 'related_vulnerability_id', ''));
    return M.ok(list);
  });

  M.route('POST', '/api/projects/:id/facts', bodies.fact, function (ctx) {
    const b = ctx.body || {};
    M.state.facts = M.state.facts || [];
    const f = {
      id: M.id('fact'), project_id: ctx.params.id, fact_key: b.fact_key || 'note-' + M.id('k').slice(-4), category: b.category || 'note',
      summary: b.summary || '', body: b.body || '', confidence: b.confidence || 'medium', pinned: false, deprecated: false,
      incoming_links: 0, related_vulnerability_id: b.related_vulnerability_id || '', source_conversation_id: b.source_conversation_id || '',
      updated_at: M.nowISO(),
    };
    M.state.facts.unshift(f);
    M.save();
    return M.ok(f);
  });

  M.route('PUT', '/api/projects/:id/facts/:factId', bodies.fact, function (ctx) {
    const f = (M.state.facts || []).filter(function (x) { return x.id === ctx.params.factId; })[0];
    if (!f) return M.fail(404, 'Fact not found');
    M.mergeInto(f, ctx.body, ['summary', 'body', 'category', 'confidence', 'pinned', 'fact_key']);
    f.updated_at = M.nowISO();
    M.save();
    return M.ok(f);
  });

  M.route('DELETE', '/api/projects/:id/facts/:factId', function (ctx) {
    M.state.facts = (M.state.facts || []).filter(function (x) { return x.id !== ctx.params.factId; });
    M.save();
    return M.ok({ success: true });
  });

  function setDeprecated(ctx: Context<z.infer<typeof bodies.factKeys>>, value: boolean) {
    const keys = ((ctx.body && ctx.body.fact_keys) || []).concat((ctx.body && ctx.body.ids) || []);
    (M.state.facts || []).forEach(function (f) {
      if (f.project_id === ctx.params.id && (keys.indexOf(f.fact_key) !== -1 || keys.indexOf(f.id) !== -1)) f.deprecated = value;
    });
    M.save();
    return M.ok({ success: true });
  }
  M.route('POST', '/api/projects/:id/facts/deprecate', bodies.factKeys, function (ctx) { return setDeprecated(ctx, true); });
  M.route('POST', '/api/projects/:id/facts/restore', bodies.factKeys, function (ctx) { return setDeprecated(ctx, false); });

  M.route('GET', '/api/projects/:id/fact-edges', function (ctx) {
    return M.ok(factEdges(ctx.params.id));
  });

  M.route('POST', '/api/projects/:id/fact-edges', bodies.edge, function (ctx) {
    M.state.factEdges = M.state.factEdges || [];
    const b = ctx.body || {};
    const e = {
      id: M.id('edge'), project_id: ctx.params.id,
      source: b.source_fact_key || '', target: b.target_fact_key || '', source_fact_key: b.source_fact_key || '', target_fact_key: b.target_fact_key || '',
      type: b.edge_type || 'related', edge_type: b.edge_type || 'related', confidence: 'medium',
    };
    M.state.factEdges.push(e);
    M.save();
    return M.ok(e);
  });

  M.route('DELETE', '/api/projects/:id/fact-edges/:edgeId', function (ctx) {
    M.state.factEdges = (M.state.factEdges || []).filter(function (e) { return e.id !== ctx.params.edgeId; });
    M.save();
    return M.ok({ success: true });
  });

  M.route('GET', '/api/projects/:id/fact-graph', function (ctx) {
    const facts = projectFacts(ctx.params.id).filter(function (f) { return !f.deprecated; });
    return M.ok({
      nodes: facts.map(function (f) {
        return { id: f.fact_key, fact_key: f.fact_key, label: f.fact_key, summary: f.summary, category: f.category, type: f.category, confidence: f.confidence };
      }),
      edges: factEdges(ctx.params.id).map(function (e) {
        return { id: e.id, source: e.source, target: e.target, type: e.type, confidence: e.confidence };
      }),
    });
  });

  M.route('POST', '/api/projects/:id/promote-attack-chain/:conversationId', function (ctx) {
    return M.ok({ success: true, conversationId: ctx.params.conversationId, facts_created: 2 });
  });

  /* ---------- vulnerabilities ---------- */

  function filteredVulnerabilities(ctx: Context) {
    let list = M.filterList(M.state.vulnerabilities, ctx, {
      searchKey: 'search',
      searchFields: ['title', 'target', 'type', 'description'],
      filters: { id: 'id', severity: 'severity', status: 'status', project_id: 'project_id', conversation_id: 'conversation_id', task_id: 'task_id', conversation_tag: 'conversation_tag', task_tag: 'task_tag' },
    });
    const q = M.q(ctx, 'q', '');
    if (q) list = list.filter(function (v) { return M.matchSearch(v, q, ['title', 'target', 'type', 'description']); });
    return list;
  }
  M.route('GET', '/api/vulnerabilities', function (ctx) {
    const list = filteredVulnerabilities(ctx);
    const page = M.pagePaged(list, ctx, 20);
    const limit = M.qInt(ctx, 'limit', 0);
    let rows = page.items;
    if (limit) { const offset = M.qInt(ctx, 'offset', Math.max(0, M.qInt(ctx, 'page', 1) - 1) * limit); rows = list.slice(offset, offset + limit); }
    const pageSize = limit || page.pageSize;
    return M.ok({ vulnerabilities: rows, total: list.length, page: page.page, page_size: pageSize, total_pages: Math.max(1, Math.ceil(list.length / pageSize)) });
  });

  M.route('POST', '/api/vulnerabilities', bodies.vulnerability, function (ctx) {
    const b = ctx.body || {};
    if (!b.title) return M.fail(400, 'Title is required');
    const v = Object.assign({
      id: M.id('vuln'), conversation_id: '', project_id: '', title: '', description: '', severity: 'medium', status: 'open',
      type: '', target: '', preconditions: '', reproduction_steps: '', evidence: '', impact: '', recommendation: '',
      retest_notes: '', retest_log: '', created_at: M.nowISO(), updated_at: M.nowISO(),
    }, b);
    M.state.vulnerabilities.unshift(v);
    M.save();
    return M.ok(v);
  });

  M.route('GET', '/api/vulnerabilities/export', function (ctx) {
    const list = filteredVulnerabilities(ctx);
    if (M.q(ctx, 'mode', '') === 'summary') {
      const groups = new Map<string, Vulnerability[]>();
      list.forEach(v => { const key = v.conversation_id || 'standalone'; groups.set(key, [...(groups.get(key) || []), v]); });
      return M.ok({ files: [...groups].map(([key, items]) => ({ filename: `findings-${key}.md`, content: items.map(v => formatMarkdown(v, translateRuntime, 'en-US')).join('\n\n---\n\n') })) });
    }
    const format = M.q(ctx, 'format', 'json');
    if (format === 'csv') {
      const header = 'id,title,severity,status,target';
      const rows = list.map(function (v) { return [v.id, v.title, v.severity, v.status, v.target].map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(','); });
      return M.blob([header].concat(rows).join('\n'), 'text/csv', 'vulnerabilities-demo.csv');
    }
    return M.blob(JSON.stringify({ vulnerabilities: list }, null, 2), 'application/json', 'vulnerabilities-demo.json');
  });

  M.route('DELETE', '/api/vulnerabilities/batch', bodies.ids, function (ctx) {
    const ids = ctx.body.ids || filteredVulnerabilities(ctx).map(v => v.id);
    const before = M.state.vulnerabilities.length;
    M.state.vulnerabilities = M.state.vulnerabilities.filter(function (v) { return ids.indexOf(v.id) === -1; });
    M.save();
    return M.ok({ message: 'Deleted', deleted: before - M.state.vulnerabilities.length });
  });

  M.route('GET', '/api/vulnerabilities/:id', function (ctx) {
    const found = M.findById(M.state.vulnerabilities, ctx.params.id);
    if (!found) return M.fail(404, 'Vulnerability not found');
    return M.ok(found.item);
  });

  M.route('PUT', '/api/vulnerabilities/:id', bodies.vulnerability, function (ctx) {
    const found = M.findById(M.state.vulnerabilities, ctx.params.id);
    if (!found) return M.fail(404, 'Vulnerability not found');
    M.mergeInto(found.item, ctx.body);
    found.item.updated_at = M.nowISO();
    M.save();
    return M.ok(found.item);
  });

  M.route('DELETE', '/api/vulnerabilities/:id', function (ctx) {
    const found = M.findById(M.state.vulnerabilities, ctx.params.id);
    if (!found) return M.fail(404, 'Vulnerability not found');
    M.removeAt(M.state.vulnerabilities, found.index);
    M.save();
    return M.ok({ message: 'Deleted' });
  });

  M.route('POST', '/api/vulnerabilities/:id/retest', bodies.prompt, function (ctx) {
    const found = M.findById(M.state.vulnerabilities, ctx.params.id);
    if (!found) return M.fail(404, 'Vulnerability not found');
    const source = M.findById(M.state.conversations, found.item.conversation_id)?.item;
    if (!source) return M.fail(400, 'Retest requires a source conversation');
    const prompt = ctx.body.prompt?.trim();
    if (!prompt) return M.fail(400, 'A verification prompt is required');
    const conversation = { ...source, id: M.id('conv'), title: `Retest: ${found.item.title}`, createdAt: M.nowISO(), updatedAt: M.nowISO() };
    M.state.conversations.unshift(conversation);
    M.state.messages.filter(message => message.conversationId === source.id).forEach(message => M.state.messages.push({ ...message, id: M.id('msg'), conversationId: conversation.id }));
    M.save();
    return M.ok({ conversation, prompt });
  });

  M.route('PUT', '/api/vulnerability-alerts/subscription', bodies.alert, function (ctx) {
    M.state.alertSubscription = Object.assign({ enabled: false, minSeverity: 'high' }, ctx.body || {});
    M.save();
    return M.ok(M.state.alertSubscription);
  });

  M.route('GET', '/api/vulnerability-alerts/subscription', function () {
    return M.ok(M.state.alertSubscription || { enabled: false, minSeverity: 'high' });
  });

  /* ---------- assets ---------- */

  function filteredAssets(ctx: Context) {
    const q = ctx.query;
    const textFields = ['host', 'ip', 'domain', 'title', 'server', 'protocol', 'tags', 'business_system'] as const;
    const exactFields = ['project_id', 'status', 'criticality', 'environment', 'protocol', 'risk_level', 'source', 'country', 'province', 'city', 'responsible_person', 'department', 'business_system'] as const;
    const list = M.state.assets.filter(asset => {
      if (q.get('q') && !textFields.some(key => String(asset[key] || '').toLowerCase().includes(q.get('q')!.toLowerCase()))) return false;
      if (exactFields.some(key => q.get(key) && String(asset[key] || '').toLowerCase() !== q.get(key)!.toLowerCase())) return false;
      if (q.get('tag') && !asset.tags?.includes(q.get('tag')!)) return false;
      if (q.get('port') && Number(q.get('port')) !== asset.port) return false;
      if (q.get('min_vulnerabilities') && asset.vulnerability_count < Number(q.get('min_vulnerabilities'))) return false;
      if (q.get('max_vulnerabilities') && asset.vulnerability_count > Number(q.get('max_vulnerabilities'))) return false;
      if (q.get('scan_state') === 'never' && asset.last_scan_at) return false;
      if (q.get('scan_state') === 'scanned' && !asset.last_scan_at) return false;
      if (q.get('scan_overdue_days') && (!asset.last_scan_at || Date.parse(asset.last_scan_at) >= Date.now() - Number(q.get('scan_overdue_days')) * 86_400_000)) return false;
      for (const key of ['first_seen', 'last_seen', 'last_scan'] as const) {
        const value = asset[`${key}_at`];
        if (q.get(`${key}_after`) && (!value || Date.parse(value) < Date.parse(q.get(`${key}_after`)!))) return false;
        if (q.get(`${key}_before`) && (!value || Date.parse(value) >= Date.parse(q.get(`${key}_before`)!))) return false;
      }
      return true;
    });
    const key = q.get('sort_by') || 'last_seen_at', order = q.get('sort_order') === 'asc' ? 1 : -1;
    const rank: Record<string, number> = { unassessed: 0, normal: 1, info: 2, low: 3, medium: 4, high: 5, critical: 6 };
    return list.sort((a, b) => {
      if (key === 'risk_level') return ((rank[a.risk_level] || 0) - (rank[b.risk_level] || 0)) * order;
      if (key === 'port' || key === 'vulnerability_count') return (Number(a[key] || 0) - Number(b[key] || 0)) * order;
      const field = key as keyof typeof a; return String(a[field] || '').localeCompare(String(b[field] || '')) * order;
    });
  }
  M.route('GET', '/api/assets', function (ctx) {
    const list = filteredAssets(ctx);
    const page = M.pagePaged(list, ctx, 20);
    return M.ok({ assets: page.items, total: page.total, page: page.page, page_size: page.pageSize, total_pages: page.totalPages });
  });

  M.route('GET', '/api/assets/stats', function () {
    const list = M.state.assets;
    const byRisk: Record<string, number> = {};
    list.forEach(function (a) { byRisk[a.risk_level] = (byRisk[a.risk_level] || 0) + 1; });
    return M.ok({ total: list.length, active: list.filter(function (a) { return a.status === 'active'; }).length, by_risk_level: byRisk });
  });

  M.route('GET', '/api/assets/selection', function (ctx) {
    const assets = filteredAssets(ctx); return M.ok({ assets, total: assets.length });
  });

  M.route('POST', '/api/assets/import', bodies.assetImport, function (ctx) {
    let added = 0;
    const rows = (ctx.body && ctx.body.assets) || [];
    rows.forEach(function (row) {
      M.state.assets.push(Object.assign({ id: M.id('asset'), project_id: '', status: 'active', criticality: 'medium', created_at: M.nowISO(), updated_at: M.nowISO(), vulnerability_count: 0, risk_level: 'info', risk_score: 0 }, row));
      added += 1;
    });
    M.save();
    return M.ok({ imported: added, skipped: 0 });
  });

  M.route('POST', '/api/assets/merge', function () { return M.ok({ success: true }); });
  M.route('POST', '/api/assets/scan-links', function () { return M.ok({ success: true, links: [] }); });
  M.route('POST', '/api/assets/batch-delete', bodies.ids, function (ctx) {
    const ids = (ctx.body && ctx.body.ids) || [];
    const before = M.state.assets.length;
    M.state.assets = M.state.assets.filter(function (a) { return ids.indexOf(a.id) === -1; });
    M.save();
    return M.ok({ deleted: before - M.state.assets.length });
  });
  M.route('PUT', '/api/assets/bulk', bodies.assetBulk, function (ctx) {
    const ids = (ctx.body && ctx.body.ids) || [];
    const patch = (ctx.body && ctx.body.patch) || {};
    M.state.assets.forEach(function (a) { if (ids.indexOf(a.id) !== -1) Object.assign(a, patch); });
    M.save();
    return M.ok({ updated: ids.length });
  });
  M.route('PUT', '/api/assets/project-binding', function () { return M.ok({ success: true }); });
  M.route('PUT', '/api/assets/:id', bodies.asset, function (ctx) {
    const found = M.findById(M.state.assets, ctx.params.id);
    if (!found) return M.fail(404, 'Asset not found');
    M.mergeInto(found.item, ctx.body);
    found.item.updated_at = M.nowISO();
    M.save();
    return M.ok(found.item);
  });
  M.route('DELETE', '/api/assets/:id', function (ctx) {
    const found = M.findById(M.state.assets, ctx.params.id);
    if (!found) return M.fail(404, 'Asset not found');
    M.removeAt(M.state.assets, found.index);
    M.save();
    return M.ok({ success: true });
  });

  /* ---------- batch task queues ---------- */

  // Demo-only records. Production queues execute the Go workflow runner.
  function demoWorkflowRuns(queue: Queue): void {
    const workflow = M.state.workflows.find(w => w.id === queue.workflowId); if (!workflow) return;
    M.state.workflowRuns ??= [];
    for (const task of queue.tasks) {
      const now = M.nowISO(), id = M.id('run'), approval = workflow.graph_json.nodes.find(n => n.type === 'hitl' || n.type === 'approval');
      const nodes = workflow.graph_json.nodes, stop = approval ? nodes.indexOf(approval) : nodes.length - 1;
      const run = { id, workflow_id: workflow.id, workflow_version: workflow.version, graph_json: JSON.stringify(workflow.graph_json), status: approval ? 'awaiting_hitl' : 'completed', conversation_id: '', project_id: queue.projectId, role_id: queue.role, input_json: JSON.stringify({ message: task.message, queueId: queue.id, taskId: task.id, hitlPolicy: queue.hitlPolicy }), output_json: approval ? '' : JSON.stringify({ result: 'Demo workflow execution' }), error: '', pending_hitl_node_id: approval?.id ?? '', pending_hitl_json: approval ? JSON.stringify({ prompt: approval.config?.prompt ?? 'Review demo execution' }) : '', started_at: now, finished_at: approval ? null : now };
      M.state.workflowRuns.unshift({ run, nodeRuns: nodes.slice(0, stop + 1).map(n => ({ id: M.id('node-run'), node_id: n.id, status: n.id === approval?.id ? 'awaiting_hitl' : 'completed', input_json: JSON.stringify({ message: task.message }), output_json: JSON.stringify({ result: 'Demo node output' }), error: '', started_at: now, finished_at: n.id === approval?.id ? null : now })) });
      task.status = approval ? 'running' : 'completed'; task.startedAt = now; task.completedAt = approval ? null : now;
    }
    if (!queue.tasks.some(t => t.status === 'running')) { queue.status = 'completed'; queue.completedAt = M.nowISO(); }
  }

  // Queue records use the camelCase shape of internal/handler/batch_task_manager.go.
  function queueView(q: Queue) {
    return M.clone(q);
  }

  function newTask(message: string) {
    return { id: M.id('task'), message: message, status: 'pending', conversationId: '', startedAt: null, completedAt: null, error: '', result: '' };
  }

  M.route('GET', '/api/batch-tasks/runs', function (ctx) {
    const runs = M.state.batchQueues.flatMap(q => q.tasks.filter(t => t.startedAt).map(t => ({ ...t, conversationId: t.conversationId || t.id, queueId: q.id, taskId: t.id, title: q.title, workflowId: q.workflowId || '' })));
    const offset = Number(ctx.query.get('offset')) || 0;
    return M.ok({ runs: runs.slice(offset, offset + 50), hasMore: runs.length > offset + 50 });
  });

  M.route('GET', '/api/batch-tasks', function (ctx) {
    const list = M.filterList(M.state.batchQueues, ctx, { searchFields: ['title', 'message'], filters: { status: 'status' } });
    return M.ok({ queues: list.map(queueView), total: list.length });
  });

  M.route('POST', '/api/batch-tasks', bodies.queue, function (ctx) {
    const b = ctx.body || {};
    const tasks = (b.tasks || []).map(newTask);
    const multi = M.state.config?.multi_agent;
    const backendMode = multi?.enabled && multi.batch_use_multi_agent && typeof multi.orchestration === 'string' ? multi.orchestration : 'eino_single';
    const q = {
      workflowId: b.workflowId || '',
      id: M.id('queue'), title: b.title || 'Untitled batch task', role: b.role || '', hitlPolicy: b.hitlPolicy || '',
      agentMode: backendMode, scheduleMode: b.scheduleMode || 'manual', cronExpr: b.cronExpr || '',
      scheduleEnabled: b.scheduleMode === 'cron', projectId: b.projectId || '', concurrency: b.concurrency || 1,
      tasks: tasks, status: b.executeNow ? 'running' : 'pending', createdAt: M.nowISO(), startedAt: null, completedAt: null, currentIndex: 0,
    };
    M.state.batchQueues.unshift(q);
    if (b.executeNow && q.workflowId) demoWorkflowRuns(q);
    M.save();
    return M.ok(queueView(q));
  });

  M.route('GET', '/api/batch-tasks/:queueId', function (ctx) {
    const found = M.findById(M.state.batchQueues, ctx.params.queueId);
    if (!found) return M.fail(404, 'Queue not found');
    return M.ok(queueView(found.item));
  });

  M.route('DELETE', '/api/batch-tasks/:queueId', function (ctx) {
    const found = M.findById(M.state.batchQueues, ctx.params.queueId);
    if (!found) return M.fail(404, 'Queue not found');
    M.removeAt(M.state.batchQueues, found.index);
    M.save();
    return M.ok({ success: true });
  });

  function setQueueStatus(ctx: Context, status: string) {
    const found = M.findById(M.state.batchQueues, ctx.params.queueId);
    if (!found) return M.fail(404, 'Queue not found');
    found.item.status = status;
    if (status === 'running' && found.item.workflowId) demoWorkflowRuns(found.item);
    found.item.updated_at = M.nowISO();
    M.save();
    return M.ok(queueView(found.item));
  }

  M.route('POST', '/api/batch-tasks/:queueId/start', function (ctx) { return setQueueStatus(ctx, 'running'); });
  M.route('POST', '/api/batch-tasks/:queueId/pause', function (ctx) { return setQueueStatus(ctx, 'paused'); });
  M.route('POST', '/api/batch-tasks/:queueId/rerun', function (ctx) { return setQueueStatus(ctx, 'running'); });

  M.route('POST', '/api/batch-tasks/:queueId/tasks', bodies.task, function (ctx) {
    const found = M.findById(M.state.batchQueues, ctx.params.queueId);
    if (!found) return M.fail(404, 'Queue not found');
    const t = { id: M.id('task'), message: (ctx.body && ctx.body.message) || '', status: 'pending', conversationId: '', startedAt: '', completedAt: '', error: '', result: '' };
    found.item.tasks.push(t);
    M.save();
    return M.ok(t);
  });

  M.route('PUT', '/api/batch-tasks/:queueId/tasks/:taskId', bodies.task, function (ctx) {
    const found = M.findById(M.state.batchQueues, ctx.params.queueId);
    if (!found) return M.fail(404, 'Queue not found');
    const t = found.item.tasks.filter(function (x) { return x.id === ctx.params.taskId; })[0];
    if (!t) return M.fail(404, 'Task not found');
    M.mergeInto(t, ctx.body, ['message', 'status']);
    M.save();
    return M.ok(t);
  });

  M.route('DELETE', '/api/batch-tasks/:queueId/tasks/:taskId', function (ctx) {
    const found = M.findById(M.state.batchQueues, ctx.params.queueId);
    if (!found) return M.fail(404, 'Queue not found');
    found.item.tasks = found.item.tasks.filter(function (x) { return x.id !== ctx.params.taskId; });
    M.save();
    return M.ok({ success: true });
  });

  M.route('POST', '/api/batch-tasks/:queueId/tasks/:taskId/run', function (ctx) {
    const found = M.findById(M.state.batchQueues, ctx.params.queueId);
    if (!found) return M.fail(404, 'Queue not found');
    const t = found.item.tasks.filter(function (x) { return x.id === ctx.params.taskId; })[0];
    if (!t) return M.fail(404, 'Task not found');
    t.status = 'completed';
    t.startedAt ||= M.nowISO();
    t.completedAt = M.nowISO();
    t.result = 'Demo: task completed';
    M.save();
    return M.ok(t);
  });

  M.route('PUT', '/api/batch-tasks/:queueId/metadata', bodies.queue, function (ctx) {
    const found = M.findById(M.state.batchQueues, ctx.params.queueId);
    if (!found) return M.fail(404, 'Queue not found');
    M.mergeInto(found.item, { title: ctx.body.title ?? found.item.title, message: ctx.body.message ?? found.item.message, role: ctx.body.role ?? found.item.role, concurrency: ctx.body.concurrency ?? found.item.concurrency, hitlPolicy: ctx.body.hitlPolicy ?? found.item.hitlPolicy }, ['title', 'message', 'role', 'concurrency', 'hitlPolicy']);
    M.save();
    return M.ok(queueView(found.item));
  });

  M.route('PUT', '/api/batch-tasks/:queueId/schedule', bodies.queue, function (ctx) {
    const found = M.findById(M.state.batchQueues, ctx.params.queueId);
    if (!found) return M.fail(404, 'Queue not found');
    found.item.cronExpr = (ctx.body && ctx.body.cronExpr) || '';
    found.item.scheduleMode = ctx.body.scheduleMode || 'manual';
    M.save();
    return M.ok(queueView(found.item));
  });

  M.route('PUT', '/api/batch-tasks/:queueId/schedule-enabled', bodies.queue, function (ctx) {
    const found = M.findById(M.state.batchQueues, ctx.params.queueId);
    if (!found) return M.fail(404, 'Queue not found');
    found.item.scheduleEnabled = !!(ctx.body.scheduleEnabled ?? ctx.body.enabled);
    M.save();
    return M.ok(queueView(found.item));
  });

  /* ---------- HITL ---------- */

  // Adapt persisted demo fixtures to the same camelCase DTOs as the Go handlers.
  const hitlSettings = () => { M.state.config ??= M.configSeed(); return M.state.config.hitl; };
  const pendingView = (item: typeof M.state.hitlPending[number]) => ({
    ...item, mode: 'approval', createdAt: item.created_at,
    payload: JSON.stringify({ argumentsObj: item.arguments, userMessage: item.reason }),
  });
  const logView = (item: typeof M.state.hitlLogs[number]) => ({
    ...item, toolName: item.tool, decidedBy: item.reviewer,
    comment: item.comment ?? item.reason ?? '', status: item.status ?? 'decided',
  });
  const filterHitl = <T extends object>(items: T[], ctx: Context) => items.filter(item =>
    M.matchSearch(item, M.q(ctx, 'q', ''), ['id', 'conversationId', 'toolName', 'payload', 'comment']) &&
    ['decision', 'decidedBy'].every(key => { const value = M.q(ctx, key, 'all'); return value === 'all' || Object.entries(item).some(([k, v]) => k === key && v === value); }));

  M.route('GET', '/api/hitl/pending', function (ctx) {
    const page = M.pagePaged(filterHitl(M.state.hitlPending.map(pendingView), ctx), ctx, 20);
    return M.ok({ items: page.items, total: page.total });
  });
  M.route('GET', '/api/hitl/logs', function (ctx) {
    const page = M.pagePaged(filterHitl(M.state.hitlLogs.map(logView), ctx), ctx, 20);
    return M.ok({ items: page.items, total: page.total, retentionDays: hitlSettings().retention_days ?? 90 });
  });
  M.route('GET', '/api/hitl/logs/:id', function (ctx) {
    const item = M.state.hitlLogs.find(log => log.id === ctx.params.id);
    return item ? M.ok(logView(item)) : M.fail(404, 'Audit log not found');
  });
  M.route('DELETE', '/api/hitl/logs', bodies.hitlLogs, function (ctx) {
    const ids = new Set(ctx.body.all ? filterHitl(M.state.hitlLogs.map(logView), ctx).map(log => log.id) : ctx.body.ids ?? []);
    const before = M.state.hitlLogs.length;
    M.state.hitlLogs = M.state.hitlLogs.filter(log => !ids.has(log.id)); M.save();
    return M.ok({ deleted: before - M.state.hitlLogs.length });
  });

  M.hitlDefaults = function () {
    const cfg = hitlSettings();
    return { enabled: false, mode: typeof cfg.default_mode === 'string' ? cfg.default_mode : 'off',
      timeoutSeconds: typeof cfg.default_timeout_seconds === 'number' ? cfg.default_timeout_seconds : 300,
      toolWhitelist: cfg.tool_whitelist ?? [], sensitiveTools: [],
      reviewer: typeof cfg.default_reviewer === 'string' ? cfg.default_reviewer : 'human', auditAgentModel: '' };
  };
  function defaultConfig() {
    const cfg = M.hitlDefaults();
    return { defaultMode: cfg.mode, defaultReviewer: cfg.reviewer, defaultTimeoutSeconds: cfg.timeoutSeconds,
      hitlGlobalToolWhitelist: cfg.toolWhitelist, auditBackend: 'openai', auditModel: '' };
  }
  M.route('GET', '/api/hitl/config/:conversationId', function (ctx) {
    return M.ok({ ...defaultConfig(), conversationId: ctx.params.conversationId,
      hitl: M.state.hitlConfigs?.[ctx.params.conversationId] ?? M.hitlDefaults() });
  });
  M.route('GET', '/api/hitl/default-config', () => M.ok(defaultConfig()));
  M.route('PUT', '/api/hitl/default-config', bodies.hitl, function (ctx) {
    Object.assign(hitlSettings(), { default_mode: ctx.body.mode ?? 'off', default_reviewer: ctx.body.reviewer ?? 'human', default_timeout_seconds: ctx.body.timeoutSeconds ?? 300 });
    M.save(); return M.ok(defaultConfig());
  });
  M.route('GET', '/api/hitl/default-reviewer', () => M.ok(defaultConfig()));
  M.route('PUT', '/api/hitl/default-reviewer', bodies.reviewer, function (ctx) {
    hitlSettings().default_reviewer = ctx.body.reviewer ?? 'human'; M.save(); return M.ok(defaultConfig());
  });
  M.route('PUT', '/api/hitl/config', bodies.hitl, function (ctx) {
    if (!ctx.body.conversationId) return M.fail(400, 'Conversation ID is required');
    M.state.hitlConfigs ??= {};
    M.state.hitlConfigs[ctx.body.conversationId] = { ...M.hitlDefaults(), ...ctx.body };
    if (ctx.body.sensitiveTools?.length) hitlSettings().tool_whitelist = [...new Set([...(hitlSettings().tool_whitelist ?? []), ...ctx.body.sensitiveTools])];
    M.save(); return M.ok({ ok: true });
  });
  function auditStrategy() {
    const cfg = hitlSettings();
    const approval = 'Demo policy: approve bounded, read-only inspection of authorized lab targets. Reject destructive or out-of-scope requests.';
    const review = 'Demo policy: narrow arguments to the authorized lab scope before approving. Reject when they cannot be safely adjusted.';
    return { auditAgentPrompt: cfg.audit_agent_prompt || approval, auditAgentPromptReviewEdit: cfg.audit_agent_prompt_review_edit || review,
      defaultAuditAgentPrompt: approval, defaultAuditAgentPromptReviewEdit: review };
  }
  M.route('GET', '/api/hitl/audit-strategy', () => M.ok(auditStrategy()));
  M.route('PUT', '/api/hitl/audit-strategy', bodies.auditStrategy, function (ctx) {
    Object.assign(hitlSettings(), { audit_agent_prompt: ctx.body.auditAgentPrompt ?? '', audit_agent_prompt_review_edit: ctx.body.auditAgentPromptReviewEdit ?? '' });
    M.save(); return M.ok(auditStrategy());
  });
  const whitelistView = () => ({ toolWhitelist: hitlSettings().tool_whitelist ?? [], hitlGlobalToolWhitelist: hitlSettings().tool_whitelist ?? [] });
  M.route('GET', '/api/hitl/tool-whitelist', () => M.ok(whitelistView()));
  M.route('PUT', '/api/hitl/tool-whitelist', bodies.tools, function (ctx) {
    hitlSettings().tool_whitelist = ctx.body.toolWhitelist ?? []; M.save(); return M.ok(whitelistView());
  });
  M.route('POST', '/api/hitl/tool-whitelist', bodies.tools, function (ctx) {
    hitlSettings().tool_whitelist = [...new Set([...(hitlSettings().tool_whitelist ?? []), ...(ctx.body.sensitiveTools ?? [])])];
    M.save(); return M.ok(whitelistView());
  });

  function resolveHitl(ctx: Context<z.infer<typeof bodies.decision>>, decision: string) {
    const id = (ctx.body && (ctx.body.interruptId || ctx.body.id)) || '';
    const before = M.state.hitlPending.length;
    const item = M.state.hitlPending.filter(function (h) { return h.id === id || h.interruptId === id; })[0];
    M.state.hitlPending = M.state.hitlPending.filter(function (h) { return h.id !== id && h.interruptId !== id; });
    M.state.hitlDecisions = M.state.hitlDecisions || {};
    M.state.hitlDecisions[id] = decision;
    M.state.hitlLogs = M.state.hitlLogs || [];
    M.state.hitlLogs.unshift({ id: M.id('hl'), interruptId: id, decision: decision === 'dismiss' ? 'reject' : decision,
      tool: item ? item.tool : '', conversationId: item?.conversationId, payload: item ? pendingView(item).payload : undefined,
      comment: ctx.body.comment ?? (decision === 'dismiss' ? 'dismissed by user' : ''), status: decision === 'dismiss' ? 'cancelled' : 'decided',
      decidedAt: M.nowISO(), reviewer: 'human' });
    M.save();
    return M.ok({ success: before !== M.state.hitlPending.length, decision: decision });
  }

  M.route('POST', '/api/hitl/decision', bodies.decision, function (ctx) {
    const d = (ctx.body && (ctx.body.decision || ctx.body.action)) || 'approve';
    return resolveHitl(ctx, d === 'reject' ? 'reject' : 'approve');
  });
  M.route('POST', '/api/hitl/dismiss', bodies.decision, function (ctx) { return resolveHitl(ctx, 'dismiss'); });

  /* ---------- monitor ---------- */

  M.route('GET', '/api/monitor', function (ctx) {
    // Like the server, the status and tool filters narrow the list before it is paged.
    // Each entry maps an item field to the query parameter that filters it.
    const filters = { status: 'status', toolName: 'tool' };
    const list = M.filterList(M.state.executions, ctx, { searchKey: 'search', searchFields: ['toolName', 'status', 'conversationId'], filters });
    const page = M.pagePaged(list, ctx, 20);
    return M.ok({
      executions: page.items,
      summary: monitorSummary(M.state.executions),
      topTools: topTools(M.state.executions),
      timestamp: M.nowISO(),
      total: page.total,
      page: page.page,
      pageSize: page.pageSize,
      totalPages: page.totalPages,
      retentionDays: 30,
    });
  });

  function monitorSummary(list: Execution[]) {
    const success = list.filter(function (e) { return e.status === 'success'; }).length;
    const failed = list.filter(function (e) { return e.status === 'failed'; }).length;
    const last = list[0]?.startedAt ?? null;
    return { totalCalls: list.length, successCalls: success, failedCalls: failed, blockedCalls: 0, lastCallTime: last, toolCount: unique(list.map(function (e) { return e.toolName; })).length };
  }

  function topTools(list: Execution[]) {
    const map: Record<string, { toolName: string; totalCalls: number; successCalls: number; failedCalls: number }> = {};
    list.forEach(function (e) {
      const entry = map[e.toolName] ??= { toolName: e.toolName, totalCalls: 0, successCalls: 0, failedCalls: 0 };
      entry.totalCalls += 1;
      if (e.status === 'success') entry.successCalls += 1;
      if (e.status === 'failed') entry.failedCalls += 1;
    });
    return Object.values(map);
  }

  M.route('GET', '/api/monitor/stats', function () {
    return M.ok({ summary: monitorSummary(M.state.executions), topTools: topTools(M.state.executions), timestamp: M.nowISO() });
  });

  M.route('GET', '/api/monitor/executions', function (ctx) {
    const list = M.filterList(M.state.executions, ctx, { searchKey: 'search', searchFields: ['toolName', 'status'] });
    return M.ok({ executions: list, total: list.length });
  });

  M.route('POST', '/api/monitor/executions/names', bodies.ids, function (ctx) {
    const names: Record<string, string> = {};
    ((ctx.body && ctx.body.ids) || []).forEach(function (id) {
      const e = M.state.executions.filter(function (x) { return x.id === id; })[0];
      names[id] = e ? e.toolName : '';
    });
    return M.ok({ names: names });
  });

  M.route('GET', '/api/monitor/execution/:id', function (ctx) {
    const e = M.state.executions.filter(function (x) { return x.id === ctx.params.id; })[0];
    if (!e) return M.fail(404, 'Execution record not found');
    return M.ok(e);
  });

  M.route('DELETE', '/api/monitor/execution/:id', function (ctx) {
    M.state.executions = M.state.executions.filter(function (x) { return x.id !== ctx.params.id; });
    M.save();
    return M.ok({ message: 'Execution record deleted' });
  });

  M.route('DELETE', '/api/monitor/executions', function () {
    const n = M.state.executions.length;
    M.state.executions = [];
    M.save();
    return M.ok({ message: 'Execution records deleted', deleted: n });
  });

  M.route('POST', '/api/monitor/execution/:id/cancel', function (ctx) {
    const e = M.state.executions.filter(function (x) { return x.id === ctx.params.id; })[0];
    if (e) e.status = 'cancelled';
    M.save();
    return M.ok({ success: true, id: ctx.params.id });
  });

  M.route('GET', '/api/monitor/calls-timeline', function () {
    const buckets = Array.from({ length: 12 }, function (_, i) {
      return { time: new Date(Date.now() - (11 - i) * 3600000).toISOString(), calls: (i * 7) % 9, failed: i % 4 === 0 ? 1 : 0 };
    });
    return M.ok({ buckets: buckets, intervalMinutes: 60 });
  });

  /* ---------- audit ---------- */

  M.route('GET', '/api/audit/logs', function (ctx) {
    const list = M.filterList(M.state.auditLogs, ctx, {
      searchKey: 'q',
      searchFields: ['message', 'action', 'actor', 'category'],
      filters: { level: 'level', category: 'category', result: 'result', actor: 'actor' },
    });
    const page = M.pagePaged(list, ctx, 20);
    return M.ok({ logs: page.items, total: page.total, page: page.page, pageSize: page.pageSize, totalPages: page.totalPages });
  });

  M.route('GET', '/api/audit/logs/:id', function (ctx) {
    const log = M.state.auditLogs.filter(function (l) { return l.id === ctx.params.id; })[0];
    if (!log) return M.fail(404, 'Log not found');
    return M.ok(log);
  });

  M.route('GET', '/api/audit/summary', function () {
    const byLevel: Record<string, number> = {};
    M.state.auditLogs.forEach(function (l) { byLevel[l.level] = (byLevel[l.level] || 0) + 1; });
    return M.ok({ total: M.state.auditLogs.length, byLevel: byLevel, lastEventAt: M.state.auditLogs[0] ? M.state.auditLogs[0].createdAt : null });
  });

  M.route('GET', '/api/audit/meta', function () {
    return M.ok({
      levels: ['info', 'warn', 'error'],
      categories: unique(M.state.auditLogs.map(function (l) { return l.category; })),
      results: ['success', 'failed', 'blocked'],
      retentionDays: 90,
    });
  });

  M.route('GET', '/api/audit/logs/export', function () {
    return M.blob(JSON.stringify(M.state.auditLogs, null, 2), 'application/json', 'audit-demo.json');
  });

  M.route('DELETE', '/api/audit/logs', function () {
    M.state.auditLogs = [];
    M.save();
    return M.ok({ success: true });
  });
}
