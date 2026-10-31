import { test, expect } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parse, serialize, type DefaultTreeAdapterTypes } from 'parse5';
import type { initAssets, AssetsDependencies } from './index';
import type { initVulnerability } from '../vulnerability';
import type { initInfoCollect } from '../info-collect';

interface Harness {
  create(): Promise<{ assets: ReturnType<typeof initAssets>; vulnerability: ReturnType<typeof initVulnerability>; infoCollect: ReturnType<typeof initInfoCollect>; activate(): void; dispose(): void }>;
  deps: AssetsDependencies; requests: number; conversation: string; accepted: boolean;
}

let server: ViteDevServer, address: string, cache: string;
test.beforeAll(async () => {
  cache = await mkdtemp(join(tmpdir(), 'opencode', 'assets-vite-'));
  const tree = parse(await readFile(new URL('../../../index.html', import.meta.url), 'utf8'));
  const clean = (node: DefaultTreeAdapterTypes.Node) => { if (!('childNodes' in node)) return; node.childNodes = node.childNodes.filter(child => !('tagName' in child) || !['script', 'link'].includes(child.tagName)); node.childNodes.forEach(clean); }; clean(tree);
  const shell = serialize(tree).replace('</head>', '<style>.page { display:none } .page.active {display:block} .modal,.info-collect-cell-modal{display:none} [hidden]{display:none!important}</style></head>');
  server = await createServer({ configFile: false, root: process.cwd(), cacheDir: cache, resolve: { alias: { '@': resolve('src') } }, optimizeDeps: { entries: ['src/features/assets/index.ts'] }, server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'step7-isolated-shell', configureServer(instance) { instance.middlewares.use('/__step7__', (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(shell); }); } }] });
  await server.listen(); const socket = server.httpServer?.address(); if (!socket || typeof socket === 'string') throw new Error('Missing isolated server'); address = `http://127.0.0.1:${socket.port}/__step7__`;
});
test.afterAll(async () => { await server?.close(); if (cache) await rm(cache, { recursive: true, force: true }); });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const h: Harness = (globalThis as typeof globalThis & { assetsHarness: Harness }).assetsHarness = {
      requests: 0, conversation: '', accepted: false, deps: undefined as unknown as AssetsDependencies,
      async create() {
        const assetsUrl = '/src/features/assets/index.ts', vulnerabilityUrl = '/src/features/vulnerability/index.ts', infoUrl = '/src/features/info-collect/index.ts';
        const [{ initAssets }, { initVulnerability }, { initInfoCollect }] = await Promise.all([
          import(/* @vite-ignore */ assetsUrl) as Promise<typeof import('./index')>,
          import(/* @vite-ignore */ vulnerabilityUrl) as Promise<typeof import('../vulnerability')>,
          import(/* @vite-ignore */ infoUrl) as Promise<typeof import('../info-collect')>,
        ]);
        h.deps = { request: (path, init) => { h.requests++; return fetch(path, init); },
          storage: { get: key => localStorage.getItem(key), set: (key, value) => { localStorage.setItem(key, value); return true; }, remove: key => { localStorage.removeItem(key); return true; } },
          t: key => key, locale: () => 'en-US', can: () => true, alert: message => alert(message), confirm: message => confirm(message), prompt: message => prompt(message),
          applyPermissions() {}, enhanceSelect() {}, syncSelect() {}, closeSelects() {}, refreshSelects() {}, paginationSelects() {},
          hash: () => location.hash, setHash: hash => { location.hash = hash; }, replaceHash: hash => history.replaceState(null, '', hash),
          onResize: listener => { addEventListener('resize', listener); return () => removeEventListener('resize', listener); }, copy: async () => {},
          switchPage() {}, loadConversation: async id => { h.conversation = id; }, navigateConversation: async id => { h.conversation = id; },
          currentConversation: () => h.conversation, startConversation: async () => {},
          sendMessage: options => { options?.onRequestAccepted(); h.accepted = true; return new Promise(() => {}); },
          requireExecutionEvidence() {}, refreshConversations() {}, showQueue() {}, currentRole: () => '', activeProject: () => '',
          refreshProjectAssets: async () => {}, openProjectFact: async () => {}, robotEnabled: () => false, notify() {},
        };
        const assets = initAssets(document, h.deps), vulnerability = initVulnerability(document, h.deps), infoCollect = initInfoCollect(document, h.deps);
        return { assets, vulnerability, infoCollect, activate() { assets.activate(); vulnerability.activate(); infoCollect.activate(); }, dispose() { assets.dispose(); vulnerability.dispose(); infoCollect.dispose(); } };
      },
    };
  });
});

