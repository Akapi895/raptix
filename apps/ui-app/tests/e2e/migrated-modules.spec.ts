import type { Page } from '@playwright/test';
import { test, expect, openApp } from './fixtures';

type Write = { path: string; method: string; body: unknown };
type Recording = typeof globalThis & { migrationWrites: Write[]; migrationRequests: string[] };

// Observe the real demo transport without changing its route/response contracts.
async function recordWrites(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = globalThis as Recording;
    target.migrationWrites = [];
    target.migrationRequests = [];
    const request = target.fetch;
    target.fetch = (input, init) => {
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      target.migrationRequests.push(input instanceof Request ? input.url : String(input));
      if (method !== 'GET') target.migrationWrites.push({
        path: new URL(input instanceof Request ? input.url : String(input), location.href).pathname,
        method, body: typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : null,
      });
      return request(input, init);
    };
  });
}
const writes = (page: Page) => page.evaluate(() => (globalThis as Recording).migrationWrites);

test('terminal tabs keep independent PTYs, renumber after close and remain usable', async ({ page }) => {
  await openApp(page, 'settings');
  await page.locator('.settings-nav-item[data-section="terminal"]').click();
  const activeInput = page.locator('.terminal-pane.active .xterm-helper-textarea');
  await activeInput.pressSequentially('whoami');
  await activeInput.press('Enter');
  await expect(page.locator('#terminal-pane-1 .xterm-rows')).toContainText('labuser');
  await page.locator('[data-action="terminal.add"]').click();
  await expect(page.locator('.terminal-pane')).toHaveCount(2);
  await activeInput.pressSequentially('pwd');
  await activeInput.press('Enter');
  await expect(page.locator('#terminal-pane-2 .xterm-rows')).toContainText('/home/labuser');
  await expect(page.locator('#terminal-pane-2 .xterm-rows')).not.toContainText('whoami');
  await page.locator('.terminal-tab[data-tab-id="1"] [data-action="terminal.remove"]').click();
  await expect(page.locator('.terminal-pane')).toHaveCount(1);
  await expect(page.locator('#terminal-pane-1 .xterm-rows')).toContainText('/home/labuser');
  await expect(page.locator('.terminal-tab-close')).toBeHidden();
  await page.locator('[data-action="terminal.add"]').click();
  await expect(page.locator('#terminal-pane-2')).toHaveClass(/active/);
  await activeInput.pressSequentially('id');
  await activeInput.press('Enter');
  await expect(page.locator('#terminal-pane-2 .xterm-rows')).toContainText('uid=1000');
});

test('storage preview, cancellation, cleanup and policy save preserve backend bodies', async ({ page }) => {
  await openApp(page, 'settings');
  await page.locator('.settings-nav-item[data-section="storage"]').click();
  const preview = page.locator('[data-action="storage.preview"]');
  await expect(preview).toBeEnabled();
  await expect(page.locator('#storage-overview')).toBeVisible();
  await recordWrites(page);
  await preview.click();
  await expect(page.locator('#storage-result')).toBeVisible();
  await expect(page.locator('[data-action="storage.cleanup"]')).toBeEnabled();
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('[data-action="storage.cleanup"]').click();
  expect(await writes(page)).toEqual([{ path: '/api/storage/cleanup', method: 'POST', body: { dry_run: true } }]);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('[data-action="storage.cleanup"]').click();
  await expect(page.locator('[data-action="storage.save"]')).toBeEnabled();
  await page.locator('#storage-auto-clean').check();
  await page.locator('#storage-interval-minutes').fill('20');
  await page.locator('#storage-orphan-grace-days').fill('3');
  await page.locator('#storage-active-grace-hours').fill('4');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('[data-action="storage.save"]').click();
  await expect(page.locator('[data-action="storage.save"]')).toBeEnabled();
  expect(await writes(page)).toEqual([
    { path: '/api/storage/cleanup', method: 'POST', body: { dry_run: true } },
    { path: '/api/storage/cleanup', method: 'POST', body: { dry_run: false, confirm: true } },
    { path: '/api/config', method: 'PUT', body: { storage: {
      auto_clean: true, interval_minutes: 20, orphan_grace_days: 3, active_grace_hours: 4, categories: {},
    } } },
  ]);
});

