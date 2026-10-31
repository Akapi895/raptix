import { readFileSync } from 'node:fs';
import { chromium, expect as browserExpect, type Browser, type Page } from '@playwright/test';
import { parse, serializeOuter, type DefaultTreeAdapterTypes } from 'parse5';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { initKnowledge } from './index';
import type { initSkills } from '../skills';

interface FeaturePair { skills: ReturnType<typeof initSkills>; knowledge: ReturnType<typeof initKnowledge>; activate(): void; dispose(): void }
interface Harness { install(): FeaturePair; bridge: FeaturePair; permissions: string[]; copied: string[]; calls: string[]; language: string; allowed: boolean }
// The browser receives just the real step-six dependency closure and shell nodes.
// The transport uses intercepted HTTP; translation resources are the real JSON.
// No build, server, shared preview port or shared e2e/config edits are needed.
function browserSource(): string {
  const modules = ['platform/storage', 'platform/backend-legacy-strings', 'ui/actions', 'ui/format', 'ui/modal', 'ui/capabilities', ...['skills', 'knowledge'].flatMap(feature => ['model', 'service', 'view', 'controller', 'index'].map(file => `features/${feature}/${file}`)), 'features/knowledge/toast'];
  const factories = modules.map(id => {
    const source = readFileSync(new URL(`../../${id}.ts`, import.meta.url), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    return `${JSON.stringify(id)}: function(exports, require) {${compiled}\n}`;
  });
  const en = readFileSync(new URL('../../i18n/resources/en-US.json', import.meta.url), 'utf8');
  return `(() => {
    const resources = {'en-US': ${en}};
    const factories = {${factories.join(',')},
      'platform/http': function(exports) { exports.http = { raw: (path, init) => fetch(path, init) }; },
      'i18n/index': function(exports) { exports.translateRuntime = (key, params) => {
        let value = resources[globalThis.stepSix?.language || 'en-US'];
        for (const part of key.split('.')) value = value?.[part];
        return typeof value === 'string' ? value.replace(/{{(\\w+)}}/g, (_, name) => String(params?.[name] ?? '')) : key;
      }; }
    };
    const cache = {};
    function load(id) {
      if (cache[id]) return cache[id]; const exports = cache[id] = {};
      factories[id](exports, specifier => {
        const parts = specifier.startsWith('@/') ? [] : id.split('/').slice(0, -1);
        for (const part of (specifier.startsWith('@/') ? specifier.slice(2) : specifier).split('/')) { if (part === '..') parts.pop(); else if (part !== '.') parts.push(part); }
        const next = parts.join('/'); return load(factories[next] ? next : next + '/index');
      }); return exports;
    }
    globalThis.stepSix = { permissions: [], copied: [], calls: [], language: 'en-US', allowed: true, install() {
      const h = globalThis.stepSix;
      const toast = load('features/knowledge/toast').createKnowledgeToast(document);
      const deps = { doc: document, request: (path, init) => fetch(path, init),
        t: load('i18n/index').translateRuntime, can: permission => { h.permissions.push(permission); return h.allowed; },
        confirm: () => true, notify: toast.show, afterRender: root => h.calls.push('rbac:' + root.id),
        initPaginationSelects: root => h.calls.push('skin:' + root.id) };
      const skills = load('features/skills/index').initSkills({ ...deps, storage: load('platform/storage').storage });
      const knowledge = load('features/knowledge/index').initKnowledge({ ...deps,
        copy: async text => { h.copied.push(text); }, navigateSettings: () => { h.calls.push('page:settings', 'section:basic'); } });
      return { skills, knowledge, activate() { skills.activate(); knowledge.activate(); }, dispose() { skills.dispose(); knowledge.dispose(); toast.dispose(); } };
    } };
    globalThis.stepSix.bridge = globalThis.stepSix.install();
  })();`;
}
function shell(): string {
  const source = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
  const ids = new Set(['page-skills-management', 'page-skills-monitor', 'page-knowledge-management', 'page-knowledge-retrieval-logs', 'skill-modal', 'knowledge-item-modal']);
  const selected: string[] = [];
  function walk(node: DefaultTreeAdapterTypes.Node): void {
    if ('attrs' in node && ids.has(node.attrs.find(attr => attr.name === 'id')?.value ?? '')) { selected.push(serializeOuter(node)); return; }
    if ('childNodes' in node) node.childNodes.forEach(walk);
  }
  walk(parse(source));
  return `<!doctype html><html><head><meta charset="utf-8"><style>.page,.modal{display:none}.page.active{display:block}.modal-content{background:white;padding:12px}.modal{position:fixed;inset:0;overflow:auto;background:#ddd}.custom-select-dropdown{display:none}.open .custom-select-dropdown{display:block}</style></head><body>${selected.join('\n')}</body></html>`;
}

interface ApiState {
  requests: { path: string; method: string; body: Record<string, string> }[];
  skills: { name: string; description: string; content: string; file_count: number; script_count: number }[];
  files: Record<string, string>;
  items: { id: string; category: string; title: string; content: string }[];
  logs: { id: string; query: string; retrievedItems: string | string[]; conversationId: string; messageId: string; createdAt: string }[];
  index: Record<string, string | number | boolean>;
  failWrite: boolean;
  conflict: boolean;
  enabled?: boolean;
}
let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
afterAll(async () => { await browser?.close(); });

async function setup() {
  const page = await browser.newPage(); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => { void dialog.accept(); });
  const state: ApiState = {
    requests: [], skills: Array.from({ length: 21 }, (_value, index) => ({ name: `sample-${index}`, description: 'A skill', content: 'Full body', file_count: 2, script_count: 1 })), files: { 'SKILL.md': 'Full body', 'scripts/run.py': 'print(1)' },
    items: Array.from({ length: 12 }, (_value, index) => ({ id: `item-${index}`, category: `Category-${String(index).padStart(2, '0')}`, title: `Knowledge ${index}`, content: '# Useful content' })),
    logs: [{ id: 'log-1', query: 'query <safe>', retrievedItems: '["_has_results","item-0","gone"]', conversationId: 'conv "quoted"', messageId: 'msg-1', createdAt: '2026-10-29T01:00:00Z' }],
    index: { total_items: 12, indexed_items: 12, progress_percent: 100, is_complete: true }, failWrite: false, conflict: false,
  };
  await page.route('https://step6.test/**', async route => {
    const req = route.request(); const url = new URL(req.url());
    if (url.pathname === '/') { await route.fulfill({ contentType: 'text/html', body: shell() }); return; }
    const method = req.method(); const body = (req.postDataJSON() ?? {}) as Record<string, string>;
    state.requests.push({ path: url.pathname + url.search, method, body });
    const ok = (value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (state.failWrite && method !== 'GET') { await ok({ error: 'disk full' }, 500); return; }
    const skillPath = url.pathname.match(/^\/api\/skills\/([^/]+)(?:\/(.*))?$/);
    if (url.pathname === '/api/skills/stats') { await ok(method === 'DELETE' ? {} : { total_skills: 21, total_calls: 8, total_success: 7, total_failed: 1, stats: [{ skill_name: 'sample-0', total_calls: 8, success_calls: 7, failed_calls: 1 }] }); return; }
    if (url.pathname === '/api/skills') {
      if (method === 'POST') { state.skills.push({ name: body.name ?? '', description: body.description ?? '', content: body.content ?? '', file_count: 1, script_count: 0 }); await ok({}); return; }
      const found = state.skills.filter(skill => !url.searchParams.get('search') || skill.name.includes(url.searchParams.get('search') ?? ''));
      const offset = Number(url.searchParams.get('offset')); const limit = Number(url.searchParams.get('limit'));
      await ok({ skills: found.slice(offset, offset + limit), total: found.length }); return;
    }
    if (skillPath) {
      const id = decodeURIComponent(skillPath[1] ?? ''); const tail = skillPath[2]; const skill = state.skills.find(skill => skill.name === id);
      if (tail === 'bound-roles') { await ok({ bound_roles: ['Bound role'] }); return; }
      if (tail === 'files') { await ok({ files: Object.keys(state.files).map(path => ({ path })) }); return; }
      if (tail === 'file') { if (method === 'PUT') { state.files[body.path ?? ''] = body.content ?? ''; await ok({}); } else await ok({ content: state.files[url.searchParams.get('path') ?? ''] }); return; }
      if (!skill) { await ok({ error: 'missing' }, 404); return; }
      if (method === 'PUT') { skill.description = body.description ?? ''; skill.content = body.content ?? ''; await ok({}); return; }
      if (method === 'DELETE') { state.skills = state.skills.filter(value => value !== skill); await ok({ affected_roles: ['Bound role'] }); return; }
      await ok({ skill: { ...skill, content: url.searchParams.get('depth') === 'summary' ? 'Summary body' : skill.content } }); return;
    }
    if (url.pathname === '/api/knowledge/categories') { await ok({ enabled: state.enabled, categories: [...new Set(state.items.map(item => item.category))] }); return; }
    if (url.pathname === '/api/knowledge/items') {
      if (method === 'POST') { const item = { id: 'created', category: body.category ?? '', title: body.title ?? '', content: body.content ?? '' }; state.items.push(item); await ok(item); return; }
      const matching = state.items.filter(item => (!url.searchParams.get('category') || item.category === url.searchParams.get('category')) && (!url.searchParams.get('search') || item.title.includes(url.searchParams.get('search') ?? '')));
      const categories = [...new Set(matching.map(item => item.category))].sort().map(category => ({ category, items: matching.filter(item => item.category === category), itemCount: matching.filter(item => item.category === category).length }));
      const offset = Number(url.searchParams.get('offset')); const limit = Number(url.searchParams.get('limit') || 1000);
      await ok({ enabled: state.enabled, categories: url.searchParams.get('category') || url.searchParams.get('search') ? categories : categories.slice(offset, offset + limit), total: categories.length }); return;
    }
    if (url.pathname.startsWith('/api/knowledge/items/')) {
      const id = decodeURIComponent(url.pathname.split('/').pop() ?? ''); const item = state.items.find(item => item.id === id);
      if (!item) { await ok({ error: 'missing' }, 404); return; }
      if (method === 'PUT') Object.assign(item, body);
      if (method === 'DELETE') state.items = state.items.filter(value => value !== item);
      await ok(item); return;
    }
    if (url.pathname === '/api/knowledge/index-status') { await ok(state.index); return; }
    if (url.pathname === '/api/knowledge/index') { await ok(state.conflict ? { error: 'already running' } : { message: 'job started' }, state.conflict ? 409 : 200); return; }
    if (url.pathname === '/api/knowledge/scan') { await ok({ items_to_index: 2 }); return; }
    if (url.pathname === '/api/knowledge/retrieval-logs') { await ok({ logs: state.logs }); return; }
    if (url.pathname.startsWith('/api/knowledge/retrieval-logs/')) { state.logs = []; await ok({}); return; }
    await ok({ error: `Unhandled test endpoint ${url.pathname}` }, 404);
  });
  await page.goto('https://step6.test/'); await page.addScriptTag({ content: browserSource() });
  await page.addScriptTag({ content: 'stepSix.bridge.activate(); stepSix.bridge.activate();' });
  return { page, state, errors };
}
async function activatePage(page: Page, id: string): Promise<void> {
  await page.evaluate(id => { document.querySelectorAll('.page').forEach(node => node.classList.toggle('active', node.id === `page-${id}`)); }, id);
}
async function finish(page: Page, errors: string[]) { await page.evaluate(() => { const h = (globalThis as typeof globalThis & { stepSix: Harness }).stepSix; h.bridge.dispose(); h.bridge.dispose(); }); await page.close(); expect(errors).toEqual([]); }

describe('skills + knowledge standalone browser integration', () => {
  it('binds every existing control without inline JS and preserves paging/search/monitor/auto-refresh', async () => {
    const { page, state, errors } = await setup();
    try {
      expect(state.requests).toEqual([]);
      await activatePage(page, 'skills-management'); await page.locator('[data-action="skills.refresh"]').click();
      await browserExpect(page.locator('.skill-card')).toHaveCount(20);
      await page.locator('[data-action="skills.page"][data-page="2"]').first().click(); await browserExpect(page.locator('.skill-card')).toHaveCount(1);
      await page.locator('#skills-page-size-pagination').selectOption('10'); await browserExpect(page.locator('.skill-card')).toHaveCount(10);
      expect(await page.evaluate(() => localStorage.getItem('skillsPageSize'))).toBe('10');
      await page.locator('#skills-search').fill('sample-20'); await page.locator('#skills-search').press('Enter'); await browserExpect(page.locator('.skill-card')).toHaveCount(1); await browserExpect(page.locator('#skills-pagination')).toBeEmpty();
      await page.locator('#skills-search-clear').click(); await browserExpect(page.locator('.skill-card')).toHaveCount(10);
      const inline = await page.locator('#page-skills-management, #page-skills-monitor, #page-knowledge-management, #page-knowledge-retrieval-logs, #skill-modal, #knowledge-item-modal').evaluateAll(roots => roots.flatMap(root => [...root.querySelectorAll('*')].flatMap(node => [...node.attributes].filter(attr => /^on/.test(attr.name)).map(attr => attr.value))));
      expect(inline).toEqual([]);
      await page.clock.install();
      await page.locator('[data-action="skills.add"]').click(); const before = state.requests.length; await page.clock.fastForward(5500); expect(state.requests.length).toBe(before);
      await page.locator('#skill-modal [data-action="skills.close"]').last().click(); await page.clock.fastForward(5000); await browserExpect(page.locator('.skill-card')).toHaveCount(10);
      await activatePage(page, 'skills-monitor'); await page.locator('[data-action="skills.refreshMonitor"]').click(); await browserExpect(page.locator('#skills-monitor-list')).toContainText('sample-0');
      await page.locator('[data-action="skills.clearStats"]').click(); await browserExpect.poll(() => state.requests.filter(req => req.path === '/api/skills/stats' && req.method === 'DELETE').length).toBe(1);
    } finally { await finish(page, errors); }
  }, 30000);
  it('runs skill create, summary/full viewing, package file edits, dirty description guard and retry/delete', async () => {
    const { page, state, errors } = await setup();
    try {
      await activatePage(page, 'skills-management'); await page.locator('[data-action="skills.add"]').click();
      await page.locator('#skill-name').fill('new-skill'); await page.locator('#skill-description').fill('Description'); await page.locator('#skill-content-add').fill('Body'); await page.locator('#skill-modal [data-action="skills.save"]').click();
      await browserExpect(page.locator('#skill-modal')).toBeHidden(); expect(state.skills.at(-1)?.name).toBe('new-skill');
      await page.locator('[data-action="skills.view"]').first().click(); await browserExpect(page.locator('#skill-view-body')).toHaveText('Summary body'); await page.locator('[data-action="skills.full"]').click(); await browserExpect(page.locator('#skill-view-body')).toHaveText('Full body');
      await page.locator('[data-action="skills.viewEdit"]').click(); await browserExpect(page.locator('#skill-content')).toHaveValue('Full body');
      await page.locator('#skill-description').fill('Changed'); await page.locator('[data-action="skills.file"][data-path="scripts/run.py"]').click(); await browserExpect(page.locator('#skill-active-path')).toHaveText('SKILL.md');
      state.failWrite = true; await page.locator('#skill-modal [data-action="skills.save"]').click(); await browserExpect(page.locator('#skill-modal .btn-primary')).toBeEnabled(); await browserExpect(page.locator('#skill-description')).toHaveValue('Changed');
      state.failWrite = false; await page.locator('#skill-modal [data-action="skills.save"]').click(); await browserExpect.poll(() => state.skills[0]?.description).toBe('Changed');
      await page.locator('[data-action="skills.file"][data-path="scripts/run.py"]').click(); await browserExpect(page.locator('#skill-content')).toHaveValue('print(1)'); await browserExpect(page.locator('#skill-description')).toBeDisabled();
      await page.locator('#skill-new-file-path').fill('scripts/new.py'); await page.locator('#skill-new-file-btn').click(); await page.locator('#skill-content').fill('\n  print(2)\n'); await page.locator('#skill-modal [data-action="skills.save"]').click();
      await browserExpect.poll(() => state.files['scripts/new.py']).toBe('\n  print(2)\n');
      await page.locator('#skill-modal [data-action="skills.close"]').last().click(); await page.locator('[data-action="skills.delete"]').first().click(); await browserExpect.poll(() => state.skills.some(skill => skill.name === 'sample-0')).toBe(false);
      expect(await page.evaluate(() => (globalThis as typeof globalThis & { stepSix: Harness }).stepSix.permissions.includes('skills:delete'))).toBe(true);
    } finally { await finish(page, errors); }
  }, 30000);
  it('preserves knowledge category paging/search and CRUD failure recovery', async () => {
    const { page, state, errors } = await setup();
    try {
      await activatePage(page, 'knowledge-management'); await page.evaluate(async () => { const h = (globalThis as typeof globalThis & { stepSix: Harness }).stepSix; await h.bridge.knowledge.controller.categories(); await h.bridge.knowledge.controller.load(); });
      await browserExpect(page.locator('.knowledge-category-section')).toHaveCount(10); await page.locator('[data-action="knowledge.page"][data-page="2"]').click(); await browserExpect(page.locator('.knowledge-category-section')).toHaveCount(2);
      await page.locator('#knowledge-category-filter').selectOption('Category-00'); await browserExpect(page.locator('.knowledge-item-card')).toHaveCount(1);
      await page.locator('#knowledge-search').fill('no match'); await page.locator('#knowledge-search').press('Enter'); await browserExpect(page.locator('#knowledge-items-list')).toContainText('No matching knowledge items');
      await page.locator('#knowledge-search').fill(''); await browserExpect(page.locator('.knowledge-item-card')).toHaveCount(1);
      await page.locator('[data-action="knowledge.add"]').click(); await page.locator('#knowledge-item-category').fill('New category'); await page.locator('#knowledge-item-title').fill('Created title'); await page.locator('#knowledge-item-content').fill('Draft');
      state.failWrite = true; await page.locator('[data-action="knowledge.save"]').click(); await browserExpect(page.locator('#knowledge-item-title')).toBeEnabled(); await browserExpect(page.locator('#knowledge-item-title')).toHaveValue('Created title');
      state.failWrite = false; await page.locator('[data-action="knowledge.save"]').click(); await browserExpect(page.locator('#knowledge-item-modal')).toBeHidden(); await browserExpect(page.locator('#knowledge-category-filter')).toHaveValue('New category');
      await page.locator('[data-action="knowledge.edit"]').click(); await browserExpect(page.locator('#knowledge-item-title')).toHaveValue('Created title'); await page.locator('#knowledge-item-title').fill('Edited title'); await page.locator('[data-action="knowledge.save"]').click(); await browserExpect(page.locator('.knowledge-item-card .cap-primary-cell strong')).toHaveText('Edited title');
      state.failWrite = true; await page.locator('[data-action="knowledge.delete"]').click(); await page.waitForTimeout(350); await browserExpect(page.locator('.knowledge-item-card')).toBeVisible(); await browserExpect(page.locator('[data-action="knowledge.delete"]')).toBeEnabled();
      state.failWrite = false; await page.locator('[data-action="knowledge.delete"]').click(); await browserExpect(page.locator('.knowledge-item-card')).toHaveCount(0);
    } finally { await finish(page, errors); }
  }, 30000);
  it('shows rebuild/error advice and conflict handling, stops polling on navigation and disposal', async () => {
    const { page, state, errors } = await setup();
    try {
      await page.clock.install(); await activatePage(page, 'knowledge-management');
      state.index = { total_items: 12, indexed_items: 1, progress_percent: 25, is_complete: false, is_rebuilding: true, rebuild_current: 3, rebuild_total: 12, rebuild_failed: 1, rebuild_last_item_id: 'item-2', rebuild_last_chunks: 2 };
      await page.evaluate(async () => { await (globalThis as typeof globalThis & { stepSix: Harness }).stepSix.bridge.knowledge.controller.updateIndex(); });
      await browserExpect(page.locator('#knowledge-index-progress')).toContainText('3 / 12 items indexed');
      await browserExpect(page.locator('#knowledge-index-progress')).toContainText('1 failed');
      state.index = { total_items: 12, indexed_items: 1, last_error: '401 invalid api key', is_complete: false };
      await page.clock.fastForward(2000); await browserExpect(page.locator('#knowledge-index-progress')).toContainText('The embedding service rejected the credentials');
      state.conflict = true; await page.locator('#knowledge-index-progress [data-action="knowledge.build"]').click(); await browserExpect(page.locator('.toast-notification').filter({ hasText: 'already running' })).toHaveCount(1);
      state.conflict = false; state.index = { total_items: 12, indexed_items: 1, progress_percent: 8, is_complete: false }; await page.locator('#knowledge-index-progress [data-action="knowledge.rebuild"]').click();
      await browserExpect.poll(() => state.requests.some(req => req.path === '/api/knowledge/index?mode=full')).toBe(true); await page.clock.fastForward(500);
      await activatePage(page, 'skills-management'); await page.waitForTimeout(0); const before = state.requests.filter(req => req.path === '/api/knowledge/index-status').length; await page.clock.fastForward(9000); expect(state.requests.filter(req => req.path === '/api/knowledge/index-status').length).toBe(before);
      await page.evaluate(() => { const h = (globalThis as typeof globalThis & { stepSix: Harness }).stepSix; h.bridge.dispose(); h.bridge.activate(); }); const count = state.requests.length; await page.clock.fastForward(20000); expect(state.requests.length).toBe(count);
    } finally { await finish(page, errors); }
  }, 30000);
  it('renders normalized retrieval logs safely, copies IDs, loads partial details, re-renders on languagechange and retries deletion', async () => {
    const { page, state, errors } = await setup();
    try {
      await activatePage(page, 'knowledge-retrieval-logs'); await page.locator('[data-action="knowledge.filterLogs"]').first().click(); await browserExpect(page.locator('.retrieval-log-card')).toHaveCount(1);
      await browserExpect(page.locator('.retrieval-log-card .cap-primary-cell strong')).toHaveText('query <safe>');
      await page.locator('[data-action="knowledge.logDetails"]').click(); await page.locator('[data-action="knowledge.copy"]').first().click(); expect(await page.evaluate(() => (globalThis as typeof globalThis & { stepSix: Harness }).stepSix.copied)).toEqual(['conv "quoted"']);
      await browserExpect(page.locator('.cap-retrieved-item')).toHaveCount(1); await browserExpect(page.locator('#retrieval-log-details-modal')).toContainText('Knowledge 0'); await page.locator('[data-action="knowledge.closeDetails"]').last().click();
      await page.locator('#retrieval-logs-conversation-id').fill('conversation & filter'); await page.locator('[data-action="knowledge.filterLogs"]').last().click(); await browserExpect.poll(() => state.requests.some(req => req.path.includes('conversationId=conversation+%26+filter'))).toBe(true);
      await page.evaluate(() => { document.dispatchEvent(new Event('languagechange')); }); await browserExpect(page.locator('.retrieval-log-card .cap-row-actions')).toContainText('View details');
      state.failWrite = true; await page.locator('[data-action="knowledge.deleteLog"]').click(); await page.waitForTimeout(350); await browserExpect(page.locator('.retrieval-log-card')).toBeVisible();
      state.failWrite = false; await page.locator('[data-action="knowledge.deleteLog"]').click(); await browserExpect(page.locator('.retrieval-log-card')).toHaveCount(0);
      expect(await page.locator('#retrieval-logs-list [onclick]').count()).toBe(0);
    } finally { await finish(page, errors); }
  }, 30000);
  it('keeps disabled-knowledge settings navigation and rejects writes through controls and typed controllers', async () => {
    const { page, state, errors } = await setup();
    try {
      state.enabled = false;
      await activatePage(page, 'knowledge-management'); await page.evaluate(async () => { await (globalThis as typeof globalThis & { stepSix: Harness }).stepSix.bridge.knowledge.controller.load(); });
      await browserExpect(page.locator('#knowledge-items-list')).toContainText('not enabled');
      await page.locator('[data-action="knowledge.settings"]').click();
      await browserExpect.poll(() => page.evaluate(() => (globalThis as typeof globalThis & { stepSix: Harness }).stepSix.calls)).toContain('section:basic');
      await page.evaluate(async () => { const h = (globalThis as typeof globalThis & { stepSix: Harness }).stepSix; h.allowed = false; const c = h.bridge.knowledge.controller; c.add(); await c.save(); await c.startIndex(); await c.remove('item-0'); await c.removeLog('log-1'); });
      await browserExpect(page.locator('#knowledge-item-modal')).toBeHidden();
      await activatePage(page, 'skills-management'); await page.locator('[data-action="skills.add"]').click(); await browserExpect(page.locator('#skill-modal')).toBeHidden();
      expect(state.requests.filter(request => request.method !== 'GET')).toEqual([]);
    } finally { await finish(page, errors); }
  }, 30000);
  it('isolates feature state and supports a fresh mount without duplicate listeners', async () => {
    const { page, errors } = await setup();
    try {
      await activatePage(page, 'knowledge-management');
      await page.evaluate(async () => {
        const h = (globalThis as typeof globalThis & { stepSix: Harness }).stepSix;
        await h.bridge.knowledge.controller.selectCategory('Category-00');
        h.calls.push('ambient:' + h.bridge.knowledge.service.state.pagination.currentCategory);
      });
      expect(await page.evaluate(() => (globalThis as typeof globalThis & { stepSix: Harness }).stepSix.calls)).toContain('ambient:Category-00');
      await page.evaluate(() => { const h = (globalThis as typeof globalThis & { stepSix: Harness }).stepSix; h.bridge.dispose(); });
      await page.addScriptTag({ content: `
        stepSix.bridge = stepSix.install(); stepSix.bridge.activate(); stepSix.bridge.activate();
      ` });
      expect(await page.evaluate(() => (globalThis as typeof globalThis & { stepSix: Harness }).stepSix.bridge.knowledge.service.state.pagination.currentCategory)).toBe('');
      await activatePage(page, 'skills-management');
      const before = await page.evaluate(() => (globalThis as typeof globalThis & { stepSix: Harness }).stepSix.permissions.length);
      await page.locator('[data-action="skills.add"]').click(); await browserExpect(page.locator('#skill-modal')).toBeVisible();
      expect(await page.evaluate(() => (globalThis as typeof globalThis & { stepSix: Harness }).stepSix.permissions.length)).toBe(before + 1);
      await page.evaluate(() => { (globalThis as typeof globalThis & { stepSix: Harness }).stepSix.bridge.dispose(); });
      await browserExpect(page.locator('#skill-modal')).toBeHidden();
      expect(await page.locator('body').evaluate(node => node.classList.contains('app-modal-open'))).toBe(false);
    } finally { await finish(page, errors); }
  }, 30000);
});
