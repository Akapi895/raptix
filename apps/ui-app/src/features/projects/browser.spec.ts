import { test, expect } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ProjectsFeature } from './index';

interface Harness { create(): Promise<ProjectsFeature>; feature: ProjectsFeature; allowed: boolean; calls: string[]; conversation: string; binding: string }

let server: ViteDevServer, address: string, cache: string;
test.beforeAll(async () => {
  cache = await mkdtemp(join(tmpdir(), 'opencode', 'projects-vite-'));
  const shell = (await readFile(new URL('../../../index.html', import.meta.url), 'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, '');
  server = await createServer({ configFile: false, root: process.cwd(), cacheDir: cache, resolve: { alias: { '@': resolve('src') } }, optimizeDeps: { entries: ['src/features/projects/index.ts'] }, server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'projects-isolated-shell', configureServer(instance) { instance.middlewares.use('/__projects__', (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(shell); }); } }] });
  await server.listen(); const socket = server.httpServer?.address(); if (!socket || typeof socket === 'string') throw new Error('Missing isolated server address'); address = `http://127.0.0.1:${socket.port}/__projects__`;
});
test.afterAll(async () => { await server?.close(); if (cache) await rm(cache, { recursive: true, force: true }); });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const h: Harness = (globalThis as typeof globalThis & { projectsHarness: Harness }).projectsHarness = {
      feature: undefined as unknown as ProjectsFeature, allowed: true, calls: [], conversation: '', binding: '',
      async create() {
        const moduleUrl = '/src/features/projects/index.ts';
        const { initProjects } = await import(/* @vite-ignore */ moduleUrl) as typeof import('./index');
        h.feature = initProjects(document, {
          translate: key => key, hasPermission: () => h.allowed, requirePermission: () => h.allowed, applyRBAC() {},
          openModal: id => { const el = document.getElementById(id); if (el) el.style.display = 'block'; },
          closeModal: id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; },
          isModalOpen: id => document.getElementById(id)?.style.display === 'block', syncModalBodyLock() {}, deferModalContent: callback => callback(),
          notify() {}, notifyApiError: (message, kind) => { if (kind !== 'success') throw new Error(message); },
          refreshProjectFilters() {}, refreshConversationProjectFilter() {}, getConversationId: () => h.conversation,
          getConversationProjectId: () => h.binding, setConversationProjectId: id => { h.binding = id; }, onConversationProjectBindingChanged() {},
          refreshChatWelcomeEmptyState() {}, loadConversation: id => { h.calls.push(id); }, startNewConversation() {}, openConversationContextMenu() {},
          closeOtherChatPanels() {}, closeWebshellProjectPanel() {}, applyWebshellProjectSelection() {}, navigate: page => { h.calls.push(page); },
          setVulnerabilityProjectFilter: () => true, setVulnerabilityIdFilter() {}, openAssetDetail() {}, initPaginationSelects() {},
          formatProjectName: name => name, applyProjectName: (element, name, fallback) => { element.textContent = name || fallback || ''; },
        });
        return h.feature;
      },
    };
  });
});

