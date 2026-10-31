import { readFileSync } from 'node:fs';
import { chromium, type Browser, type Page } from '@playwright/test';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import type { createRouterView, createRouter } from './index';
import { pageIds } from './service';

interface Harness {
  install(): { router: ReturnType<typeof createRouter>; view: ReturnType<typeof createRouterView>; start(): void; dispose(): void };
  bridge: ReturnType<Harness['install']>;
  calls: string[];
  ready: Promise<void>;
  resolveReady(): void;
  hashEvents: number;
}

// Compile just the router's dependency closure in memory. No Vite build, server,
// preview, shared config, generated files, or production bundle is involved.
function browserSource(): string {
  const paths = ['router/service', 'router/actions', 'router/view', 'router/page-lifecycle', 'router/index', 'platform/storage', 'platform/router-browser'];
  const factories = paths.map(id => {
    const source = readFileSync(new URL('../' + id + '.ts', import.meta.url), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    return JSON.stringify(id) + ': function(exports, require) {\n' + compiled + '\n}';
  });
  return `(() => {
    const factories = {${factories.join(',\n')}};
    const cache = {};
    function load(id) {
      if (cache[id]) return cache[id];
      const exports = cache[id] = {};
      factories[id](exports, specifier => {
        let target;
        if (specifier.startsWith('@/')) target = specifier.slice(2);
        else { const segments = id.split('/'); segments.pop(); for (const part of specifier.split('/')) { if (part === '..') segments.pop(); else if (part !== '.') segments.push(part); } target = segments.join('/'); }
        return load(factories[target] ? target : target + '/index');
      });
      return exports;
    }
    const h = globalThis.routerHarness = { calls: [], ready: Promise.resolve(), hashEvents: 0, install() {
      const record = value => { h.calls.push(value); };
      let indexTimer;
      const router = load('router/index').createRouter(load('platform/router-browser').createRouterBrowserPort());
      const lifecycle = load('router/index').createPageLifecycle(document, {
        refreshDashboard: () => record('dashboard'), initVulnerabilityPage: () => record('vulnerabilities'),
        prefetchProjectsForChat: () => record('prefetch-projects'), refreshChatProjectSelector: () => record('project-selector'),
        stopExternalMcpPoll: () => record('stop-mcp'), cleanupTasksPage: () => record('cleanup-tasks'),
        stopTokenUsageRequests: () => record('stop-token'),
        hasPermission: permission => permission !== 'denied', loadConfig: async (tools, options) => record('config:' + tools + ':' + !!options?.silent),
        loadToolsList: async (page, search) => record('tools:37:' + page + ':' + search),
        loadExternalMCPs: async () => record('external-mcp'), startExternalMcpPoll: () => record('start-mcp'),
        refreshTokenUsage: () => record('token'),
        loadRoles: async () => record('roles'), renderRolesList: () => record('render-roles'),
        initSkillsPagination: () => record('skills-pagination'), loadSkills: () => record('skills'),
        loadKnowledgeCategories: () => record('categories'), loadKnowledgePage: () => record('knowledge:saved:1:23'),
        updateIndexProgress: () => { record('index'); indexTimer = setInterval(() => record('index-tick'), 50); },
        stopKnowledgeIndexPoll: () => { clearInterval(indexTimer); }, loadRetrievalLogs: () => record('retrieval'),
        refreshWorkflows: () => record('workflows'), initC2: page => record('c2:' + page), onError: error => { throw error; },
      });
      const view = load('router/index').createRouterView(router, {
        ready: () => h.ready, initPage: lifecycle.init, invalidatePage: lifecycle.invalidate,
        applyPermissions: root => record('rbac:' + root.id), permissionAllowed: element => !element.hidden,
        abandonConversation: () => record('abandon'), loadConversation: async id => { record('conversation:' + id); if (router.page() === 'chat') router.replaceQuery({ conversation: id }); },
        setActiveProject: id => record('project:' + id), refreshChatProjectSelector: () => record('project-selector'), syncC2Nav: () => record('c2-nav'),
        switchSettingsSection: section => {
          const target = document.getElementById('settings-section-' + section); if (!target) return;
          document.querySelectorAll('.settings-section-content').forEach(node => node.classList.remove('active')); target.classList.add('active');
          if (section === 'token-usage') record('token');
        },
        onNavigation: page => { record('close-drawer'); record('close-sheet'); if (page !== 'chat') record('close-chat'); },
        onError: error => { throw error; },
      }, document);
      return { router, view, start: view.start, dispose() { view.dispose(); lifecycle.dispose(); clearInterval(indexTimer); router.dispose(); } };
    } };
  })();`;
}

const shell = `<!doctype html><html class="initial-route-pending"><head><style>#main-sidebar { width: 180px; } .nav-item-content { min-height: 24px; } .submenu-popup { background: white; }</style></head><body>
  <aside id="main-sidebar"><div class="nav-item" data-page="dashboard"><div class="nav-item-content" data-router-action="navigate" data-router-value="dashboard">Dashboard</div></div>
  <div class="nav-item" data-page="security"><div class="nav-item-content" data-router-action="submenu" data-router-value="security">Security</div><div class="nav-submenu">
  <div class="nav-submenu-item" data-page="hitl" data-router-action="navigate" data-router-value="hitl">HITL</div><div class="nav-submenu-item" data-page="tool-guard" hidden>Hidden</div></div></div></aside>
  <button id="collapse" data-router-action="sidebar">Collapse</button><button id="chat-collapse" data-router-action="conversation-sidebar">Chat list</button>
  <div id="conversation-sidebar"></div><div class="chat-container"></div>
  ${pageIds.map(page => `<section class="page" id="page-${page}"></section>`).join('')}
  <div class="settings-section-content" id="settings-section-token-usage"></div>
  <nav id="m-tabbar"><button class="m-tab" data-tab="dashboard"></button><button class="m-tab" data-tab="hitl"></button></nav>
  <input id="roles-search" value="old"><button id="roles-search-clear"></button><input id="skills-search" value="old"><button id="skills-search-clear"></button>
  </body></html>`;

describe('router browser parity (isolated, in-memory)', () => {
  let browser: Browser;
  let source: string;
  beforeAll(async () => { source = browserSource(); browser = await chromium.launch({ headless: true }); });
  afterAll(async () => { await browser?.close(); });
  async function setup(hash: string, beforeReady = '', directConversation?: string): Promise<Page> {
    const page = await browser.newPage();
    await page.route('http://router.test/**', route => route.fulfill({ contentType: 'text/html', body: shell }));
    await page.goto('http://router.test/#' + hash);
    await page.addScriptTag({ content: source });
    await page.evaluate(() => {
      const h = (globalThis as typeof globalThis & { routerHarness: Harness }).routerHarness;
      h.bridge = h.install();
    });
    if (beforeReady) await page.addScriptTag({ content: beforeReady });
    await page.evaluate(id => {
      const h = (globalThis as typeof globalThis & { routerHarness: Harness }).routerHarness;
      h.bridge.start();
      if (id) h.bridge.view.navigateToConversation(id);
    }, directConversation);
    return page;
  }
  const calls = (page: Page) => page.evaluate(() => (globalThis as typeof globalThis & { routerHarness: Harness }).routerHarness.calls);

  it('restores default route and initializes only once', async () => {
    const page = await setup('');
    await page.evaluate(() => {
      const h = (globalThis as typeof globalThis & { routerHarness: Harness }).routerHarness;
      h.calls.push('auth:' + h.bridge.router.page()); h.bridge.start();
    });
    expect((await calls(page)).filter(call => call === 'dashboard')).toHaveLength(1);
    expect(await calls(page)).toContain('auth:dashboard');
    expect(await page.locator('.page.active').getAttribute('id')).toBe('page-dashboard');
    expect(await page.locator('html').getAttribute('class')).not.toContain('initial-route-pending');
    await page.close();
  });
  it('restores chat/project once, cancels boot restoration on direct conversation navigation, and leaves chat cleanly', async () => {
    const page = await setup('chat?conversation=old&project=p');
    await page.waitForFunction(() => (globalThis as typeof globalThis & { routerHarness: Harness }).routerHarness.calls.includes('conversation:old'));
    expect((await calls(page)).filter(call => call === 'conversation:old')).toHaveLength(1);
    expect(await calls(page)).toContain('project:p');
    await page.evaluate(() => {
      const h = (globalThis as typeof globalThis & { routerHarness: Harness }).routerHarness;
      h.bridge.view.scheduleChatConversationFromHash(100);
      h.bridge.view.navigateToConversation('new');
    });
    await page.waitForTimeout(130);
    expect((await calls(page)).filter(call => call === 'conversation:old')).toHaveLength(1);
    expect((await calls(page)).filter(call => call === 'conversation:new')).toHaveLength(1);
    await page.evaluate(() => (globalThis as typeof globalThis & { routerHarness: Harness }).routerHarness.bridge.router.go('dashboard'));
    expect(await calls(page)).toContain('abandon');
    expect(await page.locator('.chat-container').getAttribute('aria-busy')).toBeNull();
    await page.close();
  });
  it('supersedes boot restoration in the same event loop and never emits synthetic hashchange', async () => {
    const page = await setup('chat?conversation=old', 'addEventListener("hashchange", () => routerHarness.hashEvents++);', 'new');
    await page.waitForTimeout(50);
    expect((await calls(page)).filter(call => call.startsWith('conversation:'))).toEqual(['conversation:new']);
    expect(await page.evaluate(() => (globalThis as typeof globalThis & { routerHarness: Harness }).routerHarness.hashEvents)).toBe(0);
    await page.evaluate(() => { globalThis.location.hash = 'chat?conversation=external'; });
    await page.waitForFunction(() => (globalThis as typeof globalThis & { routerHarness: Harness }).routerHarness.calls.includes('conversation:external'));
    expect((await calls(page)).filter(call => call === 'conversation:external')).toHaveLength(1);
    expect(await page.evaluate(() => (globalThis as typeof globalThis & { routerHarness: Harness }).routerHarness.hashEvents)).toBe(1);
    await page.close();
  });
  it('handles static/dynamic clicks, popup permissions/outside close, sidebars and mobile without inline execution', async () => {
    const page = await setup('dashboard');
    await page.locator('#collapse').click();
    expect(await page.locator('#main-sidebar').getAttribute('class')).toContain('collapsed');
    await page.locator('.nav-item[data-page="security"] .nav-item-content').click();
    expect(await page.locator('.submenu-popup-item').count()).toBe(1);
    await page.locator('.submenu-popup-item').click();
    expect(await page.locator('.page.active').getAttribute('id')).toBe('page-hitl');
    expect(await page.locator('.submenu-popup').count()).toBe(0);
    expect(await page.locator('.m-tab[data-tab="hitl"]').getAttribute('aria-current')).toBe('page');
    expect(await calls(page)).toContain('close-drawer');
    await page.evaluate(() => {
      const button = document.createElement('button'); button.id = 'dynamic'; button.dataset.routerAction = 'navigate'; button.dataset.routerValue = 'skills-management'; document.body.append(button); button.click();
    });
    expect(await page.locator('.page.active').getAttribute('id')).toBe('page-skills-management');
    expect(await page.locator('#dynamic').getAttribute('onclick')).toBeNull();
    expect(await page.locator('#skills-search').inputValue()).toBe('');
    await page.locator('#chat-collapse').click();
    expect(await page.locator('#conversation-sidebar').getAttribute('class')).toContain('collapsed');
    await page.locator('.nav-item[data-page="security"] .nav-item-content').click();
    await page.locator('#chat-collapse').click();
    expect(await page.locator('.submenu-popup').count()).toBe(0);
    await page.close();
  });
  it('loads settings aliases and retained sections once and preserves token query', async () => {
    for (const [hash, hook] of [['settings?section=token-usage', 'token']] as const) {
      const page = await setup(hash);
      expect((await calls(page)).filter(call => call === hook)).toHaveLength(1);
      expect(await page.evaluate(() => {
        const route = (globalThis as typeof globalThis & { routerHarness: Harness }).routerHarness.bridge.router.current();
        return route?.query.toString();
      })).toBe('section=token-usage');
      await page.evaluate(() => (globalThis as typeof globalThis & { routerHarness: Harness }).routerHarness.bridge.router.go('settings'));
      expect((await calls(page)).filter(call => call === hook)).toHaveLength(1);
      await page.evaluate(() => {
        const h = (globalThis as typeof globalThis & { routerHarness: Harness }).routerHarness;
        h.bridge.router.go('dashboard'); h.bridge.router.go('settings');
      });
      expect((await calls(page)).filter(call => call === hook)).toHaveLength(2);
      await page.close();
    }
  });
  it('sequences MCP config/tools with injected pagination and initializes C2', async () => {
    const page = await setup('mcp-management');
    await page.waitForFunction(() => (globalThis as typeof globalThis & { routerHarness: Harness }).routerHarness.calls.includes('tools:37:1:'));
    const log = await calls(page);
    expect(log.indexOf('config:false:true')).toBeLessThan(log.indexOf('external-mcp'));
    expect(log.indexOf('external-mcp')).toBeLessThan(log.indexOf('tools:37:1:'));
    await page.evaluate(() => (globalThis as typeof globalThis & { routerHarness: Harness }).routerHarness.bridge.router.navigate('c2'));
    expect(await calls(page)).toContain('c2:c2-listeners');
    await page.close();
  });
  it('replaces filter queries without reinitializing or breaking click guards', async () => {
    const page = await setup('vulnerabilities');
    await page.addScriptTag({ content: `
      addEventListener('hashchange', () => routerHarness.hashEvents++);
      routerHarness.bridge.router.replaceQuery({ project_id: 'p' });
      document.addEventListener('click', event => { if (event.target.id === 'blocked') event.preventDefault(); }, true);
      document.addEventListener('click', () => routerHarness.calls.push('global-click'));
      const button = document.createElement('button'); button.id = 'blocked'; button.dataset.routerAction = 'navigate'; button.dataset.routerValue = 'chat'; document.body.append(button);
    ` });
    expect(await page.evaluate(() => (globalThis as typeof globalThis & { routerHarness: Harness }).routerHarness.bridge.router.current()?.query.get('project_id'))).toBe('p');
    expect((await calls(page)).filter(call => call === 'vulnerabilities')).toHaveLength(1);
    await page.locator('#blocked').click();
    expect(await page.locator('.page.active').getAttribute('id')).toBe('page-vulnerabilities');
    expect((await calls(page)).filter(call => call === 'global-click')).toHaveLength(1);
    expect(await page.evaluate(() => (globalThis as typeof globalThis & { routerHarness: Harness }).routerHarness.hashEvents)).toBe(0);
    await page.close();
  });
  it('owns page loads once, cleans knowledge polling and remounts without duplicate navigation listeners', async () => {
    const page = await setup('dashboard');
    await page.evaluate(() => (globalThis as typeof globalThis & { routerHarness: Harness }).routerHarness.bridge.router.go('roles-management'));
    expect((await calls(page)).filter(call => call === 'roles')).toHaveLength(1);
    expect(await calls(page)).not.toContain('duplicate-role-wrapper');
    await page.evaluate(() => (globalThis as typeof globalThis & { routerHarness: Harness }).routerHarness.bridge.router.go('knowledge-management'));
    expect(await calls(page)).toContain('knowledge:saved:1:23');
    expect(await calls(page)).not.toContain('knowledge-wrapper');
    await page.evaluate(() => (globalThis as typeof globalThis & { routerHarness: Harness }).routerHarness.bridge.router.go('knowledge-retrieval-logs'));
    expect(await calls(page)).toContain('retrieval');
    await page.waitForTimeout(100);
    expect(await calls(page)).not.toContain('index-tick');
    await page.evaluate(() => (globalThis as typeof globalThis & { routerHarness: Harness }).routerHarness.bridge.router.go('workflows'));
    expect((await calls(page)).filter(call => call === 'workflows')).toHaveLength(1);
    await page.evaluate(() => { const h = (globalThis as typeof globalThis & { routerHarness: Harness }).routerHarness; h.bridge.dispose(); h.bridge = h.install(); h.bridge.start(); h.bridge.start(); });
    await page.locator('.nav-item[data-page="dashboard"] .nav-item-content').click();
    expect((await calls(page)).filter(call => call === 'dashboard')).toHaveLength(2);
    await page.close();
  });
  it('guards pending i18n work, stale settings requests, and disposed timers/listeners', async () => {
    const page = await setup('mcp-management', 'routerHarness.ready = new Promise(resolve => {routerHarness.resolveReady = resolve;});');
    await page.evaluate(() => {
      const h = (globalThis as typeof globalThis & { routerHarness: Harness }).routerHarness;
      h.bridge.router.go('dashboard'); h.resolveReady();
    });
    expect(await calls(page)).not.toContain('config:false:true');
    expect(await calls(page)).toContain('dashboard');
    await page.evaluate(() => (globalThis as typeof globalThis & { routerHarness: Harness }).routerHarness.bridge.dispose());
    await page.locator('#collapse').click();
    expect(await page.locator('#main-sidebar').evaluate(element => element.classList.contains('collapsed'))).toBe(false);
    await page.close();
  });
  it('leaves deletion shortcuts to the mounted workflow editor and guards HITL event disposal', async () => {
    const result = await build({
      configFile: false, root: fileURLToPath(new URL('../../', import.meta.url)), logLevel: 'silent',
      resolve: { alias: { '@': fileURLToPath(new URL('../', import.meta.url)) } },
      plugins: [{ name: 'router-composition-fixture', resolveId(id) { if (id === 'router-composition-fixture') return '\0router-composition-fixture'; }, load(id) {
        if (id !== '\0router-composition-fixture') return;
        return `import { createDomainApplication } from '/src/app/domains/index.ts';
          const h = globalThis.compositionHarness = { deletes: 0, refreshes: 0 };
          const chat = {
            initializeChatUI() {}, refreshChatConfig: async () => {}, loadConversations() {}, loadActiveTasks() {}, loadConversation() {}, startNewConversation() {},
            currentConversationId: () => '', abandonConversation() {}, conversationsSearchQuery: () => '', setConversationProjectFilter() {}, refreshConversationProjectFilter() {}, refreshAllProjectFilterSelects() {},
            getConversationProjectId: () => '', setConversationProjectId() {}, onConversationProjectBindingChanged() {}, refreshChatWelcomeEmptyState() {}, openConversationContextMenu() {},
            formatProjectName: name => name, applyProjectName() {}, closeChatReasoningPanel() {}, roleChanged() {}, sendMessage: async () => {}, requireExecutionEvidence() {},
            refreshChatProjectFoldersAfterAction() {}, showMCPDetail() {}, cancelMCPToolExecution() {}, closeMCPDetail() {}, refreshProgressAndTimelineI18n() {}, initChatFilesPage() {},
            populateChatChannels() {}, refreshMentionTools() {}, reasoning: () => ({}), hitl: {},
          };
          h.app = createDomainApplication({ doc: document, i18nReady: Promise.resolve(), chat, permissionAllowedForElement: () => true, cycleTheme() {}, selectLanguage() {} });
          h.app.workflows.hooks.deleteWorkflowSelection = () => { h.deletes++; };
          h.app.hitl.view.refreshActivePanel = async () => { h.refreshes++; };
          void h.app.start(); void h.app.start();
          document.body.dataset.ready = 'true';`;
      } }],
      build: { write: false, minify: false, rolldownOptions: { input: 'router-composition-fixture', output: { codeSplitting: false } } },
    });
    const outputs = Array.isArray(result) ? result : [result];
    const bundle = outputs.flatMap(output => 'output' in output ? output.output : []).filter(chunk => chunk.type === 'chunk').map(chunk => chunk.code).join('\n');
    const page = await browser.newPage();
    type CompositionHarness = { app: import('../app/domains').DomainApplication; deletes: number; refreshes: number };
    const h = () => page.evaluate(() => { const h = (globalThis as typeof globalThis & { compositionHarness: CompositionHarness }).compositionHarness; return { deletes: h.deletes, refreshes: h.refreshes }; });
    try {
      await page.route('http://composition.test/**', route => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/') return route.fulfill({ contentType: 'text/html', body: shell + '<input id="focused"><div contenteditable="true" id="editable"></div><script type="module" src="/fixture.js"></script>' });
        if (path === '/fixture.js') return route.fulfill({ contentType: 'text/javascript', body: bundle });
        return route.fulfill({ json: path === '/api/auth/status' ? { authenticated: false } : {} });
      });
      await page.goto('http://composition.test/#workflows'); await page.waitForSelector('body[data-ready="true"]');
      await page.keyboard.press('Delete'); expect((await h()).deletes).toBe(0);
      await page.locator('#focused').focus(); await page.keyboard.press('Backspace'); expect((await h()).deletes).toBe(0);
      await page.locator('#editable').focus(); await page.keyboard.press('Delete'); expect((await h()).deletes).toBe(0);
      await page.evaluate(() => { const h = (globalThis as typeof globalThis & { compositionHarness: CompositionHarness }).compositionHarness; h.app.router.switchPage('hitl'); });
      const before = (await h()).refreshes;
      await page.evaluate(() => dispatchEvent(new Event('hitl-interrupt'))); expect((await h()).refreshes).toBe(before + 1);
      await page.evaluate(async () => { const h = (globalThis as typeof globalThis & { compositionHarness: CompositionHarness }).compositionHarness; await h.app.dispose(); dispatchEvent(new Event('hitl-interrupt')); });
      expect((await h()).refreshes).toBe(before + 1);
    } finally { await page.close(); }
  }, 60000);
});