test('literal shell actions, lazy dependencies, CRUD, selection and disposal', async ({ page }) => {
  const errors: string[] = [], writes: { path: string; method: string; body: unknown }[] = []; page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
  const asset = { id: 'a1', host: 'https://a.test', ip: '', domain: 'a.test', port: 443, protocol: 'https', title: 'Asset title', server: 'nginx', project_id: 'p1', project_name: 'Project', responsible_person: 'Owner', department: 'Team', tags: [], source: 'manual', status: 'active', vulnerability_count: 1, risk_level: 'high', first_seen_at: '2026-01-01', last_seen_at: '2026-02-01' };
  await page.route('**/api/**', async route => { const req = route.request(), url = new URL(req.url()); if (req.method() !== 'GET') writes.push({ path: url.pathname, method: req.method(), body: req.postDataJSON() }); await route.fulfill({ json: url.pathname === '/api/projects' ? { projects: [{ id: 'p1', name: 'Project' }] } : url.pathname === '/api/assets' ? { assets: [asset], total: 1, page: 1, total_pages: 1 } : url.pathname === '/api/assets/import' ? { created: 1, updated: 0, skipped: 0 } : {} }); });
  await page.goto(address);
  const result = await page.evaluate(async () => {
    const h = (globalThis as typeof globalThis & { assetsHarness: Harness }).assetsHarness, feature = await h.create();
    const before = h.requests; feature.activate(); feature.activate(); await feature.assets.view.load();
    const value = (id: string, value: string) => { const el = document.getElementById(id); if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) el.value = value; };
    await feature.assets.view.openEditor(); value('asset-edit-target', 'https://new.test:8443'); await feature.assets.view.save();
    const checkbox = document.querySelector<HTMLInputElement>('#asset-table-body input'); if (checkbox) { checkbox.checked = true; checkbox.dispatchEvent(new Event('change', { bubbles: true })); }
    const selected = feature.assets.service.state.selected.size;
    const target = document.querySelector<HTMLButtonElement>('#asset-table-body .asset-target-link'); target?.click(); const detail = document.getElementById('asset-detail-grid')?.textContent;
    const inline = document.querySelectorAll('#page-asset-library [onclick],#page-asset-library [onchange],#asset-editor-modal [onclick],#asset-editor-modal [onsubmit],#asset-import-modal [onclick],#asset-import-modal [onchange]').length;
    const active = h.requests; feature.dispose(); checkbox?.dispatchEvent(new Event('change', { bubbles: true }));
    const after = h.requests, fresh = await h.create(); fresh.activate(); fresh.activate();
    const isolated = fresh.assets.service.state.selected.size; fresh.dispose();
    return { before, selected, detail, inline, active, after, isolated };
  });
  expect(result).toMatchObject({ before: 0, selected: 1, inline: 0, isolated: 0 }); expect(result.detail).toContain('Owner'); expect(result.active).toBe(result.after); expect(writes.some(w => w.path === '/api/assets/import' && (w.body as { assets: { host: string }[] }).assets[0]?.host === 'https://new.test:8443')).toBe(true); expect(errors).toEqual([]);
});

test('real XLSX upload, bilingual preview, invalid rows and import mapping', async ({ page }) => {
  const writes: unknown[] = []; page.on('dialog', dialog => dialog.accept());
  await page.route('**/api/**', async route => { const req = route.request(), url = new URL(req.url()); if (url.pathname === '/api/assets/import') writes.push(req.postDataJSON()); await route.fulfill({ json: url.pathname === '/api/projects' ? { projects: [{ id: 'p1', name: 'Project' }] } : url.pathname === '/api/assets/import' ? { created: 1, updated: 0, skipped: 0 } : { assets: [], total: 0, page: 1 } }); });
  await page.goto(address);
  const result = await page.evaluate(async () => {
    const feature = await (globalThis as typeof globalThis & { assetsHarness: Harness }).assetsHarness.create(); feature.activate(); await feature.assets.view.openImport();
    const xlsxUrl = '/node_modules/xlsx/xlsx.mjs', xlsx = await import(/* @vite-ignore */ xlsxUrl) as typeof import('xlsx'); const book = xlsx.utils.book_new(); xlsx.utils.book_append_sheet(book, xlsx.utils.aoa_to_sheet([['\u76ee\u6807', '\u9879\u76ee', '\u72b6\u6001'], ['https://import.test', 'Project', '\u6d3b\u8dc3'], ['https://invalid.test', '', 'invalid'], ['', '', '']]), 'Assets'); const bytes = xlsx.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    await feature.assets.view.handleImportFile(new File([bytes], 'assets.xlsx')); const preview = document.getElementById('asset-import-preview-body')?.textContent, count = feature.assets.service.state.importRows.length; await feature.assets.view.submitImport(); feature.dispose(); return { preview, count };
  });
  expect(result.count).toBe(2); expect(result.preview).toContain('https://import.test'); expect(result.preview).toContain('https://invalid.test'); expect(writes[0]).toMatchObject({ assets: [{ host: 'https://import.test', project_id: 'p1', status: 'active' }], source: 'manual-import', source_query: 'assets.xlsx' });
});