test('typed feature shell actions, forms, graph editing, folders and cross-feature navigation', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const writes: { url: string; method: string; body: unknown }[] = [];
  const project = { id: 'p1', name: 'Original project', description: 'Authorized scope', scope_json: '{"targets":["https://test"]}', pinned: false, status: 'active', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-28T00:00:00Z' };
  const facts = [{ id: 'f1', project_id: 'p1', fact_key: 'finding/a', category: 'finding', summary: 'Finding A', body: '## Exploit\n```http\nGET /', confidence: 'confirmed', pinned: true, created_at: project.created_at, updated_at: project.updated_at, incoming_links: [{ edge_type: 'discovered_on', source_fact_key: 'target/a' }], link_counts: { incoming: 1, outgoing: 0 } }];
  let edges = [{ id: 'edge1', source: 'target/a', target: 'finding/a', type: 'leads_to', confidence: 'confirmed' }];
  const node = (key: string, category: string) => ({ id: key, fact_key: key, category, summary: key, label: key, type: category, confidence: 'confirmed', pinned: false });
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    const body: unknown = request.postDataJSON();
    if (method !== 'GET') writes.push({ url: url.pathname, method, body });
    let result: unknown = {};
    if (url.pathname === '/api/projects') result = method === 'POST' ? { ...project, id: 'new-project', name: 'Created project' } : { projects: [project], total: 1, limit: 50, offset: 0 };
    else if (url.pathname === '/api/projects/p1') result = project;
    else if (url.pathname.endsWith('/stats')) result = { fact_count: facts.length, vuln_count: 1, conversation_count: 1, sparse_fact_count: 0 };
    else if (url.pathname.endsWith('/facts')) result = url.searchParams.has('fact_key') ? facts[0] : facts;
    else if (url.pathname.endsWith('/fact-graph')) result = { nodes: [node('target/a', 'target'), node('finding/a', 'finding')], edges };
    else if (url.pathname.endsWith('/fact-edges') && method === 'POST') { edges = [...edges, { id: 'edge2', source: 'finding/a', target: 'target/a', type: 'supports', confidence: 'confirmed' }]; }
    else if (url.pathname.endsWith('/fact-edges/edge1') && method === 'DELETE') edges = edges.filter(edge => edge.id !== 'edge1');
    else if (url.pathname.endsWith('/conversations') || url.pathname === '/api/conversations') result = { conversations: [{ id: 'conv1', title: 'Conversation one', projectId: 'p1', updatedAt: project.updated_at, createdAt: project.created_at, pinned: true }] };
    else if (url.pathname === '/api/vulnerabilities') result = { Vulnerabilities: [{ id: 'v1', title: 'Vulnerability', severity: 'high', status: 'open' }] };
    else if (url.pathname === '/api/assets') result = { assets: [], page: 1, total: 0, total_pages: 1 };
    else if (url.pathname.includes('/tasks')) result = { tasks: [] };
    else if (url.pathname === '/api/hitl/pending') result = { items: [] };
    await route.fulfill({ json: result });
  });
  await page.goto(address);
  await page.addStyleTag({ content: '#project-fact-graph-container { width: 100%; height: 600px; }' });
  const boot = await page.evaluate(async () => {
    const feature = await (globalThis as typeof globalThis & { projectsHarness: Harness }).projectsHarness.create();
    const projectsPage = document.getElementById('page-projects'); if (projectsPage) projectsPage.style.display = 'block';
    const chatPage = document.getElementById('page-chat'); if (chatPage) chatPage.style.display = 'block';
    feature.mount(); feature.mount(); await feature.initProjectsPage();
    return { selected: feature.service.state.selectedId, inline: document.querySelectorAll('#page-projects [onclick], #page-projects [onchange], #page-projects [oninput], #project-modal [onclick], #fact-modal [onclick], #fact-modal [oninput], #fact-modal [onchange], #fact-detail-modal [onclick]').length };
  });
  expect(boot).toEqual({ selected: 'p1', inline: 0 });
  await expect(page.locator('#projects-list .projects-list-item')).toHaveCount(1);
  await expect(page.locator('#project-facts-tbody')).toContainText('Finding A');
  await page.locator('[data-action="projects.edit-fact"]').click();
  await expect(page.locator('#fact-modal-key')).toHaveValue('finding/a'); await expect(page.locator('#fact-modal-links')).toHaveValue('discovered_on: target/a');
  await page.locator('#fact-modal-summary').fill('Edited summary'); await page.locator('#fact-modal-submit-btn').click();
  await expect.poll(() => writes.some(write => write.url.endsWith('/facts/f1') && (write.body as { summary?: string }).summary === 'Edited summary')).toBe(true);
  await page.locator('#project-tab-settings').click(); await page.locator('#project-edit-pinned').check();
  await page.locator('[data-action="projects.saveProjectSettings"]').click();
  await expect.poll(() => writes.some(write => write.url === '/api/projects/p1' && (write.body as { pinned?: boolean }).pinned === true)).toBe(true);
  await page.locator('#project-tab-graph').click(); await expect(page.locator('#project-fact-graph-container canvas').first()).toBeVisible();
  // Drive the public renderer callbacks through real Cytoscape node taps.
  const graphResult = await page.evaluate(async () => {
    const feature = (globalThis as typeof globalThis & { projectsHarness: Harness }).projectsHarness.feature;
    const container = document.getElementById('project-fact-graph-container'); if (!container) throw new Error('Missing graph');
    feature.focusProjectFactGraphEdge('edge1');
    return { edges: document.querySelectorAll('.project-fact-graph-edge-item').length, sidebar: document.getElementById('project-fact-graph-sidebar')?.hidden };
  });
  expect(graphResult).toEqual({ edges: 1, sidebar: false });
  page.once('dialog', dialog => dialog.accept()); await page.locator('[data-action="projects.delete-edge"]').click();
  await expect.poll(() => writes.some(write => write.url.endsWith('/fact-edges/edge1') && write.method === 'DELETE')).toBe(true);
  page.once('dialog', dialog => dialog.accept('supports'));
  await page.evaluate(() => {
    const feature = (globalThis as typeof globalThis & { projectsHarness: Harness }).projectsHarness.feature;
    const container = document.getElementById('project-fact-graph-container'); if (!container) throw new Error('Missing graph');
    feature.toggleProjectFactGraphConnectMode();
    const node = (key: string, type: string) => ({ id: key, fact_key: key, category: type, type, label: key, summary: key, confidence: 'confirmed', pinned: false });
    const cy = feature.graph.render(container, { nodes: [node('target/a', 'target'), node('finding/a', 'finding')], edges: [] });
    cy?.getElementById('target/a').emit('tap'); cy?.getElementById('finding/a').emit('tap');
  });
  await expect.poll(() => writes.some(write => write.url.endsWith('/fact-edges') && (write.body as { edge_type?: string }).edge_type === 'supports')).toBe(true);
  await page.locator('#project-tab-conversations').click(); await expect(page.locator('#project-conversations-tbody')).toContainText('Conversation one');
  await expect(page.locator('#project-folders-list .project-folder-item')).toHaveCount(2);
  await expect(page.locator('.project-conversation-item')).toHaveCount(1);
  const navigation = await page.evaluate(async () => {
    const h = (globalThis as typeof globalThis & { projectsHarness: Harness }).projectsHarness;
    h.calls.length = 0; h.feature.openProjectConversation('conv1');
    await new Promise(resolve => setTimeout(resolve, 250)); h.conversation = 'conv1'; h.binding = 'p1'; await h.feature.selectChatProject('');
    return { calls: h.calls, binding: h.binding };
  });
  expect(navigation).toEqual({ calls: ['chat', 'conv1'], binding: '' });
  expect(writes.some(write => write.url.endsWith('/conversations/conv1/project') && (write.body as { projectId?: string }).projectId === '')).toBe(true);
  const readOnly = await page.evaluate(() => {
    const h = (globalThis as typeof globalThis & { projectsHarness: Harness }).projectsHarness;
    h.allowed = false; h.feature.showNewProjectModal(); h.feature.switchProjectTab('assets');
    return { modal: document.getElementById('project-modal')?.style.display, facts: document.getElementById('project-panel-facts')?.hidden };
  });
  expect(readOnly).toEqual({ modal: 'none', facts: false });
  expect(errors).toEqual([]);
});

