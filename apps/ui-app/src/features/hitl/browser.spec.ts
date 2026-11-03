import { test, expect, type Page } from '@playwright/test';
import { rolldown } from 'rolldown';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Hitl as HitlBridge } from './index';
import type { HitlConfig, HitlDependencies } from './types';

type Call = { url: string; method: string; body: Record<string, unknown> };
type Harness = typeof globalThis & {
  hitlTestBundle: { initHitl(doc: Document, deps: HitlDependencies): HitlBridge };
  mount(): void;
  deps: HitlDependencies;
  bridge: HitlBridge;
  calls: Call[];
  alerts: string[];
  reviewerBindings: number;
  appliedConfig: HitlConfig | null;
  workflowCalls: string[];
  language: string;
};
let bundle = '';
const browserErrors = new WeakMap<Page, string[]>();
const shell = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
const hitlShell = shell.slice(shell.indexOf('<div id="page-hitl"'), shell.indexOf('<!-- MCP status monitor page -->'));
test.beforeAll(async () => {
  const build = await rolldown({ input: fileURLToPath(new URL('./index.ts', import.meta.url)) });
  const result = await build.generate({ format: 'iife', name: 'hitlTestBundle', footer: 'globalThis.hitlTestBundle = hitlTestBundle;' });
  const chunk = result.output.find(item => item.type === 'chunk'); if (!chunk || chunk.type !== 'chunk') throw new Error('Missing HITL bundle');
  bundle = chunk.code; await build.close();
});
test.beforeEach(async ({ page }) => {
  const errors: string[] = []; browserErrors.set(page, errors); page.on('pageerror', error => errors.push(error.message));
  await page.route('http://hitl.test/', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body>' + hitlShell + '</body></html>' }));
  await page.goto('http://hitl.test/'); await page.addScriptTag({ content: bundle });
  await page.evaluate(() => {
    const h = globalThis as Harness;
    h.calls = []; h.alerts = []; h.reviewerBindings = 0; h.appliedConfig = null; h.workflowCalls = []; h.language = 'en';
    const cfg: HitlConfig = { mode: 'approval', reviewer: 'human', sensitiveTools: 'session', timeoutSeconds: 300 };
    h.deps = {
      getCurrentConversationId: () => 'conv-1', currentPage: () => 'hitl',
      storage: { get: key => localStorage.getItem(key), set: (key, value) => { localStorage.setItem(key, value); return true; }, remove: key => { localStorage.removeItem(key); return true; } },
      translate: (key: string) => h.language === 'zh' && key === 'hitl.approve' ? '\u6279\u51c6' : key,
      getLocale: () => 'en-US', alert: (message: string) => { h.alerts.push(message); }, confirm: () => true,
      getConversationConfig: () => cfg, saveConversationConfigLocally: (_id: string, config: HitlConfig) => { h.appliedConfig = config; },
      readConfigFromForm: () => cfg, bindReviewerToggleListeners: () => { h.reviewerBindings++; },
      attachRunningTaskEventStream: async () => true,
      navigate: (page: string) => { h.workflowCalls.push('navigate:' + page); }, loadConversation: async (id: string) => { h.workflowCalls.push('load:' + id); },
      now: Date.now, sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
      request: async (url: string, options: RequestInit = {}) => {
        const body = options.body ? JSON.parse(String(options.body)) as Record<string, unknown> : {};
        const call: Call = { url, method: options.method || 'GET', body }; h.calls.push(call);
        const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
        if (url === '/api/hitl/default-config') return json({ defaultMode: 'approval', defaultReviewer: 'human', defaultTimeoutSeconds: 300, auditBackend: 'typesafe', hitlGlobalToolWhitelist: ['read'] });
        if (url.startsWith('/api/hitl/pending?')) return json({ total: 1, items: [{ id: 'q\'"<&', conversationId: 'conv-1', toolName: '<script>bad</script>', mode: 'review_edit', payload: '{"userMessage":"<img onerror=bad>","thinking":"plan","executionResult":{"success":true,"result":"done"}}' }] });
        if (url === '/api/workflows/runs/pending') return json({ runs: [{ id: 'wf/id', conversation_id: 'wf-conv', pending_hitl_json: '{"pendingHitl":{"label":"Release","prompt":"Confirm release"}}' }] });
        if (url === '/api/hitl/decision' && body.interruptId === 'old') return json({ error: 'already resolved' }, 409);
        if (url === '/api/hitl/decision' && body.interruptId === 'denied') return json({ error: 'forbidden' }, 403);
        if (url.startsWith('/api/hitl/logs?') && call.method === 'GET') return json({ total: 60, retentionDays: 14, items: [{ id: 'log/1', toolName: 'exec', conversationId: 'conv-1', decidedBy: 'audit_agent', decision: 'approve', comment: 'Jev choice=1', payload: '{"userMessage":"hello","executionResult":{"success":true,"result":"output"}}' }, { id: 'log-2', decision: 'reject', decidedBy: 'system', comment: '' }] });
        if (url.startsWith('/api/hitl/logs/') && call.method === 'GET') return json({ id: decodeURIComponent(url.split('/').pop() || ''), toolName: 'exec', decidedBy: 'audit_agent', decision: 'reject', comment: 'Jev choice=1', payload: '{"userMessage":"<script>bad</script>","reasoningChain":"reason","executionResult":{"success":false,"result":"failed"}}' });
        if (url.startsWith('/api/hitl/logs') && call.method === 'DELETE') return json({ deleted: 2 });
        if (url === '/api/hitl/audit-strategy') return json({ auditAgentPrompt: body.auditAgentPrompt ?? 'approval custom', auditAgentPromptReviewEdit: body.auditAgentPromptReviewEdit ?? 'review custom', defaultAuditAgentPrompt: 'approval default', defaultAuditAgentPromptReviewEdit: 'review default' });
        if (url === '/api/hitl/tool-whitelist') return json({ toolWhitelist: body.toolWhitelist ?? ['read'] });
        if (url.startsWith('/api/config/tools?')) return json({ total_pages: 1, tools: [{ name: 'read' }, { name: 'new' }, { name: '<unsafe>' }, { name: 'scan', is_external: true, external_mcp: 'lab' }] });
        return json({ ok: true });
      },
    };
    h.mount = () => { h.bridge = h.hitlTestBundle.initHitl(document, h.deps); };
    h.mount();
  });
});
test.afterEach(async ({ page }) => { expect(browserErrors.get(page)).toEqual([]); });
async function activate(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(async () => { const h = globalThis as Harness; await h.bridge.afterClassicScripts(); });
}

test('deferred activation binds actual shell controls once and retains safe dynamic approval actions', async ({ page }) => {
  expect(await page.evaluate(() => (globalThis as Harness).calls.length)).toBe(0);
  await activate(page); await activate(page);
  expect(await page.evaluate(() => { const h = globalThis as Harness; return h.calls.filter(c => c.url === '/api/hitl/default-config').length; })).toBe(1);
  await expect(page.locator('#page-hitl [onclick], #page-hitl [onkeydown], #hitl-log-modal [onclick]')).toHaveCount(0);
  expect(await page.evaluate(() => { const h = globalThis as Harness; return h.bridge.afterClassicScripts() === h.bridge.afterClassicScripts(); })).toBe(true);
  await page.locator('#hitl-refresh-btn').click();
  await expect(page.locator('.hitl-pending-item')).toHaveCount(2);
  await expect(page.locator('#hitl-pending-list [onclick], #hitl-pending-list [oninput]')).toHaveCount(0);
  await expect(page.locator('.hitl-tool-badge').last()).toHaveText('<script>bad</script>');
  await expect(page.locator('#hitl-pending-list script, #hitl-pending-list img')).toHaveCount(0);
  await page.locator('.hitl-edit-args').fill('[]'); await page.locator('[data-action="hitl.decide"][data-decision="approve"]').click();
  expect(await page.evaluate(() => (globalThis as Harness).alerts)).toEqual(['Invalid JSON arguments']);
  await page.locator('.hitl-edit-args').fill('{"command":"ls"}'); await page.locator('.hitl-inline-comment').last().fill('read only');
  await page.locator('[data-action="hitl.decide"][data-decision="approve"]').click();
  await expect.poll(() => page.evaluate(() => (globalThis as Harness).calls.filter(c => c.url === '/api/hitl/decision').map(c => c.body))).toEqual([{ interruptId: 'q\'"<&', decision: 'approve', comment: 'read only', editedArguments: { command: 'ls' } }]);
  await expect(page.locator('#hitl-pending-count')).toHaveText('2');
});

test('typed decisions return success/error booleans, dismiss conflicts and preserve workflow fallback and injected callback', async ({ page }) => {
  await activate(page);
  const outcomes = await page.evaluate(async () => {
    const h = globalThis as Harness;
    const ok = await h.bridge.view.submitDecisionWithPayload('embedded', 'reject', 'stop', null, 'conv-1');
    const old = await h.bridge.view.submitDecisionWithPayload('old', 'approve');
    const denied = await h.bridge.view.submitDecisionWithPayload('denied', 'approve');
    return [ok, old, denied];
  });
  expect(outcomes).toEqual([true, true, false]);
  expect(await page.evaluate(() => (globalThis as Harness).calls.filter(c => c.url === '/api/hitl/dismiss').map(c => c.body))).toEqual([{ interruptId: 'old' }]);
  await page.locator('#hitl-refresh-btn').click(); await page.locator('[data-action="hitl.workflow-decide"][data-decision="reject"]').click();
  await expect.poll(() => page.evaluate(() => (globalThis as Harness).calls.filter(c => c.url === '/api/workflows/runs/wf%2Fid/resume').map(c => c.body))).toEqual([{ approved: false, comment: '' }]);
  await page.evaluate(() => { const h = globalThis as Harness; h.deps.submitWorkflowDecision = async (id, approved, comment) => { h.workflowCalls.push(`${id}:${approved}:${comment}`); }; });
  await page.locator('.hitl-pending-item--workflow [data-action="hitl.open-conversation"]').click();
  await expect.poll(() => page.evaluate(() => (globalThis as Harness).workflowCalls)).toEqual(['navigate:chat', 'load:wf-conv']);
  await page.locator('[data-action="hitl.workflow-decide"][data-decision="approve"]').click();
  await expect.poll(() => page.evaluate(() => (globalThis as Harness).workflowCalls)).toContain('wf/id:true:');
});

test('history native filters, selection, decision context, details, filtered clear and page-size persistence', async ({ page }) => {
  await activate(page); await page.locator('#hitl-tab-logs').click();
  await expect(page.locator('.hitl-log-checkbox')).toHaveCount(2); await expect(page.locator('#hitl-logs-retention-hint')).toHaveText(/14 days/);
  await expect(page.locator('.hitl-logs-summary').first()).toHaveText('Jev choice=1');
  await page.locator('#hitl-logs-decision-filter').selectOption('reject');
  await expect.poll(() => page.evaluate(() => (globalThis as Harness).calls.some(c => c.url.includes('decision=reject') && c.method === 'GET'))).toBe(true);
  await page.locator('#hitl-logs-select-all').check(); await expect(page.locator('#hitl-logs-selected-count')).toHaveText('2 selected');
  await page.locator('.hitl-log-checkbox').last().uncheck(); await expect(page.locator('#hitl-logs-select-all')).toHaveJSProperty('indeterminate', true);
  await page.locator('[data-action="hitl.log-detail"]').first().click(); await expect(page.locator('#hitl-log-modal')).toHaveCSS('display', 'flex');
  await expect(page.locator('#hitl-log-detail-id')).toHaveText('log/1'); await expect(page.locator('#hitl-log-detail-engine')).toHaveText('TypeSafe Jev · jev-latest');
  await expect(page.locator('#hitl-log-context-readonly')).toContainText('<script>bad</script>'); await expect(page.locator('#hitl-log-execution-readonly')).toContainText('failed'); await expect(page.locator('#hitl-log-modal script')).toHaveCount(0);
  await page.locator('#hitl-log-modal .modal-close').click(); await expect(page.locator('#hitl-log-modal')).toHaveCSS('display', 'none');
  await page.locator('[data-action="hitl.batch-delete"]').click();
  await expect.poll(() => page.evaluate(() => (globalThis as Harness).calls.filter(c => c.method === 'DELETE').map(c => c.body))).toEqual([{ ids: ['log/1'] }]);
  await page.locator('#hitl-logs-page-size').selectOption('50'); expect(await page.evaluate(() => localStorage.getItem('raptix_hitl_logs_page_size'))).toBe('50');
  await page.locator('[data-action="hitl.clear-logs"]').click();
  await expect.poll(() => page.evaluate(() => (globalThis as Harness).calls.filter(c => c.method === 'DELETE').map(c => ({ url: c.url, body: c.body })))).toEqual([{ url: '/api/hitl/logs', body: { ids: ['log/1'] } }, { url: '/api/hitl/logs?decision=reject', body: { all: true } }]);
});

test('strategy prompt modes, resets, save feedback, whitelist scope, language and typed panel refresh', async ({ page }) => {
  await activate(page); await expect(page.locator('#hitl-page-audit-engine')).toContainText('TypeSafe Jev');
  await page.locator('#hitl-tab-policy').click(); await expect(page.locator('#hitl-audit-agent-prompt')).toHaveValue('approval custom');
  await page.locator('#hitl-strategy-tab-review-edit').click(); await expect(page.locator('#hitl-audit-agent-prompt')).toBeHidden();
  await page.locator('#hitl-strategy-reset-btn').click(); await expect(page.locator('#hitl-audit-agent-prompt-review-edit')).toHaveValue('review default');
  await page.locator('#hitl-audit-agent-prompt-review-edit').fill('restrict edits'); await page.locator('#hitl-strategy-save-btn').click();
  await expect(page.locator('#hitl-strategy-feedback')).toHaveText('Audit strategy saved.');
  expect(await page.evaluate(() => (globalThis as Harness).calls.find(c => c.url === '/api/hitl/audit-strategy' && c.method === 'PUT')?.body)).toEqual({ auditAgentPrompt: 'approval custom', auditAgentPromptReviewEdit: 'restrict edits' });
  await expect(page.locator('#hitl-selected-tools')).toContainText('read');
  await expect(page.locator('#hitl-selected-tools')).toContainText('session');
  await expect(page.locator('#hitl-whitelist-scope-hint')).toContainText('clears that conversation');
  await page.getByRole('button', { name: 'Remove session', exact: true }).click();
  await page.locator('#hitl-tool-search').fill('new');
  await page.locator('#hitl-tool-options').getByRole('checkbox', { name: 'new', exact: true }).check();
  await page.locator('#hitl-page-whitelist-save-btn').click();
  await expect(page.locator('#hitl-page-whitelist-feedback')).toHaveText('Whitelist saved.');
  expect(await page.evaluate(() => (globalThis as Harness).appliedConfig)).toMatchObject({ mode: 'approval', reviewer: 'human', sensitiveTools: '', timeoutSeconds: 300 });
  expect(await page.evaluate(() => (globalThis as Harness).calls.find(c => c.url === '/api/hitl/tool-whitelist' && c.method === 'PUT')?.body)).toEqual({ toolWhitelist: ['read', 'new'] });
  await page.locator('#hitl-tab-pending').click();
  await page.evaluate(() => { const h = globalThis as Harness; h.language = 'zh'; document.dispatchEvent(new Event('languagechange')); });
  await expect(page.locator('[data-action="hitl.decide"][data-decision="approve"]')).toHaveText('\u6279\u51c6');
  const before = await page.evaluate(() => (globalThis as Harness).calls.length);
  await page.evaluate(() => (globalThis as Harness).bridge.view.refreshActivePanel());
  await expect.poll(() => page.evaluate(() => (globalThis as Harness).calls.length)).toBeGreaterThan(before);
});

test('three keyboard-accessible tabs, explicit reviewer scope, and no pagination on a single request page', async ({ page }) => {
  await activate(page); await page.locator('#hitl-refresh-btn').click();
  await expect(page.locator('.hitl-page-tabs [role="tab"]')).toHaveCount(3);
  await expect(page.locator('#hitl-pending-pagination')).toBeHidden();
  await expect(page.locator('#hitl-reviewer-scope')).toHaveText('Conversation reviewer');
  await expect(page.locator('#hitl-reviewer-scope-detail')).toHaveText('conv-1');
  await page.locator('#hitl-tab-pending').focus(); await page.keyboard.press('ArrowRight');
  await expect(page.locator('#hitl-tab-policy')).toBeFocused();
  await expect(page.locator('#hitl-tab-policy')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#hitl-panel-policy')).toBeVisible();
  await expect(page.locator('#hitl-panel-pending')).toBeHidden();
  await page.evaluate(() => { const h = globalThis as Harness; h.deps.getCurrentConversationId = () => ''; h.bridge.view.refreshReviewerBar(); });
  await expect(page.locator('#hitl-reviewer-scope')).toHaveText('Default reviewer');
  await expect(page.locator('#hitl-reviewer-scope-hint')).toContainText('global default for new conversations');
});

test('tool selection keeps unknown entries, supports exact names, and escapes catalog names', async ({ page }) => {
  await activate(page); await page.locator('#hitl-tab-policy').click();
  await expect(page.locator('#hitl-tool-options script, #hitl-tool-options img')).toHaveCount(0);
  await page.locator('#hitl-tool-search').fill('lab::scan');
  await page.locator('#hitl-tool-options').getByRole('checkbox', { name: 'lab::scan', exact: true }).check();
  await page.locator('#hitl-tool-search').fill('custom_tool');
  await page.locator('[data-action="hitl.add-tool"]').click();
  await expect(page.locator('#hitl-selected-tools')).toContainText('session');
  await expect(page.locator('#hitl-selected-tools')).toContainText('custom_tool');
  await page.locator('#hitl-page-whitelist-save-btn').click();
  await expect(page.locator('#hitl-page-whitelist-feedback')).toHaveText('Whitelist saved.');
  expect(await page.evaluate(() => (globalThis as Harness).calls.find(c => c.url === '/api/hitl/tool-whitelist' && c.method === 'PUT')?.body)).toEqual({ toolWhitelist: ['read', 'session', 'lab::scan', 'custom_tool'] });
});

test('switching tabs keeps unsaved policy drafts without issuing writes', async ({ page }) => {
  await activate(page); await page.locator('#hitl-tab-policy').click();
  await expect(page.locator('#hitl-audit-agent-prompt')).toBeEditable();
  await page.locator('#hitl-audit-agent-prompt').fill('Unsaved, bounded policy');
  await page.locator('#hitl-tool-search').fill('custom_draft');
  await page.locator('[data-action="hitl.add-tool"]').click();
  await page.locator('#hitl-tab-logs').click();
  await page.locator('#hitl-tab-policy').click();
  await expect(page.locator('#hitl-audit-agent-prompt')).toHaveValue('Unsaved, bounded policy');
  await expect(page.locator('#hitl-selected-tools')).toContainText('custom_draft');
  expect(await page.evaluate(() => (globalThis as Harness).calls.some(call => call.method === 'PUT'))).toBe(false);
  await page.locator('#hitl-refresh-btn').click();
  await expect(page.locator('#hitl-audit-agent-prompt')).toHaveValue('approval custom');
  await expect(page.locator('#hitl-selected-tools')).not.toContainText('custom_draft');
});

test('failed policy loads cannot save blank policy and catalog failure retains exact-name selection', async ({ page }) => {
  await activate(page);
  await page.evaluate(() => {
    const h = globalThis as Harness; const request = h.deps.request;
    h.deps.request = async (url, init) => url === '/api/hitl/audit-strategy' || url.startsWith('/api/config/tools?') ? new Response('{"error":"offline"}', { status: 503 }) : request(url, init);
  });
  await page.locator('#hitl-tab-policy').click();
  await expect(page.locator('#hitl-strategy-save-btn')).toBeDisabled();
  await expect(page.locator('#hitl-strategy-feedback')).toContainText('Could not load audit strategy');
  await expect(page.locator('#hitl-tool-catalog-status')).toContainText('Tool catalog unavailable');
  await page.locator('#hitl-tool-search').fill('exact_tool'); await page.locator('[data-action="hitl.add-tool"]').click();
  await expect(page.locator('#hitl-selected-tools')).toContainText('exact_tool');
  expect(await page.evaluate(() => (globalThis as Harness).calls.some(c => c.url === '/api/hitl/audit-strategy' && c.method === 'PUT'))).toBe(false);
});

test('dispose removes listeners, cancels deferred work and permits clean state-isolated remount', async ({ page }) => {
  await activate(page); await page.locator('#hitl-refresh-btn').click(); await expect(page.locator('.hitl-pending-item')).toHaveCount(2);
  const result = await page.evaluate(async () => {
    const h = globalThis as Harness; const count = h.calls.length;
    h.bridge.dispose(); globalThis.dispatchEvent(new Event('hitl-interrupt')); document.dispatchEvent(new Event('languagechange'));
    await Promise.resolve();
    return { count, after: h.calls.length };
  });
  expect(result.after).toBe(result.count);
  await expect(page.locator('.hitl-filter-select-ui')).toHaveCount(0);
  await page.evaluate(async () => { const h = globalThis as Harness; h.mount(); await h.bridge.afterClassicScripts(); await h.bridge.afterClassicScripts(); });
  await page.locator('#hitl-refresh-btn').click(); await expect(page.locator('.hitl-pending-item')).toHaveCount(2);
  expect(await page.evaluate(() => (globalThis as Harness).calls.filter(c => c.url === '/api/hitl/default-config').length)).toBe(2);
  expect(await page.evaluate(() => (globalThis as Harness).calls.filter(c => c.url.startsWith('/api/hitl/pending?')).length)).toBe(2);
});