test('project fact CRUD reaches the typed graph and preserves the chat project scope', async ({ page }) => {
  await openApp(page, 'projects');
  // The navbar project switcher owns selection and hides the old project list.
  await expect(page.locator('#projects-detail-title')).toContainText(/Lab Web/);
  await page.locator('[data-action="projects.showAddFactModal"]').click();
  await page.locator('#fact-modal-key').fill('note/integrated-migration');
  await page.locator('#fact-modal-summary').fill('Integrated graph evidence');
  await page.locator('#fact-modal-body').fill('Evidence from the integrated browser flow.');
  await page.locator('#fact-modal-submit-btn').click();
  await expect(page.locator('#fact-modal')).toBeHidden();
  const fact = page.locator('#project-facts-tbody tr').filter({ hasText: 'Integrated graph evidence' });
  await expect(fact).toBeVisible();
  await fact.locator('[data-action="projects.edit-fact"]').click();
  await expect(page.locator('#fact-modal-key')).toHaveValue('note/integrated-migration');
  await page.locator('#fact-modal-summary').fill('Edited graph evidence');
  await page.locator('#fact-modal-submit-btn').click();
  await expect(page.locator('#fact-modal')).toBeHidden();
  await expect(page.locator('#project-facts-tbody')).toContainText('Edited graph evidence');
  await page.locator('#project-tab-graph').click();
  await expect(page.locator('#project-fact-graph-container canvas').first()).toBeVisible();
  await expect(page.locator('#project-fact-graph-stats')).not.toBeEmpty();
  const graph = await page.evaluate(async () => {
    const response = await fetch('/api/projects/proj-lab-web/fact-graph');
    const data = await response.json() as import('../../src/features/fact-graph').FactGraph;
    const node = data.nodes.find(node => node.fact_key === 'note/integrated-migration');
    if (!node) throw new Error('Created fact missing from graph');
    return { node };
  });
  expect(graph).toMatchObject({ node: { summary: 'Edited graph evidence' } });
  expect(resolveGraphNodeType(graph.node)).toBe('note');
  expect(nodeTheme('note').typeEn).toBeTruthy();
  await expect(page.locator('#csai-project-switcher')).toContainText('Lab Web Perimeter');
  await page.locator('#project-tab-conversations').click();
  await page.locator('[data-action="projects.open-conversation"][data-id="conv-recon-01"]').click();
  await expect(page).toHaveURL(/#chat\?conversation=conv-recon-01/);
  await expect(page.locator('#csai-project-switcher')).toContainText('Lab Web Perimeter');
});

test('live chat HITL approval resumes the run and records an audit decision', async ({ page }) => {
  await openApp(page, 'chat');
  await recordWrites(page);
  await page.locator('#chat-input').fill('Check token refresh with HITL approval');
  await page.locator('#chat-send-btn').click();
  await expect(page).toHaveURL(/#chat\?conversation=/);
  // Wait on the real interrupt, then navigate through the installed router.
  await expect.poll(() => page.evaluate(async () => {
    const response = await fetch('/api/hitl/pending');
    return ((await response.json()) as { total: number }).total;
  })).toBe(1);
  const conversationHash = new URL(page.url()).hash;
  await page.evaluate(() => { location.hash = 'hitl'; });
  const approve = page.locator('[data-action="hitl.decide"][data-decision="approve"]');
  await expect(approve).toBeVisible();
  await approve.click();
  await expect(approve).toHaveCount(0);
  await page.locator('#hitl-tab-logs').click();
  await expect(page.locator('#hitl-logs-table-wrap')).toContainText(/approv/i);
  expect((await writes(page)).filter(write => write.path === '/api/hitl/decision')).toEqual([
    expect.objectContaining({ method: 'POST', body: expect.objectContaining({ decision: 'approve' }) }),
  ]);
  await page.evaluate(hash => { location.hash = hash; }, conversationHash);
  await expect(page.locator('#chat-messages .message.assistant').last()).toContainText('Refresh-token rotation check completed', { timeout: 25_000 });
  await expect(page.locator('#chat-send-btn')).not.toHaveClass(/is-stop/);
});

test('the builtin tool catalog is a module API and is not published on the browser', async ({ page }) => {
  await openApp(page, 'chat');
  expect({ tools: getAllBuiltinTools(), known: isBuiltinTool('record_vulnerability'), unknown: isBuiltinTool('custom_tool') })
    .toEqual({ tools: ['record_vulnerability', 'list_knowledge_risk_types', 'search_knowledge_base'], known: true, unknown: false });
  expect(await page.evaluate(() => ['getAllBuiltinTools', 'isBuiltinTool', 'BuiltinTools'].filter(name => Reflect.has(globalThis, name)))).toEqual([]);
});

test('audit date picker, UTC filters, pagination and detail work through settings', async ({ page }) => {
  await openApp(page, 'settings');
  await page.locator('.settings-nav-item[data-section="audit"]').click();
  await expect(page.locator('#audit-log-list .audit-log-row')).toHaveCount(5);
  await recordWrites(page);
  await page.locator('[data-action="audit.preset"][data-preset="1h"]').click();
  await expect.poll(() => page.evaluate(() => (globalThis as Recording).migrationRequests.some(address => {
    const url = new URL(address, location.href);
    return url.pathname === '/api/audit/logs' && /Z$/.test(url.searchParams.get('since') ?? '') && /Z$/.test(url.searchParams.get('until') ?? '');
  }))).toBe(true);
  await page.locator('#audit-filter-since-field').click();
  await expect(page.locator('[data-action="audit.date-confirm"]')).toBeVisible();
  await page.locator('[data-action="audit.date-clear"]').click();
  await page.locator('[data-action="audit.reset"]').click();
  await expect(page.locator('#audit-log-list .audit-log-row')).toHaveCount(5);
  await page.locator('#audit-page-size').selectOption('50');
  expect(await page.evaluate(() => localStorage.getItem('raptix_audit_page_size'))).toBe('50');
  await page.locator('[data-action="audit.detail"][data-id="audit-1"]').click();
  await expect(page.locator('#audit-detail-modal')).toBeVisible();
  await expect(page.locator('#audit-detail-modal')).toContainText('127.0.0.1');
  await page.locator('#audit-detail-modal [data-action="audit.close-detail"]').first().click();
  await expect(page.locator('#audit-detail-modal')).toHaveCount(0);
});

test('dashboard token card opens scoped analytics and delegated trend and period controls', async ({ page }) => {
  await openApp(page);
  await recordWrites(page);
  await page.locator('#dashboard-kpi-token-usage').click();
  await expect(page).toHaveURL(/#settings\?section=token-usage/);
  await expect(page.locator('#settings-token-analysis [data-metric="usageTotal"] strong')).not.toBeEmpty();
  await page.locator('[data-token-trend="cacheRate"]').click();
  await expect(page.locator('[data-token-trend="cacheRate"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.token-usage-trend-svg')).toContainText('100%');
  await page.locator('#settings-token-days').selectOption('30');
  await expect.poll(() => page.evaluate(() => (globalThis as Recording).migrationRequests.some(address => {
    const url = new URL(address, location.href);
    return url.pathname === '/api/usage/tokens' && url.searchParams.get('days') === '30' && url.searchParams.get('project_id') === 'proj-lab-web';
  }))).toBe(true);
  await expect(page.locator('#settings-token-analysis')).not.toHaveAttribute('aria-busy');
});
import { getAllBuiltinTools, isBuiltinTool } from '../../src/features/builtin-tools';
import { resolveGraphNodeType } from '../../src/features/fact-graph/service';
import { nodeTheme } from '../../src/features/fact-graph/cards';