test('unchanged demo mock supports project CRUD, scope/pins, fact array editing and graph rendering', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(address); await page.addStyleTag({ content: '#project-fact-graph-container { width: 100%; height: 600px; }' });
  const result = await page.evaluate(async () => {
    const mockUrl = '/src/mock/index.ts';
    const mock = await import(/* @vite-ignore */ mockUrl) as { installMock(): void }; mock.installMock();
    const feature = await (globalThis as typeof globalThis & { projectsHarness: Harness }).projectsHarness.create();
    const root = document.getElementById('page-projects'); if (root) root.style.display = 'block'; feature.mount();
    const created = await feature.service.saveProject('', { name: 'Migrated project', description: 'Demo contract' }); await feature.selectProject(created.id);
    const fact = await feature.service.saveFact('', { fact_key: 'note/migration', category: 'note', summary: 'Before edit', body: 'Details', confidence: 'confirmed', pinned: true, links_text: '' });
    await feature.showEditFactModal(fact.fact_key);
    const summary = document.getElementById('fact-modal-summary'); if (summary instanceof HTMLInputElement) summary.value = 'After edit';
    await feature.saveFactModal();
    const edited = await feature.service.api.fact(created.id, fact.fact_key);
    const name = document.getElementById('project-edit-name'); if (name instanceof HTMLInputElement) name.value = 'Migrated project';
    const scope = document.getElementById('project-edit-scope'); if (scope instanceof HTMLTextAreaElement) scope.value = '{"targets":["https://authorized.test"]}';
    const pin = document.getElementById('project-edit-pinned'); if (pin instanceof HTMLInputElement) pin.checked = true;
    await feature.saveProjectSettings(); const saved = await feature.service.api.get(created.id);
    if (scope instanceof HTMLTextAreaElement) scope.value = '{"unsaved":true}';
    document.dispatchEvent(new Event('languagechange'));
    const preservedDraft = scope instanceof HTMLTextAreaElement ? scope.value : '';
    feature.switchProjectTab('graph'); await feature.loadProjectFactGraph();
    return { id: created.id, factSummary: edited.summary, pinned: saved.pinned, scope: saved.scope_json, preservedDraft, graphNodes: feature.service.state.graph?.nodes.length };
  });
  expect(result.factSummary).toBe('After edit'); expect(result.pinned).toBe(true); expect(result.scope).toBe('{"targets":["https://authorized.test"]}'); expect(result.graphNodes).toBe(1);
  expect(result.preservedDraft).toBe('{"unsaved":true}');
  await expect(page.locator('#project-fact-graph-container canvas').first()).toBeVisible();
  page.once('dialog', dialog => dialog.accept()); await page.evaluate(async () => { await (globalThis as typeof globalThis & { projectsHarness: Harness }).projectsHarness.feature.archiveCurrentProject(); });
  await expect(page.locator('#projects-list')).not.toContainText('Migrated project');
  expect(errors).toEqual([]);
});