test('vulnerability status/details, facts, filters and accepted retest stream', async ({ page }) => {
  const errors: string[] = [], writes: { path: string; method: string; body: unknown }[] = []; page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
  const vuln = { id: 'v1', title: 'Finding', description: 'Description', severity: 'high', status: 'open', conversation_id: 'c1', project_id: 'p1', type: 'xss', target: 'https://a', preconditions: 'pre', reproduction_steps: 'steps', evidence: 'GET /', impact: 'impact', recommendation: 'fix', retest_notes: 'Verify fix carefully', retest_log: 'Previous verification', created_at: '2026-01-01', updated_at: '2026-02-01' };
  await page.route('**/api/**', async route => { const req = route.request(), url = new URL(req.url()); if (req.method() !== 'GET') writes.push({ path: url.pathname, method: req.method(), body: req.postDataJSON() }); let result: unknown = {}; if (url.pathname === '/api/projects') result = { projects: [{ id: 'p1', name: 'Project' }] }; else if (url.pathname === '/api/vulnerabilities') result = { vulnerabilities: [vuln], total: 1, page: 1, page_size: 20, total_pages: 1 }; else if (url.pathname.endsWith('/stats')) result = { total: 1, by_severity: { high: 1 } }; else if (url.pathname.endsWith('/facts')) result = [{ fact_key: 'fact/a', summary: 'Related fact' }]; else if (url.pathname.endsWith('/retest')) result = { conversation: { id: 'branch' }, prompt: 'resolved retest prompt' }; else if (url.pathname === '/api/vulnerabilities/v1') result = vuln; await route.fulfill({ json: result }); });
  await page.goto(address);
  const result = await page.evaluate(async () => {
    const h = (globalThis as typeof globalThis & { assetsHarness: Harness }).assetsHarness, feature = await h.create();
    feature.activate(); await feature.vulnerability.view.initPage();
    const toggle = document.querySelector<HTMLButtonElement>('.vuln-status-picker-trigger'); toggle?.click(); const pickerOpen = document.querySelector('.vuln-status-picker')?.classList.contains('open');
    const picker = document.querySelector<HTMLElement>('.vuln-status-picker'); if (picker) await feature.vulnerability.view.changeStatus('v1', 'confirmed', picker);
    feature.vulnerability.view.expand('v1'); await new Promise(resolve => setTimeout(resolve, 100)); const facts = document.getElementById('vuln-related-facts-v1')?.textContent;
    await feature.vulnerability.view.openRetest('v1'); const guidance = document.querySelector<HTMLTextAreaElement>('#vulnerability-retest-prompt')?.value; await feature.vulnerability.view.confirmRetest();
    const input = document.querySelector<HTMLTextAreaElement>('#chat-input')?.value; const locked = feature.vulnerability.service.state.retestSubmitting;
    const inline = document.querySelectorAll('#page-vulnerabilities [onclick],#page-vulnerabilities [onchange],#vulnerability-modal [onclick]').length; feature.dispose(); return { accepted: h.accepted, guidance, input, locked, facts, pickerOpen, inline };
  });
  expect(result).toMatchObject({ accepted: true, locked: false, input: 'resolved retest prompt', pickerOpen: true, inline: 0 }); expect(result.guidance).toContain('Verify fix carefully'); expect(result.facts).toContain('Related fact'); expect(writes.some(w => w.path === '/api/vulnerabilities/v1/retest')).toBe(true); expect(writes.some(w => (w.body as { status?: string }).status === 'confirmed')).toBe(true); expect(errors).toEqual([]);
});

test('unchanged demo mock: all recon providers, column selection/import and parse UI', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept()); await page.goto(address);
  const result = await page.evaluate(async () => {
    const mockUrl = '/src/mock/index.ts', mock = await import(/* @vite-ignore */ mockUrl) as { installMock(): void }; mock.installMock();
    const feature = await (globalThis as typeof globalThis & { assetsHarness: Harness }).assetsHarness.create(); feature.activate(); feature.infoCollect.view.initPage();
    const counts: number[] = []; for (const provider of ['fofa', 'zoomeye', 'quake', 'shodan']) { const select = document.getElementById('fofa-provider'); if (select instanceof HTMLSelectElement) { select.value = provider; select.dispatchEvent(new Event('change', { bubbles: true })); } feature.infoCollect.view.applyQuery('domain="example.com"'); await feature.infoCollect.view.search(); counts.push(feature.infoCollect.service.state.currentPayload?.results.length || 0); }
    feature.infoCollect.service.selectAll(true); await feature.infoCollect.view.importRows([0]); const first = feature.infoCollect.service.state.currentPayload?.fields[0]; if (first) { feature.infoCollect.service.toggleColumn(first, false); feature.infoCollect.view.render(); }
    const nl = document.getElementById('fofa-nl'); if (nl instanceof HTMLTextAreaElement) nl.value = 'Find Apache services'; await feature.infoCollect.view.parse(); const parse = !!document.getElementById('fofa-parse-modal'), inline = document.querySelectorAll('#page-info-collect [onclick],#page-info-collect [onchange]').length;
    await feature.assets.view.load(); await feature.vulnerability.view.initPage(); const assets = feature.assets.service.state.total, vulns = feature.vulnerability.service.state.pagination.total; feature.dispose(); return { counts, parse, inline, assets, vulns };
  });
  expect(result.counts.every(count => count > 0)).toBe(true); expect(result.parse).toBe(true); expect(result.inline).toBe(0); expect(result.assets).toBeGreaterThan(0); expect(result.vulns).toBeGreaterThan(0); expect(errors).toEqual([]);
});
